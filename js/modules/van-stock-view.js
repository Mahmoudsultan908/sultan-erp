/* ════════════════════════════════════════════════════════════
   van-stock-view.js — عرض مخزون عربيات المندوبين (van_stock)
   يصدّر: renderVanStockView(container)

   ★ نفس فلسفة تبويب "عرض المخزون" فى inventory.js بالحرف (نفس
   الـ KPI cards ونفس جدول dash-table)، بس مصدر البيانات van_stock
   بدل inventory_stock، مع فلتر إضافي بالمندوب — كل عربية مندوب
   بتتعامل كأنها "مخزن مصغّر" ليها نفس شكل التقرير.
   ════════════════════════════════════════════════════════════ */

async function renderVanStockView(root) {
    root.innerHTML = `<div style="text-align:center;padding:40px;color:#64748B"><div style="font-size:32px;margin-bottom:8px">⏳</div>جاري تحميل مخزون العربيات...</div>`;
    try {
        const [{ data: stock }, { data: reps }] = await Promise.all([
            sb.from('van_stock')
                .select('qty, rep_id, product_id, products(name, code, unit, purchase_price, reorder_point, product_categories(name))')
                .order('qty', { ascending: true }),
            sb.from('sales_reps').select('id, name').eq('is_active', true).order('name'),
        ]);

        const fmt = (n) => Number(n || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const repMap = {};
        (reps || []).forEach(r => repMap[r.id] = r.name);

        let filterRep = 'all', filterStatus = 'all', search = '';

        const render = () => {
            let rows = (stock || []).filter(s => {
                if (Number(s.qty) <= 0 && filterStatus !== 'zero') return false; // صف بدون رصيد فعلي غير مفيد فى العرض العادي
                if (filterRep !== 'all' && s.rep_id !== filterRep) return false;
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
            const zeroCount = (stock || []).filter(s => s.qty <= 0 && (filterRep === 'all' || s.rep_id === filterRep)).length;

            document.getElementById('vrv-tbody').innerHTML = rows.length ? rows.map(s => {
                const qty = Number(s.qty);
                const reorder = Number(s.products?.reorder_point || 0);
                const val = qty * Number(s.products?.purchase_price || 0);
                const status = qty <= 0 ? 'zero' : qty <= 10 ? 'low' : 'ok';
                const statusLabel = { ok: '✅ جيد', low: '⚠️ منخفض', zero: '🔴 فارغ' }[status];
                const statusClass = { ok: 'inv-st-ok', low: 'inv-st-low', zero: 'inv-st-zero' }[status];
                return `<tr>
                    <td><strong>${s.products?.name || '—'}</strong><div style="font-size:11px;color:#94A3B8">${s.products?.product_categories?.name || ''}</div></td>
                    <td style="direction:ltr;text-align:center">${s.products?.code || '—'}</td>
                    <td>🚗 ${repMap[s.rep_id] || '—'}</td>
                    <td class="inv-qty-cell"><span class="inv-qty ${status === 'zero' ? 'inv-qty-zero' : status === 'low' ? 'inv-qty-low' : ''}">${fmt(qty)}</span> <small>${s.products?.unit || 'وحدة'}</small></td>
                    <td>${reorder > 0 ? fmt(reorder) : '—'}</td>
                    <td><span class="${statusClass}">${statusLabel}</span></td>
                    <td class="inv-val-cell">${fmt(val)} ج.م</td>
                </tr>`;
            }).join('') : `<tr><td colspan="7" style="text-align:center;padding:30px;color:#94A3B8">لا توجد نتائج</td></tr>`;

            document.getElementById('vrv-total-val').textContent = fmt(totalVal) + ' ج.م';
            document.getElementById('vrv-low-count').textContent = lowCount;
            document.getElementById('vrv-zero-count').textContent = zeroCount;
            document.getElementById('vrv-total-count').textContent = rows.length;
        };

        root.innerHTML = `
            <!-- KPI -->
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
                <div class="dash-kpi dash-kpi-blue" style="padding:14px">
                    <div class="dash-kpi-icon" style="font-size:20px">🚗</div>
                    <div class="dash-kpi-body">
                        <div class="dash-kpi-val" id="vrv-total-count" style="font-size:20px">—</div>
                        <div class="dash-kpi-lbl">أصناف بالعربيات</div>
                    </div>
                </div>
                <div class="dash-kpi dash-kpi-gold" style="padding:14px">
                    <div class="dash-kpi-icon" style="font-size:20px">💰</div>
                    <div class="dash-kpi-body">
                        <div class="dash-kpi-val" id="vrv-total-val" style="font-size:16px">—</div>
                        <div class="dash-kpi-lbl">قيمة المخزون بالعربيات</div>
                    </div>
                </div>
                <div class="dash-kpi dash-kpi-orange" style="padding:14px">
                    <div class="dash-kpi-icon" style="font-size:20px">⚠️</div>
                    <div class="dash-kpi-body">
                        <div class="dash-kpi-val" id="vrv-low-count" style="font-size:20px">—</div>
                        <div class="dash-kpi-lbl">مخزون منخفض</div>
                    </div>
                </div>
                <div class="dash-kpi dash-kpi-red" style="padding:14px">
                    <div class="dash-kpi-icon" style="font-size:20px">🔴</div>
                    <div class="dash-kpi-body">
                        <div class="dash-kpi-val" id="vrv-zero-count" style="font-size:20px">—</div>
                        <div class="dash-kpi-lbl">أصناف فارغة</div>
                    </div>
                </div>
            </div>

            <!-- فلاتر -->
            <div class="dash-card" style="padding:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
                <input type="text" id="vrv-search" placeholder="🔍 بحث باسم أو كود..." style="flex:1;min-width:180px;padding:8px 12px;border:1px solid #E2E8F0;border-radius:8px;font-family:Cairo,sans-serif;font-size:13px">
                <select id="vrv-rep-filter" style="padding:8px 12px;border:1px solid #E2E8F0;border-radius:8px;font-family:Cairo,sans-serif;font-size:13px">
                    <option value="all">كل المندوبين</option>
                    ${(reps || []).map(r => `<option value="${r.id}">🚗 ${r.name}</option>`).join('')}
                </select>
                <select id="vrv-status-filter" style="padding:8px 12px;border:1px solid #E2E8F0;border-radius:8px;font-family:Cairo,sans-serif;font-size:13px">
                    <option value="all">كل الحالات</option>
                    <option value="ok">✅ مخزون جيد</option>
                    <option value="low">⚠️ منخفض (أقل من 10)</option>
                    <option value="zero">🔴 فارغ</option>
                </select>
            </div>

            <!-- جدول -->
            <div class="dash-card" style="padding:0;overflow:hidden">
                <table class="dash-table" style="margin:0">
                    <thead><tr><th>الصنف</th><th>الكود</th><th>المندوب</th><th>الكمية</th><th>حد الطلب</th><th>الحالة</th><th>القيمة</th></tr></thead>
                    <tbody id="vrv-tbody"><tr><td colspan="7" style="text-align:center;padding:30px;color:#94A3B8">جاري التحميل...</td></tr></tbody>
                </table>
            </div>`;

        document.getElementById('vrv-search').oninput = (e) => { search = e.target.value; render(); };
        document.getElementById('vrv-rep-filter').onchange = (e) => { filterRep = e.target.value; render(); };
        document.getElementById('vrv-status-filter').onchange = (e) => { filterStatus = e.target.value; render(); };
        render();

    } catch (err) {
        root.innerHTML = `<div class="dash-error"><div style="font-size:32px">⚠️</div><div>خطأ: ${err.message}</div></div>`;
    }
}

window.renderVanStockView = renderVanStockView;
