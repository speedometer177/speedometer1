/* ═══════════════════════════════════════════════════════
   ספידומטר — מנוע ערכות נושא
   6 ערכות + עורך CSS Variables מלא + שמירה לגיטהאב
   ═══════════════════════════════════════════════════════ */
(function(){
'use strict';

const REPO   = 'speedometer177/speedometer1';
const FILE   = 'custom.css';
const BRANCH = 'main';
const STORAGE_KEY = 'sp_editor_token';
const THEME_KEY   = 'sp_active_theme';
const CUSTOM_KEY  = 'sp_custom_vars';

/* ════════════════════════════════════
   ערכות נושא
   ════════════════════════════════════ */
const THEMES = {

  classic: {
    name: 'ספידומטר קלאסי',
    emoji: '🏎️',
    desc: 'העיצוב המקורי — אדום, לבן, שחור',
    font: "'Rubik','Assistant',-apple-system,sans-serif",
    vars: {
      '--red':'#e8001d','--red-dark':'#c0001a','--red-light':'#fff0f2',
      '--black':'#0a0a0a','--ink':'#1a1a1a','--dark':'#222','--mid':'#555',
      '--muted':'#6f6f6f','--border':'#e8e8e8','--bg':'#f7f7f5','--white':'#ffffff',
      '--radius':'4px','--shadow':'0 2px 12px rgba(0,0,0,0.07)',
      '--shadow-hover':'0 8px 30px rgba(0,0,0,0.14)',
    },
    extra: ''
  },

  night: {
    name: 'מצב לילה',
    emoji: '🌙',
    desc: 'כהה ואלגנטי, עיניים נחות',
    font: "'Rubik','Assistant',-apple-system,sans-serif",
    vars: {
      '--red':'#ff2d44','--red-dark':'#e8001d','--red-light':'#2a0008',
      '--black':'#f0f0f0','--ink':'#e0e0e0','--dark':'#cccccc','--mid':'#aaaaaa',
      '--muted':'#888888','--border':'#2a2a2a','--bg':'#0f0f0f','--white':'#1a1a1a',
      '--radius':'6px','--shadow':'0 2px 16px rgba(0,0,0,0.5)',
      '--shadow-hover':'0 8px 32px rgba(0,0,0,0.7)',
    },
    extra: `body{background:#0f0f0f!important;color:#e0e0e0!important}
    .card{background:#1a1a1a!important;border-color:#2a2a2a!important}
    .header-inner{background:#111!important;border-color:#222!important}
    .section-title{color:#f0f0f0!important}
    .card-title{color:#f0f0f0!important}
    .breaking-ticker{background:#111!important}
    .cat-bar{background:#111!important;border-color:#222!important}
    .cat-bar-btn{color:#aaa!important}
    .cat-bar-btn.active{color:#ff2d44!important}
    .footer-inner,.site-footer{background:#0a0a0a!important;color:#888!important}`
  },

  sport: {
    name: 'ספורט כהה',
    emoji: '⚡',
    desc: 'אגרסיבי, אנרגטי, כתום-שחור',
    font: "'Rubik','Assistant',-apple-system,sans-serif",
    vars: {
      '--red':'#ff6a00','--red-dark':'#e55a00','--red-light':'#1a0d00',
      '--black':'#ffffff','--ink':'#f0f0f0','--dark':'#ddd','--mid':'#bbb',
      '--muted':'#999','--border':'#333','--bg':'#161616','--white':'#1e1e1e',
      '--radius':'8px','--shadow':'0 4px 20px rgba(255,106,0,0.2)',
      '--shadow-hover':'0 8px 36px rgba(255,106,0,0.4)',
    },
    extra: `body{background:#161616!important;color:#f0f0f0!important}
    .card{background:#1e1e1e!important;border-color:#333!important}
    .card:hover{border-color:#ff6a00!important}
    .header-inner{background:#111!important;border-bottom:2px solid #ff6a00!important}
    .site-logo{color:#fff!important}
    .section-title{color:#fff!important}
    .section-title::before,.section-title-bar{background:#ff6a00!important}
    .card-title{color:#f0f0f0!important}
    .breaking-ticker{background:#1a1a1a!important;border-bottom:2px solid #ff6a00!important}
    .cat-bar{background:#161616!important;border-color:#333!important}
    .cat-bar-btn.active{color:#ff6a00!important}
    .hero-banner-content{background:linear-gradient(to top,rgba(0,0,0,0.95) 0%,rgba(255,106,0,0.2) 70%,transparent 100%)!important}
    .footer-inner,.site-footer{background:#0d0d0d!important}`
  },

  premium: {
    name: 'פרימיום',
    emoji: '💎',
    desc: 'יוקרתי, זהב על שחור',
    font: "'Assistant','Rubik',-apple-system,sans-serif",
    vars: {
      '--red':'#c9a84c','--red-dark':'#a8893d','--red-light':'#1a1500',
      '--black':'#f5e6c0','--ink':'#e8d5a0','--dark':'#d4be82','--mid':'#b89c55',
      '--muted':'#8a7340','--border':'#2a2418','--bg':'#0d0b08','--white':'#1a1610',
      '--radius':'2px','--shadow':'0 4px 24px rgba(201,168,76,0.15)',
      '--shadow-hover':'0 8px 40px rgba(201,168,76,0.3)',
    },
    extra: `body{background:#0d0b08!important;color:#e8d5a0!important}
    .card{background:#1a1610!important;border:1px solid #2a2418!important}
    .card:hover{border-color:#c9a84c!important}
    .header-inner{background:#0d0b08!important;border-bottom:1px solid #2a2418!important}
    .section-title{color:#c9a84c!important;letter-spacing:0.05em}
    .section-title::before,.section-title-bar{background:#c9a84c!important}
    .card-title{color:#f5e6c0!important}
    .cat-tag{background:#c9a84c!important;color:#000!important}
    .breaking-ticker{background:#0d0b08!important;border-bottom:1px solid #2a2418!important}
    .cat-bar{background:#0d0b08!important;border-color:#2a2418!important}
    .cat-bar-btn.active{color:#c9a84c!important}
    .footer-inner,.site-footer{background:#080604!important;color:#8a7340!important}
    .hero-banner-content{background:linear-gradient(to top,rgba(0,0,0,0.95) 0%,rgba(201,168,76,0.1) 70%,transparent 100%)!important}`
  },

  minimal: {
    name: 'מינימל לבן',
    emoji: '⬜',
    desc: 'נקי, אוורירי, מקצועי',
    font: "'Assistant','Rubik',-apple-system,sans-serif",
    vars: {
      '--red':'#1a1a1a','--red-dark':'#000','--red-light':'#f5f5f5',
      '--black':'#1a1a1a','--ink':'#333','--dark':'#555','--mid':'#777',
      '--muted':'#999','--border':'#ebebeb','--bg':'#ffffff','--white':'#ffffff',
      '--radius':'0px','--shadow':'none',
      '--shadow-hover':'0 2px 12px rgba(0,0,0,0.08)',
    },
    extra: `body{background:#fff!important}
    .card{background:#fff!important;border:1px solid #ebebeb!important;border-radius:0!important}
    .card:hover{box-shadow:0 2px 12px rgba(0,0,0,0.08)!important;transform:none!important}
    .header-inner{background:#fff!important;border-bottom:1px solid #ebebeb!important}
    .cat-tag{background:#1a1a1a!important;color:#fff!important;border-radius:0!important}
    .breaking-ticker{background:#1a1a1a!important}
    .hero-banner-wrap{border-radius:0!important}
    .hero-banner-slide{border-radius:0!important}
    .hero-banner-slide img{border-radius:0!important}
    .section-title::before,.section-title-bar{background:#1a1a1a!important}
    .footer-inner,.site-footer{background:#f5f5f5!important;color:#555!important}`
  },

  sea: {
    name: 'ים תיכוני',
    emoji: '🌊',
    desc: 'כחול ים, רגוע ואמין',
    font: "'Rubik','Assistant',-apple-system,sans-serif",
    vars: {
      '--red':'#0066cc','--red-dark':'#0052a3','--red-light':'#e8f3ff',
      '--black':'#0a1628','--ink':'#1a2840','--dark':'#2a3850','--mid':'#4a6080',
      '--muted':'#6a8098','--border':'#dde8f0','--bg':'#f0f6fc','--white':'#ffffff',
      '--radius':'8px','--shadow':'0 2px 12px rgba(0,102,204,0.08)',
      '--shadow-hover':'0 8px 30px rgba(0,102,204,0.18)',
    },
    extra: `body{background:#f0f6fc!important}
    .header-inner{background:#fff!important;border-bottom:2px solid #0066cc!important}
    .section-title{color:#0a1628!important}
    .section-title::before,.section-title-bar{background:#0066cc!important}
    .cat-tag{background:#0066cc!important;color:#fff!important}
    .breaking-ticker{background:#0a1628!important;border-bottom:2px solid #0066cc!important}
    .cat-bar-btn.active{color:#0066cc!important;border-color:#0066cc!important}
    .card{background:#fff!important;border-color:#dde8f0!important}
    .card:hover{border-color:#0066cc!important}
    .footer-inner,.site-footer{background:#0a1628!important;color:#6a8098!important}
    .hero-banner-content{background:linear-gradient(to top,rgba(10,22,40,0.92) 0%,rgba(0,102,204,0.3) 70%,transparent 100%)!important}`
  }
};

/* ════════════════════════════════════
   בנייה והחלה של ערכת נושא
   ════════════════════════════════════ */
let _activeTheme = localStorage.getItem(THEME_KEY) || 'classic';
let _customVars  = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}');

function buildThemeCSS(themeKey, overrides){
  const t = THEMES[themeKey];
  if(!t) return '';
  const merged = Object.assign({}, t.vars, overrides||{});
  let css = `/* ═══ ספידומטר ערכת נושא: ${t.name} ═══ */\n:root {\n`;
  for(const [k,v] of Object.entries(merged)) css += `  ${k}: ${v};\n`;
  css += `  --font: ${t.font};\n}\n`;
  css += `body { font-family: ${t.font}; }\n`;
  css += (t.extra||'') + '\n';
  return css;
}

function applyTheme(themeKey, overrides, save){
  const css = buildThemeCSS(themeKey, overrides);
  let el = document.getElementById('sp-theme-css');
  if(!el){ el=document.createElement('style');el.id='sp-theme-css';document.head.appendChild(el); }
  el.textContent = css;
  _activeTheme = themeKey;
  if(save !== false){
    localStorage.setItem(THEME_KEY, themeKey);
    if(overrides) localStorage.setItem(CUSTOM_KEY, JSON.stringify(overrides));
  }
}

// החלה מיידית בטעינה
applyTheme(_activeTheme, _customVars, false);

/* ════════════════════════════════════
   GitHub save
   ════════════════════════════════════ */
async function saveThemeToGitHub(){
  const token = localStorage.getItem(STORAGE_KEY);
  if(!token){ showTokenDialog(); return; }

  const css = buildThemeCSS(_activeTheme, _customVars);
  const encoded = btoa(unescape(encodeURIComponent(css)));

  showToast('⏳ שומר לגיטהאב...');
  try{
    const infoRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}`,{
      headers:{'Authorization':'token '+token,'Accept':'application/vnd.github.v3+json'}
    });
    let sha;
    if(infoRes.ok){ const j=await infoRes.json(); sha=j.sha; }

    const body={message:`🎨 ערכת נושא: ${THEMES[_activeTheme]?.name||_activeTheme}`,content:encoded,branch:BRANCH};
    if(sha) body.sha=sha;

    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}`,{
      method:'PUT',
      headers:{'Authorization':'token '+token,'Content-Type':'application/json','Accept':'application/vnd.github.v3+json'},
      body:JSON.stringify(body)
    });
    if(res.ok) showToast('✅ נשמר! האתר יתעדכן תוך ~2 דקות');
    else{
      const e=await res.json();
      if(res.status===401){localStorage.removeItem(STORAGE_KEY);showTokenDialog();}
      else showToast('❌ שגיאה: '+(e.message||res.status));
    }
  }catch(e){ showToast('❌ שגיאת רשת'); }
}

