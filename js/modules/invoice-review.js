/* ════════════════════════════════════════════════════════════
   مراجعة الفواتير + تعديلها — مبيعات / مشتريات / مرتجعات مبيعات / مرتجعات مشتريات
   يصدّر: renderInvoiceReview(container)

   "تعديل" هنا معناه: السجل القديم بيتلغي تلقائياً (مع إرجاع/عكس
   المخزون والرصيد عبر trigger أو RPC حسب النوع) وتتسجّل نسخة جديدة
   بالبيانات المعدّلة — حفاظاً على تتبع تاريخ التعديلات (audit trail)،
   بدل التعديل المباشر فوق نفس السجل. نفس الفلسفة لكل الأنواع الأربعة.

   4 أنواع (revType): 'sales' | 'purchase' | 'sales_return' | 'purchase_return'
   كل نوع معرّف في REV_CONFIG تحت — دي المكان الوحيد اللي بيفرّق بين
   الأنواع (اسم الجدول/جدول البنود/عمود الرقم/...إلخ)، والباقي (البحث،
   العرض، التعديل) شغال بنفس المنطق العام مبني على REV_CONFIG[revType].

   التعديل:
   - sales/purchase: بيودّي المستخدم لموديول sales.js/purchases.js
     (window._pendingSalesEdit / window._pendingPurchaseEdit — الموجودين
     أصلاً من قبل، بدون أي تغيير في المنطق ده).
   - sales_return/purchase_return: بيودّي المستخدم لموديول returns.js
     (window._pendingReturnEdit) اللي بيحمّل المرتجع القديم في وضع تعديل
     (retEditingId) — عند الحفظ بيتلغي القديم عبر RPC (راجع
     returns_edit_reversal_migration.sql) وتتسجّل نسخة جديدة.
   ════════════════════════════════════════════════════════════ */

const REV_CONFIG = {
    sales: {
        table: 'sales', itemsTable: 'sale_items', entityJoin: 'customers(name,phone)',
        noField: 'invoice_no', noPlaceholder: 'INV-0001', label: 'فاتورة مبيعات', icon: '🧾',
        entityLabel: 'العميل', hasPaymentType: true, canPrint: true, canEdit: true,
        editMod: 'sales', pendingFlag: '_pendingSalesEdit',
    },
    purchase: {
        table: 'purchases', itemsTable: 'purchase_items', entityJoin: 'suppliers(name,phone)',
        noField: 'invoice_no', noPlaceholder: 'PUR-0001', label: 'فاتورة مشتريات', icon: '📥',
        entityLabel: 'المورد', hasPaymentType: true, canPrint: false, canEdit: true,
        editMod: 'purchases', pendingFlag: '_pendingPurchaseEdit',
    },
    sales_return: {
        table: 'sales_returns', itemsTable: 'sale_return_items', entityJoin: 'customers(name,phone)',
        noField: 'return_no', noPlaceholder: 'RS-0001', label: 'مرتجع مبيعات', icon: '↩️',
        entityLabel: 'العميل', hasPaymentType: false, canPrint: true, canEdit: true,
        editMod: 'returns', pendingFlag: '_pendingReturnEdit',
    },
    purchase_return: {
        table: 'purchase_returns', itemsTable: 'purchase_return_items', entityJoin: 'suppliers(name,phone)',
        noField: 'return_no', noPlaceholder: 'RP-0001', label: 'مرتجع مشتريات', icon: '↩️',
        entityLabel: 'المورد', hasPaymentType: false, canPrint: false, canEdit: true,
        editMod: 'returns', pendingFlag: '_pendingReturnEdit',
    },
};
const REV_TYPES = ['sales', 'purchase', 'sales_return', 'purchase_return'];
const REV_TAB_LABELS = { sales: '🧾 فواتير المبيعات', purchase: '📥 فواتير المشتريات', sales_return: '↩️ مرتجعات المبيعات', purchase_return: '↩️ مرتجعات المشتريات' };

let revType = 'sales'; // 'sales' | 'purchase' | 'sales_return' | 'purchase_return'
let revList = [];

function revFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function revCfg() { return REV_CONFIG[revType]; }
function revIsReturn() { return revType === 'sales_return' || revType === 'purchase_return'; }

async function renderInvoiceReview(c) {
    revType = 'sales';
    c.innerHTML = `
    <div class="ob-wrap">
        <div class="dash-header">
            <div><h2 class="dash-title">🔍 مراجعة الفواتير والمرتجعات</h2>
            <p class="dash-sub">ابحث عن أي فاتورة أو مرتجع سابق، اعرض تفاصيله، أو عدّله</p></div>
        </div>
        <div class="ob-tabs">
            ${REV_TYPES.map((t, i) => `<button class="ob-tab ${i === 0 ? 'active' : ''}" onclick="revSwitchType('${t}')">${REV_TAB_LABELS[t]}</button>`).join('')}
        </div>
        <div id="rev-content" style="margin-top:16px"></div>
    </div>`;
    await revRenderBody();
}

