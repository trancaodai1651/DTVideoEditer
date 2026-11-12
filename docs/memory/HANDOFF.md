# Bàn giao

Snapshot: 2026-11-12/EDITOR-041

## Điểm vào cho Claude Code hoặc Codex

Chạy `pnpm context:summary` và `git status -sb`. Đọc [bản đồ dự án](PROJECT_INDEX.md), [trạng thái](CURRENT_STATE.md), [khảo sát CapCut](CAPCUT_DESKTOP_AUDIT.md) và [backlog](TASK_BACKLOG.md). Người dùng muốn DT_Edit có thao tác timeline, preview, các thư viện và thuộc tính tương tự CapCut Desktop, kho mẫu từ video tham chiếu, hàng đợi xuất nhiều dự án và bộ cài Windows/macOS Universal. Người dùng đã cho phép push source lên `origin` và chạy GitHub Actions. Tiếp tục M1-H3, rồi M1-H6 và M1-F. Đọc [quyền media](SECURITY.md) trước khi sửa quyền, picker hoặc native drop.

Phiên khảo sát dùng Computer Use trên CapCut Windows 9.7.1.4203, draft tổng hợp **1111 (1)**. Đã thử import nhiều tệp, split theo frame, trim với magnet/linkage, chọn phải, group/compound, keyframe, Black Fade, kéo chữ, mask hình chữ nhật, SRT tiếng Việt, fade và kéo clip WAV, lớp hiệu ứng riêng, zoom vừa khung, xuất MP4 toàn timeline và xuất riêng range In–Out. Người dùng chưa có quyền CapCut Pro. Dùng ca CC-06/CC-07 cho thao tác timeline, CC-14 cho keyframe, CC-18/CC-19 cho audio và CC-23/CC-29 cho nối cảnh và xuất vùng. [Kết quả khảo sát](CAPCUT_DESKTOP_AUDIT.md)

## Bản 0.4.1

- Người dùng báo bản 0.4.0 không kéo được tệp xuống timeline. Tauri/Wry chuyển sự kiện của webview chính thành `WindowEvent::DragDrop`. Bản 0.4.0 đăng ký `on_webview_event`, nên nhánh import native không nhận event. Bản 0.4.1 đổi sang `on_window_event`, gửi tọa độ và ID đã cấp quyền, đồng thời báo khi rê tệp qua timeline. [Native drop](../../apps/desktop/src-tauri/src/main.rs)
- Kéo từ Gallery và native drop dùng cùng hàm đặt clip, kiểm tra tầng khóa, giới hạn và hít mép. Một lượt nhiều tệp giữ thứ tự riêng cho hình và audio. Thả khi chưa có dự án tạo dự án và clip trong giao dịch. Nút `+` trên thẻ thêm tại playhead. [Phép sửa](../../apps/desktop/src/timeline.ts) · [Timeline](../../apps/desktop/src/TimelineEditor.tsx)
- Có vùng thả hình phủ phía trên Video và audio ở dưới. Ruler đặt focus để dùng I/O và phím mũi tên. Trái/phải bước frame ở 30 fps, lên/xuống đến điểm cắt, `Home/End` đến đầu/cuối. Có vách chia chiều cao timeline và một hàng tab công cụ cuộn ngang.
- Filmstrip tạo 8 ảnh ở các mốc nguồn bằng FFmpeg, cache SQLite và cắt theo trim. Khóa tầng chặn chỉnh sửa, ẩn chỉ ảnh/chữ, tắt tiếng chỉ audio. Preview và MP4 dùng hai công tắc độc lập. [Migration 007](../../apps/desktop/src-tauri/migrations/007_filmstrips.sql) · [Migration 008](../../apps/desktop/src-tauri/migrations/008_lane_controls.sql) · [Renderer](../../apps/desktop/src-tauri/src/render.rs)
- Handoff vẫn theo dõi mục tiêu UI và thao tác tương đương CapCut. M1-H3 tiếp theo là tách/khôi phục audio, meter và tay nắm fade. M1-H8 còn sidebar thư viện, menu chuột phải và đổi chiều rộng panel. M1-H6 còn compound, multicam, speed curve, tracking, rich text và lớp hiệu ứng/LUT. M1-F còn nhận dạng chữ, hiệu ứng, chuyển động, nhạc và voice từ video mẫu. M1-J còn công cụ Pro/cloud theo tài khoản và macOS. [Backlog](TASK_BACKLOG.md)

