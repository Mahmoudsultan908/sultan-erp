/* ════════════════════════════════════════════════════════════
   مركز قرار الموردين — supplier-decision-center.js
   يصدّر: renderSupplierDecisionCenter(container)

   نفس فكرة مركز قرار العملاء بالظبط (محورين: القيمة × المخاطرة)،
   لكن المحاور مختلفة لأن الموردين معندهمش حد ائتمان ولا علم "موقوف"
   في القاعدة زي العملاء:
   - القيمة = إجمالي قيمة المشتريات منه خلال الفترة (مش هامش ربح —
     مفيش تتبع دفعة/لوط بيربط صنف اتباع بصنف اتشرى من مورد معيّن،
     فمينفعش نحسب "هامش" حقيقي لكل مورد، حجم التعامل أوضح وأصدق).
   - المخاطرة = تأخيرنا احنا في السداد ليه (عكس العملاء بالظبط — هناك
     كان تأخر العميل في السداد لينا)، بنفس أسلوب الـ FIFO التقريبي:
     فواتير الشراء الآجلة مرتبة بتاريخ الاستحقاق، وإجمالي مدفوعاتنا
     (supplier_payments) بتتخصم منها الأقدم فالأقدم.
   ★ نفس ملاحظة مركز قرار العملاء: مرتجعات الشراء مش داخلة في حساب
   الـ FIFO، والفواتير من غير due_date (قبل هذا التعديل) بتتقدّر
   بتاريخ الفاتورة + 15 يوم.
   ════════════════════════════════════════════════════════════ */

let sdcRules = { min_value: 2000, overdue_days_risk: 15, inactive_days: 45, period_days: 30 };
let sdcMetrics = [];
let sdcFilter = 'all';
let sdcSearch = '';
let sdcBalanceFilter = 'all'; // 'all' | 'withBalance' | 'zero'
let sdcSaveTimer = null;
let sdcContainer = null;

const SDC_DEFAULT_TERM_DAYS = 15;

