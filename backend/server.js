const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

const config = require('./config/env');
const { connectDB } = require('./config/db');
const { seedSystemPresets } = require('./utils/seedPresets');
const { initSocket } = require('./sockets/liveSocket');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const teamRoutes = require('./routes/teamRoutes');
const playerRoutes = require('./routes/playerRoutes');
const matchRoutes = require('./routes/matchRoutes');
const scoringRoutes = require('./routes/scoringRoutes');
const tournamentRoutes = require('./routes/tournamentRoutes');
const scorecardRoutes = require('./routes/scorecardRoutes');
const statsRoutes = require('./routes/statsRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const syncRoutes = require('./routes/syncRoutes');
const publicRoutes = require('./routes/publicRoutes');
const guestRoutes = require('./routes/guestRoutes');

function createApp() {
  const app = express();
  const rootDir = path.resolve(__dirname, '..');

  // Trust Render / reverse-proxy headers (required for HTTPS og:image URLs & express-rate-limit)
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          fontSrc: ["'self'", 'data:']
        }
      },
      crossOriginEmbedderPolicy: false
    })
  );

  app.use(
    cors({
      origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()),
      credentials: true
    })
  );

  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false
  });
  app.use('/api/', apiLimiter);

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ success: true, app: 'ApnaScore', status: 'ok', timestamp: new Date().toISOString() });
  });

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/teams', teamRoutes);
  app.use('/api/players', playerRoutes);
  app.use('/api/matches', matchRoutes);
  app.use('/api/scoring', scoringRoutes);
  app.use('/api/tournaments', tournamentRoutes);
  app.use('/api/scorecards', scorecardRoutes);
  app.use('/api/stats', statsRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/sync', syncRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/api/guest', guestRoutes);

  // Block direct access to backend source or env files
  app.use('/backend', (_req, res) => res.status(403).json({ success: false, message: 'Forbidden' }));
  app.use('/.env', (_req, res) => res.status(403).json({ success: false, message: 'Forbidden' }));

  // Dynamic Open Graph / WhatsApp Link Preview injection for shared public matches & tournaments
  const escMeta = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const injectMeta = (html, { title, description, imageUrl, pageUrl }) => {
    return html
      .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escMeta(title)}</title>`)
      .replace(/<meta name="description" content="[^"]*"\s*\/?>/i, `<meta name="description" content="${escMeta(description)}" />`)
      .replace(/<meta property="og:title" content="[^"]*"\s*\/?>/i, `<meta property="og:title" content="${escMeta(title)}" />`)
      .replace(/<meta property="og:description" content="[^"]*"\s*\/?>/i, `<meta property="og:description" content="${escMeta(description)}" />`)
      .replace(/<meta property="og:image" content="[^"]*"\s*\/?>/i, `<meta property="og:image" content="${escMeta(imageUrl)}" />`)
      .replace(/<meta property="og:url" content="[^"]*"\s*\/?>/i, `<meta property="og:url" content="${escMeta(pageUrl)}" />`)
      .replace(/<meta name="twitter:title" content="[^"]*"\s*\/?>/i, `<meta name="twitter:title" content="${escMeta(title)}" />`)
      .replace(/<meta name="twitter:description" content="[^"]*"\s*\/?>/i, `<meta name="twitter:description" content="${escMeta(description)}" />`)
      .replace(/<meta name="twitter:image" content="[^"]*"\s*\/?>/i, `<meta name="twitter:image" content="${escMeta(imageUrl)}" />`);
  };

  app.get('/public-match.html', async (req, res, next) => {
    try {
      const filePath = path.join(rootDir, 'public-match.html');
      let html = fs.readFileSync(filePath, 'utf8');
      const origin = `${req.protocol}://${req.get('host')}`;
      const imgUrl = `${origin}/assets/images/apnascore-og-preview.jpg`;
      const pageUrl = `${origin}${req.originalUrl}`;
      let title = 'Live Match Center – ApnaScore | Apne Gaon ka Apna Scorer';
      let description = 'Watch live ball-by-ball cricket scores, commentary, batsmen & bowler stats, and full match scorecards in real time on ApnaScore.';

      const val = req.query.id ? String(req.query.id) : '';
      if (val && require('mongoose').connection.readyState === 1) {
        const Match = require('./models/Match');
        const Innings = require('./models/Innings');
        const isObjId = /^[0-9a-fA-F]{24}$/.test(val);
        const match = await Match.findOne(isObjId ? { _id: val } : { matchCode: val.toUpperCase() }).lean();
        if (match && match.isPublic) {
          const innings = await Innings.find({ matchId: match._id }).sort({ inningsNumber: 1 }).lean();
          const curr = innings.find((i) => i.inningsNumber === (match.currentInningsNumber || 1)) || innings[0];
          const scorePart = curr ? ` (${curr.battingTeamName}: ${curr.totalRuns}/${curr.wickets} in ${curr.oversString} ov)` : '';
          title = `${match.title}${scorePart} – Live on ApnaScore`;
          const statusPart = (match.result && match.result.marginText) || `${match.status.toUpperCase()} • ${match.oversPerInnings} Overs`;
          description = `${statusPart} at ${match.venue}. Watch live ball-by-ball updates, commentary, and full scorecard on ApnaScore – Apne Gaon ka Apna Scorer!`;
        }
      }
      res.type('html').send(injectMeta(html, { title, description, imageUrl: imgUrl, pageUrl }));
    } catch (err) {
      next();
    }
  });

  app.get('/public-tournament.html', async (req, res, next) => {
    try {
      const filePath = path.join(rootDir, 'public-tournament.html');
      let html = fs.readFileSync(filePath, 'utf8');
      const origin = `${req.protocol}://${req.get('host')}`;
      const imgUrl = `${origin}/assets/images/apnascore-og-preview.jpg`;
      const pageUrl = `${origin}${req.originalUrl}`;
      let title = 'Tournament Hub – ApnaScore | Apne Gaon ka Apna Scorer';
      let description = 'Follow live tournament points tables, Net Run Rate (NRR), match fixtures, and champion leaderboards on ApnaScore.';

      const val = req.query.id ? String(req.query.id) : '';
      if (val && require('mongoose').connection.readyState === 1) {
        const Tournament = require('./models/Tournament');
        const isObjId = /^[0-9a-fA-F]{24}$/.test(val);
        const t = await Tournament.findOne(isObjId ? { _id: val } : { shareCode: val.toUpperCase() }).lean();
        if (t && t.isPublic) {
          title = `${t.name} (${t.village}) – Points Table & Fixtures | ApnaScore`;
          description = `${t.oversPerMatch}-Over ${String(t.format).replace('_', ' ').toUpperCase()} Cricket Tournament at ${t.village}. Check live standings, NRR, fixtures & match results on ApnaScore!`;
        }
      }
      res.type('html').send(injectMeta(html, { title, description, imageUrl: imgUrl, pageUrl }));
    } catch (err) {
      next();
    }
  });

  // Serve static frontend files
  app.use(express.static(rootDir, { extensions: ['html'] }));

  app.use('/api/*', (_req, res) => {
    res.status(404).json({ success: false, message: 'API endpoint not found.' });
  });

  app.use(errorHandler);
  return app;
}

async function startServer() {
  try {
    await connectDB();
    await seedSystemPresets();
    console.log('[ApnaScore] Connected to MongoDB & verified system rule presets.');
  } catch (err) {
    console.error('[ApnaScore] Database connection failed:', err.message);
    console.error('[ApnaScore] Configure MONGODB_URI in .env (MongoDB Atlas or local mongod).');
    process.exit(1);
  }

  const app = createApp();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',') }
  });
  initSocket(io);

  server.listen(config.port, () => {
    console.log(`[ApnaScore] Server running at http://localhost:${config.port}`);
  });

  return { app, server, io };
}

if (require.main === module) {
  startServer();
}

module.exports = { createApp, startServer };
