/* ═══════════════════════════════════════════════════════════════
   ספידומטר — עורך עיצוב חי
   לחיצה על אלמנט → פאנל עריכה → שינויים חיים → שמירה לגיטהאב
   ═══════════════════════════════════════════════════════════════ */
(function(){
'use strict';

/* ─── קביעות ─── */
const REPO   = 'speedometer177/speedometer1';
const FILE   = 'custom.css';
const BRANCH = 'main';
const STORAGE_KEY = 'sp_editor_token';

/* ─── מפת אלמנטים הניתנים לעריכה ─── */
const EDITABLE = [
  { label:'כותרת ראשית',   sel:'.article-title',     props:['font-size','font-weight','line-height','color','letter-spacing'] },
  { label:'כותרת כרטיס',   sel:'.card-title',         props:['font-size','font-weight','line-height','color'] },
  { label:'תיאור כרטיס',   sel:'.card-excerpt',       props:['font-size','color','line-height'] },
  { label:'כרטיס',          sel:'.card',               props:['border-radius','background','box-shadow','border'] },
  { label:'תמונת כרטיס',   sel:'.card-img',           props:['border-radius'] },
  { label:'כותרת מדור',    sel:'.section-title',      props:['font-size','font-weight','color'] },
  { label:'תגית קטגוריה',  sel:'.cat-tag',            props:['font-size','border-radius','background','color','padding'] },
  { label:'גוף כתבה',      sel:'.article-body',       props:['font-size','line-height','color'] },
  { label:'ניווט עליון',   sel:'.header-inner',       props:['background','border-bottom','padding'] },
  { label:'כרטיסי Hero',   sel:'.hero-banner-content',props:['padding','font-size'] },
  { label:'ניווט קטגוריות',sel:'.cat-bar',            props:['background','border-bottom'] },
  { label:'כפתור ראשי',    sel:'.btn-primary, .spec-toggle',props:['background','border-radius','font-size','padding'] },
  { label:'רקע עמוד',      sel:'body',                props:['background','color'] },
];

/* ─── עזר: חישוב CSS מחושב על אלמנט ─── */
function getComputed(el, prop){
  try{ return window.getComputedStyle(el).getPropertyValue(prop).trim(); }
  catch(e){ return ''; }
}

/* ─── ה-custom.css הנוכחי (טעון מהאתר) ─── */
let _customCSS = '';
let _sha = '';  // SHA של הקובץ בגיטהאב (נדרש לעדכון)

async function loadCurrentCSS(){
  try{
    const r = await fetch('/custom.css?v='+Date.now());
    if(r.ok) _customCSS = await r.text();
  }catch(e){}
}

/* ─── החלת CSS חי ─── */
let _styleEl = null;
function applyLiveCSS(css){
  if(!_styleEl){
    _styleEl = document.createElement('style');
    _styleEl.id = 'sp-live-editor-css';
    document.head.appendChild(_styleEl);
  }
  _styleEl.textContent = css;
}

/* ─── ניהול שינויים ─── */
const _overrides = {}; // { 'sel|prop': 'value' }

function buildCSSFromOverrides(){
  const groups = {};
  for(const key in _overrides){
    const [sel, prop] = key.split('|||');
    if(!groups[sel]) groups[sel] = {};
    groups[sel][prop] = _overrides[key];
  }
  let css = '/* ספידומטר — עיצוב מותאם אישית */\n';
  for(const sel in groups){
    css += sel + ' { ';
    for(const prop in groups[sel]) css += prop+': '+groups[sel][prop]+'; ';
    css += '}\n';
  }
  return css;
}

function setOverride(sel, prop, value){
  if(value === '' || value === null){
    delete _overrides[sel+'|||'+prop];
  } else {
    _overrides[sel+'|||'+prop] = value;
  }
  const css = buildCSSFromOverrides();
  applyLiveCSS(css);
}

/* ─── שמירה לגיטהאב ─── */
async function saveToGitHub(){
  const token = localStorage.getItem(STORAGE_KEY);
  if(!token){ showTokenDialog(); return; }

  const css = buildCSSFromOverrides();
  const encoded = btoa(unescape(encodeURIComponent(css)));

  try{
    // קבלת SHA הנוכחי
    const infoRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}`, {
      headers:{ 'Authorization':'token '+token, 'Accept':'application/vnd.github.v3+json' }
    });
    let sha = undefined;
    if(infoRes.ok){ const j = await infoRes.json(); sha = j.sha; }

    // עדכון / יצירה
    const body = { message:'🎨 עדכון עיצוב מותאם אישית', content: encoded, branch: BRANCH };
    if(sha) body.sha = sha;

    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}`, {
      method:'PUT',
      headers:{ 'Authorization':'token '+token,'Content-Type':'application/json','Accept':'application/vnd.github.v3+json' },
      body: JSON.stringify(body)
    });

    if(res.ok){
      showToast('✅ נשמר! האתר יתעדכן תוך ~2 דקות');
    } else {
      const err = await res.json();
      if(res.status===401){ localStorage.removeItem(STORAGE_KEY); showTokenDialog(); }
      else showToast('❌ שגיאה: '+(err.message||res.status));
    }
  }catch(e){ showToast('❌ שגיאת רשת: '+e.message); }
}

