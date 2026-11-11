const statsService = require('../services/statsService');
const Tournament = require('../models/Tournament');
const Team = require('../models/Team');

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

module.exports = { getLeaderboards };
