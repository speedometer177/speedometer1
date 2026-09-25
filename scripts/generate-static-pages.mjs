#!/usr/bin/env node
/**
 * generate-static-pages.mjs
 * ---------------------------------------------------------------
 * פותר את בעיית "נסרק אך לא נכלל באינדקס" / "כתובת חלופית עם תג קנוני תקין"
 * בדוח Search Console, על ידי הפקת עמוד HTML סטטי ועצמאי לכל כתבה ב:
 *
 *     /article/{id}/index.html
 *
 * הגישה: זהו לא "עמוד crawler" נפרד מהאתר החי - זהו אותו index.html
 * המלא (כל ה-CSS, כל ה-JS, כל ה-SPA), פשוט עם תוכן הכתבה הספציפית
 * "אפוי" מראש בתוך ה-HTML הגולמי:
 *   - <title>, meta description, canonical, OG, Twitter Card, JSON-LD - ייחודיים לכתבה
 *   - תוכן הכתבה האמיתי ממולא מראש בתוך #art-body, #art-title וכו'
 *   - #article-page מוצג כברירת מחדל (display:block) ו-#home-page מוסתר,
 *     כדי שה-First Contentful Paint יהיה תוכן הכתבה, לא דף הבית.
 *
 * כך גוגל (ומשתמש עם JS כבוי) מקבלים תוכן ייחודי ומלא ב-byte הראשון.
 * כש-JS עולה, isStaticPrerender ב-index.html מזהה את הנתיב /article/{id}/,
 * מדלג על בניית דף הבית, וקורא ל-openArticle(id) שמרנדר את הכתבה מחדש
 * עם הנתונים החיים מ-Supabase (כך שעדכונים רטרואקטיביים בכתבה מתעדכנים
 * אצל המשתמש האמיתי תוך שניות, גם אם ה-HTML הסטטי כבר "מיושן").
 *
 * מופעל על ידי .github/workflows/generate-pages.yml:
 *   - בלוח זמנים קבוע (כל 4 שעות, רשת ביטחון)
 *   - ע"י repository_dispatch מה-Edge Function ברגע שמתבצע שינוי ב-Supabase
 *     (כך שכתבה חדשה מקבלת עמוד 200 OK תוך דקות, לא שעות)
 *   - תומך גם בהרצה ממוקדת לכתבה בודדת (כש-articleId מועבר ב-payload),
 *     כדי שריצה מהירה לא תיצור עומס מיותר על כל 30+ הכתבות בכל פעם.
 *
 * ═══ עדכון: Rich Results + שיתוף ווטסאפ ═══
 *   - JSON-LD: תמונות כ-ImageObject בשלושה יחסי גובה-רוחב (16:9, 4:3, 1:1)
 *     דרך wsrv - הפורמט שגוגל ממליץ עליו לתוצאות עשירות.
 *   - datePublished כולל את שעת הפרסום האמיתית (שדה time) עם אזור זמן ישראל.
 *   - og:type הוא תמיד "article" בדפי כתבה (היה "website" לכתבות שאינן מבחן).
 *   - og:image / twitter:image עוברים דרך wsrv ב-1200x630 JPG - הגודל
 *     והפורמט שווטסאפ ופייסבוק מציגים כתמונה גדולה באופן אמין.
 *   - נוסף og:locale=he_IL.
 * ---------------------------------------------------------------
 */

import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile, mkdir, rm, readdir } from 'fs/promises';
import path from 'path';

const SB_URL = 'https://kaykrrnmykqrfhawgtqt.supabase.co';
const SB_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_Ms6YFTnADm-qAd9617Ey9A_D3x-Zumi'; // מפתח ציבורי (publishable) - בטוח לחשיפה, אינו ה-service role key
const SITE = 'https://speedometer10.co.il';

const SITE_DIR = path.resolve(process.cwd());                  // שורש הריפו - מכיל את index.html המלא
const TEMPLATE_PATH = path.join(SITE_DIR, 'index.html');
const OUT_DIR = path.resolve(process.cwd(), 'article');         // פלט: article/{id}/index.html
const SITEMAP_PATH = path.resolve(process.cwd(), 'sitemap.xml');
const NEWS_SITEMAP_PATH = path.resolve(process.cwd(), 'sitemap-news.xml');

const CAT_LABELS = {
  local: 'חדשות מקומיות', world: 'חדשות עולמיות', review: 'מבחן רכב',
  electric: 'רכב חשמלי', tech: 'טכנולוגיה', buying: 'קניית רכב',
  sport: 'ספורט', luxury: 'רכב יוקרה', quick: 'חדשות בקליק'
};
const CAT_IMAGES = {
  local: 'https://images.unsplash.com/photo-1571127236794-81c0bbfe1ce3?w=1200&q=80&fm=webp&auto=format',
  world: 'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=1200&q=80&fm=webp&auto=format',
  review: 'https://images.unsplash.com/photo-1555215695-3004980ad54e?w=1200&q=80&fm=webp&auto=format',
  electric: 'https://images.unsplash.com/photo-1593941707882-a5bba14938c7?w=1200&q=80&fm=webp&auto=format',
  tech: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200&q=80&fm=webp&auto=format',
  buying: 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=1200&q=80&fm=webp&auto=format',
  sport: 'https://images.unsplash.com/photo-1544636331-e26879cd4d9b?w=1200&q=80&fm=webp&auto=format',
  luxury: 'https://images.unsplash.com/photo-1563720360172-67b8f3dce741?w=1200&q=80&fm=webp&auto=format',
  quick: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=1200&q=80&fm=webp&auto=format'
};

function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toISODate(dateStr) {
  if (!dateStr) return null;
  // קודם כל מנסים להתאים פורמט יום-חודש-שנה מפורש (D.M.YYYY / DD/MM/YYYY וכו'),
  // כיוון שזה הפורמט הישראלי הסטנדרטי באתר. *חובה* לבדוק את זה לפני שימוש
  // ב-new Date() הגנרי, כי הפענוח המובנה של JS מניח לעיתים סדר אמריקאי
  // (חודש-יום-שנה) לתאריכים עם נקודות/לוכסנים - וכש-היום הוא 12 ומטה
  // (למשל "11.6.2026"), זה "מצליח" לפענח בלי שגיאה, אבל לתאריך הלא נכון
  // (היה מפענח כ-6 בנובמבר במקום 11 ביוני). באג זה אומת בפועל מול הנתונים
  // האמיתיים של האתר (כתבה 173, תאריך "11.6.2026" שהתפענח שגויות ל-2026-11-06).
  const m = String(dateStr).match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d2 = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00Z`);
      if (!isNaN(d2.getTime())) return d2.toISOString();
    }
  }
  // נופלים חזרה ל-new Date() הגנרי רק לפורמטים שאינם יום.חודש.שנה מפורש
  // (לדוגמה תאריכי ISO שכבר תקינים, כמו "2026-06-11").
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d.toISOString();
  return null;
}

/**
 * כמו toISODate, אבל משלב גם את שעת הפרסום (שדה time בפורמט "HH:MM")
 * עם אזור זמן ישראל (+03:00). כך datePublished ב-JSON-LD משקף את זמן
 * הפרסום האמיתי ולא חצות - גוגל מציג את זה בתוצאות ("לפני 3 שעות" וכו').
 * אם אין שעה תקינה - נופלים ל-00:00 (התנהגות זהה לקודם).
 */
function toISODateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  let base = null;
  const m = String(dateStr).match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      base = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  if (!base) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    base = d.toISOString().split('T')[0];
  }
  let hh = '00', mm = '00';
  const t = String(timeStr || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (t) {
    hh = String(parseInt(t[1], 10)).padStart(2, '0');
    mm = t[2];
  }
  const d = new Date(`${base}T${hh}:${mm}:00+03:00`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/* ═══ תמונות לשיתוף ולסכמה ═══ */

/**
 * תמונת OG לשיתוף (ווטסאפ/פייסבוק/טוויטר):
 * 1200x630 JPG דרך wsrv. ווטסאפ מציג תמונה גדולה באופן אמין רק כשהתמונה
 * ביחס ~1.91:1, במשקל סביר, ובפורמט שכל הגרסאות תומכות בו (JPG בטוח,
 * webp לא תמיד). wsrv עושה את ההמרה בזמן אמת מהמקור ב-Supabase.
 */
function ogImage(url) {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return url;
  if (url.indexOf('wsrv.nl') !== -1) return url;
  return 'https://wsrv.nl/?url=' + encodeURIComponent(url) + '&w=1200&h=630&fit=cover&output=jpg&q=80';
}

/**
 * מערך תמונות ל-JSON-LD לפי המלצת גוגל לתוצאות עשירות:
 * שלושה יחסי גובה-רוחב (16:9, 4:3, 1:1) כ-ImageObject עם מידות מפורשות.
 * גוגל בוחר את היחס המתאים לכל משטח תצוגה (Discover, חיפוש, וכו').
 */
function schemaImages(url) {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url) || url.indexOf('wsrv.nl') !== -1) {
    return url ? [url] : [];
  }
  const enc = encodeURIComponent(url);
  const v = (w, h) => ({
    '@type': 'ImageObject',
    url: `https://wsrv.nl/?url=${enc}&w=${w}&h=${h}&fit=cover&output=jpg&q=80`,
    width: w,
    height: h
  });
  return [v(1200, 675), v(1200, 900), v(1200, 1200)];
}

