'use strict';
var APP_VERSION = 'v5';
/* Beta Notes → Google Docs (mobile PWA)
 * Imports KOReader/Kodashboard annotations and posts them as Drive comments,
 * one tap each. No book text or personal config is baked into this code —
 * the OAuth client ID and target doc are entered at runtime and stored only
 * in this browser. Comments are (unavoidably) unanchored; each carries the
 * quoted passage + chapter so the author knows exactly what it refers to.
 */

/* ----------------------------- config store ----------------------------- */
var CFG_KEY = 'betaNotesCfg';
var cfg = loadCfg();
function loadCfg(){ try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch(e){ return {}; } }
function saveCfg(){ localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }
function docId(){ var m = String(cfg.docUrl||'').match(/\/d\/([A-Za-z0-9_\-]+)/); return m ? m[1] : ''; }

/* ------------------------------ Lua parser ------------------------------ */
function parseLua(src){
  var i=0,n=src.length;
  function err(m){ throw new Error('Lua parse error at '+i+': '+m); }
  function skipWs(){ while(i<n){ var c=src[i];
    if(c===' '||c==='\t'||c==='\r'||c==='\n'){i++;continue;}
    if(c==='-'&&src[i+1]==='-'){ i+=2; if(src[i]==='['&&src[i+1]==='['){i+=2;while(i<n&&!(src[i]===']'&&src[i+1]===']'))i++;i+=2;} else {while(i<n&&src[i]!=='\n')i++;} continue; }
    break; } }
  function parseString(){ var q=src[i++],out='';
    while(i<n){ var c=src[i++];
      if(c===q)return out;
      if(c==='\\'){ var e=src[i++];
        if(e==='n')out+='\n';else if(e==='t')out+='\t';else if(e==='r')out+='\r';
        else if(e==='a')out+='\x07';else if(e==='b')out+='\b';else if(e==='f')out+='\f';
        else if(e==='v')out+='\v';else if(e==='\n')out+='\n';
        else if(e==='\r'){if(src[i]==='\n')i++;out+='\n';}
        else if(e==='x'){out+=String.fromCharCode(parseInt(src.substr(i,2),16));i+=2;}
        else if(e==='z'){while(i<n&&/\s/.test(src[i]))i++;}
        else if(e>='0'&&e<='9'){var d=e;for(var k=0;k<2&&src[i]>='0'&&src[i]<='9';k++)d+=src[i++];out+=String.fromCharCode(parseInt(d,10));}
        else out+=e;
      } else out+=c;
    } err('unterminated string'); }
  function parseLongString(){ i+=2; if(src[i]==='\n')i++; var s=i; while(i<n&&!(src[i]===']'&&src[i+1]===']'))i++; var o=src.substring(s,i); i+=2; return o; }
  function parseNumber(){ var s=i; while(i<n&&/[0-9a-fA-FxX.eE+\-]/.test(src[i]))i++; return parseFloat(src.substring(s,i)); }
  function parseValue(){ skipWs(); var c=src[i];
    if(c==='{')return parseTable();
    if(c==='"'||c==="'")return parseString();
    if(c==='['&&src[i+1]==='[')return parseLongString();
    if(src.substr(i,4)==='true'){i+=4;return true;}
    if(src.substr(i,5)==='false'){i+=5;return false;}
    if(src.substr(i,3)==='nil'){i+=3;return null;}
    if(c==='-'||(c>='0'&&c<='9'))return parseNumber();
    err('unexpected value char "'+c+'"'); }
  function parseKey(){ skipWs();
    if(src[i]==='['){ i++; skipWs(); var k=(src[i]==='"'||src[i]==="'")?parseString():parseNumber(); skipWs(); if(src[i]!==']')err('expected ]'); i++; return k; }
    var s=i; while(i<n&&/[A-Za-z0-9_]/.test(src[i]))i++; return src.substring(s,i); }
  function parseTable(){ i++; var obj={},arr=1;
    while(true){ skipWs(); if(src[i]==='}'){i++;break;} var save=i;
      if(src[i]==='['){ var key=parseKey(); skipWs(); if(src[i]!=='=')err('expected ='); i++; obj[key]=parseValue(); }
      else if(/[A-Za-z_]/.test(src[i])){ var key2=parseKey(); skipWs(); if(src[i]==='='){i++;obj[key2]=parseValue();} else {i=save;obj[arr++]=parseValue();} }
      else { obj[arr++]=parseValue(); }
      skipWs(); if(src[i]===','||src[i]===';')i++;
    } return obj; }
  skipWs(); if(src.substr(i,6)==='return')i+=6; return parseValue();
}

