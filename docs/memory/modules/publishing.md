# Publishing

Module [publish](../../../apps/desktop/src-tauri/src/publish/mod.rs) đăng và quản lý bài trên Threads, Facebook Page, Instagram và TikTok bằng API chính thức. Giao diện ở [PublishPanel](../../../apps/desktop/src/PublishPanel.tsx).

## Luồng

1. **Kết nối** người dùng dán access token. Native gọi API để xác minh danh tính, lưu token vào keychain của hệ điều hành ([secrets.rs](../../../apps/desktop/src-tauri/src/publish/secrets.rs)) và chỉ ghi tham chiếu vào `connected_accounts`.
2. **Bản nháp** `create_publish_draft` kiểm tra theo quy tắc từng nền tảng (`check_draft`) rồi lưu vào `publishing_jobs`. Media là URL https, asset ID trong thư viện hoặc ID của lượt xuất đã xong.
3. **Duyệt** `approve_publish` mở hộp thoại native ghi rõ tài khoản, định dạng, media và nội dung. Chỉ khi người dùng đồng ý thì job chuyển sang `publishing` và một worker gửi đi.
4. **Kết quả** job thành `published` kèm ID và liên kết, hoặc `failed` kèm lỗi. `remote_ref` giữ container hoặc publish ID để lần thử lại tiếp tục thay vì đăng trùng.
5. **Quản lý** `list_remote_posts` đọc trực tiếp từ nền tảng. Xóa và sửa cũng qua hộp thoại native.

## Khả năng theo nền tảng

| Nền tảng | Đăng | Media từ máy | Sửa | Xóa | Làm mới token |
| --- | --- | --- | --- | --- | --- |
| [Threads](../../../apps/desktop/src-tauri/src/publish/threads.rs) | Chữ, ảnh, video | Không, chỉ URL công khai | Không | Có | Có |
| [Facebook Page](../../../apps/desktop/src-tauri/src/publish/facebook.rs) | Chữ, ảnh, video, Reel | Có | Nội dung chữ | Có | Không cần với Page token dài hạn |
| [Instagram](../../../apps/desktop/src-tauri/src/publish/instagram.rs) qua Instagram Login | Ảnh JPEG, Reel | Không, chỉ URL | Không | Không | Có |
| Instagram qua Facebook Page | Ảnh JPEG, Reel | Reel (resumable upload) | Không | Có | Không |
| [TikTok](../../../apps/desktop/src-tauri/src/publish/tiktok.rs) | Video | Có, tải theo chunk | Không | Không | Có, cần client key và secret |

Bảng này khớp với `capabilities()` trong source. UI chỉ hiện lựa chọn mà tài khoản làm được.

## Chi tiết cần nhớ

- Graph API dùng một hằng số version trong [http.rs](../../../apps/desktop/src-tauri/src/publish/http.rs). Host và nhịp polling nằm trong `Endpoints` để test trỏ sang máy chủ cục bộ.
- TikTok yêu cầu hỏi `creator_info` trước mỗi lần đăng và chỉ nhận mức hiển thị có trong danh sách trả về. Ứng dụng chưa qua kiểm duyệt của TikTok chỉ đăng được `SELF_ONLY` lên tài khoản riêng tư.
- Token TikTok sống vài giờ, nên khi có refresh token ứng dụng làm mới trước khi gọi. Token Threads và Instagram Login được làm mới khi còn dưới 7 ngày.
- [records.rs](../../../apps/desktop/src-tauri/src/publish/records.rs) giữ SQL của hai bảng trong [migration 003](../../../apps/desktop/src-tauri/migrations/003_publishing.sql).

## Chưa làm

OAuth authorize và đổi code (cần app ID, secret và redirect đã đăng ký), campaign nhiều target, lịch đăng, retry tự động có backoff, carousel, story, comment và insights. Chưa có lần gọi API thật nào: [tests.rs](../../../apps/desktop/src-tauri/src/publish/tests.rs) kiểm tra hình dạng request với máy chủ giả lập. Xem [tích hợp API](../API_INTEGRATIONS.md), [bảo mật](../SECURITY.md) và [backlog M4](../TASK_BACKLOG.md).
