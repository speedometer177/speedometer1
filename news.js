/*
 * news.js — מרכז חדשות רכב אוטומטי — ספידומטר
 * NEWS-JS-BUILD: 2026-11-10b
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
 *   4. "🔍 בדוק תקינות" — קורא ל-Edge Function verify-draft-article:
 *      בדיקת ניסוח/מבנה מיידית + בדיקת עובדות מול כתבת המקור בפועל
 *      דרך Gemini. כתבה שלא עברה בהצלחה חוסמת (עם אישור מפורש לעקוף)
 *      את הכפתור "טען לעריכה ופרסום".
 *
 * גרסה 2 (10.11.2026):
 *   • כתיבה ברקע — "כתוב כתבה" חוזר מיד. הכותרת מסומנת "נכתבת עכשיו",
 *     ואפשר להמשיך לעבוד ולשלוח עוד כותרות. כשהטיוטה מוכנה (או נכשלה)
 *     הכרטיס מתעדכן לבד ומופיעה הודעה קטנה. אין יותר חלונות קופצים.
 *   • כותרות שאינן רכב ותאונות סתמיות מוסתרות; אותה ידיעה מכמה מקורות
 *     מוצגת פעם אחת עם תג "N מקורות".
 *   • שורת סטטוס של הרענון האוטומטי, והתראה כשנכנסו כותרות חדשות.
 *   • אם מבנה הנתונים של גרסה 2 עדיין לא הותקן, הפאנל עובד כמו קודם.
 * ---------------------------------------------------------------
 */
