/* ════════════════════════════════════════════════════════════
   الحضور والانصراف — attendance.js
   بند 11، تقرير 2026-07-21. تسجيل يدوي (المشرف يسجّل لكل موظف) —
   قابل للترقية لـ QR لاحقًا من غير أي تغيير فى الـDB (نفس جدول
   attendance_records، الترقية هتبقى بس فى طريقة إدخال البيانات).
   بُني جوه Sultan ERP مباشرة (مش WorkFlow Hub) بقرار صريح من المستخدم.
   يصدّر: renderAttendance(container)
   ════════════════════════════════════════════════════════════ */

let _attEmployees = [];
let _attTodayMap = {}; // employee_id -> أحدث سجل النهاردة
let _attHistFrom = '';
let _attHistTo = '';
let _attHistRows = [];
let _attEditingId = null;

function attToday() { return new Date().toISOString().slice(0, 10); }
function attTimeFmt(iso) { return iso ? new Date(iso).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '—'; }
const ATT_STATUS_LABEL = { present: '✅ حاضر', late: '⚠️ متأخر', absent: '❌ غايب', leave: '🏖️ إجازة' };
const ATT_STATUS_COLOR = { present: '#059669', late: '#D97706', absent: '#DC2626', leave: '#7C3AED' };

async function renderAttendance(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات الحضور...</div>';
    try {
        const today = attToday();
        const [{ data: employees }, { data: todayRecords }] = await Promise.all([
            sb.from('employees').select('*').eq('is_active', true).order('name'),
            sb.from('attendance_records').select('*').eq('record_date', today),
        ]);
        _attEmployees = employees || [];
        _attTodayMap = {};
        (todayRecords || []).forEach(r => { _attTodayMap[r.employee_id] = r; });

        if (!_attHistFrom) { _attHistFrom = today; _attHistTo = today; }

        c.innerHTML = `
            <div style="margin-bottom:20px"><h2 style="font-size:22px;font-weight:800">🕐 الحضور والانصراف</h2>
            <p style="font-size:13px;color:#64748B;margin-top:4px">تسجيل حضور وانصراف الموظفين يوميًا — تسجيل يدوي بواسطة المشرف</p></div>

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
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function attTodayRowsHtml() {
    if (!_attEmployees.length) return `<tr><td colspan="6" class="empty-state"><span>👥</span>لا يوجد موظفين نشطين — أضف موظف من "👥 الموظفون والرواتب"</td></tr>`;
    return _attEmployees.map(emp => {
        const r = _attTodayMap[emp.id];
        const statusChip = r ? `<span style="color:${ATT_STATUS_COLOR[r.status] || '#64748B'};font-weight:700">${ATT_STATUS_LABEL[r.status] || r.status}</span>` : '<span style="color:#94A3B8">لم يُسجَّل</span>';
        let action;
        if (!r) {
            action = `<div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap">
                <button class="cc-edit" style="background:#D1FAE5;color:#059669" onclick="attCheckIn('${emp.id}','present')">✅ حاضر</button>
                <button class="cc-edit" style="background:#FEF3C7;color:#D97706" onclick="attCheckIn('${emp.id}','late')">⚠️ متأخر</button>
                <button class="cc-edit" style="background:#FEE2E2;color:#DC2626" onclick="attCheckIn('${emp.id}','absent')">❌ غايب</button>
                <button class="cc-edit" style="background:#EDE9FE;color:#7C3AED" onclick="attCheckIn('${emp.id}','leave')">🏖️ إجازة</button>
            </div>`;
        } else if (r.check_in_time && !r.check_out_time && r.status !== 'absent' && r.status !== 'leave') {
            action = `<div style="text-align:center"><button class="cc-edit" style="background:#DBEAFE;color:#2563EB" onclick="attCheckOut('${r.id}')">🚪 تسجيل انصراف</button></div>`;
        } else {
            action = `<div style="text-align:center"><button class="cc-edit" onclick="attOpenEdit('${r.id}')">✏️ تعديل</button></div>`;
        }
        return `<tr>
            <td><strong>${emp.name}</strong></td>
            <td style="color:#64748B">${emp.job_title || '—'}</td>
            <td>${attTimeFmt(r?.check_in_time)}</td>
            <td>${attTimeFmt(r?.check_out_time)}</td>
            <td>${statusChip}</td>
            <td>${action}</td>
        </tr>`;
    }).join('');
}

window.attCheckIn = async function(employeeId, status) {
    try {
        const payload = { employee_id: employeeId, record_date: attToday(), status, recorded_by: currentUser?.id || null };
        if (status === 'present' || status === 'late') payload.check_in_time = new Date().toISOString();
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
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:#64748B">⏳ جاري التحميل...</td></tr>`;
    try {
        let q = sb.from('attendance_records').select('*, employees(name)').gte('record_date', from).lte('record_date', to).order('record_date', { ascending: false });
        if (empId) q = q.eq('employee_id', empId);
        const { data, error } = await q.limit(300);
        if (error) throw error;
        _attHistRows = data || [];
        attRenderHistory();
    } catch (err) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="color:#991B1B;text-align:center;padding:20px">خطأ: ${err.message}</td></tr>`;
    }
};

function attRenderHistory() {
    const tbody = document.getElementById('attHistBody');
    if (!tbody) return;
    if (!_attHistRows.length) { tbody.innerHTML = `<tr><td colspan="7" class="empty-state"><span>📜</span>لا توجد سجلات فى الفترة دي</td></tr>`; return; }
    tbody.innerHTML = _attHistRows.map(r => `<tr>
        <td>${new Date(r.record_date).toLocaleDateString('ar-EG')}</td>
        <td><strong>${r.employees?.name || '—'}</strong></td>
        <td>${attTimeFmt(r.check_in_time)}</td>
        <td>${attTimeFmt(r.check_out_time)}</td>
        <td style="color:${ATT_STATUS_COLOR[r.status] || '#64748B'};font-weight:700">${ATT_STATUS_LABEL[r.status] || r.status || '—'}</td>
        <td style="color:#64748B;font-size:12px">${r.notes || '—'}</td>
        <td style="text-align:center"><button class="cc-edit" onclick="attOpenEdit('${r.id}')">✏️</button></td>
    </tr>`).join('');
}

window.attOpenEdit = function(recordId) {
    const r = _attHistRows.find(x => x.id === recordId) || Object.values(_attTodayMap).find(x => x.id === recordId);
    if (!r) return;
    _attEditingId = recordId;
    const toLocalInput = (iso) => iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'attEditModal';
    modal.innerHTML = `
        <div class="mod-modal">
            <div class="mod-modal-header"><h3>✏️ تعديل سجل حضور</h3>
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
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="document.getElementById('attEditModal').remove()">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="attSaveEdit()">💾 حفظ</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
};

window.attSaveEdit = async function() {
    const status = document.getElementById('attEditStatus').value;
    const inVal = document.getElementById('attEditIn').value;
    const outVal = document.getElementById('attEditOut').value;
    const notes = document.getElementById('attEditNotes').value.trim() || null;
    const btn = document.querySelector('#attEditModal .mod-btn-primary');
    btn.innerText = 'جاري الحفظ...'; btn.disabled = true;
    try {
        const { error } = await sb.from('attendance_records').update({
            status,
            check_in_time: inVal ? new Date(inVal).toISOString() : null,
            check_out_time: outVal ? new Date(outVal).toISOString() : null,
            notes,
        }).eq('id', _attEditingId);
        if (error) throw error;
        document.getElementById('attEditModal').remove();
        renderAttendance(document.getElementById('app-content'));
    } catch (err) {
        alert('خطأ أثناء الحفظ: ' + err.message);
        btn.innerText = '💾 حفظ'; btn.disabled = false;
    }
};

Object.assign(window, {
    renderAttendance, attCheckIn, attCheckOut, attLoadHistory, attOpenEdit, attSaveEdit,
});