/* ─── Toast הודעה ─── */
function showToast(msg){
  let t = document.getElementById('sp-editor-toast');
  if(!t){ t=document.createElement('div');t.id='sp-editor-toast';
    t.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#222;color:#fff;padding:12px 22px;border-radius:10px;z-index:999999;font-size:0.9rem;font-family:var(--font);box-shadow:0 4px 20px rgba(0,0,0,0.3);transition:opacity 0.3s';
    document.body.appendChild(t);}
  t.textContent=msg; t.style.opacity='1';
  clearTimeout(t._t); t._t=setTimeout(()=>t.style.opacity='0',3500);
}

/* ─── Token dialog ─── */
function showTokenDialog(){
  let d=document.getElementById('sp-token-dialog');
  if(d){d.style.display='flex';return;}
  d=document.createElement('div');d.id='sp-token-dialog';
  d.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1000001;display:flex;align-items:center;justify-content:center;padding:20px;font-family:var(--font)';
  d.innerHTML=`<div style="background:#fff;border-radius:16px;padding:28px 24px;width:min(440px,96vw);direction:rtl">
    <h3 style="font-size:1.1rem;font-weight:900;margin:0 0 8px">חיבור לגיטהאב</h3>
    <p style="font-size:0.83rem;color:#666;margin:0 0 16px">נדרש Personal Access Token עם הרשאת <code>contents:write</code> על הריפו.<br>
    <a href="https://github.com/settings/tokens/new?scopes=repo&description=ספידומטר+עורך" target="_blank" style="color:#e8001d">צור Token כאן ←</a></p>
    <input id="sp-token-inp" type="password" placeholder="ghp_..." style="width:100%;box-sizing:border-box;padding:10px 12px;border:1.5px solid #ddd;border-radius:10px;font-size:0.9rem;margin-bottom:12px;direction:ltr">
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button onclick="document.getElementById('sp-token-dialog').style.display='none'" style="padding:9px 18px;border:1.5px solid #ddd;border-radius:8px;background:#fff;cursor:pointer;font-size:0.87rem">ביטול</button>
      <button onclick="(function(){const v=document.getElementById('sp-token-inp').value.trim();if(v){localStorage.setItem('${STORAGE_KEY}',v);document.getElementById('sp-token-dialog').style.display='none';saveToGitHub();}})()" style="padding:9px 18px;background:#e8001d;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:0.87rem">שמור וסנכרן</button>
    </div>
  </div>`;
  document.body.appendChild(d);
}

/* ─── פאנל עריכה ─── */
let _panel = null, _activeEl = null, _activeDef = null;

