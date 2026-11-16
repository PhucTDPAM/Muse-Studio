'use strict';
/* Muse Auto — dashboard: lưới cảnh có xem video, sửa prompt, thống kê + biểu đồ, kéo-thả tệp.
 * Dùng chung engine và trạng thái với side panel (../sidepanel/sidepanel.js được nạp trước tệp này).
 */

const ui = {
  filter: 'all',
  search: '',
  view: 'grid',
  videoKeys: new Set(),   // tên video có bản sao trong IndexedDB ("c01.mp4")
  urls: new Map(),        // mediaKey -> blob URL
  cards: new Map(),       // số cảnh -> phần tử thẻ
  detailKey: '',
  detailN: null,
  dirty: false
};

const FILTERS = [
  ['all', 'Tất cả'],
  ['pending', 'Chưa làm'],
  ['running', 'Đang tạo'],
  ['done', 'Xong'],
  ['error', 'Lỗi'],
  ['skipped', 'Bỏ qua']
];

const fmtMin = (ms) => fmtDur(ms);
const fileOf = (sc) => (sc.files?.length ? sc.files[sc.files.length - 1] : '');
const videoKeyOf = (sc) => (fileOf(sc) ? zipEntryName(fileOf(sc)) : '');
const hasVideo = (sc) => !!videoKeyOf(sc) && ui.videoKeys.has(videoKeyOf(sc));

function matchesFilter(sc) {
  if (ui.filter === 'error') { if (sc.status !== 'error' && sc.status !== 'limit') return false; }
  else if (ui.filter !== 'all' && sc.status !== ui.filter) return false;
  return !ui.search || sc.prompt.toLowerCase().includes(ui.search);
}

function mediaKeyOf(sc) {
  if (hasVideo(sc)) return `v:${state.pid}/${videoKeyOf(sc)}|${sc.finishedAt || 0}`;
  if (sc.image) return `i:${state.pid}:${sc.n}|${state.imageKeys.length}`;
  return `p:${sc.status}`;
}

async function blobUrlFor(mediaKey, sc) {
  if (ui.urls.has(mediaKey)) return ui.urls.get(mediaKey);
  const blob = await idb.get(vidKey(videoKeyOf(sc)), 'videos').catch(() => null);
  if (!blob) return null;
  // Bỏ URL cũ của cùng tệp (khi cảnh được làm lại và ghi đè)
  const prefix = mediaKey.split('|')[0] + '|';
  for (const [k, u] of ui.urls) if (k.startsWith(prefix)) { URL.revokeObjectURL(u); ui.urls.delete(k); }
  const url = URL.createObjectURL(blob);
  ui.urls.set(mediaKey, url);
  return url;
}

let refreshingKeys = false;
async function refreshVideoKeys() {
  if (refreshingKeys) return;
  refreshingKeys = true;
  try {
    const prefix = vidPrefix();
    const keys = new Set((await idb.keysPrefix(prefix, 'videos').catch(() => [])).map((k) => k.slice(prefix.length)));
    const changed = keys.size !== ui.videoKeys.size || [...keys].some((k) => !ui.videoKeys.has(k));
    if (changed) {
      ui.videoKeys = keys;
      renderScenes();
      renderDetail(false);
    }
  } finally {
    refreshingKeys = false;
  }
}

// ---------------------------------------------------------------- lưới / bảng cảnh

function renderChips() {
  const box = $('filterChips');
  const c = counts();
  const num = { all: state.scenes.length, pending: c.pending, running: c.running, done: c.done, error: c.error + c.limit, skipped: c.skipped };
  box.replaceChildren(...FILTERS.map(([k, label]) => {
    const b = el('button', 'fchip', `${label} ${num[k]}`);
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(ui.filter === k));
    b.addEventListener('click', () => { ui.filter = k; renderScenes(); });
    return b;
  }));
}

