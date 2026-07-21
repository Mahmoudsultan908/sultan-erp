/* ════════════════════════════════════════════════════════════
   المستثمرين — investors.js
   تقفيل أرباح المضاربة الشهرية بين صاحب المحل والمستثمر (بند 10،
   تقرير 2026-07-21). أرقام المبيعات/التكلفة/المصروفات بتتسحب تلقائيًا
   من نفس منهجية reports.js P&L (نفس netSales/COGS بالظبط، مش حساب
   جديد) — رأس المال ونسبة المجهود مدخلات يدوية شهرية.
   كل شهر بيتقفل مرة واحدة بس (unique في القاعدة) ويتسجل كـ Snapshot
   ثابت — مفيش تعديل بعد التقفيل حتى لو الأرقام العامة اتغيرت لاحقًا.
   صفحة أدمن بس افتراضيًا (راجع role_permissions في migration الجدول).
   يصدّر: renderInvestors(container)
   ════════════════════════════════════════════════════════════ */

let _invsHistory = [];
let _invsPreview = null;

function invsFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function renderInvestors(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل البيانات...</div>';
    try {
        const { data: history } = await sb.from('investor_profit_snapshots').select('*').order('period_month', { ascending: false });
        _invsHistory = history || [];

        const last = _invsHistory[0];
        const now = new Date();
        const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        c.innerHTML = `
            <div style="margin-bottom:20px"><h2 style="font-size:22px;font-weight:800">🤝 المستثمرين — تقفيل الأرباح الشهرية</h2>
            <p style="font-size:13px;color:#64748B;margin-top:4px">توزيع صافي ربح الشهر بين صاحب المحل والمستثمر حسب نسبة رأس المال والمجهود</p></div>

            <div class="mod-alert-banner info">
                <span>ℹ️</span>
                <span>الأرقام دي معاينة بس لحد ما تدوسي "تقفيل الشهر" — بعد التقفيل النتيجة بتتحفظ ثابتة ومش بترجع تتغير حتى لو أرقام المبيعات/المصروفات العامة اتغيرت بعد كده.</span>
            </div>

            <div class="mod-card" style="margin-top:16px;max-width:720px">
                <div class="mod-form-group"><label>الشهر</label>
                    <input type="month" id="invsMonth" class="mod-form-input" value="${defaultMonth}">
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>رأس مال المستثمر (ج.م)</label>
                        <input type="number" id="invsInvestorCapital" class="mod-form-input" value="${last?.investor_capital ?? 0}" min="0" step="0.01">
                    </div>
                    <div class="mod-form-group"><label>رأس مال صاحب المحل (ج.م)</label>
                        <input type="number" id="invsOwnerCapital" class="mod-form-input" value="${last?.owner_capital ?? 0}" min="0" step="0.01">
                    </div>
                </div>
                <div class="mod-form-group"><label>نسبة نصيب المجهود والإدارة (لصاحب المحل بالكامل)</label>
                    <input type="number" id="invsEffortRatio" class="mod-form-input" value="${((last?.effort_ratio ?? 0.5) * 100).toFixed(0)}" min="0" max="100" step="1">
                    <small style="color:#94A3B8">% — الباقي بعد المجهود بيتقسم حسب نسبة رأس المال</small>
                </div>
                <button class="mod-btn mod-btn-primary" style="width:100%" onclick="invsCalcPreview()">🔍 حساب المعاينة</button>
            </div>

            <div id="invsPreviewArea" style="margin-top:16px"></div>

            <div style="margin-top:24px">
                <h3 style="font-size:16px;font-weight:800;margin-bottom:12px">📜 الشهور المقفولة</h3>
                <div class="mod-table-wrap">
                    <table class="mod-table"><thead><tr>
                        <th>الشهر</th><th style="text-align:left">صافي الربح</th><th style="text-align:left">نصيب المستثمر</th><th style="text-align:left">نصيب صاحب المحل</th><th>تاريخ التقفيل</th>
                    </tr></thead>
                    <tbody>
                        ${_invsHistory.length ? _invsHistory.map(h => `<tr>
                            <td><strong>${new Date(h.period_month).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long' })}</strong>${h.is_loss ? ' <span style="color:#DC2626;font-size:11px;font-weight:700">(خسارة)</span>' : ''}</td>
                            <td style="text-align:left;font-weight:700;color:${h.net_profit >= 0 ? '#059669' : '#DC2626'}">${invsFmt(h.net_profit)}</td>
                            <td style="text-align:left">${invsFmt(h.investor_total)}</td>
                            <td style="text-align:left">${invsFmt(h.owner_total)}</td>
                            <td style="font-size:12px;color:#64748B">${new Date(h.created_at).toLocaleDateString('ar-EG')}</td>
                        </tr>`).join('') : `<tr><td colspan="5" class="empty-state"><span>📜</span>لا يوجد شهور مقفولة بعد</td></tr>`}
                    </tbody></table>
                </div>
            </div>
        `;
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

async function invsFetchMonthNumbers(monthStr) {
    const from = `${monthStr}-01`;
    const toDate = new Date(from);
    toDate.setMonth(toDate.getMonth() + 1);
    const to = toDate.toISOString().slice(0, 10);

    // نفس منهجية reports.js P&L بالحرف — netSales وCOGS الصافي بعد المرتجعات
    const [{ data: sales }, { data: salesReturns }, { data: saleItemsCost }, { data: returnItemsCost }, { data: expenses }, { data: suppliers }] = await Promise.all([
        sb.from('sales').select('total').eq('status', 'confirmed').gte('created_at', from).lt('created_at', to),
        sb.from('sales_returns').select('total').eq('status', 'confirmed').gte('created_at', from).lt('created_at', to),
        plFetchAllRows('sale_items', 'qty, cost_price_snapshot, sales!inner(created_at, status)', (q) =>
            q.eq('sales.status', 'confirmed').gte('sales.created_at', from).lt('sales.created_at', to)),
        plFetchAllRows('sale_return_items', 'qty, cost_price_snapshot, sales_returns!inner(created_at, status)', (q) =>
            q.eq('sales_returns.status', 'confirmed').gte('sales_returns.created_at', from).lt('sales_returns.created_at', to)),
        sb.from('expenses').select('amount').eq('status', 'confirmed').gte('expense_date', from).lt('expense_date', to),
        sb.from('suppliers').select('balance'),
    ]);

    const totalSales = (sales || []).reduce((s, r) => s + Number(r.total), 0);
    const totalReturns = (salesReturns || []).reduce((s, r) => s + Number(r.total), 0);
    const monthly_sales = totalSales - totalReturns;
    const cogsSales = (saleItemsCost || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.cost_price_snapshot) || 0), 0);
    const cogsReturns = (returnItemsCost || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.cost_price_snapshot) || 0), 0);
    const cogs = cogsSales - cogsReturns;
    const operating_expenses = (expenses || []).reduce((s, r) => s + Number(r.amount), 0);
    const payables_credit = (suppliers || []).reduce((s, r) => s + (Number(r.balance) > 0 ? Number(r.balance) : 0), 0);

    return { monthly_sales, cogs, operating_expenses, payables_credit };
}

