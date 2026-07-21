// ════════════════════════════════════════════════════════════
// inventory.js — عرض المخزون + جرد فعلي (تسوية)
// يصدّر: renderInventory(container)
// ════════════════════════════════════════════════════════════

let invActiveTab = 'view';

async function renderInventory(container) {
    container.innerHTML = `
    <div class="inv-wrap">
        <div class="dash-header">
            <div><h2 class="dash-title">📦 المخزون</h2><p class="dash-sub">عرض أرصدة الأصناف وإجراء جرد فعلي</p></div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:16px">
            <button id="inv-tab-view" class="dash-trend-btn active" style="font-size:13px;padding:8px 16px" onclick="stkCountSwitchTab('view')">📦 عرض المخزون</button>
            <button id="inv-tab-count" class="dash-trend-btn" style="font-size:13px;padding:8px 16px" onclick="stkCountSwitchTab('count')">🧮 جرد فعلي</button>
        </div>
        <div id="inv-tab-content"></div>
    </div>`;
    await invRenderStockView(document.getElementById('inv-tab-content'));
}

function stkCountSwitchTab(tab) {
    invActiveTab = tab;
    document.getElementById('inv-tab-view')?.classList.toggle('active', tab === 'view');
    document.getElementById('inv-tab-count')?.classList.toggle('active', tab === 'count');
    const root = document.getElementById('inv-tab-content');
    if (!root) return;
    if (tab === 'view') invRenderStockView(root);
    else stkCountRenderForm(root);
}

