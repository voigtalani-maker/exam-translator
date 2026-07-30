/* ================= Exam Paper Translator ================= */
/* All processing is free: PDF.js (read) + glossary + MyMemory (translate) + docx.js (build). */

const SUPABASE_URL = 'https://hontxqtggrvxybamqrnh.supabase.co';
const SUPABASE_KEY = 'sb_publishable__gdf9hPZ-q7LUOkpcwkyLg_6wUW0N3y';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

const SUBJECTS = ['Physics','Chemistry','Geography','Mathematics','Life Sciences'];
const GRADES   = ['8','9','10','11','12'];
const TYPES    = ['Term Test','Exam','Prelim','Final Exam','Homework','Other'];
const PERIODS  = ['March','June','September','November'];

let GLOSSARY = [];          // {en, af, subject, source, owner, id}
let SESSION_USER = null;
let CURRENT = null;         // active paper being worked on

/* ---------------- tiny helpers ---------------- */
const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
const el = (t,c,html)=>{const e=document.createElement(t); if(c)e.className=c; if(html!=null)e.innerHTML=html; return e;};
const esc = s => (s==null?'':String(s)).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));

function toast(msg, kind){
  const t = el('div','toast'+(kind?(' '+kind):''), esc(msg));
  $('#toastHost').appendChild(t);
  setTimeout(()=>{t.style.opacity='0';t.style.transition='.4s';setTimeout(()=>t.remove(),400);}, kind==='err'?4500:2800);
}

function modal(title, bodyEl, onOk, okLabel='Save'){
  const host = el('div','modal-host');
  const m = el('div','modal');
  m.appendChild(el('h3',null,esc(title)));
  m.appendChild(bodyEl);
  const foot = el('div','foot');
  const cancel = el('button','btn ghost','Cancel');
  const ok = el('button','btn',esc(okLabel));
  cancel.onclick = ()=>host.remove();
  ok.onclick = async ()=>{ const keep = await onOk(); if(keep!==false) host.remove(); };
  foot.append(cancel, ok); m.appendChild(foot); host.appendChild(m);
  host.addEventListener('mousedown', e=>{ if(e.target===host) host.remove(); });
  $('#modalRoot').appendChild(host);
  const first = m.querySelector('input,select,textarea'); if(first) first.focus();
  return host;
}
function fillSelect(sel, values, {all=null, current=''}={}){
  sel.innerHTML='';
  if(all!==null) sel.appendChild(new Option(all, ''));
  values.forEach(v=>sel.appendChild(new Option(v, v)));
  sel.value = current;
}

/* ---------------- auth (single fixed login: username -> internal email) ---------------- */
const AUTH_DOMAIN = '@exam-translator.app';
function usernameToEmail(u){ return u.includes('@') ? u : (u.toLowerCase()+AUTH_DOMAIN); }
async function doAuth(){
  const user = $('#authEmail').value.trim();
  const pass = $('#authPass').value;
  const errBox = $('#authErr');
  errBox.classList.add('hidden');
  if(!user || !pass){ errBox.textContent='Please enter your username and password.'; errBox.classList.remove('hidden'); return; }
  $('#authBtn').disabled = true;
  try{
    const { error } = await sb.auth.signInWithPassword({ email: usernameToEmail(user), password: pass });
    if(error) throw error;
  }catch(e){
    errBox.textContent = 'Wrong username or password.';
    errBox.classList.remove('hidden');
  }finally{ $('#authBtn').disabled=false; }
}

async function onSession(session){
  if(session && session.user){
    SESSION_USER = session.user;
    $('#screen-auth').classList.add('hidden');
    $('#topbar').classList.remove('hidden');
    $('#app').classList.remove('hidden');
    $('#whoEmail').textContent = session.user.email;
    initFormSelects();      // synchronous — fill dropdowns first, before any network call
    nav('library');         // show + load the library
    await loadGlossary();   // glossary for translation (safe now: runs outside the auth lock)
  }else{
    SESSION_USER = null;
    $('#screen-auth').classList.remove('hidden');
    $('#topbar').classList.add('hidden');
    $('#app').classList.add('hidden');
  }
}

/* ---------------- navigation ---------------- */
function nav(name){
  ['library','new','glossary'].forEach(n=>{
    $('#screen-'+n).classList.toggle('hidden', n!==name);
  });
  $$('.topbar nav button').forEach(b=>b.classList.toggle('active', b.dataset.nav===name));
  if(name==='new') resetWorkflow();
  if(name==='glossary') renderGlossary();
  if(name==='library') loadLibrary();
}

/* ---------------- glossary ---------------- */
async function loadGlossary(){
  const { data, error } = await sb.from('ext_glossary').select('*').order('en');
  if(error){ toast('Could not load glossary: '+error.message,'err'); return; }
  GLOSSARY = data||[];
}
function glossaryExact(text, dir){
  const key = text.trim().toLowerCase();
  if(!key) return null;
  for(const g of GLOSSARY){
    if(dir==='en_af' && g.en.trim().toLowerCase()===key) return g.af;
    if(dir==='af_en' && g.af.trim().toLowerCase()===key) return g.en;
  }
  return null;
}
function glossaryHints(text, dir){
  const low = ' '+text.toLowerCase()+' ';
  const hits = [];
  for(const g of GLOSSARY){
    const src = (dir==='en_af'?g.en:g.af).trim();
    if(src.length<3) continue;
    if(low.includes(' '+src.toLowerCase()+' ') || low.includes(' '+src.toLowerCase()+',')){
      hits.push(src+' → '+(dir==='en_af'?g.af:g.en));
    }
    if(hits.length>=5) break;
  }
  return hits;
}

