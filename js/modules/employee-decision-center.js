/* ════════════════════════════════════════════════════════════
   مركز قرار الموظفين — employee-decision-center.js
   يصدّر: renderEmployeeDecisionCenter(container)

   محورين زي باقي مراكز القرار: جودة الأداء × الانضباط الفعلي —
   بيستخدم بيانات موجودة بالفعل (تقييمات الموظفين + سجل الحضور)
   بدل ما يخترع مقاييس جديدة:
   - جودة الأداء = متوسط آخر تقييم مسجّل للموظف على 4 معايير
     (الجودة/التعاون/المبادرة/الالتزام) من شاشة "⭐ تقييم الموظفين" —
     مُستبعد منها معيار "الانضباط" نفسه عشان مايتكررش مع المحور التاني.
   - الانضباط الفعلي = نسبة أيام "حاضر/متأخر" من إجمالي الأيام المسجّلة
     في سجل الحضور خلال الفترة (الإجازة مستبعدة من الحساب، مش نقطة ضده).
   ★ الموظف اللي لسه ما اتقيّمش، أو معندهوش سجل حضور في الفترة، بيتحط
   في فئة خامسة "بيانات غير كافية" بدل ما يتحط ظلماً في "يستاهل مراجعة".
   ════════════════════════════════════════════════════════════ */

let edcRules = { min_performance: 7, min_attendance_rate: 0.9, period_days: 30 };
let edcMetrics = [];
let edcFilter = 'all';
let edcSearch = '';
let edcSaveTimer = null;
let edcContainer = null;

