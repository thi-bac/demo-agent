// workflowEngine.js — Quy trình Zero-Trust To-Be (B1.1 → B9) Công ty Minh An
import { formatVND } from './agents.js';

export const ROLES = [
  { id: 'NVKD', label: 'NVKD (Nguyễn Văn A)', short: 'NVKD' },
  { id: 'KHO', label: 'Nhân viên Kho (Phạm Văn Kho)', short: 'Kho' },
  { id: 'TRUONG_PHONG', label: 'Trưởng phòng KD (Lê Minh)', short: 'Trưởng phòng' },
  { id: 'GIAM_DOC', label: 'Giám đốc KD (Chị Lộc)', short: 'Giám đốc KD' },
  { id: 'ADMIN', label: 'Quản trị Hệ thống (Admin)', short: 'Admin' }
];

export const DEFAULT_ADMIN_CONFIG = {
  nvkdDiscountLimitPct: 10,
  hardDiscountLimitPct: 15,
  vipThresholdVND: 10_000_000_000, // 10 tỷ VNĐ
  urgentKeywords: ['gấp', 'ngay lập tức', 'chậm nhất tuần sau', 'đang dừng dự án', 'khẩn'],
  seniorKamList: ['Nguyễn Văn A (Senior KAM)', 'Trần Thị B (Senior)'],
  maxRejectRounds: 3,
  followUpDays: 3,
  slaCleanMinutes: 30,
  slaKhoUrgentHours: 1,
  slaKhoNormalHours: 4,
  slaMgrUrgentHours: 2,
  slaDirHours: 4,
  priceListVersion: 'BG-2026.11-V3'
};

