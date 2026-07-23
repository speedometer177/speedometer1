/*
 * ads.js — מערכת מודעות ידניות עצמאית — ספידומטר
 * ---------------------------------------------------------------
 * קובץ עצמאי לחלוטין. לא נוגע ולא תלוי ב-app.js.
 * להשבתה מלאה: פשוט הסר את שורת ה-<script src="/ads.js" defer>
 * מ-index.html, שום דבר אחר באתר לא ישתנה.
 *
 * מה זה עושה:
 *   1. בצד הציבורי — שולף מ-Supabase מודעה אקראית לכל סלוט
 *      (home_banner / feed_native / sidebar / article_body),
 *      עם lazy-load אמיתי (IntersectionObserver) כדי לא לפגוע
 *      בביצועי הטעינה הראשונית, ומעקב צפיות/קליקים.
 *   2. בפאנל האדמין — מוסיף לשונית "מודעות": טופס להעלאת מודעה
 *      חדשה (תמונה + קישור + מיקום + תאריכים), וטבלת ניהול
 *      עם הפעלה/כיבוי/מחיקה.
 *
 * אבטחה: כל סינון "רק מודעות פעילות ובתוקף תאריכים" נאכף ברמת
 * ה-RLS ב-Supabase (ר' supabase-ads-setup.sql) — כך שגם אם מישהו
 * ישנה את קוד הלקוח, לא ניתן לחשוף מודעות כבויות/פגות תוקף.
 * ---------------------------------------------------------------
 */
