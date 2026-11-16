// Muse Auto — bộ hẹn giờ chạy trong Web Worker.
// Chrome giãn hẹn giờ của trang bị ẩn/thu nhỏ (có khi 1 phút/lần); hẹn giờ trong worker không bị giãn như vậy.
self.onmessage = (e) => {
  const { id, ms } = e.data || {};
  setTimeout(() => self.postMessage(id), Math.max(0, ms | 0));
};
