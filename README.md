# ApnaScore – Complete Cricket Scoring & Tournament Management Platform

**Tagline:** *Apne Gaon ka Apna Scorer*  
**Mission:** *Har Gaon Ka Apna Cricket Scoreboard.*

ApnaScore is a production-quality, mobile-first, offline-capable cricket scoring and tournament management PWA built with HTML5, CSS3, Vanilla JavaScript (ES6+), Node.js, Express.js, MongoDB Atlas (Mongoose), Socket.IO, and PDFKit.

---

## Key Features

- **Accurate Event-Sourced Cricket Scoring Engine** (`js/scoring-engine.js`)
  - Shared deterministically between Browser (instant UI & offline scoring) and Node.js Backend (validation, replay, and statistics).
  - Supports Undo Last Ball, Edit Previous Ball, Retired Hurt / Retired Out, Returning Batsmen, Swap Batsmen, Maiden Overs, Fall of Wickets, Partnerships, Super Over, and Target/RRR tracking.
- **Custom Cricket Rule Engine**
  - Independent rule configuration per match (Wide, No Ball, Byes, Leg Byes, Overthrows, Penalty Runs, Custom Extras, Boundary values, all 11 dismissal types, One-Tip-One-Hand Catch, Last-Man Batting/Standing, Unlimited Wickets, Fixed Batsman, Consecutive Bowler restrictions).
  - Built-in presets (`Standard Cricket`, `6-Over Village Match`, `8-Over Local Tournament`, `Gully Cricket`, `Tennis Ball Cricket`, `Custom Rules`) plus user-saved custom presets.
  - Immutable rule snapshot stored on each match so global setting changes never mutate existing matches.
- **Reliable Offline Scoring & Sync** (`js/offline-sync.js`, `service-worker.js`)
  - Full match creation & ball-by-ball scoring in IndexedDB when internet is unavailable.
  - Unique `eventId`, `sequence`, and `clientMatchId` with idempotent sync API (`/api/sync/match`) and scorer lock conflict detection.
- **Professional PDF Scorecard Generation** (`backend/services/pdfService.js` + `js/pdf.js`)
  - Genuine multi-page PDFKit scorecards with ApnaScore branding, repeated table headers, page numbers, batting/bowling tables, extras breakdown, fall of wickets, partnerships, and ball-by-ball summary, plus Tournament Results PDFs.
- **Tournament, Team & Player Management**
  - Knockout, League, Round Robin, Group Stage, League + Knockout, and Double Elimination formats; automatic/manual fixtures; Points Table & Net Run Rate (with all-out innings credit rules); duplicate-safe player profiles; career stats rebuilt deterministically.
- **Real-Time Live Sharing & Sunlight-Readable Mobile UI**
  - Socket.IO live score updates, public read-only match & tournament pages (`/public-match.html`, `/public-tournament.html`), WhatsApp sharing, QR codes, 5-tab mobile bottom navigation, Light/Dark modes, and high-contrast Outdoor Scoring Mode.

---

## Setup & Running Locally

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   Copy `.env.example` to `.env` and fill in your MongoDB Atlas URI and a strong JWT secret:
   ```bash
   cp .env.example .env
   ```
   Example `.env`:
   ```env
   PORT=5000
   NODE_ENV=development
   MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/apnascore?retryWrites=true&w=majority
   JWT_SECRET=your_long_random_jwt_secret
   CORS_ORIGIN=http://localhost:5000
   ```

3. **Run automated tests:**
   ```bash
   npm test
   ```

4. **Start the server:**
   ```bash
   npm start
   ```
   Open `http://localhost:5000` in your browser (or install as a PWA on mobile).

---

## Database Backup Strategy (MongoDB Atlas)

- Enable **Continuous Cloud Backup** or scheduled daily snapshots in MongoDB Atlas for the `apnascore` database.
- Periodically export critical collections (`matches`, `innings`, `deliveries`, `tournaments`, `teams`, `players`) using `mongodump --uri="$MONGODB_URI" --out=./backups/$(date +%F)`.
