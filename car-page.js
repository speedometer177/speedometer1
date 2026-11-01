/* ═══════════════════════════════════════════════════════════════
   ספידומטר — car-page.js · עמוד הדגם (v1, 29.10.2026)
   מבנה לפי ההדמיה (Levante): פס דגם עם סמל המותג וארבעה לחצנים
   (מפרט טכני מלא · גלריית תמונות · אבזור · חוות דעת), טאבים של רמות גימור,
   שם הדגם מאחורי רכב ללא רקע, מחיר, שישה נתונים, ופס תמונות לכל הרוחב.

   render(car) היא פונקציה טהורה (מחרוזת HTML בלבד, בלי DOM) — אותה פונקציה
   רצה בדפדפן וגם במחולל הדפים הסטטיים (scripts/generate-static-pages.mjs דרך vm),
   כך שמה שגוגל רואה זהה למה שהגולש רואה. mount() היא שכבת האינטראקציה (דפדפן בלבד).
   כלל ברזל: נתון חסר לא מוצג. לא ממציאים ערכים.
═══════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  /* ── עזרים (עצמאיים — רצים גם ב-Node) ── */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const num = v => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);
  const fmt = v => num(v) == null ? null : Number(v).toLocaleString('he-IL');
  const price = v => num(v) ? '₪' + fmt(v) : null;
  /* טקסט מעורב עברית/אנגלית: כל רצף בכיוון אחד מבודד ב-<bdi> משלו, כך שהסדר נשמר
     ("Hyundai קונה", "Keyless GO - פתיחת…"). מילה עם מקף ("E-Class", "פלאג-אין") לא נשברת בין שורות. */
  function mix(s) {
    s = String(s == null ? '' : s).trim(); if (!s) return '';
    const HEB = /[\u0590-\u05FF]/, LAT = /[A-Za-z]/, SEP = /^[·•|,،;:–—\-\/]+$/, groups = [];
    let cur = '', ct = null, pend = '';
    s.split(/(\s+)/).forEach(tok => {
      if (!tok) return;
      if (/^\s+$/.test(tok)) { pend += tok; return; }
      const t = HEB.test(tok) ? 'h' : LAT.test(tok) ? 'l' : null;
      if (!t) {
        /* מפריד (· , –) סוגר את הקבוצה הנוכחית; מספר בלי מפריד נשאר צמוד למילה שלפניו */
        if (SEP.test(tok)) { cur += pend.replace(/\s+$/, ''); pend = (pend.match(/\s+$/) || [''])[0] + tok; }
        else if (pend && SEP.test(pend.trim().split(/\s+/)[0] || '')) pend += tok;
        else { cur += pend + tok; pend = ''; }
        return;
      }
      if (ct && t !== ct) { groups.push([cur, ct]); cur = pend.replace(/^\s+/, '') + tok; }
      else cur += pend + tok;
      pend = ''; ct = t;
    });
    cur += pend; groups.push([cur, ct]);
    const nw = g => esc(g.trim()).split(/(\s+)/).map(w => /\S-\S/.test(w) ? '<span class="nw">' + w + '</span>' : w).join('');
    return groups.filter(g => g[0].trim()).map(g => '<bdi dir="' + (g[1] === 'h' ? 'rtl' : g[1] === 'l' ? 'ltr' : 'auto') + '">' + nw(g[0]) + '</bdi>').join(' ');
  }
  const STOCK = /(^|\.)(unsplash\.com|pexels\.com|pixabay\.com)$/;
  function isStock(u) { try { return STOCK.test(new URL(u).hostname); } catch (e) { return false; } }
  function thumb(src, w) {
    if (!src || !/^https?:/.test(src)) return src;
    if (/supabase\.co\/storage/.test(src)) return 'https://wsrv.nl/?url=' + encodeURIComponent(src) + '&w=' + w + '&output=webp&q=84';
    return src;
  }
  const PT = { ev: 'חשמלי', erev: 'מאריך טווח', phev: 'פלאג-אין', hev: 'היברידי', mhev: 'היברידי קל', petrol: 'בנזין', diesel: 'דיזל' };
  const PT_AL = { electric: 'ev', bev: 'ev', 'חשמלי': 'ev', erev: 'erev', reev: 'erev', phev: 'phev', 'פלאג-אין': 'phev', hybrid: 'hev', hev: 'hev', 'היברידי': 'hev', mhev: 'mhev', 'היברידי קל': 'mhev', petrol: 'petrol', 'בנזין': 'petrol', diesel: 'diesel', 'דיזל': 'diesel' };
  function powertrain(c) {
    if (c.powertrain) { const k = PT_AL[String(c.powertrain).trim().toLowerCase()] || PT_AL[String(c.powertrain).trim()]; if (k) return k; }
    const e = String(c.engine || ''), fuel = c.fuel_consumption != null && String(c.fuel_consumption).trim() !== '';
    if (/PHEV|פלאג/i.test(e)) return 'phev';
    if (/^\s*חשמלי/.test(e) && !fuel) return 'ev';
    if (/מנוע(ים)? חשמלי|\+\s*חשמל/.test(e) && c.range_ev) return 'phev';
    if (/מיילד|מייל-היברידי|היברידי קל|mild/i.test(e)) return 'mhev';
    if (/היברידי|היברידית|hybrid/i.test(e)) return 'hev';
    if (/דיזל|TDI|diesel/i.test(e)) return 'diesel';
    if (/טורבו|טבעי|TSI|בנזין|\d\.\dL/i.test(e)) return 'petrol';
    return null;
  }
  function liters(c) { const m = String(c.engine || '').match(/(\d\.\d)\s*(L|ליטר)?/i); return m ? m[1] + ' ל׳' : null; }
  function driveShort(d) {
    d = String(d || ''); if (!d) return null;
    const out = [];
    if (/קדמי|קידמי|קדמית|FWD/i.test(d)) out.push('קדמית');
    if (/AWD|4x4|4WD|כפולה|4Motion|Symmetrical/i.test(d)) out.push('כפולה');
    if (/אחורי|RWD/i.test(d)) out.push('אחורית');
    return out.length ? out.join(' / ') : d;
  }
  /* מומנט מוצג בקג"מ (מוסכמת האתר). ערך מתחת ל-100 כבר בקג"מ; מעל — נ"מ ומומר. */
  function torqueKgm(v) { const n = num(v); if (n == null) return null; return n < 100 ? String(n) : String(Math.round(n / 9.80665 * 10) / 10); }
  function brandName(raw) {
    const k = String(raw || '').trim();
    if (root.SPCars && root.SPCars.brandInfo) return root.SPCars.brandInfo(k).name || k;
    return k.length > 3 && k === k.toUpperCase() ? k.charAt(0) + k.slice(1).toLowerCase() : k;
  }
  function brandMark(raw) {
    const S = root.SPCars;
    if (S && S.brandMark) { const k = S.brandKey(raw); return S.brandMark(k, brandName(raw)); }
    const t = brandName(raw);
    return '<span class="cx-wordmark' + (t.length > 7 ? ' is-long' : '') + '" aria-hidden="true">' + esc(t) + '</span>';
  }

  /* ── רמות גימור: מיזוג נתוני הרמה על נתוני הבסיס ── */
  function trimsOf(c) {
    const t = Array.isArray(c.trims) ? c.trims : [];
    const rich = t.filter(x => x && typeof x === 'object' && x.name);
    if (rich.length) return rich;
    const names = t.filter(x => typeof x === 'string' && x.trim());
    return names.map(n => ({ name: n }));
  }
  function merged(c, trim) { return trim ? specOf(c, trim) : c; }

  /* ── שישה נתונים לפי ההדמיה: הספק · מהירות מרבית · 0-100 · מנוע · סוג הנעה · מומנט ── */
  function sixSpecs(m) {
    const pt = powertrain(m);
    return [
      { k: 'hp', label: num(m.system_hp) != null ? 'הספק משולב' : 'הספק מרבי', v: fmt(hpOf(m)), u: 'כ״ס' },
      { k: 'vmax', label: 'מהירות מרבית', v: fmt(m.top_speed), u: 'קמ״ש' },
      { k: 'acc', label: 'תאוצה 0-100', v: num(m.acceleration_0_100) != null ? String(num(m.acceleration_0_100)) : null, u: 'שנ׳' },
      { k: 'eng', label: 'מנוע', v: pt ? PT[pt] : (liters(m) || null), u: pt ? (liters(m) || '') : '' },
      { k: 'drv', label: 'סוג הנעה', v: driveShort(m.drive_type), u: '' },
      { k: 'tq', label: num(m.system_nm) != null ? 'מומנט משולב' : 'מומנט מרבי', v: torqueKgm(nmOf(m)), u: 'קג״מ' }
    ];
  }
  /* ערך ארוך (למשל "היברידי קל 2.0 ל׳") מקבל גופן קטן יותר כדי שלא ייחתך בעמודה */
  const specLong = s => String(s.v || '').length + String(s.u || '').length > 11;
  function specsHTML(m) {
    return sixSpecs(m).map((s, i) => '<div class="cp-spec' + (specLong(s) ? ' is-long' : '') + '" data-k="' + s.k + '" style="--i:' + i + '"><dt>' + esc(s.label) + '</dt><dd><span class="cp-spec-v">' +
      (s.v != null && s.v !== '' ? '<b class="cx-num">' + esc(s.v) + '</b>' + (s.u ? '<i>' + esc(s.u) + '</i>' : '') : '<b class="cp-na">—</b>') + '</span></dd></div>').join('');
  }

  /* ── תמונות: מבודדת ← תמונות אמיתיות. סטוק כללית לא מוצגת (תמונה של דגם אחר). ── */
  function images(c) {
    const list = [];
    if (c.image_cutout) list.push({ src: c.image_cutout, cut: true });
    const g = [c.image_main].concat(Array.isArray(c.gallery_images) ? c.gallery_images : []);
    g.forEach(u => { if (u && !isStock(u) && !list.some(x => x.src === u)) list.push({ src: u, cut: false }); });
    return list;
  }
  const LINE_CAR = '<svg class="cx-line-car" viewBox="0 0 400 140" aria-hidden="true"><path d="M22 104h28M126 104h150M352 104h28"/><path d="M50 104c-12 0-20-6-20-15v-11c0-8 5-13 13-15l52-10 44-27c9-6 19-9 30-9h88c12 0 23 5 31 12l30 26 42 7c12 2 20 11 20 23v6c0 8-6 13-14 13h-16"/><path d="M126 104a38 38 0 0 0-76 0M352 104a38 38 0 0 0-76 0"/><circle cx="88" cy="104" r="27"/><circle cx="88" cy="104" r="15" class="soft"/><circle cx="314" cy="104" r="27"/><circle cx="314" cy="104" r="15" class="soft"/><path d="M141 51l28-17c7-4 14-6 22-6h22v23z" class="soft"/><path d="M224 28h40c9 0 17 3 23 9l15 14h-78z" class="soft"/><path d="M219 28v58M150 58h196" class="soft"/><path d="M12 132h376" class="dim"/></svg>';
  function frame(img, alt, eager) {
    if (!img) return '<div class="cp-frame is-line">' + LINE_CAR + '<span class="cp-note">תמונה רשמית תעלה בקרוב</span></div>';
    return '<div class="cp-frame ' + (img.cut ? 'is-cut' : 'is-photo') + '"><img src="' + esc(thumb(img.src, 1600)) + '" alt="' + esc(alt) + '" width="1200" height="' + (img.cut ? 520 : 750) + '"' + (eager ? ' fetchpriority="high"' : ' loading="lazy"') + ' decoding="async"></div>';
  }

  const ICO = {
    arrow: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    next: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    share: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
    mail: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/></svg>',
    scale: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/></svg>'
  };
  const SITE = 'https://speedometer10.co.il';
  /* סמלי וואטסאפ ופייסבוק — קבצים מספריית Simple Icons 13.0.0 (רישיון CC0), שמורים באתר תחת /icons/.
     נטענים כמסכת CSS כדי לקבל את צבע הכפתור. */
  const SI = '/icons/';
  function sharePanel(c, full) {
    const u = SITE + '/car/' + encodeURIComponent(c.slug || c.id) + '/', t = full + ' — מפרט, מחיר ותמונות | ספידומטר';
    const brandIco = n => '<i class="cp-si" style="--si:url(' + SI + n + '.svg)" aria-hidden="true"></i>';
    return '<div class="cp-share" role="group" aria-label="שיתוף הדגם">' +
      '<a class="cp-sh cp-sh--wa" href="https://wa.me/?text=' + encodeURIComponent(t + '\n' + u) + '" target="_blank" rel="noopener" aria-label="שיתוף בוואטסאפ">' + brandIco('whatsapp') + '<span>וואטסאפ</span></a>' +
      '<a class="cp-sh cp-sh--mail" href="mailto:?subject=' + encodeURIComponent(t) + '&amp;body=' + encodeURIComponent(u) + '" aria-label="שליחה במייל">' + ICO.mail + '<span>מייל</span></a>' +
      '<a class="cp-sh cp-sh--fb" href="https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(u) + '" target="_blank" rel="noopener" aria-label="שיתוף בפייסבוק">' + brandIco('facebook') + '<span>פייסבוק</span></a>' +
      '<button type="button" class="cp-sh cp-sh--native" data-share="' + esc(u) + '" aria-label="שיתוף או העתקת קישור">' + ICO.share + '<span>שיתוף</span></button>' +
    '</div>';
  }
  /* עיגול הציון — ציון ספידומטר (0-10) שנקבע ידנית באדמין. בלי ציון — העיגול לא מוצג. */
  function scoreBadge(c, url) {
    const sc = num(c.score); if (sc == null) return '';
    const v = Math.max(0, Math.min(10, sc)), t = Number.isInteger(v) ? v : v.toFixed(1), C = 2 * Math.PI * 47;
    return '<a class="cp-score" href="' + url + '?view=review" data-view="review" aria-label="ציון ספידומטר ' + t + ' מתוך 10 — לחוות הדעת" style="--len:' + C.toFixed(1) + ';--off:' + (C * (1 - v / 10)).toFixed(1) + '">' +
      '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="47" class="cp-score-bg"/><circle cx="50" cy="50" r="47" class="cp-score-arc"/></svg>' +
      '<small>ציון<br>ספידומטר</small><b class="cx-num" dir="ltr">' + t + '<i>/10</i></b></a>';
  }
  const VIEWS = [
    { id: 'specs', label: 'מפרט טכני מלא' },
    { id: 'gallery', label: 'גלריית תמונות' },
    { id: 'equipment', label: 'אבזור' },
    { id: 'review', label: 'חוות דעת' }
  ];

  /* ═══ render — HTML טהור לעמוד הדגם ═══ */
  function render(c, opts) {
    opts = opts || {};
    const trims = trimsOf(c), ti = Math.min(opts.trim || 0, Math.max(trims.length - 1, 0));
    const m = merged(c, trims[ti]);
    const bn = brandName(c.brand), full = bn + ' ' + c.model;
    const imgs = images(c), main = imgs[0] || null;
    const p = price(m.price) || price(c.price);
    const url = '/car/' + encodeURIComponent(c.slug || c.id) + '/';
    const tabs = trims.length ? trims : [{ name: c.model, _base: true }];

    return '<div class="cp" data-slug="' + esc(c.slug || c.id) + '">' +
      /* פס הדגם: סמל החברה · ארבעה לחצנים · השוואה */
      '<div class="cp-bar"><div class="cx-wrap cp-bar-in">' +
        '<a class="cp-brand" href="/cars-list.html?brand=' + encodeURIComponent(String(c.brand || '').toLowerCase()) + '" aria-label="כל הדגמים של ' + esc(bn) + '">' + brandMark(c.brand) + '</a>' +
        '<nav class="cp-nav" aria-label="עמודי הדגם"><a href="' + url + '" data-view="" aria-current="page">דגם</a>' + VIEWS.map(v => '<a href="' + url + '?view=' + v.id + '" data-view="' + v.id + '">' + esc(v.label) + '</a>').join('') + '</nav>' +
        '<div class="cp-bar-acts">' +
          '<button type="button" class="cp-cta" data-cmp="' + esc(c.slug || c.id) + '" aria-pressed="false">' + ICO.scale + '<span>הוספה להשוואה</span>' + ICO.arrow + '</button>' +
        '</div>' +
      '</div></div>' +

      /* במת התצוגה */
      '<section class="cp-show" id="cp-show" aria-label="' + esc(full) + '">' +
        '<div class="cp-trims-wrap"><div class="cp-trims" role="tablist" aria-label="רמות גימור">' +
          tabs.map((t, i) => '<button type="button" role="tab" class="cp-trim" data-trim="' + i + '" aria-selected="' + (i === ti) + '"' + (tabs.length < 2 ? ' tabindex="-1"' : '') + '>' + mix(t.name) + '</button>').join('') +
          '<i class="cp-trim-bar" aria-hidden="true"></i></div></div>' +
        '<div class="cp-stage">' +
          '<h1 class="cp-title"><span class="cx-sr">' + esc(bn) + ' </span><span class="cp-title-in"><span class="cp-title-model">' + mix(c.model) + '</span> <span class="cp-title-trim">' + mix(trims[ti] ? trims[ti].name : (c.year || '')) + '</span></span></h1>' +
          '<div class="cp-car" id="cp-car">' + frame(main, full + (c.year ? ' ' + c.year : ''), true) + '</div>' +
          scoreBadge(c, url) +
          (trims.length > 1 ? '<button type="button" class="cp-peek" data-trim-next aria-label="לרמת הגימור הבאה">' + (main ? '<span class="cp-peek-img">' + frame(main, '', false) + '</span>' : '') + '<span class="cp-peek-btn">' + ICO.next + '</span></button>' : '') +
        '</div>' +
        '<div class="cp-price">' + (p ? '<small>החל מ-</small><b class="cx-num" id="cp-price">' + p + '</b>' : '<small>מחיר טרם פורסם</small>') + '</div>' +
        '<dl class="cp-specs" id="cp-specs">' + specsHTML(m) + '</dl>' +
        sharePanel(c, full) +
        (imgs.length > 1 ? '<div class="cp-strip" role="list" aria-label="תמונות הדגם">' + imgs.map((im, i) => '<button type="button" role="listitem" class="cp-thumb' + (im.cut ? ' is-cut' : '') + '" style="--i:' + i + '" data-img="' + i + '" aria-pressed="' + (i === 0) + '" aria-label="תמונה ' + (i + 1) + ' מתוך ' + imgs.length + '"><img src="' + esc(thumb(im.src, 280)) + '" alt="" loading="lazy" decoding="async"></button>').join('') + '</div>' : '') +
      '</section>' +

      /* על הדגם — טקסט קצר ל-SEO ולקריאה */
      (c.description ? '<section class="cp-about cx-wrap"><h2>על ' + esc(full) + '</h2><p>' + esc(c.description) + '</p>' +
        '<div class="cp-about-meta">' + [c.category, c.importer ? 'יבואן: ' + c.importer : '', c.country_of_origin ? 'ארץ ייצור: ' + c.country_of_origin : ''].filter(Boolean).map(x => '<span>' + esc(x) + '</span>').join('') + '</div></section>' : '') +

      '<div class="cp-view" id="cp-view" hidden></div>' +
    '</div>';
  }

  /* ═══ עמודי המשנה (זמניים — יעוצבו לפי הדוגמאות שיישלחו) ═══ */
  /* ═══════════════════════════════════════════════════════════════
     מפרט טכני מלא (?view=specs) — לפי הדמיית FindAuto, בצבעי האתר.
     מקור הנתונים: שדות הרכב + שדות כל גרסה בתוך trims (jsonb — כל מפתח נוסף נשמר בלי שינוי סכמה).
     נתון חסר = השורה לא מוצגת. העיגולים מחושבים רק מנתונים אמיתיים (ביחס לרכבים במאגר / סולם רשמי).
  ═══════════════════════════════════════════════════════════════ */
  /* גרסה מחילוץ v2 (trim.v === 2) היא יחידה מלאה: שדה ריק בה = לא מופיע במסמך לגרסה הזו, ולא ממלאים אותו
     מגרסה אחרת. גרסאות ישנות (בלי v) — ממזגים רק ערכים קיימים על נתוני הרכב, כמו קודם. */
  function specOf(c, trim) {
    const m = Object.assign({}, c);
    const full = trim && trim.v === 2;
    if (trim) Object.keys(trim).forEach(k => { if (k === 'v') return; const v = trim[k], empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length); if (empty && !full) return; m[k === 'acceleration' ? 'acceleration_0_100' : k] = empty ? null : v; });
    m._trim = trim || null; return m;
  }
  const U = (v, u) => { const n = num(v); if (n == null) return (v != null && String(v).trim() !== '') ? String(v) : null; return fmt(n) + (u ? ' ' + u : ''); };
  const at = (s, rpm) => s && rpm ? s + '\n' + 'ב-' + rpm + ' סל״ד' : s;
  const tqs = v => { const n = num(v); if (n == null) return null; return n < 100 ? fmt(n) + ' קג״מ' : fmt(n) + ' נ״מ · ' + torqueKgm(n) + ' קג״מ'; };
  function safetyLevel(m) { const n = num(m.safety_level); if (n != null) return n; const r = String(m.safety_rating || '').match(/(\d)\s*מתוך\s*8/); return r ? +r[1] : null; }
  function airbags(m) { const n = num(m.airbags); if (n != null) return n; const r = String(m.safety_rating || '').match(/(\d+)\s*כריות/); return r ? +r[1] : null; }
  const hpOf = m => num(m.system_hp) != null ? num(m.system_hp) : num(m.horsepower);
  const nmOf = m => num(m.system_nm) != null ? num(m.system_nm) : num(m.torque);
  const SPEC_SECTIONS = [
    { t: 'מנוע', rows: [
      ['סוג מנוע', m => m.engine || null],
      ['סוג הנעה', m => powertrain(m) ? PT[powertrain(m)] : null],
      ['תצורה / מס׳ בוכנות', m => m.engine_layout || null],
      ['נפח מנוע', m => U(m.displacement_cc, 'סמ״ק')],
      ['הספק מרבי', m => at(U(m.horsepower, 'כ״ס'), m.hp_rpm)],
      ['מומנט מרבי', m => at(tqs(m.torque), m.torque_rpm)],
      ['נפח מיכל דלק', m => U(m.fuel_tank, 'ליטר')]
    ] },
    { t: 'ביצועים', rows: [
      ['תאוצה 0-100 קמ״ש', m => U(m.acceleration_0_100, 'שניות')],
      ['מהירות מרבית', m => U(m.top_speed, 'קמ״ש')],
      ['הספק משולב (בעירה + חשמל)', m => U(m.system_hp, 'כ״ס')],
      ['מומנט משולב (בעירה + חשמל)', m => tqs(m.system_nm)]
    ] },
    { t: 'מערכת חשמלית והיברידית', rows: [
      ['הספק מנוע חשמלי', m => U(m.electric_hp, 'כ״ס')],
      ['מומנט מנוע חשמלי', m => tqs(m.electric_nm)],
      ['תוספת הספק (מייל-היבריד)', m => U(m.boost_hp, 'כ״ס')],
      ['תוספת מומנט (מייל-היבריד)', m => tqs(m.boost_nm)],
      ['קיבולת סוללה', m => U(m.battery_capacity_kwh, 'קוט״ש')],
      ['טווח נסיעה חשמלית', m => U(m.range_ev, 'ק״מ')],
      ['הספק טעינה AC', m => U(m.charge_ac_kw, 'קו״ט')],
      ['זמן טעינה AC (0-100%)', m => m.charge_ac_time || null],
      ['הספק טעינה DC', m => U(m.charge_dc_kw, 'קו״ט')],
      ['זמן טעינה DC', m => m.charge_dc_time || null]
    ] },
    { t: 'מערכת הינע', rows: [
      ['הנעה', m => m.drive_type || null],
      ['תיבת הילוכים', m => m.transmission || null]
    ] },
    { t: 'מידות ומשקלים', rows: [
      ['אורך כללי', m => U(m.length, 'מ״מ')],
      ['רוחב כללי', m => U(m.width, 'מ״מ')],
      ['רוחב כולל מראות', m => U(m.width_mirrors, 'מ״מ')],
      ['גובה כללי', m => U(m.height, 'מ״מ')],
      ['מרחק סרנים', m => U(m.wheelbase, 'מ״מ')],
      ['מרווח גחון', m => U(m.ground_clearance, 'מ״מ')],
      ['משקל עצמי', m => U(m.weight, 'ק״ג')],
      ['משקל כולל מורשה', m => U(m.gross_weight, 'ק״ג')],
      ['נפח תא מטען', m => U(m.trunk_volume, 'ליטר')],
      ['קוטר סיבוב', m => U(m.turning_circle, 'מטר')],
      ['כושר גרירה (ללא / עם בלמים)', m => (num(m.towing_unbraked) != null && num(m.towing_braked) != null) ? fmt(m.towing_unbraked) + ' / ' + fmt(m.towing_braked) + ' ק״ג' : U(m.towing_braked || m.towing_capacity, 'ק״ג')],
      ['מושבים', m => U(m.seats, '')],
      ['צמיגים', m => m.tires || null]
    ] },
    { t: 'צריכה וזיהום', rows: [
      ['צריכת דלק משולבת', m => U(m.fuel_consumption, 'ל׳/100 ק״מ')],
      ['צריכת חשמל', m => U(m.electric_consumption, 'וואט־שעה/ק״מ')],
      ['דרגת זיהום אוויר', m => num(m.pollution_index) != null ? m.pollution_index + ' מתוך 15' : null]
    ] },
    { t: 'בטיחות ואחריות', rows: [
      ['רמת אבזור בטיחותי', m => safetyLevel(m) != null ? safetyLevel(m) + ' מתוך 8' : null],
      ['כריות אוויר', m => U(airbags(m), '')],
      ['דירוג בטיחות', m => (safetyLevel(m) == null && m.safety_rating) ? m.safety_rating : null],
      ['אחריות', m => m.warranty || null],
      ['אחריות לסוללה', m => m.battery_warranty || null]
    ] }
  ];
  /* מדדי הגרף — רק מדד עם 2 ערכים לפחות מוצג כלשונית */
  const SV_METRICS = [
    { k: 'hp', t: 'הספק', u: 'כ״ס', get: hpOf },
    { k: 'tq', t: 'מומנט', u: 'קג״מ', get: m => { const n = nmOf(m); return n == null ? null : +torqueKgm(n); } },
    { k: 'acc', t: '0-100', u: 'שנ׳', get: m => num(m.acceleration_0_100) },
    { k: 'vmax', t: 'מהירות מרבית', u: 'קמ״ש', get: m => num(m.top_speed) },
    { k: 'kg', t: 'משקל', u: 'ק״ג', get: m => num(m.weight) },
    { k: 'trunk', t: 'תא מטען', u: 'ליטר', get: m => num(m.trunk_volume) }
  ];
  const SVI = {
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="12" cy="18" r="2"/><path d="M6 8v8M12 8v8M18 8v3a1 1 0 0 1-1 1H6"/></svg>',
    drive: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3v6.5M4.2 16.5l5.6-3.2M19.8 16.5l-5.6-3.2"/></svg>',
    fuel: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 11h10"/><path d="M14 8h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V9l-3-3"/></svg>',
    cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-7 9 7M5 9.5V20h14V9.5"/></svg>',
    chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>'
  };
  function svVersions(c) { const t = trimsOf(c); return t.length ? t : [null]; }
  function svFacts(m) {
    const f = [
      [SVI.gear, m.transmission ? (/אוטומט|automatic|DCT|CVT|TRONIC|DSG|e-CVT/i.test(m.transmission) && m.transmission.length > 14 ? 'אוטומטית' : m.transmission) : null, 'תיבת הילוכים'],
      [SVI.drive, driveShort(m.drive_type) ? 'הנעה ' + driveShort(m.drive_type) : null, 'הנעה'],
      [SVI.fuel, powertrain(m) ? PT[powertrain(m)] + (liters(m) ? ' ' + liters(m) : '') : null, 'מנוע'],
      [SVI.cal, m.year ? 'שנת ' + m.year : null, 'שנת דגם']
    ].filter(x => x[1]);
    return f.map(x => '<li title="' + esc(x[2]) + '">' + x[0] + '<span>' + esc(x[1]) + '</span></li>').join('');
  }
  /* העיגולים: ביחס לרכבים במאגר (הספק, תאוצה, טווח) או סולם רשמי (בטיחות 8, זיהום 15) */
  function svRings(m, cars) {
    const all = [];
    (cars || []).forEach(x => { const ts = trimsOf(x); if (ts.length) ts.forEach(t => all.push(specOf(x, t))); else all.push(x); });
    const maxOf = f => { const v = all.map(f).filter(n => n != null && n > 0); return v.length ? Math.max.apply(null, v) : null; };
    const minOf = f => { const v = all.map(f).filter(n => n != null && n > 0); return v.length ? Math.min.apply(null, v) : null; };
    const out = [];
    const hp = hpOf(m), mxh = maxOf(hpOf);
    if (hp != null && mxh) out.push({ k: 'hp', v: fmt(hp), u: 'כ״ס', p: Math.min(1, hp / mxh), t: 'הספק', s: 'ביחס לחזק במאגר' });
    const acc = num(m.acceleration_0_100), mna = minOf(x => num(x.acceleration_0_100));
    if (acc && mna) out.push({ k: 'acc', v: String(acc), u: 'שנ׳', p: Math.min(1, mna / acc), t: 'תאוצה 0-100', s: 'ביחס למהיר במאגר' });
    const sl = safetyLevel(m);
    if (sl != null) out.push({ k: 'safe', v: String(sl), u: '/8', p: sl / 8, t: 'רמת בטיחות', s: 'סולם 0-8' });
    const pi = num(m.pollution_index);
    if (pi != null) out.push({ k: 'eco', v: String(pi), u: '/15', p: (16 - pi) / 15, t: 'דרגת זיהום', s: '1 = הנקי ביותר' });
    const rg = num(m.range_ev), mxr = maxOf(x => num(x.range_ev));
    if (rg && mxr) out.push({ k: 'rng', v: fmt(rg), u: 'ק״מ', p: Math.min(1, rg / mxr), t: 'טווח חשמלי', s: 'ביחס לארוך במאגר' });
    return out.slice(0, 4);
  }
  const R_C = 2 * Math.PI * 42;
  function svRingsHTML(rs) {
    return rs.map((r, i) => '<li class="sv-ring" data-ring="' + r.k + '" style="--i:' + i + ';--off:' + (R_C * (1 - r.p)).toFixed(1) + '">' +
      '<span class="sv-ring-g"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42" class="sv-ring-bg"/><circle cx="50" cy="50" r="42" class="sv-ring-arc" style="stroke-dasharray:' + R_C.toFixed(1) + '"/></svg>' +
      '<b class="cx-num" dir="ltr">' + esc(r.v) + '<i>' + esc(r.u) + '</i></b></span>' +
      '<strong>' + esc(r.t) + '</strong><small>' + esc(r.s) + ' · ' + Math.round(r.p * 100) + '%</small></li>').join('');
  }
  function svAccHTML(m, open) {
    let n = 0;
    return SPEC_SECTIONS.map((sec, si) => {
      const rows = sec.rows.map(r => { const v = r[1](m); if (v == null || v === '') return ''; const pr = String(v).split('\n'); return '<div class="sv-row' + (pr[0].length > 24 ? ' is-wide' : '') + '"><dt>' + esc(r[0]) + '</dt><dd>' + esc(pr[0]) + (pr[1] ? '<small>' + esc(pr[1]) + '</small>' : '') + '</dd></div>'; }).join('');
      if (!rows) return '';
      const on = open ? open.indexOf(si) !== -1 : n++ === 0;
      return '<section class="sv-sec' + (on ? ' is-open' : '') + '"><h4><button type="button" data-sv-sec="' + si + '" aria-expanded="' + on + '" aria-controls="sv-sec-' + si + '">' + esc(sec.t) + SVI.chev + '</button></h4>' +
        '<div class="sv-sec-b" id="sv-sec-' + si + '"><dl>' + rows + '</dl></div></section>';
    }).join('');
  }
  /* נתוני הגרף: גרסאות הדגם (2+) — אחרת דגמים מאותה קטגוריה במאגר */
  function svSeries(c, cars, ti) {
    const vs = svVersions(c);
    if (vs.length > 1) return { mode: 'trims', title: 'השוואה בין הגרסאות', note: 'לפי נתוני היצרן', pts: vs.map((t, i) => ({ l: t.name, m: specOf(c, t), sel: i === ti })) };
    const peers = (cars || []).filter(x => x.category && x.category === c.category);
    if (peers.length > 1) return { mode: 'peers', title: 'מול המתחרים', note: 'באותה קטגוריה במאגר', pts: peers.map(x => ({ l: x.model, m: x === c || x.slug === c.slug ? specOf(c, vs[0]) : x, sel: x === c || x.slug === c.slug })) };
    return null;
  }
  function svMetrics(se) { return SV_METRICS.filter(mt => se.pts.filter(p => mt.get(p.m) != null).length >= 2); }
  function svChartHTML(se, mk) {
    const ms = svMetrics(se); if (!ms.length) return '';
    const mt = ms.find(x => x.k === mk) || ms[0];
    let pts = se.pts.map(p => ({ l: p.l, v: mt.get(p.m), sel: p.sel })).filter(p => p.v != null);
    if (se.mode === 'peers') { pts.sort((a, b) => a.v - b.v); if (pts.length > 7) { const si = pts.findIndex(p => p.sel); const s = Math.max(0, Math.min(pts.length - 7, si - 3)); pts = pts.slice(s, s + 7); } }
    const W = 600, H = 300, pr = 52, pl = 22, pt = 24, pb = 40, pw = W - pr - pl, ph = H - pt - pb;
    const vals = pts.map(p => p.v); let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    const span = (hi - lo) || hi * .2 || 1; lo = Math.max(0, lo - span * .35); hi = hi + span * .35;
    const st = Math.pow(10, Math.floor(Math.log10((hi - lo) / 4))); const step = Math.ceil((hi - lo) / 4 / st) * st; lo = Math.floor(lo / step) * step; hi = lo + step * 4;
    const X = i => pts.length === 1 ? W - pr - pw / 2 : W - pr - 24 - i * (pw - 48) / (pts.length - 1);
    const Y = v => pt + ph - (v - lo) / (hi - lo) * ph;
    const dec = mt.k === 'acc' ? 1 : 0, f = v => dec ? v.toFixed(1) : fmt(Math.round(v));
    let g = '';
    for (let k = 0; k <= 4; k++) { const v = lo + step * k, y = Y(v); g += '<line x1="' + pl + '" x2="' + (W - pr + 6) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" class="sv-grid"/><text x="' + (W - pr + 14) + '" y="' + (y + 4).toFixed(1) + '" class="sv-yl">' + f(v) + '</text>'; }
    const line = pts.map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join(' ');
    const area = line + ' L' + X(pts.length - 1).toFixed(1) + ' ' + (pt + ph) + ' L' + X(0).toFixed(1) + ' ' + (pt + ph) + ' Z';
    const si = Math.max(0, pts.findIndex(p => p.sel));
    const xl = pts.map((p, i) => '<span class="sv-xl' + (p.sel ? ' is-sel' : '') + '" style="left:' + (X(i) / W * 100).toFixed(2) + '%">' + esc(p.l) + '</span>').join('');
    const dots = pts.map((p, i) => '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(p.v).toFixed(1) + '" r="5" class="sv-dot' + (p.sel ? ' is-sel' : '') + '"/>').join('');
    const hits = pts.map((p, i) => '<button type="button" class="sv-hit" data-sv-pt="' + i + '" ' + (se.mode === 'trims' ? 'data-sv-ver="' + se.pts.findIndex(q => q.l === p.l) + '" ' : '') + 'style="left:' + (X(i) / W * 100).toFixed(2) + '%" aria-label="' + esc(p.l + ': ' + f(p.v) + ' ' + mt.u) + '" data-x="' + (X(i) / W * 100).toFixed(2) + '" data-y="' + (Y(p.v) / H * 100).toFixed(2) + '" data-t="' + esc(f(p.v) + ' ' + mt.u) + '"></button>').join('');
    return '<div class="sv-tabs" role="tablist" aria-label="מדד להשוואה">' + ms.map(x => '<button type="button" role="tab" data-sv-m="' + x.k + '" aria-selected="' + (x === mt) + '">' + esc(x.t) + '</button>').join('') + '</div>' +
      '<div class="sv-cbox"><div class="sv-plot"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="svA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8001d" stop-opacity=".16"/><stop offset="1" stop-color="#e8001d" stop-opacity="0"/></linearGradient></defs>' + g +
        '<path d="' + area + '" class="sv-area"/><path d="' + line + '" class="sv-line" pathLength="1"/>' +
        '<line class="sv-vline" x1="' + X(si).toFixed(1) + '" x2="' + X(si).toFixed(1) + '" y1="' + (pt - 6) + '" y2="' + (pt + ph) + '"/>' + dots + '</svg>' +
        '<span class="sv-tip cx-num' + (X(si) / W > .6 ? ' is-flip' : '') + '" style="left:' + (X(si) / W * 100).toFixed(2) + '%;top:' + (Y(pts[si].v) / H * 100).toFixed(2) + '%">' + esc(f(pts[si].v) + ' ' + mt.u) + '</span>' + hits +
        '<div class="sv-xls">' + xl + '</div></div></div>';
  }
  function specsView(c, ctx) {
    const vs = svVersions(c), ti = Math.min(ctx.ti || 0, vs.length - 1), m = specOf(c, vs[ti]);
    const bn = brandName(c.brand), url = '/car/' + encodeURIComponent(c.slug || c.id) + '/';
    const imgs = images(c), p = price(m.price) || price(c.price);
    const rs = svRings(m, ctx.cars);
    const se = svSeries(c, ctx.cars, ti);
    const chart = se ? svChartHTML(se, ctx.metric) : '';
    const sub = [vs[ti] && vs[ti].name, m.engine].filter(Boolean).join(' · ');
    return '<div class="sv" id="sv">' +
      '<div class="sv-top">' +
        '<div class="sv-gal">' +
          '<nav class="sv-crumb" aria-label="מיקום"><a href="/cars-list.html" aria-label="מאגר הרכבים">' + SVI.home + '</a><span>/</span><a href="/cars-list.html?brand=' + encodeURIComponent(String(c.brand || '').toLowerCase()) + '">' + esc(bn) + '</a><span>/</span><a href="' + url + '" data-view="">' + mix(c.model) + '</a>' + (vs[ti] ? '<span>/</span><b id="sv-pill">' + mix(vs[ti].name) + '</b>' : '') + '</nav>' +
          '<div class="sv-media is-init" id="sv-media">' + frame(imgs[0] || null, bn + ' ' + c.model, true) + '</div>' +
          '<ul class="sv-facts" id="sv-facts">' + svFacts(m) + '</ul>' +
          (imgs.length > 1 ? '<div class="sv-thumbs" role="list" aria-label="תמונות">' + imgs.slice(0, 6).map((im, i) => '<button type="button" role="listitem" class="sv-th' + (im.cut ? ' is-cut' : '') + '" data-sv-img="' + i + '" aria-pressed="' + (i === 0) + '" aria-label="תמונה ' + (i + 1) + '"><img src="' + esc(thumb(im.src, 200)) + '" alt="" loading="lazy"></button>').join('') + '</div>' : '') +
        '</div>' +
        '<div class="sv-info">' +
          '<h2>' + mix(bn + ' - ' + c.model) + '</h2>' +
          '<p class="sv-sub" id="sv-sub">' + mix(sub) + '</p>' +
          '<div class="sv-price" id="sv-price">' + (p ? '<b class="cx-num">' + p + '</b><small>מחיר מחירון</small>' : '<b class="sv-np">מחיר טרם פורסם</b>') + '</div>' +
          '<h3 class="sv-qh">במבט מהיר</h3>' +
          '<div class="sv-mid">' +
            (rs.length ? '<div><p class="sv-cap">ביחס לרכבים במאגר ספידומטר</p><ul class="sv-rings" id="sv-rings">' + svRingsHTML(rs) + '</ul></div>' : '') +
            (vs.length > 1 ? '<div><p class="sv-cap" id="sv-vlab">בחירת גרסה</p><div class="sv-vers" role="radiogroup" aria-labelledby="sv-vlab">' + vs.map((t, i) => { const tm = specOf(c, t), tp = price(tm.price), th = hpOf(tm); return '<label class="sv-ver"><input type="radio" name="sv-ver" value="' + i + '"' + (i === ti ? ' checked' : '') + '><span class="sv-rd" aria-hidden="true"></span><b>' + mix(t.name) + '</b><small class="cx-num">' + esc(tp || (th != null ? fmt(th) + ' כ״ס' : (driveShort(tm.drive_type) || ''))) + '</small></label>'; }).join('') + '</div></div>' : '') +
          '</div>' +
          '<button type="button" class="sv-cta" data-cmp="' + esc(c.slug || c.id) + '" aria-pressed="false">' + ICO.scale + '<span>הוספה להשוואה</span></button>' +
        '</div>' +
      '</div>' +
      '<div class="sv-bot' + (chart ? '' : ' is-solo') + '">' +
        '<div><h3 class="sv-h">מפרט טכני' + (vs[ti] ? ' <small id="sv-acc-ver">' + mix(vs[ti].name) + '</small>' : '') + '</h3><div class="sv-acc" id="sv-acc">' + svAccHTML(m, ctx.open) + '</div></div>' +
        (chart ? '<div><h3 class="sv-h">' + esc(se.title) + ' <small>(' + esc(se.note) + ')</small></h3><div class="sv-chart" id="sv-chart">' + chart + '</div></div>' : '') +
      '</div>' +
    '</div>';
  }
  function mountSpecs(el, c, ctx, onVersion) {
    const $ = s => el.querySelector(s), $$ = s => Array.from(el.querySelectorAll(s));
    const vs = svVersions(c), imgs = images(c), win = el.ownerDocument.defaultView;
    const RM = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let ii = 0;
    if (el._svAC) el._svAC.abort(); const ac = new AbortController(); el._svAC = ac; const O = { signal: ac.signal };
    requestAnimationFrame(() => requestAnimationFrame(() => { const s = $('#sv'); if (s) s.classList.add('is-on'); }));
    function openList() { return $$('.sv-sec').map((s, i) => s.classList.contains('is-open') ? +s.querySelector('[data-sv-sec]').getAttribute('data-sv-sec') : -1).filter(i => i >= 0); }
    function chart() { const se = svSeries(c, ctx.cars, ctx.ti), box = $('#sv-chart'); if (box && se) box.innerHTML = svChartHTML(se, ctx.metric); }
    function setVer(n) {
      n = Math.max(0, Math.min(vs.length - 1, n)); if (n === ctx.ti) return;
      ctx.ti = n; const m = specOf(c, vs[n]);
      const r = $('input[name="sv-ver"][value="' + n + '"]'); if (r) r.checked = true;
      const pill = $('#sv-pill'); if (pill) pill.innerHTML = '' + mix(vs[n].name) + '';
      const av = $('#sv-acc-ver'); if (av) av.innerHTML = '' + mix(vs[n].name) + '';
      $('#sv-sub').innerHTML = '' + mix([vs[n].name, m.engine].filter(Boolean).join(' · ')) + '';
      const p = price(m.price) || price(c.price); $('#sv-price').innerHTML = p ? '<b class="cx-num">' + p + '</b><small>מחיר מחירון</small>' : '<b class="sv-np">מחיר טרם פורסם</b>';
      $('#sv-facts').innerHTML = svFacts(m);
      const rs = svRings(m, ctx.cars), box = $('#sv-rings');
      if (box) {
        const same = rs.map(x => x.k).join() === $$('.sv-ring').map(x => x.getAttribute('data-ring')).join();
        if (!same) box.innerHTML = svRingsHTML(rs);
        else rs.forEach(x => { const li = box.querySelector('[data-ring="' + x.k + '"]'); li.style.setProperty('--off', (R_C * (1 - x.p)).toFixed(1)); li.querySelector('b').innerHTML = esc(x.v) + '<i>' + esc(x.u) + '</i>'; li.querySelector('small').textContent = x.s + ' · ' + Math.round(x.p * 100) + '%'; });
      }
      const acc = $('#sv-acc'), open = openList(); acc.innerHTML = svAccHTML(m, open); acc.classList.remove('flash'); void acc.offsetWidth; acc.classList.add('flash');
      chart();
      if (onVersion) onVersion(n);
    }
    el.addEventListener('change', e => { if (e.target.name === 'sv-ver') setVer(+e.target.value); }, O);
    el.addEventListener('click', e => {
      const sb = e.target.closest('[data-sv-sec]');
      if (sb) { const s = sb.closest('.sv-sec'), on = !s.classList.contains('is-open'); s.classList.toggle('is-open', on); sb.setAttribute('aria-expanded', on); return; }
      const mb = e.target.closest('[data-sv-m]');
      if (mb) { ctx.metric = mb.getAttribute('data-sv-m'); chart(); const nb = $('[data-sv-m="' + ctx.metric + '"]'); if (nb) nb.focus(); return; }
      const vb = e.target.closest('[data-sv-ver]');
      if (vb) { setVer(+vb.getAttribute('data-sv-ver')); return; }
      const tb = e.target.closest('[data-sv-img]');
      if (tb) {
        const n = +tb.getAttribute('data-sv-img'); if (n === ii) return; const dir = n > ii ? 1 : -1; ii = n;
        $$('.sv-th').forEach((b, i) => b.setAttribute('aria-pressed', i === ii));
        const box = $('#sv-media'); box.classList.remove('is-init'); const old = box.firstElementChild, tmp = el.ownerDocument.createElement('div');
        tmp.innerHTML = frame(imgs[ii], brandName(c.brand) + ' ' + c.model, true); const nu = tmp.firstElementChild;
        if (RM || !old) { box.innerHTML = ''; box.appendChild(nu); return; }
        old.classList.add(dir > 0 ? 'out-l' : 'out-r'); nu.classList.add(dir > 0 ? 'in-r' : 'in-l'); box.appendChild(nu);
        setTimeout(() => { if (old.parentNode) old.remove(); nu.classList.remove('in-r', 'in-l'); }, 650);
      }
    }, O);
    /* ריחוף על נקודה בגרף מזיז את התווית */
    el.addEventListener('pointerover', e => { const h = e.target.closest('.sv-hit'); if (!h) return; const tip = $('.sv-tip'), vl = $('.sv-vline'); if (!tip) return; tip.style.left = h.getAttribute('data-x') + '%'; tip.classList.toggle('is-flip', +h.getAttribute('data-x') > 60); tip.style.top = h.getAttribute('data-y') + '%'; tip.textContent = h.getAttribute('data-t'); if (vl) { const x = (+h.getAttribute('data-x')) * 6; vl.setAttribute('x1', x); vl.setAttribute('x2', x); } }, O);
  }

  /* ═══════════════════════════════════════════════════════════════
     גלריית תמונות (?view=gallery) — בהשראת הדמיית NIO: כותרת במרכז, פריסה א-סימטרית
     (תמונה גבוהה + תמונה רחבה, סליידר קטן עם חצים + תמונה גבוהה), עד 20 תמונות, לייטבוקס,
     ובסוף "דגמים נוספים" — קרוסלה עם שם הדגם באותיות ענק מאחורי הרכב וארבעה נתונים.
     אין כיתובים מומצאים לתמונות: רק שם הדגם ומספר התמונה.
  ═══════════════════════════════════════════════════════════════ */
  const GV_MAX = 20;
  const pad2 = n => (n < 10 ? '0' : '') + n;
  function gvImg(im, i, full, cls, eager) {
    return '<button type="button" class="gv-tile ' + (cls || '') + (im.cut ? ' is-cut' : '') + '" data-lb="' + i + '" aria-label="הגדלת תמונה ' + (i + 1) + '">' +
      '<img src="' + esc(thumb(im.src, cls === 'gv-tall' ? 900 : 1400)) + '" alt="' + esc(full) + ' — תמונה ' + (i + 1) + '"' + (eager ? '' : ' loading="lazy"') + ' decoding="async">' +
      '<span class="gv-zoom" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg></span></button>';
  }
  function gvCap(full, from, to, total) {
    return '<div class="gv-cap"><b>' + mix(full) + '</b><small class="cx-num" dir="ltr">' + pad2(from + 1) + (to > from ? '–' + pad2(to + 1) : '') + ' / ' + pad2(total) + '</small></div>';
  }
  function gvSlider(list, start, full) {
    return '<div class="gv-slider" data-gv-slider>' +
      '<div class="gv-track">' + list.map((im, k) => gvImg(im, start + k, full, 'gv-wide gv-slide')).join('') + '</div>' +
      '<button type="button" class="gv-arr gv-arr-prev" data-gv-step="-1" aria-label="התמונה הקודמת"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>' +
      '<button type="button" class="gv-arr gv-arr-next" data-gv-step="1" aria-label="התמונה הבאה"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>' +
      '<span class="gv-dots" aria-hidden="true">' + list.map((_, k) => '<i' + (k ? '' : ' class="on"') + '></i>').join('') + '</span></div>';
  }
  function gvGrid(imgs, full) {
    const n = imgs.length; let i = 0, type = 0, out = '';
    while (i < n) {
      const rem = n - i;
      if (type === 0 && rem >= 2) {
        out += '<div class="gv-row gv-row-a gv-rv">' + gvImg(imgs[i], i, full, 'gv-tall', i === 0) +
          '<div class="gv-side">' + gvImg(imgs[i + 1], i + 1, full, 'gv-wide', i === 0) + gvCap(full, i, i + 1, n) + '</div></div>';
        i += 2;
      } else if (type === 1 && rem >= 3) {
        const k = Math.min(3, rem - 1);
        out += '<div class="gv-row gv-row-b gv-rv"><div class="gv-side">' + gvCap(full, i, i + k - 1, n) + gvSlider(imgs.slice(i, i + k), i, full) + '</div>' +
          gvImg(imgs[i + k], i + k, full, 'gv-tall') + '</div>';
        i += k + 1;
      } else if (rem === 1) {
        out += '<div class="gv-row gv-row-c gv-rv">' + gvImg(imgs[i], i, full, 'gv-wide', i === 0) + '</div>'; i += 1;
      } else if (type === 1) { type = 0; continue; }
      else { out += '<div class="gv-row gv-row-d gv-rv">' + imgs.slice(i).map((im, k) => gvImg(im, i + k, full, 'gv-wide')).join('') + '</div>'; i = n; }
      type = 1 - type;
    }
    return out;
  }
  /* דגמים נוספים: קודם אותו מותג, ואם אין — אותה קטגוריה במאגר */
  function gvOthers(c, cars) {
    const S = root.SPCars, bk = x => S && S.brandKey ? S.brandKey(x.brand) : String(x.brand || '').toLowerCase();
    const me = c.slug || c.id, list = (cars || []).filter(x => (x.slug || x.id) !== me);
    let same = list.filter(x => bk(x) === bk(c)), kind = 'brand';
    if (!same.length) { same = list.filter(x => x.category && x.category === c.category); kind = 'cat'; }
    return { kind, list: same.slice(0, 12) };
  }
  function gvStats(x) {
    const ts = trimsOf(x), m = ts.length ? specOf(x, ts[0]) : x, pt = powertrain(m), out = [];
    if (num(m.range_ev) && (pt === 'ev' || pt === 'erev' || pt === 'phev')) out.push(['טווח חשמלי', fmt(m.range_ev) + ' ק״מ']);
    if (hpOf(m) != null) out.push(['הספק', fmt(hpOf(m)) + ' כ״ס']);
    if (num(m.top_speed)) out.push(['מהירות מרבית', fmt(m.top_speed) + ' קמ״ש']);
    if (num(m.acceleration_0_100)) out.push(['0-100 קמ״ש', m.acceleration_0_100 + ' שנ׳']);
    if (num(m.battery_capacity_kwh) && out.length < 4) out.push(['סוללה', m.battery_capacity_kwh + ' קוט״ש']);
    if (out.length < 4 && pt) out.push(['מנוע', PT[pt] + (liters(m) ? ' ' + liters(m) : '')]);
    return out.slice(0, 4);
  }
  function gvSlideHTML(x, k) {
    const im = images(x)[0] || null, bn = brandName(x.brand), url = '/car/' + encodeURIComponent(x.slug || x.id) + '/', p = price(x.price);
    return '<article class="gv-car' + (k === 0 ? ' is-on' : '') + '" data-gv-car="' + k + '" data-pt="' + esc(powertrain(x) || '') + '"' + (k === 0 ? '' : ' hidden') + '>' +
      '<span class="gv-ghost" aria-hidden="true" dir="auto" style="--n:' + Math.max(6, String(x.model).length) + '">' + esc(x.model) + '</span>' +
      '<a class="gv-car-img" href="' + url + '" aria-label="' + esc(bn + ' ' + x.model) + ' — לעמוד הדגם">' + frame(im, bn + ' ' + x.model, false) + '</a>' +
      '<div class="gv-car-meta"><h3><a href="' + url + '">' + mix(bn + ' ' + x.model) + '</a></h3>' + (p ? '<small>החל מ-<b class="cx-num">' + p + '</b></small>' : '') + '</div>' +
      '<dl class="gv-stats">' + gvStats(x).map(s => '<div><dt>' + esc(s[0]) + '</dt><dd class="cx-num">' + esc(s[1]) + '</dd></div>').join('') + '</dl></article>';
  }
  function galleryView(c, ctx) {
    const bn = brandName(c.brand), full = bn + ' ' + c.model, all = images(c), imgs = all.slice(0, GV_MAX);
    const o = gvOthers(c, ctx.cars);
    const pts = []; o.list.forEach(x => { const p = powertrain(x); if (p && pts.indexOf(p) === -1) pts.push(p); });
    return '<div class="gv" id="gv">' +
      '<header class="gv-head gv-rv"><h2>גלריית התמונות של ' + mix(full) + '</h2>' +
        (imgs.length ? '<p class="cx-num">' + imgs.length + ' תמונות · לחיצה על תמונה לתצוגה מלאה</p>' : '') + '</header>' +
      (imgs.length ? '<div class="gv-grid">' + gvGrid(imgs, full) + '</div>'
        : '<div class="cp-empty">' + LINE_CAR + '<p>התמונות של הדגם יעלו בקרוב.</p></div>') +
      (o.list.length ? '<section class="gv-more gv-rv" aria-label="דגמים נוספים">' +
        '<div class="gv-more-head"><h2>' + (o.kind === 'brand' ? 'דגמים נוספים של ' + mix(bn) + '' : 'דגמים נוספים מאותה קטגוריה') + '</h2>' +
          '<p>' + (o.kind === 'brand' ? 'כל הדגמים של ' + esc(bn) + ' במאגר ספידומטר — עם מפרט, מחירים ותמונות.' : 'דגמים נוספים מקטגוריית ' + esc(c.category) + ' במאגר ספידומטר.') + '</p>' +
          '<a class="gv-all" href="' + (o.kind === 'brand' ? '/cars-list.html?brand=' + encodeURIComponent(String(c.brand || '').toLowerCase()) : '/cars-list.html?view=all') + '">' + (o.kind === 'brand' ? 'לכל הדגמים' : 'לכל הרכבים') + '<span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></span></a></div>' +
        (pts.length > 1 ? '<div class="gv-tabs" role="tablist" aria-label="סינון לפי סוג הנעה"><button type="button" role="tab" data-gv-pt="" aria-selected="true">הכל</button>' + pts.map(p => '<button type="button" role="tab" data-gv-pt="' + p + '" aria-selected="false">' + esc(PT[p]) + '</button>').join('') + '</div>' : '') +
        '<div class="gv-stage">' + o.list.map(gvSlideHTML).join('') +
          (o.list.length > 1 ? '<button type="button" class="gv-sarr gv-sarr-prev" data-gv-car-step="-1" aria-label="הדגם הקודם"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button><button type="button" class="gv-sarr gv-sarr-next" data-gv-car-step="1" aria-label="הדגם הבא"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>' : '') +
        '</div></section>' : '') +
    '</div>';
  }
  function mountGallery(el, c) {
    const $ = s => el.querySelector(s), $$ = s => Array.from(el.querySelectorAll(s)), win = el.ownerDocument.defaultView;
    const RM = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (el._gvAC) el._gvAC.abort(); const ac = new AbortController(); el._gvAC = ac; const O = { signal: ac.signal };
    /* חשיפה בגלילה */
    const rv = $$('.gv-rv');
    if (RM || !('IntersectionObserver' in win)) rv.forEach(r => r.classList.add('in'));
    else { const io = new win.IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: .08 }); rv.forEach(r => io.observe(r)); ac.signal.addEventListener('abort', () => io.disconnect()); }
    /* סליידרים קטנים */
    function slide(sl, dir) {
      const tr = sl.querySelector('.gv-track'), n = tr.children.length, w = tr.clientWidth;
      const cur = Math.round(Math.abs(tr.scrollLeft) / w), next = (cur + dir + n) % n;
      tr.scrollTo({ left: (getComputedStyle(tr).direction === 'rtl' ? -1 : 1) * next * w, behavior: RM ? 'auto' : 'smooth' });
    }
    $$('[data-gv-slider]').forEach(sl => {
      const tr = sl.querySelector('.gv-track'), dots = Array.from(sl.querySelectorAll('.gv-dots i'));
      tr.addEventListener('scroll', () => { const k = Math.round(Math.abs(tr.scrollLeft) / tr.clientWidth); dots.forEach((d, j) => d.classList.toggle('on', j === k)); }, Object.assign({ passive: true }, O));
    });
    /* קרוסלת הדגמים */
    let cur = 0;
    const cars = () => $$('.gv-car').filter(a => !a.classList.contains('is-out'));
    function show(n, dir) {
      const list = cars(); if (!list.length) return;
      n = (n + list.length) % list.length;
      const old = $('.gv-car.is-on'), nu = list[n]; if (old === nu) return;
      cur = n;
      if (old) { old.classList.remove('is-on', 'from-l', 'from-r'); old.hidden = true; }
      nu.hidden = false; nu.classList.remove('from-l', 'from-r'); void nu.offsetWidth;
      if (!RM) nu.classList.add(dir < 0 ? 'from-l' : 'from-r');
      nu.classList.add('is-on');
      const arrs = $$('.gv-sarr'); arrs.forEach(a => { a.hidden = list.length < 2; });
    }
    el.addEventListener('click', e => {
      const st = e.target.closest('[data-gv-step]'); if (st) { slide(st.closest('[data-gv-slider]'), +st.getAttribute('data-gv-step')); return; }
      const cs = e.target.closest('[data-gv-car-step]'); if (cs) { const d = +cs.getAttribute('data-gv-car-step'); show(cur + d, d); return; }
      const tb = e.target.closest('[data-gv-pt]');
      if (tb) {
        const pt = tb.getAttribute('data-gv-pt');
        $$('[data-gv-pt]').forEach(b => b.setAttribute('aria-selected', b === tb));
        $$('.gv-car').forEach(a => a.classList.toggle('is-out', !!pt && a.getAttribute('data-pt') !== pt));
        const on = $('.gv-car.is-on'); if (on) { on.classList.remove('is-on'); on.hidden = true; }
        cur = -1; const list = cars(); if (list.length) { cur = 0; list[0].hidden = false; void list[0].offsetWidth; list[0].classList.add('is-on', 'from-r'); }
        $$('.gv-sarr').forEach(a => { a.hidden = list.length < 2; });
      }
    }, O);
    /* החלקה בקרוסלה */
    const stage = $('.gv-stage');
    if (stage) { let x0 = null; stage.addEventListener('pointerdown', e => { x0 = e.clientX; }, O); stage.addEventListener('pointerup', e => { if (x0 == null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 50) { const d = dx < 0 ? 1 : -1; show(cur + d, d); } }, O); }
  }

  /* ═══════════════════════════════════════════════════════════════
     אבזור (?view=equipment) — בהשראת הדמיית NIO ET7: הרכב ללא רקע במרכז, ממנו יוצאים קווים
     לכרטיסי האבזור הבולט (עם תמונה), שורת תמונות + 4 נתונים, כרטיס טעינה וסקירה, ומתחת
     כל רשימת האבזור מהמפרט לפי קבוצות וחבילות. נתונים: equipment / highlights (מהחילוץ + אדמין).
     אין המצאה: פריט בולט בלי תמונה מוצג עם סמל, ורשימה ריקה לא מוצגת.
  ═══════════════════════════════════════════════════════════════ */
  const EQ_ICONS = {
    ext: '<path d="M3 15l2-5.5A3 3 0 0 1 7.8 7.5h8.4a3 3 0 0 1 2.8 2L21 15v3a1 1 0 0 1-1 1h-1.5a1 1 0 0 1-1-1v-1h-11v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M5 12h14M7 15h1M16 15h1"/>',
    int: '<path d="M7 20v-4a2 2 0 0 1 2-2h7"/><path d="M9 14l-1.6-7.4A2 2 0 0 1 9.4 4h.2a2 2 0 0 1 1.9 1.4L13 10h3a2 2 0 0 1 2 2v2"/><path d="M18 20v-3"/>',
    media: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
    comfort: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    safe: '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    light: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    star: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'
  };
  const eqIco = k => '<svg viewBox="0 0 24 24" aria-hidden="true">' + (EQ_ICONS[k] || EQ_ICONS.star) + '</svg>';
  function eqKind(t) {
    t = String(t || '');
    if (/בטיחות|safety|עזר לנהג/i.test(t)) return 'safe';
    if (/מולטימדיה|חווית משתמש|מסך|multimedia|infotainment/i.test(t)) return 'media';
    if (/פנים|פנימי|interior|מושב/i.test(t)) return 'int';
    if (/חוץ|חיצוני|exterior/i.test(t)) return 'ext';
    if (/תאורה|light/i.test(t)) return 'light';
    if (/נוחות|comfort|אבזור/i.test(t)) return 'comfort';
    return 'star';
  }
  /* קבוצות האבזור — מ-equipment, ואם אין: features / safety_features / notable_features של הגרסאות */
  function eqData(c) {
    const e = c.equipment && typeof c.equipment === 'object' ? c.equipment : {};
    let groups = (Array.isArray(e.groups) ? e.groups : []).filter(g => g && g.title && g.items && g.items.length);
    let packages = (Array.isArray(e.packages) ? e.packages : []).filter(p => p && p.name && p.items && p.items.length);
    if (!groups.length) {
      groups = [];
      if (Array.isArray(c.features) && c.features.length) groups.push({ title: 'נוחות ומולטימדיה', items: c.features });
      if (Array.isArray(c.safety_features) && c.safety_features.length) groups.push({ title: 'בטיחות ומערכות עזר', items: c.safety_features });
    }
    if (!packages.length) packages = trimsOf(c).filter(t => Array.isArray(t.notable_features) && t.notable_features.length).map(t => ({ name: t.name, items: t.notable_features }));
    const hl = (Array.isArray(c.highlights) ? c.highlights : []).filter(h => h && h.title).slice(0, 6);
    return { base: e.base_name || null, groups, packages, hl };
  }
  const COLOR_MAP = [[/לבן|white|פנינה|pearl/i, '#f4f4f2'], [/שחור|black|obsidian/i, '#16181b'], [/כסו?ף|silver/i, '#c3c7cc'], [/אפור|grey|gray|גרפיט|graphite|titan/i, '#7b8188'],
    [/כחול|blue|navy/i, '#1f3b6b'], [/אדום|red/i, '#a3121f'], [/ירוק|green/i, '#2f5a40'], [/חום|brown|bronze|ברונזה/i, '#6a4a34'], [/בז|beige|sand|חול/i, '#d6c6a6'],
    [/זהב|gold/i, '#b39556'], [/כתום|orange/i, '#d5621f'], [/צהוב|yellow/i, '#e1bf2c'], [/סגול|purple/i, '#563a75'], [/טורקיז|turquoise|teal/i, '#1f7f7a']];
  function swatch(name) { const hit = COLOR_MAP.find(m => m[0].test(name)); return hit ? hit[1] : null; }
  /* "2 שעות" / "1:30 שעות" / "28 דק'" / "10%-80% ב-28 דק'" → דקות (או null) */
  function toMinutes(t) {
    t = String(t || ''); let m = 0, ok = false;
    const hm = t.match(/(\d+):(\d{2})/); if (hm) return +hm[1] * 60 + +hm[2];
    const h = t.match(/(\d+(?:\.\d+)?)\s*(שעות|שעה|ש['׳]|h\b|hours?)/i); if (h) { m += parseFloat(h[1]) * 60; ok = true; }
    const d = t.match(/(\d+)\s*(דקות|דק['׳]?|min)/i); if (d) { m += +d[1]; ok = true; }
    return ok ? m : null;
  }
  function eqCharge(c) {
    const vs = trimsOf(c).length ? trimsOf(c).map(t => specOf(c, t)) : [c];
    const m = vs.find(x => x.charge_ac_time || x.charge_dc_time) || vs.find(x => num(x.battery_capacity_kwh)); if (!m) return null;
    const rows = [];
    if (m.charge_dc_time) rows.push({ t: 'טעינה מהירה DC' + (num(m.charge_dc_kw) ? ' עד ' + fmt(m.charge_dc_kw) + ' קו״ט' : ''), v: m.charge_dc_time, min: toMinutes(m.charge_dc_time) });
    if (m.charge_ac_time) rows.push({ t: 'טעינה ביתית AC' + (num(m.charge_ac_kw) ? ' עד ' + fmt(m.charge_ac_kw) + ' קו״ט' : ''), v: m.charge_ac_time, min: toMinutes(m.charge_ac_time) });
    if (!rows.length) return null;
    const mx = Math.max.apply(null, rows.map(r => r.min || 0)) || 1;
    rows.forEach(r => { r.p = r.min ? Math.max(.08, r.min / mx) : null; });
    return { kwh: num(m.battery_capacity_kwh), name: m._trim && trimsOf(c).length > 1 ? m._trim.name : null, rows };
  }
  const EQ_SLOTS = [ // מיקום כרטיס (אחוזים מהבמה) + נקודת עגינה על הרכב
    { x: 81, y: 31, ax: 76, ay: 66 }, { x: 5, y: 9, ax: 44, ay: 14 }, { x: 3, y: 57, ax: 18, ay: 64 }, { x: 80, y: 68, ax: 54, ay: 93 }
  ];
  function equipmentView(c, ctx) {
    const bn = brandName(c.brand), full = bn + ' ' + c.model, d = eqData(c), imgs = images(c).slice(0, 5);
    const colors = (Array.isArray(c.colors) ? c.colors : []).slice(0, 10);
    const ch = eqCharge(c), stats = gvStats(c), sub = [c.category, c.year, d.base ? 'רמת אבזור ' + d.base : null].filter(Boolean).join(' · ');
    const hero = d.hl.slice(0, 4), rest = d.hl.slice(4);
    const card = (h, i, cls) => '<figure class="eq-call ' + (cls || '') + '" data-call="' + i + '"' + (cls ? '' : ' style="--x:' + EQ_SLOTS[i].x + '%;--y:' + EQ_SLOTS[i].y + '%"') + '>' +
      '<figcaption><span class="eq-n cx-num">' + (i + 1) + '</span><span>' + mix(h.title) + '</span></figcaption>' +
      (h.image ? '<span class="eq-call-img"><img src="' + esc(thumb(h.image, 520)) + '" alt="' + esc(h.title) + '" loading="lazy"></span>' : '<span class="eq-call-img is-ico">' + eqIco(eqKind(h.title)) + '</span>') + '</figure>';
    const tabs = d.groups.map((g, i) => ({ id: 'g' + i, t: g.title, items: g.items, k: eqKind(g.title), pkg: false }))
      .concat(d.packages.map((p, i) => ({ id: 'p' + i, t: p.name, items: p.items, k: 'plus', pkg: true })));
    return '<div class="eq" id="eq">' +
      '<section class="eq-hero" aria-label="אבזור בולט">' +
        '<div class="eq-id"><h2><small>' + mix(bn) + '</small>' + mix(c.model) + '</h2>' + (sub ? '<p>' + esc(sub) + '</p>' : '') +
          (colors.length ? '<ul class="eq-colors" aria-label="צבעים">' + colors.map(n => { const s = swatch(n); return '<li title="' + esc(n) + '"><span' + (s ? ' style="--sw:' + s + '"' : ' class="is-unknown"') + '></span><em>' + esc(n) + '</em></li>'; }).join('') + '</ul>' : '') + '</div>' +
        '<span class="eq-ghost" aria-hidden="true" dir="auto" style="--n:' + Math.max(6, String(c.model).length) + '">' + esc(c.model) + '</span>' +
        '<div class="eq-stage"><div class="eq-floor" aria-hidden="true"></div><div class="eq-car" id="eq-car">' + frame(imgs[0] || null, full, true) + '</div>' +
          hero.map((h, i) => '<span class="eq-dot" data-dot="' + i + '" style="--ax:' + EQ_SLOTS[i].ax + '%;--ay:' + EQ_SLOTS[i].ay + '%"><i class="cx-num">' + (i + 1) + '</i></span>').join('') + '</div>' +
        (imgs.length > 1 ? '<div class="eq-spin"><button type="button" data-eq-img="-1" aria-label="התמונה הקודמת"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button><span class="cx-num" id="eq-imgn" dir="ltr">1 / ' + imgs.length + '</span><button type="button" data-eq-img="1" aria-label="התמונה הבאה"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button></div>' : '') +
        (hero.length ? '<svg class="eq-lines" aria-hidden="true"></svg><div class="eq-calls">' + hero.map((h, i) => card(h, i)).join('') + '</div>' : '') +
      '</section>' +
      '<div class="eq-strip">' +
        (imgs.length > 1 ? '<div class="eq-thumbs" role="list" aria-label="תמונות">' + imgs.map((im, i) => '<button type="button" role="listitem" class="eq-th' + (im.cut ? ' is-cut' : '') + '" data-eq-th="' + i + '" aria-pressed="' + (i === 0) + '" aria-label="תמונה ' + (i + 1) + '"><img src="' + esc(thumb(im.src, 240)) + '" alt="" loading="lazy"></button>').join('') + '</div>' : '<div></div>') +
        (stats.length ? '<dl class="gv-stats eq-stats">' + stats.map(s => '<div><dt>' + esc(s[0]) + '</dt><dd class="cx-num">' + esc(s[1]) + '</dd></div>').join('') + '</dl>' : '') +
      '</div>' +
      (ch || c.description || rest.length ? '<div class="eq-cards' + (ch && c.description ? '' : ' is-one') + '">' +
        (ch ? '<section class="eq-card eq-charge"><h3>' + (ch.kwh ? 'טעינת סוללה ' + esc(fmt(ch.kwh)) + ' קוט״ש' : 'זמני טעינה') + (ch.name ? ' <small>' + mix(ch.name) + '</small>' : '') + '</h3>' +
          ch.rows.map(r => '<div class="eq-bar"><span>' + esc(r.t) + '</span><div class="eq-bar-row"><i' + (r.p ? ' style="--p:' + r.p.toFixed(3) + '"' : ' class="is-na"') + '></i><b class="cx-num">' + esc(r.v) + '</b></div></div>').join('') +
          '<p class="eq-note">לפי נתוני היצרן. זמן הטעינה בפועל תלוי בעמדה, בטמפרטורה ובמצב הסוללה.</p></section>' : '') +
        (c.description ? '<section class="eq-card eq-over"><h3>סקירה</h3><p>' + esc(c.description) + '</p></section>' : '') +
      '</div>' : '') +
      (rest.length ? '<div class="eq-more-calls">' + rest.map((h, i) => card(h, i + 4, 'is-flat')).join('') + '</div>' : '') +
      (tabs.length ? '<section class="eq-all" aria-labelledby="eq-all-h"><header><h2 id="eq-all-h">האבזור המלא</h2><p>לפי מפרט היבואן' + (d.base ? ' · רמת אבזור בסיסית ' + mix(d.base) + '' : '') + '</p></header>' +
        '<div class="eq-tabs" role="tablist" aria-label="קבוצות אבזור">' + tabs.map((t, i) => '<button type="button" role="tab" id="eq-tab-' + t.id + '" aria-controls="eq-panel" aria-selected="' + (i === 0) + '" data-eq-tab="' + i + '" class="' + (t.pkg ? 'is-pkg' : '') + '">' +
          '<span class="eq-tab-ico">' + eqIco(t.k) + '</span><b>' + (t.pkg ? 'תוספות: ' : '') + '' + mix(t.t) + '</b><small class="cx-num">' + t.items.length + ' פריטים</small></button>').join('') + '</div>' +
        '<div class="eq-panel" id="eq-panel" role="tabpanel">' + tabs.map((t, i) => '<ul class="eq-list" data-eq-list="' + i + '"' + (i ? ' hidden' : '') + '>' + t.items.map(x => '<li>' + eqIco('check') + '<span>' + mix(x) + '</span></li>').join('') + '</ul>').join('') + '</div></section>'
        : '<div class="cp-empty"><p>רשימת האבזור תתווסף בקרוב.</p></div>') +
    '</div>';
  }
  function mountEquipment(el, c) {
    const $ = s => el.querySelector(s), $$ = s => Array.from(el.querySelectorAll(s)), win = el.ownerDocument.defaultView, doc = el.ownerDocument;
    const RM = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (el._eqAC) el._eqAC.abort(); const ac = new AbortController(); el._eqAC = ac; const O = { signal: ac.signal };
    const imgs = images(c).slice(0, 5), full = brandName(c.brand) + ' ' + c.model; let ii = 0;
    /* קווים מהכרטיסים לנקודות על הרכב — מחושבים מהמיקום האמיתי, מתעדכנים בשינוי גודל */
    function draw() {
      const hero = $('.eq-hero'), svg = $('.eq-lines'); if (!hero || !svg) return;
      if (win.matchMedia('(max-width: 900px)').matches) { svg.innerHTML = ''; return; }
      const hr = hero.getBoundingClientRect(); svg.setAttribute('viewBox', '0 0 ' + hr.width + ' ' + hr.height);
      let out = '';
      $$('.eq-call:not(.is-flat)').forEach(cd => {
        const i = cd.getAttribute('data-call'), dot = $('[data-dot="' + i + '"]'); if (!dot) return;
        const cr = cd.getBoundingClientRect(), dr = dot.getBoundingClientRect();
        const dx = dr.left + dr.width / 2 - hr.left, dy = dr.top + dr.height / 2 - hr.top;
        const right = cr.left + cr.width / 2 - hr.left > dx; // הכרטיס מימין לנקודה
        const sx = right ? cr.left - hr.left : cr.right - hr.left, sy = cr.top - hr.top + Math.min(cr.height / 2, 40);
        const ex = dx + (right ? 6 : -6);
        out += '<path class="eq-ln' + (drawn ? ' is-static' : '') + '" data-ln="' + i + '" d="M' + sx.toFixed(1) + ' ' + sy.toFixed(1) + ' H' + (sx + (right ? -26 : 26)).toFixed(1) + ' L' + ex.toFixed(1) + ' ' + dy.toFixed(1) + '"/>';
      });
      svg.innerHTML = out;
      Array.from(svg.querySelectorAll('path')).forEach(pt => { const L = pt.getTotalLength ? pt.getTotalLength() : 600; pt.style.setProperty('--len', L.toFixed(1)); });
    }
    let drawn = false;
    draw(); win.addEventListener('resize', draw, O);
    setTimeout(() => { drawn = true; }, 2200);
    $$('.eq-call img, .eq-car img').forEach(im => { if (!im.complete) im.addEventListener('load', draw, Object.assign({ once: true }, O)); });
    requestAnimationFrame(() => requestAnimationFrame(() => { const e = $('#eq'); if (e) e.classList.add('is-on'); }));
    /* הדגשה משותפת: כרטיס ↔ נקודה ↔ קו */
    function hi(i, on) { [$('[data-call="' + i + '"]'), $('[data-dot="' + i + '"]'), $('[data-ln="' + i + '"]')].forEach(n => n && n.classList.toggle('is-hi', on)); }
    el.addEventListener('pointerover', e => { const t = e.target.closest('[data-call],[data-dot]'); if (t) hi(t.getAttribute('data-call') || t.getAttribute('data-dot'), true); }, O);
    el.addEventListener('pointerout', e => { const t = e.target.closest('[data-call],[data-dot]'); if (t) hi(t.getAttribute('data-call') || t.getAttribute('data-dot'), false); }, O);
    function setImg(n) {
      if (imgs.length < 2) return; n = (n + imgs.length) % imgs.length; if (n === ii) return;
      const dir = n > ii ? 1 : -1; ii = n;
      $$('.eq-th').forEach((b, k) => b.setAttribute('aria-pressed', k === ii));
      const nEl = $('#eq-imgn'); if (nEl) nEl.textContent = (ii + 1) + ' / ' + imgs.length;
      const box = $('#eq-car'), old = box.firstElementChild, tmp = doc.createElement('div'); tmp.innerHTML = frame(imgs[ii], full, true); const nu = tmp.firstElementChild;
      if (RM || !old) { box.innerHTML = ''; box.appendChild(nu); return; }
      old.classList.add(dir > 0 ? 'out-l' : 'out-r'); nu.classList.add(dir > 0 ? 'in-r' : 'in-l'); box.appendChild(nu);
      setTimeout(() => { if (old.parentNode) old.remove(); nu.classList.remove('in-r', 'in-l'); }, 650);
      /* נקודות העגינה מתאימות רק לתמונת הצד של הרכב — בתמונות אחרות מוסתרות */
      el.querySelector('.eq-hero').classList.toggle('is-alt', ii !== 0);
    }
    el.addEventListener('click', e => {
      const s = e.target.closest('[data-eq-img]'); if (s) { setImg(ii + +s.getAttribute('data-eq-img')); return; }
      const t = e.target.closest('[data-eq-th]'); if (t) { setImg(+t.getAttribute('data-eq-th')); return; }
      const tb = e.target.closest('[data-eq-tab]');
      if (tb) {
        const i = tb.getAttribute('data-eq-tab');
        $$('[data-eq-tab]').forEach(b => b.setAttribute('aria-selected', b === tb));
        $$('[data-eq-list]').forEach(l => { const on = l.getAttribute('data-eq-list') === i; l.hidden = !on; if (on && !RM) { l.classList.remove('in'); void l.offsetWidth; l.classList.add('in'); } });
      }
    }, O);
    const tl = $('.eq-tabs');
    if (tl) tl.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const bs = $$('[data-eq-tab]'), k = bs.indexOf(doc.activeElement); if (k < 0) return;
      const n = (k + (e.key === 'ArrowLeft' ? 1 : -1) + bs.length) % bs.length; bs[n].focus(); bs[n].click(); e.preventDefault();
    }, O);
  }

  /* ═══════════════════════════════════════════════════════════════
     חוות דעת (?view=review) — טבלת car_reviews (נכתבת מהאדמין: טיוטה / פרסום).
     הציבור מקבל רק את העותק המפורסם. המבנה: שאלה + סיכום + ציון כללי, מה אהבנו / מה פחות,
     התרשמות לפי תחומים (ציון + משפט), למי מתאים, פסק הדין של ספידומטר, וקישורים להמשך.
     תחום בלי ציון לא מוצג; בלי חוות דעת מפורסמת — מוצגים יתרונות/חסרונות קיימים או הודעה.
  ═══════════════════════════════════════════════════════════════ */
  const RV_CATS = [
    { k: 'comfort', t: 'נוחות נסיעה', i: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 14.5V21M9.6 11.3L3.6 9.5M14.4 11.3l6-1.8"/>' },
    { k: 'performance', t: 'ביצועים', i: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/><path d="M6.3 11.3l1 .8M12 7.5V9M17.7 11.3l-1 .8"/>' },
    { k: 'consumption', t: 'צריכת דלק', te: 'צריכת חשמל', i: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 11h10"/><path d="M14 8h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V9l-3-3"/>' },
    { k: 'cabin', t: 'איכות תא הנוסעים', i: '<path d="M7 20v-4a2 2 0 0 1 2-2h7"/><path d="M9 14l-1.6-7.4A2 2 0 0 1 9.4 4h.2a2 2 0 0 1 1.9 1.4L13 10h3a2 2 0 0 1 2 2v2"/><path d="M18 20v-3"/>' },
    { k: 'equipment', t: 'אבזור וטכנולוגיה', i: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>' },
    { k: 'safety', t: 'בטיחות', i: '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>' },
    { k: 'usability', t: 'מרווח ושימושיות', i: '<rect x="4" y="7" width="16" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M9 11v5M15 11v5"/>' },
    { k: 'value', t: 'תמורה למחיר', i: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 10v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4M5 14v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4"/>' }
  ];
  const rvIco = (p, cls) => '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + p + '</svg>';
  const RVI = {
    ok: '<circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6.5"/>',
    no: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>',
    flag: '<path d="M5 21V4M5 4h13l-2.5 4L18 12H5"/><path d="M8 4v8M11 4v8M14 4v8M5 8h12" stroke-width="1"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1"/><circle cx="17" cy="9" r="2.4"/><path d="M16.5 14H18a4 4 0 0 1 4 4v1"/>',
    bars: '<path d="M5 20V12M10 20V7M15 20v-5M20 20V4"/>',
    car: '<path d="M3 15l2-5.5A3 3 0 0 1 7.8 7.5h8.4a3 3 0 0 1 2.8 2L21 15v3a1 1 0 0 1-1 1h-1.5a1 1 0 0 1-1-1v-1h-11v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M5 12h14"/>',
    scale: '<path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>',
    play: '<rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor" stroke="none"/>',
    arrow: '<path d="M15 18l-6-6 6-6"/>'
  };
  const sc1 = v => { const n = num(v); return n == null ? null : Math.max(0, Math.min(10, n)); };
  const scTxt = n => n.toFixed(1);
  function ytId(u) { const m = String(u || '').match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/); return m ? m[1] : null; }
  function reviewView(c, ctx) {
    const bn = brandName(c.brand), full = bn + ' ' + c.model, url = '/car/' + encodeURIComponent(c.slug || c.id) + '/';
    const rvRow = ctx.review || null, r = rvRow && rvRow.published ? rvRow.published : null;
    if (ctx.loading) return '<div class="rv"><div class="rv-load" aria-busy="true"><span></span><span></span><span></span></div></div>';
    const list = a => (Array.isArray(a) ? a : []).map(x => String(x || '').trim()).filter(Boolean);
    const pros = list(r ? r.pros : c.pros), cons = list(r ? r.cons : c.cons);
    const score = sc1(r && r.score != null ? r.score : c.score);
    const ev = powertrain(c) === 'ev';
    const cats = r && r.cats ? RV_CATS.map(d => { const x = r.cats[d.k] || {}; const s = sc1(x.s); return s == null ? null : Object.assign({}, d, { s, txt: String(x.t || '').trim(), title: ev && d.te ? d.te : d.t }); }).filter(Boolean) : [];
    const fitY = list(r && r.fit_yes), fitN = list(r && r.fit_no), verdict = r && String(r.verdict || '').trim(), summary = r && String(r.summary || '').trim();
    const imgs = images(c), photos = imgs.filter(x => !x.cut);
    const imgCats = (r && r.img_cats) || (photos[1] || photos[0] || {}).src || null, imgFit = (r && r.img_fit) || (photos[0] || {}).src || null;
    const yt = (r && r.youtube) || c.youtube_video_url || null, vid = ytId(yt);
    const q = (r && String(r.title || '').trim()) || 'אז איך ה-' + c.model + ' באמת?';
    const date = rvRow && rvRow.published_at ? new Date(rvRow.published_at) : null;
    const by = (rvRow && rvRow.author) || (r && r.author) || null;
    const C = 2 * Math.PI * 44;
    const ring = score == null ? '' : '<div class="rv-score" style="--off:' + (C * (1 - score / 10)).toFixed(1) + ';--len:' + C.toFixed(1) + '" aria-label="ציון ספידומטר ' + scTxt(score) + ' מתוך 10"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" class="rv-score-bg"/><circle cx="50" cy="50" r="44" class="rv-score-arc"/></svg><b class="cx-num" dir="ltr">' + scTxt(score) + '<i>/10</i></b><small>ציון ספידומטר</small></div>';
    const has = !!(r || pros.length || cons.length);
    if (!has) return '<div class="rv"><div class="rv-empty rv-in">' + rvIco(RVI.flag, 'rv-ei') + '<h2>חוות הדעת של ספידומטר על ה-' + mix(c.model) + ' בדרך</h2><p>בינתיים אפשר לעבור על המפרט המלא, על האבזור ועל התמונות.</p>' +
      '<div class="rv-empty-links"><a href="' + url + '?view=specs" data-view="specs">למפרט הטכני המלא</a><a href="' + url + '?view=equipment" data-view="equipment">לאבזור</a><a href="' + url + '?view=gallery" data-view="gallery">לגלריה</a></div></div></div>';
    const li = (arr, k) => arr.map(x => '<li>' + rvIco(k === 'ok' ? RVI.ok : RVI.no, 'rv-li-' + k) + '<span>' + mix(x) + '</span></li>').join('');
    return '<div class="rv" id="rv">' +
      /* 1. השאלה · מה אהבנו · מה פחות */
      '<section class="rv-top">' +
        '<article class="rv-card rv-q rv-in"><header><h2>' + mix(q) + '</h2>' + ring + '</header>' +
          (summary ? '<p class="rv-sum">' + esc(summary) + '</p>' : '') +
          (by || date ? '<p class="rv-by">' + (by ? 'נכתב ע״י <b>' + esc(by) + '</b>' : '') + (by && date ? ' · ' : '') + (date ? '<time datetime="' + date.toISOString() + '">' + date.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' }) + '</time>' : '') + '</p>' : '') + '</article>' +
        (pros.length ? '<article class="rv-card rv-pros rv-in"><h3>' + rvIco(RVI.ok, 'rv-h-ico') + 'מה אהבנו</h3><ul>' + li(pros, 'ok') + '</ul></article>' : '') +
        (cons.length ? '<article class="rv-card rv-cons rv-in"><h3>' + rvIco(RVI.no, 'rv-h-ico') + 'מה פחות אהבנו</h3><ul>' + li(cons, 'no') + '</ul></article>' : '') +
      '</section>' +
      /* 2. התרשמות לפי תחומים */
      (cats.length ? '<section class="rv-cats rv-in" aria-labelledby="rv-cats-h"><h3 id="rv-cats-h">' + rvIco(RVI.bars, 'rv-h-ico') + 'התרשמות לפי תחומים</h3>' +
        '<div class="rv-cats-grid' + (imgCats ? '' : ' no-img') + '">' +
          (imgCats ? '<figure class="rv-cats-img"><img src="' + esc(thumb(imgCats, 900)) + '" alt="' + esc(full) + '" loading="lazy"></figure>' : '') +
          '<div class="rv-cats-tiles">' + cats.map((x, i) => '<div class="rv-cat" style="--i:' + i + ';--p:' + (x.s / 10).toFixed(2) + '">' + rvIco(x.i, 'rv-cat-ico') + '<h4>' + esc(x.title) + '</h4>' + (x.txt ? '<p>' + esc(x.txt) + '</p>' : '') +
            '<div class="rv-cat-s"><b class="cx-num" dir="ltr">' + scTxt(x.s) + '<i>/10</i></b><span class="rv-cat-bar"><i></i></span></div></div>').join('') + '</div>' +
        '</div></section>' : '') +
      /* 3. פסק הדין · למי מתאים */
      (verdict || fitY.length || fitN.length ? '<section class="rv-mid' + (verdict && (fitY.length || fitN.length) ? '' : ' is-one') + '">' +
        (verdict ? '<article class="rv-verdict rv-in"><h3>' + rvIco(RVI.flag, 'rv-h-ico') + 'השורה התחתונה של ספידומטר</h3><p>' + esc(verdict) + '</p>' +
          '<a class="rv-btn rv-btn-red" href="' + url + '?view=specs" data-view="specs">' + rvIco(RVI.car) + '<span>לקריאת המפרט המלא</span>' + rvIco(RVI.arrow, 'rv-arr') + '</a></article>' : '') +
        (fitY.length || fitN.length ? '<article class="rv-card rv-fit rv-in"><div class="rv-fit-txt"><h3>' + rvIco(RVI.users, 'rv-h-ico') + '<span>למי ה-' + mix(c.model) + ' מתאים?</span></h3><ul>' + li(fitY, 'ok') + li(fitN, 'no') + '</ul></div>' +
          (imgFit ? '<figure class="rv-fit-img"><img src="' + esc(thumb(imgFit, 800)) + '" alt="' + esc(full) + '" loading="lazy"></figure>' : '') + '</article>' : '') +
      '</section>' : '') +
      /* 4. קישורים להמשך */
      '<nav class="rv-links rv-in" aria-label="להמשך">' +
        '<button type="button" class="rv-btn rv-btn-red" data-cmp="' + esc(c.slug || c.id) + '" aria-pressed="false">' + rvIco(RVI.car) + '<span>להשוואה בין רכבים</span>' + rvIco(RVI.arrow, 'rv-arr') + '</button>' +
        '<button type="button" class="rv-link" data-rv-rivals>' + rvIco(RVI.scale) + '<span>השווה את ה-' + mix(c.model) + ' למתחרים</span></button>' +
        (vid ? '<a class="rv-link" href="https://www.youtube.com/watch?v=' + vid + '" target="_blank" rel="noopener">' + rvIco(RVI.play, 'rv-yt') + '<span>צפו במבחן הווידאו של ' + mix(full) + '</span></a>' : '') +
        '<a class="rv-link" href="' + url + '?view=specs" data-view="specs">' + rvIco(RVI.bars) + '<span>מפרט טכני מלא</span></a>' +
      '</nav>' +
    '</div>';
  }
  function mountReview(el, c, cars) {
    const win = el.ownerDocument.defaultView, RM = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (el._rvAC) el._rvAC.abort(); const ac = new AbortController(); el._rvAC = ac; const O = { signal: ac.signal };
    const els = Array.from(el.querySelectorAll('.rv-in'));
    if (RM || !('IntersectionObserver' in win)) els.forEach(x => x.classList.add('on'));
    else { const io = new win.IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('on'); io.unobserve(e.target); } }), { threshold: .12 }); els.forEach(x => io.observe(x)); ac.signal.addEventListener('abort', () => io.disconnect()); }
    /* "השווה למתחרים": פותח את מסך ההשוואה עם הדגם + עד 3 דגמים מאותה קטגוריה במאגר */
    el.addEventListener('click', e => {
      if (!e.target.closest('[data-rv-rivals]')) return;
      const S = root.SPCars; if (!S || !S.openCompare) return;
      const me = c.slug || c.id, p0 = num(c.price);
      const others = (cars || []).filter(x => (x.slug || x.id) !== me);
      const near = (a, b) => p0 ? Math.abs((num(a.price) || 1e9) - p0) - Math.abs((num(b.price) || 1e9) - p0) : 0;
      /* קודם אותה קטגוריה, ואם אין מספיק — הקרובים במחיר (עדיפות לאותו סוג הנעה) */
      let peers = others.filter(x => x.category && x.category === c.category).sort(near);
      if (peers.length < 3) peers = peers.concat(others.filter(x => peers.indexOf(x) === -1).sort((a, b) => ((powertrain(b) === powertrain(c)) - (powertrain(a) === powertrain(c))) || near(a, b)));
      S.openCompare([me].concat(peers.slice(0, 3).map(x => x.slug || x.id)));
    }, O);
  }

  function viewHTML(id, c, ctx) {
    const bn = brandName(c.brand), full = bn + ' ' + c.model, trims = trimsOf(c);
    const head = (t, s) => '<div class="cp-vhead"><div class="cx-wrap"><button type="button" class="cp-back" data-view="">' + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>' + 'חזרה ל-' + mix(full) + '</button><h2>' + esc(t) + '</h2>' + (s ? '<p>' + esc(s) + '</p>' : '') + '</div></div>';
    const list = (arr, cls) => (arr && arr.length) ? '<ul class="' + (cls || 'cp-list') + '">' + arr.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '';
    if (id === 'specs') return specsView(c, ctx || {});
    if (id === 'gallery') return galleryView(c, ctx || {});
    if (id === 'equipment') return equipmentView(c, ctx || {});
    if (id === 'review') return reviewView(c, ctx || {});
    return '';
  }

  /* ═══ mount — אינטראקציה (דפדפן בלבד) ═══ */
  function mount(rootEl, c, opts) {
    opts = opts || {};
    const doc = rootEl.ownerDocument, win = doc.defaultView;
    const RM = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const $ = s => rootEl.querySelector(s), $$ = s => Array.from(rootEl.querySelectorAll(s));
    const trims = trimsOf(c), imgs = images(c);
    let ti = 0, ii = 0;
    let reviewCache;
    const bn = brandName(c.brand), full = bn + ' ' + c.model;

    /* כניסה */
    requestAnimationFrame(() => rootEl.querySelector('.cp').classList.add('is-in'));

    /* הכותרת הגדולה מתכווצת כדי להיכנס לרוחב הבמה */
    function fitTitle() {
      const t = $('.cp-title'), st = $('.cp-stage'), inner = $('.cp-title-in'); if (!t || !st || !inner) return;
      t.style.setProperty('--fit', 1);
      const max = st.clientWidth * 0.92, w = inner.getBoundingClientRect().width;
      if (w > max) t.style.setProperty('--fit', (max / w).toFixed(3));
    }
    fitTitle(); win.addEventListener('resize', fitTitle);
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(fitTitle);
    /* פס רמות הגימור: הפעיל במרכז, הקו העליון זז אליו */
    const track = $('.cp-trims'), bar = $('.cp-trim-bar');
    function placeTrims(animate) {
      const act = $('.cp-trim[aria-selected="true"]'); if (!act) return;
      const wrap = $('.cp-trims-wrap'), w = wrap.clientWidth;
      const center = act.offsetLeft + act.offsetWidth / 2;
      track.style.transition = animate && !RM ? '' : 'none';
      track.style.transform = 'translateX(' + Math.round(w / 2 - center) + 'px)';
      bar.style.left = (act.offsetLeft + act.offsetWidth / 2 - bar.offsetWidth / 2) + 'px';
      if (!animate) { void track.offsetWidth; track.style.transition = ''; }
    }
    placeTrims(false); win.addEventListener('resize', () => placeTrims(false));

    /* מחיר — ספירה */
    function countTo(el, to) {
      if (!el || to == null) return;
      const from = Number(String(el.textContent).replace(/[^\d]/g, '')) || to;
      if (RM || from === to) { el.textContent = '₪' + fmt(to); return; }
      const t0 = performance.now(), D = 700;
      (function step(t) { const k = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - k, 3); el.textContent = '₪' + fmt(Math.round(from + (to - from) * e)); if (k < 1) requestAnimationFrame(step); })(t0);
    }
    function setTrim(n) {
      if (!trims.length) return;
      n = (n + trims.length) % trims.length; if (n === ti) return;
      const dir = n > ti ? 1 : -1; ti = n;
      $$('.cp-trim').forEach((b, i) => b.setAttribute('aria-selected', i === ti));
      placeTrims(true);
      const m = merged(c, trims[ti]);
      const tt = $('.cp-title-trim'); tt.classList.remove('swap'); void tt.offsetWidth; tt.innerHTML = '' + mix(trims[ti].name) + ''; tt.classList.add('swap'); fitTitle();
      const pe = $('#cp-price'); countTo(pe, num(m.price) || num(c.price));
      /* ששת הנתונים מתגלגלים */
      const next = sixSpecs(m);
      $$('.cp-spec').forEach((el, i) => {
        const s = next[i], v = el.querySelector('.cp-spec-v'), dt = el.querySelector('dt');
        if (dt && dt.textContent !== s.label) dt.textContent = s.label;
        el.classList.toggle('is-long', specLong(s));
        const html = s.v != null && s.v !== '' ? '<b class="cx-num">' + esc(s.v) + '</b>' + (s.u ? '<i>' + esc(s.u) + '</i>' : '') : '<b class="cp-na">—</b>';
        if (v.innerHTML === html) return;
        el.classList.remove('roll'); void el.offsetWidth; el.style.setProperty('--d', dir); el.classList.add('roll');
        setTimeout(() => { v.innerHTML = html; }, RM ? 0 : 160 + i * 40);
      });
      /* הרכב נוסע קצת לכיוון החדש */
      const car = $('#cp-car'); car.classList.remove('nudge', 'nudge-r'); void car.offsetWidth; car.classList.add(dir > 0 ? 'nudge' : 'nudge-r');
    }
    $$('.cp-trim').forEach(b => b.addEventListener('click', () => setTrim(+b.getAttribute('data-trim'))));
    const nx = $('[data-trim-next]'); if (nx) nx.addEventListener('click', () => setTrim(ti + 1));
    if (track) track.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') { e.preventDefault(); setTrim(ti + 1); $$('.cp-trim')[ti].focus(); } if (e.key === 'ArrowRight') { e.preventDefault(); setTrim(ti - 1); $$('.cp-trim')[ti].focus(); } });

    /* פס התמונות: לחיצה מחליפה את התמונה במרכז בהנפשה לצד */
    function setImg(n) {
      if (!imgs.length) return;
      n = (n + imgs.length) % imgs.length; if (n === ii) return;
      const dir = n > ii ? 1 : -1; ii = n;
      $$('.cp-thumb').forEach((b, i) => b.setAttribute('aria-pressed', i === ii));
      const car = $('#cp-car'), old = car.firstElementChild;
      const tmp = doc.createElement('div'); tmp.innerHTML = frame(imgs[ii], full, true); const nu = tmp.firstElementChild;
      if (RM || !old) { car.innerHTML = ''; car.appendChild(nu); return; }
      old.classList.add(dir > 0 ? 'out-l' : 'out-r');
      nu.classList.add(dir > 0 ? 'in-r' : 'in-l');
      car.appendChild(nu);
      setTimeout(() => { if (old.parentNode) old.remove(); nu.classList.remove('in-r', 'in-l'); }, 650);
      const th = $$('.cp-thumb')[ii]; if (th) th.scrollIntoView({ block: 'nearest', inline: 'center', behavior: RM ? 'auto' : 'smooth' });
    }
    $$('.cp-thumb').forEach(b => b.addEventListener('click', () => setImg(+b.getAttribute('data-img'))));
    /* החלקה על הרכב במובייל */
    let x0 = null; const carEl = $('#cp-car');
    carEl.addEventListener('pointerdown', e => { x0 = e.clientX; });
    carEl.addEventListener('pointerup', e => { if (x0 == null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 45 && imgs.length > 1) setImg(ii + (dx < 0 ? 1 : -1)); });
    /* הטיה עדינה של הרכב עם העכבר */
    const stage = $('.cp-stage');
    if (!RM) stage.addEventListener('pointermove', e => { if (e.pointerType !== 'mouse') return; const r = stage.getBoundingClientRect(), mx = (e.clientX - r.left) / r.width - .5; carEl.style.translate = (mx * -14).toFixed(1) + 'px 0'; $('.cp-title').style.translate = (mx * 18).toFixed(1) + 'px 0'; });

    /* שיתוף */
    const sh = $('[data-share]');
    if (sh) sh.addEventListener('click', () => {
      const u = sh.getAttribute('data-share');
      if (navigator.share) navigator.share({ title: doc.title, url: u }).catch(() => {});
      else if (navigator.clipboard) navigator.clipboard.writeText(u).then(() => root.SPCars && root.SPCars.toast('הקישור הועתק'), () => win.prompt('העתיקו את הקישור:', u));
      else win.prompt('העתיקו את הקישור:', u);
    });

    /* עמודי המשנה: ?view=specs|gallery|equipment|review */
    const viewEl = $('#cp-view');
    function showView(id, push) {
      const valid = VIEWS.some(v => v.id === id);
      if (push) { const u = new URL(location.href); if (valid) u.searchParams.set('view', id); else u.searchParams.delete('view'); history.pushState({ view: id }, '', u.pathname + u.search); }
      $$('.cp-nav a').forEach(a => { const on = a.getAttribute('data-view') === (valid ? id : ''); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
      rootEl.querySelector('.cp').classList.toggle('is-view', valid);
      if (!valid) { viewEl.hidden = true; viewEl.innerHTML = ''; doc.title = doc.title.replace(/^[^|]+\| /, ''); placeTrims(false); return; }
      const sctx = { ti: ti, cars: opts.cars || [], metric: null, open: null };
      viewEl.innerHTML = viewHTML(id, c, sctx); viewEl.hidden = false;
      if (id === 'specs') mountSpecs(viewEl, c, sctx, n => setTrim(n));
      if (id === 'gallery') mountGallery(viewEl, c);
      if (id === 'equipment') mountEquipment(viewEl, c);
      if (id === 'review') {
        if (reviewCache !== undefined || !opts.loadReview) { sctx.review = reviewCache || null; viewEl.innerHTML = viewHTML(id, c, sctx); mountReview(viewEl, c, sctx.cars); }
        else {
          sctx.loading = true; viewEl.innerHTML = viewHTML(id, c, sctx);
          Promise.resolve(opts.loadReview(c.id)).catch(() => null).then(r => {
            reviewCache = r || null;
            if (new URLSearchParams(location.search).get('view') !== 'review') return;
            const ctx2 = { ti: ti, cars: sctx.cars, review: reviewCache }; viewEl.innerHTML = viewHTML('review', c, ctx2); mountReview(viewEl, c, ctx2.cars);
            if (root.SPCars && root.SPCars.Compare) root.SPCars.Compare.sync();
          });
        }
      }
      if (root.SPCars && root.SPCars.Compare) root.SPCars.Compare.sync();
      viewEl.classList.remove('enter'); void viewEl.offsetWidth; viewEl.classList.add('enter');
      const lbl = VIEWS.find(v => v.id === id).label;
      if (doc.title.indexOf(' | ') === -1 || !/^(מפרט|גלריית|אבזור|חוות)/.test(doc.title)) doc.title = lbl + ' | ' + doc.title;
      else doc.title = lbl + ' | ' + doc.title.replace(/^[^|]+\| /, '');
      win.scrollTo({ top: 0, behavior: 'auto' });
    }
    rootEl.addEventListener('click', e => {
      const v = e.target.closest('[data-view]'); if (!v || e.metaKey || e.ctrlKey) return;
      e.preventDefault(); showView(v.getAttribute('data-view'), true);
    });
    win.addEventListener('popstate', () => showView(new URLSearchParams(location.search).get('view') || '', false));
    const initial = new URLSearchParams(location.search).get('view'); if (initial) showView(initial, false);

    /* לייטבוקס לגלריה */
    rootEl.addEventListener('click', e => {
      const it = e.target.closest('[data-lb]'); if (!it) return;
      openLightbox(+it.getAttribute('data-lb'));
    });
    function openLightbox(i) {
      const imgs = images(c).slice(0, GV_MAX);
      let k = i; const lb = doc.createElement('div'); lb.className = 'cp-lb'; lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true'); lb.setAttribute('aria-label', 'גלריית תמונות');
      const draw = () => { lb.querySelector('.cp-lb-img').innerHTML = '<img src="' + esc(thumb(imgs[k].src, 2000)) + '" alt="' + esc(full) + '">'; lb.querySelector('.cp-lb-n').textContent = (k + 1) + ' / ' + imgs.length; lb.querySelector('.cp-lb-n').dir = 'ltr'; };
      lb.innerHTML = '<button type="button" class="cp-lb-x" aria-label="סגירה">✕</button><button type="button" class="cp-lb-prev" aria-label="הקודמת">' + ICO.next + '</button><div class="cp-lb-img"></div><button type="button" class="cp-lb-next" aria-label="הבאה">' + ICO.next + '</button><span class="cp-lb-n"></span>';
      doc.body.appendChild(lb); doc.documentElement.style.overflow = 'hidden'; draw();
      const close = () => { lb.remove(); doc.documentElement.style.overflow = ''; doc.removeEventListener('keydown', key); };
      const key = e => { if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') { k = (k + 1) % imgs.length; draw(); } if (e.key === 'ArrowRight') { k = (k - 1 + imgs.length) % imgs.length; draw(); } };
      lb.querySelector('.cp-lb-x').onclick = close;
      lb.querySelector('.cp-lb-next').onclick = () => { k = (k + 1) % imgs.length; draw(); };
      lb.querySelector('.cp-lb-prev').onclick = () => { k = (k - 1 + imgs.length) % imgs.length; draw(); };
      lb.addEventListener('click', e => { if (e.target === lb) close(); });
      doc.addEventListener('keydown', key); lb.querySelector('.cp-lb-x').focus();
    }
  }

  const api = { render, viewHTML, mount, specOf, SPEC_SECTIONS, sixSpecs, trimsOf, merged, images };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SPCarPage = api;
})(typeof window !== 'undefined' ? window : this);
