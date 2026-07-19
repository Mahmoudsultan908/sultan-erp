/* ════════════════════════════════════════════════════════════
   إرجاع مخزون عربية مندوب للمخزن — van_stock_returns / van_stock_return_items
   يصدّر: renderVanStockReturn(container)

   ★ عكس van-stock-load.js بالظبط: هنا المصدر هو عربية المندوب
   (van_stock) والهدف هو مخزن حقيقي. نفس الفلسفة: الواجهة بتعمل
   INSERT فقط والـ trigger فى القاعدة (fn_van_stock_return_item_apply)
   هو اللي بيحرّك van_stock (نقص) وinventory_stock (زيادة) — لا قيد
   محاسبي ولا حركة خزنة، نقل فيزيائي بحت من عربية المندوب لمخزن حقيقي.
   ════════════════════════════════════════════════════════════ */

let VR_DB = { warehouses: [], products: [], reps: [], stockMap: {}, list: [] };
let vrItems = [];
let vrWarehouseId = null;
let vrRepId = null;
let _vrMultiSelected = {}; // {productId: qty} أثناء فتح مودال الاختيار المتعدد

function vrFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function vrToday() { return new Date().toISOString().split('T')[0]; }

async function renderVanStockReturn(container) {
    container.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات المخازن والمندوبين...</div>';
    try {
        const [{ data: warehouses }, { data: products }, { data: stock }, { data: reps }] = await Promise.all([
            sb.from('warehouses').select('*').order('name'),
            sb.from('products').select('id,name,code,unit').eq('is_active', true).order('name'),
            sb.from('van_stock').select('rep_id,product_id,qty'),
            sb.from('sales_reps').select('id,name').eq('is_active', true).order('name'),
        ]);
        VR_DB.warehouses = warehouses || [];
        VR_DB.products = products || [];
        VR_DB.reps = reps || [];
        VR_DB.stockMap = {};
        (stock || []).forEach(r => { VR_DB.stockMap[r.rep_id + '|' + r.product_id] = Number(r.qty) || 0; });

        const mainWh = VR_DB.warehouses.find(w => w.is_main) || VR_DB.warehouses[0];
        vrWarehouseId = mainWh?.id || null;
        vrRepId = VR_DB.reps[0]?.id || null;
        vrItems = [{ id: Date.now() + Math.random(), productId: null, qty: 1 }];

        await vrLoadRecent();
        vrRenderScreen(container);
    } catch (err) {
        container.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

async function vrLoadRecent() {
    try {
        const { data, error } = await sb.from('van_stock_returns')
            .select('*, wh:warehouse_id(name), rep:rep_id(name), van_stock_return_items(qty)')
            .order('created_at', { ascending: false }).limit(30);
        if (error) throw error;
        VR_DB.list = data || [];
    } catch (e) {
        VR_DB.list = [];
    }
}

// المنتجات اللي المندوب الحالي عنده رصيد فيها فعليًا بالعربية (فايدة: منع محاولة إرجاع صنف مش موجود أصلاً)
function vrRepProducts() {
    if (!vrRepId) return [];
    return VR_DB.products.filter(p => (VR_DB.stockMap[vrRepId + '|' + p.id] || 0) > 0);
}

function vrRenderScreen(c) {
    if (!VR_DB.reps.length) {
        c.innerHTML = `<div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:16px;border-radius:12px">
            ⚠️ لا يوجد مندوبون نشطون بعد.
        </div>`;
        return;
    }
    c.innerHTML = `
    <div class="inv-root density-cozy">
        ${vrHeaderHTML()}
        <div class="inv-main">
            <div class="inv-table-col">
                ${vrSearchBarHTML()}
                <div class="inv-table-scroll">
                    <table class="inv-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th class="text-r">الصنف</th>
                                <th style="width:70px">وحدة</th>
                                <th style="width:110px">الرصيد بعربية المندوب</th>
                                <th style="width:110px">الكمية المرتجعة</th>
                                <th style="width:40px"></th>
                            </tr>
                        </thead>
                        <tbody id="vrItemsBody"></tbody>
                    </table>
                </div>
                ${vrBottomBarHTML()}
            </div>
            <div class="inv-side">
                ${vrInfoCardHTML()}
                ${vrActionsCardHTML()}
                ${vrNotesCardHTML()}
            </div>
        </div>
    </div>
    ${vrRecentListHTML()}
    `;
    vrRenderItems();
    vrUpdateSummary();
}

function vrHeaderHTML() {
    return `
    <div class="inv-header">
        <div class="inv-header-brand">
            <div class="ic">↩️</div>
            <div class="ttl">إرجاع مخزون عربية للمخزن<small> نقل فيزيائي من عربية المندوب للمخزن — بدون تأثير مالي</small></div>
        </div>

        <input type="date" class="inv-date-input" id="vrDate" value="${vrToday()}" title="تاريخ الإرجاع">

        <select class="inv-date-input" id="vrRep" title="من عربية المندوب" onchange="vrOnFilterChange()" style="cursor:pointer">
            ${VR_DB.reps.map(r => `<option value="${r.id}" ${r.id === vrRepId ? 'selected' : ''}>🚗 من: ${r.name}</option>`).join('')}
        </select>
        <select class="inv-date-input" id="vrWarehouse" title="إلى مخزن" onchange="vrOnFilterChange()" style="cursor:pointer">
            ${VR_DB.warehouses.map(w => `<option value="${w.id}" ${w.id === vrWarehouseId ? 'selected' : ''}>📥 إلى: ${w.name}${w.is_main ? ' (رئيسي)' : ''}</option>`).join('') || '<option value="">لا يوجد مخزن</option>'}
        </select>

        <div class="inv-header-spacer"></div>
        <button class="inv-top-btn inv-top-save" onclick="vrSave()">💾 حفظ الإرجاع</button>
        <button class="inv-top-btn inv-top-new" onclick="renderVanStockReturn(document.getElementById('app-content'))">➕ جديد</button>
    </div>`;
}

function vrSearchBarHTML() {
    return `
    <div class="inv-searchbar">
        <div style="flex:1;color:#CBD5E1;font-size:12.5px">القائمة بتعرض بس الأصناف اللي فعلاً موجودة بعربية المندوب المختار.</div>
        <button class="inv-add-row-btn" onclick="vrOpenMultiPick()">☑️ اختيار أصناف متعددة</button>
        <button class="inv-add-row-btn" onclick="vrAddRow()">+ سطر يدوي</button>
    </div>`;
}

// ════════════════════════════════════════════════════════════
// اختيار أصناف متعددة (بحث + تحديد) — نفس نمط vlOpenMultiPick فى van-stock-load.js
// ════════════════════════════════════════════════════════════
function vrOpenMultiPick() {
    if (!vrRepId) { alert('اختر المندوب أولاً'); return; }
    document.getElementById('vrMultiModal')?.remove();
    const m = document.createElement('div');
    m.id = 'vrMultiModal';
    m.className = 'mod-modal-bg active';
    m.innerHTML = `
    <div class="mod-modal" style="max-width:640px">
        <div class="mod-modal-header"><h3>☑️ اختيار أصناف متعددة</h3>
            <button class="mod-modal-close" onclick="vrCloseMultiPick()">✕</button></div>
        <div class="mod-modal-body">
            <input type="text" class="mod-form-input" id="vrMultiSearch" placeholder="بحث بالاسم / الكود..." autocomplete="off" oninput="vrRenderMultiPickList(this.value)">
            <div id="vrMultiPickList" style="margin-top:12px;display:flex;flex-direction:column;gap:6px"></div>
        </div>
        <div class="mod-modal-footer">
            <button class="inv-btn inv-btn-print" onclick="vrCloseMultiPick()">إلغاء</button>
            <button class="inv-btn inv-btn-save" onclick="vrAddMultiPicked()">➕ إضافة المحدد</button>
        </div>
    </div>`;
    document.body.appendChild(m);
    _vrMultiSelected = {};
    vrRenderMultiPickList('');
    setTimeout(() => document.getElementById('vrMultiSearch')?.focus(), 50);
}
function vrCloseMultiPick() {
    document.getElementById('vrMultiModal')?.remove();
    _vrMultiSelected = {};
}
function vrRenderMultiPickList(val) {
    const box = document.getElementById('vrMultiPickList');
    if (!box) return;
    const v = (val || '').trim();
    const base = vrRepProducts();
    const list = v ? base.filter(p => (p.name || '').includes(v) || (p.code || '').includes(v)) : base;
    if (!list.length) { box.innerHTML = '<div style="padding:20px;text-align:center;color:#94A3B8">لا توجد أصناف بعربية هذا المندوب</div>'; return; }
    box.innerHTML = list.slice(0, 200).map(p => {
        const sel = _vrMultiSelected[p.id];
        const checked = sel != null;
        const qty = sel ?? 1;
        const stock = vrGetStock(p.id);
        return `<label class="inv-multi-row" data-pid="${p.id}" style="display:flex;align-items:center;gap:10px;padding:7px 10px;border:1.5px solid #E2E8F0;border-radius:10px;cursor:pointer">
            <input type="checkbox" ${checked ? 'checked' : ''} onchange="vrMultiToggle('${p.id}',this.checked)">
            <span style="flex:1">${p.name} <small style="color:#94A3B8">${p.code || ''} · ${p.unit || ''}</small></span>
            <span style="font-size:11px;color:#94A3B8">بالعربية: ${vrFmt(stock)}</span>
            <input type="number" class="mod-form-input" value="${qty}" min="0.001" step="0.001" style="width:76px;padding:6px 8px"
                onclick="event.stopPropagation()" oninput="vrMultiSetQty('${p.id}',this.value)">
        </label>`;
    }).join('');
}
function vrMultiToggle(pid, checked) {
    if (checked) { if (_vrMultiSelected[pid] == null) _vrMultiSelected[pid] = 1; }
    else delete _vrMultiSelected[pid];
}
function vrMultiSetQty(pid, val) {
    const q = parseFloat(val) || 0;
    if (q <= 0) return;
    _vrMultiSelected[pid] = q;
    const cb = document.querySelector(`.inv-multi-row[data-pid="${pid}"] input[type=checkbox]`);
    if (cb && !cb.checked) cb.checked = true;
}
function vrAddMultiPicked() {
    const ids = Object.keys(_vrMultiSelected);
    if (!ids.length) { alert('لم يتم اختيار أي صنف'); return; }
    let added = 0;
    ids.forEach(pid => {
        const p = VR_DB.products.find(x => x.id === pid);
        if (!p) return;
        const qty = _vrMultiSelected[pid] || 1;
        const ex = vrItems.findIndex(i => i.productId === pid);
        if (ex >= 0) {
            vrItems[ex].qty = (vrItems[ex].qty || 0) + qty;
        } else {
            const empty = vrItems.find(i => !i.productId);
            if (empty) { empty.productId = pid; empty.qty = qty; }
            else vrItems.push({ id: Date.now() + added, productId: pid, qty });
        }
        added++;
    });
    vrRenderItems();
    vrUpdateSummary();
    vrCloseMultiPick();
}

function vrBottomBarHTML() {
    return `
    <div class="inv-bottombar">
        <span class="bb-stat">الأصناف: <strong id="vrItemCount">0</strong></span>
        <span class="bb-stat">إجمالي الكمية المرتجعة: <strong id="vrUnitCount">0</strong></span>
    </div>`;
}

function vrInfoCardHTML() {
    return `
    <div class="inv-card">
        <div class="inv-card-title">↩️ ملخص الإرجاع</div>
        <div class="inv-sum-row"><span class="lbl">عدد الأصناف</span><span class="val" id="vrSummaryItems">0</span></div>
        <div class="inv-sum-row"><span class="lbl">إجمالي الكمية</span><span class="val" id="vrSummaryQty">0.00</span></div>
        <div class="inv-sum-divider"></div>
        <div style="font-size:11.5px;color:var(--inv-muted)">إرجاع مخزون العربية لا يخصم أو يزيد من رصيد الخزنة ولا يضيف قيوداً محاسبية — هو نقل فيزيائي من عربية المندوب للمخزن فقط.</div>
    </div>`;
}

function vrActionsCardHTML() {
    return `
    <div class="inv-actions">
        <button class="inv-btn inv-btn-save" onclick="vrSave()">💾 حفظ الإرجاع</button>
    </div>`;
}

function vrNotesCardHTML() {
    return `
    <div class="inv-card">
        <div class="inv-card-title">📝 ملاحظات</div>
        <textarea class="inv-notes" id="vrNotes" rows="3" placeholder="اختياري"></textarea>
    </div>`;
}

function vrRecentListHTML() {
    const list = VR_DB.list || [];
    return `
    <div class="mod-table-wrap" style="margin-top:16px">
        <div style="padding:14px 18px 0;font-weight:800;font-size:14px;color:#1E293B">📋 آخر عمليات الإرجاع</div>
        <table class="mod-table"><thead><tr>
            <th>رقم العملية</th><th>التاريخ</th><th>عربية المندوب</th><th>إلى مخزن</th><th>عدد الأصناف</th><th style="text-align:left">إجمالي الكمية</th><th>ملاحظات</th>
        </tr></thead>
        <tbody>
            ${list.length ? list.map(t => {
                const items = t.van_stock_return_items || [];
                const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
                return `<tr>
                    <td><span style="background:#F1F5F9;padding:3px 8px;border-radius:5px;font-size:11px;font-family:monospace">${t.return_no || '—'}</span></td>
                    <td>${t.return_date ? new Date(t.return_date).toLocaleDateString('ar-EG') : '—'}</td>
                    <td>🚗 ${t.rep?.name || '—'}</td>
                    <td>${t.wh?.name || '—'}</td>
                    <td>${items.length}</td>
                    <td style="text-align:left;font-weight:700">${vrFmt(totalQty)}</td>
                    <td style="color:#64748B">${t.notes || '—'}</td>
                </tr>`;
            }).join('') : `<tr><td colspan="7" class="empty-state"><span>↩️</span>لا توجد عمليات إرجاع حتى الآن.</td></tr>`}
        </tbody></table>
    </div>`;
}

function vrGetStock(pid) {
    if (!vrRepId || !pid) return 0;
    return VR_DB.stockMap[vrRepId + '|' + pid] || 0;
}

function vrOnFilterChange() {
    const repSel = document.getElementById('vrRep');
    const whSel = document.getElementById('vrWarehouse');
    if (repSel) vrRepId = repSel.value;
    if (whSel) vrWarehouseId = whSel.value;
    // تغيير المندوب بيغيّر قائمة الأصناف المتاحة للإرجاع، فبنصفر السطور القديمة
    vrItems = [{ id: Date.now() + Math.random(), productId: null, qty: 1 }];
    vrRenderItems();
    vrUpdateSummary();
}

function vrRenderItems() {
    const tbody = document.getElementById('vrItemsBody');
    if (!tbody) return;

    if (!vrItems.length) {
        tbody.innerHTML = `<tr class="inv-empty-row"><td colspan="6">
            <span class="em-ic">↩️</span>
            أضف صنفاً واحداً على الأقل لإرجاعه للمخزن، أو اضغط "+ إضافة صنف"
        </td></tr>`;
        return;
    }

    const repProducts = vrRepProducts();
    tbody.innerHTML = vrItems.map((it, idx) => {
        const stock = vrGetStock(it.productId);
        const low = !!it.productId && (it.qty || 0) > stock;
        const p = VR_DB.products.find(x => x.id === it.productId);
        return `<tr class="${low ? 'is-low' : ''}">
            <td class="inv-cell-idx">${idx + 1}</td>
            <td>
                <select class="inv-cell-input is-name" id="vrProduct-${idx}" onchange="vrOnProductChange(${idx}, this.value)">
                    <option value="">-- اختر الصنف --</option>
                    ${repProducts.map(pr => `<option value="${pr.id}" ${pr.id === it.productId ? 'selected' : ''}>${pr.name}</option>`).join('')}
                </select>
            </td>
            <td style="text-align:center;font-size:12px;color:var(--inv-muted)">${p?.unit || '—'}</td>
            <td class="inv-cell-stock">
                <span class="num ${low ? 'low' : ''}">${it.productId ? vrFmt(stock) : '—'}</span>
                ${low ? '<div class="low-lbl">تجاوز الرصيد</div>' : ''}
            </td>
            <td>
                <input type="number" class="inv-cell-input is-num" id="vrQty-${idx}" value="${it.qty || ''}" min="0" step="0.01"
                    oninput="vrOnQtyInput(${idx}, this.value)">
            </td>
            <td class="inv-cell-del"><button class="inv-del-btn" onclick="vrRemoveRow(${idx})">✕</button></td>
        </tr>`;
    }).join('');
}

function vrUpdateRowStockIndicator(idx) {
    const it = vrItems[idx];
    if (!it) return;
    const row = document.getElementById('vrQty-' + idx)?.closest('tr');
    if (!row) return;
    const stock = vrGetStock(it.productId);
    const low = !!it.productId && (it.qty || 0) > stock;
    row.classList.toggle('is-low', low);
    const stockCell = row.querySelector('.inv-cell-stock');
    if (stockCell) {
        stockCell.innerHTML = `<span class="num ${low ? 'low' : ''}">${it.productId ? vrFmt(stock) : '—'}</span>${low ? '<div class="low-lbl">تجاوز الرصيد</div>' : ''}`;
    }
}

function vrAddRow() {
    vrItems.push({ id: Date.now() + Math.random(), productId: null, qty: 1 });
    vrRenderItems();
    vrUpdateSummary();
    setTimeout(() => document.getElementById('vrProduct-' + (vrItems.length - 1))?.focus(), 40);
}

function vrRemoveRow(idx) {
    vrItems.splice(idx, 1);
    vrRenderItems();
    vrUpdateSummary();
}

function vrOnProductChange(idx, val) {
    const it = vrItems[idx];
    if (!it) return;
    it.productId = val || null;
    vrRenderItems();
    vrUpdateSummary();
}

function vrOnQtyInput(idx, val) {
    const it = vrItems[idx];
    if (!it) return;
    it.qty = parseFloat(val) || 0;
    vrUpdateRowStockIndicator(idx);
    vrUpdateSummary();
}

function vrUpdateSummary() {
    const filled = vrItems.filter(it => it.productId && (it.qty || 0) > 0);
    const totalQty = filled.reduce((s, it) => s + (it.qty || 0), 0);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('vrItemCount', filled.length);
    set('vrUnitCount', vrFmt(totalQty));
    set('vrSummaryItems', filled.length);
    set('vrSummaryQty', vrFmt(totalQty));
}

window.vrSave = async function () {
    const repId = vrRepId;
    const whId = vrWarehouseId;
    if (!repId) return alert('يرجى اختيار المندوب');
    if (!whId) return alert('يرجى اختيار المخزن');

    const filled = vrItems.filter(it => it.productId && (it.qty || 0) > 0);
    if (!filled.length) return alert('أضف صنفاً واحداً على الأقل بكمية أكبر من صفر');

    const qtyByProduct = {};
    filled.forEach(it => { qtyByProduct[it.productId] = (qtyByProduct[it.productId] || 0) + it.qty; });
    for (const pid in qtyByProduct) {
        const stock = vrGetStock(pid);
        if (qtyByProduct[pid] > stock) {
            const name = VR_DB.products.find(p => p.id === pid)?.name || pid;
            return alert(`الكمية المطلوب إرجاعها من صنف "${name}" (${vrFmt(qtyByProduct[pid])}) أكبر من المتاح بعربية المندوب (${vrFmt(stock)})`);
        }
    }

    const date = document.getElementById('vrDate')?.value || vrToday();
    const notes = document.getElementById('vrNotes')?.value.trim() || null;

    const saveBtns = document.querySelectorAll('.inv-btn-save, .inv-top-save');
    saveBtns.forEach(b => { b.dataset._label = b.dataset._label || b.innerHTML; b.innerHTML = '⏳ جاري الإرجاع...'; b.disabled = true; });

    try {
        const returnNo = 'VR-' + Date.now();
        const { data: rows, error } = await sb.from('van_stock_returns').insert({
            return_no: returnNo,
            warehouse_id: whId,
            rep_id: repId,
            return_date: date,
            notes,
            created_by: currentUser?.id || null,
        }).select();
        if (error) throw error;
        const returnId = rows[0].id;

        const itemRows = filled.map(it => ({
            return_id: returnId,
            product_id: it.productId,
            qty: it.qty,
            unit_name: VR_DB.products.find(p => p.id === it.productId)?.unit || null,
        }));
        const { error: itemsErr } = await sb.from('van_stock_return_items').insert(itemRows);
        if (itemsErr) {
            await sb.from('van_stock_returns').delete().eq('id', returnId);
            throw itemsErr;
        }

        alert(`تم إرجاع مخزون العربية للمخزن بنجاح (${returnNo})`);
        renderVanStockReturn(document.getElementById('app-content'));
    } catch (err) {
        alert('خطأ أثناء الإرجاع: ' + err.message);
        saveBtns.forEach(b => { b.innerHTML = b.dataset._label; b.disabled = false; });
    }
};

Object.assign(window, {
    renderVanStockReturn,
    vrAddRow, vrRemoveRow, vrOnProductChange, vrOnQtyInput, vrOnFilterChange, vrSave,
    vrOpenMultiPick, vrCloseMultiPick, vrRenderMultiPickList, vrMultiToggle, vrMultiSetQty, vrAddMultiPicked,
});
