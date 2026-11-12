# Editor và render

## Timeline

[timeline.rs](../../../apps/desktop/src-tauri/src/timeline.rs) định nghĩa `TimelineSnapshot` version 3 với `layer`, `look`, lớp chữ và tỷ lệ khung. Clip giữ điểm in/out và vị trí theo mili giây. Các tầng cùng nhóm có thể chồng thời gian. Mỗi tầng media tối đa 200 clip và mỗi nhóm tối đa 12 tầng. Snapshot version 2 dùng thuộc tính mặc định.

[timeline.ts](../../../apps/desktop/src/timeline.ts) chứa các phép sửa ở frontend và undo/redo 100 bước. [TimelineEditor](../../../apps/desktop/src/TimelineEditor.tsx) nhận media theo tầng. [ClipInspector](../../../apps/desktop/src/ClipInspector.tsx) chỉnh chữ, hình, âm thanh, tốc độ, animation và màu. `save_timeline` ghi snapshot trong giao dịch. [EditorPlayer](../../../apps/desktop/src/EditorPlayer.tsx) phát nguồn hoặc timeline. Tốc độ thay đổi thời lượng trên timeline, giữ điểm in/out theo thời gian nguồn.

`S` hoặc `Ctrl+B` tách tại playhead, `Ctrl+Shift+B` tách nhiều clip, `Delete` gỡ clip, `Ctrl+Z` và `Ctrl+Y` hoàn tác/làm lại. Trái/phải bước frame ở 30 fps, `Shift` + trái/phải dịch clip 100 ms, lên/xuống nhảy điểm cắt. Có chế độ chọn/cắt/chọn theo hướng, group, clipboard, marker `M`, điểm In `I` và Out `O`.

M1-I dùng pointer capture để kéo từ thẻ media tới timeline, xem trước vị trí đã hít mép và đổi tầng khi kéo clip. Thước và tên tầng giữ vị trí khi cuộn. Có thanh zoom, vừa khung và Ctrl/⌘ + cuộn. Preview lưu vị trí, tỷ lệ và góc xoay khi nhả chuột qua cùng snapshot dùng để xuất MP4.

M1-H2 có công tắc dồn clip chính, hít mép và liên kết riêng. Khi trim hoặc xóa với dồn clip, clip phía sau ở Video 1 dịch theo. Liên kết áp dụng cùng độ dịch cho clip ở tầng khác bắt đầu từ ranh giới sửa. Keyframe transform nội suy vị trí, tỷ lệ, xoay và opacity theo mốc trên clip. Chuyển cảnh hòa trộn và qua đen áp dụng cho hai clip kề trên cùng tầng và bị vô hiệu khi tạo khoảng hở.

M1-H7 cho thả media đầu tiên để tự tạo dự án, dùng chung quy tắc đặt clip cho Gallery và native drop. Vùng trên các tầng hình tạo tầng phủ, vùng dưới các tầng âm thanh tạo thêm tầng âm thanh. M1-H3 có filmstrip theo trim và waveform. Khóa tầng bảo vệ phép sửa trên timeline và preview. Ẩn hình/chữ và tắt tiếng là hai điều khiển độc lập, lưu cùng snapshot xuất.

## Dựng nâng cao (0.5.0)

