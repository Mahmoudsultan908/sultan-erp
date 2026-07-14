/* ════════════════════════════════════════════════════════════
   تحويل مخزون — شاشة بشكل فاتورة (رأس + بنود متعددة الأصناف)
   يصدّر: renderStockTransfer(container)

   ★ نفس فلسفة شاشة المرتجعات (returns.js): رأس (inv-header) بمعلومات
   عامة (من مخزن / إلى مخزن / تاريخ) + جدول أصناف (inv-table) قابل
   للإضافة/الحذف سطراً بسطر + عمود جانبي (inv-side) للملخص/الحفظ.
   الفرق: تحويل المخزون نقل فيزيائي بحت — بدون عميل/مورد، بدون سعر،
   وبدون أي تأثير مالي (لا قيد محاسبي ولا حركة خزنة).

   الجداول: stock_transfers (رأس) / stock_transfer_items (بنود)
   ⚠️ لازم تشغّل ملف stock_transfer_migration.sql في Supabase أولاً —
   هو اللي بيعمل الجدولين + trigger تحديث inventory_stock تلقائياً.
   قبل هذا التعديل، كانت الشاشة بتعدّل inventory_stock مباشرة من الـ JS
   من غير أي سجل تاريخي (زي ما كان موثّق في تعليق warehouse-reports.js:
   "تحويلات المخزون مش متضمّنة في الحركة حالياً لأنها بترفّع/تنقص
   inventory_stock مباشرة من غير ما تسجّل سجل تاريخي"). دلوقتي بقى
   فيه جدول تاريخي، ونفس فلسفة sales_returns/sale_return_items:
   الواجهة بتعمل INSERT فقط على الرأس ثم البنود، والـ trigger في
   القاعدة هو اللي بيحرّك inventory_stock.
   ════════════════════════════════════════════════════════════ */

let ST_DB = { warehouses: [], products: [], stockMap: {}, list: [] };
let stItems = [];              // { id, productId, qty }
let stFromWarehouseId = null;
let stToWarehouseId = null;
let stTableMissing = false;    // لسه ما شغّلتش stock_transfer_migration.sql

