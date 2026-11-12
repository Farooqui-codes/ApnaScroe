const Match = require('../models/Match');
const Innings = require('../models/Innings');
const Delivery = require('../models/Delivery');
const Scorecard = require('../models/Scorecard');
const Tournament = require('../models/Tournament');
const TournamentFixture = require('../models/TournamentFixture');
const engine = require('./scoringEngine');
const statsService = require('./statsService');
const tournamentService = require('./tournamentService');

/**
 * Replays an entire innings from MongoDB Delivery events, updates Innings doc,
 * updates Match summary/result if completed, and updates Scorecard.
 */
async function recomputeAndPersistInnings(match, inningsNumber) {
  const innings = await Innings.findOne({ matchId: match._id, inningsNumber });
  if (!innings) throw new Error(`Innings ${inningsNumber} not found`);

  const events = await Delivery.find({
    matchId: match._id,
    inningsNumber,
    isVoided: { $ne: true }
  }).sort({ sequence: 1 }).lean();

  const battingTeamObj = String(innings.battingTeamId) === String(match.teamA.teamId) ? match.teamA : match.teamB;
  const bowlingTeamObj = String(innings.bowlingTeamId) === String(match.teamA.teamId) ? match.teamA : match.teamB;

  const state = engine.replayInnings(
    {
      inningsNumber: innings.inningsNumber,
      battingTeamId: innings.battingTeamId,
      battingTeamName: innings.battingTeamName,
      bowlingTeamId: innings.bowlingTeamId,
      bowlingTeamName: innings.bowlingTeamName,
      target: innings.target,
      openingStrikerId: innings.openingStrikerId,
      openingStrikerName: innings.openingStrikerName,
      openingNonStrikerId: innings.openingNonStrikerId,
      openingNonStrikerName: innings.openingNonStrikerName,
      openingBowlerId: innings.openingBowlerId,
      openingBowlerName: innings.openingBowlerName,
      battingSquad: battingTeamObj.squad || [],
      bowlingSquad: bowlingTeamObj.squad || [],
      rules: match.rulesSnapshot
    },
    events
  );

  innings.totalRuns = state.totalRuns;
  innings.wickets = state.wickets;
  innings.legalBalls = state.legalBalls;
  innings.oversString = state.oversString;
  innings.extrasBreakdown = state.extrasBreakdown;
  innings.status = state.status;
  innings.computedState = state;
  innings.lastSequence = events.length > 0 ? events[events.length - 1].sequence : 0;
  await innings.save();

  // Handle match progression & result atomically (incrementing version)
  if (inningsNumber === 1 && state.status === 'completed' && match.status === 'live') {
    match.status = 'innings_break';
    await Match.findOneAndUpdate(
      { _id: match._id },
      { $set: { status: 'innings_break' }, $inc: { version: 1 } }
    );
  } else if (inningsNumber === 2 && state.status === 'completed') {
    const inn1 = await Innings.findOne({ matchId: match._id, inningsNumber: 1 });
    if (inn1) {
      const res = engine.evaluateMatchResult(inn1.computedState || inn1, state, match.rulesSnapshot);
      if (res) {
        const nextResult = Object.assign({}, match.result || {}, {
          winnerTeamId: res.winnerTeamId,
          winnerTeamName: res.winnerTeamName,
          isTie: res.isTie,
          marginText: res.marginText
        });
        match.status = res.status;
        match.result = nextResult;
        await Match.findOneAndUpdate(
          { _id: match._id },
          { $set: { status: res.status, result: nextResult }, $inc: { version: 1 } }
        );

        // Update linked tournament fixture & points table
        if (match.fixtureId) {
          await TournamentFixture.findByIdAndUpdate(match.fixtureId, {
            status: 'completed',
            winnerTeamId: res.winnerTeamId,
            resultText: res.marginText
          });
        }
        if (match.tournamentId) {
          await tournamentService.rebuildPointsTable(match.tournamentId);
        }
        await statsService.syncPlayersAndTeamsForMatch(match._id);
      }
    }
  }

  await upsertScorecard(match);
  return { innings, state };
}

async function upsertScorecard(match) {
  const inningsList = await Innings.find({ matchId: match._id }).sort({ inningsNumber: 1 });
  let tournamentName = '';
  if (match.tournamentId) {
    const t = await Tournament.findById(match.tournamentId).select('name');
    if (t) tournamentName = t.name;
  }
  const tossText = match.toss && match.toss.winnerTeamName
    ? `${match.toss.winnerTeamName} won the toss and elected to ${match.toss.decision || 'bat'}`
    : '';

  const summaries = inningsList.map((inn) => ({
    inningsNumber: inn.inningsNumber,
    battingTeamId: inn.battingTeamId,
    battingTeamName: inn.battingTeamName,
    bowlingTeamName: inn.bowlingTeamName,
    totalRuns: inn.totalRuns,
    wickets: inn.wickets,
    oversString: inn.oversString,
    target: inn.target,
    extrasBreakdown: inn.extrasBreakdown,
    computedState: inn.computedState
  }));

  await Scorecard.findOneAndUpdate(
    { matchId: match._id },
    {
      ownerType: match.ownerType || 'user',
      guestId: match.guestId || null,
      userId: match.userId || match.scorerId || null,
      sourceGuestId: match.sourceGuestId || null,
      migratedAt: match.migratedAt || null,
      matchId: match._id,
      title: match.title,
      tournamentId: match.tournamentId,
      tournamentName,
      venue: match.venue,
      matchDate: match.matchDate,
      tossText,
      resultText: (match.result && match.result.marginText) || match.status,
      playerOfMatch: (match.result && match.result.playerOfMatchName) || '',
      inningsSummaries: summaries,
      generatedAt: new Date()
    },
    { upsert: true, new: true }
  );
}

