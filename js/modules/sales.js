/* ════════════════════════════════════════════════════════════
   فاتورة المبيعات — تخطيط ثنائي / هوية كحلي + ذهبي
   مربوطة بـ Supabase (products / customers / inventory_stock)
   ════════════════════════════════════════════════════════════ */

// ── بيانات حية من Supabase (تُحمّل عند فتح الفاتورة) ──
let INV_DB = {
    products: [],      // products table
    customers: [],     // customers table
    warehouses: [],    // warehouses table
    stockMap: {},      // { 'warehouseId|productId': qty }
    invoiceNo: 1,      // رقم الفاتورة التالي
};
let invWarehouseId = null; // المخزن المختار حالياً

// ── حالة الفاتورة الحالية ──
let invItems = [];          // سطور الفاتورة
let invCustId = null;       // العميل المختار
let invPayType = 'cash';    // cash | credit
let invEditingId = null;    // تعديل فاتورة قديمة
let invEditingOldItems = [];       // بنود الفاتورة القديمة (لإرجاع المخزون عند الإلغاء)
let invEditingOldWarehouse = null;
let invEditingOldTotal = 0;
let invEditingOldPayType = null;
let invEditingOldCustId = null;
let invEditingOldInvoiceNo = null;

// ════════════════════════════════════════════════════════════
// 0) تحميل البيانات الحية من Supabase
// ════════════════════════════════════════════════════════════
async function invLoadData() {
    const [
        { data: products },
        { data: customers },
        { data: warehouses },
        { data: stockRows },
        { data: lastSale },
        { data: invCounterRow },
        { data: priceLevels },
        { data: productPrices },
        { data: customerGroups },
    ] = await Promise.all([
        sb.from('products').select('*').eq('is_active', true).order('name'),
        sb.from('customers').select('*').eq('is_active', true).order('name'),
        sb.from('warehouses').select('*').order('name'),
        sb.from('inventory_stock').select('warehouse_id, product_id, qty'),
        sb.from('sales').select('invoice_no').order('created_at', { ascending: false }).limit(1),
        sb.from('app_settings').select('value').eq('key', 'invoice_counter').maybeSingle(),
        sb.from('price_levels').select('*').order('sort_order'),
        sb.from('product_prices').select('product_id, price, price_levels(code)'),
        sb.from('customer_groups').select('id, price_levels(code)'),
    ]);

    INV_DB.products = products || [];
    INV_DB.customers = customers || [];
    INV_DB.warehouses = warehouses || [];
    INV_DB.priceLevels = priceLevels || [];

    // خريطة أسعار المنتجات: 'productId|LEVELCODE' => price
    INV_DB.priceMap = {};
    (productPrices || []).forEach(pp => {
        const code = pp.price_levels?.code;
        if (code) INV_DB.priceMap[pp.product_id + '|' + code] = Number(pp.price) || 0;
    });

    // خريطة مستوى السعر الافتراضي لكل مجموعة عملاء: groupId => LEVELCODE
    INV_DB.groupLevelMap = {};
    (customerGroups || []).forEach(g => {
        const code = g.price_levels?.code;
        if (code) INV_DB.groupLevelMap[g.id] = code;
    });

    // بناء خريطة المخزون: 'warehouseId|productId' => qty
    INV_DB.stockMap = {};
    (stockRows || []).forEach(r => {
        INV_DB.stockMap[r.warehouse_id + '|' + r.product_id] = Number(r.qty) || 0;
    });

    // رقم الفاتورة: من app_settings أو آخر فاتورة + 1
    let counter = parseInt(invCounterRow?.value);
    if (!counter || isNaN(counter)) {
        // fallback: استخرج من آخر فاتورة
        const last = lastSale?.[0]?.invoice_no || 'INV-0001';
        const m = String(last).match(/(\d+)/);
        counter = m ? parseInt(m[1]) + 1 : 1;
    }
    INV_DB.invoiceNo = counter;

    // المخزن الافتراضي: الرئيسي أو الأول
    const mainWh = (INV_DB.warehouses).find(w => w.is_main) || INV_DB.warehouses[0];
    invWarehouseId = mainWh?.id || null;
}

// ── سعر بيع صنف حسب مستوى السعر ──
let invPriceLevelCode = ''; // '' = استخدام الافتراضي (جملة/تجزئة القديم) — قابل للتغيير من القائمة أو من مجموعة العميل

function invGetSellPrice(p) {
    // لو فيه مستوى سعر مختار، وله سعر مسجّل لهذا الصنف تحديداً، استخدمه
    if (invPriceLevelCode && p?.id) {
        const levelPrice = INV_DB.priceMap?.[p.id + '|' + invPriceLevelCode];
        if (levelPrice > 0) return levelPrice;
    }
    // fallback: نفس السلوك القديم (جملة ثم تجزئة)
    return Number(p?.wholesale_price) || Number(p?.retail_price) || 0;
}
function invGetBuyPrice(p) {
    return Number(p?.purchase_price) || 0;
}
// مخزون صنف في المخزن المختار حالياً
function invGetStock(productId) {
    if (!invWarehouseId) return 0;
    return INV_DB.stockMap[invWarehouseId + '|' + productId] || 0;
}
// تغيير المخزن المختار → إعادة عرض الجدول بأرصدة المخزن الجديد
function invOnWarehouseChange() {
    const sel = document.getElementById('invWarehouse');
    if (sel) invWarehouseId = sel.value;
    invRenderItems();
    invUpdateSummary();
    const wh = INV_DB.warehouses.find(w => w.id === invWarehouseId);
    if (wh) invToast(`🏭 تم التبديل للمخزن: ${wh.name}`, 'info');
}

