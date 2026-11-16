# Ảnh cảnh và khung đầu sạch

Bài học từ clip c15 ngày 2026-11-10: frame đầu là hình rộng với dải trắng trên/dưới và thiết kế khác; frame sau là cảnh đầy màn hình. Chỉ xác nhận hiện tượng, không khẳng định Muse xử lý ảnh bằng cơ chế nào.

## Ảnh đầu vào
- characters/: mỗi file một nhân vật, một góc dễ nhận diện. Không dùng character sheet nhiều góc/multiple views để upload như một ảnh master. Giữ bản sheet làm tài liệu nếu có, xuất riêng từng nhân vật để gửi Muse. Tái sử dụng bộ chuẩn kênh.
- storyboards/: mỗi file một cảnh hoàn chỉnh, có đúng nhân vật/đạo cụ và bố cục của shot. Tạo trực tiếp ở tỷ lệ 16:9, ví dụ 1280×720 hoặc 1920×1080 khi công cụ hỗ trợ. Kiểm tra file ảnh thực, không chỉ dòng chữ trong prompt.
- Không có lề trắng/đen, khung trang, contact sheet, nhãn S001, phụ đề hoặc panel bên cạnh. Không lấy một dải panel dài từ sheet rồi thêm nền trắng cho đủ kích thước. Không nhầm tỷ lệ 16:9 của canvas chứa viền với nội dung cảnh 16:9 đầy khung.
- Nếu chỉ có contact sheet, ưu tiên tạo lại một ảnh cảnh đơn có tham chiếu master; crop chỉ khi panel thật có vùng nội dung phù hợp 16:9, không cắt mặt/tay/đạo cụ quan trọng. Đổi định dạng không sửa được bố cục. Không kéo giãn để ép tỷ lệ.
- Nếu không tạo được storyboard đạt yêu cầu trong hạn mức, không đưa file lỗi vào gói; bỏ trường storyboard tương ứng và ghi thiếu storyboard. Vẫn xuất TXT và ảnh nhân vật thật đang có. Không tự tạo đường dẫn tới ảnh chưa tồn tại.

## Prompt video
Viết một shot, một hành động chính, camera ổn định. Nêu frame đầu đã là cảnh hoàn chỉnh và cùng bố cục với phần còn lại; frame cuối không trở về ảnh reference. Ảnh nhân vật là identity-only, không phải khung bắt đầu, không được hiện nền tham chiếu. Storyboard là bố cục một cảnh, không phải collage cần hoạt hóa. Không đưa chỉ dẫn vừa zoom/pan mạnh vừa locked camera; không ghép nhiều phân cảnh vào một prompt.

Khối gợi ý (điều chỉnh để không mâu thuẫn shot):
“Render the finished scene full-bleed 16:9 from the very first frame. Use character references for identity only; never display the reference images or their backgrounds. Use the single-shot storyboard only for composition. Keep one continuous shot with stable framing. No introductory still, reference flash, borders, split screen, collage or abrupt reframing.”

## Rà xuất
Trong production_state.md ghi kích thước ảnh thật, có/không viền, số panel, master dùng để đối chiếu và shot phải bỏ storyboard. Nếu không có công cụ xem/đọc ảnh thì ghi chưa kiểm tra, không ghi đã đạt. Extension 1.4.0 kiểm tra dải trắng đầu clip nhưng không nhận ra mọi lỗi khung, sai mặt hoặc cảnh sáng trắng; cần xem bản dựng cuối. Việc chọn thử lại nằm trong giới hạn đã cấu hình, không tự lặp vô hạn.
