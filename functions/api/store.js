// 購物紀錄／待辦打勾／出發日：讀寫都需要 x-edit-key（內容含消費紀錄，不公開）
const OK = new Set(['ledger', 'checks', 'start', 'shared', 'people']);
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
  const okPeople = Array.isArray(b.v) && b.v.length > 0 && b.v.length <= 8 && b.v.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 12);
  const ok = k === 'people' ? okPeople : (k === 'ledger' || k === 'shared') ? Array.isArray(b.v) : k === 'checks' ? b.v && typeof b.v === 'object' && !Array.isArray(b.v) : typeof b.v === 'string' && b.v.length < 20;
  if (!ok) return reply({ error: 'type' }, 400);
  let v = b.v;
  if (k === 'shared') { // 共同帳：兩支手機各自新增也不會互相覆蓋，依 id 合併、較新的修改（m）勝出
    let old = [];
    try { old = JSON.parse((await env.PLAN.get('s:shared')) || '{}').v || []; } catch { old = []; }
    const m = new Map();
    for (const e of [...old, ...v]) {
      if (!e || typeof e !== 'object' || !Number.isFinite(e.id)) continue;
      const o = m.get(e.id);
      if (!o || (e.m || 0) > (o.m || 0)) m.set(e.id, e);
    }
    v = [...m.values()].sort((x, y) => x.id - y.id).slice(-1000);
  }
  const doc = { v, u: Number.isFinite(b.u) ? b.u : Date.now() };
  await env.PLAN.put('s:' + k, JSON.stringify(doc));
  return reply(doc);
}
