const { v4: uuidv4 } = require('uuid');
const PDFDocument = require('pdfkit');
const Tournament = require('../models/Tournament');
const TournamentFixture = require('../models/TournamentFixture');
const PointsTable = require('../models/PointsTable');
const Award = require('../models/Award');
const Team = require('../models/Team');
const Match = require('../models/Match');
const engine = require('../services/scoringEngine');
const tournamentService = require('../services/tournamentService');
const statsService = require('../services/statsService');
const { FREE_LIMITS, hasProAccess } = require('../config/plans');
const { logAudit } = require('../utils/logger');

async function listTournaments(req, res, next) {
  try {
    const { status, village, search, mine } = req.query;
    const query = {};
    if (mine === '1') {
      if (req.user) query.organizerId = req.user._id;
      else return res.json({ success: true, tournaments: [] });
    }
    if (status) query.status = status;
    if (village) query.village = new RegExp(String(village), 'i');
    if (search) query.name = new RegExp(String(search), 'i');

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));

    const [total, tournaments] = await Promise.all([
      Tournament.countDocuments(query),
      Tournament.find(query)
        .populate('winnerTeamId', 'name shortName logoUrl')
        .populate('registeredTeams.teamId', 'name shortName village logoUrl')
        .sort({ startDate: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));
    res.json({
      success: true,
      tournaments,
      pagination: { page, limit, total, totalPages, hasMore: page < totalPages }
    });
  } catch (err) {
    next(err);
  }
}

async function getTournament(req, res, next) {
  try {
    const tournament = await Tournament.findById(req.params.id)
      .populate('registeredTeams.teamId', 'name shortName village logoUrl captainId')
      .populate('winnerTeamId', 'name shortName village logoUrl')
      .populate('runnerUpTeamId', 'name shortName village logoUrl')
      .populate('playerOfTournamentId', 'name village stats');
    if (!tournament) return res.status(404).json({ success: false, message: 'Tournament not found.' });

    const [fixtures, pointsTable, awards, leaderboards] = await Promise.all([
      TournamentFixture.find({ tournamentId: tournament._id })
        .sort({ roundOrder: 1, matchNumber: 1 })
        .lean(),
      PointsTable.find({ tournamentId: tournament._id }).sort({ points: -1, netRunRate: -1 }).lean(),
      Award.find({ tournamentId: tournament._id }).sort({ createdAt: -1 }).lean(),
      statsService.getFilteredLeaderboards({ tournamentId: tournament._id })
    ]);

    res.json({
      success: true,
      tournament,
      fixtures,
      pointsTable,
      awards,
      leaderboards
    });
  } catch (err) {
    next(err);
  }
}

