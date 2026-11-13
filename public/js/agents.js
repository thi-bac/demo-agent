// agents.js - Hệ thống Multi-Agent điều phối quy trình xử lý cơ hội B2B Công ty Minh An

import { removeDiacritics, parseMoneyVND, parseNumber } from './parsers.js';

export function formatVND(amount) {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return 'Chưa rõ';
  return new Intl.NumberFormat('vi-VN').format(Math.round(amount)) + ' đ';
}

function tokenizeVN(str) {
  return removeDiacritics(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

// ============================================================================
// AGENT 1: Intake & Extractor Agent (Tiếp nhận & Trích xuất thông tin)
// ============================================================================
export const IntakeAgent = {
  id: 'agent-1-intake',
  name: 'Agent 1: Intake & Extractor',
  role: 'Tiếp nhận & bóc tách thực thể từ văn bản email / biểu mẫu / bảng',

  async run(requestObj, options = {}) {
    const start = Date.now();
    const text = String(requestObj.rawText || '');

    // Use integrated server-side API key (.env) or custom UI key when LLM mode is active
    let llmExtracted = null;
    if (options.useLLM || options.geminiApiKey) {
      try {
        llmExtracted = await callGeminiExtraction(text, options.geminiApiKey || '');
      } catch (err) {
        // Graceful fallback to deterministic NLP parser
        llmExtracted = { __error: err.message };
      }
    }

    const deterministic = parseRequestDeterministic(text, requestObj);
    const extracted = mergeExtractions(deterministic, llmExtracted);

    return {
      agentId: this.id,
      agentName: this.name,
      durationMs: Date.now() - start,
      usedLLM: Boolean(llmExtracted && !llmExtracted.__error),
      llmProvider: llmExtracted?.__provider || null,
      llmNote: llmExtracted?.__error || null,
      output: extracted
    };
  }
};

function parseRequestDeterministic(text, requestObj) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const normText = removeDiacritics(text).toLowerCase();

  // Extract email
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const contactEmail = requestObj.contact && requestObj.contact.includes('@')
    ? requestObj.contact
    : (emailMatch ? emailMatch[0] : '');

  // Extract customer / company name
  let companyName = requestObj.customerName || '';
  if (!companyName) {
    const compMatch = text.match(/(?:Công ty(?:\s+(?:CP|TNHH|Cổ phần))?|Tập đoàn|Ngân hàng|Đơn vị[:\s]+|Khách hàng[:\s]+)([^\n,().;-]{3,65})/i);
    if (compMatch) {
      companyName = compMatch[0].replace(/^(?:Đơn vị|Khách hàng)\s*:\s*/i, '').trim();
    }
  }

  let contactName = '';
  const nameMatch = text.match(/(?:Tôi là|Liên hệ[:\s]+|Ms\.|Mr\.|Anh|Chị)\s*([A-ZÀ-Ỹa-zà-ỹ][A-ZÀ-Ỹa-zà-ỹ\s]{1,30}?)(?:\s*[-–(,]|\s+-\s+|\n|$)/);
  if (nameMatch) {
    contactName = nameMatch[0].replace(/^Liên hệ\s*:\s*/i, '').replace(/[-–(,].*$/, '').trim();
  }

  // Extract Budget
  let budgetVND = requestObj.budgetHint ? parseMoneyVND(requestObj.budgetHint) : null;
  let budgetRaw = requestObj.budgetHint || '';
  if (budgetVND === null) {
    const budgetRegex = /(?:ngân sách(?:\s+(?:tổng|dự kiến|tối đa))?|kinh phí(?:\s+dự kiến)?|budget)\s*(?:khoảng|tối đa|tầm|dự kiến|:|=)?\s*([0-9.,]+\s*(?:tỷ|tỉ|triệu|tr|nghìn|ngàn|k|vnđ|vnd|đồng|đ)?)/i;
    const bMatch = text.match(budgetRegex);
    if (bMatch) {
      budgetRaw = bMatch[1].trim();
      budgetVND = parseMoneyVND(budgetRaw);
    }
  }

  // Extract Deadline (in days)
  let deadlineDays = null;
  let deadlineRaw = requestObj.deadlineHint || '';
  const deadlineSource = deadlineRaw || text;
  const dlMatch = deadlineSource.match(/(?:thời hạn(?:\s+(?:triển khai|giao hàng|hoàn thành|mong muốn|bắt buộc))?|deadline|giao(?:\s+hàng)?\s+(?:trong|trước)|trong vòng|hoàn thành(?:\s+trong)?)\s*(?:mong muốn|dự kiến|bắt buộc|:|=|trong vòng|khoảng)?\s*(\d+)\s*(ngày|tuần|tháng)/i);
  if (dlMatch) {
    const val = parseInt(dlMatch[1], 10);
    const unit = removeDiacritics(dlMatch[2]).toLowerCase();
    deadlineRaw = `${val} ${dlMatch[2]}`;
    if (unit.startsWith('tuan')) deadlineDays = val * 7;
    else if (unit.startsWith('thang')) deadlineDays = val * 30;
    else deadlineDays = val;
  } else if (requestObj.deadlineHint) {
    const numOnly = parseNumber(requestObj.deadlineHint, NaN);
    if (!Number.isNaN(numOnly) && numOnly > 0) {
      deadlineDays = numOnly;
      deadlineRaw = `${numOnly} ngày`;
    }
  }

  // Extract Discount Request (%)
  let requestedDiscountPct = 0;
  let hasExplicitDiscount = false;
  let hasVagueDiscount = false;
  let discountRaw = requestObj.discountHint || '';

  const discSource = discountRaw || text;
  const discMatch = discSource.match(/(?:chiết khấu(?:\s+(?:đặc biệt|đề xuất|đề nghị))?|giảm giá|discount)\s*(?:đặc biệt|đề xuất|đề nghị|hỗ trợ|mức|:|=)?\s*(\d+(?:[.,]\d+)?)\s*%/i);
  if (discMatch) {
    requestedDiscountPct = parseFloat(discMatch[1].replace(',', '.'));
    hasExplicitDiscount = true;
    discountRaw = `${requestedDiscountPct}%`;
  } else if (requestObj.discountHint) {
    const p = parseNumber(requestObj.discountHint, NaN);
    if (!Number.isNaN(p)) {
      requestedDiscountPct = p;
      hasExplicitDiscount = true;
      discountRaw = `${p}%`;
    }
  } else if (/giam gia|chiet khau/.test(normText)) {
    hasVagueDiscount = true;
    discountRaw = 'Có đề cập giảm giá nhưng chưa nêu % cụ thể';
  }

  // Extract Line Items (Products & Quantities)
  const items = [];
  const itemSources = requestObj.productsHint
    ? requestObj.productsHint.split(/[\n;]+/)
    : lines;

  for (const line of itemSources) {
    // Match bullet lines "- 10 Laptop Dell..." or inline "15 Laptop ... và 1 Firewall ..."
    const cleanLine = line.replace(/^[-*•+\d.)]+\s*/, (m) => {
      // Only strip bullet markers like "- " or "1. ", NOT quantities like "10 Laptop"
      return /^[-*•+]\s*/.test(m) || /^\d+[.)]\s*/.test(m) ? '' : m;
    }).trim();

    if (!cleanLine) continue;

    // Check if line looks like an item specification
    const itemLineMatch = cleanLine.match(/^(\d+)\s+(?:cái|bộ|máy|gói|chiếc|năm|license|server|switch|laptop)?\s*(.+)$/i);
    if (itemLineMatch && !/^(ngày|tuần|tháng|triệu|tỷ|%|ngân sách|thời hạn|chiết khấu)/i.test(itemLineMatch[2])) {
      let qty = parseInt(itemLineMatch[1], 10);
      let prodText = itemLineMatch[2].trim();

      // Detect stale/quoted old price in parentheses or text: e.g. "(theo báo giá năm ngoái... 21 triệu/máy)"
      let quotedOldPrice = null;
      const oldPriceMatch = prodText.match(/\(([^)]*(?:giá|năm ngoái|báo giá cũ|đơn giá)[^)]*)\)/i);
      if (oldPriceMatch) {
        const moneyInNote = oldPriceMatch[1].match(/(\d+(?:[.,]\d+)?\s*(?:tỷ|triệu|tr|k|vnđ|đ))/i);
        if (moneyInNote) quotedOldPrice = parseMoneyVND(moneyInNote[1]);
        prodText = prodText.replace(oldPriceMatch[0], '').trim();
      }

      if (qty > 0 && prodText.length >= 3) {
        items.push({ rawLine: cleanLine, quantity: qty, productQuery: prodText, quotedOldPrice });
        continue;
      }
    }

    // Inline pattern like "mua gấp 15 Laptop Lenovo ThinkPad T14 Gen 4 cho nhân sự mới và 1 Firewall FortiGate 100F"
    if (/mua|đặt|cần|báo giá/i.test(cleanLine) && /\d+\s+[A-ZÀ-Ỹa-zà-ỹ]/.test(cleanLine)) {
      const inlineMatches = [...cleanLine.matchAll(/(?:^|,\s*|\svà\s+)(\d+)\s+([A-ZÀ-Ỹa-zà-ỹ0-9\s/+.-]{4,55}?)(?=\s+(?:cho|để|với|theo|và\s+\d+|,|$|\.|ngân sách))/gi)];
      for (const m of inlineMatches) {
        const qty = parseInt(m[1], 10);
        const prod = m[2].trim();
        if (qty > 0 && prod.length >= 4 && !/ngày|tuần|tháng|triệu|tỷ|nhân sự|cửa hàng/i.test(prod)) {
          items.push({ rawLine: m[0].trim(), quantity: qty, productQuery: prod, quotedOldPrice: null });
        }
      }
    }
  }

  return {
    requestId: requestObj.id || `REQ-${Date.now().toString().slice(-4)}`,
    channel: requestObj.channel || 'Email/Biểu mẫu',
    companyName: companyName || 'Khách hàng chưa nêu rõ tên đơn vị',
    hasCompanyName: Boolean(companyName),
    contactName,
    contactEmail,
    items,
    budgetVND,
    budgetRaw,
    deadlineDays,
    deadlineRaw,
    requestedDiscountPct,
    hasExplicitDiscount,
    hasVagueDiscount,
    discountRaw,
    rawText: text
  };
}

