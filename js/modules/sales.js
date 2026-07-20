/* ════════════════════════════════════════════════════════════
   فاتورة المبيعات — تخطيط ثنائي / هوية كحلي + ذهبي
   مربوطة بـ Supabase (products / customers / inventory_stock)
   ════════════════════════════════════════════════════════════ */

// ── بيانات حية من Supabase (تُحمّل عند فتح الفاتورة) ──
let INV_DB = {
    products: [],      // products table
    customers: [],     // customers table
    warehouses: [],    // warehouses table
    reps: [],          // sales_reps table (تفضل فاضية لو الجدول لسه ما اتعملش — راجع sales_reps_migration.sql)
    stockMap: {},      // { 'warehouseId|productId': qty }
    invoiceNo: 1,      // رقم الفاتورة التالي
};
let invWarehouseId = null; // المخزن المختار حالياً
let invRepId = null;       // المندوب المختار (اختياري)

// ── حالة الفاتورة الحالية ──
let invItems = [];          // سطور الفاتورة
let invCustId = null;       // العميل المختار
let invPayType = 'credit';    // cash | credit
let invTreasuryId = null;   // الخزنة المختارة (للدفع النقدي)
let invEditingId = null;    // تعديل فاتورة قديمة
let invEditingOldItems = [];       // بنود الفاتورة القديمة (لإرجاع المخزون عند الإلغاء)
let invEditingOldWarehouse = null;
let invEditingOldTotal = 0;
let invEditingOldPayType = null;
let invEditingOldCustId = null;
let invEditingOldInvoiceNo = null;
let invPendingQuoteId = null; // عرض سعر بيتحوّل حالياً — يتعلّم "تم التحويل" بعد نجاح الحفظ بس (مش قبله)
let invPendingOrderId = null; // طلب سلطانو بيتحوّل حالياً — نفس المنطق، customer_orders.converted_sale_id بيتحدّث بعد الحفظ بس
let invPendingOrderNo = null; // رقم/إجمالي الطلب الأصلي — بيتعرض في بانر تأكيد واضح فوق الفاتورة عشان مايتلخبطش مع طلب تاني
let invPendingOrderTotal = null;

// ════════════════════════════════════════════════════════════
// 0) تحميل البيانات الحية من Supabase
// ════════════════════════════════════════════════════════════
// ★ Supabase بيرجع 1000 صف كحد أقصى افتراضي لأي select عادي —
//   product_prices بقى فيها أكتر من كده (5 مستويات × كل الأصناف)، فأي
//   select بسيط كان بيقطع الأصناف اللي وقعت بعد أول 1000 صف من غير أي
//   خطأ ظاهر (مسبب اختفاء مستوى السعر لبعض الأصناف في شاشة الفاتورة).
async function invFetchAllRows(table, select) {
    let all = [], from = 0;
    const pageSize = 1000;
    while (true) {
        const { data, error } = await sb.from(table).select(select).range(from, from + pageSize - 1);
        if (error) return { data: null, error };
        all = all.concat(data || []);
        if (!data || data.length < pageSize) break;
        from += pageSize;
    }
    return { data: all, error: null };
}

async function invLoadData() {
    let products, customers, warehouses, stockRows, lastSale, invCounterRow, priceLevels, productPrices, customerGroups;
    let liveLoadFailed = false;

    try {
        const results = await Promise.all([
            sb.from('products').select('*').eq('is_active', true).order('name'),
            sb.from('customers').select('*').eq('is_active', true).order('name'),
            sb.from('warehouses').select('*').order('name'),
            sb.from('inventory_stock').select('warehouse_id, product_id, qty'),
            sb.from('sales').select('invoice_no').order('created_at', { ascending: false }).limit(1),
            sb.from('app_settings').select('value').eq('key', 'invoice_counter').maybeSingle(),
            sb.from('price_levels').select('*').order('sort_order'),
            invFetchAllRows('product_prices', 'product_id, price, price_levels(code)'),
            sb.from('customer_groups').select('id, price_levels(code)'),
            sb.from('treasuries').select('*').eq('is_active', true).order('is_default', { ascending: false }),
        ]);
        [
            { data: products }, { data: customers }, { data: warehouses }, { data: stockRows },
            { data: lastSale }, { data: invCounterRow }, { data: priceLevels }, { data: productPrices }, { data: customerGroups },
            { data: treasuries },
        ] = results;
        // فشل شبكي حقيقي (أوفلاين) بيرجّع صفوف كلها null بدل ما يرمي استثناء —
        // لو الصنف الأساسي (products) فاضي تماماً، نعتبرها فشلة ونرجع للكاش
        if (!products) liveLoadFailed = true;
    } catch (err) {
        liveLoadFailed = true;
    }

    // ★ فشل التحميل الحي (على الأغلب أوفلاين)؟ ارجع لآخر نسخة محفوظة في
    //   الكاش (offline.js) — عشان المستخدم يقدر على الأقل يستعرض/يركّب
    //   فاتورة بالأصناف اللي كانت متاحة آخر مرة، حتى لو الحفظ نفسه لسه
    //   مش متاح أوفلاين (المرحلة دي جاية لاحقاً — راجع خطة الأوفلاين).
    INV_DB.isOfflineData = false;
    INV_DB.offlineDataAge = null;
    if (liveLoadFailed && typeof dbGetCache === 'function') {
        const [cp, cc, cw, cs] = await Promise.all([dbGetCache('products'), dbGetCache('customers'), dbGetCache('warehouses'), dbGetCache('inventory_stock')]);
        if (cp?.data?.length || cc?.data?.length) {
            products = cp?.data || [];
            customers = cc?.data || [];
            warehouses = cw?.data || [];
            // ★ مهم: من غير الرجوع لهنا، stockRows بتفضل null والمخزون
            //   بيتقدّر من صفر بدل الرصيد الحقيقي المخزّن — ده كان بيسبب
            //   فرق ثابت وهمي في تقرير المطابقة لكل عملية أوفلاين (راجع الجلسة).
            stockRows = cs?.data || [];
            INV_DB.isOfflineData = true;
            INV_DB.offlineDataAge = Math.min(cp?.updatedAt || Infinity, cc?.updatedAt || Infinity);
        }
    }

    INV_DB.products = products || [];
    INV_DB.customers = customers || [];
    INV_DB.warehouses = warehouses || [];
    INV_DB.priceLevels = priceLevels || [];
    INV_DB.treasuries = treasuries || [];

    // كاش للمراجعة الأوفلاين (offline.js) — قراءة فقط، بيتحدّث تلقائياً كل ما شاشة المبيعات تفتح أونلاين
    // (بس لو البيانات دي جاية أونلاين فعلاً، مش رجّاعة من الكاش نفسه)
    if (!INV_DB.isOfflineData && typeof dbSetCache === 'function') {
        dbSetCache('products', INV_DB.products);
        dbSetCache('customers', INV_DB.customers);
        dbSetCache('warehouses', INV_DB.warehouses);
        dbSetCache('inventory_stock', stockRows || []);
    }

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

    // فواتير مبيعات اتسجّلت أوفلاين ولسه في طابور المزامنة — لازم تُطرح
    // من المخزون المعروض ومن رصيد العميل المعروض دلوقتي، عشان لو فتحت
    // فاتورة جديدة (لسه أوفلاين) على نفس الصنف/العميل تشوف أثر الفاتورة
    // السابقة في التقدير (تقدير تراكمي، مش بس آخر فاتورة).
    await invApplyPendingEstimates();

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

    // مندوبو المبيعات (اختياري — لو جدول sales_reps لسه ما اتعملش في Supabase، نتجاهل الخطأ بهدوء
    // والقائمة المنسدلة بتختفي من الرأس تلقائياً بدل ما توقف تحميل الفاتورة كلها)
    // ★ لازم يتخزّن في نفس كاش الأوفلاين اللي بيستخدمه products/customers/warehouses —
    //   من غيره القائمة المنسدلة بتختفي تماماً وقت الأوفلاين (شرط invHeaderHTML هو
    //   `(INV_DB.reps||[]).length`)، يعني المستخدم أصلاً مايقدرش يختار مندوب وهو أوفلاين،
    //   فـ rep_id بيتبعت null للطابور من الأساس. ده كان السبب الحقيقي وراء "اسم المندوب
    //   بيختفي بعد المزامنة" — مش مشكلة في استرجاع rep_id من الـ payload وقت المزامنة
    //   (ده شغال صح فعلاً، راجع registerSyncHandler('sale', ...) تحت)، المشكلة إن
    //   المستخدم أصلاً مايقدرش يختاره وهو أوفلاين لأن القائمة كانت بتختفي.
    try {
        const { data: reps, error: repsErr } = await sb.from('sales_reps').select('*').eq('is_active', true).order('name');
        if (repsErr) throw repsErr;
        INV_DB.reps = reps || [];
        if (typeof dbSetCache === 'function') dbSetCache('sales_reps', INV_DB.reps);
    } catch {
        if (typeof dbGetCache === 'function') {
            try {
                const cachedReps = await dbGetCache('sales_reps');
                INV_DB.reps = cachedReps?.data || [];
            } catch { INV_DB.reps = []; }
        } else {
            INV_DB.reps = [];
        }
    }
}