function renderGlossary(){
  fillSelect($('#gSubjectFilter'), ['General',...SUBJECTS], {all:'All subjects', current:$('#gSubjectFilter').value});
  const q = ($('#gSearch').value||'').toLowerCase();
  const subj = $('#gSubjectFilter').value;
  const body = $('#glossBody'); body.innerHTML='';
  const rows = GLOSSARY.filter(g=>{
    if(subj && (g.subject||'')!==subj) return false;
    if(q && !(g.en.toLowerCase().includes(q)||g.af.toLowerCase().includes(q))) return false;
    return true;
  });
  if(!rows.length){ body.innerHTML='<tr><td colspan="5" class="muted" style="padding:20px;text-align:center">No terms match.</td></tr>'; return; }
  rows.forEach(g=>{
    const tr = el('tr');
    const mine = g.owner === (SESSION_USER&&SESSION_USER.id);
    tr.innerHTML = `<td>${esc(g.en)}</td><td>${esc(g.af)}</td><td>${esc(g.subject||'')}</td>
      <td><span class="pill ${g.source==='user'?'ok':'grey'}">${g.source==='user'?'confirmed':'starter'}</span></td>`;
    const act = el('td','act');
    const edit = el('button','btn ghost sm','Edit');
    edit.onclick = ()=>termModal(g);
    act.appendChild(edit);
    if(mine){
      const del = el('button','btn danger sm','Delete'); del.style.marginLeft='6px';
      del.onclick = ()=>deleteTerm(g);
      act.appendChild(del);
    }
    tr.appendChild(act); body.appendChild(tr);
  });
}
function termModal(existing){
  const b = el('div');
  b.innerHTML = `
    <div class="fldwrap" style="margin-bottom:12px"><label class="fld">English</label><input id="tEn" type="text" value="${esc(existing?existing.en:'')}"></div>
    <div class="fldwrap" style="margin-bottom:12px"><label class="fld">Afrikaans</label><input id="tAf" type="text" value="${esc(existing?existing.af:'')}"></div>
    <div class="fldwrap"><label class="fld">Subject</label><select id="tSub"></select></div>`;
  fillSelect(b.querySelector('#tSub'), ['General',...SUBJECTS], {current: existing?existing.subject:'General'});
  modal(existing?'Edit term':'Add term', b, async ()=>{
    const en=b.querySelector('#tEn').value.trim(), af=b.querySelector('#tAf').value.trim(), sub=b.querySelector('#tSub').value;
    if(!en||!af){ toast('Both English and Afrikaans are required.','err'); return false; }
    if(existing && existing.owner===SESSION_USER.id){
      const { error } = await sb.from('ext_glossary').update({en,af,subject:sub}).eq('id',existing.id);
      if(error){ toast(error.message,'err'); return false; }
    }else{
      // adding new (or overriding a starter term with your own confirmed one)
      const { error } = await sb.from('ext_glossary').insert({en,af,subject:sub,source:'user'});
      if(error){ toast(error.message,'err'); return false; }
    }
    await loadGlossary(); renderGlossary(); toast('Saved','ok');
  });
}
async function deleteTerm(g){
  if(!confirm(`Delete "${g.en} → ${g.af}"?`)) return;
  const { error } = await sb.from('ext_glossary').delete().eq('id',g.id);
  if(error){ toast(error.message,'err'); return; }
  await loadGlossary(); renderGlossary(); toast('Deleted','ok');
}

