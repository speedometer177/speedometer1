/*
 * ads.js — מערכת מודעות ידניות עצמאית — ספידומטר
 * ---------------------------------------------------------------
 * קובץ עצמאי לחלוטין. לא נוגע ולא תלוי ב-app.js.
 * להשבתה מלאה: פשוט הסר את שורת ה-<script src="/ads.js" defer>
 * מ-index.html, שום דבר אחר באתר לא ישתנה.
 *
 * מה זה עושה:
 *   1. בצד הציבורי — שולף מ-Supabase מודעה לכל אחד מ-8 המיקומים
 *      האפשריים, עם lazy-load אמיתי (IntersectionObserver), timeout
 *      בטיחות (5 שניות — אם אין תשובה, השטח נעלם כרגיל ולא נשאר
 *      נראה כטוען לנצח), כפתור סגירה (X, פינה ימנית-עליונה) שתקף
 *      עד לרענון הבא בלבד (בזיכרון, לא נשמר), תמיכה בתמונה או וידאו,
 *      וסבב אוטומטי (carousel) כשיש כמה מודעות לאותו מיקום.
 *      שני הבאנרים העליונים (לפני ה-Hero / בתוך כתבה) יושבים ממש
 *      מעל ה-header, ומתחלפים ביניהם לפי body.article-open.
 *      הסקייסקרייפרים הצדדיים עוקבים אחרי הגלילה בגבולות הדף
 *      (לא חוצים את ה-header למעלה ולא את ה-footer למטה).
 *   2. בפאנל האדמין — לשונית "מודעות": טופס להוספה/עריכה (כולל
 *      וידאו + רמז רזולוציה מדויק לכל מיקום), טבלת ניהול עם
 *      הפעלה/כיבוי/עריכה/מחיקה, ודוח PDF ממותג לכל מודעה.
 *
 * אבטחה: כל סינון "רק מודעות פעילות ובתוקף תאריכים" נאכף ברמת
 * ה-RLS ב-Supabase — כך שגם אם מישהו ישנה את קוד הלקוח, לא ניתן
 * לחשוף מודעות כבויות/פגות תוקף.
 * ---------------------------------------------------------------
 */