function showTokenDialog(){
  let d=document.getElementById('sp-token-dlg');
  if(d){d.style.display='flex';return;}
  d=document.createElement('div');d.id='sp-token-dlg';
  d.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1000001;display:flex;align-items:center;justify-content:center;padding:20px;font-family:var(--font)';
  d.innerHTML=`<div style="background:#fff;border-radius:16px;padding:28px 24px;width:min(420px,96vw);direction:rtl">
    <h3 style="font-size:1.05rem;font-weight:900;margin:0 0 8px">חיבור לגיטהאב</h3>
    <p style="font-size:0.8rem;color:#666;margin:0 0 14px">צור <a href="https://github.com/settings/tokens/new?scopes=repo&description=Speedometer+Themes" target="_blank" style="color:#e8001d">Personal Access Token</a> עם הרשאת <code>repo</code></p>
    <input id="sp-tkn-inp" type="password" placeholder="ghp_..." style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #ddd;border-radius:9px;font-size:0.88rem;margin-bottom:10px;direction:ltr">
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="document.getElementById('sp-token-dlg').style.display='none'" style="padding:9px 16px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer">ביטול</button>
      <button onclick="(function(){const v=document.getElementById('sp-tkn-inp').value.trim();if(v){localStorage.setItem('${STORAGE_KEY}',v);document.getElementById('sp-token-dlg').style.display='none';saveThemeToGitHub();}})()" style="padding:9px 16px;background:#e8001d;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700">שמור</button>
    </div>
  </div>`;
  document.body.appendChild(d);
}

