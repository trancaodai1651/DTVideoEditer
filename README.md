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
3. Kéo video hoặc WAV từ thư viện hoặc Explorer/Finder vào timeline. Lần thả đầu sẽ tạo dự án nếu chưa có. Cũng có thể bấm dấu `+` trên thẻ media để thêm tại playhead. Thả hình vào dải phía trên Video để tạo tầng phủ, hoặc thả WAV phía dưới các tầng âm thanh để tạo thêm tầng.
4. Trên timeline, kéo clip theo thời gian hoặc sang tầng cùng loại. Kéo hai mép để trim. Dùng thanh zoom, **Vừa khung** hoặc giữ Ctrl/⌘ khi cuộn để đổi tỷ lệ thước. Bấm thước để đặt playhead. Dùng trái/phải để bước từng frame, lên/xuống để tới điểm cắt và `S` để tách. `Ctrl+Z` và `Ctrl+Y` hoàn tác và làm lại.
5. Bấm **Xuất và chạy hàng đợi**, chọn tên tệp MP4 trong hộp thoại. Tiến độ hiện trong **Hàng đợi xuất**, có thể hủy hoặc thử lại.
6. Đóng rồi mở lại ứng dụng để kiểm tra dữ liệu đã lưu. Trong **Cài đặt**, có thể kiểm tra FFmpeg, quét lại và thu hồi thư mục. Thu hồi gỡ metadata và clip tham chiếu khỏi ứng dụng. Tệp gốc vẫn nằm trong thư mục.

Ứng dụng dùng thư mục dữ liệu Tauri cho `studio.dtedit.desktop` và lưu trong `studio.sqlite3`. Bản debug nhận biến môi trường `STUDIO_DEV_DATA_DIR` với đường dẫn tuyệt đối để chạy kiểm thử trên cơ sở dữ liệu riêng.

## Biên tập và xuất hàng loạt

1. Trong **Biên tập**, thêm tầng video, âm thanh hoặc chữ trên toolbar timeline. Kéo media từ thư viện vào đúng tầng hoặc chọn tầng rồi thêm từ khung **Nguồn**. Tầng video số lớn hơn nằm phía trên. Chọn clip để chỉnh màu, vị trí, tỷ lệ, độ đục, âm lượng, fade hoặc animation trong **Thuộc tính**.
2. Thêm chữ, sticker và âm thanh ở thanh thư viện. Trong **Bản dựng**, dừng phát rồi kéo video, ảnh, sticker hoặc chữ ngay trên preview. Kéo góc để đổi cỡ video hoặc ảnh, kéo nút tròn để xoay. Dùng menu zoom cạnh tỷ lệ khung để phóng riêng preview. Một số xử lý nâng cao như ổn định, khử nhiễu và chroma key hiện đầy đủ trong MP4.
3. Trong **Mẫu dựng**, chọn preset hoặc video từ thư viện rồi bấm **Phân tích và lưu mẫu**. FFmpeg dò điểm cắt và tỷ lệ khung của video dài từ 0,5 giây đến 3 phút. Gán nguồn từng đoạn, hiệu ứng màu, animation, chuyển cảnh, chữ, nhạc, SFX và voice. **Tạo dự án từ mẫu** mở một dự án mới có thể chỉnh tiếp.
4. Chọn clip hình và dùng nút diamond để đặt keyframe vị trí, cỡ, xoay và opacity. Trong **Chuyển cảnh**, chọn clip sau ở mối nối rồi chọn **Hòa trộn** hoặc **Qua đen**. Timeline hiển thị waveform và inspector âm thanh có gain dB, fade đầu và fade cuối.
5. Dùng **In** và **Out** nếu muốn xuất riêng một vùng. Trên từng dự án, bấm **Xếp hàng** và chọn tên MP4. Mở **Hàng đợi xuất** rồi bấm **Chạy hàng đợi** để xử lý lần lượt. Lượt chờ giữ phạm vi và trạng thái ẩn/tắt tiếng của các tầng khi đóng ứng dụng.