/* --------------------------- note extraction ---------------------------- */
function hash(s){ var h=5381; for(var i=0;i<s.length;i++){ h=((h<<5)+h+s.charCodeAt(i))>>>0; } return h.toString(36); }

function clean(s){ return String(s==null?'':s).replace(/­/g,'').replace(/^\s+|\s+$/g,''); }

function mkNote(chapter,text,note,page,book){
  text=clean(text); note=clean(note);
  if(!text && !note) return null;
  return { chapter:clean(chapter), text:text, note:note, book:clean(book),
    page: (typeof page==='number'?page:0), id: hash(text+' '+note) };
}

function fromLua(root){
  var ann = root && root.annotations; if(!ann) return [];
  var title = (root.doc_props && root.doc_props.title) || (root.stats && root.stats.title) || '';
  var out=[];
  Object.keys(ann).forEach(function(k){ var a=ann[k]; if(!a) return;
    var nt=mkNote(a.chapter, a.text, a.note, a.pageno, title); if(nt) out.push(nt); });
  return out;
}

/* Kodashboard export shape can vary; map fields tolerantly. */
function pick(row, names){ for(var i=0;i<names.length;i++){ for(var key in row){ if(key.toLowerCase().replace(/[\s_]/g,'')===names[i]){ return row[key]; } } } return ''; }
function fromKodashboard(json){
  var rows = Array.isArray(json) ? json
    : (json && Array.isArray(json.rows)) ? json.rows
    : (json && Array.isArray(json.annotations)) ? json.annotations
    : (json && Array.isArray(json.highlights)) ? json.highlights
    : (json && Array.isArray(json.data)) ? json.data : null;
  if(!rows) return [];
  var out=[];
  rows.forEach(function(r){
    if(!r || typeof r!=='object') return;
    var text = pick(r,['highlighttext','highlight','text','highlighted']);
    var note = pick(r,['notetext','note','comment','annotation']);
    var chapter = pick(r,['chapter','chaptertitle','section']);
    var page = pick(r,['page','pageno','pagenumber']);
    var book = pick(r,['booktitle','book','title']);
    var nt = mkNote(chapter, text, note, typeof page==='number'?page:parseInt(page,10)||0, book);
    if(nt && nt.note) out.push(nt); // only rows that actually carry a comment
  });
  return out;
}

function detectAndParse(text){
  var t = text.replace(/^﻿/,'').replace(/^\s+/,'');
  if(t[0]==='{'||t[0]==='['){ // JSON
    var json = JSON.parse(text);
    return fromKodashboard(json);
  }
  return fromLua(parseLua(text)); // lua table
}

/* ------------------------------- state ---------------------------------- */
var notes = [];
var accessToken = null;

function sentKey(){ return 'betaNotesSent:' + (docId()||'nodoc'); }
function loadSent(){ try { return JSON.parse(localStorage.getItem(sentKey())) || {}; } catch(e){ return {}; } }
function saveSent(s){ localStorage.setItem(sentKey(), JSON.stringify(s)); }
var sent = {};

/* --------------------------------- DOM ---------------------------------- */
var $ = function(id){ return document.getElementById(id); };
var els = {
  settings:$('settings'), settingsBtn:$('settingsBtn'), refreshBtn:$('refreshBtn'),
  clientId:$('clientId'), docUrl:$('docUrl'), saveCfg:$('saveCfg'),
  file:$('file'), pasteBox:$('pasteBox'), importPaste:$('importPaste'), importMsg:$('importMsg'),
  postStep:$('postStep'), signIn:$('signIn'), authState:$('authState'),
  bookFilterWrap:$('bookFilterWrap'), bookFilter:$('bookFilter'),
  count:$('count'), hideSent:$('hideSent'), resetProgress:$('resetProgress'),
  list:$('list'), toast:$('toast')
};

