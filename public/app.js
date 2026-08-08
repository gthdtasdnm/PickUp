import { SYMBOL_BY_ID, CATEGORIES, scoreCategory, randomSymbol } from './game-core.js';
import { SYMBOL_SVG, SHAPE_SVG, SHAPE_COLOR } from './symbols.js';

// Basis-Pfad der Seite: "/" lokal, "/keep/" hinter dem Apache-Reverse-Proxy.
// So funktioniert Socket.IO ohne feste Pfad-Annahme in beiden Fällen.
const BASE = location.pathname.replace(/[^/]*$/, '');
const socket = io({ path: BASE + 'socket.io' });
const fmt = (n) => Math.round(n).toLocaleString('de-DE');

// ---------------- Identität und Sitzung ----------------
// Die Spieler-ID hängt am Tab, nicht am Gerät: ein Reload oder ein
// Verbindungsabbruch führt zurück an den Platz, zwei Fenster sind aber zwei
// Spieler. Eigene Schlüssel je Spiel – alle vier liegen unter derselben Domain
// und teilen sich damit den Speicher.
const PID_KEY = 'pu_pid';
const ROOM_KEY = 'pu_room';

const store = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* Privatmodus */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch { /* Privatmodus */ } },
};

function ownId() {
  let id = store.get(PID_KEY);
  if (!id) {
    id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    store.set(PID_KEY, id);
  }
  return id;
}

let myId = ownId();
const rememberRoom = (id) => store.set(ROOM_KEY, id);
const forgetRoom = () => store.del(ROOM_KEY);

// ---------------- App-Status ----------------
const state = { name: '', roomId: null, isHost: false, round: 0, totalRounds: 5, leaderboard: [] };

// Runden-Status (lokal). spinsDone: 1 = Auto-Dreh, 2/3 = nach den Draws.
const game = {
  reels: [null, null, null, null, null],
  held: [false, false, false, false, false],
  maxSpins: 3,
  spinsDone: 0,
  scored: {},        // categoryId -> Punkte
  roundScore: 0,
  combos: 0,         // gewertete Kombinationen -> Serien-Multiplikator
  duration: 0,
  endAt: 0,
  timer: null,
  submitted: false,
};

// Serien-Multiplikator: eskaliert, je mehr Kombis man ohne Fehlwurf schafft.
function multiplierFor(combos) {
  if (combos >= 8) return 5;
  if (combos >= 6) return 4;
  if (combos >= 4) return 3;
  if (combos >= 3) return 2;
  if (combos >= 2) return 1.5;
  if (combos >= 1) return 1.2;
  return 1;
}

// ---------------- Helfer ----------------
const $ = (sel) => document.querySelector(sel);
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $('#' + id).classList.add('active');
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2000);
}
function celebrate(text) {
  const c = $('#celebrate');
  c.innerHTML = `<div class="burst">${text}</div>`;
  c.classList.remove('show'); void c.offsetWidth; c.classList.add('show');
  const app = $('#app'); app.classList.remove('flash'); void app.offsetWidth; app.classList.add('flash');
}
function symbolEl(id) {
  const s = SYMBOL_BY_ID[id];
  return `<span style="color:${s.color};display:flex;width:100%;height:100%;align-items:center;justify-content:center">${SYMBOL_SVG[id]}</span>`;
}
function renderPattern(tokens) {
  return '<span class="pat">' + tokens.map((tok) => {
    if (tok === '+') return '<span class="pat-plus">+</span>';
    if (SYMBOL_BY_ID[tok]) return `<span class="pat-ic" style="color:${SYMBOL_BY_ID[tok].color}">${SYMBOL_SVG[tok]}</span>`;
    return `<span class="pat-ic" style="color:${SHAPE_COLOR[tok] || '#9aa0c8'}">${SHAPE_SVG[tok] || ''}</span>`;
  }).join('') + '</span>';
}

// ================================================================
//  START / NAME / RÄUME / LOBBY  (unverändert)
// ================================================================
const NAME_KEY = 'spiele_name';   // gemeinsam mit den anderen drei Spielen

