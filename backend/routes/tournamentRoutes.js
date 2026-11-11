const express = require('express');
const router = express.Router();
const tourCtrl = require('../controllers/tournamentController');
const { authenticate } = require('../middleware/auth');
const { requireRole, canManageTournament } = require('../middleware/rbac');
const { uploadImage } = require('../middleware/upload');

router.get('/', tourCtrl.listTournaments);
router.get('/:id', tourCtrl.getTournament);
router.post('/', authenticate, requireRole('organizer'), tourCtrl.createTournament);
router.put('/:id', authenticate, canManageTournament, tourCtrl.updateTournament);
router.post('/:id/register-team', authenticate, tourCtrl.registerTeam);
router.post('/:id/approve-team', authenticate, canManageTournament, tourCtrl.approveTeam);
router.post('/:id/fixtures/generate', authenticate, canManageTournament, tourCtrl.generateFixtures);
router.post('/:id/fixtures/manual', authenticate, canManageTournament, tourCtrl.addManualFixture);
router.post('/:id/winner', authenticate, canManageTournament, tourCtrl.announceWinner);
router.post('/:id/media', authenticate, canManageTournament, uploadImage.single('image'), tourCtrl.uploadTournamentMedia);

module.exports = router;
