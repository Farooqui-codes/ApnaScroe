const path = require('path');
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

function createApp() {
  const app = express();
  const rootDir = path.resolve(__dirname, '..');

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

  // Block direct access to backend source or env files
  app.use('/backend', (_req, res) => res.status(403).json({ success: false, message: 'Forbidden' }));
  app.use('/.env', (_req, res) => res.status(403).json({ success: false, message: 'Forbidden' }));

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
