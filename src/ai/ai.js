// AI features: provider settings, selection actions, "write with AI", page tools and
// an "Ask your notes" chat. Works against the local server or a team server.
import MarkdownIt from 'markdown-it';
import { icon } from '../icons.js';
import { $, h, esc, showMenu, closeMenu, openModal, toast, copyText } from '../ui.js';

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

// Where AI requests go. The team module swaps this for its server + token.
let transport = { base: '', headers: () => ({}), canConfigure: true, label: 'this computer' };
export function setAITransport(t) { transport = { ...transport, ...t }; }
export const resetAITransport = () => { transport = { base: '', headers: () => ({}), canConfigure: true, label: 'this computer' }; };

let hooks = { openLink: () => {}, vaultName: () => 'your notes', currentPage: () => null };
export function setAIHooks(h2) { hooks = { ...hooks, ...h2 }; }

async function call(method, path, body) {
  const r = await fetch(transport.base + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...transport.headers() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || r.statusText); e.status = r.status; throw e; }
  return j;
}

// Streams NDJSON from /api/ai/complete or /api/ai/ask.
function streamAI(path, body, { onDelta, onSources }) {
  const ac = new AbortController();
  const done = (async () => {
    const r = await fetch(transport.base + path, {
      method: 'POST', signal: ac.signal,
      headers: { 'Content-Type': 'application/json', ...transport.headers() },
      body: JSON.stringify(body),
    });
    if (!r.ok) { const j = await r.json().catch(() => ({})); const e = new Error(j.error || r.statusText); e.status = r.status; throw e; }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let text = '';
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const m = JSON.parse(line);
        if (m.error) throw new Error(m.error);
        if (m.sources) onSources?.(m.sources);
        if (m.delta) { text += m.delta; onDelta?.(text, m.delta); }
      }
    }
    return text;
  })();
  return { done, abort: () => ac.abort() };
}

let status = null;
export async function aiStatus(force = false) {
  if (status && !force) return status;
  try { status = await call('GET', transport.statusPath || '/api/ai/settings'); } catch { status = { enabled: false }; }
  return status;
}
export const forgetAIStatus = () => { status = null; };

async function requireAI() {
  const s = await aiStatus();
  if (s.enabled) return true;
  if (transport.canConfigure) openAISettings({ intro: true });
  else toast('AI isn’t set up on this team server yet. Ask your admin to turn it on.');
  return false;
}