function buildPropControl(el, sel, prop){
  const cur = getComputed(el, prop);
  const isColor = prop==='color'||prop==='background'||prop==='border-bottom'||prop==='border';
  const isSize  = prop.includes('size')||prop.includes('radius')||prop.includes('height')||prop.includes('spacing')||prop.includes('weight')||prop.includes('padding')||prop.includes('margin');

  const label = prop.replace(/-/g,' ');
  const key   = sel+'|||'+prop;

  if(isColor){
    // צבע — input color + text
    let hexVal = cur;
    try{
      const m=cur.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if(m) hexVal='#'+[m[1],m[2],m[3]].map(x=>parseInt(x).toString(16).padStart(2,'0')).join('');
    }catch(e){}
    return `<div class="sp-prop-row">
      <label>${label}</label>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="color" value="${hexVal.startsWith('#')?hexVal:'#ffffff'}"
          oninput="window._spEditorSet('${sel}','${prop}',this.value);this.nextElementSibling.value=this.value"
          style="width:34px;height:30px;border:none;border-radius:6px;cursor:pointer;padding:2px">
        <input type="text" value="${cur}" placeholder="${cur}"
          oninput="window._spEditorSet('${sel}','${prop}',this.value)"
          style="flex:1;padding:5px 8px;border:1.5px solid #e0e0e0;border-radius:7px;font-size:0.8rem;font-family:monospace">
      </div>
    </div>`;
  }

  if(isSize){
    // גודל — slider + text
    let num = parseFloat(cur)||0;
    const unit = cur.replace(num,'').trim()||'rem';
    const isRem=unit.includes('rem'); const isPx=unit.includes('px');
    const min=isRem?0.5:isPx?0:0, max=isRem?4:isPx?100:900, step=isRem?0.05:1;
    return `<div class="sp-prop-row">
      <label>${label} <span style="color:#aaa;font-size:0.75rem">${cur}</span></label>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="range" min="${min}" max="${max}" step="${step}" value="${num}"
          oninput="const v=this.value+'${unit}';this.nextElementSibling.value=v;window._spEditorSet('${sel}','${prop}',v)"
          style="flex:1;accent-color:#e8001d">
        <input type="text" value="${cur}" placeholder="${cur}"
          oninput="window._spEditorSet('${sel}','${prop}',this.value)"
          style="width:80px;padding:5px 8px;border:1.5px solid #e0e0e0;border-radius:7px;font-size:0.8rem;font-family:monospace">
      </div>
    </div>`;
  }

  // ברירת מחדל — שדה טקסט
  return `<div class="sp-prop-row">
    <label>${label}</label>
    <input type="text" value="${cur}" placeholder="${cur}"
      oninput="window._spEditorSet('${sel}','${prop}',this.value)"
      style="width:100%;padding:7px 10px;border:1.5px solid #e0e0e0;border-radius:8px;font-size:0.82rem;font-family:monospace;box-sizing:border-box">
  </div>`;
}

function openPanel(def, el){
  _activeEl=el; _activeDef=def;
  let p=document.getElementById('sp-live-panel');
  if(!p){
    p=document.createElement('div');p.id='sp-live-panel';
    p.innerHTML=`<style>
      #sp-live-panel{position:fixed;left:0;top:50%;transform:translateY(-50%);width:min(280px,92vw);max-height:82vh;overflow-y:auto;background:#fff;border-radius:0 16px 16px 0;box-shadow:4px 0 30px rgba(0,0,0,0.18);z-index:99998;font-family:'Rubik','Assistant',sans-serif;direction:rtl;transition:transform 0.25s cubic-bezier(0.4,0,0.2,1)}
      #sp-live-panel.collapsed{transform:translateY(-50%) translateX(-260px)}
      #sp-panel-head{display:flex;align-items:center;justify-content:space-between;padding:14px 14px 10px;border-bottom:1px solid #f0f0f0;background:linear-gradient(135deg,#e8001d,#ff6a00);border-radius:0 16px 0 0}
      #sp-panel-head h4{margin:0;font-size:0.95rem;font-weight:900;color:#fff}
      #sp-panel-body{padding:12px 12px 80px}
      .sp-prop-row{margin-bottom:12px}
      .sp-prop-row label{display:block;font-size:0.75rem;font-weight:700;color:#555;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.04em}
      #sp-panel-toggle{background:none;border:none;color:#fff;cursor:pointer;font-size:1.1rem;padding:2px 6px;border-radius:6px}
      #sp-panel-footer{position:sticky;bottom:0;background:#fff;padding:10px 12px 12px;border-top:1px solid #f0f0f0;display:flex;gap:8px}
      .sp-btn{flex:1;padding:9px;border:none;border-radius:9px;font-family:inherit;font-weight:800;font-size:0.82rem;cursor:pointer}
      .sp-btn-save{background:linear-gradient(135deg,#e8001d,#ff6a00);color:#fff}
      .sp-btn-reset{background:#f5f5f5;color:#333}
      #sp-sel-select{width:100%;padding:7px 10px;border:1.5px solid #e8e8e8;border-radius:9px;font-family:inherit;font-size:0.82rem;margin-bottom:10px;direction:rtl;box-sizing:border-box}
    </style>
    <div id="sp-panel-head">
      <h4 id="sp-panel-title">עורך עיצוב</h4>
      <button id="sp-panel-toggle" onclick="document.getElementById('sp-live-panel').classList.toggle('collapsed')" title="קפל/פתח">◀</button>
    </div>
    <div id="sp-panel-body"></div>
    <div id="sp-panel-footer">
      <button class="sp-btn sp-btn-reset" onclick="window._spEditorReset()">איפוס</button>
      <button class="sp-btn sp-btn-save" onclick="saveToGitHub()">💾 שמור לאתר</button>
    </div>`;
    document.body.appendChild(p);
  }

  document.getElementById('sp-panel-title').textContent=def.label;

  // בניית select לבחירת אלמנט
  const selHTML=`<select id="sp-sel-select" onchange="window._spEditorChangeSel(this.value)">
    ${EDITABLE.map(d=>`<option value="${d.sel}" ${d.sel===def.sel?'selected':''}>${d.label}</option>`).join('')}
  </select>`;

  // בניית שדות
  const controls=def.props.map(prop=>buildPropControl(el, def.sel, prop)).join('');
  document.getElementById('sp-panel-body').innerHTML=selHTML+controls;
  p.classList.remove('collapsed');
}

