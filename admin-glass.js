/* admin-glass.js — SPEEDOMETER-GLASS 2026-11-15c
   שכבת הממשק "זכוכית יום" לפאנל הניהול. לא מחליפה שום לוגיקה קיימת:
   היא עוטפת את מה שכבר קיים (לשוניות, כפתורים, העלאות, קריאות לפונקציות)
   ומוסיפה מעליו: מסך כניסה, לוגו, ניווט תחתון, פאנל צף, "אי חי" עם אחוזי
   התקדמות, התקדמות על הכפתור שנלחץ, אייקונים במקום אימוג'ים וחיפוש פעולה.
   נטען רק כשנכנסים לניהול. אם משהו כאן נכשל, הפאנל ממשיך לעבוד בעיצוב הקודם. */
(function () {
  'use strict';
  if (window.__spGlass) return;
  window.__spGlass = true;

  var page = document.getElementById('admin-page');
  if (!page) return;
  var cssReady = false;
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ─── אייקונים ───
  var P = {
    news: '<path d="M4 5h13v14H6a2 2 0 0 1-2-2z"/><path d="M17 9h3v8a2 2 0 0 1-2 2"/><path d="M7.5 9h6M7.5 12.5h6M7.5 16h3.5"/>',
    docs: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    car: '<path d="M4 13l1.8-5a2 2 0 0 1 1.9-1.3h8.6A2 2 0 0 1 18.2 8L20 13v5h-2.5v-2h-11v2H4z"/><path d="M7.5 13.5h.01M16.5 13.5h.01"/>',
    ads: '<path d="M4 10v4h3l6 4V6l-6 4z"/><path d="M16.5 9a4 4 0 0 1 0 6"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    refresh: '<path d="M20 12a8 8 0 0 1-13.7 5.7"/><path d="M4 12A8 8 0 0 1 17.7 6.3"/><path d="M18 3v4h-4M6 21v-4h4"/>',
    shield: '<path d="M12 3l7 3v5.5c0 4.4-3 7.7-7 9.5-4-1.8-7-5.1-7-9.5V6z"/><path d="M9 12l2.2 2.2L15.2 10"/>',
    flame: '<path d="M12 3c1 3.5 5 5.2 5 10a5 5 0 0 1-10 0c0-2 1-3.2 2-4.2.3 1.6 1 2.4 1.8 2.6C10.5 8.8 11 6 12 3z"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.5h.01"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    upload: '<path d="M12 16V5M7.5 9.5L12 5l4.5 4.5"/><path d="M5 19h14"/>',
    more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
    chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 3M16 6h3a3 3 0 0 1-3 3M12 13v4M8.5 20h7"/>',
    bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
    star: '<path d="M12 4l2.4 5 5.4.7-4 3.8 1 5.4L12 16.3 7.2 18.9l1-5.4-4-3.8 5.4-.7z"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c3 3.2 3 13.8 0 17M12 3.5c-3 3.2-3 13.8 0 17"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    box: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>',
    image: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 15l4.5-4 4 3.5 3-2.5L20 15"/><circle cx="9" cy="9.5" r="1.2"/>',
    video: '<rect x="4" y="6" width="12" height="12" rx="2"/><path d="M16 10.5l4-2.5v8l-4-2.5"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 16.5h.01"/>',
    coin: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M14.5 9.5c-.6-.7-1.5-1-2.5-1-1.4 0-2.5.7-2.5 1.8 0 2.4 5 1.2 5 3.5 0 1-1.1 1.8-2.5 1.8-1.1 0-2.1-.4-2.7-1.2"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    tag: '<path d="M4 4h7l9 9-7 7-9-9z"/><path d="M8 8h.01"/>',
    cut: '<circle cx="6.5" cy="7" r="2.5"/><circle cx="6.5" cy="17" r="2.5"/><path d="M8.5 8.5L20 18M8.5 15.5L20 6"/>',
    spark: '<path d="M12 4l1.6 4.9L18.5 10.5l-4.9 1.6L12 17l-1.6-4.9L5.5 10.5l4.9-1.6z"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12h.01"/>',
    bulb: '<path d="M9 17h6M10 20h4M7.5 11a4.5 4.5 0 1 1 9 0c0 1.8-1 2.7-1.6 3.6H9.1C8.5 13.7 7.5 12.8 7.5 11z"/>',
    home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
    out: '<path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9"/>',
    dot: '<circle cx="12" cy="12" r="5"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>'
  };
  function svg(name, cls) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"' + (cls ? ' class="' + cls + '"' : '') + '>' + (P[name] || P.dot) + '</svg>';
  }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function isOpen() { return page.style.display === 'block'; }
  function safeGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* גלישה פרטית */ } }

  // ─── טעינת העיצוב ───
  (function loadCss() {
    if (document.getElementById('sp-glass-css')) return;
    var l = document.createElement('link');
    l.id = 'sp-glass-css'; l.rel = 'stylesheet'; l.href = '/admin-glass.css?v=20261115c';
    l.onload = function () { cssReady = true; page.classList.add('sp-glass'); onShow(); };
    l.onerror = function () { console.warn('[sp-glass] admin-glass.css לא נטען — נשארים בעיצוב הקודם'); };
    document.head.appendChild(l);
  })();

  // ═══ אימוג'ים → אייקונים ═══
  var EMO = {
    '🚗': 'car', '📰': 'news', '✅': 'check', '✓': 'check', '📊': 'chart', '🏆': 'trophy', '⚡': 'bolt', '📦': 'box',
    '⭐': 'star', '★': 'star', '☆': 'star', '🛣': 'target', '🎨': 'image', '💻': 'box', '🛋': 'box', '💰': 'coin', '❓': 'help',
    '🎬': 'video', '👁': 'eye', '✕': 'x', '❌': 'x', '⛔': 'x', '🔄': 'refresh', '🔁': 'refresh', '🌍': 'globe', '🔥': 'flame',
    '🕐': 'clock', '📤': 'upload', '⬆': 'upload', '⚠': 'warn', '🔍': 'search', '🔎': 'search', '🟢': 'dot', '🟠': 'dot',
    '🎯': 'target', '✍': 'pen', '📝': 'pen', '✏': 'pen', '💡': 'bulb', '✂': 'cut', '➕': 'plus', '✨': 'spark', '✦': 'spark',
    '💾': 'save', '📄': 'docs', '📋': 'docs', '📥': 'upload', '🗑': 'x', '🔗': 'tag', '📷': 'image', '📸': 'image', '⏳': 'clock', '🔧': 'cut', '📈': 'chart', '🏷': 'tag', '🖼': 'image', '🚀': 'bolt', '📎': 'tag', '🧩': 'box', '👍': 'check', '🆕': 'spark'
  };
  var EMO_RE = new RegExp('(🇮🇱|' + Object.keys(EMO).join('|') + ')\\ufe0f?', 'u');
  var EMO_RE_G = new RegExp(EMO_RE.source, 'gu');
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1 };
  function swapText(node) {
    var t = node.nodeValue;
    if (!t || !EMO_RE.test(t)) return;
    var par = node.parentNode;
    if (!par || SKIP[par.nodeName] || (par.closest && par.closest('[contenteditable],[contenteditable="true"],.sp-noswap'))) return;
    if (par.nodeName === 'OPTION') { node.nodeValue = t.replace(EMO_RE_G, '').replace(/^\s+/, ''); return; }
    var frag = document.createDocumentFragment(), last = 0, m;
    EMO_RE_G.lastIndex = 0;
    while ((m = EMO_RE_G.exec(t)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(t.slice(last, m.index)));
      if (m[1] === '🇮🇱') { var c = el('span', 'sp-chip-il'); c.textContent = 'IL'; frag.appendChild(c); }
      else { var s = el('span', 'sp-ic', svg(EMO[m[1]])); s.setAttribute('aria-hidden', 'true'); frag.appendChild(s); }
      last = m.index + m[0].length;
    }
    if (last < t.length) frag.appendChild(document.createTextNode(t.slice(last)));
    par.replaceChild(frag, node);
  }
  function swapIn(root) {
    if (!root) return;
    if (root.nodeType === 3) { swapText(root); return; }
    if (root.nodeType !== 1 || SKIP[root.nodeName]) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), list = [], n;
    while ((n = w.nextNode())) if (EMO_RE.test(n.nodeValue)) list.push(n);
    for (var i = 0; i < list.length; i++) swapText(list[i]);
  }
  var pending = [], queued = false;
  function flush() {
    queued = false;
    var batch = pending; pending = [];
    for (var i = 0; i < batch.length; i++) { try { if (batch[i].isConnected) swapIn(batch[i]); } catch (e) { /* ממשיכים */ } }
  }
  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (m.type === 'characterData') pending.push(m.target);
      for (var j = 0; j < m.addedNodes.length; j++) pending.push(m.addedNodes[j]);
    }
    if (pending.length && !queued) { queued = true; requestAnimationFrame(flush); }
  }).observe(page, { childList: true, subtree: true, characterData: true });

  // ═══ האי החי: כל פעולה שרצה ═══
  var ops = [], seq = 0, island = null, lastBtn = null, lastBtnAt = 0, lastFile = null, lastFileAt = 0;
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('button,.btn-primary,.btn-secondary,.tbl-btn') : null;
    if (b && (page.contains(b) || (b.closest && b.closest('.sp-nav,.sp-sheet')))) { lastBtn = b; lastBtnAt = Date.now(); }
  }, true);
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t && t.type === 'file' && page.contains(t)) { lastFile = t; lastFileAt = Date.now(); }
  }, true);
  function recentBtn() { return (lastBtn && Date.now() - lastBtnAt < 1500 && lastBtn.isConnected) ? lastBtn : null; }

  function renderIsland() {
    if (!island) return;
    var live = ops.filter(function (o) { return !o.gone && !(o.quiet && o.state === 'run'); });
    island.classList.toggle('on', live.length > 0);
    var html = '';
    live.slice(0, 3).forEach(function (o) {
      var st = o.state === 'run' ? 'run' : o.state;
      html += '<div class="sp-op ' + st + '"><div class="sp-op-top"><span class="sp-op-ico">' + svg(o.icon, o.spin && o.state === 'run' ? 'sp-spin' : '') + '</span>' +
        '<span class="sp-op-txt"><span class="sp-op-lab"></span><span class="sp-op-sub"></span></span>' +
        '<span class="sp-op-pct">' + (o.est && o.state === 'run' ? '~' : '') + Math.round(o.pct) + '%</span></div>' +
        '<div class="sp-liq"><i style="width:' + o.pct + '%"></i></div></div>';
    });
    if (live.length > 3) html += '<div class="sp-island-more">ועוד ' + (live.length - 3) + ' פעולות ברקע</div>';
    island.innerHTML = html;
    var labs = island.querySelectorAll('.sp-op-lab'), subs = island.querySelectorAll('.sp-op-sub');
    live.slice(0, 3).forEach(function (o, i) { labs[i].textContent = o.label; subs[i].textContent = o.sub || ''; });
  }
  function paintBtn(o) {
    // הפס שמתחת לשדה הקובץ מתעדכן תמיד, גם כשאין כפתור (בחירת קובץ אינה לחיצה על כפתור)
    if (o.bar && o.bar.isConnected) { o.bar.querySelector('i').style.width = o.pct + '%'; o.bar.parentNode.querySelector('b').textContent = Math.round(o.pct) + '%'; }
    var b = o.btn; if (!b || !b.isConnected) return;
    b.classList.add('sp-busy'); b.style.setProperty('--sp-p', String(o.pct));
    var p = b.querySelector(':scope > .sp-pct');
    if (!p) { p = el('span', 'sp-pct'); b.appendChild(p); }
    p.textContent = (o.est ? '~' : '') + Math.round(o.pct) + '%';
  }
  function opStart(cfg) {
    var claim = cfg.btn && !cfg.btn.classList.contains('sp-busy') ? cfg.btn : null; // כפתור שכבר מציג פעולה לא נלקח שוב
    var o = { id: ++seq, key: cfg.key || null, label: cfg.label, sub: cfg.sub || '', icon: cfg.icon || 'bolt', spin: !!cfg.spin, pct: 0, est: !!cfg.tau, state: 'run', btn: claim, t0: Date.now(), quiet: !cfg.loud };
    setTimeout(function () { o.quiet = false; renderIsland(); }, 350);
    if (cfg.fileInput && cfg.fileInput.isConnected) {
      var host = cfg.fileInput.closest('.form-group') || cfg.fileInput.parentNode;
      var wrap = el('div', 'sp-upbar', '<div class="sp-liq"><i></i></div><b>0%</b>');
      host.appendChild(wrap); o.bar = wrap.querySelector('.sp-liq'); o.barWrap = wrap;
    }
    if (cfg.tau) {
      o.timer = setInterval(function () {
        var t = (Date.now() - o.t0) / 1000;
        o.pct = Math.min(95, 95 * (1 - Math.exp(-t / cfg.tau)));
        if (cfg.stages) { var k = Math.min(cfg.stages.length - 1, Math.floor(o.pct / (96 / cfg.stages.length))); o.sub = cfg.stages[k]; }
        paintBtn(o); renderIsland();
      }, 250);
    }
    ops.push(o); paintBtn(o); renderIsland();
    return o;
  }
  // דיווח אמיתי מהשרת: עוצר את ההערכה לפי זמן ומציג את האחוז והשלב שהשרת כתב.
  // האחוז לא יורד אחורה גם אם דיווח מאוחר מגיע לפני מוקדם.
  function realStage(o, pct, stage) {
    if (pct == null || o.state !== 'run') return;
    if (o.timer) { clearInterval(o.timer); o.timer = null; }
    o.est = false; o.real = Math.max(o.real || 0, +pct || 0);
    opSet(o, Math.min(o.real, 99), stage || o.sub);
  }
  function opSet(o, pct, sub) { o.pct = Math.max(0, Math.min(100, pct)); if (sub != null) o.sub = sub; paintBtn(o); renderIsland(); }
  function opEnd(o, ok, msg) {
    if (o.state !== 'run') return;
    if (o.timer) clearInterval(o.timer);
    if (o.watch) clearInterval(o.watch);
    o.state = ok ? 'ok' : 'fail'; o.est = false; if (ok) o.pct = 100; o.sub = msg || (ok ? 'הושלם' : 'נכשל');
    var b = o.btn;
    if (b && b.isConnected) {
      b.style.setProperty('--sp-p', String(o.pct));
      var p = b.querySelector(':scope > .sp-pct'); if (p) p.textContent = ok ? '100%' : 'נכשל';
      b.classList.add(ok ? 'sp-done' : 'sp-fail');
      setTimeout(function () { b.classList.remove('sp-busy', 'sp-done', 'sp-fail'); b.style.removeProperty('--sp-p'); var q = b.querySelector(':scope > .sp-pct'); if (q) q.remove(); }, 1400);
    }
    if (o.barWrap) { o.barWrap.querySelector('i').style.width = o.pct + '%'; o.barWrap.querySelector('b').textContent = ok ? '100%' : 'נכשל'; setTimeout(function () { if (o.barWrap) o.barWrap.remove(); }, 2200); }
    renderIsland();
    o.quiet = false;
    setTimeout(function () { o.gone = true; ops = ops.filter(function (x) { return !x.gone; }); renderIsland(); }, ok ? 1800 : 4500);
  }
  window.spProgress = { start: opStart, set: opSet, end: opEnd };

  // כל פעולה שהכפתור מפעיל ומחזירה Promise מקבלת אחוזי התקדמות על הכפתור ובאי.
  // האחוז מוערך לפי זמן (מסומן ~) כי הפונקציות עצמן לא מדווחות שלבים;
  // העלאות קבצים וקריאות לפונקציות השרת מדווחות בנפרד, באחוזים אמיתיים או לפי שלבים.
  // פונקציה שכל עבודתה היא העלאה או קריאה לשרת לא נעטפת, כדי שלא יוצגו שתי שורות לאותה פעולה.
  var ACTIONS = {
    publishArticle: ['פרסום כתבה', 'bolt', 4, ['שומר את הכתבה', 'מעדכן את האתר']],
    loadDraftIntoForm: ['טעינת טיוטה לעריכה', 'docs', 1.5],
    discardDraft: ['מחיקת טיוטה', 'x', 1.5],
    dismissHeadline: ['דחיית כותרת', 'x', 1],
    applyDraftFix: ['החלת תיקון', 'check', 1.5],
    copyFlashToClipboard: ['העתקה לוואטסאפ', 'docs', 1],
    publishAd: ['פרסום מודעה', 'ads', 3],
    toggleAdActive: ['עדכון מודעה', 'ads', 1],
    deleteAd: ['מחיקת מודעה', 'x', 1.5],
    exportAdPdf: ['הפקת דוח PDF', 'docs', 4, ['אוסף נתונים', 'בונה את הדוח']],
    startEditAd: ['טעינת מודעה', 'ads', 1],
    createCarDraft: ['יצירת טיוטת רכב', 'car', 5, ['מעלה את גיליון המפרט', 'יוצר טיוטה']],
    fixDraftIssue: ['תיקון שדה ברכב', 'pen', 6],
    saveCarReview: ['שמירת מבחן רכב', 'save', 3],
    publishDraftDirect: ['פרסום רכב', 'car', 4, ['שומר את הרכב', 'מעדכן את המאגר']],
    discardCarDraft: ['מחיקת טיוטת רכב', 'x', 1.5],
    submitCarForm: ['שמירת רכב', 'save', 4, ['שומר את הנתונים', 'מעדכן את המאגר']],
    startCarSpecUpdate: ['עדכון מפרט רכב', 'car', 4],
    deleteExistingCar: ['מחיקת רכב', 'x', 2],
    openReviewEditor: ['פתיחת עורך מבחן', 'pen', 1.5],
    savePersonal: ['שמירת מחירון', 'save', 2],
    blRemove: ['הסרת לוגו מותג', 'x', 1.5]
  };
  function wrapActions() {
    Object.keys(ACTIONS).forEach(function (name) {
      var fn = window[name];
      if (typeof fn !== 'function' || fn.__spWrapped) return;
      var a = ACTIONS[name];
      var w = function () {
        var r = fn.apply(this, arguments);
        if (!r || typeof r.then !== 'function' || !isOpen()) return r;
        var o = opStart({ label: a[0], icon: a[1], tau: a[2], stages: a[3], btn: recentBtn() });
        r.then(function (v) { opEnd(o, v !== false); }, function () { opEnd(o, false); });
        return r;
      };
      w.__spWrapped = true;
      try { window[name] = w; } catch (e) { /* פונקציה שאי אפשר להחליף נשארת כמו שהיא */ }
    });
  }

  // מה שרץ ברקע בשרת, גם אם הופעל ממכשיר אחר או לפני רענון הדף:
  // כתבות שנכתבות ובדיקות תקינות שרצות. נבדק כל 20 שניות כשהפאנל פתוח וגלוי.
  var srv = {};
  var stageCols = true; // draft_progress/draft_stage — קיימים אחרי 03-admin-features.sql
  function colsMissing(err) { return !!err && /draft_progress|draft_stage|column/i.test(err.message || ''); }
  function pollServer() {
    var c = window.sbClient;
    if (!c || !isOpen() || document.hidden) return;
    var since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    var seen = {};
    function sync(rows, prefix, label, icon, tau, titleKey, startKey) {
      (rows || []).forEach(function (r) {
        var k = prefix + r.id; seen[k] = 1;
        if (srv[k]) { if (r.draft_progress != null) realStage(srv[k], r.draft_progress, r.draft_stage); return; }
        if (ops.some(function (o) { return o.key === k && o.state === 'run'; })) return;
        var o = opStart({ key: k, label: label + ' · ברקע', icon: icon, tau: tau, loud: true });
        o.sub = String(r[titleKey] || '').slice(0, 70);
        var started = Date.parse(r[startKey] || '') || Date.now(); o.t0 = Math.min(Date.now(), started);
        srv[k] = o;
        if (r.draft_progress != null) realStage(o, r.draft_progress, r.draft_stage);
      });
    }
    Promise.all([
      c.from('news_headlines').select('id,title,draft_started_at' + (stageCols ? ',draft_progress,draft_stage' : '')).eq('draft_status', 'writing').gte('draft_started_at', since).limit(10),
      c.from('news_drafts').select('id,headline,verify_started_at').eq('verify_status', 'checking').gte('verify_started_at', since).limit(10)
    ]).then(function (res) {
      if (res[0] && colsMissing(res[0].error) && stageCols) { stageCols = false; return; } // בסבב הבא בלי העמודות
      if (res[0] && !res[0].error) sync(res[0].data, 'h', 'כתיבת כתבה', 'pen', 32, 'title', 'draft_started_at');
      if (res[1] && !res[1].error) sync(res[1].data, 'd', 'בדיקת תקינות', 'shield', 28, 'headline', 'verify_started_at');
      Object.keys(srv).forEach(function (k) {
        if (seen[k]) return;
        var o = srv[k]; delete srv[k];
        opEnd(o, true, 'הסתיים — פתח את הרשימה לתוצאה');
      });
    }, function () { /* ננסה שוב בעוד 20 שניות */ });
  }
  setInterval(pollServer, 20000);

  // ─── קריאות לפונקציות ה-Edge: אחוז מוערך לפי זמן (מסומן ~). כתיבת כתבה עוברת לאחוז אמיתי מהשרת ברגע שהוא מדווח ───
  var FN = {
    'draft-news-article': { label: 'כתיבת כתבה', icon: 'pen', tau: 32, stages: ['מאתר את כתבת המקור', 'קורא את המקור', 'כותב את הטיוטה', 'בודק מול המקור'] },
    'fetch-car-news': { label: 'רענון מקורות', icon: 'refresh', spin: true, tau: 26, stages: ['שולף פידים', 'מתרגם ומדרג', 'מאחד כפילויות'] },
    'verify-draft-article': { label: 'בדיקת תקינות', icon: 'shield', tau: 28, stages: ['בדיקות ניסוח', 'בדיקת עובדות מול המקור', 'הצעות תיקון'] },
    'extract-car-spec': { label: 'חילוץ מפרט רכב', icon: 'car', tau: 26, stages: ['קורא את גיליון המפרט', 'מחלץ שדות'] },
    'verify-car-spec': { label: 'בדיקת מפרט מול המקור', icon: 'shield', tau: 26, stages: ['בדיקות קבועות', 'השוואה לגיליון'] },
    'notify-publish': { label: 'פרסום', icon: 'bolt', tau: 3 }
  };
  function watchBackground(name, body, o) {
    var c = window.sbClient; if (!c) return false;
    var started = Date.now();
    o.watch = setInterval(function () {
      if (Date.now() - started > 4 * 60 * 1000) { opEnd(o, false, 'לא התקבל סיום אחרי 4 דקות — בדוק ברשימה'); return; }
      var q = name === 'draft-news-article'
        ? c.from('news_headlines').select('status,draft_status,draft_error' + (stageCols ? ',draft_progress,draft_stage' : '')).eq('id', body.headline_id).maybeSingle()
        : c.from('news_drafts').select('verify_status').eq('id', body.draftId).maybeSingle();
      q.then(function (r) {
        if (r && colsMissing(r.error) && stageCols) { stageCols = false; return; }
        var d = r && r.data; if (!d || o.state !== 'run') return;
        if (name === 'draft-news-article') {
          if (d.status === 'drafted') opEnd(o, true, 'הטיוטה מוכנה');
          else if (d.draft_status === 'writing' && d.draft_progress != null) realStage(o, d.draft_progress, d.draft_stage);
          else if (d.draft_status === 'failed') opEnd(o, false, String(d.draft_error || 'הכתיבה נכשלה').slice(0, 90));
        } else {
          if (d.verify_status === 'done') opEnd(o, true, 'הבדיקה הושלמה');
          else if (d.verify_status === 'failed') opEnd(o, false, 'הבדיקה נכשלה');
        }
      }, function () { /* ננסה שוב בסבב הבא */ });
    }, name === 'draft-news-article' ? 2500 : 4000);
    return true;
  }
  var nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var m = /\/functions\/v1\/([a-z0-9-]+)/.exec(url);
    if (!m || !isOpen() || !FN[m[1]]) return nativeFetch.apply(this, arguments);
    var name = m[1], body = {};
    try { body = JSON.parse((init && typeof init.body === 'string') ? init.body : '{}') || {}; } catch (e) { body = {}; }
    var cfg = FN[name], o;
    var key = name === 'draft-news-article' && body.headline_id ? 'h' + body.headline_id : (name === 'verify-draft-article' && body.draftId ? 'd' + body.draftId : null);
    try { o = opStart({ key: key, label: cfg.label, icon: cfg.icon, spin: cfg.spin, tau: cfg.tau, stages: cfg.stages, btn: recentBtn(), loud: true }); } catch (e) { return nativeFetch.apply(this, arguments); }
    return nativeFetch.apply(this, arguments).then(function (res) {
      try {
        if (res.status === 202 && body.background === true && ((name === 'draft-news-article' && body.headline_id) || (name === 'verify-draft-article' && body.draftId))) {
          if (!watchBackground(name, body, o)) opEnd(o, true, 'נשלח לרקע');
        } else { opEnd(o, res.ok, res.ok ? null : 'שגיאה ' + res.status); }
      } catch (e) { opEnd(o, res.ok); }
      return res;
    }, function (err) { opEnd(o, false, 'אין חיבור'); throw err; });
  };

  // ─── העלאות: אחוז אמיתי. מחליפים את שליחת הקובץ ב-XHR שמדווח התקדמות; בכל כשל חוזרים לדרך המקורית ───
  var BUCKET = { 'article-images': 'העלאת תמונה לכתבה', 'speedometer-media': 'העלאת מדיה', 'car-photos': 'העלאת תמונת רכב', 'car-spec-sheets': 'העלאת גיליון מפרט', 'ad-images': 'העלאת מודעה' };
  function sizeText(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB'; }
  function xhrUpload(c, bucket, path, file, opts, o) {
    return c.auth.getSession().then(function (r) {
      var tok = r && r.data && r.data.session && r.data.session.access_token;
      if (!tok || typeof SB_URL === 'undefined' || typeof SB_KEY === 'undefined') throw new Error('no session');
      return new Promise(function (resolve, reject) {
        var x = new XMLHttpRequest();
        x.open('POST', SB_URL + '/storage/v1/object/' + bucket + '/' + String(path).replace(/^\/+/, ''));
        x.setRequestHeader('apikey', SB_KEY);
        x.setRequestHeader('Authorization', 'Bearer ' + tok);
        x.setRequestHeader('x-upsert', String(!!opts.upsert));
        x.setRequestHeader('cache-control', 'max-age=' + (opts.cacheControl || '3600'));
        x.setRequestHeader('content-type', opts.contentType || file.type || 'application/octet-stream');
        x.upload.onprogress = function (e) { if (e.lengthComputable) opSet(o, e.loaded / e.total * 100, sizeText(e.loaded) + ' מתוך ' + sizeText(e.total)); };
        x.onload = function () {
          if (x.status >= 200 && x.status < 300) {
            var j = {}; try { j = JSON.parse(x.responseText); } catch (e) { /* גוף ריק */ }
            resolve({ data: { path: String(path).replace(/^\/+/, ''), id: j.Id, fullPath: j.Key }, error: null });
          } else reject(new Error('HTTP ' + x.status));
        };
        x.onerror = function () { reject(new Error('network')); };
        x.send(file);
      });
    });
  }
  function patchStorage() {
    var c = window.sbClient;
    if (!c || !c.storage) return false;
    var proto = Object.getPrototypeOf(c.storage);
    if (!proto || proto.__spPatched || typeof proto.from !== 'function') return !!(proto && proto.__spPatched);
    var from0 = proto.from;
    proto.from = function (bucket) {
      var api = from0.apply(this, arguments);
      try {
        var up0 = api.upload.bind(api);
        api.upload = function (path, file, opts) {
          if (!isOpen() || !(typeof Blob !== 'undefined' && file instanceof Blob)) return up0(path, file, opts);
          var fi = (lastFile && Date.now() - lastFileAt < 60000) ? lastFile : null;
          var oc = fi ? (fi.getAttribute('onchange') || '') : '';
          var label = /handleImageUpload/.test(oc) ? 'העלאת תמונה ראשית' : /handleGalleryUpload/.test(oc) ? 'העלאת תמונה לגלריה'
            : /handleBodyImgUpload/.test(oc) ? 'העלאת תמונה לגוף הכתבה' : (BUCKET[bucket] || 'העלאת קובץ');
          var o = opStart({ label: label, icon: 'upload', sub: sizeText(file.size), btn: recentBtn(), fileInput: fi, loud: true });
          return xhrUpload(c, bucket, path, file, opts || {}, o).then(function (res) { opEnd(o, true, 'הועלה'); return res; }, function () {
            // הדרך המקורית של Supabase, בלי אחוזים — כדי שהעלאה לעולם לא תיכשל בגלל שכבת העיצוב
            opSet(o, Math.max(o.pct, 5), 'מעלה…');
            return up0(path, file, opts).then(function (res) { opEnd(o, !(res && res.error), res && res.error ? 'ההעלאה נכשלה' : 'הועלה'); return res; }, function (e) { opEnd(o, false, 'ההעלאה נכשלה'); throw e; });
          });
        };
      } catch (e) { /* משאירים את ה-API המקורי */ }
      return api;
    };
    proto.__spPatched = true;
    return true;
  }
  var tries = 0, pt = setInterval(function () { if (patchStorage() || ++tries > 40) clearInterval(pt); }, 500);

  // ═══════════════════════════════════════════════════════════════════════════
  // תוספות 15.11.2026 (ג): בדיקת SEO לפני פרסום, תור פרסום, בריאות המערכת,
  // התראות לטלפון. כל חלק עצמאי — אם משהו בשרת עוד לא פרוס, החלק הזה מציג
  // הסבר קצר ושאר הפאנל ממשיך לעבוד כרגיל.
  // ═══════════════════════════════════════════════════════════════════════════
  function $id(id) { return document.getElementById(id); }
  function val(id) { var n = $id(id); return n ? String(n.value || '').trim() : ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function allArticles() { try { return (typeof articles !== 'undefined' && Array.isArray(articles)) ? articles : []; } catch (e) { return []; } }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function localStamp(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  // scheduled_at נשמר כשעון מקומי ("2026-11-16T18:00"). זמן עם אזור (Z/+02:00) נקרא כמו שהוא.
  function parseSched(s) {
    s = String(s || '').trim(); if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s);
    if (m && !/(Z|[+-]\d\d:?\d\d)$/.test(s)) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    var t = Date.parse(s); return isNaN(t) ? null : new Date(t);
  }
  var DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  function whenText(d) {
    if (!d) return 'מועד לא תקין';
    var now = new Date(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var dd = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - t0) / 86400000);
    var hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    if (dd === 0) return 'היום ' + hm;
    if (dd === 1) return 'מחר ' + hm;
    if (dd > 1 && dd < 7) return 'יום ' + DAYS[d.getDay()] + ' ' + hm;
    return d.getDate() + '.' + (d.getMonth() + 1) + ' ' + hm;
  }

  // ─── 1. בדיקת SEO חיה מעל כפתור הפרסום ───
  // לא חוסמת פרסום. כל בדיקה היא כלל כתיבה פשוט שנבדק על מה שבטופס כרגע.
  function words(s) { return String(s || '').replace(/[#*>\[\]()_`~-]+/g, ' ').split(/\s+/).filter(function (w) { return w.length > 0; }).length; }
  function normTitle(s) { return String(s || '').replace(/[֑-ׇ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase(); }
  function seoChecks() {
    var title = val('a-title'), sub = val('a-sub'), body = val('a-body'), cat = val('a-cat');
    var editId = ($id('a-title') && $id('a-title').dataset.editId) || '';
    var out = [];
    var tl = title.length;
    out.push(tl === 0 ? { s: 'bad', t: 'אין כותרת' }
      : tl < 20 ? { s: 'warn', t: 'כותרת קצרה (' + tl + ' תווים) — מומלץ 20 עד 65' }
      : tl > 65 ? { s: 'warn', t: 'כותרת ארוכה (' + tl + ' תווים) — גוגל יחתוך אחרי כ-65' }
      : { s: 'ok', t: 'אורך כותרת ' + tl + ' תווים' });
    var sl = sub.length;
    out.push(sl === 0 ? { s: 'bad', t: 'אין תקציר — הוא משמש גם כתיאור בגוגל' }
      : sl < 70 ? { s: 'warn', t: 'תקציר קצר (' + sl + ' תווים) — מומלץ 70 עד 160' }
      : sl > 160 ? { s: 'warn', t: 'תקציר ארוך (' + sl + ' תווים) — גוגל יציג כ-160' }
      : { s: 'ok', t: 'אורך תקציר ' + sl + ' תווים' });
    var need = cat === 'review' ? 600 : 300, wc = words(body);
    out.push(wc >= need ? { s: 'ok', t: wc + ' מילים בגוף הכתבה' } : { s: wc < need / 2 ? 'bad' : 'warn', t: wc + ' מילים — ' + (cat === 'review' ? 'למבחן רכב' : 'לכתבה') + ' מומלץ ' + need + ' לפחות' });
    var links = (body.match(/(?:speedometer10\.co\.il)?\/(?:article|car)\/[^\s)"'<\]]+/g) || []).length;
    out.push(links >= 2 ? { s: 'ok', t: links + ' קישורים פנימיים' } : { s: 'warn', t: (links ? 'קישור פנימי אחד' : 'אין קישורים פנימיים') + ' — מומלץ 2 לכתבות או לרכבים באתר' });
    var img = val('a-img'), cap = val('a-img-cap');
    out.push(!img ? { s: 'bad', t: 'אין תמונה ראשית' } : !cap ? { s: 'warn', t: 'לתמונה הראשית אין קרדיט / כיתוב' } : { s: 'ok', t: 'תמונה ראשית עם כיתוב' });
    var tags = val('a-tags').split(',').map(function (t) { return t.trim(); }).filter(Boolean).length;
    out.push(tags >= 3 ? { s: 'ok', t: tags + ' תגיות' } : { s: 'warn', t: (tags ? tags + ' תגיות' : 'אין תגיות') + ' — מומלץ 3 לפחות' });
    var nt = normTitle(title), dup = null;
    if (nt.length > 8) allArticles().some(function (a) {
      if (!a || a.cat === 'quick' || a.deleted || String(a.id) === String(editId)) return false;
      if (normTitle(a.title) === nt) { dup = a; return true; } return false;
    });
    out.push(dup ? { s: 'bad', t: 'כבר יש באתר כתבה עם אותה כותרת' } : { s: 'ok', t: 'הכותרת ייחודית באתר' });
    return out;
  }
  var seoBox = null, seoSig = '';
  function drawSeo() {
    var pb = page.querySelector('button[onclick^="publishArticle"]');
    var form = $id('admin-new') || (pb && pb.closest('.form-block'));
    if (!pb || !pb.parentNode || !isOpen() || (form && form.offsetParent === null)) return;
    if (!seoBox || !seoBox.isConnected) {
      seoBox = el('div', 'sp-seo'); seoBox.setAttribute('aria-live', 'polite');
      pb.parentNode.parentNode.insertBefore(seoBox, pb.parentNode);
      seoBox.addEventListener('click', function (e) { if (e.target.closest('.sp-seo-head')) seoBox.classList.toggle('open'); });
    }
    var list = seoChecks(), sig = JSON.stringify(list);
    if (sig === seoSig) return; seoSig = sig;
    var good = list.filter(function (c) { return c.s === 'ok'; }).length, bad = list.filter(function (c) { return c.s === 'bad'; }).length;
    var pct = Math.round(good / list.length * 100), R = 17, C = 2 * Math.PI * R;
    seoBox.className = 'sp-seo' + (seoBox.classList.contains('open') ? ' open' : '') + (bad ? ' has-bad' : good === list.length ? ' all-ok' : '');
    seoBox.innerHTML = '<button type="button" class="sp-seo-head" aria-expanded="' + seoBox.classList.contains('open') + '">' +
      '<svg class="sp-ring" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="' + R + '"/><circle class="v" cx="20" cy="20" r="' + R + '" stroke-dasharray="' + (C * pct / 100).toFixed(1) + ' ' + C.toFixed(1) + '"/></svg>' +
      '<span class="sp-seo-n">' + pct + '%</span><span class="sp-seo-t"><b>בדיקה לפני פרסום</b><small>' + good + ' מתוך ' + list.length + ' תקינים' + (bad ? ' · ' + bad + ' חשובים לתיקון' : '') + '</small></span>' +
      svg('more', 'sp-seo-more') + '</button><ul class="sp-seo-list">' +
      list.map(function (c) { return '<li class="' + c.s + '">' + svg(c.s === 'ok' ? 'check' : c.s === 'bad' ? 'x' : 'warn') + '<span>' + esc(c.t) + '</span></li>'; }).join('') + '</ul>';
  }
  document.addEventListener('input', function (e) { if (e.target && /^a-/.test(e.target.id || '')) { clearTimeout(drawSeo._t); drawSeo._t = setTimeout(drawSeo, 220); } }, true);
  // טעינת טיוטה ממלאת את הטופס בלי אירוע input — לכן גם בדיקה תקופתית קלה
  setInterval(function () { if (cssReady && isOpen() && !document.hidden) drawSeo(); }, 1500);

  // ─── 2. תור פרסום: משבצות מהירות ליד שדה התזמון ───
  var SLOTS = [8, 12, 18, 21];
  var queue = { rows: null, at: 0, loading: null };
  function loadQueue(force) {
    var c = window.sbClient; if (!c) return Promise.resolve([]);
    if (!force && queue.rows && Date.now() - queue.at < 60000) return Promise.resolve(queue.rows);
    if (queue.loading) return queue.loading;
    queue.loading = c.from('articles').select('id,title,cat,scheduled_at,tags').not('scheduled_at', 'is', null).neq('scheduled_at', '').order('scheduled_at').limit(60)
      .then(function (r) {
        queue.loading = null;
        if (r && r.error) return queue.rows || [];
        queue.rows = (r.data || []).filter(function (a) { return a.cat !== 'quick'; }).sort(function (x, y) { var a = parseSched(x.scheduled_at), b = parseSched(y.scheduled_at); return (a ? a.getTime() : 9e15) - (b ? b.getTime() : 9e15); }); queue.at = Date.now(); return queue.rows;
      }, function () { queue.loading = null; return queue.rows || []; });
    return queue.loading;
  }
  function freeSlots(rows, n) {
    var taken = (rows || []).map(function (a) { var d = parseSched(a.scheduled_at); return d ? d.getTime() : 0; });
    var out = [], now = Date.now() + 10 * 60000, base = new Date(); base.setHours(0, 0, 0, 0);
    for (var day = 0; day < 8 && out.length < n; day++) {
      for (var i = 0; i < SLOTS.length && out.length < n; i++) {
        var d = new Date(base.getTime()); d.setDate(d.getDate() + day); d.setHours(SLOTS[i], 0, 0, 0);
        if (d.getTime() < now) continue;
        if (taken.some(function (t) { return Math.abs(t - d.getTime()) < 45 * 60000; })) continue;
        out.push(d);
      }
    }
    return out;
  }
  var chipsBox = null;
  function drawChips() {
    var inp = $id('a-scheduled'); if (!inp || !isOpen()) return;
    if (!chipsBox || !chipsBox.isConnected) {
      chipsBox = el('div', 'sp-chips'); inp.insertAdjacentElement('afterend', chipsBox);
      chipsBox.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        inp.value = b.getAttribute('data-v') || '';
        inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true }));
        paintChips();
      });
      inp.addEventListener('change', paintChips);
    }
    loadQueue().then(function (rows) {
      var slots = freeSlots(rows, 4), cur = inp.value;
      chipsBox.innerHTML = '<span class="sp-chips-lab">' + svg('clock') + 'משבצת פנויה:</span>' +
        slots.map(function (d) { var v = localStamp(d); return '<button type="button" data-v="' + v + '">' + esc(whenText(d)) + '</button>'; }).join('') +
        '<button type="button" data-v="" class="sp-chip-now">מיד</button>' +
        '<span class="sp-chips-q">' + (rows.length ? rows.length + ' בתור · הבאה ' + esc(whenText(parseSched(rows[0].scheduled_at))) : 'התור ריק') + '</span>';
      paintChips(cur);
    });
  }
  function paintChips() {
    var inp = $id('a-scheduled'); if (!chipsBox || !inp) return;
    chipsBox.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', (b.getAttribute('data-v') || '') === (inp.value || '')); });
  }

  function publishNow(id) {
    var c = window.sbClient; if (!c) return Promise.resolve(false);
    var now = new Date(), date = now.toLocaleDateString('he-IL'), time = now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    var row = (queue.rows || []).filter(function (a) { return String(a.id) === String(id); })[0];
    var uid = row && Array.isArray(row.tags) ? (row.tags.filter(function (t) { return typeof t === 'string' && t.indexOf('uid:') === 0; })[0] || '').slice(4) : '';
    var o = opStart({ label: 'פרסום מהתור', icon: 'bolt', tau: 3, btn: recentBtn(), loud: true, sub: row ? String(row.title || '').slice(0, 70) : '' });
    var patch = { scheduled_at: null, date: date, time: time };
    return c.from('articles').update(patch).eq('id', id).then(function (r) {
      if (r && r.error) throw r.error;
      // המבזק הנלווה (אם יש) עולה יחד עם הכתבה
      if (uid) return c.from('articles').update(patch).eq('cat', 'quick').contains('tags', ['src:' + uid]).not('scheduled_at', 'is', null).then(function () { return true; }, function () { return true; });
      return true;
    }).then(function () {
      allArticles().forEach(function (a) { if (String(a.id) === String(id) || (uid && a.cat === 'quick' && a._srcUid === uid)) { a.scheduledAt = null; a.date = date; a.time = time; } });
      try { if (typeof window.syncFromSupabase === 'function') window.syncFromSupabase(); } catch (e) { /* לא קריטי */ }
      queue.at = 0; opEnd(o, true, 'פורסמה'); return true;
    }, function (e) { opEnd(o, false, 'הפרסום נכשל: ' + String((e && e.message) || e).slice(0, 60)); return false; });
  }

  // ─── 3. בריאות המערכת ───
  function ago(iso) {
    var t = Date.parse(iso || ''); if (!t) return '—';
    var m = Math.max(0, Math.round((Date.now() - t) / 60000));
    return m < 1 ? 'עכשיו' : m < 60 ? 'לפני ' + m + ' דק׳' : m < 1440 ? 'לפני ' + Math.round(m / 60) + ' שע׳' : 'לפני ' + Math.round(m / 1440) + ' ימים';
  }
  var CRON_NAMES = {
    'speedometer-publish-queue': 'תור הפרסום', 'speedometer-push-dispatch': 'התראות לטלפון', 'speedometer-headline-images': 'תמונות לכותרות',
    'speedometer-news-fetch': 'שליפת חדשות', 'speedometer-news-prepare': 'הכנת מקורות מראש', 'speedometer-news-cleanup': 'ניקוי כותרות ישנות'
  };
  function cronLabel(n) {
    if (CRON_NAMES[n]) return CRON_NAMES[n];
    if (/fetch|news/i.test(n) && /prepare/i.test(n)) return 'הכנת מקורות מראש';
    if (/fetch|rss|news/i.test(n)) return 'שליפת חדשות';
    if (/verify/i.test(n)) return 'בדיקות תקינות';
    if (/car/i.test(n)) return 'מאגר הרכבים';
    return n;
  }
  function healthRows(h) {
    var rows = [], g = h.github || {};
    if (!g.ok) rows.push({ s: 'bad', t: 'בניית דפי הכתבות', d: g.error || 'לא זמין' });
    else {
      var lr = g.last_run || {};
      rows.push({ s: lr.conclusion === 'failure' ? 'bad' : lr.status && lr.status !== 'completed' ? 'run' : 'ok', t: 'בניית דפי הכתבות',
        d: lr.created_at ? (lr.conclusion === 'failure' ? 'הריצה האחרונה נכשלה' : lr.status !== 'completed' ? 'רצה עכשיו' : 'הצליחה') + ' · ' + ago(lr.created_at) + (g.failed_24h ? ' · ' + g.failed_24h + ' כשלונות ב-24 שע׳' : '') : 'אין ריצות אחרונות' });
      if (typeof g.token_days_left === 'number') rows.push({ s: g.token_days_left <= 7 ? 'bad' : g.token_days_left <= 21 ? 'warn' : 'ok', t: 'הטוקן של GitHub', d: g.token_days_left <= 0 ? 'פג' : 'בתוקף עוד ' + g.token_days_left + ' ימים' });
    }
    var p = h.pipeline || {}, fresh = Date.parse(p.last_fetched_at || ''), fm = fresh ? (Date.now() - fresh) / 60000 : 1e9;
    rows.push({ s: fm > 90 ? 'bad' : fm > 40 ? 'warn' : 'ok', t: 'כותרות חדשות', d: 'אחרונה ' + ago(p.last_fetched_at) + ' · ' + (p.headlines_1h || 0) + ' בשעה האחרונה' + (p.unanalyzed ? ' · ' + p.unanalyzed + ' ממתינות לדירוג' : '') });
    rows.push({ s: p.failed_24h >= 3 ? 'bad' : p.failed_24h ? 'warn' : 'ok', t: 'כתיבת כתבות', d: (p.drafts_24h || 0) + ' טיוטות ב-24 שע׳' + (p.failed_24h ? ' · ' + p.failed_24h + ' נכשלו' : '') + (p.writing_now ? ' · ' + p.writing_now + ' נכתבות עכשיו' : ''), x: p.failed_24h && p.last_failure ? String(p.last_failure).slice(0, 140) : '' });
    var src = h.sources || {}, fl = src.failing || [];
    rows.push({ s: fl.length >= 3 ? 'bad' : fl.length ? 'warn' : 'ok', t: 'מקורות חדשות', d: (src.total || 0) + ' במעקב' + (fl.length ? ' · ' + fl.length + ' בתקלה: ' + fl.slice(0, 3).map(function (f) { return f.name; }).join(', ') : ' · כולם עובדים') });
    var cr = (h.cron || []).filter(function (j) { return j.last_status === 'failed'; });
    rows.push({ s: cr.length ? 'bad' : 'ok', t: 'משימות מתוזמנות', d: (h.cron || []).length + ' משימות' + (cr.length ? ' · נכשלו: ' + cr.map(function (j) { return cronLabel(j.job); }).join(', ') : ' · הריצה האחרונה של כולן הצליחה'), x: cr.length ? String(cr[0].last_message || '').slice(0, 140) : '' });
    var q = h.queue || {};
    var late = (q.items || []).filter(function (it) { var d = parseSched(it.at); return d && d.getTime() < Date.now() - 10 * 60000; }).length;
    rows.push({ s: late ? 'warn' : 'ok', t: 'תור הפרסום', d: (q.count || 0) + ' כתבות מתוזמנות' + (late ? ' · ' + late + ' באיחור' : '') });
    rows.push({ s: (h.push || {}).subscriptions ? 'ok' : 'off', t: 'התראות לטלפון', d: (h.push || {}).subscriptions ? (h.push.subscriptions + ' מכשירים רשומים') : 'אף מכשיר לא רשום' });
    return rows;
  }
  function loadHealth(box) {
    var c = window.sbClient; if (!c || !box) return;
    box.innerHTML = '<div class="sp-hrow run"><i></i><span><b>בודק…</b><small>GitHub, תזמונים, מקורות ותור</small></span></div>';
    c.rpc('admin_health').then(function (r) {
      if (r && r.error) {
        var missing = /admin_health|function|schema cache/i.test(r.error.message || '');
        box.innerHTML = '<div class="sp-hrow off"><i></i><span><b>' + (missing ? 'מסך הבריאות עוד לא פעיל' : 'הבדיקה נכשלה') + '</b><small>' + esc(missing ? 'יופעל אחרי הרצת 03-admin-features.sql' : r.error.message) + '</small></span></div>';
        return;
      }
      var h = r.data || {}, rows = healthRows(h), bad = rows.filter(function (x) { return x.s === 'bad'; }).length;
      box.innerHTML = rows.map(function (x) { return '<div class="sp-hrow ' + x.s + '"><i></i><span><b>' + esc(x.t) + '</b><small>' + esc(x.d) + '</small>' + (x.x ? '<em>' + esc(x.x) + '</em>' : '') + '</span></div>'; }).join('') +
        '<div class="sp-hfoot">נבדק ' + new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) + '<button type="button" class="sp-act" data-act="health">' + svg('refresh') + 'בדוק שוב</button></div>';
      var dot = page.querySelector('.sp-head .sp-dot'); if (dot && bad) dot.classList.add('bad');
    }, function () { box.innerHTML = '<div class="sp-hrow bad"><i></i><span><b>אין חיבור</b><small>נסה שוב בעוד רגע</small></span></div>'; });
  }

  // ─── 4. התראות לטלפון (Web Push, אנדרואיד) ───
  function b64uToBytes(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function bytesToB64u(buf) { var u = new Uint8Array(buf), s = ''; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function callPush(action) {
    var c = window.sbClient; if (!c) return Promise.reject(new Error('אין חיבור'));
    return c.auth.getSession().then(function (r) {
      var tok = r && r.data && r.data.session && r.data.session.access_token; if (!tok) throw new Error('צריך להתחבר מחדש');
      if (typeof SB_URL === 'undefined' || typeof SB_KEY === 'undefined') throw new Error('הגדרות החיבור לא נטענו');
      return fetch(SB_URL + '/functions/v1/admin-push', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok, 'apikey': SB_KEY }, body: JSON.stringify({ action: action }) });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (res.status === 404) throw new Error('הפונקציה admin-push עוד לא פרוסה');
        if (!res.ok) throw new Error(j.error || ('שגיאה ' + res.status)); return j;
      });
    });
  }
  function currentSub() {
    if (!pushSupported()) return Promise.resolve(null);
    return navigator.serviceWorker.getRegistration('/').then(function (reg) { return reg ? reg.pushManager.getSubscription() : null; }, function () { return null; });
  }
  function pushOn() {
    var c = window.sbClient;
    var o = opStart({ label: 'הפעלת התראות', icon: 'bell', btn: recentBtn(), loud: true });
    opSet(o, 10, 'מבקש אישור מהדפדפן');
    return Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') throw new Error(perm === 'denied' ? 'ההתראות חסומות בדפדפן — יש לאפשר אותן בהגדרות האתר' : 'לא אושר');
      opSet(o, 30, 'מקבל מפתח מהשרת');
      return Promise.all([callPush('key'), navigator.serviceWorker.register('/sw.js').then(function () { return navigator.serviceWorker.ready; })]);
    }).then(function (res) {
      opSet(o, 60, 'רושם את המכשיר');
      var key = res[0].publicKey, reg = res[1];
      return reg.pushManager.getSubscription().then(function (old) {
        // מנוי עם מפתח אחר (למשל אחרי איפוס) מוחלף בחדש
        if (old) return old.unsubscribe().then(function () { return null; }, function () { return null; });
        return null;
      }).then(function () { return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) }); });
    }).then(function (sub) {
      opSet(o, 85, 'שומר');
      return c.from('push_subscriptions').upsert({
        endpoint: sub.endpoint, p256dh: bytesToB64u(sub.getKey('p256dh')), auth: bytesToB64u(sub.getKey('auth')), user_agent: navigator.userAgent.slice(0, 200)
      }, { onConflict: 'endpoint' }).then(function (r) { if (r && r.error) throw new Error(r.error.message); });
    }).then(function () { opEnd(o, true, 'הטלפון הזה רשום להתראות'); drawPush(); }, function (e) { opEnd(o, false, String((e && e.message) || e).slice(0, 90)); drawPush(); });
  }
  function pushOff() {
    var c = window.sbClient, o = opStart({ label: 'כיבוי התראות', icon: 'bell', tau: 2, btn: recentBtn(), loud: true });
    return currentSub().then(function (sub) {
      if (!sub) return;
      var ep = sub.endpoint;
      return sub.unsubscribe().then(function () { return c.from('push_subscriptions').delete().eq('endpoint', ep); });
    }).then(function () { opEnd(o, true, 'כובה במכשיר הזה'); drawPush(); }, function () { opEnd(o, false, 'הכיבוי נכשל'); drawPush(); });
  }
  function pushTest() {
    var o = opStart({ label: 'התראת בדיקה', icon: 'bell', tau: 3, btn: recentBtn(), loud: true });
    return callPush('test').then(function (j) {
      opEnd(o, !!j.ok, j.ok ? 'נשלחה ל-' + j.sent + ' מכשירים' : (j.subscribers ? 'שירות ההתראות דחה את השליחה' : 'אין מכשירים רשומים'));
    }, function (e) { opEnd(o, false, String((e && e.message) || e).slice(0, 90)); });
  }
  var PREF_NAMES = { hot: 'כותרות בוערות (ציון 5)', draft: 'טיוטה מוכנה או כתיבה שנכשלה', source: 'מקור שהפסיק לעבוד', build: 'תקלה בבניית האתר או בטוקן' };
  function drawPush() {
    var box = sheet && sheet.querySelector('[data-push]'); if (!box) return;
    if (!pushSupported()) { box.innerHTML = '<div class="sp-hrow off"><i></i><span><b>הדפדפן הזה לא תומך בהתראות</b><small>פתח את הפאנל ב-Chrome באנדרואיד</small></span></div>'; return; }
    currentSub().then(function (sub) {
      var perm = Notification.permission;
      if (!sub) {
        box.innerHTML = '<div class="sp-hrow off"><i></i><span><b>המכשיר הזה לא מקבל התראות</b><small>' + (perm === 'denied' ? 'ההתראות חסומות בהגדרות האתר בדפדפן' : 'כותרות בוערות, טיוטות מוכנות ותקלות — ישר לטלפון') + '</small></span></div>' +
          '<div class="sp-acts"><button type="button" class="sp-act primary" data-act="push-on"' + (perm === 'denied' ? ' disabled' : '') + '>' + svg('bell') + 'הפעל התראות במכשיר הזה</button></div>';
        return;
      }
      window.sbClient.from('push_subscriptions').select('prefs').eq('endpoint', sub.endpoint).maybeSingle().then(function (r) {
        var known = r && !r.error && r.data, prefs = (known && r.data.prefs) || {};
        box.innerHTML = '<div class="sp-hrow ' + (known ? 'ok' : 'warn') + '"><i></i><span><b>' + (known ? 'המכשיר הזה מקבל התראות' : 'רשום בדפדפן, אבל לא נמצא בשרת') + '</b><small>' + (known ? 'אפשר לבחור מה לקבל' : 'לחץ "הפעל מחדש" כדי לתקן') + '</small></span></div>' +
          (known ? '<div class="sp-prefs">' + Object.keys(PREF_NAMES).map(function (k) { return '<label><input type="checkbox" data-pref="' + k + '"' + (prefs[k] === false ? '' : ' checked') + '><span>' + PREF_NAMES[k] + '</span></label>'; }).join('') + '</div>' : '') +
          '<div class="sp-acts">' + (known ? '<button type="button" class="sp-act primary" data-act="push-test">' + svg('bell') + 'שלח התראת בדיקה</button>' : '<button type="button" class="sp-act primary" data-act="push-on">' + svg('refresh') + 'הפעל מחדש</button>') +
          '<button type="button" class="sp-act" data-act="push-off">' + svg('x') + 'כבה במכשיר הזה</button></div>';
      }, function () { /* לא קריטי */ });
    });
  }
  function savePref(input) {
    currentSub().then(function (sub) {
      if (!sub) return;
      var prefs = {}; sheet.querySelectorAll('[data-pref]').forEach(function (x) { prefs[x.getAttribute('data-pref')] = x.checked; });
      window.sbClient.from('push_subscriptions').update({ prefs: prefs }).eq('endpoint', sub.endpoint).then(function (r) { if (r && r.error) input.checked = !input.checked; });
    });
  }

  // ─── חיבור לפאנל הצף ───
  function drawQueueList() {
    var box = sheet && sheet.querySelector('[data-queue]'); if (!box) return;
    box.innerHTML = '<div class="sp-hrow run"><i></i><span><b>טוען…</b></span></div>';
    loadQueue(true).then(function (rows) {
      if (!rows.length) { box.innerHTML = '<div class="sp-hrow off"><i></i><span><b>אין כתבות מתוזמנות</b><small>בטופס הכתבה יש משבצות פנויות מוכנות ליד שדה התזמון</small></span></div>'; return; }
      box.innerHTML = rows.slice(0, 12).map(function (a) {
        var d = parseSched(a.scheduled_at), late = d && d.getTime() < Date.now() - 10 * 60000;
        return '<div class="sp-qrow' + (late ? ' late' : '') + '"><span class="sp-qwhen">' + esc(whenText(d)) + (late ? '<small>באיחור</small>' : '') + '</span><span class="sp-qt">' + esc(a.title || '') + '</span>' +
          '<button type="button" class="sp-act" data-act="pub-now" data-id="' + esc(a.id) + '">' + svg('bolt') + 'פרסם עכשיו</button></div>';
      }).join('');
    });
  }
  function enhanceSheet() {
    if (!sheet || sheet.__spPlus) return; sheet.__spPlus = true;
    sheet.addEventListener('click', function (e) {
      var b = e.target.closest('.sp-act'); if (!b || b.disabled) return;
      e.stopPropagation();
      var a = b.getAttribute('data-act');
      if (a === 'health') loadHealth(sheet.querySelector('[data-health]'));
      else if (a === 'pub-now') publishNow(b.getAttribute('data-id')).then(function (ok) { if (ok) drawQueueList(); });
      else if (a === 'push-on') pushOn(); else if (a === 'push-off') pushOff(); else if (a === 'push-test') pushTest();
    }, true);
    sheet.addEventListener('change', function (e) { if (e.target && e.target.hasAttribute('data-pref')) savePref(e.target); });
  }
  function sheetExtrasHtml() {
    return '<div class="sp-sec">בריאות המערכת</div><div class="sp-health" data-health="1"></div>' +
      '<div class="sp-sec">תור פרסום</div><div class="sp-queue" data-queue="1"></div>' +
      '<div class="sp-sec">התראות לטלפון</div><div class="sp-push" data-push="1"></div>';
  }
  function fillSheetExtras() {
    enhanceSheet();
    loadHealth(sheet.querySelector('[data-health]'));
    drawQueueList();
    drawPush();
  }

  // ═══ מבנה: ראש עמוד, אי, ניווט, פאנל צף ═══
  function tabBtn(key) {
    var all = page.querySelectorAll('.admin-tab');
    for (var i = 0; i < all.length; i++) if ((all[i].getAttribute('onclick') || '').indexOf("'" + key + "'") > -1) return all[i];
    return null;
  }
  function goTab(key) { var b = tabBtn(key); if (b) b.click(); syncNav(); window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); }
  var nav = null;
  function syncNav() {
    if (!nav) return;
    var act = page.querySelector('.admin-tab.active'), key = '';
    if (act) { var mm = /'([a-z]+)'/.exec(act.getAttribute('onclick') || ''); key = mm ? mm[1] : ''; }
    nav.querySelectorAll('button[data-tab]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === key); });
    if (key === 'new' || !key) { drawChips(); seoSig = ''; drawSeo(); }
  }
  function build() {
    if (page.querySelector('.sp-head')) return;
    var inner = page.querySelector('.admin-inner') || page;

    var head = el('div', 'sp-head');
    head.innerHTML = '<button type="button" class="sp-logo" aria-label="ספידומטר — חזרה לראש הפאנל"><img class="sp-logo-img" src="/logo.png" alt="" width="44" height="44" decoding="async"><span class="sp-logo-word">ספיד<b>ו</b>מטר</span><span class="sp-logo-sub">ניהול</span></button>' +
      '<span class="sp-head-status"><span class="sp-dot live"></span><span class="sp-status-txt">בודק את מצב הצנרת…</span></span>' +
      '<button type="button" class="sp-head-btn sp-head-pill" data-act="pal" aria-label="חיפוש פעולה">' + svg('search') + '</button>' +
      '<button type="button" class="sp-head-btn sp-head-pill" data-act="more" aria-label="עוד פעולות ונתונים">' + svg('more') + '</button>';
    inner.insertBefore(head, inner.firstChild);
    head.querySelector('.sp-logo').addEventListener('click', function () { window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); });
    head.querySelector('[data-act=more]').addEventListener('click', openSheet);
    head.querySelector('[data-act=pal]').addEventListener('click', openPal);

    island = el('div', 'sp-island'); island.setAttribute('role', 'status'); island.setAttribute('aria-live', 'polite');
    head.parentNode.insertBefore(island, head.nextSibling);

    nav = el('nav', 'sp-nav'); nav.setAttribute('aria-label', 'ניווט ראשי');
    nav.innerHTML = '<button type="button" data-tab="news">' + svg('news') + '<span>חדשות</span></button>' +
      '<button type="button" data-tab="list">' + svg('docs') + '<span>כתבות</span></button>' +
      '<button type="button" class="sp-nav-fab" data-tab="new" aria-label="כתבה חדשה">' + svg('plus') + '</button>' +
      '<button type="button" data-tab="cars">' + svg('car') + '<span>רכבים</span></button>' +
      '<button type="button" data-act="more">' + svg('more') + '<span>עוד</span></button>';
    page.appendChild(nav);
    nav.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.getAttribute('data-act') === 'more') openSheet(); else goTab(b.getAttribute('data-tab'));
    });
    page.querySelectorAll('.admin-tab').forEach(function (b) { b.addEventListener('click', function () { setTimeout(syncNav, 0); }); });
    syncNav();
    swapIn(page);
    loadStatus();
    wrapActions(); setTimeout(wrapActions, 2500); // מודולים שנטענים מאוחר
    pollServer();
    drawChips(); drawSeo();
  }

  // ─── נתונים חיים: מצב המקורות, טיוטות, קצב פרסום ───
  var info = { sources: null, failing: [], drafts: null, loaded: false };
  function loadStatus() {
    var c = window.sbClient, txt = page.querySelector('.sp-status-txt'), dot = page.querySelector('.sp-head .sp-dot');
    if (!c) { if (txt) txt.textContent = ''; return; }
    c.from('news_source_state').select('source_name,last_ok_at,last_error,consecutive_failures').then(function (r) {
      var rows = (r && r.data) || [];
      if (r && r.error) { if (txt) txt.textContent = 'מצב הצנרת לא זמין'; return; }
      info.sources = rows.length;
      info.failing = rows.filter(function (x) { return (x.consecutive_failures || 0) >= 3; });
      var latest = 0; rows.forEach(function (x) { var t = x.last_ok_at ? Date.parse(x.last_ok_at) : 0; if (t > latest) latest = t; });
      var mins = latest ? Math.max(0, Math.round((Date.now() - latest) / 60000)) : null;
      if (txt) txt.textContent = rows.length + ' מקורות' + (mins == null ? '' : ' · עודכן לפני ' + (mins < 60 ? mins + ' דק׳' : Math.round(mins / 60) + ' שע׳')) + (info.failing.length ? ' · ' + info.failing.length + ' בתקלה' : '');
      if (dot) dot.classList.toggle('bad', mins != null && mins > 45);
      info.loaded = true;
    }, function () { if (txt) txt.textContent = 'מצב הצנרת לא זמין'; });
    c.from('news_drafts').select('id', { count: 'exact', head: true }).eq('status', 'pending').then(function (r) { if (r && typeof r.count === 'number') info.drafts = r.count; }, function () { /* לא קריטי */ });
  }
  var CAT_NAMES = { local: 'ישראל', world: 'עולם', review: 'מבחני רכב', electric: 'חשמלי', tech: 'טכנולוגיה', buying: 'קנייה', sport: 'ספורט', luxury: 'יוקרה' };
  function parseDate(a) {
    var m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(a && a.date || '').trim());
    return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : NaN;
  }
  function deepStats() {
    var list = [];
    try { list = (typeof articles !== 'undefined' && Array.isArray(articles)) ? articles : []; } catch (e) { list = []; }
    var full = list.filter(function (a) { return a && a.cat !== 'quick' && !a.deleted; });
    var day = 86400000, today = new Date(); today.setHours(0, 0, 0, 0); var t0 = today.getTime();
    var days = []; for (var i = 13; i >= 0; i--) days.push({ t: t0 - i * day, n: 0 });
    var thisWeek = 0, lastWeek = 0, byCat = {}, hot = null;
    full.forEach(function (a) {
      var d = parseDate(a), v = +a.views || 0;
      if (!isNaN(d)) {
        var idx = Math.round((d - days[0].t) / day); if (idx >= 0 && idx < 14) days[idx].n++;
        var age = (t0 - d) / day; if (age >= 0 && age < 7) { thisWeek++; if (!hot || v > (+hot.views || 0)) hot = a; } else if (age >= 7 && age < 14) lastWeek++;
      }
      var c = CAT_NAMES[a.cat] || a.cat || 'אחר'; byCat[c] = byCat[c] || { n: 0, v: 0 }; byCat[c].n++; byCat[c].v += v;
    });
    var cats = Object.keys(byCat).map(function (k) { return { name: k, n: byCat[k].n, avg: byCat[k].n ? Math.round(byCat[k].v / byCat[k].n) : 0 }; })
      .sort(function (a, b) { return b.avg - a.avg; }).slice(0, 6);
    return { days: days, thisWeek: thisWeek, lastWeek: lastWeek, cats: cats, hot: hot, hasData: full.length > 0 };
  }
  function sparkSvg(days) {
    var max = 1; days.forEach(function (d) { if (d.n > max) max = d.n; });
    var w = 280, h = 64, bw = w / days.length, out = '';
    days.forEach(function (d, i) {
      var bh = d.n ? Math.max(4, d.n / max * (h - 14)) : 2;
      var x = w - (i + 1) * bw + 2; // ימין לשמאל: היום הכי ישן בימין, היום בשמאל
      out += '<rect x="' + x.toFixed(1) + '" y="' + (h - bh).toFixed(1) + '" width="' + (bw - 4).toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="3" fill="' + (i === days.length - 1 ? '#e8001d' : 'rgba(18,20,26,.28)') + '"><title>' + new Date(d.t).toLocaleDateString('he-IL') + ': ' + d.n + '</title></rect>';
    });
    return '<svg class="sp-spark" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="כתבות שפורסמו בכל אחד מ-14 הימים האחרונים">' + out + '</svg>';
  }

  function articleStats() {
    var list = [];
    try { list = (typeof articles !== 'undefined' && Array.isArray(articles)) ? articles : []; } catch (e) { list = []; }
    var now = Date.now(), week = 0, month = 0, cats = {};
    list.forEach(function (a) {
      if (!a || a.cat === 'quick') return;
      var m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(a.date || '').trim());
      if (m) { var d = new Date(+m[3], +m[2] - 1, +m[1]).getTime(), age = (now - d) / 86400000; if (age >= 0 && age < 7) week++; if (age >= 0 && age < 30) month++; }
      cats[a.cat] = (cats[a.cat] || 0) + 1;
    });
    return { week: week, month: month, total: list.filter(function (a) { return a && a.cat !== 'quick'; }).length, hasData: list.length > 0 };
  }

  var sheet = null;
  function openSheet() {
    if (!sheet) {
      sheet = el('div', 'sp-sheet'); sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'עוד פעולות ונתונים');
      document.body.appendChild(sheet);
      sheet.addEventListener('click', function (e) {
        if (e.target === sheet || e.target.closest('.sp-x')) { closeSheet(); return; }
        var t = e.target.closest('.sp-tile'); if (!t) return;
        var act = t.getAttribute('data-run'); closeSheet();
        if (act === 'ads') goTab('ads');
        else if (act === 'pal') openPal();
        else if (act === 'site' && typeof window.showHome === 'function') window.showHome();
        else if (act === 'logout' && typeof window.adminLogout === 'function') window.adminLogout();
        else if (act === 'reload') loadStatus();
      });
    }
    var st = articleStats(), html = '<div class="sp-sheet-card"><div class="sp-sheet-head"><h2>עוד</h2><button type="button" class="sp-x" aria-label="סגירה">' + svg('x') + '</button></div>' +
      '<div class="sp-tiles">' +
      '<button type="button" class="sp-tile" data-run="ads">' + svg('ads') + 'מודעות</button>' +
      '<button type="button" class="sp-tile" data-run="pal">' + svg('search') + 'חיפוש פעולה</button>' +
      '<button type="button" class="sp-tile" data-run="reload">' + svg('refresh') + 'רענון מצב הצנרת</button>' +
      '<button type="button" class="sp-tile" data-run="site">' + svg('home') + 'חזרה לאתר</button>' +
      '<button type="button" class="sp-tile danger" data-run="logout">' + svg('out') + 'התנתקות</button></div>' + sheetExtrasHtml();
    html += '<div class="sp-sec">קצב פרסום</div><div class="sp-kv">' +
      (st.hasData ? '<div><b>' + st.week + '</b><span>כתבות ב-7 הימים האחרונים</span></div><div><b>' + st.month + '</b><span>כתבות ב-30 הימים האחרונים</span></div><div><b>' + st.total + '</b><span>כתבות מלאות באתר</span></div>' : '<div><span>הנתונים עוד נטענים</span></div>') +
      (info.drafts != null ? '<div><b>' + info.drafts + '</b><span>טיוטות ממתינות</span></div>' : '') + '</div>';
    var ds = deepStats();
    if (ds.hasData) {
      var diff = ds.thisWeek - ds.lastWeek;
      html += '<div class="sp-sec">14 הימים האחרונים</div><div class="sp-card-in">' + sparkSvg(ds.days) +
        '<div class="sp-spark-cap"><span>לפני שבועיים</span><span>היום</span></div>' +
        '<div class="sp-trend ' + (diff > 0 ? 'up' : diff < 0 ? 'down' : '') + '">השבוע ' + ds.thisWeek + ' כתבות, ' +
        (diff === 0 ? 'כמו בשבוע שעבר' : (diff > 0 ? diff + ' יותר' : (-diff) + ' פחות') + ' מבשבוע שעבר (' + ds.lastWeek + ')') + '</div></div>';
      if (ds.hot) html += '<div class="sp-sec">הכתבה החמה של השבוע</div><div class="sp-list"><div data-hot="1"></div></div>';
      html += '<div class="sp-sec">ממוצע צפיות לכתבה לפי קטגוריה</div><div class="sp-cats" data-cats="1"></div>';
    }
    html += '<div class="sp-sec">מקורות החדשות</div>';
    if (!info.loaded) html += '<div class="sp-kv"><div><span>מצב המקורות עוד נטען, או שאינו זמין</span></div></div>';
    else {
      html += '<div class="sp-kv"><div><b>' + info.sources + '</b><span>מקורות במעקב</span></div><div><b>' + info.failing.length + '</b><span>בתקלה מתמשכת</span></div></div>';
      if (info.failing.length) html += '<div class="sp-list" style="margin-top:8px" data-fail="1"></div>';
    }
    html += '</div>';
    sheet.innerHTML = html;
    var fl = sheet.querySelector('[data-fail]');
    if (fl) info.failing.slice(0, 8).forEach(function (x) {
      var row = el('div'); var n = el('span'); n.textContent = x.source_name; var s = el('small'); s.textContent = String(x.last_error || '').slice(0, 80);
      row.appendChild(n); row.appendChild(s); fl.appendChild(row);
    });
    var hotRow = sheet.querySelector('[data-hot]');
    if (hotRow && ds.hot) { var ht = el('span'); ht.textContent = ds.hot.title || ''; var hv = el('small'); hv.textContent = (+ds.hot.views || 0).toLocaleString('he-IL') + ' צפיות'; hotRow.appendChild(ht); hotRow.appendChild(hv); }
    var catBox = sheet.querySelector('[data-cats]');
    if (catBox) {
      var top = ds.cats.length ? ds.cats[0].avg || 1 : 1;
      ds.cats.forEach(function (c) {
        var row = el('div', 'sp-cat'); var nm = el('span', 'sp-cat-n'); nm.textContent = c.name;
        var tr = el('span', 'sp-cat-t'); var fill = el('i'); fill.style.width = Math.max(3, c.avg / top * 100) + '%'; tr.appendChild(fill);
        var val = el('b'); val.textContent = c.avg.toLocaleString('he-IL');
        row.appendChild(nm); row.appendChild(tr); row.appendChild(val); catBox.appendChild(row);
      });
    }
    sheet.classList.add('on');
    try { fillSheetExtras(); } catch (e) { console.warn('[sp-glass] תוספות הפאנל הצף: ' + e); }
    var x = sheet.querySelector('.sp-x'); if (x) x.focus();
  }
  function closeSheet() { if (sheet) sheet.classList.remove('on'); }

  // ─── חיפוש פעולה (Ctrl+K / ⌘K) ───
  var pal = null, palItems = [], palCur = 0;
  function collectActions() {
    var out = [
      { t: 'כתבה חדשה', run: function () { goTab('new'); } }, { t: 'ניהול כתבות', run: function () { goTab('list'); } },
      { t: 'חדשות חמות', run: function () { goTab('news'); } }, { t: 'רכבים', run: function () { goTab('cars'); } },
      { t: 'מודעות', run: function () { goTab('ads'); } }, { t: 'עוד פעולות ונתונים', run: openSheet },
      { t: 'בריאות המערכת', run: openSheet }, { t: 'תור פרסום', run: openSheet }, { t: 'התראות לטלפון', run: openSheet }
    ];
    page.querySelectorAll('button').forEach(function (b) {
      if (b.closest('.sp-nav,.sp-head,.admin-tabs') || b.offsetParent === null) return;
      var t = (b.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length < 3 || t.length > 40) return;
      out.push({ t: t, run: function () { b.scrollIntoView({ block: 'center' }); b.click(); } });
    });
    var seen = {}; return out.filter(function (a) { if (seen[a.t]) return false; seen[a.t] = 1; return true; });
  }
  function drawPal(q) {
    var list = pal.querySelector('.sp-pal-list'); list.innerHTML = '';
    palItems = collectActions().filter(function (a) { return !q || a.t.indexOf(q) > -1; }).slice(0, 30);
    palCur = 0;
    palItems.forEach(function (a, i) {
      var b = el('button'); b.type = 'button'; b.textContent = a.t; if (i === 0) b.className = 'cur';
      b.addEventListener('click', function () { closePal(); a.run(); });
      list.appendChild(b);
    });
  }
  function openPal() {
    if (!pal) {
      pal = el('div', 'sp-pal', '<div class="sp-pal-card"><input type="text" aria-label="חיפוש פעולה" placeholder="מה לעשות? למשל: רענן, פרסם, רכבים"><div class="sp-pal-list"></div></div>');
      pal.setAttribute('role', 'dialog'); pal.setAttribute('aria-modal', 'true'); pal.setAttribute('aria-label', 'חיפוש פעולה');
      document.body.appendChild(pal);
      pal.addEventListener('click', function (e) { if (e.target === pal) closePal(); });
      var inp = pal.querySelector('input');
      inp.addEventListener('input', function () { drawPal(inp.value.trim()); });
      inp.addEventListener('keydown', function (e) {
        var bs = pal.querySelectorAll('.sp-pal-list button');
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); if (!bs.length) return;
          bs[palCur].classList.remove('cur'); palCur = (palCur + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length; bs[palCur].classList.add('cur'); bs[palCur].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') { e.preventDefault(); if (palItems[palCur]) { var a = palItems[palCur]; closePal(); a.run(); } }
        else if (e.key === 'Escape') closePal();
      });
    }
    pal.classList.add('on'); var i2 = pal.querySelector('input'); i2.value = ''; drawPal(''); i2.focus();
  }
  function closePal() { if (pal) pal.classList.remove('on'); }
  page.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.key === 'ל')) { e.preventDefault(); openPal(); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeSheet(); closePal(); } });

  // ═══ מסך כניסה ═══
  function splash() {
    if (safeGet('sp-splash-seen')) return;
    safeSet('sp-splash-seen', '1');
    var letters = ['ס', 'פ', 'י', 'ד', 'ו', 'מ', 'ט', 'ר'], word = '';
    for (var i = 0; i < letters.length; i++) word += '<span' + (letters[i] === 'ו' ? ' class="v"' : '') + ' style="--i:' + i + '">' + letters[i] + '</span>';
    var s = el('div', 'sp-splash' + (reduce ? ' still' : ''),
      '<div class="sp-splash-mark"><svg class="sp-splash-ring" viewBox="0 0 200 200" aria-hidden="true"><circle class="trk" cx="100" cy="100" r="92"/><circle class="arc" cx="100" cy="100" r="92"/></svg>' +
      '<img class="sp-splash-logo" src="/logo.png" alt="" width="150" height="150" decoding="async"><span class="sp-splash-flare" aria-hidden="true"></span></div>' +
      '<div class="sp-splash-word" role="img" aria-label="ספידומטר">' + word + '</div><div class="sp-splash-sub">מרכז הניהול</div>');
    document.body.appendChild(s);
    requestAnimationFrame(function () { s.classList.add('go'); });
    var done = function () { s.classList.add('out'); setTimeout(function () { s.remove(); }, 500); };
    setTimeout(done, reduce ? 500 : 1900);
    s.addEventListener('click', done);
  }

  // ═══ הפעלה: בכל פעם שהפאנל נפתח ═══
  function onShow() {
    if (!cssReady) return; // בלי קובץ העיצוב לא בונים כלום — הפאנל נשאר כמו שהיה
    document.body.classList.toggle('sp-admin-open', isOpen());
    if (!isOpen()) { if (nav) nav.style.display = 'none'; return; }
    if (nav) nav.style.display = '';
    try { splash(); } catch (e) { /* מסך הכניסה הוא קישוט בלבד */ }
    try { build(); } catch (e) { console.warn('[sp-glass] build נכשל: ' + e); }
    patchStorage();
  }
  new MutationObserver(onShow).observe(page, { attributes: true, attributeFilter: ['style'] });
  onShow();
})();
