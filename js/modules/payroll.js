/* ════════════════════════════════════════════════════════════
   الموظفون والرواتب — payroll.js
   يصدّر: renderPayroll(container)

   ★ قرار تصميم صريح من صاحب المشروع: المرتبات مش نظام مالي مستقل —
   employees جدول بيانات أساسية بس (زي sales_reps)، بدون أي trigger.
   أي صرف فعلي لموظف (سلفة أو راتب) بيتسجّل كمصروف عادي في جدول
   expenses الموجود بالفعل (نفس مسار fn_expense_status_change المالي)
   بعمود employee_id الجديد بس اللي بيربط المصروف بموظف — فـ"الباقي من
   الراتب" = base_salary - مجموع مصروفات الموظف في الشهر. صفر تكرار
   مالي، صفر trigger جديد. راجع employees_payroll_migration.sql.
   ════════════════════════════════════════════════════════════ */

let _prlList = [];
let _prlEditingId = null;
let _prlTableMissing = false;
let _prlLastEvalMap = {}; // employee_id -> { date, avg }

function prlEvalColor(avg) {
    if (avg >= 9) return { color: '#059669', bg: '#F0FDF4' };
    if (avg >= 7) return { color: '#2563EB', bg: '#EFF6FF' };
    if (avg >= 5) return { color: '#D97706', bg: '#FFFBEB' };
    if (avg >= 3) return { color: '#EA580C', bg: '#FFF7ED' };
    return { color: '#DC2626', bg: '#FEF2F2' };
}

function prlFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// ════════════════════════════════════════════════════════════
// 1) القائمة الرئيسية
// ════════════════════════════════════════════════════════════
async function renderPayroll(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل الموظفين...</div>';
    _prlTableMissing = false;
    try {
        try {
            const { data, error } = await sb.from('employees').select('*').order('name');
            if (error) throw error;
            _prlList = data || [];
        } catch (e) {
            _prlTableMissing = true;
            _prlList = [];
        }

        // آخر تقييم لكل موظف — اختياري، لو جدول employee_evaluations لسه ما اتعملش نتجاهل الخطأ بهدوء
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

        prlRenderPage(c);
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function prlRenderPage(c) {
    const activeEmps = _prlList.filter(e => e.is_active !== false);
    const totalBase = activeEmps.reduce((s, e) => s + (Number(e.base_salary) || 0), 0);

    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
            <div><h2 style="font-size:22px;font-weight:800">👥 الموظفون والرواتب</h2>
            <p style="font-size:13px;color:#64748B;margin-top:4px">إدارة الموظفين وصرف الرواتب والسلف</p></div>
            <button class="mod-btn mod-btn-primary" onclick="prlOpenAdd()">+ إضافة موظف</button>
        </div>

        ${_prlTableMissing ? `<div style="background:#FEF3C7;color:#92400E;padding:14px 18px;border-radius:10px;margin-bottom:16px;font-size:13px">⚠️ جدول الموظفين لسه مش موجود — شغّل <code>employees_payroll_migration.sql</code> في Supabase.</div>` : ''}

        <div class="mod-grid" style="margin-bottom:16px">
            <div class="mod-card"><div class="mod-card-icon" style="background:#F0FDF4;color:#059669">👥</div><div class="mod-card-val">${activeEmps.length}</div><div class="mod-card-lbl">عدد الموظفين النشطين</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#FFFBEB;color:#D97706">💰</div><div class="mod-card-val">${prlFmt(totalBase)}</div><div class="mod-card-lbl">إجمالي الرواتب الأساسية</div></div>
        </div>

        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>الموظف</th><th>الوظيفة</th><th>الهاتف</th><th>آخر تقييم</th>
                <th style="text-align:left">الراتب الأساسي</th><th style="text-align:center">الحالة</th><th style="text-align:center">إجراءات</th>
            </tr></thead>
            <tbody>
                ${_prlList.length === 0 ? `<tr><td colspan="7" class="empty-state"><span>👥</span>لا يوجد موظفون بعد.</td></tr>` :
                _prlList.map(e => {
                    const lastEval = _prlLastEvalMap[e.id];
                    return `<tr>
                    <td style="font-weight:600">${e.name}</td>
                    <td style="color:#64748B">${e.job_title || '—'}</td>
                    <td dir="ltr" style="color:#64748B">${e.phone || '—'}</td>
                    <td style="font-size:12px">${lastEval ? `${new Date(lastEval.date).toLocaleDateString('ar-EG')} <span style="background:${prlEvalColor(lastEval.avg).bg};color:${prlEvalColor(lastEval.avg).color};padding:1px 8px;border-radius:10px;font-weight:700;margin-right:4px">${lastEval.avg.toFixed(1)}</span>` : '<span style="color:#94A3B8">—</span>'}</td>
                    <td style="text-align:left;font-weight:700">${prlFmt(e.base_salary)}</td>
                    <td style="text-align:center">${e.is_active !== false ? '<span style="color:#059669;font-weight:600">✅ نشط</span>' : '<span style="color:#94A3B8;font-weight:600">🚫 غير نشط</span>'}</td>
                    <td style="text-align:center;white-space:nowrap">
                        <button class="cc-edit" onclick="prlOpenEdit('${e.id}')">✏️</button>
                        <button class="cc-edit" style="background:#FFFBEB;color:#D97706" onclick="prlShowStatement('${e.id}')">📄 كشف حساب</button>
                        ${typeof eevOpenAdd === 'function' ? `<button class="cc-edit" style="background:#FEF9C3;color:#B45309" onclick="eevOpenAdd('${e.id}')" title="تقييم سريع">⭐</button>` : ''}
                    </td>
                </tr>`;
                }).join('')}
            </tbody></table>
        </div>`;
}

// ════════════════════════════════════════════════════════════
// 2) إضافة / تعديل موظف
// ════════════════════════════════════════════════════════════
window.prlOpenAdd = function () { _prlEditingId = null; prlOpenModal(null); };
window.prlOpenEdit = function (id) { const e = _prlList.find(x => x.id === id); if (e) { _prlEditingId = id; prlOpenModal(e); } };

function prlOpenModal(x) {
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'prlModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:480px">
            <div class="mod-modal-header"><h3>${x ? '✏️ تعديل موظف' : '👥 إضافة موظف جديد'}</h3>
                <button class="mod-modal-close" onclick="document.getElementById('prlModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>اسم الموظف *</label>
                    <input type="text" id="prlName" class="mod-form-input" value="${x?.name || ''}"></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>الوظيفة</label>
                        <input type="text" id="prlJobTitle" class="mod-form-input" value="${x?.job_title || ''}" placeholder="مثال: مندوب مبيعات"></div>
                    <div class="mod-form-group"><label>الهاتف</label>
                        <input type="text" id="prlPhone" class="mod-form-input" value="${x?.phone || ''}" dir="ltr"></div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>الراتب الأساسي (ج.م) *</label>
                        <input type="number" id="prlBaseSalary" class="mod-form-input" value="${x?.base_salary || 0}" min="0" step="0.01"></div>
                    <div class="mod-form-group"><label>تاريخ التعيين</label>
                        <input type="date" id="prlHireDate" class="mod-form-input" value="${x?.hire_date || ''}"></div>
                </div>
                <div class="mod-form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                    <input type="checkbox" id="prlIsActive" ${x?.is_active !== false ? 'checked' : ''}> نشط
                </label></div>
                <div class="mod-form-group"><label>ملاحظات</label>
                    <input type="text" id="prlNotes" class="mod-form-input" value="${x?.notes || ''}" placeholder="اختياري"></div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="document.getElementById('prlModal').remove()">إلغاء</button>
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
    };

    const btn = document.querySelector('#prlModal .mod-btn-primary');
    btn.innerText = '⏳ جاري الحفظ...'; btn.disabled = true;
    try {
        if (_prlEditingId) {
            const { error } = await sb.from('employees').update(payload).eq('id', _prlEditingId);
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
// 3) كشف حساب موظف — الراتب الأساسي مقابل مصروفات الشهر (سلف/صرف)
// ════════════════════════════════════════════════════════════
let _prlStmtEmpId = null;
let _prlStmtMonth = null; // 'YYYY-MM'

window.prlShowStatement = async function (empId) {
    const emp = _prlList.find(e => e.id === empId);
    if (!emp) return;
    _prlStmtEmpId = empId;
    _prlStmtMonth = new Date().toISOString().slice(0, 7);

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'prlStmtModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:720px">
            <div class="mod-modal-header"><h3>📄 كشف حساب — ${emp.name}</h3>
                <button class="mod-modal-close" onclick="document.getElementById('prlStmtModal').remove()">&times;</button></div>
            <div class="mod-modal-body" id="prlStmtBody">
                <div class="empty-state"><span>⏳</span>جاري التحميل...</div>
            </div>
        </div>`;
    document.body.appendChild(modal);
    await prlRenderStatement();
};

async function prlRenderStatement() {
    const emp = _prlList.find(e => e.id === _prlStmtEmpId);
    const body = document.getElementById('prlStmtBody');
    if (!emp || !body) return;

    const monthStart = _prlStmtMonth + '-01';
    const [y, m] = _prlStmtMonth.split('-').map(Number);
    const monthEnd = new Date(y, m, 0).toISOString().slice(0, 10);

    try {
        const { data: rows, error } = await sb.from('expenses')
            .select('id, amount, description, expense_date, status, expense_categories(name)')
            .eq('employee_id', emp.id).eq('status', 'confirmed')
            .gte('expense_date', monthStart).lte('expense_date', monthEnd)
            .order('expense_date', { ascending: false });
        if (error) throw error;

        const taken = (rows || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const remaining = (Number(emp.base_salary) || 0) - taken;

        body.innerHTML = `
            <div class="mod-form-group" style="max-width:200px">
                <label>الشهر</label>
                <input type="month" id="prlStmtMonthInput" class="mod-form-input" value="${_prlStmtMonth}" onchange="prlChangeMonth(this.value)">
            </div>
            <div class="mod-grid" style="margin:12px 0 16px">
                <div class="mod-card" style="padding:14px">
                    <div style="font-size:11px;color:#64748B;margin-bottom:4px">الراتب الأساسي</div>
                    <div style="font-size:20px;font-weight:800">${prlFmt(emp.base_salary)}</div>
                </div>
                <div class="mod-card" style="padding:14px">
                    <div style="font-size:11px;color:#64748B;margin-bottom:4px">مصروف/مسحوب هذا الشهر</div>
                    <div style="font-size:20px;font-weight:800;color:#DC2626">${prlFmt(taken)}</div>
                </div>
                <div class="mod-card" style="padding:14px">
                    <div style="font-size:11px;color:#64748B;margin-bottom:4px">المتبقي</div>
                    <div style="font-size:20px;font-weight:800;color:${remaining >= 0 ? '#059669' : '#DC2626'}">${prlFmt(remaining)}</div>
                </div>
            </div>
            <button class="mod-btn mod-btn-primary" style="width:100%;margin-bottom:16px" onclick="prlOpenPayout(${Math.round(remaining*100)/100})">💸 تسجيل صرف</button>
            <div id="prlPayoutForm"></div>
            <div class="mod-table-wrap">
                <table class="mod-table"><thead><tr>
                    <th>البند</th><th>البيان</th><th>التاريخ</th><th style="text-align:left">المبلغ</th>
                </tr></thead>
                <tbody>
                    ${(rows || []).length === 0 ? `<tr><td colspan="4" class="empty-state"><span>📭</span>مفيش أي صرف مسجّل للموظف ده الشهر ده.</td></tr>` :
                    rows.map(r => `<tr>
                        <td>${r.expense_categories?.name || '—'}</td>
                        <td style="color:#64748B">${r.description || '—'}</td>
                        <td style="font-size:12px">${new Date(r.expense_date).toLocaleDateString('ar-EG')}</td>
                        <td style="text-align:left;font-weight:700">${prlFmt(r.amount)}</td>
                    </tr>`).join('')}
                </tbody></table>
            </div>`;
    } catch (err) {
        body.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:16px;border-radius:10px">خطأ: ${err.message}</div>`;
    }
}

window.prlChangeMonth = function (val) {
    _prlStmtMonth = val;
    prlRenderStatement();
};

// ── نموذج تسجيل الصرف: نفس مسار saveExpense في expenses.js بالحرف
//    (INSERT عادي في expenses)، بس مع employee_id + مبلغ مقترح = الباقي ──
let _prlPayoutCategories = [];
let _prlPayoutCatACIdx = -1;

window.prlOpenPayout = async function (suggestedAmount) {
    const wrap = document.getElementById('prlPayoutForm');
    if (!wrap) return;

    let categories = [], treasuries = [];
    try { const { data } = await sb.from('expense_categories').select('*').order('name'); categories = data || []; } catch {}
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
            <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="document.getElementById('prlPayoutForm').innerHTML=''">إلغاء</button>
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
        ac.innerHTML = `<div class="inv-ac-item" style="cursor:default;color:#94A3B8">لا يوجد نتائج مطابقة</div>`;
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
            employee_id: _prlStmtEmpId,
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
        alert('❌ خطأ: ' + err.message + (/employee_id/i.test(err.message||'') ? '\n\nتأكد من تشغيل employees_payroll_migration.sql في Supabase.' : ''));
        btn.innerText = '💾 تأكيد الصرف'; btn.disabled = false;
    }
};

Object.assign(window, {
    renderPayroll, prlOpenAdd, prlOpenEdit, prlSave, prlShowStatement, prlChangeMonth,
    prlOpenPayout, prlPayoutCatSearchInput, prlPickPayoutCat, prlPayoutCatACKey, prlPayoutCatACHover, prlSavePayout,
});
