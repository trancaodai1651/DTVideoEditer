# AI Video Studio

Ứng dụng desktop biên tập video lưu dữ liệu trên máy. Bản hiện tại có thư viện media tiếng Việt, trình chọn thư mục native, metadata FFprobe, ảnh thu nhỏ FFmpeg, xem trước, timeline hai track với trim, split, undo/redo, xuất MP4 H.264/AAC, và đăng bài lên Threads, Facebook Page, Instagram, TikTok bằng API chính thức.

## Chạy ứng dụng

- Windows 10/11 cần Rust với target MSVC, Microsoft C++ Build Tools và WebView2. macOS cần Xcode Command Line Tools và Rust. [Điều kiện cài đặt của Tauri](https://v2.tauri.app/start/prerequisites/)
- Cần Node.js 24 trở lên, pnpm 12.18.0, Rust 1.95 trở lên và cả `ffmpeg` lẫn `ffprobe` trên `PATH` để chạy toàn bộ demo. [FFmpeg](https://ffmpeg.org/download.html)

```sh
pnpm install --frozen-lockfile
pnpm tauri dev
```

Nếu đang dùng Corepack, chạy `corepack enable` để kích hoạt shim pnpm. Trên Windows, có thể dùng `pnpm.cmd` nếu PowerShell chặn script `pnpm.ps1`.

## Thử luồng media

1. Chạy `pnpm demo:media`. Lệnh tạo video MP4, WAV và PNG trong một thư mục tạm và in đường dẫn.
2. Mở ứng dụng, chọn **Chọn thư mục**, rồi chọn thư mục mẫu. Sau khi quét, thư viện hiển thị ba tệp.
3. Tạo một dự án ở thanh bên. Chọn video, phát trong **Xem trước**, rồi bấm **Thêm vào timeline** hoặc kéo tệp từ thư viện vào track. Làm tương tự với WAV để thấy hai track.
4. Trên timeline, kéo clip để di chuyển và kéo hai mép để cắt. Bấm vào thước để đặt vạch thời gian rồi bấm **Tách** (phím `S`). `Ctrl+Z` và `Ctrl+Y` hoàn tác và làm lại. Mọi thay đổi được lưu ngay.
5. Bấm **Xuất MP4**, chọn nơi lưu trong hộp thoại. Tiến độ hiện dưới timeline, có thể hủy hoặc thử lại.
6. Đóng rồi mở lại ứng dụng để kiểm tra dữ liệu đã lưu. Trong **Cài đặt**, có thể kiểm tra FFmpeg, quét lại và thu hồi thư mục. Thu hồi gỡ metadata và clip tham chiếu khỏi ứng dụng. Tệp gốc vẫn nằm trong thư mục.

Ứng dụng dùng thư mục dữ liệu Tauri cho `studio.dtedit.desktop` và lưu trong `studio.sqlite3`. Bản debug nhận biến môi trường `STUDIO_DEV_DATA_DIR` với đường dẫn tuyệt đối để chạy kiểm thử trên cơ sở dữ liệu riêng.

## Đăng bài lên mạng xã hội

Mở **Đăng bài**, chọn nền tảng và dán access token lấy từ app nhà phát triển của bạn. Ứng dụng xác minh token với nền tảng, lưu token vào keychain của hệ điều hành và chỉ giữ tên tài khoản trong cơ sở dữ liệu.

| Nền tảng | Token cần có | Ghi chú |
| --- | --- | --- |
| Threads | Token dài hạn, quyền `threads_basic`, `threads_content_publish`, `threads_delete` | Ảnh và video chỉ đăng qua URL công khai |
| Facebook Page | Page access token, quyền `pages_manage_posts`, `pages_read_engagement`, `pages_show_list` | Đăng chữ, ảnh, video, Reel từ tệp trên máy. Sửa và xóa được |
| Instagram | Token Instagram Login, hoặc Page access token của Page đã liên kết | Kiểu Page token đăng được Reel từ tệp trên máy và xóa bài |
| TikTok | Access token quyền `user.info.basic`, `video.publish`, `video.list` | App chưa qua kiểm duyệt chỉ đăng riêng tư. Nhập refresh token, client key và client secret để tự làm mới token |

Soạn bài rồi **Lưu bản nháp**. Bấm **Duyệt và đăng** để mở hộp thoại xác nhận của hệ điều hành, bài chỉ được gửi sau khi bạn đồng ý ở đó. Media lấy từ URL công khai, tệp đang chọn trong thư viện hoặc video đã xuất của dự án. Mục **Bài trên nền tảng** tải danh sách bài trực tiếp từ API để sửa hoặc xóa.

Phần đăng bài mới được kiểm tra với máy chủ giả lập theo tài liệu chính thức, chưa chạy với token thật. Đăng nhập OAuth, lịch đăng và campaign nằm trong backlog. [Chi tiết](docs/memory/modules/publishing.md)

## Kiểm tra và build

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:native
pnpm test:media
pnpm context:check
pnpm skills:check
pnpm tauri build --no-bundle
```

`pnpm test:media` tạo tệp thật trong thư mục tạm bằng FFmpeg, render một timeline đã cắt rồi đo MP4 bằng FFprobe, và cần encoder `libx264`. `pnpm test:native` gồm test cho bốn adapter đăng bài chạy với máy chủ cục bộ, không gọi ra mạng. Lệnh build cuối tạo executable native. Bộ cài có chữ ký, hiệu ứng và chữ trên video, AI, giọng đọc và lịch đăng nằm trong các mốc tiếp theo. [Backlog](docs/memory/TASK_BACKLOG.md)

## Tiếp quản dự án

Codex và Claude Code dùng chung tài liệu trong `docs/memory`. Chạy `pnpm context:summary` để đọc điểm vào, trạng thái và bàn giao. Chỉnh sửa developer skill trong catalog rồi chạy `pnpm skills:sync` để cập nhật hai bản sao đã được quản lý. [Bản đồ dự án](docs/memory/PROJECT_INDEX.md) · [Skill catalog](skills/catalog)
