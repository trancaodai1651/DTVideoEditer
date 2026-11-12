# Tích hợp API

| Adapter | Mode và quyền | Kiểm chứng cần có |
| --- | --- | --- |
| FFprobe và FFmpeg | Chạy binary local từ PATH, chỉ tệp trong grant, không dùng token | Smoke test trên video, WAV, ảnh và tệp hỏng |
| Claude API (dịch phụ đề) | Đã có. HTTP thô tới `/v1/messages`, model `claude-opus-5-5`, effort `low`, `fallbacks: "default"` với beta `server-side-fallback-2026-07-01`, `anthropic-version: 2026-10-21`. Key trong keychain, hỏi xác nhận mỗi lần gửi | Chưa gọi thật. Cần key để live test, kiểm tra lỗi 401/429 và refusal |
| Giọng đọc hệ điều hành | Đã có. Windows System.Speech, macOS `say`. Không cần mạng | Đã chạy thật trên Windows 11. macOS chưa thử |
| Gemini, Claude, OpenAI | M2. User cung cấp key trong OS keychain, chọn provider/model, đồng ý với dữ liệu gửi | Schema validation và lỗi auth/rate limit. Live test theo quyền và quota hiện hành |
| Codex và Claude CLI/SDK | M2. User tự cài, đăng nhập và chọn opt-in | Kiểm tra điều khoản và capability. Tách auth CLI khỏi billing API |
| OmniVoice | M2. Xác minh upstream `k2-fsa/OmniVoice`, Python worker localhost, quyền với giọng tham chiếu | Xác minh license và runtime, chất lượng tiếng Việt, fallback khi máy không đủ khả năng |
| Threads | Đã có adapter. `graph.threads.com/v1.0`, token dài hạn, scope `threads_basic`, `threads_content_publish`, `threads_delete`. Media chỉ qua URL công khai | Live test đăng chữ, ảnh, video, xóa và refresh |
| Facebook Pages | Đã có adapter. Graph API `v26.0`, Page access token, scope `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`. Ảnh và video tải multipart, Reel qua `rupload` | Live test từng định dạng, sửa, xóa. Xác nhận host tải video |
| Instagram | Đã có adapter cho Instagram Login (`graph.instagram.com`) và Page token (`graph.facebook.com`). Resumable upload và xóa chỉ có ở kiểu Page token, xóa cần `instagram_manage_contents` | Live test ảnh, Reel qua URL, Reel từ tệp, xóa, refresh |
| TikTok Content Posting | Đã có adapter. `open.tiktokapis.com/v2`, scope `user.info.basic`, `video.publish`, `video.list`. Direct post `FILE_UPLOAD` theo chunk | Live test với app sandbox: privacy, chunk, trạng thái, refresh |

Khi mở M2, đối chiếu lại model, free tier và quota từ tài liệu chính thức ở thời điểm triển khai. Khi chưa có API approval, đường phát hành là export package và đăng thủ công ở M4-A.

## Ghi chú đối chiếu M4 ngày 10/11/2026

Contract của bốn adapter lấy từ tài liệu chính thức của Meta và TikTok đọc ngày 10/11/2026. Chưa có request nào chạy với token thật.

- Tài liệu Meta dùng `v27.0` trong ví dụ nhưng bảng phiên bản chỉ liệt kê tới `v26.0` (phát hành 29/07/2026). Source dùng `v26.0`.
- Tài liệu video của Meta vừa nói `graph-video.facebook.com` đã ngừng, vừa còn ví dụ dùng host này. Source gửi video tới `graph.facebook.com` và giữ host trong `Endpoints` để đổi nhanh.
- `GET /me` với Page token trả về Page là hành vi lâu năm nhưng tài liệu hiện tại không nêu. Cần xác nhận khi live test.
- Threads và Instagram không có sửa nội dung bài. TikTok có scope `video.manage` nhưng chưa công bố endpoint sửa hay xóa.
- Giới hạn đáng nhớ: Threads 250 bài và 100 lần xóa mỗi 24 giờ, Facebook 30 Reel mỗi Page mỗi 24 giờ, Instagram 50 hoặc 100 bài mỗi 24 giờ tùy trang tài liệu, TikTok khoảng 15 bài mỗi creator mỗi ngày.
- App secret của Meta và client secret của TikTok cần cho bước đổi code OAuth. Luồng OAuth vì thế chưa làm và phải quyết định nơi giữ secret trước.
