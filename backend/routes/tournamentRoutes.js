const express = require('express');
const router = express.Router();
const tourCtrl = require('../controllers/tournamentController');
const { authenticateOrGuest, optionalAuth } = require('../middleware/auth');
const { canManageTournament } = require('../middleware/rbac');
const { requireProTournament } = require('../middleware/proAccess');
const { uploadImage } = require('../middleware/upload');

router.get('/', optionalAuth, tourCtrl.listTournaments);
router.get('/:id', tourCtrl.getTournament);
router.post('/', authenticateOrGuest, tourCtrl.createTournament);
router.put('/:id', authenticateOrGuest, canManageTournament, tourCtrl.updateTournament);
router.post('/:id/register-team', authenticateOrGuest, tourCtrl.registerTeam);
router.post('/:id/approve-team', authenticateOrGuest, canManageTournament, tourCtrl.approveTeam);
router.put('/:id/entry-fees/:teamId', authenticateOrGuest, canManageTournament, tourCtrl.updateEntryFee);
router.post('/:id/fixtures/generate', authenticateOrGuest, canManageTournament, tourCtrl.generateFixtures);
router.post('/:id/fixtures/manual', authenticateOrGuest, canManageTournament, tourCtrl.addManualFixture);
router.put('/:id/fixtures/:fixtureId', authenticateOrGuest, canManageTournament, tourCtrl.updateFixture);
router.post('/:id/winner', authenticateOrGuest, canManageTournament, tourCtrl.announceWinner);
router.post('/:id/media', authenticateOrGuest, canManageTournament, uploadImage.single('image'), tourCtrl.uploadTournamentMedia);
router.get('/:id/pro-pdf', authenticateOrGuest, canManageTournament, tourCtrl.downloadProPDF);

module.exports = router;
