import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { getLeaderboard, addLeaderboardEntry } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
// Lokal 0.0.0.0, damit Mitspieler im WLAN direkt draufkommen. Hinter einem
// Reverse Proxy gehoert HOST=127.0.0.1 gesetzt, sonst ist der Dienst unter
// Umgehung von Apache auch ohne HTTPS erreichbar.
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));

// -------------------- Spiel-Konfiguration --------------------
const CONFIG = {
  rounds: 5,                              // Anzahl Runden pro Spiel
  roundDurations: [90, 70, 50, 35, 25],   // Sekunden je Runde: entspannt -> stressig
  maxPlayers: 4,
  minPlayers: 2,
  graceSeconds: 20,                       // Puffer bevor der Server eine Runde zwangsweise abschliesst
};

/**
 * Zwei verschiedene Dinge, die man leicht verwechselt:
 *
 * ROOM_IDLE_MS – so lange bleibt ein *Raum* offen, in dem gerade niemand sitzt.
 *   Das ist der Puffer fuers Link-Teilen: dafuer muss man den Tab verlassen, und
 *   auf dem Handy stirbt dabei der Socket. Der Raum steht weiter, wer
 *   zurueckkommt, tritt einfach wieder ein. In der Raumliste taucht er nicht
 *   auf, solange niemand drin sitzt – erreichbar ist er nur ueber Code und Link.
 *
 * SEAT_GRACE_MS – so lange bleibt ein *Platz* reserviert. Das braucht es nur
 *   waehrend einer laufenden Partie, weil dort Punkte am Platz haengen. In der
 *   Lobby haengt daran nichts, also wird der Platz sofort frei – ein Sitz, auf
 *   dem sichtbar niemand sitzt, verwirrt nur.
 *
 * Gleiche Werte und gleiche Regel in allen vier Spielen.
 */
const ROOM_IDLE_MS = 5 * 60_000;
const SEAT_GRACE_MS = 60_000;

function durationFor(round) {
  return CONFIG.roundDurations[round - 1] ?? CONFIG.roundDurations[CONFIG.roundDurations.length - 1];
}

/** Ohne I, O, 0 und 1 – die sind auf einem Handydisplay nicht zu unterscheiden. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Raumcode -> Raum. Räume entstehen auf Zuruf und verschwinden, wenn kein Platz mehr belegt ist. */
const rooms = new Map();

