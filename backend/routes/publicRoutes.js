const express = require('express');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const Match = require('../models/Match');
const Innings = require('../models/Innings');
const Tournament = require('../models/Tournament');
const TournamentFixture = require('../models/TournamentFixture');
const PointsTable = require('../models/PointsTable');
const Team = require('../models/Team');
const Player = require('../models/Player');
const statsService = require('../services/statsService');
const { hasProAccess } = require('../config/plans');
const router = express.Router();

const publicRegLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many registration requests. Please wait a few minutes.' }
});

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
    const [fixtures, pointsTable, liveMatches, leaderboards] = await Promise.all([
      TournamentFixture.find({ tournamentId: tournament._id }).sort({ roundOrder: 1, matchNumber: 1 }).lean(),
      PointsTable.find({ tournamentId: tournament._id }).sort({ points: -1, netRunRate: -1 }).lean(),
      Match.find({ tournamentId: tournament._id, status: { $in: ['live', 'paused', 'innings_break'] } })
        .select('title status venue oversPerInnings inningsSummary result')
        .sort({ updatedAt: -1 })
        .lean(),
      statsService.getFilteredLeaderboards({ tournamentId: tournament._id })
    ]);
    res.json({ success: true, readOnly: true, tournament, fixtures, pointsTable, liveMatches, leaderboards });
  } catch (err) {
    next(err);
  }
});

// Public team self-registration for Tournament Manager Pro tournaments
router.post('/tournaments/:idOrCode/register', publicRegLimiter, async (req, res, next) => {
  try {
    const val = req.params.idOrCode;
    const isObjId = /^[0-9a-fA-F]{24}$/.test(val);
    const tournament = await Tournament.findOne(isObjId ? { _id: val } : { shareCode: val.toUpperCase() });
    if (!tournament || !tournament.isPublic) {
      return res.status(404).json({ success: false, message: 'Tournament not found.' });
    }
    if (!hasProAccess(tournament, null)) {
      return res.status(403).json({
        success: false,
        requiresPro: true,
        message: 'Public team registration is a Tournament Manager Pro feature.'
      });
    }
    if (!tournament.publicRegistrationEnabled) {
      return res.status(400).json({ success: false, message: 'Registration is currently closed for this tournament.' });
    }

    const { teamName, captainName, captainPhone, playerNames } = req.body || {};
    const cleanTeam = String(teamName || '').trim();
    const cleanCap = String(captainName || '').trim();
    const cleanPhone = String(captainPhone || '').replace(/[^\d+\s-]/g, '').trim();
    if (!cleanTeam || !cleanCap || cleanPhone.length < 8) {
      return res.status(400).json({ success: false, message: 'Team name, captain name, and valid phone number are required.' });
    }

    const dup = (tournament.registeredTeams || []).find(
      (r) => r.captainPhone && r.captainPhone === cleanPhone && r.status !== 'rejected'
    );
    if (dup) {
      return res.status(409).json({ success: false, message: 'A team with this phone number is already registered.' });
    }

    const parsedPlayers = Array.isArray(playerNames)
      ? playerNames.map((p) => String(p || '').trim()).filter(Boolean).slice(0, 20)
      : String(playerNames || '').split(/[\n,]+/).map((p) => p.trim()).filter(Boolean).slice(0, 20);

    const short = cleanTeam.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 4) || 'TEAM';
    const teamDoc = await Team.create({
      ownerType: 'user',
      userId: tournament.organizerId,
      managerId: tournament.organizerId,
      name: cleanTeam,
      shortName: short,
      village: tournament.village,
      ownerName: cleanCap
    });

    if (parsedPlayers.length > 0) {
      const pDocs = await Promise.all(
        parsedPlayers.map((pName) =>
          Player.create({
            ownerType: 'user',
            userId: tournament.organizerId,
            createdBy: tournament.organizerId,
            name: pName,
            village: tournament.village,
            teams: [teamDoc._id]
          })
        )
      );
      teamDoc.players = pDocs.map((p) => p._id);
      await teamDoc.save();
    }

    tournament.registeredTeams.push({
      teamId: teamDoc._id,
      groupName: 'Group A',
      status: 'pending',
      captainName: cleanCap,
      captainPhone: cleanPhone,
      playerNames: parsedPlayers,
      feeStatus: tournament.entryFee > 0 ? 'pending' : 'waived'
    });
    await tournament.save();

    res.status(201).json({
      success: true,
      message: 'Team registration submitted! Waiting for organizer approval.',
      team: teamDoc
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