/** מקביל ל-parseBody בקליינט (index.html) - שומר על אותה לוגיקה בדיוק כדי שהתוכן הראשוני יתאים למה שה-JS ירנדר מחדש */
function parseBodyToHTML(text, bodyImages, articleTitle) {
  const lines = (text || '').split('\n');
  const parts = [];
  const imgs = (bodyImages || []).filter(x => x && x.src);
  let firstHeadingSkipped = false;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      const ht = line.slice(3).trim();
      if (!firstHeadingSkipped && articleTitle && ht === articleTitle.trim()) {
        firstHeadingSkipped = true;
        continue;
      }
      parts.push({ type: 'h2', html: `<h2>${esc(ht)}</h2>` });
    } else if (line.startsWith('### ')) {
      parts.push({ type: 'h3', html: `<h3>${esc(line.slice(4))}</h3>` });
    } else if (line.startsWith('> ')) {
      parts.push({ type: 'quote', html: `<blockquote>${esc(line.slice(2))}</blockquote>` });
    } else if (line.trim()) {
      const withBold = esc(line).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      parts.push({ type: 'p', html: `<p>${withBold}</p>` });
    }
  }

  if (imgs.length === 0) return parts.map(p => p.html).join('\n');

  const figHTML = (img) =>
    `<figure class="body-img-wrap"><img src="${esc(img.src)}" alt="${esc(img.cap || '')}" loading="lazy" decoding="async" width="800" height="450">${img.cap ? `<figcaption>${esc(img.cap)}</figcaption>` : ''}</figure>`;

  const paraCount = parts.filter(p => p.type === 'p').length;
  const interval = Math.max(2, Math.floor(paraCount / (imgs.length + 1)));
  const imgQueue = [...imgs];
  let pIdx = 0;
  const result = [];
  for (const part of parts) {
    result.push(part.html);
    if (part.type === 'p') {
      pIdx++;
      if (imgQueue.length > 0 && pIdx % interval === 0) result.push(figHTML(imgQueue.shift()));
    }
  }
  imgQueue.forEach(img => result.push(figHTML(img)));
  return result.join('\n');
}

