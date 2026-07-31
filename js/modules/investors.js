/* ════════════════════════════════════════════════════════════
   المستثمرين — investors.js (نسخة موديل رأس المال المتعدد)
   بديل كامل للنسخة القديمة (طرفين بس: مستثمر واحد + صاحب محل، رأس مال
   يدوي كل شهر). المنطق الجديد (اتفق عليه 2026-07-28، راجع
   investor_capital_model_migration.sql):
     - صاحب المحل + المستثمرين في وعاء واحد (capital_partners)، كل واحد
       نصيبه من "جزء رأس المال" = متوسط رصيده المرجّح بالأيام خلال الشهر ÷
       إجمالي الوعاء (مش رصيد لحظي وقت التقفيل — عشان لو حد ضاف/سحب رأس
       مال نص الشهر يتحسب بعدل).
     - effort_ratio بتاعة صاحب المحل بتتاخد كاملة من فوق قبل التقسيم،
       ومفيش effort في شهر خسارة (المجهود نصيب من ربح، مش أجر ثابت).
     - خسارة الشهر بترحّل كعجز (cumulative_deficit) وتتخصم من أرباح شهور
       جاية، مش من رأس المال مباشرة. شهر الربح بيسدد العجز القديم الأول
       قبل أي صرف فعلي (net_payable).
     - دفتر capital_partner_transactions لإيداع/سحب رأس المال بس — مش
       مكان تسجيل الأرباح (دي في جدول التقفيل)، والرصيد بيتحدّث بتريجر
       مش من هنا.
     - مصروفات شخصية مستبعدة بعلامة excluded_from_investor_split على
       expense_categories، فمش بتأثر على operating_expenses هنا.
     - كل شهر بيتقفل مرة واحدة بس (period_month unique) عن طريق RPC واحد
       (fn_close_investor_month) عشان تقفيل الشهر (Header + سطور الشركاء
       + تحديث عجز كل شريك) يحصل في معاملة واحدة ذرّية، مش عدة INSERT
       منفصلة من الواجهة ممكن يفشل نصها.
   يصدّر: renderInvestors(container)
   ════════════════════════════════════════════════════════════ */

let _invsPartners = [];
let _invsHistory = [];
let _invsPreview = null;
let _invsStmtPartner = null, _invsStmtAllMoves = [], _invsStmtMoves = [], _invsStmtFrom = '', _invsStmtTo = '';

function invsFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function renderInvestors(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل البيانات...</div>';
    try {
        const [{ data: partners }, { data: history }] = await Promise.all([
            sb.from('capital_partners').select('*').order('partner_type', { ascending: false }).order('name'),
            sb.from('investor_profit_snapshots_v2').select('*').order('period_month', { ascending: false }),
        ]);
        _invsPartners = partners || [];
        _invsHistory = history || [];

        const now = new Date();
        const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const owner = _invsPartners.find(p => p.partner_type === 'owner');

        c.innerHTML = `
            <div style="margin-bottom:20px"><h2 style="font-size:22px;font-weight:800">🤝 المستثمرين — رأس المال والأرباح</h2>
            <p style="font-size:13px;color:var(--inv-muted);margin-top:4px">صاحب المحل والمستثمرين في وعاء رأس مال واحد، وتوزيع الأرباح حسب نسبة كل شريك ومجهود الإدارة</p></div>

            ${invsPartnersCardHTML(_invsPartners)}

            ${!owner ? `<div class="mod-alert-banner danger" style="margin-top:16px"><span>⚠️</span><span>لازم تضيفي "صاحب المحل" الأول (شريك من نوع صاحب محل) قبل ما تقدري تقفلي أي شهر.</span></div>` : `

            <div class="mod-alert-banner info" style="margin-top:16px">
                <span>ℹ️</span>
                <span>الأرقام دي معاينة بس لحد ما تدوسي "تقفيل الشهر" — بعد التقفيل النتيجة بتتحفظ ثابتة ومش بترجع تتغير حتى لو أرقام المبيعات/المصروفات العامة اتغيرت بعد كده.</span>
            </div>

            <div class="mod-card" style="margin-top:16px;max-width:480px">
                <div class="mod-form-group"><label>الشهر</label>
                    <input type="month" id="invsMonth" class="mod-form-input" value="${defaultMonth}">
                </div>
                <button class="mod-btn mod-btn-primary" style="width:100%" onclick="invsCalcPreview()">🔍 حساب المعاينة</button>
            </div>

            <div id="invsPreviewArea" style="margin-top:16px"></div>
            `}

            <div style="margin-top:24px">
                <h3 style="font-size:16px;font-weight:800;margin-bottom:12px">📜 الشهور المقفولة</h3>
                <div class="mod-table-wrap">
                    <table class="mod-table"><thead><tr>
                        <th>الشهر</th><th style="text-align:left">صافي الربح</th><th style="text-align:left">إجمالي المجهود</th><th style="text-align:left">وعاء رأس المال الموزّع</th><th>تاريخ التقفيل</th><th></th>
                    </tr></thead>
                    <tbody>
                        ${_invsHistory.length ? _invsHistory.map(h => `<tr>
                            <td><strong>${new Date(h.period_month).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long' })}</strong>${h.is_loss ? ' <span style="color:var(--inv-red);font-size:11px;font-weight:700">(خسارة)</span>' : ''}</td>
                            <td style="text-align:left;font-weight:700;color:${h.net_profit >= 0 ? 'var(--inv-green)' : 'var(--inv-red)'}">${invsFmt(h.net_profit)}</td>
                            <td style="text-align:left">${invsFmt(h.effort_amount)}</td>
                            <td style="text-align:left">${invsFmt(h.capital_pool_amount)}</td>
                            <td style="font-size:12px;color:var(--inv-muted)">${new Date(h.created_at).toLocaleDateString('ar-EG')}</td>
                            <td><button class="cc-edit" onclick="invsShowSnapshotDetail('${h.id}')">📄 التفاصيل</button></td>
                        </tr>`).join('') : `<tr><td colspan="6" class="empty-state"><span>📜</span>لا يوجد شهور مقفولة بعد</td></tr>`}
                    </tbody></table>
                </div>
            </div>
        `;
    } catch (err) {
        c.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

// ════════════════════════════════════════════════════════════
// 1) بطاقة الشركاء — عرض + إضافة/تعديل شريك + إيداع/سحب رأس مال
// ════════════════════════════════════════════════════════════
function invsPartnersCardHTML(partners) {
    return `
    <div class="mod-card" style="margin-top:4px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div style="font-size:15px;font-weight:800">👥 شركاء رأس المال</div>
            <button class="mod-btn mod-btn-primary" style="padding:6px 14px;font-size:13px" onclick="invsOpenPartnerModal()">+ شريك جديد</button>
        </div>
        ${!partners.length ? `<div class="empty-state" style="padding:20px"><span>👥</span>لا يوجد شركاء بعد</div>` : `
        <div class="mod-table-wrap" style="margin-bottom:0">
            <table class="mod-table"><thead><tr>
                <th>الاسم</th><th>النوع</th><th style="text-align:left">رأس المال</th><th style="text-align:left">أرباح متراكمة</th><th style="text-align:left">عجز مرحّل</th><th>طريقة الصرف</th><th>الحالة</th><th></th>
            </tr></thead><tbody>
                ${partners.map(p => `<tr>
                    <td><strong>${p.name}</strong>${p.phone ? `<div style="font-size:11px;color:var(--inv-muted-light)">${p.phone}</div>` : ''}</td>
                    <td>${p.partner_type === 'owner' ? '👑 صاحب المحل' : '💼 مستثمر'}${p.partner_type === 'owner' ? `<div style="font-size:11px;color:var(--inv-muted-light)">مجهود ${((Number(p.effort_ratio)||0)*100).toFixed(0)}%</div>` : ''}</td>
                    <td style="text-align:left;font-weight:700">${invsFmt(p.capital_balance)}</td>
                    <td style="text-align:left;font-weight:700;color:${Number(p.accrued_profit_balance)>0?'var(--inv-gold)':'var(--inv-muted-light)'}">${invsFmt(p.accrued_profit_balance)}</td>
                    <td style="text-align:left;color:${Number(p.cumulative_deficit)>0?'var(--inv-red)':'var(--inv-muted-light)'}">${invsFmt(p.cumulative_deficit)}</td>
                    <td>${p.payout_mode === 'cash' ? '💵 نقدي' : '📈 تراكم'}</td>
                    <td>${p.status === 'active' ? '<span style="color:var(--inv-green);font-weight:600">نشط</span>' : '<span style="color:var(--inv-muted-light)">خرج</span>'}</td>
                    <td style="white-space:nowrap">
                        <button class="cc-edit" onclick="invsShowStatement('${p.id}')">📄 كشف حساب</button>
                        <button class="cc-edit" onclick="invsOpenTxModal('${p.id}')">💰 حركة</button>
                        <button class="cc-edit" style="background:var(--inv-gold-bg);color:var(--inv-gold)" onclick="invsOpenPartnerModal('${p.id}')">✏️</button>
                    </td>
                </tr>`).join('')}
            </tbody></table>
        </div>`}
    </div>`;
}

window.invsOpenPartnerModal = function(id = null) {
    const p = id ? _invsPartners.find(x => x.id === id) : null;
    const hasOwner = _invsPartners.some(x => x.partner_type === 'owner' && x.id !== id);
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'invsPartnerModal';
    modal.innerHTML = `
        <div class="mod-modal">
            <div class="mod-modal-header"><h3>${p ? '✏️ تعديل شريك' : '+ شريك جديد'}</h3>
                <button class="mod-modal-close" onclick="invsCloseModal('invsPartnerModal')">&times;</button></div>
            <div class="mod-modal-body">
                <input type="hidden" id="invsPartnerId" value="${p?.id || ''}">
                <div class="mod-form-group"><label>الاسم *</label>
                    <input type="text" id="invsPartnerName" class="mod-form-input" value="${p?.name || ''}">
                </div>
                <div class="mod-form-group"><label>الهاتف</label>
                    <input type="text" id="invsPartnerPhone" class="mod-form-input" dir="ltr" value="${p?.phone || ''}">
                </div>
                <div class="mod-form-group"><label>النوع *</label>
                    <select id="invsPartnerType" class="mod-form-input" ${hasOwner ? '' : ''} onchange="document.getElementById('invsEffortRow').style.display = this.value==='owner' ? '' : 'none'">
                        <option value="investor" ${p?.partner_type==='investor'?'selected':''}>💼 مستثمر</option>
                        <option value="owner" ${p?.partner_type==='owner'?'selected':''} ${hasOwner ? 'disabled' : ''}>👑 صاحب المحل${hasOwner ? ' (موجود بالفعل)' : ''}</option>
                    </select>
                </div>
                <div id="invsEffortRow" class="mod-form-group" style="display:${p?.partner_type==='owner'?'':'none'}"><label>نسبة نصيب المجهود والإدارة (%)</label>
                    <input type="number" id="invsPartnerEffort" class="mod-form-input" min="0" max="100" step="1" value="${((Number(p?.effort_ratio)||0)*100).toFixed(0)}">
                    <small style="color:var(--inv-muted-light)">بتتاخد كاملة من فوق قبل تقسيم رأس المال — مش بتتطبق في شهر خسارة</small>
                </div>
                <div class="mod-form-group"><label>تاريخ الدخول *</label>
                    <input type="date" id="invsPartnerJoinDate" class="mod-form-input" value="${p?.join_date || new Date().toISOString().slice(0,10)}">
                </div>
                <div class="mod-form-group"><label>طريقة صرف النصيب</label>
                    <select id="invsPartnerPayout" class="mod-form-input">
                        <option value="accumulate" ${p?.payout_mode!=='cash'?'selected':''}>📈 تراكم (يفضل مسجّل كنصيب، مش بيتحوّل تلقائي لرأس مال)</option>
                        <option value="cash" ${p?.payout_mode==='cash'?'selected':''}>💵 نقدي</option>
                    </select>
                </div>
                ${p ? `<div class="mod-form-group"><label>الحالة</label>
                    <select id="invsPartnerStatus" class="mod-form-input">
                        <option value="active" ${p.status==='active'?'selected':''}>نشط</option>
                        <option value="exited" ${p.status==='exited'?'selected':''}>خرج</option>
                    </select>
                </div>` : ''}
                <div class="mod-form-group"><label>ملاحظات</label>
                    <textarea id="invsPartnerNotes" class="mod-form-input" style="min-height:50px">${p?.notes || ''}</textarea>
                </div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:var(--inv-text-soft)" onclick="invsCloseModal('invsPartnerModal')">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="invsSavePartner()">💾 حفظ</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
};

window.invsCloseModal = function(id) { const m = document.getElementById(id); if (m) m.remove(); };

window.invsSavePartner = async function() {
    const id = document.getElementById('invsPartnerId').value || null;
    const name = document.getElementById('invsPartnerName').value.trim();
    const phone = document.getElementById('invsPartnerPhone').value.trim() || null;
    const partner_type = document.getElementById('invsPartnerType').value;
    const effort_ratio = partner_type === 'owner' ? (parseFloat(document.getElementById('invsPartnerEffort').value) || 0) / 100 : null;
    const join_date = document.getElementById('invsPartnerJoinDate').value;
    const payout_mode = document.getElementById('invsPartnerPayout').value;
    const status = document.getElementById('invsPartnerStatus')?.value || 'active';
    const notes = document.getElementById('invsPartnerNotes').value.trim() || null;
    if (!name) return alert('اكتب اسم الشريك');
    if (!join_date) return alert('اختار تاريخ الدخول');

    const btn = document.querySelector('#invsPartnerModal .mod-btn-primary');
    btn.innerText = 'جاري الحفظ...'; btn.disabled = true;
    try {
        const payload = { name, phone, partner_type, effort_ratio, join_date, payout_mode, notes };
        let error;
        if (id) {
            ({ error } = await sb.from('capital_partners').update({ ...payload, status }).eq('id', id));
        } else {
            ({ error } = await sb.from('capital_partners').insert({ ...payload, created_by: currentUser?.id || null }));
        }
        if (error) throw error;
        invsCloseModal('invsPartnerModal');
        renderInvestors(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ أثناء الحفظ: ' + err.message);
        btn.innerText = '💾 حفظ'; btn.disabled = false;
    }
};

// ════════════════════════════════════════════════════════════
// 2) إيداع/سحب رأس مال — INSERT فقط، الرصيد بيتحدّث بتريجر
// ════════════════════════════════════════════════════════════
window.invsOpenTxModal = function(partnerId) {
    const p = _invsPartners.find(x => x.id === partnerId);
    if (!p) return;
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'invsTxModal';
    modal.innerHTML = `
        <div class="mod-modal">
            <div class="mod-modal-header"><h3>💰 حركة رأس مال — ${p.name}</h3>
                <button class="mod-modal-close" onclick="invsCloseModal('invsTxModal')">&times;</button></div>
            <div class="mod-modal-body">
                <div style="background:var(--inv-green-light);padding:10px 14px;border-radius:8px;margin-bottom:8px;font-size:13px">رأس المال الحالي: <strong>${invsFmt(p.capital_balance)} ج.م</strong></div>
                <div style="background:var(--inv-gold-bg);padding:10px 14px;border-radius:8px;margin-bottom:14px;font-size:13px">الأرباح المتراكمة المستحقة: <strong>${invsFmt(p.accrued_profit_balance)} ج.م</strong></div>
                <input type="hidden" id="invsTxPartnerId" value="${p.id}">
                <div class="mod-form-group"><label>نوع الحركة *</label>
                    <select id="invsTxType" class="mod-form-input">
                        <option value="contribution">⬆️ إيداع (زيادة رأس مال)</option>
                        <option value="withdrawal">⬇️ سحب (تقليل رأس مال)</option>
                        ${Number(p.accrued_profit_balance) > 0 ? `<option value="profit_payout">💸 صرف من الأرباح المتراكمة</option>` : ''}
                    </select>
                    <small style="color:var(--inv-muted-light)">"سحب رأس مال" بيقلل نصيب الشريك من ملكية الشركة — استخدم "صرف من الأرباح المتراكمة" لو بتصرفله من أرباحه المستحقة بس، مش من رأس ماله الأصلي</small>
                </div>
                <div class="mod-form-group"><label>المبلغ (ج.م) *</label>
                    <input type="number" id="invsTxAmount" class="mod-form-input" placeholder="0.00" step="0.01" dir="ltr" min="0.01">
                </div>
                <div class="mod-form-group"><label>التاريخ *</label>
                    <input type="date" id="invsTxDate" class="mod-form-input" value="${new Date().toISOString().slice(0,10)}">
                </div>
                <div class="mod-form-group"><label>ملاحظات</label>
                    <input type="text" id="invsTxNote" class="mod-form-input">
                </div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:var(--inv-text-soft)" onclick="invsCloseModal('invsTxModal')">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="invsSaveTx()">💾 حفظ الحركة</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
};

window.invsSaveTx = async function() {
    const partner_id = document.getElementById('invsTxPartnerId').value;
    const tx_type = document.getElementById('invsTxType').value;
    const amount = parseFloat(document.getElementById('invsTxAmount').value);
    const tx_date = document.getElementById('invsTxDate').value;
    const note = document.getElementById('invsTxNote').value.trim() || null;
    if (!amount || amount <= 0) return alert('أدخل مبلغاً صحيحاً');
    if (!tx_date) return alert('اختار التاريخ');
    if (tx_type === 'profit_payout') {
        const p = _invsPartners.find(x => x.id === partner_id);
        if (p && amount > Number(p.accrued_profit_balance) && !confirm(`المبلغ أكبر من الأرباح المتراكمة المستحقة (${invsFmt(p.accrued_profit_balance)} ج.م). متأكد عايز تكمل؟`)) return;
    }

    const btn = document.querySelector('#invsTxModal .mod-btn-primary');
    btn.innerText = 'جاري الحفظ...'; btn.disabled = true;
    try {
        const { error } = await sb.from('capital_partner_transactions').insert({
            partner_id, tx_type, amount, tx_date, note, created_by: currentUser?.id || null,
        });
        if (error) throw error;
        invsCloseModal('invsTxModal');
        renderInvestors(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ أثناء الحفظ: ' + err.message);
        btn.innerText = '💾 حفظ الحركة'; btn.disabled = false;
    }
};

// ════════════════════════════════════════════════════════════
// 3) أرقام الشهر (مبيعات/تكلفة/مصروفات) — نفس منهجية reports.js P&L
//    بالحرف، فيما عدا استبعاد بنود excluded_from_investor_split من
//    المصروفات التشغيلية (مصروفات شخصية زي عربية صاحب المحل)
// ════════════════════════════════════════════════════════════
async function invsFetchMonthNumbers(monthStr) {
    const from = `${monthStr}-01`;
    const toDate = new Date(from);
    toDate.setMonth(toDate.getMonth() + 1);
    const to = toDate.toISOString().slice(0, 10);

    const [{ data: sales }, { data: salesReturns }, { data: saleItemsCost }, { data: returnItemsCost }, { data: expenses }] = await Promise.all([
        sb.from('sales').select('total').eq('status', 'confirmed').gte('created_at', from).lt('created_at', to),
        sb.from('sales_returns').select('total').eq('status', 'confirmed').gte('created_at', from).lt('created_at', to),
        plFetchAllRows('sale_items', 'qty, cost_price_snapshot, sales!inner(created_at, status)', (q) =>
            q.eq('sales.status', 'confirmed').gte('sales.created_at', from).lt('sales.created_at', to)),
        plFetchAllRows('sale_return_items', 'qty, cost_price_snapshot, sales_returns!inner(created_at, status)', (q) =>
            q.eq('sales_returns.status', 'confirmed').gte('sales_returns.created_at', from).lt('sales_returns.created_at', to)),
        // مستبعد منها بنود excluded_from_investor_split على مستوى البند كله
        // (مصروفات شخصية دايمة) + على مستوى المعاملة نفسها excluded_from_investor_split
        // (مصروف استثنائي/زيادة لمرة واحدة فى بند عادي، من غير ما يأثر على
        // باقي معاملات نفس البند فى نفس الشهر أو الشهور الجاية)
        sb.from('expenses').select('amount, category_id, excluded_from_investor_split, expense_categories!inner(name, excluded_from_investor_split)')
            .eq('status', 'confirmed').gte('expense_date', from).lt('expense_date', to)
            .eq('expense_categories.excluded_from_investor_split', false)
            .eq('excluded_from_investor_split', false),
    ]);

    const totalSales = (sales || []).reduce((s, r) => s + Number(r.total), 0);
    const totalReturns = (salesReturns || []).reduce((s, r) => s + Number(r.total), 0);
    const monthly_sales = totalSales - totalReturns;
    const cogsSales = (saleItemsCost || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.cost_price_snapshot) || 0), 0);
    const cogsReturns = (returnItemsCost || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.cost_price_snapshot) || 0), 0);
    const cogs = cogsSales - cogsReturns;

    const catMap = {};
    (expenses || []).forEach(e => {
        const key = e.category_id;
        if (!catMap[key]) catMap[key] = { category_id: key, category_name: e.expense_categories?.name || '—', amount: 0 };
        catMap[key].amount += Number(e.amount) || 0;
    });
    const expense_breakdown = Object.values(catMap).sort((a, b) => b.amount - a.amount);
    const operating_expenses = expense_breakdown.reduce((s, b) => s + b.amount, 0);

    return { monthly_sales, cogs, operating_expenses, expense_breakdown, from, to };
}