// ================================================================== settings
const SHORT_NAME = { anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini', ollama: 'Ollama', compatible: 'Custom API' };
const PROVIDER_ART = {
  anthropic: ['#d97757', 'A'], openai: ['#10a37f', 'O'], gemini: ['#4285f4', 'G'], ollama: ['#2b2a27', '🦙'], compatible: ['#7c4fd6', '⇄'],
};

export async function openAISettings({ intro = false } = {}) {
  let s;
  try { s = await call('GET', '/api/ai/settings'); } catch (e) { toast(e.message, { kind: 'error' }); return; }
  let provider = s.provider || 'anthropic';
  let models = [];
  const box = h(`<div class="ai-set">
    <div class="ai-set-head">
      <span class="ai-orb">${icon('sparkles', 22)}</span>
      <div><h2>${intro ? 'Turn on AI' : 'AI settings'}</h2>
      <p>Choose a provider and bring your own API key — or run models locally with Ollama for free. Requests go from ${esc(transport.label)} straight to the provider.</p></div>
      <button class="icon-btn" data-close>${icon('x', 18)}</button>
    </div>
    <div class="ai-providers"></div>
    <div class="ai-fields"></div>
    <div class="ai-foot"><span class="ai-test-result"></span>
      <button class="btn ghost" data-test>${icon('check', 15)}<span>Test</span></button>
      <button class="btn primary" data-save>Save</button></div>
  </div>`);
  const m = openModal(box, { className: 'ai-modal' });
  $('[data-close]', box).onclick = () => m.close();

  const renderProviders = () => {
    $('.ai-providers', box).innerHTML = s.providers.map((p) => {
      const [c, l] = PROVIDER_ART[p.id] || ['#888', '?'];
      return `<button class="ai-prov ${p.id === provider ? 'on' : ''}" data-prov="${p.id}">
        <span class="ai-prov-logo" style="--c:${c}">${l}</span>
        <span class="ai-prov-name">${esc(SHORT_NAME[p.id] || p.label)}</span>
        <span class="ai-prov-sub">${p.free ? 'Free · runs locally' : p.id === 'compatible' ? 'OpenRouter, LM Studio…' : p.hasKey ? 'Key saved' : 'Needs API key'}</span>
        ${p.id === s.provider && s.enabled ? `<span class="ai-prov-active">${icon('check', 12, 2.5)}</span>` : ''}
      </button>`;
    }).join('');
  };
  const cur = () => s.providers.find((p) => p.id === provider);
  const renderFields = () => {
    const p = cur();
    $('.ai-fields', box).innerHTML = `
      ${p.needsKey || p.id === 'compatible' ? `<label class="field"><span>API key ${p.keyUrl ? `<a href="${p.keyUrl}" target="_blank" rel="noopener">Get a key ${icon('external', 12)}</a>` : ''}</span>
        <input name="apiKey" type="password" autocomplete="off" spellcheck="false" placeholder="${p.hasKey ? `Saved (${esc(p.keyPreview)}) — paste to replace` : esc(p.keyHint || 'Optional')}"></label>` : ''}
      ${p.id === 'ollama' || p.id === 'compatible' ? `<label class="field"><span>Server address</span><input name="baseUrl" spellcheck="false" value="${esc(p.baseUrl)}" placeholder="${p.id === 'ollama' ? 'http://localhost:11434' : 'https://openrouter.ai/api/v1'}"></label>` : ''}
      <label class="field"><span>Model <button class="link-btn small" data-load>Load available models</button></span>
        <div class="ai-model"><input name="model" list="ai-models" spellcheck="false" value="${esc(provider === s.provider ? s.model || '' : provider === 'anthropic' ? 'claude-opus-5-5' : '')}" placeholder="${provider === 'anthropic' ? 'claude-opus-5-5' : 'Pick or type a model name'}">
        <datalist id="ai-models">${models.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div></label>
      ${p.id === 'ollama' ? `<p class="ai-note">${icon('info', 14)}<span>Install <a href="https://ollama.com" target="_blank" rel="noopener">Ollama</a>, run <code>ollama pull llama3.2</code>, then press <b>Load available models</b>. Nothing leaves your computer.</span></p>` : ''}
      ${p.id === 'anthropic' ? `<p class="ai-note">${icon('info', 14)}<span>Claude Opus 5.5 is the default. Pick a smaller model such as Claude Haiku for lower cost.</span></p>` : ''}`;
    $('[data-load]', box).onclick = (e) => { e.preventDefault(); loadModels(); };
  };
  const form = () => {
    const v = (n) => $(`.ai-fields [name=${n}]`, box)?.value?.trim();
    return { provider, apiKey: v('apiKey') || undefined, baseUrl: v('baseUrl'), model: v('model') };
  };
  const result = (text, kind = '') => { const el = $('.ai-test-result', box); el.className = `ai-test-result ${kind}`; el.innerHTML = text; };
  async function loadModels() {
    result(`<span class="spin"></span>Loading models…`);
    try {
      const f = form();
      models = (await call('POST', '/api/ai/models', f)).models;
      const keep = f.model;
      renderFields();
      const input = $('.ai-fields [name=model]', box);
      if (f.apiKey) $('.ai-fields [name=apiKey]', box).value = f.apiKey;
      if (keep) input.value = keep;
      else if (models.length) input.value = provider === 'anthropic' && models.includes('claude-opus-5-5') ? 'claude-opus-5-5' : models[0];
      result(`${models.length} models available`, 'ok');
    } catch (e) { result(esc(e.message), 'bad'); }
  }
  $('.ai-providers', box).addEventListener('click', (e) => {
    const b = e.target.closest('[data-prov]');
    if (!b) return;
    provider = b.dataset.prov;
    models = [];
    renderProviders();
    renderFields();
    result('');
  });
  $('[data-test]', box).onclick = async () => {
    result(`<span class="spin"></span>Testing…`);
    try { const r = await call('POST', '/api/ai/test', form()); result(`${icon('success', 14)}Connected — the model replied “${esc(r.reply)}”`, 'ok'); } catch (e) { result(esc(e.message), 'bad'); }
  };
  $('[data-save]', box).onclick = async () => {
    try {
      s = await call('PUT', '/api/ai/settings', form());
      forgetAIStatus();
      if (!s.enabled) { result('Add an API key to finish setting up this provider.', 'bad'); renderProviders(); return; }
      m.close();
      toast(`AI is on — using ${s.model}`, { kind: 'success' });
    } catch (e) { result(esc(e.message), 'bad'); }
  };
  renderProviders();
  renderFields();
}

// ================================================================== prompts
const SYSTEM_EDIT = `You are the writing assistant inside Local Notes, a markdown notes app.
Return only the resulting text, formatted as markdown — no preface, no explanations, no surrounding quotes or code fences.
Keep the original language unless asked to translate. Keep [[wikilinks]], links and formatting intact.`;

const SYSTEM_WRITE = `You are the writing assistant inside Local Notes, a markdown notes app.
Write directly in markdown (headings, lists, checklists, tables when useful). Return only the content to insert — no preface or sign-off.
Match the language and style of the page.`;

const TONES = ['Professional', 'Friendly', 'Confident', 'Casual', 'Direct'];
const LANGS = ['English', 'Spanish', 'French', 'German', 'Portuguese', 'Italian', 'Hindi', 'Chinese (Simplified)', 'Japanese', 'Arabic'];

const EDIT_ACTIONS = [
  { id: 'improve', label: 'Improve writing', icon: 'sparkles', prompt: 'Improve this writing: make it clearer and more concise with better flow. Keep the meaning and tone.' },
  { id: 'fix', label: 'Fix spelling & grammar', icon: 'check', prompt: 'Fix spelling, grammar and punctuation only. Change nothing else.' },
  { id: 'shorter', label: 'Make shorter', icon: 'zoom-out', prompt: 'Make this shorter while keeping the key points.' },
  { id: 'longer', label: 'Make longer', icon: 'zoom-in', prompt: 'Expand this with more detail and supporting points, in the same style.' },
  { id: 'simplify', label: 'Simplify language', icon: 'text', prompt: 'Rewrite this in plain, simple language anyone can understand.' },
  { id: 'tone', label: 'Change tone', icon: 'note', sub: TONES.map((t) => ({ label: t, prompt: `Rewrite this in a ${t.toLowerCase()} tone.` })) },
  { id: 'translate', label: 'Translate', icon: 'switch', sub: LANGS.map((l) => ({ label: l, prompt: `Translate this into ${l}. Keep the formatting.` })) },
];
const INSERT_ACTIONS = [
  { id: 'summarize', label: 'Summarize', icon: 'book', prompt: 'Summarize this in a few bullet points.', insert: true },
  { id: 'explain', label: 'Explain', icon: 'info', prompt: 'Explain this clearly and briefly, as if to a smart colleague new to the topic.', insert: true },
  { id: 'actions', label: 'Find action items', icon: 'todo', prompt: 'Extract the action items as a markdown task list (- [ ] …). If there are none, reply "No action items."', insert: true },
];

// Send selections as markdown so links, [[wikilinks]] and formatting survive the round trip.
function selectionMarkdown(editor, from, to) {
  try {
    const out = editor.storage.markdown.serializer.serialize(editor.state.doc.slice(from, to).content).trim();
    if (out) return out;
  } catch { /* fall back to plain text */ }
  return editor.state.doc.textBetween(from, to, '\n\n', (node) => node.attrs?.target ? `[[${node.attrs.target}]]` : '');
}

// ================================================================== selection menu ("Ask AI")
export async function openAIMenu(editor, anchor) {
  if (!(await requireAI())) return;
  const { from, to, empty } = editor.state.selection;
  if (empty) return openWritePanel(editor);
  const text = selectionMarkdown(editor, from, to);
  const run = (a) => runOnSelection(editor, { from, to, text }, a);
  const custom = h(`<form class="ai-ask-input"><span>${icon('sparkles', 15)}</span><input placeholder="Ask AI to edit or write…" spellcheck="false"></form>`);
  custom.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('input', custom).value.trim();
    if (q) { closeMenu(); run({ label: q, prompt: q, custom: true }); }
  });
  custom.addEventListener('mousedown', (e) => e.stopPropagation());
  const items = [
    { custom },
    { header: 'Edit selection' },
    ...EDIT_ACTIONS.map((a) => (a.sub ? { label: `${a.label} ›`, icon: a.icon, run: () => setTimeout(() => showMenu([{ header: a.label }, ...a.sub.map((s) => ({ label: s.label, run: () => run({ ...s, label: `${a.label}: ${s.label}` }) }))], anchor, { className: 'ai-menu' })) } : { label: a.label, icon: a.icon, run: () => run(a) })),
    { header: 'Generate from selection' },
    ...INSERT_ACTIONS.map((a) => ({ label: a.label, icon: a.icon, run: () => run(a) })),
  ];
  showMenu(items, anchor, { className: 'ai-menu' });
  setTimeout(() => $('input', custom).focus(), 30);
}

