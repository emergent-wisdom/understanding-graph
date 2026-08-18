import { sqlite } from '@emergent-wisdom/understanding-graph-core';
import { Router } from 'express';

/**
 * Human <-> agent messages.
 *
 * Messages are deliberately NOT graph nodes. An arriving message has nothing
 * to connect to, so making it a node would force a hole in orphan prevention
 * — and the invariant that every cognitive node is grounded is worth more
 * than the convenience. They live in `chat_history`, which is transport, not
 * graph state, so no graph rule has to bend to accommodate them.
 *
 * What that buys: the agent decides what enters the graph. When a message
 * actually changes the work, the agent authors a properly grounded node for
 * it through graph_batch with real edges to what it bears on. Chatter that
 * changes nothing never pollutes the record.
 *
 * REST mutations are blocked elsewhere on purpose; this router is mounted
 * before the firewall and can only append to chat_history.
 */

type Row = {
  id: number;
  actor: string;
  content: string;
  metadata: string | null;
  timestamp: string;
};

function ensureTable() {
  sqlite.getDb().exec(`
    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT, event TEXT, content TEXT, metadata TEXT,
      timestamp TEXT DEFAULT (datetime('now'))
    );
  `);
}

function listMessages() {
  ensureTable();
  const rows = sqlite
    .getDb()
    .prepare(
      `SELECT id, actor, content, metadata, timestamp
       FROM chat_history WHERE event = 'message' ORDER BY id ASC`,
    )
    .all() as Row[];
  return rows.map((r) => {
    let answered = false;
    try {
      answered = Boolean(JSON.parse(r.metadata || '{}').answered);
    } catch {}
    return {
      id: r.id,
      from: r.actor === 'Assistant' ? 'agent' : 'human',
      answered,
      text: r.content ?? '',
      createdAt: r.timestamp,
    };
  });
}

function appendMessage(actor: 'User' | 'Assistant', text: string) {
  ensureTable();
  const info = sqlite
    .getDb()
    .prepare(
      `INSERT INTO chat_history (actor, event, content, metadata)
       VALUES (?, 'message', ?, '{}')`,
    )
    .run(actor, text);
  // An agent reply marks every earlier human message as answered: the reply
  // is to the conversation so far, not to one line in it.
  if (actor === 'Assistant') {
    sqlite
      .getDb()
      .prepare(
        `UPDATE chat_history SET metadata = json_set(COALESCE(NULLIF(metadata,''),'{}'), '$.answered', json('true'))
         WHERE event = 'message' AND actor = 'User'`,
      )
      .run();
  }
  return info.lastInsertRowid;
}

