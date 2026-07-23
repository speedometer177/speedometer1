/*
 * ads.js — מערכת מודעות ידניות עצמאית — ספידומטר
 * ---------------------------------------------------------------
 * קובץ עצמאי לחלוטין. לא נוגע ולא תלוי ב-app.js.
 * להשבתה מלאה: פשוט הסר את שורת ה-<script src="/ads.js" defer>
 * מ-index.html, שום דבר אחר באתר לא ישתנה.
 *
 * מה זה עושה:
 *   1. בצד הציבורי — שולף מ-Supabase מודעה לכל אחד מ-8 המיקומים
 *      האפשריים, עם lazy-load אמיתי (IntersectionObserver), כפתור
 *      סגירה (X) שנשמר בזיכרון בלבד — סגירה תקפה עד לרענון/טעינה
 *      הבאה של הדף (ואז המודעה חוזרת שוב, תמיד), תמיכה בתמונה או
 *      וידאו, וסבב אוטומטי (carousel) כשיש כמה מודעות לאותו מיקום.
 *   2. בפאנל האדמין — לשונית "מודעות": טופס להוספה (כולל וידאו),
 *      טבלת ניהול עם הפעלה/כיבוי/מחיקה, ודוח PDF ממותג לכל מודעה.
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

  // סלוטים עם כפתור סגירה (X) — אלה שיושבים "מעל" תוכן, לא בתוך זרימת הרשימה
  const DISMISSIBLE_SLOTS = ['top_leaderboard', 'article_top'];
  // סלוטים שמסתובבים אוטומטית בין כמה מודעות (carousel) אם יש יותר מאחת
  const CAROUSEL_SLOTS = ['top_leaderboard'];
  // סלוטים עם תגית "מודעה" גלויה (שאר הסלוטים מציגים את התגית דרך ה-head הייעודי שלהם)
  const TAG_SLOTS = ['home_banner', 'feed_native', 'top_leaderboard', 'article_top', 'sidebar_left', 'sidebar_right'];

  const SLOT_LABELS = {
    top_leaderboard: 'באנר עליון (לפני Hero)',
    home_banner: 'באנר אחרי Hero',
    feed_native: 'בתוך הפיד',
    sidebar: 'סיידבר',
    article_top: 'באנר עליון בכתבה',
    article_body: 'בתוך כתבה (בסוף)',
    sidebar_left: 'סקייסקרייפר שמאלי',
    sidebar_right: 'סקייסקרייפר ימני'
  };

  function escapeAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function initAdsClient() {
    if (window.supabase && !adsClient) {
      try { adsClient = window.supabase.createClient(SB_URL, SB_KEY); } catch (e) {}
    }
    return adsClient;
  }

  function whenSupabaseReady(cb) {
    if (window.supabase) { initAdsClient(); cb(); return; }
    let tries = 0;
    const iv = setInterval(function () {
      tries++;
      if (window.supabase) { clearInterval(iv); initAdsClient(); cb(); }
      else if (tries > 100) { clearInterval(iv); } // ~10 שניות ואז מוותר בשקט
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

  // ═══════════ תצוגה ציבורית ═══════════

  async function fetchAdsForSlot(slot) {
    if (!adsClient) return [];
    try {
      // סינון "פעיל ובתוקף תאריכים" נאכף כבר ב-RLS בצד השרת — כאן רק מסננים לפי סלוט
      const { data, error } = await adsClient
        .from('ads')
        .select('id,image_url,link_url,alt_text,media_type')
        .eq('slot', slot);
      if (error || !data) return [];
      return data;
    } catch (e) { return []; }
  }

  // מעקב "נסגר" בזיכרון בלבד — לא נשמר בשום storage בכוונה.
  // כך מודעה שנסגרה חוזרת אוטומטית בכל רענון/טעינה מחדש של הדף,
  // ונשארת סגורה רק כל עוד אותה טעינת דף עדיין פעילה בדפדפן.
  const dismissedThisPageLoad = new Set();

  function isDismissed(slot) {
    return dismissedThisPageLoad.has(slot);
  }

  function markDismissed(slot) {
    dismissedThisPageLoad.add(slot);
  }

  function mediaTagHtml(ad) {
    if (ad.media_type === 'video') {
      return '<video autoplay muted loop playsinline preload="metadata" src="' + escapeAttr(ad.image_url) +
        '" aria-label="' + escapeAttr(ad.alt_text || 'מודעה') + '" onloadeddata="this.classList.add(\'loaded\')"></video>';
    }
    return '<img loading="lazy" src="' + escapeAttr(ad.image_url) + '" alt="' + escapeAttr(ad.alt_text || 'מודעה') +
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
        try { adsClient.rpc('increment_ad_click', { ad_id: ad.id }); } catch (e) {}
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
    bindAdInteractions(container, ad, slot);
  }

  function trackImpressionOnce(container, adId) {
    if (!('IntersectionObserver' in window)) {
      try { adsClient.rpc('increment_ad_impression', { ad_id: adId }); } catch (e) {}
      return;
    }
    const obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          try { adsClient.rpc('increment_ad_impression', { ad_id: adId }); } catch (e) {}
          obs.disconnect();
        }
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
      // אם המשתמש כבר סגר את הסלוט הזה, עוצרים את הסבב לגמרי
      if (container.classList.contains('ad-dismissed')) { clearInterval(timer); return; }
      idx = (idx + 1) % ads.length;
      container.classList.remove('has-ad');
      // רגע קצר לפני שהיה כדי לאפשר fade-out/fade-in חלק
      setTimeout(function () {
        renderSingleAd(container, ads[idx], slot);
        trackImpressionOnce(container, ads[idx].id);
      }, 60);
    }, 6000);
  }

  async function loadAndRender(container, slot) {
    if (isDismissed(slot)) { container.classList.add('ad-dismissed'); return; }
    const ads = await fetchAdsForSlot(slot);
    if (!ads.length) { container.classList.add('no-ad'); return; }
    if (CAROUSEL_SLOTS.indexOf(slot) !== -1 && ads.length > 1) {
      startCarousel(container, ads, slot);
    } else {
      const ad = ads[Math.floor(Math.random() * ads.length)];
      renderSingleAd(container, ad, slot);
      trackImpressionOnce(container, ad.id);
    }
  }

  function setupLazySlot(container) {
    const slot = container.getAttribute('data-ad-slot');
    if (!slot) return;
    if (isDismissed(slot)) { container.classList.add('ad-dismissed'); return; }
    if (!('IntersectionObserver' in window)) { loadAndRender(container, slot); return; }
    const obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          obs.disconnect();
          loadAndRender(container, slot);
        }
      });
    }, { rootMargin: '200px' }); // טוען קצת לפני שהמודעה נכנסת בפועל למסך
    obs.observe(container);
  }

  function initPublicSlots() {
    document.querySelectorAll('.ad-slot[data-ad-slot]').forEach(setupLazySlot);
  }

  // סלוטים בתוך הכתבה (article_top / article_body) יושבים ב-DOM קבוע,
  // אבל תוכן הכתבה מתחלף בלי רענון דף מלא — עוקבים אחרי #art-body
  // כדי לרענן את המודעות בכל כתבה חדשה שנפתחת.
  function watchArticleChanges() {
    const artBody = document.getElementById('art-body');
    if (!artBody) return;
    const targets = [
      { id: 'ad-article-top', innerSelector: null },               // article_top: renderiza direto no container
      { id: 'ad-article-body', innerSelector: '.ad-slot-article-body' } // article_body: renderiza no sub-div, preserva o cabeçalho
    ];
    const mo = new MutationObserver(function () {
      targets.forEach(function (t) {
        const slotEl = document.getElementById(t.id);
        if (!slotEl) return;
        slotEl.classList.remove('has-ad', 'no-ad', 'ad-dismissed');
        if (t.innerSelector) {
          const inner = slotEl.querySelector(t.innerSelector);
          if (inner) inner.innerHTML = '';
        } else {
          slotEl.innerHTML = '';
        }
        setupLazySlot(slotEl);
      });
    });
    mo.observe(artBody, { childList: true });
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

  function initAdsAdminIfNeeded() {
    const fileInput = document.getElementById('ad-image-file');
    if (!fileInput) return; // המבנה עוד לא קיים ב-HTML הזה — לא עושים כלום
    fileInput.addEventListener('change', async function () {
      const f = fileInput.files && fileInput.files[0];
      const status = document.getElementById('ad-upload-status');
      const preview = document.getElementById('ad-upload-preview');
      currentAdFile = null;
      if (!f) return;

      const isVideo = f.type.indexOf('video') === 0;

      if (isVideo) {
        // וידאו לא נדחס — רק בודקים גודל סביר ומציגים תצוגה מקדימה
        currentAdFile = f;
        if (status) { status.textContent = f.name + ' (' + Math.round(f.size / 1024) + 'KB) — ללא דחיסה'; status.style.color = 'var(--muted)'; }
        if (preview) preview.innerHTML = '<video src="' + URL.createObjectURL(f) + '" style="max-width:220px;border-radius:6px;display:block;" muted autoplay loop playsinline></video>';
        return;
      }

      // תמונה — דוחסים מיד עם הבחירה, בדיוק כמו בהעלאת תמונת כתבה
      if (status) { status.textContent = 'מדחס תמונה...'; status.style.color = 'var(--muted)'; }
      if (preview) preview.innerHTML = '';

      if (typeof window.compressImageFile !== 'function') {
        // גיבוי: אם מסיבה כלשהי הפונקציה לא זמינה, ממשיכים עם המקור בלי דחיסה
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
    const mediaSel = document.getElementById('ad-media-type'); if (mediaSel) { mediaSel.value = 'image'; window.onAdMediaTypeChange(); }
    const fileInput = document.getElementById('ad-image-file'); if (fileInput) fileInput.value = '';
    const status = document.getElementById('ad-upload-status'); if (status) status.textContent = '';
    const preview = document.getElementById('ad-upload-preview'); if (preview) preview.innerHTML = '';
    currentAdFile = null;
  };

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
    if (!currentAdFile) { alert('נא לבחור קובץ למודעה.'); return; }

    // currentAdFile כבר דחוס (לתמונות זה קורה בבחירת הקובץ עצמה — ר' initAdsAdminIfNeeded)
    const fileToUpload = currentAdFile;

    try {
      const { data: sessData } = await adsClient.auth.getSession();
      if (!sessData || !sessData.session) {
        alert('פג תוקף ההתחברות. אנא התחבר מחדש כדי לפרסם.');
        if (typeof window.openAdminLogin === 'function') window.openAdminLogin();
        return;
      }
    } catch (e) {}

    const ext = (fileToUpload.name.split('.').pop() || (mediaType === 'video' ? 'mp4' : 'jpg')).toLowerCase();
    const path = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    let publicUrl = null;
    try {
      const { error: upErr } = await adsClient.storage.from('ad-images')
        .upload(path, fileToUpload, { contentType: fileToUpload.type, upsert: false, cacheControl: '31536000' });
      if (upErr) { alert('שגיאה בהעלאת הקובץ: ' + upErr.message); return; }
      const { data: pub } = adsClient.storage.from('ad-images').getPublicUrl(path);
      publicUrl = pub && pub.publicUrl ? pub.publicUrl : null;
    } catch (e) { alert('שגיאה בהעלאת הקובץ.'); return; }
    if (!publicUrl) { alert('שגיאה בהעלאת הקובץ.'); return; }

    const row = {
      slot: slot,
      media_type: mediaType,
      image_url: publicUrl,
      link_url: linkUrl,
      alt_text: altText,
      advertiser_name: advertiserName,
      active: true,
      start_date: startDate ? new Date(startDate).toISOString() : null,
      end_date: endDate ? new Date(endDate).toISOString() : null
    };

    try {
      const { error } = await adsClient.from('ads').insert(row);
      if (error) { alert('שגיאה בפרסום המודעה: ' + error.message); return; }
      alert('המודעה פורסמה בהצלחה!');
      window.clearAdForm();
      loadAdsTable();
    } catch (e) { alert('שגיאה בפרסום המודעה.'); }
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
      if (error || !data) { table.innerHTML = '<tr><td style="padding:20px;text-align:center;color:var(--muted);">שגיאה בטעינת המודעות.</td></tr>'; return; }
      if (!data.length) { table.innerHTML = '<tr><td style="padding:20px;text-align:center;color:var(--muted);">אין מודעות עדיין.</td></tr>'; return; }
      let html = '<tr><th>תצוגה</th><th>מיקום</th><th>מפרסם</th><th>צפיות</th><th>קליקים</th><th>סטטוס</th><th>פעולות</th></tr>';
      data.forEach(function (ad) {
        const thumb = ad.media_type === 'video'
          ? '<video src="' + escapeAttr(ad.image_url) + '" style="width:70px;height:40px;object-fit:cover;border-radius:4px;" muted></video>'
          : '<img src="' + escapeAttr(ad.image_url) + '" style="width:70px;height:40px;object-fit:cover;border-radius:4px;">';
        html += '<tr>' +
          '<td>' + thumb + '</td>' +
          '<td>' + (SLOT_LABELS[ad.slot] || ad.slot) + '</td>' +
          '<td>' + escapeAttr(ad.advertiser_name || '—') + '</td>' +
          '<td>' + (ad.impressions || 0) + '</td>' +
          '<td>' + (ad.clicks || 0) + '</td>' +
          '<td>' + (ad.active ? '<span style="color:#16a34a;font-weight:700;">פעיל</span>' : '<span style="color:var(--muted);">כבוי</span>') + '</td>' +
          '<td class="tbl-actions">' +
            '<button class="tbl-btn" onclick="toggleAdActive(' + ad.id + ',' + (!ad.active) + ')">' + (ad.active ? 'כבה' : 'הפעל') + '</button>' +
            '<button class="tbl-btn" onclick="exportAdPdf(' + ad.id + ',this)">PDF</button>' +
            '<button class="tbl-btn del" onclick="deleteAd(' + ad.id + ')">מחק</button>' +
          '</td></tr>';
      });
      table.innerHTML = html;
    } catch (e) {
      table.innerHTML = '<tr><td style="padding:20px;text-align:center;color:var(--muted);">שגיאה בטעינת המודעות.</td></tr>';
    }
  }

  window.toggleAdActive = async function (id, newActive) {
    if (!adsClient) return;
    try { await adsClient.from('ads').update({ active: newActive }).eq('id', id); loadAdsTable(); }
    catch (e) { alert('שגיאה בעדכון המודעה.'); }
  };

  window.deleteAd = async function (id) {
    if (!adsClient) return;
    if (!confirm('למחוק את המודעה הזו לצמיתות?')) return;
    try { await adsClient.from('ads').delete().eq('id', id); loadAdsTable(); }
    catch (e) { alert('שגיאה במחיקת המודעה.'); }
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
      if (error || !ad) { alert('שגיאה בטעינת נתוני המודעה.'); return; }

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
      alert('שגיאה ביצירת ה-PDF.');
    } finally {
      if (btn) { btn.textContent = originalText; btn.disabled = false; }
    }
  };

  // ═══════════ אתחול ═══════════

  function boot() {
    whenSupabaseReady(function () {
      initPublicSlots();
      watchArticleChanges();
      initAdsAdminIfNeeded();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
