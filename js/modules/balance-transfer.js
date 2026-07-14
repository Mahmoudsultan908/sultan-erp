/* ════════════════════════════════════════════════════════════
   تحويل الأرصدة اليدوي — balance_transfers
   INSERT فقط — الـ trigger في Postgres بيتولى: تحديث الرصيدين +
   القيد المحاسبي (+ حركة الخزنة في حالة "مورد → خزنة").
   3 أنواع: عميل↔عميل، مورد↔مورد، مورد→خزنة (استرداد نقدي).
   يصدّر: renderBalanceTransfer(container)
   ════════════════════════════════════════════════════════════ */

let _btCustomers = [];
let _btSuppliers = [];
let _btTreasuries = [];
let _btTransfers = [];
let _btTab = 'customer_to_customer';

function btFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function renderBalanceTransfer(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات تحويل الأرصدة...</div>';
    try {
        const [{ data: customers }, { data: suppliers }, { data: treasuries }, { data: transfers }] = await Promise.all([
            sb.from('customers').select('id, name, balance').eq('is_active', true).order('name'),
            sb.from('suppliers').select('id, name, balance').eq('is_active', true).order('name'),
            sb.from('treasuries').select('*').eq('is_active', true).order('is_default', { ascending: false }),
            sb.from('balance_transfers').select('*, from_c:from_customer_id(name), to_c:to_customer_id(name), from_s:from_supplier_id(name), to_s:to_supplier_id(name), t:treasury_id(name)')
                .order('created_at', { ascending: false }).limit(30),
        ]);
        _btCustomers = customers || [];
        _btSuppliers = suppliers || [];
        _btTreasuries = treasuries || [];
        _btTransfers = transfers || [];

        btRender(c);
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

const BT_TABS = [
    { id: 'customer_to_customer', label: '👤 عميل → عميل' },
    { id: 'supplier_to_supplier', label: '🏭 مورد → مورد' },
    { id: 'supplier_to_treasury', label: '💰 مورد → خزنة (استرداد نقدي)' },
];

function btRender(c) {
    c.innerHTML = `
    <div style="margin-bottom:20px">
        <h2 style="font-size:22px;font-weight:800">🔀 تحويل الأرصدة</h2>
        <p style="font-size:13px;color:#64748B;margin-top:4px">تحويل يدوي لرصيد بين عميلين، بين موردين، أو استرداد نقدي من رصيد مورد لخزنة</p>
    </div>

    <div class="mod-tabs" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        ${BT_TABS.map(t => `<button class="mod-btn" style="background:${t.id===_btTab?'#1E3A8A':'#F1F5F9'};color:${t.id===_btTab?'#fff':'#475569'}" onclick="btSwitchTab('${t.id}')">${t.label}</button>`).join('')}
    </div>

    <div class="mod-card" style="max-width:600px">
        ${btFormHTML()}
    </div>

    <div class="mod-table-wrap" style="margin-top:16px">
        <table class="mod-table"><thead><tr>
            <th>التاريخ</th><th>النوع</th><th>من</th><th>إلى</th><th style="text-align:left">المبلغ</th><th>ملاحظات</th>
        </tr></thead>
        <tbody>
            ${_btTransfers.length === 0 ? `<tr><td colspan="6" class="empty-state"><span>🔀</span>لا توجد تحويلات بعد.</td></tr>` :
            _btTransfers.map(t => `<tr>
                <td>${new Date(t.created_at).toLocaleString('ar-EG', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}</td>
                <td>${BT_TABS.find(x=>x.id===t.transfer_type)?.label || t.transfer_type}</td>
                <td>${t.from_c?.name || t.from_s?.name || '—'}</td>
                <td>${t.to_c?.name || t.to_s?.name || t.t?.name || '—'}</td>
                <td style="text-align:left;font-weight:700">${btFmt(t.amount)}</td>
                <td>${t.notes || '—'}</td>
            </tr>`).join('')}
        </tbody></table>
    </div>`;
}

function btFormHTML() {
    if (_btTab === 'customer_to_customer') {
        return `
        <div class="mod-form-group"><label>من عميل *</label>
            <select id="btFromCust" class="mod-form-input">
                <option value="">-- اختر --</option>
                ${_btCustomers.map(x => `<option value="${x.id}">${x.name} (${btFmt(x.balance)})</option>`).join('')}
            </select>
        </div>
        <div class="mod-form-group"><label>إلى عميل *</label>
            <select id="btToCust" class="mod-form-input">
                <option value="">-- اختر --</option>
                ${_btCustomers.map(x => `<option value="${x.id}">${x.name} (${btFmt(x.balance)})</option>`).join('')}
            </select>
        </div>
        <div class="mod-form-group"><label>المبلغ (ج.م) *</label>
            <input type="number" id="btAmount" class="mod-form-input" placeholder="0.00" step="0.01" dir="ltr">
        </div>
        <div class="mod-form-group"><label>ملاحظات</label>
            <input type="text" id="btNotes" class="mod-form-input" placeholder="اختياري">
        </div>
        <button class="mod-btn mod-btn-primary" style="width:100%" onclick="btSave()">🔀 تنفيذ التحويل</button>`;
    }
    if (_btTab === 'supplier_to_supplier') {
        return `
        <div class="mod-form-group"><label>من مورد *</label>
            <select id="btFromSupp" class="mod-form-input">
                <option value="">-- اختر --</option>
                ${_btSuppliers.map(x => `<option value="${x.id}">${x.name} (${btFmt(x.balance)})</option>`).join('')}
            </select>
        </div>
        <div class="mod-form-group"><label>إلى مورد *</label>
            <select id="btToSupp" class="mod-form-input">
                <option value="">-- اختر --</option>
                ${_btSuppliers.map(x => `<option value="${x.id}">${x.name} (${btFmt(x.balance)})</option>`).join('')}
            </select>
        </div>
        <div class="mod-form-group"><label>المبلغ (ج.م) *</label>
            <input type="number" id="btAmount" class="mod-form-input" placeholder="0.00" step="0.01" dir="ltr">
        </div>
        <div class="mod-form-group"><label>ملاحظات</label>
            <input type="text" id="btNotes" class="mod-form-input" placeholder="اختياري">
        </div>
        <button class="mod-btn mod-btn-primary" style="width:100%" onclick="btSave()">🔀 تنفيذ التحويل</button>`;
    }
    // supplier_to_treasury
    return `
    <div class="mod-form-group"><label>المورد *</label>
        <select id="btFromSupp" class="mod-form-input">
            <option value="">-- اختر --</option>
            ${_btSuppliers.map(x => `<option value="${x.id}">${x.name} (${btFmt(x.balance)})</option>`).join('')}
        </select>
    </div>
    <div class="mod-form-group"><label>إلى خزنة *</label>
        <select id="btTreasury" class="mod-form-input">
            ${_btTreasuries.map(t => `<option value="${t.id}" ${t.is_default?'selected':''}>${t.name}</option>`).join('')}
        </select>
    </div>
    <div class="mod-form-group"><label>المبلغ (ج.م) *</label>
        <input type="number" id="btAmount" class="mod-form-input" placeholder="0.00" step="0.01" dir="ltr">
    </div>
    <div class="mod-form-group"><label>ملاحظات</label>
        <input type="text" id="btNotes" class="mod-form-input" placeholder="اختياري">
    </div>
    <button class="mod-btn mod-btn-primary" style="width:100%" onclick="btSave()">💰 تنفيذ الاسترداد</button>`;
}

window.btSwitchTab = function(tab) {
    _btTab = tab;
    btRender(document.getElementById('app-content'));
};

window.btSave = async function() {
    const amount = parseFloat(document.getElementById('btAmount').value);
    const notes = document.getElementById('btNotes').value.trim() || null;
    if (!amount || amount <= 0) return alert('أدخل مبلغاً صحيحاً');

    const payload = { transfer_type: _btTab, amount, notes, created_by: currentUser?.id || null };

    if (_btTab === 'customer_to_customer') {
        const fromId = document.getElementById('btFromCust').value;
        const toId = document.getElementById('btToCust').value;
        if (!fromId || !toId) return alert('اختر العميلين');
        if (fromId === toId) return alert('لازم تختار عميلين مختلفين');
        payload.from_customer_id = fromId; payload.to_customer_id = toId;
    } else if (_btTab === 'supplier_to_supplier') {
        const fromId = document.getElementById('btFromSupp').value;
        const toId = document.getElementById('btToSupp').value;
        if (!fromId || !toId) return alert('اختر الموردين');
        if (fromId === toId) return alert('لازم تختار موردين مختلفين');
        payload.from_supplier_id = fromId; payload.to_supplier_id = toId;
    } else {
        const fromId = document.getElementById('btFromSupp').value;
        const treasuryId = document.getElementById('btTreasury').value;
        if (!fromId) return alert('اختر المورد');
        if (!treasuryId) return alert('اختر الخزنة');
        payload.from_supplier_id = fromId; payload.treasury_id = treasuryId;
    }

    const btn = document.querySelector('.mod-btn-primary');
    if (btn) { btn.dataset._label = btn.dataset._label || btn.textContent; btn.textContent = 'جاري التنفيذ...'; btn.disabled = true; }

    try {
        const { error } = await sb.from('balance_transfers').insert(payload);
        if (error) throw error;
        renderBalanceTransfer(document.getElementById('app-content'));
    } catch (err) {
        alert('خطأ أثناء التحويل: ' + err.message);
        if (btn) { btn.textContent = btn.dataset._label; btn.disabled = false; }
    }
};

Object.assign(window, { renderBalanceTransfer });