/* ---------------- translation engine (free, no daily limit) ---------------- */
const TCACHE = new Map();
// text that must NOT be translated (kept exactly as in the original)
function isKeep(text){
  const t = text.trim(); if(!t) return true;
  // multiple-choice / list labels: A  B.  (C)  D)  (i)  1.  a)  — keep exactly
  if(/^[\(\[]?[A-Za-z0-9]{1,3}[\)\].:]?$/.test(t)) return true;
  const words = (t.match(/[A-Za-zÀ-ÿ]{2,}/g)||[]);
  if(words.length===0) return true;                 // pure numbers/symbols/formulas
  const mathy = /[=×÷±∆Δ→←↔≈≤≥∑√°∫∞]/.test(t);
  if(words.length<=1 && (mathy || /\d/.test(t))) return true;
  return false;
}
// primary engine: Google's free endpoint (no key, no daily limit). Falls back to MyMemory.
async function mtGoogle(text, sl, tl){
  const u = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
  const r = await fetch(u); if(!r.ok) throw new Error('google '+r.status);
  const j = await r.json();
  if(!Array.isArray(j) || !j[0]) throw new Error('google shape');
  const out = j[0].map(s=> s && s[0]).filter(x=>x!=null).join('');
  if(!out.trim()) throw new Error('google empty');
  return out;
}
async function mtMyMemory(text, sl, tl){
  const u = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sl}|${tl}`;
  const r = await fetch(u); const j = await r.json();
  const tt = j && j.responseData && j.responseData.translatedText;
  if(!tt || /MYMEMORY WARNING|QUOTA|LIMIT/i.test(tt)) throw new Error('mymemory');
  return tt;
}
async function mtTranslate(text, dir){
  const [sl,tl] = dir==='en_af' ? ['en','af'] : ['af','en'];
  const key = sl+tl+'::'+text;
  if(TCACHE.has(key)) return TCACHE.get(key);
  let res;
  try{ res = { text: await mtGoogle(text, sl, tl) }; }
  catch(e){
    try{ res = { text: await mtMyMemory(text, sl, tl) }; }
    catch(e2){ res = { text, failed:true }; }        // couldn't translate — keep source, flag it
  }
  TCACHE.set(key, res);
  return res;
}
// translate one natural-language unit -> {mode, text, hints, failed}
async function translateBlock(srcText, dir){
  const trimmed = srcText.trim();
  if(isKeep(trimmed)) return {mode:'keep', text:srcText};
  const exact = glossaryExact(trimmed, dir);
  if(exact!==null) return {mode:'gloss', text:exact};
  const r = await mtTranslate(trimmed, dir);
  return {mode:'mt', text:r.text, hints:glossaryHints(trimmed,dir), failed:!!r.failed};
}

/* ---------------- PDF / image extraction ---------------- */
function runsToText(runs){ return runs.map(r=>r.t).join(''); }
function runsToHtml(runs){
  return runs.map(r=> r.script==='super'?`<sup>${esc(r.t)}</sup>`
                    : r.script==='sub'  ?`<sub>${esc(r.t)}</sub>`
                    : esc(r.t)).join('');
}
// group PDF text items into line -> paragraph blocks, detecting super/subscript
function buildTextBlocks(tc){
  const items = tc.items.filter(i=>i.str!==undefined);
  if(!items.length) return [];
  // line grouping by baseline y (transform[5]); PDF y grows upward
  const lines = [];
  items.forEach(it=>{
    const y = it.transform[5], x = it.transform[4];
    const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
    let line = lines.find(l=>Math.abs(l.y - y) < Math.max(3, l.size*0.5));
    if(!line){ line={y, size, items:[]}; lines.push(line); }
    line.items.push({str:it.str, x, y, size});
    line.size = Math.max(line.size, size);
  });
  lines.sort((a,b)=> b.y - a.y);            // top to bottom
  lines.forEach(l=> l.items.sort((a,b)=> a.x - b.x));
  // sizes to detect headings
  const sizes = lines.map(l=>l.size).sort((a,b)=>a-b);
  const median = sizes[Math.floor(sizes.length/2)] || 10;
  // build runs per line with script detection
  const lineObjs = lines.map(l=>{
    const runs=[];
    l.items.forEach(it=>{
      let script='normal';
      if(it.size < l.size*0.82){
        if(it.y > l.y + l.size*0.15) script='super';
        else if(it.y < l.y - l.size*0.12) script='sub';
      }
      const last = runs[runs.length-1];
      if(last && last.script===script) last.t += it.str;
      else runs.push({t:it.str, script});
    });
    return {y:l.y, size:l.size, runs, heading: l.size > median*1.18};
  });
  // merge consecutive lines into paragraph blocks (unless heading or big gap)
  const blocks=[];
  let cur=null, prevY=null, prevSize=null;
  lineObjs.forEach(lo=>{
    const text = runsToText(lo.runs).trim();
    if(!text){ cur=null; prevY=lo.y; return; }
    const gap = prevY==null?0:(prevY - lo.y);
    const newBlock = !cur || lo.heading || (prevSize && gap > prevSize*1.7);
    if(newBlock){
      cur = {type:'text', kind: lo.heading?'heading':'para', runs:[...lo.runs], y:lo.y};
      blocks.push(cur);
    }else{
      cur.runs.push({t:' ', script:'normal'}, ...lo.runs);
    }
    prevY=lo.y; prevSize=lo.size;
  });
  return blocks;
}
// detect diagram/image regions via operator list, crop from rendered canvas
async function detectImages(page, viewport, canvas){
  const out=[];
  try{
    const ops = await page.getOperatorList();
    const OPS = pdfjsLib.OPS;
    const mul=(m,n)=>[m[0]*n[0]+m[2]*n[1], m[1]*n[0]+m[3]*n[1], m[0]*n[2]+m[2]*n[3], m[1]*n[2]+m[3]*n[3], m[0]*n[4]+m[2]*n[5]+m[4], m[1]*n[4]+m[3]*n[5]+m[5]];
    let ctm=[1,0,0,1,0,0]; const stack=[];
    for(let i=0;i<ops.fnArray.length;i++){
      const fn=ops.fnArray[i], a=ops.argsArray[i];
      if(fn===OPS.save) stack.push(ctm.slice());
      else if(fn===OPS.restore) ctm = stack.pop()||[1,0,0,1,0,0];
      else if(fn===OPS.transform) ctm = mul(ctm, a);
      else if(fn===OPS.paintImageXObject || fn===OPS.paintJpegXObject || fn===OPS.paintImageMaskXObject){
        // image occupies unit square transformed by ctm
        const corners=[[0,0],[1,0],[0,1],[1,1]].map(([ux,uy])=>{
          const px = ctm[0]*ux+ctm[2]*uy+ctm[4], py = ctm[1]*ux+ctm[3]*uy+ctm[5];
          return viewport.convertToViewportPoint(px,py);
        });
        const xs=corners.map(c=>c[0]), ys=corners.map(c=>c[1]);
        const x0=Math.max(0,Math.min(...xs)), x1=Math.min(canvas.width,Math.max(...xs));
        const y0=Math.max(0,Math.min(...ys)), y1=Math.min(canvas.height,Math.max(...ys));
        const w=x1-x0, h=y1-y0;
        if(w>60 && h>40 && w<canvas.width*0.99){            // skip tiny + full-page bg
          const c2=document.createElement('canvas'); c2.width=w; c2.height=h;
          c2.getContext('2d').drawImage(canvas, x0,y0,w,h, 0,0,w,h);
          out.push({type:'image', dataUrl:c2.toDataURL('image/png'), canvasY:(y0+y1)/2, w, h});
        }
      }
    }
  }catch(e){ /* diagrams optional; ignore */ }
  return out;
}

async function ocrCanvas(canvas, onNote){
  onNote && onNote('Scanned page — running OCR (slower)…');
  if(!window.Tesseract){
    await new Promise((res,rej)=>{ const s=document.createElement('script');
      s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js';
      s.onload=res; s.onerror=rej; document.head.appendChild(s); });
  }
  const { data } = await Tesseract.recognize(canvas, 'eng+afr');
  return data.text || '';
}
function ocrToBlocks(text){
  return text.split(/\n{2,}/).map(p=>p.trim()).filter(Boolean)
    .map(p=>({type:'text', kind:'para', runs:[{t:p, script:'normal'}]}));
}

// ---- Word (.docx) via mammoth ----
function walkInline(node, script, runs){
  node.childNodes.forEach(ch=>{
    if(ch.nodeType===3){
      if(ch.textContent){ const last=runs[runs.length-1]; if(last&&last.script===script) last.t+=ch.textContent; else runs.push({t:ch.textContent, script}); }
    }else if(ch.nodeType===1){
      if(ch.tagName==='IMG') return;
      let s=script; if(ch.tagName==='SUP') s='super'; else if(ch.tagName==='SUB') s='sub';
      walkInline(ch, s, runs);
    }
  });
}
function htmlToBlocks(root){
  const blocks=[];
  root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li').forEach(node=>{
    const runs=[]; walkInline(node,'normal',runs);
    const text = runs.map(r=>r.t).join('').trim();
    const heading = /^H[1-6]$/.test(node.tagName);
    if(text) blocks.push({type:'text', kind:heading?'heading':'para', runs});
    node.querySelectorAll('img').forEach(img=>{ if(img.src) blocks.push({type:'image', dataUrl:img.src}); });
  });
  if(!blocks.length){
    root.textContent.split(/\n{2,}/).map(t=>t.trim()).filter(Boolean)
      .forEach(t=>blocks.push({type:'text', kind:'para', runs:[{t, script:'normal'}]}));
  }
  return blocks;
}
async function extractDocx(file, onNote){
  onNote && onNote('Reading Word document…');
  if(!window.mammoth) throw new Error('Word reader not loaded — please refresh.');
  const arrayBuffer = await file.arrayBuffer();
  const { value:html } = await mammoth.convertToHtml({arrayBuffer});
  const wrap = document.createElement('div'); wrap.innerHTML = html;
  return { mode:'reflow', pages:[{ index:1, blocks: htmlToBlocks(wrap), pageImage:null, scanned:false }] };
}

// ---- PDF: line geometry so we can overlay translated text in place (keeps original page exactly) ----
// pdf.js text item.transform[4],[5] are already in PDF user space (bottom-left origin),
// which matches pdf-lib's coordinate system directly — no flip needed.
function fontIsSerif(fam){
  if(!fam) return false; fam = fam.toLowerCase();
  if(fam.includes('sans')) return false;
  return /serif|times|georgia|roman|garamond|minion|book antiqua|cambria/.test(fam);
}
function groupLines(items, styles){
  const arr = items.map(it=>({
    x: it.transform[4], y: it.transform[5],
    size: Math.hypot(it.transform[2], it.transform[3]) || it.height || 10,
    w: it.width || 0, str: it.str, fn: it.fontName
  })).filter(a=>a.str && a.str.length);
  const lines=[];
  arr.forEach(a=>{
    let ln = lines.find(l=> Math.abs(l.baseY - a.y) < Math.max(1.5, l.size*0.4));
    if(!ln){ ln={baseY:a.y, size:a.size, items:[]}; lines.push(ln); }
    ln.items.push(a); ln.size=Math.max(ln.size, a.size);
  });
  // split each visual line into segments at big horizontal gaps (separate table
  // cells / tab stops), so each cell is translated and redrawn inside ITS OWN
  // space — the white cover never crosses a cell border.
  const units=[];
  lines.forEach(l=>{
    l.items.sort((p,q)=>p.x-q.x);
    const gapAt = Math.max(8, l.size*1.5);
    let seg=null, pendingWs=[];
    const flush=()=>{ if(seg) units.push(seg); seg=null; pendingWs=[]; };
    l.items.forEach(it=>{
      if(!it.str.trim()){ if(seg) pendingWs.push(it); return; }   // whitespace never bridges a gap
      if(seg && it.x - seg.right > gapAt) flush();
      if(!seg){ seg={items:[], right:-Infinity, size:l.size}; pendingWs=[]; }
      else if(pendingWs.length){ seg.items.push(...pendingWs); pendingWs=[]; }
      seg.items.push(it); seg.right=Math.max(seg.right, it.x + it.w);
    });
    flush();
  });
  return units.map(s=>{
    const x = Math.min(...s.items.map(i=>i.x));
    const right = Math.max(...s.items.map(i=>i.x + i.w));
    const ys = s.items.map(i=>i.y).sort((a,b)=>a-b);
    const fam = styles && s.items[0] && styles[s.items[0].fn] && styles[s.items[0].fn].fontFamily;
    return { x, y: ys[Math.floor(ys.length/2)], size:s.size, width: Math.max(right-x, 4),
             str: s.items.map(i=>i.str).join(''), serif: fontIsSerif(fam) };
  }).filter(l=>l.str.trim()).sort((a,b)=> b.y - a.y || a.x - b.x);
}
async function extractPdfOverlay(file, onNote, onProgress){
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({data: bytes.slice(0)}).promise;   // slice keeps `bytes` for pdf-lib
  const pages=[]; let digitalPages=0;
  for(let p=1;p<=pdf.numPages;p++){
    onNote && onNote(`Reading page ${p} of ${pdf.numPages}…`);
    const page = await pdf.getPage(p);
    const vp = page.getViewport({scale:1});
    const tc = await page.getTextContent();
    const items = tc.items.filter(i=>i.str && i.str.length);
    if(items.length>3) digitalPages++;
    pages.push({ index:p, width:vp.width, height:vp.height, lines: groupLines(items, tc.styles) });
    onProgress && onProgress(p/pdf.numPages*0.5);
  }
  return { mode:'pdf-overlay', bytes, pages, digital: digitalPages>0 };
}
async function extractPdfReflowOcr(file, onNote, onProgress){
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data:buf}).promise;
  const pages=[];
  for(let p=1;p<=pdf.numPages;p++){
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({scale:2});
    const canvas=document.createElement('canvas'); canvas.width=viewport.width; canvas.height=viewport.height;
    await page.render({canvasContext:canvas.getContext('2d'), viewport}).promise;
    const txt = await ocrCanvas(canvas, onNote);
    pages.push({index:p, blocks: ocrToBlocks(txt), pageImage: canvas.toDataURL('image/jpeg',0.65), scanned:true});
    onProgress && onProgress(p/pdf.numPages*0.5);
  }
  return {mode:'reflow', pages};
}

// ---- Word (.docx) IN-PLACE: only swap text inside runs, keep ALL formatting exactly ----
const WNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XMLNS = 'http://www.w3.org/XML/1998/namespace';
function wEls(node, tag){ return [...node.getElementsByTagNameNS(WNS, tag)]; }
function runVertAlign(r){
  const rPr = wEls(r,'rPr')[0]; if(!rPr) return null;
  const va = [...rPr.childNodes].find(n=>n.localName==='vertAlign');
  return va ? (va.getAttributeNS(WNS,'val') || va.getAttribute('w:val')) : null;
}
function runRprSig(r){ const rPr = wEls(r,'rPr')[0]; return rPr ? new XMLSerializer().serializeToString(rPr) : ''; }
// coalesce adjacent same-format, non-sub/superscript runs into translatable segments
function collectSegments(dom){
  const segs=[];
  wEls(dom.documentElement,'p').forEach(p=>{
    const runs = wEls(p,'r');
    let cur=null, curSig=null;
    const flush=()=>{ if(cur && cur.src.trim() && !isKeep(cur.src)) segs.push(cur); cur=null; curSig=null; };
    runs.forEach(r=>{
      const tEls = wEls(r,'t');
      const text = tEls.map(t=>t.textContent).join('');
      const va = runVertAlign(r);
      const translatable = tEls.length>0 && text.trim().length>0 && va!=='subscript' && va!=='superscript';
      if(!translatable){ flush(); return; }              // sub/superscript & formulas kept exactly
      const sig = runRprSig(r);
      if(cur && sig===curSig){ cur.src += text; cur.tEls.push(...tEls); }
      else { flush(); cur = {src:text, tEls:tEls.slice()}; curSig=sig; }
    });
    flush();
  });
  segs.forEach(s=>{ s.lead=(s.src.match(/^\s*/)||[''])[0]; s.trail=(s.src.match(/\s*$/)||[''])[0]; });
  return segs;
}
async function extractDocxInplace(file, onNote, onProgress){
  onNote && onNote('Reading Word document…');
  if(!window.JSZip) throw new Error('Zip reader not loaded — please refresh.');
  const zip = await JSZip.loadAsync(file);
  const names = Object.keys(zip.files).filter(n=>/^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n));
  const parts=[];
  for(const name of names){
    const xml = await zip.file(name).async('string');
    const dom = new DOMParser().parseFromString(xml, 'application/xml');
    if(dom.getElementsByTagName('parsererror').length) continue;
    parts.push({ name, dom, segments: collectSegments(dom) });
  }
  if(!parts.length) throw new Error('This Word file could not be read — try re-saving it as .docx.');
  onProgress && onProgress(0.5);
  return { mode:'docx-inplace', zip, parts };
}
async function buildDocxInplace(){
  const { zip, parts } = CURRENT._doc;
  for(const part of parts){
    part.segments.forEach(seg=>{
      const tr = seg.tr; if(!tr) return;
      if(tr.mode==='keep' && !tr.edited) return;
      const core = (tr.text!=null ? tr.text : seg.src).replace(/^\s+|\s+$/g,'');
      seg.tEls[0].textContent = seg.lead + core + seg.trail;
      seg.tEls[0].setAttributeNS(XMLNS, 'xml:space', 'preserve');
      for(let i=1;i<seg.tEls.length;i++) seg.tEls[i].textContent='';
    });
    const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + new XMLSerializer().serializeToString(part.dom);
    zip.file(part.name, xml);
  }
  return await zip.generateAsync({ type:'blob', mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
// flat list of translation units (each has .src and receives .tr) across any doc mode
function collectUnits(doc){
  const u=[];
  if(doc.mode==='pdf-overlay') doc.pages.forEach(p=>p.lines.forEach(l=>{ l.src=l.str; u.push(l); }));
  else if(doc.mode==='docx-inplace') doc.parts.forEach(p=>p.segments.forEach(s=>u.push(s)));
  else doc.pages.forEach(p=>p.blocks.forEach(b=>{ if(b.type==='text'){ b.src=runsToText(b.runs); u.push(b); } }));
  return u;
}

async function extractDocument(file, onNote, onProgress){
  const isPdf  = file.type==='application/pdf' || /\.pdf$/i.test(file.name);
  const isDocx = /\.docx$/i.test(file.name) || file.type==='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if(/\.doc$/i.test(file.name) && !isDocx) throw new Error('Old .doc files aren’t supported — please save it as .docx or PDF first.');
  if(isDocx){ return await extractDocxInplace(file, onNote, onProgress); }   // keep formatting exactly
  if(isPdf){
    const ov = await extractPdfOverlay(file, onNote, onProgress);
    if(ov.digital) return ov;                                    // digital PDF → faithful in-place overlay
    onNote && onNote('No text layer found — using OCR (rougher, layout not preserved)…');
    return await extractPdfReflowOcr(file, onNote, onProgress);   // scanned PDF → OCR reflow fallback
  }
  // image file → OCR reflow
  onNote && onNote('Reading image…');
  const url = URL.createObjectURL(file);
  const img = await new Promise((res,rej)=>{const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=url;});
  const canvas=document.createElement('canvas'); canvas.width=img.width; canvas.height=img.height;
  canvas.getContext('2d').drawImage(img,0,0);
  const txt = await ocrCanvas(canvas, onNote);
  onProgress && onProgress(0.5);
  return {mode:'reflow', pages:[{index:1, blocks: ocrToBlocks(txt), pageImage: canvas.toDataURL('image/jpeg',0.65), scanned:true}]};
}

/* ---------------- workflow ---------------- */
function initFormSelects(){
  fillSelect($('#uSubject'), SUBJECTS, {all:'—', current:''});
  fillSelect($('#uGrade'), GRADES, {all:'—', current:''});
  fillSelect($('#uType'), TYPES, {all:'—', current:''});
  fillSelect($('#uPeriod'), PERIODS, {all:'—', current:''});
  fillSelect($('#fSubject'), SUBJECTS, {all:'All subjects'});
  fillSelect($('#fGrade'), GRADES, {all:'All grades'});
  fillSelect($('#fType'), TYPES, {all:'All types'});
  fillSelect($('#fPeriod'), PERIODS, {all:'All periods'});
}
function setStep(name){
  const order=['upload','process','review','export'];
  ['upload','process','review','export'].forEach(s=> $('#step-'+s).classList.toggle('hidden', s!==name));
  const idx = order.indexOf(name);
  $$('#steps .st').forEach((st,i)=>{
    st.classList.toggle('active', i===idx);
    st.classList.toggle('done', i<idx);
  });
}
function resetWorkflow(){
  CURRENT=null;
  setStep('upload');
  $('#uName').value=''; $('#uSubject').value=''; $('#uGrade').value=''; $('#uType').value='';
  $('#uPeriod').value=''; $('#uYear').value=''; $('#uDirection').value='en_af';
  $('#fileInput').value='';
}
function procNote(msg){ const p=el('div','progress-line'); p.innerHTML=`<span class="spinner"></span> ${esc(msg)}`; const log=$('#procLog'); log.innerHTML=''; log.appendChild(p); }
function procDone(msg){ $('#procLog').innerHTML = `<div class="progress-line">✅ ${esc(msg)}</div>`; }
function setBar(f){ $('#procBar').style.width = Math.round(f*100)+'%'; }

function storagePath(paperId, kind, ext){ return `${SESSION_USER.id}/${paperId}/${kind}.${ext}`; }

async function handleFiles(files){
  if(!files || !files.length) return;
  const file = files[0];
  const ext = (file.name.split('.').pop()||'bin').toLowerCase();
  setStep('process'); setBar(0.03); procNote('Saving original to your library…');

  // 1) create paper row immediately (auto-save)
  const meta = Object.assign(readFormTags(file), { direction: $('#uDirection').value, status:'uploaded', original_filename:file.name });
  const { data:row, error:insErr } = await sb.from('ext_papers').insert(meta).select().single();
  if(insErr){ toast('Could not save: '+insErr.message,'err'); setStep('upload'); return; }
  CURRENT = row;

  // 2) upload original file
  const origPath = storagePath(row.id,'original',ext);
  const { error:upErr } = await sb.storage.from('ext-papers').upload(origPath, file, {upsert:true, contentType:file.type||undefined});
  if(upErr){ toast('Upload failed: '+upErr.message,'err'); setStep('upload'); return; }
  await sb.from('ext_papers').update({original_path:origPath}).eq('id',row.id);
  CURRENT.original_path = origPath;
  toast('Original saved to library','ok');

  // 3) extract
  try{
    const doc = await extractDocument(file, procNote, setBar);
    CURRENT._doc = doc;

    // 3b) auto-detect tags from page 1 text (editable suggestions), then persist them
    autoDetectTags(doc);
    const tags = readFormTags(file);
    await sb.from('ext_papers').update(tags).eq('id', row.id);
    Object.assign(CURRENT, tags);

    // 4) translate (unit = a PDF line for overlay, or a text block for reflow)
    procNote('Translating…');
    const units = collectUnits(doc);
    let total=units.length, done=0, failed=0;
    for(const u of units){
      u.tr = await translateBlock(u.src, row.direction);
      if(u.tr.failed) failed++;
      done++; setBar(0.5 + (done/Math.max(1,total))*0.5);
      procNote(`Translating… (${done}/${total})`);
    }
    procDone('Translation ready for review');
    if(failed) toast(`${failed} line(s) couldn't be translated automatically — left in the original for you to edit.`,'err');
    renderReview();
    setStep('review');
  }catch(e){
    console.error(e);
    toast('Could not read this file: '+(e.message||e),'err');
    setStep('upload');
  }
}

