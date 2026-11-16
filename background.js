/* Muse Auto — service worker.
 * Việc điều phối hàng đợi nằm ở side panel (trang luôn sống khi panel mở).
 * Hẹn giờ ngắn cho panel/content script khi tab bị ẩn; đồng thời: mở side panel khi bấm icon, đặt tên tệp tải về (ZIP, tệp lẻ, tệp tải bằng nút của trang).
 */

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

// Panel báo trước "lượt tải kế tiếp từ muse.ai hãy đặt tên là X" (dùng khi tải bằng nút của trang).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'museBackgroundDelay') {
    // Keep each request below the worker's idle timeout. No permanent heartbeat.
    if (_sender.id !== chrome.runtime.id || !Number.isFinite(msg.ms) || msg.ms < 0 || msg.ms > 20000) {
      sendResponse({ ok: false, note: 'Invalid background delay' });
      return false;
    }
    setTimeout(() => sendResponse({ ok: true }), msg.ms);
    return true;
  }
  if (msg && msg.type === 'expectDownload') {
    chrome.storage.session
      .set({ pendingRename: { filename: msg.filename, conflictAction: msg.conflictAction || 'uniquify', until: Date.now() + 60000 } })
      .then(() => sendResponse({ ok: true }));
    return true;
  }
  // Trang của extension báo trước tên cho một lượt tải sắp bắt đầu (khóa theo URL)
  if (msg && msg.type === 'nameDownload') {
    chrome.storage.session.get('ownNames').then(({ ownNames = {} }) => {
      const now = Date.now();
      for (const k of Object.keys(ownNames)) if (ownNames[k].until < now) delete ownNames[k];
      ownNames[msg.url] = { filename: msg.filename, conflictAction: msg.conflictAction || 'uniquify', until: now + 120000 };
      return chrome.storage.session.set({ ownNames });
    }).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  if (msg && msg.type === 'cancelExpectDownload') {
    chrome.storage.session.remove('pendingRename').then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

const META_DL_RE = /muse\.ai|meta\.ai|fbcdn\.net|facebook\.com|fbsbx\.com/i;

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  // Tệp do chính extension tải: CHỦ ĐỘNG đặt lại đúng tên (ZIP = "<Tên dự án>.zip"…),
  // để Chrome hay extension khác (trình quản lý tải…) không đổi thành tên ngẫu nhiên.
  if (item.byExtensionId === chrome.runtime.id) {
    chrome.storage.session
      .get('ownNames')
      .then(({ ownNames = {} }) => {
        const want = ownNames[item.url];
        if (want) {
          delete ownNames[item.url];
          chrome.storage.session.set({ ownNames });
          suggest({ filename: want.filename, conflictAction: want.conflictAction });
        } else suggest();
      })
      .catch(() => suggest());
    return true;
  }
  chrome.storage.session
    .get('pendingRename')
    .then(({ pendingRename: p }) => {
      const src = `${item.url || ''} ${item.finalUrl || ''} ${item.referrer || ''}`;
      if (p && Date.now() < p.until && META_DL_RE.test(src)) {
        chrome.storage.session.remove('pendingRename');
        suggest({ filename: p.filename, conflictAction: p.conflictAction });
      } else {
        suggest();
      }
    })
    .catch(() => suggest());
  return true;
});