window.revSwitchType = function (type) {
    revType = type;
    document.querySelectorAll('.ob-tabs .ob-tab').forEach((b, i) => b.classList.toggle('active', REV_TYPES[i] === type));
    revRenderBody();
};

async function revRenderBody() {
    const cfg = revCfg();
    const c = document.getElementById('rev-content');
    c.innerHTML = `
        <div class="dash-card" style="padding:16px 18px;margin-bottom:16px">
            <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
                <div><label class="ob-label">${revIsReturn() ? 'رقم المرتجع' : 'رقم الفاتورة'}</label><input id="rev-no" class="ob-input" style="margin:0;max-width:160px" dir="ltr" placeholder="${cfg.noPlaceholder}" onkeydown="if(event.key==='Enter')revSearch()"></div>
                <div><label class="ob-label">${cfg.entityLabel}</label><input id="rev-name" class="ob-input" style="margin:0;max-width:200px" placeholder="بحث بالاسم" onkeydown="if(event.key==='Enter')revSearch()"></div>
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
    const cfg = revCfg();
    const resEl = document.getElementById('rev-results');
    resEl.innerHTML = '<div style="text-align:center;padding:30px;color:#64748B">⏳ جاري البحث...</div>';

    const no = document.getElementById('rev-no')?.value.trim();
    const name = document.getElementById('rev-name')?.value.trim();
    const from = document.getElementById('rev-from')?.value;
    const to = document.getElementById('rev-to')?.value;

    try {
        let q = sb.from(cfg.table).select(`*, ${cfg.entityJoin}`).order('created_at', { ascending: false }).limit(60);
        if (no) q = q.ilike(cfg.noField, `%${no}%`);
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
        resEl.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:16px;border-radius:12px">خطأ: ${err.message}${revIsReturn() ? '<br><small>تأكد من تشغيل ملف returns_migration.sql في Supabase (جدول المرتجعات).</small>' : ''}</div>`;
    }
};

function revRenderTable(rows) {
    const cfg = revCfg();
    const resEl = document.getElementById('rev-results');
    resEl.innerHTML = `
    <div class="dash-card" style="padding:0;overflow:hidden">
        <table class="dash-table">
            <thead><tr>
                <th>الرقم</th><th>${cfg.entityLabel}</th><th>${cfg.hasPaymentType ? 'نوع الدفع' : 'مرتبط بفاتورة'}</th>
                <th>التاريخ</th><th style="text-align:left">الإجمالي</th><th>الحالة</th><th></th>
            </tr></thead>
            <tbody>
                ${rows.length ? rows.map(r => `<tr>
                    <td><span style="background:#F1F5F9;padding:3px 8px;border-radius:5px;font-size:11px;font-family:monospace">${r[cfg.noField]}</span></td>
                    <td>${r.customers?.name || r.suppliers?.name || 'نقدي'}</td>
                    <td>${cfg.hasPaymentType
                        ? (r.payment_type==='credit' ? '📋 آجل' : '💵 نقدي')
                        : (r.sale_id || r.purchase_id ? '<span style="color:#2563EB">🔗 نعم</span>' : '<span style="color:#94A3B8">مستقل</span>')}</td>
                    <td class="dash-muted">${new Date(r.created_at).toLocaleDateString('ar-EG')}</td>
                    <td style="text-align:left;font-weight:700${revIsReturn() ? ';color:#DC2626' : ''}">${revFmt(r.total)}</td>
                    <td>${r.status==='confirmed' ? '<span style="color:#059669;font-weight:600">✅ مؤكدة</span>' : r.status==='cancelled' ? '<span style="color:#94A3B8">🚫 ملغاة (معدّلة)</span>' : `<span style="color:#D97706">${r.status}</span>`}</td>
                    <td style="white-space:nowrap">
                        <button class="cc-edit" onclick="revViewDetails('${r.id}')">👁️ عرض</button>
                        ${cfg.canPrint ? `<button class="cc-edit" style="background:#ECFDF5;color:#059669" onclick="revPrintInvoice('${r.id}')">🖨️ طباعة</button>` : ''}
                        ${r.status==='confirmed' && cfg.canEdit ? `<button class="cc-edit" style="background:#FFFBEB;color:#D97706" onclick="revEditInvoice('${r.id}')">✏️ تعديل</button>` : ''}
                    </td>
                </tr>`).join('') : `<tr><td colspan="7" style="text-align:center;padding:24px;color:#94A3B8">لا توجد نتائج</td></tr>`}
            </tbody>
        </table>
    </div>`;
}

