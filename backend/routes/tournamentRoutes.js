const express = require('express');
const router = express.Router();
const tourCtrl = require('../controllers/tournamentController');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { requireRole, canManageTournament } = require('../middleware/rbac');
const { requireProTournament } = require('../middleware/proAccess');
const { uploadImage } = require('../middleware/upload');

router.get('/', optionalAuth, tourCtrl.listTournaments);
router.get('/:id', tourCtrl.getTournament);
router.post('/', authenticate, requireRole('organizer'), tourCtrl.createTournament);
router.put('/:id', authenticate, canManageTournament, tourCtrl.updateTournament);
router.post('/:id/register-team', authenticate, tourCtrl.registerTeam);
router.post('/:id/approve-team', authenticate, canManageTournament, tourCtrl.approveTeam);
router.put('/:id/entry-fees/:teamId', authenticate, canManageTournament, requireProTournament('Entry Fee Tracker'), tourCtrl.updateEntryFee);
router.post('/:id/fixtures/generate', authenticate, canManageTournament, tourCtrl.generateFixtures);
router.post('/:id/fixtures/manual', authenticate, canManageTournament, tourCtrl.addManualFixture);
router.put('/:id/fixtures/:fixtureId', authenticate, canManageTournament, requireProTournament('Manual Fixture Scheduling'), tourCtrl.updateFixture);
router.post('/:id/winner', authenticate, canManageTournament, tourCtrl.announceWinner);
router.post('/:id/media', authenticate, canManageTournament, uploadImage.single('image'), tourCtrl.uploadTournamentMedia);
router.get('/:id/pro-pdf', authenticate, canManageTournament, requireProTournament('Pro Tournament PDF'), tourCtrl.downloadProPDF);

module.exports = router;
