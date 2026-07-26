/*
 * news.js — מרכז חדשות רכב אוטומטי — ספידומטר
 * ---------------------------------------------------------------
 * קובץ עצמאי לחלוטין, לא נוגע ב-app.js או ב-ads.js.
 * להשבתה מלאה: הסר את שורת <script src="/news.js" defer> מ-index.html.
 *
 * מה זה עושה:
 *   1. "רענן חדשות" — קורא ל-Edge Function fetch-car-news שמביאה
 *      כותרות RSS טריות ממקורות רכב ישראליים ועולמיים.
 *   2. "כתוב כתבה" על כותרת — קורא ל-Edge Function draft-news-article
 *      שכותבת טיוטה מלאה (Gemini) בסגנון הקבוע של האתר.
 *   3. "כתבות מוכנות" — טוען טיוטה לתוך טופס "כתבה חדשה" הרגיל,
 *      כדי שתעבור בדיקה ידנית ותפורסם דרך אותו נתיב פרסום קיים ובדוק.
 * ---------------------------------------------------------------
 */
(function () {
  'use strict';

  const SB_URL = 'https://kaykrrnmykqrfhawgtqt.supabase.co';
  const SB_KEY = 'sb_publishable_Ms6YFTnADm-qAd9617Ey9A_D3x-Zumi';
  const EDGE_BASE = SB_URL + '/functions/v1';
  let newsClient = null;

  const REGION_LABELS = { il: 'ישראל', world: 'עולם' };

  function escapeAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function initNewsClient() {
    if (newsClient) return newsClient;
    // עדיפות ראשונה תמיד: אותו client מאומת שכבר קיים ב-app.js
    if (window.sbClient) { newsClient = window.sbClient; return newsClient; }
    if (window.supabase) {
      try { newsClient = window.supabase.createClient(SB_URL, SB_KEY); } catch (e) { console.error('[news.js] יצירת חיבור נכשלה:', e); }
    }
    return newsClient;
  }

  async function getAuthToken() {
    const client = initNewsClient();
    if (!client) return null;
    try {
      const { data } = await client.auth.getSession();
      return data && data.session ? data.session.access_token : null;
    } catch (e) { return null; }
  }

  // ═══════════ ניהול טאבים ═══════════

  window.newsSubTab = function (tab, el) {
    document.querySelectorAll('.news-subtab').forEach(function (b) { b.classList.remove('active'); });
    if (el) el.classList.add('active');
    const headlinesPanel = document.getElementById('news-headlines-panel');
    const draftsPanel = document.getElementById('news-drafts-panel');
    if (headlinesPanel) headlinesPanel.style.display = tab === 'headlines' ? '' : 'none';
    if (draftsPanel) draftsPanel.style.display = tab === 'drafts' ? '' : 'none';
    if (tab === 'headlines') loadHeadlines(); else loadDrafts();
  };

  // עוטפים את adminTab הקיים (שכבר עטוף פעם אחת על ידי ads.js) כדי להוסיף
  // תמיכה בלשונית 'news', באותו דפוס עדין שכבר נוהג באתר.
  if (typeof window.adminTab === 'function' && !window.__newsAdminTabWrapped) {
    const prevAdminTab = window.adminTab;
    window.adminTab = function (tab, btnEl) {
      prevAdminTab(tab, btnEl);
      const newsPanel = document.getElementById('admin-news');
      if (!newsPanel) return;
      newsPanel.style.display = tab === 'news' ? '' : 'none';
      if (tab === 'news') loadHeadlines();
    };
    window.__newsAdminTabWrapped = true;
  }

  // ═══════════ כותרות (RSS) ═══════════

  window.refreshCarNews = async function (btn) {
    const client = initNewsClient();
    if (!client) { alert('אין חיבור לשרת — נסה לרענן את הדף.'); return; }
    const token = await getAuthToken();
    if (!token) { alert('יש להתחבר לניהול קודם.'); return; }
    const originalText = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = 'מרענן...'; }
    try {
      const res = await fetch(EDGE_BASE + '/fetch-car-news', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      if (!res.ok) {
        alert('שגיאה ברענון החדשות: ' + (json.error || 'שגיאה לא ידועה'));
        console.error('[news.js] fetch-car-news נכשל:', json);
        return;
      }
      loadHeadlines();
    } catch (e) {
      alert('שגיאה ברענון החדשות. ודא שה-Edge Function פרוסה כראוי.');
      console.error('[news.js] fetch-car-news חריגה:', e);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
  };

  async function loadHeadlines() {
    const client = initNewsClient();
    const list = document.getElementById('news-headlines-list');
    if (!list || !client) return;
    list.innerHTML = '<div class="adm-empty-state">טוען...</div>';
    try {
      const { data, error } = await client.from('news_headlines').select('*').order('fetched_at', { ascending: false }).limit(150);
      if (error) { list.innerHTML = '<div class="adm-empty-state">שגיאה בטעינת הכותרות: ' + escapeAttr(error.message) + '</div>'; console.error('[news.js] טעינת כותרות נכשלה:', error); return; }
      if (!data || !data.length) { list.innerHTML = '<div class="adm-empty-state">אין כותרות עדיין — לחץ "רענן חדשות" למעלה.</div>'; return; }
      list.innerHTML = data.map(function (h) {
        const regionPill = '<span class="adm-cat-pill">' + (REGION_LABELS[h.region] || h.region) + '</span>';
        let statusBadge = '';
        if (h.status === 'drafted') statusBadge = '<span class="adm-badge-active">נכתבה טיוטה</span>';
        else if (h.status === 'dismissed') statusBadge = '<span class="adm-badge-inactive">נדחה</span>';
        const writeBtn = h.status === 'drafted'
          ? ''
          : '<button class="tbl-btn" onclick="writeNewsDraft(' + h.id + ',this)">✍️ כתוב כתבה</button>';
        return '<div class="adm-row">' +
          '<div class="adm-row-top">' +
            '<div class="adm-row-info">' +
              '<div class="adm-row-title">' + escapeAttr(h.title) + ' ' + statusBadge + '</div>' +
              '<div class="adm-row-meta">' + regionPill + '<span>' + escapeAttr(h.source_name) + '</span></div>' +
            '</div>' +
          '</div>' +
          '<div class="adm-row-bottom">' +
            '<a href="' + escapeAttr(h.source_url) + '" target="_blank" rel="noopener" class="tbl-btn">מקור ↗</a>' +
            '<div class="tbl-actions">' + writeBtn +
              '<button class="tbl-btn del" onclick="dismissHeadline(' + h.id + ')">✕ דחה</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    } catch (e) {
      list.innerHTML = '<div class="adm-empty-state">שגיאה בטעינת הכותרות.</div>';
      console.error('[news.js] loadHeadlines חריגה:', e);
    }
  }

  window.writeNewsDraft = async function (headlineId, btn) {
    const client = initNewsClient();
    if (!client) return;
    const token = await getAuthToken();
    if (!token) { alert('יש להתחבר לניהול קודם.'); return; }
    const originalText = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = 'כותב...'; }
    try {
      const res = await fetch(EDGE_BASE + '/draft-news-article', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ headline_id: headlineId }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert('שגיאה בכתיבת הכתבה: ' + (json.error || 'שגיאה לא ידועה'));
        console.error('[news.js] draft-news-article נכשל:', json);
        return;
      }
      alert('הטיוטה נכתבה בהצלחה! עבור ללשונית "כתבות מוכנות" כדי לבדוק ולפרסם.');
      loadHeadlines();
    } catch (e) {
      alert('שגיאה בכתיבת הכתבה. ודא שה-Edge Function פרוסה, ושמפתח GEMINI_API_KEY מוגדר.');
      console.error('[news.js] writeNewsDraft חריגה:', e);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
  };

  window.dismissHeadline = async function (headlineId) {
    const client = initNewsClient();
    if (!client) return;
    try {
      await client.from('news_headlines').update({ status: 'dismissed' }).eq('id', headlineId);
      loadHeadlines();
    } catch (e) { alert('שגיאה בדחיית הכותרת.'); console.error('[news.js] dismissHeadline נכשל:', e); }
  };

  // ═══════════ כתבות מוכנות (טיוטות) ═══════════

  async function loadDrafts() {
    const client = initNewsClient();
    const list = document.getElementById('news-drafts-list');
    if (!list || !client) return;
    list.innerHTML = '<div class="adm-empty-state">טוען...</div>';
    try {
      const { data, error } = await client.from('news_drafts').select('*').eq('status', 'pending').order('created_at', { ascending: false });
      if (error) { list.innerHTML = '<div class="adm-empty-state">שגיאה בטעינת הטיוטות: ' + escapeAttr(error.message) + '</div>'; console.error('[news.js] טעינת טיוטות נכשלה:', error); return; }
      if (!data || !data.length) { list.innerHTML = '<div class="adm-empty-state">אין טיוטות ממתינות — עבור ל"כותרות" ולחץ "כתוב כתבה".</div>'; return; }
      list.innerHTML = data.map(function (d) {
        const regionPill = '<span class="adm-cat-pill">' + (REGION_LABELS[d.region] || d.region) + '</span>';
        return '<div class="adm-row">' +
          '<div class="adm-row-top">' +
            '<div class="adm-row-info">' +
              '<div class="adm-row-title">' + escapeAttr(d.headline) + '</div>' +
              '<div class="adm-row-meta">' + regionPill + '<span>' + escapeAttr(d.source_name || '') + '</span></div>' +
            '</div>' +
          '</div>' +
          '<div class="adm-row-bottom">' +
            '<div style="font-size:0.78rem;color:var(--adm-muted);flex:1;min-width:150px;">' + escapeAttr((d.subheadline || '').slice(0, 90)) + '</div>' +
            '<div class="tbl-actions">' +
              '<button class="tbl-btn" onclick="loadDraftIntoForm(' + d.id + ')">📝 טען לעריכה ופרסום</button>' +
              '<button class="tbl-btn del" onclick="discardDraft(' + d.id + ')">✕ מחק טיוטה</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    } catch (e) {
      list.innerHTML = '<div class="adm-empty-state">שגיאה בטעינת הטיוטות.</div>';
      console.error('[news.js] loadDrafts חריגה:', e);
    }
  }

  window.discardDraft = async function (draftId) {
    if (!confirm('למחוק את הטיוטה הזו לצמיתות?')) return;
    const client = initNewsClient();
    if (!client) return;
    try {
      await client.from('news_drafts').update({ status: 'discarded' }).eq('id', draftId);
      loadDrafts();
    } catch (e) { alert('שגיאה במחיקת הטיוטה.'); console.error('[news.js] discardDraft נכשל:', e); }
  };

  window.loadDraftIntoForm = async function (draftId) {
    const client = initNewsClient();
    if (!client) return;
    try {
      const { data: draft, error } = await client.from('news_drafts').select('*').eq('id', draftId).single();
      if (error || !draft) { alert('שגיאה בטעינת הטיוטה.'); return; }

      // עוברים ללשונית "כתבה חדשה" ומאכלסים את הטופס הרגיל
      const newTabBtn = document.querySelector('.admin-tab[onclick*="adminTab(\'new\'"]');
      if (typeof window.adminTab === 'function' && newTabBtn) window.adminTab('new', newTabBtn);

      const titleEl = document.getElementById('a-title');
      const subEl = document.getElementById('a-sub');
      const catEl = document.getElementById('a-cat');
      const bodyEl = document.getElementById('a-body');

      if (titleEl) titleEl.value = draft.headline || '';
      if (subEl) subEl.value = draft.subheadline || '';
      if (catEl && draft.suggested_category) catEl.value = draft.suggested_category;

      // מרכיבים את גוף הכתבה: התוכן המלא + הגרסה המקוצרת (פלאש) כהערה בתחתית לעריכה שלך
      let fullBody = draft.body || '';
      if (draft.flash_headline || draft.flash_body) {
        fullBody += '\n\n---\nגרסת פלאש (לשימושך, להעתקה לשדות הפלאש בטופס אם רלוונטי):\n' +
          (draft.flash_headline ? 'כותרת: ' + draft.flash_headline + '\n' : '') +
          (draft.flash_body ? draft.flash_body : '');
      }
      if (bodyEl) bodyEl.value = fullBody;

      if (typeof window.toggleSpecsSection === 'function' && catEl) window.toggleSpecsSection(catEl.value);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      alert('הטיוטה נטענה לטופס. בדוק את התוכן, הוסף תמונה, ולחץ "פרסם כתבה" כרגיל. שים לב: הצעת ה-SEO (meta description) הייתה: "' + (draft.meta_description || '') + '"');
    } catch (e) {
      alert('שגיאה בטעינת הטיוטה לטופס.');
      console.error('[news.js] loadDraftIntoForm חריגה:', e);
    }
  };
})();
