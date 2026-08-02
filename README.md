# PickUp

Ein privates Slot-Kombinations-Spiel für 2–4 Freunde. Inspiriert vom Prinzip
„drehen, halten, kombinieren" – komplett eigener Code, eigene Grafik, eigenes Scoring.

## Spielprinzip

- **2–4 Spieler** treffen sich in einem von **4 Räumen**. Der erste Spieler ist **Host**.
- Sind alle **bereit**, startet der Host das Spiel: **5 Runden**.
- Jede Runde läuft auf **Zeit** (Standard 2 Min). Ziel: möglichst viele der **12 Kombinationen** füllen.
- Pro Zug: **3× drehen** mit Halten dazwischen, dann eine Kombination der Wertungstafel zuweisen.
- Nach jeder Runde: synchroner **Zwischenstand**. Am Ende: **Endergebnis + Leaderboard**.

Jeder spielt seine Walzen **lokal** – synchronisiert wird nur Rundenstart und die
Punkte-Übergabe ins Scoreboard (kein Echtzeit-Streaming der Walzen).

### Kombinationen & Scoring

Symbole (Wert): Kleeblatt 1 · Hufeisen 2 · Halbmond 3 · Stern 4 · Krone 5 · **Herz 6**.
Der Symbolwert kommt zum Grundwert der Kombination dazu – Herz-Kombis geben also mehr.

| Kombination        | Grundwert | Formel (Punkte)                          |
|--------------------|-----------|------------------------------------------|
| 3× \<Symbol\>      | 20        | 20 + Anzahl × Symbolwert                 |
| Zweierpaar         | 10        | 10 + 2 × Symbolwert                       |
| Full House (3+2)   | 40        | 40 + 3×Wert(Triple) + 2×Wert(Paar)       |
| 5 Verschiedene     | 30        | 30 + Summe aller 5 Symbolwerte           |
| Vierling (4 gl.)   | 60        | 60 + 4 × Symbolwert                       |
| Fünfling (5 gl.)   | 100       | 100 + 5 × Symbolwert                      |
| Joker              | 25        | immer wertbar: 25 + höchster Walzenwert   |

Alle Werte stehen in **`public/game-core.js`** (Objekte `BASE`, `SYMBOLS`) – einfach anpassbar.
Rundenzahl/-dauer in **`server/index.js`** (`CONFIG`).

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