async function createTournament(req, res, next) {
  try {
    const {
      name,
      season,
      village,
      organizerName,
      startDate,
      endDate,
      registrationDeadline,
      entryFee,
      prizeMoney,
      maxTeams,
      oversPerMatch,
      ballType,
      format,
      isPublic,
      rules,
      pointsConfig,
      teamIds
    } = req.body;

    if (!name || !village || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Tournament name, village, start date, and end date are required.'
      });
    }

    const userHasMonthlyPro = hasProAccess(null, req.user);
    const requestedMaxTeams = Number(maxTeams || 4);
    const requestedFormat = format || 'knockout';

    if (!userHasMonthlyPro) {
      const existingCount = await Tournament.countDocuments({ organizerId: req.user._id });
      if (existingCount >= FREE_LIMITS.maxTournaments) {
        return res.status(403).json({
          success: false,
          requiresPro: true,
          feature: 'Multiple Tournaments',
          message: `Free tier allows ${FREE_LIMITS.maxTournaments} tournament. Upgrade to Tournament Manager Pro for unlimited tournaments.`
        });
      }
      if (requestedMaxTeams > FREE_LIMITS.maxTeamsPerTournament) {
        return res.status(403).json({
          success: false,
          requiresPro: true,
          feature: 'More Than 4 Teams',
          message: `Free tier allows up to ${FREE_LIMITS.maxTeamsPerTournament} teams per tournament. Upgrade to Pro for up to 64 teams.`
        });
      }
      if (!FREE_LIMITS.allowedFormats.includes(requestedFormat)) {
        return res.status(403).json({
          success: false,
          requiresPro: true,
          feature: 'Group + Knockout Format',
          message: 'Group Stage & League + Knockout formats require Tournament Manager Pro.'
        });
      }
    }

    const { rules: validatedRules } = engine.validateAndNormalizeRules(
      Object.assign({}, rules || {}, {
        format: Object.assign({}, (rules && rules.format) || {}, {
          oversPerInnings: Number(oversPerMatch) || 8,
          ballType: ballType || 'tennis'
        })
      })
    );

    const registeredTeams = Array.isArray(teamIds)
      ? teamIds.slice(0, userHasMonthlyPro ? 64 : FREE_LIMITS.maxTeamsPerTournament).map((id, idx) => ({
          teamId: id,
          groupName: requestedFormat === 'group_stage' ? (idx % 2 === 0 ? 'Group A' : 'Group B') : 'Group A',
          status: 'approved'
        }))
      : [];

    const tournament = await Tournament.create({
      name: String(name).trim(),
      season: season || String(new Date().getFullYear()),
      village: String(village).trim(),
      organizerName: organizerName || req.user.name,
      organizerId: req.user._id,
      plan: userHasMonthlyPro ? 'pro' : 'free',
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      registrationDeadline: registrationDeadline ? new Date(registrationDeadline) : null,
      entryFee: Number(entryFee || 0),
      prizeMoney: prizeMoney ? String(prizeMoney).trim() : '',
      maxTeams: requestedMaxTeams,
      oversPerMatch: Number(oversPerMatch || 8),
      ballType: ballType || 'tennis',
      format: requestedFormat,
      isPublic: isPublic !== false,
      status: 'ongoing',
      rulesSnapshot: validatedRules,
      pointsConfig: pointsConfig || { win: 2, loss: 0, tie: 1, noResult: 1, tieBreaker: 'nrr' },
      registeredTeams,
      shareCode: 'TRN-' + uuidv4().slice(0, 6).toUpperCase()
    });

    if (registeredTeams.length > 0) {
      await tournamentService.rebuildPointsTable(tournament._id);
    }

    await logAudit({ req, action: 'TOURNAMENT_CREATED', entityType: 'Tournament', entityId: tournament._id, details: { name: tournament.name } });
    res.status(201).json({ success: true, tournament });
  } catch (err) {
    next(err);
  }
}

async function updateTournament(req, res, next) {
  try {
    const tournament = req.tournament;
    const allowed = [
      'name', 'season', 'village', 'organizerName', 'startDate', 'endDate',
      'registrationDeadline', 'entryFee', 'prizeMoney', 'maxTeams', 'oversPerMatch',
      'ballType', 'format', 'isPublic', 'status', 'pointsConfig', 'winnerTeamId',
      'runnerUpTeamId', 'playerOfTournamentId', 'sponsorName', 'publicRegistrationEnabled'
    ];
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        tournament[k] = req.body[k];
      }
    }
    await tournament.save();
    await tournamentService.rebuildPointsTable(tournament._id);
    res.json({ success: true, tournament });
  } catch (err) {
    next(err);
  }
}

