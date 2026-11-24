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
import vm from 'vm';
import { readFileSync } from 'fs';

// מבחן השוואתי: אותה פונקציית רינדור בדיוק כמו בדפדפן (comparison.js בשורש הריפו).
// נטען דרך vm ולא require, כי package.json מוגדר "type":"module" ו-comparison.js הוא סקריפט דפדפן רגיל.
// אם הקובץ חסר או שבור, הדפים נבנים כרגיל בלי הטבלה (לא מפילים את כל הריצה).
let spCompare = null;
try {
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(readFileSync(new URL('../comparison.js', import.meta.url), 'utf-8'), sandbox, { filename: 'comparison.js' });
  const api = sandbox.module.exports;
  if (api && typeof api.render === 'function' && typeof api.isComparison === 'function') spCompare = api;
  else console.warn('⚠️ comparison.js נטען אבל בלי render — מבחנים השוואתיים ייבנו בלי טבלה סטטית');
} catch (e) {
  console.warn('⚠️ comparison.js לא נטען — מבחנים השוואתיים ייבנו בלי טבלה סטטית:', e.message);
}

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
  // התמונה המקורית (ישירות מ-Supabase) ראשונה: גוגל לא תלוי רק בשירות חיצוני (wsrv)
  const v = (w, h) => ({
    '@type': 'ImageObject',
    url: `https://wsrv.nl/?url=${enc}&w=${w}&h=${h}&fit=cover&output=jpg&q=80`,
    width: w,
    height: h
  });
  return [url, v(1200, 675), v(1200, 900), v(1200, 1200)];
}

/** הופך כתובות https:// וקישורי [טקסט](כתובת) לקישורים לחיצים - זהה ל-linkifyEscaped ב-app.js */
function linkifyEscaped(h){const L=[];const tag=(href,label)=>{L.push('<a href="'+href+'" target="_blank" rel="noopener noreferrer" style="overflow-wrap:anywhere;word-break:break-word">'+label+'</a>');return '\u0000'+(L.length-1)+'\u0000';};h=h.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)<]+)\)/g,(m,t,u)=>tag(u,t));h=h.replace(/https?:\/\/[^\s<\u0000]+/g,m=>{let u=m,tail='';while(/[.,;:!?)\]]$/.test(u)&&!(u.endsWith(')')&&u.includes('('))){tail=u.slice(-1)+tail;u=u.slice(0,-1);}return tag(u,u)+tail;});return h.replace(/\u0000(\d+)\u0000/g,(m,i)=>L[+i]);}

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
      const withBold = linkifyEscaped(esc(line)).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      parts.push({ type: 'p', html: `<p>${withBold}</p>` });
    }
  }

  if (imgs.length === 0) return parts.map(p => p.html).join('\n');

  const figHTML = (img) =>
    `<figure class="body-img-wrap"><img src="${esc(isProxyable(img.src) ? wsrvW(img.src, 1000) : img.src)}" alt="${esc(img.cap || '')}" loading="lazy" decoding="async" width="800" height="450" data-lightbox="${esc(img.src)}" onerror="if(this.dataset.lightbox&&this.src!==this.dataset.lightbox){this.src=this.dataset.lightbox;}" style="cursor:zoom-in">${img.cap ? `<figcaption>${esc(img.cap)}</figcaption>` : ''}</figure>`;

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
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
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
  const bodyHTML = (liveUpdatesHTML + parseBodyToHTML(a.body, a.body_images, a.title) + buildCalcCTA(a))
    .replace(/href="(?!https?:|\/|#|mailto:|tel:|javascript:)([^"]+)"/g, 'href="/$1"');
  const latestUpdateTs = liveUpdates.length ? liveUpdates[liveUpdates.length - 1].ts : null;
  const readMins = Math.max(1, Math.ceil((a.body || '').split(/\s+/).filter(Boolean).length / 200));
  const shareImg = ogImage(img); // תמונת שיתוף 1200x630 JPG

  const schema = {
    '@context': 'https://schema.org',
    /* Review בלי ציון נדחה ב-Search Console ("חסר itemReviewed"). מבחן בלי ציון מסומן כ-Article רגיל. */
    '@type': a.cat === 'review' ? (a.score ? 'Review' : 'Article') : 'NewsArticle',
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
  const isComparison = !!(spCompare && a.cat === 'review' && spCompare.isComparison(a.specs));
  if (isComparison) spCompare.patchSchema(schema, a.specs);

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
    isoDate ? `<meta property="article:modified_time" content="${latestUpdateTs || isoDate}">` : '',
    `<meta property="article:author" content="${esc(a.author || 'מערכת ספידומטר')}">`,
    `<meta property="article:section" content="${esc(catLabel)}">`,
    `<meta property="og:locale" content="he_IL">`,
    `<meta name="author" content="${esc(a.author || 'מערכת ספידומטר')}">`
  ].filter(Boolean).join('\n');
  html = html.replace('</head>', `${extraMeta}\n</head>`);

  const articleSchemaTag = `<script type="application/ld+json" id="article-schema-prerendered">${JSON.stringify(schema)}</script>`;
  html = html.replace('</head>', `${articleSchemaTag}\n</head>`);
  if (!html.includes('id="breadcrumb-schema"')) {
    const crumbs = {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'ספידומטר', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: catLabel, item: CAT_PAGES.includes(a.cat) ? `${SITE}/${a.cat}/` : `${SITE}/?cat=${a.cat}` },
        { '@type': 'ListItem', position: 3, name: a.title },
      ],
    };
    html = html.replace('</head>', `<script type="application/ld+json" id="breadcrumb-schema">${JSON.stringify(crumbs).replace(/</g, '\\u003c')}</script>\n</head>`);
  }

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
  // שקופית ה-hero של דף הבית לא שייכת לעמוד כתבה: היא מכניסה לעמוד תמונה של כתבה אחרת, וגוגל עלול לבחור אותה כתמונה ממוזערת של הכתבה הזו
  html = injectBetween(html, 'HERO_SLIDE', '');
  if (isComparison) {
    html = html.replace(
      '<div id="art-spec" style="display:none;margin-bottom:0;"></div>',
      () => `<div id="art-spec" style="display:block;margin-bottom:0;">${spCompare.render(a.specs)}</div>` // פונקציה: מונע פירוש של $ בטקסט
    );
  }
  html = html.replace(
    '<div class="article-body" id="art-body"></div>',
    () => `<div class="article-body" id="art-body">${bodyHTML}</div>${buildRelatedHTML(a)}` // פונקציה: מונע פירוש של $ בטקסט
  );
  html = injectBetween(html, 'HOME_H1', ''); // בעמוד כתבה יש h1 אחד בלבד: כותרת הכתבה
  const bcHTML = `<a href="${SITE}/">בית</a><span class="bc-sep" aria-hidden="true">›</span><a href="${SITE}/?cat=${esc(a.cat)}">${esc(catLabel)}</a><span class="bc-sep" aria-hidden="true">›</span><span class="bc-current" aria-current="page">${esc(a.title.length > 48 ? a.title.slice(0, 48) + '…' : a.title)}</span>`;
  html = html.replace(
    '<nav class="breadcrumb-nav" id="art-breadcrumb" aria-label="נתיב ניווט"></nav>',
    `<nav class="breadcrumb-nav" id="art-breadcrumb" aria-label="נתיב ניווט">${bcHTML}</nav>`
  );

  // גוגל מציג תמונה גדולה בתוצאות/Discover רק עם max-image-preview:large
  html = html.replace(
    '<meta name="robots" content="index, follow">',
    '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">'
  );
  // חדשות בקליק: עמוד קיים (לא 404) אבל לא לאינדוקס
  if (a.cat === 'quick') {
    html = html.replace(/<meta name="robots" content="[^"]*">/, '<meta name="robots" content="noindex, follow">');
  }
  return html;
}

// עמודים סטטיים קבועים שאינם כתבות (כלים/מדריכים) — לא מגיעים מ-Supabase,
// ולכן חייבים רשימה ידנית כאן כדי שלא ייעלמו בכל ריצה מחדש של הסקריפט
// (ה-sitemap כולו נכתב מאפס בכל הרצה, אז בלי זה כל תוספת ידנית ל-sitemap.xml
// הייתה נמחקת אוטומטית תוך 4 שעות ע"י ה-GitHub Action).
const STATIC_PAGES = [
  { path: '/cars-list.html', changefreq: 'daily', priority: '0.9' },
  ...['local', 'world', 'review', 'electric', 'tech', 'buying', 'sport', 'luxury'].map(c => ({ path: `/${c}/`, changefreq: 'daily', priority: '0.8', cat: c })),
  { path: '/about/', changefreq: 'monthly', priority: '0.4' },
  { path: '/contact/', changefreq: 'yearly', priority: '0.3' },
  { path: '/terms/', changefreq: 'yearly', priority: '0.2' },
  { path: '/usage-value-calculator.html', changefreq: 'weekly', priority: '0.9' },
];

