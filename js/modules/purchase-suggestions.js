/* ════════════════════════════════════════════════════════════
   اقتراح أمر شراء — purchase-suggestions.js
   يصدّر: renderPurchaseSuggestions(container)

   ★ صفحة مستقلة عن شاشة المشتريات وشاشة أوامر الشراء، بس بتحفظ
   نفس شكل بيانات purchase_orders / purchase_order_items بالظبط
   (نفس عداد purchase_order_counter فى app_settings) عشان الأمر
   المحفوظ يظهر ويتحوّل لفاتورة شراء فعلية من شاشة "📋 أوامر الشراء"
   الموجودة من غير أي تعديل هناك.

   الفكرة: تختار "شركة" (product_companies — نفس الشركة اللي بتتحدد
   لكل صنف من شاشة الأصناف)، فتترشّح كل أصنافها ويتحسب لكل صنف:
     - مبيعات الفترة المختارة (الأكثر مبيعاً)
     - متوسط الكمية اللي اتشرت فعلاً فى آخر 5 فواتير شراء سابقة من
       نفس المورد المختار (الأكثر شراءً/تحميلاً)
     - مقارنة بالرصيد الحالي (مجموع كل المخازن) وحد إعادة الطلب
   وبيقترح كمية = احتياج الفترة القادمة ناقص المتاح فعلاً، وبيستبعد
   أي صنف رصيده كافي حالياً.
   ════════════════════════════════════════════════════════════ */

let PSG_DB = { companies: [], products: [], suppliers: [], stockMap: {} };
let psgCompanyId = null;
let psgSupplierId = null;
let psgDays = 30;
let psgRows = [];
let _psgSelected = {}; // {productId: qty} للأصناف المحددة للحفظ

function psgFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function renderPurchaseSuggestions(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل الشركات والأصناف...</div>';
    try {
        const [{ data: companies }, { data: products }, { data: suppliers }, { data: stock }] = await Promise.all([
            sb.from('product_companies').select('*').order('name'),
            sb.from('products').select('id,name,code,unit,company_id,supplier_id,purchase_price,reorder_point').eq('is_active', true).order('name'),
            sb.from('suppliers').select('*').order('name'),
            sb.from('inventory_stock').select('product_id,qty'),
        ]);
        PSG_DB.companies = companies || [];
        PSG_DB.products = products || [];
        PSG_DB.suppliers = suppliers || [];
        PSG_DB.stockMap = {};
        (stock || []).forEach(r => { PSG_DB.stockMap[r.product_id] = (PSG_DB.stockMap[r.product_id] || 0) + (Number(r.qty) || 0); });

        psgCompanyId = PSG_DB.companies[0]?.id || null;
        psgRows = [];
        _psgSelected = {};

        psgRenderScreen(c);
        if (psgCompanyId) await psgRunSuggest();
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function psgGetStock(pid) { return PSG_DB.stockMap[pid] || 0; }

// أكتر مورد متكرر بين أصناف الشركة المختارة — اقتراح أولي قابل للتغيير
function psgDefaultSupplierFor(companyId) {
    const counts = {};
    PSG_DB.products.filter(p => p.company_id === companyId && p.supplier_id).forEach(p => {
        counts[p.supplier_id] = (counts[p.supplier_id] || 0) + 1;
    });
    let best = null, bestCount = 0;
    Object.keys(counts).forEach(sid => { if (counts[sid] > bestCount) { best = sid; bestCount = counts[sid]; } });
    return best;
}

function psgRenderScreen(c) {
    if (!PSG_DB.companies.length) {
        c.innerHTML = `<div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:16px;border-radius:12px">
            ⚠️ لا توجد شركات مضافة بعد. أضف شركة أولاً من شاشة "🗂️ إدارة الأصناف" (قسم الشركة المصنّعة).
        </div>`;
        return;
    }
    if (psgSupplierId == null) psgSupplierId = psgDefaultSupplierFor(psgCompanyId) || '';

    c.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px">
        <div><h2 style="font-size:22px;font-weight:800">💡 اقتراح أمر شراء</h2>
        <p style="font-size:13px;color:#64748B;margin-top:4px">اقتراح تلقائي حسب الأصناف الأكثر مبيعاً والأكثر شراءً لكل شركة، بمقارنة الرصيد الحالي باحتياج الفترة القادمة</p></div>
    </div>

    <div class="mod-card" style="margin-bottom:16px">
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
            <div class="mod-form-group" style="margin:0;min-width:220px">
                <label>الشركة</label>
                <select id="psgCompany" class="mod-form-input" onchange="psgOnCompanyChange(this.value)">
                    ${PSG_DB.companies.map(co => `<option value="${co.id}" ${co.id === psgCompanyId ? 'selected' : ''}>${co.name}</option>`).join('')}
                </select>
            </div>
            <div class="mod-form-group" style="margin:0;min-width:220px">
                <label>المورد (لحساب متوسط الشراء السابق ولحفظ أمر الشراء)</label>
                <select id="psgSupplier" class="mod-form-input" onchange="psgOnSupplierChange(this.value)">
                    <option value="">-- بدون مورد --</option>
                    ${PSG_DB.suppliers.map(s => `<option value="${s.id}" ${s.id === psgSupplierId ? 'selected' : ''}>${s.name}</option>`).join('')}
                </select>
            </div>
            <div class="mod-form-group" style="margin:0;min-width:140px">
                <label>فترة المبيعات</label>
                <select id="psgDays" class="mod-form-input" onchange="psgOnDaysChange(this.value)">
                    <option value="7">آخر 7 أيام</option>
                    <option value="14">آخر 14 يوم</option>
                    <option value="30" selected>آخر 30 يوم</option>
                    <option value="60">آخر 60 يوم</option>
                </select>
            </div>
            <button class="mod-btn mod-btn-primary" onclick="psgRunSuggest()">🔍 احسب الاقتراح</button>
        </div>
    </div>

    <div id="psgResultBox"><div class="empty-state"><span>⏳</span>جاري الحساب...</div></div>
    `;
}

async function psgOnCompanyChange(val) {
    psgCompanyId = val;
    psgSupplierId = psgDefaultSupplierFor(psgCompanyId) || '';
    const sel = document.getElementById('psgSupplier');
    if (sel) sel.value = psgSupplierId;
    await psgRunSuggest();
}

async function psgOnSupplierChange(val) {
    psgSupplierId = val || '';
    await psgRunSuggest();
}

async function psgOnDaysChange(val) {
    psgDays = parseInt(val) || 30;
    await psgRunSuggest();
}

async function psgRunSuggest() {
    const box = document.getElementById('psgResultBox');
    if (!psgCompanyId) return;
    psgDays = parseInt(document.getElementById('psgDays')?.value) || psgDays || 30;
    if (box) box.innerHTML = '<div class="empty-state"><span>⏳</span>جاري الحساب...</div>';
    try {
        const companyProducts = PSG_DB.products.filter(p => p.company_id === psgCompanyId);
        const companyPids = new Set(companyProducts.map(p => p.id));

        const since = new Date(Date.now() - psgDays * 86400000).toISOString();
        const { data: sales } = await sb.from('sales')
            .select('id, sale_items(product_id, qty)')
            .eq('status', 'confirmed').gte('created_at', since);
        const soldMap = {};
        (sales || []).forEach(s => (s.sale_items || []).forEach(it => {
            if (!it.product_id || !companyPids.has(it.product_id)) return;
            soldMap[it.product_id] = (soldMap[it.product_id] || 0) + (Number(it.qty) || 0);
        }));

        let purchaseMap = {}, purchaseCount = 1;
        if (psgSupplierId) {
            const { data: pastPurchases } = await sb.from('purchases')
                .select('id, purchase_items(product_id, qty)')
                .eq('supplier_id', psgSupplierId).eq('status', 'confirmed')
                .order('created_at', { ascending: false }).limit(5);
            purchaseCount = (pastPurchases || []).length || 1;
            (pastPurchases || []).forEach(pu => (pu.purchase_items || []).forEach(it => {
                if (!it.product_id || !companyPids.has(it.product_id)) return;
                purchaseMap[it.product_id] = (purchaseMap[it.product_id] || 0) + (Number(it.qty) || 0);
            }));
        }

        const weeks = Math.max(psgDays / 7, 1);
        psgRows = companyProducts.map(p => {
            const sold = soldMap[p.id] || 0;
            const avgPurchase = (purchaseMap[p.id] || 0) / purchaseCount;
            const stock = psgGetStock(p.id);
            const reorderPoint = Number(p.reorder_point) || 0;
            let needed = Math.max(avgPurchase, sold / weeks);
            let score = sold + avgPurchase * 3;
            let belowReorder = reorderPoint > 0 && stock < reorderPoint;
            if (belowReorder) { needed = Math.max(needed, reorderPoint - stock); score += 1000; }
            let qty = Math.ceil(Math.max(needed - stock, 0));
            return { pid: p.id, name: p.name, code: p.code, unit: p.unit, sold, avgPurchase, stock, reorderPoint, belowReorder, score, qty, price: Number(p.purchase_price) || 0 };
        }).filter(r => r.qty > 0)
          .sort((a, b) => b.score - a.score);

        _psgSelected = {};
        psgRows.forEach(r => { _psgSelected[r.pid] = r.qty; });
        psgRenderResult();
    } catch (err) {
        if (box) box.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:14px;border-radius:10px">خطأ: ${err.message}</div>`;
    }
}

function psgRenderResult() {
    const box = document.getElementById('psgResultBox');
    if (!box) return;
    if (!psgRows.length) {
        box.innerHTML = '<div class="empty-state"><span>✅</span>مفيش أي صنف محتاج تجديد فى هذه الشركة حالياً — الرصيد كافي.</div>';
        return;
    }
    box.innerHTML = `
    <div class="mod-table-wrap">
        <table class="mod-table"><thead><tr>
            <th style="width:30px"></th><th>الصنف</th><th style="width:70px">وحدة</th>
            <th style="width:90px">الرصيد الحالي</th><th style="width:100px">مبيعات ${psgDays} يوم</th>
            <th style="width:110px">متوسط شراء سابق</th><th style="width:100px">الكمية المقترحة</th>
            <th style="width:90px">سعر الشراء</th><th style="width:100px">الإجمالي</th>
        </tr></thead><tbody id="psgRowsBody">
            ${psgRows.map(r => psgRowHTML(r)).join('')}
        </tbody></table>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;flex-wrap:wrap;gap:10px">
        <div class="mod-form-group" style="margin:0">
            <label>تاريخ التوريد المتوقع (اختياري)</label>
            <input type="date" id="psgExpectedDate" class="mod-form-input">
        </div>
        <div style="font-size:17px;font-weight:800" id="psgTotal">الإجمالي: ${psgFmt(psgComputeTotal())} ج.م</div>
        <button class="mod-btn mod-btn-primary" onclick="psgSaveOrder()">💾 حفظ كأمر شراء</button>
    </div>`;
}

function psgRowHTML(r) {
    const sel = _psgSelected[r.pid];
    const checked = sel != null;
    const qty = sel ?? r.qty;
    return `<tr data-pid="${r.pid}">
        <td><input type="checkbox" ${checked ? 'checked' : ''} onchange="psgToggleRow('${r.pid}',this.checked)"></td>
        <td>${r.name} <small style="color:#94A3B8">${r.code || ''}</small>${r.belowReorder ? ' <span style="color:#DC2626;font-size:11px">⚠️ تحت حد الطلب</span>' : ''}</td>
        <td style="text-align:center;font-size:12px;color:#64748B">${r.unit || '—'}</td>
        <td>${psgFmt(r.stock)}</td>
        <td>${psgFmt(r.sold)}</td>
        <td>${psgFmt(r.avgPurchase)}</td>
        <td><input type="number" class="mod-form-input" style="width:80px;padding:5px" value="${qty}" min="0" step="0.01" oninput="psgSetQty('${r.pid}',this.value)"></td>
        <td><input type="number" class="mod-form-input" style="width:80px;padding:5px" value="${r.price}" min="0" step="0.01" oninput="psgSetPrice('${r.pid}',this.value)"></td>
        <td style="font-weight:700" id="psgLine-${r.pid}">${psgFmt((sel ?? r.qty) * r.price)}</td>
    </tr>`;
}

function psgToggleRow(pid, checked) {
    if (checked) { const r = psgRows.find(x => x.pid === pid); _psgSelected[pid] = r ? r.qty : 1; }
    else delete _psgSelected[pid];
    psgUpdateLine(pid);
    psgUpdateTotal();
}

function psgSetQty(pid, val) {
    const q = parseFloat(val) || 0;
    _psgSelected[pid] = q;
    const cb = document.querySelector(`tr[data-pid="${pid}"] input[type=checkbox]`);
    if (cb && !cb.checked && q > 0) cb.checked = true;
    psgUpdateLine(pid);
    psgUpdateTotal();
}

function psgSetPrice(pid, val) {
    const r = psgRows.find(x => x.pid === pid);
    if (r) r.price = parseFloat(val) || 0;
    psgUpdateLine(pid);
    psgUpdateTotal();
}

function psgUpdateLine(pid) {
    const r = psgRows.find(x => x.pid === pid);
    if (!r) return;
    const qty = _psgSelected[pid] || 0;
    const el = document.getElementById('psgLine-' + pid);
    if (el) el.textContent = psgFmt(qty * r.price);
}

function psgComputeTotal() {
    return psgRows.reduce((s, r) => s + ((_psgSelected[r.pid] || 0) * r.price), 0);
}

function psgUpdateTotal() {
    const el = document.getElementById('psgTotal');
    if (el) el.textContent = 'الإجمالي: ' + psgFmt(psgComputeTotal()) + ' ج.م';
}

async function psgSaveOrder() {
    const items = psgRows
        .filter(r => (_psgSelected[r.pid] || 0) > 0)
        .map(r => ({ product_id: r.pid, qty: _psgSelected[r.pid], unit_price: r.price }));
    if (!items.length) { alert('حدد صنفاً واحداً على الأقل بكمية أكبر من صفر'); return; }

    const btn = document.querySelector('#psgResultBox .mod-btn-primary');
    if (btn) { btn.innerText = '⏳ جاري الحفظ...'; btn.disabled = true; }
    try {
        const { data: counterRow } = await sb.from('app_settings').select('value').eq('key', 'purchase_order_counter').maybeSingle();
        const counter = parseInt(counterRow?.value) || 1;
        const order_no = 'PO-' + String(counter).padStart(4, '0');
        const expected_date = document.getElementById('psgExpectedDate')?.value || null;
        const total = items.reduce((s, it) => s + it.qty * it.unit_price, 0);

        const { data: o, error } = await sb.from('purchase_orders').insert({
            order_no, supplier_id: psgSupplierId || null, subtotal: total, total,
            expected_date, status: 'pending', created_by: currentUser?.id || null,
        }).select().single();
        if (error) throw error;

        const itemRows = items.map(it => ({
            order_id: o.id, product_id: it.product_id, qty: it.qty,
            unit_price: it.unit_price, line_total: it.qty * it.unit_price,
        }));
        const { error: itemsErr } = await sb.from('purchase_order_items').insert(itemRows);
        if (itemsErr) { await sb.from('purchase_orders').delete().eq('id', o.id); throw itemsErr; }

        await sb.from('app_settings').upsert({ key: 'purchase_order_counter', value: String(counter + 1), updated_at: new Date().toISOString() });

        alert(`تم حفظ أمر الشراء بنجاح (${order_no}) — يظهر الآن فى شاشة "📋 أوامر الشراء" وتقدر تحوّله لفاتورة شراء فعلية من هناك.`);
        loadMod(document.querySelector('[data-mod="purchase-orders"]'), 'purchase-orders');
    } catch (err) {
        alert('❌ خطأ أثناء الحفظ: ' + err.message);
        if (btn) { btn.innerText = '💾 حفظ كأمر شراء'; btn.disabled = false; }
    }
}

Object.assign(window, {
    renderPurchaseSuggestions,
    psgOnCompanyChange, psgOnSupplierChange, psgOnDaysChange, psgRunSuggest,
    psgToggleRow, psgSetQty, psgSetPrice, psgSaveOrder,
});
