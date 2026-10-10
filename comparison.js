/* ═══ ספידומטר — מבחן השוואתי (comparison.js) ═══
   מודול עצמאי למבחן השוואתי של 2-4 דגמים, בתוך קטגוריית "מבחן רכב".
   הנתונים נשמרים בעמודת specs הקיימת של הכתבה, בצורה:
     { mode:'comparison', cars:[...], winner:'auto'|<index>, verdict:'...' }
   כך אין צורך בשינוי טבלה, וכתבות מבחן רגילות לא מושפעות בכלל.

   הקובץ משמש בשני מקומות:
   1. בדפדפן (index.html, נטען לפני app.js): window.spCompare —
      רינדור הכתבה + טופס הניהול.
   2. ב-Node (scripts/generate-static-pages.mjs): require('../comparison.js') —
      אותה פונקציית render בדיוק, כדי שהדף הסטטי יכיל את טבלת ההשוואה
      (גוגל רואה את כל הנתונים ב-HTML הגולמי).
   חשוב: פונקציות הרינדור טהורות (בלי DOM) כדי שירוצו בשני המקומות. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.spCompare = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var MAX_CARS = 4, MIN_CARS = 2;

  var CATS = [
    { k: 'driving', name: 'נסיעה', icon: '🛣️' },
    { k: 'design', name: 'עיצוב', icon: '🎨' },
    { k: 'tech', name: 'טכנולוגיה', icon: '💻' },
    { k: 'comfort', name: 'נוחות', icon: '🛋️' },
    { k: 'value', name: 'ערך', icon: '💰' }
  ];

  // שורות טבלת המפרט. better: 'high'/'low' = מסמנים את הערך הטוב בשורה.
  // sameFamily: מסמנים רק אם לכל הדגמים אותו סוג הנעה (צריכה של PHEV מול בנזין לא בת השוואה).
  var ROWS = [
    { k: 'price', label: 'מחיר', unit: '₪', better: 'low', money: true },
    { k: 'engine', label: 'מערכת הנעה' },
    { k: 'power', label: 'הספק', unit: 'כ"ס', better: 'high' },
    { k: 'torque', label: 'מומנט', unit: 'נ"מ', better: 'high' },
    { k: 'zeroToHundred', label: '0-100 קמ"ש', unit: 'שנ׳', better: 'low' },
    { k: 'topspeed', label: 'מהירות מרבית', unit: 'קמ"ש', better: 'high' },
    { k: 'gearbox', label: 'תיבת הילוכים' },
    { k: 'drive', label: 'הנעה' },
    { k: 'range', label: 'טווח חשמלי', unit: 'ק"מ', better: 'high' },
    { k: 'battery', label: 'קיבולת סוללה', unit: 'קוט"ש', better: 'high' },
    { k: 'consumption', label: 'צריכה משולבת', better: 'low', sameFamily: true },
    { k: 'trunk', label: 'תא מטען', unit: 'ליטר', better: 'high' },
    { k: 'length', label: 'אורך', unit: 'מ"מ' },
    { k: 'weight', label: 'משקל', unit: 'ק"ג' },
    { k: 'safety', label: 'בטיחות' },
    { k: 'warranty', label: 'אחריות' }
  ];

  // שדות הטופס לכל רכב (מעבר לציונים/יתרונות/חסרונות)
  var FIELDS = [
    { k: 'name', label: 'שם הדגם *', ph: 'למשל: טויוטה RAV4 היברידית', wide: true },
    { k: 'trim', label: 'גרסת המבחן', ph: 'למשל: Executive' },
    { k: 'img', label: 'תמונה (קישור)', ph: 'https://...' },
    { k: 'price', label: 'מחיר (₪)', ph: '189,990' },
    { k: 'engine', label: 'מערכת הנעה', ph: '1.5 טורבו + חשמל (PHEV)' },
    { k: 'power', label: 'הספק (כ"ס)', ph: '197' },
    { k: 'torque', label: 'מומנט (נ"מ)', ph: '290' },
    { k: 'zeroToHundred', label: '0-100 (שניות)', ph: '7.8' },
    { k: 'topspeed', label: 'מהירות מרבית (קמ"ש)', ph: '200' },
    { k: 'gearbox', label: 'תיבת הילוכים', ph: 'DCT 7' },
    { k: 'drive', label: 'הנעה', ph: 'קדמית / כפולה' },
    { k: 'range', label: 'טווח חשמלי (ק"מ)', ph: '91' },
    { k: 'battery', label: 'סוללה (קוט"ש)', ph: '18.3' },
    { k: 'consumption', label: 'צריכה משולבת', ph: '5.4 ל׳/100 ק"מ' },
    { k: 'trunk', label: 'תא מטען (ליטר)', ph: '466' },
    { k: 'length', label: 'אורך (מ"מ)', ph: '4500' },
    { k: 'weight', label: 'משקל (ק"ג)', ph: '1860' },
    { k: 'safety', label: 'בטיחות', ph: '5 כוכבי Euro NCAP' },
    { k: 'warranty', label: 'אחריות', ph: '7 שנים / 150,000 ק"מ' }
  ];

  /* ───────── עזרים טהורים ───────── */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function str(v) { return v == null ? '' : String(v).trim(); }
  function num(v) {
    var m = str(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }
  function isPlainNumber(v) { return /^-?[\d,]+(\.\d+)?$/.test(str(v)); }
  function fmtNum(n) {
    var parts = String(n).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }
  function fmtVal(row, v) {
    v = str(v);
    if (!v) return '';
    if (row.money) return isPlainNumber(v) ? fmtNum(num(v)) + ' ₪' : v;
    if (row.unit && isPlainNumber(v)) return fmtNum(num(v)) + ' ' + row.unit;
    return v;
  }
  function family(engine) {
    var e = str(engine).toLowerCase();
    if (/phev|פלאג|plug/.test(e)) return 'phev';
    if (/היבריד|hybrid|hev/.test(e)) return 'hybrid';
    if (/חשמלי|\bev\b|bev|electric/.test(e)) return 'ev';
    return 'ice';
  }
  function img(url, w) {
    url = str(url);
    if (!/^https?:\/\//.test(url)) return '';
    if (url.indexOf('supabase.co/storage') !== -1 && url.indexOf('wsrv.nl') === -1) {
      return 'https://wsrv.nl/?url=' + encodeURIComponent(url) + '&w=' + w + '&output=webp&q=75';
    }
    return url;
  }
  function shortName(name) {
    var n = str(name);
    return n.length > 22 ? n.slice(0, 21) + '…' : n;
  }

  /* ───────── ניקוד ───────── */
  function totalOf(car) {
    var s = (car && car.scores) || {}, sum = 0, cnt = 0;
    CATS.forEach(function (c) { var v = parseFloat(s[c.k]); if (v > 0) { sum += v; cnt++; } });
    return cnt ? Math.round((sum / cnt) * 10) / 10 : null;
  }
  function winnerIndex(spec) {
    var cars = (spec && spec.cars) || [];
    if (spec && spec.winner !== 'auto' && spec.winner !== undefined && spec.winner !== null && spec.winner !== '') {
      var w = parseInt(spec.winner, 10);
      if (w >= 0 && w < cars.length) return w;
    }
    var best = -1, bestV = -1;
    cars.forEach(function (c, i) { var t = totalOf(c); if (t !== null && t > bestV) { bestV = t; best = i; } });
    return best;
  }
  function bestIndexes(values, better) {
    var nums = values.map(num);
    if (nums.some(function (n) { return n === null; })) return [];
    var target = better === 'low' ? Math.min.apply(null, nums) : Math.max.apply(null, nums);
    var out = [];
    nums.forEach(function (n, i) { if (n === target) out.push(i); });
    return out.length === nums.length ? [] : out; // כולם שווים = אין מה לסמן
  }
  function isComparison(specs) {
    return !!(specs && specs.mode === 'comparison' && Array.isArray(specs.cars) && specs.cars.length >= 1);
  }

  /* ───────── רינדור הכתבה (טהור — רץ גם ב-Node) ───────── */
  function render(spec) {
    if (!isComparison(spec)) return '';
    var cars = spec.cars.slice(0, MAX_CARS);
    var n = cars.length;
    var win = winnerIndex(spec);
    var totals = cars.map(totalOf);
    var h = '';

    h += '<section class="cmp n' + n + '" style="--n:' + n + '" aria-label="מבחן השוואתי">';
    h += '<div class="cmp-kicker"><span class="cmp-kicker-dot"></span>מבחן השוואתי · ' + n + ' דגמים</div>';

    // המתמודדים
    h += '<div class="cmp-contenders">';
    cars.forEach(function (c, i) {
      var t = totals[i];
      var src = img(c.img, 640);
      h += '<div class="cmp-car c' + i + (i === win ? ' is-win' : '') + '">';
      if (i === win) h += '<div class="cmp-win-badge">🏆 המנצח</div>';
      h += '<div class="cmp-car-img">' + (src ? '<img src="' + esc(src) + '" alt="' + esc(c.name) + '" loading="lazy" decoding="async" width="640" height="400">' : '<div class="cmp-car-noimg">' + esc(String(i + 1)) + '</div>') + '</div>';
      h += '<div class="cmp-car-body">';
      h += '<div class="cmp-car-name">' + esc(c.name) + '</div>';
      if (str(c.trim)) h += '<div class="cmp-car-trim">' + esc(c.trim) + '</div>';
      if (str(c.price)) h += '<div class="cmp-car-price">' + esc(fmtVal(ROWS[0], c.price)) + '</div>';
      if (t !== null) {
        h += '<div class="cmp-ring" style="--p:' + Math.round(t * 10) + '" role="img" aria-label="ציון כולל ' + t + ' מתוך 10"><span>' + t.toFixed(1) + '</span></div>';
      }
      if (str(c.slug)) h += '<a class="cmp-car-link" href="/car/' + encodeURIComponent(c.slug) + '/">מפרט מלא במאגר ←</a>';
      h += '</div></div>';
    });
    h += '</div>';

    // השורה התחתונה
    if (win >= 0) {
      var wc = cars[win];
      h += '<div class="cmp-verdict c' + win + '">';
      h += '<div class="cmp-verdict-trophy" aria-hidden="true">🏆</div>';
      h += '<div class="cmp-verdict-main">';
      h += '<div class="cmp-verdict-label">השורה התחתונה</div>';
      h += '<div class="cmp-verdict-name">' + esc(wc.name) + (totals[win] !== null ? ' <span class="cmp-verdict-score">' + totals[win].toFixed(1) + '/10</span>' : '') + '</div>';
      if (str(spec.verdict)) h += '<p class="cmp-verdict-text">' + esc(spec.verdict) + '</p>';
      h += '</div></div>';
    }

    // ציונים לפי קטגוריה
    var anyScores = cars.some(function (c) { return totalOf(c) !== null; });
    if (anyScores) {
      h += '<h3 class="cmp-h">ציונים לפי קטגוריה</h3><div class="cmp-scores">';
      CATS.forEach(function (cat) {
        var vals = cars.map(function (c) { var v = parseFloat(((c.scores || {})[cat.k])); return v > 0 ? v : null; });
        if (vals.every(function (v) { return v === null; })) return;
        var max = Math.max.apply(null, vals.map(function (v) { return v || 0; }));
        var leaders = [];
        vals.forEach(function (v, i) { if (v !== null && v === max) leaders.push(i); });
        h += '<div class="cmp-cat">';
        h += '<div class="cmp-cat-head"><span class="cmp-cat-name">' + cat.icon + ' ' + cat.name + '</span>';
        if (leaders.length && leaders.length < n) h += '<span class="cmp-cat-lead">מוביל: ' + leaders.map(function (i) { return esc(shortName(cars[i].name)); }).join(' · ') + '</span>';
        h += '</div>';
        cars.forEach(function (c, i) {
          var v = vals[i];
          h += '<div class="cmp-bar-row c' + i + (leaders.indexOf(i) !== -1 && leaders.length < n ? ' lead' : '') + '">';
          h += '<span class="cmp-bar-label">' + esc(shortName(c.name)) + '</span>';
          h += '<span class="cmp-bar"><span class="cmp-bar-fill" style="width:' + (v ? Math.max(4, Math.min(100, v * 10)) : 0) + '%"></span></span>';
          h += '<span class="cmp-bar-val">' + (v !== null ? v.toFixed(1) : '—') + '</span>';
          h += '</div>';
        });
        h += '</div>';
      });
      h += '</div>';
    }

    // טבלת מפרט
    var fams = cars.map(function (c) { return family(c.engine); });
    var sameFam = fams.every(function (f) { return f === fams[0]; });
    var rowsHtml = '';
    ROWS.forEach(function (row) {
      var vals = cars.map(function (c) { return str(c[row.k]); });
      if (vals.every(function (v) { return !v; })) return;
      var best = (row.better && (!row.sameFamily || sameFam)) ? bestIndexes(vals, row.better) : [];
      rowsHtml += '<tr><th scope="row">' + esc(row.label) + '</th>';
      vals.forEach(function (v, i) {
        var isBest = best.indexOf(i) !== -1;
        rowsHtml += '<td class="c' + i + (isBest ? ' best' : '') + '">' + (v ? esc(fmtVal(row, v)) : '<span class="cmp-na">—</span>') + (isBest ? '<span class="cmp-best-mark" aria-label="הטוב בשורה">✓</span>' : '') + '</td>';
      });
      rowsHtml += '</tr>';
    });
    if (rowsHtml) {
      h += '<h3 class="cmp-h">מפרט טכני זה מול זה</h3>';
      h += '<div class="cmp-table-wrap" tabindex="0" role="region" aria-label="טבלת השוואת מפרט"><table class="cmp-table"><thead><tr><th scope="col"><span class="sr-only">נתון</span></th>';
      cars.forEach(function (c, i) { h += '<th scope="col" class="c' + i + '"><span class="cmp-th-dot"></span>' + esc(c.name) + '</th>'; });
      h += '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';
      h += '<p class="cmp-note"><span class="cmp-best-mark">✓</span> הנתון הטוב ביותר בשורה' + (!sameFam ? ' · צריכה לא מסומנת כי מערכות ההנעה שונות' : '') + '</p>';
    }

    // יתרונות, חסרונות ולמי מתאים
    var anyPC = cars.some(function (c) { return (c.pros && c.pros.length) || (c.cons && c.cons.length) || str(c.fit); });
    if (anyPC) {
      h += '<h3 class="cmp-h">יתרונות וחסרונות</h3><div class="cmp-pc">';
      cars.forEach(function (c, i) {
        h += '<div class="cmp-pc-card c' + i + '">';
        h += '<div class="cmp-pc-head"><span class="cmp-th-dot"></span>' + esc(c.name) + (i === win ? ' <span class="cmp-pc-win">🏆</span>' : '') + '</div>';
        (c.pros || []).forEach(function (p) { h += '<div class="cmp-pc-item pro"><span class="cmp-pc-ic">✓</span>' + esc(p) + '</div>'; });
        (c.cons || []).forEach(function (p) { h += '<div class="cmp-pc-item con"><span class="cmp-pc-ic">✕</span>' + esc(p) + '</div>'; });
        if (str(c.fit)) h += '<div class="cmp-pc-fit"><strong>למי מתאים:</strong> ' + esc(c.fit) + '</div>';
        h += '</div>';
      });
      h += '</div>';
    }

    h += '</section>';
    return h;
  }

  /* JSON-LD: מבחן השוואתי הוא NewsArticle עם רשימת הרכבים (Review של גוגל מיועד לפריט יחיד) */
  function patchSchema(schema, specs) {
    if (!isComparison(specs) || !schema) return schema;
    schema['@type'] = 'NewsArticle';
    delete schema.reviewRating;
    delete schema.itemReviewed;
    schema.about = specs.cars.slice(0, MAX_CARS).map(function (c) {
      var o = { '@type': 'Car', name: str(c.name) };
      var p = num(c.price);
      if (p && isPlainNumber(c.price)) o.offers = { '@type': 'Offer', price: p, priceCurrency: 'ILS' };
      return o;
    });
    return schema;
  }

  var api = {
    render: render,
    patchSchema: patchSchema,
    isComparison: isComparison,
    totalOf: totalOf,
    winnerIndex: winnerIndex,
    _internal: { num: num, fmtVal: fmtVal, bestIndexes: bestIndexes, family: family, ROWS: ROWS, CATS: CATS, FIELDS: FIELDS }
  };

  /* ───────── טופס הניהול (דפדפן בלבד) ───────── */
  if (typeof document === 'undefined') return api;

  var state = { mode: 'single', cars: [], winner: 'auto', verdict: '' };
  var carsDb = null, carsDbLoading = null;
  var mounted = false;

  function blankCar() { return { scores: {}, pros: [], cons: [] }; }
  function resetState() { state = { mode: 'single', cars: [blankCar(), blankCar()], winner: 'auto', verdict: '' }; }
  resetState();

  function $(id) { return document.getElementById(id); }

  function mount() {
    if (mounted) return true;
    var sec = $('specs-section');
    if (!sec) return false;
    var card = sec.querySelector('.spec-admin-card');
    if (!card) return false;
    var sw = document.createElement('div');
    sw.id = 'cmp-mode-switch';
    sw.className = 'cmp-mode-switch';
    sw.innerHTML = '<button type="button" data-mode="single">🚗 מבחן רכב בודד</button><button type="button" data-mode="comparison">⚖️ מבחן השוואתי</button>';
    card.parentNode.insertBefore(sw, card);
    var box = document.createElement('div');
    box.id = 'cmp-admin';
    box.className = 'cmp-admin';
    box.style.display = 'none';
    card.parentNode.insertBefore(box, card.nextSibling);
    sw.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-mode]');
      if (!b) return;
      if (b.getAttribute('data-mode') === 'comparison' && state.mode !== 'comparison') {
        state.mode = 'comparison';
        loadCarsDb();
      } else if (b.getAttribute('data-mode') === 'single') {
        if (state.mode === 'comparison' && hasData() && !confirm('לעבור למבחן רכב בודד? נתוני ההשוואה שמילאת לא יישמרו בכתבה.')) return;
        state.mode = 'single';
      }
      paint();
    });
    box.addEventListener('input', onInput);
    box.addEventListener('change', onInput);
    box.addEventListener('click', onClick);
    mounted = true;
    return true;
  }

  function hasData() {
    return state.cars.some(function (c) { return str(c.name) || str(c.price) || totalOf(c) !== null; });
  }

  function loadCarsDb() {
    if (carsDb || carsDbLoading) return carsDbLoading;
    var client = window.sbClient;
    if (!client && window.__initSb) { try { window.__initSb(); } catch (e) {} client = window.sbClient; }
    if (!client) return null;
    carsDbLoading = client.from('cars')
      .select('id,slug,brand,model,year,price,engine,horsepower,torque,acceleration_0_100,top_speed,transmission,drive_type,range_ev,battery_capacity_kwh,fuel_consumption,trunk_volume,length,weight,safety_rating,image_main,pros,cons,deleted')
      .order('brand', { ascending: true })
      .then(function (res) {
        carsDb = ((res && res.data) || []).filter(function (c) { return !c.deleted; });
        carsDbLoading = null;
        if (state.mode === 'comparison') paint();
      }, function () { carsDbLoading = null; });
    return carsDbLoading;
  }

  function carLabel(c) { return [c.brand, c.model, c.year].filter(Boolean).join(' '); }

  function importCar(idx, dbId) {
    var c = (carsDb || []).find(function (x) { return String(x.id) === String(dbId); });
    if (!c) return;
    var t = state.cars[idx];
    var setIf = function (k, v) { if (v !== null && v !== undefined && v !== '') t[k] = String(v); };
    t.carId = c.id; t.slug = c.slug || '';
    t.name = [c.brand, c.model].filter(Boolean).join(' ');
    setIf('img', c.image_main);
    setIf('price', c.price != null ? fmtNum(c.price) : '');
    setIf('engine', c.engine); setIf('power', c.horsepower); setIf('torque', c.torque);
    setIf('zeroToHundred', c.acceleration_0_100); setIf('topspeed', c.top_speed);
    setIf('gearbox', c.transmission); setIf('drive', c.drive_type);
    setIf('range', c.range_ev); setIf('battery', c.battery_capacity_kwh);
    setIf('consumption', c.fuel_consumption); setIf('trunk', c.trunk_volume);
    setIf('length', c.length); setIf('weight', c.weight); setIf('safety', c.safety_rating);
    // יתרונות/חסרונות מהמאגר רק אם עוד לא כתבת משלך
    if ((!t.pros || !t.pros.length) && Array.isArray(c.pros)) t.pros = c.pros.slice(0, 5);
    if ((!t.cons || !t.cons.length) && Array.isArray(c.cons)) t.cons = c.cons.slice(0, 5);
    paint();
  }

  function onInput(e) {
    var el = e.target;
    var ci = el.getAttribute('data-car');
    var k = el.getAttribute('data-k');
    if (el.id === 'cmp-winner') { state.winner = el.value; paintSummary(); return; }
    if (el.id === 'cmp-verdict') { state.verdict = el.value; return; }
    if (ci === null || !k) return;
    var car = state.cars[+ci];
    if (!car) return;
    if (k.indexOf('score.') === 0) {
      car.scores = car.scores || {};
      car.scores[k.slice(6)] = el.value;
      paintSummary();
    } else if (k === 'pros' || k === 'cons') {
      car[k] = el.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    } else {
      car[k] = el.value;
      if (k === 'name') paintSummary();
    }
  }

  function onClick(e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act'), i = +b.getAttribute('data-car');
    if (act === 'add' && state.cars.length < MAX_CARS) { state.cars.push(blankCar()); paint(); }
    else if (act === 'remove' && state.cars.length > MIN_CARS) {
      var c = state.cars[i];
      if ((str(c.name) || totalOf(c) !== null) && !confirm('להסיר את "' + (c.name || 'רכב ' + (i + 1)) + '" מההשוואה?')) return;
      state.cars.splice(i, 1);
      if (state.winner !== 'auto') { var w = +state.winner; if (w === i) state.winner = 'auto'; else if (w > i) state.winner = String(w - 1); }
      paint();
    } else if (act === 'import') {
      var sel = $('cmp-db-' + i);
      if (!sel || !sel.value) { alert('בחר דגם מהרשימה'); return; }
      var has = ['price', 'power', 'engine'].some(function (k) { return str(state.cars[i][k]); });
      if (has && !confirm('הייבוא יחליף את נתוני המפרט שכבר מילאת לרכב הזה. להמשיך?')) return;
      importCar(i, sel.value);
    } else if (act === 'unlink') {
      state.cars[i].slug = ''; state.cars[i].carId = null; paint();
    }
  }

  function fieldHtml(ci, f, car) {
    var v = str(car[f.k]);
    return '<label class="cmp-f' + (f.wide ? ' wide' : '') + '"><span>' + esc(f.label) + '</span><input type="text" data-car="' + ci + '" data-k="' + f.k + '" value="' + esc(v) + '" placeholder="' + esc(f.ph || '') + '"></label>';
  }

  function carCardHtml(car, i) {
    var h = '<div class="cmp-admin-car c' + i + '">';
    h += '<div class="cmp-admin-car-head"><span class="cmp-th-dot"></span><strong>רכב ' + (i + 1) + '</strong>';
    h += '<span class="cmp-admin-total" id="cmp-total-' + i + '"></span>';
    if (state.cars.length > MIN_CARS) h += '<button type="button" class="cmp-admin-x" data-act="remove" data-car="' + i + '" title="הסר רכב">✕</button>';
    h += '</div>';

    // ייבוא מהמאגר
    h += '<div class="cmp-admin-import">';
    if (carsDb && carsDb.length) {
      h += '<select id="cmp-db-' + i + '"><option value="">ייבוא ממאגר הרכבים…</option>';
      carsDb.forEach(function (c) { h += '<option value="' + esc(c.id) + '"' + (String(car.carId) === String(c.id) ? ' selected' : '') + '>' + esc(carLabel(c)) + '</option>'; });
      h += '</select><button type="button" class="cmp-admin-btn" data-act="import" data-car="' + i + '">ייבא נתונים</button>';
    } else {
      h += '<span class="cmp-admin-hint">' + (carsDbLoading ? 'טוען את מאגר הרכבים…' : 'מאגר הרכבים לא נטען — אפשר למלא ידנית') + '</span>';
    }
    if (str(car.slug)) h += '<span class="cmp-admin-linked">🔗 מקושר לדף הרכב /car/' + esc(car.slug) + '/ <button type="button" data-act="unlink" data-car="' + i + '">נתק</button></span>';
    h += '</div>';

    h += '<div class="cmp-admin-grid">';
    FIELDS.forEach(function (f) { h += fieldHtml(i, f, car); });
    h += '</div>';

    h += '<div class="cmp-admin-sub">⭐ ציונים (1-10)</div><div class="cmp-admin-scores">';
    CATS.forEach(function (c) {
      var v = str((car.scores || {})[c.k]);
      h += '<label class="cmp-f"><span>' + c.icon + ' ' + c.name + '</span><input type="number" min="1" max="10" step="0.1" data-car="' + i + '" data-k="score.' + c.k + '" value="' + esc(v) + '"></label>';
    });
    h += '</div>';

    h += '<div class="cmp-admin-pc">';
    h += '<label class="cmp-f"><span style="color:#16a34a">✓ יתרונות (כל אחד בשורה)</span><textarea rows="3" data-car="' + i + '" data-k="pros">' + esc((car.pros || []).join('\n')) + '</textarea></label>';
    h += '<label class="cmp-f"><span style="color:#dc2626">✕ חסרונות (כל אחד בשורה)</span><textarea rows="3" data-car="' + i + '" data-k="cons">' + esc((car.cons || []).join('\n')) + '</textarea></label>';
    h += '</div>';
    h += '<label class="cmp-f wide"><span>למי מתאים</span><input type="text" data-car="' + i + '" data-k="fit" value="' + esc(str(car.fit)) + '" placeholder="למשל: למשפחה שנוסעת הרבה בעיר ורוצה לחסוך בדלק"></label>';
    h += '</div>';
    return h;
  }

  function paint() {
    if (!mount()) return;
    var sw = $('cmp-mode-switch'), box = $('cmp-admin');
    var single = $('specs-section').querySelector('.spec-admin-card');
    Array.prototype.forEach.call(sw.querySelectorAll('button'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-mode') === state.mode);
    });
    if (state.mode !== 'comparison') {
      box.style.display = 'none';
      if (single) single.style.display = '';
      return;
    }
    if (single) single.style.display = 'none';
    box.style.display = 'block';
    var h = '<div class="cmp-admin-intro">מלא 2-4 דגמים. אפשר לייבא כל דגם ממאגר הרכבים ולתקן ידנית. הזוכה נקבע אוטומטית לפי הציון הממוצע, או ידנית למטה.</div>';
    h += '<div class="cmp-admin-cars">';
    state.cars.forEach(function (c, i) { h += carCardHtml(c, i); });
    h += '</div>';
    if (state.cars.length < MAX_CARS) h += '<button type="button" class="cmp-admin-add" data-act="add">+ הוסף רכב להשוואה (' + state.cars.length + '/' + MAX_CARS + ')</button>';
    h += '<div class="cmp-admin-bottom"><div class="cmp-admin-sub">🏆 השורה התחתונה</div>';
    h += '<label class="cmp-f"><span>המנצח</span><select id="cmp-winner"></select></label>';
    h += '<label class="cmp-f wide"><span>מסקנה (2-3 משפטים — יוצגו בבאנר המנצח)</span><textarea id="cmp-verdict" rows="3">' + esc(state.verdict) + '</textarea></label>';
    h += '</div>';
    box.innerHTML = h;
    paintSummary();
  }

  function paintSummary() {
    var sel = $('cmp-winner');
    if (!sel) return;
    var auto = winnerIndex({ cars: state.cars, winner: 'auto' });
    var autoName = auto >= 0 ? (state.cars[auto].name || 'רכב ' + (auto + 1)) : 'אין עדיין ציונים';
    var opts = '<option value="auto">אוטומטי לפי ציון (' + esc(autoName) + ')</option>';
    state.cars.forEach(function (c, i) { opts += '<option value="' + i + '">' + esc(c.name || 'רכב ' + (i + 1)) + '</option>'; });
    sel.innerHTML = opts;
    sel.value = String(state.winner);
    if (sel.value !== String(state.winner)) { state.winner = 'auto'; sel.value = 'auto'; }
    var win = winnerIndex(state);
    state.cars.forEach(function (c, i) {
      var el = $('cmp-total-' + i);
      if (!el) return;
      var t = totalOf(c);
      el.textContent = (t !== null ? 'ציון כולל ' + t.toFixed(1) : '') + (i === win ? '  🏆' : '');
    });
  }

  function collect() {
    var cars = state.cars.map(function (c) {
      var o = {};
      FIELDS.forEach(function (f) { var v = str(c[f.k]); if (v) o[f.k] = v; });
      if (str(c.fit)) o.fit = str(c.fit);
      if (c.carId) o.carId = c.carId;
      if (str(c.slug)) o.slug = str(c.slug);
      var sc = {};
      CATS.forEach(function (cat) { var v = parseFloat((c.scores || {})[cat.k]); if (v > 0) sc[cat.k] = Math.min(10, v); });
      o.scores = sc;
      o.pros = (c.pros || []).filter(Boolean);
      o.cons = (c.cons || []).filter(Boolean);
      return o;
    });
    return { mode: 'comparison', cars: cars, winner: state.winner === 'auto' ? 'auto' : parseInt(state.winner, 10), verdict: str(state.verdict) };
  }

  function validate() {
    var named = state.cars.filter(function (c) { return str(c.name); });
    if (named.length < MIN_CARS) return 'מבחן השוואתי צריך לפחות 2 דגמים עם שם.';
    var unnamed = state.cars.findIndex(function (c) { return !str(c.name); });
    if (unnamed !== -1) return 'לרכב ' + (unnamed + 1) + ' אין שם. מלא שם או הסר אותו מההשוואה.';
    var bad = [];
    state.cars.forEach(function (c, i) {
      CATS.forEach(function (cat) { var v = (c.scores || {})[cat.k]; if (str(v) && !(parseFloat(v) >= 1 && parseFloat(v) <= 10)) bad.push((c.name || 'רכב ' + (i + 1)) + ' / ' + cat.name); });
    });
    if (bad.length) return 'ציונים חייבים להיות בין 1 ל-10:\n' + bad.join('\n');
    return null;
  }

  function isActive() {
    var cat = $('a-cat');
    return state.mode === 'comparison' && !!cat && cat.value === 'review';
  }

  function load(specs) {
    resetState();
    if (isComparison(specs)) {
      state.mode = 'comparison';
      state.cars = specs.cars.slice(0, MAX_CARS).map(function (c) {
        var o = JSON.parse(JSON.stringify(c));
        o.scores = o.scores || {}; o.pros = o.pros || []; o.cons = o.cons || [];
        return o;
      });
      while (state.cars.length < MIN_CARS) state.cars.push(blankCar());
      state.winner = (specs.winner === undefined || specs.winner === null || specs.winner === 'auto') ? 'auto' : String(specs.winner);
      state.verdict = specs.verdict || '';
      loadCarsDb();
    }
    paint();
  }

  function reset() { resetState(); paint(); }

  // בדיקת תקינות לפני פרסום — עוטפים את publishArticle אחרי ש-app.js נטען
  function wrapPublish() {
    var orig = window.publishArticle;
    if (typeof orig !== 'function' || orig.__cmpWrapped) return;
    var wrapped = function () {
      if (isActive()) {
        var err = validate();
        if (err) { alert('⚖️ ' + err); return; }
      }
      return orig.apply(this, arguments);
    };
    wrapped.__cmpWrapped = true;
    window.publishArticle = wrapped;
  }

  // הקובץ נטען (defer) לפני app.js, ולכן publishArticle עוד לא קיימת כשהוא רץ.
  // DOMContentLoaded נורה רק אחרי שכל סקריפטי ה-defer רצו; load הוא רשת ביטחון. init בטוח להרצה כפולה.
  function init() { wrapPublish(); paint(); }
  if (document.readyState === 'complete') init();
  else {
    document.addEventListener('DOMContentLoaded', init);
    window.addEventListener('load', init);
  }

  api.load = load;
  api.reset = reset;
  api.collect = collect;
  api.validate = validate;
  api.isActive = isActive;
  return api;
});