const carMod = c => String(c.updated_at || c.created_at || '').slice(0, 10);
function buildSitemap(articles, cars = []) {
  const today = new Date().toISOString().split('T')[0];
  const urls = [
    `<url><loc>${SITE}/</loc><lastmod>${today}</lastmod><changefreq>hourly</changefreq><priority>1.0</priority></url>`,
    ...STATIC_PAGES.filter(p => !p.cat || articles.some(a => a.cat === p.cat)).map(p =>
      `<url><loc>${SITE}${p.path}</loc><lastmod>${today}</lastmod><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`
    ),
    ...articles
      .filter(a => a.cat !== 'quick')
      .map(a => {
        const lastmod = toISODate(a.date)?.split('T')[0] || today;
        const rawImg = typeof a.img === 'string' ? a.img.trim() : '';
        const imgTag = /^https?:\/\//.test(rawImg)
          ? `<image:image><image:loc>${esc(rawImg)}</image:loc></image:image>`
          : '';
        return `<url><loc>${SITE}/article/${a.id}/</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority>${imgTag}</url>`;
      }),
    ...groupByBrand(cars).filter(g => /^[a-z0-9\u0590-\u05ff]+$/.test(g.info.key)).map(g =>
      `<url><loc>${SITE}/cars/${encodeURIComponent(g.info.key)}/</loc><lastmod>${g.cars.map(carMod).sort().pop() || today}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`),
    ...COMPARE_PAIRS.map(p =>
      `<url><loc>${SITE}/compare/${p.key}/</loc><lastmod>${[p.a, p.b].map(carMod).sort().pop() || today}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>`),
    ...cars.map(c =>
      /* lastmod = מתי הרכב באמת השתנה (updated_at), לא "היום" בכל ריצה — אחרת גוגל לומד להתעלם מהתאריך */
      `<url><loc>${SITE}/car/${c.slug}/</loc><lastmod>${String(c.updated_at || c.created_at || '').slice(0, 10) || today}</lastmod><changefreq>weekly</changefreq><priority>0.9</priority>${realImages(c).length ? `<image:image><image:loc>${esc(realImages(c)[0])}</image:loc></image:image>` : ''}</url>`
    )
  ].join('\n  ');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n  ${urls}\n</urlset>\n`;
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
function wsrvW(url, w) { return 'https://wsrv.nl/?url=' + encodeURIComponent(url) + '&w=' + w + '&fit=cover&output=webp&q=82'; }
function isProxyable(url) { return typeof url === 'string' && /^https?:\/\//.test(url) && url.indexOf('wsrv.nl') === -1 && url.indexOf('images.unsplash.com') === -1; }
function heroSrc(url) { return isProxyable(url) ? wsrvW(url, 1200) : url; }

function heroSrcset(url) {
  if (typeof url !== 'string') return '';
  if (url.indexOf('images.unsplash.com') !== -1) {
    return [320, 500, 800, 1200].map(w => url.replace(/([?&])w=\d+/, '$1w=' + w) + ' ' + w + 'w').join(', ');
  }
  if (isProxyable(url)) {
    return [400, 640, 800, 1200, 1600].map(w => wsrvW(url, w) + ' ' + w + 'w').join(', ');
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
  const srcsetAttrs = srcset ? ` imagesrcset="${esc(srcset)}" imagesizes="(max-width:980px) 100vw, 1000px"` : '';
  return `<link rel="preload" as="image" href="${esc(href)}"${srcsetAttrs} fetchpriority="high">`;
}

/* בלוק קישורים סטטי לכל עמודי הרכב — נכנס לפוטר של כל עמוד באתר (דף הבית, כל הכתבות) */
function buildCarsFooterLinks(cars) {
  return cars.map(c =>
    `<a href="/car/${esc(c.slug)}/" style="color:rgba(255,255,255,0.75);">${esc(c.brand)} ${esc(c.model)} ${esc(c.year)}</a>`
  ).join('');
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * SEO 16.11.2026 — קישורים פנימיים, נתונים מובנים ותוכן סטטי מלא לעמודי רכב
 * ═══════════════════════════════════════════════════════════════════════════════
 * הכול נבנה אך ורק מנתונים שקיימים במאגר. שדה ריק = לא מוצג ולא נכתב עליו כלום.
 */
const STOCK_IMG_RE = /unsplash\.com|pexels\.com|pixabay\.com/i;
function realImages(c) {
  const list = [c.image_main, ...(Array.isArray(c.gallery_images) ? c.gallery_images : [])]
    .map(x => (typeof x === 'string' ? x : (x && (x.src || x.url)) || ''))
    .filter(u => /^https?:\/\//.test(u) && !STOCK_IMG_RE.test(u));
  return Array.from(new Set(list));
}
/* השם העברי של הדגם, כפי שנכתב ב-meta_title ("טויוטה C-HR 2025 | ..." → "טויוטה C-HR") */
function carHeName(c) {
  const fromMeta = String(c.meta_title || '').split('|')[0].replace(/\b20\d\d\b/g, '').replace(/\s+/g, ' ').trim();
  return fromMeta || `${c.brand} ${c.model}`;
}
/* שמות המותגים בעברית וכתיבים חלופיים ("מזדה", "שקודה") נקראים מ-cars-core.js, המקור היחיד שלהם באתר.
   הקובץ עצמו דורש דפדפן, ולכן רק טבלת BRANDS נשלפת ממנו כטקסט. אם השליפה נכשלת — ממשיכים בלי. */
const BRAND_MAP = (() => {
  const map = new Map();
  try {
    const src = readFileSync(new URL('../cars-core.js', import.meta.url), 'utf-8');
    const re = /^\s*['"]?([a-z0-9_-]+)['"]?\s*:\s*\{\s*name\s*:\s*'([^']+)'\s*,\s*he\s*:\s*'([^']+)'(?:\s*,\s*alt\s*:\s*\[([^\]]*)\])?/gm;
    /* he:"ג'אקו" כתוב במירכאות כפולות — נתפס בביטוי שני (זהה לזיהוי בצד הלקוח, app.js) */
    const re2 = /^\s*['"]?([a-z0-9_-]+)['"]?\s*:\s*\{\s*name\s*:\s*'([^']+)'\s*,\s*he\s*:\s*"([^"]+)"(?:\s*,\s*alt\s*:\s*\[([^\]]*)\])?/gm;
    let m;
    for (const rx of [re, re2]) while ((m = rx.exec(src))) {
      const alt = (m[4] || '').split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      map.set(m[2].toLowerCase(), { key: m[1], name: m[2], he: m[3], alt });
    }
  } catch (e) { console.warn('⚠️ טבלת המותגים לא נקראה מ-cars-core.js:', e.message); }
  return map;
})();
const BRAND_BY_KEY = new Map(Array.from(BRAND_MAP.values()).map(b => [b.key, b]));
/* זהה ל-brandKey ב-cars-core.js וב-car-page.js — המפתח הוא שם התיקייה של עמוד המותג (/cars/{key}/) */
function brandKeyOf(raw) {
  const k = String(raw || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9\u0590-\u05ff]+/g, '');
  if (BRAND_BY_KEY.has(k)) return k;
  return k === 'mercedesbenz' ? 'mercedes' : k;
}
function brandInfo(c) {
  const key = brandKeyOf(c.brand);
  const b = BRAND_BY_KEY.get(key);
  if (b) return { key, name: b.name || String(c.brand || ''), he: b.he, alt: b.alt };
  return { key, name: String(c.brand || '').trim(), he: carHeName(c).split(' ')[0] || String(c.brand || ''), alt: [] };
}
/* גרש/מירכאות עבריים וטיפוגרפיים (׳ ״ ’ ”) נחשבים זהים ל-' ו-" — "ספורטאז׳" = "ספורטאז'" */
const normQ = t => String(t || '').replace(/[\u05F3\u2018\u2019`\u00B4]/g, "'").replace(/[\u05F4\u201C\u201D]/g, '"');
const MODEL_NOISE_RE = /\b(hybrid|phev|plug-?in|electric|ev)\b|היברידי(?:ת)?|חשמלי(?:ת)?|פלאג[- ]?אין|החדש(?:ה)?/gi;
function carMatchKeys(c) {
  const info = brandInfo(c);
  const brandEn = String(c.brand || '').toLowerCase().trim();
  const he = normQ(carHeName(c).toLowerCase());
  /* שם הדגם בעברית = השם המלא פחות המותג (גם כשהמותג הוא שתי מילים, "מרצדס בנץ") */
  const prefixes = [info.he, ...info.alt, brandEn].map(x => normQ(String(x).toLowerCase())).sort((a, b) => b.length - a.length);
  const pre = prefixes.find(x => x && he.startsWith(x + ' '));
  const rest = pre ? he.slice(pre.length + 1) : he.split(' ').slice(1).join(' ');
  const brandHe = pre || he.split(' ')[0] || '';
  const modelEn = normQ(String(c.model || '').toLowerCase()).replace(MODEL_NOISE_RE, ' ').replace(/\s+/g, ' ').trim();
  const modelHe = rest.replace(MODEL_NOISE_RE, ' ').replace(/\s+/g, ' ').trim();
  const brands = Array.from(new Set([brandHe, brandEn, normQ(String(info.he).toLowerCase()), ...info.alt.map(x => normQ(x.toLowerCase()))].filter(b => b && b.length >= 2)));
  return { brandEn, brandHe, modelEn, modelHe, brands };
}
function escRe(x) { return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
/* ביטוי שלם בלבד (לא חלק ממילה). לפני מילה עברית מותרות אותיות שימוש: "בטויוטה", "והקורולה". */
function phraseRe(phrase) {
  const body = escRe(phrase).replace(/\\?[\s-]+/g, '[\\s\\-]?')
    .replace(/([a-z])(\d)/g, '$1[\\s\\-]?$2'); // "RAV4" נתפס גם כ-"RAV 4" ו-"RAV-4"
  return new RegExp('(^|[^a-z0-9א-ת])[והבלמשכ]{0,2}-?' + body + '(?![a-z0-9א-ת])', 'gi');
}
/* כתבה "מזכירה" רכב רק כשהמותג והדגם מופיעים צמודים ("יונדאי קונה", "Toyota C-HR").
   שם דגם לבדו לא מספיק: "קונה" היא גם מילה רגילה בעברית. יוצא דופן יחיד: שם דגם לועזי
   ייחודי עם ספרה או מקף (RAV4, C-HR, CX-5), שמספיק לו שהמותג מופיע במקום כלשהו בכתבה.
   כשדגם נמצא, הוא נמחק מעותק העבודה של הטקסט, כדי ש"קורולה קרוס" לא ייחשב גם כ"קורולה". */
/* כתיב עברי מקובל של שמות דגמים לועזיים, שלא ניתן לגזור מהשם שבמאגר */
const MODEL_HE_SPELLINGS = { 'rav4': ['ראב 4', 'ראב4'] };
function matchCarInText(box, k) {
  const brands = k.brands;
  const models = Array.from(new Set([k.modelHe, k.modelEn, ...(MODEL_HE_SPELLINGS[k.modelEn] || [])].filter(m => m && m.length >= 2)));
  if (!brands.length || !models.length) return false;
  let hit = false;
  for (const b of brands) for (const m of models) {
    const re = phraseRe(b + ' ' + m);
    if (re.test(box.text)) { hit = true; box.text = box.text.replace(phraseRe(b + ' ' + m), ' · '); }
  }
  if (!hit) {
    const brandAnywhere = brands.some(b => phraseRe(b).test(box.full));
    for (const m of models) {
      if (!/^[a-z0-9][a-z0-9 \-]*$/.test(m) || !/[0-9\-]/.test(m) || m.length < 3) continue;
      if (brandAnywhere && phraseRe(m).test(box.text)) { hit = true; box.text = box.text.replace(phraseRe(m), ' · '); }
    }
  }
  return hit;
}
function buildLinkGraph(articles, cars) {
  const carsByArticle = new Map(), articlesByCar = new Map();
  const keyed = cars.map(c => ({ c, k: carMatchKeys(c) }))
    .sort((a, b) => Math.max(b.k.modelEn.length, b.k.modelHe.length) - Math.max(a.k.modelEn.length, a.k.modelHe.length));
  for (const a of articles) {
    if (a.cat === 'quick') continue;
    const full = normQ(`${a.title || ''} \n ${a.sub || ''} \n ${a.body || ''}`.toLowerCase().replace(/<[^>]+>/g, ' '));
    const box = { text: full, full };
    for (const { c, k } of keyed) {
      if (!matchCarInText(box, k)) continue;
      if (!carsByArticle.has(a.id)) carsByArticle.set(a.id, []);
      if (carsByArticle.get(a.id).length < 4) carsByArticle.get(a.id).push(c);
      if (!articlesByCar.has(c.slug)) articlesByCar.set(c.slug, []);
      articlesByCar.get(c.slug).push(a);
    }
  }
  return { carsByArticle, articlesByCar };
}
let LINK_GRAPH = { carsByArticle: new Map(), articlesByCar: new Map() };
let ALL_LIVE_ARTICLES = [];

/* בלוק "המשך קריאה" מתחת לכתבה — אותו עיצוב (sp-readon.css) ואותו מבנה כמו הבלוק החי שב-app.js.
   כאן הוא אפוי ב-HTML כדי שגוגל יקרא את הקישורים מהבייט הראשון; כשהאפליקציה עולה, הבלוק החי מחליף אותו.
   יושב מחוץ ל-#art-body כדי שהאפליקציה לא תדרוס אותו; מוסר את עצמו כשעוברים לכתבה אחרת בלי טעינה מחדש. */
const READON_CSS_HREF = '/sp-readon.css?v=20261122a';
const RO_STOCK_RE = /unsplash\.com|pexels\.com|pixabay\.com/i;
const RO_PT = { ev: 'חשמלי', phev: 'פלאג-אין', hev: 'היברידי', hybrid: 'היברידי', mhev: 'היברידי קל', ice: 'בנזין', petrol: 'בנזין', diesel: 'דיזל' };
function roImg(u, w) {
  if (!u || String(u).length < 6) return '';
  if (/^https?:\/\//.test(u) && u.indexOf('wsrv.nl') === -1 && u.indexOf('images.unsplash.com') === -1)
    return `https://wsrv.nl/?url=${encodeURIComponent(u)}&w=${w}&fit=cover&output=webp&q=72`;
  return u;
}
function roHead(t, n) { return `<div class="sp-ro-head"><h2>${esc(t)}</h2>${n ? `<span class="sp-ro-count">${String(n).padStart(2, '0')}</span>` : ''}</div>`; }
function roCarCard(c) {
  const name = carHeName(c);
  const cut = /^https?:/.test(c.image_cutout || '') ? c.image_cutout : '';
  const photo = !cut && /^https?:/.test(c.image_main || '') && !RO_STOCK_RE.test(c.image_main) ? c.image_main : '';
  const stage = cut ? `<img src="https://wsrv.nl/?url=${encodeURIComponent(cut)}&w=300&output=webp&q=80" alt="${esc(name)}" loading="lazy" decoding="async">`
    : photo ? `<img class="sp-ro-photo" src="${esc(roImg(photo, 300))}" alt="${esc(name)}" loading="lazy" decoding="async">`
    : `<span class="sp-ro-mono">${esc(String(c.model || c.brand || '').replace(MODEL_NOISE_RE, '').trim().slice(0, 8))}</span>`;
  const pt = String(c.powertrain || '').toLowerCase(), chips = [];
  if (RO_PT[pt]) chips.push(RO_PT[pt]);
  if (Number(c.horsepower) > 0) chips.push(`${c.horsepower} כ"ס`);
  if (Number(c.range_ev) > 0 && (pt === 'ev' || pt === 'phev')) chips.push(`טווח ${c.range_ev} ק"מ`);
  const price = Number(c.price) > 0 ? `${Number(c.price).toLocaleString('he-IL')} ₪` : '';
  return `<li><a class="sp-ro-car" href="/car/${esc(c.slug)}/"><div class="sp-ro-stage${photo ? ' has-photo' : ''}">${stage}</div><div class="sp-ro-info">`
    + `<span class="sp-ro-brand">${esc(brandInfo(c).name)}</span><span class="sp-ro-name">${esc(name)}${c.year ? ' ' + esc(c.year) : ''}</span>`
    + (price ? `<span class="sp-ro-price">החל מ-<b>${price}</b></span>` : '')
    + (chips.length ? `<span class="sp-ro-chips">${chips.map(x => `<span>${esc(x)}</span>`).join('')}</span>` : '')
    + `<span class="sp-ro-go">מחיר, מפרט ואבזור <i>←</i></span></div></a></li>`;
}
function roRow(x) {
  const meta = [x.date, x.read_time].filter(Boolean).map(m => `<span>${esc(m)}</span>`).join('');
  return `<li><a class="sp-ro-row" href="/article/${x.id}/" data-ro-id="${x.id}"><div><h3>${esc(x.title)}</h3><div class="sp-ro-meta">${meta}</div></div>`
    + `<div class="sp-ro-thumb"><img src="${esc(roImg(x.img || CAT_IMAGES[x.cat], 260))}" alt="" loading="lazy" decoding="async"></div></a></li>`;
}
function buildRelatedHTML(a) {
  if (a.cat === 'quick') return '';
  const now = new Date();
  const cars = LINK_GRAPH.carsByArticle.get(a.id) || [];
  /* שתי הכתבות שלפניה ושתיים שאחריה באותו מדור (ולא "4 הכי חדשות"): כך כל כתבה באתר,
     גם ישנה, מקבלת קישורים נכנסים קבועים. 36 כתבות ישנות סומנו ב-Search Console
     "נסרק אך לא נכלל באינדקס", ולאף אחת מהן לא היה קישור פנימי קבוע. */
  const sameCat = ALL_LIVE_ARTICLES.filter(x => x.cat === a.cat && (x.id === a.id || !x.scheduled_at || new Date(x.scheduled_at) <= now));
  const at = sameCat.findIndex(x => x.id === a.id);
  /* "הכתבה הבאה" = הבאה ברצף המדור (הישנה יותר), ואם אין — החדשה ביותר */
  const next = (at >= 0 ? sameCat[at + 1] : null) || sameCat.find(x => x.id !== a.id) || null;
  let more = at < 0 ? sameCat.slice(0, 4) : [...sameCat.slice(Math.max(0, at - 2), at), ...sameCat.slice(at + 1, at + 3)];
  more = more.filter(x => x.id !== a.id && (!next || x.id !== next.id));
  if (more.length < 4) more = more.concat(sameCat.filter(x => x.id !== a.id && (!next || x.id !== next.id) && !more.includes(x)).slice(0, 4 - more.length));
  more = more.slice(0, 4);
  if (!cars.length && !next && !more.length) return '';
  const label = CAT_LABELS[a.cat] || 'ספידומטר';
  const carsHTML = cars.length ? `<div class="sp-ro-sec sp-ro-cars">${roHead(cars.length > 1 ? 'רכבים מהמאגר בכתבה' : 'הרכב מהכתבה במאגר', cars.length > 1 ? cars.length : 0)}<ul>${cars.map(roCarCard).join('')}</ul></div>` : '';
  const nextHTML = next ? `<div class="sp-ro-sec"><a class="sp-ro-next" href="/article/${next.id}/" data-ro-id="${next.id}"><img src="${esc(roImg(next.img || CAT_IMAGES[next.cat], 900))}" alt="" loading="lazy" decoding="async">`
    + `<div class="sp-ro-next-in"><div class="sp-ro-kick"><b>הכתבה הבאה</b><span>${esc(CAT_LABELS[next.cat] || '')}</span></div><h3>${esc(next.title)}</h3>${next.sub ? `<p>${esc(next.sub)}</p>` : ''}`
    + `<div class="sp-ro-next-foot"><span>${esc(next.read_time || '')}</span><em>להמשך קריאה <i>←</i></em></div></div></a></div>` : '';
  const moreHTML = more.length ? `<div class="sp-ro-sec">${roHead('עוד ב' + label)}<ol class="sp-ro-list">${more.map(roRow).join('')}</ol><a class="sp-ro-all" href="/${esc(a.cat)}/">לכל הכתבות ב${esc(label)} ←</a></div>` : '';
  const guard = `<script>(function(){var b=document.getElementById('sp-related-static');if(!b)return;var id=b.getAttribute('data-for');function chk(){if(location.pathname.indexOf('/article/'+id+'/')!==0){b.remove();}}window.addEventListener('popstate',chk);var t=document.getElementById('art-title');if(t&&window.MutationObserver)new MutationObserver(chk).observe(t,{childList:true,characterData:true,subtree:true});})();</script>`;
  return `<link rel="stylesheet" id="sp-ro-css" href="${READON_CSS_HREF}"><section id="sp-related-static" class="sp-ro" data-for="${a.id}" aria-label="המשך קריאה">${carsHTML}${nextHTML}${moreHTML}${guard}</section>`;
}

/* ─── עמוד רכב: כל הנתונים ב-HTML הסטטי ───
   העמוד המעוצב מציג מפרט, אבזור וגלריה רק אחרי לחיצה (JavaScript). כאן אותם נתונים נכתבים
   גם כטקסט רגיל בתחתית העמוד, במגירות סגורות, כדי שגוגל יקרא את כולם מהכתובת הראשית. */
const POWERTRAIN_FUEL = { ev: 'Electricity', phev: 'Plug-in hybrid', hev: 'Hybrid', hybrid: 'Hybrid', mhev: 'Mild hybrid', ice: 'Gasoline', petrol: 'Gasoline', diesel: 'Diesel' };
const hasText = v => v != null && !/^(none|null|undefined|-|—)?$/i.test(String(v).trim());
/* שווי שימוש 2026 — אותה נוסחה בדיוק כמו במחשבון (usage-calc.js): 2.48% עד תקרה 596,860, מעוגל ל-10, פחות הפחתה */
const USAGE = { ceiling: 596860, rate: 0.0248, ded: { petrol: 0, diesel: 0, hev: 580, phev: 1150, ev: 1380 } };
const PT_HE = { petrol: 'בנזין', diesel: 'דיזל', hev: 'היברידי', phev: 'היברידי נטען', ev: 'חשמלי', mhev: 'היברידי קל', erev: 'חשמלי עם מאריך טווח' };
function usageValue(price, pt) {
  if (!(Number(price) > 0) || !(pt in USAGE.ded)) return null;
  const gross = Math.round(Math.min(Number(price), USAGE.ceiling) * USAGE.rate / 10) * 10;
  return { gross, ded: USAGE.ded[pt], value: Math.max(0, gross - USAGE.ded[pt]) };
}
function carFaq(c) {
  const name = `${carHeName(c)} ${c.year}`, out = [];
  const num = v => (v == null || v === '' || !isFinite(Number(v)) || Number(v) <= 0) ? null : Number(v);
  const lo = num(c.price), hi = num(c.price_top);
  if (lo) out.push({ q: `כמה עולה ${name} בישראל?`, a: `המחיר של ${name} בישראל מתחיל ב-${formatPriceILS(lo)}` + (hi && hi > lo ? ` ומגיע עד ${formatPriceILS(hi)} בגרסה היקרה ביותר` : '') + '.' });
  if (num(c.range_ev)) out.push({ q: `מה הטווח החשמלי של ${name}?`, a: `הטווח החשמלי המוצהר של ${name} הוא ${num(c.range_ev)} ק"מ` + (num(c.battery_capacity_kwh) ? `, עם סוללה בקיבולת ${num(c.battery_capacity_kwh)} קוט"ש` : '') + '.' });
  if (num(c.horsepower)) out.push({ q: `כמה כוחות סוס יש ל${name}?`, a: `ההספק של ${name} הוא ${num(c.horsepower)} כ"ס` + (num(c.acceleration_0_100) ? `, והתאוצה מ-0 ל-100 קמ"ש נמשכת ${num(c.acceleration_0_100)} שניות` : '') + '.' });
  if (num(c.fuel_consumption) && c.powertrain !== 'ev') out.push({ q: `מה צריכת הדלק של ${name}?`, a: `צריכת הדלק הממוצעת המוצהרת של ${name} היא ${num(c.fuel_consumption)} ליטר ל-100 ק"מ.` });
  if (num(c.trunk_volume)) out.push({ q: `מה נפח תא המטען של ${name}?`, a: `נפח תא המטען של ${name} הוא ${num(c.trunk_volume)} ליטר.` });
  if (hasText(c.safety_rating)) out.push({ q: `מה רמת הבטיחות של ${name}?`, a: `${name}: ${String(c.safety_rating)}.` });
  { const u = usageValue(num(c.price), String(c.powertrain || '').toLowerCase());
    if (u) out.push({ q: `מה שווי השימוש של ${name} ב-2026?`, a: `לפי מחיר המחירון ההתחלתי (${formatPriceILS(num(c.price))}), שווי השימוש החודשי של ${name} הוא ${formatPriceILS(u.value)}: 2.48% מהמחיר, מעוגל ל-10 ₪` + (u.ded ? `, פחות הפחתה של ${formatPriceILS(u.ded)} לרכב ${PT_HE[String(c.powertrain).toLowerCase()]}` : '') + '.' }); }
  if (hasText(c.importer)) out.push({ q: `מי היבואן של ${name} בישראל?`, a: `היבואן הרשמי של ${name} בישראל הוא ${String(c.importer)}.` });
  return out;
}
function carSchemas(c, canonicalUrl) {
  const num = v => (v == null || v === '' || !isFinite(Number(v)) || Number(v) <= 0) ? null : Number(v);
  const qv = (v, unitCode) => num(v) ? { '@type': 'QuantitativeValue', value: num(v), unitCode } : undefined;
  const imgs = realImages(c).slice(0, 8);
  const ld = {
    '@context': 'https://schema.org', '@type': 'Car',
    name: `${c.brand} ${c.model} ${c.year}`,
    alternateName: `${carHeName(c)} ${c.year}`,
    brand: { '@type': 'Brand', name: c.brand },
    manufacturer: { '@type': 'Organization', name: c.brand },
    model: c.model,
    modelDate: String(c.year),
    vehicleModelDate: String(c.year),
    description: c.description || undefined,
    image: imgs.length ? imgs : undefined,
    url: canonicalUrl,
    bodyType: c.category || undefined,
    fuelType: POWERTRAIN_FUEL[String(c.powertrain || '').toLowerCase()] || undefined,
    vehicleTransmission: c.transmission || undefined,
    driveWheelConfiguration: c.drive_type || undefined,
    seatingCapacity: num(c.seats) || undefined,
    vehicleEngine: (c.engine || num(c.horsepower)) ? { '@type': 'EngineSpecification', name: c.engine || undefined, enginePower: qv(c.horsepower, 'BHP') } : undefined,
    accelerationTime: qv(c.acceleration_0_100, 'SEC'),
    speed: qv(c.top_speed, 'KMH'),
    cargoVolume: qv(c.trunk_volume, 'LTR'),
    weightTotal: qv(c.weight, 'KGM'),
    wheelbase: qv(c.wheelbase, 'MMT'),
    color: Array.isArray(c.colors) && c.colors.length ? c.colors.slice(0, 12).map(String) : undefined,
  };
  const pLow = num(c.price), pHigh = num(c.price_top);
  if (pLow && pHigh && pHigh > pLow) ld.offers = { '@type': 'AggregateOffer', lowPrice: pLow, highPrice: pHigh, priceCurrency: 'ILS', availability: 'https://schema.org/InStock' };
  else if (pLow) ld.offers = { '@type': 'Offer', price: pLow, priceCurrency: 'ILS', availability: 'https://schema.org/InStock', url: canonicalUrl };
  /* ציון: רק ציון מערכת אמיתי שהוזן במאגר */
  if (num(c.score)) ld.review = { '@type': 'Review', author: { '@type': 'Organization', name: 'ספידומטר' }, reviewRating: { '@type': 'Rating', ratingValue: num(c.score), bestRating: 10, worstRating: 1 } };
  const crumbs = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ספידומטר', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'מאגר רכבים', item: `${SITE}/cars-list.html` },
      { '@type': 'ListItem', position: 3, name: `${carHeName(c)} ${c.year}` },
    ],
  };
  const faq = carFaq(c);
  const faqLd = faq.length ? { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) } : null;
  const tag = o => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
  return [tag(ld), tag(crumbs), faqLd ? tag(faqLd) : ''].filter(Boolean).join('\n');
}
const CARSEO_CSS = '<style id="sp-carseo-css">.sp-carseo{max-width:1180px;margin:48px auto 32px;padding:0 20px;color:inherit}.sp-carseo>h2{font-size:1.35rem;font-weight:800;margin:0 0 8px}.sp-carseo-lead{margin:0 0 16px;line-height:1.7;opacity:.85}.sp-carseo details{border:1px solid rgba(127,127,127,.28);border-radius:14px;margin:0 0 8px;overflow:hidden}.sp-carseo summary{cursor:pointer;list-style:none;padding:14px 16px;font-weight:700;display:flex;justify-content:space-between;align-items:center;gap:12px}.sp-carseo summary::-webkit-details-marker{display:none}.sp-carseo summary::after{content:"";width:9px;height:9px;border:solid currentColor;border-width:0 0 2px 2px;transform:rotate(-45deg);flex:none;transition:transform .2s}.sp-carseo details[open] summary::after{transform:rotate(135deg)}.sp-carseo summary h3{font-size:1rem;font-weight:700;margin:0}.sp-carseo .sp-cs-in{padding:0 16px 16px;line-height:1.65}.sp-carseo table{width:100%;border-collapse:collapse;margin:0 0 12px;font-size:.94rem}.sp-carseo td,.sp-carseo th{padding:8px 4px;border-bottom:1px solid rgba(127,127,127,.2);text-align:start;vertical-align:top}.sp-carseo td:first-child{opacity:.72;width:42%}.sp-carseo h4{font-size:.95rem;margin:12px 0 6px}.sp-carseo ul{margin:0;padding-inline-start:18px}.sp-carseo li{margin:3px 0}.sp-carseo dt{font-weight:700;margin-top:12px}.sp-carseo dd{margin:4px 0 0}.sp-cs-imgs{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.sp-cs-imgs img{width:100%;height:auto;aspect-ratio:4/3;object-fit:cover;border-radius:10px;display:block}.sp-cs-links{display:grid;gap:6px;list-style:none;padding:0}.sp-cs-links a{color:inherit;font-weight:600}.sp-cs-sim{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 0;padding:0;list-style:none}.sp-cs-sim a{display:inline-block;padding:8px 14px;border-radius:99px;border:1px solid rgba(127,127,127,.35);color:inherit;text-decoration:none;font-size:.9rem;font-weight:600}@media (max-width:600px){.sp-carseo{margin-top:32px;padding:0 14px}.sp-carseo td:first-child{width:46%}}</style>';
function buildCarSeoBlock(c, allCars) {
  const name = `${carHeName(c)} ${c.year}`;
  const num = v => (v == null || v === '' || !isFinite(Number(v)) || Number(v) <= 0) ? null : Number(v);
  const sec = (title, inner) => inner ? `<details><summary><h3>${esc(title)}</h3></summary><div class="sp-cs-in">${inner}</div></details>` : '';
  const list = arr => (Array.isArray(arr) && arr.length) ? `<ul>${arr.map(x => `<li>${esc(String(x))}</li>`).join('')}</ul>` : '';

  const facts = [];
  if (hasText(c.category)) facts.push(esc(String(c.category)));
  if (num(c.price)) facts.push('מחיר בישראל: החל מ-' + formatPriceILS(num(c.price)) + (num(c.price_top) > num(c.price) ? ' ועד ' + formatPriceILS(num(c.price_top)) : ''));
  if (num(c.horsepower)) facts.push('הספק ' + num(c.horsepower) + ' כ"ס');
  if (num(c.range_ev)) facts.push('טווח חשמלי ' + num(c.range_ev) + ' ק"מ');
  if (num(c.trunk_volume)) facts.push('תא מטען ' + num(c.trunk_volume) + ' ליטר');
  if (hasText(c.importer)) facts.push('יבואן: ' + esc(String(c.importer)));
  const lead = facts.length ? `<p class="sp-carseo-lead">${esc(name)}: ${facts.join(' · ')}.</p>` : '';

  /* מפרט: אותה טבלה שהמחולל כבר יודע לבנות, בלי האימוג'ים בכותרות */
  const specs = buildSpecsGroupsHtml(c)
    .replace(/<div class="specs-group-title">[^<\u05d0-\u05eaA-Za-z]*/g, '<h4>').replace(/<\/div><table class="specs-table">/g, '</h4><table>')
    .replace(/<div class="specs-group">/g, '').replace(/<\/table><\/div>/g, '</table>');

  const trims = Array.isArray(c.trims) ? c.trims.filter(t => t && t.name) : [];
  const trimsHTML = trims.length ? `<table><tr><th>גרסה</th><th>מחיר</th><th>הספק</th>${trims.some(t => num(t.range_ev)) ? '<th>טווח חשמלי</th>' : ''}</tr>${trims.map(t =>
    `<tr><td>${esc(String(t.name))}</td><td>${num(t.price) ? formatPriceILS(num(t.price)) : '—'}</td><td>${num(t.horsepower) ? num(t.horsepower) + ' כ"ס' : '—'}</td>${trims.some(x => num(x.range_ev)) ? `<td>${num(t.range_ev) ? num(t.range_ev) + ' ק"מ' : '—'}</td>` : ''}</tr>`).join('')}</table>` : '';

  const eqGroups = (c.equipment && Array.isArray(c.equipment.groups)) ? c.equipment.groups.filter(g => g && Array.isArray(g.items) && g.items.length) : [];
  const equipHTML = eqGroups.length
    ? eqGroups.map(g => (g.title || g.name ? `<h4>${esc(String(g.title || g.name))}</h4>` : '') + list(g.items)).join('')
    : ((list(c.features) ? '<h4>אבזור</h4>' + list(c.features) : '') + (list(c.safety_features) ? '<h4>בטיחות</h4>' + list(c.safety_features) : ''));

  const prosCons = (list(c.pros) ? '<h4>יתרונות</h4>' + list(c.pros) : '') + (list(c.cons) ? '<h4>חסרונות</h4>' + list(c.cons) : '');
  const colors = list(c.colors);

  const faq = carFaq(c);
  const faqHTML = faq.length ? `<dl>${faq.map(f => `<dt>${esc(f.q)}</dt><dd>${esc(f.a)}</dd>`).join('')}</dl>` : '';

  const imgs = realImages(c).slice(0, 8);
  const imgsHTML = imgs.length ? `<div class="sp-cs-imgs">${imgs.map((u, i) =>
    `<img src="${esc(wsrvW(u, 480))}" alt="${esc(name)} — תמונה ${i + 1}" loading="lazy" decoding="async" width="480" height="360">`).join('')}</div>` : '';

  const arts = (LINK_GRAPH.articlesByCar.get(c.slug) || []).slice(0, 8);
  const artsHTML = arts.length ? `<ul class="sp-cs-links">${arts.map(a => `<li><a href="/article/${a.id}/">${esc(a.title)}</a></li>`).join('')}</ul>` : '';

  const similar = (allCars || []).filter(x => x.slug !== c.slug && x.category && x.category === c.category).slice(0, 8);
  const brandMates = (allCars || []).filter(x => x.slug !== c.slug && x.brand === c.brand && !similar.includes(x)).slice(0, 6);
  const pill = x => `<li><a href="/car/${esc(x.slug)}/">${esc(carHeName(x))} ${esc(x.year)}</a></li>`;
  const simHTML = (similar.length ? `<h4>דגמים דומים</h4><ul class="sp-cs-sim">${similar.map(pill).join('')}</ul>` : '') +
    (brandMates.length ? `<h4>עוד דגמים של ${esc(brandInfo(c).he)}</h4><ul class="sp-cs-sim">${brandMates.map(pill).join('')}</ul>` : '') +
    `<ul class="sp-cs-sim"><li><a href="/cars/${encodeURIComponent(brandInfo(c).key)}/">כל הדגמים של ${esc(brandInfo(c).he)}</a></li></ul>`;
  const cmps = (PAIRS_BY_CAR.get(c.slug) || []).slice(0, 4);
  const cmpHTML = cmps.length ? `<ul class="sp-cs-links">${cmps.map(p => { const o = p.a === c ? p.b : p.a; return `<li><a href="/compare/${esc(p.key)}/">${esc(carHeName(c))} מול ${esc(carHeName(o))}</a></li>`; }).join('')}</ul>` : '';

  const uv = usageValue(num(c.price), String(c.powertrain || '').toLowerCase());
  const usageHTML = uv ? `<p>שווי שימוש חודשי לפי המחיר ההתחלתי: <b>${formatPriceILS(uv.value)}</b>${uv.ded ? ` (אחרי הפחתה של ${formatPriceILS(uv.ded)})` : ''}. <a href="/usage-value-calculator.html#car=${encodeURIComponent(c.slug)}">כמה זה עולה לכם נטו מהמשכורת ›</a></p>` : '';
  const inner = sec('מפרט טכני מלא', specs) + sec('גרסאות ומחירים', trimsHTML) + sec('אבזור ובטיחות', equipHTML) +
    sec('יתרונות וחסרונות', prosCons) + sec('צבעים', colors) + sec('שאלות נפוצות', faqHTML) + sec('תמונות', imgsHTML) + sec('השוואות מול מתחרים', cmpHTML) + sec('שווי שימוש (רכב צמוד)', usageHTML) + sec(`כתבות על ${carHeName(c)}`, artsHTML);
  if (!inner && !simHTML) return '';
  return `${CARSEO_CSS}<section class="sp-carseo" aria-label="כל המידע על ${esc(name)}"><h2>כל המידע על ${esc(name)}</h2>${lead}${inner}${simHTML}</section>`;
}

