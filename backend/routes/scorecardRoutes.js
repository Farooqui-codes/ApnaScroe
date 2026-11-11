const express = require('express');
const router = express.Router();
const scCtrl = require('../controllers/scorecardController');
const { optionalAuth } = require('../middleware/auth');

router.get('/', optionalAuth, scCtrl.listScorecards);
router.get('/:matchId', optionalAuth, scCtrl.getScorecard);
router.get('/:matchId/pdf', optionalAuth, scCtrl.downloadMatchPDF);
router.get('/tournament/:tournamentId/pdf', scCtrl.downloadTournamentPDF);

module.exports = router;
