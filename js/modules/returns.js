/* ════════════════════════════════════════════════════════════
   المرتجعات — مرتجع مبيعات + مرتجع مشتريات
   يصدّر: renderReturns(container)

   ★ نفس تخطيط فاتورة المبيعات (sales.js) بالضبط — رأس ثنائي (inv-header)
   + جدول أصناف (inv-table) ببحث سريع + عمود جانبي (inv-side) للإجماليات
   والحفظ/الطباعة. الفرق المنطقي فقط: وضعين للإدخال —
   "مرتبط بفاتورة" (الأصناف تتحمّل تلقائياً من فاتورة موجودة، بحد أقصى
   للكمية = الكمية الأصلية بالفاتورة) أو "مستقل" (بحث/إضافة يدوية حرة).

   الجداول: sales_returns / sale_return_items
            purchase_returns / purchase_return_items
   ⚠️ الجداول والـ Trigger الخاص بتحديث المخزون ورصيد العميل/المورد
   يجب إنشاؤها في Supabase أولاً (راجع ملف returns_migration.sql المرفق).
   نفس فلسفة customer_payments في collections.js: الواجهة بتعمل
   INSERT فقط، والـ Trigger في قاعدة البيانات هو اللي بيحرّك
   المخزون والأرصدة والقيد المحاسبي تلقائياً — منطق الحفظ ده لم يتغيّر.
   ════════════════════════════════════════════════════════════ */

let RET_DB = { customers: [], suppliers: [], products: [], warehouses: [], list: [], stockMap: {}, rsCounter: 1, rpCounter: 1 };
let retType = 'sales';      // 'sales' | 'purchase'
let retMode = 'linked';     // 'linked' (مرتبط بفاتورة) | 'manual' (مستقل)
let retLinkedDoc = null;    // الفاتورة الأصلية لو في وضع linked
let retEntityId = null;     // customer_id أو supplier_id
let retWarehouseId = null;
let retItems = [];          // { id, pid, name, code, unit, qty, price, disc, maxQty }
let retTableMissing = false;