function readFormTags(file){
  return {
    name: $('#uName').value.trim() || (file? file.name.replace(/\.[^.]+$/,'') : (CURRENT&&CURRENT.name) || 'Untitled'),
    subject: $('#uSubject').value||null, grade: $('#uGrade').value||null,
    paper_type: $('#uType').value||null, exam_period: $('#uPeriod').value||null,
    year: $('#uYear').value.trim()||null
  };
}
function pageText(doc, i){
  if(doc.mode==='docx-inplace'){
    if(i>0) return '';
    const dp = doc.parts.find(p=>/document/.test(p.name)) || doc.parts[0];
    return dp ? dp.segments.map(s=>s.src).join(' ') : '';
  }
  const pg = doc.pages[i]; if(!pg) return '';
  if(doc.mode==='pdf-overlay') return (pg.lines||[]).map(l=>l.str).join(' ');
  return (pg.blocks||[]).filter(b=>b.type==='text').map(b=>runsToText(b.runs)).join(' ');
}
function autoDetectTags(doc){
  const text = pageText(doc,0).toLowerCase();
  const set=(id,val)=>{ const s=$(id); if(!s.value && val){ s.value=val; s.style.outline='2px solid var(--warn)'; setTimeout(()=>s.style.outline='',2500);} };
  let subj='';
  if(/chem|chemie/.test(text)) subj='Chemistry';
  else if(/physics|fisika|fisiese wetenskap|physical science/.test(text)) subj='Physics';
  else if(/geograph|geografie/.test(text)) subj='Geography';
  else if(/mathemat|wiskunde/.test(text)) subj='Mathematics';
  else if(/life science|lewenswetenskap/.test(text)) subj='Life Sciences';
  const gm = text.match(/gra[dead]{1,3}\s*(\d{1,2})/); const grade = gm?gm[1]:'';
  let type='';
  if(/prelim/.test(text)) type='Prelim';
  else if(/final|november exam|eindeksamen/.test(text)) type='Final Exam';
  else if(/term test|kwartaaltoets|\btoets\b/.test(text)) type='Term Test';
  else if(/homework|huiswerk/.test(text)) type='Homework';
  // exam period (month) — English + Afrikaans
  let period='';
  if(/\bmarch\b|\bmaart\b/.test(text)) period='March';
  else if(/\bjune\b|\bjunie\b/.test(text)) period='June';
  else if(/\bseptember\b/.test(text)) period='September';
  else if(/\bnovember\b/.test(text)) period='November';
  // year — first plausible 20xx on the cover
  const ym = text.match(/\b(20\d{2})\b/); const year = ym?ym[1]:'';
  set('#uSubject',subj); set('#uGrade', GRADES.includes(grade)?grade:''); set('#uType',type);
  set('#uPeriod',period);
  if(year && !$('#uYear').value){ $('#uYear').value=year; $('#uYear').style.outline='2px solid var(--warn)'; setTimeout(()=>$('#uYear').style.outline='',2500); }
  if(subj||grade||type||period||year) toast('Suggested tags filled in — please check them','');
}

