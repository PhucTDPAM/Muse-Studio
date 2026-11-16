/* Muse Auto — dựng video: sắp xếp clip, xem thử, ghép thành một video dài bằng ffmpeg.wasm.
 * Mọi xử lý chạy ngay trong trình duyệt (ffmpeg nằm trong thư mục vendor/), không gửi dữ liệu đi đâu.
 */
import { FFmpeg } from '../vendor/ffmpeg/esm/index.js';

const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function fmt(sec) {
  if (!(sec > 0)) return '0:00';
  const t = Math.round(sec);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function showBanner(kind, text) {
  $('banner').className = `banner ${kind}`;
  $('bannerText').textContent = text;
  $('banner').hidden = false;
}
const hideBanner = () => { $('banner').hidden = true; };

// ---------------------------------------------------------------- dữ liệu

let museState = { scenes: [], episode: '' };
let clips = [];   // { id, name, blob, url, dur, w, h, on, n, prompt, source: 'scene' | 'file' }
let clipSeq = 0;

function folder() {
  const f = (museState.episode || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').trim();
  return f || 'Muse';
}
const safeName = (s) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\.mp4$/i, '').trim();

function openDb() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open('muse-auto', 2);
    rq.onupgradeneeded = () => {
      for (const n of ['images', 'videos']) if (!rq.result.objectStoreNames.contains(n)) rq.result.createObjectStore(n);
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
async function idb(fn) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const t = db.transaction('videos', 'readonly');
    const rq = fn(t.objectStore('videos'));
    t.oncomplete = () => res(rq.result);
    t.onerror = () => rej(t.error);
  });
}

function probeMeta(url) {
  return new Promise((res) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const done = (r) => { v.removeAttribute('src'); v.load(); res(r); };
    v.onloadedmetadata = () => done({ dur: v.duration, w: v.videoWidth, h: v.videoHeight });
    v.onerror = () => done({ dur: 0, w: 0, h: 0, err: true });
    v.src = url;
  });
}

async function makeClip(blob, name, extra) {
  const url = URL.createObjectURL(blob);
  const meta = await probeMeta(url);
  return { id: ++clipSeq, name, blob, url, on: true, source: 'scene', ...meta, ...extra };
}

function releaseAll() {
  clips.forEach((c) => URL.revokeObjectURL(c.url));
  clips = [];
}