function runOnSelection(editor, sel, action) {
  const prompt = action.custom
    ? `${action.prompt}\n\nApply this to the text below. If the request is a question about the text, answer it instead.\n\n<text>\n${sel.text}\n</text>`
    : `${action.prompt}\n\n<text>\n${sel.text}\n</text>`;
  openResult(editor, {
    title: action.label,
    request: { system: action.insert ? SYSTEM_WRITE : SYSTEM_EDIT, prompt, effort: 'low' },
    range: sel,
    primary: action.insert ? 'below' : 'replace',
  });
}

// ================================================================== write with AI (empty selection or /ai)
export async function openWritePanel(editor) {
  if (!(await requireAI())) return;
  const pos = editor.state.selection.from;
  const coords = editor.view.coordsAtPos(pos);
  const panel = h(`<div class="ai-panel pop ai-write">
    <form class="ai-ask-input big"><span class="ai-orb sm">${icon('sparkles', 15)}</span><input placeholder="Tell AI what to write…" spellcheck="false"><button class="icon-btn" type="submit">${icon('arrow-right', 16)}</button></form>
    <div class="ai-suggest">
      ${[['continue', 'Continue writing', 'feather'], ['brainstorm', 'Brainstorm ideas', 'sparkles'], ['outline', 'Draft an outline', 'numbered'], ['summary', 'Summarize this page', 'book'], ['actions', 'Action items from this page', 'todo']]
        .map(([id, label, ic]) => `<button data-s="${id}">${icon(ic, 15)}<span>${label}</span></button>`).join('')}
    </div></div>`);
  document.body.append(panel);
  positionPanel(panel, coords);
  const close = () => { panel.remove(); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', onKey, true); };
  const outside = (e) => { if (!panel.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); editor.commands.focus(); } };
  setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', onKey, true); });
  const input = $('input', panel);
  input.focus();
  const pageText = () => {
    const page = hooks.currentPage();
    const body = editor.storage.markdown.getMarkdown();
    return `Page title: ${page?.title || 'Untitled'}\n\n<page>\n${body.slice(0, 40000)}\n</page>`;
  };
  const go = (instruction, kind = 'write') => {
    close();
    const before = editor.state.doc.textBetween(Math.max(0, pos - 3000), pos, '\n\n');
    const prompt = kind === 'continue'
      ? `${pageText()}\n\nContinue writing from where this text ends, in the same voice. Write one or two paragraphs.\n\n<text-before-cursor>\n${before}\n</text-before-cursor>`
      : `${pageText()}\n\n${instruction}`;
    openResult(editor, { title: kind === 'continue' ? 'Continue writing' : instruction, request: { system: SYSTEM_WRITE, prompt, effort: kind === 'page' ? 'medium' : 'low' }, range: { from: pos, to: pos }, primary: 'insert' });
  };
  $('form', panel).addEventListener('submit', (e) => { e.preventDefault(); const q = input.value.trim(); if (q) go(q); });
  $('.ai-suggest', panel).addEventListener('click', (e) => {
    const s = e.target.closest('[data-s]')?.dataset.s;
    if (s === 'continue') go('', 'continue');
    if (s === 'brainstorm') go('Brainstorm 8–10 fresh ideas related to this page as a bullet list.');
    if (s === 'outline') go('Draft a clear outline for this page as markdown headings with short bullet points.');
    if (s === 'summary') go('Summarize this page as a short TL;DR followed by key points.', 'page');
    if (s === 'actions') go('Extract all action items from this page as a markdown task list (- [ ] …).', 'page');
  });
}

