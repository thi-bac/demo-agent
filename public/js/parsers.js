// parsers.js - CSV, XLSX, Google Sheets & Vietnamese number/column normalization

export function removeDiacritics(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

export function normalizeKey(str) {
  return removeDiacritics(str)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function parseNumber(val, defaultVal = 0) {
  if (typeof val === 'number' && !Number.isNaN(val)) return val;
  const s = String(val ?? '').trim();
  if (!s) return defaultVal;

  // Handle percentage
  const clean = s.replace(/%/g, '').trim();
  // Vietnamese style: 25.000.000 or 25,000,000
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(clean)) {
    return parseFloat(clean.replace(/\./g, '').replace(',', '.'));
  }
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(clean)) {
    return parseFloat(clean.replace(/,/g, ''));
  }
  const num = parseFloat(clean.replace(/,/g, '.').replace(/[^0-9.-]/g, ''));
  return Number.isNaN(num) ? defaultVal : num;
}

export function parseMoneyVND(val) {
  if (typeof val === 'number' && !Number.isNaN(val)) return val;
  const s = removeDiacritics(String(val ?? '')).toLowerCase().trim();
  if (!s) return null;

  const tyMatch = s.match(/(\d+(?:[.,]\d+)?)\s*(ty|ti|b|billion)/);
  if (tyMatch) {
    return Math.round(parseFloat(tyMatch[1].replace(',', '.')) * 1_000_000_000);
  }
  const trMatch = s.match(/(\d+(?:[.,]\d+)?)\s*(trieu|tr|m|million)/);
  if (trMatch) {
    return Math.round(parseFloat(trMatch[1].replace(',', '.')) * 1_000_000);
  }
  const kMatch = s.match(/(\d+(?:[.,]\d+)?)\s*(nghin|ngan|k)\b/);
  if (kMatch) {
    return Math.round(parseFloat(kMatch[1].replace(',', '.')) * 1_000);
  }

  const stripped = s.replace(/(vnd|vnđ|d|đ|\s)/gi, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(stripped)) {
    return parseInt(stripped.replace(/\./g, ''), 10);
  }
  if (/^\d{1,3}(,\d{3})+$/.test(stripped)) {
    return parseInt(stripped.replace(/,/g, ''), 10);
  }
  const plain = parseFloat(stripped.replace(/[^0-9.]/g, ''));
  return Number.isNaN(plain) ? null : Math.round(plain);
}

export function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/)[0] || '';
  const commas = (firstLine.match(/,/g) || []).length;
  const semis = (firstLine.match(/;/g) || []).length;
  const tabs = (firstLine.match(/\t/g) || []).length;
  if (tabs > commas && tabs > semis) return '\t';
  if (semis > commas) return ';';
  return ',';
}

export function parseCSV(rawText) {
  const text = String(rawText || '').replace(/^\uFEFF/, '');
  if (!text.trim()) return [];
  const delim = detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(cell.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cell = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some((c) => c !== '')) rows.push(row);

  return rows;
}

// Pure-JS XLSX fallback using DecompressionStream('deflate-raw') + DOMParser
async function inflateRawBytes(uint8) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Trình duyệt không hỗ trợ DecompressionStream để giải nén XLSX offline.');
  }
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(uint8);
  writer.close();
  const res = await new Response(ds.readable).arrayBuffer();
  return new TextDecoder('utf-8').decode(res);
}

