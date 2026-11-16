/* Muse Auto — TẤT CẢ selector và mẫu văn bản để nhận diện trang muse.ai nằm trong tệp này.
 *
 * Khi Muse đổi giao diện, chỉ cần sửa tệp này rồi bấm "Tải lại" extension ở chrome://extensions.
 * Dùng nút "Khảo sát trang" trong side panel để xem mục nào tìm thấy / không tìm thấy.
 *
 * Mỗi mục là một danh sách "chiến lược", thử lần lượt từ trên xuống; chiến lược đầu tiên
 * tìm được phần tử (đang hiển thị) sẽ được dùng:
 *   { css: '...' }                          CSS selector (ưu tiên aria-label, role, data-testid)
 *   { role: 'button,link', name: /regex/ }  vai trò + tên truy cập (aria-label > title > văn bản hiển thị)
 *   { text: /regex/, tags: 'button,span' }  văn bản hiển thị
 *   thêm  hidden: true  để chấp nhận cả phần tử bị ẩn (vd. <input type=file> ẩn).
 *
 * Ghi chú: phiên bản này được viết KHÔNG có khảo sát trực tiếp trang muse.ai (xem README),
 * nên các selector là phỏng đoán theo quy ước phổ biến; hãy chạy "Khảo sát trang" để kiểm chứng.
 */
