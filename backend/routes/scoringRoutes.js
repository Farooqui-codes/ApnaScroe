const express = require('express');
const router = express.Router();
const scoringCtrl = require('../controllers/scoringController');
const { authenticate } = require('../middleware/auth');
const { canScoreMatch } = require('../middleware/rbac');

router.post('/:matchId/event', authenticate, canScoreMatch, scoringCtrl.recordEvent);
router.post('/:matchId/undo', authenticate, canScoreMatch, scoringCtrl.undoLastEvent);
router.put('/:matchId/events/:eventId', authenticate, canScoreMatch, scoringCtrl.editEvent);

module.exports = router;
