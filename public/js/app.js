// app.js — Minh An B2B Zero-Trust Quotation System (B1.1 → B9 Progressive UI)

import {
  parseUploadedFile,
  mapProducts,
  mapInventory,
  mapPolicies,
  mapSalesTeam,
  mapRequests,
  classifyWorkbookSheets,
  GATEKEEPER_FORMAT_ERROR,
  validateGatekeeperSourceName,
  validateGatekeeperSheets,
  downloadWorkbookAsXlsx
} from './parsers.js';

import {
  SAMPLE_PRODUCTS,
  SAMPLE_INVENTORY,
  SAMPLE_POLICIES,
  SAMPLE_SALES_TEAM,
  SAMPLE_REQUESTS
} from './sampleData.js';

import { formatVND } from './agents.js';

import {
  ROLES,
  DEFAULT_ADMIN_CONFIG,
  STEP_ORDER,
  STEP_LABELS,
  createInitialDossier,
  redoB12CleanData,
  approveB13CleanData,
  confirmB14Json,
  confirmB3AllGreen,
  applyB3WarehouseResolution,
  confirmB3AfterWarehouse,
  computeB4Discount,
  passB4ToB6,
  escalateB4ToB5,
  applyB5Decision,
  runB6Generate,
  submitB7ToDirector,
  applyB8DirectorDecision,
  sendB9ToCustomer,
  recordB9Outcome,
  rollbackToStep,
  pushNotification
} from './workflowEngine.js';

const state = {
  role: 'NVKD',
  adminConfig: { ...DEFAULT_ADMIN_CONFIG },
  products: [...SAMPLE_PRODUCTS],
  inventory: [...SAMPLE_INVENTORY],
  policies: [...SAMPLE_POLICIES],
  salesTeam: [...SAMPLE_SALES_TEAM],
  requests: [...SAMPLE_REQUESTS],
  dossiers: [],
  selectedOppId: null,
  expandedCollapsedSteps: {}, // { [oppId]: { [step]: boolean } }
  showAuditDrawer: false,
  filterStatus: 'ALL',
  searchQuery: '',
  notifications: [],
  systemErrors: []
};

function escapeHTML(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getCurrentRoleObj() {
  return ROLES.find((r) => r.id === state.role) || ROLES[0];
}

function setFeedback(el, msg, isError = false) {
  if (!el) return;
  el.textContent = msg;
  el.className = `feedback-line ${isError ? 'feedback-err' : 'feedback-ok'}`;
}

function switchView(viewName) {
  document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });
  document.querySelectorAll('.view-section').forEach((sec) => {
    sec.classList.toggle('active', sec.id === `view-${viewName}`);
  });
  if (viewName === 'settings') renderAdminPanel();
  if (viewName === 'workflow') highlightWorkflowBoard(getSelectedDossier());
}

function scrollToWorkspace(targetView = null) {
  if (targetView) switchView(targetView);
  const el = document.getElementById('appWorkspaceShell');
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function openIntakeModal() {
  document.getElementById('intakeModal')?.classList.add('open');
}

function closeIntakeModal() {
  document.getElementById('intakeModal')?.classList.remove('open');
}

async function checkServerHealth() {
  const pill = document.getElementById('agentOnlineBadge');
  const txt = document.getElementById('agentOnlineText');
  const heroTxt = document.getElementById('heroLlmText');
  const llmStatusText = document.getElementById('serverLlmStatusText');

  if (!window.location.protocol.startsWith('http')) {
    pill?.classList.add('offline');
    if (txt) txt.textContent = 'Chế độ Ngoại tuyến';
    if (heroTxt) heroTxt.textContent = 'Chế độ Quy tắc Nội bộ';
    return;
  }

  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (res.ok && data.ok) {
      pill?.classList.remove('offline');
      if (txt) txt.textContent = data.llmConfigured ? `Gemini AI • ${data.llmModel || '3.5-flash'}` : 'Máy chủ Sẵn sàng';
      if (heroTxt) heroTxt.textContent = data.llmConfigured ? 'Gemini AI Đang Hoạt Động' : 'Hệ thống Sẵn sàng';
      if (llmStatusText) {
        llmStatusText.textContent = data.llmConfigured
          ? `Đã kết nối Gemini (${data.llmModel}) — Khóa bảo mật (.env: ${data.llmKeyMasked})`
          : 'Chưa cấu hình Khóa API trong .env.';
      }
    }
  } catch (_) {
    pill?.classList.add('offline');
    if (txt) txt.textContent = 'Máy chủ Ngoại tuyến';
  }
}

function getSelectedDossier() {
  return state.dossiers.find((d) => d.opportunityId === state.selectedOppId) || null;
}

function getContext() {
  return {
    products: state.products,
    inventory: state.inventory,
    policies: state.policies,
    salesTeam: state.salesTeam
  };
}

// =========================================================================
// INITIALIZATION: Build initial dossiers from sample requests
// =========================================================================
function bootstrapSampleDossiers() {
  const ctx = getContext();
  const list = SAMPLE_REQUESTS.map((req) => createInitialDossier(req, ctx, state.adminConfig, state.notifications));

  // Advance a couple of sample dossiers to demonstrate different steps cleanly
  // Opp 0 stays at B1.3 (so user immediately sees B1.2→B1.3 2-col diff!)
  // Opp 1 advances to B4 (showing discount tables & Manager Escalation!)
  try {
    const d1 = list[1];
    if (d1) {
      approveB13CleanData(d1, null, state.adminConfig, 'Nguyễn Văn A', state.notifications);
      confirmB14Json(d1, {}, ctx, state.adminConfig, 'Nguyễn Văn A', state.notifications);
      if (!d1.b2Audit.hasYellowOrRed) confirmB3AllGreen(d1, state.adminConfig, 'Nguyễn Văn A');
    }
    const d3 = list[3];
    if (d3) {
      approveB13CleanData(d3, null, state.adminConfig, 'Nguyễn Văn A', state.notifications);
      confirmB14Json(d3, {}, ctx, state.adminConfig, 'Nguyễn Văn A', state.notifications);
      // Stays at B3 (Waiting for Warehouse!)
    }
  } catch (_) { /* ignore sample advance edge */ }

  // Priority sort: VIP / Nguy cấp first
  list.sort((a, b) => ((b.isVip || b.isUrgent ? 1 : 0) - (a.isVip || a.isUrgent ? 1 : 0)));
  state.dossiers = list;
  state.selectedOppId = list[0]?.opportunityId || null;
  renderAll();
}

// =========================================================================
// NOTIFICATIONS & ROLE SWITCHER
// =========================================================================
function renderNotifications() {
  const badge = document.getElementById('notifBadge');
  const listEl = document.getElementById('notifList');
  const unread = state.notifications.filter((n) => !n.read).length;
  if (badge) {
    badge.textContent = unread;
    badge.style.display = unread > 0 ? 'flex' : 'none';
  }
  if (!listEl) return;
  if (state.notifications.length === 0) {
    listEl.innerHTML = '<div class="empty-box" style="padding:20px;">Chưa có thông báo mới.</div>';
    return;
  }
  listEl.innerHTML = state.notifications.slice(0, 20).map((n) => `
    <div class="notif-item ${n.read ? '' : 'unread'}">
      <div class="notif-item-top">
        <span>${escapeHTML(n.event)}</span>
        <span style="color:#9ca3af;font-weight:600;">${escapeHTML(n.time)}</span>
      </div>
      <p><strong>${escapeHTML(n.recipient)}:</strong> ${escapeHTML(n.message)}</p>
    </div>
  `).join('');
}

function updateRoleUI() {
  const avatar = document.getElementById('roleAvatar');
  const sel = document.getElementById('roleSelector');
  if (sel) sel.value = state.role;
  if (avatar) avatar.textContent = state.role.slice(0, 2);
  renderDetailPanel();
  renderAdminPanel();
}