function plainTextExcerpt(text, maxLen = 160) {
  const clean = (text || '')
    .replace(/^##?#?\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > maxLen ? clean.slice(0, maxLen - 1).trim() + '…' : clean;
}

/**
 * קופסת CTA שמפנה למחשבון שווי שימוש - מוצגת רק בכתבות רלוונטיות
 * (קטגוריית "קניית רכב", או תוכן שמזכיר ליסינג/רכב חברה/שווי שימוש).
 * חוזרת כמחרוזת ריקה בכל שאר הכתבות - אפס השפעה על תוכן קיים.
 * הפונקציה המקבילה בצד הלקוח (buildCalcCTA באותו שם) נמצאת ב-app.js -
 * יש לעדכן את שתיהן יחד אם משנים את התנאי/העיצוב.
 */
function buildCalcCTA(a) {
  const haystack = `${a.title || ''} ${a.body || ''}`.toLowerCase();
  const keywords = ['ליסינג', 'רכב חברה', 'רכב צמוד', 'שווי שימוש', 'תלוש שכר'];
  const isRelevant = a.cat === 'buying' || keywords.some(k => haystack.includes(k));
  if (!isRelevant) return '';
  return `<div style="margin:28px 0;padding:18px 20px;background:linear-gradient(120deg,#15181f,#1d222c);border-radius:14px;border-right:3px solid var(--red);display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
  <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(150deg,var(--red),var(--red-dark));display:flex;align-items:center;justify-content:center;flex-shrink:0;">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="2" width="18" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="7" y1="11" x2="7" y2="11"/><line x1="12" y1="11" x2="12" y2="11"/><line x1="17" y1="11" x2="17" y2="11"/><line x1="7" y1="15" x2="7" y2="15"/><line x1="12" y1="15" x2="12" y2="15"/><line x1="17" y1="15" x2="17" y2="19"/><line x1="7" y1="19" x2="12" y2="19"/></svg>
  </div>
  <div style="flex:1;min-width:200px;color:#f3f4f6;font-size:0.93rem;font-weight:600;line-height:1.5;">רכב חברה או ליסינג? בדקו כמה עולה לכם <b style="color:#ff4d5e;">שווי השימוש</b> בחודש</div>
  <a href="/usage-value-calculator.html" style="background:var(--red);color:#fff;font-weight:800;font-size:0.85rem;padding:10px 18px;border-radius:100px;text-decoration:none;white-space:nowrap;">למחשבון ←</a>
</div>`;
}

/**
 * לוקח את ה-template המלא (index.html) ומחזיר גרסה "אפויה" לכתבה ספציפית:
 * meta tags ייחודיים + JSON-LD + תוכן הכתבה ממולא ב-DOM, עם article-page גלוי כברירת מחדל.
 */
function hydrateTemplateForArticle(template, a) {
  const title = `${a.title} | ספידומטר`;
  const desc = a.sub || plainTextExcerpt(a.body) || a.title;
  const img = a.img || CAT_IMAGES[a.cat] || CAT_IMAGES.local;
  const canonicalUrl = `${SITE}/article/${a.id}/`;
  const catLabel = CAT_LABELS[a.cat] || a.cat;
  const isoDate = toISODateTime(a.date, a.time);
  const liveUpdates = Array.isArray(a.live_updates) ? a.live_updates : [];
  const liveUpdatesHTML = liveUpdates.length
    ? liveUpdates.slice().reverse().map(u =>
        `<div style="background:var(--red-light);border-right:3px solid var(--red);border-radius:0 6px 6px 0;padding:10px 16px;margin-bottom:16px;font-size:0.92rem;line-height:1.6;"><strong style="color:var(--red);">🔴 עדכון ${esc(u.time || '')}:</strong> ${esc(u.text || '')}</div>`
      ).join('')
    : '';
  const bodyHTML = liveUpdatesHTML + parseBodyToHTML(a.body, a.body_images, a.title) + buildCalcCTA(a);
  const latestUpdateTs = liveUpdates.length ? liveUpdates[liveUpdates.length - 1].ts : null;
  const readMins = Math.max(1, Math.ceil((a.body || '').split(/\s+/).filter(Boolean).length / 200));
  const shareImg = ogImage(img); // תמונת שיתוף 1200x630 JPG

  const schema = {
    '@context': 'https://schema.org',
    '@type': a.cat === 'review' ? 'Review' : 'NewsArticle',
    headline: a.title,
    description: desc,
    author: { '@type': 'Person', name: a.author || 'מערכת ספידומטר' },
    image: schemaImages(img),
    inLanguage: 'he',
    publisher: {
      '@type': 'Organization',
      name: 'ספידומטר',
      logo: { '@type': 'ImageObject', url: `${SITE}/logo.png` },
      url: SITE
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonicalUrl }
  };
  if (isoDate) { schema.datePublished = isoDate; schema.dateModified = latestUpdateTs || isoDate; }
  if (a.cat === 'review' && a.score) {
    schema.reviewRating = { '@type': 'Rating', ratingValue: parseFloat(a.score), bestRating: 10, worstRating: 1 };
    schema.itemReviewed = {
      '@type': 'Car',
      name: a.title,
      ...(a.specs && a.specs.price ? { offers: { '@type': 'Offer', price: a.specs.price, priceCurrency: 'ILS' } } : {})
    };
  }

  let html = template;

  html = html.replace(/<title>.*?<\/title>/s, `<title>${esc(title)}</title>`);
  if (!/<title>/.test(html)) {
    html = html.replace('</head>', `<title>${esc(title)}</title>\n</head>`);
  }

  html = html.replace(
    /<meta name="description" content="[^"]*">/,
    `<meta name="description" content="${esc(desc)}">`
  );

  html = html.replace(
    /<link rel="canonical" href="[^"]*">/,
    `<link rel="canonical" href="${canonicalUrl}">`
  );

  html = html
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(desc)}">`)
    .replace(/<meta property="og:type" content="[^"]*">/, `<meta property="og:type" content="article">`)
    .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${canonicalUrl}">`)
    .replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${esc(shareImg)}">`)
    .replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${esc(title)}">`)
    .replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${esc(desc)}">`)
    .replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${esc(shareImg)}">`);

  const extraMeta = [
    isoDate ? `<meta property="article:published_time" content="${isoDate}">` : '',
    isoDate ? `<meta property="article:modified_time" content="${isoDate}">` : '',
    `<meta property="article:author" content="${esc(a.author || 'מערכת ספידומטר')}">`,
    `<meta property="article:section" content="${esc(catLabel)}">`,
    `<meta property="og:locale" content="he_IL">`,
    `<meta name="author" content="${esc(a.author || 'מערכת ספידומטר')}">`
  ].filter(Boolean).join('\n');
  html = html.replace('</head>', `${extraMeta}\n</head>`);

  const articleSchemaTag = `<script type="application/ld+json" id="article-schema-prerendered">${JSON.stringify(schema)}</script>`;
  html = html.replace('</head>', `${articleSchemaTag}\n</head>`);

  // VideoObject schema — אחד לכל סרטון יוטיוב משובץ בכתבה (yt_urls). מבוסס
  // רק על מה שקיים בפועל (כותרת/תיאור הכתבה, thumbnail אמיתי מיוטיוב) —
  // uploadDate הוא תאריך פרסום הכתבה כקירוב סביר, לא התאריך המדויק של
  // הסרטון עצמו (לא זמין לנו), אבל זה עדיף על השמטת השדה לגמרי.
  const ytIdRe = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const ytUrls = Array.isArray(a.yt_urls) ? a.yt_urls : [];
  const videoTags = ytUrls.map((url) => {
    const m = String(url || '').match(ytIdRe);
    if (!m) return '';
    const vid = m[1];
    const videoSchema = {
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      name: title,
      description: desc,
      thumbnailUrl: [`https://img.youtube.com/vi/${vid}/hqdefault.jpg`],
      embedUrl: `https://www.youtube.com/embed/${vid}`,
      uploadDate: isoDate || undefined,
      publisher: {
        '@type': 'Organization', name: 'ספידומטר',
        logo: { '@type': 'ImageObject', url: `${SITE}/logo.png` }
      }
    };
    return `<script type="application/ld+json">${JSON.stringify(videoSchema)}</script>`;
  }).filter(Boolean).join('\n');
  if (videoTags) html = html.replace('</head>', `${videoTags}\n</head>`);

  // FAQPage schema — רק כשיש בפועל שאלות/תשובות שמורות בשדה faq (jsonb,
  // מוזן ידנית בפאנל בעת עריכת מדריך קנייה) — לא ממציאים שאלות שלא הוזנו.
  const faqItems = Array.isArray(a.faq) ? a.faq.filter((f) => f && f.q && f.a) : [];
  if (faqItems.length) {
    const faqSchema = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqItems.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a }
      }))
    };
    const faqTag = `<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>`;
    html = html.replace('</head>', `${faqTag}\n</head>`);
  }

  const overrideCSS = `<style id="prerender-override">
    #home-page{display:none!important;}
    #article-page{display:block!important;}
    #admin-page{display:none!important;}
  </style>`;
  html = html.replace('</head>', `${overrideCSS}\n</head>`);

  html = html.replace(
    '<span class="article-cat-tag" id="art-cat"></span>',
    `<span class="article-cat-tag" id="art-cat">${esc(catLabel)}</span>`
  );
  html = html.replace(
    '<h1 class="article-title" id="art-title"></h1>',
    `<h1 class="article-title" id="art-title">${esc(a.title)}</h1>`
  );
  html = html.replace(
    '<p class="article-sub" id="art-sub"></p>',
    `<p class="article-sub" id="art-sub">${esc(a.sub || '')}</p>`
  );
  html = html.replace(
    '<strong id="art-author"></strong>',
    `<strong id="art-author">${esc(a.author || 'מערכת ספידומטר')}</strong>`
  );
  html = html.replace(
    '<span id="art-date"></span>',
    `<span id="art-date">${esc(a.date || '')}</span>`
  );
  html = html.replace(
    '<span id="art-read" class="read-time-badge"></span>',
    `<span id="art-read" class="read-time-badge">${readMins} דק׳ קריאה</span>`
  );
  const displayImg = isProxyable(img) ? wsrvW(img, 1000) : img; // זהה לנוסחת הלקוח (wsrvW 1000)
  html = html.replace(
    /<img class="article-hero-img" id="art-img" src="" alt=""/,
    `<img class="article-hero-img" id="art-img" src="${esc(displayImg)}" alt="${esc(a.title)}" fetchpriority="high"`
  );
  html = injectBetween(html, 'HERO_PRELOAD', `<link rel="preload" as="image" href="${esc(displayImg)}" fetchpriority="high">`);
  html = html.replace(
    '<div class="article-body" id="art-body"></div>',
    `<div class="article-body" id="art-body">${bodyHTML}</div>`
  );
  const bcHTML = `<a href="${SITE}/">בית</a><span class="bc-sep" aria-hidden="true">›</span><a href="${SITE}/?cat=${esc(a.cat)}">${esc(catLabel)}</a><span class="bc-sep" aria-hidden="true">›</span><span class="bc-current" aria-current="page">${esc(a.title.length > 48 ? a.title.slice(0, 48) + '…' : a.title)}</span>`;
  html = html.replace(
    '<nav class="breadcrumb-nav" id="art-breadcrumb" aria-label="נתיב ניווט"></nav>',
    `<nav class="breadcrumb-nav" id="art-breadcrumb" aria-label="נתיב ניווט">${bcHTML}</nav>`
  );

  return html;
}

// עמודים סטטיים קבועים שאינם כתבות (כלים/מדריכים) — לא מגיעים מ-Supabase,
// ולכן חייבים רשימה ידנית כאן כדי שלא ייעלמו בכל ריצה מחדש של הסקריפט
// (ה-sitemap כולו נכתב מאפס בכל הרצה, אז בלי זה כל תוספת ידנית ל-sitemap.xml
// הייתה נמחקת אוטומטית תוך 4 שעות ע"י ה-GitHub Action).
const STATIC_PAGES = [
  { path: '/cars-list.html', changefreq: 'weekly', priority: '0.7' },
  { path: '/usage-value-calculator.html', changefreq: 'monthly', priority: '0.7' },
];