/* ─── callbacks גלובליים ─── */
window._spEditorSet = function(sel,prop,val){ setOverride(sel,prop,val); };
window._spEditorReset = function(){
  if(!_activeDef)return;
  _activeDef.props.forEach(p=>setOverride(_activeDef.sel,p,''));
  if(_activeEl) openPanel(_activeDef,_activeEl);
};
window._spEditorChangeSel = function(newSel){
  const def=EDITABLE.find(d=>d.sel===newSel);
  if(!def)return;
  const el=document.querySelector(newSel);
  if(el) openPanel(def,el);
};

/* ─── highlight בהover ─── */
let _hlEl=null;
const _hlStyle=document.createElement('style');
_hlStyle.textContent='.sp-editor-active{outline:2px dashed #e8001d!important;outline-offset:2px!important;cursor:crosshair!important}';
document.head.appendChild(_hlStyle);

let _editorOn=false;

function toggleEditor(){
  _editorOn=!_editorOn;
  const btn=document.getElementById('sp-editor-fab');
  if(btn) btn.style.background=_editorOn?'linear-gradient(135deg,#e8001d,#ff6a00)':'#222';
  if(!_editorOn){
    if(_hlEl) _hlEl.classList.remove('sp-editor-active');
    const p=document.getElementById('sp-live-panel');
    if(p) p.classList.add('collapsed');
  }
}

document.addEventListener('mouseover',function(e){
  if(!_editorOn)return;
  if(e.target.closest('#sp-live-panel')||e.target.closest('#sp-editor-fab')||e.target.closest('#sp-token-dialog'))return;
  if(_hlEl) _hlEl.classList.remove('sp-editor-active');
  _hlEl=e.target;
  _hlEl.classList.add('sp-editor-active');
},true);

document.addEventListener('click',function(e){
  if(!_editorOn)return;
  if(e.target.closest('#sp-live-panel')||e.target.closest('#sp-editor-fab')||e.target.closest('#sp-token-dialog'))return;
  e.preventDefault(); e.stopPropagation();
  const el=e.target;
  // מציאת ה-def המתאים לפי ספציפיות
  let best=null;
  EDITABLE.forEach(def=>{
    if(el.closest(def.sel)||el.matches(def.sel)){
      if(!best) best=def;
    }
  });
  if(!best){
    // fallback — מציאת הכי קרוב
    best={ label:el.tagName.toLowerCase()+(el.className?' .'+el.className.split(' ')[0]:''),
           sel:el.tagName.toLowerCase()+(el.className?'.'+el.className.split(' ')[0]:''),
           props:['font-size','color','background','padding','margin','border-radius'] };
  }
  const target=el.closest(best.sel)||el;
  openPanel(best,target);
},true);

/* ─── FAB כפתור ─── */
const fab=document.createElement('button');
fab.id='sp-editor-fab';
fab.innerHTML='🎨';
fab.title='עורך עיצוב חי';
fab.style.cssText='position:fixed;bottom:70px;left:12px;width:44px;height:44px;border-radius:50%;background:#222;color:#fff;border:none;cursor:pointer;font-size:1.3rem;z-index:99997;box-shadow:0 4px 16px rgba(0,0,0,0.3);transition:background 0.25s,transform 0.2s;display:flex;align-items:center;justify-content:center';
fab.addEventListener('click',toggleEditor);
document.body.appendChild(fab);

/* ─── טעינה ─── */
loadCurrentCSS().then(()=>{
  if(_customCSS) applyLiveCSS(_customCSS);
});

// טעינת overrides קיימים מ-localStorage
try{
  const saved=JSON.parse(localStorage.getItem('sp_editor_overrides')||'{}');
  Object.assign(_overrides,saved);
  if(Object.keys(_overrides).length) applyLiveCSS(buildCSSFromOverrides());
}catch(e){}

// שמירה ב-localStorage בכל שינוי
const _origSet=setOverride;
window.setOverride=function(sel,prop,val){
  _origSet(sel,prop,val);
  try{localStorage.setItem('sp_editor_overrides',JSON.stringify(_overrides));}catch(e){}
};

console.log('🎨 ספידומטר עורך עיצוב — לחץ על 🎨 כדי להפעיל');
})();