// تقدير محلي تراكمي: يطرح أثر كل فواتير المبيعات المعلّقة (لسه ماتزامنتش)
// من خريطة المخزون ومن رصيد العميل المعروضين، بنفس فكرة colApplyPendingEstimates.
async function invApplyPendingEstimates() {
    if (typeof getQueue !== 'function') return;
    try {
        const pending = await getQueue(e => e.module === 'sales' && e.kind === 'sale' && (e.status === 'pending' || e.status === 'failed' || e.status === 'syncing'));
        const custDelta = {};
        for (const entry of pending) {
            for (const d of (entry.payload?._stockDeltas || [])) {
                const key = d.warehouseId + '|' + d.productId;
                INV_DB.stockMap[key] = (INV_DB.stockMap[key] || 0) - (Number(d.qty) || 0);
            }
            const custId = entry.payload?._custId;
            if (custId) custDelta[custId] = (custDelta[custId] || 0) + (Number(entry.payload?.saleRow?.total) || 0);
        }
        INV_DB.customers.forEach(c => { if (custDelta[c.id]) c.balance = (Number(c.balance) || 0) + custDelta[c.id]; });
    } catch {}
}

// رقم فاتورة مؤقت وقت الأوفلاين — بادئ بمعرّف الجهاز عشان يفضل فريد حتى
// لو أكتر من جهاز شغال أوفلاين في نفس الوقت. بيتستبدل برقم رسمي حقيقي
// (INV-XXXX) وقت نجاح المزامنة عبر fn_create_sale — راجع sync handler تحت.
function invNextOfflineInvoiceNo() {
    const key = 'inv_offline_seq';
    let seq = (parseInt(localStorage.getItem(key) || '0', 10) || 0) + 1;
    localStorage.setItem(key, String(seq));
    const deviceId = typeof offlineGetDeviceId === 'function' ? offlineGetDeviceId() : 'DEV';
    return `OFFLINE-${deviceId}-${seq}`;
}

// ── سعر بيع صنف حسب مستوى السعر ──
let invPriceLevelCode = 'RETAIL'; // القطاعي هو الافتراضي — قابل للتغيير من القائمة أو من مجموعة العميل