// ════════════════════════════════════════════════════════════
// 0) تحميل البيانات + التقديم الرئيسي
// ════════════════════════════════════════════════════════════
async function renderStockTransfer(container) {
    container.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات المخازن والأصناف...</div>';
    try {
        const [{ data: warehouses }, { data: products }, { data: stock }] = await Promise.all([
            sb.from('warehouses').select('*').order('name'),
            sb.from('products').select('id,name,code,unit').eq('is_active', true).order('name'),
            sb.from('inventory_stock').select('warehouse_id,product_id,qty'),
        ]);
        ST_DB.warehouses = warehouses || [];
        ST_DB.products = products || [];
        ST_DB.stockMap = {};
        (stock || []).forEach(r => { ST_DB.stockMap[r.warehouse_id + '|' + r.product_id] = Number(r.qty) || 0; });

        const mainWh = ST_DB.warehouses.find(w => w.is_main) || ST_DB.warehouses[0];
        const otherWh = ST_DB.warehouses.find(w => w.id !== mainWh?.id) || ST_DB.warehouses[1];
        stFromWarehouseId = mainWh?.id || null;
        stToWarehouseId = otherWh?.id || mainWh?.id || null;
        stItems = [{ id: Date.now() + Math.random(), productId: null, qty: 1 }];

        await stLoadRecent();

        stRenderScreen(container);
    } catch (err) {
        container.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

async function stLoadRecent() {
    stTableMissing = false;
    try {
        const { data, error } = await sb.from('stock_transfers')
            .select('*, from_wh:from_warehouse_id(name), to_wh:to_warehouse_id(name), stock_transfer_items(qty)')
            .order('created_at', { ascending: false }).limit(30);
        if (error) throw error;
        ST_DB.list = data || [];
    } catch (e) {
        stTableMissing = true; // الجدول لسه ما اتعملش في Supabase
        ST_DB.list = [];
    }
}

// ════════════════════════════════════════════════════════════
// 1) قوالب HTML للأقسام (نفس بنية inv-header/inv-main/inv-side بتاعة returns.js)
// ════════════════════════════════════════════════════════════
function stRenderScreen(c) {
    c.innerHTML = `
    <div class="inv-root density-cozy">
        ${stTableMissing ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:9px 16px;border-radius:9px;margin-bottom:8px;font-size:12px">
            ⚠️ <strong>تنبيه:</strong> جدول <code>stock_transfers</code> أو جدول البنود المرتبط به غير مكتمل في قاعدة البيانات بعد.
            شغّل ملف <code>stock_transfer_migration.sql</code> في Supabase أولاً حتى يتسجّل تاريخ التحويلات ويتحرّك المخزون تلقائياً.
        </div>` : ''}
        ${stHeaderHTML()}
        <div class="inv-main">
            <div class="inv-table-col">
                ${stSearchBarHTML()}
                <div class="inv-table-scroll">
                    <table class="inv-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th class="text-r">الصنف</th>
                                <th style="width:70px">وحدة</th>
                                <th style="width:110px">الرصيد بمخزن المصدر</th>
                                <th style="width:110px">الكمية المحوّلة</th>
                                <th style="width:40px"></th>
                            </tr>
                        </thead>
                        <tbody id="stItemsBody"></tbody>
                    </table>
                </div>
                ${stBottomBarHTML()}
            </div>
            <div class="inv-side">
                ${stInfoCardHTML()}
                ${stActionsCardHTML()}
                ${stNotesCardHTML()}
            </div>
        </div>
    </div>
    ${stRecentListHTML()}
    `;
    stRenderItems();
    stUpdateSummary();
}

function stHeaderHTML() {
    return `
    <div class="inv-header">
        <div class="inv-header-brand">
            <div class="ic">🔄</div>
            <div class="ttl">تحويل مخزون<small> نقل فيزيائي بين المخازن — بدون تأثير مالي</small></div>
        </div>

        <input type="date" class="inv-date-input" id="stDate" value="${stToday()}" title="تاريخ التحويل">

        <select class="inv-date-input" id="stFromWarehouse" title="من مخزن" onchange="stOnWarehouseChange()" style="cursor:pointer">
            ${ST_DB.warehouses.map(w => `<option value="${w.id}" ${w.id === stFromWarehouseId ? 'selected' : ''}>📤 من: ${w.name}${w.is_main ? ' (رئيسي)' : ''}</option>`).join('') || '<option value="">لا يوجد مخزن</option>'}
        </select>
        <select class="inv-date-input" id="stToWarehouse" title="إلى مخزن" onchange="stOnWarehouseChange()" style="cursor:pointer">
            ${ST_DB.warehouses.map(w => `<option value="${w.id}" ${w.id === stToWarehouseId ? 'selected' : ''}>📥 إلى: ${w.name}${w.is_main ? ' (رئيسي)' : ''}</option>`).join('') || '<option value="">لا يوجد مخزن</option>'}
        </select>

        <div class="inv-header-spacer"></div>
        <button class="inv-top-btn inv-top-save" onclick="stSave()">💾 حفظ التحويل</button>
        <button class="inv-top-btn inv-top-new" onclick="renderStockTransfer(document.getElementById('app-content'))">➕ جديد</button>
    </div>`;
}

function stSearchBarHTML() {
    return `
    <div class="inv-searchbar">
        <div style="flex:1;color:#CBD5E1;font-size:12.5px">أضف سطراً لكل صنف تريد نقله بين المخزنين، وحدّد الكمية — يمكن تحويل أكثر من صنف في نفس العملية.</div>
        <button class="inv-add-row-btn" onclick="stAddRow()">+ إضافة صنف</button>
    </div>`;
}

function stBottomBarHTML() {
    return `
    <div class="inv-bottombar">
        <span class="bb-stat">الأصناف: <strong id="stItemCount">0</strong></span>
        <span class="bb-stat">إجمالي الكمية المحوّلة: <strong id="stUnitCount">0</strong></span>
    </div>`;
}

function stInfoCardHTML() {
    return `
    <div class="inv-card">
        <div class="inv-card-title">🔄 ملخص التحويل</div>
        <div class="inv-sum-row"><span class="lbl">عدد الأصناف</span><span class="val" id="stSummaryItems">0</span></div>
        <div class="inv-sum-row"><span class="lbl">إجمالي الكمية</span><span class="val" id="stSummaryQty">0.00</span></div>
        <div class="inv-sum-divider"></div>
        <div style="font-size:11.5px;color:var(--inv-muted)">تحويل المخزون لا يخصم أو يزيد من رصيد الخزنة ولا يضيف قيوداً محاسبية — هو مجرد نقل فيزيائي بين مخزنين.</div>
    </div>`;
}

function stActionsCardHTML() {
    return `
    <div class="inv-actions">
        <button class="inv-btn inv-btn-save" onclick="stSave()">💾 حفظ التحويل</button>
    </div>`;
}

function stNotesCardHTML() {
    return `
    <div class="inv-card">
        <div class="inv-card-title">📝 ملاحظات</div>
        <textarea class="inv-notes" id="stNotes" rows="3" placeholder="اختياري — سبب التحويل مثلاً"></textarea>
    </div>`;
}

function stRecentListHTML() {
    const list = ST_DB.list || [];
    return `
    <div class="mod-table-wrap" style="margin-top:16px">
        <div style="padding:14px 18px 0;font-weight:800;font-size:14px;color:#1E293B">📋 آخر التحويلات</div>
        <table class="mod-table"><thead><tr>
            <th>رقم التحويل</th><th>التاريخ</th><th>من</th><th>إلى</th><th>عدد الأصناف</th><th style="text-align:left">إجمالي الكمية</th><th>ملاحظات</th>
        </tr></thead>
        <tbody>
            ${list.length ? list.map(t => {
                const items = t.stock_transfer_items || [];
                const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
                return `<tr>
                    <td><span style="background:#F1F5F9;padding:3px 8px;border-radius:5px;font-size:11px;font-family:monospace">${t.transfer_no || '—'}</span></td>
                    <td>${t.transfer_date ? new Date(t.transfer_date).toLocaleDateString('ar-EG') : '—'}</td>
                    <td>${t.from_wh?.name || '—'}</td>
                    <td>${t.to_wh?.name || '—'}</td>
                    <td>${items.length}</td>
                    <td style="text-align:left;font-weight:700">${stFmt(totalQty)}</td>
                    <td style="color:#64748B">${t.notes || '—'}</td>
                </tr>`;
            }).join('') : `<tr><td colspan="7" class="empty-state"><span>📦</span>لا توجد تحويلات حتى الآن.</td></tr>`}
        </tbody></table>
    </div>`;
}

// ════════════════════════════════════════════════════════════
// 2) عرض سطور الأصناف + الحسابات
// ════════════════════════════════════════════════════════════
function stGetStock(pid) {
    if (!stFromWarehouseId || !pid) return 0;
    return ST_DB.stockMap[stFromWarehouseId + '|' + pid] || 0;
}

function stOnWarehouseChange() {
    const fromSel = document.getElementById('stFromWarehouse');
    const toSel = document.getElementById('stToWarehouse');
    if (fromSel) stFromWarehouseId = fromSel.value;
    if (toSel) stToWarehouseId = toSel.value;
    stRenderItems(); // الرصيد المعروض بيعتمد على مخزن المصدر
}

function stRenderItems() {
    const tbody = document.getElementById('stItemsBody');
    if (!tbody) return;

    if (!stItems.length) {
        tbody.innerHTML = `<tr class="inv-empty-row"><td colspan="6">
            <span class="em-ic">🔄</span>
            أضف صنفاً واحداً على الأقل لنقله بين المخازن، أو اضغط "+ إضافة صنف"
        </td></tr>`;
        return;
    }

    tbody.innerHTML = stItems.map((it, idx) => {
        const stock = stGetStock(it.productId);
        const low = !!it.productId && (it.qty || 0) > stock;
        const p = ST_DB.products.find(x => x.id === it.productId);
        return `<tr class="${low ? 'is-low' : ''}">
            <td class="inv-cell-idx">${idx + 1}</td>
            <td>
                <select class="inv-cell-input is-name" id="stProduct-${idx}" onchange="stOnProductChange(${idx}, this.value)">
                    <option value="">-- اختر الصنف --</option>
                    ${ST_DB.products.map(pr => `<option value="${pr.id}" ${pr.id === it.productId ? 'selected' : ''}>${pr.name}</option>`).join('')}
                </select>
            </td>
            <td style="text-align:center;font-size:12px;color:var(--inv-muted)">${p?.unit || '—'}</td>
            <td class="inv-cell-stock">
                <span class="num ${low ? 'low' : ''}">${it.productId ? stFmt(stock) : '—'}</span>
                ${low ? '<div class="low-lbl">تجاوز الرصيد</div>' : ''}
            </td>
            <td>
                <input type="number" class="inv-cell-input is-num" id="stQty-${idx}" value="${it.qty || ''}" min="0" step="0.01"
                    oninput="stOnQtyInput(${idx}, this.value)">
            </td>
            <td class="inv-cell-del"><button class="inv-del-btn" onclick="stRemoveRow(${idx})">✕</button></td>
        </tr>`;
    }).join('');
}

// تحديث خفيف لخلية الرصيد/التنبيه بدون إعادة رسم الجدول كله — عشان
// إدخال الكمية (input نصي) ما يفقدش الـ focus لو أعدنا رسم الصف كل ضغطة.
function stUpdateRowStockIndicator(idx) {
    const it = stItems[idx];
    if (!it) return;
    const row = document.getElementById('stQty-' + idx)?.closest('tr');
    if (!row) return;
    const stock = stGetStock(it.productId);
    const low = !!it.productId && (it.qty || 0) > stock;
    row.classList.toggle('is-low', low);
    const stockCell = row.querySelector('.inv-cell-stock');
    if (stockCell) {
        stockCell.innerHTML = `<span class="num ${low ? 'low' : ''}">${it.productId ? stFmt(stock) : '—'}</span>${low ? '<div class="low-lbl">تجاوز الرصيد</div>' : ''}`;
    }
}

function stAddRow() {
    stItems.push({ id: Date.now() + Math.random(), productId: null, qty: 1 });
    stRenderItems();
    stUpdateSummary();
    setTimeout(() => document.getElementById('stProduct-' + (stItems.length - 1))?.focus(), 40);
}

function stRemoveRow(idx) {
    stItems.splice(idx, 1);
    stRenderItems();
    stUpdateSummary();
}

function stOnProductChange(idx, val) {
    const it = stItems[idx];
    if (!it) return;
    it.productId = val || null;
    stRenderItems();
    stUpdateSummary();
}

function stOnQtyInput(idx, val) {
    const it = stItems[idx];
    if (!it) return;
    it.qty = parseFloat(val) || 0;
    stUpdateRowStockIndicator(idx);
    stUpdateSummary();
}

function stUpdateSummary() {
    const filled = stItems.filter(it => it.productId && (it.qty || 0) > 0);
    const totalQty = filled.reduce((s, it) => s + (it.qty || 0), 0);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('stItemCount', filled.length);
    set('stUnitCount', stFmt(totalQty));
    set('stSummaryItems', filled.length);
    set('stSummaryQty', stFmt(totalQty));
}

// ════════════════════════════════════════════════════════════
// 3) الحفظ — INSERT فقط على الرأس ثم البنود (الـ Trigger يتكفّل بالمخزون)
// ════════════════════════════════════════════════════════════
window.stSave = async function () {
    const fromId = stFromWarehouseId;
    const toId = stToWarehouseId;
    if (!fromId || !toId) return alert('يرجى اختيار المخزن المصدر والمخزن الهدف');
    if (fromId === toId) return alert('يجب اختيار مخزنين مختلفين');

    const filled = stItems.filter(it => it.productId && (it.qty || 0) > 0);
    if (!filled.length) return alert('أضف صنفاً واحداً على الأقل بكمية أكبر من صفر');

    // تحقق تراكمي: لو نفس الصنف اتكرر في أكتر من سطر، اجمع الكمية قبل مقارنتها بالرصيد المتاح
    const qtyByProduct = {};
    filled.forEach(it => { qtyByProduct[it.productId] = (qtyByProduct[it.productId] || 0) + it.qty; });
    for (const pid in qtyByProduct) {
        const stock = stGetStock(pid);
        if (qtyByProduct[pid] > stock) {
            const name = ST_DB.products.find(p => p.id === pid)?.name || pid;
            return alert(`الكمية المطلوب تحويلها من صنف "${name}" (${stFmt(qtyByProduct[pid])}) أكبر من المتاح في المخزن المصدر (${stFmt(stock)})`);
        }
    }

    const date = document.getElementById('stDate')?.value || stToday();
    const notes = document.getElementById('stNotes')?.value.trim() || null;

    const saveBtns = document.querySelectorAll('.inv-btn-save, .inv-top-save');
    saveBtns.forEach(b => { b.dataset._label = b.dataset._label || b.innerHTML; b.innerHTML = '⏳ جاري النقل...'; b.disabled = true; });

    try {
        const transferNo = 'ST-' + Date.now();
        const { data: rows, error } = await sb.from('stock_transfers').insert({
            transfer_no: transferNo,
            from_warehouse_id: fromId,
            to_warehouse_id: toId,
            transfer_date: date,
            notes,
            created_by: currentUser?.id || null,
        }).select();
        if (error) throw error;
        const transferId = rows[0].id;

        const itemRows = filled.map(it => ({
            transfer_id: transferId,
            product_id: it.productId,
            qty: it.qty,
            unit_name: ST_DB.products.find(p => p.id === it.productId)?.unit || null,
        }));
        const { error: itemsErr } = await sb.from('stock_transfer_items').insert(itemRows);
        if (itemsErr) {
            // تراجع عن الرأس لو فشل إدراج البنود، عشان ما يفضلش سجل تحويل فاضي بلا أصناف
            await sb.from('stock_transfers').delete().eq('id', transferId);
            throw itemsErr;
        }

        alert(`تم تحويل المخزون بنجاح (${transferNo})`);
        renderStockTransfer(document.getElementById('app-content'));
    } catch (err) {
        alert('خطأ أثناء التحويل: ' + err.message + (stTableMissing ? '\n\nتأكد من تشغيل ملف stock_transfer_migration.sql في Supabase.' : ''));
        saveBtns.forEach(b => { b.innerHTML = b.dataset._label; b.disabled = false; });
    }
};

// ════════════════════════════════════════════════════════════
// 4) أدوات مساعدة
// ════════════════════════════════════════════════════════════
function stFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function stToday() { return new Date().toISOString().split('T')[0]; }

Object.assign(window, {
    renderStockTransfer,
    stAddRow, stRemoveRow, stOnProductChange, stOnQtyInput, stOnWarehouseChange, stSave,
});
