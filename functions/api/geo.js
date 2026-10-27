// 地名 → 座標（OpenStreetMap Nominatim），給編輯行程時估算交通時間；需要編輯密碼避免被濫用
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
  const q = (new URL(request.url).searchParams.get('q') || '').trim().slice(0, 80);
  if (!q) return reply({});
  try {
    const u = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=jp&accept-language=ja&q=' + encodeURIComponent(q);
    const r = await fetch(u, { headers: { 'user-agent': 'tokyo-trip-planner/1.0 (personal trip site)' }, signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    const lat = Number(j[0]?.lat), lng = Number(j[0]?.lon);
    if (lat > 34.8 && lat < 37.2 && lng > 138.4 && lng < 140.9) return reply({ lat, lng });
  } catch { /* 找不到就回空 */ }
  return reply({});
}
