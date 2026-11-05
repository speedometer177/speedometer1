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
    { key: 'turning_circle', label: 'קוטר סיבוב (מטר)', type: 'float' },
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
    document.querySelectorAll('.cars-subtab').forEach(function (b) { b.classList.remove('active'); });
    if (el) el.classList.add('active');
    const newPanel = document.getElementById('cars-new-panel');
    const listPanel = document.getElementById('cars-list-panel');
    if (newPanel) newPanel.style.display = tab === 'new' ? '' : 'none';
    if (listPanel) listPanel.style.display = tab === 'list' ? '' : 'none';
    const formHost = document.getElementById('cars-form-host');
    if (formHost) formHost.innerHTML = ''; // סוגרים טופס פתוח בכל מעבר טאב
    if (tab === 'new') loadCarDrafts(); else loadExistingCars();
  };

  if (typeof window.adminTab === 'function' && !window.__carsAdminTabWrapped) {
    const prevAdminTab = window.adminTab;
    window.adminTab = function (tab, btnEl) {
      prevAdminTab(tab, btnEl);
      const panel = document.getElementById('admin-cars');
      if (!panel) return;
      panel.style.display = tab === 'cars' ? '' : 'none';
      if (tab === 'cars') loadCarDrafts();
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
    const extractBtn = '<button class="tbl-btn" id="extract-btn-' + d.id + '" onclick="extractDraftSpec(' + d.id + ',this)">🔎 חלץ נתונים</button>';
    const verifyBtn = ex ? '<button class="tbl-btn" id="verify-btn-' + d.id + '" onclick="verifyDraftSpec(' + d.id + ',this)" title="בדיקה אוטומטית מול קובץ המקור">🔍 בדוק מול המקור</button>' : '';
    const editBtn = ex ? '<button class="tbl-btn" onclick="openDraftForm(' + d.id + ')">' + (d.published_car_id ? '🔄 השוואה ועדכון הרכב' : '📝 עריכה מלאה') + '</button>' : '';
    const isNew = ex && !d.published_car_id;
    const personalBtn = isNew ? '<button class="tbl-btn" style="border-color:var(--adm-accent,#ff9d2e);" onclick="togglePersonalPanel(\'draft\',' + d.id + ')">✨ פרטים אישיים</button>' : '';
    const publishBtn = isNew ? '<button class="tbl-btn" id="publish-btn-' + d.id + '" style="background:var(--adm-accent,#ff9d2e);color:#0a0e14;font-weight:700;" onclick="publishDraftDirect(' + d.id + ',this)">🚀 פרסם</button>' : '';
    return '<div class="adm-row">' +
      '<div class="adm-row-top">' +
        '<div class="adm-row-info">' +
          '<div class="adm-row-title">' + title + '</div>' +
          '<div class="adm-row-meta"><span>📎 קובץ מפרט מועלה</span><span>🖼️ ' + photoCount + ' תמונות</span>' + (ex && Array.isArray(ex.trims) && ex.trims.length ? '<span>🧩 ' + ex.trims.length + ' גרסאות</span>' : '') + '</div>' +
          (isNew ? '<div id="draft-check-' + d.id + '">' + personalChecklist(ex, d.photo_urls || [], 'draft') + '</div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="adm-row-bottom">' +
        '<div class="tbl-actions">' + personalBtn + extractBtn + verifyBtn + editBtn + publishBtn +
          '<button class="tbl-btn del" onclick="discardCarDraft(' + d.id + ')">✕ מחק טיוטה</button>' +
        '</div>' +
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
      highlights: JSON.parse(JSON.stringify(Array.isArray(src.highlights) ? src.highlights.filter(function (h) { return h && h.title; }) : [])),
    };
    renderPersonal();
  };
  function pHost() { return pState ? document.getElementById((pState.kind === 'draft' ? 'draft-personal-' : 'car-personal-') + pState.id) : null; }
  function pReadInputs() {
    if (!pState) return;
    P_TEXT.forEach(function (p) {
      const el = document.getElementById('p-f-' + p.key); if (!el) return;
      const raw = el.value;
      if (p.type === 'list') pState.f[p.key] = raw.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
      else if (p.type === 'number') { const n = parseInt(String(raw).replace(/[^\d]/g, ''), 10); pState.f[p.key] = raw.trim() === '' || isNaN(n) ? null : n; }
      else if (p.type === 'float') { const n = parseFloat(raw); pState.f[p.key] = raw.trim() === '' || isNaN(n) ? null : n; }
      else pState.f[p.key] = raw.trim() === '' ? null : raw.trim();
    });
  }
  function renderPersonal(msg) {
    const host = pHost(); if (!host || !pState) return;
    const s = pState;
    const photosHtml = s.photos.length ? '<div style="display:flex;flex-wrap:wrap;gap:8px;">' + s.photos.map(function (u, i) {
      const on = u === s.main;
      return '<div style="width:96px;">' +
        '<button type="button" onclick="pSetMain(' + i + ')" title="קבע כתמונה ראשית" style="display:block;padding:0;border:2px solid ' + (on ? 'var(--adm-accent,#ff9d2e)' : 'transparent') + ';border-radius:8px;background:none;cursor:pointer;">' +
        '<img src="' + escapeAttr(u) + '" alt="" style="width:92px;height:66px;object-fit:cover;border-radius:6px;display:block;"></button>' +
        '<div style="display:flex;gap:2px;margin-top:2px;"><button type="button" class="tbl-btn" style="flex:1;padding:2px;font-size:0.62rem;" onclick="pSetMain(' + i + ')">' + (on ? '★ ראשית' : '☆') + '</button>' +
        '<button type="button" class="tbl-btn del" style="padding:2px 6px;font-size:0.62rem;" title="הסר" onclick="pRemovePhoto(' + i + ')">✕</button></div></div>';
    }).join('') + '</div>' : '<div class="adm-empty-state" style="padding:8px;">אין תמונות עדיין</div>';
    const cutHtml = '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">' +
      '<div style="width:220px;aspect-ratio:16/10;border-radius:8px;background:repeating-conic-gradient(#e5e7eb 0 25%,#fff 0 50%) 0 0/16px 16px;display:grid;place-items:center;overflow:hidden;">' +
        (s.cutout ? '<img src="' + escapeAttr(s.cutout) + '" alt="" style="max-width:94%;max-height:90%;object-fit:contain;">' : '<span style="font-size:0.72rem;color:#6b7280;">אין עדיין</span>') + '</div>' +
      '<div style="display:flex;flex-direction:column;gap:6px;">' +
        '<label class="tbl-btn" style="cursor:pointer;" title="הכי מדויק: קובץ המקור ברזולוציה מלאה"><input type="file" accept="image/*" style="display:none;" onchange="pCutoutFromFile(this)">✂️ הסר רקע מקובץ במחשב (מומלץ)</label>' +
        (s.main ? '<button type="button" class="tbl-btn" onclick="pCutoutFromMain()">✂️ הסר רקע מהתמונה הראשית</button>' : '') +
        '<label class="tbl-btn" style="cursor:pointer;"><input type="file" accept="image/png,image/webp" style="display:none;" onchange="pUploadReadyCutout(this)">⬆️ העלה PNG שקוף מוכן</label>' +
        (s.cutout ? '<button type="button" class="tbl-btn del" onclick="pRemoveCutout()">הסר</button>' : '') +
      '</div></div>';
    const inCss = 'width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--adm-border);background:var(--adm-surface-2);color:var(--adm-text);font-family:var(--font);font-size:0.85rem;';
    const fieldsHtml = P_TEXT.map(function (p) {
      const v = s.f[p.key];
      const val = v === null || v === undefined ? '' : (Array.isArray(v) ? v.join('\n') : String(v));
      const input = (p.type === 'textarea' || p.type === 'list')
        ? '<textarea id="p-f-' + p.key + '" rows="' + (p.type === 'list' ? 4 : 3) + '" style="' + inCss + 'resize:vertical;">' + escapeHtml(val) + '</textarea>'
        : '<input id="p-f-' + p.key + '" type="' + (p.type === 'float' ? 'number' : 'text') + '"' + (p.type === 'float' ? ' step="0.1" min="0" max="10"' : p.type === 'number' ? ' inputmode="numeric" placeholder="למשל 189,990"' : '') + ' value="' + escapeAttr(p.type === 'number' && val ? Number(val).toLocaleString('en-US') : val) + '" style="' + inCss + '">';
      const wide = p.type === 'textarea' || p.type === 'list';
      return '<div class="form-group" style="flex:' + (wide ? '1 1 100%' : '1 1 180px') + ';min-width:' + (wide ? '240' : '160') + 'px;"><label for="p-f-' + p.key + '">' + escapeAttr(p.label) + '</label>' + input +
        (p.hint ? '<div style="font-size:0.68rem;color:var(--adm-muted);margin-top:2px;">' + escapeAttr(p.hint) + '</div>' : '') + '</div>';
    }).join('');
    const hlHtml = s.highlights.length ? s.highlights.map(function (h, i) {
      return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--adm-border);">' +
        '<div style="width:72px;height:48px;border-radius:6px;background:var(--adm-surface-2);overflow:hidden;flex:none;display:grid;place-items:center;">' +
          (h.image ? '<img src="' + escapeAttr(h.image) + '" alt="" style="width:100%;height:100%;object-fit:cover;">' : '<span style="font-size:0.62rem;color:var(--adm-muted);">אין תמונה</span>') + '</div>' +
        '<div style="flex:1;font-size:0.8rem;">' + escapeHtml(h.title) + '</div>' +
        '<label class="tbl-btn" style="cursor:pointer;"><input type="file" accept="image/*" style="display:none;" onchange="pHighlightImage(this,' + i + ')">' + (h.image ? 'החלף' : '⬆️ תמונה') + '</label>' +
        (h.image ? '<button type="button" class="tbl-btn del" onclick="pHighlightImageRemove(' + i + ')">✕</button>' : '') + '</div>';
    }).join('') : '<div style="font-size:0.75rem;color:var(--adm-muted);">אין פריטי אבזור בולטים (נבחרים אוטומטית מהמפרט בזמן החילוץ).</div>';
    host.innerHTML = '<div class="form-block" style="margin-top:10px;background:var(--adm-surface-2);">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;"><strong style="font-size:0.9rem;">✨ פרטים אישיים — מה שלא מגיע מהמפרט</strong>' +
        '<button type="button" class="tbl-btn" onclick="togglePersonalPanel(\'' + s.kind + '\',' + s.id + ')">סגור ✕</button></div>' +
      '<div style="display:grid;gap:14px;">' +
        '<div><div style="font-size:0.78rem;font-weight:700;margin-bottom:6px;">תמונות — לחץ על תמונה כדי לקבוע אותה כראשית</div>' + photosHtml +
          '<label class="tbl-btn" style="cursor:pointer;display:inline-block;margin-top:8px;"><input type="file" accept="image/*" multiple style="display:none;" onchange="pAddPhotos(this)">➕ הוסף תמונות</label></div>' +
        '<div><div style="font-size:0.78rem;font-weight:700;margin-bottom:6px;">תמונה ראשית ללא רקע</div>' + cutHtml +
          '<div style="font-size:0.7rem;color:var(--adm-muted);margin-top:6px;">נפתח חלון של כלי הסרת הרקע. המודל רץ במחשב שלך; בפעם הראשונה הוא יורד (כ-180MB) ואחר כך נשמר בדפדפן. בכלי אפשר לתקן במברשת לפני השמירה.</div></div>' +
        '<div class="form-row" style="flex-wrap:wrap;">' + fieldsHtml + '</div>' +
        '<div><div style="font-size:0.78rem;font-weight:700;margin-bottom:4px;">תמונות לפריטי האבזור הבולטים (עמוד "אבזור")</div>' + hlHtml + '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:12px;flex-wrap:wrap;">' +
        '<span id="p-msg" style="font-size:0.78rem;color:var(--adm-muted);">' + (msg || '') + '</span>' +
        '<button type="button" class="btn-primary" id="p-save" onclick="savePersonal()">💾 שמור</button>' +
      '</div></div>';
  }
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
      ev.source.postMessage({ type: 'sp-cutout-src', reqId: cutoutReq.reqId, url: s.url || null, blob: s.blob || null, name: s.name || 'car' }, location.origin);
    } else if (ev.data.type === 'sp-cutout-result' && ev.data.reqId === cutoutReq.reqId && ev.data.blob) {
      const r = cutoutReq; cutoutReq = null; r.resolve(ev.data.blob);
    }
  });
  async function pRunCutout(src) {
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
      st.cutout = url;
      renderPersonal('✓ התמונה ללא רקע עלתה — לחץ "שמור"');
    } catch (e) { pMsg('<span style="color:#e74c3c;">✕ ' + escapeAttr(e && e.message ? e.message : e) + '</span>'); }
  }
  window.pCutoutFromFile = function (input) { const f = input.files && input.files[0]; input.value = ''; if (f) pRunCutout({ blob: f, name: f.name }); };
  window.pCutoutFromMain = function () { if (pState && pState.main) pRunCutout({ url: pState.main, name: 'main' }); };
  window.pUploadReadyCutout = async function (input) {
    const file = input.files && input.files[0]; input.value = ''; if (!file || !pState) return;
    if (!/^image\/(png|webp)$/.test(file.type)) { alert('יש להעלות PNG או WebP עם רקע שקוף.'); return; }
    if (file.size > 6 * 1024 * 1024) { alert('הקובץ גדול מ-6MB.'); return; }
    pReadInputs(); pMsg('מעלה…');
    try { pState.cutout = await uploadCutoutBlob(file); renderPersonal('✓ עלה — לחץ "שמור"'); } catch (e) { pMsg('<span style="color:#e74c3c;">✕ ' + escapeAttr(e.message) + '</span>'); }
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
    const patch = Object.assign({}, s.f, { image_main: s.main || null, image_cutout: s.cutout || null, highlights: s.highlights });
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
        const ex = Object.assign({}, d.extracted_data || {}, patch);
        const photos = s.photos.slice();
        if (s.main) { photos.splice(photos.indexOf(s.main), 1); photos.unshift(s.main); } // הראשית ראשונה
        const { error } = await client.from('car_drafts').update({ extracted_data: ex, photo_urls: photos }).eq('id', s.id);
        if (error) throw new Error(error.message);
        d.extracted_data = ex; d.photo_urls = photos;
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
    if (pf) {
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
    return '<li style="list-style:none;border:1px solid var(--adm-border);border-inline-start:3px solid ' + color + ';border-radius:8px;padding:8px 10px;margin-top:6px;">' +
      '<div style="font-size:0.76rem;"><b style="color:' + color + ';">' + escapeHtml(it.category || '') + '</b> · ' + escapeHtml(it.text || '') + '</div>' + fix + '</li>';
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
    values.torque = exTorqueKgm(ex);
    values.trims = trimsToKgm(ex.trims).filter(function (t) { return t && t.name; });
    const eq = ex.equipment || {};
    values.equipment = { base_name: eq.base_name || null, groups: Array.isArray(eq.groups) ? eq.groups : [], packages: Array.isArray(eq.packages) ? eq.packages : [] };
    values.highlights = (Array.isArray(ex.highlights) ? ex.highlights : []).map(function (h) { return typeof h === 'string' ? { title: h, image: null } : h; }).filter(function (h) { return h && h.title; }).slice(0, 6);
    return values;
  }
  // שמירה של רכב חדש מטיוטה — משותף לטופס העריכה ולפרסום הישיר
  async function insertCarFromDraft(values, draftId) {
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
    const file = input.files && input.files[0];
    if (!file || !currentFormState) return;
    if (!/^image\/(png|webp)$/.test(file.type)) { alert('יש להעלות PNG או WebP עם רקע שקוף.'); input.value = ''; return; }
    if (file.size > 6 * 1024 * 1024) { alert('הקובץ גדול מ-6MB. יש להקטין אותו לפני ההעלאה.'); input.value = ''; return; }
    const client = initCarsClient();
    if (!client) return;
    const host = document.getElementById('car-cutout-preview');
    if (host) host.innerHTML = '<div style="font-size:0.78rem;color:var(--adm-muted);">מעלה…</div>';
    const ext = file.type === 'image/png' ? 'png' : 'webp';
    const path = 'cutouts/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    const { error } = await client.storage.from(PHOTOS_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) { console.error('[cars-admin] העלאת תמונה מבודדת נכשלה:', error); alert('ההעלאה נכשלה: ' + error.message); if (host) host.innerHTML = cutoutPreviewHtml(currentFormState.cutout); return; }
    const { data } = client.storage.from(PHOTOS_BUCKET).getPublicUrl(path);
    currentFormState.cutout = data && data.publicUrl ? data.publicUrl : null;
    if (host) host.innerHTML = cutoutPreviewHtml(currentFormState.cutout);
    input.value = '';
  };
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
          '<input type="file" accept="image/png,image/webp" style="display:none;" onchange="uploadCarCutout(this)">⬆️ העלאת תמונה מבודדת' +
        '</label>' +
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
      photos: photos, mainPhoto: car.image_main || photos[0] || null, cutout: car.image_cutout || null,
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
        photos: (draft.photo_urls || []).slice(), mainPhoto: data.image_main || (draft.photo_urls || [])[0] || null, cutout: data.image_cutout || null,
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
        photos: (car.gallery_images || []).slice(), mainPhoto: car.image_main || null, cutout: car.image_cutout || null,
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

    values.image_main = currentFormState.mainPhoto || (currentFormState.photos[0] || null);
    values.gallery_images = currentFormState.photos.slice();
    values.image_cutout = currentFormState.cutout || null;

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