(function () {
  'use strict';

  const SB_URL = 'https://kaykrrnmykqrfhawgtqt.supabase.co';
  const SB_KEY = 'sb_publishable_Ms6YFTnADm-qAd9617Ey9A_D3x-Zumi';
  const EDGE_BASE = SB_URL + '/functions/v1';
  let newsClient = null;

  const REGION_LABELS = { il: 'ישראל', world: 'עולם' };

  // תוצאות בדיקת התקינות האחרונה לכל טיוטה, בזיכרון בלבד (לא נשמר ב-DB) —
  // מתאפס בכל טעינה מחדש של הדף, כדי לוודא שהבדיקה שרלוונטית היא תמיד
  // הבדיקה האחרונה שרצה בפועל על התוכן הנוכחי.
  const draftVerifications = {};

  // האם עמודות גרסה 2 קיימות בבסיס הנתונים. מתגלה בטעינה הראשונה: אם
  // השאילתה החדשה נכשלת על עמודה חסרה, עוברים לשאילתה הישנה.
  let _v2 = true;
  // כתיבה שסומנה "נכתבת" לפני יותר מזה נחשבת תקועה (הפונקציה מוגבלת ל-150 שניות).
  const WRITING_STALE_MS = 4 * 60 * 1000;
  const HEADLINE_COLS = 'id,source_name,source_url,title,region,status,published_at,fetched_at,' +
    'importance_score,importance_reason,duplicate_of,hidden_reason,draft_status,draft_error,draft_started_at';

  const _headlineById = {};   // הכותרות שמוצגות כרגע, לפי מזהה
  let _dupsByPrimary = {};    // מזהה כותרת ראשית → רשימת המקורות הנוספים שלה
  const _writing = new Set(); // כותרות שנכתבות עכשיו ברקע
  let _pollTimer = null;
  let _lastLoadIso = null;    // מתי נטענה הרשימה לאחרונה (לזיהוי כותרות חדשות)

  function escapeAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function isMissingColumn(error) {
    if (!error) return false;
    return error.code === '42703' || error.code === 'PGRST204' || error.code === '42P01' || error.code === 'PGRST205' ||
      /does not exist|could not find/i.test(error.message || '');
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

  // ═══════════ תשתית ממשק: הודעות צפות, שורת סטטוס ═══════════
  // הכול מוזרק מכאן, כך ש-index.html ו-404.html לא משתנים.

  function ensureNewsUi() {
    if (document.getElementById('news-v2-style')) return;
    const st = document.createElement('style');
    st.id = 'news-v2-style';
    st.textContent =
      '#news-toast-host{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:8px;width:min(92vw,460px);pointer-events:none}' +
      '.news-toast{pointer-events:auto;background:#12161f;color:#fff;border:1px solid #2a3140;border-right:4px solid #ff9d2e;border-radius:12px;padding:12px 14px;font-size:0.84rem;line-height:1.5;box-shadow:0 10px 30px rgba(0,0,0,.45);direction:rtl;text-align:right;display:flex;gap:10px;align-items:flex-start;cursor:pointer;animation:newsToastIn .22s ease-out}' +
      '.news-toast.ok{border-right-color:#2ecc71}.news-toast.err{border-right-color:#e8001d}' +
      '.news-toast-body{flex:1;min-width:0;word-break:break-word}' +
      '.news-toast-act{background:#ff9d2e;color:#111;border:0;border-radius:8px;padding:6px 10px;font-size:0.76rem;font-weight:800;font-family:inherit;cursor:pointer;white-space:nowrap}' +
      '@keyframes newsToastIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}' +
      '.news-spin{display:inline-block;width:11px;height:11px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:newsSpin .8s linear infinite;vertical-align:-1px;margin-inline-end:5px}' +
      '@keyframes newsSpin{to{transform:rotate(360deg)}}' +
      '.news-writing-badge{background:rgba(255,157,46,.16);color:#ff9d2e;font-size:0.62rem;font-weight:800;padding:2px 9px;border-radius:10px;white-space:nowrap}' +
      '.news-draft-note{width:100%;font-size:0.76rem;line-height:1.5;margin-top:2px;color:#ff6b6b}' +
      '.news-src-badge{display:inline-flex;align-items:center;gap:4px;background:rgba(122,184,255,.14);color:#7ab8ff;border:1px solid rgba(122,184,255,.35);font-size:0.68rem;font-weight:800;padding:3px 9px;border-radius:12px;cursor:pointer;user-select:none}' +
      '.news-src-list{display:none;width:100%;margin-top:6px;padding:8px 10px;border-radius:8px;background:var(--adm-surface-2,rgba(255,255,255,.04));font-size:0.76rem;line-height:1.7}' +
      '.news-src-list a{color:var(--adm-accent,#ff9d2e);text-decoration:none}' +
      '#news-auto-status{font-size:0.76rem;color:var(--adm-muted);margin-top:12px;line-height:1.6}' +
      '#news-auto-status details,#news-refresh-result details{margin-top:4px}' +
      '#news-auto-status summary,#news-refresh-result summary{cursor:pointer}' +
      '#news-refresh-result{font-size:0.8rem;margin-top:10px;line-height:1.6;display:none;padding:10px 12px;border-radius:10px;background:var(--adm-surface-2,rgba(255,255,255,.04));border:1px solid var(--adm-border,rgba(255,255,255,.08))}' +
      '#news-refresh-result pre{white-space:pre-wrap;font-family:inherit;font-size:0.74rem;color:var(--adm-muted);margin:6px 0 0;max-height:240px;overflow:auto}' +
      '#news-new-pill{display:none;width:100%;margin-bottom:12px;padding:10px;border-radius:10px;border:1px solid #2ecc71;background:rgba(46,204,113,.12);color:#2ecc71;font-weight:800;font-size:0.84rem;font-family:inherit;cursor:pointer}';
    document.head.appendChild(st);

    const refreshBtn = document.getElementById('news-refresh-btn');
    const block = refreshBtn ? refreshBtn.closest('.form-block') : null;
    if (block) {
      const result = document.createElement('div');
      result.id = 'news-refresh-result';
      block.appendChild(result);
      const status = document.createElement('div');
      status.id = 'news-auto-status';
      block.appendChild(status);
    }
    const list = document.getElementById('news-headlines-list');
    if (list && list.parentNode) {
      const pill = document.createElement('button');
      pill.id = 'news-new-pill';
      pill.type = 'button';
      pill.onclick = function () { loadHeadlines(); };
      list.parentNode.insertBefore(pill, list);
    }
    const host = document.createElement('div');
    host.id = 'news-toast-host';
    document.body.appendChild(host);

    // בדיקה שקטה כל 3 דקות: האם נכנסו כותרות חדשות, ומה מצב הרענון האוטומטי.
    setInterval(function () {
      const panel = document.getElementById('admin-news');
      if (document.visibilityState !== 'visible' || !panel || panel.offsetParent === null) return;
      checkNewHeadlines();
      loadAutoStatus();
    }, 180000);
  }

  // הודעה צפה קטנה, במקום alert שחוסם את המסך. kind: 'ok' | 'err' | ''.
  function newsToast(message, kind, opts) {
    ensureNewsUi();
    opts = opts || {};
    const host = document.getElementById('news-toast-host');
    if (!host) { console.log('[news.js] ' + message); return; }
    const el = document.createElement('div');
    el.className = 'news-toast' + (kind ? ' ' + kind : '');
    const bodyEl = document.createElement('div');
    bodyEl.className = 'news-toast-body';
    bodyEl.textContent = message;
    el.appendChild(bodyEl);
    const close = function () { if (el.parentNode) el.parentNode.removeChild(el); };
    if (opts.actionLabel && typeof opts.onAction === 'function') {
      const act = document.createElement('button');
      act.className = 'news-toast-act';
      act.type = 'button';
      act.textContent = opts.actionLabel;
      act.onclick = function (ev) { ev.stopPropagation(); close(); opts.onAction(); };
      el.appendChild(act);
    }
    el.onclick = close;
    host.appendChild(el);
    while (host.children.length > 4) host.removeChild(host.firstChild);
    setTimeout(close, opts.ms || (kind === 'err' ? 14000 : 7000));
  }

  function minutesAgoLabel(dateStr) {
    const mins = Math.max(0, Math.round((Date.now() - new Date(dateStr).getTime()) / 60000));
    if (mins < 1) return 'ממש עכשיו';
    if (mins < 60) return 'לפני ' + mins + ' דק\'';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return 'לפני ' + hours + ' שע\'';
    return 'לפני ' + Math.floor(hours / 24) + ' ימים';
  }

  // שורת סטטוס מתחת לכפתורי הרענון: מתי המקורות עודכנו, ואילו מקורות בתקלה.
  async function loadAutoStatus() {
    const client = initNewsClient();
    const box = document.getElementById('news-auto-status');
    if (!box || !client || !_v2) return;
    try {
      const { data, error } = await client.from('news_source_state')
        .select('source_name,last_run_at,consecutive_failures,last_error');
      if (error || !data || !data.length) { box.innerHTML = ''; return; }
      let latest = 0;
      data.forEach(function (r) { if (r.last_run_at) latest = Math.max(latest, new Date(r.last_run_at).getTime()); });
      if (!latest) { box.innerHTML = ''; return; }
      const mins = (Date.now() - latest) / 60000;
      const failing = data.filter(function (r) { return (r.consecutive_failures || 0) >= 3; });
      let html = mins <= 25
        ? '🟢 מתעדכן אוטומטית ברקע · עדכון אחרון ' + minutesAgoLabel(latest)
        : '🟠 עדכון אחרון של המקורות ' + minutesAgoLabel(latest) + ' · הרענון האוטומטי לא רץ כרגע';
      html += ' · ' + data.length + ' מקורות';
      if (failing.length) {
        html += '<details><summary>⚠️ ' + failing.length + ' מקורות בתקלה מתמשכת</summary>' +
          failing.map(function (r) {
            return '<div>❌ ' + escapeAttr(r.source_name) + ' — ' + escapeAttr((r.last_error || 'שגיאה').slice(0, 140)) + '</div>';
          }).join('') + '</details>';
      }
      box.innerHTML = html;
    } catch (e) { /* שורת סטטוס בלבד — לא מפריעים לשאר הפאנל */ }
  }

  // כמה כותרות חדשות נכנסו מאז שהרשימה נטענה. שאילתת ספירה בלבד — בלי להוריד נתונים.
  async function checkNewHeadlines() {
    const client = initNewsClient();
    const pill = document.getElementById('news-new-pill');
    if (!pill || !client || !_v2 || !_lastLoadIso) return;
    try {
      let q = client.from('news_headlines').select('id', { count: 'exact', head: true })
        .gt('fetched_at', _lastLoadIso).is('hidden_reason', null).is('duplicate_of', null).not('ai_checked_at', 'is', null);
      if (_headlinesFilter === 'il' || _headlinesFilter === 'world') q = q.eq('region', _headlinesFilter);
      const { count, error } = await q;
      if (error || !count) return;
      pill.textContent = '🆕 ' + count + (count === 1 ? ' כותרת חדשה' : ' כותרות חדשות') + ' — לחץ להצגה';
      pill.style.display = 'block';
    } catch (e) { /* לא קריטי */ }
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

  function openDraftsTab() {
    const tabs = document.querySelectorAll('.news-subtab');
    if (tabs.length > 1) window.newsSubTab('drafts', tabs[1]);
  }

  // עוטפים את adminTab הקיים (שכבר עטוף פעם אחת על ידי ads.js) כדי להוסיף
  // תמיכה בלשונית 'news', באותו דפוס עדין שכבר נוהג באתר.
  if (typeof window.adminTab === 'function' && !window.__newsAdminTabWrapped) {
    const prevAdminTab = window.adminTab;
    window.adminTab = function (tab, btnEl) {
      prevAdminTab(tab, btnEl);
      const newsPanel = document.getElementById('admin-news');
      if (!newsPanel) return;
      newsPanel.style.display = tab === 'news' ? '' : 'none';
      if (tab === 'news') { ensureNewsUi(); loadHeadlines(); renderMorningBrief(); }
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

      // בגרסה 2 הספירה כוללת רק כותרות שמוצגות בפועל (בלי מוסתרות וכפילויות).
      const freshQuery = function (v2) {
        let q = client.from('news_headlines').select('id,importance_score').gte('fetched_at', sinceIso);
        if (v2) q = q.is('hidden_reason', null).is('duplicate_of', null);
        return q;
      };
      const [freshFirst, { data: pendingDrafts }] = await Promise.all([
        freshQuery(_v2),
        client.from('news_drafts').select('id').eq('status', 'pending'),
      ]);
      let freshRes = freshFirst;
      if (freshRes.error && isMissingColumn(freshRes.error)) freshRes = await freshQuery(false);
      const freshHeadlines = freshRes.data;
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

  // מציג את תוצאות הרענון בתוך הדף (מתחת לכפתורים) במקום חלון קופץ.
  function renderRefreshResult(json) {
    const box = document.getElementById('news-refresh-result');
    const results = Array.isArray(json.results) ? json.results : [];
    const okCount = results.filter(function (r) { return r.ok; }).length;
    const failCount = results.length - okCount;
    const newCount = typeof json.totalNew === 'number' ? json.totalNew : json.totalProcessed;

    const parts = [];
    if (typeof newCount === 'number') parts.push(newCount + (typeof json.totalNew === 'number' ? ' כותרות חדשות' : ' כותרות נשמרו'));
    if (json.hiddenNotCar) parts.push(json.hiddenNotCar + ' סוננו (לא רכב)');
    if (json.hiddenAccident) parts.push(json.hiddenAccident + ' תאונות סוננו');
    if (json.duplicatesMerged) parts.push(json.duplicatesMerged + ' כפילויות אוחדו');
    if (json.pendingAnalysis) parts.push(json.pendingAnalysis + ' ימשיכו להתנתח ברקע');
    if (json.skippedRecent) parts.push(json.skippedRecent + ' מקורות דולגו (עודכנו ברקע לפני רגע)');
    const summary = results.map(function (r) {
      return (r.ok ? '✅ ' : '❌ ') + r.source + (r.ok ? ' (' + r.count + ')' : ' — ' + (r.error || 'שגיאה'));
    }).join('\n');
    console.log('[news.js] תוצאות רענון לפי מקור:\n' + summary);

    let html = '<div style="font-weight:800;">✅ הרענון הסתיים' + (parts.length ? ' · ' + escapeAttr(parts.join(' · ')) : '') + '</div>';
    if (json.saveErrors && json.saveErrors.length) {
      html += '<div style="color:#ff6b6b;margin-top:4px;">⚠️ השמירה נכשלה: ' + escapeAttr(json.saveErrors.join(' | ')) + '</div>';
    }
    if (json.creditDepleted && json.error) {
      html += '<div style="color:#ff6b6b;margin-top:4px;">⚠️ ' + escapeAttr(json.error) + '</div>';
    }
    if (results.length) {
      html += '<details><summary>פירוט לפי מקור · ' + okCount + ' תקינים' + (failCount ? ' · ' + failCount + ' נכשלו' : '') + '</summary>' +
        '<pre>' + escapeAttr(summary) + '</pre></details>';
    }
    if (box) { box.innerHTML = html; box.style.display = 'block'; }
    else newsToast('הרענון הסתיים' + (parts.length ? ' · ' + parts.join(' · ') : ''), 'ok');
  }

  window.refreshCarNews = async function (btn, region) {
    ensureNewsUi();
    const client = initNewsClient();
    if (!client) { newsToast('אין חיבור לשרת — נסה לרענן את הדף.', 'err'); return; }
    const token = await getAuthToken();
    if (!token) { newsToast('יש להתחבר לניהול קודם.', 'err'); return; }
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
        newsToast('שגיאה ברענון החדשות: ' + detail, 'err');
        console.error('[news.js] fetch-car-news נכשל:', res.status, rawText);
        return;
      }
      if (!json) {
        newsToast('שגיאה: התקבלה תשובה לא תקינה מהשרת: ' + rawText.slice(0, 200), 'err');
        console.error('[news.js] fetch-car-news החזיר תשובה שאינה JSON:', rawText);
        return;
      }
      renderRefreshResult(json);
      // מסנכרנים את תצוגת הרשימה לאזור שרעננו בפועל — אחרת נשארים על "הכל"
      // ורואים כותרות ישנות מאזור אחר, כאילו הרענון "הביא" משהו לא קשור.
      if (region === 'il' || region === 'world') {
        const matchingTab = document.querySelector('.news-region-tab[onclick*="\'' + region + '\'"]');
        window.setHeadlinesFilter(region, matchingTab);
      } else {
        loadHeadlines();
      }
    } catch (e) {
      newsToast('שגיאה ברענון החדשות (שגיאת רשת). אם זה חוזר, ודא שה-Edge Function פרוסה.', 'err');
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

  function buildHeadlinesQuery(client, v2) {
    // גרסה 2: רק העמודות שמוצגות (בלי התקציר), ורק כותרות ראשיות שלא הוסתרו.
    let query = client.from('news_headlines').select(v2 ? HEADLINE_COLS : '*');
    if (v2) query = query.is('hidden_reason', null).is('duplicate_of', null);
    // מיון לפי המצב הנבחר: "הכי חם" (importance_score קודם, ואז תאריך
    // כשובר שוויון) או "הכי חדש" (תאריך פרסום קודם). כתבות בלי ציון/תאריך
    // (nulls) יורדות לסוף הרשימה במקום לבלבל את הסדר.
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
    return query;
  }

  async function loadHeadlines() {
    ensureNewsUi();
    const client = initNewsClient();
    const list = document.getElementById('news-headlines-list');
    if (!list || !client) return;
    list.innerHTML = '<div class="adm-empty-state">טוען...</div>';
    const pill = document.getElementById('news-new-pill');
    if (pill) pill.style.display = 'none';
    try {
      const loadStartedIso = new Date().toISOString();
      let res = await buildHeadlinesQuery(client, _v2);
      if (res.error && _v2 && isMissingColumn(res.error)) {
        console.warn('[news.js] מבנה הנתונים של גרסה 2 חסר — עובדים במצב הישן.');
        _v2 = false;
        res = await buildHeadlinesQuery(client, false);
      }
      const data = res.data, error = res.error;
      if (error) { list.innerHTML = '<div class="adm-empty-state">שגיאה בטעינת הכותרות: ' + escapeAttr(error.message) + '</div>'; console.error('[news.js] טעינת כותרות נכשלה:', error); return; }
      _lastLoadIso = loadStartedIso;
      if (!data || !data.length) { list.innerHTML = '<div class="adm-empty-state">אין כותרות עדיין ' + (_headlinesFilter !== 'all' ? 'באזור הזה ' : '') + '— לחץ על אחד מכפתורי הרענון למעלה.</div>'; loadAutoStatus(); return; }

      Object.keys(_headlineById).forEach(function (k) { delete _headlineById[k]; });
      data.forEach(function (h) { _headlineById[h.id] = h; });

      // המקורות הנוספים של כל ידיעה (אותה ידיעה שהגיעה מכמה אתרים).
      _dupsByPrimary = {};
      if (_v2) {
        try {
          const dupRes = await client.from('news_headlines')
            .select('id,duplicate_of,source_name,source_url')
            .in('duplicate_of', data.map(function (h) { return h.id; }));
          (dupRes.data || []).forEach(function (d) {
            (_dupsByPrimary[d.duplicate_of] = _dupsByPrimary[d.duplicate_of] || []).push(d);
          });
        } catch (e) { /* בלי תג מקורות — לא קריטי */ }
      }

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
      // ידיעה שדווחה בכמה מקורות מקבלת עדיפות בין כותרות עם אותו ציון.
      const sourceCount = function (h) { return 1 + ((_dupsByPrimary[h.id] || []).length); };
      const topPicks = openItems.slice().sort(function (a, b) {
        const scoreA = a.importance_score || 0, scoreB = b.importance_score || 0;
        if (scoreB !== scoreA) return scoreB - scoreA;
        if (sourceCount(b) !== sourceCount(a)) return sourceCount(b) - sourceCount(a);
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

      // כותרות שנכתבות כרגע ברקע (למשל אחרי טעינה מחדש של הדף) — ממשיכים לעקוב.
      data.forEach(function (h) { if (draftState(h) === 'writing') trackWriting(h.id); });
      loadAutoStatus();
    } catch (e) {
      list.innerHTML = '<div class="adm-empty-state">שגיאה בטעינת הכותרות.</div>';
      console.error('[news.js] loadHeadlines חריגה:', e);
    }
  }

  // מצב הכתיבה של כותרת: 'drafted' | 'writing' | 'stuck' | 'failed' | 'idle'.
  function draftState(h) {
    if (h.status === 'drafted') return 'drafted';
    if (h.draft_status === 'writing') {
      const started = h.draft_started_at ? new Date(h.draft_started_at).getTime() : 0;
      return (Date.now() - started < WRITING_STALE_MS) ? 'writing' : 'stuck';
    }
    if (h.draft_status === 'failed') return 'failed';
    return 'idle';
  }

  // בונה שורת HTML לכותרת אחת. highlighted=true מוסיף מסגרת בולטת — משמש
  // ללוח ה"מומלצים" כדי להבדיל אותו ויזואלית מהרשימה הרגילה למטה.
  function renderHeadlineRow(h, highlighted) {
    const regionPill = regionGlowPill(h.region);
    const badge = importanceBadge(h.importance_score, h.importance_reason);
    const timeLabel = h.published_at ? '<span>🕐 ' + formatFullDateTime(h.published_at) + '</span>' : '<span style="color:var(--adm-muted);">תאריך לא ידוע</span>';
    const state = draftState(h);

    let statusBadge = '';
    if (state === 'drafted') statusBadge = '<span class="adm-badge-active">נכתבה טיוטה</span>';
    else if (state === 'writing') statusBadge = '<span class="news-writing-badge"><span class="news-spin"></span>נכתבת עכשיו</span>';
    else if (h.status === 'dismissed') statusBadge = '<span class="adm-badge-inactive">נדחה</span>';

    let writeBtn = '';
    if (state === 'writing') writeBtn = '<button class="tbl-btn" disabled><span class="news-spin"></span>כותב...</button>';
    else if (state === 'failed' || state === 'stuck') writeBtn = '<button class="tbl-btn" onclick="writeNewsDraft(' + h.id + ',this)">🔁 נסה שוב</button>';
    else if (state === 'idle') writeBtn = '<button class="tbl-btn" onclick="writeNewsDraft(' + h.id + ',this)">✍️ כתוב כתבה</button>';

    let note = '';
    if (state === 'failed') note = '<div class="news-draft-note">⚠️ הכתיבה נכשלה: ' + escapeAttr(h.draft_error || 'שגיאה לא ידועה') + '</div>';
    else if (state === 'stuck') note = '<div class="news-draft-note">⚠️ הכתיבה נקטעה באמצע. אפשר לנסות שוב.</div>';

    // תג "N מקורות": אותה ידיעה הגיעה מכמה אתרים. לחיצה פותחת את הרשימה.
    const dups = _dupsByPrimary[h.id] || [];
    let srcBadge = '', srcList = '';
    if (dups.length) {
      srcBadge = '<span class="news-src-badge" onclick="toggleNewsSources(this)" title="אותה ידיעה דווחה גם במקורות נוספים">📰 ' + (dups.length + 1) + ' מקורות</span>';
      srcList = '<div class="news-src-list">דווח גם ב: ' + dups.map(function (d) {
        return '<a href="' + escapeAttr(d.source_url) + '" target="_blank" rel="noopener">' + escapeAttr(d.source_name) + ' ↗</a>';
      }).join(' · ') + '</div>';
    }

    const rowStyle = highlighted ? ' style="border:1.5px solid var(--adm-accent,#ff9d2e);border-radius:8px;margin-bottom:8px;"' : '';
    return '<div class="adm-row" data-hid="' + h.id + '" data-hl="' + (highlighted ? '1' : '0') + '"' + rowStyle + '>' +
      '<div class="adm-row-top">' +
        '<div class="adm-row-info">' +
          '<div class="adm-row-title">' + escapeAttr(h.title) + ' ' + statusBadge + '</div>' +
          '<div class="adm-row-meta">' + regionPill + badge + srcBadge + '<span>' + escapeAttr(h.source_name) + '</span>' + timeLabel + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="adm-row-bottom">' +
        '<a href="' + escapeAttr(h.source_url) + '" target="_blank" rel="noopener" class="tbl-btn">מקור ↗</a>' +
        '<div class="tbl-actions">' + writeBtn +
          '<button class="tbl-btn del" onclick="dismissHeadline(' + h.id + ')">✕ דחה</button>' +
        '</div>' +
        note + srcList +
      '</div>' +
    '</div>';
  }

  window.toggleNewsSources = function (el) {
    const row = el && el.closest ? el.closest('.adm-row') : null;
    const box = row ? row.querySelector('.news-src-list') : null;
    if (box) box.style.display = box.style.display === 'block' ? 'none' : 'block';
  };

  // מצייר מחדש רק את הכרטיס של כותרת אחת (היא יכולה להופיע פעמיים: גם
  // ב"מומלץ לכתיבה" וגם ברשימה), בלי לטעון מחדש את כל הרשימה.
  function rerenderHeadline(id) {
    const h = _headlineById[id];
    if (!h) return;
    document.querySelectorAll('.adm-row[data-hid="' + id + '"]').forEach(function (el) {
      el.outerHTML = renderHeadlineRow(h, el.getAttribute('data-hl') === '1');
    });
  }

  function trackWriting(id) {
    _writing.add(id);
    if (!_pollTimer) _pollTimer = setInterval(pollWriting, 4000);
  }

  // בודק כל 4 שניות את הכותרות שנכתבות ברקע, ומעדכן את הכרטיס כשהסתיימו.
  async function pollWriting() {
    if (!_writing.size) { clearInterval(_pollTimer); _pollTimer = null; return; }
    const client = initNewsClient();
    if (!client) return;
    try {
      const { data, error } = await client.from('news_headlines')
        .select('id,title,status,draft_status,draft_error,draft_started_at')
        .in('id', Array.from(_writing));
      if (error || !data) return;
      data.forEach(function (row) {
        const h = _headlineById[row.id] || (_headlineById[row.id] = { id: row.id });
        Object.assign(h, row);
        const state = draftState(h);
        if (state === 'writing') return;
        _writing.delete(row.id);
        const shortTitle = (h.title || '').length > 60 ? h.title.slice(0, 60) + '…' : (h.title || '');
        if (state === 'drafted') {
          newsToast('✅ הטיוטה מוכנה: ' + shortTitle, 'ok', { actionLabel: 'לכתבות מוכנות', onAction: openDraftsTab, ms: 12000 });
        } else if (state === 'failed') {
          newsToast('הכתיבה נכשלה: ' + shortTitle + ' — ' + (h.draft_error || 'שגיאה לא ידועה'), 'err');
        } else {
          newsToast('הכתיבה נקטעה באמצע: ' + shortTitle + '. אפשר לנסות שוב.', 'err');
        }
        rerenderHeadline(row.id);
      });
    } catch (e) { /* ננסה שוב בסיבוב הבא */ }
  }

  function markHeadline(id, fields) {
    const h = _headlineById[id];
    if (!h) return;
    Object.assign(h, fields);
    rerenderHeadline(id);
  }

  // "כתוב כתבה": הכתיבה רצה ברקע בשרת. הפונקציה חוזרת מיד, והכרטיס מתעדכן
  // לבד כשהטיוטה מוכנה. אפשר ללחוץ על כמה כותרות ברצף בלי לחכות.
  window.writeNewsDraft = async function (headlineId, btn) {
    ensureNewsUi();
    const client = initNewsClient();
    if (!client) return;
    const token = await getAuthToken();
    if (!token) { newsToast('יש להתחבר לניהול קודם.', 'err'); return; }
    if (_writing.has(headlineId)) return;

    if (_headlineById[headlineId]) {
      markHeadline(headlineId, { draft_status: 'writing', draft_error: null, draft_started_at: new Date().toISOString() });
    } else if (btn) {
      btn.disabled = true; btn.textContent = 'כותב...';
    }
    try {
      const res = await fetch(EDGE_BASE + '/draft-news-article', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ headline_id: headlineId, background: true }),
      });
      const rawText = await res.text();
      let json = null;
      try { json = JSON.parse(rawText); } catch (e) { /* התשובה לא הייתה JSON תקני — נטפל בזה למטה */ }

      // הפונקציה התחילה לכתוב ברקע — עוקבים עד שתסיים.
      if (res.status === 202 && json && json.started) { trackWriting(headlineId); return; }

      // הפונקציה כתבה וחיכתה (גרסה ישנה, או כשכתיבה ברקע לא זמינה).
      if (res.ok && json && json.success) {
        markHeadline(headlineId, { status: 'drafted', draft_status: null, draft_error: null });
        newsToast('✅ הטיוטה מוכנה.', 'ok', { actionLabel: 'לכתבות מוכנות', onAction: openDraftsTab, ms: 12000 });
        if (!_headlineById[headlineId]) loadHeadlines();
        return;
      }

      const detail = (json && json.error) ? json.error : ('קוד ' + res.status + ': ' + rawText.slice(0, 300));
      console.error('[news.js] draft-news-article נכשל:', res.status, rawText);
      markHeadline(headlineId, { draft_status: 'failed', draft_error: detail });
      newsToast('הכתיבה נכשלה: ' + detail, 'err');
      if (!_headlineById[headlineId] && btn) { btn.disabled = false; btn.textContent = '🔁 נסה שוב'; }
    } catch (e) {
      const msg = 'שגיאת רשת: ' + (e && e.message ? e.message : String(e));
      console.error('[news.js] writeNewsDraft חריגה:', e);
      markHeadline(headlineId, { draft_status: 'failed', draft_error: msg });
      newsToast('הכתיבה נכשלה. ' + msg, 'err');
      if (!_headlineById[headlineId] && btn) { btn.disabled = false; btn.textContent = '🔁 נסה שוב'; }
    }
  };

  window.dismissHeadline = async function (headlineId) {
    const client = initNewsClient();
    if (!client) return;
    try {
      const { error } = await client.from('news_headlines').update({ status: 'dismissed' }).eq('id', headlineId);
      if (error) throw error;
      loadHeadlines();
    } catch (e) { newsToast('שגיאה בדחיית הכותרת.', 'err'); console.error('[news.js] dismissHeadline נכשל:', e); }
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
              '<button class="tbl-btn" id="verify-btn-' + d.id + '" onclick="verifyDraft(' + d.id + ',this)" title="בדיקת אמינות אוטומטית מול המקור לפני פרסום">🔍 בדוק תקינות</button>' +
              '<button class="tbl-btn" onclick="loadDraftIntoForm(' + d.id + ')">📝 טען לעריכה ופרסום</button>' +
              '<button class="tbl-btn del" onclick="discardDraft(' + d.id + ')">✕ מחק טיוטה</button>' +
            '</div>' +
            '<div id="draft-verify-' + d.id + '" style="width:100%;"></div>' +
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

  // ═══════════ בדיקת תקינות/אמינות לפני פרסום ═══════════
  // קוראת ל-Edge Function verify-draft-article: בדיקות ניסוח/מבנה מיידיות
  // + בדיקת עובדות מול כתבת המקור בפועל דרך Gemini. התוצאה נשמרת בזיכרון
  // (draftVerifications) ונבדקת שוב ב-loadDraftIntoForm לפני שממשיכים
  // לטופס הפרסום — כתבה שלא עברה בדיקה בהצלחה חוסמת את ההמשך עד אישור
  // מפורש (confirm) של המשתמש.
  window.verifyDraft = async function (draftId, btn) {
    const token = await getAuthToken();
    if (!token) { alert('יש להתחבר לניהול קודם.'); return; }
    const resultEl = document.getElementById('draft-verify-' + draftId);
    const originalText = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = '🔄 בודק...'; }
    if (resultEl) resultEl.innerHTML = '<div style="font-size:0.78rem;color:var(--adm-muted);margin-top:6px;">בודק ניסוח, מבנה, ומאמת עובדות מול כתבת המקור — עד כ-15 שניות...</div>';
    try {
      const res = await fetch(EDGE_BASE + '/verify-draft-article', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId: draftId }),
      });
      const rawText = await res.text();
      let json = null;
      try { json = JSON.parse(rawText); } catch (e) { /* לא JSON תקני — נטפל למטה */ }
      if (!res.ok || !json || json.error) {
        const detail = (json && json.error) ? json.error : ('קוד ' + res.status + ': ' + rawText.slice(0, 200));
        draftVerifications[draftId] = { ok: false, blockingIssues: [{ category: 'שגיאה בבדיקה', text: detail }], warnings: [] };
      } else {
        draftVerifications[draftId] = json;
      }
      renderVerifyResult(draftId);
    } catch (e) {
      draftVerifications[draftId] = { ok: false, blockingIssues: [{ category: 'שגיאה בבדיקה', text: String(e && e.message ? e.message : e) }], warnings: [] };
      renderVerifyResult(draftId);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
  };

  function renderVerifyResult(draftId) {
    const resultEl = document.getElementById('draft-verify-' + draftId);
    const result = draftVerifications[draftId];
    if (!resultEl || !result) return;
    if (result.ok) {
      let html = '<div style="font-size:0.78rem;color:#2ecc71;margin-top:6px;font-weight:600;">✓ עברה בדיקה — לא נמצאו בעיות אמינות מול המקור</div>';
      if (result.warnings && result.warnings.length) {
        html += '<div style="font-size:0.74rem;color:var(--adm-muted);margin-top:3px;">אזהרות סגנון (לא חוסמות פרסום): ' +
          result.warnings.map(function (w) { return escapeAttr(w.text); }).join(' · ') + '</div>';
      }
      resultEl.innerHTML = html;
    } else {
      const issues = (result.blockingIssues || []).map(function (i) {
        return '<li>' + escapeAttr(i.category) + ': ' + escapeAttr(i.text) + '</li>';
      }).join('');
      let html = '<div style="font-size:0.78rem;color:#e74c3c;margin-top:6px;font-weight:600;">✕ נמצאו בעיות — פרסום חסום עד אישור מפורש</div>' +
        '<ul style="font-size:0.74rem;color:var(--adm-muted);margin:4px 0 0;padding-inline-start:16px;">' + issues + '</ul>';

      const suggestions = result.fieldSuggestions || {};
      const fieldsWithSuggestion = Object.keys(suggestions);
      if (fieldsWithSuggestion.length) {
        const fieldLabels = { headline: 'כותרת', subheadline: 'כותרת משנה', body: 'גוף הכתבה', flash_headline: 'כותרת מבזק', flash_body: 'גוף מבזק' };
        html += '<div style="font-size:0.74rem;color:var(--adm-muted);margin-top:8px;font-weight:600;">💡 הצעות תיקון (לא מוחלות אוטומטית — אתה מאשר):</div>';
        html += fieldsWithSuggestion.map(function (field) {
          const label = fieldLabels[field] || field;
          const full = suggestions[field] || '';
          const preview = escapeAttr(full.length > 200 ? full.slice(0, 200) + '…' : full);
          return '<div style="border:1px solid #444;border-radius:6px;padding:6px 8px;margin-top:4px;">' +
            '<div style="font-size:0.73rem;font-weight:600;margin-bottom:2px;">' + escapeAttr(label) + '</div>' +
            '<div style="font-size:0.72rem;color:var(--adm-muted);white-space:pre-wrap;">' + preview + '</div>' +
            '<button class="tbl-btn" style="margin-top:4px;font-size:0.72rem;" onclick="applyDraftFix(' + draftId + ',\'' + field + '\',this)">✓ אמץ תיקון לשדה זה</button>' +
          '</div>';
        }).join('');
      }
      resultEl.innerHTML = html;
    }
  }

  // מחליף שדה בודד בטיוטה בטקסט המוצע שהתקבל מהבדיקה. לא רץ אוטומטית —
  // רק כשהמשתמש לוחץ במפורש "אמץ תיקון". אחרי האימוץ, תוצאת הבדיקה
  // הקודמת נמחקת (כי התוכן השתנה) ומבקשים להריץ בדיקה מחדש כדי לוודא
  // שהבעיה אכן נפתרה — לא סומכים עיוורת על התיקון המוצע.
  window.applyDraftFix = async function (draftId, field, btn) {
    const client = initNewsClient();
    if (!client) return;
    const result = draftVerifications[draftId];
    const suggestion = result && result.fieldSuggestions && result.fieldSuggestions[field];
    if (!suggestion) { alert('אין הצעת תיקון זמינה לשדה הזה.'); return; }
    if (!confirm('להחליף את השדה בטקסט המוצע?\n\nמומלץ להריץ שוב "🔍 בדוק תקינות" אחרי האימוץ כדי לוודא שהבעיה נפתרה בפועל.')) return;
    const originalText = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = 'שומר...'; }
    try {
      const update = {};
      update[field] = suggestion;
      const { error } = await client.from('news_drafts').update(update).eq('id', draftId);
      if (error) { alert('שגיאה בשמירת התיקון: ' + error.message); return; }
      delete draftVerifications[draftId];
      const resultEl = document.getElementById('draft-verify-' + draftId);
      if (resultEl) resultEl.innerHTML = '<div style="font-size:0.76rem;color:var(--adm-muted);margin-top:6px;">✓ התיקון נשמר בטיוטה. לחץ שוב "🔍 בדוק תקינות" כדי לוודא שהבעיה נפתרה.</div>';
    } catch (e) {
      alert('שגיאה בשמירת התיקון: ' + (e && e.message ? e.message : e));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
  };

  window.loadDraftIntoForm = async function (draftId) {
    const client = initNewsClient();
    if (!client) return;

    const verification = draftVerifications[draftId];
    if (!verification || !verification.ok) {
      const issuesText = (verification && verification.blockingIssues && verification.blockingIssues.length)
        ? verification.blockingIssues.map(function (i) { return '• ' + i.category + ': ' + i.text; }).join('\n')
        : 'הטיוטה הזו עוד לא עברה בדיקת תקינות. מומלץ ללחוץ קודם "🔍 בדוק תקינות".';
      const proceed = confirm(
        '⚠️ אזהרה — הכתבה לא אושרה בבדיקת התקינות:\n\n' + issuesText +
        '\n\nלהמשיך בכל זאת לטעינה ופרסום? (לא מומלץ בלי לבדוק ידנית את מה שסומן)'
      );
      if (!proceed) return;
    }

    try {
      const { data: draft, error } = await client.from('news_drafts').select('*').eq('id', draftId).single();
      if (error || !draft) { alert('שגיאה בטעינת הטיוטה.'); return; }

      // עוברים ללשונית "כתבה חדשה" ומאכלסים את הטופס הרגיל
      const newTabBtn = document.querySelector('.admin-tab[onclick*="adminTab(\'new\'"]');
      if (typeof window.adminTab === 'function' && newTabBtn) window.adminTab('new', newTabBtn);

      // טיוטה = תמיד כתבה חדשה. מנקים את הטופס לפני המילוי, כדי ששאריות ממצב עריכה קודם
      // (editId של כתבה קיימת, ציון, תגיות, קטגוריות נוספות, גלריה) לא יגרמו לפרסום לדרוס כתבה ישנה.
      // באג 8.10.2026: כתבת ה-BMW נשמרה על #93 (מבחן אומודה 7) כי editId נשאר מעריכה קודמת.
      if (typeof window.clearForm === 'function') {
        window.clearForm();
      } else {
        const t = document.getElementById('a-title');
        if (t) { delete t.dataset.editId; delete t.dataset.srcUid; }
      }

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
