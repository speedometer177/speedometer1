/* ═══ ספידומטר — ייבוא כתבה מקובץ Word (docx-import.js) ═══
   מוסיף לפאנל הניהול (כתבה חדשה) כפתור "ייבוא מקובץ Word".
   הקובץ נבנה לפי תבנית קבועה (ראו /templates/) עם סימני [סעיף] ושורות "שם שדה: ערך".
   לפני שמשהו נכנס לטופס מוצג דוח: מה זוהה, ומה לא — כדי שלא יהיו טעויות שקטות.
   נשארים ידניים: תמונות, שם כותב, זמן קריאה, דירוג כולל.

   הקובץ משמש בדפדפן (window.spDocxImport) וגם ב-Node לבדיקות (module.exports).
   פונקציות הניתוח (parseBlocks) טהורות ואינן נוגעות ב-DOM. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.spDocxImport = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /* ───────── עזרים ───────── */
  function norm(s) {
    return String(s == null ? '' : s)
      .replace(/[‎‏‪-‮]/g, '')   // סימני כיווניות נסתרים
      .replace(/[ְ-ׇ]/g, '')               // ניקוד
      .replace(/["'׳״“”‘’`]/g, '')
      .replace(/[\s_\-–—.]+/g, ' ')
      .trim()
      .toLowerCase();
  }
  function clean(s) {
    return String(s == null ? '' : s).replace(/[‎‏‪-‮]/g, '').replace(/\s+/g, ' ').trim();
  }
  function stripHint(l) { return String(l).replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim(); }
  function firstNumber(s) {
    var m = String(s).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return m ? m[0] : null;
  }
  // הסכום הראשון בלבד ("החל מ-219,990 ... ועד 244,990" -> 219,990)
  function moneyDigits(s) {
    var m = String(s).match(/\d{1,3}(?:,\d{3})+|\d+/);
    if (!m) return null;
    var d = m[0].replace(/,/g, '');
    return d.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function moneyCount(s) { return (String(s).match(/\d{1,3}(?:,\d{3})+|\d{4,}/g) || []).length; }
  // מומנט נשמר בקג"מ (כמו שהוא נכתב בקובץ). אם הקובץ נתן נ"מ — ממירים לקג"מ.
  function numWithUnit(key, v) {
    var n = firstNumber(v);
    if (n === null) return null;
    var isKgm = /קג\s*["״”“']?\s*מ|kgm|kg\s*\.?\s*m/i.test(v);
    if (key === 'torque' && !isKgm && /נ\s*["״”“']?\s*מ|\bnm\b/i.test(v)) {
      return { n: String(Math.round(parseFloat(n) / 9.80665 * 10) / 10), conv: true };
    }
    return { n: n };
  }
  // מחיר: מה שכתוב בקובץ כמו שהוא (כולל "החל מ… ועד…"). מספר נקי בלבד מנורמל ל-250,000.
  function priceText(v) {
    var t = clean(v);
    if (/^[₪\s\d,.]*(ש\s*["״”]?\s*ח|שקלים|שקל)?\s*$/.test(t) && /\d/.test(t)) return moneyDigits(t);
    return t || null;
  }

  /* ───────── טבלאות שמות שדות ───────── */
  // k = מפתח פנימי, num = שדה מספרי (מוציאים את המספר מהטקסט)
  var SPEC_LABELS = {
    model:       ['דגם', 'שם הדגם', 'שם הרכב', 'רכב'],
    year:        ['שנה', 'שנתון', 'שנת דגם'],
    segment:     ['סגמנט', 'קטגוריה'],
    price:       ['מחיר', 'מחיר מחירון'],
    country:     ['מדינת ייצור', 'מדינה', 'מדינת מוצא'],
    trims:       ['גרסאות', 'רמות גימור', 'גימורים'],
    engine:      ['מנוע', 'סוג מנוע', 'סוג הנעה', 'מערכת הנעה', 'דלק'],
    power:       ['הספק', 'כוח סוס', 'כח סוס', 'כס', 'הספק כס'],
    torque:      ['מומנט', 'מומנט נמ', 'מומנט מנוע'],
    zero:        ['תאוצה', 'תאוצה 0-100', '0-100', '0 100', 'תאוצה 0 100', 'תאוצה מ-0 ל-100'],
    gearbox:     ['תיבת הילוכים', 'תיבה', 'תיבת הילוכים'],
    topspeed:    ['מהירות מרבית', 'מהירות מירבית', 'מהירות מקסימלית', 'מהירות מרבית קמש'],
    range:       ['טווח', 'טווח חשמלי', 'טווח נסיעה', 'טווח קמ'],
    trunk:       ['תא מטען', 'נפח תא מטען', 'תא מטען ליטר'],
    consumption: ['צריכת דלק', 'צריכה', 'צריכה משולבת', 'צריכת אנרגיה'],
    emission:    ['זיהום אוויר', 'דרגת זיהום', 'פליטות', 'דרגת זיהום אוויר']
  };
  var CAR_LABELS = {
    name:          ['שם הדגם', 'דגם', 'שם הרכב', 'שם'],
    trim:          ['גרסה', 'גרסת המבחן', 'גרסת מבחן', 'רמת גימור'],
    price:         ['מחיר', 'מחיר מחירון'],
    engine:        ['מערכת הנעה', 'מנוע', 'סוג מנוע', 'סוג הנעה'],
    power:         ['הספק', 'כוח סוס', 'כח סוס', 'כס', 'הספק כס'],
    torque:        ['מומנט', 'מומנט נמ', 'מומנט מנוע'],
    zeroToHundred: ['תאוצה', 'תאוצה 0-100', '0-100', '0 100', 'תאוצה 0 100'],
    topspeed:      ['מהירות מרבית', 'מהירות מירבית', 'מהירות מקסימלית'],
    gearbox:       ['תיבת הילוכים', 'תיבה'],
    drive:         ['הנעה', 'סוג ההנעה', 'הנעה קדמית אחורית'],
    range:         ['טווח חשמלי', 'טווח', 'טווח נסיעה'],
    battery:       ['סוללה', 'קיבולת סוללה', 'קיבולת הסוללה', 'סוללה קוטש'],
    consumption:   ['צריכה משולבת', 'צריכה', 'צריכת דלק'],
    trunk:         ['תא מטען', 'נפח תא מטען'],
    length:        ['אורך'],
    weight:        ['משקל'],
    safety:        ['בטיחות', 'דירוג בטיחות'],
    warranty:      ['אחריות'],
    segment:       ['קטגוריה', 'סגמנט'],
    year:          ['שנת דגם', 'שנה', 'שנתון'],
    country:       ['ארץ ייצור', 'מדינת ייצור', 'מדינה'],
    trims:         ['רמות גימור', 'גרסאות'],
    emission:      ['דרגת זיהום אוויר', 'דרגת זיהום', 'זיהום אוויר']
  };
  var CAR_NUMERIC = { power: 1, torque: 1, zeroToHundred: 1, topspeed: 1, range: 1, battery: 1, trunk: 1, length: 1, weight: 1 };
  var SPEC_NUMERIC = { power: 1, torque: 1, zero: 1, topspeed: 1, range: 1, trunk: 1, consumption: 1 };
  var SCORE_LABELS = {
    driving: ['נסיעה', 'חווית נהיגה', 'נהיגה'],
    design:  ['עיצוב'],
    tech:    ['טכנולוגיה', 'טק'],
    comfort: ['נוחות'],
    value:   ['ערך', 'תמורה', 'תמורה לכסף']
  };
  var META_LABELS = {
    title: ['כותרת', 'כותרת ראשית', 'כותרת הכתבה'],
    sub:   ['כותרת משנה', 'תקציר'],
    tags:  ['תגיות', 'תגים']
  };
  var WINNER_LABELS = ['זוכה', 'המנצח', 'מנצח', 'הזוכה'];

  function buildLookup(table) {
    var m = {};
    Object.keys(table).forEach(function (k) {
      table[k].forEach(function (a) { m[norm(a)] = k; });
    });
    return m;
  }
  var FUZZ_COMMON = [
    [/קיבולת סוללה|סוללה/, 'battery'], [/תא מטען/, 'trunk'], [/טווח/, 'range'], [/תאוצה|0 100/, 'zero'],
    [/מומנט/, 'torque'], [/הספק|כוח סוס|כח סוס/, 'power'], [/מהירות/, 'topspeed'], [/תיבת|תיבה/, 'gearbox'],
    [/זיהום|פליטות/, 'emission'], [/מחיר/, 'price'], [/צריכ/, 'consumption'], [/אחריות/, 'warranty'],
    [/בטיחות/, 'safety'], [/אורך/, 'length'], [/משקל/, 'weight'], [/ארץ|מדינת/, 'country'],
    [/שנת|שנתון/, 'year'], [/רמות|גרסאות|גימור/, 'trims'], [/סגמנט|קטגוריה/, 'segment'], [/מנוע|הנעה/, 'engine'],
    [/^ציון/, 'rating']
  ];
  function fuzzyKey(label) {
    var n = norm(label);
    for (var i = 0; i < FUZZ_COMMON.length; i++) if (FUZZ_COMMON[i][0].test(n)) return FUZZ_COMMON[i][1];
    return null;
  }
  // מפתחות של המפרט הכללי -> מפתחות כרטיס ההשוואה (null = לא נתמך בכרטיס)
  var SPEC2CAR = { zero: 'zeroToHundred', price: 'price', power: 'power', torque: 'torque', topspeed: 'topspeed',
    gearbox: 'gearbox', range: 'range', battery: 'battery', consumption: 'consumption', trunk: 'trunk',
    length: 'length', weight: 'weight', safety: 'safety', warranty: 'warranty', engine: 'engine',
    segment: 'segment', year: 'year', country: 'country', trims: 'trims', emission: 'emission' };
  var L_SPEC = buildLookup(SPEC_LABELS), L_CAR = buildLookup(CAR_LABELS),
      L_SCORE = buildLookup(SCORE_LABELS), L_META = buildLookup(META_LABELS);

  /* סימני סעיף — רק בסוגריים מרובעים, כדי שכותרת בתוך גוף הכתבה לעולם לא תתפרש כסעיף */
  var SECTION_ALIASES = {
    spec:       ['מפרט', 'מפרט טכני'],
    pros:       ['יתרונות'],
    cons:       ['חסרונות'],
    scores:     ['ציונים', 'ציוני קטגוריות'],
    faq:        ['שאלות נפוצות'],
    yt:         ['סרטונים', 'יוטיוב', 'סרטוני יוטיוב'],
    body:       ['גוף הכתבה', 'תוכן הכתבה', 'הכתבה'],
    verdict:    ['שורה תחתונה', 'סיכום ההשוואה'],
    comparison: ['מבחן השוואתי', 'השוואה'],
    meta:       ['פרטי הכתבה', 'פרטים']
  };
  var L_SECTION = buildLookup(SECTION_ALIASES);

  function sectionOf(text) {
    var t = clean(text);
    var m = t.match(/^[\[［]\s*(.+?)\s*[\]］]\s*:?$/);
    if (!m) return null;
    var name = norm(m[1]);
    var carM = name.match(/^(?:רכב|דגם)\s*(\d)$/);
    if (carM) return { sec: 'car', n: parseInt(carM[1], 10) };
    if (L_SECTION[name]) return { sec: L_SECTION[name] };
    return { sec: 'unknown', raw: m[1] };
  }

  function splitLabel(text) {
    var t = clean(text);
    var m = t.match(/^([^:：]{1,60})[:：]\s*(.*)$/);
    if (!m) return null;
    var val = m[2].trim();
    if (/^\(.*\)$/.test(val)) val = '';          // טקסט הנחיה בסוגריים = שדה ריק
    return { label: stripHint(m[1]), value: val };
  }

  /* ───────── אחידות ערכים ───────── */
  var ENGINE_SYN = [
    [/phev|פלאג|plug|נטען/i, 'PHEV'],
    [/חשמל|ev\b|bev/i, 'חשמלי'],
    [/היברידי|הייבריד|hybrid|hev/i, 'היברידי'],
    [/דיזל|diesel/i, 'דיזל'],
    [/בנזין|petrol|gasoline/i, 'בנזין']
  ];
  function matchEngine(v) {
    for (var i = 0; i < ENGINE_SYN.length; i++) if (ENGINE_SYN[i][0].test(v)) return ENGINE_SYN[i][1];
    return null;
  }
  function matchOption(v, options) {
    var nv = norm(v);
    if (!nv) return null;
    var i, o;
    for (i = 0; i < options.length; i++) if (norm(options[i]) === nv) return options[i];
    // התאמה "מכיל" — רק אם חד-משמעית (בדיוק אפשרות אחת)
    var hits = options.filter(function (o2) { var no = norm(o2); return no.indexOf(nv) !== -1 || nv.indexOf(no) !== -1; });
    return hits.length === 1 ? hits[0] : null;
  }

  /* ───────── הניתוח עצמו ─────────
     blocks: [{k:'h1'|'h2'|'h3'|'p'|'li'|'q'|'row', text, cells?}]
     opts.segments / opts.gearboxes: רשימות האפשרויות מהטופס (לבדיקת התאמה) */
  function parseBlocks(blocks, opts) {
    opts = opts || {};
    var res = {
      meta: {}, spec: {}, pros: [], cons: [], scores: {}, faq: [], yt: [], body: [],
      cars: [], verdict: [], winnerRaw: null, comparison: false,
      found: [], warnings: [], notes: []
    };
    var warn = function (m) { res.warnings.push(m); };
    var note = function (m) { if (res.notes.indexOf(m) === -1) res.notes.push(m); };
    var found = function (label, value) { res.found.push({ label: label, value: value }); };

    var sec = 'meta', car = null, curCarIdx = -1;
    var bodyExplicit = blocks.some(function (b) { var s = sectionOf(b.text); return s && s.sec === 'body'; });
    var looseBody = [];
    var seen = {};

    function carObj() {
      if (curCarIdx < 0) return null;
      return res.cars[curCarIdx];
    }

    blocks.forEach(function (b) {
      var text = clean(b.text);
      if (!text && b.k !== 'row') return;

      if (b.k !== 'row' && /^(הוראות|תבנית|הדבק כאן|כתוב כאן)/.test(text)) return;
      var s = (b.k === 'row') ? null : sectionOf(text);
      if (s) {
        if (s.sec === 'unknown') { warn('סימן סעיף לא מוכר: [' + s.raw + '] — דולג'); return; }
        if (s.sec === 'car') {
          res.comparison = true;
          curCarIdx = s.n - 1;
          while (res.cars.length <= curCarIdx) res.cars.push({ f: {}, pros: [], cons: [], scores: {} });
          sec = 'car'; seen = {};
          return;
        }
        if (s.sec === 'comparison') { res.comparison = true; return; }
        if (s.sec === 'pros' || s.sec === 'cons' || s.sec === 'scores') { sec = s.sec; seen = {}; return; }
        if (s.sec === 'spec' || s.sec === 'meta') { sec = s.sec; curCarIdx = -1; seen = {}; return; }
        // faq / yt / body / verdict סוגרים את הקשר הרכב
        sec = s.sec; curCarIdx = -1; seen = {};
        return;
      }

      // טקסט של שורה בטבלה: [תווית | ערך] -> "תווית: ערך"
      var line = text;
      if (b.k === 'row') {
        var cells = (b.cells || []).map(clean).filter(function (c, i) { return i < 2 || c; });
        if (cells.length >= 2 && cells[0]) line = stripHint(cells[0].replace(/[:：]\s*$/, '')) + ': ' + (/^\(.*\)$/.test(cells[1]) ? '' : cells[1]);
        else line = cells.join(' ');
        line = clean(line);
        if (!line) return;
      }

      // ---- יתרונות / חסרונות (בתוך רכב או בכתבה בודדת)
      var inCarList = (sec === 'pros' || sec === 'cons');
      if (inCarList) {
        var item = line.replace(/^[•\-–—*·●▪]\s*/, '').trim();
        if (!item) return;
        var tgt = (curCarIdx >= 0) ? carObj()[sec] : res[sec];
        tgt.push(item);
        return;
      }

      if (sec === 'scores') {
        var sl = splitLabel(line);
        if (!sl) { warn('בסעיף ציונים: שורה בלי ":" — ' + line); return; }
        if (!sl.value) return;
        var key = L_SCORE[norm(sl.label)];
        if (!key) { warn('ציון לא מוכר: "' + sl.label + '" (מותר: נסיעה, עיצוב, טכנולוגיה, נוחות, ערך)'); return; }
        var n = parseFloat(firstNumber(sl.value));
        if (!(n >= 1 && n <= 10)) { warn('ציון "' + sl.label + '" חייב להיות בין 1 ל-10 (נמצא: "' + sl.value + '")'); return; }
        var holder = (curCarIdx >= 0) ? carObj().scores : res.scores;
        holder[key] = n;
        found((curCarIdx >= 0 ? 'רכב ' + (curCarIdx + 1) + ' · ' : '') + 'ציון ' + sl.label, String(n));
        return;
      }

      if (sec === 'faq') {
        var fl = splitLabel(line);
        if (fl && /^ש(אלה)?\s*\d*$/.test(norm(fl.label))) { if (fl.value) res.faq.push({ q: fl.value, a: '' }); return; }
        if (fl && /^ת(שובה)?\s*\d*$/.test(norm(fl.label))) {
          if (!fl.value) return;
          var last = res.faq[res.faq.length - 1];
          if (!last || last.a) { warn('תשובה בלי שאלה לפניה: ' + fl.value); return; }
          last.a = fl.value; return;
        }
        warn('בשאלות נפוצות יש להשתמש ב"ש:" ו"ת:" — שורה דולגה: ' + line);
        return;
      }

      if (sec === 'yt') {
        var urls = line.match(/https?:\/\/[^\s)]+/g);
        if (urls) urls.forEach(function (u) { if (!/[?&]v=$|youtu\.be\/$/.test(u)) res.yt.push(u); });
        else if (line) warn('בסעיף סרטונים: לא נמצא קישור בשורה — ' + line);
        return;
      }

      if (sec === 'verdict') {
        var vl = splitLabel(line);
        if (vl && WINNER_LABELS.map(norm).indexOf(norm(vl.label)) !== -1) { res.winnerRaw = vl.value; return; }
        res.verdict.push(line);
        return;
      }

      if (sec === 'body') {
        res.body.push(blockToBodyLine(b, text));
        return;
      }

      // ---- סעיפי "שדה: ערך": meta / spec / car
      var lv = splitLabel(line);
      if (sec === 'meta') {
        if (lv) {
          var mk = L_META[norm(lv.label)];
          if (mk && !lv.value) return;
          if (mk) {
            if (res.meta[mk]) warn('השדה "' + lv.label + '" מופיע פעמיים — נלקח הראשון');
            else { res.meta[mk] = lv.value; found(lv.label, lv.value); }
            return;
          }
        }
        if (!bodyExplicit) { looseBody.push(blockToBodyLine(b, text)); return; }
        warn('שורה מחוץ לסעיף מוכר דולגה: ' + line.slice(0, 60));
        return;
      }

      if (sec === 'spec') {
        if (!lv) { warn('במפרט: שורה בלי ":" דולגה — ' + line.slice(0, 60)); return; }
        var k = L_SPEC[norm(lv.label)] || fuzzyKey(lv.label);
        if (k === 'rating') { note('"' + lv.label + '" לא נכנס לטופס (הדירוג הכולל נשאר ידני)'); return; }
        if (!k || k === 'battery' || k === 'warranty' || k === 'safety' || k === 'length' || k === 'weight') {
          if (k) { note('במבחן בודד אין שדה ל"' + lv.label + '" — לא נכנס לטופס'); return; }
          warn('במפרט: שדה לא מוכר "' + lv.label + '" — דולג'); return;
        }
        if (seen[k]) { warn('במפרט: "' + lv.label + '" מופיע פעמיים — נלקח הראשון'); return; }
        seen[k] = 1;
        setSpec(res, k, lv, opts, warn, found, note);
        return;
      }

      if (sec === 'car') {
        if (!lv) { warn('ברכב ' + (curCarIdx + 1) + ': שורה בלי ":" דולגה — ' + line.slice(0, 60)); return; }
        var lblN = norm(lv.label);
        if (lblN === 'יתרון' || lblN === 'חסרון') { carObj()[lblN === 'יתרון' ? 'pros' : 'cons'].push(lv.value); return; }
        if (lblN === 'יתרונות' || lblN === 'חסרונות') {
          var arr = lv.value.split(/\s*[;•|]\s*/).map(clean).filter(Boolean);
          arr.forEach(function (x) { carObj()[lblN === 'יתרונות' ? 'pros' : 'cons'].push(x); });
          return;
        }
        var ck = L_CAR[lblN];
        if (!ck) {
          var fk = fuzzyKey(lv.label);
          if (fk === 'rating') { note('"' + lv.label + '" לא נכנס (הדירוג הכולל נשאר ידני)'); return; }
          if (fk && SPEC2CAR[fk]) ck = SPEC2CAR[fk];
          else if (fk) { note('כרטיס ההשוואה לא כולל שדה ל"' + lv.label + '" — לא נכנס'); return; }
        }
        if (!ck) { warn('ברכב ' + (curCarIdx + 1) + ': שדה לא מוכר "' + lv.label + '" — דולג'); return; }
        if (seen[ck]) { warn('ברכב ' + (curCarIdx + 1) + ': "' + lv.label + '" מופיע פעמיים — נלקח הראשון'); return; }
        seen[ck] = 1;
        var cv = lv.value;
        if (!cv) return;
        if (ck === 'price') {
          var md = priceText(cv);
          if (!md || !/\d/.test(md)) { warn('רכב ' + (curCarIdx + 1) + ': מחיר ללא מספר — "' + cv + '"'); return; }
          cv = md;
        } else if (ck === 'emission') {
          var en = firstNumber(cv);
          if (en === null || +en < 0 || +en > 15) { warn('רכב ' + (curCarIdx + 1) + ': דרגת זיהום חייבת להיות 0-15 (נמצא: "' + cv + '")'); return; }
          cv = String(parseInt(en, 10));
        } else if (ck === 'year') {
          var yy = (cv.match(/(19|20)\d{2}/) || [])[0];
          if (!yy) { warn('רכב ' + (curCarIdx + 1) + ': שנה לא תקינה — "' + cv + '"'); return; }
          cv = yy;
        } else if (CAR_NUMERIC[ck]) {
          var nu2 = numWithUnit(ck, cv);
          if (!nu2) { warn('רכב ' + (curCarIdx + 1) + ': "' + lv.label + '" אמור להיות מספר (נמצא: "' + cv + '")'); return; }
          if (nu2.conv) note('רכב ' + (curCarIdx + 1) + ': מומנט הומר מנ"מ לקג"מ (' + cv + ' ← ' + nu2.n + ')');
          cv = nu2.n;
        }
        carObj().f[ck] = cv;
        found('רכב ' + (curCarIdx + 1) + ' · ' + lv.label, cv);
        return;
      }
    });

    // רכבים ריקים לגמרי (תבנית שלא מולאה עד הסוף, למשל רכב 3-4) — מסירים בשקט
    res.cars = res.cars.filter(function (c) {
      return c && (Object.keys(c.f).length || c.pros.length || c.cons.length || Object.keys(c.scores).length);
    });
    // גוף הכתבה "רופף" (אם לא סומן [גוף הכתבה])
    if (!bodyExplicit && looseBody.length) {
      res.body = looseBody;
      warn('לא נמצא סעיף [גוף הכתבה] — כל הטקסט החופשי נלקח כגוף הכתבה. מומלץ לסמן במפורש.');
    }
    if (res.body.length) found('גוף הכתבה', res.body.length + ' פסקאות/כותרות');

    // ---- בדיקות סופיות
    if (!res.meta.title) {
      var h1 = blocks.filter(function (b) { return b.k === 'h1' && clean(b.text) && !sectionOf(b.text); })[0];
      if (h1) { res.meta.title = clean(h1.text); warn('לא נמצא "כותרת:" — נלקחה הכותרת הראשונה של המסמך: ' + res.meta.title); }
      else warn('לא נמצאה כותרת לכתבה ("כותרת: ...")');
    }
    if (res.comparison) {
      var named = res.cars.filter(function (c) { return c && c.f && c.f.name; });
      if (named.length < 2) warn('מבחן השוואתי: נמצאו פחות מ-2 דגמים עם שם');
      res.cars.forEach(function (c, i) {
        if (!c.f || !c.f.name) warn('רכב ' + (i + 1) + ' ללא שם דגם');
      });
      if (res.cars.length > 4) { warn('נמצאו יותר מ-4 דגמים — רק 4 הראשונים ייובאו'); res.cars = res.cars.slice(0, 4); }
    } else if (!Object.keys(res.spec).length && !res.meta.title) {
      warn('לא זוהה שום תוכן — בדוק שהקובץ בנוי לפי התבנית');
    }
    if (res.faq.length > 4) warn('נמצאו ' + res.faq.length + ' שאלות נפוצות — רק 4 ראשונות ייובאו');
    res.faq.forEach(function (q, i) { if (!q.q || !q.a) warn('שאלה נפוצה ' + (i + 1) + ' חסרה שאלה או תשובה'); });
    if (res.yt.length > 4) warn('נמצאו יותר מ-4 סרטונים — רק 4 ראשונים ייובאו');
    return res;
  }

  function setSpec(res, k, lv, opts, warn, found, note) {
    var v = lv.value;
    if (!v) return;
    if (k === 'engine') {
      var e = matchEngine(v);
      if (!e) { warn('במפרט: סוג מנוע "' + v + '" לא מזוהה (מותר: בנזין, דיזל, היברידי, חשמלי, PHEV)'); return; }
      res.spec.engine = e; found(lv.label, e); return;
    }
    if (k === 'segment') {
      var seg = matchOption(v, opts.segments || []);
      if (!seg && /suv|פנאי|שטח|ג'יפ/i.test(v)) {
        var want = /גדול/.test(v) ? 'SUV גדול' : /בינוני/.test(v) ? 'SUV בינוני' : /קומפקטי|קטן/.test(v) ? 'SUV קומפקטי' : null;
        if (want) seg = matchOption(want, opts.segments || []);
      }
      if (!seg) { warn('במפרט: סגמנט "' + v + '" לא קיים ברשימה — בחר ידנית בטופס'); return; }
      res.spec.segment = seg; found(lv.label, seg); return;
    }
    if (k === 'gearbox') {
      var gb = matchOption(v, opts.gearboxes || []);
      if (!gb) { warn('במפרט: תיבה "' + v + '" לא קיימת ברשימה — בחר ידנית בטופס'); return; }
      res.spec.gearbox = gb; found(lv.label, gb); return;
    }
    if (k === 'emission') {
      var n = firstNumber(v);
      if (n === null || +n < 0 || +n > 15) { warn('במפרט: דרגת זיהום חייבת להיות 0-15 (נמצא: "' + v + '")'); return; }
      res.spec.emission = String(parseInt(n, 10)); found(lv.label, res.spec.emission); return;
    }
    if (k === 'price') {
      var md = priceText(v);
      if (!md || !/\d/.test(md)) { warn('במפרט: מחיר ללא מספר — "' + v + '"'); return; }
      res.spec.price = md; found(lv.label, md); return;
    }
    if (k === 'year') {
      var y = (v.match(/(19|20)\d{2}/) || [])[0];
      if (!y) { warn('במפרט: שנה לא תקינה — "' + v + '"'); return; }
      res.spec.year = y; found(lv.label, y); return;
    }
    if (SPEC_NUMERIC[k]) {
      var nu = numWithUnit(k, v);
      if (!nu) { warn('במפרט: "' + lv.label + '" אמור להיות מספר (נמצא: "' + v + '")'); return; }
      if (nu.conv) note('מומנט הומר מנ"מ לקג"מ: ' + v + ' ← ' + nu.n);
      res.spec[k] = nu.n; found(lv.label, nu.n); return;
    }
    res.spec[k] = v; found(lv.label, v);
  }

  function blockToBodyLine(b, text) {
    if (b.k === 'h1' || b.k === 'h2') return '## ' + text;
    if (b.k === 'h3') return '### ' + text;
    if (b.k === 'q') return '> ' + text;
    if (b.k === 'li') return '• ' + text;
    return b.md != null ? clean(b.md) : text;
  }

  /* ───────── מבנה חופשי (בלי סימני [סעיף]) ─────────
     מזהה: כותרת = הפסקה המודגשת הראשונה; גוף = הכול עד "מפרטים:"; כל פסקה מודגשת לגמרי = כותרת פנימית;
     אחרי "מפרטים:" כל "דגם: X" פותח רכב חדש. "סיכום:" -> שורה תחתונה. "המנצח במבחן: X" -> זוכה. */
  function hasMarkers(blocks) {
    return blocks.some(function (b) { return b.k !== 'row' && sectionOf(b.text); });
  }
  function freeformToBlocks(blocks) {
    var out = [];
    var P = function (t) { out.push({ k: 'p', text: t }); };
    var specIdx = -1, i;
    for (i = 0; i < blocks.length; i++) {
      var t0 = clean(blocks[i].text);
      if (/^מפרט(ים| טכני)?\s*[:：]?$/.test(t0)) { specIdx = i; break; }
    }
    if (specIdx === -1) {
      for (i = 0; i < blocks.length; i++) if (/^דגם\s*[:：]/.test(clean(blocks[i].text))) { specIdx = i; break; }
    }
    var pre = specIdx === -1 ? blocks.slice() : blocks.slice(0, specIdx);
    var post = specIdx === -1 ? [] : blocks.slice(specIdx);

    // כותרת: הפסקה המודגשת הראשונה (שורות פתיחה כמו "בס"ד" / "נסיעת מבחן" לפניה מדולגות)
    var titleIdx = -1;
    for (i = 0; i < pre.length; i++) {
      if (pre[i].allBold && clean(pre[i].text).length >= 8) { titleIdx = i; break; }
    }
    var title = titleIdx >= 0 ? clean(pre[titleIdx].text) : '';
    var bodyBlocks = titleIdx >= 0 ? pre.slice(titleIdx + 1) : pre;

    // סיכום / זוכה
    var verdict = '', winner = '';
    var body2 = [];
    bodyBlocks.forEach(function (b) {
      var t = clean(b.text);
      var vm = t.match(/^סיכום\s*[:：]\s*(.+)$/);
      if (vm && !verdict) { verdict = vm[1]; return; }              // לא נשאר בגוף כדי לא להיכפל
      var wm = t.match(/^המנצח( במבחן)?\s*[:：]\s*([^–—\-]+?)(\s*[–—\-]|$)/);
      if (wm && !winner) winner = clean(wm[2]);
      body2.push(b);
    });

    // רכבים
    var cars = [], cur = null;
    post.forEach(function (b) {
      var t = clean(b.text);
      if (!t || /^מפרט(ים| טכני)?\s*[:：]?$/.test(t)) return;
      var lv = splitLabel(t);
      if (lv && norm(lv.label) === 'דגם') { cur = [t]; cars.push(cur); return; }
      if (cur) cur.push(t);
    });

    // כותרת משנה: הפסקאות שבין הכותרת לכותרת הפנימית (המודגשת) הראשונה
    var sub = '';
    var firstHead = -1;
    for (i = 0; i < body2.length; i++) if (body2[i].allBold) { firstHead = i; break; }
    if (firstHead > 0) {
      sub = body2.slice(0, firstHead).map(function (b) { return clean(b.text); }).filter(Boolean).join(' ');
      body2 = body2.slice(firstHead);
    }

    // יתרונות/חסרונות מסיכום הדגמים: "מקום N: <דגם>" / "המנצח במבחן: <דגם>" פותחים דגם; הפסקה שאחריו = יתרון;
    // "החסרונות במבחן: ..." = חסרון. הטקסט נכנס כמו שהוא (פריט אחד לכל פסקה) והפסקאות נשארות גם בגוף הכתבה.
    var carNames = cars.map(function (lines) { var l = splitLabel(lines[0]); return l ? norm(l.value) : ''; });
    var pcByCar = {};
    if (cars.length >= 2) {
      var curCar = -1;
      body2.forEach(function (b) {
        var t = clean(b.text);
        var mm = t.match(/^(?:מקום\s*\d+|המנצח(?: במבחן)?)\s*[:：]\s*([^–—]+?)\s*(?:[–—]|\s-\s|$)/);
        if (mm) {
          var nm = norm(mm[1]);
          curCar = -1;
          carNames.forEach(function (cn, ci) { if (cn && (cn.indexOf(nm) !== -1 || nm.indexOf(cn) !== -1)) curCar = ci; });
          return;
        }
        if (curCar < 0) return;
        if (b.allBold) { curCar = -1; return; }
        var cm = t.match(/^החסרונות(?: במבחן)?\s*[:：]\s*(.+)$/) || t.match(/^חסרונות\s*[:：]\s*(.+)$/);
        pcByCar[curCar] = pcByCar[curCar] || { pros: [], cons: [] };
        if (cm) pcByCar[curCar].cons.push(cm[1]);
        else if (!pcByCar[curCar].pros.length) pcByCar[curCar].pros.push(t);
      });
    }

    P('[פרטי הכתבה]');
    if (title) P('כותרת: ' + title);
    if (sub) P('כותרת משנה: ' + sub);
    if (cars.length >= 2) {
      P('[מבחן השוואתי]');
      cars.forEach(function (lines, n) {
        P('[רכב ' + (n + 1) + ']'); lines.forEach(P);
        var pc = pcByCar[n];
        if (pc) { pc.pros.forEach(function (x) { P('יתרון: ' + x); }); pc.cons.forEach(function (x) { P('חסרון: ' + x); }); }
      });
      P('[שורה תחתונה]');
      if (winner) P('זוכה: ' + winner);
      if (verdict) P(verdict);
    } else if (cars.length === 1) {
      P('[מפרט]'); cars[0].forEach(P);
    }
    P('[גוף הכתבה]');
    body2.forEach(function (b) {
      if (b.allBold) out.push({ k: 'h2', text: clean(b.text) });
      else out.push(b);
    });
    return out;
  }

  function parse(blocks, opts) {
    var ff = !hasMarkers(blocks);
    var res = parseBlocks(ff ? freeformToBlocks(blocks) : blocks, opts);
    res.freeform = ff;
    if (ff) {
      res.notes.push('הקובץ נקרא במבנה חופשי (בלי תבנית): כותרת = הפסקה המודגשת הראשונה, כותרות פנימיות = פסקאות מודגשות לגמרי, מפרט = אחרי "מפרטים:".');
      if (res.comparison && res.cars.length) {
        var withPC = res.cars.filter(function (c) { return c.pros.length || c.cons.length; }).length;
        if (withPC) res.notes.push('יתרונות/חסרונות נלקחו מפסקאות הסיכום לפי דגם ("מקום N" / "המנצח" / "החסרונות במבחן") — כל פסקה נכנסה כפריט אחד, כמו שהיא. לסידור ידני בטופס.');
        if (withPC < res.cars.length) res.notes.push('ל-' + (res.cars.length - withPC) + ' דגמים לא נמצאו יתרונות/חסרונות — נשארו ריקים.');
        res.notes.push('ציוני הקטגוריות (נסיעה/עיצוב/...) לא נמצאו — הזוכה נלקח מהטקסט ("המנצח במבחן") ולא מחושב.');
      }
    }
    return res;
  }

  /* ───────── HTML של mammoth -> בלוקים ───────── */
  function inlineMd(node) {
    var out = '';
    node.childNodes.forEach(function (ch) {
      if (ch.nodeType === 3) out += ch.nodeValue;
      else if (ch.nodeType === 1) {
        var tag = ch.tagName.toLowerCase();
        if (tag === 'br') out += ' ';
        else if (tag === 'strong' || tag === 'b') {
          var inner = inlineMd(ch);
          out += inner.trim() ? '**' + inner.trim() + '** ' : inner;
        } else out += inlineMd(ch);
      }
    });
    return out;
  }
  function htmlToBlocks(html, DOMParserCtor) {
    var P = DOMParserCtor || (typeof DOMParser !== 'undefined' ? DOMParser : null);
    if (!P) throw new Error('DOMParser לא זמין');
    var doc = new P().parseFromString('<div id="r">' + html + '</div>', 'text/html');
    var rootEl = doc.getElementById('r');
    var blocks = [];
    function walk(el) {
      Array.prototype.forEach.call(el.children, function (ch) {
        var tag = ch.tagName.toLowerCase();
        if (/^h[1-6]$/.test(tag)) {
          var lvl = parseInt(tag[1], 10);
          blocks.push({ k: lvl <= 1 ? 'h1' : (lvl === 2 ? 'h2' : 'h3'), text: clean(ch.textContent) });
        } else if (tag === 'p') {
          var md = clean(inlineMd(ch)).replace(/\*\*\s+\*\*/g, ' ').replace(/\*\*\*\*/g, '');
          blocks.push({ k: 'p', text: clean(ch.textContent), md: md,
            allBold: /^\*\*[^*]+\*\*$/.test(md) });
        } else if (tag === 'blockquote') {
          blocks.push({ k: 'q', text: clean(ch.textContent) });
        } else if (tag === 'ul' || tag === 'ol') {
          Array.prototype.forEach.call(ch.children, function (li) {
            if (li.tagName.toLowerCase() === 'li') blocks.push({ k: 'li', text: clean(li.textContent), md: clean(inlineMd(li)) });
          });
        } else if (tag === 'table') {
          Array.prototype.forEach.call(ch.querySelectorAll('tr'), function (tr) {
            var cells = Array.prototype.map.call(tr.children, function (td) { return clean(td.textContent); });
            blocks.push({ k: 'row', text: cells.join(' | '), cells: cells });
          });
        } else {
          walk(ch);
        }
      });
    }
    walk(rootEl);
    return blocks;
  }

  /* ───────── יצירת specs להשוואה ───────── */
  function buildComparisonSpecs(res) {
    var cars = res.cars.map(function (c) {
      var o = {};
      Object.keys(c.f).forEach(function (k) { o[k] = c.f[k]; });
      o.scores = c.scores || {};
      o.pros = c.pros || [];
      o.cons = c.cons || [];
      return o;
    });
    var winner = 'auto';
    if (res.winnerRaw) {
      var w = clean(res.winnerRaw);
      var n = parseInt(firstNumber(w) || '', 10);
      if (/^\d$/.test(w) && n >= 1 && n <= cars.length) winner = n - 1;
      else if (norm(w) !== 'אוטומטי' && norm(w) !== 'auto') {
        var idx = cars.findIndex(function (c) { return c.name && norm(c.name).indexOf(norm(w)) !== -1; });
        if (idx !== -1) winner = idx;
        else res.warnings.push('זוכה "' + w + '" לא זוהה — הוגדר "אוטומטי"');
      }
    }
    return { mode: 'comparison', cars: cars, winner: winner, verdict: res.verdict.join(' ') };
  }

  var api = {
    parseBlocks: parseBlocks,
    parse: parse,
    htmlToBlocks: htmlToBlocks,
    buildComparisonSpecs: buildComparisonSpecs,
    _norm: norm
  };

  /* ═════════ ממשק הדפדפן ═════════ */
  if (typeof document === 'undefined') return api;

  var MAMMOTH_URL = 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js';
  var mammothPromise = null;
  function loadMammoth() {
    if (window.mammoth) return Promise.resolve(window.mammoth);
    if (mammothPromise) return mammothPromise;
    mammothPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = MAMMOTH_URL;
      s.onload = function () { window.mammoth ? resolve(window.mammoth) : reject(new Error('mammoth לא נטען')); };
      s.onerror = function () { mammothPromise = null; reject(new Error('טעינת רכיב הקריאה של Word נכשלה (בדוק חיבור לאינטרנט)')); };
      document.head.appendChild(s);
    });
    return mammothPromise;
  }

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function optionTexts(id) {
    var el = $(id);
    if (!el) return [];
    return Array.prototype.map.call(el.options, function (o) { return o.value || o.text; }).filter(function (t) { return t && t.indexOf('בחר') !== 0; });
  }
  function setVal(id, v) {
    var el = $(id);
    if (!el) return false;
    el.value = v == null ? '' : v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function applyToForm(res) {
    // 1. קטגוריה = מבחן רכב
    var cat = $('a-cat');
    if (cat) {
      cat.value = 'review';
      if (typeof window.toggleSpecsSection === 'function') window.toggleSpecsSection('review');
      if (typeof window.updateCatBreadcrumbPreview === 'function') { try { window.updateCatBreadcrumbPreview('review'); } catch (e) {} }
    }
    // 2. פרטי כתבה
    if (res.meta.title) setVal('a-title', res.meta.title);
    if (res.meta.sub) setVal('a-sub', res.meta.sub);
    if (res.meta.tags) setVal('a-tags', res.meta.tags);
    if (res.body.length) setVal('a-body', res.body.join('\n\n'));

    // 3. מפרט / השוואה
    if (res.comparison && window.spCompare && typeof window.spCompare.load === 'function') {
      window.spCompare.load(buildComparisonSpecs(res));
    } else {
      if (window.spCompare && typeof window.spCompare.reset === 'function') window.spCompare.reset();
      var map = { model: 'spec-model', year: 'spec-year', segment: 'spec-segment', price: 'spec-price', country: 'spec-country',
        trims: 'spec-trims', engine: 'spec-engine', power: 'spec-power', torque: 'spec-torque', zero: 'spec-zero',
        gearbox: 'spec-gearbox', topspeed: 'spec-topspeed', range: 'spec-range', trunk: 'spec-trunk',
        consumption: 'spec-consumption', emission: 'spec-emission' };
      Object.keys(map).forEach(function (k) { if (res.spec[k] != null) setVal(map[k], res.spec[k]); });
      if (res.spec.engine && typeof window.toggleRangeField === 'function') window.toggleRangeField(res.spec.engine);
      setVal('spec-pros', res.pros.join('\n'));
      setVal('spec-cons', res.cons.join('\n'));
      var sc = { driving: 'score-driving', design: 'score-design', tech: 'score-tech', comfort: 'score-comfort', value: 'score-value' };
      Object.keys(sc).forEach(function (k) { setVal(sc[k], res.scores[k] != null ? res.scores[k] : ''); });
    }
    // 4. שאלות נפוצות + יוטיוב
    for (var i = 1; i <= 4; i++) {
      var q = res.faq[i - 1];
      setVal('faq-q-' + i, q ? q.q : ''); setVal('faq-a-' + i, q ? q.a : '');
      setVal('yt-url-' + i, res.yt[i - 1] || '');
    }
  }

  function showReport(res, fileName) {
    var old = $('sp-docx-modal'); if (old) old.remove();
    var warns = res.warnings, found = res.found;
    var h = '<div id="sp-docx-modal" dir="rtl" style="position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit;">' +
      '<div style="background:#fff;color:#111;border-radius:12px;max-width:760px;width:100%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.4);">' +
      '<div style="padding:16px 20px;border-bottom:1px solid #e5e5e5;"><strong style="font-size:1.05rem;">📄 ייבוא מ-Word — סיכום לפני החלה</strong>' +
      '<div style="font-size:.8rem;color:#666;margin-top:4px;">' + esc(fileName) + ' · ' + (res.comparison ? 'מבחן השוואתי (' + res.cars.length + ' דגמים)' : 'מבחן רכב בודד') + '</div></div>' +
      '<div style="padding:14px 20px;overflow:auto;flex:1;">';
    if (warns.length) {
      h += '<div style="background:#fff4e5;border:1px solid #f5b971;border-radius:8px;padding:10px 14px;margin-bottom:14px;"><strong style="color:#b45309;">⚠️ ' + warns.length + ' דברים לבדיקה:</strong><ul style="margin:6px 18px 0;font-size:.85rem;line-height:1.6;">' +
        warns.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>';
    } else {
      h += '<div style="background:#ecfdf3;border:1px solid #86efac;border-radius:8px;padding:10px 14px;margin-bottom:14px;color:#166534;">✅ הכול זוהה, אין אזהרות.</div>';
    }
    if (res.notes && res.notes.length) {
      h += '<div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:.82rem;line-height:1.6;color:#312e81;"><strong>ℹ️ הערות:</strong><ul style="margin:4px 18px 0;">' +
        res.notes.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>';
    }
    h += '<strong style="font-size:.9rem;">מה ייכנס לטופס (' + found.length + ' שדות):</strong>' +
      '<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:.84rem;">' +
      found.map(function (f) {
        return '<tr style="border-bottom:1px solid #eee;"><td style="padding:4px 8px;color:#555;white-space:nowrap;width:1%;">' + esc(f.label) + '</td><td style="padding:4px 8px;">' + esc(f.value.length > 120 ? f.value.slice(0, 120) + '…' : f.value) + '</td></tr>';
      }).join('') + '</table>';
    h += '<p style="font-size:.78rem;color:#666;margin-top:12px;">ההחלה תדרוס את מה שכבר בטופס בשדות אלה. תמונות, שם כותב, זמן קריאה ודירוג כולל נשארים ידניים.</p>';
    h += '</div><div style="padding:12px 20px;border-top:1px solid #e5e5e5;display:flex;gap:10px;justify-content:flex-start;">' +
      '<button type="button" id="sp-docx-apply" style="background:#e8001d;color:#fff;border:0;border-radius:8px;padding:10px 20px;font-weight:700;cursor:pointer;">החל על הטופס</button>' +
      '<button type="button" id="sp-docx-cancel" style="background:#eee;color:#111;border:0;border-radius:8px;padding:10px 20px;cursor:pointer;">ביטול</button></div></div></div>';
    document.body.insertAdjacentHTML('beforeend', h);
    $('sp-docx-cancel').onclick = function () { $('sp-docx-modal').remove(); };
    $('sp-docx-apply').onclick = function () {
      try { applyToForm(res); } catch (e) { alert('שגיאה בהחלה על הטופס: ' + (e && e.message || e)); }
      $('sp-docx-modal').remove();
      var t = $('a-title'); if (t && t.scrollIntoView) t.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  }

  function handleFile(file) {
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) { alert('יש להעלות קובץ Word בפורמט .docx (לא .doc ולא PDF).'); return; }
    var btn = $('sp-docx-btn');
    var orig = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ קורא את הקובץ…'; }
    Promise.all([loadMammoth(), file.arrayBuffer()]).then(function (r) {
      return r[0].convertToHtml({ arrayBuffer: r[1] });
    }).then(function (out) {
      var blocks = htmlToBlocks(out.value);
      var res = parse(blocks, { segments: optionTexts('spec-segment'), gearboxes: optionTexts('spec-gearbox') });
      showReport(res, file.name);
    }).catch(function (e) {
      alert('קריאת הקובץ נכשלה: ' + (e && e.message || e));
    }).then(function () {
      if (btn) { btn.disabled = false; btn.textContent = orig; }
      var inp = $('sp-docx-file'); if (inp) inp.value = '';
    });
  }

  function mount() {
    if ($('sp-docx-btn')) return;
    var block = document.querySelector('#admin-new .form-block');
    if (!block) return;
    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 16px;padding:12px 14px;border:1.5px dashed var(--border,#bbb);border-radius:10px;';
    wrap.innerHTML = '<button type="button" id="sp-docx-btn" style="background:#1d4ed8;color:#fff;border:0;border-radius:8px;padding:9px 16px;font-weight:700;cursor:pointer;">📄 ייבוא כתבה מקובץ Word</button>' +
      '<input type="file" id="sp-docx-file" accept=".docx" style="display:none;">' +
      '<span style="font-size:.8rem;color:#666;">מבחן רכב / מבחן השוואתי · תבניות להורדה: ' +
      '<a href="/templates/test-drive-template.docx" download>מבחן בודד</a> · <a href="/templates/comparison-template.docx" download>מבחן השוואתי</a></span>';
    var h3 = block.querySelector('h3');
    if (h3 && h3.nextSibling) block.insertBefore(wrap, h3.nextSibling); else block.insertBefore(wrap, block.firstChild);
    $('sp-docx-btn').addEventListener('click', function () { $('sp-docx-file').click(); });
    $('sp-docx-file').addEventListener('change', function (e) { handleFile(e.target.files && e.target.files[0]); });
  }

  function init() { mount(); }
  if (document.readyState === 'complete' || document.readyState === 'interactive') init();
  else document.addEventListener('DOMContentLoaded', init);
  window.addEventListener('load', init);

  return api;
});
