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
    document.getElementById('bowlTeamSub').textContent = `vs ${computedState.bowlingTeamName} • ${matchDoc.venue}`;
    document.getElementById('mainScoreDigits').textContent = `${computedState.totalRuns}/${computedState.wickets}`;
    document.getElementById('mainOversDigits').textContent = `(${computedState.oversString} / ${rules.format.oversPerInnings} ov)`;

    const statusBadge = document.getElementById('matchStatusBadge');
    statusBadge.textContent = matchDoc.status.toUpperCase();
    statusBadge.className = `badge ${matchDoc.status === 'live' ? 'badge-live' : 'badge-success'}`;

    document.getElementById('freeHitBanner').classList.toggle('hidden', !computedState.isFreeHit);
    document.getElementById('crrText').textContent = `CRR: ${computedState.currentRunRate.toFixed(2)}`;
    document.getElementById('extrasText').textContent = `Extras: ${computedState.extrasBreakdown.total}`;

    const targetEl = document.getElementById('targetText');
    const reqEl = document.getElementById('reqText');
    if (computedState.target) {
      targetEl.classList.remove('hidden');
      reqEl.classList.remove('hidden');
      targetEl.textContent = `Target: ${computedState.target}`;
      reqEl.textContent = `Need ${computedState.remainingRuns} off ${computedState.remainingBalls}b (RRR: ${(computedState.requiredRunRate || 0).toFixed(2)})`;
    } else {
      targetEl.classList.add('hidden');
      reqEl.classList.add('hidden');
    }

    // Strikers & Non-Striker
    const sStat = computedState.strikerId ? computedState.battingStats[computedState.strikerId] : null;
    const nsStat = computedState.nonStrikerId ? computedState.battingStats[computedState.nonStrikerId] : null;
    document.getElementById('strikerName').textContent = sStat ? `${sStat.name} *` : 'Select Striker *';
    document.getElementById('strikerRuns').textContent = sStat ? sStat.runs : '0';
    document.getElementById('strikerMeta').textContent = sStat ? `${sStat.balls}b • ${sStat.fours}x4 • ${sStat.sixes}x6 • SR ${sStat.strikeRate.toFixed(1)}` : 'Tap Edit to assign';

    document.getElementById('nonStrikerName').textContent = nsStat ? nsStat.name : (rules.localRules.lastManBatting ? 'Last Man Batting' : 'Select Non-Striker');
    document.getElementById('nonStrikerRuns').textContent = nsStat ? nsStat.runs : '-';
    document.getElementById('nonStrikerMeta').textContent = nsStat ? `${nsStat.balls}b • ${nsStat.fours}x4 • ${nsStat.sixes}x6 • SR ${nsStat.strikeRate.toFixed(1)}` : '-';

    const part = computedState.currentPartnership || { runs: 0, balls: 0 };
    document.getElementById('partnershipText').textContent = `Partnership: ${part.runs} run(s) (${part.balls} balls)`;

    // Bowler
    const bw = computedState.currentBowlerId ? computedState.bowlingStats[computedState.currentBowlerId] : null;
    document.getElementById('bowlerName').textContent = bw ? bw.name : 'Select Bowler';
    document.getElementById('bowlerFigures').textContent = bw ? `${bw.wickets}-${bw.runs}` : '0-0';
    document.getElementById('bowlerMeta').textContent = bw ? `${bw.overs} ov • ${bw.maidens} M • Econ ${bw.economy.toFixed(2)}` : 'Select opening bowler';
    document.getElementById('bowlerExtrasMeta').textContent = bw ? `Wides: ${bw.wides} • No-Balls: ${bw.noBalls}` : '';

    // Recent balls timeline
    const strip = document.getElementById('recentBallsStrip');
    const recent = (computedState.recentBalls || []).slice(-18);
    document.getElementById('ballCountLabel').textContent = `${computedState.legalBalls} legal balls`;
    if (!recent.length) {
      strip.innerHTML = `<span class="text-sm text-muted">No deliveries bowled yet.</span>`;
    } else {
      strip.innerHTML = recent.map((b) => {
        let cls = 'ball-chip';
        if (b.isWicket) cls += ' wicket-ball';
        else if (b.isBoundarySix) cls += ' boundary-6';
        else if (b.isBoundaryFour) cls += ' boundary-4';
        else if (b.extraType !== 'none') cls += ' extra-ball';
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
        bannerBtns.innerHTML = `
          <a href="/scorecard.html?matchId=${matchDoc._id}" class="btn btn-primary btn-sm">View Scorecard & PDF</a>
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

  function renderMiniScorecard() {
    const el = document.getElementById('scPanel-scorecard');
    if (!computedState) return;
    const batRows = (computedState.battingOrder || []).map((pid) => {
      const b = computedState.battingStats[pid];
      return `<tr><td><strong>${ApnaUI.escapeHtml(b.name)}</strong><br><span class="text-sm text-muted">${ApnaUI.escapeHtml(b.dismissalText)}</span></td><td class="num"><strong>${b.runs}</strong></td><td class="num">${b.balls}</td><td class="num">${b.fours}</td><td class="num">${b.sixes}</td><td class="num">${b.strikeRate.toFixed(1)}</td></tr>`;
    }).join('');
    const bowlRows = (computedState.bowlingOrder || []).map((pid) => {
      const bw = computedState.bowlingStats[pid];
      return `<tr><td><strong>${ApnaUI.escapeHtml(bw.name)}</strong></td><td class="num">${bw.overs}</td><td class="num">${bw.maidens}</td><td class="num">${bw.runs}</td><td class="num"><strong>${bw.wickets}</strong></td><td class="num">${bw.economy.toFixed(2)}</td></tr>`;
    }).join('');

    el.innerHTML = `
      <div class="table-wrap mb-2">
        <table class="data-table"><thead><tr><th>Batsman</th><th class="num">R</th><th class="num">B</th><th class="num">4s</th><th class="num">6s</th><th class="num">SR</th></tr></thead><tbody>${batRows || '<tr><td colspan="6">No batting data</td></tr>'}</tbody></table>
      </div>
      <div class="table-wrap">
        <table class="data-table"><thead><tr><th>Bowler</th><th class="num">O</th><th class="num">M</th><th class="num">R</th><th class="num">W</th><th class="num">Econ</th></tr></thead><tbody>${bowlRows || '<tr><td colspan="6">No bowling data</td></tr>'}</tbody></table>
      </div>
    `;
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

    if (eventObj.isWicket) ApnaAnimations.celebrate('WICKET!', 'wicket');
    else if (eventObj.batRuns === 6) ApnaAnimations.celebrate('SIX! 6', 'boundary');
    else if (eventObj.batRuns === 4) ApnaAnimations.celebrate('FOUR! 4', 'boundary');

    const localKey = matchDoc._id || matchDoc.clientMatchId;
    await ApnaOffline.saveEventLocally(localKey, innNum, eventObj);

    try {
      if (navigator.onLine && !String(localKey).startsWith('cm_') && ApnaAPI.getToken()) {
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

  function openPlayersModal(mode) {
    const { batSquad, bowlSquad } = getSquads();
    const modal = document.getElementById('playersSelectModal');
    const title = document.getElementById('playersModalTitle');
    const body = document.getElementById('playersModalBody');
    const saveBtn = document.getElementById('playersModalSaveBtn');

    const batOpts = batSquad.map((p) => `<option value="${p.playerId}">${ApnaUI.escapeHtml(p.name)}</option>`).join('');
    const bowlOpts = bowlSquad.map((p) => `<option value="${p.playerId}">${ApnaUI.escapeHtml(p.name)}</option>`).join('');

    if (mode === 'openers') {
      title.textContent = 'Select Striker, Non-Striker & Bowler';
      body.innerHTML = `
        <div class="form-group"><label class="form-label">Striker</label><select class="form-control" id="selStriker">${batOpts}</select></div>
        <div class="form-group"><label class="form-label">Non-Striker</label><select class="form-control" id="selNonStriker">${batOpts}</select></div>
        <div class="form-group"><label class="form-label">Bowler</label><select class="form-control" id="selBowler">${bowlOpts}</select></div>
      `;
      if (batSquad.length > 1) document.getElementById('selNonStriker').selectedIndex = 1;
      saveBtn.onclick = async () => {
        const sEl = document.getElementById('selStriker');
        const nsEl = document.getElementById('selNonStriker');
        const bEl = document.getElementById('selBowler');
        if (sEl.value === nsEl.value && !matchDoc.rulesSnapshot.localRules.lastManBatting) {
          return ApnaUI.showToast('Striker and Non-Striker must be different players.', 'error');
        }
        closeModal('playersSelectModal');
        await dispatchEvent({
          eventType: 'set_openers',
          strikerId: sEl.value,
          strikerName: sEl.options[sEl.selectedIndex]?.text || 'Striker',
          nonStrikerId: nsEl.value,
          nonStrikerName: nsEl.options[nsEl.selectedIndex]?.text || 'Non-Striker',
          bowlerId: bEl.value,
          bowlerName: bEl.options[bEl.selectedIndex]?.text || 'Bowler'
        });
      };
    } else if (mode === 'new_batsman') {
      title.textContent = 'Select Incoming Batsman';
      const available = batSquad.filter((p) => {
        const st = computedState.battingStats[String(p.playerId)];
        const isCurrent = String(p.playerId) === String(computedState.strikerId) || String(p.playerId) === String(computedState.nonStrikerId);
        if (isCurrent) return false;
        if (!st) return true;
        if (st.isRetiredHurt && matchDoc.rulesSnapshot.wickets.allowRetiredHurtReturn) return true;
        if (st.isOut && st.dismissalType === 'retired_out' && matchDoc.rulesSnapshot.wickets.allowRetiredOutReturn) return true;
        return !st.isOut && !st.isRetiredHurt;
      });
      body.innerHTML = `<div class="form-group"><label class="form-label">Next Batsman</label><select class="form-control" id="selNewBat">${
        available.map((p) => `<option value="${p.playerId}">${ApnaUI.escapeHtml(p.name)}</option>`).join('')
      }</select></div>`;
      saveBtn.onclick = async () => {
        const el = document.getElementById('selNewBat');
        if (!el.value) return closeModal('playersSelectModal');
        closeModal('playersSelectModal');
        await dispatchEvent({
          eventType: 'new_batsman',
          playerId: el.value,
          playerName: el.options[el.selectedIndex]?.text || 'Batsman',
          slot: computedState.dismissedSlot || 'striker'
        });
      };
    } else if (mode === 'change_bowler') {
      title.textContent = 'Select Next Bowler';
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
        return true;
      });
      body.innerHTML = `<div class="form-group"><label class="form-label">Bowler</label><select class="form-control" id="selNextBowl">${
        filtered.map((p) => `<option value="${p.playerId}">${ApnaUI.escapeHtml(p.name)}</option>`).join('')
      }</select></div>`;
      saveBtn.onclick = async () => {
        const el = document.getElementById('selNextBowl');
        closeModal('playersSelectModal');
        await dispatchEvent({
          eventType: 'change_bowler',
          bowlerId: el.value,
          bowlerName: el.options[el.selectedIndex]?.text || 'Bowler'
        });
      };
    } else if (mode === 'change_striker') {
      title.textContent = 'Change Active Striker';
      body.innerHTML = `<div class="form-group"><label class="form-label">Striker</label><select class="form-control" id="selChangeStriker">${batOpts}</select></div>`;
      saveBtn.onclick = async () => {
        const el = document.getElementById('selChangeStriker');
        closeModal('playersSelectModal');
        await dispatchEvent({
          eventType: 'change_striker',
          strikerId: el.value,
          strikerName: el.options[el.selectedIndex]?.text || 'Striker'
        });
      };
    }

    modal.classList.add('open');
  }

  function bindScoringUI() {
    // Runs buttons (0..6)
    document.querySelectorAll('.score-btn[data-run]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const run = Number(btn.dataset.run);
        dispatchEvent({ extraType: 'none', batRuns: run });
      });
    });

    // Extras buttons
    document.querySelectorAll('.extra-btn[data-extra]').forEach((btn) => {
      btn.addEventListener('click', () => openExtraModal(btn.dataset.extra));
    });

    document.getElementById('overthrowBtn').addEventListener('click', () => openExtraModal('overthrow'));
    document.getElementById('wicketBtn').addEventListener('click', openWicketModal);
    document.getElementById('undoBallBtn').addEventListener('click', undoLastBall);
    document.getElementById('swapBatsmenBtn').addEventListener('click', () => dispatchEvent({ eventType: 'swap_batsmen' }));
    document.getElementById('selectOpenersBtn').addEventListener('click', () => openPlayersModal('openers'));
    document.getElementById('changeBowlerBtn').addEventListener('click', () => openPlayersModal('change_bowler'));
    document.getElementById('retireBtn').addEventListener('click', openRetireModal);
    document.getElementById('endOverBtn').addEventListener('click', () => {
      if (confirm('End the current over now?')) dispatchEvent({ eventType: 'end_over' });
    });

    document.getElementById('outdoorModeBtn').addEventListener('click', () => {
      document.body.classList.toggle('outdoor-mode');
      localStorage.setItem('apnascore_outdoor_mode', document.body.classList.contains('outdoor-mode') ? '1' : '0');
    });

    // Commentary & Scorecard tabs
    document.querySelectorAll('[data-scview]').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('[data-scview]').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        ['commentary', 'scorecard', 'rules'].forEach((k) => {
          document.getElementById(`scPanel-${k}`).classList.toggle('hidden', k !== tab.dataset.scview);
        });
      });
    });

    document.getElementById('addCommNoteBtn').addEventListener('click', () => {
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
    document.getElementById('recentBallsStrip').addEventListener('click', (e) => {
      const chip = e.target.closest('.ball-chip[data-evid]');
      if (chip) openEditBallModal(chip.dataset.evid);
    });

    // Match controls modal
    document.getElementById('matchControlsBtn').addEventListener('click', () => {
      document.getElementById('matchControlModal').classList.add('open');
    });
    document.querySelectorAll('#matchControlButtonsGrid [data-mc]').forEach((btn) => {
      btn.addEventListener('click', () => handleMatchControlAction(btn.dataset.mc));
    });

    // Share modal
    document.getElementById('shareMatchBtn').addEventListener('click', openShareModal);
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
    } else {
      const defaultAdd = (extraType === 'bye' || extraType === 'leg_bye') ? 1 : (extraType === 'penalty' ? 5 : 0);
      body.innerHTML = `
        <div class="form-group"><label class="form-label">${extraType === 'penalty' ? 'Penalty Runs' : 'Additional Running Runs'}</label>
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
    if (lastIdx < 0) return ApnaUI.showToast('Nothing left to undo.', 'warning');
    if (!confirm('Undo the last scoring action?')) return;

    const targetEv = activeEvents[lastIdx];
    targetEv.isVoided = true;
    recomputeLocalState();
    renderAll();

    const localKey = matchDoc._id || matchDoc.clientMatchId;
    await ApnaOffline.saveEventLocally(localKey, activeInnings.inningsNumber, targetEv);

    if (navigator.onLine && !String(localKey).startsWith('cm_') && ApnaAPI.getToken()) {
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
      if (navigator.onLine && !String(localKey).startsWith('cm_') && ApnaAPI.getToken()) {
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

    const localKey = matchDoc._id || matchDoc.clientMatchId;
    if (action === 'complete') {
      const potm = prompt('Enter Player of the Match name (optional):', '');
      await ApnaAPI.post(`/api/matches/${localKey}/control`, { action: 'complete', playerOfMatchName: potm || '' });
      await loadMatchState();
      ApnaUI.showToast('Match completed!');
      return;
    }

    if (action === 'abandon' && !confirm('Abandon this match?')) return;
    await ApnaAPI.post(`/api/matches/${localKey}/control`, { action, deviceId: ApnaOffline.getDeviceId() });
    await loadMatchState();
    ApnaUI.showToast(`Match action "${action}" applied.`);
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
    const idOrCode = matchDoc.matchCode || matchDoc._id;
    const url = `${window.location.origin}/public-match.html?id=${encodeURIComponent(idOrCode)}`;
    document.getElementById('sharePublicUrlInput').value = url;
    document.getElementById('whatsappShareBtn').href = `https://wa.me/?text=${encodeURIComponent(`Watch Live Score: ${matchDoc.title} on ApnaScore! ${url}`)}`;
    document.getElementById('openScorecardPdfBtn').href = `/scorecard.html?matchId=${matchDoc._id}`;
    document.getElementById('copyShareLinkBtn').onclick = () => {
      navigator.clipboard?.writeText(url);
      ApnaUI.showToast('Live match link copied!');
    };
    try {
      const qr = await ApnaAPI.get(`/api/public/matches/${idOrCode}/qr`);
      document.getElementById('shareQrImg').src = qr.qrDataUrl;
    } catch (_) {}
    document.getElementById('shareModal').classList.add('open');
  }

  function closeModal(id) {
    document.getElementById(id)?.classList.remove('open');
  }

  root.ScoringUI = { closeModal };
}(window));
