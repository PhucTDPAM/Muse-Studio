'use strict';
/* Muse Auto — side panel: giao diện + điều phối hàng đợi.
 * Hàng đợi chạy trong trang này, nên cần GIỮ side panel mở trong lúc chạy.
 * Mọi dữ liệu lưu cục bộ: chrome.storage.local (tiến độ) + IndexedDB (ảnh).
 */

const SEL = globalThis.MUSE_SELECTORS;
const META_MATCH = ['https://muse.ai/*', 'https://www.muse.ai/*'];
const META_RE = /^https:\/\/(www\.)?muse\.ai\//;
const GEN_TIMEOUT_MS = 6 * 60 * 1000;
const FLOOR = { delayMin: 20, delayMax: 60, pauseMin: 180, pauseMax: 300, batchMax: 10 };
const STATUS = {
  pending: 'Chưa làm',
  running: 'Đang tạo',
  done: 'Xong',
  error: 'Lỗi',
  limit: 'Dừng do giới hạn',
  skipped: 'Bỏ qua'
};

class Interrupt extends Error { constructor(kind) { super(kind); this.kind = kind; } }
class Blocked extends Error { constructor(kind, msg) { super(msg); this.kind = kind; } }
class SceneError extends Error {}

const $ = (id) => document.getElementById(id);
// Timer work belongs to the service worker, not a hidden document/worker.
const sleep = globalThis.MuseBackgroundTiming.sleep;
const rand = (a, b) => a + Math.random() * (b - a);

const defaultSettings = () => ({
  delayMin: 20, delayMax: 60, batch: 10, pauseMin: 180, pauseMax: 300,
  regenPolicy: 'ask', promptPrefix: '', attachImages: true, autoSendDelay: 5, sameThread: true,
  runAllProjects: true,
  autoRetry: true,          // tự làm lại cảnh lỗi trước khi đóng ZIP của dự án
  autoRetryMax: 2,          // số lần tự làm lại tối đa cho mỗi cảnh
  autoRetryRefused: false,  // làm lại cả cảnh bị trang từ chối vì chính sách
  threadMaxScenes: 5,       // tự mở cuộc trò chuyện mới sau mỗi N cảnh (0 = không tự đổi)
  newThreadOnError: true,   // mở cuộc trò chuyện mới ngay sau một cảnh bị lỗi
  reloadEvery: 0,           // tự tải lại trang (F5) sau mỗi N lần tạo (0 = tắt)
  claudeMode: 'suggest',    // Claude sửa prompt bị từ chối: 'off' | 'suggest' (bạn duyệt) | 'auto' (tự sửa và tạo lại)
  claudeStyle: '',          // đặc trưng sản xuất Claude phải giữ nguyên
  claudeMaxTries: 1,        // số lần nhờ Claude sửa tối đa mỗi cảnh
  museFixMode: 'refused',   // cảnh lỗi → nhắn Muse tự sửa và tạo tiếp: 'off' | 'refused' (chỉ khi bị từ chối) | 'all'
  museFixMax: 1,            // số lần nhắn Muse tự sửa tối đa mỗi cảnh
  museFixTemplate: ''       // nội dung tin nhắn ('' = dùng mẫu mặc định); {error} = lỗi của Muse, {style} = đặc trưng sản xuất
});

const MUSE_FIX_TEMPLATE = 'The video for my last request could not be generated ({error}). Please rewrite that prompt yourself so it can be generated — change only what is necessary — and then generate the video right away, without asking me to confirm. Keep the same scene, story beat, camera work, character designs and production style: {style}.';
const defaultState = () => ({
  episode: '',
  mode: 'semi',
  scenes: [],
  characterLibrary: [],
  packageImportError: null,
  imageKeys: [],
  promptsName: '',
  settings: defaultSettings(),
  genCount: 0,          // số lượt đã gửi (để nghỉ dài sau mỗi 10 video)
  pausedAtCount: 0,
  reloadCount: 0,       // số lần gửi prompt kể từ lần tải trang muse.ai gần nhất
  lastEndAt: 0,         // lúc kết thúc lượt tạo gần nhất (để giãn cách)
  activeMs: 0,
  runningSince: 0,
  wasRunning: false,
  blocked: null,        // {kind, message, n} — chỉ "Tiếp tục" mới gỡ
  priority: null,
  tabId: null,
  threadUrl: null,      // cuộc trò chuyện dùng chung cho cả tập (https://muse.ai/thread/<id>)
  knownSrcs: [],        // src video đã tải — không nhận nhầm là video của cảnh sau
  finishedSummary: null,
  pid: null,            // dự án đang mở
  projects: [],         // mọi dự án (bản của dự án đang mở được đồng bộ khi lưu)
  log: []
});

let state = defaultState();

// ---------------------------------------------------------------- dự án
// Mỗi dự án có danh sách cảnh, ảnh, video, cuộc trò chuyện và tệp ZIP riêng.
// Các trường của dự án đang mở nằm ngay trên state (để phần còn lại của code không đổi).
// Giãn cách / nghỉ dài / giới hạn tính CHUNG cho mọi dự án.
const PROJECT_FIELDS = ['characterLibrary', 'packageImportError', 'episode', 'scenes', 'imageKeys', 'promptsName', 'threadUrl', 'threadCount', 'threadPinned', 'finishedSummary', 'activeMs', 'priority'];
const newPid = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const imgKey = (n) => `${state.pid}:${n}`;
const vidPrefix = () => `${state.pid}/`;
const vidKey = (name) => vidPrefix() + name;

function emptyProject(name = '') {
  return { id: newPid(), characterLibrary: [], packageImportError: null, episode: name, scenes: [], imageKeys: [], promptsName: '', threadUrl: null, threadCount: 0, threadPinned: false, finishedSummary: null, activeMs: 0, priority: null };
}
const activeProject = () => state.projects.find((p) => p.id === state.pid);
function syncActiveProject() {
  const p = activeProject();
  if (p) for (const f of PROJECT_FIELDS) p[f] = state[f];
}
function loadProject(id) {
  tickActive();
  syncActiveProject();
  const p = state.projects.find((x) => x.id === id);
  if (!p) return;
  const blank = emptyProject();
  state.pid = id;
  for (const f of PROJECT_FIELDS) state[f] = p[f] ?? blank[f];
  ctl.selected = null;
  ctl.progress = null;
  thumbCache.forEach((u) => URL.revokeObjectURL(u));
  thumbCache.clear();
}
const projScenes = (p) => (p.id === state.pid ? state.scenes : p.scenes || []);
const hasWork = (p) => projScenes(p).some((s) => s.status === 'pending' || s.status === 'limit');
const projName = (p) => (p.id === state.pid ? state.episode : p.episode) || 'Chưa đặt tên';

// Dự án kế tiếp còn cảnh chưa làm: sau dự án hiện tại, rồi quay lại từ đầu danh sách
function nextProjectWithWork() {
  const i = state.projects.findIndex((p) => p.id === state.pid);
  const order = [...state.projects.slice(i + 1), ...state.projects.slice(0, Math.max(0, i))];
  return order.find(hasWork) || null;
}
const ctl = { loop: false, pause: false, skip: false, currentN: null, selected: null, submitted: false, progress: null };

// Side panel và dashboard dùng chung tệp này. Chỉ MỘT trang chạy hàng đợi (khóa 'muse-run');
// trang còn lại hiển thị theo chrome.storage và chuyển lệnh của bạn sang trang đang chạy.
const PAGE_ID = Math.random().toString(36).slice(2);
const chan = new BroadcastChannel('muse-auto');
let remoteRunning = false;
const isBusy = () => ctl.loop || remoteRunning;

// ---------------------------------------------------------------- lưu trữ

let saving = Promise.resolve();
function tickActive() {
  if (state.runningSince) {
    const now = Date.now();
    state.activeMs += now - state.runningSince;
    state.runningSince = now;
  }
}
function save() {
  tickActive();
  syncActiveProject();
  state.writer = PAGE_ID;
  saving = saving.then(() => chrome.storage.local.set({ museState: state })).catch(console.error);
  return saving;
}

// Kho 'images': ảnh khung đầu (khóa = số cảnh). Kho 'videos': bản sao video để đóng ZIP (khóa = "c01.mp4").
const idb = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      const rq = indexedDB.open('muse-auto', 2);
      rq.onupgradeneeded = () => {
        for (const n of ['images', 'videos']) if (!rq.result.objectStoreNames.contains(n)) rq.result.createObjectStore(n);
      };
      rq.onsuccess = () => res((this._db = rq.result));
      rq.onerror = () => rej(rq.error);
    });
  },
  async tx(store, mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const rq = fn(t.objectStore(store));
      t.oncomplete = () => res(rq && rq.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('IndexedDB bị hủy (có thể hết dung lượng)'));
    });
  },
  put(k, blob, store = 'images') { return this.tx(store, 'readwrite', (s) => s.put(blob, k)); },
  get(k, store = 'images') { return this.tx(store, 'readonly', (s) => s.get(k)); },
  del(k, store = 'images') { return this.tx(store, 'readwrite', (s) => s.delete(k)); },
  keys(store = 'images') { return this.tx(store, 'readonly', (s) => s.getAllKeys()); },
  clear(store = 'images') { return this.tx(store, 'readwrite', (s) => s.clear()); },
  async keysPrefix(prefix, store = 'images') { return (await this.keys(store)).map(String).filter((k) => k.startsWith(prefix)); },
  async delPrefix(prefix, store = 'images') {
    for (const k of await this.keys(store)) if (String(k).startsWith(prefix)) await this.del(k, store);
  }
};

// ---------------------------------------------------------------- tiện ích

const pad = (n) => String(n).padStart(Math.max(2, String(state.scenes.length).length), '0');
const sceneBy = (n) => state.scenes.find((s) => s.n === n);
const selScene = () => (ctl.selected == null ? null : sceneBy(ctl.selected));

function fmtDur(ms) {
  const t = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function folder() {
  const f = (state.episode || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').trim();
  return f || 'Muse';
}

function eff() {
  const s = state.settings;
  const delayMin = Math.max(FLOOR.delayMin, +s.delayMin || 0);
  const delayMax = Math.max(FLOOR.delayMax, delayMin, +s.delayMax || 0);
  const pauseMin = Math.max(FLOOR.pauseMin, +s.pauseMin || 0);
  const pauseMax = Math.max(FLOOR.pauseMax, pauseMin, +s.pauseMax || 0);
  const batch = Math.min(FLOOR.batchMax, Math.max(1, Math.round(+s.batch || FLOOR.batchMax)));
  return { ...s, delayMin, delayMax, pauseMin, pauseMax, batch };
}

function log(msg) {
  const line = `[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`;
  state.log.push(line);
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
  $('log').textContent = state.log.slice().reverse().join('\n');
}

// % tiến độ của cảnh đang tạo: { n, pct, est } (est = ước tính theo thời gian, không phải số của trang)
function setSceneProgress(p) {
  ctl.progress = p;
  if (ctl.loop) chan.postMessage({ type: 'progress', p });
  renderLiveProgress();
}

function avgGenMs() {
  const g = state.scenes.filter((x) => x.status === 'done' && x.genMs > 0).map((x) => x.genMs);
  return g.length ? g.reduce((a, b) => a + b, 0) / g.length : 150000;
}

const pctLabel = (p) => (p ? `${p.pct}%${p.est ? '*' : ''}` : '');

// Cập nhật % mà không vẽ lại toàn bộ danh sách
function renderLiveProgress() {
  const p = ctl.progress;
  renderProgress();
  document.querySelectorAll('.row .chip.st-running').forEach((c) => {
    const n = +c.closest('.row').dataset.n;
    c.textContent = p && p.n === n ? `${STATUS.running} ${pctLabel(p)}` : STATUS.running;
    c.title = p && p.est ? '* ước tính theo thời gian tạo trung bình' : '';
  });
  globalThis.museRenderSceneProgress?.(p);
}

function setActivity(text) {
  $('activity').textContent = text || '';
  if (ctl.loop) chan.postMessage({ type: 'activity', text: text || '' });
}

function showBanner(kind, text) {
  $('banner').className = `banner ${kind}`;
  $('bannerText').textContent = text;
  $('banner').hidden = false;
}
function hideBanner() { $('banner').hidden = true; }

function setBadge(text, color) {
  chrome.action.setBadgeText({ text }).catch(() => {});
  if (color) chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
}

function beep(kind) {
  try {
    const ctx = new AudioContext();
    const tones = kind === 'alert' ? [880, 660, 880] : kind === 'done' ? [523, 659, 784] : [660];
    tones.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.value = 0.08;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.22);
      o.stop(ctx.currentTime + i * 0.22 + 0.18);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch { /* không có âm thanh cũng không sao */ }
}

function askChoice(text, options) {
  return new Promise((resolve) => {
    $('modalText').textContent = text;
    const box = $('modalBtns');
    box.textContent = '';
    for (const o of options) {
      const b = document.createElement('button');
      b.textContent = o.label;
      if (o.primary) b.className = 'primary';
      b.onclick = () => { $('modal').hidden = true; resolve(o.value); };
      box.append(b);
    }
    $('modal').hidden = false;
  });
}

function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}

// ---------------------------------------------------------------- tab muse.ai

async function findMetaTab() {
  if (state.tabId != null) {
    const t = await chrome.tabs.get(state.tabId).catch(() => null);
    if (t && t.url && META_RE.test(t.url)) return t;
  }
  let tabs = await chrome.tabs.query({ url: META_MATCH, currentWindow: true });
  if (!tabs.length) tabs = await chrome.tabs.query({ url: META_MATCH });
  if (!tabs.length) {
    // Tab đã dùng trước đó có thể bị chuyển sang trang đăng nhập/xác minh
    if (state.tabId != null && (await chrome.tabs.get(state.tabId).catch(() => null))) {
      throw new Blocked('login', 'Tab Muse AI đã rời khỏi muse.ai (có thể là trang đăng nhập/xác minh). Hãy kiểm tra tab, xử lý xong rồi bấm "Tiếp tục".');
    }
    return null;
  }
  const t = tabs.find((x) => x.active) || tabs[0];
  state.tabId = t.id;
  return t;
}

async function waitTabLoaded(tabId, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) throw new SceneError('Tab muse.ai đã bị đóng');
    if (t.status === 'complete') return t;
    await sleep(500);
  }
  return chrome.tabs.get(tabId);
}

