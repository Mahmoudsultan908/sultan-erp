/* ════════════════════════════════════════════════════════════
   فاتورة المشتريات — تخطيط ثنائي / هوية كحلي + ذهبي
   مربوطة بـ Supabase (products / suppliers / inventory_stock)
   + نظام المؤجل (deferred_rate + deferred_type + deferred_due_date؛
     deferred_rate بيتخزّن دايماً كمبلغ فعلي للوحدة — لو المستخدم اختار
     % بنحوّلها لمبلغ وقت الحفظ، راجع purSave)
   ════════════════════════════════════════════════════════════ */

// ── بيانات حية من Supabase ──
let PUR_DB = {
    products: [],
    suppliers: [],
    warehouses: [],
    stockMap: {},
    purchaseNo: 1,
};
let purWarehouseId = null;
let purSupplierId = null;
let purPayType = 'cash'; // cash | credit
let purTreasuryId = null; // الخزنة المختارة (للدفع النقدي)

// ── حالة الفاتورة ──
let purItems = [];
let purEditingId = null;
let purEditingOldItems = [];
let purEditingOldWarehouse = null;
let purEditingOldTotal = 0;
let purEditingOldSupplierId = null;
let purEditingOldPayType = null;
let purEditingOldInvoiceNo = null;
let purPendingPOOrderId = null; // أمر شراء بيتحوّل حالياً — يتعلّم "تم الاستلام" بعد نجاح الحفظ بس (مش قبله)

// ════════════════════════════════════════════════════════════
// 0) تحميل البيانات من Supabase
// ════════════════════════════════════════════════════════════
async function purLoadData() {
    const [
        { data: products },
        { data: suppliers },
        { data: warehouses },
        { data: stockRows },
        { data: lastPur },
        { data: counterRow },
        { data: treasuries },
    ] = await Promise.all([
        sb.from('products').select('*').eq('is_active', true).order('name'),
        sb.from('suppliers').select('*').eq('is_active', true).order('name'),
        sb.from('warehouses').select('*').order('name'),
        sb.from('inventory_stock').select('warehouse_id, product_id, qty'),
        sb.from('purchases').select('invoice_no').order('created_at', { ascending: false }).limit(1),
        sb.from('app_settings').select('value').eq('key', 'purchase_counter').maybeSingle(),
        sb.from('treasuries').select('*').eq('is_active', true).order('is_default', { ascending: false }),
    ]);

    PUR_DB.products = products || [];
    PUR_DB.suppliers = suppliers || [];
    PUR_DB.warehouses = warehouses || [];
    PUR_DB.treasuries = treasuries || [];
    PUR_DB.stockMap = {};
    (stockRows || []).forEach(r => { PUR_DB.stockMap[r.warehouse_id + '|' + r.product_id] = Number(r.qty) || 0; });

    let counter = parseInt(counterRow?.value);
    if (!counter || isNaN(counter)) {
        const last = lastPur?.[0]?.invoice_no || 'PUR-0001';
        const m = String(last).match(/(\d+)/);
        counter = m ? parseInt(m[1]) + 1 : 1;
    }
    PUR_DB.purchaseNo = counter;

    const mainWh = PUR_DB.warehouses.find(w => w.is_main) || PUR_DB.warehouses[0];
    purWarehouseId = mainWh?.id || null;
}

function purGetBuyPrice(p) { return Number(p?.purchase_price) || Number(p?.wholesale_price) || 0; }
function purGetStock(productId) {
    if (!purWarehouseId) return 0;
    return PUR_DB.stockMap[purWarehouseId + '|' + productId] || 0;
}

