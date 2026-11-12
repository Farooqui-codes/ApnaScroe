/**
 * ApnaScore Tournament Manager Pro — Upgrade Modal, Razorpay Checkout & WhatsApp Share Cards
 */
(function (root) {
  'use strict';

  let cachedPlans = null;

  async function loadPlans() {
    if (cachedPlans) return cachedPlans;
    const res = await root.ApnaAPI.get('/api/payments/plans');
    cachedPlans = res;
    return res;
  }

  function loadRazorpayScript() {
    if (root.Razorpay) return Promise.resolve(true);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = () => resolve(true);
      s.onerror = () => reject(new Error('Could not load Razorpay checkout. Please check your internet connection.'));
      document.head.appendChild(s);
    });
  }

  function ensureModal() {
    let el = document.getElementById('apnaProModalBackdrop');
    if (!el) {
      el = document.createElement('div');
      el.id = 'apnaProModalBackdrop';
      el.className = 'modal-backdrop';
      el.innerHTML = `<div class="modal-dialog" id="apnaProModalDialog" style="max-width:600px;"></div>`;
      document.body.appendChild(el);
    }
    return el;
  }

  function closeProModal() {
    document.getElementById('apnaProModalBackdrop')?.classList.remove('open');
  }

  async function showUpgradeModal({ tournamentId = null, tournamentName = '', feature = 'Tournament Manager Pro', onSuccess = null } = {}) {
    if (!root.ApnaAuth || !root.ApnaAuth.isLoggedIn()) {
      if (root.ApnaMigrate) {
        root.ApnaMigrate.showRestrictionPrompt('Create a free organizer account first to upgrade to Tournament Manager Pro.');
      } else {
        window.location.href = '/login.html';
      }
      return;
    }

    const backdrop = ensureModal();
    const dialog = document.getElementById('apnaProModalDialog');
    dialog.innerHTML = `<div class="modal-header"><h3 class="modal-title">Upgrade to Tournament Manager Pro</h3><button type="button" class="icon-btn" id="proCloseBtn">✕</button></div><div class="empty-state">Loading plans...</div>`;
    document.getElementById('proCloseBtn').onclick = closeProModal;
    backdrop.classList.add('open');

    let planData;
    try {
      planData = await loadPlans();
    } catch (err) {
      dialog.innerHTML = `<div class="modal-header"><h3 class="modal-title">Upgrade to Pro</h3><button type="button" class="icon-btn" id="proCloseBtn2">✕</button></div><p class="text-sm">${root.ApnaUI.escapeHtml(err.message)}</p>`;
      document.getElementById('proCloseBtn2').onclick = closeProModal;
      return;
    }

    const pTour = planData.plans.per_tournament;
    const pMonth = planData.plans.monthly;
    const mode = planData.activeMode || 'both';
    const defaultPlan = (!tournamentId || mode === 'monthly') ? 'monthly' : 'per_tournament';

    dialog.innerHTML = `
      <div class="modal-header">
        <div>
          <h3 class="modal-title">Upgrade to Tournament Manager Pro</h3>
          <div class="text-sm text-muted">Unlock: ${root.ApnaUI.escapeHtml(feature)}${tournamentName ? ` • ${root.ApnaUI.escapeHtml(tournamentName)}` : ''}</div>
        </div>
        <button type="button" class="icon-btn" id="proCloseBtn">✕</button>
      </div>

      <div class="table-wrap mb-2">
        <table class="data-table">
          <thead><tr><th>Feature</th><th>Free</th><th>Pro</th></tr></thead>
          <tbody>
            <tr><td>Tournaments & Teams</td><td>1 / up to 4 teams</td><td><strong>Unlimited / up to 64</strong></td></tr>
            <tr><td>Public Team Registration Link</td><td>No</td><td><strong>Yes (Approve/Reject)</strong></td></tr>
            <tr><td>Schedule & Entry Fee Tracker</td><td>No</td><td><strong>Yes (INR Summary)</strong></td></tr>
            <tr><td>Group + Knockout & Pro PDF</td><td>Basic</td><td><strong>Full Pro Pack</strong></td></tr>
            <tr><td>Sponsor Banner & Share Cards</td><td>No</td><td><strong>WhatsApp PNG Cards</strong></td></tr>
          </tbody>
        </table>
      </div>

      <div class="form-group">
        <label class="form-label">Select Plan</label>
        <div class="form-grid-2">
          ${mode !== 'monthly' && tournamentId ? `
            <label class="card" style="cursor:pointer;padding:12px;border:2px solid var(--brand-primary);">
              <input type="radio" name="proPlanChoice" value="per_tournament" ${defaultPlan === 'per_tournament' ? 'checked' : ''} />
              <strong> ₹${pTour.amountInr}</strong> — Per Tournament
              <div class="text-sm text-muted">${root.ApnaUI.escapeHtml(pTour.description)}</div>
            </label>` : ''}
          ${mode !== 'per_tournament' ? `
            <label class="card" style="cursor:pointer;padding:12px;border:2px solid var(--border-color);">
              <input type="radio" name="proPlanChoice" value="monthly" ${defaultPlan === 'monthly' ? 'checked' : ''} />
              <strong> ₹${pMonth.amountInr}/mo</strong> — Monthly Pro
              <div class="text-sm text-muted">${root.ApnaUI.escapeHtml(pMonth.description)}</div>
            </label>` : ''}
        </div>
      </div>

      <div id="proPayStatus" class="text-sm hidden mb-2"></div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="proCancelBtn">Cancel</button>
        <button type="button" class="btn btn-primary btn-lg" id="proPayNowBtn">Pay Securely with Razorpay</button>
      </div>
      <div class="text-sm text-muted" style="text-align:center;margin-top:8px;">
        UPI, Cards & Netbanking • <a href="/policies.html" target="_blank">Privacy, Terms & Refund Policy</a>
      </div>
    `;

    document.getElementById('proCloseBtn').onclick = closeProModal;
    document.getElementById('proCancelBtn').onclick = closeProModal;

    document.getElementById('proPayNowBtn').onclick = async () => {
      const statusEl = document.getElementById('proPayStatus');
      const btn = document.getElementById('proPayNowBtn');
      if (!navigator.onLine) {
        statusEl.classList.remove('hidden');
        statusEl.style.color = 'var(--warning)';
        statusEl.textContent = 'Online internet connection is required for payments.';
        return;
      }

      const chosen = document.querySelector('input[name="proPlanChoice"]:checked')?.value || defaultPlan;
      btn.disabled = true;
      btn.textContent = 'Starting Razorpay...';
      statusEl.classList.add('hidden');

      try {
        await loadRazorpayScript();
        const order = await root.ApnaAPI.post('/api/payments/create-order', {
          planId: chosen,
          tournamentId
        });

        const user = root.ApnaAuth.getUser() || {};
        const rzp = new root.Razorpay({
          key: order.keyId,
          amount: order.amountPaise,
          currency: order.currency,
          name: 'ApnaScore',
          description: `${order.planName} (${order.receiptNumber})`,
          order_id: order.orderId,
          prefill: { name: user.name || '', email: user.email || '', contact: user.phone || '' },
          theme: { color: '#208B4E' },
          handler: async (resp) => {
            try {
              const ver = await root.ApnaAPI.post('/api/payments/verify', resp);
              dialog.innerHTML = `
                <div class="modal-header"><h3 class="modal-title">Pro Unlocked Successfully!</h3><button type="button" class="icon-btn" id="proDoneClose">✕</button></div>
                <div class="card" style="background:var(--success-bg);margin-bottom:14px;">
                  <strong>Payment Verified</strong>
                  <div class="text-sm mt-1">Receipt #: ${root.ApnaUI.escapeHtml(ver.payment.receiptNumber)}</div>
                  <div class="text-sm">Amount: INR ${ver.payment.amountInr}</div>
                </div>
                <div class="modal-footer">
                  <button type="button" class="btn btn-secondary" id="proInvBtn">Download Receipt PDF</button>
                  <button type="button" class="btn btn-primary" id="proContinueBtn">Continue</button>
                </div>
              `;
              document.getElementById('proInvBtn').onclick = () => downloadInvoicePdf(ver.payment._id, ver.payment.receiptNumber);
              const finish = () => { closeProModal(); if (onSuccess) onSuccess(ver); else window.location.reload(); };
              document.getElementById('proDoneClose').onclick = finish;
              document.getElementById('proContinueBtn').onclick = finish;
            } catch (verErr) {
              statusEl.classList.remove('hidden');
              statusEl.style.color = 'var(--danger)';
              statusEl.textContent = verErr.message;
              btn.disabled = false;
              btn.textContent = 'Retry Payment';
            }
          },
          modal: {
            ondismiss: () => {
              btn.disabled = false;
              btn.textContent = 'Pay Securely with Razorpay';
            }
          }
        });

        rzp.on('payment.failed', async (failResp) => {
          const reason = failResp.error?.description || 'Payment failed';
          await root.ApnaAPI.post('/api/payments/mark-failed', { razorpay_order_id: order.orderId, reason }).catch(() => {});
          statusEl.classList.remove('hidden');
          statusEl.style.color = 'var(--danger)';
          statusEl.textContent = `Payment failed: ${reason}. You can retry safely.`;
          btn.disabled = false;
          btn.textContent = 'Retry Payment';
        });

        rzp.open();
      } catch (err) {
        statusEl.classList.remove('hidden');
        statusEl.style.color = 'var(--danger)';
        statusEl.textContent = err.message;
        btn.disabled = false;
        btn.textContent = 'Pay Securely with Razorpay';
      }
    };
  }

  async function downloadInvoicePdf(paymentId, receiptNum) {
    const token = root.ApnaAPI.getToken();
    const res = await fetch(`/api/payments/${encodeURIComponent(paymentId)}/invoice`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!res.ok) return root.ApnaUI.showToast('Could not download receipt.', 'error');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ApnaScore_Receipt_${receiptNum || paymentId}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function generateShareCardImage({ title, subtitle, rows = [], footerText = 'Scored on ApnaScore' }) {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 560;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#E2F1E6';
    ctx.fillRect(0, 0, 800, 560);
    ctx.fillStyle = '#208B4E';
    ctx.fillRect(0, 0, 800, 110);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(String(title || 'ApnaScore Tournament').slice(0, 44), 32, 52);
    ctx.fillStyle = '#9ADE68';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(String(subtitle || '').slice(0, 62), 32, 86);

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(28, 130, 744, 360);
    ctx.strokeStyle = '#C3DDC8';
    ctx.lineWidth = 2;
    ctx.strokeRect(28, 130, 744, 360);

    let y = 172;
    ctx.fillStyle = '#0F3822';
    ctx.font = 'bold 18px sans-serif';
    rows.slice(0, 9).forEach((line) => {
      ctx.fillText(String(line).slice(0, 70), 48, y);
      y += 36;
    });

    ctx.fillStyle = '#135831';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(footerText, 32, 528);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;
    const file = new File([blob], 'apnascore-share-card.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ title, text: `${title} — ${subtitle}`, files: [file] }).catch(() => {});
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'apnascore-share-card.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      root.ApnaUI?.showToast('Share card image downloaded! Share it on WhatsApp.');
    }
  }

  root.ApnaPro = {
    loadPlans,
    showUpgradeModal,
    closeProModal,
    downloadInvoicePdf,
    generateShareCardImage
  };
}(window));