function mergeExtractions(det, llm) {
  if (!llm || llm.__error) return det;
  return {
    ...det,
    companyName: llm.companyName || det.companyName,
    hasCompanyName: Boolean(llm.companyName || det.hasCompanyName),
    contactName: llm.contactName || det.contactName,
    contactEmail: llm.contactEmail || det.contactEmail,
    budgetVND: llm.budgetVND ?? det.budgetVND,
    budgetRaw: llm.budgetRaw || det.budgetRaw,
    deadlineDays: llm.deadlineDays ?? det.deadlineDays,
    deadlineRaw: llm.deadlineRaw || det.deadlineRaw,
    requestedDiscountPct: llm.requestedDiscountPct ?? det.requestedDiscountPct,
    hasExplicitDiscount: llm.requestedDiscountPct !== undefined && llm.requestedDiscountPct !== null ? true : det.hasExplicitDiscount,
    items: Array.isArray(llm.items) && llm.items.length > 0 ? llm.items : det.items
  };
}

// ============================================================================
// AGENT 2: Triage & Completeness Agent (Phân loại, Kiểm tra thông tin & Gán NVKD)
// ============================================================================
export const TriageAgent = {
  id: 'agent-2-triage',
  name: 'Agent 2: Triage & Completeness',
  role: 'Kiểm tra đủ thông tin, phân loại cơ hội & gán nhân viên phụ trách',

  run(intakeOutput, salesTeam, indexSeed = 0) {
    const start = Date.now();
    const missingFields = [];

    if (!intakeOutput.items || intakeOutput.items.length === 0) {
      missingFields.push('Danh sách sản phẩm/dịch vụ và số lượng cụ thể');
    }
    if (intakeOutput.budgetVND === null || intakeOutput.budgetVND <= 0) {
      missingFields.push('Ngân sách tổng dự kiến');
    }
    if (intakeOutput.deadlineDays === null || intakeOutput.deadlineDays <= 0) {
      missingFields.push('Thời hạn triển khai / giao hàng mong muốn');
    }
    if (!intakeOutput.contactEmail && !intakeOutput.contactName) {
      missingFields.push('Thông tin người liên hệ / email phản hồi');
    }

    const softNotes = [];
    if (intakeOutput.hasVagueDiscount) {
      softNotes.push('Khách hàng đề cập giảm giá nhưng chưa nêu tỷ lệ % chiết khấu cụ thể');
    }

    const isComplete = missingFields.length === 0;

    // Classify opportunity category & urgency
    const allQueries = intakeOutput.items.map((i) => removeDiacritics(i.productQuery).toLowerCase()).join(' ');
    let categoryFocus = 'Giải pháp Tổng thể';
    if (/may chu|server|dell poweredge|hpe|ups/.test(allQueries)) categoryFocus = 'Hạ tầng Máy chủ & Bảo mật';
    else if (/switch|wifi|unifi|aruba|cisco|mang/.test(allQueries)) categoryFocus = 'Mạng Doanh nghiệp & WiFi';
    else if (/laptop|thinkpad|latitude/.test(allQueries)) categoryFocus = 'Thiết bị Đầu cuối & Văn phòng';

    const urgency = intakeOutput.deadlineDays !== null && intakeOutput.deadlineDays <= 5
      ? 'Khẩn cấp'
      : (intakeOutput.deadlineDays !== null && intakeOutput.deadlineDays <= 12 ? 'Ưu tiên' : 'Tiêu chuẩn');

    let dealTier = 'Chưa xác định';
    if (intakeOutput.budgetVND !== null) {
      if (intakeOutput.budgetVND >= 1_000_000_000) dealTier = 'Enterprise (> 1 tỷ)';
      else if (intakeOutput.budgetVND >= 400_000_000) dealTier = 'Lớn (400tr - 1 tỷ)';
      else dealTier = 'Vừa & Nhỏ (< 400tr)';
    }

    // Assign NVKD owner based on specialty + workload balance (always assigns owner so nothing is orphaned)
    const team = salesTeam && salesTeam.length > 0 ? salesTeam : [{ id: 'NV01', name: 'Nguyễn Minh Tuấn', specialty: 'Tổng hợp', currentLoad: 0 }];
    const scoredTeam = team.map((member, idx) => {
      const specTokens = tokenizeVN(member.specialty);
      const focusTokens = tokenizeVN(categoryFocus);
      const overlap = focusTokens.filter((t) => specTokens.includes(t)).length;
      const loadPenalty = (member.currentLoad || 0) * 0.25;
      const roundRobinBias = ((idx + indexSeed) % team.length) * 0.01;
      return { member, score: overlap * 3 - loadPenalty - roundRobinBias };
    }).sort((a, b) => b.score - a.score);

    const assignedOwner = scoredTeam[0].member;
    const opportunityId = `OPP-${intakeOutput.requestId.replace(/^REQ-/, '')}`;

    return {
      agentId: this.id,
      agentName: this.name,
      durationMs: Date.now() - start,
      output: {
        opportunityId,
        isComplete,
        missingFields,
        softNotes,
        categoryFocus,
        urgency,
        dealTier,
        assignedOwner,
        workflowBranch: isComplete ? 'ĐỦ THÔNG TIN → Tạo Hồ sơ & Thẩm định' : 'THIẾU THÔNG TIN → Yêu cầu KH làm rõ / bổ sung'
      }
    };
  }
};

