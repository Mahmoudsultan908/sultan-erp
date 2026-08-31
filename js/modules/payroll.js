/* ════════════════════════════════════════════════════════════
   الموظفون والرواتب — payroll.js
   يصدّر: renderPayroll(container), prlShowStatement(kind, id)

   ★ قرار تصميم صريح من صاحب المشروع: المرتبات مش نظام مالي مستقل —
   employees جدول بيانات أساسية بس (زي sales_reps)، بدون أي trigger.
   أي صرف فعلي لموظف (سلفة أو راتب) بيتسجّل كمصروف عادي في جدول
   expenses الموجود بالفعل (نفس مسار fn_expense_status_change المالي)
   بعمود employee_id/rep_id اللي بيربط المصروف بشخص — فـ"الباقي من
   الراتب" = base_salary - مجموع مصروفات الشخص في الشهر. صفر تكرار
   مالي، صفر trigger جديد. راجع employees_payroll_migration.sql.

   توحيد الموظفين/المناديب (2026-08-06): الشاشة دي بقت تعرض كل حد
   شغال — موظفين عاديين (employees) ومناديب مبيعات (sales_reps) مع
   بعض في نفس الجدول، كل واحد معلّم بـ kind: 'employee'|'rep'.
   sales_reps.id هو نفسه auth uid بتاع المندوب (تسجيل دخول تطبيق
   سلطانو)، فمفيش دمج فعلي للجداول — الدمج على مستوى الشاشة بس
   (راجع employees_reps_unification_migration.sql). المناديب لازم
   يتضافوا من "⚙️ الإعدادات ← 👥 المستخدمون" (محتاجين حساب دخول
   فعلي) — من هنا بس بتتعدّل بياناتهم (مرتب/عمولة/هدف/دوام) ويظهر
   كشف حسابهم الكامل. كشف الحساب بقى بيجمع تلقائي: مرتب أساسي −
   خصم غياب − سلف/مصروفات + حوافز + عمولة مبيعات الشهر (مناديب بس)،
   وبيعرض تحقيق الهدف الشهري (مناديب بس) — بدون أي حساب يدوي.
   نفس الدالة دي بتتنادى من sales-reps.js (زرار "📄 كشف مبيعات")
   عشان يبقى مصدر واحد للحقيقة في أي مكان تفتحها منه.
   ════════════════════════════════════════════════════════════ */

let _prlList = []; // employees ∪ sales_reps، كل عنصر معلّم بـ kind
let _prlEditingKey = null; // {kind,id} أو null لإضافة موظف جديد
let _prlTableMissing = false;
let _prlLastEvalMap = {}; // employee_id -> { date, avg } — موظفين عاديين بس (تقييم الأداء برّه نطاق المناديب)
let _prlPriceLevels = [];
let _prlTreasuries = [];

function prlEvalColor(avg) {
    if (avg >= 9) return { color: 'var(--inv-green)', bg: 'var(--inv-green-light)' };
    if (avg >= 7) return { color: '#2563EB', bg: '#EFF6FF' };
    if (avg >= 5) return { color: 'var(--inv-gold)', bg: 'var(--inv-gold-bg)' };
    if (avg >= 3) return { color: '#EA580C', bg: '#FFF7ED' };
    return { color: 'var(--inv-red)', bg: 'var(--inv-red-bg)' };
}

function prlFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function prlKey(kind, id) { return kind + ':' + id; }

