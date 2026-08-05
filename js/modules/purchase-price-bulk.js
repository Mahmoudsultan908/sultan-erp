/* ════════════════════════════════════════════════════════════
   تعديل الأسعار الجماعية لفاتورة شراء — كل مستويات البيع مرة واحدة
   اختيار فاتورة شراء حديثة ← عرض أصنافها بكل مستويات الأسعار قابلة
   للتعديل ← حفظ الكل دفعة واحدة (UPSERT في product_prices)
   ════════════════════════════════════════════════════════════ */

let _ppbInvoices = [];
let _ppbLevels = [];
let _ppbSelectedInvoice = null;
let _ppbItems = []; // [{product_id, name, code, unit, lastBuyPrice, prices:{levelId: price|''}}]

function ppbFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// ════════════════════════════════════════════════════════════
// 1) التقديم الرئيسي
// ════════════════════════════════════════════════════════════
async function renderPurchasePriceBulk(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل فواتير المشتريات...</div>';
    try {
        const [{ data: invoices, error: invErr }, { data: levels, error: lvlErr }] = await Promise.all([
            sb.from('purchases').select('id, invoice_no, created_at, total, supplier_id, suppliers(name)')
                .order('created_at', { ascending: false }).limit(30),
            sb.from('price_levels').select('*').order('sort_order'),
        ]);
        if (invErr) throw invErr;
        if (lvlErr) throw lvlErr;
        _ppbInvoices = invoices || [];
        _ppbLevels = levels || [];
    } catch (err) {
        c.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
        return;
    }
    _ppbSelectedInvoice = null;
    _ppbItems = [];
    ppbRenderMain(c);
}

