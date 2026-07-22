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
let vlLoadSeq = 1; // رقم التحميل لنفس المندوب فى نفس اليوم (أول/تاني/تالت...)
let _vlMultiSelected = {}; // {productId: qty} أثناء فتح مودال الاختيار المتعدد

function vlFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function vlToday() { return new Date().toISOString().split('T')[0]; }

async function renderVanStockLoad(container) {
    container.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات المخازن والمندوبين...</div>';
    try {
        const [{ data: warehouses }, { data: products }, { data: stock }, { data: reps }] = await Promise.all([
            sb.from('warehouses').select('*').order('name'),
            sb.from('products').select('id,name,code,unit').eq('is_active', true).order('name'),
            sb.from('inventory_stock').select('warehouse_id,product_id,qty'),
            sb.from('sales_reps').select('id,name,phone').eq('is_active', true).order('name'),
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

        await Promise.all([vlLoadRecent(), vlComputeLoadSequence()]);
        vlRenderScreen(container);
    } catch (err) {
        container.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

// تحميل أول/تاني/تالت... لنفس المندوب فى نفس اليوم — بيتقترح تلقائي
// (عدد تحميلات المندوب ده النهاردة + 1) وقابل للتعديل يدوي من الشاشة
async function vlComputeLoadSequence() {
    if (!vlRepId) { vlLoadSeq = 1; return; }
    try {
        const { count } = await sb.from('van_stock_loads')
            .select('id', { count: 'exact', head: true })
            .eq('rep_id', vlRepId).eq('load_date', vlToday());
        vlLoadSeq = (count || 0) + 1;
    } catch (e) { vlLoadSeq = 1; }
}

async function vlLoadRecent() {
    try {
        const { data, error } = await sb.from('van_stock_loads')
            .select('*, wh:warehouse_id(name), rep:rep_id(name), van_stock_load_items(qty, unit_name, product:product_id(name))')
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
                ${vlExcelCardHTML()}
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
    const selRep = VL_DB.reps.find(r => r.id === vlRepId);
    return `
    <div class="inv-header inv-header-2row">
        <div class="inv-header-row1">
            <div class="inv-header-brand">
                <div class="ic">🚗</div>
                <div class="ttl">تحميل عربية مندوب<small> نقل فيزيائي من المخزن لعربية المندوب — بدون تأثير مالي</small></div>
            </div>

            <input type="date" class="inv-date-input" id="vlDate" value="${vlToday()}" title="تاريخ التحميل">

            <select class="inv-date-input" id="vlWarehouse" title="من مخزن" onchange="vlOnFilterChange()" style="cursor:pointer">
                ${VL_DB.warehouses.map(w => `<option value="${w.id}" ${w.id === vlWarehouseId ? 'selected' : ''}>📤 من: ${w.name}${w.is_main ? ' (رئيسي)' : ''}</option>`).join('') || '<option value="">لا يوجد مخزن</option>'}
            </select>

            <div class="inv-header-spacer"></div>
            <button class="inv-top-btn inv-top-new" onclick="renderVanStockLoad(document.getElementById('app-content'))">➕ جديد</button>
            <button class="inv-top-btn inv-top-save inv-top-save-strong" onclick="vlSave()">💾 حفظ التحميل</button>
        </div>
        <div class="inv-header-row2">
            <div class="inv-cust-avatar">🚗</div>
            <div class="inv-cust-body">
                <select class="inv-cust-search-lg" id="vlRep" title="عربية المندوب" onchange="vlOnFilterChange()" style="cursor:pointer">
                    ${VL_DB.reps.map(r => `<option value="${r.id}" ${r.id === vlRepId ? 'selected' : ''}>${r.name}</option>`).join('')}
                </select>
                <div class="inv-cust-addr">${selRep?.phone || 'عربية المندوب اللي هيتحمّل عليها الصنف'}</div>
            </div>
        </div>
    </div>`;
}

function vlSearchBarHTML() {
    return `
    <div class="inv-searchbar">
        <div style="flex:1;color:#CBD5E1;font-size:12.5px">اختار أصناف متعددة دفعة واحدة بالبحث، أو أضف صنف واحد يدوياً.</div>
        <button class="inv-add-row-btn" onclick="vlOpenMultiPick()">☑️ اختيار أصناف متعددة</button>
        <button class="inv-add-row-btn" onclick="vlAddRow()">+ سطر يدوي</button>
    </div>`;
}

// ════════════════════════════════════════════════════════════
// اختيار أصناف متعددة (بحث + تحديد) — نفس نمط invOpenMultiPick فى sales.js
// ════════════════════════════════════════════════════════════
let _vlMultiHideZero = true;
function vlOpenMultiPick() {
    if (!vlWarehouseId) { alert('اختر المخزن أولاً'); return; }
    document.getElementById('vlMultiModal')?.remove();
    const m = document.createElement('div');
    m.id = 'vlMultiModal';
    m.className = 'mod-modal-bg active';
    m.innerHTML = `
    <div class="mod-modal" style="max-width:640px">
        <div class="mod-modal-header"><h3>☑️ اختيار أصناف متعددة</h3>
            <button class="mod-modal-close" onclick="vlCloseMultiPick()">✕</button></div>
        <div class="mod-modal-body">
            <input type="text" class="mod-form-input" id="vlMultiSearch" placeholder="بحث بالاسم / الكود..." autocomplete="off" oninput="vlRenderMultiPickList(this.value)">
            <label style="display:flex;align-items:center;gap:7px;margin-top:9px;font-size:12.5px;color:#475569;cursor:pointer">
                <input type="checkbox" id="vlMultiHideZero" ${_vlMultiHideZero ? 'checked' : ''} onchange="vlMultiToggleHideZero(this.checked)">
                إخفاء الأصناف بدون رصيد بالمخزن
            </label>
            <div id="vlMultiPickList" style="margin-top:12px;display:flex;flex-direction:column;gap:6px"></div>
        </div>
        <div class="mod-modal-footer">
            <button class="inv-btn inv-btn-print" onclick="vlCloseMultiPick()">إلغاء</button>
            <button class="inv-btn inv-btn-save" onclick="vlAddMultiPicked()">➕ إضافة المحدد</button>
        </div>
    </div>`;
    document.body.appendChild(m);
    _vlMultiSelected = {};
    vlRenderMultiPickList('');
    setTimeout(() => document.getElementById('vlMultiSearch')?.focus(), 50);
}
function vlCloseMultiPick() {
    document.getElementById('vlMultiModal')?.remove();
    _vlMultiSelected = {};
}
function vlMultiToggleHideZero(checked) {
    _vlMultiHideZero = checked;
    vlRenderMultiPickList(document.getElementById('vlMultiSearch')?.value || '');
}
function vlRenderMultiPickList(val) {
    const box = document.getElementById('vlMultiPickList');
    if (!box) return;
    const v = (val || '').trim();
    let list = v ? VL_DB.products.filter(p => (p.name || '').includes(v) || (p.code || '').includes(v)) : VL_DB.products;
    if (_vlMultiHideZero) list = list.filter(p => vlGetStock(p.id) > 0);
    if (!list.length) { box.innerHTML = '<div style="padding:20px;text-align:center;color:#94A3B8">لا توجد نتائج</div>'; return; }
    box.innerHTML = list.slice(0, 200).map(p => {
        const sel = _vlMultiSelected[p.id];
        const checked = sel != null;
        const qty = sel ?? 1;
        const stock = vlGetStock(p.id);
        return `<label class="inv-multi-row" data-pid="${p.id}" style="display:flex;align-items:center;gap:10px;padding:7px 10px;border:1.5px solid #E2E8F0;border-radius:10px;cursor:pointer">
            <input type="checkbox" ${checked ? 'checked' : ''} onchange="vlMultiToggle('${p.id}',this.checked)">
            <span style="flex:1">${p.name} <small style="color:#94A3B8">${p.code || ''} · ${p.unit || ''}</small></span>
            <span style="font-size:11px;color:#94A3B8">مخزون: ${vlFmt(stock)}</span>
            <input type="number" class="mod-form-input" value="${qty}" min="0.001" step="0.001" style="width:76px;padding:6px 8px"
                onclick="event.stopPropagation()" oninput="vlMultiSetQty('${p.id}',this.value)">
        </label>`;
    }).join('');
}
function vlMultiToggle(pid, checked) {
    if (checked) { if (_vlMultiSelected[pid] == null) _vlMultiSelected[pid] = 1; }
    else delete _vlMultiSelected[pid];
}
function vlMultiSetQty(pid, val) {
    const q = parseFloat(val) || 0;
    if (q <= 0) return;
    _vlMultiSelected[pid] = q;
    const cb = document.querySelector(`.inv-multi-row[data-pid="${pid}"] input[type=checkbox]`);
    if (cb && !cb.checked) cb.checked = true;
}
function vlAddMultiPicked() {
    const ids = Object.keys(_vlMultiSelected);
    if (!ids.length) { alert('لم يتم اختيار أي صنف'); return; }
    let added = 0;
    ids.forEach(pid => {
        const p = VL_DB.products.find(x => x.id === pid);
        if (!p) return;
        const qty = _vlMultiSelected[pid] || 1;
        const ex = vlItems.findIndex(i => i.productId === pid);
        if (ex >= 0) {
            vlItems[ex].qty = (vlItems[ex].qty || 0) + qty;
        } else {
            const empty = vlItems.find(i => !i.productId);
            if (empty) { empty.productId = pid; empty.qty = qty; }
            else vlItems.push({ id: Date.now() + added, productId: pid, qty });
        }
        added++;
    });
    vlRenderItems();
    vlUpdateSummary();
    vlCloseMultiPick();
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
        <div style="margin-bottom:10px">
            <label style="font-size:12px;color:var(--inv-muted);display:block;margin-bottom:4px">رقم التحميل اليوم لهذا المندوب (أول/تاني/تالت...)</label>
            <input type="number" class="mod-form-input" id="vlLoadSeq" value="${vlLoadSeq}" min="1" step="1" style="width:80px" oninput="vlOnLoadSeqInput(this.value)">
        </div>
        <div style="font-size:11.5px;color:var(--inv-muted)">تحميل عربية المندوب لا يخصم أو يزيد من رصيد الخزنة ولا يضيف قيوداً محاسبية — هو نقل فيزيائي من المخزن لعربية المندوب فقط. مبيعات المندوب من عربيته بتخصم من هنا تلقائياً.</div>
    </div>`;
}

function vlExcelCardHTML() {
    return `
    <div class="inv-card">
        <div class="inv-card-title">📊 استيراد Excel</div>
        <label class="inv-btn inv-btn-print" style="cursor:pointer;justify-content:center;margin:0">
            📥 استيراد قائمة تحميل من Excel
            <input type="file" accept=".csv,.xlsx,.xls" style="display:none" onchange="vlImportXls(this)">
        </label>
        <div style="font-size:11px;color:var(--inv-muted);margin-top:6px">أعمدة الملف: "الصنف" أو "الكود" + "الكمية" — نفس فكرة استيراد فاتورة المبيعات.</div>
    </div>`;
}

function vlActionsCardHTML() {
    return `
    <div class="inv-actions">
        <button class="inv-btn inv-btn-save" onclick="vlSave()">💾 حفظ التحميل</button>
        <button class="inv-btn inv-btn-print" onclick="vlSaveAndPrint()">🖨️ حفظ وطباعة</button>
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
            <th>رقم التحميل</th><th>التاريخ</th><th>من مخزن</th><th>عربية المندوب</th><th>رقم اليوم</th><th>عدد الأصناف</th><th style="text-align:left">إجمالي الكمية</th><th>ملاحظات</th><th></th>
        </tr></thead>
        <tbody>
            ${list.length ? list.map((t, i) => {
                const items = t.van_stock_load_items || [];
                const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
                return `<tr>
                    <td><span style="background:#F1F5F9;padding:3px 8px;border-radius:5px;font-size:11px;font-family:monospace">${t.load_no || '—'}</span></td>
                    <td>${t.load_date ? new Date(t.load_date).toLocaleDateString('ar-EG') : '—'}</td>
                    <td>${t.wh?.name || '—'}</td>
                    <td>🚗 ${t.rep?.name || '—'}</td>
                    <td>${t.load_sequence || 1}</td>
                    <td>${items.length}</td>
                    <td style="text-align:left;font-weight:700">${vlFmt(totalQty)}</td>
                    <td style="color:#64748B">${t.notes || '—'}</td>
                    <td><button class="cc-edit" onclick="vlReprint(${i})">🖨️</button></td>
                </tr>`;
            }).join('') : `<tr><td colspan="9" class="empty-state"><span>🚗</span>لا توجد تحميلات حتى الآن.</td></tr>`}
        </tbody></table>
    </div>`;
}

// استيراد قائمة تحميل من Excel — نفس فكرة invImportXls فى sales.js بالحرف
// (بحث بالكود الأول ثم الاسم، وتجميع الكمية على السطر الموجود لو الصنف
// مكرر بدل تكرار السطر) بس هنا مفيش سعر/خصم، مجرد صنف + كمية.
function vlImportXls(input) {
    if (!input.files.length) return;
    if (!vlWarehouseId) { alert('اختر المخزن أولاً'); input.value = ''; return; }
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
            let added = 0, skipped = 0;
            json.forEach(row => {
                const name = row['الصنف'] || row['صنف'] || row['اسم الصنف'] || row['اسم'] || '';
                const code = String(row['الكود'] || row['كود'] || '').trim();
                const qty = parseFloat(row['الكمية'] || row['كمية'] || 0);
                if (!qty || qty <= 0) { skipped++; return; }
                let matched = null;
                if (code) matched = VL_DB.products.find(p => p.code === code);
                if (!matched && name) matched = VL_DB.products.find(p => (p.name || '').includes(name) || name.includes(p.name || ''));
                if (!matched) { skipped++; return; }
                const ex = vlItems.findIndex(i => i.productId === matched.id);
                if (ex >= 0) {
                    vlItems[ex].qty = (vlItems[ex].qty || 0) + qty;
                } else {
                    const empty = vlItems.find(i => !i.productId);
                    if (empty) { empty.productId = matched.id; empty.qty = qty; }
                    else vlItems.push({ id: Date.now() + added, productId: matched.id, qty });
                }
                added++;
            });
            vlRenderItems();
            vlUpdateSummary();
            alert(added ? `📥 تم استيراد ${added} صنف من Excel${skipped ? ` (اتجاهل ${skipped} سطر مش متطابق أو من غير كمية)` : ''}` : '⚠️ مفيش أي صنف اتطابق من الملف');
        } catch (err) {
            alert('❌ خطأ في قراءة الملف: ' + err.message);
        }
    };
    reader.readAsArrayBuffer(file);
    input.value = '';
}

function vlGetStock(pid) {
    if (!vlWarehouseId || !pid) return 0;
    return VL_DB.stockMap[vlWarehouseId + '|' + pid] || 0;
}

async function vlOnFilterChange() {
    const whSel = document.getElementById('vlWarehouse');
    const repSel = document.getElementById('vlRep');
    if (whSel) vlWarehouseId = whSel.value;
    if (repSel) vlRepId = repSel.value;
    const selRep = VL_DB.reps.find(r => r.id === vlRepId);
    const subEl = repSel?.parentElement.querySelector('.inv-cust-addr');
    if (subEl) subEl.textContent = selRep?.phone || 'عربية المندوب اللي هيتحمّل عليها الصنف';
    vlRenderItems();
    await vlComputeLoadSequence();
    const seqInput = document.getElementById('vlLoadSeq');
    if (seqInput) seqInput.value = vlLoadSeq;
}

window.vlOnLoadSeqInput = function (val) {
    vlLoadSeq = parseInt(val) || 1;
};

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

// اللب المشترك بين "حفظ" و"حفظ وطباعة" — بيرجع بيانات التحميل المحفوظ
// لو نجح (عشان الطباعة تستخدمها من غير ما تعمل استعلام تاني)، أو null لو فشل
async function vlSaveCore() {
    const whId = vlWarehouseId;
    const repId = vlRepId;
    if (!whId) { alert('يرجى اختيار المخزن'); return null; }
    if (!repId) { alert('يرجى اختيار المندوب'); return null; }

    const filled = vlItems.filter(it => it.productId && (it.qty || 0) > 0);
    if (!filled.length) { alert('أضف صنفاً واحداً على الأقل بكمية أكبر من صفر'); return null; }

    const qtyByProduct = {};
    filled.forEach(it => { qtyByProduct[it.productId] = (qtyByProduct[it.productId] || 0) + it.qty; });
    for (const pid in qtyByProduct) {
        const stock = vlGetStock(pid);
        if (qtyByProduct[pid] > stock) {
            const name = VL_DB.products.find(p => p.id === pid)?.name || pid;
            alert(`الكمية المطلوب تحميلها من صنف "${name}" (${vlFmt(qtyByProduct[pid])}) أكبر من المتاح في المخزن (${vlFmt(stock)})`);
            return null;
        }
    }

    const date = document.getElementById('vlDate')?.value || vlToday();
    const notes = document.getElementById('vlNotes')?.value.trim() || null;

    try {
        const loadNo = 'VL-' + Date.now();
        const { data: rows, error } = await sb.from('van_stock_loads').insert({
            load_no: loadNo,
            warehouse_id: whId,
            rep_id: repId,
            load_date: date,
            notes,
            load_sequence: vlLoadSeq || 1,
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

        return {
            loadNo, date, notes, loadSeq: vlLoadSeq || 1,
            repName: VL_DB.reps.find(r => r.id === repId)?.name || '',
            whName: VL_DB.warehouses.find(w => w.id === whId)?.name || '',
            items: filled.map(it => ({
                name: VL_DB.products.find(p => p.id === it.productId)?.name || '',
                qty: it.qty,
                unit_name: VL_DB.products.find(p => p.id === it.productId)?.unit || '',
            })),
        };
    } catch (err) {
        alert('خطأ أثناء التحميل: ' + err.message);
        return null;
    }
}

window.vlSave = async function () {
    const saveBtns = document.querySelectorAll('.inv-btn-save, .inv-btn-print, .inv-top-save');
    saveBtns.forEach(b => { b.dataset._label = b.dataset._label || b.innerHTML; b.disabled = true; });
    document.querySelector('.inv-top-save').innerHTML = '⏳ جاري التحميل...';

    const result = await vlSaveCore();
    if (result) {
        alert(`تم تحميل عربية المندوب بنجاح (${result.loadNo})`);
        renderVanStockLoad(document.getElementById('app-content'));
    } else {
        saveBtns.forEach(b => { b.innerHTML = b.dataset._label; b.disabled = false; });
    }
};

window.vlReprint = async function (idx) {
    const t = VL_DB.list[idx];
    if (!t) return;
    await printThermalReceipt('van_load', {
        loadNo: t.load_no, date: t.load_date, loadSeq: t.load_sequence || 1,
        repName: t.rep?.name || '', whName: t.wh?.name || '', notes: t.notes,
        items: (t.van_stock_load_items || []).map(it => ({ name: it.product?.name || '', qty: it.qty, unit_name: it.unit_name })),
    });
};

window.vlSaveAndPrint = async function () {
    const saveBtns = document.querySelectorAll('.inv-btn-save, .inv-btn-print, .inv-top-save');
    saveBtns.forEach(b => { b.dataset._label = b.dataset._label || b.innerHTML; b.disabled = true; });
    const printBtn = document.querySelector('.inv-btn-print');
    if (printBtn) printBtn.innerHTML = '⏳ جاري الحفظ...';

    const result = await vlSaveCore();
    if (result) {
        await printThermalReceipt('van_load', result);
        renderVanStockLoad(document.getElementById('app-content'));
    } else {
        saveBtns.forEach(b => { b.innerHTML = b.dataset._label; b.disabled = false; });
    }
};

Object.assign(window, {
    renderVanStockLoad,
    vlAddRow, vlRemoveRow, vlOnProductChange, vlOnQtyInput, vlOnFilterChange, vlSave, vlSaveAndPrint,
    vlOpenMultiPick, vlCloseMultiPick, vlRenderMultiPickList, vlMultiToggle, vlMultiSetQty, vlAddMultiPicked,
    vlOnLoadSeqInput,
});