async function loadFromScenes(useSaved) {
  const st = await chrome.storage.local.get(['museState', 'museEditor']);
  museState = st.museState || { scenes: [], episode: '' };
  $('epName').textContent = museState.episode ? `Dự án: ${museState.episode}` : 'Chưa đặt tên dự án';
  if (!$('outName').value) $('outName').value = `${folder()}_full`;

  // Video được lưu theo dự án: khóa "<id dự án>/c01.mp4"
  const prefix = museState.pid ? `${museState.pid}/` : '';
  const allKeys = (await idb((s) => s.getAllKeys()).catch(() => [])).map(String);
  const keys = allKeys.filter((k) => (prefix ? k.startsWith(prefix) : !k.includes('/'))).map((k) => k.slice(prefix.length));
  // Bản hiện hành của mỗi cảnh = tệp cuối cùng trong scene.files
  const current = new Map();
  for (const sc of museState.scenes || []) {
    const f = sc.files?.length ? sc.files[sc.files.length - 1] : '';
    if (f) current.set(f.slice(f.indexOf('/') + 1), sc);
  }
  const parsed = keys
    .map((k) => ({ k, m: /^c0*(\d+)(?:_v(\d+))?\.mp4$/i.exec(k) }))
    .sort((a, b) => (a.m ? +a.m[1] : 1e9) - (b.m ? +b.m[1] : 1e9) || (a.m?.[2] || 1) - (b.m?.[2] || 1) || a.k.localeCompare(b.k));

  releaseAll();
  for (const { k, m } of parsed) {
    const blob = await idb((s) => s.get(prefix + k)).catch(() => null);
    if (!blob) continue;
    const n = m ? +m[1] : null;
    const sc = (museState.scenes || []).find((x) => x.n === n);
    const isCurrent = current.has(k);
    // Mặc định: chọn bản hiện hành của mỗi cảnh; các bản cũ (_v1 khi đã có _v2…) để bỏ chọn
    const sceneHasCurrent = n != null && [...current.values()].some((x) => x.n === n);
    clips.push(await makeClip(blob, k, { n, prompt: sc?.prompt || '', on: isCurrent || !sceneHasCurrent }));
  }

  const saved = st.museEditor;
  if (useSaved && saved && (saved.pid ? saved.pid === museState.pid : saved.episode === museState.episode) && Array.isArray(saved.order)) {
    const pos = new Map(saved.order.map((o, i) => [o.name, i]));
    const onMap = new Map(saved.order.map((o) => [o.name, o.on]));
    clips.sort((a, b) => (pos.has(a.name) ? pos.get(a.name) : 1e6 + a.id) - (pos.has(b.name) ? pos.get(b.name) : 1e6 + b.id));
    clips.forEach((c) => { if (onMap.has(c.name)) c.on = onMap.get(c.name); });
  }

  const missing = (museState.scenes || []).filter((s) => s.status === 'done' && !s.inZip).map((s) => `c${String(s.n).padStart(2, '0')}`);
  if (missing.length) {
    showBanner('info', `Không có bản sao trong trình duyệt cho: ${missing.join(', ')} (tải trước khi có tính năng ZIP, hoặc tải bằng nút của trang). Bấm "+ Thêm video từ máy…" để thêm các tệp này từ thư mục "${folder()}", rồi kéo vào đúng vị trí.`);
  } else if (!clips.length) {
    showBanner('info', 'Chưa có video nào. Hãy tạo video trước, hoặc bấm "+ Thêm video từ máy…".');
  } else hideBanner();
  renderClips();
}

function saveOrder() {
  const order = clips.filter((c) => c.source === 'scene').map((c) => ({ name: c.name, on: c.on }));
  chrome.storage.local.set({ museEditor: { pid: museState.pid, episode: museState.episode, order } }).catch(() => {});
}

async function addFiles(files) {
  const vids = [...files].filter((f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(f.name));
  if (!vids.length) { showBanner('warn', 'Không có tệp video nào trong những gì bạn chọn.'); return; }
  vids.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const f of vids) clips.push(await makeClip(f, f.name, { source: 'file', n: null, prompt: '(tệp từ máy)' }));
  renderClips();
}

// ---------------------------------------------------------------- danh sách clip (kéo-thả sắp xếp)

let dragId = null;

function move(from, to) {
  if (from === to || from < 0 || to < 0 || to >= clips.length) return;
  const [c] = clips.splice(from, 1);
  clips.splice(to, 0, c);
  saveOrder();
  renderClips();
}

