// ════════════════════════════════════════════════════════════
// inventory.js — عرض المخزون
// يصدّر: renderInventory(container)
// ════════════════════════════════════════════════════════════

async function renderInventory(container) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:#64748B"><div style="font-size:32px;margin-bottom:8px">⏳</div>جاري تحميل المخزون...</div>`;
    try {
        const [{ data: stock }, { data: warehouses }] = await Promise.all([
            sb.from('inventory_stock')
                .select('qty, warehouse_id, product_id, products(name, code, unit, purchase_price, reorder_point, product_categories(name))')
                .order('qty', { ascending: true }),
            sb.from('warehouses').select('id, name, is_main')
        ]);

        const fmt = (n) => Number(n || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const whMap = {};
        (warehouses || []).forEach(w => whMap[w.id] = w.name);

        let filterWh = 'all', filterStatus = 'all', search = '';

        const render = () => {
            let rows = (stock || []).filter(s => {
                if (filterWh !== 'all' && s.warehouse_id !== filterWh) return false;
                if (filterStatus === 'low' && s.qty > 10) return false;
                if (filterStatus === 'zero' && s.qty > 0) return false;
                if (filterStatus === 'ok' && s.qty <= 0) return false;
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

            document.getElementById('inv-tbody').innerHTML = rows.length ? rows.map(s => {
                const qty = Number(s.qty);
                const reorder = Number(s.products?.reorder_point || 0);
                const val = qty * Number(s.products?.purchase_price || 0);
                const status = qty <= 0 ? 'zero' : qty <= 10 ? 'low' : 'ok';
                const statusLabel = { ok: '✅ جيد', low: '⚠️ منخفض', zero: '🔴 نفد' }[status];
                const statusClass = { ok: 'inv-st-ok', low: 'inv-st-low', zero: 'inv-st-zero' }[status];
                return `<tr>
                    <td><strong>${s.products?.name || '—'}</strong><div style="font-size:11px;color:#94A3B8">${s.products?.product_categories?.name || ''}</div></td>
                    <td style="direction:ltr;text-align:center">${s.products?.code || '—'}</td>
                    <td>${whMap[s.warehouse_id] || '—'}</td>
                    <td class="inv-qty-cell"><span class="inv-qty ${status === 'zero' ? 'inv-qty-zero' : status === 'low' ? 'inv-qty-low' : ''}">${fmt(qty)}</span> <small>${s.products?.unit || 'وحدة'}</small></td>
                    <td>${reorder > 0 ? fmt(reorder) : '—'}</td>
                    <td><span class="${statusClass}">${statusLabel}</span></td>
                    <td class="inv-val-cell">${fmt(val)} ج.م</td>
                </tr>`;
            }).join('') : `<tr><td colspan="7" style="text-align:center;padding:30px;color:#94A3B8">لا توجد نتائج</td></tr>`;

            document.getElementById('inv-total-val').textContent = fmt(totalVal) + ' ج.م';
            document.getElementById('inv-low-count').textContent = lowCount;
            document.getElementById('inv-zero-count').textContent = zeroCount;
            document.getElementById('inv-total-count').textContent = rows.length;
        };

        container.innerHTML = `
        <div class="inv-wrap">
            <div class="dash-header">
                <div><h2 class="dash-title">📦 المخزون</h2><p class="dash-sub">عرض أرصدة الأصناف في كل المخازن</p></div>
                <button class="dash-refresh" onclick="renderInventory(document.getElementById('app-content'))">🔄 تحديث</button>
            </div>

            <!-- KPI -->
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
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
            </div>

            <!-- فلاتر -->
            <div class="dash-card" style="padding:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
                <input type="text" id="inv-search" placeholder="🔍 بحث باسم أو كود..." style="flex:1;min-width:180px;padding:8px 12px;border:1px solid #E2E8F0;border-radius:8px;font-family:Cairo,sans-serif;font-size:13px" oninput="document.getElementById('inv-search')._go()">
                <select id="inv-wh-filter" style="padding:8px 12px;border:1px solid #E2E8F0;border-radius:8px;font-family:Cairo,sans-serif;font-size:13px">
                    <option value="all">كل المخازن</option>
                    ${(warehouses || []).map(w => `<option value="${w.id}">${w.name}${w.is_main ? ' (رئيسي)' : ''}</option>`).join('')}
                </select>
                <select id="inv-status-filter" style="padding:8px 12px;border:1px solid #E2E8F0;border-radius:8px;font-family:Cairo,sans-serif;font-size:13px">
                    <option value="all">كل الحالات</option>
                    <option value="ok">✅ مخزون جيد</option>
                    <option value="low">⚠️ منخفض (أقل من 10)</option>
                    <option value="zero">🔴 نفد</option>
                </select>
            </div>

            <!-- جدول -->
            <div class="dash-card" style="padding:0;overflow:hidden">
                <table class="dash-table" style="margin:0">
                    <thead><tr><th>الصنف</th><th>الكود</th><th>المخزن</th><th>الكمية</th><th>حد الطلب</th><th>الحالة</th><th>القيمة</th></tr></thead>
                    <tbody id="inv-tbody"><tr><td colspan="7" style="text-align:center;padding:30px;color:#94A3B8">جاري التحميل...</td></tr></tbody>
                </table>
            </div>
        </div>`;

        const searchEl = document.getElementById('inv-search');
        searchEl._go = () => { search = searchEl.value; render(); };
        document.getElementById('inv-wh-filter').onchange = (e) => { filterWh = e.target.value; render(); };
        document.getElementById('inv-status-filter').onchange = (e) => { filterStatus = e.target.value; render(); };
        render();

    } catch (err) {
        container.innerHTML = `<div class="dash-error"><div style="font-size:32px">⚠️</div><div>خطأ: ${err.message}</div></div>`;
    }
}