globalThis.MUSE_SELECTORS = {
  version: '2026-10-11 (chưa khảo sát trực tiếp)',

  // Trang mở khi cần cuộc trò chuyện mới / màn hình tạo video.
  startUrl: 'https://muse.ai/thread/new',
  // 'button' = bấm nút "New chat" trước, không thấy thì mở startUrl.  'url' = luôn mở startUrl.
  openMethod: 'url',

  // Ô nhập prompt
  composer: [
    { css: 'div[contenteditable="true"][role="textbox"]' },
    { css: 'textarea[placeholder]' },
    { css: '[contenteditable="true"]' },
    { css: 'textarea' }
  ],

  // Nút gửi
  sendButton: [
    { css: '[aria-label="Send"], [aria-label="Send message"], [aria-label="Send prompt"], [aria-label="Gửi"], [aria-label="Gửi tin nhắn"]' },
    { css: '[data-testid*="send" i], [data-testid*="submit" i]' },
    { role: 'button', name: /^(send|send message|submit|generate|create|animate|gửi|tạo|tạo video)$/i },
    { css: 'button[type="submit"]' }
  ],

  // Nút mở cuộc trò chuyện mới
  newChat: [
    { css: '[aria-label="New chat"], [aria-label="New conversation"], [aria-label="Đoạn chat mới"], [aria-label="Cuộc trò chuyện mới"]' },
    { role: 'button,link', name: /^(new chat|new conversation|đoạn chat mới|cuộc trò chuyện mới)$/i }
  ],

  // Nút/tab chuyển sang chế độ tạo video (Muse video)
  videoMode: [
    { css: '[data-testid*="video-mode" i], [data-testid*="create-video" i]' },
    { css: '[aria-label="Video"], [aria-label="Create video"], [aria-label="Make a video"], [aria-label="Tạo video"]' },
    { role: 'button,tab,menuitem,option,radio,switch', name: /^(video|videos|create (a )?video|make a video|generate video|muse video|tạo video)$/i }
  ],

  // Menu chọn chế độ (nếu nút Video nằm trong một menu)
  modeMenu: [
    { role: 'button', name: /^(mode|modes|tools|create|imagine|chế độ|công cụ)$/i }
  ],

  // Nút đính kèm (chỉ bấm để menu hiện <input type=file>; trình duyệt chặn hộp chọn tệp vì không có thao tác người dùng)
  attachButton: [
    { css: '[aria-label*="Attach" i], [aria-label*="Upload" i], [aria-label*="Add photo" i], [aria-label*="Add image" i], [aria-label*="Đính kèm" i], [aria-label*="Tải lên" i]' },
    { role: 'button', name: /attach|upload|add (a )?(photo|image|file|media)|đính kèm|tải lên|thêm ảnh/i }
  ],

  fileInput: [
    { css: 'input[type="file"][accept*="image"]', hidden: true },
    { css: 'input[type="file"]', hidden: true }
  ],

  // Ảnh xem trước sau khi đính kèm
  attachmentPreview: [
    { css: 'img[src^="blob:"], img[src^="data:image"], img[src^="https:"]' }
  ],

  // Pending-upload chips have their own removal controls; message images do not.
  attachmentRemove: [
    { css: 'button[aria-label*="remove" i], button[aria-label*="delete" i], button[title*="remove" i], button[title*="delete" i], [role="button"][aria-label*="remove" i], button[aria-label*="xóa" i], button[aria-label*="gỡ" i], [data-testid*="remove-attachment" i], [data-testid*="remove-image" i]' }
  ],

  // Dấu hiệu đang tạo
  generating: [
    { css: '[role="progressbar"]' },
    { role: 'button', name: /^(stop|stop generating|stop response|dừng|dừng tạo)$/i }
  ],

  // Video KẾT QUẢ phải hiển thị tối thiểu cỡ này (px). Ảnh đại diện động của Muse
  // (hiện kèm "Creating shot" lúc đang tạo) nhỏ hơn nhiều nên bị loại.
  resultVideoMinSize: 140,
  // Chữ nằm trong các vùng này KHÔNG được quét tìm lỗi / giới hạn / CAPTCHA
  // (thanh bên trái, danh sách lịch sử bên phải… có tiêu đề tác vụ cũ như "… daily limit reached").
  scanExclude: [
    { css: 'nav, aside, header, footer, [role="navigation"], [role="complementary"], [role="banner"], [role="menu"], [role="listbox"]' }
  ],
  // Chỉ quét chữ nằm thẳng hàng (theo chiều ngang) với ô nhập prompt — tức cột hội thoại.
  // Nới thêm bấy nhiêu px mỗi bên.
  chatColumnMargin: 60,

  // Video nằm trong các vùng này không bao giờ là kết quả (ảnh đại diện, thanh đầu trang…)
  videoExclude: [
    { css: '[aria-label*="avatar" i], [data-testid*="avatar" i], [class*="avatar" i], [class*="Avatar"], header, nav, [role="banner"]' }
  ],

  // Thanh tiến độ của trang (để đọc % thật nếu có)
  progress: [
    { css: '[role="progressbar"][aria-valuenow], progress[value]' }
  ],

  // Nút tải xuống video (dự phòng khi không lấy được src của <video>)
  downloadButton: [
    { css: '[aria-label*="Download" i], [aria-label*="Tải xuống" i], [aria-label*="Tải về" i], a[download]' },
    { role: 'button,link,menuitem', name: /^(download|tải xuống|tải về)/i }
  ],
  moreOptions: [
    { role: 'button', name: /^(more|more options|options|xem thêm|tùy chọn khác|tùy chọn)$/i }
  ],

  // Nút đăng nhập (xuất hiện = có thể đã bị đăng xuất)
  loginButton: [
    { role: 'button,link', name: /^(log in|login|sign in|continue with facebook|continue with instagram|đăng nhập)$/i }
  ],

  // Vùng thông báo/hộp thoại để quét lỗi, giới hạn, CAPTCHA
  messageAreas: [
    { css: '[role="dialog"], [role="alertdialog"], [role="alert"], [aria-live="assertive"], [aria-live="polite"]' }
  ],

  captchaFrame: [
    { css: 'iframe[src*="captcha" i], iframe[src*="arkoselabs" i], iframe[src*="funcaptcha" i], iframe[title*="captcha" i], iframe[src*="checkpoint" i]', hidden: true }
  ],

  // Thuộc tính cho biết nút đang được chọn (để không bấm tắt chế độ video)
  activeStateAttrs: ['aria-pressed', 'aria-selected', 'aria-checked', 'data-state', 'aria-current'],

  patterns: {
    // Giới hạn / hạn mức → DỪNG hàng đợi
    // Chỉ những câu cho thấy ĐÃ hết lượt / bị chặn. Không dùng từ chung chung như "weekly limit",
    // "quota", "usage limit" vì bảng Settings → Usage của Muse luôn hiện các chữ đó.
    limit: [
      /rate[\s-]?limit(ed| exceeded| reached)/i,
      /too many (requests|attempts|videos|generations)/i,
      /try again (later|in \d+|tomorrow)/i,
      /(usage|daily|weekly|monthly|generation|video) limit (has been |was )?(reached|exceeded|hit)/i,
      /(reached|hit|exceeded|used up) (your|the|our)( \w+)? (limit|quota|cap|allowance)/i,
      /quota (has been |was )?(reached|exceeded|used up)/i,
      /limit (reached|exceeded)/i,
      /you('ve| have) (run out of|used (up )?all( of)? your)/i,
      /come back (later|tomorrow)/i,
      /out of (credits|tokens|generations|video generations)/i,
      /thử lại sau/i,
      /(đã )?(đạt|vượt quá|hết) (giới hạn|hạn mức|lượt)/i
    ],
    // Dòng THÔNG TIN sử dụng (không phải bị chặn) — bỏ qua trước khi so với các mẫu "limit" ở trên
    limitInfo: [
      /resets? (on|in|at|every)\b/i,
      /\d+(\.\d+)?\s*% used/i,
      /tokens? left/i,
      /never expires/i,
      /\b(upgrade|free plan|pro plan|plan:)/i
    ],
    // CAPTCHA / xác minh → DỪNG, báo người dùng, KHÔNG xử lý
    captcha: [
      /captcha/i,
      /verify (that )?you('re| are) (a )?(human|not a robot)/i,
      /are you a (robot|human)/i,
      /security check/i,
      /confirm (it'?s|that it'?s|that this is) you/i,
      /unusual activity/i,
      /xác minh (bạn|danh tính|tài khoản)/i,
      /hoạt động bất thường/i,
      /kiểm tra bảo mật/i
    ],
    // Yêu cầu đăng nhập → DỪNG
    login: [
      /(log ?in|sign in) to (continue|use|get started|muse ai|meta ai)/i,
      /log in or sign up to/i,
      /session (has )?expired/i,
      /you('ve| have) been logged out/i,
      /đăng nhập để tiếp tục/i,
      /phiên .*hết hạn/i
    ],
    // Trang từ chối prompt / lỗi → cảnh đó "Lỗi", chuyển cảnh sau
    error: [
      /something went wrong/i,
      /(can'?t|cannot|couldn'?t|could not|unable to|not able to|won'?t be able to) (help with|create|generate|make|produce|process)/i,
      /(violates?|against|doesn'?t meet) (our )?(policies|policy|guidelines|community standards|terms)/i,
      /(generation|video) failed/i,
      /failed to (generate|create|load)/i,
      /please try a different prompt/i,
      /đã (xảy ra|có) lỗi/i,
      /không thể (tạo|xử lý)/i,
      /vi phạm (chính sách|tiêu chuẩn)/i
    ],
    // Văn bản cho biết đang tạo
    generating: [
      /generating/i,
      /creating (a |the |your )?(video|clip|shot|scene)/i,
      /creating shot/i,
      /making (a |the |your )?(video|clip|shot)/i,
      /rendering/i,
      /animating/i,
      /this (may|might|can|could) take/i,
      /đang tạo/i,
      /đang xử lý/i
    ],
    // Tên nút được coi là "Gửi" khi người dùng tự bấm (chế độ Bán tự động)
    sendName: /^(send|send message|submit|generate|create|animate|gửi|tạo)/i,
    // Phần trăm hiển thị dạng chữ trong lúc tạo, vd "45%"
    percent: /(d{1,3}(?:[.,]d+)?)s?%/g
  }
};
