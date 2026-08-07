// ================================================================
//  Keep - Spiel-Kern: Symbole, Kombinationen, Scoring.
//  Glücksspiel-Stil: große Zahlen, weite Streuung, Bonus für Extra-Symbole.
//  Der Serien-/Multiplikator-Bonus wird in app.js oben draufgerechnet.
// ================================================================

// Symbol-Wertigkeit (Tier). Weit gestreut: Herz ist Premium.
export const SYMBOLS = [
  { id: 'kleeblatt', name: 'Kleeblatt', value: 1,  color: '#3ec46d' },
  { id: 'hufeisen',  name: 'Hufeisen',  value: 2,  color: '#c9cdd6' },
  { id: 'halbmond',  name: 'Halbmond',  value: 3,  color: '#5bc8f5' },
  { id: 'stern',     name: 'Stern',     value: 5,  color: '#f5c542' },
  { id: 'krone',     name: 'Krone',     value: 8,  color: '#b57bff' },
  { id: 'herz',      name: 'Herz',      value: 12, color: '#ff5d6c' },
];
export const SYMBOL_BY_ID = Object.fromEntries(SYMBOLS.map((s) => [s.id, s]));

// Grundwerte je Kombination (bewusst groß für den "Jackpot"-Effekt).
export const BASE = {
  pairUnit: 300,          // Zweierpaar:   300 × Symbolwert
  threeUnit: 1000,        // 3× Symbol:    1000 × Wert × (Anzahl-2)  -> mehr Symbole = mehr Punkte
  fhTriple: 5000,         // Full House:   5000 × Wert(Drilling)
  fhPair: 1500,           //             + 1500 × Wert(Paar)
  fiveDiffFlat: 15000,    // 5 Versch.:    15000 + 1000 × Summe der Werte
  fiveDiffUnit: 1000,
  fourUnit: 20000,        // Vierling:     20000 × Wert × (Anzahl-3)
  fiveUnit: 60000,        // Fünfling:     60000 × Wert
  jokerUnit: 4000,        // Joker:        4000 × Summe (nur mit mind. einem Paar)
};

// Muster (pattern) = wie die Kombination auf der Tafel gezeigt wird.
// Neutrale Formen: q=Viereck, k=Kreis, t=Dreieck, d=Raute, p=Fünfeck, '+'=Trenner.
// Bei "3× Symbol" wird das echte Symbol dreimal gezeigt.
export const CATEGORIES = [
  ...SYMBOLS.map((s) => ({
    id: 'three_' + s.id, name: '3× ' + s.name, type: 'threeSymbol', symbol: s.id,
    pattern: [s.id, s.id, s.id],
  })),
  { id: 'pair',          name: 'Zweierpaar',     type: 'pair',          pattern: ['q', 'q'] },
  { id: 'fullhouse',     name: 'Full House',      type: 'fullhouse',     pattern: ['q', 'q', 'q', '+', 'k', 'k'] },
  { id: 'fivedifferent', name: '5 Verschiedene',  type: 'fivedifferent', pattern: ['q', 'k', 't', 'd', 'p'] },
  { id: 'four',          name: 'Vierling',        type: 'nOfKind', n: 4, pattern: ['q', 'q', 'q', 'q'] },
  { id: 'five',          name: 'Fünfling',        type: 'nOfKind', n: 5, pattern: ['q', 'q', 'q', 'q', 'q'] },
  { id: 'joker',         name: 'Joker',           type: 'joker',         pattern: ['joker'] },
];
export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

function counts(reels) {
  const c = {};
  for (const r of reels) c[r] = (c[r] || 0) + 1;
  return c;
}
function val(id) { return SYMBOL_BY_ID[id].value; }

// Grundpunkte einer Kombination bei gegebenen Walzen (0 = ungültig/Fehlwurf).
export function scoreCategory(categoryId, reels) {
  const cat = CATEGORY_BY_ID[categoryId];
  if (!cat || !reels || reels.length !== 5) return 0;
  const c = counts(reels);

  switch (cat.type) {
    case 'threeSymbol': {
      const n = c[cat.symbol] || 0;
      if (n < 3) return 0;
      // Mehr als 3 gleiche in dieser Kategorie -> deutlich mehr Punkte.
      return BASE.threeUnit * val(cat.symbol) * (n - 2);
    }
    case 'pair': {
      let best = 0;
      for (const [sym, n] of Object.entries(c)) if (n >= 2) best = Math.max(best, val(sym));
      return best ? BASE.pairUnit * best : 0;
    }
    case 'fullhouse': {
      let triple = null, pair = null;
      for (const [sym, n] of Object.entries(c)) if (n >= 3 && (triple === null || val(sym) > val(triple))) triple = sym;
      if (!triple) return 0;
      for (const [sym, n] of Object.entries(c)) {
        if (sym === triple) continue;
        if (n >= 2 && (pair === null || val(sym) > val(pair))) pair = sym;
      }
      if (!pair) return 0;
      return BASE.fhTriple * val(triple) + BASE.fhPair * val(pair);
    }
    case 'fivedifferent': {
      if (Object.keys(c).length !== 5) return 0;
      return BASE.fiveDiffFlat + BASE.fiveDiffUnit * reels.reduce((s, r) => s + val(r), 0);
    }
    case 'nOfKind': {
      let bestSym = null;
      for (const [sym, n] of Object.entries(c)) {
        if (n >= cat.n && (bestSym === null || val(sym) > val(bestSym))) bestSym = sym;
      }
      if (!bestSym) return 0;
      if (cat.n >= 5) return BASE.fiveUnit * val(bestSym);
      const n = c[bestSym];
      return BASE.fourUnit * val(bestSym) * (n - 3); // 5 gleiche hier = doppelt
    }
    case 'joker': {
      // Nur mit mindestens einem Paar wertbar -> kann auch mal 0 sein (Fehlwurf).
      const hasPair = Object.values(c).some((n) => n >= 2);
      if (!hasPair) return 0;
      return BASE.jokerUnit * reels.reduce((s, r) => s + val(r), 0);
    }
    default:
      return 0;
  }
}

export function randomSymbol() {
  return SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)].id;
}
