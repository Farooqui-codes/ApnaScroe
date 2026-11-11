const { v4: uuidv4 } = require('uuid');
const Tournament = require('../models/Tournament');
const TournamentFixture = require('../models/TournamentFixture');
const PointsTable = require('../models/PointsTable');
const Award = require('../models/Award');
const Team = require('../models/Team');
const Match = require('../models/Match');
const engine = require('../services/scoringEngine');
const tournamentService = require('../services/tournamentService');
const statsService = require('../services/statsService');
const { logAudit } = require('../utils/logger');

async function listTournaments(req, res, next) {
  try {
    const { status, village, search } = req.query;
    const query = {};
    if (status) query.status = status;
    if (village) query.village = new RegExp(String(village), 'i');
    if (search) query.name = new RegExp(String(search), 'i');

    const tournaments = await Tournament.find(query)
      .populate('winnerTeamId', 'name shortName logoUrl')
      .populate('registeredTeams.teamId', 'name shortName village logoUrl')
      .sort({ startDate: -1, createdAt: -1 })
      .lean();

    res.json({ success: true, tournaments });
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

    const { rules: validatedRules } = engine.validateAndNormalizeRules(
      Object.assign({}, rules || {}, {
        format: Object.assign({}, (rules && rules.format) || {}, {
          oversPerInnings: Number(oversPerMatch) || 8,
          ballType: ballType || 'tennis'
        })
      })
    );

    const registeredTeams = Array.isArray(teamIds)
      ? teamIds.map((id, idx) => ({
          teamId: id,
          groupName: format === 'group_stage' ? (idx % 2 === 0 ? 'Group A' : 'Group B') : 'Group A',
          status: 'approved'
        }))
      : [];

    const tournament = await Tournament.create({
      name: String(name).trim(),
      season: season || String(new Date().getFullYear()),
      village: String(village).trim(),
      organizerName: organizerName || req.user.name,
      organizerId: req.user._id,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      registrationDeadline: registrationDeadline ? new Date(registrationDeadline) : null,
      entryFee: Number(entryFee || 0),
      prizeMoney: prizeMoney ? String(prizeMoney).trim() : '',
      maxTeams: Number(maxTeams || 8),
      oversPerMatch: Number(oversPerMatch || 8),
      ballType: ballType || 'tennis',
      format: format || 'league_knockout',
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
      'runnerUpTeamId', 'playerOfTournamentId'
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

    const isOrganizer = req.user.role === 'super_admin' || String(tournament.organizerId) === String(req.user._id);
    tournament.registeredTeams.push({
      teamId,
      groupName: groupName || 'Group A',
      status: isOrganizer ? 'approved' : 'pending'
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
    const field = req.body.type === 'poster' ? 'posterUrl' : 'logoUrl';
    req.tournament[field] = `/assets/uploads/${req.file.filename}`;
    await req.tournament.save();
    res.json({ success: true, [field]: req.tournament[field], tournament: req.tournament });
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
  generateFixtures,
  addManualFixture,
  announceWinner,
  uploadTournamentMedia
};
