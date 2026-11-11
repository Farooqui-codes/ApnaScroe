/**
 * ApnaScore Guest Restriction Prompts & Guest-to-Account Migration Flow
 */
(function (root) {
  'use strict';

  let currentMigrationId = null;

  function ensureModalRoot() {
    let el = document.getElementById('apnaGuestModalBackdrop');
    if (!el) {
      el = document.createElement('div');
      el.id = 'apnaGuestModalBackdrop';
      el.className = 'modal-backdrop';
      el.innerHTML = `<div class="modal-dialog" id="apnaGuestModalDialog"></div>`;
      document.body.appendChild(el);
    }
    return el;
  }

  function closeModal() {
    document.getElementById('apnaGuestModalBackdrop')?.classList.remove('open');
  }

  /**
   * Friendly prompt shown when a guest attempts a registered-only action
   * (public tournaments, permanent public share links, etc.)
   */
  function showRestrictionPrompt(message) {
    const backdrop = ensureModalRoot();
    const dialog = document.getElementById('apnaGuestModalDialog');
    const text = message || 'Create a free account to publish your match and manage tournaments.';
    dialog.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title">Account Required for This Feature</h3>
        <button type="button" class="icon-btn" id="resCloseBtn">✕</button>
      </div>
      <p style="margin-top:0;">${root.ApnaUI ? root.ApnaUI.escapeHtml(text) : text}</p>
      <p class="text-sm text-muted">Your existing local guest matches, teams, and scorecards remain completely safe and will migrate automatically when you sign up or log in.</p>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="resContinueGuestBtn">Continue as Guest</button>
        <a href="/login.html" class="btn btn-secondary">Login</a>
        <a href="/register.html" class="btn btn-primary">Create Account</a>
      </div>
    `;
    document.getElementById('resCloseBtn').onclick = closeModal;
    document.getElementById('resContinueGuestBtn').onclick = closeModal;
    backdrop.classList.add('open');
  }

  /**
   * Checks whether un-migrated guest data exists on this device or server guest session.
   * Returns bundle if migration is eligible, else null.
   */
  async function detectEligibleGuestData() {
    if (!root.ApnaOffline) return null;
    const bundle = await root.ApnaOffline.getGuestMigrationBundle();
    const guestSession = root.ApnaAPI.getGuestSession();
    const gp = bundle.guestProfile || guestSession;
    if (!gp || !gp.guestId) return null;
    if (gp.migrationStatus === 'completed') return null;

    let serverCounts = { matches: 0, teams: 0, players: 0, customRules: 0 };
    if (navigator.onLine && guestSession && guestSession.guestToken && !String(guestSession.guestId).startsWith('gst_local_')) {
      try {
        const sRes = await fetch('/api/guest/session', {
          headers: {
            'X-Guest-Id': guestSession.guestId,
            'X-Guest-Token': guestSession.guestToken
          }
        });
        if (sRes.ok) {
          const sJson = await sRes.json();
          if (sJson.session && sJson.session.migrationStatus === 'completed') return null;
          serverCounts = sJson.counts || serverCounts;
        }
      } catch (_) {}
    }

    const totalLocal =
      bundle.counts.matches +
      bundle.counts.teams +
      bundle.counts.players +
      bundle.counts.customRules;
    const totalServer =
      (serverCounts.matches || 0) +
      (serverCounts.teams || 0) +
      (serverCounts.players || 0) +
      (serverCounts.customRules || 0);

    if (totalLocal === 0 && totalServer === 0) return null;

    return {
      guestProfile: gp,
      counts: {
        matches: Math.max(bundle.counts.matches, serverCounts.matches || 0),
        teams: Math.max(bundle.counts.teams, serverCounts.teams || 0),
        players: Math.max(bundle.counts.players, serverCounts.players || 0),
        customRules: Math.max(bundle.counts.customRules, serverCounts.customRules || 0)
      },
      localData: bundle.localData
    };
  }

  /**
   * Displays the Step 5–11 Guest-to-Account Migration Confirmation modal.
   */
  async function showMigrationModal({ onDone } = {}) {
    if (!root.ApnaAPI.getToken()) return false;
    const eligible = await detectEligibleGuestData();
    if (!eligible) {
      if (onDone) onDone({ skipped: true });
      return false;
    }

    const backdrop = ensureModalRoot();
    const dialog = document.getElementById('apnaGuestModalDialog');
    const c = eligible.counts;

    dialog.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title">Move Guest Data to Your Account</h3>
        <button type="button" class="icon-btn" id="migCloseBtn">✕</button>
      </div>
      <p style="margin-top:0;font-weight:700;color:var(--brand-primary);">Your ApnaScore guest data is ready to move to your account.</p>
      <div class="card" style="background:var(--bg-surface-alt);margin-bottom:14px;">
        <div class="flex-between" style="padding:6px 0;border-bottom:1px solid var(--border-color);"><span>Matches</span><strong>${c.matches}</strong></div>
        <div class="flex-between" style="padding:6px 0;border-bottom:1px solid var(--border-color);"><span>Teams</span><strong>${c.teams}</strong></div>
        <div class="flex-between" style="padding:6px 0;border-bottom:1px solid var(--border-color);"><span>Players</span><strong>${c.players}</strong></div>
        <div class="flex-between" style="padding:6px 0;"><span>Custom Rule Presets</span><strong>${c.customRules}</strong></div>
      </div>
      <div id="migStatusBox" class="text-sm hidden" style="margin-bottom:12px;"></div>
      <div class="modal-footer" id="migFooterBtns">
        <button type="button" class="btn btn-secondary" id="migSkipBtn">Skip for Now</button>
        <button type="button" class="btn btn-primary" id="migConfirmBtn">Migrate My Data</button>
      </div>
    `;

    const finish = (res) => {
      closeModal();
      if (onDone) onDone(res);
    };

    document.getElementById('migCloseBtn').onclick = () => finish({ skipped: true });
    document.getElementById('migSkipBtn').onclick = () => finish({ skipped: true });
    document.getElementById('migConfirmBtn').onclick = () => executeMigration(eligible, dialog, onDone);

    backdrop.classList.add('open');
    return true;
  }

  async function executeMigration(eligible, dialog, onDone) {
    const statusBox = document.getElementById('migStatusBox');
    const btn = document.getElementById('migConfirmBtn');
    const skipBtn = document.getElementById('migSkipBtn');
    statusBox.classList.remove('hidden');
    btn.disabled = true;
    skipBtn.disabled = true;
    btn.textContent = 'Migrating...';

    if (!currentMigrationId) {
      currentMigrationId = 'mig_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }

    // Requirement 21: If offline when migrating after offline registration, queue migration safely
    if (!navigator.onLine) {
      await root.ApnaOffline.saveGuestProfile({
        ...eligible.guestProfile,
        pendingMigration: true,
        pendingMigrationId: currentMigrationId
      });
      statusBox.style.color = 'var(--warning)';
      statusBox.textContent = 'You are currently offline. Your guest data is preserved locally and migration is queued to complete automatically once internet returns.';
      btn.textContent = 'Queued for Sync';
      skipBtn.disabled = false;
      skipBtn.textContent = 'Go to Dashboard';
      skipBtn.onclick = () => { closeModal(); if (onDone) onDone({ queued: true }); };
      return;
    }

    try {
      const res = await root.ApnaAPI.post('/api/guest/migrate', {
        guestId: eligible.guestProfile.guestId,
        guestToken: eligible.guestProfile.guestToken,
        deviceId: eligible.guestProfile.deviceId || root.ApnaOffline.getDeviceId(),
        migrationId: currentMigrationId,
        localData: eligible.localData
      });

      if (!res || !res.verified) {
        throw new Error('Server did not verify migration completion.');
      }

      await root.ApnaOffline.markGuestMigrated(res);
      currentMigrationId = null;

      const cnt = res.importedCounts || {};
      dialog.innerHTML = `
        <div class="modal-header">
          <h3 class="modal-title">Migration Complete</h3>
        </div>
        <p style="font-weight:700;color:var(--brand-primary);">Your guest data has been successfully transferred to your ApnaScore account.</p>
        <div class="card" style="background:var(--success-bg);margin-bottom:14px;">
          <div>Matches Imported: <strong>${cnt.matches ?? 0}</strong></div>
          <div>Teams Imported: <strong>${cnt.teams ?? 0}</strong></div>
          <div>Players Imported: <strong>${cnt.players ?? 0}</strong></div>
          <div>Deliveries Preserved: <strong>${cnt.deliveries ?? 0}</strong></div>
          <div>Custom Rules Imported: <strong>${cnt.customRules ?? 0}</strong></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-primary btn-lg" id="migGoDashBtn">Go to Dashboard</button>
        </div>
      `;
      document.getElementById('migGoDashBtn').onclick = () => {
        closeModal();
        if (onDone) onDone({ migrated: true });
        else window.location.href = '/dashboard.html';
      };
    } catch (err) {
      // Failure safety: keep ALL guest IndexedDB data untouched and offer retry
      statusBox.style.color = 'var(--danger)';
      statusBox.textContent = `${err.message} Your local guest data is safe. You can retry without creating duplicates.`;
      btn.disabled = false;
      skipBtn.disabled = false;
      btn.textContent = 'Retry Migration';
    }
  }

  async function runQueuedOfflineMigration() {
    const gp = await root.ApnaOffline.getGuestProfile();
    if (!gp || !gp.pendingMigration || gp.migrationStatus === 'completed' || !root.ApnaAPI.getToken()) return;
    const eligible = await detectEligibleGuestData();
    if (!eligible) return;
    try {
      const res = await root.ApnaAPI.post('/api/guest/migrate', {
        guestId: gp.guestId,
        guestToken: gp.guestToken,
        deviceId: gp.deviceId || root.ApnaOffline.getDeviceId(),
        migrationId: gp.pendingMigrationId || ('mig_q_' + Date.now()),
        localData: eligible.localData
      });
      if (res && res.verified) {
        await root.ApnaOffline.markGuestMigrated(res);
        root.ApnaUI?.showToast('Queued guest data migrated to your account!');
      }
    } catch (_) {}
  }

  root.ApnaMigrate = {
    showRestrictionPrompt,
    detectEligibleGuestData,
    showMigrationModal,
    runQueuedOfflineMigration,
    closeModal
  };
}(window));
