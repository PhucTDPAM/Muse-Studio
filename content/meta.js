/* Muse Auto — content script chạy trong tab muse.ai.
 * Chỉ thao tác DOM của trang theo lệnh từ side panel; không gửi dữ liệu đi đâu cả.
 * Không bao giờ giải CAPTCHA, không đăng nhập, không chạm vào mật khẩu.
 */
(() => {
  if (globalThis.__museAutoLoaded) return;
  globalThis.__museAutoLoaded = true;

  const S = globalThis.MUSE_SELECTORS;
  const P = S.patterns;
  const sleep = globalThis.MuseBackgroundTiming.sleep;
  const norm = (s) => String(s || '').replace(/[ ​]/g, ' ').replace(/\s+/g, ' ').trim();

  // ---------------------------------------------------------------- tìm phần tử

  const ROLE_CSS = {
    button: 'button,[role="button"],input[type="submit"],input[type="button"]',
    link: 'a[href],[role="link"]',
    tab: '[role="tab"]',
    menuitem: '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]',
    option: '[role="option"]',
    radio: '[role="radio"],input[type="radio"]',
    switch: '[role="switch"]',
    textbox: '[role="textbox"],textarea'
  };
  const roleCss = (roles) =>
    roles.split(',').map((r) => ROLE_CSS[r.trim()] || `[role="${r.trim()}"]`).join(',');

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity || '1') > 0.05;
  }

  function accName(el) {
    if (!el) return '';
    const label = el.getAttribute('aria-label');
    if (label && norm(label)) return norm(label);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' ');
      if (norm(t)) return norm(t);
    }
    const title = el.getAttribute('title');
    if (title && norm(title)) return norm(title);
    return norm(el.innerText || el.value || '').slice(0, 120);
  }

  function runStrategy(st, root) {
    let els = [];
    if (st.css) els = [...root.querySelectorAll(st.css)];
    else if (st.role) els = [...root.querySelectorAll(roleCss(st.role))].filter((e) => st.name.test(accName(e)));
    else if (st.text) {
      els = [...root.querySelectorAll(st.tags || 'button,a,span,div,p,li,h1,h2,h3')].filter((e) => {
        const t = e.innerText || '';
        return t.length > 0 && t.length < 300 && st.text.test(t);
      });
      els = els.filter((e) => !els.some((o) => o !== e && e.contains(o)));
    }
    if (!st.hidden) els = els.filter(isVisible);
    return els.filter((e) => !e.closest('.muse-auto-ui'));
  }

  function findAll(key, root = document) {
    for (const st of S[key] || []) {
      let els = [];
      try { els = runStrategy(st, root); } catch (e) { /* selector hỏng — bỏ qua */ }
      if (els.length) return { els, st };
    }
    return { els: [], st: null };
  }
  const find = (key, root) => findAll(key, root || document).els[0] || null;

  // Tìm phần tử gần một "mốc" (leo dần lên tổ tiên).
  function findNear(key, anchor, levels = 8, fallback = true) {
    let node = anchor ? anchor.parentElement : null;
    for (let i = 0; node && i < levels; i++, node = node.parentElement) {
      const el = find(key, node);
      if (el && el !== anchor) return el;
    }
    return fallback ? find(key) : null;
  }

  function describe(el) {
    if (!el) return '(không có)';
    const tag = el.tagName.toLowerCase();
    const bits = [tag];
    const role = el.getAttribute('role');
    if (role) bits.push(`[role=${role}]`);
    const tid = el.getAttribute('data-testid');
    if (tid) bits.push(`[data-testid=${tid}]`);
    const al = el.getAttribute('aria-label');
    if (al) bits.push(`[aria-label="${al}"]`);
    if (tag === 'input') bits.push(`[type=${el.type}]${el.accept ? `[accept=${el.accept}]` : ''}`);
    if (tag === 'video') {
      const r = el.getBoundingClientRect();
      bits.push(` ${Math.round(r.width)}x${Math.round(r.height)}px${isResultVideo(el) ? ' [kết quả]' : ' [bỏ qua: nhỏ/ảnh đại diện]'} src=${(srcOf(el) || '').slice(0, 80)}`);
    }
    if (tag === 'iframe') bits.push(` src=${(el.src || '').slice(0, 80)}`);
    const txt = norm(el.innerText || '').slice(0, 60);
    if (txt && txt !== al) bits.push(` "${txt}"`);
    if (!isVisible(el)) bits.push(' (ẩn)');
    return bits.join('');
  }

  function isActive(el) {
    for (const a of S.activeStateAttrs || []) {
      const v = (el.getAttribute(a) || '').toLowerCase();
      if (v && v !== 'false' && v !== 'off' && v !== 'inactive' && v !== 'closed' && v !== 'unchecked') return true;
    }
    return false;
  }

  const isDisabled = (b) => b.disabled || b.getAttribute('aria-disabled') === 'true';
  const srcOf = (v) => v.currentSrc || v.src || v.querySelector('source')?.src || '';
  const readBox = (box) =>
    !box ? '' : box.tagName === 'TEXTAREA' || box.tagName === 'INPUT' ? box.value : box.innerText;

  function matchFirst(list, text) {
    if (!text) return null;
    for (const re of list || []) {
      const m = re.exec(text);
      if (m) {
        const s = text.lastIndexOf('\n', m.index) + 1;
        let e = text.indexOf('\n', m.index);
        if (e < 0) e = text.length;
        return norm(text.slice(s, e)).slice(0, 300) || m[0];
      }
    }
    return null;
  }

  const messageText = () => findAll('messageAreas').els.filter((e) => !inExcluded(e)).map((e) => e.innerText || '').join('\n');

  // ---------------------------------------------------------------- giao diện phụ trên trang

  function ensureStyle() {
    if (document.getElementById('muse-auto-style')) return;
    const st = document.createElement('style');
    st.id = 'muse-auto-style';
    st.textContent = `
      .muse-auto-send{outline:4px solid #ff2d55!important;outline-offset:3px!important;animation:museAutoPulse 1s ease-in-out infinite!important}
      @keyframes museAutoPulse{0%,100%{box-shadow:0 0 0 0 rgba(255,45,85,.75)}50%{box-shadow:0 0 0 12px rgba(255,45,85,0)}}
      .muse-auto-mark{outline:3px dashed #0a84ff!important;outline-offset:2px!important}
      .muse-auto-tag{position:fixed;z-index:2147483647;background:#0a84ff;color:#fff;font:600 11px/1.3 system-ui,sans-serif;padding:2px 6px;border-radius:4px;pointer-events:none}
      .muse-auto-hint{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#1d1d1f;color:#fff;font:600 14px/1.4 system-ui,sans-serif;padding:10px 16px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35);pointer-events:none;max-width:90vw;text-align:center}`;
    document.documentElement.append(st);
  }

  function showHint(text) {
    ensureStyle();
    let h = document.getElementById('muse-auto-hint');
    if (!h) {
      h = document.createElement('div');
      h.id = 'muse-auto-hint';
      h.className = 'muse-auto-hint muse-auto-ui';
      document.documentElement.append(h);
    }
    h.textContent = text;
  }

  function clearHighlight() {
    document.querySelectorAll('.muse-auto-send').forEach((e) => e.classList.remove('muse-auto-send'));
    document.getElementById('muse-auto-hint')?.remove();
  }

  function clearSurvey() {
    document.querySelectorAll('.muse-auto-mark').forEach((e) => e.classList.remove('muse-auto-mark'));
    document.querySelectorAll('.muse-auto-tag').forEach((e) => e.remove());
  }

  function tagElement(el, label) {
    ensureStyle();
    el.classList.add('muse-auto-mark');
    const r = el.getBoundingClientRect();
    const t = document.createElement('div');
    t.className = 'muse-auto-tag muse-auto-ui';
    t.textContent = label;
    t.style.left = `${Math.max(0, r.left)}px`;
    t.style.top = `${Math.max(0, r.top - 18)}px`;
    document.documentElement.append(t);
  }

  // ---------------------------------------------------------------- theo dõi một lượt tạo

  const watch = {
    active: false,
    prompt: '',
    baseSrcs: new Set(),
    roots: [],
    rootSet: new Set(),
    observer: null,
    submitted: false,
    submittedBy: '',
    filled: false,
    sendBtn: null
  };

  function pushRoot(el) {
    if (!el || el.closest?.('.muse-auto-ui') || watch.rootSet.has(el)) return;
    watch.rootSet.add(el);
    watch.roots.push(el);
    if (watch.roots.length > 600) watch.rootSet.delete(watch.roots.shift());
  }

  function markSubmitted(by) {
    if (watch.submitted) return;
    watch.submitted = true;
    watch.submittedBy = by;
    clearHighlight();
  }

  function onClickCapture(e) {
    if (!watch.active || watch.submitted || !e.isTrusted) return;
    const t = e.target;
    if (watch.sendBtn && watch.sendBtn.contains(t)) return markSubmitted('user');
    const b = t.closest?.(ROLE_CSS.button);
    if (b && P.sendName.test(accName(b))) markSubmitted('user');
  }

  function onKeyCapture(e) {
    if (!watch.active || watch.submitted || !e.isTrusted) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      const box = find('composer');
      if (box && box.contains(e.target)) markSubmitted('user');
    }
  }

  function beginWatch({ prompt, baseline = true, submitted = false, exclude = [] }) {
    stopWatch();
    watch.active = true;
    watch.prompt = prompt || '';
    // exclude: video của các cảnh trước (cùng cuộc trò chuyện) — không bao giờ coi là video mới
    watch.baseSrcs = new Set(exclude);
    if (baseline) document.querySelectorAll('video').forEach((v) => srcOf(v) && watch.baseSrcs.add(srcOf(v)));
    watch.roots = [];
    watch.rootSet = new Set();
    watch.submitted = submitted;
    watch.submittedBy = submitted ? 'unknown' : '';
    watch.filled = submitted;
    watch.sendBtn = null;
    watch.observer = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'childList') m.addedNodes.forEach((n) => pushRoot(n.nodeType === 1 ? n : n.parentElement));
        else if (m.type === 'characterData') pushRoot(m.target.parentElement);
      }
    });
    watch.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener('click', onClickCapture, true);
    document.addEventListener('keydown', onKeyCapture, true);
    return { ok: true, base: [...watch.baseSrcs].filter((x) => /^https?:/i.test(x)) };
  }

  function stopWatch() {
    watch.observer?.disconnect();
    watch.observer = null;
    watch.active = false;
    document.removeEventListener('click', onClickCapture, true);
    document.removeEventListener('keydown', onKeyCapture, true);
  }

  // Văn bản mới xuất hiện từ lúc bắt đầu theo dõi (trừ ô nhập và chính prompt).
  // Phần tử có nằm trong vùng bị loại trừ (thanh bên, lịch sử…) không
  function inExcluded(el) {
    for (const st of S.scanExclude || []) {
      try { if (st.css && el.closest(st.css)) return true; } catch { /* selector hỏng */ }
    }
    return false;
  }

  // Lấy chữ của el nhưng chỉ những đoạn nằm trong cột hội thoại và không thuộc vùng bị loại trừ
  function columnText(el, col, cache) {
    const out = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.nodeValue;
      if (!t || !t.trim()) continue;
      const p = n.parentElement;
      if (!p || p.closest('.muse-auto-ui')) continue;
      let ok = cache.get(p);
      if (ok === undefined) {
        ok = !inExcluded(p);
        if (ok) {
          const r = p.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) ok = false;          // không hiển thị
          else if (col) {
            const cx = r.left + r.width / 2;
            ok = cx >= col.left && cx <= col.right;
          }
        }
        cache.set(p, ok);
      }
      if (ok) out.push(t);
    }
    return out.join('\n');
  }

  function chatColumn(box) {
    if (!box) return null;
    const r = box.getBoundingClientRect();
    if (!r.width) return null;
    const m = S.chatColumnMargin ?? 60;
    return { left: r.left - m, right: r.right + m };
  }

  function newContentText() {
    const box = find('composer');
    const col = chatColumn(box);
    const cache = new Map();
    const kept = [];
    for (const el of watch.roots) {
      if (!el.isConnected) continue;
      if (box && box.contains(el)) continue;
      if (kept.some((k) => k.contains(el))) continue;
      for (let i = kept.length - 1; i >= 0; i--) if (el.contains(kept[i])) kept.splice(i, 1);
      kept.push(el);
    }
    let text = kept
      .map((el) => columnText(el, col, cache))
      .filter((t) => t.length < 20000)
      .join('\n');
    if (watch.prompt) {
      text = text.split(watch.prompt).join(' ');
      const np = norm(watch.prompt);
      if (np) text = text.split('\n').map((l) => norm(l) === np ? '' : l).join('\n');
    }
    return text;
  }

  // Có phải video kết quả không: đủ lớn và không nằm trong vùng ảnh đại diện / đầu trang
  function isResultVideo(v) {
    if (v.closest('.muse-auto-ui')) return false;
    for (const st of S.videoExclude || []) {
      try { if (st.css && v.closest(st.css)) return false; } catch { /* selector hỏng */ }
    }
    const r = v.getBoundingClientRect();
    const min = S.resultVideoMinSize || 140;
    return r.width >= min && r.height >= min * 0.5;
  }

  const newVideoEls = () =>
    [...document.querySelectorAll('video')].filter((v) => srcOf(v) && !watch.baseSrcs.has(srcOf(v)) && isResultVideo(v));

  function newVideos() {
    return newVideoEls().map((v) => ({ src: srcOf(v), w: v.videoWidth, h: v.videoHeight, duration: v.duration || 0 }));
  }

  function lastNewVideoEl() {
    const vids = newVideoEls();
    return vids[vids.length - 1] || null;
  }

  // Bỏ các dòng chỉ là thông tin sử dụng (vd "Weekly limit resets on Oct 23", "100% used")
  function withoutInfoLines(text) {
    const info = P.limitInfo || [];
    // Dòng vừa có thông tin vừa có từ "bị chặn" (vd "You've hit your weekly limit. It resets on Oct 22") thì GIỮ lại
    const blocking = /(reached|\bhit\b|exceeded|used up|run out|try again|out of|đạt|vượt quá|hết)/i;
    return String(text || '').split('\n').filter((l) => !(info.some((re) => re.test(l)) && !blocking.test(l))).join('\n');
  }

  function blockState(text) {
    const box = find('composer');
    const captchaEl = find('captchaFrame');
    return {
      captcha: captchaEl ? 'Phát hiện khung CAPTCHA/xác minh trên trang' : matchFirst(P.captcha, text),
      // Nút Đăng nhập + không có ô nhập chỉ được panel kết luận sau 30 giây (trang có thể đang tải).
      login: matchFirst(P.login, text),
      limit: matchFirst(P.limit, withoutInfoLines(text)),
      composer: !!box,
      loginButton: !!find('loginButton')
    };
  }

  // % tiến độ do trang hiển thị: ưu tiên thanh tiến độ, sau đó chữ "45%" trong nội dung mới
  function readPercent(scan, generating) {
    for (const pb of findAll('progress').els) {
      const v = parseFloat(pb.getAttribute('aria-valuenow') ?? pb.value);
      const min = parseFloat(pb.getAttribute('aria-valuemin') || '0');
      const max = parseFloat(pb.getAttribute('aria-valuemax') ?? pb.max ?? '100') || 100;
      if (Number.isFinite(v) && max > min) return Math.max(0, Math.min(100, Math.round(((v - min) / (max - min)) * 100)));
    }
    if (!generating || !P.percent) return null;
    const re = new RegExp(P.percent.source, 'g');
    const all = [...scan.matchAll(re)].map((m) => parseFloat(m[1].replace(',', '.'))).filter((x) => x >= 0 && x <= 100);
    return all.length ? Math.round(all[all.length - 1]) : null;
  }

  function status() {
    const scan = watch.active ? newContentText() : '';
    const both = `${scan}\n${messageText()}`;
    const box = find('composer');
    const boxText = norm(readBox(box));
    const genEl = find('generating');
    const genText = matchFirst(P.generating, scan);
    if (watch.active && !watch.submitted && watch.filled && box && !boxText &&
        (genText || (genEl && norm(scan)) || newVideos().length)) markSubmitted('detected');
    const videos = newVideos();
    let downloadAvailable = false;
    if (videos.length) downloadAvailable = !!findNear('downloadButton', lastNewVideoEl(), 8, false);
    else
      downloadAvailable = watch.roots.slice(-40).some((r) => r.isConnected && r.nodeType === 1 && !!find('downloadButton', r));
    return {
      ok: true,
      url: location.href,
      watching: watch.active,
      submitted: watch.submitted,
      submittedBy: watch.submittedBy,
      generating: !!(genEl || genText),
      generatingHint: genText || (genEl ? describe(genEl) : ''),
      videos,
      downloadAvailable,
      error: matchFirst(P.error, both),
      composerFilled: !!boxText,
      percent: readPercent(scan, !!(genEl || genText)),
      pageHidden: document.hidden,
      tail: norm(scan).slice(-300),
      ...blockState(both)
    };
  }

  // ---------------------------------------------------------------- hành động

  function newChat() {
    const btn = find('newChat');
    if (!btn) return { ok: true, clicked: false };
    btn.click();
    return { ok: true, clicked: true, note: describe(btn) };
  }

  async function selectVideoMode() {
    let btn = find('videoMode');
    if (!btn) {
      const menu = find('modeMenu');
      if (menu) {
        menu.click();
        await sleep(800);
        btn = find('videoMode');
        if (!btn) {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          return { ok: false, found: false, note: `Đã mở menu "${accName(menu)}" nhưng không thấy mục Video` };
        }
      }
    }
    if (!btn) return { ok: false, found: false, note: 'Không thấy nút chế độ video (có thể trang không cần chuyển chế độ)' };
    if (isActive(btn)) return { ok: true, found: true, already: true, note: `Đã ở chế độ video: ${describe(btn)}` };
    btn.click();
    await sleep(900);
    return { ok: true, found: true, note: `Đã bấm ${describe(btn)}` };
  }

  function selectAllIn(box) {
    box.focus();
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(box);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function clearEditable(box) {
    selectAllIn(box);
    document.execCommand('delete', false);
    if (norm(box.innerText)) {
      selectAllIn(box);
      box.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true }));
    }
  }

  async function fillPrompt(text) {
    const box = find('composer');
    if (!box) return { ok: false, note: 'Không tìm thấy ô nhập prompt' };
    box.scrollIntoView({ block: 'center' });
    box.focus();
    box.click();
    const want = norm(text);
    const okNow = () => norm(readBox(box)) === want;
    let method = '';

    if (box.tagName === 'TEXTAREA' || box.tagName === 'INPUT') {
      const proto = box.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(box, text);
      box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      box.dispatchEvent(new Event('change', { bubbles: true }));
      method = 'textarea value + input event';
    } else {
      // 1) execCommand insertText — trình soạn thảo (Lexical/Draft/ProseMirror) nhận như gõ phím
      clearEditable(box);
      document.execCommand('insertText', false, text);
      method = 'execCommand insertText';
      await sleep(300);
      // 2) dán (paste) văn bản
      if (!okNow()) {
        clearEditable(box);
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        method = 'paste event';
        await sleep(300);
      }
      // 3) beforeinput
      if (!okNow()) {
        clearEditable(box);
        box.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, cancelable: true }));
        method = 'beforeinput event';
        await sleep(300);
      }
    }
    await sleep(400);
    const got = norm(readBox(box));
    const ok = got === want;
    if (ok) watch.filled = true;
    return {
      ok,
      method,
      note: ok ? `Đã điền đủ ${want.length} ký tự (${method})` : `Văn bản trong ô không khớp (có ${got.length}/${want.length} ký tự)`
    };
  }

  // Track only previews proven to belong to this composer, never nearby chat media.
  const confirmedUploads = new WeakMap();
  function attachmentSnapshot() {
    const box = find('composer');
    if (!box) return {ok:false,count:0,candidates:[],note:'Không thấy ô nhập'};
    const maxHeight = Math.max(480, (globalThis.innerHeight || 900) * 0.6);
    let scope = null;
    // Pick the SMALLEST ancestor that contains composer controls. Never accept
    // a full-page form merely because the textbox happens to be inside it.
    for (let root = box.parentElement, depth = 0; root && depth < 7; root = root.parentElement, depth++) {
      if (root === document.body || root === document.documentElement) break;
      const rect = root.getBoundingClientRect();
      if (rect.height > maxHeight || root.querySelector('video,nav,aside,[role="log"],[data-message-id],[data-testid="conversation-messages"]')) break;
      if (findAll('sendButton', root).els.length || findAll('attachButton', root).els.length) {scope = root; break;}
    }
    if (!scope) return {ok:false,count:0,candidates:[],note:'Chưa khoanh vùng được ô soạn tin và nút đính kèm'};
    // Upload trays may be a sibling of the input row; expand only if the
    // bounded parent contains explicit attachment-removal controls.
    for(let parent=scope.parentElement,depth=0;parent&&depth<2;parent=parent.parentElement,depth++) {
      if(parent===document.body||parent===document.documentElement)break;
      if(parent.getBoundingClientRect().height>maxHeight||parent.querySelector('video,nav,aside,[role="log"],[data-message-id],[data-testid="conversation-messages"]'))break;
      if(findAll('attachmentRemove',parent).els.length&&findAll('attachmentPreview',parent).els.length)scope=parent;
    }
    const candidates = findAll('attachmentPreview', scope).els.filter(img => {
      if (img.closest('article,[data-message-id],[data-testid*="message"],[role="log"]')) return false;
      const r = img.getBoundingClientRect();
      return r.width >= 32 && r.height >= 32;
    });
    const hasRemove = img => {
      for (let root=img.parentElement,depth=0;root&&root!==scope&&depth<4;root=root.parentElement,depth++) {
        if(findAll('attachmentRemove',root).els.length)return true;
      }
      return false;
    };
    const pending = candidates.filter(img => confirmedUploads.get(img) === img.getAttribute('src') || hasRemove(img));
    return {ok:true,count:pending.length,candidates,pending,note:`composer=${scope.tagName}; candidates=${candidates.length}; confirmed=${pending.length}`};
  }
  function countPreviews() { return attachmentSnapshot().count; }
  function attachmentReport() {
    const snap = attachmentSnapshot();
    return {ok:snap.ok,count:snap.count,candidateCount:snap.candidates.length,note:snap.note};
  }
  async function waitPreview(before, ms = 10000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const snap = attachmentSnapshot();
      if (snap.ok) {
        const added = snap.candidates.filter(img => !before.images.has(img) || before.images.get(img) !== img.getAttribute('src'));
        for(const img of added)confirmedUploads.set(img,img.getAttribute('src'));
        if (added.length && attachmentSnapshot().count > before.count) return true;
      }
      await sleep(400);
    }
    return false;
  }

  async function attachImage({ dataUrl, name }) {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], name || 'start.png', { type: blob.type || 'image/png' });
    const box = find('composer');
    const snapshot = attachmentSnapshot();
    if (!snapshot.ok) return {ok:false,note:snapshot.note};
    const before = {count:snapshot.count,images:new Map(snapshot.candidates.map(img=>[img,img.getAttribute('src')]))};
    const tried = [];

    let input = box ? findNear('fileInput', box, 10) : find('fileInput');
    if (!input) {
      // Một số giao diện chỉ tạo <input type=file> sau khi bấm nút đính kèm.
      // Không có thao tác người dùng nên trình duyệt sẽ không mở hộp chọn tệp.
      const btn = box ? findNear('attachButton', box, 10) : find('attachButton');
      if (btn) {
        btn.click();
        await sleep(700);
        input = find('fileInput');
        tried.push(`bấm ${describe(btn)}`);
      }
    }
    if (input) {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      tried.push('gán vào input[type=file]');
      if (await waitPreview(before)) return { ok: true, method: 'input[type=file]', note: 'Đã đính kèm qua input[type=file]' };
    }

    const target = box ? box.closest('form') || box.parentElement || box : document.body;
    {
      const dt = new DataTransfer();
      dt.items.add(file);
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      }
      tried.push('kéo-thả');
      if (await waitPreview(before, 6000)) return { ok: true, method: 'drop', note: 'Đã đính kèm bằng kéo-thả' };
    }
    if (box) {
      box.focus();
      const dt = new DataTransfer();
      dt.items.add(file);
      box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      tried.push('dán');
      if (await waitPreview(before, 6000)) return { ok: true, method: 'paste', note: 'Đã đính kèm bằng dán' };
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { ok: false, note: `Không thấy ảnh xem trước sau khi thử: ${tried.join(', ')}` };
  }

  function highlightSend() {
    const box = find('composer');
    const btn = findNear('sendButton', box);
    if (!btn) {
      if (box) { ensureStyle(); box.classList.add('muse-auto-send'); }
      showHint('Muse Auto: không tìm thấy nút Gửi — hãy kiểm tra prompt rồi tự gửi (Enter).');
      return { ok: true, found: false };
    }
    ensureStyle();
    watch.sendBtn = btn;
    btn.classList.add('muse-auto-send');
    btn.scrollIntoView({ block: 'center' });
    showHint('Muse Auto: kiểm tra prompt rồi bấm nút Gửi đang nhấp nháy.');
    return { ok: true, found: true, note: describe(btn) };
  }

  async function submit() {
    const box = find('composer');
    const btn = findNear('sendButton', box);
    if (btn) {
      for (let i = 0; i < 30 && isDisabled(btn); i++) await sleep(500);
      if (isDisabled(btn)) return { ok: false, note: 'Nút Gửi vẫn bị vô hiệu sau 15 giây' };
      clearHighlight();
      watch.sendBtn = btn;
      btn.click();
      markSubmitted('extension');
      return { ok: true, note: `Đã bấm ${describe(btn)}` };
    }
    if (box) {
      box.focus();
      const ev = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
      box.dispatchEvent(new KeyboardEvent('keydown', ev));
      box.dispatchEvent(new KeyboardEvent('keyup', ev));
      markSubmitted('extension');
      return { ok: true, note: 'Không thấy nút Gửi — đã nhấn Enter trong ô nhập' };
    }
    return { ok: false, note: 'Không tìm thấy ô nhập lẫn nút Gửi' };
  }

  async function blobToDataUrl(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  async function fetchBlob(url) {
    const r = await fetch(url);
    const b = await r.blob();
    if (b.size < 1024) return { ok: false, note: `Tệp quá nhỏ (${b.size} byte) — có thể là luồng MediaSource` };
    return { ok: true, dataUrl: await blobToDataUrl(b), type: b.type, size: b.size };
  }

  async function clickDownload() {
    const video = lastNewVideoEl();
    const anchor = video || watch.roots.filter((r) => r.isConnected).slice(-1)[0] || null;
    let btn = anchor ? findNear('downloadButton', anchor, 8, false) : null;
    if (!btn && video) {
      // Hiện thanh điều khiển khi rê chuột
      for (const t of ['pointerover', 'mouseover', 'mouseenter', 'mousemove']) video.dispatchEvent(new MouseEvent(t, { bubbles: true }));
      await sleep(600);
      btn = findNear('downloadButton', video, 8, false);
    }
    if (!btn && anchor) {
      const more = findNear('moreOptions', anchor, 8, false);
      if (more) {
        more.click();
        await sleep(700);
        btn = find('downloadButton');
      }
    }
    if (!btn) return { ok: false, note: 'Không tìm thấy nút Tải xuống gần video' };
    btn.click();
    return { ok: true, note: `Đã bấm ${describe(btn)}` };
  }

  function survey() {
    clearSurvey();
    const keys = Object.keys(S).filter(
      (k) => Array.isArray(S[k]) && S[k].length && typeof S[k][0] === 'object' && !(S[k][0] instanceof RegExp)
    );
    const lines = [`URL: ${location.href}`, `selectors.js: ${S.version}`, `Thời điểm: ${new Date().toLocaleString('vi-VN')}`, ''];
    for (const k of keys) {
      const { els, st } = findAll(k);
      lines.push(`■ ${k}: ${els.length ? `${els.length} phần tử (chiến lược #${S[k].indexOf(st) + 1})` : 'KHÔNG TÌM THẤY'}`);
      els.slice(0, 4).forEach((el) => {
        lines.push(`    - ${describe(el)}`);
        if (isVisible(el)) tagElement(el, k);
      });
    }
    const bs = blockState(messageText());
    lines.push('', `Trạng thái chặn: CAPTCHA=${bs.captcha || 'không'} | Đăng nhập=${bs.login || 'không'} | Giới hạn=${bs.limit || 'không'}`);

    const inv = (title, css, max = 60) => {
      const els = [...document.querySelectorAll(css)].filter((e) => !e.closest('.muse-auto-ui'));
      lines.push('', `=== ${title} (${els.length}) ===`);
      els.filter((e) => isVisible(e) || e.tagName === 'INPUT' || e.tagName === 'VIDEO').slice(0, max).forEach((e) => lines.push(`  ${describe(e)}`));
    };
    inv('Nút bấm / liên kết hiển thị', `${ROLE_CSS.button},${ROLE_CSS.tab},${ROLE_CSS.menuitem}`, 80);
    inv('Ô nhập (contenteditable / textarea)', '[contenteditable="true"],textarea,[role="textbox"]');
    inv('input[type=file]', 'input[type="file"]');
    inv('<video>', 'video');
    inv('iframe', 'iframe');
    inv('Phần tử có data-testid', '[data-testid]', 60);
    setTimeout(clearSurvey, 15000);
    return { ok: true, report: lines.join('\n') };
  }

  // ---------------------------------------------------------------- nhận lệnh từ side panel

  const handlers = {
    ping: () => ({ ok: true, url: location.href }),
    precheck: () => ({ ok: true, url: location.href, hidden: document.hidden, ...blockState(messageText()) }),
    survey: () => survey(),
    newChat: () => newChat(),
    selectVideoMode: () => selectVideoMode(),
    attachImage: (m) => attachImage(m),
    attachmentCount: () => attachmentReport(),
    beginWatch: (m) => beginWatch(m),
    fillPrompt: (m) => fillPrompt(m.text),
    highlightSend: () => highlightSend(),
    clearHighlight: () => { clearHighlight(); return { ok: true }; },
    hint: (m) => { if (!watch.submitted) showHint(m.text); return { ok: true }; },
    submit: () => submit(),
    status: () => status(),
    stopWatch: () => { stopWatch(); clearHighlight(); return { ok: true }; },
    fetchBlob: (m) => fetchBlob(m.url),
    clickDownload: () => clickDownload()
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const h = msg && handlers[msg.type];
    if (!h) return false;
    Promise.resolve()
      .then(() => h(msg))
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, note: String(e && e.message ? e.message : e) }));
    return true;
  });
})();