function toast(msg){ els.toast.textContent=msg; els.toast.classList.add('show'); setTimeout(function(){ els.toast.classList.remove('show'); }, 1600); }

/* settings visibility */
function refreshSettings(){
  els.clientId.value = cfg.clientId || '';
  els.docUrl.value = cfg.docUrl || '';
  var configured = cfg.clientId && cfg.docUrl;
  els.settings.classList.toggle('hidden', !!configured && !settingsForced);
}
var settingsForced = false;
els.settingsBtn.onclick = function(){ settingsForced = !settingsForced; refreshSettings(); if(settingsForced) els.settings.scrollIntoView({behavior:'smooth'}); };
els.saveCfg.onclick = function(){
  cfg.clientId = els.clientId.value.trim();
  cfg.docUrl = els.docUrl.value.trim();
  saveCfg();
  if(!docId()){ toast('That doc URL looks off'); return; }
  settingsForced = false; refreshSettings(); toast('Setup saved');
  sent = loadSent(); render();
};

/* import */
els.file.onchange = function(){ var f=els.file.files[0]; if(!f) return;
  var r=new FileReader(); r.onload=function(){ ingest(r.result); }; r.readAsText(f); };
els.importPaste.onclick = function(){ if(els.pasteBox.value.trim()) ingest(els.pasteBox.value); };

function ingest(text){
  try {
    notes = detectAndParse(text);
    els.importMsg.innerHTML = '<span class="pill ok">'+notes.length+' note(s) imported</span>';
    els.postStep.classList.remove('hidden');
    sent = loadSent();
    populateBooks();
    render();
  } catch(err){
    els.importMsg.innerHTML = '<span class="pill warn">Import failed: '+err.message+'</span>';
  }
}

/* auth (Google Identity Services token flow) */
var tokenClient = null;
function ensureTokenClient(){
  if(tokenClient) return tokenClient;
  if(!window.google || !google.accounts || !google.accounts.oauth2){ throw new Error('Google library not loaded (need internet)'); }
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: cfg.clientId,
    scope: 'https://www.googleapis.com/auth/drive',
    callback: function(resp){
      if(resp && resp.access_token){ accessToken = resp.access_token; els.authState.textContent='connected'; els.authState.className='pill ok'; if(pendingSend){ var p=pendingSend; pendingSend=null; doSend(p.note, p.card); } }
      else { els.authState.textContent='sign-in failed'; els.authState.className='pill warn'; }
    }
  });
  return tokenClient;
}
els.signIn.onclick = function(){ connect(false); };
function connect(silent){
  if(!cfg.clientId){ toast('Add your Client ID in setup first'); settingsForced=true; refreshSettings(); return; }
  loadGis(function(){
    try { ensureTokenClient().requestAccessToken({ prompt: silent ? '' : 'consent' }); }
    catch(e){ toast(e.message); }
  });
}
function loadGis(cb){
  if(window.google && google.accounts && google.accounts.oauth2){ cb(); return; }
  var s=document.createElement('script'); s.src='https://accounts.google.com/gsi/client'; s.async=true;
  s.onload=cb; s.onerror=function(){ toast('Could not load Google (need internet)'); };
  document.head.appendChild(s);
}