/* ---------------- review ---------------- */
function reviewItems(doc){
  const items=[];
  if(doc.mode==='pdf-overlay'){
    doc.pages.forEach(pg=>{ items.push({header:`Page ${pg.index}`}); pg.lines.forEach(l=>{ l.src=l.str; items.push({origHtml:esc(l.str), unit:l}); }); });
  }else if(doc.mode==='docx-inplace'){
    doc.parts.forEach(part=>{
      const label = /document/.test(part.name)?'Document body' : /header/.test(part.name)?'Header' : /footer/.test(part.name)?'Footer' : /footnote/.test(part.name)?'Footnotes':part.name;
      items.push({header:label});
      part.segments.forEach(s=>items.push({origHtml:esc(s.src), unit:s}));
    });
  }else{
    doc.pages.forEach(pg=>{ items.push({header:`Page ${pg.index}${pg.scanned?' · scanned (OCR)':''}`});
      pg.blocks.forEach(b=>{ if(b.type==='image') items.push({isImage:true, dataUrl:b.dataUrl});
        else { b.src=runsToText(b.runs); items.push({origHtml:runsToHtml(b.runs), unit:b}); } }); });
  }
  return items;
}
function renderReview(){
  const doc = CURRENT._doc;
  $('#reviewName').textContent = CURRENT.name || CURRENT.original_filename;
  $('#exportBtn').textContent = doc.mode==='pdf-overlay' ? 'Export translated PDF' : 'Export translated Word document (.docx)';
  const host = $('#reviewPages'); host.innerHTML='';
  let orig=null, trc=null;
  const newCard=(title)=>{
    const card=el('div','card pagecard'); card.appendChild(el('div','phead', esc(title)));
    const sbs=el('div','sbs'); orig=el('div','col orig'); orig.appendChild(el('h4',null,'Original'));
    trc=el('div','col'); trc.appendChild(el('h4',null,'Translated')); sbs.append(orig,trc); card.appendChild(sbs); host.appendChild(card);
  };
  reviewItems(doc).forEach(it=>{
    if(it.header){ newCard(it.header); return; }
    if(!orig) newCard('Content');
    if(it.isImage){
      const o=el('div','blk imgblk'); o.innerHTML=`<img class="diagram" src="${it.dataUrl}">`; orig.appendChild(o);
      const t=el('div','blk imgblk'); t.innerHTML=`<img class="diagram" src="${it.dataUrl}"><div class="muted" style="font-size:11px;margin-top:4px">Diagram — kept as-is</div>`; trc.appendChild(t);
      return;
    }
    const ob=el('div','blk orig-blk'); ob.innerHTML=it.origHtml; orig.appendChild(ob);
    const unit=it.unit; const tr = unit.tr || (unit.tr={mode:'keep', text:unit.src});
    const tb=el('div','blk tr '+tr.mode);
    tb.appendChild(el('span','htag', tr.mode==='gloss'?'Glossary':tr.mode==='mt'?'Machine — check':'Kept as-is'));
    const body=el('div'); body.contentEditable='true'; body.spellcheck=false;
    body.textContent = tr.text!=null ? tr.text : unit.src; body.style.minHeight='1.2em';
    body.addEventListener('input', ()=>{ tr.text=body.textContent; tr.edited=true; });
    tb.appendChild(body);
    if(tr.mode==='mt' && tr.hints && tr.hints.length) tb.appendChild(el('div','hints','Glossary suggests: '+tr.hints.map(esc).join(' · ')));
    trc.appendChild(tb);
  });
}