function sdcFmt(n) {
    if (n === Infinity) return '∞';
    if (n === -Infinity || Number.isNaN(n)) return '—';
    return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const SDC_CATS = {
    gold: { label: '🌟 مورد ذهبي', color: 'var(--inv-gold)', bg: 'var(--inv-gold-bg)', rec: 'حجم تعامل كبير ومسدد بانتظام — علاقة ممتازة، حافظ على الالتزام بالسداد' },
    watch: { label: '🟠 يستاهل متابعة', color: '#EA580C', bg: 'rgba(234,88,12,0.12)', rec: 'مهم جداً بس متأخرين في السداد ليه — سدّد بانتظام قبل ما يوقف التوريد أو الخصومات' },
    normal: { label: '🔵 عادي', color: '#2563EB', bg: 'rgba(37,99,235,0.12)', rec: 'حجم تعامل صغير ومسدد بانتظام' },
    risk: { label: '🔴 يستاهل مراجعة', color: 'var(--inv-red)', bg: 'var(--inv-red-bg)', rec: 'حجم تعامل صغير ومتأخرين في السداد — تابعه علشان الدين مايتراكمش' },
};

async function renderSupplierDecisionCenter(c) {
    sdcContainer = c;
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل قواعد التصنيف...</div>';
    try {
        await sdcLoadRules();
        await sdcLoadAndCompute(c);
    } catch (err) {
        c.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

async function sdcLoadRules() {
    const { data } = await sb.from('app_settings').select('value').eq('key', 'supplier_decision_rules').maybeSingle();
    if (data?.value) sdcRules = Object.assign({}, sdcRules, data.value);
}

function sdcSaveRules() {
    clearTimeout(sdcSaveTimer);
    sdcSaveTimer = setTimeout(() => {
        sb.from('app_settings').upsert({ key: 'supplier_decision_rules', value: sdcRules, updated_at: new Date().toISOString() }).then(() => {});
    }, 400);
}

function sdcEstimateDueDate(createdAt) {
    const d = new Date(createdAt);
    d.setDate(d.getDate() + SDC_DEFAULT_TERM_DAYS);
    return d.toISOString().slice(0, 10);
}

// أقدم فاتورة شراء آجلة لسه من غير سداد كامل منّا (FIFO) — راجع الشرح فوق الملف
function sdcOldestOpenDueDate(creditPurchases, totalPaid) {
    const sorted = creditPurchases.slice().sort((a, b) => a._due < b._due ? -1 : (a._due > b._due ? 1 : 0));
    let remaining = totalPaid;
    for (const p of sorted) {
        if (remaining >= p.total - 0.01) remaining -= p.total;
        else return p._due;
    }
    return null;
}

async function sdcLoadAndCompute(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات الموردين...</div>';
    const periodDays = sdcRules.period_days || 30;
    const since = new Date(Date.now() - periodDays * 86400000).toISOString();
    const activitySince = new Date(Date.now() - 400 * 86400000).toISOString();

    const [{ data: suppliers }, { data: purchaseItems }, { data: creditPurchases }, { data: payments }, { data: recentPurchases }, { data: products }] = await Promise.all([
        sb.from('suppliers').select('id,name,code,phone,balance,is_active').eq('is_active', true).order('name'),
        sb.from('purchase_items').select('qty,line_total,purchases!inner(supplier_id,created_at,status)').eq('purchases.status', 'confirmed').gte('purchases.created_at', since),
        sb.from('purchases').select('supplier_id,total,due_date,created_at').eq('status', 'confirmed').eq('payment_type', 'credit'),
        sb.from('supplier_payments').select('supplier_id,amount').eq('status', 'confirmed'),
        sb.from('purchases').select('supplier_id,created_at').eq('status', 'confirmed').gte('created_at', activitySince),
        sb.from('products').select('supplier_id').eq('is_active', true),
    ]);

    const valueAgg = {}; // supplier_id -> purchase value in period
    (purchaseItems || []).forEach(pi => {
        const sid = pi.purchases?.supplier_id;
        if (!sid) return;
        valueAgg[sid] = (valueAgg[sid] || 0) + (Number(pi.line_total) || 0);
    });

    const creditBySupp = {}; // supplier_id -> [{total, _due}]
    (creditPurchases || []).forEach(p => {
        if (!p.supplier_id) return;
        const list = creditBySupp[p.supplier_id] || (creditBySupp[p.supplier_id] = []);
        list.push({ total: Number(p.total) || 0, _due: p.due_date || sdcEstimateDueDate(p.created_at) });
    });

    const paidBySupp = {};
    (payments || []).forEach(p => {
        if (!p.supplier_id) return;
        paidBySupp[p.supplier_id] = (paidBySupp[p.supplier_id] || 0) + (Number(p.amount) || 0);
    });

    const lastPurchaseBySupp = {};
    (recentPurchases || []).forEach(p => {
        if (!p.supplier_id) return;
        if (!lastPurchaseBySupp[p.supplier_id] || p.created_at > lastPurchaseBySupp[p.supplier_id]) lastPurchaseBySupp[p.supplier_id] = p.created_at;
    });

    const productCountBySupp = {};
    (products || []).forEach(p => {
        if (!p.supplier_id) return;
        productCountBySupp[p.supplier_id] = (productCountBySupp[p.supplier_id] || 0) + 1;
    });

    const today = new Date();
    sdcMetrics = (suppliers || []).map(sup => {
        const value = valueAgg[sup.id] || 0;
        const balance = Number(sup.balance) || 0;
        const oldestOpenDue = sdcOldestOpenDueDate(creditBySupp[sup.id] || [], paidBySupp[sup.id] || 0);
        const days_overdue = oldestOpenDue ? Math.max(0, Math.floor((today - new Date(oldestOpenDue)) / 86400000)) : 0;
        const lastPurchase = lastPurchaseBySupp[sup.id] || null;
        const is_inactive = !lastPurchase || (today - new Date(lastPurchase)) / 86400000 > (sdcRules.inactive_days || 45);
        return {
            id: sup.id, name: sup.name, code: sup.code, phone: sup.phone,
            balance, value, days_overdue, last_purchase: lastPurchase, is_inactive,
            product_count: productCountBySupp[sup.id] || 0,
        };
    });

    sdcRenderScreen(c);
}

function sdcClassify(m) {
    const is_high_value = m.value >= sdcRules.min_value;
    const is_high_risk = m.days_overdue > sdcRules.overdue_days_risk;
    let key;
    if (is_high_value && !is_high_risk) key = 'gold';
    else if (is_high_value && is_high_risk) key = 'watch';
    else if (!is_high_value && !is_high_risk) key = 'normal';
    else key = 'risk';
    return { key, is_high_value, is_high_risk };
}

function sdcRenderScreen(c) {
    const counts = { gold: 0, watch: 0, normal: 0, risk: 0 };
    sdcMetrics.forEach(m => { counts[sdcClassify(m).key]++; });

    c.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;flex-wrap:wrap;gap:10px">
        <div><h2 style="font-size:22px;font-weight:800">🎯 مركز قرار الموردين</h2>
        <p style="font-size:13px;color:var(--inv-muted);margin-top:4px">تصنيف تلقائي للموردين حسب حجم التعامل والالتزام بالسداد — مشتريات آخر ${sdcRules.period_days} يوم</p></div>
        <div class="mod-form-group" style="margin:0;min-width:160px">
            <label>فترة حساب حجم التعامل</label>
            <select id="sdcPeriod" class="mod-form-input" onchange="sdcOnPeriodChange(this.value)">
                ${[7, 14, 30, 60, 90].map(d => `<option value="${d}" ${d === sdcRules.period_days ? 'selected' : ''}>آخر ${d} يوم</option>`).join('')}
            </select>
        </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px" id="sdcCards">
        ${Object.keys(SDC_CATS).map(k => sdcCardHTML(k, counts[k])).join('')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 300px;gap:16px;align-items:start">
        <div class="mod-card" style="padding:0;overflow-x:auto">
            <div style="padding:14px 16px 0;display:flex;gap:10px;flex-wrap:wrap">
                <input type="text" id="sdcSearch" class="mod-form-input" style="flex:2;min-width:180px" placeholder="🔍 بحث بالاسم أو الكود..." value="${sdcSearch}" oninput="sdcOnSearch(this.value)">
                <select id="sdcBalanceFilter" class="mod-form-input" style="flex:1;min-width:150px" onchange="sdcOnBalanceFilter(this.value)">
                    <option value="all" ${sdcBalanceFilter === 'all' ? 'selected' : ''}>كل الأرصدة</option>
                    <option value="withBalance" ${sdcBalanceFilter === 'withBalance' ? 'selected' : ''}>عليهم رصيد فقط</option>
                    <option value="zero" ${sdcBalanceFilter === 'zero' ? 'selected' : ''}>رصيدهم صفر</option>
                </select>
            </div>
            <div id="sdcTableWrap"></div>
        </div>

        <div class="mod-card">
            <h3 style="font-size:15px;font-weight:800;margin-bottom:14px">⚙️ قواعد التصنيف</h3>
            ${sdcSliderHTML('min_value', 'الحد الأدنى لحجم التعامل (مورد عالي القيمة)', sdcRules.min_value, 0, 50000, 500, ' ج.م')}
            ${sdcSliderHTML('overdue_days_risk', 'حد التأخير في السداد (يوم)', sdcRules.overdue_days_risk, 0, 90, 1, '')}
            ${sdcSliderHTML('inactive_days', 'حد "نايم" (يوم بدون شراء)', sdcRules.inactive_days, 5, 180, 5, '')}
            <button class="mod-btn mod-btn-primary" style="width:100%;margin-top:6px" onclick="sdcSmartSuggest()">✨ اقتراح ذكي</button>
        </div>
    </div>

    <div id="sdcDetailModal"></div>
    `;
    sdcRenderTable();
}

function sdcCardHTML(key, count) {
    const cat = SDC_CATS[key];
    const active = sdcFilter === key;
    return `<div class="mod-card" style="cursor:pointer;text-align:center;padding:16px;border:2px solid ${active ? cat.color : 'transparent'};background:${cat.bg}" onclick="sdcApplyFilter('${key}')">
        <div style="font-size:13px;font-weight:700;color:${cat.color}">${cat.label}</div>
        <div style="font-size:26px;font-weight:900;margin-top:4px;color:${cat.color}">${count}</div>
    </div>`;
}

function sdcSliderHTML(key, label, value, min, max, step, suffix) {
    return `<div style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px">
            <span style="color:var(--inv-muted)">${label}</span>
            <strong id="sdcVal-${key}">${value}${suffix}</strong>
        </div>
        <input type="range" id="sdcSlider-${key}" min="${min}" max="${max}" step="${step}" value="${value}"
            style="width:100%" oninput="sdcOnRuleInput('${key}', this.value, '${suffix}')" onchange="sdcSaveRules()">
    </div>`;
}

function sdcOnRuleInput(key, val, suffix) {
    const v = parseFloat(val) || 0;
    sdcRules[key] = v;
    document.getElementById(`sdcVal-${key}`).textContent = v + suffix;
    sdcRenderTable();
    sdcRefreshCards();
}

function sdcRefreshCards() {
    const counts = { gold: 0, watch: 0, normal: 0, risk: 0 };
    sdcMetrics.forEach(m => { counts[sdcClassify(m).key]++; });
    const box = document.getElementById('sdcCards');
    if (box) box.innerHTML = Object.keys(SDC_CATS).map(k => sdcCardHTML(k, counts[k])).join('');
}

function sdcApplyFilter(key) {
    sdcFilter = sdcFilter === key ? 'all' : key;
    sdcRefreshCards();
    sdcRenderTable();
}

function sdcOnSearch(val) { sdcSearch = val || ''; sdcRenderTable(); }
function sdcOnBalanceFilter(val) { sdcBalanceFilter = val || 'all'; sdcRenderTable(); }

async function sdcOnPeriodChange(val) {
    sdcRules.period_days = parseInt(val) || 30;
    sdcSaveRules();
    await sdcLoadAndCompute(sdcContainer);
}

function sdcRenderTable() {
    const wrap = document.getElementById('sdcTableWrap');
    if (!wrap) return;
    let rows = sdcMetrics.map(m => Object.assign({}, m, { cls: sdcClassify(m) }));
    if (sdcFilter !== 'all') rows = rows.filter(r => r.cls.key === sdcFilter);
    if (sdcBalanceFilter === 'withBalance') rows = rows.filter(r => r.balance > 0);
    else if (sdcBalanceFilter === 'zero') rows = rows.filter(r => r.balance <= 0);
    if (sdcSearch) {
        const q = sdcSearch.toLowerCase();
        rows = rows.filter(r => (r.name || '').toLowerCase().includes(q) || (r.code || '').toLowerCase().includes(q) || (r.phone || '').includes(q));
    }
    rows.sort((a, b) => b.balance - a.balance);

    if (!rows.length) {
        wrap.innerHTML = '<div class="empty-state" style="padding:30px"><span>📭</span>لا توجد موردين مطابقين</div>';
        return;
    }

    wrap.innerHTML = `<div style="padding:6px 16px;font-size:12px;color:var(--inv-muted)">${rows.length} مورد</div>
    <table class="mod-table"><thead><tr>
        <th>المورد</th><th>رصيدنا المستحق له</th>
        <th title="إجمالي قيمة المشتريات منه خلال الفترة المختارة">حجم التعامل بالفترة</th>
        <th title="عدد أيام تأخيرنا عن استحقاق أقدم فاتورة شراء آجلة لسه من غير سداد كامل (تقديري)">تأخيرنا في السداد (يوم)</th>
        <th>القرار</th>
    </tr></thead><tbody>
        ${rows.map(r => `<tr style="cursor:pointer" onclick="sdcShowDetail('${r.id}')">
            <td><strong>${r.name}</strong>${r.is_inactive ? ' <span style="background:#F3F4F6;color:#6B7280;font-size:10.5px;padding:2px 7px;border-radius:20px;font-weight:700">⚪ نايم</span>' : ''}<div style="font-size:11px;color:var(--inv-muted-light)">${r.code || ''} · ${r.product_count} صنف</div></td>
            <td style="font-weight:700">${sdcFmt(r.balance)}</td>
            <td style="font-weight:700">${sdcFmt(r.value)}</td>
            <td style="color:${r.cls.is_high_risk ? 'var(--inv-red)' : 'var(--inv-text)'};font-weight:700">${r.days_overdue > 0 ? r.days_overdue : '—'}</td>
            <td><span style="background:${SDC_CATS[r.cls.key].bg};color:${SDC_CATS[r.cls.key].color};padding:4px 10px;border-radius:20px;font-size:12px;font-weight:700">${SDC_CATS[r.cls.key].label}</span></td>
        </tr>`).join('')}
    </tbody></table>`;
}

function sdcSmartSuggest() {
    const active = sdcMetrics.filter(m => m.value > 0);
    if (!active.length) { alert('مفيش موردين اتشرى منهم في الفترة دي لحساب اقتراح منهم'); return; }
    const avg = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
    sdcRules.min_value = Math.round(avg(active.map(m => m.value)));
    sdcSaveRules();
    sdcRenderScreen(sdcContainer);
}

function sdcShowDetail(sid) {
    const m = sdcMetrics.find(x => x.id === sid);
    if (!m) return;
    const cls = sdcClassify(m);
    const cat = SDC_CATS[cls.key];
    const check = (ok) => ok ? '✅' : '⚠️';
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'sdcModal';
    modal.innerHTML = `
    <div class="mod-modal" style="max-width:520px">
        <div class="mod-modal-header"><h3>${m.name}</h3>
            <button class="mod-modal-close" onclick="document.getElementById('sdcModal').remove()">&times;</button></div>
        <div class="mod-modal-body">
            <div style="text-align:center;margin-bottom:16px">
                <span style="background:${cat.bg};color:${cat.color};padding:6px 16px;border-radius:20px;font-size:14px;font-weight:800">${cat.label}</span>
                <div style="font-size:13px;color:var(--inv-muted);margin-top:8px">${cat.rec}</div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;margin-bottom:18px">
                <div>رصيدنا المستحق له: <strong>${sdcFmt(m.balance)} ج.م</strong></div>
                <div>تأخيرنا في سداد أقدم فاتورة مفتوحة: <strong>${m.days_overdue > 0 ? m.days_overdue + ' يوم' : 'لا يوجد'}</strong></div>
                <div>حجم المشتريات بالفترة: <strong>${sdcFmt(m.value)} ج.م</strong></div>
                <div>عدد الأصناف اللي بيوردهالنا: <strong>${m.product_count}</strong></div>
                <div>آخر عملية شراء: <strong>${m.last_purchase ? new Date(m.last_purchase).toLocaleDateString('ar-EG') : 'لا يوجد'}</strong></div>
            </div>
            <h4 style="font-size:13.5px;font-weight:800;margin-bottom:8px">ليه القرار ده؟</h4>
            <div style="font-size:12.5px;line-height:2;color:var(--inv-text-soft)">
                <div>${check(cls.is_high_value)} قيمة عالية: حجم التعامل ${sdcFmt(m.value)} ${cls.is_high_value ? '≥' : '<'} ${sdcFmt(sdcRules.min_value)} ج.م</div>
                <div>${check(!cls.is_high_risk)} التزامنا بالسداد: تأخير ${m.days_overdue} يوم ${cls.is_high_risk ? '>' : '≤'} ${sdcRules.overdue_days_risk} يوم</div>
            </div>
        </div>
    </div>`;
    document.body.appendChild(modal);
}

Object.assign(window, {
    renderSupplierDecisionCenter, sdcOnRuleInput, sdcSaveRules, sdcApplyFilter, sdcOnSearch,
    sdcOnBalanceFilter, sdcOnPeriodChange, sdcSmartSuggest, sdcShowDetail,
});
