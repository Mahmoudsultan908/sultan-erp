// ════════════════════════════════════════════════════════════
// dashboard.js — لوحة التحكم الرئيسية
// يصدّر: renderDashboard(container)
// ════════════════════════════════════════════════════════════

// ★ حالة رسم اتجاه المبيعات — بتتحدث كل تحميل داشبورد، وبيستخدمها زرار
//   تبديل 7/30 يوم (dashSetTrendRange) عشان يعيد الرسم من غير أي استعلام
//   جديد لقاعدة البيانات (البيانات الأساسية آخر 30 يوم مجلوبة مرة واحدة بس)
let dashTrendDaily = [];

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
            { data: allCustomers },
            { data: allSuppliers },
            { data: trendSales },
            { data: lastBackupRow },
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
            // نفس منطق حساب مديونية العملاء المستخدم في js/modules/customers.js (مجموع الأرصدة الموجبة فقط)
            sb.from('customers').select('balance'),
            // نفس منطق حساب مستحقات الموردين المستخدم في js/modules/suppliers.js (مجموع الأرصدة الموجبة فقط)
            sb.from('suppliers').select('balance'),
            // اتجاه المبيعات — آخر 30 يوم، بيتجمّع باليوم في الـ JS تحت
            sb.from('sales').select('total,created_at').eq('status','confirmed').gte('created_at', trendStart),
            sb.from('app_settings').select('value').eq('key','last_backup_at').maybeSingle(),
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

        // ── تنبيه النسخة الاحتياطية: لو معملناش نسخة خالص أو عدى عليها 7 أيام ──
        let lastBackupIso = null;
        try { lastBackupIso = lastBackupRow?.value ? JSON.parse(lastBackupRow.value) : null; } catch { lastBackupIso = lastBackupRow?.value || null; }
        const daysSinceBackup = lastBackupIso ? Math.floor((Date.now() - new Date(lastBackupIso).getTime()) / 86400000) : null;
        const backupBanner = (daysSinceBackup === null || daysSinceBackup >= 7) ? `
            <div class="mod-alert-banner warning">
                <span>⚠️</span>
                <span>${daysSinceBackup === null ? 'لسه معملتش أي نسخة احتياطية من بيانات النظام.' : `عدّى ${daysSinceBackup} يوم من غير نسخة احتياطية جديدة.`}</span>
                <span class="dash-see-all" style="margin-right:auto" onclick="loadMod(document.querySelector('[data-mod=settings]'),'settings')">اعمل نسخة الآن ←</span>
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
        // قيمة المخزون + رصيد الخزنة + مديونية العملاء - مستحقات الموردين
        const stockValue = (allStock || []).reduce((s, r) => s + (Number(r.qty) || 0) * Number(r.products?.purchase_price || 0), 0);
        const customersDebt = (allCustomers || []).reduce((s, c) => s + (Number(c.balance) > 0 ? Number(c.balance) : 0), 0);
        const suppliersDebt = (allSuppliers || []).reduce((s, sp) => s + (Number(sp.balance) > 0 ? Number(sp.balance) : 0), 0);
        const netWorth = stockValue + cash + customersDebt - suppliersDebt;

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

            <!-- اتجاه المبيعات -->
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
            </div>

            <!-- تقرير الجرد اليومي: صافي المركز المالي (قيمة مخزون + خزنة + مديونية عملاء - مستحقات موردين) -->
            <div class="dash-row">
                <div class="dash-card" style="flex:1">
                    <div class="dash-card-header"><span>📋 تقرير الجرد اليومي — صافي المركز المالي</span></div>
                    <div class="dash-summary-row"><span>📦 قيمة البضاعة (المخزون)</span><span class="dash-s-green">${fmt(stockValue)}</span></div>
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

function dashRenderTrendSVG(days) {
    const data = dashTrendDaily.slice(-days);
    const n = data.length;
    const values = data.map(d => d.total);
    const max = Math.max(...values, 1) * 1.15;
    const W = 700, H = 170, padL = 6, padR = 6, padT = 10, padB = 22;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const stepX = n > 1 ? plotW / (n - 1) : 0;
    const xAt = i => padL + i * stepX;
    const yAt = v => padT + plotH - (v / max) * plotH;
    const baseline = padT + plotH;

    const linePath = 'M ' + data.map((d, i) => `${xAt(i).toFixed(1)},${yAt(d.total).toFixed(1)}`).join(' L ');
    const areaPath = `${linePath} L ${xAt(n - 1).toFixed(1)},${baseline.toFixed(1)} L ${xAt(0).toFixed(1)},${baseline.toFixed(1)} Z`;

    const labelEvery = days <= 7 ? 1 : 5;
    const xLabels = data.map((d, i) => {
        if (i % labelEvery !== 0 && i !== n - 1) return '';
        const dt = new Date(d.date + 'T00:00:00');
        const txt = dt.toLocaleDateString('ar-EG', { day: 'numeric', month: 'numeric' });
        return `<text x="${xAt(i).toFixed(1)}" y="${H - 6}" font-size="9" fill="#94A3B8" text-anchor="middle">${txt}</text>`;
    }).filter(Boolean).join('');

    dashTrendLayout = { data, xAt, yAt, baseline, n, W };

    return `
    <div style="position:relative">
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:150px;display:block" preserveAspectRatio="none">
        <line x1="${padL}" y1="${baseline.toFixed(1)}" x2="${W - padR}" y2="${baseline.toFixed(1)}" stroke="#F1F5F9" stroke-width="1"/>
        <defs><linearGradient id="dashTrendGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#059669" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="#059669" stop-opacity="0"/>
        </linearGradient></defs>
        <path d="${areaPath}" fill="url(#dashTrendGrad)" stroke="none"/>
        <path d="${linePath}" fill="none" stroke="#059669" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <line id="dashTrendCrosshair" x1="0" y1="${padT}" x2="0" y2="${baseline.toFixed(1)}" stroke="#CBD5E1" stroke-width="1" stroke-dasharray="3,3" style="opacity:0"/>
        <circle id="dashTrendDot" cx="0" cy="0" r="4" fill="#059669" stroke="#fff" stroke-width="2" style="opacity:0"/>
        ${xLabels}
        <rect x="${padL}" y="0" width="${plotW}" height="${H}" fill="transparent" onmousemove="dashTrendHover(event)" onmouseleave="dashTrendHoverOut()" style="cursor:crosshair"/>
      </svg>
      <div id="dashTrendTooltip" style="position:absolute;top:6px;background:#0F172A;color:#fff;padding:4px 9px;border-radius:6px;font-size:11px;pointer-events:none;display:none;white-space:nowrap;line-height:1.5"></div>
    </div>
    ${!values.some(v => v > 0) ? '<p class="dash-empty" style="margin-top:8px">لا توجد مبيعات في هذه الفترة</p>' : ''}`;
}

function dashTrendHover(evt) {
    if (!dashTrendLayout) return;
    const svg = evt.currentTarget.ownerSVGElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const { data, xAt, yAt, n, W } = dashTrendLayout;
    const mx = (evt.clientX - rect.left) * (W / rect.width);
    let idx = 0, best = Infinity;
    for (let i = 0; i < n; i++) {
        const dx = Math.abs(xAt(i) - mx);
        if (dx < best) { best = dx; idx = i; }
    }
    const px = xAt(idx), py = yAt(data[idx].total);
    const dot = document.getElementById('dashTrendDot');
    const cross = document.getElementById('dashTrendCrosshair');
    if (dot) { dot.setAttribute('cx', px.toFixed(1)); dot.setAttribute('cy', py.toFixed(1)); dot.style.opacity = 1; }
    if (cross) { cross.setAttribute('x1', px.toFixed(1)); cross.setAttribute('x2', px.toFixed(1)); cross.style.opacity = 1; }
    const tip = document.getElementById('dashTrendTooltip');
    if (tip) {
        const dt = new Date(data[idx].date + 'T00:00:00');
        tip.innerHTML = `<b>${dashFmtTrend(data[idx].total)} ج.م</b> — ${dt.toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'short' })}`;
        tip.style.display = 'block';
        const leftPct = (px / W) * 100;
        tip.style.left = leftPct < 50 ? `calc(${leftPct}% + 8px)` : 'auto';
        tip.style.right = leftPct >= 50 ? `calc(${100 - leftPct}% + 8px)` : 'auto';
    }
}

function dashTrendHoverOut() {
    const dot = document.getElementById('dashTrendDot');
    const cross = document.getElementById('dashTrendCrosshair');
    const tip = document.getElementById('dashTrendTooltip');
    if (dot) dot.style.opacity = 0;
    if (cross) cross.style.opacity = 0;
    if (tip) tip.style.display = 'none';
}

function dashSetTrendRange(days) {
    const wrap = document.getElementById('dashTrendChartWrap');
    if (wrap) wrap.innerHTML = dashRenderTrendSVG(days);
    document.getElementById('dashTrendBtn7')?.classList.toggle('active', days === 7);
    document.getElementById('dashTrendBtn30')?.classList.toggle('active', days === 30);
}