// =========================================================================
// KPI, FILTER & CHART
// =========================================================================
function getFilteredDossiers() {
  const q = state.searchQuery.trim().toLowerCase();
  const filtered = state.dossiers.filter((d) => {
    if (state.filterStatus === 'PRIORITY' && !(d.isVip || d.isUrgent)) return false;
    if (state.filterStatus === 'B1' && !['B1.2', 'B1.3', 'B1.4'].includes(d.currentStep)) return false;
    if (state.filterStatus === 'B3' && d.currentStep !== 'B3') return false;
    if (state.filterStatus === 'B5_B8' && !['B5', 'B8'].includes(d.currentStep)) return false;
    if (state.filterStatus === 'B9' && d.currentStep !== 'B9') return false;
    if (!q) return true;
    const hay = [
      d.opportunityId,
      d.b12?.cleanedFields?.company,
      d.assignedNvkd,
      d.dashboardStatus
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });

  // Always sort priority VIP/Nguy cấp to top
  return filtered.sort((a, b) => ((b.isVip || b.isUrgent ? 1 : 0) - (a.isVip || a.isUrgent ? 1 : 0)));
}

function getDossierValueVND(d) {
  if (d.b4Discount?.summary?.totalAfter > 0) return d.b4Discount.summary.totalAfter;
  if (d.b2Audit?.subtotalVND > 0) return d.b2Audit.subtotalVND;
  return d.b14Json?.budget_vnd || d.b12?.cleanedFields?.budgetVND || 0;
}

function renderKPIs() {
  const ds = state.dossiers;
  const vipUrgent = ds.filter((d) => d.isVip || d.isUrgent).length;
  const pendingOpsMgr = ds.filter((d) => ['B3', 'B5', 'B8'].includes(d.currentStep)).length;
  const readySent = ds.filter((d) => d.currentStep === 'B9' || d.b9Send?.sent).length;
  const totalVal = ds.reduce((s, d) => s + getDossierValueVND(d), 0);

  document.getElementById('kpiTotal').textContent = ds.length;
  const navBadge = document.getElementById('oppNavBadge');
  if (navBadge) navBadge.textContent = ds.length;
  document.getElementById('kpiVipUrgent').textContent = vipUrgent;
  document.getElementById('kpiPendingOpsMgr').textContent = pendingOpsMgr;
  document.getElementById('kpiReadySent').textContent = readySent;
  document.getElementById('kpiValue').textContent = formatVND(totalVal);
}

function renderPipelineChart() {
  const host = document.getElementById('pipelineChartContainer');
  if (!host) return;
  const list = getFilteredDossiers();
  if (list.length === 0) {
    host.innerHTML = '<div class="empty-box" style="padding:24px;">Không có hồ sơ phù hợp bộ lọc hiện tại.</div>';
    return;
  }

  const items = list.map((d) => {
    const val = getDossierValueVND(d);
    return {
      id: d.opportunityId,
      valueVND: val,
      millions: Math.round((val / 1_000_000) * 10) / 10
    };
  });

  const maxM = Math.max(100, ...items.map((x) => x.millions)) * 1.18;
  const W = 860, H = 190, padL = 58, padR = 28, padT = 26, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const pts = items.map((it, idx) => ({
    ...it,
    x: items.length === 1 ? padL + plotW / 2 : padL + (idx * plotW) / (items.length - 1),
    y: padT + plotH - (it.millions / maxM) * plotH
  }));

  let linePath = '';
  let areaPath = '';
  if (pts.length === 1) {
    linePath = `M ${padL} ${pts[0].y.toFixed(1)} L ${W - padR} ${pts[0].y.toFixed(1)}`;
    areaPath = `${linePath} L ${W - padR} ${padT + plotH} L ${padL} ${padT + plotH} Z`;
  } else {
    linePath = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      const cx = ((p0.x + p1.x) / 2).toFixed(1);
      linePath += ` C ${cx} ${p0.y.toFixed(1)}, ${cx} ${p1.y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
    }
    areaPath = `${linePath} L ${pts[pts.length - 1].x.toFixed(1)} ${padT + plotH} L ${pts[0].x.toFixed(1)} ${padT + plotH} Z`;
  }

  const focusPt = pts.find((p) => p.id === state.selectedOppId) || pts[0];
  const yTicks = [0, 0.5, 1].map((r) => {
    const y = padT + plotH - r * plotH;
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#f3eae2" stroke-dasharray="4 4" />
      <text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="#9ca3af" font-size="11">${Math.round(maxM * r)} Tr</text>`;
  }).join('');

  const pointsHtml = pts.map((p) => {
    const isSel = p.id === focusPt.id;
    return `
      <g class="chart-pt-group" data-opp-id="${escapeHTML(p.id)}" style="cursor:pointer;">
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${isSel ? 6 : 4}" fill="${isSel ? '#ff7b39' : '#fff'}" stroke="${isSel ? '#fff' : '#ff8c47'}" stroke-width="2.5" />
        <text x="${p.x.toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="${isSel ? '#ee6820' : '#8b7e74'}" font-size="11" font-weight="${isSel ? '800' : '600'}">${escapeHTML(p.id)}</text>
      </g>`;
  }).join('');

  const badgeW = 152;
  const badgeX = Math.min(Math.max(focusPt.x - badgeW / 2, padL), W - padR - badgeW);
  const badgeY = Math.max(4, focusPt.y - 38);

  host.innerHTML = `
    <div class="chart-svg-box" style="height:190px;">
      <svg viewBox="0 0 ${W} ${H}" class="pipeline-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id="pastelOrangeArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#ff9958" stop-opacity="0.34" />
            <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
          </linearGradient>
        </defs>
        ${yTicks}
        <path d="${areaPath}" fill="url(#pastelOrangeArea)" />
        <path d="${linePath}" fill="none" stroke="#ff823a" stroke-width="2.6" stroke-linecap="round" />
        ${pointsHtml}
        <g transform="translate(${badgeX.toFixed(1)}, ${badgeY.toFixed(1)})">
          <rect width="${badgeW}" height="28" rx="8" fill="#ff7b39" />
          <text x="${badgeW / 2}" y="18" text-anchor="middle" fill="#fff" font-size="11" font-weight="800">${escapeHTML(focusPt.id)}: ${escapeHTML(formatVND(focusPt.valueVND))}</text>
        </g>
      </svg>
    </div>`;

  host.querySelectorAll('.chart-pt-group').forEach((g) => {
    g.addEventListener('click', () => {
      state.selectedOppId = g.dataset.oppId;
      renderPipelineChart();
      renderInboxList();
      renderDetailPanel();
    });
  });
}

