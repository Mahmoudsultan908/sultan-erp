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

// ★ dStr/dNextDay بيبنوا السترينج من مكوّنات التاريخ المحلي مباشرة، مش
//   عن طريق toISOString() (بيحوّل لتوقيت UTC) — نفس الباج اتصلح قبل كده
//   فى performance-reports.js وreports.js. هنا كان أخطر: dayEnd كان بيطلع
//   يساوي dayStart بالظبط (منتصف الليل بتوقيت القاهرة UTC+3 بعد إضافة 24
//   ساعة وتحويلها لـUTC بيرجع لنفس تاريخ اليوم)، فالفلتر gte/lt كان بيبقى
//   مدى فاضي دايمًا — التقرير كان بيرجّع صفر لكل مندوب فى كل يوم من غير
//   استثناء، من أول ما اتبنى.
function dStr(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function dNextDay(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return dStr(new Date(y, m - 1, d + 1));
}

let RDC_DATE = dStr(new Date());
let RDC_SELECTED_REP = null; // null = ملخص كل المندوبين
let RDC_REPS = [];
let RDC_AGG = {}; // repId => { salesCash, salesCredit, salesCount, collections, expenses, returns, deposits, visitsPlanned, visitsDone, visitsSkipped, vanStockValue }
let RDC_DETAIL = { sales: [], payments: [], expenses: [], returns: [] }; // تفاصيل خام لمندوب اليوم المختار (للعرض التفصيلي)
let RDC_TREASURY_BAL = {}; // treasury_id => الرصيد الحالي
let RDC_CLOSINGS = {}; // repId => صف rep_day_closings (لو المندوب قفل يومه من تليفونه) أو undefined لو لسه مقفلش

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
    const dayEnd = dNextDay(RDC_DATE);

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
        { data: closings },
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
        sb.from('rep_day_closings').select('*').eq('close_date', RDC_DATE),
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

    RDC_CLOSINGS = {};
    (closings || []).forEach(cl => { RDC_CLOSINGS[cl.rep_id] = cl; });

    // تفاصيل خام (للعرض التفصيلي لمندوب واحد بس — بيتفلتر وقت العرض)
    RDC_DETAIL = { sales: sales || [], payments: payments || [], expenses: expenses || [], returns: returns || [] };
}

function rdcCashCheck(b) { return b.salesCash + b.collections - b.expenses - b.deposits; }

// حالة إغلاق اليوم بتيجي من rep_day_closings — إما المندوب قفلها من تليفونه
// (شاشة إغلاق اليوم فى تطبيق سلطانو) أو الأدمن قفلها من هنا يدويًا لو
// المندوب لسه ما قفلش (rdcOpenCloseModal تحت). لو الصف مش موجود يبقى
// لسه محدش قفل يوم المندوب ده.
function rdcClosingBadge(repId) {
    const cl = RDC_CLOSINGS[repId];
    if (!cl) return `<span style="font-size:11px;color:var(--inv-muted-light)">⏳ مفتوح</span> <button class="cc-edit" style="padding:2px 8px;font-size:11px" onclick="rdcOpenCloseModal('${repId}')">🌙 إغلاق</button>`;
    const diffOk = Math.abs(Number(cl.diff) || 0) < 0.01;
    return `<span style="font-size:11px;font-weight:700;color:${diffOk ? 'var(--inv-green)' : 'var(--inv-red)'}">🌙 مقفول${diffOk ? '' : ' (فرق ' + rdcFmt(cl.diff) + ')'}</span>`;
}