function buildSitemap(articles, cars = []) {
  const today = new Date().toISOString().split('T')[0];
  const urls = [
    `<url><loc>${SITE}/</loc><lastmod>${today}</lastmod><changefreq>hourly</changefreq><priority>1.0</priority></url>`,
    ...STATIC_PAGES.map(p =>
      `<url><loc>${SITE}${p.path}</loc><lastmod>${today}</lastmod><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`
    ),
    ...articles
      .filter(a => a.cat !== 'quick')
      .map(a => {
        const lastmod = toISODate(a.date)?.split('T')[0] || today;
        return `<url><loc>${SITE}/article/${a.id}/</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`;
      }),
    ...cars.map(c =>
      `<url><loc>${SITE}/car/${c.slug}/</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>`
    )
  ].join('\n  ');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  ${urls}\n</urlset>\n`;
}

// News Sitemap בפורמט הרשמי של גוגל ניוז — נפרד לגמרי מה-sitemap הרגיל.
// דרישה קריטית של גוגל: לכלול *רק* כתבות שפורסמו ב-48 השעות האחרונות —
// כתבות ישנות יותר לא רק שלא עוזרות, אלא עלולות לפגוע באמינות הפיד בעיני
// גוגל ("News Sitemap צריך לשקף רק תוכן טרי, לא ארכיון"). הפרסום ל-
// Google News/Discover דורש גם הגשה חד-פעמית ב-Publisher Center (לא קוד).
function buildNewsSitemap(articles) {
  const twoDaysAgoMs = Date.now() - 48 * 60 * 60 * 1000;
  const recent = articles.filter(a => {
    const iso = toISODateTime(a.date, a.time);
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return !isNaN(t) && t >= twoDaysAgoMs;
  });
  const urls = recent.map(a => {
    const pubDate = toISODateTime(a.date, a.time) || new Date().toISOString();
    return `  <url>
    <loc>${SITE}/article/${a.id}/</loc>
    <news:news>
      <news:publication>
        <news:name>ספידומטר</news:name>
        <news:language>he</news:language>
      </news:publication>
      <news:publication_date>${pubDate}</news:publication_date>
      <news:title>${esc(a.title)}</news:title>
    </news:news>
  </url>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n${urls}\n</urlset>\n`;
}

/* ═══ אופטימיזציית LCP: פונקציות זהות 1:1 לצד הלקוח (index.html) ═══
   קריטי: אם הנוסחה כאן שונה מהלקוח, ה-preload יוריד URL אחר ממה שהדף מרנדר
   והדפדפן יוריד את התמונה פעמיים. כל שינוי כאן מחייב שינוי זהה ב-index.html. */
function wsrvW(url, w) { return 'https://wsrv.nl/?url=' + encodeURIComponent(url) + '&w=' + w + '&fit=cover&output=webp&q=75'; }
function isProxyable(url) { return typeof url === 'string' && /^https?:\/\//.test(url) && url.indexOf('wsrv.nl') === -1 && url.indexOf('images.unsplash.com') === -1; }
function heroSrc(url) { return isProxyable(url) ? wsrvW(url, 800) : url; }

function heroSrcset(url) {
  if (typeof url !== 'string') return '';
  if (url.indexOf('images.unsplash.com') !== -1) {
    return [320, 500, 800, 1200].map(w => url.replace(/([?&])w=\d+/, '$1w=' + w) + ' ' + w + 'w').join(', ');
  }
  if (isProxyable(url)) {
    return [400, 640, 800, 1200].map(w => wsrvW(url, w) + ' ' + w + 'w').join(', ');
  }
  return '';
}

/* שליפת שדות light לצורך ה-snapshot המוטמע בדף הבית (אותם שדות שהלקוח מסנכרן) */
async function fetchLightRows(supabase) {
  const LIGHT = 'id,title,sub,cat,author,date,time,read_time,img,img_caption,score,views,featured,specs,gallery_captions,yt_urls,tags,scheduled_at,deleted';
  const { data, error } = await supabase.from('articles').select(LIGHT).order('id', { ascending: false });
  if (error) throw new Error(`Supabase light fetch failed: ${error.message}`);
  const now = new Date();
  return (data || []).filter(r =>
    !r.deleted &&
    (!r.scheduled_at || new Date(r.scheduled_at) <= now) // לא מדליפים כתבות מתוזמנות עתידיות
  ).map(r => { const c = { ...r }; delete c.deleted; return c; });
}

/* בונה תג snapshot: 16 הכתבות האחרונות מוטמעות ב-HTML — הלקוח מרנדר מיידית בלי לחכות ל-fetch */
function buildSnapshotTag(lightRows) {
  // views מושמט בכוונה: הוא משתנה כל רגע ויוצר diff חדש ב-index.html בכל ריצה,
  // מה שמגביר קונפליקטים בין ריצות מקבילות. הלקוח מרענן views מ-Supabase תוך שנייה ממילא.
  const top = lightRows.slice(0, 16).map(r => { const c = { ...r }; delete c.views; return c; });
  const json = JSON.stringify(top).replace(/</g, '\\u003c'); // מנטרל </script> וכל תג בתוך התוכן
  return `<script>window.__PRELOADED_ARTICLES=${json};</script>`;
}

/* בונה שקופית ראשונה סטטית לקרוסולת המובייל — זהה למבנה ש-buildHeroBanner מייצר בלקוח,
   כך שכשה-JS עולה ובונה את הקרוסולה המלאה, ההחלפה בלתי נראית (אותה תמונה, אותם classes).
   התוצאה: תמונת ה-LCP קיימת ב-DOM מהבית הראשון של ה-HTML - הדפדפן מצייר אותה בלי לחכות ל-JS. */
function hbReadTime(main) {
  if (main.time && /\d/.test(main.time) === false && main.readTime) { /* noop */ }
  if (main.readTime) { const m = String(main.readTime).match(/\d+/); if (m) return m[0]; }
  const words = String(main.body || '').replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  return String(Math.max(1, Math.round(words / 200)));
}


function cardThumb(url) {
  if (typeof url !== 'string') return url;
  if (url.indexOf('images.unsplash.com') !== -1) return url.replace(/([?&])w=\d+/, '$1w=320');
  if (isProxyable(url)) return wsrvW(url, 320);
  return url;
}

function responsiveAttrs(url, sizesAttr) {
  if (typeof url !== 'string') return '';
  if (url.indexOf('images.unsplash.com') !== -1) {
    const widths = [240, 320, 500, 800, 1200];
    const srcset = widths.map(w => url.replace(/([?&])w=\d+/, '$1w=' + w) + ' ' + w + 'w').join(', ');
    return ` srcset="${esc(srcset)}" sizes="${esc(sizesAttr)}"`;
  }
  if (isProxyable(url)) {
    const widths = [240, 400, 640, 800, 1200];
    const srcset = widths.map(w => wsrvW(url, w) + ' ' + w + 'w').join(', ');
    return ` srcset="${esc(srcset)}" sizes="${esc(sizesAttr)}"`;
  }
  return '';
}

/* בונה כרטיס כתבה זהה 1:1 ל-cardHTML() בלקוח — כדי שהגריד יגיע מוכן ב-HTML,
   בלי לחכות ל-JS, ובלי שום ניחוש גובה (אפס CLS אמיתי) */
function buildStaticCard(a) {
  const img = a.img && String(a.img).trim().length > 5 ? a.img : (CAT_IMAGES[a.cat] || CAT_IMAGES.local);
  const score = a.score
    ? `<div class="review-score ${parseFloat(a.score) >= 8 ? 'high' : parseFloat(a.score) >= 6 ? 'mid' : ''}">${esc(a.score)}</div>`
    : '';
  const readTime = a.read_time
    ? `<span class="card-readtime">${esc(a.read_time)}</span>`
    : '';
  return `<a href="/article/${a.id}/" class="card" onclick="openArticle(${a.id});return false;" aria-label="${esc(a.title)}">
    <div class="card-img">
      <img src="${esc(cardThumb(img))}"${responsiveAttrs(img, '(max-width:680px) 45vw, 400px')} alt="${esc(a.title)}" loading="lazy" width="400" height="225" decoding="async" onload="this.classList.add('loaded')" onerror="this.classList.add('loaded')" class="loaded">
      ${score}<span class="card-cat">${esc(CAT_LABELS[a.cat] || '')}</span>
    </div>
    <div class="card-body">
      <div class="card-title">${esc(a.title)}</div>
      <div class="card-foot">
        <span class="card-author">${esc(a.author || '')}</span>
        <span class="card-date">${esc(a.date || '')}${a.time ? ' · ' + esc(a.time) : ''}</span>
        ${readTime}
      </div>
    </div>
  </a>`;
}

/* בונה גריד סטטי שלם — עד 8 כרטיסים ראשונים, זהה למה ש-BASE=8 בלקוח מציג */
function buildStaticGrid(lightRows, filterFn, limit = 8) {
  const items = lightRows.filter(filterFn).slice(0, limit);
  return items.map(buildStaticCard).join('');
}

function buildStaticHeroSlide(lightRows) {
  const pool = lightRows.filter(r => r.cat !== 'quick');
  const main = pool.find(r => r.featured) || pool[0];
  if (!main || !main.img || String(main.img).trim().length <= 5) return '';
  const raw = String(main.img).trim();
  const img = heroSrc(raw);
  const srcset = heroSrcset(raw);
  const badge = esc(CAT_LABELS[main.cat] || '');
  const timeStr = main.time ? ('<span class="hb3-sep">·</span><span class="hb3-when">' + esc(main.time) + '</span>') : '';
  return '<div class="hero-banner"><div class="hero-banner-track" style="direction:ltr;">'
    + '<div class="hero-banner-slide" style="direction:rtl;">'
    + `<img src="${esc(img)}"${srcset ? ` srcset="${esc(srcset)}" sizes="100vw"` : ''} alt="${esc(main.title)}" loading="eager" fetchpriority="high" decoding="sync" width="850" height="500">`
    + '<div class="hb3-fade" aria-hidden="true"></div>'
    + `<div class="hb3-read">${hbReadTime(main)}<span>דק'</span></div>`
    + '<div class="hb3-txt">'
    + `<span class="hb3-cat">${badge}</span>`
    + `<div class="hb3-title">${esc(main.title)}</div>`
    + `<div class="hb3-meta"><span class="hb3-author">${esc(main.author || 'ספידומטר')}</span><span class="hb3-sep">·</span><span class="hb3-when">${esc(main.date || '')}</span>${timeStr}</div>`
    + '</div></div></div></div>';
}