async function ensureTab({ create = true, activate = true } = {}) {
  let t = await findMetaTab();
  if (!t) {
    if (!create) return null;
    t = await chrome.tabs.create({ url: SEL.startUrl, active: activate });
    state.tabId = t.id;
    log('Đã mở tab muse.ai mới');
    t = await waitTabLoaded(t.id);
  }
  if (activate && !t.active) await chrome.tabs.update(t.id, { active: true });
  return t;
}

async function send(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch (e) {
    if (!/Receiving end does not exist|Could not establish connection/i.test(e.message || '')) throw e;
    await chrome.scripting.executeScript({ target: { tabId }, files: ['background-timing.js', 'content/selectors.js', 'content/meta.js'] });
    return await chrome.tabs.sendMessage(tabId, msg);
  }
}

function checkBlocked(st) {
  if (!st) return;
  if (st.captcha) throw new Blocked('captcha', `Phát hiện CAPTCHA / xác minh: "${st.captcha}".\nHãy tự xử lý trên trang (extension không bao giờ giải), rồi bấm "Tiếp tục".`);
  if (st.login) throw new Blocked('login', `Trang yêu cầu đăng nhập: "${st.login}".\nHãy tự đăng nhập lại trên trang rồi bấm "Tiếp tục".`);
  if (st.limit) throw new Blocked('limit', `Trang báo giới hạn: "${st.limit}".\nChỉ bấm "Tiếp tục" khi đã hết thời gian giới hạn.`);
}

async function assertOnMeta(tabId) {
  const t = await chrome.tabs.get(tabId).catch(() => null);
  if (!t) throw new SceneError('Tab muse.ai đã bị đóng');
  if (!t.url || !META_RE.test(t.url)) {
    throw new Blocked('login', 'Tab Muse AI đã rời khỏi muse.ai (có thể là trang đăng nhập/xác minh). Hãy kiểm tra tab rồi bấm "Tiếp tục".');
  }
  return t;
}

// ---------------------------------------------------------------- giữ tab muse.ai luôn hiển thị

const IS_DASHBOARD = location.pathname.includes('/app/');

// Xếp cửa sổ muse.ai bên trái, dashboard bên phải để không cửa sổ nào che cửa sổ nào.
async function tileWindows(metaWinId) {
  const me = await chrome.windows.getCurrent();
  if (!me || me.id === metaWinId) return;
  const sl = screen.availLeft ?? 0, st = screen.availTop ?? 0, sw = screen.availWidth, sh = screen.availHeight;
  const dashW = Math.max(520, Math.round(sw * 0.38));
  await chrome.windows.update(metaWinId, { state: 'normal' });
  await chrome.windows.update(metaWinId, { left: sl, top: st, width: Math.max(600, sw - dashW), height: sh });
  await chrome.windows.update(me.id, { state: 'normal' });
  await chrome.windows.update(me.id, { left: sl + sw - dashW, top: st, width: dashW, height: sh, focused: true });
}

// Do not steal focus or restore minimized windows during background work.
// The existing tileWindows helper is retained for explicit layout actions only.
async function waitReady(tabId) {
  const end = Date.now() + 30000;
  let last = null;
  while (Date.now() < end) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) throw new SceneError('Tab muse.ai đã bị đóng');
    if (t.status === 'complete') {
      await assertOnMeta(tabId);
      last = await send(tabId, { type: 'precheck' }).catch(() => null);
      if (last) {
        checkBlocked(last);
        if (last.composer) return last;
      }
    }
    await sleep(1000);
  }
  if (last && last.loginButton) throw new Blocked('login', 'Không thấy ô nhập prompt và trang có nút Đăng nhập — có thể đã bị đăng xuất. Hãy tự đăng nhập rồi bấm "Tiếp tục".');
  throw new SceneError('Không tìm thấy ô nhập prompt sau 30 giây. Nếu tab bị ẩn, Muse có thể chưa dựng giao diện; hãy mở tab để kiểm tra rồi tiếp tục.');
}

async function openNewChat(tabId) {
  let clicked = false;
  if (SEL.openMethod !== 'url') {
    const r = await send(tabId, { type: 'newChat' }).catch(() => null);
    clicked = !!(r && r.clicked);
    if (clicked) log(`Đã bấm "cuộc trò chuyện mới": ${r.note}`);
  }
  if (!clicked) {
    await chrome.tabs.update(tabId, { url: SEL.startUrl });
    log(`Mở ${SEL.startUrl}`);
  }
  await sleep(2000);
}

// ---------------------------------------------------------------- dùng chung một cuộc trò chuyện

const THREAD_RE = /\/thread\/(?!new(?:[/?#]|$))[^/?#]+/;

function samePage(a, b) {
  try {
    const x = new URL(a), y = new URL(b);
    return x.host.replace(/^www\./, '') === y.host.replace(/^www\./, '') &&
      x.pathname.replace(/\/$/, '') === y.pathname.replace(/\/$/, '');
  } catch { return false; }
}

// Sau lần gửi đầu, URL đổi từ /thread/new sang /thread/<id> — ghi nhớ để các cảnh sau gửi tiếp vào đó.
function noteThread(url) {
  if (!state.settings.sameThread || state.threadUrl || !url || !THREAD_RE.test(url)) return;
  state.threadUrl = url.split(/[?#]/)[0];
  log(`Ghi nhớ cuộc trò chuyện chung: ${state.threadUrl}`);
  renderThreadInfo();
}

// Bỏ cuộc trò chuyện hiện tại: cảnh kế tiếp mở /thread/new và dùng chung cuộc mới từ đó
function dropThread(why) {
  if (!state.threadUrl && !state.threadCount) return;
  state.threadUrl = null;
  state.threadCount = 0;
  state.threadPinned = false;
  if (why) log(`${why} → cảnh kế tiếp mở cuộc trò chuyện mới`);
  renderThreadInfo();
}

// Trả về true nếu phải điều hướng (trang được tải lại).
async function openThread(tabId) {
  const t = await chrome.tabs.get(tabId);
  if (samePage(t.url, state.threadUrl)) return false;
  await chrome.tabs.update(tabId, { url: state.threadUrl });
  log(`Mở lại cuộc trò chuyện chung ${state.threadUrl}`);
  await sleep(2000);
  return true;
}

// ---------------------------------------------------------------- chờ có thể ngắt

async function waitMs(ms, label, { skippable = false } = {}) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (ctl.pause) throw new Interrupt('pause');
    if (skippable && ctl.skip) throw new Interrupt('skip');
    setActivity(`${label} — còn ${fmtDur(end - Date.now())}`);
    await sleep(Math.min(500, end - Date.now()));
  }
}

async function pacing(scene) {
  if (!state.lastEndAt) return;
  const s = eff();
  const since = Date.now() - state.lastEndAt;
  if (state.genCount > 0 && state.genCount % s.batch === 0 && state.pausedAtCount !== state.genCount) {
    const p = rand(s.pauseMin, s.pauseMax) * 1000;
    if (since < p) {
      log(`Nghỉ dài ${fmtDur(p)} sau ${state.genCount} video`);
      await waitMs(p - since, `Nghỉ dài sau ${state.genCount} video`);
    }
    state.pausedAtCount = state.genCount;
    await save();
    return;
  }
  const d = rand(s.delayMin, s.delayMax) * 1000;
  if (since < d) await waitMs(d - since, `Chờ trước cảnh c${pad(scene.n)}`);
}

// ---------------------------------------------------------------- tải xuống

function waitDownloadDone(id, ms = 5 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      chrome.downloads.onChanged.removeListener(onCh);
      clearTimeout(timer);
      fn(v);
    };
    const onCh = (d) => {
      if (d.id !== id || !d.state) return;
      if (d.state.current === 'complete') finish(resolve);
      else if (d.state.current === 'interrupted') finish(reject, new SceneError(`Tải xuống bị gián đoạn: ${d.error?.current || ''}`));
    };
    chrome.downloads.onChanged.addListener(onCh);
    const timer = setTimeout(() => finish(reject, new SceneError('Tải xuống quá 5 phút')), ms);
    chrome.downloads.search({ id }).then(([it]) => {
      if (it?.state === 'complete') finish(resolve);
      else if (it?.state === 'interrupted') finish(reject, new SceneError(`Tải xuống bị gián đoạn: ${it.error || ''}`));
    });
  });
}

// Tải với tên cố định: báo trước cho background để nó đặt đúng tên, rồi mới tải.
async function downloadNamed(url, filename, conflictAction = 'uniquify') {
  await chrome.runtime.sendMessage({ type: 'nameDownload', url, filename, conflictAction }).catch(() => {});
  return chrome.downloads.download({ url, filename, conflictAction, saveAs: false });
}

function waitPageDownloadCreated(ms = 20000) {
  return new Promise((resolve, reject) => {
    const on = (item) => {
      if (item.byExtensionId === chrome.runtime.id) return;
      chrome.downloads.onCreated.removeListener(on);
      clearTimeout(t);
      resolve(item);
    };
    chrome.downloads.onCreated.addListener(on);
    const t = setTimeout(() => {
      chrome.downloads.onCreated.removeListener(on);
      reject(new SceneError('Đã bấm nút tải của trang nhưng không có tệp nào được tải'));
    }, ms);
  });
}

function sceneFilename(scene) {
  return `${folder()}/c${pad(scene.n)}${scene.nextSuffix || ''}.mp4`;
}

const zipEntryName = (filename) => filename.slice(filename.indexOf('/') + 1);

// Mỗi cảnh xong: CHỈ lưu video vào IndexedDB (tên c01.mp4, c02.mp4…), không tải lẻ.
// Hết danh sách thì tải một tệp ZIP chứa tất cả. Chỉ tải lẻ khi không thể lưu vào bộ nhớ (để không mất video).
async function downloadScene(tabId, scene, result) {
  const tag = `c${pad(scene.n)}`;
  const filename = sceneFilename(scene);
  const zipName = zipEntryName(filename);
  const conflictAction = scene.overwrite ? 'overwrite' : 'uniquify';
  const v = result.video;
  let saved = false;
  scene.frameCheck = {ok:false,code:'not_checked'};
  let blob = null;
  let why = '';

  if (v && /^(https?|blob|data):/i.test(v.src)) {
    // Đọc video qua trang muse.ai (cùng phiên đăng nhập)
    const r = await send(tabId, { type: 'fetchBlob', url: v.src }).catch((e) => ({ ok: false, note: e.message }));
    if (r && r.ok) {
      blob = await (await fetch(r.dataUrl)).blob();
      const candidate = vidKey(`pending/c${pad(scene.n)}.mp4`);
      let candidateSaved = false;
      try {await idb.put(candidate, blob, 'videos'); candidateSaved = true;}
      catch(e) {why = `không lưu được video trước kiểm tra (${e.message})`;}
      if (candidateSaved) {
        // Persist first. Hidden-window media decoding is deferred, never a generation error.
        const quality = await MuseFrameQuality.inspectWhenVisible(blob);
        scene.frameCheck = quality;
        if (quality.ok === false) {
          const rejected = `rejected/c${pad(scene.n)}.mp4`;
          await idb.put(vidKey(rejected), blob, 'videos');
          await idb.del(candidate, 'videos');
          scene.rejectedFile = rejected;
          scene.inZip = false;
          if(v?.src)state.knownSrcs=[...new Set([...state.knownSrcs,v.src])].slice(-1000);
          throw new SceneError(`Lỗi khung hình (${quality.code}): ${quality.note} Bản lỗi lưu trong ${rejected}; thử lại theo giới hạn hiện có.`);
        }
        try {
          await idb.put(vidKey(zipName), blob, 'videos');
          saved = true;
          await idb.del(candidate, 'videos').catch(()=>{});
          log(`${tag}: đã lưu ${zipName} (${Math.round(blob.size / 1024)} KB)${quality.ok === null ? ' · CHỜ KIỂM TRA HÌNH' : ''} — sẽ nằm trong tệp ZIP`);
        } catch (e) {why = `video còn trong pending/: không ghi được tệp chính (${e.message})`;}
      }
    } else why = r?.note || 'không đọc được video qua trang';
  } else why = 'không thấy nguồn video trên trang';

  scene.inZip = saved;
  if (v && v.src) state.knownSrcs = [...state.knownSrcs.filter((x) => x !== v.src), v.src].slice(-1000);

  if (!saved) {
    await idb.del(vidKey(zipName), 'videos').catch(() => {});
    log(`${tag}: ${why} → tải lẻ tệp này để không mất video (sẽ KHÔNG có trong ZIP)`);
    let done = false;
    let lastErr = why;
    const tryDownload = async (url) => {
      const id = await downloadNamed(url, filename, conflictAction);
      await waitDownloadDone(id);
      scene.downloadId = id;
      done = true;
    };
    if (blob) {
      const url = URL.createObjectURL(blob);
      try { await tryDownload(url); } catch (e) { lastErr += `; ${e.message}`; } finally { setTimeout(() => URL.revokeObjectURL(url), 60000); }
    }
    if (!done && v && /^https?:/i.test(v.src)) {
      try { await tryDownload(v.src); } catch (e) { lastErr += `; ${e.message}`; }
    }
    if (!done) {
      // Cuối cùng: bấm nút Tải xuống của trang, background đổi tên tệp
      await chrome.runtime.sendMessage({ type: 'expectDownload', filename, conflictAction });
      const created = waitPageDownloadCreated();
      const r = await send(tabId, { type: 'clickDownload' }).catch((e) => ({ ok: false, note: e.message }));
      if (!r || !r.ok) {
        created.catch(() => {});
        await chrome.runtime.sendMessage({ type: 'cancelExpectDownload' }).catch(() => {});
        throw new SceneError(`Video đã xong nhưng không lấy được (${[lastErr, r?.note].filter(Boolean).join('; ')})`);
      }
      const item = await created;
      await waitDownloadDone(item.id);
      scene.downloadId = item.id;
    }
    log(`${tag}: đã tải lẻ → ${filename}`);
  }
  scene.files = [...(scene.files || []), filename];
  scene.versions = (scene.versions || 0) + 1;
  scene.nextSuffix = '';
  scene.overwrite = false;
  if (scene.frameCheck?.code === 'not_checked') scene.frameCheck={ok:null,code:'external_download',note:'Đã tải lẻ; cần xem file trên máy để kiểm tra hình.'};
}

