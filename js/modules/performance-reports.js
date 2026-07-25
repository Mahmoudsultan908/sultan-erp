/* ════════════════════════════════════════════════════════════
   تقارير الأداء المتقدمة — performance-reports.js
   يصدّر: renderPerformanceReports(container)

   4 تبويبات: مبيعات حسب الصنف / حسب العميل / حسب المندوب / مقارنة فترات
   كل البيانات بتتجمّع لحظياً من sale_items + sales (مفيش جدول تجميعي
   جاهز) — نفس فلسفة reports.js وwarehouse-reports.js.
   ════════════════════════════════════════════════════════════ */

let _perfProducts = [];
let _perfCustomers = [];
let _perfSuppliers = [];
let _perfTreasuries = [];
let _perfReps = [];
let _perfTab = 'product'; // 'product' | 'customer' | 'rep' | 'compare' | 'payments' | 'returns'
let _perfPaymentsRows = []; // آخر نتيجة تحميل تبويب المدفوعات — عشان خانة البحث تفلتر منها من غير استعلام جديد
let _perfReturnsRows = []; // نفس الفكرة لتبويب المرتجعات

// ★ Supabase بيرجع 1000 صف كحد أقصى افتراضي لأي select عادي من غير فلتر
//   يضيّق النتيجة — sale_items بقى أكتر من كده بعد نقل البيانات التاريخية،
//   فتقرير "حسب الصنف" و"مقارنة فترات" كانا بيحسبوا إيراد/تكلفة ناقصين
//   لأي فترة برجّع أكتر من 1000 سطر صنف. نفس نمط الإصلاح في reports.js.
async function prfFetchAllRows(table, select, applyFilters) {
    let all = [], from = 0;
    const pageSize = 1000;
    while (true) {
        let q = sb.from(table).select(select);
        if (applyFilters) q = applyFilters(q);
        const { data, error } = await q.range(from, from + pageSize - 1);
        if (error) return { data: null, error };
        all = all.concat(data || []);
        if (!data || data.length < pageSize) break;
        from += pageSize;
    }
    return { data: all, error: null };
}

function perfFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
// ★ new Date(...).toISOString() بيحوّل لتوقيت UTC — لو المتصفح فى توقيت
//   قدام UTC (زي GMT+3)، أول الشهر أو النهاردة كانوا بيترحّلوا يوم لورا
//   بصمت (1 يوليو محلي بيبقى 30 يونيو UTC) وبيوسّعوا الفترة من غير ما حد
//   يلاحظ. نبني السترينج من مكوّنات التاريخ المحلي مباشرة بدل توقيت UTC.
function perfDateStr(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function perfDefaultFrom() { const d = new Date(); return perfDateStr(new Date(d.getFullYear(), d.getMonth(), 1)); }
function perfToday() { return perfDateStr(new Date()); }
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
        const [{ data: products }, { data: customers }, { data: suppliers }, { data: treasuries }] = await Promise.all([
            sb.from('products').select('id,name,code,unit').order('name'),
            sb.from('customers').select('id,name').order('name'),
            sb.from('suppliers').select('id,name').order('name'),
            sb.from('treasuries').select('id,name').order('name'),
        ]);
        _perfProducts = products || [];
        _perfCustomers = customers || [];
        _perfSuppliers = suppliers || [];
        _perfTreasuries = treasuries || [];
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
    { id: 'payments', label: '💰 المدفوعات' },
    { id: 'returns', label: '↩️ المرتجعات' },
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
    else if (_perfTab === 'payments') prfRenderPaymentsForm();
    else if (_perfTab === 'returns') prfRenderReturnsForm();
    else prfRenderCompareForm();
}

