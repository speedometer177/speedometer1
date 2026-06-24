import { createClient } from '@supabase/supabase-client';
import fs from 'fs';
import path from 'path';

const supabaseUrl = 'https://kaykrrnmykqrfhawgtqt.supabase.co';
// ה-Anon Key שלך (אם הוא שונה, תחליף אותו, אבל לרוב הכל יעבוד גם ככה)
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

    // קריאת קובץ ה-Template (למשל index.html או template.html באותה תיקייה)
    const templatePath = path.join(process.cwd(), 'index.html');
    let templateHtml = fs.readFileSync(templatePath, 'utf8');

    // יצירת תיקיית הכתבות הסטטיות אם היא לא קיימת
    const outputDir = path.join(process.cwd(), 'article');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    for (const article of articles) {
      // הנחת עבודה שיש לך שדה בשם slug או id
      const articleSlug = article.slug || article.id;
      
      // כאן אנחנו מחליפים את התגיות הדינמיות בקוד HTML לצורך SEO מושלם
      let articleHtml = templateHtml
        .replace(/<title>.*?<\/title>/, `<title>${article.title}</title>`)
        .replace(/<meta property="og:title" content=".*?"\s*\/?>/, `<meta property="og:title" content="${article.title}">`)
        .replace(/<meta name="description" content=".*?"\s*\/?>/, `<meta name="description" content="${article.description || ''}">`)
        .replace(/<meta property="og:description" content=".*?"\s*\/?>/, `<meta property="og:description" content="${article.description || ''}">`);

      // הזרקת המידע הראשוני כדי שהקוד בדפדפן ידע להציג את הכתבה מיד בלי להמתין
      const injectionScript = `<script>window.__INITIAL_ARTICLE__ = ${JSON.stringify(article)};</script>`;
      articleHtml = articleHtml.replace('</head>', `${injectionScript}</head>`);

      const outputPath = path.join(outputDir, `${articleSlug}.html`);
      fs.writeFileSync(outputPath, articleHtml, 'utf8');
      console.log(`Generated: /article/${articleSlug}.html`);
    }

    console.log('Static pages generation completed successfully!');
  } catch (err) {
    console.error('Error generating static pages:', err);
    process.exit(1);
  }
}

generatePages();