async function registerTeam(req, res, next) {
  try {
    const tournament = await Tournament.findById(req.params.id);
    if (!tournament) return res.status(404).json({ success: false, message: 'Tournament not found.' });

    const { teamId, groupName } = req.body;
    if (!teamId) return res.status(400).json({ success: false, message: 'teamId is required.' });

    const team = await Team.findById(teamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found.' });

    const existing = tournament.registeredTeams.find((r) => String(r.teamId) === String(teamId));
    if (existing) {
      return res.status(409).json({ success: false, message: 'Team is already registered in this tournament.' });
    }

    const activeCount = tournament.registeredTeams.filter((r) => r.status !== 'rejected').length;
    if (!hasProAccess(tournament, req.user) && activeCount >= FREE_LIMITS.maxTeamsPerTournament) {
      return res.status(403).json({
        success: false,
        requiresPro: true,
        feature: 'More Than 4 Teams',
        tournamentId: tournament._id,
        message: `Free tier allows up to ${FREE_LIMITS.maxTeamsPerTournament} teams per tournament. Upgrade to Pro to add more teams.`
      });
    }

    const isOrganizer = req.user.role === 'super_admin' || String(tournament.organizerId) === String(req.user._id);
    tournament.registeredTeams.push({
      teamId,
      groupName: groupName || 'Group A',
      status: isOrganizer ? 'approved' : 'pending',
      feeStatus: tournament.entryFee > 0 ? 'pending' : 'waived'
    });
    await tournament.save();
    await tournamentService.rebuildPointsTable(tournament._id);

    res.json({ success: true, tournament });
  } catch (err) {
    next(err);
  }
}

async function approveTeam(req, res, next) {
  try {
    const tournament = req.tournament;
    const { teamId, status, groupName } = req.body;
    const entry = tournament.registeredTeams.find((r) => String(r.teamId) === String(teamId));
    if (!entry) return res.status(404).json({ success: false, message: 'Team registration not found.' });

    if (status) entry.status = status;
    if (groupName) entry.groupName = groupName;
    await tournament.save();
    await tournamentService.rebuildPointsTable(tournament._id);

    res.json({ success: true, tournament });
  } catch (err) {
    next(err);
  }
}

async function generateFixtures(req, res, next) {
  try {
    const fixtures = await tournamentService.generateFixturesForTournament(req.tournament._id);
    res.json({ success: true, fixtures });
  } catch (err) {
    next(err);
  }
}

async function addManualFixture(req, res, next) {
  try {
    const tournament = req.tournament;
    const { teamAId, teamBId, roundName, roundOrder, groupName, scheduledDate, venue } = req.body;
    const [teamA, teamB] = await Promise.all([
      teamAId ? Team.findById(teamAId).select('name') : null,
      teamBId ? Team.findById(teamBId).select('name') : null
    ]);

    const count = await TournamentFixture.countDocuments({ tournamentId: tournament._id });
    const fixture = await TournamentFixture.create({
      tournamentId: tournament._id,
      roundName: roundName || 'League Match',
      roundOrder: Number(roundOrder || 1),
      matchNumber: count + 1,
      groupName: groupName || 'Group A',
      teamAId: teamA ? teamA._id : null,
      teamAName: teamA ? teamA.name : 'TBD',
      teamBId: teamB ? teamB._id : null,
      teamBName: teamB ? teamB.name : 'TBD',
      scheduledDate: scheduledDate ? new Date(scheduledDate) : tournament.startDate,
      venue: venue || tournament.village,
      status: 'scheduled'
    });
    res.status(201).json({ success: true, fixture });
  } catch (err) {
    next(err);
  }
}

async function announceWinner(req, res, next) {
  try {
    const tournament = req.tournament;
    const { winnerTeamId, runnerUpTeamId, playerOfTournamentId, playerOfTournamentName } = req.body;
    if (!winnerTeamId) return res.status(400).json({ success: false, message: 'winnerTeamId is required.' });

    tournament.winnerTeamId = winnerTeamId;
    if (runnerUpTeamId) tournament.runnerUpTeamId = runnerUpTeamId;
    if (playerOfTournamentId) tournament.playerOfTournamentId = playerOfTournamentId;
    tournament.status = 'completed';
    await tournament.save();

    if (playerOfTournamentId) {
      await Award.create({
        awardType: 'player_of_tournament',
        title: 'Player of the Tournament',
        playerId: playerOfTournamentId,
        playerName: playerOfTournamentName || 'Player',
        tournamentId: tournament._id,
        metricText: tournament.name
      });
    }

    res.json({ success: true, tournament });
  } catch (err) {
    next(err);
  }
}

async function uploadTournamentMedia(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No image file uploaded.' });
    const kind = req.body.type;
    if (kind === 'sponsor' && !hasProAccess(req.tournament, req.user)) {
      return res.status(403).json({
        success: false,
        requiresPro: true,
        feature: 'Sponsor Banner Branding',
        tournamentId: req.tournament._id,
        message: 'Sponsor banner branding is a Tournament Manager Pro feature.'
      });
    }
    const field = kind === 'sponsor' ? 'sponsorBannerUrl' : (kind === 'poster' ? 'posterUrl' : 'logoUrl');
    req.tournament[field] = `/assets/uploads/${req.file.filename}`;
    await req.tournament.save();
    res.json({ success: true, [field]: req.tournament[field], tournament: req.tournament });
  } catch (err) {
    next(err);
  }
}

