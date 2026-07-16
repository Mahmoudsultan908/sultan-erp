/* ════════════════════════════════════════════════════════════
   تقييم الموظفين — employee-evaluation.js
   يصدّر: renderEmployeeEvaluation(container)
   تقييم دوري لأداء كل موظف على 5 معايير ثابتة (من 1 إلى 10).
   جدول employee_evaluations بيانات وصفية بحتة، بدون أي تريجر مالي
   — راجع employee_evaluation_migration.sql.
   ════════════════════════════════════════════════════════════ */

let _eevList = [];
let _eevEmployees = [];
let _eevFilterEmp = ''; // '' = كل الموظفين
let _eevTableMissing = false;

const EEV_CRITERIA = [
    ['attendance_score', 'الانضباط ومواعيد الحضور'],
    ['quality_score', 'جودة الأداء والإتقان'],
    ['teamwork_score', 'التعاون والعمل الجماعي'],
    ['initiative_score', 'المبادرة وتحمل المسؤولية'],
    ['compliance_score', 'الالتزام بالتعليمات والسياسات'],
];

function eevTotal(x) {
    const sum = EEV_CRITERIA.reduce((s, [key]) => s + (Number(x[key]) || 0), 0);
    return sum / EEV_CRITERIA.length;
}

function eevRatingInfo(avg) {
    if (avg >= 9) return { label: 'ممتاز', color: '#059669', bg: '#F0FDF4' };
    if (avg >= 7) return { label: 'جيد جدًا', color: '#2563EB', bg: '#EFF6FF' };
    if (avg >= 5) return { label: 'جيد', color: '#D97706', bg: '#FFFBEB' };
    if (avg >= 3) return { label: 'مقبول', color: '#EA580C', bg: '#FFF7ED' };
    return { label: 'ضعيف', color: '#DC2626', bg: '#FEF2F2' };
}