function newCode() {
  for (let i = 0; i < 500; i++) {
    let c = '';
    for (let k = 0; k < 4; k++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  return 'P' + Date.now().toString(36).slice(-3).toUpperCase();
}

function createRoom(isPublic = true) {
  const room = {
    id: newCode(),
    isPublic: !!isPublic,
    // Schluessel ist die Spieler-ID aus dem Browser, nicht die Socket-ID: die
    // Verbindung darf wechseln, ohne dass der Platz verloren geht.
    players: new Map(),   // pid -> { id, name, ready, online, socketId, dropTimer }
    hostId: null,
    status: 'lobby',      // lobby | playing | results | finished
    round: 0,
    totals: new Map(),    // pid -> Gesamtpunkte
    roundScores: new Map(),// pid -> Punkte dieser Runde
    submitted: new Set(),
    timer: null,
    idleTimer: null,      // laeuft, solange niemand im Raum sitzt
  };
  rooms.set(room.id, room);
  return room;
}

/**
 * Ein Raum, in dem niemand mehr sitzt, wird nicht sofort abgeraeumt – sonst
 * waere er genau dann weg, wenn man gerade den Link verschickt.
 */
function scheduleIdleClose(room) {
  if (room.idleTimer) clearTimeout(room.idleTimer);
  room.idleTimer = setTimeout(() => {
    if (room.players.size === 0) destroyRoom(room);
  }, ROOM_IDLE_MS);
}

function cancelIdleClose(room) {
  if (room.idleTimer) { clearTimeout(room.idleTimer); room.idleTimer = null; }
}

/** Der Raum heisst nach dem, der ihn aufgemacht hat. */
function roomName(room) {
  const host = room.players.get(room.hostId)?.name;
  return host ? `${host}s Raum` : `Raum ${room.id}`;
}

/** Raum abraeumen, sobald kein Platz mehr belegt ist. */
function destroyRoom(room) {
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
  if (room.idleTimer) { clearTimeout(room.idleTimer); room.idleTimer = null; }
  for (const p of room.players.values()) {
    if (p.dropTimer) clearTimeout(p.dropTimer);
  }
  rooms.delete(room.id);
}

// -------------------- Hilfsfunktionen --------------------

/** Wer gerade wirklich am Tisch sitzt. Reservierte Plaetze zaehlen nicht mit. */
function onlinePlayers(room) {
  return [...room.players.values()].filter((p) => p.online);
}

/**
 * Der Host ist immer jemand, der auch da ist. Geht er raus oder faellt die
 * Verbindung weg, rueckt der naechste Anwesende nach – sonst steht der Raum
 * ohne Host da und niemand kann mehr starten.
 */
function ensureHost(room) {
  const current = room.players.get(room.hostId);
  if (current?.online) return;
  const next = onlinePlayers(room)[0];
  room.hostId = next ? next.id : null;
}

/**
 * Was auf der Startseite steht: offene, oeffentliche Raeume mit Leuten drin.
 * Gezaehlt wird nach *anwesenden* Spielern – sonst steht ein Raum, dessen Leute
 * gerade alle weg sind, noch in der Liste und zeigt dabei "0/4".
 * Private Raeume erreicht man nur ueber den Code.
 */
function roomsSummary() {
  return [...rooms.values()]
    .map((r) => ({ room: r, online: onlinePlayers(r) }))
    .filter(({ room, online }) => room.isPublic && room.status === 'lobby' &&
      online.length > 0 && room.players.size < CONFIG.maxPlayers)
    .map(({ room, online }) => ({
      id: room.id,
      name: roomName(room),
      host: room.players.get(room.hostId)?.name ?? '?',
      count: online.length,
      max: CONFIG.maxPlayers,
      status: room.status,
    }))
    .sort((a, b) => b.count - a.count);
}

function playerList(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    ready: p.ready,
    online: p.online,
    isHost: p.id === room.hostId,
    total: room.totals.get(p.id) || 0,
  }));
}

function emitRoomState(room) {
  io.to(room.id).emit('roomState', {
    roomId: room.id,
    name: roomName(room),
    isPublic: room.isPublic,
    status: room.status,
    round: room.round,
    totalRounds: CONFIG.rounds,
    hostId: room.hostId,
    players: playerList(room),
    minPlayers: CONFIG.minPlayers,
  });
}

function broadcastRooms() {
  io.emit('rooms', roomsSummary());
}

function standings(room) {
  return [...room.players.values()]
    .map((p) => ({
      id: p.id,
      name: p.name,
      roundScore: room.roundScores.get(p.id) || 0,
      total: room.totals.get(p.id) || 0,
    }))
    .sort((a, b) => b.total - a.total);
}

function resetRoomToLobby(room) {
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
  room.status = 'lobby';
  room.round = 0;
  room.totals = new Map();
  room.roundScores = new Map();
  room.submitted = new Set();
  for (const p of room.players.values()) p.ready = false;
  ensureHost(room);
}

/**
 * Zwischen den Runden: es reicht, dass alle Anwesenden bereit sind. Hier wird
 * bewusst nicht mehr auf minPlayers geprueft – wer als Einziger uebrig bleibt,
 * soll die angefangene Partie zu Ende spielen und in die Bestenliste kommen.
 * Zum *Starten* braucht es weiterhin zwei (siehe lobbyReady).
 */
function allReady(room) {
  const online = onlinePlayers(room);
  return online.length > 0 && online.every((p) => p.ready);
}