export const MESSAGES_WIDGET = `
<style id="ug-msg-style">
#ugm-btn{position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;align-items:center;gap:8px;
padding:10px 15px;border-radius:999px;border:1px solid var(--color-border-default,#37322c);
background:var(--color-bg-surface,#211e1b);color:var(--color-text-primary,#f2e6cf);
font:13px ui-sans-serif,system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 22px -8px rgba(0,0,0,.55)}
#ugm-btn:hover{border-color:var(--color-accent,#e8a05b)}
#ugm-dot{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--color-accent,#e8a05b);
color:#1c1a18;font:600 11px ui-monospace,Menlo,monospace;display:none;align-items:center;justify-content:center}
#ugm-panel{position:fixed;right:18px;bottom:70px;z-index:2147483000;width:min(390px,calc(100vw - 36px));
height:min(460px,calc(100vh - 120px));display:none;flex-direction:column;border-radius:8px;overflow:hidden;
border:1px solid var(--color-border-default,#37322c);background:var(--color-bg-base,#1c1a18);
box-shadow:0 18px 50px -14px rgba(0,0,0,.7)}
#ugm-panel.open{display:flex}
#ugm-head{padding:10px 13px;border-bottom:1px solid var(--color-border-default,#37322c);
font:10px ui-monospace,Menlo,monospace;letter-spacing:.18em;text-transform:uppercase;
color:var(--color-text-muted,#8d806f);display:flex;justify-content:space-between;align-items:center}
#ugm-close{cursor:pointer;font-size:15px;line-height:1;background:none;border:0;color:inherit}
#ugm-log{flex:1;overflow-y:auto;padding:13px;display:flex;flex-direction:column;gap:10px}
.ugm-m{max-width:88%;padding:8px 11px;border-radius:4px;font:14px/1.55 ui-sans-serif,system-ui,sans-serif;
white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid var(--color-border-default,#37322c);
background:var(--color-bg-surface,#211e1b);color:var(--color-text-primary,#f2e6cf)}
.ugm-m.me{align-self:flex-end;border-color:var(--color-accent,#e8a05b)}
.ugm-who{font:9px ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;
color:var(--color-text-muted,#8d806f);margin-bottom:4px}
.ugm-m.me .ugm-who{color:var(--color-accent,#e8a05b)}
#ugm-form{display:flex;gap:7px;padding:10px;border-top:1px solid var(--color-border-default,#37322c)}
#ugm-t{flex:1;resize:none;height:54px;padding:8px;border-radius:4px;font:14px ui-sans-serif,system-ui,sans-serif;
border:1px solid var(--color-border-default,#37322c);background:var(--color-bg-surface,#211e1b);
color:var(--color-text-primary,#f2e6cf)}
#ugm-t:focus{outline:2px solid var(--color-accent,#e8a05b);outline-offset:1px}
#ugm-send{padding:0 15px;border:0;border-radius:4px;cursor:pointer;font:500 13px ui-sans-serif,system-ui,sans-serif;
background:var(--color-text-primary,#f2e6cf);color:var(--color-bg-base,#1c1a18)}
#ugm-send:disabled{opacity:.5;cursor:default}
.ugm-empty{color:var(--color-text-muted,#8d806f);font-style:italic;font-size:13px}
</style>
<button id="ugm-btn" aria-label="Messages to the agent">Messages<span id="ugm-dot">0</span></button>
<div id="ugm-panel" role="dialog" aria-label="Messages to the agent">
  <div id="ugm-head"><span>Messages to the agent</span><button id="ugm-close" aria-label="Close">&times;</button></div>
  <div id="ugm-log"><div class="ugm-empty">Write below \u2014 the agent reads this on its next orientation.</div></div>
  <form id="ugm-form"><textarea id="ugm-t" placeholder="Message the agent\u2026"></textarea>
  <button id="ugm-send" type="submit">Send</button></form>
</div>
<script>(function(){
if(window.__ugMsgWidget)return; window.__ugMsgWidget=1;
var btn=document.getElementById('ugm-btn'),panel=document.getElementById('ugm-panel'),
log=document.getElementById('ugm-log'),dot=document.getElementById('ugm-dot'),
t=document.getElementById('ugm-t'),send=document.getElementById('ugm-send'),last='';
function toggle(open){panel.classList.toggle('open',open); if(open){t.focus(); pull();}}
btn.onclick=function(){toggle(!panel.classList.contains('open'))};
document.getElementById('ugm-close').onclick=function(){toggle(false)};
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&panel.classList.contains('open'))toggle(false)});
function pull(){
  fetch('/api/messages').then(function(r){return r.json()}).then(function(d){
    if(d.unanswered>0){dot.style.display='flex';dot.textContent=d.unanswered}else{dot.style.display='none'}
    var sig=JSON.stringify((d.messages||[]).map(function(m){return m.id+':'+m.answered}));
    if(sig===last)return; last=sig;
    if(!d.messages||!d.messages.length)return;
    log.innerHTML='';
    d.messages.forEach(function(m){
      var el=document.createElement('div');
      el.className='ugm-m '+(m.from==='human'?'me':'agent');
      var w=document.createElement('div'); w.className='ugm-who';
      w.textContent=(m.from==='human'?('you'+(m.answered?'':' \u00b7 unanswered')):'agent');
      el.appendChild(w); el.appendChild(document.createTextNode(m.text||''));
      log.appendChild(el);
    });
    log.scrollTop=log.scrollHeight;
  }).catch(function(){});
}
function submit(e){
  if(e)e.preventDefault();
  var text=(t.value||'').trim(); if(!text)return;
  send.disabled=true;
  fetch('/api/messages',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({text:text})}).then(function(){t.value='';last='';pull()})
    .finally(function(){send.disabled=false;t.focus()});
}
document.getElementById('ugm-form').addEventListener('submit',submit);
t.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey)submit(e)});
pull(); setInterval(pull,3000);
})();</script>`;

