/* 東京七天 —— 全部畫面都由 data.js 的 TRIP 產生，改行程只動資料檔。
   版面是橫向分頁（#pager）：每一頁自己上下捲，頁與頁之間左右滑，
   用 CSS scroll-snap 做，不需要手勢函式庫。 */
(() => {
  const T = window.TRIP;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const TOKYO = [35.6812, 139.7671];
  const NDAYS = T.days.length;

  /* ---------- 雲端同步：購物紀錄、待辦打勾、出發日（需編輯密碼） ---------- */
  const SYNC = { ledger: 'tokyo.ledger', checks: 'tokyo.checks', start: 'tokyo.start', shared: 'tokyo.shared', people: 'tokyo.people' };
  const SYNC_DEFAULT = { ledger: '[]', checks: '{}', shared: '[]', people: '["我","同伴"]' };
  const mergeList = (a, b) => { const m = new Map(); [...a, ...b].forEach((e) => { const o = m.get(e.id); if (!o || (e.m || 0) > (o.m || 0)) m.set(e.id, e); }); return [...m.values()].sort((x, y) => x.id - y.id); };
  const cloudKey = () => localStorage.getItem('tokyo.editkey') || '';
  const cloudTimers = {};
  function cloudPush(k) {
    try { localStorage.setItem('tokyo.u.' + k, String(Date.now())); } catch { return; }
    if (!cloudKey()) return;
    clearTimeout(cloudTimers[k]);
    cloudTimers[k] = setTimeout(() => cloudSend(k).catch(() => {}), 700);
  }
  async function cloudSend(k) {
    const raw = localStorage.getItem(SYNC[k]);
    const v = k === 'start' ? raw || '' : JSON.parse(raw || SYNC_DEFAULT[k]);
    const r = await fetch('/api/store?k=' + k, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-edit-key': cloudKey() }, body: JSON.stringify({ v, u: +localStorage.getItem('tokyo.u.' + k) || Date.now() }) });
    if (r.status === 401) localStorage.removeItem('tokyo.editkey');
    if (r.ok && k === 'shared') { const d = await r.json(); shared = mergeList(shared, d.v || []); localStorage.setItem('tokyo.shared', JSON.stringify(shared)); renderExpenses(); }
    return r.ok;
  }
  async function cloudPull() {
    if (!cloudKey()) return;
    let changed = false;
    for (const k of Object.keys(SYNC)) {
      try {
        const r = await fetch('/api/store?k=' + k, { headers: { 'x-edit-key': cloudKey() }, cache: 'no-store' });
        if (r.status === 401) { localStorage.removeItem('tokyo.editkey'); renderCloudBar(); return; }
        if (!r.ok) continue;
        const c = await r.json();
        const lu = +localStorage.getItem('tokyo.u.' + k) || 0;
        if (k === 'shared') {
          const merged = mergeList(shared, c.v || []);
          if (JSON.stringify(merged) !== JSON.stringify(shared)) { shared = merged; localStorage.setItem('tokyo.shared', JSON.stringify(shared)); renderExpenses(); }
          if (JSON.stringify(merged) !== JSON.stringify(c.v || [])) await cloudSend(k);
          continue;
        }
        if (c.u && c.u > lu) {
          localStorage.setItem(SYNC[k], k === 'start' ? c.v : JSON.stringify(c.v));
          localStorage.setItem('tokyo.u.' + k, String(c.u));
          if (k === 'people') { people = c.v; renderExpenses(); } else changed = true;
        } else if (lu > (c.u || 0) || (!c.u && localStorage.getItem(SYNC[k]))) {
          if (!lu) localStorage.setItem('tokyo.u.' + k, String(Date.now()));
          await cloudSend(k);
        }
      } catch { /* 離線：下次再同步 */ }
    }
    if (changed && !sessionStorage.getItem('tokyo.pulled')) { sessionStorage.setItem('tokyo.pulled', '1'); location.reload(); }
    else sessionStorage.removeItem('tokyo.pulled');
  }
  function renderCloudBar() {
    const el = $('#cloudBar'); if (!el) return;
    const on = !!cloudKey();
    el.innerHTML = `<span class="cb-t">${on ? '☁️ 雲端同步已開啟' : '☁️ 雲端同步未開啟'}<small>${on ? '購物紀錄、待辦打勾、出發日、行程修改都會同步，重新整理不會消失' : '輸入編輯密碼後，購物紀錄、待辦打勾、出發日會存到雲端'}</small></span>
      <button class="btn sm" id="cloudBtn" type="button">${on ? '關閉' : '開啟'}</button>`;
    $('#cloudBtn').addEventListener('click', async () => {
      if (on) { localStorage.removeItem('tokyo.editkey'); renderCloudBar(); return; }
      const key = (prompt('輸入編輯密碼') || '').trim();
      if (!key) return;
      try {
        const r = await fetch('/api/store?k=checks', { headers: { 'x-edit-key': key }, cache: 'no-store' });
        if (r.status === 401) return alert('編輯密碼不正確');
        if (!r.ok) return alert('這個網址不支援雲端同步（請用 tokyo-trip-2pc.pages.dev）');
        localStorage.setItem('tokyo.editkey', key);
        renderCloudBar();
        cloudPull();
      } catch { alert('網路有問題，稍後再試'); }
    });
  }

  /* ---------- 行程編輯：雲端存檔（Cloudflare KV），本機留一份快取 ---------- */
  const EDITS_KEY = 'tokyo.edits';
  const escH = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ORIG = T.days.map((d) => d.stops.map((s) => ({ ...s })));
  function applyEdits(doc) {
    Object.entries((doc && doc.days) || {}).forEach(([i, e]) => {
      const d = T.days[i];
      if (!d || !Array.isArray(e.stops)) return;
      d.stops = e.stops.filter((x) => x && typeof x === 'object' && !x.del).map((x) => {
        const base = x.orig >= 0 && ORIG[i][x.orig] ? { ...ORIG[i][x.orig] } : { kind: 'sight' };
        base._o = x.orig >= 0 ? x.orig : -1;
        base.t = escH(x.t);
        base.name = escH(x.name);
        if (x.it !== undefined) base.it = escH(x.it);
        if (Number.isFinite(x.stay)) { base.stay = x.stay; base.travel = x.travel || 0; base.tm = x.tm; }
        if (x.noteText !== undefined) base.note = escH(x.noteText).replace(/\n/g, '<br>');
        if (base._o < 0) { base.it = base.it || ''; if (x.lat) { base.lat = x.lat; base.lng = x.lng; base.gname = x.gname; } else base.q = x.q || x.name; }
        return base;
      });
    });
  }
  let cachedEdits = {};
  try { cachedEdits = JSON.parse(localStorage.getItem(EDITS_KEY) || '{}'); } catch { cachedEdits = {}; }
  if (!cachedEdits || typeof cachedEdits !== 'object') cachedEdits = {};
  try { applyEdits(cachedEdits); } catch {
    localStorage.removeItem(EDITS_KEY); cachedEdits = {};
    T.days.forEach((d, i) => { d.stops = ORIG[i].map((x) => ({ ...x })); });
  }
  const DAY_COLORS = ['#ff453a', '#ff9f0a', '#32ade6', '#0a84ff', '#5e5ce6', '#bf5af2', '#a2845e']; // Apple 系統色，七天各一色
  const FOOD_COLOR = '#30b158';
  const GEM_COLOR = '#ff2d92';
  
  /* ---------- 小工具 ---------- */
  // 有 q（店名＋地址）就用文字導航：日本店家的座標只是概略位置，文字查詢比座標準
  const gmap = (lat, lng, mode = 'walking', q = '') =>
    `https://www.google.com/maps/dir/?api=1&destination=${q ? encodeURIComponent(q) : `${lat},${lng}`}&travelmode=${mode}`;
  const gsearch = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  const navBtn = (p, mode, label = '導航') =>
    p.lat || p.q ? `<a class="navlink" target="_blank" rel="noopener" href="${gmap(p.lat, p.lng, mode, p.q)}" onclick="event.stopPropagation()">➜ ${label}</a>` : '';
  // 需要買票／訂位的地方：data 裡寫 book: { label, url }，畫成一顆票券按鈕
  const bookBtn = (b) => b && b.url
    ? `<a class="navlink book" target="_blank" rel="noopener" href="${b.url}" onclick="event.stopPropagation()">🎫 ${b.label || '訂票'}</a>` : '';
  const pills = (tags = []) => tags.map(([t, c]) => `<span class="pill ${c || ''}">${t}</span>`).join('');
  const list = (items) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
  const callout = (c) => `<div class="callout ${c.tone || ''}"><div>${c.icon || '⚠️'}</div><div>${c.html}</div></div>`;
  const cardsInner = (arr) => arr.map((c) => `<div class="card"><h3>${c.title}</h3>${c.html || ''}${c.items ? list(c.items) : ''}</div>`).join('');
  const cards = (arr, cls = 'g2') => `<div class="grid ${cls}">${cardsInner(arr)}</div>`;
  // 表格：每格帶 data-label，手機上 CSS 把每一列攤成一張小卡
  const table = (head, rows, numCols = []) =>
    `<div class="card tbl-card"><table class="tbl"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>` +
    rows.map((r) => `<tr>${r.map((c, i) => `<td data-label="${head[i]}" class="${numCols.includes(i) ? 'n' : ''}${i === 0 ? ' first' : ''}">${i === 0 ? `<b>${c}</b>` : c}</td>`).join('')}</tr>`).join('') +
    `</tbody></table></div>`;
  const seg = (el, items, cur, onPick) => {
    el.innerHTML = items.map((x) => `<button role="tab" class="${x.k === cur ? 'on' : ''}" data-k="${x.k}">${x.label}</button>`).join('');
    $$('button', el).forEach((b) => b.addEventListener('click', () => onPick(b.dataset.k)));
  };

  const store = {
    get start() { return localStorage.getItem('tokyo.start') || T.start || ''; },
    set start(v) { localStorage.setItem('tokyo.start', v); cloudPush('start'); },
  };
  const addDays = (iso, n) => {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return d;
  };
  const fmtShort = (d) => `${d.getMonth() + 1}/${d.getDate()} ${'日一二三四五六'[d.getDay()]}`;
  const fmtDay = (d) => d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', weekday: 'short' });
  const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  /* ---------- 分頁 ---------- */
  const ICON = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    plan: '<rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M7.5 13.5h3M7.5 17h6"/>',
    map: '<path d="M9 4 3 6.5v13.5L9 17.5l6 2.5 6-2.5V4l-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
    food: '<path d="M7 2.5v19M4 2.5v5.5a3 3 0 0 0 6 0V2.5M17.5 21.5V2.5c-2.5 1-3.5 4-3.5 7.5 0 2 1 3 3.5 3"/>',
    shop: '<path d="M5 8h14l-1.2 11.2a1.5 1.5 0 0 1-1.5 1.3H7.7a1.5 1.5 0 0 1-1.5-1.3z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
    guide: '<circle cx="12" cy="12" r="9.5"/><path d="M12 11v6M12 7.2v.1"/>',
  };
  const PAGES = $$('.page').map((el) => ({ id: el.id, label: el.dataset.title, el }));
  const pager = $('#pager');
  let cur = 0;
  $('#nav').innerHTML = PAGES.map((p) => `<a href="#${p.id}" data-go="${p.id}">${p.label}</a>`).join('');
  $('#tabbar').innerHTML = PAGES.map((p) =>
    `<a href="#${p.id}" data-go="${p.id}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[p.id]}</svg><span>${p.label}</span></a>`).join('');

  function goTo(i, smooth = true) {
    i = Math.max(0, Math.min(PAGES.length - 1, i));
    pager.scrollTo({ left: i * pager.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
    setActive(i);
  }
  function setActive(i) {
    if (i === cur && document.body.dataset.page) return;
    cur = i;
    const p = PAGES[i];
    document.body.dataset.page = p.id;
    const title = $('#pageTitle');
    title.textContent = p.label;
    title.classList.remove('swap'); void title.offsetWidth; title.classList.add('swap');
    requestAnimationFrame(moveInd);
    $$('[data-go]').forEach((a) => a.classList.toggle('on', a.dataset.go === p.id && !a.classList.contains('brand') && !a.classList.contains('btn')));
    history.replaceState(null, '', '#' + p.id);
    $('#prevPage').disabled = i === 0;
    $('#nextPage').disabled = i === PAGES.length - 1;
    // Leaflet 在看不見的頁面裡量不到尺寸，換到地圖頁時要重新量
    requestAnimationFrame(() => {
      if (p.id === 'plan' && dayMap) fitDay();
      if (p.id === 'map' && bigMap) { bigMap.invalidateSize(); if (!bigMap._fitted) { bigMap.fitBounds(bigBounds, { padding: [30, 30] }); bigMap._fitted = true; } }
    });
    if (i > 0) localStorage.setItem('tokyo.swiped', '1');
  }
  // 滑動時依捲動位置判斷現在在哪一頁
  let raf;
  pager.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => setActive(Math.round(pager.scrollLeft / pager.clientWidth)));
  }, { passive: true });
  // 視窗大小改變（轉手機方向）時，停在同一頁
  new ResizeObserver(() => pager.scrollTo({ left: cur * pager.clientWidth })).observe(pager);
  // 頁內所有 #xxx 連結都改成切頁
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-go]');
    if (!a) return;
    e.preventDefault();
    goTo(PAGES.findIndex((p) => p.id === a.dataset.go));
  });
  $('#prevPage').addEventListener('click', () => goTo(cur - 1));
  $('#nextPage').addEventListener('click', () => goTo(cur + 1));
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowRight') goTo(cur + 1);
    if (e.key === 'ArrowLeft') goTo(cur - 1);
  });
  if (localStorage.getItem('tokyo.swiped')) $('#swipeHint').hidden = true;

  /* ---------- 動畫：分頁指示器、捲動浮現、數字跳動 ---------- */
  // 上方分頁列和底部分頁列各放一顆會滑動的指示器，位置跟著目前那一頁
  const inds = ['#nav', '#tabbar'].map((sel) => {
    const bar = $(sel);
    const ind = document.createElement('i');
    ind.className = 'tab-ind';
    bar.prepend(ind);
    bar.classList.add('has-ind');
    return { bar, ind };
  });
  function moveInd() {
    inds.forEach(({ bar, ind }) => {
      const a = $(`a[data-go="${PAGES[cur].id}"]`, bar);
      if (!a || !bar.offsetWidth) return; // 隱藏中的那一列（桌機的底部列、手機的上方列）不用算
      ind.style.width = a.offsetWidth + 'px';
      ind.style.transform = `translateX(${a.offsetLeft}px)`;
    });
  }
  window.addEventListener('resize', moveInd);

  // 卡片類元素第一次捲進畫面時才浮現；新渲染出來的（換天、切分類）也會自動接上
  const REVEAL = '.card, .stat, .stop, .wx, .todo-group, .callout, .bk, .fg-head, .day-intro, .day-actions, .tbl-card';
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add('in');
    io.unobserve(e.target);
  }), { threshold: 0.08 });
  function reveal(root = document) {
    $$(REVEAL, root).forEach((el) => {
      if (el.classList.contains('rv') || el.closest('.leaflet-container')) return;
      const sib = [...el.parentElement.children].filter((x) => x.matches(REVEAL));
      el.style.setProperty('--d', `${Math.min(sib.indexOf(el), 8) * 0.05}s`);
      el.classList.add('rv');
      io.observe(el);
    });
  }
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && reveal(n.parentElement || n))))
    .observe(pager, { childList: true, subtree: true });

  // 數字從 0 跳到目標值
  function countUp(el, to, fmt = (v) => Math.round(v), ms = 900) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      el.textContent = fmt(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------- 地圖 ---------- */
  function makeMap(el, zoom = 14) {
    const m = L.map(el, { scrollWheelZoom: false, zoomControl: true }).setView(TOKYO, zoom);
    // CARTO 深色圖磚要 API key，改用 OSM 標準圖磚；深色模式用 CSS 濾鏡壓暗
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(m);
    return m;
  }
  const pinIcon = (color, label = '', round = false, delay = 0) =>
    L.divIcon({
      className: '',
      html: `<div class="pin ${round ? 'round' : ''}" style="--c:${color};--pd:${delay}s"><span>${label}</span></div>`,
      iconSize: round ? [16, 16] : [26, 26],
      iconAnchor: round ? [8, 8] : [13, 26],
      popupAnchor: [0, round ? -8 : -24],
    });
  const popup = (title, sub, p, mode) =>
    `<b>${title}</b>${sub ? `<br><span style="color:var(--muted)">${sub}</span>` : ''}<br><div style="margin-top:8px">${navBtn(p, mode)}</div>`;

  /* ---------- 總覽 ---------- */
  $('#lead').innerHTML = T.lead;
  const startInput = $('#startDate');
  startInput.value = store.start;
  startInput.addEventListener('change', () => {
    store.start = startInput.value;
    renderTabs();
    renderDay(curDay);
    renderWeather();
    renderBookings();
    buildLedgerForm();
    renderLedger();
    tick();
  });

  $('#stats').innerHTML = `
    <div class="stat live"><div class="k">東京時間</div><div class="v mono" id="tJp">--:--</div><div class="s" id="tJpD"></div></div>
    <div class="stat live"><div class="k">台北時間</div><div class="v mono" id="tTpe">--:--</div><div class="s" id="tDiff"></div></div>
    <div class="stat live"><div class="k">日圓 → 台幣</div><div class="v" id="fx">—</div><div class="s" id="fxS">讀取匯率中…</div></div>
    <div class="stat"><div class="k">出發倒數</div><div class="v" id="cd">—</div><div class="s" id="cdS"></div></div>
    <div class="stat wide wxcard"><div class="k">旅行期間天氣</div><div id="wxTrip" class="wx-trip"></div><div class="s" id="wxNowS">讀取天氣中…</div></div>`;

  function tzOffsetMin(tz, at = new Date()) {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      .formatToParts(at).reduce((o, x) => ((o[x.type] = x.value), o), {});
    return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(at.getTime() / 60000) * 60000) / 60000;
  }
  function tick() {
    const now = new Date();
    const t = (tz) => now.toLocaleTimeString('zh-TW', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    $('#tJp').textContent = t('Asia/Tokyo');
    $('#tTpe').textContent = t('Asia/Taipei');
    $('#tJpD').textContent = now.toLocaleDateString('zh-TW', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric', weekday: 'short' });
    const diff = (tzOffsetMin('Asia/Tokyo') - tzOffsetMin('Asia/Taipei')) / 60;
    $('#tDiff').textContent = `東京比台北快 ${diff} 小時`;
    const s = store.start;
    if (s) {
      const days = Math.ceil((new Date(s + 'T00:00:00') - now) / 864e5);
      const cdEl = $('#cd');
      if (days > 0 && !cdEl.dataset.done) { cdEl.dataset.done = 1; countUp(cdEl, days, (x) => `${Math.round(x)} 天`); }
      else if (days > 0) cdEl.textContent = `${days} 天`;
      else cdEl.textContent = days > -NDAYS ? '旅行中' : '已結束';
      $('#cdS').textContent = `${fmtShort(addDays(s, 0))} – ${fmtShort(addDays(s, NDAYS - 1))}`;
    } else {
      $('#cd').textContent = '—';
      $('#cdS').textContent = '選出發日';
    }
  }
  const FX = { rate: 0.2 }; // 日圓→台幣，讀不到即時匯率時用概估
  async function loadFx() {
    try {
      const j = await (await fetch('https://open.er-api.com/v6/latest/JPY')).json();
      const v = j.rates.TWD;
      FX.rate = v;
      countUp($('#fx'), v * 100, (x) => `¥100＝${x.toFixed(1)}`);
      $('#fxS').textContent = `¥10,000 ≈ NT$${Math.round(v * 10000).toLocaleString()}`;
      renderLedger();
    } catch {
      $('#fx').textContent = '¥100≈20';
      $('#fxS').textContent = '離線概估';
    }
  }

  /* ---------- 每日行程 ---------- */
  let curDay = 0;
  let dayMap, dayLayer, dayPts = [];
  const dayMarkers = [];

  function renderTabs() {
    $('#dayTabs').innerHTML = T.days.map((d, i) => {
      const date = store.start ? fmtDay(addDays(store.start, i)) : '';
      return `<button class="day-tab ${i === curDay ? 'on' : ''}" role="tab" style="--c:${DAY_COLORS[i]}" data-i="${i}">
        <span class="d">DAY ${i + 1}${date ? ` · ${date}` : ''}</span>
        <span class="t">${d.title}</span><span class="w">${d.area}</span></button>`;
    }).join('');
    $$('.day-tab').forEach((b) => b.addEventListener('click', () => renderDay(+b.dataset.i)));
  }
  function fitDay() {
    dayMap.invalidateSize();
    dayMap.closePopup();
    if (dayPts.length) dayMap.fitBounds(L.latLngBounds(dayPts.map((p) => [p.lat, p.lng])), { padding: [26, 26], maxZoom: 15 });
  }
  function renderDay(i) {
    curDay = i;
    $$('.day-tab').forEach((b) => b.classList.toggle('on', +b.dataset.i === i));
    // 只捲天數列本身；scrollIntoView 會連外層的橫向分頁一起捲走
    const tabs = $('#dayTabs'), tab = $(`.day-tab[data-i="${i}"]`);
    const dx = tab.getBoundingClientRect().left - tabs.getBoundingClientRect().left;
    tabs.scrollTo({ left: tabs.scrollLeft + dx - (tabs.clientWidth - tab.offsetWidth) / 2, behavior: 'smooth' });
    const d = T.days[i];
    const c = DAY_COLORS[i];
    const pts = (dayPts = d.stops.filter((s) => s.lat));
    const route = pts.length > 1
      ? `https://www.google.com/maps/dir/?api=1&origin=${pts[0].lat},${pts[0].lng}&destination=${pts.at(-1).lat},${pts.at(-1).lng}` +
        `&waypoints=${pts.slice(1, -1).slice(0, 8).map((p) => `${p.lat},${p.lng}`).join('|')}&travelmode=${d.mode || 'walking'}`
      : '';
    let n = 0;
    $('#dayBody').innerHTML = `
      <div class="day-intro"><h2 class="h2" style="margin-top:0">${d.title}</h2><p>${d.summary}</p></div>
      <div class="day-actions">
        ${route ? `<a class="btn primary sm" target="_blank" rel="noopener" href="${route}">➜ 整天導航</a>` : ''}
        <button class="btn sm" id="editDay" type="button">✏️ 編輯</button>
        ${pills(d.tags)}
      </div>
      <div id="dayCheck"></div>
      <ol class="tl">${d.stops.map((s) => {
        const idx = s.lat ? ++n : 0;
        return `<li><div class="time">${s.t || ''}</div>
          <div class="stop ${s.kind || ''}" style="--c:${c}" data-idx="${idx}">
            <div class="row1"><span class="nm">${idx ? `${idx}. ` : ''}${s.name}</span>${s.it ? `<span class="it">${s.it}</span>` : ''}</div>
            ${s.note ? `<div class="note">${s.note}</div>` : ''}
            ${s.tags || s.lat || s.q || s.stay ? `<div class="meta">${pills(s.tags)}${s.stay ? `<span class="pill">停留 ${fmtDur(s.stay)}</span>` : ''}<span class="go">${bookBtn(s.book)}${navBtn(s, s.mode || d.mode || 'walking')}</span></div>` : ''}
          </div></li>`;
      }).join('')}</ol>`;
    $('#daySide').innerHTML = `<h3>${d.side.title}</h3>${list(d.side.items)}`;
    $('#editDay').addEventListener('click', () => openEditor(i));
    renderCheck(i);

    if (!dayMap) dayMap = makeMap('dayMap');
    if (dayLayer) dayLayer.remove();
    dayLayer = L.layerGroup().addTo(dayMap);
    dayMarkers.length = 0;
    pts.forEach((p, k) => {
      dayMarkers.push(L.marker([p.lat, p.lng], { icon: pinIcon(p.kind === 'food' ? FOOD_COLOR : c, k + 1, false, .15 + k * .07) })
        .bindPopup(popup(p.name, p.it, p, d.mode)).addTo(dayLayer));
    });
    L.polyline(pts.map((p) => [p.lat, p.lng]), { color: c, weight: 3, opacity: .7, dashArray: '6 8' }).addTo(dayLayer);
    fitDay();
    setTimeout(fitDay, 120);

    $$('.stop[data-idx]').forEach((el) => {
      const k = +el.dataset.idx;
      if (!k) return;
      el.addEventListener('click', () => {
        const m = dayMarkers[k - 1];
        $$('.stop.focus').forEach((x) => x.classList.remove('focus'));
        el.classList.add('focus');
        $$('#dayMap .pin.hot').forEach((x) => x.classList.remove('hot'));
        m.getElement()?.querySelector('.pin')?.classList.add('hot');
        dayMap.flyTo(m.getLatLng(), 16, { duration: .6 });
        m.openPopup();
        // 手機版地圖在時間軸上方，點了要捲回去看
        if (window.innerWidth <= 960) $('#plan').scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  /* ---------- 全部地點地圖 ---------- */
  let bigMap, bigBounds;
  function renderBigMap() {
    const m = (bigMap = makeMap('bigMap', 13));
    const groups = {};
    const all = [];
    const add = (key, layer, ll) => { (groups[key] ||= L.layerGroup().addTo(m)).addLayer(layer); if (ll) all.push(ll); };

    T.days.forEach((d, i) => {
      d.stops.filter((s) => s.lat && s.kind !== 'food').forEach((s) => {
        add(`d${i}`, L.marker([s.lat, s.lng], { icon: pinIcon(DAY_COLORS[i], `${i + 1}`) }).bindPopup(popup(s.name, `Day ${i + 1}・${s.it || ''}`, s)), [s.lat, s.lng]);
      });
    });
    T.food.forEach((f) => {
      if (!f.lat) return;
      const gem = f.tag === 'gem';
      add(gem ? 'gem' : 'food', L.marker([f.lat, f.lng], { icon: pinIcon(gem ? GEM_COLOR : FOOD_COLOR, '', true) })
        .bindPopup(popup(f.name, `${f.cat}・${f.order.replace(/<[^>]+>/g, '').slice(0, 40)}`, f)), [f.lat, f.lng]);
    });
    bigBounds = L.latLngBounds(all);

    const filters = [
      ...T.days.map((d, i) => ({ k: `d${i}`, label: `Day ${i + 1}`, c: DAY_COLORS[i] })),
      { k: 'food', label: '名店', c: FOOD_COLOR },
      { k: 'gem', label: '隱藏美食', c: GEM_COLOR },
    ].filter((f) => groups[f.k]);
    $('#mapFilters').innerHTML = filters.map((f) => `<button class="chip on" data-k="${f.k}"><i style="background:${f.c}"></i>${f.label}</button>`).join('');
    $$('#mapFilters .chip').forEach((b) => b.addEventListener('click', () => {
      const on = b.classList.toggle('on');
      on ? groups[b.dataset.k].addTo(m) : groups[b.dataset.k].remove();
    }));
  }

  /* ---------- 美食：正餐／小吃／甜點／咖啡・酒 ---------- */
  let foodType = 'all';
  let foodTag = 'all';
  const foodCard = (f) => `
    <article class="card food">
      <div class="top-row"><h3>${f.name}</h3>${f.tag === 'gem' ? '<span class="pill gem">💎 隱藏版</span>' : '<span class="pill hot">🔥 名店</span>'}</div>
      <div class="area">${f.cat}・${f.area}${f.day ? `・<span style="color:${DAY_COLORS[f.day - 1]};font-weight:600">順路 Day ${f.day}</span>` : ''}</div>
      <div class="order">${f.order}</div>
      <dl class="facts">
        <dt>價位</dt><dd>${f.price}</dd>
        <dt>時間</dt><dd>${f.hours}</dd>
        ${f.reserve ? `<dt>訂位</dt><dd>${f.reserve}</dd>` : ''}
      </dl>
      ${f.note ? `<div class="fnote">${f.note}</div>` : ''}
      <div class="foot">${bookBtn(f.book)}${navBtn(f, 'walking')}<a class="navlink ghost" target="_blank" rel="noopener" href="${gsearch(f.name + ' ' + f.addr)}">評論 / 照片</a></div>
    </article>`;
  function renderFood() {
    const types = T.foodTypes;
    seg($('#foodSeg'), [{ k: 'all', label: '全部' }, ...types.map((t) => ({ k: t.k, label: `${t.icon} ${t.short || t.label}` }))], foodType,
      (k) => { foodType = k; renderFood(); });
    $('#foodTags').innerHTML = [['all', '全部'], ['famous', '🔥 名店'], ['gem', '💎 隱藏版']]
      .map(([k, l]) => `<button class="chip ${foodTag === k ? 'on' : ''}" data-tag="${k}">${l}</button>`).join('');
    $$('#foodTags .chip').forEach((b) => b.addEventListener('click', () => { foodTag = b.dataset.tag; renderFood(); }));

    const groups = types.filter((t) => foodType === 'all' || t.k === foodType).map((t) => ({
      ...t, items: T.food.filter((f) => f.type === t.k && (foodTag === 'all' || f.tag === foodTag)),
    })).filter((g) => g.items.length);
    $('#foodBody').innerHTML = groups.map((g) => `
      <section class="food-group">
        <div class="fg-head"><span class="fg-ic">${g.icon}</span><div><h2 class="h2">${g.label} <span class="cnt">${g.items.length}</span></h2><p class="sub">${g.desc}</p></div></div>
        <div class="grid g3">${g.items.map(foodCard).join('')}</div>
      </section>`).join('') || '<p class="muted" style="margin-top:20px">沒有符合條件的店。</p>';
    $('#foodEtiquette').innerHTML = cardsInner(T.foodNotes);
  }

  /* ---------- 指南：交通／租機車／須知 ---------- */
  let guidePane = 'book';
  function renderGuideSeg() {
    seg($('#guideSeg'), [{ k: 'book', label: '🎫 訂票' }, { k: 'transport', label: '🚇 交通' }, { k: 'tips', label: 'ℹ️ 須知' }], guidePane, (k) => {
      guidePane = k;
      $$('.guide-pane').forEach((p) => (p.hidden = p.dataset.pane !== k));
      renderGuideSeg();
      $('#guide').scrollTo({ top: 0 });
    });
  }
  function renderTransport() {
    const t = T.transport;
    $('#transportBody').innerHTML = (t.callouts || []).map(callout).join('') +
      `<h2 class="h2">機場 ⇄ 市區</h2>` + table(['方式', '路線', '票價', '時間', '備註'], t.airport, [2, 3]) +
      `<h2 class="h2">市區票種</h2>` + table(['票種', '價格', '說明'], t.tickets, [1]) +
      `<h2 class="h2">怎麼搭</h2>` + cards(t.cards) +
      (t.src ? `<p class="src">來源：${t.src}</p>` : '');
  }
  function renderTips() {
    $('#tipsBody').innerHTML = (T.tipsCallouts || []).map(callout).join('') + cards(T.tips);
    $('#footer').innerHTML = `<p>資料整理於 ${T.updated}。票價、營業時間會變動，出發前請以官網為準。地圖 © OpenStreetMap；天氣 Open-Meteo；匯率 ExchangeRate-API。</p>
      <p class="src">參考來源：${T.sources.map((s) => `<a target="_blank" rel="noopener" href="${s[1]}">${s[0]}</a>`).join('・')}</p>`;
  }

  /* ---------- 天氣 ---------- */
  // 總覽只放一張精簡的天氣卡：行程日進入 16 天預報範圍就顯示那四天，否則顯示 11 月氣候概況
  let wxCache;
  async function renderWeather() {
    const trip = store.start ? Array.from({ length: NDAYS }, (_, k) => isoOf(addDays(store.start, k))) : [];
    const climate = T.climateNote;
    try {
      if (!wxCache) {
        const u = `https://api.open-meteo.com/v1/forecast?latitude=${TOKYO[0]}&longitude=${TOKYO[1]}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&forecast_days=16`;
        wxCache = await (await fetch(u)).json();
      }
      const w = wxCache;
      const [ic, txt] = WMO(w.current.weather_code);
      const days = trip.map((d) => w.daily.time.indexOf(d)).filter((k) => k >= 0);
      if (days.length) {
        $('#wxTrip').innerHTML = days.map((k) => {
          const [i2] = WMO(w.daily.weather_code[k]);
          return `<div class="wxm"><span class="dd">${fmtShort(new Date(w.daily.time[k] + 'T12:00:00'))}</span><span class="ic">${i2}</span>
            <b>${Math.round(w.daily.temperature_2m_max[k])}°</b><span class="lo">${Math.round(w.daily.temperature_2m_min[k])}°</span><span class="rr">💧${w.daily.precipitation_probability_max[k] ?? '-'}%</span></div>`;
        }).join('');
        $('#wxNowS').textContent = `東京現在 ${ic} ${Math.round(w.current.temperature_2m)}°（${txt}）`;
      } else {
        $('#wxTrip').innerHTML = `<div class="wx-sum"><span class="ic">🌦️</span><div><b>${climate.temp}</b><br><span>${climate.rain}</span></div></div>`;
        const from = store.start ? fmtDay(addDays(store.start, -15)) : '';
        $('#wxNowS').textContent = `東京現在 ${ic} ${Math.round(w.current.temperature_2m)}°${from ? `・${from} 起顯示行程日預報` : ''}`;
      }
    } catch {
      $('#wxTrip').innerHTML = `<div class="wx-sum"><span class="ic">🌦️</span><div><b>${climate.temp}</b><br><span>${climate.rain}</span></div></div>`;
      $('#wxNowS').textContent = '即時天氣讀取失敗';
    }
  }

  /* ---------- 總覽：待辦／注意事項／行李（打勾存在 localStorage） ---------- */
  const checks = JSON.parse(localStorage.getItem('tokyo.checks') || '{}');
  const saveChecks = () => { localStorage.setItem('tokyo.checks', JSON.stringify(checks)); cloudPush('checks'); };
  const linkBtns = (links = []) => links.map(([label, url]) =>
    `<a class="navlink ${label.startsWith('🎫') || label.startsWith('📝') ? 'book' : 'ghost'}" target="_blank" rel="noopener" href="${url}">${label}</a>`).join('');
  function renderTodo() {
    const all = T.todo.flatMap((g) => g.items);
    $('#todoBody').innerHTML = T.todo.map((g) => `
      <div class="todo-group">
        <div class="tg-head"><span class="pill ${g.tone || ''}">${g.when}</span>${g.date ? `<span class="tg-date">${g.date}</span>` : ''}</div>
        <div class="card todo-list">${g.items.map((it) => `
          <label class="todo ${checks[it.id] ? 'done' : ''}">
            <input type="checkbox" data-id="${it.id}" ${checks[it.id] ? 'checked' : ''} />
            <span class="box"></span>
            <span class="tx"><b>${it.text}</b>${it.note ? `<span class="tn">${it.note}</span>` : ''}
              ${it.links ? `<span class="tl-links">${linkBtns(it.links)}</span>` : ''}</span>
          </label>`).join('')}</div>
      </div>`).join('');
    const done = all.filter((it) => checks[it.id]).length;
    $('#todoCnt').textContent = `${done} / ${all.length}`;
    $('#todoBar').style.width = `${(done / all.length) * 100}%`;
    $$('#todoBody input').forEach((c) => c.addEventListener('change', () => { checks[c.dataset.id] = c.checked; saveChecks(); renderTodo(); }));
  }
  function renderMust() {
    $('#mustBody').innerHTML = T.musts.map((m) => `<div class="card must"><div class="must-ic">${m.icon}</div><h3>${m.title}</h3><p>${m.text}</p>${m.links ? `<div class="tl-links">${linkBtns(m.links)}</div>` : ''}</div>`).join('');
  }
  function renderPack() {
    const all = T.packing.flatMap((g) => g.items.map((x, i) => `${g.k}-${i}`));
    $('#packBody').innerHTML = T.packing.map((g) => `
      <div class="card"><h3>${g.icon} ${g.title}</h3>${g.items.map((x, i) => {
        const id = `pk-${g.k}-${i}`;
        return `<label class="todo sm ${checks[id] ? 'done' : ''}"><input type="checkbox" data-id="${id}" ${checks[id] ? 'checked' : ''} /><span class="box"></span><span class="tx">${x}</span></label>`;
      }).join('')}</div>`).join('');
    const done = all.filter((k) => checks['pk-' + k]).length;
    $('#packCnt').textContent = `${done} / ${all.length}`;
    $('#packSub').innerHTML = T.packingNote;
    $$('#packBody input').forEach((c) => c.addEventListener('change', () => { checks[c.dataset.id] = c.checked; saveChecks(); renderPack(); }));
  }

  /* ---------- 指南：訂票總表（從行程、美食、交通自動彙整） ---------- */
  function renderBookings() {
    const rows = [];
    T.days.forEach((d, i) => d.stops.forEach((s) => {
      if (s.book) rows.push({ when: `Day ${i + 1}${store.start ? `・${fmtDay(addDays(store.start, i))}` : ''} ${s.t}`, c: DAY_COLORS[i], name: s.name, b: s.book });
    }));
    const inPlan = new Set(T.days.flatMap((d) => d.stops.map((s) => s.name)));
    const food = T.food.filter((f) => f.book && !inPlan.has(f.name)).map((f) => ({ when: f.day ? `Day ${f.day}` : '備選', c: f.day ? DAY_COLORS[f.day - 1] : 'var(--faint)', name: f.name, b: f.book }));
    const sec = (title, sub, list) => `<h2 class="h2">${title}</h2><p class="sub">${sub}</p><div class="card book-list">${list.map((r) => `
      <div class="bk">
        <div class="bk-when" style="color:${r.c}">${r.when}</div>
        <div class="bk-main"><b>${r.name}</b>${r.b.note ? `<span class="tn">${r.b.note}</span>` : ''}</div>
        <div class="bk-go">${bookBtn(r.b)}</div>
      </div>`).join('')}</div>`;
    $('#bookBody').innerHTML = (T.bookCallouts || []).map(callout).join('') +
      sec('按行程順序', '景點門票和行程裡的餐廳。實名制的票，名字要跟護照一樣。', rows) +
      sec('其他可訂位的餐廳', '不在行程裡的備選；沒列在這裡的店是電話訂位或現場排隊。', food) +
      sec('交通與其他', '', T.bookExtra.map((x) => ({ when: x.when, c: 'var(--accent)', name: x.name, b: x.book })));
  }

  const WMO = (c) =>
    c === 0 ? ['☀️', '晴'] : c <= 2 ? ['🌤️', '晴時多雲'] : c === 3 ? ['☁️', '陰'] : c <= 48 ? ['🌫️', '霧'] :
    c <= 57 ? ['🌦️', '毛毛雨'] : c <= 67 ? ['🌧️', '雨'] : c <= 77 ? ['🌨️', '雪'] : c <= 82 ? ['🌧️', '陣雨'] : ['⛈️', '雷雨'];

  /* ---------- 購物：退稅指南＋購物紀錄核對 ---------- */
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const yen = (n) => '¥' + Math.round(n).toLocaleString('en-US');
  const twd = (n) => 'NT$' + Math.round(n * FX.rate).toLocaleString('en-US');
  const regimeOf = (iso) => T.tax.regimes.find((r) => iso >= r.from && iso <= r.to);
  const OKPILL = { yes: ['可退稅', 'ok'], partial: ['部分／看店', 'warn'], no: ['多半不行', 'bad'], unknown: ['未查證', ''] };
  let shopPane = 'tax';
  let taxCat = 'all';
  let taxQ = '';

  function renderShopSeg() {
    seg($('#shopSeg'), [{ k: 'tax', label: '🧾 退稅' }, { k: 'ledger', label: '📒 購物紀錄' }, { k: 'exp', label: '💰 記帳' }], shopPane, (k) => {
      shopPane = k;
      $$('.shop-pane').forEach((p) => (p.hidden = p.dataset.pane !== k));
      renderShopSeg();
      $('#shop').scrollTo({ top: 0 });
    });
  }

  function renderTaxPane() {
    const X = T.tax;
    const regimeCard = (r) => `<div class="card regime"><div class="rg-head"><span class="pill ${r.tone || 'info'}">${r.name}</span><span class="tg-date">${r.label}</span></div>
      <h3>${r.title}</h3>${list(r.steps)}${r.src ? `<p class="src">來源：${r.src}</p>` : ''}</div>`;
    const cats = [{ k: 'all', label: '全部' }, ...X.cats.map((c) => ({ k: c.k, label: `${c.icon} ${c.label}` }))];
    const shops = X.shops.filter((x) => (taxCat === 'all' || x.cat === taxCat) && (!taxQ || (x.name + x.area + (x.alias || '')).toLowerCase().includes(taxQ.toLowerCase())));
    $('#shopTax').innerHTML = (X.intro || []).map(callout).join('') +
      `<h2 class="h2">兩種制度怎麼分</h2><div class="grid g2">${X.regimes.map(regimeCard).join('')}</div>` +
      `<h2 class="h2">各家怎麼退稅 <span class="cnt">${X.shops.length}</span></h2><p class="sub">${X.shopSub || ''}</p>
       <input class="in" id="taxSearch" type="search" placeholder="搜尋店名或地區，例如 唐吉訶德、銀座" value="${esc(taxQ)}" />
       <div class="scroll-row" id="taxCats" style="margin-top:10px">${cats.map((c) => `<button class="chip ${taxCat === c.k ? 'on' : ''}" data-cat="${c.k}">${c.label}</button>`).join('')}</div>
       <div class="grid g3" id="taxList">${shops.map((x) => {
         const [t, c] = OKPILL[x.ok] || OKPILL.unknown;
         return `<article class="card shopc">
           <div class="top-row"><h3>${x.name}</h3><span class="pill ${c}">${t}</span></div>
           <div class="area">${x.area}${x.min ? `・門檻 ${x.min}` : ''}</div>
           <dl class="facts">${x.before ? `<dt>~10/31</dt><dd>${x.before}</dd>` : ''}${x.after ? `<dt>11/1 起</dt><dd>${x.after}</dd>` : ''}</dl>
           ${x.note ? `<div class="fnote">${x.note}</div>` : ''}
           ${x.url ? `<div class="foot"><a class="navlink ghost" target="_blank" rel="noopener" href="${x.url}">官方說明</a></div>` : ''}
         </article>`; }).join('') || '<p class="muted">沒有符合的店。</p>'}</div>` +
      `<h2 class="h2">注意事項</h2>${cards(X.tips)}` + (X.src ? `<p class="src">來源：${X.src}</p>` : '');
    const q = $('#taxSearch');
    q.addEventListener('input', () => { taxQ = q.value; renderTaxPane(); const n = $('#taxSearch'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
    $$('#taxCats .chip').forEach((b) => b.addEventListener('click', () => { taxCat = b.dataset.cat; renderTaxPane(); }));
  }

  // ---- 購物紀錄：存在這台裝置的 localStorage；開啟雲端同步後會同步到 Cloudflare KV（需密碼） ----
  const LEDGER_KEY = 'tokyo.ledger';
  let ledger = [];
  try { ledger = JSON.parse(localStorage.getItem(LEDGER_KEY) || '[]'); } catch { ledger = []; }
  const saveLedger = () => { try { localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger)); cloudPush('ledger'); } catch { /* 無痕模式存不了就只留在記憶體 */ } };
  const tripDates = () => (store.start ? Array.from({ length: NDAYS }, (_, k) => addDays(store.start, k)) : []);

  function buildLedgerForm() {
    const days = tripDates();
    const today = isoOf(new Date());
    const opts = days.map((d) => `<option value="${isoOf(d)}" ${isoOf(d) === today ? 'selected' : ''}>${fmtDay(d)}</option>`).join('');
    $('#shopLedger').innerHTML = `
      <div class="card ledger-form">
        <h3>新增一筆</h3>
        <div class="lf-grid">
          <label>日期<select class="in" id="lfDate">${opts}</select></label>
          <label>店家<input class="in" id="lfStore" list="lfShops" placeholder="例如 唐吉訶德" autocomplete="off" /></label>
          <label>買了什麼<input class="in" id="lfItem" placeholder="例如 藥妝、伴手禮" /></label>
          <label>含稅金額（日圓）<input class="in" id="lfAmt" type="number" inputmode="numeric" min="0" step="1" placeholder="例如 5400" /></label>
          <label>付款方式<select class="in" id="lfPay">${(T.payments || []).map((x) => `<option>${esc(x)}</option>`).join('')}</select></label>
          <label>類別<select class="in" id="lfKind"><option>一般物品</option><option>消耗品（食品、藥妝）</option></select></label>
        </div>
        <datalist id="lfShops">${T.tax.shops.map((x) => `<option value="${esc(x.name)}"></option>`).join('')}</datalist>
        <div class="day-actions">${scanBtn('lfScan')}<button class="btn primary" id="lfAdd" type="button">＋ 加入紀錄</button></div>
        <p class="src" id="lfHint"></p>
      </div>
      <div id="ledgerSum"></div>
      <div id="ledgerList"></div>`;
    $('#lfScan').addEventListener('change', async (e) => {
      if (!e.target.files[0]) return;
      const j = await scanReceipt(e.target.files[0], (t) => { $('#lfHint').innerHTML = t; });
      e.target.value = '';
      if (!j) return;
      if (j.store) $('#lfStore').value = j.store;
      if (j.total) $('#lfAmt').value = j.total;
      if (j.items && j.items.length) $('#lfItem').value = j.items.slice(0, 3).join('、');
      if (j.date && [...$('#lfDate').options].some((o) => o.value === j.date)) $('#lfDate').value = j.date;
    });
    $('#lfAdd').addEventListener('click', () => {
      const store_ = $('#lfStore').value.trim();
      const amt = Number($('#lfAmt').value);
      if (!store_ || !(amt > 0)) { $('#lfHint').textContent = '店家和金額要填，金額要大於 0。'; return; }
      ledger.push({
        id: Date.now(), date: $('#lfDate').value, store: store_, item: $('#lfItem').value.trim(), amt,
        pay: $('#lfPay').value, kind: $('#lfKind').value, tax: false, rcpt: false, chk: false,
      });
      saveLedger();
      $('#lfStore').value = ''; $('#lfItem').value = ''; $('#lfAmt').value = ''; $('#lfHint').textContent = '已加入。';
      renderLedger();
    });
  }

  function renderLedger() {
    const box = $('#ledgerList');
    if (!box) return;
    const total = ledger.reduce((a, e) => a + e.amt, 0);
    const byPay = {};
    ledger.forEach((e) => { (byPay[e.pay] ||= { sum: 0, n: 0, ok: 0 }); byPay[e.pay].sum += e.amt; byPay[e.pay].n++; if (e.chk) byPay[e.pay].ok++; });
    const chkN = ledger.filter((e) => e.chk).length;
    $('#ledgerSum').innerHTML = `
      <div class="stats ls">
        <div class="stat"><div class="k">合計</div><div class="v">${yen(total)}</div><div class="s">約 ${twd(total)}・${ledger.length} 筆</div></div>
        <div class="stat"><div class="k">已核對帳單</div><div class="v">${chkN} / ${ledger.length}</div><div class="s">逐筆點「已核對」</div></div>
        <div class="stat"><div class="k">待領收據／退稅</div><div class="v">${ledger.filter((e) => !e.rcpt).length} / ${ledger.filter((e) => !e.tax).length}</div><div class="s">沒收據／還沒辦退稅</div></div>
      </div>
      ${Object.keys(byPay).length ? `<div class="card"><h3>各付款方式（拿來對信用卡帳單）</h3>${table(['付款方式', '筆數', '合計', '已核對'], Object.entries(byPay).map(([k, v]) => [esc(k), v.n, `${yen(v.sum)}（${twd(v.sum)}）`, `${v.ok} / ${v.n}`]), [1, 2, 3])}</div>` : ''}`;

    // 同店同日合計：看有沒有達到免稅／退稅門檻
    const g = {};
    ledger.forEach((e) => { const k = `${e.date}|${e.store.toLowerCase()}`; (g[k] ||= { date: e.date, store: e.store, sum: 0 }).sum += e.amt; });
    const gr = Object.values(g).sort((a, b) => a.date.localeCompare(b.date)).map((x) => {
      const r = regimeOf(x.date);
      const min = r ? r.min : 0;
      const pre = Math.round(x.sum / 1.1); // 官方門檻看「未稅」金額；以 10% 稅粗估（外帶食品 8% 會略有差異）
      return [esc(x.store), x.date.slice(5).replace('-', '/'), `${yen(x.sum)}（未稅約 ${yen(pre)}）`, r ? `${r.name}：${pre >= min ? '✅ 已達 ' + yen(min) : '未稅還差約 ' + yen(min - pre)}` : '—'];
    });
    const sumHtml = gr.length ? `<h2 class="h2">同店同日合計 vs 退稅門檻</h2><p class="sub">各店門檻與規則見「退稅指南」，這裡用「同一家店、同一天」的合計，換成未稅金額粗略判斷。</p>${table(['店家', '日期', '合計', '門檻'], gr, [1, 2])}` : '';

    const rows = [...ledger].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    box.innerHTML = sumHtml + (rows.length ? `<h2 class="h2">全部紀錄</h2><div class="ledger-list">${rows.map((e) => `
      <div class="le card" data-id="${e.id}">
        <div class="le-top"><div><b>${esc(e.store)}</b>${e.item ? `<span class="tn"> ${esc(e.item)}</span>` : ''}</div><div class="le-amt">${yen(e.amt)}<span class="tn">${twd(e.amt)}</span></div></div>
        <div class="le-meta"><span class="pill">${e.date.slice(5).replace('-', '/')}</span><span class="pill">${esc(e.pay)}</span><span class="pill">${esc(e.kind)}</span></div>
        <div class="le-flags">
          <button class="chip ${e.rcpt ? 'on' : ''}" data-f="rcpt">🧾 收據</button>
          <button class="chip ${e.tax ? 'on' : ''}" data-f="tax">💴 已辦退稅</button>
          <button class="chip ${e.chk ? 'on' : ''}" data-f="chk">✅ 已核對</button>
          <button class="chip del" data-f="del" aria-label="刪除">刪除</button>
        </div>
      </div>`).join('')}</div>
      <div class="start-row" style="margin-top:14px"><button class="btn" id="lgCsv" type="button">⬇ 匯出 CSV</button><button class="btn" id="lgClear" type="button">清空全部</button></div>` : '<p class="muted" style="margin-top:20px">還沒有紀錄。買完東西就加一筆，之後可以對信用卡帳單和收據。</p>');
    $$('#ledgerList .le').forEach((card) => card.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-f]');
      if (!b) return;
      const id = Number(card.dataset.id);
      const e = ledger.find((x) => x.id === id);
      if (!e) return;
      if (b.dataset.f === 'del') { if (!confirm('刪除這筆紀錄？')) return; ledger = ledger.filter((x) => x.id !== id); } else e[b.dataset.f] = !e[b.dataset.f];
      saveLedger();
      renderLedger();
    }));
    const csv = $('#lgCsv');
    if (csv) csv.addEventListener('click', () => {
      const q = (v) => `"${String(v ?? '').replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`;
      const lines = [['日期', '店家', '品項', '含稅金額(日圓)', '付款方式', '類別', '收據', '已辦退稅', '已核對'].map(q).join(',')]
        .concat(ledger.map((e) => [e.date, e.store, e.item, e.amt, e.pay, e.kind, e.rcpt ? '有' : '', e.tax ? '是' : '', e.chk ? '是' : ''].map(q).join(',')));
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'tokyo-shopping.csv'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    const clr = $('#lgClear');
    if (clr) clr.addEventListener('click', () => { if (confirm('清空全部購物紀錄？這個動作無法復原。')) { ledger = []; saveLedger(); renderLedger(); } });
  }


  /* ---------- 行程編輯器 ---------- */
  const plain = (h) => String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? '').trim()); return m ? +m[1] * 60 + +m[2] : null; };
  const fromMin = (n) => { n = Math.max(0, Math.min(1439, Math.round(n))); return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; };
  const fmtDur = (m) => (m < 60 ? `${m} 分` : `${Math.floor(m / 60)} 小時${m % 60 ? ` ${m % 60} 分` : ''}`);
  // 兩點之間的交通分鐘數：直線距離 ×1.3 換算（≤15 分鐘步行，其餘搭電車），只是估算，可手動改
  function estTravel(a, b) {
    if (!a || !b || !a.lat || !b.lat) return 15;
    const rad = Math.PI / 180, dLa = (b.lat - a.lat) * rad, dLn = (b.lng - a.lng) * rad;
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLn / 2) ** 2;
    const d = 2 * 6371 * Math.asin(Math.sqrt(h)) * 1.3;
    const walk = (d / 4.8) * 60;
    // 走路 15 分鐘內就走路；再遠搭電車：等車＋進出站約 10 分，市區約時速 25 公里、郊外快車約 60 公里
    const m = walk <= 15 ? walk : 10 + (d / (d > 30 ? 60 : 25)) * 60;
    return Math.min(180, Math.max(5, Math.round(m / 5) * 5));
  }
  const STAY_OPTS = [5, 10, 15, 20, 25, 30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300, 360, 480];
  const TRAVEL_OPTS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 75, 90, 105, 120, 150, 180];
  const selOpts = (list, v, fmt) => [...new Set([...list, v])].sort((x, y) => x - y).map((m) => `<option value="${m}" ${m === v ? 'selected' : ''}>${fmt(m)}</option>`).join('');
  const timeSel = (v) => {
    const cur = toMin(v), h = cur === null ? -1 : Math.floor(cur / 60), mi = cur === null ? -1 : cur % 60;
    const hs = ['<option value="">--</option>'];
    for (let x = 4; x < 24; x++) hs.push(`<option value="${x}" ${x === h ? 'selected' : ''}>${String(x).padStart(2, '0')} 時</option>`);
    const ms = [...new Set([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, ...(mi >= 0 ? [mi] : [])])].sort((a, b) => a - b)
      .map((x) => `<option value="${x}" ${x === mi ? 'selected' : ''}>${String(x).padStart(2, '0')} 分</option>`);
    return `<span class="ed-time"><select class="in ed-h" aria-label="開始（時）">${hs.join('')}</select><select class="in ed-m" aria-label="開始（分）">${ms.join('')}</select></span>`;
  };
  const timeOpts = (v) => {
    const cur = toMin(v), set = [];
    for (let m = 240; m < 1440; m += 5) set.push(m);
    if (cur !== null && !set.includes(cur)) { set.push(cur); set.sort((x, y) => x - y); }
    const raw = v && cur === null ? `<option value="${escH(v)}" selected>${escH(v)}</option>` : '';
    return `<option value="" ${v ? '' : 'selected'}>--:--</option>${raw}` + set.map((m) => `<option value="${fromMin(m)}" ${cur === m ? 'selected' : ''}>${fromMin(m)}</option>`).join('');
  };


  /* ---------- 滾輪時間選擇器（底部彈出，時／分兩欄，分鐘 5 分一格） ---------- */
  function wheelPick({ title, h, m, hMin = 0, hMax = 23, sub }) {
    return new Promise((done) => {
      const IH = 44, pad = (n) => String(n).padStart(2, '0');
      const hs = []; for (let x = hMin; x <= hMax; x++) hs.push(x);
      const ms = []; for (let x = 0; x < 60; x += 5) ms.push(x);
      if (!ms.includes(m)) { ms.push(m); ms.sort((a, b) => a - b); }
      const col = (list, unit) => `<div class="wp-col" tabindex="0">${list.map((v) => `<div class="wp-it">${pad(v)}</div>`).join('')}</div>${unit ? `<span class="wp-unit">${unit}</span>` : ''}`;
      const mask = document.createElement('div');
      mask.className = 'wp-mask';
      mask.innerHTML = `<div class="wp-sheet" role="dialog" aria-label="${title}"><h3>${title}</h3>${sub ? `<p class="wp-sub">${sub}</p>` : ''}
        <div class="wp-wheels"><div class="wp-bar"></div>${col(hs, sub ? '小時' : '')}<span class="wp-sep">:</span>${col(ms, sub ? '分' : '')}</div>
        <button class="btn primary wp-ok" type="button">確定</button></div>`;
      document.body.appendChild(mask);
      const [ch, cm] = $$('.wp-col', mask);
      ch.scrollTop = Math.max(0, hs.indexOf(h)) * IH;
      cm.scrollTop = Math.max(0, ms.indexOf(m)) * IH;
      const idx = (c, n) => Math.min(n - 1, Math.max(0, Math.round(c.scrollTop / IH)));
      const close = (v) => { mask.classList.add('out'); setTimeout(() => mask.remove(), 180); done(v); };
      mask.addEventListener('click', (e) => { if (e.target === mask) close(null); });
      $('.wp-ok', mask).addEventListener('click', () => close({ h: hs[idx(ch, hs.length)], m: ms[idx(cm, ms.length)] }));
      // 點某一格也能直接跳過去
      [[ch, hs], [cm, ms]].forEach(([c]) => c.addEventListener('click', (e) => {
        const it = e.target.closest('.wp-it'); if (!it) return;
        c.scrollTo({ top: [...c.children].indexOf(it) * IH, behavior: 'smooth' });
      }));
      requestAnimationFrame(() => mask.classList.add('in'));
    });
  }

  function openEditor(i) {
    const d = T.days[i];
    let rows = d.stops.map((s, k) => ({
      orig: s._o ?? k, t: s.t || '', name: plain(s.name), it: plain(s.it), note: plain(s.note), q: s.q,
      noteText: ((s._o ?? k) < 0 || plain(s.note) !== plain((ORIG[i][s._o ?? k] || {}).note)) ? plain(s.note) : undefined,
      lat: s.lat, lng: s.lng, gname: s.gname, stay: s.stay, travel: s.travel, tm: s.tm,
    }));
    // 舊資料沒有「停留／交通」：由原本兩站的時間差拆成「交通估算」＋「停留」，總時間不變
    rows.forEach((r, k) => {
      const nx = rows[k + 1];
      if (!nx) { r.travel = 0; r.stay = r.stay || 60; return; }
      if (Number.isFinite(r.stay) && Number.isFinite(r.travel)) return;
      const g0 = toMin(nx.t) !== null && toMin(r.t) !== null ? toMin(nx.t) - toMin(r.t) : null;
      if (Number.isFinite(r.stay) && g0 !== null && g0 >= r.stay) { r.travel = g0 - r.stay; return; }
      const gap = toMin(nx.t) !== null && toMin(r.t) !== null ? toMin(nx.t) - toMin(r.t) : null;
      const est = estTravel(r, nx);
      if (gap !== null && gap > 0) { r.travel = Math.min(est, Math.max(0, gap - 5)); r.stay = gap - r.travel; }
      else { r.travel = est; r.stay = 60; }
    });
    const body = $('#dayBody');
    const auto = () => $('#edCas')?.checked !== false;
    const reest = (j) => { if (j >= 0 && j < rows.length - 1 && !rows[j].tm) rows[j].travel = estTravel(rows[j], rows[j + 1]); };
    const chain = (from) => {
      if (!auto()) return;
      for (let j = Math.max(0, from); j < rows.length - 1; j++) {
        const a = toMin(rows[j].t);
        if (a !== null) rows[j + 1].t = fromMin(a + rows[j].stay + rows[j].travel);
      }
    };
    const msg = (t, bad) => { const m = $('#edMsg'); if (!m) return; m.textContent = t; m.style.color = bad ? 'var(--danger, #ff453a)' : ''; };
    const paint = (note) => {
      body.innerHTML = `<div class="day-intro"><h2 class="h2" style="margin-top:0">✏️ 編輯 Day ${i + 1}</h2>
        <p>每一站有「開始時間、停留、到下一站的交通」，改任何一個，<b>後面的時間會自動重算</b>。新增、刪除、換順序也一樣。</p>
        <p class="ed-warn">⚠️ 標「估」的交通時間是用兩站<b>直線距離</b>推算的（走路 15 分鐘內算走路，其餘算搭電車），不是查詢實際班次，<b>不保證準確</b>。新增的景點要輸入名稱後才會去找位置、估算；出發前請用 Google 地圖的「導航」按鈕再確認，實際時間可以自己改，改過的不會被覆蓋。</p></div>
        <label class="ed-cas"><input type="checkbox" id="edCas" ${localStorage.getItem('tokyo.cascade') === '0' ? '' : 'checked'}> 自動重算後面的時間（停留＋交通）</label>
        <div class="ed-list">${rows.map((r, k) => {
          const end = toMin(r.t) !== null ? fromMin(toMin(r.t) + r.stay) : '';
          return `<div class="ed-row" data-k="${k}">
          <div class="ed-top"><button class="in ed-pick ed-tbtn" type="button" data-f="t" aria-label="開始時間">${r.t || '--:--'}</button>
            <input class="in ed-n" value="${escH(r.name)}" placeholder="景點名稱（日文最準）" maxlength="80" aria-label="名稱"></div>
          <div class="ed-times"><label>停留 <button class="in ed-pick" type="button" data-f="stay">${fmtDur(r.stay)}</button></label>
            ${k < rows.length - 1 ? `<label>到下一站 <button class="in ed-pick" type="button" data-f="travel">${r.travel ? fmtDur(r.travel) : '0 分'}</button>${r.tm ? '' : '<small class="ed-est">估</small>'}</label>` : ''}
            ${end ? `<span class="ed-end">${end} 離開</span>` : ''}
            <span class="ed-tools"><button class="btn sm" data-a="up" ${k ? '' : 'disabled'} aria-label="上移">↑</button><button class="btn sm" data-a="dn" ${k < rows.length - 1 ? '' : 'disabled'} aria-label="下移">↓</button><button class="btn sm" data-a="ins" aria-label="在後面插入" title="在後面插入">＋</button><button class="btn sm" data-a="rm" aria-label="刪除">🗑</button></span></div>
          <textarea class="in ed-note" rows="2" placeholder="備註" maxlength="1500" aria-label="備註">${escH(r.note)}</textarea></div>`;
        }).join('')}</div>
        <div class="day-actions"><button class="btn sm" data-a="add">＋ 加在最後</button>
          <button class="btn primary sm" data-a="save">💾 存檔</button>
          <button class="btn sm" data-a="cancel">取消</button>
          <button class="btn sm" data-a="reset">還原成原始行程</button></div><p class="ed-msg" id="edMsg" role="status"></p>`;
      if (note) msg(note);
    };
    const sync = () => $$('.ed-row', body).forEach((el) => {
      const r = rows[+el.dataset.k];
      if (!r) return;
      r.name = $('.ed-n', el).value.trim();
      const nv = $('.ed-note', el).value;
      if (nv !== r.note) { r.note = nv; r.noteText = nv; }
    });
    const send = async (payload) => {
      let key = localStorage.getItem('tokyo.editkey') || '';
      if (!key) { key = (prompt('輸入編輯密碼') || '').trim(); if (!key) { msg('需要編輯密碼才能存檔', true); return false; } }
      msg('儲存中…');
      try {
        const r = await fetch('/api/plan', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-edit-key': key }, body: JSON.stringify({ day: i, ...payload }) });
        if (r.status === 401) { localStorage.removeItem('tokyo.editkey'); msg('編輯密碼不正確', true); return false; }
        if (!r.ok) { msg(r.status === 405 || r.status === 404 ? '這個網址不能存檔，請改用 tokyo-trip-2pc.pages.dev' : '存檔失敗（' + r.status + '）', true); return false; }
        const saved = await r.json();
        try { localStorage.setItem('tokyo.editkey', key); localStorage.setItem(EDITS_KEY, JSON.stringify(saved)); } catch { /* 無痕模式：已存到雲端，只是沒快取 */ }
        return true;
      } catch { msg('網路有問題，沒存到', true); return false; }
    };
    const blank = (t, travel) => ({ orig: -1, t, name: '', it: '', note: '', stay: 60, travel, stayAuto: true });
    // 新景點：AI 轉成日文正式名稱＋寫介紹＋建議停留，再找離前後站最近的座標，重算前後交通
    const near = (r) => { const k = rows.indexOf(r); return { k, prev: rows[k - 1], next: rows[k + 1] }; };
    async function lookup(r, quiet) {
      const key = localStorage.getItem('tokyo.editkey');
      if (!key) { if (!quiet) msg('名稱已改。開啟雲端同步後，會自動找位置、寫介紹、估算交通時間。'); return; }
      const ask = r.name;
      if (!quiet) msg(`AI 正在查「${ask}」…（約 10–30 秒）`);
      try {
        const { prev, next } = near(r);
        const g = await (await fetch('/api/place', { method: 'POST', headers: { 'content-type': 'application/json', 'x-edit-key': key }, body: JSON.stringify({
          name: ask, area: plain(d.area), prevName: prev && prev.name, nextName: next && next.name,
          prev: prev && prev.lat ? { lat: prev.lat, lng: prev.lng } : null, next: next && next.lat ? { lat: next.lat, lng: next.lng } : null,
        }) })).json();
        if (r.name !== ask || !rows.includes(r)) return; // 查的時候名稱又改了或被刪了
        sync();
        const done = [];
        if (g.lat) { r.lat = g.lat; r.lng = g.lng; r.gname = r.name; done.push('找到位置'); } else { r.lat = r.lng = undefined; r.gname = undefined; }
        if (g.ja && !r.it) { r.it = g.ja; }
        if (g.desc && !r.note.trim()) { r.note = r.noteText = `${g.desc}\n（AI 產生的介紹，營業時間與票價請自己確認）`; done.push('寫了介紹'); }
        if (g.stay && r.stayAuto) { r.stay = g.stay; done.push(`建議停留 ${fmtDur(g.stay)}`); }
        const k = rows.indexOf(r);
        if (k > 0) rows[k - 1].tm = false;
        r.tm = false;
        reest(k - 1); reest(k); chain(k - 1);
        const tv = `前一站到這裡 ${k ? fmtDur(rows[k - 1].travel) : '—'}、到下一站 ${k < rows.length - 1 ? fmtDur(r.travel) : '—'}`;
        paint(g.lat ? `${done.join('、')}；交通用距離估算（${tv}），後面的時間已重算` : `${done.length ? done.join('、') + '；' : ''}找不到位置（可改用日文名稱），交通時間請自己選`);
      } catch { if (!quiet) msg('AI 查詢失敗，交通時間請自己選。'); }
    }
    body.onchange = async (e) => {
      const t = e.target;
      if (t.id === 'edCas') { localStorage.setItem('tokyo.cascade', t.checked ? '1' : '0'); return; }
      const row = t.closest('.ed-row');
      if (!row) return;
      sync();
      const k = +row.dataset.k, r = rows[k];
      if (t.classList.contains('ed-h') || t.classList.contains('ed-m')) {
        const hh = $('.ed-h', row).value, mm = $('.ed-m', row).value;
        r.t = hh === '' ? '' : fromMin(+hh * 60 + (+mm || 0));
        chain(k); paint('後面的時間已重算');
      }
      else if (t.classList.contains('ed-s')) { r.stay = +t.value; r.stayAuto = false; chain(k); paint('後面的時間已重算'); }
      else if (t.classList.contains('ed-v')) { r.travel = +t.value; r.tm = true; chain(k); paint('後面的時間已重算'); }
      else if (t.classList.contains('ed-n') && r.orig < 0 && r.name && r.name !== r.gname) lookup(r);
    };
    body.onclick = async (e) => {
      const pk = e.target.closest('.ed-pick');
      if (pk) {
        sync();
        const k = +pk.closest('.ed-row').dataset.k, r = rows[k], f = pk.dataset.f;
        if (f === 't') {
          const cur = toMin(r.t) ?? 9 * 60;
          const v = await wheelPick({ title: '開始時間', h: Math.floor(cur / 60), m: cur % 60 });
          if (!v) return;
          r.t = fromMin(v.h * 60 + v.m);
        } else {
          const cur = f === 'stay' ? r.stay : r.travel;
          const v = await wheelPick({ title: f === 'stay' ? '預計停留時間' : '到下一站的交通時間', sub: f === 'stay' ? '' : '改過的交通時間會保留，不會再被估算覆蓋', h: Math.floor(cur / 60), m: cur % 60, hMax: f === 'stay' ? 12 : 5 });
          if (!v) return;
          const n = v.h * 60 + v.m;
          if (f === 'stay') { r.stay = Math.max(5, n); r.stayAuto = false; } else { r.travel = n; r.tm = true; }
        }
        chain(k); paint('後面的時間已重算');
        return;
      }
      const b = e.target.closest('[data-a]'); if (!b) return;
      const a = b.dataset.a, k = +(b.closest('.ed-row')?.dataset.k ?? -1);
      if (a === 'cancel') { body.onclick = null; body.onchange = null; renderDay(i); return; }
      sync();
      if (a === 'up' || a === 'dn') {
        const j = a === 'up' ? k - 1 : k + 1, lo = Math.min(k, j), t0 = rows[lo].t;
        [rows[k], rows[j]] = [rows[j], rows[k]];
        rows[lo].t = t0;
        [lo - 1, lo, lo + 1].forEach((x) => { if (rows[x]) rows[x].tm = false; });
        if (auto()) { reest(lo - 1); reest(lo); reest(lo + 1); chain(Math.max(0, lo - 1)); }
        paint(auto() ? '已換位，前後的交通與時間已重算' : '已換位');
      } else if (a === 'rm') {
        const gone = rows[k];
        rows.splice(k, 1);
        if (auto() && rows.length) {
          if (k > 0) { rows[k - 1].tm = false; reest(k - 1); chain(k - 1); }
          else if (rows[0] && toMin(gone.t) !== null) { rows[0].t = gone.t; chain(0); }
        }
        paint(auto() ? `已刪除，後面的時間往前移（省下 ${fmtDur((gone.stay || 0) + (gone.travel || 0))}）` : '已刪除');
      } else if (a === 'ins') {
        const prev = rows[k], oldTravel = prev.travel;
        const nr = blank('', oldTravel);
        prev.travel = 15; prev.tm = false;
        const at = toMin(prev.t);
        nr.t = at !== null ? fromMin(at + prev.stay + prev.travel) : '';
        rows.splice(k + 1, 0, nr);
        if (k + 2 >= rows.length) nr.travel = 0;
        if (prev.lat && rows[k + 2] && rows[k + 2].lat) nr.travel = 15;
        chain(k);
        paint(auto() ? '已插入：開始時間＝上一站離開＋交通 15 分。填名稱後會自動找位置、重算交通；後面的行程已順延' : '已插入（沒勾自動重算，後面時間不變）');
        $$('.ed-n', body)[k + 1].focus();
      } else if (a === 'add') {
        const last = rows[rows.length - 1];
        last.travel = 15; last.tm = false;
        const at = toMin(last.t);
        rows.push(blank(at !== null ? fromMin(at + last.stay + 15) : '', 0));
        paint('已加在最後，開始時間＝上一站離開＋交通 15 分');
        $$('.ed-n', body).at(-1).focus();
      } else if (a === 'reset') {
        if (!confirm('這天的修改全部清掉，還原成原本的行程？')) return;
        if (await send({ reset: true })) location.reload();
      } else if (a === 'save') {
        const ok = rows.filter((r) => r.name);
        if (!ok.length) return msg('至少要留一個景點', true);
        const stops = ok.map((r) => ({
          orig: r.orig, t: toMin(r.t) !== null ? fromMin(toMin(r.t)) : r.t, name: r.name, it: r.it || undefined, noteText: r.noteText,
          stay: r.stay, travel: r.travel, tm: r.tm || undefined,
          q: r.orig < 0 ? r.name : undefined,
          ...(r.orig < 0 && r.lat && r.gname === r.name ? { lat: r.lat, lng: r.lng, gname: r.gname } : {}),
        }));
        if (await send({ stops })) location.reload();
      }
    };
    paint();
    body.scrollIntoView({ block: 'nearest' });
    const far = (a, b) => a && b && a.lat && b.lat && Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 91) > 25;
    rows.filter((r, k) => r.orig < 0 && r.lat && (rows[k - 1] || rows[k + 1]) && (!rows[k - 1] || far(r, rows[k - 1])) && (!rows[k + 1] || far(r, rows[k + 1])))
      .forEach((r) => { msg(`「${r.name}」的位置離前後站太遠，可能找錯了，重新查詢中…`); lookup(r, true); });
  }
  async function syncCloud() {
    try {
      const r = await fetch('/api/plan', { cache: 'no-store' });
      if (!r.ok) return;
      const t = await r.text();
      const doc = JSON.parse(t);
      const now = JSON.stringify({ days: doc.days || {} });
      const was = JSON.stringify({ days: cachedEdits.days || {} });
      if (now !== was && !sessionStorage.getItem('tokyo.syncing')) {
        localStorage.setItem(EDITS_KEY, t);
        sessionStorage.setItem('tokyo.syncing', '1');
        location.reload();
      } else sessionStorage.removeItem('tokyo.syncing');
    } catch { /* 離線或不在 Cloudflare 網址：用本機快取 */ }
  }

  /* ---------- 收據拍照辨識（Workers AI，結果只當建議，要核對） ---------- */
  async function shrinkImage(file) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  }
  async function scanReceipt(file, say) {
    if (!cloudKey()) { say('要先到「總覽」開啟雲端同步（輸入編輯密碼），才能用拍照辨識。'); return null; }
    say('辨識中…（約 5–15 秒）');
    try {
      const r = await fetch('/api/receipt', { method: 'POST', headers: { 'content-type': 'application/json', 'x-edit-key': cloudKey() }, body: JSON.stringify({ image: await shrinkImage(file) }) });
      const j = await r.json();
      if (!r.ok) { say(j.error || '辨識失敗'); return null; }
      if (!j.store && !j.total) { say('讀不出來，請拍清楚一點（平放、光線足、整張入鏡）或手動輸入。'); return null; }
      say('已帶入，<b>請對照收據核對店名和金額</b>再加入。');
      return j;
    } catch { say('辨識失敗，網路有問題或照片太大。'); return null; }
  }
  const scanBtn = (id) => `<label class="btn sm scan" for="${id}">📷 拍收據辨識</label><input id="${id}" type="file" accept="image/*" capture="environment" hidden>`;

  /* ---------- 記帳：共同分帳（雲端合併）＋ 私人支出（只存這支手機） ---------- */
  const EXP_CATS = ['餐飲', '交通', '購物', '門票', '住宿', '其他'];
  const loadJ = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  let people = loadJ('tokyo.people', null);
  if (!Array.isArray(people) || !people.length) people = ['我', '同伴'];
  let shared = loadJ('tokyo.shared', []);
  if (!Array.isArray(shared)) shared = [];
  let priv = loadJ('tokyo.private', []);
  if (!Array.isArray(priv)) priv = [];
  let meName = localStorage.getItem('tokyo.me');
  if (!people.includes(meName)) meName = people[0];
  const draft = { vis: 'shared', payer: meName, split: new Set(people) };
  const savePeople = () => { localStorage.setItem('tokyo.people', JSON.stringify(people)); cloudPush('people'); };
  const saveShared = () => { localStorage.setItem('tokyo.shared', JSON.stringify(shared)); cloudPush('shared'); };
  const savePriv = () => localStorage.setItem('tokyo.private', JSON.stringify(priv));

  function settle() {
    const bal = {};
    const add = (n, v) => { bal[n] = (bal[n] || 0) + v; };
    people.forEach((n) => add(n, 0));
    shared.filter((e) => !e.del).forEach((e) => {
      add(e.payer, e.amt);
      const sp = e.split && e.split.length ? e.split : [e.payer];
      sp.forEach((n) => add(n, -e.amt / sp.length));
    });
    const cr = [], de = [];
    const rb = Object.fromEntries(Object.entries(bal).map(([n, v]) => [n, Math.round(v)]));
    const drift = Object.values(rb).reduce((a, v) => a + v, 0);
    if (drift) { const top = Object.keys(rb).sort((a, b) => rb[b] - rb[a])[0]; rb[top] -= drift; }
    Object.keys(bal).forEach((n) => { bal[n] = rb[n]; });
    Object.entries(rb).forEach(([n, r]) => { if (r > 0) cr.push([n, r]); else if (r < 0) de.push([n, -r]); });
    cr.sort((a, b) => b[1] - a[1]); de.sort((a, b) => b[1] - a[1]);
    const tx = [];
    let i = 0, j = 0;
    while (i < cr.length && j < de.length) {
      const m = Math.min(cr[i][1], de[j][1]);
      tx.push({ from: de[j][0], to: cr[i][0], amt: m });
      cr[i][1] -= m; de[j][1] -= m;
      if (!cr[i][1]) i++;
      if (!de[j][1]) j++;
    }
    return { bal, tx };
  }

  function renderExpenses() {
    const box = $('#shopExp');
    if (!box || !$('#exSum')) return;
    // 旅伴
    $('#exPeople').innerHTML = people.map((n) => `<button class="chipb ${n === meName ? 'on' : ''}" data-p="${esc(n)}" type="button">${esc(n)}${n === meName && n !== '我' ? '（我）' : ''}</button>`).join('') +
      `<button class="chipb add" id="exAddP" type="button">＋ 新增旅伴</button>`;
    $('#exPayer').innerHTML = people.map((n) => `<button class="chipb ${n === draft.payer ? 'on' : ''}" data-payer="${esc(n)}" type="button">${esc(n)}</button>`).join('');
    $('#exSplit').innerHTML = people.map((n) => `<label class="splitrow"><span>${esc(n)}</span><input type="checkbox" data-sp="${esc(n)}" ${draft.split.has(n) ? 'checked' : ''}></label>`).join('');
    $$('#exVis button').forEach((b) => b.classList.toggle('on', b.dataset.v === draft.vis));
    $('#exSharedOnly').hidden = draft.vis !== 'shared';
    // 摘要
    const live = shared.filter((e) => !e.del);
    const { bal, tx } = settle();
    const total = live.reduce((a, e) => a + e.amt, 0);
    const mine = priv.filter((e) => !e.del).reduce((a, e) => a + e.amt, 0);
    $('#exSum').innerHTML = `<div class="card"><h3>分帳結算</h3>
      <div class="ex-tot"><div><small>共同支出</small><b>${yen(total)}</b><em>${twd(total)}</em></div><div><small>我的私人支出 🔒</small><b>${yen(mine)}</b><em>${twd(mine)}</em></div></div>
      ${live.length ? `<table class="ex-tb"><tr><th>人</th><th>先付</th><th>應分攤</th><th>差額</th></tr>${Object.keys(bal).map((n) => {
        const paid = live.filter((e) => e.payer === n).reduce((a, e) => a + e.amt, 0);
        const owe = paid - bal[n];
        return `<tr><td>${esc(n)}</td><td>${yen(paid)}</td><td>${yen(Math.round(owe))}</td><td class="${bal[n] >= 0 ? 'pos' : 'neg'}">${bal[n] >= 0 ? '+' : '−'}${yen(Math.abs(Math.round(bal[n])))}</td></tr>`;
      }).join('')}</table>
      ${tx.length ? `<div class="ex-tx">${tx.map((t) => `<div>👉 <b>${esc(t.from)}</b> 付給 <b>${esc(t.to)}</b> <b>${yen(t.amt)}</b>（${twd(t.amt)}）</div>`).join('')}</div>` : '<p class="src">目前沒有人欠錢，帳是平的。</p>'}` : '<p class="src">還沒有共同支出。</p>'}</div>`;
    // 清單
    const row = (e, lock) => `<div class="ex-item"><div class="ex-main"><b>${esc(e.title)}</b><span class="ex-m">${esc(e.date)}・${esc(e.cat)}${lock ? '' : `・${esc(e.payer)} 先付，${(e.split || []).length} 人分`}</span>${lock ? '' : `<span class="ex-m">分攤：${(e.split || []).map(esc).join('、')}</span>`}</div>
      <div class="ex-r"><b>${yen(e.amt)}</b><button class="btn sm" data-del="${e.id}" data-lock="${lock ? 1 : 0}" type="button" aria-label="刪除">🗑</button></div></div>`;
    $('#exList').innerHTML = `<h3 class="h3">共同支出 <span class="cnt">${live.length}</span></h3>${live.slice().reverse().map((e) => row(e, false)).join('') || '<p class="src">還沒有。</p>'}
      <h3 class="h3">🔒 私人支出（只存在這支手機，不會上傳）</h3>${priv.filter((e) => !e.del).slice().reverse().map((e) => row(e, true)).join('') || '<p class="src">還沒有。</p>'}`;
  }

  function buildExpense() {
    const days = tripDates();
    const today = isoOf(new Date());
    const opts = days.map((d) => `<option value="${isoOf(d)}" ${isoOf(d) === today ? 'selected' : ''}>${fmtDay(d)}</option>`).join('') || `<option value="${today}">${today}</option>`;
    $('#shopExp').innerHTML = `
      <div id="exSum"></div>
      <div class="card ledger-form"><h3>新增支出</h3>
        <div class="ex-lbl">可見性</div>
        <div class="vis" id="exVis"><button type="button" data-v="shared">👥<b>共同</b><small>同行旅伴可見、要分帳</small></button><button type="button" data-v="private">🔒<b>私人</b><small>只存在這支手機</small></button></div>
        <div id="exSharedOnly"><div class="ex-lbl">誰付款？</div><div class="chips" id="exPayer"></div>
          <div class="ex-lbl">誰要分攤？</div><div id="exSplit"></div></div>
        <div class="lf-grid">
          <label>日期<select class="in" id="exDate">${opts}</select></label>
          <label>類別<select class="in" id="exCat">${EXP_CATS.map((c) => `<option>${c}</option>`).join('')}</select></label>
          <label>項目<input class="in" id="exTitle" placeholder="例如 午餐、地鐵" autocomplete="off"></label>
          <label>金額（日圓）<input class="in" id="exAmt" type="number" inputmode="numeric" min="1" step="1" placeholder="例如 3200"></label>
        </div>
        <div class="day-actions">${scanBtn('exScan')}<button class="btn primary" id="exAdd" type="button">＋ 花下去！</button></div>
        <p class="src" id="exHint"></p></div>
      <div class="card"><div class="ex-lbl">旅伴（點自己的名字設成「我」，這支手機的付款人會預設是你）</div><div class="chips" id="exPeople"></div></div>
      <div id="exList"></div>`;
    const box = $('#shopExp');
    box.addEventListener('click', (e) => {
      const v = e.target.closest('#exVis button');
      if (v) { draft.vis = v.dataset.v; renderExpenses(); return; }
      const pay = e.target.closest('[data-payer]');
      if (pay) { draft.payer = pay.dataset.payer; renderExpenses(); return; }
      const pe = e.target.closest('#exPeople [data-p]');
      if (pe) {
        const n = pe.dataset.p;
        if (n !== meName) { meName = n; localStorage.setItem('tokyo.me', n); draft.payer = n; renderExpenses(); return; }
        const nv = (prompt(`「${n}」改名？輸入新名字；輸入「刪除」可移除這位旅伴。`, n) || '').trim();
        if (!nv || nv === n) return;
        if (nv === '刪除') {
          if (people.length < 2) return alert('至少要留一位。');
          if (shared.some((x) => !x.del && (x.payer === n || (x.split || []).includes(n)))) return alert('這位旅伴已有共同支出，不能刪除；可以改名。');
          people = people.filter((x) => x !== n); meName = people[0]; draft.split.delete(n); draft.payer = meName;
        } else {
          if (people.includes(nv) || nv.length > 12) return alert('名字重複或太長（最多 12 字）。');
          people = people.map((x) => (x === n ? nv : x));
          shared.forEach((x) => { if (x.payer === n || (x.split || []).includes(n)) { x.payer = x.payer === n ? nv : x.payer; x.split = (x.split || []).map((y) => (y === n ? nv : y)); x.m = Date.now(); } });
          if (draft.split.delete(n)) draft.split.add(nv);
          meName = nv; draft.payer = nv; localStorage.setItem('tokyo.me', nv); saveShared();
        }
        savePeople(); renderExpenses(); return;
      }
      if (e.target.closest('#exAddP')) {
        const nv = (prompt('新旅伴的名字（最多 12 字，最多 8 位）') || '').trim();
        if (!nv || nv.length > 12 || people.includes(nv) || people.length >= 8) return;
        people.push(nv); draft.split.add(nv); savePeople(); renderExpenses(); return;
      }
      const del = e.target.closest('[data-del]');
      if (del) {
        if (!confirm('刪除這筆？')) return;
        const id = +del.dataset.del;
        if (del.dataset.lock === '1') { priv = priv.filter((x) => x.id !== id); savePriv(); }
        else { const t = shared.find((x) => x.id === id); if (t) { t.del = true; t.m = Date.now(); saveShared(); } }
        renderExpenses(); return;
      }
      if (e.target.closest('#exAdd')) {
        const title = $('#exTitle').value.trim(), amt = Math.round(Number($('#exAmt').value));
        const hint = (t) => { $('#exHint').innerHTML = t; };
        if (!title || !(amt > 0)) return hint('項目和金額要填，金額要大於 0。');
        const base = { id: Date.now(), m: Date.now(), date: $('#exDate').value, cat: $('#exCat').value, title: title.slice(0, 40), amt };
        if (draft.vis === 'private') { priv.push(base); savePriv(); }
        else {
          const split = people.filter((n) => draft.split.has(n));
          if (!split.length) return hint('至少選一位分攤的人。');
          shared.push({ ...base, payer: draft.payer, split }); saveShared();
        }
        $('#exTitle').value = ''; $('#exAmt').value = '';
        hint(draft.vis === 'shared' ? '已加入共同帳。' + (cloudKey() ? '' : '（雲端同步沒開，只存在這支手機）') : '已加入私人支出，只存在這支手機。');
        renderExpenses();
      }
    });
    box.addEventListener('change', async (e) => {
      const sp = e.target.closest('[data-sp]');
      if (sp) { sp.checked ? draft.split.add(sp.dataset.sp) : draft.split.delete(sp.dataset.sp); return; }
      if (e.target.id === 'exScan' && e.target.files[0]) {
        const j = await scanReceipt(e.target.files[0], (t) => { $('#exHint').innerHTML = t; });
        e.target.value = '';
        if (!j) return;
        if (j.store) $('#exTitle').value = j.store;
        if (j.total) $('#exAmt').value = j.total;
        if (j.date && [...$('#exDate').options].some((o) => o.value === j.date)) $('#exDate').value = j.date;
      }
    });
    renderExpenses();
  }

  /* ---------- 行程檢查：用已查證的營業時間做規則計算（不靠 AI、不編造） ---------- */
  // m＝景點名稱關鍵字；o 開、c 關、last 最後入場；cw 某星期的關門時間（0=日…6=六）；closed 公休星期；out 戶外
  const HOURS = [
    { m: '巢鴨地藏通', o: '10:00', c: '18:00', out: 1, note: '有些攤位 16:00 就收' },
    { m: '竹下通', out: 1 },
    { m: 'SHIBUYA SKY', o: '10:00', c: '22:30', last: '21:20' },
    { m: '谷中銀座', o: '10:00', c: '18:00', out: 1 },
    { m: '淺草午餐', o: '11:00', c: '20:00' },
    { m: '雷門', o: '06:30', c: '17:00', out: 1 },
    { m: '東京晴空塔', o: '10:00', c: '22:00', last: '21:00' },
    { m: '木村家', c: '20:00' },
    { m: '銀座晚餐', o: '11:30', c: '22:00', last: '20:30' },
    { m: '豪德寺', o: '06:00', c: '17:00', out: 1 },
    { m: 'Alaska zwei', o: '09:00', c: '18:00', last: '17:00', cw: { 3: '16:00' } },
    { m: '國立新美術館', o: '10:00', c: '18:00', cw: { 5: '20:00', 6: '20:00' }, closed: [2], lastBefore: 30 },
    { m: '美術館晚餐', o: '16:00', c: '21:00', last: '19:30' },
    { m: 'bills', o: '07:00', c: '21:00', cw: { 1: '17:00' } },
    { m: '高德院', o: '08:00', c: '17:00', last: '16:45', out: 1 },
    { m: '東京迪士尼樂園', o: '09:00', c: '21:00' },
    { m: '小網神社', o: '09:00', c: '17:00', out: 1 },
    { m: '最後採買', o: '10:30', c: '23:00' },
    { m: '目黑川', out: 1 }, { m: '江之島', out: 1 }, { m: '鎌倉高校前站', out: 1 }, { m: '日光東照宮', out: 1 },
  ];
  const SUNSET = '16:50'; // 10/29–11/4 約 16:43–16:52，取近似值
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  function checkDay(i) {
    const d = T.days[i], out = [];
    const add = (lv, k, text) => out.push({ lv, k, text });
    const date = store.start ? addDays(store.start, i) : null;
    const dow = date ? date.getDay() : null;
    const sun = toMin(SUNSET);
    d.stops.forEach((s, k) => {
      const nm = plain(s.name), a = toMin(s.t);
      const h = s.hours ? { ...s.hours, out: s.kind === 'sight' && /寺|神社|公園|海|街|通|坂|湖|瀑布|橫丁|散步/.test(nm) ? 1 : 0 } : HOURS.find((x) => nm.includes(x.m));
      const stay = Number.isFinite(s.stay) ? s.stay : (d.stops[k + 1] && toMin(d.stops[k + 1].t) !== null && a !== null ? Math.max(0, toMin(d.stops[k + 1].t) - a) : 0);
      if (h && a !== null) {
        if (dow !== null && (h.closed || []).map(Number).includes(dow)) add('err', k, `${nm}：週${WD[dow]}公休，這天去會撲空。`);
        const close = toMin((dow !== null && h.cw && h.cw[dow]) || h.c);
        const last = h.last ? toMin(h.last) : h.lastBefore && close ? close - h.lastBefore : null;
        if (h.o && a < toMin(h.o)) add('info', k, `${nm}：${s.t} 抵達，但 ${h.o} 才開，要等 ${fmtDur(toMin(h.o) - a)}。`);
        if (close !== null && a >= close) add('err', k, `${nm}：${s.t} 才到，已經過了關門時間 ${fromMin(close)}。`);
        else if (last !== null && a > last) add('err', k, `${nm}：最後入場 ${fromMin(last)}，${s.t} 到會進不去。`);
        else if (close !== null && stay && a + stay > close) add('warn', k, `${nm}：預計待到 ${fromMin(a + stay)}，但 ${fromMin(close)} 關門，要提早離開。`);
        else if (close !== null && close - a <= 45) add('info', k, `${nm}：${fromMin(close)} 關門，只剩 ${close - a} 分鐘。`);
      }
      if ((h && h.out || /公園|神社|寺|海邊|商店街|通り|銀座・|橫丁/.test(nm)) && a !== null && a >= sun + 10 && !/晚餐|午餐|夜景|SKY|塔|光雕|點燈|煙火|遊行|夜間/.test(nm)) add('warn', k, `${nm}：${s.t} 才到，天黑了（日落約 ${SUNSET}），戶外景點看不到什麼。`);
      const nx = d.stops[k + 1];
      if (nx && a !== null && toMin(nx.t) !== null) {
        const gap = toMin(nx.t) - a;
        if (Number.isFinite(s.stay) && gap < s.stay + (s.travel || 0)) add('err', k, `${nm}：停留 ${fmtDur(s.stay)}＋交通 ${fmtDur(s.travel || 0)} 超過到下一站的時間差，時間對不上。`);
        else if (s.lat && nx.lat && s.kind !== 'move') {
          const est = estTravel(s, nx), left = gap - (Number.isFinite(s.stay) ? s.stay : 0);
          if (est <= 60 && gap > 0 && left < est * 0.6 && !Number.isFinite(s.stay)) add('warn', k, `${nm} → ${plain(nx.name)}：只留 ${gap} 分鐘，交通估算就要約 ${est} 分鐘，會很趕。`);
        }
      }
    });
    const times = d.stops.map((s) => toMin(s.t)).filter((x) => x !== null);
    if (times.length > 1) {
      const span = times[times.length - 1] - times[0];
      if (span > 13 * 60) add('warn', -1, `這天從 ${fromMin(times[0])} 排到 ${fromMin(times[times.length - 1])}，共 ${fmtDur(span)}，很累。`);
      if (times[times.length - 1] > 22 * 60 + 30) add('warn', -1, `這天最後一站排到 ${fromMin(times[times.length - 1])}，要想一下末班車。`);
    }
    if (i === NDAYS - 1) {
      const fly = d.stops.find((s) => /起飛/.test(plain(s.name)));
      const ap = d.stops.find((s) => /成田機場/.test(plain(s.name)) && !/前往/.test(plain(s.name)));
      if (fly && ap && toMin(fly.t) !== null && toMin(ap.t) !== null && toMin(fly.t) - toMin(ap.t) < 150) add('warn', d.stops.indexOf(ap), `${ap.t} 才到成田，離起飛 ${fly.t} 不到 2.5 小時；11/1 起買的免稅品要先辦退稅再託運，建議再提早。`);
      const late = ledger.filter((e) => e.date >= '2026-11-01' && !e.tax);
      if (late.length) add('info', -1, `購物紀錄有 ${late.length} 筆 11/1 起買的還沒辦退稅：新制要在成田辦海關終端機，之後才能託運行李，要多留約 30 分鐘。`);
    }
    return { out, sunset: SUNSET, date: date ? `${date.getMonth() + 1}/${date.getDate()}（週${WD[date.getDay()]}）` : '' };
  }
  function renderCheck(i) {
    const box = $('#dayCheck'); if (!box) return;
    const r = checkDay(i), n = r.out.length;
    const ic = { err: '⛔', warn: '⚠️', info: 'ℹ️' };
    const order = { err: 0, warn: 1, info: 2 };
    r.out.sort((x, y) => order[x.lv] - order[y.lv]);
    box.innerHTML = `<details class="chk" ${r.out.some((x) => x.lv === 'err') ? 'open' : ''}><summary>🔍 行程檢查：${n ? `${r.out.filter((x) => x.lv === 'err').length} 個問題、${r.out.filter((x) => x.lv === 'warn').length} 個提醒` : '沒有發現問題'}</summary>
      ${n ? `<ul>${r.out.map((x) => `<li class="${x.lv}">${ic[x.lv]} ${esc(x.text)}</li>`).join('')}</ul>` : '<p class="src">依已查證的營業時間、日落與交通估算，這天沒有衝突。</p>'}
      <p class="src">營業時間來自本站已查證的資料，沒查到的景點不會檢查；公休與臨時休館請以官方為準。</p>
      <button class="btn sm" id="aiBtn" type="button">🤖 AI 建議</button><div class="ai-out" id="aiOut" role="status"></div></details>`;
    $('#aiBtn').addEventListener('click', async () => {
      const out = $('#aiOut'), key = localStorage.getItem('tokyo.editkey');
      if (!key) { out.textContent = '要先到「總覽」開啟雲端同步（輸入編輯密碼），才能用 AI。'; return; }
      out.textContent = 'AI 分析中…（約 10–20 秒）';
      try {
        const res = await fetch('/api/advise', { method: 'POST', headers: { 'content-type': 'application/json', 'x-edit-key': key }, body: JSON.stringify({
          title: d_title(i), date: r.date, sunset: r.sunset, findings: r.out.map((x) => x.text),
          stops: T.days[i].stops.map((s) => ({ t: s.t, name: plain(s.name), stay: s.stay, travel: s.travel, note: plain(s.note).slice(0, 160) })),
        }) });
        const j = await res.json();
        out.textContent = res.ok ? j.text : (j.error || 'AI 沒有回應');
      } catch { out.textContent = '連線失敗，稍後再試。'; }
    });
  }
  const d_title = (i) => plain(T.days[i].title);

  /* ---------- 啟動 ---------- */
  tick();
  setInterval(tick, 15000);
  renderTabs();
  renderDay(0);
  renderBigMap();
  renderFood();
  renderGuideSeg();
  renderTransport();
  renderTips();
  renderShopSeg();
  renderTaxPane();
  buildLedgerForm();
  renderLedger();
  buildExpense();
  renderTodo();
  renderMust();
  renderPack();
  renderBookings();
  renderWeather();
  loadFx();
  syncCloud();
  renderCloudBar();
  cloudPull();
  const start = PAGES.findIndex((p) => '#' + p.id === location.hash);
  reveal();
  requestAnimationFrame(() => { goTo(start < 0 ? 0 : start, false); moveInd(); });
})();
