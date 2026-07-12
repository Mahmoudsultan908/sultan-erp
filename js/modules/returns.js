/* ════════════════════════════════════════════════════════════
   المرتجعات — مرتجع مبيعات + مرتجع مشتريات
   يصدّر: renderReturns(container)

   الجداول: sales_returns / sale_return_items
            purchase_returns / purchase_return_items
   ⚠️ الجداول والـ Trigger الخاص بتحديث المخزون ورصيد العميل/المورد
   يجب إنشاؤها في Supabase أولاً (راجع ملف returns_migration.sql المرفق).
   نفس فلسفة customer_payments في collections.js: الواجهة بتعمل
   INSERT فقط، والـ Trigger في قاعدة البيانات هو اللي بيحرّك
   المخزون والأرصدة والقيد المحاسبي تلقائياً.
   ════════════════════════════════════════════════════════════ */

let RET_DB = { customers: [], suppliers: [], products: [], warehouses: [], list: [] };
let retType = 'sales';      // 'sales' | 'purchase'
let retMode = 'linked';     // 'linked' (مرتبط بفاتورة) | 'manual' (مستقل)
let retLinkedDoc = null;    // الفاتورة الأصلية لو في وضع linked
let retEntityId = null;     // customer_id أو supplier_id
let retWarehouseId = null;
let retItems = [];          // { id, pid, name, code, unit, qty, price, disc, maxQty }
let retTableMissing = false;