function showToast(msg,dur){
  let t=document.getElementById('sp-theme-toast');
  if(!t){t=document.createElement('div');t.id='sp-theme-toast';
    t.style.cssText='position:fixed;bottom:82px;left:50%;transform:translateX(-50%) translateY(20px);background:#222;color:#fff;padding:11px 20px;border-radius:10px;z-index:999999;font-size:0.87rem;font-family:var(--font);box-shadow:0 4px 20px rgba(0,0,0,0.3);opacity:0;transition:all 0.3s';
    document.body.appendChild(t);}
  t.textContent=msg;t.style.opacity='1';t.style.transform='translateX(-50%) translateY(0)';
  clearTimeout(t._t);t._t=setTimeout(()=>{t.style.opacity='0';t.style.transform='translateX(-50%) translateY(20px)';},dur||3500);
}

/* ════════════════════════════════════
   לוח הבקרה — UI
   ════════════════════════════════════ */
const VAR_GROUPS = [
  { label:'🎨 צבעים ראשיים', vars:[
    {key:'--red',       label:'צבע ראשי (אדום/מבטא)',  type:'color'},
    {key:'--red-dark',  label:'גוון כהה יותר',          type:'color'},
    {key:'--red-light', label:'גוון בהיר / רקע הדגשה', type:'color'},
    {key:'--black',     label:'טקסט ראשי',              type:'color'},
    {key:'--ink',       label:'טקסט משני',              type:'color'},
    {key:'--muted',     label:'טקסט מעומעם',            type:'color'},
    {key:'--border',    label:'גבולות / מפרידים',       type:'color'},
    {key:'--bg',        label:'רקע עמוד',               type:'color'},
    {key:'--white',     label:'רקע כרטיסים',           type:'color'},
  ]},
  { label:'📐 צורה ומרווחים', vars:[
    {key:'--radius',   label:'עיגול פינות',   type:'px', min:0, max:24},
  ]},
  { label:'🔤 גופן', vars:[
    {key:'--font', label:'גופן ראשי', type:'text'},
  ]},
];

