/* ════════════════════════════════════════════════════════════
   دفع الموردين (سندات صرف) — supplier_payments
   INSERT فقط — الـ Triggers تتولى: الخزنة + رصيد المورد + القيد
   ════════════════════════════════════════════════════════════ */

let _paySuppliers = [];
let _paySelectedId = null;
let _payList = [];

// ════════════════════════════════════════════════════════════
// 1) التقديم الرئيسي
// ════════════════════════════════════════════════════════════
async function renderPayments(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات دفع الموردين...</div>';
    try {
        const { data: suppliers } = await sb.from('suppliers').select('*').eq('is_active', true).order('name');
        const { data: payments } = await sb.from('supplier_payments')
            .select('*, suppliers(name, phone, balance)').order('created_at', { ascending: false }).limit(50);
        _paySuppliers = suppliers || [];
        _payList = payments || [];
        // كاش للمراجعة الأوفلاين (offline.js) — قراءة فقط، بيتحدّث تلقائياً كل ما الصفحة تفتح أونلاين
        if (typeof dbSetCache === 'function') dbSetCache('suppliers', _paySuppliers);

        const totalPaid = (payments||[]).reduce((s,p)=>s+(Number(p.amount)||0),0);
        const debtSuppliers = _paySuppliers.filter(s => (Number(s.balance)||0) > 0);
        const totalDebt = debtSuppliers.reduce((s,s2)=>s+(Number(s2.balance)||0),0);

        c.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
                <div><h2 style="font-size:22px;font-weight:800">💸 دفع الموردين (سندات صرف)</h2>
                <p style="font-size:13px;color:#64748B;margin-top:4px">تسجيل المدفوعات للموردين — مرتبطة بالخزنة ورصيد المورد</p></div>
                <button class="mod-btn mod-btn-primary" onclick="payOpenAdd()">+ صرف دفعة جديدة</button>
            </div>

            <div class="mod-grid">
                <div class="mod-card"><div class="mod-card-icon" style="background:#D1FAE5;color:#059669">💵</div><div class="mod-card-val">${payFmt(totalPaid)}</div><div class="mod-card-lbl">إجمالي المدفوع</div></div>
                <div class="mod-card"><div class="mod-card-icon" style="background:#FEF3C7;color:#D97706">📋</div><div class="mod-card-val">${(payments||[]).length}</div><div class="mod-card-lbl">سند صرف</div></div>
                <div class="mod-card"><div class="mod-card-icon" style="background:#FEE2E2;color:#DC2626">⚠️</div><div class="mod-card-val">${payFmt(totalDebt)}</div><div class="mod-card-lbl">مستحق للموردين (${debtSuppliers.length})</div></div>
            </div>

            ${paySuppliersDebtListHTML(debtSuppliers)}

            <div class="mod-table-wrap" style="margin-top:16px">
                <table class="mod-table"><thead><tr>
                    <th>الرقم</th><th>المورد</th><th>التاريخ</th><th style="text-align:left">المبلغ</th><th>الحالة</th><th></th>
                </tr></thead>
                <tbody>
                    ${(payments||[]).length === 0 ? `<tr><td colspan="6" class="empty-state"><span>💸</span>لا توجد مدفوعات.</td></tr>` :
                    payments.map(p => `<tr>
                        <td><span style="background:#F1F5F9;padding:3px 8px;border-radius:5px;font-size:11px;font-family:monospace">${p.ref||'—'}</span></td>
                        <td><strong>${p.suppliers?.name || '—'}</strong></td>
                        <td>${new Date(p.created_at).toLocaleDateString('ar-EG')}</td>
                        <td style="text-align:left;font-weight:700;color:#059669">${payFmt(p.amount)}</td>
                        <td>${p.status==='confirmed'?'<span style="color:#059669;font-weight:600">✅ مؤكد</span>':`<span style="color:#D97706">${p.status}</span>`}</td>
                        <td><button class="cc-edit" onclick="payPrintVoucher('${p.id}')">🖨️</button></td>
                    </tr>`).join('')}
                </tbody></table>
            </div>
        `;
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function paySuppliersDebtListHTML(debtSuppliers) {
    if (!debtSuppliers.length) return '';
    return `
    <div class="mod-card" style="margin-top:16px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
            <div class="mod-card-icon" style="background:#FEF3C7;color:#D97706;width:40px;height:40px;font-size:18px">⚠️</div>
            <div><div style="font-size:14px;font-weight:800">موردون لهم مستحقات (مديونيات)</div><div style="font-size:11px;color:#64748B">اضغط "صرف دفعة" بجوار أي مورد لدفعه فوراً</div></div>
        </div>
        ${debtSuppliers.slice(0,8).map(s => `<div class="cat-card">
            <div class="cc-ic">🏭</div>
            <div class="cc-info">
                <div class="cc-name">${s.name}</div>
                <div class="cc-sub">${s.phone||''} ${s.code?'· '+s.code:''}</div>
            </div>
            <div class="cc-amt">
                <div class="used" style="color:#DC2626">${payFmt(s.balance)}</div>
                <div class="lim">مستحق</div>
            </div>
            <button class="cc-edit" style="background:#D1FAE5;color:#059669" onclick="payQuickPay('${s.id}')">💸 دفع</button>
        </div>`).join('')}
    </div>`;
}

// ════════════════════════════════════════════════════════════
// 2) نافذة إضافة دفعة
// ════════════════════════════════════════════════════════════
window.payOpenAdd = function(presetSupplierId = null) {
    _paySelectedId = presetSupplierId;
    const preset = presetSupplierId ? _paySuppliers.find(s=>s.id===presetSupplierId) : null;

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'payModal';
    modal.innerHTML = `
        <div class="mod-modal">
            <div class="mod-modal-header"><h3>💸 صرف دفعة لمورد</h3>
                <button class="mod-modal-close" onclick="payCloseModal('payModal')">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>المورد *</label>
                    <select id="paySuppId" class="mod-form-input" onchange="payOnSuppChange()">
                        <option value="">-- اختر المورد --</option>
                        ${_paySuppliers.map(s => `<option value="${s.id}" ${s.id===presetSupplierId?'selected':''}>${s.name} ${s.balance>0?'(مستحق '+payFmt(s.balance)+')':''}</option>`).join('')}
                    </select>
                </div>
                <div class="mod-form-group"><label>المبلغ (ج.م) *</label>
                    <input type="number" id="payAmount" class="mod-form-input" placeholder="0.00" step="0.01" dir="ltr" value="${preset?payFmt(preset.balance):''}" oninput="payPreview()">
                </div>
                <div class="mod-form-group"><label>المرجع / البيان</label>
                    <input type="text" id="payRef" class="mod-form-input" placeholder="مثال: دفعة على حساب فاتورة PUR-0005">
                </div>
                <div id="payBalancePreview"></div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="payCloseModal('payModal')">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="paySave()">💾 صرف الدفعة</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    if (presetSupplierId) payPreview();
};

window.payQuickPay = function(supplierId) { payOpenAdd(supplierId); };

window.payCloseModal = function(id) { const m = document.getElementById(id); if (m) m.remove(); };

window.payOnSuppChange = function() {
    _paySelectedId = document.getElementById('paySuppId').value;
    payPreview();
};

window.payPreview = function() {
    const sid = document.getElementById('paySuppId').value;
    const amount = parseFloat(document.getElementById('payAmount').value) || 0;
    const area = document.getElementById('payBalancePreview');
    if (!sid || amount <= 0) { area.innerHTML = ''; return; }
    const s = _paySuppliers.find(x=>x.id===sid);
    if (!s) return;
    const bal = Number(s.balance) || 0;
    const after = bal - amount;
    area.innerHTML = `
        <div class="limit-box" style="border-color:#D1FAE5;background:#ECFDF5">
            <div class="limit-row"><span class="lr-label">المستحق للمورد:</span><span class="lr-val" style="color:#DC2626">${payFmt(bal)} ج.م</span></div>
            <div class="limit-row"><span class="lr-label">هذه الدفعة:</span><span class="lr-val" style="color:#059669">${payFmt(amount)} ج.م</span></div>
            <div class="limit-row"><span class="lr-label">المستحق بعد الدفع:</span><span class="lr-val" style="color:${after>0?'#D97706':'#059669'}">${payFmt(after)} ج.م</span></div>
        </div>`;
};

// ════════════════════════════════════════════════════════════
// 3) الحفظ — INSERT في supplier_payments فقط
// ════════════════════════════════════════════════════════════
window.paySave = async function() {
    const suppId = document.getElementById('paySuppId').value;
    const amount = parseFloat(document.getElementById('payAmount').value);
    const ref = document.getElementById('payRef').value.trim();
    if (!suppId) return alert('اختر المورد');
    if (!amount || amount <= 0) return alert('أدخل مبلغاً صحيحاً');

    const btn = document.querySelector('#payModal .mod-btn-primary');
    btn.innerText = 'جاري الصرف...'; btn.disabled = true;
    try {
        // INSERT فقط — الـ trigger بيتكفّل بـ: خصم الخزنة + تقليل رصيد المورد + القيد المحاسبي
        const { error } = await sb.from('supplier_payments').insert({
            ref: ref || 'PAY-' + Date.now(),
            supplier_id: suppId,
            amount,
            status: 'confirmed',
            created_by: currentUser?.id || null,
        });
        if (error) throw error;

        payCloseModal('payModal');
        try {
            const { data: cash } = await sb.rpc('get_cash_balance');
            const tb = document.getElementById('topbarCash');
            if (tb) tb.textContent = '💰 ' + (cash || 0).toFixed(2) + ' ج.م';
        } catch {}
        renderPayments(document.getElementById('app-content'));
    } catch (err) { alert('خطأ أثناء الصرف: ' + err.message); }
    finally { btn.innerText = '💾 صرف الدفعة'; btn.disabled = false; }
};

// ════════════════════════════════════════════════════════════
// 4) أدوات مساعدة
// ════════════════════════════════════════════════════════════
window.payPrintVoucher = async function(id) {
    const p = _payList.find(x=>x.id===id);
    if (!p) return;
    const balanceAfter = (Number(p.suppliers?.balance)||0);
    const balanceBefore = balanceAfter + Number(p.amount);
    await printThermalReceipt('payment', {
        ref: p.ref, entityName: p.suppliers?.name || '—', amount: p.amount,
        entityBalanceBefore: balanceBefore, entityBalanceAfter: balanceAfter,
    });
};

function payFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