function renderInboxList() {
  const container = document.getElementById('oppList');
  const filtered = getFilteredDossiers();
  document.getElementById('oppCount').textContent = filtered.length;

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-box">Không có hồ sơ phù hợp bộ lọc.</div>';
    return;
  }

  container.innerHTML = filtered.map((d) => {
    const isSel = d.opportunityId === state.selectedOppId;
    const company = d.b14Json?.company_name || d.b12?.cleanedFields?.company || 'Chưa rõ tên công ty';
    const val = getDossierValueVND(d);
    const vipTag = d.isVip ? '<span class="tag-vip">★ VIP</span>' : '';
    const urgTag = d.isUrgent ? '<span class="tag-urgent">⚡ NGUY CẤP</span>' : '';

    return `
      <div class="opp-card ${isSel ? 'selected' : ''}" data-opp-id="${escapeHTML(d.opportunityId)}">
        <div class="opp-card-top">
          <div>
            <h3 class="opp-card-title">${escapeHTML(company)}</h3>
            <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px;">${vipTag}${urgTag}</div>
          </div>
          <span class="status-pill ${d.currentStep === 'B9' ? 'pill-READY' : (['B5', 'B8'].includes(d.currentStep) ? 'pill-ESCALATE' : 'pill-OPS')}">${escapeHTML(d.currentStep)}</span>
        </div>
        <div class="opp-card-meta">
          <span><code>${escapeHTML(d.opportunityId)}</code> (v${d.version}) • ${escapeHTML(d.dashboardStatus)}</span>
          <strong>${val > 0 ? escapeHTML(formatVND(val)) : '—'}</strong>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.opp-card').forEach((el) => {
    el.addEventListener('click', () => {
      state.selectedOppId = el.dataset.oppId;
      renderPipelineChart();
      renderInboxList();
      renderDetailPanel();
    });
  });
}

// =========================================================================
// PROGRESSIVE STEP-BY-STEP DETAIL PANEL (Completed = Collapsed, Active = Expanded)
// =========================================================================
function getRequiredRoleForStep(d) {
  if (d.currentStep === 'B3' && d.b2Audit?.hasYellowOrRed && !d.b3Warehouse.confirmedByKho) return 'KHO';
  if (d.currentStep === 'B5') return d.b5Escalation.requiredRole?.includes('BGĐ') ? 'GIAM_DOC' : 'TRUONG_PHONG';
  if (d.currentStep === 'B8') return 'GIAM_DOC';
  return 'NVKD';
}

function renderRoleLockNotice(requiredRole) {
  if (state.role === requiredRole) return '';
  const roleLabel = ROLES.find((r) => r.id === requiredRole)?.label || requiredRole;
  return `
    <div class="rbac-lock-note">
      <span>🔒 Bước này thuộc quyền xử lý của <strong>${escapeHTML(roleLabel)}</strong> (bạn đang ở vai trò ${escapeHTML(getCurrentRoleObj().short)}).</span>
      <button class="btn btn-orange btn-sm btn-quick-switch-role" data-role="${escapeHTML(requiredRole)}">Chuyển sang ${escapeHTML(requiredRole)}</button>
    </div>`;
}

function renderCollapsedSummary(step, d) {
  const expanded = Boolean(state.expandedCollapsedSteps[d.opportunityId]?.[step]);
  let summary = '';
  let bodyHtml = '';

  if (step === 'B1.2') {
    summary = `Làm sạch xong (${d.b12.cleanedFields.products.length} SP, ${d.b12.changeLog.length} chỉnh sửa)`;
    bodyHtml = `<p><strong>Công ty:</strong> ${escapeHTML(d.b12.cleanedFields.company)} | <strong>Liên hệ:</strong> ${escapeHTML(d.b12.cleanedFields.contact)}</p>
      <p><strong>Thay đổi AI:</strong> ${d.b12.changeLog.map((c) => `${escapeHTML(c.type)}: ${escapeHTML(c.before)} → ${escapeHTML(c.after)}`).join(' • ') || 'Không có'}</p>`;
  } else if (step === 'B1.3') {
    summary = `NVKD đã duyệt bản làm sạch (v${d.version})`;
    bodyHtml = `<p>Đã xác nhận bởi NVKD: <strong>${escapeHTML(d.b13ApprovedFields?.company || '')}</strong></p>`;
  } else if (step === 'B1.4') {
    summary = `JSON đã xác nhận (${d.b14Json?.customer_tier || 'Thường'} • ${d.b14Json?.urgency_level || 'Bình thường'})`;
    bodyHtml = `<pre style="margin:0;font-size:11.5px;overflow:auto;">${escapeHTML(JSON.stringify(d.b14Json, null, 2))}</pre>`;
  } else if (step === 'B2') {
    summary = `Đối soát Bảng giá ${d.b2Audit?.priceListVersion}: ${formatVND(d.b2Audit?.subtotalVND || 0)}`;
    bodyHtml = `<p>Số dòng hàng: ${d.b2Audit?.rows?.length || 0} dòng.</p>`;
  } else if (step === 'B3') {
    summary = `Kho & Giá đã chốt (${formatVND(d.b2Audit?.subtotalVND || 0)})`;
    bodyHtml = `<p>Tất cả dòng hàng đã được NVKD &amp; Kho xác nhận.</p>`;
  } else if (step === 'B4') {
    summary = `Chiết khấu tổng đơn: ${d.b4Discount?.summary?.overallPct || 0}% (${formatVND(d.b4Discount?.summary?.totalAfter || 0)})`;
    bodyHtml = `<p>Cảnh báo: ${escapeHTML(d.b4Discount?.summary?.warningText || '')}</p>`;
  } else if (step === 'B5') {
    summary = `Quản lý phê duyệt ngoại lệ (${d.b5Escalation?.decision || 'Đã qua'})`;
    bodyHtml = `<p>Lý do Escalate: ${escapeHTML(d.b5Escalation?.reason || 'Không cần Escalate')}</p>`;
  } else if (step === 'B6') {
    summary = `Đã sinh 4 sản phẩm (Phương án + Email + .xlsx + Báo cáo text)`;
    bodyHtml = `<p>Kiểm tra chéo số liệu: ${d.b6Deliverables?.selfCheckOk ? '✓ Khớp 100%' : '⚠ Có cảnh báo'}</p>`;
  } else if (step === 'B7') {
    summary = `NVKD đã duyệt nội dung trình Giám đốc`;
    bodyHtml = `<p>Nội dung email khớp số liệu đã duyệt.</p>`;
  } else if (step === 'B8') {
    summary = `Giám đốc KD đã duyệt cuối — Khóa nội dung`;
    bodyHtml = `<p>${escapeHTML(d.b8Director?.note || 'Đã duyệt')}</p>`;
  }

  return `
    <div class="collapsed-step-card">
      <div class="collapsed-step-bar" data-toggle-step="${escapeHTML(step)}">
        <div class="collapsed-step-left">
          <span class="collapsed-check">✓</span>
          <span><strong>${escapeHTML(STEP_LABELS[step])}</strong> — <span style="color:#6b7280;font-weight:500;">${escapeHTML(summary)}</span></span>
        </div>
        <span class="btn-link-sm">${expanded ? 'Thu gọn ▲' : 'Xem lại ▼'}</span>
      </div>
      ${expanded ? `<div class="collapsed-body">${bodyHtml}</div>` : ''}
    </div>`;
}

function renderRollbackControls(d) {
  const prevSteps = STEP_ORDER.slice(0, Math.max(0, STEP_ORDER.indexOf(d.currentStep)));
  if (prevSteps.length === 0) return '';
  return `
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
      <select id="rollbackTargetSelect" class="filter-select">
        ${prevSteps.map((s) => `<option value="${s}">Quay lại ${s}</option>`).join('')}
      </select>
      <input id="rollbackReasonInput" type="text" class="text-inp" style="width:200px;padding:6px 10px;font-size:12px;" placeholder="Lý do trả lại (bắt buộc)..." />
      <button id="btnCommonRollback" class="btn btn-rose-outline btn-sm">↩ Trả lại bước trước</button>
    </div>`;
}

function renderActiveStepCard(d) {
  const st = d.currentStep;
  const reqRole = getRequiredRoleForStep(d);
  const canAct = state.role === reqRole;
  const lockNotice = renderRoleLockNotice(reqRole);

  if (d.dashboardStatus === 'Đã hủy') {
    return `<div class="active-step-card"><h3 style="color:#df3f45;margin:0 0 8px;">Hồ sơ Đã hủy tại Bước 3</h3><p>Kho đã từ chối toàn bộ đơn hàng. NVKD vui lòng soạn thư thông báo khách hàng.</p></div>`;
  }

  // ---- B1.3: NVKD Kiểm tra bản làm sạch (2 cột diff + 3 nút) ----
  if (st === 'B1.3') {
    const f = d.b12.cleanedFields;
    const hasRed = d.b12.flags.some((fl) => fl.level === 'RED');
    const flagsHtml = d.b12.flags.map((fl) => `<div class="flag-pill flag-${fl.level}">${fl.level === 'RED' ? '🔴 Cờ Đỏ (Khóa Duyệt):' : '🟡 Cờ Vàng:'} ${escapeHTML(fl.msg)}</div>`).join('');

    return `
      <div class="active-step-card">
        <div class="active-step-head">
          <h3 class="active-step-title">Bước 1.3: NVKD Kiểm tra Bản làm sạch (2 Cột Đối chiếu)</h3>
          <button id="btnDownloadB12Xlsx" class="btn btn-peach-outline btn-sm">⬇ Tải Bản làm sạch (.xlsx)</button>
        </div>
        ${lockNotice}
        ${flagsHtml}
        <div class="diff-grid">
          <div class="diff-box">
            <h5>Bản gốc (Không chỉnh sửa)</h5>
            <div class="diff-raw">${escapeHTML(d.rawTextOriginal)}</div>
          </div>
          <div class="diff-box">
            <h5>Bản AI đã làm sạch (Tô nổi bật phần sửa)</h5>
            <label class="field-lbl">Công ty</label>
            <input id="b13Company" class="text-inp" value="${escapeHTML(f.company)}" ${canAct ? '' : 'disabled'} />
            <label class="field-lbl" style="margin-top:8px;">Sản phẩm &amp; SL (${f.products.length} dòng)</label>
            <div style="font-size:12px;margin-bottom:8px;">
              ${f.products.map((p) => `<span class="diff-highlight">${escapeHTML(p.name)}: ${p.qty}</span>`).join(' • ') || '<span style="color:#df3f45;">Chưa có SP</span>'}
            </div>
            <label class="field-lbl">Ngân sách chuẩn hóa (VNĐ) • Deadline</label>
            <div class="input-row">
              <input id="b13Budget" type="number" class="text-inp" value="${f.budgetVND || ''}" placeholder="Bỏ trống nếu thiếu" ${canAct ? '' : 'disabled'} />
              <input id="b13DeadlineDays" type="number" class="text-inp" value="${f.deadlineDays || ''}" placeholder="Số ngày" style="width:110px;" ${canAct ? '' : 'disabled'} />
            </div>
            <p class="subtext" style="margin-top:8px;"><strong>Nhật ký AI sửa:</strong> ${d.b12.changeLog.map((c) => `${escapeHTML(c.before)} → <span class="diff-highlight">${escapeHTML(c.after)}</span>`).join(', ') || 'Giữ nguyên'}</p>
          </div>
        </div>
        <div class="step-action-bar">
          <div class="input-row" style="flex:1;min-width:260px;">
            <input id="b13RedoNote" type="text" class="text-inp" placeholder="Ghi chú nếu yêu cầu AI làm lại (VD: SL switch là 45)..." ${canAct ? '' : 'disabled'} />
            <button id="btnB13Redo" class="btn btn-light btn-sm" ${canAct ? '' : 'disabled'}>↻ Yêu cầu làm lại</button>
          </div>
          <div class="btn-row">
            <button id="btnB13SaveEdit" class="btn btn-peach-outline btn-sm" ${canAct ? '' : 'disabled'}>Lưu sửa trực tiếp</button>
            <button id="btnB13Approve" class="btn btn-orange" ${(!canAct || hasRed) ? 'disabled' : ''}>✓ Duyệt → Sang B1.4 JSON</button>
          </div>
        </div>
      </div>`;
  }

  // ---- B1.4: JSON & Gắn thẻ VIP/Nguy cấp ----
  if (st === 'B1.4') {
    const j = d.b14Json;
    return `
      <div class="active-step-card">
        <div class="active-step-head">
          <h3 class="active-step-title">Bước 1.4: Xác nhận JSON, Thẻ VIP/Nguy cấp &amp; Phân công NVKD</h3>
          <span class="opp-code-chip">${escapeHTML(j.customer_tier)} • ${escapeHTML(j.urgency_level)}</span>
        </div>
        ${lockNotice}
        ${(j.missing_flags || []).map((m) => `<div class="flag-pill flag-YELLOW">🟡 ${escapeHTML(m)}</div>`).join('')}
        <div class="settings-grid" style="margin-bottom:12px;">
          <div class="setting-box">
            <label class="field-lbl">Công ty &amp; Mô hình kinh doanh</label>
            <input id="b14Company" class="text-inp" value="${escapeHTML(j.company_name)}" ${canAct ? '' : 'disabled'} />
            <input id="b14Model" class="text-inp" style="margin-top:8px;" value="${escapeHTML(j.business_model)}" ${canAct ? '' : 'disabled'} />
          </div>
          <div class="setting-box">
            <label class="field-lbl">Ngân sách (VNĐ) • Deadline (ngày) • % CK yêu cầu</label>
            <div class="input-row">
              <input id="b14Budget" type="number" class="text-inp" value="${j.budget_vnd || ''}" placeholder="Ngân sách" ${canAct ? '' : 'disabled'} />
              <input id="b14Deadline" type="number" class="text-inp" value="${j.deadline_days || ''}" placeholder="Ngày" style="width:90px;" ${canAct ? '' : 'disabled'} />
              <input id="b14Discount" type="number" step="0.5" class="text-inp" value="${j.requested_discount_pct || 0}" placeholder="% CK" style="width:90px;" ${canAct ? '' : 'disabled'} />
            </div>
            <p class="subtext" style="margin-top:8px;">NVKD phụ trách: <strong>${escapeHTML(d.assignedNvkd)}</strong></p>
          </div>
        </div>
        <div class="step-action-bar">
          ${renderRollbackControls(d)}
          <button id="btnB14Confirm" class="btn btn-orange" ${canAct ? '' : 'disabled'}>✓ Xác nhận JSON → B2 Đối soát Kho &amp; Giá</button>
        </div>
      </div>`;
  }

  // ---- B3: Kiểm duyệt Kho & Giá ----
  if (st === 'B3') {
    const audit = d.b2Audit;
    const needsKho = audit.hasYellowOrRed && !d.b3Warehouse.confirmedByKho;
    const rowsHtml = audit.rows.map((r) => `
      <tr>
        <td><strong>${escapeHTML(r.sku)}</strong><br/><span class="subtext">${escapeHTML(r.name)}</span></td>
        <td>${r.requestedQty}</td>
        <td>${r.availableQty}</td>
        <td>${formatVND(r.unitPrice)}</td>
        <td>${r.leadTimeDays ?? '—'} ngày</td>
        <td><span class="audit-color-${r.color}">${r.color === 'GREEN' ? 'Xanh' : (r.color === 'YELLOW' ? 'Vàng' : (r.color === 'RED' ? 'Đỏ' : 'Từ chối'))}</span></td>
        <td>
          <div style="font-size:12px;">${escapeHTML(r.aiNote)}</div>
          ${needsKho && (r.color === 'YELLOW' || r.color === 'RED') ? `
            <div style="margin-top:6px;display:flex;gap:5px;flex-wrap:wrap;" data-kho-line="${escapeHTML(r.lineId)}">
              <select class="filter-select kho-action-sel" data-line="${escapeHTML(r.lineId)}" ${canAct ? '' : 'disabled'}>
                <option value="">-- Chọn phương án Kho --</option>
                <option value="PARTIAL">Giao từng phần</option>
                <option value="SUBSTITUTE">Đổi SKU thay thế</option>
                <option value="REJECT">Từ chối dòng</option>
              </select>
              <input class="text-inp kho-param-inp" data-line="${escapeHTML(r.lineId)}" style="width:170px;padding:4px 8px;font-size:11.5px;" placeholder="SL ngay / Mã SKU / Lý do..." ${canAct ? '' : 'disabled'} />
            </div>` : ''}
        </td>
      </tr>`).join('');

    return `
      <div class="active-step-card">
        <div class="active-step-head">
          <h3 class="active-step-title">Bước 3: Bảng Audit Kho &amp; Giá (${escapeHTML(audit.priceListVersion)})</h3>
          <strong>Tổng tạm tính: ${formatVND(audit.subtotalVND)}</strong>
        </div>
        ${lockNotice}
        <div class="table-wrap">
          <table class="clean-table">
            <thead><tr><th>SKU / Sản phẩm</th><th>SL</th><th>Khả dụng</th><th>Đơn giá</th><th>Lead-time</th><th>Trạng thái</th><th>Ghi chú &amp; Xử lý Kho</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
        <div class="step-action-bar">
          ${renderRollbackControls(d)}
          <div class="btn-row">
            ${needsKho
              ? `<button id="btnB3KhoSubmit" class="btn btn-orange" ${canAct ? '' : 'disabled'}>✓ Kho: Cập nhật phương án</button>`
              : `<button id="btnB3NvkdConfirm" class="btn btn-orange" ${(canAct && !audit.rows.some((r) => r.color === 'RED')) ? '' : 'disabled'}>✓ NVKD: Xác nhận Kho &amp; Giá → B4</button>`}
          </div>
        </div>
      </div>`;
  }

  // ---- B4: Thẩm định Chiết khấu (2 Bảng + 3 Tầng) ----
  if (st === 'B4') {
    const b4 = d.b4Discount;
    const sum = b4.summary;
    const canPass = sum.tier === 'PASS_OK';
    const rowsHtml = b4.productTable.map((p) => `
      <tr>
        <td><strong>${escapeHTML(p.sku)}</strong> — ${escapeHTML(p.name)}</td>
        <td>${formatVND(p.basePrice)}</td>
        <td><input type="number" class="text-inp b4-req-price" data-line="${escapeHTML(p.lineId)}" value="${p.requestedPrice}" style="width:130px;padding:5px 8px;" ${canAct ? '' : 'disabled'} /></td>
        <td><strong>${p.discountPct}%</strong></td>
        <td><span class="audit-color-${p.rating === 'An toàn' ? 'GREEN' : (p.rating === 'Sát hạn mức' ? 'YELLOW' : 'RED')}">${escapeHTML(p.rating)}</span></td>
      </tr>`).join('');

    return `
      <div class="active-step-card">
        <div class="active-step-head">
          <h3 class="active-step-title">Bước 4: Thẩm định Chiết khấu (2 Bảng &amp; 3 Tầng Hạn mức)</h3>
          <span class="status-pill ${canPass ? 'pill-READY' : 'pill-ESCALATE'}">${escapeHTML(sum.warningText)}</span>
        </div>
        ${lockNotice}
        <h4 style="margin:0 0 8px;font-size:13px;">Bảng 1: Chiết khấu theo sản phẩm</h4>
        <div class="table-wrap" style="margin-bottom:14px;">
          <table class="clean-table">
            <thead><tr><th>Sản phẩm</th><th>Giá gốc</th><th>Giá khách đề xuất</th><th>% CK</th><th>Đánh giá</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>

        <h4 style="margin:0 0 8px;font-size:13px;">Bảng 2: Chiết khấu tổng đơn</h4>
        <div class="table-wrap" style="margin-bottom:12px;">
          <table class="clean-table">
            <tbody>
              <tr><td><strong>Tổng trước chiết khấu</strong></td><td>${formatVND(sum.totalBefore)}</td><td><strong>Tổng sau chiết khấu</strong></td><td style="color:#ee6820;font-weight:800;">${formatVND(sum.totalAfter)}</td></tr>
              <tr><td><strong>Tổng chiết khấu</strong></td><td>${formatVND(sum.totalDiscountVND)}</td><td><strong>Tỷ lệ CK / Hạn mức NVKD</strong></td><td><strong>${sum.overallPct}%</strong> / ${sum.nvkdLimit}% (Cứng: ${sum.hardLimit}%)</td></tr>
            </tbody>
          </table>
        </div>

        <div class="step-action-bar">
          <div class="btn-row">
            <button id="btnB4Recalc" class="btn btn-light btn-sm" ${canAct ? '' : 'disabled'}>↻ Chỉnh sửa &amp; Tính lại</button>
            ${renderRollbackControls(d)}
          </div>
          <div class="btn-row">
            <input id="b4EscReason" type="text" class="text-inp" style="width:200px;padding:6px 10px;font-size:12px;" placeholder="Lý do Escalate..." ${canAct ? '' : 'disabled'} />
            <button id="btnB4Escalate" class="btn btn-rose-outline btn-sm" ${canAct ? '' : 'disabled'}>⚑ Escalate → B5</button>
            <button id="btnB4Pass" class="btn btn-orange" ${(canAct && canPass) ? '' : 'disabled'}>✓ Pass → B6 Sinh Đề xuất</button>
          </div>
        </div>
      </div>`;
  }

  // ---- B5: Phê duyệt Ngoại lệ ----
  if (st === 'B5') {
    const sum = d.b4Discount.summary;
    return `
      <div class="active-step-card">
        <div class="active-step-head">
          <h3 class="active-step-title">Bước 5: Phê duyệt Ngoại lệ (${escapeHTML(d.b5Escalation.requiredRole || 'Trưởng phòng')})</h3>
          <span>Vòng duyệt: ${d.b5Escalation.rounds}/${d.b5Escalation.maxRounds}</span>
        </div>
        ${lockNotice}
        <div class="flag-pill flag-YELLOW"><strong>Lý do NVKD xin ngoại lệ:</strong> ${escapeHTML(d.b5Escalation.reason)} • Tổng CK: <strong>${sum.overallPct}%</strong> (${formatVND(sum.totalAfter)})</div>
        <div class="settings-grid" style="margin-top:10px;">
          <div class="setting-box">
            <label class="field-lbl">Duyệt có điều kiện — Nhập mức CK tối đa (%)</label>
            <input id="b5CondPct" type="number" step="0.5" class="text-inp" placeholder="VD: 12" ${canAct ? '' : 'disabled'} />
          </div>
          <div class="setting-box">
            <label class="field-lbl">Lý do (bắt buộc nếu Từ chối)</label>
            <input id="b5Reason" type="text" class="text-inp" placeholder="Nhập lý do duyệt / từ chối..." ${canAct ? '' : 'disabled'} />
          </div>
        </div>
        <div class="step-action-bar">
          ${renderRollbackControls(d)}
          <div class="btn-row">
            <button id="btnB5Reject" class="btn btn-rose-outline btn-sm" ${canAct ? '' : 'disabled'}>✕ Từ chối → Quay lại B4</button>
            <button id="btnB5Cond" class="btn btn-peach-outline btn-sm" ${canAct ? '' : 'disabled'}>Duyệt có điều kiện</button>
            <button id="btnB5Approve" class="btn btn-orange" ${canAct ? '' : 'disabled'}>✓ Duyệt → B6 Sinh Đề xuất</button>
          </div>
        </div>
      </div>`;
  }

  // ---- B7: NVKD Duyệt 4 Sản phẩm (Chống sửa số tay) ----
  if (st === 'B7') {
    const deliv = d.b6Deliverables;
    return `
      <div class="active-step-card">
        <div class="active-step-head">
          <h3 class="active-step-title">Bước 7: NVKD Duyệt 4 Sản phẩm &amp; Trình Giám đốc KD</h3>
          <button id="btnDownloadB6Xlsx" class="btn btn-peach-outline btn-sm">⬇ Tải Báo cáo 5 Sheet (.xlsx)</button>
        </div>
        ${lockNotice}
        <div class="proposal-grid">
          ${deliv.proposals.map((p) => `<div class="proposal-card high"><div class="prop-badge">${escapeHTML(p.badge)}</div><h4 class="prop-title">${escapeHTML(p.title)}</h4><p class="prop-detail">${escapeHTML(p.detail)}</p></div>`).join('')}
        </div>
        <label class="field-lbl">Báo cáo Text tóm tắt vấn đề phát sinh</label>
        <pre class="diff-box" style="margin:0 0 12px;white-space:pre-wrap;font-family:inherit;font-size:12px;">${escapeHTML(deliv.textReport)}</pre>
        <label class="field-lbl">Email nháp B2B (Cảnh báo: sửa sai tổng số tiền ${escapeHTML(deliv.approvedTotalSnapshot)} sẽ tự động trả về B4)</label>
        <textarea id="b7EmailEditor" rows="9" class="text-inp" ${canAct ? '' : 'disabled'}>${escapeHTML(d.b7Review.editedEmail)}</textarea>
        <div class="step-action-bar">
          ${renderRollbackControls(d)}
          <button id="btnB7SubmitDir" class="btn btn-orange" ${canAct ? '' : 'disabled'}>✓ Trình Giám đốc KD duyệt cuối (B8)</button>
        </div>
      </div>`;
  }

  // ---- B8: Giám đốc KD Duyệt cuối ----
  if (st === 'B8') {
    return `
      <div class="active-step-card">
        <div class="active-step-head">
          <h3 class="active-step-title">Bước 8: Giám đốc Kinh doanh Duyệt cuối</h3>
          <button id="btnDownloadB6Xlsx" class="btn btn-peach-outline btn-sm">⬇ Xem File Báo cáo (.xlsx)</button>
        </div>
        ${lockNotice}
        <div class="diff-box" style="margin-bottom:12px;">
          <h5>Email trình duyệt</h5>
          <div class="diff-raw">${escapeHTML(d.b7Review.editedEmail)}</div>
        </div>
        <div class="input-row" style="margin-bottom:10px;">
          <select id="b8ReturnStep" class="filter-select" ${canAct ? '' : 'disabled'}>
            <option value="B7">Trả lại B7 (Nội dung Email)</option>
            <option value="B4">Trả lại B4 (Giá / Chiết khấu)</option>
            <option value="B3">Trả lại B3 (Hàng hóa / Kho)</option>
          </select>
          <input id="b8NoteInput" type="text" class="text-inp" placeholder="Ghi chú duyệt hoặc lý do trả lại..." ${canAct ? '' : 'disabled'} />
        </div>
        <div class="step-action-bar">
          <button id="btnB8Return" class="btn btn-rose-outline btn-sm" ${canAct ? '' : 'disabled'}>↩ Trả lại bước đã chọn</button>
          <button id="btnB8Approve" class="btn btn-orange" ${canAct ? '' : 'disabled'}>✓ Giám đốc Duyệt cuối &amp; Khóa nội dung → B9</button>
        </div>
      </div>`;
  }

  // ---- B9: Gửi khách & Đóng hồ sơ ----
  if (st === 'B9') {
    return `
      <div class="active-step-card">
        <div class="active-step-head">
          <h3 class="active-step-title">Bước 9: Phát hành Báo giá &amp; Đóng hồ sơ</h3>
          <span class="status-pill pill-READY">${d.b9Send.sent ? 'ĐÃ GỬI KHÁCH' : 'SẴN SÀNG GỬI'}</span>
        </div>
        ${lockNotice}
        <p class="subtext" style="margin-bottom:10px;">Nội dung đã được Giám đốc KD khóa và kiểm tra khớp số liệu 100%. Trách nhiệm bấm gửi cuối cùng thuộc về NVKD.</p>
        <div class="btn-row" style="margin-bottom:12px;">
          <button id="btnDownloadB6Xlsx" class="btn btn-peach-outline btn-sm">⬇ Tải File đính kèm (.xlsx)</button>
          ${!d.b9Send.sent ? `<button id="btnB9Send" class="btn btn-orange" ${canAct ? '' : 'disabled'}>✉ NVKD Bấm Gửi cho Khách</button>` : `<span class="feedback-ok">✓ Đã gửi lúc ${escapeHTML(d.b9Send.sentAt)}</span>`}
        </div>
        ${d.b9Send.sent ? `
          <div class="input-row">
            <select id="b9OutcomeSel" class="filter-select">
              <option value="Chưa phản hồi">Chưa phản hồi (Nhắc sau ${d.b9Send.followUpDays} ngày)</option>
              <option value="Khách chấp nhận">Khách chấp nhận</option>
              <option value="Đang thương lượng">Đang thương lượng</option>
              <option value="Từ chối">Từ chối</option>
            </select>
            <button id="btnB9SaveOutcome" class="btn btn-light btn-sm">Cập nhật kết quả</button>
          </div>` : ''}
      </div>`;
  }

  return '';
}

function renderDetailPanel() {
  const panel = document.getElementById('detailPanel');
  const d = getSelectedDossier();
  if (!d) {
    panel.innerHTML = '<div class="empty-box">Chọn một hồ sơ ở cột bên trái để bắt đầu xử lý.</div>';
    return;
  }

  highlightWorkflowBoard(d);

  const company = d.b14Json?.company_name || d.b12?.cleanedFields?.company || 'Chưa rõ';
  const curIdx = STEP_ORDER.indexOf(d.currentStep);
  const completedSteps = STEP_ORDER.slice(0, Math.max(0, curIdx)).filter((s) => d.stepStatus[s] === 'DONE');

  const stepperChips = STEP_ORDER.map((s) => {
    const st = d.stepStatus[s];
    const cls = st === 'DONE' ? 'done' : (st === 'ACTIVE' ? 'active' : (st === 'INVALIDATED' ? 'invalid' : ''));
    return `<span class="zt-step-chip ${cls}">${s}</span>`;
  }).join('');

  const rollbackHtml = d.rollbackBanner ? `
    <div class="gatekeeper-banner" style="margin-top:12px;margin-bottom:0;">
      ↩ <strong>Hồ sơ bị trả lại bước ${escapeHTML(d.rollbackBanner.targetStep)}</strong> bởi ${escapeHTML(d.rollbackBanner.by)} — Lý do: ${escapeHTML(d.rollbackBanner.reason)}
    </div>` : '';

  const auditDrawerHtml = state.showAuditDrawer ? `
    <div class="collapsed-step-card" style="margin-bottom:12px;padding:12px 14px;">
      <strong style="font-size:12.5px;">Nhật ký Truy vết &amp; Lịch sử Phiên bản (Hiện tại: v${d.version})</strong>
      <div style="max-height:170px;overflow-y:auto;margin-top:8px;font-size:11.5px;">
        ${d.auditLog.map((l) => `<div><code>[${escapeHTML(l.time)} • ${escapeHTML(l.version)} • ${escapeHTML(l.step)}]</code> <strong>${escapeHTML(l.actorName)}:</strong> ${escapeHTML(l.action)} — ${escapeHTML(l.detail)}</div>`).join('')}
      </div>
    </div>` : '';

  panel.innerHTML = `
    <div class="detail-header">
      <div class="detail-title-row">
        <div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <h2>${escapeHTML(company)}</h2>
            <span class="opp-code-chip">${escapeHTML(d.opportunityId)} • v${d.version}</span>
            ${d.isVip ? '<span class="tag-vip">★ VIP</span>' : ''}
            ${d.isUrgent ? '<span class="tag-urgent">⚡ NGUY CẤP</span>' : ''}
          </div>
          <p class="detail-sub">Trạng thái: <strong>${escapeHTML(d.dashboardStatus)}</strong> • Phụ trách: ${escapeHTML(d.assignedNvkd)} • SLA: ${escapeHTML(d.slaDeadlineLabel)}</p>
        </div>
        <div style="text-align:right;">
          <button id="btnToggleAuditDrawer" class="btn btn-light btn-sm">📜 Nhật ký &amp; Phiên bản (${d.auditLog.length})</button>
        </div>
      </div>
      <div class="zt-stepper">${stepperChips}</div>
      ${rollbackHtml}
    </div>

    <div class="detail-content custom-scroll">
      ${auditDrawerHtml}
      <div class="step-accordion-list">
        ${completedSteps.map((s) => renderCollapsedSummary(s, d)).join('')}
        ${renderActiveStepCard(d)}
      </div>
    </div>`;

  bindDetailEvents(d);
}

function bindDetailEvents(d) {
  const panel = document.getElementById('detailPanel');

  panel.querySelector('#btnToggleAuditDrawer')?.addEventListener('click', () => {
    state.showAuditDrawer = !state.showAuditDrawer;
    renderDetailPanel();
  });

  panel.querySelectorAll('.btn-quick-switch-role').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.role = btn.dataset.role;
      updateRoleUI();
    });
  });

  panel.querySelectorAll('[data-toggle-step]').forEach((bar) => {
    bar.addEventListener('click', () => {
      const st = bar.dataset.toggleStep;
      state.expandedCollapsedSteps[d.opportunityId] = state.expandedCollapsedSteps[d.opportunityId] || {};
      state.expandedCollapsedSteps[d.opportunityId][st] = !state.expandedCollapsedSteps[d.opportunityId][st];
      renderDetailPanel();
    });
  });

  // Common Rollback
  panel.querySelector('#btnCommonRollback')?.addEventListener('click', () => {
    try {
      const target = panel.querySelector('#rollbackTargetSelect').value;
      const reason = panel.querySelector('#rollbackReasonInput').value;
      rollbackToStep(d, target, reason, getCurrentRoleObj().label, state.role);
      renderAll();
    } catch (err) { alert(err.message); }
  });

  // B1.2 Download .xlsx
  panel.querySelector('#btnDownloadB12Xlsx')?.addEventListener('click', () => {
    const f = d.b12.cleanedFields;
    downloadWorkbookAsXlsx([
      {
        name: 'Ban_Lam_Sach',
        rows: [
          ['Mã cơ hội', 'Công ty', 'Liên hệ', 'Ngân sách (VNĐ)', 'Deadline', '% CK', 'Ghi chú'],
          [d.opportunityId, f.company, f.contact, f.budgetVND || '', f.deadlineDisplay, f.requestedDiscountPct, f.notes]
        ]
      },
      {
        name: 'San_Pham_Yeu_Cau',
        rows: [['Tên sản phẩm', 'Số lượng'], ...f.products.map((p) => [p.name, p.qty])]
      }
    ], `${d.opportunityId}_Ban_Lam_Sach_v${d.version}.xlsx`);
  });

  // B1.3 Redo / Save / Approve
  panel.querySelector('#btnB13Redo')?.addEventListener('click', () => {
    const note = panel.querySelector('#b13RedoNote').value.trim();
    if (!note) return alert('Vui lòng nhập ghi chú để AI làm lại từ bản gốc.');
    redoB12CleanData(d, note, state.adminConfig, getCurrentRoleObj().label, state.notifications);
    renderAll();
  });

  const readB13Fields = () => {
    const comp = panel.querySelector('#b13Company')?.value.trim();
    const bud = Number(panel.querySelector('#b13Budget')?.value) || null;
    const dl = Number(panel.querySelector('#b13DeadlineDays')?.value) || null;
    return {
      ...d.b12.cleanedFields,
      company: comp || d.b12.cleanedFields.company,
      budgetVND: bud,
      budgetDisplay: bud ? formatVND(bud) : 'Chưa cung cấp',
      deadlineDays: dl,
      deadlineDisplay: dl ? `${dl} ngày` : d.b12.cleanedFields.deadlineDisplay
    };
  };

  panel.querySelector('#btnB13SaveEdit')?.addEventListener('click', () => {
    d.b12.cleanedFields = readB13Fields();
    d.version += 1;
    renderAll();
  });

  panel.querySelector('#btnB13Approve')?.addEventListener('click', () => {
    try {
      approveB13CleanData(d, readB13Fields(), state.adminConfig, getCurrentRoleObj().label, state.notifications);
      renderAll();
    } catch (err) { alert(err.message); }
  });

  // B1.4 Confirm JSON
  panel.querySelector('#btnB14Confirm')?.addEventListener('click', () => {
    const updated = {
      company_name: panel.querySelector('#b14Company').value.trim(),
      business_model: panel.querySelector('#b14Model').value.trim(),
      budget_vnd: Number(panel.querySelector('#b14Budget').value) || null,
      deadline_days: Number(panel.querySelector('#b14Deadline').value) || 7,
      requested_discount_pct: Number(panel.querySelector('#b14Discount').value) || 0
    };
    confirmB14Json(d, updated, getContext(), state.adminConfig, getCurrentRoleObj().label, state.notifications);
    renderAll();
  });

  // B3 Kho & NVKD
  panel.querySelector('#btnB3KhoSubmit')?.addEventListener('click', () => {
    try {
      const resolutions = {};
      panel.querySelectorAll('.kho-action-sel').forEach((sel) => {
        const lineId = sel.dataset.line;
        const act = sel.value;
        if (!act) return;
        const param = panel.querySelector(`.kho-param-inp[data-line="${lineId}"]`)?.value.trim() || '';
        if (act === 'PARTIAL') resolutions[lineId] = { action: 'PARTIAL', shipNow: parseInt(param, 10) || 1, shipLater: 10, wave2Date: 'Sau 14 ngày' };
        else if (act === 'SUBSTITUTE') resolutions[lineId] = { action: 'SUBSTITUTE', altSku: param || d.b2Audit.rows.find((r) => r.lineId === lineId)?.suggestions?.[0]?.sku };
        else if (act === 'REJECT') resolutions[lineId] = { action: 'REJECT', reason: param };
      });
      applyB3WarehouseResolution(d, resolutions, getContext(), state.adminConfig, getCurrentRoleObj().label, state.notifications);
      renderAll();
    } catch (err) { alert(err.message); }
  });

  panel.querySelector('#btnB3NvkdConfirm')?.addEventListener('click', () => {
    try {
      if (d.b3Warehouse.confirmedByKho) confirmB3AfterWarehouse(d, state.adminConfig, getCurrentRoleObj().label);
      else confirmB3AllGreen(d, state.adminConfig, getCurrentRoleObj().label);
      renderAll();
    } catch (err) { alert(err.message); }
  });

  // B4 Discount
  panel.querySelector('#btnB4Recalc')?.addEventListener('click', () => {
    const map = {};
    panel.querySelectorAll('.b4-req-price').forEach((inp) => {
      map[inp.dataset.line] = Number(inp.value) || 0;
    });
    computeB4Discount(d, map, state.adminConfig);
    renderAll();
  });

  panel.querySelector('#btnB4Pass')?.addEventListener('click', () => {
    try {
      passB4ToB6(d, state.adminConfig, getCurrentRoleObj().label);
      renderAll();
    } catch (err) { alert(err.message); }
  });

  panel.querySelector('#btnB4Escalate')?.addEventListener('click', () => {
    try {
      const reason = panel.querySelector('#b4EscReason').value;
      escalateB4ToB5(d, reason, state.adminConfig, getCurrentRoleObj().label, state.notifications);
      renderAll();
    } catch (err) { alert(err.message); }
  });

  // B5 Manager Approval
  panel.querySelector('#btnB5Approve')?.addEventListener('click', () => {
    try {
      applyB5Decision(d, 'APPROVE', { reason: panel.querySelector('#b5Reason').value }, state.adminConfig, getCurrentRoleObj().label, state.role, state.notifications);
      renderAll();
    } catch (err) { alert(err.message); }
  });
  panel.querySelector('#btnB5Cond')?.addEventListener('click', () => {
    try {
      applyB5Decision(d, 'CONDITIONAL', { maxPct: panel.querySelector('#b5CondPct').value, reason: panel.querySelector('#b5Reason').value }, state.adminConfig, getCurrentRoleObj().label, state.role, state.notifications);
      renderAll();
    } catch (err) { alert(err.message); }
  });
  panel.querySelector('#btnB5Reject')?.addEventListener('click', () => {
    try {
      applyB5Decision(d, 'REJECT', { reason: panel.querySelector('#b5Reason').value }, state.adminConfig, getCurrentRoleObj().label, state.role, state.notifications);
      renderAll();
    } catch (err) { alert(err.message); }
  });

  // B6 / B7 / B8 / B9 Download .xlsx
  panel.querySelector('#btnDownloadB6Xlsx')?.addEventListener('click', () => {
    if (d.b6Deliverables?.xlsxSheets) {
      downloadWorkbookAsXlsx(d.b6Deliverables.xlsxSheets, `${d.opportunityId}_BaoGia_v${d.version}.xlsx`);
    }
  });

  panel.querySelector('#btnB7SubmitDir')?.addEventListener('click', () => {
    const edited = panel.querySelector('#b7EmailEditor').value;
    const res = submitB7ToDirector(d, edited, state.adminConfig, getCurrentRoleObj().label, state.notifications);
    if (res.rolledBack) alert('Phát hiện thay đổi số tiền thanh toán trong Email! Hệ thống buộc quay lại Bước 4.');
    renderAll();
  });

  panel.querySelector('#btnB8Approve')?.addEventListener('click', () => {
    applyB8DirectorDecision(d, 'APPROVE', { reason: panel.querySelector('#b8NoteInput').value }, state.adminConfig, getCurrentRoleObj().label, state.notifications);
    renderAll();
  });
  panel.querySelector('#btnB8Return')?.addEventListener('click', () => {
    try {
      applyB8DirectorDecision(d, 'RETURN', {
        targetStep: panel.querySelector('#b8ReturnStep').value,
        reason: panel.querySelector('#b8NoteInput').value
      }, state.adminConfig, getCurrentRoleObj().label, state.notifications);
      renderAll();
    } catch (err) { alert(err.message); }
  });

  panel.querySelector('#btnB9Send')?.addEventListener('click', () => {
    sendB9ToCustomer(d, getCurrentRoleObj().label);
    renderAll();
  });
  panel.querySelector('#btnB9SaveOutcome')?.addEventListener('click', () => {
    const out = panel.querySelector('#b9OutcomeSel').value;
    recordB9Outcome(d, out, getCurrentRoleObj().label);
    renderAll();
  });
}

// =========================================================================
// GATEKEEPER .XLSX UPLOAD HANDLER
// =========================================================================
async function handleGatekeeperFileUpload(file, targetType, feedbackEl) {
  const banner = document.getElementById('gatekeeperBanner');
  if (banner) banner.style.display = 'none';

  const fmtCheck = validateGatekeeperSourceName(file.name);
  if (!fmtCheck.ok) {
    state.systemErrors.unshift(`[${new Date().toTimeString().slice(0, 8)}] Chặn tệp "${file.name}": ${GATEKEEPER_FORMAT_ERROR}`);
    pushNotification(state.notifications, {
      event: 'Lỗi Gatekeeper (.xlsx)',
      recipient: 'Admin & NVKD',
      oppId: 'SYSTEM',
      company: file.name,
      message: GATEKEEPER_FORMAT_ERROR,
      level: 'alert'
    });
    if (banner) {
      banner.textContent = `⛔ ${GATEKEEPER_FORMAT_ERROR}`;
      banner.style.display = 'block';
    }
    setFeedback(feedbackEl, GATEKEEPER_FORMAT_ERROR, true);
    renderNotifications();
    return;
  }

  try {
    const sheets = await parseUploadedFile(file);
    const check = validateGatekeeperSheets(sheets, targetType);
    if (!check.ok) {
      const errMsg = `⛔ Gatekeeper chặn tệp "${file.name}": ${check.errors.join(' | ')}`;
      state.systemErrors.unshift(errMsg);
      if (banner) { banner.textContent = errMsg; banner.style.display = 'block'; }
      setFeedback(feedbackEl, errMsg, true);
      return;
    }

    if (targetType === 'auto') {
      const c = classifyWorkbookSheets(sheets);
      if (c.products?.length) state.products = c.products;
      if (c.inventory?.length) state.inventory = c.inventory;
      if (c.policies?.length) state.policies = c.policies;
      if (c.requests?.length) state.requests = c.requests;
    } else if (targetType === 'products') state.products = mapProducts(sheets[0].rows);
    else if (targetType === 'inventory') state.inventory = mapInventory(sheets[0].rows);
    else if (targetType === 'policies') state.policies = mapPolicies(sheets[0].rows);
    else if (targetType === 'requests') state.requests = mapRequests(sheets[0].rows);

    updateDatasetCounts();
    setFeedback(feedbackEl, `✓ Gatekeeper chấp nhận "${file.name}" (${sheets.length} trang tính chuẩn .xlsx).`);
  } catch (err) {
    setFeedback(feedbackEl, err.message, true);
  }
}

function updateDatasetCounts() {
  document.getElementById('count-products').textContent = state.products.length;
  document.getElementById('count-inventory').textContent = state.inventory.length;
  document.getElementById('count-policies').textContent = state.policies.length;
  document.getElementById('count-requests').textContent = state.requests.length;
  renderDataPreview();
}

function renderDataPreview() {
  const key = document.getElementById('previewTableSelect')?.value || 'products';
  const rows = state[key] || [];
  const host = document.getElementById('dataPreviewContainer');
  if (!host) return;
  if (!rows.length) {
    host.innerHTML = '<div class="empty-box">Chưa có dữ liệu.</div>';
    return;
  }
  const cols = Object.keys(rows[0]).filter((k) => !k.startsWith('__'));
  host.innerHTML = `
    <table class="clean-table">
      <thead><tr>${cols.map((c) => `<th>${escapeHTML(c)}</th>`).join('')}</tr></thead>
      <tbody>${rows.slice(0, 15).map((r) => `<tr>${cols.map((c) => `<td>${escapeHTML(typeof r[c] === 'number' && /price|value|budget/i.test(c) ? formatVND(r[c]) : r[c])}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
}

function highlightWorkflowBoard(d) {
  const diag = document.getElementById('workflowDiagram');
  const lbl = document.getElementById('wfSelectedLabel');
  if (!diag) return;
  diag.querySelectorAll('.wf-node').forEach((n) => n.classList.remove('wf-active', 'wf-active-warn', 'wf-active-esc'));
  if (!d) return;
  if (lbl) lbl.textContent = `${d.opportunityId} — ${d.currentStep} (${d.dashboardStatus})`;
  const node = diag.querySelector(`[data-node="${d.currentStep}"]`);
  if (node) node.classList.add('wf-active');
}

function renderAdminPanel() {
  const isAdmin = state.role === 'ADMIN';
  const msg = document.getElementById('adminRoleLockMsg');
  const btn = document.getElementById('btnSaveAdminConfig');
  if (msg) msg.textContent = isAdmin ? '✓ Bạn đang đăng nhập với quyền Admin — được phép sửa cấu hình hệ thống.' : '🔒 Chỉ vai trò Admin mới được chỉnh sửa cấu hình hạn mức & SLA.';
  if (btn) btn.disabled = !isAdmin;
  ['cfgNvkdLimit', 'cfgHardLimit', 'cfgVipThreshold', 'cfgUrgentKeywords', 'cfgMaxReject', 'cfgFollowUpDays'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !isAdmin;
  });
  const errEl = document.getElementById('systemErrorLogList');
  if (errEl) {
    errEl.innerHTML = state.systemErrors.length
      ? state.systemErrors.map((e) => `<div class="sys-err-row">${escapeHTML(e)}</div>`).join('')
      : 'Chưa có lỗi hệ thống nào.';
  }
}

function renderAll() {
  renderKPIs();
  renderPipelineChart();
  renderInboxList();
  renderDetailPanel();
  renderNotifications();
  renderAdminPanel();
}

function initEvents() {
  // Hero navigation
  document.getElementById('heroBtnStart')?.addEventListener('click', () => scrollToWorkspace('inventory'));
  document.getElementById('heroBtnResults')?.addEventListener('click', () => scrollToWorkspace('workspace'));
  document.getElementById('heroScrollCue')?.addEventListener('click', (e) => { e.preventDefault(); scrollToWorkspace('workspace'); });
  document.querySelectorAll('[data-jump-view]').forEach((link) => {
    link.addEventListener('click', (e) => { e.preventDefault(); scrollToWorkspace(link.dataset.jumpView); });
  });
  document.getElementById('btnScrollToHero')?.addEventListener('click', () => {
    document.getElementById('heroLanding')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Sidebar & Modal
  document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
  document.getElementById('navOpenIntakeModal')?.addEventListener('click', openIntakeModal);
  document.getElementById('btnOpenIntake')?.addEventListener('click', openIntakeModal);
  document.getElementById('btnCloseIntake')?.addEventListener('click', closeIntakeModal);
  document.getElementById('intakeModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'intakeModal') closeIntakeModal();
  });

  // PDF Guru Dropzone Mode Toggle & Drag-and-Drop
  document.getElementById('brandHomeBtn')?.addEventListener('click', () => switchView('intake-home'));
  document.getElementById('btnGoToWorkspace')?.addEventListener('click', () => switchView('workspace'));
  document.querySelectorAll('[data-jump-view]').forEach((el) => {
    el.addEventListener('click', () => {
      switchView(el.dataset.jumpView);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  document.querySelectorAll('.pg-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.dropMode;
      document.querySelectorAll('.pg-mode-btn').forEach((b) => b.classList.toggle('active', b === btn));
      document.getElementById('dropModeText')?.classList.toggle('active', mode === 'text');
      document.getElementById('dropModeFile')?.classList.toggle('active', mode === 'file');
    });
  });

  const dz = document.getElementById('heroDropzone');
  if (dz) {
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        handleGatekeeperFileUpload(
          file,
          document.getElementById('quickFileTarget')?.value || 'auto',
          document.getElementById('quickIngestFeedback')
        );
      }
    });
  }

  // Role Switcher
  document.getElementById('roleSelector')?.addEventListener('change', (e) => {
    state.role = e.target.value;
    updateRoleUI();
  });

  // Notifications
  document.getElementById('notifBellBtn')?.addEventListener('click', () => {
    document.getElementById('notifDropdown')?.classList.toggle('open');
  });
  document.getElementById('btnMarkAllRead')?.addEventListener('click', () => {
    state.notifications.forEach((n) => { n.read = true; });
    renderNotifications();
  });

  // Search & Filters
  document.getElementById('globalSearchInput')?.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderPipelineChart();
    renderInboxList();
  });
  const syncFilterPills = (val) => {
    document.querySelectorAll('#chartFilterPills .pill-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.filter === val);
    });
  };
  document.getElementById('filterStatus')?.addEventListener('change', (e) => {
    state.filterStatus = e.target.value;
    syncFilterPills(state.filterStatus);
    renderPipelineChart();
    renderInboxList();
  });
  document.querySelectorAll('#chartFilterPills .pill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filterStatus = btn.dataset.filter || 'ALL';
      const sel = document.getElementById('filterStatus');
      if (sel) sel.value = state.filterStatus;
      syncFilterPills(state.filterStatus);
      renderPipelineChart();
      renderInboxList();
    });
  });

  // Intake New Request (B1.1 -> B1.2)
  document.getElementById('presetScenarioSelect')?.addEventListener('change', (e) => {
    const idx = e.target.value;
    if (idx !== '' && SAMPLE_REQUESTS[idx]) {
      document.getElementById('singleRequestInput').value = SAMPLE_REQUESTS[idx].rawText;
    }
  });

  document.getElementById('btnRunSingle')?.addEventListener('click', () => {
    const text = document.getElementById('singleRequestInput').value.trim();
    const fb = document.getElementById('quickIngestFeedback');
    if (!text) return setFeedback(fb, 'Vui lòng nhập nội dung yêu cầu trước.', true);
    const reqObj = { id: `OPP-${1050 + state.dossiers.length}`, channel: 'Email/Form', rawText: text };
    const newDossier = createInitialDossier(reqObj, getContext(), state.adminConfig, state.notifications);
    state.dossiers = [newDossier, ...state.dossiers];
    state.selectedOppId = newDossier.opportunityId;
    closeIntakeModal();
    switchView('workspace');
    renderAll();
  });

  // Gatekeeper File Uploads
  document.getElementById('quickFileInput')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    handleGatekeeperFileUpload(file, document.getElementById('quickFileTarget').value, document.getElementById('quickIngestFeedback'));
  });
  document.querySelectorAll('.ds-file').forEach((inp) => {
    inp.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) handleGatekeeperFileUpload(file, inp.dataset.target, null);
    });
  });
  document.getElementById('previewTableSelect')?.addEventListener('change', renderDataPreview);
  document.getElementById('btnLoadDemoAll')?.addEventListener('click', () => {
    state.products = [...SAMPLE_PRODUCTS];
    state.inventory = [...SAMPLE_INVENTORY];
    state.policies = [...SAMPLE_POLICIES];
    state.salesTeam = [...SAMPLE_SALES_TEAM];
    state.requests = [...SAMPLE_REQUESTS];
    const b = document.getElementById('gatekeeperBanner');
    if (b) b.style.display = 'none';
    updateDatasetCounts();
  });

  // Admin Save
  document.getElementById('btnSaveAdminConfig')?.addEventListener('click', () => {
    if (state.role !== 'ADMIN') return;
    state.adminConfig.nvkdDiscountLimitPct = Number(document.getElementById('cfgNvkdLimit').value) || 10;
    state.adminConfig.hardDiscountLimitPct = Number(document.getElementById('cfgHardLimit').value) || 15;
    state.adminConfig.vipThresholdVND = Number(document.getElementById('cfgVipThreshold').value) || 10_000_000_000;
    state.adminConfig.urgentKeywords = document.getElementById('cfgUrgentKeywords').value.split(',').map((s) => s.trim()).filter(Boolean);
    state.adminConfig.maxRejectRounds = Number(document.getElementById('cfgMaxReject').value) || 3;
    state.adminConfig.followUpDays = Number(document.getElementById('cfgFollowUpDays').value) || 3;
    setFeedback(document.getElementById('adminSaveFeedback'), '✓ Đã lưu cấu hình Admin mới.');
  });

  // Test LLM
  document.getElementById('btnTestLLM')?.addEventListener('click', async () => {
    const fb = document.getElementById('llmTestFeedback');
    setFeedback(fb, 'Đang kiểm tra kết nối Gemini API...');
    try {
      const res = await fetch('/api/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Trả lời đúng 2 chữ: Kết nối OK.', temperature: 0.1 })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Lỗi API');
      setFeedback(fb, `✓ Kết nối thành công (${data.model}): "${data.text}"`);
    } catch (err) {
      setFeedback(fb, err.message, true);
    }
  });

  // Export CSV / JSON
  document.getElementById('btnExportCSV')?.addEventListener('click', () => {
    const lines = ['OpportunityID,Company,Step,Status,Version,ValueVND'];
    for (const d of state.dossiers) {
      lines.push([d.opportunityId, `"${d.b14Json?.company_name || d.b12?.cleanedFields?.company || ''}"`, d.currentStep, `"${d.dashboardStatus}"`, `v${d.version}`, getDossierValueVND(d)].join(','));
    }
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'minhan_zerotrust_dossiers.csv';
    a.click();
  });

  document.getElementById('btnTestDownloadB6Report')?.addEventListener('click', () => {
    const sel = getSelectedDossier();
    if (sel?.b6Deliverables?.xlsxSheets) {
      downloadWorkbookAsXlsx(sel.b6Deliverables.xlsxSheets, `${sel.opportunityId}_BaoCao_B6_v${sel.version}.xlsx`);
      return;
    }
    // Build a complete 5-sheet sample B6 report from SAMPLE_REQUESTS[1]
    const ctx = getContext();
    const tmp = createInitialDossier(SAMPLE_REQUESTS[1], ctx, state.adminConfig, []);
    approveB13CleanData(tmp, null, state.adminConfig, 'Nguyễn Văn A', []);
    confirmB14Json(tmp, {}, ctx, state.adminConfig, 'Nguyễn Văn A', []);
    if (tmp.b2Audit.hasYellowOrRed) {
      const resMap = {};
      for (const r of tmp.b2Audit.rows) {
        if (r.color !== 'GREEN') resMap[r.lineId] = { action: 'PARTIAL', shipNow: 1, shipLater: 1, wave2Date: 'Sau 7 ngày' };
      }
      applyB3WarehouseResolution(tmp, resMap, ctx, state.adminConfig, 'Phạm Văn Kho', []);
      confirmB3AfterWarehouse(tmp, state.adminConfig, 'Nguyễn Văn A');
    } else {
      confirmB3AllGreen(tmp, state.adminConfig, 'Nguyễn Văn A');
    }
    runB6Generate(tmp, state.adminConfig, 'Advisor Agent');
    downloadWorkbookAsXlsx(tmp.b6Deliverables.xlsxSheets, `${tmp.opportunityId}_BaoCao_B6_Mau.xlsx`);
  });

  document.getElementById('btnExportJSON')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state.dossiers, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'minhan_zerotrust_dossiers.json';
    a.click();
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  initEvents();
  await checkServerHealth();
  updateDatasetCounts();
  bootstrapSampleDossiers();
});