function buildMedia(box, sc, { controls = false } = {}) {
  const mk = mediaKeyOf(sc);
  box.replaceChildren();
  if (mk.startsWith('v:')) {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.playsInline = true;
    if (controls) v.controls = true;
    else { v.muted = true; v.loop = true; }
    blobUrlFor(mk, sc).then((u) => { if (u) v.src = u; });
    box.append(v);
    if (!controls) box.append(el('span', 'play', '▶ rê chuột để xem'));
  } else if (mk.startsWith('i:')) {
    const img = document.createElement('img');
    img.alt = `Ảnh khung đầu c${pad(sc.n)}`;
    setThumb(img, sc.n);
    box.append(img);
  } else {
    let msg = 'Chưa có video';
    if (sc.status === 'done') {
      msg = controls
        ? 'Video đã tải về máy nhưng không có bản sao trong trình duyệt (tải trước khi có tính năng ZIP, hoặc tải bằng nút của trang). Bấm "Mở trong thư mục tải về" để xem.'
        : 'Đã tải về máy · không có bản xem trước';
    }
    else if (sc.status === 'running') msg = 'Đang tạo…';
    box.append(el('span', 'ph', msg));
  }
  if (!controls) box.append(el('span', 'badge', `c${pad(sc.n)}`));
  box.dataset.media = mk;
}

function createCard(n) {
  const c = el('div', 'scard');
  c.dataset.n = n;
  c.tabIndex = 0;
  const media = el('div', 'media');
  const body = el('div', 'body');
  const ptext = el('div', 'ptext');
  const foot = el('div', 'foot');
  foot.append(el('span', 'chip'), el('span', 'reason'));
  body.append(ptext, foot);
  c.append(media, body);
  c.addEventListener('mouseenter', () => { const v = media.querySelector('video'); if (v && v.src) v.play().catch(() => {}); });
  c.addEventListener('mouseleave', () => { const v = media.querySelector('video'); if (v) { v.pause(); v.currentTime = 0; } });
  return c;
}

function updateCard(c, sc) {
  c.classList.toggle('selected', sc.n === ctl.selected);
  c.classList.toggle('running', sc.status === 'running');
  const media = c.querySelector('.media');
  if (media.dataset.media !== mediaKeyOf(sc) || media.dataset.n !== String(sc.n)) {
    buildMedia(media, sc);
    media.dataset.n = String(sc.n);
  }
  const p = c.querySelector('.ptext');
  p.textContent = sc.prompt;
  p.title = sc.prompt;
  const chip = c.querySelector('.chip');
  chip.className = `chip st-${sc.status}`;
  chip.textContent = sc.status === 'done' && sc.frameCheck?.ok === null ? 'Đã lưu · chờ kiểm tra' : STATUS[sc.status];
  paintCardProgress(c, sc);
  const r = c.querySelector('.reason');
  r.textContent = sc.status === 'done' ? `${sc.genMs ? fmtMin(sc.genMs) : ''}${fileOf(sc) ? ` · ${zipEntryName(fileOf(sc))}` : ''}` : sc.reason || '';
  r.title = sc.reason || fileOf(sc) || '';
}

// Thanh % trên thẻ của cảnh đang tạo
function paintCardProgress(c, sc) {
  const p = ctl.progress;
  const live = sc.status === 'running' && p && p.n === sc.n ? p : null;
  const media = c.querySelector('.media');
  let bar = media.querySelector('.cprog');
  if (!live) { bar?.remove(); return; }
  if (!bar) {
    bar = el('div', 'cprog');
    bar.append(el('div', 'fill'), el('span', 'lbl'));
    media.append(bar);
  }
  bar.querySelector('.fill').style.width = `${live.pct}%`;
  bar.querySelector('.lbl').textContent = `${live.pct}%${live.est ? ' (ước tính)' : ''}`;
  bar.title = live.est ? 'Ước tính theo thời gian tạo trung bình — trang không hiển thị %' : 'Phần trăm do trang muse.ai hiển thị';
  const chip = c.querySelector('.chip');
  if (chip) chip.textContent = `${STATUS.running} ${live.pct}%`;
}

