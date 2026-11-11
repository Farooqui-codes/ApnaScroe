const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const engine = require('./scoringEngine');

const BRAND = {
  primary: '#208B4E',
  lime: '#9ADE68',
  softMint: '#E2F1E6',
  lightSage: '#C3DDC8',
  sage: '#81AA97',
  darkText: '#0F3822',
  mutedText: '#436853',
  white: '#FFFFFF',
  border: '#C3DDC8',
  rowAlt: '#F3FAF5'
};

const LOGO_PATH = path.resolve(__dirname, '../../assets/logos/apnascore-logo.png');

function truncateText(text, maxLen = 28) {
  const s = String(text || '');
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}

function addPageHeader(doc, title, subtitle) {
  const pageWidth = doc.page.width;
  doc.save();
  doc.rect(0, 0, pageWidth, 68).fill(BRAND.primary);
  doc.rect(0, 68, pageWidth, 4).fill(BRAND.lime);

  if (fs.existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, 36, 10, { width: 48, height: 48 });
    } catch (_) {
      // Fallback if image decode fails
    }
  }

  doc.fillColor(BRAND.white).font('Helvetica-Bold').fontSize(17).text('ApnaScore', 94, 15, { continued: true });
  doc.font('Helvetica').fontSize(10).fillColor('#D7F7E3').text('   Apne Gaon ka Apna Scorer', { baseline: 'alphabetic' });
  doc.fillColor(BRAND.white).font('Helvetica-Bold').fontSize(12).text(truncateText(title, 62), 94, 38);
  if (subtitle) {
    doc.fillColor('#D7F7E3').font('Helvetica').fontSize(9).text(truncateText(subtitle, 80), 94, 53);
  }
  doc.restore();
  doc.y = 86;
}

function addPageFooters(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - 34;
    doc.save();
    doc.moveTo(36, y - 6).lineTo(doc.page.width - 36, y - 6).strokeColor(BRAND.border).lineWidth(0.7).stroke();
    doc.fillColor(BRAND.mutedText).font('Helvetica').fontSize(8.5);
    doc.text('ApnaScore – Har Gaon Ka Apna Cricket Scoreboard', 36, y, { align: 'left' });
    doc.text(`Page ${i + 1} of ${range.count}`, 36, y, { width: doc.page.width - 72, align: 'right' });
    doc.restore();
  }
}

function ensureSpace(doc, neededHeight, onNewPageHeader) {
  if (doc.y + neededHeight > doc.page.height - 54) {
    doc.addPage();
    if (onNewPageHeader) onNewPageHeader();
    return true;
  }
  return false;
}

function drawTableHeader(doc, columns, startX, rowHeight = 20) {
  const totalWidth = columns.reduce((s, c) => s + c.width, 0);
  const y = doc.y;
  doc.save();
  doc.rect(startX, y, totalWidth, rowHeight).fill(BRAND.primary);
  doc.fillColor(BRAND.white).font('Helvetica-Bold').fontSize(8.5);
  let x = startX;
  for (const col of columns) {
    doc.text(col.label, x + 4, y + 6, { width: col.width - 8, align: col.align || 'left', lineBreak: false });
    x += col.width;
  }
  doc.restore();
  doc.y = y + rowHeight;
}

