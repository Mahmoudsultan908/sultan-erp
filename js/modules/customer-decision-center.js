/* ════════════════════════════════════════════════════════════
   مركز قرار العملاء — customer-decision-center.js
   يصدّر: renderCustomerDecisionCenter(container)

   محورين زي مركز قرار الأصناف بالظبط: القيمة (الربح اللي العميل
   بيجيبه) × المخاطرة الائتمانية (نسبة الرصيد من الحد + أيام تأخير
   فعلية عن الاستحقاق + علم "موقوف" اليدوي) — بدل محور واحد، عشان
   عميل بيشتري كتير ومنضبط في السداد مختلف تماماً عن عميل بيشتري
   كتير ومتأخر دايماً.

   ★ أيام التأخير الفعلية بتتحسب بـ FIFO تقريبي: الفواتير الآجلة
   (sales.payment_type='credit') مرتبة بتاريخ الاستحقاق، وإجمالي
   المدفوع (customer_payments) بيتخصم منها الأقدم فالأقدم — أول
   فاتورة يفضلها جزء مش متغطى هي "أقدم فاتورة مفتوحة"، وتأخيرها =
   الفرق بين النهاردة وتاريخ استحقاقها. تقريب شائع في تقارير الأعمار
   لما مفيش تخصيص دفعة-لفاتورة حقيقي في النظام، ومش بياخد في الاعتبار
   مرتجعات المبيعات (بتقلل الرصيد فعلياً بس مش داخلة في حساب الـ FIFO
   هنا) — ممكن يخلي التأخير المحسوب أعلى شوية من الواقع لعملاء بيرجعوا كتير.
   ★ الفواتير الآجلة اللي مسجلة قبل إضافة عمود due_date (أو اتسجلت
   من غير تاريخ استحقاق) بيتقدّر تاريخها = تاريخ الفاتورة + 15 يوم.
   ════════════════════════════════════════════════════════════ */

let cdcRules = { min_value: 500, max_risk_utilization: 0.8, overdue_days_risk: 15, inactive_days: 45, period_days: 30 };
let cdcMetrics = [];
let cdcReps = [];
let cdcFilter = 'all';
let cdcSearch = '';
let cdcRepId = 'all';
let cdcBalanceFilter = 'all'; // 'all' | 'withBalance' | 'zero'
let cdcSaveTimer = null;
let cdcContainer = null;

const CDC_DEFAULT_TERM_DAYS = 15;