// ════════════════════════════════════════════════════════════
// تبويب 1: عرض المخزون (نفس المنطق القديم بالحرف، بس بيكتب جوه
// عنصر فرعي بدل الـ container الرئيسي عشان شريط التابات يفضل ظاهر)
// ════════════════════════════════════════════════════════════
async function invRenderStockView(root) {
    root.innerHTML = `<div style="text-align:center;padding:40px;color:#64748B"><div style="font-size:32px;margin-bottom:8px">⏳</div>جاري تحميل المخزون...</div>`;
    try {
        const [{ data: stock }, { data: warehouses }, { data: companies }, { data: purchaseItems }, { data: saleItems }] = await Promise.all([
            sb.from('inventory_stock')
                .select('qty, warehouse_id, product_id, products(name, code, unit, purchase_price, reorder_point, company_id, product_categories(name))')
                .order('qty', { ascending: true }),
            sb.from('warehouses').select('id, name, is_main'),
            sb.from('product_companies').select('id, name').order('name'),
            // آخر عملية شراء لكل صنف — تقريب مش تتبع دفعة/شحنة حقيقي (مفيش
            // Lot tracking في النظام)، فلو الشحنة اتخلطت بشحنات بعدين
            // "المباع منذ آخر شراء" بيبقى تراكمي من تاريخ آخر فاتورة شراء بس
            sb.from('purchase_items').select('product_id, qty, purchases!inner(created_at, status)').eq('purchases.status', 'confirmed'),
            sb.from('sale_items').select('product_id, qty, sales!inner(created_at, status)').eq('sales.status', 'confirmed'),
        ]);

        const fmt = (n) => Number(n || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const whMap = {};
        (warehouses || []).forEach(w => whMap[w.id] = w.name);
        const coMap = {};
        (companies || []).forEach(co => coMap[co.id] = co.name);

        // آخر شراء لكل صنف (أحدث تاريخ)
        const lastPurchase = {}; // product_id -> { date, qty }
        (purchaseItems || []).forEach(pi => {
            const d = pi.purchases?.created_at;
            if (!d) return;
            const cur = lastPurchase[pi.product_id];
            if (!cur || d > cur.date) lastPurchase[pi.product_id] = { date: d, qty: Number(pi.qty) || 0 };
        });

        // المباع منذ آخر شراء + المباع في آخر 30 يوم (لمعدل الدوران) + آخر تاريخ بيع (للراكد)
        const soldSinceLastPurchase = {}, sold30d = {}, lastSaleDate = {};
        const THIRTY_DAYS_AGO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        (saleItems || []).forEach(si => {
            const d = si.sales?.created_at;
            if (!d) return;
            const pid = si.product_id, qty = Number(si.qty) || 0;
            if (!lastSaleDate[pid] || d > lastSaleDate[pid]) lastSaleDate[pid] = d;
            if (d >= THIRTY_DAYS_AGO) sold30d[pid] = (sold30d[pid] || 0) + qty;
            const lp = lastPurchase[pid];
            if (lp && d >= lp.date) soldSinceLastPurchase[pid] = (soldSinceLastPurchase[pid] || 0) + qty;
        });

        // راكد = مالوش أي بيع من 15 يوم أو أكتر (أو مالوش بيع خالص)
        const STAGNANT_MS = 15 * 24 * 60 * 60 * 1000;
        const isStagnant = (pid) => {
            const d = lastSaleDate[pid];
            return !d || (Date.now() - new Date(d).getTime()) >= STAGNANT_MS;
        };

        let filterWh = 'all', filterStatus = 'all', filterCo = 'all', search = '';

        const render = () => {
            let rows = (stock || []).filter(s => {
                if (filterWh !== 'all' && s.warehouse_id !== filterWh) return false;
                if (filterCo !== 'all' && s.products?.company_id !== filterCo) return false;
                if (filterStatus === 'low' && s.qty > 10) return false;
                if (filterStatus === 'zero' && s.qty > 0) return false;
                if (filterStatus === 'ok' && s.qty <= 0) return false;
                if (filterStatus === 'stagnant' && !isStagnant(s.product_id)) return false;
                if (search) {
                    const q = search.toLowerCase();
                    const n = (s.products?.name || '').toLowerCase();
                    const c = (s.products?.code || '').toLowerCase();
                    if (!n.includes(q) && !c.includes(q)) return false;
                }
                return true;
            });

            const totalVal = rows.reduce((sum, s) => sum + (s.qty * Number(s.products?.purchase_price || 0)), 0);
            const lowCount = rows.filter(s => s.qty > 0 && s.qty <= 10).length;
            const zeroCount = rows.filter(s => s.qty <= 0).length;
            const stagnantCount = rows.filter(s => isStagnant(s.product_id)).length;

            document.getElementById('inv-tbody').innerHTML = rows.length ? rows.map(s => {
                const qty = Number(s.qty);
                const reorder = Number(s.products?.reorder_point || 0);
                const val = qty * Number(s.products?.purchase_price || 0);
                const status = qty <= 0 ? 'zero' : qty <= 10 ? 'low' : 'ok';
                const statusLabel = { ok: '✅ جيد', low: '⚠️ منخفض', zero: '🔴 نفد' }[status];
                const statusClass = { ok: 'inv-st-ok', low: 'inv-st-low', zero: 'inv-st-zero' }[status];
                const stagnant = isStagnant(s.product_id);
                const lp = lastPurchase[s.product_id];
                const sold30 = sold30d[s.product_id] || 0;
                const turnover = qty > 0 ? (sold30 / qty) : (sold30 > 0 ? Infinity : 0);
                return `<tr>
                    <td><strong>${s.products?.name || '—'}</strong><div style="font-size:11px;color:#94A3B8">${s.products?.product_categories?.name || ''}</div></td>
                    <td style="direction:ltr;text-align:center">${s.products?.code || '—'}</td>
                    <td>${coMap[s.products?.company_id] || '—'}</td>
                    <td>${whMap[s.warehouse_id] || '—'}</td>
                    <td class="inv-qty-cell"><span class="inv-qty ${status === 'zero' ? 'inv-qty-zero' : status === 'low' ? 'inv-qty-low' : ''}">${fmt(qty)}</span> <small>${s.products?.unit || 'وحدة'}</small></td>
                    <td>${reorder > 0 ? fmt(reorder) : '—'}</td>
                    <td style="font-size:12px">${lp ? `${new Date(lp.date).toLocaleDateString('ar-EG')} — ${fmt(lp.qty)}<div style="color:#94A3B8">اتباع منها: ${fmt(soldSinceLastPurchase[s.product_id] || 0)}</div>` : '—'}</td>
                    <td style="font-size:12px;font-weight:700;color:${turnover >= 1 ? '#059669' : turnover > 0 ? '#D97706' : '#94A3B8'}">${turnover === Infinity ? '∞' : fmt(turnover)}</td>
                    <td><span class="${statusClass}">${statusLabel}</span>${stagnant ? '<div style="margin-top:3px"><span style="background:#F3F4F6;color:#6B7280;font-size:10.5px;padding:2px 7px;border-radius:20px;font-weight:700">🐌 راكد</span></div>' : ''}</td>
                    <td class="inv-val-cell">${fmt(val)} ج.م</td>
                </tr>`;
            }).join('') : `<tr><td colspan="9" style="text-align:center;padding:30px;color:#94A3B8">لا توجد نتائج</td></tr>`;

            document.getElementById('inv-total-val').textContent = fmt(totalVal) + ' ج.م';
            document.getElementById('inv-low-count').textContent = lowCount;
            document.getElementById('inv-zero-count').textContent = zeroCount;
            document.getElementById('inv-stagnant-count').textContent = stagnantCount;
            document.getElementById('inv-total-count').textContent = rows.length;
        };

        root.innerHTML = `
            <!-- KPI -->
            <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px">
                <div class="dash-kpi dash-kpi-blue" style="padding:14px">
                    <div class="dash-kpi-icon" style="font-size:20px">📦</div>
                    <div class="dash-kpi-body">
                        <div class="dash-kpi-val" id="inv-total-count" style="font-size:20px">—</div>
                        <div class="dash-kpi-lbl">إجمالي الأصناف</div>
                    </div>
                </div>
                <div class="dash-kpi dash-kpi-gold" style="padding:14px">
                    <div class="dash-kpi-icon" style="font-size:20px">💰</div>
                    <div class="dash-kpi-body">
                        <div class="dash-kpi-val" id="inv-total-val" style="font-size:16px">—</div>
                        <div class="dash-kpi-lbl">قيمة المخزون</div>
                    </div>
                </div>
                <div class="dash-kpi dash-kpi-orange" style="padding:14px">
                    <div class="dash-kpi-icon" style="font-size:20px">⚠️</div>
                    <div class="dash-kpi-body">
                        <div class="dash-kpi-val" id="inv-low-count" style="font-size:20px">—</div>
                        <div class="dash-kpi-lbl">مخزون منخفض</div>
                    </div>
                </div>
                <div class="dash-kpi dash-kpi-red" style="padding:14px">
                    <div class="dash-kpi-icon" style="font-size:20px">🔴</div>
                    <div class="dash-kpi-body">
                        <div class="dash-kpi-val" id="inv-zero-count" style="font-size:20px">—</div>
                        <div class="dash-kpi-lbl">نفد المخزون</div>
                    </div>
                </div>
                <div class="dash-kpi" style="padding:14px">
                    <div class="dash-kpi-icon" style="font-size:20px;background:#F3F4F6">🐌</div>
                    <div class="dash-kpi-body">
                        <div class="dash-kpi-val" id="inv-stagnant-count" style="font-size:20px">—</div>
                        <div class="dash-kpi-lbl">راكد (بدون بيع 15+ يوم)</div>
                    </div>
                </div>
            </div>

            <!-- فلاتر -->
            <div class="dash-card" style="padding:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
                <input type="text" id="inv-search" placeholder="🔍 بحث باسم أو كود..." style="flex:1;min-width:180px;padding:8px 12px;border:1px solid #E2E8F0;border-radius:8px;font-family:Cairo,sans-serif;font-size:13px" oninput="document.getElementById('inv-search')._go()">
                <select id="inv-wh-filter" style="padding:8px 12px;border:1px solid #E2E8F0;border-radius:8px;font-family:Cairo,sans-serif;font-size:13px">
                    <option value="all">كل المخازن</option>
                    ${(warehouses || []).map(w => `<option value="${w.id}">${w.name}${w.is_main ? ' (رئيسي)' : ''}</option>`).join('')}
                </select>
                <select id="inv-co-filter" style="padding:8px 12px;border:1px solid #E2E8F0;border-radius:8px;font-family:Cairo,sans-serif;font-size:13px">
                    <option value="all">كل الشركات</option>
                    ${(companies || []).map(co => `<option value="${co.id}">${co.name}</option>`).join('')}
                </select>
                <select id="inv-status-filter" style="padding:8px 12px;border:1px solid #E2E8F0;border-radius:8px;font-family:Cairo,sans-serif;font-size:13px">
                    <option value="all">كل الحالات</option>
                    <option value="ok">✅ مخزون جيد</option>
                    <option value="low">⚠️ منخفض (أقل من 10)</option>
                    <option value="zero">🔴 نفد</option>
                    <option value="stagnant">🐌 راكد (بدون بيع 15+ يوم)</option>
                </select>
            </div>

            <!-- جدول -->
            <div class="dash-card" style="padding:0;overflow-x:auto">
                <table class="dash-table" style="margin:0;white-space:nowrap">
                    <thead><tr><th>الصنف</th><th>الكود</th><th>الشركة</th><th>المخزن</th><th>الكمية</th><th>حد الطلب</th><th>آخر شراء</th><th>دوران (30 يوم)</th><th>الحالة</th><th>القيمة</th></tr></thead>
                    <tbody id="inv-tbody"><tr><td colspan="10" style="text-align:center;padding:30px;color:#94A3B8">جاري التحميل...</td></tr></tbody>
                </table>
            </div>`;

        const searchEl = document.getElementById('inv-search');
        searchEl._go = () => { search = searchEl.value; render(); };
        document.getElementById('inv-wh-filter').onchange = (e) => { filterWh = e.target.value; render(); };
        document.getElementById('inv-status-filter').onchange = (e) => { filterStatus = e.target.value; render(); };
        render();

    } catch (err) {
        root.innerHTML = `<div class="dash-error"><div style="font-size:32px">⚠️</div><div>خطأ: ${err.message}</div></div>`;
    }
}

// ════════════════════════════════════════════════════════════
// تبويب 2: جرد فعلي (تسوية) — راجع stock_count_reconciliation_migration.sql
// مفيش أي أثر محاسبي هنا، مجرد تصحيح مباشر لكمية inventory_stock +
// سجل تدقيق (system_qty وقت الجرد، الكمية المعدودة، الفرق)
// ════════════════════════════════════════════════════════════
let stkCountWarehouses = [];
let stkCountRows = []; // { product_id, name, code, unit, system_qty }

async function stkCountRenderForm(root) {
    root.innerHTML = `<div style="text-align:center;padding:40px;color:#64748B"><div style="font-size:32px;margin-bottom:8px">⏳</div>جاري تحميل الأصناف...</div>`;
    try {
        if (!stkCountWarehouses.length) {
            const { data } = await sb.from('warehouses').select('id,name,is_main').order('is_main', { ascending: false });
            stkCountWarehouses = data || [];
        }
        const defaultWh = stkCountWarehouses[0]?.id || '';
        await stkCountLoadWarehouse(root, defaultWh);
    } catch (err) {
        root.innerHTML = `<div class="dash-error"><div style="font-size:32px">⚠️</div><div>خطأ: ${err.message}</div></div>`;
    }
}

async function stkCountLoadWarehouse(root, warehouseId) {
    root.innerHTML = `<div style="text-align:center;padding:40px;color:#64748B"><div style="font-size:32px;margin-bottom:8px">⏳</div>جاري تحميل الأصناف...</div>`;
    try {
        const [{ data: products }, { data: stock }] = await Promise.all([
            sb.from('products').select('id,name,code,unit').order('name'),
            sb.from('inventory_stock').select('product_id,qty').eq('warehouse_id', warehouseId),
        ]);
        const stockMap = {};
        (stock || []).forEach(s => stockMap[s.product_id] = Number(s.qty) || 0);
        stkCountRows = (products || []).map(p => ({
            product_id: p.id, name: p.name, code: p.code, unit: p.unit || 'وحدة',
            system_qty: stockMap[p.id] || 0,
        }));
        stkCountRenderTable(root, warehouseId, '');
    } catch (err) {
        root.innerHTML = `<div class="dash-error"><div style="font-size:32px">⚠️</div><div>خطأ: ${err.message}</div></div>`;
    }
}

function stkCountRenderTable(root, warehouseId, search) {
    const q = (search || '').toLowerCase();
    const visibleRows = stkCountRows.filter(r => !q || r.name.toLowerCase().includes(q) || (r.code || '').toLowerCase().includes(q));

    root.innerHTML = `
    <div class="mod-alert-banner info" style="margin-bottom:16px">
        <span>ℹ️</span>
        <span>سجّل الكمية المعدودة فعليًا لكل صنف موجود في المخزن المختار — الأصناف اللي متسجّلش لها كمية هتتجاهل ومخزونها مش هيتأثر.</span>
    </div>
    <div class="dash-card" style="padding:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
        <select id="stk-wh-select" style="padding:8px 12px;border:1px solid #E2E8F0;border-radius:8px;font-family:Cairo,sans-serif;font-size:13px">
            ${stkCountWarehouses.map(w => `<option value="${w.id}" ${w.id === warehouseId ? 'selected' : ''}>${w.name}${w.is_main ? ' (رئيسي)' : ''}</option>`).join('')}
        </select>
        <input type="text" id="stk-search" placeholder="🔍 بحث باسم أو كود..." value="${search || ''}" style="flex:1;min-width:180px;padding:8px 12px;border:1px solid #E2E8F0;border-radius:8px;font-family:Cairo,sans-serif;font-size:13px">
        <span id="stk-counted-badge" style="font-size:12px;color:#64748B;font-weight:700"></span>
    </div>
    <div class="dash-card" style="padding:0;overflow:hidden">
        <table class="dash-table" style="margin:0">
            <thead><tr><th>الصنف</th><th>الكود</th><th>رصيد النظام</th><th>الكمية المعدودة</th><th>الفرق</th></tr></thead>
            <tbody id="stk-tbody">
                ${visibleRows.length ? visibleRows.map(r => `
                <tr>
                    <td><strong>${r.name}</strong></td>
                    <td style="direction:ltr;text-align:center">${r.code || '—'}</td>
                    <td class="dash-muted">${r.system_qty} <small>${r.unit}</small></td>
                    <td><input type="number" step="any" class="stk-count-input" data-pid="${r.product_id}" style="width:100px;padding:6px 8px;border:1px solid #E2E8F0;border-radius:6px;font-family:Cairo,sans-serif" oninput="stkCountUpdateDiff(this)"></td>
                    <td class="stk-diff-cell" data-pid-diff="${r.product_id}">—</td>
                </tr>`).join('') : `<tr><td colspan="5" style="text-align:center;padding:30px;color:#94A3B8">لا توجد نتائج</td></tr>`}
            </tbody>
        </table>
    </div>
    <div style="margin-top:16px">
        <label class="ob-label">ملاحظات (اختياري)</label>
        <textarea id="stk-notes" class="ob-input" style="min-height:60px"></textarea>
    </div>
    <button class="ob-save-btn" style="margin-top:16px" onclick="stkCountConfirm('${warehouseId}')">✅ تأكيد الجرد وتحديث المخزون</button>`;

    document.getElementById('stk-wh-select').onchange = (e) => stkCountLoadWarehouse(root, e.target.value);
    const searchEl = document.getElementById('stk-search');
    let searchTimer = null;
    searchEl.oninput = () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => stkCountRenderTable(root, warehouseId, searchEl.value), 250);
    };
    stkCountUpdateBadge();
}

