/* ════════════════════════════════════════════════════════════
   تقارير الأداء المتقدمة — performance-reports.js
   يصدّر: renderPerformanceReports(container)

   4 تبويبات: مبيعات حسب الصنف / حسب العميل / حسب المندوب / مقارنة فترات
   كل البيانات بتتجمّع لحظياً من sale_items + sales (مفيش جدول تجميعي
   جاهز) — نفس فلسفة reports.js وwarehouse-reports.js.
   ════════════════════════════════════════════════════════════ */

let _perfProducts = [];
let _perfCustomers = [];
let _perfReps = [];
let _perfTab = 'product'; // 'product' | 'customer' | 'rep' | 'compare'

function perfFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function perfDefaultFrom() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); }
function perfToday() { return new Date().toISOString().slice(0, 10); }
function perfPctBadge(pct) {
    const color = pct > 0 ? '#059669' : pct < 0 ? '#DC2626' : '#64748B';
    const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '—';
    return `<span style="color:${color};font-weight:700">${arrow} ${Math.abs(pct).toFixed(1)}%</span>`;
}

// ════════════════════════════════════════════════════════════
// 1) التقديم الرئيسي
// ════════════════════════════════════════════════════════════
async function renderPerformanceReports(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات التقارير...</div>';
    try {
        const [{ data: products }, { data: customers }] = await Promise.all([
            sb.from('products').select('id,name,code,unit').order('name'),
            sb.from('customers').select('id,name').order('name'),
        ]);
        _perfProducts = products || [];
        _perfCustomers = customers || [];
        try {
            const { data: reps, error } = await sb.from('sales_reps').select('*');
            if (error) throw error;
            _perfReps = reps || [];
        } catch { _perfReps = []; }

        _perfTab = 'product';
        prfRenderPage(c);
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

window.prfSwitchTab = function (tab) {
    _perfTab = tab;
    prfRenderPage(document.getElementById('app-content'));
};

const PRF_TABS = [
    { id: 'product', label: '📦 حسب الصنف' },
    { id: 'customer', label: '👥 حسب العميل' },
    { id: 'rep', label: '🚗 حسب المندوب' },
    { id: 'compare', label: '⚖️ مقارنة فترات' },
];

function prfRenderPage(c) {
    c.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px">
        <div><h2 style="font-size:22px;font-weight:800">📈 تقارير الأداء المتقدمة</h2>
        <p style="font-size:13px;color:#64748B;margin-top:4px">مبيعات حسب الصنف / العميل / المندوب، ومقارنة بين فترتين</p></div>
    </div>
    <div class="ob-tabs">
        ${PRF_TABS.map(t => `<button class="ob-tab ${_perfTab === t.id ? 'active' : ''}" onclick="prfSwitchTab('${t.id}')">${t.label}</button>`).join('')}
    </div>
    <div id="prf-body" style="margin-top:16px"></div>
    `;
    if (_perfTab === 'product') prfRenderByProductForm();
    else if (_perfTab === 'customer') prfRenderByCustomerForm();
    else if (_perfTab === 'rep') prfRenderByRepForm();
    else prfRenderCompareForm();
}

function prfDateRangeBarHTML(ids, onApply) {
    return `
    <div class="dash-card" style="padding:16px;margin-bottom:16px">
        <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
            <div><label class="ob-label">من تاريخ</label><input type="date" id="${ids.from}" class="ob-input" style="margin:0" value="${perfDefaultFrom()}"></div>
            <div><label class="ob-label">إلى تاريخ</label><input type="date" id="${ids.to}" class="ob-input" style="margin:0" value="${perfToday()}"></div>
            <button class="ob-add-btn" onclick="${onApply}">🔍 تطبيق</button>
        </div>
    </div>`;
}

// ════════════════════════════════════════════════════════════
// 2) مبيعات حسب الصنف
// ════════════════════════════════════════════════════════════
function prfRenderByProductForm() {
    const body = document.getElementById('prf-body');
    if (!body) return;
    body.innerHTML = prfDateRangeBarHTML({ from: 'prfPFrom', to: 'prfPTo' }, 'prfLoadByProduct()') + `<div id="prf-result"></div>`;
    prfLoadByProduct();
}

window.prfLoadByProduct = async function () {
    const from = document.getElementById('prfPFrom')?.value || perfDefaultFrom();
    const to = document.getElementById('prfPTo')?.value || perfToday();
    const resultEl = document.getElementById('prf-result');
    resultEl.innerHTML = '<div style="text-align:center;padding:30px;color:#64748B">⏳ جاري التجميع...</div>';

    try {
        const { data: items, error } = await sb.from('sale_items')
            .select('product_id, qty, free_qty, line_total, cost_price_snapshot, sales!inner(created_at, status)')
            .eq('sales.status', 'confirmed')
            .gte('sales.created_at', from).lte('sales.created_at', to + 'T23:59:59');
        if (error) throw error;

        const byProduct = {};
        (items || []).forEach(it => {
            const g = byProduct[it.product_id] || (byProduct[it.product_id] = { qty: 0, revenue: 0, cost: 0 });
            g.qty += Number(it.qty) || 0;
            g.revenue += Number(it.line_total) || 0;
            g.cost += (Number(it.qty) || 0) * (Number(it.cost_price_snapshot) || 0);
        });

        const rows = Object.entries(byProduct).map(([pid, g]) => {
            const p = _perfProducts.find(x => x.id === pid);
            const profit = g.revenue - g.cost;
            return { name: p?.name || 'صنف محذوف', code: p?.code || '', unit: p?.unit || '', qty: g.qty, revenue: g.revenue, profit, marginPct: g.revenue > 0 ? (profit / g.revenue * 100) : 0 };
        }).sort((a, b) => b.revenue - a.revenue);

        const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
        const totalProfit = rows.reduce((s, r) => s + r.profit, 0);
        const totalQty = rows.reduce((s, r) => s + r.qty, 0);

        resultEl.innerHTML = `
        <div class="mod-grid" style="margin-bottom:16px">
            <div class="mod-card"><div class="mod-card-icon" style="background:#EFF6FF;color:#2563EB">📦</div><div class="mod-card-val">${rows.length}</div><div class="mod-card-lbl">عدد الأصناف المباعة</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#FFFBEB;color:#D97706">🔢</div><div class="mod-card-val">${perfFmt(totalQty)}</div><div class="mod-card-lbl">إجمالي الكمية</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#EFF6FF;color:#2563EB">💰</div><div class="mod-card-val">${perfFmt(totalRevenue)}</div><div class="mod-card-lbl">إجمالي الإيراد</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#D1FAE5;color:#059669">📈</div><div class="mod-card-val">${perfFmt(totalProfit)}</div><div class="mod-card-lbl">إجمالي الربح</div></div>
        </div>
        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>الصنف</th><th style="text-align:center">الكمية المباعة</th>
                <th style="text-align:left">الإيراد</th><th style="text-align:left">الربح</th><th style="text-align:center">هامش الربح</th>
            </tr></thead><tbody>
                ${rows.length ? rows.map(r => `<tr>
                    <td><strong>${r.name}</strong>${r.code ? `<div style="font-size:11px;color:#94A3B8">${r.code}</div>` : ''}</td>
                    <td style="text-align:center">${perfFmt(r.qty)} ${r.unit || ''}</td>
                    <td style="text-align:left;font-weight:700">${perfFmt(r.revenue)}</td>
                    <td style="text-align:left;font-weight:700;color:${r.profit >= 0 ? '#059669' : '#DC2626'}">${perfFmt(r.profit)}</td>
                    <td style="text-align:center">${r.marginPct.toFixed(1)}%</td>
                </tr>`).join('') : `<tr><td colspan="5" class="empty-state"><span>📭</span>لا توجد مبيعات في هذه الفترة</td></tr>`}
            </tbody></table>
        </div>`;
    } catch (err) {
        resultEl.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:16px;border-radius:10px">خطأ: ${err.message}</div>`;
    }
};

// ════════════════════════════════════════════════════════════
// 3) مبيعات حسب العميل
// ════════════════════════════════════════════════════════════
function prfRenderByCustomerForm() {
    const body = document.getElementById('prf-body');
    if (!body) return;
    body.innerHTML = prfDateRangeBarHTML({ from: 'prfCFrom', to: 'prfCTo' }, 'prfLoadByCustomer()') + `<div id="prf-result"></div>`;
    prfLoadByCustomer();
}

window.prfLoadByCustomer = async function () {
    const from = document.getElementById('prfCFrom')?.value || perfDefaultFrom();
    const to = document.getElementById('prfCTo')?.value || perfToday();
    const resultEl = document.getElementById('prf-result');
    resultEl.innerHTML = '<div style="text-align:center;padding:30px;color:#64748B">⏳ جاري التجميع...</div>';

    try {
        const { data: sales, error } = await sb.from('sales')
            .select('customer_id, total, created_at')
            .eq('status', 'confirmed')
            .gte('created_at', from).lte('created_at', to + 'T23:59:59');
        if (error) throw error;

        const byCust = {};
        (sales || []).forEach(s => {
            const key = s.customer_id || '__cash__';
            const g = byCust[key] || (byCust[key] = { count: 0, total: 0 });
            g.count++; g.total += Number(s.total) || 0;
        });

        const rows = Object.entries(byCust).map(([cid, g]) => {
            const cust = cid === '__cash__' ? null : _perfCustomers.find(x => x.id === cid);
            return { name: cust ? cust.name : '💵 عملاء نقديون (بدون تحديد)', count: g.count, total: g.total, avg: g.count ? g.total / g.count : 0 };
        }).sort((a, b) => b.total - a.total);

        const totalRevenue = rows.reduce((s, r) => s + r.total, 0);
        const totalInvoices = rows.reduce((s, r) => s + r.count, 0);

        resultEl.innerHTML = `
        <div class="mod-grid" style="margin-bottom:16px">
            <div class="mod-card"><div class="mod-card-icon" style="background:#E0E7FF;color:#4F46E5">👥</div><div class="mod-card-val">${rows.length}</div><div class="mod-card-lbl">عدد العملاء (بمن فيهم نقدي)</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#FFFBEB;color:#D97706">🧾</div><div class="mod-card-val">${totalInvoices}</div><div class="mod-card-lbl">عدد الفواتير</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#D1FAE5;color:#059669">💰</div><div class="mod-card-val">${perfFmt(totalRevenue)}</div><div class="mod-card-lbl">إجمالي المبيعات</div></div>
        </div>
        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>العميل</th><th style="text-align:center">عدد الفواتير</th>
                <th style="text-align:left">إجمالي المبيعات</th><th style="text-align:left">متوسط الفاتورة</th>
            </tr></thead><tbody>
                ${rows.length ? rows.map(r => `<tr>
                    <td><strong>${r.name}</strong></td>
                    <td style="text-align:center">${r.count}</td>
                    <td style="text-align:left;font-weight:700">${perfFmt(r.total)}</td>
                    <td style="text-align:left">${perfFmt(r.avg)}</td>
                </tr>`).join('') : `<tr><td colspan="4" class="empty-state"><span>📭</span>لا توجد مبيعات في هذه الفترة</td></tr>`}
            </tbody></table>
        </div>`;
    } catch (err) {
        resultEl.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:16px;border-radius:10px">خطأ: ${err.message}</div>`;
    }
};

// ════════════════════════════════════════════════════════════
// 4) مبيعات حسب المندوب
// ════════════════════════════════════════════════════════════
function prfRenderByRepForm() {
    const body = document.getElementById('prf-body');
    if (!body) return;
    body.innerHTML = prfDateRangeBarHTML({ from: 'prfRFrom', to: 'prfRTo' }, 'prfLoadByRep()') + `<div id="prf-result"></div>`;
    prfLoadByRep();
}

window.prfLoadByRep = async function () {
    const from = document.getElementById('prfRFrom')?.value || perfDefaultFrom();
    const to = document.getElementById('prfRTo')?.value || perfToday();
    const resultEl = document.getElementById('prf-result');
    resultEl.innerHTML = '<div style="text-align:center;padding:30px;color:#64748B">⏳ جاري التجميع...</div>';

    try {
        const [{ data: allSales, error: e1 }, { data: repSales, error: e2 }] = await Promise.all([
            sb.from('sales').select('total').eq('status', 'confirmed').gte('created_at', from).lte('created_at', to + 'T23:59:59'),
            sb.from('sales').select('rep_id, total').eq('status', 'confirmed').not('rep_id', 'is', null).gte('created_at', from).lte('created_at', to + 'T23:59:59'),
        ]);
        if (e1) throw e1;
        if (e2) throw e2;

        const grandTotal = (allSales || []).reduce((s, r) => s + (Number(r.total) || 0), 0);
        const byRep = {};
        (repSales || []).forEach(s => {
            const g = byRep[s.rep_id] || (byRep[s.rep_id] = { count: 0, total: 0 });
            g.count++; g.total += Number(s.total) || 0;
        });
        const attributedTotal = Object.values(byRep).reduce((s, g) => s + g.total, 0);
        const coverage = grandTotal > 0 ? (attributedTotal / grandTotal * 100) : 0;

        const rows = Object.entries(byRep).map(([rid, g]) => {
            const rep = _perfReps.find(r => r.id === rid);
            const commission = g.total * (Number(rep?.commission_pct) || 0) / 100;
            return { name: rep?.name || 'مندوب محذوف', count: g.count, total: g.total, commission };
        }).sort((a, b) => b.total - a.total);

        resultEl.innerHTML = `
        ${!_perfReps.length ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:12px 16px;border-radius:10px;margin-bottom:16px;font-size:12px">
            ⚠️ لا يوجد مندوبون مسجّلون بعد. أضِف مندوبين من صفحة "🚗 المندوبون" واربطهم بالفواتير عشان يظهروا هنا.
        </div>` : ''}
        <div class="mod-grid" style="margin-bottom:16px">
            <div class="mod-card"><div class="mod-card-icon" style="background:#E0E7FF;color:#4F46E5">🚗</div><div class="mod-card-val">${rows.length}</div><div class="mod-card-lbl">مندوبون لهم مبيعات</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#D1FAE5;color:#059669">💰</div><div class="mod-card-val">${perfFmt(attributedTotal)}</div><div class="mod-card-lbl">مبيعات مرتبطة بمندوب</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#FFFBEB;color:#D97706">📊</div><div class="mod-card-val">${coverage.toFixed(0)}%</div><div class="mod-card-lbl">نسبة التغطية (من ${perfFmt(grandTotal)} إجمالي)</div></div>
        </div>
        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>المندوب</th><th style="text-align:center">عدد الفواتير</th>
                <th style="text-align:left">إجمالي المبيعات</th><th style="text-align:left">العمولة المستحقة</th>
            </tr></thead><tbody>
                ${rows.length ? rows.map(r => `<tr>
                    <td><strong>${r.name}</strong></td>
                    <td style="text-align:center">${r.count}</td>
                    <td style="text-align:left;font-weight:700">${perfFmt(r.total)}</td>
                    <td style="text-align:left;font-weight:700;color:#059669">${perfFmt(r.commission)}</td>
                </tr>`).join('') : `<tr><td colspan="4" class="empty-state"><span>📭</span>لا توجد مبيعات مرتبطة بمندوب في هذه الفترة</td></tr>`}
            </tbody></table>
        </div>`;
    } catch (err) {
        resultEl.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:16px;border-radius:10px">خطأ: ${err.message}</div>`;
    }
};