// ════════════════════════════════════════════════════════════
// 4) متوسط رصيد كل شريك مرجّح بالأيام خلال الشهر (لا رصيد لحظي وقت
//    التقفيل) — شريك دخل نص الشهر أو ضاف/سحب فجأة ياخد نصيب يعكس فعلاً
//    الفترة اللي رأس ماله كان فيها موجود، مش الرصيد النهائي بس.
// ════════════════════════════════════════════════════════════
async function invsComputeCapitalRatios(partners, periodStart, periodEndExclusive) {
    const totalDays = Math.max(1, Math.round((new Date(periodEndExclusive) - new Date(periodStart)) / 86400000));
    const partnerIds = partners.map(p => p.id);
    // كل حركات الشريك (مش بس اللي قبل نهاية الفترة) — محتاجينها كاملة عشان
    // نحسب "الرصيد المبدئي" تحت
    const { data: txs } = partnerIds.length ? await sb.from('capital_partner_transactions')
        .select('partner_id, tx_date, tx_type, amount')
        .in('partner_id', partnerIds)
        .in('tx_type', ['contribution', 'withdrawal'])
        .order('tx_date', { ascending: true }) : { data: [] };

    const results = {};
    for (const p of partners) {
        const partnerTxs = (txs || []).filter(t => t.partner_id === p.id);
        // رأس مال مُدخل مباشرة وقت تسجيل الشريك (مش عن طريق حركة إيداع) —
        // نفس فكرة "الرصيد المبدئي" فى كشف الحساب (invsShowStatement).
        // من غير السطر ده، شريك عنده رأس مال فعلي بس بدون سجل حركات هياخد
        // نسبة صفر% غلط فى أي تقفيل شهر.
        const txSum = partnerTxs.reduce((s, t) => s + (t.tx_type === 'contribution' ? Number(t.amount) : -Number(t.amount)), 0);
        const seed = Number(p.capital_balance) - txSum;

        const beforePeriod = partnerTxs.filter(t => t.tx_date < periodStart)
            .reduce((s, t) => s + (t.tx_type === 'contribution' ? Number(t.amount) : -Number(t.amount)), 0);
        let balance = seed + beforePeriod;
        const inPeriod = partnerTxs.filter(t => t.tx_date >= periodStart && t.tx_date < periodEndExclusive);
        let cursor = periodStart;
        let weightedSum = 0;
        for (const t of inPeriod) {
            const days = (new Date(t.tx_date) - new Date(cursor)) / 86400000;
            weightedSum += balance * days;
            cursor = t.tx_date;
            balance += (t.tx_type === 'contribution' ? Number(t.amount) : -Number(t.amount));
        }
        const remainingDays = (new Date(periodEndExclusive) - new Date(cursor)) / 86400000;
        weightedSum += balance * remainingDays;
        results[p.id] = { avgBalance: totalDays > 0 ? weightedSum / totalDays : 0, daysInPeriod: totalDays };
    }
    const totalAvg = Object.values(results).reduce((s, r) => s + r.avgBalance, 0);
    for (const p of partners) {
        results[p.id].capitalRatio = totalAvg > 0 ? results[p.id].avgBalance / totalAvg : 0;
    }
    return results;
}