// ============================================================================
// AGENT 3: Inventory, Pricing & Lead-Time Auditor (Thẩm định tồn kho, giá & thời hạn)
// ============================================================================
export const InventoryPricingAgent = {
  id: 'agent-3-inventory',
  name: 'Agent 3: Inventory, Pricing & Lead-Time Auditor',
  role: 'Đối chiếu danh mục giá mới nhất, kiểm tra tồn khả dụng & thời gian triển khai',

  run(intakeOutput, products, inventory) {
    const start = Date.now();
    const invMapBySku = new Map();
    const invMapByName = new Map();

    (inventory || []).forEach((inv) => {
      if (inv.sku) invMapBySku.set(inv.sku.toUpperCase(), inv);
      if (inv.name) invMapByName.set(removeDiacritics(inv.name).toLowerCase(), inv);
    });

    const lineAudits = [];
    const riskAlerts = [];
    let subtotalVND = 0;
    let maxLeadTimeDays = 0;
    let hasUnmatchedItem = false;
    let hasStockShortfall = false;
    let hasDeadlineRisk = false;
    let hasStalePrice = false;

    for (const reqItem of intakeOutput.items || []) {
      const matched = findBestProductMatch(reqItem.productQuery, products || []);

      if (!matched || matched.score < 0.32) {
        hasUnmatchedItem = true;
        riskAlerts.push(`Không tìm thấy sản phẩm khớp trong danh mục: "${reqItem.productQuery}" (SL: ${reqItem.quantity}).`);
        lineAudits.push({
          requestedName: reqItem.productQuery,
          requestedQty: reqItem.quantity,
          matchedSku: null,
          matchedName: 'Chưa có trong danh mục Minh An',
          category: 'N/A',
          unitPrice: 0,
          lineTotal: 0,
          availableQty: 0,
          leadTimeDays: null,
          quotedOldPrice: reqItem.quotedOldPrice,
          alternativeProduct: null,
          status: 'CHƯA CÓ TRONG DANH MỤC',
          issues: ['Sản phẩm/dịch vụ ngoài danh mục chuẩn — cần NVKD/Kỹ thuật xác minh báo giá ngoài.']
        });
        continue;
      }

      const prod = matched.product;
      const inv = invMapBySku.get(prod.sku.toUpperCase())
        || invMapByName.get(removeDiacritics(prod.name).toLowerCase())
        || { availableQty: 0, leadTimeDays: 7, warehouseNote: 'Chưa có dữ liệu tồn kho' };

      const lineIssues = [];
      const lineTotal = prod.unitPrice * reqItem.quantity;
      subtotalVND += lineTotal;
      if (inv.leadTimeDays > maxLeadTimeDays) maxLeadTimeDays = inv.leadTimeDays;

      // 1. Check stale / customer quoted old price
      if (reqItem.quotedOldPrice && reqItem.quotedOldPrice !== prod.unitPrice) {
        hasStalePrice = true;
        const diff = prod.unitPrice - reqItem.quotedOldPrice;
        const msg = `KH dẫn giá cũ ${formatVND(reqItem.quotedOldPrice)}/đv, giá hiện hành là ${formatVND(prod.unitPrice)}/đv (chênh ${diff > 0 ? '+' : ''}${formatVND(diff)}).`;
        lineIssues.push(msg);
        riskAlerts.push(`${prod.sku}: ${msg}`);
      }

      // 2. Check available stock
      let alternativeProduct = null;
      if (inv.availableQty < reqItem.quantity) {
        hasStockShortfall = true;
        const shortage = reqItem.quantity - inv.availableQty;
        const msg = `Tồn khả dụng chỉ còn ${inv.availableQty}, thiếu ${shortage} ${prod.unit}.`;
        lineIssues.push(msg);
        riskAlerts.push(`${prod.sku} (${prod.name}): ${msg}`);

        // Find alternative in same category with sufficient stock
        alternativeProduct = findAlternativeProduct(prod, reqItem.quantity, products, invMapBySku);
      }

      // 3. Check deadline feasibility
      if (intakeOutput.deadlineDays !== null && inv.leadTimeDays > intakeOutput.deadlineDays) {
        hasDeadlineRisk = true;
        const msg = `Thời gian triển khai chuẩn ${inv.leadTimeDays} ngày > thời hạn KH yêu cầu (${intakeOutput.deadlineDays} ngày).`;
        lineIssues.push(msg);
        riskAlerts.push(`${prod.sku}: ${msg}`);
      }

      const status = lineIssues.length === 0 ? 'ĐẠT' : (inv.availableQty < reqItem.quantity ? 'THIẾU TỒN / RỦI RO' : 'CẢNH BÁO');

      lineAudits.push({
        requestedName: reqItem.productQuery,
        requestedQty: reqItem.quantity,
        matchedSku: prod.sku,
        matchedName: prod.name,
        category: prod.category,
        unit: prod.unit,
        unitPrice: prod.unitPrice,
        lineTotal,
        availableQty: inv.availableQty,
        leadTimeDays: inv.leadTimeDays,
        warehouseNote: inv.warehouseNote,
        quotedOldPrice: reqItem.quotedOldPrice,
        alternativeProduct,
        status,
        issues: lineIssues
      });
    }

    const discountPct = intakeOutput.requestedDiscountPct || 0;
    const discountAmountVND = Math.round(subtotalVND * (discountPct / 100));
    const finalTotalVND = subtotalVND - discountAmountVND;

    let budgetFit = 'Chưa xác định';
    let budgetDeltaVND = null;
    if (intakeOutput.budgetVND !== null && subtotalVND > 0) {
      budgetDeltaVND = intakeOutput.budgetVND - finalTotalVND;
      if (budgetDeltaVND >= 0) budgetFit = 'Trong ngân sách';
      else budgetFit = `Vượt ngân sách ${formatVND(Math.abs(budgetDeltaVND))}`;
    }

    const needsOpsCheckpoint = hasUnmatchedItem || hasStockShortfall || hasDeadlineRisk || hasStalePrice;

    return {
      agentId: this.id,
      agentName: this.name,
      durationMs: Date.now() - start,
      output: {
        lineAudits,
        subtotalVND,
        discountPct,
        discountAmountVND,
        finalTotalVND,
        maxLeadTimeDays,
        budgetFit,
        budgetDeltaVND,
        hasUnmatchedItem,
        hasStockShortfall,
        hasDeadlineRisk,
        hasStalePrice,
        needsOpsCheckpoint,
        riskAlerts
      }
    };
  }
};