function invsCompute({ investor_capital, owner_capital, effort_ratio, monthly_sales, cogs, operating_expenses }) {
    const owned_capital_base = investor_capital + owner_capital;
    const investor_ratio = owned_capital_base > 0 ? investor_capital / owned_capital_base : 0;
    const owner_ratio = owned_capital_base > 0 ? 1 - investor_ratio : 0;
    const net_profit = monthly_sales - (cogs + operating_expenses);
    const is_loss = net_profit < 0;

    let effort_amount, capital_amount, investor_share, owner_capital_share;
    if (is_loss) {
        // خسارة: المستثمر يتحمّل نصيبه من رأس المال بس (مش من المجهود، المجهود على صاحب المحل)
        effort_amount = 0;
        capital_amount = net_profit;
        investor_share = capital_amount * investor_ratio;
        owner_capital_share = capital_amount * owner_ratio;
    } else {
        effort_amount = net_profit * effort_ratio;
        capital_amount = net_profit * (1 - effort_ratio);
        investor_share = capital_amount * investor_ratio;
        owner_capital_share = capital_amount * owner_ratio;
    }
    const investor_total = investor_share;
    const owner_total = (is_loss ? 0 : effort_amount) + owner_capital_share;

    return { owned_capital_base, investor_ratio, owner_ratio, net_profit, is_loss, effort_amount, capital_amount, investor_share, owner_capital_share, investor_total, owner_total };
}