function stkCountUpdateDiff(inputEl) {
    const pid = inputEl.dataset.pid;
    const row = stkCountRows.find(r => r.product_id === pid);
    const diffCell = document.querySelector(`[data-pid-diff="${pid}"]`);
    if (!row || !diffCell) return;
    if (inputEl.value === '') { diffCell.textContent = '—'; diffCell.style.color = ''; stkCountUpdateBadge(); return; }
    const diff = Number(inputEl.value) - row.system_qty;
    diffCell.textContent = (diff > 0 ? '+' : '') + diff;
    diffCell.style.color = diff > 0 ? '#059669' : diff < 0 ? '#DC2626' : '#94A3B8';
    stkCountUpdateBadge();
}

function stkCountUpdateBadge() {
    const filled = document.querySelectorAll('.stk-count-input').length
        ? [...document.querySelectorAll('.stk-count-input')].filter(i => i.value !== '').length : 0;
    const badge = document.getElementById('stk-counted-badge');
    if (badge) badge.textContent = filled ? `تم إدخال ${filled} صنف` : '';
}

window.stkCountConfirm = async (warehouseId) => {
    const inputs = [...document.querySelectorAll('.stk-count-input')].filter(i => i.value !== '');
    if (!inputs.length) { alert('⚠️ محتاج تدخل الكمية المعدودة لصنف واحد على الأقل'); return; }

    const items = inputs.map(i => {
        const row = stkCountRows.find(r => r.product_id === i.dataset.pid);
        return { product_id: i.dataset.pid, system_qty: row.system_qty, counted_qty: Number(i.value) || 0, unit_name: row.unit };
    });

    if (!confirm(`هيتم تحديث مخزون ${items.length} صنف مباشرة على الكمية اللي دخلتها. متأكد؟`)) return;

    try {
        await sb.rpc('fn_apply_stock_count', {
            p_warehouse_id: warehouseId,
            p_notes: document.getElementById('stk-notes')?.value || null,
            p_created_by: currentUser?.id || null,
            p_items: items,
        });
        alert(`✅ تم تحديث مخزون ${items.length} صنف بنجاح`);
        const root = document.getElementById('inv-tab-content');
        if (root) await stkCountLoadWarehouse(root, warehouseId);
    } catch (err) {
        alert('❌ خطأ أثناء تطبيق الجرد: ' + err.message);
    }
};
