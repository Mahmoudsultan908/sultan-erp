/* ════════════════════════════════════════════════════════════
   مركز قرار الأصناف — item-decision-center.js
   يصدّر: renderItemDecisionCenter(container)

   بيحسب لكل صنف: الهامش، معدل الدوران (شهري)، أيام التصريف،
   الربح، GMROI — وبيصنّفه أوتوماتيك حسب قواعد قابلة للتعديل
   (بتتخزن في app_settings تحت المفتاح item_decision_rules).

   ★ مفيش جدول تاريخي للمخزون في القاعدة (inventory_stock بيحفظ
   الرصيد الحالي بس)، فـ"متوسط المخزون" هنا تقريب = الرصيد الحالي.
   ★ التكلفة/السعر بيتحسبوا من متوسط فعلي مرجّح (sale_items.cost_price_snapshot
   و line_total) خلال الفترة نفسها، مش من سعر الصنف الحالي — عشان
   لو السعر اتغيّر وسط الفترة الهامش يفضل دقيق.
   ★ الدوران بيتطبّع لمعدل شهري (×30/عدد أيام الفترة) عشان يفضل
   قابل للمقارنة بحد "دوران سريع" مهما كانت الفترة المختارة.
   ════════════════════════════════════════════════════════════ */

let idcRules = { min_margin: 0.05, fast_turnover: 6.0, dead_days: 60, min_gmroi: 2.0, period_days: 30 };
let idcMetrics = [];
let idcCompanies = [];
let idcFilter = 'all';
let idcSearch = '';
let idcCompanyId = 'all';
let idcStockFilter = 'all'; // 'all' | 'instock' | 'outstock'
let idcSaveTimer = null;
let idcContainer = null;

