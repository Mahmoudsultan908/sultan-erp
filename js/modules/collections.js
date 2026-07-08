/* ════════════════════════════════════════════════════════════
   تحصيل العملاء (سندات قبض) — customer_payments
   INSERT فقط — الـ Trigger (سيُنشأ لاحقاً) بيتولّى: الخزنة + رصيد العميل + القيد

   ⚠️ تنبيه مهم: جدول customer_payments جديد كلياً وليس له Trigger بعد.
   عند الـ INSERT بنجاح من الواجهة، لازم يتعمل Trigger في قاعدة البيانات
   يخصم من رصيد العميل ويضيف في الخزنة. (شغل منفصل على Supabase)
   ════════════════════════════════════════════════════════════ */

let _colCustomers = [];
let _colSelectedId = null;

// ════════════════════════════════════════════════════════════
// 1) التقديم الرئيسي
// ════════════════════════════════════════════════════════════
async function renderCollections(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات تحصيل العملاء...</div>';
    try {
        const { data: customers } = await sb.from('customers').select('*').eq('is_active', true).order('name');
        let payments = [];
        try {
            const r = await sb.from('customer_payments')
                .select('*, customers(name)').order('created_at', { ascending: false }).limit(50);
            payments = r.data || [];
        } catch (e) {
            // الجدول ممكن ما يكنش اتخلق لسه → نعرض تحذير للمستخدم
        }
        _colCustomers = customers || [];

        const totalCollected = payments.reduce((s,p)=>s+(Number(p.amount)||0),0);
        const debtCustomers = _colCustomers.filter(c => (Number(c.balance)||0) > 0);
        const totalDebt = debtCustomers.reduce((s,c)=>s+(Number(c.balance)||0),0);

        c.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
                <div><h2 style="font-size:22px;font-weight:800">💵 تحصيل العملاء (سندات قبض)</h2>
                <p style="font-size:13px;color:#64748B;margin-top:4px">تسجيل المبالغ المحصّلة من العملاء — مرتبطة بالخزنة ورصيد العميل</p></div>
                <button class="mod-btn mod-btn-primary" onclick="colOpenAdd()">+ تحصيل دفعة جديدة</button>
            </div>

            ${payments.length === 0 ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:12px 16px;border-radius:10px;margin-bottom:16px;font-size:12px">
                ⚠️ <strong>تنبيه:</strong> جدول التحصيل (<code>customer_payments</code>) لم يتم إنشاؤه بعد في قاعدة البيانات، أو لا يحتوي على Trigger.
                شغّل الـ Migration أولاً، وأنشئ الـ Trigger لكي تتحرّك الخزنة وأرصدة العملاء تلقائياً عند كل تحصيل.
            </div>` : ''}

            <div class="mod-grid">
                <div class="mod-card"><div class="mod-card-icon" style="background:#D1FAE5;color:#059669">💵</div><div class="mod-card-val">${colFmt(totalCollected)}</div><div class="mod-card-lbl">إجمالي المحصّل</div></div>
                <div class="mod-card"><div class="mod-card-icon" style="background:#E0E7FF;color:#4F46E5">📊</div><div class="mod-card-val">${payments.length}</div><div class="mod-card-lbl">سند قبض</div></div>
                <div class="mod-card"><div class="mod-card-icon" style="background:#FEF3C7;color:#D97706">📋</div><div class="mod-card-val">${colFmt(totalDebt)}</div><div class="mod-card-lbl">مستحق من العملاء (${debtCustomers.length})</div></div>
            </div>

            ${colDebtListHTML(debtCustomers)}

            <div class="mod-table-wrap" style="margin-top:16px">
                <table class="mod-table"><thead><tr>
                    <th>الرقم</th><th>العميل</th><th>التاريخ</th><th style="text-align:left">المبلغ</th><th>الحالة</th>
                </tr></thead>
                <tbody>
                    ${payments.length === 0 ? `<tr><td colspan="5" class="empty-state"><span>💵</span>لا توجد تحصيلات.</td></tr>` :
                    payments.map(p => `<tr>
                        <td><span style="background:#F1F5F9;padding:3px 8px;border-radius:5px;font-size:11px;font-family:monospace">${p.ref||'—'}</span></td>
                        <td><strong>${p.customers?.name || '—'}</strong></td>
                        <td>${new Date(p.created_at).toLocaleDateString('ar-EG')}</td>
                        <td style="text-align:left;font-weight:700;color:#059669">${colFmt(p.amount)}</td>
                        <td>${p.status==='confirmed'?'<span style="color:#059669;font-weight:600">✅ مؤكد</span>':`<span style="color:#D97706">${p.status}</span>`}</td>
                    </tr>`).join('')}
                </tbody></table>
            </div>
        `;
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function colDebtListHTML(debtCustomers) {
    if (!debtCustomers.length) return '';
    return `
    <div class="mod-card" style="margin-top:16px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
            <div class="mod-card-icon" style="background:#FEF3C7;color:#D97706;width:40px;height:40px;font-size:18px">📋</div>
            <div><div style="font-size:14px;font-weight:800">عملاء لهم مستحقات (مديونيات)</div><div style="font-size:11px;color:#64748B">اضغط "تحصيل" بجوار أي عميل لتحصيل المبلغ فوراً</div></div>
        </div>
        ${debtCustomers.slice(0,8).map(c => `<div class="cat-card">
            <div class="cc-ic">👤</div>
            <div class="cc-info">
                <div class="cc-name">${c.name}</div>
                <div class="cc-sub">${c.phone||''} ${c.code?'· '+c.code:''}</div>
            </div>
            <div class="cc-amt">
                <div class="used" style="color:#DC2626">${colFmt(c.balance)}</div>
                <div class="lim">مستحق</div>
            </div>
            <button class="cc-edit" style="background:#D1FAE5;color:#059669" onclick="colQuickCollect('${c.id}')">💵 تحصيل</button>
        </div>`).join('')}
    </div>`;
}

// ════════════════════════════════════════════════════════════
// 2) نافذة تحصيل دفعة
// ════════════════════════════════════════════════════════════
window.colOpenAdd = function(presetCustomerId = null) {
    _colSelectedId = presetCustomerId;
    const preset = presetCustomerId ? _colCustomers.find(x=>x.id===presetCustomerId) : null;

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'colModal';
    modal.innerHTML = `
        <div class="mod-modal">
            <div class="mod-modal-header"><h3>💵 تحصيل دفعة من عميل</h3>
                <button class="mod-modal-close" onclick="colCloseModal('colModal')">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>العميل *</label>
                    <select id="colCustId" class="mod-form-input" onchange="colOnCustChange()">
                        <option value="">-- اختر العميل --</option>
                        ${_colCustomers.map(c => `<option value="${c.id}" ${c.id===presetCustomerId?'selected':''}>${c.name} ${c.balance>0?'(مستحق '+colFmt(c.balance)+')':''}</option>`).join('')}
                    </select>
                </div>
                <div class="mod-form-group"><label>المبلغ المحصّل (ج.م) *</label>
                    <input type="number" id="colAmount" class="mod-form-input" placeholder="0.00" step="0.01" dir="ltr" value="${preset?colFmt(preset.balance):''}" oninput="colPreview()">
                </div>
                <div class="mod-form-group"><label>المرجع / البيان</label>
                    <input type="text" id="colRef" class="mod-form-input" placeholder="مثال: تحصيل على حساب فاتورة INV-0005">
                </div>
                <div id="colBalancePreview"></div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="colCloseModal('colModal')">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="colSave()">💾 تحصيل الدفعة</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    if (presetCustomerId) colPreview();
};

window.colQuickCollect = function(customerId) { colOpenAdd(customerId); };
window.colCloseModal = function(id) { const m = document.getElementById(id); if (m) m.remove(); };

window.colOnCustChange = function() {
    _colSelectedId = document.getElementById('colCustId').value;
    colPreview();
};

window.colPreview = function() {
    const cid = document.getElementById('colCustId').value;
    const amount = parseFloat(document.getElementById('colAmount').value) || 0;
    const area = document.getElementById('colBalancePreview');
    if (!cid || amount <= 0) { area.innerHTML = ''; return; }
    const c = _colCustomers.find(x=>x.id===cid);
    if (!c) return;
    const bal = Number(c.balance) || 0;
    const after = bal - amount;
    area.innerHTML = `
        <div class="limit-box" style="border-color:#D1FAE5;background:#ECFDF5">
            <div class="limit-row"><span class="lr-label">المستحق على العميل:</span><span class="lr-val" style="color:#DC2626">${colFmt(bal)} ج.م</span></div>
            <div class="limit-row"><span class="lr-label">هذا التحصيل:</span><span class="lr-val" style="color:#059669">${colFmt(amount)} ج.م</span></div>
            <div class="limit-row"><span class="lr-label">المستحق بعد التحصيل:</span><span class="lr-val" style="color:${after>0?'#D97706':'#059669'}">${colFmt(after)} ج.م</span></div>
        </div>`;
};

// ════════════════════════════════════════════════════════════
// 3) الحفظ — INSERT في customer_payments فقط
// ════════════════════════════════════════════════════════════
window.colSave = async function() {
    const custId = document.getElementById('colCustId').value;
    const amount = parseFloat(document.getElementById('colAmount').value);
    const ref = document.getElementById('colRef').value.trim();
    if (!custId) return alert('اختر العميل');
    if (!amount || amount <= 0) return alert('أدخل مبلغاً صحيحاً');

    const btn = document.querySelector('#colModal .mod-btn-primary');
    btn.innerText = 'جاري التحصيل...'; btn.disabled = true;
    try {
        // INSERT فقط — الـ Trigger (سيُنشأ لاحقاً) بيتكفّل بـ: زيادة الخزنة + تقليل رصيد العميل + القيد المحاسبي
        const { error } = await sb.from('customer_payments').insert({
            ref: ref || 'COL-' + Date.now(),
            customer_id: custId,
            amount,
            status: 'confirmed',
            created_by: currentUser?.id || null,
        });
        if (error) throw error;

        colCloseModal('colModal');
        try {
            const { data: cash } = await sb.rpc('get_cash_balance');
            const tb = document.getElementById('topbarCash');
            if (tb) tb.textContent = '💰 ' + (cash || 0).toFixed(2) + ' ج.م';
        } catch {}
        renderCollections(document.getElementById('app-content'));
    } catch (err) { alert('خطأ أثناء التحصيل: ' + err.message); }
    finally { btn.innerText = '💾 تحصيل الدفعة'; btn.disabled = false; }
};

// ════════════════════════════════════════════════════════════
// 4) أدوات مساعدة
// ════════════════════════════════════════════════════════════
function colFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
