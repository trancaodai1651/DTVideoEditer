# Bàn giao

Snapshot: 2026-11-12/EDITOR-060

## Điểm vào cho Claude Code hoặc Codex

Chạy `pnpm context:summary` và `git status -sb`. Đọc [bản đồ dự án](PROJECT_INDEX.md), [trạng thái](CURRENT_STATE.md), [module editor](modules/editor.md), [khảo sát CapCut](CAPCUT_DESKTOP_AUDIT.md) và [backlog](TASK_BACKLOG.md). Người dùng muốn DT_Edit có giao diện, thao tác và chức năng tương đương CapCut Desktop, và đã cho phép push lên `origin`, chạy GitHub Actions và build bộ cài. DT_Edit dùng bố cục và luồng thao tác tương tự nhưng giao diện, tên và tài nguyên là của riêng dự án, không sao chép thương hiệu hay asset CapCut. Đọc [quyền media](SECURITY.md) trước khi sửa quyền, picker, native drop hoặc phân tích media.

Task tiếp theo là **M1-H8**: chạy các ca dưới đây trong cửa sổ Tauri thật, sửa lỗi phát hiện, rồi làm phần còn lại của M1-H8 và M1-H6 theo backlog.

## Bản 0.6.0

Người dùng yêu cầu làm tiếp: timeline con cho compound, đồng bộ multicam theo âm thanh, tracking theo tỷ lệ và góc xoay, sao chép/dán thuộc tính, thay clip, freeze, reverse, chữ phong phú, LUT, lớp điều chỉnh, chỉnh màu đầy đủ, và các tính năng AI cloud (xóa nền, avatar, lồng tiếng, dịch).

| Mục | Đã làm | Còn lại |
| --- | --- | --- |
| Chỉnh màu | 12 thanh: phơi sáng, độ sáng, tương phản, vùng sáng, vùng tối, điểm trắng, điểm đen, nhiệt độ, sắc độ, tông, bão hòa, rực màu; đường cong tông; LUT .cube; nút đặt lại. [ColorPanel](../../apps/desktop/src/ColorPanel.tsx) | HSL theo từng màu, bánh xe màu, đường cong RGB vẽ tay, xem trước LUT |
| Lớp điều chỉnh | Clip `adjustment` trên tầng chữ, màu + hiệu ứng + tăng nét cho mọi hình bên dưới, có preview | Mask cho lớp điều chỉnh |
| Chữ phong phú | 5 phông, màu hex, viền, nền màu/độ đục, căn lề, bóng, hiện/ẩn dần, giãn dòng | Kiểu khác nhau trong cùng một dòng, hiệu ứng chữ chuyển động |
| Sao chép/dán thuộc tính | `Ctrl+Shift+C/V` và menu; bỏ qua tốc độ, keyframe, nhóm, multicam | Chọn từng nhóm thuộc tính khi dán |
| Thay clip | Thay bằng media đang chọn trong thư viện, giữ vị trí, độ dài (nếu đủ), hiệu chỉnh | |
| Freeze | Chèn khung tĩnh 3 giây tại playhead, đẩy clip sau | Đổi độ dài mặc định |
| Reverse | Hình và tiếng, nguồn tối đa 60 giây | Preview mượt hơn |
| Compound | Timeline con: chỉ hiện và sửa clip của compound, nút quay lại | Xuất riêng một compound |
| Multicam | Đồng bộ theo âm thanh (tương quan onset 10 ms, tìm lệch ±10 giây) hoặc theo điểm đầu | Lưới xem nhiều góc |
| Tracking | Vị trí, tỷ lệ, góc xoay từ hai nửa vùng chọn | Mask bám theo |
| Lồng tiếng | Giọng của Windows (System.Speech) hoặc macOS (`say`), nhập WAV vào tầng âm thanh | Clone giọng (OmniVoice, M2-B) |
| Dịch phụ đề | Claude API `claude-opus-5-5`, key trong keychain, hỏi xác nhận trước khi gửi | Live test với key thật |
| Xóa nền AI, avatar AI | Chưa làm: cần mô hình phân đoạn hoặc dịch vụ tạo người ảo | M2/M1-J |

