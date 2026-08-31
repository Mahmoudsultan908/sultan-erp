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
   توحيد الموظفين/المناديب (2026-08-06): الشاشة دي بقت تغطي كل حد
   شغال — موظفين عاديين (employees) ومناديب (sales_reps) مع بعض في
   نفس القائمة، كل واحد معلّم بـ kind: 'employee'|'rep'. سجل الحضور
   بيتكتب بعمود employee_id أو rep_id حسب النوع (راجع
   employees_reps_unification_migration.sql) — مفيش دمج فعلي للجداول
   لأن sales_reps.id هو نفسه auth uid بتاع المندوب، فالدمج هنا على
   مستوى الشاشة بس.
   فيز 2 (مستقبلية): تطبيق موبايل يبصم بيه كل موظف لنفسه — هيستخدم
   نفس منطق "وقت حقيقي + حالة محسوبة" ده بالظبط من غير أي تعديل هنا.
   يصدّر: renderAttendance(container)
   ════════════════════════════════════════════════════════════ */

let _attPeople = []; // employees ∪ sales_reps، كل عنصر معلّم بـ kind
let _attTodayMap = {}; // "kind:id" -> أحدث سجل النهاردة
let _attHistFrom = '';
let _attHistTo = '';
let _attHistRows = []; // سجلات حقيقية + صفوف غياب تلقائي (synthetic:true)
let _attEditingId = null;
let _attEditingSynthetic = null; // {kind, id, record_date} لو بنعدّل صف غياب تلقائي (مفيش سجل حقيقي لسه)
let _attShiftDefault = { start_time: '09:00', grace_minutes: 15 };

function attToday() { return new Date().toISOString().slice(0, 10); }
function attTimeFmt(iso) { return iso ? new Date(iso).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '—'; }
function attTimeShort(t) { return t ? t.slice(0, 5) : ''; }
const ATT_STATUS_LABEL = { present: '✅ حاضر', late: '⚠️ متأخر', absent: '❌ غايب', leave: '🏖️ إجازة' };
const ATT_STATUS_COLOR = { present: 'var(--inv-green)', late: 'var(--inv-gold)', absent: 'var(--inv-red)', leave: '#7C3AED' };

function attKey(kind, id) { return kind + ':' + id; }
function attFindPerson(key) { return _attPeople.find(p => attKey(p.kind, p.id) === key); }
function attPersonName(p) { return p?.name || '—'; }

// موعد الدوام الفعلي للشخص: تخصيص شخصي (من شاشة الموظفون) أو الإعداد العام
function attShiftFor(person) {
    return {
        start_time: person?.shift_start_time || _attShiftDefault.start_time || null,
        grace_minutes: person?.grace_minutes != null ? person.grace_minutes : (_attShiftDefault.grace_minutes ?? 0),
    };
}

