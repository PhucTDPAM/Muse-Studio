/* Shared by extension pages and isolated-world content scripts.
 * Short waits are scheduled by the extension worker, not a hidden page's timers.
 * This does not make a frozen page, a sleeping PC, or a closed browser run.
 */
(() => {
  if (globalThis.MuseBackgroundTiming) return;
  async function sleep(ms) {
    if (!Number.isFinite(ms) || ms < 0) throw new TypeError('Invalid delay');
    const deadline = Date.now() + ms;
    do {
      const chunk = Math.min(20000, Math.max(0, deadline - Date.now()));
      const response = await chrome.runtime.sendMessage({ type: 'museBackgroundDelay', ms: chunk });
      if (!response?.ok) throw new Error('Không kết nối được bộ hẹn giờ nền. Hãy tạm dừng và tải lại extension/trang Muse.');
    } while (Date.now() < deadline);
  }
  globalThis.MuseBackgroundTiming = Object.freeze({ sleep });
})();