// ════════════════════════════════════════════════════════════
// 1) القائمة الرئيسية
// ════════════════════════════════════════════════════════════
async function renderEmployeeEvaluation(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل التقييمات...</div>';
    _eevTableMissing = false;
    try {
        try {
            const { data, error } = await sb.from('employee_evaluations')
                .select('*, employees(name, job_title)').order('evaluation_date', { ascending: false });
            if (error) throw error;
            _eevList = data || [];
        } catch (e) {
            _eevTableMissing = true;
            _eevList = [];
        }
        try {
            const { data, error } = await sb.from('employees').select('id,name,job_title').eq('is_active', true).order('name');
            if (error) throw error;
            _eevEmployees = data || [];
        } catch (e) {
            _eevEmployees = [];
        }
        eevRenderPage(c);
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function eevRenderPage(c) {
    const filtered = _eevFilterEmp ? _eevList.filter(x => x.employee_id === _eevFilterEmp) : _eevList;
    const totalCount = _eevList.length;
    const overallAvg = totalCount ? _eevList.reduce((s, x) => s + eevTotal(x), 0) / totalCount : 0;
    const evaluatedEmpCount = new Set(_eevList.map(x => x.employee_id)).size;
    const filterAvg = filtered.length ? filtered.reduce((s, x) => s + eevTotal(x), 0) / filtered.length : 0;

    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px">
            <div><h2 style="font-size:22px;font-weight:800">⭐ تقييم الموظفين</h2>
            <p style="font-size:13px;color:#64748B;margin-top:4px">تقييم دوري لأداء الموظفين حسب معايير ثابتة</p></div>
            <button class="mod-btn mod-btn-primary" onclick="eevOpenAdd()">+ تسجيل تقييم</button>
        </div>

        ${_eevTableMissing ? `<div style="background:#FEF3C7;color:#92400E;padding:14px 18px;border-radius:10px;margin-bottom:16px;font-size:13px">⚠️ جدول التقييمات لسه مش موجود — شغّل <code>employee_evaluation_migration.sql</code> في Supabase.</div>` : ''}
        ${(!_eevTableMissing && !_eevEmployees.length) ? `<div style="background:#EFF6FF;color:#1D4ED8;padding:14px 18px;border-radius:10px;margin-bottom:16px;font-size:13px">ℹ️ لا يوجد موظفون نشطون بعد — أضِفهم أولاً من صفحة <b>👥 الموظفون والرواتب</b>.</div>` : ''}

        <div class="mod-grid" style="margin-bottom:16px">
            <div class="mod-card"><div class="mod-card-icon" style="background:#EFF6FF;color:#2563EB">📋</div><div class="mod-card-val">${totalCount}</div><div class="mod-card-lbl">عدد التقييمات المسجلة</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#F0FDF4;color:#059669">⭐</div><div class="mod-card-val">${totalCount ? overallAvg.toFixed(1) : '—'}</div><div class="mod-card-lbl">متوسط التقييم العام (من 10)</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#FFFBEB;color:#D97706">👥</div><div class="mod-card-val">${evaluatedEmpCount}</div><div class="mod-card-lbl">عدد الموظفين المُقيَّمين</div></div>
        </div>

        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap">
            <div class="mod-form-group" style="margin:0;max-width:260px;flex:1">
                <select id="eevFilterEmp" class="mod-form-input" onchange="eevSwitchFilter(this.value)">
                    <option value="">كل الموظفين</option>
                    ${_eevEmployees.map(e => `<option value="${e.id}" ${_eevFilterEmp === e.id ? 'selected' : ''}>${e.name}</option>`).join('')}
                </select>
            </div>
            ${_eevFilterEmp && filtered.length ? `<div style="font-size:13px;color:#64748B">متوسط تقييم هذا الموظف: <b style="color:${eevRatingInfo(filterAvg).color}">${filterAvg.toFixed(1)} / 10 — ${eevRatingInfo(filterAvg).label}</b></div>` : ''}
        </div>

        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>الموظف</th><th>التاريخ</th>
                <th style="text-align:center">الانضباط</th><th style="text-align:center">الجودة</th>
                <th style="text-align:center">التعاون</th><th style="text-align:center">المبادرة</th>
                <th style="text-align:center">الالتزام</th><th style="text-align:center">التقييم العام</th>
                <th>ملاحظات</th><th style="text-align:center">إجراءات</th>
            </tr></thead>
            <tbody>
                ${filtered.length === 0 ? `<tr><td colspan="10" class="empty-state"><span>⭐</span>لا توجد تقييمات مطابقة.</td></tr>` :
                filtered.map(x => {
                    const avg = eevTotal(x);
                    const info = eevRatingInfo(avg);
                    return `<tr>
                        <td style="font-weight:600">${x.employees?.name || '—'}</td>
                        <td style="font-size:12px">${new Date(x.evaluation_date).toLocaleDateString('ar-EG')}</td>
                        <td style="text-align:center;font-weight:600">${Number(x.attendance_score) || 0}</td>
                        <td style="text-align:center;font-weight:600">${Number(x.quality_score) || 0}</td>
                        <td style="text-align:center;font-weight:600">${Number(x.teamwork_score) || 0}</td>
                        <td style="text-align:center;font-weight:600">${Number(x.initiative_score) || 0}</td>
                        <td style="text-align:center;font-weight:600">${Number(x.compliance_score) || 0}</td>
                        <td style="text-align:center"><span style="background:${info.bg};color:${info.color};padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700">${avg.toFixed(1)} — ${info.label}</span></td>
                        <td style="color:#64748B;max-width:200px">${x.notes || '—'}</td>
                        <td style="text-align:center"><button class="cc-edit" style="background:#FEE2E2;color:#DC2626" onclick="eevDelete('${x.id}')">🗑️</button></td>
                    </tr>`;
                }).join('')}
            </tbody></table>
        </div>`;
}

window.eevSwitchFilter = function (empId) { _eevFilterEmp = empId; eevRenderPage(document.getElementById('app-content')); };

window.eevDelete = async function (id) {
    if (!confirm('حذف هذا التقييم نهائياً؟')) return;
    try {
        const { error } = await sb.from('employee_evaluations').delete().eq('id', id);
        if (error) throw error;
        renderEmployeeEvaluation(document.getElementById('app-content'));
    } catch (err) { alert('❌ خطأ: ' + err.message); }
};

// ════════════════════════════════════════════════════════════
// 2) تسجيل تقييم جديد
// ════════════════════════════════════════════════════════════
window.eevOpenAdd = function (presetEmployeeId = null) {
    if (!_eevEmployees.length) return alert('لا يوجد موظفون نشطون. أضف موظفاً أولاً من صفحة "الموظفون والرواتب".');
    const selectedId = presetEmployeeId || _eevFilterEmp || '';

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'eevModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:520px">
            <div class="mod-modal-header"><h3>⭐ تسجيل تقييم جديد</h3>
                <button class="mod-modal-close" onclick="document.getElementById('eevModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>الموظف *</label>
                        <select id="eevEmpId" class="mod-form-input">
                            ${_eevEmployees.map(e => `<option value="${e.id}" ${selectedId === e.id ? 'selected' : ''}>${e.name}${e.job_title ? ' — ' + e.job_title : ''}</option>`).join('')}
                        </select></div>
                    <div class="mod-form-group"><label>تاريخ التقييم</label>
                        <input type="date" id="eevDate" class="mod-form-input" value="${new Date().toISOString().slice(0, 10)}"></div>
                </div>
                <div style="background:#F8FAFC;border-radius:10px;padding:12px;margin:6px 0">
                    <div style="font-size:12px;color:#64748B;margin-bottom:8px">المعايير (من 1 إلى 10)</div>
                    ${EEV_CRITERIA.map(([key, label]) => `
                        <div class="mod-form-group" style="margin-bottom:8px">
                            <label>${label}</label>
                            <input type="number" id="eev_${key}" class="mod-form-input" value="5" min="1" max="10" step="1">
                        </div>`).join('')}
                </div>
                <div class="mod-form-group"><label>ملاحظات</label>
                    <textarea id="eevNotes" class="mod-form-input" rows="3" placeholder="اختياري"></textarea></div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="document.getElementById('eevModal').remove()">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="eevSave()">💾 حفظ التقييم</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
};

window.eevSave = async function () {
    const employee_id = document.getElementById('eevEmpId').value;
    const evaluation_date = document.getElementById('eevDate').value;
    if (!employee_id) return alert('اختر الموظف');
    if (!evaluation_date) return alert('أدخل تاريخ التقييم');

    const scores = {};
    for (const [key, label] of EEV_CRITERIA) {
        const val = parseFloat(document.getElementById(`eev_${key}`).value);
        if (!val || val < 1 || val > 10) return alert(`أدخل قيمة صحيحة (من 1 إلى 10) لمعيار: ${label}`);
        scores[key] = val;
    }
    const notes = document.getElementById('eevNotes').value.trim() || null;

    const btn = document.querySelector('#eevModal .mod-btn-primary');
    btn.innerText = '⏳ جاري الحفظ...'; btn.disabled = true;
    try {
        const { error } = await sb.from('employee_evaluations').insert({
            employee_id, evaluation_date, ...scores, notes, created_by: currentUser?.id || null,
        });
        if (error) throw error;
        document.getElementById('eevModal').remove();
        renderEmployeeEvaluation(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ: ' + err.message + (_eevTableMissing ? '\n\nتأكد من تشغيل employee_evaluation_migration.sql في Supabase.' : ''));
        btn.innerText = '💾 حفظ التقييم'; btn.disabled = false;
    }
};

Object.assign(window, {
    renderEmployeeEvaluation, eevSwitchFilter, eevDelete, eevOpenAdd, eevSave,
});
