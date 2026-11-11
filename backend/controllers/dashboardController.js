const Match = require('../models/Match');
const Innings = require('../models/Innings');
const Tournament = require('../models/Tournament');
const TournamentFixture = require('../models/TournamentFixture');
const Team = require('../models/Team');
const Player = require('../models/Player');
const Notification = require('../models/Notification');

async function getDashboardSummary(req, res, next) {
  try {
    const matchVis = req.guest
      ? { $or: [{ ownerType: 'guest', guestId: req.guest.guestId }, { ownerType: { $ne: 'guest' }, isPublic: true }] }
      : (req.user
        ? (req.user.role === 'super_admin' ? {} : { $or: [{ ownerType: { $ne: 'guest' }, isPublic: true }, { userId: req.user._id }, { scorerId: req.user._id }] })
        : { ownerType: { $ne: 'guest' }, isPublic: true });

    const teamVis = req.guest
      ? { $or: [{ ownerType: 'guest', guestId: req.guest.guestId }, { ownerType: { $ne: 'guest' } }] }
      : { ownerType: { $ne: 'guest' } };

    const playerVis = req.guest
      ? { $or: [{ ownerType: 'guest', guestId: req.guest.guestId }, { ownerType: { $ne: 'guest' } }] }
      : { ownerType: { $ne: 'guest' } };

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
      Match.countDocuments(matchVis),
      Match.countDocuments({ $and: [matchVis, { status: { $in: ['live', 'paused', 'innings_break'] } }] }),
      Match.countDocuments({ $and: [matchVis, { status: 'upcoming' }] }),
      Match.countDocuments({ $and: [matchVis, { status: { $in: ['completed', 'tied'] } }] }),
      Tournament.countDocuments({ status: { $in: ['upcoming', 'registration_open', 'ongoing'] } }),
      Team.countDocuments(teamVis),
      Player.countDocuments(playerVis),
      Match.find({ $and: [matchVis, { status: { $in: ['live', 'paused', 'innings_break'] } }] })
        .sort({ updatedAt: -1 })
        .limit(6)
        .lean(),
      Match.find(matchVis).sort({ matchDate: -1, createdAt: -1 }).limit(8).lean(),
      TournamentFixture.find({ status: 'scheduled' })
        .sort({ scheduledDate: 1 })
        .limit(6)
        .populate('tournamentId', 'name village')
        .lean(),
      Player.find({ $and: [playerVis, { 'stats.runs': { $gt: 0 } }] }).sort({ 'stats.runs': -1 }).limit(5).lean(),
      Player.find({ $and: [playerVis, { 'stats.wickets': { $gt: 0 } }] }).sort({ 'stats.wickets': -1 }).limit(5).lean(),
      Tournament.find({ status: 'completed', winnerTeamId: { $ne: null } })
        .sort({ endDate: -1 })
        .limit(5)
        .populate('winnerTeamId', 'name village logoUrl')
        .lean()
    ]);

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
