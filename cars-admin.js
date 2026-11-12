/*
 * cars-admin.js — ניהול מאגר הרכבים בפאנל הניהול — ספידומטר
 * ---------------------------------------------------------------
 * קובץ עצמאי לחלוטין, באותו דפוס בדיוק כמו news.js: לא נוגע ב-app.js,
 * לא נוגע ב-ads.js, לא נוגע ב-news.js. להשבתה מלאה: הסר את שורת
 * <script src="/cars-admin.js" defer> מ-index.html.
 *
 * מה זה עושה (טאב חדש "🚗 רכבים" בפאנל הניהול):
 *   1. "רכב חדש" — מעלים גיליון מפרט רשמי (PDF/תמונה) + תמונות אמיתיות,
 *      לוחצים "חלץ נתונים" (Edge Function extract-car-spec, Gemini קורא
 *      את הקובץ ומחלץ שדות מובנים), ואז "בדוק מול המקור" (Edge Function
 *      verify-car-spec — בדיקה עצמאית שנייה שמשווה כל שדה מול הקובץ שוב
 *      ומסמנת אי-התאמות/חוסרים). התוצאה טיוטה (car_drafts) שלא מופיעה
 *      באתר עד שמאשרים "פרסם רכב" בטופס העריכה.
 *   2. "רכבים קיימים" — רשימת כל הרכבים החיים, עריכה ישירה (כמו עריכת
 *      כתבה קיימת), מחיקה רכה (deleted=true), ופאנל "10 הרכבים הנצפים
 *      ביותר" (views, RPC increment_car_views שכבר קיים ב-car.html).
 *
 * זהות טפסים: אותו FIELD_DEFS בדיוק מזין גם את טופס "רכב חדש" (אחרי
 * חילוץ) וגם את טופס עריכת רכב קיים — אין כפילות קוד בין השניים.
 * ---------------------------------------------------------------
 */