function idcFmt(n) {
    if (n === Infinity) return '∞';
    if (n === -Infinity || Number.isNaN(n)) return '—';
    return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function idcPct(n) { return n === Infinity ? '∞' : ((Number(n) || 0) * 100).toFixed(1) + '%'; }

const IDC_CATS = {
    star: { label: '⭐ نجم', color: 'var(--inv-gold)', bg: 'var(--inv-gold-bg)', rec: 'زوّد الكمية، اطلبه دايماً' },
    workhorse: { label: '🔵 حصان شغل', color: '#2563EB', bg: 'rgba(37,99,235,0.12)', rec: 'شغّال ومهم للسيولة، حافظ عليه' },
    lazy: { label: '🟡 كسلان مربح', color: '#B45309', bg: 'var(--inv-gold-bg)', rec: 'قلّل الكمية أو اعمله عرض يحرّكه' },
    burden: { label: '🔴 عبء', color: 'var(--inv-red)', bg: 'var(--inv-red-bg)', rec: 'صفّي المخزون وما ترجعوش تاني' },
};

async function renderItemDecisionCenter(c) {
    idcContainer = c;
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل قواعد التصنيف...</div>';
    try {
        await idcLoadRules();
        await idcLoadAndCompute(c);
    } catch (err) {
        c.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

async function idcLoadRules() {
    const { data } = await sb.from('app_settings').select('value').eq('key', 'item_decision_rules').maybeSingle();
    if (data?.value) idcRules = Object.assign({}, idcRules, data.value);
}

function idcSaveRules() {
    clearTimeout(idcSaveTimer);
    idcSaveTimer = setTimeout(() => {
        sb.from('app_settings').upsert({ key: 'item_decision_rules', value: idcRules, updated_at: new Date().toISOString() }).then(() => {});
    }, 400);
}

async function idcLoadAndCompute(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات الأصناف...</div>';
    const periodDays = idcRules.period_days || 30;
    const since = new Date(Date.now() - periodDays * 86400000).toISOString();

    const [{ data: products }, { data: stock }, { data: saleItems }, { data: companies }] = await Promise.all([
        sb.from('products').select('id,name,code,unit,company_id,purchase_price,wholesale_price,retail_price,is_active,created_at,product_categories(name)').eq('is_active', true).order('name'),
        sb.from('inventory_stock').select('product_id,qty'),
        sb.from('sale_items').select('product_id,qty,unit_price,line_total,cost_price_snapshot,sales!inner(created_at,status)').eq('sales.status', 'confirmed').gte('sales.created_at', since),
        sb.from('product_companies').select('id,name').order('name'),
    ]);
    idcCompanies = companies || [];

    const stockMap = {};
    (stock || []).forEach(r => { stockMap[r.product_id] = (stockMap[r.product_id] || 0) + (Number(r.qty) || 0); });

    const agg = {}; // product_id -> {units, revenue, cost}
    (saleItems || []).forEach(si => {
        const pid = si.product_id, qty = Number(si.qty) || 0;
        if (!pid) return;
        const a = agg[pid] || (agg[pid] = { units: 0, revenue: 0, cost: 0 });
        a.units += qty;
        a.revenue += si.line_total != null ? Number(si.line_total) || 0 : qty * (Number(si.unit_price) || 0);
        a.cost += qty * (Number(si.cost_price_snapshot) || 0);
    });

    const now = Date.now();
    idcMetrics = (products || []).map(p => {
        const a = agg[p.id] || { units: 0, revenue: 0, cost: 0 };
        const current_stock = stockMap[p.id] || 0;
        const avg_stock = current_stock; // تقريب — لا يوجد تاريخ مخزون
        const units_sold = a.units;
        const avg_price = units_sold > 0 ? a.revenue / units_sold : (Number(p.wholesale_price) || Number(p.retail_price) || 0);
        const avg_cost = units_sold > 0 ? a.cost / units_sold : (Number(p.purchase_price) || 0);
        const margin = avg_price > 0 ? (avg_price - avg_cost) / avg_price : 0;
        const turnover_period = avg_stock > 0 ? units_sold / avg_stock : (units_sold > 0 ? Infinity : 0);
        const turnover = turnover_period * (30 / periodDays); // معدّل شهرياً
        const daily_sales = units_sold / periodDays;
        const days_to_clear = daily_sales > 0 ? current_stock / daily_sales : (current_stock > 0 ? Infinity : 0);
        const profit = a.revenue - a.cost;
        const avg_inv_value = avg_cost * avg_stock;
        const gmroi = avg_inv_value > 0 ? profit / avg_inv_value : (profit > 0 ? Infinity : 0);
        const is_new = !!p.created_at && (now - new Date(p.created_at).getTime()) < periodDays * 86400000;
        return {
            id: p.id, name: p.name, code: p.code, unit: p.unit, category: p.product_categories?.name || '', company_id: p.company_id || null,
            current_stock, avg_stock, units_sold, avg_price, avg_cost, margin, turnover, days_to_clear,
            profit, avg_inv_value, gmroi, is_new,
        };
    });

    idcRenderScreen(c);
}

function idcClassify(m) {
    const is_fast = m.turnover >= idcRules.fast_turnover;
    const is_profitable = m.margin >= idcRules.min_margin && m.gmroi >= idcRules.min_gmroi;
    const is_dead = m.days_to_clear > idcRules.dead_days;
    let key;
    if (is_fast && is_profitable) key = 'star';
    else if (is_fast && !is_profitable) key = 'workhorse';
    else if (!is_fast && is_profitable && !is_dead) key = 'lazy';
    else key = 'burden';
    return { key, is_fast, is_profitable, is_dead };
}

function idcRenderScreen(c) {
    const counts = { star: 0, workhorse: 0, lazy: 0, burden: 0 };
    idcMetrics.forEach(m => { counts[idcClassify(m).key]++; });

    c.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;flex-wrap:wrap;gap:10px">
        <div><h2 style="font-size:22px;font-weight:800">🎯 مركز قرار الأصناف</h2>
        <p style="font-size:13px;color:var(--inv-muted);margin-top:4px">تصنيف تلقائي للأصناف حسب الربحية والدوران خلال آخر ${idcRules.period_days} يوم</p></div>
        <div class="mod-form-group" style="margin:0;min-width:160px">
            <label>الفترة</label>
            <select id="idcPeriod" class="mod-form-input" onchange="idcOnPeriodChange(this.value)">
                ${[7, 14, 30, 60, 90].map(d => `<option value="${d}" ${d === idcRules.period_days ? 'selected' : ''}>آخر ${d} يوم</option>`).join('')}
            </select>
        </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px" id="idcCards">
        ${Object.keys(IDC_CATS).map(k => idcCardHTML(k, counts[k])).join('')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 300px;gap:16px;align-items:start" id="idcMainGrid">
        <div class="mod-card" style="padding:0;overflow-x:auto">
            <div style="padding:14px 16px 0;display:flex;gap:10px;flex-wrap:wrap">
                <input type="text" id="idcSearch" class="mod-form-input" style="flex:2;min-width:180px" placeholder="🔍 بحث بالاسم أو الكود..." value="${idcSearch}" oninput="idcOnSearch(this.value)">
                <select id="idcCompanyFilter" class="mod-form-input" style="flex:1;min-width:150px" onchange="idcOnCompanyFilter(this.value)">
                    <option value="all">كل الشركات</option>
                    ${idcCompanies.map(co => `<option value="${co.id}" ${idcCompanyId === co.id ? 'selected' : ''}>${co.name}</option>`).join('')}
                </select>
                <select id="idcStockFilter" class="mod-form-input" style="flex:1;min-width:150px" onchange="idcOnStockFilter(this.value)">
                    <option value="all" ${idcStockFilter === 'all' ? 'selected' : ''}>كل الأرصدة</option>
                    <option value="instock" ${idcStockFilter === 'instock' ? 'selected' : ''}>فيه رصيد فقط</option>
                    <option value="outstock" ${idcStockFilter === 'outstock' ? 'selected' : ''}>بدون رصيد فقط</option>
                </select>
            </div>
            <div id="idcTableWrap"></div>
        </div>

        <div class="mod-card">
            <h3 style="font-size:15px;font-weight:800;margin-bottom:14px">⚙️ قواعد التصنيف</h3>
            ${idcSliderHTML('min_margin', 'الحد الأدنى للهامش', idcRules.min_margin * 100, 0, 60, 1, '%')}
            ${idcSliderHTML('fast_turnover', 'حد الدوران السريع (شهري)', idcRules.fast_turnover, 0, 20, 0.5, '')}
            ${idcSliderHTML('dead_days', 'حد الركود (يوم)', idcRules.dead_days, 5, 180, 5, '')}
            ${idcSliderHTML('min_gmroi', 'الحد الأدنى لـ GMROI', idcRules.min_gmroi, 0, 10, 0.1, '')}
            <button class="mod-btn mod-btn-primary" style="width:100%;margin-top:6px" onclick="idcSmartSuggest()">✨ اقتراح ذكي</button>
        </div>
    </div>

    <div id="idcDetailModal"></div>
    `;
    idcRenderTable();
}

function idcCardHTML(key, count) {
    const cat = IDC_CATS[key];
    const active = idcFilter === key;
    return `<div class="mod-card" style="cursor:pointer;text-align:center;padding:16px;border:2px solid ${active ? cat.color : 'transparent'};background:${cat.bg}" onclick="idcApplyFilter('${key}')">
        <div style="font-size:13px;font-weight:700;color:${cat.color}">${cat.label}</div>
        <div style="font-size:26px;font-weight:900;margin-top:4px;color:${cat.color}">${count}</div>
    </div>`;
}

function idcSliderHTML(key, label, value, min, max, step, suffix) {
    return `<div style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px">
            <span style="color:var(--inv-muted)">${label}</span>
            <strong id="idcVal-${key}">${value}${suffix}</strong>
        </div>
        <input type="range" id="idcSlider-${key}" min="${min}" max="${max}" step="${step}" value="${value}"
            style="width:100%" oninput="idcOnRuleInput('${key}', this.value, '${suffix}')" onchange="idcSaveRules()">
    </div>`;
}

function idcOnRuleInput(key, val, suffix) {
    const v = parseFloat(val) || 0;
    idcRules[key] = suffix === '%' ? v / 100 : v;
    document.getElementById(`idcVal-${key}`).textContent = v + suffix;
    idcRenderTable();
    idcRefreshCards();
}

function idcRefreshCards() {
    const counts = { star: 0, workhorse: 0, lazy: 0, burden: 0 };
    idcMetrics.forEach(m => { counts[idcClassify(m).key]++; });
    const box = document.getElementById('idcCards');
    if (box) box.innerHTML = Object.keys(IDC_CATS).map(k => idcCardHTML(k, counts[k])).join('');
}

function idcApplyFilter(key) {
    idcFilter = idcFilter === key ? 'all' : key;
    idcRefreshCards();
    idcRenderTable();
}

function idcOnSearch(val) {
    idcSearch = val || '';
    idcRenderTable();
}

function idcOnCompanyFilter(val) {
    idcCompanyId = val || 'all';
    idcRenderTable();
}

function idcOnStockFilter(val) {
    idcStockFilter = val || 'all';
    idcRenderTable();
}

async function idcOnPeriodChange(val) {
    idcRules.period_days = parseInt(val) || 30;
    idcSaveRules();
    await idcLoadAndCompute(idcContainer);
}

function idcRenderTable() {
    const wrap = document.getElementById('idcTableWrap');
    if (!wrap) return;
    let rows = idcMetrics.map(m => Object.assign({}, m, { cls: idcClassify(m) }));
    if (idcFilter !== 'all') rows = rows.filter(r => r.cls.key === idcFilter);
    if (idcCompanyId !== 'all') rows = rows.filter(r => r.company_id === idcCompanyId);
    if (idcStockFilter === 'instock') rows = rows.filter(r => r.current_stock > 0);
    else if (idcStockFilter === 'outstock') rows = rows.filter(r => r.current_stock <= 0);
    if (idcSearch) {
        const q = idcSearch.toLowerCase();
        rows = rows.filter(r => (r.name || '').toLowerCase().includes(q) || (r.code || '').toLowerCase().includes(q));
    }
    rows.sort((a, b) => (b.gmroi === Infinity ? 1e18 : b.gmroi) - (a.gmroi === Infinity ? 1e18 : a.gmroi));

    if (!rows.length) {
        wrap.innerHTML = '<div class="empty-state" style="padding:30px"><span>📭</span>لا توجد أصناف مطابقة</div>';
        return;
    }

    wrap.innerHTML = `<div style="padding:6px 16px;font-size:12px;color:var(--inv-muted)">${rows.length} صنف</div>
    <table class="mod-table"><thead><tr>
        <th>الصنف</th><th>الرصيد الحالي</th><th>المباع بالفترة</th>
        <th title="نسبة الربح من سعر البيع = (سعر البيع - التكلفة) ÷ سعر البيع">الهامش</th>
        <th title="كام مرة يتباع رصيد المخزون كامل في الشهر (كلما زاد = أسرع بيعاً)">الدوران/شهر</th>
        <th title="لو استمر معدل البيع الحالي، هياخد كام يوم يخلّص الرصيد الموجود">أيام التصريف</th>
        <th title="العائد على قيمة المخزون = الربح ÷ قيمة المخزون (كلما زاد = المخزون بيرجّع فلوسه أسرع)">GMROI</th>
        <th>القرار</th>
    </tr></thead><tbody>
        ${rows.map(r => `<tr style="cursor:pointer" onclick="idcShowDetail('${r.id}')">
            <td><strong>${r.name}</strong>${r.is_new ? ' <span style="background:var(--inv-green-light);color:var(--inv-green);font-size:10.5px;padding:2px 7px;border-radius:20px;font-weight:700">🆕 جديد</span>' : ''}<div style="font-size:11px;color:var(--inv-muted-light)">${r.code || ''} ${r.category ? '· ' + r.category : ''}</div></td>
            <td style="font-weight:700;color:${r.current_stock <= 0 ? 'var(--inv-red)' : 'var(--inv-text)'}">${idcFmt(r.current_stock)} <small style="color:var(--inv-muted-light);font-weight:400">${r.unit || ''}</small></td>
            <td>${idcFmt(r.units_sold)}</td>
            <td style="color:${r.margin >= idcRules.min_margin ? 'var(--inv-green)' : 'var(--inv-red)'};font-weight:700">${idcPct(r.margin)}</td>
            <td>${idcFmt(r.turnover)}</td>
            <td style="color:${r.days_to_clear > idcRules.dead_days ? 'var(--inv-red)' : 'var(--inv-text)'};font-weight:700">${idcFmt(r.days_to_clear)}</td>
            <td style="font-weight:700">${idcFmt(r.gmroi)}</td>
            <td><span style="background:${IDC_CATS[r.cls.key].bg};color:${IDC_CATS[r.cls.key].color};padding:4px 10px;border-radius:20px;font-size:12px;font-weight:700">${IDC_CATS[r.cls.key].label}</span></td>
        </tr>`).join('')}
    </tbody></table>`;
}

function idcSmartSuggest() {
    const active = idcMetrics.filter(m => m.units_sold > 0);
    if (!active.length) { alert('مفيش أصناف باعت في الفترة دي لحساب اقتراح منها'); return; }
    const finiteAvg = (arr) => { const f = arr.filter(v => Number.isFinite(v)); return f.length ? f.reduce((s, v) => s + v, 0) / f.length : 0; };
    idcRules.fast_turnover = Math.round(finiteAvg(active.map(m => m.turnover)) * 100) / 100;
    idcRules.min_gmroi = Math.round(finiteAvg(active.map(m => m.gmroi)) * 100) / 100;
    idcSaveRules();
    idcRenderScreen(idcContainer);
}

function idcShowDetail(pid) {
    const m = idcMetrics.find(x => x.id === pid);
    if (!m) return;
    const cls = idcClassify(m);
    const cat = IDC_CATS[cls.key];
    const check = (ok) => ok ? '✅' : '⚠️';
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'idcModal';
    modal.innerHTML = `
    <div class="mod-modal" style="max-width:520px">
        <div class="mod-modal-header"><h3>${m.name}</h3>
            <button class="mod-modal-close" onclick="document.getElementById('idcModal').remove()">&times;</button></div>
        <div class="mod-modal-body">
            <div style="text-align:center;margin-bottom:16px">
                <span style="background:${cat.bg};color:${cat.color};padding:6px 16px;border-radius:20px;font-size:14px;font-weight:800">${cat.label}</span>
                <div style="font-size:13px;color:var(--inv-muted);margin-top:8px">${cat.rec}</div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;margin-bottom:18px">
                <div>الرصيد الحالي: <strong>${idcFmt(m.current_stock)} ${m.unit || ''}</strong></div>
                <div>المباع في الفترة: <strong>${idcFmt(m.units_sold)}</strong></div>
                <div>متوسط سعر البيع: <strong>${idcFmt(m.avg_price)}</strong></div>
                <div>متوسط التكلفة: <strong>${idcFmt(m.avg_cost)}</strong></div>
                <div>الهامش: <strong>${idcPct(m.margin)}</strong></div>
                <div>الدوران الشهري: <strong>${idcFmt(m.turnover)}</strong></div>
                <div>أيام التصريف: <strong>${idcFmt(m.days_to_clear)}</strong></div>
                <div>GMROI: <strong>${idcFmt(m.gmroi)}</strong></div>
                <div>الربح خلال الفترة: <strong>${idcFmt(m.profit)} ج.م</strong></div>
                <div>قيمة المخزون: <strong>${idcFmt(m.avg_inv_value)} ج.م</strong></div>
            </div>
            <h4 style="font-size:13.5px;font-weight:800;margin-bottom:8px">ليه القرار ده؟</h4>
            <div style="font-size:12.5px;line-height:2;color:var(--inv-text-soft)">
                <div>${check(cls.is_fast)} دوران سريع: ${idcFmt(m.turnover)} ${cls.is_fast ? '≥' : '<'} ${idcFmt(idcRules.fast_turnover)}</div>
                <div>${check(m.margin >= idcRules.min_margin)} هامش مقبول: ${idcPct(m.margin)} ${m.margin >= idcRules.min_margin ? '≥' : '<'} ${idcPct(idcRules.min_margin)}</div>
                <div>${check(m.gmroi >= idcRules.min_gmroi)} GMROI مقبول: ${idcFmt(m.gmroi)} ${m.gmroi >= idcRules.min_gmroi ? '≥' : '<'} ${idcFmt(idcRules.min_gmroi)}</div>
                <div>${check(!cls.is_dead)} مش راكد: أيام التصريف ${idcFmt(m.days_to_clear)} ${cls.is_dead ? '>' : '≤'} ${idcFmt(idcRules.dead_days)} يوم</div>
            </div>
        </div>
    </div>`;
    document.body.appendChild(modal);
}

Object.assign(window, {
    renderItemDecisionCenter, idcOnRuleInput, idcSaveRules, idcApplyFilter, idcOnSearch,
    idcOnCompanyFilter, idcOnStockFilter, idcOnPeriodChange, idcSmartSuggest, idcShowDetail,
});
