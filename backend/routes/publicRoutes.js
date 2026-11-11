const express = require('express');
const QRCode = require('qrcode');
const Match = require('../models/Match');
const Innings = require('../models/Innings');
const Tournament = require('../models/Tournament');
const TournamentFixture = require('../models/TournamentFixture');
const PointsTable = require('../models/PointsTable');
const router = express.Router();

router.get('/matches/:idOrCode', async (req, res, next) => {
  try {
    const val = req.params.idOrCode;
    const isObjId = /^[0-9a-fA-F]{24}$/.test(val);
    const match = await Match.findOne(isObjId ? { _id: val } : { matchCode: val.toUpperCase() })
      .populate('tournamentId', 'name village')
      .lean();
    if (!match || !match.isPublic) {
      return res.status(404).json({ success: false, message: 'Public match not found.' });
    }
    const innings = await Innings.find({ matchId: match._id }).sort({ inningsNumber: 1 }).lean();
    res.json({ success: true, readOnly: true, match, innings });
  } catch (err) {
    next(err);
  }
});

router.get('/matches/:idOrCode/qr', async (req, res, next) => {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const targetUrl = `${baseUrl}/public-match.html?id=${encodeURIComponent(req.params.idOrCode)}`;
    const qrDataUrl = await QRCode.toDataURL(targetUrl, {
      color: { dark: '#0F3822', light: '#FFFFFF' },
      margin: 2,
      width: 240
    });
    res.json({ success: true, url: targetUrl, qrDataUrl });
  } catch (err) {
    next(err);
  }
});

router.get('/tournaments/:idOrCode', async (req, res, next) => {
  try {
    const val = req.params.idOrCode;
    const isObjId = /^[0-9a-fA-F]{24}$/.test(val);
    const tournament = await Tournament.findOne(isObjId ? { _id: val } : { shareCode: val.toUpperCase() })
      .populate('winnerTeamId', 'name logoUrl')
      .populate('registeredTeams.teamId', 'name shortName village logoUrl')
      .lean();
    if (!tournament || !tournament.isPublic) {
      return res.status(404).json({ success: false, message: 'Public tournament not found.' });
    }
    const [fixtures, pointsTable] = await Promise.all([
      TournamentFixture.find({ tournamentId: tournament._id }).sort({ roundOrder: 1, matchNumber: 1 }).lean(),
      PointsTable.find({ tournamentId: tournament._id }).sort({ points: -1, netRunRate: -1 }).lean()
    ]);
    res.json({ success: true, readOnly: true, tournament, fixtures, pointsTable });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
