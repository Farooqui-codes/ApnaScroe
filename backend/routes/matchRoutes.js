const express = require('express');
const router = express.Router();
const matchCtrl = require('../controllers/matchController');
const scCtrl = require('../controllers/scorecardController');
const { authenticateOrGuest, optionalAuth } = require('../middleware/auth');
const { requireRegisteredOrGuestScoring, canScoreMatch } = require('../middleware/rbac');

router.get('/', optionalAuth, matchCtrl.listMatches);
router.get('/:id', optionalAuth, matchCtrl.getMatch);
router.get('/:matchId/pdf', optionalAuth, scCtrl.downloadMatchPDF);
router.post('/', authenticateOrGuest, requireRegisteredOrGuestScoring, matchCtrl.createMatch);
router.post('/:id/second-innings', authenticateOrGuest, canScoreMatch, matchCtrl.startSecondInnings);
router.post('/:id/super-over', authenticateOrGuest, canScoreMatch, matchCtrl.startSuperOver);
router.post('/:id/control', authenticateOrGuest, canScoreMatch, matchCtrl.updateMatchControl);

module.exports = router;