function edcFmt(n) {
    if (n === Infinity) return '∞';
    if (n === -Infinity || Number.isNaN(n)) return '—';
    return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function edcPct(n) { return ((Number(n) || 0) * 100).toFixed(0) + '%'; }

const EDC_CATS = {
    star: { label: '🌟 نجم', color: 'var(--inv-gold)', bg: 'var(--inv-gold-bg)', rec: 'أداء عالي وانضباط عالي — أفضل عنصر، حافظ عليه وكافئه' },
    talent: { label: '🟠 موهبة غير منضبطة', color: '#EA580C', bg: 'rgba(234,88,12,0.12)', rec: 'أداؤه ممتاز بس غيابه/تأخيره بيأثر — لازم متابعة الانضباط' },
    steady: { label: '🔵 منضبط عادي', color: '#2563EB', bg: 'rgba(37,99,235,0.12)', rec: 'ملتزم بالحضور بس محتاج تطوير في الأداء' },
    review: { label: '🔴 يستاهل مراجعة', color: 'var(--inv-red)', bg: 'var(--inv-red-bg)', rec: 'أداء ضعيف وانضباط ضعيف — محتاج تنبيه جاد أو مراجعة استمراريته' },
    incomplete: { label: '⚪ بيانات غير كافية', color: '#6B7280', bg: '#F3F4F6', rec: 'لسه ما اتقيّمش أو معندوش سجل حضور كافي في الفترة دي' },
};

async function renderEmployeeDecisionCenter(c) {
    edcContainer = c;
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل قواعد التصنيف...</div>';
    try {
        await edcLoadRules();
        await edcLoadAndCompute(c);
    } catch (err) {
        c.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

async function edcLoadRules() {
    const { data } = await sb.from('app_settings').select('value').eq('key', 'employee_decision_rules').maybeSingle();
    if (data?.value) edcRules = Object.assign({}, edcRules, data.value);
}

function edcSaveRules() {
    clearTimeout(edcSaveTimer);
    edcSaveTimer = setTimeout(() => {
        sb.from('app_settings').upsert({ key: 'employee_decision_rules', value: edcRules, updated_at: new Date().toISOString() }).then(() => {});
    }, 400);
}

async function edcLoadAndCompute(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات الموظفين...</div>';
    const periodDays = edcRules.period_days || 30;
    const since = new Date(Date.now() - periodDays * 86400000).toISOString().slice(0, 10);

    const [{ data: employees }, { data: evaluations }, { data: attendance }] = await Promise.all([
        sb.from('employees').select('id,name,job_title,base_salary,hire_date,is_active').eq('is_active', true).order('name'),
        sb.from('employee_evaluations').select('employee_id,evaluation_date,quality_score,teamwork_score,initiative_score,compliance_score').order('evaluation_date', { ascending: false }),
        sb.from('attendance_records').select('employee_id,record_date,status').gte('record_date', since),
    ]);

    const latestEvalByEmp = {}; // أول ظهور لكل موظف = الأحدث (النتايج مرتبة تنازلياً بالفعل)
    (evaluations || []).forEach(ev => {
        if (!latestEvalByEmp[ev.employee_id]) latestEvalByEmp[ev.employee_id] = ev;
    });

    const attAgg = {}; // employee_id -> {present, absent}
    (attendance || []).forEach(r => {
        if (!r.employee_id || !r.status || r.status === 'leave') return;
        const a = attAgg[r.employee_id] || (attAgg[r.employee_id] = { present: 0, total: 0, late: 0 });
        a.total += 1;
        if (r.status === 'present' || r.status === 'late') a.present += 1;
        if (r.status === 'late') a.late += 1;
    });

    edcMetrics = (employees || []).map(emp => {
        const ev = latestEvalByEmp[emp.id];
        const performance = ev ? (Number(ev.quality_score || 0) + Number(ev.teamwork_score || 0) + Number(ev.initiative_score || 0) + Number(ev.compliance_score || 0)) / 4 : null;
        const att = attAgg[emp.id];
        const attendance_rate = att && att.total > 0 ? att.present / att.total : null;
        const late_rate = att && att.present > 0 ? att.late / att.present : null;
        return {
            id: emp.id, name: emp.name, job_title: emp.job_title, base_salary: Number(emp.base_salary) || 0,
            performance, attendance_rate, late_rate,
            last_eval_date: ev?.evaluation_date || null,
            attendance_days: att?.total || 0,
        };
    });

    edcRenderScreen(c);
}

function edcClassify(m) {
    if (m.performance == null || m.attendance_rate == null) return { key: 'incomplete', is_high_performance: null, is_high_attendance: null };
    const is_high_performance = m.performance >= edcRules.min_performance;
    const is_high_attendance = m.attendance_rate >= edcRules.min_attendance_rate;
    let key;
    if (is_high_performance && is_high_attendance) key = 'star';
    else if (is_high_performance && !is_high_attendance) key = 'talent';
    else if (!is_high_performance && is_high_attendance) key = 'steady';
    else key = 'review';
    return { key, is_high_performance, is_high_attendance };
}

function edcRenderScreen(c) {
    const counts = { star: 0, talent: 0, steady: 0, review: 0 };
    let incompleteCount = 0;
    edcMetrics.forEach(m => { const k = edcClassify(m).key; if (k === 'incomplete') incompleteCount++; else counts[k]++; });

    c.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;flex-wrap:wrap;gap:10px">
        <div><h2 style="font-size:22px;font-weight:800">🎯 مركز قرار الموظفين</h2>
        <p style="font-size:13px;color:var(--inv-muted);margin-top:4px">تصنيف تلقائي حسب جودة الأداء (آخر تقييم) والانضباط الفعلي (حضور آخر ${edcRules.period_days} يوم)</p></div>
        <div class="mod-form-group" style="margin:0;min-width:160px">
            <label>فترة حساب الحضور</label>
            <select id="edcPeriod" class="mod-form-input" onchange="edcOnPeriodChange(this.value)">
                ${[7, 14, 30, 60, 90].map(d => `<option value="${d}" ${d === edcRules.period_days ? 'selected' : ''}>آخر ${d} يوم</option>`).join('')}
            </select>
        </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:8px" id="edcCards">
        ${['star', 'talent', 'steady', 'review'].map(k => edcCardHTML(k, counts[k])).join('')}
    </div>
    <div style="font-size:12px;color:var(--inv-muted);margin-bottom:16px;cursor:pointer" onclick="edcApplyFilter('incomplete')">⚪ ${incompleteCount} موظف بيانات غير كافية (لسه ما اتقيّمش أو معندوش سجل حضور) — اضغط للعرض</div>

    <div style="display:grid;grid-template-columns:1fr 300px;gap:16px;align-items:start">
        <div class="mod-card" style="padding:0;overflow-x:auto">
            <div style="padding:14px 16px 0">
                <input type="text" id="edcSearch" class="mod-form-input" placeholder="🔍 بحث بالاسم أو الوظيفة..." value="${edcSearch}" oninput="edcOnSearch(this.value)">
            </div>
            <div id="edcTableWrap"></div>
        </div>

        <div class="mod-card">
            <h3 style="font-size:15px;font-weight:800;margin-bottom:14px">⚙️ قواعد التصنيف</h3>
            ${edcSliderHTML('min_performance', 'الحد الأدنى لجودة الأداء (من 10)', edcRules.min_performance, 0, 10, 0.5, '')}
            ${edcSliderHTML('min_attendance_rate', 'الحد الأدنى لنسبة الانضباط', edcRules.min_attendance_rate * 100, 0, 100, 5, '%')}
        </div>
    </div>

    <div id="edcDetailModal"></div>
    `;
    edcRenderTable();
}

function edcCardHTML(key, count) {
    const cat = EDC_CATS[key];
    const active = edcFilter === key;
    return `<div class="mod-card" style="cursor:pointer;text-align:center;padding:16px;border:2px solid ${active ? cat.color : 'transparent'};background:${cat.bg}" onclick="edcApplyFilter('${key}')">
        <div style="font-size:13px;font-weight:700;color:${cat.color}">${cat.label}</div>
        <div style="font-size:26px;font-weight:900;margin-top:4px;color:${cat.color}">${count}</div>
    </div>`;
}

function edcSliderHTML(key, label, value, min, max, step, suffix) {
    return `<div style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px">
            <span style="color:var(--inv-muted)">${label}</span>
            <strong id="edcVal-${key}">${value}${suffix}</strong>
        </div>
        <input type="range" id="edcSlider-${key}" min="${min}" max="${max}" step="${step}" value="${value}"
            style="width:100%" oninput="edcOnRuleInput('${key}', this.value, '${suffix}')" onchange="edcSaveRules()">
    </div>`;
}

function edcOnRuleInput(key, val, suffix) {
    const v = parseFloat(val) || 0;
    edcRules[key] = suffix === '%' ? v / 100 : v;
    document.getElementById(`edcVal-${key}`).textContent = v + suffix;
    edcRenderTable();
    edcRefreshCards();
}

function edcRefreshCards() {
    const counts = { star: 0, talent: 0, steady: 0, review: 0 };
    edcMetrics.forEach(m => { const k = edcClassify(m).key; if (k !== 'incomplete') counts[k]++; });
    const box = document.getElementById('edcCards');
    if (box) box.innerHTML = ['star', 'talent', 'steady', 'review'].map(k => edcCardHTML(k, counts[k])).join('');
}

function edcApplyFilter(key) {
    edcFilter = edcFilter === key ? 'all' : key;
    edcRefreshCards();
    edcRenderTable();
}

function edcOnSearch(val) { edcSearch = val || ''; edcRenderTable(); }

async function edcOnPeriodChange(val) {
    edcRules.period_days = parseInt(val) || 30;
    edcSaveRules();
    await edcLoadAndCompute(edcContainer);
}

function edcRenderTable() {
    const wrap = document.getElementById('edcTableWrap');
    if (!wrap) return;
    let rows = edcMetrics.map(m => Object.assign({}, m, { cls: edcClassify(m) }));
    if (edcFilter !== 'all') rows = rows.filter(r => r.cls.key === edcFilter);
    if (edcSearch) {
        const q = edcSearch.toLowerCase();
        rows = rows.filter(r => (r.name || '').toLowerCase().includes(q) || (r.job_title || '').toLowerCase().includes(q));
    }
    rows.sort((a, b) => (b.performance ?? -1) - (a.performance ?? -1));

    if (!rows.length) {
        wrap.innerHTML = '<div class="empty-state" style="padding:30px"><span>📭</span>لا يوجد موظفون مطابقون</div>';
        return;
    }

    wrap.innerHTML = `<div style="padding:6px 16px;font-size:12px;color:var(--inv-muted)">${rows.length} موظف</div>
    <table class="mod-table"><thead><tr>
        <th>الموظف</th><th>الوظيفة</th>
        <th title="متوسط آخر تقييم على 4 معايير (الجودة/التعاون/المبادرة/الالتزام)، من 10">جودة الأداء</th>
        <th title="نسبة أيام الحضور (حاضر أو متأخر) من إجمالي الأيام المسجّلة في الفترة">الانضباط</th>
        <th>القرار</th>
    </tr></thead><tbody>
        ${rows.map(r => `<tr style="cursor:pointer" onclick="edcShowDetail('${r.id}')">
            <td><strong>${r.name}</strong></td>
            <td style="font-size:12px;color:var(--inv-muted)">${r.job_title || '—'}</td>
            <td style="font-weight:700">${r.performance != null ? edcFmt(r.performance) + ' / 10' : '—'}</td>
            <td style="font-weight:700">${r.attendance_rate != null ? edcPct(r.attendance_rate) : '—'}</td>
            <td><span style="background:${EDC_CATS[r.cls.key].bg};color:${EDC_CATS[r.cls.key].color};padding:4px 10px;border-radius:20px;font-size:12px;font-weight:700">${EDC_CATS[r.cls.key].label}</span></td>
        </tr>`).join('')}
    </tbody></table>`;
}

function edcShowDetail(eid) {
    const m = edcMetrics.find(x => x.id === eid);
    if (!m) return;
    const cls = edcClassify(m);
    const cat = EDC_CATS[cls.key];
    const check = (ok) => ok === true ? '✅' : ok === false ? '⚠️' : '❔';
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'edcModal';
    modal.innerHTML = `
    <div class="mod-modal" style="max-width:520px">
        <div class="mod-modal-header"><h3>${m.name}</h3>
            <button class="mod-modal-close" onclick="document.getElementById('edcModal').remove()">&times;</button></div>
        <div class="mod-modal-body">
            <div style="text-align:center;margin-bottom:16px">
                <span style="background:${cat.bg};color:${cat.color};padding:6px 16px;border-radius:20px;font-size:14px;font-weight:800">${cat.label}</span>
                <div style="font-size:13px;color:var(--inv-muted);margin-top:8px">${cat.rec}</div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;margin-bottom:18px">
                <div>الوظيفة: <strong>${m.job_title || '—'}</strong></div>
                <div>الراتب الأساسي: <strong>${edcFmt(m.base_salary)} ج.م</strong></div>
                <div>جودة الأداء: <strong>${m.performance != null ? edcFmt(m.performance) + ' / 10' : 'لسه ما اتقيّمش'}</strong></div>
                <div>تاريخ آخر تقييم: <strong>${m.last_eval_date ? new Date(m.last_eval_date).toLocaleDateString('ar-EG') : '—'}</strong></div>
                <div>نسبة الانضباط: <strong>${m.attendance_rate != null ? edcPct(m.attendance_rate) : 'مفيش سجل حضور'}</strong></div>
                <div>نسبة التأخير (من أيام الحضور): <strong>${m.late_rate != null ? edcPct(m.late_rate) : '—'}</strong></div>
            </div>
            <h4 style="font-size:13.5px;font-weight:800;margin-bottom:8px">ليه القرار ده؟</h4>
            <div style="font-size:12.5px;line-height:2;color:var(--inv-text-soft)">
                <div>${check(cls.is_high_performance)} جودة أداء عالية: ${m.performance != null ? edcFmt(m.performance) + (cls.is_high_performance ? ' ≥ ' : ' < ') + edcFmt(edcRules.min_performance) : 'لا يوجد تقييم مسجّل'}</div>
                <div>${check(cls.is_high_attendance)} انضباط عالي: ${m.attendance_rate != null ? edcPct(m.attendance_rate) + (cls.is_high_attendance ? ' ≥ ' : ' < ') + edcPct(edcRules.min_attendance_rate) : 'لا يوجد سجل حضور في الفترة'}</div>
            </div>
        </div>
    </div>`;
    document.body.appendChild(modal);
}

Object.assign(window, {
    renderEmployeeDecisionCenter, edcOnRuleInput, edcSaveRules, edcApplyFilter, edcOnSearch,
    edcOnPeriodChange, edcShowDetail,
});