async function updateEntryFee(req, res, next) {
  try {
    const tournament = req.tournament;
    const entry = tournament.registeredTeams.find((r) => String(r.teamId) === String(req.params.teamId));
    if (!entry) return res.status(404).json({ success: false, message: 'Team not registered in this tournament.' });

    const { feeStatus, feeAmountPaid, paymentMode } = req.body || {};
    if (feeStatus && ['pending', 'paid', 'waived'].includes(feeStatus)) entry.feeStatus = feeStatus;
    if (feeAmountPaid !== undefined) entry.feeAmountPaid = Math.max(0, Number(feeAmountPaid) || 0);
    if (paymentMode !== undefined) entry.paymentMode = String(paymentMode);
    entry.feeUpdatedAt = new Date();
    await tournament.save();

    const approved = tournament.registeredTeams.filter((r) => r.status !== 'rejected');
    const totalExpected = approved.filter((r) => r.feeStatus !== 'waived').length * (tournament.entryFee || 0);
    const totalCollected = approved.reduce((s, r) => s + (r.feeStatus === 'paid' ? (r.feeAmountPaid || tournament.entryFee || 0) : 0), 0);

    res.json({
      success: true,
      tournament,
      feeSummary: {
        totalExpected,
        totalCollected,
        totalPending: Math.max(0, totalExpected - totalCollected)
      }
    });
  } catch (err) {
    next(err);
  }
}

async function updateFixture(req, res, next) {
  try {
    const fixture = await TournamentFixture.findOne({ _id: req.params.fixtureId, tournamentId: req.tournament._id });
    if (!fixture) return res.status(404).json({ success: false, message: 'Fixture not found.' });

    const { scheduledDate, scheduledTime, venue, roundName, teamAId, teamBId } = req.body || {};
    if (scheduledDate) fixture.scheduledDate = new Date(scheduledDate);
    if (scheduledTime !== undefined) fixture.scheduledTime = String(scheduledTime).trim();
    if (venue !== undefined) fixture.venue = String(venue).trim();
    if (roundName !== undefined) fixture.roundName = String(roundName).trim();
    if (teamAId) {
      const tA = await Team.findById(teamAId).select('name');
      if (tA) { fixture.teamAId = tA._id; fixture.teamAName = tA.name; }
    }
    if (teamBId) {
      const tB = await Team.findById(teamBId).select('name');
      if (tB) { fixture.teamBId = tB._id; fixture.teamBName = tB.name; }
    }
    await fixture.save();
    res.json({ success: true, fixture });
  } catch (err) {
    next(err);
  }
}