function colRefToIndex(ref) {
  const letters = String(ref || '').replace(/[^A-Za-z]/g, '').toUpperCase();
  if (!letters) return 0;
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

export async function parseXlsxBufferClient(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);

  // Locate EOCD
  let eocdPos = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos < 0) throw new Error('File XLSX không hợp lệ.');

  const cdSize = view.getUint32(eocdPos + 12, true);
  const cdOffset = view.getUint32(eocdPos + 16, true);
  const decoder = new TextDecoder('utf-8');
  const entries = {};

  let pos = cdOffset;
  const cdEnd = cdOffset + cdSize;
  while (pos < cdEnd) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;
    const method = view.getUint16(pos + 10, true);
    const compSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    pos += 46 + nameLen + extraLen + commentLen;

    if (view.getUint32(localOffset, true) !== 0x04034b50) continue;
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const payloadOffset = localOffset + 30 + lNameLen + lExtraLen;
    const compressed = bytes.subarray(payloadOffset, payloadOffset + compSize);

    if (method === 0) {
      entries[name] = decoder.decode(compressed);
    } else if (method === 8) {
      entries[name] = await inflateRawBytes(compressed);
    }
  }

  const domParser = new DOMParser();
  const sharedStrings = [];
  if (entries['xl/sharedStrings.xml']) {
    const ssDoc = domParser.parseFromString(entries['xl/sharedStrings.xml'], 'application/xml');
    ssDoc.querySelectorAll('si').forEach((si) => {
      const texts = Array.from(si.querySelectorAll('t')).map((t) => t.textContent || '');
      sharedStrings.push(texts.join(''));
    });
  }

  const relsMap = {};
  if (entries['xl/_rels/workbook.xml.rels']) {
    const rDoc = domParser.parseFromString(entries['xl/_rels/workbook.xml.rels'], 'application/xml');
    rDoc.querySelectorAll('Relationship').forEach((rel) => {
      const id = rel.getAttribute('Id');
      let target = (rel.getAttribute('Target') || '').replace(/^\//, '');
      if (!target.startsWith('xl/')) target = `xl/${target}`;
      relsMap[id] = target;
    });
  }

  const sheetDefs = [];
  if (entries['xl/workbook.xml']) {
    const wbDoc = domParser.parseFromString(entries['xl/workbook.xml'], 'application/xml');
    let idx = 0;
    wbDoc.querySelectorAll('sheet').forEach((sh) => {
      idx++;
      const name = sh.getAttribute('name') || `Sheet${idx}`;
      const rId = sh.getAttribute('r:id') || sh.getAttribute('id');
      const path = relsMap[rId] || `xl/worksheets/sheet${idx}.xml`;
      sheetDefs.push({ name, path });
    });
  }

  return sheetDefs.map((sd) => {
    const xml = entries[sd.path];
    if (!xml) return { name: sd.name, rows: [] };
    const doc = domParser.parseFromString(xml, 'application/xml');
    const rows = [];
    let maxCols = 0;

    doc.querySelectorAll('sheetData > row').forEach((rowEl) => {
      const cells = [];
      rowEl.querySelectorAll('c').forEach((c) => {
        const ref = c.getAttribute('r');
        const colIdx = ref ? colRefToIndex(ref) : cells.length;
        while (cells.length < colIdx) cells.push('');
        const t = c.getAttribute('t') || '';
        let val = '';
        if (t === 's') {
          const v = c.querySelector('v');
          val = sharedStrings[parseInt(v?.textContent || '0', 10)] || '';
        } else if (t === 'inlineStr') {
          val = Array.from(c.querySelectorAll('t')).map((el) => el.textContent || '').join('');
        } else if (t === 'b') {
          val = c.querySelector('v')?.textContent === '1' ? 'TRUE' : 'FALSE';
        } else {
          val = c.querySelector('v')?.textContent || '';
        }
        cells[colIdx] = val.trim();
      });
      if (cells.some((x) => x !== '')) {
        if (cells.length > maxCols) maxCols = cells.length;
        rows.push(cells);
      }
    });

    rows.forEach((r) => {
      while (r.length < maxCols) r.push('');
    });
    return { name: sd.name, rows };
  });
}

export async function parseUploadedFile(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) {
    const text = await file.text();
    const rows = parseCSV(text);
    return [{ name: file.name.replace(/\.[^.]+$/, ''), rows }];
  }
  if (name.endsWith('.xlsx')) {
    const buf = await file.arrayBuffer();
    if (window.location.protocol.startsWith('http')) {
      try {
        const res = await fetch('/api/parse-xlsx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: buf
        });
        const json = await res.json();
        if (res.ok && json.ok) return json.sheets;
      } catch (_) {
        // Fallback to pure JS client parser
      }
    }
    return await parseXlsxBufferClient(buf);
  }
  throw new Error('Định dạng file chưa hỗ trợ. Vui lòng chọn file .CSV hoặc .XLSX.');
}

