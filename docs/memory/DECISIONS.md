# Quyết định kiến trúc

## ADR-001 · 2026-11-09 · Tauri + SQLite local

Chọn Tauri v2, Rust, React, TypeScript, Vite và Tailwind trong một pnpm workspace. Repo ban đầu chưa có source. Dùng SQLite bundled với foreign keys, WAL và migration chạy trong giao dịch. Native giữ quyền filesystem. Lockfiles tái lập dependency trên Windows/macOS.

## ADR-002 · 2026-11-09 · Preview theo ID, tài nguyên giữ nguyên

Native picker là đường cấp quyền duy nhất. Index chỉ lưu path tương đối, metadata và thumbnail. Custom protocol tra ID trong grant, kiểm tra từng path component và trả byte range. Quét đầy đủ đánh dấu tệp thiếu để clip đã lưu có thể hiển thị offline. Thu hồi grant xóa bản ghi phụ thuộc sau thao tác xác nhận.

## ADR-003 · 2026-11-09 · Timeline tuần tự và công cụ media ngoài app

M1-A lưu vị trí clip theo track, với ảnh trên track video. M1-B bổ sung các edit points và contract render. FFprobe và FFmpeg được tìm trên PATH khi chạy, ảnh thu nhỏ hoạt động khi FFmpeg có sẵn. Việc đóng gói FFmpeg cần quyết định license ở M5.

## ADR-004 · 2026-11-09 · Catalog dùng chung, provenance riêng

Mỗi developer skill có một nguồn canonical. Lock SHA-256 quản lý hai bản sao vật lý, phù hợp với Windows. Sync báo xung đột trước khi ghi khi gặp file do người dùng quản lý hoặc file đã sửa trực tiếp. Runtime workflows có registry và execution policy riêng ở M3.

## ADR-005 · 2026-11-10 · Snapshot timeline và render một lượt

Frontend giữ trạng thái sửa và lịch sử undo/redo, gửi nguyên snapshot version 2 mỗi lần thao tác xong. Native kiểm tra và thay toàn bộ clip trong một giao dịch, nên không có lệnh sửa từng phần cần đồng bộ. Renderer dựng một filter graph FFmpeg cho cả timeline thay vì ghép các đoạn trung gian, đổi lại là giới hạn độ dài dòng lệnh. Đích xuất chỉ đến từ hộp thoại native và được ghi qua tệp tạm.

## ADR-006 · 2026-11-10 · Publishing bằng token trong keychain và duyệt native

Kết nối bằng access token do người dùng tự lấy từ app của họ, vì OAuth cần app secret và redirect đã đăng ký mà dự án chưa có. Token nằm trong keychain qua crate `keyring`, HTTP dùng `reqwest` blocking với TLS của hệ điều hành để không phải build thư viện mã hóa. Mỗi lần đăng, sửa, xóa phải qua hộp thoại native. M4-B và M4-C được làm trước M4-A theo yêu cầu của chủ dự án.

## ADR-008 · 2026-11-12 · Thuộc tính clip cho dựng nâng cao và phân tích cục bộ

Tách âm thanh, tắt clip, compound, multicam và speed curve là trường tùy chọn trong `Look`, mặc định rỗng, để snapshot version 3 và dữ liệu cũ giữ nguyên. Compound là nhóm có tên hiển thị thành một khối trên timeline, không phải timeline con; render không đổi. Multicam là các góc trên tầng riêng, đổi góc bằng split và tắt clip. Speed curve chia nguồn thành 24 đoạn tốc độ không đổi; Rust và TypeScript dùng cùng phép tính số nguyên để thời lượng khớp tuyệt đối, FFmpeg dùng `setpts` từng đoạn cho hình và `atrim`/`atempo`/`concat` cho tiếng. Tracking dùng block matching trên khung xám 160 px trong Rust thay vì thêm OpenCV. Mức âm lượng RMS 50 ms được cache để meter, xóa khoảng lặng và dò nhịp dùng chung.

## ADR-007 · 2026-11-11 · Cấp quyền từng tệp từ picker và native drop

M1-H1 mở rộng ADR-002. Picker tệp và sự kiện thả từ hệ điều hành lưu canonical path với phạm vi đúng một tệp. Dùng bảng grant hiện tại để tái sử dụng thu hồi, ID nguồn và quan hệ SQLite. Cấp quyền thư mục vẫn cần hộp thoại chọn thư mục. Frontend nhận tọa độ thả và asset ID để quyết định chèn clip vào dự án đang mở. Preview, waveform, render, nhận dạng, phân tích mẫu và publishing dùng chung kiểm tra phạm vi nguồn. [Quyền media](SECURITY.md)

## ADR-010 · 2026-11-12 · Mô hình Whisper đi kèm, proxy thủ công, highlight và màu 0.9.0

Bộ cài kèm `ggml-small-q5_1.bin` (~190 MB): mô hình đa ngôn ngữ đủ tốt cho tiếng Việt mà vẫn nhỏ hơn `small` đầy đủ; tệp được ghim theo revision Hugging Face và SHA-256. Proxy bỏ cơ chế tự động vì người dùng muốn quyết định lúc nào mã hóa; cache cũ vẫn được dùng lại. Bánh xe màu và đường cong RGB được quy về đường cong từng kênh 17 điểm để preview SVG và FFmpeg `curves` khớp chính xác; HSL theo dải màu không tách kênh được nên chỉ xuất qua `huesaturation`. Highlight không giới hạn chọn theo ngưỡng tương đối trong chính tư liệu thay vì một số giây cố định.

## ADR-009 · 2026-11-12 · Màu, lớp điều chỉnh, giọng đọc và dịch

Đường cong tông được dựng từ năm thanh ánh sáng bằng một công thức chung; preview dùng bảng `feComponentTransfer` 9 điểm, FFmpeg dùng `curves` với cùng 9 điểm, nên hai bên khớp tông. Tint, hue, vibrance dùng `colorbalance`, `hue`, `vibrance` khi xuất và ma trận/CSS gần đúng khi xem trước. LUT chỉ áp khi xuất vì WebView không có lut3d. Lớp điều chỉnh là danh sách riêng trong snapshot (như chữ), áp filter có `enable='between(t,..)'` lên ảnh ghép trước lớp chữ. Freeze dùng ngữ nghĩa ảnh tĩnh (`startMs = 0`, `endMs` là thời lượng) cộng `freezeAtMs`. Đồng bộ multicam dùng tương quan onset năng lượng 10 ms thay vì so dạng sóng, vì hai micro khác nhau vẫn trùng điểm bắt đầu âm. Lồng tiếng dùng giọng có sẵn của hệ điều hành để không cần mô hình hay mạng; dịch dùng Claude API qua HTTP thô vì Rust không có SDK chính thức.
