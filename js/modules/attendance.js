/* ════════════════════════════════════════════════════════════
   الحضور والانصراف — attendance.js
   بند 11 (2026-07-21) → مُعاد تصميمه بروح "البصمة" (2026-08-04):
   بدل ما المشرف يختار حالة يدوي لكل موظف، بيدوس زرار واحد "بصمة
   الآن" وقت الحضور والانصراف — الحالة (حاضر/متأخر) بتتحسب أوتوماتيك
   من مقارنة وقت البصمة بموعد الدوام + فترة السماح (موعد عام قابل
   للتخصيص لكل موظف من شاشة الرواتب). الغياب بيتحسب أوتوماتيك كمان
   لأي موظف مبصمش خالص في يوم فات (من غير ما نحتاج job مجدول —
   بيتحسب وقت العرض نفسه، راجع attSynthesizeAbsences).
   "إجازة"/"غياب" لسه فيهم أزرار يدوية للحالات المعروفة مقدماً،
   وشاشة "تعديل" السجل القديمة اتسابت زي ما هي كصمّام أمان لو المشرف
   نسي يبصم ليوم كامل.
   فيز 2 (مستقبلية): تطبيق موبايل يبصم بيه كل موظف لنفسه — هيستخدم
   نفس منطق "وقت حقيقي + حالة محسوبة" ده بالظبط من غير أي تعديل هنا.
   يصدّر: renderAttendance(container)
   ════════════════════════════════════════════════════════════ */

let _attEmployees = [];
let _attTodayMap = {}; // employee_id -> أحدث سجل النهاردة
let _attHistFrom = '';
let _attHistTo = '';
let _attHistRows = []; // سجلات حقيقية + صفوف غياب تلقائي (synthetic:true)
let _attEditingId = null;
let _attEditingSynthetic = null; // {employee_id, record_date} لو بنعدّل صف غياب تلقائي (مفيش سجل حقيقي لسه)
let _attShiftDefault = { start_time: '09:00', grace_minutes: 15 };

function attToday() { return new Date().toISOString().slice(0, 10); }
function attTimeFmt(iso) { return iso ? new Date(iso).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '—'; }
function attTimeShort(t) { return t ? t.slice(0, 5) : ''; }
const ATT_STATUS_LABEL = { present: '✅ حاضر', late: '⚠️ متأخر', absent: '❌ غايب', leave: '🏖️ إجازة' };
const ATT_STATUS_COLOR = { present: 'var(--inv-green)', late: 'var(--inv-gold)', absent: 'var(--inv-red)', leave: '#7C3AED' };

// موعد الدوام الفعلي للموظف: تخصيص شخصي (من شاشة الرواتب) أو الإعداد العام
function attShiftFor(emp) {
    return {
        start_time: emp?.shift_start_time || _attShiftDefault.start_time || null,
        grace_minutes: emp?.grace_minutes != null ? emp.grace_minutes : (_attShiftDefault.grace_minutes ?? 0),
    };
}

// الحالة بتتحسب من وقت البصمة نفسه — مفيش اختيار يدوي
function attComputeStatus(emp, checkInIso) {
    const shift = attShiftFor(emp);
    if (!shift.start_time) return 'present'; // مفيش موعد دوام محدد خالص
    const d = new Date(checkInIso);
    const [h, m] = shift.start_time.split(':').map(Number);
    const deadline = new Date(d);
    deadline.setHours(h, (m || 0) + (Number(shift.grace_minutes) || 0), 0, 0);
    return d <= deadline ? 'present' : 'late';
}

