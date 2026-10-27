// AI 行程建議：只根據前端傳來的行程資料與規則檢查結果回答（Cloudflare Workers AI）
const MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct';
const H = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const reply = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: H });
function same(a, b) {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
const SYSTEM = '你是東京自由行的行程檢查助理。使用者是兩位台灣旅客。只能根據下面提供的「行程資料」與「規則檢查結果」回答，' +
  '絕對不要自己補充店家的營業時間、公休日、票價、交通時刻或任何沒出現在資料裡的事實；不確定就說「資料裡沒有，請自己確認」。' +
  '用繁體中文，口語簡短。輸出 3 到 5 點條列：先講最需要處理的問題（例如太趕、會錯過關門、天黑才到戶外景點），再給具體可執行的調整（例如刪掉哪一站、哪一站提早或延後多久、改搭配哪一站的順序）。' +
  '最後一行寫「以上是依你目前排的行程推估，營業時間請以官方為準。」不要寫其他開場白。';
const cut = (v, n) => String(v ?? '').slice(0, n);

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return reply({ error: 'method' }, 405);
  const key = request.headers.get('x-edit-key') || '';
  if (!env.EDIT_KEY || !same(key, env.EDIT_KEY)) return reply({ error: '編輯密碼不正確' }, 401);
  if (!env.AI) return reply({ error: 'AI 尚未啟用' }, 501);
  let b;
  try { b = await request.json(); } catch { return reply({ error: 'json' }, 400); }
  if (!b || !Array.isArray(b.stops) || b.stops.length > 40) return reply({ error: 'body' }, 400);
  const stops = b.stops.map((s, i) => `${i + 1}. ${cut(s.t, 8)} ${cut(s.name, 60)}${s.stay ? `｜停留 ${Number(s.stay) | 0} 分` : ''}${s.travel ? `｜到下一站交通約 ${Number(s.travel) | 0} 分` : ''}${s.note ? `｜備註：${cut(s.note, 160)}` : ''}`).join('\n');
  const finds = (Array.isArray(b.findings) ? b.findings : []).slice(0, 20).map((f) => `- ${cut(f, 160)}`).join('\n') || '（規則檢查沒有發現問題）';
  const user = `日期：${cut(b.date, 30)}（${cut(b.title, 60)}）\n日落約 ${cut(b.sunset, 8)}\n\n行程資料：\n${stops}\n\n規則檢查結果：\n${finds}`;
  try {
    const out = await env.AI.run(MODEL, { messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], max_tokens: 700, temperature: 0.3 });
    const txt = typeof out === 'string' ? out : out?.response ?? out?.choices?.[0]?.message?.content ?? '';
    return reply({ text: String(txt).slice(0, 2500) });
  } catch (e) { return reply({ error: 'AI 服務失敗：' + String(e.message || e).slice(0, 100) }, 502); }
}