Source chính: [timeline.ts](../../apps/desktop/src/timeline.ts) phần "Colour, adjustment layers…", [ColorPanel](../../apps/desktop/src/ColorPanel.tsx), [ClipInspector](../../apps/desktop/src/ClipInspector.tsx) (`titleCss`, preview màu/freeze/reverse), [TimelineEditor](../../apps/desktop/src/TimelineEditor.tsx) (`focus`, menu mới), [EditorLibrary](../../apps/desktop/src/EditorLibrary.tsx) (`VoiceAndTranslate`), [App](../../apps/desktop/src/App.tsx) (`smart("multicam")`, `speakText`, `translateCaptions`, LUT), [timeline.rs](../../apps/desktop/src-tauri/src/timeline.rs) (`tone_points`, `AdjustmentEdit`, `TitleFont`), [render.rs](../../apps/desktop/src-tauri/src/render.rs) (`color_filters`, `adjustment_filters`, font/LUT files), [analysis.rs](../../apps/desktop/src-tauri/src/analysis.rs) (`track_pose`, `audio_offset`), [voice.rs](../../apps/desktop/src-tauri/src/voice.rs), [migration 010](../../apps/desktop/src-tauri/migrations/010_color_layers.sql). Schema `user_version = 10`, timeline JSON version 3.

**Đã kiểm chứng trên Windows 11**

- Lint, TypeScript, `cargo fmt --check`, 33 test Node (thêm [color.test.mjs](../../scripts/color.test.mjs)), 32 test Rust, 7 test FFmpeg thật, test giọng đọc Windows thật (`cargo test windows_speech -- --ignored`) tạo WAV, `context:check`, `skills:check`.
- Test FFmpeg mới `real_ffmpeg_grades_freezes_reverses_and_syncs_audio`: độ lệch hai góc đo được 700 ms (±20); điểm ảnh cho thấy reverse bắt đầu bằng nửa xanh và kết thúc bằng đỏ, freeze giữ khung xanh, LUT đảo đỏ thành cyan, hue 120 chuyển đỏ sang lục, lớp điều chỉnh bão hòa 0 khử màu; xuất chữ phông đậm, màu hex, viền, nền, bóng, hiện dần, căn trái.
- Phát hiện và sửa lỗi có từ 0.5.0: giải mã PCM bỏ mất khoảng trống ở đầu luồng tiếng nên lệch thời gian cho meter, xóa khoảng lặng và marker nhịp. Migration 010 xóa cache mức âm lượng cũ.
- Giao diện production trong trình duyệt với IPC giả lập tạm (đã gỡ khỏi repo): thêm lớp điều chỉnh và kéo phơi sáng/bão hòa (preview nhận bảng tông giống khi xuất), khung hình tĩnh, multicam theo âm thanh, timeline con của compound, lồng tiếng, lưu key và dịch phụ đề, đổi phông/màu/bóng chữ.
- Bản debug với dữ liệu riêng khởi động và nâng lên schema 10. Bộ cài NSIS 0.6.0 build tại máy, CI và đóng gói hai nền tảng đạt.

**Chưa kiểm chứng**

- Cửa sổ Tauri thật, macOS, lệnh `say`. Chưa gọi Claude API thật (cần key của người dùng). Phông Impact/Courier trên macOS và Linux dùng đường dẫn ứng viên, chưa thử.

**Bộ cài và revision 0.6.0**