// ════════════════════════════════════════════════════════════
// 1) التقديم الرئيسي
// ════════════════════════════════════════════════════════════
async function renderSales(c) {
    // شاشة تحميل
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل الأصناف والعملاء من قاعدة البيانات...</div>';

    try {
        await invLoadData();
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ في تحميل البيانات: ${err.message}<br><small>تأكد من اتصال Supabase</small></div>`;
        return;
    }

    // إعادة ضبط الحالة عند فتح الفاتورة
    invItems = [{ id: Date.now(), pid: null, name: '', code: '', qty: 1, price: 0, disc: 0, free: 0, unit: '', stock: 0 }];
    invCustId = null;
    invPayType = 'cash';
    invPriceLevelCode = '';
    invEditingId = null; invEditingOldItems = []; invEditingOldInvoiceNo = null;

    // ★ وضع تعديل فاتورة قديمة (قادم من صفحة "مراجعة الفواتير")
    if (window._pendingSalesEdit) {
        const pend = window._pendingSalesEdit;
        window._pendingSalesEdit = null;
        try {
            const { data: oldSale, error } = await sb.from('sales')
                .select('*, sale_items(*, products(name,code,unit))').eq('id', pend.id).maybeSingle();
            if (error) throw error;
            if (oldSale) {
                invEditingId = oldSale.id;
                invEditingOldItems = oldSale.sale_items || [];
                invEditingOldWarehouse = oldSale.warehouse_id;
                invEditingOldTotal = Number(oldSale.total) || 0;
                invEditingOldPayType = oldSale.payment_type;
                invEditingOldCustId = oldSale.customer_id;
                invEditingOldInvoiceNo = oldSale.invoice_no;

                invItems = (oldSale.sale_items || []).map(it => ({
                    id: Date.now() + Math.random(), pid: it.product_id,
                    name: it.products?.name || '', code: it.products?.code || '',
                    qty: Number(it.qty) || 0, price: Number(it.unit_price) || 0,
                    disc: Number(it.discount_pct) || 0, free: Number(it.free_qty) || 0,
                    unit: it.products?.unit || it.unit_name || '', stock: 0,
                }));
                invItems.push({ id: Date.now() + Math.random(), pid: null, name: '', code: '', qty: 1, price: 0, disc: 0, free: 0, unit: '', stock: 0 });
                invCustId = oldSale.customer_id;
                invPayType = oldSale.payment_type || 'cash';
                if (oldSale.warehouse_id) invWarehouseId = oldSale.warehouse_id;
            }
        } catch (err) {
            alert('⚠️ تعذّر تحميل الفاتورة للتعديل: ' + err.message);
        }
    }

    // ★ استئناف من عرض سعر (لو جاي من صفحة quotations.js)
    if (window._pendingQuoteConversion) {
        const pending = window._pendingQuoteConversion;
        window._pendingQuoteConversion = null;
        if (pending.items && pending.items.length) {
            invItems = pending.items.map(it => ({ id: Date.now()+Math.random(), ...it }));
            invItems.push({ id: Date.now()+Math.random(), pid: null, name: '', code: '', qty: 1, price: 0, disc: 0, free: 0, unit: '', stock: 0 });
        }
        if (pending.customerId) invCustId = pending.customerId;
    }

    c.innerHTML = `
    <div class="inv-root density-${invGetDensity()}">
        ${invEditingId ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:9px 16px;border-radius:9px;margin-bottom:8px;font-size:12.5px;display:flex;justify-content:space-between;align-items:center">
            <span>✏️ <strong>وضع تعديل</strong> — بتعدّل على الفاتورة <strong>${invEditingOldInvoiceNo}</strong>. عند الحفظ: هتتلغي الفاتورة القديمة تلقائياً (مع إرجاع المخزون والرصيد) وتتسجّل فاتورة جديدة بالتعديلات.</span>
            <button class="inv-top-btn" style="padding:4px 10px" onclick="invEditingId=null;invEditingOldInvoiceNo=null;renderSales(document.getElementById('app-content'))">إلغاء التعديل</button>
        </div>` : ''}
        ${invHeaderHTML()}
        <div class="inv-main">
            <div class="inv-table-col">
                ${invSearchBarHTML()}
                <div class="inv-table-scroll">
                    <table class="inv-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th style="width:90px">الكود</th>
                                <th class="text-r">الصنف</th>
                                <th style="width:64px">وحدة</th>
                                <th style="width:72px">رصيد</th>
                                <th style="width:80px">الكمية</th>
                                <th style="width:60px">مجاني</th>
                                <th style="width:92px">السعر</th>
                                <th style="width:64px">خصم%</th>
                                <th style="width:100px">الإجمالي</th>
                                <th style="width:40px"></th>
                            </tr>
                        </thead>
                        <tbody id="invItemsBody"></tbody>
                    </table>
                </div>
                ${invBottomBarHTML()}
            </div>
            <div class="inv-side">
                ${invPayCardHTML()}
                ${invCashCardHTML()}
                ${invDueCardHTML()}
                ${invTotalsCardHTML()}
                ${invActionsCardHTML()}
                ${invExcelCardHTML()}
                ${invDraftsCardHTML()}
                ${invNotesCardHTML()}
            </div>
        </div>
    </div>
    `;

    // ربط الأحداث
    invBindEvents();
    invRenderItems();
    invUpdateSummary();
    invUpdateCustomerChip();
    invRenderDrafts();
    invStartAutoSave();
    setTimeout(() => {
        invFocusSearch();
        invCheckAutoSaveRestore();
    }, 150);
}

// ════════════════════════════════════════════════════════════
// 2) قوالب HTML للأقسام
// ════════════════════════════════════════════════════════════
function invHeaderHTML() {
    return `
    <div class="inv-header">
        <div class="inv-header-brand">
            <div class="ic">🧾</div>
            <div class="ttl">فاتورة مبيعات<small> Sultan ERP</small></div>
        </div>
        <span class="inv-no-badge">${invEditingId ? '✏️ ' + invEditingOldInvoiceNo : 'INV-' + String(INV_DB.invoiceNo).padStart(4,'0')}</span>
        <select class="inv-date-input" id="invWarehouse" title="المخزن" onchange="invOnWarehouseChange()" style="cursor:pointer">
            ${(INV_DB.warehouses||[]).map(w => `<option value="${w.id}" ${w.id===invWarehouseId?'selected':''}>🏭 ${w.name}${w.is_main?' (رئيسي)':''}</option>`).join('') || '<option value="">لا يوجد مخزن</option>'}
        </select>
        <input type="date" class="inv-date-input" id="invDate" value="${invToday()}">
        <div class="inv-cust-pick">
            <span class="inv-cust-input-icon">👤</span>
            <input class="inv-cust-input" id="invCustSearch" placeholder="بحث عميل: اسم / هاتف..." autocomplete="off">
            <div class="inv-ac" id="invCustAC"></div>
        </div>
        <div class="inv-cust-chip" id="invCustChip">
            <span class="nm" id="invCustName"></span>
            <span class="bal" id="invCustBal"></span>
            <button class="x" onclick="invClearCustomer()">✕</button>
        </div>
        <div class="inv-header-spacer"></div>
        <button class="inv-top-btn inv-top-help"   onclick="invShowShortcuts()" title="الاختصارات (F1)">⌨️</button>
        <button class="inv-top-btn inv-top-save"   onclick="invSave(false)">💾 حفظ <kbd>F4</kbd></button>
        <button class="inv-top-btn inv-top-new"    onclick="invSave(true)">➕ جديدة <kbd>Alt+N</kbd></button>
        <button class="inv-top-btn inv-top-print"  onclick="invPrint()">🖨️ طباعة</button>
        <button class="inv-top-btn inv-top-close"  onclick="invClose()">✕</button>
    </div>`;
}

function invSearchBarHTML() {
    const cur = invGetDensity();
    return `
    <div class="inv-searchbar">
        <div class="inv-search-wrap">
            <span class="inv-search-icon">🔍</span>
            <input class="inv-search-input" id="invFastSearch" placeholder="ابحث: اسم / كود / باركود — ↑↓ تنقل — Enter اختيار" autocomplete="off">
            <div class="inv-ac" id="invFastAC" style="top:calc(100% + 4px)"></div>
        </div>
        <span class="inv-search-hint"><kbd>Alt+F</kbd> بحث</span>
        <select id="invPriceLevelSelect" class="inv-date-input" title="مستوى السعر" onchange="invSetPriceLevel(this.value)" style="cursor:pointer">
            <option value="">السعر الافتراضي</option>
            ${(INV_DB.priceLevels||[]).map(l=>`<option value="${l.code}" ${invPriceLevelCode===l.code?'selected':''}>💰 ${l.name}</option>`).join('')}
        </select>
        <div class="inv-density-btns" title="كثافة الأعمدة">
            <button onclick="invSetDensity('compact')" id="invDCompact" class="${cur==='compact'?'active':''}">مضغوط <kbd>1</kbd></button>
            <button onclick="invSetDensity('cozy')"    id="invDCozy"    class="${cur==='cozy'?'active':''}">عادي <kbd>2</kbd></button>
            <button onclick="invSetDensity('comfort')" id="invDComfort" class="${cur==='comfort'?'active':''}">واسع <kbd>3</kbd></button>
        </div>
        <button class="inv-add-row-btn" onclick="invAddRow()">+ سطر يدوي</button>
    </div>`;
}
function invGetDensity() { return localStorage.getItem('inv_density') || 'cozy'; }
function invSetDensity(d) {
    localStorage.setItem('inv_density', d);
    const root = document.querySelector('.inv-root');
    if (root) {
        root.classList.remove('density-compact','density-cozy','density-comfort');
        root.classList.add('density-'+d);
    }
    ['Compact','Cozy','Comfort'].forEach(n=>{ const el=document.getElementById('invD'+n); if(el) el.classList.toggle('active', n.toLowerCase()===d); });
    invToast(`📐 كثافة الأعمدة: ${ {compact:'مضغوط',cozy:'عادي',comfort:'واسع'}[d] }`, 'info');
}

function invBottomBarHTML() {
    return `
    <div class="inv-bottombar">
        <span class="bb-stat">الأصناف: <strong id="invItemCount">0</strong></span>
        <span class="bb-stat">الوحدات: <strong id="invUnitCount">0</strong></span>
        <span class="bb-net">الصافي: <span class="v" id="invNetBar">0.00</span> ج.م</span>
    </div>`;
}

function invPayCardHTML() {
    return `
    <div class="inv-card">
        <div class="inv-card-title">💳 نوع الدفع</div>
        <div class="inv-pay-toggle">
            <button class="inv-pay-opt active" id="invPayCash" onclick="invSetPayType('cash')">💵 نقدي</button>
            <button class="inv-pay-opt credit" id="invPayCredit" onclick="invSetPayType('credit')">📋 آجل</button>
        </div>
    </div>`;
}

function invCashCardHTML() {
    return `
    <div class="inv-card inv-cash-panel show" id="invCashPanel">
        <div class="inv-card-title" style="color:var(--inv-green)">💵 استلام نقدية</div>
        <div class="inv-cash-in">
            <input type="number" class="inv-cash-field" id="invCashReceived" placeholder="المبلغ المستلم" min="0" step="0.01" oninput="invCalcChange()">
            <button class="inv-cash-exact" onclick="invSetExactCash()">بالضبط</button>
        </div>
        <div class="inv-cash-quick" id="invCashQuick"></div>
        <div class="inv-change-box">
            <span class="clbl">الباقي للعميل</span>
            <span class="cval" id="invChange">0.00</span>
        </div>
    </div>`;
}

function invDueCardHTML() {
    return `
    <div class="inv-card inv-due" id="invDueCard">
        <div class="inv-card-title" style="color:var(--inv-red)">📅 تاريخ الاستحقاق</div>
        <input type="date" class="inv-due-input" id="invDueDate" value="${invToday()}">
    </div>`;
}

function invTotalsCardHTML() {
    return `
    <div class="inv-card">
        <div class="inv-card-title">💰 الإجماليات</div>
        <div class="inv-sum-row"><span class="lbl">إجمالي الأصناف</span><span class="val" id="invSubtotal">0.00</span></div>
        <div class="inv-sum-row disc"><span class="lbl">خصم الأسطر</span><span class="val" id="invDiscRows">0.00</span></div>
        <div class="inv-sum-row">
            <span class="lbl">خصم إضافي</span>
            <input type="number" class="inv-sum-disc-in" id="invDiscExtra" value="0" min="0" step="0.01" oninput="invUpdateSummary()">
        </div>
        <div class="inv-sum-divider"></div>
        <div class="inv-net-box">
            <div class="nlbl">الصافي المستحق</div>
            <div class="nval" id="invNet">0.00</div>
            <div id="invNetWords" style="font-size:11px;color:#94A3B8;margin-top:4px;line-height:1.4"></div>
        </div>
    </div>`;
}

function invActionsCardHTML() {
    return `
    <div class="inv-actions">
        <button class="inv-btn inv-btn-save" onclick="invSave(false)">💾 حفظ الفاتورة <kbd>F4</kbd></button>
        <button class="inv-btn inv-btn-new"  onclick="invSave(true)">➕ حفظ وفاتورة جديدة <kbd>Alt+N</kbd></button>
        <button class="inv-btn inv-btn-print" onclick="invPrint()">🖨️ حفظ وطباعة</button>
        <button class="inv-btn inv-btn-draft" onclick="invDraft()">📋 تعليق الفاتورة</button>
    </div>`;
}

function invNotesCardHTML() {
    return `
    <div class="inv-card">
        <div class="inv-card-title">📝 ملاحظات</div>
        <textarea class="inv-notes" id="invNotes" rows="2" placeholder="ملاحظات الفاتورة..."></textarea>
    </div>`;
}

function invExcelCardHTML() {
    return `
    <div class="inv-card">
        <div class="inv-card-title">📊 استيراد وتصدير</div>
        <div style="display:flex;flex-direction:column;gap:7px">
            <button class="inv-btn inv-btn-print" onclick="invExportXls()">📤 تصدير الفاتورة Excel</button>
            <label class="inv-btn inv-btn-print" style="cursor:pointer;justify-content:center;margin:0">
                📥 استيراد من Excel
                <input type="file" accept=".csv,.xlsx,.xls" style="display:none" onchange="invImportXls(this)">
            </label>
        </div>
    </div>`;
}

function invDraftsCardHTML() {
    return `
    <div class="inv-card inv-drafts" id="invDraftsCard">
        <div class="inv-card-title">📋 فواتير معلّقة <span class="inv-draft-badge" id="invDraftCount">0</span><span class="inv-autosave-badge" style="margin-right:auto"><span class="dot"></span> حفظ تلقائي</span></div>
        <div id="invDraftsList"></div>
    </div>`;
}

// ════════════════════════════════════════════════════════════
// 3) عرض السطور + الحسابات
// ════════════════════════════════════════════════════════════
function invRenderItems() {
    const tbody = document.getElementById('invItemsBody');
    if (!tbody) return;

    if (!invItems.length || (invItems.length === 1 && !invItems[0].pid)) {
        tbody.innerHTML = `<tr class="inv-empty-row"><td colspan="11">
            <span class="em-ic">🛒</span>
            ابدأ بالبحث في الأعلى أو اضغط <kbd style="background:#F1F5F9;padding:1px 6px;border-radius:4px">F3</kbd> لإضافة أول صنف
        </td></tr>`;
        return;
    }

    tbody.innerHTML = invItems.map((it, idx) => {
        const prod = it.pid ? INV_DB.products.find(p => p.id === it.pid) : null;
        const liveStock = it.pid ? invGetStock(it.pid) : 0;
        const low = it.pid && liveStock > 0 && it.qty > liveStock;
        const lineTotal = (it.qty||0) * (it.price||0) * (1 - (it.disc||0)/100);
        const costPrice = prod ? invGetBuyPrice(prod) : 0;
        const marginPct = (it.price && costPrice) ? Math.round(((it.price - costPrice) / it.price) * 100) : 0;
        const isNew = !it.pid && idx === invItems.length - 1;
        const cls = [isNew ? 'is-new-row':'', low ? 'is-low':''].join(' ').trim();
        return `<tr class="${cls}">
            <td class="inv-cell-idx">${idx+1}</td>
            <td>
                <input class="inv-cell-input is-num" value="${it.code||''}" placeholder="كود" autocomplete="off" dir="ltr"
                    oninput="invOnCode(${idx},this.value)" onkeydown="invRowKey(event,${idx},'code')">
            </td>
            <td style="position:relative">
                <input class="inv-cell-input is-name" value="${it.name||''}" placeholder="اسم الصنف..." autocomplete="off"
                    oninput="invOnName(${idx},this.value)" onkeydown="invOnNameKey(event,${idx})">
                <div class="inv-ac" id="invAC-${idx}" style="top:100%;right:0;left:0"></div>
            </td>
            <td style="text-align:center;font-size:12px;color:var(--inv-muted)">${it.unit || (prod?.unit||'—')}</td>
            <td class="inv-cell-stock">
                <span class="num ${low?'low':''}">${it.pid ? liveStock : '—'}</span>
                ${low?'<div class="low-lbl">نقص</div>':''}
            </td>
            <td>
                <input type="number" class="inv-cell-input is-num" value="${it.qty||1}" min="0.001" step="0.001"
                    oninput="invItems[${idx}].qty=parseFloat(this.value)||0;invUpdateRowTotal(${idx});invUpdateSummary()" onkeydown="invRowKey(event,${idx},'qty')">
            </td>
            <td>
                <input type="number" class="inv-cell-input is-num is-free" value="${it.free||0}" min="0" step="0.001"
                    oninput="invItems[${idx}].free=parseFloat(this.value)||0">
            </td>
            <td>
                <input type="number" class="inv-cell-input is-num" value="${it.price||0}" min="0" step="0.01"
                    oninput="invItems[${idx}].price=parseFloat(this.value)||0;invUpdateRowTotal(${idx});invUpdateSummary()" onkeydown="invRowKey(event,${idx},'price')">
            </td>
            <td>
                <input type="number" class="inv-cell-input is-num" value="${it.disc||0}" min="0" max="100" step="0.1"
                    oninput="invItems[${idx}].disc=parseFloat(this.value)||0;invUpdateRowTotal(${idx});invUpdateSummary()">
            </td>
            <td class="inv-cell-total" id="invRowTotal-${idx}">${invFmt(lineTotal)}<div style="font-size:9px;color:${marginPct>=20?'var(--inv-green)':'var(--inv-red)'};font-weight:600">${prod && costPrice ? marginPct+'% ربح' : ''}</div></td>
            <td class="inv-cell-del">
                <button class="inv-del-btn" onclick="invRemoveRow(${idx})">✕</button>
            </td>
        </tr>`;
    }).join('');
}

function invCalcNet() {
    const subtotal = invItems.reduce((s,i)=>s+(i.qty||0)*(i.price||0),0);
    const rowsDisc = invItems.reduce((s,i)=>s+(i.qty||0)*(i.price||0)*(i.disc||0)/100,0);
    const extra = parseFloat(document.getElementById('invDiscExtra')?.value)||0;
    return { subtotal, rowsDisc, extra, net: subtotal - rowsDisc - extra };
}

// تحديث إجمالي سطر واحد فوراً (بدون إعادة رسم الصف كله، عشان التركيز يفضل شغال أثناء الكتابة)
function invUpdateRowTotal(idx) {
    const it = invItems[idx];
    if (!it) return;
    const el = document.getElementById('invRowTotal-'+idx);
    if (!el) return;
    const prod = it.pid ? INV_DB.products.find(p => p.id === it.pid) : null;
    const lineTotal = (it.qty||0) * (it.price||0) * (1 - (it.disc||0)/100);
    const costPrice = prod ? invGetBuyPrice(prod) : 0;
    const marginPct = (it.price && costPrice) ? Math.round(((it.price - costPrice) / it.price) * 100) : 0;
    el.innerHTML = `${invFmt(lineTotal)}<div style="font-size:9px;color:${marginPct>=20?'var(--inv-green)':'var(--inv-red)'};font-weight:600">${prod && costPrice ? marginPct+'% ربح' : ''}</div>`;
}

function invUpdateSummary() {
    const { subtotal, rowsDisc, extra, net } = invCalcNet();
    const set = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
    set('invSubtotal', invFmt(subtotal));
    set('invDiscRows', invFmt(rowsDisc + extra));
    set('invNet',      invFmt(net));
    set('invNetBar',   invFmt(net));
    const wordsEl = document.getElementById('invNetWords');
    if (wordsEl) wordsEl.textContent = invToArabicWords(net);

    const itemCount = invItems.filter(i=>i.pid).length;
    const unitCount = invItems.reduce((s,i)=>s+(i.qty||0),0);
    set('invItemCount', itemCount);
    set('invUnitCount', unitCount);

    invCalcChange();
    invRenderQuickCash(net);
    invUpdateCustomerChip();
}

// ════════════════════════════════════════════════════════════
// 4) العميل
// ════════════════════════════════════════════════════════════
let _custACIdx = -1;
function invSearchCustomer(val) {
    const ac = document.getElementById('invCustAC');
    if (!ac) return;
    const m = val.length ? INV_DB.customers.filter(c =>
        (c.name||'').includes(val) || (c.phone||'').includes(val) || (c.code||'').includes(val)
    ).slice(0,8) : [];
    if (m.length) {
        ac.innerHTML = m.map((c,i)=>`<div class="inv-ac-item" data-i="${i}" onclick="invSelectCustomer('${c.id}')" onmouseenter="invCustACHover(${i})">
            <div><div class="an">${c.name}</div><div class="as">${c.phone||''}</div></div>
            <div class="ap"><div class="pr">${invFmt(c.balance)}</div><div class="as">رصيد</div></div>
        </div>`).join('');
        ac.classList.add('show');
    } else ac.classList.remove('show');
}
function invCustACKey(e) {
    const ac = document.getElementById('invCustAC');
    if (!ac || !ac.classList.contains('show')) return;
    const items = ac.querySelectorAll('.inv-ac-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); _custACIdx = Math.min(_custACIdx+1, items.length-1); invCustACHover(_custACIdx); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _custACIdx = Math.max(_custACIdx-1, 0); invCustACHover(_custACIdx); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[_custACIdx]) items[_custACIdx].click(); }
    else if (e.key === 'Escape') { ac.classList.remove('show'); _custACIdx=-1; }
}
function invCustACHover(i) {
    _custACIdx = i;
    const items = document.querySelectorAll('#invCustAC .inv-ac-item');
    items.forEach((el,idx)=>el.classList.toggle('active', idx===i));
    items[i]?.scrollIntoView({ block: 'nearest' });
}
// تغيير مستوى السعر (يدوياً من القائمة، أو تلقائياً عند اختيار عميل)
// silent=true تمنع رسالة التنبيه (تُستخدم عند التطبيق التلقائي عشان ما نزعجش المستخدم برسالتين)
function invSetPriceLevel(code, silent) {
    invPriceLevelCode = code;
    // إعادة حساب أسعار الأصناف الموجودة فعلاً في الفاتورة (لو لها سعر مسجَّل في المستوى الجديد)
    invItems.forEach(it => {
        if (!it.pid) return;
        const newPrice = INV_DB.priceMap?.[it.pid + '|' + code];
        if (newPrice > 0) it.price = newPrice;
    });
    invRenderItems();
    invUpdateSummary();
    const sel = document.getElementById('invPriceLevelSelect');
    if (sel) sel.value = code;
    if (!silent) {
        const levelName = INV_DB.priceLevels.find(l=>l.code===code)?.name || code;
        invToast(`💰 مستوى السعر: ${levelName}`, 'info');
    }
}
function invSelectCustomer(id) {
    const c = INV_DB.customers.find(x=>x.id===id);
    if (!c) return;
    invCustId = id;
    document.getElementById('invCustSearch').value = '';
    document.getElementById('invCustAC').classList.remove('show');
    invUpdateCustomerChip();
    // تطبيق مستوى السعر الافتراضي لمجموعة العميل تلقائياً (يبقى قابل للتغيير يدوياً بعدها بحرية)
    const defaultLevel = c.group_id ? INV_DB.groupLevelMap?.[c.group_id] : null;
    if (defaultLevel) invSetPriceLevel(defaultLevel, true);
    invToast(`👤 تم اختيار: ${c.name}`, 'success');
    setTimeout(()=>document.getElementById('invFastSearch')?.focus(), 50);
}
function invUpdateCustomerChip() {
    const chip = document.getElementById('invCustChip');
    const c = invCustId ? INV_DB.customers.find(x=>x.id===invCustId) : null;
    if (c) {
        chip.classList.add('show');
        document.getElementById('invCustName').textContent = c.name;
        const balEl = document.getElementById('invCustBal');
        balEl.textContent = (c.balance>=0?'رصيد ':'مديونية ') + invFmt(Math.abs(c.balance));
        balEl.style.color = c.balance < 0 ? '#FCA5A5' : '#6EE7B7';
    } else chip.classList.remove('show');
}
function invClearCustomer() {
    invCustId = null;
    invUpdateCustomerChip();
}

// ════════════════════════════════════════════════════════════
// 5) البحث السريع + إضافة الأصناف
// ════════════════════════════════════════════════════════════
let _fastIdx = -1;
function invFastSearch(val) {
    const ac = document.getElementById('invFastAC');
    if (!ac) return;
    const m = val.length ? INV_DB.products.filter(p =>
        (p.name||'').includes(val) || (p.code||'').includes(val) || (p.barcode||'').includes(val)
    ).slice(0,8) : [];
    if (m.length) {
        ac.innerHTML = m.map((p,i)=>`<div class="inv-ac-item" data-i="${i}" onclick="invPickProduct('${p.id}')" onmouseenter="invFastHover(${i})">
            <div><div class="an">${p.name}</div><div class="as">${p.code||''} · ${p.unit||''}</div></div>
            <div class="ap"><div class="pr">${invFmt(invGetSellPrice(p))}</div><div class="as">مخزون: ${invGetStock(p.id)}</div></div>
        </div>`).join('');
        ac.classList.add('show');
    } else ac.classList.remove('show');
}
function invFastKey(e) {
    const ac = document.getElementById('invFastAC');
    if (!ac || !ac.classList.contains('show')) return;
    const items = ac.querySelectorAll('.inv-ac-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); _fastIdx = Math.min(_fastIdx+1, items.length-1); invFastHover(_fastIdx); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _fastIdx = Math.max(_fastIdx-1, 0); invFastHover(_fastIdx); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[_fastIdx]) items[_fastIdx].click(); }
    else if (e.key === 'Escape') { ac.classList.remove('show'); _fastIdx=-1; }
}
function invFastHover(i) {
    _fastIdx = i;
    const items = document.querySelectorAll('#invFastAC .inv-ac-item');
    items.forEach((el,idx)=>el.classList.toggle('active', idx===i));
    items[i]?.scrollIntoView({ block: 'nearest' });
}
function invPickProduct(pid) {
    const p = INV_DB.products.find(x=>x.id===pid);
    if (!p) return;
    // لو موجود قبل كده → زوّد الكمية
    const ex = invItems.findIndex(i=>i.pid===pid);
    if (ex >= 0) {
        invItems[ex].qty = (invItems[ex].qty||1) + 1;
    } else {
        const sell = invGetSellPrice(p);
        // املأ آخر سطر فاضي، أو ضيف جديد
        const last = invItems[invItems.length-1];
        if (last && !last.pid) {
            last.pid = p.id; last.name = p.name; last.code = p.code||'';
            last.unit = p.unit||''; last.price = sell; last.upc = p.units_per_carton||1;
        } else {
            invItems.push({ id: Date.now(), pid: p.id, name: p.name, code: p.code||'', qty: 1, price: sell, disc: 0, free: 0, unit: p.unit||'', upc: p.units_per_carton||1 });
        }
        invEnsureNewRow();
    }
    document.getElementById('invFastSearch').value = '';
    document.getElementById('invFastAC').classList.remove('show');
    _fastIdx = -1;
    invRenderItems();
    invUpdateSummary();
}
function invEnsureNewRow() {
    const last = invItems[invItems.length-1];
    if (!last || last.pid) {
        invItems.push({ id: Date.now(), pid: null, name: '', code: '', qty: 1, price: 0, disc: 0, free: 0, unit: '', stock: 0 });
    }
}

// ── بحث داخل خلية الصنف ──
let _rowACIdx = {};
function invOnName(idx, val) {
    invItems[idx].name = val; invItems[idx].pid = null;
    _rowACIdx[idx] = -1;
    const ac = document.getElementById('invAC-'+idx);
    if (!ac) return;
    const m = val.length ? INV_DB.products.filter(p =>
        (p.name||'').includes(val) || (p.code||'').includes(val)
    ).slice(0,6) : [];
    if (m.length) {
        ac.innerHTML = m.map((p,i)=>`<div class="inv-ac-item" data-i="${i}" onclick="invPickInline(${idx},'${p.id}')" onmouseenter="invRowACHover(${idx},${i})">
            <div><div class="an">${p.name}</div><div class="as">${p.code||''} · ${p.unit||''}</div></div>
            <div class="ap"><div class="pr">${invFmt(invGetSellPrice(p))}</div><div class="as">مخزون: ${invGetStock(p.id)}</div></div>
        </div>`).join('');
        ac.classList.add('show');
    } else ac.classList.remove('show');
}
function invOnNameKey(e, idx) {
    const ac = document.getElementById('invAC-'+idx);
    if (!ac || !ac.classList.contains('show')) return;
    const items = ac.querySelectorAll('.inv-ac-item');
    if (e.key==='ArrowDown'){e.preventDefault();_rowACIdx[idx]=Math.min((_rowACIdx[idx]??-1)+1,items.length-1);invRowACHover(idx,_rowACIdx[idx]);}
    else if (e.key==='ArrowUp'){e.preventDefault();_rowACIdx[idx]=Math.max((_rowACIdx[idx]??-1)-1,0);invRowACHover(idx,_rowACIdx[idx]);}
    else if (e.key==='Enter'){e.preventDefault();const ci=_rowACIdx[idx]??-1;if(items[ci])items[ci].click();}
    else if (e.key==='Escape'){ac.classList.remove('show');_rowACIdx[idx]=-1;}
}
function invRowACHover(idx,i){_rowACIdx[idx]=i;const items=document.querySelectorAll('#invAC-'+idx+' .inv-ac-item');items.forEach((el,x)=>el.classList.toggle('active',x===i));items[i]?.scrollIntoView({block:'nearest'});}
function invPickInline(idx, pid) {
    const p = INV_DB.products.find(x=>x.id===pid);
    if (!p) return;
    const sell = invGetSellPrice(p);
    invItems[idx] = { id: invItems[idx].id, pid: p.id, name: p.name, code: p.code||'', qty: invItems[idx].qty||1, price: sell, disc: 0, free: invItems[idx].free||0, unit: p.unit||'', upc: p.units_per_carton||1 };
    invEnsureNewRow();
    invRenderItems(); invUpdateSummary();
    setTimeout(()=>{ const r=document.getElementById('invItemsBody')?.rows[idx]; if(r){ const inp=r.querySelectorAll('input')[2]; if(inp){inp.focus();inp.select();} } },30);
}
function invOnCode(idx, val) {
    invItems[idx].code = val;
    const p = INV_DB.products.find(x=>x.code===val);
    if (p) invPickInline(idx, p.id);
}

// ════════════════════════════════════════════════════════════
// 6) التحكم في السطور
// ═══════════════════════════직╜═══════════════════════════════
function invAddRow() {
    // لو آخر سطر فاضي فعلاً → ركّز عليه بدل ما نضيف سطر تاني فاضي
    const last = invItems[invItems.length-1];
    if (last && !last.pid) {
        invFocusRow(invItems.length-1, 1); // ركّز على خانة الصنف
        return;
    }
    invItems.push({ id: Date.now(), pid: null, name: '', code: '', qty: 1, price: 0, disc: 0, free: 0, unit: '', stock: 0 });
    invRenderItems(); invUpdateSummary();
    invFocusRow(invItems.length-1, 1);
}
function invFocusRow(idx, inputIdx) {
    setTimeout(()=>{ const r=document.getElementById('invItemsBody')?.rows[idx]; if(!r) return; const inp=r.querySelectorAll('input')[inputIdx]; if(inp){inp.focus();inp.select?.();} },40);
}
function invRemoveRow(idx) {
    invItems.splice(idx,1);
    if (!invItems.length) invItems.push({ id: Date.now(), pid: null, name:'',code:'',qty:1,price:0,disc:0,free:0,unit:'',stock:0 });
    invRenderItems(); invUpdateSummary();
}
function invRowKey(e, idx, field) {
    if (e.key === 'Enter') { e.preventDefault(); invMoveNextField(idx, field); }
}
function invMoveNextField(idx, field) {
    const row = document.getElementById('invItemsBody')?.rows[idx];
    if (!row) return;
    const inputs = row.querySelectorAll('input');
    const order = ['code','name','qty','price']; // index map
    const cur = order.indexOf(field);
    if (cur < order.length-1) { inputs[cur+1]?.focus(); inputs[cur+1]?.select?.(); }
    else { // آخر حقل → سطر جديد
        invEnsureNewRow(); invRenderItems();
        setTimeout(()=>{ const r=document.getElementById('invItemsBody')?.rows[idx+1]; r?.querySelectorAll('input')[1]?.focus(); },30);
    }
}

// ════════════════════════════════════════════════════════════
// 7) الدفع + الباقي
// ═════════════════════════════════════════5══════════════════
function invSetPayType(t) {
    invPayType = t;
    document.getElementById('invPayCash').classList.toggle('active', t==='cash');
    document.getElementById('invPayCredit').classList.toggle('active', t==='credit');
    document.getElementById('invCashPanel').classList.toggle('show', t==='cash');
    document.getElementById('invDueCard').classList.toggle('show', t==='credit');
    if (t==='cash') setTimeout(()=>document.getElementById('invCashReceived')?.focus(),50);
}
function invRenderQuickCash(net) {
    const box = document.getElementById('invCashQuick');
    if (!box) return;
    const opts = [Math.ceil(net), Math.ceil(net/50)*50, Math.ceil(net/100)*100, Math.ceil(net/100)*100+100, Math.ceil(net/100)*100+200];
    box.innerHTML = [...new Set(opts)].map(v=>`<button onclick="invSetCash(${v})">${invFmt(v)}</button>`).join('');
}
function invSetCash(v) {
    document.getElementById('invCashReceived').value = v;
    invCalcChange();
}
function invSetExactCash() {
    const { net } = invCalcNet();
    document.getElementById('invCashReceived').value = net.toFixed(2);
    invCalcChange();
}
function invCalcChange() {
    const { net } = invCalcNet();
    const rcv = parseFloat(document.getElementById('invCashReceived')?.value)||0;
    const ch = rcv - net;
    const el = document.getElementById('invChange');
    if (el) el.textContent = invFmt(ch>=0?ch:0);
}

// ════════════════════════════════════════════════════════════
// 8) الحفظ + الطباعة + المسودات + AutoSave
// ════════════════════════════════════════════════════════════
const INV_DRAFTS_KEY = 'inv_drafts';
const INV_AUTOSAVE_KEY = 'inv_autosave';

function invGetDrafts() { try { return JSON.parse(localStorage.getItem(INV_DRAFTS_KEY) || '[]'); } catch { return []; } }
function invSetDrafts(arr) { localStorage.setItem(INV_DRAFTS_KEY, JSON.stringify(arr)); }

function invSnapshot() {
    const { net } = invCalcNet();
    return {
        items: JSON.parse(JSON.stringify(invItems)),
        custId: invCustId, payType: invPayType,
        discExtra: parseFloat(document.getElementById('invDiscExtra')?.value) || 0,
        notes: document.getElementById('invNotes')?.value || '',
        date: document.getElementById('invDate')?.value || invToday(),
        dueDate: document.getElementById('invDueDate')?.value || '',
        net,
        savedAt: Date.now(),
    };
}

function invDraft() {
    const filled = invItems.filter(i => i.pid);
    if (!filled.length) { invToast('⚠️ لا يمكن تعليق فاتورة فارغة', 'error'); return; }
    const snap = invSnapshot();
    const drafts = invGetDrafts();
    snap.id = Date.now();
    snap.title = invCustId ? (INV_DB.customers.find(c => c.id === invCustId)?.name || 'عميل') : 'عميل نقدي';
    drafts.unshift(snap);
    invSetDrafts(drafts);
    invRenderDrafts();
    invToast(`📋 تم تعليق الفاتورة (${invFmt(snap.net)} ج.م)`, 'success');
    // فاتورة جديدة بعد التعليق
    renderSales(document.getElementById('app-content'));
}

function invRestoreDraft(id) {
    const drafts = invGetDrafts();
    const d = drafts.find(x => x.id === id);
    if (!d) return;
    // لو الفاتورة الحالية فيها أصناف → اسأل
    if (invItems.filter(i => i.pid).length) {
        if (!confirm('الفاتورة الحالية فيها أصناف. استبدالها بالمسودة المعلّقة؟')) return;
    }
    invItems = d.items; invCustId = d.custId; invPayType = d.payType;
    document.getElementById('invDiscExtra').value = d.discExtra || 0;
    document.getElementById('invNotes').value = d.notes || '';
    document.getElementById('invDate').value = d.date || invToday();
    document.getElementById('invDueDate').value = d.dueDate || '';
    invSetPayType(d.payType);
    invRenderItems(); invUpdateSummary();
    invRenderDrafts();
    invToast('♻️ تم استرجاع الفاتورة المعلّقة', 'success');
}

function invDeleteDraft(id, ev) {
    ev?.stopPropagation();
    const drafts = invGetDrafts().filter(x => x.id !== id);
    invSetDrafts(drafts);
    invRenderDrafts();
    invToast('🗑️ تم حذف المسودة', 'info');
}

function invRenderDrafts() {
    const card = document.getElementById('invDraftsCard');
    const list = document.getElementById('invDraftsList');
    const cnt  = document.getElementById('invDraftCount');
    if (!card) return;
    const drafts = invGetDrafts();
    card.classList.toggle('has', drafts.length > 0);
    if (cnt) cnt.textContent = drafts.length;
    if (!list) return;
    list.innerHTML = drafts.slice(0, 8).map(d => `
        <div class="inv-draft-item" onclick="invRestoreDraft(${d.id})">
            <span class="di-ic">🧾</span>
            <div class="di-info">
                <div class="di-title">${d.title || 'عميل نقدي'}</div>
                <div class="di-sub">${invTimeAgo(d.savedAt)} · ${d.items.filter(i=>i.pid).length} صنف</div>
            </div>
            <span class="di-amt">${invFmt(d.net)}</span>
            <button class="di-del" onclick="invDeleteDraft(${d.id},event)" title="حذف">✕</button>
        </div>`).join('');
}

function invTimeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'الآن';
    if (s < 3600) return Math.floor(s / 60) + ' دقيقة';
    if (s < 86400) return Math.floor(s / 3600) + ' ساعة';
    return Math.floor(s / 86400) + ' يوم';
}

// ── AutoSave: حماية من فقدان البيانات ──
let _invAutoSaveTimer = null;
function invStartAutoSave() {
    invStopAutoSave();
    _invAutoSaveTimer = setInterval(() => {
        const filled = invItems.filter(i => i.pid);
        if (filled.length) {
            localStorage.setItem(INV_AUTOSAVE_KEY, JSON.stringify(invSnapshot()));
        }
    }, 5000);
}
function invStopAutoSave() { if (_invAutoSaveTimer) { clearInterval(_invAutoSaveTimer); _invAutoSaveTimer = null; } }
function invCheckAutoSaveRestore() {
    try {
        const saved = JSON.parse(localStorage.getItem(INV_AUTOSAVE_KEY) || 'null');
        if (saved && saved.items && saved.items.filter(i => i.pid).length) {
            const mins = Math.floor((Date.now() - (saved.savedAt || 0)) / 60000);
            if (confirm(`♻️ يوجد فاتورة محفوظة تلقائياً (${mins} دقيقة). استعادتها؟`)) {
                invItems = saved.items; invCustId = saved.custId; invPayType = saved.payType;
                document.getElementById('invDiscExtra').value = saved.discExtra || 0;
                document.getElementById('invNotes').value = saved.notes || '';
                document.getElementById('invDate').value = saved.date || invToday();
                document.getElementById('invDueDate').value = saved.dueDate || '';
                invSetPayType(saved.payType);
                invRenderItems(); invUpdateSummary();
                invToast('♻️ تمت استعادة الفاتورة المحفوظة', 'success');
            }
            localStorage.removeItem(INV_AUTOSAVE_KEY);
        }
    } catch {}
}

async function invReverseOldForEdit() {
    // 1) علّم الفاتورة القديمة كملغاة
    await sb.from('sales').update({ status: 'cancelled' }).eq('id', invEditingId);

    // 2) ارجع الكمية المخصومة من المخزون وقت الفاتورة القديمة
    if (invEditingOldWarehouse) {
        for (const it of invEditingOldItems) {
            const need = (Number(it.qty) || 0) + (Number(it.free_qty) || 0);
            if (!it.product_id || !need) continue;
            const { data: stockRow } = await sb.from('inventory_stock')
                .select('id, qty').eq('warehouse_id', invEditingOldWarehouse).eq('product_id', it.product_id).maybeSingle();
            if (stockRow) {
                await sb.from('inventory_stock').update({ qty: (Number(stockRow.qty) || 0) + need }).eq('id', stockRow.id);
            } else {
                await sb.from('inventory_stock').insert({ warehouse_id: invEditingOldWarehouse, product_id: it.product_id, qty: need });
            }
            const key = invEditingOldWarehouse + '|' + it.product_id;
            INV_DB.stockMap[key] = (INV_DB.stockMap[key] || 0) + need;
        }
    }

    // 3) ارجع رصيد العميل لو كانت الفاتورة القديمة آجلة
    if (invEditingOldPayType === 'credit' && invEditingOldCustId) {
        const { data: custRow } = await sb.from('customers').select('balance').eq('id', invEditingOldCustId).maybeSingle();
        if (custRow) {
            await sb.from('customers').update({ balance: (Number(custRow.balance) || 0) - invEditingOldTotal }).eq('id', invEditingOldCustId);
            const c = INV_DB.customers.find(x => x.id === invEditingOldCustId);
            if (c) c.balance = (Number(c.balance) || 0) - invEditingOldTotal;
        }
    }
}

async function invSave(andNew) {
    const filled = invItems.filter(i => i.pid && (i.qty||0) > 0);
    if (!filled.length) { invToast('⚠️ الفاتورة فارغة — أضف أصنافاً أولاً', 'error'); return; }

    const { subtotal, rowsDisc, extra, net } = invCalcNet();
    const invoiceNo = 'INV-' + String(INV_DB.invoiceNo).padStart(4, '0');

    // فحص المخزون المتاح في المخزن المختار
    if (invWarehouseId) {
        const warnings = [];
        for (const it of filled) {
            const avail = invGetStock(it.pid);
            const need = (it.qty||0) + (it.free||0);
            if (avail < need) {
                warnings.push(`• ${it.name}: متاح ${avail} — مطلوب ${need}`);
            }
        }
        if (warnings.length) {
            const proceed = confirm('⚠️ تحذير نقص مخزون:\n\n' + warnings.join('\n') + '\n\nهل تريد المتابعة؟ (سيصبح المخزون بالسالب)');
            if (!proceed) return;
        }
    }

    // فحص الحد الائتماني للعميل الآجل
    if (invPayType === 'credit' && invCustId) {
        const c = INV_DB.customers.find(x=>x.id===invCustId);
        const limit = Number(c?.credit_limit) || 0;
        if (limit > 0 && (Number(c?.balance)||0) + net > limit) {
            const over = ((Number(c?.balance)||0) + net - limit).toFixed(2);
            if (!confirm(`⚠️ تجاوز الحد الائتماني!\n\nالعميل: ${c.name}\nالحد: ${invFmt(limit)} ج.م\nالرصيد الحالي: ${invFmt(c.balance)} ج.م\nالفاتورة: ${invFmt(net)} ج.م\nالتجاوز: ${over} ج.م\n\nهل تريد المتابعة؟`)) return;
        }
    }

    // زرار التحميل
    const saveBtns = document.querySelectorAll('.inv-btn-save, .inv-top-save');
    saveBtns.forEach(b => { b.innerText = '⏳ جاري الحفظ...'; b.disabled = true; });

    try {
        // ★ لو في وضع تعديل: ألغِ الفاتورة القديمة وارجع المخزون والرصيد قبل إنشاء النسخة الجديدة
        if (invEditingId) {
            await invReverseOldForEdit();
        }

        // 1) INSERT في جدول sales
        const { data: saleRows, error: saleErr } = await sb.from('sales').insert({
            invoice_no: invoiceNo,
            customer_id: invCustId || null,
            payment_type: invPayType,
            subtotal,
            vat_amount: 0,
            total: net,
            discount: extra,
            status: 'confirmed',
            warehouse_id: invWarehouseId,
            rep_id: null,
            source_app: 'erp',
            created_by: currentUser?.id || null,
        }).select();
        if (saleErr) throw saleErr;
        const saleId = saleRows[0].id;

        // 2) INSERT بنود الفاتورة في sale_items + خصم المخزون
        const itemsToInsert = [];
        for (const it of filled) {
            const prod = INV_DB.products.find(p=>p.id===it.pid);
            const lineTotal = (it.qty||0) * (it.price||0) * (1 - (it.disc||0)/100);
            itemsToInsert.push({
                sale_id: saleId,
                product_id: it.pid,
                qty: it.qty,
                unit_price: it.price,
                line_total: lineTotal,
                unit_type: 'sale_unit',
                units_per_carton_snapshot: prod?.units_per_carton || 1,
                discount_pct: it.disc || 0,
                free_qty: it.free || 0,
                cost_price_snapshot: prod ? invGetBuyPrice(prod) : 0,
                unit_name: prod?.unit || it.unit || 'قطعة',
            });
        }
        const { error: itemsErr } = await sb.from('sale_items').insert(itemsToInsert);
        if (itemsErr) throw itemsErr;

        // 3) تحديث الـ cache المحلي للمخزون فقط
        //    (الخصم الفعلي في قاعدة البيانات بيقوم بيه الـ trigger تلقائياً عند INSERT في sale_items)
        //    القاعدة الذهبية #2: لا تكرار في عمليات المخزون/الفلوس
        if (invWarehouseId) {
            for (const it of filled) {
                const need = (it.qty||0) + (it.free||0);
                const key = invWarehouseId + '|' + it.pid;
                INV_DB.stockMap[key] = (INV_DB.stockMap[key] || 0) - need;
            }
        }

        // 4) زِد رقم الفاتورة في app_settings
        await sb.from('app_settings').upsert({
            key: 'invoice_counter',
            value: String(INV_DB.invoiceNo + 1),
            updated_at: new Date().toISOString(),
        });
        INV_DB.invoiceNo++;

        // لو آجل → حدّث رصيد العميل محلياً (الـ trigger في DB المفروض بيعملها)
        if (invPayType === 'credit' && invCustId) {
            const c = INV_DB.customers.find(x=>x.id===invCustId);
            if (c) c.balance = (Number(c.balance)||0) + net;
        }

        localStorage.removeItem(INV_AUTOSAVE_KEY);
        if (invEditingId) {
            invToast(`✅ تم إلغاء الفاتورة ${invEditingOldInvoiceNo} وتسجيل الفاتورة المعدّلة ${invoiceNo} — ${invFmt(net)} ج.م`, 'success');
            invEditingId = null; invEditingOldItems = []; invEditingOldInvoiceNo = null;
        } else {
            invToast(`✅ تم حفظ الفاتورة ${invoiceNo} — ${invFmt(net)} ج.م`, 'success');
        }

        // حدّث الخزنة في الشريط العلوي
        try {
            const { data: cash } = await sb.rpc('get_cash_balance');
            const tb = document.getElementById('topbarCash');
            if (tb) tb.textContent = '💰 ' + (cash || 0).toFixed(2) + ' ج.م';
        } catch {}

        if (andNew) {
            renderSales(document.getElementById('app-content'));
        } else {
            document.querySelector('.inv-no-badge').textContent = 'INV-' + String(INV_DB.invoiceNo).padStart(4, '0');
        }
    } catch (err) {
        alert('❌ خطأ أثناء حفظ الفاتورة: ' + err.message);
    } finally {
        saveBtns.forEach(b => { b.disabled = false; });
    }
}
async function invPrint() {
    const filled = invItems.filter(i => i.pid && (i.qty||0) > 0);
    if (!filled.length) { invToast('⚠️ لا توجد أصناف لطباعتها', 'error'); return; }
    const { subtotal, extra, net } = invCalcNet();
    const cust = invCustId ? INV_DB.customers.find(x=>x.id===invCustId) : null;
    const paid = invPayType === 'cash' ? parseFloat(document.getElementById('invCashReceived')?.value) || net : null;

    await printThermalReceipt('sale', {
        invoiceNo: 'INV-' + String(INV_DB.invoiceNo).padStart(4,'0'),
        customerName: cust?.name || null,
        paymentType: invPayType,
        items: filled.map(it => ({ name: it.name, qty: it.qty, unit_price: it.price, line_total: (it.qty||0)*(it.price||0)*(1-(it.disc||0)/100) })),
        subtotal, discount: extra, total: net,
        previousBalance: cust?.balance || 0,
        paidAmount: paid,
    });
}
function invClose() {
    if (confirm('إغلاق الفاتورة؟ سيتم فقدان التغييرات غير المحفوظة.')) {
        invStopAutoSave();
        document.getElementById('app-content').innerHTML = '<div class="empty-state"><span>🧾</span>اضغط "فاتورة المبيعات" مرة أخرى لإنشاء فاتورة جديدة</div>';
    }
}

// ════════════════════════════════════════════════════════════
// 9) استيراد وتصدير Excel
// ════════════════════════════════════════════════════════════
function invExportXls() {
    const filled = invItems.filter(i => i.pid);
    if (!filled.length) { invToast('⚠️ لا يوجد أصناف للتصدير', 'error'); return; }
    const rows = filled.map((it, idx) => ({
        '#': idx + 1,
        'الكود': it.code,
        'الصنف': it.name,
        'الوحدة': it.unit,
        'الكمية': it.qty,
        'مجاني': it.free || 0,
        'السعر': it.price,
        'خصم%': it.disc || 0,
        'الإجمالي': (it.qty||0) * (it.price||0) * (1 - (it.disc||0)/100),
    }));
    const { net } = invCalcNet();
    rows.push({}); // سطر فارغ
    rows.push({'#': '', 'الصنف': 'الإجمالي', 'الإجمالي': net});

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{wch:5},{wch:12},{wch:30},{wch:8},{wch:10},{wch:8},{wch:10},{wch:8},{wch:14}];
    XLSX.utils.book_append_sheet(wb, ws, 'فاتورة مبيعات');
    const invNo = String(INV_DB.invoiceNo).padStart(4, '0');
    XLSX.writeFile(wb, `INV-${invNo}_فاتورة.xlsx`);
    invToast('📤 تم تصدير الفاتورة بنجاح', 'success');
}

function invImportXls(input) {
    if (!input.files.length) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
            let added = 0;
            json.forEach(row => {
                const name = row['الصنف'] || row['صنف'] || row['اسم الصنف'] || row['اسم'] || '';
                const code = String(row['الكود'] || row['كود'] || '');
                const qty  = parseFloat(row['الكمية'] || row['كمية'] || 1);
                const price = parseFloat(row['السعر'] || row['سعر'] || 0);
                const disc  = parseFloat(row['خصم%'] || row['خصم'] || 0);
                // محاولة مطابقة الصنف من قاعدة البيانات الحية
                let matched = null;
                if (name) matched = INV_DB.products.find(p => (p.name||'').includes(name) || name.includes(p.name||''));
                if (!matched && code) matched = INV_DB.products.find(p => p.code === code);
                if (matched) {
                    const sell = invGetSellPrice(matched);
                    invItems.push({ id: Date.now()+added, pid: matched.id, name: matched.name, code: matched.code||'', qty, price: price || sell, disc, free: 0, unit: matched.unit||'', upc: matched.units_per_carton||1 });
                    added++;
                } else if (name && qty && price) {
                    invItems.push({ id: Date.now()+added, pid: null, name, code, qty, price, disc, free: 0, unit: '', upc: 1 });
                    added++;
                }
            });
            invEnsureNewRow();
            invRenderItems();
            invUpdateSummary();
            invToast(`📥 تم استيراد ${added} صنف من Excel`, 'success');
        } catch (err) {
            invToast('❌ خطأ في قراءة الملف: ' + err.message, 'error');
        }
    };
    reader.readAsArrayBuffer(file);
    input.value = ''; // تصفير الحقل
}

