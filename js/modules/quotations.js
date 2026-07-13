/* ════════════════════════════════════════════════════════════
   عروض الأسعار — quotations.js
   قائمة + إضافة عرض جديد + تحويل لفاتورة بيع فعلية
   يصدّر: renderQuotations(container)

   ★ قرار تصميم: التحويل لفاتورة بيع بيتم عن طريق تحميل الأصناف
   في شاشة المبيعات الفعلية (sales.js) وترك المستخدم يراجع
   ويحفظ من هناك — مش بإعادة كتابة منطق حفظ الفاتورة من الصفر.
   هذا يضمن استخدام نفس المحرك المالي المُختبر أصلاً بدون تكرار.
   ════════════════════════════════════════════════════════════ */

let _qtProducts = [];
let _qtCustomers = [];
let _qtItems = [];
let _qtCustId = null;
let _qtCounter = 1;

function qtFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
const QT_STATUS_LABELS = { pending: '⏳ قائم', converted: '✅ تم التحويل', expired: '⌛ منتهي', cancelled: '🚫 ملغي' };

// ════════════════════════════════════════════════════════════
// 1) العرض الرئيسي — قائمة عروض الأسعار
// ════════════════════════════════════════════════════════════
async function renderQuotations(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل عروض الأسعار...</div>';
    try {
        const { data: quotes } = await sb.from('quotations')
            .select('*, customers(name)').order('created_at', { ascending: false }).limit(100);

        c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px">
            <div><h2 style="font-size:22px;font-weight:800">📋 عروض الأسعار</h2>
            <p style="font-size:13px;color:#64748B;margin-top:4px">إنشاء عرض سعر، وتحويله لفاتورة بيع فعلية عند موافقة العميل</p></div>
            <button class="mod-btn mod-btn-primary" onclick="qtOpenAdd()">+ عرض سعر جديد</button>
        </div>

        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>الرقم</th><th>العميل</th><th>التاريخ</th><th style="text-align:left">الإجمالي</th><th>الحالة</th><th></th>
            </tr></thead><tbody>
                ${(quotes||[]).length ? quotes.map(q => `<tr>
                    <td><span style="background:#F1F5F9;padding:2px 8px;border-radius:5px;font-size:11px;font-family:monospace;direction:ltr;display:inline-block">${q.quote_no}</span></td>
                    <td>${q.customers?.name || 'بدون عميل'}</td>
                    <td class="dash-muted">${new Date(q.created_at).toLocaleDateString('ar-EG')}</td>
                    <td style="text-align:left;font-weight:700">${qtFmt(q.total)}</td>
                    <td>${QT_STATUS_LABELS[q.status]||q.status}</td>
                    <td>
                        ${q.status==='pending' ? `<button class="cc-edit" style="background:#D1FAE5;color:#059669" onclick="qtConvertToSale('${q.id}')">🔄 تحويل لفاتورة</button>
                        <button class="cc-edit" style="background:#FEE2E2;color:#DC2626" onclick="qtCancel('${q.id}')">🚫</button>` : ''}
                    </td>
                </tr>`).join('') : '<tr><td colspan="6" class="empty-state"><span>📋</span>لا توجد عروض أسعار بعد</td></tr>'}
            </tbody></table>
        </div>`;
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

// ════════════════════════════════════════════════════════════
// 2) إنشاء عرض سعر جديد
// ════════════════════════════════════════════════════════════
window.qtOpenAdd = async function() {
    const [{ data: products }, { data: customers }, { data: counterRow }] = await Promise.all([
        sb.from('products').select('*').eq('is_active', true).order('name'),
        sb.from('customers').select('*').order('name'),
        sb.from('app_settings').select('value').eq('key', 'quotation_counter').maybeSingle(),
    ]);
    _qtProducts = products || [];
    _qtCustomers = customers || [];
    _qtCounter = parseInt(counterRow?.value) || 1;
    _qtItems = [];
    _qtCustId = null;

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'qtModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:600px">
            <div class="mod-modal-header"><h3>📋 عرض سعر جديد — QT-${String(_qtCounter).padStart(4,'0')}</h3>
                <button class="mod-modal-close" onclick="document.getElementById('qtModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>العميل (اختياري)</label>
                    <select id="qtCustomer" class="mod-form-input">
                        <option value="">بدون عميل محدد</option>
                        ${_qtCustomers.map(cu=>`<option value="${cu.id}">${cu.name}</option>`).join('')}
                    </select></div>
                <div class="mod-form-group"><label>صالح حتى</label>
                    <input type="date" id="qtValidUntil" class="mod-form-input"></div>

                <div style="display:flex;gap:8px;margin:14px 0 8px">
                    <select id="qtProductSelect" class="mod-form-input" style="margin:0;flex:1">
                        <option value="">-- اختر صنفاً لإضافته --</option>
                        ${_qtProducts.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}
                    </select>
                    <button class="mod-btn mod-btn-primary" style="white-space:nowrap" onclick="qtAddItem()">+ إضافة</button>
                </div>

                <table class="dash-table" style="margin:0"><thead><tr>
                    <th>الصنف</th><th style="width:80px">الكمية</th><th style="width:90px">السعر</th><th style="width:90px">الإجمالي</th><th></th>
                </tr></thead><tbody id="qtItemsBody">
                    <tr><td colspan="5" style="text-align:center;color:#94A3B8;padding:16px">لم تُضف أصناف بعد</td></tr>
                </tbody></table>

                <div style="text-align left;margin-top:14px;font-size:16px;font-weight:800" id="qtTotal">الإجمالي: 0.00 ج.م</div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="document.getElementById('qtModal').remove()">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="qtSave()">💾 حفظ عرض السعر</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
};

window.qtAddItem = function() {
    const pid = document.getElementById('qtProductSelect').value;
    if (!pid) return;
    const p = _qtProducts.find(x=>x.id===pid);
    if (!p) return;
    const price = Number(p.wholesale_price || p.retail_price || p.purchase_price || 0);
    _qtItems.push({ product_id: p.id, name: p.name, qty: 1, unit_price: price });
    document.getElementById('qtProductSelect').value = '';
    qtRenderItems();
};

function qtRenderItems() {
    const tbody = document.getElementById('qtItemsBody');
    if (!_qtItems.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#94A3B8;padding:16px">لم تُضف أصناف بعد</td></tr>'; qtUpdateTotal(); return; }
    tbody.innerHTML = _qtItems.map((it, idx) => `<tr>
        <td>${it.name}</td>
        <td><input type="number" value="${it.qty}" min="0.001" step="0.001" style="width:70px;padding:5px" oninput="qtItems[${idx}].qty=parseFloat(this.value)||0;qtUpdateTotal()"></td>
        <td><input type="number" value="${it.unit_price}" min="0" step="0.01" style="width:80px;padding:5px" oninput="qtItems[${idx}].unit_price=parseFloat(this.value)||0;qtUpdateTotal()"></td>
        <td style="font-weight:700">${qtFmt(it.qty*it.unit_price)}</td>
        <td><button class="inv-del-btn" onclick="qtRemoveItem(${idx})">✕</button></td>
    </tr>`).join('');
    qtUpdateTotal();
}
window.qtItems = _qtItems; // للوصول من inline oninput
window.qtRemoveItem = function(idx) { _qtItems.splice(idx,1); window.qtItems = _qtItems; qtRenderItems(); };
window.qtUpdateTotal = function() {
    window.qtItems = _qtItems;
    const total = _qtItems.reduce((s,it)=>s+(it.qty*it.unit_price),0);
    const el = document.getElementById('qtTotal');
    if (el) el.textContent = 'الإجمالي: ' + qtFmt(total) + ' ج.م';
};

// ════════════════════════════════════════════════════════════
// 3) الحفظ
// ════════════════════════════════════════════════════════════
window.qtSave = async function() {
    if (!_qtItems.length) return alert('أضف صنفاً واحداً على الأقل');
    const customer_id = document.getElementById('qtCustomer').value || null;
    const valid_until = document.getElementById('qtValidUntil').value || null;
    const total = _qtItems.reduce((s,it)=>s+(it.qty*it.unit_price),0);
    const quote_no = 'QT-' + String(_qtCounter).padStart(4,'0');

    const btn = document.querySelector('#qtModal .mod-btn-primary');
    btn.innerText = '⏳ جاري الحفظ...'; btn.disabled = true;
    try {
        const { data: q, error } = await sb.from('quotations').insert({
            quote_no, customer_id, subtotal: total, discount: 0, total,
            valid_until, status: 'pending', created_by: currentUser?.id || null,
        }).select().single();
        if (error) throw error;

        const itemRows = _qtItems.map(it => ({
            quotation_id: q.id, product_id: it.product_id, qty: it.qty,
            unit_price: it.unit_price, line_total: it.qty * it.unit_price,
        }));
        const { error: itemsErr } = await sb.from('quotation_items').insert(itemRows);
        if (itemsErr) throw itemsErr;

        await sb.from('app_settings').upsert({ key: 'quotation_counter', value: String(_qtCounter + 1), updated_at: new Date().toISOString() });

        document.getElementById('qtModal').remove();
        renderQuotations(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ: ' + err.message);
        btn.innerText = '💾 حفظ عرض السعر'; btn.disabled = false;
    }
};

// ════════════════════════════════════════════════════════════
// 4) تحويل لفاتورة بيع فعلية — عبر شاشة المبيعات الموجودة
// ════════════════════════════════════════════════════════════
window.qtConvertToSale = async function(quoteId) {
    if (!confirm('سيتم فتح شاشة المبيعات مع تحميل أصناف العرض تلقائياً. راجع الفاتورة واحفظها من هناك. متابعة؟')) return;
    try {
        const { data: items } = await sb.from('quotation_items').select('*, products(*)').eq('quotation_id', quoteId);
        const { data: quote } = await sb.from('quotations').select('*').eq('id', quoteId).single();
        if (!items || !items.length) { alert('⚠️ لا توجد أصناف في هذا العرض'); return; }

        // ★ العرض بيفضل "قائم" لحد ما فاتورة البيع الفعلية تتحفظ بنجاح —
        //   sales.js هو اللي بيعلّمه "تم التحويل" بعد الحفظ، مش هنا. قبل
        //   كده كان بيتعلّم "تم التحويل" فوراً، فلو المستخدم قفل شاشة
        //   المبيعات من غير ما يحفظ، كان العرض بيفضل واقف على "تم
        //   التحويل" من غير ما فاتورة حقيقية تتسجّل.
        window._pendingQuoteConversion = {
            quoteId,
            customerId: quote.customer_id,
            items: items.map(it => ({
                pid: it.product_id, name: it.products?.name || '', code: it.products?.code || '',
                qty: it.qty, price: it.unit_price, disc: 0, free: 0,
                unit: it.products?.unit || '', stock: 0,
            })),
        };

        loadMod(document.querySelector('[data-mod="sales"]'), 'sales');
    } catch (err) { alert('❌ خطأ: ' + err.message); }
};

window.qtCancel = async function(id) {
    if (!confirm('إلغاء عرض السعر هذا؟')) return;
    try {
        await sb.from('quotations').update({ status: 'cancelled' }).eq('id', id);
        renderQuotations(document.getElementById('app-content'));
    } catch (err) { alert('❌ خطأ: ' + err.message); }
};

Object.assign(window, { renderQuotations, qtOpenAdd, qtAddItem, qtRemoveItem, qtUpdateTotal, qtSave, qtConvertToSale, qtCancel });
