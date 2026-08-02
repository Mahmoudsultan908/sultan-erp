/* ════════════════════════════════════════════════════════════
   مركز قرار المصروفات — expense-decision-center.js
   يصدّر: renderExpenseDecisionCenter(container)

   بيصنّف كل بند مصروف (فئة) حسب محورين: الحجم النسبي (نسبته من
   إجمالي المصروفات في الفترة) × الاتجاه (زاد كام % عن فترة سابقة
   مساوية له في الطول مباشرة قبلها) — بدل الاعتماد على monthly_limit
   اليدوي (موجود في بعض الفئات بس مش كلها)، عشان التصنيف يشتغل حتى
   لو محدش دخل حد شهري لأي بند. monthly_limit (لو موجود) بيتعرض
   كمعلومة إضافية في تفاصيل البند بس، مش جزء من التصنيف.
   ════════════════════════════════════════════════════════════ */

let xdcRules = { min_share: 0.15, growth_threshold: 0.2, period_days: 30 };
let xdcMetrics = [];
let xdcFilter = 'all';
let xdcSearch = '';
let xdcSaveTimer = null;
let xdcContainer = null;

function xdcFmt(n) {
    if (n === Infinity) return '∞';
    if (n === -Infinity || Number.isNaN(n)) return '—';
    return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function xdcPct(n) { return n === Infinity ? '∞' : ((Number(n) || 0) * 100).toFixed(1) + '%'; }

const XDC_CATS = {
    hot: { label: '🔴 كبير وبيكبر', color: 'var(--inv-red)', bg: 'var(--inv-red-bg)', rec: 'أولوية مراجعة فورية — بند كبير أصلاً وبيزيد، في تسرب محتمل' },
    heavy: { label: '🟠 كبير مستقر', color: '#EA580C', bg: 'rgba(234,88,12,0.12)', rec: 'طبيعي طالما تحت السيطرة — بند كبير بس مش بيكبر، راقبه بس' },
    watch: { label: '🟡 صغير وبيكبر بسرعة', color: '#B45309', bg: 'var(--inv-gold-bg)', rec: 'لسه صغير بس الاتجاه خطر — امسكه بدري قبل ما يكبر' },
    small: { label: '🟢 صغير ومستقر', color: 'var(--inv-green)', bg: 'var(--inv-green-light)', rec: 'عادي، مفيش داعي لقلق' },
};

async function renderExpenseDecisionCenter(c) {
    xdcContainer = c;
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل قواعد التصنيف...</div>';
    try {
        await xdcLoadRules();
        await xdcLoadAndCompute(c);
    } catch (err) {
        c.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

async function xdcLoadRules() {
    const { data } = await sb.from('app_settings').select('value').eq('key', 'expense_decision_rules').maybeSingle();
    if (data?.value) xdcRules = Object.assign({}, xdcRules, data.value);
}

function xdcSaveRules() {
    clearTimeout(xdcSaveTimer);
    xdcSaveTimer = setTimeout(() => {
        sb.from('app_settings').upsert({ key: 'expense_decision_rules', value: xdcRules, updated_at: new Date().toISOString() }).then(() => {});
    }, 400);
}

async function xdcLoadAndCompute(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات المصروفات...</div>';
    const periodDays = xdcRules.period_days || 30;
    const now = new Date();
    const periodStartStr = new Date(now - periodDays * 86400000).toISOString().slice(0, 10);
    const prevStartStr = new Date(now - 2 * periodDays * 86400000).toISOString().slice(0, 10);

    const [{ data: categories }, { data: expenses }] = await Promise.all([
        sb.from('expense_categories').select('id,name,monthly_limit').eq('is_active', true).order('name'),
        sb.from('expenses').select('category_id,amount,expense_date').eq('status', 'confirmed').gte('expense_date', prevStartStr),
    ]);

    const curAgg = {}, prevAgg = {};
    (expenses || []).forEach(e => {
        if (!e.category_id) return;
        const amt = Number(e.amount) || 0;
        if (e.expense_date >= periodStartStr) curAgg[e.category_id] = (curAgg[e.category_id] || 0) + amt;
        else prevAgg[e.category_id] = (prevAgg[e.category_id] || 0) + amt;
    });

    const totalCurrent = Object.values(curAgg).reduce((s, v) => s + v, 0);

    xdcMetrics = (categories || []).map(cat => {
        const current = curAgg[cat.id] || 0;
        const previous = prevAgg[cat.id] || 0;
        const share = totalCurrent > 0 ? current / totalCurrent : 0;
        const growth = previous > 0 ? (current - previous) / previous : (current > 0 ? Infinity : 0);
        return {
            id: cat.id, name: cat.name, monthly_limit: Number(cat.monthly_limit) || 0,
            current, previous, share, growth,
        };
    }).filter(m => m.current > 0 || m.previous > 0);

    xdcRenderScreen(c);
}

function xdcClassify(m) {
    const is_high_share = m.share >= xdcRules.min_share;
    const is_growing = m.growth >= xdcRules.growth_threshold;
    let key;
    if (is_high_share && is_growing) key = 'hot';
    else if (is_high_share && !is_growing) key = 'heavy';
    else if (!is_high_share && is_growing) key = 'watch';
    else key = 'small';
    return { key, is_high_share, is_growing };
}

function xdcRenderScreen(c) {
    const counts = { hot: 0, heavy: 0, watch: 0, small: 0 };
    xdcMetrics.forEach(m => { counts[xdcClassify(m).key]++; });

    c.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;flex-wrap:wrap;gap:10px">
        <div><h2 style="font-size:22px;font-weight:800">🎯 مركز قرار المصروفات</h2>
        <p style="font-size:13px;color:var(--inv-muted);margin-top:4px">تصنيف بنود المصروفات حسب الحجم والاتجاه — آخر ${xdcRules.period_days} يوم مقابل نفس المدة قبلها</p></div>
        <div class="mod-form-group" style="margin:0;min-width:160px">
            <label>الفترة</label>
            <select id="xdcPeriod" class="mod-form-input" onchange="xdcOnPeriodChange(this.value)">
                ${[7, 14, 30, 60, 90].map(d => `<option value="${d}" ${d === xdcRules.period_days ? 'selected' : ''}>آخر ${d} يوم</option>`).join('')}
            </select>
        </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px" id="xdcCards">
        ${Object.keys(XDC_CATS).map(k => xdcCardHTML(k, counts[k])).join('')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 300px;gap:16px;align-items:start">
        <div class="mod-card" style="padding:0;overflow-x:auto">
            <div style="padding:14px 16px 0">
                <input type="text" id="xdcSearch" class="mod-form-input" placeholder="🔍 بحث باسم البند..." value="${xdcSearch}" oninput="xdcOnSearch(this.value)">
            </div>
            <div id="xdcTableWrap"></div>
        </div>

        <div class="mod-card">
            <h3 style="font-size:15px;font-weight:800;margin-bottom:14px">⚙️ قواعد التصنيف</h3>
            ${xdcSliderHTML('min_share', 'الحد الأدنى للحجم (نسبة من إجمالي المصروفات)', xdcRules.min_share * 100, 0, 60, 1, '%')}
            ${xdcSliderHTML('growth_threshold', 'حد اعتبار البند "بيكبر"', xdcRules.growth_threshold * 100, 0, 200, 5, '%')}
        </div>
    </div>

    <div id="xdcDetailModal"></div>
    `;
    xdcRenderTable();
}

function xdcCardHTML(key, count) {
    const cat = XDC_CATS[key];
    const active = xdcFilter === key;
    return `<div class="mod-card" style="cursor:pointer;text-align:center;padding:16px;border:2px solid ${active ? cat.color : 'transparent'};background:${cat.bg}" onclick="xdcApplyFilter('${key}')">
        <div style="font-size:13px;font-weight:700;color:${cat.color}">${cat.label}</div>
        <div style="font-size:26px;font-weight:900;margin-top:4px;color:${cat.color}">${count}</div>
    </div>`;
}

function xdcSliderHTML(key, label, value, min, max, step, suffix) {
    return `<div style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px">
            <span style="color:var(--inv-muted)">${label}</span>
            <strong id="xdcVal-${key}">${value}${suffix}</strong>
        </div>
        <input type="range" id="xdcSlider-${key}" min="${min}" max="${max}" step="${step}" value="${value}"
            style="width:100%" oninput="xdcOnRuleInput('${key}', this.value, '${suffix}')" onchange="xdcSaveRules()">
    </div>`;
}

function xdcOnRuleInput(key, val, suffix) {
    const v = parseFloat(val) || 0;
    xdcRules[key] = suffix === '%' ? v / 100 : v;
    document.getElementById(`xdcVal-${key}`).textContent = v + suffix;
    xdcRenderTable();
    xdcRefreshCards();
}

function xdcRefreshCards() {
    const counts = { hot: 0, heavy: 0, watch: 0, small: 0 };
    xdcMetrics.forEach(m => { counts[xdcClassify(m).key]++; });
    const box = document.getElementById('xdcCards');
    if (box) box.innerHTML = Object.keys(XDC_CATS).map(k => xdcCardHTML(k, counts[k])).join('');
}

function xdcApplyFilter(key) {
    xdcFilter = xdcFilter === key ? 'all' : key;
    xdcRefreshCards();
    xdcRenderTable();
}

function xdcOnSearch(val) { xdcSearch = val || ''; xdcRenderTable(); }

async function xdcOnPeriodChange(val) {
    xdcRules.period_days = parseInt(val) || 30;
    xdcSaveRules();
    await xdcLoadAndCompute(xdcContainer);
}

function xdcRenderTable() {
    const wrap = document.getElementById('xdcTableWrap');
    if (!wrap) return;
    let rows = xdcMetrics.map(m => Object.assign({}, m, { cls: xdcClassify(m) }));
    if (xdcFilter !== 'all') rows = rows.filter(r => r.cls.key === xdcFilter);
    if (xdcSearch) {
        const q = xdcSearch.toLowerCase();
        rows = rows.filter(r => (r.name || '').toLowerCase().includes(q));
    }
    rows.sort((a, b) => b.current - a.current);

    if (!rows.length) {
        wrap.innerHTML = '<div class="empty-state" style="padding:30px"><span>📭</span>لا توجد بنود مصروفات في الفترة</div>';
        return;
    }

    wrap.innerHTML = `<div style="padding:6px 16px;font-size:12px;color:var(--inv-muted)">${rows.length} بند</div>
    <table class="mod-table"><thead><tr>
        <th>البند</th><th>مصروفات الفترة</th><th>نسبة من الإجمالي</th>
        <th title="نسبة التغيّر عن نفس المدة السابقة مباشرة">الاتجاه</th>
        <th>القرار</th>
    </tr></thead><tbody>
        ${rows.map(r => `<tr style="cursor:pointer" onclick="xdcShowDetail('${r.id}')">
            <td><strong>${r.name}</strong></td>
            <td style="font-weight:700">${xdcFmt(r.current)}</td>
            <td>${xdcPct(r.share)}</td>
            <td style="color:${r.cls.is_growing ? 'var(--inv-red)' : 'var(--inv-green)'};font-weight:700">${r.growth >= 0 ? '▲' : '▼'} ${xdcPct(Math.abs(r.growth))}</td>
            <td><span style="background:${XDC_CATS[r.cls.key].bg};color:${XDC_CATS[r.cls.key].color};padding:4px 10px;border-radius:20px;font-size:12px;font-weight:700">${XDC_CATS[r.cls.key].label}</span></td>
        </tr>`).join('')}
    </tbody></table>`;
}

function xdcShowDetail(cid) {
    const m = xdcMetrics.find(x => x.id === cid);
    if (!m) return;
    const cls = xdcClassify(m);
    const cat = XDC_CATS[cls.key];
    const check = (ok) => ok ? '✅' : '⚠️';
    const overLimit = m.monthly_limit > 0 && m.current > m.monthly_limit;
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'xdcModal';
    modal.innerHTML = `
    <div class="mod-modal" style="max-width:520px">
        <div class="mod-modal-header"><h3>${m.name}</h3>
            <button class="mod-modal-close" onclick="document.getElementById('xdcModal').remove()">&times;</button></div>
        <div class="mod-modal-body">
            <div style="text-align:center;margin-bottom:16px">
                <span style="background:${cat.bg};color:${cat.color};padding:6px 16px;border-radius:20px;font-size:14px;font-weight:800">${cat.label}</span>
                <div style="font-size:13px;color:var(--inv-muted);margin-top:8px">${cat.rec}</div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;margin-bottom:18px">
                <div>مصروفات الفترة الحالية: <strong>${xdcFmt(m.current)} ج.م</strong></div>
                <div>مصروفات الفترة السابقة: <strong>${xdcFmt(m.previous)} ج.م</strong></div>
                <div>نسبة من إجمالي المصروفات: <strong>${xdcPct(m.share)}</strong></div>
                <div>الاتجاه: <strong>${m.growth >= 0 ? '▲' : '▼'} ${xdcPct(Math.abs(m.growth))}</strong></div>
                ${m.monthly_limit > 0 ? `<div>الحد الشهري المحدد: <strong>${xdcFmt(m.monthly_limit)} ج.م</strong></div>
                <div>الحالة مقابل الحد: <strong style="color:${overLimit ? 'var(--inv-red)' : 'var(--inv-green)'}">${overLimit ? 'تجاوز الحد ⚠️' : 'تحت الحد ✅'}</strong></div>` : `<div style="grid-column:1/-1;color:var(--inv-muted-light)">لا يوجد حد شهري محدد لهذا البند</div>`}
            </div>
            <h4 style="font-size:13.5px;font-weight:800;margin-bottom:8px">ليه القرار ده؟</h4>
            <div style="font-size:12.5px;line-height:2;color:var(--inv-text-soft)">
                <div>${check(cls.is_high_share)} حجم كبير: ${xdcPct(m.share)} ${cls.is_high_share ? '≥' : '<'} ${xdcPct(xdcRules.min_share)} من الإجمالي</div>
                <div>${check(cls.is_growing)} بيكبر: ${xdcPct(m.growth)} ${cls.is_growing ? '≥' : '<'} ${xdcPct(xdcRules.growth_threshold)}</div>
            </div>
        </div>
    </div>`;
    document.body.appendChild(modal);
}

Object.assign(window, {
    renderExpenseDecisionCenter, xdcOnRuleInput, xdcSaveRules, xdcApplyFilter, xdcOnSearch,
    xdcOnPeriodChange, xdcShowDetail,
});
