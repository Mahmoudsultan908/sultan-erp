/* ════════════════════════════════════════════════════════════
   تقارير المخازن التفصيلية — warehouse-reports.js
   يصدّر: renderWarehouseReports(container)

   تبويبان:
   1) تقييم المخزون بسعر التكلفة — إجمالي القيمة لكل مخزن + أعلى الأصناف قيمة
      (يشمل كل الأصناف حتى لو معطّلة، عشان القيمة المُبلَّغة تكون كاملة ودقيقة)
   2) حركة صنف — كردكس مُعاد بناؤه من مصادر الحركة الفعلية (مفيش جدول
      "حركات مخزون" مخصّص في القاعدة، فبنجمّع من: رصيد افتتاحي
      (opening_balances) + فواتير الشراء + فواتير البيع + المرتجعات،
      بنفس فلسفة كشف حساب العميل في customers.js (إعادة بناء من المصادر
      الأصلية، مش من جدول ledger جاهز).
   ⚠️ تحويلات المخزون (stock-transfer.js) لسه مش متضمّنة في تبويب "حركة
   صنف" هنا. بقى عندها سجل تاريخي فعلي (جدولا stock_transfers/
   stock_transfer_items — راجع stock_transfer_migration.sql)، لكن
   الكردكس المعاد بناؤه في هذا الملف لسه بيجمّع بس من: رصيد افتتاحي +
   فواتير الشراء + فواتير البيع + المرتجعات. ضم مصدر التحويلات هنا
   تحسين منفصل لسه ما اتعملش (يحتاج تعديل window.wrRunMovement تحت
   عشان يضيف صفوف "تحويل وارد/صادر" لكل مخزن من stock_transfer_items).
   ════════════════════════════════════════════════════════════ */

let _wrProducts = [];
let _wrWarehouses = [];
let _wrStock = [];
let _wrTab = 'valuation'; // 'valuation' | 'movement'

function wrFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// ════════════════════════════════════════════════════════════
// 1) التقديم الرئيسي
// ════════════════════════════════════════════════════════════
async function renderWarehouseReports(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات المخازن...</div>';
    try {
        const [{ data: warehouses }, { data: products }, { data: stock }] = await Promise.all([
            sb.from('warehouses').select('id,name,is_main').order('name'),
            sb.from('products').select('id,name,code,unit,purchase_price,is_active').order('name'),
            sb.from('inventory_stock').select('warehouse_id,product_id,qty'),
        ]);
        _wrWarehouses = warehouses || [];
        _wrProducts = products || [];
        _wrStock = stock || [];
        _wrTab = 'valuation';
        wrRenderPage(c);
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

window.wrSwitchTab = function (tab) {
    _wrTab = tab;
    wrRenderPage(document.getElementById('app-content'));
};

function wrRenderPage(c) {
    c.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px">
        <div><h2 style="font-size:22px;font-weight:800">📊 تقارير المخازن التفصيلية</h2>
        <p style="font-size:13px;color:#64748B;margin-top:4px">تقييم المخزون بسعر التكلفة، وحركة كل صنف في كل مخزن</p></div>
    </div>
    <div class="exp-tabs">
        <button class="exp-tab ${_wrTab === 'valuation' ? 'active' : ''}" onclick="wrSwitchTab('valuation')">💰 تقييم المخزون</button>
        <button class="exp-tab ${_wrTab === 'movement' ? 'active' : ''}" onclick="wrSwitchTab('movement')">🔄 حركة صنف</button>
    </div>
    <div id="wr-body"></div>
    `;
    if (_wrTab === 'valuation') wrRenderValuation();
    else wrRenderMovementForm();
}

// ════════════════════════════════════════════════════════════
// 2) تقييم المخزون بسعر التكلفة
// ════════════════════════════════════════════════════════════
function wrRenderValuation() {
    const body = document.getElementById('wr-body');
    if (!body) return;

    const byWh = {};
    _wrStock.forEach(s => {
        const p = _wrProducts.find(x => x.id === s.product_id);
        if (!p) return;
        const qty = Number(s.qty) || 0;
        const val = qty * (Number(p.purchase_price) || 0);
        const wh = byWh[s.warehouse_id] || (byWh[s.warehouse_id] = { itemCount: 0, qtyTotal: 0, value: 0 });
        if (qty > 0) wh.itemCount++;
        wh.qtyTotal += qty;
        wh.value += val;
    });
    const grandTotal = Object.values(byWh).reduce((s, w) => s + w.value, 0);

    const topRows = _wrStock.map(s => {
        const p = _wrProducts.find(x => x.id === s.product_id);
        const wh = _wrWarehouses.find(w => w.id === s.warehouse_id);
        const qty = Number(s.qty) || 0;
        if (!p || qty <= 0) return null;
        const cost = Number(p.purchase_price) || 0;
        return { name: p.name, code: p.code, unit: p.unit, active: p.is_active !== false, whName: wh?.name || '—', qty, cost, value: qty * cost };
    }).filter(Boolean).sort((a, b) => b.value - a.value).slice(0, 15);

    body.innerHTML = `
    <div class="mod-grid" style="margin-bottom:16px">
        <div class="mod-card"><div class="mod-card-icon" style="background:#EFF6FF;color:#2563EB">🏭</div><div class="mod-card-val">${_wrWarehouses.length}</div><div class="mod-card-lbl">عدد المخازن</div></div>
        <div class="mod-card"><div class="mod-card-icon" style="background:#FFFBEB;color:#D97706">📦</div><div class="mod-card-val">${_wrStock.filter(s => Number(s.qty) > 0).length}</div><div class="mod-card-lbl">أرصدة أصناف نشطة</div></div>
        <div class="mod-card"><div class="mod-card-icon" style="background:#D1FAE5;color:#059669">💰</div><div class="mod-card-val">${wrFmt(grandTotal)}</div><div class="mod-card-lbl">قيمة المخزون الإجمالية (تكلفة)</div></div>
    </div>

    <div class="mod-table-wrap">
        <div style="padding:14px 18px 0;font-weight:800;font-size:14px;color:#1E293B">🏭 القيمة حسب المخزن</div>
        <table class="mod-table"><thead><tr>
            <th>المخزن</th><th style="text-align:center">عدد الأصناف</th><th style="text-align:center">إجمالي الكمية</th><th style="text-align:left">قيمة المخزون</th>
        </tr></thead><tbody>
            ${_wrWarehouses.length ? _wrWarehouses.map(w => {
                const agg = byWh[w.id] || { itemCount: 0, qtyTotal: 0, value: 0 };
                return `<tr>
                    <td><strong>${w.name}</strong>${w.is_main ? ' <span style="font-size:11.5px;color:#94A3B8">(رئيسي)</span>' : ''}</td>
                    <td style="text-align:center">${agg.itemCount}</td>
                    <td style="text-align:center">${wrFmt(agg.qtyTotal)}</td>
                    <td style="text-align:left;font-weight:700">${wrFmt(agg.value)}</td>
                </tr>`;
            }).join('') : `<tr><td colspan="4" class="empty-state"><span>🏭</span>لا توجد مخازن</td></tr>`}
        </tbody>
        ${_wrWarehouses.length ? `<tfoot><tr style="background:#F8FAFC;font-weight:800">
            <td colspan="3" style="padding:12px">الإجمالي</td><td style="text-align:left;padding:12px">${wrFmt(grandTotal)}</td>
        </tr></tfoot>` : ''}
        </table>
    </div>

    <div class="mod-table-wrap" style="margin-top:16px">
        <div style="padding:14px 18px 0;font-weight:800;font-size:14px;color:#1E293B">🏆 أعلى 15 صنف قيمة (في كل المخازن)</div>
        <table class="mod-table"><thead><tr>
            <th>الصنف</th><th>المخزن</th><th style="text-align:center">الكمية</th><th style="text-align:left">تكلفة الوحدة</th><th style="text-align:left">القيمة</th>
        </tr></thead><tbody>
            ${topRows.length ? topRows.map(r => `<tr>
                <td><strong>${r.name}</strong>${!r.active ? ' <span style="font-size:11.5px;color:#DC2626">(غير نشط)</span>' : ''}${r.code ? `<div style="font-size:11.5px;color:#94A3B8">${r.code}</div>` : ''}</td>
                <td>${r.whName}</td>
                <td style="text-align:center">${wrFmt(r.qty)} ${r.unit || ''}</td>
                <td style="text-align:left">${wrFmt(r.cost)}</td>
                <td style="text-align:left;font-weight:700;color:#059669">${wrFmt(r.value)}</td>
            </tr>`).join('') : `<tr><td colspan="5" class="empty-state"><span>📦</span>لا توجد أرصدة مخزون بعد</td></tr>`}
        </tbody></table>
    </div>`;
}

// ════════════════════════════════════════════════════════════
// 3) حركة صنف (كردكس مُعاد بناؤه من الفواتير + المرتجعات + الرصيد الافتتاحي)
// ════════════════════════════════════════════════════════════
function wrRenderMovementForm() {
    const body = document.getElementById('wr-body');
    if (!body) return;
    body.innerHTML = `
    <div class="dash-card" style="padding:16px;margin-bottom:16px">
        <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
            <div style="min-width:240px;flex:1"><label class="ob-label">الصنف *</label>
                <select id="wrProduct" class="ob-input" style="margin:0">
                    <option value="">-- اختر صنفاً --</option>
                    ${_wrProducts.map(p => `<option value="${p.id}">${p.name}${p.code ? ' (' + p.code + ')' : ''}${p.is_active === false ? ' — غير نشط' : ''}</option>`).join('')}
                </select></div>
            <div style="min-width:160px"><label class="ob-label">المخزن</label>
                <select id="wrWarehouse" class="ob-input" style="margin:0">
                    <option value="">كل المخازن</option>
                    ${_wrWarehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}
                </select></div>
            <div><label class="ob-label">من تاريخ</label><input type="date" id="wrFrom" class="ob-input" style="margin:0"></div>
            <div><label class="ob-label">إلى تاريخ</label><input type="date" id="wrTo" class="ob-input" style="margin:0"></div>
            <button class="ob-add-btn" onclick="wrRunMovement()">🔍 عرض الحركة</button>
        </div>
    </div>
    <div id="wr-movement-result"></div>`;
}

const WR_TYPE_META = {
    opening:         { icon: '🏁', color: '#64748B', label: 'رصيد افتتاحي' },
    purchase:        { icon: '📥', color: '#059669', label: 'شراء' },
    sale:            { icon: '🛒', color: '#DC2626', label: 'بيع' },
    sale_return:     { icon: '↩️', color: '#059669', label: 'مرتجع بيع' },
    purchase_return: { icon: '↩️', color: '#DC2626', label: 'مرتجع شراء' },
};

window.wrRunMovement = async function () {
    const pid = document.getElementById('wrProduct')?.value;
    const whId = document.getElementById('wrWarehouse')?.value || '';
    const from = document.getElementById('wrFrom')?.value || '';
    const to = document.getElementById('wrTo')?.value || '';
    if (!pid) { alert('اختر صنفاً أولاً'); return; }

    const resultEl = document.getElementById('wr-movement-result');
    resultEl.innerHTML = '<div style="text-align:center;padding:30px;color:#64748B">⏳ جاري تجميع الحركة...</div>';

    try {
        const [
            { data: opening },
            { data: purchaseRows },
            { data: saleRows },
            { data: saleRetRows },
            { data: purRetRows },
            { data: liveStock },
        ] = await Promise.all([
            sb.from('opening_balances').select('qty, warehouse_id, as_of_date').eq('balance_type', 'inventory').eq('product_id', pid),
            sb.from('purchase_items').select('qty, purchases!inner(warehouse_id, invoice_no, created_at, status)').eq('product_id', pid).eq('purchases.status', 'confirmed'),
            sb.from('sale_items').select('qty, free_qty, sales!inner(warehouse_id, invoice_no, created_at, status)').eq('product_id', pid).eq('sales.status', 'confirmed'),
            sb.from('sale_return_items').select('qty, sales_returns!inner(warehouse_id, return_no, created_at, status)').eq('product_id', pid).eq('sales_returns.status', 'confirmed'),
            sb.from('purchase_return_items').select('qty, purchase_returns!inner(warehouse_id, return_no, created_at, status)').eq('product_id', pid).eq('purchase_returns.status', 'confirmed'),
            sb.from('inventory_stock').select('warehouse_id, qty').eq('product_id', pid),
        ]);

        let moves = [];
        (opening || []).forEach(r => moves.push({ date: r.as_of_date, type: 'opening', ref: 'رصيد افتتاحي', warehouse_id: r.warehouse_id, in: Number(r.qty) || 0, out: 0 }));
        (purchaseRows || []).forEach(r => { const d = r.purchases; moves.push({ date: d.created_at, type: 'purchase', ref: 'شراء ' + d.invoice_no, warehouse_id: d.warehouse_id, in: Number(r.qty) || 0, out: 0 }); });
        (saleRows || []).forEach(r => { const d = r.sales; moves.push({ date: d.created_at, type: 'sale', ref: 'بيع ' + d.invoice_no, warehouse_id: d.warehouse_id, in: 0, out: (Number(r.qty) || 0) + (Number(r.free_qty) || 0) }); });
        (saleRetRows || []).forEach(r => { const d = r.sales_returns; moves.push({ date: d.created_at, type: 'sale_return', ref: 'مرتجع بيع ' + d.return_no, warehouse_id: d.warehouse_id, in: Number(r.qty) || 0, out: 0 }); });
        (purRetRows || []).forEach(r => { const d = r.purchase_returns; moves.push({ date: d.created_at, type: 'purchase_return', ref: 'مرتجع شراء ' + d.return_no, warehouse_id: d.warehouse_id, in: 0, out: Number(r.qty) || 0 }); });

        if (whId) moves = moves.filter(m => m.warehouse_id === whId);
        if (from) moves = moves.filter(m => (m.date || '').slice(0, 10) >= from);
        if (to) moves = moves.filter(m => (m.date || '').slice(0, 10) <= to);
        moves.sort((a, b) => new Date(a.date) - new Date(b.date));

        let running = 0;
        moves.forEach(m => { running += m.in - m.out; m.balance = running; });

        const liveTotal = (liveStock || []).filter(s => !whId || s.warehouse_id === whId).reduce((s, r) => s + (Number(r.qty) || 0), 0);
        const prod = _wrProducts.find(p => p.id === pid);
        const wh = whId ? _wrWarehouses.find(w => w.id === whId) : null;
        const filtered = !!(from || to);

        resultEl.innerHTML = `
        <div class="mod-grid" style="margin-bottom:16px">
            <div class="mod-card"><div class="mod-card-icon" style="background:#EFF6FF;color:#2563EB">📦</div><div class="mod-card-val" style="font-size:16px">${prod?.name || '—'}</div><div class="mod-card-lbl">${wh ? wh.name : 'كل المخازن'}</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#FFFBEB;color:#D97706">🔄</div><div class="mod-card-val">${moves.length}</div><div class="mod-card-lbl">عدد الحركات (بالفلتر الحالي)</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#D1FAE5;color:#059669">✅</div><div class="mod-card-val">${wrFmt(liveTotal)}</div><div class="mod-card-lbl">الرصيد الفعلي الحالي (كل الأوقات)</div></div>
        </div>
        <div style="background:#EFF6FF;border:1px solid #BFDBFE;color:#1E40AF;padding:10px 14px;border-radius:8px;font-size:12px;margin-bottom:14px">
            💡 الرصيد التراكمي بالجدول بيعكس حركات الفلتر الحالي بس${filtered ? ' — شيل التاريخ لعرض كل الحركة من البداية' : ''}.
            عمليات "تحويل مخزون" بين المخازن مش متضمّنة هنا حالياً لأن النظام لسه ما بيسجّلش سجل تاريخي لها.
        </div>
        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>التاريخ</th><th>الحركة</th><th>المرجع</th><th>المخزن</th>
                <th style="text-align:left">وارد</th><th style="text-align:left">منصرف</th><th style="text-align:left">الرصيد</th>
            </tr></thead><tbody>
                ${moves.length ? moves.map(m => {
                    const meta = WR_TYPE_META[m.type];
                    return `<tr>
                        <td style="font-size:12px">${new Date(m.date).toLocaleDateString('ar-EG')}</td>
                        <td><span style="color:${meta.color}">${meta.icon}</span> ${meta.label}</td>
                        <td style="font-size:12px">${m.ref}</td>
                        <td style="font-size:12px">${_wrWarehouses.find(w => w.id === m.warehouse_id)?.name || '—'}</td>
                        <td style="text-align:left;font-weight:700;color:#059669">${m.in ? wrFmt(m.in) : '—'}</td>
                        <td style="text-align:left;font-weight:700;color:#DC2626">${m.out ? wrFmt(m.out) : '—'}</td>
                        <td style="text-align:left;font-weight:800">${wrFmt(m.balance)}</td>
                    </tr>`;
                }).join('') : `<tr><td colspan="7" class="empty-state"><span>📭</span>لا توجد حركات لهذا الصنف بالفلتر المختار</td></tr>`}
            </tbody></table>
        </div>`;
    } catch (err) {
        resultEl.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:16px;border-radius:10px">خطأ: ${err.message}</div>`;
    }
};

Object.assign(window, { renderWarehouseReports, wrSwitchTab, wrRunMovement });
