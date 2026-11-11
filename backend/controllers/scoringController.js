const { v4: uuidv4 } = require('uuid');
const Innings = require('../models/Innings');
const Delivery = require('../models/Delivery');
const engine = require('../services/scoringEngine');
const syncService = require('../services/syncService');
const liveSocket = require('../sockets/liveSocket');
const { logAudit } = require('../utils/logger');

async function recordEvent(req, res, next) {
  try {
    const match = req.match;
    const inningsNumber = Number(req.body.inningsNumber || match.currentInningsNumber || 1);
    const innings = await Innings.findOne({ matchId: match._id, inningsNumber });
    if (!innings) {
      return res.status(404).json({ success: false, message: `Innings ${inningsNumber} not found.` });
    }

    const eventId = req.body.eventId || uuidv4();

    // Idempotency check
    const duplicate = await Delivery.findOne({ matchId: match._id, eventId });
    if (duplicate) {
      return res.json({
        success: true,
        deduplicated: true,
        match,
        innings,
        state: innings.computedState
      });
    }

    const currentState = innings.computedState || engine.createEmptyInningsState({
      inningsNumber,
      battingTeamId: innings.battingTeamId,
      battingTeamName: innings.battingTeamName,
      bowlingTeamId: innings.bowlingTeamId,
      bowlingTeamName: innings.bowlingTeamName,
      target: innings.target,
      rules: match.rulesSnapshot
    });

    const eventType = req.body.eventType || 'delivery';

    if (eventType === 'delivery') {
      const validation = engine.validateDeliveryInput(currentState, req.body, match.rulesSnapshot);
      if (!validation.valid) {
        return res.status(400).json({ success: false, message: validation.errors.join(' ') });
      }
    }

    if (eventType === 'change_bowler') {
      const rules = match.rulesSnapshot;
      const newBowlerId = String(req.body.bowlerId || '');
      if (
        rules.format &&
        rules.format.noConsecutiveOversBySameBowler &&
        currentState.lastCompletedOverBowlerId &&
        newBowlerId === String(currentState.lastCompletedOverBowlerId) &&
        currentState.ballsInCurrentOver === 0
      ) {
        return res.status(400).json({
          success: false,
          message: 'Same bowler cannot bowl consecutive overs under current match rules.'
        });
      }
      const bStat = currentState.bowlingStats && currentState.bowlingStats[newBowlerId];
      const maxOvers = rules.format && rules.format.maxOversPerBowler;
      const bpo = (rules.format && rules.format.ballsPerOver) || 6;
      if (maxOvers > 0 && bStat && bStat.legalBalls >= maxOvers * bpo) {
        return res.status(400).json({
          success: false,
          message: `Bowler has reached the maximum quota of ${maxOvers} over(s).`
        });
      }
    }

    if (eventType === 'set_openers') {
      if (req.body.strikerId) {
        innings.openingStrikerId = String(req.body.strikerId);
        innings.openingStrikerName = req.body.strikerName || '';
      }
      if (req.body.nonStrikerId) {
        innings.openingNonStrikerId = String(req.body.nonStrikerId);
        innings.openingNonStrikerName = req.body.nonStrikerName || '';
      }
      if (req.body.bowlerId) {
        innings.openingBowlerId = String(req.body.bowlerId);
        innings.openingBowlerName = req.body.bowlerName || '';
      }
      await innings.save();
    }

    const lastDoc = await Delivery.findOne({ matchId: match._id, inningsNumber }).sort({ sequence: -1 }).select('sequence');
    const sequence = req.body.sequence ? Number(req.body.sequence) : (lastDoc ? lastDoc.sequence + 1 : 1);

    await Delivery.create({
      matchId: match._id,
      inningsId: innings._id,
      inningsNumber,
      eventId,
      sequence,
      eventType,
      extraType: req.body.extraType || 'none',
      batRuns: Number(req.body.batRuns || 0),
      additionalExtraRuns: Number(req.body.additionalExtraRuns || 0),
      overthrowRuns: Number(req.body.overthrowRuns || 0),
      deltaRuns: Number(req.body.deltaRuns || 0),
      isFour: Boolean(req.body.isFour),
      isSix: Boolean(req.body.isSix),
      notBoundary: Boolean(req.body.notBoundary),
      overthrowBoundary: Boolean(req.body.overthrowBoundary),
      isWicket: Boolean(req.body.isWicket),
      wicketType: req.body.wicketType || null,
      oneTipCatch: Boolean(req.body.oneTipCatch),
      dismissedSlot: req.body.dismissedSlot || null,
      dismissedPlayerId: req.body.dismissedPlayerId || null,
      dismissedPlayerName: req.body.dismissedPlayerName || '',
      fielderId: req.body.fielderId || null,
      fielderName: req.body.fielderName || '',
      strikerId: req.body.strikerId || currentState.strikerId || null,
      strikerName: req.body.strikerName || '',
      nonStrikerId: req.body.nonStrikerId || currentState.nonStrikerId || null,
      nonStrikerName: req.body.nonStrikerName || '',
      bowlerId: req.body.bowlerId || currentState.currentBowlerId || null,
      bowlerName: req.body.bowlerName || '',
      playerId: req.body.playerId || null,
      playerName: req.body.playerName || '',
      replacementPlayerId: req.body.replacementPlayerId || null,
      replacementPlayerName: req.body.replacementPlayerName || '',
      slot: req.body.slot || null,
      reason: req.body.reason || '',
      commentary: req.body.commentary || '',
      deviceId: req.body.deviceId || 'web'
    });

    if (match.status === 'upcoming' || match.status === 'paused') {
      match.status = 'live';
      await match.save();
    }

    const { innings: updatedInnings, state } = await syncService.recomputeAndPersistInnings(match, inningsNumber);

    liveSocket.emitMatchUpdate(String(match._id), {
      matchId: String(match._id),
      match,
      innings: updatedInnings,
      state
    });

    res.status(201).json({
      success: true,
      eventId,
      sequence,
      match,
      innings: updatedInnings,
      state
    });
  } catch (err) {
    next(err);
  }
}

