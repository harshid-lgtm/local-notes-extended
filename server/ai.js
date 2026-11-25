// AI providers for Local Notes. Shared by the desktop/local server and the team server.
// Every provider exposes the same thing: an async generator of text deltas.
'use strict';

const PROVIDERS = {
  anthropic: { label: 'Anthropic Claude', needsKey: true, keyHint: 'sk-ant-…', keyUrl: 'https://console.anthropic.com/settings/keys', defaultModel: 'claude-opus-5-5' },
  openai: { label: 'OpenAI', needsKey: true, keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys', baseUrl: 'https://api.openai.com/v1' },
  gemini: { label: 'Google Gemini', needsKey: true, keyHint: 'AIza…', keyUrl: 'https://aistudio.google.com/app/apikey', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  ollama: { label: 'Ollama (local, free)', needsKey: false, baseUrl: 'http://localhost:11434', free: true },
  compatible: { label: 'OpenAI-compatible (OpenRouter, LM Studio, Groq…)', needsKey: false, needsBaseUrl: true, baseUrl: '' },
};

// Claude models that accept the server-side refusal fallback ("default" routing).
const CLAUDE_FALLBACK = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/;
const CLAUDE_EFFORT = /^claude-(fable-5|mythos-5|opus-5|sonnet-5|haiku-5|opus-4-[5-8]|sonnet-4-6|opus-4-6)/;

class AIError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

function publicSettings(s = {}) {
  const keys = s.keys || {};
  return {
    enabled: !!(s.provider && (!PROVIDERS[s.provider]?.needsKey || keys[s.provider])),
    provider: s.provider || null,
    model: s.model || null,
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({
      id, label: p.label, needsKey: p.needsKey, keyHint: p.keyHint || '', keyUrl: p.keyUrl || '', free: !!p.free,
      needsBaseUrl: !!p.needsBaseUrl, hasKey: !!keys[id],
      keyPreview: keys[id] ? `${keys[id].slice(0, 6)}…${keys[id].slice(-4)}` : '',
      baseUrl: (s.baseUrls || {})[id] || p.baseUrl || '',
    })),
  };
}

// Merge an update from the settings screen. apiKey: undefined = keep, '' = remove.
function applySettings(current = {}, update = {}) {
  const next = { provider: current.provider || null, model: current.model || null, keys: { ...(current.keys || {}) }, baseUrls: { ...(current.baseUrls || {}) } };
  if (update.provider !== undefined) {
    if (update.provider && !PROVIDERS[update.provider]) throw new AIError('Unknown AI provider', 400);
    next.provider = update.provider || null;
  }
  const target = update.provider || next.provider;
  if (update.model !== undefined) next.model = String(update.model || '').trim() || null;
  if (target && update.apiKey !== undefined) {
    const k = String(update.apiKey || '').trim();
    if (k) next.keys[target] = k; else delete next.keys[target];
  }
  if (target && update.baseUrl !== undefined) {
    const u = String(update.baseUrl || '').trim().replace(/\/+$/, '');
    if (u && !/^https?:\/\//i.test(u)) throw new AIError('The address must start with http:// or https://', 400);
    if (u) next.baseUrls[target] = u; else delete next.baseUrls[target];
  }
  return next;
}

function resolve(settings, override = {}) {
  const provider = override.provider || settings.provider;
  const def = PROVIDERS[provider];
  if (!def) throw new AIError('Choose an AI provider in Settings → AI first', 400);
  const apiKey = override.apiKey || (settings.keys || {})[provider] || '';
  if (def.needsKey && !apiKey) throw new AIError(`Add your ${def.label} API key in Settings → AI`, 400);
  const baseUrl = (override.baseUrl || (settings.baseUrls || {})[provider] || def.baseUrl || '').replace(/\/+$/, '');
  if (def.needsBaseUrl && !baseUrl) throw new AIError('Enter the server address for your OpenAI-compatible provider', 400);
  const model = override.model || settings.model || def.defaultModel || '';
  return { provider, def, apiKey, baseUrl, model };
}

// ------------------------------------------------------------------ HTTP helpers
async function httpJson(url, opts = {}) {
  let r;
  try { r = await fetch(url, opts); } catch (e) { throw new AIError(`Can’t reach ${new URL(url).host}: ${e.cause?.code || e.message}`); }
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!r.ok) throw new AIError(providerError(body) || `${r.status} ${r.statusText}`, r.status === 401 || r.status === 403 ? 401 : 502);
  return body;
}

const providerError = (b) => b?.error?.message || b?.error?.status || (typeof b?.error === 'string' ? b.error : '') || b?.message || '';

async function* sseLines(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      yield line;
    }
  }
  if (buf.trim()) yield buf;
}