// إغلاق اليوم يدويًا من الأدمن — نفس فكرة زرار إغلاق اليوم اللي عند
// المندوب على تليفونه بالظبط (كاش متوقع محسوب من حركة اليوم، والأدمن
// بيدخل الكاش الفعلي اللي استلمه)، لكن من جوه الـERP مباشرة لحالات
// زي: المندوب نسي يقفل من تليفونه، أو تليفونه أوفلاين.
window.rdcOpenCloseModal = function (repId) {
    const rep = RDC_REPS.find(r => r.id === repId);
    const b = RDC_AGG[repId];
    if (!rep || !b) return;
    const expected = rdcCashCheck(b);
    document.getElementById('rdcCloseModal')?.remove();
    const m = document.createElement('div');
    m.id = 'rdcCloseModal';
    m.className = 'mod-modal-bg active';
    m.innerHTML = `
    <div class="mod-modal" style="max-width:420px">
        <div class="mod-modal-header"><h3>🌙 إغلاق يوم ${rep.name} — ${RDC_DATE}</h3>
            <button class="mod-modal-close" onclick="document.getElementById('rdcCloseModal').remove()">✕</button></div>
        <div class="mod-modal-body">
            <div style="font-size:13px;color:var(--inv-muted);margin-bottom:12px">الكاش المتوقع من حركة اليوم (نقدي + تحصيل − مصروفات − توريد):</div>
            <div style="font-size:20px;font-weight:800;margin-bottom:14px">${rdcFmt(expected)}</div>
            <label style="font-size:13px;font-weight:700;color:var(--inv-navy-light)">الكاش الفعلي اللي المندوب سلّمه</label>
            <input type="number" id="rdcCloseActual" class="mod-form-input" value="${expected.toFixed(2)}" oninput="rdcUpdateCloseDiff(${expected})">
            <div id="rdcCloseDiff" style="font-size:13px;font-weight:700;margin-top:8px;color:var(--inv-green)">الفرق: 0.00</div>
        </div>
        <div class="mod-modal-footer">
            <button class="inv-btn inv-btn-print" onclick="document.getElementById('rdcCloseModal').remove()">إلغاء</button>
            <button class="inv-btn inv-btn-save" onclick="rdcConfirmClose('${repId}', ${expected})">🌙 إغلاق اليوم</button>
        </div>
    </div>`;
    document.body.appendChild(m);
};

window.rdcUpdateCloseDiff = function (expected) {
    const actual = parseFloat(document.getElementById('rdcCloseActual')?.value) || 0;
    const diff = actual - expected;
    const el = document.getElementById('rdcCloseDiff');
    if (el) { el.textContent = `الفرق: ${rdcFmt(diff)}`; el.style.color = Math.abs(diff) < 0.01 ? 'var(--inv-green)' : 'var(--inv-red)'; }
};