globalThis.museRenderSceneProgress = function (p) {
  for (const [n, c] of ui.cards) {
    const sc = sceneBy(n);
    if (sc) paintCardProgress(c, sc);
  }
  document.querySelectorAll('.stable tr.trow').forEach((tr) => {
    const sc = sceneBy(+tr.dataset.n);
    const chip = tr.querySelector('.chip');
    if (sc && chip) chip.textContent = STATUS[sc.status] + (sc.status === 'running' && p && p.n === sc.n ? ` ${p.pct}%` : '');
  });
  const sel = selScene();
  if (sel && sel.status === 'running') $('dStatus').textContent = STATUS.running + (p && p.n === sel.n ? ` ${p.pct}%${p.est ? ' (ước tính)' : ''}` : '');
};

function renderTable(box, list) {
  ui.cards.clear();
  const t = el('table', 'stable');
  const head = el('tr');
  ['Cảnh', 'Trạng thái', 'Thời gian tạo', 'Tệp', 'Prompt / lý do'].forEach((h) => head.append(el('th', null, h)));
  const thead = el('thead');
  thead.append(head);
  const tb = el('tbody');
  for (const sc of list) {
    const tr = el('tr', `trow${sc.n === ctl.selected ? ' selected' : ''}`);
    tr.dataset.n = sc.n;
    const chip = el('span', `chip st-${sc.status}`, STATUS[sc.status]);
    const stTd = el('td');
    stTd.append(chip);
    const pTd = el('td', 'ptd', sc.prompt);
    if (sc.reason) {
      pTd.append(document.createElement('br'), el('small', 'muted', sc.reason));
    }
    tr.append(
      el('td', 'num', `c${pad(sc.n)}`),
      stTd,
      el('td', 'num', sc.genMs && sc.status === 'done' ? fmtMin(sc.genMs) : '—'),
      el('td', 'num', fileOf(sc) ? zipEntryName(fileOf(sc)) : '—'),
      pTd
    );
    tb.append(tr);
  }
  t.append(thead, tb);
  box.replaceChildren(t);
}

globalThis.museRenderScenes = function renderScenesApp() {
  const box = $('scenes');
  renderChips();
  box.classList.toggle('table-mode', ui.view === 'table');
  if (!state.scenes.length) {
    ui.cards.clear();
    box.replaceChildren(el('div', 'empty', 'Chưa có cảnh nào. Kéo-thả prompts.txt vào trang hoặc bấm "prompts.txt…".'));
    return;
  }
  const list = state.scenes.filter(matchesFilter);
  if (!list.length) {
    ui.cards.clear();
    box.replaceChildren(el('div', 'empty', 'Không có cảnh nào khớp bộ lọc.'));
    return;
  }
  if (ui.view === 'table') return renderTable(box, list);

  const alive = new Set(state.scenes.map((s) => s.n));
  for (const n of [...ui.cards.keys()]) if (!alive.has(n)) ui.cards.delete(n);
  const nodes = list.map((sc) => {
    let c = ui.cards.get(sc.n);
    if (!c) { c = createCard(sc.n); ui.cards.set(sc.n, c); }
    updateCard(c, sc);
    return c;
  });
  const cur = [...box.children];
  if (cur.length !== nodes.length || cur.some((x, i) => x !== nodes[i])) box.replaceChildren(...nodes);
};

function selectScene(n) {
  ctl.selected = n;
  renderScenes();
  renderControls();
  renderDetail(true);
}

// ---------------------------------------------------------------- khung chi tiết