- **Menu chuột phải** [ContextMenu](../../../apps/desktop/src/ContextMenu.tsx) trên clip (cắt, sao chép, dán, nhân bản, xóa, tách, tắt clip, tách/khôi phục âm thanh, tốc độ và đường cong, nhóm, compound, multicam, công cụ thông minh, khóa tầng), trên tên tầng (khóa/ẩn/tắt tiếng, chọn cả tầng, thêm tầng) và trên vùng trống (dán tại đây, playhead, marker, In/Out, công tắc hít mép/dồn/liên kết, vừa khung). Kéo trên chỗ trống của tầng để chọn bằng khung.
- **Tách âm thanh** tạo clip cùng asset trên tầng âm thanh trống gần nhất, hai bên cùng `audioLink`; clip video có `audioDetached` nên preview và FFmpeg bỏ tiếng của nó. Khôi phục xóa mọi clip âm thanh cùng link. Clip video được phép nằm trên track âm thanh khi có `audioLink`.
- **Tắt clip** (`V`) giữ thời lượng trên timeline nhưng bỏ khỏi preview và xuất.
- **Compound** (`Alt+G`) gắn `compound {id, name}` cho các clip media; khi thu gọn hiện một khối kéo được trên tầng thấp nhất, nhấp đúp để mở/thu gọn, menu để đổi tên hoặc tách. Render không đổi.
- **Multicam** cần 2–9 clip video trên các tầng riêng; đồng bộ theo điểm đầu, góc 1 hiện, các góc khác tắt. Phím 1–9 hoặc menu đổi góc tại playhead: tách mọi góc rồi bật góc chọn tới lần đổi kế tiếp.
- **Tốc độ** 0,1–10× và **speed curve** 2–10 điểm (vị trí phần nghìn, tốc độ %). [SpeedPanel](../../../apps/desktop/src/SpeedPanel.tsx) vẽ đồ thị log, có 6 preset. Nguồn chia 24 đoạn; `clipLength` và `length_ms` cho kết quả giống hệt. Đổi tốc độ đẩy hoặc kéo các clip sau trên cùng tầng. Split clip có đường cong chia lại đường cong cho hai nửa.
- **Fade audio** kéo bằng hai núm tròn ở góc trên clip âm thanh.
- **Meter** ở chân trình phát cộng công suất của các clip đang kêu tại playhead từ mức RMS cache, có vạch đỉnh giữ 1,5 giây.
- **Công cụ thông minh** (menu hoặc tab Thông minh): dò cảnh và tách, xóa khoảng lặng dưới −42 dB từ 0,6 giây rồi dồn clip, marker theo nhịp, bám theo chuyển động. Tracking: chọn lớp phủ ở tầng trên, đặt playhead trên video ở tầng dưới, vẽ khung trên trình phát; native trả tâm vật thể 10 lần/giây, frontend đổi thành tối đa 32 keyframe vị trí.
- Phím mới: `V`, `Q`/`W` xóa phần trước/sau playhead và dồn, `Ctrl+R` hoặc `Shift+B` mở Tốc độ, `Ctrl+Shift+S`, `Alt+G`, `Ctrl+D`, `1`–`9`.
- Ba cột thư viện/trình phát/thuộc tính đổi rộng bằng vách chia, lưu trong `localStorage`.

## Màu, chữ và chỉnh sửa (0.6.0)

- **Màu** [ColorPanel](../../../apps/desktop/src/ColorPanel.tsx): Cơ bản (phơi sáng, độ sáng, tương phản, vùng sáng, vùng tối, điểm trắng, điểm đen, nhiệt độ, sắc độ, tông màu, bão hòa, rực màu), Đường cong (xem đường cong tông), LUT (.cube nhập qua hộp thoại). `tonePoints` trong [timeline.ts](../../../apps/desktop/src/timeline.ts) và `Look::tone_points` trong [timeline.rs](../../../apps/desktop/src-tauri/src/timeline.rs) phải giữ giống nhau.
- **Lớp điều chỉnh** nằm trên tầng chữ (`kind: "adjustment"`), nút "+ Lớp điều chỉnh". Nó áp màu, làm mờ/tối viền/hạt và tăng nét lên mọi hình bên dưới trong khoảng của nó.
- **Chữ phong phú**: phông Arial/Arial đậm/Times/Courier/Impact, màu hex, viền và độ dày, nền màu và độ đục, căn lề, đổ bóng, hiện/ẩn dần, giãn dòng.
- **Menu clip** thêm Sao chép/Dán thuộc tính (`Ctrl+Shift+C/V`), Thay bằng media đang chọn trong thư viện (giữ vị trí, độ dài và hiệu chỉnh), Khung hình tĩnh tại playhead (chèn 3 giây và đẩy clip sau), Đảo ngược, Mở timeline con của compound, Tạo multicam theo âm thanh.
- **Timeline con**: chỉ hiện và sửa các clip của compound, thanh "← Timeline chính" để quay lại.
- **Tracking** trả cả tỷ lệ và góc xoay; keyframe nhân tỷ lệ gốc và cộng góc gốc.
- **Tab Thông minh** thêm Lồng tiếng (giọng hệ điều hành, tốc độ −10…10, nhập WAV vào tầng âm thanh trống) và Dịch phụ đề bằng Claude (key lưu keychain, hỏi xác nhận).