/* ---------------- docx export ---------------- */
function dataUrlToUint8(dataUrl){
  const b64 = dataUrl.split(',')[1]; const bin = atob(b64);
  const arr = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  return arr;
}
function imgDims(dataUrl, maxW=480){
  return new Promise(res=>{ const i=new Image(); i.onload=()=>{ let w=i.width,h=i.height; if(w>maxW){ h=h*maxW/w; w=maxW; } res({w:Math.round(w),h:Math.round(h)}); }; i.src=dataUrl; });
}
async function buildDocx(){
  const D = window.docx;
  const children=[];
  const pages = CURRENT._doc.pages;
  for(let pi=0; pi<pages.length; pi++){
    const pg = pages[pi];
    for(const b of pg.blocks){
      if(b.type==='image'){
        const dims = await imgDims(b.dataUrl);
        children.push(new D.Paragraph({ children:[ new D.ImageRun({ data:dataUrlToUint8(b.dataUrl), transformation:{width:dims.w,height:dims.h} }) ] }));
        continue;
      }
      const text = (b.tr && b.tr.text!=null) ? b.tr.text : runsToText(b.runs);
      if(b.tr && b.tr.mode==='keep'){
        // preserve super/subscript runs verbatim
        const runs = b.runs.map(r=> new D.TextRun({ text:r.t, superScript:r.script==='super', subScript:r.script==='sub' }));
        children.push(new D.Paragraph({children:runs}));
      }else if(b.kind==='heading'){
        children.push(new D.Paragraph({ heading:D.HeadingLevel.HEADING_2, children:[new D.TextRun({text, bold:true})] }));
      }else{
        children.push(new D.Paragraph({ children:[new D.TextRun(text)] }));
      }
    }
    if(pi<pages.length-1) children.push(new D.Paragraph({children:[new D.PageBreak()]}));
  }
  const doc = new D.Document({ sections:[{ properties:{}, children }] });
  return await D.Packer.toBlob(doc);
}
// ---- PDF overlay: keep original page, cover each translated line, redraw in place ----
function sanitizePdfText(s){
  return (s||'')
    .replace(/[“”]/g,'"').replace(/[‘’]/g,"'")
    .replace(/[–—]/g,'-').replace(/…/g,'...')
    .replace(/×/g,'x').replace(/÷/g,'/')
    .replace(/²/g,'2').replace(/³/g,'3')
    .replace(/°/g,' deg').replace(/→/g,'->')
    .replace(/[\x00-\x1F]/g,' ')
    .replace(/[^\x20-\xFF]/g,'');            // drop anything Helvetica/WinAnsi can't encode
}
async function buildOverlayPdf(){
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const pdf = await PDFDocument.load(CURRENT._doc.bytes);
  const sans  = await pdf.embedFont(StandardFonts.Helvetica);   // matches Arial/Helvetica papers
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);  // matches Times/serif papers
  const pages = pdf.getPages();
  CURRENT._doc.pages.forEach(pg=>{
    const page = pages[pg.index-1]; if(!page) return;
    pg.lines.forEach(ln=>{
      const tr = ln.tr; if(!tr) return;
      if(tr.mode==='keep' && !tr.edited) return;               // leave numbers/formulas untouched
      const text = sanitizePdfText(tr.text||''); if(!text.trim()) return;
      const font = ln.serif ? serif : sans;
      // cover ONLY this segment's text (tight box — never crosses a table border),
      // then redraw the translation in the same slot
      page.drawRectangle({ x: ln.x-0.5, y: ln.y - ln.size*0.22, width: ln.width+1, height: ln.size*1.22, color: rgb(1,1,1) });
      let size = ln.size || 10;
      const maxW = Math.max(ln.width, 6);
      const w = font.widthOfTextAtSize(text, size);
      if(w > maxW) size = Math.max(4, size * maxW / w);
      page.drawText(text, { x: ln.x, y: ln.y, size, font, color: rgb(0,0,0) });
    });
  });
  const out = await pdf.save();
  return new Blob([out], { type:'application/pdf' });
}

