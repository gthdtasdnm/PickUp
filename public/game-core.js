// ================================================================
//  PickUp - Spiel-Kern: Symbole, Kombinationen und Scoring.
//  Einzige Quelle der Wahrheit fuer die Punkteberechnung (Client).
//  Alles hier ist bewusst als Config gehalten -> leicht anpassbar.
// ================================================================

// Symbol-Wertigkeit: Herz gibt am meisten, Kleeblatt am wenigsten.
export const SYMBOLS = [
  { id: 'kleeblatt', name: 'Kleeblatt', value: 1, color: '#3ec46d' },
  { id: 'hufeisen',  name: 'Hufeisen',  value: 2, color: '#c9cdd6' },
  { id: 'halbmond',  name: 'Halbmond',  value: 3, color: '#5bc8f5' },
  { id: 'stern',     name: 'Stern',     value: 4, color: '#f5c542' },
  { id: 'krone',     name: 'Krone',     value: 5, color: '#b57bff' },
  { id: 'herz',      name: 'Herz',      value: 6, color: '#ff5d6c' },
];

export const SYMBOL_BY_ID = Object.fromEntries(SYMBOLS.map((s) => [s.id, s]));

// Grundpunkte je Kombinations-Typ. Symbol-Werte kommen oben drauf.
export const BASE = {
  threeSymbol: 20,   // "3x <Symbol>"
  pair: 10,          // Zweierpaar
  fullhouse: 40,     // Full House (3 + 2)
  fivedifferent: 30, // 5 verschiedene Symbole
  four: 60,          // Vierling (4 gleiche)
  five: 100,         // Fuenfling (5 gleiche)
  joker: 25,         // Joker - immer wertbar (Sicherheitsnetz)
};

// Reihenfolge der Kombinationen auf der Wertungstafel.
export const CATEGORIES = [
  ...SYMBOLS.map((s) => ({
    id: 'three_' + s.id,
    name: '3× ' + s.name,
    type: 'threeSymbol',
    symbol: s.id,
  })),
  { id: 'pair',          name: 'Zweierpaar',        type: 'pair' },
  { id: 'fullhouse',     name: 'Full House',        type: 'fullhouse' },
  { id: 'fivedifferent', name: '5 Verschiedene',    type: 'fivedifferent' },
  { id: 'four',          name: 'Vierling (4 gleiche)', type: 'nOfKind', n: 4 },
  { id: 'five',          name: 'Fünfling (5 gleiche)', type: 'nOfKind', n: 5 },
  { id: 'joker',         name: 'Joker',             type: 'joker' },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

function counts(reels) {
  const c = {};
  for (const r of reels) c[r] = (c[r] || 0) + 1;
  return c;
}
function val(id) { return SYMBOL_BY_ID[id].value; }

// Liefert die Punkte fuer eine Kombination bei gegebenen Walzen (0 = ungueltig).
export function scoreCategory(categoryId, reels) {
  const cat = CATEGORY_BY_ID[categoryId];
  if (!cat || !reels || reels.length !== 5) return 0;
  const c = counts(reels);

  switch (cat.type) {
    case 'threeSymbol': {
      const n = c[cat.symbol] || 0;
      if (n < 3) return 0;
      return BASE.threeSymbol + n * val(cat.symbol);
    }
    case 'pair': {
      // bestes Paar (hoechster Symbolwert mit >= 2)
      let best = 0;
      for (const [sym, n] of Object.entries(c)) {
        if (n >= 2) best = Math.max(best, val(sym));
      }
      if (!best) return 0;
      return BASE.pair + 2 * best;
    }
    case 'fullhouse': {
      let triple = null, pair = null;
      // hoechstwertiges Triple
      for (const [sym, n] of Object.entries(c)) {
        if (n >= 3 && (triple === null || val(sym) > val(triple))) triple = sym;
      }
      if (!triple) return 0;
      // hoechstwertiges Paar aus einem anderen Symbol
      for (const [sym, n] of Object.entries(c)) {
        if (sym === triple) continue;
        if (n >= 2 && (pair === null || val(sym) > val(pair))) pair = sym;
      }
      if (!pair) return 0;
      return BASE.fullhouse + 3 * val(triple) + 2 * val(pair);
    }
    case 'fivedifferent': {
      if (Object.keys(c).length !== 5) return 0;
      return BASE.fivedifferent + reels.reduce((s, r) => s + val(r), 0);
    }
    case 'nOfKind': {
      let best = 0;
      for (const [sym, n] of Object.entries(c)) {
        if (n >= cat.n) best = Math.max(best, val(sym));
      }
      if (!best) return 0;
      const base = cat.n >= 5 ? BASE.five : BASE.four;
      return base + cat.n * best;
    }
    case 'joker': {
      // Immer wertbar: Grundwert + hoechster Walzenwert.
      return BASE.joker + Math.max(...reels.map(val));
    }
    default:
      return 0;
  }
}

// Zufaellige Walze
export function randomSymbol() {
  return SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)].id;
}
