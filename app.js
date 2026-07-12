/* ═══ ספידומטר — קוד האפליקציה ═══
   הקובץ חולץ מ-index.html כדי לשחרר את הציור הראשון (FCP).
   נטען עם defer — רץ אחרי שה-HTML כולו פורסר וצויר.
   חשוב: כל שינוי כאן משפיע על index.html, 404.html וכל הדפים הסטטיים. */

const SB_URL='https://kaykrrnmykqrfhawgtqt.supabase.co';const SB_KEY='sb_publishable_Ms6YFTnADm-qAd9617Ey9A_D3x-Zumi';let sbClient=null;function __initSb(){if(window.supabase&&!sbClient){try{sbClient=supabase.createClient(SB_URL,SB_KEY);}catch(e){}}}
window.__initSb=__initSb;__initSb();const STORAGE_KEY='speedometer_articles_v3';const CAT_LABELS={local:'חדשות מקומיות',world:'חדשות עולמיות',review:'מבחן רכב',electric:'רכב חשמלי',tech:'טכנולוגיה',buying:'קניית רכב',sport:'ספורט',luxury:'רכב יוקרה',quick:'חדשות בקליק'};const CAT_IMAGES={local:'https://images.unsplash.com/photo-1571127236794-81c0bbfe1ce3?w=800&q=75&fm=webp&auto=format',world:'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=800&q=75&fm=webp&auto=format',review:'https://images.unsplash.com/photo-1555215695-3004980ad54e?w=800&q=75&fm=webp&auto=format',electric:'https://images.unsplash.com/photo-1593941707882-a5bba14938c7?w=800&q=75&fm=webp&auto=format',tech:'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&q=75&fm=webp&auto=format',buying:'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=800&q=75&fm=webp&auto=format',sport:'https://images.unsplash.com/photo-1544636331-e26879cd4d9b?w=800&q=75&fm=webp&auto=format',luxury:'https://images.unsplash.com/photo-1563720360172-67b8f3dce741?w=800&q=75&fm=webp&auto=format',quick:'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=800&q=75&fm=webp&auto=format'};let articles=[];let currentFilter='all';let currentArticleId=null;let nextId=11;let sliderState={};let deletedIds=new Set(JSON.parse(localStorage.getItem('sp_deleted_ids')||'[]'));
/* הועתק לכאן (מוקדם בקובץ) כדי לתקן באג TDZ: handleMobileHero/openArticle/buildHeroBanner/updateReadingProgress
   נקראים מנקודות סינכרוניות מוקדמות (init, showHome, buildSections) שרצות לפני
   שהקובץ היה מגיע לשורת ההגדרה המקורית של המשתנים האלה בהמשך. הגדרה כאן, מוקדם,
   מבטיחה שהם תמיד קיימים לפני כל קריאה אפשרית להם. */
