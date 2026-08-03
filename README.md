# PickUp

Ein privates Slot-Kombinations-Spiel für 2–4 Freunde. Inspiriert vom Prinzip
„drehen, halten, kombinieren" – komplett eigener Code, eigene Grafik, eigenes Scoring.

## Spielprinzip

- **2–4 Spieler** treffen sich in einem von **4 Räumen**. Der erste Spieler ist **Host**.
- Sind alle **bereit**, startet der Host das Spiel: **5 Runden**.
- Die Runden werden **immer kürzer** (90 → 70 → 50 → 35 → 25 s): von entspannt zu stressig.
- Pro Zug dreht sich die Walze **automatisch**, danach zwei **Draws** (1. Draw / 2. Draw) mit Halten dazwischen.
- Dann eine **gültige** Kombination wählen. Gibt es nach dem letzten Draw **keine** gültige Kombination mehr, ist die Runde vorbei (**Fehlwurf**) – man wartet auf den anderen.
- Für die nächste Runde müssen **beide erneut „Bereit"** drücken.
- Nach jeder Runde: synchroner **Zwischenstand**. Am Ende: **Endergebnis + Leaderboard**.

Jeder spielt seine Walzen **lokal** – synchronisiert wird nur Rundenstart und die
Punkte-Übergabe ins Scoreboard (kein Echtzeit-Streaming der Walzen).

### Kombinationen & Scoring

Glücksspiel-Stil: **große Zahlen, weite Streuung, Bonus für Extra-Symbole**.
Symbolwerte (Tier): Kleeblatt 1 · Hufeisen 2 · Halbmond 3 · Stern 5 · Krone 8 · **Herz 12**.
Die Kombinationen werden auf der Tafel als **Muster** gezeigt (z. B. Full House = `▢▢▢ + ●●`,
„3× Symbol" = das Symbol dreimal).

| Kombination      | Punkte-Formel                              | Beispiel            |
|------------------|--------------------------------------------|---------------------|
| 3× \<Symbol\>    | 1.000 × Wert × (Anzahl − 2)                | 3 Klee = 1.000 · 3 Herz = 12.000 · 4 Herz = 24.000 |
| Zweierpaar       | 300 × Wert                                 | Paar Herz = 3.600   |
| Full House (3+2) | 5.000 × Wert(Drilling) + 1.500 × Wert(Paar)| Herz+Krone = 72.000 |
| 5 Verschiedene   | 15.000 + 1.000 × Summe der Werte           | ≈ 45.000            |
| Vierling (4 gl.) | 20.000 × Wert × (Anzahl − 3)               | 4 Herz = 240.000    |
| Fünfling (5 gl.) | 60.000 × Wert                              | 5 Herz = 720.000    |
| Joker            | 4.000 × Summe (nur mit mind. einem Paar)   | ≈ 150.000           |

**Serien-Multiplikator:** Jede gewertete Kombination in Folge erhöht den Multiplikator
(×1 → ×1,2 → ×1,5 → ×2 → ×3 → ×4 → ×5), der auf jede weitere Kombination wirkt – dazu
Jackpot-Effekte bei großen Treffern. Ein Fehlwurf beendet die Runde und setzt die Serie zurück.
Mehr Symbole als nötig (z. B. 4 Hufeisen in „3× Hufeisen") geben **mehr** Punkte.

Alle Werte stehen in **`public/game-core.js`** (`BASE`, `SYMBOLS`) und die Multiplikator-Stufen
in **`public/app.js`** (`multiplierFor`). Rundenzahl/-zeiten in **`server/index.js`** (`CONFIG`).

## Lokal starten

Es gibt zwei Wege – nimm den, dessen Runtime du installiert hast.

### A) Mit Deno (empfohlen, wenn kein Node installiert ist)

Deno lädt die npm-Pakete beim ersten Start automatisch – kein `npm install` nötig.

```bash
deno task start
```

### B) Mit Node.js (≥ 18)

```bash
npm install
npm start
```

In beiden Fällen dann im Browser: <http://localhost:3000>
Zum Testen mehrerer Spieler einfach mehrere Browser-Tabs/Geräte im selben Netz öffnen.

## Auf dem Ubuntu-Server deployen

1. **Node installieren** (falls nötig):
   ```bash
   sudo apt update && sudo apt install -y nodejs npm
   ```
2. **Projekt kopieren** (z.B. per scp/git) und Abhängigkeiten installieren:
   ```bash
   cd /pfad/zu/PickUp
   npm install --omit=dev
   ```
3. **Dauerhaft laufen lassen** mit PM2:
   ```bash
   sudo npm install -g pm2
   pm2 start server/index.js --name pickup
   pm2 save && pm2 startup   # Autostart nach Reboot
   ```
   Der Port lässt sich per Umgebungsvariable setzen: `PORT=8080 pm2 start ...`.

4. **Optional: Nginx als Reverse Proxy** (Domain + WebSockets):
   ```nginx
   server {
       listen 80;
       server_name deine-domain.de;
       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
       }
   }
   ```
   Danach `sudo nginx -t && sudo systemctl reload nginx`. Für HTTPS: `certbot --nginx`.

5. **Firewall**: `sudo ufw allow 80,443/tcp` (bzw. den gewählten Port).

## Daten

Das Leaderboard liegt als JSON unter `data/leaderboard.json` – keine Datenbank nötig.

## Projektstruktur

```
server/index.js     Express + Socket.IO: Räume, Runden-Sync, Leaderboard
server/store.js     JSON-Speicher fürs Leaderboard
public/index.html   UI-Grundgerüst (alle Screens)
public/app.js       Client-Logik: Walzen, Halten, Wertung, Sockets
public/game-core.js Symbole, Kombinationen, Scoring (Config)
public/symbols.js   SVG-Grafiken der Symbole
public/styles.css   Styling
```
