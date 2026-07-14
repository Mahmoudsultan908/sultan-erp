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
let _prodSearch = '';
let _prodFilterCat = '';
let _prodEditingId = null;

function prodFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// ════════════════════════════════════════════════════════════
// 1) التحميل والعرض الرئيسي
// ════════════════════════════════════════════════════════════
async function renderProducts(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل الأصناف...</div>';
    try {
        const [{ data: products }, { data: categories }, { data: companies }, { data: levels }, { data: stock }, { data: allPrices }] = await Promise.all([
            sb.from('products').select('*').order('name'),
            sb.from('product_categories').select('*').order('name'),
            sb.from('product_companies').select('*').order('name'),
            sb.from('price_levels').select('*').order('sort_order'),
            sb.from('inventory_stock').select('product_id, qty'),
            // ★ كل أسعار كل المستويات لكل الأصناف مرة واحدة — عشان تظهر
            //   الأسعار الباقية (مش سعر البيع الأساسي بس) في قائمة الأصناف
            //   نفسها، بدل ما يحتاج المستخدم يفتح تعديل كل صنف لوحده.
            sb.from('product_prices').select('product_id, price_level_id, price'),
        ]);
        _prodList = products || [];
        _prodCategories = categories || [];
        _prodCompanies = companies || [];
        _prodPriceLevels = levels || [];

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
            <div class="mod-card"><div class="mod-card-icon" style="background:#EFF6FF;color:#2563EB">🏷️</div><div class="mod-card-val">${_prodList.length}</div><div class="mod-card-lbl">إجمالي الأصناف</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#F0FDF4;color:#059669">📦</div><div class="mod-card-val">${_prodList.filter(p=>p._totalStock>0).length}</div><div class="mod-card-lbl">متوفر بالمخزون</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#FEE2E2;color:#DC2626">🔴</div><div class="mod-card-val">${_prodList.filter(p=>p._totalStock<=0).length}</div><div class="mod-card-lbl">نفد المخزون</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#F5F3FF;color:#7C3AED">📁</div><div class="mod-card-val">${_prodCategories.length}</div><div class="mod-card-lbl">مجموعات</div></div>
        </div>

        <div class="mod-card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:16px 0">
            <input type="text" id="prodSearchInput" class="mod-form-input" style="flex:1;min-width:180px;margin:0" placeholder="🔍 بحث بالاسم أو الكود أو الباركود..." oninput="prodOnSearch(this.value)">
            <select id="prodCatFilter" class="mod-form-input" style="width:180px;margin:0" onchange="prodOnFilterCat(this.value)">
                <option value="">كل المجموعات</option>
                ${_prodCategories.map(cat=>`<option value="${cat.id}">${cat.name}</option>`).join('')}
            </select>
            <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="prodOpenCategoryManager()">📁 إدارة المجموعات</button>
            <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="prodOpenCompanyManager()">🏢 إدارة الشركات</button>
            <button class="mod-btn" style="background:#F0FDF4;color:#059669" onclick="loadMod(document.querySelector('[data-mod=&quot;product-import&quot;]'), 'product-import')">📥 استيراد Excel</button>
            <button class="mod-btn" style="background:#EFF6FF;color:#2563EB" onclick="prodExportXls()">📤 تصدير Excel</button>
        </div>

        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>الصنف</th><th>الكود</th><th>المجموعة</th><th>الوحدة</th>
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

function prodRenderRows() {
    const tbody = document.getElementById('prodTbody');
    if (!tbody) return;
    let rows = _prodList;
    if (_prodFilterCat) rows = rows.filter(p => p.category_id === _prodFilterCat);
    if (_prodSearch) {
        const q = _prodSearch.toLowerCase();
        rows = rows.filter(p => (p.name||'').toLowerCase().includes(q) || (p.code||'').toLowerCase().includes(q) || (p.barcode||'').toLowerCase().includes(q));
    }
    const totalCols = 7 + (_prodPriceLevels.length ? _prodPriceLevels.length - 1 : 0);
    if (!rows.length) { tbody.innerHTML = `<tr><td colspan="${totalCols}" class="empty-state"><span>🏷️</span>لا توجد أصناف مطابقة</td></tr>`; return; }

    tbody.innerHTML = rows.map(p => {
        const cat = _prodCategories.find(c=>c.id===p.category_id);
        const stockColor = p._totalStock <= 0 ? '#DC2626' : p._totalStock <= (p.reorder_point||0) ? '#D97706' : '#059669';
        return `<tr>
            <td><strong>${p.name}</strong>${p.barcode?`<div style="font-size:11.5px;color:#94A3B8;direction:ltr;text-align:right">${p.barcode}</div>`:''}</td>
            <td><span style="background:#F1F5F9;padding:2px 8px;border-radius:5px;font-size:11px;font-family:monospace;direction:ltr;display:inline-block">${p.code||'—'}</span></td>
            <td>${cat?.name || '—'}</td>
            <td>${p.unit || p.sale_unit || '—'}</td>
            <td style="text-align:left">${prodFmt(p.purchase_price)}</td>
            ${_prodPriceLevels.length
                ? _prodPriceLevels.map(lvl => `<td style="text-align:left">${prodLevelPriceCell(p, lvl.id)}</td>`).join('')
                : `<td style="text-align:left">${prodFmt(p.wholesale_price || p.retail_price || 0)}</td>`}
            <td style="text-align:center;font-weight:700;color:${stockColor}">${prodFmt(p._totalStock)}</td>
            <td style="display:flex;gap:4px;justify-content:center">
                <button class="cc-edit" onclick="prodOpenEdit('${p.id}')">✏️</button>
                <button class="cc-edit" style="background:#FEE2E2;color:#DC2626" onclick="prodToggleActive('${p.id}', ${p.is_active===false})">${p.is_active===false?'↩️':'🗑️'}</button>
            </td>
        </tr>`;
    }).join('');
}

// تصدير كل الأصناف لإكسيل — عمود منفصل لكل مستوى سعر (نفس تنظيم الجدول)
window.prodExportXls = function() {
    if (!_prodList.length) { alert('لا يوجد أصناف للتصدير'); return; }
    const rows = _prodList.map(p => {
        const cat = _prodCategories.find(c => c.id === p.category_id);
        const row = {
            'الكود': p.code || '',
            'الصنف': p.name,
            'الباركود': p.barcode || '',
            'المجموعة': cat?.name || '',
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

async function prodOpenModal(p) {
    // لو في تعديل، نجيب الأسعار الحالية لكل المستويات
    let existingPrices = {};
    if (p) {
        const { data } = await sb.from('product_prices').select('price_level_id, price').eq('product_id', p.id);
        (data||[]).forEach(r => existingPrices[r.price_level_id] = r.price);
    }

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'prodModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:560px">
            <div class="mod-modal-header"><h3>${p?'✏️ تعديل صنف':'🏷️ إضافة صنف جديد'}</h3>
                <button class="mod-modal-close" onclick="prodCloseModal()">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>اسم الصنف *</label>
                    <input type="text" id="prodName" class="mod-form-input" value="${p?.name||''}" placeholder="مثال: بسكويت تايجر">
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>الكود</label>
                        <input type="text" id="prodCode" class="mod-form-input" value="${p?.code||''}" placeholder="مثال: P-001" dir="ltr"></div>
                    <div class="mod-form-group"><label>الباركود</label>
                        <input type="text" id="prodBarcode" class="mod-form-input" value="${p?.barcode||''}" placeholder="اختياري" dir="ltr"></div>
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
                        <input type="number" id="prodPurchasePrice" class="mod-form-input" value="${p?.purchase_price||0}" min="0" step="0.01"></div>
                    <div class="mod-form-group"><label>حد الطلب (تنبيه نقص)</label>
                        <input type="number" id="prodReorderPoint" class="mod-form-input" value="${p?.reorder_point||0}" min="0" step="1"></div>
                </div>

                <div class="mod-form-group" style="margin-top:6px">
                    <label style="font-weight:800;color:#1E293B">💰 مستويات البيع</label>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px">
                        ${_prodPriceLevels.map(lvl => `
                        <div>
                            <label style="font-size:11.5px;color:#64748B">${lvl.name}</label>
                            <input type="number" class="mod-form-input prod-price-lvl" data-level-id="${lvl.id}"
                                value="${existingPrices[lvl.id]||0}" min="0" step="0.01" style="margin:2px 0 0">
                        </div>`).join('')}
                    </div>
                </div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="prodCloseModal()">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="prodSave()">💾 ${p?'حفظ التعديلات':'إضافة الصنف'}</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    setTimeout(()=>document.getElementById('prodName')?.focus(), 50);
}

window.prodCloseModal = function() { document.getElementById('prodModal')?.remove(); };

window.prodOpenCategoryManager = function() {
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'prodCatModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:420px">
            <div class="mod-modal-header"><h3>📁 إدارة المجموعات</h3>
                <button class="mod-modal-close" onclick="document.getElementById('prodCatModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <div style="display:flex;gap:8px;margin-bottom:14px">
                    <input type="text" id="newCatName" class="mod-form-input" style="margin:0" placeholder="اسم مجموعة جديدة...">
                    <button class="mod-btn mod-btn-primary" style="white-space:nowrap" onclick="prodAddCategory()">+ إضافة</button>
                </div>
                <div id="catList">
                    ${_prodCategories.map(cat=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #F1F5F9">
                        <span>${cat.name}</span>
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
        const { error } = await sb.from('product_categories').insert({ name });
        if (error) throw error;
        document.getElementById('prodCatModal').remove();
        renderProducts(document.getElementById('app-content'));
    } catch(e) { alert('خطأ: ' + e.message); }
};

window.prodOpenCompanyManager = function() {
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'prodCompModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:420px">
            <div class="mod-modal-header"><h3>🏢 إدارة الشركات</h3>
                <button class="mod-modal-close" onclick="document.getElementById('prodCompModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <div style="display:flex;gap:8px;margin-bottom:14px">
                    <input type="text" id="newCompName" class="mod-form-input" style="margin:0" placeholder="اسم شركة جديدة...">
                    <button class="mod-btn mod-btn-primary" style="white-space:nowrap" onclick="prodAddCompany()">+ إضافة</button>
                </div>
                <div id="compList">
                    ${_prodCompanies.map(co=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #F1F5F9">
                        <span>${co.name}</span>
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
        const { error } = await sb.from('product_companies').insert({ name });
        if (error) throw error;
        document.getElementById('prodCompModal').remove();
        renderProducts(document.getElementById('app-content'));
    } catch(e) { alert('خطأ: ' + e.message); }
};

// ════════════════════════════════════════════════════════════
// 3) الحفظ — UPSERT في products + product_prices
// ════════════════════════════════════════════════════════════
window.prodSave = async function() {
    const name = document.getElementById('prodName').value.trim();
    const code = document.getElementById('prodCode').value.trim();
    const barcode = document.getElementById('prodBarcode').value.trim();
    const category_id = document.getElementById('prodCategory').value || null;
    const company_id = document.getElementById('prodCompany').value || null;
    const purchase_unit = document.getElementById('prodPurchaseUnit').value.trim() || 'كرتونة';
    const sale_unit = document.getElementById('prodSaleUnit').value.trim() || 'قطعة';
    const units_per_carton = parseFloat(document.getElementById('prodUnitsPerCarton').value) || 1;
    const purchase_price = parseFloat(document.getElementById('prodPurchasePrice').value) || 0;
    const reorder_point = parseFloat(document.getElementById('prodReorderPoint').value) || 0;

    if (!name) return alert('اسم الصنف مطلوب');
    if (purchase_price <= 0) return alert('سعر الشراء يجب أن يكون أكبر من صفر');

    const btn = document.querySelector('#prodModal .mod-btn-primary');
    btn.innerText = '⏳ جاري الحفظ...'; btn.disabled = true;

    try {
        const payload = {
            name, code: code || null, barcode: barcode || null,
            category_id, company_id, purchase_unit, sale_unit, unit: sale_unit,
            units_per_carton, purchase_price, reorder_point,
        };

        let productId = _prodEditingId;
        if (_prodEditingId) {
            const { error } = await sb.from('products').update(payload).eq('id', _prodEditingId);
            if (error) throw error;
        } else {
            const { data, error } = await sb.from('products').insert(payload).select();
            if (error) throw error;
            productId = data[0].id;
        }

        // حفظ مستويات الأسعار (UPSERT لكل مستوى)
        const priceInputs = document.querySelectorAll('.prod-price-lvl');
        for (const input of priceInputs) {
            const levelId = input.dataset.levelId;
            const price = parseFloat(input.value) || 0;
            await sb.from('product_prices').upsert({
                product_id: productId, price_level_id: levelId, price
            }, { onConflict: 'product_id,price_level_id' });
        }

        // مزامنة wholesale_price/retail_price (أعمدة WorkFlow Hub القديمة) من أول مستويين — للتوافق مع sales.js
        if (_prodPriceLevels[0]) {
            const wPrice = parseFloat(document.querySelector(`.prod-price-lvl[data-level-id="${_prodPriceLevels[0].id}"]`)?.value) || 0;
            await sb.from('products').update({ wholesale_price: wPrice }).eq('id', productId);
        }
        if (_prodPriceLevels[1]) {
            const rPrice = parseFloat(document.querySelector(`.prod-price-lvl[data-level-id="${_prodPriceLevels[1].id}"]`)?.value) || 0;
            await sb.from('products').update({ retail_price: rPrice }).eq('id', productId);
        }

        prodCloseModal();
        renderProducts(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ أثناء الحفظ: ' + err.message);
        btn.innerText = '💾 حفظ'; btn.disabled = false;
    }
};

window.prodToggleActive = async function(id, activate) {
    const msg = activate ? 'إعادة تفعيل هذا الصنف؟' : 'إخفاء هذا الصنف من القوائم؟ (لن يُحذف نهائياً)';
    if (!confirm(msg)) return;
    try {
        const { error } = await sb.from('products').update({ is_active: activate }).eq('id', id);
        if (error) throw error;
        renderProducts(document.getElementById('app-content'));
    } catch(e) { alert('خطأ: ' + e.message); }
};

Object.assign(window, { renderProducts, prodOnSearch, prodOnFilterCat, prodOpenAdd, prodOpenEdit, prodCloseModal, prodSave, prodToggleActive, prodOpenCategoryManager, prodAddCategory, prodOpenCompanyManager, prodAddCompany });
