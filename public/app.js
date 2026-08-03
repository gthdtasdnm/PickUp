import { SYMBOL_BY_ID, CATEGORIES, scoreCategory, randomSymbol } from './game-core.js';
import { SYMBOL_SVG } from './symbols.js';

const socket = io();
let myId = null;

// ---------------- App-Status ----------------
const state = {
  name: '',
  roomId: null,
  isHost: false,
  round: 0,
  totalRounds: 5,
  leaderboard: [],
};

// Runden-Status (lokal). spinsDone: 1 = Auto-Dreh, 2 = nach 1. Draw, 3 = nach 2. Draw
const game = {
  reels: [null, null, null, null, null],
  held: [false, false, false, false, false],
  maxSpins: 3,
  spinsDone: 0,
  scored: {},        // categoryId -> Punkte
  roundScore: 0,
  duration: 0,
  endAt: 0,
  timer: null,
  submitted: false,
};

// ---------------- Screen-Helfer ----------------
const $ = (sel) => document.querySelector(sel);
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $('#' + id).classList.add('active');
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
function symbolEl(id) {
  const s = SYMBOL_BY_ID[id];
  return `<span style="color:${s.color};display:flex;width:100%;height:100%;align-items:center;justify-content:center">${SYMBOL_SVG[id]}</span>`;
}

// ================================================================
//  START / NAME
// ================================================================
$('#toRoomsBtn').addEventListener('click', () => {
  const name = $('#nameInput').value.trim();
  if (!name) return toast('Bitte gib einen Namen ein.');
  state.name = name;
  socket.emit('getLeaderboard');
  show('screen-rooms');
});
$('#nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#toRoomsBtn').click(); });

$('#showLeaderboardBtn').addEventListener('click', () => { renderLeaderboard($('#leaderboardList')); show('screen-leaderboard'); });
$('#closeLeaderboardBtn').addEventListener('click', () => show('screen-start'));
$('#backToStartBtn').addEventListener('click', () => show('screen-start'));

// ================================================================
//  RÄUME
// ================================================================
function renderRooms(list) {
  const grid = $('#roomsGrid');
  grid.innerHTML = '';
  for (const r of list) {
    const full = r.count >= r.max;
    const busy = r.status !== 'lobby';
    const div = document.createElement('div');
    div.className = 'room' + (full ? ' full' : '') + (busy ? ' busy' : '');
    div.innerHTML = `
      <h3>${r.name}</h3>
      <div class="meta">${r.count}/${r.max} Spieler</div>
      <span class="badge ${busy ? 'playing' : 'open'}">${busy ? 'Im Spiel' : 'Offen'}</span>`;
    if (!full && !busy) div.addEventListener('click', () => joinRoom(r.id));
    grid.appendChild(div);
  }
}
function joinRoom(roomId) {
  socket.emit('joinRoom', { roomId, name: state.name }, (res) => {
    if (res && res.error) return toast(res.error);
    state.roomId = roomId;
    show('screen-lobby');
  });
}