function renderClips() {
  const box = $('clips');
  box.replaceChildren();
  let k = 0;
  clips.forEach((c, i) => {
    const li = el('li', `clip${c.on ? '' : ' off'}${i === play.idx ? ' playing' : ''}`);
    li.dataset.id = c.id;
    const handle = el('span', 'handle', '⠿');
    handle.title = 'Kéo để đổi thứ tự';
    handle.addEventListener('mousedown', () => { li.draggable = true; });
    handle.addEventListener('mouseup', () => { li.draggable = false; });
    li.addEventListener('dragstart', (e) => { dragId = c.id; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-muse-clip', String(c.id)); });
    li.addEventListener('dragend', () => { li.draggable = false; dragId = null; renderClips(); });
    li.addEventListener('dragover', (e) => {
      if (dragId == null) return;
      e.preventDefault();
      const r = li.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      li.classList.toggle('drop-after', after);
      li.classList.toggle('drop-before', !after);
    });
    li.addEventListener('dragleave', () => li.classList.remove('drop-before', 'drop-after'));
    li.addEventListener('drop', (e) => {
      if (dragId == null) return;
      e.preventDefault();
      e.stopPropagation();
      const from = clips.findIndex((x) => x.id === dragId);
      let to = clips.findIndex((x) => x.id === c.id);
      if (li.classList.contains('drop-after')) to++;
      if (from < to) to--;
      move(from, to);
    });

    const idx = el('span', 'idx', c.on ? String(++k) : '–');
    const thumb = el('div', 'thumb');
    const tv = document.createElement('video');
    tv.muted = true;
    tv.preload = 'metadata';
    tv.src = `${c.url}#t=0.5`;
    thumb.append(tv);
    thumb.title = 'Xem clip này';
    thumb.addEventListener('click', () => playAt(i, false));

    const info = el('div', 'info');
    info.append(
      el('span', 'name', c.name),
      el('span', 'meta', c.err ? 'Không đọc được video' : `${fmt(c.dur)} · ${c.w}×${c.h} · ${mb(c.blob.size)}`),
      el('span', 'prompt', c.prompt || '')
    );
    info.lastChild.title = c.prompt || '';

    const acts = el('div', 'acts');
    const chkL = el('label');
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = c.on;
    chk.addEventListener('change', () => { c.on = chk.checked; saveOrder(); renderClips(); });
    chkL.append(chk, document.createTextNode('Dùng'));
    const up = el('button', null, '↑');
    up.title = 'Lên';
    up.disabled = i === 0;
    up.addEventListener('click', () => move(i, i - 1));
    const down = el('button', null, '↓');
    down.title = 'Xuống';
    down.disabled = i === clips.length - 1;
    down.addEventListener('click', () => move(i, i + 1));
    const rm = el('button', null, '✕');
    rm.title = c.source === 'file' ? 'Bỏ khỏi danh sách' : 'Bỏ khỏi danh sách (bấm "Nạp lại" để lấy lại)';
    rm.addEventListener('click', () => {
      URL.revokeObjectURL(c.url);
      clips.splice(i, 1);
      saveOrder();
      renderClips();
    });
    acts.append(chkL, up, down, rm);
    li.append(handle, idx, thumb, info, acts);
    box.append(li);
  });
  if (!clips.length) box.append(el('li', 'empty', 'Chưa có clip nào.'));
  const on = clips.filter((c) => c.on);
  $('totalInfo').textContent = `${on.length}/${clips.length} clip được chọn · tổng ${fmt(on.reduce((a, c) => a + (c.dur || 0), 0))}`;
}

// ---------------------------------------------------------------- xem thử

const play = { idx: -1, seq: false };

function playAt(i, seq) {
  const c = clips[i];
  if (!c) return;
  play.idx = i;
  play.seq = seq;
  const p = $('player');
  p.src = c.url;
  p.play().catch(() => {});
  const on = clips.filter((x) => x.on);
  const pos = on.indexOf(c);
  $('nowPlaying').textContent = `${c.name}${seq && pos >= 0 ? ` (${pos + 1}/${on.length})` : ''}`;
  renderClips();
}

function nextOn(from, dir) {
  for (let i = from + dir; i >= 0 && i < clips.length; i += dir) if (clips[i].on) return i;
  return -1;
}

$('player').addEventListener('ended', () => {
  if (!play.seq) return;
  const n = nextOn(play.idx, 1);
  if (n >= 0) playAt(n, true);
  else { play.seq = false; $('nowPlaying').textContent = 'Hết chuỗi'; }
});
$('playSeq').addEventListener('click', () => { const i = nextOn(-1, 1); if (i >= 0) playAt(i, true); });
$('prevClip').addEventListener('click', () => { const i = nextOn(play.idx < 0 ? clips.length : play.idx, -1); if (i >= 0) playAt(i, play.seq); });
$('nextClip').addEventListener('click', () => { const i = nextOn(play.idx, 1); if (i >= 0) playAt(i, play.seq); });

// ---------------------------------------------------------------- render bằng ffmpeg.wasm

let ff = null;
let rendering = false;
let cancelled = false;
let logSink = null;
const logLines = [];

function appendLog(line) {
  logLines.push(line);
  if (logLines.length > 600) logLines.splice(0, logLines.length - 600);
}
function flushLog() { $('rlog').textContent = logLines.join('\n'); }
function setStatus(text, frac) {
  $('rstatus').textContent = text;
  if (frac != null) $('rbar').style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
}

async function getFF() {
  if (ff) return ff;
  setStatus('Đang khởi động ffmpeg (lần đầu mất vài giây)…', 0);
  const f = new FFmpeg();
  f.on('log', ({ message }) => { appendLog(message); logSink?.(message); });
  await f.load({
    coreURL: chrome.runtime.getURL('vendor/ffmpeg/core/ffmpeg-core.js'),
    wasmURL: chrome.runtime.getURL('vendor/ffmpeg/core/ffmpeg-core.wasm')
  });
  ff = f;
  return ff;
}

const toSec = (h, m, s) => +h * 3600 + +m * 60 + +s;

async function run(args, onFrac, totalSec) {
  logSink = (m) => {
    const t = /time=\s*(\d+):(\d+):([\d.]+)/.exec(m);
    if (t && onFrac && totalSec > 0) onFrac(Math.min(1, toSec(t[1], t[2], t[3]) / totalSec));
  };
  try {
    appendLog(`$ ffmpeg ${args.join(' ')}`);
    return await ff.exec(args);
  } finally {
    logSink = null;
    flushLog();
  }
}

async function probe(name) {
  const lines = [];
  logSink = (m) => lines.push(m);
  try { await ff.exec(['-hide_banner', '-i', name]); } finally { logSink = null; }
  const text = lines.join('\n');
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(text);
  const vline = text.split('\n').find((l) => /Stream #.*Video:/.test(l));
  const aline = text.split('\n').find((l) => /Stream #.*Audio:/.test(l));
  const info = { dur: d ? toSec(d[1], d[2], d[3]) : 0, v: null, a: null };
  if (vline) {
    const size = /, (\d{2,5})x(\d{2,5})/.exec(vline);
    const fps = /, ([\d.]+) fps/.exec(vline) || /, ([\d.]+) tbr/.exec(vline);
    info.v = { codec: (/Video: (\w+)/.exec(vline) || [])[1], w: size ? +size[1] : 0, h: size ? +size[2] : 0, fps: fps ? +fps[1] : 0 };
  }
  if (aline) {
    info.a = { codec: (/Audio: (\w+)/.exec(aline) || [])[1], rate: +((/(\d+) Hz/.exec(aline) || [])[1] || 0), layout: ((/Hz, ([^,]+)/.exec(aline) || [])[1] || '').trim() };
  }
  return info;
}

function sameFormat(infos) {
  const key = (i) => JSON.stringify([i.v?.codec, i.v?.w, i.v?.h, Math.round((i.v?.fps || 0) * 100), !!i.a, i.a?.codec, i.a?.rate, i.a?.layout]);
  return infos.every((i) => key(i) === key(infos[0]));
}

async function concatCopy(names, total, fracBase, fracSpan) {
  const list = names.map((n) => `file '${n}'`).join('\n');
  await ff.writeFile('list.txt', new TextEncoder().encode(list));
  const ret = await run(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', '-movflags', '+faststart', 'out.mp4'],
    (f) => setStatus(`Đang ghép… ${Math.round(f * 100)}%`, fracBase + f * fracSpan), total);
  if (ret !== 0) return null;
  const data = await ff.readFile('out.mp4');
  return new Blob([data], { type: 'video/mp4' });
}

async function encodeAll(infos, list, total) {
  const sizeOpt = $('outSize').value;
  let W, H;
  if (sizeOpt === 'first') { W = infos[0].v?.w || 1280; H = infos[0].v?.h || 720; }
  else [W, H] = sizeOpt.split('x').map(Number);
  W -= W % 2;
  H -= H % 2;
  const fps = Math.round(infos[0].v?.fps || 24) || 24;
  const crf = $('outCrf').value;
  const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
  appendLog(`Render lại: ${W}x${H}, ${fps} fps, CRF ${crf}`);

  const outNames = [];
  let doneSec = 0;
  for (let i = 0; i < infos.length; i++) {
    if (cancelled) throw new Error('cancelled');
    const info = infos[i];
    const dur = info.dur || list[i].dur || 5;
    const args = ['-i', `in${i}.mp4`];
    let amap = '0:a:0';
    if (!info.a) {
      // Clip không có tiếng: thêm khoảng lặng để mọi clip đều có track âm thanh khi ghép
      await ff.writeFile(`sil${i}.raw`, new Uint8Array(Math.ceil(dur * 48000) * 4));
      args.push('-f', 's16le', '-ar', '48000', '-ac', '2', '-i', `sil${i}.raw`);
      amap = '1:a:0';
    }
    args.push('-map', '0:v:0', '-map', amap, '-vf', vf, '-r', String(fps),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', crf, '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2');
    if (!info.a) args.push('-t', dur.toFixed(3));
    args.push(`n${i}.mp4`);
    const ret = await run(args, (f) => setStatus(`Render clip ${i + 1}/${infos.length} (${list[i].name})… ${Math.round(f * 100)}%`, 0.1 + 0.85 * ((doneSec + f * dur) / total)), dur);
    if (ret !== 0) throw new Error(`ffmpeg lỗi khi render ${list[i].name} (mã ${ret}). Xem "Nhật ký ffmpeg".`);
    await ff.deleteFile(`in${i}.mp4`).catch(() => {});
    if (!info.a) await ff.deleteFile(`sil${i}.raw`).catch(() => {});
    outNames.push(`n${i}.mp4`);
    doneSec += dur;
  }
  const blob = await concatCopy(outNames, total, 0.95, 0.05);
  if (!blob) throw new Error('Ghép các clip đã render bị lỗi. Xem "Nhật ký ffmpeg".');
  return blob;
}

function lockUI(on) {
  rendering = on;
  $('renderBtn').disabled = on;
  $('cancelBtn').hidden = !on;
  $('reloadBtn').disabled = on;
  $('addFiles').disabled = on;
}

async function render() {
  const list = clips.filter((c) => c.on && !c.err);
  if (!list.length) { showBanner('warn', 'Chưa chọn clip nào để ghép.'); return; }
  const totalBytes = list.reduce((a, c) => a + c.blob.size, 0);
  if (totalBytes > 900 * 1024 * 1024 &&
    !confirm(`Tổng dung lượng ${mb(totalBytes)} khá lớn — trình duyệt có thể hết bộ nhớ khi ghép. Vẫn tiếp tục?`)) return;

  const name = safeName($('outName').value) || `${folder()}_full`;
  $('outName').value = name;
  hideBanner();
  cancelled = false;
  lockUI(true);
  logLines.length = 0;
  const t0 = Date.now();
  try {
    await getFF();
    const infos = [];
    for (let i = 0; i < list.length; i++) {
      if (cancelled) throw new Error('cancelled');
      setStatus(`Nạp clip ${i + 1}/${list.length}: ${list[i].name}`, (i / list.length) * 0.1);
      await ff.writeFile(`in${i}.mp4`, new Uint8Array(await list[i].blob.arrayBuffer()));
      const info = await probe(`in${i}.mp4`);
      if (!info.v) throw new Error(`ffmpeg không đọc được video trong ${list[i].name}.`);
      infos.push(info);
    }
    const total = infos.reduce((a, i, k) => a + (i.dur || list[k].dur || 0), 0);
    const mode = document.querySelector('input[name="rmode"]:checked').value;

    let blob = null;
    if (mode === 'auto' && sameFormat(infos)) {
      appendLog('Các clip cùng định dạng → ghép trực tiếp (không render lại).');
      blob = await concatCopy(list.map((_, i) => `in${i}.mp4`), total, 0.1, 0.9);
      if (blob) {
        const tmp = URL.createObjectURL(blob);
        const got = (await probeMeta(tmp)).dur;
        URL.revokeObjectURL(tmp);
        if (!(got > 0) || Math.abs(got - total) > Math.max(2, total * 0.05)) {
          appendLog(`Thời lượng sau khi ghép (${got?.toFixed?.(1)}s) lệch so với tổng (${total.toFixed(1)}s) → chuyển sang render lại.`);
          blob = null;
        }
      } else appendLog('Ghép trực tiếp thất bại → chuyển sang render lại.');
      if (!blob) await ff.deleteFile('out.mp4').catch(() => {});
    } else if (mode === 'auto') {
      appendLog('Các clip khác định dạng (kích thước/fps/codec/âm thanh) → render lại để đồng nhất.');
    }
    if (!blob) blob = await encodeAll(infos, list, total);

    setStatus('Đang lưu tệp…', 1);
    const url = URL.createObjectURL(blob);
    const filename = `${folder()}/${name}.mp4`;
    await chrome.runtime.sendMessage({ type: 'nameDownload', url, filename, conflictAction: 'uniquify' }).catch(() => {});
    await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    const p = $('player');
    play.idx = -1;
    play.seq = false;
    p.src = url;
    $('nowPlaying').textContent = 'Video vừa xuất';
    setStatus(`Xong: ${filename} · ${fmt(total)} · ${mb(blob.size)} · mất ${fmt((Date.now() - t0) / 1000)}`, 1);
    renderClips();
  } catch (e) {
    if (cancelled || /cancelled|terminate/i.test(String(e?.message || e))) setStatus('Đã hủy.', 0);
    else {
      setStatus('Lỗi — xem thông báo phía trên.', 0);
      showBanner('danger', `Không render được: ${e?.message || e}`);
    }
  } finally {
    flushLog();
    // Giải phóng toàn bộ bộ nhớ của ffmpeg sau mỗi lần render
    try { ff?.terminate(); } catch { /* bỏ qua */ }
    ff = null;
    lockUI(false);
  }
}

$('renderBtn').addEventListener('click', render);
$('cancelBtn').addEventListener('click', () => {
  cancelled = true;
  try { ff?.terminate(); } catch { /* bỏ qua */ }
  ff = null;
});

// ---------------------------------------------------------------- nạp, thêm tệp, kéo-thả từ máy

$('reloadBtn').addEventListener('click', async () => {
  if (!confirm('Nạp lại các video theo thứ tự cảnh? Thứ tự bạn đã sắp và các tệp thêm từ máy sẽ bị bỏ.')) return;
  await chrome.storage.local.remove('museEditor').catch(() => {});
  await loadFromScenes(false);
});
$('addFiles').addEventListener('change', (e) => { if (e.target.files.length) addFiles(e.target.files); e.target.value = ''; });
$('bannerClose').addEventListener('click', hideBanner);

let depth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; $('dropOverlay').hidden = false; });
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('dropOverlay').hidden = true; } });
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  depth = 0;
  $('dropOverlay').hidden = true;
  if (rendering) { showBanner('warn', 'Đang render — chờ xong rồi hãy thêm tệp.'); return; }
  addFiles(e.dataTransfer.files);
});
window.addEventListener('beforeunload', (e) => { if (rendering) { e.preventDefault(); e.returnValue = ''; } });

loadFromScenes(true);
