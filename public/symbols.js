// SVG-Grafiken der Symbole. Farbe kommt aus game-core (SYMBOLS[].color).
export const SYMBOL_SVG = {
  herz: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`,
  stern: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.9 7.1.6-5.4 4.7 1.7 7L12 17.9 5.7 21.2l1.7-7L2 9.5l7.1-.6z"/></svg>`,
  krone: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.4 16.2l-1.2-9.4 5.7 4L12 3.3l5.1 7.5 5.7-4-1.2 9.4zM4 17.9h16v2.7H4z"/></svg>`,
  halbmond: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.35 2.58a9.5 9.5 0 1 0 0 18.84A9.5 9.5 0 0 1 17.35 2.58z"/></svg>`,
  kleeblatt: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="7.5" r="3.4"/><circle cx="7.8" cy="11.7" r="3.4"/><circle cx="16.2" cy="11.7" r="3.4"/><path d="M11 12h2l-.4 9h-1.2z"/></svg>`,
  hufeisen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M7 21c0-1.6-.3-2.3-.9-3.3A6.8 6.8 0 1 1 17.9 17.7c-.6 1-.9 1.7-.9 3.3"/></svg>`,
};

// Neutrale Formen für die Muster-Anzeige der Kombinationen.
export const SHAPE_SVG = {
  q: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>`,
  k: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg>`,
  t: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l9 18H3z"/></svg>`,
  d: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l10 10-10 10L2 12z"/></svg>`,
  p: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l9.5 6.9-3.6 11.1H6.1L2.5 8.9z"/></svg>`,
  joker: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.9 7.1.6-5.4 4.7 1.7 7L12 17.9 5.7 21.2l1.7-7L2 9.5l7.1-.6z"/></svg>`,
};

export const SHAPE_COLOR = {
  q: '#6c8cff', k: '#ff5d6c', t: '#3ec46d', d: '#f5c542', p: '#b57bff', joker: '#f5c542',
};
