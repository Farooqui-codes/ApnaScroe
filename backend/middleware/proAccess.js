const { hasProAccess } = require('../config/plans');

/**
 * Server-side enforcement for Tournament Manager Pro features.
 * Assumes req.tournament is already loaded (e.g. via canManageTournament).
 */
function requireProTournament(featureLabel = 'Tournament Manager Pro') {
  return (req, res, next) => {
    const tournament = req.tournament;
    if (!tournament) {
      return res.status(404).json({ success: false, message: 'Tournament not found.' });
    }
    if (hasProAccess(tournament, req.user)) {
      return next();
    }
    return res.status(403).json({
      success: false,
      requiresPro: true,
      feature: featureLabel,
      tournamentId: tournament._id,
      message: `${featureLabel} is a Tournament Manager Pro feature. Upgrade this tournament to Pro to unlock.`
    });
  };
}

module.exports = { requireProTournament };