export async function fetchGoogleSheet(url, mode = 'auto') {
  if (!window.location.protocol.startsWith('http')) {
    throw new Error('Để tải trực tiếp từ link Google Sheets (tránh CORS), vui lòng chạy ứng dụng qua server (start.command hoặc ruby server.rb).');
  }
  const apiUrl = `/api/fetch-gsheet?url=${encodeURIComponent(url.trim())}&mode=${encodeURIComponent(mode)}`;
  const res = await fetch(apiUrl);
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(json.error || 'Không thể tải dữ liệu từ Google Sheets.');
  }
  return json.sheets;
}

export function rowsToRecords(rows) {
  if (!rows || rows.length < 2) return [];
  const rawHeaders = rows[0];
  const headers = rawHeaders.map((h, idx) => ({
    raw: String(h || `Col${idx + 1}`).trim(),
    norm: normalizeKey(h || `col_${idx + 1}`)
  }));

  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h.raw] = r[idx] ?? '';
      obj[`__norm__${h.norm}`] = r[idx] ?? '';
    });
    return obj;
  });
}

function pickField(record, aliases) {
  for (const alias of aliases) {
    const norm = normalizeKey(alias);
    const key = `__norm__${norm}`;
    if (record[key] !== undefined && String(record[key]).trim() !== '') {
      return String(record[key]).trim();
    }
  }
  // Substring match fallback
  const keys = Object.keys(record).filter((k) => k.startsWith('__norm__'));
  for (const alias of aliases) {
    const norm = normalizeKey(alias);
    const found = keys.find((k) => k.includes(norm));
    if (found && String(record[found]).trim() !== '') {
      return String(record[found]).trim();
    }
  }
  return '';
}

export function mapProducts(rows) {
  return rowsToRecords(rows)
    .map((rec, i) => ({
      sku: pickField(rec, ['sku', 'ma_sp', 'ma_san_pham', 'product_id', 'code', 'ma']) || `SP-${i + 1}`,
      name: pickField(rec, ['ten_san_pham', 'san_pham', 'product_name', 'ten_sp', 'name', 'ten', 'dich_vu']),
      category: pickField(rec, ['danh_muc', 'nhom', 'loai', 'category', 'type']) || 'Thiết bị CNTT',
      unitPrice: parseMoneyVND(pickField(rec, ['don_gia', 'gia_ban', 'gia', 'unit_price', 'price', 'gia_niem_yet'])) || 0,
      unit: pickField(rec, ['don_vi', 'dvt', 'unit']) || 'Bộ',
      specs: pickField(rec, ['mo_ta', 'thong_so', 'description', 'ghi_chu'])
    }))
    .filter((p) => p.name);
}

export function mapInventory(rows) {
  return rowsToRecords(rows)
    .map((rec) => ({
      sku: pickField(rec, ['sku', 'ma_sp', 'ma_san_pham', 'product_id', 'code', 'ma']),
      name: pickField(rec, ['ten_san_pham', 'san_pham', 'product_name', 'ten_sp', 'name']),
      availableQty: parseNumber(pickField(rec, ['ton_kha_dung', 'ton_kho', 'so_luong_ton', 'available', 'stock', 'qty']), 0),
      leadTimeDays: parseNumber(pickField(rec, ['thoi_gian_trien_khai', 'lead_time', 'so_ngay_trien_khai', 'thoi_han_giao', 'lead_time_ngay', 'deployment_days']), 5),
      warehouseNote: pickField(rec, ['ghi_chu', 'trang_thai_kho', 'note', 'kho'])
    }))
    .filter((inv) => inv.sku || inv.name);
}

export function mapPolicies(rows) {
  return rowsToRecords(rows)
    .map((rec, i) => ({
      id: pickField(rec, ['ma_chinh_sach', 'id', 'tier', 'bac']) || `POL-${i + 1}`,
      approverRole: pickField(rec, ['cap_duyet', 'nguoi_duyet', 'vai_tro', 'approver', 'role']) || 'NVKD',
      maxDiscountPct: parseNumber(pickField(rec, ['chiet_khau_toi_da', 'ck_toi_da', 'max_discount', 'discount_max', 'muc_ck']), 5),
      minOrderValue: parseMoneyVND(pickField(rec, ['gia_tri_toi_thieu', 'don_toi_thieu', 'min_value', 'tu_gia_tri'])) || 0,
      maxOrderValue: parseMoneyVND(pickField(rec, ['gia_tri_toi_da', 'don_toi_da', 'max_value', 'den_gia_tri'])) || 999_999_999_999,
      conditionNote: pickField(rec, ['dieu_kien', 'ghi_chu', 'chuyen_duyet', 'condition', 'note'])
    }))
    .filter((p) => p.approverRole);
}