/**
 * In der Lobby hat der Host keinen "Bereit"-Knopf – er drueckt "Spiel starten".
 * Also zaehlt er dort automatisch als bereit, sonst kaeme das Spiel nie los.
 * (Zwischen den Runden gibt es fuer alle einen Bereit-Knopf -> allReady.)
 */
function lobbyReady(room) {
  const online = onlinePlayers(room);
  return online.length >= CONFIG.minPlayers
    && online.every((p) => p.ready || p.id === room.hostId);
}

function startRound(room) {
  room.round += 1;
  room.status = 'playing';
  room.roundScores = new Map();
  room.submitted = new Set();
  const duration = durationFor(room.round);

  io.to(room.id).emit('roundStart', {
    round: room.round,
    totalRounds: CONFIG.rounds,
    duration,
  });
  emitRoomState(room);
  broadcastRooms();

  if (room.timer) clearTimeout(room.timer);
  room.timer = setTimeout(() => {
    endRound(room);
  }, (duration + CONFIG.graceSeconds) * 1000);
}

function endRound(room) {
  if (room.status !== 'playing') return;
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }

  // Fehlende Spieler bekommen 0 fuer diese Runde
  for (const p of room.players.values()) {
    if (!room.roundScores.has(p.id)) room.roundScores.set(p.id, 0);
  }

  const isLast = room.round >= CONFIG.rounds;
  room.status = isLast ? 'finished' : 'results';
  // Fuer die naechste Runde muessen alle erneut "Bereit" druecken.
  if (!isLast) for (const p of room.players.values()) p.ready = false;

  io.to(room.id).emit('roundResults', {
    round: room.round,
    totalRounds: CONFIG.rounds,
    isLast,
    standings: standings(room),
  });

  if (isLast) {
    for (const p of room.players.values()) {
      addLeaderboardEntry(p.name, room.totals.get(p.id) || 0);
    }
    io.emit('leaderboard', getLeaderboard());
    io.to(room.id).emit('gameOver', { standings: standings(room) });
  }
  emitRoomState(room);
  broadcastRooms();
}

function maybeFinishRound(room) {
  // Auf jemanden zu warten, der gerade gar nicht da ist, haelt die Runde
  // sonst bis zum Ablauf des Timers auf.
  const active = onlinePlayers(room).map((p) => p.id);
  if (active.length > 0 && active.every((id) => room.submitted.has(id))) {
    endRound(room);
  }
}

