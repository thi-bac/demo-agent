# Minh An Company — Hệ thống Multi-Agent Xử lý Cơ hội Bán hàng B2B

Ứng dụng web chạy **localhost** điều phối quy trình xử lý cơ hội bán hàng B2B cho Công ty Công nghệ Minh An theo đúng sơ đồ workflow và thiết kế Multi-Agent (5 Agent chuyên biệt + 2 điểm kiểm soát con người).

## 1. Cách khởi chạy Localhost

- **Cách 1 (Nhanh nhất trên macOS):** Nhấp đúp file `start.command` trong thư mục dự án, hoặc chạy trên Terminal:
  ```zsh
  ./start.command
  ```
- **Cách 2 (Chạy trực tiếp bằng Ruby có sẵn trên macOS):**
  ```zsh
  ruby server.rb
  ```
  Sau đó mở trình duyệt tại: **http://127.0.0.1:8765**

## 2. Nguồn dữ liệu đầu vào hỗ trợ

1. **Google Sheet Link:** Dán link Google Sheets (đặt chế độ chia sẻ *"Bất kỳ ai có đường liên kết đều có thể xem"*). Server Ruby tích hợp sẵn proxy `/api/fetch-gsheet` để tải trực tiếp toàn bộ workbook nhiều tab (`.xlsx`) hoặc từng tab (`gid=...`).
2. **File CSV / XLSX:** Tải lên file `.csv` hoặc `.xlsx` đơn lẻ hoặc 1 file `.xlsx` chứa nhiều sheet (hệ thống tự động phân loại sheet Sản phẩm, Tồn kho & Lead-time, Chính sách chiết khấu, Danh sách yêu cầu).
3. **Bộ file mẫu có sẵn:** Thư mục `sample_files/` gồm `minh_an_all_in_one.xlsx` (4 sheet) và các file `.csv` mẫu để kiểm thử ngay.

## 3. Kiến trúc 5 AI Agent & Kiểm soát Con người

- **Agent 1 (`IntakeAgent`):** Bóc tách văn bản yêu cầu từ email/biểu mẫu/bảng (tên đơn vị, liên hệ, sản phẩm, số lượng, ngân sách, thời hạn, chiết khấu).
- **Agent 2 (`TriageAgent`):** Kiểm tra đủ thông tin; nếu thiếu → rẽ nhánh **Yêu cầu KH làm rõ**; nếu đủ → tạo Mã Hồ sơ (`OPP-...`) và gán 1 trong 6 NVKD phụ trách.
- **Agent 3 (`InventoryPricingAgent`):** Đối soát SKU, đơn giá hiện hành (phát hiện giá cũ), tồn khả dụng, Lead-time vs Deadline, gợi ý SKU thay thế khi thiếu tồn.
- **Agent 4 (`PolicyGovernanceAgent`):** Kiểm tra hạn mức chiết khấu, điều kiện chuyển duyệt (NVKD / Trưởng phòng KD / Ban Giám đốc) và bảng phát hiện sai lệch.
- **Agent 5 (`AdvisorDraftingAgent`):** Sinh **Đề xuất kinh doanh** và **Bản nháp email phản hồi khách hàng** trực tiếp trên giao diện.
- **Human-in-the-Loop:** Checkpoint #1 (Vận hành xác nhận tồn kho/tiến độ) và Checkpoint #2 (Trưởng phòng/BGĐ phê duyệt vượt quyền trực tiếp trên UI).