export function mapSalesTeam(rows) {
  return rowsToRecords(rows)
    .map((rec, i) => ({
      id: pickField(rec, ['ma_nv', 'id', 'code']) || `NVKD-${i + 1}`,
      name: pickField(rec, ['ten_nv', 'ho_ten', 'nhan_vien', 'name']),
      specialty: pickField(rec, ['chuyen_mon', 'nhom', 'phu_trach', 'specialty']) || 'Doanh nghiệp B2B',
      currentLoad: parseNumber(pickField(rec, ['tai_hien_tai', 'so_co_hoi', 'workload']), 0)
    }))
    .filter((s) => s.name);
}

export function mapRequests(rows) {
  return rowsToRecords(rows)
    .map((rec, i) => {
      const rawText = pickField(rec, ['noi_dung', 'yeu_cau', 'mo_ta_yeu_cau', 'request_text', 'email_body', 'chi_tiet', 'content']);
      const customerName = pickField(rec, ['khach_hang', 'ten_khach_hang', 'cong_ty', 'customer', 'company']);
      const contact = pickField(rec, ['lien_he', 'email', 'nguoi_lien_he', 'contact', 'sdt']);
      const productsRaw = pickField(rec, ['san_pham', 'danh_sach_sp', 'hang_muc', 'products', 'items']);
      const budgetRaw = pickField(rec, ['ngan_sach', 'budget', 'ngan_sach_tong']);
      const deadlineRaw = pickField(rec, ['thoi_han', 'deadline', 'han_trien_khai', 'thoi_gian_mong_muon']);
      const discountRaw = pickField(rec, ['chiet_khau', 'de_nghi_ck', 'discount']);
      const reqId = pickField(rec, ['ma_yeu_cau', 'id', 'req_id']) || `REQ-${String(i + 1).padStart(3, '0')}`;

      let combinedText = rawText;
      if (!combinedText) {
        const parts = [];
        if (customerName) parts.push(`Khách hàng: ${customerName}`);
        if (contact) parts.push(`Liên hệ: ${contact}`);
        if (productsRaw) parts.push(`Sản phẩm yêu cầu: ${productsRaw}`);
        if (budgetRaw) parts.push(`Ngân sách tổng: ${budgetRaw}`);
        if (deadlineRaw) parts.push(`Thời hạn triển khai: ${deadlineRaw}`);
        if (discountRaw) parts.push(`Đề nghị chiết khấu: ${discountRaw}`);
        combinedText = parts.join('\n');
      }

      return {
        id: reqId,
        channel: pickField(rec, ['kenh', 'nguon', 'channel', 'source']) || 'Email/Biểu mẫu',
        customerName,
        contact,
        budgetHint: budgetRaw,
        deadlineHint: deadlineRaw,
        discountHint: discountRaw,
        productsHint: productsRaw,
        rawText: combinedText
      };
    })
    .filter((r) => r.rawText && r.rawText.trim().length > 0);
}

