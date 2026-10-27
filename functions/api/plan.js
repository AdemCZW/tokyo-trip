// 行程編輯：GET 公開讀取，PUT 需要 x-edit-key（Pages 秘密變數 EDIT_KEY）
const KEY = 'plan';
const JSON_H = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const reply = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: JSON_H });
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

function same(a, b) {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

const inKanto = (la, ln) => Number.isFinite(la) && Number.isFinite(ln) && la > 34.8 && la < 37.2 && ln > 138.4 && ln < 140.9;

// 新增的景點：用 OpenStreetMap 依名稱找座標（找不到就沒有地圖標記，導航仍會用名稱搜尋）
async function geocode(name) {
  try {
    const u = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=jp&accept-language=ja&q=' + encodeURIComponent(name);
    const r = await fetch(u, { headers: { 'user-agent': 'tokyo-trip-planner/1.0 (personal trip site)' }, signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    const la = Number(j[0]?.lat), ln = Number(j[0]?.lon);
    return inKanto(la, ln) ? { lat: la, lng: ln } : null;
  } catch { return null; }
}

function cleanStop(s) {
  if (!s || typeof s !== 'object') return null;
  const o = { t: str(s.t, 12).replace(/[<>&"']/g, ''), name: str(s.name, 80) };
  if (!o.name) return null;
  if (typeof s.noteText === 'string') o.noteText = str(s.noteText, 1500);
  for (const k of ['it', 'q']) if (s[k]) o[k] = str(s[k], 120);
  const la = Number(s.lat), ln = Number(s.lng);
  if (inKanto(la, ln)) { o.lat = la; o.lng = ln; o.gname = str(s.gname, 80); }
  if (s.orig !== undefined) o.orig = Number.isInteger(s.orig) ? s.orig : -1; // 對應原始行程第幾個景點
  for (const k of ['stay', 'travel']) { const n = Math.round(Number(s[k])); if (Number.isFinite(n) && n >= 0 && n <= 720) o[k] = n; }
  if (s.tm) o.tm = true;
  if (s.del) o.del = true;
  return o;
}

export async function onRequest({ request, env }) {
  if (request.method === 'GET') {
    return new Response((await env.PLAN.get(KEY)) || '{"days":{}}', { headers: JSON_H });
  }
  if (request.method !== 'PUT') return reply({ error: 'method' }, 405);
  const key = request.headers.get('x-edit-key') || '';
  if (!env.EDIT_KEY || !same(key, env.EDIT_KEY)) return reply({ error: '編輯密碼不正確' }, 401);
  let body;
  try { body = await request.json(); } catch { return reply({ error: 'json' }, 400); }
  if (!body || typeof body !== 'object') return reply({ error: 'json' }, 400);
  const day = String(body.day);
  if (!/^[0-6]$/.test(day)) return reply({ error: 'day' }, 400);
  let doc;
  try { doc = JSON.parse((await env.PLAN.get(KEY)) || '{}'); } catch { doc = {}; }
  if (!doc || typeof doc.days !== 'object' || !doc.days) doc = { days: {} };
  if (body.reset) delete doc.days[day];
  else {
    const stops = (Array.isArray(body.stops) ? body.stops : []).slice(0, 40).map(cleanStop).filter(Boolean);
    for (const st of stops.filter((x) => x.orig < 0 && !x.lat).slice(0, 5)) {
      const g = await geocode(st.name);
      if (g) { st.lat = g.lat; st.lng = g.lng; st.gname = st.name; }
    }
    doc.days[day] = { stops };
  }
  doc.updated = Date.now();
  await env.PLAN.put(KEY, JSON.stringify(doc));
  return reply(doc);
}