## Render

[render.rs](../../../apps/desktop/src-tauri/src/render.rs) dựng một lệnh FFmpeg từ snapshot và media đã qua kiểm tra grant.

- 30 fps với kích thước nguồn hoặc khung 1080p ngang, dọc, vuông. Các tầng hình phủ theo thứ tự, có transform, màu, chuyển động và hiệu ứng. Chữ đi qua `drawtext` bằng tệp UTF-8 tạm với expansion tắt. Graph lớn được chuyển sang tệp tạm.
- Âm thanh nguồn video và nhiều tầng âm thanh được trộn với gain dB, fade đầu/cuối và limiter. `atempo` giữ cao độ khi đổi tốc độ. Khoảng trống dùng nền đen và im lặng.
- Đầu ra H.264 (CRF 20, veryfast) và AAC 192 kb/s, `+faststart`.
- FFmpeg ghi vào tệp tạm riêng trong thư mục đích và hoàn tất bằng thao tác chống ghi đè. Hủy hoặc lỗi dọn tệp tạm.

Clip tắt bị bỏ khỏi graph. Freeze đọc một khung tại `freezeAtMs` rồi giữ bằng `tpad`; reverse dùng `trim,reverse` cho hình và `areverse` cho tiếng; màu dùng `colorbalance`, `hue`, `vibrance`, `curves`, `lut3d`; lớp điều chỉnh thêm chuỗi filter có `enable` sau các tầng hình. Chữ dùng `font-<kiểu>.ttf`, `text_align`, `shadow*`, `box*`, `line_spacing` và `alpha` cho hiện/ẩn dần. Clip video đã tách âm thanh không thêm nhánh audio. Speed curve dùng `setpts` theo từng đoạn và `asplit` → `atrim` → `atempo` → `concat` cho tiếng. `atempo` được nối khi tốc độ dưới 0,5×.

`render_jobs` lưu snapshot, In–Out nếu được đặt, đích đã chọn trong hộp thoại native, tiến độ và lỗi. [ExportQueue](../../../apps/desktop/src/ExportQueue.tsx) chạy FIFO giữa các dự án. Lượt chờ giữ qua restart. Lượt bị gián đoạn được đánh dấu lỗi. Thử lại giữ snapshot và đích đã lưu.

## Kho mẫu

[templates.rs](../../../apps/desktop/src-tauri/src/templates.rs) dùng FFmpeg dò điểm cắt video trong grant, tối đa 3 phút và 24 đoạn. [TemplateLibrary](../../../apps/desktop/src/TemplateLibrary.tsx) cho phép gán media theo cảnh, nhạc nền/SFX/voice theo tầng và cấu hình chữ/màu/fade/trượt. Dự án mới và snapshot được tạo trong cùng một giao dịch. Video tham chiếu chỉ cung cấp timing và khung hình.

## Tài nguyên và phụ đề

[EditorLibrary](../../../apps/desktop/src/EditorLibrary.tsx) tổ chức các thư viện và preset. [catalog.rs](../../../apps/desktop/src-tauri/src/catalog.rs) đăng ký 2 bản nhạc, 3 SFX và 6 sticker gốc vào thư viện local. [captions.rs](../../../apps/desktop/src-tauri/src/captions.rs) xử lý SRT UTF-8 và FFmpeg `whisper` với mô hình GGML người dùng chọn. Caption là lớp chữ có thể sửa trong snapshot và có thể xuất lại SRT.

## Giới hạn hiện tại

Preview phụ thuộc codec WebView. Một số xử lý hình và tiếng nâng cao chỉ áp dụng đầy đủ khi xuất MP4. Gain dương bị giới hạn bởi volume WebView. Mask theo đối tượng và keyframe riêng từng tham số thuộc M1-H. LUT chưa hiện trong preview. Tint/vibrance/hue trong preview là gần đúng. Tracking tỷ lệ/xoay cần vật thể có chi tiết ở hai nửa vùng chọn. Reverse xem trước bằng tua từng khung nên giật hơn bản xuất. Nhận dạng chữ, hiệu ứng và các lớp âm thanh của video mẫu thuộc M1-F. [Backlog](../TASK_BACKLOG.md)

Kiểm tra bằng `pnpm test`, `pnpm test:native` và `pnpm test:media`.
