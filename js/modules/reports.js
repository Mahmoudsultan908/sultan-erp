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
        const [{ data: sales }, { data: expenses }, { data: salesReturns }, { data: saleItemsCost }, { data: returnItemsCost }] = await Promise.all([
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
        ]);
        const totalSales = (sales||[]).reduce((s,r)=>s+Number(r.total),0);
        const totalReturns = (salesReturns||[]).reduce((s,r)=>s+Number(r.total),0);
        const netSales = totalSales - totalReturns;
        const cogsSales = (saleItemsCost||[]).reduce((s,it)=>s+(Number(it.qty)||0)*(Number(it.cost_price_snapshot)||0),0);
        const cogsReturns = (returnItemsCost||[]).reduce((s,it)=>s+(Number(it.qty)||0)*(Number(it.cost_price_snapshot)||0),0);
        const totalCOGS = cogsSales - cogsReturns;
        const totalExpenses = (expenses||[]).reduce((s,r)=>s+Number(r.amount),0);
        const netProfit = netSales - totalCOGS - totalExpenses;
        const margin = netSales > 0 ? (netProfit/netSales*100) : 0;
        return { totalSales, totalReturns, netSales, cogsSales, cogsReturns, totalCOGS, totalExpenses, netProfit, margin };
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
            const { totalSales, totalReturns, netSales, cogsSales, cogsReturns, totalCOGS, totalExpenses, netProfit, margin } = await plComputeTotals(from, to);

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
                { البند: netProfit >= 0 ? 'صافي الربح' : 'صافي الخسارة', القيمة: Math.abs(netProfit) },
                { البند: 'هامش الربح %', القيمة: margin.toFixed(1) },
            ]);
            window._plPrint = () => repPrintReport(`قائمة الدخل (${from} إلى ${to})`, document.getElementById('pl-card').outerHTML);
            plRenderTrend();
        };
        load(fromDefault, toDefault);
    }

    // ─────────────────────────────────────────
    // 2) كشف حساب عميل — بيفتح نفس مودال كشف الحساب الغني (بند 5) بدل
    //    نسخة مبسّطة منفصلة كانت ناقصة (نقدي/تحويلات أرصدة/تبويب أصناف
    //    ومكسب شهري) وممكن تختلف عن الرقم الحقيقي فى customers.js
    // ─────────────────────────────────────────
    async function renderCustomerStatement(c) {
        const { data: customers } = await sb.from('customers').select('id,name,phone,balance').order('name');
        const list = customers || [];
        let search = '';
        const renderRows = () => {
            const rows = flexSearch(list, search, ['name', 'phone']);
            const body = document.getElementById('cs-list-body');
            if (!body) return;
            body.innerHTML = !rows.length ? `<tr><td colspan="3" class="empty-state"><span>👥</span>لا يوجد عملاء مطابقين</td></tr>` :
                rows.map(cu => `<tr>
                    <td><strong>${cu.name}</strong></td>
                    <td style="text-align:left;font-weight:700;color:${Number(cu.balance)>0?'var(--inv-red)':'var(--inv-green)'}">${fmt(cu.balance)}</td>
                    <td style="text-align:center"><button class="cc-edit" style="background:var(--inv-gold-bg);color:var(--inv-gold)" onclick="custShowStatement('${cu.id}')">📄 كشف حساب</button></td>
                </tr>`).join('');
        };
        c.innerHTML = `
        <div class="dash-card" style="padding:16px;margin-bottom:16px">
            <input type="text" id="cs-search" class="ob-input" style="margin:0" placeholder="🔍 بحث بالاسم أو الهاتف..." oninput="window._csSearch(this.value)">
        </div>
        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr><th>العميل</th><th style="text-align:left">الرصيد</th><th style="text-align:center">إجراءات</th></tr></thead>
            <tbody id="cs-list-body"></tbody></table>
        </div>`;
        window._csSearch = (v) => { search = v; renderRows(); };
        renderRows();
    }

    // ─────────────────────────────────────────
    // 3) كشف حساب مورد — نفس الفكرة، بيفتح مودال suppliers.js الغني
    // ─────────────────────────────────────────
    async function renderSupplierStatement(c) {
        const { data: suppliers } = await sb.from('suppliers').select('id,name,phone,balance').order('name');
        const list = suppliers || [];
        let search = '';
        const renderRows = () => {
            const rows = flexSearch(list, search, ['name', 'phone']);
            const body = document.getElementById('ss-list-body');
            if (!body) return;
            body.innerHTML = !rows.length ? `<tr><td colspan="3" class="empty-state"><span>🏭</span>لا يوجد موردين مطابقين</td></tr>` :
                rows.map(s => `<tr>
                    <td><strong>${s.name}</strong></td>
                    <td style="text-align:left;font-weight:700;color:${Number(s.balance)>0?'var(--inv-red)':'var(--inv-green)'}">${fmt(s.balance)}</td>
                    <td style="text-align:center"><button class="cc-edit" style="background:var(--inv-gold-bg);color:var(--inv-gold)" onclick="supShowStatement('${s.id}')">📄 كشف حساب</button></td>
                </tr>`).join('');
        };
        c.innerHTML = `
        <div class="dash-card" style="padding:16px;margin-bottom:16px">
            <input type="text" id="ss-search" class="ob-input" style="margin:0" placeholder="🔍 بحث بالاسم أو الهاتف..." oninput="window._ssSearch(this.value)">
        </div>
        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr><th>المورد</th><th style="text-align:left">الرصيد</th><th style="text-align:center">إجراءات</th></tr></thead>
            <tbody id="ss-list-body"></tbody></table>
        </div>`;
        window._ssSearch = (v) => { search = v; renderRows(); };
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
                        <td>${s.total_remaining>0 ? `<button class="mod-btn" style="padding:5px 10px;font-size:11px;background:var(--inv-green-light);color:var(--inv-green)" onclick="repDefOpenReceive('${(suppliers||[]).find(x=>x.name===s.supplier_name)?.id||''}','${(s.supplier_name||'').replace(/'/g,"\\'")}')">💰 تسجيل استلام</button>` : ''}</td>
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
            <div class="mod-modal-header"><h3>💰 تسجيل استلام مؤجل — ${supplierName}</h3>
                <button class="mod-modal-close" onclick="repDefCloseModal('repDefReceiveModal')">&times;</button></div>
            <div class="mod-modal-body" id="repDefReceiveBody">
                <div style="text-align:center;padding:20px;color:var(--inv-muted)">⏳ جاري التحميل...</div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:var(--inv-text-soft)" onclick="repDefCloseModal('repDefReceiveModal')">إغلاق</button>
                <button class="mod-btn mod-btn-primary" onclick="repDefConfirmReceiveReal('${supplierId}')">✅ تأكيد استلام المحدد</button>
            </div>
        </div>`;
        document.body.appendChild(modal);

        const body = document.getElementById('repDefReceiveBody');
        if (!supplierId) {
            body.innerHTML = `<div style="color:var(--inv-muted-light);font-size:12px">تعذّر تحديد المورد تلقائياً — استخدم جدول "مؤجلات مسجّلة يدوياً" بالأسفل لو المؤجل ده يدوي، أو راجع المطوّر.</div>`;
            return;
        }
        try {
            const { data: pending, error } = await sb.rpc('fn_list_pending_deferred_rebates', { p_supplier_id: supplierId });
            if (error) throw error;
            if (!pending || !pending.length) {
                body.innerHTML = `<div style="color:var(--inv-muted-light);font-size:12px">لا توجد بنود مؤجلة معلّقة من فواتير شراء لهذا المورد.</div>`;
                return;
            }
            body.innerHTML = `
            <div style="font-size:11px;color:var(--inv-muted);margin-bottom:8px">حدد البنود اللي المورد استلمها فعلاً (خصم/استرداد) ثم اضغط "تأكيد استلام المحدد".</div>
            <table class="mod-table"><thead><tr><th></th><th>الصنف</th><th>الكمية</th><th>المؤجل/وحدة</th><th>الاستحقاق</th><th>المبلغ المتوقع</th></tr></thead>
            <tbody>
                ${pending.map(p => `<tr>
                    <td><input type="checkbox" class="repDefRecvChk" value="${p.id}"></td>
                    <td>${p.product_name || '—'}</td>
                    <td>${p.qty}</td>
                    <td>${fmt(p.rate)}</td>
                    <td>${p.due_date || '—'}</td>
                    <td>${fmt(p.expected_amount)}</td>
                </tr>`).join('')}
            </tbody></table>`;
        } catch (err) {
            body.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:12px;border-radius:8px;font-size:12px">خطأ: ${err.message}</div>`;
        }
    };

    window.repDefConfirmReceiveReal = async function () {
        const ids = Array.from(document.querySelectorAll('.repDefRecvChk:checked')).map(el => el.value);
        if (!ids.length) return alert('حدد بند واحد على الأقل');
        try {
            const { error } = await sb.rpc('fn_mark_deferred_rebate_received', { p_ids: ids });
            if (error) throw error;
            repDefCloseModal('repDefReceiveModal');
            renderDeferred(document.getElementById('rep-content'));
        } catch (err) {
            alert('خطأ أثناء تسجيل الاستلام: ' + err.message);
        }
    };

    renderReportContent(activeReport);
}