function findBestProductMatch(query, products) {
  const qTokens = tokenizeVN(query);
  if (qTokens.length === 0) return null;

  let best = null;
  for (const prod of products) {
    const skuNorm = removeDiacritics(prod.sku).toLowerCase();
    const qNorm = removeDiacritics(query).toLowerCase();
    if (qNorm.includes(skuNorm)) {
      return { product: prod, score: 1.0 };
    }

    const pTokens = tokenizeVN(`${prod.name} ${prod.category}`);
    const pSet = new Set(pTokens);
    let hits = 0;
    for (const qt of qTokens) {
      if (pSet.has(qt)) {
        hits += 1;
      } else if (pTokens.some((pt) => pt.includes(qt) || qt.includes(pt))) {
        hits += 0.65;
      }
    }
    // Bonus for model numbers / key brands matching
    const modelTokens = qTokens.filter((t) => /\d/.test(t) || ['dell', 'hpe', 'cisco', 'aruba', 'fortigate', 'unifi', 'thinkpad', 'apc', 'latitude'].includes(t));
    let modelBoost = 0;
    for (const mt of modelTokens) {
      if (pTokens.some((pt) => pt.includes(mt))) modelBoost += 0.2;
    }

    const score = (hits / Math.max(qTokens.length, 1)) * 0.75 + Math.min(modelBoost, 0.45);
    if (!best || score > best.score) {
      best = { product: prod, score };
    }
  }
  return best;
}

function findAlternativeProduct(origProd, neededQty, products, invMapBySku) {
  for (const cand of products) {
    if (cand.sku === origProd.sku) continue;
    if (cand.category !== origProd.category) continue;
    const inv = invMapBySku.get(cand.sku.toUpperCase());
    if (inv && inv.availableQty >= neededQty) {
      return {
        sku: cand.sku,
        name: cand.name,
        unitPrice: cand.unitPrice,
        availableQty: inv.availableQty,
        leadTimeDays: inv.leadTimeDays
      };
    }
  }
  return null;
}

// ============================================================================
// AGENT 4: Discount & Governance Policy Agent (Thẩm định chiết khấu & Chuyển duyệt)
// ============================================================================
export const PolicyGovernanceAgent = {
  id: 'agent-4-policy',
  name: 'Agent 4: Discount & Governance Policy',
  role: 'Kiểm tra hạn mức chiết khấu, điều kiện chuyển duyệt & phát hiện sai lệch',

  run(intakeOutput, triageOutput, auditOutput, policies) {
    const start = Date.now();
    const orderVal = auditOutput.subtotalVND || intakeOutput.budgetVND || 0;
    const reqDisc = intakeOutput.requestedDiscountPct || 0;

    const sortedPolicies = [...(policies || [])].sort((a, b) => a.maxDiscountPct - b.maxDiscountPct);
    const nvkdPolicies = sortedPolicies.filter((p) => /nvkd|nhan vien/i.test(removeDiacritics(p.approverRole)));
    const mgrPolicies = sortedPolicies.filter((p) => /truong phong|manager/i.test(removeDiacritics(p.approverRole)));
    const dirPolicies = sortedPolicies.filter((p) => /giam doc|director/i.test(removeDiacritics(p.approverRole)));

    const matchingNvkdPolicy = nvkdPolicies.find((p) => orderVal >= p.minOrderValue && orderVal <= p.maxOrderValue)
      || nvkdPolicies[nvkdPolicies.length - 1]
      || { maxDiscountPct: 5, maxOrderValue: 300_000_000, approverRole: 'NVKD' };

    const matchingMgrPolicy = mgrPolicies[0] || { maxDiscountPct: 15, maxOrderValue: 1_200_000_000, approverRole: 'Trưởng phòng Kinh doanh' };
    const matchingDirPolicy = dirPolicies[0] || { maxDiscountPct: 25, maxOrderValue: 999_999_999_999, approverRole: 'Ban Giám đốc' };

    const escalationReasons = [];
    let requiredApprover = 'Nhân viên Kinh doanh (Trong thẩm quyền)';
    let needsEscalation = false;

    if (!triageOutput.isComplete) {
      requiredApprover = 'Chưa chuyển duyệt (Đang chờ KH bổ sung thông tin)';
    } else {
      if (reqDisc > matchingNvkdPolicy.maxDiscountPct) {
        needsEscalation = true;
        escalationReasons.push(`Chiết khấu đề nghị ${reqDisc}% vượt hạn mức tự duyệt của NVKD (${matchingNvkdPolicy.maxDiscountPct}%).`);
      }
      if (orderVal > matchingNvkdPolicy.maxOrderValue) {
        needsEscalation = true;
        escalationReasons.push(`Giá trị đơn hàng (${formatVND(orderVal)}) vượt ngưỡng tự duyệt của NVKD (${formatVND(matchingNvkdPolicy.maxOrderValue)}).`);
      }
      if (auditOutput.hasStockShortfall || auditOutput.hasDeadlineRisk) {
        needsEscalation = true;
        escalationReasons.push('Đơn hàng có rủi ro thiếu tồn kho hoặc thời hạn giao gấp hơn Lead-time chuẩn, cần xác nhận cam kết liên phòng ban.');
      }

      if (needsEscalation) {
        if (reqDisc > matchingMgrPolicy.maxDiscountPct || orderVal > matchingMgrPolicy.maxOrderValue) {
          requiredApprover = matchingDirPolicy.approverRole || 'Ban Giám đốc';
          if (reqDisc > matchingMgrPolicy.maxDiscountPct) {
            escalationReasons.push(`Chiết khấu ${reqDisc}% vượt trần Trưởng phòng (${matchingMgrPolicy.maxDiscountPct}%) → Chuyển thẳng Ban Giám đốc.`);
          }
        } else {
          requiredApprover = matchingMgrPolicy.approverRole || 'Trưởng phòng Kinh doanh';
        }
      }
    }

    // Error detection & audit checks
    const errorChecks = [
      {
        check: 'Đối soát danh mục & bỏ sót hạng mục',
        passed: !auditOutput.hasUnmatchedItem,
        detail: auditOutput.hasUnmatchedItem ? 'Phát hiện hạng mục ngoài danh mục chuẩn cần xác minh.' : '100% hạng mục đã khớp SKU chuẩn.'
      },
      {
        check: 'Đối soát giá hiện hành (tránh dùng giá cũ)',
        passed: !auditOutput.hasStalePrice,
        detail: auditOutput.hasStalePrice ? 'Phát hiện khách hàng trích giá cũ thấp hơn bảng giá hiện tại.' : 'Áp dụng đúng đơn giá bảng giá mới nhất.'
      },
      {
        check: 'Kiểm tra khả năng đáp ứng tồn kho & Lead-time',
        passed: !auditOutput.hasStockShortfall && !auditOutput.hasDeadlineRisk,
        detail: (auditOutput.hasStockShortfall || auditOutput.hasDeadlineRisk)
          ? 'Có cảnh báo thiếu tồn hoặc trễ tiến độ so với yêu cầu.'
          : 'Đủ tồn khả dụng và đáp ứng thời hạn triển khai.'
      },
      {
        check: 'Kiểm tra người phụ trách & thẩm quyền duyệt',
        passed: Boolean(triageOutput.assignedOwner?.name) && Boolean(requiredApprover),
        detail: `NVKD: ${triageOutput.assignedOwner?.name} | Cấp duyệt: ${requiredApprover}`
      }
    ];

    return {
      agentId: this.id,
      agentName: this.name,
      durationMs: Date.now() - start,
      output: {
        nvkdMaxDiscountPct: matchingNvkdPolicy.maxDiscountPct,
        managerMaxDiscountPct: matchingMgrPolicy.maxDiscountPct,
        needsEscalation,
        requiredApprover,
        escalationReasons,
        errorChecks
      }
    };
  }
};