/* ─── עמודי מדור (/review/, /local/ ...) ───
   עד 16.11.2026 קישור למדור הוביל ל-/?cat=X: אותו HTML של דף הבית, אותה כותרת, canonical לדף הבית.
   גוגל לא יכול היה לאנדקס מדור, והגולש ראה "דף הבית". עכשיו לכל מדור עמוד סטטי משלו. */
/* שמות המדורים כפי שהם מופיעים בתפריט האתר (זהה ל-SP_CATS ב-app.js) */
const CAT_PAGE_LABELS = { local: 'חדשות מקומיות', world: 'חדשות עולמיות', review: 'מבחני רכב', electric: 'רכב חשמלי', tech: 'טכנולוגיה', buying: 'קניית רכב', sport: 'ספורט', luxury: 'רכב יוקרה', quick: 'חדשות בקליק' };
const CAT_PAGES = ['local', 'world', 'review', 'electric', 'tech', 'buying', 'sport', 'luxury', 'quick'];
function hydrateTemplateForCategory(rootHtml, cat, catRows) {
  const label = CAT_PAGE_LABELS[cat] || CAT_LABELS[cat], url = `${SITE}/${cat}/`, title = `${label} | ספידומטר`;
  const desc = `${label} בספידומטר: ${catRows.length} כתבות, מהחדשה לישנה.`;
  let html = rootHtml
    .replace(/<title>[^<]*<\/title>/, () => `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${esc(desc)}">`)
    .replace(/<link rel="canonical" href="[^"]*">/, () => `<link rel="canonical" href="${url}">`)
    .replace(/<meta property="og:title" content="[^"]*">/, () => `<meta property="og:title" content="${esc(title)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, () => `<meta property="og:description" content="${esc(desc)}">`)
    .replace(/<meta property="og:url" content="[^"]*">/, () => `<meta property="og:url" content="${url}">`)
    .replace(/<meta name="twitter:title" content="[^"]*">/, () => `<meta name="twitter:title" content="${esc(title)}">`)
    .replace(/<meta name="twitter:description" content="[^"]*">/, () => `<meta name="twitter:description" content="${esc(desc)}">`);
  /* הנתונים המוטמעים והשקופית הראשונה — של המדור עצמו, כדי שהעמוד ייפתח נכון עוד לפני שה-JS מסנן */
  html = injectBetween(html, 'DATA_SNAPSHOT', buildSnapshotTag(catRows));
  html = injectBetween(html, 'HERO_PRELOAD', buildHeroPreloadTag(catRows) || '');
  html = injectBetween(html, 'HERO_SLIDE', buildStaticHeroSlide(catRows) || '');
  /* חדשות בקליק: העמוד קיים לגולשים ולתפריט, אבל לא לאינדקס (תקצירים של כתבות שכבר קיימות) */
  if (cat === 'quick') html = html.replace(/<meta name="robots" content="[^"]*">/, '<meta name="robots" content="noindex, follow">');
  /* רשימת כל כתבות המדור כקישורים רגילים. האפליקציה מסירה אותה כשהיא בונה את הרשת המעוצבת. */
  const list = catRows.map(r => `<li><a href="/article/${r.id}/">${esc(r.title)}<small>${esc(r.date || '')}</small></a></li>`).join('');
  html = injectBetween(html, 'HOME_H1', `<h1 id="sp-home-h1" class="sp-h1">${esc(label)}</h1><ul id="sp-cat-static" class="sp-catlist">${list}</ul>`);
  const ld = [
    { '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, url, description: desc, inLanguage: 'he',
      mainEntity: { '@type': 'ItemList', numberOfItems: catRows.length, itemListElement: catRows.slice(0, 50).map((r, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/article/${r.id}/`, name: r.title })) } },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ספידומטר', item: `${SITE}/` }, { '@type': 'ListItem', position: 2, name: label } ] },
  ].map(o => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`).join('\n');
  return html.replace('</head>', () => `${ld}\n</head>`);
}
async function writeCategoryPages(rootHtml, lightRows) {
  let n = 0;
  for (const cat of CAT_PAGES) {
    const rows = lightRows.filter(r => r.cat === cat);
    const dir = path.join(SITE_DIR, cat);
    if (!rows.length) { await rm(dir, { recursive: true, force: true }); continue; }
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), hydrateTemplateForCategory(rootHtml, cat, rows), 'utf-8');
    n++;
  }
  console.log(`🗂️  נכתבו ${n} עמודי מדור (${CAT_PAGES.filter(c => lightRows.some(r => r.cat === c)).map(c => '/' + c + '/').join(' ')}).`);
}

/* ─── כתובת רכב בלי שנה: הפניה מהכתובת הישנה ───
   GitHub Pages לא תומך בהפניית 301, ולכן בכתובת הישנה נכתב עמוד זעיר שמפנה מיד לחדשה
   (meta refresh 0 + canonical — גוגל מתייחס לצירוף הזה כהפניה קבועה) ושומר על ?view= וכו'. */
function carRedirectStub(c, oldSlug) {
  const to = `/car/${c.slug}/`, name = `${carHeName(c)} ${c.year}`;
  return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc(name)} | ספידומטר</title>` +
    `<link rel="canonical" href="${SITE}${to}"><meta http-equiv="refresh" content="0; url=${to}">` +
    `<script>location.replace(${JSON.stringify(to)}+location.search+location.hash)</script></head>` +
    `<body><p>העמוד עבר לכתובת חדשה: <a href="${to}">${esc(name)}</a></p></body></html>`;
}
async function writeCarRedirects(cars) {
  const live = new Set(cars.map(c => c.slug));
  let n = 0;
  for (const c of cars) {
    for (const old of (Array.isArray(c.old_slugs) ? c.old_slugs : [])) {
      if (!old || live.has(old) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(old))) continue;
      const dir = path.join(CAR_OUT_DIR, String(old));
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'index.html'), carRedirectStub(c, old), 'utf-8');
      n++;
    }
  }
  if (n) console.log(`↪️  נכתבו ${n} הפניות מכתובות רכב ישנות.`);
}

/* ═══════════════════ עמודי מותג: /cars/{key}/ ═══════════════════
   עד 16.11.2026 "עמוד מותג" היה ?brand=X על עמוד המאגר — אותו HTML, canonical למאגר, לא ניתן לאינדוקס.
   עכשיו לכל מותג שיש לו דגמים נבנה עמוד סטטי מאותה תבנית, עם כותרת, רשימת דגמים ומחירים משלו. */
const BRANDS_OUT_DIR = path.join(SITE_DIR, 'cars');
const COMPARE_OUT_DIR = path.join(SITE_DIR, 'compare');
const numOf = v => (v == null || v === '' || !isFinite(Number(v)) || Number(v) <= 0) ? null : Number(v);
function groupByBrand(cars) {
  const groups = new Map();
  for (const c of cars) { const info = brandInfo(c); if (!info.key) continue; if (!groups.has(info.key)) groups.set(info.key, { info, cars: [] }); groups.get(info.key).cars.push(c); }
  return Array.from(groups.values());
}
const BRAND_STATIC_CSS = '<style id="sp-bstat-css">.sp-bstat{list-style:none;margin:18px 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}.sp-bstat a{display:block;padding:16px;border:1px solid rgba(16,38,61,.14);border-radius:16px;background:#fff;color:#10263D;text-decoration:none}.sp-bstat b{display:block;font-size:1.05rem}.sp-bstat span{display:block;opacity:.7;font-size:.88rem;margin-top:4px}</style>';
function hydrateBrandPage(hubHtml, g) {
  const { info, cars } = g, url = `${SITE}/cars/${encodeURIComponent(info.key)}/`;
  const heDiff = info.he && info.he !== info.name;
  const title = `${heDiff ? `${info.he} (${info.name})` : info.name} — כל הדגמים בישראל, מחירים ומפרטים | ספידומטר`;
  const prices = cars.map(c => numOf(c.price)).filter(Boolean);
  const desc = `כל דגמי ${info.he || info.name} במאגר הרכבים של ספידומטר: ${cars.length === 1 ? 'דגם אחד' : cars.length + ' דגמים'}` +
    (prices.length ? `, מחיר החל מ-${formatPriceILS(Math.min(...prices))}` : '') + ', מפרט טכני ואבזור.';
  /* הנתונים המובנים של עמוד המאגר עצמו לא שייכים לעמוד המותג */
  let html = hubHtml.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/g, '')
    .replace(/<title>[^<]*<\/title>/, () => `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${esc(desc)}">`)
    .replace(/<link rel="canonical" href="[^"]*">/, () => `<link rel="canonical" href="${url}">`)
    .replace(/<meta property="og:title" content="[^"]*">/, () => `<meta property="og:title" content="${esc(title)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, () => `<meta property="og:description" content="${esc(desc)}">`)
    .replace(/<meta property="og:url" content="[^"]*">/, () => `<meta property="og:url" content="${url}">`)
    .replace('<body class="cx">', '<body class="cx is-results">')
    .replace('<h1 id="r-title"></h1>', () => `<h1 id="r-title"><bdi>${esc(info.name)}</bdi>${heDiff ? ' · ' + esc(info.he) : ''}</h1>`)
    .replace('<span id="r-crumb"></span>', () => `<span id="r-crumb"><a href="/cars-list.html" data-route="view=brands">מותגים</a> › ${esc(info.name)}</span>`)
    .replace('<p id="r-sub"></p>', () => `<p id="r-sub">${cars.length === 1 ? 'דגם אחד' : cars.length + ' דגמים'} במאגר, עם מחיר, מפרט טכני ואבזור</p>`);
  const list = cars.map(c => `<li><a href="/car/${esc(c.slug)}/"><b>${esc(carHeName(c))} ${esc(c.year)}</b>` +
    `<span>${[hasText(c.category) ? esc(String(c.category)) : '', numOf(c.price) ? 'החל מ-' + formatPriceILS(numOf(c.price)) : ''].filter(Boolean).join(' · ')}</span></a></li>`).join('');
  html = injectBetween(html, 'BRAND_STATIC', `${BRAND_STATIC_CSS}<ul id="sp-brand-static" class="sp-bstat">${list}</ul>`);
  html = injectBetween(html, 'CARS_INDEX', '');
  const ld = [
    { '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, url, description: desc, inLanguage: 'he',
      mainEntity: { '@type': 'ItemList', numberOfItems: cars.length, itemListElement: cars.map((c, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/car/${c.slug}/`, name: `${carHeName(c)} ${c.year}` })) } },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ספידומטר', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'מאגר רכבים', item: `${SITE}/cars-list.html` },
      { '@type': 'ListItem', position: 3, name: info.he || info.name } ] },
  ].map(o => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`).join('\n');
  return injectBetween(html, 'CARS_ITEMLIST', ld);
}
function demoteHubHero(html) {
  return html.replace(/<h1 id="hero-title">([\s\S]*?)<\/h1>/, '<p id="hero-title" class="cx-hero-h">$1</p>');
}
async function writeBrandPages(cars) {
  const hub = await readFile(path.join(SITE_DIR, 'cars-list.html'), 'utf-8');
  await rm(BRANDS_OUT_DIR, { recursive: true, force: true });
  if (!hub.includes('<!-- BUILD:BRAND_STATIC:START -->')) { console.warn('⚠️ cars-list.html בלי סמן BRAND_STATIC — מדלגים על עמודי המותג.'); return []; }
  const groups = groupByBrand(cars).filter(g => /^[a-z0-9\u0590-\u05ff]+$/.test(g.info.key));
  for (const g of groups) {
    const dir = path.join(BRANDS_OUT_DIR, g.info.key);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), demoteHubHero(hydrateBrandPage(hub, g)), 'utf-8');
  }
  console.log(`🏷️  נכתבו ${groups.length} עמודי מותג תחת /cars/{brand}/.`);
  return groups;
}

/* ═══════════════════ עמודי השוואה: /compare/{a}-vs-{b}/ ═══════════════════
   להשוואה לא הייתה כתובת (חלון שנפתח מעל העמוד), ולכן אי אפשר היה לשתף או לאנדקס "X מול Y".
   לכל דגם נבנים עמודי השוואה מול עד 3 המתחרים הקרובים אליו (אותו סוג מרכב, המחיר הקרוב ביותר).
   כל שורה ומשפט בעמוד מחושבים מהנתונים שבמאגר בלבד; שדה שחסר בשני הרכבים לא מוצג. */
const BODY_GROUPS = [['קרוסאובר', 'suv', 'פנאי', "ג'יפ"], ['סדאן', 'ליפטבק', 'סטיישן'], ["הטצ'בק", 'האצ', 'מיני', 'עירוני', 'סופרמיני'], ['מיניוואן', 'ואן'], ['טנדר']];
function bodyGroup(c) { const t = String(c.category || '').toLowerCase(); return BODY_GROUPS.findIndex(g => g.some(k => t.includes(k))); }
function comparePairs(cars) {
  const seen = new Set(), pairs = [];
  for (const a of cars) {
    const pa = numOf(a.price), ga = bodyGroup(a); if (!pa || ga < 0) continue;
    cars.filter(b => b !== a && numOf(b.price) && bodyGroup(b) === ga && Math.abs(numOf(b.price) - pa) / pa <= 0.3)
      .sort((x, y) => Math.abs(numOf(x.price) - pa) - Math.abs(numOf(y.price) - pa)).slice(0, 3)
      .forEach(b => { const [x, y] = [a, b].sort((m, n) => String(m.slug).localeCompare(String(n.slug))); const k = `${x.slug}-vs-${y.slug}`; if (!seen.has(k)) { seen.add(k); pairs.push({ key: k, a: x, b: y }); } });
  }
  return pairs;
}
const CMP_ROWS = [
  ['מחיר התחלתי', c => numOf(c.price), v => formatPriceILS(v), 'low'],
  ['הספק', c => numOf(c.horsepower), v => v + ' כ"ס', 'high'],
  ['תאוצה 0-100 קמ"ש', c => numOf(c.acceleration_0_100), v => v + ' שניות', 'low'],
  ['מהירות מרבית', c => numOf(c.top_speed), v => v + ' קמ"ש', 'high'],
  ['טווח חשמלי', c => numOf(c.range_ev), v => v + ' ק"מ', 'high'],
  ['קיבולת סוללה', c => numOf(c.battery_capacity_kwh), v => v + ' קוט"ש', 'high'],
  ['צריכת דלק', c => numOf(c.fuel_consumption), v => v + ' ל\'/100 ק"מ', 'low'],
  ['נפח תא מטען', c => numOf(c.trunk_volume), v => v + ' ליטר', 'high'],
  ['אורך', c => numOf(c.length), v => v + ' מ"מ', null],
  ['רוחב', c => numOf(c.width), v => v + ' מ"מ', null],
  ['גובה', c => numOf(c.height), v => v + ' מ"מ', null],
  ['בסיס גלגלים', c => numOf(c.wheelbase), v => v + ' מ"מ', 'high'],
  ['משקל עצמי', c => numOf(c.weight), v => v + ' ק"ג', null],
  ['מושבים', c => numOf(c.seats), v => String(v), null],
  ['מנוע', c => hasText(c.engine) ? String(c.engine) : null, v => v, null],
  ['תיבת הילוכים', c => hasText(c.transmission) ? String(c.transmission) : null, v => v, null],
  ['הנעה', c => hasText(c.drive_type) ? String(c.drive_type) : null, v => v, null],
  ['בטיחות', c => hasText(c.safety_rating) ? String(c.safety_rating) : null, v => v, null],
  ['אחריות', c => hasText(c.warranty) ? String(c.warranty) : null, v => v, null],
  ['יבואן', c => hasText(c.importer) ? String(c.importer) : null, v => v, null],
];
const CMP_CSS = '<style id="sp-cmp-css">.sp-cmp{max-width:980px;margin:0 auto;padding:22px 18px 10px;color:var(--ink,#10263D)}.sp-cmp .cx-crumbs{font-size:.85rem;opacity:.75;margin-bottom:10px}.sp-cmp .cx-crumbs a{color:inherit}.sp-cmp h1{font-size:clamp(1.5rem,4vw,2.3rem);font-weight:900;letter-spacing:-.02em;line-height:1.15;margin:0 0 10px}.sp-cmp-lead{line-height:1.75;margin:0 0 20px;max-width:70ch}.sp-cmp-heads{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0 0 18px}.sp-cmp-head{border:1px solid rgba(16,38,61,.14);border-radius:18px;padding:14px;background:#fff;text-decoration:none;color:inherit;display:block}.sp-cmp-head img{width:100%;height:auto;aspect-ratio:16/10;object-fit:cover;border-radius:12px;display:block;margin-bottom:10px}.sp-cmp-head b{display:block;font-size:1.05rem;line-height:1.3}.sp-cmp-head span{display:block;opacity:.7;font-size:.88rem;margin-top:3px}.sp-cmp table{width:100%;border-collapse:collapse;background:#fff;border:1px solid rgba(16,38,61,.14);border-radius:18px;overflow:hidden;border-spacing:0}.sp-cmp th,.sp-cmp td{padding:11px 12px;border-bottom:1px solid rgba(16,38,61,.09);text-align:start;vertical-align:top;font-size:.94rem}.sp-cmp thead th{background:#10263D;color:#fff;font-weight:700}.sp-cmp tbody th{font-weight:500;opacity:.75;width:30%}.sp-cmp tr:last-child td,.sp-cmp tr:last-child th{border-bottom:0}.sp-cmp td.win{font-weight:800;color:#0a7d4d}.sp-cmp-cta{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0 6px}.sp-cmp-cta a{display:inline-block;padding:12px 18px;border-radius:99px;font-weight:700;text-decoration:none;border:1px solid rgba(16,38,61,.25);color:inherit}.sp-cmp-cta a.pri{background:#e8001d;border-color:#e8001d;color:#fff}.sp-cmp h2{font-size:1.1rem;font-weight:800;margin:26px 0 10px}.sp-cmp-more{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:8px}.sp-cmp-more a{display:inline-block;padding:8px 14px;border-radius:99px;border:1px solid rgba(16,38,61,.25);color:inherit;text-decoration:none;font-size:.9rem;font-weight:600}.sp-cmp small{display:block;opacity:.65;margin-top:14px;line-height:1.6}@media(max-width:560px){.sp-cmp{padding:16px 12px 6px}.sp-cmp th,.sp-cmp td{padding:9px 8px;font-size:.86rem}.sp-cmp tbody th{width:28%}.sp-cmp-head{padding:10px}}</style>';
function cmpFacts(a, b) {
  const A = carHeName(a), B = carHeName(b), out = [];
  const diff = (get, unit, wordHigh, min) => { const x = get(a), y = get(b); if (!x || !y || x === y) return; const hi = x > y ? A : B, d = Math.round(Math.abs(x - y) * 10) / 10; if (d >= (min || 0)) out.push(`${wordHigh.replace('%s', hi).replace('%d', unit === '₪' ? formatPriceILS(d) : d + ' ' + unit)}`); };
  const pa = numOf(a.price), pb = numOf(b.price);
  if (pa && pb && pa !== pb) out.push(`${pa < pb ? A : B} זולה ב-${formatPriceILS(Math.abs(pa - pb))} במחיר ההתחלתי`);
  diff(c => numOf(c.horsepower), 'כ"ס', 'ל-%s הספק גבוה ב-%d', 1);
  diff(c => numOf(c.trunk_volume), 'ליטר', 'ל-%s תא מטען גדול ב-%d', 1);
  diff(c => numOf(c.range_ev), 'ק"מ', 'ל-%s טווח חשמלי ארוך ב-%d', 1);
  return out;
}
function buildComparePage(carTemplate, pair, pairsByCar) {
  const { a, b, key } = pair, A = `${carHeName(a)} ${a.year}`, B = `${carHeName(b)} ${b.year}`;
  const url = `${SITE}/compare/${key}/`, title = `${carHeName(a)} מול ${carHeName(b)} — השוואת מחיר ומפרט | ספידומטר`;
  const facts = cmpFacts(a, b);
  const desc = `השוואה בין ${A} ל-${B}: מחיר, הספק, מידות, תא מטען ואבזור, זה לצד זה.`.slice(0, 158);
  const rows = CMP_ROWS.map(([label, get, fmt, better]) => {
    const x = get(a), y = get(b); if (x == null && y == null) return '';
    let wa = '', wb = '';
    if (better && typeof x === 'number' && typeof y === 'number' && x !== y) { const aWins = better === 'high' ? x > y : x < y; wa = aWins ? ' class="win"' : ''; wb = aWins ? '' : ' class="win"'; }
    return `<tr><th scope="row">${esc(label)}</th><td${wa}>${x == null ? '—' : esc(fmt(x))}</td><td${wb}>${y == null ? '—' : esc(fmt(y))}</td></tr>`;
  }).join('');
  const head = c => { const im = realImages(c)[0]; return `<a class="sp-cmp-head" href="/car/${esc(c.slug)}/">${im ? `<img src="${esc(wsrvW(im, 640))}" alt="${esc(carHeName(c))} ${esc(c.year)}" width="640" height="400" loading="lazy" decoding="async">` : ''}<b>${esc(carHeName(c))} ${esc(c.year)}</b><span>${numOf(c.price) ? 'החל מ-' + formatPriceILS(numOf(c.price)) : ''}</span></a>`; };
  const more = c => (pairsByCar.get(c.slug) || []).filter(p => p.key !== key).slice(0, 4).map(p => { const o = p.a === c ? p.b : p.a; return `<li><a href="/compare/${esc(p.key)}/">${esc(carHeName(c))} מול ${esc(carHeName(o))}</a></li>`; }).join('');
  const moreHTML = more(a) + more(b);
  const body = `${CMP_CSS}<article class="sp-cmp"><nav class="cx-crumbs" aria-label="מיקום"><a href="/cars-list.html">מאגר הרכבים</a> › השוואות</nav>` +
    `<h1>${esc(carHeName(a))} מול ${esc(carHeName(b))}</h1>` +
    (facts.length ? `<p class="sp-cmp-lead">${esc(facts.join('. '))}.</p>` : '') +
    `<div class="sp-cmp-heads">${head(a)}${head(b)}</div>` +
    `<table><thead><tr><th scope="col">נתון</th><th scope="col">${esc(carHeName(a))}</th><th scope="col">${esc(carHeName(b))}</th></tr></thead><tbody>${rows}</tbody></table>` +
    `<small>הנתונים לפי מפרטי היבואנים כפי שהוזנו במאגר ספידומטר. הערך המודגש בכל שורה הוא הגבוה או הנמוך יותר, לפי העניין; יש לאמת מול היבואן לפני רכישה.</small>` +
    `<div class="sp-cmp-cta"><a class="pri" href="/cars-list.html#compare=${encodeURIComponent(a.slug)},${encodeURIComponent(b.slug)}">השוואה מלאה והוספת דגם שלישי</a><a href="/car/${esc(a.slug)}/">${esc(carHeName(a))}</a><a href="/car/${esc(b.slug)}/">${esc(carHeName(b))}</a></div>` +
    (moreHTML ? `<h2>השוואות נוספות</h2><ul class="sp-cmp-more">${moreHTML}</ul>` : '') + `</article>`;
  const img = realImages(a)[0] || realImages(b)[0] || `${SITE}/favicon-512.png`;
  let html = carTemplate
    .replace(/<meta name="robots" content="[^"]*">/, '<meta name="robots" content="index, follow, max-image-preview:large">')
    .replace('<title>טוען...</title>', () => `<title>${esc(title)}</title>`)
    .replace('<meta name="description" content="">', () => `<meta name="description" content="${esc(desc)}">`)
    .replace('<link rel="canonical" href="">', () => `<link rel="canonical" href="${url}">`)
    .replace('<meta property="og:title" content="">', () => `<meta property="og:title" content="${esc(title)}">`)
    .replace('<meta property="og:description" content="">', () => `<meta property="og:description" content="${esc(desc)}">`)
    .replace('<meta property="og:url" content="">', () => `<meta property="og:url" content="${url}">`)
    .replace('<meta property="og:image" content="">', () => `<meta property="og:image" content="${esc(img)}">`)
    .replace('<meta name="twitter:title" content="">', () => `<meta name="twitter:title" content="${esc(title)}">`)
    .replace('<meta name="twitter:description" content="">', () => `<meta name="twitter:description" content="${esc(desc)}">`)
    .replace('<meta name="twitter:image" content="">', () => `<meta name="twitter:image" content="${esc(img)}">`)
    .replace('<span id="breadcrumb-name">טוען...</span>', () => `<span id="breadcrumb-name">${esc(carHeName(a))} מול ${esc(carHeName(b))}</span>`)
    .replace(/<div id="car-page-root">[\s\S]*?<\/div>\s*<\/main>/, () => `<div id="car-page-root">${body}</div>\n</main>`);
  /* עמוד ההשוואה סטטי: במקום קוד עמוד הרכב — רק התנהגות הכותרת (תפריט, שנה) וקישור לכלי ההשוואה המלא */
  const tail = `<script>(function(){var y=document.getElementById('yr');if(y)y.textContent=new Date().getFullYear();var m=document.getElementById('hdr-menu');if(m)m.addEventListener('click',function(){var o=document.getElementById('cx-nav').classList.toggle('open');this.setAttribute('aria-expanded',o);});document.addEventListener('click',function(e){if(e.target.closest('[data-open-compare]')){e.preventDefault();location.href=${JSON.stringify(`/cars-list.html?compare=${a.slug},${b.slug}`)};}});window.addEventListener('scroll',function(){document.getElementById('hdr').classList.toggle('is-scrolled',scrollY>8);},{passive:true});})();</script>`;
  const cut = html.indexOf('<script src="/cars-core.js');
  if (cut === -1) throw new Error('car.html: לא נמצא בלוק הסקריפטים');
  html = html.slice(0, cut) + tail + '\n</body>\n</html>\n';
  const ld = [
    { '@context': 'https://schema.org', '@type': 'WebPage', name: title, url, description: desc, inLanguage: 'he',
      about: [a, b].map(c => ({ '@type': 'Car', name: `${c.brand} ${c.model} ${c.year}`, url: `${SITE}/car/${c.slug}/` })) },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ספידומטר', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'מאגר רכבים', item: `${SITE}/cars-list.html` },
      { '@type': 'ListItem', position: 3, name: `${carHeName(a)} מול ${carHeName(b)}` } ] },
  ].map(o => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`).join('\n');
  return html.replace('</head>', () => `${ld}\n</head>`);
}
let COMPARE_PAIRS = [], PAIRS_BY_CAR = new Map();
function planComparePairs(cars) {
  COMPARE_PAIRS = comparePairs(cars); PAIRS_BY_CAR = new Map();
  for (const p of COMPARE_PAIRS) for (const c of [p.a, p.b]) { if (!PAIRS_BY_CAR.has(c.slug)) PAIRS_BY_CAR.set(c.slug, []); PAIRS_BY_CAR.get(c.slug).push(p); }
}
async function writeComparePages(carTemplate) {
  await rm(COMPARE_OUT_DIR, { recursive: true, force: true });
  for (const p of COMPARE_PAIRS) {
    const dir = path.join(COMPARE_OUT_DIR, p.key);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), buildComparePage(carTemplate, p, PAIRS_BY_CAR), 'utf-8');
  }
  console.log(`⚖️  נכתבו ${COMPARE_PAIRS.length} עמודי השוואה תחת /compare/{a}-vs-{b}/.`);
}

/* ─── עמוד המאגר (cars-list.html) ───
   רשימת הרכבים בעמוד נבנית כולה ב-JavaScript, ולכן ב-HTML שגוגל מקבל לא היה אף קישור לעמוד רכב.
   כאן נכתב מדריך "כל הדגמים לפי מותג" כ-HTML רגיל, ונתוני ItemList מובנים. */
const CARS_INDEX_CSS = '<style id="sp-cars-index-css">.sp-cidx{padding:8px 0 44px}.sp-cidx h2{font-size:clamp(1.35rem,2.4vw,1.65rem);font-weight:800;letter-spacing:-.01em;margin:0 0 4px}.sp-cidx>div>p{opacity:.7;margin:0 0 20px}.sp-cidx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}.sp-cidx-b{border:1px solid rgba(16,38,61,.14);border-radius:16px;padding:14px 16px;background:#fff}.sp-cidx-b h3{font-size:1rem;font-weight:800;margin:0 0 8px}.sp-cidx-b h3 a{color:inherit;text-decoration:none}.sp-cidx-b ul{list-style:none;margin:0;padding:0}.sp-cidx-b li{padding:5px 0;border-top:1px solid rgba(16,38,61,.08);display:flex;justify-content:space-between;gap:10px;align-items:baseline}.sp-cidx-b li a{color:#10263D;text-decoration:none;font-weight:600}.sp-cidx-b li a:hover{color:#e8001d}.sp-cidx-b li span{font-size:.82rem;opacity:.65;white-space:nowrap}.sp-cidx-cmp{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:8px}.sp-cidx-cmp a{display:inline-block;padding:9px 15px;border-radius:99px;border:1px solid rgba(16,38,61,.2);background:#fff;color:#10263D;text-decoration:none;font-weight:600;font-size:.9rem}@media(max-width:520px){.sp-cidx-grid{grid-template-columns:1fr 1fr;gap:8px}.sp-cidx-b{padding:12px}.sp-cidx-b li{flex-direction:column;align-items:flex-start;gap:0}}</style>';
function buildCarsIndexHTML(cars) {
  const groups = new Map();
  for (const c of cars) {
    const info = brandInfo(c);
    if (!groups.has(info.key)) groups.set(info.key, { info, cars: [] });
    groups.get(info.key).cars.push(c);
  }
  const sorted = Array.from(groups.values()).sort((a, b) => b.cars.length - a.cars.length || a.info.he.localeCompare(b.info.he, 'he'));
  const num = v => (v == null || v === '' || !isFinite(Number(v)) || Number(v) <= 0) ? null : Number(v);
  const blocks = sorted.map(g => `<div class="sp-cidx-b"><h3><a href="/cars/${encodeURIComponent(g.info.key)}/">${esc(g.info.he)}</a></h3><ul>${g.cars.map(c => {
    const he = carHeName(c), pre = [g.info.he, ...g.info.alt].sort((a, b) => b.length - a.length).find(x => he.startsWith(x + ' '));
    const label = (pre ? he.slice(pre.length + 1) : he) + ' ' + c.year;
    return `<li><a href="/car/${esc(c.slug)}/" title="${esc(he)} ${esc(c.year)}">${esc(label)}</a>${num(c.price) ? `<span>מ-${formatPriceILS(num(c.price))}</span>` : ''}</li>`;
  }).join('')}</ul></div>`).join('');
  return `${CARS_INDEX_CSS}<section class="sp-cidx" aria-labelledby="sp-cidx-t"><div class="cx-wrap"><h2 id="sp-cidx-t">כל הדגמים במאגר</h2><p>${cars.length} דגמים של ${sorted.length} מותגים, עם מחיר, מפרט טכני ואבזור.</p><div class="sp-cidx-grid">${blocks}</div>${COMPARE_PAIRS.length ? `<h2 style="margin-top:34px">השוואות</h2><p>מחיר ומפרט זה לצד זה, מול המתחרים הקרובים.</p><ul class="sp-cidx-cmp">${COMPARE_PAIRS.slice(0, 18).map(p => `<li><a href="/compare/${esc(p.key)}/">${esc(carHeName(p.a))} מול ${esc(carHeName(p.b))}</a></li>`).join('')}</ul>` : ''}</div></section>`;
}
function buildCarsItemList(cars) {
  const ld = { '@context': 'https://schema.org', '@type': 'ItemList', name: 'מאגר הרכבים של ספידומטר', numberOfItems: cars.length,
    itemListElement: cars.map((c, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/car/${c.slug}/`, name: `${carHeName(c)} ${c.year}` })) };
  return `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;
}
/* ─── מחשבון שווי שימוש: רשימת הרכבים לבחירה + טבלת שווי לכל דגם ─── */
async function hydrateUsageCalc(cars) {
  const p = path.join(SITE_DIR, 'usage-value-calculator.html');
  let html;
  try { html = await readFile(p, 'utf-8'); } catch { return; }
  if (!html.includes('<!-- BUILD:CALC_CARS_DATA:START -->')) { console.warn('⚠️ usage-value-calculator.html בלי סמני BUILD — מדלגים.'); return; }
  const num = v => (v == null || v === '' || !isFinite(Number(v)) || Number(v) <= 0) ? null : Number(v);
  const list = cars.filter(c => num(c.price)).map(c => ({
    s: c.slug, n: carHeName(c), e: `${c.brand} ${c.model}`, y: c.year, p: num(c.price), pt: String(c.powertrain || '').toLowerCase(),
    t: (Array.isArray(c.trims) ? c.trims : []).filter(t => t && t.name && num(t.price)).map(t => ({ n: String(t.name), p: num(t.price) })),
    o: Array.isArray(c.old_slugs) ? c.old_slugs : [],
  }));
  html = injectBetween(html, 'CALC_CARS_DATA', `<script>window.SP_CALC_CARS=${JSON.stringify(list).replace(/</g, '\\u003c')};</script>`);
  const rows = list.map(c => {
    const pt = c.pt === 'diesel' ? 'diesel' : c.pt;
    const u = usageValue(c.p, pt) || (pt === 'mhev' ? usageValue(c.p, 'petrol') : null);
    if (!u) return '';
    return `<tr><th scope="row"><a href="/car/${esc(c.s)}/">${esc(c.n)} ${esc(c.y)}</a></th><td><b>${formatPriceILS(u.value)}</b></td><td>${formatPriceILS(c.p)}</td><td style="font-family:inherit">${esc(PT_HE[pt] || '')}${pt === 'mhev' ? '*' : ''}</td><td class="calc"><a href="/usage-value-calculator.html#car=${encodeURIComponent(c.s)}">חשבו נטו</a></td></tr>`;
  }).filter(Boolean);
  const hasMh = list.some(c => c.pt === 'mhev');
  const table = rows.length ? `<div class="tbl-wrap"><table><caption>לפי מחיר המחירון ההתחלתי במאגר.${hasMh ? ' * היברידי קל: מוצג ללא הפחתה; ההפחתה להיברידי תלויה בסוג הדלק הרשום ברישיון הרכב.' : ''}</caption><thead><tr><th scope="col">דגם</th><th scope="col">שווי לחודש</th><th scope="col">מחיר מחירון</th><th scope="col">הנעה</th><th scope="col"><span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">חישוב</span></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>` : '';
  html = injectBetween(html, 'CALC_CARS_TABLE', table);
  await writeFile(p, html, 'utf-8');
  console.log(`🧮 usage-value-calculator.html: ${list.length} רכבים לבחירה, ${rows.length} שורות בטבלה.`);
}