// ════════════════════════════════════════════════════════════
// 10) تفقيط الأرقام عربي (فقط ... جنيهاً لا غير)
// ════════════════════════════════════════════════════════════
function invToArabicWords(num) {
    if (!num || num <= 0) return '';
    const whole = Math.floor(num);
    const fraction = Math.round((num - whole) * 100);
    const ones = ['','واحد','اثنان','ثلاثة','أربعة','خمسة','ستة','سبعة','ثمانية','تسعة','عشرة','أحد عشر','اثنا عشر','ثلاثة عشر','أربعة عشر','خمسة عشر','ستة عشر','سبعة عشر','ثمانية عشر','تسعة عشر'];
    const tens = ['','','عشرون','ثلاثون','أربعون','خمسون','ستون','سبعون','ثمانون','تسعون'];
    const hundreds = ['','مائة','مائتان','ثلاثمائة','أربعمائة','خمسمائة','ستمائة','سبعمائة','ثمانمائة','تسعمائة'];
    if (whole === 0) return '';
    function convert(n) {
        if (n < 20) return ones[n];
        if (n < 100) { const t = tens[Math.floor(n/10)]; const o = ones[n%10]; return o ? o + ' و' + t : t; }
        if (n < 1000) { const h = hundreds[Math.floor(n/100)]; const r = n % 100; return r ? h + ' و' + convert(r) : h; }
        if (n < 1000000) { const th = Math.floor(n/1000); let ts = ''; if (th===1) ts='ألف'; else if(th===2) ts='ألفان'; else if(th<=10) ts=ones[th]+' آلاف'; else ts=convert(th)+' ألف'; const r = n%1000; return r ? ts + ' و' + convert(r) : ts; }
        if (n < 1000000000) { const m = Math.floor(n/1000000); let ms = m===1?'مليون':m===2?'مليونان':convert(m)+' مليون'; const r=n%1000000; return r?ms+' و'+convert(r):ms; }
        return String(n);
    }
    let result = 'فقط ' + convert(whole) + ' جنيهاً';
    if (fraction > 0) result += ' و' + fraction + ' قرشاً';
    result += ' لا غير';
    return result;
}