function drawTableRow(doc, columns, rowData, startX, rowIndex, rowHeight = 19, onNewPage) {
  if (doc.y + rowHeight > doc.page.height - 54) {
    doc.addPage();
    if (onNewPage) onNewPage();
    drawTableHeader(doc, columns, startX, 20);
  }
  const totalWidth = columns.reduce((s, c) => s + c.width, 0);
  const y = doc.y;
  doc.save();
  doc.rect(startX, y, totalWidth, rowHeight).fill(rowIndex % 2 === 0 ? BRAND.white : BRAND.rowAlt);
  doc.moveTo(startX, y + rowHeight).lineTo(startX + totalWidth, y + rowHeight).strokeColor('#DCECE0').lineWidth(0.5).stroke();

  let x = startX;
  for (const col of columns) {
    const val = rowData[col.key] !== undefined && rowData[col.key] !== null ? String(rowData[col.key]) : '';
    doc.fillColor(col.bold ? BRAND.darkText : '#244A35')
      .font(col.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(8.5)
      .text(truncateText(val, col.maxChars || 30), x + 4, y + 5, {
        width: col.width - 8,
        align: col.align || 'left',
        lineBreak: false
      });
    x += col.width;
  }
  doc.restore();
  doc.y = y + rowHeight;
}

/**
 * Streams a complete, multi-page match scorecard PDF directly into a Buffer.
 */
function generateMatchScorecardPDF({ match, inningsList, tournament }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageHeaderTitle = match.title || `${match.teamA.name} vs ${match.teamB.name}`;
      const subParts = [];
      if (tournament && tournament.name) subParts.push(tournament.name);
      if (match.venue) subParts.push(match.venue);
      if (match.matchDate) subParts.push(new Date(match.matchDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }));
      const pageSubtitle = subParts.join('  •  ');

      const reprintHeader = () => addPageHeader(doc, pageHeaderTitle, pageSubtitle);
      reprintHeader();

      const contentWidth = doc.page.width - 72;
      const startX = 36;

      // Match Summary Box
      const boxTop = doc.y;
      doc.save();
      doc.roundedRect(startX, boxTop, contentWidth, 64, 6).fillAndStroke(BRAND.softMint, BRAND.lightSage);
      doc.fillColor(BRAND.darkText).font('Helvetica-Bold').fontSize(12)
        .text(`${match.teamA.name}  vs  ${match.teamB.name}`, startX + 12, boxTop + 9, { width: contentWidth - 24 });

      const tossText = match.toss && match.toss.winnerTeamName
        ? `Toss: ${match.toss.winnerTeamName} won and elected to ${match.toss.decision || 'bat'}`
        : `Format: ${match.oversPerInnings} Overs (${match.ballType || 'tennis'} ball)`;
      doc.fillColor(BRAND.mutedText).font('Helvetica').fontSize(9)
        .text(tossText, startX + 12, boxTop + 26, { width: contentWidth - 24 });

      const resultText = (match.result && match.result.marginText) || `Status: ${(match.status || 'live').toUpperCase()}`;
      doc.fillColor(BRAND.primary).font('Helvetica-Bold').fontSize(10.5)
        .text(resultText, startX + 12, boxTop + 42, { width: contentWidth - 24 });
      doc.restore();
      doc.y = boxTop + 74;

      // Player of the Match & Officials Strip
      const potm = match.result && match.result.playerOfMatchName ? `Player of the Match: ${match.result.playerOfMatchName}` : '';
      const umpires = [match.officials && match.officials.umpire1, match.officials && match.officials.umpire2].filter(Boolean).join(', ');
      const scorer = match.officials && match.officials.scorerName ? `Scorer: ${match.officials.scorerName}` : '';
      const metaLine = [potm, umpires ? `Umpires: ${umpires}` : '', scorer].filter(Boolean).join('   |   ');
      if (metaLine) {
        doc.fillColor(BRAND.darkText).font('Helvetica-Bold').fontSize(9).text(metaLine, startX, doc.y, { width: contentWidth });
        doc.moveDown(0.7);
      }

      // Render each innings
      for (const inn of inningsList) {
        const st = inn.computedState || {};
        const bpo = (match.rulesSnapshot && match.rulesSnapshot.format && match.rulesSnapshot.format.ballsPerOver) || 6;
        const oversStr = st.oversString || engine.formatOvers(inn.legalBalls, bpo);

        ensureSpace(doc, 90, reprintHeader);

        // Innings Title Banner
        const bannerY = doc.y;
        doc.save();
        doc.roundedRect(startX, bannerY, contentWidth, 26, 4).fill(BRAND.darkText);
        doc.fillColor(BRAND.white).font('Helvetica-Bold').fontSize(11)
          .text(`Innings ${inn.inningsNumber}: ${inn.battingTeamName}`, startX + 10, bannerY + 7);
        const scoreLabel = `${inn.totalRuns}/${inn.wickets} (${oversStr} ov)${inn.target ? `   Target: ${inn.target}` : ''}`;
        doc.fillColor(BRAND.lime).font('Helvetica-Bold').fontSize(11)
          .text(scoreLabel, startX + 10, bannerY + 7, { width: contentWidth - 20, align: 'right' });
        doc.restore();
        doc.y = bannerY + 32;

        // Batting Table
        const batCols = [
          { key: 'name', label: 'Batsman', width: 145, bold: true, maxChars: 24 },
          { key: 'dismissal', label: 'Dismissal', width: 158, maxChars: 28 },
          { key: 'runs', label: 'R', width: 38, align: 'right', bold: true },
          { key: 'balls', label: 'B', width: 38, align: 'right' },
          { key: 'fours', label: '4s', width: 36, align: 'right' },
          { key: 'sixes', label: '6s', width: 36, align: 'right' },
          { key: 'sr', label: 'SR', width: 72, align: 'right' }
        ];
        drawTableHeader(doc, batCols, startX);
        const order = st.battingOrder || [];
        order.forEach((pid, idx) => {
          const b = (st.battingStats && st.battingStats[pid]) || {};
          drawTableRow(doc, batCols, {
            name: b.name || 'Batsman',
            dismissal: b.dismissalText || (b.isOut ? 'out' : 'not out'),
            runs: b.runs || 0,
            balls: b.balls || 0,
            fours: b.fours || 0,
            sixes: b.sixes || 0,
            sr: (b.strikeRate || 0).toFixed(1)
          }, startX, idx, 19, reprintHeader);
        });

        // Extras & Total Strip
        ensureSpace(doc, 38, reprintHeader);
        const ext = inn.extrasBreakdown || st.extrasBreakdown || {};
        const extSummary = `Extras: ${ext.total || 0} (wd ${ext.wides || 0}, nb ${ext.noBalls || 0}, b ${ext.byes || 0}, lb ${ext.legByes || 0}, ot ${ext.overthrows || 0}, pen ${ext.penalties || 0})`;
        doc.fillColor(BRAND.mutedText).font('Helvetica').fontSize(8.5).text(extSummary, startX + 4, doc.y + 5, { width: contentWidth });
        doc.y += 18;

        // Fall of Wickets
        if (st.fallOfWickets && st.fallOfWickets.length > 0) {
          const fowText = 'Fall of Wickets: ' + st.fallOfWickets
            .map((f) => `${f.wicketNumber}-${f.score} (${truncateText(f.playerName, 16)}, ${f.overs} ov)`)
            .join(', ');
          ensureSpace(doc, 28, reprintHeader);
          doc.fillColor(BRAND.darkText).font('Helvetica').fontSize(8.5).text(fowText, startX + 4, doc.y + 2, { width: contentWidth - 8 });
          doc.moveDown(0.5);
        }

        // Partnerships
        const allPartnerships = (st.partnerships || []).slice();
        if (st.currentPartnership && (st.currentPartnership.runs > 0 || st.currentPartnership.balls > 0)) {
          allPartnerships.push(st.currentPartnership);
        }
        if (allPartnerships.length > 0) {
          const pText = 'Partnerships: ' + allPartnerships.map((p, idx) => {
            const n1 = (st.playersMap && st.playersMap[p.batter1Id] && st.playersMap[p.batter1Id].name) || 'Batter 1';
            const n2 = (st.playersMap && st.playersMap[p.batter2Id] && st.playersMap[p.batter2Id].name) || 'Batter 2';
            return `Wkt ${idx + 1}: ${truncateText(n1, 12)} & ${truncateText(n2, 12)} (${p.runs} runs, ${p.balls}b)`;
          }).join('  |  ');
          ensureSpace(doc, 26, reprintHeader);
          doc.fillColor(BRAND.mutedText).font('Helvetica').fontSize(8).text(pText, startX + 4, doc.y, { width: contentWidth - 8 });
          doc.moveDown(0.6);
        }

        // Bowling Table
        ensureSpace(doc, 54, reprintHeader);
        const bowlCols = [
          { key: 'name', label: 'Bowler', width: 223, bold: true, maxChars: 34 },
          { key: 'overs', label: 'O', width: 55, align: 'right' },
          { key: 'maidens', label: 'M', width: 50, align: 'right' },
          { key: 'runs', label: 'R', width: 55, align: 'right' },
          { key: 'wickets', label: 'W', width: 55, align: 'right', bold: true },
          { key: 'econ', label: 'Econ', width: 85, align: 'right' }
        ];
        drawTableHeader(doc, bowlCols, startX);
        const bowlOrder = st.bowlingOrder || [];
        bowlOrder.forEach((pid, idx) => {
          const bw = (st.bowlingStats && st.bowlingStats[pid]) || {};
          drawTableRow(doc, bowlCols, {
            name: bw.name || 'Bowler',
            overs: bw.overs || '0.0',
            maidens: bw.maidens || 0,
            runs: bw.runs || 0,
            wickets: bw.wickets || 0,
            econ: (bw.economy || 0).toFixed(2)
          }, startX, idx, 19, reprintHeader);
        });

        // Ball-by-Ball Over Summary
        const balls = st.recentBalls || [];
        if (balls.length > 0) {
          ensureSpace(doc, 46, reprintHeader);
          doc.moveDown(0.5);
          doc.fillColor(BRAND.darkText).font('Helvetica-Bold').fontSize(9).text('Ball-by-Ball Summary:', startX + 4, doc.y);
          doc.moveDown(0.2);

          const byOver = new Map();
          for (const b of balls) {
            const ovNum = Number(String(b.overLabel || '0.0').split('.')[0]) + 1;
            if (!byOver.has(ovNum)) byOver.set(ovNum, []);
            byOver.get(ovNum).push(b.badge);
          }
          for (const [ovNum, badges] of byOver.entries()) {
            ensureSpace(doc, 16, reprintHeader);
            doc.fillColor(BRAND.mutedText).font('Helvetica').fontSize(8)
              .text(`Over ${ovNum}:  ${badges.join('  •  ')}`, startX + 8, doc.y, { width: contentWidth - 16 });
          }
        }

        doc.moveDown(1.2);
      }

      addPageFooters(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Generates a Tournament Results & Points Table PDF.
 */
function generateTournamentPDF({ tournament, fixtures, pointsTable, awards }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const subtitle = `${tournament.village}  •  Format: ${String(tournament.format).replace('_', ' ').toUpperCase()}  •  ${tournament.oversPerMatch} Overs`;
      const reprintHeader = () => addPageHeader(doc, tournament.name, subtitle);
      reprintHeader();

      const startX = 36;
      const contentWidth = doc.page.width - 72;

      // Summary card
      const topY = doc.y;
      doc.save();
      doc.roundedRect(startX, topY, contentWidth, 54, 6).fillAndStroke(BRAND.softMint, BRAND.lightSage);
      doc.fillColor(BRAND.darkText).font('Helvetica-Bold').fontSize(11)
        .text(`Organizer: ${tournament.organizerName || 'Tournament Committee'}   |   Status: ${String(tournament.status).toUpperCase()}`, startX + 12, topY + 10);
      doc.fillColor(BRAND.primary).font('Helvetica-Bold').fontSize(10.5)
        .text(`Prize: ${tournament.prizeMoney || 'Trophy & Awards'}   |   Entry Fee: ₹${tournament.entryFee || 0}`, startX + 12, topY + 30);
      doc.restore();
      doc.y = topY + 66;

      // Points Table
      if (pointsTable && pointsTable.length > 0) {
        doc.fillColor(BRAND.darkText).font('Helvetica-Bold').fontSize(11).text('Points Table', startX, doc.y);
        doc.moveDown(0.3);
        const ptCols = [
          { key: 'rank', label: '#', width: 28 },
          { key: 'team', label: 'Team', width: 175, bold: true, maxChars: 28 },
          { key: 'played', label: 'P', width: 42, align: 'right' },
          { key: 'won', label: 'W', width: 42, align: 'right' },
          { key: 'lost', label: 'L', width: 42, align: 'right' },
          { key: 'tied', label: 'T', width: 42, align: 'right' },
          { key: 'points', label: 'Pts', width: 52, align: 'right', bold: true },
          { key: 'nrr', label: 'NRR', width: 100, align: 'right' }
        ];
        drawTableHeader(doc, ptCols, startX);
        pointsTable.forEach((row, idx) => {
          drawTableRow(doc, ptCols, {
            rank: idx + 1,
            team: row.teamName + (row.qualified ? ' (Q)' : ''),
            played: row.played,
            won: row.won,
            lost: row.lost,
            tied: row.tied,
            points: row.points,
            nrr: Number(row.netRunRate || 0).toFixed(3)
          }, startX, idx, 19, reprintHeader);
        });
        doc.moveDown(1);
      }

      // Fixtures & Results
      if (fixtures && fixtures.length > 0) {
        ensureSpace(doc, 60, reprintHeader);
        doc.fillColor(BRAND.darkText).font('Helvetica-Bold').fontSize(11).text('Fixtures & Results', startX, doc.y);
        doc.moveDown(0.3);
        const fxCols = [
          { key: 'num', label: '#', width: 28 },
          { key: 'round', label: 'Round', width: 95, maxChars: 16 },
          { key: 'matchup', label: 'Matchup', width: 205, bold: true, maxChars: 34 },
          { key: 'result', label: 'Status / Result', width: 195, maxChars: 34 }
        ];
        drawTableHeader(doc, fxCols, startX);
        fixtures.forEach((fx, idx) => {
          drawTableRow(doc, fxCols, {
            num: fx.matchNumber || idx + 1,
            round: fx.roundName || 'Match',
            matchup: `${fx.teamAName || 'TBD'} vs ${fx.teamBName || 'TBD'}`,
            result: fx.resultText || String(fx.status || 'scheduled').toUpperCase()
          }, startX, idx, 19, reprintHeader);
        });
      }

      if (awards && awards.length > 0) {
        ensureSpace(doc, 50, reprintHeader);
        doc.moveDown(1);
        doc.fillColor(BRAND.darkText).font('Helvetica-Bold').fontSize(11).text('Tournament Awards', startX, doc.y);
        doc.moveDown(0.3);
        for (const aw of awards) {
          doc.fillColor(BRAND.primary).font('Helvetica-Bold').fontSize(9.5)
            .text(`• ${aw.title}: ${aw.playerName} (${aw.metricText || ''})`, startX + 8, doc.y);
          doc.moveDown(0.2);
        }
      }

      addPageFooters(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generateMatchScorecardPDF,
  generateTournamentPDF
};