async function renderAttendance(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات الحضور...</div>';
    try {
        const today = attToday();
        const [{ data: employees }, { data: todayRecords }, { data: settingsRow }] = await Promise.all([
            sb.from('employees').select('*').eq('is_active', true).order('name'),
            sb.from('attendance_records').select('*').eq('record_date', today),
            sb.from('app_settings').select('value').eq('key', 'attendance_shift_default').maybeSingle(),
        ]);
        _attEmployees = employees || [];
        _attTodayMap = {};
        (todayRecords || []).forEach(r => { _attTodayMap[r.employee_id] = r; });
        if (settingsRow?.value) _attShiftDefault = Object.assign({}, _attShiftDefault, settingsRow.value);

        if (!_attHistFrom) { _attHistFrom = today; _attHistTo = today; }

        c.innerHTML = `
            <div style="margin-bottom:20px"><h2 style="font-size:22px;font-weight:800">🕐 الحضور والانصراف</h2>
            <p style="font-size:13px;color:var(--inv-muted);margin-top:4px">بصمة بضغطة واحدة — الحالة بتتحسب أوتوماتيك من وقت البصمة، والغياب بيتحسب تلقائي لمين مبصمش</p></div>

            <div class="mod-card" style="padding:14px;margin-bottom:20px;display:flex;gap:14px;align-items:end;flex-wrap:wrap">
                <div><label class="ob-label">⚙️ موعد الدوام العام</label><input type="time" id="attShiftStart" class="ob-input" style="margin:0" value="${attTimeShort(_attShiftDefault.start_time)}"></div>
                <div><label class="ob-label">فترة السماح (دقيقة)</label><input type="number" id="attShiftGrace" class="ob-input" style="margin:0;width:100px" min="0" step="1" value="${_attShiftDefault.grace_minutes ?? 15}"></div>
                <button class="ob-add-btn" onclick="attSaveShiftDefault()">💾 حفظ</button>
                <span style="font-size:11.5px;color:var(--inv-muted-light)">ينطبق على كل الموظفين إلا لو حد منهم له موعد مخصص من شاشة "الموظفون والرواتب"</span>
            </div>

            <h3 style="font-size:15px;font-weight:800;margin-bottom:10px">📅 حضور اليوم — ${new Date(today).toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</h3>
            <div class="mod-table-wrap" style="margin-bottom:26px">
                <table class="mod-table"><thead><tr>
                    <th>الموظف</th><th>الوظيفة</th><th>الحضور</th><th>الانصراف</th><th>الحالة</th><th style="text-align:center">إجراء</th>
                </tr></thead>
                <tbody id="attTodayBody">${attTodayRowsHtml()}</tbody></table>
            </div>

            <h3 style="font-size:15px;font-weight:800;margin-bottom:10px">📜 سجل الحضور</h3>
            <div class="mod-card" style="padding:14px;display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin-bottom:16px">
                <div><label class="ob-label">من تاريخ</label><input type="date" id="attFrom" class="ob-input" style="margin:0" value="${_attHistFrom}"></div>
                <div><label class="ob-label">إلى تاريخ</label><input type="date" id="attTo" class="ob-input" style="margin:0" value="${_attHistTo}"></div>
                <select id="attEmpFilter" class="ob-input" style="margin:0;min-width:160px">
                    <option value="">كل الموظفين</option>
                    ${_attEmployees.map(e => `<option value="${e.id}">${e.name}</option>`).join('')}
                </select>
                <button class="ob-add-btn" onclick="attLoadHistory()">🔍 عرض</button>
            </div>
            <div class="mod-table-wrap">
                <table class="mod-table"><thead><tr>
                    <th>التاريخ</th><th>الموظف</th><th>الحضور</th><th>الانصراف</th><th>الحالة</th><th>ملاحظات</th><th style="text-align:center"></th>
                </tr></thead>
                <tbody id="attHistBody"><tr><td colspan="7" class="empty-state"><span>📜</span>دوس "عرض" لتحميل السجل</td></tr></tbody></table>
            </div>
        `;
        await attLoadHistory();
    } catch (err) {
        c.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

window.attSaveShiftDefault = async function() {
    const start_time = document.getElementById('attShiftStart').value || '09:00';
    const grace_minutes = parseInt(document.getElementById('attShiftGrace').value, 10) || 0;
    _attShiftDefault = { start_time, grace_minutes };
    try {
        await sb.from('app_settings').upsert({ key: 'attendance_shift_default', value: _attShiftDefault, updated_at: new Date().toISOString() });
        alert('✅ اتحفظ');
    } catch (err) { alert('خطأ: ' + err.message); }
};

function attTodayRowsHtml() {
    if (!_attEmployees.length) return `<tr><td colspan="6" class="empty-state"><span>👥</span>لا يوجد موظفين نشطين — أضف موظف من "👥 الموظفون والرواتب"</td></tr>`;
    return _attEmployees.map(emp => {
        const r = _attTodayMap[emp.id];
        const statusChip = r ? `<span style="color:${ATT_STATUS_COLOR[r.status] || 'var(--inv-muted)'};font-weight:700">${ATT_STATUS_LABEL[r.status] || r.status}</span>` : '<span style="color:var(--inv-muted-light)">لسه ما بصمش</span>';
        let action;
        if (!r) {
            action = `<div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap">
                <button class="cc-edit" style="background:var(--inv-green-light);color:var(--inv-green)" onclick="attCheckIn('${emp.id}')">📍 بصمة حضور</button>
                <button class="cc-edit" style="background:#EDE9FE;color:#7C3AED" onclick="attMarkLeave('${emp.id}')">🏖️ إجازة</button>
                <button class="cc-edit" style="background:var(--inv-red-bg);color:var(--inv-red)" onclick="attMarkAbsent('${emp.id}')">❌ غياب</button>
            </div>`;
        } else if (r.check_in_time && !r.check_out_time && r.status !== 'absent' && r.status !== 'leave') {
            action = `<div style="text-align:center"><button class="cc-edit" style="background:#DBEAFE;color:#2563EB" onclick="attCheckOut('${r.id}')">🚪 بصمة انصراف</button></div>`;
        } else {
            action = `<div style="text-align:center"><button class="cc-edit" onclick="attOpenEdit('${r.id}')">✏️ تعديل</button></div>`;
        }
        return `<tr>
            <td><strong>${emp.name}</strong></td>
            <td style="color:var(--inv-muted)">${emp.job_title || '—'}</td>
            <td>${attTimeFmt(r?.check_in_time)}</td>
            <td>${attTimeFmt(r?.check_out_time)}</td>
            <td>${statusChip}</td>
            <td>${action}</td>
        </tr>`;
    }).join('');
}

// بصمة حضور — وقت حقيقي + حالة محسوبة أوتوماتيك، مفيش اختيار يدوي
window.attCheckIn = async function(employeeId) {
    try {
        const emp = _attEmployees.find(e => e.id === employeeId);
        const now = new Date().toISOString();
        const status = attComputeStatus(emp, now);
        const payload = { employee_id: employeeId, record_date: attToday(), status, check_in_time: now, recorded_by: currentUser?.id || null };
        const { error } = await sb.from('attendance_records').insert(payload);
        if (error) throw error;
        const { data } = await sb.from('attendance_records').select('*').eq('employee_id', employeeId).eq('record_date', attToday()).order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (data) _attTodayMap[employeeId] = data;
        document.getElementById('attTodayBody').innerHTML = attTodayRowsHtml();
    } catch (err) { alert('خطأ: ' + err.message); }
};

window.attMarkLeave = async function(employeeId) {
    try {
        const payload = { employee_id: employeeId, record_date: attToday(), status: 'leave', recorded_by: currentUser?.id || null };
        const { error } = await sb.from('attendance_records').insert(payload);
        if (error) throw error;
        const { data } = await sb.from('attendance_records').select('*').eq('employee_id', employeeId).eq('record_date', attToday()).order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (data) _attTodayMap[employeeId] = data;
        document.getElementById('attTodayBody').innerHTML = attTodayRowsHtml();
    } catch (err) { alert('خطأ: ' + err.message); }
};

window.attMarkAbsent = async function(employeeId) {
    if (!confirm('تسجيل الموظف ده "غايب" النهاردة؟')) return;
    try {
        const payload = { employee_id: employeeId, record_date: attToday(), status: 'absent', recorded_by: currentUser?.id || null };
        const { error } = await sb.from('attendance_records').insert(payload);
        if (error) throw error;
        const { data } = await sb.from('attendance_records').select('*').eq('employee_id', employeeId).eq('record_date', attToday()).order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (data) _attTodayMap[employeeId] = data;
        document.getElementById('attTodayBody').innerHTML = attTodayRowsHtml();
    } catch (err) { alert('خطأ: ' + err.message); }
};

window.attCheckOut = async function(recordId) {
    try {
        const { error } = await sb.from('attendance_records').update({ check_out_time: new Date().toISOString() }).eq('id', recordId);
        if (error) throw error;
        const emp = Object.keys(_attTodayMap).find(eid => _attTodayMap[eid].id === recordId);
        if (emp) _attTodayMap[emp].check_out_time = new Date().toISOString();
        document.getElementById('attTodayBody').innerHTML = attTodayRowsHtml();
    } catch (err) { alert('خطأ: ' + err.message); }
};

window.attLoadHistory = async function() {
    const from = document.getElementById('attFrom')?.value || _attHistFrom;
    const to = document.getElementById('attTo')?.value || _attHistTo;
    const empId = document.getElementById('attEmpFilter')?.value || '';
    _attHistFrom = from; _attHistTo = to;
    const tbody = document.getElementById('attHistBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--inv-muted)">⏳ جاري التحميل...</td></tr>`;
    try {
        let q = sb.from('attendance_records').select('*, employees(name)').gte('record_date', from).lte('record_date', to).order('record_date', { ascending: false });
        if (empId) q = q.eq('employee_id', empId);
        const { data, error } = await q.limit(600);
        if (error) throw error;
        const real = data || [];
        const synthetic = attSynthesizeAbsences(from, to, empId, real);
        _attHistRows = real.concat(synthetic).sort((a, b) => b.record_date.localeCompare(a.record_date));
        attRenderHistory();
    } catch (err) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="color:var(--inv-red);text-align:center;padding:20px">خطأ: ${err.message}</td></tr>`;
    }
};

// غياب تلقائي: أي موظف نشط (متعيّن قبل أو في اليوم ده) مالوش أي سجل في
// يوم فات (قبل النهاردة) بيتحط "غايب" في العرض بس، من غير ما نكتب صف
// فعلي في القاعدة — بيتحوّل لصف حقيقي لو المشرف دخل يعدّله. محدود بـ 92
// يوم كحد أقصى لكل استعلام عشان الحساب يفضل خفيف.
function attSynthesizeAbsences(from, to, empId, realRows) {
    const today = attToday();
    const cappedTo = to < today ? to : new Date(Date.now() - 86400000).toISOString().slice(0, 10); // مستبعد النهاردة، لسه ما خلصش
    if (from > cappedTo) return [];
    const dates = [];
    let d = new Date(from);
    const end = new Date(cappedTo);
    let guard = 0;
    while (d <= end && guard < 92) { dates.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); guard++; }

    const hasRecord = new Set(realRows.map(r => r.employee_id + '|' + r.record_date));
    const emps = empId ? _attEmployees.filter(e => e.id === empId) : _attEmployees;
    const out = [];
    emps.forEach(emp => {
        dates.forEach(dt => {
            if (emp.hire_date && emp.hire_date > dt) return; // لسه ما اتعيّنش وقتها
            if (hasRecord.has(emp.id + '|' + dt)) return;
            out.push({ id: null, employee_id: emp.id, employees: { name: emp.name }, record_date: dt, status: 'absent', check_in_time: null, check_out_time: null, notes: null, synthetic: true });
        });
    });
    return out;
}

function attRenderHistory() {
    const tbody = document.getElementById('attHistBody');
    if (!tbody) return;
    if (!_attHistRows.length) { tbody.innerHTML = `<tr><td colspan="7" class="empty-state"><span>📜</span>لا توجد سجلات فى الفترة دي</td></tr>`; return; }
    tbody.innerHTML = _attHistRows.map(r => `<tr ${r.synthetic ? 'style="opacity:.7"' : ''}>
        <td>${new Date(r.record_date).toLocaleDateString('ar-EG')}</td>
        <td><strong>${r.employees?.name || '—'}</strong></td>
        <td>${attTimeFmt(r.check_in_time)}</td>
        <td>${attTimeFmt(r.check_out_time)}</td>
        <td style="color:${ATT_STATUS_COLOR[r.status] || 'var(--inv-muted)'};font-weight:700">${ATT_STATUS_LABEL[r.status] || r.status || '—'}${r.synthetic ? ' <small style="color:var(--inv-muted-light);font-weight:400">(تلقائي)</small>' : ''}</td>
        <td style="color:var(--inv-muted);font-size:12px">${r.notes || '—'}</td>
        <td style="text-align:center">${r.synthetic
            ? `<button class="cc-edit" onclick="attOpenEditSynthetic('${r.employee_id}','${r.record_date}')">✏️</button>`
            : `<button class="cc-edit" onclick="attOpenEdit('${r.id}')">✏️</button>`}</td>
    </tr>`).join('');
}

window.attOpenEdit = function(recordId) {
    const r = _attHistRows.find(x => x.id === recordId) || Object.values(_attTodayMap).find(x => x.id === recordId);
    if (!r) return;
    _attEditingId = recordId;
    _attEditingSynthetic = null;
    attRenderEditModal(r);
};

window.attOpenEditSynthetic = function(employeeId, recordDate) {
    _attEditingId = null;
    _attEditingSynthetic = { employee_id: employeeId, record_date: recordDate };
    const emp = _attEmployees.find(e => e.id === employeeId);
    attRenderEditModal({ status: 'absent', check_in_time: null, check_out_time: null, notes: null, employees: { name: emp?.name } });
};

function attRenderEditModal(r) {
    const toLocalInput = (iso) => iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'attEditModal';
    modal.innerHTML = `
        <div class="mod-modal">
            <div class="mod-modal-header"><h3>✏️ تعديل سجل حضور — ${r.employees?.name || ''}</h3>
                <button class="mod-modal-close" onclick="document.getElementById('attEditModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>الحالة</label>
                    <select id="attEditStatus" class="mod-form-input">
                        ${Object.entries(ATT_STATUS_LABEL).map(([v, l]) => `<option value="${v}" ${r.status === v ? 'selected' : ''}>${l}</option>`).join('')}
                    </select></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>وقت الحضور</label>
                        <input type="datetime-local" id="attEditIn" class="mod-form-input" value="${toLocalInput(r.check_in_time)}"></div>
                    <div class="mod-form-group"><label>وقت الانصراف</label>
                        <input type="datetime-local" id="attEditOut" class="mod-form-input" value="${toLocalInput(r.check_out_time)}"></div>
                </div>
                <div class="mod-form-group"><label>ملاحظات</label>
                    <input type="text" id="attEditNotes" class="mod-form-input" value="${r.notes || ''}"></div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:var(--inv-text-soft)" onclick="document.getElementById('attEditModal').remove()">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="attSaveEdit()">💾 حفظ</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
}

window.attSaveEdit = async function() {
    const status = document.getElementById('attEditStatus').value;
    const inVal = document.getElementById('attEditIn').value;
    const outVal = document.getElementById('attEditOut').value;
    const notes = document.getElementById('attEditNotes').value.trim() || null;
    const btn = document.querySelector('#attEditModal .mod-btn-primary');
    btn.innerText = 'جاري الحفظ...'; btn.disabled = true;
    try {
        const payload = {
            status,
            check_in_time: inVal ? new Date(inVal).toISOString() : null,
            check_out_time: outVal ? new Date(outVal).toISOString() : null,
            notes,
        };
        if (_attEditingSynthetic) {
            const { error } = await sb.from('attendance_records').insert({
                ...payload,
                employee_id: _attEditingSynthetic.employee_id,
                record_date: _attEditingSynthetic.record_date,
                recorded_by: currentUser?.id || null,
            });
            if (error) throw error;
        } else {
            const { error } = await sb.from('attendance_records').update(payload).eq('id', _attEditingId);
            if (error) throw error;
        }
        document.getElementById('attEditModal').remove();
        renderAttendance(document.getElementById('app-content'));
    } catch (err) {
        alert('خطأ أثناء الحفظ: ' + err.message);
        btn.innerText = '💾 حفظ'; btn.disabled = false;
    }
};

Object.assign(window, {
    renderAttendance, attCheckIn, attMarkLeave, attMarkAbsent, attCheckOut,
    attLoadHistory, attOpenEdit, attOpenEditSynthetic, attSaveEdit, attSaveShiftDefault,
});