// Sitzplatz-Tierchen. Gleiche Liste und gleiche Ableitung in allen vier
// Spielen, damit dieselbe Person überall dasselbe Zeichen bekommt.
const AVATARS = ['🦊', '🐙', '🦅', '🐺', '🦁', '🐉'];
const avatarFor = (id) =>
  AVATARS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATARS.length];

const esc = (s) => String(s).replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

$('#nameInput').value = localStorage.getItem(NAME_KEY) || '';

let visibility = 'public';
for (const b of document.querySelectorAll('[data-vis]')) {
  b.addEventListener('click', () => {
    visibility = b.dataset.vis;
    document.querySelectorAll('[data-vis]').forEach((x) => x.classList.toggle('sel', x === b));
  });
}

/** Namen einsammeln und merken. Gibt null zurück, wenn keiner dasteht. */
function playerName() {
  const name = $('#nameInput').value.trim();
  if (!name) { $('#nameInput').focus(); toast('Bitte gib einen Namen ein.'); return null; }
  state.name = name;
  localStorage.setItem(NAME_KEY, name);
  return name;
}

$('#createBtn').addEventListener('click', () => {
  const name = playerName();
  if (!name) return;
  socket.emit('createRoom', { name, isPublic: visibility === 'public' }, (res) => {
    if (res && res.error) return toast(res.error);
    state.roomId = res.roomId;
    rememberRoom(res.roomId);
    show('screen-lobby');
  });
});

function joinByCode() {
  const code = $('#codeInput').value.toUpperCase().trim();
  if (code.length !== 4) { $('#codeInput').focus(); return toast('Der Code hat vier Zeichen.'); }
  const name = playerName();
  if (name) joinRoom(code);
}
$('#joinBtn').addEventListener('click', joinByCode);
$('#codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinByCode(); });
$('#nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#createBtn').click(); });

$('#showLeaderboardBtn').addEventListener('click', () => { renderLeaderboard($('#leaderboardList')); show('screen-leaderboard'); });
$('#closeLeaderboardBtn').addEventListener('click', () => show('screen-start'));

$('#copyBtn').addEventListener('click', async () => {
  if (!state.roomId) return;
  // Gegen document.baseURI gebaut: funktioniert unter /keep/ hinter dem
  // Reverse Proxy genauso wie lokal auf localhost:3000.
  const link = new URL('#' + state.roomId, document.baseURI).href;
  try {
    await navigator.clipboard.writeText(link);
    toast('Link kopiert – schick ihn rum.');
  } catch {
    // Ohne Zwischenablage (kein HTTPS, alter Browser) wenigstens den Code zeigen.
    toast(`Code: ${state.roomId}`);
  }
});

function renderRooms(list) {
  const box = $('#roomsGrid');
  box.innerHTML = '';
  $('#roomsCount').textContent = list.length ? `(${list.length})` : '';
  if (!list.length) {
    box.innerHTML =
      '<div class="rooms-empty">Gerade ist kein Raum offen. Eröffne einen – ' +
      'er erscheint dann bei den anderen in der Liste.</div>';
    return;
  }
  for (const r of list) {
    const b = document.createElement('button');
    b.className = 'roomrow';
    b.innerHTML = `
      <span class="roomrow-name">${esc(r.host)}</span>
      <span class="roomrow-meta">${r.count}/${r.max} Spieler</span>
      <span class="roomrow-code">${r.id}</span>`;
    b.addEventListener('click', () => { if (playerName()) joinRoom(r.id); });
    box.appendChild(b);
  }
}

function joinRoom(roomId) {
  socket.emit('joinRoom', { roomId, name: state.name }, (res) => {
    if (res && res.error) return toast(res.error);
    state.roomId = res.roomId;
    rememberRoom(res.roomId);
    show('screen-lobby');
  });
}