function renderDetail(force) {
  const sc = selScene();
  $('detail').hidden = !sc;
  if ($('detailEmpty')) $('detailEmpty').hidden = !!sc;
  if (!sc) { ui.detailN = null; return; }
  const switched = ui.detailN !== sc.n;
  ui.detailN = sc.n;
  $('dTitle').textContent = `Cảnh c${pad(sc.n)}`;
  $('dStatus').className = `chip st-${sc.status}`;
  $('dStatus').textContent = STATUS[sc.status];

  const mk = `${sc.n}|${mediaKeyOf(sc)}|${sc.status}`;
  if (force || switched || ui.detailKey !== mk) {
    buildMedia($('dMedia'), sc, { controls: true });
    ui.detailKey = mk;
  }

  const meta = [];
  if (sc.reason) meta.push(`Lý do: ${sc.reason}`);
  if (sc.status === 'done' && sc.genMs) meta.push(`Thời gian tạo: ${fmtMin(sc.genMs)}`);
  if (sc.finishedAt && sc.status !== 'pending') meta.push(`Kết thúc lúc: ${new Date(sc.finishedAt).toLocaleString('vi-VN')}`);
  if (sc.files?.length) meta.push(`Tệp: ${sc.files.join(', ')}`);
  if (sc.image) meta.push('Có ảnh khung đầu');
  if (sc.frameCheck) meta.push(`Kiểm tra khung hình: ${sc.frameCheck.code}${sc.frameCheck.note ? ' — '+sc.frameCheck.note : ''}`);
  if (sc.rejectedFile) meta.push(`Bản bị phát hiện lỗi: ${sc.rejectedFile} (trong ZIP)`);
  $('dMeta').textContent = meta.join('\n');

  const ta = $('dPrompt');
  if (force || switched || (!ui.dirty && document.activeElement !== ta)) {
    ta.value = sc.prompt;
    ui.dirty = false;
  }
  const running = sc.status === 'running';
  ta.disabled = running;
  $('dCount').textContent = running ? 'Đang tạo — không sửa được prompt lúc này.' : `${ta.value.trim().length} ký tự${ui.dirty ? ' · chưa lưu' : ''}`;
  $('dSave').disabled = running || !ui.dirty;
  $('dSaveRetry').disabled = running;
  $('dSaveRetry').textContent = ui.dirty ? 'Lưu & làm lại cảnh này' : 'Làm lại cảnh này';
  $('dSkip').disabled = sc.status === 'done' || sc.status === 'skipped';
  $('dShow').hidden = !sc.downloadId;
  // Gợi ý của Claude
  const cl = sc.claude && sc.claude.forPrompt === sc.prompt ? sc.claude : null;
  $('dClaude').hidden = !cl;
  if (cl) {
    $('dClaudeModel').textContent = cl.model ? `(${cl.model})` : '';
    $('dClaudeChanges').textContent = cl.feasible ? cl.changes : `Không sửa được mà vẫn giữ nội dung: ${cl.changes}`;
    $('dClaudePrompt').textContent = cl.prompt;
    $('dUseClaude').disabled = running || !cl.feasible;
  }
  $('dOriginal').hidden = sc.originalPrompt == null;
  if (sc.originalPrompt != null) $('dOriginal').textContent = `Prompt gốc: ${sc.originalPrompt}`;
  $('dRestore').hidden = sc.originalPrompt == null;
  $('dRestore').disabled = running;
  $('dAskClaude').disabled = running || ui.claudeBusy;
  $('dAskClaude').textContent = ui.claudeBusy ? 'Claude đang sửa…' : 'Nhờ Claude sửa prompt này';
}

function saveDetailPrompt() {
  const sc = selScene();
  if (!sc || !ui.dirty) return;
  const text = $('dPrompt').value;
  if (!text.trim()) { showBanner('warn', 'Prompt không được để trống.'); return; }
  act('editPrompt', { n: sc.n, text });
  ui.dirty = false;
}

// ---------------------------------------------------------------- thống kê

function activeNow() {
  return (state.activeMs || 0) + (state.runningSince ? Math.max(0, Date.now() - state.runningSince) : 0);
}