async function hydrateCarsList(cars) {
  const p = path.join(SITE_DIR, 'cars-list.html');
  let html = await readFile(p, 'utf-8');
  if (!html.includes('<!-- BUILD:CARS_INDEX:START -->')) { console.warn('⚠️ cars-list.html בלי סמן CARS_INDEX — מדלגים.'); return; }
  html = injectBetween(html, 'CARS_INDEX', buildCarsIndexHTML(cars));
  html = injectBetween(html, 'CARS_ITEMLIST', buildCarsItemList(cars));
  await writeFile(p, html, 'utf-8');
  console.log(`🚗 cars-list.html: נכתבו ${cars.length} קישורים סטטיים לעמודי רכב.`);
}

/* מזריק תוכן בין סמני BUILD — אידמפוטנטי (מחליף את מה שהיה שם בריצה הקודמת) */
function injectBetween(html, name, content) {
  const re = new RegExp(`<!-- BUILD:${name}:START -->[\\s\\S]*?<!-- BUILD:${name}:END -->`);
  if (!re.test(html)) return html; // תבנית ישנה בלי סמנים - לא נוגעים
  return html.replace(re, () => `<!-- BUILD:${name}:START -->${content}<!-- BUILD:${name}:END -->`); // פונקציה: $ בתוכן לא מתפרש
}