// ============================================================================
// AGENT 5: Business Advisor & Response Drafter (Đề xuất kinh doanh & Soạn phản hồi KH)
// ============================================================================
export const AdvisorDraftingAgent = {
  id: 'agent-5-advisor',
  name: 'Agent 5: Business Advisor & Drafter',
  role: 'Tổng hợp đề xuất kinh doanh tối ưu & soạn bản nháp phản hồi khách hàng',

  async run(intakeOutput, triageOutput, auditOutput, policyOutput, options = {}) {
    const start = Date.now();
    const proposals = [];

    if (!triageOutput.isComplete) {
      proposals.push({
        type: 'THU THẬP THÔNG TIN',
        priority: 'Cao',
        title: 'Gửi email làm rõ thông tin còn thiếu trước khi lập báo giá',
        detail: `Yêu cầu đang thiếu: ${triageOutput.missingFields.join('; ')}. Không chuyển sang bộ phận Vận hành để tránh mất thời gian tra cứu lặp lại; tạm giữ trạng thái "Chờ KH bổ sung" dưới sự theo dõi của ${triageOutput.assignedOwner.name}.`
      });
    } else {
      // Business proposals based on findings
      if (auditOutput.hasStockShortfall) {
        const subLines = auditOutput.lineAudits.filter((l) => l.alternativeProduct);
        if (subLines.length > 0) {
          const altDesc = subLines.map((l) => `Đổi ${l.matchedName} (tồn ${l.availableQty}) sang ${l.alternativeProduct.name} (${l.alternativeProduct.sku}, tồn ${l.alternativeProduct.availableQty}, giá ${formatVND(l.alternativeProduct.unitPrice)}, giao ${l.alternativeProduct.leadTimeDays} ngày)`).join('; ');
          proposals.push({
            type: 'GIẢI PHÁP THAY THẾ & TỒN KHO',
            priority: 'Cao',
            title: 'Đề xuất phương án thay thế SKU tương đương hoặc giao hàng 2 đợt',
            detail: `${altDesc}. Phương án này giúp đảm bảo tiến độ bàn giao cho khách hàng mà không mất cơ hội.`
          });
        } else {
          proposals.push({
            type: 'ĐIỀU PHỐI KHO',
            priority: 'Cao',
            title: 'Chia 2 đợt giao hàng hoặc đặt hàng gấp với Nhà phân phối',
            detail: 'Kho hiện không đủ 100% số lượng yêu cầu. Đề xuất giao ngay phần hàng sẵn kho và cam kết lịch giao bổ sung phần còn thiếu sau khi Vận hành xác nhận.'
          });
        }
      }

      if (auditOutput.hasDeadlineRisk) {
        proposals.push({
          type: 'TIẾN ĐỘ TRIỂN KHAI',
          priority: 'Cao',
          title: `Thương lượng mốc bàn giao ${auditOutput.maxLeadTimeDays} ngày hoặc tách giai đoạn`,
          detail: `Thời hạn KH mong muốn (${intakeOutput.deadlineDays} ngày) ngắn hơn Lead-time kỹ thuật (${auditOutput.maxLeadTimeDays} ngày). Đề xuất bàn giao thiết bị sẵn kho trước và hoàn tất cấu hình/nghiêm thu phần còn lại theo lộ trình.`
        });
      }

      if (auditOutput.hasStalePrice) {
        proposals.push({
          type: 'CHUẨN HÓA GIÁ',
          priority: 'Trung bình',
          title: 'Giải trình cập nhật bảng giá hiện hành với khách hàng',
          detail: 'Khách hàng đang tham chiếu đơn giá cũ. Đề xuất giải thích rõ chênh lệch giá thị trường và bù đắp bằng gói hỗ trợ kỹ thuật hoặc chiết khấu theo bậc hợp lệ.'
        });
      }

      if (auditOutput.hasUnmatchedItem) {
        proposals.push({
          type: 'XÁC MINH HẠNG MỤC',
          priority: 'Cao',
          title: 'Bóc tách hoặc tìm nhà cung cấp đối tác cho hạng mục ngoài danh mục',
          detail: 'Có hạng mục không nằm trong danh mục chuẩn Minh An. Đề xuất báo giá riêng phần thiết bị chuẩn trước để giữ nhịp, đồng thời nhờ Presales xác nhận khả năng cung ứng phần ngoài danh mục.'
        });
      }

      if (policyOutput.needsEscalation) {
        proposals.push({
          type: 'PHÊ DUYỆT VƯỢT QUYỀN',
          priority: 'Cao',
          title: `Trình ${policyOutput.requiredApprover} phê duyệt đề xuất`,
          detail: `${policyOutput.escalationReasons.join(' ')} Có thể đề xuất phương án dự phòng: giữ mức chiết khấu ${policyOutput.nvkdMaxDiscountPct}% kèm tặng gói SLA hoặc phụ kiện để bảo vệ biên lợi nhuận.`
        });
      } else {
        proposals.push({
          type: 'CHỐT CƠ HỘI NHANH',
          priority: 'Tiêu chuẩn',
          title: 'Đủ điều kiện gửi báo giá chính thức ngay trong ngày',
          detail: `Đơn hàng đạt 100% tồn kho, tiến độ khả thi (${auditOutput.maxLeadTimeDays} ngày <= ${intakeOutput.deadlineDays} ngày) và chiết khấu ${auditOutput.discountPct}% nằm trong thẩm quyền NVKD.`
        });
      }

      if (auditOutput.budgetDeltaVND !== null && auditOutput.budgetDeltaVND < 0) {
        proposals.push({
          type: 'TỐI ƯU NGÂN SÁCH',
          priority: 'Trung bình',
          title: `Đề xuất điều chỉnh cấu hình giảm ${formatVND(Math.abs(auditOutput.budgetDeltaVND))} để khớp ngân sách`,
          detail: `Tổng sau chiết khấu (${formatVND(auditOutput.finalTotalVND)}) đang vượt ngân sách KH (${formatVND(intakeOutput.budgetVND)}). Có thể cân nhắc chuyển sang dòng sản phẩm tối ưu chi phí hơn hoặc giãn hạng mục dịch vụ sang giai đoạn 2.`
        });
      }
    }

    let draftEmail = buildDraftEmail(intakeOutput, triageOutput, auditOutput, policyOutput, proposals);
    let usedLLM = false;
    let llmNote = null;
    if (options.useLLM || options.geminiApiKey) {
      try {
        const polished = await callGeminiDrafting(intakeOutput, triageOutput, auditOutput, policyOutput, proposals, options.geminiApiKey || '');
        if (polished) {
          draftEmail = polished;
          usedLLM = true;
        }
      } catch (err) {
        llmNote = err.message;
      }
    }

    return {
      agentId: this.id,
      agentName: this.name,
      durationMs: Date.now() - start,
      usedLLM,
      llmNote,
      output: {
        proposals,
        draftEmail
      }
    };
  }
};