// تصدير/طباعة (بند 12) — زوج أزرار مشترك لكل التبويبات الـ6، بيشتغل على
// آخر نتيجة اتحسبت لأي تبويب مفتوح حاليًا (rows/title بيتسجّلوا وقت
// الرندر بتاع كل تبويب قبل ما يستخدم الزرارين دول)
const PRF_ACTIONS_HTML = `
    <div style="display:flex;gap:10px;margin-top:14px">
        <button class="mod-btn" onclick="prfExportCurrent()">📊 تصدير Excel</button>
        <button class="mod-btn" onclick="prfPrintCurrent()">🖨️ طباعة</button>
    </div>`;
window.prfExportCurrent = () => repExportExcel(window._prfExportName || 'تقرير_أداء', window._prfExportRows || []);
window.prfPrintCurrent = () => repPrintReport(window._prfPrintTitle || 'تقرير أداء', document.getElementById('prf-result')?.innerHTML || '');

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
        const { data: items, error } = await prfFetchAllRows(
            'sale_items',
            'product_id, qty, free_qty, line_total, cost_price_snapshot, sales!inner(created_at, status)',
            (q) => q.eq('sales.status', 'confirmed').gte('sales.created_at', from).lte('sales.created_at', to + 'T23:59:59')
        );
        if (error) throw error;

        const byProduct = {};
        (items || []).forEach(it => {
            const g = byProduct[it.product_id] || (byProduct[it.product_id] = { qty: 0, revenue: 0, cost: 0 });
            g.qty += Number(it.qty) || 0;
            g.revenue += Number(it.line_total) || 0;
            g.cost += (Number(it.qty) || 0) * (Number(it.cost_price_snapshot) || 0);
        });

        // نسبة المؤجل التقديرية لكل صنف — نفس المنطق المستخدم في صفحة الأصناف
        // (آخر نسبة مؤجل استُخدمت فعلياً في آخر فاتورة شراء مؤكدة تضمنت الصنف)،
        // عشان الربح المعروض هنا يبقى متسق مع هامش الربح الظاهر تحت كل سعر هناك.
        const productIds = Object.keys(byProduct);
        const deferredRateByProduct = {};
        if (productIds.length) {
            const { data: piRows } = await prfFetchAllRows(
                'purchase_items',
                'product_id, deferred_rate, purchases!inner(created_at, status)',
                (q) => q.in('product_id', productIds).eq('purchases.status', 'confirmed')
            );
            (piRows || []).forEach(r => {
                const cur = deferredRateByProduct[r.product_id];
                const rowDate = new Date(r.purchases?.created_at || 0);
                if (!cur || rowDate > cur.date) deferredRateByProduct[r.product_id] = { rate: Number(r.deferred_rate) || 0, date: rowDate };
            });
        }

        const rows = Object.entries(byProduct).map(([pid, g]) => {
            const p = _perfProducts.find(x => x.id === pid);
            // deferredRate بقى مبلغ فعلي للوحدة (مش نسبة %) — راجع purchases.js
            // purSave: أي % بيتحوّل لمبلغ للوحدة وقت الحفظ عشان يطابق صيغة
            // deferred_rebates.expected_amount = qty*rate في القاعدة.
            const deferredRate = deferredRateByProduct[pid]?.rate || 0;
            const netCost = g.cost - deferredRate * g.qty;
            const profit = g.revenue - netCost;
            return { name: p?.name || 'صنف محذوف', code: p?.code || '', unit: p?.unit || '', qty: g.qty, revenue: g.revenue, profit, deferredRate, marginPct: g.revenue > 0 ? (profit / g.revenue * 100) : 0 };
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
                <th style="text-align:left">الإيراد</th><th style="text-align:left">الربح</th><th style="text-align:center">هامش الربح</th><th style="text-align:center">مؤجل مخصوم</th>
            </tr></thead><tbody>
                ${rows.length ? rows.map(r => `<tr>
                    <td><strong>${r.name}</strong>${r.code ? `<div style="font-size:11px;color:#94A3B8">${r.code}</div>` : ''}</td>
                    <td style="text-align:center">${perfFmt(r.qty)} ${r.unit || ''}</td>
                    <td style="text-align:left;font-weight:700">${perfFmt(r.revenue)}</td>
                    <td style="text-align:left;font-weight:700;color:${r.profit >= 0 ? '#059669' : '#DC2626'}">${perfFmt(r.profit)}</td>
                    <td style="text-align:center">${r.marginPct.toFixed(1)}%</td>
                    <td style="text-align:center;color:#94A3B8;font-size:12px">${r.deferredRate > 0 ? perfFmt(r.deferredRate) + '/وحدة' : '—'}</td>
                </tr>`).join('') : `<tr><td colspan="6" class="empty-state"><span>📭</span>لا توجد مبيعات في هذه الفترة</td></tr>`}
            </tbody></table>
        </div>${PRF_ACTIONS_HTML}`;
        window._prfExportName = 'مبيعات_حسب_الصنف';
        window._prfPrintTitle = `مبيعات حسب الصنف (${from} إلى ${to})`;
        window._prfExportRows = rows.map(r => ({ الصنف: r.name, الكود: r.code, الكمية: r.qty, الإيراد: r.revenue, الربح: r.profit, 'هامش %': r.marginPct.toFixed(1) }));
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
        </div>${PRF_ACTIONS_HTML}`;
        window._prfExportName = 'مبيعات_حسب_العميل';
        window._prfPrintTitle = `مبيعات حسب العميل (${from} إلى ${to})`;
        window._prfExportRows = rows.map(r => ({ العميل: r.name, 'عدد الفواتير': r.count, الإجمالي: r.total, 'متوسط الفاتورة': r.avg }));
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
        // ★ مرتجعات المبيعات لازم تتخصم من إجمالي مبيعات المندوب (وإلا العمولة
        //   المحسوبة هنا بتفضل أعلى من الحقيقي لو حصل مرتجع بعد الفاتورة). جدول
        //   sales_returns.rep_id عمود جديد (راجع sales_returns_rep_id_migration.sql) —
        //   لو لسه ما اتضافش/الجدول لسه مش موجود، e3 بيرجع خطأ ونتجاهله بهدوء
        //   ونحسب من غير خصم مرتجعات (نفس فلسفة sales_reps الاختيارية فوق).
        const [{ data: allSales, error: e1 }, { data: repSales, error: e2 }, { data: repReturns, error: e3 }] = await Promise.all([
            sb.from('sales').select('total').eq('status', 'confirmed').gte('created_at', from).lte('created_at', to + 'T23:59:59'),
            sb.from('sales').select('rep_id, total').eq('status', 'confirmed').not('rep_id', 'is', null).gte('created_at', from).lte('created_at', to + 'T23:59:59'),
            sb.from('sales_returns').select('rep_id, total').eq('status', 'confirmed').gte('created_at', from).lte('created_at', to + 'T23:59:59'),
        ]);
        if (e1) throw e1;
        if (e2) throw e2;
        const allReturns = e3 ? [] : (repReturns || []);

        const grandTotal = (allSales || []).reduce((s, r) => s + (Number(r.total) || 0), 0);
        const grandReturns = allReturns.reduce((s, r) => s + (Number(r.total) || 0), 0);
        const byRep = {};
        (repSales || []).forEach(s => {
            const g = byRep[s.rep_id] || (byRep[s.rep_id] = { count: 0, total: 0, returns: 0 });
            g.count++; g.total += Number(s.total) || 0;
        });
        allReturns.forEach(r => {
            if (!r.rep_id) return; // مرتجع مستقل من غير مندوب — مالوش تأثير على إحصائية مندوب بعينه
            const g = byRep[r.rep_id] || (byRep[r.rep_id] = { count: 0, total: 0, returns: 0 });
            g.returns += Number(r.total) || 0;
        });
        const attributedTotal = Object.values(byRep).reduce((s, g) => s + (g.total - g.returns), 0);
        const netGrandTotal = grandTotal - grandReturns;
        const coverage = netGrandTotal > 0 ? (attributedTotal / netGrandTotal * 100) : 0;

        const rows = Object.entries(byRep).map(([rid, g]) => {
            const rep = _perfReps.find(r => r.id === rid);
            const netTotal = g.total - g.returns;
            const commission = netTotal * (Number(rep?.commission_pct) || 0) / 100;
            return { name: rep?.name || 'مندوب محذوف', count: g.count, total: netTotal, returns: g.returns, commission };
        }).sort((a, b) => b.total - a.total);

        resultEl.innerHTML = `
        ${!_perfReps.length ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:12px 16px;border-radius:10px;margin-bottom:16px;font-size:12px">
            ⚠️ لا يوجد مندوبون مسجّلون بعد. أضِف مندوبين من صفحة "🚗 المندوبون" واربطهم بالفواتير عشان يظهروا هنا.
        </div>` : ''}
        ${e3 ? `<div style="background:#FEE2E2;border:1px solid #FCA5A5;color:#991B1B;padding:12px 16px;border-radius:10px;margin-bottom:16px;font-size:12px">
            ⚠️ <strong>تعذّر جلب بيانات مرتجعات المبيعات (${e3.message || 'خطأ غير معروف'})</strong> — أرقام "صافي المبيعات" و"مرتجعات" أدناه محسوبة من غير خصم أي مرتجع فعلياً حتى لو حصل. غالباً السبب إن عمود <code>sales_returns.rep_id</code> لسه مش موجود — تأكد إن ملف <code>sales_returns_rep_id_migration.sql</code> اتشغّل بنجاح (من غير أي رسالة خطأ) في Supabase SQL Editor.
        </div>` : ''}
        <div class="mod-grid" style="margin-bottom:16px">
            <div class="mod-card"><div class="mod-card-icon" style="background:#E0E7FF;color:#4F46E5">🚗</div><div class="mod-card-val">${rows.length}</div><div class="mod-card-lbl">مندوبون لهم مبيعات</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#D1FAE5;color:#059669">💰</div><div class="mod-card-val">${perfFmt(attributedTotal)}</div><div class="mod-card-lbl">صافي مبيعات مرتبطة بمندوب (بعد خصم المرتجعات)</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#FFFBEB;color:#D97706">📊</div><div class="mod-card-val">${coverage.toFixed(0)}%</div><div class="mod-card-lbl">نسبة التغطية (من ${perfFmt(netGrandTotal)} صافي إجمالي)</div></div>
        </div>
        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>المندوب</th><th style="text-align:center">عدد الفواتير</th>
                <th style="text-align:left">مرتجعات</th>
                <th style="text-align:left">صافي المبيعات</th><th style="text-align:left">العمولة المستحقة</th>
            </tr></thead><tbody>
                ${rows.length ? rows.map(r => `<tr>
                    <td><strong>${r.name}</strong></td>
                    <td style="text-align:center">${r.count}</td>
                    <td style="text-align:left;color:${r.returns > 0 ? '#DC2626' : '#94A3B8'}">${r.returns > 0 ? '-' + perfFmt(r.returns) : '—'}</td>
                    <td style="text-align:left;font-weight:700">${perfFmt(r.total)}</td>
                    <td style="text-align:left;font-weight:700;color:#059669">${perfFmt(r.commission)}</td>
                </tr>`).join('') : `<tr><td colspan="5" class="empty-state"><span>📭</span>لا توجد مبيعات مرتبطة بمندوب في هذه الفترة</td></tr>`}
            </tbody></table>
        </div>${PRF_ACTIONS_HTML}`;
        window._prfExportName = 'مبيعات_حسب_المندوب';
        window._prfPrintTitle = `مبيعات حسب المندوب (${from} إلى ${to})`;
        window._prfExportRows = rows.map(r => ({ المندوب: r.name, 'عدد الفواتير': r.count, مرتجعات: r.returns, 'صافي المبيعات': r.total, العمولة: r.commission }));
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
        prfFetchAllRows('sale_items', 'product_id, qty, line_total, sales!inner(created_at, status)', (q) =>
            q.eq('sales.status', 'confirmed').gte('sales.created_at', from).lte('sales.created_at', to + 'T23:59:59')),
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
        </div>${PRF_ACTIONS_HTML}`;
        window._prfExportName = 'مقارنة_فترات';
        window._prfPrintTitle = `مقارنة فترات — أ: ${fromA} إلى ${toA} | ب: ${fromB} إلى ${toB}`;
        window._prfExportRows = [
            { البند: 'إجمالي المبيعات', 'الفترة أ': A.total, 'الفترة ب': B.total },
            { البند: 'عدد الفواتير', 'الفترة أ': A.count, 'الفترة ب': B.count },
            { البند: 'الكمية المباعة', 'الفترة أ': A.qty, 'الفترة ب': B.qty },
            ...movers.map(m => ({ البند: 'صنف: ' + m.name, 'الفترة أ': m.revA, 'الفترة ب': m.revB })),
        ];
    } catch (err) {
        resultEl.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:16px;border-radius:10px">خطأ: ${err.message}</div>`;
    }
};