export function summarizePage(editor, kind = 'summary') {
  requireAI().then((ok) => {
    if (!ok) return;
    const page = hooks.currentPage();
    const body = editor.storage.markdown.getMarkdown();
    const instruction = kind === 'actions'
      ? 'Extract all action items from this page as a markdown task list (- [ ] …), with owners or dates when mentioned.'
      : 'Write a TL;DR of this page: one sentence, then 3–6 key points as bullets.';
    openResult(editor, {
      title: kind === 'actions' ? 'Action items' : 'Page summary',
      request: { system: SYSTEM_WRITE, prompt: `Page title: ${page?.title || 'Untitled'}\n\n<page>\n${body.slice(0, 60000)}\n</page>\n\n${instruction}`, effort: 'medium' },
      range: { from: 1, to: 1 },
      primary: 'top',
      anchorTop: true,
    });
  });
}

// ================================================================== result panel
function positionPanel(panel, coords) {
  const w = Math.min(560, innerWidth - 24);
  panel.style.width = `${w}px`;
  let left = Math.min(Math.max(12, coords.left - 24), innerWidth - w - 12);
  let top = coords.bottom + 10;
  const hgt = panel.offsetHeight || 220;
  if (top + hgt > innerHeight - 12) top = Math.max(12, coords.top - hgt - 10);
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function openResult(editor, { title, request, range, primary, anchorTop = false }) {
  const panel = h(`<div class="ai-panel pop ai-result">
    <div class="ai-result-head"><span class="ai-orb sm">${icon('sparkles', 14)}</span><span class="ai-result-title">${esc(title)}</span><span class="ai-status"><span class="spin"></span>Writing…</span><button class="icon-btn tiny" data-x title="Discard (Esc)">${icon('x', 15)}</button></div>
    <div class="ai-result-body prose"><div class="ai-typing"><i></i><i></i><i></i></div></div>
    <div class="ai-result-actions" hidden>
      ${editor.isEditable ? (primary === 'replace' ? `<button class="btn primary small" data-act="replace">${icon('check', 14, 2)}<span>Replace selection</span></button><button class="btn ghost small" data-act="below">Insert below</button>`
        : primary === 'top' ? `<button class="btn primary small" data-act="top">${icon('check', 14, 2)}<span>Insert at top</span></button><button class="btn ghost small" data-act="end">Insert at end</button>`
          : `<button class="btn primary small" data-act="${primary === 'below' ? 'below' : 'insert'}">${icon('check', 14, 2)}<span>Insert</span></button>`) : ''}
      <button class="btn ghost small" data-act="copy">${icon('copy', 14)}<span>Copy</span></button>
      <button class="btn ghost small" data-act="retry">${icon('switch', 14)}<span>Try again</span></button>
    </div></div>`);
  document.body.append(panel);
  const anchor = anchorTop ? (() => { const r = editor.view.dom.getBoundingClientRect(); return { left: r.left + 24, top: r.top, bottom: Math.max(90, r.top) }; })()
    : editor.view.coordsAtPos(Math.min(range.to, editor.state.doc.content.size));
  positionPanel(panel, anchor);
  const body = $('.ai-result-body', panel);
  let text = '';
  let job = null;
  const close = () => { job?.abort(); panel.remove(); document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', outside, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); editor.commands.focus(); } };
  const outside = (e) => { if (!panel.contains(e.target) && !e.target.closest('.menu')) close(); };
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => document.addEventListener('mousedown', outside, true), 50);

  const start = () => {
    text = '';
    body.innerHTML = '<div class="ai-typing"><i></i><i></i><i></i></div>';
    $('.ai-result-actions', panel).hidden = true;
    $('.ai-status', panel).innerHTML = '<span class="spin"></span>Writing…';
    job = streamAI('/api/ai/complete', request, {
      onDelta: (t) => { text = t; body.innerHTML = md.render(t); body.scrollTop = body.scrollHeight; },
    });
    job.done.then(() => {
      $('.ai-status', panel).innerHTML = `${icon('success', 13)}Done`;
      $('.ai-result-actions', panel).hidden = false;
      $('.ai-result-actions .btn.primary', panel)?.focus();
    }).catch((e) => {
      if (e.name === 'AbortError') return;
      body.innerHTML = `<div class="ai-error">${icon('error', 16)}<span>${esc(e.message)}</span>${transport.canConfigure ? '<button class="link-btn" data-settings>Open AI settings</button>' : ''}</div>`;
      $('.ai-status', panel).textContent = '';
      $('[data-settings]', panel)?.addEventListener('click', () => { close(); openAISettings(); });
    });
  };
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-x]')) return close();
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const clean = text.trim().replace(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/, '$1');
    const chain = editor.chain().focus();
    const opts = { parseOptions: { preserveWhitespace: false } };
    if (act === 'replace') chain.insertContentAt({ from: range.from, to: range.to }, clean, opts).run();
    else if (act === 'below') {
      const $to = editor.state.doc.resolve(range.to);
      const after = $to.depth ? $to.after(1) : range.to;
      chain.insertContentAt(after, clean, opts).run();
    } else if (act === 'insert') chain.insertContentAt(range.from, clean, opts).run();
    else if (act === 'top') chain.insertContentAt(0, `${clean}\n\n---\n`, opts).run();
    else if (act === 'end') chain.insertContentAt(editor.state.doc.content.size, `\n\n${clean}`, opts).run();
    else if (act === 'copy') { copyText(clean).then((ok) => toast(ok ? 'Copied' : 'Couldn’t copy', { kind: ok ? 'success' : 'error' })); return; }
    else if (act === 'retry') { start(); return; }
    close();
  });
  start();
}

