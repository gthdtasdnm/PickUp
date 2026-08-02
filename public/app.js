import { SYMBOLS, SYMBOL_BY_ID, CATEGORIES, scoreCategory, randomSymbol } from './game-core.js';
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

// Runden-Status (lokal)
const game = {
  reels: [null, null, null, null, null],
  held: [false, false, false, false, false],
  rollsMax: 3,
  rollsLeft: 3,
  hasRolled: false,
  scored: {},        // categoryId -> Punkte
  roundScore: 0,
  remaining: 0,
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
  let allReady = true;
  for (const p of rs.players) {
    if (!p.ready) allReady = false;
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
  const canStart = state.isHost && allReady && rs.players.length >= rs.minPlayers;
  $('#startBtn').disabled = !canStart;
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
  game.remaining = duration;
  startTurn();
  $('#roundPill').textContent = `Runde ${round}/${state.totalRounds}`;
  renderScore();
  renderScorecard();
  show('screen-game');
  startTimer();
}

function startTurn() {
  game.reels = [null, null, null, null, null];
  game.held = [false, false, false, false, false];
  game.rollsLeft = game.rollsMax;
  game.hasRolled = false;
  renderReels();
  updateRollBtn();
  renderScorecard();
}

function renderReels() {
  const wrap = $('#reels');
  wrap.innerHTML = '';
  game.reels.forEach((sym, i) => {
    const el = document.createElement('div');
    el.className = 'reel' + (sym ? '' : ' empty') + (game.held[i] ? ' held' : '');
    if (sym) { el.innerHTML = symbolEl(sym); el.classList.add('spin'); }
    else el.innerHTML = SYMBOL_SVG.stern; // Platzhalter (ausgegraut via .empty)
    el.addEventListener('click', () => toggleHold(i));
    wrap.appendChild(el);
  });
}

function toggleHold(i) {
  if (!game.hasRolled || game.rollsLeft <= 0 || !game.reels[i]) return;
  game.held[i] = !game.held[i];
  renderReels();
}

function updateRollBtn() {
  const btn = $('#rollBtn');
  const info = $('#rollsInfo');
  if (game.rollsLeft <= 0) {
    btn.disabled = true;
    btn.textContent = 'Keine Würfe mehr';
    info.textContent = 'Wähle eine Kombination';
  } else {
    btn.disabled = false;
    btn.textContent = game.hasRolled ? 'Nochmal drehen' : 'Drehen';
    info.textContent = `${game.rollsLeft} ${game.rollsLeft === 1 ? 'Wurf' : 'Würfe'} übrig`;
  }
}

$('#rollBtn').addEventListener('click', roll);
function roll() {
  if (game.rollsLeft <= 0) return;
  for (let i = 0; i < 5; i++) {
    if (!game.held[i]) game.reels[i] = randomSymbol();
  }
  game.hasRolled = true;
  game.rollsLeft--;
  renderReels();
  updateRollBtn();
  renderScorecard();
}

function renderScorecard() {
  const wrap = $('#scorecard');
  wrap.innerHTML = '';
  for (const cat of CATEGORIES) {
    const done = cat.id in game.scored;
    const potential = game.hasRolled ? scoreCategory(cat.id, game.reels) : 0;
    const el = document.createElement('div');
    let cls = 'cat';
    if (done) cls += ' done';
    else if (game.hasRolled && potential > 0) cls += ' available';
    else cls += ' zero';
    el.className = cls;
    const icon = cat.symbol ? symbolEl(cat.symbol).replace(/width:100%;height:100%/, 'width:18px;height:18px') : '';
    const pts = done ? game.scored[cat.id] : (game.hasRolled ? potential : '–');
    el.innerHTML = `<span class="cat-name">${cat.symbol ? `<span style="width:18px;height:18px;color:${SYMBOL_BY_ID[cat.symbol].color}">${SYMBOL_SVG[cat.symbol]}</span>` : ''}${cat.name}</span><span class="cat-pts">${pts}</span>`;
    if (!done) el.addEventListener('click', () => assignCategory(cat.id));
    wrap.appendChild(el);
  }
}

function assignCategory(catId) {
  if (!game.hasRolled || catId in game.scored) return;
  const pts = scoreCategory(catId, game.reels);
  game.scored[catId] = pts;
  game.roundScore += pts;
  renderScore();
  if (Object.keys(game.scored).length >= CATEGORIES.length) {
    toast('Alle Kombinationen erfüllt!');
    finishRound();
    return;
  }
  startTurn();
}

function renderScore() {
  $('#roundScorePill').textContent = `${game.roundScore} Pkt`;
}

// -------- Timer --------
function startTimer() {
  stopTimer();
  renderTimer();
  game.timer = setInterval(() => {
    game.remaining--;
    renderTimer();
    if (game.remaining <= 0) { toast('Zeit abgelaufen!'); finishRound(); }
  }, 1000);
}
function stopTimer() { if (game.timer) { clearInterval(game.timer); game.timer = null; } }
function renderTimer() {
  const m = Math.floor(Math.max(0, game.remaining) / 60);
  const s = Math.max(0, game.remaining) % 60;
  const el = $('#timer');
  el.textContent = `${m}:${String(s).padStart(2, '0')}`;
  el.classList.toggle('low', game.remaining <= 10);
}

$('#finishRoundBtn').addEventListener('click', () => {
  if (confirm('Runde wirklich vorzeitig beenden?')) finishRound();
});

function finishRound() {
  if (game.submitted) return;
  game.submitted = true;
  stopTimer();
  socket.emit('submitRoundScore', { round: state.round, score: game.roundScore });
  show('screen-wait');
}

// ================================================================
//  ERGEBNISSE
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

$('#nextRoundBtn').addEventListener('click', () => socket.emit('nextRound'));
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
  // Zurueck in die Lobby (Spielende/Abbruch)
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
  $('#nextRoundBtn').style.display = state.isHost ? '' : 'none';
  $('#waitHostHint').hidden = state.isHost;
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
