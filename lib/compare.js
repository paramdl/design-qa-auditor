/**
 * Compares extracted page data against a design-system spec and
 * returns a list of issues: { severity, section, category, message, expected, actual, sample }
 */

const relLuminance = ({ r, g, b }) => {
  const f = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const contrastRatio = (fg, bg) => {
  // composite fg alpha over bg first
  const a = fg.a !== undefined ? fg.a : 1;
  const mix = {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
  };
  const l1 = relLuminance(mix);
  const l2 = relLuminance(bg);
  return +(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05))).toFixed(2);
};

const norm = (s) => String(s || '').toLowerCase().replace(/["']/g, '').trim();

function compare(data, ds) {
  const issues = [];
  const add = (severity, section, category, message, expected, actual, sample) =>
    issues.push({ severity, section, category, message, expected, actual, sample });

  const tol = ds.tolerance || {};
  const sizeTol = tol.fontSizePx ?? 0.5;

  // ---- page-level checks ----
  if (ds.checks?.singleH1 !== false) {
    if (data.headingCounts.h1 !== 1) {
      add('high', 'page', 'semantics', `Page has ${data.headingCounts.h1} <h1> elements (should be exactly 1)`, '1 h1', `${data.headingCounts.h1} h1`, data.title);
    }
  }
  if (ds.checks?.duplicateIds !== false) {
    for (const d of data.duplicateIds) {
      add('high', 'page', 'html-validity', `Duplicate id="${d.id}" appears ${d.count} times — anchors, ARIA and analytics will only match the first`, 'unique ids', `${d.count} occurrences`, d.id);
    }
  }

  const allowedFamilies = (ds.fontFamilies || []).map(norm);
  const scale = ds.typeScale || [];
  const allowedWeights = ds.fontWeights || [];
  const textColors = (ds.colors?.text || []).map((c) => c.toUpperCase());
  const accentColors = (ds.colors?.accent || []).map((c) => c.toUpperCase());
  const onDark = (ds.colors?.onDark || []).map((c) => c.toUpperCase());
  const allAllowedColors = [...textColors, ...accentColors, ...onDark];
  const spacingScale = ds.spacingScale || [];
  const roles = ds.roles || {};

  const secLabel = (s) => `#${s.index} ${s.kind}${s.heading ? ` ("${s.heading.slice(0, 40)}")` : ''}`;

  // ---- per-section checks ----
  for (const sec of data.sections) {
    const label = secLabel(sec);

    // section padding on spacing scale
    if (spacingScale.length && ds.checks?.sectionPadding !== false) {
      for (const side of ['paddingTop', 'paddingBottom']) {
        const v = parseFloat(sec[side]);
        if (v > 0 && !spacingScale.some((s) => Math.abs(s - v) <= (tol.spacingPx ?? 1))) {
          add('low', label, 'spacing', `Section ${side.replace('padding', 'padding-').toLowerCase()} ${v}px is not on the spacing scale`, spacingScale.join('/') + 'px', `${v}px`, sec.id || sec.tag);
        }
      }
    }

    for (const st of sec.styles) {
      const where = `<${st.tag.toLowerCase()}> "${st.sample.slice(0, 40)}"${st.count > 1 ? ` (×${st.count})` : ''}`;

      // font family
      if (allowedFamilies.length && !allowedFamilies.includes(norm(st.fontFamily))) {
        add('high', label, 'font-family', `Unexpected font family "${st.fontFamily}"`, ds.fontFamilies.join(' / '), st.fontFamily, where);
      }

      // type scale
      if (scale.length && !scale.some((s) => Math.abs(s - st.fontSize) <= sizeTol)) {
        const nearest = scale.reduce((a, b) => (Math.abs(b - st.fontSize) < Math.abs(a - st.fontSize) ? b : a));
        add('medium', label, 'type-scale', `Font size ${st.fontSize}px is off the type scale (nearest token: ${nearest}px)`, scale.join('/') + 'px', `${st.fontSize}px`, where);
      }

      // browser-default font size on buttons (13.333px) = unstyled control
      if (st.role === 'button' && Math.abs(st.fontSize - 13.3333) < 0.05) {
        add('medium', label, 'unstyled-control', 'Button renders at 13.333px — the browser default, i.e. font-size was never set', 'explicit button font-size', '13.333px (UA default)', where);
      }

      // weights
      if (allowedWeights.length && !allowedWeights.includes(st.fontWeight)) {
        add('low', label, 'font-weight', `Font weight ${st.fontWeight} is not in the allowed set`, allowedWeights.join('/'), String(st.fontWeight), where);
      }

      // colors
      if (allAllowedColors.length && st.colorAlpha >= 0.99 && !allAllowedColors.includes(st.color)) {
        add('medium', label, 'color-token', `Text color ${st.color} is not a design-system token`, allAllowedColors.join(' '), st.color, where);
      }

      // line-height rules per role
      const roleSpec = roles[st.role] || (st.role === 'body' || st.role === 'list' ? roles.body : null);
      if (roleSpec) {
        if (roleSpec.sizes && !roleSpec.sizes.some((s) => Math.abs(s - st.fontSize) <= sizeTol)) {
          add('medium', label, 'role-size', `${st.role} size ${st.fontSize}px does not match the ${st.role} spec`, roleSpec.sizes.join('/') + 'px', `${st.fontSize}px`, where);
        }
        if (roleSpec.weights && !roleSpec.weights.includes(st.fontWeight)) {
          add('low', label, 'role-weight', `${st.role} weight ${st.fontWeight} does not match the ${st.role} spec`, roleSpec.weights.join('/'), String(st.fontWeight), where);
        }
        if (roleSpec.lineHeight && st.lineHeightRatio) {
          const [min, max] = roleSpec.lineHeight;
          if (st.lineHeightRatio < min - 0.01 || st.lineHeightRatio > max + 0.01) {
            add('low', label, 'line-height', `${st.role} line-height ratio ${st.lineHeightRatio} outside ${min}–${max}`, `${min}–${max}`, String(st.lineHeightRatio), where);
          }
        }
        if (roleSpec.lineHeight && st.lineHeight === 'normal' && (st.role === 'body' || st.role === 'list')) {
          add('low', label, 'line-height', 'Body text has no explicit line-height (renders at browser "normal" ≈1.2, tighter than spec)', `${roleSpec.lineHeight[0]}–${roleSpec.lineHeight[1]}`, 'normal', where);
        }
      }

      // WCAG contrast (AA)
      if (ds.checks?.contrast !== false && st.colorRgb && st.effectiveBg) {
        const ratio = contrastRatio({ ...st.colorRgb, a: st.colorAlpha }, st.effectiveBg);
        const isLarge = st.fontSize >= 24 || (st.fontSize >= 18.66 && st.fontWeight >= 700);
        const required = isLarge ? 3 : 4.5;
        if (ratio < required) {
          add('high', label, 'contrast', `WCAG AA contrast failure: ${ratio}:1 (needs ${required}:1 for ${isLarge ? 'large' : 'normal'} text)`, `≥${required}:1`, `${ratio}:1`, where);
        }
      }
    }
  }

  // ---- cross-section consistency checks ----
  const h2s = data.sections.flatMap((s) => s.styles.filter((st) => st.role === 'h2').map((st) => ({ sec: secLabel(s), st })));
  const groupBy = (arr, fn) => arr.reduce((m, x) => { const k = fn(x); (m[k] = m[k] || []).push(x); return m; }, {});
  if (h2s.length > 2 && ds.checks?.headingConsistency !== false) {
    const bySize = groupBy(h2s, (x) => x.st.fontSize);
    const sizes = Object.keys(bySize);
    if (sizes.length > 1) {
      const main = sizes.sort((a, b) => bySize[b].length - bySize[a].length)[0];
      for (const s of sizes) {
        if (s !== main) {
          for (const o of bySize[s]) {
            add('medium', o.sec, 'consistency', `H2 is ${s}px while ${bySize[main].length} other section titles are ${main}px`, `${main}px`, `${s}px`, o.st.sample);
          }
        }
      }
    }
    const trackings = groupBy(h2s, (x) => x.st.letterSpacing);
    if (Object.keys(trackings).length > 1) {
      add('low', 'page', 'consistency', `Section titles (H2) mix letter-spacing values: ${Object.keys(trackings).join(', ')}`, 'one letter-spacing value', Object.keys(trackings).join(' vs '), `${h2s.length} H2 styles`);
    }
  }

  // too many distinct muted text colors
  if (ds.checks?.colorSprawl !== false) {
    const bodyCols = new Set(
      data.sections.flatMap((s) => s.styles.filter((st) => (st.role === 'body' || st.role === 'list') && st.colorAlpha >= 0.99).map((st) => st.color)),
    );
    const max = ds.maxBodyTextColors ?? 3;
    if (bodyCols.size > max) {
      add('medium', 'page', 'color-sprawl', `${bodyCols.size} distinct body-text colors used (design systems typically need ≤${max})`, `≤${max} tokens`, [...bodyCols].join(' '), 'body/list text across all sections');
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  return issues;
}

module.exports = { compare, contrastRatio };