function buildDraftEmail(intake, triage, audit, policy, proposals) {
  const greetingName = intake.contactName || 'Quý Anh/Chị';
  const company = intake.hasCompanyName ? intake.companyName : 'Quý Công ty';
  const owner = triage.assignedOwner;

  if (!triage.isComplete) {
    const missingBullets = triage.missingFields.map((m, i) => `  ${i + 1}. ${m}`).join('\n');
    const softBullets = triage.softNotes.length > 0
      ? `\nNgoài ra, để áp dụng chính sách ưu đãi phù hợp nhất, Anh/Chị vui lòng cho biết thêm về: ${triage.softNotes.join('; ')}.`
      : '';

    return `Tiêu đề: [Minh An Tech] Xác nhận tiếp nhận & làm rõ thông tin yêu cầu báo giá (${triage.opportunityId})

Kính gửi ${greetingName} - ${company},

Công ty Công nghệ Minh An chân thành cảm ơn Quý Công ty đã gửi yêu cầu tư vấn và báo giá đến chúng tôi.
Hồ sơ cơ hội của Quý Công ty đã được tiếp nhận với mã theo dõi ${triage.opportunityId}, do chuyên viên ${owner.name} trực tiếp phụ trách hỗ trợ.

Để đội ngũ kỹ thuật và kinh doanh có thể lập phương án báo giá chính xác, đúng tiến độ và tối ưu ngân sách nhất, kính nhờ Anh/Chị bổ sung giúp một số thông tin sau:
${missingBullets}${softBullets}

Ngay sau khi nhận được phản hồi, chúng tôi sẽ hoàn thiện báo giá chi tiết và gửi lại Quý Công ty trong vòng 4 giờ làm việc.

Trân trọng,
${owner.name} - Chuyên viên Kinh doanh B2B
Công ty Công nghệ Minh An`;
  }

  const lineSummary = audit.lineAudits.map((l, idx) => {
    if (!l.matchedSku) {
      return `  ${idx + 1}. ${l.requestedName} (SL: ${l.requestedQty}) — *Đang xác minh nguồn cung / hạng mục ngoài danh mục*`;
    }
    return `  ${idx + 1}. ${l.matchedName} (${l.matchedSku}) | SL: ${l.requestedQty} ${l.unit} | Đơn giá: ${formatVND(l.unitPrice)} | Thành tiền: ${formatVND(l.lineTotal)}`;
  }).join('\n');

  const altProposal = proposals.find((p) => p.type === 'GIẢI PHÁP THAY THẾ & TỒN KHO' || p.type === 'TIẾN ĐỘ TRIỂN KHAI');
  const noteSection = [];
  if (audit.hasStalePrice) {
    noteSection.push('- Lưu ý về đơn giá: Bảng giá trên được áp dụng theo biểu giá niêm yết hiện hành mới nhất của Minh An (có điều chỉnh so với báo giá tham chiếu trước đây).');
  }
  if (altProposal) {
    noteSection.push(`- Đề xuất phương án tối ưu: ${altProposal.detail}`);
  }
  if (policy.needsEscalation) {
    noteSection.push(`- Trạng thái ưu đãi: Mức chiết khấu ${audit.discountPct}% đang được chuyển trình ${policy.requiredApprover} phê duyệt đặc biệt để hỗ trợ tốt nhất cho Quý Công ty.`);
  }

  return `Tiêu đề: [Minh An Tech] Đề xuất giải pháp & Báo giá sơ bộ cho ${company} (${triage.opportunityId})

Kính gửi ${greetingName} - ${company},

Cảm ơn Quý Công ty đã tin tưởng gửi yêu cầu hợp tác đến Công ty Công nghệ Minh An. Chúng tôi đã tiếp nhận (Mã hồ sơ: ${triage.opportunityId}) và hoàn tất thẩm định cấu hình, bảng giá hiện hành, tồn kho khả dụng cũng như tiến độ triển khai như sau:

1. CHI TIẾT HẠNG MỤC & BÁO GIÁ DỰ KIẾN:
${lineSummary}

- Tổng giá trị niêm yết: ${formatVND(audit.subtotalVND)}
- Chiết khấu đề xuất (${audit.discountPct}%): -${formatVND(audit.discountAmountVND)}
- Tổng thanh toán dự kiến (chưa VAT): ${formatVND(audit.finalTotalVND)}
- Thời gian triển khai tiêu chuẩn dự kiến: ${audit.maxLeadTimeDays} ngày làm việc

2. LƯU Ý & ĐỀ XUẤT KINH DOANH TỪ MINH AN:
${noteSection.length > 0 ? noteSection.join('\n') : '- Toàn bộ thiết bị hiện đang sẵn kho và đáp ứng đúng thời hạn triển khai Quý Công ty yêu cầu.'}

Kính mời Anh/Chị xem xét phương án trên. Nếu Quý Công ty cần điều chỉnh cấu hình hoặc trao đổi thêm về điều khoản thanh toán, vui lòng phản hồi trực tiếp email này để tôi hỗ trợ kịp thời.

Trân trọng,
${owner.name} - Chuyên viên Kinh doanh B2B
Công ty Công nghệ Minh An`;
}

