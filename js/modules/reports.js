// ════════════════════════════════════════════════════════════
// reports.js — التقارير المالية
// يصدّر: renderReports(container)
// ════════════════════════════════════════════════════════════

// ★ Supabase بيرجع 1000 صف كحد أقصى افتراضي لأي select عادي من غير فلتر
//   يضيّق النتيجة — sale_items/sale_return_items بقوا أكتر من كده بعد
//   نقل البيانات التاريخية، فقائمة الدخل كانت بتحسب تكلفة البضاعة
//   المباعة غلط (ناقصة) لأي فترة بترجع أكتر من 1000 سطر صنف. نفس نمط
//   الإصلاح المستخدم في accounting.js/cash-movement.js/sales-reps.js.
// ★ نقطة قفل الفترة التاريخية: آخر بيانات منقولة من ديكسف كانت بتاريخ
//   2026-07-17، فالتشغيل الفعلي المباشر لسلطان بدأ 2026-07-18. الفترة
//   قبل التاريخ ده فيها تسويات ترحيل لمرة واحدة (رأس مال، تصحيحات أرصدة)
//   مش جزء من الأداء التشغيلي العادي، فمش المفروض قائمة الدخل تشملها
//   بشكل افتراضي — لازم تُختار يدويًا لو حد عايز يراجعها تحديدًا.
const SULTAN_LIVE_CUTOVER = '2026-07-18';

