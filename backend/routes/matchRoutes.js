const express = require('express');
const router = express.Router();
const matchCtrl = require('../controllers/matchController');
const { authenticate } = require('../middleware/auth');
const { requireRole, canScoreMatch } = require('../middleware/rbac');

router.get('/', matchCtrl.listMatches);
router.get('/:id', matchCtrl.getMatch);
router.post('/', authenticate, requireRole('organizer', 'team_manager', 'scorer'), matchCtrl.createMatch);
router.post('/:id/second-innings', authenticate, canScoreMatch, matchCtrl.startSecondInnings);
router.post('/:id/super-over', authenticate, canScoreMatch, matchCtrl.startSuperOver);
router.post('/:id/control', authenticate, canScoreMatch, matchCtrl.updateMatchControl);

module.exports = router;
