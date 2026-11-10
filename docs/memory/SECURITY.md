# Ranh giới bảo mật

- Chỉ native picker ghi grant. IPC cho WebView dùng ID và không nhận path media tùy ý. Scan không mở rộng qua symbolic link và Windows reparse point trong cây.
- Scan và preview đối chiếu root canonical, kiểm tra từng phần path và chỉ đọc tệp thường trong root. Giải pháp kiểm tra path và mở tệp có cửa sổ TOCTOU nếu tiến trình khác cố ý thay đổi filesystem đồng thời. Hardening theo file handle thuộc M5.
- FFprobe và FFmpeg chạy với argument list cố định, demuxer whitelist, file protocol, thời gian và stdout có giới hạn. FFmpeg là công cụ do người dùng cài trên PATH.
- Media protocol dùng ID, phân biệt thumbnail và source, giới hạn byte range và cache policy `no-store`. Mỗi request mới kiểm tra grant. Thu hồi chờ scan kết thúc, gỡ metadata và clip tham chiếu sau xác nhận. App mở local và không cấp plugin filesystem cho WebView.
- Xuất video ghi tệp tạm riêng trong thư mục người dùng chọn qua dialog native rồi hoàn tất với kiểm tra chống ghi đè. Hàng đợi từ chối đích trùng. Mọi input qua grant và demuxer whitelist. Chữ render qua tệp UTF-8 do app tạo trong thư mục tạm, với expansion tắt.
- Video tham chiếu được đọc local qua asset ID. Kho mẫu giữ timing và tỷ lệ, không giữ bản sao media. Preview video xuất chỉ phục vụ job đã xong và kiểm tra path.
- Kho tích hợp chỉ đăng ký các tệp cố định đi kèm ứng dụng trong thư mục dữ liệu nội bộ, kiểm tra đường dẫn canonical và nội dung trước khi cấp ID. Tài nguyên người dùng vẫn qua native picker.
- SRT và mô hình Whisper được chọn qua hộp thoại native. FFmpeg nhận clip đã qua grant và dùng tên mô hình cố định trong thư mục tạm. Nhận dạng chạy cục bộ, với giới hạn dung lượng, thời lượng và số cue. Xuất SRT dùng tệp tạm và chống ghi đè.
- Publishing giữ token trong keychain của hệ điều hành, SQLite chỉ có tên entry. Token đi từ ô nhập trong WebView qua IPC tới native một lần lúc kết nối và không được trả ngược lại.
- Mọi request mạng xã hội chỉ đi HTTPS tới host cố định, không theo redirect. URL tải lên do API trả về phải thuộc tên miền của nền tảng trước khi gửi token hoặc media. Thông báo lỗi bỏ URL vì URL có thể chứa token. ID bài đăng chỉ gồm chữ, số, gạch dưới và gạch ngang.
- Đăng, sửa và xóa bài yêu cầu xác nhận trong hộp thoại native nêu rõ tài khoản và nội dung, WebView không tự duyệt được. Media của bài đăng là URL https, asset ID trong grant hoặc ID của lượt xuất.
- M2 chỉ lưu tham chiếu credential trong SQLite. Keychain giữ secrets. User xác nhận dữ liệu trước khi dùng cloud và quyền với giọng mẫu trước khi clone.
- M3 giữ plan copy/move và audit trong SQLite. Preview dry-run, xác nhận, conflict policy và rollback là điều kiện để bật thao tác ghi.
- M3/M4 runtime chỉ chạy steps đã đăng ký. Lịch đăng và campaign dùng lại gate duyệt native ở trên. Cloud scheduler chỉ chạy khi worker được cấu hình và user bật.
