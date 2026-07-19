/* ════════════════════════════════════════════════════════════
   ربط برنامج طلبات العملاء — customer-orders-review.js
   طلبات واردة من "سلطانو" (تطبيق طلب العملاء الخارجي) — كل طلب بيفضل
   "معلّق" لحد ما موظف في سلطان ERP يراجعه ويعتمده. الاعتماد بيفتح شاشة
   المبيعات العادية معبّاة بأصناف الطلب (نفس آلية تحويل عرض السعر في
   quotations.js) عشان يقدر يعدّل أي حاجة قبل الحفظ — الحفظ نفسه هو
   الاعتماد. الرفض بيقفل الطلب من غير ما يفتح فاتورة.

   تسجيل عملاء سلطانو الجدد بيستخدم نفس تبويب مراجعة طلبات المندوبين
   (rep-customer-requests.js) زي ما هو — الجدول (customer_change_requests)
   بيستحمل مصدرين (rep / sultano) من غير أي تعديل في الكود بتاعه.

   يصدّر: renderCustomerOrdersLink(container) — بيحل محل صفحة "قريباً"
   القديمة في coming-soon.js (نفس اسم الدالة المربوطة في app.js/index.html
   من الأول، فمفيش أي تعديل تاني مطلوب في الراوتر أو القائمة الجانبية)
   ════════════════════════════════════════════════════════════ */

let _corTab = 'orders'; // 'orders' | 'registrations'
let COR_ORDERS = [];

function corFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function renderCustomerOrdersLink(c) {
    c.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div><h2 style="font-size:22px;font-weight:800">🔗 ربط برنامج طلبات العملاء</h2>
        <p style="font-size:13px;color:#64748B;margin-top:4px">طلبات وتسجيلات واردة من "سلطانو" — كل حاجة بتفضل معلّقة لحد ما تراجعها وتعتمدها من هنا</p></div>
    </div>
    <div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap">
        <button class="mod-btn ${_corTab==='orders'?'mod-btn-primary':''}" onclick="corSwitchTab('orders')">📦 طلبات سلطانو</button>
        <button class="mod-btn ${_corTab==='registrations'?'mod-btn-primary':''}" onclick="corSwitchTab('registrations')">👤 تسجيل عملاء سلطانو</button>
    </div>
    <div id="corBody"></div>`;
    await corRenderTab();
}

async function corRenderTab() {
    const body = document.getElementById('corBody');
    if (!body) return;
    if (_corTab === 'orders') await corRenderOrders(body);
    else await renderRepCustomerRequests(body);
}

window.corSwitchTab = async function (tab) {
    _corTab = tab;
    await renderCustomerOrdersLink(document.getElementById('app-content'));
};

async function corRenderOrders(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل الطلبات...</div>';
    try {
        const { data, error } = await sb.from('customer_orders')
            .select('*, customers(name,phone,address), customer_order_items(*, products(name,code,unit))')
            .order('created_at', { ascending: false })
            .limit(150);
        if (error) throw error;
        COR_ORDERS = data || [];
        corRenderOrdersPage(c);
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function corRenderOrdersPage(c) {
    const pending = COR_ORDERS.filter(o => !o.converted_sale_id && o.status !== 'cancelled');
    const reviewed = COR_ORDERS.filter(o => o.converted_sale_id || o.status === 'cancelled').slice(0, 30);

    c.innerHTML = `
    ${pending.length ? `
    <div class="mod-table-wrap" style="margin-bottom:20px">
        <div style="padding:14px 18px 0;font-weight:800;font-size:14px;color:#1E293B">⏳ طلبات في انتظار المراجعة (${pending.length})</div>
        <table class="mod-table"><thead><tr>
            <th>رقم الطلب</th><th>العميل</th><th>الأصناف</th><th>الإجمالي</th><th>ملاحظات</th><th>التاريخ</th><th style="width:190px"></th>
        </tr></thead>
        <tbody>${pending.map(corRowHTML).join('')}</tbody></table>
    </div>` : `<div class="empty-state" style="margin-bottom:20px"><span>✅</span>مفيش طلبات سلطانو معلّقة دلوقتي</div>`}

    ${reviewed.length ? `
    <div class="mod-table-wrap">
        <div style="padding:14px 18px 0;font-weight:800;font-size:14px;color:#1E293B">📋 آخر الطلبات المراجَعة</div>
        <table class="mod-table"><thead><tr>
            <th>رقم الطلب</th><th>العميل</th><th>الإجمالي</th><th>الحالة</th><th>التاريخ</th>
        </tr></thead><tbody>
            ${reviewed.map(o => `<tr>
                <td>${o.order_no || '—'}</td>
                <td>${o.customers?.name || '—'}</td>
                <td>${corFmt(o.total)}</td>
                <td>${o.converted_sale_id ? '<span style="color:#059669;font-weight:700">✅ اتحوّلت لفاتورة</span>' : '<span style="color:#DC2626;font-weight:700">❌ مرفوض</span>'}</td>
                <td style="color:#64748B">${o.created_at ? new Date(o.created_at).toLocaleDateString('ar-EG') : '—'}</td>
            </tr>`).join('')}
        </tbody></table>
    </div>` : ''}`;
}

function corRowHTML(o) {
    const items = o.customer_order_items || [];
    const itemsSummary = items.map(it => `${it.products?.name || '—'} × ${corFmt(it.qty)}`).join('، ');
    return `<tr data-cor-id="${o.id}">
        <td>${o.order_no || '—'}</td>
        <td>${o.customers?.name || '—'}<div style="font-size:11px;color:#64748B" dir="ltr">${o.customers?.phone || ''}</div></td>
        <td style="font-size:12px;max-width:260px">${itemsSummary || '—'}</td>
        <td>${corFmt(o.total)}</td>
        <td style="font-size:12px;color:#64748B">${o.notes || '—'}</td>
        <td style="color:#64748B">${o.created_at ? new Date(o.created_at).toLocaleString('ar-EG') : '—'}</td>
        <td style="white-space:nowrap">
            <button class="cc-edit" style="background:#DCFCE7;color:#166534" onclick="corApproveOrder('${o.id}')">✅ اعتماد/مراجعة</button>
            <button class="cc-edit" style="background:#FEE2E2;color:#991B1B;margin-right:4px" onclick="corRejectOrder('${o.id}')">❌ رفض</button>
        </td>
    </tr>`;
}

window.corApproveOrder = function (id) {
    const o = COR_ORDERS.find(x => x.id === id);
    if (!o) return;
    const items = o.customer_order_items || [];
    if (!items.length) { alert('⚠️ الطلب ده مالوش أصناف'); return; }
    if (!confirm('سيتم فتح شاشة المبيعات مع تحميل أصناف الطلب تلقائياً. راجع الفاتورة (وعدّل أي حاجة لو محتاج) واحفظها من هناك — الحفظ هو الاعتماد. متابعة؟')) return;

    window._pendingQuoteConversion = {
        kind: 'order',
        quoteId: o.id,
        customerId: o.customer_id,
        items: items.map(it => ({
            pid: it.product_id, name: it.products?.name || '', code: it.products?.code || '',
            qty: Number(it.qty) || 0, price: Number(it.unit_price) || 0, disc: 0, free: 0,
            unit: it.products?.unit || '', stock: 0,
        })),
    };
    loadMod(document.querySelector('[data-mod="sales"]'), 'sales');
};

window.corRejectOrder = async function (id) {
    const reason = prompt('سبب الرفض (اختياري):', '') || null;
    if (!confirm('رفض الطلب ده؟')) return;
    try {
        const { error } = await sb.from('customer_orders').update({
            status: 'cancelled', reject_reason: reason,
            reviewed_by: currentUser?.id || null, reviewed_at: new Date().toISOString(),
        }).eq('id', id);
        if (error) throw error;
        corRenderOrders(document.getElementById('corBody') || document.getElementById('app-content'));
    } catch (err) {
        alert('خطأ أثناء الرفض: ' + err.message);
    }
};

Object.assign(window, { renderCustomerOrdersLink, corSwitchTab, corApproveOrder, corRejectOrder });