// ================================================================== Ask your notes (chat)
let chat = null;
export async function toggleAskPanel() {
  if (chat) { chat.close(); return; }
  if (!(await requireAI())) return;
  const panel = h(`<aside class="ai-chat pop">
    <div class="ai-chat-head"><span class="ai-orb sm">${icon('sparkles', 14)}</span><h3>Ask your notes</h3>
      <button class="icon-btn tiny" data-new title="New chat">${icon('plus', 15)}</button>
      ${transport.canConfigure ? `<button class="icon-btn tiny" data-settings title="AI settings">${icon('pencil', 14)}</button>` : ''}
      <button class="icon-btn tiny" data-x title="Close">${icon('x', 15)}</button></div>
    <div class="ai-chat-body"></div>
    <form class="ai-chat-input"><textarea rows="1" placeholder="Ask anything about ${esc(hooks.vaultName())}…"></textarea><button class="btn primary small" type="submit">${icon('arrow-right', 15)}</button></form>
  </aside>`);
  document.body.append(panel);
  document.body.classList.add('ai-chat-open');
  const history = [];
  const bodyEl = $('.ai-chat-body', panel);
  const ta = $('textarea', panel);
  const empty = () => {
    bodyEl.innerHTML = `<div class="ai-chat-empty"><div class="ai-orb lg">${icon('sparkles', 26)}</div><strong>Ask about anything in your notes</strong><span>Answers cite the pages they come from.</span>
      <div class="ai-chips">${['What are my open action items?', 'Summarize this page', 'What did we decide about pricing?', 'Which pages mention onboarding?'].map((q) => `<button data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div></div>`;
  };
  empty();
  const renderAnswer = (el, text) => {
    el.innerHTML = md.render(text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, a) => `[${a || t}](#wikilink:${encodeURIComponent(t)})`));
  };
  const ask = (q) => {
    if (!q.trim()) return;
    bodyEl.querySelector('.ai-chat-empty')?.remove();
    bodyEl.append(h(`<div class="msg user">${esc(q)}</div>`));
    const ans = h('<div class="msg bot"><div class="msg-text prose"><div class="ai-typing"><i></i><i></i><i></i></div></div><div class="msg-sources"></div></div>');
    bodyEl.append(ans);
    bodyEl.scrollTop = bodyEl.scrollHeight;
    const page = hooks.currentPage();
    const job = streamAI(transport.askPath || '/api/ai/ask', { question: q, history: history.slice(-8), currentPath: page?.id || null, ...(transport.askExtra?.() || {}) }, {
      onSources: (src) => {
        $('.msg-sources', ans).innerHTML = src.length ? `<span>Sources</span>${src.map((s) => `<button data-open="${esc(s.title)}">${icon('page', 12)}${esc(s.title)}</button>`).join('')}` : '';
      },
      onDelta: (t) => { renderAnswer($('.msg-text', ans), t); bodyEl.scrollTop = bodyEl.scrollHeight; },
    });
    job.done.then((t) => { history.push({ role: 'user', content: q }, { role: 'assistant', content: t }); })
      .catch((e) => { $('.msg-text', ans).innerHTML = `<div class="ai-error">${icon('error', 16)}<span>${esc(e.message)}</span></div>`; });
  };
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-x]')) return chat.close();
    if (e.target.closest('[data-new]')) { history.length = 0; empty(); return undefined; }
    if (e.target.closest('[data-settings]')) return openAISettings();
    const q = e.target.closest('[data-q]');
    if (q) return ask(q.dataset.q);
    const o = e.target.closest('[data-open]');
    if (o) return hooks.openLink({ wikilink: o.dataset.open });
    const a = e.target.closest('a[href^="#wikilink:"]');
    if (a) { e.preventDefault(); return hooks.openLink({ wikilink: decodeURIComponent(a.getAttribute('href').slice(10)) }); }
    return undefined;
  });
  $('form', panel).addEventListener('submit', (e) => { e.preventDefault(); const q = ta.value; ta.value = ''; ta.style.height = 'auto'; ask(q); });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('form', panel).requestSubmit(); } });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(160, ta.scrollHeight)}px`; });
  ta.focus();
  chat = { close: () => { panel.remove(); document.body.classList.remove('ai-chat-open'); chat = null; } };
}
export const closeAskPanel = () => chat?.close();

