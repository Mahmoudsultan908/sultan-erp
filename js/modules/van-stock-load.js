/* ════════════════════════════════════════════════════════════
   تحميل عربية مندوب — van_stock_loads / van_stock_load_items
   يصدّر: renderVanStockLoad(container)

   ★ نفس فلسفة stock-transfer.js بالظبط (رأس + بنود متعددة الأصناف،
   الواجهة بتعمل INSERT فقط والـ trigger فى القاعدة (fn_van_stock_load_item_apply)
   هو اللي بيحرّك inventory_stock (نقص) وvan_stock (زيادة) — لا قيد محاسبي
   ولا حركة خزنة، نقل فيزيائي بحت من مخزن حقيقي لعربية مندوب.

   شرط أساسي قبل ربط مبيعات المندوبين الحقيقية بسلطان: لازم يكون عند
   المندوب مخزون عربية حقيقي قبل ما يقدر يبيع منه فاتورة حقيقية.
   ════════════════════════════════════════════════════════════ */

let VL_DB = { warehouses: [], products: [], reps: [], stockMap: {}, list: [] };
let vlItems = [];
let vlWarehouseId = null;
let vlRepId = null;

function vlFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function vlToday() { return new Date().toISOString().split('T')[0]; }

async function renderVanStockLoad(container) {
    container.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات المخازن والمندوبين...</div>';
    try {
        const [{ data: warehouses }, { data: products }, { data: stock }, { data: reps }] = await Promise.all([
            sb.from('warehouses').select('*').order('name'),
            sb.from('products').select('id,name,code,unit').eq('is_active', true).order('name'),
            sb.from('inventory_stock').select('warehouse_id,product_id,qty'),
            sb.from('sales_reps').select('id,name').eq('is_active', true).order('name'),
        ]);
        VL_DB.warehouses = warehouses || [];
        VL_DB.products = products || [];
        VL_DB.reps = reps || [];
        VL_DB.stockMap = {};
        (stock || []).forEach(r => { VL_DB.stockMap[r.warehouse_id + '|' + r.product_id] = Number(r.qty) || 0; });

        const mainWh = VL_DB.warehouses.find(w => w.is_main) || VL_DB.warehouses[0];
        vlWarehouseId = mainWh?.id || null;
        vlRepId = VL_DB.reps[0]?.id || null;
        vlItems = [{ id: Date.now() + Math.random(), productId: null, qty: 1 }];

        await vlLoadRecent();
        vlRenderScreen(container);
    } catch (err) {
        container.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

async function vlLoadRecent() {
    try {
        const { data, error } = await sb.from('van_stock_loads')
            .select('*, wh:warehouse_id(name), rep:rep_id(name), van_stock_load_items(qty)')
            .order('created_at', { ascending: false }).limit(30);
        if (error) throw error;
        VL_DB.list = data || [];
    } catch (e) {
        VL_DB.list = [];
    }
}

function vlRenderScreen(c) {
    if (!VL_DB.reps.length) {
        c.innerHTML = `<div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:16px;border-radius:12px">
            ⚠️ لا يوجد مندوبون نشطون بعد. أضف مندوباً أولاً من صفحة "🚗 المندوبون" (ولازم يكون له حساب دخول من صفحة "👥 المستخدمون" بدور "مندوب مبيعات").
        </div>`;
        return;
    }
    c.innerHTML = `
    <div class="inv-root density-cozy">
        ${vlHeaderHTML()}
        <div class="inv-main">
            <div class="inv-table-col">
                ${vlSearchBarHTML()}
                <div class="inv-table-scroll">
                    <table class="inv-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th class="text-r">الصنف</th>
                                <th style="width:70px">وحدة</th>
                                <th style="width:110px">الرصيد بالمخزن</th>
                                <th style="width:110px">الكمية المحمّلة</th>
                                <th style="width:40px"></th>
                            </tr>
                        </thead>
                        <tbody id="vlItemsBody"></tbody>
                    </table>
                </div>
                ${vlBottomBarHTML()}
            </div>
            <div class="inv-side">
                ${vlInfoCardHTML()}
                ${vlActionsCardHTML()}
                ${vlNotesCardHTML()}
            </div>
        </div>
    </div>
    ${vlRecentListHTML()}
    `;
    vlRenderItems();
    vlUpdateSummary();
}

function vlHeaderHTML() {
    return `
    <div class="inv-header">
        <div class="inv-header-brand">
            <div class="ic">🚗</div>
            <div class="ttl">تحميل عربية مندوب<small> نقل فيزيائي من المخزن لعربية المندوب — بدون تأثير مالي</small></div>
        </div>

        <input type="date" class="inv-date-input" id="vlDate" value="${vlToday()}" title="تاريخ التحميل">

        <select class="inv-date-input" id="vlWarehouse" title="من مخزن" onchange="vlOnFilterChange()" style="cursor:pointer">
            ${VL_DB.warehouses.map(w => `<option value="${w.id}" ${w.id === vlWarehouseId ? 'selected' : ''}>📤 من: ${w.name}${w.is_main ? ' (رئيسي)' : ''}</option>`).join('') || '<option value="">لا يوجد مخزن</option>'}
        </select>
        <select class="inv-date-input" id="vlRep" title="عربية المندوب" onchange="vlOnFilterChange()" style="cursor:pointer">
            ${VL_DB.reps.map(r => `<option value="${r.id}" ${r.id === vlRepId ? 'selected' : ''}>🚗 عربية: ${r.name}</option>`).join('')}
        </select>

        <div class="inv-header-spacer"></div>
        <button class="inv-top-btn inv-top-save" onclick="vlSave()">💾 حفظ التحميل</button>
        <button class="inv-top-btn inv-top-new" onclick="renderVanStockLoad(document.getElementById('app-content'))">➕ جديد</button>
    </div>`;
}

function vlSearchBarHTML() {
    return `
    <div class="inv-searchbar">
        <div style="flex:1;color:#CBD5E1;font-size:12.5px">أضف سطراً لكل صنف تحمّله في عربية المندوب، وحدّد الكمية.</div>
        <button class="inv-add-row-btn" onclick="vlAddRow()">+ إضافة صنف</button>
    </div>`;
}

function vlBottomBarHTML() {
    return `
    <div class="inv-bottombar">
        <span class="bb-stat">الأصناف: <strong id="vlItemCount">0</strong></span>
        <span class="bb-stat">إجمالي الكمية المحمّلة: <strong id="vlUnitCount">0</strong></span>
    </div>`;
}

function vlInfoCardHTML() {
    return `
    <div class="inv-card">
        <div class="inv-card-title">🚗 ملخص التحميل</div>
        <div class="inv-sum-row"><span class="lbl">عدد الأصناف</span><span class="val" id="vlSummaryItems">0</span></div>
        <div class="inv-sum-row"><span class="lbl">إجمالي الكمية</span><span class="val" id="vlSummaryQty">0.00</span></div>
        <div class="inv-sum-divider"></div>
        <div style="font-size:11.5px;color:var(--inv-muted)">تحميل عربية المندوب لا يخصم أو يزيد من رصيد الخزنة ولا يضيف قيوداً محاسبية — هو نقل فيزيائي من المخزن لعربية المندوب فقط. مبيعات المندوب من عربيته بتخصم من هنا تلقائياً.</div>
    </div>`;
}

function vlActionsCardHTML() {
    return `
    <div class="inv-actions">
        <button class="inv-btn inv-btn-save" onclick="vlSave()">💾 حفظ التحميل</button>
    </div>`;
}

function vlNotesCardHTML() {
    return `
    <div class="inv-card">
        <div class="inv-card-title">📝 ملاحظات</div>
        <textarea class="inv-notes" id="vlNotes" rows="3" placeholder="اختياري"></textarea>
    </div>`;
}

function vlRecentListHTML() {
    const list = VL_DB.list || [];
    return `
    <div class="mod-table-wrap" style="margin-top:16px">
        <div style="padding:14px 18px 0;font-weight:800;font-size:14px;color:#1E293B">📋 آخر التحميلات</div>
        <table class="mod-table"><thead><tr>
            <th>رقم التحميل</th><th>التاريخ</th><th>من مخزن</th><th>عربية المندوب</th><th>عدد الأصناف</th><th style="text-align:left">إجمالي الكمية</th><th>ملاحظات</th>
        </tr></thead>
        <tbody>
            ${list.length ? list.map(t => {
                const items = t.van_stock_load_items || [];
                const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
                return `<tr>
                    <td><span style="background:#F1F5F9;padding:3px 8px;border-radius:5px;font-size:11px;font-family:monospace">${t.load_no || '—'}</span></td>
                    <td>${t.load_date ? new Date(t.load_date).toLocaleDateString('ar-EG') : '—'}</td>
                    <td>${t.wh?.name || '—'}</td>
                    <td>🚗 ${t.rep?.name || '—'}</td>
                    <td>${items.length}</td>
                    <td style="text-align:left;font-weight:700">${vlFmt(totalQty)}</td>
                    <td style="color:#64748B">${t.notes || '—'}</td>
                </tr>`;
            }).join('') : `<tr><td colspan="7" class="empty-state"><span>🚗</span>لا توجد تحميلات حتى الآن.</td></tr>`}
        </tbody></table>
    </div>`;
}

function vlGetStock(pid) {
    if (!vlWarehouseId || !pid) return 0;
    return VL_DB.stockMap[vlWarehouseId + '|' + pid] || 0;
}

function vlOnFilterChange() {
    const whSel = document.getElementById('vlWarehouse');
    const repSel = document.getElementById('vlRep');
    if (whSel) vlWarehouseId = whSel.value;
    if (repSel) vlRepId = repSel.value;
    vlRenderItems();
}

function vlRenderItems() {
    const tbody = document.getElementById('vlItemsBody');
    if (!tbody) return;

    if (!vlItems.length) {
        tbody.innerHTML = `<tr class="inv-empty-row"><td colspan="6">
            <span class="em-ic">🚗</span>
            أضف صنفاً واحداً على الأقل لتحميله في عربية المندوب، أو اضغط "+ إضافة صنف"
        </td></tr>`;
        return;
    }

    tbody.innerHTML = vlItems.map((it, idx) => {
        const stock = vlGetStock(it.productId);
        const low = !!it.productId && (it.qty || 0) > stock;
        const p = VL_DB.products.find(x => x.id === it.productId);
        return `<tr class="${low ? 'is-low' : ''}">
            <td class="inv-cell-idx">${idx + 1}</td>
            <td>
                <select class="inv-cell-input is-name" id="vlProduct-${idx}" onchange="vlOnProductChange(${idx}, this.value)">
                    <option value="">-- اختر الصنف --</option>
                    ${VL_DB.products.map(pr => `<option value="${pr.id}" ${pr.id === it.productId ? 'selected' : ''}>${pr.name}</option>`).join('')}
                </select>
            </td>
            <td style="text-align:center;font-size:12px;color:var(--inv-muted)">${p?.unit || '—'}</td>
            <td class="inv-cell-stock">
                <span class="num ${low ? 'low' : ''}">${it.productId ? vlFmt(stock) : '—'}</span>
                ${low ? '<div class="low-lbl">تجاوز الرصيد</div>' : ''}
            </td>
            <td>
                <input type="number" class="inv-cell-input is-num" id="vlQty-${idx}" value="${it.qty || ''}" min="0" step="0.01"
                    oninput="vlOnQtyInput(${idx}, this.value)">
            </td>
            <td class="inv-cell-del"><button class="inv-del-btn" onclick="vlRemoveRow(${idx})">✕</button></td>
        </tr>`;
    }).join('');
}

function vlUpdateRowStockIndicator(idx) {
    const it = vlItems[idx];
    if (!it) return;
    const row = document.getElementById('vlQty-' + idx)?.closest('tr');
    if (!row) return;
    const stock = vlGetStock(it.productId);
    const low = !!it.productId && (it.qty || 0) > stock;
    row.classList.toggle('is-low', low);
    const stockCell = row.querySelector('.inv-cell-stock');
    if (stockCell) {
        stockCell.innerHTML = `<span class="num ${low ? 'low' : ''}">${it.productId ? vlFmt(stock) : '—'}</span>${low ? '<div class="low-lbl">تجاوز الرصيد</div>' : ''}`;
    }
}

function vlAddRow() {
    vlItems.push({ id: Date.now() + Math.random(), productId: null, qty: 1 });
    vlRenderItems();
    vlUpdateSummary();
    setTimeout(() => document.getElementById('vlProduct-' + (vlItems.length - 1))?.focus(), 40);
}

function vlRemoveRow(idx) {
    vlItems.splice(idx, 1);
    vlRenderItems();
    vlUpdateSummary();
}

function vlOnProductChange(idx, val) {
    const it = vlItems[idx];
    if (!it) return;
    it.productId = val || null;
    vlRenderItems();
    vlUpdateSummary();
}

function vlOnQtyInput(idx, val) {
    const it = vlItems[idx];
    if (!it) return;
    it.qty = parseFloat(val) || 0;
    vlUpdateRowStockIndicator(idx);
    vlUpdateSummary();
}

function vlUpdateSummary() {
    const filled = vlItems.filter(it => it.productId && (it.qty || 0) > 0);
    const totalQty = filled.reduce((s, it) => s + (it.qty || 0), 0);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('vlItemCount', filled.length);
    set('vlUnitCount', vlFmt(totalQty));
    set('vlSummaryItems', filled.length);
    set('vlSummaryQty', vlFmt(totalQty));
}

window.vlSave = async function () {
    const whId = vlWarehouseId;
    const repId = vlRepId;
    if (!whId) return alert('يرجى اختيار المخزن');
    if (!repId) return alert('يرجى اختيار المندوب');

    const filled = vlItems.filter(it => it.productId && (it.qty || 0) > 0);
    if (!filled.length) return alert('أضف صنفاً واحداً على الأقل بكمية أكبر من صفر');

    const qtyByProduct = {};
    filled.forEach(it => { qtyByProduct[it.productId] = (qtyByProduct[it.productId] || 0) + it.qty; });
    for (const pid in qtyByProduct) {
        const stock = vlGetStock(pid);
        if (qtyByProduct[pid] > stock) {
            const name = VL_DB.products.find(p => p.id === pid)?.name || pid;
            return alert(`الكمية المطلوب تحميلها من صنف "${name}" (${vlFmt(qtyByProduct[pid])}) أكبر من المتاح في المخزن (${vlFmt(stock)})`);
        }
    }

    const date = document.getElementById('vlDate')?.value || vlToday();
    const notes = document.getElementById('vlNotes')?.value.trim() || null;

    const saveBtns = document.querySelectorAll('.inv-btn-save, .inv-top-save');
    saveBtns.forEach(b => { b.dataset._label = b.dataset._label || b.innerHTML; b.innerHTML = '⏳ جاري التحميل...'; b.disabled = true; });

    try {
        const loadNo = 'VL-' + Date.now();
        const { data: rows, error } = await sb.from('van_stock_loads').insert({
            load_no: loadNo,
            warehouse_id: whId,
            rep_id: repId,
            load_date: date,
            notes,
            created_by: currentUser?.id || null,
        }).select();
        if (error) throw error;
        const loadId = rows[0].id;

        const itemRows = filled.map(it => ({
            load_id: loadId,
            product_id: it.productId,
            qty: it.qty,
            unit_name: VL_DB.products.find(p => p.id === it.productId)?.unit || null,
        }));
        const { error: itemsErr } = await sb.from('van_stock_load_items').insert(itemRows);
        if (itemsErr) {
            await sb.from('van_stock_loads').delete().eq('id', loadId);
            throw itemsErr;
        }

        alert(`تم تحميل عربية المندوب بنجاح (${loadNo})`);
        renderVanStockLoad(document.getElementById('app-content'));
    } catch (err) {
        alert('خطأ أثناء التحميل: ' + err.message);
        saveBtns.forEach(b => { b.innerHTML = b.dataset._label; b.disabled = false; });
    }
};

Object.assign(window, {
    renderVanStockLoad,
    vlAddRow, vlRemoveRow, vlOnProductChange, vlOnQtyInput, vlOnFilterChange, vlSave,
});
