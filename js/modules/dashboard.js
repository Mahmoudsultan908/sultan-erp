// ════════════════════════════════════════════════════════════
// dashboard.js — لوحة التحكم الرئيسية
// يصدّر: renderDashboard(container)
// ════════════════════════════════════════════════════════════

async function renderDashboard(container) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:#64748B">
        <div style="font-size:32px;margin-bottom:8px">⏳</div>جاري تحميل البيانات...
    </div>`;

    try {
        const today = new Date().toISOString().slice(0, 10);
        const monthStart = today.slice(0, 7) + '-01';

        const [
            { data: cashData },
            { data: salesToday },
            { data: salesMonth },
            { data: purchasesMonth },
            { data: expensesMonth },
            { data: lowStock },
            { data: topProducts },
            { data: latestSales },
            { data: overdueCustomers },
            { data: allStock },
            { data: allCustomers },
            { data: allSuppliers },
        ] = await Promise.all([
            sb.rpc('get_cash_balance'),
            sb.from('sales').select('total').eq('status','confirmed').gte('created_at', today),
            sb.from('sales').select('total,subtotal').eq('status','confirmed').gte('created_at', monthStart),
            sb.from('purchases').select('total').eq('status','confirmed').gte('created_at', monthStart),
            sb.from('expenses').select('amount').eq('status','confirmed').gte('expense_date', monthStart),
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
        ]);

        const cash = Number(cashData) || 0;
        const todaySales = (salesToday || []).reduce((s, r) => s + Number(r.total), 0);
        const monthSales = (salesMonth || []).reduce((s, r) => s + Number(r.total), 0);
        const monthPurchases = (purchasesMonth || []).reduce((s, r) => s + Number(r.total), 0);
        const monthExpenses = (expensesMonth || []).reduce((s, r) => s + Number(r.amount), 0);
        const monthProfit = monthSales - monthPurchases - monthExpenses;

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
                    <div class="dash-summary-row"><span>إجمالي المبيعات</span><span class="dash-s-green">${fmt(monthSales)}</span></div>
                    <div class="dash-summary-row"><span>إجمالي المشتريات</span><span class="dash-s-red">${fmt(monthPurchases)}</span></div>
                    <div class="dash-summary-row"><span>إجمالي المصروفات</span><span class="dash-s-red">${fmt(monthExpenses)}</span></div>
                    <div class="dash-summary-divider"></div>
                    <div class="dash-summary-row dash-summary-total">
                        <span>${monthProfit >= 0 ? '✅ صافي الربح' : '📉 صافي الخسارة'}</span>
                        <span style="color:${monthProfit >= 0 ? '#059669' : '#DC2626'}">${fmt(Math.abs(monthProfit))}</span>
                    </div>
                    <div class="dash-summary-row" style="font-size:11px;color:#94A3B8;margin-top:4px">
                        <span>هامش الربح</span>
                        <span>${monthSales > 0 ? Math.round(monthProfit / monthSales * 100) : 0}%</span>
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
