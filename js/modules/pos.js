/* ════════════════════════════════════════════════════════════
   نقطة بيع سريعة (POS) — شاشة بيع مبسطة بديلة لفاتورة المبيعات
   الأساسية، مخصصة لعميل نقدي/سوبر ماركت: مسح باركود → سلة → دفع.
   بتستخدم نفس fn_create_sale RPC اللي بتستخدمها شاشة المبيعات
   الأساسية (sales.js) عشان تفضل كل الحسابات/المخزون/القيود شغالة
   بنفس المنطق الموجود فعلاً في قاعدة البيانات — الشاشة دي بس
   واجهة أبسط، مش منطق مختلف.
   ════════════════════════════════════════════════════════════ */

let POS_DB = { products: [], warehouses: [], treasuries: [], customers: [], stockMap: {} };
let posWarehouseId = null;
let posItems = [];          // { pid, name, unit, price, qty }
let posCustId = null;       // العميل (لازم يتحدد لو الدفع آجل)
let posPayType = 'cash';    // cash | credit

function posFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function posGetStock(productId) {
    if (!posWarehouseId) return 0;
    return POS_DB.stockMap[posWarehouseId + '|' + productId] || 0;
}

async function renderPos(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل...</div>';
    try {
        const [{ data: products }, { data: warehouses }, { data: treasuries }, { data: customers }, { data: stockRows }] = await Promise.all([
            sb.from('products').select('id, name, code, barcode, unit, retail_price, wholesale_price, purchase_price, units_per_carton').eq('is_active', true).order('name'),
            sb.from('warehouses').select('*').order('name'),
            sb.from('treasuries').select('*').eq('is_active', true).order('is_default', { ascending: false }),
            sb.from('customers').select('id, name, phone, balance').eq('is_active', true).order('name'),
            sb.from('inventory_stock').select('warehouse_id, product_id, qty'),
        ]);
        POS_DB.products = products || [];
        POS_DB.warehouses = warehouses || [];
        POS_DB.treasuries = treasuries || [];
        POS_DB.customers = customers || [];
        POS_DB.stockMap = {};
        (stockRows || []).forEach(r => { POS_DB.stockMap[r.warehouse_id + '|' + r.product_id] = Number(r.qty) || 0; });

        const mainWh = POS_DB.warehouses.find(w => w.is_main) || POS_DB.warehouses[0];
        posWarehouseId = mainWh?.id || null;

        posItems = [];
        posCustId = null;
        posPayType = 'cash';

        c.innerHTML = posLayoutHTML();
        posSetPayType('cash');
        posRenderCart();
        setTimeout(() => document.getElementById('posScan')?.focus(), 80);
    } catch (err) {
        c.innerHTML = `<div style="background:var(--inv-red-bg,#FEF2F2);color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function posLayoutHTML() {
    return `
    <div style="display:flex;flex-direction:column;gap:14px;height:calc(100vh - 100px)">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <h2 style="margin:0;color:var(--inv-navy);font-size:22px">🛒 نقطة بيع سريعة</h2>
            ${POS_DB.warehouses.length > 1 ? `
            <select id="posWarehouse" onchange="posWarehouseId=this.value;posRenderCart()" style="padding:8px 12px;border-radius:10px;border:1px solid var(--inv-border);background:var(--inv-card);color:var(--inv-text)">
                ${POS_DB.warehouses.map(w => `<option value="${w.id}" ${w.id === posWarehouseId ? 'selected' : ''}>🏭 ${w.name}</option>`).join('')}
            </select>` : ''}
            <div style="flex:1"></div>
            <button class="inv-btn" onclick="posReset(true)" style="background:var(--inv-muted);color:#fff">🔄 فاتورة جديدة</button>
        </div>

        <input id="posScan" type="text" placeholder="📷 امسح الباركود أو اكتب اسم/كود الصنف واضغط Enter..."
            autocomplete="off"
            style="width:100%;padding:18px 16px;font-size:20px;border-radius:14px;border:2px solid var(--inv-gold);background:var(--inv-card);color:var(--inv-text)"
            onkeydown="if(event.key==='Enter'){event.preventDefault();posOnScan(this.value);this.value='';}"
            oninput="posOnTypeahead(this.value)">
        <div id="posAC" style="display:none;background:var(--inv-card);border:1px solid var(--inv-border);border-radius:12px;max-height:260px;overflow:auto;box-shadow:0 8px 24px rgba(0,0,0,.12)"></div>

        <div style="display:flex;gap:14px;flex:1;min-height:0">
            <div style="flex:2;display:flex;flex-direction:column;min-width:0">
                <div style="flex:1;overflow:auto;border:1px solid var(--inv-border);border-radius:12px;background:var(--inv-card)">
                    <table class="inv-table" style="width:100%">
                        <thead><tr>
                            <th>الصنف</th><th style="width:80px">المخزون</th><th style="width:140px">الكمية</th><th style="width:110px">السعر</th><th style="width:110px">الإجمالي</th><th style="width:44px"></th>
                        </tr></thead>
                        <tbody id="posCartBody"></tbody>
                    </table>
                </div>
            </div>

            <div style="flex:1;display:flex;flex-direction:column;gap:12px;max-width:340px;overflow:auto">
                <div class="inv-card" style="padding:14px">
                    <div style="display:flex;justify-content:space-between;font-size:15px;padding:4px 0"><span>عدد الأصناف</span><b id="posItemCount">0</b></div>
                    <div style="display:flex;justify-content:space-between;font-size:15px;padding:4px 0"><span>الإجمالي الفرعي</span><b id="posSubtotal">0.00</b></div>
                    <div style="display:flex;justify-content:space-between;align-items:center;font-size:15px;padding:4px 0">
                        <span>خصم</span>
                        <input id="posDiscount" type="number" value="0" min="0" oninput="posUpdateTotals()" style="width:90px;padding:6px;border-radius:8px;border:1px solid var(--inv-border);text-align:center">
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:22px;font-weight:800;color:var(--inv-navy);border-top:1px dashed var(--inv-border);margin-top:8px;padding-top:8px">
                        <span>الإجمالي</span><span id="posNet">0.00</span>
                    </div>
                </div>

                <div class="inv-card" style="padding:14px">
                    <div style="display:flex;gap:8px;margin-bottom:10px">
                        <button id="posPayCash" class="inv-btn" onclick="posSetPayType('cash')" style="flex:1">💵 كاش</button>
                        <button id="posPayCredit" class="inv-btn" onclick="posSetPayType('credit')" style="flex:1">📅 آجل</button>
                    </div>
                    <div id="posCashPanel" style="display:none">
                        ${POS_DB.treasuries.length > 1 ? `
                        <select id="posTreasury" style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--inv-border);margin-bottom:8px">
                            ${POS_DB.treasuries.map(t => `<option value="${t.id}" ${t.is_default ? 'selected' : ''}>${t.name}</option>`).join('')}
                        </select>` : ''}
                        <input id="posCashReceived" type="number" placeholder="المبلغ المستلم" oninput="posUpdateChange()" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--inv-border);font-size:16px;text-align:center">
                        <div style="display:flex;justify-content:space-between;font-size:14px;margin-top:8px"><span>الباقي للعميل</span><b id="posChange">0.00</b></div>
                    </div>
                    <div id="posCreditPanel" style="display:none">
                        <input id="posCustSearch" type="text" placeholder="اسم العميل..." oninput="posFilterCustomers(this.value)" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--inv-border);margin-bottom:6px">
                        <div id="posCustList" style="max-height:120px;overflow:auto;border:1px solid var(--inv-border);border-radius:8px;display:none"></div>
                        <div id="posCustSelected" style="font-size:14px;padding:6px 2px;color:var(--inv-muted)">لم يتم اختيار عميل</div>
                        <label style="font-size:13px;color:var(--inv-muted)">تاريخ الاستحقاق</label>
                        <input id="posDueDate" type="date" value="${posDefaultDueDate()}" style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--inv-border)">
                    </div>
                </div>

                <button onclick="posSave()" style="width:100%;padding:18px;font-size:19px;font-weight:800;border:none;border-radius:14px;background:var(--inv-green);color:#fff;cursor:pointer">✅ إتمام البيع</button>
            </div>
        </div>
    </div>`;
}

function posDefaultDueDate() {
    const d = new Date();
    d.setDate(d.getDate() + 15);
    return d.toISOString().slice(0, 10);
}

function posSetPayType(t) {
    posPayType = t;
    document.getElementById('posPayCash')?.classList.toggle('active', t === 'cash');
    document.getElementById('posPayCredit')?.classList.toggle('active', t === 'credit');
    document.getElementById('posCashPanel').style.display = t === 'cash' ? 'block' : 'none';
    document.getElementById('posCreditPanel').style.display = t === 'credit' ? 'block' : 'none';
    if (t === 'cash') setTimeout(() => document.getElementById('posCashReceived')?.focus(), 50);
}

// ── سلة الأصناف ──
function posGetPrice(p) { return Number(p.retail_price) || Number(p.wholesale_price) || 0; }

function posAddProduct(pid) {
    const p = POS_DB.products.find(x => x.id === pid);
    if (!p) return;
    const existing = posItems.find(it => it.pid === pid);
    if (existing) existing.qty += 1;
    else posItems.push({ pid: p.id, name: p.name, unit: p.unit || 'قطعة', price: posGetPrice(p), qty: 1 });
    posRenderCart();
}

function posOnScan(val) {
    const code = (val || '').trim();
    if (!code) return;
    let p = POS_DB.products.find(x => x.barcode === code || x.code === code);
    if (!p) {
        const matches = flexSearch(POS_DB.products, code, ['name', 'code', 'barcode'], 6);
        if (matches.length === 1) p = matches[0];
        else if (matches.length > 1) { posShowAC(matches); return; }
    }
    document.getElementById('posAC').style.display = 'none';
    if (!p) { posToast('⚠️ الصنف غير موجود: ' + code, 'error'); return; }
    posAddProduct(p.id);
}

function posOnTypeahead(val) {
    const q = (val || '').trim();
    if (!q) { document.getElementById('posAC').style.display = 'none'; return; }
    const matches = flexSearch(POS_DB.products, q, ['name', 'code', 'barcode'], 8);
    posShowAC(matches);
}

function posShowAC(matches) {
    const box = document.getElementById('posAC');
    if (!matches.length) { box.style.display = 'none'; return; }
    box.innerHTML = matches.map(p => {
        const stock = posGetStock(p.id);
        return `
        <div onclick="posPickAC('${p.id}')" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--inv-border);display:flex;justify-content:space-between;align-items:center;gap:10px">
            <span>${p.name}</span>
            <span style="display:flex;align-items:center;gap:10px">
                <small style="color:${stock > 0 ? 'var(--inv-muted)' : 'var(--inv-red)'}">مخزون: ${stock}</small>
                <b style="color:var(--inv-gold)">${posFmt(posGetPrice(p))}</b>
            </span>
        </div>`;
    }).join('');
    box.style.display = 'block';
}
function posPickAC(pid) {
    posAddProduct(pid);
    document.getElementById('posAC').style.display = 'none';
    const scan = document.getElementById('posScan');
    scan.value = ''; scan.focus();
}

function posChangeQty(idx, delta) {
    const it = posItems[idx];
    if (!it) return;
    it.qty = Math.max(0, (Number(it.qty) || 0) + delta);
    if (it.qty <= 0) posItems.splice(idx, 1);
    posRenderCart();
}
function posSetQty(idx, val) {
    const it = posItems[idx];
    if (!it) return;
    const q = Math.max(0, Number(val) || 0);
    if (q <= 0) posItems.splice(idx, 1); else it.qty = q;
    posRenderCart();
}
function posRemoveItem(idx) { posItems.splice(idx, 1); posRenderCart(); }

function posRenderCart() {
    const body = document.getElementById('posCartBody');
    if (!body) return;
    body.innerHTML = posItems.map((it, idx) => {
        const liveStock = posGetStock(it.pid);
        const low = liveStock > 0 && it.qty > liveStock;
        const outOfStock = liveStock <= 0;
        return `
        <tr>
            <td>${it.name}</td>
            <td style="text-align:center${(low || outOfStock) ? ';color:var(--inv-red);font-weight:700' : ''}">${liveStock}</td>
            <td>
                <div style="display:flex;align-items:center;gap:4px;justify-content:center">
                    <button onclick="posChangeQty(${idx},-1)" style="width:30px;height:30px;border:none;border-radius:8px;background:var(--inv-border);cursor:pointer">−</button>
                    <input type="number" value="${it.qty}" oninput="posSetQty(${idx},this.value)" style="width:50px;text-align:center;border:1px solid var(--inv-border);border-radius:6px;padding:4px">
                    <button onclick="posChangeQty(${idx},1)" style="width:30px;height:30px;border:none;border-radius:8px;background:var(--inv-gold);color:#fff;cursor:pointer">+</button>
                </div>
            </td>
            <td style="text-align:center">${posFmt(it.price)}</td>
            <td style="text-align:center;font-weight:700">${posFmt(it.qty * it.price)}</td>
            <td><button onclick="posRemoveItem(${idx})" style="border:none;background:none;color:var(--inv-red);font-size:18px;cursor:pointer">🗑️</button></td>
        </tr>`;
    }).join('') || `<tr><td colspan="6" style="text-align:center;color:var(--inv-muted);padding:30px">امسح باركود صنف أو ابحث عنه لإضافته للسلة</td></tr>`;
    posUpdateTotals();
}

function posCalcNet() {
    const subtotal = posItems.reduce((s, it) => s + it.qty * it.price, 0);
    const discount = Number(document.getElementById('posDiscount')?.value) || 0;
    const net = Math.max(0, subtotal - discount);
    return { subtotal, discount, net };
}

function posUpdateTotals() {
    const { subtotal, net } = posCalcNet();
    document.getElementById('posItemCount').textContent = posItems.reduce((s, it) => s + Number(it.qty || 0), 0);
    document.getElementById('posSubtotal').textContent = posFmt(subtotal);
    document.getElementById('posNet').textContent = posFmt(net);
    posUpdateChange();
}

function posUpdateChange() {
    const { net } = posCalcNet();
    const received = Number(document.getElementById('posCashReceived')?.value) || 0;
    const changeEl = document.getElementById('posChange');
    if (changeEl) changeEl.textContent = posFmt(Math.max(0, received - net));
}

// ── اختيار العميل (للدفع الآجل) ──
function posFilterCustomers(q) {
    const list = document.getElementById('posCustList');
    q = (q || '').trim();
    if (!q) { list.style.display = 'none'; return; }
    const matches = flexSearch(POS_DB.customers, q, ['name', 'phone'], 8);
    if (!matches.length) { list.style.display = 'none'; return; }
    list.innerHTML = matches.map(cst => `<div onclick="posPickCustomer('${cst.id}')" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--inv-border)">${cst.name}</div>`).join('');
    list.style.display = 'block';
}
function posPickCustomer(id) {
    posCustId = id;
    const cst = POS_DB.customers.find(x => x.id === id);
    document.getElementById('posCustSelected').textContent = cst ? `✅ ${cst.name}` : 'لم يتم اختيار عميل';
    document.getElementById('posCustList').style.display = 'none';
    document.getElementById('posCustSearch').value = '';
}