function renderLobby(rs) {
  $('#lobbyTitle').textContent = rs.name;
  $('#roomCode').textContent = rs.roomId;
  $('#roomVis').textContent = rs.isPublic
    ? 'Öffentlich – steht in der Liste'
    : 'Privat – nur mit Code';

  const box = $('#lobbyPlayers');
  box.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const p = rs.players[i];
    const d = document.createElement('div');
    if (!p) {
      d.className = 'seat empty';
      d.innerHTML = '<div class="av">🪑</div><div class="nm">frei</div><div class="st">wartet</div>';
    } else {
      d.className = 'seat' + (p.ready || p.isHost ? ' ready' : '') + (p.online ? '' : ' off');
      d.innerHTML = `
        <div class="av">${avatarFor(p.id)}</div>
        <div class="nm">${esc(p.name)}${p.id === myId ? ' (du)' : ''}</div>
        <div class="st">${!p.online ? 'weg' : p.isHost ? 'startet' : p.ready ? '✓ bereit' : 'wartet'}</div>
        ${p.isHost ? '<div class="host">HOST</div>' : ''}`;
    }
    box.appendChild(d);
  }

  const me = rs.players.find((p) => p.id === myId);
  const readyBtn = $('#readyBtn');
  if (me) {
    readyBtn.textContent = me.ready ? '✓ Bereit' : 'Bereit';
    readyBtn.classList.toggle('on', me.ready);
  }
  // Der Host hat hier keinen Bereit-Knopf (er startet ja), also zaehlt er als bereit.
  // Wer gerade weg ist, zählt nicht mit – sonst blockiert er den Start.
  const online = rs.players.filter((p) => p.online);
  const allReady = online.length >= rs.minPlayers
    && online.every((p) => p.ready || p.isHost);
  $('#startBtn').disabled = !(state.isHost && allReady);
  $('#startBtn').style.display = state.isHost ? '' : 'none';
  $('#readyBtn').style.display = state.isHost ? 'none' : '';
}
$('#readyBtn').addEventListener('click', () => socket.emit('toggleReady'));
$('#startBtn').addEventListener('click', () => socket.emit('startGame'));
$('#leaveLobbyBtn').addEventListener('click', () => {
  socket.emit('leaveRoom');
  state.roomId = null;
  forgetRoom();
  // Den Code aus der Adresse nehmen, sonst führt ein Neuladen wieder hinein.
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  show('screen-start');
});

// ================================================================
//  SPIEL
// ================================================================
function startRoundLocal(round, duration) {
  state.round = round;
  game.scored = {}; game.roundScore = 0; game.combos = 0; game.submitted = false;
  $('#roundPill').textContent = `Runde ${round}/${state.totalRounds}`;
  renderScore(); updateMult();
  show('screen-game');
  startTurn();
  startTimer(duration);
}

function startTurn() {
  game.reels = [null, null, null, null, null];
  game.held = [false, false, false, false, false];
  game.spinsDone = 0;
  doSpin();
}

function doSpin() {
  for (let i = 0; i < 5; i++) if (!game.held[i]) game.reels[i] = randomSymbol();
  game.spinsDone++;
  renderReels(true); updateDraws(); renderScorecard();
  if (game.spinsDone >= game.maxSpins) checkBust();
}

// Nach dem letzten Draw: gibt es keine gültige Kombination mehr -> Runde vorbei.
function checkBust() {
  const anyValid = CATEGORIES.some((c) => !(c.id in game.scored) && scoreCategory(c.id, game.reels) > 0);
  if (!anyValid) {
    setTimeout(() => {
      if (game.submitted) return;
      celebrate('💥 Kein Treffer');
      toast('Keine Kombination – Runde vorbei');
      finishRound();
    }, 750);
  }
}

function renderReels(animate = false) {
  const wrap = $('#reels'); wrap.innerHTML = '';
  game.reels.forEach((sym, i) => {
    const el = document.createElement('div');
    el.className = 'reel' + (game.held[i] ? ' held' : '');
    el.innerHTML = symbolEl(sym);
    if (animate && !game.held[i]) el.classList.add('spin');
    el.addEventListener('click', () => toggleHold(i));
    wrap.appendChild(el);
  });
}
function toggleHold(i) {
  if (game.spinsDone <= 0 || game.spinsDone >= game.maxSpins) return;
  game.held[i] = !game.held[i];
  $('#reels').children[i].classList.toggle('held', game.held[i]);
}

