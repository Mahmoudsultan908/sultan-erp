/* ════════════════════════════════════════════════════════════
   فاتورة المشتريات — تخطيط ثنائي / هوية كحلي + ذهبي
   مربوطة بـ Supabase (products / suppliers / inventory_stock)
   + نظام المؤجل (deferred_rate + deferred_due_date)
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

// ── حالة الفاتورة ──
let purItems = [];
let purEditingId = null;

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
    ] = await Promise.all([
        sb.from('products').select('*').eq('is_active', true).order('name'),
        sb.from('suppliers').select('*').eq('is_active', true).order('name'),
        sb.from('warehouses').select('*').order('name'),
        sb.from('inventory_stock').select('warehouse_id, product_id, qty'),
        sb.from('purchases').select('invoice_no').order('created_at', { ascending: false }).limit(1),
        sb.from('app_settings').select('value').eq('key', 'purchase_counter').maybeSingle(),
    ]);

    PUR_DB.products = products || [];
    PUR_DB.suppliers = suppliers || [];
    PUR_DB.warehouses = warehouses || [];
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

    purItems = [{ id: Date.now(), pid: null, name: '', code: '', qty: 1, price: 0, disc: 0, free: 0, unit: '', upc: 1, deferredRate: 0, deferredDate: '' }];
    purSupplierId = null;
    purPayType = 'cash';

    c.innerHTML = `
    <div class="inv-root density-${localStorage.getItem('inv_density') || 'cozy'}">
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
            </div>
        </div>
    </div>`;
    purBindEvents();
    purRenderItems();
    purUpdateSummary();
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
        <span class="inv-no-badge" style="background:rgba(22,163,74,0.18);color:#4ADE80;border-color:rgba(22,163,74,0.35)">PUR-${String(PUR_DB.purchaseNo).padStart(4,'0')}</span>
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
        <button class="inv-top-btn inv-top-save" onclick="purSave(false)" style="background:#16A34A;box-shadow:0 3px 10px rgba(22,163,74,0.4)">💾 حفظ <kbd>F4</kbd></button>
        <button class="inv-top-btn inv-top-new" onclick="purSave(true)">➕ جديدة <kbd>Alt+N</kbd></button>
        <button class="inv-top-btn inv-top-close" onclick="purClose()">✕</button>
    </div>`;
}

function purSearchBarHTML() {
    return `
    <div class="inv-searchbar">
        <div class="inv-search-wrap">
            <span class="inv-search-icon">🔍</span>
            <input class="inv-search-input" id="purFastSearch" placeholder="ابحث: اسم / كود / باركود — ↑↓ تنقل — Enter اختيار" autocomplete="off">
            <div class="inv-ac" id="purFastAC" style="top:calc(100% + 4px)"></div>
        </div>
        <span class="inv-search-hint"><kbd>Alt+F</kbd> بحث</span>
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
    </div>`;
}

function purNotesCardHTML() {
    return `
    <div class="inv-card">
        <div class="inv-card-title">📝 ملاحظات</div>
        <textarea class="inv-notes" id="purNotes" rows="2" placeholder="ملاحظات الفاتورة..."></textarea>
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
        const deferredAmt = lineTotal * ((it.deferredRate||0) / 100);
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
                    oninput="purItems[${idx}].qty=parseFloat(this.value)||0;purUpdateSummary()" onkeydown="purRowKey(event,${idx},'qty')">
            </td>
            <td>
                <input type="number" class="inv-cell-input is-num is-free" value="${it.free||0}" min="0" step="0.001"
                    oninput="purItems[${idx}].free=parseFloat(this.value)||0">
            </td>
            <td>
                <input type="number" class="inv-cell-input is-num" value="${it.price||0}" min="0" step="0.01"
                    oninput="purItems[${idx}].price=parseFloat(this.value)||0;purUpdateSummary()" onkeydown="purRowKey(event,${idx},'price')">
            </td>
            <td>
                <input type="number" class="inv-cell-input is-num" value="${it.disc||0}" min="0" max="100" step="0.1"
                    oninput="purItems[${idx}].disc=parseFloat(this.value)||0;purUpdateSummary()">
            </td>
            <td>
                <input type="number" class="inv-cell-input is-num" value="${it.deferredRate||0}" min="0" max="100" step="0.1" title="نسبة المؤجل %"
                    style="background:#F5F3FF;color:#7C3AED" oninput="purItems[${idx}].deferredRate=parseFloat(this.value)||0;purUpdateSummary()">
            </td>
            <td class="inv-cell-total">${purFmt(lineTotal)}</td>
            <td class="inv-cell-del">
                <button class="inv-del-btn" onclick="purRemoveRow(${idx})">✕</button>
            </td>
        </tr>`;
    }).join('');
}

function purCalcNet() {
    const subtotal = purItems.reduce((s,i)=>s+(i.qty||0)*(i.price||0),0);
    const rowsDisc = purItems.reduce((s,i)=>s+(i.qty||0)*(i.price||0)*(i.disc||0)/100,0);
    const extra = parseFloat(document.getElementById('purDiscExtra')?.value)||0;
    const deferred = purItems.reduce((s,i) => {
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
    const m = val.length ? PUR_DB.suppliers.filter(s =>
        (s.name||'').includes(val) || (s.phone||'').includes(val) || (s.code||'').includes(val)
    ).slice(0,8) : [];
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
    document.querySelectorAll('#purSuppAC .inv-ac-item').forEach((el,idx)=>el.classList.toggle('active', idx===i));
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
    const m = val.length ? PUR_DB.products.filter(p =>
        (p.name||'').includes(val) || (p.code||'').includes(val) || (p.barcode||'').includes(val)
    ).slice(0,8) : [];
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
    document.querySelectorAll('#purFastAC .inv-ac-item').forEach((el,idx)=>el.classList.toggle('active', idx===i));
}
function purPickProduct(pid) {
    const p = PUR_DB.products.find(x=>x.id===pid);
    if (!p) return;
    const ex = purItems.findIndex(i=>i.pid===pid);
    if (ex >= 0) {
        purItems[ex].qty = (purItems[ex].qty||1) + 1;
    } else {
        const buy = purGetBuyPrice(p);
        const last = purItems[purItems.length-1];
        if (last && !last.pid) {
            last.pid = p.id; last.name = p.name; last.code = p.code||'';
            last.unit = p.unit||''; last.price = buy; last.upc = p.units_per_carton||1;
        } else {
            purItems.push({ id: Date.now(), pid: p.id, name: p.name, code: p.code||'', qty: 1, price: buy, disc: 0, free: 0, unit: p.unit||'', upc: p.units_per_carton||1, deferredRate: 0, deferredDate: '' });
        }
        purEnsureNewRow();
    }
    document.getElementById('purFastSearch').value = '';
    document.getElementById('purFastAC').classList.remove('show');
    _purFastIdx = -1;
    purRenderItems();
    purUpdateSummary();
}
function purEnsureNewRow() {
    const last = purItems[purItems.length-1];
    if (!last || last.pid) {
        purItems.push({ id: Date.now(), pid: null, name: '', code: '', qty: 1, price: 0, disc: 0, free: 0, unit: '', upc: 1, deferredRate: 0, deferredDate: '' });
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
function purRowACHover(idx,i){_purRowACIdx[idx]=i;document.querySelectorAll('#purAC-'+idx+' .inv-ac-item').forEach((el,x)=>el.classList.toggle('active',x===i));}
function purPickInline(idx, pid) {
    const p = PUR_DB.products.find(x=>x.id===pid);
    if (!p) return;
    const buy = purGetBuyPrice(p);
    purItems[idx] = { id: purItems[idx].id, pid: p.id, name: p.name, code: p.code||'', qty: purItems[idx].qty||1, price: buy, disc: 0, free: purItems[idx].free||0, unit: p.unit||'', upc: p.units_per_carton||1, deferredRate: purItems[idx].deferredRate||0, deferredDate: '' };
    purEnsureNewRow();
    purRenderItems(); purUpdateSummary();
    setTimeout(()=>{ const r=document.getElementById('purItemsBody')?.rows[idx]; if(r){ const inp=r.querySelectorAll('input')[2]; if(inp){inp.focus();inp.select();} } },30);
}
function purOnCode(idx, val) {
    purItems[idx].code = val;
    const p = PUR_DB.products.find(x=>x.code===val);
    if (p) purPickInline(idx, p.id);
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
    purItems.push({ id: Date.now(), pid: null, name: '', code: '', qty: 1, price: 0, disc: 0, free: 0, unit: '', upc: 1, deferredRate: 0, deferredDate: '' });
    purRenderItems(); purUpdateSummary();
    purFocusRow(purItems.length-1, 1);
}
function purFocusRow(idx, inputIdx) {
    setTimeout(()=>{ const r=document.getElementById('purItemsBody')?.rows[idx]; if(!r) return; const inp=r.querySelectorAll('input')[inputIdx]; if(inp){inp.focus();inp.select?.();} },40);
}
function purRemoveRow(idx) {
    purItems.splice(idx,1);
    if (!purItems.length) purItems.push({ id: Date.now(), pid: null, name:'',code:'',qty:1,price:0,disc:0,free:0,unit:'',upc:1,deferredRate:0,deferredDate:'' });
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
    document.getElementById('purCashPanel').classList.toggle('show', t==='cash');
    if (t==='cash') setTimeout(()=>document.getElementById('purCashPaid')?.focus(),50);
}
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
async function purSave(andNew) {
    const filled = purItems.filter(i => i.pid && (i.qty||0) > 0);
    if (!filled.length) { purToast('⚠️ الفاتورة فارغة — أضف أصنافاً أولاً', 'error'); return; }

    if (!purSupplierId) {
        if (!confirm('لم تختر مورداً. سيتم تسجيل الفاتورة كمورد نقدي. هل تريد المتابعة؟')) return;
    }

    const { subtotal, rowsDisc, extra, deferred, net } = purCalcNet();
    const invoiceNo = 'PUR-' + String(PUR_DB.purchaseNo).padStart(4, '0');

    const saveBtns = document.querySelectorAll('.inv-btn-save, .inv-top-save');
    saveBtns.forEach(b => { b.innerText = '⏳ جاري الحفظ...'; b.disabled = true; });

    try {
        // 1) INSERT في purchases
        const { data: purRows, error: purErr } = await sb.from('purchases').insert({
            invoice_no: invoiceNo,
            supplier_id: purSupplierId || null,
            payment_type: purPayType,
            subtotal,
            vat_amount: 0,
            total: net,
            status: 'confirmed',
            warehouse_id: purWarehouseId,
            created_by: currentUser?.id || null,
        }).select();
        if (purErr) throw purErr;
        const purchaseId = purRows[0].id;

        // 2) INSERT في purchase_items (مع snapshot المؤجل)
        const itemsToInsert = filled.map(it => {
            const prod = PUR_DB.products.find(p=>p.id===it.pid);
            const lineTotal = (it.qty||0) * (it.price||0) * (1 - (it.disc||0)/100);
            return {
                purchase_id: purchaseId,
                product_id: it.pid,
                qty: it.qty,
                unit_price: it.price,
                line_total: lineTotal,
                deferred_rate: it.deferredRate || 0,
                deferred_due_date: it.deferredRate > 0 ? (document.getElementById('purDate')?.value || null) : null,
                units_per_carton_snapshot: prod?.units_per_carton || 1,
            };
        });
        const { error: itemsErr } = await sb.from('purchase_items').insert(itemsToInsert);
        if (itemsErr) throw itemsErr;

        // 3) زِد رقم الفاتورة
        await sb.from('app_settings').upsert({ key: 'purchase_counter', value: String(PUR_DB.purchaseNo + 1), updated_at: new Date().toISOString() });
        PUR_DB.purchaseNo++;

        purToast(`✅ تم حفظ فاتورة المشتريات ${invoiceNo} — ${purFmt(net)} ج.م`, 'success');

        try {
            const { data: cash } = await sb.rpc('get_cash_balance');
            const tb = document.getElementById('topbarCash');
            if (tb) tb.textContent = '💰 ' + (cash || 0).toFixed(2) + ' ج.م';
        } catch {}

        if (andNew) {
            renderPurchases(document.getElementById('app-content'));
        } else {
            document.querySelector('.inv-no-badge').textContent = 'PUR-' + String(PUR_DB.purchaseNo).padStart(4, '0');
        }
    } catch (err) {
        alert('❌ خطأ أثناء حفظ الفاتورة: ' + err.message);
    } finally {
        saveBtns.forEach(b => { b.disabled = false; });
    }
}
function purClose() {
    if (confirm('إغلاق فاتورة المشتريات؟')) {
        document.getElementById('app-content').innerHTML = '<div class="empty-state"><span>📥</span>اضغط "المشتريات" لإنشاء فاتورة جديدة</div>';
    }
}
function purOnWarehouseChange() {
    const sel = document.getElementById('purWarehouse');
    if (sel) purWarehouseId = sel.value;
    purRenderItems(); purUpdateSummary();
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
    ss?.addEventListener('keydown', purSuppACKey);

    const fs = document.getElementById('purFastSearch');
    fs?.addEventListener('input', ()=>{ _purFastIdx=-1; purFastSearch(fs.value); });
    fs?.addEventListener('keydown', purFastKey);

    document.getElementById('app-content').addEventListener('keydown', purGlobalKeys);
}
function purGlobalKeys(e) {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    // اختصارات Alt+ (بدل Ctrl+S/Ctrl+N اللي بتتصادم مع اختصارات كروم المحجوزة)
    if (e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 's') { e.preventDefault(); purSave(false); return; }         // Alt+S حفظ
        if (k === 'n') { e.preventDefault(); purSave(true); return; }          // Alt+N فاتورة جديدة
        if (k === 'f') { e.preventDefault(); document.getElementById('purFastSearch')?.focus(); return; }  // Alt+F بحث صنف
        return;
    }
    // F4 فقط (F3=بحث الصفحة وF5=تحديث محجوزين في كروم ولا يمكن منعهما فعلياً)
    if (e.key === 'F4') { e.preventDefault(); purSave(false); }
    else if (e.key === 'Escape') {
        const open = document.querySelector('.inv-ac.show');
        if (open) open.classList.remove('show');
    }
}

Object.assign(window, {
    renderPurchases, purSave, purClose, purAddRow, purRemoveRow, purFocusRow,
    purSetPayType, purSetExactCash, purCalcChange,
    purSelectSupplier, purClearSupplier, purPickProduct, purPickInline,
    purOnName, purOnNameKey, purOnCode, purRowKey, purUpdateSummary,
    purRowACHover, purSuppACHover, purFastHover,
    purOnWarehouseChange,
});