async function exportTranslated(){
  const mode = CURRENT._doc.mode;
  const overlay = mode==='pdf-overlay';
  const label = overlay ? 'Export translated PDF' : 'Export translated Word document (.docx)';
  $('#exportBtn').disabled=true; $('#exportBtn').textContent='Building…';
  try{
    const blob = overlay ? await buildOverlayPdf() : mode==='docx-inplace' ? await buildDocxInplace() : await buildDocx();
    const ext = overlay ? 'pdf' : 'docx';
    const ctype = overlay ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const fname = (CURRENT.name||'translated').replace(/[^\w\-]+/g,'_')+'.'+ext;
    const path = storagePath(CURRENT.id,'translated',ext);
    const { error } = await sb.storage.from('ext-papers').upload(path, blob, {upsert:true, contentType:ctype});
    if(error) throw error;
    await sb.from('ext_papers').update({
      translated_path:path, translated_filename:fname, status:'translated',
      name: $('#reviewName').textContent,
      translated: slimDoc(CURRENT._doc, true)
    }).eq('id',CURRENT.id);
    CURRENT.translated_path=path; CURRENT.translated_filename=fname;
    downloadBlob(blob, fname);
    CURRENT._lastBlob = blob;
    setStep('export');
    toast('Saved to library','ok');
  }catch(e){ console.error(e); toast('Export failed: '+(e.message||e),'err'); }
  finally{ $('#exportBtn').disabled=false; $('#exportBtn').textContent=label; }
}
// compact snapshot of the reviewed translation for the library row
function slimDoc(doc, withTr){
  if(doc.mode==='pdf-overlay') return { mode:'pdf-overlay', pages: doc.pages.map(p=>({
    index:p.index, lines: p.lines.map(l=>({ str:l.str, tr: withTr?l.tr:undefined })) })) };
  if(doc.mode==='docx-inplace') return { mode:'docx-inplace', parts: doc.parts.map(p=>({
    name:p.name, segments: p.segments.map(s=>({ src:s.src, tr: withTr?({mode:s.tr&&s.tr.mode, text:s.tr&&s.tr.text}):undefined })) })) };
  return { mode:'reflow', pages: doc.pages.map(p=>({ index:p.index, scanned:p.scanned,
    blocks: p.blocks.filter(b=>b.type==='text').map(b=>({ kind:b.kind, runs:b.runs, tr: withTr?b.tr:undefined })) })) };
}
function downloadBlob(blob, name){
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),4000);
}