function renderKpis() {
  const c = counts();
  const total = state.scenes.length;
  const gens = state.scenes.filter((s) => s.status === 'done' && s.genMs > 0).map((s) => s.genMs);
  const avg = gens.length ? gens.reduce((a, b) => a + b, 0) / gens.length : 0;
  const attempted = c.done + c.error;
  const tiles = [
    { label: 'Xong', value: c.done, sub: `trên ${total} cảnh`, sw: 'var(--good)' },
    { label: 'Lỗi', value: c.error + c.limit, sub: c.limit ? `${c.limit} do giới hạn` : '', sw: 'var(--critical)' },
    { label: 'Bỏ qua', value: c.skipped, sub: '' },
    { label: 'Còn lại', value: c.pending + c.running, sub: etaText() },
    { label: 'TB thời gian tạo', value: gens.length ? fmtMin(avg) : '—', sub: gens.length ? `từ ${gens.length} video` : 'chưa có dữ liệu' },
    { label: 'Tỉ lệ lỗi', value: attempted ? `${Math.round((c.error / attempted) * 100)}%` : '—', sub: attempted ? `${c.error}/${attempted} cảnh đã chạy` : '' },
    { label: 'Thời gian chạy', value: fmtDur(activeNow()), sub: `${state.genCount || 0} lượt đã gửi`, id: 'kpiTime' }
  ];
  $('kpis').replaceChildren(...tiles.map((t) => {
    const d = el('div', 'kpi');
    const lab = el('div', 'label');
    if (t.sw) { const s = el('span', 'sw'); s.style.background = t.sw; lab.append(s); }
    lab.append(document.createTextNode(t.label));
    const v = el('div', 'value', String(t.value));
    if (t.id) v.id = t.id;
    d.append(lab, v, el('div', 'sub', t.sub || ' '));
    return d;
  }));
}

// ---------------------------------------------------------------- biểu đồ (SVG tự vẽ, có tooltip)

const SVGNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, text) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

function niceScale(max, count = 4) {
  if (!(max > 0)) max = 1;
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => st >= raw) || 10 * mag;
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(+v.toFixed(6));
  return { top, ticks };
}

function showTip(text, x, y) {
  const t = $('tip');
  t.textContent = text;
  t.hidden = false;
  const r = t.getBoundingClientRect();
  let left = x + 12, top = y - r.height - 10;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - 12;
  if (top < 8) top = y + 14;
  t.style.left = `${left}px`;
  t.style.top = `${top}px`;
}
const hideTip = () => { $('tip').hidden = true; };

function emptyChart(host, msg) {
  host.replaceChildren(el('div', 'chart-empty', msg));
}