(function () {
  'use strict';

  const SB_URL = 'https://kaykrrnmykqrfhawgtqt.supabase.co';
  const SB_KEY = 'sb_publishable_Ms6YFTnADm-qAd9617Ey9A_D3x-Zumi'; // מפתח ציבורי (publishable), בטוח לחשיפה
  let adsClient = null;
  let currentAdFile = null;
  let currentAdFileMobile = null;
  let editingAdId = null; // אם לא null — הטופס במצב "עריכה" ולא "הוספה"

  const FETCH_TIMEOUT_MS = 5000; // אחרי כמה זמן מוותרים ומסתירים את הסלוט, במקום להשאיר shimmer לנצח

  // סלוטים עם כפתור סגירה (X) — אלה שיושבים "מעל" תוכן, לא בתוך זרימת הרשימה
  const DISMISSIBLE_SLOTS = ['top_leaderboard', 'article_top'];
  // סלוטים שמסתובבים אוטומטית בין כמה מודעות (carousel) אם יש יותר מאחת
  const CAROUSEL_SLOTS = ['top_leaderboard'];
  // סלוטים עם תגית "מודעה" גלויה (שאר הסלוטים מציגים את התגית דרך ה-head הייעודי שלהם)
  const TAG_SLOTS = ['home_banner', 'feed_native', 'top_leaderboard', 'article_top', 'sidebar_left', 'sidebar_right'];

  const SLOT_LABELS = {
    top_leaderboard: 'באנר עליון — מעל הכל (דף הבית)',
    home_banner: 'באנר אחרי Hero',
    feed_native: 'בתוך הפיד',
    sidebar: 'סיידבר',
    article_top: 'באנר עליון — מעל הכל (בתוך כתבה)',
    article_body: 'בתוך כתבה (בסוף)',
    sidebar_left: 'סקייסקרייפר שמאלי',
    sidebar_right: 'סקייסקרייפר ימני'
  };

  // רזולוציה מומלצת מדויקת לכל סלוט — לפי ה-aspect-ratio שהוגדר ב-CSS
  const SLOT_DIMENSIONS = {
    top_leaderboard: 'מחשב: 1200×133 פיקסל (יחס 9:1) · מובייל (אופציונלי): 1125×878 פיקסל (יחס 1.281:1)',
    home_banner: '1200×160 פיקסל (יחס 7.5:1) — במובייל יחתך ל-2.6:1',
    feed_native: '1200×310 פיקסל (יחס 5:1.3) — במובייל יחתך ל-16:9',
    sidebar: '400×400 פיקסל (ריבוע 1:1)',
    article_top: 'מחשב: 1200×133 פיקסל (יחס 9:1) · מובייל (אופציונלי): 1125×878 פיקסל (יחס 1.281:1)',
    article_body: '1200×300 פיקסל (יחס 4:1) — במובייל יחתך ל-16:9',
    sidebar_left: '160×600 פיקסל (סקייסקרייפר סטנדרטי)',
    sidebar_right: '160×600 פיקסל (סקייסקרייפר סטנדרטי)'
  };

  // סלוטים שיכולים לקבל תמונת מובייל ייעודית נפרדת (הבאנר האמיתי שנראה
  // בעמוד הראשון, לפני שגוללים — לכן חשוב שם יותר מכל מקום אחר)
  const MOBILE_IMAGE_SLOTS = ['top_leaderboard', 'article_top'];

  function escapeAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function initAdsClient() {
    if (window.supabase && !adsClient) {
      try { adsClient = window.supabase.createClient(SB_URL, SB_KEY); } catch (e) { console.error('[ads.js] יצירת חיבור ל-Supabase נכשלה:', e); }
    }
    return adsClient;
  }

  function whenSupabaseReady(cb) {
    if (window.supabase) { initAdsClient(); cb(); return; }
    let tries = 0;
    const iv = setInterval(function () {
      tries++;
      if (window.supabase) { clearInterval(iv); initAdsClient(); cb(); }
      else if (tries > 100) { clearInterval(iv); console.error('[ads.js] Supabase לא נטען תוך 10 שניות — המודעות לא יוצגו.'); } // ~10 שניות ואז מוותר
    }, 100);
  }

  function loadScriptOnce(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('load failed: ' + src)); };
      document.head.appendChild(s);
    });
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise(function (resolve) { setTimeout(function () { resolve(null); }, ms); })
    ]);
  }

  // ═══════════ תצוגה ציבורית ═══════════

  async function fetchAdsForSlot(slot) {
    if (!adsClient) return [];
    try {
      const { data, error } = await adsClient
        .from('ads')
        .select('id,image_url,image_url_mobile,link_url,alt_text,media_type')
        .eq('slot', slot);
      if (error) { console.error('[ads.js] שגיאה בשליפת מודעות לסלוט "' + slot + '":', error.message); return []; }
      return data || [];
    } catch (e) { console.error('[ads.js] חריגה בשליפת מודעות לסלוט "' + slot + '":', e); return []; }
  }

  // מעקב "נסגר" בזיכרון בלבד — לא נשמר בשום storage בכוונה.
  // כך מודעה שנסגרה חוזרת אוטומטית בכל רענון/טעינה מחדש של הדף,
  // ונשארת סגורה רק כל עוד אותה טעינת דף עדיין פעילה בדפדפן.
  const dismissedThisPageLoad = new Set();
  function isDismissed(slot) { return dismissedThisPageLoad.has(slot); }
  function markDismissed(slot) { dismissedThisPageLoad.add(slot); }

  function pickImageSrc(ad) {
    // באותו breakpoint שבו ה-CSS עצמו עובר לפריסת מובייל (680px) —
    // כדי שהתמונה שנבחרת תמיד תואמת לפרופורציה שה-CSS בפועל מציג.
    if (window.innerWidth <= 680 && ad.image_url_mobile) return ad.image_url_mobile;
    return ad.image_url;
  }

  function mediaTagHtml(ad) {
    const src = pickImageSrc(ad);
    if (ad.media_type === 'video') {
      return '<video autoplay muted loop playsinline preload="metadata" src="' + escapeAttr(src) +
        '" aria-label="' + escapeAttr(ad.alt_text || 'מודעה') + '" onloadeddata="this.classList.add(\'loaded\')"></video>';
    }
    return '<img loading="lazy" src="' + escapeAttr(src) + '" alt="' + escapeAttr(ad.alt_text || 'מודעה') +
      '" onload="this.classList.add(\'loaded\')">';
  }

  function closeButtonHtml() {
    return '<button type="button" class="ad-close" aria-label="סגור מודעה" title="סגור מודעה">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>';
  }

  function bindAdInteractions(container, ad, slot) {
    const link = container.querySelector('a[data-ad-id]');
    if (link) {
      link.addEventListener('click', function () {
        if (!adsClient) return;
        adsClient.rpc('increment_ad_click', { ad_id: ad.id }).then(function (res) {
          if (res && res.error) console.error('[ads.js] עדכון מונה קליקים נכשל (מודעה ' + ad.id + '):', res.error.message);
        });
      });
    }
    const closeBtn = container.querySelector('.ad-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        markDismissed(slot);
        container.classList.add('ad-dismissed');
      });
    }
  }

  function renderSingleAd(container, ad, slot) {
    const showTag = TAG_SLOTS.indexOf(slot) !== -1;
    const showClose = DISMISSIBLE_SLOTS.indexOf(slot) !== -1;
    const linkHtml =
      '<a href="' + escapeAttr(ad.link_url) + '" target="_blank" rel="noopener sponsored" data-ad-id="' + ad.id + '">' +
      mediaTagHtml(ad) +
      (showTag ? '<span class="ad-tag"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="9"/></svg>מודעה</span>' : '') +
      '</a>' +
      (showClose ? closeButtonHtml() : '');

    let target = container;
    if (slot === 'sidebar') target = container.querySelector('.ad-slot-sidebar-body') || container;
    else if (slot === 'article_body') target = container.querySelector('.ad-slot-article-body') || container;

    target.innerHTML = linkHtml;
    container.classList.add('has-ad');
    container.classList.remove('no-ad');
    bindAdInteractions(container, ad, slot);
  }

  function trackImpressionOnce(container, adId) {
    if (!adsClient) return;
    function fire() {
      adsClient.rpc('increment_ad_impression', { ad_id: adId }).then(function (res) {
        if (res && res.error) console.error('[ads.js] עדכון מונה צפיות נכשל (מודעה ' + adId + '):', res.error.message);
      });
    }
    if (!('IntersectionObserver' in window)) { fire(); return; }
    const obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { fire(); obs.disconnect(); }
      });
    }, { threshold: 0.5 });
    obs.observe(container);
  }

  function startCarousel(container, ads, slot) {
    let idx = 0;
    renderSingleAd(container, ads[0], slot);
    trackImpressionOnce(container, ads[0].id);
    if (ads.length < 2) return;
    const timer = setInterval(function () {
      if (container.classList.contains('ad-dismissed')) { clearInterval(timer); return; }
      idx = (idx + 1) % ads.length;
      container.classList.remove('has-ad');
      setTimeout(function () {
        renderSingleAd(container, ads[idx], slot);
        trackImpressionOnce(container, ads[idx].id);
      }, 60);
    }, 6000);
  }

  async function loadAndRender(container, slot) {
    if (isDismissed(slot)) {
      container.classList.add('ad-dismissed');
      return;
    }
    // withTimeout: אם השרת לא עונה תוך 5 שניות (רשת איטית, בעיית RLS, וכו') —
    // מתייחסים לזה כמו "אין מודעה" ומסתירים את השטח, במקום להשאיר shimmer לנצח.
    const ads = await withTimeout(fetchAdsForSlot(slot), FETCH_TIMEOUT_MS);
    if (!ads || !ads.length) {
      container.classList.add('no-ad');
      container.style.setProperty('display', 'none', 'important'); // ביטחון כפול — לא תלוי רק במחלקת CSS
      return;
    }
    if (CAROUSEL_SLOTS.indexOf(slot) !== -1 && ads.length > 1) {
      startCarousel(container, ads, slot);
    } else {
      const ad = ads[Math.floor(Math.random() * ads.length)];
      renderSingleAd(container, ad, slot);
      trackImpressionOnce(container, ad.id);
    }
  }

  // סלוטים אלה תמיד נמצאים בתוך המסך הראשוני (ממש מעל ה-header) — אין טעם
  // "לחכות לגלילה" כמו סלוטים אחרים; ככל שההחלטה יש/אין מודעה מתקבלת מוקדם
  // יותר, כך קטן הסיכוי שקריסת ה-shimmer (אם אין מודעה) תיספר כ-CLS.
  const EAGER_SLOTS = ['top_leaderboard', 'article_top', 'sidebar_left', 'sidebar_right'];

  function setupLazySlot(container) {
    const slot = container.getAttribute('data-ad-slot');
    if (!slot) return;
    if (isDismissed(slot)) { container.classList.add('ad-dismissed'); return; }
    if (EAGER_SLOTS.indexOf(slot) !== -1 || !('IntersectionObserver' in window)) {
      loadAndRender(container, slot);
      return;
    }
    const obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          obs.disconnect();
          loadAndRender(container, slot);
        }
      });
    }, { rootMargin: '200px' });
    obs.observe(container);
  }

  function initPublicSlots() {
    document.querySelectorAll('.ad-slot[data-ad-slot]').forEach(setupLazySlot);
  }

  // סלוט "article_top" יושב קבוע מעל ה-header (משותף לכל הדף), ולכן לא
  // נבנה מחדש בין כתבה לכתבה — אבל article_body יושב בתוך #art-body
  // שמתחלף בלי רענון מלא, ולכן צריך לעקוב אחריו ולרענן את המודעה.
  function watchArticleChanges() {
    const artBody = document.getElementById('art-body');
    if (!artBody) return;
    const mo = new MutationObserver(function () {
      const slotEl = document.getElementById('ad-article-body');
      if (!slotEl) return;
      slotEl.classList.remove('has-ad', 'no-ad', 'ad-dismissed');
      const inner = slotEl.querySelector('.ad-slot-article-body');
      if (inner) inner.innerHTML = '';
      setupLazySlot(slotEl);
    });
    mo.observe(artBody, { childList: true });
  }

  // ═══════════ סקייסקרייפרים צדדיים — מיקום קבוע, לא זז בגלילה ═══════════
  // מיקום ה-top קבוע לגמרי ב-CSS (לא מחושב ולא משתנה ב-JS בזמן גלילה) —
  // כי חישוב מחדש בכל scroll הוא בדיוק מה שגרם לרגרסיה חמורה ב-CLS
  // (המודעה "זזה" בעיני הדפדפן בכל פריים גלילה, וזה נספר כקפיצת פריסה).
  // הגבול היחיד שעדיין נשמר: כש-footer השחור מתקרב, מסתירים לגמרי —
  // דרך IntersectionObserver, שלא רץ בכל פריים אלא רק כשחוצים את הסף,
  // ולכן לא גורם לאותה בעיה.
  function initSkyscraperBounds() {
    const left = document.getElementById('ad-sidebar-left');
    const right = document.getElementById('ad-sidebar-right');
    if (!left && !right) return;

    const footer = document.getElementById('main-footer');
    if (!footer || !('IntersectionObserver' in window)) return; // בלי footer/תמיכה — נשארות קבועות תמיד, בלי הגבלה תחתונה

    const obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        const nearFooter = entry.isIntersecting;
        if (left) left.classList.toggle('sky-footer-near', nearFooter);
        if (right) right.classList.toggle('sky-footer-near', nearFooter);
      });
    }, { rootMargin: '0px 0px 200px 0px' }); // מתחיל להסתיר כ-200px לפני שה-footer בפועל נכנס למסך (השוליים למטה, כי הוא מגיע מלמטה בגלילה)
    obs.observe(footer);
  }

  // ═══════════ פאנל ניהול (אדמין) ═══════════

  window.onAdMediaTypeChange = function () {
    const type = document.getElementById('ad-media-type').value;
    const fileInput = document.getElementById('ad-image-file');
    const btnLabel = document.getElementById('ad-file-btn-label');
    const hint = document.getElementById('ad-media-hint');
    if (!fileInput) return;
    if (type === 'video') {
      fileInput.accept = 'video/mp4,video/webm';
      if (btnLabel) btnLabel.textContent = 'בחר וידאו';
      if (hint) hint.textContent = 'MP4 / WEBM — עד 15MB, ללא דחיסה (מוצג ללא קול, בלולאה)';
    } else {
      fileInput.accept = 'image/*';
      if (btnLabel) btnLabel.textContent = 'בחר תמונה';
      if (hint) hint.textContent = 'JPG / PNG / WEBP — תידחס אוטומטית';
    }
  };

  window.onAdSlotChange = function () {
    const slot = document.getElementById('ad-slot-select').value;
    const dimHint = document.getElementById('ad-dim-hint');
    if (dimHint) dimHint.textContent = 'רזולוציה מומלצת: ' + (SLOT_DIMENSIONS[slot] || '—');
    const mobileRow = document.getElementById('ad-mobile-image-row');
    if (mobileRow) mobileRow.style.display = MOBILE_IMAGE_SLOTS.indexOf(slot) !== -1 ? '' : 'none';
  };

  function initAdsAdminIfNeeded() {
    const fileInput = document.getElementById('ad-image-file');
    if (!fileInput) return; // המבנה עוד לא קיים ב-HTML הזה — לא עושים כלום

    window.onAdSlotChange(); // ממלא את רמז הרזולוציה מיד עם טעינת העמוד

    fileInput.addEventListener('change', async function () {
      const f = fileInput.files && fileInput.files[0];
      const status = document.getElementById('ad-upload-status');
      const preview = document.getElementById('ad-upload-preview');
      currentAdFile = null;
      if (!f) return;

      const isVideo = f.type.indexOf('video') === 0;

      if (isVideo) {
        currentAdFile = f;
        if (status) { status.textContent = f.name + ' (' + Math.round(f.size / 1024) + 'KB) — ללא דחיסה'; status.style.color = 'var(--muted)'; }
        if (preview) preview.innerHTML = '<video src="' + URL.createObjectURL(f) + '" style="max-width:220px;border-radius:6px;display:block;" muted autoplay loop playsinline></video>';
        return;
      }

      if (status) { status.textContent = 'מדחס תמונה...'; status.style.color = 'var(--muted)'; }
      if (preview) preview.innerHTML = '';

      if (typeof window.compressImageFile !== 'function') {
        currentAdFile = f;
        if (status) { status.textContent = '⚠️ לא ניתן לדחוס — תועלה התמונה המקורית (' + Math.round(f.size / 1024) + 'KB)'; status.style.color = '#f59e0b'; }
        if (preview) preview.innerHTML = '<img src="' + URL.createObjectURL(f) + '" style="max-width:220px;border-radius:6px;display:block;">';
        return;
      }

      try {
        const compressed = await window.compressImageFile(f, 250);
        if (!compressed) {
          if (status) { status.textContent = '❌ לא ניתן לקרוא את התמונה. נסה JPG או PNG (במקום HEIC).'; status.style.color = 'var(--red)'; }
          fileInput.value = '';
          return;
        }
        currentAdFile = compressed;
        if (status) { status.textContent = '✅ נדחסה בהצלחה (' + Math.round(compressed.size / 1024) + 'KB)'; status.style.color = '#22c55e'; }
        if (preview) preview.innerHTML = '<img src="' + URL.createObjectURL(compressed) + '" style="max-width:220px;border-radius:6px;display:block;">';
      } catch (e) {
        if (status) { status.textContent = 'שגיאה בדחיסת התמונה — נסה שוב'; status.style.color = 'var(--red)'; }
        fileInput.value = '';
      }
    });

    const fileInputMobile = document.getElementById('ad-image-file-mobile');
    if (fileInputMobile) {
      fileInputMobile.addEventListener('change', async function () {
        const f = fileInputMobile.files && fileInputMobile.files[0];
        const status = document.getElementById('ad-upload-status-mobile');
        const preview = document.getElementById('ad-upload-preview-mobile');
        currentAdFileMobile = null;
        if (!f) return;

        if (status) { status.textContent = 'מדחס תמונה...'; status.style.color = 'var(--muted)'; }
        if (preview) preview.innerHTML = '';

        if (typeof window.compressImageFile !== 'function') {
          currentAdFileMobile = f;
          if (status) { status.textContent = '⚠️ לא ניתן לדחוס — תועלה התמונה המקורית (' + Math.round(f.size / 1024) + 'KB)'; status.style.color = '#f59e0b'; }
          if (preview) preview.innerHTML = '<img src="' + URL.createObjectURL(f) + '" style="max-width:200px;border-radius:6px;display:block;">';
          return;
        }

        try {
          const compressed = await window.compressImageFile(f, 200);
          if (!compressed) {
            if (status) { status.textContent = '❌ לא ניתן לקרוא את התמונה. נסה JPG או PNG (במקום HEIC).'; status.style.color = 'var(--red)'; }
            fileInputMobile.value = '';
            return;
          }
          currentAdFileMobile = compressed;
          if (status) { status.textContent = '✅ נדחסה בהצלחה (' + Math.round(compressed.size / 1024) + 'KB)'; status.style.color = '#22c55e'; }
          if (preview) preview.innerHTML = '<img src="' + URL.createObjectURL(compressed) + '" style="max-width:200px;border-radius:6px;display:block;">';
        } catch (e) {
          if (status) { status.textContent = 'שגיאה בדחיסת התמונה — נסה שוב'; status.style.color = 'var(--red)'; }
          fileInputMobile.value = '';
        }
      });
    }

    // עוטפים את adminTab הקיים כדי להוסיף לו תמיכה בלשונית "ads" בלי לגעת ב-app.js
    if (typeof window.adminTab === 'function' && !window.__adsAdminTabWrapped) {
      const originalAdminTab = window.adminTab;
      window.adminTab = function (tab, btnEl) {
        originalAdminTab(tab, btnEl);
        const adsPanel = document.getElementById('admin-ads');
        if (!adsPanel) return;
        adsPanel.style.display = tab === 'ads' ? '' : 'none';
        if (tab === 'ads') loadAdsTable();
      };
      window.__adsAdminTabWrapped = true;
    }
  }

  window.clearAdForm = function () {
    const ids = ['ad-link-url', 'ad-alt-text', 'ad-start-date', 'ad-end-date', 'ad-advertiser-name'];
    ids.forEach(function (id) { const el = document.getElementById(id); if (el) el.value = ''; });
    const slotSel = document.getElementById('ad-slot-select'); if (slotSel) slotSel.value = 'top_leaderboard';
    window.onAdSlotChange();
    const mediaSel = document.getElementById('ad-media-type'); if (mediaSel) { mediaSel.value = 'image'; window.onAdMediaTypeChange(); }
    const fileInput = document.getElementById('ad-image-file'); if (fileInput) fileInput.value = '';
    const status = document.getElementById('ad-upload-status'); if (status) status.textContent = '';
    const preview = document.getElementById('ad-upload-preview'); if (preview) preview.innerHTML = '';
    currentAdFile = null;
    const fileInputMobile = document.getElementById('ad-image-file-mobile'); if (fileInputMobile) fileInputMobile.value = '';
    const statusMobile = document.getElementById('ad-upload-status-mobile'); if (statusMobile) statusMobile.textContent = '';
    const previewMobile = document.getElementById('ad-upload-preview-mobile'); if (previewMobile) previewMobile.innerHTML = '';
    currentAdFileMobile = null;
    editingAdId = null;
    const submitBtn = document.getElementById('ad-submit-btn'); if (submitBtn) submitBtn.textContent = 'פרסם מודעה';
    const formTitle = document.getElementById('ad-form-title'); if (formTitle) formTitle.textContent = 'הוספת מודעה חדשה';
    const cancelBtn = document.getElementById('ad-cancel-edit-btn'); if (cancelBtn) cancelBtn.style.display = 'none';
  };

  window.startEditAd = async function (id) {
    if (!adsClient) return;
    try {
      const { data: ad, error } = await adsClient.from('ads').select('*').eq('id', id).single();
      if (error || !ad) { alert('שגיאה בטעינת המודעה לעריכה.'); return; }

      editingAdId = id;
      document.getElementById('ad-slot-select').value = ad.slot;
      window.onAdSlotChange();
      document.getElementById('ad-media-type').value = ad.media_type || 'image';
      window.onAdMediaTypeChange();
      document.getElementById('ad-link-url').value = ad.link_url || '';
      document.getElementById('ad-alt-text').value = ad.alt_text || '';
      document.getElementById('ad-advertiser-name').value = ad.advertiser_name || '';
      document.getElementById('ad-start-date').value = ad.start_date ? isoToLocalInput(ad.start_date) : '';
      document.getElementById('ad-end-date').value = ad.end_date ? isoToLocalInput(ad.end_date) : '';

      const preview = document.getElementById('ad-upload-preview');
      const status = document.getElementById('ad-upload-status');
      if (status) { status.textContent = 'קובץ נוכחי — ניתן להשאיר כמו שהוא, או לבחור קובץ חדש כדי להחליף'; status.style.color = 'var(--muted)'; }
      if (preview) {
        preview.innerHTML = ad.media_type === 'video'
          ? '<video src="' + escapeAttr(ad.image_url) + '" style="max-width:220px;border-radius:6px;display:block;" muted autoplay loop playsinline></video>'
          : '<img src="' + escapeAttr(ad.image_url) + '" style="max-width:220px;border-radius:6px;display:block;">';
      }
      currentAdFile = null; // לא בוחרים קובץ חדש כברירת מחדל — נשתמש בקיים אם לא ייבחר אחר

      const previewMobile = document.getElementById('ad-upload-preview-mobile');
      const statusMobile = document.getElementById('ad-upload-status-mobile');
      if (ad.image_url_mobile) {
        if (statusMobile) { statusMobile.textContent = 'קיימת תמונת מובייל — ניתן להשאיר או להחליף'; statusMobile.style.color = 'var(--muted)'; }
        if (previewMobile) previewMobile.innerHTML = '<img src="' + escapeAttr(ad.image_url_mobile) + '" style="max-width:200px;border-radius:6px;display:block;">';
      } else {
        if (statusMobile) statusMobile.textContent = '';
        if (previewMobile) previewMobile.innerHTML = '';
      }
      currentAdFileMobile = null;

      const submitBtn = document.getElementById('ad-submit-btn'); if (submitBtn) submitBtn.textContent = 'שמור שינויים';
      const formTitle = document.getElementById('ad-form-title'); if (formTitle) formTitle.textContent = 'עריכת מודעה #' + id;
      const cancelBtn = document.getElementById('ad-cancel-edit-btn'); if (cancelBtn) cancelBtn.style.display = '';

      if (typeof window.adminTab === 'function') {
        const newTabBtn = document.querySelector('.admin-tab[onclick*="\'new\'"]');
        window.adminTab('new', newTabBtn || document.querySelector('.admin-tab'));
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { alert('שגיאה בטעינת המודעה לעריכה.'); }
  };

  function isoToLocalInput(iso) {
    try {
      const d = new Date(iso);
      const pad = function (n) { return String(n).padStart(2, '0'); };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    } catch (e) { return ''; }
  }

  window.publishAd = async function () {
    if (!adsClient) { alert('אין חיבור לשרת — נסה לרענן את הדף.'); return; }

    const slot = document.getElementById('ad-slot-select').value;
    const mediaType = document.getElementById('ad-media-type').value;
    const linkUrl = document.getElementById('ad-link-url').value.trim();
    const altText = document.getElementById('ad-alt-text').value.trim();
    const startDate = document.getElementById('ad-start-date').value;
    const endDate = document.getElementById('ad-end-date').value;
    const advertiserName = document.getElementById('ad-advertiser-name').value.trim();

    if (!linkUrl) { alert('נא להזין קישור יעד למודעה.'); return; }
    if (!/^https?:\/\//i.test(linkUrl)) { alert('הקישור חייב להתחיל ב-http:// או https://'); return; }
    if (!editingAdId && !currentAdFile) { alert('נא לבחור קובץ למודעה.'); return; }

    try {
      const { data: sessData } = await adsClient.auth.getSession();
      if (!sessData || !sessData.session) {
        alert('פג תוקף ההתחברות. אנא התחבר מחדש כדי לפרסם.');
        if (typeof window.openAdminLogin === 'function') window.openAdminLogin();
        return;
      }
    } catch (e) {}

    let publicUrl = null;
    if (currentAdFile) {
      const fileToUpload = currentAdFile;
      const ext = (fileToUpload.name.split('.').pop() || (mediaType === 'video' ? 'mp4' : 'jpg')).toLowerCase();
      const path = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      try {
        const { error: upErr } = await adsClient.storage.from('ad-images')
          .upload(path, fileToUpload, { contentType: fileToUpload.type, upsert: false, cacheControl: '31536000' });
        if (upErr) { alert('שגיאה בהעלאת הקובץ: ' + upErr.message); return; }
        const { data: pub } = adsClient.storage.from('ad-images').getPublicUrl(path);
        publicUrl = pub && pub.publicUrl ? pub.publicUrl : null;
      } catch (e) { alert('שגיאה בהעלאת הקובץ.'); return; }
      if (!publicUrl) { alert('שגיאה בהעלאת הקובץ.'); return; }
    }

    let publicUrlMobile = null;
    if (currentAdFileMobile) {
      const ext = (currentAdFileMobile.name.split('.').pop() || 'jpg').toLowerCase();
      const path = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-mobile.' + ext;
      try {
        const { error: upErr } = await adsClient.storage.from('ad-images')
          .upload(path, currentAdFileMobile, { contentType: currentAdFileMobile.type, upsert: false, cacheControl: '31536000' });
        if (upErr) { alert('שגיאה בהעלאת תמונת המובייל: ' + upErr.message); return; }
        const { data: pub } = adsClient.storage.from('ad-images').getPublicUrl(path);
        publicUrlMobile = pub && pub.publicUrl ? pub.publicUrl : null;
      } catch (e) { alert('שגיאה בהעלאת תמונת המובייל.'); return; }
    }

    const row = {
      slot: slot,
      media_type: mediaType,
      link_url: linkUrl,
      alt_text: altText,
      advertiser_name: advertiserName,
      start_date: startDate ? new Date(startDate).toISOString() : null,
      end_date: endDate ? new Date(endDate).toISOString() : null
    };
    if (publicUrl) row.image_url = publicUrl; // רק אם הועלה קובץ חדש — אחרת משאירים את הקיים
    if (publicUrlMobile) row.image_url_mobile = publicUrlMobile;

    try {
      if (editingAdId) {
        const { data, error } = await adsClient.from('ads').update(row).eq('id', editingAdId).select();
        if (error) { alert('שגיאה בעדכון המודעה: ' + error.message); return; }
        if (!data || !data.length) { alert('העדכון לא בוצע בפועל — כנראה שההתחברות לניהול פגה. התחבר מחדש ונסה שוב.'); console.error('[ads.js] publishAd (update): 0 שורות עודכנו. id=' + editingAdId); return; }
        alert('המודעה עודכנה בהצלחה!');
      } else {
        row.active = true;
        const { data, error } = await adsClient.from('ads').insert(row).select();
        if (error) { alert('שגיאה בפרסום המודעה: ' + error.message); return; }
        if (!data || !data.length) { alert('הפרסום לא בוצע בפועל — כנראה שההתחברות לניהול פגה. התחבר מחדש ונסה שוב.'); console.error('[ads.js] publishAd (insert): 0 שורות נוצרו.'); return; }
        alert('המודעה פורסמה בהצלחה!');
      }
      window.clearAdForm();
      loadAdsTable();
    } catch (e) { alert('שגיאה בשמירת המודעה.'); }
  };

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('he-IL') + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso; }
  }

  async function loadAdsTable() {
    const table = document.getElementById('admin-ads-table');
    if (!table || !adsClient) return;
    table.innerHTML = '<tr><td style="padding:20px;text-align:center;color:var(--muted);">טוען...</td></tr>';
    try {
      const { data, error } = await adsClient.from('ads').select('*').order('created_at', { ascending: false });
      if (error) { table.innerHTML = '<tr><td style="padding:20px;text-align:center;color:var(--muted);">שגיאה בטעינת המודעות: ' + escapeAttr(error.message) + '</td></tr>'; console.error('[ads.js] טעינת טבלת המודעות נכשלה:', error); return; }
      if (!data || !data.length) { table.innerHTML = '<tr><td style="padding:20px;text-align:center;color:var(--muted);">אין מודעות עדיין.</td></tr>'; return; }
      let html = '<tr><th>תצוגה</th><th>מיקום</th><th>מפרסם</th><th>צפיות</th><th>קליקים</th><th>סטטוס</th><th>פעולות</th></tr>';
      data.forEach(function (ad) {
        const thumb = ad.media_type === 'video'
          ? '<video src="' + escapeAttr(ad.image_url) + '" style="width:70px;height:40px;object-fit:cover;border-radius:4px;" muted></video>'
          : '<img src="' + escapeAttr(ad.image_url) + '" style="width:70px;height:40px;object-fit:cover;border-radius:4px;">';
        html += '<tr>' +
          '<td>' + thumb + '</td>' +
          '<td>' + escapeAttr(SLOT_LABELS[ad.slot] || ad.slot) + '</td>' +
          '<td>' + escapeAttr(ad.advertiser_name || '—') + '</td>' +
          '<td>' + (ad.impressions || 0) + '</td>' +
          '<td>' + (ad.clicks || 0) + '</td>' +
          '<td>' + (ad.active ? '<span style="color:#16a34a;font-weight:700;">פעיל</span>' : '<span style="color:var(--muted);">כבוי</span>') + '</td>' +
          '<td class="tbl-actions">' +
            '<button class="tbl-btn" onclick="toggleAdActive(' + ad.id + ',' + (!ad.active) + ',this)">' + (ad.active ? 'כבה' : 'הפעל') + '</button>' +
            '<button class="tbl-btn" onclick="startEditAd(' + ad.id + ')">ערוך</button>' +
            '<button class="tbl-btn" onclick="exportAdPdf(' + ad.id + ',this)">PDF</button>' +
            '<button class="tbl-btn del" onclick="deleteAd(' + ad.id + ',this)">מחק</button>' +
          '</td></tr>';
      });
      table.innerHTML = html;
    } catch (e) {
      console.error('[ads.js] חריגה בטעינת טבלת המודעות:', e);
      table.innerHTML = '<tr><td style="padding:20px;text-align:center;color:var(--muted);">שגיאה בטעינת המודעות.</td></tr>';
    }
  }

  window.toggleAdActive = async function (id, newActive, btn) {
    if (!adsClient) { alert('אין חיבור לשרת — נסה לרענן את הדף.'); return; }
    if (btn) btn.disabled = true;
    try {
      const { data, error } = await adsClient.from('ads').update({ active: newActive }).eq('id', id).select();
      if (error) { alert('שגיאה בעדכון המודעה: ' + error.message); console.error('[ads.js] toggleAdActive נכשל:', error); if (btn) btn.disabled = false; return; }
      if (!data || !data.length) {
        // אין שגיאה, אבל גם אף שורה לא השתנתה בפועל — כמעט תמיד סימן שההתחברות לניהול
        // פגה או שהמשתמש לא מזוהה כראוי מול מדיניות האבטחה (RLS) של הטבלה.
        alert('הפעולה לא ביצעה שינוי בפועל. כנראה שההתחברות לניהול פגה — התחבר מחדש ונסה שוב.');
        console.error('[ads.js] toggleAdActive: 0 שורות עודכנו (סימן ל-RLS/הרשאה). id=' + id);
        if (btn) btn.disabled = false;
        return;
      }
      loadAdsTable();
    } catch (e) { alert('שגיאה בעדכון המודעה.'); console.error('[ads.js] toggleAdActive - שגיאת JS:', e); if (btn) btn.disabled = false; }
  };

  window.deleteAd = async function (id, btn) {
    if (!adsClient) { alert('אין חיבור לשרת — נסה לרענן את הדף.'); return; }
    if (!confirm('למחוק את המודעה הזו לצמיתות? לא ניתן לשחזר.')) return;
    if (btn) btn.disabled = true;
    try {
      const { data, error } = await adsClient.from('ads').delete().eq('id', id).select();
      if (error) { alert('שגיאה במחיקת המודעה: ' + error.message); console.error('[ads.js] deleteAd נכשל:', error); if (btn) btn.disabled = false; return; }
      if (!data || !data.length) {
        alert('הפעולה לא ביצעה שינוי בפועל. כנראה שההתחברות לניהול פגה — התחבר מחדש ונסה שוב.');
        console.error('[ads.js] deleteAd: 0 שורות נמחקו (סימן ל-RLS/הרשאה). id=' + id);
        if (btn) btn.disabled = false;
        return;
      }
      if (editingAdId === id) window.clearAdForm();
      loadAdsTable();
    } catch (e) { alert('שגיאה במחיקת המודעה.'); console.error('[ads.js] deleteAd - שגיאת JS:', e); if (btn) btn.disabled = false; }
  };

  // ═══════════ דוח PDF ממותג לכל מודעה ═══════════

  function buildReportEl(ad) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:800px;background:#fff;font-family:Rubik,Assistant,sans-serif;direction:rtl;padding:0;';
    const ctr = (ad.clicks || 0);
    const imp = (ad.impressions || 0);
    const ctrPct = imp > 0 ? ((ctr / imp) * 100).toFixed(2) : '0.00';
    const thumbHtml = ad.media_type === 'video'
      ? '<div style="width:100%;height:220px;background:#111;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;">קובץ וידאו — תצוגה מקדימה אינה זמינה בדוח</div>'
      : '<img src="' + escapeAttr(ad.image_url) + '" crossorigin="anonymous" style="width:100%;max-height:220px;object-fit:cover;border-radius:8px;display:block;">';

    wrap.innerHTML =
      '<div style="background:#0a0a0a;padding:24px 32px;display:flex;align-items:center;justify-content:space-between;">' +
        '<div style="font-size:26px;font-weight:900;color:#fff;letter-spacing:-0.03em;">ספיד<span style="color:#e8001d;">ו</span>מטר</div>' +
        '<div style="font-size:12px;color:rgba(255,255,255,0.5);letter-spacing:0.05em;">דוח ביצועי מודעה</div>' +
      '</div>' +
      '<div style="padding:28px 32px;">' +
        thumbHtml +
        '<h2 style="font-size:18px;font-weight:800;color:#0a0a0a;margin:20px 0 4px;">' + escapeAttr(SLOT_LABELS[ad.slot] || ad.slot) + '</h2>' +
        '<div style="font-size:13px;color:#6f6f6f;margin-bottom:20px;">מפרסם: ' + escapeAttr(ad.advertiser_name || '—') + '</div>' +
        '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
          statRow('סטטוס', ad.active ? 'פעיל' : 'כבוי') +
          statRow('סוג מדיה', ad.media_type === 'video' ? 'וידאו' : 'תמונה') +
          statRow('נוצרה בתאריך', fmtDate(ad.created_at)) +
          statRow('תאריך התחלה', fmtDate(ad.start_date)) +
          statRow('תאריך סיום', fmtDate(ad.end_date)) +
          statRow('צפיות (Impressions)', String(imp)) +
          statRow('קליקים (Clicks)', String(ctr)) +
          statRow('אחוז קליקים (CTR)', ctrPct + '%') +
        '</table>' +
      '</div>' +
      '<div style="padding:14px 32px;border-top:1px solid #e8e8e8;font-size:11px;color:#999;">' +
        'הופק אוטומטית על ידי מערכת הניהול של ספידומטר · ' + new Date().toLocaleString('he-IL') +
      '</div>';
    return wrap;

    function statRow(label, val) {
      return '<tr style="border-bottom:1px solid #eee;">' +
        '<td style="padding:9px 4px;color:#6f6f6f;font-weight:600;width:45%;">' + label + '</td>' +
        '<td style="padding:9px 4px;color:#0a0a0a;font-weight:700;">' + val + '</td>' +
        '</tr>';
    }
  }

  window.exportAdPdf = async function (id, btn) {
    if (!adsClient) return;
    const originalText = btn ? btn.textContent : null;
    if (btn) { btn.textContent = '...'; btn.disabled = true; }
    try {
      const { data: ad, error } = await adsClient.from('ads').select('*').eq('id', id).single();
      if (error || !ad) { alert('שגיאה בטעינת נתוני המודעה.'); console.error('[ads.js] exportAdPdf: שליפת המודעה נכשלה:', error); return; }

      await loadScriptOnce('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
      await loadScriptOnce('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');

      const el = buildReportEl(ad);
      document.body.appendChild(el);
      const canvas = await window.html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      document.body.removeChild(el);

      const imgData = canvas.toDataURL('image/png');
      const w = canvas.width / 2, h = canvas.height / 2;
      const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
      if (!jsPDFCtor) { alert('שגיאה בטעינת ספריית ה-PDF.'); return; }
      const pdf = new jsPDFCtor({ unit: 'px', format: [w, h] });
      pdf.addImage(imgData, 'PNG', 0, 0, w, h);
      pdf.save('דוח-מודעה-' + id + '.pdf');
    } catch (e) {
      console.error('[ads.js] יצירת PDF נכשלה:', e);
      alert('שגיאה ביצירת ה-PDF.');
    } finally {
      if (btn) { btn.textContent = originalText; btn.disabled = false; }
    }
  };

  // ═══════════ אתחול ═══════════

  function boot() {
    whenSupabaseReady(function () {
      // initPublicSlots הוא החלק היחיד שפותח בקשות רשת (fetch ל-Supabase).
      // דוחים אותו לאחר window.load, כדי שהמודעות לא יתחרו על רוחב פס
      // עם תמונת ה-Hero ומשאבים קריטיים אחרים בזמן שנמדד ה-LCP.
      // שאר האתחול (מאזיני אירועים בלבד, אין רשת) ממשיך מיד כרגיל.
      if (document.readyState === 'complete') {
        initPublicSlots();
      } else {
        window.addEventListener('load', initPublicSlots, { once: true });
      }
      watchArticleChanges();
      initAdsAdminIfNeeded();
      initSkyscraperBounds();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