// ================================================================
//  LOBBY
// ================================================================
function renderLobby(rs) {
  $('#lobbyTitle').textContent = rs.name;
  const ul = $('#lobbyPlayers');
  ul.innerHTML = '';
  for (const p of rs.players) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${p.name}${p.id === myId ? ' <small>(du)</small>' : ''}</span>
      <span>
        ${p.isHost ? '<span class="tag host">Host</span>' : ''}
        <span class="tag ${p.ready ? 'ready' : 'wait'}">${p.ready ? 'Bereit' : 'Wartet'}</span>
      </span>`;
    ul.appendChild(li);
  }
  const me = rs.players.find((p) => p.id === myId);
  const readyBtn = $('#readyBtn');
  if (me) {
    readyBtn.textContent = me.ready ? 'Nicht bereit' : 'Bereit';
    readyBtn.classList.toggle('ready-on', me.ready);
  }
  const allReady = rs.players.length >= rs.minPlayers && rs.players.every((p) => p.ready);
  $('#startBtn').disabled = !(state.isHost && allReady);
  $('#startBtn').style.display = state.isHost ? '' : 'none';
}
$('#readyBtn').addEventListener('click', () => socket.emit('toggleReady'));
$('#startBtn').addEventListener('click', () => socket.emit('startGame'));
$('#leaveLobbyBtn').addEventListener('click', () => { socket.emit('leaveRoom'); state.roomId = null; show('screen-rooms'); });

// ================================================================
//  SPIEL
// ================================================================
function startRoundLocal(round, duration) {
  state.round = round;
  game.scored = {};
  game.roundScore = 0;
  game.submitted = false;
  $('#roundPill').textContent = `Runde ${round}/${state.totalRounds}`;
  renderScore();
  show('screen-game');
  startTurn();            // dreht automatisch
  startTimer(duration);   // Balken laeuft
}

// Neuer Zug: Walzen leeren, dann automatisch drehen.
function startTurn() {
  game.reels = [null, null, null, null, null];
  game.held = [false, false, false, false, false];
  game.spinsDone = 0;
  doSpin();
}

// Einmal drehen (alle nicht-gehaltenen Walzen neu).
function doSpin() {
  for (let i = 0; i < 5; i++) {
    if (!game.held[i]) game.reels[i] = randomSymbol();
  }
  game.spinsDone++;
  renderReels(true);
  updateDraws();
  renderScorecard();
}

function renderReels(animate = false) {
  const wrap = $('#reels');
  wrap.innerHTML = '';
  game.reels.forEach((sym, i) => {
    const el = document.createElement('div');
    el.className = 'reel' + (game.held[i] ? ' held' : '');
    el.innerHTML = symbolEl(sym);
    if (animate && !game.held[i]) el.classList.add('spin');
    el.addEventListener('click', () => toggleHold(i));
    wrap.appendChild(el);
  });
}

// Halten umschalten OHNE Neu-Rendern -> kein kurzes Nachdrehen.
function toggleHold(i) {
  if (game.spinsDone <= 0 || game.spinsDone >= game.maxSpins) return; // kein Draw mehr uebrig
  game.held[i] = !game.held[i];
  $('#reels').children[i].classList.toggle('held', game.held[i]);
}

// Draw-Buttons: zwei getrennte Knoepfe, nacheinander aufgebraucht.
function updateDraws() {
  setDraw($('#draw1'), 1);
  setDraw($('#draw2'), 2);
}
function setDraw(btn, index) {
  const available = game.spinsDone === index; // genau jetzt dran
  const used = game.spinsDone > index;
  btn.disabled = !available;
  btn.classList.toggle('used', used);
  btn.classList.toggle('primary', available);
}
$('#draw1').addEventListener('click', () => { if (game.spinsDone === 1) doSpin(); });
$('#draw2').addEventListener('click', () => { if (game.spinsDone === 2) doSpin(); });

function renderScorecard() {
  const wrap = $('#scorecard');
  wrap.innerHTML = '';
  for (const cat of CATEGORIES) {
    const done = cat.id in game.scored;
    const potential = scoreCategory(cat.id, game.reels);
    const el = document.createElement('div');
    let cls = 'cat';
    if (done) cls += ' done';
    else if (potential > 0) cls += ' available';
    else cls += ' zero';
    el.className = cls;
    const pts = done ? game.scored[cat.id] : potential;
    const icon = cat.symbol
      ? `<span style="width:18px;height:18px;color:${SYMBOL_BY_ID[cat.symbol].color}">${SYMBOL_SVG[cat.symbol]}</span>`
      : '';
    el.innerHTML = `<span class="cat-name">${icon}${cat.name}</span><span class="cat-pts">${pts}</span>`;
    if (!done) el.addEventListener('click', () => assignCategory(cat.id));
    wrap.appendChild(el);
  }
}

function assignCategory(catId) {
  if (catId in game.scored) return;
  const pts = scoreCategory(catId, game.reels);
  game.scored[catId] = pts;
  game.roundScore += pts;
  renderScore();
  if (Object.keys(game.scored).length >= CATEGORIES.length) {
    toast('Alle Kombinationen erfüllt!');
    finishRound();
    return;
  }
  startTurn(); // naechster Zug dreht automatisch
}

function renderScore() {
  $('#roundScorePill').textContent = `${game.roundScore} Pkt`;
}

// -------- Timer als Balken --------
function startTimer(duration) {
  stopTimer();
  game.duration = duration;
  game.endAt = Date.now() + duration * 1000;
  updateTimerBar();
  game.timer = setInterval(updateTimerBar, 200);
}
function stopTimer() { if (game.timer) { clearInterval(game.timer); game.timer = null; } }
function updateTimerBar() {
  const remain = Math.max(0, (game.endAt - Date.now()) / 1000);
  const pct = Math.max(0, Math.min(100, (remain / game.duration) * 100));
  const fill = $('#timerFill');
  fill.style.width = pct + '%';
  fill.classList.toggle('low', remain <= 10);
  if (remain <= 0) { stopTimer(); toast('Zeit abgelaufen!'); finishRound(); }
}

$('#finishRoundBtn').addEventListener('click', () => {
  if (confirm('Runde wirklich beenden?')) finishRound();
});

function finishRound() {
  if (game.submitted) return;
  game.submitted = true;
  stopTimer();
  socket.emit('submitRoundScore', { round: state.round, score: game.roundScore });
  show('screen-wait');
}

// ================================================================
//  ERGEBNISSE / NÄCHSTE RUNDE (beide "Bereit")
// ================================================================
function renderStandings(target, list) {
  target.innerHTML = '';
  list.forEach((p, i) => {
    const li = document.createElement('li');
    const medal = ['🥇', '🥈', '🥉'][i] || (i + 1) + '.';
    li.innerHTML = `<span class="rank">${medal}</span>
      <span class="nm">${p.name}${p.id === myId ? ' (du)' : ''}</span>
      ${p.roundScore != null ? `<span class="delta">+${p.roundScore}</span>` : ''}
      <span class="pts">${p.total}</span>`;
    target.appendChild(li);
  });
}

function renderResultsReady(rs) {
  const ul = $('#resultsReady');
  ul.innerHTML = '';
  for (const p of rs.players) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${p.name}${p.id === myId ? ' (du)' : ''}</span>
      <span class="tag ${p.ready ? 'ready' : 'wait'}">${p.ready ? 'Bereit' : 'Wartet'}</span>`;
    ul.appendChild(li);
  }
  const me = rs.players.find((p) => p.id === myId);
  const btn = $('#readyNextBtn');
  if (me) {
    btn.textContent = me.ready ? 'Nicht bereit' : 'Bereit';
    btn.classList.toggle('ready-on', me.ready);
  }
}
$('#readyNextBtn').addEventListener('click', () => socket.emit('toggleReady'));
$('#backLobbyBtn').addEventListener('click', () => { socket.emit('backToLobby'); show('screen-lobby'); });