function getCurVar(key){
  return getComputedStyle(document.documentElement).getPropertyValue(key).trim();
}

function buildVarControl(v){
  const cur = _customVars[v.key] || getCurVar(v.key);
  if(v.type==='color'){
    let hex=cur;
    try{const m=cur.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);if(m)hex='#'+[m[1],m[2],m[3]].map(x=>parseInt(x).toString(16).padStart(2,'0')).join('');}catch(e){}
    return `<div class="spt-var-row">
      <label>${v.label}</label>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="color" value="${hex.match(/^#[0-9a-f]{6}$/i)?hex:'#888888'}"
          oninput="window._sptSetVar('${v.key}',this.value);this.nextSibling.value=this.value"
          style="width:36px;height:32px;border:none;border-radius:7px;cursor:pointer;padding:2px;flex-shrink:0">
        <input type="text" value="${cur}" oninput="window._sptSetVar('${v.key}',this.value)"
          style="flex:1;padding:6px 8px;border:1.5px solid #e5e5e5;border-radius:8px;font-size:0.78rem;font-family:monospace;min-width:0">
      </div></div>`;
  }
  if(v.type==='px'){
    const num=parseFloat(cur)||0;
    return `<div class="spt-var-row">
      <label>${v.label} <span style="color:#aaa;font-weight:400">${cur}</span></label>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="range" min="${v.min||0}" max="${v.max||24}" step="1" value="${num}"
          oninput="const val=this.value+'px';this.nextSibling.value=val;window._sptSetVar('${v.key}',val)"
          style="flex:1;accent-color:#e8001d">
        <input type="text" value="${cur}" oninput="window._sptSetVar('${v.key}',this.value)"
          style="width:64px;padding:6px 8px;border:1.5px solid #e5e5e5;border-radius:8px;font-size:0.78rem;font-family:monospace;text-align:center">
      </div></div>`;
  }
  return `<div class="spt-var-row">
    <label>${v.label}</label>
    <input type="text" value="${cur}" oninput="window._sptSetVar('${v.key}',this.value)"
      style="width:100%;padding:7px 10px;border:1.5px solid #e5e5e5;border-radius:8px;font-size:0.78rem;font-family:monospace;box-sizing:border-box">
  </div>`;
}

