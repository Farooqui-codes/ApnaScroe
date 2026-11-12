/**
 * ApnaScore Simple Match Wizard Controller
 * 4 simple steps for beginners + collapsible Advanced Match Settings underneath.
 */
(function (root) {
  'use strict';

  let currentStep = 1;
  let userTeams = [];
  let savedPresets = [];
  let currentRules = ApnaScoringEngine.getPresetById('village_6_over');
  let tossWinnerSide = 'A';
  let tossDecision = 'bat';
  let urlTournamentId = '';
  let urlFixtureId = '';
  let preselectedTeamAId = '';
  let preselectedTeamBId = '';

  const EXTRA_KEYS = [
    { key: 'wide', label: 'Wide Ball', hasBatToggle: false, hasFreeHit: false },
    { key: 'noBall', label: 'No Ball', hasBatToggle: true, hasFreeHit: true },
    { key: 'bye', label: 'Byes', hasBatToggle: false, hasFreeHit: false },
    { key: 'legBye', label: 'Leg Byes', hasBatToggle: false, hasFreeHit: false },
    { key: 'customExtra', label: 'Custom Extra', hasBatToggle: false, hasFreeHit: false }
  ];

  document.addEventListener('DOMContentLoaded', async () => {
    if (!ApnaAuth.isAuthenticatedOrGuest()) {
      await ApnaAuth.continueAsGuest(null);
    }
    if (!ApnaUI.initShell({ activePage: 'match-create', pageTitle: 'Simple Match' })) return;

    const params = new URLSearchParams(window.location.search);
    urlTournamentId = params.get('tournamentId') || '';
    urlFixtureId = params.get('fixtureId') || '';
    preselectedTeamAId = params.get('teamAId') || '';
    preselectedTeamBId = params.get('teamBId') || '';

    if (urlTournamentId) {
      document.getElementById('tournamentMatchNotice')?.classList.remove('hidden');
    }

    bindWizardControls();
    await loadTeamsAndPresets();
    renderRulePanels();
  });

  async function loadTeamsAndPresets() {
    try {
      const [tRes, setRes, localTeams, localRules] = await Promise.all([
        ApnaAPI.get('/api/teams?mine=1').catch(() => ({ teams: [] })),
        ApnaAPI.get('/api/settings').catch(() => ({ presets: [] })),
        ApnaOffline.getLocalTeams().catch(() => []),
        ApnaOffline.getLocalRules().catch(() => [])
      ]);

      const merged = [...(tRes.teams || [])];
      for (const lt of localTeams) {
        if (!lt.migrated && !merged.some((t) => String(t._id) === String(lt._id))) {
          merged.push(Object.assign({}, lt, { _id: lt._id || lt.localId }));
        }
      }
      userTeams = merged;

      const dl = document.getElementById('existingTeamsDatalist');
      dl.innerHTML = userTeams.map((t) => `<option value="${ApnaUI.escapeHtml(t.name)}"></option>`).join('');

      if (preselectedTeamAId) {
        const tA = userTeams.find((t) => String(t._id) === String(preselectedTeamAId));
        if (tA) document.getElementById('teamANameInput').value = tA.name;
      }
      if (preselectedTeamBId) {
        const tB = userTeams.find((t) => String(t._id) === String(preselectedTeamBId));
        if (tB) document.getElementById('teamBNameInput').value = tB.name;
      }

      if (setRes.preferences && setRes.preferences.defaultScoring && setRes.preferences.defaultScoring.rules) {
        currentRules = ApnaScoringEngine.validateAndNormalizeRules(setRes.preferences.defaultScoring.rules).rules;
        const defOvers = Number(currentRules.format.oversPerInnings) || 6;
        const defPlayers = Number(currentRules.format.playersPerTeam) || 11;
        document.getElementById('customOversInput').value = defOvers;
        document.getElementById('playersPerTeamInput').value = defPlayers;
        if (currentRules.format.ballType) {
          document.getElementById('ballTypeSelect').value = currentRules.format.ballType;
        }
        const chips = Array.from(document.querySelectorAll('#oversPresetsGrid .preset-chip'));
        chips.forEach((c) => c.classList.remove('selected'));
        const matchingChip = chips.find((c) => Number(c.dataset.overs) === defOvers);
        if (matchingChip) {
          matchingChip.classList.add('selected');
          document.getElementById('customOversWrap').classList.add('hidden');
        } else {
          chips.find((c) => c.dataset.overs === 'custom')?.classList.add('selected');
          document.getElementById('customOversWrap').classList.remove('hidden');
        }
      }

      savedPresets = [...(setRes.presets || []), ...localRules];
      const builtIn = ApnaScoringEngine.getRulePresets().map((r) => ({ presetId: r.presetId, name: r.presetName, rules: r }));
      const userSaved = savedPresets.filter((p) => !p.isSystemPreset);
      const allPresets = [...builtIn, ...userSaved];
      const presetSel = document.getElementById('rulePresetSelect');
      presetSel.innerHTML = allPresets
        .map((p, idx) => `<option value="${ApnaUI.escapeHtml(p.presetId || idx)}">${ApnaUI.escapeHtml(p.name)}</option>`)
        .join('');
      presetSel.dataset.presets = JSON.stringify(allPresets);
      presetSel.value = currentRules.presetId || 'village_6_over';
    } catch (_) {}
  }

  function bindWizardControls() {
    document.querySelectorAll('#wizardStepsBar .wizard-step-pill').forEach((btn) => {
      btn.addEventListener('click', () => goStep(Number(btn.dataset.step)));
    });

    // Overs chips
    document.querySelectorAll('#oversPresetsGrid .preset-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#oversPresetsGrid .preset-chip').forEach((c) => c.classList.remove('selected'));
        chip.classList.add('selected');
        const customWrap = document.getElementById('customOversWrap');
        if (chip.dataset.overs !== 'custom') {
          customWrap.classList.add('hidden');
          document.getElementById('customOversInput').value = chip.dataset.overs;
          currentRules.format.oversPerInnings = Number(chip.dataset.overs);
        } else {
          customWrap.classList.remove('hidden');
          document.getElementById('customOversInput').focus();
        }
      });
    });

    document.getElementById('customOversInput').addEventListener('change', (e) => {
      currentRules.format.oversPerInnings = Math.max(1, Number(e.target.value) || 6);
    });

    document.getElementById('playersPerTeamInput').addEventListener('change', (e) => {
      currentRules.format.playersPerTeam = Math.max(2, Math.min(20, Number(e.target.value) || 11));
    });

    document.getElementById('skipPlayersBtn').addEventListener('click', () => goStep(3));

    document.getElementById('teamAPlayersText').addEventListener('input', refreshCaptainDropdowns);
    document.getElementById('teamBPlayersText').addEventListener('input', refreshCaptainDropdowns);

    // Toss buttons
    document.getElementById('tossWinnerABtn').addEventListener('click', () => selectTossWinner('A'));
    document.getElementById('tossWinnerBBtn').addEventListener('click', () => selectTossWinner('B'));
    document.getElementById('tossBatBtn').addEventListener('click', () => selectTossDecision('bat'));
    document.getElementById('tossBowlBtn').addEventListener('click', () => selectTossDecision('bowl'));

    // Advanced rules controls
    document.getElementById('ballTypeSelect').addEventListener('change', (e) => {
      currentRules.format.ballType = e.target.value;
    });

    document.getElementById('rulePresetSelect').addEventListener('change', (e) => {
      const all = JSON.parse(e.target.dataset.presets || '[]');
      const found = all.find((p) => (p.presetId || '') === e.target.value);
      if (found && found.rules) {
        const keepOvers = Number(document.getElementById('customOversInput').value) || found.rules.format.oversPerInnings;
        currentRules = ApnaScoringEngine.validateAndNormalizeRules(found.rules).rules;
        currentRules.format.oversPerInnings = keepOvers;
        renderRulePanels();
      }
    });

    document.querySelectorAll('#ruleEngineTabs .tab-btn').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#ruleEngineTabs .tab-btn').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        ['extras', 'boundaries', 'wickets', 'local'].forEach((k) => {
          document.getElementById(`rulePanel-${k}`).classList.toggle('hidden', k !== tab.dataset.ruletab);
        });
      });
    });

    document.getElementById('saveRulePresetBtn').addEventListener('click', async () => {
      const name = prompt('Enter a name for this rule preset:');
      if (!name || !name.trim()) return;
      collectRuleInputs();
      const clientId = 'lrule_' + Date.now();
      await ApnaOffline.saveRuleLocally({ localId: clientId, clientId, name: name.trim(), rules: currentRules });
      try {
        await ApnaAPI.post('/api/settings/presets', { name: name.trim(), rules: currentRules, clientId });
      } catch (_) {}
      ApnaUI.showToast(`Rule preset "${name}" saved.`);
    });

    document.getElementById('matchWizardForm').addEventListener('submit', submitMatch);
  }

  function parsePlayerNames(rawText) {
    return String(rawText || '')
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function refreshCaptainDropdowns() {
    const namesA = parsePlayerNames(document.getElementById('teamAPlayersText').value);
    const namesB = parsePlayerNames(document.getElementById('teamBPlayersText').value);
    const fill = (id, list) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = '<option value="">Optional</option>' + list.map((n) => `<option value="${ApnaUI.escapeHtml(n)}">${ApnaUI.escapeHtml(n)}</option>`).join('');
    };
    fill('capASelect', namesA);
    fill('wkASelect', namesA);
    fill('capBSelect', namesB);
    fill('wkBSelect', namesB);
  }

  function selectTossWinner(side) {
    tossWinnerSide = side;
    document.getElementById('tossWinnerABtn').classList.toggle('selected', side === 'A');
    document.getElementById('tossWinnerBBtn').classList.toggle('selected', side === 'B');
  }

  function selectTossDecision(dec) {
    tossDecision = dec;
    document.getElementById('tossBatBtn').classList.toggle('selected', dec === 'bat');
    document.getElementById('tossBowlBtn').classList.toggle('selected', dec === 'bowl');
  }

  function goStep(step) {
    const nameA = document.getElementById('teamANameInput').value.trim();
    const nameB = document.getElementById('teamBNameInput').value.trim();

    if (step > 1) {
      if (!nameA || !nameB) {
        return ApnaUI.showToast('Please enter both Team A and Team B names.', 'error');
      }
      if (nameA.toLowerCase() === nameB.toLowerCase()) {
        return ApnaUI.showToast('Team A and Team B names must be different.', 'error');
      }
      document.getElementById('teamAPlayersLabel').textContent = `${nameA} Player Names (optional)`;
      document.getElementById('teamBPlayersLabel').textContent = `${nameB} Player Names (optional)`;
      document.getElementById('tossWinnerABtn').textContent = `${nameA} won toss`;
      document.getElementById('tossWinnerBBtn').textContent = `${nameB} won toss`;
    }

    if (currentStep === 4) collectRuleInputs();
    currentStep = step;
    document.querySelectorAll('.wizard-panel').forEach((p) => {
      p.classList.toggle('hidden', Number(p.dataset.panel) !== step);
    });
    document.querySelectorAll('#wizardStepsBar .wizard-step-pill').forEach((pill) => {
      const s = Number(pill.dataset.step);
      pill.classList.toggle('active', s === step);
      pill.classList.toggle('done', s < step);
    });
    if (step === 4) renderConfirmSummary();
  }

  function renderRulePanels() {
    const r = currentRules;
    let extrasHtml = '<div style="display:flex;flex-direction:column;gap:10px;">';
    for (const item of EXTRA_KEYS) {
      const cfg = r.extras[item.key] || {};
      extrasHtml += `
        <div class="card" style="background:var(--bg-surface);padding:12px;">
          <div class="flex-between mb-2">
            <strong>${item.label}</strong>
            <label><input type="checkbox" class="toggle-check rule-extra-inp" data-ek="${item.key}" data-field="enabled" ${cfg.enabled ? 'checked' : ''} /> Enabled</label>
          </div>
          <div class="form-grid-3">
            <div class="form-group" style="margin:0;">
              <label class="form-label">Penalty Runs</label>
              <input type="number" min="0" max="10" class="form-control rule-extra-inp" data-ek="${item.key}" data-field="baseRuns" value="${cfg.baseRuns ?? 0}" />
            </div>
            <div class="switch-row"><label>Legal Delivery</label><input type="checkbox" class="toggle-check rule-extra-inp" data-ek="${item.key}" data-field="countsAsLegalDelivery" ${cfg.countsAsLegalDelivery ? 'checked' : ''} /></div>
            <div class="switch-row"><label>Additional Runs</label><input type="checkbox" class="toggle-check rule-extra-inp" data-ek="${item.key}" data-field="allowAdditionalRuns" ${cfg.allowAdditionalRuns ? 'checked' : ''} /></div>
            <div class="switch-row"><label>Counts to Team</label><input type="checkbox" class="toggle-check rule-extra-inp" data-ek="${item.key}" data-field="countsToTeam" ${cfg.countsToTeam ? 'checked' : ''} /></div>
            <div class="switch-row"><label>Counts to Batsman</label><input type="checkbox" class="toggle-check rule-extra-inp" data-ek="${item.key}" data-field="countsToBatsman" ${cfg.countsToBatsman ? 'checked' : ''} /></div>
            <div class="switch-row"><label>Counts to Bowler</label><input type="checkbox" class="toggle-check rule-extra-inp" data-ek="${item.key}" data-field="countsToBowler" ${cfg.countsToBowler ? 'checked' : ''} /></div>
            ${item.hasFreeHit ? `<div class="switch-row"><label>Free Hit Next Ball</label><input type="checkbox" class="toggle-check rule-extra-inp" data-ek="${item.key}" data-field="freeHitOnNextBall" ${cfg.freeHitOnNextBall ? 'checked' : ''} /></div>` : ''}
            ${item.hasBatToggle ? `<div class="switch-row"><label>Allow Bat Runs</label><input type="checkbox" class="toggle-check rule-extra-inp" data-ek="${item.key}" data-field="allowBatRuns" ${cfg.allowBatRuns ? 'checked' : ''} /></div>` : ''}
          </div>
        </div>`;
    }
    const ot = r.extras.overthrow || {};
    extrasHtml += `
      <div class="card" style="background:var(--bg-surface);padding:12px;">
        <div class="flex-between mb-2">
          <strong>Overthrows</strong>
          <label><input type="checkbox" class="toggle-check rule-extra-inp" data-ek="overthrow" data-field="enabled" ${ot.enabled ? 'checked' : ''} /> Enabled</label>
        </div>
        <div class="form-grid-3">
          <div class="switch-row"><label>Counts to Batsman</label><input type="checkbox" class="toggle-check rule-extra-inp" data-ek="overthrow" data-field="countsToBatsman" ${ot.countsToBatsman ? 'checked' : ''} /></div>
          <div class="switch-row"><label>Counts to Bowler</label><input type="checkbox" class="toggle-check rule-extra-inp" data-ek="overthrow" data-field="countsToBowler" ${ot.countsToBowler ? 'checked' : ''} /></div>
          <div class="switch-row"><label>Rotates Strike on Odd</label><input type="checkbox" class="toggle-check rule-extra-inp" data-ek="overthrow" data-field="rotatesStrikeOnOdd" ${ot.rotatesStrikeOnOdd ? 'checked' : ''} /></div>
        </div>
      </div>
    </div>`;
    document.getElementById('rulePanel-extras').innerHTML = extrasHtml;

    const b = r.boundaries;
    document.getElementById('rulePanel-boundaries').innerHTML = `
      <div class="form-grid-2">
        <div class="form-group"><label class="form-label">Boundary Four Runs</label><input type="number" min="1" class="form-control" id="ruleFourRuns" value="${b.fourRuns}" /></div>
        <div class="form-group"><label class="form-label">Six Runs</label><input type="number" min="1" class="form-control" id="ruleSixRuns" value="${b.sixRuns}" /></div>
        <div class="form-group"><label class="form-label">Max Runs Per Ball (0 = Unlimited)</label><input type="number" min="0" class="form-control" id="ruleMaxRunsBall" value="${b.maxRunsPerDelivery || 0}" /></div>
        <div class="switch-row"><label>Direct Hit Boundary</label><input type="checkbox" class="toggle-check" id="ruleDirectHit" ${b.directHitBoundaryEnabled ? 'checked' : ''} /></div>
      </div>`;

    let wHtml = '<div class="form-grid-2">';
    for (const w of ApnaScoringEngine.WICKET_TYPES) {
      wHtml += `<div class="switch-row"><label>${w.label}</label><input type="checkbox" class="toggle-check rule-wicket-inp" data-wk="${w.id}" ${r.wickets[w.id] ? 'checked' : ''} /></div>`;
    }
    wHtml += '</div>';
    document.getElementById('rulePanel-wickets').innerHTML = wHtml;

    const lr = r.localRules;
    document.getElementById('rulePanel-local').innerHTML = `
      <div class="form-grid-2">
        <div class="switch-row"><label>One-Tip-One-Hand Catch</label><input type="checkbox" class="toggle-check" id="lrOneTip" ${lr.oneTipOneHandCatch ? 'checked' : ''} /></div>
        <div class="switch-row"><label>Last-Man Batting</label><input type="checkbox" class="toggle-check" id="lrLastMan" ${lr.lastManBatting ? 'checked' : ''} /></div>
        <div class="switch-row"><label>Unlimited Wickets</label><input type="checkbox" class="toggle-check" id="lrUnlimitedWkts" ${r.format.unlimitedWickets ? 'checked' : ''} /></div>
        <div class="switch-row"><label>Fixed Batsman Rule</label><input type="checkbox" class="toggle-check" id="lrFixedBat" ${lr.fixedBatsmanRule ? 'checked' : ''} /></div>
        <div class="switch-row"><label>No Consecutive Overs by Same Bowler</label><input type="checkbox" class="toggle-check" id="lrNoConsecBowler" ${r.format.noConsecutiveOversBySameBowler ? 'checked' : ''} /></div>
      </div>`;
  }

  function collectRuleInputs() {
    document.querySelectorAll('.rule-extra-inp').forEach((inp) => {
      const ek = inp.dataset.ek;
      const field = inp.dataset.field;
      if (!currentRules.extras[ek]) currentRules.extras[ek] = {};
      currentRules.extras[ek][field] = inp.type === 'checkbox' ? inp.checked : Number(inp.value || 0);
    });

    currentRules.boundaries.fourRuns = Number(document.getElementById('ruleFourRuns')?.value || 4);
    currentRules.boundaries.sixRuns = Number(document.getElementById('ruleSixRuns')?.value || 6);
    currentRules.boundaries.maxRunsPerDelivery = Number(document.getElementById('ruleMaxRunsBall')?.value || 0);
    currentRules.boundaries.directHitBoundaryEnabled = Boolean(document.getElementById('ruleDirectHit')?.checked);

    document.querySelectorAll('.rule-wicket-inp').forEach((inp) => {
      currentRules.wickets[inp.dataset.wk] = inp.checked;
    });

    currentRules.localRules.oneTipOneHandCatch = Boolean(document.getElementById('lrOneTip')?.checked);
    currentRules.localRules.lastManBatting = Boolean(document.getElementById('lrLastMan')?.checked);
    currentRules.localRules.lastManStanding = currentRules.localRules.lastManBatting;
    currentRules.format.unlimitedWickets = Boolean(document.getElementById('lrUnlimitedWkts')?.checked);
    currentRules.localRules.fixedBatsmanRule = Boolean(document.getElementById('lrFixedBat')?.checked);
    currentRules.format.noConsecutiveOversBySameBowler = Boolean(document.getElementById('lrNoConsecBowler')?.checked);

    currentRules.format.oversPerInnings = Number(document.getElementById('customOversInput').value || 6);
    currentRules.format.playersPerTeam = Number(document.getElementById('playersPerTeamInput').value || 11);
    currentRules.format.ballType = document.getElementById('ballTypeSelect').value;

    const validated = ApnaScoringEngine.validateAndNormalizeRules(currentRules);
    currentRules = validated.rules;

    const warnBox = document.getElementById('ruleWarningsBox');
    if (validated.warnings.length) {
      warnBox.textContent = validated.warnings.join(' ');
      warnBox.classList.remove('hidden');
    } else {
      warnBox.classList.add('hidden');
    }
    return validated;
  }

  function renderConfirmSummary() {
    collectRuleInputs();
    const nameA = document.getElementById('teamANameInput').value.trim() || 'Team A';
    const nameB = document.getElementById('teamBNameInput').value.trim() || 'Team B';
    const pA = parsePlayerNames(document.getElementById('teamAPlayersText').value);
    const pB = parsePlayerNames(document.getElementById('teamBPlayersText').value);
    const tossTeam = tossWinnerSide === 'B' ? nameB : nameA;
    const decLabel = tossDecision === 'bowl' ? 'Bowling First' : 'Batting First';

    document.getElementById('matchConfirmSummary').innerHTML = `
      <h3 style="margin:0 0 10px;">${ApnaUI.escapeHtml(nameA)} vs ${ApnaUI.escapeHtml(nameB)}</h3>
      <div class="flex-between" style="padding:6px 0;border-bottom:1px solid var(--border-color);"><span>Overs</span><strong>${currentRules.format.oversPerInnings} Overs</strong></div>
      <div class="flex-between" style="padding:6px 0;border-bottom:1px solid var(--border-color);"><span>Players per Team</span><strong>${currentRules.format.playersPerTeam} (${pA.length + pB.length > 0 ? `${pA.length} + ${pB.length} names added` : 'Enter names while scoring'})</strong></div>
      <div class="flex-between" style="padding:6px 0;"><span>Toss</span><strong>${ApnaUI.escapeHtml(tossTeam)} chose ${decLabel}</strong></div>
    `;
  }

  async function submitMatch(e) {
    e.preventDefault();
    const validation = collectRuleInputs();
    if (!validation.valid) return ApnaUI.showToast(validation.errors.join(' '), 'error');

    const nameA = document.getElementById('teamANameInput').value.trim();
    const nameB = document.getElementById('teamBNameInput').value.trim();
    if (!nameA || !nameB || nameA.toLowerCase() === nameB.toLowerCase()) {
      return ApnaUI.showToast('Please enter two different team names.', 'error');
    }

    const btn = document.getElementById('startMatchSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Starting Match...';

    const pNamesA = parsePlayerNames(document.getElementById('teamAPlayersText').value);
    const pNamesB = parsePlayerNames(document.getElementById('teamBPlayersText').value);
    const clientMatchId = 'cm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    const payload = {
      title: `${nameA} vs ${nameB}`,
      clientMatchId,
      tournamentId: urlTournamentId || null,
      fixtureId: urlFixtureId || null,
      teamAId: preselectedTeamAId || undefined,
      teamBId: preselectedTeamBId || undefined,
      teamAName: nameA,
      teamBName: nameB,
      teamAPlayerNames: pNamesA,
      teamBPlayerNames: pNamesB,
      venue: document.getElementById('matchVenue')?.value.trim() || 'Local Ground',
      matchType: urlTournamentId ? 'tournament' : 'friendly',
      ballType: currentRules.format.ballType,
      oversPerInnings: currentRules.format.oversPerInnings,
      playersPerTeam: currentRules.format.playersPerTeam,
      tossWinnerSide,
      tossDecision,
      rules: currentRules,
      startImmediately: true
    };

    try {
      const res = await ApnaAPI.post('/api/matches', payload);
      await ApnaOffline.saveMatchLocally({ match: res.match, innings: res.innings, syncStatus: 'synced' });
      window.location.href = `/live-score.html?matchId=${res.match._id}`;
    } catch (err) {
      // Full Offline Fallback: create teams, players, and match in IndexedDB immediately
      if (err.isOffline || !navigator.onLine) {
        const localTeamAId = 'lteam_a_' + Date.now();
        const localTeamBId = 'lteam_b_' + Date.now();
        const makeLocalSquad = (names, side) =>
          names.map((n, i) => ({ playerId: `lp_${side}_${Date.now()}_${i}`, name: n }));

        const sqA = makeLocalSquad(pNamesA, 'a');
        const sqB = makeLocalSquad(pNamesB, 'b');

        await ApnaOffline.saveTeamLocally({ localId: localTeamAId, name: nameA, village: payload.venue, players: sqA.map((p) => p.playerId) });
        await ApnaOffline.saveTeamLocally({ localId: localTeamBId, name: nameB, village: payload.venue, players: sqB.map((p) => p.playerId) });
        for (const p of [...sqA, ...sqB]) {
          await ApnaOffline.savePlayerLocally({ localId: p.playerId, name: p.name, village: payload.venue });
        }

        const batFirst =
          (tossWinnerSide === 'A' && tossDecision === 'bat') || (tossWinnerSide === 'B' && tossDecision === 'bowl')
            ? { id: localTeamAId, name: nameA }
            : { id: localTeamBId, name: nameB };
        const bowlFirst = batFirst.id === localTeamAId ? { id: localTeamBId, name: nameB } : { id: localTeamAId, name: nameA };

        const offlineMatch = {
          _id: clientMatchId,
          clientMatchId,
          title: payload.title,
          teamA: { teamId: localTeamAId, name: nameA, squad: sqA },
          teamB: { teamId: localTeamBId, name: nameB, squad: sqB },
          venue: payload.venue,
          matchDate: new Date().toISOString(),
          oversPerInnings: currentRules.format.oversPerInnings,
          playersPerTeam: currentRules.format.playersPerTeam,
          ballType: currentRules.format.ballType,
          rulesSnapshot: currentRules,
          status: 'live',
          currentInningsNumber: 1
        };
        const inn1 = {
          inningsNumber: 1,
          battingTeamId: batFirst.id,
          battingTeamName: batFirst.name,
          bowlingTeamId: bowlFirst.id,
          bowlingTeamName: bowlFirst.name,
          status: 'live'
        };
        await ApnaOffline.saveMatchLocally({ localId: clientMatchId, match: offlineMatch, innings: [inn1], syncStatus: 'pending' });
        ApnaUI.showToast('Offline mode: Match ready to score!', 'warning');
        window.location.href = `/live-score.html?matchId=${clientMatchId}`;
      } else {
        ApnaUI.showToast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Start Scoring';
      }
    }
  }

  root.MatchWizard = { goStep };
}(window));
