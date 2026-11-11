const express = require('express');
const router = express.Router();
const scCtrl = require('../controllers/scorecardController');

router.get('/', scCtrl.listScorecards);
router.get('/:matchId', scCtrl.getScorecard);
router.get('/:matchId/pdf', scCtrl.downloadMatchPDF);
router.get('/tournament/:tournamentId/pdf', scCtrl.downloadTournamentPDF);

module.exports = router;