function invGetSellPrice(p) {
    // لو فيه مستوى سعر مختار، وله سعر مسجّل لهذا الصنف تحديداً، استخدمه
    if (invPriceLevelCode && p?.id) {
        const levelPrice = INV_DB.priceMap?.[p.id + '|' + invPriceLevelCode];
        if (levelPrice > 0) return levelPrice;
    }
    // fallback: قطاعي أولاً، وبعدين جملة لو مفيش سعر قطاعي مسجّل للصنف ده
    return Number(p?.retail_price) || Number(p?.wholesale_price) || 0;
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
// بيرجع null صراحة لأي قيمة فاضية/بيضاء (بدل ما يفضل '' يعدّي لحد الإرسال لقاعدة البيانات)
function invNormalizeRepId(v) {
    if (v == null) return null;
    const s = String(v).trim();
    return s ? s : null;
}
function invOnRepChange() {
    const sel = document.getElementById('invRep');
    if (sel) invRepId = invNormalizeRepId(sel.value);
    invApplyRepTreasury(invRepId);
}
// لو الفاتورة اتنسبت لمندوب (تلقائي من العميل أو يدوي)، والدفع نقدي،
// الخزنة الافتراضية لازم تبقى خزنة المندوب نفسه مش الخزنة الرئيسية —
// وإلا الكاش يتسجل فى مكان تاني غير درج المندوب اللي فعلاً باع وقبض.
// قابل للتغيير يدوياً بعد كده زي أي حقل تاني، ده بس افتراضي أذكى.
function invApplyRepTreasury(repId) {
    if (!repId) return;
    const rep = (INV_DB.reps || []).find(r => r.id === repId);
    if (!rep?.treasury_id) return;
    invTreasuryId = rep.treasury_id;
    const treasSel = document.getElementById('invTreasuryId');
    if (treasSel) treasSel.value = rep.treasury_id;
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
    invPayType = 'credit';
    invTreasuryId = INV_DB.treasuries?.find(t => t.is_default)?.id || null;
    invPriceLevelCode = 'RETAIL';
    invRepId = null;
    invEditingId = null; invEditingOldItems = []; invEditingOldInvoiceNo = null;
    invPendingQuoteId = null;
    invPendingOrderId = null;
    invPendingOrderNo = null;
    invPendingOrderTotal = null;

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
                invRepId = invNormalizeRepId(oldSale.rep_id);
                if (oldSale.treasury_id) invTreasuryId = oldSale.treasury_id;
                else invApplyRepTreasury(invRepId);
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
        // هيتعلّم "تم التحويل" بعد الحفظ الناجح فعلاً — راجع التعليق في quotations.js
        if (pending.kind === 'order') {
            invPendingOrderId = pending.quoteId || null;
            invPendingOrderNo = pending.orderNo || null;
            invPendingOrderTotal = pending.orderTotal || null;
        } else {
            invPendingQuoteId = pending.quoteId || null;
        }
    }

    c.innerHTML = `
    <div class="inv-root density-${invGetDensity()}">
        ${invEditingId ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:9px 16px;border-radius:9px;margin-bottom:8px;font-size:12.5px;display:flex;justify-content:space-between;align-items:center">
            <span>✏️ <strong>وضع تعديل</strong> — بتعدّل على الفاتورة <strong>${invEditingOldInvoiceNo}</strong>. عند الحفظ: هتتلغي الفاتورة القديمة تلقائياً (مع إرجاع المخزون والرصيد) وتتسجّل فاتورة جديدة بالتعديلات.</span>
            <button class="inv-top-btn" style="padding:4px 10px" onclick="invEditingId=null;invEditingOldInvoiceNo=null;renderSales(document.getElementById('app-content'))">إلغاء التعديل</button>
        </div>` : ''}
        ${invPendingOrderId ? `<div style="background:#DCFCE7;border:2px solid #16A34A;color:#166534;padding:12px 16px;border-radius:9px;margin-bottom:8px;font-size:13.5px;font-weight:700">
            ✅ بتعتمد طلب سلطانو <strong>${invPendingOrderNo || ''}</strong> بإجمالي <strong>${invFmt(invPendingOrderTotal || 0)} ج.م</strong> — تأكد إن الأصناف والإجمالي تحت مطابقين للرقم ده بالظبط قبل ما تحفظ، خصوصًا لو بتراجع أكتر من طلب في نفس الوقت.
        </div>` : ''}
        ${INV_DB.isOfflineData ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:9px 16px;border-radius:9px;margin-bottom:8px;font-size:12.5px">
            📴 <strong>غير متصل بالإنترنت</strong> — الأصناف والعملاء المعروضة من آخر نسخة محفوظة (${INV_DB.offlineDataAge ? new Date(INV_DB.offlineDataAge).toLocaleString('ar-EG') : '—'})، وممكن ماتكونش محدّثة. الفاتورة هتتسجّل محلياً برقم مؤقت وتتزامن تلقائياً برقم رسمي لما الاتصال يرجع. <strong>تعديل فاتورة موجودة مش متاح أوفلاين.</strong>
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
    invSetPayType(invPayType); // القالب فوق بيثبّت "نقدي" شكلياً — نزامن الشكل مع الحالة الحقيقية
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
        ${(INV_DB.reps || []).length ? `
        <select class="inv-date-input" id="invRep" title="المندوب" onchange="invOnRepChange()" style="cursor:pointer">
            <option value="">🚗 بدون مندوب</option>
            ${INV_DB.reps.map(r => `<option value="${r.id}" ${r.id === invRepId ? 'selected' : ''}>🚗 ${r.name}</option>`).join('')}
        </select>` : ''}
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
        <button class="inv-top-btn" id="invFullscreenBtn" onclick="invToggleFullscreen()" title="إخفاء القائمة والشريط العلوي">${document.body.classList.contains('inv-fullscreen') ? '⛶ إظهار القائمة' : '⛶ ملء الشاشة'}</button>
        <button class="inv-top-btn inv-top-save"   onclick="invSave(false)">💾 حفظ <kbd>F4</kbd></button>
        <button class="inv-top-btn inv-top-new"    onclick="invSave(true)">➕ جديدة <kbd>Alt+N</kbd></button>
        <button class="inv-top-btn inv-top-print"  onclick="invPrint()">🖨️ طباعة</button>
        <button class="inv-top-btn inv-top-close"  onclick="invClose()">✕</button>
    </div>`;
}

// وضع ملء الشاشة: بيخفي القائمة الجانبية والشريط العلوي عشان الفاتورة
// تاخد المساحة كلها — حل بديل لحد ما مشكلة اختصار طي القائمة (Alt+H)
// تتأكد إنها اتصلحت عند المستخدم، وكمان مفيد لوحده (بيخفي الشريط
// العلوي كمان، مش بس القائمة الجانبية).
window.invToggleFullscreen = function() {
    const on = document.body.classList.toggle('inv-fullscreen');
    const btn = document.getElementById('invFullscreenBtn');
    if (btn) btn.textContent = on ? '⛶ إظهار القائمة' : '⛶ ملء الشاشة';
};

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
        <button class="inv-add-row-btn" onclick="invOpenMultiPick()">☑️ اختيار أصناف متعددة</button>
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
        <select id="invTreasuryId" class="mod-form-input" style="margin-top:10px">
            ${(INV_DB.treasuries||[]).map(t => `<option value="${t.id}" ${t.id===invTreasuryId?'selected':''}>${t.name}</option>`).join('')}
        </select>
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
        <button class="inv-btn inv-btn-print" onclick="invSaveAndPrint()">🖨️ حفظ وطباعة</button>
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
            <td class="inv-cell-total" id="invRowTotal-${idx}">${invFmt(lineTotal)}<div style="font-size:10.5px;color:${marginPct>=20?'var(--inv-green)':'var(--inv-red)'};font-weight:600">${prod && costPrice ? marginPct+'% ربح' : ''}</div></td>
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
    el.innerHTML = `${invFmt(lineTotal)}<div style="font-size:10.5px;color:${marginPct>=20?'var(--inv-green)':'var(--inv-red)'};font-weight:600">${prod && costPrice ? marginPct+'% ربح' : ''}</div>`;
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
    // من غير كتابة: تعرض أول 8 عملاء زي ما هم، عشان القائمة تظهر على طول
    // أول ما تدوس على الخانة (مش لازم تكتب حاجة الأول)
    const m = (val.length ? INV_DB.customers.filter(c =>
        (c.name||'').includes(val) || (c.phone||'').includes(val) || (c.code||'').includes(val)
    ) : INV_DB.customers).slice(0,8);
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
    // نسب المندوب الأساسي بتاع العميل تلقائياً للفاتورة — بس لو مفيش مندوب متختار
    // فعلاً (عشان مانكسرش اختيار يدوي سابق)، يقدر المستخدم يغيّره بحرية بعد كده
    if (c.default_rep_id && !invRepId) {
        invRepId = c.default_rep_id;
        const repSel = document.getElementById('invRep');
        if (repSel) repSel.value = c.default_rep_id;
        invApplyRepTreasury(invRepId);
    }
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
    // من غير كتابة: تعرض أول 8 أصناف زي ما هم، عشان القائمة تظهر على طول
    // أول ما تدوس على الخانة (مش لازم تكتب حاجة الأول)
    const m = (val.length ? INV_DB.products.filter(p =>
        (p.name||'').includes(val) || (p.code||'').includes(val) || (p.barcode||'').includes(val)
    ) : INV_DB.products).slice(0,8);
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

// ── اختيار أصناف متعددة دفعة واحدة (مودال: بحث + checkbox + كمية) ──
// ★ نسخة مستقلة خاصة بفاتورة المبيعات — مش بتشارك كود مع أي مودال مشابه
//   في ملفات تانية (زي returns.js)، بنفس منطق invGetSellPrice/invPriceLevelCode
//   المستخدم في باقي الفاتورة.
let _invMultiSelected = {}; // { productId: qty }
function invOpenMultiPick() {
    document.getElementById('invMultiModal')?.remove();
    const m = document.createElement('div');
    m.id = 'invMultiModal';
    m.className = 'mod-modal-bg active';
    m.innerHTML = `
    <div class="mod-modal" style="max-width:640px">
        <div class="mod-modal-header"><h3>☑️ اختيار أصناف متعددة</h3>
            <button class="mod-modal-close" onclick="invCloseMultiPick()">✕</button></div>
        <div class="mod-modal-body">
            <input type="text" class="mod-form-input" id="invMultiSearch" placeholder="بحث بالاسم / الكود..." autocomplete="off" oninput="invRenderMultiPickList(this.value)">
            <div id="invMultiPickList" style="margin-top:12px;display:flex;flex-direction:column;gap:6px"></div>
        </div>
        <div class="mod-modal-footer">
            <button class="inv-btn inv-btn-print" onclick="invCloseMultiPick()">إلغاء</button>
            <button class="inv-btn inv-btn-save" onclick="invAddMultiPicked()">➕ إضافة المحدد</button>
        </div>
    </div>`;
    document.body.appendChild(m);
    _invMultiSelected = {};
    invRenderMultiPickList('');
    setTimeout(()=>document.getElementById('invMultiSearch')?.focus(), 50);
}
function invCloseMultiPick() {
    document.getElementById('invMultiModal')?.remove();
    _invMultiSelected = {};
}
function invRenderMultiPickList(val) {
    const box = document.getElementById('invMultiPickList');
    if (!box) return;
    const v = (val||'').trim();
    const list = v ? INV_DB.products.filter(p => (p.name||'').includes(v) || (p.code||'').includes(v)) : INV_DB.products;
    if (!list.length) { box.innerHTML = '<div style="padding:20px;text-align:center;color:#94A3B8">لا توجد نتائج</div>'; return; }
    box.innerHTML = list.slice(0, 200).map(p => {
        const sel = _invMultiSelected[p.id];
        const checked = sel != null;
        const qty = sel ?? 1;
        return `<label class="inv-multi-row" data-pid="${p.id}" style="display:flex;align-items:center;gap:10px;padding:7px 10px;border:1.5px solid #E2E8F0;border-radius:10px;cursor:pointer">
            <input type="checkbox" ${checked?'checked':''} onchange="invMultiToggle('${p.id}',this.checked)">
            <span style="flex:1">${p.name} <small style="color:#94A3B8">${p.code||''} · ${p.unit||''}</small></span>
            <span style="font-size:11px;color:#94A3B8">مخزون: ${invGetStock(p.id)}</span>
            <span style="font-size:12px;color:#0F172A;font-weight:600">${invFmt(invGetSellPrice(p))}</span>
            <input type="number" class="mod-form-input" value="${qty}" min="0.001" step="0.001" style="width:76px;padding:6px 8px"
                onclick="event.stopPropagation()" oninput="invMultiSetQty('${p.id}',this.value)">
        </label>`;
    }).join('');
}
function invMultiToggle(pid, checked) {
    if (checked) { if (_invMultiSelected[pid] == null) _invMultiSelected[pid] = 1; }
    else delete _invMultiSelected[pid];
}
function invMultiSetQty(pid, val) {
    const q = parseFloat(val) || 0;
    if (q <= 0) return;
    _invMultiSelected[pid] = q;
    const cb = document.querySelector(`.inv-multi-row[data-pid="${pid}"] input[type=checkbox]`);
    if (cb && !cb.checked) cb.checked = true;
}
function invAddMultiPicked() {
    const ids = Object.keys(_invMultiSelected);
    if (!ids.length) { invToast('⚠️ لم يتم اختيار أي صنف', 'error'); return; }
    let added = 0;
    ids.forEach(pid => {
        const p = INV_DB.products.find(x => x.id === pid);
        if (!p) return;
        const qty = _invMultiSelected[pid] || 1;
        const ex = invItems.findIndex(i => i.pid === pid);
        if (ex >= 0) {
            invItems[ex].qty = (invItems[ex].qty || 0) + qty;
        } else {
            const sell = invGetSellPrice(p);
            const last = invItems[invItems.length-1];
            if (last && !last.pid) {
                last.pid = p.id; last.name = p.name; last.code = p.code||'';
                last.unit = p.unit||''; last.price = sell; last.qty = qty; last.upc = p.units_per_carton||1;
            } else {
                invItems.push({ id: Date.now()+added, pid: p.id, name: p.name, code: p.code||'', qty, price: sell, disc: 0, free: 0, unit: p.unit||'', upc: p.units_per_carton||1 });
            }
        }
        added++;
    });
    invEnsureNewRow();
    invRenderItems();
    invUpdateSummary();
    invCloseMultiPick();
    invToast(`➕ تمت إضافة ${added} صنف دفعة واحدة`, 'success');
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
    // ★ الإلغاء + إرجاع المخزون + إرجاع الرصيد كانوا 3 نداءات منفصلة من
    //   المتصفح — لو حصل قطع اتصال في النص، ممكن يفضل المخزون أو الرصيد
    //   متسق جزئياً بس. دلوقتي عملية واحدة ذرّية في قاعدة البيانات
    //   (fn_reverse_sale_for_edit — راجع edit_reversal_atomic_migration.sql)،
    //   كلها بتنجح أو كلها بترجع. نفس الحسابات بالظبط اللي كانت هنا.
    const { error } = await sb.rpc('fn_reverse_sale_for_edit', { p_sale_id: invEditingId });
    if (error) throw error;

    // تحديث الكاش المحلي (تقدير للعرض بس) بنفس القيم اللي السيرفر طبّقها فعلاً
    if (invEditingOldWarehouse) {
        for (const it of invEditingOldItems) {
            const need = (Number(it.qty) || 0) + (Number(it.free_qty) || 0);
            if (!it.product_id || !need) continue;
            const key = invEditingOldWarehouse + '|' + it.product_id;
            INV_DB.stockMap[key] = (INV_DB.stockMap[key] || 0) + need;
        }
    }
    if (invEditingOldPayType === 'credit' && invEditingOldCustId) {
        const c = INV_DB.customers.find(x => x.id === invEditingOldCustId);
        if (c) c.balance = (Number(c.balance) || 0) - invEditingOldTotal;
    }
}

async function invSave(andNew) {
    const offline = typeof isOnline === 'function' && !isOnline();

    // ★ تعديل فاتورة موجودة محتاج يلغي القديمة ويرجع المخزون/الرصيد أونلاين
    //   (invReverseOldForEdit) — ده معقّد وخطير يتنفّذ بتقدير محلي، فبيفضل
    //   محتاج اتصال. الحفظ العادي (فاتورة جديدة) هو المدعوم أوفلاين.
    if (invEditingId && offline) {
        invToast('📴 تعديل فاتورة موجودة محتاج اتصال بالإنترنت — التعديل هيتاح تاني لما الاتصال يرجع', 'error');
        return { ok: false };
    }

    const filled = invItems.filter(i => i.pid && (i.qty||0) > 0);
    if (!filled.length) { invToast('⚠️ الفاتورة فارغة — أضف أصنافاً أولاً', 'error'); return { ok: false }; }

    const { subtotal, rowsDisc, extra, net } = invCalcNet();
    let invoiceNo = 'INV-' + String(INV_DB.invoiceNo).padStart(4, '0');

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
            if (!proceed) return { ok: false };
        }
    }

    // فحص الحد الائتماني للعميل الآجل
    if (invPayType === 'credit' && invCustId) {
        const c = INV_DB.customers.find(x=>x.id===invCustId);
        const limit = Number(c?.credit_limit) || 0;
        if (limit > 0 && (Number(c?.balance)||0) + net > limit) {
            const over = ((Number(c?.balance)||0) + net - limit).toFixed(2);
            if (!confirm(`⚠️ تجاوز الحد الائتماني!\n\nالعميل: ${c.name}\nالحد: ${invFmt(limit)} ج.م\nالرصيد الحالي: ${invFmt(c.balance)} ج.م\nالفاتورة: ${invFmt(net)} ج.م\nالتجاوز: ${over} ج.م\n\nهل تريد المتابعة؟`)) return { ok: false };
        }
    }

    // زرار التحميل
    const saveBtns = document.querySelectorAll('.inv-btn-save, .inv-top-save');
    saveBtns.forEach(b => { b.innerText = '⏳ جاري الحفظ...'; b.disabled = true; });

    try {
        // ★ أوفلاين: بدل الحفظ الحي، سجّل الفاتورة في طابور المزامنة برقم
        //   مؤقت + تقدير محلي (مخزون/رصيد عميل) — الحقيقة الفعلية بتتحدد
        //   وقت المزامنة (fn_create_sale RPC + sync handler تحت).
        if (offline) {
            const stockDeltas = filled.map(it => {
                const key = invWarehouseId + '|' + it.pid;
                const need = (it.qty||0) + (it.free||0);
                return { warehouseId: invWarehouseId, productId: it.pid, qty: need, name: it.name, _estAfter: (INV_DB.stockMap[key] || 0) - need };
            });
            const payload = {
                tempInvoiceNo: invNextOfflineInvoiceNo(),
                saleRow: {
                    customer_id: invCustId || null,
                    payment_type: invPayType,
                    subtotal, vat_amount: 0, total: net, discount: extra,
                    status: 'confirmed', warehouse_id: invWarehouseId,
                    rep_id: invNormalizeRepId(invRepId),
                    treasury_id: invPayType === 'cash' ? (document.getElementById('invTreasuryId')?.value || invTreasuryId || null) : null,
                    source_app: 'erp', created_by: currentUser?.id || null,
                },
                items: filled.map(it => {
                    const prod = INV_DB.products.find(p=>p.id===it.pid);
                    const lineTotal = (it.qty||0) * (it.price||0) * (1 - (it.disc||0)/100);
                    return {
                        product_id: it.pid, qty: it.qty, unit_price: it.price, line_total: lineTotal,
                        unit_type: 'sale_unit', units_per_carton_snapshot: prod?.units_per_carton || 1,
                        discount_pct: it.disc || 0, free_qty: it.free || 0,
                        cost_price_snapshot: prod ? invGetBuyPrice(prod) : 0,
                        unit_name: prod?.unit || it.unit || 'قطعة',
                    };
                }),
                _stockDeltas: stockDeltas,
                _custId: (invPayType === 'credit' && invCustId) ? invCustId : null,
                _custEstBalanceAfter: null,
                _quoteId: invPendingQuoteId || null,
            };
            if (payload._custId) {
                const c = INV_DB.customers.find(x => x.id === invCustId);
                payload._custEstBalanceAfter = (Number(c?.balance) || 0) + net;
            }

            await queueWrite({ module: 'sales', kind: 'sale', payload, tempRef: payload.tempInvoiceNo });

            // تحديث محلي متفائل (تقدير للعرض بس — نفس منطق الأونلاين تحت)
            if (invWarehouseId) {
                for (const it of filled) {
                    const need = (it.qty||0) + (it.free||0);
                    const key = invWarehouseId + '|' + it.pid;
                    INV_DB.stockMap[key] = (INV_DB.stockMap[key] || 0) - need;
                }
            }
            if (invPayType === 'credit' && invCustId) {
                const c = INV_DB.customers.find(x=>x.id===invCustId);
                if (c) c.balance = (Number(c.balance)||0) + net;
            }

            localStorage.removeItem(INV_AUTOSAVE_KEY);
            invToast(`⏳ اتسجّلت الفاتورة محلياً (${payload.tempInvoiceNo}) — هتاخد رقم رسمي وتتزامن تلقائياً لما الاتصال يرجع — ${invFmt(net)} ج.م`, 'info');

            // ★ أي حفظ ناجح بيفتح فاتورة جديدة فاضية دايماً — مش بس "حفظ
            //   وفاتورة جديدة" — المستخدم مش عايز يفضل واقف على نفس الفاتورة
            //   والأصناف بعد الحفظ (لا في "حفظ" ولا "حفظ وطباعة").
            renderSales(document.getElementById('app-content'));
            return { ok: true, invoiceNo: payload.tempInvoiceNo };
        }

        // ★ لو في وضع تعديل: ألغِ الفاتورة القديمة وارجع المخزون والرصيد قبل إنشاء النسخة الجديدة
        if (invEditingId) {
            await invReverseOldForEdit();
        }

        // ★ تطبيع + تحقق حي من rep_id قبل الإرسال.
        //   ملاحظة مهمة: التحقق القديم كان بيقارن مع INV_DB.reps المحلية —
        //   ده عديم الفائدة لأن invRepId أصلاً اتحدد من نفس القائمة دي
        //   (مستحيل يختلفوا). المشكلة الحقيقية: INV_DB.reps بتتحمّل مرة
        //   واحدة وقت فتح الفاتورة، فلو المندوب اتحذف من قاعدة البيانات
        //   بعد كده (يدوياً من Supabase مثلاً) والفاتورة فضلت مفتوحة في
        //   نفس الجلسة من غير إعادة تحميل، هيفضل موجود في القائمة المحلية
        //   القديمة بس مش موجود فعلياً في sales_reps → fk violation عند
        //   الحفظ. الحل: نتأكد حياً من القاعدة نفسها قبل الإرسال مباشرة.
        let repIdToSend = invNormalizeRepId(invRepId);
        if (repIdToSend) {
            try {
                const { data: repCheck, error: repCheckErr } = await sb.from('sales_reps').select('id').eq('id', repIdToSend).maybeSingle();
                console.log('[invSave] نتيجة التحقق الحي من sales_reps:', { queriedId: repIdToSend, repCheck, repCheckErr });
                if (repCheckErr) throw repCheckErr;
                if (!repCheck) {
                    console.warn('[invSave] rep_id غير موجود فعلياً في sales_reps (تحقق حي من القاعدة) — هيتبعت null:', repIdToSend);
                    invToast('⚠️ المندوب المختار لم يعد موجوداً — تم حفظ الفاتورة بدون مندوب', 'error');
                    repIdToSend = null;
                    invRepId = null;
                    // حدّث القائمة المحلية في الخلفية عشان القائمة المنسدلة تتظبط لو المستخدم فتح فاتورة تانية
                    sb.from('sales_reps').select('*').eq('is_active', true).order('name').then(({ data }) => { if (data) INV_DB.reps = data; });
                }
            } catch (e) {
                console.warn('[invSave] تعذّر التحقق الحي من rep_id، هيتبعت زي ما هو:', e.message);
            }
        }
        console.log('[invSave] rep_id قبل الإرسال (بعد التحقق الحي):', repIdToSend, '— typeof:', typeof repIdToSend);

        // ★ إنشاء الهيدر + البنود + زيادة العداد كلهم في ترانزاكشن واحدة عبر
        //   fn_create_sale (Postgres RPC) — بدل 4 خطوات منفصلة من الفرونت
        //   إند. السبب: fn_sale_status_change (تريجر AFTER INSERT على sales)
        //   بيرحّل قيد اليومية ويأثّر على رصيد العميل فور INSERT الهيدر —
        //   قبل ما البنود تتسجل أصلاً. لو إدراج البنود فشل لأي سبب، كان
        //   بيفضل هيدر "confirmed" معلّق بقيد وبرصيد متأثر من غير بنود،
        //   والعداد (invoice_counter) ميترفعش، فأي محاولة تانية كانت هتتصادم
        //   على نفس invoice_no (كان فيه تعليق قديم هنا بيوصف الاحتمالية دي
        //   بالظبط، والفحص اللي كان موجود كان بس بيكتشف التصادم من غير ما
        //   يمنعه). الدالة دلوقتي بترجع كل حاجة تلقائيًا لو أي خطوة فشلت.
        const itemsPayload = filled.map(it => {
            const prod = INV_DB.products.find(p => p.id === it.pid);
            const lineTotal = (it.qty || 0) * (it.price || 0) * (1 - (it.disc || 0) / 100);
            return {
                product_id: it.pid, qty: it.qty, unit_price: it.price, line_total: lineTotal,
                unit_type: 'sale_unit', units_per_carton_snapshot: prod?.units_per_carton || 1,
                discount_pct: it.disc || 0, free_qty: it.free || 0,
                cost_price_snapshot: prod ? invGetBuyPrice(prod) : 0,
                unit_name: prod?.unit || it.unit || 'قطعة',
            };
        });
        const { data: rpcRows, error: rpcErr } = await sb.rpc('fn_create_sale', {
            p_customer_id: invCustId || null,
            p_payment_type: invPayType,
            p_subtotal: subtotal,
            p_vat_amount: 0,
            p_total: net,
            p_discount: extra,
            p_warehouse_id: invWarehouseId,
            p_rep_id: repIdToSend,
            p_treasury_id: invPayType === 'cash' ? (document.getElementById('invTreasuryId')?.value || invTreasuryId || null) : null,
            p_source_app: 'erp',
            p_created_by: currentUser?.id || null,
            p_items: itemsPayload,
        });
        if (rpcErr) throw rpcErr;
        if (rpcRows?.[0]?.invoice_no) invoiceNo = rpcRows[0].invoice_no;

        // تحديث الـ cache المحلي للمخزون فقط
        // (الخصم الفعلي في قاعدة البيانات بيقوم بيه الـ trigger تلقائياً عند INSERT في sale_items)
        if (invWarehouseId) {
            for (const it of filled) {
                const need = (it.qty||0) + (it.free||0);
                const key = invWarehouseId + '|' + it.pid;
                INV_DB.stockMap[key] = (INV_DB.stockMap[key] || 0) - need;
            }
        }
        // العداد بيتقفل ويتحرك جوه الـ RPC نفسها — نطابق العرض المحلي على
        // الرقم الحقيقي اللي الدالة رجّعته (مش تخمين قديم ممكن يكون بعيد
        // عن الحقيقة تحت سباق مستخدمين متزامنين)
        const invoiceNoMatch = invoiceNo.match(/(\d+)$/);
        if (invoiceNoMatch) INV_DB.invoiceNo = parseInt(invoiceNoMatch[1], 10) + 1;

        // ★ لو الفاتورة دي جاية من تحويل عرض سعر، اتعلّم "تم التحويل" دلوقتي
        //   بس — بعد ما فاتورة البيع الحقيقية اتسجّلت بنجاح فعلاً (راجع
        //   التعليق في quotations.js لسبب التعديل).
        if (invPendingQuoteId) {
            try {
                await sb.from('quotations').update({ status: 'converted' }).eq('id', invPendingQuoteId);
            } catch {}
            invPendingQuoteId = null;
        }

        // ★ لو الفاتورة دي جاية من اعتماد طلب سلطانو، اربط الطلب بالفاتورة
        //   الحقيقية دلوقتي بس — بعد نجاح الحفظ فعلاً (نفس منطق عروض الأسعار فوق)
        if (invPendingOrderId) {
            try {
                await sb.from('customer_orders').update({
                    converted_sale_id: rpcRows?.[0]?.id || null,
                    reviewed_by: currentUser?.id || null,
                    reviewed_at: new Date().toISOString(),
                    status: 'preparing', // كان بيفضل "جديد" للأبد عند العميل حتى بعد الاعتماد
                }).eq('id', invPendingOrderId);
            } catch {}
            invPendingOrderId = null;
            invPendingOrderNo = null;
            invPendingOrderTotal = null;
        }

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

        // ★ أي حفظ ناجح بيفتح فاتورة جديدة فاضية دايماً (زي andNew بالظبط) —
        //   المستخدم مش عايز يفضل واقف على نفس الفاتورة والأصناف بعد الحفظ.
        renderSales(document.getElementById('app-content'));
        return { ok: true, invoiceNo };
    } catch (err) {
        // ★ نطبع تفاصيل الخطأ كاملة (message/details/hint/code) بدل الاكتفاء بـ message —
        //   عشان نعرف بالظبط أي constraint اتكسر (ممكن يكون invoice_no مكرر
        //   مثلاً، مش بالضرورة rep_id، حتى لو ظهر في اللوج قبله).
        console.error('[invSave] فشل حفظ الفاتورة — تفاصيل الخطأ كاملة:', {
            message: err.message, details: err.details, hint: err.hint, code: err.code, raw: err,
        });
        alert('❌ خطأ أثناء حفظ الفاتورة: ' + err.message + (err.details ? '\n\nتفاصيل: ' + err.details : '') + (err.hint ? '\nاقتراح: ' + err.hint : ''));
        return { ok: false };
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
    const badgeText = document.querySelector('.inv-no-badge')?.textContent?.trim();

    await printThermalReceipt('sale', {
        invoiceNo: badgeText || ('INV-' + String(INV_DB.invoiceNo).padStart(4,'0')),
        customerName: cust?.name || null,
        customerPhone: cust?.phone || null,
        paymentType: invPayType,
        items: filled.map(it => ({ name: it.name, qty: it.qty, unit_price: it.price, line_total: (it.qty||0)*(it.price||0)*(1-(it.disc||0)/100) })),
        subtotal, discount: extra, total: net,
        previousBalance: cust?.balance || 0,
        paidAmount: paid,
    });
}

// زرار "حفظ وطباعة": يحفظ الفاتورة فعلياً الأول (invSave)، وبس لو الحفظ
// نجح فعلاً بيطبع. ★ مهم: invSave دلوقتي بيفتح فاتورة جديدة فاضية فوراً
// بعد أي حفظ ناجح (عشان المستخدم مش عايز يفضل واقف على نفس الفاتورة) —
// يعني لازم نلقط كل بيانات الإيصال *قبل* ما ننده على invSave، مش بعده،
// وإلا هنطبع فاتورة فاضية. رقم الفاتورة الحقيقي (أو المؤقت لو أوفلاين)
// بييجي من invSave نفسها بعد النجاح، مش من الشاشة بعد الـ reset.
async function invSaveAndPrint() {
    const filled = invItems.filter(i => i.pid && (i.qty||0) > 0);
    if (!filled.length) { invToast('⚠️ الفاتورة فارغة — أضف أصنافاً أولاً', 'error'); return; }

    const { subtotal, extra, net } = invCalcNet();
    const cust = invCustId ? INV_DB.customers.find(x=>x.id===invCustId) : null;
    const printPayload = {
        customerName: cust?.name || null,
        customerPhone: cust?.phone || null,
        paymentType: invPayType,
        items: filled.map(it => ({ name: it.name, qty: it.qty, unit_price: it.price, line_total: (it.qty||0)*(it.price||0)*(1-(it.disc||0)/100) })),
        subtotal, discount: extra, total: net,
        previousBalance: cust?.balance || 0,
        paidAmount: invPayType === 'cash' ? parseFloat(document.getElementById('invCashReceived')?.value) || net : null,
    };

    const result = await invSave(false);
    if (!result?.ok) return;

    await printThermalReceipt('sale', { invoiceNo: result.invoiceNo, ...printPayload });
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
    cs?.addEventListener('focus', ()=>{ _custACIdx=-1; invSearchCustomer(cs.value); });
    cs?.addEventListener('keydown', invCustACKey);

    // البحث السريع
    const fs = document.getElementById('invFastSearch');
    fs?.addEventListener('input', ()=>{ _fastIdx=-1; invFastSearch(fs.value); });
    fs?.addEventListener('focus', ()=>{ _fastIdx=-1; invFastSearch(fs.value); });
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
        if (document.getElementById('invMultiModal')) { invCloseMultiPick(); return; }
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
    invSave, invPrint, invSaveAndPrint, invDraft, invClose, invAddRow, invRemoveRow, invFocusRow,
    invSetPayType, invSetCash, invSetExactCash, invCalcChange, invTogglePayType,
    invSelectCustomer, invClearCustomer, invPickProduct, invPickInline,
    invOnName, invOnNameKey, invOnCode, invRowKey, invUpdateSummary, invUpdateRowTotal, invSetPriceLevel,
    invRowACHover, invCustACHover, invFastHover,
    invGetDensity, invSetDensity,
    invShowShortcuts, invCloseShortcuts,
    invRestoreDraft, invDeleteDraft, invRenderDrafts,
    invExportXls, invImportXls,
    invOnWarehouseChange, invOnRepChange,
    invOpenMultiPick, invCloseMultiPick, invRenderMultiPickList, invMultiToggle, invMultiSetQty, invAddMultiPicked,
});

// ════════════════════════════════════════════════════════════
// 12) مزامنة فواتير المبيعات المعلّقة (Phase 3 — دعم الأوفلاين)
//     ★ 'sale' مسجّلة في OFFLINE_STRICT_ORDER_KINDS (js/offline.js) —
//     المزامنة بترتيب صارم وتوقف عند أول فشل، لأن كل فاتورة أوفلاين
//     مبنية على افتراض إن اللي قبلها في الطابور نجحت (تقدير المخزون تراكمي).
// ════════════════════════════════════════════════════════════
if (typeof registerSyncHandler === 'function') {
    registerSyncHandler('sale', async (entry) => {
        const { tempInvoiceNo, saleRow, items, _custId, _custEstBalanceAfter, _stockDeltas, _quoteId } = entry.payload;
        try {
            // تحقق حي من rep_id (نفس منطق invSave الأونلاين) — لو اتحذف
            // المندوب بعد ما الفاتورة اتسجّلت أوفلاين، ابعتها بدون مندوب.
            let repId = saleRow.rep_id;
            if (repId) {
                try {
                    const { data: repCheck } = await sb.from('sales_reps').select('id').eq('id', repId).maybeSingle();
                    if (!repCheck) repId = null;
                } catch {}
            }

            // ★ نفس فكرة invSave الأونلاين بالظبط (راجع تعليقها) — هيدر + بنود
            //   + عداد جوه ترانزاكشن واحدة عبر fn_create_sale. الكود القديم هنا
            //   كان بيعمل DELETE للهيدر لو فشلت البنود (محاولة "رجوع" يدوية)،
            //   لكن ده مكنش كافي: مسح الصف من غير ما يرجّع أثر التريجر (قيد
            //   يومية + رصيد عميل اتسجلوا فور INSERT الهيدر) كان بيسيب نفس
            //   فخ return_no/journal_entries المكرر اللي اتصلح النهاردة.
            const { data: rpcRows, error: rpcErr } = await sb.rpc('fn_create_sale', {
                p_customer_id: saleRow.customer_id,
                p_payment_type: saleRow.payment_type,
                p_subtotal: saleRow.subtotal,
                p_vat_amount: saleRow.vat_amount,
                p_total: saleRow.total,
                p_discount: saleRow.discount,
                p_warehouse_id: saleRow.warehouse_id,
                p_rep_id: repId,
                p_treasury_id: saleRow.treasury_id,
                p_source_app: saleRow.source_app,
                p_created_by: saleRow.created_by,
                p_items: items,
            });
            if (rpcErr) return { ok: false, error: rpcErr.message, summary: `فاتورة ${tempInvoiceNo}` };
            const invoiceNo = rpcRows[0].invoice_no;

            // لو الفاتورة دي جاية أصلاً من تحويل عرض سعر، اتعلّم "تم التحويل"
            // دلوقتي بس — بعد ما فاتورة البيع اتزامنت فعلياً على السيرفر.
            if (_quoteId) {
                try { await sb.from('quotations').update({ status: 'converted' }).eq('id', _quoteId); } catch {}
            }

            // مطابقة: قارن المخزون/رصيد العميل الفعليين (بعد الـ triggers) بالتقدير المحلي وقت الأوفلاين
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
            if (_custId && _custEstBalanceAfter != null) {
                try {
                    const { data: freshCust } = await sb.from('customers').select('balance').eq('id', _custId).maybeSingle();
                    if (freshCust) {
                        const diff = Math.abs((Number(freshCust.balance) || 0) - Number(_custEstBalanceAfter));
                        if (diff > 0.01) flags.push(`رصيد العميل الفعلي بعد المزامنة (${invFmt(freshCust.balance)}) يختلف عن التقدير وقت الأوفلاين (${invFmt(_custEstBalanceAfter)})`);
                    }
                } catch {}
            }

            return { ok: true, summary: `فاتورة ${tempInvoiceNo} → ${invoiceNo} — ${invFmt(saleRow.total)} ج.م`, flags };
        } catch (err) {
            return { ok: false, error: err.message || String(err), summary: `فاتورة ${tempInvoiceNo}` };
        }
    });
}
