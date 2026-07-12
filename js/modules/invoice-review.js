/* ════════════════════════════════════════════════════════════
   مراجعة الفواتير + تعديلها — مبيعات ومشتريات
   يصدّر: renderInvoiceReview(container)

   "تعديل" هنا معناه: الفاتورة القديمة بتتلغي تلقائياً (مع إرجاع
   المخزون والرصيد) وتتسجّل فاتورة جديدة بالبيانات المعدّلة —
   حفاظاً على تتبع تاريخ التعديلات (audit trail)، بدل التعديل
   المباشر فوق نفس السجل.
   ════════════════════════════════════════════════════════════ */

let revType = 'sales'; // 'sales' | 'purchase'
let revList = [];

async function renderInvoiceReview(c) {
    revType = 'sales';
    c.innerHTML = `
    <div class="ob-wrap">
        <div class="dash-header">
            <div><h2 class="dash-title">🔍 مراجعة الفواتير</h2>
            <p class="dash-sub">ابحث عن أي فاتورة سابقة، اعرض تفاصيلها، أو عدّلها</p></div>
        </div>
        <div class="ob-tabs">
            <button class="ob-tab active" onclick="revSwitchType('sales')">🧾 فواتير المبيعات</button>
            <button class="ob-tab" onclick="revSwitchType('purchase')">📥 فواتير المشتريات</button>
        </div>
        <div id="rev-content" style="margin-top:16px"></div>
    </div>`;
    await revRenderBody();
}

window.revSwitchType = function (type) {
    revType = type;
    document.querySelectorAll('.ob-tabs .ob-tab').forEach(b => b.classList.remove('active'));
    document.querySelector(`.ob-tabs .ob-tab:nth-child(${type === 'sales' ? 1 : 2})`)?.classList.add('active');
    revRenderBody();
};

async function revRenderBody() {
    const c = document.getElementById('rev-content');
    c.innerHTML = `
        <div class="dash-card" style="padding:16px 18px;margin-bottom:16px">
            <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
                <div><label class="ob-label">رقم الفاتورة</label><input id="rev-no" class="ob-input" style="margin:0;max-width:160px" dir="ltr" placeholder="${revType==='sales'?'INV-0001':'PUR-0001'}" onkeydown="if(event.key==='Enter')revSearch()"></div>
                <div><label class="ob-label">${revType==='sales'?'اسم العميل':'اسم المورد'}</label><input id="rev-name" class="ob-input" style="margin:0;max-width:200px" placeholder="بحث بالاسم" onkeydown="if(event.key==='Enter')revSearch()"></div>
                <div><label class="ob-label">من تاريخ</label><input id="rev-from" type="date" class="ob-input" style="margin:0"></div>
                <div><label class="ob-label">إلى تاريخ</label><input id="rev-to" type="date" class="ob-input" style="margin:0"></div>
                <button class="ob-add-btn" onclick="revSearch()">🔍 بحث</button>
                <button class="ob-add-btn" style="background:#F1F5F9;color:#475569" onclick="revClearSearch()">✕ مسح</button>
            </div>
        </div>
        <div id="rev-results"></div>
    `;
    await revSearch();
}

window.revClearSearch = function () {
    ['rev-no','rev-name','rev-from','rev-to'].forEach(id => { const el = document.getElementById(id); if (el) el.value=''; });
    revSearch();
};