- Commit `48836d9`, tag `v0.6.0`. CI master/tag và hai job đóng gói (NSIS Windows x64, DMG macOS Universal có `lipo` và `hdiutil verify`) đạt. [CI](https://github.com/trancaodai1651/DTVideoEditer/actions/runs/43147030547) · [Bộ cài](https://github.com/trancaodai1651/DTVideoEditer/actions/runs/43147030572) · [Tag](https://github.com/trancaodai1651/DTVideoEditer/tree/v0.6.0)
- Bộ cài Windows build tại máy: `apps/desktop/src-tauri/target/verified-installers/v0.6.0/AI Video Studio_0.6.0_x64-setup.exe`, SHA-256 `21667c90fcbf2667fa0c3510ff91998746db264492128b4a614556062d7d7852`. DMG tải từ trang run (phiên này không có `gh`); digest archive ghi bên dưới.

| Archive trên Actions | SHA-256 |
| --- | --- |
| `windows-x64-setup` | `aec010f14619cb2212fc9da46ca8e12e6957410e3fc8170a9dd107e0a9450ef1` |
| `macos-universal-dmg` | `bccd90ea55a98809a7df485d139f43229a336790e1d9c367b136020d2e529038` |

**Ca chạy lại trong cửa sổ thật**

1. Chọn clip video → Thuộc tính › Điều chỉnh: kéo Phơi sáng, Vùng tối, Tông màu; xem trình phát rồi xuất và so khung hình.
2. Nhập một .cube (tab LUT), gán cho clip, xuất và kiểm tra màu. Thêm lớp điều chỉnh, giảm bão hòa, xuất.
3. Chuột phải clip → Khung hình tĩnh, Đảo ngược, Sao chép/Dán thuộc tính, chọn media trong thư viện rồi Thay clip.
4. Hai video quay cùng cảnh trên Video 1 và Video 2 → chọn cả hai → Tạo multicam (đồng bộ theo âm thanh); kiểm tra thông báo độ lệch và phát.
5. Tạo compound → chuột phải → Mở timeline con → sửa → ← Timeline chính.
6. Tab Thông minh: chọn giọng tiếng Việt, tạo lời đọc; nhập Anthropic API key, tạo phụ đề rồi dịch.
7. Chữ: đổi phông, màu, viền, nền, căn lề, bóng, hiện dần; xuất và so với preview.

## Bản 0.5.0

Người dùng yêu cầu hoàn thiện sidebar, menu chuột phải, tách âm thanh, compound, multicam, speed curve, tracking và luồng AI/Pro, tiếp nối M1-H3. Phạm vi đã làm và còn lại:

| Mục | Đã làm | Còn lại |
| --- | --- | --- |
| Menu chuột phải | Clip, tên tầng, vùng trống timeline, điều hướng bằng phím, tự giữ trong cửa sổ. [ContextMenu](../../apps/desktop/src/ContextMenu.tsx) | Thẻ thư viện, trình phát; copy/paste thuộc tính, thay clip, freeze, reverse |
| Sidebar | Tab **Thông minh** gọi công cụ thật trên clip đang chọn; ba cột đổi rộng. [EditorLibrary](../../apps/desktop/src/EditorLibrary.tsx) | Danh mục con trong từng tab, đổi cỡ panel theo chiều dọc |
| Tách âm thanh | Tách/khôi phục, liên kết `audioLink`, `Ctrl+Shift+S`, preview tắt tiếng video, FFmpeg bỏ nhánh tiếng | Đồng bộ lại khi kéo lệch |
| Meter, fade | Meter RMS tại playhead, vạch đỉnh; núm kéo fade đầu/cuối | Meter hai kênh |
| Tắt clip | `V`, menu, giữ thời lượng, bỏ khỏi preview và xuất | |
| Compound | `Alt+G`, khối thu gọn kéo được, nhấp đúp mở/thu gọn, đổi tên, tách | Timeline con riêng, xuất riêng compound |
| Multicam | 2–9 góc trên tầng riêng, đồng bộ theo điểm đầu, phím 1–9 đổi góc tại playhead | Đồng bộ theo âm thanh, xem lưới nhiều góc |
| Tốc độ | 0,1–10×, speed curve 2–10 điểm, 6 preset, đồ thị kéo điểm, `Ctrl+R`/`Shift+B`; đổi tốc độ đẩy clip sau | Smooth slow-mo theo đường cong |
| Tracking | Vẽ khung trên trình phát, block matching 10 khung/giây, tối đa 32 keyframe vị trí | Theo tỷ lệ, góc xoay; mask bám theo |
| Thông minh | Dò cảnh và tách, xóa khoảng lặng, marker theo nhịp, phụ đề Whisper (có sẵn) | Xóa nền AI, avatar, lồng tiếng, dịch cloud cần mô hình hoặc tài khoản (M2, M1-J) |
| Phím | `Q`/`W` xóa trước/sau playhead và dồn, `Ctrl+D` nhân bản | Phím player và attributes theo bảng khảo sát |

Source chính: [phép sửa](../../apps/desktop/src/timeline.ts) cuối tệp, [TimelineEditor](../../apps/desktop/src/TimelineEditor.tsx), [SpeedPanel](../../apps/desktop/src/SpeedPanel.tsx), [EditorPlayer](../../apps/desktop/src/EditorPlayer.tsx), [App](../../apps/desktop/src/App.tsx) (`smart`, `trackRegion`, meter), [analysis.rs](../../apps/desktop/src-tauri/src/analysis.rs), [timeline.rs](../../apps/desktop/src-tauri/src/timeline.rs) (`SpeedPoint`, `Compound`, `curve_segments`), [render.rs](../../apps/desktop/src-tauri/src/render.rs) (`curve_pts`, `tempo`) và [migration 009](../../apps/desktop/src-tauri/migrations/009_audio_levels.sql). Schema dữ liệu lên `user_version = 9`; timeline JSON vẫn version 3 với trường tùy chọn mới.

**Đã kiểm chứng trên Windows 11**

- `pnpm lint`, `pnpm typecheck`, `cargo fmt --check`, 28 test Node (thêm [smart.test.mjs](../../scripts/smart.test.mjs)), 26 test Rust, 6 test FFmpeg thật, `context:check`, `skills:check`.
- Test FFmpeg mới `real_ffmpeg_measures_tracks_and_exports_curves_with_detached_audio`: mức RMS thấp trong đoạn im lặng 0,5–1,5 giây và được cache; dò đúng một điểm cắt ở 1 giây (±80 ms); tracking hình vuông chạy 60 px/giây sai lệch ≤ 40/1000 khung; xuất clip speed curve 0,5×→2× có âm thanh tách và một clip tắt, FFprobe đo thời lượng hình và tiếng khớp tính toán (±80–100 ms).
- Giao diện production chạy trong trình duyệt với IPC giả lập tạm (đã gỡ khỏi repo): menu chuột phải, tách âm thanh lưu đúng `audioLink`, multicam đổi góc tại 5,97 giây, compound thu gọn và mở, preset speed curve, tab Thông minh tách 3 cảnh, vẽ khung tracking ghi keyframe.
- Bộ cài NSIS 0.5.0 build tại máy và CI cả hai nền tảng đạt (xem mục Bộ cài và revision).

**Chưa kiểm chứng**

- Chưa thao tác trong cửa sổ Tauri thật và trên macOS. Meter, tracking và dò cảnh mới chạy với dữ liệu thật trong test native, chưa qua giao diện thật. Kéo núm fade và chọn bằng khung chưa thử bằng chuột.

**Bộ cài và revision**

- Commit build là `8534cd1`, tag `v0.5.0`. CI Windows/macOS cho master và tag đạt, hai job đóng gói (NSIS Windows x64 và DMG macOS Universal, có bước `lipo` và `hdiutil verify`) đạt. [CI](https://github.com/trancaodai1651/DTVideoEditer/actions/runs/43142222834) · [Bộ cài](https://github.com/trancaodai1651/DTVideoEditer/actions/runs/43142222854) · [Tag](https://github.com/trancaodai1651/DTVideoEditer/tree/v0.5.0)
- Bộ cài Windows build tại máy nằm ở `apps/desktop/src-tauri/target/verified-installers/v0.5.0`. DMG chưa được tải về máy vì phiên này không có `gh`; tải từ trang run và so digest của archive bên dưới. Windows chưa ký, DMG ký ad hoc, cả hai cần FFmpeg/FFprobe trên PATH.
- Bản debug với `STUDIO_DEV_DATA_DIR` riêng khởi động được và nâng cơ sở dữ liệu mới lên `user_version = 9`. Chưa mở bản release trên dữ liệu thật vì 0.4.1 sẽ không đọc được schema 9.

| Tệp | SHA-256 |
| --- | --- |
| `AI Video Studio_0.5.0_x64-setup.exe` build tại máy | `9596309a24d3651d4f486cb1aa0e2ef65f3ddc454511d5fff95a2b4154f44ce9` |
| Archive `windows-x64-setup` trên Actions | `d4a1778770688896b9596b8ac36eebf74a0d80d3396831e039b3ca33926315be` |
| Archive `macos-universal-dmg` trên Actions | `8a0c540a31a920bcc68c6584184b9c983a5a60a158dce660cb65c23fdc65673a` |

**Ca chạy lại trong cửa sổ thật**

1. `pnpm demo:media`, build QA với app identifier riêng như mục 0.4.1, nhập MP4 và WAV mẫu.
2. Chuột phải clip video → Tách âm thanh: có clip ở tầng âm thanh, video không còn tiếng khi phát, xuất MP4 vẫn có tiếng. Chuột phải → Khôi phục âm thanh.
3. Chọn clip → `V`: clip mờ sọc, preview đen tại đó, MP4 giữ tổng thời lượng.
4. Đặt hai video trên Video 1 và Video 2, chọn cả hai → menu Tạo multicam → phát và nhấn `2`, `1` ở các mốc khác nhau; xuất và kiểm tra đổi hình.
5. Chọn clip → `Ctrl+R` → Đường cong → Viên đạn, kéo một điểm, phát thử; xuất và đo thời lượng bằng FFprobe so với số trong Thuộc tính.
6. Thêm sticker ở tầng trên một video có vật chuyển động, menu Bám theo chuyển động, vẽ khung, phát và xuất.
7. Chọn clip có đoạn im lặng → tab Thông minh → Xóa khoảng lặng; với nhạc → Đánh dấu nhịp nhạc.
8. Kéo vách chia giữa ba cột, khởi động lại để kiểm tra kích thước được giữ. Kiểm tra ở 1280×720 và 2560×1440.

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