// ════════════════════════════════════════════════════════════
// 11) الأدوات المساعدة
// ════════════════════════════════════════════════════════════
function invFmt(n) { return (n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function invToday() { return new Date().toISOString().slice(0,10); }
function invFocusSearch() { document.getElementById('invFastSearch')?.focus(); }

function invToast(msg, type='info') {
    let t = document.getElementById('invToast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'invToast'; t.className = 'inv-toast';
        document.body.appendChild(t);
    }
    t.className = 'inv-toast ' + type;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window._invToastT);
    window._invToastT = setTimeout(()=>t.classList.remove('show'), 2600);
}

// ════════════════════════════════════════════════════════════
// 10) ربط الأحداث (الكيبورد + البحث)
// ════════════════════════════════════════════════════════════
function invBindEvents() {
    // بحث العميل
    const cs = document.getElementById('invCustSearch');
    cs?.addEventListener('input', ()=>{ _custACIdx=-1; invSearchCustomer(cs.value); });
    cs?.addEventListener('keydown', invCustACKey);

    // البحث السريع
    const fs = document.getElementById('invFastSearch');
    fs?.addEventListener('input', ()=>{ _fastIdx=-1; invFastSearch(fs.value); });
    fs?.addEventListener('keydown', invFastKey);

    // اختصارات لوحة المفاتيح العامة
    document.getElementById('app-content').addEventListener('keydown', invGlobalKeys);
}
function invGlobalKeys(e) {
    // لو التركيز داخل input/textarea وده مش اختصار عام → سيب الحقل يشتغل (عدا F-keys و Ctrl)
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    const isFKey = /^F\d{1,2}$/.test(e.key);

    // كل اختصارات Alt+ في مكان واحد (بدل Ctrl+P/S/N المحجوزة في كروم،
    // وبدل F3/F5/F6/F7/F12 المحجوزة: بحث الصفحة/تحديث/شريط العنوان/قراءة بالمؤشر/أدوات المطور)
    if (e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 's') { e.preventDefault(); invSave(false); return; }         // Alt+S حفظ
        if (k === 'p') { e.preventDefault(); invPrint(); return; }             // Alt+P طباعة
        if (k === 'd') { e.preventDefault(); invDraft(); return; }             // Alt+D تعليق
        if (k === 'n') { e.preventDefault(); invSave(true); return; }          // Alt+N فاتورة جديدة
        if (k === 'f') { e.preventDefault(); document.getElementById('invFastSearch')?.focus(); return; }  // Alt+F بحث صنف
        if (k === 't') { e.preventDefault(); invTogglePayType(); return; }     // Alt+T تبديل نقدي/آجل
        if (k === 'c') { e.preventDefault(); invSetPayType('cash'); return; }  // Alt+C نقدي
        return;
    }

    // F-keys الآمنة (غير محجوزة في أي متصفح)
    if (e.key === 'F1')  { e.preventDefault(); invShowShortcuts(); return; }   // لوحة المساعدة
    if (e.key === 'F2')  { e.preventDefault(); document.getElementById('invCustSearch')?.focus(); return; }
    if (e.key === 'F4')  { e.preventDefault(); invSave(false); return; }
    if (e.key === 'F8')  { e.preventDefault(); invDraft(); return; }
    if (e.key === 'F9')  { e.preventDefault(); invSetExactCash(); document.getElementById('invCashReceived')?.focus(); return; }

    // أرقام الكثافة (1/2/3) بس لما التركيز مش في حقل
    if (!inField) {
        if (e.key === '1') { invSetDensity('compact'); return; }
        if (e.key === '2') { invSetDensity('cozy'); return; }
        if (e.key === '3') { invSetDensity('comfort'); return; }
        if (e.key === 'Insert') { e.preventDefault(); invAddRow(); return; }
    }

    // Esc: أغلق أي قائمة منسدلة مفتوحة
    if (e.key === 'Escape') {
        const open = document.querySelector('.inv-ac.show');
        if (open) { open.classList.remove('show'); return; }
        const modal = document.getElementById('invShortcutsModal');
        if (modal?.classList.contains('active')) { invCloseShortcuts(); return; }
    }
}