// ════════════════════════════════════════════════════════════
// 1) التقديم الرئيسي
// ════════════════════════════════════════════════════════════
async function renderReturns(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات المرتجعات...</div>';
    try {
        const [{ data: customers }, { data: suppliers }, { data: products }, { data: warehouses }] = await Promise.all([
            sb.from('customers').select('id,name,balance').eq('is_active', true).order('name'),
            sb.from('suppliers').select('id,name,balance').eq('is_active', true).order('name'),
            sb.from('products').select('id,name,code,unit,wholesale_price,retail_price,purchase_price').eq('is_active', true).order('name'),
            sb.from('warehouses').select('id,name,is_main').order('name'),
        ]);
        RET_DB.customers = customers || [];
        RET_DB.suppliers = suppliers || [];
        RET_DB.products = products || [];
        RET_DB.warehouses = warehouses || [];

        // إعادة ضبط الحالة
        retMode = 'linked'; retLinkedDoc = null; retEntityId = null; retItems = [];
        const mainWh = RET_DB.warehouses.find(w => w.is_main) || RET_DB.warehouses[0];
        retWarehouseId = mainWh?.id || null;

        c.innerHTML = `
        <div class="ob-wrap">
            <div class="dash-header">
                <div><h2 class="dash-title">↩️ المرتجعات</h2>
                <p class="dash-sub">تسجيل مرتجعات المبيعات والمشتريات — مرتبطة بفاتورة أو مستقلة</p></div>
            </div>
            <div class="ob-tabs">
                <button class="ob-tab ${retType==='sales'?'active':''}" onclick="retSwitchType('sales', this)">↩️ مرتجع مبيعات</button>
                <button class="ob-tab ${retType==='purchase'?'active':''}" onclick="retSwitchType('purchase', this)">↩️ مرتجع مشتريات</button>
            </div>
            <div id="ret-content" style="margin-top:16px"></div>
        </div>`;

        await retRenderBody();
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ في تحميل البيانات: ${err.message}</div>`;
    }
}

window.retSwitchType = function (type, btn) {
    retType = type;
    retMode = 'linked'; retLinkedDoc = null; retEntityId = null; retItems = [];
    const container = (btn && btn.closest('.ob-tabs')) || document.querySelectorAll('.ob-wrap > .ob-tabs')[0];
    container?.querySelectorAll('.ob-tab').forEach(b => b.classList.remove('active'));
    (btn || container?.querySelector(`.ob-tab:nth-child(${type === 'sales' ? 1 : 2})`))?.classList.add('active');
    retRenderBody();
};

// ════════════════════════════════════════════════════════════
// 2) جسم الشاشة: نموذج الإضافة + قائمة المرتجعات الأخيرة
// ════════════════════════════════════════════════════════════
async function retRenderBody() {
    const c = document.getElementById('ret-content');
    if (!c) return;
    c.innerHTML = '<div style="text-align:center;padding:30px;color:#64748B">⏳ جاري التحميل...</div>';

    const table = retType === 'sales' ? 'sales_returns' : 'purchase_returns';
    const entityJoin = retType === 'sales' ? 'customers(name)' : 'suppliers(name)';
    let list = [];
    retTableMissing = false;
    try {
        const { data, error } = await sb.from(table).select(`*, ${entityJoin}`).order('created_at', { ascending: false }).limit(30);
        if (error) throw error;
        list = data || [];
    } catch (e) {
        retTableMissing = true; // الجدول لسه ما اتعملش في Supabase
    }
    RET_DB.list = list;

    c.innerHTML = `
        ${retTableMissing ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:12px 16px;border-radius:10px;margin-bottom:16px;font-size:12px">
            ⚠️ <strong>تنبيه:</strong> جدول <code>${table}</code> أو جدول البنود المرتبط به غير مكتمل في قاعدة البيانات بعد.
            شغّل ملف <code>returns_migration.sql</code> في Supabase أولاً حتى تتحرّك المخازن والأرصدة تلقائياً.
        </div>` : ''}

        <div class="dash-card" style="padding:20px;margin-bottom:16px">
            <div class="ob-tabs" style="border-bottom:none;margin-bottom:12px">
                <button class="ob-tab ${retMode==='linked'?'active':''}" onclick="retSwitchMode('linked', this)">🔗 مرتبط بفاتورة (افتراضي)</button>
                <button class="ob-tab ${retMode==='manual'?'active':''}" onclick="retSwitchMode('manual', this)">✍️ مستقل (بدون فاتورة)</button>
            </div>
            <div id="ret-form"></div>
        </div>

        <div class="dash-card" style="padding:0;overflow:hidden">
            <div class="dash-card-header" style="padding:16px 18px 0">📋 آخر ${retType==='sales'?'مرتجعات المبيعات':'مرتجعات المشتريات'}</div>
            <table class="dash-table">
                <thead><tr><th>الرقم</th><th>${retType==='sales'?'العميل':'المورد'}</th><th>مرتبط بفاتورة</th><th>التاريخ</th><th style="text-align:left">الإجمالي</th></tr></thead>
                <tbody>
                    ${list.length ? list.map(r => `<tr>
                        <td><span style="background:#F1F5F9;padding:3px 8px;border-radius:5px;font-size:11px;font-family:monospace">${r.return_no || '—'}</span></td>
                        <td>${r.customers?.name || r.suppliers?.name || '—'}</td>
                        <td>${r.sale_id || r.purchase_id ? '<span style="color:#2563EB">🔗 نعم</span>' : '<span style="color:#94A3B8">مستقل</span>'}</td>
                        <td class="dash-muted">${new Date(r.created_at).toLocaleDateString('ar-EG')}</td>
                        <td style="text-align:left;font-weight:700;color:#DC2626">${retFmt(r.total)}</td>
                    </tr>`).join('') : `<tr><td colspan="5" style="text-align:center;padding:20px;color:#94A3B8">لا توجد مرتجعات بعد</td></tr>`}
                </tbody>
            </table>
        </div>
    `;
    retRenderForm();
}

window.retSwitchMode = function (mode, btn) {
    retMode = mode;
    retLinkedDoc = null; retEntityId = null; retItems = [];
    const container = (btn && btn.closest('.ob-tabs')) || document.querySelector('#ret-content .ob-tabs');
    container?.querySelectorAll('.ob-tab').forEach(b => b.classList.remove('active'));
    (btn || container?.querySelector(`.ob-tab:nth-child(${mode === 'linked' ? 1 : 2})`))?.classList.add('active');
    retRenderForm();
};

// ════════════════════════════════════════════════════════════
// 3) نموذج الإضافة (يتغيّر حسب الوضع)
// ════════════════════════════════════════════════════════════
function retRenderForm() {
    const f = document.getElementById('ret-form');
    if (!f) return;
    const entityLabel = retType === 'sales' ? 'العميل' : 'المورد';
    const entityList = retType === 'sales' ? RET_DB.customers : RET_DB.suppliers;

    f.innerHTML = `
        ${retMode === 'linked' ? `
        <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin-bottom:10px">
            <div style="min-width:220px"><label class="ob-label">رقم الفاتورة (${retType==='sales'?'مثال INV-0012':'مثال PUR-0012'})</label>
                <input type="text" id="ret-inv-no" class="ob-input" style="margin:0" dir="ltr" placeholder="${retType==='sales'?'INV-0001':'PUR-0001'}" onkeydown="if(event.key==='Enter')retSearchInvoice()"></div>
            <button class="ob-add-btn" onclick="retSearchInvoice()">🔍 بحث</button>
        </div>
        <div id="ret-linked-info"></div>
        ` : `
        <div style="margin-bottom:10px">
            <label class="ob-label">${entityLabel}</label>
            <select id="ret-entity" class="ob-input" style="margin:0;max-width:320px" onchange="retOnEntityChange()">
                <option value="">-- بدون (زبون/مورد نقدي) --</option>
                ${entityList.map(e => `<option value="${e.id}" ${e.id===retEntityId?'selected':''}>${e.name}</option>`).join('')}
            </select>
        </div>
        `}
        <div id="ret-items-wrap">${retItemsTableHTML()}</div>
        ${retMode === 'manual' ? `<button class="ob-add-btn" style="margin-top:8px" onclick="retAddManualRow()">+ إضافة صنف</button>` : ''}

        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;flex-wrap:wrap;gap:10px">
            <div><label class="ob-label" style="margin:0 0 5px">ملاحظات / سبب المرتجع</label>
                <input type="text" id="ret-notes" class="ob-input" style="margin:0;min-width:260px" placeholder="اختياري"></div>
            <div style="text-align:left">
                <div style="font-size:12px;color:#64748B">إجمالي المرتجع</div>
                <div id="ret-total" style="font-size:22px;font-weight:800;color:#DC2626">${retFmt(retCalcTotal())} ج.م</div>
            </div>
        </div>
        <button class="ob-save-btn" onclick="retSave()">💾 حفظ المرتجع</button>
    `;
}

// ════════════════════════════════════════════════════════════
// 4) وضع "مرتبط بفاتورة": البحث عن الفاتورة وتحميل بنودها
// ════════════════════════════════════════════════════════════
window.retSearchInvoice = async function () {
    const no = document.getElementById('ret-inv-no')?.value.trim();
    const info = document.getElementById('ret-linked-info');
    if (!no) { alert('أدخل رقم الفاتورة'); return; }
    info.innerHTML = '<div style="padding:10px;color:#64748B;font-size:12px">⏳ جاري البحث...</div>';

    try {
        if (retType === 'sales') {
            const { data, error } = await sb.from('sales')
                .select('*, sale_items(*, products(name,code,unit)), customers(name)')
                .eq('invoice_no', no).maybeSingle();
            if (error) throw error;
            if (!data) { info.innerHTML = `<div style="color:#DC2626;font-size:12px;padding:6px 0">❌ لا توجد فاتورة بيع بهذا الرقم</div>`; retItems = []; retLinkedDoc = null; retRenderItemsWrap(); return; }
            retLinkedDoc = data;
            retEntityId = data.customer_id;
            retWarehouseId = data.warehouse_id || retWarehouseId;
            retItems = (data.sale_items || []).map(it => ({
                id: it.id, pid: it.product_id,
                name: it.products?.name || '—', code: it.products?.code || '',
                unit: it.products?.unit || it.unit_name || 'قطعة',
                qty: Number(it.qty) || 0, maxQty: Number(it.qty) || 0,
                price: Number(it.unit_price) || 0, disc: Number(it.discount_pct) || 0,
            }));
            info.innerHTML = `<div style="background:#EFF6FF;color:#1E40AF;padding:8px 12px;border-radius:8px;font-size:12.5px;margin-bottom:6px">
                ✅ الفاتورة <strong>${data.invoice_no}</strong> — العميل: ${data.customers?.name || 'نقدي'} — الإجمالي: ${retFmt(data.total)} ج.م
                <br><span style="color:#64748B">عدّل الكمية المرتجعة لكل صنف (بحد أقصى الكمية الأصلية بالفاتورة)</span></div>`;
        } else {
            const { data, error } = await sb.from('purchases')
                .select('*, purchase_items(*, products(name,code,unit)), suppliers(name)')
                .eq('invoice_no', no).maybeSingle();
            if (error) throw error;
            if (!data) { info.innerHTML = `<div style="color:#DC2626;font-size:12px;padding:6px 0">❌ لا توجد فاتورة شراء بهذا الرقم</div>`; retItems = []; retLinkedDoc = null; retRenderItemsWrap(); return; }
            retLinkedDoc = data;
            retEntityId = data.supplier_id;
            retWarehouseId = data.warehouse_id || retWarehouseId;
            retItems = (data.purchase_items || []).map(it => ({
                id: it.id, pid: it.product_id,
                name: it.products?.name || '—', code: it.products?.code || '',
                unit: it.products?.unit || 'قطعة',
                qty: Number(it.qty) || 0, maxQty: Number(it.qty) || 0,
                price: Number(it.unit_price) || 0, disc: 0,
            }));
            info.innerHTML = `<div style="background:#EFF6FF;color:#1E40AF;padding:8px 12px;border-radius:8px;font-size:12.5px;margin-bottom:6px">
                ✅ الفاتورة <strong>${data.invoice_no}</strong> — المورد: ${data.suppliers?.name || 'نقدي'} — الإجمالي: ${retFmt(data.total)} ج.م
                <br><span style="color:#64748B">عدّل الكمية المرتجعة لكل صنف (بحد أقصى الكمية الأصلية بالفاتورة)</span></div>`;
        }
        retRenderItemsWrap();
    } catch (err) {
        info.innerHTML = `<div style="color:#DC2626;font-size:12px">خطأ: ${err.message}</div>`;
    }
};

// ════════════════════════════════════════════════════════════
// 5) وضع "مستقل": اختيار جهة + إضافة أصناف يدوياً
// ════════════════════════════════════════════════════════════
window.retOnEntityChange = function () {
    retEntityId = document.getElementById('ret-entity')?.value || null;
};

window.retAddManualRow = function () {
    retItems.push({ id: Date.now() + Math.random(), pid: null, name: '', code: '', unit: 'قطعة', qty: 1, price: 0, disc: 0, maxQty: null });
    retRenderItemsWrap();
};

window.retRemoveRow = function (id) {
    retItems = retItems.filter(i => i.id != id);
    retRenderItemsWrap();
};

window.retPickProduct = function (rowId, pid) {
    const row = retItems.find(i => i.id == rowId);
    const p = RET_DB.products.find(x => x.id === pid);
    if (!row || !p) return;
    row.pid = p.id; row.name = p.name; row.code = p.code; row.unit = p.unit || 'قطعة';
    row.price = retType === 'sales' ? (Number(p.wholesale_price) || Number(p.retail_price) || 0) : (Number(p.purchase_price) || 0);
    retRenderItemsWrap();
};

window.retUpdateRow = function (id, field, value) {
    const row = retItems.find(i => i.id == id);
    if (!row) return;
    if (field === 'qty' || field === 'price' || field === 'disc') {
        let v = parseFloat(value) || 0;
        if (field === 'qty' && row.maxQty != null && v > row.maxQty) { v = row.maxQty; alert(`أقصى كمية قابلة للإرجاع لهذا الصنف: ${row.maxQty}`); }
        row[field] = v;
    }
    retRenderItemsWrap();
};

function retRenderItemsWrap() {
    document.getElementById('ret-items-wrap').innerHTML = retItemsTableHTML();
    const totalEl = document.getElementById('ret-total');
    if (totalEl) totalEl.textContent = retFmt(retCalcTotal()) + ' ج.م';
}

function retItemsTableHTML() {
    if (!retItems.length) {
        return `<div style="text-align:center;padding:24px;color:#94A3B8;font-size:13px;border:1.5px dashed #E2E8F0;border-radius:10px">
            ${retMode === 'linked' ? 'ابحث برقم الفاتورة لعرض أصنافها' : 'اضغط "إضافة صنف" لبدء تسجيل المرتجع'}</div>`;
    }
    return `
    <table class="dash-table" style="border:1px solid #F1F5F9;border-radius:10px;overflow:hidden">
        <thead><tr>
            <th>الصنف</th><th style="width:90px">الكمية</th><th style="width:100px">السعر</th><th style="width:70px">خصم%</th><th style="width:110px">الإجمالي</th><th style="width:40px"></th>
        </tr></thead>
        <tbody>
            ${retItems.map(it => `
            <tr>
                <td>${retMode === 'manual' ? `
                    <select class="ob-input" style="margin:0" onchange="retPickProduct('${it.id}', this.value)">
                        <option value="">-- اختر صنفاً --</option>
                        ${RET_DB.products.map(p => `<option value="${p.id}" ${p.id===it.pid?'selected':''}>${p.name}</option>`).join('')}
                    </select>` : `<strong>${it.name}</strong> ${it.code?`<span style="color:#94A3B8;font-size:11px">(${it.code})</span>`:''}`}
                </td>
                <td><input type="number" class="ob-input" style="margin:0" min="0" ${it.maxQty!=null?`max="${it.maxQty}"`:''} step="0.01" value="${it.qty}" onchange="retUpdateRow('${it.id}','qty',this.value)"></td>
                <td><input type="number" class="ob-input" style="margin:0" min="0" step="0.01" value="${it.price}" onchange="retUpdateRow('${it.id}','price',this.value)"></td>
                <td><input type="number" class="ob-input" style="margin:0" min="0" max="100" step="1" value="${it.disc}" onchange="retUpdateRow('${it.id}','disc',this.value)"></td>
                <td style="font-weight:700">${retFmt((it.qty||0)*(it.price||0)*(1-(it.disc||0)/100))}</td>
                <td>${retMode==='manual' ? `<button class="cc-edit" style="background:#FEE2E2;color:#DC2626" onclick="retRemoveRow('${it.id}')">✕</button>` : ''}</td>
            </tr>`).join('')}
        </tbody>
    </table>`;
}

function retCalcTotal() {
    return retItems.reduce((s, it) => s + (it.qty || 0) * (it.price || 0) * (1 - (it.disc || 0) / 100), 0);
}

// ════════════════════════════════════════════════════════════
// 6) الحفظ — INSERT فقط (الـ Trigger يتكفّل بالمخزون/الأرصدة)
// ════════════════════════════════════════════════════════════
window.retSave = async function () {
    const filled = retItems.filter(it => it.pid && (it.qty || 0) > 0);
    if (!filled.length) { alert('أضف صنفاً واحداً على الأقل بكمية أكبر من صفر'); return; }

    const notes = document.getElementById('ret-notes')?.value.trim() || null;
    const total = retCalcTotal();
    const subtotal = filled.reduce((s, it) => s + (it.qty || 0) * (it.price || 0), 0);
    const btn = document.querySelector('.ob-save-btn');
    if (btn) { btn.textContent = '⏳ جاري الحفظ...'; btn.disabled = true; }

    try {
        const counterKey = retType === 'sales' ? 'sales_return_counter' : 'purchase_return_counter';
        const prefix = retType === 'sales' ? 'RS' : 'RP';
        const { data: counterRow } = await sb.from('app_settings').select('value').eq('key', counterKey).maybeSingle();
        const counter = parseInt(counterRow?.value) || 1;
        const returnNo = prefix + '-' + String(counter).padStart(4, '0');

        if (retType === 'sales') {
            const { data: retRows, error: retErr } = await sb.from('sales_returns').insert({
                return_no: returnNo,
                customer_id: retEntityId || null,
                sale_id: retLinkedDoc?.id || null,
                warehouse_id: retWarehouseId,
                payment_type: retLinkedDoc?.payment_type || 'cash',
                subtotal, total, status: 'confirmed',
                reason: notes,
                created_by: currentUser?.id || null,
            }).select();
            if (retErr) throw retErr;
            const returnId = retRows[0].id;

            const itemRows = filled.map(it => ({
                return_id: returnId, product_id: it.pid, qty: it.qty,
                unit_price: it.price, discount_pct: it.disc || 0,
                line_total: (it.qty || 0) * (it.price || 0) * (1 - (it.disc || 0) / 100),
                unit_name: it.unit || 'قطعة',
            }));
            const { error: itemsErr } = await sb.from('sale_return_items').insert(itemRows);
            if (itemsErr) throw itemsErr;

            await sb.from('app_settings').upsert({ key: counterKey, value: String(counter + 1), updated_at: new Date().toISOString() });
        } else {
            const { data: retRows, error: retErr } = await sb.from('purchase_returns').insert({
                return_no: returnNo,
                supplier_id: retEntityId || null,
                purchase_id: retLinkedDoc?.id || null,
                warehouse_id: retWarehouseId,
                subtotal, total, status: 'confirmed',
                reason: notes,
                created_by: currentUser?.id || null,
            }).select();
            if (retErr) throw retErr;
            const returnId = retRows[0].id;

            const itemRows = filled.map(it => ({
                return_id: returnId, product_id: it.pid, qty: it.qty,
                unit_price: it.price,
                line_total: (it.qty || 0) * (it.price || 0),
                unit_name: it.unit || 'قطعة',
            }));
            const { error: itemsErr } = await sb.from('purchase_return_items').insert(itemRows);
            if (itemsErr) throw itemsErr;

            await sb.from('app_settings').upsert({ key: counterKey, value: String(counter + 1), updated_at: new Date().toISOString() });
        }

        alert(`✅ تم حفظ المرتجع ${returnNo} بنجاح`);
        try {
            const { data: cash } = await sb.rpc('get_cash_balance');
            const tb = document.getElementById('topbarCash');
            if (tb) tb.textContent = '💰 ' + (cash || 0).toFixed(2) + ' ج.م';
        } catch {}
        renderReturns(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ أثناء حفظ المرتجع: ' + err.message + '\n\nتأكد من تشغيل ملف returns_migration.sql في Supabase.');
    } finally {
        if (btn) { btn.textContent = '💾 حفظ المرتجع'; btn.disabled = false; }
    }
};

// ════════════════════════════════════════════════════════════
// 7) أدوات مساعدة
// ════════════════════════════════════════════════════════════
function retFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

Object.assign(window, { renderReturns });
