// ════════════════════════════════════════════════════════════
// reports.js — التقارير المالية
// يصدّر: renderReports(container)
// ════════════════════════════════════════════════════════════

async function renderReports(container) {
    let activeReport = 'pl';
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
        const fromDefault = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0,10);
        const toDefault = today.toISOString().slice(0,10);

        const load = async (from, to) => {
            const [{ data: sales }, { data: purchases }, { data: expenses }, { data: salesReturns }] = await Promise.all([
                sb.from('sales').select('total,subtotal').eq('status','confirmed').gte('created_at', from).lte('created_at', to + 'T23:59:59'),
                sb.from('purchases').select('total').eq('status','confirmed').gte('created_at', from).lte('created_at', to + 'T23:59:59'),
                sb.from('expenses').select('amount').eq('status','confirmed').gte('expense_date', from).lte('expense_date', to),
                sb.from('sales_returns').select('total').eq('status','confirmed').gte('created_at', from).lte('created_at', to + 'T23:59:59'),
            ]);
            const totalSales = (sales||[]).reduce((s,r)=>s+Number(r.total),0);
            const totalReturns = (salesReturns||[]).reduce((s,r)=>s+Number(r.total),0);
            const netSales = totalSales - totalReturns;
            const totalPurchases = (purchases||[]).reduce((s,r)=>s+Number(r.total),0);
            const totalExpenses = (expenses||[]).reduce((s,r)=>s+Number(r.amount),0);
            const netProfit = netSales - totalPurchases - totalExpenses;
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
            <div class="dash-card" style="padding:24px;max-width:550px">
                <h3 style="margin:0 0 16px;font-size:15px">قائمة الدخل (${from} إلى ${to})</h3>
                <div class="dash-summary-row"><span>صافي المبيعات</span><span class="dash-s-green">${fmt(netSales)}</span></div>
                <div class="dash-summary-row" style="font-size:11px;color:#94A3B8"><span>(إجمالي ${fmt(totalSales)} - مرتجعات ${fmt(totalReturns)})</span><span></span></div>
                <div class="dash-summary-row"><span>(-) إجمالي المشتريات</span><span class="dash-s-red">${fmt(totalPurchases)}</span></div>
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
        const { data: summary } = await sb.from('deferred_rebates_supplier_summary').select('*').order('total_remaining', { ascending: false });

        c.innerHTML = `
        <div class="dash-card" style="padding:0;overflow:hidden">
            <table class="dash-table" style="margin:0">
                <thead><tr><th>المورد</th><th>عدد البنود</th><th>المتوقع</th><th>المستلم</th><th>المتبقي</th></tr></thead>
                <tbody>
                    ${(summary||[]).filter(s=>s.items_count>0).map(s => `<tr>
                        <td><strong>${s.supplier_name}</strong></td>
                        <td>${s.items_count}</td>
                        <td>${fmt(s.total_expected)}</td>
                        <td class="dash-s-green">${fmt(s.total_received)}</td>
                        <td class="dash-amount" style="color:${s.total_remaining>0?'#D97706':'#059669'}">${fmt(s.total_remaining)}</td>
                    </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;padding:20px;color:#94A3B8">لا توجد مؤجلات مسجلة</td></tr>'}
                </tbody>
            </table>
        </div>`;
    }

    renderReportContent(activeReport);
}