// ── الحفظ ──
async function posSave() {
    if (!posItems.length) { posToast('⚠️ السلة فارغة', 'error'); return; }
    if (!posWarehouseId) { posToast('⚠️ لا يوجد مخزن لإتمام البيع', 'error'); return; }
    if (posPayType === 'credit' && !posCustId) { posToast('⚠️ اختر عميل للبيع الآجل', 'error'); return; }

    // فحص المخزون المتاح في المخزن المختار — نفس منطق فاتورة المبيعات الأساسية
    const stockWarnings = posItems
        .filter(it => posGetStock(it.pid) < it.qty)
        .map(it => `• ${it.name}: متاح ${posGetStock(it.pid)} — مطلوب ${it.qty}`);
    if (stockWarnings.length) {
        const proceed = confirm('⚠️ تحذير نقص مخزون:\n\n' + stockWarnings.join('\n') + '\n\nهل تريد المتابعة؟ (سيصبح المخزون بالسالب)');
        if (!proceed) return;
    }

    const { subtotal, discount, net } = posCalcNet();
    const treasuryId = POS_DB.treasuries.length > 1
        ? (document.getElementById('posTreasury')?.value || null)
        : (POS_DB.treasuries[0]?.id || null);

    const itemsPayload = posItems.map(it => {
        const prod = POS_DB.products.find(p => p.id === it.pid);
        return {
            product_id: it.pid, qty: it.qty, unit_price: it.price, line_total: it.qty * it.price,
            unit_type: 'sale_unit', units_per_carton_snapshot: prod?.units_per_carton || 1,
            discount_pct: 0, free_qty: 0,
            cost_price_snapshot: Number(prod?.purchase_price) || 0,
            unit_name: prod?.unit || it.unit || 'قطعة',
        };
    });

    try {
        const { data: rpcRows, error: rpcErr } = await sb.rpc('fn_create_sale', {
            p_customer_id: posPayType === 'credit' ? posCustId : null,
            p_payment_type: posPayType,
            p_subtotal: subtotal,
            p_vat_amount: 0,
            p_total: net,
            p_discount: discount,
            p_warehouse_id: posWarehouseId,
            p_rep_id: null,
            p_treasury_id: posPayType === 'cash' ? treasuryId : null,
            p_source_app: 'erp',
            p_created_by: currentUser?.id || null,
            p_items: itemsPayload,
        });
        if (rpcErr) throw rpcErr;

        const saleId = rpcRows?.[0]?.id;
        const invoiceNo = rpcRows?.[0]?.invoice_no;

        if (posPayType === 'credit' && saleId) {
            const dueDateVal = document.getElementById('posDueDate')?.value || null;
            if (dueDateVal) { try { await sb.from('sales').update({ due_date: dueDateVal }).eq('id', saleId); } catch {} }
        }

        const cust = posCustId ? POS_DB.customers.find(x => x.id === posCustId) : null;
        const paid = posPayType === 'cash' ? (Number(document.getElementById('posCashReceived')?.value) || net) : null;
        if (typeof printThermalReceipt === 'function') {
            await printThermalReceipt('sale', {
                invoiceNo: invoiceNo || saleId,
                customerName: cust?.name || null,
                customerPhone: cust?.phone || null,
                paymentType: posPayType,
                items: posItems.map(it => ({ name: it.name, qty: it.qty, unit_price: it.price, line_total: it.qty * it.price })),
                subtotal, discount, total: net,
                previousBalance: cust?.balance || 0,
                paidAmount: paid,
            });
        }

        // تحديث الـ cache المحلي للمخزون فقط (الخصم الفعلي في قاعدة البيانات بيقوم به الـ trigger تلقائياً)
        posItems.forEach(it => {
            const key = posWarehouseId + '|' + it.pid;
            POS_DB.stockMap[key] = (POS_DB.stockMap[key] || 0) - it.qty;
        });

        posToast('✅ تم إتمام البيع بنجاح', 'success');
        posReset(false);
    } catch (err) {
        posToast('❌ خطأ في إتمام البيع: ' + err.message, 'error');
    }
}

function posReset(confirmFirst) {
    if (confirmFirst && posItems.length && !confirm('بدء فاتورة جديدة؟ سيتم فقدان السلة الحالية.')) return;
    posItems = [];
    posCustId = null;
    document.getElementById('posDiscount') && (document.getElementById('posDiscount').value = 0);
    document.getElementById('posCashReceived') && (document.getElementById('posCashReceived').value = '');
    document.getElementById('posCustSelected') && (document.getElementById('posCustSelected').textContent = 'لم يتم اختيار عميل');
    posSetPayType('cash');
    posRenderCart();
    const scan = document.getElementById('posScan');
    if (scan) { scan.value = ''; scan.focus(); }
}

function posToast(msg, type = 'info') {
    if (typeof invToast === 'function') { invToast(msg, type); return; }
    let t = document.getElementById('posToast');
    if (!t) { t = document.createElement('div'); t.id = 'posToast'; t.className = 'inv-toast'; document.body.appendChild(t); }
    t.className = 'inv-toast ' + type;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window._posToastT);
    window._posToastT = setTimeout(() => t.classList.remove('show'), 2600);
}

window.renderPos = renderPos;
