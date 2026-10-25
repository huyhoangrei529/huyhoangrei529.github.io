# Bật đăng nhập và đồng bộ lịch sử OMR

Ứng dụng dùng Supabase Auth, Postgres có Row Level Security (RLS), và bucket Storage riêng tư. Mã trong trình duyệt chỉ dùng **Project URL** và **anon/publishable key**; không đưa `service_role` key vào trang web.

## Cài đặt dịch vụ

1. Tạo một dự án Supabase. Trong SQL Editor, chạy toàn bộ [`supabase_setup.sql`](./supabase_setup.sql).
2. Trong Supabase **Project Settings → API**, lấy Project URL và public anon/publishable key. Điền vào [`backend-config.js`](./backend-config.js).
3. Trong **Authentication → URL Configuration**, đặt Site URL là địa chỉ HTTPS đã triển khai, rồi thêm chính xác địa chỉ của trang vào Redirect URLs. Trang chạy từ `file://` không phù hợp cho OAuth; hãy triển khai HTTPS hoặc dùng localhost khi phát triển.
4. Trong **Authentication → Providers**, bật Email. Chọn chính sách xác nhận email phù hợp với dự án và cấu hình email SMTP nếu cần gửi thư xác nhận đáng tin cậy.
5. Để bật Google: cấu hình OAuth client trong Google Cloud Console, thêm domain của trang vào **Authorized JavaScript origins**, nhập Client ID/Secret vào cấu hình Google provider của Supabase, rồi thêm callback URL do Supabase cung cấp vào danh sách redirect URI trong Google Cloud Console. Chỉ dùng client secret trong Supabase Dashboard, không đặt trong JavaScript.
6. Triển khai cùng `app.js`, `index.html`, `cloud-sync.js`, `backend-config.js` và `supabase_setup.sql` (SQL chỉ cần chạy một lần). `index.html` tải thư viện Supabase JS v2 từ CDN.

## Dữ liệu và quyền truy cập

- Mỗi bản ghi có UUID ổn định; lần đồng bộ lại dùng cùng UUID để tránh tạo bản sao.
- Kết quả cùng ảnh gốc được lưu riêng: hàng trong `grading_records` và ảnh trong bucket riêng tư `grading-sheets`. Đường dẫn ảnh có dạng `<auth-user-id>/<record-id>.jpg`.
- RLS giới hạn truy vấn theo `auth.uid()`. Chính sách Storage giới hạn ảnh theo thư mục ID người dùng. Không làm bucket công khai.
- Khi mất mạng, kết quả và Blob ảnh được giữ trong IndexedDB theo user ID rồi tự thử lại khi mạng trở lại/đăng nhập; nút **Thử đồng bộ lại** cũng cho phép retry. Trình duyệt cần cho phép IndexedDB và đủ dung lượng tạm.
- Cấu hình đề được lưu riêng cho từng tài khoản. Tài khoản mới bắt đầu bằng cấu hình trống mặc định; có thể chọn sao chép cấu hình đang có trên thiết bị khi được hỏi.
- Lịch sử cũ đã nằm trong localStorage trước khi bật tài khoản vẫn còn trên thiết bị gốc, nhưng chưa có ảnh đi kèm và không tự nhập lên tài khoản. Hãy xuất bản lưu cũ trước khi xóa dữ liệu trình duyệt.
- Mật khẩu không được ứng dụng lưu; Supabase Auth xử lý đăng nhập. Sign out chấm dứt phiên Supabase trên trình duyệt hiện tại.

## Kiểm tra sau cấu hình

Sau khi điền thông tin và triển khai, đăng ký tài khoản, xác nhận email nếu được yêu cầu, đăng nhập, chấm một phiếu, rồi mở trang trên trình duyệt khác và đăng nhập cùng tài khoản. Kiểm tra lịch sử, ảnh, cấu hình, đăng xuất và đăng nhập lại. Google OAuth chỉ hoạt động sau khi hoàn tất cấu hình nhà cung cấp và domain/redirect URLs.

Nếu bảng không xuất hiện trong Data API, kiểm tra **Project Settings → API → Exposed schemas** và bảo đảm `public` được bật. Không vô hiệu hóa RLS để khắc phục lỗi quyền.
