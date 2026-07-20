/* ════════════════════════════════════════════════════════════
   تقرير إغلاق يومية المندوب — rep-daily-closing.js
   يصدّر: renderRepDailyClosing(container)

   محسوب مباشرة من بيانات سلطان الحقيقية (نفس فلسفة rep-visits.js
   rvRenderGoalsPage) — مفيش جدول تاريخي لحالة خزنة المندوب لحظة بلحظة،
   فـ"المخزون المتبقي بالعربية" هو الرصيد الحالي (مش صورة تاريخية دقيقة
   ليوم معيّن)، و"مطابقة الكاش" تقدير مبني على حركات نفس اليوم فقط
   (مبيعات نقدي + تحصيل − مصروفات − توريد)، موضّح فى الشاشة نفسها.

   جدول ملخص لكل المندوبين + تفاصيل مندوب واحد (RDC_SELECTED_REP).
   ════════════════════════════════════════════════════════════ */

let RDC_DATE = new Date().toISOString().slice(0, 10);
let RDC_SELECTED_REP = null; // null = ملخص كل المندوبين
let RDC_REPS = [];
let RDC_AGG = {}; // repId => { salesCash, salesCredit, salesCount, collections, expenses, returns, deposits, visitsPlanned, visitsDone, visitsSkipped, vanStockValue }
let RDC_DETAIL = { sales: [], payments: [], expenses: [], returns: [] }; // تفاصيل خام لمندوب اليوم المختار (للعرض التفصيلي)
let RDC_TREASURY_BAL = {}; // treasury_id => الرصيد الحالي

function rdcFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function renderRepDailyClosing(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات الإغلاق...</div>';
    try {
        await rdcLoad();
        if (RDC_SELECTED_REP) rdcRenderDetail(c);
        else rdcRenderSummary(c);
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

async function rdcLoad() {
    const dayStart = RDC_DATE;
    const dayEnd = new Date(new Date(RDC_DATE + 'T00:00:00').getTime() + 86400000).toISOString().slice(0, 10);

    const [
        { data: reps },
        { data: sales },
        { data: payments },
        { data: expenses },
        { data: returns },
        { data: deposits },
        { data: visits },
        { data: vanStock },
        { data: treasuryBalances },
    ] = await Promise.all([
        sb.from('sales_reps').select('id,name,treasury_id').eq('is_active', true).order('name'),
        sb.from('sales').select('id,invoice_no,rep_id,total,payment_type,customer_id,customers(name),created_at')
            .eq('status', 'confirmed').not('rep_id', 'is', null).gte('created_at', dayStart).lt('created_at', dayEnd),
        sb.from('customer_payments').select('id,ref,created_by,amount,customer_id,customers(name),created_at')
            .eq('status', 'confirmed').gte('created_at', dayStart).lt('created_at', dayEnd),
        sb.from('expenses').select('id,created_by,amount,description,expense_categories(name),expense_date')
            .eq('status', 'confirmed').gte('expense_date', dayStart).lt('expense_date', dayEnd),
        sb.from('sales_returns').select('id,return_no,rep_id,total,customer_id,customers(name),created_at')
            .eq('status', 'confirmed').not('rep_id', 'is', null).gte('created_at', dayStart).lt('created_at', dayEnd),
        sb.from('treasury_transfers').select('from_treasury_id,to_treasury_id,amount,created_at')
            .gte('created_at', dayStart).lt('created_at', dayEnd),
        sb.from('rep_visits').select('rep_id,status').eq('visit_date', RDC_DATE),
        sb.from('van_stock').select('rep_id,qty,products(purchase_price)'),
        sb.rpc('get_treasury_balances'),
    ]);

    RDC_REPS = reps || [];
    const repIds = new Set(RDC_REPS.map(r => r.id));
    const repByTreasury = {};
    RDC_REPS.forEach(r => { if (r.treasury_id) repByTreasury[r.treasury_id] = r.id; });

    const ensure = id => RDC_AGG[id] = RDC_AGG[id] || {
        salesCash: 0, salesCredit: 0, salesCount: 0, collections: 0, expenses: 0,
        returns: 0, deposits: 0, visitsPlanned: 0, visitsDone: 0, visitsSkipped: 0, vanStockValue: 0,
    };
    RDC_AGG = {};
    RDC_REPS.forEach(r => ensure(r.id));

    (sales || []).forEach(s => {
        const b = ensure(s.rep_id);
        if (s.payment_type === 'cash') b.salesCash += Number(s.total) || 0; else b.salesCredit += Number(s.total) || 0;
        b.salesCount++;
    });
    (payments || []).forEach(p => { if (repIds.has(p.created_by)) ensure(p.created_by).collections += Number(p.amount) || 0; });
    (expenses || []).forEach(e => { if (repIds.has(e.created_by)) ensure(e.created_by).expenses += Number(e.amount) || 0; });
    (returns || []).forEach(r => ensure(r.rep_id).returns += Number(r.total) || 0);
    (deposits || []).forEach(t => { const repId = repByTreasury[t.from_treasury_id]; if (repId) ensure(repId).deposits += Number(t.amount) || 0; });
    (visits || []).forEach(v => {
        const b = ensure(v.rep_id);
        if (v.status === 'visited') b.visitsDone++; else if (v.status === 'skipped') b.visitsSkipped++; else b.visitsPlanned++;
    });
    (vanStock || []).forEach(v => { ensure(v.rep_id).vanStockValue += (Number(v.qty) || 0) * Number(v.products?.purchase_price || 0); });

    RDC_TREASURY_BAL = {};
    (treasuryBalances || []).forEach(t => { RDC_TREASURY_BAL[t.treasury_id] = Number(t.balance) || 0; });

    // تفاصيل خام (للعرض التفصيلي لمندوب واحد بس — بيتفلتر وقت العرض)
    RDC_DETAIL = { sales: sales || [], payments: payments || [], expenses: expenses || [], returns: returns || [] };
}

function rdcCashCheck(b) { return b.salesCash + b.collections - b.expenses - b.deposits; }

function rdcDateBarHTML() {
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
        <h2 style="font-size:20px;font-weight:800;margin:0">📊 تقرير إغلاق يومية المندوب</h2>
        <input type="date" id="rdcDate" class="mod-form-input" style="margin:0;width:auto" value="${RDC_DATE}" onchange="rdcOnDateChange(this.value)">
    </div>`;
}

function rdcRenderSummary(c) {
    if (!RDC_REPS.length) {
        c.innerHTML = rdcDateBarHTML() + `<div class="empty-state"><span>🚗</span>مفيش مندوبين نشطين لسه</div>`;
        return;
    }
    c.innerHTML = `
    ${rdcDateBarHTML()}
    <div class="mod-table-wrap">
        <table class="mod-table"><thead><tr>
            <th>المندوب</th>
            <th style="text-align:left">مبيعات نقدي</th>
            <th style="text-align:left">مبيعات آجل</th>
            <th style="text-align:center">فواتير</th>
            <th style="text-align:left">تحصيل</th>
            <th style="text-align:left">مصروفات</th>
            <th style="text-align:left">مرتجعات</th>
            <th style="text-align:left">توريد</th>
            <th style="text-align:left">مطابقة الكاش</th>
            <th style="text-align:center">زيارات</th>
            <th style="text-align:left">مخزون العربية</th>
            <th></th>
        </tr></thead>
        <tbody>
            ${RDC_REPS.map(r => {
                const b = RDC_AGG[r.id];
                const check = rdcCashCheck(b);
                const checkColor = Math.abs(check) < 0.01 ? '#059669' : Math.abs(check) < 100 ? '#D97706' : '#DC2626';
                const visitsTxt = `${b.visitsDone}✅ ${b.visitsSkipped}❌ ${b.visitsPlanned}⏳`;
                return `<tr>
                    <td><strong>🚗 ${r.name}</strong></td>
                    <td style="text-align:left">${rdcFmt(b.salesCash)}</td>
                    <td style="text-align:left">${rdcFmt(b.salesCredit)}</td>
                    <td style="text-align:center">${b.salesCount}</td>
                    <td style="text-align:left;color:#059669">${rdcFmt(b.collections)}</td>
                    <td style="text-align:left;color:#DC2626">${rdcFmt(b.expenses)}</td>
                    <td style="text-align:left;color:#D97706">${rdcFmt(b.returns)}</td>
                    <td style="text-align:left">${rdcFmt(b.deposits)}</td>
                    <td style="text-align:left;font-weight:700;color:${checkColor}">${rdcFmt(check)}</td>
                    <td style="text-align:center;font-size:11.5px;white-space:nowrap">${visitsTxt}</td>
                    <td style="text-align:left">${rdcFmt(b.vanStockValue)}</td>
                    <td><button class="cc-edit" onclick="rdcOpenDetail('${r.id}')">🔍 التفاصيل</button></td>
                </tr>`;
            }).join('')}
        </tbody></table>
    </div>
    <div style="font-size:11.5px;color:#94A3B8;margin-top:10px;line-height:1.7">
        ⚠️ "مطابقة الكاش" = مبيعات نقدي + تحصيل − مصروفات − توريد لنشاط اليوم ده بس (مش رصيد الخزنة التراكمي) — القيمة المفروض تقرب من صفر لو المندوب ورّد كل كاش النهاردة.
        "مخزون العربية" هو الرصيد الحالي لحظة فتح التقرير، مش صورة تاريخية ليوم معيّن (مفيش سجل حركة مخزون تاريخي متاح).
    </div>`;
}

window.rdcOpenDetail = function (repId) {
    RDC_SELECTED_REP = repId;
    rdcRenderDetail(document.getElementById('repMgmtBody') || document.getElementById('app-content'));
};

window.rdcBackToSummary = function () {
    RDC_SELECTED_REP = null;
    rdcRenderSummary(document.getElementById('repMgmtBody') || document.getElementById('app-content'));
};

window.rdcOnDetailRepChange = function (repId) {
    RDC_SELECTED_REP = repId;
    rdcRenderDetail(document.getElementById('repMgmtBody') || document.getElementById('app-content'));
};

function rdcRenderDetail(c) {
    const rep = RDC_REPS.find(r => r.id === RDC_SELECTED_REP);
    if (!rep) { RDC_SELECTED_REP = null; rdcRenderSummary(c); return; }
    const b = RDC_AGG[rep.id];
    const check = rdcCashCheck(b);
    const checkColor = Math.abs(check) < 0.01 ? '#059669' : Math.abs(check) < 100 ? '#D97706' : '#DC2626';
    const treasuryBal = rep.treasury_id != null ? RDC_TREASURY_BAL[rep.treasury_id] : null;

    const daySales = RDC_DETAIL.sales.filter(s => s.rep_id === rep.id);
    const dayPayments = RDC_DETAIL.payments.filter(p => p.created_by === rep.id);
    const dayExpenses = RDC_DETAIL.expenses.filter(e => e.created_by === rep.id);
    const dayReturns = RDC_DETAIL.returns.filter(r => r.rep_id === rep.id);

    const listCard = (title, rows, emptyTxt) => `
        <div class="mod-card" style="margin-bottom:14px">
            <div style="font-weight:800;font-size:13.5px;color:#1E293B;margin-bottom:8px">${title}</div>
            ${rows.length ? rows.join('') : `<p style="font-size:12px;color:#94A3B8;margin:0">${emptyTxt}</p>`}
        </div>`;
    const row = (label, amt, color) => `<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:4px 0;border-bottom:1px solid #F1F5F9">
        <span style="color:#475569">${label}</span><span style="font-weight:700;color:${color||'#0F172A'}">${rdcFmt(amt)}</span>
    </div>`;

    c.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
        <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="rdcBackToSummary()">→ رجوع للملخص</button>
        <h2 style="font-size:20px;font-weight:800;margin:0">🚗 ${rep.name} — ${RDC_DATE}</h2>
        <select class="mod-form-input" style="width:auto;margin:0" onchange="rdcOnDetailRepChange(this.value)">
            ${RDC_REPS.map(r => `<option value="${r.id}" ${r.id === rep.id ? 'selected' : ''}>🚗 ${r.name}</option>`).join('')}
        </select>
        <input type="date" id="rdcDate" class="mod-form-input" style="margin:0;width:auto" value="${RDC_DATE}" onchange="rdcOnDateChange(this.value)">
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin-bottom:16px">
        <div class="mod-card">
            <div style="font-size:12px;color:#64748B;margin-bottom:6px">💰 مبيعات نقدي / آجل</div>
            <div style="font-size:18px;font-weight:800">${rdcFmt(b.salesCash)} <small style="color:#94A3B8;font-size:12px">/ ${rdcFmt(b.salesCredit)}</small></div>
            <div style="font-size:11px;color:#94A3B8">${b.salesCount} فاتورة</div>
        </div>
        <div class="mod-card">
            <div style="font-size:12px;color:#64748B;margin-bottom:6px">💵 تحصيل من عملاء</div>
            <div style="font-size:18px;font-weight:800;color:#059669">${rdcFmt(b.collections)}</div>
        </div>
        <div class="mod-card">
            <div style="font-size:12px;color:#64748B;margin-bottom:6px">💸 مصروفات</div>
            <div style="font-size:18px;font-weight:800;color:#DC2626">${rdcFmt(b.expenses)}</div>
        </div>
        <div class="mod-card">
            <div style="font-size:12px;color:#64748B;margin-bottom:6px">↩️ مرتجعات</div>
            <div style="font-size:18px;font-weight:800;color:#D97706">${rdcFmt(b.returns)}</div>
        </div>
        <div class="mod-card">
            <div style="font-size:12px;color:#64748B;margin-bottom:6px">🏦 توريد للخزنة الرئيسية</div>
            <div style="font-size:18px;font-weight:800">${rdcFmt(b.deposits)}</div>
        </div>
        <div class="mod-card">
            <div style="font-size:12px;color:#64748B;margin-bottom:6px">✅ مطابقة الكاش (نشاط اليوم)</div>
            <div style="font-size:18px;font-weight:800;color:${checkColor}">${rdcFmt(check)}</div>
            ${treasuryBal != null ? `<div style="font-size:11px;color:#94A3B8">رصيد خزنته الحالي: ${rdcFmt(treasuryBal)}</div>` : ''}
        </div>
        <div class="mod-card">
            <div style="font-size:12px;color:#64748B;margin-bottom:6px">🗺️ الزيارات</div>
            <div style="font-size:15px;font-weight:800">✅ ${b.visitsDone} &nbsp; ❌ ${b.visitsSkipped} &nbsp; ⏳ ${b.visitsPlanned}</div>
        </div>
        <div class="mod-card">
            <div style="font-size:12px;color:#64748B;margin-bottom:6px">📦 مخزون العربية الحالي</div>
            <div style="font-size:18px;font-weight:800">${rdcFmt(b.vanStockValue)}</div>
        </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        ${listCard('🧾 فواتير اليوم', daySales.map(s => row(`${s.invoice_no} — ${s.customers?.name || 'نقدي'}`, s.total, s.payment_type === 'cash' ? '#059669' : '#D97706')), 'مفيش فواتير')}
        ${listCard('💵 تحصيلات اليوم', dayPayments.map(p => row(`${p.ref || '—'} — ${p.customers?.name || '—'}`, p.amount, '#059669')), 'مفيش تحصيلات')}
        ${listCard('💸 مصروفات اليوم', dayExpenses.map(e => row(`${e.expense_categories?.name || '—'} — ${e.description || ''}`, e.amount, '#DC2626')), 'مفيش مصروفات')}
        ${listCard('↩️ مرتجعات اليوم', dayReturns.map(r => row(`${r.return_no} — ${r.customers?.name || '—'}`, r.total, '#D97706')), 'مفيش مرتجعات')}
    </div>`;
}

window.rdcOnDateChange = async function (val) {
    RDC_DATE = val;
    const c = document.getElementById('repMgmtBody') || document.getElementById('app-content');
    await renderRepDailyClosing(c);
};

Object.assign(window, { renderRepDailyClosing, rdcOpenDetail, rdcBackToSummary, rdcOnDetailRepChange, rdcOnDateChange });