// ---------------------------------------------------------------- ZIP (không nén — mp4 vốn đã nén)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function buildZip(entries, onProgress) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (let i = 0; i < entries.length; i++) {
    const { name, blob } = entries[i];
    onProgress?.(i, name);
    const nameBytes = enc.encode(name);
    const crc = crc32(new Uint8Array(await blob.arrayBuffer()));
    const size = blob.size;

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);         // tên tệp UTF-8
    lh.setUint16(8, 0, true);              // không nén
    lh.setUint16(10, dosTime, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);
    lh.setUint32(22, size, true);
    lh.setUint16(26, nameBytes.length, true);
    parts.push(lh.buffer, nameBytes, blob);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true);
    ch.setUint32(24, size, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint32(42, offset, true);
    central.push(ch.buffer, nameBytes);
    offset += 30 + nameBytes.length + size;
  }
  const cdSize = central.reduce((a, p) => a + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

// Tệp .txt đi kèm trong ZIP cho mỗi cảnh lỗi: prompt, lý do, prompt gốc, gợi ý của Claude
function errorSceneText(sc) {
  const L = [
    `Cảnh c${pad(sc.n)} — ${STATUS[sc.status]}`,
    `Dự án: ${state.episode || '(chưa đặt tên)'}`,
    `Lý do: ${sc.reason || '(không rõ)'}`
  ];
  if (sc.finishedAt) L.push(`Thời điểm: ${new Date(sc.finishedAt).toLocaleString('vi-VN')}`);
  if (sc.autoRetries) L.push(`Đã tự làm lại: ${sc.autoRetries} lần`);
  if (sc.museFixes) L.push(`Đã nhờ Muse tự sửa: ${sc.museFixes} lần`);
  L.push('', 'Prompt:', sc.prompt);
  if (sc.originalPrompt != null && sc.originalPrompt !== sc.prompt) L.push('', 'Prompt gốc (trước khi sửa):', sc.originalPrompt);
  if (sc.claude && sc.claude.prompt && sc.claude.prompt !== sc.prompt) {
    L.push('', `Claude gợi ý${sc.claude.feasible ? '' : ' (Claude cho rằng không sửa được)'}: ${sc.claude.changes || ''}`, sc.claude.prompt);
  }
  return '﻿' + L.join('\r\n') + '\r\n';
}

let zipping = false;
async function downloadZip() {
  if (zipping) return;
  zipping = true;
  renderControls();
  renderSummary();
  try {
    const prefix = vidPrefix();
    const keys = (await idb.keysPrefix(prefix, 'videos')).sort();
    const errScenes = state.scenes.filter((s) => s.status === 'error' || s.status === 'limit');
    if (!keys.length && !errScenes.length) {
      showBanner('info', 'Chưa có video nào được giữ bản sao để đóng ZIP.');
      return;
    }
    const entries = [];
    for (const k of keys) {
      const blob = await idb.get(k, 'videos');
      if (blob) entries.push({ name: k.slice(prefix.length), blob });
    }
    // Cảnh lỗi: thêm cXX_loi.txt (đứng ngay chỗ của video cảnh đó khi sắp xếp)
    for (const sc of errScenes) {
      entries.push({ name: `c${pad(sc.n)}_loi.txt`, blob: new Blob([errorSceneText(sc)], { type: 'text/plain;charset=utf-8' }) });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    if (errScenes.length) log(`ZIP kèm ${errScenes.length} tệp prompt của cảnh lỗi: ${errScenes.map((s) => `c${pad(s.n)}_loi.txt`).join(', ')}`);
    // Chia phần ≤ 1,5 GB để tránh giới hạn 4 GB của ZIP thường và tốn RAM
    const LIMIT = 1.5 * 1024 ** 3;
    const groups = [[]];
    let size = 0;
    for (const e of entries) {
      if (size + e.blob.size > LIMIT && groups[groups.length - 1].length) { groups.push([]); size = 0; }
      groups[groups.length - 1].push(e);
      size += e.blob.size;
    }
    for (let g = 0; g < groups.length; g++) {
      const label = groups.length > 1 ? ` (phần ${g + 1}/${groups.length})` : '';
      const zip = await buildZip(groups[g], (i, name) => setActivity(`Đang đóng ZIP${label}: ${name} (${i + 1}/${groups[g].length})`));
      const filename = `${folder()}${groups.length > 1 ? `_phan${g + 1}` : ''}.zip`;
      const url = URL.createObjectURL(zip);
      try {
        const id = await downloadNamed(url, filename);
        setActivity(`Đang lưu ${filename}…`);
        await waitDownloadDone(id, 30 * 60 * 1000);
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      log(`Đã tải ZIP → ${filename} (${groups[g].length} video, ${Math.round(zip.size / 1024 / 1024)} MB)`);
    }
    const missing = state.scenes.filter((s) => s.status === 'done' && !s.inZip);
    setActivity(`Đã tải ZIP: ${entries.length} video.`);
    if (missing.length) {
      showBanner('warn', `ZIP thiếu ${missing.length} cảnh vì không lưu được vào bộ nhớ, nên đã được tải lẻ vào thư mục "${folder()}": ${missing.map((s) => `c${pad(s.n)}`).join(', ')}.`);
    }
  } catch (e) {
    showBanner('warn', `Không tạo được ZIP: ${e.message || e}`);
  } finally {
    zipping = false;
    renderControls();
    renderSummary();
  }
}

// ---------------------------------------------------------------- xử lý một cảnh

function checkSkip() { if (ctl.skip) throw new Interrupt('skip'); }

async function waitForUserSubmit(tabId, scene) {
  setActivity(`c${pad(scene.n)}: đã điền xong — hãy kiểm tra và bấm nút Gửi đang nhấp nháy trên trang`);
  beep('soft');
  while (true) {
    if (ctl.pause) throw new Interrupt('pause');
    checkSkip();
    await assertOnMeta(tabId);
    const st = await send(tabId, { type: 'status' }).catch(() => null);
    if (st) {
      checkBlocked(st);
      if (st.submitted) return 'sent';
      if (state.mode === 'auto' && st.watching) return 'switch';
      if (!st.watching) {
        // Trang tải lại: nếu ô nhập đã trống thì coi như bạn đã gửi
        if (!st.composerFilled) {
          await send(tabId, { type: 'beginWatch', prompt: scene.sentPrompt, baseline: false, submitted: true, exclude: state.knownSrcs });
          return;
        }
        throw new SceneError('Trang đã tải lại trước khi gửi');
      }
    }
    await sleep(1000);
  }
}

// Chế độ Tự động: đếm ngược rồi bấm Gửi (bạn vẫn có thể tự bấm trước).
async function autoSubmit(tabId, tag, s, scene) {
  await send(tabId, { type: 'highlightSend' }).catch(() => {});
  const end = Date.now() + Math.max(1, +s.autoSendDelay || 5) * 1000;
  while (Date.now() < end) {
    if (ctl.pause) throw new Interrupt('pause');
    checkSkip();
    const left = Math.ceil((end - Date.now()) / 1000);
    setActivity(`${tag}: tự gửi sau ${left} giây`);
    await send(tabId, { type: 'hint', text: `Muse Auto: tự bấm Gửi sau ${left} giây…` }).catch(() => {});
    const st = await send(tabId, { type: 'status' }).catch(() => null);
    if (st) {
      checkBlocked(st);
      // Chỉ bỏ qua khi CHÍNH BẠN bấm Gửi / nhấn Enter (thao tác thật), không tin dấu hiệu gián tiếp
      if (st.submitted && st.submittedBy === 'user') {
        log(`${tag}: bạn đã tự gửi trong lúc đếm ngược`);
        return;
      }
    }
    await sleep(Math.min(1000, Math.max(0, end - Date.now())));
  }
  // Trang mới tải đôi khi xóa ô nhập sau khi đã điền → điền lại trước khi bấm
  const before = await send(tabId, { type: 'status' }).catch(() => null);
  if (before && !before.composerFilled) {
    log(`${tag}: ô nhập bị trang xóa trước khi gửi → điền lại`);
    const f = await send(tabId, { type: 'fillPrompt', text: scene.sentPrompt });
    if (!f.ok) throw new SceneError(`Không điền lại được prompt: ${f.note}`);
    await sleep(800);
  }
  // Bấm Gửi rồi xác nhận trang đã nhận prompt (ô nhập trống); chưa nhận thì bấm lại một lần
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await send(tabId, { type: 'submit' });
    if (!r.ok) throw new SceneError(`Không gửi được: ${r.note}`);
    log(`${tag}: ${r.note}${attempt > 1 ? ' (lần 2)' : ''}`);
    const end2 = Date.now() + 8000;
    while (Date.now() < end2) {
      await sleep(800);
      const x = await send(tabId, { type: 'status' }).catch(() => null);
      if (!x) continue;
      checkBlocked(x);
      if (!x.composerFilled) return;
    }
    log(`${tag}: đã bấm Gửi nhưng prompt vẫn nằm trong ô nhập`);
  }
  throw new SceneError('Đã bấm Gửi 2 lần nhưng trang không nhận prompt (bấm "Khảo sát trang" để kiểm tra nút Gửi trong selectors.js)');
}

// Lời báo lỗi gửi cho Muse: lấy đúng câu trang hiển thị nếu có
function museErrorText(msg) {
  const m = /Trang báo lỗi: (.+)$/.exec(msg) || /trang hiển thị: "(.+)"/.exec(msg);
  return (m ? m[1] : 'it failed or timed out').slice(0, 300);
}

function buildMuseFixMessage(errMsg, s) {
  const style = (s.claudeStyle || '').trim().replace(/\s*\r?\n\s*/g, ' ') || 'the same as in my original prompt';
  return ((s.museFixTemplate || '').trim() || MUSE_FIX_TEMPLATE)
    .replaceAll('{error}', museErrorText(errMsg))
    .replaceAll('{style}', style)
    .replace(/\s*\r?\n\s*/g, ' ');
}

// Cảnh lỗi sau khi đã gửi → nhắn tiếp trong cùng cuộc trò chuyện để Muse tự sửa prompt và tạo lại.
// Trả về kết quả của monitor() nếu thành công; ném lỗi (lỗi cuối cùng) nếu không áp dụng hoặc vẫn thất bại.
async function museSelfFix(tabId, scene, err, tag) {
  const s = eff();
  const max = Math.max(1, Math.min(3, Math.round(+s.museFixMax || 1)));
  let lastErr = err;
  for (let i = 1; i <= max; i++) {
    const refused = isRefusal(lastErr.message);
    if (s.museFixMode === 'off' || (s.museFixMode === 'refused' && !refused)) throw lastErr;
    // Lỗi kỹ thuật (mất tab, không gửi được…) thì nhắn thêm cũng vô ích
    if (/không phản hồi|Mất kết nối|đã bị đóng|rời khỏi|Không tìm thấy ô nhập|không gửi được|Không gửi được/i.test(lastErr.message)) throw lastErr;
    log(`${tag}: lỗi "${museErrorText(lastErr.message)}" → nhắn Muse tự sửa prompt và tạo tiếp (lần ${i}/${max})`);
    // Tin nhắn sửa là một lượt tạo mới → vẫn giãn cách như bình thường
    state.lastEndAt = Date.now();
    await save();
    await pacing(scene);
    await assertOnMeta(tabId);
    const pre = await send(tabId, { type: 'precheck' }).catch(() => null);
    checkBlocked(pre);
    const msg = buildMuseFixMessage(lastErr.message, s);
    scene.sentPrompt = msg;
    const bw = await send(tabId, { type: 'beginWatch', prompt: msg, exclude: state.knownSrcs });
    if (bw?.base?.length) state.knownSrcs = [...new Set([...state.knownSrcs, ...bw.base])].slice(-1000);
    setActivity(`${tag}: nhắn Muse tự sửa prompt`);
    const f = await send(tabId, { type: 'fillPrompt', text: msg });
    if (!f.ok) throw new SceneError(`Không điền được tin nhắn nhờ Muse tự sửa: ${f.note}`);
    let needAuto = state.mode === 'auto';
    if (!needAuto) {
      await send(tabId, { type: 'highlightSend' }).catch(() => {});
      needAuto = (await waitForUserSubmit(tabId, scene)) === 'switch';
    }
    if (needAuto) await autoSubmit(tabId, tag, s, scene);
    scene.submittedAt = Date.now();
    scene.museFixes = (scene.museFixes || 0) + 1;
    state.genCount++;
    state.threadCount = (state.threadCount || 0) + 1;
    state.reloadCount = (state.reloadCount || 0) + 1;
    await save();
    try {
      const result = await monitor(tabId, scene);
      log(`${tag}: Muse đã tự sửa prompt và tạo xong video`);
      return result;
    } catch (e2) {
      if (!(e2 instanceof SceneError)) throw e2;
      lastErr = e2;
    }
  }
  throw new SceneError(`${lastErr.message} (đã nhờ Muse tự sửa ${max} lần)`);
}

async function monitor(tabId, scene) {
  const deadline = scene.submittedAt + GEN_TIMEOUT_MS;
  let lastSrc = null, stable = 0, videoSince = 0, dlStable = 0, missing = 0, sawActivity = false;
  let last = null;
  while (Date.now() < deadline) {
    checkSkip();
    await sleep(3000);
    noteThread((await assertOnMeta(tabId)).url);
    let st;
    try { st = await send(tabId, { type: 'status' }); } catch {
      if (++missing > 5) throw new SceneError('Mất kết nối với tab muse.ai');
      continue;
    }
    missing = 0;
    if (!st.watching) {
      // Trang tải lại (vd. chuyển URL cuộc trò chuyện): theo dõi lại, trừ các video đã tải ở cảnh trước
      await send(tabId, { type: 'beginWatch', prompt: scene.sentPrompt, baseline: false, submitted: true, exclude: state.knownSrcs });
      log(`c${pad(scene.n)}: trang đã tải lại, theo dõi lại`);
      continue;
    }
    last = st;
    if (st.pageHidden && !scene.warnedHidden) {
      scene.warnedHidden = true;
      log(`c${pad(scene.n)}: tab Muse đang ẩn; tiếp tục theo dõi nền, không chuyển tab hoặc đưa cửa sổ lên.`);
    }
    checkBlocked(st);
    if (st.error && !st.videos.length) throw new SceneError(`Trang báo lỗi: ${st.error}`);
    if (st.generating || st.videos.length || st.tail) sawActivity = true;
    const elapsed = Date.now() - scene.submittedAt;
    if (!sawActivity && elapsed > 40000 && st.composerFilled) throw new SceneError('Đã gửi nhưng trang không phản hồi (prompt vẫn nằm trong ô nhập)');

    let prog;
    if (st.videos.length) prog = { n: scene.n, pct: 99, est: false };
    else if (st.percent != null) prog = { n: scene.n, pct: Math.min(99, st.percent), est: false };
    else prog = { n: scene.n, pct: Math.max(1, Math.min(95, Math.round((elapsed / avgGenMs()) * 100))), est: true };
    setSceneProgress(prog);
    setActivity(`c${pad(scene.n)}: ${st.videos.length ? 'đã thấy video, chờ ổn định' : st.generating ? 'đang tạo video' : 'đang chờ trang'} ${prog.pct}%${prog.est ? ' (ước tính)' : ''} — ${fmtDur(elapsed)} / 6:00${ctl.pause ? ' · sẽ tạm dừng sau cảnh này' : ''}`);

    if (st.videos.length) {
      // Video mới nhất nằm cuối trang (quan trọng khi nhiều cảnh chung một cuộc trò chuyện)
      const v = st.videos[st.videos.length - 1];
      if (v.src === lastSrc) stable++;
      else { lastSrc = v.src; stable = 0; videoSince = Date.now(); }
      if ((!st.generating && stable >= 1) || Date.now() - videoSince > 30000) return { video: v, count: st.videos.length };
    } else if (st.downloadAvailable && !st.generating) {
      if (++dlStable >= 2) return { video: null };
    }
  }
  const hint = last ? last.error || last.tail : '';
  throw new SceneError(`Quá 6 phút chưa xong${hint ? ` — trang hiển thị: "${hint.slice(-200)}"` : ''}`);
}

async function processScene(scene) {
  const s = eff();
  ctl.currentN = scene.n;
  ctl.skip = false;
  ctl.submitted = false;
  scene.status = 'running';
  scene.reason = '';
  scene.startedAt = Date.now();
  setSceneProgress({ n: scene.n, pct: 0, est: true });
  await save();
  render();
  const tag = `c${pad(scene.n)}`;
  let tabId = null;
  let originalAutoDiscardable;

  try {
    const tab = await ensureTab({ activate: state.mode !== 'auto' });
    tabId = tab.id;
    originalAutoDiscardable = tab.autoDiscardable;
    if (originalAutoDiscardable !== false) {
      await chrome.tabs.update(tabId, { autoDiscardable: false });
    }

    const maxPerThread = Math.max(0, Math.round(+s.threadMaxScenes || 0));
    if (s.sameThread && state.threadUrl && !state.threadPinned && maxPerThread > 0 && (state.threadCount || 0) >= maxPerThread) {
      dropThread(`Đã tạo ${state.threadCount} cảnh trong cuộc trò chuyện này`);
    }
    // Tự tải lại trang (F5) sau mỗi N lần tạo
    let reloaded = false;
    const reloadEvery = Math.max(0, Math.round(+s.reloadEvery || 0));
    const reuseThread = s.sameThread && !!state.threadUrl;
    if (reloadEvery > 0 && (state.reloadCount || 0) >= reloadEvery) {
      if (reuseThread) {
        setActivity(`${tag}: tải lại trang (F5)`);
        log(`Đã tạo ${state.reloadCount} lần kể từ lần tải trang gần nhất → tải lại trang (F5)`);
        await chrome.tabs.reload(tabId);
        await sleep(1500);
        await waitTabLoaded(tabId);
        reloaded = true;
      }
      state.reloadCount = 0;   // không dùng lại cuộc trò chuyện → trang sẽ được mở mới, không cần F5
    }

    let navigated = true;
    if (s.sameThread && state.threadUrl) {
      setActivity(`${tag}: gửi tiếp trong cuộc trò chuyện chung`);
      navigated = (await openThread(tabId)) || reloaded;
    } else {
      setActivity(`${tag}: mở cuộc trò chuyện mới`);
      await openNewChat(tabId);
    }
    const pre = await waitReady(tabId);
    log(`${tag}: trang sẵn sàng (${pre.url})`);
    checkSkip();

    // Ở lại cùng trang thì giữ nguyên chế độ video đã chọn (tránh bấm tắt nút chế độ)
    if (navigated) {
      state.reloadCount = 0;
      // Trang vừa tải xong vẫn có thể dựng lại ô nhập — chờ một chút cho ổn định
      await sleep(2000);
      await waitReady(tabId);
      const vm = await send(tabId, { type: 'selectVideoMode' });
      log(`${tag}: chế độ video — ${vm.note}`);
    }
    checkSkip();

    let refs;
    try { refs = MuseReferenceModel.resolve(scene, state.characterLibrary || []); }
    catch (e) { throw Object.assign(new SceneError(e.message), { nonRetryable: true }); }
    refs.sort((a, b) => (a.role === 'storyboard' ? 0 : 1) - (b.role === 'storyboard' ? 0 : 1));
    if (scene.image) refs.unshift({ key: imgKey(scene.n), name: `c${pad(scene.n)}.png`, role: 'storyboard', label: 'scene reference' });
    const attachedRefs = s.attachImages ? refs : [];
    if (attachedRefs.length) {
      const initial = await send(tabId, { type: 'attachmentCount' });
      log(`${tag}: kiểm tra ảnh ô nhập — ${initial?.note || 'không phản hồi'}; đếm=${initial?.count ?? '?'}; ứng viên=${initial?.candidateCount ?? '?'}`);
      if (!initial?.ok || initial.count > 0) {
        throw new Blocked('attachments', 'Ô nhập có ảnh chưa gửi hoặc chưa kiểm tra được. Hàng đợi dừng để tránh lỗi lan sang cảnh khác. Mở tab Muse, kiểm tra/xóa ảnh thừa rồi bấm Tiếp tục.');
      }
      // Check every file before uploading any, to avoid partially attaching a missing set.
      const files = [];
      for (const ref of attachedRefs) {
        const blob = await idb.get(ref.key);
        if (!blob) throw Object.assign(new SceneError(`Thiếu ảnh tham chiếu ${ref.name}; hãy gán lại ảnh.`), { nonRetryable: true });
        if (ref.role === 'storyboard') {
          let check;
          try {check = await MuseFrameQuality.inspectImage(blob);}
          catch(e) {throw Object.assign(new SceneError(`Không kiểm tra được storyboard ${ref.name}: ${e.message}`),{nonRetryable:true});}
          if (!check.ok) throw Object.assign(new SceneError(`Storyboard ${ref.name} không phải ảnh cảnh 16:9 đầy khung hoặc có viền trắng lớn. Hãy xuất lại ảnh một cảnh, không dùng panel kéo dài/ảnh có padding.`), {nonRetryable:true});
        }
        files.push({ ref, blob });
      }
      for (const { ref, blob } of files) {
        checkSkip();
        if (ctl.pause) throw new Interrupt('pause');
        setActivity(`${tag}: đính kèm ${ref.role} — ${ref.label}`);
        const r = await send(tabId, { type: 'attachImage', dataUrl: await blobToDataUrl(blob), name: ref.name });
        if (!r?.ok) throw new Blocked('attachments', `Không xác nhận được ảnh ${ref.name}: ${r?.note || 'không phản hồi'}. Hàng đợi dừng. Kiểm tra ảnh trong ô nhập trước khi tiếp tục.`);
        log(`${tag}: đã đính kèm ${ref.name}`);
      }
      const final = await send(tabId, { type: 'attachmentCount' });
      if (!final?.ok || final.count < initial.count + attachedRefs.length) {
        throw new Blocked('attachments', 'Không còn đủ ảnh tham chiếu trong ô nhập. Chưa gửi prompt; hàng đợi dừng để bạn kiểm tra.');
      }
    }
    checkSkip();
    let prompt = (s.promptPrefix ? `${s.promptPrefix.trim()} ` : '') + scene.prompt;
    if (attachedRefs.length) {
      prompt = prompt.replace(/Generate from this text without image input\.?/gi, '').trim();
      prompt = MuseReferenceModel.instructions(attachedRefs) + prompt;
    }
    scene.sentPrompt = prompt;
    const bw = await send(tabId, { type: 'beginWatch', prompt, exclude: state.knownSrcs });
    if (bw?.base?.length) state.knownSrcs = [...new Set([...state.knownSrcs, ...bw.base])].slice(-1000);
    setActivity(`${tag}: điền prompt`);
    const f = await send(tabId, { type: 'fillPrompt', text: prompt });
    if (!f.ok) throw new SceneError(`Không điền được prompt: ${f.note}`);
    log(`${tag}: ${f.note}`);

    let needAuto = state.mode === 'auto';
    if (!needAuto) {
      const h = await send(tabId, { type: 'highlightSend' });
      log(`${tag}: ${h.found ? `đã tô sáng nút Gửi (${h.note})` : 'không thấy nút Gửi — chờ bạn tự gửi'}`);
      // Trả về 'switch' nếu bạn chuyển sang "Tự động" trong lúc chờ → tự gửi luôn cảnh này
      needAuto = (await waitForUserSubmit(tabId, scene)) === 'switch';
      if (!needAuto) log(`${tag}: đã gửi`);
      else log(`${tag}: đã chuyển sang Tự động — tự gửi cảnh này`);
    }
    if (needAuto) await autoSubmit(tabId, tag, s, scene);

    ctl.submitted = true;
    scene.submittedAt = Date.now();
    state.genCount++;
    state.threadCount = (state.threadCount || 0) + 1;
    state.reloadCount = (state.reloadCount || 0) + 1;
    await save();

    let result;
    try {
      result = await monitor(tabId, scene);
    } catch (e) {
      if (!(e instanceof SceneError)) throw e;
      result = await museSelfFix(tabId, scene, e, tag);
    }
    log(`${tag}: video xong sau ${fmtDur(Date.now() - scene.submittedAt)}${result.count > 1 ? ` (có ${result.count} video mới, lấy video cuối)` : ''}`);
    setActivity(`${tag}: đang tải xuống`);
    await downloadScene(tabId, scene, result);

    scene.status = 'done';
    scene.reason = '';
    scene.genMs = Date.now() - scene.submittedAt;
    log(`${tag}: XONG → ${scene.files[scene.files.length - 1]}`);
  } catch (e) {
    if (e instanceof Blocked) {
      scene.status = e.kind === 'limit' ? 'limit' : 'pending';
      scene.reason = e.kind === 'limit' ? 'Dừng do giới hạn' : `Dừng: ${e.kind === 'captcha' ? 'CAPTCHA/xác minh' : e.kind === 'attachments' ? 'cần kiểm tra ảnh đính kèm' : 'cần đăng nhập'}`;
      state.blocked = { kind: e.kind, message: e.message, n: scene.n };
      log(`${tag}: DỪNG HÀNG ĐỢI — ${e.message}`);
      return 'stop';
    }
    if (e instanceof Interrupt) {
      if (e.kind === 'skip') {
        scene.status = 'skipped';
        scene.reason = 'Người dùng bỏ qua';
        log(`${tag}: bỏ qua`);
        return 'next';
      }
      scene.status = 'pending';
      scene.reason = 'Tạm dừng trước khi gửi';
      throw e;
    }
    scene.status = 'error';
    scene.reason = e.message || String(e);
    scene.errorKind = isRefusal(scene.reason) ? 'refused' : 'other';
    scene.retryable = !e.nonRetryable;
    if (s.sameThread && s.newThreadOnError && !state.threadPinned) dropThread(`${tag}: lỗi`);
    if (scene.autoRetries) scene.reason += ` (đã tự làm lại ${scene.autoRetries} lần)`;
    log(`${tag}: LỖI — ${scene.reason}`);
  } finally {
    if (tabId != null) noteThread((await chrome.tabs.get(tabId).catch(() => null))?.url);
    if (ctl.submitted) state.lastEndAt = Date.now();
    scene.finishedAt = Date.now();
    ctl.currentN = null;
    setSceneProgress(null);
    ctl.skip = false;
    if (tabId != null) {
      await send(tabId, { type: 'stopWatch' }).catch(() => {});
      if (originalAutoDiscardable === true) {
        await chrome.tabs.update(tabId, { autoDiscardable: true }).catch(() => {});
      }
    }
    await save();
    render();
  }
  return 'next';
}

// ---------------------------------------------------------------- vòng lặp

function pickNext() {
  if (state.priority != null) {
    const p = sceneBy(state.priority);
    state.priority = null;
    if (p && p.status === 'pending') return p;
  }
  return state.scenes.find((s) => s.status === 'pending') || null;
}

function counts() {
  const c = { pending: 0, running: 0, done: 0, error: 0, limit: 0, skipped: 0 };
  state.scenes.forEach((s) => c[s.status]++);
  return c;
}

// Lỗi do trang từ chối nội dung — gửi lại y nguyên prompt hầu như chắc chắn bị từ chối tiếp
const isRefusal = (msg) => /violat|polic|guideline|community standards|safety|not allowed|can'?t (help|create|generate)|cannot (help|create|generate)|unable to (create|generate)|vi phạm|chính sách|không thể tạo/i.test(msg || '');

// Tự làm lại các cảnh lỗi của dự án đang mở. Trả về số cảnh được đưa lại vào hàng đợi.
// Prompt cảnh trước / sau (để Claude giữ mạch truyện)
const neighborPrompts = (sc) => {
  const i = state.scenes.indexOf(sc);
  return { prev: state.scenes[i - 1]?.prompt || '', next: state.scenes[i + 1]?.prompt || '' };
};

// Cảnh bị Muse từ chối vì prompt → nhờ Claude sửa (chế độ "gợi ý" hoặc "tự sửa"). Trả về số cảnh đưa lại vào hàng đợi.
async function claudeFixRefused() {
  const s = state.settings;
  if (s.claudeMode === 'off' || typeof claudeFixPrompt !== 'function' || !(await getClaudeKey())) return 0;
  const maxTries = Math.max(1, Math.min(3, Math.round(+s.claudeMaxTries || 1)));
  let requeued = 0;
  for (const sc of state.scenes) {
    if (ctl.pause) break;
    if (sc.status !== 'error' || sc.errorKind !== 'refused') continue;
    if ((sc.claudeTries || 0) >= maxTries) continue;
    if (sc.claude && sc.claude.forPrompt === sc.prompt) continue;   // đã có gợi ý cho đúng prompt này
    sc.claudeTries = (sc.claudeTries || 0) + 1;
    const tag = `c${pad(sc.n)}`;
    const museError = sc.reason;
    setActivity(`${tag}: nhờ Claude sửa prompt bị từ chối…`);
    const r = await claudeFixPrompt({ prompt: sc.prompt, error: museError, style: s.claudeStyle, ...neighborPrompts(sc) });
    if (!r.ok) {
      log(`${tag}: Claude chưa sửa được — ${r.note}`);
      sc.reason = `${museError} · Claude: ${r.note}`;
      if (/API key|quyền|kết nối/.test(r.note)) break;          // lỗi cấu hình: dừng thử các cảnh khác
      continue;
    }
    sc.claude = { prompt: r.prompt, changes: r.changes, feasible: r.feasible, forPrompt: sc.prompt, museError, model: r.model, at: Date.now() };
    if (!r.feasible) {
      sc.reason = `${museError} · Claude: không sửa được mà vẫn giữ nội dung — ${r.changes}`;
      log(`${tag}: Claude cho rằng không sửa được — ${r.changes}`);
    } else if (s.claudeMode === 'auto') {
      if (sc.originalPrompt == null) sc.originalPrompt = sc.prompt;
      sc.prompt = r.prompt;
      sc.status = 'pending';
      sc.reason = `Claude đã sửa prompt: ${r.changes}`;
      requeued++;
      log(`${tag}: Claude đã sửa prompt và đưa lại vào hàng đợi — ${r.changes}`);
    } else {
      sc.reason = `${museError} · Claude đã gợi ý prompt mới — mở cảnh trong dashboard để duyệt`;
      log(`${tag}: Claude đã gợi ý prompt mới (chờ bạn duyệt) — ${r.changes}`);
    }
    await save();
    render();
  }
  return requeued;
}

async function requeueErrors() {
  const fromClaude = await claudeFixRefused();
  const s = state.settings;
  if (!s.autoRetry) return fromClaude;
  const max = Math.max(1, Math.min(5, Math.round(+s.autoRetryMax || 2)));
  const picked = [];
  for (const sc of state.scenes) {
    if (!MuseReferenceModel.shouldRetry(sc, s)) continue;
    if (sc.claude && sc.claude.forPrompt === sc.prompt && s.claudeMode === 'suggest') continue; // chờ bạn duyệt gợi ý của Claude
    sc.autoRetries = (sc.autoRetries || 0) + 1;
    sc.lastError = sc.reason;
    sc.status = 'pending';
    sc.reason = `Tự làm lại lần ${sc.autoRetries}/${max}`;
    picked.push(`c${pad(sc.n)}`);
  }
  if (picked.length) {
    log(`Tự làm lại ${picked.length} cảnh lỗi: ${picked.join(', ')}`);
    save();
    render();
  }
  return picked.length + fromClaude;
}

// Chuyển hàng đợi sang dự án khác (giữ nguyên giãn cách — tính chung mọi dự án)
function switchRunProject(id) {
  loadProject(id);
  state.scenes.forEach((s) => { if (s.status === 'limit') { s.status = 'pending'; s.reason = 'Làm lại sau giới hạn'; } });
  state.finishedSummary = null;
  log(`=== Chuyển sang dự án "${state.episode || 'chưa đặt tên'}" ===`);
  syncInputs();
  updateInfo();
  render();
}

function finish(last = true) {
  tickActive();
  const c = counts();
  state.finishedSummary = { done: c.done, error: c.error, skipped: c.skipped, total: state.scenes.length, ms: state.activeMs };
  log(`HOÀN TẤT: xong ${c.done}, lỗi ${c.error}, bỏ qua ${c.skipped}, tổng thời gian ${fmtDur(state.activeMs)}. Đang tạo tệp ZIP…`);
  setActivity(last ? 'Đã xong toàn bộ danh sách.' : `Xong dự án "${state.episode || 'chưa đặt tên'}" — chuyển sang dự án kế tiếp…`);
  beep('done');
  if (last) setBadge('✓', '#1f8a4c');
}

async function startLoop() {
  if (globalThis.museImportBusy || globalThis.museReviewBusy) { showBanner('warn', 'Đang nhập dữ liệu hoặc kiểm tra video đã lưu, hãy chờ hoàn tất.'); return; }
  if (state.packageImportError) { showBanner('warn', state.packageImportError); return; }
  if (ctl.loop) return;
  if (!navigator.locks) return runLoop();
  await navigator.locks.request('muse-run', { ifAvailable: true }, async (lock) => {
    if (!lock) {
      showBanner('info', 'Hàng đợi đang chạy ở cửa sổ khác (side panel hoặc dashboard).');
      return;
    }
    await runLoop();
  });
}

async function runLoop() {
  if (state.blocked) {
    showBanner('danger', `${state.blocked.message}\n\nBấm "Tiếp tục" khi đã xử lý xong.`);
    return;
  }
  state.scenes.forEach((s) => { if (s.status === 'limit') { s.status = 'pending'; s.reason = 'Làm lại sau giới hạn'; } });
  if (!state.scenes.some((s) => s.status === 'pending' || MuseReferenceModel.shouldRetry(s, state.settings))) {
    const nxt = state.settings.runAllProjects ? nextProjectWithWork() : null;
    if (!nxt) {
      showBanner('info', !state.scenes.length ? 'Dự án này chưa có prompt.' : `Không còn cảnh nào "Chưa làm"${state.projects.length > 1 ? ' trong các dự án' : ''}.`);
      return;
    }
    switchRunProject(nxt.id);
  }
  if (!state.episode.trim()) showBanner('warn', `Chưa nhập Tên tập — video sẽ lưu vào thư mục "${folder()}".`);
  else hideBanner();

  ctl.loop = true;
  ctl.pause = false;
  state.wasRunning = true;
  state.runningSince = Date.now();
  state.finishedSummary = null;
  setBadge('', null);
  log(`Bắt đầu chạy (${state.mode === 'auto' ? 'Tự động' : 'Bán tự động'})`);
  log('Nhịp chờ nền đã bật; không tự đổi tab hoặc xếp lại cửa sổ. Giữ panel/dashboard đang chạy mở.');
  await save();
  render();

  let worked = false;
  try {
    while (true) {
      if (ctl.pause) throw new Interrupt('pause');
      const scene = pickNext();
      if (!scene) {
        if (await requeueErrors()) continue;
        const nxt = state.settings.runAllProjects ? nextProjectWithWork() : null;
        if (worked) {
          finish(!nxt);
          await downloadZip();
        }
        if (!nxt) {
          if (state.projects.length > 1 && state.settings.runAllProjects) log('=== Đã chạy xong tất cả dự án ===');
          break;
        }
        switchRunProject(nxt.id);
        worked = false;
        await save();
        continue;
      }
      await pacing(scene);
      worked = true;
      const r = await processScene(scene);
      if (r === 'stop') {
        showBanner('danger', `${state.blocked.message}\n\nHàng đợi đã dừng. Bấm "Tiếp tục" khi đã xử lý xong.`);
        setActivity('Đã dừng — chờ bạn xử lý.');
        setBadge('!', '#d92d20');
        beep('alert');
        break;
      }
    }
  } catch (e) {
    if (e instanceof Interrupt && e.kind === 'pause') {
      log('Đã tạm dừng');
      setActivity('Đã tạm dừng. Bấm "Tiếp tục" để chạy tiếp.');
    } else if (e instanceof Blocked) {
      state.blocked = { kind: e.kind, message: e.message, n: null };
      showBanner('danger', `${e.message}\n\nHàng đợi đã dừng.`);
      setBadge('!', '#d92d20');
      beep('alert');
    } else {
      console.error(e);
      log(`Lỗi không mong muốn: ${e.message || e}`);
      showBanner('warn', `Lỗi không mong muốn: ${e.message || e}`);
    }
  } finally {
    ctl.loop = false;
    ctl.pause = false;
    tickActive();
    state.runningSince = 0;
    state.wasRunning = false;
    await save();
    render();
  }
}

// ---------------------------------------------------------------- hiển thị

const thumbCache = new Map();
async function setThumb(img, n) {
  const key = imgKey(n);
  let url = thumbCache.get(key);
  if (!url) {
    const b = await idb.get(key).catch(() => null);
    if (!b) return;
    url = URL.createObjectURL(b);
    thumbCache.set(key, url);
  }
  img.src = url;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function renderScenes() {
  if (globalThis.museRenderScenes) return globalThis.museRenderScenes();
  const box = $('scenes');
  const scroll = box.scrollTop;
  box.textContent = '';
  if (!state.scenes.length) {
    box.append(el('div', 'empty', 'Chưa có cảnh nào. Hãy chọn prompts.txt.'));
    return;
  }
  const frag = document.createDocumentFragment();
  for (const sc of state.scenes) {
    const row = el('div', `row${sc.n === ctl.selected ? ' selected' : ''}${sc.n === ctl.currentN ? ' current' : ''}`);
    row.dataset.n = sc.n;
    const th = el('div', sc.image ? 'thumb' : 'thumb none');
    if (sc.image) {
      const img = document.createElement('img');
      img.alt = '';
      setThumb(img, sc.n);
      th.append(img);
    }
    const main = el('div', 'main');
    const pr = el('span', 'prompt', sc.prompt.length > 80 ? `${sc.prompt.slice(0, 80)}…` : sc.prompt);
    pr.title = sc.prompt;
    main.append(pr);
    if (sc.reason) {
      const r = el('small', 'reason', sc.reason);
      r.title = sc.reason;
      main.append(r);
    } else if (sc.status === 'done' && sc.files?.length) {
      main.append(el('small', 'reason', sc.files[sc.files.length - 1]));
    }
    const live = sc.status === 'running' && ctl.progress?.n === sc.n ? ` ${pctLabel(ctl.progress)}` : '';
    const chip = el('span', `chip st-${sc.status}`, STATUS[sc.status] + live);
    if (sc.reason) chip.title = sc.reason;
    row.append(el('span', 'num', `c${pad(sc.n)}`), th, main, chip);
    frag.append(row);
  }
  box.append(frag);
  box.scrollTop = scroll;
}

function etaText() {
  const s = eff();
  const remaining = state.scenes.filter((x) => ['pending', 'running', 'limit'].includes(x.status)).length;
  if (!remaining) return '';
  const gens = state.scenes.filter((x) => x.genMs).map((x) => x.genMs);
  const avgGen = gens.length ? gens.reduce((a, b) => a + b, 0) / gens.length : 150000;
  const avgDelay = ((s.delayMin + s.delayMax) / 2) * 1000;
  const avgPause = ((s.pauseMin + s.pauseMax) / 2) * 1000;
  const pauses = Math.floor((state.genCount + remaining) / s.batch) - Math.floor(state.genCount / s.batch);
  const ms = remaining * (avgGen + avgDelay + 20000) + pauses * avgPause;
  return `Còn khoảng ${fmtDur(ms)}${gens.length ? '' : ' (ước tính)'}`;
}

function renderProgress() {
  const c = counts();
  const total = state.scenes.length;
  const fin = c.done + c.error + c.skipped;
  const part = ctl.progress && sceneBy(ctl.progress.n)?.status === 'running' ? ctl.progress.pct / 100 : 0;
  $('bar').style.width = total ? `${((fin + part) / total) * 100}%` : '0';
  $('progText').textContent = total ? `${fin}/${total} · Xong ${c.done} · Lỗi ${c.error} · Bỏ qua ${c.skipped}` : '';
  $('etaText').textContent = etaText();
}

function renderSummary() {
  const box = $('summary');
  const f = state.finishedSummary;
  if (!f) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '';
  box.append(el('h2', null, 'Tổng kết'));
  const stats = el('div', 'stats');
  for (const [label, val] of [['Xong', f.done], ['Lỗi', f.error], ['Bỏ qua', f.skipped], ['Tổng thời gian', fmtDur(f.ms)]]) {
    const d = el('div');
    d.append(el('b', null, String(val)), el('span', 'muted small', label));
    stats.append(d);
  }
  box.append(stats);
  if (f.done) {
    const b = el('button', 'primary zip', zipping ? 'Đang tạo ZIP…' : `Tải ${folder()}.zip (${f.done} video)`);
    b.disabled = zipping;
    b.addEventListener('click', downloadZip);
    box.append(b);
  }
}

function renderThreadInfo() {
  const on = state.settings.sameThread;
  $('threadInfo').textContent = !on
    ? 'Mỗi cảnh một cuộc trò chuyện mới.'
    : state.threadUrl
      ? `${state.threadPinned ? '📌 ' : ''}Cuộc trò chuyện: ${state.threadUrl.replace(/^https:\/\/(www\.)?(muse\.ai\/)?/, '')} · ${state.threadCount || 0}${+state.settings.threadMaxScenes > 0 && !state.threadPinned ? `/${state.settings.threadMaxScenes}` : ''} cảnh${state.threadPinned ? ' (đã ghim)' : ''}`
      : 'Cuộc trò chuyện chung: sẽ tạo mới ở cảnh kế tiếp.';
  $('newThreadBtn').hidden = !on;
  $('newThreadBtn').disabled = !state.threadUrl;
  $('threadInfo').title = state.threadUrl || '';
}

function renderControls() {
  const busy = isBusy();
  $('runBtn').disabled = busy;
  $('pauseBtn').disabled = !busy || ctl.pause;
  $('resumeBtn').disabled = busy;
  const sel = selScene();
  $('retryBtn').disabled = !sel || sel.status === 'running';
  $('skipBtn').disabled = !sel || sel.status === 'done' || sel.status === 'skipped';
  $('selInfo').textContent = sel ? `Đã chọn c${pad(sel.n)}` : 'Bấm vào một cảnh để chọn';
  $('promptsFile').disabled = busy;
  $('imagesDir').disabled = busy;
  $('resetBtn').disabled = busy;
  document.body.classList.toggle('busy', busy);
  $('zipBtn').disabled = zipping;
  $('zipBtn').textContent = zipping ? 'Đang tạo ZIP…' : 'Tải ZIP tất cả video';
  $('zipBtn').title = `Tệp tải về: ${folder()}.zip (đặt theo Tên dự án)`;
  $('modeHint').textContent = state.mode === 'auto'
    ? `Tự động: điền prompt xong, đếm ngược ${state.settings.autoSendDelay || 5} giây rồi tự bấm Gửi (bạn vẫn có thể tự bấm trước).`
    : 'Bán tự động: extension điền sẵn mọi thứ và tô sáng nút Gửi — bạn tự bấm Gửi.';
}

function renderProjects() {
  const box = $('projects');
  if (!box) return;
  const busy = isBusy();
  box.replaceChildren(...state.projects.map((p, i) => {
    const sc = projScenes(p);
    const c = { done: 0, error: 0, pending: 0 };
    sc.forEach((s) => { if (s.status === 'done') c.done++; else if (s.status === 'error' || s.status === 'limit') c.error++; else if (s.status === 'pending' || s.status === 'running') c.pending++; });
    const active = p.id === state.pid;
    const running = active && busy;
    const st = running ? ['Đang chạy', 'st-running'] : !sc.length ? ['Trống', 'st-pending'] : c.pending ? ['Chờ', 'st-pending'] : ['Xong', 'st-done'];
    const row = el('button', `prow${active ? ' active' : ''}`);
    row.type = 'button';
    row.dataset.id = p.id;
    row.title = active ? 'Dự án đang mở' : busy ? 'Đang chạy — tạm dừng để mở dự án khác' : 'Bấm để mở dự án này';
    const name = el('span', 'pname', `${i + 1}. ${projName(p)}`);
    const meta = el('span', 'pmeta', sc.length ? `${c.done}/${sc.length} xong${c.error ? ` · ${c.error} lỗi` : ''}` : 'chưa có prompt');
    row.append(name, meta, el('span', `chip ${st[1]}`, st[0]));
    return row;
  }));
  $('projUpBtn').disabled = busy || state.projects[0]?.id === state.pid;
  $('projDownBtn').disabled = busy || state.projects[state.projects.length - 1]?.id === state.pid;
  $('newProjectBtn').disabled = busy;
  $('delProjectBtn').disabled = busy;
  $('pasteBtn').disabled = busy;
  $('setRunAll').checked = !!state.settings.runAllProjects;
}

async function selectProject(id) {
  if (id === state.pid) return;
  if (isBusy()) { showBanner('info', 'Đang chạy — hãy Tạm dừng trước khi mở dự án khác.'); return; }
  loadProject(id);
  hideBanner();
  log(`Mở dự án "${state.episode || 'chưa đặt tên'}"`);
  await save();
  syncInputs();
  updateInfo();
  render();
}

async function newProject() {
  if (isBusy()) return;
  const p = emptyProject(`Dự án ${state.projects.length + 1}`);
  syncActiveProject();
  state.projects.push(p);
  await selectProject(p.id);
  showBanner('info', `Đã tạo "${p.episode}". Đổi "Tên tập" nếu muốn, rồi nạp prompts.txt hoặc bấm "Dán prompt…".`);
}

async function deleteProject() {
  if (isBusy()) return;
  const name = state.episode || 'chưa đặt tên';
  const ok = await askChoice(`Xóa hẳn dự án "${name}" (prompt, ảnh, video, tiến độ)?`, [
    { value: true, label: 'Xóa dự án', primary: true },
    { value: false, label: 'Hủy' }
  ]);
  if (!ok) return;
  if (!(await confirmDropVideos(`Xóa dự án "${name}"`))) return;
  await idb.delPrefix(`${state.pid}:`).catch(() => {});
  await idb.delPrefix(vidPrefix(), 'videos').catch(() => {});
  const i = state.projects.findIndex((p) => p.id === state.pid);
  state.projects.splice(i, 1);
  if (!state.projects.length) state.projects.push(emptyProject('Dự án 1'));
  const next = state.projects[Math.min(i, state.projects.length - 1)];
  state.pid = null;                 // không đồng bộ ngược vào dự án đã xóa
  loadProject(next.id);
  log(`Đã xóa dự án "${name}"`);
  await save();
  syncInputs();
  updateInfo();
  render();
}

async function moveProject(dir) {
  if (isBusy()) return;
  const i = state.projects.findIndex((p) => p.id === state.pid);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.projects.length) return;
  [state.projects[i], state.projects[j]] = [state.projects[j], state.projects[i]];
  await save();
  renderProjects();
}

async function useExistingThread() {
  let cur = '';
  try {
    const t = await findMetaTab();
    if (t?.url && THREAD_RE.test(t.url)) cur = t.url.split(/[?#]/)[0];
  } catch { /* chưa có tab muse.ai */ }
  const v = await askText('Dán link cuộc trò chuyện Muse muốn làm tiếp (dạng https://muse.ai/thread/…). Đã điền sẵn chat đang mở ở tab muse.ai nếu có.', cur || state.threadUrl || '', 2);
  if (v == null) return;
  const url = v.trim().split(/[?#\s]/)[0];
  if (!/^https:\/\/(www\.)?muse\.ai\/thread\//.test(url) || !THREAD_RE.test(url)) {
    showBanner('warn', 'Link không hợp lệ. Mở cuộc trò chuyện trên muse.ai rồi chép link trên thanh địa chỉ (dạng https://muse.ai/thread/…).');
    return;
  }
  await act('pinThread', { url });
}

function askText(message, initial = '', rows = 14) {
  return new Promise((resolve) => {
    $('modalText').textContent = message;
    const ta = document.createElement('textarea');
    ta.className = 'modal-ta';
    ta.rows = rows;
    ta.spellcheck = false;
    ta.value = initial;
    $('modalText').after(ta);
    const box = $('modalBtns');
    box.textContent = '';
    const close = (v) => { ta.remove(); $('modal').hidden = true; resolve(v); };
    const ok = el('button', 'primary', rows <= 3 ? 'Dùng' : 'Lưu danh sách');
    ok.onclick = () => close(ta.value);
    const cancel = el('button', null, 'Hủy');
    cancel.onclick = () => close(null);
    box.append(ok, cancel);
    $('modal').hidden = false;
    ta.focus();
  });
}

function render() {
  renderProjects();
  renderControls();
  renderProgress();
  renderScenes();
  renderSummary();
  renderThreadInfo();
  globalThis.museAfterRender?.();   // dashboard: lưới cảnh, thống kê, biểu đồ
}

function renderSettings() {
  const s = state.settings;
  $('setDelayMin').value = s.delayMin;
  $('setDelayMax').value = s.delayMax;
  $('setBatch').value = s.batch;
  $('setPauseMin').value = s.pauseMin;
  $('setPauseMax').value = s.pauseMax;
  $('setRegen').value = s.regenPolicy;
  $('setPrefix').value = s.promptPrefix;
  $('setAttach').checked = !!s.attachImages;
  $('setAutoSend').value = s.autoSendDelay;
  $('setSameThread').checked = !!s.sameThread;
  $('setThreadMax').value = s.threadMaxScenes;
  $('setReloadEvery').value = s.reloadEvery;
  $('setClaudeMode').value = s.claudeMode;
  $('setMuseFix').value = s.museFixMode;
  $('setMuseFixMax').value = s.museFixMax;
  $('setMuseFixMax').disabled = s.museFixMode === 'off';
  if (document.activeElement !== $('setMuseFixTemplate')) $('setMuseFixTemplate').value = s.museFixTemplate || MUSE_FIX_TEMPLATE;
  if (document.activeElement !== $('setClaudeStyle')) $('setClaudeStyle').value = s.claudeStyle || '';
  $('setNewThreadOnError').checked = !!s.newThreadOnError;
  $('setThreadMax').disabled = !s.sameThread;
  $('setNewThreadOnError').disabled = !s.sameThread;
  $('setAutoRetry').checked = !!s.autoRetry;
  $('setAutoRetryMax').value = s.autoRetryMax;
  $('setAutoRetryRefused').checked = !!s.autoRetryRefused;
  $('setAutoRetryMax').disabled = !s.autoRetry;
  $('setAutoRetryRefused').disabled = !s.autoRetry;
}

// ---------------------------------------------------------------- nạp dữ liệu

function applyImageKeys() {
  const keys = new Set(state.imageKeys);
  state.scenes.forEach((s) => { s.image = keys.has(s.n); });
}

// Trước khi xóa video trong bộ nhớ: hỏi, cho phép tải ZIP trước. Trả về false nếu người dùng hủy.
async function confirmDropVideos(action) {
  const n = (await idb.keysPrefix(vidPrefix(), 'videos').catch(() => [])).length;
  if (!n) return true;
  const choice = await askChoice(`${action} sẽ xóa ${n} video đang lưu trong bộ nhớ (chưa chắc đã tải ZIP).`, [
    { value: 'zip', label: 'Tải ZIP trước rồi tiếp tục', primary: true },
    { value: 'drop', label: 'Xóa luôn' },
    { value: null, label: 'Hủy' }
  ]);
  if (!choice) return false;
  if (choice === 'zip') await downloadZip();
  return true;
}

const onPromptsFile = async (file) => loadPromptsText(await file.text(), file.name);

async function pastePrompts() {
  if (isBusy()) return;
  const cur = state.scenes.map((s) => s.prompt).join('\n');
  const text = await askText(`Dán prompt cho dự án "${state.episode || 'chưa đặt tên'}" — mỗi dòng là một cảnh (dòng 1 = c01).`, cur);
  if (text == null || text.trim() === cur.trim()) return;
  await loadPromptsText(text, '(dán trực tiếp)');
}

// Mỗi dòng có chữ là một prompt; dòng trống bị bỏ qua
function parsePrompts(raw) {
  const lines = String(raw).replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.trim());
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return { prompts: lines.filter(Boolean), blanks: lines.filter((l) => !l).length };
}

// Làm tiếp dự án: thêm cảnh vào CUỐI danh sách (giữ nguyên cảnh, video, cuộc trò chuyện đã có)
async function appendPrompts(raw, name) {
  const { prompts } = parsePrompts(raw);
  if (!prompts.length) { showBanner('warn', 'Không có prompt nào để thêm.'); return; }
  await act('appendScenes', { prompts, name });
}

async function appendPastePrompts() {
  const last = state.scenes.length ? Math.max(...state.scenes.map((s) => s.n)) : 0;
  const text = await askText(`Thêm cảnh vào cuối dự án "${state.episode || 'chưa đặt tên'}" — mỗi dòng là một cảnh, bắt đầu từ c${String(last + 1).padStart(2, '0')}. Các cảnh và video đã có được giữ nguyên.`, '');
  if (text == null) return;
  await appendPrompts(text, '(dán thêm)');
}

async function loadPromptsText(raw, name) {
  const { prompts, blanks } = parsePrompts(raw);
  if (!prompts.length) { showBanner('warn', 'Tệp không có prompt nào.'); return; }
  if (!(await confirmDropVideos('Nạp danh sách mới'))) return;
  if (state.scenes.some((s) => s.status !== 'pending')) {
    const ok = await askChoice('Nạp danh sách mới sẽ xóa tiến độ hiện tại. Tiếp tục?', [
      { value: true, label: 'Nạp danh sách mới', primary: true },
      { value: false, label: 'Hủy' }
    ]);
    if (!ok) return;
  }
  // Danh sách mới = tập mới: cuộc trò chuyện mới, xóa bản sao video của tập cũ
  state.threadUrl = null;
  state.threadPinned = false;
  state.knownSrcs = [];
  await idb.delPrefix(vidPrefix(), 'videos').catch(() => {});
  state.scenes = prompts.map((p, i) => ({ n: i + 1, prompt: p, image: false, status: 'pending', reason: '', versions: 0, files: [] }));
  state.promptsName = name;
  state.activeMs = 0;
  state.finishedSummary = null;
  state.priority = null;
  ctl.selected = null;
  applyImageKeys();
  log(`Dự án "${state.episode || 'chưa đặt tên'}": đã nạp ${prompts.length} prompt từ ${name}${blanks ? ` (bỏ qua ${blanks} dòng trống)` : ''}`);
  if (blanks) showBanner('warn', `Có ${blanks} dòng trống ở giữa tệp đã bị bỏ qua — số cảnh được đánh liên tục theo các dòng có nội dung.`);
  await save();
  updateInfo();
  render();
  return true;
}

async function storeSceneReference(scene, file, role, label) {
  const key = `${state.pid}:ref:${scene.n}:${role}:${encodeURIComponent(file.name)}`;
  await idb.put(key, file);
  scene.references ||= [];
  const ref = { key, role, label, name: file.name };
  const i = scene.references.findIndex(r => r.key === key);
  if (i >= 0) scene.references[i] = ref; else scene.references.push(ref);
}

async function onImagesFolder(files) {
  if (isBusy()) { showBanner('warn', 'Tạm dừng hàng đợi trước khi gán ảnh.'); return; }
  let referencesAdded = 0, unmatched = 0;
  for (const file of files) {
    const ref = MuseReferenceModel.parseName(file.name);
    if (!ref) continue;
    const scene = sceneBy(ref.n);
    if (!scene) { unmatched++; continue; }
    await storeSceneReference(scene, file, ref.role, ref.label);
    referencesAdded++;
  }
  if (referencesAdded) log(`Đã gán ${referencesAdded} ảnh nhân vật/storyboard theo số cảnh.`);
  if (unmatched) showBanner('warn', `${unmatched} ảnh chưa có cảnh tương ứng. Nạp prompt trước rồi nhập lại ảnh.`);
  const imgs = [...files]
    .map((f) => ({ f, m: f.name.match(/^c0*(\d+)\.(png|jpe?g|webp)$/i) }))
    .filter((x) => x.m);
  thumbCache.forEach((u) => URL.revokeObjectURL(u));
  thumbCache.clear();
  const keys = new Set(state.imageKeys || []);
  for (const { f, m } of imgs) {
    const n = parseInt(m[1], 10);
    await idb.put(imgKey(n), f);
    keys.add(n);
  }
  state.imageKeys = [...keys].sort((a, b) => a - b);
  applyImageKeys();
  log(`Đã nạp ${imgs.length} ảnh khung đầu (dự án có tổng ${state.imageKeys.length} ảnh)`);
  await save();
  updateInfo();
  render();
}

function updateInfo() {
  $('promptsInfo').textContent = state.scenes.length ? `${state.promptsName || 'prompts.txt'} — ${state.scenes.length} cảnh` : 'Chưa chọn';
  const matched = state.scenes.filter((s) => s.image).length;
  const refCount = state.scenes.reduce((n, sc) => n + (sc.references?.length || 0), 0);
  $('imagesInfo').textContent = refCount ? `${refCount} ảnh nhân vật/storyboard · ${state.imageKeys.length} ảnh khung đầu` : state.imageKeys.length
    ? `${state.imageKeys.length} ảnh · khớp ${matched}/${state.scenes.length} cảnh`
    : 'Không bắt buộc (c01.png, c02.png…)';
}

// ---------------------------------------------------------------- lệnh của người dùng (chạy ở trang đang giữ hàng đợi)

async function runningElsewhere() {
  if (ctl.loop || !navigator.locks) return false;
  try {
    const q = await Promise.race([navigator.locks.query(), sleep(1000).then(() => null)]);
    return !!q && q.held.some((l) => l.name === 'muse-run');
  } catch { return false; }
}

const actions = {
  setEpisode(v) {
    state.episode = v;
    save();
    renderProjects();
  },
  setMode(m) {
    if (state.mode === m) return;
    state.mode = m;
    log(`Chế độ: ${m === 'auto' ? 'Tự động (áp dụng ngay)' : `Bán tự động${ctl.loop ? ' (áp dụng từ cảnh sau)' : ''}`}`);
    save();
    syncInputs();
    renderControls();
  },
  setSettings(p) {
    Object.assign(state.settings, p);
    const e = eff();
    Object.assign(state.settings, { delayMin: e.delayMin, delayMax: e.delayMax, pauseMin: e.pauseMin, pauseMax: e.pauseMax, batch: e.batch });
    state.settings.autoSendDelay = Math.min(120, Math.max(1, Math.round(+state.settings.autoSendDelay || 5)));
    state.settings.autoRetryMax = Math.min(5, Math.max(1, Math.round(+state.settings.autoRetryMax || 2)));
    state.settings.threadMaxScenes = Math.min(50, Math.max(0, Math.round(+state.settings.threadMaxScenes || 0)));
    state.settings.reloadEvery = Math.min(100, Math.max(0, Math.round(+state.settings.reloadEvery || 0)));
    if ('sameThread' in p) log(p.sameThread ? 'Bật: dùng chung một cuộc trò chuyện' : 'Tắt: mỗi cảnh một cuộc trò chuyện mới');
    save();
    renderSettings();
    renderProgress();
    renderControls();
    renderThreadInfo();
  },
  start() { startLoop(); },
  pause() {
    if (!ctl.loop) return;
    ctl.pause = true;
    setActivity(ctl.submitted && ctl.currentN != null ? 'Sẽ tạm dừng sau khi cảnh hiện tại xong…' : 'Đang tạm dừng…');
    renderControls();
  },
  resume() {
    if (state.blocked) {
      log(`Người dùng bấm Tiếp tục sau: ${state.blocked.message.split('\n')[0]}`);
      state.blocked = null;
      hideBanner();
      setBadge('', null);
    }
    startLoop();
  },
  newThread() {
    state.threadUrl = null;
    state.threadCount = 0;
    state.threadPinned = false;
    log('Cảnh kế tiếp sẽ mở cuộc trò chuyện mới và dùng chung từ đó');
    save();
    renderThreadInfo();
  },
  retry({ n, pol }) {
    const sc = sceneBy(n);
    if (!sc || sc.n === ctl.currentN) return;
    sc.nextSuffix = '';
    sc.overwrite = false;
    if (sc.versions > 0) {
      if (pol === 'keep') sc.nextSuffix = `_v${sc.versions + 1}`;
      else sc.overwrite = true;
    }
    sc.status = 'pending';
    sc.reason = 'Làm lại';
    sc.autoRetries = 0;
    state.priority = sc.n;
    log(`c${pad(sc.n)}: đưa lên đầu hàng đợi để làm lại${sc.nextSuffix ? ` (${sc.nextSuffix})` : sc.overwrite ? ' (ghi đè)' : ''}`);
    save();
    render();
    if (!ctl.loop && !state.blocked) startLoop();
  },
  skip({ n }) {
    const sc = sceneBy(n);
    if (!sc || sc.status === 'done' || sc.status === 'skipped') return;
    if (sc.n === ctl.currentN) {
      ctl.skip = true;
      setActivity(`Đang bỏ qua c${pad(sc.n)}…`);
      return;
    }
    sc.status = 'skipped';
    sc.reason = 'Người dùng bỏ qua';
    log(`c${pad(sc.n)}: bỏ qua`);
    save();
    render();
  },
  pinThread({ url }) {
    state.threadUrl = url;
    state.threadCount = 0;
    state.threadPinned = true;
    if (!state.settings.sameThread) {
      state.settings.sameThread = true;
      renderSettings();
    }
    log(`Làm tiếp trong cuộc trò chuyện có sẵn: ${url} (đã ghim — không tự đổi sang chat mới)`);
    save();
    renderThreadInfo();
    showBanner('info', `Các cảnh kế tiếp của dự án "${state.episode || 'chưa đặt tên'}" sẽ được gửi vào cuộc trò chuyện này. Bấm "Cuộc trò chuyện mới" để bỏ ghim.`);
  },
  useClaude({ n }) {
    const sc = sceneBy(n);
    if (!sc || !sc.claude || sc.n === ctl.currentN) return;
    if (sc.originalPrompt == null) sc.originalPrompt = sc.prompt;
    sc.prompt = sc.claude.prompt;
    log(`c${pad(sc.n)}: dùng prompt Claude gợi ý`);
    actions.retry({ n, pol: sc.versions > 0 ? 'keep' : null });
  },
  restorePrompt({ n }) {
    const sc = sceneBy(n);
    if (!sc || sc.originalPrompt == null || sc.n === ctl.currentN) return;
    sc.prompt = sc.originalPrompt;
    sc.originalPrompt = null;
    log(`c${pad(sc.n)}: khôi phục prompt gốc`);
    save();
    render();
  },
  setClaude({ n, claude }) {
    const sc = sceneBy(n);
    if (!sc) return;
    sc.claude = claude;
    save();
    render();
  },
  appendScenes({ prompts, name }) {
    let n = state.scenes.length ? Math.max(...state.scenes.map((s) => s.n)) : 0;
    const first = n + 1;
    for (const p of prompts) {
      n++;
      state.scenes.push({ n, prompt: p, image: false, status: 'pending', reason: 'Cảnh thêm mới', versions: 0, files: [] });
    }
    applyImageKeys();
    state.finishedSummary = null;
    log(`Dự án "${state.episode || 'chưa đặt tên'}": thêm ${prompts.length} cảnh (c${pad(first)}–c${pad(n)}) từ ${name}${ctl.loop ? ' — hàng đợi sẽ làm tiếp' : ''}`);
    save();
    updateInfo();
    render();
    if (!ctl.loop) showBanner('info', `Đã thêm ${prompts.length} cảnh (c${pad(first)}–c${pad(n)}). Bấm "Tiếp tục" hoặc "Chạy tự động" để làm tiếp.`);
  },
  editPrompt({ n, text }) {
    const sc = sceneBy(n);
    const t = String(text || '').replace(/\s*\r?\n\s*/g, ' ').trim();
    if (!sc || !t || sc.n === ctl.currentN || sc.prompt === t) return;
    sc.prompt = t;
    log(`c${pad(sc.n)}: đã sửa prompt`);
    save();
    render();
  }
};

// Gọi một lệnh: nếu hàng đợi đang chạy ở cửa sổ khác thì chuyển lệnh sang đó.
async function act(name, args) {
  if (globalThis.museImportBusy || globalThis.museReviewBusy) { showBanner('warn', 'Đang nhập dữ liệu hoặc kiểm tra video đã lưu, hãy chờ hoàn tất.'); return; }
  if (await runningElsewhere()) {
    chan.postMessage({ type: 'cmd', name, args });
    return;
  }
  return actions[name](args);
}

chan.onmessage = (e) => {
  const m = e.data || {};
  if (m.type === 'cmd' && ctl.loop && actions[m.name]) actions[m.name](m.args);
  else if (m.type === 'activity' && !ctl.loop) $('activity').textContent = m.text;
  else if (m.type === 'progress' && !ctl.loop) { ctl.progress = m.p; renderLiveProgress(); }
};

// Trang không chạy hàng đợi: nhận trạng thái mới từ trang đang chạy (hoặc trang kia khi cả hai rảnh).
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local' || !ch.museState) return;
  const nv = ch.museState.newValue;
  if (!nv || nv.writer === PAGE_ID || ctl.loop) return;
  if (nv.pid !== state.pid || JSON.stringify(nv.imageKeys) !== JSON.stringify(state.imageKeys)) {
    thumbCache.forEach((u) => URL.revokeObjectURL(u));
    thumbCache.clear();
  }
  state = Object.assign(defaultState(), nv);
  state.settings = Object.assign(defaultSettings(), state.settings || {});
  syncInputs();
  updateInfo();
  $('log').textContent = state.log.slice().reverse().join('\n');
  if (state.blocked) showBanner('danger', `${state.blocked.message}\n\nBấm "Tiếp tục" khi đã xử lý xong.`);
  render();
});

async function refreshRemote() {
  const r = await runningElsewhere();
  if (r !== remoteRunning) {
    remoteRunning = r;
    renderControls();
  }
}

// Đưa giá trị trong state lên các ô nhập (bỏ qua ô bạn đang gõ).
function syncInputs() {
  if (document.activeElement !== $('episode')) $('episode').value = state.episode;
  document.querySelectorAll('input[name="mode"]').forEach((r) => { r.checked = r.value === state.mode; });
  if (!document.activeElement?.closest?.('#settingsBox')) renderSettings();
}

// ---------------------------------------------------------------- nút trên danh sách cảnh

async function retrySelected() {
  const sc = selScene();
  if (!sc || sc.status === 'running') return;
  let pol = null;
  if (sc.versions > 0) {
    pol = state.settings.regenPolicy;
    if (pol === 'ask') {
      pol = await askChoice(`Cảnh c${pad(sc.n)} đã có video. Khi tạo lại:`, [
        { value: 'keep', label: `Giữ cả hai (_v${sc.versions + 1})`, primary: true },
        { value: 'overwrite', label: 'Ghi đè bản cũ' },
        { value: null, label: 'Hủy' }
      ]);
    }
    if (!pol) return;
  }
  act('retry', { n: sc.n, pol });
}

function skipSelected() {
  const sc = selScene();
  if (sc) act('skip', { n: sc.n });
}

const openDashboard = () => openPage('app/app.html');
const openEditor = () => openPage('editor/editor.html');

// Mở trang của extension trong cửa sổ riêng; nếu đã mở thì đưa lên trước.
async function openPage(path) {
  const url = chrome.runtime.getURL(path);
  try {
    const ctx = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] });
    if (ctx.length) {
      await chrome.tabs.update(ctx[0].tabId, { active: true });
      await chrome.windows.update(ctx[0].windowId, { focused: true });
      return;
    }
  } catch { /* Chrome cũ: mở mới */ }
  await chrome.windows.create({ url, type: 'popup', width: 1360, height: 900 });
}

