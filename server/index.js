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
  rounds: 5,             // Anzahl Runden pro Spiel
  roundDuration: 120,    // Sekunden pro Runde
  maxPlayers: 4,
  minPlayers: 2,
  graceSeconds: 20,      // Puffer bevor der Server eine Runde zwangsweise abschliesst
};

const ROOM_IDS = ['1', '2', '3', '4'];
const rooms = {};

function createRoom(id) {
  return {
    id,
    name: 'Raum ' + id,
    players: new Map(),   // socketId -> { id, name, ready }
    hostId: null,
    status: 'lobby',      // lobby | playing | results | finished
    round: 0,
    totals: new Map(),    // socketId -> Gesamtpunkte
    roundScores: new Map(),// socketId -> Punkte dieser Runde
    submitted: new Set(),
    timer: null,
  };
}
for (const id of ROOM_IDS) rooms[id] = createRoom(id);

// -------------------- Hilfsfunktionen --------------------
function roomsSummary() {
  return ROOM_IDS.map((id) => ({
    id,
    name: rooms[id].name,
    count: rooms[id].players.size,
    max: CONFIG.maxPlayers,
    status: rooms[id].status,
  }));
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
    name: room.name,
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
}

function startRound(room) {
  room.round += 1;
  room.status = 'playing';
  room.roundScores = new Map();
  room.submitted = new Set();

  io.to(room.id).emit('roundStart', {
    round: room.round,
    totalRounds: CONFIG.rounds,
    duration: CONFIG.roundDuration,
  });
  emitRoomState(room);
  broadcastRooms();

  if (room.timer) clearTimeout(room.timer);
  room.timer = setTimeout(() => {
    endRound(room);
  }, (CONFIG.roundDuration + CONFIG.graceSeconds) * 1000);
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

  socket.on('joinRoom', ({ roomId, name }, cb = () => {}) => {
    const room = rooms[roomId];
    if (!room) return cb({ error: 'Raum existiert nicht.' });
    if (room.status !== 'lobby') return cb({ error: 'In diesem Raum laeuft gerade ein Spiel.' });
    if (room.players.size >= CONFIG.maxPlayers) return cb({ error: 'Raum ist voll.' });

    const cleanName = String(name || '').trim().slice(0, 20) || 'Spieler';
    room.players.set(socket.id, { id: socket.id, name: cleanName, ready: false });
    room.totals.set(socket.id, 0);
    if (!room.hostId) room.hostId = socket.id;

    socket.data.roomId = roomId;
    socket.data.name = cleanName;
    socket.join(roomId);

    cb({ ok: true, roomId });
    emitRoomState(room);
    broadcastRooms();
  });

  socket.on('toggleReady', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.status !== 'lobby') return;
    const p = room.players.get(socket.id);
    if (!p) return;
    p.ready = !p.ready;
    emitRoomState(room);
  });

  socket.on('startGame', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.hostId !== socket.id) return;
    if (room.status !== 'lobby') return;
    if (room.players.size < CONFIG.minPlayers) return;
    if (![...room.players.values()].every((p) => p.ready)) return;

    room.round = 0;
    for (const id of room.players.keys()) room.totals.set(id, 0);
    startRound(room);
  });

  socket.on('submitRoundScore', ({ round, score }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.status !== 'playing') return;
    if (round !== room.round) return;
    if (room.submitted.has(socket.id)) return;

    const s = Math.max(0, Number(score) || 0);
    room.roundScores.set(socket.id, s);
    room.totals.set(socket.id, (room.totals.get(socket.id) || 0) + s);
    room.submitted.add(socket.id);
    maybeFinishRound(room);
  });

  socket.on('nextRound', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.hostId !== socket.id) return;
    if (room.status !== 'results') return;
    startRound(room);
  });

  socket.on('backToLobby', () => {
    const room = rooms[socket.data.roomId];
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
  const room = rooms[socket.data.roomId];
  if (!room) return;
  const wasHost = room.hostId === socket.id;
  room.players.delete(socket.id);
  room.totals.delete(socket.id);
  room.roundScores.delete(socket.id);
  room.submitted.delete(socket.id);
  socket.leave(room.id);
  socket.data.roomId = null;

  if (room.players.size === 0) {
    resetRoomToLobby(room);
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
