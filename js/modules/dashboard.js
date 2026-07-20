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
    container.innerHTML = `<div style="text-align:center;padding:40px;color:#64748B">
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

        const [
            { data: cashData },
            { data: salesToday },
            { data: salesMonth },
            { data: salesReturnsMonth },
            { data: purchasesMonth },
            { data: expensesMonth },
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
        ] = await Promise.all([
            sb.rpc('get_cash_balance'),
            sb.from('sales').select('total').eq('status','confirmed').gte('created_at', today),
            sb.from('sales').select('total,subtotal').eq('status','confirmed').gte('created_at', monthStart),
            sb.from('sales_returns').select('total').eq('status','confirmed').gte('created_at', monthStart),
            sb.from('purchases').select('total').eq('status','confirmed').gte('created_at', monthStart),
            sb.from('expenses').select('amount').eq('status','confirmed').gte('expense_date', monthStart),
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
            // نفس منطق حساب قيمة المخزون المستخدم في js/modules/inventory.js (qty * purchase_price)
            sb.from('inventory_stock').select('qty, products(purchase_price)'),
            // بضاعة موجودة فعليًا مع المندوبين على العربيات — من غيرها "قيمة البضاعة"
            // فى تقرير الجرد كانت بتفوّت كل مخزون العربيات وتوريه أقل من الحقيقي
            sb.from('van_stock').select('qty, products(purchase_price)'),
            // نفس منطق حساب مديونية العملاء المستخدم في js/modules/customers.js (مجموع الأرصدة الموجبة فقط)
            sb.from('customers').select('balance'),
            // نفس منطق حساب مستحقات الموردين المستخدم في js/modules/suppliers.js (مجموع الأرصدة الموجبة فقط)
            sb.from('suppliers').select('balance'),
            // اتجاه المبيعات — آخر 30 يوم، بيتجمّع باليوم في الـ JS تحت
            sb.from('sales').select('total,created_at').eq('status','confirmed').gte('created_at', trendStart),
            sb.from('app_settings').select('value').eq('key','last_backup_at').maybeSingle(),
            sb.from('app_settings').select('value').eq('key','daily_sales_target').maybeSingle(),
        ]);

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
        const monthCOGS = (saleItemsCostMonth || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.cost_price_snapshot) || 0), 0)
            - (returnItemsCostMonth || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.cost_price_snapshot) || 0), 0);
        const monthProfit = netMonthSales - monthCOGS - monthExpenses;

        // ── تقرير الجرد اليومي (صافي المركز المالي) ──────────────────
        // قيمة المخزون (مخازن + عربيات المندوبين) + رصيد الخزنة + مديونية العملاء - مستحقات الموردين
        const stockValue = (allStock || []).reduce((s, r) => s + (Number(r.qty) || 0) * Number(r.products?.purchase_price || 0), 0);
        const vanStockValue = (allVanStock || []).reduce((s, r) => s + (Number(r.qty) || 0) * Number(r.products?.purchase_price || 0), 0);
        const customersDebt = (allCustomers || []).reduce((s, c) => s + (Number(c.balance) > 0 ? Number(c.balance) : 0), 0);
        const suppliersDebt = (allSuppliers || []).reduce((s, sp) => s + (Number(sp.balance) > 0 ? Number(sp.balance) : 0), 0);
        const netWorth = stockValue + vanStockValue + cash + customersDebt - suppliersDebt;

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
                <button class="dash-refresh" onclick="renderDashboard(document.getElementById('app-content'))">🔄 تحديث</button>
            </div>

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

            <!-- اتجاه المبيعات + تقرير الجرد اليومي: جنب بعض فى نفس الصف -->
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
                    <div class="dash-card-header"><span>📋 تقرير الجرد اليومي — صافي المركز المالي</span></div>
                    <div class="dash-summary-row"><span>📦 قيمة البضاعة (المخازن)</span><span class="dash-s-green">${fmt(stockValue)}</span></div>
                    <div class="dash-summary-row"><span>🚚 بضاعة عربيات المندوبين</span><span class="dash-s-green">${fmt(vanStockValue)}</span></div>
                    <div class="dash-summary-row"><span>💰 رصيد الخزنة (كل الخزن)</span><span class="dash-s-green">${fmt(cash)}</span></div>
                    <div class="dash-summary-row"><span>👥 مديونية العملاء (لينا عندهم)</span><span class="dash-s-green">${fmt(customersDebt)}</span></div>
                    <div class="dash-summary-row"><span>🏭 مستحقات الموردين (عندنا ليهم)</span><span class="dash-s-red">- ${fmt(suppliersDebt)}</span></div>
                    <div class="dash-summary-divider"></div>
                    <div class="dash-summary-row dash-summary-total">
                        <span>${netWorth >= 0 ? '✅ صافي المركز المالي' : '📉 صافي المركز المالي'}</span>
                        <span style="color:${netWorth >= 0 ? '#059669' : '#DC2626'}">${fmt(Math.abs(netWorth))}</span>
                    </div>
                    <div style="font-size:11px;color:#94A3B8;margin-top:4px;line-height:1.6">
                        ⚠️ هذا رقم لحظي (مخزون + خزنة + مديونيات - مستحقات) وليس "ربح أو خسارة" بالمعنى المحاسبي — لحساب الربح الفعلي يلزم مقارنة فترتين، راجع "ملخص ${monthName}" بجانبه.
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
                        const color = pct > 90 ? '#DC2626' : pct > 70 ? '#D97706' : '#059669';
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

                <!-- ملخص الشهر -->
                <div class="dash-card" style="flex:1">
                    <div class="dash-card-header"><span>📊 ملخص ${monthName}</span></div>
                    <div class="dash-summary-row"><span>صافي المبيعات</span><span class="dash-s-green">${fmt(netMonthSales)}</span></div>
                    <div class="dash-summary-row"><span>(-) تكلفة البضاعة المباعة</span><span class="dash-s-red">${fmt(monthCOGS)}</span></div>
                    <div class="dash-summary-row"><span>(-) إجمالي المصروفات</span><span class="dash-s-red">${fmt(monthExpenses)}</span></div>
                    <div class="dash-summary-divider"></div>
                    <div class="dash-summary-row dash-summary-total">
                        <span>${monthProfit >= 0 ? '✅ صافي الربح' : '📉 صافي الخسارة'}</span>
                        <span style="color:${monthProfit >= 0 ? '#059669' : '#DC2626'}">${fmt(Math.abs(monthProfit))}</span>
                    </div>
                    <div class="dash-summary-row" style="font-size:11px;color:#94A3B8;margin-top:4px">
                        <span>هامش الربح</span>
                        <span>${netMonthSales > 0 ? Math.round(monthProfit / netMonthSales * 100) : 0}%</span>
                    </div>
                </div>
            </div>
        </div>`;

    } catch (err) {
        container.innerHTML = `<div class="dash-error">
            <div style="font-size:32px">⚠️</div>
            <div>خطأ في تحميل البيانات</div>
            <div style="font-size:12px;margin-top:8px;color:#94A3B8">${err.message}</div>
            <button class="dash-refresh" onclick="renderDashboard(document.getElementById('app-content'))" style="margin-top:12px">إعادة المحاولة</button>
        </div>`;
    }
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
    if (dashDailyTarget <= 0) return '#059669';
    const pct = v / dashDailyTarget * 100;
    return pct >= 100 ? '#059669' : pct >= 60 ? '#F59E0B' : '#EF4444';
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
        <line x1="${padL}" y1="${yAt(dashDailyTarget).toFixed(1)}" x2="${W - padR}" y2="${yAt(dashDailyTarget).toFixed(1)}" stroke="#334155" stroke-width="1.2" stroke-dasharray="4,3"/>
        <text x="${W - padR}" y="${(yAt(dashDailyTarget) - 4).toFixed(1)}" font-size="9.5" fill="#334155" text-anchor="end" font-weight="700">🎯 الهدف: ${dashFmtTrend(dashDailyTarget)}</text>` : '';

    const labelEvery = days <= 7 ? 1 : 5;
    const xLabels = data.map((d, i) => {
        if (i % labelEvery !== 0 && i !== n - 1) return '';
        const dt = new Date(d.date + 'T00:00:00');
        const txt = dt.toLocaleDateString('ar-EG', { day: 'numeric', month: 'numeric' });
        return `<text x="${xAt(i).toFixed(1)}" y="${H - 6}" font-size="9" fill="#94A3B8" text-anchor="middle">${txt}</text>`;
    }).filter(Boolean).join('');

    dashTrendLayout = { data, xAt, n, W, barW, padT, plotH };

    return `
    <div style="position:relative">
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:150px;display:block" preserveAspectRatio="none">
        <line x1="${padL}" y1="${baseline.toFixed(1)}" x2="${W - padR}" y2="${baseline.toFixed(1)}" stroke="#F1F5F9" stroke-width="1"/>
        <rect id="dashTrendHoverCol" x="0" y="${padT}" width="${barW.toFixed(1)}" height="${plotH.toFixed(1)}" fill="#0F172A" opacity="0"/>
        ${bars}
        ${targetLine}
        ${xLabels}
        <rect x="${padL}" y="0" width="${plotW}" height="${H}" fill="transparent" onmousemove="dashTrendHover(event)" onmouseleave="dashTrendHoverOut()" style="cursor:crosshair"/>
      </svg>
      <div id="dashTrendTooltip" style="position:absolute;top:6px;background:#0F172A;color:#fff;padding:4px 9px;border-radius:6px;font-size:11px;pointer-events:none;display:none;white-space:nowrap;line-height:1.5"></div>
    </div>
    ${!values.some(v => v > 0) ? '<p class="dash-empty" style="margin-top:8px">لا توجد مبيعات في هذه الفترة</p>' : ''}
    ${dashDailyTarget > 0 ? `<div style="display:flex;gap:14px;margin-top:6px;font-size:11px;color:#64748B">
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