/* בונה תג preload לתמונת ה-hero — אותה בחירת כתבה כמו buildHero בלקוח: featured ראשון, אחרת החדשה ביותר */
function buildHeroPreloadTag(lightRows) {
  const pool = lightRows.filter(r => r.cat !== 'quick');
  const main = pool.find(r => r.featured) || pool[0];
  if (!main || !main.img || String(main.img).trim().length <= 5) return '';
  const raw = String(main.img).trim();
  const href = heroSrc(raw);
  const srcset = heroSrcset(raw);
  const srcsetAttrs = srcset ? ` imagesrcset="${esc(srcset)}" imagesizes="(max-width:980px) 100vw, 800px"` : '';
  return `<link rel="preload" as="image" href="${esc(href)}"${srcsetAttrs} fetchpriority="high">`;
}

/* מזריק תוכן בין סמני BUILD — אידמפוטנטי (מחליף את מה שהיה שם בריצה הקודמת) */
function injectBetween(html, name, content) {
  const re = new RegExp(`<!-- BUILD:${name}:START -->[\\s\\S]*?<!-- BUILD:${name}:END -->`);
  if (!re.test(html)) return html; // תבנית ישנה בלי סמנים - לא נוגעים
  return html.replace(re, `<!-- BUILD:${name}:START -->${content}<!-- BUILD:${name}:END -->`);
}

async function fetchArticles(supabase) {
  const { data, error } = await supabase
    .from('articles')
    .select('id,title,sub,cat,author,date,time,img,body,body_images,score,specs,deleted,live_updates,yt_urls,faq')
    .order('id', { ascending: false });
  if (error) throw new Error(`Supabase fetch failed: ${error.message}`);
  return (data || []).filter(a => !a.deleted && a.cat !== 'quick');
}

/* שליפת קטלוג הרכבים החי מטבלת public.cars (Phase 2 - במקום cars.json הסטטי) */
async function fetchCars(supabase) {
  const { data, error } = await supabase
    .from('cars')
    .select('*')
    .order('sales_rank', { ascending: true, nullsFirst: false });
  if (error) throw new Error(`Supabase cars fetch failed: ${error.message}`);
  return (data || []).filter(c => c && c.slug && !c.deleted);
}

/* ═══════════════════════════════════════════════════════════════
 * רינדור סטטי לעמודי רכב בודד — /car/{slug}/index.html
 * ---------------------------------------------------------------
 * פותר בדיוק את אותה בעיה שנפתרה לכתבות (ראו הסבר בראש הקובץ):
 * car.html הוא קובץ יחיד שמזהה רכב לפי querystring (?id=...), ולכן
 * מנוע חיפוש שמגיע אליו רואה בכל פעם את אותו <title>טוען...</title>
 * ריק - זהה לכל אחד מ-25 הרכבים במאגר. כאן בונים עמוד נתיב ייעודי
 * לכל רכב (/car/{slug}/, במקביל מדויק ל-/article/{id}/ של הכתבות)
 * עם title/meta/canonical/OG/JSON-LD ותוכן אמיתי אפויים מראש בתוך
 * ה-HTML הגולמי, כדי שגוגל יראה תוכן ייחודי ומלא ב-byte הראשון.
 * הנתונים מגיעים מטבלת public.cars בסופרבייס (Phase 2, החל מ-18.9.2026) -
 * בדיוק כמו articles, כולל אותו דפוס deleted/soft-delete. cars.json הסטטי
 * הישן כבר לא נקרא כאן; הוא עדיין קיים בריפו רק כגיבוי היסטורי.
 * חשוב: renderCarBodyHTML כאן היא עותק נאמן (עם esc() להגנה) של
 * renderPage() בצד הלקוח שב-car.html - כל שינוי בתוכן/עיצוב חייב
 * להתעדכן בשני המקומות יחד.
 * ═══════════════════════════════════════════════════════════════ */

const CAR_TEMPLATE_PATH = path.join(SITE_DIR, 'car.html');
const CAR_OUT_DIR = path.resolve(process.cwd(), 'car');

function formatPriceILS(p) {
  return '₪' + Number(p).toLocaleString('he-IL');
}

const CAR_FEATURE_ICONS = { 'מסך': '📱', 'Apple': '📱', 'Android': '📱', 'גג': '🌟', 'מושב': '💺', 'קרוז': '🎯', 'כניסה': '🔑', 'מזג': '❄️', 'Bose': '🔊', 'Harman': '🔊', 'Canton': '🔊', 'Meridian': '🔊', 'רמקול': '🔊', 'מצלמ': '📷', 'חניה': '🅿️', 'HUD': '🖥️', 'LED': '💡', 'ניווט': '🧭', 'Wi-Fi': '📶', 'כריות': '🛡️' };
function carFeatureIcon(f) {
  for (const [k, v] of Object.entries(CAR_FEATURE_ICONS)) {
    if (f.includes(k)) return v;
  }
  return '✦';
}

/* ─────────────────────────────────────────────────────────────────
 * רמות גימור (trims) — עותק נאמן (עם esc()) של אותה הלוגיקה בדיוק
 * שב-car.html (isRichTrims/mergeTrim/buildSpecsGroupsHtml/buildTrimCompareHtml/
 * buildTrimPillsHtml). כאן זה רק ה"תמונת מצב" הראשונית (רמת הגימור
 * הבסיסית, אינדקס 0) לצורך SEO/שיתוף - ה-JS בצד הלקוח (אותו <script>
 * שנשאב מ-car.html כמות שהוא) מחליף את זה מיד עם רינדור אינטראקטיבי
 * מלא כולל מתג רמות הגימור החי. כל שינוי כאן חייב להתעדכן גם ב-car.html. ─── */
