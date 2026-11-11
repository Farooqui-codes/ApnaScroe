const Match = require('../models/Match');
const Innings = require('../models/Innings');
const Tournament = require('../models/Tournament');
const TournamentFixture = require('../models/TournamentFixture');
const Team = require('../models/Team');
const Player = require('../models/Player');
const Notification = require('../models/Notification');

async function getDashboardSummary(req, res, next) {
  try {
    const [
      totalMatches,
      liveCount,
      upcomingCount,
      completedCount,
      activeTournamentsCount,
      totalTeams,
      totalPlayers,
      liveMatches,
      recentMatches,
      upcomingFixtures,
      topBatsmen,
      topBowlers,
      recentWinners
    ] = await Promise.all([
      Match.countDocuments(),
      Match.countDocuments({ status: { $in: ['live', 'paused', 'innings_break'] } }),
      Match.countDocuments({ status: 'upcoming' }),
      Match.countDocuments({ status: { $in: ['completed', 'tied'] } }),
      Tournament.countDocuments({ status: { $in: ['upcoming', 'registration_open', 'ongoing'] } }),
      Team.countDocuments(),
      Player.countDocuments(),
      Match.find({ status: { $in: ['live', 'paused', 'innings_break'] } })
        .sort({ updatedAt: -1 })
        .limit(6)
        .lean(),
      Match.find().sort({ matchDate: -1, createdAt: -1 }).limit(8).lean(),
      TournamentFixture.find({ status: 'scheduled' })
        .sort({ scheduledDate: 1 })
        .limit(6)
        .populate('tournamentId', 'name village')
        .lean(),
      Player.find({ 'stats.runs': { $gt: 0 } }).sort({ 'stats.runs': -1 }).limit(5).lean(),
      Player.find({ 'stats.wickets': { $gt: 0 } }).sort({ 'stats.wickets': -1 }).limit(5).lean(),
      Tournament.find({ status: 'completed', winnerTeamId: { $ne: null } })
        .sort({ endDate: -1 })
        .limit(5)
        .populate('winnerTeamId', 'name village logoUrl')
        .lean()
    ]);

    // Attach latest innings score summaries to recent/live matches
    const matchIds = Array.from(new Set([...liveMatches, ...recentMatches].map((m) => String(m._id))));
    const inningsList = await Innings.find({ matchId: { $in: matchIds } })
      .select('matchId inningsNumber battingTeamName totalRuns wickets oversString')
      .lean();

    const inningsMap = {};
    for (const inn of inningsList) {
      const k = String(inn.matchId);
      if (!inningsMap[k]) inningsMap[k] = [];
      inningsMap[k].push(inn);
    }

    const enrich = (m) => ({
      ...m,
      inningsSummary: (inningsMap[String(m._id)] || []).sort((a, b) => a.inningsNumber - b.inningsNumber)
    });

    let notifications = [];
    if (req.user) {
      notifications = await Notification.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(8).lean();
    }

    res.json({
      success: true,
      counts: {
        totalMatches,
        liveMatches: liveCount,
        upcomingMatches: upcomingCount,
        completedMatches: completedCount,
        activeTournaments: activeTournamentsCount,
        totalTeams,
        totalPlayers
      },
      liveMatches: liveMatches.map(enrich),
      recentMatches: recentMatches.map(enrich),
      upcomingFixtures,
      topBatsmen,
      topBowlers,
      recentWinners,
      notifications
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getDashboardSummary };