window.revSearch = async function () {
    const resEl = document.getElementById('rev-results');
    resEl.innerHTML = '<div style="text-align:center;padding:30px;color:#64748B">⏳ جاري البحث...</div>';

    const no = document.getElementById('rev-no')?.value.trim();
    const name = document.getElementById('rev-name')?.value.trim();
    const from = document.getElementById('rev-from')?.value;
    const to = document.getElementById('rev-to')?.value;

    try {
        const table = revType === 'sales' ? 'sales' : 'purchases';
        const entityJoin = revType === 'sales' ? 'customers(name)' : 'suppliers(name)';
        let q = sb.from(table).select(`*, ${entityJoin}`).order('created_at', { ascending: false }).limit(60);
        if (no) q = q.ilike('invoice_no', `%${no}%`);
        if (from) q = q.gte('created_at', from);
        if (to) q = q.lte('created_at', to + 'T23:59:59');
        const { data, error } = await q;
        if (error) throw error;

        let rows = data || [];
        if (name) {
            const n = name.toLowerCase();
            rows = rows.filter(r => (r.customers?.name || r.suppliers?.name || '').toLowerCase().includes(n));
        }
        revList = rows;
        revRenderTable(rows);
    } catch (err) {
        resEl.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:16px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
};

function revRenderTable(rows) {
    const resEl = document.getElementById('rev-results');
    const fmt = n => (Number(n)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
    resEl.innerHTML = `
    <div class="dash-card" style="padding:0;overflow:hidden">
        <table class="dash-table">
            <thead><tr>
                <th>الرقم</th><th>${revType==='sales'?'العميل':'المورد'}</th><th>نوع الدفع</th>
                <th>التاريخ</th><th style="text-align:left">الإجمالي</th><th>الحالة</th><th></th>
            </tr></thead>
            <tbody>
                ${rows.length ? rows.map(r => `<tr>
                    <td><span style="background:#F1F5F9;padding:3px 8px;border-radius:5px;font-size:11px;font-family:monospace">${r.invoice_no}</span></td>
                    <td>${r.customers?.name || r.suppliers?.name || 'نقدي'}</td>
                    <td>${r.payment_type==='credit' ? '📋 آجل' : '💵 نقدي'}</td>
                    <td class="dash-muted">${new Date(r.created_at).toLocaleDateString('ar-EG')}</td>
                    <td style="text-align:left;font-weight:700">${fmt(r.total)}</td>
                    <td>${r.status==='confirmed' ? '<span style="color:#059669;font-weight:600">✅ مؤكدة</span>' : r.status==='cancelled' ? '<span style="color:#94A3B8">🚫 ملغاة (معدّلة)</span>' : `<span style="color:#D97706">${r.status}</span>`}</td>
                    <td style="white-space:nowrap">
                        <button class="cc-edit" onclick="revViewDetails('${r.id}')">👁️ عرض</button>
                        ${r.status==='confirmed' ? `<button class="cc-edit" style="background:#DBEAFE;color:#2563EB" onclick="revEditInvoice('${r.id}')">✏️ تعديل</button>` : ''}
                    </td>
                </tr>`).join('') : `<tr><td colspan="7" style="text-align:center;padding:24px;color:#94A3B8">لا توجد نتائج</td></tr>`}
            </tbody>
        </table>
    </div>`;
}

// ════════════════════════════════════════════════════════════
// عرض تفاصيل فاتورة في نافذة منبثقة
// ════════════════════════════════════════════════════════════
window.revViewDetails = async function (id) {
    const table = revType === 'sales' ? 'sales' : 'purchases';
    const itemsTable = revType === 'sales' ? 'sale_items' : 'purchase_items';
    const entityJoin = revType === 'sales' ? 'customers(name,phone)' : 'suppliers(name,phone)';
    const fmt = n => (Number(n)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

    const { data, error } = await sb.from(table).select(`*, ${entityJoin}, ${itemsTable}(*, products(name,code,unit))`).eq('id', id).maybeSingle();
    if (error || !data) { alert('تعذّر تحميل تفاصيل الفاتورة'); return; }

    const items = data[itemsTable] || [];
    const entity = data.customers || data.suppliers;

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'revModal';
    modal.innerHTML = `
    <div class="mod-modal" style="max-width:640px">
        <div class="mod-modal-header"><h3>${revType==='sales'?'🧾':'📥'} فاتورة ${data.invoice_no}</h3>
            <button class="mod-modal-close" onclick="document.getElementById('revModal').remove()">✕</button></div>
        <div class="mod-modal-body">
            <div style="display:flex;justify-content:space-between;margin-bottom:14px;font-size:13px;color:#475569">
                <span>${revType==='sales'?'العميل':'المورد'}: <strong>${entity?.name || 'نقدي'}</strong></span>
                <span>${new Date(data.created_at).toLocaleString('ar-EG')}</span>
            </div>
            <table class="dash-table">
                <thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th style="text-align:left">الإجمالي</th></tr></thead>
                <tbody>
                    ${items.map(it => `<tr>
                        <td>${it.products?.name || '—'}</td>
                        <td>${it.qty}</td>
                        <td>${fmt(it.unit_price)}</td>
                        <td style="text-align:left;font-weight:700">${fmt(it.line_total)}</td>
                    </tr>`).join('')}
                </tbody>
                <tfoot><tr style="background:#F8FAFC;font-weight:700">
                    <td colspan="3" style="padding:10px">الإجمالي النهائي</td>
                    <td style="text-align:left;padding:10px">${fmt(data.total)} ج.م</td>
                </tr></tfoot>
            </table>
        </div>
        <div class="mod-modal-footer">
            <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="document.getElementById('revModal').remove()">إغلاق</button>
            ${data.status==='confirmed' ? `<button class="mod-btn mod-btn-primary" onclick="document.getElementById('revModal').remove();revEditInvoice('${data.id}')">✏️ تعديل هذه الفاتورة</button>` : ''}
        </div>
    </div>`;
    document.body.appendChild(modal);
};

// ════════════════════════════════════════════════════════════
// الانتقال لشاشة الفاتورة في وضع التعديل
// ════════════════════════════════════════════════════════════
window.revEditInvoice = function (id) {
    if (revType === 'sales') {
        window._pendingSalesEdit = { id };
        document.querySelector('[data-mod="sales"]')?.click();
    } else {
        window._pendingPurchaseEdit = { id };
        document.querySelector('[data-mod="purchases"]')?.click();
    }
};

Object.assign(window, { renderInvoiceReview });
