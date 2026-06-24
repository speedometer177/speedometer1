import { createClient } from '@supabase/supabase-client';
import fs from 'fs';
import path from 'path';

const supabaseUrl = 'https://kaykrrnmykqrfhawgtqt.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || ''; 
const supabase = createClient(supabaseUrl, supabaseKey);

async function generatePages() {
  try {
    console.log('Fetching articles from Supabase...');
    const { data: articles, error } = await supabase
      .from('articles')
      .select('*');

    if (error) throw error;

    console.log(`Found ${articles.length} articles. Generating static files...`);

    const templatePath = path.join(process.cwd(), 'index.html');
    let templateHtml = fs.readFileSync(templatePath, 'utf8');

    const outputDir = path.join(process.cwd(), 'article');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // מערך שישמור את כל הכתובות החדשות בשביל מפת האתר
    const sitemapUrls = [];

    for (const article of articles) {
      const articleSlug = article.slug || article.id;
      
      let articleHtml = templateHtml
        .replace(/<title>.*?<\/title>/, `<title>${article.title}</title>`)
        .replace(/<meta property="og:title" content=".*?"\s*\/?>/, `<meta property="og:title" content="${article.title}">`)
        .replace(/<meta name="description" content=".*?"\s*\/?>/, `<meta name="description" content="${article.description || ''}">`)
        .replace(/<meta property="og:description" content=".*?"\s*\/?>/, `<meta property="og:description" content="${article.description || ''}">`);

      const injectionScript = `<script>window.__INITIAL_ARTICLE__ = ${JSON.stringify(article)};</script>`;
      articleHtml = articleHtml.replace('</head>', `${injectionScript}</head>`);

      const outputPath = path.join(outputDir, `${articleSlug}.html`);
      fs.writeFileSync(outputPath, articleHtml, 'utf8');
      console.log(`Generated: /article/${articleSlug}.html`);

      // הוספת הכתובת הנקייה לרשימת מפת האתר
      sitemapUrls.push(`  <url>\n    <loc>https://speedometer10.co.il/article/${articleSlug}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>`);
    }

    // יצירת קובץ sitemap.xml חדש ונקי מהיסוד
    console.log('Generating clean sitemap.xml...');
    const sitemapContent = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://speedometer10.co.il/</loc>
    <changefreq>hourly</changefreq>
    <priority>1.0</priority>
  </url>
${sitemapUrls.join('\n')}
</urlset>`;

    fs.writeFileSync(path.join(process.cwd(), 'sitemap.xml'), sitemapContent, 'utf8');
    console.log('Static pages and sitemap generation completed successfully!');
  } catch (err) {
    console.error('Error generating static pages:', err);
    process.exit(1);
  }
}

generatePages();