Trong **Phụ đề**, tạo câu thủ công hoặc nhập SRT UTF-8. Chọn clip có tiếng và ngôn ngữ rồi bấm **Tạo phụ đề**. Bộ cài dùng model Whisper đa ngôn ngữ đi kèm. Khi model thiếu, ứng dụng tự tải bản cố định và kiểm tra SHA-256. Clip dài được xử lý theo từng đoạn 5 phút với mốc giờ liên tục. **Mô hình tùy chọn** là nơi chọn tệp GGML khác. Dùng FFmpeg có filter `whisper` và kiểm tra bằng `ffmpeg -h filter=whisper`. [FFmpeg Whisper](https://ffmpeg.org/ffmpeg-filters.html#whisper) · [Whisper](https://github.com/ggml-org/whisper.cpp#quick-start)

Để chuyển timeline, vào **Dự án → Xuất cho Adobe Premiere (.xml)…**, rồi chọn **File → Import** trong Premiere. Nhập thêm `.srt` cùng tên nếu dự án có phụ đề. Chọn **File → Save As** để lưu thành `.prproj`. XML chuyển tham chiếu media gốc, điểm cắt, tầng hình/tiếng và gain cơ bản. Màu, chuyển cảnh, chữ đồ họa và retime phức tạp cần kiểm tra lại. [Nhập XML trong Premiere](https://helpx.adobe.com/premiere/desktop/organize-media/import-files/migrate-from-final-cut-pro-x.html)

## Dựng nâng cao

- Nhấp chuột phải vào clip, tên tầng hoặc vùng trống để mở menu thao tác. Kéo trên chỗ trống của tầng để chọn nhiều clip bằng khung.
- **Tách âm thanh** (`Ctrl+Shift+S`) đưa tiếng của video ra tầng âm thanh riêng, chọn lại để khôi phục. `V` tắt hoặc bật clip mà vẫn giữ chỗ trên timeline. `Q` và `W` xóa phần trước hoặc sau playhead rồi dồn clip.
- `Alt+G` gom các clip đã chọn thành compound; nhấp đúp để mở hoặc thu gọn. Chọn 2–9 video trên các tầng khác nhau rồi chọn **Tạo multicam**, sau đó nhấn `1`–`9` khi phát để chuyển góc.
- `Ctrl+R` mở **Tốc độ**: tốc độ cố định 0,1–10× hoặc **Đường cong** với preset và đồ thị kéo điểm. Kéo hai núm tròn trên clip âm thanh để chỉnh fade. Meter cạnh thời gian trình phát hiển thị mức tiếng tại playhead.
- Tab **Thông minh** chạy trên máy: dò cảnh và tách, xóa khoảng lặng, đánh dấu nhịp nhạc, bám theo chuyển động (vẽ khung quanh vật thể trên trình phát) và phụ đề Whisper. Kéo vách giữa ba cột để đổi chiều rộng.
- **Màu**: chọn clip → Thuộc tính › Điều chỉnh có Cơ bản (phơi sáng, vùng sáng/tối, điểm trắng/đen, nhiệt độ, sắc độ, tông, bão hòa, rực màu), Bánh xe (Lift/Gamma/Gain), HSL sáu dải màu, Đường cong (tổng và R/G/B kéo điểm) và LUT (nhập tệp .cube). Bấm **+ Lớp điều chỉnh** để chỉnh màu cho mọi hình bên dưới trong một khoảng thời gian.
- **Chữ**: chọn lớp chữ để đổi phông, màu, viền, nền, căn lề, bóng, hiện/ẩn dần và giãn dòng.
- **Menu chuột phải trên clip** có sao chép/dán thuộc tính (`Ctrl+Shift+C/V`), thay bằng media đang chọn trong thư viện, khung hình tĩnh, đảo ngược, mở timeline con của compound và tạo multicam đồng bộ theo âm thanh.
- **Lồng tiếng và dịch** trong tab Thông minh: tạo lời đọc bằng giọng của Windows/macOS; dịch toàn bộ phụ đề bằng Claude API (dán Anthropic API key một lần, ứng dụng hỏi xác nhận trước mỗi lần gửi chữ).

## Dựng tự động và công cụ AI

- **Thông minh → Dựng tự động từ timeline** đọc hết khoảng đã đặt trên timeline. **Chọn cảnh highlight** chấm chuyển động (trừ rung máy), độ nét, màu, ánh sáng và âm thanh; mặc định không giới hạn thời lượng và giữ mọi cảnh nổi bật, bật **Giới hạn thời lượng tối đa** nếu cần bản ngắn. **Dựng theo âm thanh** dài đúng timeline âm thanh đã chọn, căn điểm cắt theo nhịp, giữ thời điểm tương đối và tầng tiếng. Hai chế độ tạo dự án riêng để sửa tiếp. FFmpeg thử giải mã và thu nhỏ bằng GPU khi có, rồi chuyển sang CPU nếu không hỗ trợ.
- **Proxy** trong trình phát mặc định tắt. Bấm **Proxy** để tạo và dùng proxy H.264 720p cho video đang xem, hoặc chuột phải trong trình phát để tạo proxy cho clip khác. Proxy đã tạo được dùng lại khi bật. Xuất MP4 và **Xem bản xuất** dùng media gốc.
- Trong menu **Dự án**, chọn **Lưu dự án thành tệp…** rồi chọn thư mục và tên `.dtedit`. **Mở tệp dự án…** tạo dự án có thể sửa từ bản đã lưu. Tệp giữ timeline và LUT, tham chiếu media tại vị trí gốc. Khi chuyển sang thư viện mới, nhập lại nguồn từ vị trí gốc trước khi mở.
- **Xem bản xuất** trong trình phát dùng FFmpeg để xem tối đa 20 giây từ playhead, gồm LUT, chỉnh màu và video đảo ngược.
- Chọn clip rồi mở **Thông minh → Xóa nền AI**. Bộ cài phát hành 0.8.1 chứa runtime `rembg` và mô hình U²-Net nhỏ, tự giải nén lần đầu. Bản chạy từ source có thể dùng `rembg[cpu,cli]` trên PATH. Video cần FFmpeg và đoạn trim 0,5–8 giây. Với video alpha, dùng **Xem bản xuất** nếu trình phát tương tác thiếu codec. [rembg](https://github.com/danielgatis/rembg)
- **Thông minh → Avatar AI** cần HeyGen API key, Avatar ID và Voice ID. Tạo job từ kịch bản, kiểm tra trạng thái rồi nhập MP4. [HeyGen API](https://developers.heygen.com/reference/create-video)

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