function barPath(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function renderGenChart() {
  const host = $('chartGen');
  const data = state.scenes.filter((x) => x.status === 'done' && x.genMs > 0).map((x) => ({ n: x.n, v: x.genMs / 60000, ms: x.genMs }));
  if (!data.length) return emptyChart(host, 'Chưa có cảnh nào xong — biểu đồ sẽ hiện khi có video đầu tiên.');
  const W = host.clientWidth || 480, H = host.clientHeight || 200;
  const m = { l: 30, r: 8, t: 14, b: 22 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const N = Math.max(state.scenes.length, 1);
  const { top, ticks } = niceScale(Math.max(...data.map((d) => d.v)));
  const y = (v) => m.t + ih - (v / top) * ih;
  const slot = iw / N;
  const bw = Math.max(1.5, Math.min(26, slot - 2));
  const xOf = (n) => m.l + (n - 1) * slot + (slot - bw) / 2;

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Thời gian tạo của ${data.length} cảnh đã xong` });
  const ax = s('g', { class: 'ax' });
  for (const t of ticks) {
    ax.append(s('line', { class: t === 0 ? 'base' : 'grid', x1: m.l, x2: W - m.r, y1: y(t), y2: y(t) }));
    ax.append(s('text', { x: m.l - 6, y: y(t) + 4, 'text-anchor': 'end' }, String(t)));
  }
  const every = Math.max(1, Math.ceil(N / 10));
  for (let n = 1; n <= N; n++) {
    if ((n - 1) % every === 0) {
      ax.append(s('text', { x: m.l + (n - 0.5) * slot, y: H - 6, 'text-anchor': 'middle' }, `c${pad(n)}`));
    }
  }
  svg.append(ax);

  const bars = s('g');
  const barEls = new Map();
  for (const d of data) {
    const b = s('path', { class: 'bar', d: barPath(xOf(d.n), y(d.v), bw, Math.max(1, y(0) - y(d.v)), 4) });
    barEls.set(d.n, b);
    bars.append(b);
  }
  svg.append(bars);

  const avg = data.reduce((a, d) => a + d.v, 0) / data.length;
  svg.append(s('line', { class: 'avg', x1: m.l, x2: W - m.r, y1: y(avg), y2: y(avg) }));
  svg.append(s('text', { class: 'avg-label', x: W - m.r, y: y(avg) - 4, 'text-anchor': 'end' }, `TB ${fmtMin(avg * 60000)}`));

  // Vùng bắt chuột rộng hơn cột
  const hits = s('g');
  for (const d of data) {
    const r = s('rect', { class: 'hit', x: m.l + (d.n - 1) * slot, y: m.t, width: Math.max(slot, 4), height: ih });
    r.addEventListener('mousemove', (e) => {
      barEls.forEach((b, n) => b.classList.toggle('dim', n !== d.n));
      showTip(`c${pad(d.n)} · ${fmtMin(d.ms)}`, e.clientX, e.clientY);
    });
    r.addEventListener('mouseleave', () => { barEls.forEach((b) => b.classList.remove('dim')); hideTip(); });
    r.addEventListener('click', () => selectScene(d.n));
    hits.append(r);
  }
  svg.append(hits);
  host.replaceChildren(svg);
}

function renderProgChart() {
  const host = $('chartProg');
  const done = state.scenes.filter((x) => x.status === 'done' && x.finishedAt).sort((a, b) => a.finishedAt - b.finishedAt);
  if (!done.length) return emptyChart(host, 'Chưa có cảnh nào xong.');
  const total = Math.max(state.scenes.length, done.length);
  const starts = state.scenes.map((x) => x.startedAt).filter(Boolean);
  const t0 = Math.min(done[0].finishedAt, ...(starts.length ? [Math.min(...starts)] : []));
  let t1 = Math.max(done[done.length - 1].finishedAt, isBusy() ? Date.now() : 0);
  if (t1 - t0 < 60000) t1 = t0 + 60000;

  const W = host.clientWidth || 480, H = host.clientHeight || 200;
  const m = { l: 30, r: 46, t: 14, b: 22 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const { top, ticks } = niceScale(total);
  const x = (t) => m.l + ((t - t0) / (t1 - t0)) * iw;
  const y = (v) => m.t + ih - (v / top) * ih;

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${done.length} trên ${total} cảnh đã xong` });
  const ax = s('g', { class: 'ax' });
  for (const t of ticks) {
    ax.append(s('line', { class: t === 0 ? 'base' : 'grid', x1: m.l, x2: W - m.r, y1: y(t), y2: y(t) }));
    ax.append(s('text', { x: m.l - 6, y: y(t) + 4, 'text-anchor': 'end' }, String(t)));
  }
  const fmtT = (t) => new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  for (let i = 0; i <= 4; i++) {
    const t = t0 + ((t1 - t0) * i) / 4;
    ax.append(s('text', { x: x(t), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle' }, fmtT(t)));
  }
  svg.append(ax);

  // Đường bậc thang: số cảnh xong cộng dồn
  let d = `M${x(t0)},${y(0)}`;
  done.forEach((sc, i) => { d += `H${x(sc.finishedAt)}V${y(i + 1)}`; });
  d += `H${x(t1)}`;
  svg.append(s('path', { class: 'line', d }));

  const last = done[done.length - 1];
  svg.append(s('circle', { class: 'marker', cx: x(last.finishedAt), cy: y(done.length), r: 4 }));
  svg.append(s('text', { class: 'avg-label', x: x(t1) + 6, y: y(done.length) + 4 }, `${done.length}/${total}`));

  const cross = s('line', { class: 'cross', y1: m.t, y2: m.t + ih, visibility: 'hidden' });
  const dot = s('circle', { class: 'marker', r: 4, visibility: 'hidden' });
  svg.append(cross, dot);
  const hit = s('rect', { class: 'hit', x: m.l, y: m.t, width: iw, height: ih });
  hit.addEventListener('mousemove', (e) => {
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    done.forEach((sc, i) => { if (Math.abs(x(sc.finishedAt) - px) < Math.abs(x(done[best].finishedAt) - px)) best = i; });
    const sc = done[best];
    cross.setAttribute('x1', x(sc.finishedAt));
    cross.setAttribute('x2', x(sc.finishedAt));
    dot.setAttribute('cx', x(sc.finishedAt));
    dot.setAttribute('cy', y(best + 1));
    cross.setAttribute('visibility', 'visible');
    dot.setAttribute('visibility', 'visible');
    showTip(`${fmtT(sc.finishedAt)} · ${best + 1}/${total} cảnh xong (c${pad(sc.n)})`, e.clientX, e.clientY);
  });
  hit.addEventListener('mouseleave', () => {
    cross.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    hideTip();
  });
  svg.append(hit);
  host.replaceChildren(svg);
}

function renderCharts() {
  if (!$('tip').hidden) return;   // đang rê chuột trên biểu đồ — không vẽ lại
  renderGenChart();
  renderProgChart();
}

globalThis.museAfterRender = function afterRenderApp() {
  renderKpis();
  renderCharts();
  renderDetail(false);
  refreshVideoKeys();
};

// ---------------------------------------------------------------- kéo-thả tệp

let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

async function collectFiles(dt) {
  // Lấy entry đồng bộ (trước mọi await), nếu không Chrome sẽ xóa dữ liệu kéo-thả
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dt.files];
  const out = [];
  async function walk(entry, depth) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      Object.defineProperty(file, 'relativePath', {value:entry.fullPath.replace(/^\//, ''),configurable:true});
      out.push(file);
    } else if (entry.isDirectory && depth < 3) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const en of batch) await walk(en, depth + 1);
      }
    }
  }
  for (const en of entries) await walk(en, 0);
  return out;
}