function cdcFmt(n) {
    if (n === Infinity) return '∞';
    if (n === -Infinity || Number.isNaN(n)) return '—';
    return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function cdcPct(n) { return n === Infinity ? '∞' : ((Number(n) || 0) * 100).toFixed(1) + '%'; }

const CDC_CATS = {
    gold: { label: '🌟 عميل ذهبي', color: 'var(--inv-gold)', bg: 'var(--inv-gold-bg)', rec: 'قيمته عالية ومخاطرته منخفضة — وسّع حد الائتمان له واهتم بيه' },
    watch: { label: '🟠 يستاهل متابعة', color: '#EA580C', bg: 'rgba(234,88,12,0.12)', rec: 'قيمته كبيرة بس قرّب من حد الائتمان أو متأخر — حصّله بانتظام وما توسعش حد الائتمان دلوقتي' },
    normal: { label: '🔵 عادي', color: '#2563EB', bg: 'rgba(37,99,235,0.12)', rec: 'مخاطرة وقيمة منخفضة — تعامل عادي' },
    risk: { label: '🔴 خطر', color: 'var(--inv-red)', bg: 'var(--inv-red-bg)', rec: 'قلل البيع الآجل له أو امنعه لحد ما يسدد' },
};

async function renderCustomerDecisionCenter(c) {
    cdcContainer = c;
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل قواعد التصنيف...</div>';
    try {
        await cdcLoadRules();
        await cdcLoadAndCompute(c);
    } catch (err) {
        c.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

async function cdcLoadRules() {
    const { data } = await sb.from('app_settings').select('value').eq('key', 'customer_decision_rules').maybeSingle();
    if (data?.value) cdcRules = Object.assign({}, cdcRules, data.value);
}

function cdcSaveRules() {
    clearTimeout(cdcSaveTimer);
    cdcSaveTimer = setTimeout(() => {
        sb.from('app_settings').upsert({ key: 'customer_decision_rules', value: cdcRules, updated_at: new Date().toISOString() }).then(() => {});
    }, 400);
}

function cdcEstimateDueDate(createdAt) {
    const d = new Date(createdAt);
    d.setDate(d.getDate() + CDC_DEFAULT_TERM_DAYS);
    return d.toISOString().slice(0, 10);
}

// أقدم فاتورة آجلة لسه مفتوحة (FIFO) — راجع الشرح فوق الملف
function cdcOldestOpenDueDate(creditSales, totalPaid) {
    const sorted = creditSales.slice().sort((a, b) => a._due < b._due ? -1 : (a._due > b._due ? 1 : 0));
    let remaining = totalPaid;
    for (const s of sorted) {
        if (remaining >= s.total - 0.01) remaining -= s.total;
        else return s._due;
    }
    return null;
}

async function cdcLoadAndCompute(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات العملاء...</div>';
    const periodDays = cdcRules.period_days || 30;
    const since = new Date(Date.now() - periodDays * 86400000).toISOString();
    const activitySince = new Date(Date.now() - 400 * 86400000).toISOString();

    const [{ data: customers }, { data: saleItems }, { data: creditSales }, { data: payments }, { data: recentSales }, { data: reps }] = await Promise.all([
        sb.from('customers').select('id,name,code,phone,balance,credit_limit,is_active,debt_locked,primary_rep_id').eq('is_active', true).order('name'),
        sb.from('sale_items').select('qty,unit_price,line_total,cost_price_snapshot,sales!inner(customer_id,created_at,status)').eq('sales.status', 'confirmed').gte('sales.created_at', since),
        sb.from('sales').select('customer_id,total,due_date,created_at').eq('status', 'confirmed').eq('payment_type', 'credit'),
        sb.from('customer_payments').select('customer_id,amount,discount').eq('status', 'confirmed'),
        sb.from('sales').select('customer_id,created_at').eq('status', 'confirmed').gte('created_at', activitySince),
        sb.from('sales_reps').select('id,name').order('name'),
    ]);
    cdcReps = reps || [];

    const profitAgg = {}; // customer_id -> {revenue, cost}
    (saleItems || []).forEach(si => {
        const cid = si.sales?.customer_id;
        if (!cid) return;
        const qty = Number(si.qty) || 0;
        const a = profitAgg[cid] || (profitAgg[cid] = { revenue: 0, cost: 0 });
        a.revenue += si.line_total != null ? Number(si.line_total) || 0 : qty * (Number(si.unit_price) || 0);
        a.cost += qty * (Number(si.cost_price_snapshot) || 0);
    });

    const creditByCust = {}; // customer_id -> [{total, _due}]
    (creditSales || []).forEach(s => {
        if (!s.customer_id) return;
        const list = creditByCust[s.customer_id] || (creditByCust[s.customer_id] = []);
        list.push({ total: Number(s.total) || 0, _due: s.due_date || cdcEstimateDueDate(s.created_at) });
    });

    const paidByCust = {};
    (payments || []).forEach(p => {
        if (!p.customer_id) return;
        paidByCust[p.customer_id] = (paidByCust[p.customer_id] || 0) + (Number(p.amount) || 0) + (Number(p.discount) || 0);
    });

    const lastSaleByCust = {};
    (recentSales || []).forEach(s => {
        if (!s.customer_id) return;
        if (!lastSaleByCust[s.customer_id] || s.created_at > lastSaleByCust[s.customer_id]) lastSaleByCust[s.customer_id] = s.created_at;
    });

    const repMap = {};
    cdcReps.forEach(r => { repMap[r.id] = r.name; });

    const today = new Date();
    cdcMetrics = (customers || []).map(cust => {
        const p = profitAgg[cust.id] || { revenue: 0, cost: 0 };
        const profit = p.revenue - p.cost;
        const balance = Number(cust.balance) || 0;
        const credit_limit = Number(cust.credit_limit) || 0;
        const utilization = credit_limit > 0 ? balance / credit_limit : 0;
        const oldestOpenDue = cdcOldestOpenDueDate(creditByCust[cust.id] || [], paidByCust[cust.id] || 0);
        const days_overdue = oldestOpenDue ? Math.max(0, Math.floor((today - new Date(oldestOpenDue)) / 86400000)) : 0;
        const lastSale = lastSaleByCust[cust.id] || null;
        const is_inactive = !lastSale || (today - new Date(lastSale)) / 86400000 > (cdcRules.inactive_days || 45);
        return {
            id: cust.id, name: cust.name, code: cust.code, phone: cust.phone,
            rep_name: repMap[cust.primary_rep_id] || '', rep_id: cust.primary_rep_id || null,
            balance, credit_limit, utilization, revenue: p.revenue, profit,
            days_overdue, last_sale: lastSale, is_inactive, debt_locked: !!cust.debt_locked,
        };
    });

    cdcRenderScreen(c);
}

function cdcClassify(m) {
    const overUtil = m.credit_limit > 0 && m.utilization >= cdcRules.max_risk_utilization;
    const overdueRisk = m.days_overdue > cdcRules.overdue_days_risk;
    const is_high_risk = m.debt_locked || overUtil || overdueRisk;
    const is_high_value = m.profit >= cdcRules.min_value;
    let key;
    if (is_high_value && !is_high_risk) key = 'gold';
    else if (is_high_value && is_high_risk) key = 'watch';
    else if (!is_high_value && !is_high_risk) key = 'normal';
    else key = 'risk';
    return { key, is_high_value, is_high_risk, overUtil, overdueRisk };
}

function cdcRenderScreen(c) {
    const counts = { gold: 0, watch: 0, normal: 0, risk: 0 };
    cdcMetrics.forEach(m => { counts[cdcClassify(m).key]++; });

    c.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;flex-wrap:wrap;gap:10px">
        <div><h2 style="font-size:22px;font-weight:800">🎯 مركز قرار العملاء</h2>
        <p style="font-size:13px;color:var(--inv-muted);margin-top:4px">تصنيف تلقائي للعملاء حسب القيمة (الربح) والمخاطرة الائتمانية — ربح آخر ${cdcRules.period_days} يوم</p></div>
        <div class="mod-form-group" style="margin:0;min-width:160px">
            <label>فترة حساب الربح</label>
            <select id="cdcPeriod" class="mod-form-input" onchange="cdcOnPeriodChange(this.value)">
                ${[7, 14, 30, 60, 90].map(d => `<option value="${d}" ${d === cdcRules.period_days ? 'selected' : ''}>آخر ${d} يوم</option>`).join('')}
            </select>
        </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px" id="cdcCards">
        ${Object.keys(CDC_CATS).map(k => cdcCardHTML(k, counts[k])).join('')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 300px;gap:16px;align-items:start">
        <div class="mod-card" style="padding:0;overflow-x:auto">
            <div style="padding:14px 16px 0;display:flex;gap:10px;flex-wrap:wrap">
                <input type="text" id="cdcSearch" class="mod-form-input" style="flex:2;min-width:180px" placeholder="🔍 بحث بالاسم أو الكود..." value="${cdcSearch}" oninput="cdcOnSearch(this.value)">
                <select id="cdcRepFilter" class="mod-form-input" style="flex:1;min-width:150px" onchange="cdcOnRepFilter(this.value)">
                    <option value="all">كل المناديب</option>
                    ${cdcReps.map(r => `<option value="${r.id}" ${cdcRepId === r.id ? 'selected' : ''}>${r.name}</option>`).join('')}
                </select>
                <select id="cdcBalanceFilter" class="mod-form-input" style="flex:1;min-width:150px" onchange="cdcOnBalanceFilter(this.value)">
                    <option value="all" ${cdcBalanceFilter === 'all' ? 'selected' : ''}>كل الأرصدة</option>
                    <option value="withBalance" ${cdcBalanceFilter === 'withBalance' ? 'selected' : ''}>عليهم رصيد فقط</option>
                    <option value="zero" ${cdcBalanceFilter === 'zero' ? 'selected' : ''}>رصيدهم صفر</option>
                </select>
            </div>
            <div id="cdcTableWrap"></div>
        </div>

        <div class="mod-card">
            <h3 style="font-size:15px;font-weight:800;margin-bottom:14px">⚙️ قواعد التصنيف</h3>
            ${cdcSliderHTML('min_value', 'الحد الأدنى للربح (عميل عالي القيمة)', cdcRules.min_value, 0, 10000, 100, ' ج.م')}
            ${cdcSliderHTML('max_risk_utilization', 'أقصى نسبة استخدام لحد الائتمان', cdcRules.max_risk_utilization * 100, 0, 100, 5, '%')}
            ${cdcSliderHTML('overdue_days_risk', 'حد التأخير عن الاستحقاق (يوم)', cdcRules.overdue_days_risk, 0, 90, 1, '')}
            ${cdcSliderHTML('inactive_days', 'حد "نايم" (يوم بدون شراء)', cdcRules.inactive_days, 5, 180, 5, '')}
            <button class="mod-btn mod-btn-primary" style="width:100%;margin-top:6px" onclick="cdcSmartSuggest()">✨ اقتراح ذكي</button>
        </div>
    </div>

    <div id="cdcDetailModal"></div>
    `;
    cdcRenderTable();
}

function cdcCardHTML(key, count) {
    const cat = CDC_CATS[key];
    const active = cdcFilter === key;
    return `<div class="mod-card" style="cursor:pointer;text-align:center;padding:16px;border:2px solid ${active ? cat.color : 'transparent'};background:${cat.bg}" onclick="cdcApplyFilter('${key}')">
        <div style="font-size:13px;font-weight:700;color:${cat.color}">${cat.label}</div>
        <div style="font-size:26px;font-weight:900;margin-top:4px;color:${cat.color}">${count}</div>
    </div>`;
}

function cdcSliderHTML(key, label, value, min, max, step, suffix) {
    return `<div style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px">
            <span style="color:var(--inv-muted)">${label}</span>
            <strong id="cdcVal-${key}">${value}${suffix}</strong>
        </div>
        <input type="range" id="cdcSlider-${key}" min="${min}" max="${max}" step="${step}" value="${value}"
            style="width:100%" oninput="cdcOnRuleInput('${key}', this.value, '${suffix}')" onchange="cdcSaveRules()">
    </div>`;
}

function cdcOnRuleInput(key, val, suffix) {
    const v = parseFloat(val) || 0;
    cdcRules[key] = suffix === '%' ? v / 100 : v;
    document.getElementById(`cdcVal-${key}`).textContent = v + suffix;
    cdcRenderTable();
    cdcRefreshCards();
}

function cdcRefreshCards() {
    const counts = { gold: 0, watch: 0, normal: 0, risk: 0 };
    cdcMetrics.forEach(m => { counts[cdcClassify(m).key]++; });
    const box = document.getElementById('cdcCards');
    if (box) box.innerHTML = Object.keys(CDC_CATS).map(k => cdcCardHTML(k, counts[k])).join('');
}

function cdcApplyFilter(key) {
    cdcFilter = cdcFilter === key ? 'all' : key;
    cdcRefreshCards();
    cdcRenderTable();
}

function cdcOnSearch(val) { cdcSearch = val || ''; cdcRenderTable(); }
function cdcOnRepFilter(val) { cdcRepId = val || 'all'; cdcRenderTable(); }
function cdcOnBalanceFilter(val) { cdcBalanceFilter = val || 'all'; cdcRenderTable(); }

async function cdcOnPeriodChange(val) {
    cdcRules.period_days = parseInt(val) || 30;
    cdcSaveRules();
    await cdcLoadAndCompute(cdcContainer);
}

function cdcRenderTable() {
    const wrap = document.getElementById('cdcTableWrap');
    if (!wrap) return;
    let rows = cdcMetrics.map(m => Object.assign({}, m, { cls: cdcClassify(m) }));
    if (cdcFilter !== 'all') rows = rows.filter(r => r.cls.key === cdcFilter);
    if (cdcRepId !== 'all') rows = rows.filter(r => r.rep_id === cdcRepId);
    if (cdcBalanceFilter === 'withBalance') rows = rows.filter(r => r.balance > 0);
    else if (cdcBalanceFilter === 'zero') rows = rows.filter(r => r.balance <= 0);
    if (cdcSearch) {
        const q = cdcSearch.toLowerCase();
        rows = rows.filter(r => (r.name || '').toLowerCase().includes(q) || (r.code || '').toLowerCase().includes(q) || (r.phone || '').includes(q));
    }
    rows.sort((a, b) => b.balance - a.balance);

    if (!rows.length) {
        wrap.innerHTML = '<div class="empty-state" style="padding:30px"><span>📭</span>لا توجد عملاء مطابقين</div>';
        return;
    }

    wrap.innerHTML = `<div style="padding:6px 16px;font-size:12px;color:var(--inv-muted)">${rows.length} عميل</div>
    <table class="mod-table"><thead><tr>
        <th>العميل</th><th>الرصيد</th><th>حد الائتمان</th>
        <th title="نسبة الرصيد الحالي من حد الائتمان المسموح">نسبة الاستخدام</th>
        <th title="عدد أيام التأخير عن استحقاق أقدم فاتورة آجلة لسه من غير سداد كامل (تقديري)">تأخير (يوم)</th>
        <th title="الربح من مبيعات العميل خلال الفترة المختارة">الربح بالفترة</th>
        <th>القرار</th>
    </tr></thead><tbody>
        ${rows.map(r => `<tr style="cursor:pointer" onclick="cdcShowDetail('${r.id}')">
            <td><strong>${r.name}</strong>${r.is_inactive ? ' <span style="background:#F3F4F6;color:#6B7280;font-size:10.5px;padding:2px 7px;border-radius:20px;font-weight:700">⚪ نايم</span>' : ''}${r.debt_locked ? ' <span style="background:var(--inv-red-bg);color:var(--inv-red);font-size:10.5px;padding:2px 7px;border-radius:20px;font-weight:700">🔒 موقوف</span>' : ''}<div style="font-size:11px;color:var(--inv-muted-light)">${r.code || ''} ${r.rep_name ? '· ' + r.rep_name : ''}</div></td>
            <td style="font-weight:700">${cdcFmt(r.balance)}</td>
            <td>${r.credit_limit > 0 ? cdcFmt(r.credit_limit) : '—'}</td>
            <td style="color:${r.cls.overUtil ? 'var(--inv-red)' : 'var(--inv-text)'};font-weight:700">${r.credit_limit > 0 ? cdcPct(r.utilization) : '—'}</td>
            <td style="color:${r.cls.overdueRisk ? 'var(--inv-red)' : 'var(--inv-text)'};font-weight:700">${r.days_overdue > 0 ? r.days_overdue : '—'}</td>
            <td style="font-weight:700">${cdcFmt(r.profit)}</td>
            <td><span style="background:${CDC_CATS[r.cls.key].bg};color:${CDC_CATS[r.cls.key].color};padding:4px 10px;border-radius:20px;font-size:12px;font-weight:700">${CDC_CATS[r.cls.key].label}</span></td>
        </tr>`).join('')}
    </tbody></table>`;
}

function cdcSmartSuggest() {
    const active = cdcMetrics.filter(m => m.profit > 0);
    if (!active.length) { alert('مفيش عملاء بربح موجب في الفترة دي لحساب اقتراح منهم'); return; }
    const avg = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
    cdcRules.min_value = Math.round(avg(active.map(m => m.profit)));
    const withLimit = cdcMetrics.filter(m => m.credit_limit > 0);
    if (withLimit.length) cdcRules.max_risk_utilization = Math.round(avg(withLimit.map(m => Math.min(m.utilization, 1))) * 100) / 100;
    cdcSaveRules();
    cdcRenderScreen(cdcContainer);
}

function cdcShowDetail(cid) {
    const m = cdcMetrics.find(x => x.id === cid);
    if (!m) return;
    const cls = cdcClassify(m);
    const cat = CDC_CATS[cls.key];
    const check = (ok) => ok ? '✅' : '⚠️';
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'cdcModal';
    modal.innerHTML = `
    <div class="mod-modal" style="max-width:520px">
        <div class="mod-modal-header"><h3>${m.name}</h3>
            <button class="mod-modal-close" onclick="document.getElementById('cdcModal').remove()">&times;</button></div>
        <div class="mod-modal-body">
            <div style="text-align:center;margin-bottom:16px">
                <span style="background:${cat.bg};color:${cat.color};padding:6px 16px;border-radius:20px;font-size:14px;font-weight:800">${cat.label}</span>
                <div style="font-size:13px;color:var(--inv-muted);margin-top:8px">${cat.rec}</div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;margin-bottom:18px">
                <div>الرصيد الحالي: <strong>${cdcFmt(m.balance)} ج.م</strong></div>
                <div>حد الائتمان: <strong>${m.credit_limit > 0 ? cdcFmt(m.credit_limit) + ' ج.م' : 'غير محدد'}</strong></div>
                <div>نسبة الاستخدام: <strong>${m.credit_limit > 0 ? cdcPct(m.utilization) : '—'}</strong></div>
                <div>تأخير أقدم فاتورة مفتوحة: <strong>${m.days_overdue > 0 ? m.days_overdue + ' يوم' : 'لا يوجد'}</strong></div>
                <div>مبيعات الفترة: <strong>${cdcFmt(m.revenue)} ج.م</strong></div>
                <div>الربح بالفترة: <strong>${cdcFmt(m.profit)} ج.م</strong></div>
                <div>آخر عملية شراء: <strong>${m.last_sale ? new Date(m.last_sale).toLocaleDateString('ar-EG') : 'لا يوجد'}</strong></div>
                <div>موقوف يدوياً: <strong>${m.debt_locked ? 'نعم 🔒' : 'لا'}</strong></div>
            </div>
            <h4 style="font-size:13.5px;font-weight:800;margin-bottom:8px">ليه القرار ده؟</h4>
            <div style="font-size:12.5px;line-height:2;color:var(--inv-text-soft)">
                <div>${check(cls.is_high_value)} قيمة عالية: ربح الفترة ${cdcFmt(m.profit)} ${cls.is_high_value ? '≥' : '<'} ${cdcFmt(cdcRules.min_value)} ج.م</div>
                <div>${check(!cls.overUtil)} نسبة استخدام حد الائتمان: ${m.credit_limit > 0 ? cdcPct(m.utilization) : 'مفيش حد محدد'} ${m.credit_limit > 0 ? (cls.overUtil ? '≥' : '<') + ' ' + cdcPct(cdcRules.max_risk_utilization) : ''}</div>
                <div>${check(!cls.overdueRisk)} التأخير عن الاستحقاق: ${m.days_overdue} يوم ${cls.overdueRisk ? '>' : '≤'} ${cdcRules.overdue_days_risk} يوم</div>
                <div>${check(!m.debt_locked)} مش موقوف يدوياً</div>
            </div>
        </div>
    </div>`;
    document.body.appendChild(modal);
}

Object.assign(window, {
    renderCustomerDecisionCenter, cdcOnRuleInput, cdcSaveRules, cdcApplyFilter, cdcOnSearch,
    cdcOnRepFilter, cdcOnBalanceFilter, cdcOnPeriodChange, cdcSmartSuggest, cdcShowDetail,
});
