/**
 * Runs INSIDE the page via page.evaluate().
 * Detects sections, classifies them (hero/pricing/faq/...), groups text
 * elements per section and returns computed CSS for each unique style.
 * Must be self-contained: no imports, no outer-scope references.
 */
function pageExtract() {
  const TEXT_TAGS = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'A', 'BUTTON', 'LI', 'SPAN', 'LABEL', 'BLOCKQUOTE', 'FIGCAPTION', 'DT', 'DD', 'TD', 'TH', 'DIV', 'STRONG', 'EM', 'SMALL'];

  const toHex = (c) => {
    const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!m) return c;
    const hex = '#' + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('');
    const a = m[4] === undefined ? 1 : +m[4];
    return { hex: hex.toUpperCase(), alpha: a };
  };

  const rgbTriplet = (c) => {
    const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  };

  // ---- section classification heuristics ----
  const classify = (el, index, total) => {
    const hay = ((el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : '')).toLowerCase();
    const heading = (el.querySelector('h1,h2,h3') || {}).textContent || '';
    const htext = heading.toLowerCase();
    const text = (el.textContent || '').slice(0, 2000).toLowerCase();

    const rules = [
      ['header', () => el.tagName === 'HEADER' || /(^|\W)(navbar|site-header|topbar)(\W|$)/.test(hay)],
      ['footer', () => el.tagName === 'FOOTER' || /footer/.test(hay)],
      ['hero', () => /hero|banner|masthead|jumbotron/.test(hay) || !!el.querySelector('h1')],
      ['pricing', () => /pricing|plans?(-|_|\b)|package|revenue|monetiz|payment/.test(hay) || /pricing|per month|\/mo\b|revenue|payment/.test(htext)],
      ['faq', () => /faq|accordion|questions/.test(hay) || /faq|frequently asked/.test(htext)],
      ['testimonials', () => /testimonial|review|quote|clients?-say/.test(hay) || /testimonial|what.*(clients|customers).*say/.test(htext)],
      ['contact', () => /contact|get-in-touch|enquiry|inquiry/.test(hay) || (el.querySelector('form') && /contact|touch|message/.test(htext + ' ' + hay))],
      ['cta', () => /\bcta\b|call-to-action|banner-cta|bespoke/.test(hay)],
      ['stats', () => /stats|counter|numbers|metrics|expertise/.test(hay)],
      ['process', () => /process|steps|how-it-works|workflow|timeline/.test(hay) || /process|how it works/.test(htext)],
      ['team', () => /team|members|people/.test(hay) || /meet (the|our) team/.test(htext)],
      ['portfolio', () => /portfolio|work|case-stud|showcase|gallery|slider/.test(hay)],
      ['blog', () => /blog|articles|news|insights/.test(hay)],
      ['features', () => /features?|benefits?|services?|capabilit|solutions?|advantages?|why-/.test(hay) || /features|benefits|why choose|what's included/.test(htext)],
      ['tech-stack', () => /tech|stack|tools|integrations/.test(hay)],
      ['about', () => /about|story|mission/.test(hay)],
      ['form', () => !!el.querySelector('form')],
    ];
    for (const [name, test] of rules) {
      try { if (test()) return name; } catch (e) { /* ignore */ }
    }
    if (index === 0) return 'header';
    if (index === total - 1) return 'footer';
    return 'content';
  };

  // ---- collect candidate sections ----
  // Pass 1: semantic landmarks (section/header/footer/nav). Nested landmarks: keep the outermost.
  // Pass 2: main>div wrappers only where no landmark covers that area (for pages without <section>).
  const candidates = [];
  const bigEnough = (el) => el.offsetHeight >= 40 && el.getBoundingClientRect().width >= 200;
  document.querySelectorAll('header, nav, section, footer').forEach((el) => {
    if (!bigEnough(el)) return;
    if (candidates.some((c) => c.contains(el))) return; // keep outermost landmark
    for (let i = candidates.length - 1; i >= 0; i--) {
      if (el.contains(candidates[i])) candidates.splice(i, 1);
    }
    candidates.push(el);
  });
  document.querySelectorAll('main > div, body > div').forEach((el) => {
    if (!bigEnough(el)) return;
    // skip floating overlays (chat widgets, promo popups, modals) — not page sections
    const pos = getComputedStyle(el).position;
    if (pos === 'fixed' || pos === 'sticky' || el.closest('[role="dialog"], [aria-modal="true"]')) return;
    // only take wrappers that neither contain nor sit inside an existing candidate
    if (candidates.some((c) => c.contains(el) || el.contains(c))) return;
    candidates.push(el);
  });
  candidates.sort((a, b) => a.getBoundingClientRect().top + window.scrollY - (b.getBoundingClientRect().top + window.scrollY));

  // effective (non-transparent) background walking up the tree.
  // Returns null when a background-image/gradient is hit — contrast can't be computed reliably.
  const effectiveBg = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const cs = getComputedStyle(node);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const bg = rgbTriplet(cs.backgroundColor);
      if (bg && bg.a > 0.05) return bg;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };

  const roleOf = (el, cs) => {
    const t = el.tagName;
    if (/^H[1-6]$/.test(t)) return t.toLowerCase();
    if (t === 'BUTTON' || (t === 'A' && (cs.display.includes('block') || +cs.paddingLeft.replace('px', '') > 14) && rgbTriplet(cs.backgroundColor) && rgbTriplet(cs.backgroundColor).a > 0.05)) return 'button';
    if (t === 'A') return 'link';
    if (t === 'LABEL') return 'label';
    if (t === 'LI' || t === 'DT' || t === 'DD') return 'list';
    if (t === 'P' || t === 'BLOCKQUOTE') return 'body';
    return 'text';
  };

  const sections = candidates.map((sec, i) => {
    const cs = getComputedStyle(sec);
    const rect = sec.getBoundingClientRect();
    const heading = sec.querySelector('h1,h2,h3');
    const kind = classify(sec, i, candidates.length);
    const secBg = effectiveBg(sec);

    const styleMap = new Map();
    sec.querySelectorAll(TEXT_TAGS.join(',')).forEach((el) => {
      const direct = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
      const txt = direct || (el.children.length === 0 ? (el.textContent || '').trim() : '');
      if (!txt || txt.length < 2) return;
      const ecs = getComputedStyle(el);
      if (ecs.visibility === 'hidden' || ecs.display === 'none') return;
      if (el.offsetParent === null && ecs.position !== 'fixed') return;
      const col = toHex(ecs.color);
      const bgCol = toHex(ecs.backgroundColor);
      const role = roleOf(el, ecs);
      const sig = [el.tagName, role, ecs.fontFamily.split(',')[0], ecs.fontSize, ecs.fontWeight, col.hex, col.alpha, ecs.textAlign, ecs.lineHeight, ecs.letterSpacing].join('|');
      if (styleMap.has(sig)) { styleMap.get(sig).count++; return; }
      styleMap.set(sig, {
        tag: el.tagName,
        role,
        sample: txt.slice(0, 60),
        count: 1,
        fontFamily: ecs.fontFamily.split(',')[0].replace(/"/g, '').trim(),
        fontFamilyFull: ecs.fontFamily,
        fontSize: parseFloat(ecs.fontSize),
        fontWeight: +ecs.fontWeight,
        lineHeight: ecs.lineHeight === 'normal' ? 'normal' : parseFloat(ecs.lineHeight),
        lineHeightRatio: ecs.lineHeight === 'normal' ? null : +(parseFloat(ecs.lineHeight) / parseFloat(ecs.fontSize)).toFixed(2),
        letterSpacing: ecs.letterSpacing,
        color: col.hex,
        colorAlpha: col.alpha,
        colorRgb: rgbTriplet(ecs.color),
        backgroundColor: bgCol.hex ? bgCol.hex : null,
        backgroundAlpha: bgCol.alpha !== undefined ? bgCol.alpha : null,
        textAlign: ecs.textAlign,
        textTransform: ecs.textTransform,
        marginTop: ecs.marginTop,
        marginBottom: ecs.marginBottom,
        effectiveBg: effectiveBg(el),
      });
    });

    return {
      index: i,
      kind,
      tag: sec.tagName,
      id: sec.id || null,
      className: (typeof sec.className === 'string' ? sec.className : '').slice(0, 120),
      heading: heading ? heading.textContent.trim().slice(0, 90) : null,
      top: Math.round(rect.top + window.scrollY),
      height: Math.round(sec.offsetHeight),
      paddingTop: cs.paddingTop,
      paddingBottom: cs.paddingBottom,
      background: (() => { const b = toHex(cs.backgroundColor); return b.hex ? b : { hex: null, alpha: 0 }; })(),
      effectiveBg: secBg,
      styles: Array.from(styleMap.values()),
    };
  });

  // ---- page-level checks ----
  const ids = {};
  document.querySelectorAll('[id]').forEach((e) => { ids[e.id] = (ids[e.id] || 0) + 1; });
  const duplicateIds = Object.entries(ids).filter(([, v]) => v > 1).map(([k, v]) => ({ id: k, count: v }));

  const bodyCs = getComputedStyle(document.body);
  return {
    url: location.href,
    title: document.title,
    viewport: { width: innerWidth, height: innerHeight },
    body: { fontFamily: bodyCs.fontFamily, fontSize: bodyCs.fontSize, color: toHex(bodyCs.color).hex, background: toHex(bodyCs.backgroundColor).hex },
    headingCounts: { h1: document.querySelectorAll('h1').length, h2: document.querySelectorAll('h2').length, h3: document.querySelectorAll('h3').length, h4: document.querySelectorAll('h4').length },
    duplicateIds,
    sections,
  };
}

module.exports = { pageExtract };