/**
 * Idempotent batch sync of offline deliveries for a match.
 * Prevents duplicate deliveries via (matchId, eventId) and detects stale/conflicting device locks.
 */
async function syncOfflineEvents({ match, inningsNumber, events, deviceId, userId, guestId }) {
  // Check scorer lock ownership
  const lockedByOtherUser = match.scorerLock && match.scorerLock.userId && userId && String(match.scorerLock.userId) !== String(userId);
  const lockedByOtherGuest = match.scorerLock && match.scorerLock.guestId && guestId && match.scorerLock.guestId !== guestId;
  if (
    match.scorerLock &&
    match.scorerLock.deviceId &&
    deviceId &&
    match.scorerLock.deviceId !== deviceId &&
    (lockedByOtherUser || lockedByOtherGuest)
  ) {
    return {
      ok: false,
      conflict: true,
      message: 'This match is currently locked for scoring by another user/device. Take over scoring lock explicitly before syncing.'
    };
  }

  let innings = await Innings.findOne({ matchId: match._id, inningsNumber });
  if (!innings) {
    return { ok: false, conflict: false, message: `Innings ${inningsNumber} not initialized.` };
  }

  // Acquire/refresh scorer lock atomically
  const nextLock = { deviceId: deviceId || 'web', userId: userId || null, guestId: guestId || null, lockedAt: new Date() };
  match.scorerLock = nextLock;
  await Match.findOneAndUpdate(
    { _id: match._id },
    { $set: { scorerLock: nextLock }, $inc: { version: 1 } }
  );

  let syncedCount = 0;
  let duplicateCount = 0;

  const sorted = (events || []).slice().sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

  for (const ev of sorted) {
    if (!ev.eventId) continue;
    const existing = await Delivery.findOne({ matchId: match._id, eventId: ev.eventId });
    if (existing) {
      // Idempotency: if already stored, do not duplicate; only update if explicitly edited later
      if (ev.editedAt && (!existing.editedAt || new Date(ev.editedAt) > new Date(existing.editedAt))) {
        Object.assign(existing, {
          batRuns: ev.batRuns ?? existing.batRuns,
          additionalExtraRuns: ev.additionalExtraRuns ?? existing.additionalExtraRuns,
          overthrowRuns: ev.overthrowRuns ?? existing.overthrowRuns,
          extraType: ev.extraType ?? existing.extraType,
          isWicket: ev.isWicket ?? existing.isWicket,
          wicketType: ev.wicketType ?? existing.wicketType,
          isVoided: ev.isVoided ?? existing.isVoided,
          commentary: ev.commentary ?? existing.commentary,
          editedAt: new Date(ev.editedAt)
        });
        await existing.save();
        syncedCount += 1;
      } else {
        duplicateCount += 1;
      }
      continue;
    }

    // Prevent overwriting newer server events with lower sequence numbers unless it's a higher sequence
    const seq = Number(ev.sequence) || (innings.lastSequence + 1);
    await Delivery.create({
      matchId: match._id,
      inningsId: innings._id,
      inningsNumber,
      over: Number(ev.over || 0),
      ball: Number(ev.ball || 0),
      eventId: ev.eventId,
      clientActionId: ev.clientActionId || `${match._id}:${ev.eventId}`,
      sequence: seq,
      eventType: ev.eventType || 'delivery',
      extraType: ev.extraType || 'none',
      batRuns: ev.batRuns || 0,
      additionalExtraRuns: ev.additionalExtraRuns || 0,
      overthrowRuns: ev.overthrowRuns || 0,
      deltaRuns: ev.deltaRuns || 0,
      isFour: Boolean(ev.isFour),
      isSix: Boolean(ev.isSix),
      notBoundary: Boolean(ev.notBoundary),
      overthrowBoundary: Boolean(ev.overthrowBoundary),
      isWicket: Boolean(ev.isWicket),
      wicketType: ev.wicketType || null,
      oneTipCatch: Boolean(ev.oneTipCatch),
      dismissedSlot: ev.dismissedSlot || null,
      dismissedPlayerId: ev.dismissedPlayerId || null,
      dismissedPlayerName: ev.dismissedPlayerName || '',
      fielderId: ev.fielderId || null,
      fielderName: ev.fielderName || '',
      strikerId: ev.strikerId || null,
      strikerName: ev.strikerName || '',
      nonStrikerId: ev.nonStrikerId || null,
      nonStrikerName: ev.nonStrikerName || '',
      bowlerId: ev.bowlerId || null,
      bowlerName: ev.bowlerName || '',
      playerId: ev.playerId || null,
      playerName: ev.playerName || '',
      replacementPlayerId: ev.replacementPlayerId || null,
      replacementPlayerName: ev.replacementPlayerName || '',
      slot: ev.slot || null,
      reason: ev.reason || '',
      commentary: ev.commentary || '',
      isVoided: Boolean(ev.isVoided),
      clientTimestamp: ev.clientTimestamp ? new Date(ev.clientTimestamp) : new Date(),
      deviceId: deviceId || ''
    });
    syncedCount += 1;
  }

  const { innings: updatedInnings, state } = await recomputeAndPersistInnings(match, inningsNumber);
  return {
    ok: true,
    conflict: false,
    syncedCount,
    duplicateCount,
    innings: updatedInnings,
    state
  };
}

module.exports = {
  recomputeAndPersistInnings,
  upsertScorecard,
  syncOfflineEvents
};
