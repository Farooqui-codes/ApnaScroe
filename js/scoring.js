/**
 * ApnaScore Live Scoring Controller
 * Supports full online Socket.IO real-time scoring AND full offline IndexedDB scoring.
 */
(function (root) {
  'use strict';

  let matchId = '';
  let matchDoc = null;
  let inningsList = [];
  let activeInnings = null;
  let activeEvents = [];
  let computedState = null;
  let tapLocked = false;
  let socket = null;
  let editingEventId = null;

  document.addEventListener('DOMContentLoaded', async () => {
    ApnaUI.initShell({ activePage: 'live', pageTitle: 'Live Scoring' });

    const params = new URLSearchParams(window.location.search);
    matchId = params.get('matchId') || '';

    if (!matchId) {
      document.getElementById('liveMatchesDirectory').classList.remove('hidden');
      await loadMatchesDirectory();
      return;
    }

    document.body.classList.add('scoring-active');
    document.getElementById('activeScoringView').classList.remove('hidden');

    if (localStorage.getItem('apnascore_outdoor_mode') === '1') {
      document.body.classList.add('outdoor-mode');
      const ob = document.getElementById('outdoorModeBtn');
      if (ob) {
        ob.textContent = '☀ Outdoor: ON';
        ob.classList.add('btn-lime');
        ob.classList.remove('btn-secondary');
      }
    }

    bindScoringUI();
    await loadMatchState();
    connectSocket();
  });

  async function loadMatchesDirectory() {
    const grid = document.getElementById('liveMatchesGrid');
    try {
      const res = await ApnaAPI.get('/api/matches');
      const serverMatches = res.matches || [];
      const localMatches = await ApnaOffline.getAllLocalMatches();
      const combined = [...serverMatches];
      for (const lm of localMatches) {
        if (!lm.serverMatchId && !combined.some((m) => m.clientMatchId === lm.clientMatchId)) {
          combined.unshift(Object.assign({}, lm.match, { _id: lm.localId, isOfflineOnly: true }));
        }
      }

      if (!combined.length) {
        grid.innerHTML = `<div class="empty-state">No matches found. <a href="/match-create.html">Start a New Match</a>.</div>`;
        return;
      }

      grid.innerHTML = combined.map((m) => {
        const inn1 = (m.inningsSummary || [])[0];
        const isLive = ['live', 'paused', 'innings_break'].includes(m.status);
        return `
          <div class="match-card">
            <div class="flex-between">
              <span class="text-sm text-muted">${ApnaUI.escapeHtml(m.venue)} • ${m.oversPerInnings} Ov</span>
              <span class="badge ${isLive ? 'badge-live' : 'badge-neutral'}">${m.isOfflineOnly ? 'OFFLINE' : ApnaUI.escapeHtml(m.status.toUpperCase())}</span>
            </div>
            <strong>${ApnaUI.escapeHtml(m.title)}</strong>
            <div class="text-sm">${inn1 ? `${ApnaUI.escapeHtml(inn1.battingTeamName)}: ${inn1.totalRuns}/${inn1.wickets} (${inn1.oversString})` : 'Ready to start'}</div>
            <div class="flex-gap">
              <a href="/live-score.html?matchId=${m._id}" class="btn btn-primary btn-sm">Open Scorer</a>
              <a href="/scorecard.html?matchId=${m._id}" class="btn btn-secondary btn-sm">Scorecard</a>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      grid.innerHTML = `<div class="empty-state">${ApnaUI.escapeHtml(err.message)}</div>`;
    }
  }

  async function loadMatchState() {
    let loadedFromServer = false;
    try {
      if (!matchId.startsWith('cm_') && !matchId.startsWith('local_')) {
        const res = await ApnaAPI.get(`/api/matches/${matchId}`);
        matchDoc = res.match;
        inningsList = res.innings || [];
        const currNum = matchDoc.currentInningsNumber || 1;
        activeInnings = inningsList.find((i) => i.inningsNumber === currNum) || inningsList[0];
        activeEvents = (res.deliveries || []).filter((d) => d.inningsNumber === (activeInnings ? activeInnings.inningsNumber : 1));
        await ApnaOffline.saveMatchLocally({ match: matchDoc, innings: inningsList, syncStatus: 'synced' });
        for (const ev of activeEvents) {
          await ApnaOffline.saveEventLocally(matchDoc._id, ev.inningsNumber, Object.assign({}, ev, { synced: true }));
        }
        loadedFromServer = true;
      }
    } catch (_) {
      // Fallback to local IndexedDB
    }

    if (!loadedFromServer) {
      const localRec = await ApnaOffline.getLocalMatch(matchId);
      if (!localRec) {
        ApnaUI.showToast('Match not found locally or on server.', 'error');
        return;
      }
      matchDoc = localRec.match;
      inningsList = localRec.innings || [];
      const currNum = matchDoc.currentInningsNumber || 1;
      activeInnings = inningsList.find((i) => i.inningsNumber === currNum) || inningsList[0];
      activeEvents = await ApnaOffline.getEventsForMatch(localRec.localId, activeInnings ? activeInnings.inningsNumber : 1);
    }

    recomputeLocalState();
    renderAll();

    // Prompt opening batsmen & bowler if none set yet
    if (computedState && (!computedState.strikerId || !computedState.currentBowlerId) && computedState.status === 'live') {
      openPlayersModal('openers');
    }
  }

  function recomputeLocalState() {
    if (!matchDoc || !activeInnings) return;
    const batTeam = String(activeInnings.battingTeamId) === String(matchDoc.teamA.teamId) ? matchDoc.teamA : matchDoc.teamB;
    const bowlTeam = String(activeInnings.bowlingTeamId) === String(matchDoc.teamA.teamId) ? matchDoc.teamA : matchDoc.teamB;

    computedState = ApnaScoringEngine.replayInnings(
      {
        inningsNumber: activeInnings.inningsNumber,
        battingTeamId: activeInnings.battingTeamId,
        battingTeamName: activeInnings.battingTeamName,
        bowlingTeamId: activeInnings.bowlingTeamId,
        bowlingTeamName: activeInnings.bowlingTeamName,
        target: activeInnings.target,
        openingStrikerId: activeInnings.openingStrikerId,
        openingStrikerName: activeInnings.openingStrikerName,
        openingNonStrikerId: activeInnings.openingNonStrikerId,
        openingNonStrikerName: activeInnings.openingNonStrikerName,
        openingBowlerId: activeInnings.openingBowlerId,
        openingBowlerName: activeInnings.openingBowlerName,
        battingSquad: batTeam.squad || [],
        bowlingSquad: bowlTeam.squad || [],
        rules: matchDoc.rulesSnapshot
      },
      activeEvents
    );
  }

  function connectSocket() {
    if (typeof io === 'undefined' || !matchDoc || String(matchDoc._id).startsWith('cm_')) return;
    try {
      socket = io();
      socket.emit('join:match', String(matchDoc._id));
      socket.on('match:update', (payload) => {
        if (!payload) return;
        if (payload.match) matchDoc = payload.match;
        if (payload.state) {
          computedState = payload.state;
          renderAll();
        } else {
          loadMatchState();
        }
      });
    } catch (_) {}
  }

  function renderAll() {
    if (!matchDoc || !computedState) return;
    const rules = matchDoc.rulesSnapshot;

    document.getElementById('batTeamTitle').textContent = computedState.battingTeamName;
    const bowlSubEl = document.getElementById('bowlTeamSub');
    if (bowlSubEl) bowlSubEl.textContent = `vs ${computedState.bowlingTeamName} • ${matchDoc.venue}`;
    const scoreEl = document.getElementById('mainScoreDigits');
    const newScoreStr = `${computedState.totalRuns}-${computedState.wickets}`;
    if (scoreEl.textContent !== newScoreStr) {
      scoreEl.textContent = newScoreStr;
      if (window.ApnaAnimations?.pulseScore) ApnaAnimations.pulseScore('mainScoreDigits');
    }
    const oversDigitsEl = document.getElementById('mainOversDigits');
    if (oversDigitsEl) oversDigitsEl.textContent = `(${computedState.oversString})`;

    const scMatchTitleEl = document.getElementById('scMatchTitle');
    if (scMatchTitleEl) scMatchTitleEl.textContent = `${matchDoc.teamA?.name || 'Team A'} v/s ${matchDoc.teamB?.name || 'Team B'}`;

    const inningsBadgeEl = document.getElementById('inningsBadge');
    if (inningsBadgeEl) {
      inningsBadgeEl.textContent = activeInnings.inningsNumber === 1 ? '1st inning' : '2nd inning';
    }

    const statusBadge = document.getElementById('matchStatusBadge');
    if (statusBadge) {
      statusBadge.textContent = matchDoc.status.toUpperCase();
      statusBadge.className = `badge ${matchDoc.status === 'live' ? 'badge-live' : 'badge-success'}`;
    }

    document.getElementById('freeHitBanner')?.classList.toggle('hidden', !computedState.isFreeHit);
    
    // CRR, Target, RR values matching photo
    const crrTextEl = document.getElementById('crrText');
    if (crrTextEl) crrTextEl.textContent = `CRR: ${computedState.currentRunRate.toFixed(2)}`;
    const crrValEl = document.getElementById('crrVal');
    if (crrValEl) crrValEl.textContent = computedState.currentRunRate.toFixed(2);

    const targetValEl = document.getElementById('targetVal');
    if (targetValEl) targetValEl.textContent = computedState.target ? computedState.target : '-';

    const rrValEl = document.getElementById('rrVal');
    if (rrValEl) rrValEl.textContent = computedState.requiredRunRate ? computedState.requiredRunRate.toFixed(2) : '-';

    // Extras
    const extrasValEl = document.getElementById('extrasVal');
    if (extrasValEl) extrasValEl.textContent = computedState.extrasBreakdown.total;
    const extrasTextEl = document.getElementById('extrasText');
    if (extrasTextEl) extrasTextEl.textContent = `Extras: ${computedState.extrasBreakdown.total}`;

    // Target, RRR, and Highlight Alert Line
    const targetEl = document.getElementById('targetText');
    const reqEl = document.getElementById('reqText');
    const highlightLine = document.getElementById('scHighlightLine');

    if (computedState.target) {
      targetEl?.classList.remove('hidden');
      reqEl?.classList.remove('hidden');
      if (targetEl) targetEl.textContent = `Target: ${computedState.target}`;
      if (reqEl) reqEl.textContent = `Need ${computedState.remainingRuns} off ${computedState.remainingBalls}b (RRR: ${(computedState.requiredRunRate || 0).toFixed(2)})`;
      if (highlightLine) {
        highlightLine.textContent = `${computedState.battingTeamName} need ${computedState.remainingRuns} run${computedState.remainingRuns === 1 ? '' : 's'} in ${computedState.remainingBalls} ball${computedState.remainingBalls === 1 ? '' : 's'}`;
      }
    } else {
      targetEl?.classList.add('hidden');
      reqEl?.classList.add('hidden');
      if (highlightLine) {
        const crr = computedState.currentRunRate || 0;
        const proj = crr > 0 ? Math.round(crr * rules.format.oversPerInnings) : computedState.totalRuns;
        highlightLine.textContent = `Projected Score: ${proj} (at current CRR ${crr.toFixed(2)})`;
      }
    }

    // Strikers & Non-Striker Stats Table
    const sStat = computedState.strikerId ? computedState.battingStats[computedState.strikerId] : null;
    const nsStat = computedState.nonStrikerId ? computedState.battingStats[computedState.nonStrikerId] : null;

    const sNameEl = document.getElementById('strikerName');
    if (sNameEl) sNameEl.textContent = sStat ? sStat.name : 'Select Striker';
    const sStarEl = document.getElementById('strikerStar');
    if (sStarEl) sStarEl.textContent = sStat ? '*' : '';
    const sRunsEl = document.getElementById('strikerRuns');
    if (sRunsEl) sRunsEl.textContent = sStat ? sStat.runs : '0';
    const sBallsEl = document.getElementById('strikerBalls');
    if (sBallsEl) sBallsEl.textContent = sStat ? sStat.balls : '0';
    const sFoursEl = document.getElementById('strikerFours');
    if (sFoursEl) sFoursEl.textContent = sStat ? sStat.fours : '0';
    const sSixesEl = document.getElementById('strikerSixes');
    if (sSixesEl) sSixesEl.textContent = sStat ? sStat.sixes : '0';
    const sSREl = document.getElementById('strikerSR');
    if (sSREl) sSREl.textContent = sStat ? sStat.strikeRate.toFixed(2) : '0.00';

    const nsNameEl = document.getElementById('nonStrikerName');
    if (nsNameEl) nsNameEl.textContent = nsStat ? nsStat.name : (rules.localRules.lastManBatting ? 'Last Man Batting' : 'Select Non-Striker');
    const nsRunsEl = document.getElementById('nonStrikerRuns');
    if (nsRunsEl) nsRunsEl.textContent = nsStat ? nsStat.runs : '0';
    const nsBallsEl = document.getElementById('nonStrikerBalls');
    if (nsBallsEl) nsBallsEl.textContent = nsStat ? nsStat.balls : '0';
    const nsFoursEl = document.getElementById('nonStrikerFours');
    if (nsFoursEl) nsFoursEl.textContent = nsStat ? nsStat.fours : '0';
    const nsSixesEl = document.getElementById('nonStrikerSixes');
    if (nsSixesEl) nsSixesEl.textContent = nsStat ? nsStat.sixes : '0';
    const nsSREl = document.getElementById('nonStrikerSR');
    if (nsSREl) nsSREl.textContent = nsStat ? nsStat.strikeRate.toFixed(2) : '0.00';

    const sMeta = document.getElementById('strikerMeta');
    if (sMeta) sMeta.innerHTML = sStat ? `<strong id="strikerRuns">${sStat.runs}</strong> <span class="sc-stat-sub">(${sStat.balls}b • ${sStat.fours}x4 • ${sStat.sixes}x6 • SR ${sStat.strikeRate.toFixed(1)})</span>` : '<span class="sc-stat-sub">Tap to assign</span>';
    const nsMeta = document.getElementById('nonStrikerMeta');
    if (nsMeta) nsMeta.innerHTML = nsStat ? `<strong id="nonStrikerRuns">${nsStat.runs}</strong> <span class="sc-stat-sub">(${nsStat.balls}b • ${nsStat.fours}x4 • ${nsStat.sixes}x6 • SR ${nsStat.strikeRate.toFixed(1)})</span>` : '<span class="sc-stat-sub">-</span>';

    const part = computedState.currentPartnership || { runs: 0, balls: 0 };
    const pValEl = document.getElementById('partnershipVal');
    if (pValEl) pValEl.textContent = `${part.runs} (${part.balls})`;
    const pTextEl = document.getElementById('partnershipText');
    if (pTextEl) pTextEl.textContent = `Partnership: ${part.runs} run(s) (${part.balls} balls)`;

    // Bowler Stats Table
    const bw = computedState.currentBowlerId ? computedState.bowlingStats[computedState.currentBowlerId] : null;
    const bwNameEl = document.getElementById('bowlerName');
    if (bwNameEl) bwNameEl.textContent = bw ? bw.name : 'Select Bowler';
    const bwOversEl = document.getElementById('bowlerOvers');
    if (bwOversEl) bwOversEl.textContent = bw ? bw.overs : '0.0';
    const bwMaidensEl = document.getElementById('bowlerMaidens');
    if (bwMaidensEl) bwMaidensEl.textContent = bw ? bw.maidens : '0';
    const bwRunsEl = document.getElementById('bowlerRuns');
    if (bwRunsEl) bwRunsEl.textContent = bw ? bw.runs : '0';
    const bwWicketsEl = document.getElementById('bowlerWickets');
    if (bwWicketsEl) bwWicketsEl.textContent = bw ? bw.wickets : '0';
    const bwEREl = document.getElementById('bowlerER');
    if (bwEREl) bwEREl.textContent = bw ? bw.economy.toFixed(2) : '0.00';

    const bwFiguresEl = document.getElementById('bowlerFigures');
    if (bwFiguresEl) bwFiguresEl.textContent = bw ? `${bw.wickets}-${bw.runs}` : '0-0';
    const bwMetaEl = document.getElementById('bowlerMeta');
    if (bwMetaEl) bwMetaEl.textContent = bw ? `(${bw.overs} ov • ${bw.maidens} M • Econ ${bw.economy.toFixed(2)})` : '(Select opening bowler)';
    const bwExtrasEl = document.getElementById('bowlerExtrasMeta');
    if (bwExtrasEl) bwExtrasEl.textContent = bw ? `Wides: ${bw.wides} • No-Balls: ${bw.noBalls}` : '';

    // Recent balls timeline (This over)
    const strip = document.getElementById('recentBallsStrip');
    const recent = (computedState.recentBalls || []).slice(-12);
    const ballCountLabelEl = document.getElementById('ballCountLabel');
    if (ballCountLabelEl) ballCountLabelEl.textContent = `${computedState.legalBalls} legal balls`;

    if (!recent.length) {
      strip.innerHTML = `<span class="text-sm text-muted">Yet to start</span>`;
    } else {
      strip.innerHTML = recent.map((b) => {
        let cls = 'sc-over-ball-chip';
        if (b.isWicket) cls += ' wicket-ball';
        else if (b.isBoundarySix) cls += ' boundary-6';
        else if (b.isBoundaryFour) cls += ' boundary-4';
        else if (b.extraType !== 'none') cls += ' extra-ball';
        else if (b.batRuns === 0) cls += ' dot-ball';
        return `<button type="button" class="${cls}" data-evid="${b.eventId}" title="Over ${b.overLabel}">${ApnaUI.escapeHtml(b.badge)}</button>`;
      }).join('');
      strip.scrollLeft = strip.scrollWidth;
    }

    // Commentary
    const commEl = document.getElementById('commentaryList');
    const comms = computedState.commentary || [];
    commEl.innerHTML = comms.length
      ? comms.slice(0, 40).map((c) => `
          <div class="commentary-item">
            <span class="comm-over-pill">${ApnaUI.escapeHtml(c.over)}</span>
            <div>${ApnaUI.escapeHtml(c.text)}</div>
          </div>
        `).join('')
      : `<div class="empty-state text-sm">Commentary updates automatically as balls are scored.</div>`;

    // Innings / Match completion action banner
    const banner = document.getElementById('inningsActionBanner');
    const bannerTitle = document.getElementById('inningsActionTitle');
    const bannerBtns = document.getElementById('inningsActionButtons');
    if (computedState.status === 'completed') {
      banner.classList.remove('hidden');
      if (activeInnings.inningsNumber === 1 && !inningsList.some((i) => i.inningsNumber === 2)) {
        bannerTitle.textContent = `1st Innings Ended (${computedState.totalRuns}/${computedState.wickets}). Target: ${computedState.totalRuns + 1}`;
        bannerBtns.innerHTML = `<button type="button" class="btn btn-primary btn-sm" id="bannerStart2ndBtn">Start 2nd Innings</button>`;
        document.getElementById('bannerStart2ndBtn').onclick = startSecondInnings;
      } else {
        bannerTitle.textContent = (matchDoc.result && matchDoc.result.marginText) || 'Match Completed!';
        const guestSaveCta = ApnaAuth.isGuest()
          ? `<a href="/register.html" class="btn btn-secondary btn-sm">Save Match to Account</a>`
          : '';
        bannerBtns.innerHTML = `
          <a href="/scorecard.html?matchId=${matchDoc._id}" class="btn btn-primary btn-sm">View Scorecard & PDF</a>
          ${guestSaveCta}
          ${matchDoc.status === 'tied' ? `<button type="button" class="btn btn-lime btn-sm" id="bannerSuperOverBtn">Start Super Over</button>` : ''}
        `;
        document.getElementById('bannerSuperOverBtn')?.addEventListener('click', startSuperOver);
      }
    } else {
      banner.classList.add('hidden');
    }

    renderMiniScorecard();
    renderRulesSummary();
  }

  function renderFullScorecardHTML() {
    if (!computedState) return '<p class="text-muted">No scorecard data available yet.</p>';
    const batRows = (computedState.battingOrder || []).map((pid) => {
      const b = computedState.battingStats[pid];
      return `<tr><td><strong>${ApnaUI.escapeHtml(b.name)}</strong><br><span class="text-sm text-muted">${ApnaUI.escapeHtml(b.dismissalText)}</span></td><td class="num"><strong>${b.runs}</strong></td><td class="num">${b.balls}</td><td class="num">${b.fours}</td><td class="num">${b.sixes}</td><td class="num">${b.strikeRate.toFixed(1)}</td></tr>`;
    }).join('');
    const bowlRows = (computedState.bowlingOrder || []).map((pid) => {
      const bw = computedState.bowlingStats[pid];
      return `<tr><td><strong>${ApnaUI.escapeHtml(bw.name)}</strong></td><td class="num">${bw.overs}</td><td class="num">${bw.maidens}</td><td class="num">${bw.runs}</td><td class="num"><strong>${bw.wickets}</strong></td><td class="num">${bw.economy.toFixed(2)}</td></tr>`;
    }).join('');

    return `
      <div style="margin-bottom:12px;">
        <h4 style="margin:0 0 8px;font-size:0.95rem;">Batting (${computedState.battingTeamName})</h4>
        <div class="table-wrap">
          <table class="data-table"><thead><tr><th>Batsman</th><th class="num">R</th><th class="num">B</th><th class="num">4s</th><th class="num">6s</th><th class="num">SR</th></tr></thead><tbody>${batRows || '<tr><td colspan="6">No batting data</td></tr>'}</tbody></table>
        </div>
      </div>
      <div>
        <h4 style="margin:0 0 8px;font-size:0.95rem;">Bowling (${computedState.bowlingTeamName})</h4>
        <div class="table-wrap">
          <table class="data-table"><thead><tr><th>Bowler</th><th class="num">O</th><th class="num">M</th><th class="num">R</th><th class="num">W</th><th class="num">Econ</th></tr></thead><tbody>${bowlRows || '<tr><td colspan="6">No bowling data</td></tr>'}</tbody></table>
        </div>
      </div>
    `;
  }

  function renderMiniScorecard() {
    const el = document.getElementById('scPanel-scorecard');
    if (!el || !computedState) return;
    el.innerHTML = renderFullScorecardHTML();
  }

  function renderRulesSummary() {
    const r = matchDoc.rulesSnapshot;
    document.getElementById('scPanel-rules').innerHTML = `
      <p><strong>Preset:</strong> ${ApnaUI.escapeHtml(r.presetName)} • <strong>Overs:</strong> ${r.format.oversPerInnings} (${r.format.ballsPerOver}b/over)</p>
      <p><strong>Wide:</strong> ${r.extras.wide.enabled ? `Enabled (+${r.extras.wide.baseRuns}, legal: ${r.extras.wide.countsAsLegalDelivery})` : 'Disabled'}</p>
      <p><strong>No Ball:</strong> ${r.extras.noBall.enabled ? `Enabled (+${r.extras.noBall.baseRuns}, Free Hit: ${r.extras.noBall.freeHitOnNextBall})` : 'Disabled'}</p>
      <p><strong>Local Rules:</strong> One-Tip Catch: ${r.localRules.oneTipOneHandCatch ? 'Yes' : 'No'} • Last Man Batting: ${r.localRules.lastManBatting ? 'Yes' : 'No'} • Unlimited Wickets: ${r.format.unlimitedWickets ? 'Yes' : 'No'}</p>
    `;
  }

  async function dispatchEvent(eventPayload) {
    if (!matchDoc || !computedState) {
      return ApnaUI.showToast('Match is still loading. Please wait a moment.', 'warning');
    }
    if (tapLocked) return;
    tapLocked = true;
    setTimeout(() => { tapLocked = false; }, 220);

    const innNum = activeInnings ? activeInnings.inningsNumber : 1;
    const nextSeq = activeEvents.length > 0 ? Math.max(...activeEvents.map((e) => e.sequence || 0)) + 1 : 1;
    const eventObj = Object.assign(
      {
        eventId: 'ev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        sequence: nextSeq,
        inningsNumber: innNum,
        strikerId: computedState.strikerId,
        nonStrikerId: computedState.nonStrikerId,
        bowlerId: computedState.currentBowlerId
      },
      eventPayload
    );

    if (eventObj.eventType === 'delivery' || !eventObj.eventType) {
      eventObj.eventType = 'delivery';
      const val = ApnaScoringEngine.validateDeliveryInput(computedState, eventObj, matchDoc.rulesSnapshot);
      if (!val.valid) {
        tapLocked = false;
        ApnaUI.showToast(val.errors.join(' '), 'error');
        if (!computedState.strikerId || !computedState.currentBowlerId) openPlayersModal('openers');
        return;
      }
    }

    // Optimistic local state update & immediate IndexedDB save
    activeEvents.push(Object.assign({}, eventObj, { synced: false }));
    recomputeLocalState();
    renderAll();

    if (eventObj.isWicket) ApnaAnimations.celebrate('OUT!', 'wicket');
    else if (eventObj.batRuns === 6) ApnaAnimations.celebrate('SIX! 6', 'six');
    else if (eventObj.batRuns === 4) ApnaAnimations.celebrate('FOUR! 4', 'four');
    else if (eventObj.extraType === 'wide') ApnaAnimations.celebrate('WIDE!', 'extra');
    else if (eventObj.extraType === 'no_ball') ApnaAnimations.celebrate('NO BALL!', 'extra');

    const localKey = matchDoc._id || matchDoc.clientMatchId;
    await ApnaOffline.saveEventLocally(localKey, innNum, eventObj);

    try {
      const canHitServer = navigator.onLine && !String(localKey).startsWith('cm_') && (ApnaAPI.getToken() || (ApnaAPI.getGuestSession() && ApnaAPI.getGuestSession().guestToken));
      if (canHitServer) {
        const res = await ApnaAPI.post(`/api/scoring/${localKey}/event`, eventObj);
        if (res && res.success) {
          eventObj.synced = true;
          await ApnaOffline.saveEventLocally(localKey, innNum, Object.assign({}, eventObj, { synced: true }));
          if (res.match) matchDoc = res.match;
          if (res.state) {
            computedState = res.state;
            renderAll();
          }
        }
      } else {
        await ApnaOffline.saveMatchLocally({ localId: localKey, match: matchDoc, innings: inningsList, syncStatus: 'pending' });
      }
    } catch (err) {
      await ApnaOffline.saveMatchLocally({ localId: localKey, match: matchDoc, innings: inningsList, syncStatus: 'pending' });
      if (!err.isOffline) ApnaUI.showToast(err.message, 'warning');
    }

    // Prompt incoming batsman or new bowler automatically
    if (computedState.status === 'live') {
      if (computedState.needsNewBatsman) openPlayersModal('new_batsman');
      else if (computedState.needsBowlerChange) openPlayersModal('change_bowler');
    }
  }

  function getSquads() {
    const batTeam = String(activeInnings.battingTeamId) === String(matchDoc.teamA.teamId) ? matchDoc.teamA : matchDoc.teamB;
    const bowlTeam = String(activeInnings.bowlingTeamId) === String(matchDoc.teamA.teamId) ? matchDoc.teamA : matchDoc.teamB;
    return { batSquad: batTeam.squad || [], bowlSquad: bowlTeam.squad || [] };
  }

  // ==========================================================================
  // §17 Smart Player Autocomplete & History
  // ==========================================================================
  let wakeLockSentinel = null;
  async function requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        wakeLockSentinel.addEventListener('release', () => {
          wakeLockSentinel = null;
        });
      } catch (_) {}
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !wakeLockSentinel && !document.getElementById('activeScoringView').classList.contains('hidden')) {
      requestWakeLock();
    }
  });

  const SmartPlayerAutocomplete = {
    async getPlayerHistory() {
      const historyMap = new Map();
      try {
        const stored = JSON.parse(localStorage.getItem('apnascore_player_history') || '[]');
        stored.forEach((p) => {
          if (p && p.name) historyMap.set(p.name.toLowerCase(), p);
        });
      } catch (_) {}

      if (window.ApnaOffline) {
        try {
          const localMatches = await ApnaOffline.getAllLocalMatches();
          localMatches.forEach((lm) => {
            const m = lm.match || {};
            [...(m.teamA?.squad || []), ...(m.teamB?.squad || [])].forEach((p) => {
              if (p && p.name) {
                historyMap.set(p.name.toLowerCase(), { playerId: p.playerId || `p_${Date.now()}`, name: p.name });
              }
            });
          });
        } catch (_) {}
      }
      return Array.from(historyMap.values());
    },

    savePlayerToHistory(player) {
      if (!player || !player.name) return;
      try {
        const stored = JSON.parse(localStorage.getItem('apnascore_player_history') || '[]');
        const exists = stored.some((p) => p.name.toLowerCase() === player.name.toLowerCase());
        if (!exists) {
          stored.unshift({ playerId: player.playerId || player.id, name: player.name });
          localStorage.setItem('apnascore_player_history', JSON.stringify(stored.slice(0, 100)));
        }
      } catch (_) {}
    },

    attach(inputEl, { getEligibleSquad, role = 'batsman', getCreaseIds = () => [], onSelect }) {
      if (!inputEl) return;

      let wrap = inputEl.parentElement;
      if (!wrap.classList.contains('autocomplete-wrap')) {
        const container = document.createElement('div');
        container.className = 'autocomplete-wrap';
        container.style.position = 'relative';
        wrap.replaceChild(container, inputEl);
        container.appendChild(inputEl);
        wrap = container;
      }

      let dropdown = wrap.querySelector('.autocomplete-dropdown');
      if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.className = 'autocomplete-dropdown hidden';
        wrap.appendChild(dropdown);
      }

      const positionDropdown = () => {
        dropdown.style.position = 'absolute';
        dropdown.style.left = '0';
        dropdown.style.right = '0';
        dropdown.style.zIndex = '150';
        dropdown.style.background = 'var(--bg-surface)';
        dropdown.style.border = '1px solid var(--border-color)';
        dropdown.style.borderRadius = 'var(--radius-md)';
        dropdown.style.boxShadow = 'var(--shadow-lg)';
        dropdown.style.maxHeight = '210px';
        dropdown.style.overflowY = 'auto';

        if (window.visualViewport) {
          const rect = inputEl.getBoundingClientRect();
          const vpHeight = window.visualViewport.height;
          if (rect.bottom + 180 > vpHeight) {
            dropdown.style.bottom = '100%';
            dropdown.style.top = 'auto';
            dropdown.style.marginBottom = '6px';
            dropdown.style.marginTop = '0';
          } else {
            dropdown.style.top = '100%';
            dropdown.style.bottom = 'auto';
            dropdown.style.marginTop = '6px';
            dropdown.style.marginBottom = '0';
          }
        } else {
          dropdown.style.top = '100%';
          dropdown.style.marginTop = '6px';
        }
      };

      const renderSuggestions = async () => {
        const val = inputEl.value.trim();
        const eligibleSquad = (getEligibleSquad ? getEligibleSquad() : []) || [];
        const creaseIds = (getCreaseIds ? getCreaseIds() : []) || [];

        // 1. EMPTY INPUT: Render instant horizontal chips of squad players
        if (!val) {
          if (!eligibleSquad.length) {
            dropdown.innerHTML = `<div class="ac-hint text-xs text-muted" style="padding:8px 10px;">Type a player name or choose below</div>`;
            dropdown.classList.remove('hidden');
            positionDropdown();
            return;
          }
          dropdown.innerHTML = `
            <div class="ac-chips-header text-xs text-muted" style="padding:6px 10px;font-weight:700;">Squad Players (Tap to select):</div>
            <div class="ac-chips-row" style="display:flex;flex-wrap:wrap;gap:6px;padding:6px 10px 10px;">
              ${eligibleSquad.map((p) => `
                <button type="button" class="ac-chip-btn" data-pid="${p.playerId}" data-pname="${ApnaUI.escapeHtml(p.name)}" style="padding:6px 11px;border-radius:var(--radius-pill);border:1px solid var(--border-color);background:var(--bg-surface-alt);color:var(--text-primary);font-size:0.82rem;font-weight:700;cursor:pointer;">
                  ${ApnaUI.escapeHtml(p.name)}
                </button>
              `).join('')}
            </div>
          `;
          dropdown.querySelectorAll('.ac-chip-btn').forEach((chip) => {
            chip.onclick = (e) => {
              e.preventDefault();
              inputEl.value = chip.dataset.pname;
              inputEl.dataset.pid = chip.dataset.pid;
              dropdown.classList.add('hidden');
              onSelect?.({ id: chip.dataset.pid, name: chip.dataset.pname });
            };
          });
          dropdown.classList.remove('hidden');
          positionDropdown();
          return;
        }

        // 2. TYPING: Fuzzy search + highlighted <mark> letters + top 5 results
        const historyPlayers = await SmartPlayerAutocomplete.getPlayerHistory();
        const allCandidatesMap = new Map();
        eligibleSquad.forEach((p) => allCandidatesMap.set(p.name.toLowerCase(), { ...p, source: 'squad' }));
        historyPlayers.forEach((p) => {
          if (!allCandidatesMap.has(p.name.toLowerCase())) {
            allCandidatesMap.set(p.name.toLowerCase(), { ...p, source: 'history' });
          }
        });

        const q = val.toLowerCase();
        const matches = Array.from(allCandidatesMap.values()).filter((p) => p.name.toLowerCase().includes(q)).slice(0, 5);

        let html = '';
        if (matches.length) {
          html += matches.map((p) => {
            const isAtCrease = creaseIds.includes(String(p.playerId || p.id));
            const badge = isAtCrease
              ? `<span class="badge badge-warning" style="font-size:0.65rem;">At Crease</span>`
              : (p.source === 'squad'
                ? `<span class="badge badge-neutral" style="font-size:0.65rem;">Squad</span>`
                : `<span class="badge badge-neutral" style="font-size:0.65rem;">History</span>`);

            const idx = p.name.toLowerCase().indexOf(q);
            const highlighted = idx >= 0
              ? `${ApnaUI.escapeHtml(p.name.slice(0, idx))}<mark class="ac-mark" style="background:#FFE082;border-radius:2px;font-weight:900;">${ApnaUI.escapeHtml(p.name.slice(idx, idx + q.length))}</mark>${ApnaUI.escapeHtml(p.name.slice(idx + q.length))}`
              : ApnaUI.escapeHtml(p.name);

            return `
              <div class="ac-item" data-pid="${p.playerId || p.id}" data-pname="${ApnaUI.escapeHtml(p.name)}" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border-color);">
                <div style="font-weight:700;color:var(--text-primary);">${highlighted}</div>
                <div>${badge}</div>
              </div>
            `;
          }).join('');
        }

        const exactMatch = matches.some((m) => m.name.toLowerCase() === q);
        if (!exactMatch) {
          html += `
            <div class="ac-item ac-item-add" data-add="1" style="padding:10px 12px;cursor:pointer;color:var(--brand-primary);font-weight:800;background:var(--bg-surface-alt);">
              + Add "${ApnaUI.escapeHtml(val)}" as new player
            </div>
          `;
        }

        dropdown.innerHTML = html;
        dropdown.querySelectorAll('.ac-item').forEach((item) => {
          item.onclick = (e) => {
            e.preventDefault();
            if (item.dataset.add) {
              const newId = `qp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
              inputEl.value = val;
              inputEl.dataset.pid = newId;
              dropdown.classList.add('hidden');
              SmartPlayerAutocomplete.savePlayerToHistory({ id: newId, name: val });
              onSelect?.({ id: newId, name: val, isNew: true });
            } else {
              inputEl.value = item.dataset.pname;
              inputEl.dataset.pid = item.dataset.pid;
              dropdown.classList.add('hidden');
              SmartPlayerAutocomplete.savePlayerToHistory({ id: item.dataset.pid, name: item.dataset.pname });
              onSelect?.({ id: item.dataset.pid, name: item.dataset.pname });
            }
          };
        });

        dropdown.classList.remove('hidden');
        positionDropdown();
      };

      inputEl.addEventListener('focus', renderSuggestions);
      inputEl.addEventListener('input', renderSuggestions);
      document.addEventListener('click', (e) => {
        if (!wrap.contains(e.target)) dropdown.classList.add('hidden');
      });
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', positionDropdown);
      }
    }
  };

  function openPlayersModal(mode) {
    const { batSquad, bowlSquad } = getSquads();
    const modal = document.getElementById('playersSelectModal');
    const title = document.getElementById('playersModalTitle');
    const body = document.getElementById('playersModalBody');
    const saveBtn = document.getElementById('playersModalSaveBtn');

    const batOpts = batSquad.map((p) => `<option value="${p.playerId}">${ApnaUI.escapeHtml(p.name)}</option>`).join('');
    const bowlOpts = bowlSquad.map((p) => `<option value="${p.playerId}">${ApnaUI.escapeHtml(p.name)}</option>`).join('');

    const resolveNameOrSelect = (selId, txtId, fallbackLabel, side) => {
      const txtEl = document.getElementById(txtId);
      const customName = txtEl?.value.trim();
      if (customName) {
        const customId = txtEl.dataset.pid || `qp_${side}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        SmartPlayerAutocomplete.savePlayerToHistory({ id: customId, name: customName });
        return { id: customId, name: customName };
      }
      const sel = document.getElementById(selId);
      if (sel && sel.value) {
        return { id: sel.value, name: sel.options[sel.selectedIndex]?.text || fallbackLabel };
      }
      const autoId = `qp_${side}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      return { id: autoId, name: fallbackLabel };
    };

    if (mode === 'openers') {
      title.textContent = 'Select or Enter Striker, Non-Striker & Bowler';
      body.innerHTML = `
        <div class="form-group">
          <label class="form-label">Striker</label>
          ${batSquad.length ? `<select class="form-control mb-1" id="selStriker">${batOpts}</select>` : ''}
          <input class="form-control" id="txtStriker" placeholder="${batSquad.length ? 'Or type/pick striker name...' : 'Enter striker name (e.g. Raju)'}" autocomplete="off" />
        </div>
        <div class="form-group">
          <label class="form-label">Non-Striker</label>
          ${batSquad.length > 1 ? `<select class="form-control mb-1" id="selNonStriker">${batOpts}</select>` : ''}
          <input class="form-control" id="txtNonStriker" placeholder="${batSquad.length > 1 ? 'Or type/pick non-striker name...' : 'Enter non-striker name (e.g. Vikram)'}" autocomplete="off" />
        </div>
        <div class="form-group">
          <label class="form-label">Opening Bowler</label>
          ${bowlSquad.length ? `<select class="form-control mb-1" id="selBowler">${bowlOpts}</select>` : ''}
          <input class="form-control" id="txtBowler" placeholder="${bowlSquad.length ? 'Or type/pick bowler name...' : 'Enter bowler name (e.g. Suresh)'}" autocomplete="off" />
        </div>
      `;
      if (batSquad.length > 1 && document.getElementById('selNonStriker')) {
        document.getElementById('selNonStriker').selectedIndex = 1;
      }

      // Attach smart autocompletes
      SmartPlayerAutocomplete.attach(document.getElementById('txtStriker'), {
        getEligibleSquad: () => batSquad,
        role: 'batsman'
      });
      SmartPlayerAutocomplete.attach(document.getElementById('txtNonStriker'), {
        getEligibleSquad: () => batSquad,
        role: 'batsman',
        getCreaseIds: () => [document.getElementById('txtStriker')?.dataset?.pid]
      });
      SmartPlayerAutocomplete.attach(document.getElementById('txtBowler'), {
        getEligibleSquad: () => bowlSquad,
        role: 'bowler'
      });

      saveBtn.onclick = async () => {
        const s = resolveNameOrSelect('selStriker', 'txtStriker', 'Batsman 1', 'bat');
        const ns = resolveNameOrSelect('selNonStriker', 'txtNonStriker', 'Batsman 2', 'bat');
        const b = resolveNameOrSelect('selBowler', 'txtBowler', 'Bowler 1', 'bowl');
        if (s.id === ns.id && !matchDoc.rulesSnapshot.localRules.lastManBatting) {
          return ApnaUI.showToast('Striker and Non-Striker must be different players.', 'error');
        }
        closeModal('playersSelectModal');
        await dispatchEvent({
          eventType: 'set_openers',
          strikerId: s.id,
          strikerName: s.name,
          nonStrikerId: ns.id,
          nonStrikerName: ns.name,
          bowlerId: b.id,
          bowlerName: b.name
        });
      };
    } else if (mode === 'new_batsman') {
      title.textContent = 'Select or Enter Next Batsman';
      const available = batSquad.filter((p) => {
        const st = computedState.battingStats[String(p.playerId)];
        const isCurrent = String(p.playerId) === String(computedState.strikerId) || String(p.playerId) === String(computedState.nonStrikerId);
        if (isCurrent) return false;
        if (!st) return true;
        if (st.isRetiredHurt && matchDoc.rulesSnapshot.wickets.allowRetiredHurtReturn) return true;
        if (st.isOut && st.dismissalType === 'retired_out' && matchDoc.rulesSnapshot.wickets.allowRetiredOutReturn) return true;
        return !st.isOut && !st.isRetiredHurt;
      });
      body.innerHTML = `
        <div class="form-group">
          <label class="form-label">Next Batsman</label>
          ${available.length ? `<select class="form-control mb-1" id="selNewBat">${available.map((p) => `<option value="${p.playerId}">${ApnaUI.escapeHtml(p.name)}</option>`).join('')}</select>` : ''}
          <input class="form-control" id="txtNewBat" placeholder="${available.length ? 'Or type/pick incoming batsman...' : 'Enter batsman name'}" autocomplete="off" />
        </div>`;

      SmartPlayerAutocomplete.attach(document.getElementById('txtNewBat'), {
        getEligibleSquad: () => available,
        role: 'batsman',
        getCreaseIds: () => [computedState.strikerId, computedState.nonStrikerId]
      });

      saveBtn.onclick = async () => {
        const nb = resolveNameOrSelect('selNewBat', 'txtNewBat', `Batsman ${(computedState.wickets || 0) + 3}`, 'bat');
        closeModal('playersSelectModal');
        await dispatchEvent({
          eventType: 'new_batsman',
          playerId: nb.id,
          playerName: nb.name,
          slot: computedState.dismissedSlot || 'striker'
        });
      };
    } else if (mode === 'change_bowler') {
      title.textContent = 'Select or Enter Next Bowler';
      const rules = matchDoc.rulesSnapshot;
      const filtered = bowlSquad.filter((p) => {
        if (
          rules.format.noConsecutiveOversBySameBowler &&
          computedState.lastCompletedOverBowlerId &&
          String(p.playerId) === String(computedState.lastCompletedOverBowlerId) &&
          bowlSquad.length > 1
        ) {
          return false;
        }
        if (rules.format.maxOversPerBowler > 0) {
          const bw = computedState.bowlingStats && computedState.bowlingStats[String(p.playerId)];
          const bpo = rules.format.ballsPerOver || 6;
          if (bw && bw.legalBalls >= rules.format.maxOversPerBowler * bpo) {
            return false;
          }
        }
        return true;
      });
      body.innerHTML = `
        <div class="form-group">
          <label class="form-label">Bowler</label>
          ${filtered.length ? `<select class="form-control mb-1" id="selNextBowl">${filtered.map((p) => `<option value="${p.playerId}">${ApnaUI.escapeHtml(p.name)}</option>`).join('')}</select>` : ''}
          <input class="form-control" id="txtNextBowl" placeholder="${filtered.length ? 'Or type/pick bowler name...' : 'Enter bowler name'}" autocomplete="off" />
        </div>`;

      SmartPlayerAutocomplete.attach(document.getElementById('txtNextBowl'), {
        getEligibleSquad: () => filtered,
        role: 'bowler'
      });

      saveBtn.onclick = async () => {
        const bw = resolveNameOrSelect('selNextBowl', 'txtNextBowl', `Bowler ${(computedState.completedOvers || 0) + 2}`, 'bowl');
        closeModal('playersSelectModal');
        await dispatchEvent({
          eventType: 'change_bowler',
          bowlerId: bw.id,
          bowlerName: bw.name
        });
      };
    } else if (mode === 'change_striker') {
      title.textContent = 'Change Active Striker';
      body.innerHTML = `
        <div class="form-group">
          <label class="form-label">Striker</label>
          ${batSquad.length ? `<select class="form-control mb-1" id="selChangeStriker">${batOpts}</select>` : ''}
          <input class="form-control" id="txtChangeStriker" placeholder="Or type striker name..." autocomplete="off" />
        </div>`;

      SmartPlayerAutocomplete.attach(document.getElementById('txtChangeStriker'), {
        getEligibleSquad: () => batSquad,
        role: 'batsman'
      });

      saveBtn.onclick = async () => {
        const st = resolveNameOrSelect('selChangeStriker', 'txtChangeStriker', 'Striker', 'bat');
        closeModal('playersSelectModal');
        await dispatchEvent({
          eventType: 'change_striker',
          strikerId: st.id,
          strikerName: st.name
        });
      };
    }

    modal.classList.add('open');
  }

  function bindScoringUI() {
    let activeToggleExtra = null;

    const syncCheckboxes = (activeToggle) => {
      document.querySelectorAll('.sc-toggle-chip[data-toggle]').forEach((chip) => {
        const t = chip.dataset.toggle;
        const cb = chip.querySelector('.sc-checkbox-input');
        const isActive = t === activeToggle;
        chip.classList.toggle('active', isActive);
        if (cb) cb.checked = isActive;
      });
    };

    // Toggle Chips / Checkboxes Logic matching photo
    document.querySelectorAll('.sc-toggle-chip[data-toggle]').forEach((chip) => {
      chip.addEventListener('click', (e) => {
        if (e.target.tagName && e.target.tagName.toLowerCase() === 'input') {
          e.stopPropagation();
        } else {
          e.preventDefault();
        }
        const toggle = chip.dataset.toggle;
        if (toggle === 'wicket') {
          syncCheckboxes(null);
          activeToggleExtra = null;
          openWicketModal();
          return;
        }
        if (activeToggleExtra === toggle) {
          activeToggleExtra = null;
          syncCheckboxes(null);
        } else {
          activeToggleExtra = toggle;
          syncCheckboxes(toggle);
          try { navigator.vibrate?.(10); } catch (_) {}
        }
      });
    });

    // Runs buttons (0..6 circular buttons)
    document.querySelectorAll('.score-btn[data-run]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const run = Number(btn.dataset.run);
        try {
          if (run === 4 || run === 6) navigator.vibrate?.([20, 50, 20]);
          else navigator.vibrate?.(12);
        } catch (_) {}

        const prevExtra = activeToggleExtra;
        activeToggleExtra = null;
        syncCheckboxes(null);

        if (prevExtra === 'wide') {
          dispatchEvent({ extraType: 'wide', additionalExtraRuns: run, batRuns: 0 });
        } else if (prevExtra === 'no_ball') {
          dispatchEvent({ extraType: 'no_ball', additionalExtraRuns: 0, batRuns: run });
        } else if (prevExtra === 'bye') {
          dispatchEvent({ extraType: 'bye', additionalExtraRuns: run || 1, batRuns: 0 });
        } else if (prevExtra === 'leg_bye') {
          dispatchEvent({ extraType: 'leg_bye', additionalExtraRuns: run || 1, batRuns: 0 });
        } else {
          dispatchEvent({ extraType: 'none', batRuns: run });
        }
      });
    });

    // Extras modal fallback
    document.querySelectorAll('.extra-btn[data-extra]').forEach((btn) => {
      btn.addEventListener('click', () => openExtraModal(btn.dataset.extra));
    });

    document.getElementById('moreScoringActionsBtn')?.addEventListener('click', () => {
      document.getElementById('matchControlModal').classList.add('open');
    });
    document.getElementById('wicketBtn')?.addEventListener('click', openWicketModal);
    document.getElementById('undoBallBtn')?.addEventListener('click', undoLastBall);
    document.getElementById('partnershipsBtn')?.addEventListener('click', openMatchSummaryModal);
    document.getElementById('extrasBtn')?.addEventListener('click', () => openExtraModal('penalty'));
    document.getElementById('swapBatsmenBtn')?.addEventListener('click', () => {
      try { navigator.vibrate?.(12); } catch (_) {}
      dispatchEvent({ eventType: 'swap_batsmen' });
    });
    document.getElementById('quickRetireBtn')?.addEventListener('click', openRetireModal);
    document.getElementById('selectOpenersBtn')?.addEventListener('click', () => openPlayersModal('openers'));
    document.getElementById('changeBowlerBtn')?.addEventListener('click', () => openPlayersModal('change_bowler'));

    // Crease tap shortcuts to edit batsmen/bowler
    document.getElementById('strikerRow')?.addEventListener('click', () => openPlayersModal('change_striker'));
    document.getElementById('nonStrikerRow')?.addEventListener('click', () => openPlayersModal('openers'));
    document.getElementById('bowlerStrip')?.addEventListener('click', () => openPlayersModal('change_bowler'));
    document.getElementById('bowlerRow')?.addEventListener('click', () => openPlayersModal('change_bowler'));

    // Outdoor Mode Toggle
    document.getElementById('outdoorModeBtn')?.addEventListener('click', (e) => {
      document.body.classList.toggle('outdoor-mode');
      const isOn = document.body.classList.contains('outdoor-mode');
      localStorage.setItem('apnascore_outdoor_mode', isOn ? '1' : '0');
      e.currentTarget.textContent = isOn ? '☀ Outdoor: ON' : '☀ Outdoor Mode';
      e.currentTarget.classList.toggle('btn-lime', isOn);
      e.currentTarget.classList.toggle('btn-secondary', !isOn);
    });

    // Summary & Scorecard Modal Opener
    document.getElementById('openSummaryGraphBtn')?.addEventListener('click', openMatchSummaryModal);
    document.getElementById('openScorecardMiniBtn')?.addEventListener('click', openFullScorecardModal);

    // Commentary & Scorecard tabs
    document.querySelectorAll('[data-scview]').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('[data-scview]').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        ['commentary', 'scorecard', 'rules'].forEach((k) => {
          document.getElementById(`scPanel-${k}`)?.classList.toggle('hidden', k !== tab.dataset.scview);
        });
      });
    });

    document.getElementById('addCommNoteBtn')?.addEventListener('click', () => {
      const inp = document.getElementById('manualCommentaryInput');
      if (!inp.value.trim() || !computedState) return;
      computedState.commentary.unshift({
        id: 'note_' + Date.now(),
        over: computedState.oversString,
        text: inp.value.trim()
      });
      inp.value = '';
      renderAll();
    });

    // Recent balls tap to edit
    document.getElementById('recentBallsStrip')?.addEventListener('click', (e) => {
      const chip = e.target.closest('.ball-chip[data-evid]');
      if (chip) openEditBallModal(chip.dataset.evid);
    });

    // Match controls modal
    document.getElementById('matchControlsBtn')?.addEventListener('click', () => {
      document.getElementById('matchControlModal').classList.add('open');
    });
    document.querySelectorAll('#matchControlButtonsGrid [data-mc]').forEach((btn) => {
      btn.addEventListener('click', () => handleMatchControlAction(btn.dataset.mc));
    });

    // Share modal
    document.getElementById('shareMatchBtn')?.addEventListener('click', openShareModal);

    // Acquire Wake Lock to keep screen on while scoring
    requestWakeLock();
  }

  function openMatchSummaryModal() {
    const modal = document.getElementById('matchSummaryModal');
    const content = document.getElementById('summaryModalContent');
    if (!modal || !content || !computedState) return;

    const crr = (computedState.currentRunRate || 0).toFixed(2);
    const rules = matchDoc.rulesSnapshot;
    const oversTotal = rules?.format?.oversPerInnings || 6;
    const proj = crr > 0 ? Math.round(crr * oversTotal) : computedState.totalRuns;

    content.innerHTML = `
      <div style="background:var(--brand-primary-deep);color:#fff;border-radius:var(--radius-md);padding:14px;margin-bottom:14px;">
        <div style="font-size:0.85rem;color:var(--brand-lime);font-weight:700;">MATCH SUMMARY</div>
        <div style="font-size:1.4rem;font-weight:900;margin:4px 0;">${computedState.totalRuns}/${computedState.wickets} <span style="font-size:1rem;font-weight:700;color:var(--brand-lime);">(${computedState.oversString} ov)</span></div>
        <div style="display:flex;gap:14px;font-size:0.85rem;flex-wrap:wrap;margin-top:6px;">
          <span>CRR: <strong>${crr}</strong></span>
          ${computedState.target ? `<span>Target: <strong>${computedState.target}</strong></span><span>RRR: <strong>${(computedState.requiredRunRate || 0).toFixed(2)}</strong></span>` : `<span>Projected: <strong>${proj}</strong></span>`}
          <span>Extras: <strong>${computedState.extrasBreakdown.total}</strong></span>
        </div>
      </div>
      <div class="card mb-2" style="padding:12px;">
        <strong class="text-sm">Extras Breakdown</strong>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:8px;text-align:center;">
          <div style="background:var(--bg-surface-alt);padding:8px;border-radius:var(--radius-sm);"><div class="text-xs text-muted">Wides</div><strong>${computedState.extrasBreakdown.wides}</strong></div>
          <div style="background:var(--bg-surface-alt);padding:8px;border-radius:var(--radius-sm);"><div class="text-xs text-muted">No-Balls</div><strong>${computedState.extrasBreakdown.noBalls}</strong></div>
          <div style="background:var(--bg-surface-alt);padding:8px;border-radius:var(--radius-sm);"><div class="text-xs text-muted">Byes</div><strong>${computedState.extrasBreakdown.byes}</strong></div>
          <div style="background:var(--bg-surface-alt);padding:8px;border-radius:var(--radius-sm);"><div class="text-xs text-muted">Leg Byes</div><strong>${computedState.extrasBreakdown.legByes}</strong></div>
        </div>
      </div>
      <div class="card" style="padding:12px;">
        <strong class="text-sm">Current Partnership</strong>
        <div style="margin-top:6px;font-size:1rem;color:var(--text-primary);font-weight:800;">
          ${computedState.currentPartnership?.runs || 0} runs <span class="text-muted text-sm">(${computedState.currentPartnership?.balls || 0} balls)</span>
        </div>
      </div>
    `;
    modal.classList.add('open');
  }

  function openFullScorecardModal() {
    const modal = document.getElementById('fullScorecardModal');
    const content = document.getElementById('fullScorecardModalContent');
    if (!modal || !content) return;
    content.innerHTML = renderFullScorecardHTML();
    modal.classList.add('open');
  }

  function openExtraModal(extraType) {
    const titleMap = {
      wide: 'Wide Ball',
      no_ball: 'No Ball',
      bye: 'Byes',
      leg_bye: 'Leg Byes',
      penalty: 'Penalty / Custom Extra',
      overthrow: 'Overthrow Runs'
    };
    document.getElementById('extraModalTitle').textContent = titleMap[extraType] || 'Extra Runs';
    const body = document.getElementById('extraModalBody');

    if (extraType === 'overthrow') {
      body.innerHTML = `
        <div class="form-group"><label class="form-label">Bat Runs Completed</label><input type="number" min="0" max="6" value="1" class="form-control" id="exBatRuns" /></div>
        <div class="form-group"><label class="form-label">Overthrow Runs</label><input type="number" min="1" max="10" value="4" class="form-control" id="exOverthrowRuns" /></div>
      `;
    } else if (extraType === 'no_ball') {
      body.innerHTML = `
        <div class="form-group"><label class="form-label">Runs Scored Off Bat</label><input type="number" min="0" max="6" value="0" class="form-control" id="exBatRuns" /></div>
        <div class="form-group"><label class="form-label">Additional Extra Runs</label><input type="number" min="0" max="6" value="0" class="form-control" id="exAddRuns" /></div>
      `;
    } else if (extraType === 'penalty') {
      const customCfg = matchDoc.rulesSnapshot?.extras?.customExtra;
      const customOpt = customCfg && customCfg.enabled
        ? `<option value="custom_extra">${ApnaUI.escapeHtml(customCfg.label || 'Custom Extra')} (+${customCfg.baseRuns || 1})</option>`
        : '';
      body.innerHTML = `
        <div class="form-group">
          <label class="form-label">Type</label>
          <select class="form-control" id="exPenaltyKind">
            <option value="penalty">Penalty Runs</option>
            ${customOpt}
          </select>
        </div>
        <div class="form-group"><label class="form-label">Additional / Penalty Runs</label>
        <input type="number" min="0" max="12" value="5" class="form-control" id="exAddRuns" /></div>
      `;
    } else {
      const defaultAdd = (extraType === 'bye' || extraType === 'leg_bye') ? 1 : 0;
      body.innerHTML = `
        <div class="form-group"><label class="form-label">Additional Running Runs</label>
        <input type="number" min="0" max="12" value="${defaultAdd}" class="form-control" id="exAddRuns" /></div>
      `;
    }

    document.getElementById('extraModalSaveBtn').onclick = () => {
      closeModal('extraModal');
      if (extraType === 'overthrow') {
        dispatchEvent({
          extraType: 'none',
          batRuns: Number(document.getElementById('exBatRuns').value || 0),
          overthrowRuns: Number(document.getElementById('exOverthrowRuns').value || 0)
        });
      } else if (extraType === 'no_ball') {
        dispatchEvent({
          extraType: 'no_ball',
          batRuns: Number(document.getElementById('exBatRuns').value || 0),
          additionalExtraRuns: Number(document.getElementById('exAddRuns').value || 0)
        });
      } else if (extraType === 'penalty') {
        const chosenKind = document.getElementById('exPenaltyKind')?.value || 'penalty';
        dispatchEvent({
          extraType: chosenKind,
          additionalExtraRuns: Number(document.getElementById('exAddRuns').value || 0)
        });
      } else {
        dispatchEvent({
          extraType,
          additionalExtraRuns: Number(document.getElementById('exAddRuns').value || 0)
        });
      }
    };
    document.getElementById('extraModal').classList.add('open');
  }

  function openWicketModal() {
    const rules = matchDoc.rulesSnapshot;
    const { bowlSquad } = getSquads();
    const wSel = document.getElementById('wicketTypeSelect');
    wSel.innerHTML = ApnaScoringEngine.WICKET_TYPES
      .filter((w) => rules.wickets[w.id] && w.id !== 'retired_hurt' && w.id !== 'retired_out')
      .map((w) => `<option value="${w.id}">${w.label}</option>`)
      .join('');

    const fSel = document.getElementById('fielderSelect');
    fSel.innerHTML = '<option value="">None</option>' + bowlSquad.map((p) => `<option value="${p.playerId}">${ApnaUI.escapeHtml(p.name)}</option>`).join('');
    document.getElementById('oneTipRow').classList.toggle('hidden', !rules.localRules.oneTipOneHandCatch);

    document.getElementById('confirmWicketBtn').onclick = () => {
      const fOption = fSel.options[fSel.selectedIndex];
      const dSlot = document.getElementById('dismissedSlotSelect').value;
      closeModal('wicketModal');
      dispatchEvent({
        extraType: document.getElementById('wicketExtraType').value,
        batRuns: Number(document.getElementById('wicketRunsCompleted').value || 0),
        isWicket: true,
        wicketType: wSel.value,
        dismissedSlot: dSlot,
        fielderId: fSel.value || null,
        fielderName: fSel.value ? fOption.text : '',
        oneTipCatch: Boolean(document.getElementById('oneTipCheck')?.checked)
      });
    };

    document.getElementById('wicketModal').classList.add('open');
  }

  function openRetireModal() {
    const { batSquad } = getSquads();
    const slotSel = document.getElementById('retireSlotSelect');
    const sStat = computedState.strikerId && computedState.battingStats[computedState.strikerId];
    const nsStat = computedState.nonStrikerId && computedState.battingStats[computedState.nonStrikerId];
    if (!sStat && !nsStat) {
      return ApnaUI.showToast('Select active batsmen before retiring.', 'warning');
    }
    slotSel.innerHTML = `
      ${sStat ? `<option value="striker">Striker: ${ApnaUI.escapeHtml(sStat.name)}</option>` : ''}
      ${nsStat ? `<option value="non_striker">Non-Striker: ${ApnaUI.escapeHtml(nsStat.name)}</option>` : ''}
    `;

    const repSel = document.getElementById('retireReplacementSelect');
    repSel.innerHTML = '<option value="">Select later</option>' + batSquad
      .filter((p) => String(p.playerId) !== String(computedState.strikerId) && String(p.playerId) !== String(computedState.nonStrikerId))
      .map((p) => `<option value="${p.playerId}">${ApnaUI.escapeHtml(p.name)}</option>`)
      .join('');

    document.getElementById('confirmRetireBtn').onclick = () => {
      const rOpt = repSel.options[repSel.selectedIndex];
      closeModal('retireModal');
      dispatchEvent({
        eventType: 'retire',
        slot: slotSel.value,
        wicketType: document.getElementById('retireTypeSelect').value,
        replacementPlayerId: repSel.value || null,
        replacementPlayerName: repSel.value ? rOpt.text : ''
      });
    };

    document.getElementById('retireModal').classList.add('open');
  }

  async function undoLastBall() {
    const lastIdx = activeEvents.map((e) => !e.isVoided).lastIndexOf(true);
    if (lastIdx < 0) {
      if (activeInnings && activeInnings.inningsNumber > 1) {
        if (confirm('No deliveries in this innings yet. Revert back to the 1st innings?')) {
          const prevInnings = inningsList.find((i) => i.inningsNumber === activeInnings.inningsNumber - 1);
          if (prevInnings) {
            activeInnings = prevInnings;
            const localKey = matchDoc._id || matchDoc.clientMatchId;
            const events = await ApnaOffline.getLocalEvents(localKey, activeInnings.inningsNumber);
            activeEvents = events || [];
            recomputeLocalState();
            renderAll();
            return ApnaUI.showToast('Reverted to 1st Innings.');
          }
        }
      }
      return ApnaUI.showToast('Nothing left to undo.', 'warning');
    }
    if (!confirm('Undo the last scoring action?')) return;

    const targetEv = activeEvents[lastIdx];
    targetEv.isVoided = true;
    recomputeLocalState();
    renderAll();

    const localKey = matchDoc._id || matchDoc.clientMatchId;
    await ApnaOffline.saveEventLocally(localKey, activeInnings.inningsNumber, targetEv);

    const canHitServer = navigator.onLine && !String(localKey).startsWith('cm_') && (ApnaAPI.getToken() || (ApnaAPI.getGuestSession() && ApnaAPI.getGuestSession().guestToken));
    if (canHitServer) {
      try {
        const res = await ApnaAPI.post(`/api/scoring/${localKey}/undo`, { inningsNumber: activeInnings.inningsNumber });
        if (res && res.state) {
          computedState = res.state;
          renderAll();
        }
      } catch (err) {
        ApnaUI.showToast(err.message, 'warning');
      }
    }
    ApnaUI.showToast('Last delivery undone.');
  }

  function openEditBallModal(eventId) {
    editingEventId = eventId;
    const ev = activeEvents.find((e) => e.eventId === eventId);
    if (!ev) return;

    document.getElementById('editBallBody').innerHTML = `
      <div class="form-group">
        <label class="form-label">Ball Type</label>
        <select class="form-control" id="ebExtraType">
          <option value="none" ${ev.extraType === 'none' ? 'selected' : ''}>Normal</option>
          <option value="wide" ${ev.extraType === 'wide' ? 'selected' : ''}>Wide</option>
          <option value="no_ball" ${ev.extraType === 'no_ball' ? 'selected' : ''}>No Ball</option>
          <option value="bye" ${ev.extraType === 'bye' ? 'selected' : ''}>Bye</option>
          <option value="leg_bye" ${ev.extraType === 'leg_bye' ? 'selected' : ''}>Leg Bye</option>
        </select>
      </div>
      <div class="form-grid-2">
        <div class="form-group"><label class="form-label">Bat Runs</label><input type="number" min="0" max="6" class="form-control" id="ebBatRuns" value="${ev.batRuns || 0}" /></div>
        <div class="form-group"><label class="form-label">Additional Extra Runs</label><input type="number" min="0" max="10" class="form-control" id="ebAddRuns" value="${ev.additionalExtraRuns || 0}" /></div>
      </div>
      <div class="form-group"><label class="form-label">Commentary</label><input class="form-control" id="ebComm" value="${ApnaUI.escapeHtml(ev.commentary || '')}" /></div>
    `;

    const applyUpdate = async (voidBall) => {
      ev.extraType = document.getElementById('ebExtraType').value;
      ev.batRuns = Number(document.getElementById('ebBatRuns').value || 0);
      ev.additionalExtraRuns = Number(document.getElementById('ebAddRuns').value || 0);
      ev.commentary = document.getElementById('ebComm').value;
      ev.isVoided = Boolean(voidBall);
      ev.editedAt = new Date().toISOString();

      closeModal('editBallModal');
      recomputeLocalState();
      renderAll();

      const localKey = matchDoc._id || matchDoc.clientMatchId;
      await ApnaOffline.saveEventLocally(localKey, activeInnings.inningsNumber, ev);
      const canHitServer = navigator.onLine && !String(localKey).startsWith('cm_') && (ApnaAPI.getToken() || (ApnaAPI.getGuestSession() && ApnaAPI.getGuestSession().guestToken));
      if (canHitServer) {
        try {
          const res = await ApnaAPI.put(`/api/scoring/${localKey}/events/${ev.eventId}`, ev);
          if (res && res.state) { computedState = res.state; renderAll(); }
        } catch (err) {
          ApnaUI.showToast(err.message, 'warning');
        }
      }
      ApnaUI.showToast(voidBall ? 'Delivery deleted and scorecard recalculated.' : 'Delivery updated.');
    };

    document.getElementById('saveEditBallBtn').onclick = () => applyUpdate(false);
    document.getElementById('voidBallBtn').onclick = () => {
      if (confirm('Delete this delivery and recalculate innings?')) applyUpdate(true);
    };
    document.getElementById('editBallModal').classList.add('open');
  }

  async function handleMatchControlAction(action) {
    closeModal('matchControlModal');
    if (['bye', 'leg_bye', 'overthrow', 'penalty'].includes(action)) return openExtraModal(action);
    if (action === 'end_over') {
      if (confirm('End the current over now?')) return dispatchEvent({ eventType: 'end_over' });
      return;
    }
    if (action === 'change_bowler') return openPlayersModal('change_bowler');
    if (action === 'swap_batsmen') return dispatchEvent({ eventType: 'swap_batsmen' });
    if (action === 'change_striker') return openPlayersModal('change_striker');
    if (action === 'retire') return openRetireModal();
    if (action === 'undo') return undoLastBall();
    if (action === 'end_innings') {
      if (confirm('End the current innings now?')) return dispatchEvent({ eventType: 'end_innings' });
      return;
    }
    if (action === 'start_2nd') return startSecondInnings();
    if (action === 'super_over') return startSuperOver();
    if (action === 'correct_score') {
      const delta = prompt('Enter run adjustment (e.g. 2 or -1):', '0');
      if (delta === null) return;
      return dispatchEvent({ eventType: 'score_correction', deltaRuns: Number(delta || 0) });
    }
    if (action === 'change_xi') {
      return openPlayingXIModal();
    }

    const localKey = matchDoc._id || matchDoc.clientMatchId;
    if (action === 'complete') {
      const potm = prompt('Enter Player of the Match name (optional):', '');
      if (potm === null) return;
      try {
        if (navigator.onLine && !String(localKey).startsWith('cm_')) {
          await ApnaAPI.post(`/api/matches/${localKey}/control`, { action: 'complete', playerOfMatchName: potm || '' });
          await loadMatchState();
        } else {
          matchDoc.status = 'completed';
          matchDoc.result = Object.assign({}, matchDoc.result || {}, { playerOfMatchName: potm || '' });
          await ApnaOffline.saveMatchLocally({ localId: localKey, match: matchDoc, innings: inningsList, syncStatus: 'pending' });
          renderAll();
        }
        ApnaUI.showToast('Match completed!');
      } catch (err) {
        ApnaUI.showToast(err.message, 'error');
      }
      return;
    }

    if (action === 'abandon' && !confirm('Abandon this match?')) return;
    try {
      if (navigator.onLine && !String(localKey).startsWith('cm_')) {
        await ApnaAPI.post(`/api/matches/${localKey}/control`, { action, deviceId: ApnaOffline.getDeviceId() });
        await loadMatchState();
      } else {
        if (action === 'pause') matchDoc.status = 'paused';
        else if (action === 'resume') matchDoc.status = 'live';
        else if (action === 'abandon') matchDoc.status = 'abandoned';
        await ApnaOffline.saveMatchLocally({ localId: localKey, match: matchDoc, innings: inningsList, syncStatus: 'pending' });
        renderAll();
      }
      ApnaUI.showToast(`Match action "${action}" applied.`);
    } catch (err) {
      ApnaUI.showToast(err.message, 'error');
    }
  }

  async function startSecondInnings() {
    try {
      const localKey = matchDoc._id || matchDoc.clientMatchId;
      if (navigator.onLine && !String(localKey).startsWith('cm_')) {
        await ApnaAPI.post(`/api/matches/${localKey}/second-innings`, {});
        await loadMatchState();
      } else {
        const inn2 = {
          inningsNumber: 2,
          battingTeamId: activeInnings.bowlingTeamId,
          battingTeamName: activeInnings.bowlingTeamName,
          bowlingTeamId: activeInnings.battingTeamId,
          bowlingTeamName: activeInnings.battingTeamName,
          target: (computedState.totalRuns || 0) + 1,
          status: 'live'
        };
        inningsList.push(inn2);
        matchDoc.currentInningsNumber = 2;
        activeInnings = inn2;
        activeEvents = [];
        recomputeLocalState();
        renderAll();
        await ApnaOffline.saveMatchLocally({ localId: localKey, match: matchDoc, innings: inningsList, syncStatus: 'pending' });
        openPlayersModal('openers');
      }
    } catch (err) {
      ApnaUI.showToast(err.message, 'error');
    }
  }

  async function startSuperOver() {
    try {
      const res = await ApnaAPI.post(`/api/matches/${matchDoc._id}/super-over`, {});
      window.location.href = `/live-score.html?matchId=${res.match._id}`;
    } catch (err) {
      ApnaUI.showToast(err.message, 'error');
    }
  }

  async function openShareModal() {
    if (!ApnaAuth.isLoggedIn() && (matchDoc.ownerType === 'guest' || ApnaAuth.isGuest())) {
      if (window.ApnaMigrate) {
        ApnaMigrate.showRestrictionPrompt('Create a free account to publish permanent public match links and share live score pages.');
        return;
      }
    }
    const idOrCode = matchDoc.matchCode || matchDoc._id;
    const url = `${window.location.origin}/public-match.html?id=${encodeURIComponent(idOrCode)}`;
    document.getElementById('sharePublicUrlInput').value = url;
    document.getElementById('whatsappShareBtn').href = `https://wa.me/?text=${encodeURIComponent(`Watch Live Score: ${matchDoc.title} on ApnaScore! ${url}`)}`;
    document.getElementById('openScorecardPdfBtn').href = `/scorecard.html?matchId=${matchDoc._id}`;
    document.getElementById('copyShareLinkBtn').onclick = () => {
      const inp = document.getElementById('sharePublicUrlInput');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).catch(() => {
          inp.select();
          try { document.execCommand('copy'); } catch (_) {}
        });
      } else {
        inp.select();
        try { document.execCommand('copy'); } catch (_) {}
      }
      ApnaUI.showToast('Live match link copied!');
    };
    try {
      const qr = await ApnaAPI.get(`/api/public/matches/${idOrCode}/qr`);
      document.getElementById('shareQrImg').src = qr.qrDataUrl;
    } catch (_) {}
    document.getElementById('shareModal').classList.add('open');
  }

  function openPlayingXIModal() {
    const modal = document.getElementById('playersSelectModal');
    const title = document.getElementById('playersModalTitle');
    const body = document.getElementById('playersModalBody');
    const saveBtn = document.getElementById('playersModalSaveBtn');
    title.textContent = 'Update Playing XI / Add Player';

    const renderTeamChecks = (teamObj, side) => (teamObj.squad || []).map((p) => `
      <div class="switch-row" style="margin-bottom:6px;padding:6px 10px;">
        <label>${ApnaUI.escapeHtml(p.name)}</label>
        <label class="text-sm"><input type="checkbox" class="xi-sub-${side}" data-pid="${p.playerId}" ${p.isSubstitute ? 'checked' : ''} /> Substitute</label>
      </div>
    `).join('');

    body.innerHTML = `
      <div class="form-group">
        <label class="form-label">${ApnaUI.escapeHtml(matchDoc.teamA.name)}</label>
        ${renderTeamChecks(matchDoc.teamA, 'A')}
      </div>
      <div class="form-group">
        <label class="form-label">${ApnaUI.escapeHtml(matchDoc.teamB.name)}</label>
        ${renderTeamChecks(matchDoc.teamB, 'B')}
      </div>
    `;

    saveBtn.onclick = async () => {
      const applySub = (teamObj, side) => (teamObj.squad || []).map((p) => ({
        ...p,
        isSubstitute: Boolean(document.querySelector(`.xi-sub-${side}[data-pid="${p.playerId}"]`)?.checked)
      }));
      const teamASquad = applySub(matchDoc.teamA, 'A');
      const teamBSquad = applySub(matchDoc.teamB, 'B');
      closeModal('playersSelectModal');
      try {
        const localKey = matchDoc._id || matchDoc.clientMatchId;
        const res = await ApnaAPI.post(`/api/matches/${localKey}/control`, {
          action: 'update_playing_xi',
          teamASquad,
          teamBSquad
        });
        if (res && res.match) matchDoc = res.match;
        ApnaUI.showToast('Playing XI updated.');
      } catch (err) {
        ApnaUI.showToast(err.message, 'error');
      }
    };

    modal.classList.add('open');
  }

  function closeModal(id) {
    document.getElementById(id)?.classList.remove('open');
  }

  root.ScoringUI = {
    closeModal,
    openPlayersModal,
    openWicketModal,
    openRetireModal,
    openMatchSummaryModal,
    openFullScorecardModal,
    dispatchEvent,
    undoLastBall,
    SmartPlayerAutocomplete
  };
}(window));
