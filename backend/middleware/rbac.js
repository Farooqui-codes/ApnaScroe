const Match = require('../models/Match');
const Tournament = require('../models/Tournament');
const Team = require('../models/Team');

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        requiresAccount: Boolean(req.guest),
        message: req.guest
          ? 'Create a free account to publish your match and manage tournaments.'
          : 'Authentication required.'
      });
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

function requireRegisteredOrGuestScoring(req, res, next) {
  if (req.user) {
    if (req.user.role === 'super_admin' || ['organizer', 'team_manager', 'scorer'].includes(req.user.role)) {
      return next();
    }
    return res.status(403).json({ success: false, message: 'Viewer role cannot create or edit scoring records.' });
  }
  if (req.guest) return next();
  return res.status(401).json({ success: false, message: 'Authentication or guest session required.' });
}

async function canScoreMatch(req, res, next) {
  try {
    if (!req.user && !req.guest) {
      return res.status(401).json({ success: false, message: 'Authentication or guest session required.' });
    }
    const matchId = req.params.matchId || req.params.id || req.body.matchId;
    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ success: false, message: 'Match not found.' });

    if (req.guest) {
      if (match.ownerType === 'guest' && match.guestId === req.guest.guestId) {
        req.match = match;
        return next();
      }
      return res.status(403).json({ success: false, message: 'You do not have permission to access or score this match.' });
    }

    const uid = String(req.user._id);
    const isAdmin = req.user.role === 'super_admin';
    const isOwnerScorer = String(match.scorerId || match.userId) === uid;
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
    if (!req.user) {
      return res.status(403).json({
        success: false,
        requiresAccount: true,
        message: 'Create a free account to publish your match and manage tournaments.'
      });
    }
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
    if (!req.user && !req.guest) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    const team = await Team.findById(req.params.id || req.params.teamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found.' });

    if (req.guest) {
      if (team.ownerType === 'guest' && team.guestId === req.guest.guestId) {
        req.team = team;
        return next();
      }
      return res.status(403).json({ success: false, message: 'You do not have permission to edit this team.' });
    }

    const uid = String(req.user._id);
    if (
      req.user.role === 'super_admin' ||
      req.user.role === 'organizer' ||
      String(team.managerId || team.userId) === uid
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
  requireRegisteredOrGuestScoring,
  canScoreMatch,
  canManageTournament,
  canManageTeam
};