// ============================================================================
// ORCHESTRATOR: Chạy toàn bộ quy trình Multi-Agent theo sơ đồ Workflow
// ============================================================================
function nowTimeLabel() {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

export async function runMultiAgentPipeline(requestObj, context, options = {}) {
  const trace = [];

  // Step 1: Agent 1 - Intake & Extract
  const r1 = await IntakeAgent.run(requestObj, options);
  trace.push({
    time: nowTimeLabel(),
    step: 'Bắt đầu: Tiếp nhận & Trích xuất',
    workflowNode: 'intake',
    agent: 'Tác tử Tiếp nhận',
    agentFull: r1.agentName,
    durationMs: r1.durationMs,
    usedLLM: r1.usedLLM,
    status: 'success',
    summary: `Trích xuất ${r1.output.items.length} hạng mục | Ngân sách: ${r1.output.budgetVND ? formatVND(r1.output.budgetVND) : 'Thiếu'} | Hạn: ${r1.output.deadlineDays ? r1.output.deadlineDays + ' ngày' : 'Thiếu'}${r1.usedLLM ? ' [AI]' : ''}`
  });

  // Step 2: Agent 2 - Triage & Completeness
  const r2 = TriageAgent.run(r1.output, context.salesTeam, options.indexSeed || 0);
  trace.push({
    time: nowTimeLabel(),
    step: 'Phân loại & Kiểm tra thông tin',
    workflowNode: 'triage',
    agent: 'Tác tử Phân loại',
    agentFull: r2.agentName,
    durationMs: r2.durationMs,
    usedLLM: false,
    status: r2.output.isComplete ? 'success' : 'warning',
    summary: r2.output.isComplete
      ? `Đủ thông tin → Tạo ${r2.output.opportunityId}, gán ${r2.output.assignedOwner.name}`
      : `Thiếu ${r2.output.missingFields.length} thông tin → Yêu cầu KH làm rõ`
  });

  let r3;
  let r4;

  if (!r2.output.isComplete) {
    // Incomplete branch: create empty/partial audit & skip to drafting clarification
    r3 = {
      agentId: InventoryPricingAgent.id,
      agentName: InventoryPricingAgent.name,
      durationMs: 0,
      output: {
        lineAudits: [],
        subtotalVND: 0,
        discountPct: r1.output.requestedDiscountPct || 0,
        discountAmountVND: 0,
        finalTotalVND: 0,
        maxLeadTimeDays: 0,
        budgetFit: 'Chưa xác định',
        budgetDeltaVND: null,
        hasUnmatchedItem: false,
        hasStockShortfall: false,
        hasDeadlineRisk: false,
        hasStalePrice: false,
        needsOpsCheckpoint: false,
        riskAlerts: []
      }
    };
    r4 = PolicyGovernanceAgent.run(r1.output, r2.output, r3.output, context.policies);
    trace.push({
      time: nowTimeLabel(),
      step: 'Yêu cầu KH làm rõ / bổ sung',
      workflowNode: 'clarify',
      agent: 'Cổng Kiểm tra',
      agentFull: AdvisorDraftingAgent.name,
      durationMs: 1,
      usedLLM: false,
      status: 'warning',
      summary: `Giữ trạng thái Chờ KH bổ sung (${r2.output.missingFields.join(', ')})`
    });
  } else {
    // Step 3: Agent 3 - Inventory, Pricing & Lead-Time
    r3 = InventoryPricingAgent.run(r1.output, context.products, context.inventory);
    trace.push({
      time: nowTimeLabel(),
      step: 'Thẩm định tồn kho & giá (NVKD & Vận hành)',
      workflowNode: 'audit',
      agent: 'Tác tử Tồn & Giá',
      agentFull: r3.agentName,
      durationMs: r3.durationMs,
      usedLLM: false,
      status: r3.output.riskAlerts.length > 0 ? 'warning' : 'success',
      summary: `Tổng niêm yết ${formatVND(r3.output.subtotalVND)} | Rủi ro: ${r3.output.riskAlerts.length} cảnh báo`
    });

    // Step 4: Agent 4 - Policy & Escalation Check
    r4 = PolicyGovernanceAgent.run(r1.output, r2.output, r3.output, context.policies);
    trace.push({
      time: nowTimeLabel(),
      step: 'Kiểm tra thẩm quyền & chính sách chiết khấu',
      workflowNode: r4.output.needsEscalation ? 'escalate' : 'quote',
      agent: 'Tác tử Chính sách',
      agentFull: r4.agentName,
      durationMs: r4.durationMs,
      usedLLM: false,
      status: r4.output.needsEscalation ? 'alert' : 'success',
      summary: r4.output.needsEscalation
        ? `Vượt thẩm quyền → Chuyển ${r4.output.requiredApprover}`
        : `Trong thẩm quyền NVKD (${r3.output.discountPct}% <= ${r4.output.nvkdMaxDiscountPct}%)`
    });
  }

  // Step 5: Agent 5 - Business Advisor & Response Drafter
  const r5 = await AdvisorDraftingAgent.run(r1.output, r2.output, r3.output, r4.output, options);
  trace.push({
    time: nowTimeLabel(),
    step: r2.output.isComplete ? 'Lập Báo giá, Đề xuất kinh doanh & Dự thảo phản hồi' : 'Soạn Thư yêu cầu KH bổ sung thông tin',
    workflowNode: r2.output.isComplete ? (r4.output.needsEscalation ? 'escalate' : 'quote') : 'clarify',
    agent: 'Tác tử Đề xuất',
    agentFull: r5.agentName,
    durationMs: r5.durationMs,
    usedLLM: r5.usedLLM,
    status: 'success',
    summary: `${r5.output.proposals.length} đề xuất kinh doanh & bản nháp phản hồi KH sẵn sàng${r5.usedLLM ? ' [AI]' : ''}`
  });

  // Determine overall workflow status & statusCode
  let finalStatus = 'HOÀN TẤT - SẴN SÀNG GỬI KH';
  let statusCode = 'READY';
  if (!r2.output.isComplete) {
    finalStatus = 'CHỜ KH BỔ SUNG THÔNG TIN';
    statusCode = 'CLARIFY';
  } else if (r4.output.needsEscalation) {
    finalStatus = `CHỜ DUYỆT (${r4.output.requiredApprover.toUpperCase()})`;
    statusCode = 'ESCALATE';
  } else if (r3.output.needsOpsCheckpoint) {
    finalStatus = 'CẦN VẬN HÀNH XÁC NHẬN';
    statusCode = 'OPS';
  }

  // Build BANT view model
  const bant = {
    budget: {
      value: r1.output.budgetVND ? formatVND(r1.output.budgetVND) : 'Chưa cung cấp',
      note: r2.output.isComplete
        ? `${r3.output.budgetFit} | Chiết khấu đề nghị: ${r3.output.discountPct}%`
        : 'Thiếu ngân sách dự kiến — cần xác nhận từ khách hàng'
    },
    authority: {
      name: r1.output.contactName || 'Chưa rõ người liên hệ',
      role: r1.output.companyName,
      intent: r4.output.needsEscalation
        ? `Cần cấp duyệt nội bộ: ${r4.output.requiredApprover}`
        : `NVKD phụ trách: ${r2.output.assignedOwner.name}`
    },
    needs: {
      summary: r1.output.items.length > 0
        ? `Yêu cầu ${r1.output.items.length} hạng mục (${r2.output.categoryFocus}): ${r1.output.items.map((i) => `${i.quantity}x ${i.productQuery}`).join(', ')}`
        : 'Chưa trích xuất được danh sách sản phẩm cụ thể',
      painPoint: r3.output.riskAlerts.length > 0
        ? r3.output.riskAlerts[0]
        : (r2.output.missingFields.length > 0
          ? `Thiếu thông tin: ${r2.output.missingFields.join(', ')}`
          : `Đáp ứng đầy đủ cấu hình & tiến độ (${r2.output.urgency})`)
    },
    timeline: {
      deadline: r1.output.deadlineDays ? `${r1.output.deadlineDays} ngày (${r1.output.deadlineRaw || ''})` : 'Chưa nêu thời hạn',
      leadTimeCalc: r3.output.maxLeadTimeDays > 0
        ? `${r3.output.maxLeadTimeDays} ngày ${r3.output.hasDeadlineRisk ? '(Không kịp hạn)' : '(Đáp ứng tốt)'}`
        : 'Chờ thẩm định',
      mismatch: r3.output.hasDeadlineRisk
    }
  };

  return {
    opportunityId: r2.output.opportunityId,
    requestId: r1.output.requestId,
    channel: r1.output.channel,
    processedAt: new Date().toISOString(),
    statusCode,
    finalStatus,
    humanDecision: {
      opsConfirmed: !r3.output.needsOpsCheckpoint,
      opsNote: '',
      managerDecision: r4.output.needsEscalation ? 'PENDING' : 'AUTO_APPROVED',
      managerNote: ''
    },
    bant,
    intake: r1.output,
    triage: r2.output,
    audit: r3.output,
    policy: r4.output,
    advisor: r5.output,
    trace
  };
}

// Unified LLM caller: uses localhost /api/llm proxy (with .env AQ./AIza key) or direct REST fallback
async function invokeLLM(prompt, { apiKey = '', temperature = 0.2, responseMimeType = '' } = {}) {
  if (typeof window !== 'undefined' && window.location?.protocol?.startsWith('http')) {
    const res = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, apiKey, temperature, responseMimeType })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `LLM Proxy HTTP ${res.status}`);
    }
    return { text: data.text, provider: data.provider };
  }

  if (!apiKey) throw new Error('Chưa có API Key cho chế độ tĩnh.');
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const headers = { 'Content-Type': 'application/json' };

  const generationConfig = { temperature };
  if (responseMimeType) generationConfig.responseMimeType = responseMimeType;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig
    })
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('LLM không trả về nội dung.');
  return { text, provider: 'gemini_api' };
}