// -------------------- Socket-Handling --------------------
io.on('connection', (socket) => {
  socket.emit('rooms', roomsSummary());
  socket.emit('leaderboard', getLeaderboard());

  /** Spieler-ID aus dem Browser uebernehmen, sonst eine neue vergeben. */
  socket.on('hello', ({ pid } = {}, cb = () => {}) => {
    socket.data.pid = /^[a-z0-9-]{6,64}$/i.test(String(pid ?? '')) ? String(pid) : randomUUID();
    cb({ pid: socket.data.pid });
  });

  function myPid() {
    if (!socket.data.pid) socket.data.pid = randomUUID();
    return socket.data.pid;
  }

  /** Gemeinsame Logik von Beitreten und Aufmachen. */
  function sitDown(room, name, cb) {
    const pid = myPid();
    cancelIdleClose(room);
    const cleanName = String(name || '').trim().slice(0, 16) || 'Spieler';
    room.players.set(pid, {
      id: pid, name: cleanName, ready: false, online: true,
      socketId: socket.id, dropTimer: null,
    });
    room.totals.set(pid, 0);
    ensureHost(room);

    socket.data.roomId = room.id;
    socket.data.name = cleanName;
    socket.join(room.id);

    cb({ ok: true, roomId: room.id, pid });
    emitRoomState(room);
    broadcastRooms();
  }

  socket.on('createRoom', ({ name, isPublic } = {}, cb = () => {}) => {
    if (socket.data.roomId) removeFromRoom(socket, myPid());
    sitDown(createRoom(isPublic !== false), name, cb);
  });

  socket.on('joinRoom', ({ roomId, name }, cb = () => {}) => {
    const code = String(roomId || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb({ error: 'Diesen Raum gibt es nicht.' });

    // Rueckkehrer bekommen ihren Platz zurueck – auch wenn der Raum inzwischen
    // voll ist oder gerade gespielt wird.
    if (room.players.has(myPid())) return reattach(socket, room, cb);

    // Ein Raum, in dem niemand mehr sitzt, faengt fuer den Naechsten von vorn an.
    if (room.players.size === 0) resetRoomToLobby(room);
    if (room.status !== 'lobby') return cb({ error: 'In diesem Raum laeuft gerade ein Spiel.' });
    if (room.players.size >= CONFIG.maxPlayers) return cb({ error: 'Raum ist voll.' });
    if (socket.data.roomId) removeFromRoom(socket, myPid());
    sitDown(room, name, cb);
  });

  /**
   * Nach Verbindungsabbruch oder Reload zurueck an den alten Platz. Der Client
   * schickt das von allein, sobald er wieder steht – ohne Zutun des Spielers.
   */
  socket.on('resume', ({ roomId } = {}, cb = () => {}) => {
    const room = rooms.get(String(roomId || '').toUpperCase().trim());
    if (!room || !room.players.has(myPid())) {
      return cb({ error: 'Der Raum ist nicht mehr da.' });
    }
    reattach(socket, room, cb);
  });

  socket.on('setVisibility', ({ isPublic } = {}) => {
    const room = rooms.get(socket.data.roomId);
    // Nur der Host, und nur solange nicht gespielt wird.
    if (!room || room.hostId !== socket.data.pid || room.status !== 'lobby') return;
    room.isPublic = !!isPublic;
    emitRoomState(room);
    broadcastRooms();
  });

  socket.on('toggleReady', () => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;
    // "Bereit" gilt in der Lobby UND zwischen den Runden (Ergebnis-Screen).
    if (room.status !== 'lobby' && room.status !== 'results') return;
    const p = room.players.get(socket.data.pid);
    if (!p) return;
    p.ready = !p.ready;
    emitRoomState(room);
    // Zwischen den Runden: sobald alle bereit sind -> naechste Runde automatisch.
    if (room.status === 'results' && allReady(room)) startRound(room);
  });

  socket.on('startGame', () => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.hostId !== socket.data.pid) return;
    if (room.status !== 'lobby') return;
    if (!lobbyReady(room)) return;

    room.round = 0;
    for (const id of room.players.keys()) room.totals.set(id, 0);
    startRound(room);
  });

  socket.on('submitRoundScore', ({ round, score }) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.status !== 'playing') return;
    if (round !== room.round) return;
    const pid = socket.data.pid;
    if (room.submitted.has(pid)) return;

    const s = Math.max(0, Number(score) || 0);
    room.roundScores.set(pid, s);
    room.totals.set(pid, (room.totals.get(pid) || 0) + s);
    room.submitted.add(pid);
    maybeFinishRound(room);
  });

  socket.on('backToLobby', () => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;
    resetRoomToLobby(room);
    emitRoomState(room);
    broadcastRooms();
  });

  // Der Knopf "Raum verlassen" ist eine Entscheidung – da gibt es keine Karenzzeit.
  socket.on('leaveRoom', () => removeFromRoom(socket, socket.data.pid));

  // Verbindung weg ist etwas anderes: der Platz bleibt eine Weile reserviert.
  socket.on('disconnect', () => holdSeat(socket));

  socket.on('getLeaderboard', () => socket.emit('leaderboard', getLeaderboard()));
});

