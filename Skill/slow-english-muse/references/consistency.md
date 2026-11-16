# Hồ sơ chuẩn và kiểm tra liên tục

## series_bible.json
Tạo file dữ liệu thật cho tập/series, không chỉ nhắc rằng đã khóa thiết kế. Các trường tối thiểu:
- series_id, revision, visual_style_lock: kỹ thuật hình ảnh, chất liệu, tỷ lệ khung hình, bảng màu, cân bằng trắng, mức tương phản. Không tự đổi phong cách giữa shot.
- characters: mỗi nhân vật có character_id ổn định, canonical_name, role, age, relationships theo ID, appearance_lock_en, outfit_lock_en, voice_lock_en, reference_images và reference_status. Khối appearance chứa khuôn mặt, màu da, kiểu/màu tóc, màu mắt, tỷ lệ đầu/thân và chiều cao tương đối. Khối outfit chứa từng món, màu, độ dài tay áo, họa tiết/không họa tiết, giày và phụ kiện. Voice là định hướng, không phải voice ID đã xác minh.
- locations: location_id, description_lock_en, vị trí tương đối đồ vật, ánh sáng theo thời điểm.
- props: prop_id, description_lock_en, màu, kích thước tương đối, chất liệu, thiết kế/cơ chế và chủ sở hữu nếu có.
- reference_images chỉ ghi đường dẫn/attachment thật. Chưa tạo ảnh ghi pending, không tự điền tên file như thể đã tồn tại.

Tên riêng giữ nguyên trong lời thoại tiếng Anh, bảng shot, tên speaker, storyboard, prompt và manifest. “Mom”/“Dad” có thể là cách gọi trong lời thoại nhưng phải ánh xạ tới đúng character_id, không biến thành một nhân vật mới. Nếu cần nhân vật phụ, khai báo vào bible trước khi xuất hiện.

## Trạng thái từng shot
Dùng character_ids, location_id, prop_ids và state_before/state_after. Theo dõi ai giữ đồ vật, tay trái/phải nếu quan trọng, cửa mở/đóng, món đồ nằm đâu, mũ có đội không, quần áo ướt/khô/bẩn. State_after của cảnh trước phải tương thích state_before của cảnh kế tiếp cùng mạch thời gian. Thay đổi quần áo, đạo cụ hoặc thời điểm chỉ khi có tình tiết/chuyển cảnh rõ, không tự đổi để ảnh đa dạng.

## Tạo ảnh và prompt
1. Tái sử dụng ảnh master và bible hiện có. Chỉ tạo ảnh chuẩn ở lần thiết lập đầu hoặc khi người dùng yêu cầu đổi thiết kế; không dựng lại master từ thumbnail mỗi tập. Có thể dùng sheet để rà thiết kế, nhưng gói Muse cần ảnh riêng cho từng nhân vật.
2. Trong lô storyboard tiếp theo, dùng lại ảnh chuẩn qua cơ chế tham chiếu của công cụ khi có. Không chỉ dựa vào ảnh gần nhất hoặc số thứ tự ảnh có thể không còn trỏ đúng nhân vật.
3. Mỗi prompt tự chứa visual_style_lock + khối appearance/outfit/voice nguyên văn của nhân vật trong cảnh + location/prop cần thiết. Đặt khối cố định và phần diễn xuất riêng để tránh mô tả hành động sửa ngoại hình.
4. Không cho đạo cụ chính tự đổi màu, số bánh, giỏ hoặc kích thước. Không đổi kiểu tóc/trang phục để minh họa cảm xúc. Giữ tính liên tục cả khi nhân vật không nói.
5. Cảnh mới theo thumbnail khác vẫn dùng cast hiện có; chỉ lấy chủ đề/tình huống; không lấy biểu cảm, tỷ lệ, màu sắc hoặc thiết kế đối thủ làm chuẩn mới.

## Rà toàn tập trước xuất
- Tất cả speaker và tên nhân vật có ánh xạ duy nhất trong bible.
- Khối mô tả cố định hiện diện nguyên văn trong mọi prompt tương ứng; không có mô tả khác mâu thuẫn ở phần còn lại.
- Prompt ảnh, ảnh thật (nếu đã có), kịch bản và prompt Muse cùng revision.
- Tỷ lệ chiều cao, màu mắt/tóc/áo, phụ kiện, phong cách và cơ chế đạo cụ đúng hồ sơ.
- Trạng thái cảnh nối tiếp hợp lý. Thumbnail của tập dùng cùng nhân vật và đạo cụ của tập.
- Mọi shot đủ prompt tự chứa dù Muse không nhận ảnh. Việc giữ đúng mô tả giảm độ lệch, không bảo đảm đầu ra text-to-video đồng nhất tuyệt đối. Chỉ đánh giá video khi đã xem clip thật.

Ghi kết quả ngắn vào production_state.md: revision, số shot đã rà, lỗi đã sửa, ảnh còn thiếu/lệch và phần chưa kiểm chứng trên Muse. Không để lỗi ảnh không sửa được chặn TXT: vẫn xuất theo bible đúng và khai báo shot ảnh cần làm lại.

## Chặn thiết kế bị ảnh hưởng bởi đối thủ
Nguồn chủ đề và nguồn thiết kế độc lập. Kiểm tra ảnh nguồn trước mỗi lần tạo: chỉ đính kèm master của kênh và storyboard của chính tập. Không đính kèm thumbnail đối thủ để công cụ “học nhân vật”. Gói xuất chỉ chứa nhân vật chuẩn của kênh; canonical_name/ID, các khối khóa và ảnh master phải nhất quán với tập trước. Nếu không truy cập được bộ chuẩn đã tồn tại, ghi thiếu tham chiếu và xin lại bộ đó, không bù bằng thiết kế mới. Không tuyên bố đồng nhất hình ảnh xuyên tập chỉ vì prompt cùng tên.
