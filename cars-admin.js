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
      { key: 'torque', label: 'מומנט (Nm)', type: 'number' },
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
    { key: 'torque', label: 'מומנט מנוע (Nm)', type: 'number' },
    { key: 'torque_rpm', label: 'סל״ד מומנט', type: 'text' },
    { key: 'fuel_tank', label: 'מיכל דלק (ליטר)', type: 'number' },
    { group: 'ביצועים' },
    { key: 'acceleration_0_100', label: 'תאוצה 0-100 (שנ׳)', type: 'float' },
    { key: 'top_speed', label: 'מהירות מרבית (קמ״ש)', type: 'number' },
    { group: 'מערכת חשמלית / היברידית' },
    { key: 'electric_hp', label: 'הספק מנוע חשמלי (כ״ס)', type: 'number' },
    { key: 'electric_nm', label: 'מומנט מנוע חשמלי (Nm)', type: 'number' },
    { key: 'system_hp', label: 'הספק משולב (כ״ס)', type: 'number' },
    { key: 'system_nm', label: 'מומנט משולב (Nm)', type: 'number' },
    { key: 'boost_hp', label: 'תוספת הספק מייל-היבריד (כ״ס)', type: 'number' },
    { key: 'boost_nm', label: 'תוספת מומנט מייל-היבריד (Nm)', type: 'number' },
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
      list.innerHTML = data.map(renderDraftRow).join('');
    } catch (e) {
      list.innerHTML = '<div class="adm-empty-state">שגיאה בטעינת הטיוטות.</div>';
      console.error('[cars-admin] loadCarDrafts חריגה:', e);
    }
  }

  function renderDraftRow(d) {
    const ex = d.extracted_data;
    const title = ex && ex.brand ? escapeAttr(ex.brand + ' ' + (ex.model || '') + (ex.year ? ' ' + ex.year : '')) : 'טיוטה #' + d.id + ' — עדיין לא חולצו נתונים';
    const photoCount = Array.isArray(d.photo_urls) ? d.photo_urls.length : 0;
    const extractBtn = '<button class="tbl-btn" id="extract-btn-' + d.id + '" onclick="extractDraftSpec(' + d.id + ',this)">🔎 חלץ נתונים</button>';
    const verifyBtn = ex ? '<button class="tbl-btn" id="verify-btn-' + d.id + '" onclick="verifyDraftSpec(' + d.id + ',this)" title="בדיקה אוטומטית מול קובץ המקור">🔍 בדוק מול המקור</button>' : '';
    const editBtn = ex ? '<button class="tbl-btn" onclick="openDraftForm(' + d.id + ')">📝 פתח לעריכה ופרסום</button>' : '';
    return '<div class="adm-row">' +
      '<div class="adm-row-top">' +
        '<div class="adm-row-info">' +
          '<div class="adm-row-title">' + title + '</div>' +
          '<div class="adm-row-meta"><span>📎 קובץ מפרט מועלה</span><span>🖼️ ' + photoCount + ' תמונות</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="adm-row-bottom">' +
        '<div class="tbl-actions">' + extractBtn + verifyBtn + editBtn +
          '<button class="tbl-btn del" onclick="discardCarDraft(' + d.id + ')">✕ מחק טיוטה</button>' +
        '</div>' +
        '<div id="draft-verify-' + d.id + '" style="width:100%;"></div>' +
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
      loadCarDrafts();
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

  function renderDraftVerifyResult(draftId) {
    const resultEl = document.getElementById('draft-verify-' + draftId);
    const result = draftVerifications[draftId];
    if (!resultEl || !result) return;
    if (result.ok) {
      let html = '<div style="font-size:0.78rem;color:#2ecc71;margin-top:6px;font-weight:600;">✓ עברה בדיקה — כל השדות תואמים לקובץ המקור</div>';
      if (result.warnings && result.warnings.length) {
        html += '<div style="font-size:0.74rem;color:var(--adm-muted);margin-top:3px;">הערות (לא חוסמות): ' +
          result.warnings.map(function (w) { return escapeAttr(w.text); }).join(' · ') + '</div>';
      }
      resultEl.innerHTML = html;
    } else {
      const issues = (result.blockingIssues || []).map(function (i) { return '<li>' + escapeAttr(i.category) + ': ' + escapeAttr(i.text) + '</li>'; }).join('');
      resultEl.innerHTML = '<div style="font-size:0.78rem;color:#e74c3c;margin-top:6px;font-weight:600;">✕ נמצאו בעיות — עבור לטופס העריכה כדי לתקן</div>' +
        '<ul style="font-size:0.74rem;color:var(--adm-muted);margin:4px 0 0;padding-inline-start:16px;">' + issues + '</ul>' +
        '<div style="font-size:0.72rem;color:var(--adm-muted);margin-top:4px;">פתח את הטופס לעריכה — ההצעות לתיקון יופיעו ליד כל שדה רלוונטי.</div>';
    }
  }

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
      '<button class="btn-primary" id="car-form-submit-btn" onclick="submitCarForm()">' + (mode === 'edit' ? '✓ שמור שינויים' : '✓ פרסם רכב') + '</button>' +
    '</div>';

    return photosBlock + groupsHtml + trimsBlockHtml() + equipmentBlockHtml() + actionsBlock;
  }

  window.openDraftForm = function (draftId) {
    const client = initCarsClient();
    if (!client) return;
    client.from('car_drafts').select('*').eq('id', draftId).single().then(function (res) {
      const draft = res.data;
      if (!draft) { alert('הטיוטה לא נמצאה.'); return; }
      const data = Object.assign({}, draft.extracted_data || {});
      if (!data.slug && data.brand && data.model) data.slug = slugify(data.brand, data.model, data.year);
      currentFormState = {
        mode: 'draft', draftId: draftId,
        photos: (draft.photo_urls || []).slice(), mainPhoto: (draft.photo_urls || [])[0] || null, cutout: null,
        trims: Array.isArray(data.trims) ? data.trims.slice() : [],
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
        trims: Array.isArray(car.trims) ? car.trims.slice() : [],
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
    host.innerHTML = '<div class="form-block"><h3>' + (mode === 'edit' ? '✏️ עריכת רכב' : '📝 סקירת נתונים ופרסום') + '</h3>' +
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
      } else {
        values.date_added = new Date().toISOString().slice(0, 10);
        const { data: newCar, error } = await client.from('cars').insert(values).select().single();
        if (error) { alert('פרסום הרכב נכשל: ' + error.message + (error.message && error.message.indexOf('duplicate') !== -1 ? '\n\n(ייתכן שכתובת ה-URL הזו כבר בשימוש — בדוק/שנה את ה-slug)' : '')); return; }
        await client.from('car_drafts').update({ status: 'published', published_car_id: newCar.id, reviewed_at: new Date().toISOString() }).eq('id', currentFormState.draftId);
        delete draftVerifications[currentFormState.draftId];
        alert('✓ הרכב פורסם בהצלחה! ייכנס לעמוד /car/' + values.slug + '/ בריצה הבאה של יצירת הדפים הסטטיים (עד 4 שעות, או הרצה ידנית).');
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
          '</div>' +
        '</div>' +
        '<div class="adm-row-bottom">' +
          '<div class="adm-row-views"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' + (c.views || 0) + ' צפיות</div>' +
          '<div class="tbl-actions">' +
            '<a href="/car/' + encodeURIComponent(c.slug) + '/" target="_blank" class="tbl-btn">צפה באתר ↗</a>' +
            '<button class="tbl-btn" onclick="editExistingCar(' + c.id + ')">ערוך</button>' +
            '<button class="tbl-btn" onclick="openReviewEditor(' + c.id + ')" title="' + escapeAttr(reviewStatus(c.id).t) + '">📝 חוות דעת <span style="color:' + reviewStatus(c.id).c + ';">●</span></button>' +
            '<button class="tbl-btn del" onclick="deleteExistingCar(' + c.id + ')">מחק</button>' +
          '</div>' +
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