async function handleDropped(files) {
  if (files.some(f=>f.name==='muse_package.json') && globalThis.museImportPackage) { await globalThis.museImportPackage(files);return; }
  const txts = files.filter((f) => /\.txt$/i.test(f.name));
  const txt = txts.find((f) => /prompt/i.test(f.name)) || txts[0];
  const imgs = files.filter((f) => MuseReferenceModel.parseName(f.name) || /^c0*\d+\.(png|jpe?g|webp)$/i.test(f.name));
  if (!txt && !imgs.length) {
    showBanner('warn', 'Không thấy prompts.txt hoặc ảnh c01.png / c01_character_Mia.png / c01_storyboard.png.');
    return;
  }
  if (txt) await onPromptsFile(txt);
  if (imgs.length) await onImagesFolder(imgs);
}

window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  $('dropOverlay').hidden = false;
});
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = isBusy() ? 'none' : 'copy';
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) { dragDepth = 0; $('dropOverlay').hidden = true; }
});
window.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('dropOverlay').hidden = true;
  if (isBusy()) {
    showBanner('warn', 'Hàng đợi đang chạy — hãy Tạm dừng trước khi nạp tệp mới.');
    return;
  }
  const files = await collectFiles(e.dataTransfer);
  handleDropped(files);
});

// ---------------------------------------------------------------- khác

