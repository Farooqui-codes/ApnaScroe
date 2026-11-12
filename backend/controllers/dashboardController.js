const Match = require('../models/Match');
const Innings = require('../models/Innings');
const Tournament = require('../models/Tournament');
const Team = require('../models/Team');
const Player = require('../models/Player');

/**
 * Returns dashboard summary strictly scoped to the current user or guest session.
 * Never returns dummy data or inflated global stats for an empty account.
 */
async function getDashboardSummary(req, res, next) {
  try {
    if (!req.user && !req.guest) {
      return res.json({
        success: true,
        counts: {
          totalMatches: 0,
          liveMatches: 0,
          upcomingMatches: 0,
          completedMatches: 0,
          activeTournaments: 0,
          totalTeams: 0,
          totalPlayers: 0
        },
        liveMatches: [],
        recentMatches: []
      });
    }

    const matchOwnerFilter = req.guest
      ? { ownerType: 'guest', guestId: req.guest.guestId }
      : { $or: [{ userId: req.user._id }, { scorerId: req.user._id }, { authorizedScorers: req.user._id }] };

    const teamOwnerFilter = req.guest
      ? { ownerType: 'guest', guestId: req.guest.guestId }
      : { $or: [{ userId: req.user._id }, { managerId: req.user._id }] };

    const playerOwnerFilter = req.guest
      ? { ownerType: 'guest', guestId: req.guest.guestId }
      : { $or: [{ userId: req.user._id }, { createdBy: req.user._id }] };

    const tourOwnerFilter = req.guest
      ? { _id: null }
      : { organizerId: req.user._id, status: { $in: ['upcoming', 'registration_open', 'ongoing'] } };

    const [
      totalMatches,
      liveCount,
      upcomingCount,
      completedCount,
      activeTournamentsCount,
      totalTeams,
      totalPlayers,
      liveMatches,
      recentMatches
    ] = await Promise.all([
      Match.countDocuments(matchOwnerFilter),
      Match.countDocuments({ $and: [matchOwnerFilter, { status: { $in: ['live', 'paused', 'innings_break'] } }] }),
      Match.countDocuments({ $and: [matchOwnerFilter, { status: 'upcoming' }] }),
      Match.countDocuments({ $and: [matchOwnerFilter, { status: { $in: ['completed', 'tied'] } }] }),
      req.guest ? 0 : Tournament.countDocuments(tourOwnerFilter),
      Team.countDocuments(teamOwnerFilter),
      Player.countDocuments(playerOwnerFilter),
      Match.find({ $and: [matchOwnerFilter, { status: { $in: ['live', 'paused', 'innings_break'] } }] })
        .sort({ updatedAt: -1 })
        .limit(4)
        .lean(),
      Match.find(matchOwnerFilter).sort({ matchDate: -1, createdAt: -1 }).limit(6).lean()
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
      recentMatches: recentMatches.map(enrich)
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getDashboardSummary };