async function fetchArticles(supabase) {
  const { data, error } = await supabase
    .from('articles')
    .select('id,title,sub,cat,author,date,time,read_time,scheduled_at,img,body,body_images,score,specs,deleted,live_updates,yt_urls,faq')
    .order('id', { ascending: false });
  if (error) throw new Error(`Supabase fetch failed: ${error.message}`);
  return (data || []).filter(a => !a.deleted); // כולל 'quick' - הם מקבלים עמוד סטטי עם noindex (במקום 404)
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

/* עמוד הדגם החדש (29.10.2026): אותה פונקציית render בדיוק כמו בדפדפן (car-page.js בשורש הריפו),
   נטענת דרך vm כמו comparison.js. אם הקובץ חסר או שבור — חוזרים ל-renderCarBodyHTML הישנה. */
let spCarPage = null;
try {
  const sandbox = { module: { exports: {} }, URL };
  vm.runInNewContext(readFileSync(new URL('../car-page.js', import.meta.url), 'utf-8'), sandbox, { filename: 'car-page.js' });
  const api = sandbox.module.exports;
  if (api && typeof api.render === 'function') spCarPage = api;
} catch (e) {
  console.warn('⚠️ car-page.js לא נטען — עמודי רכב ייבנו בתבנית הישנה:', e.message);
}
const CAR_OUT_DIR = path.resolve(process.cwd(), 'car');

/* מומנט: מ-05.11.2026 המאגר נשמר בקג"מ, כפי שכתוב במפרט — מוצג כמו שהוא (השם נשאר לתאימות) */
function nmToKgm(v) {
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isFinite(n) ? n + ' קג"מ' : String(v);
}

/* 404.html: רכב חדש שפורסם אחרי הבנייה האחרונה עוד אין לו /car/{slug}/ סטטי. במקום שהכתובת תיפול לדף הבית,
   ה-404 טוען את car.html כמו שהוא (אותה כתובת), והעמוד מרונדר מהמאגר החי עד שהבנייה הבאה יוצרת עמוד סטטי. */
const CAR_404_ROUTE = `<script>/* sp-car-404 */(function(){var m=location.pathname.match(/^\\/car\\/([^\\/]+)\\/?$/);if(!m)return;try{var x=new XMLHttpRequest();x.open('GET','/car.html',false);x.send();if(x.status===200&&x.responseText.indexOf('car-page-root')!==-1){document.write(x.responseText+'<plaintext hidden style="display:none">');}}catch(e){}})();</script>`;
function with404CarRoute(html) {
  if (html.includes('sp-car-404')) return html;
  return html.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n' + CAR_404_ROUTE);
}

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
  engineRows += row('מומנט', c.torque ? nmToKgm(c.torque) : '');
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
    { k: 'torque', label: 'מומנט', fmt: v => nmToKgm(v) },
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
            ${c.torque ? `<div class="key-spec-row"><span class="key-spec-label">🔩 מומנט</span><span class="key-spec-val">${nmToKgm(c.torque)}</span></div>` : ''}
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

  /* נתונים מובנים: Car מלא + נתיב ניווט + שאלות נפוצות (ראו carSchemas). תמונות סטוק לא נכנסות. */
  html = html.replace('</head>', `${carSchemas(c, canonicalUrl)}\n</head>`);

  /* התבנית car.html עצמה מסומנת noindex (עמוד ריק עם "טוען..."); עמוד רכב אמיתי מסומן לאינדוקס */
  html = html.replace(/<meta name="robots" content="[^"]*">/, '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">');
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
    () => `<div id="car-page-root">${spCarPage ? spCarPage.render(c) : renderCarBodyHTML(c, allCars)}</div>${buildCarSeoBlock(c, allCars)}`
  );

  return html;
}

