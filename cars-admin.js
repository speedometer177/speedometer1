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
      { key: 'price', label: 'מחיר בסיס (₪) *', type: 'number', required: true },
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
  const TRIM_FIELDS = [
    { key: 'name', label: 'שם רמת הגימור *', type: 'text' },
    { key: 'model_code', label: 'קוד דגם', type: 'text' },
    { key: 'drive_type', label: 'סוג הנעה', type: 'text' },
    { key: 'price', label: 'מחיר (₪)', type: 'number' },
    { key: 'horsepower', label: 'הספק (כ"ס)', type: 'number' },
    { key: 'torque', label: 'מומנט (Nm)', type: 'number' },
    { key: 'acceleration_0_100', label: 'תאוצה 0-100 (שניות)', type: 'float' },
    { key: 'top_speed', label: 'מהירות מקסימלית (קמ"ש)', type: 'number' },
    { key: 'range_ev', label: 'טווח חשמלי (ק"מ)', type: 'number' },
    { key: 'battery_capacity_kwh', label: 'קיבולת סוללה (kWh)', type: 'float' },
    { key: 'weight', label: 'משקל (ק"ג)', type: 'number' },
    { key: 'safety_rating', label: 'דירוג/מדד בטיחות', type: 'text' },
    { key: 'notable_features', label: 'תכונות ייחודיות לרמה זו (שורה=פריט)', type: 'list' },
  ];

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
    if (f.type === 'textarea' || f.type === 'list') {
      const rows = f.type === 'list' ? 4 : 3;
      inputHtml = '<textarea id="car-f-' + f.key + '" rows="' + rows + '" placeholder="' + escapeAttr(f.placeholder || '') + '" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--adm-border);background:var(--adm-surface-2);color:var(--adm-text);font-family:var(--font);font-size:0.88rem;resize:vertical;">' + escapeHtml(val) + '</textarea>';
    } else {
      const inputType = (f.type === 'number' || f.type === 'float') ? 'number' : 'text';
      const step = f.type === 'float' ? ' step="0.1"' : '';
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

  function trimFieldInputHtml(idx, f, value) {
    const id = 'car-trim-' + idx + '-' + f.key;
    const val = fieldValueToInputString(f.type, value);
    if (f.type === 'list') {
      return '<div class="form-group" style="min-width:200px;flex:1;"><label for="' + id + '">' + escapeAttr(f.label) + '</label>' +
        '<textarea id="' + id + '" rows="2" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--adm-border);background:var(--adm-surface-2);color:var(--adm-text);font-family:var(--font);font-size:0.84rem;resize:vertical;">' + escapeHtml(val) + '</textarea></div>';
    }
    const inputType = (f.type === 'number' || f.type === 'float') ? 'number' : 'text';
    const step = f.type === 'float' ? ' step="0.1"' : '';
    return '<div class="form-group" style="min-width:150px;flex:1;"><label for="' + id + '">' + escapeAttr(f.label) + '</label>' +
      '<input type="' + inputType + '" id="' + id + '"' + step + ' value="' + escapeAttr(val) + '" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--adm-border);background:var(--adm-surface-2);color:var(--adm-text);font-family:var(--font);font-size:0.84rem;"></div>';
  }

  function buildTrimCardHtml(trim, idx) {
    const fieldsHtml = TRIM_FIELDS.map(function (f) { return trimFieldInputHtml(idx, f, trim ? trim[f.key] : null); }).join('');
    return '<div class="form-block" style="background:var(--adm-surface-2);margin-bottom:10px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
        '<strong style="font-size:0.85rem;">רמת גימור ' + (idx + 1) + '</strong>' +
        '<button type="button" class="tbl-btn del" onclick="removeCarTrim(' + idx + ')">✕ הסר רמת גימור</button>' +
      '</div>' +
      '<div class="form-row" style="flex-wrap:wrap;">' + fieldsHtml + '</div>' +
    '</div>';
  }

  function renderTrimsListHtml() {
    const trims = (currentFormState && currentFormState.trims) || [];
    if (!trims.length) {
      return '<div class="adm-empty-state" style="padding:10px;">אין רמות גימור נוספות מוגדרות. השדות למעלה (הספק, משקל וכו׳) הם תמיד של רמת הגימור הבסיסית — הוסף כאן רק אם גיליון המפרט מציג עוד רמות גימור עם ערכים שונים (למשל FWD מול AWD).</div>';
    }
    return trims.map(buildTrimCardHtml).join('');
  }

  function trimsBlockHtml() {
    return '<div class="form-block"><h3>רמות גימור נוספות (אופציונלי)</h3>' +
      '<div id="car-trims-list">' + renderTrimsListHtml() + '</div>' +
      '<button type="button" class="btn-secondary" style="margin-top:8px;" onclick="addCarTrim()">➕ הוסף רמת גימור</button>' +
    '</div>';
  }

  function readTrimCard(idx) {
    const out = {};
    TRIM_FIELDS.forEach(function (f) {
      const el = document.getElementById('car-trim-' + idx + '-' + f.key);
      if (!el) return;
      const raw = el.value;
      if (f.type === 'list') out[f.key] = raw.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      else if (f.type === 'number') out[f.key] = raw.trim() === '' ? null : parseInt(raw, 10);
      else if (f.type === 'float') out[f.key] = raw.trim() === '' ? null : parseFloat(raw);
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
    '</div>';

    const actionsBlock = '<div class="form-block" style="display:flex;gap:12px;justify-content:flex-end;">' +
      '<button class="btn-secondary" onclick="closeCarForm()">ביטול</button>' +
      '<button class="btn-primary" id="car-form-submit-btn" onclick="submitCarForm()">' + (mode === 'edit' ? '✓ שמור שינויים' : '✓ פרסם רכב') + '</button>' +
    '</div>';

    return photosBlock + groupsHtml + trimsBlockHtml() + actionsBlock;
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
        photos: (draft.photo_urls || []).slice(), mainPhoto: (draft.photo_urls || [])[0] || null,
        trims: Array.isArray(data.trims) ? data.trims.slice() : [],
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
        photos: (car.gallery_images || []).slice(), mainPhoto: car.image_main || null,
        trims: Array.isArray(car.trims) ? car.trims.slice() : [],
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

    if (!values.brand || !values.model || !values.year || !values.price || !values.horsepower || !values.slug) {
      alert('יש למלא את כל השדות המסומנים בכוכבית (*) לפני השמירה: יצרן, דגם, שנה, מחיר, הספק, כתובת URL.');
      return;
    }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(values.slug)) {
      alert('כתובת ה-URL (slug) חייבת להכיל רק אותיות אנגליות קטנות, ספרות ומקפים.');
      return;
    }

    values.image_main = currentFormState.mainPhoto || (currentFormState.photos[0] || null);
    values.gallery_images = currentFormState.photos.slice();

    syncTrimsFromInputs();
    // רק כרטיסים עם שם — כרטיס ריק שנוסף ולא מולא לא נשמר
    values.trims = (currentFormState.trims || []).filter(function (t) { return t && t.name; });

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
