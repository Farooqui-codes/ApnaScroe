const Match = require('../models/Match');
const Tournament = require('../models/Tournament');
const Team = require('../models/Team');

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    if (req.user.role === 'super_admin' || allowedRoles.includes(req.user.role)) {
      return next();
    }
    return res.status(403).json({
      success: false,
      message: `Access denied. Required role: ${allowedRoles.join(' or ')}.`
    });
  };
}

async function canScoreMatch(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required.' });
    const matchId = req.params.matchId || req.params.id || req.body.matchId;
    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ success: false, message: 'Match not found.' });

    const uid = String(req.user._id);
    const isAdmin = req.user.role === 'super_admin';
    const isOwnerScorer = String(match.scorerId) === uid;
    const isAuthorizedScorer = (match.authorizedScorers || []).some((id) => String(id) === uid);

    let isTournamentOrganizer = false;
    if (match.tournamentId) {
      const tour = await Tournament.findById(match.tournamentId).select('organizerId assignedScorers');
      if (tour) {
        isTournamentOrganizer =
          String(tour.organizerId) === uid ||
          (tour.assignedScorers || []).some((id) => String(id) === uid);
      }
    }

    if (isAdmin || isOwnerScorer || isAuthorizedScorer || isTournamentOrganizer) {
      req.match = match;
      return next();
    }

    return res.status(403).json({
      success: false,
      message: 'You do not have scoring permission for this match.'
    });
  } catch (err) {
    next(err);
  }
}

async function canManageTournament(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required.' });
    const tour = await Tournament.findById(req.params.id || req.params.tournamentId);
    if (!tour) return res.status(404).json({ success: false, message: 'Tournament not found.' });

    const uid = String(req.user._id);
    if (req.user.role === 'super_admin' || String(tour.organizerId) === uid) {
      req.tournament = tour;
      return next();
    }
    return res.status(403).json({
      success: false,
      message: 'Only the tournament organizer or Super Admin can modify this tournament.'
    });
  } catch (err) {
    next(err);
  }
}

async function canManageTeam(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required.' });
    const team = await Team.findById(req.params.id || req.params.teamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found.' });

    const uid = String(req.user._id);
    if (
      req.user.role === 'super_admin' ||
      req.user.role === 'organizer' ||
      String(team.managerId) === uid
    ) {
      req.team = team;
      return next();
    }
    return res.status(403).json({
      success: false,
      message: 'You do not have permission to edit this team.'
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  requireRole,
  canScoreMatch,
  canManageTournament,
  canManageTeam
};
