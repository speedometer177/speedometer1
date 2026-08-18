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
      if (tab === 'news') { loadHeadlines(); renderMorningBrief(); }
    };
    window.__newsAdminTabWrapped = true;
  }

  // ═══════════ תדריך בוקר ═══════════
  // מסכם ב-4 כרטיסים קטנים: כמה כותרות עלו מאתמול ב-18:00, כמה מהן בוערות,
  // כמה טיוטות ממתינות לפרסום, וכמה כתבות פורסמו אתמול (מתוך articles,
  // שכבר טעון גלובלית ע"י app.js). מחושב בזמן אמת בכל כניסה ללשונית —
  // בלי צורך בהתראות/דחיפה, בלי תלות בשירות חיצוני.
  async function renderMorningBrief() {
    const client = initNewsClient();
    const box = document.getElementById('morning-brief-box');
    if (!box || !client) return;
    try {
      const sinceCutoff = new Date();
      sinceCutoff.setDate(sinceCutoff.getDate() - (sinceCutoff.getHours() < 18 ? 1 : 0));
      sinceCutoff.setHours(18, 0, 0, 0);
      const sinceIso = sinceCutoff.toISOString();

      const [{ data: freshHeadlines }, { data: pendingDrafts }] = await Promise.all([
        client.from('news_headlines').select('id,importance_score').gte('fetched_at', sinceIso),
        client.from('news_drafts').select('id').eq('status', 'pending'),
      ]);
      const totalFresh = freshHeadlines ? freshHeadlines.length : 0;
      const hotCount = (freshHeadlines || []).filter(function (h) { return (h.importance_score || 0) >= 4; }).length;
      const draftCount = pendingDrafts ? pendingDrafts.length : 0;

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toLocaleDateString('he-IL');
      const publishedYesterday = (typeof articles !== 'undefined' && Array.isArray(articles))
        ? articles.filter(function (a) { return a.date === yesterdayStr; }).length
        : 0;

      const cards = [
        { label: 'כותרות חדשות מאתמול בערב', value: totalFresh, color: 'var(--adm-text)' },
        { label: 'מהן בוערות (ציון 4-5)', value: hotCount, color: hotCount ? '#e8001d' : 'var(--adm-muted)' },
        { label: 'טיוטות מוכנות ממתינות', value: draftCount, color: draftCount ? 'var(--adm-accent)' : 'var(--adm-muted)' },
        { label: 'כתבות שפרסמת אתמול', value: publishedYesterday, color: 'var(--adm-good)' },
      ];
      box.innerHTML = cards.map(function (c) {
        return '<div style="background:var(--adm-surface-2);border:1px solid var(--adm-border);border-radius:12px;padding:14px 12px;text-align:center;">' +
          '<div style="font-family:var(--adm-num);font-size:1.6rem;font-weight:700;color:' + c.color + ';">' + c.value + '</div>' +
          '<div style="font-size:0.68rem;color:var(--adm-muted);margin-top:4px;line-height:1.3;">' + c.label + '</div>' +
        '</div>';
      }).join('');
    } catch (e) {
      box.innerHTML = '<div class="adm-empty-state" style="grid-column:1/-1;">שגיאה בטעינת תדריך הבוקר.</div>';
      console.error('[news.js] renderMorningBrief חריגה:', e);
    }
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
        // שורת סיכום אמיתית: כמה נקראו מול כמה באמת נשמרו ב-DB. בלי זה
        // אפשר לראות רשימה מלאה של ✅ ירוקים בזמן ששום שורה לא נשמרה.
        var head = '';
        if (typeof json.totalProcessed === 'number') {
          head = '📥 נשמרו בפועל: ' + json.totalProcessed;
          if (typeof json.totalFetched === 'number') head += ' מתוך ' + json.totalFetched + ' שנקראו';
          if (json.duplicatesDropped) head += ' (' + json.duplicatesDropped + ' כפילויות סוננו)';
          head += '\n\n';
        }
        if (json.saveErrors && json.saveErrors.length) {
          head = '⚠️ השמירה ל-DB נכשלה:\n' + json.saveErrors.join('\n') + '\n\n' + head;
        }
        console.log('[news.js] תוצאות רענון לפי מקור:\n' + summary);
        alert('רענון הסתיים:\n\n' + head + summary);
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
  let _headlinesSort = 'new'; // ברירת מחדל: הכי חדש קודם (לא "הכי חם") — כדי שרענון תמיד יראה מיד את הכי טרי

  window.setHeadlinesFilter = function (region, el) {
    _headlinesFilter = region;
    document.querySelectorAll('.news-region-tab').forEach(function (b) { b.classList.remove('active'); });
    if (el) el.classList.add('active');
    loadHeadlines();
  };

  window.setHeadlinesSort = function (mode, el) {
    _headlinesSort = mode;
    document.querySelectorAll('.news-sort-tab').forEach(function (b) { b.classList.remove('active'); });
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

  // תאריך ושעה מלאים של הכתבה המקורית (לא רק "היום/אתמול" היחסי) —
  // לדוגמה: "03.08.2026, 14:32". מוצג ליד כל כותרת כדי לדעת בדיוק מתי
  // המקור פרסם, לא רק את הקיבוץ היחסי.
  function formatFullDateTime(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const datePart = d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timePart = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    return datePart + ', ' + timePart;
  }

  // תג אזור זוהר — "מקומי" בכחול כהה זוהר לכתבות ישראליות, "עולמי" בלבן
  // זוהר לכתבות מהעולם. עיצוב שונה במכוון מ-adm-cat-pill הרגיל כדי שהעין
  // תתפוס מיד לאיזה שוק הכתבה שייכת, עוד לפני קריאת הכותרת עצמה.
  function regionGlowPill(region) {
    if (region === 'il') {
      return '<span style="display:inline-flex;align-items:center;gap:4px;background:#0a1a4d;color:#7ab8ff;font-size:0.68rem;font-weight:800;padding:3px 10px;border-radius:12px;border:1px solid #2a5fd4;box-shadow:0 0 8px rgba(42,95,212,0.6),inset 0 0 6px rgba(122,184,255,0.15);letter-spacing:0.03em;">🇮🇱 מקומי</span>';
    }
    return '<span style="display:inline-flex;align-items:center;gap:4px;background:#fdfdfd;color:#333;font-size:0.68rem;font-weight:800;padding:3px 10px;border-radius:12px;border:1px solid #fff;box-shadow:0 0 10px rgba(255,255,255,0.85),0 0 3px rgba(255,255,255,0.9);letter-spacing:0.03em;">🌍 עולמי</span>';
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
      // מיון לפי המצב הנבחר: "הכי חם" (importance_score קודם, ואז תאריך
      // כשובר שוויון) או "הכי חדש" (תאריך פרסום קודם). כתבות בלי ציון/תאריך
      // (nulls) יורדות לסוף הרשימה במקום לבלבל את הסדר.
      let query = client.from('news_headlines').select('*');
      if (_headlinesSort === 'hot') {
        query = query
          .order('importance_score', { ascending: false, nullsFirst: false })
          .order('published_at', { ascending: false, nullsFirst: false });
      } else {
        query = query
          .order('published_at', { ascending: false, nullsFirst: false })
          .order('fetched_at', { ascending: false });
      }
      query = query.limit(150);
      if (_headlinesFilter === 'il' || _headlinesFilter === 'world') query = query.eq('region', _headlinesFilter);
      const { data, error } = await query;
      if (error) { list.innerHTML = '<div class="adm-empty-state">שגיאה בטעינת הכותרות: ' + escapeAttr(error.message) + '</div>'; console.error('[news.js] טעינת כותרות נכשלה:', error); return; }
      if (!data || !data.length) { list.innerHTML = '<div class="adm-empty-state">אין כותרות עדיין ' + (_headlinesFilter !== 'all' ? 'באזור הזה ' : '') + '— לחץ על אחד מכפתורי הרענון למעלה.</div>'; return; }

      // "לוח מומלצים" — 5 הכותרות הכי חמות+טריות שעדיין לא טופלו (לא נכתבה
      // עליהן טיוטה ולא נדחו), תמיד למעלה בלי קשר למיון/סינון הנבחר. המטרה:
      // לדעת במבט אחד על מה לכתוב היום, בלי לגלול ולסנן ידנית.
      //
      // חשוב: מוגבל ל-24 השעות האחרונות בלבד (לא רק "לא טופל") — אחרת כתבה
      // ישנה עם ציון חשיבות גבוה (למשל ריקול בטיחות מלפני יומיים) הייתה
      // "נתקעת" בלוח לצמיתות עד שמישהו מטפל בה ידנית, גם כשהמיון הראשי
      // כבר עבר הלאה לכתבות חדשות יותר.
      const TOP_PICKS_MAX_AGE_HOURS = 24;
      const openItems = data.filter(function (h) {
        if (h.status === 'drafted' || h.status === 'dismissed') return false;
        const sortDate = h.published_at || h.fetched_at;
        if (!sortDate) return true; // בלי תאריך בכלל — לא פוסלים, פשוט לא נדע לתעדף לפי טריות
        const ageHours = (Date.now() - new Date(sortDate).getTime()) / 3600000;
        return ageHours <= TOP_PICKS_MAX_AGE_HOURS;
      });
      const topPicks = openItems.slice().sort(function (a, b) {
        const scoreA = a.importance_score || 0, scoreB = b.importance_score || 0;
        if (scoreB !== scoreA) return scoreB - scoreA;
        const dateA = new Date(a.published_at || a.fetched_at || 0).getTime();
        const dateB = new Date(b.published_at || b.fetched_at || 0).getTime();
        return dateB - dateA;
      }).slice(0, 5);

      let html = '';
      if (topPicks.length) {
        html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">' +
          '<span style="font-weight:800;font-size:0.95rem;">🎯 מומלץ לכתיבה היום</span>' +
          '<span style="font-size:0.72rem;color:var(--adm-muted);">הכי חם + הכי טרי, לא תלוי במיון למטה</span></div>';
        topPicks.forEach(function (h) {
          html += renderHeadlineRow(h, true);
        });
        html += '<div style="border-bottom:2px solid var(--adm-accent,#ff9d2e);margin:16px 0 6px;"></div>';
      }

      let lastGroupLabel = null;
      data.forEach(function (h) {
        if (_headlinesSort === 'new') {
          const sortDate = h.published_at || h.fetched_at;
          const groupLabel = dayLabel(sortDate);
          if (groupLabel !== lastGroupLabel) {
            html += '<div class="adm-empty-state" style="text-align:right;padding:10px 4px 6px;font-weight:800;color:var(--adm-accent,#ff9d2e);border-bottom:1px solid var(--adm-border,var(--border));margin-top:14px;">' + groupLabel + '</div>';
            lastGroupLabel = groupLabel;
          }
        }
        html += renderHeadlineRow(h, false);
      });
      list.innerHTML = html;
    } catch (e) {
      list.innerHTML = '<div class="adm-empty-state">שגיאה בטעינת הכותרות.</div>';
      console.error('[news.js] loadHeadlines חריגה:', e);
    }
  }

  // בונה שורת HTML לכותרת אחת. highlighted=true מוסיף מסגרת בולטת — משמש
  // ללוח ה"מומלצים" כדי להבדיל אותו ויזואלית מהרשימה הרגילה למטה.
  function renderHeadlineRow(h, highlighted) {
    const regionPill = regionGlowPill(h.region);
    const badge = importanceBadge(h.importance_score, h.importance_reason);
    const timeLabel = h.published_at ? '<span>🕐 ' + formatFullDateTime(h.published_at) + '</span>' : '<span style="color:var(--adm-muted);">תאריך לא ידוע</span>';
    let statusBadge = '';
    if (h.status === 'drafted') statusBadge = '<span class="adm-badge-active">נכתבה טיוטה</span>';
    else if (h.status === 'dismissed') statusBadge = '<span class="adm-badge-inactive">נדחה</span>';
    const writeBtn = h.status === 'drafted'
      ? ''
      : '<button class="tbl-btn" onclick="writeNewsDraft(' + h.id + ',this)">✍️ כתוב כתבה</button>';
    const rowStyle = highlighted ? ' style="border:1.5px solid var(--adm-accent,#ff9d2e);border-radius:8px;margin-bottom:8px;"' : '';
    return '<div class="adm-row"' + rowStyle + '>' +
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
              '<button class="tbl-btn" style="background:#25D366;color:#fff;border-color:#25D366;display:flex;align-items:center;gap:5px;" onclick="copyFlashToClipboard(' + d.id + ',this)" title="העתק כותרת + חדשות בקצרה ללוח">' +
                '<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>' +
                'העתק לוואטסאפ' +
              '</button>' +
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

  // מעתיק ללוח את "חדשות בקצרה" (כותרת + טקסט) בפורמט מוכן להדבקה ישירה
  // בקבוצת הוואטסאפ הרשמית — לא שולח כלום אוטומטית, רק מכין ללוח (Ctrl+V).
  window.copyFlashToClipboard = async function (draftId, btn) {
    const client = initNewsClient();
    if (!client) return;
    const originalHTML = btn ? btn.innerHTML : null;
    try {
      const { data: draft, error } = await client.from('news_drafts').select('flash_headline,flash_body').eq('id', draftId).single();
      if (error || !draft) { alert('שגיאה בטעינת הטקסט להעתקה.'); return; }
      const text = (draft.flash_headline || '').trim() + '\n\n' + (draft.flash_body || '').trim();
      await navigator.clipboard.writeText(text);
      if (btn) {
        btn.innerHTML = '✓ הועתק!';
        setTimeout(function () { if (btn) btn.innerHTML = originalHTML; }, 1800);
      }
    } catch (e) {
      alert('שגיאה בהעתקה ללוח — ייתכן שהדפדפן חוסם גישה ללוח ללא HTTPS.');
      console.error('[news.js] copyFlashToClipboard חריגה:', e);
    }
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
      if (catEl && draft.suggested_category) { catEl.value = draft.suggested_category; try { window.updateCatBreadcrumbPreview && window.updateCatBreadcrumbPreview(catEl.value); } catch (e) {} }
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