function buildPanel(){
  const p=document.createElement('div');p.id='sp-theme-panel';
  p.innerHTML=`<style>
  #sp-theme-panel{position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:'Rubik','Assistant',sans-serif;direction:rtl}
  #sp-theme-inner{background:#fff;border-radius:20px;width:min(700px,96vw);max-height:92vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.3)}
  #sp-theme-head{background:linear-gradient(135deg,#0a0a0a,#2a2a2a);padding:18px 20px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
  #sp-theme-head h2{color:#fff;margin:0;font-size:1.1rem;font-weight:900}
  #sp-theme-close{background:rgba(255,255,255,0.12);border:none;color:#fff;border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:1.1rem;display:flex;align-items:center;justify-content:center}
  #sp-theme-tabs{display:flex;border-bottom:1px solid #eee;flex-shrink:0;overflow-x:auto}
  .spt-tab{padding:10px 18px;border:none;background:none;cursor:pointer;font-family:inherit;font-size:0.84rem;font-weight:700;color:#888;border-bottom:2px solid transparent;white-space:nowrap;transition:all 0.2s}
  .spt-tab.active{color:#e8001d;border-color:#e8001d}
  #sp-theme-body{overflow-y:auto;flex:1;padding:16px 18px 0}
  #sp-theme-foot{padding:12px 18px;border-top:1px solid #eee;display:flex;gap:10px;flex-shrink:0;flex-wrap:wrap}
  .spt-foot-btn{padding:10px 20px;border-radius:10px;border:none;font-family:inherit;font-weight:800;font-size:0.85rem;cursor:pointer;transition:all 0.2s}
  .spt-save{background:linear-gradient(135deg,#e8001d,#ff6a00);color:#fff;flex:1}
  .spt-reset{background:#f5f5f5;color:#333}
  .spt-export{background:#f0f4ff;color:#1a7adb}
  .spt-var-row{margin-bottom:12px}
  .spt-var-row label{display:block;font-size:0.74rem;font-weight:700;color:#555;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.03em}
  .spt-group-title{font-size:0.82rem;font-weight:900;color:#333;margin:14px 0 10px;padding-bottom:8px;border-bottom:1px solid #f0f0f0}

  /* ═══ כרטיסי ערכות נושא ═══ */
  .spt-theme-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}
  @media(max-width:500px){.spt-theme-grid{grid-template-columns:repeat(2,1fr)}}
  .spt-theme-card{border:2px solid #eee;border-radius:14px;padding:14px 12px;cursor:pointer;transition:all 0.22s;text-align:center;background:#fafafa;position:relative;overflow:hidden}
  .spt-theme-card:hover{border-color:#e8001d;transform:translateY(-2px);box-shadow:0 6px 20px rgba(232,0,29,0.12)}
  .spt-theme-card.active{border-color:#e8001d;background:#fff5f5}
  .spt-theme-card.active::after{content:'✓';position:absolute;top:8px;left:10px;background:#e8001d;color:#fff;border-radius:50%;width:18px;height:18px;font-size:0.7rem;display:flex;align-items:center;justify-content:center;font-weight:900}
  .spt-theme-emoji{font-size:1.8rem;margin-bottom:6px}
  .spt-theme-name{font-size:0.82rem;font-weight:800;color:#222;margin-bottom:3px}
  .spt-theme-desc{font-size:0.7rem;color:#888;line-height:1.4}
  .spt-preview{display:flex;gap:4px;margin-top:8px;justify-content:center}
  .spt-swatch{width:14px;height:14px;border-radius:3px;border:1px solid rgba(0,0,0,0.08)}
  </style>

  <div id="sp-theme-inner">
    <div id="sp-theme-head">
      <h2>🎨 מעצב ערכות נושא</h2>
      <button id="sp-theme-close" onclick="document.getElementById('sp-theme-panel').style.display='none'">✕</button>
    </div>
    <div id="sp-theme-tabs">
      <button class="spt-tab active" onclick="sptShowTab('themes',this)">ערכות נושא</button>
      <button class="spt-tab" onclick="sptShowTab('colors',this)">צבעים</button>
      <button class="spt-tab" onclick="sptShowTab('shape',this)">צורה וגופן</button>
      <button class="spt-tab" onclick="sptShowTab('preview',this)">תצוגה מקדימה</button>
    </div>
    <div id="sp-theme-body">
      <div id="spt-tab-themes">
        <div class="spt-group-title">בחר ערכת נושא</div>
        <div class="spt-theme-grid">
          ${Object.entries(THEMES).map(([key,t])=>`
          <div class="spt-theme-card ${key===_activeTheme?'active':''}" onclick="window._sptPickTheme('${key}',this)">
            <div class="spt-theme-emoji">${t.emoji}</div>
            <div class="spt-theme-name">${t.name}</div>
            <div class="spt-theme-desc">${t.desc}</div>
            <div class="spt-preview">
              ${Object.values(t.vars).filter(v=>v.startsWith('#')).slice(0,4).map(c=>`<div class="spt-swatch" style="background:${c}"></div>`).join('')}
            </div>
          </div>`).join('')}
        </div>
        <div class="spt-group-title">ערכת נושא מותאמת אישית</div>
        <p style="font-size:0.8rem;color:#888;margin:0 0 12px">בחר ערכה ואז ערוך פרטים בלשוניות הצבע/צורה כדי ליצור ערכה ייחודית.</p>
      </div>
      <div id="spt-tab-colors" style="display:none">
        ${VAR_GROUPS.filter(g=>g.label.includes('צבע')).map(g=>`
          <div class="spt-group-title">${g.label}</div>
          ${g.vars.map(buildVarControl).join('')}
        `).join('')}
      </div>
      <div id="spt-tab-shape" style="display:none">
        ${VAR_GROUPS.filter(g=>!g.label.includes('צבע')).map(g=>`
          <div class="spt-group-title">${g.label}</div>
          ${g.vars.map(buildVarControl).join('')}
        `).join('')}
        <div class="spt-group-title">⚙️ CSS מתקדם</div>
        <p style="font-size:0.78rem;color:#888;margin:0 0 8px">הוסף CSS מותאם אישית:</p>
        <textarea id="spt-custom-css" rows="6" placeholder=".card { border-radius: 16px; }" oninput="window._sptCustomCSS(this.value)"
          style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #e5e5e5;border-radius:10px;font-family:monospace;font-size:0.8rem;resize:vertical">${_customVars.__extra||''}</textarea>
      </div>
      <div id="spt-tab-preview" style="display:none">
        <div class="spt-group-title">תצוגה מקדימה — כרטיס כתבה</div>
        <div id="spt-preview-card" style="max-width:280px;margin:0 auto 16px">
          <div class="card" style="font-family:var(--font)">
            <div class="card-img" style="background:var(--border);height:140px;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:0.8rem">תמונה</div>
            <div style="padding:12px">
              <span class="cat-tag">קטגוריה</span>
              <div class="card-title" style="margin:8px 0 4px">כותרת כתבה לדוגמה עם טקסט ארוך יותר</div>
              <div class="card-excerpt" style="color:var(--muted);font-size:0.82rem">תיאור קצר של הכתבה שמראה את הסגנון הכללי של הטקסט...</div>
            </div>
          </div>
        </div>
        <div class="spt-group-title">פלטת צבעים פעילה</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
          ${Object.entries(THEMES.classic.vars).filter(([k,v])=>v.startsWith('#')).map(([k,v])=>`
          <div style="text-align:center">
            <div style="width:44px;height:44px;border-radius:8px;border:1px solid rgba(0,0,0,0.1);background:var(${k})"></div>
            <div style="font-size:0.6rem;color:#888;margin-top:3px">${k.replace('--','')}</div>
          </div>`).join('')}
        </div>
      </div>
    </div>
    <div id="sp-theme-foot">
      <button class="spt-foot-btn spt-reset" onclick="window._sptResetTheme()">↩ איפוס</button>
      <button class="spt-foot-btn spt-export" onclick="window._sptExportCSS()">⬇ ייצוא CSS</button>
      <button class="spt-foot-btn spt-save" onclick="saveThemeToGitHub()">💾 שמור לאתר החי</button>
    </div>
  </div>`;
  return p;
}

