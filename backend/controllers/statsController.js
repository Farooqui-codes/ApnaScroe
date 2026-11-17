const statsService = require('../services/statsService');
const Tournament = require('../models/Tournament');
const Team = require('../models/Team');
const Match = require('../models/Match');
const User = require('../models/User');
const Player = require('../models/Player');

async function getPlatformStats(req, res, next) {
  try {
    const [matchesCount, tournamentsCount, usersCount, teamsCount, playersCount] = await Promise.all([
      Match.countDocuments({}),
      Tournament.countDocuments({}),
      User.countDocuments({}),
      Team.countDocuments({}),
      Player.countDocuments({})
    ]);

    res.json({
      success: true,
      stats: {
        matches: matchesCount,
        tournaments: tournamentsCount,
        users: usersCount,
        teams: teamsCount,
        players: playersCount
      }
    });
  } catch (err) {
    next(err);
  }
}

async function getLeaderboards(req, res, next) {
  try {
    const { tournamentId, teamId, village, season, fromDate, toDate } = req.query;
    const filters = { tournamentId, teamId, village, fromDate, toDate };

    if (season && !tournamentId) {
      const seasonTours = await Tournament.find({ season: String(season) }).select('_id');
      if (seasonTours.length === 1) filters.tournamentId = seasonTours[0]._id;
    }

    const [leaderboards, tournaments, teams] = await Promise.all([
      statsService.getFilteredLeaderboards(filters),
      Tournament.find().select('name season village').sort({ createdAt: -1 }).lean(),
      Team.find().select('name village').sort({ name: 1 }).lean()
    ]);

    res.json({
      success: true,
      leaderboards,
      filterOptions: { tournaments, teams }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getLeaderboards, getPlatformStats };