/** Einen Rueckkehrer wieder mit seinem Platz verbinden. */
function reattach(socket, room, cb) {
  // Woanders gesessen? Den alten Platz erst raeumen, sonst haengt man in zweien.
  if (socket.data.roomId && socket.data.roomId !== room.id) {
    removeFromRoom(socket, socket.data.pid);
  }
  cancelIdleClose(room);
  const p = room.players.get(socket.data.pid);
  if (p.dropTimer) { clearTimeout(p.dropTimer); p.dropTimer = null; }
  p.online = true;
  p.socketId = socket.id;
  socket.data.roomId = room.id;
  socket.join(room.id);
  ensureHost(room);

  cb({
    ok: true,
    roomId: room.id,
    pid: p.id,
    status: room.status,
    // Damit der Client den Ergebnis-Screen wieder aufbauen kann – er hat den
    // Zwischenstand nach einem Reload ja nicht mehr.
    standings: room.status === 'results' || room.status === 'finished' ? standings(room) : null,
    round: room.round,
    totalRounds: CONFIG.rounds,
  });
  emitRoomState(room);
  broadcastRooms();
}

/**
 * Verbindung weg. In der Lobby wird der Platz sofort frei – dort haengt nichts
 * daran, und ein Sitz mit niemandem drauf verwirrt die anderen nur. Der Raum
 * bleibt trotzdem offen (siehe scheduleIdleClose), wer zurueckkommt, tritt
 * einfach wieder ein.
 *
 * Waehrend einer Partie ist das anders: da haengen Punkte am Platz, also bleibt
 * er reserviert. Die Runde laeuft ohne den Abwesenden weiter.
 */
function holdSeat(socket) {
  const room = rooms.get(socket.data.roomId);
  const pid = socket.data.pid;
  if (!room) return;
  const p = room.players.get(pid);
  // Woanders schon wieder eingestiegen? Dann gehoert der Platz der neuen Verbindung.
  if (!p || p.socketId !== socket.id) return;

  if (room.status === 'lobby') {
    socket.data.roomId = null;
    releasePlayer(room, pid);
    return;
  }

  p.online = false;
  p.ready = false;
  ensureHost(room);

  if (p.dropTimer) clearTimeout(p.dropTimer);
  p.dropTimer = setTimeout(() => dropSeat(room, pid), SEAT_GRACE_MS);

  // Laeuft ein Spiel, darf ein Abwesender die Runde nicht blockieren.
  if (room.status === 'playing') maybeFinishRound(room);
  emitRoomState(room);
  broadcastRooms();
}

/** Karenzzeit abgelaufen – der Platz wird frei. */
function dropSeat(room, pid) {
  const p = room.players.get(pid);
  if (!p || p.online) return;
  releasePlayer(room, pid);
}

/** Sofort raus, ohne Karenzzeit (Knopf "Raum verlassen"). */
function removeFromRoom(socket, pid) {
  const room = rooms.get(socket.data.roomId);
  socket.data.roomId = null;
  if (!room) return;
  socket.leave(room.id);
  releasePlayer(room, pid);
}

/** Platz endgueltig freigeben und aufraeumen, was daran haengt. */
function releasePlayer(room, pid) {
  const p = room.players.get(pid);
  if (!p) return;
  if (p.dropTimer) { clearTimeout(p.dropTimer); p.dropTimer = null; }
  room.players.delete(pid);
  room.totals.delete(pid);
  room.roundScores.delete(pid);
  room.submitted.delete(pid);

  if (room.players.size === 0) {
    // Niemand mehr da: der Raum bleibt eine Weile offen, faengt aber von vorn
    // an. In der Raumliste steht er nicht – nur Code und Link fuehren hin.
    resetRoomToLobby(room);
    scheduleIdleClose(room);
    broadcastRooms();
    return;
  }
  ensureHost(room);

  // Kein Abbruch mehr, wenn zu wenige uebrig sind: wer bleibt, spielt die
  // Partie zu Ende und kommt damit auch in die Bestenliste.
  if (room.status === 'playing') maybeFinishRound(room);
  emitRoomState(room);
  broadcastRooms();
}

server.listen(PORT, HOST, () => {
  console.log(`Keep laeuft auf http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