// Auto-classify sheets from a multi-sheet XLSX or Google Sheet workbook
export function classifyWorkbookSheets(sheets) {
  const result = {
    products: null,
    inventory: null,
    policies: null,
    salesTeam: null,
    requests: null,
    unmatched: []
  };

  for (const sheet of sheets) {
    if (!sheet.rows || sheet.rows.length < 2) continue;
    const sName = normalizeKey(sheet.name);
    const headerStr = sheet.rows[0].map((h) => normalizeKey(h)).join(' ');

    const hasPrice = /don_gia|gia_ban|unit_price|price/.test(headerStr);
    const hasStock = /ton_kha_dung|ton_kho|available|stock|thoi_gian_trien_khai|lead_time/.test(headerStr);
    const hasPolicy = /chiet_khau_toi_da|max_discount|cap_duyet|approver/.test(headerStr);
    const hasRequest = /noi_dung|yeu_cau|request_text|email_body|khach_hang|customer/.test(headerStr) && !hasPrice;
    const hasSales = /ma_nv|tai_hien_tai|workload|nhan_vien/.test(headerStr) && !hasRequest;

    if (hasPrice || /san_pham|danh_muc|product|catalog|bang_gia/.test(sName)) {
      result.products = mapProducts(sheet.rows);
      if (hasStock) {
        result.inventory = mapInventory(sheet.rows);
      }
    } else if (hasStock || /ton_kho|kho|inventory|trien_khai/.test(sName)) {
      result.inventory = mapInventory(sheet.rows);
    } else if (hasPolicy || /chinh_sach|chiet_khau|policy|duyet/.test(sName)) {
      result.policies = mapPolicies(sheet.rows);
    } else if (hasSales || /nvkd|kinh_doanh|sales_team|nhan_su/.test(sName)) {
      result.salesTeam = mapSalesTeam(sheet.rows);
    } else if (hasRequest || /yeu_cau|request|khach_hang|co_hoi|lead/.test(sName)) {
      result.requests = mapRequests(sheet.rows);
    } else {
      result.unmatched.push(sheet.name);
    }
  }

  return result;
}

// =========================================================================
// B1.1 GATEKEEPER: Kiểm tra định dạng .xlsx & chất lượng dữ liệu tĩnh
// =========================================================================
export const GATEKEEPER_FORMAT_ERROR =
  'Lỗi định dạng hệ thống: Bảng dữ liệu bắt buộc phải là file Excel (.xlsx). Vui lòng kiểm tra và xuất lại file chuẩn.';

export function validateGatekeeperSourceName(sourceNameOrUrl) {
  const s = String(sourceNameOrUrl || '').trim().toLowerCase();
  if (!s) return { ok: false, error: GATEKEEPER_FORMAT_ERROR };
  if (/docs\.google\.com\/document/.test(s)) {
    return { ok: false, error: GATEKEEPER_FORMAT_ERROR };
  }
  if (!s.endsWith('.xlsx')) {
    return { ok: false, error: GATEKEEPER_FORMAT_ERROR };
  }
  return { ok: true, error: null };
}

export function validateGatekeeperSheets(sheets, targetType = 'auto') {
  const errors = [];
  if (!Array.isArray(sheets) || sheets.length === 0) {
    errors.push('Tệp Excel (.xlsx) không có trang tính hợp lệ.');
    return { ok: false, errors };
  }

  const FORMULA_ERR_RE = /^#(REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|ERROR!)$/i;

  for (const sheet of sheets) {
    const rows = sheet.rows || [];
    if (rows.length < 2) {
      errors.push(`Trang "${sheet.name}" thiếu dữ liệu (cần ít nhất 1 dòng tiêu đề và 1 dòng dữ liệu).`);
      continue;
    }

    const headers = rows[0].map((h) => normalizeKey(h));
    // Check empty rows
    let emptyRowCount = 0;
    const seenSkus = new Set();

    const skuColIdx = headers.findIndex((h) => ['sku', 'ma_sp', 'ma_san_pham', 'product_id', 'code'].includes(h));

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const nonEmpty = row.some((cell) => String(cell ?? '').trim() !== '');
      if (!nonEmpty) {
        emptyRowCount++;
        continue;
      }

      for (let c = 0; c < row.length; c++) {
        const val = String(row[c] ?? '').trim();
        if (FORMULA_ERR_RE.test(val)) {
          errors.push(`Trang "${sheet.name}" dòng ${r + 1}, cột ${c + 1} chứa lỗi công thức (${val}).`);
        }
      }

      if (skuColIdx >= 0) {
        const skuVal = String(row[skuColIdx] ?? '').trim().toUpperCase();
        if (skuVal) {
          if (seenSkus.has(skuVal)) {
            errors.push(`Trang "${sheet.name}" bị trùng mã SKU "${skuVal}" ở dòng ${r + 1}.`);
          }
          seenSkus.add(skuVal);
        }
      }
    }

    if (emptyRowCount > 0) {
      errors.push(`Trang "${sheet.name}" có ${emptyRowCount} dòng trống giữa bảng.`);
    }

    // Check required columns when targetType is specific
    if (targetType === 'products' && !headers.some((h) => /don_gia|gia_ban|unit_price|price/.test(h))) {
      errors.push(`Trang "${sheet.name}" thiếu cột bắt buộc về Đơn giá (don_gia / unitPrice).`);
    }
    if (targetType === 'inventory' && !headers.some((h) => /ton_kha_dung|ton_kho|available|stock/.test(h))) {
      errors.push(`Trang "${sheet.name}" thiếu cột bắt buộc về Tồn khả dụng (ton_kha_dung / availableQty).`);
    }
    if (targetType === 'policies' && !headers.some((h) => /chiet_khau|max_discount|cap_duyet|approver/.test(h))) {
      errors.push(`Trang "${sheet.name}" thiếu cột bắt buộc về Chính sách chiết khấu.`);
    }
  }

  return { ok: errors.length === 0, errors };
}

