// sampleData.js - Dữ liệu mẫu chuẩn cho Công ty Minh An (B2B Thiết bị & Dịch vụ CNTT)

export const SAMPLE_PRODUCTS = [
  {
    sku: 'SRV-DL-R750',
    name: 'Máy chủ Dell PowerEdge R750',
    category: 'Máy chủ & Lưu trữ',
    unitPrice: 145000000,
    unit: 'Máy',
    specs: '2x Xeon Silver, 64GB RAM, 2x 1.92TB SSD NVMe'
  },
  {
    sku: 'SRV-HP-DL380',
    name: 'Máy chủ HPE ProLiant DL380 Gen11',
    category: 'Máy chủ & Lưu trữ',
    unitPrice: 158000000,
    unit: 'Máy',
    specs: 'Xeon Gold, 64GB DDR5, 4TB SAS'
  },
  {
    sku: 'SW-CS-9200L',
    name: 'Switch Cisco Catalyst 9200L 48-Port PoE+',
    category: 'Thiết bị mạng',
    unitPrice: 68000000,
    unit: 'Bộ',
    specs: '48x 1G PoE+, 4x 10G SFP+ Uplink'
  },
  {
    sku: 'SW-AR-6200F',
    name: 'Switch Aruba CX 6200F 48G PoE+',
    category: 'Thiết bị mạng',
    unitPrice: 54000000,
    unit: 'Bộ',
    specs: '48x 1G PoE+, 4x 10G SFP+, thay thế tương đương Cisco 9200L'
  },
  {
    sku: 'FW-FG-100F',
    name: 'Tường lửa FortiGate 100F + License 1 năm',
    category: 'Bảo mật mạng',
    unitPrice: 82000000,
    unit: 'Bộ',
    specs: 'UTP Bundle 1Y, 20 Gbps Firewall Throughput'
  },
  {
    sku: 'AP-UN-U6P',
    name: 'Bộ phát WiFi doanh nghiệp UniFi U6 Pro',
    category: 'Thiết bị mạng',
    unitPrice: 5200000,
    unit: 'Bộ',
    specs: 'WiFi 6 Dual-band AX5400, hỗ trợ 300+ user'
  },
  {
    sku: 'LAP-DL-5440',
    name: 'Laptop doanh nghiệp Dell Latitude 5440',
    category: 'Thiết bị đầu cuối',
    unitPrice: 24500000,
    unit: 'Máy',
    specs: 'Core i7-1355U, 16GB RAM, 512GB SSD, Win 11 Pro'
  },
  {
    sku: 'LAP-TP-T14',
    name: 'Laptop Lenovo ThinkPad T14 Gen 4',
    category: 'Thiết bị đầu cuối',
    unitPrice: 27000000,
    unit: 'Máy',
    specs: 'Core i7-1365U, 16GB RAM, 512GB SSD, bảo hành 3 năm'
  },
  {
    sku: 'UPS-APC-3000',
    name: 'Bộ lưu điện APC Smart-UPS 3000VA Rack 2U',
    category: 'Hạ tầng nguồn',
    unitPrice: 28500000,
    unit: 'Bộ',
    specs: '3000VA/2700W, LCD, Rackmount'
  },
  {
    sku: 'SVC-IMP-NET',
    name: 'Dịch vụ khảo sát, thi công & cấu hình hạ tầng mạng',
    category: 'Dịch vụ triển khai',
    unitPrice: 18000000,
    unit: 'Gói',
    specs: 'Bao gồm đi dây, cấu hình VLAN, Firewall, nghiệm thu'
  },
  {
    sku: 'SVC-MIG-SRV',
    name: 'Dịch vụ cài đặt & di trú dữ liệu máy chủ',
    category: 'Dịch vụ triển khai',
    unitPrice: 25000000,
    unit: 'Gói',
    specs: 'Ảo hóa VMware/Proxmox, backup và chuyển đổi không gián đoạn'
  },
  {
    sku: 'SVC-SLA-12M',
    name: 'Gói bảo trì & hỗ trợ kỹ thuật Onsite 24/7 (12 tháng)',
    category: 'Dịch vụ bảo trì',
    unitPrice: 36000000,
    unit: 'Năm',
    specs: 'Cam kết SLA phản hồi 2 giờ, thay thế thiết bị dự phòng'
  }
];

