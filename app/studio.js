/* Connection readout only: never submits a prompt or activates a tab in a poll. */
(() => {
  const byId = id => document.getElementById(id);
  let checking = false;
  let lastTabId = null;
  function paint(status, title, detail) {
    byId('connectionCard').dataset.status = status;
    byId('connectionTitle').textContent = title;
    byId('connectionDetail').textContent = detail;
  }
  async function checkConnection() {
    if (checking) return;
    checking = true;
    byId('checkConnectionBtn').disabled = true;
    let timeout;
    try {
      const tabs = await chrome.tabs.query({ url: ['https://muse.ai/*', 'https://www.muse.ai/*'] });
      const t = tabs.find(t => t.id === state.tabId) || tabs.find(t => t.active) || tabs[0];
      lastTabId = t?.id ?? null;
      if (!t) { paint('warning', 'Chưa mở Muse', 'Mở Muse và đăng nhập để bắt đầu.'); return; }
      const ping = await Promise.race([
        chrome.tabs.sendMessage(t.id, { type: 'ping' }),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('timeout')), 3000); })
      ]);
      if (!ping?.ok) throw new Error('No response');
      paint('ready', 'Đã kết nối tab Muse', `${t.active ? 'Tab đang được chọn' : 'Tab đang ở nền'} · Chưa xác minh đăng nhập hoặc hạn mức.`);
    } catch {
      paint('warning', 'Chưa nhận phản hồi', 'Tab có thể đang tải, bị treo hoặc cần tải lại sau khi cập nhật.');
    } finally {
      clearTimeout(timeout);
      checking = false;
      byId('checkConnectionBtn').disabled = false;
    }
  }
  byId('checkConnectionBtn').addEventListener('click', checkConnection);
  byId('openMuseBtn').addEventListener('click', async () => {
    try {
      const tab = lastTabId == null ? null : await chrome.tabs.get(lastTabId).catch(() => null);
      if (tab) {
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
      } else await chrome.tabs.create({ url: 'https://muse.ai/' });
      await checkConnection();
    } catch { paint('warning', 'Không mở được Muse', 'Hãy mở muse.ai trong Chrome rồi kiểm tra lại.'); }
  });
  const afterRender = globalThis.museAfterRender;
  globalThis.museAfterRender = () => {
    afterRender?.();
    const selected = ctl.selected != null;
    byId('detailEmpty').hidden = selected;
    byId('workspaceSceneCount').textContent = `${state.scenes.length} cảnh trong dự án`;
    byId('queueState').textContent = state.blocked ? 'Cần bạn xử lý' : isBusy() ? 'Đang thực hiện hàng đợi' : 'Sẵn sàng làm việc';
  };
  globalThis.museAfterRender();
  checkConnection();
  // Polling is UI-only and can be throttled without affecting production.
  setInterval(() => { if (!document.hidden) checkConnection(); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkConnection(); });
})();
