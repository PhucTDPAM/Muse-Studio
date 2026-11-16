# Skill ChatGPT: Slow English Story → Muse

Skill **slow-english-muse** dùng trong **ChatGPT** để lên toàn bộ phần chuẩn bị sản xuất một tập phim hoạt hình *Slow English* cho trẻ 3–7 tuổi. Kết quả là một **gói thư mục** nhập thẳng vào extension Muse Studio (dashboard → **Nhập trọn thư mục từ skill**) để tạo video hàng loạt.

Skill chỉ chuẩn bị nội dung và xuất gói. Nó **không** gọi API, **không** tự điều khiển extension và **không** đăng video.

## Trong thư mục này

| Tệp | Dùng để |
|---|---|
| `slow-english-muse-2026-11-16.zip` | Tệp **tải lên ChatGPT** để cài skill |
| `slow-english-muse/SKILL.md` | Nội dung chính của skill: quy trình, quy tắc, điều kiện hoàn thành |
| `slow-english-muse/references/consistency.md` | Giữ đồng nhất nhân vật, bối cảnh, đạo cụ (series bible) |
| `slow-english-muse/references/production.md` | Cách viết prompt text-to-video và bàn giao |
| `slow-english-muse/references/muse-package.md` | Cấu trúc gói nhập Muse Studio (`muse_package.json`) |
| `slow-english-muse/references/frame-integrity.md` | Chống lỗi khung đầu: lề trắng/đen, storyboard lọt vào clip |
| `slow-english-muse/references/youtube-kids.md` | Rà chính sách YouTube / YouTube Kids cho nội dung trẻ em |

Thư mục `slow-english-muse/` là bản giải nén của tệp ZIP, để đọc trực tiếp trên GitHub. Khi sửa skill, sửa trong thư mục này rồi nén lại thành ZIP (xem cuối trang).

## 1. Cài skill vào ChatGPT

1. Tải tệp `slow-english-muse-2026-11-16.zip` về máy. Trên GitHub: bấm vào tệp → **Download raw file**.
2. Trong ChatGPT, mở phần quản lý **Skills**, chọn tải skill lên, rồi chọn tệp ZIP. Vị trí và tên menu có thể khác tùy phiên bản ChatGPT và gói tài khoản.
3. Nếu tài khoản của bạn chưa có mục Skills, dùng **GPT tùy chỉnh** thay thế:
   - Tạo GPT mới → dán toàn bộ nội dung `SKILL.md` (bỏ phần `---` đầu tệp) vào ô **Instructions**.
   - Tải 5 tệp trong `references/` lên mục **Knowledge**.
   - Bật **Image generation** để skill tự vẽ ảnh nhân vật và storyboard.

## 2. Dùng skill (mỗi tập phim)

1. Gọi skill trong ChatGPT rồi gửi **một** trong các thứ sau:
   - một **chủ đề**, ví dụ "Mia learns colors at the park";
   - **ảnh thumbnail + tiêu đề** video đối thủ. Skill sẽ đưa lựa chọn "theo thumb" và 3 gợi ý biến thể để bạn chọn.
2. Sau khi bạn chọn chủ đề, skill **tự chạy trọn quy trình** mà không hỏi duyệt từng bước: brief → kịch bản → series bible → bảng shot → ảnh nhân vật → storyboard → tự kiểm tra → xuất gói.
3. Lần đầu, skill thiết lập **dàn nhân vật cố định của kênh**. Các tập sau dùng lại bible và ảnh chuẩn đó. Nếu mở chat mới, hãy gửi lại `series_bible.json` và ảnh nhân vật để giữ đồng nhất.
4. Tải về **ZIP của tập**, ví dụ `ep001.zip`, rồi **giải nén** ra một thư mục:
   ```
   ep001/
     muse_package.json      ← ánh xạ cảnh ↔ nhân vật ↔ storyboard
     muse_prompts_lines.txt ← mỗi dòng một prompt, theo thứ tự cảnh
     characters/            ← ảnh chuẩn từng nhân vật
     storyboards/           ← ảnh khung đầu từng cảnh (c01.png…)
     series_bible.json
     policy_review.md
   ```

## 3. Nhập vào Muse Studio và chạy

1. Mở extension → **Dashboard ↗**.
2. Tạo dự án mới (**+ Dự án mới**), đặt **Tên dự án** theo tập.
3. Bấm **Nhập trọn thư mục từ skill**, rồi chọn **thư mục đã giải nén** (`ep001/`, không phải tệp ZIP). Extension tự gán prompt, ảnh nhân vật và storyboard cho từng cảnh.
4. Chọn chế độ (**Bán tự động** để thử, **Tự động** để chạy hàng loạt) rồi bấm **Chạy tự động**.

Nên chạy thử 3–5 cảnh đầu để kiểm tra thời lượng clip, thoại và âm thanh, độ giữ nhân vật và khung đầu, rồi mới chạy cả tập.

## 4. Lưu ý

- Skill **không vượt được hạn mức** của ChatGPT hay Muse. Nếu hết lượt vẽ ảnh giữa chừng, skill vẫn xuất `muse_prompts_lines.txt` và ghi rõ storyboard nào còn thiếu.
- Thumbnail đối thủ chỉ dùng để **lấy ý tưởng chủ đề**. Skill không sao chép nhân vật, phong cách hay bố cục của đối thủ.
- Nội dung hướng tới trẻ 3–7 tuổi tại Mỹ, nên skill có bước rà theo chính sách YouTube Kids (`references/youtube-kids.md`). Khi đăng video vẫn cần khai báo **Made for kids** và **nội dung do AI tạo** theo quy định của YouTube.
- Thoại và âm thanh trong prompt chỉ là chỉ dẫn mong muốn. Muse không bảo đảm làm theo chính xác.

## 5. Sửa skill rồi đóng gói lại

Sửa các tệp trong `slow-english-muse/`, rồi nén **cả thư mục** thành ZIP mới, đặt tên kèm ngày, ví dụ `slow-english-muse-2026-12-01.zip`. Trong ZIP phải có thư mục `slow-english-muse/` chứa `SKILL.md` ở bên trong.

PowerShell:
```powershell
Compress-Archive -Path .\Skill\slow-english-muse -DestinationPath .\Skill\slow-english-muse-2026-12-01.zip
```
