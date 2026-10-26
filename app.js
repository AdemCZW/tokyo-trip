/* 東京七天 —— 全部畫面都由 data.js 的 TRIP 產生，改行程只動資料檔。
   版面是橫向分頁（#pager）：每一頁自己上下捲，頁與頁之間左右滑，
   用 CSS scroll-snap 做，不需要手勢函式庫。 */
(() => {
  const T = window.TRIP;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const TOKYO = [35.6812, 139.7671];
  const NDAYS = T.days.length;
  const DAY_COLORS = ['#ff453a', '#ff9f0a', '#32ade6', '#0a84ff', '#5e5ce6', '#bf5af2', '#a2845e']; // Apple 系統色，七天各一色
  const FOOD_COLOR = '#30b158';
  const GEM_COLOR = '#ff2d92';
  
  /* ---------- 小工具 ---------- */
  // 有 q（店名＋地址）就用文字導航：日本店家的座標只是概略位置，文字查詢比座標準
  const gmap = (lat, lng, mode = 'walking', q = '') =>
    `https://www.google.com/maps/dir/?api=1&destination=${q ? encodeURIComponent(q) : `${lat},${lng}`}&travelmode=${mode}`;
  const gsearch = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  const navBtn = (p, mode, label = '導航') =>
    p.lat ? `<a class="navlink" target="_blank" rel="noopener" href="${gmap(p.lat, p.lng, mode, p.q)}" onclick="event.stopPropagation()">➜ ${label}</a>` : '';
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
    set start(v) { localStorage.setItem('tokyo.start', v); },
  };
  const addDays = (iso, n) => {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return d;
  };
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
      $('#cdS').textContent = `${fmtDay(addDays(s, 0))} – ${fmtDay(addDays(s, NDAYS - 1))}`;
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
        ${route ? `<a class="btn primary sm" target="_blank" rel="noopener" href="${route}">➜ 整天路線導航</a>` : ''}
        ${pills(d.tags)}
      </div>
      <ol class="tl">${d.stops.map((s) => {
        const idx = s.lat ? ++n : 0;
        return `<li><div class="time">${s.t || ''}</div>
          <div class="stop ${s.kind || ''}" style="--c:${c}" data-idx="${idx}">
            <div class="row1"><span class="nm">${idx ? `${idx}. ` : ''}${s.name}</span>${s.it ? `<span class="it">${s.it}</span>` : ''}</div>
            ${s.note ? `<div class="note">${s.note}</div>` : ''}
            ${s.tags || s.lat ? `<div class="meta">${pills(s.tags)}<span class="go">${bookBtn(s.book)}${navBtn(s, s.mode || d.mode || 'walking')}</span></div>` : ''}
          </div></li>`;
      }).join('')}</ol>`;
    $('#daySide').innerHTML = `<h3>${d.side.title}</h3>${list(d.side.items)}`;

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
        <dt>地址</dt><dd>${f.addr}</dd>
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
          return `<div class="wxm"><span class="dd">${fmtDay(new Date(w.daily.time[k] + 'T12:00:00'))}</span><span class="ic">${i2}</span>
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
  const saveChecks = () => localStorage.setItem('tokyo.checks', JSON.stringify(checks));
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
    seg($('#shopSeg'), [{ k: 'tax', label: '🧾 退稅指南' }, { k: 'ledger', label: '📒 購物紀錄' }], shopPane, (k) => {
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

  // ---- 購物紀錄：存在這台裝置的 localStorage，不會上傳 ----
  const LEDGER_KEY = 'tokyo.ledger';
  let ledger = [];
  try { ledger = JSON.parse(localStorage.getItem(LEDGER_KEY) || '[]'); } catch { ledger = []; }
  const saveLedger = () => { try { localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger)); } catch { /* 無痕模式存不了就只留在記憶體 */ } };
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
        <button class="btn primary" id="lfAdd" type="button">＋ 加入紀錄</button>
        <p class="src" id="lfHint"></p>
      </div>
      <div id="ledgerSum"></div>
      <div id="ledgerList"></div>`;
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
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
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
  renderTodo();
  renderMust();
  renderPack();
  renderBookings();
  renderWeather();
  loadFx();
  const start = PAGES.findIndex((p) => '#' + p.id === location.hash);
  reveal();
  requestAnimationFrame(() => { goTo(start < 0 ? 0 : start, false); moveInd(); });
})();
