/* ════════════════════════════════════════════════════════════
   إدارة الأصناف — products.js
   قائمة + بحث + إضافة/تعديل + ربط مستويات الأسعار الخمسة
   INSERT/UPDATE مباشر في products + product_prices (master data
   بحتة — لا تمر بمحرك مالي، فلا تعارض مع الـ Triggers المالية)
   ════════════════════════════════════════════════════════════ */

let _prodList = [];
let _prodCategories = [];
let _prodCompanies = [];
let _prodPriceLevels = [];
let _prodPricesMap = {};
let _prodSuppliers = [];
let _prodSearch = '';
let _prodFilterCat = '';
let _prodFilterCompany = '';
let _prodEditingId = null;
const PROD_IMAGE_BUCKET = 'product-images'; // باكت عام (Public) — عشان سلطانو يعرض الصورة للعميل من غير تسجيل دخول
// المؤجل التقديري (مبلغ فعلي للوحدة) المستخدم في حساب هامش الربح داخل مودال
// التعديل الحالي (آخر مؤجل اتسجل لهذا الصنف في فواتير الشراء — راجع prodOpenModal)
let _prodModalDeferredRate = 0;
// النوع الحالي لـ"المؤجل الافتراضي" جوه المودال المفتوح (percent|fixed) —
// state بسيط بره الـ DOM عشان زرار التبديل يقدر يغيّر label/max الحقل
let _prodModalDefaultDeferredType = 'percent';

function prodFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// ★ Supabase بيرجع 1000 صف بالظبط كحد أقصى افتراضي لأي select عادي —
//   product_prices بقى فيها أكتر من كده (5 مستويات × كل الأصناف)، فأي
//   select بسيط كان بيقطع الأصناف اللي وقعت بعد أول 1000 صف من غير أي
//   خطأ ظاهر (مسبب مشكلة "أسعار ناقصة" اللي ظهرت في صفحة الأصناف).
//   الحل: جلب الصفحات كلها بحلقة .range() لحد ما نوصل لصفحة أصغر من 1000.
async function prodFetchAllRows(table, select) {
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

// ════════════════════════════════════════════════════════════
// 1) التحميل والعرض الرئيسي
// ════════════════════════════════════════════════════════════
async function renderProducts(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل الأصناف...</div>';
    try {
        const [{ data: products }, { data: categories }, { data: companies }, { data: levels }, { data: stock }, { data: allPrices }, { data: suppliers }] = await Promise.all([
            sb.from('products').select('*').order('name'),
            sb.from('product_categories').select('*').order('name'),
            sb.from('product_companies').select('*').order('name'),
            sb.from('price_levels').select('*').order('sort_order'),
            sb.from('inventory_stock').select('product_id, qty'),
            // ★ كل أسعار كل المستويات لكل الأصناف مرة واحدة — عشان تظهر
            //   الأسعار الباقية (مش سعر البيع الأساسي بس) في قائمة الأصناف
            //   نفسها، بدل ما يحتاج المستخدم يفتح تعديل كل صنف لوحده.
            prodFetchAllRows('product_prices', 'product_id, price_level_id, price'),
            sb.from('suppliers').select('id, name').eq('is_active', true).order('name'),
        ]);
        _prodList = products || [];
        _prodCategories = categories || [];
        _prodCompanies = companies || [];
        _prodPriceLevels = levels || [];
        _prodSuppliers = suppliers || [];

        // مجموع المخزون لكل صنف (عبر كل المخازن) — للعرض السريع في القائمة
        const stockTotals = {};
        (stock||[]).forEach(s => { stockTotals[s.product_id] = (stockTotals[s.product_id]||0) + Number(s.qty||0); });
        _prodList.forEach(p => p._totalStock = stockTotals[p.id] || 0);

        // خريطة أسعار كل مستوى لكل صنف: productId -> { levelId: price }
        _prodPricesMap = {};
        (allPrices||[]).forEach(r => {
            if (!_prodPricesMap[r.product_id]) _prodPricesMap[r.product_id] = {};
            _prodPricesMap[r.product_id][r.price_level_id] = r.price;
        });

        prodRenderPage(c);

        // ★ جاي من بحث Ctrl+K (app.js) — افتح تعديل نفس الصنف تلقائياً
        if (window._pendingProductEdit) {
            const pendId = window._pendingProductEdit;
            window._pendingProductEdit = null;
            prodOpenEdit(pendId);
        }
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function prodRenderPage(c) {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px">
            <div><h2 style="font-size:22px;font-weight:800">🏷️ الأصناف</h2>
            <p style="font-size:13px;color:#64748B;margin-top:4px">إدارة الأصناف، الباركود، والأسعار</p></div>
            <button class="mod-btn mod-btn-primary" onclick="prodOpenAdd()">+ إضافة صنف جديد</button>
        </div>

        <div class="mod-grid">
            <div class="mod-card"><div class="mod-card-icon" style="background:#EFF6FF;color:#2563EB">🏷️</div><div class="mod-card-val" id="prodCardTotal">${_prodList.length}</div><div class="mod-card-lbl">إجمالي الأصناف</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#F0FDF4;color:#059669">📦</div><div class="mod-card-val" id="prodCardInStock">${_prodList.filter(p=>p._totalStock>0).length}</div><div class="mod-card-lbl">متوفر بالمخزون</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#FEE2E2;color:#DC2626">🔴</div><div class="mod-card-val" id="prodCardOutStock">${_prodList.filter(p=>p._totalStock<=0).length}</div><div class="mod-card-lbl">نفد المخزون</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#F5F3FF;color:#7C3AED">📁</div><div class="mod-card-val" id="prodCardCats">${_prodCategories.length}</div><div class="mod-card-lbl">مجموعات</div></div>
        </div>

        <div class="mod-card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:16px 0">
            <input type="text" id="prodSearchInput" class="mod-form-input" style="flex:1;min-width:180px;margin:0" placeholder="🔍 بحث بالاسم أو الكود أو الباركود..." oninput="prodOnSearch(this.value)">
            <select id="prodCatFilter" class="mod-form-input" style="width:180px;margin:0" onchange="prodOnFilterCat(this.value)">
                <option value="">كل المجموعات</option>
                ${_prodCategories.map(cat=>`<option value="${cat.id}">${cat.name}</option>`).join('')}
            </select>
            <select id="prodCompanyFilter" class="mod-form-input" style="width:180px;margin:0" onchange="prodOnFilterCompany(this.value)">
                <option value="">كل الشركات</option>
                ${_prodCompanies.map(co=>`<option value="${co.id}">${co.name}</option>`).join('')}
            </select>
            <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="prodOpenCategoryManager()">📁 إدارة المجموعات</button>
            <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="prodOpenCompanyManager()">🏢 إدارة الشركات</button>
            <button class="mod-btn" style="background:#F0FDF4;color:#059669" onclick="prodOpenNewRestockedReport()">🆕 أصناف جديدة/اتشرت تاني</button>
            <button class="mod-btn" style="background:#F0FDF4;color:#059669" onclick="prodHubSwitchTab('import')">📥 استيراد Excel</button>
            <button class="mod-btn" style="background:#EFF6FF;color:#2563EB" onclick="prodExportXls()">📤 تصدير Excel</button>
        </div>

        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>الصنف</th><th>الكود</th><th>المجموعة</th><th>الشركة</th><th>الوحدة</th>
                <th style="text-align:left">سعر الشراء</th>
                ${_prodPriceLevels.length
                    ? _prodPriceLevels.map(lvl => `<th style="text-align:left">${lvl.name}</th>`).join('')
                    : `<th style="text-align:left">سعر البيع الأساسي</th>`}
                <th style="text-align:center">المخزون</th><th></th>
            </tr></thead>
            <tbody id="prodTbody"></tbody></table>
        </div>`;
    prodRenderRows();
}

// سعر مستوى معيّن لصنف معيّن — عمود منفصل لكل مستوى سعر (بدل ما كانوا
// كل الأسعار مكدّسة في عمود واحد). لو الصنف مالوش سعر مسجّل للمستوى ده، بيظهر "—".
function prodLevelPriceCell(p, levelId) {
    const price = (_prodPricesMap[p.id] || {})[levelId];
    return (price != null && Number(price) > 0) ? prodFmt(price) : '<span style="color:#CBD5E1">—</span>';
}

// فلترة الأصناف حسب المجموعة/الشركة/البحث المطبّقين حالياً — دالة واحدة
// مشتركة بين عرض الجدول والتصدير، عشان تصدير الإكسل يطابق اللي ظاهر بالظبط.
function prodGetFilteredRows() {
    let rows = _prodList;
    if (_prodFilterCat) rows = rows.filter(p => p.category_id === _prodFilterCat);
    if (_prodFilterCompany) rows = rows.filter(p => p.company_id === _prodFilterCompany);
    if (_prodSearch) {
        const q = _prodSearch.toLowerCase();
        rows = rows.filter(p => (p.name||'').toLowerCase().includes(q) || (p.code||'').toLowerCase().includes(q) || (p.barcode||'').toLowerCase().includes(q));
    }
    return rows;
}

function prodRenderRows() {
    const tbody = document.getElementById('prodTbody');
    if (!tbody) return;
    const rows = prodGetFilteredRows();
    const totalCols = 8 + (_prodPriceLevels.length ? _prodPriceLevels.length - 1 : 0);
    if (!rows.length) { tbody.innerHTML = `<tr><td colspan="${totalCols}" class="empty-state"><span>🏷️</span>لا توجد أصناف مطابقة</td></tr>`; return; }

    tbody.innerHTML = rows.map(p => {
        const cat = _prodCategories.find(c=>c.id===p.category_id);
        const co = _prodCompanies.find(c=>c.id===p.company_id);
        const stockColor = p._totalStock <= 0 ? '#DC2626' : p._totalStock <= (p.reorder_point||0) ? '#D97706' : '#059669';
        return `<tr>
            <td><strong>${p.name}</strong>${p.barcode?`<div style="font-size:11.5px;color:#94A3B8;direction:ltr;text-align:right">${p.barcode}</div>`:''}</td>
            <td><span style="background:#F1F5F9;padding:2px 8px;border-radius:5px;font-size:11px;font-family:monospace;direction:ltr;display:inline-block">${p.code||'—'}</span></td>
            <td>${cat?.name || '—'}</td>
            <td>${co?.name || '—'}</td>
            <td>${p.unit || p.sale_unit || '—'}</td>
            <td style="text-align:left">${prodFmt(p.purchase_price)}</td>
            ${_prodPriceLevels.length
                ? _prodPriceLevels.map(lvl => `<td style="text-align:left">${prodLevelPriceCell(p, lvl.id)}</td>`).join('')
                : `<td style="text-align:left">${prodFmt(p.wholesale_price || p.retail_price || 0)}</td>`}
            <td style="text-align:center;font-weight:700;color:${stockColor}">${prodFmt(p._totalStock)}</td>
            <td style="display:flex;gap:4px;justify-content:center">
                <button class="cc-edit" onclick="prodOpenEdit('${p.id}')">✏️</button>
                <button class="cc-edit" style="background:#EFF6FF;color:#2563EB" onclick="prodOpenDuplicate('${p.id}')" title="تكرار الصنف">🔁</button>
                <button class="cc-edit" style="background:#FEE2E2;color:#DC2626" onclick="prodToggleActive('${p.id}', ${p.is_active===false})">${p.is_active===false?'↩️':'🗑️'}</button>
            </td>
        </tr>`;
    }).join('');
}

// تحديث كروت الملخص (إجمالي/متوفر/نافد/مجموعات) من الـ state المحلي فقط
// من غير أي fetch جديد — بيتنادى بعد أي تعديل محلي على _prodList/_prodCategories.
function prodUpdateCards() {
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setTxt('prodCardTotal', _prodList.length);
    setTxt('prodCardInStock', _prodList.filter(p=>p._totalStock>0).length);
    setTxt('prodCardOutStock', _prodList.filter(p=>p._totalStock<=0).length);
    setTxt('prodCardCats', _prodCategories.length);
}

// تصدير الأصناف لإكسيل — بيصدّر بس الأصناف الظاهرة حاليًا بعد أي فلتر
// (مجموعة/شركة/بحث) مطبّق، مش كل الأصناف دايمًا — عمود منفصل لكل مستوى سعر.
window.prodExportXls = function() {
    const filtered = prodGetFilteredRows();
    if (!filtered.length) { alert('لا يوجد أصناف للتصدير'); return; }
    const rows = filtered.map(p => {
        const cat = _prodCategories.find(c => c.id === p.category_id);
        const co = _prodCompanies.find(c => c.id === p.company_id);
        const row = {
            'الكود': p.code || '',
            'الصنف': p.name,
            'الباركود': p.barcode || '',
            'المجموعة': cat?.name || '',
            'الشركة': co?.name || '',
            'الوحدة': p.unit || p.sale_unit || '',
            'سعر الشراء': Number(p.purchase_price) || 0,
        };
        if (_prodPriceLevels.length) {
            _prodPriceLevels.forEach(lvl => {
                const price = (_prodPricesMap[p.id] || {})[lvl.id];
                row[lvl.name] = price != null ? Number(price) : '';
            });
        } else {
            row['سعر البيع'] = Number(p.wholesale_price || p.retail_price || 0);
        }
        row['المخزون'] = Number(p._totalStock) || 0;
        return row;
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'الأصناف');
    XLSX.writeFile(wb, `أصناف_${new Date().toISOString().slice(0,10)}.xlsx`);
};

window.prodOnSearch = function(v) { _prodSearch = v; prodRenderRows(); };
window.prodOnFilterCat = function(v) { _prodFilterCat = v; prodRenderRows(); };
window.prodOnFilterCompany = function(v) { _prodFilterCompany = v; prodRenderRows(); };

// ════════════════════════════════════════════════════════════
// 2) إضافة / تعديل صنف
// ════════════════════════════════════════════════════════════
window.prodOpenAdd = function() {
    _prodEditingId = null;
    prodOpenModal(null);
};
window.prodOpenEdit = function(id) {
    const p = _prodList.find(x=>x.id===id);
    if (!p) return;
    _prodEditingId = id;
    prodOpenModal(p);
};
// تكرار صنف: بيفتح فورم "إضافة" (مش تعديل — _prodEditingId فاضل null)
// معبّى مسبقًا من كل بيانات المصدر (الأسعار، المجموعة، الشركة، الوحدات...)
// عدا الكود/الباركود (بيتولّدوا جدد تلقائي زي أي صنف جديد) — المستخدم
// يعدّل بس الاسم بدل ما يدخل كل البيانات من الأول لصنف شبه صنف موجود.
window.prodOpenDuplicate = async function(id) {
    const src = _prodList.find(x=>x.id===id);
    if (!src) return;
    _prodEditingId = null;
    await prodOpenModal(src, { isDuplicate: true });
};

// أعلى كود رقمي مُستخدم حاليًا + 1 — بيتجاهل الأكواد اللي مش أرقام صرفة
// (زي أكواد قديمة بصيغة "P-001") عشان الحساب يفضل صحيح مع بيانات قديمة مختلطة.
function prodNextCode() {
    let max = 0;
    (_prodList || []).forEach(p => {
        const raw = String(p.code || '').trim();
        if (/^\d+$/.test(raw)) { const n = parseInt(raw, 10); if (n > max) max = n; }
    });
    return String(max + 1);
}

async function prodOpenModal(p, opts) {
    const isDuplicate = !!opts?.isDuplicate;
    const isNewCode = !p || isDuplicate; // نفس حالة "إضافة" بالنسبة للكود/الباركود التلقائي
    // لو في تعديل، نجيب الأسعار الحالية لكل المستويات + آخر نسبة مؤجل اتسجلت
    // لهذا الصنف في فواتير الشراء (تقريب لهامش الربح — المؤجل مرتبط بالمورد/
    // الفاتورة مش بالصنف نفسه، فبناخد آخر نسبة مؤجل استُخدمت فعلياً لآخر
    // فاتورة شراء تضمنت الصنف ده، كأفضل تقدير متاح).
    let existingPrices = {};
    _prodModalDeferredRate = 0;
    _prodModalDefaultDeferredType = p?.default_deferred_type || 'percent';
    if (p) {
        const [{ data }, { data: piRows }] = await Promise.all([
            sb.from('product_prices').select('price_level_id, price').eq('product_id', p.id),
            // ملحوظة: من غير limit هنا — id بتاع purchase_items هو UUID عشوائي
            // (مش تسلسلي)، فالترتيب/التحديد عليه ما كانش هيضمن فعلاً آخر
            // فاتورة شراء زمنياً. بنجيب كل السجلات ونرتبها محلياً حسب تاريخ
            // فاتورة الشراء الفعلي (purchases.created_at) عشان النتيجة تبقى صح.
            sb.from('purchase_items')
                .select('deferred_rate, purchases!inner(created_at, status)')
                .eq('product_id', p.id)
                .eq('purchases.status', 'confirmed'),
        ]);
        (data||[]).forEach(r => existingPrices[r.price_level_id] = r.price);
        if (piRows && piRows.length) {
            const sorted = [...piRows].sort((a,b) => new Date(b.purchases?.created_at||0) - new Date(a.purchases?.created_at||0));
            _prodModalDeferredRate = Number(sorted[0].deferred_rate) || 0;
        }
    }

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'prodModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:560px">
            <div class="mod-modal-header"><h3>${isDuplicate ? '🔁 تكرار صنف' : p ? '✏️ تعديل صنف' : '🏷️ إضافة صنف جديد'}</h3>
                <button class="mod-modal-close" onclick="prodCloseModal()">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>اسم الصنف *</label>
                    <input type="text" id="prodName" class="mod-form-input" value="${p?.name||''}" placeholder="مثال: بسكويت تايجر">
                </div>
                <div class="mod-form-group">
                    <label>صورة الصنف <small style="color:#94A3B8;font-weight:400">(بتظهر للعميل في سلطانو)</small></label>
                    <div style="display:flex;align-items:center;gap:10px">
                        <img id="prodImagePreview" src="${p?.images?.[0]||''}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;background:#F1F5F9;${p?.images?.[0]?'':'display:none'}">
                        <input type="file" id="prodImageFile" class="mod-form-input" accept="image/*" style="margin:0" onchange="prodPreviewImage(this)">
                    </div>
                    <div style="display:flex;gap:16px;margin-top:8px;flex-wrap:wrap">
                        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
                            <input type="checkbox" id="prodIsFeatured" ${p?.is_featured?'checked':''} style="width:auto">⭐ عرض مميز في سلطانو
                        </label>
                        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
                            <input type="checkbox" id="prodIsBestseller" ${p?.is_bestseller?'checked':''} style="width:auto">🔥 الأكثر مبيعاً في سلطانو
                        </label>
                        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;color:#DC2626">
                            <input type="checkbox" id="prodHiddenSultano" ${p?.hidden_from_sultano?'checked':''} style="width:auto">🚫 إخفاء عن سلطانو (حتى لو متوفر بالمخزون)
                        </label>
                    </div>
                    <div class="mod-form-group" style="margin-top:8px">
                        <label>الحد الأقصى للطلب في سلطانو <small style="color:#94A3B8;font-weight:400">(سيب فاضي = يستخدم رصيد المخزون كحد أقصى)</small></label>
                        <input type="number" id="prodMaxOrderQty" class="mod-form-input" value="${p?.max_order_qty??''}" min="1" step="1" placeholder="رصيد المخزون">
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>الكود</label>
                        <input type="text" id="prodCode" class="mod-form-input" value="${isNewCode ? prodNextCode() : (p?.code||'')}" placeholder="مثال: P-001" dir="ltr"></div>
                    <div class="mod-form-group"><label>الباركود</label>
                        <input type="text" id="prodBarcode" class="mod-form-input" value="${isNewCode ? prodNextCode() : (p?.barcode||'')}" placeholder="اختياري" dir="ltr"></div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>المجموعة</label>
                        <select id="prodCategory" class="mod-form-input">
                            <option value="">بدون مجموعة</option>
                            ${_prodCategories.map(cat=>`<option value="${cat.id}" ${p?.category_id===cat.id?'selected':''}>${cat.name}</option>`).join('')}
                        </select></div>
                    <div class="mod-form-group"><label>الشركة المصنّعة</label>
                        <select id="prodCompany" class="mod-form-input">
                            <option value="">بدون شركة</option>
                            ${_prodCompanies.map(co=>`<option value="${co.id}" ${p?.company_id===co.id?'selected':''}>${co.name}</option>`).join('')}
                        </select></div>
                </div>
                <div class="mod-form-group"><label>المورّد</label>
                    <select id="prodSupplier" class="mod-form-input">
                        <option value="">بدون مورّد</option>
                        ${_prodSuppliers.map(s=>`<option value="${s.id}" ${p?.supplier_id===s.id?'selected':''}>${s.name}</option>`).join('')}
                    </select>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>وحدة الشراء</label>
                        <input type="text" id="prodPurchaseUnit" class="mod-form-input" value="${p?.purchase_unit||'كرتونة'}"></div>
                    <div class="mod-form-group"><label>وحدة البيع</label>
                        <input type="text" id="prodSaleUnit" class="mod-form-input" value="${p?.sale_unit||p?.unit||'قطعة'}"></div>
                    <div class="mod-form-group"><label>عدد القطع/كرتونة</label>
                        <input type="number" id="prodUnitsPerCarton" class="mod-form-input" value="${p?.units_per_carton||1}" min="1" step="1"></div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>سعر الشراء (ج.م) *</label>
                        <input type="number" id="prodPurchasePrice" class="mod-form-input" value="${p?.purchase_price||0}" min="0" step="0.01" oninput="prodUpdateMargins()"></div>
                    <div class="mod-form-group"><label>حد الطلب (تنبيه نقص)</label>
                        <input type="number" id="prodReorderPoint" class="mod-form-input" value="${p?.reorder_point||0}" min="0" step="1"></div>
                </div>
                <div class="mod-form-group">
                    <label>المؤجل الافتراضي <small style="color:#94A3B8;font-weight:400">(يتسحب تلقائي عند إضافة الصنف لفاتورة شراء جديدة)</small></label>
                    <div style="display:flex;align-items:center;gap:6px">
                        <input type="number" id="prodDefaultDeferredRate" class="mod-form-input" value="${p?.default_deferred_rate||0}"
                            min="0" ${_prodModalDefaultDeferredType==='percent'?'max="100"':''} step="0.1" style="background:#F5F3FF;color:#7C3AED">
                        <button type="button" id="prodDefaultDeferredTypeBtn" class="mod-btn" style="background:#EDE9FE;color:#7C3AED;white-space:nowrap" onclick="prodToggleDefaultDeferredType()">${_prodModalDefaultDeferredType==='percent'?'٪ نسبة':'ثابت/وحدة'}</button>
                    </div>
                </div>
                ${_prodModalDeferredRate > 0 ? `
                <p style="font-size:11px;color:#94A3B8;margin-top:-4px">
                    ℹ️ هامش الربح تحت محسوب بعد خصم مؤجل تقديري ${prodFmt(_prodModalDeferredRate)} ج.م/وحدة
                    (آخر مؤجل مسجّل لهذا الصنف من فواتير الشراء).
                </p>` : ''}

                <div class="mod-form-group" style="margin-top:6px">
                    <label style="font-weight:800;color:#1E293B">💰 مستويات البيع</label>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px">
                        ${_prodPriceLevels.map(lvl => `
                        <div>
                            <label style="font-size:11.5px;color:#64748B">${lvl.name}</label>
                            <input type="number" class="mod-form-input prod-price-lvl" data-level-id="${lvl.id}"
                                value="${existingPrices[lvl.id]||0}" min="0" step="0.01" style="margin:2px 0 0" oninput="prodUpdateMargins()">
                            <div id="prodMarginLvl-${lvl.id}" style="font-size:11px;margin-top:2px;min-height:14px"></div>
                        </div>`).join('')}
                    </div>
                </div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="prodCloseModal()">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="prodSave()">💾 ${(p && !isDuplicate) ? 'حفظ التعديلات' : 'إضافة الصنف'}</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    setTimeout(()=>document.getElementById('prodName')?.focus(), 50);
    prodUpdateMargins();
}

window.prodCloseModal = function() { document.getElementById('prodModal')?.remove(); };

window.prodPreviewImage = function(input) {
    const file = input.files[0];
    const img = document.getElementById('prodImagePreview');
    if (!file || !img) return;
    img.src = URL.createObjectURL(file);
    img.style.display = '';
};

// تبديل نوع المؤجل الافتراضي (٪ / ثابت) — تعديل مباشر للـ DOM بدل إعادة رسم
// المودال كله، عشان مايضيعش أي حقول تانية اتكتبت فعلاً جوه المودال
window.prodToggleDefaultDeferredType = function() {
    _prodModalDefaultDeferredType = _prodModalDefaultDeferredType === 'percent' ? 'fixed' : 'percent';
    const input = document.getElementById('prodDefaultDeferredRate');
    const btn = document.getElementById('prodDefaultDeferredTypeBtn');
    if (input) {
        input.value = '0'; // زي فاتورة المشتريات بالظبط: تبديل النوع بيصفّر الرقم عشان مايتفسّرش غلط
        if (_prodModalDefaultDeferredType === 'percent') input.setAttribute('max', '100');
        else input.removeAttribute('max');
    }
    if (btn) btn.textContent = _prodModalDefaultDeferredType === 'percent' ? '٪ نسبة' : 'ثابت/وحدة';
};

// هامش الربح % تحت كل مستوى سعر = (سعر المستوى - التكلفة الفعلية بعد خصم
// نسبة المؤجل التقديرية) / سعر المستوى × 100. بيتحدّث لحظياً مع أي تعديل
// في سعر الشراء أو أي مستوى سعر جوه المودال (من غير أي fetch جديد).
window.prodUpdateMargins = function() {
    const purchasePrice = parseFloat(document.getElementById('prodPurchasePrice')?.value) || 0;
    // _prodModalDeferredRate بقى دايماً مبلغ فعلي للوحدة (مش نسبة %) — راجع
    // purchases.js purSave: أي % بيتحوّل لمبلغ للوحدة وقت الحفظ عشان يطابق
    // صيغة deferred_rebates.expected_amount = qty*rate في القاعدة.
    const effectiveCost = purchasePrice - (_prodModalDeferredRate||0);
    document.querySelectorAll('.prod-price-lvl').forEach(input => {
        const levelId = input.dataset.levelId;
        const marginEl = document.getElementById('prodMarginLvl-' + levelId);
        if (!marginEl) return;
        const price = parseFloat(input.value) || 0;
        if (price <= 0) { marginEl.textContent = ''; return; }
        const margin = ((price - effectiveCost) / price) * 100;
        marginEl.textContent = `هامش الربح: ${margin.toFixed(1)}%`;
        marginEl.style.color = margin >= 0 ? '#059669' : '#DC2626';
    });
};

window.prodOpenCategoryManager = function() {
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'prodCatModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:560px">
            <div class="mod-modal-header"><h3>📁 إدارة المجموعات</h3>
                <button class="mod-modal-close" onclick="document.getElementById('prodCatModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <div style="display:flex;gap:8px;margin-bottom:14px">
                    <input type="text" id="newCatName" class="mod-form-input" style="margin:0" placeholder="اسم مجموعة جديدة...">
                    <button class="mod-btn mod-btn-primary" style="white-space:nowrap" onclick="prodAddCategory()">+ إضافة</button>
                </div>
                <div id="catList">
                    ${_prodCategories.map(cat=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #F1F5F9;gap:8px">
                        <img src="${cat.image_url||''}" style="width:32px;height:32px;object-fit:cover;border-radius:6px;background:#F1F5F9;${cat.image_url?'':'display:none'}">
                        <span style="flex:1">${cat.name}</span>
                        <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:#64748B;white-space:nowrap;cursor:pointer">
                            <input type="checkbox" style="width:auto" ${cat.show_when_empty?'checked':''} onchange="prodToggleShowWhenEmpty('product_categories','${cat.id}',this.checked)">🔜 لو فاضي
                        </label>
                        <label class="mod-btn" style="padding:4px 10px;font-size:12px;cursor:pointer;margin:0">
                            📷<input type="file" accept="image/*" style="display:none" onchange="prodUploadLookupImage('product_categories','${cat.id}',this)">
                        </label>
                        <button class="cc-edit" style="background:#FFFBEB;color:#D97706;padding:4px 8px" title="تعديل الاسم" onclick="prodEditLookup('product_categories','${cat.id}')">✏️</button>
                        <button class="cc-edit" style="background:#FEE2E2;color:#DC2626;padding:4px 8px" title="حذف" onclick="prodDeleteLookup('product_categories','${cat.id}')">🗑️</button>
                    </div>`).join('') || '<p style="color:#94A3B8;text-align:center;padding:20px">لا توجد مجموعات بعد</p>'}
                </div>
            </div>
        </div>`;
    document.body.appendChild(modal);
};

window.prodAddCategory = async function() {
    const name = document.getElementById('newCatName').value.trim();
    if (!name) return alert('اكتب اسم المجموعة');
    try {
        const { data, error } = await sb.from('product_categories').insert({ name }).select();
        if (error) throw error;
        _prodCategories.push(data[0]);
        _prodCategories.sort((a,b) => (a.name||'').localeCompare(b.name||'', 'ar'));
        document.getElementById('prodCatModal').remove();
        prodRebuildPagePreserveScroll(); // إعادة رسم الصفحة من الـ state المحلي (بدون fetch كامل جديد)، مع الحفاظ على موضع التمرير
    } catch(e) { alert('خطأ: ' + e.message); }
};

// رفع صورة لمجموعة (قسم رئيسي) أو شركة (قسم فرعي في سلطانو) — نفس باكت
// صور الأصناف، مستخدم من مودالي إدارة المجموعات والشركات
window.prodUploadLookupImage = async function(table, id, input) {
    const file = input.files[0];
    if (!file) return;
    try {
        const safeName = file.name.replace(/[^\w.\-]+/g, '_');
        const path = `${table}/${Date.now()}_${safeName}`;
        const { error: upErr } = await sb.storage.from(PROD_IMAGE_BUCKET).upload(path, file);
        if (upErr) throw upErr;
        const { data: pub } = sb.storage.from(PROD_IMAGE_BUCKET).getPublicUrl(path);
        const { error } = await sb.from(table).update({ image_url: pub.publicUrl }).eq('id', id);
        if (error) throw error;
        const list = table === 'product_categories' ? _prodCategories : _prodCompanies;
        const row = list.find(x => x.id === id);
        if (row) row.image_url = pub.publicUrl;
        if (table === 'product_categories') { document.getElementById('prodCatModal')?.remove(); prodOpenCategoryManager(); }
        else { document.getElementById('prodCompModal')?.remove(); prodOpenCompanyManager(); }
    } catch (e) { alert('خطأ في رفع الصورة: ' + e.message); }
};

// لو مفعّلة: القسم/الشركة يفضل ظاهر لعميل سلطانو حتى لو مفيش أي صنف متاح
// فيه دلوقتي (بيشوف رسالة "لا توجد منتجات حالياً" بدل ما يختفي تمامًا)
window.prodToggleShowWhenEmpty = async function(table, id, checked) {
    try {
        const { error } = await sb.from(table).update({ show_when_empty: checked }).eq('id', id);
        if (error) throw error;
        const list = table === 'product_categories' ? _prodCategories : _prodCompanies;
        const row = list.find(x => x.id === id);
        if (row) row.show_when_empty = checked;
    } catch (e) { alert('خطأ: ' + e.message); }
};

// إعادة فتح مودال المجموعة/الشركة بعد تعديل — نفس الحل المستخدم فعلاً
// في prodUploadLookupImage، مركزّاه هنا عشان prodEditLookup/prodDeleteLookup يستخدموه
function prodReopenLookupModal(table) {
    if (table === 'product_categories') { document.getElementById('prodCatModal')?.remove(); prodOpenCategoryManager(); }
    else { document.getElementById('prodCompModal')?.remove(); prodOpenCompanyManager(); }
}

window.prodEditLookup = async function(table, id) {
    const list = table === 'product_categories' ? _prodCategories : _prodCompanies;
    const row = list.find(x => x.id === id);
    if (!row) return;
    const name = prompt('الاسم الجديد:', row.name);
    if (name == null) return; // المستخدم دوس إلغاء
    const trimmed = name.trim();
    if (!trimmed || trimmed === row.name) return;
    try {
        const { error } = await sb.from(table).update({ name: trimmed }).eq('id', id);
        if (error) throw error;
        row.name = trimmed;
        list.sort((a,b) => (a.name||'').localeCompare(b.name||'', 'ar'));
        prodReopenLookupModal(table);
        prodRebuildPagePreserveScroll();
    } catch (e) {
        if (e.code === '23505') alert('❌ فيه واحدة بنفس الاسم ده بالظبط بالفعل — اختار اسم تاني.');
        else alert('خطأ: ' + e.message);
    }
};

window.prodDeleteLookup = async function(table, id) {
    const list = table === 'product_categories' ? _prodCategories : _prodCompanies;
    const row = list.find(x => x.id === id);
    if (!row) return;
    const label = table === 'product_categories' ? 'المجموعة' : 'الشركة';
    if (!confirm(`تأكيد حذف ${label} "${row.name}"؟`)) return;
    try {
        const { error } = await sb.from(table).delete().eq('id', id);
        if (error) throw error;
        const idx = list.findIndex(x => x.id === id);
        if (idx > -1) list.splice(idx, 1);
        prodReopenLookupModal(table);
        prodRebuildPagePreserveScroll();
    } catch (e) {
        // فشل الحذف الأرجح لوجود أصناف مرتبطة (foreign key constraint) —
        // رسالة أوضح للمستخدم من خطأ Postgres الخام
        alert(`❌ مينفعش تحذف "${row.name}" — فيه أصناف مرتبطة بيها. لازم تنقلهم لـ${label==='المجموعة'?'مجموعة':'شركة'} تانية الأول.`);
    }
};

// إعادة رسم صفحة الأصناف كاملة من الـ state المحلي الحالي (من غير أي fetch
// جديد لـ Supabase) مع حفظ موضع التمرير قبلها وإرجاعه بعدها — مستخدمة في
// الحالات اللي محتاجة إعادة بناء الصفحة كلها (مثلاً تحديث قوائم المجموعات/
// الشركات المنسدلة) بدل renderProducts() اللي بتعمل fetch كامل من الصفر.
function prodRebuildPagePreserveScroll() {
    const c = document.getElementById('app-content');
    if (!c) return;
    const scrollTop = c.scrollTop;
    prodRenderPage(c);
    c.scrollTop = scrollTop;
}

window.prodOpenCompanyManager = function() {
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'prodCompModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:560px">
            <div class="mod-modal-header"><h3>🏢 إدارة الشركات</h3>
                <button class="mod-modal-close" onclick="document.getElementById('prodCompModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <div style="display:flex;gap:8px;margin-bottom:14px">
                    <input type="text" id="newCompName" class="mod-form-input" style="margin:0" placeholder="اسم شركة جديدة...">
                    <button class="mod-btn mod-btn-primary" style="white-space:nowrap" onclick="prodAddCompany()">+ إضافة</button>
                </div>
                <div id="compList">
                    ${_prodCompanies.map(co=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #F1F5F9;gap:8px">
                        <img src="${co.image_url||''}" style="width:32px;height:32px;object-fit:cover;border-radius:6px;background:#F1F5F9;${co.image_url?'':'display:none'}">
                        <span style="flex:1">${co.name}</span>
                        <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:#64748B;white-space:nowrap;cursor:pointer">
                            <input type="checkbox" style="width:auto" ${co.show_when_empty?'checked':''} onchange="prodToggleShowWhenEmpty('product_companies','${co.id}',this.checked)">🔜 لو فاضي
                        </label>
                        <label class="mod-btn" style="padding:4px 10px;font-size:12px;cursor:pointer;margin:0">
                            📷<input type="file" accept="image/*" style="display:none" onchange="prodUploadLookupImage('product_companies','${co.id}',this)">
                        </label>
                        <button class="cc-edit" style="background:#FFFBEB;color:#D97706;padding:4px 8px" title="تعديل الاسم" onclick="prodEditLookup('product_companies','${co.id}')">✏️</button>
                        <button class="cc-edit" style="background:#FEE2E2;color:#DC2626;padding:4px 8px" title="حذف" onclick="prodDeleteLookup('product_companies','${co.id}')">🗑️</button>
                    </div>`).join('') || '<p style="color:#94A3B8;text-align:center;padding:20px">لا توجد شركات بعد</p>'}
                </div>
            </div>
        </div>`;
    document.body.appendChild(modal);
};

window.prodAddCompany = async function() {
    const name = document.getElementById('newCompName').value.trim();
    if (!name) return alert('اكتب اسم الشركة');
    try {
        const { data, error } = await sb.from('product_companies').insert({ name }).select();
        if (error) throw error;
        _prodCompanies.push(data[0]);
        _prodCompanies.sort((a,b) => (a.name||'').localeCompare(b.name||'', 'ar'));
        document.getElementById('prodCompModal').remove();
        prodRebuildPagePreserveScroll(); // إعادة رسم الصفحة من الـ state المحلي (بدون fetch كامل جديد)، مع الحفاظ على موضع التمرير
    } catch(e) { alert('خطأ: ' + e.message); }
};

// ════════════════════════════════════════════════════════════
// تقرير: أصناف جديدة + أصناف نفدت واتُشترت تاني (آخر 7 أيام)
// ════════════════════════════════════════════════════════════
// ملحوظة على تعريف "نفدت واتُشترت تاني": مفيش عندنا جدول سجل حركة مخزون
// تاريخي (stock ledger) نقدر نسأله "كان الرصيد كام قبل تاريخ معيّن"، فبنقدّرها:
// المخزون الحالي ناقص كمية آخر شراء خلال الفترة = المخزون التقديري قبل
// الشراء ده. لو النتيجة صفر أو أقل، معناه الصنف كان نافد فعلاً قبل ما يتشترى.
// تقدير معقول وليس دقيق 100% (ممكن يتأثر بمرتجعات/تحويلات حصلت في نفس الفترة).
window.prodOpenNewRestockedReport = async function() {
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'prodNewRestockModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:640px">
            <div class="mod-modal-header"><h3>🆕 أصناف جديدة / اتشرت تاني</h3>
                <button class="mod-modal-close" onclick="document.getElementById('prodNewRestockModal').remove()">&times;</button></div>
            <div class="mod-modal-body"><div class="empty-state"><span>⏳</span>جاري التحميل...</div></div>
        </div>`;
    document.body.appendChild(modal);
    const body = modal.querySelector('.mod-modal-body');
    try {
        const days = 7;
        const cutoff = new Date(Date.now() - days * 86400000).toISOString();
        const { data: recentPurchases, error } = await sb.from('purchase_items')
            .select('product_id, qty, units_per_carton_snapshot, purchases!inner(created_at, status)')
            .eq('purchases.status', 'confirmed')
            .gte('purchases.created_at', cutoff);
        if (error) throw error;

        // إجمالي كمية الشراء (بالوحدة الصغرى) لكل صنف خلال الفترة
        const recentPurchaseQty = {};
        (recentPurchases || []).forEach(pi => {
            const smallest = (Number(pi.qty) || 0) * (Number(pi.units_per_carton_snapshot) || 1);
            recentPurchaseQty[pi.product_id] = (recentPurchaseQty[pi.product_id] || 0) + smallest;
        });

        const newProducts = _prodList.filter(p => p.created_at && new Date(p.created_at) >= new Date(cutoff));
        const newIds = new Set(newProducts.map(p => p.id));
        const restocked = _prodList.filter(p => {
            if (!recentPurchaseQty[p.id] || newIds.has(p.id)) return false;
            const stockBeforePurchase = (p._totalStock || 0) - recentPurchaseQty[p.id];
            return stockBeforePurchase <= 0;
        });

        const rowsHtml = (list, extraCol) => list.map(p => `<tr>
            <td>${p.name}</td>
            <td><span style="background:#F1F5F9;padding:2px 8px;border-radius:5px;font-size:11px;font-family:monospace;direction:ltr;display:inline-block">${p.code || '—'}</span></td>
            <td style="text-align:left">${extraCol(p)}</td>
        </tr>`).join('');

        body.innerHTML = `
            <p style="font-size:12px;color:#94A3B8;margin-bottom:14px">بيانات آخر ${days} أيام</p>
            <h4 style="margin:0 0 8px;font-size:14px">🆕 أصناف جديدة (${newProducts.length})</h4>
            ${newProducts.length ? `<div class="mod-table-wrap" style="margin-bottom:20px"><table class="mod-table"><thead><tr>
                <th>الصنف</th><th>الكود</th><th style="text-align:left">تاريخ الإضافة</th>
            </tr></thead><tbody>${rowsHtml(newProducts, p => new Date(p.created_at).toLocaleDateString('ar-EG'))}</tbody></table></div>`
                : '<p class="dash-empty" style="margin-bottom:20px">مفيش أصناف جديدة فى الفترة دي</p>'}

            <h4 style="margin:0 0 8px;font-size:14px">🔄 أصناف نفدت واتُشترت تاني (${restocked.length})</h4>
            ${restocked.length ? `<div class="mod-table-wrap"><table class="mod-table"><thead><tr>
                <th>الصنف</th><th>الكود</th><th style="text-align:left">المخزون الحالي</th>
            </tr></thead><tbody>${rowsHtml(restocked, p => prodFmt(p._totalStock))}</tbody></table></div>`
                : '<p class="dash-empty">مفيش أصناف نفدت واتُشترت تاني فى الفترة دي</p>'}`;
    } catch (err) {
        body.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:16px;border-radius:10px">خطأ: ${err.message}</div>`;
    }
};

