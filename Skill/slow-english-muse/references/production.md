# Shot và gói xuất

## Bảng storyboard
Mỗi dòng có: shot_id, thời lượng dự kiến, nhân vật, bối cảnh, trạng thái đạo cụ trước/sau, hành động chính, cỡ cảnh/góc máy, lời thoại/speaker, âm thanh mong muốn, yêu cầu liên tục, ảnh nếu đã tạo, trạng thái.

ID: S001, S002… Nếu sửa giữ ID. Tách shot mới có thể dùng S002A; cập nhật thứ tự trong manifest.

## Prompt Muse tự chứa
Viết bằng tiếng Anh, triển khai đủ từng trường, không để placeholder trong bản xuất:

1. Landscape 16:9; phong cách đã chốt trong bible.
2. Duration requested, ghi là mục tiêu nếu chưa xác minh giới hạn Muse.
3. Mô tả đầy đủ nhân vật xuất hiện: khuôn mặt, tóc, trang phục, tỷ lệ; chỉ đưa nhân vật thuộc shot.
4. Bối cảnh với vị trí không gian cố định; thời điểm và ánh sáng.
5. Trạng thái đầu → một hành động rõ → trạng thái cuối.
6. Góc/cỡ cảnh và chuyển động máy đơn giản nếu cần.
7. Speaker và câu thoại chính xác, giọng mong muốn, nói rõ và có khoảng nghỉ; không ép số từ quá nhiều vào clip ngắn.
8. Ambience/SFX/music mong muốn; lời nói phải nghe rõ.
9. Yêu cầu giữ nguyên đạo cụ/trang phục; không chữ trên hình hoặc phụ đề đốt cứng, để chèn khi dựng.

Không dựa vào “as above”, “same as previous”, tên riêng không có mô tả hoặc tham chiếu không tồn tại trong prompt. Hướng dẫn hình–lời cần đúng đối tượng và đúng hành động. Cảnh không thoại ghi rõ không thoại.

## Định dạng bàn giao

- `muse_prompts_labeled.md`: tiêu đề shot và prompt dễ kiểm tra.
- `muse_prompts_lines.txt`: UTF-8, mỗi prompt đúng một dòng vật lý, không tiêu đề, không dòng trống, không markdown fence. Chuyển newline bên trong prompt thành khoảng trắng. Đây là định dạng trung gian; chỉ gọi là tương thích extension sau khi có mẫu nhập hoặc thử thật.
- `shot_manifest.csv`: shot_id, order, duration_estimate_seconds, status, storyboard_file, clip_file, notes. Trích dẫn CSV đúng cách khi có dấu phẩy hoặc newline.
- `production_state.md`: tên tập, version, character/prop bible hiện dùng, bước đã duyệt, shot cần sửa, cấu hình Muse đã thử, định dạng extension nếu đã biết.

Nếu extension dùng JSON/CSV hoặc delimiter riêng, chuyển gói prompt sang đúng mẫu người dùng cung cấp, bảo toàn câu thoại, ID và thứ tự. Không ghi đè prompt cũ nếu cần theo dõi các lần tạo; đặt revision rõ ràng.

## Rà trước xuất
- Mỗi shot có ID duy nhất và thứ tự rõ.
- Nhân vật và đạo cụ không đổi ngoài chủ ý câu chuyện.
- Không cho nhân vật nhắc một vật ở vị trí trái ngược hình.
- Kịch bản tiếng Anh đúng; lặp tự nhiên, không lặp do lỗi.
- Đủ thời gian cho thoại và hành động; tổng thời lượng là ước tính.
- Thumbnail hứa hẹn đúng sự kiện thật trong truyện.
- Storyboard ảnh chưa tạo, clip chưa tạo, âm thanh chưa nghe phải ghi đúng trạng thái.

## Chế độ tự động
Sau khi người dùng chọn chủ đề, không chờ duyệt giữa các bước. Xuất đủ prompt toàn tập dù storyboard ảnh bị giới hạn; ghi rõ phần ảnh còn thiếu. Dùng trạng thái storyboard_ready nếu ảnh đã có; không tự đánh dấu approved (người dùng duyệt), generated hoặc accepted cho clip chưa được tạo. File TXT mặc định là một prompt một dòng; định dạng chưa được xác minh với extension không chặn xuất.

## Nguồn chuẩn bắt buộc
Thực hiện references/consistency.md (cùng thư mục) trước khi chia cảnh và rà xuất. Bàn giao thêm series_bible.json và ảnh chuẩn đã tạo. Mọi prompt lấy nguyên văn khối mô tả từ bible; tên và speaker ánh xạ tới character_id ổn định.

## Rà nội dung cho trẻ
Áp dụng youtube-kids.md cùng thư mục ở mọi shot và gói metadata. Xuất thêm policy_review.md, ghi đúng phạm vi đã rà và phần clip thực chưa kiểm chứng. Không thêm cổng duyệt giữa chừng.

## Đầu ra thư mục cho extension
Ưu tiên muse-package.md cùng thư mục: một ảnh chuẩn cho mỗi nhân vật + bảng ánh xạ theo số dòng + storyboard từng cảnh. Giữ TXT một prompt một dòng nhưng không yêu cầu người dùng nhân bản ảnh theo cảnh.