// ════════════════════════════════════════════════════════════
// 5) توزيع صافي ربح/خسارة الشهر على الشركاء
// ════════════════════════════════════════════════════════════
function invsComputeSplit(partners, ratios, monthNums) {
    const gross_profit = monthNums.monthly_sales - monthNums.cogs;
    const net_profit = gross_profit - monthNums.operating_expenses;
    const is_loss = net_profit < 0;
    const owner = partners.find(p => p.partner_type === 'owner');
    const effort_ratio = owner ? (Number(owner.effort_ratio) || 0) : 0;
    const effort_amount = (!is_loss && owner) ? net_profit * effort_ratio : 0;
    const capital_pool_amount = net_profit - effort_amount;
    const total_capital_base = partners.reduce((s, p) => s + (ratios[p.id]?.avgBalance || 0), 0);

    const lines = partners.map(p => {
        const capital_ratio = ratios[p.id]?.capitalRatio || 0;
        const days_in_period = ratios[p.id]?.daysInPeriod || 0;
        const capital_at_period = ratios[p.id]?.avgBalance || 0;
        let gross_share = capital_pool_amount * capital_ratio;
        if (p.partner_type === 'owner') gross_share += effort_amount;

        const deficit_before = Number(p.cumulative_deficit) || 0;
        let deficit_applied = 0, net_payable = 0, new_deficit = deficit_before;
        if (gross_share >= 0) {
            deficit_applied = Math.min(deficit_before, gross_share);
            net_payable = gross_share - deficit_applied;
            new_deficit = deficit_before - deficit_applied;
        } else {
            new_deficit = deficit_before + Math.abs(gross_share);
        }
        return {
            partner_id: p.id, partner_name: p.name, partner_type: p.partner_type, payout_mode: p.payout_mode,
            capital_at_period, days_in_period, capital_ratio, gross_share,
            deficit_before, deficit_applied, net_payable, new_deficit,
        };
    });

    return { gross_profit, net_profit, is_loss, effort_amount, capital_pool_amount, total_capital_base, lines };
}