async function downloadProPDF(req, res, next) {
  try {
    const tournament = await Tournament.findById(req.params.id)
      .populate('registeredTeams.teamId', 'name village')
      .populate('winnerTeamId', 'name')
      .lean();
    if (!tournament) return res.status(404).json({ success: false, message: 'Tournament not found.' });

    const [fixtures, pointsTable, leaderboards] = await Promise.all([
      TournamentFixture.find({ tournamentId: tournament._id }).sort({ roundOrder: 1, matchNumber: 1 }).lean(),
      PointsTable.find({ tournamentId: tournament._id }).sort({ points: -1, netRunRate: -1 }).lean(),
      statsService.getFilteredLeaderboards({ tournamentId: tournament._id })
    ]);

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="ApnaScore_Pro_${tournament.shareCode || tournament._id}.pdf"`);
      res.send(Buffer.concat(chunks));
    });

    doc.rect(0, 0, doc.page.width, 72).fill('#208B4E');
    doc.fillColor('#FFFFFF').fontSize(18).font('Helvetica-Bold').text(`${tournament.name} (PRO REPORT)`, 40, 20);
    doc.fontSize(10).font('Helvetica').text(`${tournament.village} • ${tournament.oversPerMatch} Overs • ${tournament.format.toUpperCase()}`, 40, 44);

    let y = 90;
    doc.fillColor('#0F3822').fontSize(12).font('Helvetica-Bold').text('1. Registered Teams', 40, y);
    y += 18;
    doc.fontSize(9.5).font('Helvetica');
    (tournament.registeredTeams || []).forEach((r, idx) => {
      doc.text(`${idx + 1}. ${r.teamId?.name || 'Team'} (${r.status}) — Captain: ${r.captainName || '-'} • Fee: ${r.feeStatus || 'pending'}`, 45, y);
      y += 14;
    });

    y += 10;
    doc.fontSize(12).font('Helvetica-Bold').text('2. Points Table & NRR', 40, y);
    y += 18;
    doc.fontSize(9.5).font('Helvetica');
    pointsTable.forEach((p, idx) => {
      doc.text(`${idx + 1}. ${p.teamName}  |  P:${p.played}  W:${p.won}  L:${p.lost}  Pts:${p.points}  NRR:${Number(p.netRunRate || 0).toFixed(3)}`, 45, y);
      y += 14;
    });

    y += 10;
    doc.fontSize(12).font('Helvetica-Bold').text('3. Match Schedule & Results', 40, y);
    y += 18;
    doc.fontSize(9.5).font('Helvetica');
    fixtures.forEach((f) => {
      if (y > 760) { doc.addPage(); y = 45; }
      const d = f.scheduledDate ? new Date(f.scheduledDate).toLocaleDateString('en-IN') : 'TBD';
      doc.text(`#${f.matchNumber} [${f.roundName}] ${f.teamAName} vs ${f.teamBName} • ${d} ${f.scheduledTime || ''} • ${f.venue || ''} • ${f.resultText || f.status}`, 45, y);
      y += 14;
    });

    y += 10;
    doc.fontSize(12).font('Helvetica-Bold').text('4. Awards & Top Performers', 40, y);
    y += 16;
    doc.fontSize(9.5).font('Helvetica');
    doc.text(`Champion: ${tournament.winnerTeamId?.name || 'TBD'}`, 45, y); y += 14;
    doc.text(`Orange Cap: ${leaderboards.orangeCap ? `${leaderboards.orangeCap.name} (${leaderboards.orangeCap.runs} runs)` : '-'}`, 45, y); y += 14;
    doc.text(`Purple Cap: ${leaderboards.purpleCap ? `${leaderboards.purpleCap.name} (${leaderboards.purpleCap.wickets} wkts)` : '-'}`, 45, y);

    doc.end();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listTournaments,
  getTournament,
  createTournament,
  updateTournament,
  registerTeam,
  approveTeam,
  updateEntryFee,
  generateFixtures,
  addManualFixture,
  updateFixture,
  announceWinner,
  uploadTournamentMedia,
  downloadProPDF
};