function isRichTrims(trims) {
  return Array.isArray(trims) && trims.length > 0 && trims[0] && typeof trims[0] === 'object';
}
function mergeTrim(c, trim) {
  if (!trim) return c;
  const merged = Object.assign({}, c);
  const overridable = ['drive_type', 'horsepower', 'torque', 'acceleration_0_100', 'top_speed', 'range_ev', 'battery_capacity_kwh', 'weight', 'safety_rating', 'price'];
  overridable.forEach(k => { if (trim[k] !== undefined && trim[k] !== null && trim[k] !== '') merged[k] = trim[k]; });
  merged._trimName = trim.name || '';
  merged._trimNotable = (trim.notable_features && trim.notable_features.length) ? trim.notable_features : null;
  return merged;
}
function buildSpecsGroupsHtml(c) {
  function row(label, val) { return val ? `<tr><td>${esc(label)}</td><td>${esc(String(val))}</td></tr>` : ''; }
  function group(title, rowsHtml) {
    return rowsHtml ? `<div class="specs-group"><div class="specs-group-title">${title}</div><table class="specs-table">${rowsHtml}</table></div>` : '';
  }

  const origin = c.country_of_origin || c.country;
  let idCardRows = row('שנה', c.year);
  idCardRows += row('קטגוריה', c.category);
  idCardRows += row('יבואן רשמי', c.importer);
  idCardRows += row('ארץ ייצור', origin);
  idCardRows += (c.pollution_index != null && c.pollution_index !== '') ? row('מדד זיהום אוויר', c.pollution_index + ' מתוך 15') : '';
  idCardRows += row('דירוג/מדד בטיחות', c.safety_rating);
  idCardRows += c.sales_units ? row('מכירות בישראל', Number(c.sales_units).toLocaleString() + ' יחידות' + (c.sales_year ? ' (' + c.sales_year + ')' : '')) : '';

  let engineRows = row('מנוע', c.engine);
  engineRows += row('הספק', c.horsepower ? c.horsepower + ' כ"ס' : '');
  engineRows += row('מומנט', c.torque ? c.torque + ' Nm' : '');
  engineRows += row('תאוצה 0-100', c.acceleration_0_100 ? c.acceleration_0_100 + ' שניות' : '');
  engineRows += row('מהירות מקסימלית', c.top_speed ? c.top_speed + ' קמ"ש' : '');
  engineRows += row('תיבת הילוכים', c.transmission);
  engineRows += row('הנעה', c.drive_type);

  let electricRows = row('טווח נסיעה חשמלי', c.range_ev ? c.range_ev + ' ק"מ' : '');
  electricRows += row('קיבולת סוללה', c.battery_capacity_kwh ? c.battery_capacity_kwh + ' kWh' : '');

  const fuelRows = row('צריכת דלק ממוצעת', c.fuel_consumption ? c.fuel_consumption + ' ל/100 ק"מ' : '');

  let dimRows = row('תא מטען', c.trunk_volume ? c.trunk_volume + ' ליטר' : '');
  dimRows += row('משקל', c.weight ? Number(c.weight).toLocaleString() + ' ק"ג' : '');
  dimRows += row('אורך', c.length ? c.length + ' מ"מ' : '');
  dimRows += row('רוחב', c.width ? c.width + ' מ"מ' : '');
  dimRows += row('גובה', c.height ? c.height + ' מ"מ' : '');
  dimRows += row('מידת צמיגים', c.tires);

  let html = '';
  html += group('🪪 תעודת זהות', idCardRows);
  html += group('🔧 מנוע וביצועים', engineRows);
  html += group('🔋 חשמל וטעינה', electricRows);
  html += group('⛽ צריכת דלק', fuelRows);
  html += group('📐 מידות ומשקל', dimRows);

  if (c._trimNotable) {
    html += `<div class="specs-group">
      <div class="specs-group-title">⭐ מאפיינים ייחודיים${c._trimName ? ' — ' + esc(c._trimName) : ''}</div>
      <div class="features-grid">
        ${c._trimNotable.map(f => `<div class="feature-card"><span class="feature-icon">✦</span><span>${esc(f)}</span></div>`).join('')}
      </div>
    </div>`;
  }
  return html;
}
function buildTrimCompareHtml(trims) {
  if (!trims || trims.length < 2) return '';
  const fields = [
    { k: 'price', label: 'מחיר', fmt: v => formatPriceILS(v) },
    { k: 'horsepower', label: 'הספק', fmt: v => v + ' כ"ס' },
    { k: 'torque', label: 'מומנט', fmt: v => v + ' Nm' },
    { k: 'acceleration_0_100', label: 'תאוצה 0-100', fmt: v => v + ' שנ׳' },
    { k: 'top_speed', label: "מהירות מקס'", fmt: v => v + ' קמ"ש' },
    { k: 'range_ev', label: 'טווח חשמלי', fmt: v => v + ' ק"מ' },
    { k: 'battery_capacity_kwh', label: 'קיבולת סוללה', fmt: v => v + ' kWh' },
    { k: 'weight', label: 'משקל', fmt: v => Number(v).toLocaleString() + ' ק"ג' },
    { k: 'drive_type', label: 'הנעה', fmt: v => esc(String(v)) },
    { k: 'safety_rating', label: 'דירוג בטיחות', fmt: v => esc(String(v)) },
  ];
  const activeFields = fields.filter(f => trims.some(t => t[f.k] !== null && t[f.k] !== undefined && t[f.k] !== ''));
  if (!activeFields.length) return '';
  return `
    <div class="trim-compare-scroll">
      <table class="trim-compare-table">
        <tr><th>מפרט</th>${trims.map(t => `<th>${esc(t.name || '')}</th>`).join('')}</tr>
        ${activeFields.map(f => `<tr><td>${esc(f.label)}</td>${trims.map(t => {
          const v = t[f.k];
          return `<td>${(v !== null && v !== undefined && v !== '') ? f.fmt(v) : '—'}</td>`;
        }).join('')}</tr>`).join('')}
      </table>
    </div>`;
}
function buildTrimPillsHtml(trims, activeIdx) {
  return `<div class="trim-pills">${trims.map((t, i) => `<button type="button" class="trim-pill${i === activeIdx ? ' active' : ''}" onclick="selectTrim(${i},this)">${esc(t.name || ('רמה ' + (i + 1)))}</button>`).join('')}</div>`;
}