export const STEP_ORDER = ['B1.2', 'B1.3', 'B1.4', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9'];

export const STEP_LABELS = {
  'B1.1': 'B1.1 Tiếp nhận & Gatekeeper',
  'B1.2': 'B1.2 AI Làm sạch Dữ liệu',
  'B1.3': 'B1.3 NVKD Duyệt Bản sạch',
  'B1.4': 'B1.4 Trích xuất JSON & Gắn thẻ',
  'B2': 'B2 Đối soát Kho & Giá',
  'B3': 'B3 Kiểm duyệt Kho & Giá',
  'B4': 'B4 Thẩm định Chiết khấu',
  'B5': 'B5 Phê duyệt Ngoại lệ',
  'B6': 'B6 Sinh 4 Sản phẩm Đề xuất',
  'B7': 'B7 NVKD Duyệt Nội dung',
  'B8': 'B8 Giám đốc KD Duyệt cuối',
  'B9': 'B9 Gửi khách & Đóng hồ sơ'
};

function nowTimeStr() {
  return new Date().toTimeString().slice(0, 8);
}

function normalizeStr(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim();
}

function addAuditLog(dossier, actorRole, actorName, step, action, detail, level = 'info') {
  dossier.auditLog.unshift({
    time: nowTimeStr(),
    version: `v${dossier.version}`,
    step,
    actorRole,
    actorName,
    action,
    detail,
    level
  });
}

export function pushNotification(notifications, { event, recipient, oppId, company, message, level = 'info' }) {
  if (!Array.isArray(notifications)) return;
  notifications.unshift({
    id: `NTF-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    time: nowTimeStr(),
    event,
    recipient,
    oppId,
    company,
    message,
    level,
    read: false
  });
}

// =========================================================================
// B1.2: AI LÀM SẠCH DỮ LIỆU (Không tự đoán, gắn cờ Vàng/Đỏ + diff)
// =========================================================================
export function runB12Cleaning(rawText, adminConfig, redoNote = '') {
  const original = String(rawText || '').trim();
  const lines = original.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const changeLog = [];
  const flags = [];
  const evidenceQuotes = [];

  // 1. Remove signatures, disclaimers, pleasantries, repeated headers
  const cleanedLines = [];
  const noiseRe = /^(trân trọng|best regards|regards|kính chào|xin chào|dear |lưu ý bảo mật|disclaimer|sent from|từ:|from:|chủ đề:|subject:|---)/i;
  for (const line of lines) {
    if (noiseRe.test(line)) {
      changeLog.push({ type: 'Xóa phần thừa', before: line, after: '(Đã loại bỏ)' });
    } else {
      cleanedLines.push(line);
    }
  }

  let cleanBody = cleanedLines.join('\n');
  if (redoNote) {
    cleanBody += `\n[Ghi chú NVKD yêu cầu làm lại]: ${redoNote}`;
    changeLog.push({ type: 'Áp dụng ghi chú NVKD', before: '(Bản cũ)', after: redoNote });
  }

  // 2. Normalize units & money phrases
  const unitMap = [
    [/\bcon\b/gi, 'Chiếc'],
    [/\bcái\b/gi, 'Chiếc'],
    [/\bbộ\b/gi, 'Bộ']
  ];
  let normalizedText = cleanBody;
  for (const [re, rep] of unitMap) {
    if (re.test(normalizedText)) {
      changeLog.push({ type: 'Chuẩn hóa đơn vị', before: re.source.replace(/\\b/g, ''), after: rep });
      normalizedText = normalizedText.replace(re, rep);
    }
  }

  // Extract Company
  let company = '';
  const compMatch = original.match(/(?:công ty|cty|tập đoàn|đơn vị|doanh nghiệp)\s+([^\n,.;(]+)/i);
  if (compMatch) {
    company = compMatch[0].trim();
  } else {
    flags.push({ level: 'RED', code: 'MISSING_COMPANY', msg: 'Chưa xác định rõ tên Công ty/Đơn vị mua hàng.' });
  }

  // Extract Contact
  let contact = '';
  const emailMatch = original.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const nameMatch = original.match(/(?:anh|chị|ông|bà|mr\.?|ms\.?)\s+[A-ZÀ-Ỹ][a-zà-ỹ]+(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]+)?/i);
  contact = [nameMatch ? nameMatch[0].trim() : '', emailMatch ? emailMatch[0] : ''].filter(Boolean).join(' • ');
  if (!contact) {
    flags.push({ level: 'YELLOW', code: 'MISSING_CONTACT', msg: 'Thiếu tên người liên hệ hoặc email phản hồi.' });
  }

  // Extract Products & Quantities (also apply redoNote override if NVKD corrected a number!)
  const products = [];
  const itemRe = /(\d+)\s*(?:chiếc|cái|con|bộ|máy|license|gói|năm|bản)?\s+([A-Za-zÀ-ỹ0-9][^\n,.;]{3,65})/gi;
  let m;
  while ((m = itemRe.exec(original)) !== null) {
    const qty = parseInt(m[1], 10);
    const itemName = m[2].trim();
    if (/triệu|tỷ|vnd|đồng|ngày|tuần|tháng|%/i.test(itemName)) continue;
    if (qty > 0 && qty < 10000) {
      products.push({ name: itemName, qty });
      evidenceQuotes.push(m[0].trim());
    }
  }

  // Check if redoNote specifies a quantity override like "SL switch là 45"
  if (redoNote) {
    const redoQty = redoNote.match(/(\d+)/);
    if (redoQty && products.length > 0) {
      const newQ = parseInt(redoQty[1], 10);
      products[0].qty = newQ;
      changeLog.push({ type: 'Cập nhật SL theo NVKD', before: 'SL cũ', after: `${products[0].name}: ${newQ}` });
    }
  }

  if (products.length === 0) {
    flags.push({ level: 'RED', code: 'MISSING_ITEMS', msg: 'Không trích xuất được danh sách sản phẩm và số lượng cụ thể.' });
  }

  // Extract Budget
  let budgetVND = null;
  let budgetDisplay = '';
  const tyMatch = original.match(/(\d+(?:[.,]\d+)?)\s*tỷ/i);
  const trMatch = original.match(/(\d+(?:[.,]\d+)?)\s*(?:triệu|tr\b)/i);
  if (tyMatch) {
    budgetVND = Math.round(parseFloat(tyMatch[1].replace(',', '.')) * 1_000_000_000);
    budgetDisplay = formatVND(budgetVND);
    changeLog.push({ type: 'Chuẩn hóa tiền tệ', before: tyMatch[0], after: budgetDisplay });
    evidenceQuotes.push(tyMatch[0]);
  } else if (trMatch) {
    budgetVND = Math.round(parseFloat(trMatch[1].replace(',', '.')) * 1_000_000);
    budgetDisplay = formatVND(budgetVND);
    changeLog.push({ type: 'Chuẩn hóa tiền tệ', before: trMatch[0], after: budgetDisplay });
    evidenceQuotes.push(trMatch[0]);
  } else {
    flags.push({ level: 'YELLOW', code: 'MISSING_BUDGET', msg: 'Thiếu ngân sách dự kiến — AI không tự đoán, gắn cờ để NVKD bổ sung.' });
  }

  // Extract Deadline
  let deadlineDays = null;
  let deadlineDisplay = '';
  const dayMatch = original.match(/(?:trong|giao\s+trong|hạn|deadline|trước)\s*(\d+)\s*ngày/i);
  const dateMatch = original.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (dayMatch) {
    deadlineDays = parseInt(dayMatch[1], 10);
    const dt = new Date(Date.now() + deadlineDays * 86400000);
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const yyyy = dt.getFullYear();
    deadlineDisplay = `${dd}/${mm}/${yyyy} (${deadlineDays} ngày)`;
    changeLog.push({ type: 'Chuẩn hóa ngày', before: dayMatch[0], after: deadlineDisplay });
    evidenceQuotes.push(dayMatch[0]);
  } else if (dateMatch) {
    const dd = dateMatch[1].padStart(2, '0');
    const mm = dateMatch[2].padStart(2, '0');
    const yyyy = dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3];
    deadlineDisplay = `${dd}/${mm}/${yyyy}`;
    deadlineDays = 7;
  } else {
    flags.push({ level: 'YELLOW', code: 'MISSING_DEADLINE', msg: 'Chưa rõ thời hạn giao hàng (Deadline) — gắn cờ cần NVKD bổ sung.' });
  }

  // Extract Requested Discount
  let requestedDiscountPct = 0;
  const ckMatch = original.match(/(?:chiết khấu|ck|giảm)\s*(\d+(?:[.,]\d+)?)\s*%/i);
  if (ckMatch) {
    requestedDiscountPct = parseFloat(ckMatch[1].replace(',', '.'));
    evidenceQuotes.push(ckMatch[0]);
  }

  // Check Urgent Keywords
  const normOrig = normalizeStr(original);
  const matchedUrgent = (adminConfig.urgentKeywords || []).filter((kw) => normOrig.includes(normalizeStr(kw)));
  const isUrgent = matchedUrgent.length > 0 || (deadlineDays !== null && deadlineDays <= 4);

  return {
    cleanedFields: {
      company: company || 'Chưa rõ tên công ty',
      contact: contact || 'Chưa rõ người liên hệ',
      products,
      budgetVND,
      budgetDisplay: budgetDisplay || 'Chưa cung cấp',
      deadlineDays,
      deadlineDisplay: deadlineDisplay || 'Chưa cung cấp',
      requestedDiscountPct,
      notes: isUrgent ? `Phát hiện từ khóa nguy cấp: ${matchedUrgent.join(', ') || 'Hạn giao gấp'}` : 'Không có ghi chú đặc biệt'
    },
    normalizedText,
    flags,
    changeLog,
    evidenceQuotes,
    isUrgentEarly: isUrgent
  };
}

// =========================================================================
// TẠO HỒ SƠ MỚI TẠI B1.1 → CHẠY B1.2
// =========================================================================
export function createInitialDossier(reqObj, context, adminConfig, notifications = []) {
  const b12 = runB12Cleaning(reqObj.rawText || '', adminConfig);
  const oppId = reqObj.id || `OPP-${Math.floor(1000 + Math.random() * 9000)}`;

  const dossier = {
    opportunityId: oppId,
    channel: reqObj.channel || 'Thư điện tử / Biểu mẫu',
    createdAt: new Date().toISOString(),
    version: 1,
    versionHistory: [],
    currentStep: 'B1.3',
    dashboardStatus: 'Chờ NVKD duyệt bản làm sạch',
    rawTextOriginal: reqObj.rawText || '',
    assignedNvkd: context.salesTeam?.[0]?.name || 'Nguyễn Văn A',
    isVip: (b12.cleanedFields.budgetVND || 0) >= adminConfig.vipThresholdVND,
    isUrgent: b12.isUrgentEarly,
    slaDeadlineLabel: b12.isUrgentEarly ? `${adminConfig.slaCleanMinutes} phút (Nguy cấp)` : '4 giờ làm việc',
    rollbackBanner: null,
    stepStatus: {
      'B1.1': 'DONE',
      'B1.2': 'DONE',
      'B1.3': 'ACTIVE',
      'B1.4': 'LOCKED',
      'B2': 'LOCKED',
      'B3': 'LOCKED',
      'B4': 'LOCKED',
      'B5': 'LOCKED',
      'B6': 'LOCKED',
      'B7': 'LOCKED',
      'B8': 'LOCKED',
      'B9': 'LOCKED'
    },
    b12,
    b13ApprovedFields: null,
    b14Json: null,
    b2Audit: null,
    b3Warehouse: { resolutions: {}, note: '', confirmedByKho: false },
    b4Discount: null,
    b5Escalation: { rounds: 0, maxRounds: adminConfig.maxRejectRounds, history: [], decision: null },
    b6Deliverables: null,
    b7Review: { editedEmail: '', rewriteNote: '', approved: false },
    b8Director: { decision: null, note: '' },
    b9Send: { sent: false, sentAt: null, outcome: 'Chưa phản hồi', followUpDays: adminConfig.followUpDays },
    auditLog: []
  };

  addAuditLog(dossier, 'AI', 'Intake Agent (B1.2)', 'B1.2', 'Làm sạch dữ liệu', `Trích xuất ${b12.cleanedFields.products.length} sản phẩm, ${b12.flags.length} cờ nghi vấn.`, b12.flags.some((f) => f.level === 'RED') ? 'warning' : 'success');

  if (dossier.isUrgent) {
    pushNotification(notifications, {
      event: 'Hồ sơ Nguy cấp (từ B1.2)',
      recipient: 'Trưởng phòng KD',
      oppId: dossier.opportunityId,
      company: b12.cleanedFields.company,
      message: `Hồ sơ Nguy cấp mới (${b12.cleanedFields.company}) cần NVKD duyệt bản sạch trong ${adminConfig.slaCleanMinutes} phút.`,
      level: 'alert'
    });
  }

  return dossier;
}

export function redoB12CleanData(dossier, note, adminConfig, actorName, notifications) {
  dossier.version += 1;
  dossier.versionHistory.push({
    version: `v${dossier.version - 1}`,
    at: nowTimeStr(),
    step: 'B1.2',
    summary: `Làm lại bản sạch theo ghi chú: ${note}`
  });
  dossier.b12 = runB12Cleaning(dossier.rawTextOriginal, adminConfig, note);
  dossier.currentStep = 'B1.3';
  dossier.stepStatus['B1.3'] = 'ACTIVE';
  dossier.dashboardStatus = 'Chờ NVKD duyệt bản làm sạch';
  addAuditLog(dossier, 'NVKD', actorName, 'B1.2', 'Yêu cầu AI làm lại', note, 'warning');
  return dossier;
}

// =========================================================================
// B1.3 → B1.4: DUYỆT BẢN SẠCH & TRÍCH XUẤT JSON + GẮN THẺ VIP/NGUY CẤP
// =========================================================================
export function approveB13CleanData(dossier, editedFields, adminConfig, actorName, notifications) {
  const fields = editedFields || dossier.b12.cleanedFields;
  // Re-check RED flags if fields were edited
  const hasCompany = Boolean(fields.company && !fields.company.includes('Chưa rõ'));
  const hasProducts = Array.isArray(fields.products) && fields.products.length > 0;
  if (!hasCompany || !hasProducts) {
    throw new Error('Còn cờ Đỏ (thiếu tên công ty hoặc sản phẩm). Vui lòng sửa trực tiếp hoặc yêu cầu AI làm lại trước khi Duyệt.');
  }

  dossier.b12.flags = dossier.b12.flags.filter((f) => f.level !== 'RED');
  dossier.b13ApprovedFields = JSON.parse(JSON.stringify(fields));
  dossier.stepStatus['B1.3'] = 'DONE';
  dossier.stepStatus['B1.4'] = 'ACTIVE';
  dossier.currentStep = 'B1.4';
  dossier.dashboardStatus = 'Chờ NVKD xác nhận JSON';

  // Run B1.4 Intake Agent JSON Extraction
  const budgetVND = fields.budgetVND || null;
  const isVip = (budgetVND || 0) >= adminConfig.vipThresholdVND;
  const normRaw = normalizeStr(dossier.rawTextOriginal);
  const isUrgent = (adminConfig.urgentKeywords || []).some((kw) => normRaw.includes(normalizeStr(kw)))
    || (fields.deadlineDays !== null && fields.deadlineDays <= 4);

  dossier.isVip = isVip;
  dossier.isUrgent = isUrgent;

  const missingFlags = [];
  if (!budgetVND) missingFlags.push('Thiếu ngân sách — Cần NVKD bổ sung');
  if (!fields.deadlineDays) missingFlags.push('Thiếu deadline — Cần NVKD bổ sung');

  // Infer business model
  const totalQty = (fields.products || []).reduce((s, p) => s + (p.qty || 0), 0);
  const businessModel = totalQty >= 30 ? 'Nhà thầu / Dự án Triển khai Hạ tầng' : 'Doanh nghiệp B2B Mua sắm Nội bộ';

  dossier.b14Json = {
    opportunity_id: dossier.opportunityId,
    company_name: fields.company,
    business_model: businessModel,
    customer_tier: isVip ? 'VIP' : 'Thường',
    products_requested: fields.products,
    urgency_level: isUrgent ? 'Nguy cấp' : 'Bình thường',
    deadline: fields.deadlineDisplay,
    deadline_days: fields.deadlineDays,
    budget_vnd: budgetVND,
    requested_discount_pct: fields.requestedDiscountPct || 0,
    missing_flags: missingFlags,
    next_action: missingFlags.length > 0 ? 'Cần NVKD bổ sung trước/tại Bước 2' : 'Đối soát Kho & Giá (Bước 2)'
  };

  addAuditLog(dossier, 'AI', 'Intake Agent (B1.4)', 'B1.4', 'Trích xuất JSON', `Phân loại: ${dossier.b14Json.customer_tier} / ${dossier.b14Json.urgency_level}.`, 'success');

  if (isVip || isUrgent) {
    pushNotification(notifications, {
      event: `Hồ sơ ${isVip ? 'VIP' : ''}${isVip && isUrgent ? ' & ' : ''}${isUrgent ? 'Nguy cấp' : ''}`,
      recipient: 'Trưởng phòng KD',
      oppId: dossier.opportunityId,
      company: fields.company,
      message: `Cảnh báo ưu tiên: ${fields.company} (${formatVND(budgetVND || 0)}).`,
      level: 'alert'
    });
  }
  return dossier;
}

// =========================================================================
// B1.4 → B2: XÁC NHẬN JSON & CHẠY ĐỐI SOÁT KHO & GIÁ
// =========================================================================
export function confirmB14Json(dossier, updatedJson, context, adminConfig, actorName, notifications) {
  dossier.b14Json = { ...dossier.b14Json, ...updatedJson };
  dossier.isVip = dossier.b14Json.customer_tier === 'VIP' || (dossier.b14Json.budget_vnd || 0) >= adminConfig.vipThresholdVND;
  dossier.isUrgent = dossier.b14Json.urgency_level === 'Nguy cấp';

  // Auto-assign Senior KAM if VIP
  if (dossier.isVip && adminConfig.seniorKamList?.length > 0) {
    dossier.assignedNvkd = adminConfig.seniorKamList[0];
  }

  dossier.stepStatus['B1.4'] = 'DONE';
  dossier.stepStatus['B2'] = 'DONE';

  // Run B2 Inventory & Pricing Agent
  const products = context.products || [];
  const inventory = context.inventory || [];
  const deadlineDays = dossier.b14Json.deadline_days || 7;

  const rows = (dossier.b14Json.products_requested || []).map((reqItem, idx) => {
    const reqNorm = normalizeStr(reqItem.name);
    const scored = products.map((p) => {
      const pNorm = normalizeStr(p.name);
      const skuNorm = normalizeStr(p.sku);
      let score = 0;
      if (pNorm === reqNorm || skuNorm === reqNorm) score = 100;
      else if (pNorm.includes(reqNorm) || reqNorm.includes(pNorm)) score = 85;
      else {
        const words = reqNorm.split(/\s+/).filter((w) => w.length >= 2);
        const hits = words.filter((w) => pNorm.includes(w) || skuNorm.includes(w)).length;
        score = words.length ? Math.round((hits / words.length) * 75) : 0;
      }
      return { product: p, score };
    }).sort((a, b) => b.score - a.score);

    const best = scored[0];
    const suggestions = scored.filter((s) => s.score >= 30).slice(0, 3).map((s) => s.product);

    if (!best || best.score < 35) {
      return {
        lineId: `L-${idx + 1}`,
        sku: 'CHƯA KHỚP',
        name: reqItem.name,
        requestedQty: reqItem.qty,
        availableQty: 0,
        unitPrice: 0,
        lineTotal: 0,
        leadTimeDays: null,
        deadlineDays,
        color: 'RED',
        aiNote: 'Không tìm thấy SKU hoặc giá trong bảng chuẩn.',
        suggestions
      };
    }

    const matched = best.product;
    const inv = inventory.find((i) => i.sku === matched.sku) || { availableQty: 0, leadTimeDays: 7 };
    const available = Math.max(0, inv.availableQty || 0);
    const lead = inv.leadTimeDays ?? 5;
    const lineTotal = matched.unitPrice * reqItem.qty;

    let color = 'GREEN';
    const notes = [];
    if (best.score < 70) {
      color = 'YELLOW';
      notes.push(`Độ tin cậy khớp SKU trung bình (${best.score}%), kiểm tra lại mã gợi ý.`);
    }
    if (available === 0 || available < reqItem.qty) {
      color = 'RED';
      notes.push(`Thiếu tồn kho (Cần ${reqItem.qty}, Khả dụng ${available}).`);
    }
    if (lead > deadlineDays) {
      color = 'RED';
      notes.push(`Lead-time (${lead} ngày) vượt deadline (${deadlineDays} ngày).`);
    } else if (deadlineDays - lead < 2 && color === 'GREEN') {
      color = 'YELLOW';
      notes.push(`Lead-time (${lead} ngày) sát deadline (${deadlineDays} ngày, chênh < 2 ngày).`);
    }

    return {
      lineId: `L-${idx + 1}`,
      sku: matched.sku,
      name: matched.name,
      requestedQty: reqItem.qty,
      availableQty: available,
      unitPrice: matched.unitPrice,
      lineTotal,
      leadTimeDays: lead,
      deadlineDays,
      color,
      aiNote: notes.length ? notes.join(' ') : 'Đủ hàng, kịp tiến độ, giá khớp.',
      suggestions
    };
  });

  const hasYellowOrRed = rows.some((r) => r.color === 'YELLOW' || r.color === 'RED');
  const subtotalVND = rows.reduce((s, r) => s + r.lineTotal, 0);

  dossier.b2Audit = {
    priceListVersion: adminConfig.priceListVersion,
    rows,
    subtotalVND,
    hasYellowOrRed
  };

  dossier.stepStatus['B3'] = 'ACTIVE';
  dossier.currentStep = 'B3';
  dossier.dashboardStatus = hasYellowOrRed ? 'Chờ Kho' : 'Chờ NVKD xác nhận Kho/Giá';

  addAuditLog(dossier, 'AI', 'Inventory & Pricing Agent (B2)', 'B2', 'Đối soát Kho & Giá', `Bảng giá ${adminConfig.priceListVersion}. Kết quả: ${rows.filter((r) => r.color === 'GREEN').length} Xanh, ${rows.filter((r) => r.color === 'YELLOW').length} Vàng, ${rows.filter((r) => r.color === 'RED').length} Đỏ.`, hasYellowOrRed ? 'warning' : 'success');

  if (hasYellowOrRed) {
    pushNotification(notifications, {
      event: 'Có cảnh báo Kho/Tiến độ (Vàng/Đỏ)',
      recipient: 'Nhân viên Kho',
      oppId: dossier.opportunityId,
      company: dossier.b14Json.company_name,
      message: `Cần Kho xử lý phương án giao hàng / SKU thay thế cho ${dossier.b14Json.company_name}.`,
      level: 'warning'
    });
  }
  return dossier;
}

// =========================================================================
// B3: KIỂM DUYỆT KHO & GIÁ
// =========================================================================
export function confirmB3AllGreen(dossier, adminConfig, actorName) {
  if (dossier.b2Audit?.hasYellowOrRed) {
    throw new Error('Còn dòng Vàng/Đỏ chưa được Kho chốt phương án.');
  }
  dossier.stepStatus['B3'] = 'DONE';
  dossier.stepStatus['B4'] = 'ACTIVE';
  dossier.currentStep = 'B4';
  dossier.dashboardStatus = 'Chờ NVKD quyết định chiết khấu';
  computeB4Discount(dossier, null, adminConfig);
  addAuditLog(dossier, 'NVKD', actorName, 'B3', 'Xác nhận Kho & Giá', 'Toàn bộ dòng hàng Xanh, chuyển sang Bước 4.', 'success');
  return dossier;
}

export function applyB3WarehouseResolution(dossier, lineResolutions, context, adminConfig, actorName, notifications) {
  // lineResolutions: { [lineId]: { action: 'PARTIAL'|'SUBSTITUTE'|'REJECT', shipNow, shipLater, wave2Date, altSku, reason } }
  const rows = dossier.b2Audit.rows;
  let allRejected = true;

  for (const row of rows) {
    const res = lineResolutions[row.lineId];
    if (!res) {
      if (row.color !== 'GREEN') allRejected = false;
      continue;
    }
    if (res.action !== 'REJECT') allRejected = false;

    if (res.action === 'PARTIAL') {
      row.warehousePlan = `Giao ngay ${res.shipNow || 0}, giao sau ${res.shipLater || 0} (đợt 2: ${res.wave2Date || 'sau 14 ngày'})`;
      row.color = 'GREEN';
      row.aiNote = `Kho chốt giao từng phần: ${row.warehousePlan}`;
    } else if (res.action === 'SUBSTITUTE') {
      const alt = (context.products || []).find((p) => p.sku === res.altSku);
      if (alt) {
        const diffNote = alt.unitPrice !== row.unitPrice ? ` (Chú ý: Đơn giá đổi từ ${formatVND(row.unitPrice)} → ${formatVND(alt.unitPrice)})` : '';
        row.sku = alt.sku;
        row.name = alt.name;
        row.unitPrice = alt.unitPrice;
        row.lineTotal = alt.unitPrice * row.requestedQty;
        row.color = 'GREEN';
        row.warehousePlan = `Đổi sang SKU ${alt.sku}${diffNote}`;
        row.aiNote = row.warehousePlan;
      }
    } else if (res.action === 'REJECT') {
      if (!res.reason) throw new Error(`Bắt buộc nhập lý do khi từ chối dòng ${row.sku}.`);
      row.color = 'REJECTED';
      row.lineTotal = 0;
      row.warehousePlan = `Từ chối: ${res.reason}`;
      row.aiNote = row.warehousePlan;
    }
  }

  if (allRejected) {
    dossier.dashboardStatus = 'Đã hủy';
    dossier.stepStatus['B3'] = 'CANCELLED';
    addAuditLog(dossier, 'KHO', actorName, 'B3', 'Từ chối toàn bộ đơn', 'Hồ sơ chuyển trạng thái Đã hủy.', 'alert');
    return dossier;
  }

  dossier.b2Audit.subtotalVND = rows.reduce((s, r) => s + (r.lineTotal || 0), 0);
  dossier.b2Audit.hasYellowOrRed = rows.some((r) => r.color === 'YELLOW' || r.color === 'RED');
  dossier.b3Warehouse.confirmedByKho = true;
  dossier.dashboardStatus = 'Chờ NVKD xác nhận Kho/Giá';

  addAuditLog(dossier, 'KHO', actorName, 'B3', 'Cập nhật phương án Kho', 'Đã chốt phương án và tính lại tổng giá trị.', 'success');
  pushNotification(notifications, {
    event: 'Kho đã cập nhật phương án',
    recipient: 'NVKD',
    oppId: dossier.opportunityId,
    company: dossier.b14Json.company_name,
    message: `Nhân viên Kho đã cập nhật phương án giao hàng cho ${dossier.b14Json.company_name}.`,
    level: 'info'
  });
  return dossier;
}

export function confirmB3AfterWarehouse(dossier, adminConfig, actorName) {
  if (dossier.b2Audit.rows.some((r) => r.color === 'RED')) {
    throw new Error('Vẫn còn dòng Đỏ chưa có phương án xử lý từ Kho. Không thể sang Bước 4.');
  }
  dossier.stepStatus['B3'] = 'DONE';
  dossier.stepStatus['B4'] = 'ACTIVE';
  dossier.currentStep = 'B4';
  dossier.dashboardStatus = 'Chờ NVKD quyết định chiết khấu';
  computeB4Discount(dossier, null, adminConfig);
  addAuditLog(dossier, 'NVKD', actorName, 'B3', 'Xác nhận phương án Kho', 'Chuyển sang Bước 4: Thẩm định chiết khấu.', 'success');
  return dossier;
}

// =========================================================================
// B4: THẨM ĐỊNH CHIẾT KHẤU (2 Bảng + 3 Tầng Hạn mức)
// =========================================================================
export function computeB4Discount(dossier, lineRequestedPricesMap, adminConfig) {
  const rows = (dossier.b2Audit?.rows || []).filter((r) => r.color !== 'REJECTED');
  const defaultReqPct = dossier.b14Json?.requested_discount_pct || 0;
  const nvkdLimit = adminConfig.nvkdDiscountLimitPct;
  const hardLimit = adminConfig.hardDiscountLimitPct;

  const productTable = rows.map((r) => {
    const basePrice = r.unitPrice || 0;
    const reqPrice = lineRequestedPricesMap?.[r.lineId] !== undefined
      ? Number(lineRequestedPricesMap[r.lineId])
      : Math.round(basePrice * (1 - defaultReqPct / 100));
    const pct = basePrice > 0 ? Math.round(((basePrice - reqPrice) / basePrice) * 10000) / 100 : 0;

    let rating = 'An toàn';
    if (pct > nvkdLimit) rating = 'Vượt hạn mức';
    else if (pct >= nvkdLimit - 1.5) rating = 'Sát hạn mức';

    return {
      lineId: r.lineId,
      sku: r.sku,
      name: r.name,
      qty: r.requestedQty,
      basePrice,
      requestedPrice: reqPrice,
      discountPct: pct,
      rating,
      lineBefore: basePrice * r.requestedQty,
      lineAfter: reqPrice * r.requestedQty
    };
  });

  const totalBefore = productTable.reduce((s, p) => s + p.lineBefore, 0);
  const totalAfter = productTable.reduce((s, p) => s + p.lineAfter, 0);
  const totalDiscountVND = Math.max(0, totalBefore - totalAfter);
  const overallPct = totalBefore > 0 ? Math.round((totalDiscountVND / totalBefore) * 10000) / 100 : 0;

  let tier = 'PASS_OK'; // <= nvkdLimit
  let warningText = `Trong hạn mức NVKD (${nvkdLimit}%)`;
  if (overallPct > hardLimit) {
    tier = 'OVER_HARD_LIMIT';
    warningText = `Vượt quy định cứng (${hardLimit}%) — Cần BGĐ xin ngoại lệ`;
  } else if (overallPct > nvkdLimit) {
    tier = 'OVER_NVKD_LIMIT';
    warningText = `Vượt hạn mức NVKD ${Math.round((overallPct - nvkdLimit) * 100) / 100}% — Cần Trưởng phòng duyệt`;
  }

  const prevHistory = dossier.b4Discount?.editHistory || [];
  dossier.b4Discount = {
    productTable,
    summary: {
      totalBefore,
      totalAfter,
      totalDiscountVND,
      overallPct,
      nvkdLimit,
      hardLimit,
      tier,
      warningText
    },
    editHistory: prevHistory
  };
  return dossier.b4Discount;
}

export function passB4ToB6(dossier, adminConfig, actorName) {
  if (dossier.b4Discount.summary.tier !== 'PASS_OK') {
    throw new Error('Chiết khấu vượt hạn mức NVKD. Không thể bấm Pass — hãy Chỉnh sửa hoặc Escalate.');
  }
  dossier.stepStatus['B4'] = 'DONE';
  dossier.stepStatus['B5'] = 'SKIPPED';
  dossier.stepStatus['B6'] = 'ACTIVE';
  dossier.currentStep = 'B6';
  runB6Generate(dossier, adminConfig, actorName);
  addAuditLog(dossier, 'NVKD', actorName, 'B4', 'Pass Chiết khấu', `Tỷ lệ CK ${dossier.b4Discount.summary.overallPct}% đạt chuẩn.`, 'success');
  return dossier;
}

export function escalateB4ToB5(dossier, reason, adminConfig, actorName, notifications) {
  if (!String(reason || '').trim()) {
    throw new Error('Bắt buộc nhập lý do khi gửi duyệt vượt thẩm quyền (Escalate).');
  }
  const tier = dossier.b4Discount.summary.tier;
  const requiredRole = tier === 'OVER_HARD_LIMIT' ? 'Ban Giám đốc (BGĐ)' : 'Trưởng phòng KD';
  dossier.stepStatus['B4'] = 'DONE';
  dossier.stepStatus['B5'] = 'ACTIVE';
  dossier.currentStep = 'B5';
  dossier.dashboardStatus = 'Chờ Quản lý duyệt';
  dossier.b5Escalation.reason = reason.trim();
  dossier.b5Escalation.requiredRole = requiredRole;

  addAuditLog(dossier, 'NVKD', actorName, 'B4', 'Escalate xin duyệt', `Chuyển ${requiredRole}. Lý do: ${reason}`, 'warning');
  pushNotification(notifications, {
    event: 'Yêu cầu duyệt Chiết khấu (Escalate)',
    recipient: requiredRole,
    oppId: dossier.opportunityId,
    company: dossier.b14Json.company_name,
    message: `${dossier.b14Json.company_name} xin CK ${dossier.b4Discount.summary.overallPct}% — Lý do: ${reason}`,
    level: 'alert'
  });
  return dossier;
}

// =========================================================================
// B5: PHÊ DUYỆT NGOẠI LỆ (Trưởng phòng / BGĐ)
// =========================================================================
export function applyB5Decision(dossier, decision, { maxPct, reason }, adminConfig, actorName, actorRole, notifications) {
  // Self-approval guard
  if (normalizeStr(actorName) === normalizeStr(dossier.assignedNvkd)) {
    throw new Error('Nguyên tắc Zero-Trust: Người duyệt không được phép tự duyệt hồ sơ do chính mình làm NVKD.');
  }

  dossier.b5Escalation.history.push({
    round: dossier.b5Escalation.rounds + 1,
    time: nowTimeStr(),
    approver: `${actorName} (${actorRole})`,
    decision,
    maxPct: maxPct || null,
    reason: reason || ''
  });

  if (decision === 'APPROVE') {
    dossier.b5Escalation.decision = 'APPROVE';
    dossier.stepStatus['B5'] = 'DONE';
    dossier.stepStatus['B6'] = 'ACTIVE';
    dossier.currentStep = 'B6';
    runB6Generate(dossier, adminConfig, actorName);
    addAuditLog(dossier, actorRole, actorName, 'B5', 'Phê duyệt Ngoại lệ', `Đã duyệt mức CK ${dossier.b4Discount.summary.overallPct}%.`, 'success');
  } else if (decision === 'CONDITIONAL') {
    const cap = Number(maxPct);
    if (!cap || cap <= 0) throw new Error('Vui lòng nhập mức chiết khấu tối đa cho phép.');
    // Auto-adjust lines to conditional cap
    const map = {};
    for (const p of dossier.b4Discount.productTable) {
      map[p.lineId] = Math.round(p.basePrice * (1 - cap / 100));
    }
    computeB4Discount(dossier, map, adminConfig);
    dossier.b5Escalation.decision = 'CONDITIONAL';
    dossier.stepStatus['B5'] = 'DONE';
    dossier.stepStatus['B6'] = 'ACTIVE';
    dossier.currentStep = 'B6';
    runB6Generate(dossier, adminConfig, actorName);
    addAuditLog(dossier, actorRole, actorName, 'B5', 'Duyệt có điều kiện', `Khống chế mức tối đa ${cap}%, đã tính lại bảng giá & sang Bước 6.`, 'warning');
  } else if (decision === 'REJECT') {
    if (!String(reason || '').trim()) throw new Error('Bắt buộc ghi lý do khi từ chối ngoại lệ.');
    dossier.b5Escalation.rounds += 1;
    dossier.b5Escalation.decision = 'REJECT';
    dossier.rollbackBanner = {
      by: actorName,
      targetStep: 'B4',
      reason: `Quản lý từ chối (Vòng ${dossier.b5Escalation.rounds}/${adminConfig.maxRejectRounds}): ${reason}`
    };
    dossier.currentStep = 'B4';
    dossier.stepStatus['B4'] = 'ACTIVE';
    dossier.stepStatus['B5'] = 'INVALIDATED';
    dossier.dashboardStatus = 'Cần làm lại - B4';
    addAuditLog(dossier, actorRole, actorName, 'B5', 'Từ chối ngoại lệ', reason, 'alert');

    if (dossier.b5Escalation.rounds >= adminConfig.maxRejectRounds) {
      pushNotification(notifications, {
        event: 'Vượt tối đa 3 vòng từ chối',
        recipient: 'Ban Giám đốc (BGĐ)',
        oppId: dossier.opportunityId,
        company: dossier.b14Json.company_name,
        message: `Hồ sơ bị từ chối ${dossier.b5Escalation.rounds} lần — tự động báo cáo BGĐ.`,
        level: 'alert'
      });
    }
  }
  return dossier;
}

// =========================================================================
// B6: ADVISOR & DRAFTING AGENT — SINH 4 SẢN PHẨM + TỰ KIỂM TRA
// =========================================================================
export function runB6Generate(dossier, adminConfig, actorName) {
  const company = dossier.b14Json.company_name;
  const totalAfter = dossier.b4Discount.summary.totalAfter;
  const totalBefore = dossier.b4Discount.summary.totalBefore;
  const pct = dossier.b4Discount.summary.overallPct;
  const deadline = dossier.b14Json.deadline || 'Theo thỏa thuận';

  const proposals = [
    {
      title: 'Phương án 1: Tối ưu Giá & Chiết khấu',
      badge: 'Ưu tiên Giá',
      detail: `Áp dụng mức chiết khấu tổng đơn ${pct}% (Tổng thanh toán ${formatVND(totalAfter)}). Phù hợp chốt đơn nhanh theo ngân sách.`
    },
    {
      title: 'Phương án 2: Tối ưu Tiến độ Triển khai',
      badge: 'Ưu tiên Tiến độ',
      detail: `Cam kết tiến độ ${deadline} kết hợp phương án giao hàng / SKU thay thế đã được Bộ phận Kho xác nhận.`
    }
  ];

  const linesBullet = dossier.b4Discount.productTable
    .map((p) => `- ${p.sku} | ${p.name}: ${p.qty} x ${formatVND(p.requestedPrice)} = ${formatVND(p.lineAfter)}`)
    .join('\n');

  const draftEmail = `Kính gửi Quý Công ty ${company},\n\n`
    + `Công ty Minh An xin trân trọng gửi đến Quý khách báo giá chi tiết cho hồ sơ ${dossier.opportunityId}:\n\n`
    + `${linesBullet}\n\n`
    + `• Tổng giá niêm yết: ${formatVND(totalBefore)}\n`
    + `• Chiết khấu áp dụng (${pct}%): -${formatVND(dossier.b4Discount.summary.totalDiscountVND)}\n`
    + `• Tổng giá trị thanh toán: ${formatVND(totalAfter)}\n`
    + `• Thời hạn giao hàng cam kết: ${deadline}\n\n`
    + `Kính mong Quý khách xem xét và phản hồi để Minh An tiến hành các bước tiếp theo.\n\n`
    + `Trân trọng,\n${dossier.assignedNvkd}\nCông ty Công nghệ Minh An`;

  const textReport = [
    `BÁO CÁO TỔNG HỢP HỒ SƠ ${dossier.opportunityId} — ${company}`,
    `• Phiên bản hồ sơ: v${dossier.version} | Bảng giá: ${adminConfig.priceListVersion}`,
    `• Nhân viên phụ trách: ${dossier.assignedNvkd} | Phân hạng: ${dossier.b14Json.customer_tier} / ${dossier.b14Json.urgency_level}`,
    `• Vấn đề kho & tiến độ: ${dossier.b2Audit.rows.filter((r) => r.warehousePlan).map((r) => `${r.sku}: ${r.warehousePlan}`).join('; ') || 'Không có phát sinh'}`,
    `• Thẩm định chiết khấu: ${pct}% (${dossier.b5Escalation.decision ? `Đã duyệt ngoại lệ (${dossier.b5Escalation.decision})` : 'Trong hạn mức NVKD'})`
  ].join('\n');

  // 5-sheet .xlsx payload
  const xlsxSheets = [
    {
      name: 'Thong_Tin_Khach',
      rows: [
        ['Mã cơ hội', 'Công ty', 'Mô hình KD', 'Phân hạng', 'Mức độ', 'Deadline', 'NVKD phụ trách'],
        [dossier.opportunityId, company, dossier.b14Json.business_model, dossier.b14Json.customer_tier, dossier.b14Json.urgency_level, deadline, dossier.assignedNvkd]
      ]
    },
    {
      name: 'Bang_Audit_Kho',
      rows: [
        ['SKU', 'Tên SP', 'SL', 'Tồn khả dụng', 'Đơn giá', 'Lead-time', 'Trạng thái', 'Ghi chú'],
        ...dossier.b2Audit.rows.map((r) => [r.sku, r.name, r.requestedQty, r.availableQty, r.unitPrice, r.leadTimeDays ?? '', r.color, r.aiNote])
      ]
    },
    {
      name: 'Chiet_Khau_SP',
      rows: [
        ['SKU', 'Sản phẩm', 'Giá gốc', 'Giá đề xuất', '% CK', 'Đánh giá'],
        ...dossier.b4Discount.productTable.map((p) => [p.sku, p.name, p.basePrice, p.requestedPrice, `${p.discountPct}%`, p.rating])
      ]
    },
    {
      name: 'Chiet_Khau_Tong',
      rows: [
        ['Chỉ tiêu', 'Giá trị'],
        ['Tổng trước chiết khấu', totalBefore],
        ['Tổng sau chiết khấu', totalAfter],
        ['Tổng chiết khấu', dossier.b4Discount.summary.totalDiscountVND],
        ['Tỷ lệ chiết khấu (%)', `${pct}%`],
        ['Cảnh báo', dossier.b4Discount.summary.warningText]
      ]
    },
    {
      name: 'Lich_Su_Phe_Duyet',
      rows: [
        ['Thời gian', 'Phiên bản', 'Bước', 'Vai trò', 'Người thực hiện', 'Hành động', 'Chi tiết'],
        ...dossier.auditLog.map((l) => [l.time, l.version, l.step, l.actorRole, l.actorName, l.action, l.detail])
      ]
    }
  ];

  // Auto self-check before display
  const hasPlaceholder = /\{\{[^}]+\}\}/.test(draftEmail);
  const matchesTotal = draftEmail.includes(formatVND(totalAfter));
  const matchesCompany = draftEmail.includes(company);
  const selfCheckOk = !hasPlaceholder && matchesTotal && matchesCompany;

  dossier.b6Deliverables = {
    proposals,
    draftEmail,
    textReport,
    xlsxSheets,
    selfCheckOk,
    approvedTotalSnapshot: formatVND(totalAfter)
  };
  dossier.b7Review.editedEmail = draftEmail;
  dossier.stepStatus['B6'] = 'DONE';
  dossier.stepStatus['B7'] = 'ACTIVE';
  dossier.currentStep = 'B7';
  dossier.dashboardStatus = 'Chờ NVKD duyệt email';

  addAuditLog(dossier, 'AI', 'Advisor & Drafting Agent (B6)', 'B6', 'Sinh 4 sản phẩm', `Đã kiểm tra chéo số liệu (${selfCheckOk ? 'Khớp 100%' : 'Cảnh báo lệch'}).`, selfCheckOk ? 'success' : 'alert');
  return dossier;
}

// =========================================================================
// B7: NVKD DUYỆT NỘI DUNG (Kiểm tra sửa số tay)
// =========================================================================
export function submitB7ToDirector(dossier, editedEmail, adminConfig, actorName, notifications) {
  const expectedTotalStr = dossier.b6Deliverables.approvedTotalSnapshot;
  // Tamper check: ensure approved total string wasn't modified by hand
  if (!String(editedEmail || '').includes(expectedTotalStr)) {
    // Force rollback to B4!
    rollbackToStep(dossier, 'B4', `Phát hiện chỉnh sửa số liệu thanh toán ngoài kiểm soát trong email (không khớp ${expectedTotalStr}). Hệ thống buộc quay lại Bước 4.`, actorName, 'HỆ THỐNG');
    return { rolledBack: true, dossier };
  }

  dossier.b7Review.editedEmail = editedEmail;
  dossier.b7Review.approved = true;
  dossier.stepStatus['B7'] = 'DONE';
  dossier.stepStatus['B8'] = 'ACTIVE';
  dossier.currentStep = 'B8';
  dossier.dashboardStatus = 'Chờ Giám đốc duyệt';

  addAuditLog(dossier, 'NVKD', actorName, 'B7', 'Trình Giám đốc KD', 'NVKD đã duyệt nội dung email & file .xlsx.', 'success');
  pushNotification(notifications, {
    event: 'Hồ sơ trình Giám đốc KD',
    recipient: 'Giám đốc KD',
    oppId: dossier.opportunityId,
    company: dossier.b14Json.company_name,
    message: `NVKD ${actorName} đã trình duyệt cuối hồ sơ ${dossier.b14Json.company_name}.`,
    level: 'info'
  });
  return { rolledBack: false, dossier };
}

// =========================================================================
// B8: GIÁM ĐỐC KINH DOANH DUYỆT CUỐI
// =========================================================================
export function applyB8DirectorDecision(dossier, decision, { targetStep, reason }, adminConfig, actorName, notifications) {
  if (decision === 'APPROVE') {
    dossier.b8Director = { decision: 'APPROVE', note: reason || 'Đồng ý phát hành báo giá' };
    dossier.stepStatus['B8'] = 'DONE';
    dossier.stepStatus['B9'] = 'ACTIVE';
    dossier.currentStep = 'B9';
    dossier.dashboardStatus = 'Sẵn sàng gửi';
    addAuditLog(dossier, 'GIAM_DOC', actorName, 'B8', 'Giám đốc duyệt cuối', 'Nội dung đã khóa, sẵn sàng gửi khách.', 'success');
    pushNotification(notifications, {
      event: 'Giám đốc đã duyệt cuối',
      recipient: 'NVKD',
      oppId: dossier.opportunityId,
      company: dossier.b14Json.company_name,
      message: `Hồ sơ ${dossier.b14Json.company_name} đã được duyệt — Sẵn sàng gửi khách.`,
      level: 'info'
    });
  } else {
    if (!String(reason || '').trim()) throw new Error('Bắt buộc ghi chú lý do khi trả lại hồ sơ.');
    const backTo = ['B7', 'B4', 'B3'].includes(targetStep) ? targetStep : 'B7';
    rollbackToStep(dossier, backTo, reason, actorName, 'Giám đốc KD');
    pushNotification(notifications, {
      event: 'Giám đốc trả lại hồ sơ',
      recipient: 'NVKD',
      oppId: dossier.opportunityId,
      company: dossier.b14Json.company_name,
      message: `Giám đốc trả lại bước ${backTo}: ${reason}`,
      level: 'warning'
    });
  }
  return dossier;
}

// =========================================================================
// B9: GỬI KHÁCH & ĐÓNG HỒ SƠ
// =========================================================================
export function sendB9ToCustomer(dossier, actorName) {
  if (dossier.currentStep !== 'B9') throw new Error('Hồ sơ chưa được Giám đốc KD duyệt cuối.');
  dossier.b9Send.sent = true;
  dossier.b9Send.sentAt = nowTimeStr();
  dossier.stepStatus['B9'] = 'DONE';
  dossier.dashboardStatus = 'Đã gửi';
  addAuditLog(dossier, 'NVKD', actorName, 'B9', 'Đã gửi khách hàng', `Phát hành email + .xlsx phiên bản v${dossier.version}.`, 'success');
  return dossier;
}

export function recordB9Outcome(dossier, outcome, actorName) {
  dossier.b9Send.outcome = outcome;
  addAuditLog(dossier, 'NVKD', actorName, 'B9', 'Cập nhật kết quả sau gửi', `Phản hồi khách hàng: ${outcome}`, 'info');
  return dossier;
}

// =========================================================================
// PHẦN C: CƠ CHẾ QUAY LẠI BƯỚC TRƯỚC & VÔ HIỆU HÓA DÂY CHUYỀN
// =========================================================================
export function rollbackToStep(dossier, targetStep, reason, actorName, actorRole) {
  if (!String(reason || '').trim()) {
    throw new Error('Bắt buộc nhập lý do khi trả lại bước trước.');
  }
  const idx = STEP_ORDER.indexOf(targetStep);
  if (idx < 0) throw new Error(`Bước quay lại không hợp lệ: ${targetStep}`);

  dossier.version += 1;
  dossier.versionHistory.push({
    version: `v${dossier.version - 1}`,
    at: nowTimeStr(),
    step: targetStep,
    summary: `Trả về ${targetStep} bởi ${actorName}: ${reason}`
  });

  // Chain invalidation for all steps > targetStep
  for (let i = 0; i < STEP_ORDER.length; i++) {
    const st = STEP_ORDER[i];
    if (i < idx) {
      if (dossier.stepStatus[st] === 'INVALIDATED') dossier.stepStatus[st] = 'DONE';
    } else if (i === idx) {
      dossier.stepStatus[st] = 'ACTIVE';
    } else {
      dossier.stepStatus[st] = 'INVALIDATED';
    }
  }

  dossier.currentStep = targetStep;
  dossier.dashboardStatus = `Cần làm lại - ${targetStep}`;
  dossier.rollbackBanner = {
    by: `${actorName} (${actorRole})`,
    targetStep,
    reason: reason.trim()
  };

  addAuditLog(dossier, actorRole, actorName, targetStep, `Trả lại bước ${targetStep}`, reason.trim(), 'alert');
  return dossier;
}