// =========================================================================
// EXPORT MULTI-SHEET .XLSX (Pure JS OOXML ZIP - STORE method)
// =========================================================================
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function xmlEscape(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colIndexToLetter(idx) {
  let n = idx + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function buildWorksheetXml(rows) {
  const rowXml = rows.map((row, rIdx) => {
    const cells = row.map((val, cIdx) => {
      const ref = `${colIndexToLetter(cIdx)}${rIdx + 1}`;
      if (typeof val === 'number' && Number.isFinite(val)) {
        return `<c r="${ref}"><v>${val}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(val)}</t></is></c>`;
    }).join('');
    return `<row r="${rIdx + 1}">${cells}</row>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`;
}

export function buildXlsxBytes(sheets) {
  const enc = new TextEncoder();
  const safeSheets = (sheets || []).map((s, idx) => ({
    name: String(s.name || `Sheet${idx + 1}`).replace(/[\\/*?:[\]]/g, '').slice(0, 31) || `Sheet${idx + 1}`,
    rows: s.rows || []
  }));

  const files = [];
  const addText = (path, txt) => files.push({ path, data: enc.encode(txt) });

  const sheetOverrides = safeSheets.map((_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join('');

  addText('[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
    + `${sheetOverrides}</Types>`
  );

  addText('_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
    + `</Relationships>`
  );

  const wbSheets = safeSheets.map((s, i) =>
    `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
  ).join('');
  addText('xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<sheets>${wbSheets}</sheets></workbook>`
  );

  const wbRels = safeSheets.map((_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  ).join('');
  addText('xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${wbRels}</Relationships>`
  );

  safeSheets.forEach((s, i) => {
    addText(`xl/worksheets/sheet${i + 1}.xml`, buildWorksheetXml(s.rows));
  });

  // Pack as STORE ZIP
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.path);
    const data = f.data;
    const crc = crc32(data);

    const lh = new Uint8Array(30 + nameBytes.length);
    const lhv = new DataView(lh.buffer);
    lhv.setUint32(0, 0x04034b50, true);
    lhv.setUint16(4, 20, true);
    lhv.setUint16(6, 0x0800, true); // UTF-8
    lhv.setUint16(8, 0, true);      // STORE
    lhv.setUint32(14, crc, true);
    lhv.setUint32(18, data.length, true);
    lhv.setUint32(22, data.length, true);
    lhv.setUint16(26, nameBytes.length, true);
    lh.set(nameBytes, 30);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(cd.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0x0800, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, data.length, true);
    cdv.setUint32(24, data.length, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);

    localParts.push(lh, data);
    centralParts.push(cd);
    offset += lh.length + data.length;
  }

  const cdSize = centralParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const totalLen = offset + cdSize + 22;
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of localParts) { out.set(p, pos); pos += p.length; }
  for (const p of centralParts) { out.set(p, pos); pos += p.length; }
  out.set(eocd, pos);
  return out;
}

export function downloadWorkbookAsXlsx(sheets, filename = 'MinhAn_BaoCao.xlsx') {
  const bytes = buildXlsxBytes(sheets);
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


