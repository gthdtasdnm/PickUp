// Einfacher Datei-basierter Speicher fuer das Leaderboard.
// Bewusst ohne DB/native Dependency -> laeuft ohne Build auf jedem Server.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'leaderboard.json');
const MAX_ENTRIES = 100;

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, '[]', 'utf8');
}

export function getLeaderboard(limit = 20) {
  ensure();
  try {
    const all = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return all
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch {
    return [];
  }
}

export function addLeaderboardEntry(name, score) {
  ensure();
  let all = [];
  try { all = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { all = []; }
  all.push({
    name: String(name).slice(0, 20),
    score: Number(score) || 0,
    date: new Date().toISOString(),
  });
  all.sort((a, b) => b.score - a.score);
  all = all.slice(0, MAX_ENTRIES);
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2), 'utf8');
  return all;
}
