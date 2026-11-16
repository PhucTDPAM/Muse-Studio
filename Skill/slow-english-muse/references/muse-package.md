# Gói nhập Muse Studio 1.4.0

## Cấu trúc
Tên thư mục theo tập, ví dụ ep001. Bàn giao ep001.zip để người dùng tải, giải nén rồi chọn thư mục bằng nút Nhập trọn thư mục từ skill. Không gọi ZIP là file extension nhập trực tiếp.

```
ep001/
  muse_package.json
  muse_prompts_lines.txt
  characters/
    Mia.png
    Dad.png
  storyboards/
    c01.png
    c02.png
  series_bible.json
  policy_review.md
```

Mia/Dad chỉ là ví dụ, phải thay bằng tên và ID trong bible thực tế. Một ảnh nhân vật riêng, sạch, không lẫn nhân vật khác. Dùng ảnh chuẩn đã tạo trong ChatGPT, không tự tải ảnh đối thủ. Không đổi phần mở rộng giả: ảnh JPEG phải dùng .jpg; chỉ chuyển đổi định dạng khi có công cụ. Mỗi storyboard một shot; nếu tạo contact sheet thì tách panel bằng công cụ crop có sẵn hoặc không khai báo nó là storyboard riêng của nhiều shot. Không dùng cả sheet nhiều cảnh làm ảnh khung đầu.

## muse_package.json
UTF-8, schemaVersion=1. Ví dụ cú pháp cho hai cảnh (thay bằng toàn bộ tập thật):

```json
{
  "schemaVersion": 1,
  "title": "Mia Finds Her Ball",
  "promptsFile": "muse_prompts_lines.txt",
  "characters": [
    {"id": "mia", "name": "Mia", "aliases": [], "image": "characters/Mia.png"},
    {"id": "dad", "name": "Dad", "aliases": ["Daddy"], "image": "characters/Dad.png"}
  ],
  "scenes": [
    {"n": 1, "characters": ["mia"], "storyboard": "storyboards/c01.png"},
    {"n": 2, "characters": ["mia", "dad"], "storyboard": "storyboards/c02.png"}
  ]
}
```

`n` là số dòng prompt có nội dung, bắt đầu từ 1; không phải ID shot như S001A. Đủ đúng một mục cho mỗi dòng. `characters` là danh sách ID nhân vật thật sự xuất hiện; dùng [] cho cảnh chỉ có đồ vật/bối cảnh. Không thêm Dad chỉ vì Mia nói “Dad” khi bố không có trong hình. `storyboard` tùy chọn; chỉ ghi khi file thật tồn tại. Các tên/bí danh không trùng giữa nhân vật. Đường dẫn tương đối dùng /; không ../, đường dẫn tuyệt đối hoặc URL.

Prompt vẫn chứa mô tả nhân vật đầy đủ; không thêm “without image input”, “text only”, “no reference images” vào prompt của gói có ảnh. Extension bổ sung vai trò/thứ tự ảnh; không cần lặp khối đó trong file TXT.

## Rà và bàn giao
Kiểm tra JSON đọc được, đủ ánh xạ, mọi ID có trong bible, tất cả file ảnh được khai báo tồn tại và mở được, số dòng bằng số cảnh, mỗi nhân vật chỉ lưu một lần trong characters. Không chèn ảnh placeholder thay ảnh chưa tạo. Không nói ảnh đã gửi Muse: skill chỉ xuất gói. Xuất bản có nhãn/manifest và bible như thường lệ. Hướng dẫn cuối ngắn: giải nén ZIP → Muse Studio → Nhập trọn thư mục từ skill → Chạy. Nếu công cụ không tạo file/ZIP, nói rõ giới hạn; không giả mạo link tải.

## Nguồn ảnh
characters/ chỉ chứa ảnh master hiện có của kênh (hoặc bản chuyển định dạng tương đương), không tạo lại theo chủ đề và không chứa ảnh đối thủ. storyboards/ tạo mới theo master đó. Giữ ID và tên file nhân vật ổn định giữa các tập, cập nhật đường dẫn thật vào manifest. Không coi thumb đối thủ là character reference dù hình trong đó có cùng tên.

## Toàn vẹn khung hình
Áp dụng frame-integrity.md trước đóng gói. Không dùng ảnh storyboard có nội dung dạng dải ngang kèm lề trắng dù kích thước ngoài là 16:9. File không đạt không được khai báo trong scenes[].storyboard; giữ cảnh và prompt, ghi rõ storyboard còn thiếu. Không upload sheet nhiều góc làm master nhân vật.