// ════════════════════════════════════════════════════════════
// عرض تفاصيل فاتورة/مرتجع في نافذة منبثقة
// ════════════════════════════════════════════════════════════
window.revViewDetails = async function (id) {
    const cfg = revCfg();
    const fmt = revFmt;

    const { data, error } = await sb.from(cfg.table).select(`*, ${cfg.entityJoin}, ${cfg.itemsTable}(*, products(name,code,unit))`).eq('id', id).maybeSingle();
    if (error || !data) { alert('تعذّر تحميل التفاصيل'); return; }

    const items = data[cfg.itemsTable] || [];
    const entity = data.customers || data.suppliers;

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'revModal';
    modal.innerHTML = `
    <div class="mod-modal" style="max-width:640px">
        <div class="mod-modal-header"><h3>${cfg.icon} ${cfg.label} ${data[cfg.noField]}</h3>
            <button class="mod-modal-close" onclick="document.getElementById('revModal').remove()">✕</button></div>
        <div class="mod-modal-body">
            <div style="display:flex;justify-content:space-between;margin-bottom:14px;font-size:13px;color:#475569">
                <span>${cfg.entityLabel}: <strong>${entity?.name || 'نقدي'}</strong></span>
                <span>${new Date(data.created_at).toLocaleString('ar-EG')}</span>
            </div>
            ${revIsReturn() && data.reason ? `<div style="background:#F8FAFC;border-radius:8px;padding:8px 12px;margin-bottom:12px;font-size:12.5px;color:#475569">📝 السبب: ${data.reason}</div>` : ''}
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
            ${cfg.canPrint ? `<button class="mod-btn" style="background:#ECFDF5;color:#059669" onclick="revPrintInvoice('${data.id}')">🖨️ طباعة</button>` : ''}
            ${data.status==='confirmed' && cfg.canEdit ? `<button class="mod-btn mod-btn-primary" onclick="document.getElementById('revModal').remove();revEditInvoice('${data.id}')">✏️ تعديل ${revIsReturn() ? 'هذا المرتجع' : 'هذه الفاتورة'}</button>` : ''}
        </div>
    </div>`;
    document.body.appendChild(modal);
};

// ════════════════════════════════════════════════════════════
// إعادة طباعة فاتورة مبيعات / مرتجع مبيعات سابق (نفس تصميم إيصال sales.js/returns.js الحراري)
// ★ فواتير/مرتجعات المشتريات مالهاش قالب طباعة حرارية أصلاً (خارج نطاق العمل
//   الحالي) — cfg.canPrint بيبقى false ليهم فالزرار مش بيظهر أصلاً.
// ════════════════════════════════════════════════════════════
window.revPrintInvoice = async function (id) {
    if (revType === 'sales') {
        const { data, error } = await sb.from('sales')
            .select('*, customers(name,phone,balance), sale_items(*, products(name,code,unit))')
            .eq('id', id).maybeSingle();
        if (error || !data) { alert('تعذّر تحميل الفاتورة للطباعة'); return; }

        const items = data.sale_items || [];
        const cust = data.customers;
        // "الرصيد الساري" في الإيصال معناه رصيد العميل *قبل* الفاتورة دي —
        // بما إننا بنعيد الطباعة بعد وقت (مش لحظة الحفظ)، أقرب تقدير متاح هو
        // الرصيد الحالي مطروح منه هذه الفاتورة لو كانت آجلة (مش دقيق 100%
        // لفواتير قديمة جداً حصل عليها حركة كتير بعدها، بس أفضل تقدير ممكن
        // من غير سجل تاريخي لرصيد العميل لحظة بلحظة).
        const previousBalance = cust ? (Number(cust.balance) || 0) - (data.payment_type === 'credit' ? (Number(data.total) || 0) : 0) : 0;

        await printThermalReceipt('sale', {
            invoiceNo: data.invoice_no,
            customerName: cust?.name || null,
            customerPhone: cust?.phone || null,
            paymentType: data.payment_type,
            items: items.map(it => ({ name: it.products?.name || it.unit_name || '—', qty: it.qty, unit_price: it.unit_price, line_total: it.line_total })),
            subtotal: data.subtotal, discount: data.discount, total: data.total,
            previousBalance,
        });
    } else if (revType === 'sales_return') {
        const { data, error } = await sb.from('sales_returns')
            .select('*, customers(name), sale:sale_id(invoice_no), sale_return_items(*, products(name,code,unit))')
            .eq('id', id).maybeSingle();
        if (error || !data) { alert('تعذّر تحميل المرتجع للطباعة'); return; }

        const items = data.sale_return_items || [];
        await printThermalReceipt('return', {
            returnNo: data.return_no,
            returnType: 'sales',
            entityName: data.customers?.name || null,
            linkedInvoiceNo: data.sale?.invoice_no || null,
            items: items.map(it => ({ name: it.products?.name || it.unit_name || '—', qty: it.qty, unit_price: it.unit_price, line_total: it.line_total })),
            total: data.total,
        });
    }
};

// ════════════════════════════════════════════════════════════
// الانتقال لشاشة الفاتورة/المرتجع في وضع التعديل
// ════════════════════════════════════════════════════════════
window.revEditInvoice = function (id) {
    const cfg = revCfg();
    window[cfg.pendingFlag] = revIsReturn() ? { id, type: revType } : { id };
    document.querySelector(`[data-mod="${cfg.editMod}"]`)?.click();
};

Object.assign(window, { renderInvoiceReview });