function renderLeaderboard(target) {
  target.innerHTML = '';
  if (!state.leaderboard.length) { target.innerHTML = '<li>Noch keine Einträge.</li>'; return; }
  state.leaderboard.forEach((e, i) => {
    const li = document.createElement('li');
    const d = new Date(e.date);
    const ds = `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
    li.innerHTML = `<span>${i+1}. ${e.name}</span><span class="lb-date">${ds}</span><span class="pts">${e.score}</span>`;
    target.appendChild(li);
  });
}

// ================================================================
//  SOCKET-EVENTS
// ================================================================
socket.on('connect', () => { myId = socket.id; });
socket.on('rooms', renderRooms);
socket.on('leaderboard', (lb) => { state.leaderboard = lb; });

socket.on('roomState', (rs) => {
  if (rs.roomId !== state.roomId) return;
  state.totalRounds = rs.totalRounds;
  state.isHost = rs.hostId === myId;
  renderLobby(rs);
  if (rs.status === 'results') renderResultsReady(rs);
  if (rs.status === 'lobby') {
    const cur = document.querySelector('.screen.active').id;
    if (['screen-game', 'screen-wait', 'screen-results', 'screen-final'].includes(cur)) {
      show('screen-lobby');
    }
  }
});

socket.on('roundStart', ({ round, duration, totalRounds }) => {
  state.totalRounds = totalRounds;
  startRoundLocal(round, duration);
});

socket.on('roundResults', ({ round, isLast, standings }) => {
  if (isLast) return; // Finale kommt via gameOver
  $('#resultsTitle').textContent = `Zwischenstand – Runde ${round}/${state.totalRounds}`;
  renderStandings($('#standings'), standings);
  show('screen-results');
});

socket.on('gameOver', ({ standings }) => {
  stopTimer();
  renderStandings($('#finalStandings'), standings.map((s) => ({ ...s, roundScore: null })));
  renderLeaderboard($('#finalLeaderboard'));
  show('screen-final');
});

socket.on('gameAborted', ({ reason }) => {
  stopTimer();
  toast('Spiel abgebrochen: ' + reason);
  show('screen-lobby');
});