/* ════════════════════════════════════
   callbacks גלובליים
   ════════════════════════════════════ */
window.sptShowTab = function(name, btn){
  ['themes','colors','shape','preview'].forEach(t=>{
    const el=document.getElementById('spt-tab-'+t);
    if(el) el.style.display=t===name?'block':'none';
  });
  document.querySelectorAll('.spt-tab').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
};

window._sptPickTheme = function(key, card){
  document.querySelectorAll('.spt-theme-card').forEach(c=>c.classList.remove('active'));
  card.classList.add('active');
  _customVars = {};
  localStorage.setItem(CUSTOM_KEY, '{}');
  applyTheme(key, {});
  // רענון שדות צבע בלשוניות
  document.querySelectorAll('[oninput*="_sptSetVar"]').forEach(el=>{
    const m=el.getAttribute('oninput').match(/'(--[^']+)'/);
    if(!m)return;
    const val=_customVars[m[1]]||getCurVar(m[1]);
    if(el.type==='color'){try{let h=val;const rgb=val.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);if(rgb)h='#'+[rgb[1],rgb[2],rgb[3]].map(x=>parseInt(x).toString(16).padStart(2,'0')).join('');el.value=h.match(/^#[0-9a-f]{6}$/i)?h:'#888888';}catch(e){}}
    else el.value=val;
  });
  showToast(`${THEMES[key]?.emoji} ערכה "${THEMES[key]?.name}" הוחלה — לחץ "שמור לאתר" כדי לשמור`);
};

window._sptSetVar = function(key, val){
  _customVars[key] = val;
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(_customVars));
  document.documentElement.style.setProperty(key, val);
  // עדכון ה-theme CSS
  let el=document.getElementById('sp-theme-css');
  if(el) el.textContent = buildThemeCSS(_activeTheme, _customVars);
};

