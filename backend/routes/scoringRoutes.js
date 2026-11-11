const express = require('express');
const router = express.Router();
const scoringCtrl = require('../controllers/scoringController');
const { authenticateOrGuest } = require('../middleware/auth');
const { canScoreMatch } = require('../middleware/rbac');

router.post('/:matchId/event', authenticateOrGuest, canScoreMatch, scoringCtrl.recordEvent);
router.post('/:matchId/undo', authenticateOrGuest, canScoreMatch, scoringCtrl.undoLastEvent);
router.put('/:matchId/events/:eventId', authenticateOrGuest, canScoreMatch, scoringCtrl.editEvent);

module.exports = router;