function renderCarBodyHTML(c, allCars) {
  const evRange = c.range_ev ?? c.range;
  const desc = c.description || '';

  const richTrims = isRichTrims(c.trims) ? c.trims : null;
  const trimsBlockHtml = richTrims ? `
    <div class="trim-switcher-wrap">
      ${buildTrimCompareHtml(richTrims)}
      ${richTrims.length >= 2 ? buildTrimPillsHtml(richTrims, 0) : ''}
    </div>` : '';
  const initialSpecsMerged = richTrims ? mergeTrim(c, richTrims[0]) : c;
  const specsGroupsHtml = buildSpecsGroupsHtml(initialSpecsMerged);
  const legacyTrimsHtml = (c.trims && !richTrims) ? `
    <div class="specs-group">
      <div class="specs-group-title">🏷️ גרסאות זמינות</div>
      <table class="specs-table">
        ${c.trims.map((t, i) => `<tr><td>גרסה ${i + 1}</td><td>${esc(t)}</td></tr>`).join('')}
      </table>
    </div>` : '';

  const featuresHtml = c.features ? `
    <div class="features-grid">
      ${c.features.map(f => `
        <div class="feature-card">
          <span class="feature-icon">${carFeatureIcon(f)}</span>
          <span>${esc(f)}</span>
        </div>
      `).join('')}
    </div>` : '<p style="color:var(--muted)">אין מידע</p>';

  const safetyHtml = c.safety_features ? `
    <div class="features-grid">
      ${c.safety_features.map(f => `
        <div class="feature-card safety-feature-card">
          <span class="feature-icon">🛡️</span>
          <span>${esc(f)}</span>
        </div>
      `).join('')}
    </div>` : '<p style="color:var(--muted)">אין מידע</p>';

  const galleryImages = c.gallery_images || [];
  const galleryHtml = galleryImages.length > 0 ? `
    <div class="gallery-grid">
      ${galleryImages.map((img, i) => `
        <div class="gallery-item" onclick="openLightbox(${i})" role="button" tabindex="0"
          aria-label="תמונה ${i + 1}" onkeydown="if(event.key==='Enter')openLightbox(${i})">
          <img src="${esc(img)}" alt="${esc(c.brand)} ${esc(c.model)} - תמונה ${i + 1}" loading="lazy" width="300" height="169">
          <div class="gallery-item-overlay">
            <div class="gallery-zoom-icon">🔍</div>
          </div>
        </div>
      `).join('')}
    </div>` : '<p style="color:var(--muted);font-size:0.85rem">אין תמונות נוספות</p>';

  let videoHtml = '<p style="color:var(--muted);font-size:0.85rem">סרטון לא זמין לדגם זה</p>';
  let vidId = null;
  if (c.youtube_video_url) {
    const m = c.youtube_video_url.match(/(?:v=|youtu\.be\/)([^&?]+)/);
    vidId = m ? m[1] : null;
  }
  if (vidId) {
    videoHtml = `
      <div class="video-embed-wrap" onclick="loadYoutube(this,'${vidId}')" id="video-wrap">
        <img class="video-thumbnail" src="https://img.youtube.com/vi/${vidId}/hqdefault.jpg"
          alt="סרטון ${esc(c.brand)} ${esc(c.model)}" loading="lazy">
        <div class="video-play-btn">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><polygon points="5,3 19,12 5,21"/></svg>
        </div>
      </div>`;
  }

  const related = allCars.filter(x => x.category === c.category && x.slug !== c.slug).slice(0, 3);
  const relatedHtml = related.map(r => `
      <a class="related-card" href="/car/${esc(r.slug)}/" aria-label="${esc(r.brand)} ${esc(r.model)} ${r.year}">
        <div class="related-card-img">
          <img src="${esc(r.image_main)}" alt="${esc(r.brand)} ${esc(r.model)}" loading="lazy" width="260" height="146">
        </div>
        <div class="related-card-body">
          <div class="related-card-brand">${esc(r.brand)}</div>
          <div class="related-card-name">${esc(r.model)} ${r.year}</div>
          <div class="related-card-price">${formatPriceILS(r.price)}</div>
        </div>
      </a>
    `).join('');

  const prosConsHtml = (c.pros && c.cons) ? `
          <div class="pros-cons">
            <div class="pros-col">
              <div class="pros-cons-title">✅ יתרונות</div>
              <ul class="pros-cons-list">
                ${c.pros.map(p => `<li>${esc(p)}</li>`).join('')}
              </ul>
            </div>
            <div class="cons-col">
              <div class="pros-cons-title">❌ חסרונות</div>
              <ul class="pros-cons-list">
                ${c.cons.map(p => `<li>${esc(p)}</li>`).join('')}
              </ul>
            </div>
          </div>` : '';

  return `
    <!-- HERO -->
    <div class="car-hero">
      <img class="car-hero-img loaded" id="hero-img" src="${esc(c.image_main)}"
        alt="${esc(c.brand)} ${esc(c.model)} ${c.year}"
        fetchpriority="high" width="1100" height="520">
      <div class="car-hero-overlay"></div>
      <div class="car-hero-content">
        <div class="car-hero-inner">
          <span class="car-hero-cat">${esc(c.category || '')}</span>
          <h1 class="car-hero-title">${esc(c.brand)} ${esc(c.model)} ${c.year}</h1>
          <p class="car-hero-sub">${esc(desc.slice(0, 120))}...</p>
          <div class="car-hero-stats">
            ${c.horsepower ? `<div class="car-hero-stat">
              <span class="car-hero-stat-val">${c.horsepower}</span>
              <span class="car-hero-stat-label">כוחות סוס</span>
            </div>` : ''}
            <div class="car-hero-stat">
              <span class="car-hero-stat-val">${c.acceleration_0_100}s</span>
              <span class="car-hero-stat-label">0-100</span>
            </div>
            <div class="car-hero-stat">
              <span class="car-hero-stat-val">${formatPriceILS(c.price)}</span>
              <span class="car-hero-stat-label">מחיר</span>
            </div>
            ${evRange ? `<div class="car-hero-stat"><span class="car-hero-stat-val">${evRange}</span><span class="car-hero-stat-label">ק"מ טווח</span></div>` : ''}
          </div>
        </div>
      </div>
    </div>

    <!-- QUICK SPECS STRIP -->
    <div class="spec-strip-wrap">
      <div class="spec-strip" role="list" aria-label="מפרט מהיר">
        ${c.horsepower ? `<div class="spec-strip-item" role="listitem">
          <div class="spec-strip-icon">⚡</div>
          <div class="spec-strip-val">${c.horsepower}</div>
          <div class="spec-strip-label">כוחות סוס</div>
        </div>` : ''}
        <div class="spec-strip-item" role="listitem">
          <div class="spec-strip-icon">🏎️</div>
          <div class="spec-strip-val">${c.acceleration_0_100}s</div>
          <div class="spec-strip-label">0-100 קמ"ש</div>
        </div>
        ${evRange ? `
        <div class="spec-strip-item" role="listitem">
          <div class="spec-strip-icon">🔋</div>
          <div class="spec-strip-val">${evRange}</div>
          <div class="spec-strip-label">טווח (ק"מ)</div>
        </div>` : ''}
        ${c.fuel_consumption ? `
        <div class="spec-strip-item" role="listitem">
          <div class="spec-strip-icon">⛽</div>
          <div class="spec-strip-val">${esc(c.fuel_consumption || '')}</div>
          <div class="spec-strip-label">ל/100ק"מ</div>
        </div>` : ''}
        <div class="spec-strip-item" role="listitem">
          <div class="spec-strip-icon">🔧</div>
          <div class="spec-strip-val" style="font-size:0.82rem;font-weight:700">${esc(c.engine || '')}</div>
          <div class="spec-strip-label">מנוע</div>
        </div>
        <div class="spec-strip-item" role="listitem">
          <div class="spec-strip-icon">🚗</div>
          <div class="spec-strip-val" style="font-size:0.8rem;font-weight:700">${esc(c.drive_type || '')}</div>
          <div class="spec-strip-label">הנעה</div>
        </div>
        <div class="spec-strip-item" role="listitem">
          <div class="spec-strip-icon">⚙️</div>
          <div class="spec-strip-val" style="font-size:0.78rem;font-weight:700">${esc((c.transmission || '').split(' ').slice(0, 2).join(' '))}</div>
          <div class="spec-strip-label">תיבת הילוכים</div>
        </div>
        <div class="spec-strip-item" role="listitem">
          <div class="spec-strip-icon">💰</div>
          <div class="spec-strip-val" style="font-size:0.88rem">${formatPriceILS(c.price)}</div>
          <div class="spec-strip-label">מחיר</div>
        </div>
      </div>
    </div>

    <!-- CONTENT -->
    <div class="car-content">
      <div class="car-main">

        <!-- TABS -->
        <nav class="tabs-nav" role="tablist" aria-label="מידע על הרכב">
          <button class="tab-btn active" role="tab" aria-selected="true" onclick="switchTab('overview', this)">סקירה כללית</button>
          <button class="tab-btn" role="tab" aria-selected="false" onclick="switchTab('specs', this)">מפרט טכני</button>
          <button class="tab-btn" role="tab" aria-selected="false" onclick="switchTab('features', this)">תכונות</button>
          <button class="tab-btn" role="tab" aria-selected="false" onclick="switchTab('safety', this)">בטיחות</button>
          <button class="tab-btn" role="tab" aria-selected="false" onclick="switchTab('gallery', this)">גלריה</button>
          ${vidId ? `<button class="tab-btn" role="tab" aria-selected="false" onclick="switchTab('video', this)">סרטון</button>` : ''}
        </nav>

        <div class="tab-pane active" id="tab-overview" role="tabpanel">
          <p class="overview-text">${esc(desc)}</p>
          ${prosConsHtml}
        </div>

        <div class="tab-pane" id="tab-specs" role="tabpanel">
          ${trimsBlockHtml}
          <div id="specs-dynamic-groups">${specsGroupsHtml}</div>
          ${legacyTrimsHtml}
        </div>

        <div class="tab-pane" id="tab-features" role="tabpanel">
          <div class="section-heading">אמצעי נוחות וטכנולוגיה</div>
          ${featuresHtml}
        </div>

        <div class="tab-pane" id="tab-safety" role="tabpanel">
          <div class="section-heading">מערכות בטיחות</div>
          ${safetyHtml}
        </div>

        <div class="tab-pane" id="tab-gallery" role="tabpanel">
          <div class="section-heading">גלריית תמונות</div>
          ${galleryHtml}
        </div>

        <div class="tab-pane" id="tab-video" role="tabpanel">
          <div class="section-heading">סרטון</div>
          ${videoHtml}
        </div>

        <div style="margin-top:36px" id="related-section"${related.length ? '' : ' style="display:none"'}>
          <div class="section-heading">רכבים דומים</div>
          <div id="related-grid" class="related-grid">${relatedHtml}</div>
        </div>

      </div>

      <!-- SIDEBAR -->
      <aside class="car-sidebar">
        <div class="sidebar-box" id="price-section">
          <div class="sidebar-box-title">${(c.price_top && c.price_top > c.price) ? 'מחיר מחירון - החל מ' : 'מחיר מחירון'}</div>
          <div class="sidebar-price">${formatPriceILS(c.price)}</div>
          <div class="sidebar-price-note">${(c.price_top && c.price_top > c.price) ? ('עד ' + formatPriceILS(c.price_top) + ' ברמת הגימור הגבוהה · מחיר לפני אפשרויות') : 'מחיר לפני אפשרויות. צור קשר לקבלת הצעה'}</div>
          <a href="https://wa.me/972559365579" target="_blank" rel="noopener noreferrer" class="btn-primary" aria-label="ייעוץ בוואטסאפ">💬 ייעוץ בוואטסאפ</a>
          <a href="/cars-list.html" class="btn-secondary">← השווה רכבים</a>
          <div class="share-btn-row">
            <button class="share-btn" onclick="shareCar()" aria-label="שתף">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              שתף
            </button>
            <button class="share-btn" onclick="copyLink()" aria-label="העתק קישור">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              קישור
            </button>
          </div>
        </div>

        <div class="sidebar-box">
          <div class="sidebar-box-title">נתוני מפתח</div>
          <div class="key-specs-list">
            <div class="key-spec-row">
              <span class="key-spec-label"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg> ארץ ייצור</span>
              <span class="key-spec-val">${esc(c.country_of_origin || c.country || '—')}</span>
            </div>
            <div class="key-spec-row">
              <span class="key-spec-label">📅 שנה</span>
              <span class="key-spec-val">${c.year}</span>
            </div>
            ${c.trunk_volume ? `<div class="key-spec-row"><span class="key-spec-label">🧳 תא מטען</span><span class="key-spec-val">${c.trunk_volume} ל'</span></div>` : ''}
            ${c.top_speed ? `<div class="key-spec-row"><span class="key-spec-label">⚡ מהירות מקס'</span><span class="key-spec-val">${c.top_speed} קמ"ש</span></div>` : ''}
            ${c.torque ? `<div class="key-spec-row"><span class="key-spec-label">🔩 מומנט</span><span class="key-spec-val">${c.torque} Nm</span></div>` : ''}
          </div>
        </div>

        ${c.colors ? `
        <div class="sidebar-box">
          <div class="sidebar-box-title">צבעים זמינים</div>
          <div class="colors-list">
            ${c.colors.map(col => `<span class="color-chip" title="${esc(col)}">${esc(col)}</span>`).join('')}
          </div>
        </div>` : ''}
      </aside>
    </div>`;
}

function hydrateTemplateForCar(template, c, allCars) {
  let html = template;
  const pageTitle = c.meta_title || `${c.brand} ${c.model} ${c.year} | ספידומטר`;
  const pageDesc = c.meta_description || plainTextExcerpt(c.description || '') || pageTitle;
  const canonicalUrl = `${SITE}/car/${c.slug}/`;
  const shareImg = ogImage(c.image_main);

  html = html.replace('<title>טוען...</title>', `<title>${esc(pageTitle)}</title>`);
  html = html.replace('<meta name="description" content="">', `<meta name="description" content="${esc(pageDesc)}">`);
  html = html.replace('<link rel="canonical" href="">', `<link rel="canonical" href="${canonicalUrl}">`);
  html = html.replace('<meta property="og:title" content="">', `<meta property="og:title" content="${esc(pageTitle)}">`);
  html = html.replace('<meta property="og:description" content="">', `<meta property="og:description" content="${esc(pageDesc)}">`);
  html = html.replace('<meta property="og:url" content="">', `<meta property="og:url" content="${canonicalUrl}">`);
  html = html.replace('<meta property="og:image" content="">', `<meta property="og:image" content="${esc(shareImg)}">`);
  html = html.replace('<meta name="twitter:title" content="">', `<meta name="twitter:title" content="${esc(pageTitle)}">`);
  html = html.replace('<meta name="twitter:description" content="">', `<meta name="twitter:description" content="${esc(pageDesc)}">`);
  html = html.replace('<meta name="twitter:image" content="">', `<meta name="twitter:image" content="${esc(shareImg)}">`);

  const ld = {
    '@context': 'https://schema.org', '@type': 'Car',
    name: `${c.brand} ${c.model} ${c.year}`,
    brand: { '@type': 'Brand', name: c.brand },
    modelDate: String(c.year),
    description: c.description,
    image: c.image_main,
    offers: { '@type': 'Offer', price: c.price, priceCurrency: 'ILS' }
  };
  html = html.replace(
    '</head>',
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>\n</head>`
  );

  html = html.replace(
    '<span id="breadcrumb-name">טוען...</span>',
    `<span id="breadcrumb-name">${esc(`${c.brand} ${c.model} ${c.year}`)}</span>`
  );

  html = html.replace(
    `<div id="car-page-root">
  <div class="car-page-loading">
    <div class="loading-spinner"></div>
    <span>טוען מידע על הרכב...</span>
  </div>
</div>`,
    `<div id="car-page-root">${renderCarBodyHTML(c, allCars)}</div>`
  );

  return html;
}