export const SAMPLE_INVENTORY = [
  { sku: 'SRV-DL-R750', name: 'Máy chủ Dell PowerEdge R750', availableQty: 4, leadTimeDays: 7, warehouseNote: 'Sẵn kho HCM; cấu hình & burn-in test mất 5-7 ngày' },
  { sku: 'SRV-HP-DL380', name: 'Máy chủ HPE ProLiant DL380 Gen11', availableQty: 2, leadTimeDays: 10, warehouseNote: 'Còn 2 máy tại kho Hà Nội' },
  { sku: 'SW-CS-9200L', name: 'Switch Cisco Catalyst 9200L 48-Port PoE+', availableQty: 3, leadTimeDays: 14, warehouseNote: 'Kho chỉ còn 3 bộ; đặt bổ sung từ hãng mất 14 ngày' },
  { sku: 'SW-AR-6200F', name: 'Switch Aruba CX 6200F 48G PoE+', availableQty: 12, leadTimeDays: 4, warehouseNote: 'Sẵn kho số lượng lớn, giao nhanh' },
  { sku: 'FW-FG-100F', name: 'Tường lửa FortiGate 100F + License 1 năm', availableQty: 6, leadTimeDays: 5, warehouseNote: 'Cần 2 ngày kích hoạt license hãng' },
  { sku: 'AP-UN-U6P', name: 'Bộ phát WiFi doanh nghiệp UniFi U6 Pro', availableQty: 45, leadTimeDays: 3, warehouseNote: 'Sẵn hàng tại cả 2 kho' },
  { sku: 'LAP-DL-5440', name: 'Laptop doanh nghiệp Dell Latitude 5440', availableQty: 28, leadTimeDays: 3, warehouseNote: 'Sẵn kho, cài đặt image doanh nghiệp trong 2-3 ngày' },
  { sku: 'LAP-TP-T14', name: 'Laptop Lenovo ThinkPad T14 Gen 4', availableQty: 15, leadTimeDays: 4, warehouseNote: 'Sẵn kho' },
  { sku: 'UPS-APC-3000', name: 'Bộ lưu điện APC Smart-UPS 3000VA Rack 2U', availableQty: 5, leadTimeDays: 5, warehouseNote: 'Còn 5 bộ nguyên đai kiện' },
  { sku: 'SVC-IMP-NET', name: 'Dịch vụ khảo sát, thi công & cấu hình hạ tầng mạng', availableQty: 99, leadTimeDays: 7, warehouseNote: 'Đội kỹ thuật triển khai trong 5-7 ngày tùy mặt bằng' },
  { sku: 'SVC-MIG-SRV', name: 'Dịch vụ cài đặt & di trú dữ liệu máy chủ', availableQty: 99, leadTimeDays: 10, warehouseNote: 'Yêu cầu khảo sát hệ thống cũ trước 3 ngày' },
  { sku: 'SVC-SLA-12M', name: 'Gói bảo trì & hỗ trợ kỹ thuật Onsite 24/7 (12 tháng)', availableQty: 99, leadTimeDays: 2, warehouseNote: 'Kích hoạt ngay sau khi bàn giao thiết bị' }
];

export const SAMPLE_POLICIES = [
  {
    id: 'POL-NVKD-STD',
    approverRole: 'Nhân viên Kinh doanh (Tự duyệt)',
    maxDiscountPct: 5,
    minOrderValue: 0,
    maxOrderValue: 300000000,
    conditionNote: 'Đơn hàng đủ tồn kho, thời gian giao >= lead time chuẩn, chiết khấu <= 5% và tổng giá trị <= 300 triệu.'
  },
  {
    id: 'POL-NVKD-MID',
    approverRole: 'Nhân viên Kinh doanh (Tự duyệt)',
    maxDiscountPct: 8,
    minOrderValue: 300000001,
    maxOrderValue: 600000000,
    conditionNote: 'Đơn hàng từ 300-600 triệu được chiết khấu tối đa 8% nếu đủ tồn kho và không gấp.'
  },
  {
    id: 'POL-MGR-ESC',
    approverRole: 'Trưởng phòng Kinh doanh',
    maxDiscountPct: 15,
    minOrderValue: 0,
    maxOrderValue: 1200000000,
    conditionNote: 'Chuyển Trưởng phòng duyệt khi chiết khấu > hạn mức NVKD (tối đa 15%), giá trị > 600 triệu đến 1.2 tỷ, hoặc cần cam kết giao gấp/thiếu tồn.'
  },
  {
    id: 'POL-DIR-ESC',
    approverRole: 'Ban Giám đốc',
    maxDiscountPct: 25,
    minOrderValue: 1200000001,
    maxOrderValue: 999999999999,
    conditionNote: 'Chuyển Ban Giám đốc khi chiết khấu > 15% hoặc giá trị đơn hàng > 1.2 tỷ VNĐ.'
  }
];

export const SAMPLE_SALES_TEAM = [
  { id: 'NV01', name: 'Nguyễn Minh Tuấn', specialty: 'Hạ tầng Máy chủ & Bảo mật', currentLoad: 12 },
  { id: 'NV02', name: 'Trần Thu Hà', specialty: 'Thiết bị Đầu cuối & Văn phòng', currentLoad: 10 },
  { id: 'NV03', name: 'Lê Hoàng Nam', specialty: 'Mạng Doanh nghiệp & WiFi', currentLoad: 11 },
  { id: 'NV04', name: 'Phạm Quỳnh Anh', specialty: 'Giải pháp Tổng thể & Dịch vụ SLA', currentLoad: 9 },
  { id: 'NV05', name: 'Vũ Đức Khải', specialty: 'Khách hàng Chuỗi & Bán lẻ', currentLoad: 13 },
  { id: 'NV06', name: 'Đỗ Ngọc Linh', specialty: 'Khách hàng Tài chính & Sản xuất', currentLoad: 10 }
];