// ════════════════════════════════════════════════════════════
// 1) التقديم الرئيسي
// ════════════════════════════════════════════════════════════
async function renderPurchases(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات المشتريات...</div>';
    try {
        await purLoadData();
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ في التحميل: ${err.message}</div>`;
        return;
    }

    purItems = [{ id: Date.now(), pid: null, name: '', code: '', qty: 1, price: 0, disc: 0, free: 0, unit: '', upc: 1, deferredRate: 0, deferredDate: '', deferredType: 'percent' }];
    purSupplierId = null;
    purPayType = 'cash';
    purTreasuryId = PUR_DB.treasuries?.find(t => t.is_default)?.id || null;
    purEditingId = null; purEditingOldItems = []; purEditingOldInvoiceNo = null;
    purPendingPOOrderId = null;

    // ★ وضع تعديل فاتورة قديمة (قادم من صفحة "مراجعة الفواتير")
    if (window._pendingPurchaseEdit) {
        const pend = window._pendingPurchaseEdit;
        window._pendingPurchaseEdit = null;
        try {
            const { data: oldPur, error } = await sb.from('purchases')
                .select('*, purchase_items(*, products(name,code,unit))').eq('id', pend.id).maybeSingle();
            if (error) throw error;
            if (oldPur) {
                purEditingId = oldPur.id;
                purEditingOldItems = oldPur.purchase_items || [];
                purEditingOldWarehouse = oldPur.warehouse_id;
                purEditingOldTotal = Number(oldPur.total) || 0;
                purEditingOldSupplierId = oldPur.supplier_id;
                purEditingOldPayType = oldPur.payment_type;
                purEditingOldInvoiceNo = oldPur.invoice_no;

                purItems = (oldPur.purchase_items || []).map(it => ({
                    id: Date.now() + Math.random(), pid: it.product_id,
                    name: it.products?.name || '', code: it.products?.code || '',
                    qty: Number(it.qty) || 0, price: Number(it.unit_price) || 0,
                    disc: 0, free: 0, unit: it.products?.unit || '', upc: 1,
                    // deferred_rate المحفوظ فعلياً دايماً مبلغ ثابت للوحدة (راجع
                    // purSave) بصرف النظر إن كان المستخدم أصلاً اختار % وقت الإدخال —
                    // فبنعيد عرضه هنا كـ "ثابت" دايماً، مش بنحاول نرجّع النسبة الأصلية.
                    deferredRate: Number(it.deferred_rate) || 0, deferredDate: it.deferred_due_date || '',
                    deferredType: 'fixed',
                }));
                purItems.push({ id: Date.now() + Math.random(), pid: null, name: '', code: '', qty: 1, price: 0, disc: 0, free: 0, unit: '', upc: 1, deferredRate: 0, deferredDate: '', deferredType: 'percent' });
                purSupplierId = oldPur.supplier_id;
                purPayType = oldPur.payment_type || 'cash';
                if (oldPur.warehouse_id) purWarehouseId = oldPur.warehouse_id;
            }
        } catch (err) {
            alert('⚠️ تعذّر تحميل فاتورة الشراء للتعديل: ' + err.message);
        }
    }

    // ★ استئناف من أمر شراء (لو جاي من صفحة purchase-orders.js)
    if (window._pendingPOConversion) {
        const pending = window._pendingPOConversion;
        window._pendingPOConversion = null;
        if (pending.items && pending.items.length) {
            purItems = pending.items.map(it => ({ id: Date.now()+Math.random(), ...it }));
            purItems.push({ id: Date.now()+Math.random(), pid: null, name: '', code: '', qty: 1, price: 0, disc: 0, free: 0, unit: '', upc: 1, deferredRate: 0, deferredDate: '', deferredType: 'percent' });
        }
        if (pending.supplierId) purSupplierId = pending.supplierId;
        // هيتعلّم "تم الاستلام" في purSave بس لو الحفظ نجح فعلاً — راجع التعليق في purchase-orders.js
        purPendingPOOrderId = pending.orderId || null;
    }

    c.innerHTML = `
    <div class="inv-root density-${localStorage.getItem('inv_density') || 'cozy'}">
        ${purEditingId ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:9px 16px;border-radius:9px;margin-bottom:8px;font-size:12.5px;display:flex;justify-content:space-between;align-items:center">
            <span>✏️ <strong>وضع تعديل</strong> — بتعدّل على فاتورة الشراء <strong>${purEditingOldInvoiceNo}</strong>. عند الحفظ: هتتلغي الفاتورة القديمة تلقائياً (مع إرجاع المخزون والرصيد) وتتسجّل فاتورة جديدة بالتعديلات.</span>
            <button class="inv-top-btn" style="padding:4px 10px" onclick="purEditingId=null;purEditingOldInvoiceNo=null;renderPurchases(document.getElementById('app-content'))">إلغاء التعديل</button>
        </div>` : ''}
        ${purHeaderHTML()}
        <div class="inv-main">
            <div class="inv-table-col">
                ${purSearchBarHTML()}
                <div class="inv-table-scroll">
                    <table class="inv-table">
                        <thead><tr>
                            <th>#</th>
                            <th style="width:90px">الكود</th>
                            <th class="text-r">الصنف</th>
                            <th style="width:64px">وحدة</th>
                            <th style="width:72px">رصيد</th>
                            <th style="width:80px">الكمية</th>
                            <th style="width:60px">مجاني</th>
                            <th style="width:92px">سعر الشراء</th>
                            <th style="width:64px">خصم%</th>
                            <th style="width:90px">المؤجل%</th>
                            <th style="width:100px">الإجمالي</th>
                            <th style="width:40px"></th>
                        </tr></thead>
                        <tbody id="purItemsBody"></tbody>
                    </table>
                </div>
                ${purBottomBarHTML()}
            </div>
            <div class="inv-side">
                ${purSupplierCardHTML()}
                ${purPayCardHTML()}
                ${purTotalsCardHTML()}
                ${purActionsCardHTML()}
                ${purNotesCardHTML()}
                ${purDraftsCardHTML()}
            </div>
        </div>
    </div>`;
    purBindEvents();
    purRenderItems();
    purUpdateSummary();
    purUpdateSupplierChip();
    purRenderDrafts();
    purStartAutoSave();
    setTimeout(() => { purCheckAutoSaveRestore(); }, 150);
}

// ════════════════════════════════════════════════════════════
// 2) قوالب HTML
// ════════════════════════════════════════════════════════════
function purHeaderHTML() {
    return `
    <div class="inv-header">
        <div class="inv-header-brand">
            <div class="ic" style="background:linear-gradient(135deg,#16A34A,#22C55E);box-shadow:0 4px 12px rgba(22,163,74,0.4)">📥</div>
            <div class="ttl">فاتورة مشتريات<small> Sultan ERP</small></div>
        </div>
        <span class="inv-no-badge" style="background:rgba(22,163,74,0.18);color:#4ADE80;border-color:rgba(22,163,74,0.35)">${purEditingId ? '✏️ ' + purEditingOldInvoiceNo : 'PUR-' + String(PUR_DB.purchaseNo).padStart(4,'0')}</span>
        <select class="inv-date-input" id="purWarehouse" title="المخزن" onchange="purOnWarehouseChange()" style="cursor:pointer">
            ${(PUR_DB.warehouses||[]).map(w => `<option value="${w.id}" ${w.id===purWarehouseId?'selected':''}>🏭 ${w.name}${w.is_main?' (رئيسي)':''}</option>`).join('') || '<option value="">لا يوجد مخزن</option>'}
        </select>
        <input type="date" class="inv-date-input" id="purDate" value="${new Date().toISOString().split('T')[0]}">
        <div class="inv-cust-pick">
            <span class="inv-cust-input-icon">🏭</span>
            <input class="inv-cust-input" id="purSuppSearch" placeholder="بحث مورد: اسم / هاتف..." autocomplete="off">
            <div class="inv-ac" id="purSuppAC"></div>
        </div>
        <div class="inv-cust-chip" id="purSuppChip">
            <span class="nm" id="purSuppName"></span>
            <span class="bal" id="purSuppBal"></span>
            <button class="x" onclick="purClearSupplier()">✕</button>
        </div>
        <div class="inv-header-spacer"></div>
        <button class="inv-top-btn inv-top-help" onclick="purShowShortcuts()" title="الاختصارات (F1)">⌨️</button>
        <button class="inv-top-btn" id="purFullscreenBtn" onclick="purToggleFullscreen()" title="إخفاء القائمة والشريط العلوي">${document.body.classList.contains('inv-fullscreen') ? '⛶ إظهار القائمة' : '⛶ ملء الشاشة'}</button>
        <button class="inv-top-btn inv-top-save" onclick="purSave(false)" style="background:#16A34A;box-shadow:0 3px 10px rgba(22,163,74,0.4)">💾 حفظ <kbd>F4</kbd></button>
        <button class="inv-top-btn inv-top-new" onclick="purSave(true)">➕ جديدة <kbd>Alt+N</kbd></button>
        <button class="inv-top-btn inv-top-close" onclick="purClose()">✕</button>
    </div>`;
}

// وضع ملء الشاشة: نفس منطق invToggleFullscreen في sales.js بالحرف —
// بيخفي القائمة الجانبية والشريط العلوي عشان فاتورة الشراء تاخد المساحة
// كلها. بيتصفّر تلقائياً عند أي تنقّل لصفحة تانية (راجع loadMod في app.js).
window.purToggleFullscreen = function() {
    const on = document.body.classList.toggle('inv-fullscreen');
    const btn = document.getElementById('purFullscreenBtn');
    if (btn) btn.textContent = on ? '⛶ إظهار القائمة' : '⛶ ملء الشاشة';
};

function purSearchBarHTML() {
    return `
    <div class="inv-searchbar">
        <div class="inv-search-wrap">
            <span class="inv-search-icon">🔍</span>
            <input class="inv-search-input" id="purFastSearch" placeholder="ابحث: اسم / كود / باركود — ↑↓ تنقل — Enter اختيار" autocomplete="off">
            <div class="inv-ac" id="purFastAC" style="top:calc(100% + 4px)"></div>
        </div>
        <span class="inv-search-hint"><kbd>Alt+F</kbd> بحث</span>
        <button class="inv-add-row-btn" onclick="purOpenMultiPick()">☑️ اختيار أصناف متعددة</button>
        <button class="inv-add-row-btn" onclick="purAddRow()">+ سطر يدوي</button>
    </div>`;
}

function purBottomBarHTML() {
    return `
    <div class="inv-bottombar">
        <span class="bb-stat">الأصناف: <strong id="purItemCount">0</strong></span>
        <span class="bb-stat">الوحدات: <strong id="purUnitCount">0</strong></span>
        <span class="bb-net">الصافي: <span class="v" id="purNetBar" style="color:#22C55E">0.00</span> ج.م</span>
    </div>`;
}

function purSupplierCardHTML() {
    return `
    <div class="inv-card">
        <div class="inv-card-title">🏭 المورد</div>
        <div style="display:flex;gap:7px;flex-direction:column">
            <select id="purPayType" class="mod-form-input" onchange="purSetPayType(this.value)">
                <option value="cash">💵 نقدي</option>
                <option value="credit">📋 آجل</option>
            </select>
        </div>
    </div>`;
}

function purPayCardHTML() {
    return `
    <div class="inv-card inv-cash-panel show" id="purCashPanel">
        <div class="inv-card-title" style="color:var(--inv-green)">💵 المدفوع نقداً</div>
        <div class="inv-cash-in">
            <input type="number" class="inv-cash-field" id="purCashPaid" placeholder="المبلغ المدفوع" min="0" step="0.01" oninput="purCalcChange()">
            <button class="inv-cash-exact" onclick="purSetExactCash()">الإجمالي</button>
        </div>
        <div class="inv-change-box">
            <span class="clbl">متبقّي للمورد</span>
            <span class="cval" id="purChange" style="color:var(--inv-red)">0.00</span>
        </div>
        <select id="purTreasuryId" class="mod-form-input" style="margin-top:10px">
            ${(PUR_DB.treasuries||[]).map(t => `<option value="${t.id}" ${t.id===purTreasuryId?'selected':''}>${t.name}</option>`).join('')}
        </select>
    </div>`;
}

function purTotalsCardHTML() {
    return `
    <div class="inv-card">
        <div class="inv-card-title">💰 الإجماليات</div>
        <div class="inv-sum-row"><span class="lbl">إجمالي الأصناف</span><span class="val" id="purSubtotal">0.00</span></div>
        <div class="inv-sum-row disc"><span class="lbl">خصم الأسطر</span><span class="val" id="purDiscRows">0.00</span></div>
        <div class="inv-sum-row">
            <span class="lbl">خصم إضافي</span>
            <input type="number" class="inv-sum-disc-in" id="purDiscExtra" value="0" min="0" step="0.01" oninput="purUpdateSummary()">
        </div>
        <div class="inv-sum-row" style="color:#7C3AED">
            <span class="lbl" style="color:#7C3AED">⏳ إجمالي المؤجل</span>
            <span class="val" id="purDeferred" style="color:#7C3AED">0.00</span>
        </div>
        <div class="inv-sum-divider"></div>
        <div class="inv-net-box">
            <div class="nlbl">الصافي المستحق</div>
            <div class="nval" id="purNet">0.00</div>
        </div>
    </div>`;
}

function purActionsCardHTML() {
    return `
    <div class="inv-actions">
        <button class="inv-btn inv-btn-save" onclick="purSave(false)" style="background:linear-gradient(135deg,#16A34A,#22C55E);box-shadow:0 4px 14px rgba(22,163,74,0.35)">💾 حفظ الفاتورة <kbd>F4</kbd></button>
        <button class="inv-btn inv-btn-new" onclick="purSave(true)">➕ حفظ وفاتورة جديدة <kbd>Alt+N</kbd></button>
        <button class="inv-btn inv-btn-draft" onclick="purDraft()">📋 تعليق الفاتورة</button>
    </div>`;
}

function purNotesCardHTML() {
    return `
    <div class="inv-card">
        <div class="inv-card-title">📝 ملاحظات</div>
        <textarea class="inv-notes" id="purNotes" rows="2" placeholder="ملاحظات الفاتورة..."></textarea>
    </div>`;
}

function purDraftsCardHTML() {
    return `
    <div class="inv-card inv-drafts" id="purDraftsCard">
        <div class="inv-card-title">📋 فواتير معلّقة <span class="inv-draft-badge" id="purDraftCount">0</span><span class="inv-autosave-badge" style="margin-right:auto"><span class="dot"></span> حفظ تلقائي</span></div>
        <div id="purDraftsList"></div>
    </div>`;
}

// ════════════════════════════════════════════════════════════
// 3) عرض السطور
// ════════════════════════════════════════════════════════════
function purRenderItems() {
    const tbody = document.getElementById('purItemsBody');
    if (!tbody) return;

    if (!purItems.length || (purItems.length === 1 && !purItems[0].pid)) {
        tbody.innerHTML = `<tr class="inv-empty-row"><td colspan="12">
            <span class="em-ic">📥</span>
            ابدأ بالبحث في الأعلى أو اضغط <kbd style="background:#F1F5F9;padding:1px 6px;border-radius:4px">F3</kbd> لإضافة أول صنف
        </td></tr>`;
        return;
    }

    tbody.innerHTML = purItems.map((it, idx) => {
        const prod = it.pid ? PUR_DB.products.find(p => p.id === it.pid) : null;
        const liveStock = it.pid ? purGetStock(it.pid) : 0;
        const lineTotal = (it.qty||0) * (it.price||0) * (1 - (it.disc||0)/100);
        const deferredType = it.deferredType || 'percent';
        const deferredAmt = deferredType === 'fixed' ? (it.qty||0) * (it.deferredRate||0) : lineTotal * ((it.deferredRate||0) / 100);
        const isNew = !it.pid && idx === purItems.length - 1;
        const cls = isNew ? 'is-new-row' : '';
        return `<tr class="${cls}">
            <td class="inv-cell-idx">${idx+1}</td>
            <td>
                <input class="inv-cell-input is-num" value="${it.code||''}" placeholder="كود" autocomplete="off" dir="ltr"
                    oninput="purOnCode(${idx},this.value)" onkeydown="purRowKey(event,${idx},'code')">
            </td>
            <td style="position:relative">
                <input class="inv-cell-input is-name" value="${it.name||''}" placeholder="اسم الصنف..." autocomplete="off"
                    oninput="purOnName(${idx},this.value)" onkeydown="purOnNameKey(event,${idx})">
                <div class="inv-ac" id="purAC-${idx}" style="top:100%;right:0;left:0"></div>
            </td>
            <td style="text-align:center;font-size:12px;color:var(--inv-muted)">${it.unit || (prod?.unit||'—')}</td>
            <td class="inv-cell-stock">
                <span class="num">${it.pid ? liveStock : '—'}</span>
            </td>
            <td>
                <input type="number" class="inv-cell-input is-num" value="${it.qty||1}" min="0.001" step="0.001"
                    oninput="purItems[${idx}].qty=parseFloat(this.value)||0;purUpdateRowTotal(${idx});purUpdateSummary()" onkeydown="purRowKey(event,${idx},'qty')">
            </td>
            <td>
                <input type="number" class="inv-cell-input is-num is-free" value="${it.free||0}" min="0" step="0.001"
                    oninput="purItems[${idx}].free=parseFloat(this.value)||0">
            </td>
            <td>
                <input type="number" class="inv-cell-input is-num" value="${it.price||0}" min="0" step="0.01"
                    oninput="purItems[${idx}].price=parseFloat(this.value)||0;purUpdateRowTotal(${idx});purUpdateSummary()" onkeydown="purRowKey(event,${idx},'price')">
            </td>
            <td>
                <input type="number" class="inv-cell-input is-num" value="${it.disc||0}" min="0" max="100" step="0.1"
                    oninput="purItems[${idx}].disc=parseFloat(this.value)||0;purUpdateRowTotal(${idx});purUpdateSummary()">
            </td>
            <td>
                <div style="display:flex;align-items:center;gap:3px">
                    <input type="number" class="inv-cell-input is-num" value="${it.deferredRate||0}"
                        min="0" ${deferredType==='percent'?'max="100"':''} step="0.1" title="${deferredType==='percent'?'نسبة المؤجل %':'مبلغ المؤجل ثابت للوحدة'}"
                        style="background:#F5F3FF;color:#7C3AED" oninput="purItems[${idx}].deferredRate=parseFloat(this.value)||0;purUpdateSummary()">
                    <button type="button" class="inv-del-btn" style="font-size:10px;padding:2px 5px;background:#EDE9FE;color:#7C3AED" title="تبديل % / مبلغ ثابت"
                        onclick="purToggleDeferredType(${idx})">${deferredType==='percent'?'٪':'ثابت'}</button>
                </div>
            </td>
            <td class="inv-cell-total" id="purRowTotal-${idx}">${purFmt(lineTotal)}</td>
            <td class="inv-cell-del">
                <button class="inv-del-btn" onclick="purRemoveRow(${idx})">✕</button>
            </td>
        </tr>`;
    }).join('');
}

// تبديل نوع المؤجل بين نسبة % ومبلغ ثابت للوحدة — بيصفّر الرقم المدخل
// عشان مايتفسّرش غلط (5% مش نفس معنى 5 جنيه للوحدة)
function purToggleDeferredType(idx) {
    const it = purItems[idx];
    if (!it) return;
    it.deferredType = (it.deferredType||'percent') === 'percent' ? 'fixed' : 'percent';
    it.deferredRate = 0;
    purRenderItems();
    purUpdateSummary();
}

// تحديث إجمالي سطر واحد فوراً (بدون إعادة رسم الصف كله)
function purUpdateRowTotal(idx) {
    const it = purItems[idx];
    if (!it) return;
    const el = document.getElementById('purRowTotal-'+idx);
    if (!el) return;
    const lineTotal = (it.qty||0) * (it.price||0) * (1 - (it.disc||0)/100);
    el.innerHTML = purFmt(lineTotal);
}

function purCalcNet() {
    const subtotal = purItems.reduce((s,i)=>s+(i.qty||0)*(i.price||0),0);
    const rowsDisc = purItems.reduce((s,i)=>s+(i.qty||0)*(i.price||0)*(i.disc||0)/100,0);
    const extra = parseFloat(document.getElementById('purDiscExtra')?.value)||0;
    const deferred = purItems.reduce((s,i) => {
        if ((i.deferredType||'percent') === 'fixed') return s + (i.qty||0)*(i.deferredRate||0);
        const lt = (i.qty||0)*(i.price||0)*(1-(i.disc||0)/100);
        return s + lt*((i.deferredRate||0)/100);
    }, 0);
    return { subtotal, rowsDisc, extra, deferred, net: subtotal - rowsDisc - extra };
}

function purUpdateSummary() {
    const { subtotal, rowsDisc, extra, deferred, net } = purCalcNet();
    const set = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
    set('purSubtotal', purFmt(subtotal));
    set('purDiscRows', purFmt(rowsDisc + extra));
    set('purDeferred', purFmt(deferred));
    set('purNet', purFmt(net));
    set('purNetBar', purFmt(net));
    const itemCount = purItems.filter(i=>i.pid).length;
    const unitCount = purItems.reduce((s,i)=>s+(i.qty||0),0);
    set('purItemCount', itemCount);
    set('purUnitCount', unitCount);
    purCalcChange();
}

// ════════════════════════════════════════════════════════════
// 4) المورد
// ════════════════════════════════════════════════════════════
let _purSuppACIdx = -1;
function purSearchSupplier(val) {
    const ac = document.getElementById('purSuppAC');
    if (!ac) return;
    // من غير كتابة: تعرض أول 8 موردين زي ما هم، عشان القائمة تظهر على طول
    // أول ما تدوس على الخانة (مش لازم تكتب حاجة الأول)
    const m = (val.length ? PUR_DB.suppliers.filter(s =>
        (s.name||'').includes(val) || (s.phone||'').includes(val) || (s.code||'').includes(val)
    ) : PUR_DB.suppliers).slice(0,8);
    if (m.length) {
        ac.innerHTML = m.map((s,i)=>`<div class="inv-ac-item" data-i="${i}" onclick="purSelectSupplier('${s.id}')" onmouseenter="purSuppACHover(${i})">
            <div><div class="an">${s.name}</div><div class="as">${s.phone||''} ${s.code?'· '+s.code:''}</div></div>
            <div class="ap"><div class="pr">${purFmt(s.balance)}</div><div class="as">رصيد مستحق</div></div>
        </div>`).join('');
        ac.classList.add('show');
    } else ac.classList.remove('show');
}
function purSuppACKey(e) {
    const ac = document.getElementById('purSuppAC');
    if (!ac || !ac.classList.contains('show')) return;
    const items = ac.querySelectorAll('.inv-ac-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); _purSuppACIdx = Math.min(_purSuppACIdx+1, items.length-1); purSuppACHover(_purSuppACIdx); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _purSuppACIdx = Math.max(_purSuppACIdx-1, 0); purSuppACHover(_purSuppACIdx); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[_purSuppACIdx]) items[_purSuppACIdx].click(); }
    else if (e.key === 'Escape') { ac.classList.remove('show'); _purSuppACIdx=-1; }
}
function purSuppACHover(i) {
    _purSuppACIdx = i;
    const items = document.querySelectorAll('#purSuppAC .inv-ac-item');
    items.forEach((el,idx)=>el.classList.toggle('active', idx===i));
    items[i]?.scrollIntoView({ block: 'nearest' });
}
function purSelectSupplier(id) {
    const s = PUR_DB.suppliers.find(x=>x.id===id);
    if (!s) return;
    purSupplierId = id;
    document.getElementById('purSuppSearch').value = '';
    document.getElementById('purSuppAC').classList.remove('show');
    purUpdateSupplierChip();
    purToast(`🏭 تم اختيار: ${s.name}`, 'success');
    setTimeout(()=>document.getElementById('purFastSearch')?.focus(), 50);
}
function purUpdateSupplierChip() {
    const chip = document.getElementById('purSuppChip');
    const s = purSupplierId ? PUR_DB.suppliers.find(x=>x.id===purSupplierId) : null;
    if (s) {
        chip.classList.add('show');
        document.getElementById('purSuppName').textContent = s.name;
        document.getElementById('purSuppBal').textContent = 'مستحق: ' + purFmt(Math.abs(s.balance));
    } else chip.classList.remove('show');
}
function purClearSupplier() { purSupplierId = null; purUpdateSupplierChip(); }

// ════════════════════════════════════════════════════════════
// 5) البحث السريع + إضافة الأصناف
// ════════════════════════════════════════════════════════════
let _purFastIdx = -1;
function purFastSearch(val) {
    const ac = document.getElementById('purFastAC');
    if (!ac) return;
    // من غير كتابة: تعرض أول 8 أصناف زي ما هم، عشان القائمة تظهر على طول
    // أول ما تدوس على الخانة (مش لازم تكتب حاجة الأول)
    const m = (val.length ? PUR_DB.products.filter(p =>
        (p.name||'').includes(val) || (p.code||'').includes(val) || (p.barcode||'').includes(val)
    ) : PUR_DB.products).slice(0,8);
    if (m.length) {
        ac.innerHTML = m.map((p,i)=>`<div class="inv-ac-item" data-i="${i}" onclick="purPickProduct('${p.id}')" onmouseenter="purFastHover(${i})">
            <div><div class="an">${p.name}</div><div class="as">${p.code||''} · ${p.unit||''}</div></div>
            <div class="ap"><div class="pr">${purFmt(purGetBuyPrice(p))}</div><div class="as">مخزون: ${purGetStock(p.id)}</div></div>
        </div>`).join('');
        ac.classList.add('show');
    } else ac.classList.remove('show');
}
function purFastKey(e) {
    const ac = document.getElementById('purFastAC');
    if (!ac || !ac.classList.contains('show')) return;
    const items = ac.querySelectorAll('.inv-ac-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); _purFastIdx = Math.min(_purFastIdx+1, items.length-1); purFastHover(_purFastIdx); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _purFastIdx = Math.max(_purFastIdx-1, 0); purFastHover(_purFastIdx); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[_purFastIdx]) items[_purFastIdx].click(); }
    else if (e.key === 'Escape') { ac.classList.remove('show'); _purFastIdx=-1; }
}
function purFastHover(i) {
    _purFastIdx = i;
    const items = document.querySelectorAll('#purFastAC .inv-ac-item');
    items.forEach((el,idx)=>el.classList.toggle('active', idx===i));
    items[i]?.scrollIntoView({ block: 'nearest' });
}
// المؤجل الافتراضي المسجّل على كارت الصنف نفسه (products.default_deferred_rate/
// default_deferred_type) — بيتسحب تلقائي أول ما الصنف يتضاف لفاتورة شراء
// جديدة، بدل ما يتكتب يدوياً كل مرة. لو الصنف مالوش مؤجل افتراضي، بيرجع صفر
// زي السلوك القديم بالظبط.
function purDeferredDefaults(p) {
    return { rate: Number(p?.default_deferred_rate) || 0, type: p?.default_deferred_type || 'percent' };
}
function purPickProduct(pid) {
    const p = PUR_DB.products.find(x=>x.id===pid);
    if (!p) return;
    const ex = purItems.findIndex(i=>i.pid===pid);
    if (ex >= 0) {
        purItems[ex].qty = (purItems[ex].qty||1) + 1;
    } else {
        const buy = purGetBuyPrice(p);
        const dd = purDeferredDefaults(p);
        const last = purItems[purItems.length-1];
        if (last && !last.pid) {
            last.pid = p.id; last.name = p.name; last.code = p.code||'';
            last.unit = p.unit||''; last.price = buy; last.upc = p.units_per_carton||1;
            last.deferredRate = dd.rate; last.deferredType = dd.type;
        } else {
            purItems.push({ id: Date.now(), pid: p.id, name: p.name, code: p.code||'', qty: 1, price: buy, disc: 0, free: 0, unit: p.unit||'', upc: p.units_per_carton||1, deferredRate: dd.rate, deferredDate: '', deferredType: dd.type });
        }
        purEnsureNewRow();
        purAutoFillSupplierFromProduct(p);
    }
    document.getElementById('purFastSearch').value = '';
    document.getElementById('purFastAC').classList.remove('show');
    _purFastIdx = -1;
    purRenderItems();
    purUpdateSummary();
}

// ★ أول صنف بيتضاف لفاتورة شراء لسه مالهاش مورد مختار → اقتراح المورد
//   المرتبط بالصنف (products.supplier_id) تلقائياً. ده مجرد اقتراح أولي
//   بس — المستخدم يقدر يغيّره أو يمسحه عادي من دروب داون المورد زي أي
//   اختيار يدوي (مفيش قفل). لو purSupplierId متحدد بالفعل (يدوياً أو من
//   صنف سابق)، ما بنلمسهوش. `product?.supplier_id` بأمان لأن العمود ده
//   لسه بيتضاف لجدول products من فريق تاني — لو مش موجود لسه هيرجع
//   undefined عادي من غير ما يبوّظ حاجة.
function purAutoFillSupplierFromProduct(product) {
    if (purSupplierId || !product?.supplier_id) return;
    const s = PUR_DB.suppliers.find(x => x.id === product.supplier_id);
    if (!s) return;
    purSupplierId = s.id;
    purUpdateSupplierChip();
    purToast(`🏭 تم اقتراح المورد تلقائياً: ${s.name}`, 'info');
}
function purEnsureNewRow() {
    const last = purItems[purItems.length-1];
    if (!last || last.pid) {
        purItems.push({ id: Date.now(), pid: null, name: '', code: '', qty: 1, price: 0, disc: 0, free: 0, unit: '', upc: 1, deferredRate: 0, deferredDate: '', deferredType: 'percent' });
    }
}

// ── بحث داخل خلية الصنف ──
let _purRowACIdx = {};
function purOnName(idx, val) {
    purItems[idx].name = val; purItems[idx].pid = null;
    _purRowACIdx[idx] = -1;
    const ac = document.getElementById('purAC-'+idx);
    if (!ac) return;
    const m = val.length ? PUR_DB.products.filter(p =>
        (p.name||'').includes(val) || (p.code||'').includes(val)
    ).slice(0,6) : [];
    if (m.length) {
        ac.innerHTML = m.map((p,i)=>`<div class="inv-ac-item" data-i="${i}" onclick="purPickInline(${idx},'${p.id}')" onmouseenter="purRowACHover(${idx},${i})">
            <div><div class="an">${p.name}</div><div class="as">${p.code||''} · ${p.unit||''}</div></div>
            <div class="ap"><div class="pr">${purFmt(purGetBuyPrice(p))}</div><div class="as">مخزون: ${purGetStock(p.id)}</div></div>
        </div>`).join('');
        ac.classList.add('show');
    } else ac.classList.remove('show');
}
function purOnNameKey(e, idx) {
    const ac = document.getElementById('purAC-'+idx);
    if (!ac || !ac.classList.contains('show')) return;
    const items = ac.querySelectorAll('.inv-ac-item');
    if (e.key==='ArrowDown'){e.preventDefault();_purRowACIdx[idx]=Math.min((_purRowACIdx[idx]??-1)+1,items.length-1);purRowACHover(idx,_purRowACIdx[idx]);}
    else if (e.key==='ArrowUp'){e.preventDefault();_purRowACIdx[idx]=Math.max((_purRowACIdx[idx]??-1)-1,0);purRowACHover(idx,_purRowACIdx[idx]);}
    else if (e.key==='Enter'){e.preventDefault();const ci=_purRowACIdx[idx]??-1;if(items[ci])items[ci].click();}
    else if (e.key==='Escape'){ac.classList.remove('show');_purRowACIdx[idx]=-1;}
}
function purRowACHover(idx,i){_purRowACIdx[idx]=i;const items=document.querySelectorAll('#purAC-'+idx+' .inv-ac-item');items.forEach((el,x)=>el.classList.toggle('active',x===i));items[i]?.scrollIntoView({block:'nearest'});}
function purPickInline(idx, pid) {
    const p = PUR_DB.products.find(x=>x.id===pid);
    if (!p) return;
    const buy = purGetBuyPrice(p);
    const hasManualDeferred = (purItems[idx].deferredRate||0) > 0;
    const dd = purDeferredDefaults(p);
    purItems[idx] = { id: purItems[idx].id, pid: p.id, name: p.name, code: p.code||'', qty: purItems[idx].qty||1, price: buy, disc: 0, free: purItems[idx].free||0, unit: p.unit||'', upc: p.units_per_carton||1,
        deferredRate: hasManualDeferred ? purItems[idx].deferredRate : dd.rate, deferredDate: '',
        deferredType: hasManualDeferred ? (purItems[idx].deferredType||'percent') : dd.type };
    purAutoFillSupplierFromProduct(p);
    purEnsureNewRow();
    purRenderItems(); purUpdateSummary();
    setTimeout(()=>{ const r=document.getElementById('purItemsBody')?.rows[idx]; if(r){ const inp=r.querySelectorAll('input')[2]; if(inp){inp.focus();inp.select();} } },30);
}
function purOnCode(idx, val) {
    purItems[idx].code = val;
    const p = PUR_DB.products.find(x=>x.code===val);
    if (p) purPickInline(idx, p.id);
}

// ── اختيار أصناف متعددة دفعة واحدة (مودال: بحث + checkbox + كمية) ──
// ★ نسخة مستقلة خاصة بفاتورة المشتريات — مش بتشارك كود مع أي مودال مشابه
//   في ملفات تانية (زي returns.js) ولا مع invOpenMultiPick في sales.js،
//   بنفس منطق purGetBuyPrice المستخدم في باقي الفاتورة.
let _purMultiSelected = {}; // { productId: qty }
function purOpenMultiPick() {
    document.getElementById('purMultiModal')?.remove();
    const m = document.createElement('div');
    m.id = 'purMultiModal';
    m.className = 'mod-modal-bg active';
    m.innerHTML = `
    <div class="mod-modal" style="max-width:640px">
        <div class="mod-modal-header"><h3>☑️ اختيار أصناف متعددة</h3>
            <button class="mod-modal-close" onclick="purCloseMultiPick()">✕</button></div>
        <div class="mod-modal-body">
            <input type="text" class="mod-form-input" id="purMultiSearch" placeholder="بحث بالاسم / الكود..." autocomplete="off" oninput="purRenderMultiPickList(this.value)">
            <div id="purMultiPickList" style="margin-top:12px;display:flex;flex-direction:column;gap:6px"></div>
        </div>
        <div class="mod-modal-footer">
            <button class="inv-btn inv-btn-print" onclick="purCloseMultiPick()">إلغاء</button>
            <button class="inv-btn inv-btn-save" onclick="purAddMultiPicked()" style="background:linear-gradient(135deg,#16A34A,#22C55E)">➕ إضافة المحدد</button>
        </div>
    </div>`;
    document.body.appendChild(m);
    _purMultiSelected = {};
    purRenderMultiPickList('');
    setTimeout(()=>document.getElementById('purMultiSearch')?.focus(), 50);
}
function purCloseMultiPick() {
    document.getElementById('purMultiModal')?.remove();
    _purMultiSelected = {};
}
function purRenderMultiPickList(val) {
    const box = document.getElementById('purMultiPickList');
    if (!box) return;
    const v = (val||'').trim();
    const list = v ? PUR_DB.products.filter(p => (p.name||'').includes(v) || (p.code||'').includes(v)) : PUR_DB.products;
    if (!list.length) { box.innerHTML = '<div style="padding:20px;text-align:center;color:#94A3B8">لا توجد نتائج</div>'; return; }
    box.innerHTML = list.slice(0, 200).map(p => {
        const sel = _purMultiSelected[p.id];
        const checked = sel != null;
        const qty = sel ?? 1;
        return `<label class="pur-multi-row" data-pid="${p.id}" style="display:flex;align-items:center;gap:10px;padding:7px 10px;border:1.5px solid #E2E8F0;border-radius:10px;cursor:pointer">
            <input type="checkbox" ${checked?'checked':''} onchange="purMultiToggle('${p.id}',this.checked)">
            <span style="flex:1">${p.name} <small style="color:#94A3B8">${p.code||''} · ${p.unit||''}</small></span>
            <span style="font-size:11px;color:#94A3B8">مخزون: ${purGetStock(p.id)}</span>
            <span style="font-size:12px;color:#0F172A;font-weight:600">${purFmt(purGetBuyPrice(p))}</span>
            <input type="number" class="mod-form-input" value="${qty}" min="0.001" step="0.001" style="width:76px;padding:6px 8px"
                onclick="event.stopPropagation()" oninput="purMultiSetQty('${p.id}',this.value)">
        </label>`;
    }).join('');
}
function purMultiToggle(pid, checked) {
    if (checked) { if (_purMultiSelected[pid] == null) _purMultiSelected[pid] = 1; }
    else delete _purMultiSelected[pid];
}
function purMultiSetQty(pid, val) {
    const q = parseFloat(val) || 0;
    if (q <= 0) return;
    _purMultiSelected[pid] = q;
    const cb = document.querySelector(`.pur-multi-row[data-pid="${pid}"] input[type=checkbox]`);
    if (cb && !cb.checked) cb.checked = true;
}
function purAddMultiPicked() {
    const ids = Object.keys(_purMultiSelected);
    if (!ids.length) { purToast('⚠️ لم يتم اختيار أي صنف', 'error'); return; }
    let added = 0;
    let lastPickedProduct = null;
    ids.forEach(pid => {
        const p = PUR_DB.products.find(x => x.id === pid);
        if (!p) return;
        const qty = _purMultiSelected[pid] || 1;
        const ex = purItems.findIndex(i => i.pid === pid);
        if (ex >= 0) {
            purItems[ex].qty = (purItems[ex].qty || 0) + qty;
        } else {
            const buy = purGetBuyPrice(p);
            const dd = purDeferredDefaults(p);
            const last = purItems[purItems.length-1];
            if (last && !last.pid) {
                last.pid = p.id; last.name = p.name; last.code = p.code||'';
                last.unit = p.unit||''; last.price = buy; last.qty = qty; last.upc = p.units_per_carton||1;
                last.deferredRate = dd.rate; last.deferredType = dd.type;
            } else {
                purItems.push({ id: Date.now()+added, pid: p.id, name: p.name, code: p.code||'', qty, price: buy, disc: 0, free: 0, unit: p.unit||'', upc: p.units_per_carton||1, deferredRate: dd.rate, deferredDate: '', deferredType: dd.type });
            }
        }
        lastPickedProduct = p;
        added++;
    });
    if (lastPickedProduct) purAutoFillSupplierFromProduct(lastPickedProduct);
    purEnsureNewRow();
    purRenderItems();
    purUpdateSummary();
    purCloseMultiPick();
    purToast(`➕ تمت إضافة ${added} صنف دفعة واحدة`, 'success');
}

// ════════════════════════════════════════════════════════════
// 6) التحكم في السطور
// ════════════════════════════════════════════════════════════
function purAddRow() {
    const last = purItems[purItems.length-1];
    if (last && !last.pid) {
        purFocusRow(purItems.length-1, 1);
        return;
    }
    purItems.push({ id: Date.now(), pid: null, name: '', code: '', qty: 1, price: 0, disc: 0, free: 0, unit: '', upc: 1, deferredRate: 0, deferredDate: '', deferredType: 'percent' });
    purRenderItems(); purUpdateSummary();
    purFocusRow(purItems.length-1, 1);
}
function purFocusRow(idx, inputIdx) {
    setTimeout(()=>{ const r=document.getElementById('purItemsBody')?.rows[idx]; if(!r) return; const inp=r.querySelectorAll('input')[inputIdx]; if(inp){inp.focus();inp.select?.();} },40);
}
function purRemoveRow(idx) {
    purItems.splice(idx,1);
    if (!purItems.length) purItems.push({ id: Date.now(), pid: null, name:'',code:'',qty:1,price:0,disc:0,free:0,unit:'',upc:1,deferredRate:0,deferredDate:'',deferredType:'percent' });
    purRenderItems(); purUpdateSummary();
}
function purRowKey(e, idx, field) {
    if (e.key === 'Enter') { e.preventDefault(); purMoveNextField(idx, field); }
}
function purMoveNextField(idx, field) {
    const row = document.getElementById('purItemsBody')?.rows[idx];
    if (!row) return;
    const inputs = row.querySelectorAll('input');
    const order = ['code','name','qty','price'];
    const cur = order.indexOf(field);
    if (cur < order.length-1) { inputs[cur+1]?.focus(); inputs[cur+1]?.select?.(); }
    else { purEnsureNewRow(); purRenderItems(); setTimeout(()=>{ const r=document.getElementById('purItemsBody')?.rows[idx+1]; r?.querySelectorAll('input')[1]?.focus(); },30); }
}

// ════════════════════════════════════════════════════════════
// 7) الدفع + المتبقّي
// ════════════════════════════════════════════════════════════
function purSetPayType(t) {
    purPayType = t;
    const sel = document.getElementById('purPayType');
    if (sel) sel.value = t;
    document.getElementById('purCashPanel').classList.toggle('show', t==='cash');
    if (t==='cash') setTimeout(()=>document.getElementById('purCashPaid')?.focus(),50);
}
function purTogglePayType() { purSetPayType(purPayType === 'cash' ? 'credit' : 'cash'); }
function purSetExactCash() {
    const { net } = purCalcNet();
    document.getElementById('purCashPaid').value = net.toFixed(2);
    purCalcChange();
}
function purCalcChange() {
    const { net } = purCalcNet();
    const paid = parseFloat(document.getElementById('purCashPaid')?.value)||0;
    const remain = net - paid;
    const el = document.getElementById('purChange');
    if (el) el.textContent = purFmt(remain>0?remain:0);
}

// ═══════════════ INSERT فقط — الـ Triggers تتولى الباقي ═══════════════
async function purReverseOldForEdit() {
    // ★ عملية واحدة ذرّية في قاعدة البيانات بدل 3 نداءات منفصلة —
    //   راجع نفس التعليق في invReverseOldForEdit (sales.js) وملف
    //   edit_reversal_atomic_migration.sql.
    const { error } = await sb.rpc('fn_reverse_purchase_for_edit', { p_purchase_id: purEditingId });
    if (error) throw error;

    // تحديث الكاش المحلي (تقدير للعرض بس) بنفس القيم اللي السيرفر طبّقها فعلاً
    if (purEditingOldWarehouse) {
        for (const it of purEditingOldItems) {
            const need = Number(it.qty) || 0;
            if (!it.product_id || !need) continue;
            const key = purEditingOldWarehouse + '|' + it.product_id;
            PUR_DB.stockMap[key] = (PUR_DB.stockMap[key] || 0) - need;
        }
    }
    if (purEditingOldPayType === 'credit' && purEditingOldSupplierId) {
        const s = PUR_DB.suppliers.find(x => x.id === purEditingOldSupplierId);
        if (s) s.balance = (Number(s.balance) || 0) - purEditingOldTotal;
    }
}

async function purSave(andNew) {
    const filled = purItems.filter(i => i.pid && (i.qty||0) > 0);
    if (!filled.length) { purToast('⚠️ الفاتورة فارغة — أضف أصنافاً أولاً', 'error'); return; }

    if (!purSupplierId) {
        if (!confirm('لم تختر مورداً. سيتم تسجيل الفاتورة كمورد نقدي. هل تريد المتابعة؟')) return;
    }

    const { subtotal, rowsDisc, extra, deferred, net } = purCalcNet();
    let invoiceNo = 'PUR-' + String(PUR_DB.purchaseNo).padStart(4, '0');

    const saveBtns = document.querySelectorAll('.inv-btn-save, .inv-top-save');
    saveBtns.forEach(b => { b.innerText = '⏳ جاري الحفظ...'; b.disabled = true; });

    try {
        // ★ لو في وضع تعديل: ألغِ فاتورة الشراء القديمة وارجع المخزون والرصيد قبل إنشاء النسخة الجديدة
        if (purEditingId) {
            await purReverseOldForEdit();
        }

        // ★ إنشاء الهيدر + البنود + زيادة العداد كلهم في ترانزاكشن واحدة عبر
        //   fn_create_purchase (Postgres RPC) — بدل 3 خطوات منفصلة من
        //   الفرونت إند. السبب: fn_purchase_status_change (تريجر AFTER
        //   INSERT على purchases) بيرحّل قيد اليومية ويأثّر على رصيد المورد
        //   فور INSERT الهيدر — قبل ما البنود تتسجل أصلاً. لو إدراج البنود
        //   فشل لأي سبب، كان بيفضل هيدر "confirmed" معلّق بقيد وبرصيد متأثر
        //   من غير بنود، والعداد (purchase_counter) ميترفعش، فأي محاولة
        //   تانية كانت هتتصادم على نفس invoice_no — نفس فخ return_no/
        //   journal_entries المكرر اللي اتصلح في مرتجعات الشراء النهاردة.
        const itemsPayload = filled.map(it => {
            const prod = PUR_DB.products.find(p=>p.id===it.pid);
            const lineTotal = (it.qty||0) * (it.price||0) * (1 - (it.disc||0)/100);
            // deferred_rebates.expected_amount في القاعدة = qty * rate (generated
            // column ثابت)، يعني "rate" لازم يوصل دايماً كمبلغ فعلي للوحدة —
            // لو المستخدم اختار % هنا بنحوّلها لمبلغ للوحدة *قبل* الحفظ، بحيث
            // qty*rate في القاعدة يطابق بالظبط اللي شايفه في إجمالي الفاتورة.
            const deferredPerUnit = (it.deferredType||'percent') === 'fixed'
                ? (it.deferredRate || 0)
                : (it.price||0) * (1 - (it.disc||0)/100) * (it.deferredRate||0) / 100;
            return {
                product_id: it.pid,
                qty: it.qty,
                unit_price: it.price,
                line_total: lineTotal,
                deferred_rate: deferredPerUnit,
                deferred_type: it.deferredType || 'percent',
                deferred_due_date: deferredPerUnit > 0 ? (document.getElementById('purDate')?.value || null) : null,
                units_per_carton_snapshot: prod?.units_per_carton || 1,
            };
        });
        const { data: rpcRows, error: rpcErr } = await sb.rpc('fn_create_purchase', {
            p_supplier_id: purSupplierId || null,
            p_payment_type: purPayType,
            p_subtotal: subtotal,
            p_vat_amount: 0,
            p_total: net,
            p_warehouse_id: purWarehouseId,
            p_treasury_id: purPayType === 'cash' ? (document.getElementById('purTreasuryId')?.value || purTreasuryId || null) : null,
            p_created_by: currentUser?.id || null,
            p_items: itemsPayload,
        });
        if (rpcErr) throw rpcErr;
        if (rpcRows?.[0]?.invoice_no) invoiceNo = rpcRows[0].invoice_no;
        // العداد بيتقفل ويتحرك جوه الـ RPC نفسها — نطابق العرض المحلي على
        // الرقم الحقيقي اللي الدالة رجّعته
        const invoiceNoMatch = invoiceNo.match(/(\d+)$/);
        if (invoiceNoMatch) PUR_DB.purchaseNo = parseInt(invoiceNoMatch[1], 10) + 1;

        // ★ لو الفاتورة دي جاية من تحويل أمر شراء، اتعلّم "تم الاستلام"
        //   دلوقتي بس — بعد ما فاتورة الشراء الحقيقية اتسجّلت بنجاح فعلاً،
        //   مش قبل كده (راجع التعليق في purchase-orders.js لسبب التعديل).
        if (purPendingPOOrderId) {
            try {
                await sb.from('purchase_orders').update({ status: 'received' }).eq('id', purPendingPOOrderId);
            } catch {}
            purPendingPOOrderId = null;
        }

        localStorage.removeItem(PUR_AUTOSAVE_KEY);
        if (purEditingId) {
            purToast(`✅ تم إلغاء فاتورة الشراء ${purEditingOldInvoiceNo} وتسجيل الفاتورة المعدّلة ${invoiceNo} — ${purFmt(net)} ج.م`, 'success');
            purEditingId = null; purEditingOldItems = []; purEditingOldInvoiceNo = null;
        } else {
            purToast(`✅ تم حفظ فاتورة المشتريات ${invoiceNo} — ${purFmt(net)} ج.م`, 'success');
        }

        try {
            const { data: cash } = await sb.rpc('get_cash_balance');
            const tb = document.getElementById('topbarCash');
            if (tb) tb.textContent = '💰 ' + (cash || 0).toFixed(2) + ' ج.م';
        } catch {}

        // ★ أي حفظ ناجح بيفتح فاتورة شراء جديدة فاضية دايماً (زي andNew بالظبط،
        //   ونفس تصحيح invSave في sales.js) — قبل كده كان الحفظ العادي (زرار
        //   "حفظ" بدون andNew) بيسيب الأصناف القديمة ظاهرة وبس بيغيّر رقم
        //   الفاتورة في الشارة، فالمستخدم كان بيفضل واقف على نفس الأصناف
        //   ويقدر يحفظها تاني بالغلط فوق فاتورة جديدة.
        renderPurchases(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ أثناء حفظ الفاتورة: ' + err.message);
    } finally {
        saveBtns.forEach(b => { b.disabled = false; });
    }
}
function purClose() {
    if (confirm('إغلاق فاتورة المشتريات؟')) {
        purStopAutoSave();
        document.getElementById('app-content').innerHTML = '<div class="empty-state"><span>📥</span>اضغط "المشتريات" لإنشاء فاتورة جديدة</div>';
    }
}
function purOnWarehouseChange() {
    const sel = document.getElementById('purWarehouse');
    if (sel) purWarehouseId = sel.value;
    purRenderItems(); purUpdateSummary();
}

// ════════════════════════════════════════════════════════════
// 7ب) المسودات (تعليق فاتورة) + الحفظ التلقائي — نفس نمط sales.js
//     بالحرف (invDraft/invStartAutoSave...) — كان ناقص من قبل، وده كان
//     بيعني إن أي انقطاع كهرباء أو قفل تاب غلط في نص فاتورة شراء طويلة
//     بيضيّع كل حاجة من غير أي حماية.
// ════════════════════════════════════════════════════════════
const PUR_DRAFTS_KEY = 'pur_drafts';
const PUR_AUTOSAVE_KEY = 'pur_autosave';

function purGetDrafts() { try { return JSON.parse(localStorage.getItem(PUR_DRAFTS_KEY) || '[]'); } catch { return []; } }
function purSetDrafts(arr) { localStorage.setItem(PUR_DRAFTS_KEY, JSON.stringify(arr)); }

function purSnapshot() {
    const { net } = purCalcNet();
    return {
        items: JSON.parse(JSON.stringify(purItems)),
        supplierId: purSupplierId, payType: purPayType,
        discExtra: parseFloat(document.getElementById('purDiscExtra')?.value) || 0,
        notes: document.getElementById('purNotes')?.value || '',
        date: document.getElementById('purDate')?.value || new Date().toISOString().split('T')[0],
        net,
        savedAt: Date.now(),
    };
}

function purDraft() {
    const filled = purItems.filter(i => i.pid);
    if (!filled.length) { purToast('⚠️ لا يمكن تعليق فاتورة فارغة', 'error'); return; }
    const snap = purSnapshot();
    const drafts = purGetDrafts();
    snap.id = Date.now();
    snap.title = purSupplierId ? (PUR_DB.suppliers.find(s => s.id === purSupplierId)?.name || 'مورد') : 'مورد نقدي';
    drafts.unshift(snap);
    purSetDrafts(drafts);
    purRenderDrafts();
    purToast(`📋 تم تعليق فاتورة الشراء (${purFmt(snap.net)} ج.م)`, 'success');
    renderPurchases(document.getElementById('app-content'));
}

function purRestoreDraft(id) {
    const drafts = purGetDrafts();
    const d = drafts.find(x => x.id === id);
    if (!d) return;
    if (purItems.filter(i => i.pid).length) {
        if (!confirm('الفاتورة الحالية فيها أصناف. استبدالها بالمسودة المعلّقة؟')) return;
    }
    purItems = d.items; purSupplierId = d.supplierId; purPayType = d.payType;
    document.getElementById('purDiscExtra').value = d.discExtra || 0;
    document.getElementById('purNotes').value = d.notes || '';
    document.getElementById('purDate').value = d.date || new Date().toISOString().split('T')[0];
    document.getElementById('purPayType').value = d.payType;
    purSetPayType(d.payType);
    purRenderItems(); purUpdateSummary(); purUpdateSupplierChip();
    purRenderDrafts();
    purToast('♻️ تم استرجاع فاتورة الشراء المعلّقة', 'success');
}

function purDeleteDraft(id, ev) {
    ev?.stopPropagation();
    const drafts = purGetDrafts().filter(x => x.id !== id);
    purSetDrafts(drafts);
    purRenderDrafts();
    purToast('🗑️ تم حذف المسودة', 'info');
}

function purRenderDrafts() {
    const card = document.getElementById('purDraftsCard');
    const list = document.getElementById('purDraftsList');
    const cnt  = document.getElementById('purDraftCount');
    if (!card) return;
    const drafts = purGetDrafts();
    card.classList.toggle('has', drafts.length > 0);
    if (cnt) cnt.textContent = drafts.length;
    if (!list) return;
    list.innerHTML = drafts.slice(0, 8).map(d => `
        <div class="inv-draft-item" onclick="purRestoreDraft(${d.id})">
            <span class="di-ic">📥</span>
            <div class="di-info">
                <div class="di-title">${d.title || 'مورد نقدي'}</div>
                <div class="di-sub">${purTimeAgo(d.savedAt)} · ${d.items.filter(i=>i.pid).length} صنف</div>
            </div>
            <span class="di-amt">${purFmt(d.net)}</span>
            <button class="di-del" onclick="purDeleteDraft(${d.id},event)" title="حذف">✕</button>
        </div>`).join('');
}

function purTimeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'الآن';
    if (s < 3600) return Math.floor(s / 60) + ' دقيقة';
    if (s < 86400) return Math.floor(s / 3600) + ' ساعة';
    return Math.floor(s / 86400) + ' يوم';
}

let _purAutoSaveTimer = null;
function purStartAutoSave() {
    purStopAutoSave();
    _purAutoSaveTimer = setInterval(() => {
        const filled = purItems.filter(i => i.pid);
        if (filled.length) {
            localStorage.setItem(PUR_AUTOSAVE_KEY, JSON.stringify(purSnapshot()));
        }
    }, 5000);
}
function purStopAutoSave() { if (_purAutoSaveTimer) { clearInterval(_purAutoSaveTimer); _purAutoSaveTimer = null; } }
function purCheckAutoSaveRestore() {
    try {
        const saved = JSON.parse(localStorage.getItem(PUR_AUTOSAVE_KEY) || 'null');
        if (saved && saved.items && saved.items.filter(i => i.pid).length) {
            const mins = Math.floor((Date.now() - (saved.savedAt || 0)) / 60000);
            if (confirm(`♻️ يوجد فاتورة شراء محفوظة تلقائياً (${mins} دقيقة). استعادتها؟`)) {
                purItems = saved.items; purSupplierId = saved.supplierId; purPayType = saved.payType;
                document.getElementById('purDiscExtra').value = saved.discExtra || 0;
                document.getElementById('purNotes').value = saved.notes || '';
                document.getElementById('purDate').value = saved.date || new Date().toISOString().split('T')[0];
                document.getElementById('purPayType').value = saved.payType;
                purSetPayType(saved.payType);
                purRenderItems(); purUpdateSummary(); purUpdateSupplierChip();
                purToast('♻️ تمت استعادة فاتورة الشراء المحفوظة', 'success');
            }
            localStorage.removeItem(PUR_AUTOSAVE_KEY);
        }
    } catch {}
}

// ════════════════════════════════════════════════════════════
// 8) الأدوات المساعدة + الأحداث
// ════════════════════════════════════════════════════════════
function purFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function purToast(msg, type='info') {
    let t = document.getElementById('invToast');
    if (!t) { t = document.createElement('div'); t.id = 'invToast'; t.className = 'inv-toast'; document.body.appendChild(t); }
    t.className = 'inv-toast ' + type;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window._invToastT);
    window._invToastT = setTimeout(()=>t.classList.remove('show'), 2600);
}

function purBindEvents() {
    const ss = document.getElementById('purSuppSearch');
    ss?.addEventListener('input', ()=>{ _purSuppACIdx=-1; purSearchSupplier(ss.value); });
    ss?.addEventListener('focus', ()=>{ _purSuppACIdx=-1; purSearchSupplier(ss.value); });
    ss?.addEventListener('keydown', purSuppACKey);

    const fs = document.getElementById('purFastSearch');
    fs?.addEventListener('input', ()=>{ _purFastIdx=-1; purFastSearch(fs.value); });
    fs?.addEventListener('focus', ()=>{ _purFastIdx=-1; purFastSearch(fs.value); });
    fs?.addEventListener('keydown', purFastKey);

    document.getElementById('app-content').addEventListener('keydown', purGlobalKeys);
}
// نفس اختصارات فاتورة المبيعات بالحرف (راجع invGlobalKeys في sales.js) —
// بعد ما كانت فاتورة المشتريات فيها Alt+S/N/D/F وF4/F8 بس، من غير باقي
// اختصارات فاتورة المبيعات (F1 المساعدة، F2 بحث المورد، F9 المبلغ بالضبط،
// Alt+T تبديل نقدي/آجل، Alt+C نقدي، Insert سطر جديد). Alt+P (طباعة) اتسابت
// عمداً — فاتورة المشتريات مفيهاش خاصية طباعة أصلاً.
function purGlobalKeys(e) {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    // اختصارات Alt+ (بدل Ctrl+S/Ctrl+N اللي بتتصادم مع اختصارات كروم المحجوزة)
    if (e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 's') { e.preventDefault(); purSave(false); return; }         // Alt+S حفظ
        if (k === 'n') { e.preventDefault(); purSave(true); return; }          // Alt+N فاتورة جديدة
        if (k === 'd') { e.preventDefault(); purDraft(); return; }             // Alt+D تعليق
        if (k === 'f') { e.preventDefault(); document.getElementById('purFastSearch')?.focus(); return; }  // Alt+F بحث صنف
        if (k === 't') { e.preventDefault(); purTogglePayType(); return; }     // Alt+T تبديل نقدي/آجل
        if (k === 'c') { e.preventDefault(); purSetPayType('cash'); return; }  // Alt+C نقدي
        return;
    }
    // F-keys الآمنة (غير محجوزة في أي متصفح) — F3=بحث الصفحة وF5=تحديث محجوزين في كروم
    if (e.key === 'F1') { e.preventDefault(); purShowShortcuts(); return; }    // لوحة المساعدة
    if (e.key === 'F2') { e.preventDefault(); document.getElementById('purSuppSearch')?.focus(); return; }
    if (e.key === 'F4') { e.preventDefault(); purSave(false); return; }
    if (e.key === 'F8') { e.preventDefault(); purDraft(); return; }
    if (e.key === 'F9') { e.preventDefault(); purSetExactCash(); document.getElementById('purCashPaid')?.focus(); return; }

    if (!inField && e.key === 'Insert') { e.preventDefault(); purAddRow(); return; }

    if (e.key === 'Escape') {
        const open = document.querySelector('.inv-ac.show');
        if (open) { open.classList.remove('show'); return; }
        const shortcutsModal = document.getElementById('purShortcutsModal');
        if (shortcutsModal?.classList.contains('active')) { purCloseShortcuts(); return; }
        if (document.getElementById('purMultiModal')) { purCloseMultiPick(); return; }
    }
}

function purShowShortcuts() {
    let m = document.getElementById('purShortcutsModal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'purShortcutsModal'; m.className = 'mod-modal-bg';
        m.innerHTML = `<div class="mod-modal" style="max-width:560px">
            <div class="mod-modal-header"><h3>⌨️ اختصارات لوحة المفاتيح</h3>
                <button class="mod-modal-close" onclick="purCloseShortcuts()">✕</button></div>
            <div class="mod-modal-body" style="display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;font-size:13px">
                ${purShortcutList().map(s=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #F1F5F9"><span style="color:#475569">${s.d}</span><kbd style="background:#0F172A;color:#4ADE80;border-radius:5px;padding:2px 8px;font-size:11px;font-family:inherit">${s.k}</kbd></div>`).join('')}
            </div></div>`;
        document.body.appendChild(m);
    }
    m.classList.add('active');
}
function purCloseShortcuts() { document.getElementById('purShortcutsModal')?.classList.remove('active'); }
function purShortcutList() {
    return [
        {d:'بحث مورد', k:'F2'}, {d:'بحث صنف سريع', k:'Alt+F'},
        {d:'حفظ الفاتورة', k:'F4 / Alt+S'}, {d:'حفظ + فاتورة جديدة', k:'Alt+N'},
        {d:'تبديل نقدي/آجل', k:'Alt+T'}, {d:'نقدي', k:'Alt+C'},
        {d:'تعليق (مسودة)', k:'F8 / Alt+D'}, {d:'المبلغ بالضبط', k:'F9'},
        {d:'هذه اللوحة', k:'F1'}, {d:'طي القائمة الجانبية', k:'Alt+H'},
        {d:'سطر جديد', k:'Insert'}, {d:'تنقل بين النتائج', k:'↑ ↓'},
        {d:'اختيار من القائمة', k:'Enter'}, {d:'إغلاق القائمة', k:'Esc'},
        {d:'الحقل التالي', k:'Tab'},
    ];
}

Object.assign(window, {
    renderPurchases, purSave, purClose, purAddRow, purRemoveRow, purFocusRow,
    purSetPayType, purSetExactCash, purCalcChange,
    purSelectSupplier, purClearSupplier, purPickProduct, purPickInline,
    purOnName, purOnNameKey, purOnCode, purRowKey, purUpdateSummary, purUpdateRowTotal,
    purRowACHover, purSuppACHover, purFastHover,
    purOnWarehouseChange,
    purDraft, purRestoreDraft, purDeleteDraft,
});