async function exportErrors() {
  const errs = state.scenes.filter((s) => s.status === 'error' || s.status === 'limit');
  if (!errs.length) { showBanner('info', 'Không có cảnh lỗi nào.'); return; }
  const lines = [
    '# Muse Auto — danh sách cảnh lỗi',
    `# Tập: ${state.episode || '(chưa đặt)'}`,
    `# Xuất lúc: ${new Date().toLocaleString('vi-VN')}`,
    '# Cảnh\tTrạng thái\tLý do\tPrompt',
    ...errs.map((s) => `c${pad(s.n)}\t${STATUS[s.status]}\t${(s.reason || '').replace(/\s+/g, ' ')}\t${s.prompt}`)
  ];
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/plain;charset=utf-8' }));
  try {
    await downloadNamed(url, `${folder()}/canh_loi.txt`);
    log(`Đã xuất ${errs.length} cảnh lỗi → ${folder()}/canh_loi.txt`);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

async function runSurvey() {
  $('surveyBtn').disabled = true;
  try {
    const tab = await ensureTab();
    await waitTabLoaded(tab.id);
    const r = await send(tab.id, { type: 'survey' });
    $('surveyOut').textContent = r.report;
    $('surveyOut').hidden = false;
    $('copySurveyBtn').hidden = false;
    log('Đã khảo sát trang (các phần tử tìm được được đánh dấu xanh trên trang trong 15 giây)');
  } catch (e) {
    showBanner('warn', `Không khảo sát được: ${e.message || e}`);
  } finally {
    $('surveyBtn').disabled = false;
  }
}

async function resetAll() {
  const ok = await askChoice(`Xóa danh sách cảnh, ảnh, video và tiến độ của dự án "${state.episode || 'chưa đặt tên'}"? (Các dự án khác và cài đặt giữ nguyên.)`, [
    { value: true, label: 'Xóa', primary: true },
    { value: false, label: 'Hủy' }
  ]);
  if (!ok) return;
  if (!(await confirmDropVideos('Xóa dữ liệu'))) return;
  await idb.delPrefix(`${state.pid}:`).catch(() => {});
  await idb.delPrefix(vidPrefix(), 'videos').catch(() => {});
  const blank = emptyProject(state.episode);
  for (const f of PROJECT_FIELDS) if (f !== 'episode') state[f] = blank[f];
  thumbCache.forEach((u) => URL.revokeObjectURL(u));
  thumbCache.clear();
  ctl.selected = null;
  hideBanner();
  setBadge('', null);
  log(`Đã xóa dữ liệu của dự án "${state.episode || 'chưa đặt tên'}"`);
  await save();
  updateInfo();
  render();
}

// ---------------------------------------------------------------- khởi động

function bindUI() {
  $('episode').addEventListener('input', () => act('setEpisode', $('episode').value));
  $('promptsFile').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) onPromptsFile(f); e.target.value = ''; });
  $('imagesDir').addEventListener('change', (e) => { if (e.target.files.length) onImagesFolder(e.target.files); e.target.value = ''; });

  document.querySelectorAll('input[name="mode"]').forEach((r) => {
    r.checked = r.value === state.mode;
    r.addEventListener('change', () => act('setMode', r.value));
  });

  const numFields = { setDelayMin: 'delayMin', setDelayMax: 'delayMax', setBatch: 'batch', setPauseMin: 'pauseMin', setPauseMax: 'pauseMax', setAutoSend: 'autoSendDelay' };
  for (const [id, key] of Object.entries(numFields)) {
    $(id).addEventListener('change', () => act('setSettings', { [key]: +$(id).value }));
  }
  $('setRegen').addEventListener('change', () => act('setSettings', { regenPolicy: $('setRegen').value }));
  $('setPrefix').addEventListener('change', () => act('setSettings', { promptPrefix: $('setPrefix').value }));
  $('setAttach').addEventListener('change', () => act('setSettings', { attachImages: $('setAttach').checked }));
  $('setSameThread').addEventListener('change', () => act('setSettings', { sameThread: $('setSameThread').checked }));
  $('setMuseFix').addEventListener('change', () => act('setSettings', { museFixMode: $('setMuseFix').value }));
  $('setMuseFixMax').addEventListener('change', () => act('setSettings', { museFixMax: Math.max(1, Math.min(3, Math.round(+$('setMuseFixMax').value || 1))) }));
  $('setMuseFixTemplate').addEventListener('change', () => {
    const v = $('setMuseFixTemplate').value.trim();
    act('setSettings', { museFixTemplate: v === MUSE_FIX_TEMPLATE ? '' : v });
  });
  $('museFixResetBtn').addEventListener('click', () => { $('setMuseFixTemplate').value = MUSE_FIX_TEMPLATE; act('setSettings', { museFixTemplate: '' }); });
  $('setClaudeMode').addEventListener('change', () => act('setSettings', { claudeMode: $('setClaudeMode').value }));
  $('setClaudeStyle').addEventListener('change', () => act('setSettings', { claudeStyle: $('setClaudeStyle').value }));
  // API key chỉ lưu trên máy này (chrome.storage.local), không nằm trong dữ liệu dự án
  getClaudeKey().then((k) => { $('claudeKey').placeholder = k ? `Đã lưu (…${k.slice(-4)}) — nhập để thay` : 'sk-ant-…'; });
  $('claudeKey').addEventListener('change', async () => {
    const k = $('claudeKey').value.trim();
    await chrome.storage.local.set({ claudeApiKey: k });
    $('claudeKey').value = '';
    $('claudeKey').placeholder = k ? `Đã lưu (…${k.slice(-4)}) — nhập để thay` : 'sk-ant-…';
    $('claudeKeyStatus').textContent = k ? 'Đã lưu key. Bấm "Kiểm tra" để thử.' : 'Đã xóa key — Claude bị tắt.';
  });
  $('claudeTestBtn').addEventListener('click', async () => {
    $('claudeKeyStatus').textContent = 'Đang kiểm tra…';
    const r = await claudeTestKey();
    $('claudeKeyStatus').textContent = (r.ok ? '✔ ' : '✖ ') + r.note;
  });
  $('setReloadEvery').addEventListener('change', () => act('setSettings', { reloadEvery: +$('setReloadEvery').value }));
  $('setThreadMax').addEventListener('change', () => act('setSettings', { threadMaxScenes: +$('setThreadMax').value }));
  $('setNewThreadOnError').addEventListener('change', () => act('setSettings', { newThreadOnError: $('setNewThreadOnError').checked }));
  $('setAutoRetry').addEventListener('change', () => act('setSettings', { autoRetry: $('setAutoRetry').checked }));
  $('setAutoRetryMax').addEventListener('change', () => act('setSettings', { autoRetryMax: +$('setAutoRetryMax').value }));
  $('setAutoRetryRefused').addEventListener('change', () => act('setSettings', { autoRetryRefused: $('setAutoRetryRefused').checked }));
  $('newThreadBtn').addEventListener('click', () => act('newThread'));
  $('useThreadBtn').addEventListener('click', useExistingThread);
  $('zipBtn').addEventListener('click', downloadZip);

  $('runBtn').addEventListener('click', () => act('start'));
  $('pauseBtn').addEventListener('click', () => act('pause'));
  $('resumeBtn').addEventListener('click', () => act('resume'));

  $('scenes').addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const n = +row.dataset.n;
    ctl.selected = ctl.selected === n ? null : n;
    renderScenes();
    renderControls();
  });
  $('retryBtn').addEventListener('click', retrySelected);
  $('skipBtn').addEventListener('click', skipSelected);
  $('exportBtn').addEventListener('click', exportErrors);
  $('surveyBtn').addEventListener('click', runSurvey);
  $('copySurveyBtn').addEventListener('click', () => navigator.clipboard.writeText($('surveyOut').textContent).then(() => log('Đã sao chép báo cáo khảo sát')));
  $('resetBtn').addEventListener('click', resetAll);
  $('bannerClose').addEventListener('click', hideBanner);
  $('openAppBtn')?.addEventListener('click', openDashboard);
  $('projects').addEventListener('click', (e) => { const r = e.target.closest('.prow'); if (r) selectProject(r.dataset.id); });
  $('newProjectBtn').addEventListener('click', newProject);
  $('delProjectBtn').addEventListener('click', deleteProject);
  $('projUpBtn').addEventListener('click', () => moveProject(-1));
  $('projDownBtn').addEventListener('click', () => moveProject(1));
  $('pasteBtn').addEventListener('click', pastePrompts);
  $('appendBtn').addEventListener('click', appendPastePrompts);
  $('appendFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) await appendPrompts(await f.text(), f.name);
  });
  $('setRunAll').addEventListener('change', () => act('setSettings', { runAllProjects: $('setRunAll').checked }));
  $('openEditorBtn')?.addEventListener('click', openEditor);
  $('tileBtn')?.addEventListener('click', async () => {
    const t = await ensureTab({ activate: true }).catch((e) => { showBanner('warn', e.message); return null; });
    if (t) await tileWindows(t.windowId).catch((e) => showBanner('warn', `Không xếp được cửa sổ: ${e.message}`));
  });
}