export function createMessagesRouter(_projectDir: string) {
  const messagesRouter = Router();

  /** Conversation, oldest first, with unanswered human messages flagged. */
  messagesRouter.get('/messages', (_req, res) => {
    try {
      const messages = listMessages();
      res.json({
        messages,
        unanswered: messages.filter((m) => m.from === 'human' && !m.answered)
          .length,
      });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /** Human posts a message. Appends to transport; touches no graph state. */
  messagesRouter.post('/messages', (req, res) => {
    const body = req.body as { text?: unknown };
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) return res.status(400).json({ error: 'text is required' });
    if (text.length > 8000)
      return res.status(400).json({ error: 'text too long (max 8000 chars)' });
    try {
      res.json({ ok: true, id: appendMessage('User', text) });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /** Agent replies. Same transport, so answers appear in the panel. */
  messagesRouter.post('/messages/reply', (req, res) => {
    const body = req.body as { text?: unknown };
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) return res.status(400).json({ error: 'text is required' });
    try {
      res.json({ ok: true, id: appendMessage('Assistant', text) });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

/** Minimal chat surface, served standalone so the SPA needs no rebuild. */
messagesRouter.get('/messages-ui', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html><meta charset="utf-8">
<title>Messages</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#1c1a18;--fg:#f2e6cf;--dim:#8d806f;--rule:#37322c;--surf:#211e1b;--amber:#e8a05b}
@media (prefers-color-scheme:light){:root{--bg:#f0ede7;--fg:#1c1714;--dim:#6f6256;--rule:#d6d0c2;--surf:#faf8f4;--amber:#8f4f0d}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 ui-sans-serif,system-ui,sans-serif;
display:flex;flex-direction:column;height:100vh}
header{padding:12px 16px;border-bottom:1px solid var(--rule);font:11px ui-monospace,Menlo,monospace;
letter-spacing:.18em;text-transform:uppercase;color:var(--dim);display:flex;justify-content:space-between}
#log{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px}
.m{max-width:70ch;padding:10px 13px;border:1px solid var(--rule);background:var(--surf);border-radius:3px;
white-space:pre-wrap;overflow-wrap:anywhere}
.m.human{align-self:flex-end;border-color:var(--amber)}
.who{font:10px ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);
margin-bottom:5px}
.m.human .who{color:var(--amber)}
form{display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--rule)}
textarea{flex:1;resize:none;height:62px;background:var(--surf);color:var(--fg);border:1px solid var(--rule);
border-radius:3px;padding:9px;font:inherit}
textarea:focus{outline:2px solid var(--amber);outline-offset:1px}
button{background:var(--fg);color:var(--bg);border:0;border-radius:3px;padding:0 18px;font-weight:500;cursor:pointer}
button:disabled{opacity:.5;cursor:default}
.empty{color:var(--dim);font-style:italic}
</style>
<header><span>Messages to the agent</span><span id="st">—</span></header>
<div id="log"><div class="empty">Nothing yet. Write below; the agent reads this on its next orientation.</div></div>
<form id="f"><textarea id="t" placeholder="Message the agent…  (Enter sends, Shift+Enter newline)"></textarea>
<button id="b">Send</button></form>
<script>
const log=document.getElementById('log'),st=document.getElementById('st');
const proj=new URLSearchParams(location.search).get('project')||'';
let last='';
async function pull(){
  try{
    const r=await fetch('/api/messages'+(proj?'?project='+encodeURIComponent(proj):''));
    const d=await r.json();
    const sig=JSON.stringify(d.messages.map(m=>m.id));
    st.textContent=d.messages.length+' · '+d.unanswered+' unanswered';
    if(sig===last)return; last=sig;
    if(!d.messages.length)return;
    log.innerHTML='';
    for(const m of d.messages){
      const el=document.createElement('div');
      el.className='m '+(m.from==='human'?'human':'agent');
      el.innerHTML='<div class="who">'+(m.from==='human'?'you':'agent')+'</div>';
      el.appendChild(document.createTextNode(m.text));
      log.appendChild(el);
    }
    log.scrollTop=log.scrollHeight;
  }catch(e){st.textContent='offline'}
}
async function send(){
  const t=document.getElementById('t'),b=document.getElementById('b');
  const text=t.value.trim(); if(!text)return;
  b.disabled=true;
  try{
    await fetch('/api/messages',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({text,project:proj||undefined})});
    t.value=''; last=''; await pull();
  }finally{b.disabled=false;t.focus()}
}
document.getElementById('f').addEventListener('submit',e=>{e.preventDefault();send()});
document.getElementById('t').addEventListener('keydown',e=>{
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});
pull(); setInterval(pull,2000);
</script>`);
});

  return messagesRouter;
}
