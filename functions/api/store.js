// 購物紀錄／待辦打勾／出發日：讀寫都需要 x-edit-key（內容含消費紀錄，不公開）
const OK = new Set(['ledger', 'checks', 'start']);
const H = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const reply = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: H });
function same(a, b) {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

export async function onRequest({ request, env }) {
  const key = request.headers.get('x-edit-key') || '';
  if (!env.EDIT_KEY || !same(key, env.EDIT_KEY)) return reply({ error: '編輯密碼不正確' }, 401);
  const k = new URL(request.url).searchParams.get('k') || '';
  if (!OK.has(k)) return reply({ error: 'key' }, 400);
  if (request.method === 'GET') return new Response((await env.PLAN.get('s:' + k)) || '{}', { headers: H });
  if (request.method !== 'PUT') return reply({ error: 'method' }, 405);
  const raw = await request.text();
  if (raw.length > 200000) return reply({ error: 'too large' }, 413);
  let b;
  try { b = JSON.parse(raw); } catch { return reply({ error: 'json' }, 400); }
  if (!b || typeof b !== 'object' || b.v === undefined) return reply({ error: 'body' }, 400);
  const ok = k === 'ledger' ? Array.isArray(b.v) : k === 'checks' ? b.v && typeof b.v === 'object' && !Array.isArray(b.v) : typeof b.v === 'string' && b.v.length < 20;
  if (!ok) return reply({ error: 'type' }, 400);
  const doc = { v: b.v, u: Number.isFinite(b.u) ? b.u : Date.now() };
  await env.PLAN.put('s:' + k, JSON.stringify(doc));
  return reply(doc);
}