window._sptCustomCSS = function(css){
  _customVars.__extra = css;
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(_customVars));
  let el=document.getElementById('sp-theme-css');
  if(el) el.textContent = buildThemeCSS(_activeTheme, _customVars);
};

window._sptResetTheme = function(){
  _customVars = {};
  localStorage.setItem(CUSTOM_KEY, '{}');
  localStorage.setItem(THEME_KEY, 'classic');
  applyTheme('classic', {});
  const panel=document.getElementById('sp-theme-panel');
  if(panel){ panel.remove(); openThemePanel(); }
  showToast('↩ אופסה לעיצוב הקלאסי');
};

window._sptExportCSS = function(){
  const css = buildThemeCSS(_activeTheme, _customVars);
  const blob = new Blob([css],{type:'text/css'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'speedometer-theme.css';
  a.click();
};

/* ════════════════════════════════════
   פתיחת הפאנל
   ════════════════════════════════════ */
function openThemePanel(){
  const existing = document.getElementById('sp-theme-panel');
  if(existing){ existing.style.display='flex'; return; }
  const p = buildPanel();
  document.body.appendChild(p);
  p.addEventListener('click', e=>{ if(e.target===p) p.style.display='none'; });
}
window.openThemePanel = openThemePanel;

/* ════════════════════════════════════
   כפתור FAB
   ════════════════════════════════════ */
const fab = document.createElement('button');
fab.id = 'sp-theme-fab';
fab.title = 'עורך ערכות נושא';
fab.innerHTML = '🎨';
fab.style.cssText = 'position:fixed;bottom:70px;left:14px;width:46px;height:46px;border-radius:50%;background:linear-gradient(135deg,#e8001d,#ff6a00);color:#fff;border:none;cursor:pointer;font-size:1.25rem;z-index:99996;box-shadow:0 4px 18px rgba(232,0,29,0.4);display:flex;align-items:center;justify-content:center;transition:transform 0.2s';
fab.addEventListener('click', openThemePanel);
fab.addEventListener('mouseenter', ()=>fab.style.transform='scale(1.1)');
fab.addEventListener('mouseleave', ()=>fab.style.transform='scale(1)');
document.body.appendChild(fab);

console.log('🎨 ספידומטר ערכות נושא — לחץ על 🎨 כדי לפתוח');
})();
