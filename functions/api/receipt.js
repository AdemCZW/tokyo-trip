// 收據辨識：用 Cloudflare Workers AI 的視覺模型讀照片，只回傳「建議值」，由使用者核對後才存
const MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct';
const H = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const reply = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: H });
function same(a, b) {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
const PROMPT = '這是日本商店收據的照片。只輸出一個 JSON 物件，不要其他文字：' +
  '{"store":"店名（照收據上的日文原文）","total":含稅合計金額（整數日圓）,"date":"YYYY-MM-DD","items":["商品名稱，最多 5 項"]}。' +
  '看不清楚或收據上沒有的欄位填 null，不要猜。金額要找「合計／お買上げ計／TOTAL」那一行，不是找零或小計。';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return reply({ error: 'method' }, 405);
  const key = request.headers.get('x-edit-key') || '';
  if (!env.EDIT_KEY || !same(key, env.EDIT_KEY)) return reply({ error: '編輯密碼不正確' }, 401);
  if (!env.AI) return reply({ error: 'AI 尚未啟用' }, 501);
  let b;
  try { b = await request.json(); } catch { return reply({ error: 'json' }, 400); }
  const img = b && typeof b.image === 'string' ? b.image : '';
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(img) || img.length > 3_000_000) return reply({ error: '圖片格式或大小不對' }, 400);
  let out;
  try {
    out = await env.AI.run(MODEL, {
      messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: img } }] }],
      max_tokens: 400, temperature: 0,
    });
  } catch (e) { return reply({ error: '辨識服務失敗：' + String(e.message || e).slice(0, 120) }, 502); }
  const txt = typeof out === 'string' ? out : out?.response ?? out?.choices?.[0]?.message?.content ?? '';
  const m = String(txt).match(/\{[\s\S]*\}/);
  let j = {};
  try { j = JSON.parse(m ? m[0] : '{}'); } catch { /* 解析不了就回空 */ }
  const total = Number(String(j.total ?? '').replace(/[^\d.]/g, ''));
  return reply({
    store: typeof j.store === 'string' ? j.store.slice(0, 60) : null,
    total: Number.isFinite(total) && total > 0 ? Math.round(total) : null,
    date: typeof j.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.date) ? j.date : null,
    items: Array.isArray(j.items) ? j.items.filter((x) => typeof x === 'string').slice(0, 5).map((x) => x.slice(0, 40)) : [],
  });
}
