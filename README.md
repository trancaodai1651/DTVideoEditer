# AI Video Studio

Ứng dụng desktop biên tập video lưu dữ liệu trên máy. Thư viện, player, bảng thuộc tính và timeline nhiều tầng nằm trong cùng màn hình. Có kho mẫu cục bộ và hàng đợi xuất MP4.

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
2. Mở ứng dụng, bấm **Nhập tệp** rồi chọn cùng lúc các tệp mẫu. Cũng có thể thả tệp từ Explorer/Finder hoặc dùng nút thư mục để quét cả thư mục.
3. Mở **Dự án** trên thanh trên cùng và tạo dự án. Chọn video, phát trong **Nguồn**, rồi bấm **Thêm vào timeline** hoặc kéo tệp từ thư viện vào tầng. Làm tương tự với WAV để thấy hai nhóm.
4. Trên timeline, kéo clip theo thời gian hoặc sang tầng cùng loại. Kéo hai mép để trim. Dùng thanh zoom, **Vừa khung** hoặc giữ Ctrl/⌘ khi cuộn để đổi tỷ lệ thước. Bấm thước để đặt playhead rồi bấm **Tách** (phím `S`). `Ctrl+Z` và `Ctrl+Y` hoàn tác và làm lại.
5. Bấm **Xuất và chạy hàng đợi**, chọn tên tệp MP4 trong hộp thoại. Tiến độ hiện trong **Hàng đợi xuất**, có thể hủy hoặc thử lại.
6. Đóng rồi mở lại ứng dụng để kiểm tra dữ liệu đã lưu. Trong **Cài đặt**, có thể kiểm tra FFmpeg, quét lại và thu hồi thư mục. Thu hồi gỡ metadata và clip tham chiếu khỏi ứng dụng. Tệp gốc vẫn nằm trong thư mục.

Ứng dụng dùng thư mục dữ liệu Tauri cho `studio.dtedit.desktop` và lưu trong `studio.sqlite3`. Bản debug nhận biến môi trường `STUDIO_DEV_DATA_DIR` với đường dẫn tuyệt đối để chạy kiểm thử trên cơ sở dữ liệu riêng.

## Biên tập và xuất hàng loạt

1. Trong **Biên tập**, thêm tầng video, âm thanh hoặc chữ trên toolbar timeline. Kéo media từ thư viện vào đúng tầng hoặc chọn tầng rồi thêm từ khung **Nguồn**. Tầng video số lớn hơn nằm phía trên. Chọn clip để chỉnh màu, vị trí, tỷ lệ, độ đục, âm lượng, fade hoặc animation trong **Thuộc tính**.
2. Thêm chữ, sticker và âm thanh ở thanh thư viện. Trong **Bản dựng**, dừng phát rồi kéo video, ảnh, sticker hoặc chữ ngay trên preview. Kéo góc để đổi cỡ video hoặc ảnh, kéo nút tròn để xoay. Dùng menu zoom cạnh tỷ lệ khung để phóng riêng preview. Một số xử lý nâng cao như ổn định, khử nhiễu và chroma key hiện đầy đủ trong MP4.
3. Trong **Mẫu dựng**, chọn preset hoặc video từ thư viện rồi bấm **Phân tích và lưu mẫu**. FFmpeg dò điểm cắt và tỷ lệ khung của video dài từ 0,5 giây đến 3 phút. Gán nguồn từng đoạn, hiệu ứng màu, animation, chuyển cảnh, chữ, nhạc, SFX và voice. **Tạo dự án từ mẫu** mở một dự án mới có thể chỉnh tiếp.
4. Chọn clip hình và dùng nút diamond để đặt keyframe vị trí, cỡ, xoay và opacity. Trong **Chuyển cảnh**, chọn clip sau ở mối nối rồi chọn **Hòa trộn** hoặc **Qua đen**. Timeline hiển thị waveform và inspector âm thanh có gain dB, fade đầu và fade cuối.
5. Dùng **In** và **Out** nếu muốn xuất riêng một vùng. Trên từng dự án, bấm **Thêm vào hàng đợi** và chọn tên MP4. Mở **Hàng đợi xuất** rồi bấm **Chạy hàng đợi** để xử lý lần lượt. Lượt chờ giữ phạm vi đã chọn khi đóng ứng dụng.

Trong **Phụ đề**, tạo câu thủ công hoặc nhập SRT UTF-8. Có thể xuất SRT từ các lớp đã đánh dấu là phụ đề. Để nhận dạng, chọn một clip có tiếng, ngôn ngữ và mô hình Whisper GGML `.bin`. Dùng bản FFmpeg có filter `whisper`. Kiểm tra bằng `ffmpeg -h filter=whisper`. [FFmpeg Whisper](https://ffmpeg.org/ffmpeg-filters.html#whisper) · [Mô hình Whisper](https://github.com/ggml-org/whisper.cpp#quick-start)

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

`pnpm test:media` tạo media mẫu, phân tích điểm cắt, render MP4 nhiều tầng và kiểm tra các pixel của màu/chữ. Cần `libx264` và filter `drawtext`. Các test đăng bài dùng máy chủ giả lập cục bộ. [Backlog](docs/memory/TASK_BACKLOG.md)

## Tạo bộ cài

- Windows x64 chạy `pnpm tauri build --bundles nsis --ci`. Bộ cài nằm trong `apps/desktop/src-tauri/target/release/bundle/nsis/`. Cài FFmpeg và FFprobe riêng để phân tích và xuất.
- Trên macOS có Xcode, chạy `rustup target add aarch64-apple-darwin x86_64-apple-darwin`, sau đó `pnpm tauri build --target universal-apple-darwin --bundles app,dmg --ci`. Workflow bộ cài chạy thủ công hoặc khi push tag `v*`. DMG dùng chữ ký ad hoc cho kiểm thử. Bản phân phối công khai cần Developer ID và notarization. [Workflow bộ cài](.github/workflows/installers.yml) · [Tauri DMG](https://v2.tauri.app/distribute/dmg/)

## Tiếp quản dự án

Codex và Claude Code dùng chung tài liệu trong `docs/memory`. Chạy `pnpm context:summary` để đọc điểm vào, trạng thái và bàn giao. Chỉnh sửa developer skill trong catalog rồi chạy `pnpm skills:sync` để cập nhật hai bản sao đã được quản lý. [Bản đồ dự án](docs/memory/PROJECT_INDEX.md) · [Skill catalog](skills/catalog)