// الحالة بتتحسب من وقت البصمة نفسه — مفيش اختيار يدوي
function attComputeStatus(person, checkInIso) {
    const shift = attShiftFor(person);
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
        const [{ data: employees }, { data: reps }, { data: todayRecords }, { data: settingsRow }] = await Promise.all([
            sb.from('employees').select('*').eq('is_active', true).order('name'),
            sb.from('sales_reps').select('*').eq('is_active', true).order('name'),
            sb.from('attendance_records').select('*').eq('record_date', today),
            sb.from('app_settings').select('value').eq('key', 'attendance_shift_default').maybeSingle(),
        ]);
        _attPeople = [
            ...(employees || []).map(e => ({ ...e, kind: 'employee', job_title: e.job_title || 'موظف' })),
            ...(reps || []).map(r => ({ ...r, kind: 'rep', job_title: 'مندوب مبيعات' })),
        ].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
        _attTodayMap = {};
        (todayRecords || []).forEach(r => {
            const kind = r.rep_id ? 'rep' : 'employee';
            const id = r.rep_id || r.employee_id;
            _attTodayMap[attKey(kind, id)] = r;
        });
        if (settingsRow?.value) _attShiftDefault = Object.assign({}, _attShiftDefault, settingsRow.value);

        if (!_attHistFrom) { _attHistFrom = today; _attHistTo = today; }

        c.innerHTML = `
            <div style="margin-bottom:20px"><h2 style="font-size:22px;font-weight:800">🕐 الحضور والانصراف</h2>
            <p style="font-size:13px;color:var(--inv-muted);margin-top:4px">بصمة بضغطة واحدة — موظفين ومناديب مع بعض، والحالة بتتحسب أوتوماتيك من وقت البصمة، والغياب بيتحسب تلقائي لمين مبصمش</p></div>

            <div class="mod-card" style="padding:14px;margin-bottom:20px;display:flex;gap:14px;align-items:end;flex-wrap:wrap">
                <div><label class="ob-label">⚙️ موعد الدوام العام</label><input type="time" id="attShiftStart" class="ob-input" style="margin:0" value="${attTimeShort(_attShiftDefault.start_time)}"></div>
                <div><label class="ob-label">فترة السماح (دقيقة)</label><input type="number" id="attShiftGrace" class="ob-input" style="margin:0;width:100px" min="0" step="1" value="${_attShiftDefault.grace_minutes ?? 15}"></div>
                <button class="ob-add-btn" onclick="attSaveShiftDefault()">💾 حفظ</button>
                <span style="font-size:11.5px;color:var(--inv-muted-light)">ينطبق على أي حد (موظف/مندوب) إلا لو له موعد مخصص من شاشة "👥 الموظفون"</span>
            </div>

            <h3 style="font-size:15px;font-weight:800;margin-bottom:10px">📅 حضور اليوم — ${new Date(today).toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</h3>
            <div class="mod-table-wrap" style="margin-bottom:26px">
                <table class="mod-table"><thead><tr>
                    <th>الاسم</th><th>النوع</th><th>الحضور</th><th>الانصراف</th><th>الحالة</th><th style="text-align:center">إجراء</th>
                </tr></thead>
                <tbody id="attTodayBody">${attTodayRowsHtml()}</tbody></table>
            </div>

            <h3 style="font-size:15px;font-weight:800;margin-bottom:10px">📜 سجل الحضور</h3>
            <div class="mod-card" style="padding:14px;display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin-bottom:16px">
                <div><label class="ob-label">من تاريخ</label><input type="date" id="attFrom" class="ob-input" style="margin:0" value="${_attHistFrom}"></div>
                <div><label class="ob-label">إلى تاريخ</label><input type="date" id="attTo" class="ob-input" style="margin:0" value="${_attHistTo}"></div>
                <select id="attEmpFilter" class="ob-input" style="margin:0;min-width:160px">
                    <option value="">الكل</option>
                    ${_attPeople.map(p => `<option value="${attKey(p.kind, p.id)}">${p.kind === 'rep' ? '🚗 ' : '👔 '}${p.name}</option>`).join('')}
                </select>
                <button class="ob-add-btn" onclick="attLoadHistory()">🔍 عرض</button>
            </div>
            <div class="mod-table-wrap">
                <table class="mod-table"><thead><tr>
                    <th>التاريخ</th><th>الاسم</th><th>الحضور</th><th>الانصراف</th><th>الحالة</th><th>ملاحظات</th><th style="text-align:center"></th>
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
    if (!_attPeople.length) return `<tr><td colspan="6" class="empty-state"><span>👥</span>لا يوجد موظفين أو مناديب نشطين — أضف من "👥 الموظفون"</td></tr>`;
    return _attPeople.map(p => {
        const key = attKey(p.kind, p.id);
        const r = _attTodayMap[key];
        const statusChip = r ? `<span style="color:${ATT_STATUS_COLOR[r.status] || 'var(--inv-muted)'};font-weight:700">${ATT_STATUS_LABEL[r.status] || r.status}</span>` : '<span style="color:var(--inv-muted-light)">لسه ما بصمش</span>';
        let action;
        if (!r) {
            action = `<div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap">
                <button class="cc-edit" style="background:var(--inv-green-light);color:var(--inv-green)" onclick="attCheckIn('${key}')">📍 بصمة حضور</button>
                <button class="cc-edit" style="background:#EDE9FE;color:#7C3AED" onclick="attMarkLeave('${key}')">🏖️ إجازة</button>
                <button class="cc-edit" style="background:var(--inv-red-bg);color:var(--inv-red)" onclick="attMarkAbsent('${key}')">❌ غياب</button>
            </div>`;
        } else if (r.check_in_time && !r.check_out_time && r.status !== 'absent' && r.status !== 'leave') {
            action = `<div style="text-align:center"><button class="cc-edit" style="background:#DBEAFE;color:#2563EB" onclick="attCheckOut('${r.id}')">🚪 بصمة انصراف</button></div>`;
        } else {
            action = `<div style="text-align:center"><button class="cc-edit" onclick="attOpenEdit('${r.id}')">✏️ تعديل</button></div>`;
        }
        return `<tr>
            <td><strong>${p.name}</strong></td>
            <td style="color:var(--inv-muted)">${p.kind === 'rep' ? '🚗 مندوب' : '👔 موظف'}</td>
            <td>${attTimeFmt(r?.check_in_time)}</td>
            <td>${attTimeFmt(r?.check_out_time)}</td>
            <td>${statusChip}</td>
            <td>${action}</td>
        </tr>`;
    }).join('');
}

function attPayloadFor(key) {
    const p = attFindPerson(key);
    if (!p) return null;
    return { person: p, base: p.kind === 'rep' ? { rep_id: p.id } : { employee_id: p.id } };
}

// بصمة حضور — وقت حقيقي + حالة محسوبة أوتوماتيك، مفيش اختيار يدوي
window.attCheckIn = async function(key) {
    try {
        const pf = attPayloadFor(key);
        if (!pf) return;
        const now = new Date().toISOString();
        const status = attComputeStatus(pf.person, now);
        const payload = { ...pf.base, record_date: attToday(), status, check_in_time: now, recorded_by: currentUser?.id || null };
        const { error } = await sb.from('attendance_records').insert(payload);
        if (error) throw error;
        const q = sb.from('attendance_records').select('*').eq('record_date', attToday()).order('created_at', { ascending: false }).limit(1);
        const { data } = await (pf.person.kind === 'rep' ? q.eq('rep_id', pf.person.id) : q.eq('employee_id', pf.person.id)).maybeSingle();
        if (data) _attTodayMap[key] = data;
        document.getElementById('attTodayBody').innerHTML = attTodayRowsHtml();
    } catch (err) { alert('خطأ: ' + err.message); }
};

window.attMarkLeave = async function(key) {
    try {
        const pf = attPayloadFor(key);
        if (!pf) return;
        const payload = { ...pf.base, record_date: attToday(), status: 'leave', recorded_by: currentUser?.id || null };
        const { error } = await sb.from('attendance_records').insert(payload);
        if (error) throw error;
        const q = sb.from('attendance_records').select('*').eq('record_date', attToday()).order('created_at', { ascending: false }).limit(1);
        const { data } = await (pf.person.kind === 'rep' ? q.eq('rep_id', pf.person.id) : q.eq('employee_id', pf.person.id)).maybeSingle();
        if (data) _attTodayMap[key] = data;
        document.getElementById('attTodayBody').innerHTML = attTodayRowsHtml();
    } catch (err) { alert('خطأ: ' + err.message); }
};

window.attMarkAbsent = async function(key) {
    if (!confirm('تسجيل غياب النهاردة؟')) return;
    try {
        const pf = attPayloadFor(key);
        if (!pf) return;
        const payload = { ...pf.base, record_date: attToday(), status: 'absent', recorded_by: currentUser?.id || null };
        const { error } = await sb.from('attendance_records').insert(payload);
        if (error) throw error;
        const q = sb.from('attendance_records').select('*').eq('record_date', attToday()).order('created_at', { ascending: false }).limit(1);
        const { data } = await (pf.person.kind === 'rep' ? q.eq('rep_id', pf.person.id) : q.eq('employee_id', pf.person.id)).maybeSingle();
        if (data) _attTodayMap[key] = data;
        document.getElementById('attTodayBody').innerHTML = attTodayRowsHtml();
    } catch (err) { alert('خطأ: ' + err.message); }
};

window.attCheckOut = async function(recordId) {
    try {
        const { error } = await sb.from('attendance_records').update({ check_out_time: new Date().toISOString() }).eq('id', recordId);
        if (error) throw error;
        const key = Object.keys(_attTodayMap).find(k => _attTodayMap[k].id === recordId);
        if (key) _attTodayMap[key].check_out_time = new Date().toISOString();
        document.getElementById('attTodayBody').innerHTML = attTodayRowsHtml();
    } catch (err) { alert('خطأ: ' + err.message); }
};

window.attLoadHistory = async function() {
    const from = document.getElementById('attFrom')?.value || _attHistFrom;
    const to = document.getElementById('attTo')?.value || _attHistTo;
    const filterKey = document.getElementById('attEmpFilter')?.value || '';
    _attHistFrom = from; _attHistTo = to;
    const tbody = document.getElementById('attHistBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--inv-muted)">⏳ جاري التحميل...</td></tr>`;
    try {
        let q = sb.from('attendance_records').select('*, employees(name), sales_reps(name)').gte('record_date', from).lte('record_date', to).order('record_date', { ascending: false });
        if (filterKey) {
            const p = attFindPerson(filterKey);
            if (p) q = p.kind === 'rep' ? q.eq('rep_id', p.id) : q.eq('employee_id', p.id);
        }
        const { data, error } = await q.limit(600);
        if (error) throw error;
        const real = data || [];
        const synthetic = attSynthesizeAbsences(from, to, filterKey, real);
        _attHistRows = real.concat(synthetic).sort((a, b) => b.record_date.localeCompare(a.record_date));
        attRenderHistory();
    } catch (err) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="color:var(--inv-red);text-align:center;padding:20px">خطأ: ${err.message}</td></tr>`;
    }
};

// غياب تلقائي: أي شخص نشط (موظف أو مندوب، متعيّن قبل أو في اليوم ده)
// مالوش أي سجل في يوم فات (قبل النهاردة) بيتحط "غايب" في العرض بس، من غير
// ما نكتب صف فعلي في القاعدة — بيتحوّل لصف حقيقي لو المشرف دخل يعدّله.
// محدود بـ 92 يوم كحد أقصى لكل استعلام عشان الحساب يفضل خفيف.
function attSynthesizeAbsences(from, to, filterKey, realRows) {
    const today = attToday();
    const cappedTo = to < today ? to : new Date(Date.now() - 86400000).toISOString().slice(0, 10); // مستبعد النهاردة، لسه ما خلصش
    if (from > cappedTo) return [];
    const dates = [];
    let d = new Date(from);
    const end = new Date(cappedTo);
    let guard = 0;
    while (d <= end && guard < 92) { dates.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); guard++; }

    const hasRecord = new Set(realRows.map(r => (r.rep_id ? 'rep:' + r.rep_id : 'employee:' + r.employee_id) + '|' + r.record_date));
    const people = filterKey ? _attPeople.filter(p => attKey(p.kind, p.id) === filterKey) : _attPeople;
    const out = [];
    people.forEach(p => {
        dates.forEach(dt => {
            if (p.hire_date && p.hire_date > dt) return; // لسه ما اتعيّنش وقتها
            if (hasRecord.has(attKey(p.kind, p.id) + '|' + dt)) return;
            out.push({
                id: null, employee_id: p.kind === 'employee' ? p.id : null, rep_id: p.kind === 'rep' ? p.id : null,
                employees: p.kind === 'employee' ? { name: p.name } : null, sales_reps: p.kind === 'rep' ? { name: p.name } : null,
                record_date: dt, status: 'absent', check_in_time: null, check_out_time: null, notes: null, synthetic: true,
            });
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
        <td><strong>${r.employees?.name || r.sales_reps?.name || '—'}</strong>${r.rep_id ? ' <small style="color:var(--inv-muted-light)">🚗</small>' : ''}</td>
        <td>${attTimeFmt(r.check_in_time)}</td>
        <td>${attTimeFmt(r.check_out_time)}</td>
        <td style="color:${ATT_STATUS_COLOR[r.status] || 'var(--inv-muted)'};font-weight:700">${ATT_STATUS_LABEL[r.status] || r.status || '—'}${r.synthetic ? ' <small style="color:var(--inv-muted-light);font-weight:400">(تلقائي)</small>' : ''}</td>
        <td style="color:var(--inv-muted);font-size:12px">${r.notes || '—'}</td>
        <td style="text-align:center">${r.synthetic
            ? `<button class="cc-edit" onclick="attOpenEditSynthetic('${r.rep_id ? 'rep' : 'employee'}','${r.rep_id || r.employee_id}','${r.record_date}')">✏️</button>`
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

window.attOpenEditSynthetic = function(kind, personId, recordDate) {
    _attEditingId = null;
    _attEditingSynthetic = { kind, id: personId, record_date: recordDate };
    const p = _attPeople.find(x => x.kind === kind && x.id === personId);
    attRenderEditModal({ status: 'absent', check_in_time: null, check_out_time: null, notes: null, employees: kind === 'employee' ? { name: p?.name } : null, sales_reps: kind === 'rep' ? { name: p?.name } : null });
};

function attRenderEditModal(r) {
    const toLocalInput = (iso) => iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    const name = r.employees?.name || r.sales_reps?.name || '';
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'attEditModal';
    modal.innerHTML = `
        <div class="mod-modal">
            <div class="mod-modal-header"><h3>✏️ تعديل سجل حضور — ${name}</h3>
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
                employee_id: _attEditingSynthetic.kind === 'employee' ? _attEditingSynthetic.id : null,
                rep_id: _attEditingSynthetic.kind === 'rep' ? _attEditingSynthetic.id : null,
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