**Kiểm chứng Windows**

- Bản Tauri chạy bằng frontend production, với app ID `studio.dtedit.desktop.qa041` và SQLite riêng. Người dùng nhập rồi kéo từ thư viện vào timeline, sau đó xác nhận kéo trực tiếp MP4 từ Explorer vào chỗ trống cũng tạo clip trên timeline. Quan sát cửa sổ QA có dự án tự tạo, ba tầng video, filmstrip, preview và trạng thái đã lưu. Truy vấn QA ở chế độ chỉ đọc xác nhận schema 8, sáu clip trên ba tầng video, hai quyền theo tệp và hai filmstrip. Kiểm thử Finder và độ phân giải DPI khác còn mở.
- 22 test Node, 21 test Rust và 5 test FFmpeg đạt. Fixture FFmpeg giải mã JPEG filmstrip 768×54 và kiểm tra khung đầu/cuối khác màu. Native test kiểm tra khôi phục trạng thái tầng và audio/video graph khi ẩn hoặc tắt tiếng độc lập.
- Trước khi dùng lại bản 0.4.0, lưu ý schema dữ liệu 0.4.1 là `user_version = 8`. Các trường mới có giá trị mặc định khi nâng cấp. Timeline JSON vẫn version 3.

**Ca chạy lại khi sửa kéo thả**

1. Chạy `pnpm demo:media`. Build `pnpm tauri build --no-bundle --ci --config <tauri-qa.json>` với app identifier riêng, giữ `dragDropEnabled: true` và label `main`. Cửa sổ QA dùng cấu hình 1280×720 để thấy lỗi thanh công cụ che tầng chính.
2. Mở QA với DB trống, nhập MP4/WAV từ picker và kéo thẻ MP4 vào hàng Video 1. Kiểm tra dự án tự tạo, clip được chọn và preview đọc nguồn. Thả một video/ảnh vào vùng ngay trên Video 1 để tạo tầng phủ.
3. Từ Explorer/Finder kéo WAV và MP4 vào timeline, rồi thả một ảnh vào thư viện. Kiểm tra thả vào timeline tạo clip đúng loại, còn thả vào thư viện chỉ thêm asset. Thử lại với zoom timeline và DPI khác nhau. Mở lại để kiểm tra các clip đã lưu.

**Bộ cài và revision**