async function main() {
  const targetArticleId = process.env.TARGET_ARTICLE_ID
    ? parseInt(process.env.TARGET_ARTICLE_ID)
    : null;

  console.log('🔄 מתחבר ל-Supabase...');
  const supabase = createClient(SB_URL, SB_KEY);
  const allArticles = await fetchArticles(supabase);
  const liveArticles = allArticles.filter(a => a.cat !== 'quick');       // נכנסות ל-sitemap ולדף הבית
  const quickArticles = allArticles.filter(a => a.cat === 'quick');      // עמוד סטטי עם noindex, לא ב-sitemap
  console.log(`✅ נשלפו ${liveArticles.length} כתבות פעילות + ${quickArticles.length} חדשות בקליק (noindex).`);

  console.log('📄 קורא את תבנית האתר (index.html)...');
  let template = await readFile(TEMPLATE_PATH, 'utf-8');

  // ═══ אופטימיזציית LCP לדף הבית ═══
  console.log('⚡ בונה snapshot נתונים + hero preload...');
  const lightRows = await fetchLightRows(supabase);

  // רכבים נשלפים מוקדם כדי להזריק קישורים סטטיים ל-/car/{slug}/ לפוטר של כל העמודים
  let liveCars = [];
  try {
    liveCars = await fetchCars(supabase);
    planComparePairs(liveCars); // נדרש גם בריצה ממוקדת: מפת האתר ועמודי הרכב מקשרים להשוואות
  } catch (err) {
    console.error('⚠️ שליפת רכבים נכשלה - הפוטר ייבנה בלי קישורי רכבים:', err.message || err);
  }
  ALL_LIVE_ARTICLES = liveArticles; // ממוינות מהחדשה לישנה
  LINK_GRAPH = buildLinkGraph(liveArticles, liveCars);
  console.log(`🔗 קישורים פנימיים: ${LINK_GRAPH.carsByArticle.size} כתבות מקושרות לרכבים, ${LINK_GRAPH.articlesByCar.size} רכבים עם כתבות.`);
  const snapshotTag = buildSnapshotTag(lightRows);
  const heroPreloadTag = buildHeroPreloadTag(lightRows);

  // ה-snapshot נכנס לתבנית עצמה → גם דפי הכתבות מקבלים רינדור מיידי של המקטעים
  template = injectBetween(template, 'DATA_SNAPSHOT', snapshotTag);
  template = injectBetween(template, 'CARS_FOOTER', buildCarsFooterLinks(liveCars));

  // דף הבית (+404 הזהה) מקבל בנוסף preload לתמונת ה-hero + שקופית ראשונה סטטית לקרוסולת המובייל
  let rootHtml = injectBetween(template, 'HERO_PRELOAD', heroPreloadTag);
  rootHtml = injectBetween(rootHtml, 'HERO_SLIDE', buildStaticHeroSlide(lightRows));
  await writeFile(TEMPLATE_PATH, rootHtml, 'utf-8');
  await writeFile(path.join(SITE_DIR, '404.html'), with404CarRoute(rootHtml), 'utf-8');
  console.log(`✅ index.html + 404.html עודכנו (snapshot: ${Math.min(lightRows.length,16)} כתבות, preload: ${heroPreloadTag ? 'כן' : 'אין תמונת hero'})`);
  await writeCategoryPages(rootHtml, lightRows);
  if (!template.includes('id="art-body"')) {
    throw new Error('התבנית לא מכילה את המבנה הצפוי (#art-body) - בדוק את index.html בשורש הריפו');
  }

  const articlesToRender = targetArticleId
    ? allArticles.filter(a => a.id === targetArticleId)
    : allArticles;

  if (targetArticleId && articlesToRender.length === 0) {
    console.warn(`⚠️ כתבה ${targetArticleId} לא נמצאה (אולי נמחקה) - מדלגים על רינדור ממוקד, מרעננים sitemap בלבד.`);
    await rm(path.join(OUT_DIR, String(targetArticleId)), { recursive: true, force: true }); // כתבה שנמחקה: העמוד שלה יורד מיד ולא נשאר באוויר
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
    const existingIds = new Set(allArticles.map(a => String(a.id)));
    const dirs = await readdir(OUT_DIR).catch(() => []);
    for (const d of dirs) {
      if (!existingIds.has(d)) {
        await rm(path.join(OUT_DIR, d), { recursive: true, force: true });
        console.log(`  🗑️  הוסרה תיקייה ישנה: /article/${d}/ (כתבה נמחקה/לא קיימת)`);
      }
    }
  }

  // ריצה ממוקדת: עמודי הרכב שהכתבה מזכירה מתרעננים, כדי שהקישור אליה יופיע בהם מיד.
  if (targetArticleId && articlesToRender.length) {
    try {
      const carTemplate = await readFile(CAR_TEMPLATE_PATH, 'utf-8');
      for (const c of (LINK_GRAPH.carsByArticle.get(targetArticleId) || [])) {
        const dir = path.join(CAR_OUT_DIR, c.slug);
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, 'index.html'), hydrateTemplateForCar(carTemplate, c, liveCars), 'utf-8');
        console.log(`  → /car/${c.slug}/ רוענן (מוזכר בכתבה ${targetArticleId})`);
      }
    } catch (err) {
      console.error('⚠️ רענון עמודי הרכב של הכתבה נכשל - ממשיכים:', err.message || err);
    }
  }

  // ═══ עמודי רכב סטטיים (/car/{slug}/) - לא רצים כשמריצים ריצה ממוקדת לכתבה בודדת ═══
  if (!targetArticleId) {
    console.log('🚗 שולף רכבים מ-Supabase (public.cars) ובונה עמודי רכב סטטיים...');
    try {
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
      await writeCarRedirects(liveCars);
      if (liveCars.length) {
        await hydrateCarsList(liveCars);
        await hydrateUsageCalc(liveCars);
        await writeBrandPages(liveCars);
        await writeComparePages(carTemplate);
      }
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
