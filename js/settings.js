/**
 * ApnaScore Settings & Profile Controller
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', async () => {
    const isProfile = document.body.dataset.page === 'profile';
    ApnaUI.initShell({
      activePage: isProfile ? 'profile' : 'settings',
      pageTitle: isProfile ? 'Profile' : 'Settings'
    });

    if (isProfile) {
      await initProfilePage();
    } else {
      await initSettingsPage();
    }
  });

  async function initProfilePage() {
    if (!ApnaAuth.isLoggedIn()) {
      // Guest Mode or Unauthenticated -> show Guest Profile or Continue as Guest entry
      if (!ApnaAuth.isGuest()) {
        await ApnaAuth.continueAsGuest(null);
      }
      document.getElementById('profileSummaryCard').classList.add('hidden');
      document.getElementById('profileUpdateForm').closest('.card').classList.add('hidden');
      const gCard = document.getElementById('guestProfileCard');
      gCard.classList.remove('hidden');

      const gp = (await ApnaOffline.getGuestProfile()) || ApnaAuth.getGuestSession() || {};
      const bundle = await ApnaOffline.getGuestMigrationBundle();
      document.getElementById('guestSessionMeta').textContent = `Guest ID: ${gp.guestId || 'Local'} • Device: ${gp.deviceId || ApnaOffline.getDeviceId()}`;
      document.getElementById('guestDataSummaryGrid').innerHTML = `
        <div class="card" style="padding:10px;"><span class="text-sm text-muted">Matches</span><div style="font-size:1.3rem;font-weight:800;">${bundle.counts.matches}</div></div>
        <div class="card" style="padding:10px;"><span class="text-sm text-muted">Teams</span><div style="font-size:1.3rem;font-weight:800;">${bundle.counts.teams}</div></div>
        <div class="card" style="padding:10px;"><span class="text-sm text-muted">Players</span><div style="font-size:1.3rem;font-weight:800;">${bundle.counts.players}</div></div>
        <div class="card" style="padding:10px;"><span class="text-sm text-muted">Custom Rules</span><div style="font-size:1.3rem;font-weight:800;">${bundle.counts.customRules}</div></div>
      `;
      document.getElementById('guestResetBtn').onclick = () => ApnaAuth.exitGuestMode();
      return;
    }

    const user = await ApnaAuth.refreshUser();
    if (!user) return;

    // Check if registered user still has un-migrated guest data on device
    if (window.ApnaMigrate) {
      const eligible = await ApnaMigrate.detectEligibleGuestData();
      if (eligible) {
        const mb = document.getElementById('migrateBannerCard');
        mb.classList.remove('hidden');
        document.getElementById('migrateBannerMeta').textContent = `${eligible.counts.matches} match(es), ${eligible.counts.teams} team(s), ${eligible.counts.players} player(s) ready to migrate.`;
        document.getElementById('openMigrateModalBtn').onclick = () => ApnaMigrate.showMigrationModal({ onDone: () => window.location.reload() });
      }
    }

    document.getElementById('profNameHeading').textContent = user.name;
    document.getElementById('profRoleSub').textContent = `${ApnaAuth.roleLabel(user.role)} • ${user.email}`;
    if (user.avatarUrl) document.getElementById('profAvatarImg').src = user.avatarUrl;
    document.getElementById('profNameInp').value = user.name || '';
    document.getElementById('profVillageInp').value = user.village || '';
    document.getElementById('profPhoneInp').value = user.phone || '';

    document.getElementById('profLogoutBtn').onclick = () => ApnaAuth.logout();

    document.getElementById('profileUpdateForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const res = await ApnaAPI.put('/api/auth/profile', {
          name: document.getElementById('profNameInp').value.trim(),
          village: document.getElementById('profVillageInp').value.trim(),
          phone: document.getElementById('profPhoneInp').value.trim()
        });
        ApnaAPI.setSession(ApnaAPI.getToken(), res.user);
        document.getElementById('profNameHeading').textContent = res.user.name;
        ApnaUI.showToast('Profile updated!');
      } catch (err) {
        ApnaUI.showToast(err.message, 'error');
      }
    };

    document.getElementById('profAvatarInp').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('avatar', file);
      try {
        const res = await ApnaAPI.upload('/api/auth/avatar', fd);
        document.getElementById('profAvatarImg').src = res.avatarUrl;
        ApnaAPI.setSession(ApnaAPI.getToken(), res.user);
        ApnaUI.showToast('Avatar updated!');
      } catch (err) {
        ApnaUI.showToast(err.message, 'error');
      }
    };
  }

  async function initSettingsPage() {
    const themeSel = document.getElementById('setTheme');
    themeSel.value = localStorage.getItem('apnascore_theme') || 'light';
    themeSel.onchange = () => ApnaUI.applyTheme(themeSel.value);

    document.getElementById('setOutdoor').checked = localStorage.getItem('apnascore_outdoor_mode') === '1';

    await loadSettingsData();

    document.getElementById('saveAllSettingsBtn').onclick = async () => {
      localStorage.setItem('apnascore_outdoor_mode', document.getElementById('setOutdoor').checked ? '1' : '0');
      ApnaUI.applyTheme(themeSel.value);
      if (!ApnaAuth.isLoggedIn()) {
        ApnaUI.showToast('Theme & outdoor display settings saved locally.');
        return;
      }
      const rules = ApnaScoringEngine.getDefaultRules();
      rules.format.oversPerInnings = Number(document.getElementById('defOvers').value || 6);
      rules.format.playersPerTeam = Number(document.getElementById('defPlayers').value || 11);
      rules.format.ballType = document.getElementById('defBall').value;
      rules.extras.wide.enabled = document.getElementById('defWide').checked;
      rules.extras.noBall.freeHitOnNextBall = document.getElementById('defNoBall').checked;
      rules.extras.bye.enabled = document.getElementById('defByes').checked;
      rules.extras.legBye.enabled = document.getElementById('defByes').checked;
      rules.localRules.lastManBatting = document.getElementById('defLastMan').checked;

      try {
        await ApnaAPI.put('/api/settings/preferences', {
          theme: themeSel.value,
          language: document.getElementById('setLang').value,
          outdoorMode: document.getElementById('setOutdoor').checked,
          notifications: { matchUpdates: document.getElementById('setNotifMatch').checked },
          privacy: { showProfilePublicly: document.getElementById('setPrivacyPub').checked },
          defaultScoring: {
            overs: rules.format.oversPerInnings,
            playersPerTeam: rules.format.playersPerTeam,
            ballType: rules.format.ballType,
            rules
          }
        });
        ApnaUI.showToast('Preferences saved! New matches will use these defaults.');
      } catch (err) {
        ApnaUI.showToast(err.message, 'error');
      }
    };

    document.getElementById('createPresetBtn').onclick = async () => {
      if (!ApnaAuth.isAuthenticatedOrGuest()) await ApnaAuth.continueAsGuest(null);
      const name = prompt('Enter custom preset name (e.g. My 6 Over Rules):');
      if (!name || !name.trim()) return;
      const rules = ApnaScoringEngine.getDefaultRules();
      rules.format.oversPerInnings = Number(document.getElementById('defOvers').value || 6);
      rules.format.playersPerTeam = Number(document.getElementById('defPlayers').value || 11);
      rules.format.ballType = document.getElementById('defBall').value;
      rules.localRules.lastManBatting = document.getElementById('defLastMan').checked;
      const clientId = 'lrule_' + Date.now();
      await ApnaOffline.saveRuleLocally({ localId: clientId, clientId, name: name.trim(), rules });
      try {
        await ApnaAPI.post('/api/settings/presets', { name: name.trim(), rules, clientId });
      } catch (_) {}
      ApnaUI.showToast(`Preset "${name}" saved.`);
      await loadSettingsData();
    };

    document.getElementById('changePasswordForm').onsubmit = async (e) => {
      e.preventDefault();
      if (!ApnaAuth.requireAuth()) return;
      try {
        await ApnaAPI.put('/api/auth/password', {
          currentPassword: document.getElementById('curPwd').value,
          newPassword: document.getElementById('newPwd').value
        });
        document.getElementById('changePasswordForm').reset();
        ApnaUI.showToast('Password updated successfully.');
      } catch (err) {
        ApnaUI.showToast(err.message, 'error');
      }
    };
  }

  async function loadSettingsData() {
    try {
      const res = await ApnaAPI.get('/api/settings');
      if (res.preferences) {
        const p = res.preferences;
        if (p.theme) {
          document.getElementById('setTheme').value = p.theme;
          ApnaUI.applyTheme(p.theme);
        }
        if (p.language) document.getElementById('setLang').value = p.language;
        document.getElementById('setOutdoor').checked = Boolean(p.outdoorMode);
        if (p.defaultScoring) {
          document.getElementById('defOvers').value = p.defaultScoring.overs || 6;
          document.getElementById('defPlayers').value = p.defaultScoring.playersPerTeam || 11;
          document.getElementById('defBall').value = p.defaultScoring.ballType || 'tennis';
        }
      }

      const presetsEl = document.getElementById('savedPresetsList');
      const presets = res.presets || [];
      presetsEl.innerHTML = presets.map((pr) => `
        <div class="flex-between" style="padding:10px 0;border-bottom:1px solid var(--border-color);">
          <div>
            <strong>${ApnaUI.escapeHtml(pr.name)}</strong>
            <span class="badge ${pr.isSystemPreset ? 'badge-neutral' : 'badge-success'}">${pr.isSystemPreset ? 'Built-in' : 'Custom'}</span>
            <div class="text-sm text-muted">${pr.rules?.format?.oversPerInnings || 6} Overs • ${pr.rules?.format?.ballType || 'tennis'}</div>
          </div>
          ${!pr.isSystemPreset && pr._id ? `<button type="button" class="btn btn-danger btn-sm" onclick="deletePreset('${pr._id}')">Delete</button>` : ''}
        </div>
      `).join('');
    } catch (_) {}
  }

  window.deletePreset = async (id) => {
    try {
      await ApnaAPI.del(`/api/settings/presets/${id}`);
      ApnaUI.showToast('Preset deleted.');
      await loadSettingsData();
    } catch (err) {
      ApnaUI.showToast(err.message, 'error');
    }
  };
}());