function ppbRenderMain(c) {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
            <div><h2 style="font-size:22px;font-weight:800">💲 تعديل الأسعار الجماعية</h2>
            <p style="font-size:13px;color:var(--inv-muted);margin-top:4px">اختر فاتورة شراء حديثة، وعدّل أسعار كل أصنافها بكل مستويات البيع مرة واحدة بدل ما تدوّر على كل صنف لوحده</p></div>
        </div>
        <div id="ppbBody"></div>
    `;
    ppbRenderBody();
}

function ppbRenderBody() {
    const box = document.getElementById('ppbBody');
    if (!box) return;
    box.innerHTML = _ppbSelectedInvoice ? ppbEditTableHTML() : ppbInvoiceListHTML();
}

// ════════════════════════════════════════════════════════════
// 2) قائمة آخر فواتير المشتريات
// ════════════════════════════════════════════════════════════
function ppbInvoiceListHTML() {
    if (!_ppbInvoices.length) return `<div class="empty-state"><span>📥</span>لا توجد فواتير مشتريات بعد.</div>`;
    return `
        <div class="mod-table-wrap">
            <table class="mod-table">
                <thead><tr><th>رقم الفاتورة</th><th>المورّد</th><th>التاريخ</th><th style="text-align:left">الإجمالي</th><th></th></tr></thead>
                <tbody>
                    ${_ppbInvoices.map(inv => `
                    <tr>
                        <td><strong>${inv.invoice_no}</strong></td>
                        <td>${inv.suppliers?.name || '—'}</td>
                        <td>${new Date(inv.created_at).toLocaleDateString('ar-EG')}</td>
                        <td style="text-align:left;font-weight:700;color:var(--inv-green)">${ppbFmt(inv.total)}</td>
                        <td><button class="mod-btn mod-btn-primary" style="padding:5px 14px;font-size:12.5px" onclick="ppbOpenInvoice('${inv.id}')">تعديل الأسعار</button></td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// ════════════════════════════════════════════════════════════
// 3) فتح فاتورة معيّنة — تحميل أصنافها + أسعارها الحالية بكل المستويات
// ════════════════════════════════════════════════════════════
async function ppbOpenInvoice(invoiceId) {
    const box = document.getElementById('ppbBody');
    if (box) box.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل أصناف الفاتورة...</div>';
    try {
        const { data: items, error: itemsErr } = await sb.from('purchase_items')
            .select('product_id, unit_price, products(id, name, code, unit)')
            .eq('purchase_id', invoiceId);
        if (itemsErr) throw itemsErr;

        const productIds = [...new Set((items || []).map(i => i.product_id))];
        const { data: prices, error: pricesErr } = productIds.length
            ? await sb.from('product_prices').select('product_id, price_level_id, price').in('product_id', productIds)
            : { data: [], error: null };
        if (pricesErr) throw pricesErr;

        const priceMap = {};
        (prices || []).forEach(p => { priceMap[p.product_id + '|' + p.price_level_id] = p.price; });

        _ppbItems = (items || [])
            .filter(it => it.product_id)
            .map(it => ({
                product_id: it.product_id,
                name: it.products?.name || '—',
                code: it.products?.code || '',
                unit: it.products?.unit || '',
                lastBuyPrice: it.unit_price,
                prices: Object.fromEntries(_ppbLevels.map(l => [l.id, priceMap[it.product_id + '|' + l.id] ?? ''])),
            }));
        _ppbSelectedInvoice = _ppbInvoices.find(i => i.id === invoiceId) || { id: invoiceId, invoice_no: '' };
    } catch (err) {
        if (box) box.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
        return;
    }
    ppbRenderBody();
}

function ppbBackToList() {
    _ppbSelectedInvoice = null;
    _ppbItems = [];
    ppbRenderBody();
}

// ════════════════════════════════════════════════════════════
// 4) جدول التعديل — صف لكل صنف، عمود لكل مستوى سعر
// ════════════════════════════════════════════════════════════
function ppbEditTableHTML() {
    if (!_ppbItems.length) return `
        <button class="mod-btn" style="padding:5px 14px;font-size:12.5px;margin-bottom:12px" onclick="ppbBackToList()">→ رجوع لقائمة الفواتير</button>
        <div class="empty-state"><span>📭</span>الفاتورة دي مفيهاش أصناف مرتبطة بمنتجات.</div>`;
    return `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
            <button class="mod-btn" style="padding:5px 14px;font-size:12.5px" onclick="ppbBackToList()">→ رجوع لقائمة الفواتير</button>
            <div style="font-size:13px;color:var(--inv-muted)">فاتورة <strong>${_ppbSelectedInvoice.invoice_no || ''}</strong> — ${_ppbItems.length} صنف</div>
        </div>
        <div class="mod-table-wrap">
            <table class="mod-table" id="ppbTable">
                <thead><tr>
                    <th>الصنف</th><th>سعر آخر شراء</th>
                    ${_ppbLevels.map(l => `<th>${l.name}</th>`).join('')}
                </tr></thead>
                <tbody>
                    ${_ppbItems.map(it => `
                    <tr data-pid="${it.product_id}">
                        <td><strong>${it.name}</strong>${it.code ? `<div style="font-size:11px;color:var(--inv-muted-light)">${it.code}</div>` : ''}</td>
                        <td style="color:var(--inv-muted)">${ppbFmt(it.lastBuyPrice)}</td>
                        ${_ppbLevels.map(l => `
                        <td><input type="number" class="mod-form-input" style="margin:0;max-width:100px" min="0" step="0.01"
                            data-level="${l.id}" value="${it.prices[l.id]}" placeholder="—"></td>`).join('')}
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:16px">
            <button class="mod-btn mod-btn-primary" onclick="ppbSaveAll()">💾 حفظ كل الأسعار</button>
        </div>
    `;
}

// ════════════════════════════════════════════════════════════
// 5) الحفظ — UPSERT لكل خانة اتملّت بقيمة (الفاضية بتتجاهل، مش بتتصفّر)
// ════════════════════════════════════════════════════════════
async function ppbSaveAll() {
    const rows = document.querySelectorAll('#ppbTable tbody tr[data-pid]');
    if (!rows.length) return;
    const updates = [];
    rows.forEach(tr => {
        const pid = tr.dataset.pid;
        tr.querySelectorAll('input[data-level]').forEach(inp => {
            if (inp.value === '') return;
            updates.push({ product_id: pid, price_level_id: inp.dataset.level, price: parseFloat(inp.value) || 0 });
        });
    });
    if (!updates.length) { alert('مفيش أسعار متغيّرة للحفظ'); return; }

    const btn = document.querySelector('#ppbBody .mod-btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'جاري الحفظ...'; }
    try {
        const results = await Promise.all(updates.map(u =>
            sb.from('product_prices').upsert(u, { onConflict: 'product_id,price_level_id' })
        ));
        const failed = results.find(r => r.error);
        if (failed) throw failed.error;
        alert(`✅ تم حفظ أسعار ${_ppbItems.length} صنف بنجاح`);
    } catch (err) {
        alert('❌ خطأ أثناء الحفظ: ' + err.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '💾 حفظ كل الأسعار'; }
    }
}
