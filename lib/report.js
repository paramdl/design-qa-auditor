/** Generates report.md, report.html, css-export.json and css-export.csv into outDir */
const fs = require('fs');
const path = require('path');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const mdEsc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function toCsv(data) {
  const rows = [['section_index', 'section_kind', 'section_heading', 'tag', 'role', 'sample_text', 'occurrences', 'font_family', 'font_size_px', 'font_weight', 'line_height', 'line_height_ratio', 'letter_spacing', 'color', 'color_alpha', 'text_align', 'text_transform', 'margin_top', 'margin_bottom']];
  for (const sec of data.sections) {
    for (const st of sec.styles) {
      rows.push([sec.index, sec.kind, sec.heading || '', st.tag, st.role, st.sample, st.count, st.fontFamily, st.fontSize, st.fontWeight, st.lineHeight, st.lineHeightRatio ?? '', st.letterSpacing, st.color, st.colorAlpha, st.textAlign, st.textTransform, st.marginTop, st.marginBottom]);
    }
  }
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}

function writeReports({ data, issues, screenshots, outDir, dsName }) {
  fs.writeFileSync(path.join(outDir, 'css-export.json'), JSON.stringify(data, null, 2));
  fs.writeFileSync(path.join(outDir, 'css-export.csv'), '﻿' + toCsv(data));

  const counts = { high: 0, medium: 0, low: 0 };
  issues.forEach((i) => counts[i.severity]++);
  const sevIcon = { high: '🔴', medium: '🟠', low: '🟡' };

  // ---------- Markdown ----------
  const md = [];
  md.push(`# Design QA Report — ${data.title || data.url}`);
  md.push('');
  md.push(`**URL:** ${data.url}`);
  md.push(`**Audited:** ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · viewport ${data.viewport.width}×${data.viewport.height} · design system: \`${dsName}\``);
  md.push(`**Issues:** 🔴 ${counts.high} high · 🟠 ${counts.medium} medium · 🟡 ${counts.low} low`);
  md.push('');
  md.push(`Body default: \`${data.body.fontFamily}\` ${data.body.fontSize}, color ${data.body.color} · Headings: ${data.headingCounts.h1}×h1, ${data.headingCounts.h2}×h2, ${data.headingCounts.h3}×h3`);
  md.push('');
  md.push('## Sections Detected');
  md.push('');
  md.push('| # | Type | Heading | Height | Padding (t/b) | Background | Screenshot |');
  md.push('|---|------|---------|--------|---------------|------------|------------|');
  for (const sec of data.sections) {
    const shot = screenshots[sec.index] ? `[view](${screenshots[sec.index]})` : '—';
    md.push(`| ${sec.index} | **${sec.kind}** | ${mdEsc(sec.heading || '—')} | ${sec.height}px | ${sec.paddingTop}/${sec.paddingBottom} | ${sec.background.hex || 'transparent'} | ${shot} |`);
  }
  md.push('');
  md.push('## Issues');
  md.push('');
  if (!issues.length) md.push('✅ No issues found against the design system spec.');
  for (const sev of ['high', 'medium', 'low']) {
    const list = issues.filter((i) => i.severity === sev);
    if (!list.length) continue;
    md.push(`### ${sevIcon[sev]} ${sev.toUpperCase()} (${list.length})`);
    md.push('');
    md.push('| Section | Category | Issue | Expected | Actual | Element |');
    md.push('|---------|----------|-------|----------|--------|---------|');
    for (const i of list) {
      md.push(`| ${mdEsc(i.section)} | ${i.category} | ${mdEsc(i.message)} | ${mdEsc(i.expected)} | ${mdEsc(i.actual)} | ${mdEsc(i.sample)} |`);
    }
    md.push('');
  }
  md.push('## Per-Section Style Inventory');
  md.push('');
  for (const sec of data.sections) {
    md.push(`### ${sec.index}. ${sec.kind}${sec.heading ? ` — ${mdEsc(sec.heading)}` : ''}`);
    if (screenshots[sec.index]) md.push(`![section ${sec.index}](${screenshots[sec.index]})`);
    md.push('');
    md.push('| Tag | Role | Sample | × | Font | Size | Weight | LH | LS | Color | Align | Margins |');
    md.push('|-----|------|--------|---|------|------|--------|----|----|-------|-------|---------|');
    for (const st of sec.styles) {
      const col = st.colorAlpha < 0.99 ? `${st.color} @${Math.round(st.colorAlpha * 100)}%` : st.color;
      md.push(`| ${st.tag} | ${st.role} | ${mdEsc(st.sample.slice(0, 32))} | ${st.count} | ${mdEsc(st.fontFamily)} | ${st.fontSize}px | ${st.fontWeight} | ${st.lineHeight === 'normal' ? 'normal' : st.lineHeight + 'px' + (st.lineHeightRatio ? ` (${st.lineHeightRatio})` : '')} | ${st.letterSpacing} | ${col} | ${st.textAlign} | ${st.marginTop}/${st.marginBottom} |`);
    }
    md.push('');
  }
  fs.writeFileSync(path.join(outDir, 'report.md'), md.join('\n'));

  // ---------- HTML ----------
  const issueRow = (i) => `<tr class="sev-${i.severity}"><td><span class="pill ${i.severity}">${i.severity}</span></td><td>${esc(i.section)}</td><td>${esc(i.category)}</td><td>${esc(i.message)}</td><td><code>${esc(i.expected)}</code></td><td><code>${esc(i.actual)}</code></td><td class="sample">${esc(i.sample)}</td></tr>`;
  const swatch = (hex) => hex ? `<span class="sw" style="background:${hex}"></span>${hex}` : '—';

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Design QA — ${esc(data.title)}</title>
<style>
:root{--bg:#fff;--fg:#111;--muted:#667;--line:#e5e7eb;--card:#f8fafc}
@media(prefers-color-scheme:dark){:root{--bg:#0f1115;--fg:#e5e7eb;--muted:#9aa;--line:#2a2f3a;--card:#171b22}}
body{font:14px/1.55 system-ui,Segoe UI,sans-serif;background:var(--bg);color:var(--fg);margin:0;padding:32px;max-width:1200px;margin-inline:auto}
h1{font-size:22px}h2{font-size:18px;margin-top:36px;border-bottom:1px solid var(--line);padding-bottom:6px}h3{font-size:15px;margin-top:28px}
table{border-collapse:collapse;width:100%;font-size:12.5px;margin:10px 0}
th,td{border:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}
th{background:var(--card)}
.pill{padding:1px 8px;border-radius:10px;font-size:11px;font-weight:700;color:#fff}
.pill.high{background:#dc2626}.pill.medium{background:#ea580c}.pill.low{background:#ca8a04}
.summary{display:flex;gap:16px;margin:16px 0}
.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 18px;text-align:center}
.stat b{font-size:22px;display:block}
.sw{display:inline-block;width:11px;height:11px;border-radius:3px;border:1px solid var(--line);margin-right:5px;vertical-align:-1px}
img.shot{max-width:100%;border:1px solid var(--line);border-radius:8px;margin:6px 0}
.meta{color:var(--muted)}.sample{color:var(--muted);max-width:260px}
code{background:var(--card);padding:1px 4px;border-radius:4px}
details{margin:8px 0}summary{cursor:pointer;font-weight:600}
</style></head><body>
<h1>Design QA Report — ${esc(data.title || data.url)}</h1>
<p class="meta">${esc(data.url)} · audited ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · viewport ${data.viewport.width}×${data.viewport.height} · design system: <code>${esc(dsName)}</code></p>
<div class="summary">
<div class="stat"><b style="color:#dc2626">${counts.high}</b>high</div>
<div class="stat"><b style="color:#ea580c">${counts.medium}</b>medium</div>
<div class="stat"><b style="color:#ca8a04">${counts.low}</b>low</div>
<div class="stat"><b>${data.sections.length}</b>sections</div>
</div>
<h2>Issues (${issues.length})</h2>
<table><tr><th>Sev</th><th>Section</th><th>Category</th><th>Issue</th><th>Expected</th><th>Actual</th><th>Element</th></tr>
${issues.map(issueRow).join('\n')}</table>
<h2>Sections</h2>
${data.sections.map((sec) => `
<h3>${sec.index}. ${esc(sec.kind)}${sec.heading ? ' — ' + esc(sec.heading) : ''} <span class="meta">(${sec.height}px · pad ${esc(sec.paddingTop)}/${esc(sec.paddingBottom)} · bg ${sec.background.hex || 'transparent'})</span></h3>
${screenshots[sec.index] ? `<details open><summary>Screenshot</summary><img class="shot" loading="lazy" src="${screenshots[sec.index]}" alt="section ${sec.index}"></details>` : ''}
<table><tr><th>Tag</th><th>Role</th><th>Sample</th><th>×</th><th>Font</th><th>Size</th><th>Weight</th><th>Line-height</th><th>Letter-sp.</th><th>Color</th><th>Align</th><th>Margin t/b</th></tr>
${sec.styles.map((st) => `<tr><td>${st.tag}</td><td>${st.role}</td><td class="sample">${esc(st.sample.slice(0, 40))}</td><td>${st.count}</td><td>${esc(st.fontFamily)}</td><td>${st.fontSize}px</td><td>${st.fontWeight}</td><td>${st.lineHeight === 'normal' ? 'normal' : st.lineHeight + 'px' + (st.lineHeightRatio ? ' (' + st.lineHeightRatio + ')' : '')}</td><td>${esc(st.letterSpacing)}</td><td>${swatch(st.color)}${st.colorAlpha < 0.99 ? ' @' + Math.round(st.colorAlpha * 100) + '%' : ''}</td><td>${st.textAlign}</td><td>${esc(st.marginTop)}/${esc(st.marginBottom)}</td></tr>`).join('\n')}
</table>`).join('\n')}
</body></html>`;
  fs.writeFileSync(path.join(outDir, 'report.html'), html);
}

module.exports = { writeReports };