function invTogglePayType() { invSetPayType(invPayType === 'cash' ? 'credit' : 'cash'); }
function invShowShortcuts() {
    let m = document.getElementById('invShortcutsModal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'invShortcutsModal'; m.className = 'mod-modal-bg';
        m.innerHTML = `<div class="mod-modal" style="max-width:560px">
            <div class="mod-modal-header"><h3>⌨️ اختصارات لوحة المفاتيح</h3>
                <button class="mod-modal-close" onclick="invCloseShortcuts()">✕</button></div>
            <div class="mod-modal-body" style="display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;font-size:13px">
                ${invShortcutList().map(s=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #F1F5F9"><span style="color:#475569">${s.d}</span><kbd style="background:#0F172A;color:#FBBF24;border-radius:5px;padding:2px 8px;font-size:11px;font-family:inherit">${s.k}</kbd></div>`).join('')}
            </div></div>`;
        document.body.appendChild(m);
    }
    m.classList.add('active');
}
function invCloseShortcuts() { document.getElementById('invShortcutsModal')?.classList.remove('active'); }
function invShortcutList() {
    return [
        {d:'بحث عميل', k:'F2'}, {d:'بحث صنف سريع', k:'Alt+F'},
        {d:'حفظ الفاتورة', k:'F4 / Alt+S'}, {d:'حفظ + فاتورة جديدة', k:'Alt+N'},
        {d:'تبديل نقدي/آجل', k:'Alt+T'}, {d:'نقدي', k:'Alt+C'},
        {d:'تعليق (مسودة)', k:'F8 / Alt+D'}, {d:'المبلغ بالضبط', k:'F9'},
        {d:'طباعة', k:'Alt+P'}, {d:'هذه اللوحة', k:'F1'},
        {d:'طي القائمة الجانبية', k:'Alt+H'}, {d:'سطر جديد', k:'Insert'},
        {d:'كثافة مضغوط/عادي/واسع', k:'1 / 2 / 3'},
        {d:'تنقل بين النتائج', k:'↑ ↓'}, {d:'اختيار من القائمة', k:'Enter'},
        {d:'إغلاق القائمة', k:'Esc'}, {d:'الحقل التالي', k:'Tab'},
    ];
}

// تصدير الدوال اللي بتشتغل من onclick داخل HTML
Object.assign(window, {
    invSave, invPrint, invDraft, invClose, invAddRow, invRemoveRow, invFocusRow,
    invSetPayType, invSetCash, invSetExactCash, invCalcChange, invTogglePayType,
    invSelectCustomer, invClearCustomer, invPickProduct, invPickInline,
    invOnName, invOnNameKey, invOnCode, invRowKey, invUpdateSummary, invUpdateRowTotal, invSetPriceLevel,
    invRowACHover, invCustACHover, invFastHover,
    invGetDensity, invSetDensity,
    invShowShortcuts, invCloseShortcuts,
    invRestoreDraft, invDeleteDraft, invRenderDrafts,
    invExportXls, invImportXls,
    invOnWarehouseChange,
});