/* ---------------- library ---------------- */
let LIB=[];
async function loadLibrary(){
  const { data, error } = await sb.from('ext_papers').select('*').order('created_at',{ascending:false});
  if(error){ toast('Could not load library: '+error.message,'err'); return; }
  LIB = data||[];
  renderLibrary();
}
function renderLibrary(){
  const subj=$('#fSubject').value, grade=$('#fGrade').value, type=$('#fType').value, period=$('#fPeriod').value, q=($('#fSearch').value||'').toLowerCase();
  const rows = LIB.filter(p=>{
    if(subj && p.subject!==subj) return false;
    if(grade && p.grade!==grade) return false;
    if(type && p.paper_type!==type) return false;
    if(period && p.exam_period!==period) return false;
    if(q){ const hay=((p.name||'')+' '+(p.original_filename||'')+' '+(p.year||'')+' '+(p.exam_period||'')).toLowerCase(); if(!hay.includes(q)) return false; }
    return true;
  });
  const list=$('#libList'); list.innerHTML='';
  if(!rows.length){
    list.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">📚</div>
      <p>${LIB.length? 'No papers match these filters.' : 'No papers yet. Upload your first one!'}</p></div>`;
    return;
  }
  rows.forEach(p=>{
    const c=el('div','card paper');
    const dir = p.direction==='en_af'?'EN → AF':'AF → EN';
    c.innerHTML = `
      <div class="ptitle">${esc(p.name||p.original_filename||'Untitled')}</div>
      <div class="tags">
        ${p.subject?`<span class="pill">${esc(p.subject)}</span>`:''}
        ${p.grade?`<span class="pill grey">Gr ${esc(p.grade)}</span>`:''}
        ${p.paper_type?`<span class="pill grey">${esc(p.paper_type)}</span>`:''}
        ${p.exam_period?`<span class="pill grey">${esc(p.exam_period)}</span>`:''}
        ${p.year?`<span class="pill grey">${esc(p.year)}</span>`:''}
        <span class="pill grey">${dir}</span>
        ${p.status==='translated'?'<span class="pill ok">Translated</span>':'<span class="pill warn">Original only</span>'}
      </div>
      <div class="meta">Added ${new Date(p.created_at).toLocaleDateString()}</div>`;
    const acts=el('div','acts');
    const dlO=el('button','btn ghost sm','⬇ Original');
    dlO.onclick=()=>downloadStored(p.original_path, p.original_filename||'original');
    acts.appendChild(dlO);
    if(p.translated_path){
      const dlT=el('button','btn sm','⬇ Translated');
      dlT.onclick=()=>downloadStored(p.translated_path, p.translated_filename||'translated.docx');
      acts.appendChild(dlT);
    }
    const share=el('button','btn ghost sm', p.share_token?'🔗 Sharing':'🔗 Share');
    share.onclick=()=>shareModal(p);
    acts.appendChild(share);
    const del=el('button','btn danger sm','Delete');
    del.onclick=()=>deletePaper(p);
    acts.appendChild(del);
    c.appendChild(acts); list.appendChild(c);
  });
}
async function downloadStored(path, filename){
  if(!path){ toast('File not available','err'); return; }
  const { data, error } = await sb.storage.from('ext-papers').createSignedUrl(path, 120, {download:filename});
  if(error){ toast('Could not get file: '+error.message,'err'); return; }
  window.location.href = data.signedUrl;
}
async function deletePaper(p){
  if(!confirm(`Delete "${p.name||p.original_filename}"? This removes the original and translated files.`)) return;
  const paths=[p.original_path,p.translated_path].filter(Boolean);
  if(paths.length) await sb.storage.from('ext-papers').remove(paths);
  const { error } = await sb.from('ext_papers').delete().eq('id',p.id);
  if(error){ toast(error.message,'err'); return; }
  toast('Deleted','ok'); loadLibrary();
}

/* ---------------- sharing ---------------- */
async function shareModal(p){
  const b=el('div');
  if(p.share_token){
    const link = shareLink(p.share_token);
    b.innerHTML = `<p class="muted" style="margin:0 0 10px">Anyone with this link can view and download this paper (no login). Turn it off any time.</p>
      <input type="text" readonly value="${esc(link)}" id="shareUrl">
      <div style="margin-top:8px"><button class="btn ghost sm" id="copyBtn">Copy link</button></div>`;
  }else{
    b.innerHTML = `<p class="muted" style="margin:0 0 6px">Create a view/download-only link to send to students. It works without a login and you can revoke it later.</p>`;
  }
  const host = modal(p.share_token?'Share link':'Create share link', b, async ()=>{
    if(p.share_token){ await revokeShare(p); }
    else { await enableShare(p); }
  }, p.share_token?'Turn off link':'Create link');
  const copy = b.querySelector('#copyBtn');
  if(copy) copy.onclick=()=>{ b.querySelector('#shareUrl').select(); navigator.clipboard.writeText(shareLink(p.share_token)); toast('Link copied','ok'); };
}
function shareLink(token){
  const base = location.href.replace(/[^/]*$/,'');
  return base+'share.html?t='+token;
}
async function enableShare(p){
  const token = crypto.randomUUID();
  const YEAR = 60*60*24*365;
  let so=null, st=null;
  if(p.original_path){ const r=await sb.storage.from('ext-papers').createSignedUrl(p.original_path, YEAR, {download:p.original_filename||'original'}); so=r.data?.signedUrl||null; }
  if(p.translated_path){ const r=await sb.storage.from('ext-papers').createSignedUrl(p.translated_path, YEAR, {download:p.translated_filename||'translated.docx'}); st=r.data?.signedUrl||null; }
  const { error } = await sb.from('ext_papers').update({share_token:token, share_original_url:so, share_translated_url:st}).eq('id',p.id);
  if(error){ toast(error.message,'err'); return; }
  toast('Share link created','ok'); await loadLibrary();
  const fresh = LIB.find(x=>x.id===p.id); if(fresh) shareModal(fresh);
}
async function revokeShare(p){
  const { error } = await sb.from('ext_papers').update({share_token:null, share_original_url:null, share_translated_url:null}).eq('id',p.id);
  if(error){ toast(error.message,'err'); return; }
  toast('Share link turned off','ok'); loadLibrary();
}

/* ---------------- wiring ---------------- */
function wire(){
  $('#authBtn').onclick=doAuth;
  $('#authPass').addEventListener('keydown',e=>{ if(e.key==='Enter') doAuth(); });
  $('#logoutBtn').onclick=async ()=>{ await sb.auth.signOut(); };
  $$('[data-nav]').forEach(b=> b.addEventListener('click',()=>nav(b.dataset.nav)));
  // upload
  const dz=$('#dropzone'), fi=$('#fileInput');
  dz.onclick=()=>fi.click();
  fi.onchange=()=>handleFiles(fi.files);
  ['dragover','dragenter'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('hot');}));
  ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('hot');}));
  dz.addEventListener('drop',e=>handleFiles(e.dataTransfer.files));
  // review
  $('#exportBtn').onclick=exportTranslated;
  $('#backToLibBtn').onclick=async ()=>{
    // persist current translation state without exporting
    if(CURRENT){ await sb.from('ext_papers').update({name:$('#reviewName').textContent, extracted:slimDoc(CURRENT._doc,false), translated:slimDoc(CURRENT._doc,true)}).eq('id',CURRENT.id); }
    nav('library');
  };
  $('#dlAgainBtn').onclick=()=>{ if(CURRENT&&CURRENT._lastBlob) downloadBlob(CURRENT._lastBlob, CURRENT.translated_filename||'translated.docx'); };
  // library filters
  ['#fSubject','#fGrade','#fType','#fPeriod'].forEach(s=>$(s).addEventListener('change',renderLibrary));
  $('#fSearch').addEventListener('input',renderLibrary);
  // glossary
  $('#addTermBtn').onclick=()=>termModal(null);
  $('#gSearch').addEventListener('input',renderGlossary);
  $('#gSubjectFilter').addEventListener('change',renderGlossary);
}

/* ---------------- test hook (no-login engine testing) ---------------- */
window.EPT = { extractDocument, translateBlock, mtTranslate, isKeep, buildTextBlocks, runsToText,
  buildDocxFor: async (doc)=>{ CURRENT={_doc:doc, name:'test', id:'test'}; return await buildDocx(); },
  buildOverlayFor: async (doc)=>{ CURRENT={_doc:doc, name:'test', id:'test'}; return await buildOverlayPdf(); },
  buildInplaceFor: async (doc)=>{ CURRENT={_doc:doc, name:'test', id:'test'}; return await buildDocxInplace(); },
  collectUnits, sanitizePdfText,
  setGlossary:(g)=>{ GLOSSARY=g; } };

/* ---------------- boot ---------------- */
if(!window.EPT_TEST){
  wire();
  sb.auth.getSession().then(({data})=>onSession(data.session));
  // defer outside the auth-change lock — calling supabase inside the callback deadlocks
  sb.auth.onAuthStateChange((_e, session)=>{ setTimeout(()=>onSession(session), 0); });
  if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{})); }
}