async function exportPrompts() {
  if (!state.scenes.length) { showBanner('info', 'Chưa có prompt nào.'); return; }
  const text = state.scenes.map((x) => x.prompt).join('\r\n') + '\r\n';
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  try {
    await downloadNamed(url, `${folder()}/prompts_da_sua.txt`);
    log(`Đã xuất ${state.scenes.length} prompt → ${folder()}/prompts_da_sua.txt`);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

function bindApp() {
  $('search').addEventListener('input', () => { ui.search = $('search').value.trim().toLowerCase(); renderScenes(); });
  document.querySelectorAll('input[name="view"]').forEach((r) => r.addEventListener('change', () => { ui.view = r.value; renderScenes(); }));

  $('scenes').addEventListener('click', (e) => {
    const t = e.target.closest('.scard, .trow');
    if (t) selectScene(+t.dataset.n);
  });
  $('scenes').addEventListener('keydown', (e) => {
    const t = e.target.closest('.scard');
    if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectScene(+t.dataset.n); }
  });

  $('dClose').addEventListener('click', () => selectScene(null));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('detail').hidden && $('modal').hidden) selectScene(null);
  });
  $('dPrompt').addEventListener('input', () => {
    const sc = selScene();
    ui.dirty = !!sc && $('dPrompt').value.trim() !== sc.prompt;
    renderDetail(false);
  });
  $('dSave').addEventListener('click', saveDetailPrompt);
  $('dSaveRetry').addEventListener('click', () => { saveDetailPrompt(); retrySelected(); });
  $('dSkip').addEventListener('click', skipSelected);
  $('dUseClaude').addEventListener('click', () => { const sc = selScene(); if (sc) act('useClaude', { n: sc.n }); });
  $('dClaudeToEditor').addEventListener('click', () => {
    const sc = selScene();
    if (!sc?.claude) return;
    $('dPrompt').value = sc.claude.prompt;
    ui.dirty = $('dPrompt').value.trim() !== sc.prompt;
    renderDetail(false);
  });
  $('dRestore').addEventListener('click', () => { const sc = selScene(); if (sc) act('restorePrompt', { n: sc.n }); });
  $('dAskClaude').addEventListener('click', async () => {
    const sc = selScene();
    if (!sc || ui.claudeBusy) return;
    if (!(await getClaudeKey())) { showBanner('warn', 'Chưa nhập Claude API key — mở Cài đặt → Claude.'); return; }
    ui.claudeBusy = true;
    renderDetail(false);
    const text = ui.dirty ? $('dPrompt').value.trim() : sc.prompt;
    const err = sc.status === 'error' ? sc.reason : '(chưa bị từ chối — người dùng muốn chỉnh để tránh bị từ chối)';
    const i = state.scenes.indexOf(sc);
    const r = await claudeFixPrompt({ prompt: text, error: err, style: state.settings.claudeStyle, prev: state.scenes[i - 1]?.prompt, next: state.scenes[i + 1]?.prompt });
    ui.claudeBusy = false;
    if (!r.ok) { showBanner('warn', `Claude: ${r.note}`); renderDetail(false); return; }
    if (ui.dirty) { ui.dirty = false; act('editPrompt', { n: sc.n, text }); }
    act('setClaude', { n: sc.n, claude: { prompt: r.prompt, changes: r.changes, feasible: r.feasible, forPrompt: text, museError: err, model: r.model, at: Date.now() } });
    log(`c${pad(sc.n)}: Claude gợi ý prompt mới — ${r.changes}`);
  });
  $('dShow').addEventListener('click', async () => {
    const sc = selScene();
    if (!sc?.downloadId) return;
    const [item] = await chrome.downloads.search({ id: sc.downloadId }).catch(() => []);
    if (!item || item.exists === false) { showBanner('warn', 'Không tìm thấy tệp này nữa (có thể đã bị xóa hoặc di chuyển).'); return; }
    chrome.downloads.show(sc.downloadId);
  });
  $('exportPromptsBtn').addEventListener('click', exportPrompts);

  new ResizeObserver(() => { hideTip(); renderCharts(); }).observe($('chartGen'));

  // Cập nhật đồng hồ "Thời gian chạy" và đường tiến độ khi đang chạy
  setInterval(() => {
    if (!isBusy()) return;
    const k = $('kpiTime');
    if (k) k.textContent = fmtDur(activeNow());
  }, 1000);
  setInterval(() => { if (isBusy()) renderCharts(); }, 30000);
}

bindApp();
