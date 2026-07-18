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
        c.innerHTML = `<div style="text-align:center;padding:40px;color:#64748B">⏳ جاري التحميل...</div>`;

        if (id === 'pl') return renderPL(c);
        if (id === 'customers') return renderCustomerStatement(c);
        if (id === 'suppliers') return renderSupplierStatement(c);
        if (id === 'vat') return renderVAT(c);
        if (id === 'deferred') return renderDeferred(c);
    }

    // ─────────────────────────────────────────
    // 1) قائمة الدخل P&L
    // ─────────────────────────────────────────
    async function renderPL(c) {
        const today = new Date();
        const monthStartStr = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0,10);
        const fromDefault = monthStartStr < SULTAN_LIVE_CUTOVER ? SULTAN_LIVE_CUTOVER : monthStartStr;
        const toDefault = today.toISOString().slice(0,10);

        const load = async (from, to) => {
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

            c.innerHTML = `
            <div class="dash-card" style="padding:20px;margin-bottom:16px">
                <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
                    <div><label class="ob-label">من تاريخ</label><input type="date" id="pl-from" class="ob-input" style="margin:0" value="${from}"></div>
                    <div><label class="ob-label">إلى تاريخ</label><input type="date" id="pl-to" class="ob-input" style="margin:0" value="${to}"></div>
                    <button class="ob-save-btn" style="margin:0" onclick="renderReports(document.getElementById('app-content'))">إلغاء</button>
                    <button class="ob-add-btn" onclick="window._plReload()">🔍 تطبيق</button>
                </div>
            </div>
            ${from < SULTAN_LIVE_CUTOVER ? `
            <div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:12px 16px;border-radius:10px;margin-bottom:16px;font-size:12px">
                ⚠️ الفترة دي بتشمل بيانات منقولة من ديكسف (قبل ${SULTAN_LIVE_CUTOVER}) فيها تسويات ترحيل لمرة واحدة (رأس مال، تصحيحات أرصدة) مش جزء من الأداء التشغيلي العادي — عشان كده الرقم هنا مش متوقع يطابق "صافي المركز المالي" في الداشبورد. للأداء الفعلي المستمر استخدم فترة تبدأ من ${SULTAN_LIVE_CUTOVER}.
            </div>` : ''}
            <div class="dash-card" style="padding:24px;max-width:550px">
                <h3 style="margin:0 0 16px;font-size:15px">قائمة الدخل (${from} إلى ${to})</h3>
                <div class="dash-summary-row"><span>صافي المبيعات</span><span class="dash-s-green">${fmt(netSales)}</span></div>
                <div class="dash-summary-row" style="font-size:11px;color:#94A3B8"><span>(إجمالي ${fmt(totalSales)} - مرتجعات ${fmt(totalReturns)})</span><span></span></div>
                <div class="dash-summary-row"><span>(-) تكلفة البضاعة المباعة</span><span class="dash-s-red">${fmt(totalCOGS)}</span></div>
                <div class="dash-summary-row" style="font-size:11px;color:#94A3B8"><span>(تكلفة مبيعات ${fmt(cogsSales)} - تكلفة مرتجعات ${fmt(cogsReturns)})</span><span></span></div>
                <div class="dash-summary-row"><span>(-) إجمالي المصروفات</span><span class="dash-s-red">${fmt(totalExpenses)}</span></div>
                <div class="dash-summary-divider"></div>
                <div class="dash-summary-row dash-summary-total">
                    <span>${netProfit>=0?'✅ صافي الربح':'📉 صافي الخسارة'}</span>
                    <span style="color:${netProfit>=0?'#059669':'#DC2626'}">${fmt(Math.abs(netProfit))}</span>
                </div>
                <div class="dash-summary-row" style="font-size:11px;color:#94A3B8"><span>هامش الربح</span><span>${margin.toFixed(1)}%</span></div>
            </div>`;

            window._plReload = () => {
                const f = document.getElementById('pl-from').value;
                const t = document.getElementById('pl-to').value;
                load(f, t);
            };
        };
        load(fromDefault, toDefault);
    }

    // ─────────────────────────────────────────
    // 2) كشف حساب عميل
    // ─────────────────────────────────────────
    async function renderCustomerStatement(c) {
        const { data: customers } = await sb.from('customers').select('id,name,balance').order('name');
        c.innerHTML = `
        <div class="dash-card" style="padding:20px;margin-bottom:16px">
            <label class="ob-label">اختر عميلاً</label>
            <select id="cs-cust-select" class="ob-input" style="margin:0;max-width:300px">
                <option value="">-- اختر --</option>
                ${(customers||[]).map(cu=>`<option value="${cu.id}">${cu.name} (${fmt(cu.balance)} ج.م)</option>`).join('')}
            </select>
        </div>
        <div id="cs-result"></div>`;

        document.getElementById('cs-cust-select').onchange = async (e) => {
            const id = e.target.value;
            const resultEl = document.getElementById('cs-result');
            if (!id) { resultEl.innerHTML = ''; return; }
            resultEl.innerHTML = '<div style="text-align:center;padding:30px;color:#64748B">⏳ جاري التحميل...</div>';

            const [{ data: sales }, { data: returns }, { data: collections }, { data: opening }] = await Promise.all([
                sb.from('sales').select('invoice_no,total,created_at').eq('customer_id',id).eq('status','confirmed').eq('payment_type','credit').order('created_at'),
                sb.from('sales_returns').select('return_no,total,created_at').eq('customer_id',id).eq('status','confirmed').eq('payment_type','credit').order('created_at'),
                sb.from('customer_collections').select('ref,amount,created_at').eq('customer_id',id).eq('status','confirmed').order('created_at'),
                sb.from('opening_balances').select('amount,as_of_date').eq('customer_id',id).eq('balance_type','customer').eq('status','confirmed'),
            ]);

            let rows = [];
            (opening||[]).forEach(o => rows.push({ date:o.as_of_date, ref:'رصيد افتتاحي', debit:Number(o.amount), credit:0 }));
            (sales||[]).forEach(s => rows.push({ date:s.created_at, ref:s.invoice_no, debit:Number(s.total), credit:0 }));
            (returns||[]).forEach(r => rows.push({ date:r.created_at, ref:'مرتجع '+r.return_no, debit:0, credit:Number(r.total) }));
            (collections||[]).forEach(co => rows.push({ date:co.created_at, ref:'تحصيل '+co.ref, debit:0, credit:Number(co.amount) }));
            rows.sort((a,b)=>new Date(a.date)-new Date(b.date));

            let running = 0;
            rows = rows.map(r => { running += r.debit - r.credit; return {...r, balance: running}; });

            resultEl.innerHTML = `
            <div class="dash-card" style="padding:0;overflow:hidden">
                <table class="dash-table" style="margin:0">
                    <thead><tr><th>التاريخ</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
                    <tbody>
                        ${rows.length ? rows.map(r => `<tr>
                            <td class="dash-muted">${new Date(r.date).toLocaleDateString('ar-EG')}</td>
                            <td>${r.ref}</td>
                            <td class="dash-s-green">${r.debit ? fmt(r.debit) : '—'}</td>
                            <td class="dash-s-red">${r.credit ? fmt(r.credit) : '—'}</td>
                            <td class="dash-amount">${fmt(r.balance)}</td>
                        </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;padding:20px;color:#94A3B8">لا توجد حركات</td></tr>'}
                    </tbody>
                    <tfoot><tr style="background:#F8FAFC;font-weight:700">
                        <td colspan="4" style="padding:12px">الرصيد النهائي</td>
                        <td class="dash-amount" style="font-size:15px">${fmt(running)}</td>
                    </tr></tfoot>
                </table>
            </div>`;
        };
    }

    // ─────────────────────────────────────────
    // 3) كشف حساب مورد
    // ─────────────────────────────────────────
    async function renderSupplierStatement(c) {
        const { data: suppliers } = await sb.from('suppliers').select('id,name,balance').order('name');
        c.innerHTML = `
        <div class="dash-card" style="padding:20px;margin-bottom:16px">
            <label class="ob-label">اختر مورداً</label>
            <select id="ss-sup-select" class="ob-input" style="margin:0;max-width:300px">
                <option value="">-- اختر --</option>
                ${(suppliers||[]).map(s=>`<option value="${s.id}">${s.name} (${fmt(s.balance)} ج.م)</option>`).join('')}
            </select>
        </div>
        <div id="ss-result"></div>`;

        document.getElementById('ss-sup-select').onchange = async (e) => {
            const id = e.target.value;
            const resultEl = document.getElementById('ss-result');
            if (!id) { resultEl.innerHTML = ''; return; }
            resultEl.innerHTML = '<div style="text-align:center;padding:30px;color:#64748B">⏳ جاري التحميل...</div>';

            const [{ data: purchases }, { data: returns }, { data: payments }, { data: opening }] = await Promise.all([
                sb.from('purchases').select('invoice_no,total,created_at').eq('supplier_id',id).eq('status','confirmed').eq('payment_type','credit').order('created_at'),
                sb.from('purchase_returns').select('return_no,total,created_at').eq('supplier_id',id).eq('status','confirmed').order('created_at'),
                sb.from('supplier_payments').select('ref,amount,created_at').eq('supplier_id',id).eq('status','confirmed').order('created_at'),
                sb.from('opening_balances').select('amount,as_of_date').eq('supplier_id',id).eq('balance_type','supplier').eq('status','confirmed'),
            ]);

            let rows = [];
            (opening||[]).forEach(o => rows.push({ date:o.as_of_date, ref:'رصيد افتتاحي', credit:Number(o.amount), debit:0 }));
            (purchases||[]).forEach(p => rows.push({ date:p.created_at, ref:p.invoice_no, credit:Number(p.total), debit:0 }));
            (returns||[]).forEach(r => rows.push({ date:r.created_at, ref:'مرتجع '+r.return_no, credit:0, debit:Number(r.total) }));
            (payments||[]).forEach(pay => rows.push({ date:pay.created_at, ref:'دفعة '+pay.ref, credit:0, debit:Number(pay.amount) }));
            rows.sort((a,b)=>new Date(a.date)-new Date(b.date));

            let running = 0;
            rows = rows.map(r => { running += r.credit - r.debit; return {...r, balance: running}; });

            resultEl.innerHTML = `
            <div class="dash-card" style="padding:0;overflow:hidden">
                <table class="dash-table" style="margin:0">
                    <thead><tr><th>التاريخ</th><th>البيان</th><th>مدين (دفعنا)</th><th>دائن (علينا)</th><th>الرصيد</th></tr></thead>
                    <tbody>
                        ${rows.length ? rows.map(r => `<tr>
                            <td class="dash-muted">${new Date(r.date).toLocaleDateString('ar-EG')}</td>
                            <td>${r.ref}</td>
                            <td class="dash-s-green">${r.debit ? fmt(r.debit) : '—'}</td>
                            <td class="dash-s-red">${r.credit ? fmt(r.credit) : '—'}</td>
                            <td class="dash-amount">${fmt(r.balance)}</td>
                        </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;padding:20px;color:#94A3B8">لا توجد حركات</td></tr>'}
                    </tbody>
                    <tfoot><tr style="background:#F8FAFC;font-weight:700">
                        <td colspan="4" style="padding:12px">الرصيد النهائي (مديونيتنا)</td>
                        <td class="dash-amount" style="font-size:15px">${fmt(running)}</td>
                    </tr></tfoot>
                </table>
            </div>`;
        };
    }

    // ─────────────────────────────────────────
    // 4) تقرير VAT
    // ─────────────────────────────────────────
    async function renderVAT(c) {
        const today = new Date();
        const from = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0,10);
        const to = today.toISOString().slice(0,10);

        const [{ data: sales }, { data: purchases }] = await Promise.all([
            sb.from('sales').select('vat_amount,total,invoice_no,created_at').eq('status','confirmed').gte('created_at', from),
            sb.from('purchases').select('vat_amount,total,invoice_no,created_at').eq('status','confirmed').gte('created_at', from),
        ]);

        const outputVat = (sales||[]).reduce((s,r)=>s+Number(r.vat_amount||0),0);
        const inputVat = (purchases||[]).reduce((s,r)=>s+Number(r.vat_amount||0),0);
        const netVat = outputVat - inputVat;

        c.innerHTML = `
        <div class="dash-card" style="padding:24px;max-width:550px">
            <h3 style="margin:0 0 16px;font-size:15px">تقرير ضريبة القيمة المضافة (الشهر الحالي)</h3>
            <div class="dash-summary-row"><span>ضريبة المبيعات (مُحصّلة)</span><span class="dash-s-green">${fmt(outputVat)}</span></div>
            <div class="dash-summary-row"><span>ضريبة المشتريات (مدفوعة)</span><span class="dash-s-red">${fmt(inputVat)}</span></div>
            <div class="dash-summary-divider"></div>
            <div class="dash-summary-row dash-summary-total">
                <span>${netVat>=0?'مستحق للمصلحة':'مستحق لنا (خصم)'}</span>
                <span style="color:${netVat>=0?'#DC2626':'#059669'}">${fmt(Math.abs(netVat))}</span>
            </div>
        </div>`;
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
            <div style="font-size:12px;color:#64748B">المتوقع/المستلم/المتبقي من فواتير الشراء المؤجلة الحالية. المؤجلات القديمة (قبل تتبع النظام) تُسجَّل يدوياً وتظهر في الجدول تحت.</div>
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
                        <td class="dash-amount" style="color:${s.total_remaining>0?'#D97706':'#059669'}">${fmt(s.total_remaining)}</td>
                        <td>${s.total_remaining>0 ? `<button class="mod-btn" style="padding:5px 10px;font-size:11px;background:#ECFDF5;color:#059669" onclick="repDefOpenReceive('${(suppliers||[]).find(x=>x.name===s.supplier_name)?.id||''}','${(s.supplier_name||'').replace(/'/g,"\\'")}')">💰 تسجيل استلام</button>` : ''}</td>
                    </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;padding:20px;color:#94A3B8">لا توجد مؤجلات مسجلة</td></tr>'}
                </tbody>
            </table>
        </div>

        <div style="margin-top:18px;font-size:13px;font-weight:800;color:#334155">📜 مؤجلات مسجّلة يدوياً (قديمة قبل تتبع النظام)</div>
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
                        <td class="dash-amount" style="color:${remaining>0?'#D97706':'#059669'}">${fmt(remaining)}</td>
                        <td>${m.due_date || '—'}</td>
                        <td style="font-size:11px;color:#64748B">${m.notes || '—'}</td>
                        <td>${remaining>0 ? `<button class="mod-btn" style="padding:5px 10px;font-size:11px;background:#ECFDF5;color:#059669" onclick="repDefReceiveManual('${m.id}',${remaining})">💰 استلام</button>` : '<span style="color:#059669;font-size:11px">✅ مكتمل</span>'}</td>
                    </tr>`;
                    }).join('') : '<tr><td colspan="7" style="text-align:center;padding:20px;color:#94A3B8">لا توجد مؤجلات يدوية مسجلة</td></tr>'}
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
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="repDefCloseModal('repDefAddModal')">إلغاء</button>
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
                <div style="text-align:center;padding:20px;color:#64748B">⏳ جاري التحميل...</div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="repDefCloseModal('repDefReceiveModal')">إغلاق</button>
                <button class="mod-btn mod-btn-primary" onclick="repDefConfirmReceiveReal('${supplierId}')">✅ تأكيد استلام المحدد</button>
            </div>
        </div>`;
        document.body.appendChild(modal);

        const body = document.getElementById('repDefReceiveBody');
        if (!supplierId) {
            body.innerHTML = `<div style="color:#94A3B8;font-size:12px">تعذّر تحديد المورد تلقائياً — استخدم جدول "مؤجلات مسجّلة يدوياً" بالأسفل لو المؤجل ده يدوي، أو راجع المطوّر.</div>`;
            return;
        }
        try {
            const { data: pending, error } = await sb.rpc('fn_list_pending_deferred_rebates', { p_supplier_id: supplierId });
            if (error) throw error;
            if (!pending || !pending.length) {
                body.innerHTML = `<div style="color:#94A3B8;font-size:12px">لا توجد بنود مؤجلة معلّقة من فواتير شراء لهذا المورد.</div>`;
                return;
            }
            body.innerHTML = `
            <div style="font-size:11px;color:#64748B;margin-bottom:8px">حدد البنود اللي المورد استلمها فعلاً (خصم/استرداد) ثم اضغط "تأكيد استلام المحدد".</div>
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
            body.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:12px;border-radius:8px;font-size:12px">خطأ: ${err.message}</div>`;
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