async function plFetchAllRows(table, select, applyFilters) {
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

// ════════════════════════════════════════════════════════════
// أدوات شاشتي «كشف حساب عميل / مورد» (أرصدة العملاء والموردين)
// دوال صافية (من غير DOM ولا Supabase) عشان تتراجع وتتجرب بسهولة.
// ════════════════════════════════════════════════════════════
function balRvEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function balRvToday() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function balRvDate(s) { return s ? new Date(String(s).slice(0, 10) + 'T00:00:00') : null; }
function balRvDaysBetween(a, b) { return Math.round((a - b) / 86400000); } // a - b بالأيام
function balRvDateStr(s) { return s ? String(s).slice(0, 10) : ''; }
function balRvAgo(days) { return days <= 0 ? 'النهارده' : days === 1 ? 'أمس' : 'منذ ' + days + ' يوم'; }

// حالة الاستحقاق: late / soon / ok / nodue / none
function balRvDueStatus(balance, dueStr, today) {
    if (!(Number(balance) > 0.005)) return { key: 'none', label: '—', days: 0 };
    const due = balRvDate(dueStr);
    if (!due) return { key: 'nodue', label: 'بدون ميعاد', days: 0 };
    const diff = balRvDaysBetween(today, due); // موجب = متأخر
    if (diff > 0) return { key: 'late', label: 'متأخر ' + diff + ' يوم', days: diff };
    if (diff >= -7) return { key: 'soon', label: diff === 0 ? 'يستحق النهارده' : 'خلال ' + (-diff) + ' أيام', days: diff };
    return { key: 'ok', label: 'قادم', days: diff };
}

// أعمار المديونية بافتراض إن السداد بيغطي الأقدم أول (FIFO): الرصيد الحالي
// بيتوزّع على أحدث فواتير الآجل، وأي جزء مالوش فاتورة (رصيد افتتاحي/تحويل)
// بيتحسب في خانة «+90 / افتتاحي».
function balRvAging(balance, invoices, nowMs) {
    const out = { b30: 0, b60: 0, b90: 0, b90p: 0 };
    let remaining = Number(balance) || 0;
    if (remaining <= 0.005) return out;
    const inv = (invoices || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    for (const i of inv) {
        if (remaining <= 0.005) break;
        const take = Math.min(Number(i.total) || 0, remaining);
        if (take <= 0) continue;
        remaining -= take;
        const age = Math.floor((nowMs - new Date(i.created_at).getTime()) / 86400000);
        if (age <= 30) out.b30 += take;
        else if (age <= 60) out.b60 += take;
        else if (age <= 90) out.b90 += take;
        else out.b90p += take;
    }
    if (remaining > 0.005) out.b90p += remaining;
    return out;
}

// حالة الحد الائتماني: none / nolimit / over / within
function balRvLimitState(balance, limit) {
    const bal = Number(balance) || 0, lim = Number(limit) || 0;
    if (bal <= 0.005) return { key: 'none', over: 0 };
    if (lim <= 0) return { key: 'nolimit', over: 0 };
    return bal > lim ? { key: 'over', over: bal - lim } : { key: 'within', over: 0 };
}

// أولوية المتابعة: 1 عاجل / 2 مهم / 3 عادي / 9 مفيش رصيد
function balRvPriority(balance, dueKey, limitKey, locked) {
    if (!(Number(balance) > 0.005)) return 9;
    if (dueKey === 'late' || limitKey === 'over' || locked) return 1;
    if ((dueKey === 'nodue' || limitKey === 'nolimit') && Number(balance) >= 1000) return 2;
    return 3;
}
function balRvPriorityLabel(p) { return p === 1 ? '1 عاجل' : p === 2 ? '2 مهم' : p === 3 ? '3 عادي' : '—'; }
// بداية فترة الدفعة المستهدفة: يومي = بداية النهارده، أسبوعي = آخر ٧ أيام، شهري = أول الشهر
function balRvPeriodStart(sched, nowMs) {
    const d = new Date(nowMs);
    if (sched === 'weekly') return nowMs - 7 * 86400000;
    if (sched === 'monthly') return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function balRvSchedLabel(s) { return s === 'weekly' ? 'أسبوعي' : s === 'monthly' ? 'شهري' : 'يومي'; }
// رابط واتساب من رقم مصري (01xxxxxxxxx أو 201xxxxxxxxx أو +201xxxxxxxxx)
function balRvWaLink(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('0')) d = '20' + d.slice(1);
    else if (!d.startsWith('20')) d = '20' + d;
    return 'https://wa.me/' + d;
}
function balRvBadge(key, text) {
    const map = {
        late: ['#FEE4E2', '#B42318'], soon: ['#FFEDD5', '#B54708'], nodue: ['#FEF3C7', '#8A6100'],
        ok: ['#D1FADF', '#067647'], none: ['#F1F5F9', '#64748B'], over: ['#FEE4E2', '#B42318'],
        nolimit: ['#FEF3C7', '#8A6100'], within: ['#D1FADF', '#067647'], p1: ['#FEE4E2', '#B42318'],
        p2: ['#FFEDD5', '#B54708'], p3: ['#F1F5F9', '#475569']
    };
    const c = map[key] || map.none;
    return '<span style="display:inline-block;padding:1px 8px;border-radius:999px;font-size:11.5px;font-weight:700;background:' + c[0] + ';color:' + c[1] + ';white-space:nowrap">' + balRvEsc(text) + '</span>';
}

async function renderReports(container) {
    let activeReport = 'pl';
    let _repDefSuppliers = [];
    let _repDefManual = [];
    const fmt = n => Number(n||0).toLocaleString('ar-EG',{minimumFractionDigits:2,maximumFractionDigits:2});

    const reportTabs = [
        { id:'pl', label:'📊 قائمة الدخل' },
        { id:'customers', label:'👥 كشف حساب عميل' },
        { id:'suppliers', label:'🏭 كشف حساب مورد' },
        { id:'vat', label:'🧾 تقرير VAT' },
        { id:'deferred', label:'⏳ المؤجلات' },
    ];

    container.innerHTML = `
    <div class="rep-wrap">
        <div class="dash-header">
            <div><h2 class="dash-title">📈 التقارير المالية</h2><p class="dash-sub">تقارير شاملة من بيانات النظام الحية</p></div>
        </div>
        <div class="ob-tabs">
            ${reportTabs.map(t => `<button class="ob-tab rep-tab-btn" data-rep="${t.id}" onclick="repSwitch('${t.id}')">${t.label}</button>`).join('')}
        </div>
        <div id="rep-content" style="margin-top:16px"></div>
    </div>`;

    document.querySelector(`.rep-tab-btn[data-rep="${activeReport}"]`)?.classList.add('active');

    window.repSwitch = (id) => {
        document.querySelectorAll('.rep-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.rep === id));
        renderReportContent(id);
    };

    async function renderReportContent(id) {
        const c = document.getElementById('rep-content');
        c.innerHTML = `<div style="text-align:center;padding:40px;color:var(--inv-muted)">⏳ جاري التحميل...</div>`;

        if (id === 'pl') return renderPL(c);
        if (id === 'customers') return renderCustomerStatement(c);
        if (id === 'suppliers') return renderSupplierStatement(c);
        if (id === 'vat') return renderVAT(c);
        if (id === 'deferred') return renderDeferred(c);
    }

    // ─────────────────────────────────────────
    // 1) قائمة الدخل P&L
    // ─────────────────────────────────────────
    async function plComputeTotals(from, to) {
        const [{ data: sales }, { data: expenses }, { data: salesReturns }, { data: saleItemsCost }, { data: returnItemsCost }, { data: collectionDiscounts }] = await Promise.all([
            sb.from('sales').select('total,subtotal').eq('status','confirmed').gte('created_at', from).lte('created_at', to + 'T23:59:59'),
            sb.from('expenses').select('amount').eq('status','confirmed').gte('expense_date', from).lte('expense_date', to),
            sb.from('sales_returns').select('total').eq('status','confirmed').gte('created_at', from).lte('created_at', to + 'T23:59:59'),
            // تكلفة البضاعة المباعة الفعلية = تكلفة الصنف وقت البيع (cost_price_snapshot) وليست
            // قيمة المشتريات في نفس الفترة — الشراء بيغذي المخزون، مش بالضرورة بيتباع في نفس الفترة.
            // مفلترة بـ plFetchAllRows عشان أسطر الأصناف بقت أكتر من حد الـ1000 صف الافتراضي.
            plFetchAllRows('sale_items', 'qty, cost_price_snapshot, sales!inner(created_at, status)', (q) =>
                q.eq('sales.status', 'confirmed').gte('sales.created_at', from).lte('sales.created_at', to + 'T23:59:59')),
            plFetchAllRows('sale_return_items', 'qty, cost_price_snapshot, sales_returns!inner(created_at, status)', (q) =>
                q.eq('sales_returns.status', 'confirmed').gte('sales_returns.created_at', from).lte('sales_returns.created_at', to + 'T23:59:59')),
            // خصم العميل وقت التحصيل (collections.js) — بيقفل جزء من المديونية من غير نقدية فعلية،
            // فمحتاج يترحّل كخسارة حقيقية هنا برضه، مش بس في حساب 5016 بالقيد المحاسبي.
            sb.from('customer_payments').select('discount').eq('status','confirmed').gte('created_at', from).lte('created_at', to + 'T23:59:59'),
        ]);
        const totalSales = (sales||[]).reduce((s,r)=>s+Number(r.total),0);
        const totalReturns = (salesReturns||[]).reduce((s,r)=>s+Number(r.total),0);
        const netSales = totalSales - totalReturns;
        const cogsSales = (saleItemsCost||[]).reduce((s,it)=>s+(Number(it.qty)||0)*(Number(it.cost_price_snapshot)||0),0);
        const cogsReturns = (returnItemsCost||[]).reduce((s,it)=>s+(Number(it.qty)||0)*(Number(it.cost_price_snapshot)||0),0);
        const totalCOGS = cogsSales - cogsReturns;
        const totalExpenses = (expenses||[]).reduce((s,r)=>s+Number(r.amount),0);
        const totalCollectionDiscounts = (collectionDiscounts||[]).reduce((s,r)=>s+(Number(r.discount)||0),0);
        const netProfit = netSales - totalCOGS - totalExpenses - totalCollectionDiscounts;
        const margin = netSales > 0 ? (netProfit/netSales*100) : 0;
        return { totalSales, totalReturns, netSales, cogsSales, cogsReturns, totalCOGS, totalExpenses, totalCollectionDiscounts, netProfit, margin };
    }

    // اتجاه الربح آخر 6 شهور (أو أقل لو النظام لسه عمره أقل من كده) — بيتوقف
    // عند SULTAN_LIVE_CUTOVER عشان مايخلطش بتسويات الترحيل القديمة.
    // ★ dStr بيبني السترينج من مكوّنات التاريخ المحلي مباشرة، مش عن طريق
    //   toISOString() (بيحوّل لتوقيت UTC ويرحّل التاريخ يوم لورا بصمت فى
    //   توقيت زي القاهرة GMT+3) — نفس الإصلاح المطبّق فى performance-reports.js.
    async function plRenderTrend() {
        const el = document.getElementById('pl-trend-chart');
        if (!el) return;
        const dStr = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const today = new Date();
        const months = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const mFrom = dStr(d);
            const monthEnd = dStr(new Date(today.getFullYear(), today.getMonth() - i + 1, 0));
            if (mFrom < SULTAN_LIVE_CUTOVER && monthEnd < SULTAN_LIVE_CUTOVER) continue;
            const mFromAdj = mFrom < SULTAN_LIVE_CUTOVER ? SULTAN_LIVE_CUTOVER : mFrom;
            const mTo = i === 0 ? dStr(today) : monthEnd;
            months.push({ label: d.toLocaleDateString('ar-EG', { month: 'short' }), from: mFromAdj, to: mTo });
        }
        try {
            const results = await Promise.all(months.map(m => plComputeTotals(m.from, m.to)));
            const data = months.map((m, i) => ({ label: m.label, value: results[i].netProfit }));
            el.innerHTML = repMiniBarSVG(data);
        } catch {
            el.innerHTML = '<p style="color:var(--inv-muted-light);font-size:12px">تعذّر تحميل الرسم البياني</p>';
        }
    }

    async function renderPL(c) {
        const today = new Date();
        const monthStartStr = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0,10);
        const fromDefault = monthStartStr < SULTAN_LIVE_CUTOVER ? SULTAN_LIVE_CUTOVER : monthStartStr;
        const toDefault = today.toISOString().slice(0,10);

        const load = async (from, to) => {
            const { totalSales, totalReturns, netSales, cogsSales, cogsReturns, totalCOGS, totalExpenses, totalCollectionDiscounts, netProfit, margin } = await plComputeTotals(from, to);

            c.innerHTML = `
            <div class="dash-card" style="padding:20px;margin-bottom:16px">
                <div class="dash-card-header" style="margin-bottom:6px"><span>📈 اتجاه صافي الربح — آخر 6 شهور</span></div>
                <div id="pl-trend-chart"><p style="color:var(--inv-muted-light);font-size:12px">⏳ جاري التحميل...</p></div>
            </div>
            <div class="dash-card" style="padding:20px;margin-bottom:16px">
                <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
                    <div><label class="ob-label">من تاريخ</label><input type="date" id="pl-from" class="ob-input" style="margin:0" value="${from}"></div>
                    <div><label class="ob-label">إلى تاريخ</label><input type="date" id="pl-to" class="ob-input" style="margin:0" value="${to}"></div>
                    <button class="ob-save-btn" style="margin:0" onclick="renderReports(document.getElementById('app-content'))">إلغاء</button>
                    <button class="ob-add-btn" onclick="window._plReload()">🔍 تطبيق</button>
                </div>
            </div>
            ${from < SULTAN_LIVE_CUTOVER ? `
            <div style="background:var(--inv-gold-bg);border:1px solid #FCD34D;color:var(--inv-gold);padding:12px 16px;border-radius:10px;margin-bottom:16px;font-size:12px">
                ⚠️ الفترة دي بتشمل بيانات منقولة من ديكسف (قبل ${SULTAN_LIVE_CUTOVER}) فيها تسويات ترحيل لمرة واحدة (رأس مال، تصحيحات أرصدة) مش جزء من الأداء التشغيلي العادي — عشان كده الرقم هنا مش متوقع يطابق "صافي المركز المالي" في الداشبورد. للأداء الفعلي المستمر استخدم فترة تبدأ من ${SULTAN_LIVE_CUTOVER}.
            </div>` : ''}
            <div class="dash-card" style="padding:24px;max-width:550px" id="pl-card">
                <h3 style="margin:0 0 16px;font-size:15px">قائمة الدخل (${from} إلى ${to})</h3>
                <div class="dash-summary-row"><span>صافي المبيعات</span><span class="dash-s-green">${fmt(netSales)}</span></div>
                <div class="dash-summary-row" style="font-size:11px;color:var(--inv-muted-light)"><span>(إجمالي ${fmt(totalSales)} - مرتجعات ${fmt(totalReturns)})</span><span></span></div>
                <div class="dash-summary-row"><span>(-) تكلفة البضاعة المباعة</span><span class="dash-s-red">${fmt(totalCOGS)}</span></div>
                <div class="dash-summary-row" style="font-size:11px;color:var(--inv-muted-light)"><span>(تكلفة مبيعات ${fmt(cogsSales)} - تكلفة مرتجعات ${fmt(cogsReturns)})</span><span></span></div>
                <div class="dash-summary-row"><span>(-) إجمالي المصروفات</span><span class="dash-s-red">${fmt(totalExpenses)}</span></div>
                ${totalCollectionDiscounts > 0 ? `<div class="dash-summary-row"><span>(-) خصومات تحصيل من العملاء</span><span class="dash-s-red">${fmt(totalCollectionDiscounts)}</span></div>` : ''}
                <div class="dash-summary-divider"></div>
                <div class="dash-summary-row dash-summary-total">
                    <span>${netProfit>=0?'✅ صافي الربح':'📉 صافي الخسارة'}</span>
                    <span style="color:${netProfit>=0?'var(--inv-green)':'var(--inv-red)'}">${fmt(Math.abs(netProfit))}</span>
                </div>
                <div class="dash-summary-row" style="font-size:11px;color:var(--inv-muted-light)"><span>هامش الربح</span><span>${margin.toFixed(1)}%</span></div>
            </div>
            <div style="display:flex;gap:10px;margin-top:14px">
                <button class="mod-btn" onclick="window._plExport()">📊 تصدير Excel</button>
                <button class="mod-btn" onclick="window._plPrint()">🖨️ طباعة</button>
            </div>`;

            window._plReload = () => {
                const f = document.getElementById('pl-from').value;
                const t = document.getElementById('pl-to').value;
                load(f, t);
            };
            window._plExport = () => repExportExcel('قائمة_الدخل', [
                { البند: 'صافي المبيعات', القيمة: netSales },
                { البند: 'إجمالي المبيعات', القيمة: totalSales },
                { البند: 'مرتجعات المبيعات', القيمة: totalReturns },
                { البند: 'تكلفة البضاعة المباعة', القيمة: totalCOGS },
                { البند: 'إجمالي المصروفات', القيمة: totalExpenses },
                { البند: 'خصومات تحصيل من العملاء', القيمة: totalCollectionDiscounts },
                { البند: netProfit >= 0 ? 'صافي الربح' : 'صافي الخسارة', القيمة: Math.abs(netProfit) },
                { البند: 'هامش الربح %', القيمة: margin.toFixed(1) },
            ]);
            window._plPrint = () => repPrintReport(`قائمة الدخل (${from} إلى ${to})`, document.getElementById('pl-card').outerHTML);
            plRenderTrend();
        };
        load(fromDefault, toDefault);
    }

    // ─────────────────────────────────────────
    // 2) كشف حساب عميل — شاشة مراجعة الأرصدة: حالة الاستحقاق، الحد الائتماني،
    //    أعمار المديونية (FIFO)، آخر تحصيل، وأولوية المتابعة. زرار «كشف حساب»
    //    لسه بيفتح نفس المودال الغني في customers.js.
    // ─────────────────────────────────────────
    async function renderCustomerStatement(c) {
        const today = balRvToday(), nowMs = Date.now();
        const [custRes, repRes, grpRes, clsRes, regRes] = await Promise.all([
            sb.from('customers').select('id,name,phone,balance,credit_limit,payment_due_date,debt_locked,default_rep_id,primary_rep_id,group_id,classification_id,region_id,daily_payment_target,payment_schedule').order('name'),
            sb.from('sales_reps').select('id,name'),
            sb.from('customer_groups').select('id,name'),
            sb.from('customer_classifications').select('id,name'),
            sb.from('customer_regions').select('id,name')
        ]);
        if (custRes.error) { c.innerHTML = `<div class="dash-card" style="padding:16px;color:var(--inv-red)">❌ تعذّر تحميل العملاء: ${balRvEsc(custRes.error.message)}</div>`; return; }
        const nameMap = res => { const m = {}; (res.data || []).forEach(x => { m[x.id] = x.name; }); return m; };
        const repMap = nameMap(repRes), grpMap = nameMap(grpRes), clsMap = nameMap(clsRes), regMap = nameMap(regRes);
        const customers = custRes.data || [];
        // أعمار المديونية الدقيقة (FIFO) من قاعدة البيانات — لو الدالة مش متاحة نرجع للحساب المحلي التقريبي
        const agRes = await sb.rpc('fn_customer_aging').then(r => r, () => ({ data: null, error: true }));
        const agMap = {};
        if (!agRes.error && Array.isArray(agRes.data)) agRes.data.forEach(a => { agMap[a.customer_id] = a; });
        const agExact = !agRes.error && Array.isArray(agRes.data);
        const debtorIds = customers.filter(x => Number(x.balance) > 0.005).map(x => x.id);
        const salesBy = {}, payBy = {};
        if (debtorIds.length) {
            const [sRes, pRes] = await Promise.all([
                plFetchAllRows('sales', 'customer_id,total,created_at', q => q.in('customer_id', debtorIds).eq('status', 'confirmed').eq('payment_type', 'credit').order('created_at', { ascending: false })),
                plFetchAllRows('customer_payments', 'customer_id,amount,created_at', q => q.in('customer_id', debtorIds).eq('status', 'confirmed').order('created_at', { ascending: false }))
            ]);
            (sRes.data || []).forEach(r => { (salesBy[r.customer_id] = salesBy[r.customer_id] || []).push(r); });
            (pRes.data || []).forEach(r => { (payBy[r.customer_id] = payBy[r.customer_id] || []).push(r); });
        }
        const rows = customers.map(cu => {
            const bal = Number(cu.balance) || 0;
            const due = balRvDueStatus(bal, cu.payment_due_date, today);
            const lim = balRvLimitState(bal, cu.credit_limit);
            const inv = salesBy[cu.id] || [], pays = payBy[cu.id] || [];
            const target = Number(cu.daily_payment_target) || 0, sched = cu.payment_schedule || 'daily';
            const from = balRvPeriodStart(sched, nowMs);
            const collected = pays.reduce((s, p) => new Date(p.created_at).getTime() >= from ? s + (Number(p.amount) || 0) : s, 0);
            const tState = (!(target > 0) || !(bal > 0.005)) ? 'none' : collected >= target - 0.005 ? 'done' : collected > 0 ? 'part' : 'miss';
            return {
                id: cu.id, name: cu.name || '', phone: cu.phone || '',
                rep: repMap[cu.default_rep_id || cu.primary_rep_id] || '', group: grpMap[cu.group_id] || '',
                cls: clsMap[cu.classification_id] || '', region: regMap[cu.region_id] || '',
                bal, limit: Number(cu.credit_limit) || 0, due, dueDate: balRvDateStr(cu.payment_due_date), lim,
                ag: agMap[cu.id]
                    ? { b30: Number(agMap[cu.id].b0_30) || 0, b60: Number(agMap[cu.id].b31_60) || 0, b90: Number(agMap[cu.id].b61_90) || 0, b90p: Number(agMap[cu.id].b90p) || 0, open: Number(agMap[cu.id].opening_undated) || 0 }
                    : Object.assign(balRvAging(bal, inv, nowMs), { open: 0 }),
                locked: !!cu.debt_locked,
                lastInv: inv[0] || null, lastPay: pays[0] || null,
                target, sched, collected, tState,
                pr: balRvPriority(bal, due.key, lim.key, !!cu.debt_locked)
            };
        });

        let search = '', filter = 'debt';
        const sel = { group: '', cls: '', rep: '', region: '' };
        const filters = {
            debt: r => r.bal > 0.005, urgent: r => r.pr === 1, late: r => r.due.key === 'late', over: r => r.lim.key === 'over',
            nodue: r => r.due.key === 'nodue', nolimit: r => r.lim.key === 'nolimit', locked: r => r.locked && r.bal > 0.005,
            tmiss: r => r.tState === 'miss' || r.tState === 'part', all: () => true
        };
        const sum = (arr, f) => arr.reduce((s, r) => s + f(r), 0);
        const passSel = r => (!sel.group || r.group === sel.group) && (!sel.cls || r.cls === sel.cls) && (!sel.rep || r.rep === sel.rep) && (!sel.region || r.region === sel.region);
        const currentRows = () => flexSearch(rows.filter(filters[filter] || filters.debt).filter(passSel), search, ['name', 'phone'])
            .slice().sort((a, b) => (a.pr - b.pr) || (b.bal - a.bal));

        const debtors = rows.filter(filters.debt);
        const kpis = [
            { id: 'debt', label: 'عليهم رصيد', arr: debtors, val: r => r.bal },
            { id: 'urgent', label: '🔴 عاجل', arr: rows.filter(filters.urgent), val: r => r.bal },
            { id: 'late', label: 'متأخر عن الميعاد', arr: rows.filter(filters.late), val: r => r.bal },
            { id: 'over', label: 'فوق الحد الائتماني (قيمة التجاوز)', arr: rows.filter(filters.over), val: r => r.lim.over },
            { id: 'tmiss', label: 'دفعة مستهدفة لم تتحقق (الناقص)', arr: rows.filter(filters.tmiss), val: r => Math.max(0, r.target - r.collected) },
            { id: 'nodue', label: 'بدون ميعاد استحقاق', arr: rows.filter(filters.nodue), val: r => r.bal },
            { id: 'nolimit', label: 'بدون حد ائتماني', arr: rows.filter(filters.nolimit), val: r => r.bal }
        ];
        const ageTot = { b30: sum(debtors, r => r.ag.b30), b60: sum(debtors, r => r.ag.b60), b90: sum(debtors, r => r.ag.b90), b90p: sum(debtors, r => r.ag.b90p), open: sum(debtors, r => r.ag.open || 0) };
        const ageAll = ageTot.b30 + ageTot.b60 + ageTot.b90 + ageTot.b90p + ageTot.open;
        const olderPct = ageAll > 0 ? ((ageTot.b60 + ageTot.b90 + ageTot.b90p + ageTot.open) / ageAll * 100) : 0;
        const uniq = key => Array.from(new Set(rows.map(r => r[key]).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ar'));
        const selHtml = (label, key) => `<select class="ob-input" style="margin:0;width:auto;min-width:130px" onchange="window._csSel('${key}', this.value)"><option value="">${label}: الكل</option>${uniq(key).map(v => `<option value="${balRvEsc(v)}">${balRvEsc(v)}</option>`).join('')}</select>`;

        const renderKpis = () => {
            const el = document.getElementById('cs-kpis'); if (!el) return;
            el.innerHTML = kpis.map(k => `<div onclick="window._csFilter('${k.id}')" style="cursor:pointer;background:var(--inv-card);border:1.5px solid ${filter === k.id ? 'var(--inv-gold)' : 'var(--inv-border)'};border-radius:12px;padding:10px 12px">
                <div style="font-size:12px;color:var(--inv-muted)">${k.label}</div>
                <div style="font-size:20px;font-weight:800">${k.arr.length}</div>
                <div style="font-size:12.5px;font-weight:700">${fmt(sum(k.arr, k.val))}</div></div>`).join('');
        };
        const targetCell = r => {
            if (!(r.target > 0)) return '<span style="color:var(--inv-muted)">—</span>';
            const badge = r.tState === 'done' ? balRvBadge('ok', 'تحققت ✓') : r.tState === 'part' ? balRvBadge('soon', 'جزئي') : r.tState === 'miss' ? balRvBadge('late', 'لم تُحصَّل') : '';
            return `<b>${fmt(r.target)}</b> <span style="color:var(--inv-muted)">/ ${balRvSchedLabel(r.sched)}</span><div style="margin-top:2px">${badge}</div><div style="font-size:11.5px;color:var(--inv-muted)">المحصّل: ${fmt(r.collected)}</div>`;
        };
        const renderRows = () => {
            const body = document.getElementById('cs-list-body'); if (!body) return;
            const list = currentRows();
            const countEl = document.getElementById('cs-count'); if (countEl) countEl.textContent = list.length + ' عميل';
            body.innerHTML = !list.length ? `<tr><td colspan="11" class="empty-state"><span>👥</span>لا يوجد عملاء مطابقين</td></tr>` :
                list.map(r => {
                    const ag = r.bal > 0.005 ? [['0-30', r.ag.b30], ['31-60', r.ag.b60], ['61-90', r.ag.b90], ['+90', r.ag.b90p], ['افتتاحي', r.ag.open || 0]].filter(x => x[1] > 0.005).map(x => `<div>${x[0]}: <b>${fmt(x[1])}</b></div>`).join('') : '';
                    const lastPay = r.lastPay ? `${balRvDateStr(r.lastPay.created_at)}<div><b>${fmt(r.lastPay.amount)}</b> · ${balRvAgo(Math.max(0, Math.floor((nowMs - new Date(r.lastPay.created_at).getTime()) / 86400000)))}</div>` : (r.bal > 0.005 ? '<span style="color:var(--inv-red)">لم يسدد</span>' : '');
                    const wa = balRvWaLink(r.phone);
                    const phone = r.phone ? `<a href="tel:${balRvEsc(r.phone)}" style="color:inherit;text-decoration:none;direction:ltr;unicode-bidi:embed">${balRvEsc(r.phone)}</a>${wa ? ` <a href="${wa}" target="_blank" rel="noopener" title="واتساب" style="text-decoration:none">💬</a>` : ''}` : '<span style="color:var(--inv-muted)">—</span>';
                    return `<tr>
                        <td><strong>${balRvEsc(r.name)}</strong>${r.locked ? ' 🔒' : ''}<div style="font-size:11.5px;color:var(--inv-muted)">${r.rep ? '🚗 ' + balRvEsc(r.rep) : ''}${r.region ? ' · 📍 ' + balRvEsc(r.region) : ''}</div></td>
                        <td style="font-size:12.5px;white-space:nowrap">${phone}</td>
                        <td style="text-align:center">${r.group ? `<span style="display:inline-block;padding:1px 9px;border-radius:999px;font-size:11.5px;font-weight:700;background:var(--inv-divider);border:1px solid var(--inv-border);color:var(--inv-text-soft)">${balRvEsc(r.group)}</span>` : '<span style="color:var(--inv-muted)">—</span>'}${r.cls ? `<div style="font-size:11px;color:var(--inv-muted);margin-top:2px">${balRvEsc(r.cls)}</div>` : ''}</td>
                        <td style="text-align:left;font-weight:700;color:${r.bal > 0 ? 'var(--inv-red)' : 'var(--inv-green)'}">${fmt(r.bal)}</td>
                        <td style="text-align:left;font-size:12px">${r.limit ? fmt(r.limit) : '—'}<div>${r.bal > 0.005 ? balRvBadge(r.lim.key, r.lim.key === 'over' ? 'فوق الحد +' + fmt(r.lim.over) : r.lim.key === 'nolimit' ? 'بدون حد' : 'ضمن الحد') : ''}</div></td>
                        <td style="text-align:center">${balRvBadge(r.due.key, r.due.label)}<div style="font-size:11.5px;color:var(--inv-muted)">${r.dueDate}</div></td>
                        <td style="font-size:12px;text-align:left">${ag}</td>
                        <td style="font-size:12px;text-align:center">${targetCell(r)}</td>
                        <td style="font-size:12px;text-align:center">${lastPay}</td>
                        <td style="text-align:center">${balRvBadge('p' + (r.pr > 3 ? 3 : r.pr), balRvPriorityLabel(r.pr))}</td>
                        <td style="text-align:center"><button class="cc-edit" style="background:var(--inv-gold-bg);color:var(--inv-gold)" onclick="custShowStatement('${r.id}')">📄 كشف حساب</button></td>
                    </tr>`;
                }).join('');
        };
        c.innerHTML = `
        <div class="dash-card" style="padding:16px;margin-bottom:12px">
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                <input type="text" id="cs-search" class="ob-input" style="margin:0;flex:1;min-width:180px" placeholder="🔍 بحث بالاسم أو الهاتف..." oninput="window._csSearch(this.value)">
                <button class="cc-edit" onclick="window._csFilter('all')">كل العملاء</button>
                <button class="cc-edit" onclick="window._csExport()">📥 Excel</button>
                <button class="cc-edit" onclick="window._csPrint()">🖨️ طباعة</button>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${selHtml('المجموعة', 'group')}${selHtml('التصنيف', 'cls')}${selHtml('المندوب', 'rep')}${selHtml('المنطقة', 'region')}<button class="cc-edit" onclick="window._csResetFilters()">↺ مسح الفلاتر</button></div>
            <div style="font-size:12px;color:var(--inv-muted);margin-top:8px">الأعمار (FIFO): كل سداد (تحصيل + خصم + مرتجع آجل + تحويل صادر) بيغطي الأقدم أول، والدين الافتتاحي اللي مالوش فاتورة هو الأقدم وبيظهر لوحده في خانة «افتتاحي» بدل ما يتخلط مع +90. الدفعة المستهدفة: يومي = المحصّل النهارده، أسبوعي = آخر ٧ أيام، شهري = من أول الشهر. الأولوية: 1 عاجل = متأخر أو فوق الحد أو موقوف، 2 مهم = بدون ميعاد/حد ورصيد ≥ ١٬٠٠٠.</div>
        </div>
        <div id="cs-kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px"></div>
        <div class="dash-card" style="padding:10px 14px;margin-bottom:12px;font-size:13px">
            أعمار المديونية: 0-30 يوم <b>${fmt(ageTot.b30)}</b> · 31-60 <b>${fmt(ageTot.b60)}</b> · 61-90 <b>${fmt(ageTot.b90)}</b> · +90 <b>${fmt(ageTot.b90p)}</b> · افتتاحي غير مؤرَّخ <b>${fmt(ageTot.open)}</b> · الأقدم من 30 يوم: <b style="color:${olderPct > 20 ? 'var(--inv-red)' : 'var(--inv-green)'}">${olderPct.toFixed(1)}%</b>
            ${agExact ? '' : '<div style="font-size:11.5px;color:var(--inv-muted);margin-top:4px">⚠️ تقدير محلي تقريبي (تعذّر تحميل الحساب الدقيق من قاعدة البيانات).</div>'}
        </div>
        <div style="font-size:12px;color:var(--inv-muted);margin:0 4px 6px" id="cs-count"></div>
        <div class="mod-table-wrap" id="cs-table-card" style="overflow-x:auto">
            <table class="mod-table" style="min-width:1250px"><thead><tr><th>العميل</th><th>الهاتف</th><th style="text-align:center">المجموعة</th><th style="text-align:left">الرصيد</th><th style="text-align:left">الحد الائتماني</th><th style="text-align:center">الاستحقاق</th><th style="text-align:left">الأعمار</th><th style="text-align:center">الدفعة المستهدفة</th><th style="text-align:center">آخر تحصيل</th><th style="text-align:center">الأولوية</th><th style="text-align:center">إجراءات</th></tr></thead>
            <tbody id="cs-list-body"></tbody></table>
        </div>`;
        window._csSearch = (v) => { search = v; renderRows(); };
        window._csFilter = (f) => { filter = f; renderKpis(); renderRows(); };
        window._csSel = (k, v) => { sel[k] = v; renderRows(); };
        window._csResetFilters = () => {
            search = ''; filter = 'debt'; sel.group = sel.cls = sel.rep = sel.region = '';
            const box = document.getElementById('cs-search'); if (box) box.value = '';
            c.querySelectorAll && c.querySelectorAll('select.ob-input').forEach(s => { s.value = ''; });
            renderKpis(); renderRows();
        };
        window._csExport = () => repExportExcel('أرصدة_العملاء', currentRows().map(r => ({
            'العميل': r.name, 'التليفون': r.phone, 'المجموعة': r.group, 'التصنيف': r.cls, 'المنطقة': r.region, 'المندوب': r.rep,
            'الرصيد': r.bal, 'الحد الائتماني': r.limit, 'تجاوز الحد': r.lim.over,
            'ميعاد الاستحقاق': r.dueDate, 'حالة الاستحقاق': r.due.label, 'موقوف': r.locked ? 'نعم' : 'لا',
            '0-30': r.ag.b30, '31-60': r.ag.b60, '61-90': r.ag.b90, '+90': r.ag.b90p, 'افتتاحي غير مؤرَّخ': r.ag.open || 0,
            'الدفعة المستهدفة': r.target || '', 'دورية الهدف': r.target ? balRvSchedLabel(r.sched) : '', 'المحصّل في فترة الهدف': r.target ? r.collected : '',
            'آخر فاتورة آجل': r.lastInv ? balRvDateStr(r.lastInv.created_at) : '', 'آخر تحصيل': r.lastPay ? balRvDateStr(r.lastPay.created_at) : '',
            'قيمة آخر تحصيل': r.lastPay ? Number(r.lastPay.amount) : '', 'الأولوية': balRvPriorityLabel(r.pr)
        })));
        window._csPrint = () => repPrintReport('أرصدة العملاء', document.getElementById('cs-table-card').outerHTML);
        renderKpis();
        renderRows();
    }

    // ─────────────────────────────────────────
    // 3) كشف حساب مورد — نفس الفكرة: ميعاد السداد وحالته، آخر شراء وآخر دفعة،
    //    وخانة «رقم المورد» لمقارنة رصيد النظام برقم كشف المورد (بتتحفظ على
    //    الجهاز ده بس). زرار «كشف حساب» لسه بيفتح مودال suppliers.js.
    // ─────────────────────────────────────────
    async function renderSupplierStatement(c) {
        const today = balRvToday(), nowMs = Date.now();
        const supRes = await sb.from('suppliers').select('id,name,phone,balance,payment_due_date').order('name');
        if (supRes.error) { c.innerHTML = `<div class="dash-card" style="padding:16px;color:var(--inv-red)">❌ تعذّر تحميل الموردين: ${balRvEsc(supRes.error.message)}</div>`; return; }
        const [pRes, payRes] = await Promise.all([
            plFetchAllRows('purchases', 'supplier_id,total,payment_type,created_at', q => q.eq('status', 'confirmed').order('created_at', { ascending: false })),
            plFetchAllRows('supplier_payments', 'supplier_id,amount,created_at', q => q.eq('status', 'confirmed').order('created_at', { ascending: false }))
        ]);
        const purBy = {}, payBy = {};
        (pRes.data || []).forEach(r => { (purBy[r.supplier_id] = purBy[r.supplier_id] || []).push(r); });
        (payRes.data || []).forEach(r => { (payBy[r.supplier_id] = payBy[r.supplier_id] || []).push(r); });

        const CONF_KEY = 'sultan_sup_confirmed_v1';
        let confirmed = {};
        try { confirmed = JSON.parse(localStorage.getItem(CONF_KEY) || '{}') || {}; } catch (e) { confirmed = {}; }
        const saveConfirmed = () => { try { localStorage.setItem(CONF_KEY, JSON.stringify(confirmed)); } catch (e) { /* التخزين المحلي غير متاح */ } };

        const rows = (supRes.data || []).map(s => {
            const bal = Number(s.balance) || 0;
            const due = balRvDueStatus(bal, s.payment_due_date, today);
            const pr = !(bal > 0.005) ? 9 : due.key === 'late' ? 1 : (due.key === 'nodue' && bal >= 5000) ? 2 : 3;
            return { id: s.id, name: s.name || '', phone: s.phone || '', bal, due, dueDate: balRvDateStr(s.payment_due_date),
                lastPur: (purBy[s.id] || [])[0] || null, lastPay: (payBy[s.id] || [])[0] || null, pr };
        });
        const diffOf = r => {
            const v = confirmed[r.id];
            return (v === undefined || v === '' || v === null || isNaN(Number(v))) ? null : r.bal - Number(v);
        };
        let search = '', filter = 'debt';
        const filters = {
            debt: r => r.bal > 0.005, late: r => r.due.key === 'late', soon: r => r.due.key === 'soon', nodue: r => r.due.key === 'nodue',
            diff: r => { const d = diffOf(r); return d !== null && Math.abs(d) > 0.5; }, all: () => true
        };
        const sum = (arr, f) => arr.reduce((s, r) => s + f(r), 0);
        const currentRows = () => flexSearch(rows.filter(filters[filter] || filters.debt), search, ['name', 'phone'])
            .slice().sort((a, b) => (a.pr - b.pr) || (b.bal - a.bal));
        const kpis = [
            { id: 'debt', label: 'مستحق لهم', arr: rows.filter(filters.debt), val: r => r.bal },
            { id: 'late', label: 'متأخر عن الميعاد', arr: rows.filter(filters.late), val: r => r.bal },
            { id: 'soon', label: 'يستحق خلال ٧ أيام', arr: rows.filter(filters.soon), val: r => r.bal },
            { id: 'nodue', label: 'بدون ميعاد سداد', arr: rows.filter(filters.nodue), val: r => r.bal },
            { id: 'diff', label: 'فرق عن رقم المورد', arr: rows.filter(filters.diff), val: r => Math.abs(diffOf(r) || 0) }
        ];
        const renderKpis = () => {
            const el = document.getElementById('ss-kpis'); if (!el) return;
            const ks = kpis.map(k => Object.assign({}, k, { arr: k.id === 'diff' ? rows.filter(filters.diff) : k.arr }));
            el.innerHTML = ks.map(k => `<div onclick="window._ssFilter('${k.id}')" style="cursor:pointer;background:var(--inv-card);border:1.5px solid ${filter === k.id ? 'var(--inv-gold)' : 'var(--inv-border)'};border-radius:12px;padding:10px 12px">
                <div style="font-size:12px;color:var(--inv-muted)">${k.label}</div>
                <div style="font-size:20px;font-weight:800">${k.arr.length}</div>
                <div style="font-size:12.5px;font-weight:700">${fmt(sum(k.arr, k.val))}</div></div>`).join('');
        };
        const diffHtml = r => {
            const d = diffOf(r);
            if (d === null) return '<span style="color:var(--inv-muted)">—</span>';
            const a = Math.abs(d);
            const key = a >= 1000 ? 'late' : a > 0.5 ? 'soon' : 'ok';
            return balRvBadge(key, (d > 0 ? '+' : d < 0 ? '−' : '') + fmt(a));
        };
        const renderRows = () => {
            const body = document.getElementById('ss-list-body'); if (!body) return;
            const list = currentRows();
            const countEl = document.getElementById('ss-count'); if (countEl) countEl.textContent = list.length + ' مورد';
            body.innerHTML = !list.length ? `<tr><td colspan="9" class="empty-state"><span>🏭</span>لا يوجد موردين مطابقين</td></tr>` :
                list.map(r => {
                    const lp = r.lastPur ? `${balRvDateStr(r.lastPur.created_at)}<div><b>${fmt(r.lastPur.total)}</b> · ${balRvAgo(Math.max(0, Math.floor((nowMs - new Date(r.lastPur.created_at).getTime()) / 86400000)))}</div>` : '—';
                    const ly = r.lastPay ? `${balRvDateStr(r.lastPay.created_at)}<div><b>${fmt(r.lastPay.amount)}</b></div>` : '—';
                    const cv = confirmed[r.id];
                    return `<tr>
                        <td><strong>${balRvEsc(r.name)}</strong></td>
                        <td style="font-size:12.5px;white-space:nowrap">${r.phone ? `<a href="tel:${balRvEsc(r.phone)}" style="color:inherit;text-decoration:none;direction:ltr;unicode-bidi:embed">${balRvEsc(r.phone)}</a>${balRvWaLink(r.phone) ? ` <a href="${balRvWaLink(r.phone)}" target="_blank" rel="noopener" title="واتساب" style="text-decoration:none">💬</a>` : ''}` : '<span style="color:var(--inv-muted)">—</span>'}</td>
                        <td style="text-align:left;font-weight:700;color:${r.bal > 0 ? 'var(--inv-red)' : 'var(--inv-green)'}">${fmt(r.bal)}</td>
                        <td style="text-align:center">${balRvBadge(r.due.key, r.due.label)}<div style="font-size:11.5px;color:var(--inv-muted)">${r.dueDate}</div></td>
                        <td style="font-size:12px;text-align:center">${lp}</td>
                        <td style="font-size:12px;text-align:center">${ly}</td>
                        <td style="text-align:center">${r.bal > 0.005 ? `<input type="number" step="0.01" class="ob-input" style="margin:0;width:110px" placeholder="رقم المورد" value="${cv === undefined || cv === null ? '' : balRvEsc(cv)}" onchange="window._ssConfirm('${r.id}', this.value)">` : ''}</td>
                        <td style="text-align:center" id="ss-diff-${r.id}">${r.bal > 0.005 ? diffHtml(r) : ''}</td>
                        <td style="text-align:center"><button class="cc-edit" style="background:var(--inv-gold-bg);color:var(--inv-gold)" onclick="supShowStatement('${r.id}')">📄 كشف حساب</button></td>
                    </tr>`;
                }).join('');
        };
        c.innerHTML = `
        <div class="dash-card" style="padding:16px;margin-bottom:12px">
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                <input type="text" id="ss-search" class="ob-input" style="margin:0;flex:1;min-width:180px" placeholder="🔍 بحث بالاسم أو الهاتف..." oninput="window._ssSearch(this.value)">
                <button class="cc-edit" onclick="window._ssFilter('all')">كل الموردين</button>
                <button class="cc-edit" onclick="window._ssExport()">📥 Excel</button>
                <button class="cc-edit" onclick="window._ssPrint()">🖨️ طباعة</button>
            </div>
            <div style="font-size:12px;color:var(--inv-muted);margin-top:8px">اكتب رقم كشف المورد في خانة «رقم المورد» وهيظهر الفرق عن رصيد النظام فورًا. الأرقام دي بتتحفظ على الجهاز ده بس (مش في قاعدة البيانات).</div>
        </div>
        <div id="ss-kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px"></div>
        <div style="font-size:12px;color:var(--inv-muted);margin:0 4px 6px" id="ss-count"></div>
        <div class="mod-table-wrap" id="ss-table-card" style="overflow-x:auto">
            <table class="mod-table" style="min-width:940px"><thead><tr><th>المورد</th><th>الهاتف</th><th style="text-align:left">الرصيد (النظام)</th><th style="text-align:center">ميعاد السداد</th><th style="text-align:center">آخر شراء</th><th style="text-align:center">آخر دفعة</th><th style="text-align:center">رقم المورد</th><th style="text-align:center">الفرق</th><th style="text-align:center">إجراءات</th></tr></thead>
            <tbody id="ss-list-body"></tbody></table>
        </div>`;
        window._ssSearch = (v) => { search = v; renderRows(); };
        window._ssFilter = (f) => { filter = f; renderKpis(); renderRows(); };
        window._ssConfirm = (id, v) => {
            if (v === '' || v === null || v === undefined) delete confirmed[id]; else confirmed[id] = v;
            saveConfirmed();
            const r = rows.find(x => x.id === id);
            const cell = document.getElementById('ss-diff-' + id);
            if (r && cell) cell.innerHTML = diffHtml(r);
            renderKpis();
        };
        window._ssExport = () => repExportExcel('أرصدة_الموردين', currentRows().map(r => {
            const d = diffOf(r);
            return {
                'المورد': r.name, 'التليفون': r.phone, 'الرصيد (النظام)': r.bal, 'ميعاد السداد': r.dueDate, 'حالة السداد': r.due.label,
                'آخر شراء': r.lastPur ? balRvDateStr(r.lastPur.created_at) : '', 'قيمة آخر شراء': r.lastPur ? Number(r.lastPur.total) : '',
                'آخر دفعة': r.lastPay ? balRvDateStr(r.lastPay.created_at) : '', 'قيمة آخر دفعة': r.lastPay ? Number(r.lastPay.amount) : '',
                'رقم المورد': confirmed[r.id] === undefined ? '' : Number(confirmed[r.id]), 'الفرق عن رقم المورد': d === null ? '' : d, 'الأولوية': balRvPriorityLabel(r.pr)
            };
        }));
        window._ssPrint = () => repPrintReport('أرصدة الموردين', document.getElementById('ss-table-card').outerHTML);
        renderKpis();
        renderRows();
    }

    // ─────────────────────────────────────────
    // 4) تقرير VAT
    // ─────────────────────────────────────────
    async function renderVAT(c) {
        const today = new Date();
        const fromDefault = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0,10);
        const toDefault = today.toISOString().slice(0,10);

        const load = async (from, to) => {
            const [{ data: sales }, { data: purchases }] = await Promise.all([
                sb.from('sales').select('vat_amount,total,invoice_no,created_at').eq('status','confirmed').gte('created_at', from).lte('created_at', to + 'T23:59:59'),
                sb.from('purchases').select('vat_amount,total,invoice_no,created_at').eq('status','confirmed').gte('created_at', from).lte('created_at', to + 'T23:59:59'),
            ]);

            const outputVat = (sales||[]).reduce((s,r)=>s+Number(r.vat_amount||0),0);
            const inputVat = (purchases||[]).reduce((s,r)=>s+Number(r.vat_amount||0),0);
            const netVat = outputVat - inputVat;

            c.innerHTML = `
            <div class="dash-card" style="padding:20px;margin-bottom:16px">
                <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
                    <div><label class="ob-label">من تاريخ</label><input type="date" id="vat-from" class="ob-input" style="margin:0" value="${from}"></div>
                    <div><label class="ob-label">إلى تاريخ</label><input type="date" id="vat-to" class="ob-input" style="margin:0" value="${to}"></div>
                    <button class="ob-add-btn" onclick="window._vatReload()">🔍 تطبيق</button>
                </div>
            </div>
            <div class="dash-card" style="padding:24px;max-width:550px">
                <h3 style="margin:0 0 16px;font-size:15px">تقرير ضريبة القيمة المضافة (${from} إلى ${to})</h3>
                <div class="dash-summary-row"><span>ضريبة المبيعات (مُحصّلة)</span><span class="dash-s-green">${fmt(outputVat)}</span></div>
                <div class="dash-summary-row"><span>ضريبة المشتريات (مدفوعة)</span><span class="dash-s-red">${fmt(inputVat)}</span></div>
                <div class="dash-summary-divider"></div>
                <div class="dash-summary-row dash-summary-total">
                    <span>${netVat>=0?'مستحق للمصلحة':'مستحق لنا (خصم)'}</span>
                    <span style="color:${netVat>=0?'var(--inv-red)':'var(--inv-green)'}">${fmt(Math.abs(netVat))}</span>
                </div>
            </div>`;

            window._vatReload = () => {
                const f = document.getElementById('vat-from').value;
                const t = document.getElementById('vat-to').value;
                load(f, t);
            };
        };
        load(fromDefault, toDefault);
    }

    // ─────────────────────────────────────────
    // 5) تقرير المؤجلات
    // ─────────────────────────────────────────
    async function renderDeferred(c) {
        const [{ data: summary }, { data: suppliers }, { data: manual }] = await Promise.all([
            sb.from('deferred_rebates_supplier_summary').select('*').order('total_remaining', { ascending: false }),
            sb.from('suppliers').select('id,name').eq('is_active', true).order('name'),
            sb.from('deferred_rebates_manual').select('*, suppliers(name)').neq('status', 'cancelled').order('created_at', { ascending: false }),
        ]);
        _repDefSuppliers = suppliers || [];
        _repDefManual = manual || [];

        c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
            <div style="font-size:12px;color:var(--inv-muted)">المتوقع/المستلم/المتبقي من فواتير الشراء المؤجلة الحالية. المؤجلات القديمة (قبل تتبع النظام) تُسجَّل يدوياً وتظهر في الجدول تحت.</div>
            <button class="mod-btn mod-btn-primary" onclick="repDefOpenAddHistorical()">+ إضافة مؤجل قديم</button>
        </div>
        <div class="dash-card" style="padding:0;overflow:hidden">
            <table class="dash-table" style="margin:0">
                <thead><tr><th>المورد</th><th>عدد البنود</th><th>المتوقع</th><th>المستلم</th><th>المتبقي</th><th></th></tr></thead>
                <tbody>
                    ${(summary||[]).filter(s=>s.items_count>0).map(s => `<tr>
                        <td><strong>${s.supplier_name}</strong></td>
                        <td>${s.items_count}</td>
                        <td>${fmt(s.total_expected)}</td>
                        <td class="dash-s-green">${fmt(s.total_received)}</td>
                        <td class="dash-amount" style="color:${s.total_remaining>0?'var(--inv-gold)':'var(--inv-green)'}">${fmt(s.total_remaining)}</td>
                        <td>${s.items_count>0 ? `<button class="mod-btn" style="padding:5px 10px;font-size:11px;background:var(--inv-green-light);color:var(--inv-green)" onclick="repDefOpenReceive('${(suppliers||[]).find(x=>x.name===s.supplier_name)?.id||''}','${(s.supplier_name||'').replace(/'/g,"\\'")}')">💰 إدارة / استلام</button>` : ''}</td>
                    </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--inv-muted-light)">لا توجد مؤجلات مسجلة</td></tr>'}
                </tbody>
            </table>
        </div>

        <div style="margin-top:18px;font-size:13px;font-weight:800;color:var(--inv-navy-light)">📜 مؤجلات مسجّلة يدوياً (قديمة قبل تتبع النظام)</div>
        <div class="dash-card" style="padding:0;overflow:hidden;margin-top:8px">
            <table class="dash-table" style="margin:0">
                <thead><tr><th>المورد</th><th>المبلغ</th><th>المستلم</th><th>المتبقي</th><th>الاستحقاق</th><th>ملاحظات</th><th></th></tr></thead>
                <tbody>
                    ${_repDefManual.length ? _repDefManual.map(m => {
                        const remaining = (Number(m.amount)||0) - (Number(m.received_amount)||0);
                        return `<tr>
                        <td><strong>${m.suppliers?.name || '—'}</strong></td>
                        <td>${fmt(m.amount)}</td>
                        <td class="dash-s-green">${fmt(m.received_amount)}</td>
                        <td class="dash-amount" style="color:${remaining>0?'var(--inv-gold)':'var(--inv-green)'}">${fmt(remaining)}</td>
                        <td>${m.due_date || '—'}</td>
                        <td style="font-size:11px;color:var(--inv-muted)">${m.notes || '—'}</td>
                        <td>${remaining>0 ? `<button class="mod-btn" style="padding:5px 10px;font-size:11px;background:var(--inv-green-light);color:var(--inv-green)" onclick="repDefReceiveManual('${m.id}',${remaining})">💰 استلام</button>` : '<span style="color:var(--inv-green);font-size:11px">✅ مكتمل</span>'}</td>
                    </tr>`;
                    }).join('') : '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--inv-muted-light)">لا توجد مؤجلات يدوية مسجلة</td></tr>'}
                </tbody>
            </table>
        </div>`;
    }

    // ════════════════════════════════════════════════════════════
    // مؤجلات — إضافة مؤجل قديم يدوياً + تسجيل استلام
    // (جدول deferred_rebates_manual جديد ومستقل — راجع
    //  deferred_rebates_manual_migration.sql لسبب القرار ده)
    // ════════════════════════════════════════════════════════════
    window.repDefOpenAddHistorical = function () {
        const modal = document.createElement('div');
        modal.className = 'mod-modal-bg active';
        modal.id = 'repDefAddModal';
        modal.innerHTML = `
        <div class="mod-modal">
            <div class="mod-modal-header"><h3>📜 إضافة مؤجل قديم (قبل تتبع النظام)</h3>
                <button class="mod-modal-close" onclick="repDefCloseModal('repDefAddModal')">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>المورد *</label>
                    <select id="repDefSuppId" class="mod-form-input">
                        <option value="">-- اختر المورد --</option>
                        ${_repDefSuppliers.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
                    </select>
                </div>
                <div class="mod-form-group"><label>المبلغ (ج.م) *</label>
                    <input type="number" id="repDefAmount" class="mod-form-input" placeholder="0.00" step="0.01" dir="ltr">
                </div>
                <div class="mod-form-group"><label>تاريخ الاستحقاق (اختياري)</label>
                    <input type="date" id="repDefDueDate" class="mod-form-input">
                </div>
                <div class="mod-form-group"><label>ملاحظات</label>
                    <input type="text" id="repDefNotes" class="mod-form-input" placeholder="مثال: رصيد مؤجل من قبل استخدام النظام">
                </div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:var(--inv-text-soft)" onclick="repDefCloseModal('repDefAddModal')">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="repDefSaveHistorical()">💾 حفظ</button>
            </div>
        </div>`;
        document.body.appendChild(modal);
    };

    window.repDefCloseModal = function (id) { const m = document.getElementById(id); if (m) m.remove(); };

    window.repDefSaveHistorical = async function () {
        const supplierId = document.getElementById('repDefSuppId').value;
        const amount = parseFloat(document.getElementById('repDefAmount').value);
        const dueDate = document.getElementById('repDefDueDate').value || null;
        const notes = document.getElementById('repDefNotes').value.trim() || null;
        if (!supplierId) return alert('اختر المورد');
        if (!amount || amount <= 0) return alert('أدخل مبلغاً صحيحاً');

        const btn = document.querySelector('#repDefAddModal .mod-btn-primary');
        btn.innerText = 'جاري الحفظ...'; btn.disabled = true;
        try {
            const { error } = await sb.rpc('fn_register_historical_deferred_rebate', {
                p_supplier_id: supplierId, p_amount: amount, p_due_date: dueDate, p_notes: notes,
            });
            if (error) throw error;
            repDefCloseModal('repDefAddModal');
            renderDeferred(document.getElementById('rep-content'));
        } catch (err) {
            alert('خطأ أثناء الحفظ: ' + err.message);
        } finally {
            if (btn) { btn.innerText = '💾 حفظ'; btn.disabled = false; }
        }
    };

    window.repDefReceiveManual = async function (id, remaining) {
        const amountStr = prompt(`المبلغ المستلم (المتبقي: ${fmt(remaining)} ج.م):`, fmt(remaining));
        if (amountStr === null) return;
        const amount = parseFloat(amountStr);
        if (!amount || amount <= 0) return alert('أدخل مبلغاً صحيحاً');
        if (amount > remaining + 0.001) return alert('المبلغ أكبر من المتبقي');
        try {
            const { error } = await sb.rpc('fn_receive_deferred_rebate_manual', { p_id: id, p_amount: amount });
            if (error) throw error;
            renderDeferred(document.getElementById('rep-content'));
        } catch (err) {
            alert('خطأ أثناء تسجيل الاستلام: ' + err.message);
        }
    };

    window.repDefOpenReceive = async function (supplierId, supplierName) {
        const modal = document.createElement('div');
        modal.className = 'mod-modal-bg active';
        modal.id = 'repDefReceiveModal';
        modal.innerHTML = `
        <div class="mod-modal">
            <div class="mod-modal-header"><h3>💰 إدارة المؤجلات — ${supplierName}</h3>
                <button class="mod-modal-close" onclick="repDefCloseModal('repDefReceiveModal')">&times;</button></div>
            <div class="mod-modal-body" id="repDefReceiveBody">
                <div style="text-align:center;padding:20px;color:var(--inv-muted)">⏳ جاري التحميل...</div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:var(--inv-text-soft)" onclick="repDefCloseModal('repDefReceiveModal')">إغلاق</button>
            </div>
        </div>`;
        document.body.appendChild(modal);

        const body = document.getElementById('repDefReceiveBody');
        if (!supplierId) {
            body.innerHTML = `<div style="color:var(--inv-muted-light);font-size:12px">تعذّر تحديد المورد تلقائياً — استخدم جدول "مؤجلات مسجّلة يدوياً" بالأسفل لو المؤجل ده يدوي، أو راجع المطوّر.</div>`;
            return;
        }
        await repDefLoadInvoiceGroups(supplierId, 'repDefReceiveBody');
    };

    // إدارة مؤجلات الفواتير (استلام جزئي/إلغاء/إعادة فتح/استعادة) اتنقلت لملف
    // deferred-rebates.js عشان كشف حساب المورد يستخدمها من غير ما يفتح التقارير.
    // الدالة دي بس بتخلي الإجراءات هناك تحدّث تقرير المؤجلات لو مفتوح.
    window.repDefRefreshReport = function () {
        const el = document.getElementById('rep-content');
        if (el) renderDeferred(el);
    };

    renderReportContent(activeReport);
}
