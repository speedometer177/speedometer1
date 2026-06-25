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
 * ---------------------------------------------------------------
 */

import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile, mkdir, rm, readdir } from 'fs/promises';
import path from 'path';

const SB_URL = 'https://kaykrrnmykqrfhawgtqt.supabase.co';
const SB_KEY = 'sb_publishable_Ms6YFTnADm-qAd9617Ey9A_D3x-Zumi'; // מפתח ציבורי (publishable) - בטוח לחשיפה, אינו ה-service role key
const SITE = 'https://speedometer10.co.il';

const SITE_DIR = path.resolve(process.cwd());                  // שורש הריפו - מכיל את index.html המלא
const TEMPLATE_PATH = path.join(SITE_DIR, 'index.html');
const OUT_DIR = path.resolve(process.cwd(), 'article');         // פלט: article/{id}/index.html
const SITEMAP_PATH = path.resolve(process.cwd(), 'sitemap.xml');

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
 * לוקח את ה-template המלא (index.html) ומחזיר גרסה "אפויה" לכתבה ספציפית:
 * meta tags ייחודיים + JSON-LD + תוכן הכתבה ממולא ב-DOM, עם article-page גלוי כברירת מחדל.
 */
function hydrateTemplateForArticle(template, a) {
  const title = `${a.title} | ספידומטר`;
  const desc = a.sub || plainTextExcerpt(a.body) || a.title;
  const img = a.img || CAT_IMAGES[a.cat] || CAT_IMAGES.local;
  const canonicalUrl = `${SITE}/article/${a.id}/`;
  const catLabel = CAT_LABELS[a.cat] || a.cat;
  const isoDate = toISODate(a.date);
  const bodyHTML = parseBodyToHTML(a.body, a.body_images, a.title);
  const readMins = Math.max(1, Math.ceil((a.body || '').split(/\s+/).filter(Boolean).length / 200));

  const schema = {
    '@context': 'https://schema.org',
    '@type': a.cat === 'review' ? 'Review' : 'NewsArticle',
    headline: a.title,
    description: desc,
    author: { '@type': 'Person', name: a.author || 'מערכת ספידומטר' },
    image: img,
    inLanguage: 'he',
    publisher: {
      '@type': 'Organization',
      name: 'ספידומטר',
      logo: { '@type': 'ImageObject', url: `${SITE}/logo.png` },
      url: SITE
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonicalUrl }
  };
  if (isoDate) { schema.datePublished = isoDate; schema.dateModified = isoDate; }
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
    .replace(/<meta property="og:type" content="[^"]*">/, `<meta property="og:type" content="${a.cat === 'review' ? 'article' : 'website'}">`)
    .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${canonicalUrl}">`)
    .replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${esc(img)}">`)
    .replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${esc(title)}">`)
    .replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${esc(desc)}">`)
    .replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${esc(img)}">`);

  const extraMeta = [
    isoDate ? `<meta property="article:published_time" content="${isoDate}">` : '',
    `<meta property="article:author" content="${esc(a.author || 'מערכת ספידומטר')}">`,
    `<meta property="article:section" content="${esc(catLabel)}">`,
    `<meta name="author" content="${esc(a.author || 'מערכת ספידומטר')}">`
  ].filter(Boolean).join('\n');
  html = html.replace('</head>', `${extraMeta}\n</head>`);

  const articleSchemaTag = `<script type="application/ld+json" id="article-schema-prerendered">${JSON.stringify(schema)}</script>`;
  html = html.replace('</head>', `${articleSchemaTag}\n</head>`);

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
  html = html.replace(
    /<img class="article-hero-img" id="art-img" src="" alt=""/,
    `<img class="article-hero-img" id="art-img" src="${esc(img)}" alt="${esc(a.title)}"`
  );
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

function buildSitemap(articles) {
  const today = new Date().toISOString().split('T')[0];
  const urls = [
    `<url><loc>${SITE}/</loc><lastmod>${today}</lastmod><changefreq>hourly</changefreq><priority>1.0</priority></url>`,
    ...articles
      .filter(a => a.cat !== 'quick')
      .map(a => {
        const lastmod = toISODate(a.date)?.split('T')[0] || today;
        return `<url><loc>${SITE}/article/${a.id}/</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`;
      })
  ].join('\n  ');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  ${urls}\n</urlset>\n`;
}

async function fetchArticles(supabase) {
  const { data, error } = await supabase
    .from('articles')
    .select('id,title,sub,cat,author,date,time,img,body,body_images,score,specs,deleted')
    .order('id', { ascending: false });
  if (error) throw new Error(`Supabase fetch failed: ${error.message}`);
  return (data || []).filter(a => !a.deleted && a.cat !== 'quick');
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
  const template = await readFile(TEMPLATE_PATH, 'utf-8');
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

  await writeFile(SITEMAP_PATH, buildSitemap(liveArticles), 'utf-8');
  console.log(`🗺️  sitemap.xml נכתב עם ${liveArticles.length + 1} כתובות.`);

  console.log('🎉 הסתיים בהצלחה.');
}

main().catch(err => {
  console.error('❌ שגיאה כללית:', err.message || err);
  process.exit(1);
});
