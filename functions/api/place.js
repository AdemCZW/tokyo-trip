// 新增景點：AI 把名稱轉成日文正式名稱、寫簡短介紹與建議停留時間，再用 OpenStreetMap 找「離前後站最近」的座標
// qwen3.8 實測對日本地名最準、不確定時會老實回 null；只有它出錯時才退回 mistral
const MODELS = ['@cf/qwen/qwen3.8-27b', '@cf/mistralai/mistral-small-3.1-24b-instruct'];
const H = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const reply = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: H });
function same(a, b) {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
const inKanto = (la, ln) => Number.isFinite(la) && Number.isFinite(ln) && la > 34.8 && la < 37.2 && ln > 138.4 && ln < 140.9;
const km = (a, b) => {
  const r = Math.PI / 180, x = (b.lat - a.lat) * r, y = (b.lng - a.lng) * r;
  const h = Math.sin(x / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(y / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
async function search(q) {
  try {
    const u = 'https://nominatim.openstreetmap.org/search?format=json&limit=8&countrycodes=jp&accept-language=ja&q=' + encodeURIComponent(q);
    const r = await fetch(u, { headers: { 'user-agent': 'tokyo-trip-planner/1.0 (personal trip site)' }, signal: AbortSignal.timeout(5000) });
    return (await r.json()).map((x) => ({ lat: Number(x.lat), lng: Number(x.lon) })).filter((x) => inKanto(x.lat, x.lng));
  } catch { return []; }
}
const pt = (p) => (p && inKanto(Number(p.lat), Number(p.lng)) ? { lat: Number(p.lat), lng: Number(p.lng) } : null);

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return reply({ error: 'method' }, 405);
  if (!env.EDIT_KEY || !same(request.headers.get('x-edit-key') || '', env.EDIT_KEY)) return reply({ error: '編輯密碼不正確' }, 401);
  let b;
  try { b = await request.json(); } catch { return reply({ error: 'json' }, 400); }
  const name = String(b?.name || '').trim().slice(0, 80);
  if (!name) return reply({});
  const prev = pt(b.prev), next = pt(b.next);
  const ctx = `當天行程：${String(b.area || '').slice(0, 60)}；前一站：${String(b.prevName || '無').slice(0, 60)}；下一站：${String(b.nextName || '無').slice(0, 60)}`;

  let ai = {}, dbg = [];
  const models = b.model && MODELS.includes(b.model) ? [b.model] : MODELS;
  for (const MODEL of env.AI ? models : []) {
    try {
      const out = await env.AI.run(MODEL, {
        messages: [
          { role: 'system', content: '你是東京與鎌倉、日光一帶的旅遊助理。只輸出一個 JSON 物件，不要其他文字。' },
          { role: 'user', content: `旅客在行程裡新增了「${name}」。${ctx}。\n輸出：{"ja":"這個地點在日本地圖上的正式名稱（日文，用來搜尋地圖；例如「東京車站」→「東京駅」）","desc":"兩到三句繁體中文介紹：這是什麼地方、適合做什麼；不要寫營業時間、票價、電話、地址這類容易出錯的資訊","stay":建議停留分鐘數（15 到 240，5 的倍數）}。如果你不確定這是哪裡，ja 填原本的名稱、desc 填 null。` },
        ],
        max_tokens: 2500, temperature: 0.2,
      });
      const txt = typeof out === 'string' ? out : out?.response ?? out?.choices?.[0]?.message?.content ?? '';
      const clean = String(txt).replace(/<think>[\s\S]*?<\/think>/g, '');
      const m = clean.match(/\{[\s\S]*\}/);
      ai = m ? JSON.parse(m[0]) : {};
      if (b.debug) dbg.push(MODEL + ' OK ' + JSON.stringify(out).slice(0, 300));
      break;
    } catch (e) { ai = {}; if (b.debug) dbg.push(MODEL + ' ERR ' + String(e.message || e).slice(0, 200)); }
  }
  const ja = typeof ai.ja === 'string' && ai.ja.trim() ? ai.ja.trim().slice(0, 80) : name;
  const anchor = prev || next;
  let best = null;
  for (const q of [...new Set([ja, name])]) {
    const list = await search(q);
    for (const c of list) {
      const dist = anchor ? Math.min(prev ? km(prev, c) : 1e9, next ? km(next, c) : 1e9) : 0;
      if (!best || dist < best.dist) best = { ...c, dist };
    }
    if (best && best.dist < 5) break;
  }
  // 離前後站都超過 40 公里，多半是撞名的別處，不採用
  if (best && anchor && best.dist > 40) best = null;
  const stay = Math.round(Number(ai.stay) / 5) * 5;
  return reply({
    ja: ja !== name ? ja : null,
    desc: typeof ai.desc === 'string' ? ai.desc.slice(0, 300) : null,
    stay: stay >= 15 && stay <= 240 ? stay : null,
    ...(best ? { lat: best.lat, lng: best.lng } : {}),
    ...(b.debug ? { dbg } : {}),
  });
}
