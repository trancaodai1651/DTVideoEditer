# Backlog

| ID | Ưu tiên | Trạng thái | Phụ thuộc | Tiêu chí chấp nhận |
| --- | --- | --- | --- | --- |
| M0 | P0 | Xong | Toolchain | Hai agent đọc cùng context, checker phát hiện sai lệch, sync giữ skill tự quản, app mở tới thư viện và Settings, lệnh kiểm tra tái lập. |
| M1-A | P0 | Xong | M0 | Chọn thư mục native, đọc FFprobe, tạo thumbnail FFmpeg, index SQLite, gallery và preview hoạt động với fixture, clip có thể mở lại, thu hồi kiểm tra qua native smoke. |
| M1-B | P0 | Xong | M1-A | Snapshot timeline có version, start/end/position theo mili giây, drag/drop, trim/split và undo/redo. Project mở lại giữ edit points. Render MP4 H.264/AAC từ timeline thật, xem tiến độ, hủy và thử lại, fixture đo độ dài bằng FFprobe. |
| M1-C | P1 | Đang làm | M1-B | Nhiều tầng video/ảnh/âm thanh/chữ, màu, transform, fade/volume, 9:16/16:9/1:1 và hàng đợi. Tiếp theo là crop, rotate, speed, nhiều chuyển cảnh, preset chất lượng và phát timeline theo thời gian thực. |
| M1-D | P1 | Đang làm | M1-B | Có phụ đề thủ công, SRT, Whisper, preset chữ và waveform. Còn thumbnail theo từng thời điểm và thao tác bàn phím nâng cao. |
| M1-E | P0 | Xong | M1-C | Mẫu sẵn và mẫu cục bộ từ video, dò nhịp cắt/tỷ lệ, gán nguồn và các lớp âm thanh, tạo dự án chỉnh sửa được. |
| M1-F | P0 | Chờ | M1-E | Mở rộng nhận dạng chữ, chuyển cảnh, chuyển động, nhạc và lời nói theo confidence. Cho phép xem và sửa đề xuất, giữ quyền với mẫu và giọng nói, đo chất lượng trên video tham chiếu có ground truth. |
| M1-G | P1 | Xong | M1-C | Giao diện biên tập ba khung với timeline và các thư viện tích hợp. Các preset cập nhật clip hoặc tạo lớp chỉnh sửa được và đi vào MP4. |
| M1-H | P1 | Đang làm | M1-I | Nhóm triển khai theo các ca nghiệm thu trong [khảo sát CapCut](CAPCUT_DESKTOP_AUDIT.md). |
| M1-H1 | P0 | Đang kiểm chứng | M1-I | Có picker nhiều tệp, native drop và grant theo tệp. Picker MP4/WAV và thả trực tiếp từ Explorer đã thử trên Windows. Test native kiểm tra trùng, thu hồi và mở lại. Còn Finder và picker trên macOS. |
| M1-H2 | P0 | Đang làm | M1-I | Có công tắc dồn clip chính, hít mép và liên kết, đa chọn, chọn theo hướng, group, clipboard, marker, bước frame và nhảy điểm cắt. Còn chọn bằng khung và thuộc tính đa chọn. |
| M1-H3 | P1 | Đang kiểm chứng | M1-H1 | Có waveform, filmstrip, gain dB, fade in/out, khóa/ẩn/tắt tiếng, tay nắm fade, meter theo mức RMS cache và tách/khôi phục audio liên kết bằng `audioLink`. Còn thử trong cửa sổ thật và meter theo kênh trái/phải. |
| M1-H4 | P1 | Đang làm | M1-I | Có một bộ keyframe transform cho vị trí, scale, xoay và opacity, easing tuyến tính hoặc smooth, diamond và phép sửa split/trim. Còn keyframe riêng từng tham số và đồ thị easing. |
| M1-H5 | P1 | Đang làm | M1-H2 | Hai chuyển cảnh hòa trộn và qua đen giữa clip kề nhau, giới hạn thời lượng và khôi phục sau undo. Fixture FFmpeg kiểm tra cả hai. Còn xác minh độ khớp preview trên macOS và mở rộng preset. |
| M1-H6 | P1 | Đang làm | M1-H2, M1-H4 | Có xuất In–Out, compound và timeline con, multicam đồng bộ tiếng, speed curve, tracking, chữ phong phú, lớp điều chỉnh, LUT, freeze và reverse. Có chế độ **Xem bản xuất** chính xác cho LUT/màu/reverse. Còn mask theo tracking, HSL từng màu, bánh xe màu, LUT trong preview tương tác và preset xuất. |
| M1-H7 | P0 | Đang kiểm chứng | M1-H1, M1-I | Sửa lỗi báo từ 0.4.0. Kéo từ thư viện và Explorer đã thử trên Windows production QA. Còn kiểm thử Finder và nhiều mức DPI. |
| M1-H8 | P1 | Đang làm | M1-H2, M1-H3, M1-J | Đã có menu clip/tầng/timeline, kéo vách chia, chọn bằng khung, copy/paste thuộc tính, thay clip, freeze/reverse, menu thẻ media và trình phát, lọc theo loại và sidebar Âm thanh/Chữ. Đã thử bố cục editor Tauri 1280×720. Còn preset và điều khiển trong khảo sát, kiểm tra bố cục 2560×1440 và macOS. |
| M1-I | P1 | Xong | M1-G | Kéo media từ thư viện lên timeline, di chuyển clip giữa các tầng cùng loại, zoom timeline và preview, kéo vị trí/đổi cỡ/xoay hình trên preview và lưu qua undo/redo. |
| M1-J | P1 | Đang làm | M1-I | Kiểm kê thao tác CapCut Desktop có ca tái lập và ghi phạm vi theo bản, tài khoản, nền tảng. Đã có khảo sát Windows khi chưa đăng nhập. Còn ca Pro, cloud, macOS và các dòng ghi Cần thử. |
| M1-K | P0 | Đang kiểm chứng | M1-B, M1-C | Dựng highlight và dựng theo một clip âm thanh từ timeline. Chọn đoạn nguồn, thêm ảnh có keyframe, màu và chuyển cảnh. Còn đo chất lượng trên dữ liệu video có cảnh được đánh dấu và thử thêm bài nhạc/âm thanh thực tế. |
| M2-A | P1 | Chờ | M1-A, key khi test live | Gemini adapter thật, model/quota theo thời điểm cấu hình, OpenAI và Claude adapters qua cùng contract, keychain, consent khi gửi tài liệu, schema cảnh, outline/VO/shot list/on-screen text/caption/hashtags/title, sửa cảnh và version history. Chi phí/quota chỉ hiển thị nếu có dữ liệu. |
| M2-B | P1 | Đang làm | M2-A, quyền giọng mẫu khi cloning | Xác minh OmniVoice upstream và license, worker localhost có capability check, phát âm tiếng Việt, audio reference có xác nhận, preset theo khả năng, TTS queue/cache/regenerate đoạn, fallback opt-in, chèn asset vào timeline. |
| M2-C | P2 | Chờ | M2-A | Tùy chọn tích hợp CLI/SDK khi user đã tự cài và đăng nhập, điều khoản đã kiểm tra. Test phân biệt quyền thuê bao và API, lỗi quota và fallback. |
| M3-A | P1 | Chờ | M1-A | Scan cancel/resume, ignore rules, incremental watcher, metadata mở rộng, contact sheet, hash, duplicate candidates, tags/rules/search. Tests về junction, symlink, mất quyền và file hỏng. |
| M3-B | P2 | Chờ | M3-A, M2-A cho cloud | Classifier opt-in theo cảnh/vật thể/chủ đề, transcript và semantic search. Dữ liệu cloud đi qua approval, thử được chế độ local. |
| M3-C | P1 | Chờ | M3-A | Copy/move có dry-run ghi rõ nguồn, đích, conflict. Xác nhận rồi thực thi với audit, backup manifest, rollback/undo và tests cho lỗi giữa chừng. |
| M3-D | P1 | Chờ | M1-B, M2 tùy step | Import manifest, permission scopes, JSON schemas, versioning, enable/disable và audit. Workflow graph có pause/resume/retry, approval gates và step registry. Mẫu idea-to-script, assets-tagging, shorts-reframe, subtitle-workflow, voice-over, video-export, social-caption và publish-checklist chạy qua step được hỗ trợ. |
| M4-A | P1 | Chờ | M1-B | Export package + cover/caption/hashtag theo platform với hướng dẫn đăng thủ công, validation per-target và lỗi có thể xử lý. |
| M4-B | P1 | Đang làm | M4-A, OAuth/app review | Kết nối Facebook Pages, Instagram Professional, Threads, TikTok bằng API chính thức. Lưu credential an toàn, scope/account type/review status, refresh/revoke và live test ở môi trường được cấp quyền. |
| M4-C | P1 | Đang làm | M4-B | Campaign có caption/hashtag/privacy/format/cover/title/CTA/lịch theo target. Approval trước upload, state machine, retry/backoff/idempotency, URL bài đăng và audit. Lịch local khi app mở, worker opt-in khi app đóng. |
| M5-A | P2 | Chờ | M1–M4 | Proxy và keyframes, HEVC/hardware tùy khả năng, hiệu năng thư viện lớn, phục hồi queue khi crash, migration và backup khôi phục được, rà soát bảo mật/riêng tư và accessibility. |
| M5-B | P1 | Đang làm | M5-A, ký phát hành | Build/test Windows 10/11 và macOS Universal, xác minh cả hai kiến trúc, ký/notarize, cập nhật và rà soát phân phối FFmpeg. |