// ════════════════════════════════════════════════════════════
// 6) المدفوعات — تحصيلات عملاء + دفعات موردين مع بعض (بند 11)
// ════════════════════════════════════════════════════════════
function prfRenderPaymentsForm() {
    const body = document.getElementById('prf-body');
    if (!body) return;
    body.innerHTML = prfDateRangeBarHTML({ from: 'prfPayFrom', to: 'prfPayTo' }, 'prfLoadPayments()') + `
        <div class="mod-form-group" style="max-width:320px;margin-bottom:14px">
            <input type="text" id="prfPaySearch" class="mod-form-input" placeholder="🔍 بحث بالاسم..." oninput="prfFilterPayments(this.value)">
        </div>
        <div id="prf-result"></div>`;
    prfLoadPayments();
}

window.prfLoadPayments = async function () {
    const from = document.getElementById('prfPayFrom')?.value || perfDefaultFrom();
    const to = document.getElementById('prfPayTo')?.value || perfToday();
    const resultEl = document.getElementById('prf-result');
    resultEl.innerHTML = '<div style="text-align:center;padding:30px;color:#64748B">⏳ جاري التجميع...</div>';

    try {
        const [{ data: collections, error: e1 }, { data: payouts, error: e2 }] = await Promise.all([
            sb.from('customer_payments').select('id, customer_id, amount, treasury_id, ref, created_at')
                .eq('status', 'confirmed').gte('created_at', from).lte('created_at', to + 'T23:59:59'),
            sb.from('supplier_payments').select('id, supplier_id, amount, treasury_id, ref, created_at')
                .eq('status', 'confirmed').gte('created_at', from).lte('created_at', to + 'T23:59:59'),
        ]);
        if (e1) throw e1;
        if (e2) throw e2;

        const rows = [
            ...(collections || []).map(r => ({
                kind: 'collect', name: _perfCustomers.find(c => c.id === r.customer_id)?.name || 'عميل محذوف',
                amount: Number(r.amount) || 0, treasury_id: r.treasury_id, ref: r.ref, created_at: r.created_at,
            })),
            ...(payouts || []).map(r => ({
                kind: 'pay', name: _perfSuppliers.find(s => s.id === r.supplier_id)?.name || 'مورد محذوف',
                amount: Number(r.amount) || 0, treasury_id: r.treasury_id, ref: r.ref, created_at: r.created_at,
            })),
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        _perfPaymentsRows = rows;

        prfRenderPaymentsResult(rows);
    } catch (err) {
        resultEl.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:16px;border-radius:10px">خطأ: ${err.message}</div>`;
    }
};

window.prfFilterPayments = function (q) {
    const filtered = flexSearch(_perfPaymentsRows, q, ['name']);
    prfRenderPaymentsResult(filtered);
};

function prfRenderPaymentsResult(rows) {
    const resultEl = document.getElementById('prf-result');
    if (!resultEl) return;

    const totalCollect = rows.filter(r => r.kind === 'collect').reduce((s, r) => s + r.amount, 0);
    const totalPay = rows.filter(r => r.kind === 'pay').reduce((s, r) => s + r.amount, 0);

    const byTreasury = {};
    rows.forEach(r => {
        const g = byTreasury[r.treasury_id || '__none__'] || (byTreasury[r.treasury_id || '__none__'] = { collect: 0, pay: 0 });
        if (r.kind === 'collect') g.collect += r.amount; else g.pay += r.amount;
    });
    const treasuryRows = Object.entries(byTreasury).map(([tid, g]) => ({
        name: tid === '__none__' ? 'بدون خزنة' : (_perfTreasuries.find(t => t.id === tid)?.name || 'خزنة محذوفة'),
        collect: g.collect, pay: g.pay,
    })).sort((a, b) => (b.collect + b.pay) - (a.collect + a.pay));

    resultEl.innerHTML = `
    <div class="mod-grid" style="margin-bottom:16px">
        <div class="mod-card"><div class="mod-card-icon" style="background:#D1FAE5;color:#059669">📥</div><div class="mod-card-val">${perfFmt(totalCollect)}</div><div class="mod-card-lbl">إجمالي التحصيل من العملاء</div></div>
        <div class="mod-card"><div class="mod-card-icon" style="background:#FEE2E2;color:#DC2626">📤</div><div class="mod-card-val">${perfFmt(totalPay)}</div><div class="mod-card-lbl">إجمالي الدفع للموردين</div></div>
        <div class="mod-card"><div class="mod-card-icon" style="background:#EFF6FF;color:#2563EB">⚖️</div><div class="mod-card-val">${perfFmt(totalCollect - totalPay)}</div><div class="mod-card-lbl">صافي الحركة النقدية</div></div>
    </div>
    <div class="mod-table-wrap" style="margin-bottom:20px">
        <div style="padding:14px 18px 0;font-weight:800;font-size:14px;color:#1E293B">حسب الخزنة</div>
        <table class="mod-table"><thead><tr>
            <th>الخزنة</th><th style="text-align:left">تحصيل من عملاء</th><th style="text-align:left">دفع لموردين</th><th style="text-align:left">الصافي</th>
        </tr></thead><tbody>
            ${treasuryRows.length ? treasuryRows.map(t => `<tr>
                <td><strong>${t.name}</strong></td>
                <td style="text-align:left;color:#059669">${perfFmt(t.collect)}</td>
                <td style="text-align:left;color:#DC2626">${perfFmt(t.pay)}</td>
                <td style="text-align:left;font-weight:700">${perfFmt(t.collect - t.pay)}</td>
            </tr>`).join('') : `<tr><td colspan="4" class="empty-state"><span>📭</span>لا توجد حركات فى هذه الفترة</td></tr>`}
        </tbody></table>
    </div>
    <div class="mod-table-wrap">
        <div style="padding:14px 18px 0;font-weight:800;font-size:14px;color:#1E293B">كل الحركات</div>
        <table class="mod-table"><thead><tr>
            <th>النوع</th><th>الاسم</th><th>الخزنة</th><th style="text-align:left">المبلغ</th><th>التاريخ</th>
        </tr></thead><tbody>
            ${rows.length ? rows.map(r => `<tr>
                <td>${r.kind === 'collect' ? '<span style="color:#059669">📥 تحصيل</span>' : '<span style="color:#DC2626">📤 دفع</span>'}</td>
                <td>${r.name}</td>
                <td style="color:#64748B">${_perfTreasuries.find(t => t.id === r.treasury_id)?.name || '—'}</td>
                <td style="text-align:left;font-weight:700">${perfFmt(r.amount)}</td>
                <td style="font-size:12px;color:#94A3B8">${new Date(r.created_at).toLocaleDateString('ar-EG')}</td>
            </tr>`).join('') : `<tr><td colspan="5" class="empty-state"><span>📭</span>لا توجد حركات مطابقة</td></tr>`}
        </tbody></table>
    </div>${PRF_ACTIONS_HTML}`;
    window._prfExportName = 'المدفوعات';
    window._prfPrintTitle = 'تقرير المدفوعات';
    window._prfExportRows = rows.map(r => ({ النوع: r.kind === 'collect' ? 'تحصيل من عميل' : 'دفع لمورد', الاسم: r.name, الخزنة: _perfTreasuries.find(t => t.id === r.treasury_id)?.name || '—', المبلغ: r.amount, التاريخ: new Date(r.created_at).toLocaleDateString('ar-EG') }));
}

// ════════════════════════════════════════════════════════════
// 7) المرتجعات — بيع وشراء مع بعض (بند 11)
// ════════════════════════════════════════════════════════════
function prfRenderReturnsForm() {
    const body = document.getElementById('prf-body');
    if (!body) return;
    body.innerHTML = prfDateRangeBarHTML({ from: 'prfRetFrom', to: 'prfRetTo' }, 'prfLoadReturns()') + `
        <div class="mod-form-group" style="max-width:320px;margin-bottom:14px">
            <input type="text" id="prfRetSearch" class="mod-form-input" placeholder="🔍 بحث بالاسم..." oninput="prfFilterReturns(this.value)">
        </div>
        <div id="prf-result"></div>`;
    prfLoadReturns();
}

window.prfLoadReturns = async function () {
    const from = document.getElementById('prfRetFrom')?.value || perfDefaultFrom();
    const to = document.getElementById('prfRetTo')?.value || perfToday();
    const resultEl = document.getElementById('prf-result');
    resultEl.innerHTML = '<div style="text-align:center;padding:30px;color:#64748B">⏳ جاري التجميع...</div>';

    try {
        const [{ data: salesRet, error: e1 }, { data: purRet, error: e2 }] = await Promise.all([
            sb.from('sales_returns').select('id, customer_id, rep_id, total, return_no, created_at')
                .eq('status', 'confirmed').gte('created_at', from).lte('created_at', to + 'T23:59:59'),
            sb.from('purchase_returns').select('id, supplier_id, total, return_no, created_at')
                .eq('status', 'confirmed').gte('created_at', from).lte('created_at', to + 'T23:59:59'),
        ]);
        if (e1) throw e1;
        if (e2) throw e2;

        const rows = [
            ...(salesRet || []).map(r => ({
                kind: 'sale', name: _perfCustomers.find(c => c.id === r.customer_id)?.name || 'عميل نقدي/محذوف',
                rep_id: r.rep_id, amount: Number(r.total) || 0, no: r.return_no, created_at: r.created_at,
            })),
            ...(purRet || []).map(r => ({
                kind: 'purchase', name: _perfSuppliers.find(s => s.id === r.supplier_id)?.name || 'مورد محذوف',
                rep_id: null, amount: Number(r.total) || 0, no: r.return_no, created_at: r.created_at,
            })),
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        _perfReturnsRows = rows;

        prfRenderReturnsResult(rows);
    } catch (err) {
        resultEl.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:16px;border-radius:10px">خطأ: ${err.message}</div>`;
    }
};

window.prfFilterReturns = function (q) {
    const filtered = flexSearch(_perfReturnsRows, q, ['name']);
    prfRenderReturnsResult(filtered);
};

function prfRenderReturnsResult(rows) {
    const resultEl = document.getElementById('prf-result');
    if (!resultEl) return;

    const salesTotal = rows.filter(r => r.kind === 'sale').reduce((s, r) => s + r.amount, 0);
    const purchaseTotal = rows.filter(r => r.kind === 'purchase').reduce((s, r) => s + r.amount, 0);

    const byRep = {};
    rows.filter(r => r.kind === 'sale').forEach(r => {
        const g = byRep[r.rep_id || '__none__'] || (byRep[r.rep_id || '__none__'] = { total: 0, count: 0 });
        g.total += r.amount; g.count++;
    });
    const repRows = Object.entries(byRep).map(([rid, g]) => ({
        name: rid === '__none__' ? 'بدون مندوب' : (_perfReps.find(r => r.id === rid)?.name || 'مندوب محذوف'),
        total: g.total, count: g.count,
    })).sort((a, b) => b.total - a.total);

    resultEl.innerHTML = `
    <div class="mod-grid" style="margin-bottom:16px">
        <div class="mod-card"><div class="mod-card-icon" style="background:#FFFBEB;color:#D97706">↩️</div><div class="mod-card-val">${perfFmt(salesTotal)}</div><div class="mod-card-lbl">إجمالي مرتجعات البيع</div></div>
        <div class="mod-card"><div class="mod-card-icon" style="background:#EFF6FF;color:#2563EB">↩️</div><div class="mod-card-val">${perfFmt(purchaseTotal)}</div><div class="mod-card-lbl">إجمالي مرتجعات الشراء</div></div>
        <div class="mod-card"><div class="mod-card-icon" style="background:#F1F5F9;color:#475569">Σ</div><div class="mod-card-val">${perfFmt(salesTotal + purchaseTotal)}</div><div class="mod-card-lbl">إجمالي المرتجعات</div></div>
    </div>
    ${repRows.length ? `
    <div class="mod-table-wrap" style="margin-bottom:20px">
        <div style="padding:14px 18px 0;font-weight:800;font-size:14px;color:#1E293B">مرتجعات البيع حسب المندوب</div>
        <table class="mod-table"><thead><tr>
            <th>المندوب</th><th style="text-align:center">عدد المرتجعات</th><th style="text-align:left">الإجمالي</th>
        </tr></thead><tbody>
            ${repRows.map(r => `<tr>
                <td><strong>${r.name}</strong></td>
                <td style="text-align:center">${r.count}</td>
                <td style="text-align:left;font-weight:700">${perfFmt(r.total)}</td>
            </tr>`).join('')}
        </tbody></table>
    </div>` : ''}
    <div class="mod-table-wrap">
        <div style="padding:14px 18px 0;font-weight:800;font-size:14px;color:#1E293B">كل المرتجعات</div>
        <table class="mod-table"><thead><tr>
            <th>النوع</th><th>رقم المرتجع</th><th>الاسم</th><th style="text-align:left">المبلغ</th><th>التاريخ</th>
        </tr></thead><tbody>
            ${rows.length ? rows.map(r => `<tr>
                <td>${r.kind === 'sale' ? '<span style="color:#D97706">🛒 مرتجع بيع</span>' : '<span style="color:#2563EB">📥 مرتجع شراء</span>'}</td>
                <td style="font-family:monospace;font-size:12px">${r.no || '—'}</td>
                <td>${r.name}</td>
                <td style="text-align:left;font-weight:700">${perfFmt(r.amount)}</td>
                <td style="font-size:12px;color:#94A3B8">${new Date(r.created_at).toLocaleDateString('ar-EG')}</td>
            </tr>`).join('') : `<tr><td colspan="5" class="empty-state"><span>📭</span>لا توجد مرتجعات مطابقة</td></tr>`}
        </tbody></table>
    </div>${PRF_ACTIONS_HTML}`;
    window._prfExportName = 'المرتجعات';
    window._prfPrintTitle = 'تقرير المرتجعات';
    window._prfExportRows = rows.map(r => ({ النوع: r.kind === 'sale' ? 'مرتجع بيع' : 'مرتجع شراء', 'رقم المرتجع': r.no || '—', الاسم: r.name, المبلغ: r.amount, التاريخ: new Date(r.created_at).toLocaleDateString('ar-EG') }));
}

Object.assign(window, {
    renderPerformanceReports, prfSwitchTab,
    prfLoadByProduct, prfLoadByCustomer, prfLoadByRep, prfLoadCompare,
    prfLoadPayments, prfFilterPayments, prfLoadReturns, prfFilterReturns,
});