async function undoLastEvent(req, res, next) {
  try {
    const match = req.match;
    const inningsNumber = Number(req.body.inningsNumber || match.currentInningsNumber || 1);

    const lastActive = await Delivery.findOne({
      matchId: match._id,
      inningsNumber,
      isVoided: { $ne: true }
    }).sort({ sequence: -1 });

    if (!lastActive) {
      return res.status(400).json({ success: false, message: 'No scoring events left to undo in this innings.' });
    }

    lastActive.isVoided = true;
    lastActive.editedAt = new Date();
    await lastActive.save();

    if (match.status === 'completed' || match.status === 'innings_break' || match.status === 'tied') {
      match.status = 'live';
      match.result = { winnerTeamId: null, winnerTeamName: '', isTie: false, marginText: '' };
      await match.save();
    }

    const { innings: updatedInnings, state } = await syncService.recomputeAndPersistInnings(match, inningsNumber);
    await logAudit({
      req,
      action: 'BALL_UNDONE',
      entityType: 'Delivery',
      entityId: lastActive._id,
      details: { matchId: match._id, eventId: lastActive.eventId }
    });

    liveSocket.emitMatchUpdate(String(match._id), { matchId: String(match._id), match, innings: updatedInnings, state });
    res.json({ success: true, undoneEventId: lastActive.eventId, match, innings: updatedInnings, state });
  } catch (err) {
    next(err);
  }
}

async function editEvent(req, res, next) {
  try {
    const match = req.match;
    const { eventId } = req.params;
    const delivery = await Delivery.findOne({ matchId: match._id, eventId });
    if (!delivery) {
      return res.status(404).json({ success: false, message: 'Delivery event not found.' });
    }

    const editable = [
      'extraType',
      'batRuns',
      'additionalExtraRuns',
      'overthrowRuns',
      'isFour',
      'isSix',
      'isWicket',
      'wicketType',
      'dismissedSlot',
      'dismissedPlayerId',
      'dismissedPlayerName',
      'fielderName',
      'commentary',
      'isVoided'
    ];
    for (const field of editable) {
      if (req.body[field] !== undefined) {
        delivery[field] = req.body[field];
      }
    }
    delivery.editedAt = new Date();
    await delivery.save();

    const { innings: updatedInnings, state } = await syncService.recomputeAndPersistInnings(match, delivery.inningsNumber);
    await logAudit({
      req,
      action: 'BALL_EDITED',
      entityType: 'Delivery',
      entityId: delivery._id,
      details: { matchId: match._id, eventId }
    });

    liveSocket.emitMatchUpdate(String(match._id), { matchId: String(match._id), match, innings: updatedInnings, state });
    res.json({ success: true, delivery, match, innings: updatedInnings, state });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  recordEvent,
  undoLastEvent,
  editEvent
};
