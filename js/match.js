/**
 * ApnaScore Match Creation Wizard & Custom Rule Engine UI Controller
 */
(function (root) {
  'use strict';

  let currentStep = 1;
  let teamsList = [];
  let tournamentsList = [];
  let savedPresets = [];
  let currentRules = ApnaScoringEngine.getPresetById('village_6_over');
  let quickPlayerTarget = 'A';
  let urlFixtureId = '';

  const EXTRA_KEYS = [
    { key: 'wide', label: 'Wide Ball', hasBatToggle: false, hasFreeHit: false },
    { key: 'noBall', label: 'No Ball', hasBatToggle: true, hasFreeHit: true },
    { key: 'bye', label: 'Byes', hasBatToggle: false, hasFreeHit: false },
    { key: 'legBye', label: 'Leg Byes', hasBatToggle: false, hasFreeHit: false },
    { key: 'customExtra', label: 'Custom Extra', hasBatToggle: false, hasFreeHit: false }
  ];

  document.addEventListener('DOMContentLoaded', async () => {
    if (!ApnaUI.initShell({ activePage: 'match-create', pageTitle: 'Start New Match', requireAuth: true })) return;

    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('matchDate').value = now.toISOString().slice(0, 16);

    const params = new URLSearchParams(window.location.search);
    urlFixtureId = params.get('fixtureId') || '';

    bindWizardControls();
    await loadInitialData(params);
    renderRulePanels();
  });

  async function loadInitialData(params) {
    try {
      const [tRes, tourRes, setRes] = await Promise.all([
        ApnaAPI.get('/api/teams').catch(() => ({ teams: [] })),
        ApnaAPI.get('/api/tournaments').catch(() => ({ tournaments: [] })),
        ApnaAPI.get('/api/settings').catch(() => ({ presets: [] }))
      ]);

      teamsList = tRes.teams || [];
      tournamentsList = tourRes.tournaments || [];
      savedPresets = setRes.presets || [];

      if (setRes.preferences && setRes.preferences.defaultScoring && setRes.preferences.defaultScoring.rules) {
        currentRules = ApnaScoringEngine.validateAndNormalizeRules(setRes.preferences.defaultScoring.rules).rules;
      }

      populateSelects(params);
    } catch (err) {
      ApnaUI.showToast(err.message, 'warning');
    }
  }

  function populateSelects(params) {
    const tourSelect = document.getElementById('matchTournament');
    tourSelect.innerHTML = `<option value="">Friendly / Standalone Match</option>` +
      tournamentsList.map((t) => `<option value="${t._id}">${ApnaUI.escapeHtml(t.name)} (${ApnaUI.escapeHtml(t.village)})</option>`).join('');
    if (params.get('tournamentId')) tourSelect.value = params.get('tournamentId');

    const teamOpts = teamsList.map((t) => `<option value="${t._id}">${ApnaUI.escapeHtml(t.name)} (${ApnaUI.escapeHtml(t.village)})</option>`).join('');
    const selA = document.getElementById('teamASelect');
    const selB = document.getElementById('teamBSelect');
    selA.innerHTML = teamOpts || '<option value="">No teams yet — click + Quick Team</option>';
    selB.innerHTML = teamOpts || '<option value="">No teams yet — click + Quick Team</option>';

    if (params.get('teamAId')) selA.value = params.get('teamAId');
    if (params.get('teamBId')) selB.value = params.get('teamBId');
    else if (teamsList.length >= 2) selB.selectedIndex = 1;

    const presetSel = document.getElementById('rulePresetSelect');
    const builtIn = ApnaScoringEngine.getRulePresets().map((r) => ({ presetId: r.presetId, name: r.presetName, rules: r }));
    const userSaved = savedPresets.filter((p) => !p.isSystemPreset);
    const allPresets = [...builtIn, ...userSaved];
    presetSel.innerHTML = allPresets.map((p, idx) =>
      `<option value="${ApnaUI.escapeHtml(p.presetId || idx)}">${ApnaUI.escapeHtml(p.name)}</option>`
    ).join('');
    presetSel.dataset.presets = JSON.stringify(allPresets);
    presetSel.value = currentRules.presetId || 'village_6_over';

    refreshTeamSquads();
  }

  function bindWizardControls() {
    document.querySelectorAll('#wizardStepsBar .wizard-step-pill').forEach((btn) => {
      btn.addEventListener('click', () => goStep(Number(btn.dataset.step)));
    });

    document.getElementById('teamASelect').addEventListener('change', refreshTeamSquads);
    document.getElementById('teamBSelect').addEventListener('change', refreshTeamSquads);

    document.querySelectorAll('#oversPresetsGrid .preset-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#oversPresetsGrid .preset-chip').forEach((c) => c.classList.remove('selected'));
        chip.classList.add('selected');
        if (chip.dataset.overs !== 'custom') {
          document.getElementById('customOversInput').value = chip.dataset.overs;
          currentRules.format.oversPerInnings = Number(chip.dataset.overs);
        } else {
          document.getElementById('customOversInput').focus();
        }
      });
    });

    document.getElementById('customOversInput').addEventListener('change', (e) => {
      currentRules.format.oversPerInnings = Number(e.target.value) || 6;
    });

    document.getElementById('ballTypeSelect').addEventListener('change', (e) => {
      currentRules.format.ballType = e.target.value;
    });

    document.getElementById('ballsPerOverInput').addEventListener('change', (e) => {
      currentRules.format.ballsPerOver = Number(e.target.value) || 6;
    });

    document.getElementById('playersPerTeamInput').addEventListener('change', (e) => {
      currentRules.format.playersPerTeam = Number(e.target.value) || 11;
    });

    document.getElementById('maxOversBowlerInput').addEventListener('change', (e) => {
      currentRules.format.maxOversPerBowler = Number(e.target.value) || 0;
    });

    document.getElementById('rulePresetSelect').addEventListener('change', (e) => {
      const all = JSON.parse(e.target.dataset.presets || '[]');
      const found = all.find((p) => (p.presetId || '') === e.target.value);
      if (found && found.rules) {
        const keepOvers = Number(document.getElementById('customOversInput').value) || found.rules.format.oversPerInnings;
        currentRules = ApnaScoringEngine.validateAndNormalizeRules(found.rules).rules;
        currentRules.format.oversPerInnings = keepOvers;
        document.getElementById('maxOversBowlerInput').value = currentRules.format.maxOversPerBowler || 0;
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

    document.getElementById('quickCreateTeamBtn').addEventListener('click', () => {
      document.getElementById('quickTeamModal').classList.add('open');
    });

    document.getElementById('qtSubmitBtn').addEventListener('click', async () => {
      const name = document.getElementById('qtName').value.trim();
      const village = document.getElementById('qtVillage').value.trim();
      if (!name || !village) return ApnaUI.showToast('Team name and village required.', 'error');
      try {
        const res = await ApnaAPI.post('/api/teams', { name, village });
        teamsList.push(res.team);
        populateSelects(new URLSearchParams(window.location.search));
        document.getElementById('quickTeamModal').classList.remove('open');
        document.getElementById('qtName').value = '';
        ApnaUI.showToast(`Team "${res.team.name}" created.`);
      } catch (err) {
        ApnaUI.showToast(err.message, 'error');
      }
    });

    document.getElementById('qpSubmitBtn').addEventListener('click', async () => {
      const name = document.getElementById('qpName').value.trim();
      const village = document.getElementById('qpVillage').value.trim();
      const role = document.getElementById('qpRole').value;
      const teamId = quickPlayerTarget === 'A' ? document.getElementById('teamASelect').value : document.getElementById('teamBSelect').value;
      if (!name || !village || !teamId) return ApnaUI.showToast('Name, village, and team are required.', 'error');
      try {
        const res = await ApnaAPI.post('/api/players', { name, village, role, teamId });
        const team = teamsList.find((t) => t._id === teamId);
        if (team) {
          team.players = team.players || [];
          team.players.push(res.player);
        }
        refreshTeamSquads();
        document.getElementById('quickPlayerModal').classList.remove('open');
        document.getElementById('qpName').value = '';
        ApnaUI.showToast(`Player "${res.player.name}" added.`);
      } catch (err) {
        ApnaUI.showToast(err.message, 'error');
      }
    });

    document.getElementById('saveRulePresetBtn').addEventListener('click', async () => {
      const name = prompt('Enter a name for this custom scoring rule preset:');
      if (!name || !name.trim()) return;
      try {
        collectRuleInputs();
        await ApnaAPI.post('/api/settings/presets', { name: name.trim(), rules: currentRules });
        ApnaUI.showToast(`Rule preset "${name}" saved.`);
      } catch (err) {
        ApnaUI.showToast(err.message, 'error');
      }
    });

    document.getElementById('matchWizardForm').addEventListener('submit', submitMatch);
  }

  function refreshTeamSquads() {
    const idA = document.getElementById('teamASelect').value;
    const idB = document.getElementById('teamBSelect').value;
    const teamA = teamsList.find((t) => t._id === idA);
    const teamB = teamsList.find((t) => t._id === idB);

    const tossSel = document.getElementById('tossWinnerSelect');
    tossSel.innerHTML = '';
    if (teamA) tossSel.innerHTML += `<option value="${teamA._id}">${ApnaUI.escapeHtml(teamA.name)}</option>`;
    if (teamB) tossSel.innerHTML += `<option value="${teamB._id}">${ApnaUI.escapeHtml(teamB.name)}</option>`;

    renderSquadBox('A', teamA);
    renderSquadBox('B', teamB);
  }

  function renderSquadBox(side, team) {
    document.getElementById(`squad${side}Title`).textContent = team ? `${team.name} Squad` : `Team ${side} Squad`;
    const listEl = document.getElementById(`squad${side}List`);
    const capSel = document.getElementById(`cap${side}Select`);
    const wkSel = document.getElementById(`wk${side}Select`);
    if (!team || !team.players || !team.players.length) {
      listEl.innerHTML = `<div class="text-muted">No players yet. Use "+ Add Player" above.</div>`;
      capSel.innerHTML = '<option value="">None</option>';
      wkSel.innerHTML = '<option value="">None</option>';
      return;
    }

    const opts = '<option value="">Select</option>' + team.players.map((p) => `<option value="${p._id}">${ApnaUI.escapeHtml(p.name)}</option>`).join('');
    capSel.innerHTML = opts;
    wkSel.innerHTML = opts;
    if (team.captainId) capSel.value = team.captainId._id || team.captainId;
    if (team.viceCaptainId) wkSel.value = team.viceCaptainId._id || team.viceCaptainId;

    listEl.innerHTML = team.players.map((p, idx) => `
      <div class="switch-row" style="margin-bottom:6px;padding:7px 10px;">
        <label for="sq_${side}_${p._id}">
          <input type="checkbox" id="sq_${side}_${p._id}" class="squad-chk-${side}" data-pid="${p._id}" data-pname="${ApnaUI.escapeHtml(p.name)}" checked />
          ${ApnaUI.escapeHtml(p.name)} <span class="text-muted">(${ApnaUI.escapeHtml(p.role)})</span>
        </label>
        <label class="text-sm text-muted">
          <input type="checkbox" class="sub-chk-${side}" data-pid="${p._id}" ${idx >= 11 ? 'checked' : ''} /> Sub
        </label>
      </div>
    `).join('');
  }

  function renderRulePanels() {
    const r = currentRules;

    // Extras panel
    let extrasHtml = '<div style="display:flex;flex-direction:column;gap:10px;">';
    for (const item of EXTRA_KEYS) {
      const cfg = r.extras[item.key] || {};
      extrasHtml += `
        <div class="card" style="background:var(--bg-surface-alt);padding:12px;">
          <div class="flex-between mb-2">
            <strong>${item.label}</strong>
            <label><input type="checkbox" class="toggle-check rule-extra-inp" data-ek="${item.key}" data-field="enabled" ${cfg.enabled ? 'checked' : ''} /> Enabled</label>
          </div>
          <div class="form-grid-3">
            <div class="form-group" style="margin:0;">
              <label class="form-label">Base / Penalty Runs</label>
              <input type="number" min="0" max="10" class="form-control rule-extra-inp" data-ek="${item.key}" data-field="baseRuns" value="${cfg.baseRuns ?? 0}" />
            </div>
            ${item.key === 'customExtra' ? `<div class="form-group" style="margin:0;"><label class="form-label">Custom Extra Label</label><input type="text" class="form-control rule-extra-inp" data-ek="customExtra" data-field="label" value="${ApnaUI.escapeHtml(cfg.label || 'Bonus Extra')}" /></div>` : ''}
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

    // Overthrow & Penalty
    const ot = r.extras.overthrow || {};
    const pen = r.extras.penalty || {};
    extrasHtml += `
      <div class="card" style="background:var(--bg-surface-alt);padding:12px;">
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
      <div class="card" style="background:var(--bg-surface-alt);padding:12px;">
        <div class="flex-between mb-2">
          <strong>Penalty Runs</strong>
          <label><input type="checkbox" class="toggle-check rule-extra-inp" data-ek="penalty" data-field="enabled" ${pen.enabled ? 'checked' : ''} /> Enabled</label>
        </div>
        <div class="form-grid-2">
          <div class="form-group" style="margin:0;"><label class="form-label">Default Penalty Runs</label><input type="number" min="0" class="form-control rule-extra-inp" data-ek="penalty" data-field="defaultRuns" value="${pen.defaultRuns ?? 5}" /></div>
          <div class="switch-row"><label>Counts to Team</label><input type="checkbox" class="toggle-check rule-extra-inp" data-ek="penalty" data-field="countsToTeam" ${pen.countsToTeam ? 'checked' : ''} /></div>
        </div>
      </div>
    </div>`;
    document.getElementById('rulePanel-extras').innerHTML = extrasHtml;

    // Boundaries panel
    const b = r.boundaries;
    document.getElementById('rulePanel-boundaries').innerHTML = `
      <div class="form-grid-2">
        <div class="form-group"><label class="form-label">Boundary Four Value</label><input type="number" min="1" class="form-control" id="ruleFourRuns" value="${b.fourRuns}" /></div>
        <div class="form-group"><label class="form-label">Six Value</label><input type="number" min="1" class="form-control" id="ruleSixRuns" value="${b.sixRuns}" /></div>
        <div class="form-group"><label class="form-label">Max Runs Per Delivery (0 = No Cap)</label><input type="number" min="0" class="form-control" id="ruleMaxRunsBall" value="${b.maxRunsPerDelivery || 0}" /></div>
        <div class="form-group"><label class="form-label">Direct Hit Boundary Runs</label><input type="number" min="1" class="form-control" id="ruleDirectHitRuns" value="${b.directHitRuns || 4}" /></div>
        <div class="switch-row"><label>Direct Hit Boundary Rule</label><input type="checkbox" class="toggle-check" id="ruleDirectHit" ${b.directHitBoundaryEnabled ? 'checked' : ''} /></div>
      </div>`;

    // Wickets panel
    let wHtml = '<div class="form-grid-2">';
    for (const w of ApnaScoringEngine.WICKET_TYPES) {
      wHtml += `<div class="switch-row"><label>${w.label}${w.id === 'retired_hurt' ? ' <span class="switch-hint">Not counted as wicket</span>' : ''}</label><input type="checkbox" class="toggle-check rule-wicket-inp" data-wk="${w.id}" ${r.wickets[w.id] ? 'checked' : ''} /></div>`;
    }
    wHtml += `<div class="switch-row"><label>Allow Retired Hurt Return</label><input type="checkbox" class="toggle-check" id="ruleAllowHurtReturn" ${r.wickets.allowRetiredHurtReturn ? 'checked' : ''} /></div>`;
    wHtml += `<div class="switch-row"><label>Allow Retired Out Return</label><input type="checkbox" class="toggle-check" id="ruleAllowOutReturn" ${r.wickets.allowRetiredOutReturn ? 'checked' : ''} /></div>`;
    wHtml += '</div>';
    document.getElementById('rulePanel-wickets').innerHTML = wHtml;

    // Local rules panel
    const lr = r.localRules;
    document.getElementById('rulePanel-local').innerHTML = `
      <div class="form-grid-2">
        <div class="switch-row"><label>One-Tip-One-Hand Catch<span class="switch-hint">Gully/Village catch rule</span></label><input type="checkbox" class="toggle-check" id="lrOneTip" ${lr.oneTipOneHandCatch ? 'checked' : ''} /></div>
        <div class="switch-row"><label>Last-Man Batting / Standing<span class="switch-hint">Last batsman continues alone</span></label><input type="checkbox" class="toggle-check" id="lrLastMan" ${lr.lastManBatting ? 'checked' : ''} /></div>
        <div class="switch-row"><label>Unlimited Wickets<span class="switch-hint">Innings ends only on overs/target</span></label><input type="checkbox" class="toggle-check" id="lrUnlimitedWkts" ${r.format.unlimitedWickets ? 'checked' : ''} /></div>
        <div class="switch-row"><label>Fixed Batsman Rule<span class="switch-hint">Disable strike rotation</span></label><input type="checkbox" class="toggle-check" id="lrFixedBat" ${lr.fixedBatsmanRule ? 'checked' : ''} /></div>
        <div class="switch-row"><label>No Consecutive Overs by Same Bowler</label><input type="checkbox" class="toggle-check" id="lrNoConsecBowler" ${r.format.noConsecutiveOversBySameBowler ? 'checked' : ''} /></div>
        <div class="switch-row"><label>Allow Super Over on Tie</label><input type="checkbox" class="toggle-check" id="lrSuperOver" ${r.format.allowSuperOverOnTie ? 'checked' : ''} /></div>
        <div class="switch-row"><label>Rotate Strike on Odd Runs</label><input type="checkbox" class="toggle-check" id="lrRotateOdd" ${lr.rotateStrikeOnOddRuns ? 'checked' : ''} /></div>
        <div class="switch-row"><label>Rotate Strike on Over End</label><input type="checkbox" class="toggle-check" id="lrRotateOver" ${lr.rotateStrikeOnOverEnd ? 'checked' : ''} /></div>
        <div class="form-group"><label class="form-label">Custom Max Wickets (Leave blank for auto)</label><input type="number" min="1" class="form-control" id="lrCustomMaxWkts" value="${lr.customMaxWickets ?? ''}" placeholder="Auto" /></div>
      </div>`;
  }

  function collectRuleInputs() {
    document.querySelectorAll('.rule-extra-inp').forEach((inp) => {
      const ek = inp.dataset.ek;
      const field = inp.dataset.field;
      if (!currentRules.extras[ek]) currentRules.extras[ek] = {};
      if (inp.type === 'checkbox') currentRules.extras[ek][field] = inp.checked;
      else if (inp.type === 'text') currentRules.extras[ek][field] = inp.value;
      else currentRules.extras[ek][field] = Number(inp.value || 0);
    });

    currentRules.boundaries.fourRuns = Number(document.getElementById('ruleFourRuns')?.value || 4);
    currentRules.boundaries.sixRuns = Number(document.getElementById('ruleSixRuns')?.value || 6);
    currentRules.boundaries.maxRunsPerDelivery = Number(document.getElementById('ruleMaxRunsBall')?.value || 0);
    currentRules.boundaries.directHitRuns = Number(document.getElementById('ruleDirectHitRuns')?.value || 4);
    currentRules.boundaries.directHitBoundaryEnabled = Boolean(document.getElementById('ruleDirectHit')?.checked);

    document.querySelectorAll('.rule-wicket-inp').forEach((inp) => {
      currentRules.wickets[inp.dataset.wk] = inp.checked;
    });
    currentRules.wickets.allowRetiredHurtReturn = Boolean(document.getElementById('ruleAllowHurtReturn')?.checked);
    currentRules.wickets.allowRetiredOutReturn = Boolean(document.getElementById('ruleAllowOutReturn')?.checked);

    currentRules.localRules.oneTipOneHandCatch = Boolean(document.getElementById('lrOneTip')?.checked);
    currentRules.localRules.lastManBatting = Boolean(document.getElementById('lrLastMan')?.checked);
    currentRules.localRules.lastManStanding = currentRules.localRules.lastManBatting;
    currentRules.format.unlimitedWickets = Boolean(document.getElementById('lrUnlimitedWkts')?.checked);
    currentRules.localRules.fixedBatsmanRule = Boolean(document.getElementById('lrFixedBat')?.checked);
    currentRules.format.noConsecutiveOversBySameBowler = Boolean(document.getElementById('lrNoConsecBowler')?.checked);
    currentRules.format.allowSuperOverOnTie = Boolean(document.getElementById('lrSuperOver')?.checked);
    currentRules.localRules.rotateStrikeOnOddRuns = Boolean(document.getElementById('lrRotateOdd')?.checked);
    currentRules.localRules.rotateStrikeOnOverEnd = Boolean(document.getElementById('lrRotateOver')?.checked);
    const customMax = document.getElementById('lrCustomMaxWkts')?.value;
    currentRules.localRules.customMaxWickets = customMax ? Number(customMax) : null;

    currentRules.format.oversPerInnings = Number(document.getElementById('customOversInput').value || 6);
    currentRules.format.ballsPerOver = Number(document.getElementById('ballsPerOverInput').value || 6);
    currentRules.format.playersPerTeam = Number(document.getElementById('playersPerTeamInput').value || 11);
    currentRules.format.ballType = document.getElementById('ballTypeSelect').value;
    currentRules.format.maxOversPerBowler = Number(document.getElementById('maxOversBowlerInput').value || 0);

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

  function goStep(step) {
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
    if (step === 5) renderConfirmSummary();
  }

  function renderConfirmSummary() {
    collectRuleInputs();
    const idA = document.getElementById('teamASelect').value;
    const idB = document.getElementById('teamBSelect').value;
    const tA = teamsList.find((t) => t._id === idA);
    const tB = teamsList.find((t) => t._id === idB);
    const tossId = document.getElementById('tossWinnerSelect').value;
    const tossTeam = teamsList.find((t) => t._id === tossId);
    const tossDec = document.getElementById('tossDecisionSelect').value;

    document.getElementById('matchConfirmSummary').innerHTML = `
      <h3 style="margin-top:0;">${ApnaUI.escapeHtml(document.getElementById('matchTitle').value || `${tA ? tA.name : 'Team A'} vs ${tB ? tB.name : 'Team B'}`)}</h3>
      <p><strong>Teams:</strong> ${ApnaUI.escapeHtml(tA ? tA.name : '-')} vs ${ApnaUI.escapeHtml(tB ? tB.name : '-')}</p>
      <p><strong>Format:</strong> ${currentRules.format.oversPerInnings} Overs (${currentRules.format.ballsPerOver} balls/over) • ${currentRules.format.ballType.toUpperCase()} • ${currentRules.format.playersPerTeam} players/side</p>
      <p><strong>Venue:</strong> ${ApnaUI.escapeHtml(document.getElementById('matchVenue').value || 'Village Ground')}</p>
      <p><strong>Toss:</strong> ${tossTeam ? `${ApnaUI.escapeHtml(tossTeam.name)} elected to ${tossDec}` : 'TBD'}</p>
      <p><strong>Rule Snapshot:</strong> Max Wickets: ${currentRules.format.unlimitedWickets ? 'Unlimited' : currentRules.format.maxWickets} • Last Man Batting: ${currentRules.localRules.lastManBatting ? 'Yes' : 'No'} • One-Tip Catch: ${currentRules.localRules.oneTipOneHandCatch ? 'Yes' : 'No'} • Free Hit: ${currentRules.extras.noBall.freeHitOnNextBall ? 'Yes' : 'No'}</p>
    `;
  }

  function collectSquad(side) {
    const squad = [];
    document.querySelectorAll(`.squad-chk-${side}:checked`).forEach((chk) => {
      const pid = chk.dataset.pid;
      const isSub = Boolean(document.querySelector(`.sub-chk-${side}[data-pid="${pid}"]`)?.checked);
      squad.push({ playerId: pid, name: chk.dataset.pname, isSubstitute: isSub });
    });
    return squad;
  }

  async function submitMatch(e) {
    e.preventDefault();
    const validation = collectRuleInputs();
    if (!validation.valid) {
      return ApnaUI.showToast(validation.errors.join(' '), 'error');
    }
    const teamAId = document.getElementById('teamASelect').value;
    const teamBId = document.getElementById('teamBSelect').value;
    if (!teamAId || !teamBId || teamAId === teamBId) {
      return ApnaUI.showToast('Please select two distinct teams.', 'error');
    }

    const btn = document.getElementById('startMatchSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Starting Match...';

    const clientMatchId = 'cm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const tA = teamsList.find((t) => t._id === teamAId);
    const tB = teamsList.find((t) => t._id === teamBId);
    const payload = {
      title: document.getElementById('matchTitle').value.trim(),
      clientMatchId,
      tournamentId: document.getElementById('matchTournament').value || null,
      fixtureId: urlFixtureId || null,
      teamAId,
      teamBId,
      teamASquad: collectSquad('A'),
      teamBSquad: collectSquad('B'),
      teamACaptainId: document.getElementById('capASelect').value || null,
      teamAWicketkeeperId: document.getElementById('wkASelect').value || null,
      teamBCaptainId: document.getElementById('capBSelect').value || null,
      teamBWicketkeeperId: document.getElementById('wkBSelect').value || null,
      matchDate: document.getElementById('matchDate').value,
      venue: document.getElementById('matchVenue').value.trim() || 'Village Ground',
      matchType: document.getElementById('matchType').value,
      ballType: currentRules.format.ballType,
      oversPerInnings: currentRules.format.oversPerInnings,
      playersPerTeam: currentRules.format.playersPerTeam,
      tossWinnerTeamId: document.getElementById('tossWinnerSelect').value,
      tossDecision: document.getElementById('tossDecisionSelect').value,
      rules: currentRules,
      officials: { scorerName: document.getElementById('scorerNameInput').value.trim() },
      startImmediately: true
    };

    try {
      const res = await ApnaAPI.post('/api/matches', payload);
      await ApnaOffline.saveMatchLocally({ match: res.match, innings: res.innings, syncStatus: 'synced' });
      window.location.href = `/live-score.html?matchId=${res.match._id}`;
    } catch (err) {
      if (err.isOffline || !navigator.onLine) {
        // Offline match start & scoring!
        const tossWinId = payload.tossWinnerTeamId || teamAId;
        const batFirst = (tossWinId === teamAId && payload.tossDecision === 'bat') || (tossWinId === teamBId && payload.tossDecision === 'bowl') ? tA : tB;
        const bowlFirst = batFirst._id === tA._id ? tB : tA;
        const offlineMatch = {
          _id: clientMatchId,
          clientMatchId,
          title: payload.title || `${tA.name} vs ${tB.name}`,
          teamA: { teamId: tA._id, name: tA.name, squad: payload.teamASquad },
          teamB: { teamId: tB._id, name: tB.name, squad: payload.teamBSquad },
          venue: payload.venue,
          matchDate: payload.matchDate,
          oversPerInnings: currentRules.format.oversPerInnings,
          playersPerTeam: currentRules.format.playersPerTeam,
          ballType: currentRules.format.ballType,
          rulesSnapshot: currentRules,
          status: 'live',
          currentInningsNumber: 1
        };
        const inn1 = {
          inningsNumber: 1,
          battingTeamId: batFirst._id,
          battingTeamName: batFirst.name,
          bowlingTeamId: bowlFirst._id,
          bowlingTeamName: bowlFirst.name,
          status: 'live'
        };
        await ApnaOffline.saveMatchLocally({ localId: clientMatchId, match: offlineMatch, innings: [inn1], syncStatus: 'pending' });
        ApnaUI.showToast('Offline mode: Match saved locally. Scoring ready!', 'warning');
        window.location.href = `/live-score.html?matchId=${clientMatchId}`;
      } else {
        ApnaUI.showToast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Start Match & Open Scorer';
      }
    }
  }

  root.MatchWizard = {
    goStep,
    openQuickPlayerModal: (side) => {
      quickPlayerTarget = side;
      document.getElementById('quickPlayerModal').classList.add('open');
    }
  };
}(window));
