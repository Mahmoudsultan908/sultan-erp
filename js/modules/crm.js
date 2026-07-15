/* ════════════════════════════════════════════════════════════
   إدارة علاقات العملاء (CRM) — crm.js
   يصدّر: renderCRM(container)
   متابعة تفاعلات العملاء (مكالمات، زيارات، شكاوى، ملاحظات) +
   تذكيرات متابعة دورية. جدول customer_interactions بيانات وصفية
   بحتة، بدون أي تريجر مالي — راجع crm_migration.sql.
   ════════════════════════════════════════════════════════════ */

let _crmList = [];
let _crmCustomers = [];
let _crmFilter = 'due'; // 'due' | 'all'
let _crmTableMissing = false;

const CRM_TYPE_LABELS = { call: '📞 مكالمة', visit: '🚶 زيارة', complaint: '⚠️ شكوى', note: '📝 ملاحظة' };

// ════════════════════════════════════════════════════════════
// 1) القائمة الرئيسية
// ════════════════════════════════════════════════════════════
async function renderCRM(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل...</div>';
    _crmTableMissing = false;
    try {
        try {
            const { data, error } = await sb.from('customer_interactions')
                .select('*, customers(name)').order('interaction_date', { ascending: false });
            if (error) throw error;
            _crmList = data || [];
        } catch (e) {
            _crmTableMissing = true;
            _crmList = [];
        }
        const { data: customers } = await sb.from('customers').select('id,name').order('name');
        _crmCustomers = customers || [];
        crmRenderPage(c);
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function crmFilteredList() {
    const today = new Date().toISOString().slice(0, 10);
    if (_crmFilter === 'due') {
        return _crmList.filter(x => !x.is_done && x.next_follow_up_date && x.next_follow_up_date <= today);
    }
    return _crmList;
}

function crmRenderPage(c) {
    const today = new Date().toISOString().slice(0, 10);
    const overdue = _crmList.filter(x => !x.is_done && x.next_follow_up_date && x.next_follow_up_date < today).length;
    const dueToday = _crmList.filter(x => !x.is_done && x.next_follow_up_date === today).length;
    const upcoming = _crmList.filter(x => !x.is_done && x.next_follow_up_date && x.next_follow_up_date > today).length;
    const list = crmFilteredList();

    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px">
            <div><h2 style="font-size:22px;font-weight:800">🤝 إدارة علاقات العملاء</h2>
            <p style="font-size:13px;color:#64748B;margin-top:4px">مكالمات، زيارات، شكاوى، وتذكيرات متابعة</p></div>
            <button class="mod-btn mod-btn-primary" onclick="crmOpenAdd()">+ تسجيل تفاعل</button>
        </div>

        ${_crmTableMissing ? `<div style="background:#FEF3C7;color:#92400E;padding:14px 18px;border-radius:10px;margin-bottom:16px;font-size:13px">⚠️ جدول التفاعلات لسه مش موجود — شغّل <code>crm_migration.sql</code> في Supabase.</div>` : ''}

        <div class="mod-grid" style="margin-bottom:16px">
            <div class="mod-card"><div class="mod-card-icon" style="background:#FEE2E2;color:#DC2626">⏰</div><div class="mod-card-val">${overdue}</div><div class="mod-card-lbl">متابعات متأخرة</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#FFFBEB;color:#D97706">📅</div><div class="mod-card-val">${dueToday}</div><div class="mod-card-lbl">متابعات اليوم</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#EFF6FF;color:#2563EB">🔜</div><div class="mod-card-val">${upcoming}</div><div class="mod-card-lbl">متابعات قادمة</div></div>
        </div>

        <div class="ob-tabs" style="margin-bottom:12px">
            <button class="ob-tab ${_crmFilter==='due'?'active':''}" onclick="crmSwitchFilter('due')">المتابعات المستحقة</button>
            <button class="ob-tab ${_crmFilter==='all'?'active':''}" onclick="crmSwitchFilter('all')">كل التفاعلات</button>
        </div>

        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>العميل</th><th>النوع</th><th>تاريخ التفاعل</th><th>ملاحظات</th><th>المتابعة القادمة</th><th style="text-align:center">إجراءات</th>
            </tr></thead>
            <tbody>
                ${list.length === 0 ? `<tr><td colspan="6" class="empty-state"><span>🤝</span>لا توجد تفاعلات مطابقة.</td></tr>` :
                list.map(x => {
                    const overdueRow = !x.is_done && x.next_follow_up_date && x.next_follow_up_date < today;
                    return `<tr style="${overdueRow ? 'background:#FEF2F2' : ''}">
                        <td style="font-weight:600">${x.customers?.name || '—'}</td>
                        <td>${CRM_TYPE_LABELS[x.type] || x.type}</td>
                        <td style="font-size:12px">${new Date(x.interaction_date).toLocaleDateString('ar-EG')}</td>
                        <td style="color:#64748B;max-width:260px">${x.notes || '—'}</td>
                        <td style="font-size:12px;${overdueRow ? 'color:#DC2626;font-weight:700' : ''}">${x.next_follow_up_date ? new Date(x.next_follow_up_date).toLocaleDateString('ar-EG') : '—'}</td>
                        <td style="text-align:center;white-space:nowrap">
                            ${x.is_done ? '<span style="color:#059669;font-weight:600;font-size:12px">✅ تمّت</span>' :
                              x.next_follow_up_date ? `<button class="cc-edit" style="background:#F0FDF4;color:#059669" onclick="crmMarkDone('${x.id}')">✅ تمّت المتابعة</button>` : ''}
                            <button class="cc-edit" style="background:#FEE2E2;color:#DC2626" onclick="crmDelete('${x.id}')">🗑️</button>
                        </td>
                    </tr>`;
                }).join('')}
            </tbody></table>
        </div>`;
}

window.crmSwitchFilter = function (f) { _crmFilter = f; crmRenderPage(document.getElementById('app-content')); };

window.crmMarkDone = async function (id) {
    try {
        const { error } = await sb.from('customer_interactions').update({ is_done: true }).eq('id', id);
        if (error) throw error;
        renderCRM(document.getElementById('app-content'));
    } catch (err) { alert('❌ خطأ: ' + err.message); }
};

window.crmDelete = async function (id) {
    if (!confirm('حذف هذا التفاعل نهائياً؟')) return;
    try {
        const { error } = await sb.from('customer_interactions').delete().eq('id', id);
        if (error) throw error;
        renderCRM(document.getElementById('app-content'));
    } catch (err) { alert('❌ خطأ: ' + err.message); }
};

// ════════════════════════════════════════════════════════════
// 2) تسجيل تفاعل جديد — بيتفتح من صفحة CRM نفسها، أو من كشف حساب
//    العميل (customers.js) بتمرير customerId جاهز
// ════════════════════════════════════════════════════════════
let _crmAddCustId = null;

window.crmOpenAdd = function (presetCustomerId = null, presetCustomerName = '') {
    _crmAddCustId = presetCustomerId;
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'crmModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:480px">
            <div class="mod-modal-header"><h3>📞 تسجيل تفاعل جديد</h3>
                <button class="mod-modal-close" onclick="document.getElementById('crmModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>العميل *</label>
                    <div style="position:relative">
                        <input type="text" id="crmCustSearch" class="mod-form-input" placeholder="🔍 اكتب اسم العميل..." autocomplete="off"
                            value="${presetCustomerName}"
                            oninput="crmCustSearchInput()" onfocus="crmCustSearchInput()"
                            onblur="setTimeout(()=>{const ac=document.getElementById('crmCustAC'); if(ac) ac.classList.remove('show');},150)">
                        <input type="hidden" id="crmCustId" value="${presetCustomerId || ''}">
                        <div class="inv-ac" id="crmCustAC"></div>
                    </div>
                </div>
                <div class="mod-form-group"><label>نوع التفاعل</label>
                    <select id="crmType" class="mod-form-input">
                        ${Object.entries(CRM_TYPE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
                    </select></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>تاريخ التفاعل</label>
                        <input type="date" id="crmDate" class="mod-form-input" value="${new Date().toISOString().slice(0,10)}"></div>
                    <div class="mod-form-group"><label>تاريخ المتابعة القادمة</label>
                        <input type="date" id="crmFollowUp" class="mod-form-input" placeholder="اختياري"></div>
                </div>
                <div class="mod-form-group"><label>ملاحظات</label>
                    <textarea id="crmNotes" class="mod-form-input" rows="3" placeholder="اختياري"></textarea></div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="document.getElementById('crmModal').remove()">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="crmSave()">💾 حفظ</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    setTimeout(() => document.getElementById(presetCustomerId ? 'crmType' : 'crmCustSearch')?.focus(), 50);
};

window.crmCustSearchInput = function () {
    const ac = document.getElementById('crmCustAC');
    if (!ac) return;
    const term = (document.getElementById('crmCustSearch')?.value || '').trim().toLowerCase();
    const list = (term ? _crmCustomers.filter(c => (c.name||'').toLowerCase().includes(term)) : _crmCustomers).slice(0, 20);
    if (!list.length) {
        ac.innerHTML = `<div class="inv-ac-item" style="cursor:default;color:#94A3B8">لا يوجد نتائج مطابقة</div>`;
        ac.classList.add('show');
        return;
    }
    ac.innerHTML = list.map(c => `<div class="inv-ac-item" onmousedown="event.preventDefault();crmPickCust('${c.id}','${(c.name||'').replace(/'/g,"\\'")}')">
        <div><div class="an">${c.name}</div></div>
    </div>`).join('');
    ac.classList.add('show');
};
window.crmPickCust = function (id, name) {
    document.getElementById('crmCustId').value = id;
    document.getElementById('crmCustSearch').value = name;
    const ac = document.getElementById('crmCustAC');
    if (ac) { ac.innerHTML = ''; ac.classList.remove('show'); }
};

window.crmSave = async function () {
    const customer_id = document.getElementById('crmCustId').value;
    const type = document.getElementById('crmType').value;
    const interaction_date = document.getElementById('crmDate').value;
    const next_follow_up_date = document.getElementById('crmFollowUp').value || null;
    const notes = document.getElementById('crmNotes').value.trim() || null;
    if (!customer_id) return alert('اختر العميل');
    if (!interaction_date) return alert('أدخل تاريخ التفاعل');

    const btn = document.querySelector('#crmModal .mod-btn-primary');
    btn.innerText = '⏳ جاري الحفظ...'; btn.disabled = true;
    try {
        const { error } = await sb.from('customer_interactions').insert({
            customer_id, type, interaction_date, next_follow_up_date, notes,
            created_by: currentUser?.id || null,
        });
        if (error) throw error;
        document.getElementById('crmModal').remove();
        // لو اتفتح من كشف حساب عميل (customers.js) حدّث قسم التفاعلات هناك بس،
        // غير كده (اتفتح من صفحة CRM نفسها) أعد رسم الصفحة كلها
        if (_crmAddCustId && typeof custRefreshInteractions === 'function') {
            custRefreshInteractions(_crmAddCustId);
        } else {
            renderCRM(document.getElementById('app-content'));
        }
    } catch (err) {
        alert('❌ خطأ: ' + err.message + (_crmTableMissing ? '\n\nتأكد من تشغيل crm_migration.sql في Supabase.' : ''));
        btn.innerText = '💾 حفظ'; btn.disabled = false;
    }
};

Object.assign(window, {
    renderCRM, crmSwitchFilter, crmMarkDone, crmDelete, crmOpenAdd,
    crmCustSearchInput, crmPickCust, crmSave,
});
