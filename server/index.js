import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { getLeaderboard, addLeaderboardEntry } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

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
function durationFor(round) {
  return CONFIG.roundDurations[round - 1] ?? CONFIG.roundDurations[CONFIG.roundDurations.length - 1];
}

/** Ohne I, O, 0 und 1 – die sind auf einem Handydisplay nicht zu unterscheiden. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Raumcode -> Raum. Räume entstehen auf Zuruf und verschwinden, wenn sie leer sind. */
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
    players: new Map(),   // socketId -> { id, name, ready }
    hostId: null,
    status: 'lobby',      // lobby | playing | results | finished
    round: 0,
    totals: new Map(),    // socketId -> Gesamtpunkte
    roundScores: new Map(),// socketId -> Punkte dieser Runde
    submitted: new Set(),
    timer: null,
  };
  rooms.set(room.id, room);
  return room;
}

/** Der Raum heisst nach dem, der ihn aufgemacht hat. */
function roomName(room) {
  const host = room.players.get(room.hostId)?.name;
  return host ? `${host}s Raum` : `Raum ${room.id}`;
}

/** Raum abraeumen, sobald der Letzte raus ist. */
function destroyRoom(room) {
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
  rooms.delete(room.id);
}

// -------------------- Hilfsfunktionen --------------------

/**
 * Was auf der Startseite steht: offene, oeffentliche Raeume mit Leuten drin.
 * Private Raeume erreicht man nur ueber den Code.
 */
function roomsSummary() {
  return [...rooms.values()]
    .filter((r) => r.isPublic && r.status === 'lobby' &&
      r.players.size > 0 && r.players.size < CONFIG.maxPlayers)
    .map((r) => ({
      id: r.id,
      name: roomName(r),
      host: r.players.get(r.hostId)?.name ?? '?',
      count: r.players.size,
      max: CONFIG.maxPlayers,
      status: r.status,
    }))
    .sort((a, b) => b.count - a.count);
}

function playerList(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    ready: p.ready,
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
  // Host neu bestimmen: erster verbleibender Spieler, sonst keiner.
  // (Fix: alter Host-ID blieb frueher stehen -> kein Host nach Neubeitritt.)
  room.hostId = room.players.size ? room.players.keys().next().value : null;
}

function allReady(room) {
  return room.players.size >= CONFIG.minPlayers
    && [...room.players.values()].every((p) => p.ready);
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
  const active = [...room.players.keys()];
  if (active.length > 0 && active.every((id) => room.submitted.has(id))) {
    endRound(room);
  }
}

// -------------------- Socket-Handling --------------------
io.on('connection', (socket) => {
  socket.emit('rooms', roomsSummary());
  socket.emit('leaderboard', getLeaderboard());

  /** Gemeinsame Logik von Beitreten und Aufmachen. */
  function sitDown(room, name, cb) {
    const cleanName = String(name || '').trim().slice(0, 16) || 'Spieler';
    room.players.set(socket.id, { id: socket.id, name: cleanName, ready: false });
    room.totals.set(socket.id, 0);
    if (!room.hostId) room.hostId = socket.id;

    socket.data.roomId = room.id;
    socket.data.name = cleanName;
    socket.join(room.id);

    cb({ ok: true, roomId: room.id });
    emitRoomState(room);
    broadcastRooms();
  }

  socket.on('createRoom', ({ name, isPublic } = {}, cb = () => {}) => {
    if (socket.data.roomId) leave(socket);
    sitDown(createRoom(isPublic !== false), name, cb);
  });

  socket.on('joinRoom', ({ roomId, name }, cb = () => {}) => {
    const code = String(roomId || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb({ error: 'Diesen Raum gibt es nicht.' });
    if (room.status !== 'lobby') return cb({ error: 'In diesem Raum laeuft gerade ein Spiel.' });
    if (room.players.size >= CONFIG.maxPlayers) return cb({ error: 'Raum ist voll.' });
    if (socket.data.roomId) leave(socket);
    sitDown(room, name, cb);
  });

  socket.on('setVisibility', ({ isPublic } = {}) => {
    const room = rooms.get(socket.data.roomId);
    // Nur der Host, und nur solange nicht gespielt wird.
    if (!room || room.hostId !== socket.id || room.status !== 'lobby') return;
    room.isPublic = !!isPublic;
    emitRoomState(room);
    broadcastRooms();
  });

  socket.on('toggleReady', () => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;
    // "Bereit" gilt in der Lobby UND zwischen den Runden (Ergebnis-Screen).
    if (room.status !== 'lobby' && room.status !== 'results') return;
    const p = room.players.get(socket.id);
    if (!p) return;
    p.ready = !p.ready;
    emitRoomState(room);
    // Zwischen den Runden: sobald alle bereit sind -> naechste Runde automatisch.
    if (room.status === 'results' && allReady(room)) startRound(room);
  });

  socket.on('startGame', () => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.hostId !== socket.id) return;
    if (room.status !== 'lobby') return;
    if (room.players.size < CONFIG.minPlayers) return;
    if (![...room.players.values()].every((p) => p.ready)) return;

    room.round = 0;
    for (const id of room.players.keys()) room.totals.set(id, 0);
    startRound(room);
  });

  socket.on('submitRoundScore', ({ round, score }) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.status !== 'playing') return;
    if (round !== room.round) return;
    if (room.submitted.has(socket.id)) return;

    const s = Math.max(0, Number(score) || 0);
    room.roundScores.set(socket.id, s);
    room.totals.set(socket.id, (room.totals.get(socket.id) || 0) + s);
    room.submitted.add(socket.id);
    maybeFinishRound(room);
  });

  socket.on('backToLobby', () => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;
    resetRoomToLobby(room);
    emitRoomState(room);
    broadcastRooms();
  });

  socket.on('leaveRoom', () => leave(socket));
  socket.on('disconnect', () => leave(socket));

  socket.on('getLeaderboard', () => socket.emit('leaderboard', getLeaderboard()));
});

function leave(socket) {
  const room = rooms.get(socket.data.roomId);
  if (!room) return;
  const wasHost = room.hostId === socket.id;
  room.players.delete(socket.id);
  room.totals.delete(socket.id);
  room.roundScores.delete(socket.id);
  room.submitted.delete(socket.id);
  socket.leave(room.id);
  socket.data.roomId = null;

  if (room.players.size === 0) {
    destroyRoom(room);
    broadcastRooms();
    return;
  }
  if (wasHost) room.hostId = room.players.keys().next().value;

  // Laeuft ein Spiel und es sind zu wenige Spieler uebrig -> zurueck in die Lobby
  if (room.status !== 'lobby' && room.players.size < CONFIG.minPlayers) {
    resetRoomToLobby(room);
    io.to(room.id).emit('gameAborted', { reason: 'Zu wenige Spieler.' });
  } else if (room.status === 'playing') {
    maybeFinishRound(room);
  }
  emitRoomState(room);
  broadcastRooms();
}

server.listen(PORT, () => {
  console.log(`PickUp laeuft auf http://localhost:${PORT}`);
});