// Bản cũ chỉ có một tập: chuyển nó (kèm ảnh/video trong IndexedDB) thành dự án đầu tiên.
async function migrateProjects() {
  if (Array.isArray(state.projects) && state.projects.some((p) => p.id === state.pid)) return;
  const p = emptyProject();
  for (const f of PROJECT_FIELDS) if (state[f] !== undefined) p[f] = state[f];
  if (!p.episode) p.episode = 'Dự án 1';
  state.projects = [p];
  state.pid = p.id;
  state.episode = p.episode;
  try {
    for (const k of await idb.keys('images')) {
      if (typeof k === 'number') { await idb.put(`${p.id}:${k}`, await idb.get(k)); await idb.del(k); }
    }
    for (const k of await idb.keys('videos')) {
      if (!String(k).includes('/')) { await idb.put(`${p.id}/${k}`, await idb.get(k, 'videos'), 'videos'); await idb.del(k, 'videos'); }
    }
  } catch (e) { console.error(e); }
  log(`Đã chuyển dữ liệu hiện có thành dự án "${p.episode}"`);
}

async function init() {
  const saved = (await chrome.storage.local.get('museState')).museState;
  state = Object.assign(defaultState(), saved || {});
  state.settings = Object.assign(defaultSettings(), state.settings || {});
  if (!Array.isArray(state.knownSrcs)) state.knownSrcs = [];
  remoteRunning = await runningElsewhere();

  if (!remoteRunning) await migrateProjects();

  // Phiên trước bị gián đoạn (đóng Chrome / đóng cửa sổ khi đang chạy).
  // Bỏ qua nếu một cửa sổ khác đang chạy hàng đợi — khi đó nó mới là nguồn dữ liệu đúng.
  let interrupted = false;
  if (!remoteRunning) {
    interrupted = state.wasRunning || state.scenes.some((s) => s.status === 'running');
    state.scenes.forEach((s) => {
      if (s.status === 'running') { s.status = 'pending'; s.reason = 'Bị gián đoạn — sẽ làm lại'; }
    });
    state.runningSince = 0;
    state.wasRunning = false;
  }
  // Xin trình duyệt không tự xóa bản sao video (dùng để đóng ZIP) khi thiếu dung lượng
  navigator.storage?.persist?.().catch(() => {});

  $('episode').value = state.episode;
  renderSettings();
  bindUI();
  updateInfo();
  $('log').textContent = state.log.slice().reverse().join('\n');

  if (state.blocked) {
    showBanner('danger', `${state.blocked.message}\n\nBấm "Tiếp tục" khi đã xử lý xong.`);
  } else if (interrupted) {
    const next = state.scenes.find((s) => s.status === 'pending');
    showBanner('info', `Phiên trước dừng giữa chừng.${next ? ` Bấm "Tiếp tục" để chạy tiếp từ cảnh c${pad(next.n)}.` : ''}`);
  } else if (remoteRunning) {
    showBanner('info', 'Hàng đợi đang chạy ở cửa sổ khác — trang này hiển thị và điều khiển cùng hàng đợi đó.');
  }
  if (!remoteRunning) await save();
  render();
  setInterval(refreshRemote, 1500);
}

init();
