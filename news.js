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

  window.refreshCarNews = async function (btn, region) {
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
        body: JSON.stringify(region ? { region: region } : {}),
      });
      const rawText = await res.text();
      let json = null;
      try { json = JSON.parse(rawText); } catch (e) { /* התשובה לא הייתה JSON תקני — נטפל בזה למטה */ }
      if (!res.ok) {
        const detail = (json && json.error) ? json.error : ('קוד ' + res.status + ': ' + rawText.slice(0, 300));
        alert('שגיאה ברענון החדשות:\n' + detail);
        console.error('[news.js] fetch-car-news נכשל:', res.status, rawText);
        return;
      }
      if (!json) {
        alert('שגיאה: התקבלה תשובה לא תקינה מהשרת (לא JSON):\n' + rawText.slice(0, 300));
        console.error('[news.js] fetch-car-news החזיר תשובה שאינה JSON:', rawText);
        return;
      }
      // מציגים בדיוק מה הצליח ומה נכשל בכל מקור — כדי לא להישאר בניחוש
      if (json.results && Array.isArray(json.results)) {
        const summary = json.results.map(function (r) {
          return (r.ok ? '✅ ' : '❌ ') + r.source + (r.ok ? ' (' + r.count + ')' : ' — ' + (r.error || 'שגיאה'));
        }).join('\n');
        console.log('[news.js] תוצאות רענון לפי מקור:\n' + summary);
        alert('רענון הסתיים:\n\n' + summary);
      }
      // מסנכרנים את תצוגת הרשימה לאזור שרעננו בפועל — אחרת נשארים על "הכל"
      // ורואים כותרות ישנות מאזור אחר, כאילו הרענון "הביא" משהו לא קשור.
      if (region === 'il' || region === 'world') {
        const matchingTab = document.querySelector('.news-region-tab[onclick*="\'' + region + '\'"]');
        window.setHeadlinesFilter(region, matchingTab);
      } else {
        loadHeadlines();
      }
    } catch (e) {
      alert('שגיאה ברענון החדשות. ודא שה-Edge Function פרוסה כראוי.');
      console.error('[news.js] fetch-car-news חריגה:', e);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
  };

  let _headlinesFilter = 'all';

  window.setHeadlinesFilter = function (region, el) {
    _headlinesFilter = region;
    document.querySelectorAll('.news-region-tab').forEach(function (b) { b.classList.remove('active'); });
    if (el) el.classList.add('active');
    loadHeadlines();
  };

  // תווית יום יחסית בעברית — "היום" / "אתמול" / תאריך מלא, בהשראת קיבוץ
  // ההודעות בטלגרם. עובד על published_at אם קיים, אחרת נופל חזרה ל-fetched_at.
  function dayLabel(dateStr) {
    if (!dateStr) return 'תאריך לא ידוע';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'תאריך לא ידוע';
    const now = new Date();
    const startOfDay = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
    if (diffDays === 0) return 'היום';
    if (diffDays === 1) return 'אתמול';
    if (diffDays > 1 && diffDays <= 6) return d.toLocaleDateString('he-IL', { weekday: 'long' });
    return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function formatTime(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  }

  // תג חשיבות — מבוסס על ניתוח Gemini האמיתי שנשמר ב-importance_score/reason
  // (ראו fetch-car-news). אם אין ציון (למשל נאסף לפני שהתכונה נוספה, או
  // שהניתוח נכשל), לא מוצג תג בכלל — עדיף היעדר מידע על מספר מזויף.
  function importanceBadge(score, reason) {
    if (!score) return '';
    const styles = {
      5: { bg: '#e8001d', label: '🔥 בוער' },
      4: { bg: '#ff6a00', label: '⚡ חשוב' },
      3: { bg: '#ffb020', label: '● משמעותי' },
      2: { bg: '#8993a3', label: '○ שולי' },
      1: { bg: '#5a6472', label: '· בסיסי' },
    };
    const s = styles[score] || styles[3];
    const title = reason ? escapeAttr(reason) : '';
    return '<span class="adm-cat-pill" style="background:' + s.bg + ';color:#fff;" title="' + title + '">' + s.label + '</span>';
  }

  async function loadHeadlines() {
    const client = initNewsClient();
    const list = document.getElementById('news-headlines-list');
    if (!list || !client) return;
    list.innerHTML = '<div class="adm-empty-state">טוען...</div>';
    try {
      // מיון לפי תאריך הפרסום המקורי (הכי חדש קודם); כתבות בלי published_at
      // (עדיין לא נתמך מהמקור) יורדות לסוף הרשימה במקום לבלבל את הסדר.
      let query = client.from('news_headlines').select('*')
        .order('published_at', { ascending: false, nullsFirst: false })
        .order('fetched_at', { ascending: false })
        .limit(150);
      if (_headlinesFilter === 'il' || _headlinesFilter === 'world') query = query.eq('region', _headlinesFilter);
      const { data, error } = await query;
      if (error) { list.innerHTML = '<div class="adm-empty-state">שגיאה בטעינת הכותרות: ' + escapeAttr(error.message) + '</div>'; console.error('[news.js] טעינת כותרות נכשלה:', error); return; }
      if (!data || !data.length) { list.innerHTML = '<div class="adm-empty-state">אין כותרות עדיין ' + (_headlinesFilter !== 'all' ? 'באזור הזה ' : '') + '— לחץ על אחד מכפתורי הרענון למעלה.</div>'; return; }

      let html = '';
      let lastGroupLabel = null;
      data.forEach(function (h) {
        const sortDate = h.published_at || h.fetched_at;
        const groupLabel = dayLabel(sortDate);
        if (groupLabel !== lastGroupLabel) {
          html += '<div class="adm-empty-state" style="text-align:right;padding:10px 4px 6px;font-weight:800;color:var(--adm-accent,#ff9d2e);border-bottom:1px solid var(--adm-border,var(--border));margin-top:14px;">' + groupLabel + '</div>';
          lastGroupLabel = groupLabel;
        }
        const regionPill = '<span class="adm-cat-pill">' + (REGION_LABELS[h.region] || h.region) + '</span>';
        const badge = importanceBadge(h.importance_score, h.importance_reason);
        const timeLabel = h.published_at ? '<span>' + formatTime(h.published_at) + '</span>' : '';
        let statusBadge = '';
        if (h.status === 'drafted') statusBadge = '<span class="adm-badge-active">נכתבה טיוטה</span>';
        else if (h.status === 'dismissed') statusBadge = '<span class="adm-badge-inactive">נדחה</span>';
        const writeBtn = h.status === 'drafted'
          ? ''
          : '<button class="tbl-btn" onclick="writeNewsDraft(' + h.id + ',this)">✍️ כתוב כתבה</button>';
        html += '<div class="adm-row">' +
          '<div class="adm-row-top">' +
            '<div class="adm-row-info">' +
              '<div class="adm-row-title">' + escapeAttr(h.title) + ' ' + statusBadge + '</div>' +
              '<div class="adm-row-meta">' + regionPill + badge + '<span>' + escapeAttr(h.source_name) + '</span>' + timeLabel + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="adm-row-bottom">' +
            '<a href="' + escapeAttr(h.source_url) + '" target="_blank" rel="noopener" class="tbl-btn">מקור ↗</a>' +
            '<div class="tbl-actions">' + writeBtn +
              '<button class="tbl-btn del" onclick="dismissHeadline(' + h.id + ')">✕ דחה</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      });
      list.innerHTML = html;
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
      const rawText = await res.text();
      let json = null;
      try { json = JSON.parse(rawText); } catch (e) { /* התשובה לא הייתה JSON תקני — נטפל בזה למטה */ }
      if (!res.ok) {
        const detail = (json && json.error) ? json.error : ('קוד ' + res.status + ': ' + rawText.slice(0, 300));
        alert('שגיאה בכתיבת הכתבה:\n' + detail);
        console.error('[news.js] draft-news-article נכשל:', res.status, rawText);
        return;
      }
      if (!json) {
        alert('שגיאה: התקבלה תשובה לא תקינה מהשרת (לא JSON):\n' + rawText.slice(0, 300));
        console.error('[news.js] draft-news-article החזיר תשובה שאינה JSON:', rawText);
        return;
      }
      alert('הטיוטה נכתבה בהצלחה! עבור ללשונית "כתבות מוכנות" כדי לבדוק ולפרסם.');
      loadHeadlines();
    } catch (e) {
      alert('שגיאה בכתיבת הכתבה (שגיאת רשת/JS):\n' + (e && e.message ? e.message : String(e)));
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
      const flashTitleEl = document.getElementById('a-flash-title');
      const flashTextEl = document.getElementById('a-flash-text');

      if (titleEl) titleEl.value = draft.headline || '';
      if (subEl) subEl.value = draft.subheadline || '';
      if (catEl && draft.suggested_category) catEl.value = draft.suggested_category;
      if (bodyEl) bodyEl.value = draft.body || '';
      // גרסת הפלאש הולכת בדיוק לאזור "חדשות בקליק" הקיים, לא לגוף הכתבה הראשית
      if (flashTitleEl) flashTitleEl.value = draft.flash_headline || '';
      if (flashTextEl) {
        flashTextEl.value = draft.flash_body || '';
        try { window.spFlashWordCount && window.spFlashWordCount(); } catch (e) {}
      }

      if (typeof window.toggleSpecsSection === 'function' && catEl) window.toggleSpecsSection(catEl.value);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      alert('הטיוטה נטענה לטופס — גם הכתבה המלאה וגם המבזק המהיר (בשדות "חדשות בקליק"). בדוק את התוכן, הוסף תמונה, ולחץ "פרסם כתבה" כרגיל. הצעת ה-SEO (meta description) הייתה: "' + (draft.meta_description || '') + '"');
    } catch (e) {
      alert('שגיאה בטעינת הטיוטה לטופס.');
      console.error('[news.js] loadDraftIntoForm חריגה:', e);
    }
  };
})();