let heroBannerIdx=0,heroBannerTimer=null,heroBannerArticles=[];
let _progressTop=null,_progressBottom=0,_progressRaf=0;
function saveDeletedIds(){try{localStorage.setItem('sp_deleted_ids',JSON.stringify([...deletedIds]));}catch(e){}}
/* האם הגעת לדף ישירות בכתובת נקייה /article/{id}/ — אם כן, נדלג על בנייה/הצגה של דף הבית ונעלה ישר לכתבה, כדי שגם המשתמש וגם Googlebot יקבלו את התוכן הרלוונטי בלי "הבזק" של דף הבית קודם. */
const __directArticlePathMatch=window.location.pathname.match(/^\/article\/(\d+)\/?$/);
const isStaticPrerender=!!__directArticlePathMatch;
const directArticleId=isStaticPrerender?parseInt(__directArticlePathMatch[1]):null;
function saveLocal(){try{const light=articles.map(a=>{const c=Object.assign({},a);delete c.body;delete c.gallery;delete c.bodyImages;return c;});localStorage.setItem(STORAGE_KEY,JSON.stringify(light));}catch(e){}}
function loadLocal(){try{const d=localStorage.getItem(STORAGE_KEY);if(d){const p=JSON.parse(d);if(p&&p.length>0)return p;}}catch(e){}
return null;}
function mapRow(r){var imgFallback=CAT_IMAGES[r.cat||'local'];var rawTags=r.tags||[];var _uid=null,_srcUid=null;(rawTags||[]).forEach(function(t){if(typeof t==='string'){if(t.indexOf('uid:')===0)_uid=t.slice(4);else if(t.indexOf('src:')===0)_srcUid=t.slice(4);}});return{id:r.id,title:r.title||'',sub:r.sub||'',cat:r.cat||'local',author:r.author||'מערכת ספידומטר',date:r.date||'',time:r.time||'',readTime:r.read_time||'',img:(r.img&&r.img.trim().length>5)?r.img.trim():imgFallback,imgCaption:r.img_caption||'',body:r.body||'',score:r.score||null,views:r.views||0,featured:r.featured||false,specs:r.specs||null,gallery:r.gallery||null,galleryCaptions:r.gallery_captions||null,bodyImages:r.body_images||null,ytUrls:r.yt_urls||null,tags:rawTags,_uid:_uid,_srcUid:_srcUid,scheduledAt:r.scheduled_at||null,};}
async function syncFromSupabase(){try{const LIGHT='id,title,sub,cat,author,date,time,read_time,img,img_caption,score,views,featured,specs,gallery_captions,yt_urls,tags,scheduled_at';let rows;if(sbClient){const{data,error}=await sbClient.from('articles').select(LIGHT).order('id',{ascending:false});if(error)throw error;rows=data;}else{const r=await fetchT(SB_URL+'/rest/v1/articles?select='+LIGHT+'&order=id.desc',{headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY}});if(!r.ok)throw new Error('fetch failed');rows=await r.json();}
if(!Array.isArray(rows)||rows.length===0)return;const sbArticles=rows.map(mapRow);articles=sbArticles;nextId=Math.max(...articles.map(a=>a.id),0)+1;_lastSyncSig=articles.map(a=>a.id).join(',');saveLocal();buildHero();buildSections();try{buildBreakingTicker();}catch(e){}
try{buildTicker();}catch(e){}
try{handleMobileHero();}catch(e){}
}catch(e){console.log('Sync error:',e);}}
let _heavyLoaded=false;async function fetchHeavyFields(){if(_heavyLoaded)return;try{let rows;const HEAVY='id,body,gallery,body_images';if(sbClient){const{data,error}=await sbClient.from('articles').select(HEAVY);if(error)throw error;rows=data;}else{const r=await fetchT(SB_URL+'/rest/v1/articles?select='+HEAVY,{headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY}});if(!r.ok)throw new Error('heavy fetch failed');rows=await r.json();}
if(!Array.isArray(rows))return;const byId={};rows.forEach(r=>{byId[r.id]=r;});articles.forEach(a=>{const h=byId[a.id];if(h){a.body=h.body||'';a.gallery=h.gallery||null;a.bodyImages=h.body_images||null;}});_heavyLoaded=true;saveLocal();try{if(typeof currentArticleId!=='undefined'&&currentArticleId)openArticle(currentArticleId);}catch(e){}}catch(e){console.log('Heavy fetch error:',e);}}
let _lastSyncSig='';async function maybeSyncFromSupabase(){if(document.hidden)return;try{let ids;if(sbClient){const{data,error}=await sbClient.from('articles').select('id').order('id',{ascending:false});if(error)return;ids=(data||[]).map(r=>r.id);}else{const r=await fetchT(SB_URL+'/rest/v1/articles?select=id&order=id.desc',{headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY}});if(!r.ok)return;ids=(await r.json()).map(r=>r.id);}
const sig=ids.join(',');if(sig===_lastSyncSig)return;await syncFromSupabase();}catch(e){}}
function buildSupabaseRow(articleData){const img=articleData.img||'';const safeImg=(img.startsWith('data:')&&img.length>500000)?img.substring(0,500000):img;return{title:articleData.title||'',sub:articleData.sub||'',cat:articleData.cat||'local',author:articleData.author||'מערכת ספידומטר',date:articleData.date||'',time:articleData.time||'',read_time:articleData.readTime||'',img:safeImg,img_caption:articleData.imgCaption||'',body:articleData.body||'',score:articleData.score||null,views:articleData.views||0,featured:articleData.featured||false,specs:articleData.specs||null,gallery:articleData.gallery||null,body_images:articleData.bodyImages||null,tags:articleData.tags||[],yt_urls:articleData.ytUrls||null,scheduled_at:articleData.scheduledAt||null,gallery_captions:articleData.galleryCaptions||null};}
async function pushToSupabase(articleData){const row=buildSupabaseRow(articleData);window._lastPushError='';if(sbClient){try{const{error}=await sbClient.from('articles').insert(row);if(!error)return true;if(error){window._lastPushError=(error.message||'')+
(error.details?(' | '+error.details):'')+
(error.hint?(' | '+error.hint):'')+
(error.code?(' | code '+error.code):'');}}catch(e){window._lastPushError=e.message||String(e);}}
try{const _tok=await getAuthToken();if(!_tok){window._lastPushError='לא מחובר — אנא התחבר מחדש כמנהל.';return false;}const res=await fetchT(SB_URL+'/rest/v1/articles',{method:'POST',headers:{'apikey':SB_KEY,'Authorization':'Bearer '+_tok,'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify(row)});if(res.ok)return true;try{window._lastPushError='HTTP '+res.status+' — '+(await res.text());}
catch(_){window._lastPushError='HTTP '+res.status;}
return false;}catch(e){if(!window._lastPushError)window._lastPushError=e.message||String(e);return false;}}
async function updateInSupabase(articleData){const row=buildSupabaseRow(articleData);window._lastPushError='';try{if(sbClient){const{error}=await sbClient.from('articles').update(row).eq('id',articleData.id);if(!error)return true;window._lastPushError=(error.message||'')+(error.details?(' | '+error.details):'')+(error.hint?(' | '+error.hint):'')+(error.code?(' | code '+error.code):'');return false;}
const _tok=await getAuthToken();if(!_tok){window._lastPushError='לא מחובר — אנא התחבר מחדש כמנהל.';return false;}const res=await fetchT(SB_URL+'/rest/v1/articles?id=eq.'+articleData.id,{method:'PATCH',headers:{'apikey':SB_KEY,'Authorization':'Bearer '+_tok,'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify(row)});if(res.ok)return true;try{window._lastPushError='HTTP '+res.status+' — '+(await res.text());}catch(_){window._lastPushError='HTTP '+res.status;}return false;}catch(e){if(!window._lastPushError)window._lastPushError=e.message||String(e);return false;}}
async function deleteFromSupabase(id){if(!id)return;if(sbClient){try{await sbClient.from('articles').delete().eq('id',id);return;}catch(e){}}
try{const _t=await getAuthToken();if(!_t){window._lastPushError='לא מחובר — מחיקה בשרת דורשת התחברות מנהל';return;}await fetchT(SB_URL+'/rest/v1/articles?id=eq.'+id,{method:'DELETE',headers:{'apikey':SB_KEY,'Authorization':'Bearer '+_t}});}catch(e){window._lastPushError=e.message||String(e);}}

/* ═══ הצבעת לייק/דיסלייק בסוף כתבה ═══ */
function renderVote(aid){var box=document.getElementById('art-vote');if(!box)return;box.style.display='none';box.innerHTML='';
fetchT(SB_URL+'/rest/v1/articles?select=likes,dislikes&id=eq.'+aid,{headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY}})
.then(function(r){if(!r.ok)throw 0;return r.json();})
.then(function(rows){var row=rows&&rows[0];if(!row||typeof row.likes==='undefined')return;_drawVote(aid,row.likes||0,row.dislikes||0);})
.catch(function(){});}
function _drawVote(aid,likes,dislikes){var box=document.getElementById('art-vote');if(!box)return;
var my=null;try{my=localStorage.getItem('sp_vote_'+aid);}catch(e){}
var total=likes+dislikes;var lp=total?Math.round(likes/total*100):0;var dp=total?100-lp:0;
var h='<div class="vote-box"><div class="vote-title">מה חשבתם על הכתבה?</div><div class="vote-btns">'
+'<button class="vote-btn like'+(my==='like'?' chosen':'')+'" onclick="castVote('+aid+',\'like\')"><svg width="17" height="17" viewBox="0 0 24 24" fill="'+(my==='like'?'#fff':'none')+'" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>עניינה אותי</button>'
+'<button class="vote-btn dislike'+(my==='dislike'?' chosen':'')+'" onclick="castVote('+aid+',\'dislike\')"><svg width="17" height="17" viewBox="0 0 24 24" fill="'+(my==='dislike'?'#fff':'none')+'" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/></svg>פחות עניינה אותי</button></div>';
if(total>0){var likeLead=lp>=dp;
h+='<div class="vote-bars">'
+'<div class="vote-bar-row'+(likeLead?' leader':'')+'"><span class="vb-label">עניינה אותי</span><div class="vote-bar-track"><div class="vote-bar-fill like" style="width:'+lp+'%"></div></div><span class="vb-pct">'+lp+'%</span></div>'
+'<div class="vote-bar-row'+(!likeLead?' leader':'')+'"><span class="vb-label">פחות עניינה</span><div class="vote-bar-track"><div class="vote-bar-fill dislike" style="width:'+dp+'%"></div></div><span class="vb-pct">'+dp+'%</span></div>'
+'</div>';}
h+='</div>';box.innerHTML=h;box.style.display='block';box._likes=likes;box._dislikes=dislikes;}
function castVote(aid,vote){var box=document.getElementById('art-vote');if(!box)return;
var prev=null;try{prev=localStorage.getItem('sp_vote_'+aid);}catch(e){}
if(prev===vote)return;
var likes=box._likes||0,dislikes=box._dislikes||0;
if(vote==='like'){likes++;if(prev==='dislike')dislikes=Math.max(0,dislikes-1);}else{dislikes++;if(prev==='like')likes=Math.max(0,likes-1);}
try{localStorage.setItem('sp_vote_'+aid,vote);}catch(e){}
_drawVote(aid,likes,dislikes);
fetchT(SB_URL+'/rest/v1/rpc/vote_article',{method:'POST',headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY,'Content-Type':'application/json'},body:JSON.stringify({aid:aid,new_vote:vote,old_vote:prev})}).catch(function(){});}

function fetchT(url,opts={},ms=10000){const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);return fetch(url,{...opts,signal:c.signal}).finally(()=>clearTimeout(t));}
function escapeHtml(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function safeUrl(u){u=String(u||'').trim();if(/^https?:\/\//i.test(u)||u.startsWith('/')||u.startsWith('data:image/'))return u;return '';}
async function getAuthToken(){try{if(window.__initSb)window.__initSb();if(sbClient){const{data}=await sbClient.auth.getSession();return data&&data.session?data.session.access_token:null;}}catch(e){}return null;}
const dateEl=document.getElementById('top-date');if(dateEl){const now=new Date();dateEl.textContent=now.toLocaleDateString('he-IL',{weekday:'long',year:'numeric',month:'long',day:'numeric'});}
/* ממיר תאריך עברי "ד.ח.שששש" → ISO 8601 "שששש-חח-דד" עבור סכמת Rich Results של גוגל */
function spISODate(d){try{if(!d)return new Date().toISOString().split('T')[0];if(/^\d{4}-\d{2}-\d{2}/.test(d))return d.split('T')[0];const m=String(d).match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/);if(m){let yy=m[3];if(yy.length===2)yy='20'+yy;const mm=('0'+m[2]).slice(-2);const dd=('0'+m[1]).slice(-2);return yy+'-'+mm+'-'+dd;}const t=new Date(d);if(!isNaN(t))return t.toISOString().split('T')[0];}catch(e){}return new Date().toISOString().split('T')[0];}
function buildBreakingTicker(){const track=document.getElementById('breaking-track');if(!track)return;const items=articles.filter(a=>a.cat!=='quick').slice(0,12);if(!items.length)return;const unit=items.map(a=>`<span class="breaking-item" onclick="openArticle(${a.id})" role="button" tabindex="0">${a.title}</span>`).join('');
// מילוי הרצועה כך שעותק בודד תמיד רחב לפחות כרוחב המסך — מבטיח גלילה רציפה ללא רווחים גם כשיש מעט כותרות
let seq=unit;try{track.style.animation='none';track.innerHTML=seq;const host=track.closest('.breaking-ticker');const need=((host&&host.clientWidth)||window.innerWidth||360)*1.4;let guard=0;while(track.scrollWidth>0&&track.scrollWidth<need&&guard<10){seq+=unit;track.innerHTML=seq;guard++;}}catch(e){}
// שני עותקים זהים → לולאה אינסופית חלקה (‎-50%‎)
track.innerHTML=seq+seq;
// משך ההנפשה יחסי לרוחב למהירות אחידה (~70px/שנייה)
try{const oneW=track.scrollWidth/2;const dur=Math.min(120,Math.max(18,Math.round(oneW/70)));track.style.setProperty('--sp-bt-dur',dur+'s');}catch(e){}
// rAF מנוע: לא CSS animation — ביטול מוחלט כדי שלא יתנגשו
track.style.animation='none';track.style.transition='none';track.style.willChange='transform';track.style.transform='translateX(0)';if(window._spTickRaf)cancelAnimationFrame(window._spTickRaf);var _half=0,_pos=0,_last=performance.now();function _spTick(now){var dt=Math.min(100,now-_last);_last=now;if(!_half||!track.isConnected){_half=track.scrollWidth/2;}if(_half>0&&!document.hidden){_pos+=0.06*dt;if(_pos>=_half)_pos-=_half;track.style.transform='translateX('+(-_pos)+'px)';}window._spTickRaf=requestAnimationFrame(_spTick);}window._spTickRaf=requestAnimationFrame(_spTick);}
function buildTicker(){const track=document.getElementById('ticker-track');if(!track||!articles.length)return;const content=articles.slice(0,10).map(a=>`<span class="ticker-item" onclick="openArticle(${a.id})">${a.title}</span>`).join('');track.innerHTML=content+content;}
function buildMobileLatestStrip(articles){if(window.innerWidth>680)return;const strip=document.getElementById('mobile-latest-strip');const dotsEl=document.getElementById('mobile-latest-dots');const badge=document.getElementById('latest-count-badge');if(!strip)return;const items=articles.slice(0,10);if(badge)badge.textContent=items.length;const allItems=[...items,...items.slice(0,2)];strip.innerHTML=allItems.map(a=>cardHTML(a)).join('');if(dotsEl){dotsEl.innerHTML=items.map((_,i)=>`<div class="mc-dot${i===0?' active':''}" data-idx="${i}"></div>`).join('');dotsEl.querySelectorAll('.mc-dot').forEach(dot=>{dot.addEventListener('click',()=>{const idx=parseInt(dot.dataset.idx);scrollToCard(strip,idx);});});}
let isScrolling=false;let _cardW=0;const getCardW=()=>{if(!_cardW)_cardW=strip.querySelector('.card')?.offsetWidth||strip.offsetWidth;return _cardW;};window.addEventListener('resize',()=>{_cardW=0;},{passive:true});strip.addEventListener('scroll',()=>{if(isScrolling)return;isScrolling=true;requestAnimationFrame(()=>{updateMobileDots(strip,dotsEl,items.length,getCardW());const gap=14;const step=getCardW()+gap;const maxReal=step*items.length;if(strip.scrollLeft>=maxReal){strip.scrollLeft=strip.scrollLeft-maxReal;}
isScrolling=false;});},{passive:true});}
function scrollToCard(strip,idx){const card=strip.querySelectorAll('.card')[idx];if(card)card.scrollIntoView({behavior:'smooth',block:'nearest',inline:'start'});}
function updateMobileDots(strip,dotsEl,count,cardW){if(!dotsEl)return;if(!cardW)cardW=strip.querySelector('.card')?.offsetWidth||strip.offsetWidth;const gap=14;const activeIdx=Math.round(strip.scrollLeft/(cardW+gap))%count;dotsEl.querySelectorAll('.mc-dot').forEach((d,i)=>d.classList.toggle('active',i===activeIdx));}
function buildHero(){const area=document.getElementById('hero-area');if(!area)return;const pool=currentFilter==='all'?articles.filter(a=>a.cat!=='quick'):articles.filter(a=>a.cat===currentFilter);const featured=pool.filter(a=>a.featured);const main=featured[0]||pool[0];const side1=featured[1]||pool[1];const side2=featured[2]||pool[2];if(!main){area.innerHTML='';return;}
area.innerHTML=`
    <div class="hero-grid">
      <div class="hero-main" onclick="openArticle(${main.id})" role="button" tabindex="0" aria-label="${main.title}" onkeydown="if(event.key==='Enter')openArticle(${main.id})">
        <img src="${heroSrc(main.img||CAT_IMAGES[main.cat])}" srcset="${heroSrcset(main.img||CAT_IMAGES[main.cat])}" sizes="(max-width:980px) 100vw, 800px" alt="${main.title}" loading="eager" fetchpriority="high" decoding="async" width="800" height="450">
        <div class="hero-main-content">
          <span class="hero-cat-badge">${CAT_LABELS[main.cat]}</span>
          <h2 class="hero-main-title">${main.title}</h2>
          <div class="hero-meta">
            <span class="hero-author">${main.author}</span>
            <span class="hero-date">${main.date}</span>
            ${main.readTime?`<span class="hero-read-time">${main.readTime}</span>`:''}
            ${main.time?`<span class="hero-read-time">${main.time}</span>`:''}
          </div>
        </div>
      </div>
      <div class="hero-side">
        ${side1?`<div class="hero-side-card"onclick="openArticle(${side1.id})"role="button"tabindex="0"aria-label="${side1.title}"onkeydown="if(event.key==='Enter')openArticle(${side1.id})"><img src="${cardThumb(side1.img||CAT_IMAGES[side1.cat])}"${responsiveAttrs(side1.img||CAT_IMAGES[side1.cat],'(max-width:980px) 50vw, 340px')}alt="${side1.title}"loading="lazy"width="340"height="210"decoding="async"><div class="hero-side-content"><div class="hero-side-cat">${CAT_LABELS[side1.cat]}</div><div class="hero-side-title">${side1.title}</div></div></div>`:''}
        ${side2?`<div class="hero-side-card"onclick="openArticle(${side2.id})"role="button"tabindex="0"aria-label="${side2.title}"onkeydown="if(event.key==='Enter')openArticle(${side2.id})"><img src="${cardThumb(side2.img||CAT_IMAGES[side2.cat])}"${responsiveAttrs(side2.img||CAT_IMAGES[side2.cat],'(max-width:980px) 50vw, 340px')}alt="${side2.title}"loading="lazy"width="340"height="210"decoding="async"><div class="hero-side-content"><div class="hero-side-cat">${CAT_LABELS[side2.cat]}</div><div class="hero-side-title">${side2.title}</div></div></div>`:''}
      </div>
    </div>`;}
function wsrvW(url,w){return 'https://wsrv.nl/?url='+encodeURIComponent(url)+'&w='+w+'&fit=cover&output=webp&q=75';}
function isProxyable(url){return typeof url==='string'&&/^https?:\/\//.test(url)&&url.indexOf('wsrv.nl')===-1&&url.indexOf('images.unsplash.com')===-1;}
function heroSrc(url){return isProxyable(url)?wsrvW(url,800):url;}
function heroSrcset(url){if(typeof url!=='string')return '';if(url.indexOf('images.unsplash.com')!==-1){return [320,500,800,1200].map(w=>url.replace(/([?&])w=\d+/,'$1w='+w)+' '+w+'w').join(', ');}if(isProxyable(url)){return [400,640,800,1200].map(w=>wsrvW(url,w)+' '+w+'w').join(', ');}return '';}
function getImageUrl(originalUrl,width,fit){
  if(typeof originalUrl!=='string')return originalUrl;
  return wsrvW(originalUrl,width||800);
}
function cardThumb(url){if(typeof url!=='string')return url;
  if(url.indexOf('images.unsplash.com')!==-1){return url.replace(/([?&])w=\d+/,'$1w=320');}
  if(isProxyable(url)){return wsrvW(url,320);}
  return url;}
function responsiveAttrs(url,sizesAttr){if(typeof url!=='string')return'';
  if(url.indexOf('images.unsplash.com')!==-1){const widths=[240,320,500,800,1200];const srcset=widths.map(w=>url.replace(/([?&])w=\d+/,'$1w='+w)+' '+w+'w').join(', ');return` srcset="${srcset}" sizes="${sizesAttr}"`;}
  if(isProxyable(url)){const widths=[240,400,640,800,1200];const srcset=widths.map(w=>wsrvW(url,w)+' '+w+'w').join(', ');return` srcset="${srcset}" sizes="${sizesAttr}"`;}
  return'';}
function cardHTML(a){const score=a.score?`<div class="review-score ${parseFloat(a.score)>=8?'high':parseFloat(a.score)>=6?'mid':''}">${a.score}</div>`:'';return`<a href="/article/${a.id}/" class="card" onclick="openArticle(${a.id});return false;" aria-label="${a.title}">
    <div class="card-img">
      <img src="${cardThumb(a.img||CAT_IMAGES[a.cat])}"${responsiveAttrs(a.img||CAT_IMAGES[a.cat], '(max-width:680px) 45vw, 400px')} alt="${a.title}" loading="lazy" width="400" height="225" decoding="async" onload="this.classList.add('loaded')" onerror="this.classList.add('loaded')">
      ${score}<span class="card-cat">${CAT_LABELS[a.cat]}</span>
    </div>
    <div class="card-body">
      <div class="card-title">${a.title}</div>
      <!-- sub hidden in grid, shown only in article -->
      <div class="card-foot">
        <span class="card-author">${a.author}</span>
        <span class="card-date">${a.date}${a.time?' · '+a.time:''}</span>
        ${a.readTime?`<span class="card-readtime">${a.readTime}</span>`:''}
      </div>
    </div>
  </a>`;}
/* ── #6 רינדור גריד עם 6 כתבות + הרחבה ל"לכל הכתבות" ── */
const _gridExpandState={};
function renderExpandableGrid(gridEl,items,stateKey){
  if(!gridEl)return;
  const BASE=8,STEP=6;
  let shownCount=_gridExpandState[stateKey];
  if(typeof shownCount!=='number'||shownCount<BASE)shownCount=BASE;
  const shown=items.slice(0,shownCount);
  const cardsHtml=shown.map(a=>cardHTML(a)).join('')||'<p style="color:var(--muted);font-size:0.9rem;grid-column:1/-1;padding:20px 0;">לא נמצאו כתבות בקטגוריה זו.</p>';
  let btn='';
  if(items.length>shownCount){btn=`<button class="show-more-grid-btn" onclick="expandGridMore('${stateKey}')" aria-label="טען עוד כתבות">קרא עוד ↓</button>`;}
  else if(shownCount>BASE){btn=`<button class="show-more-grid-btn" onclick="resetGridExpand('${stateKey}')" aria-label="צמצם רשימה">הצג פחות ↑</button>`;}
  gridEl.innerHTML=cardsHtml+btn;
  gridEl.dataset.stateKey=stateKey;
}
function expandGridMore(stateKey){
  const cur=typeof _gridExpandState[stateKey]==='number'?_gridExpandState[stateKey]:8;
  _gridExpandState[stateKey]=cur+6;
  buildSections();
}
function resetGridExpand(stateKey){
  _gridExpandState[stateKey]=8;
  buildSections();
  const grid=document.querySelector('[data-state-key="'+stateKey+'"]');
  if(grid)grid.scrollIntoView({behavior:'smooth',block:'start'});
}
function toggleGridExpand(stateKey){expandGridMore(stateKey);}
function latestItemHTML(a,num){return`<div class="latest-item" onclick="openArticle(${a.id})" role="button" tabindex="0" aria-label="${a.title}" onkeydown="if(event.key==='Enter')openArticle(${a.id})">
    <span class="latest-num">${num<10?'0'+num:num}</span>
    <div class="latest-body">
      <div class="latest-cat">${CAT_LABELS[a.cat]}</div>
      <div class="latest-title">${a.title}</div>
      <div class="latest-date">${a.date}${a.time?' · '+a.time:''}</div>
    </div>
  </div>`;}
function spFlashWordCount(){var el=document.getElementById('a-flash-text');var c=document.getElementById('flash-word-count');if(!el||!c)return;var n=(el.value||'').trim().split(/\s+/).filter(Boolean).length;c.textContent=n+' / 70 מילים';c.classList.toggle('over',n>70);}
function flashHTML(a){const timeStr=a.time?a.time:'';const txt=(a.body||a.sub||'').trim();let srcId=a._sourceId;if(!srcId&&a._srcUid){const s=articles.find(x=>x._uid===a._srcUid);if(s)srcId=s.id;}const openId=srcId||a.id;const author=a.author||'מערכת ספידומטר';const safeTitle=(a.title||'').replace(/"/g,'&quot;');return`<div class="sp-chat-msg">
  <div class="sp-chat-avatar" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 12l5-3"/><circle cx="12" cy="12" r="1.6" fill="#fff" stroke="none"/></svg></div>
  <div class="sp-chat-bubble" onclick="openArticle(${openId})" role="article" tabindex="0" aria-label="${safeTitle}" onkeydown="if(event.key==='Enter')openArticle(${openId})">
    <div class="sp-chat-head"><span class="sp-chat-author">${author}</span><span class="sp-chat-badge">מבזק</span></div>
    ${a.img?`<div class="sp-chat-img"><img src="${cardThumb(a.img)}" alt="${safeTitle}" loading="lazy" decoding="async" onload="this.classList.add('loaded')" onerror="this.classList.add('loaded')"></div>`:''}
    <div class="sp-chat-title">${a.title}</div>
    ${txt?`<div class="sp-chat-text">${txt}</div>`:''}
    <a class="sp-chat-link" href="/article/${openId}/" onclick="event.stopPropagation();openArticle(${openId});return false;">הכתבה המלאה <span aria-hidden="true">‹‹‹</span></a>
    <div class="sp-chat-time">${a.date||''}${timeStr?' · '+timeStr:''}</div>
  </div>
</div>`;}
function buildSections(){try{handleMobileHero();}catch(e){console.log('Mobile hero error:',e);}
const _now=new Date();const visibleArticles=articles.filter(a=>!a.scheduledAt||new Date(a.scheduledAt)<=_now);
/* ── Quick / Flash feed ── */
const flashWrap=document.getElementById('flash-feed-wrap');const flashList=document.getElementById('flash-list');const lg=document.getElementById('latest-grid');
if(currentFilter==='quick'){if(flashWrap)flashWrap.style.display='block';if(lg)lg.style.display='none';if(flashList){const qItems=visibleArticles.filter(a=>a.cat==='quick');flashList.innerHTML=qItems.length?qItems.map(a=>flashHTML(a)).join(''):'<div class="flash-empty">אין מבזקים עדיין.</div>';}}else{if(flashWrap)flashWrap.style.display='none';if(lg)lg.style.display='grid';}
const filtered=currentFilter==='all'?visibleArticles.filter(a=>a.cat!=='quick'):visibleArticles.filter(a=>a.cat===currentFilter||(a.tags&&a.tags.includes('cat:'+currentFilter)));if(lg&&currentFilter!=='quick'){lg.style.display='grid';renderExpandableGrid(lg,filtered,'latest-more-btn');}
const rg=document.getElementById('reviews-grid');if(rg){const r=articles.filter(a=>a.cat==='review');rg.style.display=r.length?'grid':'none';renderExpandableGrid(rg,r,'reviews-more-btn');}
const wg=document.getElementById('world-grid');if(wg){const w=articles.filter(a=>a.cat==='world');wg.style.display=w.length?'grid':'none';renderExpandableGrid(wg,w,'world-more-btn');}
const pl=document.getElementById('popular-list');if(pl)pl.innerHTML=[...articles].sort((a,b)=>(b.views||0)-(a.views||0)).slice(0,5).map((a,i)=>latestItemHTML(a,i+1)).join('');}
function filterCat(cat,el){currentFilter=cat;_gridExpandState['latest-more-btn']=false;document.querySelectorAll('.cat-tag').forEach(b=>b.classList.remove('active'));if(el&&el.classList){el.classList.add('active');}else{const map={all:'הכל',local:'חדשות מקומיות',world:'עולמי',review:'מבחני רכב',electric:'חשמלי',tech:'טכנולוגיה',buying:'קניית רכב',sport:'ספורט',luxury:'יוקרה',quick:'בקליק'};document.querySelectorAll('.cat-tag').forEach(b=>{if(map[cat]&&b.textContent.trim()===map[cat])b.classList.add('active');});}
buildHero();buildSections();showHome();window.scrollTo(0,0);}
function _clearPrerenderOverride(){try{var s=document.getElementById('prerender-override');if(s&&s.parentNode)s.parentNode.removeChild(s);}catch(e){}}
function showHome(pushState=true){_clearPrerenderOverride();if(articles&&articles.length){const _lg=document.getElementById('latest-grid');if(_lg&&currentFilter!=='quick'&&_lg.children.length===0){try{buildHero();buildSections();buildTicker();buildBreakingTicker();}catch(e){}}}resetMeta();const artSubEl=document.getElementById('art-sub');if(artSubEl)artSubEl.style.display='';const hp=document.getElementById('home-page');const ap2=document.getElementById('article-page');const adp=document.getElementById('admin-page');document.body.classList.remove('article-open');if(hp){hp.style.display='block';}
if(ap2)ap2.style.display='none';if(adp)adp.style.display='none';document.getElementById('main-footer').style.display='block';if(pushState&&window.history){window.history.pushState({page:'home',filter:currentFilter},'','/');}
updateReadingProgress();const homeBtn=document.querySelector('.bottom-nav-item:first-child');if(homeBtn)setBottomNav(homeBtn);try{handleMobileHero();}catch(e){}}
function showAdmin(){_clearPrerenderOverride();document.getElementById('home-page').style.display='none';document.getElementById('article-page').style.display='none';document.getElementById('admin-page').style.display='block';document.getElementById('main-footer').style.display='none';renderAdminTable();window.scrollTo({top:0});}
function openArticle(id,pushState=true){_clearPrerenderOverride();const a=articles.find(x=>x.id===id);if(!a)return;currentArticleId=id;if(typeof _progressTop!=='undefined')_progressTop=null;if(!_heavyLoaded&&(!a.body||a.body.length===0)){try{const fetchOne=async()=>{try{let row=null;if(sbClient){const{data}=await sbClient.from('articles').select('id,body,gallery,body_images').eq('id',id).single();row=data;}else{const r=await fetchT(SB_URL+'/rest/v1/articles?select=id,body,gallery,body_images&id=eq.'+id,{headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY}});if(r.ok){const arr=await r.json();row=arr&&arr[0];}}
if(row){a.body=row.body||'';a.gallery=row.gallery||null;a.bodyImages=row.body_images||null;saveLocal();if(currentArticleId===id)openArticle(id);}}catch(e){}};fetchOne();}catch(e){}}
a.views=(a.views||0)+1;saveLocal();if(sbClient)Promise.resolve(sbClient.rpc('increment_article_views',{article_id:id})).catch(()=>{});document.getElementById('home-page').style.display='none';document.getElementById('article-page').style.display='block';document.body.classList.add('article-open');document.getElementById('admin-page').style.display='none';updateMeta(a);const artCatEl=document.getElementById('art-cat');if(artCatEl){artCatEl.textContent=CAT_LABELS[a.cat];artCatEl.onclick=()=>{showHome();filterCat(a.cat);};artCatEl.style.cursor='pointer';artCatEl.title='לכל '+CAT_LABELS[a.cat];}
const bcNav=document.getElementById('art-breadcrumb');if(bcNav){const bcMap={local:{parent:'חדשות',child:'חדשות מקומיות',parentCat:'local'},world:{parent:'חדשות',child:'חדשות עולמיות',parentCat:'world'},review:{parent:'מבחנים',child:'מבחני רכב',parentCat:'review'},electric:{parent:'מדריכים',child:'רכב חשמלי',parentCat:'electric'},tech:{parent:'מדריכים',child:'טכנולוגיה ובטיחות',parentCat:'tech'},buying:{parent:'מדריכים',child:'מדריך קניית רכב',parentCat:'buying'},sport:{parent:'מבחנים',child:'רכב ספורט',parentCat:'sport'},luxury:{parent:'יוקרה',child:'רכב יוקרה',parentCat:'luxury'},quick:{parent:'חדשות',child:'חדשות בקליק',parentCat:'quick'}};const bc=bcMap[a.cat]||{parent:'חדשות',child:CAT_LABELS[a.cat]||a.cat,parentCat:a.cat};const bcSchema={"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"ספידומטר","item":"https://speedometer10.co.il/"},{"@type":"ListItem","position":2,"name":bc.parent,"item":"https://speedometer10.co.il/?cat="+bc.parentCat},{"@type":"ListItem","position":3,"name":bc.child,"item":"https://speedometer10.co.il/?cat="+a.cat},{"@type":"ListItem","position":4,"name":a.title}]};let bcSchemaEl=document.getElementById('breadcrumb-schema');if(!bcSchemaEl){bcSchemaEl=document.createElement('script');bcSchemaEl.id='breadcrumb-schema';bcSchemaEl.type='application/ld+json';document.head.appendChild(bcSchemaEl);}
bcSchemaEl.textContent=JSON.stringify(bcSchema);const shortTitle=a.title.length>48?a.title.substring(0,48)+'…':a.title;bcNav.innerHTML='<a href="/" onclick="event.preventDefault();showHome()" aria-label="עמוד הבית ספידומטר">בית</a>'+'<span class="bc-sep" aria-hidden="true">›</span>'+'<a href="/?cat='+a.cat+'" onclick="event.preventDefault();filterCat(\''+a.cat+'\')" aria-label="'+bc.child+'">חדשות</a>'+'<span class="bc-sep" aria-hidden="true">›</span>'+'<a href="/?cat='+a.cat+'" onclick="event.preventDefault();filterCat(\''+a.cat+'\')" aria-label="'+bc.child+'">'+bc.child+'</a>'+'<span class="bc-sep" aria-hidden="true">›</span>'+'<span class="bc-current" aria-current="page">'+shortTitle+'</span>';}
document.getElementById('art-title').textContent=a.title;const artSubEl=document.getElementById('art-sub');if(artSubEl){artSubEl.textContent=a.sub||'';artSubEl.style.display=a.sub?'block':'none';}
document.getElementById('art-author').textContent=a.author;document.getElementById('art-date').textContent=a.date;const wordCount=(a.body||'').split(/\s+/).filter(Boolean).length;const readMins=Math.max(1,Math.ceil(wordCount/200));const displayReadTime=a.readTime||(readMins+' דק׳ קריאה');document.getElementById('art-read').textContent=displayReadTime;const artTimeEl=document.getElementById('art-time');if(artTimeEl)artTimeEl.textContent=a.time?('פורסם: '+a.time):'';const vidChannels=document.getElementById('art-video-channels');const ytEmbedsWrap=document.getElementById('yt-embeds-wrap');if(vidChannels&&ytEmbedsWrap){const ytUrls=a.ytUrls||[];if(ytUrls.length>0){vidChannels.style.display='block';ytEmbedsWrap.innerHTML=ytUrls.map(url=>{const vid=extractYTVideoId(url);if(!vid)return'';return`<div class="yt-embed-card" onclick="loadYTEmbed(this,'${vid}')" data-vid="${vid}" role="button" tabindex="0" aria-label="פתח סרטון ביוטיוב">
          <div class="yt-thumb-wrap">
            <img src="https://img.youtube.com/vi/${vid}/mqdefault.jpg" alt="תמונת הסרטון" loading="lazy">
            <div class="yt-play-btn" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>
            </div>
          </div>
        </div>`;}).join('');}else if(a.cat==='review'){vidChannels.style.display='block';ytEmbedsWrap.innerHTML='<a href="http://www.youtube.com/@Speedometer-r4s" target="_blank" rel="noopener noreferrer" class="btn-video review" style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;background:#e8001d;color:#fff;border-radius:6px;font-weight:700;text-decoration:none;"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg> ספידומטר ביוטיוב</a>';}else{vidChannels.style.display='none';}}
const ogTitle=document.querySelector('meta[property="og:title"]');const ogDesc=document.querySelector('meta[property="og:description"]');const ogImg=document.querySelector('meta[property="og:image"]');const twTitle=document.querySelector('meta[name="twitter:title"]');const twDesc=document.querySelector('meta[name="twitter:description"]');if(ogTitle)ogTitle.setAttribute('content',a.title+' | ספידומטר');if(ogDesc)ogDesc.setAttribute('content',a.sub||a.title);if(ogImg&&a.img)ogImg.setAttribute('content',a.img);if(twTitle)twTitle.setAttribute('content',a.title+' | ספידומטר');if(twDesc)twDesc.setAttribute('content',a.sub||a.title);document.title=a.title+' | ספידומטר';let sc=document.getElementById('article-schema');if(!sc){sc=document.createElement('script');sc.id='article-schema';sc.type='application/ld+json';document.head.appendChild(sc);}
const schema={"@context":"https://schema.org","@type":a.cat==='review'?'Review':'NewsArticle',"headline":a.title,"description":a.sub||a.title,"author":{"@type":"Person","name":a.author},"datePublished":spISODate(a.date),"dateModified":spISODate(a.date),"image":a.img||CAT_IMAGES[a.cat],"inLanguage":"he","publisher":{"@type":"Organization","name":"ספידומטר","logo":{"@type":"ImageObject","url":"https://speedometer10.co.il/logo.png"},"url":"https://speedometer10.co.il/"},"mainEntityOfPage":{"@type":"WebPage","@id":"https://speedometer10.co.il/article/"+a.id+"/"}};if(a.cat==='review'&&a.score){schema.reviewRating={"@type":"Rating","ratingValue":parseFloat(a.score),"bestRating":10,"worstRating":1};schema.itemReviewed={"@type":"Car","name":a.title,"offers":a.specs&&a.specs.price?{"@type":"Offer","price":a.specs.price,"priceCurrency":"ILS"}:undefined};}
if(a.specs&&a.specs.power){schema.about={"@type":"Car","name":a.title,"vehicleEngine":{"@type":"EngineSpecification","enginePower":{"@type":"QuantitativeValue","value":a.specs.power,"unitCode":"BHP"}}};}
if(a.tags&&a.tags.length)schema.keywords=a.tags.join(', ');schema.articleSection=CAT_LABELS[a.cat]||a.cat;schema.inLanguage='he';schema.publisher={"@type":"Organization","name":"ספידומטר","url":"https://speedometer10.co.il/","logo":{"@type":"ImageObject","url":"https://speedometer10.co.il/logo.png"}};sc.textContent=JSON.stringify(schema,(k,v)=>v===undefined?undefined:v);const imgEl=document.getElementById('art-img');const oldSl=document.getElementById('art-slider');if(oldSl)oldSl.remove();if(a.gallery&&a.gallery.length>1){imgEl.style.display='none';const sl=document.createElement('div');sl.id='art-slider';imgEl.parentElement.insertBefore(sl,imgEl);sl.innerHTML=buildSliderHTML(a.gallery);sliderState['art-slider']={current:0};}else{imgEl.style.display='block';const rawSrc=a.img||CAT_IMAGES[a.cat];imgEl.classList.remove('loaded');imgEl.removeAttribute('src');if(rawSrc&&rawSrc.includes('unsplash.com')){const url=rawSrc.includes('fm=webp')?rawSrc:rawSrc.replace(/\?(.*)/,'?$1&fm=webp&q=75&w=900&auto=format').replace(/^([^?]+)$/,'$1?fm=webp&q=75&w=900&auto=format');imgEl.src=url;}else if(isProxyable(rawSrc)){imgEl.src=wsrvW(rawSrc,1000);}else{imgEl.src=rawSrc;}
imgEl.alt=a.title;imgEl.setAttribute('data-lightbox',imgEl.src);if(imgEl.complete&&imgEl.naturalWidth)imgEl.classList.add('loaded');}
document.getElementById('art-img-caption').textContent=a.imgCaption||'';try{renderVote(a.id);}catch(e){}const specWrap=document.getElementById('art-spec');if(a.cat==='review'&&a.specs){specWrap.innerHTML=quickCubesHTML(a.specs)+prosConsHTML(a.specs)+'<button class="spec-toggle" onclick="var b=this.closest(\'#art-spec\').querySelector(\'.spec-collapse\');var o=b.classList.toggle(\'open\');this.classList.toggle(\'open\',o);this.setAttribute(\'aria-expanded\',o)" aria-expanded="false"><span class="spec-toggle-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14.7 6.3a5 5 0 0 0-7.07 7.07l-4.2 4.2a1.5 1.5 0 0 0 2.12 2.12l4.2-4.2a5 5 0 0 0 7.07-7.07l-2.83 2.83-2.12-2.12z"/></svg></span><span class="spec-toggle-label">מפרט טכני מלא</span><span class="spec-toggle-chev"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polyline points="6 9 12 15 18 9"/></svg></span></button><div class="spec-collapse">'+buildSpecCard(a.specs,true)+'</div>';specWrap.style.display='block';setTimeout(()=>document.querySelectorAll('.score-bar-fill').forEach(b=>{b.style.width=b.dataset.pct+'%';}),150);}else{specWrap.innerHTML='';specWrap.style.display='none';}
document.getElementById('art-body').innerHTML=parseBody(a.body||'',a.bodyImages||[],a.title);const tagsWrap=document.getElementById('art-tags');var _dispTags=(a.tags||[]).filter(function(t){return !(typeof t==='string'&&(t.indexOf('uid:')===0||t.indexOf('src:')===0));});if(tagsWrap&&_dispTags.length){tagsWrap.innerHTML=_dispTags.map(t=>`<span onclick="doSearch('${t}')" style="display:inline-block;padding:4px 12px;background:var(--bg);border:1px solid var(--border);border-radius:20px;font-size:0.78rem;cursor:pointer;margin:4px 2px;transition:all 0.15s;" onmouseover="this.style.borderColor='var(--red)'" onmouseout="this.style.borderColor='var(--border)'">${t}</span>`).join('');tagsWrap.style.display='block';}else if(tagsWrap)tagsWrap.style.display='none';const _words=new Set((a.title||'').split(/[\s,]+/).filter(w=>w.length>2));const _tags=new Set(a.tags||[]);const related=articles.filter(x=>x.id!==id).map(x=>{let sc=0;if(x.cat===a.cat)sc+=3;(x.tags||[]).forEach(t=>{if(_tags.has(t))sc+=2;});(x.title||'').split(/[\s,]+/).forEach(w=>{if(w.length>2&&_words.has(w))sc+=1;});sc+=(x.views||0)/1000;return{x,sc};}).filter(({sc})=>sc>0).sort((a,b)=>b.sc-a.sc).slice(0,3).map(({x})=>x);const fallback=articles.filter(x=>x.id!==id).sort((x,y)=>(y.views||0)-(x.views||0)).slice(0,3);const galleryWrap=document.getElementById('art-gallery');if(galleryWrap){if(a.gallery&&a.gallery.length>1){const captions=a.galleryCaptions||[];galleryWrap.style.display='block';galleryWrap.innerHTML=`
        <div style="font-size:0.82rem;font-weight:700;color:var(--muted);letter-spacing:0.06em;text-transform:uppercase;margin-bottom:14px;display:flex;align-items:center;gap:8px;">
          <span style="display:block;width:3px;height:14px;background:var(--red);border-radius:2px;"></span>
          גלריית תמונות (${a.gallery.length})
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;">
          ${a.gallery.map((src,i)=>`<div style="cursor:zoom-in;"onclick="openLightbox('${src}')"><img src="${src}"alt="${captions[i]||'תמונה '+(i+1)}"loading="lazy"decoding="async"width="200"height="150"style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:6px;border:1px solid var(--border);transition:transform 0.2s;"onmouseover="this.style.transform='scale(1.02)'"onmouseout="this.style.transform='scale(1)'">${captions[i]?`<p style="font-size:0.72rem;color:var(--muted);margin-top:4px;text-align:center;">${captions[i]}</p>`:''}</div>`).join('')}
        </div>`;}else{galleryWrap.style.display='none';}}
document.getElementById('related-articles').innerHTML=(related.length?related:fallback).map(r=>cardHTML(r)).join('');document.getElementById('sidebar-related').innerHTML=articles.filter(x=>x.id!==id).sort((x,y)=>(y.views||0)-(x.views||0)).slice(0,5).map((r,i)=>latestItemHTML(r,i+1)).join('');if(window.history&&pushState){window.history.pushState({page:'article',id:id},'','/article/'+id+'/');}
window.scrollTo({top:0,behavior:'smooth'});}
function buildSliderHTML(images){const dots=images.map((_,i)=>`<button class="slider-dot ${i===0?'active':''}" onclick="goSlide('art-slider',${i})" aria-label="תמונה ${i+1}"></button>`).join('');const imgs=images.map((src,i)=>`<img src="${src}" alt="תמונה ${i+1}" loading="lazy" decoding="async">`).join('');return`<div class="img-slider" id="art-slider"><div class="slider-track" id="ast">${imgs}</div><button class="slider-btn slider-prev" onclick="moveSlide('art-slider',-1)" aria-label="תמונה קודמת">&#8250;</button><button class="slider-btn slider-next" onclick="moveSlide('art-slider',1)" aria-label="תמונה הבאה">&#8249;</button><div class="slider-dots" role="tablist">${dots}</div><div class="slider-count" id="asc" aria-live="polite">1 / ${images.length}</div></div>`;}
function moveSlide(id,dir){const wrap=document.getElementById(id);if(!wrap)return;const track=wrap.querySelector('.slider-track');const total=track.querySelectorAll('img').length;if(!sliderState[id])sliderState[id]={current:0};let cur=(sliderState[id].current+dir+total)%total;sliderState[id].current=cur;track.style.transform=`translateX(${cur*100}%)`;wrap.querySelectorAll('.slider-dot').forEach((d,i)=>d.classList.toggle('active',i===cur));const cnt=wrap.querySelector('.slider-count');if(cnt)cnt.textContent=`${cur+1} / ${total}`;}
function goSlide(id,idx){if(!sliderState[id])sliderState[id]={current:0};moveSlide(id,idx-sliderState[id].current);}

/* ═══ קוביות מפרט מהיר + יתרונות/חסרונות למבחני רכב ═══ */
function quickCubesHTML(specs){
  const ic={
    year:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    segment:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 17h14l-1.5-4.5a2 2 0 0 0-1.9-1.5H8.4a2 2 0 0 0-1.9 1.5z"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/></svg>',
    engine:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12V7h4l2-2h4v3h3v2h2v6h-2v2h-3l-2 2H7v-3H5v-3H3v-2z"/></svg>',
    power:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    accel:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="13" r="8"/><path d="M12 13l4-4"/><path d="M9 2h6"/></svg>',
    price:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>'};
  const cube=(icon,label,val)=>val?`<div class="qs-cube"><div class="qs-icon">${icon}</div><div class="qs-label">${label}</div><div class="qs-val">${escapeHtml(val)}</div></div>`:'';
  const html=cube(ic.year,'שנה',specs.year)+cube(ic.segment,'סגמנט',specs.segment)+cube(ic.engine,'מנוע',specs.engine)+cube(ic.power,'הספק',specs.power)+cube(ic.accel,'0-100 קמ"ש',specs.zeroToHundred)+cube(ic.price,'מחיר',specs.price);
  return html?`<div class="qs-grid">${html}</div>`:'';
}
function prosConsHTML(specs){
  const pros=(specs.pros||[]),cons=(specs.cons||[]);
  if(!pros.length&&!cons.length)return '';
  const v='<span class="pc-badge v"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4"><polyline points="20 6 9 17 4 12"/></svg></span>';
  const x='<span class="pc-badge x"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>';
  let h='<div class="pc-wrap">';
  if(pros.length)h+='<div class="pc-col"><div class="pc-title pros">'+v+'יתרונות</div>'+pros.map(p=>'<div class="pc-item">'+v+escapeHtml(p)+'</div>').join('')+'</div>';
  if(cons.length)h+='<div class="pc-col"><div class="pc-title cons">'+x+'חסרונות</div>'+cons.map(c=>'<div class="pc-item">'+x+escapeHtml(c)+'</div>').join('')+'</div>';
  return h+'</div>';
}
function buildSpecCard(specs,skipPC){const cats=specs.cats||[];const row=(icon,label,val)=>val?`
    <div class="si-row">
      <div class="si-label">${icon}<span>${label}</span></div>
      <div class="si-val">${val}</div>
    </div>`:'';const prosHTML=(!skipPC&&(specs.pros||[]).length)?`
    <div class="si-proscons">
      <div class="si-pros">
        <div class="si-pc-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          יתרונות
        </div>
        ${(specs.pros||[]).map(p=>`<div class="si-pc-item si-pro"><span>+</span>${p}</div>`).join('')}
      </div>
      ${(specs.cons||[]).length ? `<div class="si-cons"><div class="si-pc-title"><svg width="13"height="13"viewBox="0 0 24 24"fill="none"stroke="#dc2626"stroke-width="2.5"><line x1="18"y1="6"x2="6"y2="18"/><line x1="6"y1="6"x2="18"y2="18"/></svg>חסרונות</div>${(specs.cons||[]).map(c=>`<div class="si-pc-item si-con"><span>−</span>${c}</div>`).join('')}</div>` : ''}
    </div>`:'';const scoresHTML=cats.length?`
    <div class="score-bars" style="margin-top:14px;">
      ${cats.map(c=>`<div class="score-row"><span class="score-name">${c.name}</span><div class="score-bar-wrap"><div class="score-bar-fill"data-pct="${c.score*10}"style="width:0%"></div></div><span class="score-num">${c.score}</span></div>`).join('')}
    </div>`:'';return`<div class="spec-infographic">
    <div class="si-header">
      <span class="si-header-bar"></span>
      <span>תעודת זהות טכנית</span>
      ${specs.model?`<span class="si-model-badge">${specs.model}${specs.year?' '+specs.year:''}</span>`:''}
    </div>
    ${(specs.pros||specs.cons) && (specs.pros||[]).length ? prosHTML : ''}
    <div class="si-grid">
      ${row('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>', 'סגמנט', specs.segment||null)}
      ${row('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>', 'מחיר', specs.price||null)}
      ${row('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>', 'ארץ ייצור', specs.country||null)}
      ${row('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3"/></svg>', 'גימורים', specs.trims||null)}
      ${row('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="10" rx="2"/><path d="M7 7V5M17 7V5M7 17v2M17 17v2M2 12h2M20 12h2"/></svg>', 'מנוע', specs.engine||null)}
      ${row('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>', 'הספק', specs.power ? specs.power+' כ"ס' : null)}
      ${row('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10"/><polyline points="22 2 22 8 16 8"/></svg>', 'מומנט', specs.torque ? specs.torque+' נ"מ' : null)}
      ${row('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12H19M13 6l6 6-6 6"/></svg>', 'תאוצה 0-100', specs.zeroToHundred ? specs.zeroToHundred+'s' : null)}
      ${specs.engine !== 'חשמלי' && specs.gearbox ? row('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h10M12 7V5M12 19v-2"/></svg>', 'תיבת הילוכים', specs.gearbox) : ''}
      ${row('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/></svg>', 'מהירות מירבית', specs.topspeed ? specs.topspeed+' קמ"ש' : null)}
      ${row('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>', 'תא מטען', specs.trunk ? specs.trunk+' ל' : null)}
      ${row('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 22V9l6-6h6l2 2v4h1a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H3z"/></svg>', 'צריכת דלק', specs.consumption ? specs.consumption+' ל/100' : null)}
      ${row('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><path d="M2 22 C2 22 5 15 12 15 C19 15 22 22 22 22"/><path d="M12 15 C12 15 8 10 12 2 C16 10 12 15 12 15"/></svg>', 'זיהום אוויר', specs.emission||null)}
      ${specs.range ? row('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><path d="M13 2 L3 14 L12 14 L11 22 L21 10 L12 10 Z"/></svg>', 'טווח', specs.range+' ק"מ') : ''}
    </div>
    ${scoresHTML}
  </div>`;}
function parseBody(text,bodyImages,articleTitle){const lines=String(text||'').split('\n');const rawParts=[];const imgs=(bodyImages||[]).filter(x=>x&&safeUrl(x.src));let firstHeadingSkipped=false;for(const line of lines){if(line.startsWith('## ')){const ht=line.slice(3).trim();if(!firstHeadingSkipped&&articleTitle&&ht===articleTitle.trim()){firstHeadingSkipped=true;continue;}
rawParts.push({type:'h2',html:`<h2>${escapeHtml(ht)}</h2>`});}
else if(line.startsWith('### ')){rawParts.push({type:'h3',html:`<h3>${escapeHtml(line.slice(4))}</h3>`});}
else if(line.startsWith('> ')){rawParts.push({type:'quote',html:`<blockquote>${escapeHtml(line.slice(2))}</blockquote>`});}
else if(line.trim()){rawParts.push({type:'p',html:`<p>${escapeHtml(line).replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')}</p>`});}}
const figHTML=img=>{const s=safeUrl(img.src);if(!s)return '';const esc=escapeHtml(s);const cap=escapeHtml(img.cap||'');return `<figure class="body-img-wrap"><img src="${esc}" alt="${cap}" loading="lazy" decoding="async" width="800" height="450" data-lightbox="${esc}" style="cursor:zoom-in">${img.cap?`<figcaption>${cap}</figcaption>`:''}</figure>`;};
let html;if(imgs.length===0){html=rawParts.map(x=>x.html).join('');}
else{const paraCount=rawParts.filter(x=>x.type==='p').length;const interval=Math.max(2,Math.floor(paraCount/(imgs.length+1)));let imgQueue=[...imgs],pIdx=0,result=[];for(const part of rawParts){result.push(part.html);if(part.type==='p'){pIdx++;if(imgQueue.length>0&&pIdx%interval===0)result.push(figHTML(imgQueue.shift()));}}
imgQueue.forEach(img=>result.push(figHTML(img)));html=result.join('');}
if(window.DOMPurify){html=DOMPurify.sanitize(html,{ALLOWED_TAGS:['h2','h3','p','strong','em','blockquote','figure','figcaption','img','br','a','ul','ol','li'],ALLOWED_ATTR:['src','alt','loading','decoding','width','height','class','style','data-lightbox','href','target','rel']});}
return html;}
function shareArticle(type){const a=articles.find(x=>x.id===currentArticleId);if(!a)return;if(type==='whatsapp')window.open('https://wa.me/?text='+encodeURIComponent(a.title+' — ספידומטר '+window.location.href));if(type==='copy'){navigator.clipboard.writeText(window.location.href).then(()=>alert('קישור הועתק!'));}}
async function subscribeNewsletter(){const emailEl=document.getElementById('newsletter-email');const email=emailEl?emailEl.value.trim():'';if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)){alert('אנא הזינו כתובת אימייל תקינה');return;}
try{const r=await fetchT(SB_URL+'/rest/v1/newsletter_subscribers',{method:'POST',headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY,'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify({email:email.toLowerCase()})});
if(r.ok||r.status===409){alert('תודה! נרשמתם בהצלחה לניוזלטר של ספידומטר 🏁');if(emailEl)emailEl.value='';}
else{alert('אופס — ההרשמה נכשלה כרגע, נסו שוב בעוד רגע');}}catch(e){alert('אופס — ההרשמה נכשלה כרגע, נסו שוב בעוד רגע');}}

/* ═══════════════════════════════════════════════
   פאנל סדר תצוגה — קרוסולה ו-Hero
   ═══════════════════════════════════════════════ */
function openCarouselPanel(){
  var panel=document.getElementById('carousel-order-panel');
  if(panel){panel.style.display='block';renderCarouselPanel();return;}
  // בנייה ראשונה
  panel=document.createElement('div');
  panel.id='carousel-order-panel';
  panel.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px';
  panel.innerHTML=`
    <div style="background:#fff;border-radius:18px;width:min(560px,96vw);max-height:90vh;overflow-y:auto;padding:24px 20px;font-family:var(--font);direction:rtl">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <h2 style="font-size:1.18rem;font-weight:900;margin:0">סדר תצוגה — Hero / קרוסולה</h2>
        <button onclick="document.getElementById('carousel-order-panel').style.display='none'"
          style="background:#f0f0f0;border:none;border-radius:8px;width:32px;height:32px;font-size:1.2rem;cursor:pointer;display:flex;align-items:center;justify-content:center">✕</button>
      </div>
      <p style="font-size:0.82rem;color:#666;margin-bottom:16px">
        הכתבה המסומנת ב-★ תופיע ראשונה ב-Hero (מחשב) ובקרוסולה (מובייל). 
        רק כתבה אחת יכולה להיות featured בכל זמן נתון.
      </p>
      <div id="carousel-list" style="display:flex;flex-direction:column;gap:10px"></div>
    </div>`;
  document.body.appendChild(panel);
  panel.addEventListener('click',function(e){if(e.target===panel)panel.style.display='none';});
  renderCarouselPanel();
}

function renderCarouselPanel(){
  var list=document.getElementById('carousel-list');
  if(!list)return;
  var visible=articles.filter(a=>a.cat!=='quick').slice(0,20);
  list.innerHTML=visible.map(function(a){
    var isFeat=!!a.featured;
    var img=a.img&&a.img.length>5?('https://wsrv.nl/?url='+encodeURIComponent(a.img)+'&w=80&h=50&fit=cover&output=webp&q=60'):'';
    return '<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border:1.5px solid '+(isFeat?'#e8001d':'#eee')+';border-radius:12px;background:'+(isFeat?'#fff5f5':'#fafafa')+'">'
      +(img?'<img src="'+img+'" width="72" height="45" style="border-radius:7px;object-fit:cover;flex-shrink:0" loading="lazy">':'<div style="width:72px;height:45px;background:#eee;border-radius:7px;flex-shrink:0"></div>')
      +'<div style="flex:1;min-width:0">'
      +'<div style="font-size:0.88rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:320px">'+escapeHtml(a.title)+'</div>'
      +'<div style="font-size:0.74rem;color:#888;margin-top:2px">'+escapeHtml(a.cat)+' · '+escapeHtml(a.date||'')+'</div>'
      +'</div>'
      +'<button onclick="setFeatured('+a.id+')" title="הגדר כראשי" style="flex-shrink:0;width:38px;height:38px;border-radius:50%;border:2px solid '+(isFeat?'#e8001d':'#ddd')+';background:'+(isFeat?'#e8001d':'#fff')+';cursor:pointer;font-size:1.2rem;display:flex;align-items:center;justify-content:center;transition:all 0.2s">'+(isFeat?'<span style=color:#fff>★</span>':'<span style=color:#bbb>☆</span>')+'</button>'
      +'</div>';
  }).join('');
}

async function setFeatured(id){
  var tok=await getAuthToken();if(!tok){alert('יש להתחבר קודם');return;}
  // מסיר featured מהכל + מגדיר על הנבחר
  var prev=articles.find(a=>a.featured&&a.id!==id);
  if(prev){
    try{
      await fetchT(SB_URL+'/rest/v1/articles?id=eq.'+prev.id,{method:'PATCH',
        headers:{'apikey':SB_KEY,'Authorization':'Bearer '+tok,'Content-Type':'application/json','Prefer':'return=minimal'},
        body:JSON.stringify({featured:false})});
      var pa=articles.find(a=>a.id===prev.id);if(pa)pa.featured=false;
    }catch(e){}
  }
  try{
    await fetchT(SB_URL+'/rest/v1/articles?id=eq.'+id,{method:'PATCH',
      headers:{'apikey':SB_KEY,'Authorization':'Bearer '+tok,'Content-Type':'application/json','Prefer':'return=minimal'},
      body:JSON.stringify({featured:true})});
    var na=articles.find(a=>a.id===id);if(na){na.featured=true;}
    buildHero();buildSections();buildHeroBanner&&buildHeroBanner();
    renderCarouselPanel();
  }catch(e){alert('שגיאה בשמירה: '+e.message);}
}

function adminTab(tab,el){document.querySelectorAll('.admin-tab').forEach(b=>b.classList.remove('active'));el.classList.add('active');document.getElementById('admin-new').style.display=tab==='new'?'block':'none';document.getElementById('admin-list').style.display=tab==='list'?'block':'none';if(tab==='list'){renderAdminTable();if(!document.getElementById('admin-carousel-btn')){var ab=document.createElement('button');ab.id='admin-carousel-btn';ab.innerHTML='🎠 סדר Hero / קרוסולה';ab.style.cssText='display:block;margin:12px 0;padding:10px 20px;background:linear-gradient(135deg,#e8001d,#ff6a00);color:#fff;border:none;border-radius:10px;font-family:var(--font);font-weight:800;font-size:0.9rem;cursor:pointer;width:100%';ab.onclick=openCarouselPanel;var adminList=document.getElementById('admin-list');if(adminList)adminList.insertBefore(ab,adminList.firstChild);}}}
/* הכפתור מוזרק ב-adminTab כשנפתח הטאב */ function renderAdminTable(){const tbl=document.getElementById('admin-table');if(!tbl)return;tbl.innerHTML=`<thead><tr><th>כותרת</th><th>קטגוריה</th><th>כותב</th><th>תאריך</th><th>צפיות</th><th>פעולות</th></tr></thead><tbody>${
    articles.map(a=>`<tr><td><div class="tbl-title">${a.title}${a.scheduledAt?'<span style="font-size:0.68rem;background:#f59e0b;color:#fff;padding:1px 7px;border-radius:10px;margin-right:6px;">⏰ תזמון</span>':''}</div></td><td><span class="tbl-cat">${CAT_LABELS[a.cat]||a.cat}</span></td><td style="color:var(--mid);font-size:0.8rem">${a.author}</td><td style="color:var(--muted);font-size:0.78rem">${a.date}</td><td style="color:var(--muted);font-size:0.78rem">${a.views||0}</td><td><div class="tbl-actions"><button class="tbl-btn"onclick="viewArticle(${a.id})">צפה</button><button class="tbl-btn"onclick="editArticle(${a.id})">ערוך</button><button class="tbl-btn del"onclick="deleteArticle(${a.id})">מחק</button></div></td></tr>`).join('')
  }</tbody>`;}
let galleryImages=[];async function handleGalleryUpload(input){const files=Array.from(input.files).slice(0,10-galleryImages.length);for(const file of files){const compressedFile=await compressImageFile(file,300);const src=await uploadImageOrBase64(compressedFile||null);if(src)galleryImages.push({src,caption:''});}
renderGalleryPreview();input.value='';}
function renderGalleryPreview(){const preview=document.getElementById('gallery-preview');if(!preview)return;if(galleryImages.length===0){preview.innerHTML='';return;}
preview.innerHTML=galleryImages.map((img,i)=>`
    <div style="position:relative;width:140px;">
      <img src="${img.src}" style="width:140px;height:90px;object-fit:cover;border-radius:6px;border:1px solid var(--border);cursor:pointer;" onclick="openLightbox('${img.src}')" alt="תמונה ${i+1}">
      <button onclick="removeGalleryImg(${i})" style="position:absolute;top:4px;right:4px;width:22px;height:22px;background:rgba(0,0,0,0.7);color:#fff;border:none;border-radius:50%;font-size:0.8rem;cursor:pointer;display:flex;align-items:center;justify-content:center;">×</button>
      <input type="text" placeholder="כיתוב..." value="${img.caption||''}" onchange="galleryImages[${i}].caption=this.value" style="width:100%;margin-top:4px;padding:4px 6px;font-size:0.72rem;border:1px solid var(--border);border-radius:4px;font-family:var(--font);">
    </div>
  `).join('');}
function removeGalleryImg(i){galleryImages.splice(i,1);renderGalleryPreview();}
function openLightbox(src){let lb=document.getElementById('lightbox-overlay');if(!lb){lb=document.createElement('div');lb.id='lightbox-overlay';lb.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';lb.onclick=()=>lb.remove();document.body.appendChild(lb);}
lb.textContent='';const _im=document.createElement('img');const _s=safeUrl(src);if(!_s){lb.remove();return;}_im.src=_s;_im.alt='תמונה מוגדלת';_im.style.cssText='max-width:95vw;max-height:95vh;object-fit:contain;border-radius:4px;';lb.appendChild(_im);lb.style.display='flex';}
document.addEventListener('click',function(e){const t=e.target&&e.target.closest?e.target.closest('[data-lightbox]'):null;if(t){e.preventDefault();openLightbox(t.getAttribute('data-lightbox'));}});

async function notifyGoogleIndexing(articleId){ /* האינדוקס מתבצע בצד-שרת דרך Supabase Edge Function + טריגר. אין יותר מפתח פרטי בצד-לקוח. */ return true; }

async function publishArticle(){const title=(document.getElementById('a-title').value||'').trim();const body=(document.getElementById('a-body').value||'').trim();if(!title){alert('חובה להזין כותרת!');return;}
if(!body){alert('חובה להזין תוכן!');return;}
try{if(window.__initSb)window.__initSb();if(!sbClient){alert('אין חיבור לשרת — נסה לרענן.');return;}const{data:_sess}=await sbClient.auth.getSession();if(!_sess||!_sess.session){alert('פג תוקף ההתחברות. אנא התחבר מחדש כדי לפרסם.');openAdminLogin();return;}}catch(e){}
const editId=document.getElementById('a-title').dataset.editId;const now=new Date();const readMin=Math.max(1,Math.ceil(body.split(/\s+/).length/200));const data={id:editId?parseInt(editId):nextId++,title,sub:(document.getElementById('a-sub').value||'').trim(),cat:document.getElementById('a-cat').value,author:(document.getElementById('a-author').value||'').trim()||'מערכת ספידומטר',date:now.toLocaleDateString('he-IL'),time:now.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'}),readTime:readMin+' דק׳ קריאה',img:(document.getElementById('a-img').value||'').trim(),imgCaption:(document.getElementById('a-img-cap').value||'').trim(),gallery:galleryImages.length>0?galleryImages.map(g=>g.src):null,galleryCaptions:galleryImages.length>0?galleryImages.map(g=>g.caption||''):null,ytUrls:[1,2].map(i=>(document.getElementById('yt-url-'+i)?.value||'').trim()).filter(Boolean),bodyImages:[1,2,3,4,5].map(i=>({src:(document.getElementById('body-img-'+i)?.value||'').trim(),cap:(document.getElementById('body-img-cap-'+i)?.value||'').trim()})).filter(x=>x.src),body,score:(document.getElementById('a-score').value||'').trim()||null,scheduledAt:(document.getElementById('a-scheduled')?.value||'').trim()||null,readTime:document.getElementById('a-read-time')?.value?.trim()?document.getElementById('a-read-time').value.trim()+" דק׳ קריאה":Math.max(1,Math.ceil(body.split(/\s+/).length/200))+" דק׳ קריאה",tags:(()=>{const baseTags=(document.getElementById('a-tags')?.value||'').split(',').map(t=>t.trim()).filter(Boolean);const extraCats=Array.from(document.querySelectorAll('input[name="extra-cat"]:checked')).map(cb=>cb.value);extraCats.forEach(c=>{if(!baseTags.includes('cat:'+c))baseTags.push('cat:'+c);});return baseTags;})(),views:editId?(articles.find(a=>a.id===parseInt(editId))?.views||0):0,featured:false,specs:(document.getElementById('a-cat').value==='review')?(()=>{const p=document.getElementById('spec-power')?.value?.trim();const t=document.getElementById('spec-torque')?.value?.trim();const z=document.getElementById('spec-zero')?.value?.trim();const r=document.getElementById('spec-range')?.value?.trim();const pr=document.getElementById('spec-price')?.value?.trim();const eng=document.getElementById('spec-engine')?.value;const cats=[{name:'נסיעה',score:parseFloat(document.getElementById('score-driving')?.value)||0},{name:'עיצוב',score:parseFloat(document.getElementById('score-design')?.value)||0},{name:'טכנולוגיה',score:parseFloat(document.getElementById('score-tech')?.value)||0},{name:'נוחות',score:parseFloat(document.getElementById('score-comfort')?.value)||0},{name:'ערך',score:parseFloat(document.getElementById('score-value')?.value)||0},].filter(x=>x.score>0);const prosRaw=(document.getElementById('spec-pros')?.value||'').trim();const consRaw=(document.getElementById('spec-cons')?.value||'').trim();return{engine:eng,power:p,torque:t,zeroToHundred:z,range:r||null,price:pr,cats,model:document.getElementById('spec-model')?.value?.trim()||null,year:document.getElementById('spec-year')?.value?.trim()||null,segment:document.getElementById('spec-segment')?.value||null,country:document.getElementById('spec-country')?.value?.trim()||null,trims:document.getElementById('spec-trims')?.value?.trim()||null,gearbox:document.getElementById('spec-gearbox')?.value||null,topspeed:document.getElementById('spec-topspeed')?.value?.trim()||null,trunk:document.getElementById('spec-trunk')?.value?.trim()||null,consumption:document.getElementById('spec-consumption')?.value?.trim()||null,emission:document.getElementById('spec-emission')?.value||null,pros:prosRaw?prosRaw.split('\n').map(s=>s.trim()).filter(Boolean):[],cons:consRaw?consRaw.split('\n').map(s=>s.trim()).filter(Boolean):[],};})():null};if(editId){const idx=articles.findIndex(a=>a.id===parseInt(editId));if(idx>-1)articles[idx]=data;delete document.getElementById('a-title').dataset.editId;saveLocal();await maybeAddQuickVersion(data);buildHero();buildSections();buildTicker();buildBreakingTicker();clearForm();const _upOk=await updateInSupabase(data);if(_upOk){syncFromSupabase();notifyGoogleIndexing(data.id).catch(()=>{});alert('הכתבה עודכנה! 🔍 נשלחה מחדש לגוגל');}else{alert('⚠️ העדכון ל-Supabase נכשל — השינויים שלך לא נשמרו בשרת.\n\nהשגיאה המדויקת:\n'+(window._lastPushError||'(לא התקבלה הודעת שגיאה)')+'\n\nנסה להתחבר מחדש (#admin177) ולנסות שוב.');}}else{articles.unshift(data);saveLocal();await maybeAddQuickVersion(data);buildHero();buildSections();buildTicker();buildBreakingTicker();clearForm();const ok=await pushToSupabase(data);if(ok){syncFromSupabase();notifyGoogleIndexing(data.id).catch(()=>{});alert('הכתבה פורסמה בהצלחה! 🔍 נשלחה לאינדוקס גוגל');}else{alert('⚠️ ההעלאה ל-Supabase נכשלה.\n\nהשגיאה המדויקת מ-Supabase:\n'+(window._lastPushError||'(לא התקבלה הודעת שגיאה)'));}}}
function editArticle(id){const a=articles.find(x=>x.id===id);if(!a)return;if(!_heavyLoaded&&(!a.body||a.body.length===0)){try{const fetchOne=async()=>{try{let row=null;if(sbClient){const{data}=await sbClient.from('articles').select('id,body,gallery,body_images').eq('id',id).single();row=data;}else{const r=await fetchT(SB_URL+'/rest/v1/articles?select=id,body,gallery,body_images&id=eq.'+id,{headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY}});if(r.ok){const arr=await r.json();row=arr&&arr[0];}}
if(row){a.body=row.body||'';a.gallery=row.gallery||null;a.bodyImages=row.body_images||null;saveLocal();const editIdEl=document.getElementById('a-title');if(editIdEl&&editIdEl.dataset.editId===String(id)){const bodyEl=document.getElementById('a-body');if(bodyEl&&!bodyEl.value)bodyEl.value=a.body||'';if(a.bodyImages)a.bodyImages.forEach((img,i)=>{const si=document.getElementById('body-img-'+(i+1));if(si&&!si.value)si.value=img.src||'';const ci=document.getElementById('body-img-cap-'+(i+1));if(ci&&!ci.value)ci.value=img.cap||'';});}}}catch(e){}};fetchOne();}catch(e){}}
adminTab('new',document.querySelectorAll('.admin-tab')[0]);const tabBtn=document.querySelectorAll('.admin-tab')[0];if(tabBtn)tabBtn.textContent='✏️ עריכת כתבה';document.getElementById('a-title').value=a.title;document.getElementById('a-title').dataset.editId=id;document.getElementById('a-title').dataset.srcUid=a._uid||'';(function(){var q=articles.find(function(x){return x.cat==='quick'&&(((a._uid)&&x._srcUid===a._uid)||x._sourceId===a.id);});var ftEl=document.getElementById('a-flash-title');var fxEl=document.getElementById('a-flash-text');if(ftEl)ftEl.value=q?(q.title||''):'';if(fxEl)fxEl.value=q?(q.sub||q.body||''):'';try{spFlashWordCount();}catch(e){}})();document.getElementById('a-sub').value=a.sub||'';document.getElementById('a-cat').value=a.cat;document.getElementById('a-author').value=a.author;document.getElementById('a-img').value=a.img||'';document.getElementById('a-img-cap').value=a.imgCaption||'';document.getElementById('a-score').value=a.score||'';const schedEl=document.getElementById('a-scheduled');if(schedEl&&a.scheduledAt)schedEl.value=a.scheduledAt;const rtEl=document.getElementById('a-read-time');if(rtEl)rtEl.value=a.readTime?a.readTime.replace(/[^0-9]/g,''):'';const tagsEl=document.getElementById('a-tags');if(tagsEl)tagsEl.value=(a.tags||[]).filter(function(t){return !(typeof t==='string'&&(t.indexOf('uid:')===0||t.indexOf('src:')===0));}).join(', ');if(a.bodyImages)a.bodyImages.forEach((img,i)=>{const si=document.getElementById('body-img-'+(i+1));if(si)si.value=img.src||'';const ci=document.getElementById('body-img-cap-'+(i+1));if(ci)ci.value=img.cap||'';});document.getElementById('a-body').value=a.body||'';if(a.ytUrls){a.ytUrls.forEach((url,i)=>{const el=document.getElementById('yt-url-'+(i+1));if(el)el.value=url;});}
const ytWrap=document.getElementById('youtube-section-wrap');if(ytWrap)ytWrap.style.display='block';toggleSpecsSection(a.cat);if(a.cat==='review'&&a.specs){const s=a.specs;const setV=(id,val)=>{const el=document.getElementById(id);if(el&&val!=null)el.value=val;};setV('spec-engine',s.engine||'בנזין');setV('spec-power',s.power||'');setV('spec-torque',s.torque||'');setV('spec-zero',s.zeroToHundred||'');setV('spec-range',s.range||'');setV('spec-price',s.price||'');setV('spec-model',s.model||'');setV('spec-year',s.year||'');setV('spec-segment',s.segment||'');setV('spec-country',s.country||'');setV('spec-trims',s.trims||'');setV('spec-gearbox',s.gearbox||'');setV('spec-topspeed',s.topspeed||'');setV('spec-trunk',s.trunk||'');setV('spec-consumption',s.consumption||'');setV('spec-emission',s.emission||'');if(s.pros&&s.pros.length)setV('spec-pros',s.pros.join('\n'));if(s.cons&&s.cons.length)setV('spec-cons',s.cons.join('\n'));if(s.cats){const map={נסיעה:'score-driving',עיצוב:'score-design',טכנולוגיה:'score-tech',נוחות:'score-comfort',ערך:'score-value'};s.cats.forEach(ct=>{const el=document.getElementById(map[ct.name]);if(el)el.value=ct.score;});}
toggleRangeField(s.engine||'בנזין');}
window.scrollTo({top:0});}
function extractYTVideoId(url){if(!url)return null;const m=url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);return m?m[1]:null;}
function loadYTEmbed(el,vid){el.innerHTML=`<iframe width="100%" height="100%" src="https://www.youtube.com/embed/${vid}?autoplay=1&rel=0" frameborder="0" allow="autoplay;encrypted-media;fullscreen" allowfullscreen style="border-radius:8px;"></iframe>`;el.style.cursor='default';el.onclick=null;}
async function deleteArticle(id){if(!confirm('למחוק את הכתבה לצמיתות?'))return;let deleted=false;if(sbClient){try{const{error}=await sbClient.from('articles').delete().eq('id',id);if(!error)deleted=true;}catch(e){}}
if(!deleted){try{const _t=await getAuthToken();if(_t){const r=await fetchT(SB_URL+'/rest/v1/articles?id=eq.'+id,{method:'DELETE',headers:{'apikey':SB_KEY,'Authorization':'Bearer '+_t,'Content-Type':'application/json','Prefer':'return=minimal'}});if(r.ok)deleted=true;}}catch(e){}}
if(!deleted){alert('שגיאה במחיקה — נסה שוב');return;}
deletedIds.add(id);saveDeletedIds();articles=articles.filter(a=>a.id!==id);saveLocal();buildHero();buildSections();try{buildBreakingTicker();}catch(e){}
renderAdminTable();alert('הכתבה נמחקה');}
function viewArticle(id){showHome();openArticle(id);}
function clearForm(){['a-title','a-sub','a-author','a-img','a-img-cap','a-score','a-body','a-flash-title','a-flash-text','a-read-time','a-tags','a-scheduled','yt-url-1','yt-url-2','body-img-1','body-img-cap-1','body-img-2','body-img-cap-2','body-img-3','body-img-cap-3','body-img-4','body-img-cap-4','body-img-5','body-img-cap-5','spec-power','spec-torque','spec-zero','spec-range','spec-price','spec-model','spec-year','spec-country','spec-trims','spec-topspeed','spec-trunk','spec-consumption','spec-pros','spec-cons','score-driving','score-design','score-tech','score-comfort','score-value'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});const specSec=document.getElementById('specs-section');if(specSec)specSec.style.display='none';delete document.getElementById('a-title').dataset.editId;delete document.getElementById('a-title').dataset.srcUid;try{spFlashWordCount();}catch(e){}document.getElementById('a-cat').value='local';document.querySelectorAll('input[name="extra-cat"]').forEach(cb=>{cb.checked=false;const lbl=cb.closest('label');if(lbl){lbl.classList.remove('active');lbl.style.background='';lbl.style.color='';lbl.style.borderColor='var(--border)';}});galleryImages=[];renderGalleryPreview();const us=document.getElementById('upload-status');if(us)us.textContent='';const tabBtn=document.querySelectorAll('.admin-tab')[0];if(tabBtn)tabBtn.textContent='+ כתבה חדשה';}
function doSearch(q){const res=document.getElementById('search-results');if(!res)return;if(!q||q.length<2){res.innerHTML='';return;}
const qq=q.trim().toLowerCase();const matches=articles.filter(a=>((a.title||'').toLowerCase().includes(qq)||(a.sub||'').toLowerCase().includes(qq)||(a.author||'').toLowerCase().includes(qq)||(a.tags||[]).some(t=>typeof t==='string'&&!t.startsWith('uid:')&&!t.startsWith('src:')&&t.toLowerCase().includes(qq)))).slice(0,8);if(!matches.length){res.innerHTML='<p style="color:var(--muted);font-size:0.85rem;padding:8px 0;">לא נמצאו תוצאות</p>';return;}
res.innerHTML=matches.map(a=>`<div onclick="document.getElementById('search-overlay').style.display='none';openArticle(${a.id})" role="option" tabindex="0" style="display:flex;gap:12px;padding:10px;border-radius:6px;cursor:pointer;align-items:center;" onmouseover="this.style.background='#f7f7f5'" onmouseout="this.style.background='none'" onkeydown="if(event.key==='Enter'){document.getElementById('search-overlay').style.display='none';openArticle(${a.id});}"><img src="${a.img||CAT_IMAGES[a.cat]}" style="width:56px;height:40px;object-fit:cover;border-radius:4px;" loading="lazy" alt="${a.title}"><div><div style="font-size:0.88rem;font-weight:600;margin-bottom:2px;">${a.title}</div><div style="font-size:0.72rem;color:var(--muted);">${CAT_LABELS[a.cat]||a.cat} · ${a.date}</div></div></div>`).join('');}
function toggleAccess(){const ov=document.getElementById('access-overlay');ov.classList.toggle('open');if(ov.classList.contains('open'))ov.querySelector('.acc-pill,button')?.focus();}
function accTogglePill(id){const btn=document.getElementById(id);if(btn)btn.classList.toggle('active');}
function setFontSize(size){document.body.classList.remove('large-text','larger-text','small-text');['fs-small','fs-normal','fs-large','fs-larger'].forEach(id=>{const b=document.getElementById(id);if(b){b.classList.remove('active');}});const map={small:'small-text',large:'large-text',larger:'larger-text'};if(map[size])document.body.classList.add(map[size]);const scales={small:'13px',normal:'16px',large:'18.5px',larger:'21px'};document.documentElement.style.fontSize=scales[size]||'16px';const bid={small:'fs-small',normal:'fs-normal',large:'fs-large',larger:'fs-larger'}[size];if(bid){const b=document.getElementById(bid);if(b)b.classList.add('active');}
try{localStorage.setItem('sp_fontSize',size);}catch(e){}}
function toggleDyslexia(){document.body.classList.toggle('dyslexia-font');accTogglePill('btn-dyslexia');try{localStorage.setItem('sp_dyslexia',document.body.classList.contains('dyslexia-font'));}catch(e){}}
function toggleContrast(){document.body.classList.remove('yellow-contrast');document.getElementById('btn-yellow')?.classList.remove('active');document.body.classList.toggle('high-contrast');accTogglePill('btn-contrast');try{localStorage.setItem('sp_contrast',document.body.classList.contains('high-contrast'));}catch(e){}}
function toggleYellow(){document.body.classList.remove('high-contrast','dark-mode','grayscale');['btn-contrast','btn-dark-access','btn-gray'].forEach(id=>document.getElementById(id)?.classList.remove('active'));document.body.classList.toggle('yellow-contrast');accTogglePill('btn-yellow');const di=document.getElementById('dark-icon');if(di)di.innerHTML='';try{localStorage.setItem('sp_yellow',document.body.classList.contains('yellow-contrast'));}catch(e){}}
function toggleGrayscale(){document.body.classList.toggle('grayscale');accTogglePill('btn-gray');try{localStorage.setItem('sp_gray',document.body.classList.contains('grayscale'));}catch(e){}}
function toggleLinks(){document.body.classList.toggle('highlight-links');accTogglePill('btn-links');try{localStorage.setItem('sp_links',document.body.classList.contains('highlight-links'));}catch(e){}}
function toggleHeadings(){document.body.classList.toggle('highlight-headings');accTogglePill('btn-headings');try{localStorage.setItem('sp_headings',document.body.classList.contains('highlight-headings'));}catch(e){}}
function toggleAnimations(){document.body.classList.toggle('no-animations');accTogglePill('btn-anim');try{localStorage.setItem('sp_noanim',document.body.classList.contains('no-animations'));}catch(e){}}
function skipToMain(){document.getElementById('home-page')?.scrollIntoView({behavior:'smooth'});toggleAccess();}
function skipToNav(){document.querySelector('nav')?.scrollIntoView({behavior:'smooth'});toggleAccess();}
function resetAll(){['large-text','larger-text','small-text','dyslexia-font','high-contrast','yellow-contrast','grayscale','highlight-links','highlight-headings','no-animations','dark-mode'].forEach(c=>document.body.classList.remove(c));document.querySelectorAll('.acc-pill').forEach(b=>b.classList.remove('active'));document.getElementById('fs-normal')?.classList.add('active');document.documentElement.style.fontSize='16px';const di=document.getElementById('dark-icon');if(di)di.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';const dl=document.getElementById('dark-label');if(dl)dl.textContent='מצב לילה';try{['sp_fontSize','sp_dark','sp_contrast','sp_yellow','sp_gray','sp_links','sp_headings','sp_noanim','sp_dyslexia'].forEach(k=>localStorage.removeItem(k));}catch(e){}}
function toggleDark(){document.body.classList.toggle('dark-mode');const isDark=document.body.classList.contains('dark-mode');document.getElementById('dark-icon').innerHTML=isDark?'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>':'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';const accBtn=document.getElementById('btn-dark-access');if(accBtn)accBtn.textContent=isDark?'כבה':'הפעל';try{localStorage.setItem('sp_dark',isDark);}catch(e){}}
function toggleSpecsSection(cat){const sec=document.getElementById('specs-section');if(sec)sec.style.display=(cat==='review')?'block':'none';const engineEl=document.getElementById('spec-engine');if(engineEl)toggleRangeField(engineEl.value);}
function toggleRangeField(engine){const rg=document.getElementById('spec-range-group');if(rg)rg.style.display=(engine==='חשמלי'||engine==='PHEV')?'flex':'none';const gb=document.getElementById('spec-gearbox-row');if(gb)gb.style.display=(engine==='חשמלי')?'none':'flex';}
document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.shiftKey&&e.key==='A'){e.preventDefault();openAdminLogin();}if(e.key==='Escape'){closeAdminLogin();document.getElementById('access-overlay').classList.remove('open');}});function toSlug(title){return title.replace(/[^\u0590-\u05FF\w\s-]/g,'').trim().replace(/\s+/g,'-').toLowerCase().slice(0,60);}
function getArticleUrl(a){return'/article/'+a.id+'/';}
function setupRealtimeSync(){if(!sbClient)return;try{let _rtTimer;const _rtSync=()=>{clearTimeout(_rtTimer);_rtTimer=setTimeout(()=>{if(!document.hidden)syncFromSupabase();},1500);};sbClient.channel('articles-changes').on('postgres_changes',{event:'INSERT',schema:'public',table:'articles'},_rtSync).on('postgres_changes',{event:'DELETE',schema:'public',table:'articles'},_rtSync).subscribe();}catch(e){}}
function previewArticle(){const title=document.getElementById('a-title').value.trim();const body=document.getElementById('a-body').value.trim();const img=document.getElementById('a-img').value.trim();const sub=document.getElementById('a-sub').value.trim();const author=document.getElementById('a-author').value.trim()||'מערכת ספידומטר';const cat=document.getElementById('a-cat').value;if(!title){alert('הזן כותרת כדי לצפות בתצוגה מקדימה');return;}
const previewData={id:99999,title,sub,cat,author,date:new Date().toLocaleDateString('he-IL'),img:img||CAT_IMAGES[cat],imgCaption:document.getElementById('a-img-cap').value.trim(),body,score:document.getElementById('a-score').value.trim()||null,readTime:document.getElementById('a-read-time').value.trim()||'3 דק׳ קריאה',views:0,featured:false};const existing=articles.find(a=>a.id===99999);if(existing)articles.splice(articles.indexOf(existing),1);articles.unshift(previewData);openArticle(99999);setTimeout(()=>{const banner=document.createElement('div');banner.id='preview-banner';banner.style.cssText='position:fixed;top:0;left:0;right:0;background:#f59e0b;color:#000;text-align:center;padding:8px;font-size:0.85rem;font-weight:700;z-index:9999;';banner.id='preview-banner';banner.innerHTML="👁 תצוגה מקדימה &nbsp; <button onclick=\"showAdmin();document.getElementById('preview-banner').remove()\" style=\"background:rgba(0,0,0,0.25);border:none;color:#fff;padding:3px 12px;border-radius:4px;cursor:pointer;font-family:inherit\">חזור לעריכה</button>";document.body.prepend(banner);},100);}
function toggleReadingMode(){document.body.classList.toggle('reading-mode');window.scrollTo({top:0,behavior:'smooth'});}
let isNavigating=false;window.addEventListener('popstate',function(e){window.scrollTo({top:0});if(isNavigating)return;isNavigating=true;setTimeout(()=>isNavigating=false,400);if(e.state&&e.state.page==='article'){openArticle(e.state.id,false);}else if(e.state&&e.state.page==='home'){showHome(false);if(e.state&&e.state.filter){currentFilter=e.state.filter;buildHero();buildSections();}}else{const path=window.location.pathname;const hash=window.location.hash;const _qid=parseInt(new URLSearchParams(window.location.search).get('article')||'');if(_qid&&articles.find(a=>a.id===_qid)){openArticle(_qid,false);}else if(path.startsWith('/article/')){const id=parseInt(path.replace('/article/','').split('-')[0]);if(id&&articles.find(a=>a.id===id))openArticle(id,false);else showHome(false);}else if(hash.startsWith('#article-')){const id=parseInt(hash.replace('#article-',''));if(id&&articles.find(a=>a.id===id))openArticle(id,false);else showHome(false);}else if(hash==='#admin177'){}else{showHome(false);}}});function slugify(title){return title.replace(/[^\u0590-\u05FF\w\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').trim().substring(0,60);}

function checkHashAdmin(){if(window.location.hash==='#admin177'){window.location.hash='';setTimeout(openAdminLogin,300);}}
window.addEventListener('hashchange',checkHashAdmin);checkHashAdmin();async function openAdminLogin(){try{if(window.__initSb)window.__initSb();if(sbClient){const{data}=await sbClient.auth.getSession();if(data&&data.session){showAdmin();return;}}}catch(e){}
document.getElementById('admin-login-overlay').style.display='flex';const _em=document.getElementById('admin-email-input');setTimeout(()=>{if(_em&&!_em.value)_em.focus();else document.getElementById('admin-pwd-input').focus();},100);document.getElementById('admin-pwd-err').textContent='';document.getElementById('admin-pwd-input').value='';}
function closeAdminLogin(){document.getElementById('admin-login-overlay').style.display='none';}
async function adminLogout(){try{if(sbClient)await sbClient.auth.signOut();}catch(e){}showHome();try{alert('התנתקת בהצלחה');}catch(e){}}
async function checkAdminPwd(){const errEl=document.getElementById('admin-pwd-err');const email=(document.getElementById('admin-email-input')?.value||'').trim();const pwd=document.getElementById('admin-pwd-input').value;if(!email||!pwd){if(errEl){errEl.style.color='var(--red)';errEl.textContent='נא להזין אימייל וסיסמה';}return;}
if(errEl){errEl.style.color='var(--muted)';errEl.textContent='מתחבר...';}
try{if(window.__initSb)window.__initSb();if(!sbClient){if(errEl){errEl.style.color='var(--red)';errEl.textContent='שגיאת חיבור לשרת';}return;}
const{data,error}=await sbClient.auth.signInWithPassword({email:email,password:pwd});
if(error||!data||!data.session){if(errEl){errEl.style.color='var(--red)';errEl.textContent='אימייל או סיסמה שגויים';}const pe=document.getElementById('admin-pwd-input');if(pe){pe.value='';pe.focus();}return;}
if(errEl)errEl.textContent='';closeAdminLogin();showAdmin();}catch(e){if(errEl){errEl.style.color='var(--red)';errEl.textContent='שגיאה בהתחברות';}}}
const NEWS_CATS=['local','world','electric','tech','buying'];async function aiSummarize(article){function cleanMd(t){return t.replace(/^[#>]+\s*/gm,'').replace(/\*\*(.*?)\*\*/g,'$1').replace(/[\n\r]+/g,' ').trim();}
var fullText=cleanMd([article.title,article.sub||'',article.body||''].join(' '));try{var res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:200,messages:[{role:'user',content:'אתה עורך חדשות רכב. צור: 1) כותרת עד 8 מילים 2) תקציר 30 מילים. ענה רק JSON: {"title":"...","summary":"..."}\n\nכתבה: '+fullText.slice(0,800)}]})});if(res.ok){var d=await res.json();var txt=((d.content&&d.content[0]&&d.content[0].text)||'').replace(/```json|```/g,'').trim();var p=JSON.parse(txt);if(p.title&&p.summary)return{title:p.title,summary:p.summary};}}catch(e){}
var titleW=cleanMd(article.title).split(' ').filter(Boolean);var subW=cleanMd(article.sub||'').split(' ').filter(Boolean);var bodyW=cleanMd(article.body||'').split(' ').filter(Boolean);var shortTitle=titleW.slice(0,8).join(' ');var pool=titleW.concat(subW).concat(bodyW);var summary30=pool.slice(0,30).join(' ')+(pool.length>30?' ...':'');return{title:shortTitle,summary:summary30};}
async function maybeAddQuickVersion(article){var ft=(document.getElementById('a-flash-title')?.value||'').trim();var fx=(document.getElementById('a-flash-text')?.value||'').trim();var hasManual=!!(ft&&fx);if(!hasManual)return;article.tags=article.tags||[];var presetUid=(document.getElementById('a-title')?.dataset.srcUid||'').trim()||article._uid||'';if(!presetUid){var uidTag=article.tags.find(function(t){return typeof t==='string'&&t.indexOf('uid:')===0;});if(uidTag)presetUid=uidTag.slice(4);}
if(!presetUid)presetUid='u'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);article._uid=presetUid;if(!article.tags.some(function(t){return t==='uid:'+presetUid;})){article.tags=article.tags.filter(function(t){return !(typeof t==='string'&&t.indexOf('uid:')===0);});article.tags.push('uid:'+presetUid);}
var title,summary;if(hasManual){title=ft;summary=fx;}else{var rr=await aiSummarize(article);title=rr.title;summary=rr.summary;}
var existing=articles.find(function(a){return a.cat==='quick'&&(a._srcUid===presetUid||a._sourceId===article.id);});if(existing){existing.title=title;existing.sub=summary;existing.body=summary;existing.img=article.img;existing.author=article.author;existing.date=article.date;existing.time=article.time;existing._srcUid=presetUid;existing._sourceId=article.id;existing.tags=['src:'+presetUid];saveLocal();buildHero();buildSections();buildTicker();buildBreakingTicker();try{await updateInSupabase(existing);}catch(e){}return;}
var quickArticle={id:nextId++,title:title,sub:summary,cat:'quick',author:article.author,date:article.date,time:article.time,readTime:'30 שניות',img:article.img,imgCaption:'',body:summary,score:null,views:0,featured:false,tags:['src:'+presetUid],_srcUid:presetUid,_sourceId:article.id};articles.unshift(quickArticle);saveLocal();buildHero();buildSections();buildTicker();buildBreakingTicker();try{await pushToSupabase(quickArticle);}catch(e){}}
function openModal(id){document.getElementById(id)?.classList.add('open');document.body.style.overflow='hidden';}
function closeModal(id){document.getElementById(id)?.classList.remove('open');document.body.style.overflow='';}
document.addEventListener('keydown',e=>{if(e.key==='Escape'){['about-modal','access-modal','privacy-modal','terms-modal'].forEach(id=>closeModal(id));document.getElementById('access-overlay')?.classList.remove('open');document.getElementById('admin-login-overlay').style.display='none';}});document.addEventListener('click',function(e){const overlay=document.getElementById('access-overlay');const btn=document.querySelector('.access-btn');if(overlay.classList.contains('open')&&!overlay.contains(e.target)&&e.target!==btn){overlay.classList.remove('open');}});window.addEventListener('scroll',()=>{document.getElementById('back-top')?.classList.toggle('visible',window.scrollY>400);document.querySelector('header')?.classList.toggle('scrolled',window.scrollY>60);});let resizeTimer;let _lastViewportW=window.innerWidth;window.addEventListener('resize',()=>{if(window.innerWidth===_lastViewportW)return;_lastViewportW=window.innerWidth;clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{handleMobileHero();},200);});function restorePrefs(){try{const sun='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';if(localStorage.getItem('sp_dark')==='true'){document.body.classList.add('dark-mode');const di=document.getElementById('dark-icon');if(di)di.innerHTML=sun;document.getElementById('btn-dark-access')?.classList.add('active');const dl=document.getElementById('dark-label');if(dl)dl.textContent='מצב יום';}
if(localStorage.getItem('sp_contrast')==='true'){document.body.classList.add('high-contrast');document.getElementById('btn-contrast')?.classList.add('active');}
if(localStorage.getItem('sp_gray')==='true'){document.body.classList.add('grayscale');document.getElementById('btn-gray')?.classList.add('active');}
if(localStorage.getItem('sp_yellow')==='true'){document.body.classList.add('yellow-contrast');document.getElementById('btn-yellow')?.classList.add('active');}
if(localStorage.getItem('sp_dyslexia')==='true'){document.body.classList.add('dyslexia-font');document.getElementById('btn-dyslexia')?.classList.add('active');}
if(localStorage.getItem('sp_links')==='true'){document.body.classList.add('highlight-links');document.getElementById('btn-links')?.classList.add('active');}
if(localStorage.getItem('sp_headings')==='true'){document.body.classList.add('highlight-headings');document.getElementById('btn-headings')?.classList.add('active');}
if(localStorage.getItem('sp_noanim')==='true'){document.body.classList.add('no-animations');document.getElementById('btn-anim')?.classList.add('active');}
const fs=localStorage.getItem('sp_fontSize');setFontSize(fs||'normal');}catch(e){document.getElementById('fs-normal')?.classList.add('active');}}
const ROBOTS_TXT=`User-agent: *
Allow: /
Disallow: /admin
Disallow: /?admin=true

Sitemap: https://speedometer10.co.il/sitemap.xml`;function generateSitemap(){const base='https://speedometer10.co.il/';const today=new Date().toISOString().split('T')[0];const urls=[`<url><loc>${base}</loc><lastmod>${today}</lastmod><priority>1.0</priority></url>`,...articles.filter(a=>a.cat!=='quick').map(a=>`<url><loc>${base}article/${a.id}/</loc><lastmod>${today}</lastmod><priority>0.8</priority></url>`)].join('\n  ');return`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  ${urls}\n</urlset>`;}
function downloadSitemap(){const blob=new Blob([generateSitemap()],{type:'application/xml'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='sitemap.xml';a.click();}
function downloadRobots(){const blob=new Blob([ROBOTS_TXT],{type:'text/plain'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='robots.txt';a.click();}
function updateMeta(a){const base='https://speedometer10.co.il/';const title=a.title+' | ספידומטר';const desc=a.sub||a.title;const img=a.img||'https://images.unsplash.com/photo-1555215695-3004980ad54e?w=1200&q=80';document.title=title;setOG('og:type','article');if(a.date)setMeta('article:published_time',spISODate(a.date));setMeta('article:author',a.author||'מערכת ספידומטר');setMeta('article:section',CAT_LABELS[a.cat]||a.cat);let can=document.querySelector('link[rel="canonical"]');if(!can){can=document.createElement('link');can.rel='canonical';document.head.appendChild(can);}
can.href='https://speedometer10.co.il/article/'+a.id+'/';let auth=document.querySelector('meta[name="author"]');if(!auth){auth=document.createElement('meta');auth.name='author';document.head.appendChild(auth);}
auth.content=a.author||'מערכת ספידומטר';let desc2=document.querySelector('meta[name="description"]');if(desc2)desc2.content=a.sub||a.title;setMeta('description',desc);setOG('og:title',title);setOG('og:description',desc);setOG('og:image',img);setOG('og:url','https://speedometer10.co.il/article/'+a.id+'/');setOG('og:type',a.cat==='review'?'article':'website');setMeta('twitter:title',title);setMeta('twitter:description',desc);setMeta('twitter:image',img);}
function setOG(prop,val){let el=document.querySelector('meta[property="'+prop+'"]');if(!el){el=document.createElement('meta');el.setAttribute('property',prop);document.head.appendChild(el);}
el.setAttribute('content',val);}
function setMeta(name,val){let el=document.querySelector('meta[name="'+name+'"]');if(!el){el=document.createElement('meta');el.setAttribute('name',name);document.head.appendChild(el);}
el.setAttribute('content',val);}
function resetMeta(){document.title='ספידומטר | רכב · טכנולוגיה · חדשנות';setOG('og:title','ספידומטר | רכב · טכנולוגיה · חדשנות');setOG('og:type','website');setOG('og:url','https://speedometer10.co.il/');setMeta('description','האתר המוביל בישראל לחדשות רכב, מבחני דרכים, רכב יוקרה וטכנולוגיה אוטומוטיב');const can2=document.querySelector('link[rel="canonical"]');if(can2)can2.href='https://speedometer10.co.il/';const auth2=document.querySelector('meta[name="author"]');if(auth2)auth2.content='מערכת ספידומטר';}
async function compressImage(file,maxKB=300){return new Promise(resolve=>{const img=new Image();const url=URL.createObjectURL(file);img.onload=()=>{let w=img.width,h=img.height;const MAX_DIM=1280;if(w>MAX_DIM||h>MAX_DIM){const ratio=Math.min(MAX_DIM/w,MAX_DIM/h);w=Math.round(w*ratio);h=Math.round(h*ratio);}
const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,w,h);let quality=0.85;const tryCompress=()=>{canvas.toBlob(blob=>{if(!blob){resolve(null);return;}
if(blob.size<=maxKB*1024||quality<0.3){resolve(new File([blob],file.name.replace(/\.[^.]+$/,'.webp'),{type:'image/webp'}));}else{quality-=0.08;tryCompress();}},'image/webp',quality);};tryCompress();URL.revokeObjectURL(url);};img.src=url;});}
async function uploadImageToSupabase(file){if(!sbClient)return null;const compressed=await compressImage(file);if(!compressed)return null;const fname=`articles/${Date.now()}_${compressed.name}`;try{const{data,error}=await sbClient.storage.from('speedometer-media').upload(fname,compressed,{upsert:true,contentType:'image/webp'});if(error){console.error('Upload error:',error);return null;}
const{data:pub}=sbClient.storage.from('speedometer-media').getPublicUrl(fname);return pub.publicUrl;}catch(e){console.error(e);return null;}}
async function handleImageUpload(input){const file=input.files[0];if(!file)return;const statusEl=document.getElementById('upload-status');const previewEl=document.getElementById('upload-preview');if(statusEl){statusEl.textContent='מדחס תמונה...';statusEl.style.color='var(--muted)';}
try{const compressed=await compressImageFile(file,150);if(!compressed){if(statusEl){statusEl.textContent='❌ לא ניתן לקרוא את התמונה. נסה לשמור/לצלם בפורמט JPG או PNG (במקום HEIC).';statusEl.style.color='var(--red)';}
input.value='';return;}
if(statusEl){statusEl.textContent='מעלה תמונה לאחסון...';statusEl.style.color='var(--muted)';}
let publicUrl=null;try{if(window.__initSb)window.__initSb();if(sbClient){const ext=(compressed.name.split('.').pop()||'webp').toLowerCase();const path=Date.now()+'-'+Math.random().toString(36).slice(2,8)+'.'+ext;const{error:upErr}=await sbClient.storage.from('article-images').upload(path,compressed,{contentType:compressed.type,upsert:false,cacheControl:'31536000'});if(!upErr){const{data}=sbClient.storage.from('article-images').getPublicUrl(path);publicUrl=data&&data.publicUrl?data.publicUrl:null;}}}catch(e){publicUrl=null;}
if(publicUrl){document.getElementById('a-img').value=publicUrl;if(previewEl)previewEl.innerHTML=`<img src="${publicUrl}" style="max-width:100%;max-height:160px;border-radius:6px;object-fit:cover;margin-top:8px;" alt="תצוגה מקדימה של התמונה הראשית">`;if(statusEl){statusEl.textContent='✅ הועלתה לאחסון ('+Math.round(compressed.size/1024)+'KB)';statusEl.style.color='#22c55e';}
input.value='';}else{const reader=new FileReader();reader.onload=e=>{const b64=e.target.result;document.getElementById('a-img').value=b64;if(previewEl)previewEl.innerHTML=`<img src="${b64}" style="max-width:100%;max-height:160px;border-radius:6px;object-fit:cover;margin-top:8px;" alt="תצוגה מקדימה של התמונה הראשית">`;if(statusEl){statusEl.textContent='⚠️ נשמרה מקומית (האחסון לא זמין עדיין)';statusEl.style.color='#f59e0b';}};reader.readAsDataURL(compressed);input.value='';}}catch(e){if(statusEl){statusEl.textContent='שגיאה — נסה שוב';statusEl.style.color='var(--red)';}
input.value='';}}
async function uploadImageOrBase64(compressed){if(!compressed)return null;try{if(window.__initSb)window.__initSb();if(sbClient){const ext=(compressed.name.split('.').pop()||'webp').toLowerCase();const path=Date.now()+'-'+Math.random().toString(36).slice(2,8)+'.'+ext;const{error:upErr}=await sbClient.storage.from('article-images').upload(path,compressed,{contentType:compressed.type,upsert:false,cacheControl:'31536000'});if(!upErr){const{data}=sbClient.storage.from('article-images').getPublicUrl(path);if(data&&data.publicUrl)return data.publicUrl;}}}catch(e){}
return await new Promise(res=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.onerror=()=>res(null);r.readAsDataURL(compressed);});}
async function handleBodyImgUpload(input,idx){const file=input.files[0];if(!file)return;const compressed=await compressImageFile(file,120);const url=await uploadImageOrBase64(compressed||null);const el=document.getElementById('body-img-'+idx);if(el&&url)el.value=url;input.value='';}
async function compressImageFile(file,maxKB=200,forceMime=null){const source=await decodeImageSource(file);if(!source)return null;let w=source.width,h=source.height;const MAX=900;if(w>MAX||h>MAX){const r=Math.min(MAX/w,MAX/h);w=Math.round(w*r);h=Math.round(h*r);}
const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');ctx.drawImage(source.img,0,0,w,h);if(source.close)source.close();const mime=forceMime?forceMime:(canvasSupportsWebp(canvas)?'image/webp':'image/jpeg');const ext=mime==='image/webp'?'.webp':'.jpg';return new Promise(resolve=>{let q=0.82;const tryCompress=()=>{canvas.toBlob(blob=>{if(!blob){resolve(null);return;}
if(blob.size<=maxKB*1024||q<0.25){resolve(new File([blob],(file.name||'image').replace(/\.[^.]+$/,'')+ext,{type:mime}));}else{q=Math.max(0.25,q-0.08);tryCompress();}},mime,q);};tryCompress();});}
function decodeImageSource(file){return new Promise(resolve=>{if(window.createImageBitmap){createImageBitmap(file).then(bmp=>resolve({img:bmp,width:bmp.width,height:bmp.height,close:()=>bmp.close&&bmp.close()})).catch(()=>fallbackImg());}else{fallbackImg();}
function fallbackImg(){const img=new Image();const url=URL.createObjectURL(file);img.onload=()=>{URL.revokeObjectURL(url);resolve({img,width:img.naturalWidth,height:img.naturalHeight});};img.onerror=()=>{URL.revokeObjectURL(url);resolve(null);};img.src=url;}});}
function canvasSupportsWebp(canvas){try{return canvas.toDataURL('image/webp').indexOf('data:image/webp')===0;}
catch(e){return false;}}
function updateCatBreadcrumbPreview(cat){const el=document.getElementById('cat-breadcrumb-preview');if(!el)return;const bcMap={local:'חדשות › חדשות מקומיות',world:'חדשות › חדשות עולמיות',review:'מבחנים › מבחני רכב',electric:'מדריכים › רכב חשמלי',tech:'מדריכים › טכנולוגיה ובטיחות',buying:'מדריכים › מדריך קניית רכב',sport:'מבחנים › רכב ספורט',luxury:'יוקרה › רכב יוקרה',quick:'חדשות › חדשות בקליק'};const path=bcMap[cat]||'חדשות › '+(CAT_LABELS[cat]||cat);el.innerHTML='תג הניווט: <strong>'+path+'</strong>';}
(function init(){restorePrefs();const local=loadLocal();const hasLocal=local&&local.length>0;if(hasLocal){articles=local.filter(a=>!deletedIds.has(a.id));nextId=Math.max(...articles.map(a=>a.id),0)+1;}
else if(Array.isArray(window.__PRELOADED_ARTICLES)&&window.__PRELOADED_ARTICLES.length>0){try{const _now=new Date();articles=window.__PRELOADED_ARTICLES.map(mapRow).filter(a=>!deletedIds.has(a.id)&&(!a.scheduledAt||new Date(a.scheduledAt)<=_now));if(articles.length>0)nextId=Math.max(...articles.map(a=>a.id),0)+1;}catch(e){articles=[];}}
const hasData=articles.length>0;
if(isStaticPrerender){const _hp=document.getElementById('home-page');if(_hp)_hp.style.display='none';const _ap=document.getElementById('article-page');if(_ap)_ap.style.display='block';}
if(!hasData){const skCard=()=>`<div class="skeleton-card"><div class="skeleton-img"></div><div class="skeleton-text"></div><div class="skeleton-text short"></div></div>`;const heroArea=document.getElementById('hero-area');if(heroArea)heroArea.innerHTML=`
      <div class="hero-grid" style="pointer-events:none;">
        <div class="hero-main" style="border-radius:8px;overflow:hidden;">
          <div class="skeleton-img" style="height:100%;min-height:220px;border-radius:0;"></div>
        </div>
        <div class="hero-side">
          <div class="skeleton-card" style="flex:1;">${skCard()}</div>
          <div class="skeleton-card" style="flex:1;">${skCard()}</div>
        </div>
      </div>`;const lg=document.getElementById('latest-grid');if(lg)lg.innerHTML=Array(6).fill(0).map(skCard).join('');}
if(hasData){buildHero();try{handleMobileHero();}catch(e){}setTimeout(function(){buildSections();buildTicker();buildBreakingTicker();try{document.querySelectorAll('.card-img img').forEach(function(img){if(img.complete){img.classList.add('loaded');var p=img.closest('.card-img');if(p)p.style.animation='none';}});}catch(e){}},0);}
if(!isStaticPrerender){showHome(false);}
function checkScheduledArticles(){const now=new Date();let changed=false;articles.forEach(a=>{if(a.scheduledAt&&new Date(a.scheduledAt)<=now){a.scheduledAt=null;a.date=now.toLocaleDateString('he-IL');a.time=now.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'});changed=true;if(sbClient)updateInSupabase(a).catch(()=>{});}});if(changed){saveLocal();buildHero();buildSections();buildTicker();buildBreakingTicker();renderAdminTable();}}
checkScheduledArticles();setInterval(checkScheduledArticles,60000);document.addEventListener('load',function(e){if(e.target.tagName==='IMG'){e.target.classList.add('loaded');const parent=e.target.closest('.card-img');if(parent)parent.style.animation='none';}},true);document.querySelectorAll('.card-img img').forEach(img=>{if(img.complete){img.classList.add('loaded');const p=img.closest('.card-img');if(p)p.style.animation='none';}});requestAnimationFrame(()=>handleMobileHero());
/* --- ניתוב בעת עליית האפליקציה ---
   סדר עדיפויות: /article/{id}/ (הצורה הנקייה, אינה נכתבת מעל) > ?article= (לאחור, מנורמל) > #article- (לאחור, מנורמל)
   "מנורמל" = מוחלף בכתובת הנקייה דרך replaceState, כדי שקישורים ישנים "יתרפאו" לכתובת הקנונית בלי ריענון.
   waitForArticleThenOpen בודק אם הנתונים כבר זמינים (במקרה הנפוץ - מ-localStorage), ופותח את הכתבה מיידית.
   אם לא, ממתין בפולינג קצר עד שה-sync מ-Supabase מסתיים, כדי לא להיתקע על delay קבוע ולא לפספס אם ה-sync היה מהיר/איטי מהצפוי. */
function waitForArticleThenOpen(id,maxWaitMs=6000,pushState=false){
  const start=Date.now();
  (function tick(){
    const found=articles.find(a=>a.id===id);
    if(found){openArticle(id,pushState);return;}
    if(Date.now()-start>=maxWaitMs){openArticle(id,pushState);return;} // נכשל למצוא בזמן - openArticle יציג מצב ריק/ינסה בכל מקרה
    setTimeout(tick,80);
  })();
}
function initRouter(){
  const initPath=window.location.pathname;
  const initHash=window.location.hash;
  const initParams=new URLSearchParams(window.location.search);
  const initQId=parseInt(initParams.get('article')||'');
  const initQCat=initParams.get('cat');

  if(isStaticPrerender&&directArticleId){
    // כתובת נקייה - זו הצורה הסופית, איננו נוגעים בה כלל.
    waitForArticleThenOpen(directArticleId);
  }else if(initQId){
    // קישור ישן בפורמט ?article= - ננרמל לכתובת הנקייה מבלי לרענן את הדף.
    try{window.history.replaceState({page:'article',id:initQId},'','/article/'+initQId+'/');}catch(e){}
    waitForArticleThenOpen(initQId);
  }else if(initQCat){
    setTimeout(()=>{try{filterCat(initQCat);}catch(e){}},900);
  }else if(initHash.startsWith('#article-')){
    const initId=parseInt(initHash.replace('#article-',''));
    if(initId){
      try{window.history.replaceState({page:'article',id:initId},'','/article/'+initId+'/');}catch(e){}
      waitForArticleThenOpen(initId);
    }
  }
}
/* קריטי: initRouter נדחה ב-setTimeout(0) ולא נקרא באופן סינכרוני.
   הסיבה: openArticle() ופונקציות נוספות שהוא קורא להן (למשל handleMobileHero)
   מפנות למשתנים שמוגדרים עם let/const מאוחר יותר בקובץ (_progressTop, heroBannerTimer וכו').
   קריאה סינכרונית הייתה גורמת ל-ReferenceError (Temporal Dead Zone) בכל פעם
   שmaitForArticleThenOpen מצליח לפתוח כתבה באופן מיידי מ-localStorage,
   כיוון שב-JS, אזכור של משתנה let/const לפני שורת ההגדרה שלו בקובץ זורק שגיאה -
   גם אם הקריאה התבצעה מתוך פונקציה, לא משנה היכן בקובץ הפונקציה עצמה הוגדרה.
   setTimeout(...,0) מבטיח שהריצה תתבצע רק אחרי שכל הסקריפט הסינכרוני הסתיים,
   כלומר אחרי שכל הצהרות ה-let/const כבר "רצו" - בלי לפגוע בתחושת המהירות
   (0 מילישניות אינן מורגשות), ובלי להחזיר את ה-delay הקבוע של 900ms שהיה קודם. */
setTimeout(initRouter,0);
syncFromSupabase();setInterval(maybeSyncFromSupabase,30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)maybeSyncFromSupabase();});setTimeout(async()=>{if(!sbClient)return;try{const{data,error}=await sbClient.from('articles').select('id').limit(1);if(!error&&(!data||data.length===0)){console.log('Supabase empty — pushing all articles...');for(const a of articles){await pushToSupabase(a);}
console.log('Done pushing',articles.length,'articles');}}catch(e){}},1500);})();function setBottomNav(el){document.querySelectorAll('.bottom-nav-item').forEach(b=>b.classList.remove('active'));if(el)el.classList.add('active');}
function updateReadingProgress(){var _bb=document.getElementById('art-back-btn');if(_bb){_bb.classList.toggle('show',window.scrollY>220&&document.body.classList.contains('article-open'));}const bar=document.getElementById('reading-progress');if(!bar)return;const ap=document.getElementById('article-page');if(!ap||ap.style.display==='none'){bar.style.width='0%';bar.style.display='none';return;}
bar.style.display='block';if(_progressTop===null)measureProgressBounds();if(_progressTop===null)return;const scrollTop=window.scrollY;const total=_progressBottom-_progressTop;const progress=scrollTop-_progressTop;const pct=total>0?Math.min(100,Math.max(0,(progress/total)*100)):0;if(_progressRaf)return;_progressRaf=requestAnimationFrame(()=>{_progressRaf=0;bar.style.width=pct+'%';});}
function measureProgressBounds(){const artBody=document.getElementById('art-body');if(!artBody){_progressTop=null;return;}
const title=document.getElementById('art-title');const bRect=artBody.getBoundingClientRect();const tRect=(title||artBody).getBoundingClientRect();_progressTop=tRect.top+window.scrollY-90;_progressBottom=bRect.bottom+window.scrollY-Math.min(280,Math.max(120,bRect.height*0.12));}
window.addEventListener('resize',()=>{_progressTop=null;},{passive:true});window.addEventListener('scroll',updateReadingProgress,{passive:true});function buildHeroBanner(){try{const wrap=document.getElementById('hero-banner-mobile');if(!wrap||wrap.style.display==='none')return;const _nowH=new Date();const _visH=articles.filter(a=>!a.scheduledAt||new Date(a.scheduledAt)<=_nowH);let pool=(currentFilter==='all'?_visH.filter(a=>a.cat!=='quick'):_visH.filter(a=>a.cat===currentFilter)).map(a=>Object.assign({},a,{img:(a.img&&a.img.length>5)?a.img:CAT_IMAGES[a.cat]||CAT_IMAGES['local']}));const _featIdx=pool.findIndex(a=>a.featured);if(_featIdx>0){pool.unshift(pool.splice(_featIdx,1)[0]);}pool=pool.slice(0,5);if(!pool.length){wrap.innerHTML='';return;}
heroBannerArticles=pool;heroBannerIdx=0;const n=pool.length;const extended=[pool[n-1],...pool,pool[0]];const startIdx=1;function _hbReadTime(a){
  if(a.readTime){const m=String(a.readTime).match(/\d+/);if(m)return m[0];}
  const words=(a.body||'').replace(/<[^>]+>/g,' ').trim().split(/\s+/).filter(Boolean).length;
  return String(Math.max(1,Math.round(words/200)));
}
const slideHTML=(a,i)=>{const timeStr=a.time?('<span class="hb3-sep">·</span><span class="hb3-when">'+escapeHtml(a.time)+'</span>'):'';return '<div class="hero-banner-slide" onclick="openArticle('+a.id+')" role="button" tabindex="0" data-id="'+a.id+'">'
+'<img src="'+heroSrc(a.img)+'"'+(heroSrcset(a.img)?' srcset="'+heroSrcset(a.img)+'" sizes="100vw"':'')+' alt="'+escapeHtml(a.title)+'" loading="'+(i===1?'eager':'lazy')+'" fetchpriority="'+(i===1?'high':'auto')+'" decoding="'+(i===1?'sync':'async')+'" width="850" height="500">'
+'<div class="hb3-fade" aria-hidden="true"></div>'
+'<div class="hb3-read">'+_hbReadTime(a)+'<span>דק\'</span></div>'
+'<div class="hb3-txt">'
+'<span class="hb3-cat">'+(CAT_LABELS[a.cat]||'')+'</span>'
+'<div class="hb3-title">'+escapeHtml(a.title)+'</div>'
+'<div class="hb3-meta"><span class="hb3-author">'+escapeHtml(a.author||'ספידומטר')+'</span><span class="hb3-sep">·</span><span class="hb3-when">'+escapeHtml(a.date||'')+'</span>'+timeStr+'</div>'
+'</div></div>';};
const slidesHTML=extended.map((a,i)=>slideHTML(a,i)).join('');const dotsHTML=pool.map((_,i)=>'<button class="hero-banner-dot'+(i===0?' active':'')+'" onclick="goHeroBanner('+i+')" aria-label="שקופית '+(i+1)+'"></button>').join('');wrap.innerHTML='<div class="hero-banner" id="hb-viewport">'+'<div class="hero-banner-track" id="hbt" style="direction:ltr;">'+slidesHTML+'</div>'+'</div>'+'<div class="hero-banner-dots">'+dotsHTML+'</div>';const viewport=document.getElementById('hb-viewport');const track=document.getElementById('hbt');if(!track||!viewport)return;heroBannerIdx=0;let _extIdx=startIdx;const _snapTo=(extIdx,animate)=>{const w=viewport.offsetWidth||window.innerWidth;requestAnimationFrame(()=>{track.style.transition=animate?'transform 0.35s cubic-bezier(0.25,0.46,0.45,0.94)':'none';track.style.transform='translateX('+(extIdx*-w)+'px)';});};_snapTo(_extIdx,false);const _updateDots=()=>{document.querySelectorAll('.hero-banner-dot').forEach((d,i)=>d.classList.toggle('active',i===heroBannerIdx));};track.addEventListener('transitionend',function(){const total=extended.length;if(_extIdx===0){_extIdx=n;_snapTo(_extIdx,false);}else if(_extIdx===total-1){_extIdx=1;_snapTo(_extIdx,false);}});let _sx=0,_sy=0,_dragging=false,_slideW=0,_lockedDir=null;viewport.addEventListener('touchstart',function(e){if(_extIdx===0){_extIdx=n;_snapTo(_extIdx,false);}else if(_extIdx===extended.length-1){_extIdx=1;_snapTo(_extIdx,false);}_slideW=viewport.offsetWidth;_sx=e.touches[0].clientX;_sy=e.touches[0].clientY;_dragging=false;_lockedDir=null;track.style.transition='none';},{passive:true});viewport.addEventListener('touchmove',function(e){const dx=e.touches[0].clientX-_sx;const dy=e.touches[0].clientY-_sy;if(!_lockedDir){if(Math.abs(dx)<5&&Math.abs(dy)<5)return;_lockedDir=Math.abs(dx)>=Math.abs(dy)?'h':'v';}
if(_lockedDir==='v')return;e.preventDefault();_dragging=true;const base=_extIdx*-_slideW;track.style.transform='translateX('+(base+dx)+'px)';},{passive:false});viewport.addEventListener('touchend',function(e){if(_dragging){const dx=e.changedTouches[0].clientX-_sx;if(dx<-_slideW*0.22){_extIdx++;heroBannerIdx=(heroBannerIdx+1)%n;}else if(dx>_slideW*0.22){_extIdx--;heroBannerIdx=(heroBannerIdx-1+n)%n;}else{_snapTo(_extIdx,true);_updateDots();_dragging=false;_lockedDir=null;return;}
_snapTo(_extIdx,true);_updateDots();}
_dragging=false;_lockedDir=null;},{passive:true});wrap._snapTo=_snapTo;wrap._getExtIdx=()=>_extIdx;wrap._setExtIdx=(v)=>{_extIdx=v;};wrap._updateDots=_updateDots;wrap._startIdx=startIdx;wrap._n=n;clearInterval(heroBannerTimer);}catch(e){console.log('Banner error:',e);}}
function _heroBannerSnap(poolIdx){const wrap=document.getElementById('hero-banner-mobile');if(!wrap||!wrap._snapTo)return;const n=wrap._n||heroBannerArticles.length;heroBannerIdx=((poolIdx%n)+n)%n;const extIdx=heroBannerIdx+1;wrap._setExtIdx(extIdx);wrap._snapTo(extIdx,true);wrap._updateDots();}
function moveHeroBanner(dir){_heroBannerSnap(heroBannerIdx+dir);}
function autoAdvanceBanner(){_heroBannerSnap(heroBannerIdx+1);}
function goHeroBanner(idx){_heroBannerSnap(idx);clearInterval(heroBannerTimer);}
let artSwipeSX=0,artSwipeSY=0;document.addEventListener('touchstart',e=>{if(document.getElementById('article-page').style.display!=='none'){artSwipeSX=e.touches[0].clientX;artSwipeSY=e.touches[0].clientY;}},{passive:true});document.addEventListener('touchend',e=>{const ap=document.getElementById('article-page');if(ap&&ap.style.display!=='none'){const dx=e.changedTouches[0].clientX-artSwipeSX;const dy=e.changedTouches[0].clientY-artSwipeSY;if(Math.abs(dx)>100&&Math.abs(dx)>Math.abs(dy)*2.5){const idx=articles.findIndex(a=>a.id===currentArticleId);if(dx<0&&idx<articles.length-1)openArticle(articles[idx+1].id);if(dx>0&&idx>0)openArticle(articles[idx-1].id);}}},{passive:true});async function nativeShare(){const a=articles.find(x=>x.id===currentArticleId);if(!a)return;if(navigator.share){try{await navigator.share({title:a.title,text:a.sub||a.title,url:window.location.href});return;}catch(e){}}
shareArticle('whatsapp');}
function handleMobileHero(){try{const isMobile=window.innerWidth<=680;const mb=document.getElementById('hero-banner-mobile');const dt=document.getElementById('hero-area');if(mb&&dt){if(isMobile){mb.style.display='block';dt.style.display='none';buildHeroBanner();}else{mb.style.display='none';dt.style.display='block';clearInterval(heroBannerTimer);}}}catch(e){console.log('handleMobileHero error:',e);}}
if('serviceWorker'in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js').catch(()=>{});});}

/* ─────────────────────────────── */


(function(){
  'use strict';
  function $(id){return document.getElementById(id);}

  /* ── #3 תפריט המבורגר (3 קווים → X) ── */
  function setHamburger(open){
    var h=$('sp-hamburger');if(!h)return;
    h.classList.toggle('active',open);
    h.setAttribute('aria-expanded',open?'true':'false');
    h.setAttribute('aria-label',open?'סגור תפריט':'פתח תפריט');
  }
  window.spToggleMenu=function(){
    var m=$('mobile-menu');if(!m)return;
    var willOpen=!m.classList.contains('open');
    m.classList.toggle('open',willOpen);
    setHamburger(willOpen);
    document.body.style.overflow=willOpen?'hidden':'';
    document.body.classList.toggle('sp-menu-open',willOpen);
    if(willOpen)spCloseCC();
  };
  /* סנכרון מצב ההמבורגר אם התפריט נסגר בדרך אחרת (כפתור סגירה / קישור) */
  (function(){
    var m=$('mobile-menu');if(!m)return;
    if(window.MutationObserver){
      var obs=new MutationObserver(function(){
        if(!m.classList.contains('open')){setHamburger(false);document.body.style.overflow='';document.body.classList.remove('sp-menu-open');}
      });
      obs.observe(m,{attributes:true,attributeFilter:['class']});
    }
    m.addEventListener('click',function(e){
      var a=e.target.closest?e.target.closest('a.mobile-nav-link'):null;
      if(a){m.classList.remove('open');}
    });
    document.addEventListener('click',function(e){
      if(!m.classList.contains('open'))return;
      var ham=$('sp-hamburger');
      if(m.contains(e.target)||(ham&&ham.contains(e.target)))return;
      m.classList.remove('open');
    });
  })();

  /* ── #3 פאנל זכוכית (Control Center) ── */
  function spCloseCC(){var p=$('sp-cc-panel');if(p)p.classList.remove('open');}
  window.spToggleCC=function(){var p=$('sp-cc-panel');if(p)p.classList.toggle('open');};
  document.addEventListener('click',function(e){
    var p=$('sp-cc-panel'),b=$('sp-cc-btn');
    if(!p||!p.classList.contains('open'))return;
    if(p.contains(e.target)||(b&&b.contains(e.target)))return;
    p.classList.remove('open');
  });
  document.addEventListener('keydown',function(e){if(e.key==='Escape')spCloseCC();});
  (function(){var p=$('sp-cc-panel');if(p)p.addEventListener('click',function(e){if(e.target.closest&&e.target.closest('a'))spCloseCC();});})();

  /* ── #7 שורת המבזקים מתחת לקרוסלה (מובייל בלבד); דסקטופ ללא שינוי ── */
  var ticker=document.querySelector('.breaking-ticker');
  var tickerOrigParent=null,tickerOrigNext=null;
  if(ticker){tickerOrigParent=ticker.parentNode;tickerOrigNext=ticker.nextSibling;}
  function placeTicker(){
    if(!ticker)return;
    if(window.innerWidth<=680){
      var banner=$('hero-banner-mobile');
      if(banner&&banner.parentNode&&ticker.previousElementSibling!==banner){
        banner.parentNode.insertBefore(ticker,banner.nextSibling);
      }
    }else if(tickerOrigParent&&ticker.parentNode!==tickerOrigParent){
      if(tickerOrigNext&&tickerOrigNext.parentNode===tickerOrigParent){
        tickerOrigParent.insertBefore(ticker,tickerOrigNext);
      }else{
        tickerOrigParent.appendChild(ticker);
      }
    }
  }
  var _tkT;
  window.addEventListener('resize',function(){clearTimeout(_tkT);_tkT=setTimeout(placeTicker,180);},{passive:true});
  placeTicker();
  setTimeout(placeTicker,800);
  setTimeout(placeTicker,2000);

  /* ── #7 כפתור הספידומטר → דף "חדשות בקליק" ── */
  window.spSpeedoGo=function(btn){
    try{
      if(btn&&!btn.classList.contains('rev')){
        btn.classList.add('rev');
        setTimeout(function(){if(btn)btn.classList.remove('rev');},1000);
      }
    }catch(e){}
    setTimeout(function(){
      if(window._spQuickBusy)return;window._spQuickBusy=true;
      try{
        document.documentElement.style.scrollBehavior='auto';
        try{showHome(true);}catch(e){}
        window.scrollTo(0,0);
        try{filterCat('quick');}catch(e){}
        window.scrollTo(0,0);
        document.documentElement.style.scrollBehavior='';
      }catch(e){}
      finally{setTimeout(function(){window._spQuickBusy=false;},300);}
    },200);
  };

  /* ── #3/#4/#5 ניהול תצוגה: דף "בקליק" = רק צ'אט; מבזקים במסך הבית בלבד ──
     הערה: currentFilter מוגדר ב-let ולכן אינו על window — לוכדים אותו דרך עטיפת הפונקציות */
  var spFilter='all', spInFilter=false;
  function spSyncUI(){
    var mobile=window.innerWidth<=680;
    document.body.classList.toggle('sp-quick', mobile && spFilter==='quick');
    document.body.classList.toggle('sp-hideticker', mobile && spFilter!=='all');
    if(mobile && spFilter==='all'){var tr=$('breaking-track');if(tr&&!tr.children.length&&typeof window.buildBreakingTicker==='function'){try{window.buildBreakingTicker();}catch(e){}}}
  }
  if(typeof window.filterCat==='function'){
    var _spFc=window.filterCat;
    window.filterCat=function(cat,el){
      if(cat==='quick'&&window.innerWidth>680){cat='all';el=null;}
      spFilter=cat;spInFilter=true;var r;try{r=_spFc.call(this,cat,el);}finally{spInFilter=false;}try{spSyncUI();}catch(e){}return r;};
  }
  if(typeof window.showHome==='function'){
    var _spSh=window.showHome;
    window.showHome=function(){if(!spInFilter)spFilter='all';var r=_spSh.apply(this,arguments);try{spSyncUI();}catch(e){}return r;};
  }
  if(typeof window.openArticle==='function'){
    var _spOa=window.openArticle;
    window.openArticle=function(){var r=_spOa.apply(this,arguments);try{spSyncUI();}catch(e){}return r;};
  }
  window.addEventListener('resize',function(){clearTimeout(window._spUiT);window._spUiT=setTimeout(spSyncUI,180);},{passive:true});
  window.addEventListener('popstate',function(){setTimeout(spSyncUI,60);});
  spSyncUI();
  setTimeout(spSyncUI,400);
  setTimeout(spSyncUI,1200);
})();