export const SAMPLE_REQUESTS = [
  {
    id: 'REQ-2026-001',
    channel: 'Email',
    rawText: `Kính gửi Công ty Minh An,
Tôi là Anh Hoàng (hoang.tran@saigonlogistics.vn) - Trưởng phòng IT Công ty Saigon Logistics.
Chúng tôi đang mở rộng văn phòng mới và cần báo giá các hạng mục sau:
- 10 Laptop doanh nghiệp Dell Latitude 5440
- 8 Bộ phát WiFi doanh nghiệp UniFi U6 Pro
- 1 Gói dịch vụ khảo sát, thi công & cấu hình hạ tầng mạng
Ngân sách dự kiến khoảng 320 triệu VNĐ.
Thời hạn triển khai mong muốn: trong vòng 10 ngày tới.
Nếu được bên Minh An hỗ trợ chiết khấu 5% cho đơn hàng đầu tiên.`
  },
  {
    id: 'REQ-2026-002',
    channel: 'Biểu mẫu Web',
    rawText: `Khách hàng: Tập đoàn Dược Phẩm Á Châu (Liên hệ: Chị Lan - lan.nguyen@asiapharma.vn)
Nhu cầu nâng cấp Datacenter chi nhánh:
- 3 Máy chủ Dell PowerEdge R750
- 2 Tường lửa FortiGate 100F + License 1 năm
- 2 Bộ lưu điện APC Smart-UPS 3000VA Rack 2U
- 1 Dịch vụ cài đặt & di trú dữ liệu máy chủ
- 1 Gói bảo trì & hỗ trợ kỹ thuật Onsite 24/7 (12 tháng)
Tổng ngân sách tối đa: 680 triệu.
Thời hạn hoàn thành: 15 ngày kể từ khi ký hợp đồng.
Đề nghị chiết khấu: 12% vì mua trọn gói thiết bị và dịch vụ.`
  },
  {
    id: 'REQ-2026-003',
    channel: 'Email',
    rawText: `Chào Minh An,
Bên mình là Công ty CP Xây dựng Tân Tiến (email: mua.hang@tantiencons.vn).
Sếp giao mình hỏi giá mua gấp 15 Laptop Lenovo ThinkPad T14 Gen 4 cho nhân sự mới và 1 Firewall FortiGate 100F.
Bên bạn gửi báo giá giúp mình sớm nhé, có thể cân nhắc giảm giá thêm cho bên mình.`
  },
  {
    id: 'REQ-2026-004',
    channel: 'Email',
    rawText: `Gửi bộ phận Kinh doanh Minh An,
Tôi là anh Dũng (dung.le@viettechbank.com) - Khối Hạ tầng Ngân hàng Việt Tech.
Chúng tôi cần gấp thiết bị thay thế cho chi nhánh miền Trung:
- 6 Switch Cisco Catalyst 9200L 48-Port PoE+
- 1 Máy chủ HPE ProLiant DL380 Gen11
Ngân sách dự kiến: 580 triệu đồng.
Thời hạn giao hàng bắt buộc: trong vòng 4 ngày tới (không thể trễ hơn).
Chiết khấu đề xuất: 7%.`
  },
  {
    id: 'REQ-2026-005',
    channel: 'Biểu mẫu Web',
    rawText: `Đơn vị: Công ty TNHH Thương Mại An Phú (anh Bình - binh@anphutrading.vn)
Cần đặt mua:
- 12 Laptop Dell Latitude 5440 (theo báo giá năm ngoái bên mình gửi là 21 triệu/máy)
- 4 Bộ phát WiFi UniFi U6 Pro
- 1 Phần mềm quản trị ERP kế toán chuyên ngành sản xuất
Ngân sách tổng: 330 triệu. Thời hạn triển khai: 12 ngày. Chiết khấu: 4%.`
  },
  {
    id: 'REQ-2026-006',
    channel: 'Email',
    rawText: `Kính gửi Ban Kinh doanh Minh An,
Tập đoàn Bán lẻ Đông Dương (Ms. Mai - mai.pham@indochinaretail.vn) dự kiến triển khai chuỗi 20 cửa hàng mới:
- 20 Switch Aruba CX 6200F 48G PoE+
- 40 Bộ phát WiFi UniFi U6 Pro
- 4 Tường lửa FortiGate 100F + License 1 năm
- 4 Gói dịch vụ khảo sát, thi công & cấu hình hạ tầng mạng
Ngân sách tổng: 1.5 tỷ VNĐ.
Thời hạn triển khai: 20 ngày.
Vì là dự án chuỗi lớn, chúng tôi đề nghị mức chiết khấu đặc biệt 18%.`
  }
];