- Commit build là `229a33850a27ff3dc0783737081714f9c9531c21`, tag `v0.4.1`. CI Windows và macOS đạt. Hai job đóng gói đạt. `lipo` xác nhận `x86_64 arm64` và `hdiutil` xác nhận checksum DMG hợp lệ. DMG ký ad hoc, bộ cài Windows chưa ký. Hai nền tảng cần FFmpeg và FFprobe trên PATH. [CI](https://github.com/trancaodai1651/DTVideoEditer/actions/runs/43136856929) · [Bộ cài](https://github.com/trancaodai1651/DTVideoEditer/actions/runs/43136856838) · [Tag](https://github.com/trancaodai1651/DTVideoEditer/tree/v0.4.1)
- Đã đối chiếu SHA-256 archive GitHub, giải nén và băm các tệp trong `apps/desktop/src-tauri/target/verified-installers/v0.4.1`.

| Bộ cài | SHA-256 của tệp |
| --- | --- |
| `AI Video Studio_0.4.1_x64-setup.exe` | `48799eb8961b5125669ecebc83993dfbe9cc85fca30b0acc04149303a3e36697` |
| `AI Video Studio_0.4.1_universal.dmg` | `25d4c1fb8a98d09b6bf4b6e1a4594579024c3e2671b3e74c08b8f6c93288feb0` |

## Bản 0.4.0

- M1-H1. [Native picker và drop](../../apps/desktop/src-tauri/src/main.rs), [cấp quyền](../../apps/desktop/src-tauri/src/library.rs) và [migration 005](../../apps/desktop/src-tauri/migrations/005_file_grants.sql). Các lệnh đọc nguồn dùng `authorized_asset`. Drop vào timeline lấy dự án, tầng và thời điểm tại lúc thả rồi đặt các clip theo loại sau khi index.
- M1-H2. [Phép sửa timeline](../../apps/desktop/src/timeline.ts) xử lý dồn clip chính, liên kết tầng phía sau, hít mép, chọn theo hướng, group, clipboard và undo. Marker giữ theo dự án trong WebView. Mốc In/Out được dùng cho lượt xuất và có thể đặt lại khi đổi dự án.
- M1-H3. [Migration 006](../../apps/desktop/src-tauri/migrations/006_waveforms.sql) lưu waveform theo asset. Waveform hiển thị phạm vi trim. Gain dB, fade đầu và fade cuối lưu trong thuộc tính clip. WebView giới hạn volume ở 100%, FFmpeg áp dụng gain dương khi xuất.
- M1-H4/H5. [Inspector](../../apps/desktop/src/ClipInspector.tsx) và [renderer](../../apps/desktop/src-tauri/src/render.rs) nội suy transform, xử lý mối nối kề nhau và giữ tổng thời lượng. Hòa trộn giữ frame cuối clip trước trong khoảng chuyển cảnh, qua đen chia thời lượng làm hai nửa. Âm thanh giữ nguyên nhịp dựng.
- M1-H6. `exportRange` là thuộc tính tùy chọn của snapshot lưu cùng từng render job. FFmpeg cắt video và audio đã ghép rồi đặt lại timestamp. Job cũ dùng toàn timeline.

**Đã kiểm chứng**

- Hộp thoại native trên Windows nhập cùng lượt một MP4 và một WAV có tên tiếng Việt. Thư viện báo nhập 2 tệp, ảnh PNG cùng thư mục không được nhập. Thử với bản dev dùng ID app và SQLite riêng.
- Kéo MP4 và WAV từ thư viện vào Video 1 tại 0 giây và Âm thanh 1 tại 1 giây. Quan sát waveform, thuộc tính dB/fade riêng và xem preview ở 2 giây. Đặt In bằng nút và chạy hàng đợi từ giao diện. FFprobe đọc MP4 dài 3,967 giây, H.264 640×360 và AAC cùng bắt đầu tại timestamp 0.
- Lint, TypeScript, Vite build, 19 test Node, 21 test Rust, 5 test FFmpeg, kiểm tra định dạng Rust và hai checker bộ nhớ. Một test keychain cần OS thật vẫn được bỏ qua mặc định.
- Fixture FFmpeg kiểm tra PNG waveform và cache, màu pha ở dissolve, màu đen tại ranh giới fade, pixel sticker có transform động, MP4 chứa audio và chỉ dài 1,1 giây theo In–Out.

**Còn mở**

- Kiểm tra thả tệp từ Explorer/Finder và cài đặt/chạy trực tiếp trên macOS. UI và codec có thể khác nhau giữa WebView2 và WKWebView.
- Phím tắt timeline nhận phím khi focus ở vùng timeline. Click thước di chuyển playhead nhưng chưa đưa focus vào vùng nhận phím. Có thể dùng nút In/Out trên toolbar, hoặc đưa focus vào một nút hay clip trong timeline trước khi dùng phím.
- M1-H3 tiếp theo cần filmstrip nhiều khung, khóa/ẩn/tắt tiếng theo tầng, meter và tách audio. Tiếp tục M1-H6 với compound, multicam, speed curve, tracking, rich text, adjustment layer/LUT và preset xuất. M1-F cần tái dựng đề xuất chữ, hiệu ứng, chuyển động và audio từ video tham chiếu. Các mục Pro/cloud vẫn ở M1-J.

**Git và bộ cài** Commit đã kiểm chứng là `8186f8f6a71ad37975219acca1c5ba930ad634bf`, tag `v0.4.0`. CI Windows và macOS đều đạt. Hai job đóng gói thành công. Log macOS xác nhận `x86_64 arm64` và `hdiutil` xác nhận DMG hợp lệ. Bản Windows cũng được build thành công tại máy. Windows chưa ký, DMG dùng chữ ký ad hoc. Cả hai cần FFmpeg/FFprobe trên PATH. [CI](https://github.com/trancaodai1651/DTVideoEditer/actions/runs/43000397010) · [Build bộ cài](https://github.com/trancaodai1651/DTVideoEditer/actions/runs/43000397175) · [Tag](https://github.com/trancaodai1651/DTVideoEditer/tree/v0.4.0)

Hai tệp dưới đây nằm trong `apps/desktop/src-tauri/target/verified-installers/v0.4.0`. Đã so SHA-256 của từng archive với metadata GitHub trước khi giải nén.

| Bộ cài | SHA-256 của tệp |
| --- | --- |
| `AI Video Studio_0.4.0_x64-setup.exe` | `2fd8af1d3a7be96dc620a85aa6d6acb55156176a53f9418338491c1c4ef5f2df` |
| `AI Video Studio_0.4.0_universal.dmg` | `99ce52b34ea164c47ffb852adfc25e62aeb1dc02537397014c66dc4b6cbc699f` |

## Kiểm chứng bản 0.3.1

**Mục tiêu** M1-I trong 0.3.1 cải thiện kéo thả, thu phóng timeline và chỉnh trực tiếp trên preview. M1-G đưa bố cục và kho công cụ vào 0.3.0 sau khi xem CapCut 9.7.1.

**Source** [Thư viện](../../apps/desktop/src/EditorLibrary.tsx), [Player](../../apps/desktop/src/EditorPlayer.tsx), [Inspector](../../apps/desktop/src/ClipInspector.tsx), [Catalog](../../apps/desktop/src-tauri/src/catalog.rs), [Phụ đề](../../apps/desktop/src-tauri/src/captions.rs) và [Renderer](../../apps/desktop/src-tauri/src/render.rs). Snapshot vẫn là version 3 với thuộc tính mặc định cho dữ liệu cũ. Không có migration SQLite mới.

**Kiểm chứng đã chạy trên Windows 11**

- Cửa sổ Tauri với SQLite riêng đã kéo MP4 từ thư viện tới 1,8 giây, di chuyển lên Video 2, zoom timeline và kéo sticker. Tay nắm góc đổi tỷ lệ từ 28% lên 48%, tay nắm xoay đổi góc từ 0° sang −50°. Inspector và trạng thái tự lưu cập nhật.
- Lint, TypeScript, Vite build, 15 test Node, 20 test Rust, `context:check` và `skills:check` đạt. Đã thử preview 200%, hoàn tác và làm lại trong cửa sổ thật.
- Đã xuất fixture H.264/AAC 640×360 dài 9,701 giây từ giao diện. Pixel ở tâm sticker đã kéo có RGB 254/194/73 tại vị trí dự kiến.
- 4 test FFmpeg thật, gồm kiểm tra pixel cho tốc độ 1,5×, chroma key, sticker alpha và phụ đề tiếng Việt. Filter Whisper đã chạy với mẫu nói tổng hợp và mô hình GGML cục bộ.
- Quy trình đóng gói [NSIS và DMG Universal](../../.github/workflows/installers.yml) dùng FFmpeg/FFprobe cài riêng. Windows chưa ký và DMG ký ad hoc.
- Hai job bộ cài 0.3.1 thành công. Runner xác minh DMG và binary arm64/x86_64. Hai bộ cài nằm trong `apps/desktop/src-tauri/target/verified-installers/v0.3.1`. Bản Windows được build tại máy và bản DMG được tải từ Actions sau khi đối chiếu SHA-256 của archive. [Build bộ cài](https://github.com/trancaodai1651/DTVideoEditer/actions/runs/42975842217) · [Kiểm tra CI](https://github.com/trancaodai1651/DTVideoEditer/actions/runs/42975842172)

**Giới hạn** Một số hiệu ứng nâng cao hiển thị đầy đủ khi xuất. Kho mẫu nhận timing và tỷ lệ, các lớp nguồn và preset do người dùng gán. AI avatar, xóa đối tượng, mở rộng ảnh, retouch, keyframe và chuyển cảnh giữa hai clip còn trong backlog. macOS còn kiểm thử cài đặt và phát media trên máy người dùng. Publishing đã kiểm tra bằng máy chủ giả lập.

**Git** Nền trước phiên là `b9e92f1`. Commit `6bbb387` và tag `v0.3.1` đã push. [Workflow bộ cài 0.3.1](https://github.com/trancaodai1651/DTVideoEditer/actions/runs/42975842217).