// INSERT/UPDATE واحد لصف الصنف في products، بيرجّع { data, productId }
async function prodSaveProductRow(payload, editingId) {
    if (editingId) {
        const { data, error } = await sb.from('products').update(payload).eq('id', editingId).select();
        if (error) throw error;
        return { data: data[0], productId: editingId };
    }
    const { data, error } = await sb.from('products').insert(payload).select();
    if (error) throw error;
    return { data: data[0], productId: data[0].id };
}

// ════════════════════════════════════════════════════════════
// 3) الحفظ — UPSERT في products + product_prices
// ════════════════════════════════════════════════════════════
window.prodSave = async function() {
    const name = document.getElementById('prodName').value.trim();
    const code = document.getElementById('prodCode').value.trim();
    const barcode = document.getElementById('prodBarcode').value.trim();
    const category_id = document.getElementById('prodCategory').value || null;
    const company_id = document.getElementById('prodCompany').value || null;
    const supplier_id = document.getElementById('prodSupplier').value || null;
    const purchase_unit = document.getElementById('prodPurchaseUnit').value.trim() || 'كرتونة';
    const sale_unit = document.getElementById('prodSaleUnit').value.trim() || 'قطعة';
    const units_per_carton = parseFloat(document.getElementById('prodUnitsPerCarton').value) || 1;
    const purchase_price = parseFloat(document.getElementById('prodPurchasePrice').value) || 0;
    const reorder_point = parseFloat(document.getElementById('prodReorderPoint').value) || 0;
    const default_deferred_rate = parseFloat(document.getElementById('prodDefaultDeferredRate')?.value) || 0;
    const default_deferred_type = _prodModalDefaultDeferredType;

    if (!name) return alert('اسم الصنف مطلوب');
    if (purchase_price <= 0) return alert('سعر الشراء يجب أن يكون أكبر من صفر');

    // منع تكرار الاسم/الكود — مقارنة محلية (تطابق تام، بعد trim ومن غير حساسية
    // لحالة الأحرف) قبل الحفظ، عشان رسالة واضحة بدل خطأ قاعدة بيانات خام.
    // الكود له UNIQUE constraint فعلي في قاعدة البيانات (products_code_key)،
    // لكن الفحص هنا بيمسك المشكلة الأول ويوضّح السبب بالعربي.
    const dupName = _prodList.find(x => x.id !== _prodEditingId && (x.name||'').trim().toLowerCase() === name.toLowerCase());
    if (dupName) return alert(`⚠️ فيه صنف تاني بنفس الاسم بالظبط: "${dupName.name}"\nلو الصنف مشابه بس مختلف (نكهة/حجم مختلف مثلاً)، عدّل الاسم شوية عشان يتميّز.`);
    if (code) {
        const dupCode = _prodList.find(x => x.id !== _prodEditingId && (x.code||'').trim().toLowerCase() === code.toLowerCase());
        if (dupCode) return alert(`⚠️ الكود "${code}" مستخدم بالفعل للصنف: "${dupCode.name}"`);
    }

    const btn = document.querySelector('#prodModal .mod-btn-primary');
    btn.innerText = '⏳ جاري الحفظ...'; btn.disabled = true;

    try {
        // نجمع أسعار المستويات من الفورم أولاً عشان نضم مزامنة wholesale_price/
        // retail_price في نفس نداء INSERT/UPDATE الرئيسي بدل نداءات UPDATE منفصلة.
        const levelPrices = [...document.querySelectorAll('.prod-price-lvl')].map(input => ({
            levelId: input.dataset.levelId,
            price: parseFloat(input.value) || 0,
        }));

        const payload = {
            name, code: code || null, barcode: barcode || null,
            category_id, company_id, supplier_id, purchase_unit, sale_unit, unit: sale_unit,
            units_per_carton, purchase_price, reorder_point,
            default_deferred_rate, default_deferred_type,
            is_featured: document.getElementById('prodIsFeatured')?.checked || false,
            is_bestseller: document.getElementById('prodIsBestseller')?.checked || false,
            hidden_from_sultano: document.getElementById('prodHiddenSultano')?.checked || false,
            max_order_qty: document.getElementById('prodMaxOrderQty')?.value ? parseFloat(document.getElementById('prodMaxOrderQty').value) : null,
        };

        // رفع صورة الصنف (لو المستخدم اختار ملف جديد) — لو مفيش ملف جديد،
        // مفيش مفتاح images في الـ payload خالص فتفضل الصورة القديمة زي ما هي
        const imageFile = document.getElementById('prodImageFile')?.files?.[0];
        if (imageFile) {
            const safeName = imageFile.name.replace(/[^\w.\-]+/g, '_');
            const path = `${Date.now()}_${safeName}`;
            const { error: upErr } = await sb.storage.from(PROD_IMAGE_BUCKET).upload(path, imageFile);
            if (upErr) throw upErr;
            const { data: pub } = sb.storage.from(PROD_IMAGE_BUCKET).getPublicUrl(path);
            payload.images = [pub.publicUrl];
        }
        // مزامنة wholesale_price/retail_price (أعمدة WorkFlow Hub القديمة) من أول مستويين — للتوافق مع sales.js
        if (_prodPriceLevels[0]) payload.wholesale_price = levelPrices.find(lp=>lp.levelId===_prodPriceLevels[0].id)?.price || 0;
        if (_prodPriceLevels[1]) payload.retail_price = levelPrices.find(lp=>lp.levelId===_prodPriceLevels[1].id)?.price || 0;

        let productId = _prodEditingId;
        let savedRow;
        try {
            const r = await prodSaveProductRow(payload, _prodEditingId);
            savedRow = r.data; productId = r.productId;
        } catch (err) {
            // ★ لو عمود supplier_id لسه مش موجود في قاعدة البيانات الحية (الـ
            //   migration في products_supplier_migration.sql لسه ما اتشغلش
            //   يدوياً في Supabase)، بنعيد المحاولة من غيره بدل ما نمنع حفظ
            //   الصنف بالكامل. باقي بيانات الصنف بتتحفظ عادي.
            if (payload.supplier_id !== undefined && /supplier_id/i.test(err.message||'')) {
                const { supplier_id, ...payloadNoSupplier } = payload;
                const r = await prodSaveProductRow(payloadNoSupplier, _prodEditingId);
                savedRow = r.data; productId = r.productId;
                console.warn('⚠️ عمود products.supplier_id غير موجود بعد — شغّل products_supplier_migration.sql. تم حفظ باقي بيانات الصنف بدون المورّد.');
            } else if (/default_deferred_(rate|type)/i.test(err.message||'')) {
                // products_default_deferred_migration.sql لسه ما اتشغلش — نحفظ باقي
                // بيانات الصنف بدون المؤجل الافتراضي بدل ما نمنع الحفظ بالكامل.
                const { default_deferred_rate, default_deferred_type, ...payloadNoDeferred } = payload;
                const r = await prodSaveProductRow(payloadNoDeferred, _prodEditingId);
                savedRow = r.data; productId = r.productId;
                console.warn('⚠️ أعمدة المؤجل الافتراضي غير موجودة بعد — شغّل products_default_deferred_migration.sql.');
            } else {
                throw err;
            }
        }

        // حفظ مستويات الأسعار (UPSERT لكل مستوى) — بالتوازي بدل التوالي
        await Promise.all(levelPrices.map(lp => sb.from('product_prices').upsert({
            product_id: productId, price_level_id: lp.levelId, price: lp.price
        }, { onConflict: 'product_id,price_level_id' })));

        // ★ تحديث الـ state المحلي (_prodList/_prodPricesMap) بدل إعادة تحميل
        //   القايمة كلها من الصفر — بيحافظ على مكان المستخدم (تمرير/بحث/فلتر)
        //   وبيبقى فوري بدل ما ينتظر fetch كامل تاني لكل الأصناف/المخزون/الأسعار.
        if (_prodEditingId) {
            const idx = _prodList.findIndex(x => x.id === _prodEditingId);
            if (idx > -1) _prodList[idx] = { ..._prodList[idx], ...savedRow };
        } else {
            _prodList.push({ ...savedRow, _totalStock: 0 });
            _prodList.sort((a,b) => (a.name||'').localeCompare(b.name||'', 'ar'));
        }
        _prodPricesMap[productId] = _prodPricesMap[productId] || {};
        levelPrices.forEach(lp => { _prodPricesMap[productId][lp.levelId] = lp.price; });

        prodCloseModal();
        prodRenderRows();   // إعادة رسم صفوف الجدول من الـ state المحلي فقط (من غير fetch جديد ومن غير ما نفقد موضع التمرير)
        prodUpdateCards();
    } catch (err) {
        // احتياطي: لو الفحص المحلي اتفوّت لأي سبب (زي تصادم حفظين فى نفس اللحظة)
        // وقاعدة البيانات رفضت بسبب products_code_key، نوضّح السبب بالعربي.
        const msg = /products_code_key/i.test(err.message||'') ? 'الكود ده مستخدم بالفعل لصنف تاني' : err.message;
        alert('❌ خطأ أثناء الحفظ: ' + msg);
        btn.innerText = '💾 حفظ'; btn.disabled = false;
    }
};

window.prodToggleActive = async function(id, activate) {
    const msg = activate ? 'إعادة تفعيل هذا الصنف؟' : 'إخفاء هذا الصنف من القوائم؟ (لن يُحذف نهائياً)';
    if (!confirm(msg)) return;
    try {
        const { error } = await sb.from('products').update({ is_active: activate }).eq('id', id);
        if (error) throw error;
        // تحديث محلي بدل fetch كامل من جديد — نفس منطق prodSave
        const p = _prodList.find(x => x.id === id);
        if (p) p.is_active = activate;
        prodRenderRows();
        prodUpdateCards();
    } catch(e) { alert('خطأ: ' + e.message); }
};

Object.assign(window, { renderProducts, prodOnSearch, prodOnFilterCat, prodOnFilterCompany, prodOpenAdd, prodOpenEdit, prodOpenDuplicate, prodCloseModal, prodSave, prodToggleActive, prodOpenCategoryManager, prodAddCategory, prodOpenCompanyManager, prodAddCompany, prodOpenNewRestockedReport });