async function callGeminiExtraction(text, apiKey) {
  const prompt = `Trích xuất thông tin yêu cầu mua hàng B2B sau thành JSON hợp lệ (chỉ trả về JSON thuần, không markdown):
{
  "companyName": string | null,
  "contactName": string | null,
  "contactEmail": string | null,
  "budgetVND": number | null,
  "budgetRaw": string | null,
  "deadlineDays": number | null,
  "deadlineRaw": string | null,
  "requestedDiscountPct": number | null,
  "items": [{ "rawLine": string, "quantity": number, "productQuery": string, "quotedOldPrice": number | null }]
}
Nội dung yêu cầu:
${text}`;

  const { text: rawText, provider } = await invokeLLM(prompt, {
    apiKey,
    temperature: 0.1,
    responseMimeType: 'application/json'
  });
  const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  const parsed = JSON.parse(cleaned);
  parsed.__provider = provider;
  return parsed;
}

async function callGeminiDrafting(intake, triage, audit, policy, proposals, apiKey) {
  const prompt = `Bạn là chuyên gia kinh doanh B2B Công ty Công nghệ Minh An. Dựa trên dữ liệu đã kiểm chứng sau (tuyệt đối giữ nguyên số tiền, SKU và chính sách duyệt, không bịa số liệu), hãy viết 1 email phản hồi khách hàng chuyên nghiệp bằng tiếng Việt (bao gồm dòng Tiêu đề ở đầu):
- Mã cơ hội: ${triage.opportunityId}
- Khách hàng: ${intake.companyName} (${intake.contactName || 'Quý Anh/Chị'})
- Đủ thông tin: ${triage.isComplete} (Thiếu: ${triage.missingFields.join(', ') || 'Không'})
- Chi tiết dòng hàng: ${JSON.stringify(audit.lineAudits.map((l) => ({ sku: l.matchedSku, name: l.matchedName, qty: l.requestedQty, unitPrice: l.unitPrice, total: l.lineTotal, issues: l.issues })))}
- Tổng niêm yết: ${formatVND(audit.subtotalVND)}, Chiết khấu: ${audit.discountPct}%, Thanh toán: ${formatVND(audit.finalTotalVND)}
- Cấp duyệt: ${policy.requiredApprover}
- Đề xuất kinh doanh: ${proposals.map((p) => p.title + ': ' + p.detail).join(' | ')}
- Người phụ trách: ${triage.assignedOwner.name}`;

  const { text } = await invokeLLM(prompt, { apiKey, temperature: 0.3 });
  return text ? text.trim() : null;
}

