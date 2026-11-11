const Match = require('../models/Match');
const Innings = require('../models/Innings');
const Scorecard = require('../models/Scorecard');
const Tournament = require('../models/Tournament');
const TournamentFixture = require('../models/TournamentFixture');
const PointsTable = require('../models/PointsTable');
const Award = require('../models/Award');
const pdfService = require('../services/pdfService');
const syncService = require('../services/syncService');

async function listScorecards(req, res, next) {
  try {
    const scorecards = await Scorecard.find().sort({ matchDate: -1, updatedAt: -1 }).limit(50).lean();
    res.json({ success: true, scorecards });
  } catch (err) {
    next(err);
  }
}

async function getScorecard(req, res, next) {
  try {
    const match = await Match.findById(req.params.matchId).populate('tournamentId', 'name village');
    if (!match) return res.status(404).json({ success: false, message: 'Match not found.' });

    let scorecard = await Scorecard.findOne({ matchId: match._id }).lean();
    if (!scorecard) {
      await syncService.upsertScorecard(match);
      scorecard = await Scorecard.findOne({ matchId: match._id }).lean();
    }
    const innings = await Innings.find({ matchId: match._id }).sort({ inningsNumber: 1 }).lean();

    res.json({ success: true, scorecard, match, innings });
  } catch (err) {
    next(err);
  }
}

async function downloadMatchPDF(req, res, next) {
  try {
    const match = await Match.findById(req.params.matchId).lean();
    if (!match) return res.status(404).json({ success: false, message: 'Match not found.' });

    const inningsList = await Innings.find({ matchId: match._id }).sort({ inningsNumber: 1 }).lean();
    const tournament = match.tournamentId
      ? await Tournament.findById(match.tournamentId).select('name village').lean()
      : null;

    const pdfBuffer = await pdfService.generateMatchScorecardPDF({ match, inningsList, tournament });
    const safeName = String(match.title || 'match-scorecard').replace(/[^a-z0-9-_]+/gi, '_').toLowerCase();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ApnaScore_${safeName}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
}

async function downloadTournamentPDF(req, res, next) {
  try {
    const tournament = await Tournament.findById(req.params.tournamentId).lean();
    if (!tournament) return res.status(404).json({ success: false, message: 'Tournament not found.' });

    const [fixtures, pointsTable, awards] = await Promise.all([
      TournamentFixture.find({ tournamentId: tournament._id }).sort({ roundOrder: 1, matchNumber: 1 }).lean(),
      PointsTable.find({ tournamentId: tournament._id }).sort({ points: -1, netRunRate: -1 }).lean(),
      Award.find({ tournamentId: tournament._id }).lean()
    ]);

    const pdfBuffer = await pdfService.generateTournamentPDF({ tournament, fixtures, pointsTable, awards });
    const safeName = String(tournament.name || 'tournament').replace(/[^a-z0-9-_]+/gi, '_').toLowerCase();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ApnaScore_${safeName}_Results.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listScorecards,
  getScorecard,
  downloadMatchPDF,
  downloadTournamentPDF
};