async function streamingFetch(url, opts) {
  let r;
  try { r = await fetch(url, opts); } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new AIError(`Can’t reach ${new URL(url).host}: ${e.cause?.code || e.message}`);
  }
  if (!r.ok) {
    let msg = '';
    try { msg = providerError(JSON.parse(await r.text())); } catch { /* not json */ }
    throw new AIError(msg || `${r.status} ${r.statusText}`, r.status === 401 || r.status === 403 ? 401 : 502);
  }
  return r;
}

// ------------------------------------------------------------------ providers
function createAI({ Anthropic }) {
  async function* streamAnthropic(c, { system, messages, effort, maxTokens, signal }) {
    const client = new Anthropic({ apiKey: c.apiKey, ...(c.baseUrl ? { baseURL: c.baseUrl } : {}) });
    const params = { model: c.model, max_tokens: maxTokens || 16000, system, messages };
    if (effort && CLAUDE_EFFORT.test(c.model)) params.output_config = { effort };
    if (CLAUDE_FALLBACK.test(c.model)) { params.betas = ['server-side-fallback-2026-07-01']; params.fallbacks = 'default'; }
    let stream;
    try {
      stream = client.beta.messages.stream(params, { signal });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield event.delta.text;
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === 'refusal') throw new AIError('Claude declined this request.', 422);
    } catch (e) {
      if (e instanceof AIError || e.name === 'AbortError') throw e;
      if (e instanceof Anthropic.AuthenticationError) throw new AIError('Your Anthropic API key was rejected', 401);
      if (e instanceof Anthropic.RateLimitError) throw new AIError('Anthropic rate limit reached — try again in a moment', 429);
      if (e instanceof Anthropic.NotFoundError) throw new AIError(`Model “${c.model}” isn’t available on your Anthropic account`, 400);
      if (e instanceof Anthropic.APIError) throw new AIError(e.message, e.status || 502);
      throw new AIError(e.message || 'The AI request failed');
    }
  }

  async function* streamOpenAI(c, { system, messages, signal }) {
    const r = await streamingFetch(`${c.baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}) },
      body: JSON.stringify({ model: c.model, stream: true, messages: [{ role: 'system', content: system }, ...messages] }),
    });
    for await (const line of sseLines(r)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') break;
      try {
        const j = JSON.parse(data);
        if (j.error) throw new AIError(providerError(j));
        const t = j.choices?.[0]?.delta?.content;
        if (t) yield t;
      } catch (e) { if (e instanceof AIError) throw e; }
    }
  }

  async function* streamGemini(c, { system, messages, signal }) {
    const model = c.model.replace(/^models\//, '');
    const r = await streamingFetch(`${c.baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      }),
    });
    for await (const line of sseLines(r)) {
      if (!line.startsWith('data:')) continue;
      try {
        const j = JSON.parse(line.slice(5));
        for (const p of j.candidates?.[0]?.content?.parts || []) if (p.text) yield p.text;
      } catch { /* keep-alive */ }
    }
  }

  async function* streamOllama(c, { system, messages, signal }) {
    const r = await streamingFetch(`${c.baseUrl}/api/chat`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: c.model, stream: true, messages: [{ role: 'system', content: system }, ...messages] }),
    });
    for await (const line of sseLines(r)) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        if (j.error) throw new AIError(j.error);
        if (j.message?.content) yield j.message.content;
      } catch (e) { if (e instanceof AIError) throw e; }
    }
  }

  function stream(settings, request, override) {
    const c = resolve(settings, override);
    if (!c.model) throw new AIError('Choose a model in Settings → AI', 400);
    if (c.provider === 'anthropic') return streamAnthropic(c, request);
    if (c.provider === 'gemini') return streamGemini(c, request);
    if (c.provider === 'ollama') return streamOllama(c, request);
    return streamOpenAI(c, request);
  }

  async function listModels(settings, override) {
    const c = resolve(settings, override);
    if (c.provider === 'anthropic') {
      const client = new Anthropic({ apiKey: c.apiKey });
      const ids = [];
      try {
        for await (const m of client.models.list()) ids.push(m.id);
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) throw new AIError('Your Anthropic API key was rejected', 401);
        throw new AIError(e.message || 'Couldn’t load models');
      }
      return ids;
    }
    if (c.provider === 'gemini') {
      const j = await httpJson(`${c.baseUrl}/models?pageSize=200`, { headers: { 'x-goog-api-key': c.apiKey } });
      return (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
    }
    if (c.provider === 'ollama') {
      const j = await httpJson(`${c.baseUrl}/api/tags`);
      return (j.models || []).map((m) => m.name);
    }
    const j = await httpJson(`${c.baseUrl}/models`, { headers: c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {} });
    return (j.data || []).map((m) => m.id).filter((id) => !/embed|whisper|tts|dall-e|moderation|audio|transcribe|image|realtime|search/i.test(id)).sort();
  }

  async function test(settings, override) {
    let out = '';
    for await (const t of stream(settings, { system: 'You are a connection test. Reply with exactly: OK', messages: [{ role: 'user', content: 'Reply with OK.' }], effort: 'low', maxTokens: 2000 }, override)) out += t;
    return out.trim().slice(0, 80);
  }

  return { stream, listModels, test };
}