## Tiến độ các mục đang làm

- **M1-C** hỗ trợ 12 tầng mỗi nhóm, màu, transform, tốc độ, âm lượng, fade và animation. Preview phát nhiều tầng trong WebView, hàng đợi FIFO xuất snapshot qua FFmpeg. Còn crop tự do và preset chất lượng.
- **M4-B** đã có kết nối bằng access token, keychain, kiểm tra danh tính, làm mới token và gỡ kết nối. Còn lại: live test với token thật trên từng nền tảng, luồng OAuth authorize và đổi code, hiển thị scope và trạng thái review. M4-B được làm trước M4-A theo yêu cầu ngày 10/11/2026.
- **M4-C** đã có bản nháp theo target, duyệt native trước khi gửi, state machine, chống đăng trùng khi thử lại, URL bài đăng, bản ghi trong SQLite, danh sách, sửa và xóa bài. Còn lại: campaign nhiều target, cover, CTA, lịch đăng, retry tự động có backoff và worker khi app đóng.
- **M1-H6/H8 (0.5.0)** các phép sửa nằm trong [timeline.ts](../../apps/desktop/src/timeline.ts) và có test ở [smart.test.mjs](../../scripts/smart.test.mjs). Phân tích cục bộ ở [analysis.rs](../../apps/desktop/src-tauri/src/analysis.rs). Các tính năng AI cần mô hình hoặc dịch vụ ngoài (xóa nền, avatar, lồng tiếng, dịch cloud) chưa làm và nằm ở M2/M1-J.
- **0.6.0** M2-B có lồng tiếng bằng giọng của hệ điều hành (không phải OmniVoice) qua [voice.rs](../../apps/desktop/src-tauri/src/voice.rs); dịch phụ đề bằng Claude API là phần đầu của M2-A. Xóa nền AI và avatar AI vẫn chưa làm vì cần mô hình phân đoạn hoặc dịch vụ ngoài. Phép sửa 0.6.0 có test ở [color.test.mjs](../../scripts/color.test.mjs).
- **0.7.0** M2-A/M1-J có xóa nền ảnh và video ngắn bằng mô hình `u2netp` và avatar qua HeyGen. Còn kiểm chứng HeyGen và dịch Claude với key API thật. [Generative](../../apps/desktop/src-tauri/src/generative.rs) · [Bàn giao](HANDOFF.md)