// ════════════════════════════════════════════════════════════
// 5) مقارنة فترات
// ════════════════════════════════════════════════════════════
function prfRenderCompareForm() {
    const body = document.getElementById('prf-body');
    if (!body) return;
    const today = new Date();
    const thisMonthFrom = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
    const lastMonthFrom = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10);
    const lastMonthTo = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().slice(0, 10);

    body.innerHTML = `
    <div class="dash-card" style="padding:16px;margin-bottom:16px">
        <div style="display:flex;gap:20px;flex-wrap:wrap">
            <div>
                <div style="font-size:12px;font-weight:800;color:#2563EB;margin-bottom:6px">الفترة أ (المقارنة الأساسية)</div>
                <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
                    <div><label class="ob-label">من</label><input type="date" id="prfCmpFromA" class="ob-input" style="margin:0" value="${thisMonthFrom}"></div>
                    <div><label class="ob-label">إلى</label><input type="date" id="prfCmpToA" class="ob-input" style="margin:0" value="${perfToday()}"></div>
                </div>
            </div>
            <div>
                <div style="font-size:12px;font-weight:800;color:#D97706;margin-bottom:6px">الفترة ب (المقارَن بها)</div>
                <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
                    <div><label class="ob-label">من</label><input type="date" id="prfCmpFromB" class="ob-input" style="margin:0" value="${lastMonthFrom}"></div>
                    <div><label class="ob-label">إلى</label><input type="date" id="prfCmpToB" class="ob-input" style="margin:0" value="${lastMonthTo}"></div>
                </div>
            </div>
            <button class="ob-add-btn" style="align-self:end" onclick="prfLoadCompare()">⚖️ قارن</button>
        </div>
    </div>
    <div id="prf-result"></div>`;
    prfLoadCompare();
}

