/**
 * ApnaScore PDF Export & Share Helper
 * Primary: Genuine multi-page PDFKit document from /api/scorecards/:matchId/pdf
 * Offline Fallback: Genuine PDF via vendored jsPDF + autoTable
 */
(function (root) {
  'use strict';

  async function downloadMatchPDF(matchId, matchBundle) {
    try {
      if (navigator.onLine && !String(matchId).startsWith('cm_')) {
        const headers = {};
        const token = root.ApnaAPI ? root.ApnaAPI.getToken() : '';
        const guest = root.ApnaAPI ? root.ApnaAPI.getGuestSession() : null;
        if (token) headers.Authorization = `Bearer ${token}`;
        else if (guest && guest.guestId && guest.guestToken) {
          headers['X-Guest-Id'] = guest.guestId;
          headers['X-Guest-Token'] = guest.guestToken;
        }
        const res = await fetch(`/api/scorecards/${encodeURIComponent(matchId)}/pdf`, { headers });
        if (res.ok) {
          const blob = await res.blob();
          triggerDownload(blob, `ApnaScore_Scorecard_${matchId}.pdf`);
          return blob;
        }
      }
    } catch (_) {
      // Fallback to offline jsPDF generator below
    }

    if (matchBundle && root.jspdf && root.jspdf.jsPDF) {
      return generateOfflineJsPDF(matchBundle);
    }
    throw new Error('PDF generation failed.');
  }

  function generateOfflineJsPDF({ match, innings }) {
    const { jsPDF } = root.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    doc.setFillColor(32, 139, 78);
    doc.rect(0, 0, doc.internal.pageSize.getWidth(), 56, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.text('ApnaScore – Match Scorecard', 36, 26);
    doc.setFontSize(10);
    doc.text(`${match.title || ''} • ${match.venue || 'Local Ground'}`, 36, 44);

    let y = 76;
    doc.setTextColor(15, 56, 34);
    doc.setFontSize(11);
    doc.text((match.result && match.result.marginText) || (match.status ? match.status.toUpperCase() : 'Match Scorecard'), 36, y);
    y += 20;

    for (const inn of innings || []) {
      const st = inn.computedState || inn || {};
      const batStats = st.battingStats || {};
      const bowlStats = st.bowlingStats || {};
      const batOrder = Array.isArray(st.battingOrder) && st.battingOrder.length ? st.battingOrder : Object.keys(batStats);
      const bowlOrder = Array.isArray(st.bowlingOrder) && st.bowlingOrder.length ? st.bowlingOrder : Object.keys(bowlStats);

      doc.setFontSize(12);
      doc.text(`${inn.battingTeamName || 'Team'}: ${inn.totalRuns || 0}/${inn.wickets || 0} (${inn.oversString || '0.0'} ov)`, 36, y);
      y += 14;

      const batRows = batOrder.map((pid) => {
        const b = batStats[pid] || {};
        return [b.name || 'Batsman', b.dismissalText || 'not out', String(b.runs || 0), String(b.balls || 0), String(b.fours || 0), String(b.sixes || 0), (b.strikeRate || 0).toFixed(1)];
      });

      if (doc.autoTable && batRows.length) {
        doc.autoTable({
          startY: y,
          head: [['Batsman', 'Dismissal', 'R', 'B', '4s', '6s', 'SR']],
          body: batRows,
          headStyles: { fillColor: [32, 139, 78] }
        });
        y = doc.lastAutoTable.finalY + 14;
      }

      const bowlRows = bowlOrder.map((pid) => {
        const bw = bowlStats[pid] || {};
        return [bw.name || 'Bowler', String(bw.overs || '0.0'), String(bw.maidens || 0), String(bw.runs || 0), String(bw.wickets || 0), (bw.economy || 0).toFixed(2)];
      });

      if (doc.autoTable && bowlRows.length) {
        doc.autoTable({
          startY: y,
          head: [['Bowler', 'O', 'M', 'R', 'W', 'Econ']],
          body: bowlRows,
          headStyles: { fillColor: [15, 56, 34] }
        });
        y = doc.lastAutoTable.finalY + 22;
      }
    }

    const blob = doc.output('blob');
    triggerDownload(blob, `ApnaScore_${(match.title || 'Scorecard').replace(/[^a-z0-9]+/gi, '_')}.pdf`);
    return blob;
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function shareMatchPDF(matchId, matchBundle) {
    const blob = await downloadMatchPDF(matchId, matchBundle);
    const file = new File([blob], `ApnaScore_${matchId}.pdf`, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: (matchBundle?.match?.title) || 'ApnaScore Scorecard',
        text: 'Official Match Scorecard from ApnaScore',
        files: [file]
      });
    } else {
      ApnaUI.showToast('PDF downloaded! You can attach and share it anywhere.');
    }
  }

  root.ApnaPDF = {
    downloadMatchPDF,
    shareMatchPDF
  };
}(window));
