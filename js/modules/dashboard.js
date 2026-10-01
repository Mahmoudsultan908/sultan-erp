// ════════════════════════════════════════════════════════════
// dashboard.js — لوحة التحكم الرئيسية
// يصدّر: renderDashboard(container)
// ════════════════════════════════════════════════════════════

// ★ حالة رسم اتجاه المبيعات — بتتحدث كل تحميل داشبورد، وبيستخدمها زرار
//   تبديل 7/30 يوم (dashSetTrendRange) عشان يعيد الرسم من غير أي استعلام
//   جديد لقاعدة البيانات (البيانات الأساسية آخر 30 يوم مجلوبة مرة واحدة بس)
let dashTrendDaily = [];
// ★ الهدف اليومي للمبيعات (من الإعدادات العامة → app_settings) — بيتحدد
//   لون كل عمود فى رسم "اتجاه المبيعات" حسب نسبة تحقيقه، زي نفس منطق
//   ألوان الأهداف فى rep-visits.js (rvRenderGoalsPage) بالظبط
let dashDailyTarget = 0;

// ★ Supabase بيرجع 1000 صف كحد أقصى افتراضي لأي select عادي من غير فلتر
//   يضيّق النتيجة — نفس نمط الإصلاح المستخدم في reports.js/accounting.js
//   لحساب تكلفة البضاعة المباعة صح لو حجم مبيعات الشهر كبر مع الوقت.
async function dashFetchAllRows(table, select, applyFilters) {
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

async function renderDashboard(container) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--inv-muted)">
        <div style="font-size:32px;margin-bottom:8px">⏳</div>جاري تحميل البيانات...
    </div>`;

    try {
        const today = new Date().toISOString().slice(0, 10);
        // نقطة قفل الفترة التاريخية: آخر بيانات منقولة من ديكسف كانت 2026-07-17،
        // فالتشغيل الفعلي المباشر لسلطان بدأ 2026-07-18 — راجع نفس المنطق في
        // reports.js. من غير الشرط ده، "ملخص الشهر" هيفضل يخلط تسويات الترحيل
        // بالأداء التشغيلي الحقيقي طول شهر يوليو.
        const SULTAN_LIVE_CUTOVER = '2026-07-18';
        const rawMonthStart = today.slice(0, 7) + '-01';
        const monthStart = rawMonthStart < SULTAN_LIVE_CUTOVER ? SULTAN_LIVE_CUTOVER : rawMonthStart;
        const trendStart = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
        // نافذة متحركة آخر 90 يوم — لحساب متوسط هامش الربح الحقيقي من بيانات
        // البيع الفعلية (مش رقم مُدخَل يدويًا)، يُستخدم فى معادلة هدف المبيعات تحت
        const marginWindowStart = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

        // ★ مؤشرات المتابعة الجديدة (مقارنة بالشهر السابق، أعمار الديون، هامش الأصناف/العملاء/المناديب،
        //   تنبيهات) — دالة واحدة fn_dashboard_insights في القاعدة، بتتجاب بالتوازي مع باقي الاستعلامات.
        //   لو فشلت (مثلاً صلاحية الدور) القسم بيختفي بس واللوحة الأساسية تكمل عادي.
        // فلتر الفرع: بيظهر بس لما يبقى فيه أكتر من فرع نشط (branches.js)؛ الاختيار بيتحفظ على الجهاز ده وبيتأكد إنه لسه فرع موجود
        const dashBr = await dashBranchState();
        const dashInsightsPromise = dashFetchInsights(dashBr.selected);
        // ★ الأرقام الرئيسية من دالة واحدة في القاعدة (fn_dashboard_main) بدل ~25 استعلام بتحمّل جداول كاملة.
        //   لو الدالة مش متاحة (صلاحية الدور، أو مشكلة) بنرجع للاستعلامات القديمة تحت زي ما كانت بالظبط.
        const dashMain = await dashFetchMain(dashBr.selected);
        const dashBranchMode = !!(dashMain && dashBr.selected);
        const dashBranchNote = dashBranchMode
            ? '<div class="mod-alert-banner" style="font-size:12.5px"><span>🏬</span><span>اللوحة معروضة لفرع: <b>' + dashInsEsc(dashMain.branch.branch && dashMain.branch.branch.name || '') + '</b> — الكروت والاتجاه وآخر الفواتير والأكثر مبيعاً والمخزون المنخفض ومؤشرات المتابعة للفرع. أما المركز المالي وديون العملاء والموردين وهدف المبيعات فلكل الفروع (دفتر الأستاذ وأرصدة العملاء مش مقسومة على فروع).</span></div>'
            : '';

        const [
            { data: cashData },
            { data: salesToday },
            { data: salesMonth },
            { data: salesReturnsMonth },
            { data: purchasesMonth },
            { data: expensesMonth },
            { data: collectionDiscountsMonth },
            { data: saleItemsCostMonth },
            { data: returnItemsCostMonth },
            { data: lowStock },
            { data: topProducts },
            { data: latestSales },
            { data: overdueCustomers },
            { data: allStock },
            { data: allVanStock },
            { data: allCustomers },
            { data: allSuppliers },
            { data: trendSales },
            { data: lastBackupRow },
            { data: dailyTargetRow },
            { data: activeEmployees },
            { data: expenseCatsForTarget },
            { data: monthlyMarginRow },
            { data: marginSaleItems },
            { data: marginReturnItems },
            { data: deferredAuto },
            { data: deferredManual },
            { data: capitalPartners },
            { data: ledgerLines },
        ] = await (dashMain ? Promise.resolve(dashAdapterResults(dashMain)) : Promise.all([
            sb.rpc('get_cash_balance'),
            sb.from('sales').select('total').eq('status','confirmed').gte('created_at', today),
            sb.from('sales').select('total,subtotal').eq('status','confirmed').gte('created_at', monthStart),
            sb.from('sales_returns').select('total').eq('status','confirmed').gte('created_at', monthStart),
            sb.from('purchases').select('total').eq('status','confirmed').gte('created_at', monthStart),
            sb.from('expenses').select('amount').eq('status','confirmed').gte('expense_date', monthStart),
            // خصم العميل وقت التحصيل (collections.js) — راجع نفس المنطق في reports.js
            sb.from('customer_payments').select('discount').eq('status','confirmed').gte('created_at', monthStart),
            // تكلفة البضاعة المباعة الفعلية (مش المشتريات) — راجع نفس المنطق في reports.js.
            // مفلترة بـ dashFetchAllRows عشان أسطر الأصناف تعدّي حد الـ1000 صف الافتراضي مع الوقت.
            dashFetchAllRows('sale_items', 'qty, cost_price_snapshot, sales!inner(created_at, status)', (q) =>
                q.eq('sales.status', 'confirmed').gte('sales.created_at', monthStart)),
            dashFetchAllRows('sale_return_items', 'qty, cost_price_snapshot, sales_returns!inner(created_at, status)', (q) =>
                q.eq('sales_returns.status', 'confirmed').gte('sales_returns.created_at', monthStart)),
            sb.from('inventory_stock').select('qty, product_id, products(name, code)').lt('qty', 10).limit(5),
            sb.from('sale_items')
                .select('product_id, qty, products(name), sales!inner(created_at,status)')
                .eq('sales.status', 'confirmed')
                .gte('sales.created_at', monthStart)
                .order('qty', { ascending: false })
                .limit(5),
            sb.from('sales')
                .select('invoice_no, total, created_at, customers(name), payment_type, status')
                .eq('status','confirmed')
                .order('created_at', { ascending: false })
                .limit(6),
            sb.from('customers').select('name, balance, credit_limit').gt('balance', 0).order('balance', { ascending: false }).limit(5),
            // قيمة المخزون الفعلية من كل الصفوف (المخزن الرئيسي)
            dashFetchAllRows('inventory_stock', 'qty, products(purchase_price)', null),
            // بضاعة موجودة فعليًا مع المندوبين على العربيات — من غيرها "قيمة البضاعة"
            // فى تقرير الجرد كانت بتفوّت كل مخزون العربيات وتوريه أقل من الحقيقي
            dashFetchAllRows('van_stock', 'qty, products(purchase_price)', null),
            // نفس منطق حساب مديونية العملاء المستخدم في js/modules/customers.js (مجموع الأرصدة الموجبة فقط)
            sb.from('customers').select('balance'),
            // نفس منطق حساب مستحقات الموردين المستخدم في js/modules/suppliers.js (مجموع الأرصدة الموجبة فقط)
            sb.from('suppliers').select('balance'),
            // اتجاه المبيعات — آخر 30 يوم، بيتجمّع باليوم في الـ JS تحت
            sb.from('sales').select('total,created_at').eq('status','confirmed').gte('created_at', trendStart),
            sb.from('app_settings').select('value').eq('key','last_backup_at').maybeSingle(),
            sb.from('app_settings').select('value').eq('key','daily_sales_target').maybeSingle(),
            sb.from('employees').select('base_salary').eq('is_active', true),
            sb.from('expense_categories').select('monthly_limit').eq('is_active', true),
            sb.from('app_settings').select('value').eq('key','monthly_target_profit_margin').maybeSingle(),
            dashFetchAllRows('sale_items', 'qty, line_total, cost_price_snapshot, sales!inner(created_at, status)', (q) =>
                q.eq('sales.status', 'confirmed').gte('sales.created_at', marginWindowStart)),
            dashFetchAllRows('sale_return_items', 'qty, line_total, cost_price_snapshot, sales_returns!inner(created_at, status)', (q) =>
                q.eq('sales_returns.status', 'confirmed').gte('sales_returns.created_at', marginWindowStart)),
            // مؤجلات مستحقة من الموردين (تلقائية من فواتير الشراء + يدوية قديمة) —
            // نفس منطق renderDeferred فى reports.js — جزء من صافي المركز المالي
            sb.from('deferred_rebates_supplier_summary').select('total_remaining'),
            sb.from('deferred_rebates_manual').select('amount, received_amount').neq('status', 'cancelled'),
            // عجز/ذمم شركاء رأس المال (صاحب المحل والمستثمرين) — ذمة مدينة
            // حقيقية على الشركة (أصل)، جزء من صافي المركز المالي زي أي رصيد
            // مدين تاني، راجع فحص "الميزانية العمومية" فى accounting.js لنفس المنطق
            sb.from('capital_partners').select('cumulative_deficit').eq('status', 'active'),
            // التقرير المالي اليومي يعتمد على أرصدة الأستاذ الموحدة، حتى لا
            // يختلف عن الميزانية بسبب اختلاف مصدر المخزون أو المؤجلات.
            dashFetchAllRows('journal_entry_lines', 'account_code, debit, credit, journal_entries!inner(entry_date)', (q) =>
                q.in('account_code', ['1001','1002','1003','1004','1005','2001','2002'])
                    .lte('journal_entries.entry_date', today)),
        ]));

        const dashIns = await dashInsightsPromise;

        // ── تجميع مبيعات آخر 30 يوم يوميًا (تعبئة الأيام الفاضية بصفر) ──
        const dayBuckets = {};
        (trendSales || []).forEach(r => {
            const day = String(r.created_at).slice(0, 10);
            dayBuckets[day] = (dayBuckets[day] || 0) + Number(r.total || 0);
        });
        dashTrendDaily = Array.from({ length: 30 }, (_, i) => {
            const d = new Date(Date.now() - (29 - i) * 86400000);
            const key = d.toISOString().slice(0, 10);
            return { date: key, total: dayBuckets[key] || 0 };
        });
        // مسار الدالة: الاتجاه جاهز من القاعدة بتوقيت القاهرة (الأيام الفاضية = 0)
        if (dashMain && Array.isArray(dashMain.branch.trend)) {
            dashTrendDaily = dashMain.branch.trend.map(t => ({ date: String(t.date), total: Number(t.total) || 0 }));
        }
        try { dashDailyTarget = Number(JSON.parse(dailyTargetRow?.value ?? '0')) || 0; }
        catch { dashDailyTarget = Number(dailyTargetRow?.value) || 0; }

        // ── تنبيه النسخة الاحتياطية: لو معملناش نسخة خالص أو عدى عليها 7 أيام ──
        let lastBackupIso = null;
        try { lastBackupIso = lastBackupRow?.value ? JSON.parse(lastBackupRow.value) : null; } catch { lastBackupIso = lastBackupRow?.value || null; }
        const daysSinceBackup = lastBackupIso ? Math.floor((Date.now() - new Date(lastBackupIso).getTime()) / 86400000) : null;
        const backupBanner = (daysSinceBackup === null || daysSinceBackup >= 7) ? `
            <div class="mod-alert-banner warning">
                <span>⚠️</span>
                <span>${daysSinceBackup === null ? 'لسه معملتش أي نسخة احتياطية من بيانات النظام.' : `عدّى ${daysSinceBackup} يوم من غير نسخة احتياطية جديدة.`}</span>
                <span class="dash-see-all" style="margin-right:auto" onclick="loadMod(document.querySelector('[data-mod=settings-hub]'),'settings-hub')">اعمل نسخة الآن ←</span>
            </div>` : '';

        const cash = Number(cashData) || 0;
        const todaySales = (salesToday || []).reduce((s, r) => s + Number(r.total), 0);
        const monthSales = (salesMonth || []).reduce((s, r) => s + Number(r.total), 0);
        const monthReturns = (salesReturnsMonth || []).reduce((s, r) => s + Number(r.total), 0);
        const netMonthSales = monthSales - monthReturns;
        const monthPurchases = (purchasesMonth || []).reduce((s, r) => s + Number(r.total), 0);
        const monthExpenses = (expensesMonth || []).reduce((s, r) => s + Number(r.amount), 0);
        const monthDiscounts = (collectionDiscountsMonth || []).reduce((s, r) => s + (Number(r.discount) || 0), 0);
        const monthCOGS = (saleItemsCostMonth || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.cost_price_snapshot) || 0), 0)
            - (returnItemsCostMonth || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.cost_price_snapshot) || 0), 0);
        const monthProfit = netMonthSales - monthCOGS - monthExpenses - monthDiscounts;

        // ── هدف المبيعات الشهري = (رواتب الموظفين النشطين + بنود التشغيل بحد شهري + هامش ربح مستهدف) ÷ متوسط هامش الربح الحقيقي ──
        // متوسط الهامش بيتحسب تلقائيًا من مبيعات آخر 90 يوم الفعلية (إيراد
        // صافي بعد المرتجعات ناقص تكلفة البضاعة) — مش رقم بيتكتب يدوي، عشان
        // يعكس هامش الأسعار الحقيقي اللي البيع بيحصل بيه فعلاً.
        const marginRevenue = (marginSaleItems || []).reduce((s, it) => s + (Number(it.line_total) || 0), 0)
            - (marginReturnItems || []).reduce((s, it) => s + (Number(it.line_total) || 0), 0);
        const marginCost = (marginSaleItems || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.cost_price_snapshot) || 0), 0)
            - (marginReturnItems || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.cost_price_snapshot) || 0), 0);
        const avgMarginPct = marginRevenue > 0 ? (marginRevenue - marginCost) / marginRevenue : 0;

        const expectedSalaries = (activeEmployees || []).reduce((s, e) => s + (Number(e.base_salary) || 0), 0);
        const expectedOpEx = (expenseCatsForTarget || []).reduce((s, c) => s + (Number(c.monthly_limit) || 0), 0);
        let monthlyTargetMargin = 0;
        try { monthlyTargetMargin = Number(JSON.parse(monthlyMarginRow?.value ?? '0')) || 0; }
        catch { monthlyTargetMargin = Number(monthlyMarginRow?.value) || 0; }
        const monthlySalesTarget = (monthlyTargetMargin > 0 && avgMarginPct > 0)
            ? (expectedSalaries + expectedOpEx + monthlyTargetMargin) / avgMarginPct : 0;
        const DASH_TARGET_WORKDAYS = 26;
        const dailySalesTargetCalc = monthlySalesTarget > 0 ? monthlySalesTarget / DASH_TARGET_WORKDAYS : 0;
        const targetPct = monthlySalesTarget > 0 ? Math.round(netMonthSales / monthlySalesTarget * 100) : 0;
        const targetColor = targetPct >= 100 ? 'var(--inv-green)' : targetPct >= 60 ? 'var(--inv-gold)' : 'var(--inv-red)';

        // ── تقرير الجرد اليومي (صافي المركز المالي) ──────────────────
        // مصدر واحد للحساب: أرصدة حسابات الأستاذ الرقابية. هذا يمنع خلط
        // قيمة الجرد التشغيلي مع رصيد الميزانية، ويُدخل الالتزامات 2002.
        const ledgerBalances = {};
        (ledgerLines || []).forEach(line => {
            const code = line.account_code;
            ledgerBalances[code] = (ledgerBalances[code] || 0)
                + (Number(line.debit) || 0) - (Number(line.credit) || 0);
        });
        const ledgerCash = ledgerBalances['1001'] || 0;
        const ownerReceivable = ledgerBalances['1002'] || 0;
        const customersDebt = ledgerBalances['1003'] || 0;
        const ledgerStockValue = ledgerBalances['1004'] || 0;
        const warehouseStockValue = (allStock || []).reduce((sum, row) =>
            sum + (Number(row.qty) || 0) * (Number(row.products?.purchase_price) || 0), 0);
        const vanStockValue = (allVanStock || []).reduce((sum, row) =>
            sum + (Number(row.qty) || 0) * (Number(row.products?.purchase_price) || 0), 0);
        const stockValue = warehouseStockValue + vanStockValue;
        const stockReconciliationDiff = stockValue - ledgerStockValue;
        const deferredReceivable = ledgerBalances['1005'] || 0;
        const suppliersDebt = Math.max(0, -(ledgerBalances['2001'] || 0));
        const accruedLiabilities = Math.max(0, -(ledgerBalances['2002'] || 0));
        // عجز الشركاء/ذمة محمود معلومة منفصلة، ولا تدخل في صافي المركز.
        const partnersDeficit = (capitalPartners || []).reduce((s, p) => s + (Number(p.cumulative_deficit) || 0), 0);
        const netWorth = ledgerCash + customersDebt + stockValue + deferredReceivable - suppliersDebt - accruedLiabilities;

        const fmt = (n) => Number(n || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const fmtDate = (d) => new Date(d).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

        const monthName = new Date().toLocaleDateString('ar-EG', { month: 'long' });

        container.innerHTML = `
        <div class="dash-wrap">

            ${backupBanner}

            <!-- رأس الصفحة -->
            <div class="dash-header">
                <div>
                    <h2 class="dash-title">لوحة التحكم</h2>
                    <p class="dash-sub">${new Date().toLocaleDateString('ar-EG', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</p>
                </div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                    ${dashBr.multi ? dashBranchSelectHtml(dashBr) : ''}
                    <button class="dash-refresh" onclick="renderDashboard(document.getElementById('app-content'))">🔄 تحديث</button>
                </div>
            </div>
            ${dashBranchNote}

            <!-- الكروت الرئيسية -->
            <div class="dash-kpi-grid">
                <div class="dash-kpi dash-kpi-blue">
                    <div class="dash-kpi-icon">💰</div>
                    <div class="dash-kpi-body">
                        <div class="dash-kpi-val">${fmt(cash)}</div>
                        <div class="dash-kpi-lbl">رصيد الخزنة</div>
                    </div>
                </div>
                <div class="dash-kpi dash-kpi-green">
                    <div class="dash-kpi-icon">📈</div>
                    <div class="dash-kpi-body">
                        <div class="dash-kpi-val">${fmt(todaySales)}</div>
                        <div class="dash-kpi-lbl">مبيعات اليوم</div>
                    </div>
                </div>
                <div class="dash-kpi dash-kpi-gold">
                    <div class="dash-kpi-icon">🧾</div>
                    <div class="dash-kpi-body">
                        <div class="dash-kpi-val">${fmt(monthSales)}</div>
                        <div class="dash-kpi-lbl">مبيعات ${monthName}</div>
                    </div>
                </div>
                <div class="dash-kpi ${monthProfit >= 0 ? 'dash-kpi-green' : 'dash-kpi-red'}">
                    <div class="dash-kpi-icon">${monthProfit >= 0 ? '✅' : '📉'}</div>
                    <div class="dash-kpi-body">
                        <div class="dash-kpi-val">${fmt(Math.abs(monthProfit))}</div>
                        <div class="dash-kpi-lbl">${monthProfit >= 0 ? 'ربح' : 'خسارة'} ${monthName}</div>
                    </div>
                </div>
                <div class="dash-kpi dash-kpi-orange">
                    <div class="dash-kpi-icon">🛒</div>
                    <div class="dash-kpi-body">
                        <div class="dash-kpi-val">${fmt(monthPurchases)}</div>
                        <div class="dash-kpi-lbl">مشتريات ${monthName}</div>
                    </div>
                </div>
                <div class="dash-kpi dash-kpi-red">
                    <div class="dash-kpi-icon">💸</div>
                    <div class="dash-kpi-body">
                        <div class="dash-kpi-val">${fmt(monthExpenses)}</div>
                        <div class="dash-kpi-lbl">مصروفات ${monthName}</div>
                    </div>
                </div>
            </div>

            ${dashInsightsHTML(dashIns, monthName, dashBr)}

            <!-- اتجاه المبيعات + هدف المبيعات الشهري: جنب بعض فى بداية الصفحة -->
            <div class="dash-row">
                <div class="dash-card" style="flex:1">
                    <div class="dash-card-header">
                        <span>📈 اتجاه المبيعات</span>
                        <span>
                            <button id="dashTrendBtn7" class="dash-trend-btn" onclick="dashSetTrendRange(7)">7 أيام</button>
                            <button id="dashTrendBtn30" class="dash-trend-btn active" onclick="dashSetTrendRange(30)">30 يوم</button>
                        </span>
                    </div>
                    <div id="dashTrendChartWrap">${dashRenderTrendSVG(30)}</div>
                </div>

                <div class="dash-card" style="flex:1">
                    <div class="dash-card-header"><span>🎯 هدف المبيعات الشهري</span></div>
                    ${dashBranchMode ? '<p class="dash-empty">هدف المبيعات محسوب للشركة كلها (رواتب ومصروفات وهامش الشركة)، فبيظهر في عرض "كل الفروع" بس.</p>' : monthlySalesTarget > 0 ? `
                    <div class="dash-summary-row dash-summary-total">
                        <span>المحقق حتى الآن</span>
                        <span style="color:${targetColor}">${fmt(netMonthSales)} <span style="font-size:11px;color:var(--inv-muted-light);font-weight:400">من ${fmt(monthlySalesTarget)}</span></span>
                    </div>
                    <div class="dash-limit-bar" style="margin:6px 0"><div class="dash-limit-fill" style="width:${Math.min(targetPct,100)}%;background:${targetColor}"></div></div>
                    <div class="dash-summary-row" style="font-size:11px;color:var(--inv-muted-light);margin-bottom:8px">
                        <span>نسبة التحقيق</span>
                        <span style="color:${targetColor};font-weight:700">${targetPct}%</span>
                    </div>
                    <div class="dash-summary-row" style="font-size:11px;color:var(--inv-muted-light)">
                        <span>المطلوب بيعه يوميًا (÷ ${DASH_TARGET_WORKDAYS} يوم عمل)</span>
                        <span>${fmt(dailySalesTargetCalc)}</span>
                    </div>
                    <div class="dash-summary-divider"></div>
                    <div style="font-size:11px;color:var(--inv-muted-light);margin-bottom:6px">📐 إزاي اتحسب الرقم ده؟</div>
                    <div class="dash-summary-row" style="font-size:11px;color:var(--inv-muted)">
                        <span>المصروفات المتوقعة (رواتب + بنود تشغيل)</span>
                        <span>${fmt(expectedSalaries + expectedOpEx)}</span>
                    </div>
                    <div class="dash-summary-row" style="font-size:11px;color:var(--inv-muted)">
                        <span>+ هامش الربح المستهدف (من الإعدادات)</span>
                        <span>${fmt(monthlyTargetMargin)}</span>
                    </div>
                    <div class="dash-summary-row" style="font-size:11px;color:var(--inv-muted)">
                        <span>÷ متوسط هامش الربح الفعلي (آخر 90 يوم)</span>
                        <span>${Math.round(avgMarginPct * 100)}%</span>
                    </div>
                    <div class="dash-summary-row" style="font-size:11px;color:var(--inv-text);font-weight:700;margin-top:2px">
                        <span>= الهدف الشهري</span>
                        <span>${fmt(monthlySalesTarget)}</span>
                    </div>
                    <div style="font-size:10.5px;color:var(--inv-muted-light);margin-top:6px;line-height:1.5">
                        يعني: عشان تغطي مصروفاتك المتوقعة وتحقق الهامش اللي حددته، بهامش الربح الحقيقي اللي بتبيع بيه فعلاً، لازم تبيع بالرقم ده الشهر ده.
                    </div>` : `
                    <p class="dash-empty">حدّد "هامش الربح المستهدف شهريًا" من ⚙️ الإعدادات العامة عشان يظهر هدف المبيعات هنا.</p>`}
                </div>
            </div>

            <!-- تقرير الجرد اليومي + ملخص الشهر — جنب بعض عشان تبان العلاقة بينهم -->
            <div class="dash-row">
                <div class="dash-card" style="flex:1">
                    <div class="dash-card-header"><span>📋 تقرير الجرد اليومي — صافي المركز المالي${dashBranchMode ? ' <span style="font-size:11px;font-weight:400;color:var(--inv-muted)">(كل الفروع)</span>' : ''}</span></div>
                    ${dashBranchMode ? `<div class="dash-summary-row"><span style="color:var(--inv-muted)">🏬 قيمة مخزون الفرع المختار (للمعلومية، مش داخل الإجمالي)</span><span style="color:var(--inv-gold)">${fmt(Number(dashMain.branch.stock.warehouse_value || 0) + Number(dashMain.branch.stock.van_value || 0))}</span></div>` : ''}
                    <div class="dash-summary-row"><span>📦 قيمة البضاعة الفعلية (المخازن + السيارات)</span><span class="dash-s-green">${fmt(stockValue)}</span></div>
                    ${Math.abs(stockReconciliationDiff) >= 0.01 ? `<div class="dash-summary-row"><span style="color:var(--inv-muted)">⚠️ فرق مطابقة حساب المخزون</span><span style="color:var(--inv-gold)">${fmt(stockReconciliationDiff)}</span></div>` : ''}
                    <div class="dash-summary-row"><span>💰 رصيد الخزنة (دفتر الأستاذ)</span><span class="dash-s-green">${fmt(ledgerCash)}</span></div>
                    <div class="dash-summary-row"><span>👥 مديونية العملاء (لينا عندهم)</span><span class="dash-s-green">${fmt(customersDebt)}</span></div>
                    <div class="dash-summary-row"><span>🏭 مستحقات الموردين (عندنا ليهم)</span><span class="dash-s-red">- ${fmt(suppliersDebt)}</span></div>
                    <div class="dash-summary-row"><span>📌 التزامات ومصروفات مستحقة</span><span class="dash-s-red">- ${fmt(accruedLiabilities)}</span></div>
                    <div class="dash-summary-row"><span>⏳ مؤجلات مستحقة من الموردين</span><span class="dash-s-green">${fmt(deferredReceivable)}</span></div>
                    <div class="dash-summary-divider"></div>
                    <div class="dash-summary-row dash-summary-total">
                        <span>${netWorth >= 0 ? '✅ صافي المركز المالي' : '📉 صافي المركز المالي'}</span>
                        <span style="color:${netWorth >= 0 ? 'var(--inv-green)' : 'var(--inv-red)'}">${fmt(Math.abs(netWorth))}</span>
                    </div>
                    ${partnersDeficit > 0 ? `<div class="dash-summary-row" style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--inv-divider)">
                        <span style="color:var(--inv-muted)">🧾 عجز شركاء رأس المال (للمعلومية، مش داخل الإجمالي)</span>
                        <span style="color:var(--inv-gold)">${fmt(partnersDeficit)}</span>
                    </div>` : ''}
                    ${ownerReceivable > 0 ? `<div class="dash-summary-row">
                        <span style="color:var(--inv-muted)">👤 ذمة مدينة من المالك (للمعلومية، مش داخل الإجمالي)</span>
                        <span style="color:var(--inv-gold)">${fmt(ownerReceivable)}</span>
                    </div>` : ''}
                    <div style="font-size:11px;color:var(--inv-muted-light);margin-top:4px;line-height:1.6">
                        ⚠️ هذا صافي أصول النشاط من دفتر الأستاذ: خزينة + عملاء + مخزون + مؤجلات، ناقص الموردين والالتزامات المستحقة. لا يمثل الربح أو رأس المال، وذمة المالك وعجز الشركاء خارج الإجمالي لمنع تكرار نفس الأثر مرتين.
                    </div>
                </div>
                <div class="dash-card" style="flex:1">
                    <div class="dash-card-header"><span>📊 ملخص ${monthName}</span></div>
                    <div class="dash-summary-row"><span>صافي المبيعات</span><span class="dash-s-green">${fmt(netMonthSales)}</span></div>
                    <div class="dash-summary-row"><span>(-) تكلفة البضاعة المباعة</span><span class="dash-s-red">${fmt(monthCOGS)}</span></div>
                    <div class="dash-summary-row"><span>(-) إجمالي المصروفات</span><span class="dash-s-red">${fmt(monthExpenses)}</span></div>
                    ${monthDiscounts > 0 ? `<div class="dash-summary-row"><span>(-) خصومات تحصيل من العملاء</span><span class="dash-s-red">${fmt(monthDiscounts)}</span></div>` : ''}
                    <div class="dash-summary-divider"></div>
                    <div class="dash-summary-row dash-summary-total">
                        <span>${monthProfit >= 0 ? '✅ صافي الربح' : '📉 صافي الخسارة'}</span>
                        <span style="color:${monthProfit >= 0 ? 'var(--inv-green)' : 'var(--inv-red)'}">${fmt(Math.abs(monthProfit))}</span>
                    </div>
                    <div class="dash-summary-row" style="font-size:11px;color:var(--inv-muted-light);margin-top:4px">
                        <span>هامش الربح</span>
                        <span>${netMonthSales > 0 ? Math.round(monthProfit / netMonthSales * 100) : 0}%</span>
                    </div>
                </div>
            </div>

            <!-- الصف الثاني: آخر مبيعات + عملاء متأخرون -->
            <div class="dash-row">

                <!-- آخر المبيعات -->
                <div class="dash-card" style="flex:2">
                    <div class="dash-card-header">
                        <span>🧾 آخر الفواتير</span>
                        <span class="dash-see-all" onclick="loadMod(document.querySelector('[data-mod=sales]'),'sales')">+ فاتورة جديدة</span>
                    </div>
                    <table class="dash-table">
                        <thead><tr><th>رقم الفاتورة</th><th>العميل</th><th>المبلغ</th><th>النوع</th><th>التاريخ</th></tr></thead>
                        <tbody>
                            ${(latestSales || []).length ? (latestSales).map(s => `
                            <tr>
                                <td><span class="dash-inv-no">${s.invoice_no}</span></td>
                                <td>${s.customers?.name || 'نقدي'}</td>
                                <td class="dash-amount">${fmt(s.total)}</td>
                                <td><span class="dash-badge ${s.payment_type === 'cash' ? 'dash-badge-green' : 'dash-badge-blue'}">${s.payment_type === 'cash' ? 'نقدي' : 'آجل'}</span></td>
                                <td class="dash-muted">${fmtDate(s.created_at)}</td>
                            </tr>`).join('') : '<tr><td colspan="5" class="dash-empty">لا توجد فواتير بعد</td></tr>'}
                        </tbody>
                    </table>
                </div>

                <!-- عملاء متأخرون -->
                <div class="dash-card" style="flex:1">
                    <div class="dash-card-header">
                        <span>⚠️ عملاء بديون</span>
                    </div>
                    ${(overdueCustomers || []).length ? (overdueCustomers).map(c => {
                        const limit = Number(c.credit_limit) || 0;
                        const bal = Number(c.balance) || 0;
                        const pct = limit > 0 ? Math.min(100, Math.round(bal / limit * 100)) : 0;
                        const color = pct > 90 ? 'var(--inv-red)' : pct > 70 ? 'var(--inv-gold)' : 'var(--inv-green)';
                        return `<div class="dash-cust-item">
                            <div class="dash-cust-name">${c.name}</div>
                            <div class="dash-cust-bal" style="color:${color}">${fmt(bal)} ج.م</div>
                            ${limit > 0 ? `<div class="dash-limit-bar"><div class="dash-limit-fill" style="width:${pct}%;background:${color}"></div></div>
                            <div class="dash-cust-hint">${pct}% من الحد (${fmt(limit)})</div>` : ''}
                        </div>`;
                    }).join('') : '<p class="dash-empty">لا توجد ديون متأخرة 🎉</p>'}
                </div>
            </div>

            <!-- الصف الثالث: أكثر الأصناف مبيعاً + مخزون منخفض -->
            <div class="dash-row">

                <!-- أكثر الأصناف مبيعاً -->
                <div class="dash-card" style="flex:1">
                    <div class="dash-card-header"><span>🏆 أكثر مبيعاً — ${monthName}</span></div>
                    ${(topProducts || []).length ? topProducts.map((p, i) => `
                    <div class="dash-top-item">
                        <span class="dash-rank">${['🥇','🥈','🥉','4️⃣','5️⃣'][i]}</span>
                        <span class="dash-top-name">${p.products?.name || '—'}</span>
                        <span class="dash-top-qty">${fmt(p.qty)} وحدة</span>
                    </div>`).join('') : '<p class="dash-empty">لا توجد مبيعات هذا الشهر</p>'}
                </div>

                <!-- مخزون منخفض -->
                <div class="dash-card" style="flex:1">
                    <div class="dash-card-header"><span>📦 مخزون منخفض</span></div>
                    ${(lowStock || []).length ? lowStock.map(s => `
                    <div class="dash-low-item">
                        <div>
                            <div class="dash-low-name">${s.products?.name || '—'}</div>
                            <div class="dash-low-code">${s.products?.code || ''}</div>
                        </div>
                        <span class="dash-low-qty ${s.qty <= 0 ? 'dash-low-zero' : 'dash-low-warn'}">${s.qty} وحدة</span>
                    </div>`).join('') : '<p class="dash-empty">كل الأصناف بمخزون جيد ✅</p>'}
                </div>
            </div>
        </div>`;

    } catch (err) {
        container.innerHTML = `<div class="dash-error">
            <div style="font-size:32px">⚠️</div>
            <div>خطأ في تحميل البيانات</div>
            <div style="font-size:12px;margin-top:8px;color:var(--inv-muted-light)">${err.message}</div>
            <button class="dash-refresh" onclick="renderDashboard(document.getElementById('app-content'))" style="margin-top:12px">إعادة المحاولة</button>
        </div>`;
    }
}

// ════════════════════════════════════════════════════════════
// مؤشرات المتابعة — بتعرض نتيجة fn_dashboard_insights (قاعدة البيانات)
// نفس تعريفات اللوحة: الربح = صافي المبيعات − تكلفة البضاعة − المصروفات − خصومات التحصيل.
// مقارنة الفترة السابقة وراكد العملاء/الأصناف بيظهروا تلقائياً لما يتجمع تاريخ كفاية.
// ════════════════════════════════════════════════════════════
function dashInsFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function dashInsEsc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function dashInsDelta(cur, prev) {
    cur = Number(cur) || 0; prev = Number(prev) || 0;
    if (!prev) return '<span style="color:var(--inv-muted)">—</span>';
    const pct = (cur - prev) / Math.abs(prev) * 100;
    const good = pct >= 0;
    return `<span style="color:${good ? 'var(--inv-green)' : 'var(--inv-red)'};font-weight:700">${good ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%</span>`;
}

// ── فلتر الفرع (مؤشرات المتابعة بس) ──
// ui = { multi, list, selected }؛ الاختيار بيتحفظ في localStorage (قيمة راحة للمستخدم، مش بيانات)
let dashBranchSel = null;
function dashStoredBranch() { try { return localStorage.getItem('dash_branch') || null; } catch { return null; } }
function dashStoreBranch(id) { try { if (id) localStorage.setItem('dash_branch', id); else localStorage.removeItem('dash_branch'); } catch { /* مش مهم */ } }
async function dashBranchState() {
    let multi = false, list = [];
    try {
        if (typeof brLoad === 'function') {
            const c = await brLoad();
            list = c.ok ? c.list.filter(b => b.is_active) : [];
            multi = list.length > 1;
        }
    } catch { /* الفروع مش متاحة → لوحة عادية */ }
    let selected = multi ? (dashBranchSel || dashStoredBranch()) : null;
    if (selected && !list.some(b => b.id === selected)) selected = null;     // فرع اتحذف/اتعطّل → كل الفروع
    dashBranchSel = selected;
    return { multi, list, selected };
}
function dashFetchInsights(branchId) {
    return sb.rpc('fn_dashboard_insights', branchId ? { p_branch_id: branchId } : {}).then(r => (r.error ? null : r.data), () => null);
}
// تغيير الفرع: بيأثر على اللوحة كلها (الكروت الرئيسية + مؤشرات المتابعة) فبنعيد رسمها
async function dashSetBranch(id) {
    dashBranchSel = id || null; dashStoreBranch(dashBranchSel);
    const host = document.getElementById('app-content');
    if (host) await renderDashboard(host);
}
window.dashSetBranch = dashSetBranch;

// قائمة اختيار الفرع في رأس اللوحة (بتظهر بس لما يبقى فيه أكتر من فرع نشط)
function dashBranchSelectHtml(ui) {
    return `<select class="ob-input" style="margin:0;width:auto;min-width:150px;font-size:13px" onchange="dashSetBranch(this.value)" title="فلتر الفرع">
        <option value="">🏬 كل الفروع</option>
        ${ui.list.map(b => `<option value="${dashInsEsc(b.id)}" ${b.id === ui.selected ? 'selected' : ''}>${dashInsEsc(b.name)}</option>`).join('')}
    </select>`;
}

// ── الأرقام الرئيسية من القاعدة (fn_dashboard_main) ──
// بترجّع { branch, company }: لو مفيش فرع مختار الاتنين نفس النتيجة؛ ولو فيه فرع مختار بنجيب نداء تاني للشركة كلها
// للأجزاء اللي مش مقسومة على فروع (المركز المالي، الديون، الهدف). null لو الدالة مش متاحة → الاستعلامات القديمة.
async function dashFetchMain(branchId) {
    const call = (b) => sb.rpc('fn_dashboard_main', b ? { p_branch_id: b } : {}).then(r => (r.error ? null : r.data), () => null);
    if (!branchId) { const all = await call(null); return all ? { branch: all, company: all } : null; }
    const [br, co] = await Promise.all([call(branchId), call(null)]);
    return (br && co) ? { branch: br, company: co } : null;
}

// بيحوّل نتيجة الدالة لنفس شكل نتايج الاستعلامات القديمة (بنفس ترتيب الـ destructuring في renderDashboard)،
// عشان كود الحساب والعرض القديم يفضل زي ما هو من غير أي تعديل، وبنفس الأرقام.
function dashAdapterResults(m) {
    const b = m.branch, c = m.company, num = x => Number(x) || 0;
    const raw = c.raw_settings || {};
    const setting = k => (raw[k] == null ? null : { value: raw[k] });
    const ledgerLines = Object.entries(c.ledger || {}).map(([code, bal]) => ({
        account_code: code, debit: num(bal) > 0 ? num(bal) : 0, credit: num(bal) < 0 ? -num(bal) : 0 }));
    const r = (data) => ({ data });
    return [
        r(num(b.cash)),                                                                   //  1 cashData
        r([{ total: num(b.today_sales) }]),                                               //  2 salesToday
        r([{ total: num(b.month.gross_sales) }]),                                         //  3 salesMonth
        r([{ total: num(b.month.returns) }]),                                             //  4 salesReturnsMonth
        r([{ total: num(b.month.purchases) }]),                                           //  5 purchasesMonth
        r([{ amount: num(b.month.expenses) }]),                                           //  6 expensesMonth
        r([{ discount: num(b.month.discounts) }]),                                        //  7 collectionDiscountsMonth
        r([{ qty: 1, cost_price_snapshot: num(b.month.cogs) }]),                          //  8 saleItemsCostMonth (التكلفة صافي المرتجعات جاهزة)
        r([]),                                                                            //  9 returnItemsCostMonth
        r((b.low_stock || []).map(x => ({ qty: num(x.qty), products: { name: x.name, code: x.code } }))),                         // 10 lowStock
        r((b.top_products || []).map(x => ({ qty: num(x.qty), products: { name: x.name } }))),                                    // 11 topProducts
        r((b.latest_sales || []).map(x => ({ invoice_no: x.invoice_no, total: x.total, created_at: x.created_at,
            payment_type: x.payment_type, customers: x.customer_name ? { name: x.customer_name } : null }))),                     // 12 latestSales
        r(c.overdue_customers || []),                                                     // 13 overdueCustomers (كل الفروع)
        r([{ qty: 1, products: { purchase_price: num(c.stock && c.stock.warehouse_value) } }]),   // 14 allStock (الشركة كلها — للمركز المالي)
        r([{ qty: 1, products: { purchase_price: num(c.stock && c.stock.van_value) } }]),         // 15 allVanStock
        r([]), r([]),                                                                     // 16-17 allCustomers/allSuppliers (مش مستخدمين)
        r([]),                                                                            // 18 trendSales (الاتجاه بيتحط مباشرة من الدالة)
        r(setting('last_backup_at')),                                                     // 19 lastBackupRow
        r(setting('daily_sales_target')),                                                 // 20 dailyTargetRow
        r([{ base_salary: num(c.target && c.target.expected_salaries) }]),                // 21 activeEmployees
        r([{ monthly_limit: num(c.target && c.target.expected_opex) }]),                  // 22 expenseCatsForTarget
        r(setting('monthly_target_profit_margin')),                                       // 23 monthlyMarginRow
        r([{ qty: 1, line_total: num(c.margin90 && c.margin90.revenue), cost_price_snapshot: num(c.margin90 && c.margin90.cost) }]), // 24 marginSaleItems
        r([]),                                                                            // 25 marginReturnItems
        r([]), r([]),                                                                     // 26-27 deferredAuto/Manual (مش مستخدمين)
        r([{ cumulative_deficit: num(c.partners_deficit) }]),                             // 28 capitalPartners
        r(ledgerLines),                                                                   // 29 ledgerLines
    ];
}

function dashInsightsHTML(ins, monthName, ui) {
    if (!ins) return '<div id="dashInsightsWrap"></div>';
    const f = dashInsFmt, e = dashInsEsc;
    ui = ui || { multi: false, list: [], selected: null };
    const branchName = ins.branch && ins.branch.name ? ins.branch.name : null;
    const cur = ins.current || {}, prev = ins.previous || null;
    const hist = Number(ins.history_days) || 0;

    // ── مقارنة الشهر الحالي بنفس الفترة من الشهر السابق ──
    const cmp = (label, key, fmtFn) => `
        <div style="flex:1;min-width:140px">
            <div style="font-size:12px;color:var(--inv-muted)">${label}</div>
            <div style="font-size:19px;font-weight:800;color:var(--inv-navy)">${fmtFn(cur[key])}</div>
            <div style="font-size:12px">${prev ? dashInsDelta(cur[key], prev[key]) + ` <span style="color:var(--inv-muted)">(قبل: ${fmtFn(prev[key])})</span>` : '<span style="color:var(--inv-muted)">—</span>'}</div>
        </div>`;
    const cmpNote = prev
        ? `مقارنة ${e(cur.from)} → ${e(cur.to)} بنفس الفترة ${e(prev.from)} → ${e(prev.to)}`
        : 'المقارنة بالشهر السابق هتظهر أول ما يتجمع بيانات شهر سابق في النظام';

    // ── أعمار الديون ──
    const a = ins.aging || {};
    // حدود الشرائح جاية من الإعدادات (الإعدادات العامة → مؤشرات لوحة التحكم)؛ الافتراضي 30/60/90
    const bd = (Array.isArray(a.bounds) && a.bounds.length === 3) ? a.bounds.map(Number) : [30, 60, 90];
    const bk = Array.isArray(a.buckets) ? a.buckets : [0, 0, 0, 0];
    const buckets = [
        [`0 – ${bd[0]} يوم`, bk[0], 'var(--inv-green)'],
        [`${bd[0] + 1} – ${bd[1]} يوم`, bk[1], 'var(--inv-gold)'],
        [`${bd[1] + 1} – ${bd[2]} يوم`, bk[2], '#EA580C'],
        [`أكثر من ${bd[2]} يوم`, bk[3], 'var(--inv-red)'],
        ['رصيد افتتاحي غير مؤرخ', a.opening_undated, 'var(--inv-muted)'],
    ];
    const maxB = Math.max(1, ...buckets.map(b => Number(b[1]) || 0));
    const agingHTML = (Number(a.open_total) || 0) > 0 ? buckets.map(([lbl, v, col]) => `
        <div style="margin:7px 0">
            <div style="display:flex;justify-content:space-between;font-size:12.5px"><span>${lbl}</span><b>${f(v)}</b></div>
            <div style="height:7px;border-radius:4px;background:var(--inv-bg);margin-top:3px"><div style="height:7px;border-radius:4px;width:${Math.round((Number(v) || 0) / maxB * 100)}%;background:${col}"></div></div>
        </div>`).join('') + `<div style="font-size:12px;color:var(--inv-muted);margin-top:8px">إجمالي الديون المفتوحة ${f(a.open_total)} — ${a.customers_with_debt || 0} عميل</div>`
        : '<p class="dash-empty">لا توجد ديون مفتوحة ✅</p>';

    // ── قوائم الهامش ──
    const list = (rows, empty) => (rows && rows.length) ? rows.map(r => `
        <div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;font-size:12.5px;border-bottom:1px solid var(--inv-bg)">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e(r.name)}</span>
            <span style="white-space:nowrap;color:${Number(r.profit) < 0 ? 'var(--inv-red)' : 'var(--inv-text)'}"><b>${f(r.profit)}</b>${r.margin_pct != null ? ` <span style="color:var(--inv-muted)">(${r.margin_pct}%)</span>` : ''}</span>
        </div>`).join('') : `<p class="dash-empty">${empty}</p>`;
    const top = ins.top_products || [];
    const bottom = (ins.bottom_products || []).filter(p => !top.some(t => t.name === p.name));

    // ── تنبيهات ──
    const b = ins.below_cost || {};
    const alerts = [];
    if ((b.lines || 0) > 0) alerts.push(['var(--inv-red)', `🚨 ${b.lines} سطر بيع <b>تحت التكلفة</b> هذا الشهر — خسارة ${f(b.loss)}`]);
    const rt = ins.returns || {};
    // الأرقام (أيام الركود / حد تحذير المرتجعات) جاية من الإعدادات → الإعدادات العامة → "مؤشرات اللوحة"
    const st = ins.settings || {};
    const dormantDays = Number(st.dormant_days) || 30;
    const slowDays = Number(st.slow_stock_days) || 60;
    const retWarn = st.returns_warn_pct != null ? Number(st.returns_warn_pct) : 5;
    if (rt.pct != null) alerts.push([rt.pct > retWarn ? 'var(--inv-gold)' : 'var(--inv-muted)', `↩️ المرتجعات ${rt.pct}% من المبيعات (${f(rt.returns)})`]);
    alerts.push(ins.dormant
        ? ['var(--inv-gold)', `😴 ${ins.dormant.count} عميل لم يشتروا منذ ${dormantDays} يوم — أرصدتهم ${f(ins.dormant.balance)}`]
        : ['var(--inv-muted)', `😴 العملاء الراكدون: يظهر بعد ${dormantDays} يوم من التشغيل (متبقي ${Math.max(0, dormantDays - hist)} يوم)`]);
    alerts.push(ins.slow_stock
        ? ['var(--inv-gold)', `🐢 ${ins.slow_stock.count} صنف راكد (لا مبيعات ${slowDays} يوم) بقيمة ${f(ins.slow_stock.value)}`]
        : ['var(--inv-muted)', `🐢 الأصناف الراكدة: تظهر بعد ${slowDays} يوم من التشغيل (متبقي ${Math.max(0, slowDays - hist)} يوم)`]);

    return `
    <div id="dashInsightsWrap">
    <div class="dash-card" style="margin-bottom:18px">
        <div class="dash-card-header"><span>🔎 مؤشرات المتابعة — ${monthName} حتى اليوم${branchName ? ` — <span style="color:var(--inv-gold)">${e(branchName)}</span>` : ''}</span></div>
        <div style="display:flex;gap:16px;flex-wrap:wrap">
            ${cmp('صافي المبيعات', 'net_sales', f)}
            ${cmp('الربح', 'profit', f)}
            ${cmp('عدد الفواتير', 'invoices', v => String(Number(v) || 0))}
            ${cmp('متوسط الفاتورة', 'avg_invoice', f)}
        </div>
        <div style="font-size:11.5px;color:var(--inv-muted);margin-top:10px">${cmpNote}</div>
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:5px">
            ${alerts.map(([col, html]) => `<div style="font-size:12.5px;color:${col}">${html}</div>`).join('')}
        </div>
    </div>
    <div class="dash-row">
        <div class="dash-card"><div class="dash-card-header"><span>⏳ أعمار الديون${branchName ? ' <span style="font-size:11px;font-weight:400;color:var(--inv-muted)">(كل الفروع — أرصدة العملاء مش مقسومة على فروع)</span>' : ''}</span></div>${agingHTML}</div>
        <div class="dash-card"><div class="dash-card-header"><span>📦 أعلى الأصناف ربحاً</span></div>${list(top, 'لا مبيعات هذا الشهر بعد')}
            ${bottom.length ? `<div style="font-size:12px;font-weight:800;color:var(--inv-navy);margin:12px 0 4px">الأقل ربحاً / الخاسرة</div>${list(bottom, '')}` : ''}</div>
        <div class="dash-card"><div class="dash-card-header"><span>👥 أعلى العملاء ربحاً</span></div>${list(ins.top_customers, 'لا مبيعات هذا الشهر بعد')}</div>
        <div class="dash-card"><div class="dash-card-header"><span>🚗 الربح حسب المندوب</span></div>${list(ins.by_rep, 'لا مبيعات هذا الشهر بعد')}</div>
    </div>
    </div>`;
}

function dashFmtTrend(n) {
    return Number(n || 0).toLocaleString('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ★ حالة آخر رسم اتُنفّذ — بتتخزن عشان دالة الـ hover تقدر توصل لإحداثيات
//   النقط من غير ما تعيد حساب كل حاجة تاني مع كل حركة فأر
let dashTrendLayout = null;

// ألوان الأعمدة حسب نسبة تحقيق الهدف اليومي — نفس تدريج ألوان الأهداف
// المستخدم فى rep-visits.js (rvRenderGoalsPage): 100%+ أخضر، 60-99% برتقالي، أقل من 60% أحمر.
// لو مفيش هدف متحدد من الإعدادات (٠)، كل الأعمدة بتاخد اللون الأخضر العادي.
function dashTrendBarColor(v) {
    if (dashDailyTarget <= 0) return 'var(--inv-green)';
    const pct = v / dashDailyTarget * 100;
    return pct >= 100 ? 'var(--inv-green)' : pct >= 60 ? 'var(--inv-gold-light)' : '#EF4444';
}

function dashRenderTrendSVG(days) {
    const data = dashTrendDaily.slice(-days);
    const n = data.length;
    const values = data.map(d => d.total);
    const max = Math.max(...values, dashDailyTarget, 1) * 1.15;
    const W = 700, H = 170, padL = 6, padR = 6, padT = 10, padB = 22;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const stepX = n > 1 ? plotW / (n - 1) : 0;
    const xAt = i => padL + i * stepX;
    const yAt = v => padT + plotH - (v / max) * plotH;
    const baseline = padT + plotH;
    const barW = n > 1 ? Math.max(2, stepX * 0.62) : Math.min(plotW * 0.4, 60);

    const bars = data.map((d, i) => {
        const h = Math.max((d.total / max) * plotH, d.total > 0 ? 1.5 : 0);
        const x = xAt(i) - barW / 2, y = baseline - h;
        return `<rect data-i="${i}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${dashTrendBarColor(d.total)}"/>`;
    }).join('');

    const targetLine = dashDailyTarget > 0 ? `
        <line x1="${padL}" y1="${yAt(dashDailyTarget).toFixed(1)}" x2="${W - padR}" y2="${yAt(dashDailyTarget).toFixed(1)}" stroke="var(--inv-navy-light)" stroke-width="1.2" stroke-dasharray="4,3"/>
        <text x="${W - padR}" y="${(yAt(dashDailyTarget) - 4).toFixed(1)}" font-size="9.5" fill="var(--inv-navy-light)" text-anchor="end" font-weight="700">🎯 الهدف: ${dashFmtTrend(dashDailyTarget)}</text>` : '';

    const labelEvery = days <= 7 ? 1 : 5;
    const xLabels = data.map((d, i) => {
        if (i % labelEvery !== 0 && i !== n - 1) return '';
        const dt = new Date(d.date + 'T00:00:00');
        const txt = dt.toLocaleDateString('ar-EG', { day: 'numeric', month: 'numeric' });
        return `<text x="${xAt(i).toFixed(1)}" y="${H - 6}" font-size="9" fill="var(--inv-muted-light)" text-anchor="middle">${txt}</text>`;
    }).filter(Boolean).join('');

    dashTrendLayout = { data, xAt, n, W, barW, padT, plotH };

    return `
    <div style="position:relative">
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:150px;display:block" preserveAspectRatio="none">
        <line x1="${padL}" y1="${baseline.toFixed(1)}" x2="${W - padR}" y2="${baseline.toFixed(1)}" stroke="#F1F5F9" stroke-width="1"/>
        <rect id="dashTrendHoverCol" x="0" y="${padT}" width="${barW.toFixed(1)}" height="${plotH.toFixed(1)}" fill="var(--inv-navy-deep)" opacity="0"/>
        ${bars}
        ${targetLine}
        ${xLabels}
        <rect x="${padL}" y="0" width="${plotW}" height="${H}" fill="transparent" onmousemove="dashTrendHover(event)" onmouseleave="dashTrendHoverOut()" style="cursor:crosshair"/>
      </svg>
      <div id="dashTrendTooltip" style="position:absolute;top:6px;background:var(--inv-navy-deep);color:#fff;padding:4px 9px;border-radius:6px;font-size:11px;pointer-events:none;display:none;white-space:nowrap;line-height:1.5"></div>
    </div>
    ${!values.some(v => v > 0) ? '<p class="dash-empty" style="margin-top:8px">لا توجد مبيعات في هذه الفترة</p>' : ''}
    ${dashDailyTarget > 0 ? `<div style="display:flex;gap:14px;margin-top:6px;font-size:11px;color:var(--inv-muted)">
        <span>🟢 حقّق الهدف</span><span>🟠 قرّب منه (٦٠٪+)</span><span>🔴 بعيد عنه</span>
    </div>` : ''}`;
}

function dashTrendHover(evt) {
    if (!dashTrendLayout) return;
    const svg = evt.currentTarget.ownerSVGElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const { data, xAt, n, W, barW, padT, plotH } = dashTrendLayout;
    const mx = (evt.clientX - rect.left) * (W / rect.width);
    let idx = 0, best = Infinity;
    for (let i = 0; i < n; i++) {
        const dx = Math.abs(xAt(i) - mx);
        if (dx < best) { best = dx; idx = i; }
    }
    const px = xAt(idx);
    const col = document.getElementById('dashTrendHoverCol');
    if (col) { col.setAttribute('x', (px - barW / 2).toFixed(1)); col.setAttribute('y', padT); col.setAttribute('height', plotH); col.style.opacity = 0.05; }
    const tip = document.getElementById('dashTrendTooltip');
    if (tip) {
        const d = data[idx];
        const dt = new Date(d.date + 'T00:00:00');
        let extra = '';
        if (dashDailyTarget > 0) {
            const diff = d.total - dashDailyTarget;
            extra = diff >= 0
                ? `<br><span style="color:#4ADE80">✅ حقّق الهدف (+${dashFmtTrend(diff)})</span>`
                : `<br><span style="color:#FCA5A5">⚠️ ${dashFmtTrend(-diff)} تحت الهدف</span>`;
        }
        tip.innerHTML = `<b>${dashFmtTrend(d.total)} ج.م</b> — ${dt.toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'short' })}${extra}`;
        tip.style.display = 'block';
        const leftPct = (px / W) * 100;
        tip.style.left = leftPct < 50 ? `calc(${leftPct}% + 8px)` : 'auto';
        tip.style.right = leftPct >= 50 ? `calc(${100 - leftPct}% + 8px)` : 'auto';
    }
}

function dashTrendHoverOut() {
    const col = document.getElementById('dashTrendHoverCol');
    const tip = document.getElementById('dashTrendTooltip');
    if (col) col.style.opacity = 0;
    if (tip) tip.style.display = 'none';
}

function dashSetTrendRange(days) {
    const wrap = document.getElementById('dashTrendChartWrap');
    if (wrap) wrap.innerHTML = dashRenderTrendSVG(days);
    document.getElementById('dashTrendBtn7')?.classList.toggle('active', days === 7);
    document.getElementById('dashTrendBtn30')?.classList.toggle('active', days === 30);
}