// ------------------------------------------------------------------ notes retrieval for "Ask your notes"
const STOP = new Set('a an and are as at be but by can do does for from has have how i in into is it its me my of on or our should so that the their them then there these they this to was we what when where which who why will with would you your about after all also any been before both each few more most other some such than too very just over only own same'.split(' '));

function keywords(q) {
  return [...new Set(String(q).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]{1,}/gu) || [])].filter((w) => !STOP.has(w));
}

// docs: [{ id, title, text, updatedAt? }] — returns the best matches, current page first.
function pickNotes(question, docs, { currentId = null, limit = 6, maxChars = 60000 } = {}) {
  const words = keywords(question);
  const scored = docs.map((d) => {
    const title = d.title.toLowerCase();
    const body = d.text.toLowerCase();
    let score = d.id === currentId ? 1000 : 0;
    for (const w of words) {
      if (title.includes(w)) score += 12;
      let i = -1, n = 0;
      while ((i = body.indexOf(w, i + 1)) >= 0 && n < 20) n++;
      score += n;
    }
    // phrases from the question ("design partners") are a much stronger signal than single words
    for (let k = 0; k < words.length - 1; k++) {
      const phrase = `${words[k]} ${words[k + 1]}`;
      if (body.includes(phrase)) score += 10;
      if (title.includes(phrase)) score += 15;
    }
    return { d, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  const picked = [];
  let used = 0;
  for (const { d } of scored) {
    const room = Math.max(0, maxChars - used);
    if (room < 400) break;
    const text = d.text.length > room ? `${d.text.slice(0, room)}\n…` : d.text;
    picked.push({ ...d, text });
    used += text.length;
  }
  return picked;
}

function askPrompt(notes, vaultName) {
  const ctx = notes.map((n) => `<note title="${n.title.replace(/"/g, "'")}">\n${n.text}\n</note>`).join('\n\n');
  return {
    system: `You are the assistant inside Local Notes, a markdown notes app. Answer the user's question using their notes from “${vaultName}” below.
Rules:
- Base your answer on the notes. If they don't contain the answer, say so briefly, then give general guidance clearly marked as not from their notes.
- Cite the notes you used inline as wikilinks, exactly like [[Note title]].
- Write in concise markdown: short paragraphs, bullet points where helpful. No preamble.

${ctx || '(No matching notes were found.)'}`,
  };
}

module.exports = { createAI, PROVIDERS, publicSettings, applySettings, pickNotes, askPrompt, AIError };