function updateDraws() { setDraw($('#draw1'), 1); setDraw($('#draw2'), 2); }
function setDraw(btn, index) {
  const available = game.spinsDone === index;
  btn.disabled = !available;
  btn.classList.toggle('used', game.spinsDone > index);
  btn.classList.toggle('primary', available);
}
$('#draw1').addEventListener('click', () => { if (game.spinsDone === 1) doSpin(); });
$('#draw2').addEventListener('click', () => { if (game.spinsDone === 2) doSpin(); });

function renderScorecard() {
  const mult = multiplierFor(game.combos);
  const wrap = $('#scorecard'); wrap.innerHTML = '';
  for (const cat of CATEGORIES) {
    const done = cat.id in game.scored;
    const base = scoreCategory(cat.id, game.reels);
    const el = document.createElement('div');
    let cls = 'cat';
    if (done) cls += ' done';
    else if (base > 0) cls += ' available';
    else cls += ' zero';
    el.className = cls;
    el.title = cat.name;
    const ptsText = done ? fmt(game.scored[cat.id]) : (base > 0 ? fmt(base * mult) : '—');
    el.innerHTML = `<span class="cat-name">${renderPattern(cat.pattern)}</span><span class="cat-pts">${ptsText}</span>`;
    if (!done && base > 0) el.addEventListener('click', () => assignCategory(cat.id));
    wrap.appendChild(el);
  }
}

function assignCategory(catId) {
  if (catId in game.scored) return;
  const base = scoreCategory(catId, game.reels);
  if (base <= 0) return; // 0-Kombinationen sind nicht wählbar
  const mult = multiplierFor(game.combos);
  const pts = Math.round(base * mult);
  game.scored[catId] = pts;
  game.roundScore += pts;
  game.combos += 1;
  renderScore();

  // Erfolgserlebnis je nach Höhe
  if (pts >= 150000) celebrate('💰 JACKPOT!');
  else if (pts >= 50000) celebrate('🔥 Riesentreffer!');
  else if (pts >= 15000) celebrate('✨ Super!');

  const newMult = multiplierFor(game.combos);
  if (newMult > mult) toast(`🔥 Serie ×${newMult}!`);
  updateMult();

  if (Object.keys(game.scored).length >= CATEGORIES.length) {
    celebrate('🏆 Alles voll!');
    finishRound();
    return;
  }
  startTurn();
}

function renderScore() { $('#roundScorePill').textContent = fmt(game.roundScore); }
function updateMult() {
  const m = multiplierFor(game.combos);
  const pill = $('#multPill');
  pill.textContent = '×' + m;
  pill.classList.toggle('hot', m >= 2);
  pill.classList.remove('bump'); void pill.offsetWidth; pill.classList.add('bump');
}

// -------- Timer als Balken --------
function startTimer(duration) {
  stopTimer();
  game.duration = duration; game.endAt = Date.now() + duration * 1000;
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
      <span class="nm">${esc(p.name)}${p.id === myId ? ' (du)' : ''}</span>
      ${p.roundScore != null ? `<span class="delta">+${fmt(p.roundScore)}</span>` : ''}
      <span class="pts">${fmt(p.total)}</span>`;
    target.appendChild(li);
  });
}
function renderResultsReady(rs) {
  const ul = $('#resultsReady'); ul.innerHTML = '';
  for (const p of rs.players) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${esc(p.name)}${p.id === myId ? ' (du)' : ''}</span>
      <span class="tag ${p.ready ? 'ready' : 'wait'}">${p.ready ? 'Bereit' : 'Wartet'}</span>`;
    ul.appendChild(li);
  }
  const me = rs.players.find((p) => p.id === myId);
  const btn = $('#readyNextBtn');
  if (me) { btn.textContent = me.ready ? 'Nicht bereit' : 'Bereit'; btn.classList.toggle('ready-on', me.ready); }
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
    li.innerHTML = `<span>${i+1}. ${esc(e.name)}</span><span class="lb-date">${ds}</span><span class="pts">${fmt(e.score)}</span>`;
    target.appendChild(li);
  });
}