(function () {
  'use strict';

  const SB_URL = 'https://kaykrrnmykqrfhawgtqt.supabase.co';
  const SB_KEY = 'sb_publishable_Ms6YFTnADm-qAd9617Ey9A_D3x-Zumi';
  const EDGE_BASE = SB_URL + '/functions/v1';
  const PHOTOS_BUCKET = 'car-photos';
  const SPECS_BUCKET = 'car-spec-sheets';
  let carsClient = null;

  // תוצאת האימות האחרונה לכל טיוטה, בזיכרון בלבד — אותו דפוס כמו
  // draftVerifications ב-news.js.
  const draftVerifications = {};
  // הנתונים שמוצגים כרגע בטופס העריכה המשותף (לפני שמירה) — כדי
  // שכפתורי "אמץ הצעה" ידעו על איזה טופס לפעול.
  let currentFormState = null; // {mode:'draft'|'edit', draftId?, carId?, photos:[...], mainPhoto}

  function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeHtml(s) { return escapeAttr(s); }

  function initCarsClient() {
    if (carsClient) return carsClient;
    if (window.sbClient) { carsClient = window.sbClient; return carsClient; }
    if (window.supabase) {
      try { carsClient = window.supabase.createClient(SB_URL, SB_KEY); } catch (e) { console.error('[cars-admin] יצירת חיבור נכשלה:', e); }
    }
    return carsClient;
  }

  async function getAuthToken() {
    const client = initCarsClient();
    if (!client) return null;
    try {
      const { data } = await client.auth.getSession();
      return data && data.session ? data.session.access_token : null;
    } catch (e) { return null; }
  }

  // ═══════════ הגדרת השדות — מקור אמת יחיד לטופס ולקריאה/כתיבה ═══════════
  // type: text | number | float | textarea | list (טקסטאריה, שורה=פריט ברשימה)
  // fromDraft:false = שדה שלא מגיע מחילוץ אוטומטי (המנהל ממלא ידנית)
  const FIELD_GROUPS = [
    { title: 'זיהוי', fields: [
      { key: 'brand', label: 'יצרן *', type: 'text', required: true },
      { key: 'model', label: 'דגם *', type: 'text', required: true },
      { key: 'year', label: 'שנה *', type: 'number', required: true },
      { key: 'category', label: 'קטגוריה/סגמנט', type: 'text', placeholder: "לדוגמה: קרוסאובר קומפקטי" },
      { key: 'slug', label: 'כתובת URL (slug) *', type: 'text', required: true, placeholder: 'brand-model-2025', hint: 'אותיות אנגליות קטנות ומקפים בלבד' },
    ]},
    { title: 'מחיר ומקור', fields: [
      { key: 'price', label: 'מחיר בסיס (₪)', type: 'number', hint: 'ריק = יוצג "מחיר טרם פורסם"' },
      { key: 'price_top', label: 'מחיר רמה עליונה (₪)', type: 'number' },
      { key: 'importer', label: 'יבואן רשמי', type: 'text' },
      { key: 'country_of_origin', label: 'ארץ ייצור', type: 'text' },
      { key: 'safety_rating', label: 'דירוג/מדד בטיחות', type: 'text', hint: 'כולל מדד ישראלי כמו "7 מתוך 8", לא רק NCAP' },
      { key: 'pollution_index', label: 'מדד זיהום אוויר (1-15)', type: 'number' },
    ]},
    { title: 'ביצועים ומנוע', fields: [
      { key: 'engine', label: 'מנוע', type: 'text' },
      { key: 'horsepower', label: 'הספק (כ"ס) *', type: 'number', required: true },
      { key: 'torque', label: 'מומנט (קג״מ)', type: 'float', hint: 'כפי שכתוב במפרט (למשל 28.55). אם המפרט בנ״מ — לחלק ב-9.81' },
      { key: 'acceleration_0_100', label: 'תאוצה 0-100 (שניות)', type: 'float' },
      { key: 'top_speed', label: 'מהירות מקסימלית (קמ"ש)', type: 'number' },
      { key: 'range_ev', label: 'טווח חשמלי (ק"מ)', type: 'number' },
      { key: 'battery_capacity_kwh', label: 'קיבולת סוללה (kWh)', type: 'float' },
      { key: 'fuel_consumption', label: 'צריכת דלק (ל/100ק"מ)', type: 'text' },
      { key: 'transmission', label: 'תיבת הילוכים', type: 'text' },
      { key: 'drive_type', label: 'סוג הנעה', type: 'text' },
    ]},
    { title: 'מידות', fields: [
      { key: 'trunk_volume', label: 'תא מטען (ליטר)', type: 'number' },
      { key: 'weight', label: 'משקל (ק"ג)', type: 'number' },
      { key: 'length', label: 'אורך (מ"מ)', type: 'number' },
      { key: 'width', label: 'רוחב (מ"מ)', type: 'number' },
      { key: 'height', label: 'גובה (מ"מ)', type: 'number' },
      { key: 'tires', label: 'מידת צמיגים', type: 'text', placeholder: 'לדוגמה: 245/50R20' },
    ]},
    // נוספו 27.10.2026 (cars-phase3-columns.sql). מ-30.10.2026 החילוץ ממלא אותם אוטומטית (חוץ מהציון)
    { title: 'נתונים מורחבים', fields: [
      { key: 'powertrain', label: 'סוג הנעה (מנוע)', type: 'select', fromDraft: false,
        options: [['', '— לא צוין —'], ['petrol', 'בנזין'], ['diesel', 'דיזל'], ['mhev', 'היברידי קל (מייל-היברידי)'], ['hev', 'היברידי'], ['phev', 'פלאג-אין היברידי'], ['erev', 'חשמלי עם מאריך טווח'], ['ev', 'חשמלי']],
        hint: 'קובע את הסינון והקטגוריות במאגר. ריק = נגזר זמנית משדה "מנוע"' },
      { key: 'score', label: 'ציון ספידומטר (0-10)', type: 'float', fromDraft: false, hint: 'מוצג בעיגול שליד הרכב בעמוד הדגם. ריק = העיגול לא מוצג' },
      { key: 'seats', label: 'מספר מושבים', type: 'number', fromDraft: false },
      { key: 'wheelbase', label: 'בסיס גלגלים (מ"מ)', type: 'number', fromDraft: false },
      { key: 'ground_clearance', label: 'מרווח גחון (מ"מ)', type: 'number', fromDraft: false },
      { key: 'towing_capacity', label: 'כושר גרירה (ק"ג)', type: 'number', fromDraft: false },
      { key: 'warranty', label: 'אחריות לרכב', type: 'text', fromDraft: false, placeholder: 'לדוגמה: 7 שנים או 150,000 ק"מ' },
      { key: 'battery_warranty', label: 'אחריות לסוללה', type: 'text', fromDraft: false, placeholder: 'לדוגמה: 8 שנים או 160,000 ק"מ' },
      { key: 'charge_ac_kw', label: 'טעינת AC מרבית (kW)', type: 'float', fromDraft: false },
      { key: 'charge_dc_kw', label: 'טעינת DC מרבית (kW)', type: 'float', fromDraft: false },
      { key: 'charge_dc_time', label: 'זמן טעינה מהירה', type: 'text', fromDraft: false, placeholder: "לדוגמה: 10%-80% ב-28 דק'" },
    ]},
    { title: 'רשימות (שורה = פריט)', fields: [
      { key: 'colors', label: 'צבעים זמינים', type: 'list' },
      { key: 'features', label: 'תכונות ואבזור', type: 'list' },
      { key: 'safety_features', label: 'מערכות בטיחות', type: 'list' },
      { key: 'pros', label: '✅ יתרונות', type: 'list', fromDraft: false, hint: 'שיפוט עריכתי — לא מחולץ אוטומטית מהמפרט, יש למלא ידנית' },
      { key: 'cons', label: '❌ חסרונות', type: 'list', fromDraft: false, hint: 'שיפוט עריכתי — לא מחולץ אוטומטית מהמפרט, יש למלא ידנית' },
    ]},
    { title: 'תוכן ו-SEO', fields: [
      { key: 'description', label: 'תיאור הרכב', type: 'textarea' },
      { key: 'meta_title', label: 'כותרת SEO', type: 'text' },
      { key: 'meta_description', label: 'תיאור SEO', type: 'textarea' },
      { key: 'youtube_video_url', label: 'קישור סרטון יוטיוב', type: 'text', fromDraft: false },
    ]},
    { title: 'מכירות בישראל (ידני, אופציונלי)', fields: [
      { key: 'sales_rank', label: 'דירוג מכירות', type: 'number', fromDraft: false },
      { key: 'sales_units', label: 'יחידות שנמכרו', type: 'number', fromDraft: false },
      { key: 'sales_year', label: 'שנת נתוני המכירות', type: 'number', fromDraft: false },
    ]},
  ];
  const ALL_FIELDS = FIELD_GROUPS.reduce(function (acc, g) { return acc.concat(g.fields); }, []);

  // ═══════════ רמות גימור נוספות (trims) — לא חלק מ-ALL_FIELDS כי זה מערך ═══════════
  // כשגיליון מפרט מציג כמה רמות גימור עם ערכים שונים (למשל FWD מול AWD), השדות
  // הרגילים למעלה (horsepower/weight/וכו') תמיד משקפים את רמת הגימור הבסיסית,
  // ו-trims מכיל את כל שאר הרמות. נבנה כרשימת כרטיסים נפרדת מהטופס השטוח הרגיל.
  // גרסה 2 (30.10.2026): כל גרסה היא יחידה מלאה עם כל נתוני המפרט שלה — אותם מפתחות בדיוק כמו בחילוץ
  // (extract-car-spec) ובעמוד "מפרט טכני מלא" באתר. { group } = כותרת ביניים בכרטיס.
  const PT_OPTIONS = [['', '— לא צוין —'], ['petrol', 'בנזין'], ['diesel', 'דיזל'], ['mhev', 'היברידי קל (מייל-היברידי)'], ['hev', 'היברידי'], ['phev', 'פלאג-אין היברידי'], ['erev', 'חשמלי עם מאריך טווח'], ['ev', 'חשמלי']];
  const TRIM_FIELDS = [
    { group: 'זיהוי ומחיר' },
    { key: 'name', label: 'שם הגרסה *', type: 'text' },
    { key: 'model_code', label: 'קוד דגם', type: 'text' },
    { key: 'price', label: 'מחיר (₪)', type: 'number' },
    { key: 'powertrain', label: 'סוג הנעה (מנוע)', type: 'select', options: PT_OPTIONS },
    { group: 'מנוע' },
    { key: 'engine', label: 'תיאור מנוע', type: 'text' },
    { key: 'engine_layout', label: 'תצורה / מס׳ בוכנות', type: 'text' },
    { key: 'displacement_cc', label: 'נפח מנוע (סמ״ק)', type: 'number' },
    { key: 'horsepower', label: 'הספק מנוע (כ״ס)', type: 'number' },
    { key: 'hp_rpm', label: 'סל״ד הספק', type: 'text' },
    { key: 'torque', label: 'מומנט מנוע (קג״מ)', type: 'float' },
    { key: 'torque_rpm', label: 'סל״ד מומנט', type: 'text' },
    { key: 'fuel_tank', label: 'מיכל דלק (ליטר)', type: 'number' },
    { group: 'ביצועים' },
    { key: 'acceleration_0_100', label: 'תאוצה 0-100 (שנ׳)', type: 'float' },
    { key: 'top_speed', label: 'מהירות מרבית (קמ״ש)', type: 'number' },
    { group: 'מערכת חשמלית / היברידית' },
    { key: 'electric_hp', label: 'הספק מנוע חשמלי (כ״ס)', type: 'number' },
    { key: 'electric_nm', label: 'מומנט מנוע חשמלי (קג״מ)', type: 'float' },
    { key: 'system_hp', label: 'הספק משולב (כ״ס)', type: 'number' },
    { key: 'system_nm', label: 'מומנט משולב (קג״מ)', type: 'float' },
    { key: 'boost_hp', label: 'תוספת הספק מייל-היבריד (כ״ס)', type: 'number' },
    { key: 'boost_nm', label: 'תוספת מומנט מייל-היבריד (קג״מ)', type: 'float' },
    { key: 'battery_capacity_kwh', label: 'קיבולת סוללה (kWh)', type: 'float' },
    { key: 'range_ev', label: 'טווח חשמלי (ק״מ)', type: 'number' },
    { key: 'range_total', label: 'טווח כולל חשמל + דלק (ק״מ)', type: 'number' },
    { key: 'battery_chemistry', label: 'סוג תאי הסוללה', type: 'text' },
    { key: 'charge_ac_kw', label: 'טעינת AC (kW)', type: 'float' },
    { key: 'charge_ac_time', label: 'זמן טעינת AC', type: 'text' },
    { key: 'charge_dc_kw', label: 'טעינת DC (kW)', type: 'float' },
    { key: 'charge_dc_time', label: 'זמן טעינת DC', type: 'text' },
    { group: 'הינע' },
    { key: 'drive_type', label: 'הנעה', type: 'text' },
    { key: 'transmission', label: 'תיבת הילוכים', type: 'text' },
    { group: 'מידות ומשקלים' },
    { key: 'length', label: 'אורך (מ״מ)', type: 'number' },
    { key: 'width', label: 'רוחב (מ״מ)', type: 'number' },
    { key: 'width_mirrors', label: 'רוחב כולל מראות (מ״מ)', type: 'number' },
    { key: 'height', label: 'גובה (מ״מ)', type: 'number' },
    { key: 'wheelbase', label: 'מרחק סרנים (מ״מ)', type: 'number' },
    { key: 'ground_clearance', label: 'מרווח גחון (מ״מ)', type: 'number' },
    { key: 'weight', label: 'משקל עצמי (ק״ג)', type: 'number' },
    { key: 'gross_weight', label: 'משקל כולל מורשה (ק״ג)', type: 'number' },
    { key: 'trunk_volume', label: 'תא מטען (ליטר)', type: 'number' },
    { key: 'trunk_volume_max', label: 'תא מטען מרבי, מושבים מקופלים (ליטר)', type: 'number' },
    { key: 'frunk_volume', label: 'תא מטען קדמי (ליטר)', type: 'number' },
    { key: 'drag_coefficient', label: 'מקדם גרר (Cd)', type: 'float' },
    { key: 'turning_circle', label: 'קוטר סיבוב (מטר)', type: 'float' },
    { key: 'turning_radius', label: 'רדיוס סיבוב (מטר)', type: 'float' },
    { key: 'towing_unbraked', label: 'גרירה ללא בלמים (ק״ג)', type: 'number' },
    { key: 'towing_braked', label: 'גרירה עם בלמים (ק״ג)', type: 'number' },
    { key: 'seats', label: 'מושבים', type: 'number' },
    { key: 'tires', label: 'צמיגים', type: 'text' },
    { group: 'צריכה, זיהום ובטיחות' },
    { key: 'fuel_consumption', label: 'צריכת דלק (ל׳/100 ק״מ)', type: 'text' },
    { key: 'electric_consumption', label: 'צריכת חשמל (Wh/ק״מ)', type: 'float' },
    { key: 'pollution_index', label: 'דרגת זיהום (1-15)', type: 'number' },
    { key: 'safety_level', label: 'רמת אבזור בטיחותי (0-8)', type: 'number' },
    { key: 'airbags', label: 'כריות אוויר', type: 'number' },
    { key: 'safety_rating', label: 'דירוג בטיחות (טקסט)', type: 'text' },
    { key: 'notable_features', label: 'אבזור ייחודי לגרסה (שורה=פריט)', type: 'list' },
  ];
  const TRIM_INPUTS = TRIM_FIELDS.filter(function (f) { return f.key; });
  // גרסה ישנה (לפני 05.11.2026, בלי tu:'kgm') שמרה מומנט בנ״מ — ממירים לקג״מ לפני שמציגים בטופס שכתוב בו קג״מ
  const TQ_KEYS = ['torque', 'electric_nm', 'system_nm', 'boost_nm'];
  function trimToKgm(t) {
    if (!t || typeof t !== 'object' || t.tu === 'kgm') return t;
    const o = Object.assign({}, t);
    TQ_KEYS.forEach(function (k) { const n = typeof o[k] === 'number' ? o[k] : parseFloat(o[k]); if (!isNaN(n) && n >= 60) o[k] = Math.round(n / 9.80665 * 10) / 10; });
    o.tu = 'kgm'; return o;
  }
  function trimsToKgm(arr) { return (Array.isArray(arr) ? arr : []).map(trimToKgm); }
  // מומנט ברמת הרכב בטיוטה ישנה (חולץ לפני 05.11.2026) — בנ״מ. מזהים לפי הגרסאות שלא סומנו kgm.
  function exTorqueKgm(ex) {
    const n = ex && (typeof ex.torque === 'number' ? ex.torque : parseFloat(ex.torque));
    if (isNaN(n)) return ex ? ex.torque : null;
    const t0 = ex && Array.isArray(ex.trims) ? ex.trims[0] : null;
    return n >= 100 && !(t0 && t0.tu === 'kgm') ? Math.round(n / 9.80665 * 10) / 10 : n;
  }

  function slugify(brand, model, year) {
    const base = (String(brand || '') + '-' + String(model || '') + '-' + String(year || ''))
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
    return base;
  }

  // ═══════════ ניהול טאבים ═══════════

  window.carsSubTab = function (tab, el) {
    ensureLogosTab();
    document.querySelectorAll('.cars-subtab').forEach(function (b) { b.classList.remove('active'); });
    if (el) el.classList.add('active');
    const newPanel = document.getElementById('cars-new-panel');
    const listPanel = document.getElementById('cars-list-panel');
    const logosPanel = document.getElementById('cars-logos-panel');
    if (newPanel) newPanel.style.display = tab === 'new' ? '' : 'none';
    if (listPanel) listPanel.style.display = tab === 'list' ? '' : 'none';
    if (logosPanel) logosPanel.style.display = tab === 'logos' ? '' : 'none';
    const formHost = document.getElementById('cars-form-host');
    if (formHost) formHost.innerHTML = ''; // סוגרים טופס פתוח בכל מעבר טאב
    if (tab === 'new') loadCarDrafts(); else if (tab === 'logos') loadBrandLogos(); else loadExistingCars();
  };

  // ═══════════ 🏷️ סמלי מותגים (11.11.2026) ═══════════
  // לשונית שלישית בטאב "רכבים". הקובץ עולה ל-bucket התמונות (תיקיית logos/) והכתובת נשמרת בטבלה brand_logos.
  // האתר קורא את הטבלה ומציג את הסמל בכל מקום שבו מופיע המותג; מותג בלי סמל ממשיך להופיע בשם כתוב.
  const LOGO_TYPES = { 'image/svg+xml': 'svg', 'image/png': 'png', 'image/webp': 'webp' };
  const LOGO_MAX = 400 * 1024;
  // אותו מפתח בדיוק כמו brandKey באתר (cars-core.js): אותיות קטנות, בלי רווחים/מקפים/נקודות
  function logoKey(raw) {
    const k = String(raw || '').trim().toLowerCase().replace(/[\s\-_.]+/g, '');
    return k === 'mercedesbenz' ? 'mercedes' : k;
  }
  function ensureLogosTab() {
    if (document.getElementById('cars-logos-panel')) return;
    const listPanel = document.getElementById('cars-list-panel'), tabs = document.querySelector('.cars-subtab');
    if (!listPanel || !tabs) return;
    const b = document.createElement('button'); b.className = 'hp-tab cars-subtab'; b.type = 'button'; b.textContent = '🏷️ סמלי מותגים';
    b.onclick = function () { window.carsSubTab('logos', b); };
    tabs.parentNode.appendChild(b);
    const p = document.createElement('div'); p.id = 'cars-logos-panel'; p.style.display = 'none';
    listPanel.parentNode.insertBefore(p, listPanel.nextSibling);
    if (!document.getElementById('bl-css')) {
      const st = document.createElement('style'); st.id = 'bl-css';
      st.textContent = '.bl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}' +
        '.bl-card{border:1px solid var(--adm-border);background:var(--adm-surface-2);border-radius:16px;padding:12px;display:flex;flex-direction:column;gap:10px}' +
        '.bl-prev{height:92px;border-radius:12px;background:#fff;display:grid;place-items:center;overflow:hidden}' +
        '.bl-prev img{max-width:78%;max-height:64px;object-fit:contain}' +
        '.bl-prev span{font:italic 900 1.2rem var(--font);color:#10263d;direction:ltr}' +
        '.bl-name{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-weight:700;font-size:.9rem;color:var(--adm-text)}' +
        '.bl-name small{font-weight:400;font-size:.7rem;color:var(--adm-muted);direction:ltr}' +
        '.bl-acts{display:flex;gap:6px}.bl-acts label,.bl-acts button{flex:1;text-align:center;justify-content:center;cursor:pointer;margin:0}' +
        '.bl-acts input{display:none}.bl-card.is-busy{opacity:.55;pointer-events:none}' +
        '.bl-st{font-size:.68rem;font-weight:700;padding:2px 8px;border-radius:999px;align-self:flex-start}' +
        '.bl-st.ok{color:#6ee7b7;background:rgba(52,211,153,.12)}.bl-st.no{color:#fcd34d;background:rgba(245,158,11,.12)}';
      document.head.appendChild(st);
    }
  }
  let blState = null; // { brands: [{key,name,n}], logos: {key:url} }
  async function loadBrandLogos(msg) {
    ensureLogosTab();
    const host = document.getElementById('cars-logos-panel'); if (!host) return;
    const client = initCarsClient(); if (!client) { host.innerHTML = '<div class="adm-empty-state">אין חיבור לשרת</div>'; return; }
    if (!blState) host.innerHTML = '<div class="adm-empty-state">טוען…</div>';
    const [lr, cr] = await Promise.all([client.from('brand_logos').select('brand_key,url'), client.from('cars').select('brand').eq('deleted', false)]);
    if (lr.error) {
      host.innerHTML = '<div class="form-block" style="padding:18px;"><b>הטבלה של סמלי המותגים עוד לא קיימת.</b><div class="form-hint" style="margin-top:6px;">צריך להריץ פעם אחת את הקובץ cars-phase3h-brand-logos.sql ב-SQL Editor של Supabase, ואז לרענן את הדף.<br>(' + escapeHtml(lr.error.message || '') + ')</div></div>';
      return;
    }
    const logos = {}; (lr.data || []).forEach(function (l) { logos[l.brand_key] = l.url; });
    const by = {};
    ((cr && cr.data) || []).forEach(function (c) { const k = logoKey(c.brand); if (!k) return; if (!by[k]) by[k] = { key: k, name: String(c.brand).trim(), n: 0 }; by[k].n++; });
    Object.keys(logos).forEach(function (k) { if (!by[k]) by[k] = { key: k, name: (blState && blState.names && blState.names[k]) || k, n: 0 }; });
    if (blState && blState.extra) blState.extra.forEach(function (x) { if (!by[x.key]) by[x.key] = { key: x.key, name: x.name, n: 0 }; });
    blState = { logos: logos, extra: (blState && blState.extra) || [], brands: Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return (b.n - a.n) || a.name.localeCompare(b.name); }) };
    renderBrandLogos(msg);
  }
  function renderBrandLogos(msg) {
    const host = document.getElementById('cars-logos-panel'); if (!host || !blState) return;
    const done = blState.brands.filter(function (b) { return blState.logos[b.key]; }).length;
    host.innerHTML = '<div class="form-block" style="padding:18px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:6px;"><div><div style="font-size:1.05rem;font-weight:800;color:var(--adm-text);">🏷️ סמלי מותגים</div>' +
        '<div class="form-hint" style="margin-top:4px;">' + done + ' מתוך ' + blState.brands.length + ' מותגים עם סמל. הסמל מופיע באתר בכל מקום שבו מופיע המותג; בלי סמל — שם המותג כתוב.</div></div>' +
        '<div style="display:flex;gap:6px;align-items:center;"><input type="text" id="bl-new" dir="ltr" placeholder="מותג נוסף, באנגלית (למשל Volvo)" style="width:230px;padding:9px 12px;border-radius:10px;border:1px solid var(--adm-border);background:var(--adm-surface-2);color:var(--adm-text);font-family:var(--font);font-size:.85rem;" onkeydown="if(event.key===\'Enter\')blAddBrand()">' +
        '<button type="button" class="tbl-btn" onclick="blAddBrand()">＋ הוסף מותג</button></div></div>' +
      '<div class="form-hint" style="margin-bottom:14px;">קובץ SVG (עדיף), PNG או WebP עם רקע שקוף, עד 400KB. סמל כהה או צבעוני — הוא יושב על רקע בהיר. מקור: מערכת המדיה הרשמית של היצרן או היבואן.</div>' +
      '<div id="bl-msg" class="form-hint" style="min-height:1.2em;margin-bottom:8px;font-weight:700;">' + (msg || '') + '</div>' +
      (blState.brands.length ? '<div class="bl-grid">' + blState.brands.map(function (b) {
        const u = blState.logos[b.key];
        return '<div class="bl-card" id="bl-' + escapeAttr(b.key) + '">' +
          '<div class="bl-prev">' + (u ? '<img src="' + escapeAttr(u) + '" alt="">' : '<span>' + escapeHtml(b.name) + '</span>') + '</div>' +
          '<div class="bl-name"><span dir="auto">' + escapeHtml(b.name) + '</span><small>' + (b.n ? b.n + ' דגמים' : 'אין דגמים עדיין') + '</small></div>' +
          '<span class="bl-st ' + (u ? 'ok">✓ יש סמל' : 'no">חסר סמל') + '</span>' +
          '<div class="bl-acts"><label class="tbl-btn"><input type="file" accept=".svg,.png,.webp,image/svg+xml,image/png,image/webp" onchange="blUpload(this,\'' + escapeAttr(b.key) + '\')">' + (u ? '↻ החלף' : '⬆️ העלה סמל') + '</label>' +
          (u ? '<button type="button" class="tbl-btn del" style="flex:0 0 auto;" title="הסר את הסמל" onclick="blRemove(\'' + escapeAttr(b.key) + '\')">✕</button>' : '') + '</div></div>';
      }).join('') + '</div>' : '<div class="adm-empty-state">אין עדיין רכבים במאגר. אפשר להוסיף מותג ידנית למעלה.</div>') +
      '</div>';
  }
  const blMsg = function (t, ok) { const m = document.getElementById('bl-msg'); if (m) { m.textContent = t; m.style.color = ok === false ? '#fb7185' : ok ? '#34d399' : ''; } };
  window.blAddBrand = function () {
    const inp = document.getElementById('bl-new'), name = inp ? inp.value.trim() : '', key = logoKey(name);
    if (!key || !/^[a-z0-9]+$/.test(key)) { blMsg('כתוב את שם המותג באנגלית (אותיות וספרות בלבד).', false); return; }
    if (!blState) return;
    if (!blState.brands.some(function (b) { return b.key === key; })) { blState.extra.push({ key: key, name: name }); blState.brands.unshift({ key: key, name: name, n: 0 }); }
    renderBrandLogos('נוסף ״' + escapeHtml(name) + '״ — עכשיו אפשר להעלות לו סמל.');
    const c = document.getElementById('bl-' + key); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  window.blUpload = async function (input, key) {
    const file = input.files && input.files[0]; input.value = ''; if (!file || !blState) return;
    const ext = LOGO_TYPES[file.type] || (/\.svg$/i.test(file.name) ? 'svg' : null);
    if (!ext) { blMsg('סוג קובץ לא נתמך. אפשר SVG, PNG או WebP.', false); return; }
    if (file.size > LOGO_MAX) { blMsg('הקובץ גדול מדי (' + Math.round(file.size / 1024) + 'KB). עד 400KB — סמל לא צריך יותר.', false); return; }
    if (!/^[a-z0-9]+$/.test(key)) { blMsg('מפתח מותג לא תקין.', false); return; }
    const client = initCarsClient(); if (!client) { blMsg('אין חיבור לשרת', false); return; }
    const card = document.getElementById('bl-' + key); if (card) card.classList.add('is-busy');
    blMsg('מעלה…');
    try {
      // שם קובץ חדש בכל העלאה — כך הדפדפנים לא ממשיכים להציג את הסמל הישן מהמטמון
      const path = 'logos/' + key + '-' + Date.now() + '.' + ext;
      const up = await client.storage.from(PHOTOS_BUCKET).upload(path, file, { contentType: ext === 'svg' ? 'image/svg+xml' : file.type, upsert: false });
      if (up.error) throw up.error;
      const url = client.storage.from(PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl;
      const sv = await client.from('brand_logos').upsert({ brand_key: key, url: url, updated_at: new Date().toISOString() }, { onConflict: 'brand_key' });
      if (sv.error) throw sv.error;
      blState.logos[key] = url;
      renderBrandLogos('✓ הסמל נשמר ומופיע באתר.'); blMsg('✓ הסמל נשמר ומופיע באתר.', true);
    } catch (e) {
      if (card) card.classList.remove('is-busy');
      blMsg('ההעלאה נכשלה: ' + (e && e.message ? e.message : e), false);
    }
  };
  window.blRemove = async function (key) {
    if (!blState || !blState.logos[key]) return;
    if (!window.confirm('להסיר את הסמל? המותג יחזור להופיע בשם כתוב.')) return;
    const client = initCarsClient(); if (!client) return;
    const card = document.getElementById('bl-' + key); if (card) card.classList.add('is-busy');
    const r = await client.from('brand_logos').delete().eq('brand_key', key);
    if (r.error) { if (card) card.classList.remove('is-busy'); blMsg('ההסרה נכשלה: ' + r.error.message, false); return; }
    delete blState.logos[key];
    renderBrandLogos(); blMsg('הסמל הוסר.', true);
  };

  if (typeof window.adminTab === 'function' && !window.__carsAdminTabWrapped) {
    const prevAdminTab = window.adminTab;
    window.adminTab = function (tab, btnEl) {
      prevAdminTab(tab, btnEl);
      const panel = document.getElementById('admin-cars');
      if (!panel) return;
      panel.style.display = tab === 'cars' ? '' : 'none';
      if (tab === 'cars') { ensureLogosTab(); loadCarDrafts(); }
    };
    window.__carsAdminTabWrapped = true;
  }

  // ═══════════ העלאת קבצים (מפרט + תמונות) ═══════════

  async function uploadSpecFile(file) {
    const client = initCarsClient();
    if (!client) return null;
    const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
    const path = 'specs/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    const { error } = await client.storage.from(SPECS_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) { console.error('[cars-admin] העלאת קובץ מפרט נכשלה:', error); return null; }
    return path; // ה-bucket פרטי — שומרים נתיב, לא URL ציבורי
  }

  async function uploadCarPhoto(file) {
    const client = initCarsClient();
    if (!client) return null;
    // משתמשים בפונקציית הדחיסה הגלובלית הקיימת מ-app.js — אותה איכות/גודל
    // כמו תמונות גלריה של כתבות, בלי לשכפל לוגיקה.
    let toUpload = file;
    if (typeof window.compressImageFile === 'function') {
      const compressed = await window.compressImageFile(file, 350);
      if (compressed) toUpload = compressed;
    }
    const ext = (toUpload.name.split('.').pop() || 'webp').toLowerCase();
    const path = 'photos/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    const { error } = await client.storage.from(PHOTOS_BUCKET).upload(path, toUpload, { contentType: toUpload.type, upsert: false });
    if (error) { console.error('[cars-admin] העלאת תמונה נכשלה:', error); return null; }
    const { data } = client.storage.from(PHOTOS_BUCKET).getPublicUrl(path);
    return data && data.publicUrl ? data.publicUrl : null;
  }

  window.createCarDraft = async function (btn) {
    const client = initCarsClient();
    if (!client) { alert('אין חיבור לשרת — נסה לרענן את הדף.'); return; }
    const token = await getAuthToken();
    if (!token) { alert('יש להתחבר לניהול קודם.'); return; }

    const specInput = document.getElementById('car-spec-file');
    const photosInput = document.getElementById('car-photos-files');
    const specFile = specInput && specInput.files && specInput.files[0];
    const photoFiles = photosInput && photosInput.files ? Array.from(photosInput.files) : [];

    if (!specFile) { alert('יש לבחור קובץ גיליון מפרט (PDF או תמונה).'); return; }

    const statusEl = document.getElementById('car-upload-status');
    const originalText = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = 'מעלה...'; }
    if (statusEl) statusEl.textContent = 'מעלה את קובץ המפרט...';

    try {
      const specPath = await uploadSpecFile(specFile);
      if (!specPath) { alert('העלאת קובץ המפרט נכשלה.'); return; }

      const photoUrls = [];
      for (let i = 0; i < photoFiles.length; i++) {
        if (statusEl) statusEl.textContent = 'מעלה תמונה ' + (i + 1) + ' מתוך ' + photoFiles.length + '...';
        const url = await uploadCarPhoto(photoFiles[i]);
        if (url) photoUrls.push(url);
      }

      if (statusEl) statusEl.textContent = 'יוצר טיוטה...';
      const { data: draft, error } = await client.from('car_drafts').insert({
        source_file_url: specPath,
        photo_urls: photoUrls,
        status: 'pending',
      }).select().single();
      if (error) { alert('יצירת הטיוטה נכשלה: ' + error.message); return; }

      if (specInput) specInput.value = '';
      if (photosInput) photosInput.value = '';
      if (statusEl) statusEl.textContent = '✓ הטיוטה נוצרה. לחץ "חלץ נתונים" ברשימה למטה.';
      loadCarDrafts();
      // מריצים חילוץ אוטומטית מיד — חוסך למנהל לחיצה נוספת בכל פעם
      setTimeout(function () { extractDraftSpec(draft.id); }, 300);
    } catch (e) {
      alert('שגיאה ביצירת הטיוטה: ' + (e && e.message ? e.message : e));
      console.error('[cars-admin] createCarDraft חריגה:', e);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
  };

  // ═══════════ טיוטות רכב חדש (car_drafts) ═══════════

  async function loadCarDrafts() {
    const client = initCarsClient();
    const list = document.getElementById('cars-drafts-list');
    if (!list || !client) return;
    list.innerHTML = '<div class="adm-empty-state">טוען...</div>';
    try {
      const { data, error } = await client.from('car_drafts').select('*').eq('status', 'pending').order('created_at', { ascending: false });
      if (error) { list.innerHTML = '<div class="adm-empty-state">שגיאה בטעינת הטיוטות: ' + escapeAttr(error.message) + '</div>'; return; }
      if (!data || !data.length) { list.innerHTML = '<div class="adm-empty-state">אין טיוטות רכב ממתינות — העלה גיליון מפרט למעלה כדי להתחיל.</div>'; return; }
      // טיוטות עדכון מציגות את שם הרכב באתר — טוענים שמות אם רשימת הרכבים עוד לא נטענה
      if (data.some(function (d) { return d.published_car_id; }) && !(_allCarsCache && _allCarsCache.length)) {
        const ids = data.map(function (d) { return d.published_car_id; }).filter(Boolean);
        const { data: names } = await client.from('cars').select('id,brand,model').in('id', ids);
        if (names && names.length && !(_allCarsCache && _allCarsCache.length)) _allCarsCache = names.map(function (c) { return Object.assign({ _lite: true }, c); });
      }
      data.forEach(function (d) {
        _draftsCache[d.id] = d;
        // הבדיקה האחרונה נשמרת במסד — מציגים אותה גם אחרי רענון הדף
        const vr = d.verification_report;
        if (!draftVerifications[d.id] && vr && !Array.isArray(vr) && typeof vr === 'object' && (vr.blockingIssues || vr.warnings)) draftVerifications[d.id] = vr;
      });
      list.innerHTML = data.map(renderDraftRow).join('');
      data.forEach(function (d) { if (draftVerifications[d.id]) renderDraftVerifyResult(d.id); });
    } catch (e) {
      list.innerHTML = '<div class="adm-empty-state">שגיאה בטעינת הטיוטות.</div>';
      console.error('[cars-admin] loadCarDrafts חריגה:', e);
    }
  }

  function renderDraftRow(d) {
    const ex = d.extracted_data;
    const target = d.published_car_id ? (_allCarsCache || []).filter(function (c) { return c.id === d.published_car_id; })[0] : null;
    const title = (d.published_car_id ? '🔄 עדכון: ' + escapeAttr(target ? target.brand + ' ' + target.model : 'רכב #' + d.published_car_id) + (ex && ex.brand ? ' <span style="font-weight:400;color:var(--adm-muted);">(במסמך: ' + escapeAttr(ex.brand + ' ' + (ex.model || '')) + ')</span>' : '') : '') ||
      (ex && ex.brand ? escapeAttr(ex.brand + ' ' + (ex.model || '') + (ex.year ? ' ' + ex.year : '')) : 'טיוטה #' + d.id + ' — עדיין לא חולצו נתונים');
    const photoCount = Array.isArray(d.photo_urls) ? d.photo_urls.length : 0;
    // כפתורים (08.11.2026): שלושה ראשיים לפי סדר העבודה, והשאר (פעולות נדירות) בתפריט "עוד".
    // החילוץ והבדיקה מול המקור רצים לבד אחרי העלאת המפרט — לוחצים עליהם רק כדי להריץ מחדש.
    const menuItem = 'display:block;width:100%;text-align:right;margin:2px 0;';
    const extractBtn = ex
      ? '<button class="tbl-btn" style="' + menuItem + '" id="extract-btn-' + d.id + '" onclick="extractDraftSpec(' + d.id + ',this)" title="קורא שוב את קובץ המפרט ומחליף את הנתונים הטכניים (הפרטים האישיים נשמרים)">🔎 חלץ מחדש מהמפרט</button>'
      : '<button class="tbl-btn" style="background:var(--adm-accent,#ff9d2e);color:#0a0e14;font-weight:700;" id="extract-btn-' + d.id + '" onclick="extractDraftSpec(' + d.id + ',this)">🔎 חלץ נתונים מהמפרט</button>';
    const verifyBtn = ex ? '<button class="tbl-btn" style="' + menuItem + '" id="verify-btn-' + d.id + '" onclick="verifyDraftSpec(' + d.id + ',this)" title="משווה שוב כל נתון לקובץ המקור">🔍 בדוק שוב מול המפרט</button>' : '';
    const editBtn = ex ? '<button class="tbl-btn" onclick="openDraftForm(' + d.id + ')" title="כל השדות הטכניים, הגרסאות והאבזור">' + (d.published_car_id ? '🔄 השוואה ועדכון הרכב' : '📝 עריכה מלאה') + '</button>' : '';
    const isNew = ex && !d.published_car_id;
    const personalBtn = isNew ? '<button class="tbl-btn" style="border-color:var(--adm-accent,#ff9d2e);font-weight:700;" onclick="togglePersonalPanel(\'draft\',' + d.id + ')" title="תמונות, ללא רקע, מחירים, ציון, תיאור, יתרונות/חסרונות">✨ השלם פרטים</button>' : '';
    const publishBtn = isNew ? '<button class="tbl-btn" id="publish-btn-' + d.id + '" style="background:var(--adm-accent,#ff9d2e);color:#0a0e14;font-weight:700;" onclick="publishDraftDirect(' + d.id + ',this)">🚀 פרסם</button>' : '';
    const moreMenu = '<details class="adm-more" style="position:relative;display:inline-block;"><summary class="tbl-btn" style="list-style:none;cursor:pointer;">⋯ עוד</summary>' +
      '<div style="position:absolute;inset-inline-start:0;top:calc(100% + 4px);z-index:20;min-width:210px;padding:6px;border-radius:10px;background:var(--adm-surface,#12171f);border:1px solid var(--adm-border);box-shadow:0 8px 24px rgba(0,0,0,.35);">' +
        (ex ? extractBtn : '') + verifyBtn +
        '<button class="tbl-btn del" style="' + menuItem + '" onclick="discardCarDraft(' + d.id + ')">✕ מחק טיוטה</button>' +
      '</div></details>';
    return '<div class="adm-row">' +
      '<div class="adm-row-top">' +
        '<div class="adm-row-info">' +
          '<div class="adm-row-title" id="draft-title-' + d.id + '">' + title + '</div>' +
          '<div class="adm-row-meta"><span>📎 קובץ מפרט מועלה</span><span>🖼️ ' + photoCount + ' תמונות</span>' + (ex && Array.isArray(ex.trims) && ex.trims.length ? '<span>🧩 ' + ex.trims.length + ' גרסאות</span>' : '') + '</div>' +
          (isNew ? '<div id="draft-check-' + d.id + '">' + personalChecklist(ex, d.photo_urls || [], 'draft') + '</div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="adm-row-bottom">' +
        '<div class="tbl-actions">' + (ex ? personalBtn + publishBtn + editBtn : extractBtn) + moreMenu + '</div>' +
        '<div id="draft-verify-' + d.id + '" style="width:100%;"></div>' +
        '<div id="draft-personal-' + d.id + '" style="width:100%;"></div>' +
      '</div>' +
    '</div>';
  }

  window.discardCarDraft = async function (draftId) {
    if (!confirm('למחוק את הטיוטה הזו לצמיתות? (הקבצים שהועלו יישארו באחסון)')) return;
    const client = initCarsClient();
    if (!client) return;
    try {
      await client.from('car_drafts').update({ status: 'discarded' }).eq('id', draftId);
      loadCarDrafts();
    } catch (e) { alert('שגיאה במחיקת הטיוטה.'); console.error('[cars-admin] discardCarDraft נכשל:', e); }
  };

  window.extractDraftSpec = async function (draftId, btn) {
    const token = await getAuthToken();
    if (!token) { alert('יש להתחבר לניהול קודם.'); return; }
    const realBtn = btn || document.getElementById('extract-btn-' + draftId);
    const originalText = realBtn ? realBtn.textContent : null;
    if (realBtn) { realBtn.disabled = true; realBtn.textContent = '🔄 מחלץ...'; }
    try {
      const res = await fetch(EDGE_BASE + '/extract-car-spec', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId: draftId }),
      });
      const rawText = await res.text();
      let json = null;
      try { json = JSON.parse(rawText); } catch (e) { /* לא JSON — נטפל למטה */ }
      if (!res.ok || !json || json.error) {
        const detail = (json && json.error) ? json.error : ('קוד ' + res.status + ': ' + rawText.slice(0, 300));
        alert('שגיאה בחילוץ הנתונים:\n' + detail);
        return;
      }
      delete draftVerifications[draftId]; // חילוץ חדש = צריך לבדוק מחדש
      await loadCarDrafts();
      // בדיקה מול המקור רצה אוטומטית מיד אחרי החילוץ — לא צריך ללחוץ
      verifyDraftSpec(draftId, document.getElementById('verify-btn-' + draftId));
    } catch (e) {
      alert('שגיאה בחילוץ הנתונים (שגיאת רשת/JS):\n' + (e && e.message ? e.message : e));
      console.error('[cars-admin] extractDraftSpec חריגה:', e);
    } finally {
      if (realBtn) { realBtn.disabled = false; realBtn.textContent = originalText; }
    }
  };

  window.verifyDraftSpec = async function (draftId, btn) {
    const token = await getAuthToken();
    if (!token) { alert('יש להתחבר לניהול קודם.'); return; }
    const resultEl = document.getElementById('draft-verify-' + draftId);
    const originalText = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = '🔄 בודק...'; }
    if (resultEl) resultEl.innerHTML = '<div style="font-size:0.78rem;color:var(--adm-muted);margin-top:6px;">קורא שוב את קובץ המקור ומשווה כל שדה — עד כ-15 שניות...</div>';
    try {
      const res = await fetch(EDGE_BASE + '/verify-car-spec', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId: draftId }),
      });
      const rawText = await res.text();
      let json = null;
      try { json = JSON.parse(rawText); } catch (e) { /* לא JSON */ }
      if (!res.ok || !json || (json.error && !json.blockingIssues)) {
        const detail = (json && json.error) ? json.error : ('קוד ' + res.status + ': ' + rawText.slice(0, 200));
        draftVerifications[draftId] = { ok: false, blockingIssues: [{ category: 'שגיאה בבדיקה', text: detail }], warnings: [] };
      } else {
        draftVerifications[draftId] = json;
      }
      renderDraftVerifyResult(draftId);
    } catch (e) {
      draftVerifications[draftId] = { ok: false, blockingIssues: [{ category: 'שגיאה בבדיקה', text: String(e && e.message ? e.message : e) }], warnings: [] };
      renderDraftVerifyResult(draftId);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
  };

  // ═══════════ פרטים אישיים — מחוץ לטופס העריכה (05.11.2026) ═══════════
  // כל מה שלא מגיע מהמפרט ודורש אותך: תמונה ראשית, תמונה ללא רקע, מחיר, ציון, תיאור, יתרונות/חסרונות,
  // סרטון ותמונות לפריטי האבזור הבולטים. נפתח ישירות משורת הטיוטה או משורת הרכב, בלי להיכנס לעריכה.
  // טיוטה: נשמר בתוך car_drafts.extracted_data (+ סדר photo_urls) ונכנס לרכב כשמפרסמים. רכב קיים: נשמר ישר ב-cars.
  const _draftsCache = {};
  let pState = null; // {kind:'draft'|'car', id, photos[], main, cutout, f:{...}, highlights[]}
  const P_TEXT = [
    { key: 'price', label: 'מחיר בסיס (₪)', type: 'number', hint: 'ריק = "מחיר טרם פורסם"' },
    { key: 'price_top', label: 'מחיר רמה עליונה (₪)', type: 'number' },
    { key: 'score', label: 'ציון ספידומטר (0-10)', type: 'float', hint: 'העיגול שליד הרכב בעמוד הדגם' },
    { key: 'youtube_video_url', label: 'קישור סרטון יוטיוב', type: 'text' },
    { key: 'description', label: 'תיאור הרכב', type: 'textarea' },
    { key: 'pros', label: '✅ יתרונות (שורה = פריט)', type: 'list' },
    { key: 'cons', label: '❌ חסרונות (שורה = פריט)', type: 'list' },
  ];
  const isBlank = function (v) { return v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length); };
  function personalChecklist(src, photos, kind) {
    const hl = Array.isArray(src.highlights) ? src.highlights.filter(function (h) { return h && h.title; }) : [];
    const hlImg = hl.filter(function (h) { return h.image; }).length;
    const items = [
      ['★ תמונה ראשית', !!(src.image_main || (photos && photos.length))],
      ['✂️ ללא רקע', !!src.image_cutout],
      ['₪ מחיר', !isBlank(src.price)],
      ['⭐ ציון', !isBlank(src.score)],
      ['📝 תיאור', !isBlank(src.description)],
      ['👍 יתרונות/חסרונות', !isBlank(src.pros) && !isBlank(src.cons)],
      ['▶️ סרטון', !isBlank(src.youtube_video_url)],
    ];
    if (hl.length) items.push(['🖼️ תמונות אבזור ' + hlImg + '/' + hl.length, hlImg === hl.length]);
    const done = items.filter(function (i) { return i[1]; }).length;
    return '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;" title="' + (kind === 'draft' ? 'מה עוד חסר לפני הפרסום' : 'מה חסר ברכב') + '">' +
      '<span style="font-size:0.7rem;font-weight:700;color:var(--adm-muted);align-self:center;margin-inline-end:2px;">' + done + '/' + items.length + '</span>' +
      items.map(function (i) {
        return '<span style="font-size:0.68rem;padding:2px 7px;border-radius:999px;border:1px solid ' + (i[1] ? 'rgba(45,212,191,.45)' : 'var(--adm-border)') + ';color:' + (i[1] ? 'var(--adm-good,#2dd4bf)' : 'var(--adm-muted)') + ';">' + (i[1] ? '✓ ' : '') + escapeAttr(i[0]) + '</span>';
      }).join('') + '</div>';
  }

  window.togglePersonalPanel = function (kind, id) {
    const host = document.getElementById((kind === 'draft' ? 'draft-personal-' : 'car-personal-') + id);
    if (!host) return;
    if (pState && pState.kind === kind && pState.id === id && host.innerHTML) { host.innerHTML = ''; pState = null; return; }
    document.querySelectorAll('[id^="draft-personal-"],[id^="car-personal-"]').forEach(function (el) { el.innerHTML = ''; });
    let src, photos;
    if (kind === 'draft') {
      const d = _draftsCache[id]; if (!d) return;
      src = d.extracted_data || {}; photos = (d.photo_urls || []).slice();
    } else {
      src = (_allCarsCache || []).filter(function (c) { return c.id === id; })[0]; if (!src) return;
      photos = (src.gallery_images || []).slice();
      if (src.image_main && photos.indexOf(src.image_main) === -1) photos.unshift(src.image_main);
    }
    const f = {};
    P_TEXT.forEach(function (p) { f[p.key] = src[p.key] === undefined ? null : src[p.key]; });
    pState = {
      kind: kind, id: id, photos: photos, main: src.image_main && photos.indexOf(src.image_main) !== -1 ? src.image_main : (photos[0] || null),
      cutout: src.image_cutout || null, f: f,
      colors: (Array.isArray(src.colors) ? src.colors : []).filter(Boolean).slice(0, 12),
      colorImages: Object.assign({}, src.color_images && typeof src.color_images === 'object' ? src.color_images : {}),
      trims: trimsToKgm(src.trims).filter(function (t) { return t && t.name; }), // מחיר לכל גרסה
      highlights: JSON.parse(JSON.stringify(Array.isArray(src.highlights) ? src.highlights.filter(function (h) { return h && h.title; }) : [])),
      // זיהוי (רק בטיוטה — ברכב מפורסם שינוי כתובת פוגע בקידום): יצרן/דגם/שנת דגם/כתובת
      ident: kind === 'draft' ? { brand: src.brand || '', model: src.model || '', year: src.year || '', slug: src.slug || '' } : null,
    };
    renderPersonal();
  };
  function pHost() { return pState ? document.getElementById((pState.kind === 'draft' ? 'draft-personal-' : 'car-personal-') + pState.id) : null; }
  // מחיר לכל גרסה: המחיר הכללי = הזול מביניהם ("החל מ"), מחיר רמה עליונה = היקר
  function pSyncTrimPrices() {
    if (!pState || !pState.trims.length) return;
    pState.trims.forEach(function (t, i) {
      const el = document.getElementById('p-tp-' + i); if (!el) return;
      const n = parseInt(String(el.value).replace(/[^\d]/g, ''), 10);
      t.price = el.value.trim() === '' || isNaN(n) ? null : n;
    });
    const ps = pState.trims.map(function (t) { return t.price; }).filter(function (v) { return v != null; });
    if (ps.length) { pState.f.price = Math.min.apply(null, ps); pState.f.price_top = ps.length > 1 ? Math.max.apply(null, ps) : null; }
  }
  // ── פענוח טקסט חופשי של מחירון → מחיר לכל גרסה (05.11.2026) ──
  // מדביקים את המחירון כמו שהוא (מהיבואן/מהודעה). כל מחיר משויך לגרסה ששמה מופיע לידו;
  // אם אין שמות בכלל ומספר המחירים = מספר הגרסאות — לפי הסדר. שום דבר לא נשמר עד שבודקים ולוחצים "שמור".
  const priceTok = function (s) { return String(s || '').toLowerCase().replace(/[״"׳']/g, '').split(/[^a-z0-9\u0590-\u05ff+]+/).filter(Boolean); };
  function parsePriceList(text, names) {
    const t = String(text || '');
    const found = []; // {price, start, end}
    const re = /(\d{2,3}(?:[.,]\d{1,3})?)\s*(?:אלף|k\b)|(\d{1,3}(?:[,.]\d{3})+|\d{5,7})/gi; // רווח לא נחשב מפריד אלפים — אחרת 'E 450 529,000' מתחבר למספר אחד
    let m;
    while ((m = re.exec(t))) {
      let v;
      if (m[1]) v = Math.round(parseFloat(m[1].replace(',', '.')) * 1000);
      else v = parseInt(m[2].replace(/[,.]/g, ''), 10);
      if (v >= 20000 && v <= 5000000) found.push({ price: v, start: m.index, end: m.index + m[0].length });
    }
    if (!found.length) return { map: {}, notes: ['לא נמצאו מחירים בטקסט (מספרים כמו 189,990 או 189.9 אלף)'] };
    // מקטעים: שורות עם מחיר אחד בדיוק → כל שורה מקטע; אחרת — מהמחיר הקודם עד סוף המחיר הנוכחי
    const lines = t.split(/\n|;|•|\|/);
    let segs = [];
    let off = 0; const lineSegs = [];
    lines.forEach(function (ln) { const st = off, en = off + ln.length; off = en + 1; const inLine = found.filter(function (f) { return f.start >= st && f.end <= en; }); if (inLine.length) lineSegs.push({ text: ln, prices: inLine }); });
    if (lineSegs.length > 1 && lineSegs.every(function (x) { return x.prices.length === 1; })) segs = lineSegs.map(function (x) { return { text: x.text, price: x.prices[0].price }; });
    else { let prev = 0; segs = found.map(function (f) { const sg = { text: t.slice(prev, f.end), price: f.price }; prev = f.end; return sg; }); }
    const nameToks = names.map(priceTok);
    const freq = {}; nameToks.forEach(function (ts) { ts.forEach(function (x) { freq[x] = (freq[x] || 0) + 1; }); });
    const map = {}, notes = [];
    let anyName = false;
    segs.forEach(function (sg) {
      const st = priceTok(sg.text);
      const scores = nameToks.map(function (ts) { return ts.reduce(function (a, x) { return a + (st.indexOf(x) !== -1 ? 1 / freq[x] : 0); }, 0); });
      const best = Math.max.apply(null, scores);
      if (best <= 0) return;
      anyName = true;
      const idx = scores.indexOf(best);
      if (scores.filter(function (x) { return x === best; }).length > 1) { notes.push('לא ברור לאיזו גרסה שייך ' + sg.price.toLocaleString('en-US') + ' — מלא ידנית'); return; }
      if (map[idx] != null && map[idx] !== sg.price) { notes.push('לגרסה ' + names[idx] + ' נמצאו שני מחירים — נלקח הראשון (' + map[idx].toLocaleString('en-US') + ')'); return; }
      map[idx] = sg.price;
    });
    if (!anyName) {
      if (found.length === names.length) { found.forEach(function (f, i) { map[i] = f.price; }); notes.push('שמות הגרסאות לא הופיעו בטקסט — המחירים שויכו לפי הסדר. בדוק שזה נכון!'); }
      else notes.push('שמות הגרסאות לא הופיעו בטקסט, ונמצאו ' + found.length + ' מחירים ל-' + names.length + ' גרסאות — מלא ידנית');
    }
    names.forEach(function (n, i) { if (map[i] == null && anyName) notes.push('לא נמצא מחיר לגרסה ' + n); });
    return { map: map, notes: notes };
  }
  window.pParsePrices = function () {
    if (!pState) return;
    const ta = document.getElementById('p-price-text'); if (!ta) return;
    const r = parsePriceList(ta.value, pState.trims.map(function (t) { return t.name; }));
    let n = 0;
    Object.keys(r.map).forEach(function (i) { const el = document.getElementById('p-tp-' + i); if (el) { el.value = Number(r.map[i]).toLocaleString('en-US'); el.style.borderColor = '#2ecc71'; n++; } });
    window.pTrimPriceInput();
    const out = document.getElementById('p-price-parse');
    if (out) out.innerHTML = (n ? '<span style="color:#2ecc71;font-weight:700;">✓ שובצו ' + n + ' מתוך ' + pState.trims.length + ' מחירים — בדוק ולחץ "שמור"</span>' : '<span style="color:#e74c3c;font-weight:700;">לא שובץ אף מחיר</span>') +
      (r.notes.length ? '<br>' + r.notes.map(function (x) { return '• ' + escapeHtml(x); }).join('<br>') : '');
  };
  window.pIdentInput = function (k) {
    if (!pState || !pState.ident) return;
    const g = function (x) { const el = document.getElementById('p-id-' + x); return el ? el.value.trim() : ''; };
    const before = slugify(pState.ident.brand, pState.ident.model, pState.ident.year);
    const slugEl = document.getElementById('p-id-slug');
    const slugWasAuto = !pState.ident.slug || pState.ident.slug === before;
    ['brand', 'model', 'year'].forEach(function (x) { pState.ident[x] = g(x); });
    if (k === 'slug') { pState.ident.slug = g('slug'); return; }
    if (slugWasAuto && slugEl) { pState.ident.slug = slugify(pState.ident.brand, pState.ident.model, pState.ident.year); slugEl.value = pState.ident.slug; }
  };
  window.openPersonalPrices = function (draftId) {
    if (!(pState && pState.kind === 'draft' && pState.id === draftId)) window.togglePersonalPanel('draft', draftId);
    const box = document.getElementById('p-prices'), ta = document.getElementById('p-price-text');
    if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (ta) setTimeout(function () { ta.focus(); }, 350);
  };
  window.pTrimPriceInput = function () {
    pSyncTrimPrices();
    const a = document.getElementById('p-f-price'), b = document.getElementById('p-f-price_top');
    if (a) a.value = pState.f.price != null ? Number(pState.f.price).toLocaleString('en-US') : '';
    if (b) b.value = pState.f.price_top != null ? Number(pState.f.price_top).toLocaleString('en-US') : '';
  };
  function pReadInputs() {
    if (!pState) return;
    if (pState.ident) ['brand', 'model', 'year', 'slug'].forEach(function (k) { const el = document.getElementById('p-id-' + k); if (el) pState.ident[k] = el.value.trim(); });
    P_TEXT.forEach(function (p) {
      const el = document.getElementById('p-f-' + p.key); if (!el) return;
      const raw = el.value;
      if (p.type === 'list') pState.f[p.key] = raw.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
      else if (p.type === 'number') { const n = parseInt(String(raw).replace(/[^\d]/g, ''), 10); pState.f[p.key] = raw.trim() === '' || isNaN(n) ? null : n; }
      else if (p.type === 'float') { const n = parseFloat(raw); pState.f[p.key] = raw.trim() === '' || isNaN(n) ? null : n; }
      else pState.f[p.key] = raw.trim() === '' ? null : raw.trim();
    });
    pSyncTrimPrices(); // כשיש מחירי גרסאות — הם קובעים את מחיר הבסיס והעליון
  }
  // ═══════════ ✨ פרטים אישיים — "סטודיו זכוכית" (09.11.2026) ═══════════
  // הרקע של הפאנל הוא התמונה הראשית של הרכב עצמה, מטושטשת (כמו עטיפת אלבום ב-Apple Music) — לכל רכב אווירה משלו.
  // מעליה כרטיסי זכוכית שקופים עם הברקה שעוקבת אחרי העכבר; הטקסט יושב על שכבה כהה מספיק כדי להיות חד תמיד.
  const PP_CSS = `
.admin-page .pp{--g-txt:#f5f7fa;--g-sub:#c3cad6;--g-dim:#97a1b0;--g-line:rgba(255,255,255,.13);--g-hi:rgba(255,255,255,.28);--g-fill:rgba(16,20,28,.5);--g-fill-2:rgba(255,255,255,.06);--g-acc:#ff9d2e;--g-ok:#34d399;--g-bad:#fb7185;
  position:relative;margin-top:12px;border-radius:28px;overflow:clip;isolation:isolate;color:var(--g-txt);text-align:start;font-family:var(--font);padding:0 0 4px;
  box-shadow:0 30px 80px -30px rgba(0,0,0,.8),0 0 0 1px rgba(255,255,255,.07) inset;background:#07090d}
.pp-amb{position:absolute;inset:-80px;z-index:-2;background-size:cover;background-position:center;filter:blur(70px) saturate(1.8) brightness(.55);transform:scale(1.1)}
.pp-amb.is-aurora{background:radial-gradient(40% 50% at 15% 20%,rgba(255,157,46,.55),transparent 70%),radial-gradient(45% 55% at 85% 30%,rgba(56,189,248,.45),transparent 70%),radial-gradient(50% 50% at 50% 95%,rgba(167,139,250,.4),transparent 70%);filter:blur(40px)}
.pp-amb::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(5,7,10,.25),rgba(5,7,10,.6) 45%,rgba(5,7,10,.78))}
.pp-grain{position:absolute;inset:0;z-index:-1;pointer-events:none;opacity:.06;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.pp-glass{position:relative;background:var(--g-fill);-webkit-backdrop-filter:blur(30px) saturate(170%);backdrop-filter:blur(30px) saturate(170%);border:1px solid var(--g-line);
  box-shadow:inset 0 1px 0 var(--g-hi),inset 0 -1px 0 rgba(255,255,255,.04),0 12px 34px -14px rgba(0,0,0,.65)}
.pp-glass::before{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;transition:opacity .35s;
  background:radial-gradient(260px circle at var(--mx,50%) var(--my,0%),rgba(255,255,255,.12),transparent 60%)}
.pp-glass:hover::before{opacity:1}
/* ── כותרת ── */
.pp-hero{display:grid;grid-template-columns:auto 1fr auto auto;gap:18px;align-items:center;padding:22px 24px 18px}
.pp-kind{display:inline-flex;align-items:center;gap:6px;font-size:.68rem;font-weight:700;letter-spacing:.04em;color:var(--g-sub);padding:4px 10px;border-radius:999px;background:var(--g-fill-2);border:1px solid var(--g-line);margin-bottom:8px}
.pp-kind i{width:6px;height:6px;border-radius:50%;background:var(--g-acc);box-shadow:0 0 10px var(--g-acc)}
.pp-kind.is-live i{background:var(--g-ok);box-shadow:0 0 10px var(--g-ok)}
.pp-title{margin:0;line-height:1.05;font-size:clamp(1.45rem,3.2vw,2.15rem);letter-spacing:-.02em;text-shadow:0 2px 18px rgba(0,0,0,.45)}
.pp-title b{font-weight:900}.pp-title span{font-weight:300;color:var(--g-sub)}
.pp-title em{font-style:normal;font-family:var(--adm-num);font-weight:600;font-size:.62em;color:var(--g-acc);margin-inline-start:8px;vertical-align:.25em}
.pp-tag{font-size:.78rem;color:var(--g-sub);margin-top:6px}
.pp-thumb{width:118px;aspect-ratio:16/10;border-radius:16px;overflow:hidden;border:1px solid var(--g-line);box-shadow:0 10px 30px -10px rgba(0,0,0,.8),inset 0 1px 0 var(--g-hi);background:#0c1017}
.pp-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.pp-gauge{position:relative;width:120px;text-align:center}
.pp-gauge svg{width:120px;height:70px;overflow:visible}
.pp-gauge .trk{fill:none;stroke:rgba(255,255,255,.1);stroke-width:9;stroke-linecap:round}
.pp-gauge .val{fill:none;stroke:url(#ppGrad);stroke-width:9;stroke-linecap:round;transition:stroke-dashoffset 1s cubic-bezier(.2,.8,.2,1);filter:drop-shadow(0 0 6px rgba(255,157,46,.55))}
.pp-gauge .tick{stroke:rgba(255,255,255,.22);stroke-width:1.5}
.pp-gauge .ndl{transform-origin:60px 62px;transition:transform 1s cubic-bezier(.2,.8,.2,1)}
.pp-gauge .ndl line{stroke:#fff;stroke-width:2.5;stroke-linecap:round;filter:drop-shadow(0 0 4px rgba(255,255,255,.6))}
.pp-gauge .hub{fill:#fff}
.pp-gauge-n{margin-top:2px;font-family:var(--adm-num);font-weight:700;font-size:1.25rem;line-height:1}
.pp-gauge-n small{display:block;font-family:var(--font);font-size:.6rem;font-weight:600;color:var(--g-dim);letter-spacing:.06em;margin-top:2px}
.pp-x{align-self:start;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;cursor:pointer;color:var(--g-txt);font-size:1rem;background:rgba(255,255,255,.08);border:1px solid var(--g-line);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);transition:transform .2s,background .2s}
.pp-x:hover{transform:rotate(90deg);background:rgba(255,255,255,.16)}
/* ── ניווט מקטעים ── */
.pp-nav{position:relative;z-index:5;margin:0 16px 14px;padding:5px;border-radius:999px;display:flex;gap:2px;overflow-x:auto;scrollbar-width:none}
.pp-nav::-webkit-scrollbar{display:none}
.pp-nav.is-float,.pp-dock.is-float{position:fixed;margin:0;z-index:60;background:rgba(14,18,26,.62);box-shadow:inset 0 1px 0 var(--g-hi),0 18px 40px -12px rgba(0,0,0,.85)}
.pp-nav.is-float{top:10px}.pp-dock.is-float{bottom:12px}
.pp-ph-spc{display:none}.pp-ph-spc.on{display:block}
.pp-nav button{flex:1 0 auto;display:inline-flex;align-items:center;justify-content:center;gap:7px;border:0;background:none;color:var(--g-sub);font:600 .78rem var(--font);padding:9px 14px;border-radius:999px;cursor:pointer;transition:background .2s,color .2s;white-space:nowrap}
.pp-nav button:hover{background:rgba(255,255,255,.08);color:var(--g-txt)}
.pp-nav button.on{background:rgba(255,255,255,.16);color:#fff;box-shadow:inset 0 1px 0 var(--g-hi)}
.pp-nav i{width:7px;height:7px;border-radius:50%;background:#f59e0b;box-shadow:0 0 8px #f59e0b}
.pp-nav i.ok{background:var(--g-ok);box-shadow:0 0 8px var(--g-ok)}
/* ── מקטעים ── */
.pp-body{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;padding:0 16px}
.pp-sec,.pp-sh>div{min-width:0}
.pp-sec{border-radius:22px;padding:18px 20px 20px;scroll-margin-top:70px}
.pp-sh{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.pp-ic{flex:none;width:40px;height:40px;border-radius:13px;display:grid;place-items:center;color:#fff;background:linear-gradient(145deg,rgba(255,255,255,.22),rgba(255,255,255,.04));border:1px solid var(--g-line);box-shadow:inset 0 1px 0 var(--g-hi)}
.pp-ic svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.pp-sh .pp-h{margin:0;font-size:1rem;font-weight:800;color:var(--g-txt);letter-spacing:-.01em}
.pp-sh .pp-p{margin:2px 0 0;font-size:.76rem;color:var(--g-sub);line-height:1.45}
.pp-st{margin-inline-start:auto;flex:none;font-size:.7rem;font-weight:700;padding:4px 10px;border-radius:999px;border:1px solid rgba(245,158,11,.4);color:#fcd34d;background:rgba(245,158,11,.1)}
.pp-st.ok{border-color:rgba(52,211,153,.4);color:#6ee7b7;background:rgba(52,211,153,.1)}
.pp-num{position:absolute;top:10px;inset-inline-end:18px;font-family:var(--adm-num);font-size:2.6rem;font-weight:700;line-height:1;color:transparent;-webkit-text-stroke:1px rgba(255,255,255,.13);pointer-events:none}
.pp-sec .pp-st{margin-inline-end:66px}
/* ── שדות ── */
.pp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}
.pp-f{display:flex;flex-direction:column;gap:6px;min-width:0}
.pp-f.wide{grid-column:1/-1}
.pp-f>label{font-size:.74rem;font-weight:700;color:var(--g-sub);letter-spacing:.01em}
.pp-hint{font-size:.7rem;color:var(--g-dim);line-height:1.45}
.admin-page .pp .pp-in{width:100%;padding:11px 14px;border-radius:13px;border:1px solid rgba(255,255,255,.14);background:rgba(6,9,14,.55);color:#fff;font:500 .9rem var(--font);
  box-shadow:inset 0 1px 2px rgba(0,0,0,.35);transition:border-color .2s,box-shadow .2s,background .2s;outline:none}
.admin-page .pp .pp-in::placeholder{color:#7d8798;opacity:1}
.admin-page .pp .pp-in:hover{border-color:rgba(255,255,255,.24)}
.admin-page .pp .pp-in:focus{border-color:var(--g-acc);background:rgba(6,9,14,.72);box-shadow:0 0 0 4px rgba(255,157,46,.18),inset 0 1px 2px rgba(0,0,0,.35)}
.admin-page .pp textarea.pp-in{resize:vertical;line-height:1.55;min-height:96px}
.pp-in.ltr{direction:ltr;text-align:left;font-family:var(--adm-num),var(--font);letter-spacing:.02em}
/* ── כפתורים ── */
.pp-b{display:inline-flex;align-items:center;justify-content:center;gap:7px;font:700 .8rem var(--font);color:var(--g-txt);padding:9px 15px;border-radius:12px;cursor:pointer;
  background:linear-gradient(180deg,rgba(255,255,255,.14),rgba(255,255,255,.05));border:1px solid var(--g-line);box-shadow:inset 0 1px 0 var(--g-hi),0 6px 16px -8px rgba(0,0,0,.6);transition:transform .15s,background .2s,border-color .2s;white-space:nowrap}
.pp-b:hover{border-color:rgba(255,255,255,.32);background:linear-gradient(180deg,rgba(255,255,255,.2),rgba(255,255,255,.08))}
.pp-b:active{transform:scale(.97)}
.pp-b.acc{color:#1a1206;background:linear-gradient(180deg,#ffc173,#ff9d2e);border-color:rgba(255,200,140,.8);box-shadow:inset 0 1px 0 rgba(255,255,255,.55),0 8px 22px -8px rgba(255,157,46,.8)}
.pp-b.acc:hover{background:linear-gradient(180deg,#ffcd8a,#ffa94a)}
.pp-b.del:hover{border-color:rgba(251,113,133,.6);color:#fecdd3}
.pp-b.sm{padding:6px 10px;font-size:.72rem;border-radius:10px}
.pp-b input{display:none}
.admin-page .pp label.pp-b,.admin-page .pp label.pp-add{margin:0;font-weight:700}
.admin-page .pp label.pp-b{color:var(--g-txt)}.admin-page .pp label.pp-b.acc{color:#1a1206}
.pp-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
/* ── מחירים ── */
.pp-trim{position:relative}
.pp-trim .pp-in{padding-inline-end:34px;font-family:var(--adm-num),var(--font);font-size:1.05rem;font-weight:600;direction:ltr;text-align:right}
.pp-trim::after{content:'₪';position:absolute;inset-inline-end:14px;bottom:12px;color:var(--g-dim);font-weight:700;pointer-events:none}
#p-price-parse{font-size:.76rem;color:var(--g-sub);flex:1;min-width:200px;line-height:1.5}
/* ── גלריה ── */
.pp-photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:10px}
.pp-ph{position:relative;aspect-ratio:4/3;border-radius:16px;overflow:hidden;background:#0b0f15;border:1px solid var(--g-line);transition:transform .25s cubic-bezier(.2,.8,.2,1),box-shadow .25s}
.pp-ph:hover{transform:translateY(-3px);box-shadow:0 14px 30px -12px rgba(0,0,0,.9)}
.pp-ph>button.pp-ph-img{all:unset;position:absolute;inset:0;cursor:pointer}
.pp-ph img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .5s}
.pp-ph:hover img{transform:scale(1.05)}
.pp-ph.is-main{border-color:rgba(255,157,46,.9);box-shadow:0 0 0 2px rgba(255,157,46,.35),0 12px 30px -10px rgba(255,157,46,.45)}
.pp-badge{position:absolute;top:8px;inset-inline-start:8px;font-size:.66rem;font-weight:800;color:#1a1206;background:linear-gradient(180deg,#ffd29b,#ff9d2e);padding:3px 9px;border-radius:999px;box-shadow:0 4px 12px rgba(0,0,0,.4)}
.pp-ph-act{position:absolute;inset-inline:6px;bottom:6px;display:flex;gap:4px;justify-content:center;padding:4px;border-radius:12px;background:rgba(10,13,19,.55);-webkit-backdrop-filter:blur(14px) saturate(160%);backdrop-filter:blur(14px) saturate(160%);border:1px solid rgba(255,255,255,.14);
  opacity:0;transform:translateY(6px);transition:opacity .2s,transform .2s}
.pp-ph:hover .pp-ph-act,.pp-ph:focus-within .pp-ph-act{opacity:1;transform:none}
@media (hover:none){.pp-ph-act{opacity:1;transform:none}}
.pp-ph-act button{all:unset;flex:1;text-align:center;cursor:pointer;font-size:.82rem;padding:5px 0;border-radius:8px;color:#fff;transition:background .15s}
.pp-ph-act button:hover{background:rgba(255,255,255,.16)}
.pp-ph-act button.del:hover{background:rgba(251,113,133,.3)}
.pp-add{aspect-ratio:4/3;border-radius:16px;border:1.5px dashed rgba(255,255,255,.25);display:grid;place-content:center;gap:4px;text-align:center;color:var(--g-sub);font-size:.76rem;font-weight:700;cursor:pointer;transition:border-color .2s,background .2s,color .2s}
.pp-add:hover{border-color:var(--g-acc);color:#fff;background:rgba(255,157,46,.08)}
.pp-add b{font-size:1.6rem;font-weight:300;line-height:1}
.pp-add input{display:none}
.pp-empty{padding:18px;border-radius:16px;text-align:center;color:var(--g-dim);font-size:.8rem;border:1px dashed var(--g-line)}
/* ── סטודיו (ללא רקע) ── */
.pp-studio-w{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:16px;align-items:center}
.pp-studio{position:relative;aspect-ratio:16/9;border-radius:20px;overflow:hidden;display:grid;place-items:center;
  background:radial-gradient(70% 60% at 50% 35%,#3a4352,#161b23 70%,#0b0e13);border:1px solid var(--g-line);box-shadow:inset 0 1px 0 var(--g-hi)}
.pp-studio::before{content:'';position:absolute;inset-inline:8%;bottom:12%;height:16%;border-radius:50%;background:radial-gradient(50% 50% at 50% 50%,rgba(0,0,0,.75),transparent 70%);filter:blur(6px)}
.pp-studio::after{content:'';position:absolute;inset:auto 0 0;height:30%;background:linear-gradient(180deg,transparent,rgba(255,255,255,.04));border-top:1px solid rgba(255,255,255,.05)}
.pp-studio img{position:relative;z-index:1;max-width:86%;max-height:78%;object-fit:contain;filter:drop-shadow(0 14px 18px rgba(0,0,0,.55))}
.pp-studio span{position:relative;z-index:1;color:var(--g-dim);font-size:.8rem;text-align:center;line-height:1.6}
.pp-studio span b{display:block;font-size:2rem;opacity:.5}
.pp-acts{display:flex;flex-direction:column;gap:8px}
.pp-acts .pp-b{justify-content:flex-start}
/* ── צבעים ── */
.pp-colors{display:grid;grid-template-columns:repeat(auto-fill,minmax(172px,1fr));gap:10px}
.pp-col{border-radius:18px;padding:10px;background:rgba(255,255,255,.04);border:1px solid var(--g-line)}
.pp-col .pp-cn{margin:0 0 8px;font-size:.78rem;font-weight:700;color:var(--g-txt);display:flex;align-items:center;gap:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pp-col .pp-cn i{flex:none;width:10px;height:10px;border-radius:50%;background:var(--g-dim)}
.pp-col .pp-cn i.ok{background:var(--g-ok);box-shadow:0 0 8px var(--g-ok)}
.pp-col .pp-studio{aspect-ratio:16/10;border-radius:12px;margin-bottom:8px}
.pp-col .pp-studio span{font-size:.7rem}
/* ── ביקורת ── */
.pp-score{display:flex;align-items:center;gap:14px}
.pp-ring{--v:0;flex:none;width:64px;height:64px;border-radius:50%;display:grid;place-items:center;font-family:var(--adm-num);font-weight:700;font-size:1.3rem;color:#fff;
  background:conic-gradient(var(--g-acc) calc(var(--v)*36deg),rgba(255,255,255,.1) 0);-webkit-mask:radial-gradient(farthest-side,transparent 74%,#000 75%);mask:radial-gradient(farthest-side,transparent 74%,#000 75%)}
.pp-ring-w{position:relative;width:64px;height:64px;flex:none}
.pp-ring-w b{position:absolute;inset:0;display:grid;place-items:center;font-family:var(--adm-num);font-size:1.35rem;font-weight:700}
.pp-pc{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.pp-pc .pp-f.wide{grid-column:auto}
.pp-pc .pp-f:first-child .pp-in{border-color:rgba(52,211,153,.35)}
.pp-pc .pp-f:last-child .pp-in{border-color:rgba(251,113,133,.35)}
/* ── אבזור ── */
.pp-hl{display:flex;align-items:center;gap:12px;padding:9px;border-radius:16px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)}
.pp-hl+.pp-hl{margin-top:8px}
.pp-hl-img{flex:none;width:84px;height:56px;border-radius:11px;overflow:hidden;background:rgba(0,0,0,.35);display:grid;place-items:center;color:var(--g-dim);font-size:.64rem;border:1px solid var(--g-line)}
.pp-hl-img img{width:100%;height:100%;object-fit:cover}
.pp-hl-t{flex:1;font-size:.84rem;font-weight:600;line-height:1.4}
/* ── עגינת שמירה ── */
.pp-dock{position:relative;z-index:6;margin:16px 16px 12px;padding:10px 10px 10px 16px;border-radius:20px;display:flex;align-items:center;gap:12px}
#p-msg{flex:1;font-size:.8rem;color:var(--g-sub);min-height:1em;line-height:1.45}
#p-msg:empty::before{content:'השינויים נשמרים רק בלחיצה על שמור';color:var(--g-dim)}
.admin-page .pp #p-save{position:relative;overflow:hidden;border:0;cursor:pointer;font:800 .92rem var(--font);color:#1a1206;padding:12px 26px;border-radius:14px;
  background:linear-gradient(180deg,#ffc173,#ff9d2e);box-shadow:inset 0 1px 0 rgba(255,255,255,.6),0 10px 26px -8px rgba(255,157,46,.85)}
.admin-page .pp #p-save::after{content:'';position:absolute;top:0;bottom:0;width:40%;left:-60%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent);transform:skewX(-20deg);animation:ppShine 3.6s ease-in-out infinite}
.admin-page .pp #p-save:disabled{filter:saturate(.4) brightness(.8);cursor:wait}
@keyframes ppShine{0%,60%{left:-60%}100%{left:130%}}
/* ── כניסה ── */
.pp.is-in .pp-hero,.pp.is-in .pp-nav,.pp.is-in .pp-sec,.pp.is-in .pp-dock{animation:ppIn .6s cubic-bezier(.2,.8,.2,1) both}
.pp.is-in .pp-sec:nth-child(2){animation-delay:.05s}.pp.is-in .pp-sec:nth-child(3){animation-delay:.1s}.pp.is-in .pp-sec:nth-child(4){animation-delay:.15s}.pp.is-in .pp-sec:nth-child(n+5){animation-delay:.2s}
@keyframes ppIn{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.pp *,.pp *::before,.pp *::after{animation:none!important;transition:none!important}}
@media (max-width:720px){
  .admin-page .pp{border-radius:22px}
  .pp-hero{grid-template-columns:1fr auto;padding:16px 14px 14px;gap:10px 12px}
  .pp-hero .pp-gauge{order:1;justify-self:start}.pp-hero .pp-x{order:2}.pp-hero>div:nth-child(2){order:3;grid-column:1/-1}
  .pp-sec{padding-top:18px}.pp-sh{padding-inline-end:70px}.pp-sh .pp-st{position:absolute;top:14px;inset-inline-end:14px;margin:0}
  .pp-thumb{display:none}
  .pp-body{padding:0 10px}.pp-nav{margin:0 10px 12px}.pp-dock{margin:14px 10px 10px}
  .pp-sec{padding:16px 14px}
  .pp-studio-w,.pp-pc{grid-template-columns:1fr}
  .pp-num{display:none}.pp-sec .pp-st{margin-inline-end:0}
}`;
  function ppEnsureCss() {
    if (document.getElementById('pp-css')) return;
    const st = document.createElement('style'); st.id = 'pp-css'; st.textContent = PP_CSS; document.head.appendChild(st);
  }
  const PP_IC = {
    id: '<path d="M4 6h16v12H4z"/><circle cx="9" cy="11" r="2"/><path d="M6.5 15.5c.6-1.3 1.5-2 2.5-2s1.9.7 2.5 2M14 10h4M14 13h3"/>',
    price: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.4"/>',
    photos: '<rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-8 8"/>',
    cut: '<circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><path d="M8.2 7.6 20 18M8.2 16.4 20 6"/>',
    color: '<path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11z"/><path d="M9.5 14.5a2.6 2.6 0 0 0 2.5 2.6"/>',
    review: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    eq: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
  };
  const ppSvg = function (k) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + PP_IC[k] + '</svg>'; };
  function renderPersonal(msg) {
    const host = pHost(); if (!host || !pState) return;
    ppEnsureCss();
    const s = pState, f = s.f;
    const first = !s._shown; s._shown = true;
    const keepY = window.scrollY;
    // ── מצב השלמה (מה עוד חסר) ──
    const hasColorsDone = !s.colors.length || s.colors.every(function (n) { return s.colorImages[n]; });
    const hlDone = !s.highlights.length || s.highlights.every(function (h) { return h.image; });
    const pricesDone = s.trims.length ? s.trims.every(function (t) { return t.price != null; }) : !isBlank(f.price);
    const reviewDone = !isBlank(f.score) && !isBlank(f.description) && !isBlank(f.pros) && !isBlank(f.cons);
    const checks = [!!s.main, !!s.cutout, pricesDone, !isBlank(f.score), !isBlank(f.description), !isBlank(f.pros) && !isBlank(f.cons), !isBlank(f.youtube_video_url)];
    if (s.colors.length) checks.push(hasColorsDone);
    if (s.highlights.length) checks.push(hlDone);
    const pct = Math.round(checks.filter(Boolean).length / checks.length * 100);
    // ── עזרי בנייה ──
    let secN = 0;
    const st = function (ok, okTxt, noTxt) { return '<span class="pp-st' + (ok ? ' ok' : '') + '">' + (ok ? '✓ ' + (okTxt || 'מוכן') : (noTxt || 'חסר')) + '</span>'; };
    const sec = function (id, ic, title, sub, ok, body, okTxt, noTxt) {
      secN++;
      return '<div class="pp-sec pp-glass" id="pp-s-' + id + '">' +
        '<span class="pp-num">' + (secN < 10 ? '0' : '') + secN + '</span>' +
        '<div class="pp-sh"><span class="pp-ic">' + ppSvg(ic) + '</span><div><div class="pp-h">' + title + '</div>' + (sub ? '<div class="pp-p">' + sub + '</div>' : '') + '</div>' + (ok == null ? '' : st(ok, okTxt, noTxt)) + '</div>' + body + '</div>';
    };
    const fld = function (p, extra) {
      const v = f[p.key];
      const val = v === null || v === undefined ? '' : (Array.isArray(v) ? v.join('\n') : String(v));
      const area = p.type === 'textarea' || p.type === 'list';
      const input = area
        ? '<textarea id="p-f-' + p.key + '" class="pp-in" rows="' + (p.type === 'list' ? 5 : 4) + '"' + (extra || '') + '>' + escapeHtml(val) + '</textarea>'
        : '<input id="p-f-' + p.key + '" class="pp-in' + (p.key === 'youtube_video_url' ? ' ltr' : '') + '" type="' + (p.type === 'float' ? 'number' : 'text') + '"' +
          (p.type === 'float' ? ' step="0.1" min="0" max="10"' : p.type === 'number' ? ' inputmode="numeric" placeholder="למשל 189,990"' : p.key === 'youtube_video_url' ? ' dir="ltr" placeholder="https://youtu.be/…"' : '') +
          ' value="' + escapeAttr(p.type === 'number' && val ? Number(val).toLocaleString('en-US') : val) + '"' + (extra || '') + '>';
      return '<div class="pp-f' + (area ? ' wide' : '') + '"><label for="p-f-' + p.key + '">' + escapeAttr(p.label) + '</label>' + input + (p.hint ? '<div class="pp-hint">' + escapeAttr(p.hint) + '</div>' : '') + '</div>';
    };
    const P = {}; P_TEXT.forEach(function (p) { P[p.key] = p; });
    const studio = function (u, empty) { return '<div class="pp-studio">' + (u ? '<img src="' + escapeAttr(u) + '" alt="">' : '<span>' + empty + '</span>') + '</div>'; };
    // ── מקטעים ──
    const out = [];
    const nav = [];
    if (s.ident) {
      nav.push(['id', 'זיהוי', !!(s.ident.brand && s.ident.model && s.ident.year)]);
      out.push(sec('id', 'id', 'זיהוי הרכב', 'בדוק במיוחד את שנת הדגם — היא קובעת את הכתובת בעמוד', null,
        '<div class="pp-grid">' + [['brand', 'יצרן', 'text', 1], ['model', 'דגם', 'text', 0], ['year', 'שנת דגם', 'number', 1], ['slug', 'כתובת בעמוד (slug)', 'text', 1]].map(function (x) {
          return '<div class="pp-f"><label for="p-id-' + x[0] + '">' + x[1] + '</label><input id="p-id-' + x[0] + '" class="pp-in' + (x[3] ? ' ltr' : '') + '" type="' + x[2] + '" dir="' + (x[3] ? 'ltr' : 'auto') + '" value="' + escapeAttr(s.ident[x[0]]) + '" oninput="pIdentInput(\'' + x[0] + '\')"></div>';
        }).join('') + '</div><div class="pp-hint" style="margin-top:10px;">הכתובת מתעדכנת לבד לפי יצרן-דגם-שנה, כל עוד לא שינית אותה ידנית.</div>'));
    }
    nav.push(['price', 'מחירים', pricesDone]);
    out.push(sec('price', 'price', s.trims.length ? 'מחיר לכל רמת גימור' : 'מחיר', s.trims.length ? 'הדבק את המחירון כמו שקיבלת אותו — אשבץ כל מחיר לרמה שלו. או מלא ידנית.' : 'ריק = "מחיר טרם פורסם"', pricesDone,
      (s.trims.length
        ? '<div id="p-prices"><textarea id="p-price-text" class="pp-in" rows="4" placeholder="הדבק כאן את המחירון, למשל:&#10;' + escapeAttr(s.trims.map(function (t, i) { return t.name + ' – ' + (189990 + i * 15000).toLocaleString('en-US') + ' ₪'; }).join('\n')).replace(/\n/g, '&#10;') + '"></textarea>' +
          '<div class="pp-row" style="margin:10px 0 16px;align-items:flex-start;"><button type="button" class="pp-b acc" onclick="pParsePrices()">✦ פענח ושבץ לפי רמות</button><div id="p-price-parse"></div></div>' +
          '<div class="pp-grid">' + s.trims.map(function (t, i) {
            return '<div class="pp-f"><label for="p-tp-' + i + '" dir="auto">' + escapeHtml(t.name) + '</label><div class="pp-trim"><input id="p-tp-' + i + '" class="pp-in" type="text" inputmode="numeric" placeholder="—" oninput="pTrimPriceInput()" value="' + (t.price != null ? Number(t.price).toLocaleString('en-US') : '') + '"></div></div>';
          }).join('') + '</div><div class="pp-hint" style="margin-top:10px;">מחיר הבסיס ("החל מ-") ומחיר הרמה העליונה מתעדכנים לבד מהזול והיקר.</div></div>'
        : '<div class="pp-grid">' + fld(P.price) + fld(P.price_top) + '</div>'),
      'מתומחר', 'אין מחיר'));
    nav.push(['photos', 'גלריה', !!s.main]);
    out.push(sec('photos', 'photos', 'גלריה', 'לחיצה על תמונה קובעת אותה כראשית · ✂️ מסיר לה את הרקע', !!s.main,
      '<div class="pp-photos">' + s.photos.map(function (u, i) {
        const on = u === s.main;
        return '<div class="pp-ph' + (on ? ' is-main' : '') + '"><button type="button" class="pp-ph-img" onclick="pSetMain(' + i + ')" title="קבע כתמונה ראשית"><img src="' + escapeAttr(u) + '" alt="" loading="lazy"></button>' +
          (on ? '<span class="pp-badge">★ ראשית</span>' : '') +
          '<div class="pp-ph-act">' + (on ? '' : '<button type="button" title="קבע כראשית" onclick="pSetMain(' + i + ')">★</button>') +
          '<button type="button" title="הסר רקע מהתמונה הזו" onclick="pCutoutFromPhoto(' + i + ')">✂️</button>' +
          '<button type="button" class="del" title="הסר מהגלריה" onclick="pRemovePhoto(' + i + ')">✕</button></div></div>';
      }).join('') +
      '<label class="pp-add"><input type="file" accept="image/*" multiple onchange="pAddPhotos(this)"><b>+</b>הוסף תמונות</label></div>',
      s.photos.length + ' תמונות', 'אין תמונה ראשית'));
    nav.push(['cut', 'ללא רקע', !!s.cutout]);
    out.push(sec('cut', 'cut', 'הרכב על הבמה', 'התמונה ללא רקע שעומדת במרכז עמוד הדגם', !!s.cutout,
      '<div class="pp-studio-w">' + studio(s.cutout, '<b>✂️</b>עוד אין תמונה ללא רקע') +
      '<div class="pp-acts">' +
        '<button type="button" class="pp-b acc" onclick="pCutoutOpenTool()" title="נפתח הכלי ובוחרים בו את התמונה המקורית ברזולוציה מלאה">✂️ הסר רקע מקובץ במחשב</button>' +
        (s.main ? '<button type="button" class="pp-b" onclick="pCutoutFromMain()">✂️ הסר רקע מהתמונה הראשית</button>' : '') +
        '<label class="pp-b"><input type="file" accept="image/*" onchange="pUploadReadyCutout(this)">⬆️ העלה PNG שקוף מוכן</label>' +
        (s.cutout ? '<button type="button" class="pp-b del" onclick="pRemoveCutout()">✕ הסר</button>' : '') +
        '<div class="pp-hint">הכלי נפתח בחלון נפרד ורץ במחשב שלך. בפעם הראשונה המודל יורד (כ-94MB) ואחר כך נשמר בדפדפן.</div>' +
      '</div></div>'));
    if (s.colors.length) {
      const nDone = s.colors.filter(function (n) { return s.colorImages[n]; }).length;
      nav.push(['colors', 'צבעים', hasColorsDone]);
      out.push(sec('colors', 'color', 'רכב בכל צבע', 'בעמוד "אבזור" לחיצה על צבע מחליפה את הרכב במרכז. צבע בלי תמונה מוצג רק כעיגול.', hasColorsDone,
        '<div class="pp-colors">' + s.colors.map(function (n, i) {
          const u = s.colorImages[n];
          return '<div class="pp-col"><div class="pp-cn" dir="auto"><i' + (u ? ' class="ok"' : '') + '></i>' + escapeHtml(n) + '</div>' + studio(u, 'אין תמונה') +
            '<div class="pp-row"><button type="button" class="pp-b sm" onclick="pColorTool(' + i + ')">✂️ הסר רקע</button>' +
            '<label class="pp-b sm"><input type="file" accept="image/*" onchange="pColorUpload(this,' + i + ')">⬆️ PNG</label>' +
            (u ? '<button type="button" class="pp-b sm del" onclick="pColorRemove(' + i + ')">✕</button>' : '') + '</div></div>';
        }).join('') + '</div>', nDone + '/' + s.colors.length, nDone + '/' + s.colors.length));
    }
    nav.push(['review', 'ביקורת', reviewDone]);
    const sc = Math.max(0, Math.min(10, Number(f.score) || 0));
    out.push(sec('review', 'review', 'הביקורת של ספידומטר', 'הציון, התיאור, היתרונות והחסרונות שמופיעים בעמוד הדגם', reviewDone,
      '<div class="pp-grid" style="margin-bottom:12px;">' +
        '<div class="pp-f"><label for="p-f-score">' + escapeAttr(P.score.label) + '</label><div class="pp-score"><div class="pp-ring-w"><div class="pp-ring" id="pp-ring" style="--v:' + sc + '"></div><b id="pp-ring-n">' + (f.score != null ? f.score : '–') + '</b></div>' +
          '<input id="p-f-score" class="pp-in" type="number" step="0.1" min="0" max="10" value="' + escapeAttr(f.score != null ? f.score : '') + '" oninput="ppScore(this)" placeholder="0-10"></div><div class="pp-hint">' + escapeAttr(P.score.hint) + '</div></div>' +
        fld(P.youtube_video_url) +
      '</div>' + '<div style="display:grid;gap:12px;">' + fld(P.description) + '<div class="pp-pc">' + fld(P.pros) + fld(P.cons) + '</div></div>',
      'מלא', 'חסר'));
    if (s.highlights.length) {
      const nImg = s.highlights.filter(function (h) { return h.image; }).length;
      nav.push(['eq', 'אבזור', hlDone]);
      out.push(sec('eq', 'eq', 'אבזור בולט', 'תמונה לכל פריט — מופיעה בעמוד "אבזור"', hlDone,
        s.highlights.map(function (h, i) {
          return '<div class="pp-hl"><div class="pp-hl-img">' + (h.image ? '<img src="' + escapeAttr(h.image) + '" alt="">' : 'אין תמונה') + '</div>' +
            '<div class="pp-hl-t">' + escapeHtml(h.title) + '</div>' +
            '<label class="pp-b sm"><input type="file" accept="image/*" onchange="pHighlightImage(this,' + i + ')">' + (h.image ? '↻ החלף' : '⬆️ תמונה') + '</label>' +
            (h.image ? '<button type="button" class="pp-b sm del" onclick="pHighlightImageRemove(' + i + ')">✕</button>' : '') + '</div>';
        }).join(''), nImg + '/' + s.highlights.length, nImg + '/' + s.highlights.length));
    }
    // ── כותרת: שם הרכב + מד מוכנות ──
    const nm = s.ident || (_allCarsCache || []).filter(function (c) { return c.id === s.id; })[0] || (_draftsCache[s.id] && _draftsCache[s.id].extracted_data) || {};
    const ang = -90 + pct * 1.8;
    const arcLen = 157.08; // חצי היקף של רדיוס 50
    const ticks = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (i) { const a = Math.PI * (1 - i / 10), r1 = 58, r2 = i % 5 ? 62 : 65; return '<line class="tick" x1="' + (60 + r1 * Math.cos(a)).toFixed(1) + '" y1="' + (62 - r1 * Math.sin(a)).toFixed(1) + '" x2="' + (60 + r2 * Math.cos(a)).toFixed(1) + '" y2="' + (62 - r2 * Math.sin(a)).toFixed(1) + '"/>'; }).join('');
    const gauge = '<div class="pp-gauge" title="כמה מהפרטים האישיים מולאו"><svg viewBox="0 0 120 70"><defs><linearGradient id="ppGrad" x1="0" x2="1"><stop offset="0" stop-color="#fb7185"/><stop offset=".5" stop-color="#ff9d2e"/><stop offset="1" stop-color="#34d399"/></linearGradient></defs>' +
      ticks + '<path class="trk" d="M10 62a50 50 0 0 1 100 0"/><path class="val" d="M10 62a50 50 0 0 1 100 0" stroke-dasharray="' + arcLen + '" stroke-dashoffset="' + (first ? arcLen : (arcLen * (1 - pct / 100)).toFixed(1)) + '" data-off="' + (arcLen * (1 - pct / 100)).toFixed(1) + '"/>' +
      '<g class="ndl" style="transform:rotate(' + (first ? -90 : ang) + 'deg)" data-ang="' + ang + '"><line x1="60" y1="62" x2="60" y2="22"/></g><circle class="hub" cx="60" cy="62" r="4"/></svg>' +
      '<div class="pp-gauge-n">' + pct + '%<small>מוכנות</small></div></div>';
    const amb = s.main ? '<div class="pp-amb" style="background-image:url(\'' + escapeAttr(s.main).replace(/'/g, '%27') + '\')"></div>' : '<div class="pp-amb is-aurora"></div>';
    host.innerHTML = '<div class="pp' + (first ? ' is-in' : '') + '" id="pp-root">' + amb + '<div class="pp-grain"></div>' +
      '<div class="pp-hero">' +
        (s.main ? '<div class="pp-thumb"><img src="' + escapeAttr(s.main) + '" alt=""></div>' : '<div></div>') +
        '<div><div class="pp-kind' + (s.kind === 'draft' ? '' : ' is-live') + '"><i></i>' + (s.kind === 'draft' ? 'טיוטה · לפני פרסום' : 'מפורסם באתר') + '</div>' +
          '<div class="pp-title" dir="auto"><span>' + escapeHtml(nm.brand || '') + '</span> <b>' + escapeHtml(nm.model || 'רכב') + '</b>' + (nm.year ? '<em>' + escapeHtml(String(nm.year)) + '</em>' : '') + '</div>' +
          '<div class="pp-tag">✨ פרטים אישיים — כל מה שלא מגיע מגיליון המפרט</div></div>' +
        gauge + '<button type="button" class="pp-x" title="סגור" onclick="togglePersonalPanel(\'' + s.kind + '\',' + s.id + ')">✕</button></div>' +
      '<div class="pp-ph-spc" id="pp-nav-spc"></div><div class="pp-nav pp-glass" role="tablist">' + nav.map(function (n, i) { return '<button type="button" data-pp-go="' + n[0] + '"' + (i === 0 ? ' class="on"' : '') + '><i' + (n[2] ? ' class="ok"' : '') + '></i>' + n[1] + '</button>'; }).join('') + '</div>' +
      '<div class="pp-body">' + out.join('') + '</div>' +
      '<div class="pp-ph-spc" id="pp-dock-spc"></div><div class="pp-dock pp-glass"><span id="p-msg">' + (msg || '') + '</span><button type="button" id="p-save" onclick="savePersonal()">💾 שמור</button></div>' +
      '</div>';
    if (!first && Math.abs(window.scrollY - keepY) > 2) window.scrollTo(0, keepY);
    ppWire(host, first);
  }
  let ppIO = null;
  // ── אינטראקציות: הברקה שעוקבת אחרי העכבר, ניווט מקטעים, מד שמתמלא ──
  function ppWire(host, first) {
    const root = host.querySelector('.pp'); if (!root) return;
    root.addEventListener('pointermove', function (e) {
      const g = e.target.closest && e.target.closest('.pp-glass'); if (!g) return;
      const r = g.getBoundingClientRect();
      g.style.setProperty('--mx', (e.clientX - r.left) + 'px'); g.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
    const nav = root.querySelector('.pp-nav');
    nav.addEventListener('click', function (e) {
      const b = e.target.closest('[data-pp-go]'); if (!b) return;
      const t = document.getElementById('pp-s-' + b.getAttribute('data-pp-go'));
      if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    if ('IntersectionObserver' in window) {
      if (ppIO) ppIO.disconnect();
      const io = new IntersectionObserver(function (ents) {
        ents.forEach(function (en) {
          if (!en.isIntersecting) return;
          const id = en.target.id.replace('pp-s-', '');
          nav.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-pp-go') === id); });
          const on = nav.querySelector('button.on'); if (on && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: on.offsetLeft - nav.clientWidth / 2 + on.offsetWidth / 2, behavior: 'smooth' });
        });
      }, { rootMargin: '-30% 0px -60% 0px' });
      root.querySelectorAll('.pp-sec').forEach(function (s) { io.observe(s); });
      ppIO = io;
    }
    ppFloat();
    if (first) requestAnimationFrame(function () { requestAnimationFrame(function () {
      const v = root.querySelector('.pp-gauge .val'), n = root.querySelector('.pp-gauge .ndl');
      if (v) v.style.strokeDashoffset = v.getAttribute('data-off');
      if (n) n.style.transform = 'rotate(' + n.getAttribute('data-ang') + 'deg)';
    }); });
  }
  // ניווט ושמירה צפים כשהפאנל ארוך מהמסך (ב-CSS של האתר יש overflow על body, אז position:sticky לא עובד שם)
  let ppRaf = 0;
  function ppFloat() {
    ppRaf = 0;
    const root = document.getElementById('pp-root'); if (!root) return;
    const nav = root.querySelector('.pp-nav'), dock = root.querySelector('.pp-dock');
    const ns = document.getElementById('pp-nav-spc'), ds = document.getElementById('pp-dock-spc');
    const r = root.getBoundingClientRect(), vh = window.innerHeight, side = window.innerWidth <= 720 ? 10 : 16;
    const place = function (el, on) { el.classList.toggle('is-float', on); el.style.left = on ? (r.left + side) + 'px' : ''; el.style.width = on ? (r.width - side * 2) + 'px' : ''; };
    // ניווט: צף מרגע שראש הניווט עובר את ראש המסך ועד שסוף הפאנל מתקרב
    const navTop = (ns.classList.contains('on') ? ns : nav).getBoundingClientRect().top;
    const navOn = navTop < 10 && r.bottom > 220;
    if (navOn !== nav.classList.contains('is-float')) { ns.style.height = nav.offsetHeight + 'px'; ns.style.margin = '0 16px 14px'; ns.classList.toggle('on', navOn); }
    place(nav, navOn);
    // שמירה: צפה בתחתית כל עוד המקום הטבעי שלה מתחת למסך והפאנל עצמו על המסך
    const dockTop = (ds.classList.contains('on') ? ds : dock).getBoundingClientRect().top;
    const dockOn = dockTop + dock.offsetHeight > vh - 12 && r.top < vh - 160;
    if (dockOn !== dock.classList.contains('is-float')) { ds.style.height = dock.offsetHeight + 'px'; ds.style.margin = '16px 16px 12px'; ds.classList.toggle('on', dockOn); }
    place(dock, dockOn);
  }
  const ppSched = function () { if (!ppRaf) ppRaf = requestAnimationFrame(ppFloat); };
  window.addEventListener('scroll', ppSched, { passive: true });
  window.addEventListener('resize', ppSched);
  window.ppScore = function (el) {
    const v = parseFloat(el.value), ok = !isNaN(v);
    const r = document.getElementById('pp-ring'), n = document.getElementById('pp-ring-n');
    if (r) r.style.setProperty('--v', ok ? Math.max(0, Math.min(10, v)) : 0);
    if (n) n.textContent = ok ? v : '–';
  };
  function pMsg(t) { const el = document.getElementById('p-msg'); if (el) el.innerHTML = t; }
  window.pSetMain = function (i) { if (!pState) return; pReadInputs(); pState.main = pState.photos[i]; renderPersonal('לא לשכוח לשמור'); };
  window.pRemovePhoto = function (i) {
    if (!pState) return; pReadInputs();
    const r = pState.photos.splice(i, 1)[0];
    if (pState.main === r) pState.main = pState.photos[0] || null;
    renderPersonal('לא לשכוח לשמור');
  };
  window.pAddPhotos = async function (input) {
    const files = input.files ? Array.from(input.files) : []; if (!files.length || !pState) return;
    pReadInputs(); pMsg('מעלה ' + files.length + ' תמונות…');
    for (const file of files) { const u = await uploadCarPhoto(file); if (u) { pState.photos.push(u); if (!pState.main) pState.main = u; } }
    input.value = ''; renderPersonal('התמונות עלו — לא לשכוח לשמור');
  };
  async function uploadCutoutBlob(blob) {
    const client = initCarsClient(); if (!client) throw new Error('אין חיבור לשרת');
    const type = blob.type === 'image/webp' ? 'image/webp' : 'image/png';
    const path = 'cutouts/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + (type === 'image/png' ? '.png' : '.webp');
    const { error } = await client.storage.from(PHOTOS_BUCKET).upload(path, blob, { contentType: type, upsert: false });
    if (error) throw new Error(error.message);
    const { data } = client.storage.from(PHOTOS_BUCKET).getPublicUrl(path);
    return data && data.publicUrl ? data.publicUrl : null;
  }
  // תמונה שקופה גדולה (למשל PNG של 8MB ממקור אחר) — מקטינים בדפדפן ושומרים על השקיפות, במקום לחסום
  const CUT_MAX_BYTES = 4.5 * 1024 * 1024, CUT_MAX_SIDE = 2400;
  async function shrinkCutout(file) {
    if (file.size <= CUT_MAX_BYTES) return file;
    const bmp = await createImageBitmap(file);
    let side = Math.min(CUT_MAX_SIDE, Math.max(bmp.width, bmp.height)), out = null;
    for (let round = 0; round < 4; round++, side = Math.round(side * 0.8)) {
      const k = side / Math.max(bmp.width, bmp.height);
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, c.width, c.height);
      const enc = function (t, q) { return new Promise(function (r) { c.toBlob(r, t, q); }); };
      out = await enc('image/png');
      for (const q of [0.95, 0.9]) { if (out && out.size <= CUT_MAX_BYTES) break; const w = await enc('image/webp', q); if (w && w.type === 'image/webp') out = w; }
      if (out && out.size <= CUT_MAX_BYTES) return out;
    }
    throw new Error('לא הצלחתי להקטין את הקובץ מתחת ל-4.5MB');
  }
  // קובץ שהמנהל מעלה כ"תמונה ללא רקע": שקוף → מקטינים ומעלים; תמונה רגילה (JPG) → מציעים להסיר רקע בכלי
  let pendingCutout = null;
  async function cutoutFromUpload(file, runTool, showMsg) {
    if (!/^image\/(png|webp)$/.test(file.type)) {
      // תמונה רגילה: מציעים כפתור — החלון חייב להיפתח מלחיצה חדשה, לא אחרי בחירת קובץ (חסימת חלונות קופצים)
      pendingCutout = { file: file, runTool: runTool };
      showMsg('זו תמונה רגילה עם רקע. <button type="button" class="tbl-btn" style="border-color:var(--adm-accent,#ff9d2e);font-weight:700;" onclick="runPendingCutout()">✂️ הסר לה רקע בכלי</button>');
      return null;
    }
    return uploadCutoutBlob(await shrinkCutout(file));
  }
  window.runPendingCutout = function () { const p = pendingCutout; pendingCutout = null; if (p) p.runTool({ blob: p.file, name: p.file.name }); };
  // ── חיבור לכלי הסרת הרקע (חלון נפרד, cutout-tool.html) ──
  let cutoutReq = null;
  function openCutoutTool(src) {
    return new Promise(function (resolve, reject) {
      if (cutoutReq) cutoutReq.reject(new Error('בוטל — נפתחה בקשה חדשה'));
      const win = window.open('/cutout-tool.html', 'sp-cutout', 'width=1320,height=900');
      if (!win) { reject(new Error('הדפדפן חסם את החלון. אפשר חלונות קופצים לאתר ונסה שוב.')); return; }
      cutoutReq = { reqId: 'c' + Date.now(), src: src, resolve: resolve, reject: reject, win: win };
    });
  }
  window.addEventListener('message', function (ev) {
    if (ev.origin !== location.origin || !ev.data || !cutoutReq) return;
    if (ev.data.type === 'sp-cutout-ready' && ev.source === cutoutReq.win) {
      const s = cutoutReq.src;
      ev.source.postMessage({ type: 'sp-cutout-src', reqId: cutoutReq.reqId, url: s.url || null, blob: s.blob || null, name: s.name || 'car', pick: !!s.pick }, location.origin);
    } else if (ev.data.type === 'sp-cutout-result' && ev.data.reqId === cutoutReq.reqId && ev.data.blob) {
      const r = cutoutReq; cutoutReq = null; r.resolve(ev.data.blob);
    }
  });
  async function pRunCutout(src, colorName) {
    if (!pState) return;
    pReadInputs();
    const st = pState;
    pMsg('✂️ כלי הסרת הרקע נפתח בחלון נפרד — סיים שם ולחץ "שמור כתמונה ללא רקע".');
    try {
      const blob = await openCutoutTool(src);
      if (pState !== st) return;
      pMsg('מעלה את התמונה ללא הרקע…');
      const url = await uploadCutoutBlob(blob);
      if (!url) throw new Error('ההעלאה לא החזירה כתובת');
      if (colorName) st.colorImages[colorName] = url; else st.cutout = url;
      renderPersonal('✓ ' + (colorName ? 'התמונה בצבע ' + escapeHtml(colorName) : 'התמונה ללא רקע') + ' עלתה — לחץ "שמור"');
    } catch (e) { pMsg('<span style="color:#e74c3c;">✕ ' + escapeAttr(e && e.message ? e.message : e) + '</span>'); }
  }
  window.pCutoutFromFile = function (input) { const f = input.files && input.files[0]; input.value = ''; if (f) pRunCutout({ blob: f, name: f.name }); };
  // פותח את הכלי מיד בלחיצה (אחרת הדפדפן חוסם את החלון) — בוחרים את התמונה בתוך הכלי עצמו
  window.pCutoutOpenTool = function () { pRunCutout({ pick: true }); };
  // תמונה ללא רקע לכל צבע (עמוד "אבזור": לחיצה על צבע מחליפה את הרכב במרכז)
  window.pColorTool = function (i) { if (pState && pState.colors[i]) pRunCutout({ pick: true }, pState.colors[i]); };
  window.pColorUpload = async function (input, i) {
    const file = input.files && input.files[0]; input.value = ''; if (!file || !pState || !pState.colors[i]) return;
    const name = pState.colors[i]; pReadInputs(); pMsg('מעלה…');
    try {
      const u = await cutoutFromUpload(file, function (src) { pRunCutout(src, name); }, pMsg);
      if (u) { pState.colorImages[name] = u; renderPersonal('✓ התמונה בצבע ' + escapeHtml(name) + ' עלתה — לחץ "שמור"'); }
    } catch (e) { pMsg('<span style="color:#e74c3c;">✕ ' + escapeAttr(e.message) + '</span>'); }
  };
  window.pColorRemove = function (i) { if (!pState || !pState.colors[i]) return; pReadInputs(); delete pState.colorImages[pState.colors[i]]; renderPersonal('לא לשכוח לשמור'); };
  // הסרת רקע מכל תמונה בגלריה (לא רק מהראשית) — אותו מסלול כמו מהתמונה הראשית
  window.pCutoutFromPhoto = function (i) { if (pState && pState.photos[i]) pRunCutout({ url: pState.photos[i], name: 'photo-' + (i + 1) }); };
  window.pCutoutFromMain = function () { if (pState && pState.main) pRunCutout({ url: pState.main, name: 'main' }); };
  window.pUploadReadyCutout = async function (input) {
    const file = input.files && input.files[0]; input.value = ''; if (!file || !pState) return;
    pReadInputs(); pMsg('מעלה…');
    try { const u = await cutoutFromUpload(file, pRunCutout, pMsg); if (u) { pState.cutout = u; renderPersonal('✓ עלה — לחץ "שמור"'); } } catch (e) { pMsg('<span style="color:#e74c3c;">✕ ' + escapeAttr(e.message) + '</span>'); }
  };
  window.pRemoveCutout = function () { if (!pState) return; pReadInputs(); pState.cutout = null; renderPersonal('לא לשכוח לשמור'); };
  window.pHighlightImage = async function (input, i) {
    const file = input.files && input.files[0]; input.value = ''; if (!file || !pState) return;
    pReadInputs(); pMsg('מעלה תמונה…');
    const u = await uploadCarPhoto(file);
    if (u && pState.highlights[i]) pState.highlights[i].image = u;
    renderPersonal(u ? 'התמונה עלתה — לא לשכוח לשמור' : '<span style="color:#e74c3c;">ההעלאה נכשלה</span>');
  };
  window.pHighlightImageRemove = function (i) { if (!pState || !pState.highlights[i]) return; pReadInputs(); pState.highlights[i].image = null; renderPersonal('לא לשכוח לשמור'); };

  window.savePersonal = async function () {
    if (!pState) return;
    pReadInputs();
    const s = pState, client = initCarsClient(); if (!client) return;
    if (s.f.score != null && (s.f.score < 0 || s.f.score > 10)) { pMsg('<span style="color:#e74c3c;">הציון חייב להיות בין 0 ל-10</span>'); return; }
    const ci = {}; Object.keys(s.colorImages || {}).forEach(function (k) { if (s.colorImages[k] && (s.colors || []).indexOf(k) !== -1) ci[k] = s.colorImages[k]; });
    const patch = noZeroPrice(Object.assign({}, s.f, { image_main: s.main || null, image_cutout: s.cutout || null, highlights: s.highlights, color_images: ci }));
    if (s.trims.length) patch.trims = s.trims;
    const btn = document.getElementById('p-save'); if (btn) { btn.disabled = true; btn.textContent = 'שומר…'; }
    try {
      if (s.kind === 'car') {
        patch.gallery_images = s.photos.slice();
        const { error } = await client.from('cars').update(patch).eq('id', s.id);
        if (error) throw new Error(error.message);
        const c = (_allCarsCache || []).filter(function (x) { return x.id === s.id; })[0];
        if (c) Object.assign(c, patch);
        const chk = document.getElementById('car-check-' + s.id); if (c && chk) chk.innerHTML = personalChecklist(c, c.gallery_images, 'car');
      } else {
        const d = _draftsCache[s.id]; if (!d) throw new Error('הטיוטה לא נמצאה — רענן');
        if (s.ident) {
          const y = parseInt(s.ident.year, 10);
          if (s.ident.year && (isNaN(y) || y < 1990 || y > new Date().getFullYear() + 2)) throw new Error('שנת דגם לא תקינה: ' + s.ident.year);
          if (s.ident.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.ident.slug)) throw new Error('הכתובת (slug) יכולה להכיל רק אותיות אנגליות קטנות, ספרות ומקפים');
          patch.brand = s.ident.brand || null; patch.model = s.ident.model || null; patch.year = isNaN(y) ? null : y; patch.slug = s.ident.slug || null;
        }
        const ex = Object.assign({}, d.extracted_data || {}, patch);
        const photos = s.photos.slice();
        if (s.main) { photos.splice(photos.indexOf(s.main), 1); photos.unshift(s.main); } // הראשית ראשונה
        const upd = { extracted_data: ex, photo_urls: photos };
        // הוזן מחיר → ההערה "אין מחיר במסמך" כבר לא רלוונטית
        const vr = draftVerifications[s.id];
        if (vr && ex.price != null && (vr.warnings || []).some(function (w) { return w.field === 'price'; })) {
          const rep = JSON.parse(JSON.stringify(vr)); rep.warnings = rep.warnings.filter(function (w) { return w.field !== 'price'; });
          upd.verification_report = rep;
        }
        const { error } = await client.from('car_drafts').update(upd).eq('id', s.id);
        if (error) throw new Error(error.message);
        d.extracted_data = ex; d.photo_urls = photos;
        // שדות שמולאו כאן → ההערות עליהם כבר לא רלוונטיות (מחיר, שנה, יצרן, דגם, כתובת)
        const vr2 = draftVerifications[s.id];
        if (vr2) {
          const filled = ['price', 'year', 'brand', 'model', 'slug'].filter(function (k) { return ex[k] != null && ex[k] !== ''; });
          const has = function (x) { return filled.indexOf(x.field) !== -1; };
          if ((vr2.blockingIssues || []).some(has) || (vr2.warnings || []).some(has)) {
            const rep2 = JSON.parse(JSON.stringify(vr2));
            rep2.blockingIssues = (rep2.blockingIssues || []).filter(function (x) { return !has(x); });
            rep2.warnings = (rep2.warnings || []).filter(function (x) { return !has(x); });
            rep2.ok = rep2.blockingIssues.length === 0;
            upd.verification_report = rep2;
          }
        }
        if (upd.verification_report) {
          await client.from('car_drafts').update({ verification_report: upd.verification_report }).eq('id', s.id);
          draftVerifications[s.id] = upd.verification_report; d.verification_report = upd.verification_report; renderDraftVerifyResult(s.id);
        }
        const tEl = document.getElementById('draft-title-' + s.id); if (tEl && ex.brand) tEl.textContent = ex.brand + ' ' + (ex.model || '') + (ex.year ? ' ' + ex.year : '');
        const chk = document.getElementById('draft-check-' + s.id); if (chk) chk.innerHTML = personalChecklist(ex, photos, 'draft');
      }
      renderPersonal('<span style="color:#2ecc71;font-weight:700;">✓ נשמר</span>');
    } catch (e) {
      pMsg('<span style="color:#e74c3c;">✕ השמירה נכשלה: ' + escapeAttr(e && e.message ? e.message : e) + '</span>');
    } finally { const b = document.getElementById('p-save'); if (b) { b.disabled = false; b.textContent = '💾 שמור'; } }
  };

  // ═══════════ בעיות מהבדיקה מול המקור — מתקנים ישירות בשורת הטיוטה (05.11.2026) ═══════════
  // לכל בעיה: אמץ את ההצעה / הקלד ערך ושמור / התעלם. הכל נשמר ב-car_drafts (extracted_data + verification_report).
  function ensureIssueIds(r) {
    if (!r) return r;
    (r.blockingIssues || []).forEach(function (x, i) { if (!x.id) x.id = 'b' + i; });
    (r.warnings || []).forEach(function (x, i) { if (!x.id) x.id = 'w' + i; });
    return r;
  }
  function parseIssueField(field) {
    if (!field) return null;
    const m = String(field).match(/^trims\[(.+)\]\.(\w+)$/);
    if (m) { const def = TRIM_INPUTS.filter(function (f) { return f.key === m[2]; })[0]; return def ? { trim: m[1], key: m[2], def: def } : null; }
    const def = ALL_FIELDS.filter(function (f) { return f.key === field; })[0];
    return def ? { trim: null, key: field, def: def } : null;
  }
  function issueCurrentValue(ex, pf) {
    if (!ex || !pf) return undefined;
    if (pf.trim === null) return ex[pf.key];
    const t = (ex.trims || []).filter(function (x) { return x && x.name === pf.trim; })[0];
    return t ? t[pf.key] : undefined;
  }
  function parseByType(type, raw) {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).trim();
    if (s === '' || s === '(ריק)') return null;
    if (type === 'number') { const n = parseInt(s.replace(/[^\d-]/g, ''), 10); return isNaN(n) ? null : n; }
    if (type === 'float') { const n = parseFloat(s.replace(/,/g, '').replace(/[^\d.-]/g, '')); return isNaN(n) ? null : n; }
    if (type === 'list') return s.split(/\n|,\s*/).map(function (x) { return x.trim(); }).filter(Boolean);
    return s;
  }
  const showVal = function (v) { return v === null || v === undefined || v === '' ? '(ריק)' : Array.isArray(v) ? v.join(', ') : String(v); };
  function issueCardHtml(draftId, it, kind, ex, sugg) {
    const pf = parseIssueField(it.field);
    const cur = issueCurrentValue(ex, pf);
    const color = kind === 'b' ? '#e74c3c' : '#e6a23c';
    let fix = '';
    const dd = _draftsCache[draftId];
    if (it.field === 'price' && dd && !dd.published_car_id && ex && Array.isArray(ex.trims) && ex.trims.length) {
      fix = '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px;">' +
        '<button type="button" class="tbl-btn" style="border-color:var(--adm-accent,#ff9d2e);font-weight:700;" onclick="openPersonalPrices(' + draftId + ')">₪ הזן מחירים לפי רמת גימור (' + ex.trims.length + ')</button>' +
        '<button type="button" class="tbl-btn" onclick="fixDraftIssue(' + draftId + ',\'' + it.id + '\',\'dismiss\',this)" title="לפרסם בלי מחיר — יוצג &quot;מחיר טרם פורסם&quot;">אין מחיר עדיין</button></div>';
    } else if (pf) {
      const pre = sugg !== undefined ? (sugg === null ? '' : (Array.isArray(sugg) ? sugg.join('\n') : String(sugg))) : (cur === null || cur === undefined ? '' : (Array.isArray(cur) ? cur.join('\n') : String(cur)));
      const inputType = pf.def.type === 'number' || pf.def.type === 'float' ? 'number' : 'text';
      fix = '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px;">' +
        '<span style="font-size:0.72rem;color:var(--adm-muted);">עכשיו: <b>' + escapeHtml(showVal(cur)) + '</b></span>' +
        (sugg !== undefined ? '<button type="button" class="tbl-btn" style="border-color:#2ecc71;color:#2ecc71;" onclick="fixDraftIssue(' + draftId + ',\'' + it.id + '\',\'suggest\',this)">✓ אמץ: ' + escapeHtml(showVal(sugg)) + '</button>' : '') +
        (pf.def.type === 'list' || pf.def.type === 'textarea'
          ? '<textarea id="fix-' + draftId + '-' + it.id + '" rows="2" style="flex:1;min-width:180px;padding:6px 8px;border-radius:7px;border:1px solid var(--adm-border);background:var(--adm-surface-2);color:var(--adm-text);font-family:var(--font);font-size:0.8rem;">' + escapeHtml(pre) + '</textarea>'
          : '<input id="fix-' + draftId + '-' + it.id + '" type="' + inputType + '"' + (pf.def.type === 'float' ? ' step="any"' : '') + ' value="' + escapeAttr(pre) + '" aria-label="ערך מתוקן" style="width:150px;padding:6px 8px;border-radius:7px;border:1px solid var(--adm-border);background:var(--adm-surface-2);color:var(--adm-text);font-family:var(--font);font-size:0.8rem;">') +
        '<button type="button" class="tbl-btn" onclick="fixDraftIssue(' + draftId + ',\'' + it.id + '\',\'input\',this)">💾 שמור ערך</button>' +
        '<button type="button" class="tbl-btn" onclick="fixDraftIssue(' + draftId + ',\'' + it.id + '\',\'dismiss\',this)" title="הערך הנוכחי נכון — הסר את ההערה">התעלם</button>' +
      '</div>';
    } else {
      fix = '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px;">' +
        (it.field ? '<span style="font-size:0.72rem;color:var(--adm-muted);">תיקון של ' + escapeHtml(it.field === 'equipment' ? 'רשימת האבזור' : it.field === 'trims' ? 'רשימת הגרסאות' : it.field) + ' — בטופס העריכה</span>' : '') +
        '<button type="button" class="tbl-btn" onclick="fixDraftIssue(' + draftId + ',\'' + it.id + '\',\'dismiss\',this)">התעלם</button></div>';
    }
    const fieldName = pf ? (pf.trim ? 'גרסה ' + pf.trim + ' · ' : '') + String(pf.def.label || pf.key).replace(/\s*\*\s*$/, '').replace(/\s*\(.*?\)\s*$/, '') : (it.field === 'equipment' ? 'רשימת האבזור' : it.field === 'trims' ? 'רשימת הגרסאות' : '');
    return '<li style="list-style:none;border:1px solid var(--adm-border);border-inline-start:3px solid ' + color + ';border-radius:8px;padding:8px 10px;margin-top:6px;color:var(--adm-text,#eef2f6);">' +
      '<div style="font-size:0.8rem;line-height:1.5;color:var(--adm-text,#eef2f6);"><b style="color:' + color + ';">' + escapeHtml(it.category || '') + (fieldName ? ' — ' + escapeHtml(fieldName) : '') + '</b><br>' + escapeHtml(it.text || '') + '</div>' + fix + '</li>';
  }
  function renderDraftVerifyResult(draftId) {
    const resultEl = document.getElementById('draft-verify-' + draftId);
    const result = ensureIssueIds(draftVerifications[draftId]);
    if (!resultEl || !result) return;
    const d = _draftsCache[draftId], ex = d && d.extracted_data;
    const sug = result.fieldSuggestions || {};
    const blocking = result.blockingIssues || [], warns = result.warnings || [];
    const when = result.checkedAt ? ' <span style="font-weight:400;color:var(--adm-muted);">(' + new Date(result.checkedAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) + ')</span>' : '';
    let html = blocking.length
      ? '<div style="font-size:0.8rem;color:#e74c3c;margin-top:8px;font-weight:700;">✕ ' + blocking.length + ' בעיות לתיקון' + when + ' — אפשר לתקן כאן ישירות</div>'
      : '<div style="font-size:0.8rem;color:#2ecc71;margin-top:8px;font-weight:700;">✓ ' + (result.sourceChecked ? 'עברה בדיקה מול קובץ המקור' : 'אין בעיות פתוחות') + when + '</div>';
    if (blocking.length) html += '<ul style="margin:0;padding:0;">' + blocking.map(function (it) { return issueCardHtml(draftId, it, 'b', ex, it.field ? sug[it.field] : undefined); }).join('') + '</ul>';
    if (warns.length) html += '<details style="margin-top:6px;"' + (blocking.length ? '' : ' open') + '><summary style="font-size:0.76rem;color:var(--adm-muted);cursor:pointer;">הערות לא חוסמות (' + warns.length + ')</summary><ul style="margin:0;padding:0;">' +
      warns.map(function (it) { return issueCardHtml(draftId, it, 'w', ex, it.field ? sug[it.field] : undefined); }).join('') + '</ul></details>';
    resultEl.innerHTML = html;
  }
  window.fixDraftIssue = async function (draftId, issueId, mode, btn) {
    const client = initCarsClient(); if (!client) return;
    const d = _draftsCache[draftId], r = draftVerifications[draftId];
    if (!d || !r) return;
    const all = (r.blockingIssues || []).concat(r.warnings || []);
    const it = all.filter(function (x) { return x.id === issueId; })[0]; if (!it) return;
    const ex = JSON.parse(JSON.stringify(d.extracted_data || {}));
    let changed = false;
    if (mode !== 'dismiss') {
      const pf = parseIssueField(it.field); if (!pf) return;
      let val;
      if (mode === 'suggest') val = parseByType(pf.def.type, (r.fieldSuggestions || {})[it.field]);
      else { const el = document.getElementById('fix-' + draftId + '-' + issueId); val = parseByType(pf.def.type, el ? el.value : null); }
      if (pf.trim === null) ex[pf.key] = val;
      else {
        ex.trims = trimsToKgm(ex.trims);
        const t = (ex.trims || []).filter(function (x) { return x && x.name === pf.trim; })[0];
        if (!t) { alert('הגרסה "' + pf.trim + '" לא נמצאה בנתונים — תקן בטופס העריכה.'); return; }
        t[pf.key] = val;
        if (['torque', 'electric_nm', 'system_nm', 'boost_nm'].indexOf(pf.key) !== -1) t.tu = 'kgm';
        // הגרסה הבסיסית מזינה את ערכי הרכב הכלליים — מעדכנים גם אותם כשהם היו זהים
        if (ex.trims[0] === t && ex[pf.key] !== undefined && JSON.stringify(ex[pf.key]) === JSON.stringify(issueCurrentValue(d.extracted_data, pf))) ex[pf.key] = val;
      }
      changed = true;
    }
    const rep = JSON.parse(JSON.stringify(r));
    rep.blockingIssues = (rep.blockingIssues || []).filter(function (x) { return x.id !== issueId; });
    rep.warnings = (rep.warnings || []).filter(function (x) { return x.id !== issueId; });
    if (rep.fieldSuggestions && it.field && !all.some(function (x) { return x.id !== issueId && x.field === it.field; })) delete rep.fieldSuggestions[it.field];
    rep.ok = rep.blockingIssues.length === 0;
    (rep.resolved = rep.resolved || []).push({ id: issueId, field: it.field || null, how: mode, at: new Date().toISOString() });
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    const upd = { verification_report: rep }; if (changed) upd.extracted_data = ex;
    const { error } = await client.from('car_drafts').update(upd).eq('id', draftId);
    if (error) { alert('השמירה נכשלה: ' + error.message); if (btn) btn.disabled = false; return; }
    draftVerifications[draftId] = rep; d.verification_report = rep; if (changed) d.extracted_data = ex;
    renderDraftVerifyResult(draftId);
    const pub = document.getElementById('publish-btn-' + draftId); if (pub) pub.title = rep.ok ? '' : 'יש עדיין בעיות פתוחות';
  };

  // ═══════════ פרסום ישיר משורת הטיוטה — בלי לפתוח את טופס העריכה ═══════════
  function valuesFromDraft(d) {
    const ex = d.extracted_data || {};
    const values = {};
    ALL_FIELDS.forEach(function (f) {
      const v = ex[f.key];
      if (v === undefined || v === null || v === '') { values[f.key] = f.type === 'list' ? [] : null; return; }
      if (f.type === 'list') values[f.key] = Array.isArray(v) ? v : parseByType('list', v);
      else if (f.type === 'number' || f.type === 'float') values[f.key] = typeof v === 'number' ? (f.type === 'number' ? Math.round(v) : v) : parseByType(f.type, v);
      else values[f.key] = Array.isArray(v) ? v.join(', ') : String(v);
    });
    if (!values.slug && values.brand && values.model) values.slug = slugify(values.brand, values.model, values.year);
    ['colors', 'features', 'safety_features', 'pros', 'cons'].forEach(function (k) { if (!Array.isArray(values[k])) values[k] = []; });
    const photos = (d.photo_urls || []).slice();
    values.image_main = ex.image_main || photos[0] || null;
    values.gallery_images = photos;
    values.image_cutout = ex.image_cutout || null;
    values.color_images = ex.color_images && typeof ex.color_images === 'object' ? ex.color_images : {};
    values.torque = exTorqueKgm(ex);
    values.trims = trimsToKgm(ex.trims).filter(function (t) { return t && t.name; });
    const eq = ex.equipment || {};
    values.equipment = { base_name: eq.base_name || null, groups: Array.isArray(eq.groups) ? eq.groups : [], packages: Array.isArray(eq.packages) ? eq.packages : [] };
    values.highlights = (Array.isArray(ex.highlights) ? ex.highlights : []).map(function (h) { return typeof h === 'string' ? { title: h, image: null } : h; }).filter(function (h) { return h && h.title; }).slice(0, 6);
    return values;
  }
  // שמירה של רכב חדש מטיוטה — משותף לטופס העריכה ולפרסום הישיר
  // מחיר 0 = אין מחיר (אחרת נכנס לנתונים המובנים לגוגל כ"מחיר 0 ₪")
  function noZeroPrice(v) { ['price', 'price_top'].forEach(function (k) { if (v && (v[k] === 0 || v[k] === '0')) v[k] = null; }); return v; }
  async function insertCarFromDraft(values, draftId) {
    noZeroPrice(values);
    const client = initCarsClient();
    values.date_added = new Date().toISOString().slice(0, 10);
    const { data: newCar, error } = await client.from('cars').insert(values).select().single();
    if (error) { alert('פרסום הרכב נכשל: ' + error.message + (error.message && error.message.indexOf('duplicate') !== -1 ? '\n\n(ייתכן שכתובת ה-URL הזו כבר בשימוש — בדוק/שנה את ה-slug)' : '')); return null; }
    await client.from('car_drafts').update({ status: 'published', published_car_id: newCar.id, reviewed_at: new Date().toISOString() }).eq('id', draftId);
    delete draftVerifications[draftId];
    alert('✓ הרכב פורסם בהצלחה! ייכנס לעמוד /car/' + values.slug + '/ בריצה הבאה של יצירת הדפים הסטטיים (עד 4 שעות, או הרצה ידנית).');
    return newCar;
  }
  window.publishDraftDirect = async function (draftId, btn) {
    const d = _draftsCache[draftId]; if (!d || !d.extracted_data) return;
    const values = valuesFromDraft(d);
    const missing = [['brand', 'יצרן'], ['model', 'דגם'], ['year', 'שנה'], ['horsepower', 'הספק'], ['slug', 'כתובת URL']].filter(function (x) { return isBlank(values[x[0]]); }).map(function (x) { return x[1]; });
    if (missing.length) { alert('חסרים שדות חובה: ' + missing.join(', ') + '.\nאפשר להשלים בטופס העריכה (📝).'); return; }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(values.slug)) { alert('כתובת ה-URL (slug) לא תקינה: "' + values.slug + '". תקן בטופס העריכה.'); return; }
    const r = draftVerifications[draftId];
    const open = r && r.blockingIssues ? r.blockingIssues.length : 0;
    const notes = [];
    if (!r || !r.sourceChecked) notes.push('• הטיוטה עוד לא עברה בדיקה מול קובץ המקור');
    if (open) notes.push('• יש ' + open + ' בעיות פתוחות מהבדיקה');
    if (!values.price) notes.push('• אין מחיר (יוצג "מחיר טרם פורסם")');
    if (!values.image_cutout) notes.push('• אין תמונה ללא רקע');
    if (!values.image_main) notes.push('• אין תמונה ראשית');
    if (!confirm('לפרסם את ' + values.brand + ' ' + values.model + ' ' + values.year + ' באתר?' + (notes.length ? '\n\nלתשומת לבך:\n' + notes.join('\n') : ''))) return;
    const t0 = btn ? btn.textContent : ''; if (btn) { btn.disabled = true; btn.textContent = 'מפרסם…'; }
    try {
      const car = await insertCarFromDraft(values, draftId);
      if (car) { loadCarDrafts(); loadExistingCars(); }
    } catch (e) { alert('שגיאה בפרסום: ' + (e && e.message ? e.message : e)); }
    finally { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = t0; } }
  };

  // ═══════════ טופס עריכה משותף (טיוטה חדשה / רכב קיים) ═══════════

  function fieldValueToInputString(type, value) {
    if (value === null || value === undefined) return '';
    if (type === 'list') return Array.isArray(value) ? value.join('\n') : String(value);
    return String(value);
  }

  function buildFieldHtml(f, value, issuesByField) {
    const val = fieldValueToInputString(f.type, value);
    const issue = issuesByField && issuesByField[f.key];
    let inputHtml;
    if (f.type === 'select') {
      inputHtml = '<select id="car-f-' + f.key + '" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--adm-border);background:var(--adm-surface-2);color:var(--adm-text);font-family:var(--font);font-size:0.9rem;">' +
        (f.options || []).map(function (o) { return '<option value="' + escapeAttr(o[0]) + '"' + (String(o[0]) === val ? ' selected' : '') + '>' + escapeAttr(o[1]) + '</option>'; }).join('') + '</select>';
    } else if (f.type === 'textarea' || f.type === 'list') {
      const rows = f.type === 'list' ? 4 : 3;
      inputHtml = '<textarea id="car-f-' + f.key + '" rows="' + rows + '" placeholder="' + escapeAttr(f.placeholder || '') + '" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--adm-border);background:var(--adm-surface-2);color:var(--adm-text);font-family:var(--font);font-size:0.88rem;resize:vertical;">' + escapeHtml(val) + '</textarea>';
    } else {
      const inputType = (f.type === 'number' || f.type === 'float') ? 'number' : 'text';
      const step = f.type === 'float' ? ' step="any"' : '';
      inputHtml = '<input type="' + inputType + '" id="car-f-' + f.key + '"' + step + ' value="' + escapeAttr(val) + '" placeholder="' + escapeAttr(f.placeholder || '') + '" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--adm-border);background:var(--adm-surface-2);color:var(--adm-text);font-family:var(--font);font-size:0.9rem;">';
    }
    let issueHtml = '';
    if (issue) {
      const suggestion = issue.suggestion;
      issueHtml = '<div style="font-size:0.72rem;color:#e74c3c;margin-top:4px;">⚠️ ' + escapeAttr(issue.text) + '</div>';
      if (suggestion !== undefined) {
        const suggStr = Array.isArray(suggestion) ? suggestion.join(', ') : String(suggestion);
        issueHtml += '<div style="font-size:0.72rem;color:var(--adm-muted);margin-top:2px;">הצעה: ' + escapeAttr(suggStr) +
          ' <button type="button" class="tbl-btn" style="padding:2px 8px;font-size:0.68rem;" onclick="applyCarFieldSuggestion(\'' + f.key + '\')">אמץ</button></div>';
      }
    }
    const hint = f.hint ? '<div style="font-size:0.7rem;color:var(--adm-muted);margin-top:2px;">' + escapeAttr(f.hint) + '</div>' : '';
    return '<div class="form-group">' +
      '<label for="car-f-' + f.key + '">' + escapeAttr(f.label) + '</label>' +
      inputHtml + hint + issueHtml +
    '</div>';
  }

  function buildIssuesByField(verification) {
    const map = {};
    if (!verification) return map;
    (verification.blockingIssues || []).forEach(function (i) {
      if (!i.field) return;
      if (!map[i.field]) map[i.field] = { text: i.text };
      if (verification.fieldSuggestions && verification.fieldSuggestions[i.field] !== undefined) {
        map[i.field].suggestion = verification.fieldSuggestions[i.field];
      }
    });
    (verification.warnings || []).forEach(function (w) {
      if (!w.field || map[w.field]) return;
      map[w.field] = { text: w.text };
      if (verification.fieldSuggestions && verification.fieldSuggestions[w.field] !== undefined) {
        map[w.field].suggestion = verification.fieldSuggestions[w.field];
      }
    });
    return map;
  }

  window.applyCarFieldSuggestion = function (fieldKey) {
    if (!currentFormState || !currentFormState.verification) return;
    const suggestion = currentFormState.verification.fieldSuggestions && currentFormState.verification.fieldSuggestions[fieldKey];
    if (suggestion === undefined) return;
    const fieldDef = ALL_FIELDS.filter(function (f) { return f.key === fieldKey; })[0];
    const el = document.getElementById('car-f-' + fieldKey);
    if (!el || !fieldDef) return;
    el.value = fieldValueToInputString(fieldDef.type, suggestion);
  };

  function photosPreviewHtml(photos, mainPhoto) {
    if (!photos || !photos.length) return '<div class="adm-empty-state" style="padding:10px;">אין תמונות עדיין</div>';
    return '<div style="display:flex;flex-wrap:wrap;gap:8px;">' + photos.map(function (url, i) {
      const isMain = url === mainPhoto;
      return '<div style="position:relative;width:90px;">' +
        '<img src="' + escapeAttr(url) + '" style="width:90px;height:68px;object-fit:cover;border-radius:6px;border:2px solid ' + (isMain ? 'var(--adm-accent,#ff9d2e)' : 'transparent') + ';">' +
        '<div style="display:flex;gap:2px;margin-top:2px;">' +
          '<button type="button" class="tbl-btn" style="flex:1;padding:2px;font-size:0.62rem;" title="הפוך לתמונה ראשית" onclick="setMainCarPhoto(' + i + ')">' + (isMain ? '★' : '☆') + '</button>' +
          '<button type="button" class="tbl-btn" style="flex:1;padding:2px;font-size:0.62rem;" title="הסר רקע מהתמונה הזו" onclick="formCutoutFromPhoto(' + i + ')">✂️</button>' +
          '<button type="button" class="tbl-btn del" style="flex:1;padding:2px;font-size:0.62rem;" title="הסר" onclick="removeCarPhoto(' + i + ')">✕</button>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  window.setMainCarPhoto = function (idx) {
    if (!currentFormState) return;
    currentFormState.mainPhoto = currentFormState.photos[idx];
    const host = document.getElementById('car-photos-preview');
    if (host) host.innerHTML = photosPreviewHtml(currentFormState.photos, currentFormState.mainPhoto);
  };
  window.removeCarPhoto = function (idx) {
    if (!currentFormState) return;
    const removed = currentFormState.photos.splice(idx, 1)[0];
    if (currentFormState.mainPhoto === removed) currentFormState.mainPhoto = currentFormState.photos[0] || null;
    const host = document.getElementById('car-photos-preview');
    if (host) host.innerHTML = photosPreviewHtml(currentFormState.photos, currentFormState.mainPhoto);
  };
  window.addMoreCarPhotos = async function (input) {
    const files = input.files ? Array.from(input.files) : [];
    if (!files.length || !currentFormState) return;
    const host = document.getElementById('car-photos-preview');
    if (host) host.innerHTML = '<div class="adm-empty-state" style="padding:10px;">מעלה תמונות...</div>';
    for (const file of files) {
      const url = await uploadCarPhoto(file);
      if (url) {
        currentFormState.photos.push(url);
        if (!currentFormState.mainPhoto) currentFormState.mainPhoto = url;
      }
    }
    if (host) host.innerHTML = photosPreviewHtml(currentFormState.photos, currentFormState.mainPhoto);
    input.value = '';
  };

  // ═══════════ ניהול רמות גימור נוספות בטופס ═══════════

  const INPUT_CSS = 'width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--adm-border);background:var(--adm-surface-2);color:var(--adm-text);font-family:var(--font);font-size:0.84rem;';
  function trimIssue(trim, key) {
    const v = currentFormState && currentFormState.verification;
    if (!v || !trim || !trim.name) return null;
    const field = 'trims[' + trim.name + '].' + key;
    const all = (v.blockingIssues || []).concat(v.warnings || []);
    const hit = all.filter(function (i) { return i.field === field; })[0];
    if (!hit) return null;
    const sug = v.fieldSuggestions ? v.fieldSuggestions[field] : undefined;
    return { text: hit.text, field: field, suggestion: sug };
  }
  function trimFieldInputHtml(idx, f, value, trim) {
    const id = 'car-trim-' + idx + '-' + f.key;
    const val = fieldValueToInputString(f.type, value);
    const iss = trimIssue(trim, f.key);
    let issHtml = '';
    if (iss) {
      issHtml = '<div style="font-size:0.7rem;color:#e74c3c;margin-top:3px;">⚠️ ' + escapeAttr(iss.text) + '</div>';
      if (iss.suggestion !== undefined) issHtml += '<div style="font-size:0.7rem;color:var(--adm-muted);margin-top:2px;">הצעה: ' + escapeAttr(iss.suggestion === null ? '(ריק — לא במסמך)' : String(iss.suggestion)) +
        ' <button type="button" class="tbl-btn" style="padding:2px 8px;font-size:0.66rem;" onclick="applyTrimSuggestion(' + idx + ',\'' + f.key + '\')">אמץ</button></div>';
    }
    const wrap = function (inner, minW) { return '<div class="form-group" style="min-width:' + minW + 'px;flex:1;"><label for="' + id + '">' + escapeAttr(f.label) + '</label>' + inner + issHtml + '</div>'; };
    if (f.type === 'list') return wrap('<textarea id="' + id + '" rows="2" style="' + INPUT_CSS + 'resize:vertical;">' + escapeHtml(val) + '</textarea>', 260);
    if (f.type === 'select') return wrap('<select id="' + id + '" style="' + INPUT_CSS + '">' + (f.options || []).map(function (o) { return '<option value="' + escapeAttr(o[0]) + '"' + (String(o[0]) === val ? ' selected' : '') + '>' + escapeAttr(o[1]) + '</option>'; }).join('') + '</select>', 170);
    const inputType = (f.type === 'number' || f.type === 'float') ? 'number' : 'text';
    const step = f.type === 'float' ? ' step="any"' : '';
    return wrap('<input type="' + inputType + '" id="' + id + '"' + step + ' value="' + escapeAttr(val) + '" style="' + INPUT_CSS + '">', 150);
  }
  window.applyTrimSuggestion = function (idx, key) {
    if (!currentFormState) return;
    syncTrimsFromInputs();
    const trim = currentFormState.trims[idx]; const iss = trimIssue(trim, key);
    if (!iss || iss.suggestion === undefined) return;
    const f = TRIM_INPUTS.filter(function (x) { return x.key === key; })[0];
    const el = document.getElementById('car-trim-' + idx + '-' + key);
    if (el && f) el.value = fieldValueToInputString(f.type, iss.suggestion === null ? null : (f.type === 'number' || f.type === 'float') ? String(iss.suggestion).replace(/[^\d.]/g, '') : iss.suggestion);
  };

  function buildTrimCardHtml(trim, idx) {
    let fieldsHtml = '', open = false;
    TRIM_FIELDS.forEach(function (f) {
      if (f.group) { if (open) fieldsHtml += '</div>'; fieldsHtml += '<div style="font-size:0.74rem;font-weight:700;color:var(--adm-muted);margin:10px 0 2px;">' + escapeAttr(f.group) + '</div><div class="form-row" style="flex-wrap:wrap;">'; open = true; return; }
      fieldsHtml += trimFieldInputHtml(idx, f, trim ? trim[f.key] : null, trim);
    });
    if (open) fieldsHtml += '</div>';
    return '<div class="form-block" style="background:var(--adm-surface-2);margin-bottom:10px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
        '<strong style="font-size:0.85rem;">גרסה ' + (idx + 1) + (trim && trim.name ? ' — ' + escapeAttr(trim.name) : '') + '</strong>' +
        '<button type="button" class="tbl-btn del" onclick="removeCarTrim(' + idx + ')">✕ הסר גרסה</button>' +
      '</div>' + fieldsHtml +
    '</div>';
  }

  function renderTrimsListHtml() {
    const trims = (currentFormState && currentFormState.trims) || [];
    if (!trims.length) {
      return '<div class="adm-empty-state" style="padding:10px;">אין גרסאות. בחילוץ אוטומטי כל גרסה במסמך נוצרת כאן עם המפרט המלא שלה (זה מה שמזין את עמוד "מפרט טכני מלא").</div>';
    }
    return trims.map(buildTrimCardHtml).join('');
  }

  function trimsBlockHtml() {
    return '<div class="form-block"><h3>גרסאות / רמות גימור — מפרט מלא לכל גרסה</h3>' +
      '<div id="car-trims-list">' + renderTrimsListHtml() + '</div>' +
      '<button type="button" class="btn-secondary" style="margin-top:8px;" onclick="addCarTrim()">➕ הוסף גרסה</button>' +
    '</div>';
  }

  function readTrimCard(idx) {
    const prev = (currentFormState && currentFormState.trims && currentFormState.trims[idx]) || {};
    const out = Object.assign({}, prev); // שומר מפתחות שאין להם שדה בטופס (למשל v)
    out.tu = 'kgm'; // שדות המומנט בטופס הם בקג״מ (05.11.2026)
    TRIM_INPUTS.forEach(function (f) {
      const el = document.getElementById('car-trim-' + idx + '-' + f.key);
      if (!el) return;
      const raw = el.value;
      if (f.type === 'list') out[f.key] = raw.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      else if (f.type === 'number') { const n = parseInt(raw, 10); out[f.key] = raw.trim() === '' || isNaN(n) ? null : n; }
      else if (f.type === 'float') { const n = parseFloat(raw); out[f.key] = raw.trim() === '' || isNaN(n) ? null : n; }
      else out[f.key] = raw.trim() === '' ? null : raw.trim();
    });
    return out;
  }

  // קוראים בחזרה את הערכים שהמנהל הקליד לתוך כל כרטיסי רמות הגימור הקיימים,
  // לפני שמוסיפים/מסירים כרטיס (אחרת עריכות בכרטיסים אחרים היו הולכות לאיבוד
  // בכל render מחדש) ולפני שמירה סופית.
  function syncTrimsFromInputs() {
    if (!currentFormState || !currentFormState.trims) return;
    currentFormState.trims = currentFormState.trims.map(function (_, idx) { return readTrimCard(idx); });
  }

  window.addCarTrim = function () {
    if (!currentFormState) return;
    syncTrimsFromInputs();
    currentFormState.trims.push({});
    const host = document.getElementById('car-trims-list');
    if (host) host.innerHTML = renderTrimsListHtml();
  };

  window.removeCarTrim = function (idx) {
    if (!currentFormState) return;
    syncTrimsFromInputs();
    currentFormState.trims.splice(idx, 1);
    const host = document.getElementById('car-trims-list');
    if (host) host.innerHTML = renderTrimsListHtml();
  };

  // ═══════════ תמונה מבודדת (image_cutout) — מועלית ללא דחיסה כדי לשמור על השקיפות ═══════════
  function cutoutPreviewHtml(url) {
    if (!url) return '<div style="font-size:0.78rem;color:var(--adm-muted);">אין תמונה מבודדת.</div>';
    return '<div style="display:flex;align-items:center;gap:12px;">' +
      '<div style="width:220px;aspect-ratio:16/10;border-radius:8px;background:repeating-conic-gradient(#e5e7eb 0 25%,#fff 0 50%) 0 0/16px 16px;display:grid;place-items:center;overflow:hidden;"><img src="' + escapeAttr(url) + '" alt="" style="max-width:92%;max-height:88%;object-fit:contain;"></div>' +
      '<button type="button" class="tbl-btn" onclick="removeCarCutout()">הסר</button></div>';
  }
  window.uploadCarCutout = async function (input) {
    const file = input.files && input.files[0]; input.value = '';
    if (!file || !currentFormState) return;
    const host = document.getElementById('car-cutout-preview');
    if (host) host.innerHTML = '<div style="font-size:0.78rem;color:var(--adm-muted);">מעלה…</div>';
    try {
      let note = '';
      const u = await cutoutFromUpload(file, formRunCutout, function (h) { note = h; });
      if (u) currentFormState.cutout = u;
      if (host) host.innerHTML = cutoutPreviewHtml(currentFormState.cutout) + (note ? '<div style="font-size:0.78rem;margin-top:6px;">' + note + '</div>' : '');
      return;
    } catch (e) { alert('ההעלאה נכשלה: ' + (e && e.message ? e.message : e)); }
    if (host) host.innerHTML = cutoutPreviewHtml(currentFormState.cutout);
  };
  // כלי הסרת הרקע גם מתוך טופס העריכה המלא
  async function formRunCutout(src) {
    const st = currentFormState; if (!st) return;
    const host = document.getElementById('car-cutout-preview');
    if (host) host.innerHTML = '<div style="font-size:0.78rem;color:var(--adm-muted);">✂️ כלי הסרת הרקע נפתח בחלון נפרד — סיים שם ולחץ "שמור כתמונה ללא רקע".</div>';
    try {
      const blob = await openCutoutTool(src);
      if (currentFormState !== st) return;
      if (host) host.innerHTML = '<div style="font-size:0.78rem;color:var(--adm-muted);">מעלה…</div>';
      st.cutout = await uploadCutoutBlob(blob);
    } catch (e) { alert(e && e.message ? e.message : e); }
    if (host && currentFormState === st) host.innerHTML = cutoutPreviewHtml(st.cutout);
  }
  window.formCutoutFromFile = function (input) { const f = input.files && input.files[0]; input.value = ''; if (f) formRunCutout({ blob: f, name: f.name }); };
  window.formCutoutOpenTool = function () { formRunCutout({ pick: true }); };
  window.formCutoutFromPhoto = function (i) { if (currentFormState && currentFormState.photos[i]) formRunCutout({ url: currentFormState.photos[i], name: 'photo-' + (i + 1) }); };
  window.formCutoutFromMain = function () { if (currentFormState && currentFormState.mainPhoto) formRunCutout({ url: currentFormState.mainPhoto, name: 'main' }); };
  window.removeCarCutout = function () {
    if (!currentFormState) return;
    currentFormState.cutout = null;
    const host = document.getElementById('car-cutout-preview');
    if (host) host.innerHTML = cutoutPreviewHtml(null);
  };

  // ═══════════ אבזור (01.11.2026): קבוצות + חבילות מהמפרט, ופריטים בולטים עם תמונה (לעמוד "אבזור") ═══════════
  // equipment = { base_name, groups:[{title, items[]}], packages:[{name, items[]}] } · highlights = [{title, image}] (עד 6)
  const EQ_CSS = 'width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--adm-border);background:var(--adm-surface-2);color:var(--adm-text);font-family:var(--font);font-size:0.84rem;';
  function eqState() {
    const s = currentFormState; if (!s) return null;
    if (!s.equipment || typeof s.equipment !== 'object') s.equipment = {};
    if (!Array.isArray(s.equipment.groups)) s.equipment.groups = [];
    if (!Array.isArray(s.equipment.packages)) s.equipment.packages = [];
    if (!Array.isArray(s.highlights)) s.highlights = [];
    return s;
  }
  function eqAllItems() {
    const s = eqState(); if (!s) return [];
    const out = [];
    s.equipment.groups.concat(s.equipment.packages).forEach(function (g) { (g.items || []).forEach(function (i) { if (out.indexOf(i) === -1) out.push(i); }); });
    return out;
  }
  function eqListCard(kind, idx, head, items) {
    const isPkg = kind === 'pkg';
    return '<div class="form-block" style="background:var(--adm-surface-2);margin-bottom:8px;padding:10px;">' +
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">' +
        '<input id="eq-' + kind + '-' + idx + '-h" value="' + escapeAttr(head || '') + '" placeholder="' + (isPkg ? 'שם החבילה (למשל Signature)' : 'כותרת הקבוצה (למשל עיצוב חיצוני)') + '" style="' + EQ_CSS + 'font-weight:600;">' +
        '<button type="button" class="tbl-btn del" onclick="removeEqItem(\'' + kind + '\',' + idx + ')">✕</button></div>' +
      '<textarea id="eq-' + kind + '-' + idx + '-i" rows="' + Math.min(10, Math.max(3, (items || []).length + 1)) + '" placeholder="שורה = פריט" style="' + EQ_CSS + 'resize:vertical;">' + escapeHtml((items || []).join('\n')) + '</textarea></div>';
  }
  function hlCard(h, idx) {
    return '<div class="form-block" style="background:var(--adm-surface-2);margin-bottom:8px;padding:10px;display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;">' +
      '<div style="width:120px;aspect-ratio:4/3;border-radius:8px;background:var(--adm-border);display:grid;place-items:center;overflow:hidden;flex:0 0 auto;">' +
        (h.image ? '<img src="' + escapeAttr(h.image) + '" alt="" style="width:100%;height:100%;object-fit:cover;">' : '<span style="font-size:0.7rem;color:var(--adm-muted);">אין תמונה</span>') + '</div>' +
      '<div style="flex:1;min-width:220px;">' +
        '<label style="font-size:0.78rem;" for="hl-' + idx + '-t">פריט אבזור בולט ' + (idx + 1) + '</label>' +
        '<input id="hl-' + idx + '-t" list="eq-all-items" value="' + escapeAttr(h.title || '') + '" style="' + EQ_CSS + '">' +
        '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">' +
          '<label class="tbl-btn" style="cursor:pointer;"><input type="file" accept="image/*" style="display:none;" onchange="uploadHighlightImage(this,' + idx + ')">⬆️ ' + (h.image ? 'החלף תמונה' : 'העלה תמונה') + '</label>' +
          (h.image ? '<button type="button" class="tbl-btn" onclick="removeHighlightImage(' + idx + ')">הסר תמונה</button>' : '') +
          '<button type="button" class="tbl-btn del" onclick="removeEqItem(\'hl\',' + idx + ')">✕ הסר פריט</button>' +
        '</div></div></div>';
  }
  function equipmentBlockInner() {
    const s = eqState(); if (!s) return '';
    const eq = s.equipment;
    return '<div class="form-group" style="max-width:320px;"><label for="eq-base">שם רמת האבזור הבסיסית</label><input id="eq-base" value="' + escapeAttr(eq.base_name || '') + '" placeholder="למשל Elite" style="' + EQ_CSS + '"></div>' +
      '<h4 style="margin:14px 0 6px;font-size:0.9rem;">קבוצות אבזור</h4>' +
      (eq.groups.length ? eq.groups.map(function (g, i) { return eqListCard('grp', i, g.title, g.items); }).join('') : '<div class="adm-empty-state" style="padding:8px;">אין קבוצות. בחילוץ אוטומטי כל קבוצה מהמפרט נוצרת כאן.</div>') +
      '<button type="button" class="btn-secondary" onclick="addEqItem(\'grp\')">➕ הוסף קבוצה</button>' +
      '<h4 style="margin:16px 0 6px;font-size:0.9rem;">חבילות / תוספות לפי רמה</h4>' +
      eq.packages.map(function (p, i) { return eqListCard('pkg', i, p.name, p.items); }).join('') +
      '<button type="button" class="btn-secondary" onclick="addEqItem(\'pkg\')">➕ הוסף חבילה</button>' +
      '<h4 style="margin:16px 0 4px;font-size:0.9rem;">אבזור בולט — מוצג סביב הרכב עם קו ותמונה (עד 6)</h4>' +
      '<div style="font-size:0.72rem;color:var(--adm-muted);margin-bottom:8px;">החילוץ בוחר עד 4 פריטים מתוך הרשימה. התמונות מועלות כאן (מהמפרט או מתמונות היבואן). פריט בלי תמונה מוצג עם סמל.</div>' +
      '<datalist id="eq-all-items">' + eqAllItems().map(function (t) { return '<option value="' + escapeAttr(t) + '"></option>'; }).join('') + '</datalist>' +
      s.highlights.map(hlCard).join('') +
      (s.highlights.length < 6 ? '<button type="button" class="btn-secondary" onclick="addEqItem(\'hl\')">➕ הוסף פריט בולט</button>' : '');
  }
  function equipmentBlockHtml() {
    return '<div class="form-block"><h3>אבזור — מהמפרט</h3><div id="car-equipment-editor">' + equipmentBlockInner() + '</div></div>';
  }
  function syncEquipmentFromInputs() {
    const s = eqState(); if (!s || !document.getElementById('car-equipment-editor')) return;
    const val = function (id) { const el = document.getElementById(id); return el ? el.value : null; };
    const lines = function (t) { return String(t || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); };
    const b = val('eq-base'); if (b !== null) s.equipment.base_name = b.trim() || null;
    s.equipment.groups = s.equipment.groups.map(function (g, i) { const h = val('eq-grp-' + i + '-h'), it = val('eq-grp-' + i + '-i'); return h === null ? g : { title: h.trim(), items: lines(it) }; });
    s.equipment.packages = s.equipment.packages.map(function (p, i) { const h = val('eq-pkg-' + i + '-h'), it = val('eq-pkg-' + i + '-i'); return h === null ? p : { name: h.trim(), items: lines(it) }; });
    s.highlights = s.highlights.map(function (hl, i) { const t = val('hl-' + i + '-t'); return t === null ? hl : { title: t.trim(), image: hl.image || null }; });
  }
  function rerenderEquipment() { const host = document.getElementById('car-equipment-editor'); if (host) host.innerHTML = equipmentBlockInner(); }
  window.addEqItem = function (kind) {
    const s = eqState(); if (!s) return; syncEquipmentFromInputs();
    if (kind === 'grp') s.equipment.groups.push({ title: '', items: [] });
    else if (kind === 'pkg') s.equipment.packages.push({ name: '', items: [] });
    else if (s.highlights.length < 6) s.highlights.push({ title: '', image: null });
    rerenderEquipment();
  };
  window.removeEqItem = function (kind, idx) {
    const s = eqState(); if (!s) return; syncEquipmentFromInputs();
    (kind === 'grp' ? s.equipment.groups : kind === 'pkg' ? s.equipment.packages : s.highlights).splice(idx, 1);
    rerenderEquipment();
  };
  window.uploadHighlightImage = async function (input, idx) {
    const file = input.files && input.files[0]; const s = eqState();
    if (!file || !s) return;
    syncEquipmentFromInputs();
    const host = document.getElementById('car-equipment-editor');
    const note = document.createElement('div'); note.textContent = 'מעלה תמונה…'; note.style.cssText = 'font-size:0.78rem;color:var(--adm-muted);';
    input.closest('.form-block').appendChild(note);
    const url = await uploadCarPhoto(file);
    if (!url) { alert('העלאת התמונה נכשלה.'); note.remove(); return; }
    s.highlights[idx] = Object.assign({}, s.highlights[idx], { image: url });
    rerenderEquipment();
  };
  window.removeHighlightImage = function (idx) {
    const s = eqState(); if (!s) return; syncEquipmentFromInputs();
    s.highlights[idx] = Object.assign({}, s.highlights[idx], { image: null });
    rerenderEquipment();
  };
  function equipmentValues() {
    const s = eqState(); syncEquipmentFromInputs();
    const eq = s.equipment;
    return {
      equipment: {
        base_name: eq.base_name || null,
        groups: eq.groups.filter(function (g) { return g.title && g.items && g.items.length; }),
        packages: eq.packages.filter(function (p) { return p.name && p.items && p.items.length; }),
      },
      highlights: s.highlights.filter(function (h) { return h.title; }).slice(0, 6),
    };
  }

  function buildFormHtml(mode, data, verification) {
    const issuesByField = buildIssuesByField(verification);
    const groupsHtml = FIELD_GROUPS.map(function (g) {
      const fieldsHtml = g.fields.map(function (f) { return buildFieldHtml(f, data[f.key], issuesByField); }).join('');
      return '<div class="form-block"><h3>' + escapeAttr(g.title) + '</h3><div class="form-row" style="flex-wrap:wrap;">' +
        fieldsHtml.replace(/<div class="form-group">/g, '<div class="form-group" style="min-width:200px;flex:1;">') +
      '</div></div>';
    }).join('');

    const photosBlock = '<div class="form-block"><h3>תמונות</h3>' +
      '<div id="car-photos-preview">' + photosPreviewHtml(currentFormState.photos, currentFormState.mainPhoto) + '</div>' +
      '<label style="display:flex;align-items:center;gap:8px;padding:10px 14px;margin-top:10px;border:1.5px dashed var(--adm-border);border-radius:8px;cursor:pointer;font-size:0.82rem;color:var(--adm-muted);max-width:220px;">' +
        '<input type="file" accept="image/*" multiple style="display:none;" onchange="addMoreCarPhotos(this)">➕ הוסף תמונות' +
      '</label>' +
      '<div style="font-size:0.72rem;color:var(--adm-muted);margin-top:6px;">התמונה עם הכוכב ★ תשמש כתמונה הראשית בכרטיס וברשימת הרכבים.</div>' +
      '<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--adm-border);">' +
        '<strong style="font-size:0.85rem;">תמונה מבודדת (רקע שקוף) — אופציונלי</strong>' +
        '<div style="font-size:0.72rem;color:var(--adm-muted);margin:4px 0 8px;">PNG או WebP שקוף, רכב שלם בזווית קדמית-צדית. כשקיימת — מוצגת בכרטיסים ובהשוואה במקום התמונה הראשית. המקור לא משתנה.</div>' +
        '<div id="car-cutout-preview">' + cutoutPreviewHtml(currentFormState.cutout) + '</div>' +
        '<label style="display:inline-flex;align-items:center;gap:8px;padding:10px 14px;margin-top:8px;border:1.5px dashed var(--adm-border);border-radius:8px;cursor:pointer;font-size:0.82rem;color:var(--adm-muted);">' +
          '<input type="file" accept="image/*" style="display:none;" onchange="uploadCarCutout(this)">⬆️ העלאת תמונה מבודדת (PNG שקוף מוכן)' +
        '</label> ' +
        '<button type="button" class="tbl-btn" style="margin-top:8px;" onclick="formCutoutOpenTool()">✂️ הסר רקע מקובץ במחשב</button> ' +
        (currentFormState.mainPhoto ? '<button type="button" class="tbl-btn" style="margin-top:8px;" onclick="formCutoutFromMain()">✂️ הסר רקע מהתמונה הראשית</button>' : '') +
      '</div>' +
    '</div>';

    const actionsBlock = '<div class="form-block" style="display:flex;gap:12px;justify-content:flex-end;">' +
      '<button class="btn-secondary" onclick="closeCarForm()">ביטול</button>' +
      '<button class="btn-primary" id="car-form-submit-btn" onclick="submitCarForm()">' + (mode === 'edit' ? '✓ שמור שינויים' : mode === 'update' ? '✓ עדכן את הרכב' : '✓ פרסם רכב') + '</button>' +
    '</div>';

    return photosBlock + groupsHtml + trimsBlockHtml() + equipmentBlockHtml() + actionsBlock;
  }

  // ═══════════ עדכון רכב קיים ממפרט (04.11.2026) ═══════════
  // מעלים מפרט לרכב שכבר באתר → טיוטה מקושרת (car_drafts.published_car_id = הרכב, status = pending)
  // → אותו חילוץ ואותה בדיקה מול המקור → טופס עם השוואה "ישן ← חדש" → עדכון הרכב הקיים (לא רכב חדש).
  // כללי המיזוג: לא נוגעים בזהות ובכתובת, לא מוחקים עבודה ידנית, ונתוני המפרט מתעדכנים רק כשהמפרט נותן ערך.
  const UPD_KEEP_ALWAYS = ['slug', 'brand', 'model', 'year'];
  const UPD_KEEP_IF_SET = ['category', 'description', 'meta_title', 'meta_description', 'score', 'pros', 'cons', 'youtube_video_url', 'sales_rank', 'sales_units', 'sales_year'];
  const isEmptyVal = function (v) { return v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length); };
  function mergeForUpdate(car, ex) {
    const out = {};
    ALL_FIELDS.forEach(function (f) {
      const k = f.key, oldV = car[k], newV = ex[k];
      if (UPD_KEEP_ALWAYS.indexOf(k) !== -1) out[k] = oldV;
      else if (UPD_KEEP_IF_SET.indexOf(k) !== -1) out[k] = isEmptyVal(oldV) ? newV : oldV;
      else out[k] = isEmptyVal(newV) ? oldV : newV;
    });
    return out;
  }
  const normTok = function (s) { return String(s || '').toLowerCase().replace(/mercedes-benz/g, 'mercedes').split(/[^a-z0-9֐-׿]+/).filter(function (t) { return t.length > 1; }); };
  function looksLikeOtherCar(car, ex) {
    const b1 = normTok(car.brand), b2 = normTok(ex.brand), m1 = normTok(car.model), m2 = normTok(ex.model);
    const brandOk = !b2.length || b1.some(function (t) { return b2.indexOf(t) !== -1 || b2.some(function (u) { return u.indexOf(t) === 0 || t.indexOf(u) === 0; }); });
    const modelOk = !m2.length || m1.some(function (t) { return m2.indexOf(t) !== -1; });
    return !(brandOk && modelOk);
  }
  const shortVal = function (v) {
    if (isEmptyVal(v)) return '—';
    if (Array.isArray(v)) return v.length + ' פריטים';
    const s = String(v); return s.length > 60 ? s.slice(0, 57) + '…' : s;
  };
  function updateDiffHtml(car, merged, ex, trimsNew, eqNew) {
    const rows = [];
    ALL_FIELDS.forEach(function (f) {
      const a = car[f.key], b = merged[f.key];
      if (JSON.stringify(isEmptyVal(a) ? null : a) === JSON.stringify(isEmptyVal(b) ? null : b)) return;
      rows.push('<tr><td style="padding:4px 8px;color:var(--adm-muted);">' + escapeAttr(f.label.replace(' *', '')) + '</td><td style="padding:4px 8px;text-decoration:line-through;color:var(--adm-muted);">' + escapeAttr(shortVal(a)) + '</td><td style="padding:4px 8px;font-weight:600;">' + escapeAttr(shortVal(b)) + '</td></tr>');
    });
    const oldTrims = Array.isArray(car.trims) ? car.trims.length : 0;
    if (trimsNew) rows.push('<tr><td style="padding:4px 8px;color:var(--adm-muted);">גרסאות (מפרט מלא)</td><td style="padding:4px 8px;color:var(--adm-muted);">' + oldTrims + ' גרסאות</td><td style="padding:4px 8px;font-weight:600;">' + trimsNew + ' גרסאות במפרט מלא</td></tr>');
    if (eqNew) rows.push('<tr><td style="padding:4px 8px;color:var(--adm-muted);">רשימת האבזור</td><td style="padding:4px 8px;color:var(--adm-muted);">' + ((car.equipment && car.equipment.groups) ? car.equipment.groups.length + ' קבוצות' : '—') + '</td><td style="padding:4px 8px;font-weight:600;">' + eqNew + '</td></tr>');
    const warn = looksLikeOtherCar(car, ex)
      ? '<div style="background:#fdecea;color:#c0392b;border-radius:8px;padding:10px 12px;margin-bottom:10px;font-weight:600;">⚠️ המפרט נראה של רכב אחר: במסמך כתוב "' + escapeAttr((ex.brand || '') + ' ' + (ex.model || '')) + '" והרכב באתר הוא "' + escapeAttr(car.brand + ' ' + car.model) + '". ודא שהעלית את הקובץ הנכון לפני העדכון.</div>' : '';
    return '<div class="form-block" id="car-update-diff"><h3>🔄 מה ישתנה ב-' + escapeAttr(car.brand + ' ' + car.model) + ' (' + rows.length + ')</h3>' + warn +
      '<div style="font-size:0.74rem;color:var(--adm-muted);margin-bottom:8px;">הכתובת, השם, השנה, התמונות, הציון, היתרונות/חסרונות, התיאור וה-SEO נשמרים כמו שהם. נתון שלא מופיע במפרט לא נמחק. אפשר לערוך כל שדה בטופס לפני העדכון.</div>' +
      (rows.length ? '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.8rem;"><thead><tr><th style="text-align:right;padding:4px 8px;">שדה</th><th style="text-align:right;padding:4px 8px;">עכשיו באתר</th><th style="text-align:right;padding:4px 8px;">אחרי העדכון</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>'
        : '<div class="adm-empty-state" style="padding:8px;">המפרט לא משנה אף נתון ברכב.</div>') + '</div>';
  }
  window.startCarSpecUpdate = async function (carId, input) {
    const file = input && input.files && input.files[0]; if (!file) return;
    const client = initCarsClient(); if (!client) return;
    const token = await getAuthToken(); if (!token) { alert('יש להתחבר לניהול קודם.'); input.value = ''; return; }
    const car = (_allCarsCache || []).filter(function (c) { return c.id === carId; })[0];
    const label = input.closest('label'); const t0 = label ? label.lastChild.textContent : '';
    if (label) label.lastChild.textContent = ' מעלה…';
    try {
      const specPath = await uploadSpecFile(file);
      if (!specPath) { alert('העלאת קובץ המפרט נכשלה.'); return; }
      const { data: draft, error } = await client.from('car_drafts').insert({ source_file_url: specPath, photo_urls: [], status: 'pending', published_car_id: carId }).select().single();
      if (error) { alert('יצירת טיוטת העדכון נכשלה: ' + error.message); return; }
      const tabBtn = document.querySelector('.cars-subtab[onclick*="\'new\'"]');
      if (typeof window.carsSubTab === 'function') window.carsSubTab('new', tabBtn);
      alert('✓ המפרט הועלה' + (car ? ' עבור ' + car.brand + ' ' + car.model : '') + '. החילוץ מתחיל עכשיו — הטיוטה מסומנת "🔄 עדכון" ברשימת הטיוטות.');
      setTimeout(function () { extractDraftSpec(draft.id); }, 300);
    } catch (e) {
      alert('שגיאה: ' + (e && e.message ? e.message : e));
    } finally {
      if (label) label.lastChild.textContent = t0; input.value = '';
    }
  };
  async function openUpdateForm(draft) {
    const client = initCarsClient(); if (!client) return;
    const { data: car } = await client.from('cars').select('*').eq('id', draft.published_car_id).single();
    if (!car) { alert('הרכב שהטיוטה מעדכנת לא נמצא (אולי נמחק).'); return; }
    const ex = Object.assign({}, draft.extracted_data || {});
    ex.torque = exTorqueKgm(ex);
    const merged = mergeForUpdate(car, ex);
    const exTrims = Array.isArray(ex.trims) ? ex.trims.filter(function (t) { return t && t.name; }) : [];
    const exEq = ex.equipment && Array.isArray(ex.equipment.groups) && ex.equipment.groups.length ? ex.equipment : null;
    const carHl = Array.isArray(car.highlights) ? car.highlights : [];
    const photos = (car.gallery_images || []).slice(); if (car.image_main && photos.indexOf(car.image_main) === -1) photos.unshift(car.image_main);
    currentFormState = {
      mode: 'update', carId: car.id, draftId: draft.id,
      photos: photos, mainPhoto: car.image_main || photos[0] || null, cutout: car.image_cutout || null, colorImages: car.color_images || {},
      trims: trimsToKgm(exTrims.length ? exTrims : car.trims),
      equipment: JSON.parse(JSON.stringify(exEq || car.equipment || {})),
      highlights: JSON.parse(JSON.stringify(carHl.length ? carHl : (ex.highlights || []))),
      verification: draftVerifications[draft.id],
    };
    renderCarForm('update', merged, draftVerifications[draft.id]);
    const host = document.getElementById('cars-form-host');
    const eqTxt = exEq ? exEq.groups.length + ' קבוצות' + (exEq.packages && exEq.packages.length ? ' + ' + exEq.packages.length + ' חבילות' : '') : '';
    if (host && host.firstChild) host.firstChild.insertAdjacentHTML('afterend', updateDiffHtml(car, merged, ex, exTrims.length, eqTxt));
    const slug = document.getElementById('car-f-slug');
    if (slug) { slug.readOnly = true; slug.style.opacity = '.6'; slug.title = 'בעדכון ממפרט הכתובת לא משתנה (שומר על הקישורים והדירוג בגוגל)'; }
  }

  window.openDraftForm = function (draftId) {
    const client = initCarsClient();
    if (!client) return;
    client.from('car_drafts').select('*').eq('id', draftId).single().then(function (res) {
      const draft = res.data;
      if (!draft) { alert('הטיוטה לא נמצאה.'); return; }
      if (draft.published_car_id) { openUpdateForm(draft); return; } // טיוטת עדכון לרכב קיים
      const data = Object.assign({}, draft.extracted_data || {});
      data.torque = exTorqueKgm(data);
      if (!data.slug && data.brand && data.model) data.slug = slugify(data.brand, data.model, data.year);
      currentFormState = {
        mode: 'draft', draftId: draftId,
        photos: (draft.photo_urls || []).slice(), mainPhoto: data.image_main || (draft.photo_urls || [])[0] || null, cutout: data.image_cutout || null, colorImages: data.color_images || {},
        trims: trimsToKgm(data.trims),
        equipment: JSON.parse(JSON.stringify(data.equipment || {})), highlights: JSON.parse(JSON.stringify(data.highlights || [])),
        verification: draftVerifications[draftId],
      };
      renderCarForm('draft', data, draftVerifications[draftId]);
    });
  };

  window.editExistingCar = function (carId) {
    const client = initCarsClient();
    if (!client) return;
    client.from('cars').select('*').eq('id', carId).single().then(function (res) {
      const car = res.data;
      if (!car) { alert('הרכב לא נמצא.'); return; }
      currentFormState = {
        mode: 'edit', carId: carId,
        photos: (car.gallery_images || []).slice(), mainPhoto: car.image_main || null, cutout: car.image_cutout || null, colorImages: car.color_images || {},
        trims: trimsToKgm(car.trims),
        equipment: JSON.parse(JSON.stringify(car.equipment || {})), highlights: JSON.parse(JSON.stringify(car.highlights || [])),
        verification: null,
      };
      if (car.image_main && currentFormState.photos.indexOf(car.image_main) === -1) currentFormState.photos.unshift(car.image_main);
      renderCarForm('edit', car, null);
    });
  };

  function renderCarForm(mode, data, verification) {
    const host = document.getElementById('cars-form-host');
    if (!host) return;
    host.innerHTML = '<div class="form-block"><h3>' + (mode === 'edit' ? '✏️ עריכת רכב' : mode === 'update' ? '🔄 עדכון רכב קיים מהמפרט' : '📝 סקירת נתונים ופרסום') + '</h3>' +
      (verification && !verification.ok ? '<p style="color:#e74c3c;font-size:0.85rem;">⚠️ נמצאו בעיות בבדיקת האימות — מסומנות ליד השדות הרלוונטיים. תקן או אמץ את ההצעות לפני הפרסום.</p>' : '') +
    '</div>' + buildFormHtml(mode, data, verification);
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  window.closeCarForm = function () {
    const host = document.getElementById('cars-form-host');
    if (host) host.innerHTML = '';
    currentFormState = null;
    rvState = null;
  };

  function readFormValues() {
    const out = {};
    ALL_FIELDS.forEach(function (f) {
      const el = document.getElementById('car-f-' + f.key);
      if (!el) return;
      const raw = el.value;
      if (f.type === 'list') {
        out[f.key] = raw.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      } else if (f.type === 'number') {
        out[f.key] = raw.trim() === '' ? null : parseInt(raw, 10);
      } else if (f.type === 'float') {
        out[f.key] = raw.trim() === '' ? null : parseFloat(raw);
      } else {
        out[f.key] = raw.trim() === '' ? null : raw.trim();
      }
    });
    return out;
  }

  window.submitCarForm = async function () {
    if (!currentFormState) return;
    const client = initCarsClient();
    if (!client) return;
    const values = readFormValues();

    if (!values.brand || !values.model || !values.year || !values.horsepower || !values.slug) {
      alert('יש למלא את כל השדות המסומנים בכוכבית (*) לפני השמירה: יצרן, דגם, שנה, הספק, כתובת URL.');
      return;
    }
    if (!values.price && !confirm('לא הוזן מחיר. הרכב יוצג באתר עם "מחיר טרם פורסם". להמשיך?')) return;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(values.slug)) {
      alert('כתובת ה-URL (slug) חייבת להכיל רק אותיות אנגליות קטנות, ספרות ומקפים.');
      return;
    }

    noZeroPrice(values);
    values.image_main = currentFormState.mainPhoto || (currentFormState.photos[0] || null);
    values.gallery_images = currentFormState.photos.slice();
    values.image_cutout = currentFormState.cutout || null;
    if (currentFormState.colorImages) values.color_images = currentFormState.colorImages;

    syncTrimsFromInputs();
    // רק כרטיסים עם שם — כרטיס ריק שנוסף ולא מולא לא נשמר
    values.trims = (currentFormState.trims || []).filter(function (t) { return t && t.name; });
    Object.assign(values, equipmentValues());

    const btn = document.getElementById('car-form-submit-btn');
    const originalText = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = 'שומר...'; }

    try {
      if (currentFormState.mode === 'edit') {
        const { error } = await client.from('cars').update(values).eq('id', currentFormState.carId);
        if (error) { alert('שמירת השינויים נכשלה: ' + error.message); return; }
        alert('✓ הרכב עודכן בהצלחה.');
      } else if (currentFormState.mode === 'update') {
        const { error } = await client.from('cars').update(values).eq('id', currentFormState.carId);
        if (error) { alert('עדכון הרכב נכשל: ' + error.message); return; }
        await client.from('car_drafts').update({ status: 'published', reviewed_at: new Date().toISOString() }).eq('id', currentFormState.draftId);
        delete draftVerifications[currentFormState.draftId];
        alert('✓ הרכב עודכן מהמפרט. עמוד הרכב יתעדכן בריצה הבאה של יצירת הדפים הסטטיים (עד 4 שעות, או הרצה ידנית).');
      } else {
        const newCar = await insertCarFromDraft(values, currentFormState.draftId);
        if (!newCar) return;
      }
      closeCarForm();
      loadCarDrafts();
      loadExistingCars();
    } catch (e) {
      alert('שגיאה בשמירה: ' + (e && e.message ? e.message : e));
      console.error('[cars-admin] submitCarForm חריגה:', e);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
  };

  // ═══════════ רכבים קיימים ═══════════

  let _carsSearchTerm = '';
  let _allCarsCache = [];

  window.filterCarsTable = function (term) {
    _carsSearchTerm = (term || '').trim().toLowerCase();
    renderCarsTable();
  };

  async function loadExistingCars() {
    const client = initCarsClient();
    const list = document.getElementById('cars-existing-list');
    if (!list || !client) return;
    list.innerHTML = '<div class="adm-empty-state">טוען...</div>';
    try {
      const { data, error } = await client.from('cars').select('*').eq('deleted', false).order('created_at', { ascending: false });
      if (error) { list.innerHTML = '<div class="adm-empty-state">שגיאה בטעינת הרכבים: ' + escapeAttr(error.message) + '</div>'; return; }
      _allCarsCache = data || [];
      renderCarsTopViewed();
      renderCarsTable();
      loadReviewStatuses();
    } catch (e) {
      list.innerHTML = '<div class="adm-empty-state">שגיאה בטעינת הרכבים.</div>';
      console.error('[cars-admin] loadExistingCars חריגה:', e);
    }
  }

  function renderCarsTopViewed() {
    const box = document.getElementById('cars-top-viewed-list');
    if (!box) return;
    const top = _allCarsCache.slice().sort(function (a, b) { return (b.views || 0) - (a.views || 0); }).slice(0, 10);
    if (!top.length) { box.innerHTML = '<div class="adm-empty-state">אין עדיין רכבים עם צפיות.</div>'; return; }
    const rankColors = ['#ffd700', '#c0c0c0', '#cd7f32'];
    const maxViews = Math.max(1, top[0].views || 0);
    box.innerHTML = top.map(function (c, i) {
      const rankColor = rankColors[i] || 'var(--adm-surface-2)';
      const rankTextColor = i < 3 ? '#0a0e14' : 'var(--adm-muted)';
      const pct = Math.max(6, Math.round(((c.views || 0) / maxViews) * 100));
      const title = escapeAttr(c.brand + ' ' + c.model + (c.year ? ' ' + c.year : ''));
      return '<div style="display:flex;align-items:center;gap:12px;padding:10px 6px;border-bottom:1px solid var(--adm-border);">' +
        '<span style="font-family:var(--adm-num);font-weight:800;font-size:0.85rem;min-width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:' + rankColor + ';color:' + rankTextColor + ';flex-shrink:0;">' + (i + 1) + '</span>' +
        '<div style="flex:1;min-width:0;cursor:pointer;" onclick="editExistingCar(' + c.id + ')">' +
          '<div style="font-size:0.88rem;font-weight:600;color:var(--adm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + title + '</div>' +
          '<div style="height:4px;border-radius:2px;background:var(--adm-surface-2);margin-top:5px;overflow:hidden;"><div style="height:100%;width:' + pct + '%;background:var(--adm-accent);border-radius:2px;"></div></div>' +
        '</div>' +
        '<span style="font-family:var(--adm-num);font-size:0.85rem;font-weight:700;color:var(--adm-accent);white-space:nowrap;flex-shrink:0;">' + (c.views || 0).toLocaleString('he-IL') + '</span>' +
        '<button class="tbl-btn" onclick="editExistingCar(' + c.id + ')" style="padding:5px 12px;font-size:0.76rem;flex-shrink:0;">ערוך</button>' +
      '</div>';
    }).join('');
  }

  // ═══════════ חוות דעת (01.11.2026) — טבלת car_reviews: עותק עבודה (draft) ועותק מפורסם (published) ═══════════
  // "שמור טיוטה" כותב רק את draft. "פרסם" מעתיק את draft ל-published + מעדכן ב-cars את הציון, היתרונות והחסרונות
  // (העיגול בעמוד הדגם וההשוואה משתמשים בהם). "הסר פרסום" מאפס את published — העמוד חוזר להודעת "בקרוב".
  const RV_CATS_ADMIN = [['comfort', 'נוחות נסיעה'], ['performance', 'ביצועים'], ['consumption', 'צריכת דלק / חשמל'], ['cabin', 'איכות תא הנוסעים'], ['equipment', 'אבזור וטכנולוגיה'], ['safety', 'בטיחות'], ['usability', 'מרווח ושימושיות'], ['value', 'תמורה למחיר']];
  let _reviewsByCar = {};
  let rvState = null;
  async function loadReviewStatuses() {
    const client = initCarsClient(); if (!client) return;
    try {
      const { data, error } = await client.from('car_reviews').select('car_id,draft,published,published_at,updated_at');
      if (error) { console.warn('[cars-admin] car_reviews לא זמינה (הורץ cars-phase3d-reviews.sql?):', error.message); return; }
      _reviewsByCar = {}; (data || []).forEach(function (r) { _reviewsByCar[r.car_id] = r; });
      renderCarsTable();
    } catch (e) { console.warn('[cars-admin] loadReviewStatuses:', e); }
  }
  function reviewStatus(carId) {
    const r = _reviewsByCar[carId];
    if (!r) return { t: 'אין חוות דעת', c: 'var(--adm-muted)' };
    if (!r.published) return { t: 'טיוטה', c: '#e67e22' };
    if (JSON.stringify(r.draft) !== JSON.stringify(r.published)) return { t: 'מפורסמת · יש שינויים בטיוטה', c: '#2980b9' };
    return { t: 'מפורסמת', c: '#27ae60' };
  }
  const RV_CSS = 'width:100%;padding:9px 11px;border-radius:8px;border:1px solid var(--adm-border);background:var(--adm-surface-2);color:var(--adm-text);font-family:var(--font);font-size:0.86rem;';
  function rvField(id, label, val, kind, ph, hint) {
    const v = val == null ? '' : (Array.isArray(val) ? val.join('\n') : String(val));
    const input = kind === 'area' || kind === 'list'
      ? '<textarea id="rv-' + id + '" rows="' + (kind === 'list' ? 4 : 4) + '" placeholder="' + escapeAttr(ph || '') + '" style="' + RV_CSS + 'resize:vertical;">' + escapeHtml(v) + '</textarea>'
      : '<input id="rv-' + id + '" type="' + (kind === 'num' ? 'number' : 'text') + '"' + (kind === 'num' ? ' step="0.1" min="0" max="10"' : '') + ' value="' + escapeAttr(v) + '" placeholder="' + escapeAttr(ph || '') + '" style="' + RV_CSS + '">';
    return '<div class="form-group" style="flex:1;min-width:220px;"><label for="rv-' + id + '">' + escapeAttr(label) + '</label>' + input + (hint ? '<div style="font-size:0.7rem;color:var(--adm-muted);margin-top:2px;">' + escapeAttr(hint) + '</div>' : '') + '</div>';
  }
  function rvImgPicker(id, label, imgs, cur) {
    const opts = [''].concat(imgs);
    return '<div class="form-group" style="flex:1;min-width:260px;"><label>' + escapeAttr(label) + '</label><div style="display:flex;gap:6px;flex-wrap:wrap;">' + opts.map(function (u, i) {
      const on = (cur || '') === u;
      return '<label style="cursor:pointer;width:84px;height:60px;border-radius:8px;overflow:hidden;border:2px solid ' + (on ? 'var(--adm-accent,#ff9d2e)' : 'var(--adm-border)') + ';display:grid;place-items:center;font-size:0.66rem;color:var(--adm-muted);background:var(--adm-surface-2);">' +
        '<input type="radio" name="rv-' + id + '" value="' + escapeAttr(u) + '"' + (on ? ' checked' : '') + ' style="display:none;" onchange="rvPickImg(this)">' +
        (u ? '<img src="' + escapeAttr('https://wsrv.nl/?url=' + encodeURIComponent(u) + '&w=180&output=webp') + '" alt="" style="width:100%;height:100%;object-fit:cover;">' : 'אוטומטי') + '</label>';
    }).join('') + '</div></div>';
  }
  window.rvPickImg = function (el) {
    const group = document.getElementsByName(el.name);
    Array.prototype.forEach.call(group, function (r) { r.parentNode.style.borderColor = r.checked ? 'var(--adm-accent,#ff9d2e)' : 'var(--adm-border)'; });
  };
  function rvFormHtml(car, d) {
    const cats = d.cats || {};
    const imgs = (car.gallery_images || []).slice(); if (car.image_main && imgs.indexOf(car.image_main) === -1) imgs.unshift(car.image_main);
    const st = reviewStatus(car.id), r = _reviewsByCar[car.id];
    return '<div class="form-block"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">' +
        '<h3 style="margin:0;">📝 חוות דעת — ' + escapeAttr(car.brand + ' ' + car.model) + '</h3>' +
        '<span id="rv-status" style="font-size:0.78rem;font-weight:700;color:' + st.c + ';">● ' + escapeAttr(st.t) + (r && r.published_at ? ' · פורסמה ' + new Date(r.published_at).toLocaleDateString('he-IL') : '') + '</span></div>' +
        '<div style="font-size:0.74rem;color:var(--adm-muted);margin-top:6px;">כל שדה ריק פשוט לא מוצג בעמוד. "שמור טיוטה" לא משנה את האתר; "פרסם" מעלה את מה שבטופס לעמוד חוות הדעת.</div></div>' +
      '<div class="form-block"><h3>פתיחה</h3><div class="form-row" style="flex-wrap:wrap;">' +
        rvField('title', 'כותרת (שאלה)', d.title, 'text', 'אז איך ה-' + car.model + ' באמת?', 'ריק = הכותרת שבדוגמה') +
        rvField('score', 'ציון ספידומטר כללי (0-10)', d.score, 'num', '', 'מוצג בעיגול בעמוד הדגם ובחוות הדעת') +
        rvField('author', 'נכתב ע״י', d.author, 'text', 'מערכת ספידומטר') + '</div>' +
        '<div class="form-row">' + rvField('summary', 'סיכום קצר — "אז איך הוא באמת?"', d.summary, 'area', '3-4 שורות: מה הרכב, למי, ומה השורה התחתונה בקצרה') + '</div></div>' +
      '<div class="form-block"><h3>מה אהבנו / מה פחות</h3><div class="form-row" style="flex-wrap:wrap;">' +
        rvField('pros', '✅ מה אהבנו (שורה = פריט)', d.pros, 'list') + rvField('cons', '⛔ מה פחות אהבנו (שורה = פריט)', d.cons, 'list') + '</div></div>' +
      '<div class="form-block"><h3>התרשמות לפי תחומים</h3><div style="font-size:0.72rem;color:var(--adm-muted);margin-bottom:8px;">ציון 0-10 ומשפט קצר. תחום בלי ציון לא מוצג.</div>' +
        RV_CATS_ADMIN.map(function (k) { const x = cats[k[0]] || {}; return '<div class="form-row" style="flex-wrap:wrap;align-items:flex-end;">' +
          '<div class="form-group" style="width:90px;flex:0 0 auto;"><label for="rv-c-' + k[0] + '-s">' + escapeAttr(k[1]) + '</label><input id="rv-c-' + k[0] + '-s" type="number" step="0.1" min="0" max="10" value="' + escapeAttr(x.s == null ? '' : x.s) + '" style="' + RV_CSS + '"></div>' +
          '<div class="form-group" style="flex:1;min-width:220px;"><label for="rv-c-' + k[0] + '-t">משפט קצר</label><input id="rv-c-' + k[0] + '-t" value="' + escapeAttr(x.t || '') + '" style="' + RV_CSS + '"></div></div>'; }).join('') +
        '<div class="form-row" style="margin-top:6px;">' + rvImgPicker('img_cats', 'תמונה לצד התחומים (מומלץ: תא הנוסעים)', imgs, d.img_cats) + '</div></div>' +
      '<div class="form-block"><h3>למי הרכב מתאים?</h3><div class="form-row" style="flex-wrap:wrap;">' +
        rvField('fit_yes', '✅ מתאים ל… (שורה = פריט)', d.fit_yes, 'list') + rvField('fit_no', '⛔ פחות מתאים ל… (שורה = פריט)', d.fit_no, 'list') + '</div>' +
        '<div class="form-row">' + rvImgPicker('img_fit', 'תמונה לכרטיס', imgs, d.img_fit) + '</div></div>' +
      '<div class="form-block"><h3>פסק הדין וקישורים</h3><div class="form-row">' + rvField('verdict', 'השורה התחתונה של ספידומטר', d.verdict, 'area', 'מסקנה עיתונאית ממוקדת: האם שווה את הכסף, ולמי') + '</div>' +
        '<div class="form-row">' + rvField('youtube', 'קישור למבחן הדרכים ביוטיוב', d.youtube != null ? d.youtube : car.youtube_video_url, 'text', 'https://www.youtube.com/watch?v=…') + '</div></div>' +
      '<div class="form-block" style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">' +
        '<button class="btn-secondary" onclick="closeCarForm()">סגור</button>' +
        '<a class="btn-secondary" href="/car/' + encodeURIComponent(car.slug) + '/?view=review" target="_blank" style="text-decoration:none;">צפה בעמוד ↗</a>' +
        (r && r.published ? '<button class="btn-secondary" onclick="saveCarReview(\'unpublish\')" style="color:#e74c3c;">הסר פרסום</button>' : '') +
        '<button class="btn-secondary" id="rv-save-btn" onclick="saveCarReview(\'draft\')">💾 שמור טיוטה</button>' +
        '<button class="btn-primary" id="rv-pub-btn" onclick="saveCarReview(\'publish\')">✓ פרסם</button></div>';
  }
  function rvRead() {
    const v = function (id) { const el = document.getElementById('rv-' + id); return el ? el.value.trim() : ''; };
    const lines = function (id) { return v(id).split('\n').map(function (s) { return s.trim(); }).filter(Boolean); };
    const numv = function (id) { const t = v(id); if (t === '') return null; const n = parseFloat(t); return isNaN(n) ? null : Math.max(0, Math.min(10, Math.round(n * 10) / 10)); };
    const pick = function (n) { const el = document.querySelector('input[name="rv-' + n + '"]:checked'); return el && el.value ? el.value : null; };
    const cats = {};
    RV_CATS_ADMIN.forEach(function (k) { const s = numv('c-' + k[0] + '-s'), t = v('c-' + k[0] + '-t'); if (s != null || t) cats[k[0]] = { s: s, t: t || null }; });
    const out = { title: v('title') || null, score: numv('score'), author: v('author') || null, summary: v('summary') || null, pros: lines('pros'), cons: lines('cons'), cats: cats,
      fit_yes: lines('fit_yes'), fit_no: lines('fit_no'), verdict: v('verdict') || null, youtube: v('youtube') || null, img_cats: pick('img_cats'), img_fit: pick('img_fit') };
    return out;
  }
  window.openReviewEditor = async function (carId) {
    const client = initCarsClient(); if (!client) return;
    const host = document.getElementById('cars-form-host'); if (!host) return;
    host.innerHTML = '<div class="form-block"><div class="adm-empty-state">טוען…</div></div>';
    const [{ data: car }, rvRes] = await Promise.all([client.from('cars').select('*').eq('id', carId).single(), client.from('car_reviews').select('*').eq('car_id', carId).maybeSingle()]);
    if (!car) { host.innerHTML = ''; alert('הרכב לא נמצא.'); return; }
    if (rvRes && rvRes.error) { host.innerHTML = '<div class="form-block"><div class="adm-empty-state" style="color:#e74c3c;">טבלת חוות הדעת לא זמינה: ' + escapeAttr(rvRes.error.message) + '<br>יש להריץ קודם את cars-phase3d-reviews.sql ב-SQL Editor.</div></div>'; return; }
    const row = rvRes && rvRes.data;
    if (row) _reviewsByCar[carId] = row;
    // טיוטה ראשונה: מתחילים מהיתרונות/חסרונות והציון שכבר קיימים ברכב
    const d = row ? (row.draft || {}) : { pros: car.pros || [], cons: car.cons || [], score: car.score != null ? car.score : null };
    rvState = { car: car };
    currentFormState = null;
    host.innerHTML = rvFormHtml(car, d);
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  window.saveCarReview = async function (mode) {
    if (!rvState) return;
    const client = initCarsClient(); if (!client) return;
    const car = rvState.car, d = rvRead(), now = new Date().toISOString();
    if (mode === 'publish') {
      const missing = [];
      if (!d.verdict) missing.push('פסק הדין');
      if (!d.pros.length && !d.cons.length) missing.push('מה אהבנו / מה פחות');
      if (d.score == null) missing.push('ציון כללי');
      if (missing.length && !confirm('חסרים: ' + missing.join(', ') + '.\nלפרסם בכל זאת?')) return;
    }
    if (mode === 'unpublish' && !confirm('להסיר את חוות הדעת מהאתר? הטיוטה נשמרת.')) return;
    const btn = document.getElementById(mode === 'publish' ? 'rv-pub-btn' : 'rv-save-btn'); const t0 = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'שומר…'; }
    try {
      const rec = { car_id: car.id, draft: d, author: d.author, updated_at: now };
      if (mode === 'publish') { rec.published = d; rec.published_at = now; }
      if (mode === 'unpublish') { rec.published = null; rec.published_at = null; }
      const { data: saved, error } = await client.from('car_reviews').upsert(rec, { onConflict: 'car_id' }).select().single();
      if (error) { alert('השמירה נכשלה: ' + error.message); return; }
      _reviewsByCar[car.id] = saved || Object.assign({}, _reviewsByCar[car.id], rec);
      if (mode === 'publish') {
        // הציון, היתרונות והחסרונות משמשים גם בעמוד הדגם ובהשוואה
        const upd = { score: d.score, pros: d.pros, cons: d.cons };
        if (d.youtube && !car.youtube_video_url) upd.youtube_video_url = d.youtube;
        const { error: e2 } = await client.from('cars').update(upd).eq('id', car.id);
        if (e2) alert('חוות הדעת פורסמה, אבל עדכון הציון ברכב נכשל: ' + e2.message);
      }
      const st = reviewStatus(car.id), el = document.getElementById('rv-status');
      if (el) { el.textContent = '● ' + st.t; el.style.color = st.c; }
      alert(mode === 'publish' ? '✓ חוות הדעת פורסמה. היא מופיעה מיד בעמוד הרכב.' : mode === 'unpublish' ? '✓ חוות הדעת הוסרה מהאתר (הטיוטה נשמרה).' : '✓ הטיוטה נשמרה. האתר לא השתנה.');
      if (mode !== 'draft') { rvState = { car: car }; document.getElementById('cars-form-host').innerHTML = rvFormHtml(car, d); }
      renderCarsTable();
    } finally {
      if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = t0; }
    }
  };

  function renderCarsTable() {
    const list = document.getElementById('cars-existing-list');
    if (!list) return;
    const term = _carsSearchTerm;
    const filtered = term
      ? _allCarsCache.filter(function (c) { return ((c.brand || '') + ' ' + (c.model || '')).toLowerCase().indexOf(term) !== -1; })
      : _allCarsCache;
    if (!filtered.length) { list.innerHTML = '<div class="adm-empty-state">' + (term ? 'לא נמצאו רכבים תואמים לחיפוש.' : 'אין עדיין רכבים במאגר.') + '</div>'; return; }
    list.innerHTML = filtered.map(function (c) {
      const thumb = c.image_main ? ('https://wsrv.nl/?url=' + encodeURIComponent(c.image_main) + '&w=140&fit=cover&output=webp&q=65') : '';
      return '<div class="adm-row">' +
        '<div class="adm-row-top">' +
          '<div class="adm-row-thumb" style="background-image:url(\'' + thumb + '\')"></div>' +
          '<div class="adm-row-info">' +
            '<div class="adm-row-title">' + escapeAttr(c.brand + ' ' + c.model) + '</div>' +
            '<div class="adm-row-meta"><span class="adm-cat-pill">' + escapeAttr(c.category || '—') + '</span><span>' + (c.year || '') + '</span><span>₪' + (c.price ? c.price.toLocaleString('he-IL') : '—') + '</span></div>' +
            '<div id="car-check-' + c.id + '">' + personalChecklist(c, c.gallery_images || [], 'car') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="adm-row-bottom">' +
          '<div class="adm-row-views"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' + (c.views || 0) + ' צפיות</div>' +
          '<div class="tbl-actions">' +
            '<a href="/car/' + encodeURIComponent(c.slug) + '/" target="_blank" class="tbl-btn">צפה באתר ↗</a>' +
            '<button class="tbl-btn" style="border-color:var(--adm-accent,#ff9d2e);" onclick="togglePersonalPanel(\'car\',' + c.id + ')">✨ פרטים אישיים</button>' +
            '<button class="tbl-btn" onclick="editExistingCar(' + c.id + ')">ערוך</button>' +
            '<label class="tbl-btn" style="cursor:pointer;" title="מעלים מפרט רשמי — הנתונים מחולצים ומושווים לפני העדכון"><input type="file" accept=".pdf,image/*" style="display:none;" onchange="startCarSpecUpdate(' + c.id + ',this)"> 🔄 עדכן ממפרט</label>' +
            '<button class="tbl-btn" onclick="openReviewEditor(' + c.id + ')" title="' + escapeAttr(reviewStatus(c.id).t) + '">📝 חוות דעת <span style="color:' + reviewStatus(c.id).c + ';">●</span></button>' +
            '<button class="tbl-btn del" onclick="deleteExistingCar(' + c.id + ')">מחק</button>' +
          '</div>' +
          '<div id="car-personal-' + c.id + '" style="width:100%;"></div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  window.deleteExistingCar = async function (carId) {
    if (!confirm('להסיר את הרכב הזה מהאתר? (מחיקה רכה — ניתן לשחזר ידנית דרך מסד הנתונים)')) return;
    const client = initCarsClient();
    if (!client) return;
    try {
      const { error } = await client.from('cars').update({ deleted: true }).eq('id', carId);
      if (error) { alert('מחיקת הרכב נכשלה: ' + error.message); return; }
      loadExistingCars();
    } catch (e) { alert('שגיאה במחיקת הרכב.'); console.error('[cars-admin] deleteExistingCar נכשל:', e); }
  };
})();