window.invsCalcPreview = async function() {
    const monthStr = document.getElementById('invsMonth').value;
    if (!monthStr) return alert('اختاري الشهر أولاً');
    if (_invsHistory.some(h => h.period_month.slice(0, 7) === monthStr)) {
        document.getElementById('invsPreviewArea').innerHTML = `<div class="mod-alert-banner danger"><span>🔒</span><span>الشهر ده مقفول بالفعل — مش ممكن تقفيله تاني. شوف النتيجة في جدول "الشهور المقفولة" تحت.</span></div>`;
        return;
    }
    const investor_capital = parseFloat(document.getElementById('invsInvestorCapital').value) || 0;
    const owner_capital = parseFloat(document.getElementById('invsOwnerCapital').value) || 0;
    const effort_ratio = (parseFloat(document.getElementById('invsEffortRatio').value) || 0) / 100;

    const area = document.getElementById('invsPreviewArea');
    area.innerHTML = '<div style="text-align:center;padding:20px;color:#64748B">⏳ جاري جمع أرقام الشهر...</div>';
    try {
        const monthNums = await invsFetchMonthNumbers(monthStr);
        const result = invsCompute({ investor_capital, owner_capital, effort_ratio, ...monthNums });
        _invsPreview = { period_month: monthStr + '-01', investor_capital, owner_capital, effort_ratio, ...monthNums, ...result };

        area.innerHTML = `
            <div class="mod-card">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
                    <div class="mod-card-icon" style="background:${result.is_loss?'#FEE2E2':'#F0FDF4'};color:${result.is_loss?'#DC2626':'#059669'};width:40px;height:40px;font-size:18px">${result.is_loss?'📉':'📊'}</div>
                    <div style="font-size:15px;font-weight:800">معاينة ${new Date(_invsPreview.period_month).toLocaleDateString('ar-EG',{year:'numeric',month:'long'})}</div>
                </div>
                ${result.is_loss ? `<div class="mod-alert-banner danger" style="margin-bottom:14px"><span>⚠️</span><span>خسارة الشهر — المستثمر هيتحمّل نصيبه من رأس المال بس (مش من المجهود).</span></div>` : ''}
                <div class="mod-grid" style="grid-template-columns:repeat(3,1fr)">
                    <div class="mod-card" style="box-shadow:none;border-color:#F1F5F9"><div class="mod-card-val" style="font-size:16px">${invsFmt(monthNums.monthly_sales)}</div><div class="mod-card-lbl">صافي مبيعات الشهر</div></div>
                    <div class="mod-card" style="box-shadow:none;border-color:#F1F5F9"><div class="mod-card-val" style="font-size:16px">${invsFmt(monthNums.cogs)}</div><div class="mod-card-lbl">تكلفة البضاعة المباعة</div></div>
                    <div class="mod-card" style="box-shadow:none;border-color:#F1F5F9"><div class="mod-card-val" style="font-size:16px">${invsFmt(monthNums.operating_expenses)}</div><div class="mod-card-lbl">مصروفات تشغيلية</div></div>
                </div>
                <div style="font-size:12px;color:#94A3B8;margin-bottom:14px">بضاعة آجل حالية للموردين (للعرض بس، مش داخلة في الحساب): ${invsFmt(monthNums.payables_credit)} ج.م</div>
                <div class="mod-table-wrap" style="margin-bottom:0">
                    <table class="mod-table"><tbody>
                        <tr><td>صافي ربح الشهر</td><td style="text-align:left;font-weight:800;color:${result.is_loss?'#DC2626':'#059669'}">${invsFmt(result.net_profit)}</td></tr>
                        <tr><td>نسبة المستثمر من رأس المال المملوك</td><td style="text-align:left">${(result.investor_ratio*100).toFixed(1)}%</td></tr>
                        <tr><td>نسبة صاحب المحل من رأس المال المملوك</td><td style="text-align:left">${(result.owner_ratio*100).toFixed(1)}%</td></tr>
                        <tr style="background:#FFFBEB"><td><strong>نصيب المستثمر الإجمالي</strong></td><td style="text-align:left;font-weight:800;color:#D97706">${invsFmt(result.investor_total)}</td></tr>
                        <tr style="background:#FFFBEB"><td><strong>نصيب صاحب المحل الإجمالي</strong> ${!result.is_loss?`<small style="color:#94A3B8">(مجهود ${invsFmt(result.effort_amount)} + رأس مال ${invsFmt(result.owner_capital_share)})</small>`:''}</td><td style="text-align:left;font-weight:800;color:#D97706">${invsFmt(result.owner_total)}</td></tr>
                    </tbody></table>
                </div>
                <div class="mod-form-group" style="margin-top:14px"><label>ملاحظات (اختياري)</label>
                    <textarea id="invsNotes" class="mod-form-input" style="min-height:60px"></textarea>
                </div>
                <button class="mod-btn mod-btn-primary" style="width:100%;margin-top:6px" onclick="invsCloseMonth()">🔒 تقفيل الشهر</button>
            </div>
        `;
    } catch (err) {
        area.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:16px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
};

window.invsCloseMonth = async function() {
    if (!_invsPreview) return;
    if (!confirm(`تقفيل شهر ${new Date(_invsPreview.period_month).toLocaleDateString('ar-EG',{year:'numeric',month:'long'})} نهائيًا؟ النتيجة هتتحفظ ثابتة ومش هترجع تتغير.`)) return;

    const btn = document.querySelector('#invsPreviewArea .mod-btn-primary');
    btn.innerText = 'جاري التقفيل...'; btn.disabled = true;
    try {
        const payload = {
            period_month: _invsPreview.period_month,
            investor_capital: _invsPreview.investor_capital,
            owner_capital: _invsPreview.owner_capital,
            effort_ratio: _invsPreview.effort_ratio,
            payables_credit: _invsPreview.payables_credit,
            monthly_sales: _invsPreview.monthly_sales,
            cogs: _invsPreview.cogs,
            operating_expenses: _invsPreview.operating_expenses,
            owned_capital_base: _invsPreview.owned_capital_base,
            investor_ratio: _invsPreview.investor_ratio,
            owner_ratio: _invsPreview.owner_ratio,
            net_profit: _invsPreview.net_profit,
            is_loss: _invsPreview.is_loss,
            effort_amount: _invsPreview.effort_amount,
            capital_amount: _invsPreview.capital_amount,
            investor_share: _invsPreview.investor_share,
            owner_capital_share: _invsPreview.owner_capital_share,
            investor_total: _invsPreview.investor_total,
            owner_total: _invsPreview.owner_total,
            notes: document.getElementById('invsNotes')?.value || null,
            created_by: currentUser?.id || null,
        };
        const { error } = await sb.from('investor_profit_snapshots').insert(payload);
        if (error) throw error;
        _invsPreview = null;
        alert('✅ تم تقفيل الشهر بنجاح');
        renderInvestors(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ أثناء التقفيل: ' + err.message);
        btn.innerText = '🔒 تقفيل الشهر'; btn.disabled = false;
    }
};