async function main() {
  const targetArticleId = process.env.TARGET_ARTICLE_ID
    ? parseInt(process.env.TARGET_ARTICLE_ID)
    : null;

  console.log('🔄 מתחבר ל-Supabase...');
  const supabase = createClient(SB_URL, SB_KEY);
  const liveArticles = await fetchArticles(supabase);
  console.log(`✅ נשלפו ${liveArticles.length} כתבות פעילות.`);

  console.log('📄 קורא את תבנית האתר (index.html)...');
  let template = await readFile(TEMPLATE_PATH, 'utf-8');

  // ═══ אופטימיזציית LCP לדף הבית ═══
  console.log('⚡ בונה snapshot נתונים + hero preload...');
  const lightRows = await fetchLightRows(supabase);
  const snapshotTag = buildSnapshotTag(lightRows);
  const heroPreloadTag = buildHeroPreloadTag(lightRows);

  // ה-snapshot נכנס לתבנית עצמה → גם דפי הכתבות מקבלים רינדור מיידי של המקטעים
  template = injectBetween(template, 'DATA_SNAPSHOT', snapshotTag);

  // דף הבית (+404 הזהה) מקבל בנוסף preload לתמונת ה-hero + שקופית ראשונה סטטית לקרוסולת המובייל
  let rootHtml = injectBetween(template, 'HERO_PRELOAD', heroPreloadTag);
  rootHtml = injectBetween(rootHtml, 'HERO_SLIDE', buildStaticHeroSlide(lightRows));
  await writeFile(TEMPLATE_PATH, rootHtml, 'utf-8');
  await writeFile(path.join(SITE_DIR, '404.html'), rootHtml, 'utf-8');
  console.log(`✅ index.html + 404.html עודכנו (snapshot: ${Math.min(lightRows.length,16)} כתבות, preload: ${heroPreloadTag ? 'כן' : 'אין תמונת hero'})`);
  if (!template.includes('id="art-body"')) {
    throw new Error('התבנית לא מכילה את המבנה הצפוי (#art-body) - בדוק את index.html בשורש הריפו');
  }

  const articlesToRender = targetArticleId
    ? liveArticles.filter(a => a.id === targetArticleId)
    : liveArticles;

  if (targetArticleId && articlesToRender.length === 0) {
    console.warn(`⚠️ כתבה ${targetArticleId} לא נמצאה (אולי נמחקה) - מדלגים על רינדור ממוקד, מרעננים sitemap בלבד.`);
  }

  if (!targetArticleId) {
    await rm(OUT_DIR, { recursive: true, force: true });
    await mkdir(OUT_DIR, { recursive: true });
  } else {
    await mkdir(OUT_DIR, { recursive: true });
  }

  let written = 0;
  for (const a of articlesToRender) {
    const dir = path.join(OUT_DIR, String(a.id));
    await mkdir(dir, { recursive: true });
    const hydrated = hydrateTemplateForArticle(template, a);
    await writeFile(path.join(dir, 'index.html'), hydrated, 'utf-8');
    written++;
    console.log(`  → /article/${a.id}/index.html (${a.title.slice(0, 40)}...)`);
  }
  console.log(`📄 נכתבו ${written} עמודי כתבה.`);

  if (!targetArticleId) {
    const existingIds = new Set(liveArticles.map(a => String(a.id)));
    const dirs = await readdir(OUT_DIR).catch(() => []);
    for (const d of dirs) {
      if (!existingIds.has(d)) {
        await rm(path.join(OUT_DIR, d), { recursive: true, force: true });
        console.log(`  🗑️  הוסרה תיקייה ישנה: /article/${d}/ (כתבה נמחקה/לא קיימת)`);
      }
    }
  }

  // ═══ עמודי רכב סטטיים (/car/{slug}/) - לא רצים כשמריצים ריצה ממוקדת לכתבה בודדת ═══
  let liveCars = [];
  if (!targetArticleId) {
    console.log('🚗 שולף רכבים מ-Supabase (public.cars) ובונה עמודי רכב סטטיים...');
    try {
      liveCars = await fetchCars(supabase);
      const carTemplate = await readFile(CAR_TEMPLATE_PATH, 'utf-8');

      await rm(CAR_OUT_DIR, { recursive: true, force: true });
      await mkdir(CAR_OUT_DIR, { recursive: true });

      let carsWritten = 0;
      for (const c of liveCars) {
        const dir = path.join(CAR_OUT_DIR, c.slug);
        await mkdir(dir, { recursive: true });
        const hydrated = hydrateTemplateForCar(carTemplate, c, liveCars);
        await writeFile(path.join(dir, 'index.html'), hydrated, 'utf-8');
        carsWritten++;
      }
      console.log(`🚗 נכתבו ${carsWritten} עמודי רכב תחת /car/{slug}/.`);
    } catch (err) {
      console.error('⚠️ שגיאה בבניית עמודי רכב סטטיים - ממשיכים בלי לעצור את שאר הריצה:', err.message || err);
    }
  }

  await writeFile(SITEMAP_PATH, buildSitemap(liveArticles, liveCars), 'utf-8');
  console.log(`🗺️  sitemap.xml נכתב עם ${liveArticles.length + liveCars.length + 1} כתובות.`);

  await writeFile(NEWS_SITEMAP_PATH, buildNewsSitemap(liveArticles), 'utf-8');
  console.log(`📰 sitemap-news.xml נכתב (רק כתבות מ-48 השעות האחרונות).`);

  console.log('🎉 הסתיים בהצלחה.');
}

main().catch(err => {
  console.error('❌ שגיאה כללית:', err.message || err);
  process.exit(1);
});