// ════════════════════════════════════════════════════════════
// 1) القائمة الرئيسية
// ════════════════════════════════════════════════════════════
async function renderPayroll(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل الموظفين...</div>';
    _prlTableMissing = false;
    try {
        let employees = [], reps = [];
        try {
            const { data, error } = await sb.from('employees').select('*').order('name');
            if (error) throw error;
            employees = data || [];
        } catch (e) { _prlTableMissing = true; }
        try {
            const { data, error } = await sb.from('sales_reps').select('*').order('name');
            if (error) throw error;
            reps = data || [];
        } catch (e) { /* بهدوء — لو الجدول مش موجود، الموظفين العاديين لسه بيظهروا */ }

        _prlList = [
            ...employees.map(e => ({ ...e, kind: 'employee' })),
            ...reps.map(r => ({ ...r, kind: 'rep' })),
        ].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));

        // آخر تقييم لكل موظف عادي — اختياري، لو جدول employee_evaluations لسه ما اتعملش نتجاهل الخطأ بهدوء
        const evalResult = await sb.from('employee_evaluations')
            .select('employee_id, evaluation_date, attendance_score, quality_score, teamwork_score, initiative_score, compliance_score')
            .then(r => r, () => ({ data: [] }));
        _prlLastEvalMap = {};
        (evalResult?.data || []).forEach(x => {
            if (!_prlLastEvalMap[x.employee_id] || x.evaluation_date > _prlLastEvalMap[x.employee_id].date) {
                const avg = (Number(x.attendance_score) + Number(x.quality_score) + Number(x.teamwork_score) + Number(x.initiative_score) + Number(x.compliance_score)) / 5;
                _prlLastEvalMap[x.employee_id] = { date: x.evaluation_date, avg };
            }
        });

        const [{ data: levels }, { data: treasuries }] = await Promise.all([
            sb.from('price_levels').select('id,code,name').order('sort_order').then(r => r, () => ({ data: [] })),
            sb.from('treasuries').select('id,name').order('name').then(r => r, () => ({ data: [] })),
        ]);
        _prlPriceLevels = levels || [];
        _prlTreasuries = treasuries || [];

        prlRenderPage(c);
    } catch (err) {
        c.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function prlRenderPage(c) {
    const active = _prlList.filter(p => p.is_active !== false);
    const totalBase = active.reduce((s, p) => s + (Number(p.base_salary) || 0), 0);
    const repCount = active.filter(p => p.kind === 'rep').length;

    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px">
            <div><h2 style="font-size:22px;font-weight:800">👥 الموظفون</h2>
            <p style="font-size:13px;color:var(--inv-muted);margin-top:4px">موظفين ومناديب مع بعض — حضور، مرتب، عمولة وهدف بيتحسبوا تلقائي</p></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button class="mod-btn" style="background:#EEF2FF;color:#4338CA" onclick="prlGoAddRep()">+ مندوب جديد (يحتاج حساب دخول)</button>
                <button class="mod-btn mod-btn-primary" onclick="prlOpenAdd()">+ إضافة موظف</button>
            </div>
        </div>

        ${_prlTableMissing ? `<div style="background:var(--inv-gold-bg);color:var(--inv-gold);padding:14px 18px;border-radius:10px;margin-bottom:16px;font-size:13px">⚠️ جدول الموظفين لسه مش موجود — شغّل <code>employees_payroll_migration.sql</code> في Supabase.</div>` : ''}

        <div class="mod-grid" style="margin-bottom:16px">
            <div class="mod-card"><div class="mod-card-icon" style="background:var(--inv-green-light);color:var(--inv-green)">👥</div><div class="mod-card-val">${active.length}</div><div class="mod-card-lbl">إجمالي النشطين (${repCount} مندوب)</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:var(--inv-gold-bg);color:var(--inv-gold)">💰</div><div class="mod-card-val">${prlFmt(totalBase)}</div><div class="mod-card-lbl">إجمالي الرواتب الأساسية</div></div>
        </div>

        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>الاسم</th><th>النوع</th><th>الهاتف</th><th>تفاصيل</th><th>آخر تقييم</th>
                <th style="text-align:left">الراتب الأساسي</th><th style="text-align:center">الحالة</th><th style="text-align:center">إجراءات</th>
            </tr></thead>
            <tbody>
                ${_prlList.length === 0 ? `<tr><td colspan="8" class="empty-state"><span>👥</span>لا يوجد موظفون أو مناديب بعد.</td></tr>` :
                _prlList.map(p => {
                    const key = prlKey(p.kind, p.id);
                    const lastEval = p.kind === 'employee' ? _prlLastEvalMap[p.id] : null;
                    const details = p.kind === 'rep'
                        ? `عمولة ${Number(p.commission_pct) || 0}% • هدف ${prlFmt(p.daily_sales_target)}/يوم`
                        : (p.job_title || '—');
                    return `<tr>
                    <td style="font-weight:600">${p.name}</td>
                    <td>${p.kind === 'rep' ? '<span style="color:#4338CA;font-weight:700">🚗 مندوب</span>' : '<span style="color:var(--inv-muted)">👔 موظف</span>'}</td>
                    <td dir="ltr" style="color:var(--inv-muted)">${p.phone || '—'}</td>
                    <td style="color:var(--inv-muted);font-size:12.5px">${details}</td>
                    <td style="font-size:12px">${lastEval ? `${new Date(lastEval.date).toLocaleDateString('ar-EG')} <span style="background:${prlEvalColor(lastEval.avg).bg};color:${prlEvalColor(lastEval.avg).color};padding:1px 8px;border-radius:10px;font-weight:700;margin-right:4px">${lastEval.avg.toFixed(1)}</span>` : '<span style="color:var(--inv-muted-light)">—</span>'}</td>
                    <td style="text-align:left;font-weight:700">${prlFmt(p.base_salary)}</td>
                    <td style="text-align:center">${p.is_active !== false ? '<span style="color:var(--inv-green);font-weight:600">✅ نشط</span>' : '<span style="color:var(--inv-muted-light);font-weight:600">🚫 غير نشط</span>'}</td>
                    <td style="text-align:center;white-space:nowrap">
                        <button class="cc-edit" onclick="prlOpenEdit('${p.kind}','${p.id}')">✏️</button>
                        <button class="cc-edit" style="background:var(--inv-gold-bg);color:var(--inv-gold)" onclick="prlShowStatement('${p.kind}','${p.id}')">📄 كشف حساب</button>
                        ${p.kind === 'employee' && typeof eevOpenAdd === 'function' ? `<button class="cc-edit" style="background:#FEF9C3;color:#B45309" onclick="eevOpenAdd('${p.id}')" title="تقييم سريع">⭐</button>` : ''}
                    </td>
                </tr>`;
                }).join('')}
            </tbody></table>
        </div>`;
}

window.prlGoAddRep = function () {
    alert('إضافة مندوب مبيعات محتاجة حساب دخول فعلي (إيميل/باسورد) — هيتوجّه لك الآن لشاشة "⚙️ الإعدادات"، دوس على تبويب "👥 المستخدمون" وأضف مستخدم بصلاحية "مندوب".');
    const nav = document.querySelector('[data-mod="settings-hub"]');
    if (nav) loadMod(nav, 'settings-hub');
};

// ════════════════════════════════════════════════════════════
// 2) إضافة / تعديل موظف عادي
// ════════════════════════════════════════════════════════════
window.prlOpenAdd = function () { _prlEditingKey = null; prlOpenEmployeeModal(null); };
window.prlOpenEdit = function (kind, id) {
    const p = _prlList.find(x => x.kind === kind && x.id === id);
    if (!p) return;
    _prlEditingKey = { kind, id };
    if (kind === 'rep') prlOpenRepModal(p); else prlOpenEmployeeModal(p);
};

function prlOpenEmployeeModal(x) {
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'prlModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:480px">
            <div class="mod-modal-header"><h3>${x ? '✏️ تعديل موظف' : '👔 إضافة موظف جديد'}</h3>
                <button class="mod-modal-close" onclick="document.getElementById('prlModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>اسم الموظف *</label>
                    <input type="text" id="prlName" class="mod-form-input" value="${x?.name || ''}"></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>الوظيفة</label>
                        <input type="text" id="prlJobTitle" class="mod-form-input" value="${x?.job_title || ''}" placeholder="مثال: محاسب"></div>
                    <div class="mod-form-group"><label>الهاتف</label>
                        <input type="text" id="prlPhone" class="mod-form-input" value="${x?.phone || ''}" dir="ltr"></div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>الراتب الأساسي (ج.م) *</label>
                        <input type="number" id="prlBaseSalary" class="mod-form-input" value="${x?.base_salary || 0}" min="0" step="0.01"></div>
                    <div class="mod-form-group"><label>تاريخ التعيين</label>
                        <input type="date" id="prlHireDate" class="mod-form-input" value="${x?.hire_date || ''}"></div>
                </div>
                <div class="mod-form-group"><label>أيام العمل بالشهر</label>
                    <input type="number" id="prlWorkDays" class="mod-form-input" value="${x?.work_days_per_month ?? 30}" min="1" max="31" step="1">
                    <div style="font-size:11px;color:var(--inv-muted-light);margin-top:3px">بيتحسب منها سعر يوم الغياب = الراتب الأساسي ÷ أيام العمل</div></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>موعد دوام مخصص (اختياري)</label>
                        <input type="time" id="prlShiftStart" class="mod-form-input" value="${x?.shift_start_time ? String(x.shift_start_time).slice(0,5) : ''}"></div>
                    <div class="mod-form-group"><label>فترة سماح مخصصة بالدقايق (اختياري)</label>
                        <input type="number" id="prlGraceMinutes" class="mod-form-input" min="0" step="1" value="${x?.grace_minutes ?? ''}"></div>
                </div>
                <div style="font-size:11px;color:var(--inv-muted-light);margin:-6px 0 6px">لو سيبتهم فاضيين، هيتطبّق عليه موعد الدوام العام من شاشة "الحضور والانصراف"</div>
                <div class="mod-form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                    <input type="checkbox" id="prlIsActive" ${x?.is_active !== false ? 'checked' : ''}> نشط
                </label></div>
                <div class="mod-form-group"><label>ملاحظات</label>
                    <input type="text" id="prlNotes" class="mod-form-input" value="${x?.notes || ''}" placeholder="اختياري"></div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:var(--inv-text-soft)" onclick="document.getElementById('prlModal').remove()">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="prlSave()">💾 ${x ? 'حفظ التعديلات' : 'إضافة الموظف'}</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    setTimeout(() => document.getElementById('prlName')?.focus(), 50);
}

window.prlSave = async function () {
    const name = document.getElementById('prlName').value.trim();
    const base_salary = parseFloat(document.getElementById('prlBaseSalary').value) || 0;
    if (!name) return alert('اسم الموظف مطلوب');
    if (base_salary <= 0) return alert('الراتب الأساسي يجب أن يكون أكبر من صفر');

    const payload = {
        name,
        job_title: document.getElementById('prlJobTitle').value.trim() || null,
        phone: document.getElementById('prlPhone').value.trim() || null,
        base_salary,
        hire_date: document.getElementById('prlHireDate').value || null,
        is_active: document.getElementById('prlIsActive').checked,
        notes: document.getElementById('prlNotes').value.trim() || null,
        work_days_per_month: parseInt(document.getElementById('prlWorkDays').value, 10) || 30,
        shift_start_time: document.getElementById('prlShiftStart').value || null,
        grace_minutes: document.getElementById('prlGraceMinutes').value !== '' ? parseInt(document.getElementById('prlGraceMinutes').value, 10) : null,
    };

    const btn = document.querySelector('#prlModal .mod-btn-primary');
    btn.innerText = '⏳ جاري الحفظ...'; btn.disabled = true;
    try {
        if (_prlEditingKey) {
            const { error } = await sb.from('employees').update(payload).eq('id', _prlEditingKey.id);
            if (error) throw error;
        } else {
            const { error } = await sb.from('employees').insert({ ...payload, created_by: currentUser?.id || null });
            if (error) throw error;
        }
        document.getElementById('prlModal').remove();
        renderPayroll(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ: ' + err.message + (_prlTableMissing ? '\n\nتأكد من تشغيل employees_payroll_migration.sql في Supabase.' : ''));
        btn.innerText = '💾 حفظ'; btn.disabled = false;
    }
};

// ════════════════════════════════════════════════════════════
// 2ب) تعديل مندوب (بيانات المبيعات + بيانات المرتب/الدوام مع بعض)
// ════════════════════════════════════════════════════════════
function prlOpenRepModal(x) {
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'prlModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:520px">
            <div class="mod-modal-header"><h3>✏️ تعديل مندوب — ${x.name}</h3>
                <button class="mod-modal-close" onclick="document.getElementById('prlModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>الهاتف</label>
                        <input type="text" id="prlRepPhone" class="mod-form-input" value="${x.phone || ''}" dir="ltr"></div>
                    <div class="mod-form-group"><label>نسبة العمولة %</label>
                        <input type="number" id="prlRepCommission" class="mod-form-input" value="${x.commission_pct || 0}" min="0" max="100" step="0.1"></div>
                </div>
                <div class="mod-form-group"><label>مستوى السعر اللي يبيع بيه</label>
                    <select id="prlRepPriceLevel" class="mod-form-input">
                        <option value="">بدون تحديد (افتراضي النظام)</option>
                        ${_prlPriceLevels.map(l => `<option value="${l.id}" ${x.price_level_id===l.id?'selected':''}>💰 ${l.name}</option>`).join('')}
                    </select></div>
                <hr style="border:none;border-top:1px solid var(--inv-border);margin:14px 0">
                <div style="font-size:12.5px;font-weight:800;margin-bottom:10px;color:var(--inv-muted)">💰 المرتب والدوام</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>الراتب الأساسي (ج.م)</label>
                        <input type="number" id="prlRepBaseSalary" class="mod-form-input" value="${x.base_salary || 0}" min="0" step="0.01"></div>
                    <div class="mod-form-group"><label>تاريخ التعيين</label>
                        <input type="date" id="prlRepHireDate" class="mod-form-input" value="${x.hire_date || ''}"></div>
                </div>
                <div class="mod-form-group"><label>أيام العمل بالشهر</label>
                    <input type="number" id="prlRepWorkDays" class="mod-form-input" value="${x.work_days_per_month ?? 30}" min="1" max="31" step="1"></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>موعد دوام مخصص (اختياري)</label>
                        <input type="time" id="prlRepShiftStart" class="mod-form-input" value="${x.shift_start_time ? String(x.shift_start_time).slice(0,5) : ''}"></div>
                    <div class="mod-form-group"><label>فترة سماح بالدقايق (اختياري)</label>
                        <input type="number" id="prlRepGraceMinutes" class="mod-form-input" min="0" step="1" value="${x.grace_minutes ?? ''}"></div>
                </div>
                <hr style="border:none;border-top:1px solid var(--inv-border);margin:14px 0">
                <div style="font-size:12.5px;font-weight:800;margin-bottom:10px;color:var(--inv-muted)">🎯 الأهداف</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>هدف المبيعات اليومي (ج)</label>
                        <input type="number" id="prlRepDailyTarget" class="mod-form-input" value="${x.daily_sales_target || 0}" min="0" step="1"></div>
                    <div class="mod-form-group"><label>هدف الزيارات اليومي</label>
                        <input type="number" id="prlRepVisitsTarget" class="mod-form-input" value="${x.daily_visits_target || 0}" min="0" step="1"></div>
                </div>
                <div class="mod-form-group"><label>🔒 PIN تحميل العربية <small style="color:var(--inv-muted-light);font-weight:400">(اختياري)</small></label>
                    <input type="text" id="prlRepVanLoadPin" class="mod-form-input" value="${x.van_load_pin || ''}" dir="ltr" maxlength="8"></div>
                <div class="mod-form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                    <input type="checkbox" id="prlRepIsActive" ${x.is_active !== false ? 'checked' : ''}> نشط
                </label></div>
                <div class="mod-form-group"><label>ملاحظات</label>
                    <input type="text" id="prlRepNotes" class="mod-form-input" value="${x.notes || ''}" placeholder="اختياري"></div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:var(--inv-text-soft)" onclick="document.getElementById('prlModal').remove()">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="prlSaveRep()">💾 حفظ التعديلات</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
}

window.prlSaveRep = async function () {
    const payload = {
        phone: document.getElementById('prlRepPhone').value.trim() || null,
        commission_pct: parseFloat(document.getElementById('prlRepCommission').value) || 0,
        price_level_id: document.getElementById('prlRepPriceLevel').value || null,
        base_salary: parseFloat(document.getElementById('prlRepBaseSalary').value) || 0,
        hire_date: document.getElementById('prlRepHireDate').value || null,
        work_days_per_month: parseInt(document.getElementById('prlRepWorkDays').value, 10) || 30,
        shift_start_time: document.getElementById('prlRepShiftStart').value || null,
        grace_minutes: document.getElementById('prlRepGraceMinutes').value !== '' ? parseInt(document.getElementById('prlRepGraceMinutes').value, 10) : null,
        daily_sales_target: parseFloat(document.getElementById('prlRepDailyTarget').value) || 0,
        daily_visits_target: parseInt(document.getElementById('prlRepVisitsTarget').value) || 0,
        van_load_pin: document.getElementById('prlRepVanLoadPin').value.trim() || null,
        is_active: document.getElementById('prlRepIsActive').checked,
        notes: document.getElementById('prlRepNotes').value.trim() || null,
    };
    const btn = document.querySelector('#prlModal .mod-btn-primary');
    btn.innerText = '⏳ جاري الحفظ...'; btn.disabled = true;
    try {
        const { error } = await sb.from('sales_reps').update(payload).eq('id', _prlEditingKey.id);
        if (error) throw error;
        document.getElementById('prlModal').remove();
        renderPayroll(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ: ' + err.message);
        btn.innerText = '💾 حفظ التعديلات'; btn.disabled = false;
    }
};

// ════════════════════════════════════════════════════════════
// 3) كشف حساب — يشتغل لأي شخص (موظف أو مندوب)، بيجمع كل حاجة تلقائي
// ════════════════════════════════════════════════════════════
let _prlStmtKind = null;
let _prlStmtId = null;
let _prlStmtPerson = null;
let _prlStmtMonth = null; // 'YYYY-MM'

window.prlShowStatement = async function (kind, id) {
    _prlStmtKind = kind;
    _prlStmtId = id;
    _prlStmtMonth = new Date().toISOString().slice(0, 7);

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'prlStmtModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:760px">
            <div class="mod-modal-header"><h3 id="prlStmtTitle">📄 كشف حساب</h3>
                <button class="mod-modal-close" onclick="document.getElementById('prlStmtModal').remove()">&times;</button></div>
            <div class="mod-modal-body" id="prlStmtBody">
                <div class="empty-state"><span>⏳</span>جاري التحميل...</div>
            </div>
        </div>`;
    document.body.appendChild(modal);
    await prlRenderStatement();
};

async function prlRenderStatement() {
    const body = document.getElementById('prlStmtBody');
    if (!body) return;
    try {
        const table = _prlStmtKind === 'rep' ? 'sales_reps' : 'employees';
        const { data: person, error } = await sb.from(table).select('*').eq('id', _prlStmtId).single();
        if (error) throw error;
        _prlStmtPerson = person;
        document.getElementById('prlStmtTitle').textContent = `📄 كشف حساب — ${person.name}${_prlStmtKind === 'rep' ? ' 🚗' : ''}`;
    } catch (err) {
        body.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:16px;border-radius:10px">خطأ: ${err.message}</div>`;
        return;
    }

    const person = _prlStmtPerson;
    const monthStart = _prlStmtMonth + '-01';
    const [y, m] = _prlStmtMonth.split('-').map(Number);
    const monthEnd = new Date(y, m, 0).toISOString().slice(0, 10);
    const monthStartISO = new Date(y, m - 1, 1).toISOString();
    const nextMonthStartISO = new Date(y, m, 1).toISOString();
    const idCol = _prlStmtKind === 'rep' ? 'rep_id' : 'employee_id';

    try {
        const [expRes, absRes, incRes] = await Promise.all([
            sb.from('expenses')
                .select('id, amount, description, expense_date, status, expense_categories(name)')
                .eq(idCol, person.id).eq('status', 'confirmed')
                .gte('expense_date', monthStart).lte('expense_date', monthEnd)
                .order('expense_date', { ascending: false }),
            sb.from('attendance_records').select('id, record_date, notes')
                .eq(idCol, person.id).eq('status', 'absent')
                .gte('record_date', monthStart).lte('record_date', monthEnd)
                .order('record_date', { ascending: false }),
            sb.from('employee_incentives').select('id, amount, reason, incentive_date')
                .eq(idCol, person.id)
                .gte('incentive_date', monthStart).lte('incentive_date', monthEnd)
                .order('incentive_date', { ascending: false }),
        ]);
        if (expRes.error) throw expRes.error;
        const rows = expRes.data || [];
        const absentDays = absRes.data || [];
        const incentives = incRes.data || [];

        let commission = 0, salesTotal = 0, monthlyTarget = 0;
        if (_prlStmtKind === 'rep') {
            const [{ data: sales }, { data: returns }] = await Promise.all([
                sb.from('sales').select('total').eq('rep_id', person.id).eq('status', 'confirmed')
                    .gte('created_at', monthStartISO).lt('created_at', nextMonthStartISO),
                sb.from('sales_returns').select('total').eq('rep_id', person.id).eq('status', 'confirmed')
                    .gte('created_at', monthStartISO).lt('created_at', nextMonthStartISO),
            ]);
            const salesSum = (sales || []).reduce((s, r) => s + (Number(r.total) || 0), 0);
            const returnsSum = (returns || []).reduce((s, r) => s + (Number(r.total) || 0), 0);
            salesTotal = salesSum - returnsSum;
            commission = salesTotal * (Number(person.commission_pct) || 0) / 100;
            monthlyTarget = (Number(person.daily_sales_target) || 0) * (Number(person.work_days_per_month) || 30);
        }

        const taken = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const dailyRate = (Number(person.base_salary) || 0) / (Number(person.work_days_per_month) || 30);
        const absenceDeduction = absentDays.length * dailyRate;
        const incentivesSum = incentives.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const remaining = (Number(person.base_salary) || 0) - taken - absenceDeduction + incentivesSum + commission;

        body.innerHTML = `
            <div class="mod-form-group" style="max-width:200px">
                <label>الشهر</label>
                <input type="month" id="prlStmtMonthInput" class="mod-form-input" value="${_prlStmtMonth}" onchange="prlChangeMonth(this.value)">
            </div>
            ${_prlStmtKind === 'rep' ? `
            <div class="mod-card" style="padding:14px;margin:12px 0;background:#EEF2FF">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
                    <div style="font-size:12.5px;color:#4338CA;font-weight:700">🎯 تحقيق الهدف الشهري (مبيعات ${prlFmt(salesTotal)} من هدف ${prlFmt(monthlyTarget)})</div>
                    <div style="font-size:14px;font-weight:800;color:#4338CA">${monthlyTarget > 0 ? Math.min(999, Math.round(salesTotal / monthlyTarget * 100)) + '%' : '—'}</div>
                </div>
            </div>` : ''}
            <div class="mod-grid" style="margin:12px 0 16px">
                <div class="mod-card" style="padding:14px">
                    <div style="font-size:11px;color:var(--inv-muted);margin-bottom:4px">الراتب الأساسي</div>
                    <div style="font-size:20px;font-weight:800">${prlFmt(person.base_salary)}</div>
                </div>
                ${_prlStmtKind === 'rep' ? `
                <div class="mod-card" style="padding:14px">
                    <div style="font-size:11px;color:var(--inv-muted);margin-bottom:4px">عمولة (${Number(person.commission_pct) || 0}%)</div>
                    <div style="font-size:20px;font-weight:800;color:var(--inv-green)">${prlFmt(commission)}</div>
                </div>` : ''}
                <div class="mod-card" style="padding:14px">
                    <div style="font-size:11px;color:var(--inv-muted);margin-bottom:4px">مصروف/مسحوب هذا الشهر</div>
                    <div style="font-size:20px;font-weight:800;color:var(--inv-red)">${prlFmt(taken)}</div>
                </div>
                <div class="mod-card" style="padding:14px">
                    <div style="font-size:11px;color:var(--inv-muted);margin-bottom:4px">خصم غياب (${absentDays.length} يوم × ${prlFmt(dailyRate)})</div>
                    <div style="font-size:20px;font-weight:800;color:var(--inv-red)">${prlFmt(absenceDeduction)}</div>
                </div>
                <div class="mod-card" style="padding:14px">
                    <div style="font-size:11px;color:var(--inv-muted);margin-bottom:4px">حوافز</div>
                    <div style="font-size:20px;font-weight:800;color:var(--inv-green)">${prlFmt(incentivesSum)}</div>
                </div>
                <div class="mod-card" style="padding:14px">
                    <div style="font-size:11px;color:var(--inv-muted);margin-bottom:4px">الباقي الصافي</div>
                    <div style="font-size:20px;font-weight:800;color:${remaining >= 0 ? 'var(--inv-green)' : 'var(--inv-red)'}">${prlFmt(remaining)}</div>
                </div>
            </div>
            <div style="display:flex;gap:10px;margin-bottom:16px">
                <button class="mod-btn mod-btn-primary" style="flex:1" onclick="prlOpenPayout(${Math.round(remaining*100)/100})">💸 تسجيل صرف</button>
                <button class="mod-btn" style="flex:1;background:var(--inv-green-light);color:var(--inv-green)" onclick="prlOpenIncentive()">➕ تسجيل حافز</button>
            </div>
            <div id="prlPayoutForm"></div>
            <div id="prlIncentiveForm"></div>
            <div class="mod-table-wrap" style="margin-bottom:16px">
                <table class="mod-table"><thead><tr>
                    <th>البند</th><th>البيان</th><th>التاريخ</th><th style="text-align:left">المبلغ</th>
                </tr></thead>
                <tbody>
                    ${rows.length === 0 ? `<tr><td colspan="4" class="empty-state"><span>📭</span>مفيش أي صرف مسجّل الشهر ده.</td></tr>` :
                    rows.map(r => `<tr>
                        <td>${r.expense_categories?.name || '—'}</td>
                        <td style="color:var(--inv-muted)">${r.description || '—'}</td>
                        <td style="font-size:12px">${new Date(r.expense_date).toLocaleDateString('ar-EG')}</td>
                        <td style="text-align:left;font-weight:700">${prlFmt(r.amount)}</td>
                    </tr>`).join('')}
                </tbody></table>
            </div>
            ${absentDays.length ? `
            <div style="font-size:13px;font-weight:800;margin-bottom:8px">❌ أيام الغياب هذا الشهر</div>
            <div class="mod-table-wrap" style="margin-bottom:16px">
                <table class="mod-table"><thead><tr><th>التاريخ</th><th>ملاحظات</th></tr></thead>
                <tbody>${absentDays.map(a => `<tr>
                    <td style="font-size:12px">${new Date(a.record_date).toLocaleDateString('ar-EG')}</td>
                    <td style="color:var(--inv-muted)">${a.notes || '—'}</td>
                </tr>`).join('')}</tbody></table>
            </div>` : ''}
            ${incentives.length ? `
            <div style="font-size:13px;font-weight:800;margin-bottom:8px">⭐ الحوافز المسجّلة هذا الشهر</div>
            <div class="mod-table-wrap">
                <table class="mod-table"><thead><tr><th>السبب</th><th>التاريخ</th><th style="text-align:left">المبلغ</th></tr></thead>
                <tbody>${incentives.map(i => `<tr>
                    <td style="color:var(--inv-muted)">${i.reason || '—'}</td>
                    <td style="font-size:12px">${new Date(i.incentive_date).toLocaleDateString('ar-EG')}</td>
                    <td style="text-align:left;font-weight:700;color:var(--inv-green)">${prlFmt(i.amount)}</td>
                </tr>`).join('')}</tbody></table>
            </div>` : ''}`;
    } catch (err) {
        body.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:16px;border-radius:10px">خطأ: ${err.message}</div>`;
    }
}

window.prlChangeMonth = function (val) {
    _prlStmtMonth = val;
    prlRenderStatement();
};

// ── نموذج تسجيل الصرف: نفس مسار saveExpense في expenses.js بالحرف
//    (INSERT عادي في expenses)، بس مع employee_id/rep_id + مبلغ مقترح = الباقي ──
let _prlPayoutCategories = [];
let _prlPayoutCatACIdx = -1;

window.prlOpenPayout = async function (suggestedAmount) {
    const wrap = document.getElementById('prlPayoutForm');
    if (!wrap) return;

    let categories = [], treasuries = [];
    try { const { data } = await sb.from('expense_categories').select('*').eq('is_active', true).order('name'); categories = data || []; } catch {}
    try { const { data } = await sb.from('treasuries').select('*').eq('is_active', true).order('is_default', { ascending: false }); treasuries = data || []; } catch {}
    _prlPayoutCategories = categories;

    wrap.innerHTML = `
    <div class="dash-card" style="padding:16px;margin-bottom:16px;background:#F8FAFC">
        <div class="mod-form-group"><label>البند *</label>
            <div style="position:relative">
                <input type="text" id="prlPayoutCatSearch" class="mod-form-input" placeholder="🔍 اكتب اسم البند (مثال: مرتبات، سلف موظفين)..." autocomplete="off"
                    oninput="prlPayoutCatSearchInput()" onfocus="prlPayoutCatSearchInput()" onkeydown="prlPayoutCatACKey(event)"
                    onblur="setTimeout(()=>{const ac=document.getElementById('prlPayoutCatAC'); if(ac) ac.classList.remove('show');},150)">
                <input type="hidden" id="prlPayoutCatId" value="">
                <div class="inv-ac" id="prlPayoutCatAC"></div>
            </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div class="mod-form-group"><label>المبلغ (ج.م) *</label>
                <input type="number" id="prlPayoutAmount" class="mod-form-input" value="${suggestedAmount > 0 ? suggestedAmount.toFixed(2) : ''}" min="0.01" step="0.01"></div>
            <div class="mod-form-group"><label>الخزنة</label>
                <select id="prlPayoutTreasury" class="mod-form-input">
                    ${treasuries.map(t => `<option value="${t.id}" ${t.is_default ? 'selected' : ''}>${t.name}</option>`).join('')}
                </select></div>
        </div>
        <div class="mod-form-group"><label>البيان</label>
            <input type="text" id="prlPayoutDesc" class="mod-form-input" placeholder="مثال: راتب شهر ${_prlStmtMonth}"></div>
        <div style="display:flex;gap:10px">
            <button class="mod-btn" style="background:#F1F5F9;color:var(--inv-text-soft)" onclick="document.getElementById('prlPayoutForm').innerHTML=''">إلغاء</button>
            <button class="mod-btn mod-btn-primary" onclick="prlSavePayout()">💾 تأكيد الصرف</button>
        </div>
    </div>`;
};

window.prlPayoutCatSearchInput = function () {
    const ac = document.getElementById('prlPayoutCatAC');
    if (!ac) return;
    _prlPayoutCatACIdx = -1;
    const term = (document.getElementById('prlPayoutCatSearch')?.value || '').trim().toLowerCase();
    const list = term ? _prlPayoutCategories.filter(c => (c.name || '').toLowerCase().includes(term)) : _prlPayoutCategories;
    if (!list.length) {
        ac.innerHTML = `<div class="inv-ac-item" style="cursor:default;color:var(--inv-muted-light)">لا يوجد نتائج مطابقة</div>`;
        ac.classList.add('show');
        return;
    }
    ac.innerHTML = list.map((c, i) => `<div class="inv-ac-item" data-i="${i}" data-id="${c.id}" onmousedown="event.preventDefault();prlPickPayoutCat('${c.id}')" onmouseenter="prlPayoutCatACHover(${i})">
        <div><div class="an">${c.name}</div></div>
    </div>`).join('');
    ac.classList.add('show');
};
window.prlPickPayoutCat = function (id) {
    const cat = _prlPayoutCategories.find(x => x.id === id);
    if (!cat) return;
    document.getElementById('prlPayoutCatId').value = id;
    document.getElementById('prlPayoutCatSearch').value = cat.name;
    const ac = document.getElementById('prlPayoutCatAC');
    if (ac) { ac.innerHTML = ''; ac.classList.remove('show'); }
};
window.prlPayoutCatACKey = function (e) {
    const ac = document.getElementById('prlPayoutCatAC');
    if (!ac || !ac.classList.contains('show')) return;
    const items = ac.querySelectorAll('.inv-ac-item[data-i]');
    if (e.key === 'ArrowDown') { e.preventDefault(); _prlPayoutCatACIdx = Math.min(_prlPayoutCatACIdx + 1, items.length - 1); prlPayoutCatACHover(_prlPayoutCatACIdx); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _prlPayoutCatACIdx = Math.max(_prlPayoutCatACIdx - 1, 0); prlPayoutCatACHover(_prlPayoutCatACIdx); }
    else if (e.key === 'Enter') { e.preventDefault(); const id = items[_prlPayoutCatACIdx]?.dataset.id; if (id) prlPickPayoutCat(id); }
    else if (e.key === 'Escape') { ac.classList.remove('show'); _prlPayoutCatACIdx = -1; }
};
window.prlPayoutCatACHover = function (i) {
    _prlPayoutCatACIdx = i;
    const items = document.querySelectorAll('#prlPayoutCatAC .inv-ac-item[data-i]');
    items.forEach((el, idx) => el.classList.toggle('active', idx === i));
    items[i]?.scrollIntoView({ block: 'nearest' });
};

window.prlSavePayout = async function () {
    const catId = document.getElementById('prlPayoutCatId').value;
    const amount = parseFloat(document.getElementById('prlPayoutAmount').value);
    const desc = document.getElementById('prlPayoutDesc').value.trim() || `راتب/سلفة — ${_prlStmtMonth}`;
    const treasuryId = document.getElementById('prlPayoutTreasury').value || null;
    if (!catId) return alert('اختر البند');
    if (!amount || amount <= 0) return alert('أدخل مبلغاً صحيحاً');

    const btn = document.querySelector('#prlPayoutForm .mod-btn-primary');
    btn.innerText = '⏳ جاري الحفظ...'; btn.disabled = true;
    try {
        const { error } = await sb.from('expenses').insert({
            ref: 'EXP-' + Date.now(),
            category_id: catId,
            employee_id: _prlStmtKind === 'employee' ? _prlStmtId : null,
            rep_id: _prlStmtKind === 'rep' ? _prlStmtId : null,
            amount,
            description: desc,
            expense_date: new Date().toISOString().slice(0, 10),
            status: 'confirmed',
            treasury_id: treasuryId,
            created_by: currentUser?.id || null,
        });
        if (error) throw error;
        document.getElementById('prlPayoutForm').innerHTML = '';
        await prlRenderStatement();
    } catch (err) {
        alert('❌ خطأ: ' + err.message + (/employee_id|rep_id/i.test(err.message||'') ? '\n\nتأكد من تشغيل migrations المرتبات في Supabase.' : ''));
        btn.innerText = '💾 تأكيد الصرف'; btn.disabled = false;
    }
};

// ── إدخال حافز/بونص — سطر إيجابي مستقل عن المصروفات، بيدوي بالكامل ──
window.prlOpenIncentive = function () {
    const wrap = document.getElementById('prlIncentiveForm');
    if (!wrap) return;
    wrap.innerHTML = `
    <div class="dash-card" style="padding:16px;margin-bottom:16px;background:var(--inv-green-light)">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div class="mod-form-group"><label>المبلغ (ج.م) *</label>
                <input type="number" id="prlIncentiveAmount" class="mod-form-input" min="0.01" step="0.01"></div>
            <div class="mod-form-group"><label>التاريخ</label>
                <input type="date" id="prlIncentiveDate" class="mod-form-input" value="${new Date().toISOString().slice(0,10)}"></div>
        </div>
        <div class="mod-form-group"><label>السبب</label>
            <input type="text" id="prlIncentiveReason" class="mod-form-input" placeholder="مثال: تحصيل ممتاز الأسبوع ده"></div>
        <div style="display:flex;gap:10px">
            <button class="mod-btn" style="background:#F1F5F9;color:var(--inv-text-soft)" onclick="document.getElementById('prlIncentiveForm').innerHTML=''">إلغاء</button>
            <button class="mod-btn mod-btn-primary" style="background:var(--inv-green)" onclick="prlSaveIncentive()">💾 تأكيد الحافز</button>
        </div>
    </div>`;
};

window.prlSaveIncentive = async function () {
    const amount = parseFloat(document.getElementById('prlIncentiveAmount').value);
    const reason = document.getElementById('prlIncentiveReason').value.trim() || null;
    const incentive_date = document.getElementById('prlIncentiveDate').value || new Date().toISOString().slice(0, 10);
    if (!amount || amount <= 0) return alert('أدخل مبلغاً صحيحاً');

    const btn = document.querySelector('#prlIncentiveForm .mod-btn-primary');
    btn.innerText = '⏳ جاري الحفظ...'; btn.disabled = true;
    try {
        const { error } = await sb.from('employee_incentives').insert({
            employee_id: _prlStmtKind === 'employee' ? _prlStmtId : null,
            rep_id: _prlStmtKind === 'rep' ? _prlStmtId : null,
            amount, reason, incentive_date, created_by: currentUser?.id || null,
        });
        if (error) throw error;
        document.getElementById('prlIncentiveForm').innerHTML = '';
        await prlRenderStatement();
    } catch (err) {
        alert('❌ خطأ: ' + err.message);
        btn.innerText = '💾 تأكيد الحافز'; btn.disabled = false;
    }
};

Object.assign(window, {
    renderPayroll, prlOpenAdd, prlOpenEdit, prlSave, prlSaveRep, prlGoAddRep, prlShowStatement, prlChangeMonth,
    prlOpenPayout, prlPayoutCatSearchInput, prlPickPayoutCat, prlPayoutCatACKey, prlPayoutCatACHover, prlSavePayout,
    prlOpenIncentive, prlSaveIncentive,
});