/* posting */
var pendingSend = null;
function sendNote(note, card){
  if(!docId()){ toast('Set the doc URL in setup'); return; }
  if(!accessToken){ pendingSend={note:note,card:card}; connect(true); return; }
  doSend(note, card);
}
function doSend(note, card){
  var textarea = card.querySelector('textarea');
  var content = textarea.value;
  var body = { content: content };
  if(note.text){ body.quotedFileContent = { mimeType:'text/plain', value: note.text }; }
  var btn = card.querySelector('button.sendBtn');
  btn.disabled = true; btn.textContent = 'Sending…';
  fetch('https://www.googleapis.com/drive/v3/files/'+docId()+'/comments?fields=id', {
    method:'POST',
    headers:{ 'Authorization':'Bearer '+accessToken, 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  }).then(function(res){
    if(res.status===401){ accessToken=null; pendingSend={note:note,card:card}; connect(true); throw new Error('reauth'); }
    if(!res.ok){ return res.text().then(function(t){ throw new Error('HTTP '+res.status+' '+t.slice(0,120)); }); }
    return res.json();
  }).then(function(){
    sent[note.id]=1; saveSent(sent); toast('Posted'); render();
  }).catch(function(err){
    if(err.message==='reauth'){ return; }
    btn.disabled=false; btn.textContent='Send';
    toast('Failed: '+err.message);
  });
}

/* book filter — a Kodashboard export may contain every book */
function populateBooks(){
  var books = [];
  notes.forEach(function(n){ if(n.book && books.indexOf(n.book)<0) books.push(n.book); });
  if(books.length > 1){
    books.sort();
    els.bookFilter.innerHTML = books.map(function(b){ return '<option>'+b.replace(/</g,'&lt;')+'</option>'; }).join('');
    els.bookFilterWrap.classList.remove('hidden');
  } else {
    els.bookFilterWrap.classList.add('hidden');
  }
}
function visibleNotes(){
  if(els.bookFilterWrap.classList.contains('hidden')) return notes;
  var b = els.bookFilter.value;
  return notes.filter(function(n){ return n.book === b; });
}

/* render */
function defaultContent(n){
  var lines=[];
  if(n.chapter) lines.push('['+n.chapter+']');
  if(n.text) lines.push('“'+n.text+'”');
  lines.push(''); lines.push(n.note||'');
  return lines.join('\n');
}
function render(){
  var hide = els.hideSent.checked;
  var shown = visibleNotes();
  var total = shown.length, done = shown.filter(function(n){ return sent[n.id]; }).length;
  els.count.textContent = done+' / '+total+' sent';
  els.list.innerHTML='';
  shown.forEach(function(n){
    var isSent = !!sent[n.id];
    if(hide && isSent) return;
    var card=document.createElement('div'); card.className='card'+(isSent?' sent':'');
    var top=document.createElement('div'); top.className='top';
    var ch=document.createElement('span'); ch.className='chapter'; ch.textContent=n.chapter||'(no chapter)';
    var pill=document.createElement('span'); pill.className='pill'+(isSent?' ok':''); pill.textContent=isSent?'sent':'to send';
    top.appendChild(ch); top.appendChild(pill); card.appendChild(top);
    if(n.text){ var p=document.createElement('div'); p.className='passage'; p.textContent='“'+n.text+'”'; card.appendChild(p); }
    var ta=document.createElement('textarea'); ta.value=defaultContent(n); card.appendChild(ta);
    var row=document.createElement('div'); row.className='row';
    var send=document.createElement('button'); send.className='primary sendBtn'; send.textContent=isSent?'Send again':'Send';
    send.onclick=function(){ sendNote(n, card); };
    row.appendChild(send);
    if(isSent){ var un=document.createElement('button'); un.textContent='Mark unsent'; un.onclick=function(){ delete sent[n.id]; saveSent(sent); render(); }; row.appendChild(un); }
    card.appendChild(row);
    els.list.appendChild(card);
  });
  if(!els.list.children.length){
    var e=document.createElement('p'); e.className='muted';
    e.textContent = shown.length ? 'All notes sent. 🎉' : 'Import a file to begin.';
    els.list.appendChild(e);
  }
}
els.hideSent.onchange = render;
els.bookFilter.onchange = render;
els.resetProgress.onclick = function(){ if(confirm('Clear the sent marks for this doc?')){ sent={}; saveSent(sent); render(); } };

/* hard refresh: clear app-shell cache + service worker, keep settings/marks */
els.refreshBtn.onclick = function(){
  els.refreshBtn.classList.add('spin');
  toast('Updating to latest…');
  var jobs = [];
  if(window.caches){ jobs.push(caches.keys().then(function(ks){ return Promise.all(ks.map(function(k){ return caches.delete(k); })); })); }
  if(navigator.serviceWorker){ jobs.push(navigator.serviceWorker.getRegistrations().then(function(rs){ return Promise.all(rs.map(function(r){ return r.unregister(); })); })); }
  // cache-bust the reload so the shell is refetched even behind proxies
  Promise.all(jobs).catch(function(){}).then(function(){
    setTimeout(function(){ location.replace(location.pathname + '?u=' + Date.now()); }, 400);
  });
};

/* boot */
if(els.ver) els.ver.textContent = APP_VERSION;
refreshSettings();
render();
if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').catch(function(){}); }