// ════════════════════════════════════════════════════════════
// 0) تحميل البيانات + التقديم الرئيسي
// ════════════════════════════════════════════════════════════
async function renderReturns(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات المرتجعات...</div>';
    RET_DB.isOfflineData = false;
    RET_DB.offlineDataAge = null;
    try {
        const [r1, r2, r3, r4, r5] = await Promise.all([
            sb.from('customers').select('id,name,phone,balance').eq('is_active', true).order('name'),
            sb.from('suppliers').select('id,name,phone,balance').eq('is_active', true).order('name'),
            sb.from('products').select('id,name,code,unit,wholesale_price,retail_price,purchase_price').eq('is_active', true).order('name'),
            sb.from('warehouses').select('id,name,is_main').order('name'),
            sb.from('inventory_stock').select('warehouse_id, product_id, qty'),
        ]);
        if (r1.error || !r1.data || r3.error || !r3.data) throw (r1.error || r3.error || new Error('no data'));
        RET_DB.customers = r1.data;
        RET_DB.suppliers = r2.data || [];
        RET_DB.products = r3.data;
        RET_DB.warehouses = r4.data || [];
        RET_DB.stockMap = {};
        (r5.data || []).forEach(r => { RET_DB.stockMap[r.warehouse_id + '|' + r.product_id] = Number(r.qty) || 0; });
        if (typeof dbSetCache === 'function') {
            dbSetCache('customers', RET_DB.customers);
            dbSetCache('suppliers', RET_DB.suppliers);
        }
    } catch (err) {
        // فشل التحميل الحي (أوفلاين أو خطأ شبكة) → ارجع لآخر نسخة محفوظة في الكاش
        // (المخزون نفسه مش متاح أوفلاين — بيفضل فاضي وبيتقدّر بس من طابور المرتجعات المعلّقة)
        if (typeof dbGetCache === 'function') {
            const [cc, cs, cp, cw] = await Promise.all([dbGetCache('customers'), dbGetCache('suppliers'), dbGetCache('products'), dbGetCache('warehouses')]);
            if (cc?.data?.length || cp?.data?.length) {
                RET_DB.customers = cc?.data || [];
                RET_DB.suppliers = cs?.data || [];
                RET_DB.products = cp?.data || [];
                RET_DB.warehouses = cw?.data || [];
                RET_DB.stockMap = {};
                RET_DB.isOfflineData = true;
                RET_DB.offlineDataAge = Math.min(cc?.updatedAt || Date.now(), cp?.updatedAt || Date.now());
            } else {
                c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ في تحميل البيانات: ${err.message || 'تعذر تحميل البيانات'}</div>`;
                return;
            }
        } else {
            c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ في تحميل البيانات: ${err.message || 'تعذر تحميل البيانات'}</div>`;
            return;
        }
    }

    // إعادة ضبط الحالة
    retType = 'sales'; retMode = 'linked'; retLinkedDoc = null; retEntityId = null; retItems = [];
    const mainWh = RET_DB.warehouses.find(w => w.is_main) || RET_DB.warehouses[0];
    retWarehouseId = mainWh?.id || null;

    // مرتجعات مبيعات اتسجّلت أوفلاين ولسه في الطابور — طرح أثرها من المخزون المعروض (تقدير تراكمي)
    await retApplyPendingEstimates();

    if (!RET_DB.isOfflineData) {
        await Promise.all([retLoadRecent(), retLoadCounterPreview()]);
    } else {
        RET_DB.list = [];
        retTableMissing = false;
    }
    await retLoadPendingList();

    retRenderScreen(c);
    // ★ اربط اختصارات الكيبورد مرة واحدة بس على العنصر الثابت #app-content
    //   (removeEventListener قبل add يمنع تراكم أكتر من نسخة عند إعادة فتح الصفحة)
    c.removeEventListener('keydown', retGlobalKeys);
    c.addEventListener('keydown', retGlobalKeys);
}

// تقدير محلي تراكمي: يطرح فواتير مرتجع المبيعات المعلّقة (لسه ماتزامنتش)
// من المخزون المعروض — نفس فكرة invApplyPendingEstimates في sales.js
// (بس بالعكس: المرتجع بيرجّع كمية للمخزون بدل ما يخصمها).
async function retApplyPendingEstimates() {
    if (typeof getQueue !== 'function') return;
    try {
        const pending = await getQueue(e => e.module === 'returns' && e.kind === 'sale_return' && (e.status === 'pending' || e.status === 'failed' || e.status === 'syncing'));
        for (const entry of pending) {
            for (const d of (entry.payload?._stockDeltas || [])) {
                const key = d.warehouseId + '|' + d.productId;
                RET_DB.stockMap[key] = (RET_DB.stockMap[key] || 0) + (Number(d.qty) || 0);
            }
        }
    } catch {}
}

async function retLoadRecent() {
    const table = retType === 'sales' ? 'sales_returns' : 'purchase_returns';
    const entityJoin = retType === 'sales' ? 'customers(name)' : 'suppliers(name)';
    retTableMissing = false;
    try {
        const { data, error } = await sb.from(table).select(`*, ${entityJoin}`).order('created_at', { ascending: false }).limit(30);
        if (error) throw error;
        RET_DB.list = data || [];
    } catch (e) {
        retTableMissing = true; // الجدول لسه ما اتعملش في Supabase
        RET_DB.list = [];
    }
}

async function retLoadCounterPreview() {
    const [{ data: rsRow }, { data: rpRow }] = await Promise.all([
        sb.from('app_settings').select('value').eq('key', 'sales_return_counter').maybeSingle(),
        sb.from('app_settings').select('value').eq('key', 'purchase_return_counter').maybeSingle(),
    ]);
    RET_DB.rsCounter = parseInt(rsRow?.value) || 1;
    RET_DB.rpCounter = parseInt(rpRow?.value) || 1;
}

window.retSwitchType = async function (type) {
    if (retType === type) return;
    if (retItems.filter(i => i.pid).length && !confirm('سيتم فقد البيانات غير المحفوظة. تبديل نوع المرتجع؟')) return;
    retType = type; retMode = 'linked'; retLinkedDoc = null; retEntityId = null; retItems = [];
    if (!RET_DB.isOfflineData) await retLoadRecent();
    await retLoadPendingList();
    retRenderScreen(document.getElementById('app-content'));
};

window.retSwitchMode = function (mode) {
    if (retMode === mode) return;
    if (retItems.filter(i => i.pid).length && !confirm('سيتم فقد البيانات غير المحفوظة. تبديل طريقة الإدخال؟')) return;
    retMode = mode; retLinkedDoc = null; retEntityId = null; retItems = [];
    retRenderScreen(document.getElementById('app-content'));
};

// رقم مرتجع مؤقت وقت الأوفلاين (مرتجع مبيعات بس — نفس فكرة
// invNextOfflineInvoiceNo في sales.js) — بيتستبدل برقم رسمي RS-XXXX
// وقت نجاح المزامنة.
function retNextOfflineReturnNo() {
    const key = 'ret_offline_seq';
    let seq = (parseInt(localStorage.getItem(key) || '0', 10) || 0) + 1;
    localStorage.setItem(key, String(seq));
    const deviceId = typeof offlineGetDeviceId === 'function' ? offlineGetDeviceId() : 'DEV';
    return `OFFLINE-${deviceId}-${seq}`;
}

// تخصيص رقم مرتجع رسمي حي وقت المزامنة + حماية من تصادم الرقم (نفس
// منطق invAllocateRealInvoiceNo في sales.js).
async function retAllocateRealReturnNo() {
    const { data: counterRow } = await sb.from('app_settings').select('value').eq('key', 'sales_return_counter').maybeSingle();
    let counter = parseInt(counterRow?.value) || 1;
    for (let attempt = 0; attempt < 5; attempt++) {
        const returnNo = 'RS-' + String(counter).padStart(4, '0');
        const { data: dupCheck } = await sb.from('sales_returns').select('id').eq('return_no', returnNo).maybeSingle();
        if (!dupCheck) return { returnNo, counter };
        counter++;
    }
    return { returnNo: 'RS-' + String(counter).padStart(4, '0') + '-' + Date.now().toString().slice(-4), counter };
}

// ════════════════════════════════════════════════════════════
// 1) قوالب HTML للأقسام (نفس بنية inv-header/inv-main/inv-side بتاعة sales.js)
// ════════════════════════════════════════════════════════════
function retRenderScreen(c) {
    c.innerHTML = `
    <div class="inv-root density-cozy">
        ${retTableMissing ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:9px 16px;border-radius:9px;margin-bottom:8px;font-size:12px">
            ⚠️ <strong>تنبيه:</strong> جدول <code>${retType === 'sales' ? 'sales_returns' : 'purchase_returns'}</code> أو جدول البنود المرتبط به غير مكتمل في قاعدة البيانات بعد.
            شغّل ملف <code>returns_migration.sql</code> في Supabase أولاً حتى تتحرّك المخازن والأرصدة تلقائياً.
        </div>` : ''}
        ${RET_DB.isOfflineData ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:9px 16px;border-radius:9px;margin-bottom:8px;font-size:12.5px">
            📴 <strong>غير متصل بالإنترنت</strong> — البيانات من آخر نسخة محفوظة (${RET_DB.offlineDataAge ? new Date(RET_DB.offlineDataAge).toLocaleString('ar-EG') : '—'}). <strong>مرتجع المبيعات</strong> هيتسجّل محلياً ويتزامن تلقائياً برقم رسمي لما الاتصال يرجع. <strong>مرتجع المشتريات مش متاح أوفلاين.</strong>
        </div>` : ''}
        ${retHeaderHTML()}
        <div class="inv-main">
            <div class="inv-table-col">
                ${retSearchBarHTML()}
                <div class="inv-table-scroll">
                    <table class="inv-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th style="width:90px">الكود</th>
                                <th class="text-r">الصنف</th>
                                <th style="width:64px">وحدة</th>
                                <th style="width:80px">${retMode === 'linked' ? 'الأصلية' : 'رصيد'}</th>
                                <th style="width:90px">الكمية</th>
                                <th style="width:92px">السعر</th>
                                <th style="width:64px">خصم%</th>
                                <th style="width:100px">الإجمالي</th>
                                <th style="width:40px"></th>
                            </tr>
                        </thead>
                        <tbody id="retItemsBody"></tbody>
                    </table>
                </div>
                ${retBottomBarHTML()}
            </div>
            <div class="inv-side">
                ${retDocInfoCardHTML()}
                ${retTotalsCardHTML()}
                ${retActionsCardHTML()}
                ${retNotesCardHTML()}
            </div>
        </div>
    </div>
    ${retRecentListHTML()}
    `;

    retBindInputEvents();
    retRenderItems();
    retUpdateSummary();
    retUpdateEntityChip();
    setTimeout(() => {
        (retMode === 'manual' ? document.getElementById('retEntitySearch') : document.getElementById('retInvNo'))?.focus();
    }, 100);
}

function retHeaderHTML() {
    const entityLabel = retType === 'sales' ? 'العميل' : 'المورد';
    const counter = retType === 'sales' ? (RET_DB.rsCounter || 1) : (RET_DB.rpCounter || 1);
    const prefix = retType === 'sales' ? 'RS' : 'RP';
    return `
    <div class="inv-header">
        <div class="inv-header-brand">
            <div class="ic">↩️</div>
            <div class="ttl">مرتجع ${retType === 'sales' ? 'مبيعات' : 'مشتريات'}<small> Sultan ERP</small></div>
        </div>
        <span class="inv-no-badge">${prefix}-${String(counter).padStart(4, '0')}</span>

        <div class="inv-density-btns" title="نوع المرتجع">
            <button onclick="retSwitchType('sales')" class="${retType === 'sales' ? 'active' : ''}">↩️ مبيعات</button>
            <button onclick="retSwitchType('purchase')" class="${retType === 'purchase' ? 'active' : ''}">↩️ مشتريات</button>
        </div>
        <div class="inv-density-btns" title="طريقة الإدخال">
            <button onclick="retSwitchMode('linked')" class="${retMode === 'linked' ? 'active' : ''}">🔗 مرتبط بفاتورة</button>
            <button onclick="retSwitchMode('manual')" class="${retMode === 'manual' ? 'active' : ''}">✍️ مستقل</button>
        </div>

        <select class="inv-date-input" id="retWarehouse" title="المخزن" onchange="retOnWarehouseChange()" style="cursor:pointer">
            ${(RET_DB.warehouses || []).map(w => `<option value="${w.id}" ${w.id === retWarehouseId ? 'selected' : ''}>🏭 ${w.name}${w.is_main ? ' (رئيسي)' : ''}</option>`).join('') || '<option value="">لا يوجد مخزن</option>'}
        </select>

        ${retMode === 'manual' ? `
        <div class="inv-cust-pick">
            <span class="inv-cust-input-icon">👤</span>
            <input class="inv-cust-input" id="retEntitySearch" placeholder="بحث ${entityLabel}: اسم / هاتف..." autocomplete="off">
            <div class="inv-ac" id="retEntityAC"></div>
        </div>` : ''}
        <div class="inv-cust-chip" id="retEntityChip">
            <span class="nm" id="retEntityName"></span>
            <span class="bal" id="retEntityBal"></span>
            ${retMode === 'manual' ? `<button class="x" onclick="retClearEntity()">✕</button>` : ''}
        </div>

        <div class="inv-header-spacer"></div>
        <button class="inv-top-btn inv-top-save" onclick="retSave()">💾 حفظ <kbd>F4</kbd></button>
        <button class="inv-top-btn inv-top-print" onclick="retPrint()">🖨️ طباعة</button>
        <button class="inv-top-btn inv-top-new" onclick="renderReturns(document.getElementById('app-content'))">➕ جديد</button>
    </div>`;
}

function retSearchBarHTML() {
    if (retMode === 'manual') {
        return `
        <div class="inv-searchbar">
            <div class="inv-search-wrap">
                <span class="inv-search-icon">🔍</span>
                <input class="inv-search-input" id="retFastSearch" placeholder="ابحث: اسم / كود — ↑↓ تنقل — Enter اختيار" autocomplete="off">
                <div class="inv-ac" id="retFastAC" style="top:calc(100% + 4px)"></div>
            </div>
            <span class="inv-search-hint"><kbd>Alt+F</kbd> بحث</span>
            <button class="inv-add-row-btn" onclick="retAddRow()">+ سطر يدوي</button>
        </div>`;
    }
    return `
    <div class="inv-searchbar">
        <div class="inv-search-wrap">
            <span class="inv-search-icon">🧾</span>
            <input class="inv-search-input" id="retInvNo" placeholder="${retType === 'sales' ? 'رقم فاتورة البيع — مثال INV-0012' : 'رقم فاتورة الشراء — مثال PUR-0012'}" autocomplete="off" dir="ltr"
                value="${retLinkedDoc?.invoice_no || ''}" onkeydown="if(event.key==='Enter'){event.preventDefault();retSearchInvoice();}">
        </div>
        <span class="inv-search-hint"><kbd>Enter</kbd> بحث</span>
        <button class="inv-add-row-btn" onclick="retSearchInvoice()">🔍 بحث عن الفاتورة</button>
    </div>`;
}

function retBottomBarHTML() {
    return `
    <div class="inv-bottombar">
        <span class="bb-stat">الأصناف: <strong id="retItemCount">0</strong></span>
        <span class="bb-stat">الوحدات: <strong id="retUnitCount">0</strong></span>
        <span class="bb-net">إجمالي المرتجع: <span class="v" id="retNetBar">0.00</span> ج.م</span>
    </div>`;
}

function retDocInfoCardHTML() {
    if (retMode !== 'linked') return '<div id="retDocInfoCard"></div>';
    if (!retLinkedDoc) {
        return `<div class="inv-card" id="retDocInfoCard">
            <div class="inv-card-title">🧾 الفاتورة المرتبطة</div>
            <div style="font-size:12.5px;color:var(--inv-muted)">ابحث برقم الفاتورة بالأعلى لعرض بياناتها هنا — الأصناف هتتحمّل تلقائياً بحد أقصى للكمية المرتجعة.</div>
        </div>`;
    }
    const d = retLinkedDoc;
    const entityName = retType === 'sales' ? d.customers?.name : d.suppliers?.name;
    return `<div class="inv-card" id="retDocInfoCard">
        <div class="inv-card-title">🧾 الفاتورة المرتبطة</div>
        <div class="inv-sum-row"><span class="lbl">الرقم</span><span class="val" dir="ltr">${d.invoice_no}</span></div>
        <div class="inv-sum-row"><span class="lbl">${retType === 'sales' ? 'العميل' : 'المورد'}</span><span class="val">${entityName || 'نقدي'}</span></div>
        <div class="inv-sum-row"><span class="lbl">إجمالي الفاتورة</span><span class="val">${retFmt(d.total)}</span></div>
    </div>`;
}

function retTotalsCardHTML() {
    return `
    <div class="inv-card">
        <div class="inv-card-title">💰 إجمالي المرتجع</div>
        <div class="inv-sum-row"><span class="lbl">إجمالي الأصناف</span><span class="val" id="retSubtotal">0.00</span></div>
        <div class="inv-sum-row disc"><span class="lbl">خصم الأسطر</span><span class="val" id="retDiscRows">0.00</span></div>
        <div class="inv-sum-divider"></div>
        <div class="inv-net-box">
            <div class="nlbl">إجمالي المرتجع</div>
            <div class="nval" id="retNet">0.00</div>
        </div>
    </div>`;
}

function retActionsCardHTML() {
    return `
    <div class="inv-actions">
        <button class="inv-btn inv-btn-save" onclick="retSave()">💾 حفظ المرتجع <kbd>F4</kbd></button>
        <button class="inv-btn inv-btn-print" onclick="retPrint()">🖨️ طباعة</button>
    </div>`;
}

function retNotesCardHTML() {
    return `
    <div class="inv-card">
        <div class="inv-card-title">📝 ملاحظات / سبب المرتجع</div>
        <textarea class="inv-notes" id="ret-notes" rows="2" placeholder="اختياري..."></textarea>
    </div>`;
}

function retRecentListHTML() {
    const list = [...(RET_DB.pendingList || []), ...(RET_DB.list || [])];
    return `
    <div class="mod-table-wrap" style="margin-top:16px">
        <div style="padding:14px 18px 0;font-weight:800;font-size:14px;color:#1E293B">📋 آخر ${retType === 'sales' ? 'مرتجعات المبيعات' : 'مرتجعات المشتريات'}</div>
        <table class="mod-table"><thead><tr>
            <th>الرقم</th><th>${retType === 'sales' ? 'العميل' : 'المورد'}</th><th>مرتبط بفاتورة</th><th>التاريخ</th><th style="text-align:left">الإجمالي</th><th>الحالة</th>
        </tr></thead>
        <tbody>
            ${list.length ? list.map(r => `<tr>
                <td><span style="background:#F1F5F9;padding:3px 8px;border-radius:5px;font-size:11px;font-family:monospace">${r.return_no || '—'}</span></td>
                <td>${r.customers?.name || r.suppliers?.name || '—'}</td>
                <td>${r.sale_id || r.purchase_id ? '<span style="color:#2563EB">🔗 نعم</span>' : '<span style="color:#94A3B8">مستقل</span>'}</td>
                <td class="dash-muted">${new Date(r.created_at).toLocaleDateString('ar-EG')}</td>
                <td style="text-align:left;font-weight:700;color:#DC2626">${retFmt(r.total)}</td>
                <td>${r._queue
                    ? (r.status === 'failed' ? '<span style="color:#DC2626;font-weight:600">❌ فشلت المزامنة</span>' : '<span style="color:#D97706;font-weight:600">⏳ غير مُزامن</span>')
                    : '<span style="color:#059669;font-weight:600">✅ مؤكد</span>'}</td>
            </tr>`).join('') : `<tr><td colspan="6" style="text-align:center;padding:20px;color:#94A3B8">لا توجد مرتجعات بعد</td></tr>`}
        </tbody>
        </table>
    </div>`;
}

// مرتجعات مبيعات اتسجّلت أوفلاين ولسه في طابور المزامنة — لعرضها في جدول "آخر المرتجعات"
async function retLoadPendingList() {
    RET_DB.pendingList = [];
    if (retType !== 'sales' || typeof getQueue !== 'function') return;
    try {
        const pending = await getQueue(e => e.module === 'returns' && e.kind === 'sale_return' && (e.status === 'pending' || e.status === 'failed' || e.status === 'syncing'));
        RET_DB.pendingList = pending.map(e => ({
            _queue: true, status: e.status,
            return_no: e.payload.tempReturnNo,
            customers: { name: RET_DB.customers.find(c => c.id === e.payload.returnRow.customer_id)?.name || '—' },
            sale_id: e.payload.returnRow.sale_id,
            created_at: new Date(e.createdAt).toISOString(),
            total: e.payload.returnRow.total,
        }));
    } catch {}
}

// ════════════════════════════════════════════════════════════
// 2) عرض سطور الأصناف + الحسابات (بنفس منطق invRenderItems: index لا id)
// ════════════════════════════════════════════════════════════
function retGetStock(pid) {
    if (!retWarehouseId) return 0;
    return RET_DB.stockMap[retWarehouseId + '|' + pid] || 0;
}
function retGetPrice(p) {
    return retType === 'sales' ? (Number(p.wholesale_price) || Number(p.retail_price) || 0) : (Number(p.purchase_price) || 0);
}
function retOnWarehouseChange() {
    const sel = document.getElementById('retWarehouse');
    if (sel) retWarehouseId = sel.value;
    retRenderItems();
}

function retRenderItems() {
    const tbody = document.getElementById('retItemsBody');
    if (!tbody) return;

    if (!retItems.length) {
        tbody.innerHTML = `<tr class="inv-empty-row"><td colspan="10">
            <span class="em-ic">↩️</span>
            ${retMode === 'linked' ? 'ابحث برقم الفاتورة بالأعلى لعرض أصنافها' : 'ابحث عن صنف بالأعلى لإضافته، أو اضغط "+ سطر يدوي"'}
        </td></tr>`;
        return;
    }

    tbody.innerHTML = retItems.map((it, idx) => {
        const liveStock = it.pid ? retGetStock(it.pid) : 0;
        const lowStock = retMode === 'manual' && it.pid && (it.qty || 0) > liveStock;
        const lineTotal = (it.qty || 0) * (it.price || 0) * (1 - (it.disc || 0) / 100);
        return `<tr class="${lowStock ? 'is-low' : ''}">
            <td class="inv-cell-idx">${idx + 1}</td>
            <td>
                <input class="inv-cell-input is-num" id="retCode-${idx}" value="${it.code || ''}" ${retMode === 'linked' ? 'disabled' : ''} autocomplete="off" dir="ltr"
                    oninput="retOnCode(${idx},this.value)" onkeydown="retRowKey(event,${idx},'code')">
            </td>
            <td style="position:relative">
                ${retMode === 'linked'
                    ? `<strong style="padding:7px 8px;display:inline-block">${it.name}</strong>`
                    : `<input class="inv-cell-input is-name" id="retName-${idx}" value="${it.name || ''}" placeholder="اسم الصنف..." autocomplete="off"
                        oninput="retOnName(${idx},this.value)" onkeydown="retOnNameKey(event,${idx})">
                       <div class="inv-ac" id="retAC-${idx}" style="top:100%;right:0;left:0"></div>`}
            </td>
            <td style="text-align:center;font-size:12px;color:var(--inv-muted)">${it.unit || 'قطعة'}</td>
            <td class="inv-cell-stock">
                ${retMode === 'linked'
                    ? `<span class="num">${it.maxQty}</span><div class="low-lbl" style="color:var(--inv-muted)">أصلية</div>`
                    : `<span class="num ${lowStock ? 'low' : ''}">${it.pid ? liveStock : '—'}</span>${lowStock ? '<div class="low-lbl">نقص</div>' : ''}`}
            </td>
            <td>
                <input type="number" class="inv-cell-input is-num" id="retQty-${idx}" value="${it.qty || 0}" min="0" ${it.maxQty != null ? `max="${it.maxQty}"` : ''} step="0.01"
                    oninput="retOnQtyInput(${idx},this.value)" onkeydown="retRowKey(event,${idx},'qty')">
            </td>
            <td>
                <input type="number" class="inv-cell-input is-num" id="retPrice-${idx}" value="${it.price || 0}" min="0" step="0.01"
                    oninput="retItems[${idx}].price=parseFloat(this.value)||0;retUpdateRowTotal(${idx});retUpdateSummary()" onkeydown="retRowKey(event,${idx},'price')">
            </td>
            <td>
                <input type="number" class="inv-cell-input is-num" id="retDisc-${idx}" value="${it.disc || 0}" min="0" max="100" step="1"
                    oninput="retItems[${idx}].disc=parseFloat(this.value)||0;retUpdateRowTotal(${idx});retUpdateSummary()">
            </td>
            <td class="inv-cell-total" id="retRowTotal-${idx}">${retFmt(lineTotal)}</td>
            <td class="inv-cell-del">${retMode === 'manual' ? `<button class="inv-del-btn" onclick="retRemoveRow(${idx})">✕</button>` : ''}</td>
        </tr>`;
    }).join('');
}

function retUpdateRowTotal(idx) {
    const it = retItems[idx];
    if (!it) return;
    const el = document.getElementById('retRowTotal-' + idx);
    if (el) el.textContent = retFmt((it.qty || 0) * (it.price || 0) * (1 - (it.disc || 0) / 100));
}

function retOnQtyInput(idx, val) {
    const it = retItems[idx];
    if (!it) return;
    let v = parseFloat(val) || 0;
    if (it.maxQty != null && v > it.maxQty) {
        v = it.maxQty;
        retToast(`⚠️ أقصى كمية قابلة للإرجاع لهذا الصنف: ${it.maxQty}`, 'error');
    }
    it.qty = v;
    const input = document.getElementById('retQty-' + idx);
    if (input && parseFloat(input.value) !== v) input.value = v;
    retUpdateRowTotal(idx);
    retUpdateSummary();
}

function retCalcTotal() {
    return retItems.reduce((s, it) => s + (it.qty || 0) * (it.price || 0) * (1 - (it.disc || 0) / 100), 0);
}

function retUpdateSummary() {
    const total = retCalcTotal();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('retSubtotal', retFmt(retItems.reduce((s, it) => s + (it.qty || 0) * (it.price || 0), 0)));
    set('retDiscRows', retFmt(retItems.reduce((s, it) => s + (it.qty || 0) * (it.price || 0) * (it.disc || 0) / 100, 0)));
    set('retNet', retFmt(total));
    set('retNetBar', retFmt(total));
    set('retItemCount', retItems.filter(i => i.pid).length);
    set('retUnitCount', retItems.reduce((s, i) => s + (i.qty || 0), 0));
}

// ════════════════════════════════════════════════════════════
// 3) الجهة (عميل/مورد) — بحث + شريحة مختارة (نفس نمط invSelectCustomer)
// ════════════════════════════════════════════════════════════
let _retEntACIdx = -1;
function retSearchEntity(val) {
    const ac = document.getElementById('retEntityAC');
    if (!ac) return;
    const list = retType === 'sales' ? RET_DB.customers : RET_DB.suppliers;
    const m = val.length ? list.filter(x => (x.name || '').includes(val) || (x.phone || '').includes(val)).slice(0, 8) : [];
    if (m.length) {
        ac.innerHTML = m.map((x, i) => `<div class="inv-ac-item" data-i="${i}" onclick="retSelectEntity('${x.id}')" onmouseenter="retEntACHover(${i})">
            <div><div class="an">${x.name}</div><div class="as">${x.phone || ''}</div></div>
            <div class="ap"><div class="pr">${retFmt(x.balance)}</div><div class="as">رصيد</div></div>
        </div>`).join('');
        ac.classList.add('show');
    } else ac.classList.remove('show');
}
function retEntACKey(e) {
    const ac = document.getElementById('retEntityAC');
    if (!ac || !ac.classList.contains('show')) return;
    const items = ac.querySelectorAll('.inv-ac-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); _retEntACIdx = Math.min(_retEntACIdx + 1, items.length - 1); retEntACHover(_retEntACIdx); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _retEntACIdx = Math.max(_retEntACIdx - 1, 0); retEntACHover(_retEntACIdx); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[_retEntACIdx]) items[_retEntACIdx].click(); }
    else if (e.key === 'Escape') { ac.classList.remove('show'); _retEntACIdx = -1; }
}
function retEntACHover(i) {
    _retEntACIdx = i;
    const items = document.querySelectorAll('#retEntityAC .inv-ac-item');
    items.forEach((el, idx) => el.classList.toggle('active', idx === i));
    items[i]?.scrollIntoView({ block: 'nearest' });
}
function retSelectEntity(id) {
    const list = retType === 'sales' ? RET_DB.customers : RET_DB.suppliers;
    const x = list.find(v => v.id === id);
    if (!x) return;
    retEntityId = id;
    const inp = document.getElementById('retEntitySearch'); if (inp) inp.value = '';
    document.getElementById('retEntityAC')?.classList.remove('show');
    retUpdateEntityChip();
    setTimeout(() => document.getElementById('retFastSearch')?.focus(), 50);
}
function retClearEntity() {
    retEntityId = null;
    retUpdateEntityChip();
}
function retUpdateEntityChip() {
    const chip = document.getElementById('retEntityChip');
    if (!chip) return;
    const list = retType === 'sales' ? RET_DB.customers : RET_DB.suppliers;
    const x = retEntityId ? list.find(v => v.id === retEntityId) : null;
    if (x) {
        chip.classList.add('show');
        document.getElementById('retEntityName').textContent = x.name;
        const balEl = document.getElementById('retEntityBal');
        balEl.textContent = (x.balance >= 0 ? 'رصيد ' : 'مديونية ') + retFmt(Math.abs(x.balance));
        balEl.style.color = x.balance < 0 ? '#FCA5A5' : '#6EE7B7';
    } else {
        chip.classList.remove('show');
    }
}

// ════════════════════════════════════════════════════════════
// 4) البحث السريع + إضافة الأصناف (وضع "مستقل" — نفس نمط invFastSearch)
// ════════════════════════════════════════════════════════════
let _retFastIdx = -1;
function retFastSearch(val) {
    const ac = document.getElementById('retFastAC');
    if (!ac) return;
    const m = val.length ? RET_DB.products.filter(p => (p.name || '').includes(val) || (p.code || '').includes(val)).slice(0, 8) : [];
    if (m.length) {
        ac.innerHTML = m.map((p, i) => `<div class="inv-ac-item" data-i="${i}" onclick="retPickProduct('${p.id}')" onmouseenter="retFastHover(${i})">
            <div><div class="an">${p.name}</div><div class="as">${p.code || ''} · ${p.unit || ''}</div></div>
            <div class="ap"><div class="pr">${retFmt(retGetPrice(p))}</div><div class="as">مخزون: ${retGetStock(p.id)}</div></div>
        </div>`).join('');
        ac.classList.add('show');
    } else ac.classList.remove('show');
}
function retFastKey(e) {
    const ac = document.getElementById('retFastAC');
    if (!ac || !ac.classList.contains('show')) return;
    const items = ac.querySelectorAll('.inv-ac-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); _retFastIdx = Math.min(_retFastIdx + 1, items.length - 1); retFastHover(_retFastIdx); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _retFastIdx = Math.max(_retFastIdx - 1, 0); retFastHover(_retFastIdx); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[_retFastIdx]) items[_retFastIdx].click(); }
    else if (e.key === 'Escape') { ac.classList.remove('show'); _retFastIdx = -1; }
}
function retFastHover(i) {
    _retFastIdx = i;
    const items = document.querySelectorAll('#retFastAC .inv-ac-item');
    items.forEach((el, idx) => el.classList.toggle('active', idx === i));
    items[i]?.scrollIntoView({ block: 'nearest' });
}
function retPickProduct(pid) {
    const p = RET_DB.products.find(x => x.id === pid);
    if (!p) return;
    const ex = retItems.findIndex(i => i.pid === pid);
    if (ex >= 0) {
        retItems[ex].qty = (retItems[ex].qty || 1) + 1;
    } else {
        retItems.push({ id: Date.now() + Math.random(), pid: p.id, name: p.name, code: p.code || '', unit: p.unit || 'قطعة', qty: 1, price: retGetPrice(p), disc: 0, maxQty: null });
    }
    const fs = document.getElementById('retFastSearch'); if (fs) fs.value = '';
    document.getElementById('retFastAC')?.classList.remove('show');
    _retFastIdx = -1;
    retRenderItems();
    retUpdateSummary();
}
function retAddRow() {
    retItems.push({ id: Date.now() + Math.random(), pid: null, name: '', code: '', unit: 'قطعة', qty: 1, price: 0, disc: 0, maxQty: null });
    retRenderItems();
    retUpdateSummary();
    setTimeout(() => document.getElementById('retName-' + (retItems.length - 1))?.focus(), 40);
}
function retEnsureNewRow() {
    const last = retItems[retItems.length - 1];
    if (!last || last.pid) retItems.push({ id: Date.now() + Math.random(), pid: null, name: '', code: '', unit: 'قطعة', qty: 1, price: 0, disc: 0, maxQty: null });
}

// ── بحث داخل خلية الصنف (تصحيح صنف سطر موجود) ──
let _retRowACIdx = {};
function retOnName(idx, val) {
    retItems[idx].name = val; retItems[idx].pid = null;
    _retRowACIdx[idx] = -1;
    const ac = document.getElementById('retAC-' + idx);
    if (!ac) return;
    const m = val.length ? RET_DB.products.filter(p => (p.name || '').includes(val) || (p.code || '').includes(val)).slice(0, 6) : [];
    if (m.length) {
        ac.innerHTML = m.map((p, i) => `<div class="inv-ac-item" data-i="${i}" onclick="retPickInline(${idx},'${p.id}')" onmouseenter="retRowACHover(${idx},${i})">
            <div><div class="an">${p.name}</div><div class="as">${p.code || ''} · ${p.unit || ''}</div></div>
            <div class="ap"><div class="pr">${retFmt(retGetPrice(p))}</div><div class="as">مخزون: ${retGetStock(p.id)}</div></div>
        </div>`).join('');
        ac.classList.add('show');
    } else ac.classList.remove('show');
}
function retOnNameKey(e, idx) {
    const ac = document.getElementById('retAC-' + idx);
    if (!ac || !ac.classList.contains('show')) { retRowKey(e, idx, 'name'); return; }
    const items = ac.querySelectorAll('.inv-ac-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); _retRowACIdx[idx] = Math.min((_retRowACIdx[idx] ?? -1) + 1, items.length - 1); retRowACHover(idx, _retRowACIdx[idx]); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _retRowACIdx[idx] = Math.max((_retRowACIdx[idx] ?? -1) - 1, 0); retRowACHover(idx, _retRowACIdx[idx]); }
    else if (e.key === 'Enter') { e.preventDefault(); const ci = _retRowACIdx[idx] ?? -1; if (items[ci]) items[ci].click(); else retRowKey(e, idx, 'name'); }
    else if (e.key === 'Escape') { ac.classList.remove('show'); _retRowACIdx[idx] = -1; }
}
function retRowACHover(idx, i) {
    _retRowACIdx[idx] = i;
    const items = document.querySelectorAll('#retAC-' + idx + ' .inv-ac-item');
    items.forEach((el, x) => el.classList.toggle('active', x === i));
    items[i]?.scrollIntoView({ block: 'nearest' });
}
function retPickInline(idx, pid) {
    const p = RET_DB.products.find(x => x.id === pid);
    if (!p) return;
    retItems[idx] = { id: retItems[idx].id, pid: p.id, name: p.name, code: p.code || '', unit: p.unit || 'قطعة', qty: retItems[idx].qty || 1, price: retGetPrice(p), disc: 0, maxQty: null };
    retRenderItems();
    retUpdateSummary();
}
function retOnCode(idx, val) {
    if (retMode !== 'manual') return;
    retItems[idx].code = val;
    const p = RET_DB.products.find(x => x.code === val);
    if (p) retPickInline(idx, p.id);
}
function retRemoveRow(idx) {
    retItems.splice(idx, 1);
    retRenderItems();
    retUpdateSummary();
}
function retRowKey(e, idx, field) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const order = ['code', 'name', 'qty', 'price'];
    const idPrefix = { code: 'retCode-', name: 'retName-', qty: 'retQty-', price: 'retPrice-' };
    const cur = order.indexOf(field);
    if (cur < order.length - 1) {
        const nextEl = document.getElementById(idPrefix[order[cur + 1]] + idx);
        nextEl?.focus(); nextEl?.select?.();
    } else {
        retEnsureNewRow();
        retRenderItems();
        setTimeout(() => document.getElementById('retName-' + (idx + 1))?.focus(), 30);
    }
}

// ════════════════════════════════════════════════════════════
// 5) وضع "مرتبط بفاتورة": البحث عن الفاتورة وتحميل بنودها
// ════════════════════════════════════════════════════════════
window.retSearchInvoice = async function () {
    const no = document.getElementById('retInvNo')?.value.trim();
    if (!no) { retToast('⚠️ أدخل رقم الفاتورة', 'error'); return; }

    const offline = typeof isOnline === 'function' && !isOnline();
    if (offline && retType === 'purchase') {
        retToast('📴 مرتجع المشتريات محتاج اتصال بالإنترنت', 'error');
        return;
    }

    try {
        if (offline && retType === 'sales') {
            // أوفلاين: دوّر في آخر نسخة محفوظة من فواتير المبيعات (offline.js's offlineWarmCache)
            const cached = typeof dbGetCache === 'function' ? await dbGetCache('recent_sales') : null;
            const data = (cached?.data || []).find(s => s.invoice_no === no);
            if (!data) { retToast('❌ الفاتورة دي مش موجودة في آخر نسخة محفوظة (📴 أوفلاين) — جرّب لما الاتصال يرجع', 'error'); retItems = []; retLinkedDoc = null; retRenderItems(); retUpdateSummary(); return; }
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
            const whSel = document.getElementById('retWarehouse');
            if (whSel) whSel.value = retWarehouseId || '';
            retRenderItems();
            retUpdateSummary();
            retUpdateEntityChip();
            const docInfoEl = document.getElementById('retDocInfoCard');
            if (docInfoEl) docInfoEl.outerHTML = retDocInfoCardHTML();
            retToast(`📴 تم تحميل بنود الفاتورة ${no} من آخر نسخة محفوظة — عدّل الكمية المرتجعة لكل صنف`, 'info');
            return;
        }
        if (retType === 'sales') {
            const { data, error } = await sb.from('sales')
                .select('*, sale_items(*, products(name,code,unit)), customers(name)')
                .eq('invoice_no', no).maybeSingle();
            if (error) throw error;
            if (!data) { retToast('❌ لا توجد فاتورة بيع بهذا الرقم', 'error'); retItems = []; retLinkedDoc = null; retRenderItems(); retUpdateSummary(); return; }
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
        } else {
            const { data, error } = await sb.from('purchases')
                .select('*, purchase_items(*, products(name,code,unit)), suppliers(name)')
                .eq('invoice_no', no).maybeSingle();
            if (error) throw error;
            if (!data) { retToast('❌ لا توجد فاتورة شراء بهذا الرقم', 'error'); retItems = []; retLinkedDoc = null; retRenderItems(); retUpdateSummary(); return; }
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
        }

        const whSel = document.getElementById('retWarehouse');
        if (whSel) whSel.value = retWarehouseId || '';
        retRenderItems();
        retUpdateSummary();
        retUpdateEntityChip();
        const docInfoEl = document.getElementById('retDocInfoCard');
        if (docInfoEl) docInfoEl.outerHTML = retDocInfoCardHTML();
        retToast(`✅ تم تحميل بنود الفاتورة ${no} — عدّل الكمية المرتجعة لكل صنف (بحد أقصى الكمية الأصلية)`, 'success');
    } catch (err) {
        retToast('❌ خطأ: ' + err.message, 'error');
    }
};

// ════════════════════════════════════════════════════════════
// 6) الحفظ — INSERT فقط (الـ Trigger يتكفّل بالمخزون/الأرصدة) — نفس المنطق القديم بالحرف
// ════════════════════════════════════════════════════════════
window.retSave = async function () {
    const filled = retItems.filter(it => it.pid && (it.qty || 0) > 0);
    if (!filled.length) { retToast('⚠️ أضف صنفاً واحداً على الأقل بكمية أكبر من صفر', 'error'); return; }

    const offline = typeof isOnline === 'function' && !isOnline();
    if (offline && retType === 'purchase') {
        retToast('📴 مرتجع المشتريات محتاج اتصال بالإنترنت — لسه غير مدعوم أوفلاين', 'error');
        return;
    }

    const notes = document.getElementById('ret-notes')?.value.trim() || null;
    const total = retCalcTotal();
    const subtotal = filled.reduce((s, it) => s + (it.qty || 0) * (it.price || 0), 0);
    const saveBtns = document.querySelectorAll('.inv-btn-save, .inv-top-save');
    saveBtns.forEach(b => { b.dataset._label = b.dataset._label || b.innerHTML; b.innerHTML = '⏳ جاري الحفظ...'; b.disabled = true; });

    if (offline && retType === 'sales') {
        try {
            const stockDeltas = filled.map(it => {
                const key = retWarehouseId + '|' + it.pid;
                return { warehouseId: retWarehouseId, productId: it.pid, qty: it.qty, name: it.name, _estAfter: (RET_DB.stockMap[key] || 0) + (it.qty || 0) };
            });
            const tempReturnNo = retNextOfflineReturnNo();
            const payload = {
                tempReturnNo,
                returnRow: {
                    customer_id: retEntityId || null,
                    sale_id: retLinkedDoc?.id || null,
                    warehouse_id: retWarehouseId,
                    payment_type: retLinkedDoc?.payment_type || 'cash',
                    subtotal, total, status: 'confirmed',
                    reason: notes,
                    created_by: currentUser?.id || null,
                },
                items: filled.map(it => ({
                    product_id: it.pid, qty: it.qty,
                    unit_price: it.price, discount_pct: it.disc || 0,
                    line_total: (it.qty || 0) * (it.price || 0) * (1 - (it.disc || 0) / 100),
                    unit_name: it.unit || 'قطعة',
                })),
                _stockDeltas: stockDeltas,
            };

            await queueWrite({ module: 'returns', kind: 'sale_return', payload, tempRef: tempReturnNo });

            // تحديث محلي متفائل للمخزون (المرتجع بيرجّع كمية للمخزون)
            for (const d of stockDeltas) {
                const key = d.warehouseId + '|' + d.productId;
                RET_DB.stockMap[key] = (RET_DB.stockMap[key] || 0) + d.qty;
            }

            retToast(`⏳ اتسجّل المرتجع محلياً (${tempReturnNo}) — هياخد رقم رسمي ويتزامن تلقائياً لما الاتصال يرجع`, 'info');
            renderReturns(document.getElementById('app-content'));
        } catch (err) {
            retToast('❌ خطأ أثناء الحفظ المحلي: ' + err.message, 'error');
            saveBtns.forEach(b => { b.innerHTML = b.dataset._label; b.disabled = false; });
        }
        return;
    }

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

        retToast(`✅ تم حفظ المرتجع ${returnNo} بنجاح`, 'success');
        try {
            const { data: cash } = await sb.rpc('get_cash_balance');
            const tb = document.getElementById('topbarCash');
            if (tb) tb.textContent = '💰 ' + (cash || 0).toFixed(2) + ' ج.م';
        } catch {}
        renderReturns(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ أثناء حفظ المرتجع: ' + err.message + '\n\nتأكد من تشغيل ملف returns_migration.sql في Supabase.');
        saveBtns.forEach(b => { b.innerHTML = b.dataset._label; b.disabled = false; });
    }
};

// ════════════════════════════════════════════════════════════
// 7) الطباعة (حرارية 80mm) — عبر thermal-print.js زي فاتورة المبيعات
// ════════════════════════════════════════════════════════════
window.retPrint = async function () {
    const filled = retItems.filter(it => it.pid && (it.qty || 0) > 0);
    if (!filled.length) { retToast('⚠️ لا توجد أصناف لطباعتها', 'error'); return; }
    const list = retType === 'sales' ? RET_DB.customers : RET_DB.suppliers;
    const entity = retEntityId ? list.find(x => x.id === retEntityId) : null;
    const counter = retType === 'sales' ? (RET_DB.rsCounter || 1) : (RET_DB.rpCounter || 1);

    await printThermalReceipt('return', {
        returnNo: (retType === 'sales' ? 'RS' : 'RP') + '-' + String(counter).padStart(4, '0'),
        returnType: retType,
        entityName: entity?.name || null,
        linkedInvoiceNo: retLinkedDoc?.invoice_no || null,
        items: filled.map(it => ({ name: it.name, qty: it.qty, unit_price: it.price, line_total: (it.qty || 0) * (it.price || 0) * (1 - (it.disc || 0) / 100) })),
        total: retCalcTotal(),
    });
};

// ════════════════════════════════════════════════════════════
// 8) اختصارات الكيبورد + أدوات مساعدة
// ════════════════════════════════════════════════════════════
function retBindInputEvents() {
    const es = document.getElementById('retEntitySearch');
    es?.addEventListener('input', () => { _retEntACIdx = -1; retSearchEntity(es.value); });
    es?.addEventListener('keydown', retEntACKey);

    const fs = document.getElementById('retFastSearch');
    fs?.addEventListener('input', () => { _retFastIdx = -1; retFastSearch(fs.value); });
    fs?.addEventListener('keydown', retFastKey);
}
function retGlobalKeys(e) {
    if (e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 's') { e.preventDefault(); retSave(); return; }
        if (k === 'p') { e.preventDefault(); retPrint(); return; }
        if (k === 'f') { e.preventDefault(); (document.getElementById('retFastSearch') || document.getElementById('retInvNo'))?.focus(); return; }
        return;
    }
    if (e.key === 'F4') { e.preventDefault(); retSave(); return; }
    if (e.key === 'Escape') {
        const open = document.querySelector('.inv-ac.show');
        if (open) open.classList.remove('show');
    }
}

function retFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function retToast(msg, type = 'info') {
    let t = document.getElementById('retToast');
    if (!t) { t = document.createElement('div'); t.id = 'retToast'; t.className = 'inv-toast'; document.body.appendChild(t); }
    t.className = 'inv-toast ' + type;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window._retToastT);
    window._retToastT = setTimeout(() => t.classList.remove('show'), 2600);
}

Object.assign(window, {
    renderReturns, retSwitchType, retSwitchMode, retOnWarehouseChange,
    retClearEntity, retSelectEntity, retEntACHover,
    retSave, retPrint, retSearchInvoice,
    retAddRow, retRemoveRow, retOnCode, retOnName, retOnNameKey, retPickInline, retRowACHover,
    retOnQtyInput, retRowKey, retPickProduct, retFastHover,
});

// ════════════════════════════════════════════════════════════
// 9) مزامنة مرتجعات المبيعات المعلّقة (Phase 4 — دعم الأوفلاين)
//    ★ 'sale_return' مسجّلة في OFFLINE_STRICT_ORDER_KINDS (js/offline.js) —
//    نفس فلسفة 'sale' في sales.js: ترتيب صارم وتوقف عند أول فشل.
//    مرتجع المشتريات خارج النطاق عمداً — يفضل أونلاين فقط.
// ════════════════════════════════════════════════════════════
if (typeof registerSyncHandler === 'function') {
    registerSyncHandler('sale_return', async (entry) => {
        const { tempReturnNo, returnRow, items, _stockDeltas } = entry.payload;
        try {
            const { returnNo, counter } = await retAllocateRealReturnNo();

            const { data: retRows, error: retErr } = await sb.from('sales_returns').insert({
                ...returnRow, return_no: returnNo,
            }).select();
            if (retErr) return { ok: false, error: retErr.message, summary: `مرتجع ${tempReturnNo}` };
            const returnId = retRows[0].id;

            const itemRows = items.map(it => ({ ...it, return_id: returnId }));
            const { error: itemsErr } = await sb.from('sale_return_items').insert(itemRows);
            if (itemsErr) {
                await sb.from('sales_returns').delete().eq('id', returnId);
                return { ok: false, error: itemsErr.message, summary: `مرتجع ${tempReturnNo}` };
            }

            await sb.from('app_settings').upsert({
                key: 'sales_return_counter', value: String(counter + 1), updated_at: new Date().toISOString(),
            });

            // مطابقة: قارن المخزون الفعلي (بعد الـ trigger) بالتقدير المحلي وقت الأوفلاين
            const flags = [];
            for (const d of (_stockDeltas || [])) {
                try {
                    const { data: stockRow } = await sb.from('inventory_stock').select('qty')
                        .eq('warehouse_id', d.warehouseId).eq('product_id', d.productId).maybeSingle();
                    if (stockRow && d._estAfter != null) {
                        const diff = Math.abs((Number(stockRow.qty) || 0) - Number(d._estAfter));
                        if (diff > 0.001) flags.push(`مخزون صنف "${d.name}" الفعلي (${stockRow.qty}) يختلف عن التقدير وقت الأوفلاين (${d._estAfter})`);
                    }
                } catch {}
            }

            return { ok: true, summary: `مرتجع ${tempReturnNo} → ${returnNo} — ${retFmt(returnRow.total)} ج.م`, flags };
        } catch (err) {
            return { ok: false, error: err.message || String(err), summary: `مرتجع ${tempReturnNo}` };
        }
    });
}