async function prfLoadPeriodTotals(from, to) {
    const [{ data: items, error: e1 }, { data: sales, error: e2 }] = await Promise.all([
        sb.from('sale_items').select('product_id, qty, line_total, sales!inner(created_at, status)').eq('sales.status', 'confirmed').gte('sales.created_at', from).lte('sales.created_at', to + 'T23:59:59'),
        sb.from('sales').select('total').eq('status', 'confirmed').gte('created_at', from).lte('created_at', to + 'T23:59:59'),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;

    const byProduct = {};
    (items || []).forEach(it => {
        const g = byProduct[it.product_id] || (byProduct[it.product_id] = { qty: 0, revenue: 0 });
        g.qty += Number(it.qty) || 0;
        g.revenue += Number(it.line_total) || 0;
    });
    return {
        byProduct,
        total: (sales || []).reduce((s, r) => s + (Number(r.total) || 0), 0),
        count: (sales || []).length,
        qty: Object.values(byProduct).reduce((s, g) => s + g.qty, 0),
    };
}

window.prfLoadCompare = async function () {
    const fromA = document.getElementById('prfCmpFromA')?.value;
    const toA = document.getElementById('prfCmpToA')?.value;
    const fromB = document.getElementById('prfCmpFromB')?.value;
    const toB = document.getElementById('prfCmpToB')?.value;
    if (!fromA || !toA || !fromB || !toB) { alert('حدّد الفترتين كاملتين'); return; }

    const resultEl = document.getElementById('prf-result');
    resultEl.innerHTML = '<div style="text-align:center;padding:30px;color:#64748B">⏳ جاري المقارنة...</div>';

    try {
        const [A, B] = await Promise.all([prfLoadPeriodTotals(fromA, toA), prfLoadPeriodTotals(fromB, toB)]);
        const pct = (a, b) => a === 0 ? (b > 0 ? 100 : 0) : ((b - a) / a * 100);

        const pids = new Set([...Object.keys(A.byProduct), ...Object.keys(B.byProduct)]);
        const movers = [...pids].map(pid => {
            const p = _perfProducts.find(x => x.id === pid);
            const revA = A.byProduct[pid]?.revenue || 0;
            const revB = B.byProduct[pid]?.revenue || 0;
            return { name: p?.name || 'صنف محذوف', revA, revB, diff: revA - revB };
        }).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 10);

        const kpi = (label, valA, valB, isMoney = true) => `
            <div class="mod-card">
                <div style="font-size:12px;color:#64748B;margin-bottom:6px">${label}</div>
                <div style="display:flex;justify-content:space-between;align-items:baseline">
                    <span style="font-size:18px;font-weight:800;color:#2563EB">${isMoney ? perfFmt(valB) : valB}</span>
                    ${perfPctBadge(pct(valA, valB))}
                </div>
                <div style="font-size:11px;color:#94A3B8;margin-top:4px">مقابل ${isMoney ? perfFmt(valA) : valA} في الفترة ب</div>
            </div>`;

        resultEl.innerHTML = `
        <div class="mod-grid" style="margin-bottom:16px">
            ${kpi('إجمالي المبيعات', B.total, A.total)}
            ${kpi('عدد الفواتير', B.count, A.count, false)}
            ${kpi('الكمية المباعة', B.qty, A.qty, false)}
            ${kpi('متوسط الفاتورة', B.count ? B.total / B.count : 0, A.count ? A.total / A.count : 0)}
        </div>
        <div class="mod-table-wrap">
            <div style="padding:14px 18px 0;font-weight:800;font-size:14px;color:#1E293B">🔀 أكبر 10 تغيّرات في مبيعات الأصناف (أ مقابل ب)</div>
            <table class="mod-table"><thead><tr>
                <th>الصنف</th><th style="text-align:left">الفترة أ</th><th style="text-align:left">الفترة ب</th><th style="text-align:center">التغيّر</th>
            </tr></thead><tbody>
                ${movers.length ? movers.map(m => `<tr>
                    <td><strong>${m.name}</strong></td>
                    <td style="text-align:left">${perfFmt(m.revA)}</td>
                    <td style="text-align:left">${perfFmt(m.revB)}</td>
                    <td style="text-align:center">${perfPctBadge(pct(m.revB, m.revA))}</td>
                </tr>`).join('') : `<tr><td colspan="4" class="empty-state"><span>📭</span>لا توجد بيانات كافية للمقارنة</td></tr>`}
            </tbody></table>
        </div>`;
    } catch (err) {
        resultEl.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:16px;border-radius:10px">خطأ: ${err.message}</div>`;
    }
};

Object.assign(window, {
    renderPerformanceReports, prfSwitchTab,
    prfLoadByProduct, prfLoadByCustomer, prfLoadByRep, prfLoadCompare,
});