window.rdcConfirmClose = async function (repId, expected) {
    const actual = parseFloat(document.getElementById('rdcCloseActual')?.value) || 0;
    const b = RDC_AGG[repId];
    try {
        const { error } = await sb.from('rep_day_closings').upsert({
            rep_id: repId, close_date: RDC_DATE,
            expected_cash: expected, actual_cash: actual, diff: actual - expected,
            total_sales: b.salesCash + b.salesCredit, total_cash: b.salesCash, total_debt: b.salesCredit,
            total_collect: b.collections, total_returns: b.returns, total_expenses: b.expenses,
            total_deposits: b.deposits, visits: b.visitsDone + b.visitsSkipped + b.visitsPlanned, sold_visits: b.visitsDone,
            closed_at: new Date().toISOString(),
        }, { onConflict: 'rep_id,close_date' });
        if (error) throw error;
        document.getElementById('rdcCloseModal')?.remove();
        await renderRepDailyClosing(document.getElementById('repMgmtBody') || document.getElementById('app-content'));
    } catch (err) {
        alert('خطأ: ' + err.message);
    }
};

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
            <th style="text-align:center">الإغلاق</th>
            <th></th>
        </tr></thead>
        <tbody>
            ${RDC_REPS.map(r => {
                const b = RDC_AGG[r.id];
                const check = rdcCashCheck(b);
                const checkColor = Math.abs(check) < 0.01 ? 'var(--inv-green)' : Math.abs(check) < 100 ? 'var(--inv-gold)' : 'var(--inv-red)';
                const visitsTxt = `${b.visitsDone}✅ ${b.visitsSkipped}❌ ${b.visitsPlanned}⏳`;
                return `<tr>
                    <td><strong>🚗 ${r.name}</strong></td>
                    <td style="text-align:left">${rdcFmt(b.salesCash)}</td>
                    <td style="text-align:left">${rdcFmt(b.salesCredit)}</td>
                    <td style="text-align:center">${b.salesCount}</td>
                    <td style="text-align:left;color:var(--inv-green)">${rdcFmt(b.collections)}</td>
                    <td style="text-align:left;color:var(--inv-red)">${rdcFmt(b.expenses)}</td>
                    <td style="text-align:left;color:var(--inv-gold)">${rdcFmt(b.returns)}</td>
                    <td style="text-align:left">${rdcFmt(b.deposits)}</td>
                    <td style="text-align:left;font-weight:700;color:${checkColor}">${rdcFmt(check)}</td>
                    <td style="text-align:center;font-size:11.5px;white-space:nowrap">${visitsTxt}</td>
                    <td style="text-align:left">${rdcFmt(b.vanStockValue)}</td>
                    <td style="text-align:center">${rdcClosingBadge(r.id)}</td>
                    <td><button class="cc-edit" onclick="rdcOpenDetail('${r.id}')">🔍 التفاصيل</button></td>
                </tr>`;
            }).join('')}
        </tbody></table>
    </div>
    <div style="font-size:11.5px;color:var(--inv-muted-light);margin-top:10px;line-height:1.7">
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
    const checkColor = Math.abs(check) < 0.01 ? 'var(--inv-green)' : Math.abs(check) < 100 ? 'var(--inv-gold)' : 'var(--inv-red)';
    const treasuryBal = rep.treasury_id != null ? RDC_TREASURY_BAL[rep.treasury_id] : null;

    const closing = RDC_CLOSINGS[rep.id];
    const closingCard = closing ? `
        <div class="mod-card" style="border:1.5px solid ${Math.abs(Number(closing.diff)||0) < 0.01 ? '#A7F3D0' : '#FECACA'}">
            <div style="font-size:12px;color:var(--inv-muted);margin-bottom:6px">🌙 إغلاق اليوم (من تليفون المندوب)</div>
            <div style="font-size:15px;font-weight:800">الكاش المتوقع ${rdcFmt(closing.expected_cash)} — الفعلي ${rdcFmt(closing.actual_cash)}</div>
            <div style="font-size:13px;font-weight:700;color:${Math.abs(Number(closing.diff)||0) < 0.01 ? 'var(--inv-green)' : 'var(--inv-red)'}">الفرق: ${rdcFmt(closing.diff)}</div>
            <div style="font-size:11px;color:var(--inv-muted-light);margin-top:4px">اتقفل الساعة ${new Date(closing.closed_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>` : `
        <div class="mod-card" style="border:1.5px solid #E2E8F0">
            <div style="font-size:12px;color:var(--inv-muted);margin-bottom:6px">🌙 إغلاق اليوم</div>
            <div style="font-size:14px;font-weight:700;color:var(--inv-muted-light);margin-bottom:8px">⏳ لسه ما قفلش يومه</div>
            <button class="mod-btn mod-btn-primary" style="padding:6px 14px;font-size:12.5px" onclick="rdcOpenCloseModal('${rep.id}')">🌙 إغلاق اليوم من هنا</button>
        </div>`;

    const daySales = RDC_DETAIL.sales.filter(s => s.rep_id === rep.id);
    const dayPayments = RDC_DETAIL.payments.filter(p => p.created_by === rep.id);
    const dayExpenses = RDC_DETAIL.expenses.filter(e => e.created_by === rep.id);
    const dayReturns = RDC_DETAIL.returns.filter(r => r.rep_id === rep.id);

    const listCard = (title, rows, emptyTxt) => `
        <div class="mod-card" style="margin-bottom:14px">
            <div style="font-weight:800;font-size:13.5px;color:var(--inv-navy);margin-bottom:8px">${title}</div>
            ${rows.length ? rows.join('') : `<p style="font-size:12px;color:var(--inv-muted-light);margin:0">${emptyTxt}</p>`}
        </div>`;
    const row = (label, amt, color) => `<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:4px 0;border-bottom:1px solid #F1F5F9">
        <span style="color:var(--inv-text-soft)">${label}</span><span style="font-weight:700;color:${color||'var(--inv-navy-deep)'}">${rdcFmt(amt)}</span>
    </div>`;

    c.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
        <button class="mod-btn" style="background:#F1F5F9;color:var(--inv-text-soft)" onclick="rdcBackToSummary()">→ رجوع للملخص</button>
        <h2 style="font-size:20px;font-weight:800;margin:0">🚗 ${rep.name} — ${RDC_DATE}</h2>
        <select class="mod-form-input" style="width:auto;margin:0" onchange="rdcOnDetailRepChange(this.value)">
            ${RDC_REPS.map(r => `<option value="${r.id}" ${r.id === rep.id ? 'selected' : ''}>🚗 ${r.name}</option>`).join('')}
        </select>
        <input type="date" id="rdcDate" class="mod-form-input" style="margin:0;width:auto" value="${RDC_DATE}" onchange="rdcOnDateChange(this.value)">
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin-bottom:16px">
        <div class="mod-card">
            <div style="font-size:12px;color:var(--inv-muted);margin-bottom:6px">💰 مبيعات نقدي / آجل</div>
            <div style="font-size:18px;font-weight:800">${rdcFmt(b.salesCash)} <small style="color:var(--inv-muted-light);font-size:12px">/ ${rdcFmt(b.salesCredit)}</small></div>
            <div style="font-size:11px;color:var(--inv-muted-light)">${b.salesCount} فاتورة</div>
        </div>
        <div class="mod-card">
            <div style="font-size:12px;color:var(--inv-muted);margin-bottom:6px">💵 تحصيل من عملاء</div>
            <div style="font-size:18px;font-weight:800;color:var(--inv-green)">${rdcFmt(b.collections)}</div>
        </div>
        <div class="mod-card">
            <div style="font-size:12px;color:var(--inv-muted);margin-bottom:6px">💸 مصروفات</div>
            <div style="font-size:18px;font-weight:800;color:var(--inv-red)">${rdcFmt(b.expenses)}</div>
        </div>
        <div class="mod-card">
            <div style="font-size:12px;color:var(--inv-muted);margin-bottom:6px">↩️ مرتجعات</div>
            <div style="font-size:18px;font-weight:800;color:var(--inv-gold)">${rdcFmt(b.returns)}</div>
        </div>
        <div class="mod-card">
            <div style="font-size:12px;color:var(--inv-muted);margin-bottom:6px">🏦 توريد للخزنة الرئيسية</div>
            <div style="font-size:18px;font-weight:800">${rdcFmt(b.deposits)}</div>
        </div>
        <div class="mod-card">
            <div style="font-size:12px;color:var(--inv-muted);margin-bottom:6px">✅ مطابقة الكاش (نشاط اليوم)</div>
            <div style="font-size:18px;font-weight:800;color:${checkColor}">${rdcFmt(check)}</div>
            ${treasuryBal != null ? `<div style="font-size:11px;color:var(--inv-muted-light)">رصيد خزنته الحالي: ${rdcFmt(treasuryBal)}</div>` : ''}
        </div>
        <div class="mod-card">
            <div style="font-size:12px;color:var(--inv-muted);margin-bottom:6px">🗺️ الزيارات</div>
            <div style="font-size:15px;font-weight:800">✅ ${b.visitsDone} &nbsp; ❌ ${b.visitsSkipped} &nbsp; ⏳ ${b.visitsPlanned}</div>
        </div>
        <div class="mod-card">
            <div style="font-size:12px;color:var(--inv-muted);margin-bottom:6px">📦 مخزون العربية الحالي</div>
            <div style="font-size:18px;font-weight:800">${rdcFmt(b.vanStockValue)}</div>
        </div>
        ${closingCard}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        ${listCard('🧾 فواتير اليوم', daySales.map(s => row(`${s.invoice_no} — ${s.customers?.name || 'نقدي'}`, s.total, s.payment_type === 'cash' ? 'var(--inv-green)' : 'var(--inv-gold)')), 'مفيش فواتير')}
        ${listCard('💵 تحصيلات اليوم', dayPayments.map(p => row(`${p.ref || '—'} — ${p.customers?.name || '—'}`, p.amount, 'var(--inv-green)')), 'مفيش تحصيلات')}
        ${listCard('💸 مصروفات اليوم', dayExpenses.map(e => row(`${e.expense_categories?.name || '—'} — ${e.description || ''}`, e.amount, 'var(--inv-red)')), 'مفيش مصروفات')}
        ${listCard('↩️ مرتجعات اليوم', dayReturns.map(r => row(`${r.return_no} — ${r.customers?.name || '—'}`, r.total, 'var(--inv-gold)')), 'مفيش مرتجعات')}
    </div>`;
}

window.rdcOnDateChange = async function (val) {
    RDC_DATE = val;
    const c = document.getElementById('repMgmtBody') || document.getElementById('app-content');
    await renderRepDailyClosing(c);
};

Object.assign(window, { renderRepDailyClosing, rdcOpenDetail, rdcBackToSummary, rdcOnDetailRepChange, rdcOnDateChange, rdcOpenCloseModal, rdcUpdateCloseDiff, rdcConfirmClose });
