/* ════════════════════════════════════════════════════════════
   أوامر الشراء — purchase-orders.js
   قائمة + إضافة أمر جديد + تحويل لفاتورة شراء فعلية
   يصدّر: renderPurchaseOrders(container)

   ★ نفس فلسفة quotations.js: التحويل لفاتورة شراء بيتم عن طريق
   تحميل الأصناف في شاشة المشتريات الفعلية (purchases.js) بدل
   إعادة كتابة منطق الحفظ من الصفر.
   ════════════════════════════════════════════════════════════ */

let _poProducts = [];
let _poSuppliers = [];
let _poItems = [];
let _poCounter = 1;

function poFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
const PO_STATUS_LABELS = { pending: '⏳ قائم', received: '✅ تم الاستلام', cancelled: '🚫 ملغي' };

// ════════════════════════════════════════════════════════════
// 1) العرض الرئيسي — قائمة أوامر الشراء
// ════════════════════════════════════════════════════════════
async function renderPurchaseOrders(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل أوامر الشراء...</div>';
    try {
        const { data: orders } = await sb.from('purchase_orders')
            .select('*, suppliers(name)').order('created_at', { ascending: false }).limit(100);

        c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px">
            <div><h2 style="font-size:22px;font-weight:800">📋 أوامر الشراء</h2>
            <p style="font-size:13px;color:#64748B;margin-top:4px">تسجيل ما تم طلبه من المورد قبل وصول البضاعة فعلياً</p></div>
            <button class="mod-btn mod-btn-primary" onclick="poOpenAdd()">+ أمر شراء جديد</button>
        </div>

        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>الرقم</th><th>المورد</th><th>تاريخ التوقع</th><th style="text-align:left">الإجمالي</th><th>الحالة</th><th></th>
            </tr></thead><tbody>
                ${(orders||[]).length ? orders.map(o => `<tr>
                    <td><span style="background:#F1F5F9;padding:2px 8px;border-radius:5px;font-size:11px;font-family:monospace;direction:ltr;display:inline-block">${o.order_no}</span></td>
                    <td>${o.suppliers?.name || 'بدون مورد'}</td>
                    <td class="dash-muted">${o.expected_date ? new Date(o.expected_date).toLocaleDateString('ar-EG') : '—'}</td>
                    <td style="text-align:left;font-weight:700">${poFmt(o.total)}</td>
                    <td>${PO_STATUS_LABELS[o.status]||o.status}</td>
                    <td>
                        ${o.status==='pending' ? `<button class="cc-edit" style="background:#D1FAE5;color:#059669" onclick="poConvertToPurchase('${o.id}')">🔄 تحويل لفاتورة</button>
                        <button class="cc-edit" style="background:#FEE2E2;color:#DC2626" onclick="poCancel('${o.id}')">🚫</button>` : ''}
                    </td>
                </tr>`).join('') : '<tr><td colspan="6" class="empty-state"><span>📋</span>لا توجد أوامر شراء بعد</td></tr>'}
            </tbody></table>
        </div>`;
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

// ════════════════════════════════════════════════════════════
// 2) إنشاء أمر شراء جديد
// ════════════════════════════════════════════════════════════
window.poOpenAdd = async function() {
    const [{ data: products }, { data: suppliers }, { data: counterRow }] = await Promise.all([
        sb.from('products').select('*').eq('is_active', true).order('name'),
        sb.from('suppliers').select('*').order('name'),
        sb.from('app_settings').select('value').eq('key', 'purchase_order_counter').maybeSingle(),
    ]);
    _poProducts = products || [];
    _poSuppliers = suppliers || [];
    _poCounter = parseInt(counterRow?.value) || 1;
    _poItems = [];

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'poModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:600px">
            <div class="mod-modal-header"><h3>📋 أمر شراء جديد — PO-${String(_poCounter).padStart(4,'0')}</h3>
                <button class="mod-modal-close" onclick="document.getElementById('poModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>المورد</label>
                    <select id="poSupplier" class="mod-form-input">
                        <option value="">-- اختر المورد --</option>
                        ${_poSuppliers.map(s=>`<option value="${s.id}">${s.name}</option>`).join('')}
                    </select></div>
                <div class="mod-form-group"><label>تاريخ التوريد المتوقع</label>
                    <input type="date" id="poExpectedDate" class="mod-form-input"></div>

                <div style="display:flex;gap:8px;margin:14px 0 8px">
                    <select id="poProductSelect" class="mod-form-input" style="margin:0;flex:1">
                        <option value="">-- اختر صنفاً لإضافته --</option>
                        ${_poProducts.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}
                    </select>
                    <button class="mod-btn mod-btn-primary" style="white-space:nowrap" onclick="poAddItem()">+ إضافة</button>
                </div>

                <table class="dash-table" style="margin:0"><thead><tr>
                    <th>الصنف</th><th style="width:80px">الكمية</th><th style="width:90px">سعر الشراء</th><th style="width:90px">الإجمالي</th><th></th>
                </tr></thead><tbody id="poItemsBody">
                    <tr><td colspan="5" style="text-align:center;color:#94A3B8;padding:16px">لم تُضف أصناف بعد</td></tr>
                </tbody></table>

                <div style="text-align:left;margin-top:14px;font-size:16px;font-weight:800" id="poTotal">الإجمالي: 0.00 ج.م</div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="document.getElementById('poModal').remove()">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="poSave()">💾 حفظ أمر الشراء</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
};

window.poAddItem = function() {
    const pid = document.getElementById('poProductSelect').value;
    if (!pid) return;
    const p = _poProducts.find(x=>x.id===pid);
    if (!p) return;
    const price = Number(p.purchase_price || 0);
    _poItems.push({ product_id: p.id, name: p.name, qty: 1, unit_price: price });
    document.getElementById('poProductSelect').value = '';
    poRenderItems();
};

function poRenderItems() {
    const tbody = document.getElementById('poItemsBody');
    if (!_poItems.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#94A3B8;padding:16px">لم تُضف أصناف بعد</td></tr>'; poUpdateTotal(); return; }
    tbody.innerHTML = _poItems.map((it, idx) => `<tr>
        <td>${it.name}</td>
        <td><input type="number" value="${it.qty}" min="0.001" step="0.001" style="width:70px;padding:5px" oninput="poItems[${idx}].qty=parseFloat(this.value)||0;poUpdateTotal()"></td>
        <td><input type="number" value="${it.unit_price}" min="0" step="0.01" style="width:80px;padding:5px" oninput="poItems[${idx}].unit_price=parseFloat(this.value)||0;poUpdateTotal()"></td>
        <td style="font-weight:700">${poFmt(it.qty*it.unit_price)}</td>
        <td><button class="inv-del-btn" onclick="poRemoveItem(${idx})">✕</button></td>
    </tr>`).join('');
    poUpdateTotal();
}
window.poItems = _poItems; // للوصول من inline oninput
window.poRemoveItem = function(idx) { _poItems.splice(idx,1); window.poItems = _poItems; poRenderItems(); };
window.poUpdateTotal = function() {
    window.poItems = _poItems;
    const total = _poItems.reduce((s,it)=>s+(it.qty*it.unit_price),0);
    const el = document.getElementById('poTotal');
    if (el) el.textContent = 'الإجمالي: ' + poFmt(total) + ' ج.م';
};

// ════════════════════════════════════════════════════════════
// 3) الحفظ
// ════════════════════════════════════════════════════════════
window.poSave = async function() {
    if (!_poItems.length) return alert('أضف صنفاً واحداً على الأقل');
    const supplier_id = document.getElementById('poSupplier').value || null;
    const expected_date = document.getElementById('poExpectedDate').value || null;
    const total = _poItems.reduce((s,it)=>s+(it.qty*it.unit_price),0);
    const order_no = 'PO-' + String(_poCounter).padStart(4,'0');

    const btn = document.querySelector('#poModal .mod-btn-primary');
    btn.innerText = '⏳ جاري الحفظ...'; btn.disabled = true;
    try {
        const { data: o, error } = await sb.from('purchase_orders').insert({
            order_no, supplier_id, subtotal: total, total,
            expected_date, status: 'pending', created_by: currentUser?.id || null,
        }).select().single();
        if (error) throw error;

        const itemRows = _poItems.map(it => ({
            order_id: o.id, product_id: it.product_id, qty: it.qty,
            unit_price: it.unit_price, line_total: it.qty * it.unit_price,
        }));
        const { error: itemsErr } = await sb.from('purchase_order_items').insert(itemRows);
        if (itemsErr) throw itemsErr;

        await sb.from('app_settings').upsert({ key: 'purchase_order_counter', value: String(_poCounter + 1), updated_at: new Date().toISOString() });

        document.getElementById('poModal').remove();
        renderPurchaseOrders(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ: ' + err.message);
        btn.innerText = '💾 حفظ أمر الشراء'; btn.disabled = false;
    }
};

// ════════════════════════════════════════════════════════════
// 4) تحويل لفاتورة شراء فعلية — عبر شاشة المشتريات الموجودة
// ════════════════════════════════════════════════════════════
window.poConvertToPurchase = async function(orderId) {
    if (!confirm('سيتم فتح شاشة المشتريات مع تحميل أصناف الأمر تلقائياً. راجع الفاتورة واحفظها من هناك. متابعة؟')) return;
    try {
        const { data: items } = await sb.from('purchase_order_items').select('*, products(*)').eq('order_id', orderId);
        const { data: order } = await sb.from('purchase_orders').select('*').eq('id', orderId).single();
        if (!items || !items.length) { alert('⚠️ لا توجد أصناف في هذا الأمر'); return; }

        window._pendingPOConversion = {
            supplierId: order.supplier_id,
            items: items.map(it => ({
                pid: it.product_id, name: it.products?.name || '', code: it.products?.code || '',
                qty: it.qty, price: it.unit_price, disc: 0, free: 0,
                unit: it.products?.unit || '', upc: it.products?.units_per_carton || 1,
                deferredRate: 0, deferredDate: '',
            })),
        };

        await sb.from('purchase_orders').update({ status: 'received' }).eq('id', orderId);
        loadMod(document.querySelector('[data-mod="purchases"]'), 'purchases');
    } catch (err) { alert('❌ خطأ: ' + err.message); }
};

window.poCancel = async function(id) {
    if (!confirm('إلغاء أمر الشراء هذا؟')) return;
    try {
        await sb.from('purchase_orders').update({ status: 'cancelled' }).eq('id', id);
        renderPurchaseOrders(document.getElementById('app-content'));
    } catch (err) { alert('❌ خطأ: ' + err.message); }
};

Object.assign(window, { renderPurchaseOrders, poOpenAdd, poAddItem, poRemoveItem, poUpdateTotal, poSave, poConvertToPurchase, poCancel });