window.invsCalcPreview = async function() {
    const monthStr = document.getElementById('invsMonth').value;
    if (!monthStr) return alert('اختاري الشهر أولاً');
    if (_invsHistory.some(h => h.period_month.slice(0, 7) === monthStr)) {
        document.getElementById('invsPreviewArea').innerHTML = `<div class="mod-alert-banner danger"><span>🔒</span><span>الشهر ده مقفول بالفعل — مش ممكن تقفيله تاني. شوف النتيجة في جدول "الشهور المقفولة" تحت.</span></div>`;
        return;
    }
    const activePartners = _invsPartners.filter(p => p.status === 'active');
    if (!activePartners.length) {
        document.getElementById('invsPreviewArea').innerHTML = `<div class="mod-alert-banner danger"><span>⚠️</span><span>مفيش شركاء نشطين.</span></div>`;
        return;
    }

    const area = document.getElementById('invsPreviewArea');
    area.innerHTML = '<div style="text-align:center;padding:20px;color:var(--inv-muted)">⏳ جاري جمع أرقام الشهر...</div>';
    try {
        const monthNums = await invsFetchMonthNumbers(monthStr);
        const ratios = await invsComputeCapitalRatios(activePartners, monthNums.from, monthNums.to);
        const result = invsComputeSplit(activePartners, ratios, monthNums);
        _invsPreview = { period_month: monthStr + '-01', ...monthNums, ...result };

        area.innerHTML = `
            <div class="mod-card">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
                    <div class="mod-card-icon" style="background:${result.is_loss?'var(--inv-red-bg)':'var(--inv-green-light)'};color:${result.is_loss?'var(--inv-red)':'var(--inv-green)'};width:40px;height:40px;font-size:18px">${result.is_loss?'📉':'📊'}</div>
                    <div style="font-size:15px;font-weight:800">معاينة ${new Date(_invsPreview.period_month).toLocaleDateString('ar-EG',{year:'numeric',month:'long'})}</div>
                </div>
                ${result.is_loss ? `<div class="mod-alert-banner danger" style="margin-bottom:14px"><span>⚠️</span><span>خسارة الشهر — بترحّل كعجز على كل شريك حسب نصيبه من الوعاء، وهتتخصم من أرباح الشهور الجاية. مفيش نصيب مجهود لصاحب المحل الشهر ده.</span></div>` : ''}
                <div class="mod-grid" style="grid-template-columns:repeat(3,1fr)">
                    <div class="mod-card" style="box-shadow:none;border-color:#F1F5F9"><div class="mod-card-val" style="font-size:16px">${invsFmt(monthNums.monthly_sales)}</div><div class="mod-card-lbl">صافي مبيعات الشهر</div></div>
                    <div class="mod-card" style="box-shadow:none;border-color:#F1F5F9"><div class="mod-card-val" style="font-size:16px">${invsFmt(monthNums.cogs)}</div><div class="mod-card-lbl">تكلفة البضاعة المباعة</div></div>
                    <div class="mod-card" style="box-shadow:none;border-color:#F1F5F9"><div class="mod-card-val" style="font-size:16px">${invsFmt(monthNums.operating_expenses)}</div><div class="mod-card-lbl">مصروفات تشغيلية (بعد استبعاد الشخصية)</div></div>
                </div>
                <div class="mod-table-wrap" style="margin-bottom:14px">
                    <table class="mod-table"><tbody>
                        <tr><td>مجمل الربح (مبيعات − تكلفة البضاعة)</td><td style="text-align:left;font-weight:700">${invsFmt(result.gross_profit)}</td></tr>
                        <tr><td>صافي ربح/خسارة الشهر (بعد المصروفات التشغيلية)</td><td style="text-align:left;font-weight:800;color:${result.is_loss?'var(--inv-red)':'var(--inv-green)'}">${invsFmt(result.net_profit)}</td></tr>
                        <tr><td>نصيب مجهود صاحب المحل</td><td style="text-align:left">${invsFmt(result.effort_amount)}</td></tr>
                        <tr><td>وعاء رأس المال المُوزَّع</td><td style="text-align:left">${invsFmt(result.capital_pool_amount)}</td></tr>
                        <tr><td>إجمالي رأس المال (متوسط مرجّح بالأيام)</td><td style="text-align:left">${invsFmt(result.total_capital_base)}</td></tr>
                    </tbody></table>
                </div>
                <div style="font-size:13px;font-weight:700;margin-bottom:8px">🗂️ تفصيل بنود المصروفات المخصومة (${monthNums.expense_breakdown.length} بند)</div>
                <div class="mod-table-wrap" style="margin-bottom:14px">
                    <table class="mod-table"><thead><tr><th>البند</th><th style="text-align:left">المبلغ</th></tr></thead><tbody>
                        ${monthNums.expense_breakdown.length ? monthNums.expense_breakdown.map(b => `<tr>
                            <td>${b.category_name}</td><td style="text-align:left">${invsFmt(b.amount)}</td>
                        </tr>`).join('') : `<tr><td colspan="2" class="empty-state" style="padding:10px">لا توجد مصروفات هذا الشهر</td></tr>`}
                    </tbody></table>
                </div>
                <div style="font-size:13px;font-weight:700;margin-bottom:8px">نصيب كل شريك</div>
                <div class="mod-table-wrap" style="margin-bottom:0">
                    <table class="mod-table"><thead><tr>
                        <th>الشريك</th><th style="text-align:left">نسبة رأس المال</th><th style="text-align:left">نصيب إجمالي</th><th style="text-align:left">من عجز سابق</th><th style="text-align:left">صافي مستحق</th>
                    </tr></thead><tbody>
                        ${result.lines.map(l => `<tr>
                            <td><strong>${l.partner_name}</strong>${l.partner_type==='owner'?' 👑':''}</td>
                            <td style="text-align:left">${(l.capital_ratio*100).toFixed(1)}%</td>
                            <td style="text-align:left;color:${l.gross_share>=0?'inherit':'var(--inv-red)'}">${invsFmt(l.gross_share)}</td>
                            <td style="text-align:left;color:var(--inv-muted-light)">${l.deficit_applied>0?'-'+invsFmt(l.deficit_applied):'—'}</td>
                            <td style="text-align:left;font-weight:800;color:var(--inv-gold)">${invsFmt(l.net_payable)}${l.new_deficit>0?`<div style="font-size:10.5px;font-weight:600;color:var(--inv-red)">عجز مرحّل: ${invsFmt(l.new_deficit)}</div>`:''}</td>
                        </tr>`).join('')}
                    </tbody></table>
                </div>
                <div class="mod-form-group" style="margin-top:14px"><label>ملاحظات (اختياري)</label>
                    <textarea id="invsNotes" class="mod-form-input" style="min-height:60px"></textarea>
                </div>
                <button class="mod-btn mod-btn-primary" style="width:100%;margin-top:6px" onclick="invsCloseMonth()">🔒 تقفيل الشهر</button>
            </div>
        `;
    } catch (err) {
        area.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:16px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
};

// ════════════════════════════════════════════════════════════
// 6) تقفيل الشهر — عن طريق RPC واحد ذرّي (fn_close_investor_month):
//    Header + سطور الشركاء + تحديث عجز كل شريك، كله في معاملة واحدة.
// ════════════════════════════════════════════════════════════
window.invsCloseMonth = async function() {
    if (!_invsPreview) return;
    if (!confirm(`تقفيل شهر ${new Date(_invsPreview.period_month).toLocaleDateString('ar-EG',{year:'numeric',month:'long'})} نهائيًا؟ النتيجة هتتحفظ ثابتة ومش هترجع تتغير.`)) return;

    const btn = document.querySelector('#invsPreviewArea .mod-btn-primary');
    btn.innerText = 'جاري التقفيل...'; btn.disabled = true;
    try {
        const { error } = await sb.rpc('fn_close_investor_month', {
            p_period_month: _invsPreview.period_month,
            p_monthly_sales: _invsPreview.monthly_sales,
            p_cogs: _invsPreview.cogs,
            p_operating_expenses: _invsPreview.operating_expenses,
            p_net_profit: _invsPreview.net_profit,
            p_is_loss: _invsPreview.is_loss,
            p_effort_amount: _invsPreview.effort_amount,
            p_capital_pool_amount: _invsPreview.capital_pool_amount,
            p_total_capital_base: _invsPreview.total_capital_base,
            p_expense_breakdown: _invsPreview.expense_breakdown,
            p_notes: document.getElementById('invsNotes')?.value || null,
            p_created_by: currentUser?.id || null,
            p_lines: _invsPreview.lines.map(l => ({
                partner_id: l.partner_id, capital_at_period: l.capital_at_period, days_in_period: l.days_in_period,
                capital_ratio: l.capital_ratio, gross_share: l.gross_share, deficit_before: l.deficit_before,
                deficit_applied: l.deficit_applied, net_payable: l.net_payable, new_deficit: l.new_deficit,
                payout_mode: l.payout_mode,
            })),
        });
        if (error) throw error;
        _invsPreview = null;
        alert('✅ تم تقفيل الشهر بنجاح');
        renderInvestors(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ أثناء التقفيل: ' + err.message);
        btn.innerText = '🔒 تقفيل الشهر'; btn.disabled = false;
    }
};

// ════════════════════════════════════════════════════════════
// 7) تفاصيل شهر مقفول — سطور الشركاء المحفوظة وقت التقفيل (ثابتة)
// ════════════════════════════════════════════════════════════
window.invsShowSnapshotDetail = async function(snapshotId) {
    const h = _invsHistory.find(x => x.id === snapshotId);
    if (!h) return;
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'invsDetailModal';
    modal.innerHTML = `
        <div class="mod-modal">
            <div class="mod-modal-header"><h3>📄 تفاصيل ${new Date(h.period_month).toLocaleDateString('ar-EG',{year:'numeric',month:'long'})}</h3>
                <button class="mod-modal-close" onclick="invsCloseModal('invsDetailModal')">&times;</button></div>
            <div class="mod-modal-body" id="invsDetailBody">⏳ جاري التحميل...</div>
        </div>`;
    document.body.appendChild(modal);

    try {
        const { data: lines, error } = await sb.from('investor_profit_snapshot_lines')
            .select('*, capital_partners(name, partner_type)').eq('snapshot_id', snapshotId);
        if (error) throw error;
        const grossProfit = Number(h.monthly_sales) - Number(h.cogs);
        const breakdown = Array.isArray(h.expense_breakdown) ? h.expense_breakdown : [];
        document.getElementById('invsDetailBody').innerHTML = `
            <div class="mod-table-wrap" style="margin-bottom:14px">
                <table class="mod-table"><tbody>
                    <tr><td>صافي المبيعات</td><td style="text-align:left">${invsFmt(h.monthly_sales)}</td></tr>
                    <tr><td>تكلفة البضاعة المباعة</td><td style="text-align:left">${invsFmt(h.cogs)}</td></tr>
                    <tr><td>مجمل الربح</td><td style="text-align:left;font-weight:700">${invsFmt(grossProfit)}</td></tr>
                    <tr><td>صافي ربح/خسارة الشهر</td><td style="text-align:left;font-weight:800;color:${h.is_loss?'var(--inv-red)':'var(--inv-green)'}">${invsFmt(h.net_profit)}</td></tr>
                </tbody></table>
            </div>
            <div style="font-size:13px;font-weight:700;margin-bottom:8px">🗂️ تفصيل بنود المصروفات وقت التقفيل (${breakdown.length} بند)</div>
            <div class="mod-table-wrap" style="margin-bottom:14px">
                <table class="mod-table"><thead><tr><th>البند</th><th style="text-align:left">المبلغ</th></tr></thead><tbody>
                    ${breakdown.length ? breakdown.map(b => `<tr><td>${b.category_name}</td><td style="text-align:left">${invsFmt(b.amount)}</td></tr>`).join('') : `<tr><td colspan="2" class="empty-state" style="padding:10px">لا توجد مصروفات هذا الشهر</td></tr>`}
                </tbody></table>
            </div>
            <div class="mod-table-wrap" style="margin-bottom:0">
                <table class="mod-table"><thead><tr>
                    <th>الشريك</th><th style="text-align:left">رأس المال (متوسط)</th><th style="text-align:left">نسبة</th><th style="text-align:left">نصيب</th><th style="text-align:left">صافي مستحق</th><th>الصرف</th>
                </tr></thead><tbody>
                    ${(lines||[]).map(l => `<tr>
                        <td><strong>${l.capital_partners?.name || '—'}</strong>${l.capital_partners?.partner_type==='owner'?' 👑':''}</td>
                        <td style="text-align:left">${invsFmt(l.capital_at_period)}</td>
                        <td style="text-align:left">${(Number(l.capital_ratio)*100).toFixed(1)}%</td>
                        <td style="text-align:left">${invsFmt(l.gross_share)}</td>
                        <td style="text-align:left;font-weight:700;color:var(--inv-gold)">${invsFmt(l.net_payable)}</td>
                        <td>${l.payout_mode==='cash'?'💵 نقدي':'📈 تراكم'}</td>
                    </tr>`).join('') || '<tr><td colspan="6" class="empty-state">لا توجد بيانات</td></tr>'}
                </tbody></table>
            </div>
            ${h.notes ? `<div style="margin-top:12px;font-size:13px;color:var(--inv-muted)"><strong>ملاحظات:</strong> ${h.notes}</div>` : ''}
        `;
    } catch (err) {
        document.getElementById('invsDetailBody').innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:16px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
};

// ════════════════════════════════════════════════════════════
// 8) كشف حساب شريك — رصيدين منفصلين جنب بعض (رأس المال + الأرباح
//    المتراكمة) مش رقم واحد مخلوط، عشان الفرق بين "رأس ماله" و"مستحقله"
//    يفضل واضح. مصادر الحركة: capital_partner_transactions (إيداع/سحب/
//    صرف أرباح) + investor_profit_snapshot_lines (نصيب كل شهر مقفول).
//    نفس نمط custShowStatement/custStmtRecomputeAndRender فى customers.js.
// ════════════════════════════════════════════════════════════
window.invsShowStatement = async function (partnerId) {
    const { data: p } = await sb.from('capital_partners').select('*').eq('id', partnerId).single();
    if (!p) return;

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'invsStmtModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:800px">
            <div class="mod-modal-header"><h3>📄 كشف حساب — ${p.name}</h3>
                <button class="mod-modal-close" onclick="invsCloseModal('invsStmtModal')">&times;</button></div>
            <div class="mod-modal-body" id="invsStmtBody"><div class="empty-state"><span>⏳</span>جاري تجميع الحركات...</div></div>
        </div>`;
    document.body.appendChild(modal);

    try {
        const [{ data: txs }, { data: lines }] = await Promise.all([
            sb.from('capital_partner_transactions').select('*').eq('partner_id', partnerId).order('tx_date', { ascending: true }),
            sb.from('investor_profit_snapshot_lines').select('*, investor_profit_snapshots_v2(period_month)').eq('partner_id', partnerId),
        ]);

        const moves = [];
        (txs || []).forEach(t => {
            if (t.tx_type === 'contribution') moves.push({ date: t.tx_date, desc: `إيداع رأس مال${t.note ? ' — ' + t.note : ''}`, capital_delta: Number(t.amount), profit_delta: 0 });
            else if (t.tx_type === 'withdrawal') moves.push({ date: t.tx_date, desc: `سحب رأس مال${t.note ? ' — ' + t.note : ''}`, capital_delta: -Number(t.amount), profit_delta: 0 });
            else if (t.tx_type === 'profit_payout') moves.push({ date: t.tx_date, desc: `صرف من الأرباح المتراكمة${t.note ? ' — ' + t.note : ''}`, capital_delta: 0, profit_delta: -Number(t.amount) });
        });
        (lines || []).forEach(l => {
            const period = l.investor_profit_snapshots_v2?.period_month;
            const monthLabel = period ? new Date(period).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long' }) : '—';
            if (l.payout_mode === 'cash') {
                moves.push({ date: period, desc: `نصيب أرباح ${monthLabel} — نقدي (افتراض إنه اتصرف فورًا، بدون أثر على أي رصيد)`, capital_delta: 0, profit_delta: 0 });
            } else if (Number(l.net_payable) > 0) {
                moves.push({ date: period, desc: `نصيب أرباح ${monthLabel} (متراكم)`, capital_delta: 0, profit_delta: Number(l.net_payable) });
            }
        });
        moves.sort((a, b) => new Date(a.date) - new Date(b.date));

        // رصيد افتتاحي: لو رأس مال الشريك اتسجّل مباشرة (زي أول تسجيل لكل
        // شريك حاليًا — رأس مال مُدخل وقت الإضافة، مش عن طريق حركة إيداع)،
        // مفيش حركة فى capital_partner_transactions بتمثله. نفس فكرة
        // "رصيد مرحّل من النظام القديم" فى كشف حساب العميل — الفرق بين
        // رأس المال/الأرباح الحقيقية وإجمالي الحركات المسجّلة بيتحط كسطر
        // افتتاحي بتاريخ الدخول، عشان الرصيد المتحرك يتطابق مع capital_balance
        // الحقيقي دايمًا، ومايظهرش صفر غلط لشريك عنده رأس مال فعلي.
        const totalCapitalMoves = moves.reduce((s, m) => s + m.capital_delta, 0);
        const totalProfitMoves = moves.reduce((s, m) => s + m.profit_delta, 0);
        const capitalSeed = Number(p.capital_balance) - totalCapitalMoves;
        const profitSeed = Number(p.accrued_profit_balance) - totalProfitMoves;
        if (Math.abs(capitalSeed) > 0.01 || Math.abs(profitSeed) > 0.01) {
            moves.unshift({ date: p.join_date, desc: 'رصيد مبدئي وقت تسجيل الشريك', capital_delta: capitalSeed, profit_delta: profitSeed });
        }

        let capitalRunning = 0, profitRunning = 0;
        moves.forEach(m => { capitalRunning += m.capital_delta; profitRunning += m.profit_delta; m.capitalBalance = capitalRunning; m.profitBalance = profitRunning; });

        _invsStmtPartner = p;
        _invsStmtAllMoves = moves;
        _invsStmtFrom = ''; _invsStmtTo = '';
        invsStmtRecomputeAndRender();
    } catch (err) {
        document.getElementById('invsStmtBody').innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:16px;border-radius:10px">خطأ: ${err.message}</div>`;
    }
};

function invsStmtRecomputeAndRender() {
    const p = _invsStmtPartner;
    const from = _invsStmtFrom, to = _invsStmtTo;
    let openingCapital = 0, openingProfit = 0;
    let filtered = _invsStmtAllMoves;
    if (from) {
        const fromTime = new Date(from).getTime();
        const before = _invsStmtAllMoves.filter(m => new Date(m.date).getTime() < fromTime);
        openingCapital = before.length ? before[before.length - 1].capitalBalance : 0;
        openingProfit = before.length ? before[before.length - 1].profitBalance : 0;
        filtered = _invsStmtAllMoves.filter(m => new Date(m.date).getTime() >= fromTime);
    }
    if (to) {
        const toTime = new Date(to + 'T23:59:59').getTime();
        filtered = filtered.filter(m => new Date(m.date).getTime() <= toTime);
    }
    const periodMoves = from
        ? [{ date: from, desc: 'الرصيد الافتتاحي لبداية الفترة', capital_delta: 0, profit_delta: 0, capitalBalance: openingCapital, profitBalance: openingProfit }, ...filtered]
        : filtered;
    _invsStmtMoves = periodMoves;

    document.getElementById('invsStmtBody').innerHTML = `
        <div class="mod-card" style="padding:12px 14px;margin-bottom:14px">
            <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
                <div><label class="ob-label">من تاريخ</label><input type="date" id="invsStmtFrom" class="ob-input" style="margin:0" value="${_invsStmtFrom}"></div>
                <div><label class="ob-label">إلى تاريخ</label><input type="date" id="invsStmtTo" class="ob-input" style="margin:0" value="${_invsStmtTo}"></div>
                <button class="ob-add-btn" onclick="invsStmtApplyDateFilter()">🔍 تطبيق</button>
                ${(_invsStmtFrom || _invsStmtTo) ? `<button class="mod-btn" style="background:#F1F5F9;color:var(--inv-text-soft)" onclick="invsStmtClearDateFilter()">✕ كل الفترة</button>` : ''}
                <button class="mod-btn" style="background:var(--inv-green-light);color:var(--inv-green)" onclick="invsStmtExportExcel()">📊 تصدير Excel</button>
            </div>
        </div>
        <div class="mod-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
            <div class="mod-card" style="padding:14px"><div style="font-size:11px;color:var(--inv-muted);margin-bottom:4px">رأس المال الحالي</div><div style="font-size:20px;font-weight:800">${invsFmt(p.capital_balance)}</div></div>
            <div class="mod-card" style="padding:14px"><div style="font-size:11px;color:var(--inv-muted);margin-bottom:4px">الأرباح المتراكمة المستحقة</div><div style="font-size:20px;font-weight:800;color:var(--inv-gold)">${invsFmt(p.accrued_profit_balance)}</div></div>
            <div class="mod-card" style="padding:14px"><div style="font-size:11px;color:var(--inv-muted);margin-bottom:4px">عجز مرحّل</div><div style="font-size:20px;font-weight:800;color:${Number(p.cumulative_deficit) > 0 ? 'var(--inv-red)' : 'var(--inv-muted-light)'}">${invsFmt(p.cumulative_deficit)}</div></div>
        </div>
        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>التاريخ</th><th>البيان</th>
                <th style="text-align:left">حركة رأس المال</th><th style="text-align:left">رصيد رأس المال</th>
                <th style="text-align:left">حركة الأرباح</th><th style="text-align:left">رصيد الأرباح</th>
            </tr></thead><tbody>
                ${periodMoves.length ? periodMoves.map(m => `<tr>
                    <td>${new Date(m.date).toLocaleDateString('ar-EG')}</td>
                    <td>${m.desc}</td>
                    <td style="text-align:left;color:${m.capital_delta > 0 ? 'var(--inv-green)' : m.capital_delta < 0 ? 'var(--inv-red)' : 'var(--inv-muted-light)'}">${m.capital_delta ? invsFmt(m.capital_delta) : '—'}</td>
                    <td style="text-align:left;font-weight:700">${invsFmt(m.capitalBalance)}</td>
                    <td style="text-align:left;color:${m.profit_delta > 0 ? 'var(--inv-green)' : m.profit_delta < 0 ? 'var(--inv-red)' : 'var(--inv-muted-light)'}">${m.profit_delta ? invsFmt(m.profit_delta) : '—'}</td>
                    <td style="text-align:left;font-weight:700;color:var(--inv-gold)">${invsFmt(m.profitBalance)}</td>
                </tr>`).join('') : `<tr><td colspan="6" class="empty-state">لا توجد حركات فى الفترة دي</td></tr>`}
            </tbody></table>
        </div>`;
}

window.invsStmtApplyDateFilter = function () {
    _invsStmtFrom = document.getElementById('invsStmtFrom')?.value || '';
    _invsStmtTo = document.getElementById('invsStmtTo')?.value || '';
    invsStmtRecomputeAndRender();
};
window.invsStmtClearDateFilter = function () {
    _invsStmtFrom = ''; _invsStmtTo = '';
    invsStmtRecomputeAndRender();
};
window.invsStmtExportExcel = function () {
    repExportExcel(`كشف_حساب_${_invsStmtPartner?.name || 'شريك'}`, _invsStmtMoves.map(m => ({
        'التاريخ': new Date(m.date).toLocaleDateString('ar-EG'),
        'البيان': m.desc,
        'حركة رأس المال': m.capital_delta,
        'رصيد رأس المال': m.capitalBalance,
        'حركة الأرباح': m.profit_delta,
        'رصيد الأرباح': m.profitBalance,
    })));
};
