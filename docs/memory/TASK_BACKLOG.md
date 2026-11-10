# Backlog

| ID | Ưu tiên | Trạng thái | Phụ thuộc | Tiêu chí chấp nhận |
| --- | --- | --- | --- | --- |
| M0 | P0 | Xong | Toolchain | Hai agent đọc cùng context, checker phát hiện sai lệch, sync giữ skill tự quản, app mở tới thư viện và Settings, lệnh kiểm tra tái lập. |
| M1-A | P0 | Xong | M0 | Chọn thư mục native, đọc FFprobe, tạo thumbnail FFmpeg, index SQLite, gallery và preview hoạt động với fixture, clip có thể mở lại, thu hồi kiểm tra qua native smoke. |
| M1-B | P0 | Xong | M1-A | Snapshot timeline có version, start/end/position theo mili giây, drag/drop, trim/split và undo/redo. Project mở lại giữ edit points. Render MP4 H.264/AAC từ timeline thật, xem tiến độ, hủy và thử lại, fixture đo độ dài bằng FFprobe. |
| M1-C | P1 | Đang làm | M1-B | Nhiều tầng video/ảnh/âm thanh/chữ, màu, transform, fade/volume, 9:16/16:9/1:1 và hàng đợi. Tiếp theo là crop, rotate, speed, nhiều chuyển cảnh, preset chất lượng và phát timeline theo thời gian thực. |
| M1-D | P1 | Chờ | M1-B | Subtitle thủ công và SRT round-trip, title templates, waveform và frame thumbnails. Hỗ trợ phím tắt và thao tác bàn phím. |
| M1-E | P0 | Xong | M1-C | Mẫu sẵn và mẫu cục bộ từ video, dò nhịp cắt/tỷ lệ, gán nguồn và các lớp âm thanh, tạo dự án chỉnh sửa được. |
| M1-F | P0 | Kế tiếp | M1-E | Mở rộng nhận dạng chữ, chuyển cảnh, chuyển động, nhạc và lời nói theo confidence. Cho phép xem và sửa đề xuất, giữ quyền với mẫu và giọng nói, đo chất lượng trên video tham chiếu có ground truth. |
| M2-A | P1 | Chờ | M1-A, key khi test live | Gemini adapter thật, model/quota theo thời điểm cấu hình, OpenAI và Claude adapters qua cùng contract, keychain, consent khi gửi tài liệu, schema cảnh, outline/VO/shot list/on-screen text/caption/hashtags/title, sửa cảnh và version history. Chi phí/quota chỉ hiển thị nếu có dữ liệu. |
| M2-B | P1 | Chờ | M2-A, quyền giọng mẫu khi cloning | Xác minh OmniVoice upstream và license, worker localhost có capability check, phát âm tiếng Việt, audio reference có xác nhận, preset theo khả năng, TTS queue/cache/regenerate đoạn, fallback opt-in, chèn asset vào timeline. |
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

- **M1-C** hỗ trợ 12 tầng mỗi nhóm, màu cơ bản và animation trượt. Hàng đợi FIFO xuất snapshot qua FFmpeg. Preview tại playhead hiển thị hình/chữ, còn xem liền mạch dùng MP4 đã xuất.
- **M4-B** đã có kết nối bằng access token, keychain, kiểm tra danh tính, làm mới token và gỡ kết nối. Còn lại: live test với token thật trên từng nền tảng, luồng OAuth authorize và đổi code, hiển thị scope và trạng thái review. M4-B được làm trước M4-A theo yêu cầu ngày 10/11/2026.
- **M4-C** đã có bản nháp theo target, duyệt native trước khi gửi, state machine, chống đăng trùng khi thử lại, URL bài đăng, bản ghi trong SQLite, danh sách, sửa và xóa bài. Còn lại: campaign nhiều target, cover, CTA, lịch đăng, retry tự động có backoff và worker khi app đóng.