(function () {
  'use strict';

  const SB_URL = 'https://kaykrrnmykqrfhawgtqt.supabase.co';
  const SB_KEY = 'sb_publishable_Ms6YFTnADm-qAd9617Ey9A_D3x-Zumi'; // מפתח ציבורי (publishable), בטוח לחשיפה
  let adsClient = null;
  let currentAdImageFile = null;

  const SLOT_LABELS = {
    home_banner: 'באנר עליון',
    feed_native: 'בתוך הפיד',
    sidebar: 'סיידבר',
    article_body: 'בתוך כתבה'
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

  // ═══════════ תצוגה ציבורית ═══════════

  async function fetchRandomAd(slot) {
    if (!adsClient) return null;
    try {
      // סינון "פעיל ובתוקף תאריכים" נאכף כבר ב-RLS בצד השרת — כאן רק מסננים לפי סלוט
      const { data, error } = await adsClient
        .from('ads')
        .select('id,image_url,link_url,alt_text')
        .eq('slot', slot);
      if (error || !data || !data.length) return null;
      return data[Math.floor(Math.random() * data.length)];
    } catch (e) { return null; }
  }

  function renderAd(container, ad, slot) {
    if (!container || !ad) return;
    const showTag = (slot === 'home_banner' || slot === 'feed_native');
    const linkHtml =
      '<a href="' + escapeAttr(ad.link_url) + '" target="_blank" rel="noopener sponsored" data-ad-id="' + ad.id + '">' +
      '<img loading="lazy" src="' + escapeAttr(ad.image_url) + '" alt="' + escapeAttr(ad.alt_text || 'מודעה') + '" onload="this.classList.add(\'loaded\')">' +
      (showTag ? '<span class="ad-tag"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="9"/></svg>מודעה</span>' : '') +
      '</a>';

    if (slot === 'sidebar') {
      const body = container.querySelector('.ad-slot-sidebar-body');
      if (body) body.innerHTML = linkHtml;
    } else if (slot === 'article_body') {
      const body = container.querySelector('.ad-slot-article-body');
      if (body) body.innerHTML = linkHtml;
    } else {
      container.innerHTML = linkHtml;
    }

    container.classList.add('has-ad');
    const link = container.querySelector('a');
    if (link) {
      link.addEventListener('click', function () {
        try { adsClient.rpc('increment_ad_click', { ad_id: ad.id }); } catch (e) {}
      });
    }
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

  async function loadAndRender(container, slot) {
    const ad = await fetchRandomAd(slot);
    if (ad) {
      renderAd(container, ad, slot);
      trackImpressionOnce(container, ad.id);
    } else {
      container.classList.add('no-ad');
    }
  }

  function setupLazySlot(container) {
    const slot = container.getAttribute('data-ad-slot');
    if (!slot) return;
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

  // מודעת "בתוך הכתבה" יושבת ב-DOM קבוע (article-page תמיד קיים, רק מוסתר/מוצג),
  // אבל תוכן הכתבה מתחלף בלי רענון דף מלא — עוקבים אחרי שינויים ב-#art-body
  // כדי לרענן את המודעה בכל כתבה חדשה שנפתחת.
  function watchArticleChanges() {
    const artBody = document.getElementById('art-body');
    if (!artBody) return;
    const mo = new MutationObserver(function () {
      const slot = document.getElementById('ad-article-body');
      if (!slot) return;
      slot.classList.remove('has-ad', 'no-ad');
      const inner = slot.querySelector('.ad-slot-article-body');
      if (inner) inner.innerHTML = '';
      setupLazySlot(slot);
    });
    mo.observe(artBody, { childList: true });
  }

  // ═══════════ פאנל ניהול (אדמין) ═══════════

  function initAdsAdminIfNeeded() {
    const fileInput = document.getElementById('ad-image-file');
    if (!fileInput) return; // המבנה עוד לא קיים ב-HTML הזה — לא עושים כלום
    fileInput.addEventListener('change', function () {
      const f = fileInput.files && fileInput.files[0];
      currentAdImageFile = f || null;
      const status = document.getElementById('ad-upload-status');
      const preview = document.getElementById('ad-upload-preview');
      if (f) {
        if (status) status.textContent = f.name;
        if (preview) preview.innerHTML = '<img src="' + URL.createObjectURL(f) + '" style="max-width:220px;border-radius:6px;display:block;">';
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
    const slotSel = document.getElementById('ad-slot-select'); if (slotSel) slotSel.value = 'home_banner';
    const fileInput = document.getElementById('ad-image-file'); if (fileInput) fileInput.value = '';
    const status = document.getElementById('ad-upload-status'); if (status) status.textContent = '';
    const preview = document.getElementById('ad-upload-preview'); if (preview) preview.innerHTML = '';
    currentAdImageFile = null;
  };

  window.publishAd = async function () {
    if (!adsClient) { alert('אין חיבור לשרת — נסה לרענן את הדף.'); return; }

    const slot = document.getElementById('ad-slot-select').value;
    const linkUrl = document.getElementById('ad-link-url').value.trim();
    const altText = document.getElementById('ad-alt-text').value.trim();
    const startDate = document.getElementById('ad-start-date').value;
    const endDate = document.getElementById('ad-end-date').value;
    const advertiserName = document.getElementById('ad-advertiser-name').value.trim();

    if (!linkUrl) { alert('נא להזין קישור יעד למודעה.'); return; }
    if (!/^https?:\/\//i.test(linkUrl)) { alert('הקישור חייב להתחיל ב-http:// או https://'); return; }
    if (!currentAdImageFile) { alert('נא לבחור תמונה למודעה.'); return; }

    // דוחסים את התמונה בדיוק כמו שקורה בהעלאת תמונות לכתבות —
    // אותה פונקציה (compressImageFile) שכבר קיימת ב-app.js, ללא כפילות קוד.
    let fileToUpload = currentAdImageFile;
    if (typeof window.compressImageFile === 'function') {
      try {
        const compressed = await window.compressImageFile(currentAdImageFile, 250);
        if (compressed) fileToUpload = compressed;
      } catch (e) { /* אם הדחיסה נכשלת, ממשיכים עם הקובץ המקורי */ }
    }

    try {
      const { data: sessData } = await adsClient.auth.getSession();
      if (!sessData || !sessData.session) {
        alert('פג תוקף ההתחברות. אנא התחבר מחדש כדי לפרסם.');
        if (typeof window.openAdminLogin === 'function') window.openAdminLogin();
        return;
      }
    } catch (e) {}

    const ext = (fileToUpload.name.split('.').pop() || 'jpg').toLowerCase();
    const path = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    let publicUrl = null;
    try {
      const { error: upErr } = await adsClient.storage.from('ad-images')
        .upload(path, fileToUpload, { contentType: fileToUpload.type, upsert: false, cacheControl: '31536000' });
      if (upErr) { alert('שגיאה בהעלאת התמונה: ' + upErr.message); return; }
      const { data: pub } = adsClient.storage.from('ad-images').getPublicUrl(path);
      publicUrl = pub && pub.publicUrl ? pub.publicUrl : null;
    } catch (e) { alert('שגיאה בהעלאת התמונה.'); return; }
    if (!publicUrl) { alert('שגיאה בהעלאת התמונה.'); return; }

    const row = {
      slot: slot,
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
        html += '<tr>' +
          '<td><img src="' + escapeAttr(ad.image_url) + '" style="width:70px;height:40px;object-fit:cover;border-radius:4px;"></td>' +
          '<td>' + (SLOT_LABELS[ad.slot] || ad.slot) + '</td>' +
          '<td>' + escapeAttr(ad.advertiser_name || '—') + '</td>' +
          '<td>' + (ad.impressions || 0) + '</td>' +
          '<td>' + (ad.clicks || 0) + '</td>' +
          '<td>' + (ad.active ? '<span style="color:#16a34a;font-weight:700;">פעיל</span>' : '<span style="color:var(--muted);">כבוי</span>') + '</td>' +
          '<td class="tbl-actions">' +
            '<button class="tbl-btn" onclick="toggleAdActive(' + ad.id + ',' + (!ad.active) + ')">' + (ad.active ? 'כבה' : 'הפעל') + '</button>' +
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