// ================================================================
//  SOCKET-EVENTS
// ================================================================
socket.on('connect', () => {
  // Erst die eigene ID anmelden, dann fragen, ob der alte Platz noch steht.
  socket.emit('hello', { pid: myId }, (res) => {
    if (res && res.pid) myId = res.pid;
    const back = store.get(ROOM_KEY);
    if (!back) return openShared();
    socket.emit('resume', { roomId: back }, (r) => {
      if (!r || r.error) { forgetRoom(); return openShared(); }
      state.roomId = r.roomId;
      state.totalRounds = r.totalRounds || state.totalRounds;
      backToScreen(r);
    });
  });
});

socket.on('disconnect', () => toast('Verbindung weg – versuche neu …'));

/**
 * Nach einem Verbindungsabbruch wieder auf dem richtigen Bildschirm landen.
 * Ohne das steht man auf der Startseite, obwohl man längst wieder im Raum sitzt.
 */
function backToScreen(r) {
  if (r.status === 'results') {
    $('#resultsTitle').textContent = `Zwischenstand – Runde ${r.round}/${state.totalRounds}`;
    renderStandings($('#standings'), r.standings || []);
    show('screen-results');
    return;
  }
  if (r.status === 'finished') {
    renderStandings($('#finalStandings'), (r.standings || []).map((s) => ({ ...s, roundScore: null })));
    renderLeaderboard($('#finalLeaderboard'));
    show('screen-final');
    return;
  }
  if (r.status === 'playing') {
    // Nur die Verbindung war weg, die Seite läuft noch? Dann einfach weiterspielen.
    if (!game.submitted && game.timer && state.round === r.round) return;
    // Sonst ist der lokale Rundenstand futsch (Reload). Diese Runde mit 0
    // abgeben, statt die anderen bis zum Ablauf des Timers warten zu lassen.
    state.round = r.round;
    game.submitted = true;
    stopTimer();
    socket.emit('submitRoundScore', { round: r.round, score: 0 });
    toast('Runde verpasst – ab der nächsten bist du wieder dabei.');
    show('screen-wait');
    return;
  }
  show('screen-lobby');
}

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
    if (['screen-game', 'screen-wait', 'screen-results', 'screen-final'].includes(cur)) show('screen-lobby');
  }
});
socket.on('roundStart', ({ round, duration, totalRounds }) => {
  state.totalRounds = totalRounds; startRoundLocal(round, duration);
});
socket.on('roundResults', ({ round, isLast, standings }) => {
  if (isLast) return;
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
  stopTimer(); toast('Spiel abgebrochen: ' + reason); show('screen-lobby');
});

// ================================================================
//  GETEILTER LINK
// ================================================================
// .../keep/#AB3K – der Link ist die ganze Interaktion. Wer ihn öffnet, soll
// im Raum landen und nicht auf einer Startseite, auf der er den Raum erst
// suchen muss. Ist der Name schon bekannt, passiert das ohne einen Klick.
const shared = (location.hash || '').replace('#', '').toUpperCase().trim();
const sharedCode = /^[A-Z0-9]{4}$/.test(shared) ? shared : null;

/** Startseite auf „du bist eingeladen" umstellen: eine Frage, ein Knopf. */
function invitationMode() {
  if (!sharedCode) return;
  $('#codeInput').value = sharedCode;
  $('#screen-start .tag').textContent = `Du bist eingeladen – Raum ${sharedCode}.`;

  // Den Knopf austauschen statt umbeschriften: sonst bliebe der alte
  // Klick-Handler dran und würde zusätzlich einen neuen Raum aufmachen.
  const alt = $('#createBtn');
  const btn = alt.cloneNode(true);
  btn.textContent = 'Beitreten';
  alt.replaceWith(btn);
  btn.addEventListener('click', () => { if (playerName()) joinRoom(sharedCode); });
}

/** Name schon bekannt? Dann direkt rein, ohne Zwischenschritt. */
function openShared() {
  if (!sharedCode || state.roomId) return;
  const name = (localStorage.getItem(NAME_KEY) || '').trim();
  if (!name) { $('#nameInput').focus(); return; }
  $('#nameInput').value = name;
  state.name = name;
  joinRoom(sharedCode);
}

invitationMode();
