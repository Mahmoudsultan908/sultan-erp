/* ════════════════════════════════════════════════════════════
   إدارة علاقات العملاء (CRM) — crm.js
   يصدّر: renderCRM(container)
   وضعين:
   1) متابعات العملاء الحاليين (مكالمات/زيارات/شكاوى/ملاحظات) —
      جدول customer_interactions، بيانات وصفية بحتة بدون أي تريجر مالي.
   2) قمع العملاء المحتملين (Leads) + واتساب — جدول crm_leads، راجع
      crm_leads_migration.sql. لما الـ Lead يوصل "اشترى" بيتحول لعميل
      حقيقي في customers وتتربط بيه عبر converted_customer_id، وبعد
      كده متابعته بتكمل في customer_interactions العادي.
   قوالب رسائل الواتساب متخزّنة مركزيًا في app_settings
   (key='crm_whatsapp_templates') عشان كل مستخدمي الكول سنتر
   (ديسك توب أو موبايل) يشوفوا نفس النص.
   ════════════════════════════════════════════════════════════ */

let _crmMode = 'leads'; // 'leads' | 'interactions'

// ---- حالة التفاعلات (الموجودة من قبل) ----
let _crmList = [];
let _crmCustomers = [];
let _crmReps = [];
let _crmFilter = 'due'; // 'due' | 'all'
let _crmTableMissing = false;

const CRM_TYPE_LABELS = { call: '📞 مكالمة', visit: '🚶 زيارة', complaint: '⚠️ شكوى', note: '📝 ملاحظة' };

// ---- حالة العملاء المحتملين (Leads) ----
let _crmLeads = [];
let _crmLeadsTableMissing = false;
let _crmProfiles = [];
let _crmTemplates = {};
let _crmLeadsFilter = 'الكل';
let _crmLeadsView = 'mine'; // 'mine' | 'all'
let _crmLeadsSearch = '';

const CRM_LEAD_STAGES = {
    'جديد':        { color: '#3b82f6', days: 3, icon: '🆕' },
    'تم التواصل':  { color: '#d97706', days: 3, icon: '📞' },
    'مهتم':        { color: '#7c3aed', days: 2, icon: '💡' },
    'طلب أسعار':   { color: '#9333ea', days: 2, icon: '💰' },
    'اشترى':       { color: '#059669', days: 7, icon: '✅' },
    'خسرناه':      { color: '#dc2626', days: null, icon: '❌' },
};
const CRM_LEAD_STAGE_KEYS = Object.keys(CRM_LEAD_STAGES);

const CRM_DEFAULT_TEMPLATES = {
    'جديد':
`السلام عليكم أستاذ {name} 👋
معاك {agent} من شركة سلطان للمواد الغذائية 🌟

حضرتك مسجل معنا وحابين نتعرف على احتياجات {shop} ونرشح لك أفضل الأصناف.

متاح أتكلم معاك؟ 🙏`,
    'تم التواصل':
`السلام عليكم أستاذ {name} 👋
معاك {agent} 🌟

متابع معاك بخصوص احتياجات {shop}.
عندي أصناف ممتازة بأسعار مناسبة.

إيه رأيك نتكلم؟ 🙏`,
    'مهتم':
`السلام عليكم أستاذ {name} 👋
معاك {agent} 🌟

عندنا تشكيلة بداية ممتازة تناسب {shop}.
نقدر نجهز لك طلب حسب حركة البيع عندك.

إيه رأيك نبدأ؟ 📦`,
    'طلب أسعار':
`السلام عليكم أستاذ {name} 👋
معاك {agent} 🌟

بعتلك الأسعار من يومين، حبيت أعرف رأيك.
هل نجهز الطلب؟ أو في استفسار أنا موجود 🙏`,
    'اشترى':
`السلام عليكم أستاذ {name} 👋
معاك {agent} 🌟

كيف حال الأصناف اللي جبناها؟
حبيت أعرف إيه اللي اتحرك مشان نعبيه تاني 📦

جاهزين للتوريد في أي وقت 🚚`,
};

function crmToday() { return new Date().toISOString().slice(0, 10); }
function crmDaysDiff(dateStr) {
    if (!dateStr) return 999;
    return Math.floor((new Date() - new Date(dateStr)) / 86400000);
}
function crmLeadUrgent(l) {
    if (l.status === 'خسرناه' || l.converted_customer_id) return false;
    if (l.next_follow_up_date && l.next_follow_up_date <= crmToday()) return true;
    const cfg = CRM_LEAD_STAGES[l.status];
    if (!cfg || !cfg.days) return false;
    return crmDaysDiff(l.last_contact_date) >= cfg.days;
}
function crmAgentName(l) {
    return _crmProfiles.find(p => p.id === l.assigned_to)?.name || currentUser?.name || 'سلطان';
}
function crmWaMsg(l) {
    const tmpl = _crmTemplates[l.status] || CRM_DEFAULT_TEMPLATES[l.status] || CRM_DEFAULT_TEMPLATES['جديد'];
    return tmpl
        .replace(/{name}/g, l.name || 'العميل')
        .replace(/{shop}/g, l.shop || 'المحل')
        .replace(/{agent}/g, crmAgentName(l));
}
function crmWaLink(l) {
    const phone = (l.phone || '').replace(/\D/g, '');
    const intl = phone.startsWith('0') ? '2' + phone : phone;
    return `https://wa.me/${intl}?text=${encodeURIComponent(crmWaMsg(l))}`;
}

// ════════════════════════════════════════════════════════════
// 0) الدخول الرئيسي + تبديل الوضع
// ════════════════════════════════════════════════════════════
async function renderCRM(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل...</div>';
    try {
        await Promise.all([crmLoadInteractionsData(), crmLoadLeadsData()]);
        crmRenderShell(c);
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

async function crmLoadInteractionsData() {
    _crmTableMissing = false;
    try {
        const { data, error } = await sb.from('customer_interactions')
            .select('*, customers(name), sales_reps(name), archive_documents(title,file_url)').order('interaction_date', { ascending: false });
        if (error) throw error;
        _crmList = data || [];
    } catch (e) {
        _crmTableMissing = true;
        _crmList = [];
    }
    const [{ data: customers }, repsResult] = await Promise.all([
        sb.from('customers').select('id,name').order('name'),
        sb.from('sales_reps').select('id,name').eq('is_active', true).order('name').then(r => r, () => ({ data: [] })),
    ]);
    _crmCustomers = customers || [];
    _crmReps = repsResult?.data || [];
}

async function crmLoadLeadsData() {
    _crmLeadsTableMissing = false;
    try {
        const { data, error } = await sb.from('crm_leads').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        _crmLeads = data || [];
    } catch (e) {
        _crmLeadsTableMissing = true;
        _crmLeads = [];
    }
    try {
        const { data } = await sb.from('profiles').select('id,name,role').eq('is_active', true).order('name');
        _crmProfiles = data || [];
    } catch { _crmProfiles = []; }
    try {
        const { data } = await sb.from('app_settings').select('value').eq('key', 'crm_whatsapp_templates').maybeSingle();
        _crmTemplates = data?.value || {};
    } catch { _crmTemplates = {}; }
}

function crmRenderShell(c) {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
            <div><h2 style="font-size:22px;font-weight:800">🤝 إدارة علاقات العملاء</h2>
            <p style="font-size:13px;color:#64748B;margin-top:4px">عملاء محتملون وواتساب + متابعات العملاء الحاليين</p></div>
        </div>
        <div class="ob-tabs" style="margin-bottom:16px">
            <button class="ob-tab ${_crmMode === 'leads' ? 'active' : ''}" onclick="crmSwitchMode('leads')">🎯 العملاء المحتملون</button>
            <button class="ob-tab ${_crmMode === 'interactions' ? 'active' : ''}" onclick="crmSwitchMode('interactions')">📞 متابعات العملاء الحاليين</button>
        </div>
        <div id="crmModeBody"></div>`;
    const body = document.getElementById('crmModeBody');
    if (_crmMode === 'leads') crmRenderLeadsPage(body); else crmRenderPage(body);
}

window.crmSwitchMode = function (m) {
    _crmMode = m;
    crmRenderShell(document.getElementById('app-content'));
};

// ════════════════════════════════════════════════════════════
// 1) متابعات العملاء الحاليين (الموجودة من قبل، بدون تعديل جوهري)
// ════════════════════════════════════════════════════════════
function crmFilteredList() {
    const today = crmToday();
    if (_crmFilter === 'due') {
        return _crmList.filter(x => !x.is_done && x.next_follow_up_date && x.next_follow_up_date <= today);
    }
    return _crmList;
}

function crmRenderPage(c) {
    const today = crmToday();
    const overdue = _crmList.filter(x => !x.is_done && x.next_follow_up_date && x.next_follow_up_date < today).length;
    const dueToday = _crmList.filter(x => !x.is_done && x.next_follow_up_date === today).length;
    const upcoming = _crmList.filter(x => !x.is_done && x.next_follow_up_date && x.next_follow_up_date > today).length;
    const list = crmFilteredList();

    c.innerHTML = `
        <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
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
                <th>العميل</th><th>النوع</th><th>المندوب</th><th>تاريخ التفاعل</th><th>ملاحظات</th><th>المتابعة القادمة</th><th style="text-align:center">إجراءات</th>
            </tr></thead>
            <tbody>
                ${list.length === 0 ? `<tr><td colspan="7" class="empty-state"><span>🤝</span>لا توجد تفاعلات مطابقة.</td></tr>` :
                list.map(x => {
                    const overdueRow = !x.is_done && x.next_follow_up_date && x.next_follow_up_date < today;
                    return `<tr style="${overdueRow ? 'background:#FEF2F2' : ''}">
                        <td style="font-weight:600">${x.customers?.name || '—'}</td>
                        <td>${CRM_TYPE_LABELS[x.type] || x.type}</td>
                        <td style="color:#64748B">${x.sales_reps?.name || '—'}</td>
                        <td style="font-size:12px">${new Date(x.interaction_date).toLocaleDateString('ar-EG')}</td>
                        <td style="color:#64748B;max-width:220px">${x.notes || '—'}${x.archive_documents ? `<br><a href="${x.archive_documents.file_url}" target="_blank" rel="noopener" style="font-size:11px;color:#D97706">📎 ${x.archive_documents.title}</a>` : ''}</td>
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

window.crmSwitchFilter = function (f) { _crmFilter = f; crmRenderPage(document.getElementById('crmModeBody') || document.getElementById('app-content')); };

window.crmMarkDone = async function (id) {
    try {
        const { error } = await sb.from('customer_interactions').update({ is_done: true }).eq('id', id);
        if (error) throw error;
        await crmLoadInteractionsData();
        crmRenderPage(document.getElementById('crmModeBody') || document.getElementById('app-content'));
    } catch (err) { alert('❌ خطأ: ' + err.message); }
};

window.crmDelete = async function (id) {
    if (!confirm('حذف هذا التفاعل نهائياً؟')) return;
    try {
        const { error } = await sb.from('customer_interactions').delete().eq('id', id);
        if (error) throw error;
        await crmLoadInteractionsData();
        crmRenderPage(document.getElementById('crmModeBody') || document.getElementById('app-content'));
    } catch (err) { alert('❌ خطأ: ' + err.message); }
};

// ════════════════════════════════════════════════════════════
// 1ب) تسجيل تفاعل جديد — بيتفتح من صفحة CRM نفسها، أو من كشف حساب
//    العميل (customers.js) بتمرير customerId جاهز
// ════════════════════════════════════════════════════════════
let _crmAddCustId = null;

window.crmOpenAdd = async function (presetCustomerId = null, presetCustomerName = '') {
    _crmAddCustId = presetCustomerId;
    if (!_crmCustomers.length) {
        const { data } = await sb.from('customers').select('id,name').order('name');
        _crmCustomers = data || [];
    }
    if (!_crmReps.length) {
        try {
            const { data } = await sb.from('sales_reps').select('id,name').eq('is_active', true).order('name');
            _crmReps = data || [];
        } catch { _crmReps = []; }
    }

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
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>نوع التفاعل</label>
                        <select id="crmType" class="mod-form-input">
                            ${Object.entries(CRM_TYPE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
                        </select></div>
                    ${_crmReps.length ? `
                    <div class="mod-form-group"><label>المندوب</label>
                        <select id="crmRep" class="mod-form-input">
                            <option value="">بدون مندوب</option>
                            ${_crmReps.map(r => `<option value="${r.id}">🚗 ${r.name}</option>`).join('')}
                        </select></div>` : ''}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>تاريخ التفاعل</label>
                        <input type="date" id="crmDate" class="mod-form-input" value="${crmToday()}"></div>
                    <div class="mod-form-group"><label>تاريخ المتابعة القادمة</label>
                        <input type="date" id="crmFollowUp" class="mod-form-input" placeholder="اختياري"></div>
                </div>
                <div class="mod-form-group"><label>ملاحظات</label>
                    <textarea id="crmNotes" class="mod-form-input" rows="3" placeholder="اختياري"></textarea></div>
                <div class="mod-form-group"><label>مرفق (اختياري)</label>
                    <input type="file" id="crmFile" class="mod-form-input">
                    <div style="font-size:11px;color:#94A3B8;margin-top:2px">هيتحفظ في الأرشيف تلقائياً ومربوط بالعميل ده</div></div>
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
    const rep_id = document.getElementById('crmRep')?.value || null;
    const interaction_date = document.getElementById('crmDate').value;
    const next_follow_up_date = document.getElementById('crmFollowUp').value || null;
    const notes = document.getElementById('crmNotes').value.trim() || null;
    const file = document.getElementById('crmFile')?.files[0] || null;
    if (!customer_id) return alert('اختر العميل');
    if (!interaction_date) return alert('أدخل تاريخ التفاعل');

    const btn = document.querySelector('#crmModal .mod-btn-primary');
    btn.innerText = '⏳ جاري الحفظ...'; btn.disabled = true;
    try {
        let document_id = null;
        if (file) {
            const safeName = file.name.replace(/[^\w.\-]+/g, '_');
            const path = `${Date.now()}_${safeName}`;
            const { error: upErr } = await sb.storage.from('archive-documents').upload(path, file);
            if (upErr) throw upErr;
            const { data: pub } = sb.storage.from('archive-documents').getPublicUrl(path);
            const custName = _crmCustomers.find(c => c.id === customer_id)?.name || '';
            const { data: docRow, error: docErr } = await sb.from('archive_documents').insert({
                title: `مرفق تفاعل — ${custName} — ${new Date(interaction_date).toLocaleDateString('ar-EG')}`,
                file_path: path, file_url: pub.publicUrl, file_type: file.type || '',
                category: 'CRM', linked_type: 'customer', linked_id: customer_id,
                uploaded_by: currentUser?.id || null,
            }).select().single();
            if (docErr) throw docErr;
            document_id = docRow.id;
        }

        const { error } = await sb.from('customer_interactions').insert({
            customer_id, type, rep_id, interaction_date, next_follow_up_date, notes, document_id,
            created_by: currentUser?.id || null,
        });
        if (error) throw error;
        document.getElementById('crmModal').remove();
        if (_crmAddCustId && typeof custRefreshInteractions === 'function') {
            custRefreshInteractions(_crmAddCustId);
        } else {
            await crmLoadInteractionsData();
            crmRenderPage(document.getElementById('crmModeBody') || document.getElementById('app-content'));
        }
    } catch (err) {
        const extraHint = _crmTableMissing ? '\n\nتأكد من تشغيل crm_migration.sql في Supabase.'
            : /rep_id|document_id/i.test(err.message||'') ? '\n\nتأكد من تشغيل crm_enhancements_migration.sql في Supabase.' : '';
        alert('❌ خطأ: ' + err.message + extraHint);
        btn.innerText = '💾 حفظ'; btn.disabled = false;
    }
};

// ════════════════════════════════════════════════════════════
// 2) قمع العملاء المحتملين (Leads) + واتساب
// ════════════════════════════════════════════════════════════
function crmLeadsFilteredList() {
    let list = _crmLeads;
    if (_crmLeadsView === 'mine' && currentUser?.id) {
        list = list.filter(l => l.assigned_to === currentUser.id);
    }
    if (_crmLeadsFilter !== 'الكل') list = list.filter(l => l.status === _crmLeadsFilter);
    if (_crmLeadsSearch) {
        const q = _crmLeadsSearch.toLowerCase();
        list = list.filter(l =>
            (l.name||'').toLowerCase().includes(q) ||
            (l.shop||'').toLowerCase().includes(q) ||
            (l.area||'').toLowerCase().includes(q) ||
            (l.phone||'').includes(q));
    }
    return list;
}

function crmRenderLeadsPage(c) {
    const scope = _crmLeadsView === 'mine' && currentUser?.id ? _crmLeads.filter(l => l.assigned_to === currentUser.id) : _crmLeads;
    const total = scope.length;
    const newC = scope.filter(l => l.status === 'جديد').length;
    const ordered = scope.filter(l => l.status === 'اشترى').length;
    const urgent = scope.filter(l => crmLeadUrgent(l)).length;
    const list = crmLeadsFilteredList();

    c.innerHTML = `
        ${_crmLeadsTableMissing ? `<div style="background:#FEF3C7;color:#92400E;padding:14px 18px;border-radius:10px;margin-bottom:16px;font-size:13px">⚠️ جدول العملاء المحتملين لسه مش موجود — شغّل <code>crm_leads_migration.sql</code> في Supabase.</div>` : ''}

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
            <div class="ob-tabs">
                <button class="ob-tab ${_crmLeadsView==='mine'?'active':''}" onclick="crmLeadsSetView('mine')">👤 عملائي</button>
                <button class="ob-tab ${_crmLeadsView==='all'?'active':''}" onclick="crmLeadsSetView('all')">👥 الكل</button>
            </div>
            <div style="display:flex;gap:8px">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="crmOpenTemplatesModal()">✏️ رسائل الواتساب</button>
                <button class="mod-btn mod-btn-primary" onclick="crmOpenAddLead()">+ عميل محتمل جديد</button>
            </div>
        </div>

        <div class="mod-grid" style="margin-bottom:14px">
            <div class="mod-card"><div class="mod-card-icon" style="background:#EFF6FF;color:#2563EB">👥</div><div class="mod-card-val">${total}</div><div class="mod-card-lbl">إجمالي العملاء المحتملين</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#DBEAFE;color:#3B82F6">🆕</div><div class="mod-card-val">${newC}</div><div class="mod-card-lbl">عملاء جدد</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#D1FAE5;color:#059669">✅</div><div class="mod-card-val">${ordered}</div><div class="mod-card-lbl">اشتروا</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#FEE2E2;color:#DC2626">⚠️</div><div class="mod-card-val">${urgent}</div><div class="mod-card-lbl">تحتاج متابعة</div></div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:14px">
            ${CRM_LEAD_STAGE_KEYS.map(s => {
                const cfg = CRM_LEAD_STAGES[s];
                const cnt = scope.filter(l => l.status === s).length;
                const pct = total > 0 ? Math.round(cnt/total*100) : 0;
                return `<div style="background:#fff;border:1px solid #E2E8F0;border-radius:10px;padding:10px 4px;text-align:center">
                    <div style="font-size:20px;font-weight:900;color:${cfg.color}">${cnt}</div>
                    <div style="font-size:10px;color:#64748B;margin-top:2px">${cfg.icon} ${s}</div>
                    <div style="font-size:9px;color:#94A3B8">${pct}%</div>
                </div>`;
            }).join('')}
        </div>

        <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
            <input class="mod-form-input" style="flex:1;min-width:200px" placeholder="🔍 ابحث بالاسم أو المحل أو التليفون..." value="${_crmLeadsSearch}" oninput="crmLeadsSearchInput(this.value)">
        </div>
        <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:6px;margin-bottom:12px">
            ${['الكل', ...CRM_LEAD_STAGE_KEYS].map(s => {
                const active = s === _crmLeadsFilter;
                const cfg = CRM_LEAD_STAGES[s];
                const cnt = s === 'الكل' ? scope.length : scope.filter(l => l.status === s).length;
                return `<button onclick="crmLeadsSetFilter('${s}')" style="white-space:nowrap;border-radius:20px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid ${active && cfg ? cfg.color : '#E2E8F0'};background:${active && cfg ? cfg.color : '#fff'};color:${active ? (cfg ? '#fff' : '#0F172A') : '#64748B'}">${s} (${cnt})</button>`;
            }).join('')}
        </div>

        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>الاسم</th><th>المحل</th><th>الحالة</th><th>المسؤول</th><th>آخر تواصل</th><th>المتابعة القادمة</th><th style="text-align:center">إجراءات</th>
            </tr></thead>
            <tbody>
                ${list.length === 0 ? `<tr><td colspan="7" class="empty-state"><span>🎯</span>لا يوجد عملاء محتملون مطابقون.</td></tr>` :
                list.map(l => {
                    const cfg = CRM_LEAD_STAGES[l.status] || { color: '#64748B', icon: '?' };
                    const urg = crmLeadUrgent(l);
                    return `<tr style="${urg ? 'background:#FEF2F2' : ''}">
                        <td style="font-weight:600">${l.name}${l.converted_customer_id ? ' <span style="font-size:10px;color:#059669">(تحوّل لعميل)</span>' : ''}</td>
                        <td style="color:#64748B">${l.shop || '—'}<div style="font-size:11px;color:#94A3B8">${l.area || ''}</div></td>
                        <td><span style="padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;border:1px solid ${cfg.color};color:${cfg.color}">${cfg.icon} ${l.status}</span></td>
                        <td style="font-size:12px;color:#64748B">${crmAgentName(l)}</td>
                        <td style="font-size:12px">${l.last_contact_date ? new Date(l.last_contact_date).toLocaleDateString('ar-EG') : 'لم يتم التواصل'}</td>
                        <td style="font-size:12px;${urg ? 'color:#DC2626;font-weight:700' : ''}">${l.next_follow_up_date ? new Date(l.next_follow_up_date).toLocaleDateString('ar-EG') : '—'}</td>
                        <td style="text-align:center;white-space:nowrap">
                            <a class="cc-edit" style="background:#DCFCE7;color:#16A34A;text-decoration:none" href="${crmWaLink(l)}" target="_blank">📲</a>
                            <button class="cc-edit" style="background:#EFF6FF;color:#2563EB" onclick="crmOpenEditLead('${l.id}')">✏️</button>
                            ${l.status === 'اشترى' && !l.converted_customer_id ? `<button class="cc-edit" style="background:#D1FAE5;color:#059669" onclick="crmConvertLead('${l.id}')">👤 تحويل لعميل</button>` : ''}
                            <button class="cc-edit" style="background:#FEE2E2;color:#DC2626" onclick="crmDeleteLead('${l.id}')">🗑️</button>
                        </td>
                    </tr>`;
                }).join('')}
            </tbody></table>
        </div>`;
}

window.crmLeadsSetView = function (v) { _crmLeadsView = v; crmRenderLeadsPage(document.getElementById('crmModeBody')); };
window.crmLeadsSetFilter = function (s) { _crmLeadsFilter = s; crmRenderLeadsPage(document.getElementById('crmModeBody')); };
window.crmLeadsSearchInput = function (v) { _crmLeadsSearch = v; crmRenderLeadsPage(document.getElementById('crmModeBody')); };

window.crmDeleteLead = async function (id) {
    if (!confirm('حذف هذا العميل المحتمل نهائياً؟')) return;
    try {
        const { error } = await sb.from('crm_leads').delete().eq('id', id);
        if (error) throw error;
        await crmLoadLeadsData();
        crmRenderLeadsPage(document.getElementById('crmModeBody'));
    } catch (err) { alert('❌ خطأ: ' + err.message); }
};

// ---- تحويل Lead لعميل حقيقي ----
window.crmConvertLead = async function (id) {
    const lead = _crmLeads.find(l => l.id === id);
    if (!lead) return;
    if (!confirm(`تحويل "${lead.name}" لعميل حقيقي في النظام؟`)) return;
    try {
        const phoneDigits = (lead.phone || '').replace(/\D/g, '');
        if (phoneDigits) {
            const { data: dupCust } = await sb.from('customers').select('id,name').ilike('phone', `%${phoneDigits.slice(-8)}%`).limit(1);
            if (dupCust && dupCust.length) {
                if (!confirm(`⚠️ في عميل موجود بنفس رقم التليفون تقريبًا: "${dupCust[0].name}".\nمتأكد إنك عايز تنشئ عميل جديد بدل ما تربطه بالموجود؟`)) return;
            }
        }
        const { data: newCust, error } = await sb.from('customers').insert({
            name: lead.name,
            phone: lead.phone || null,
            address: [lead.shop, lead.area].filter(Boolean).join(' — ') || null,
            balance: 0,
            is_active: true,
            created_by: currentUser?.id || null,
        }).select().single();
        if (error) throw error;
        const { error: updErr } = await sb.from('crm_leads').update({
            converted_customer_id: newCust.id, status: 'اشترى', updated_at: new Date().toISOString(),
        }).eq('id', id);
        if (updErr) throw updErr;
        alert('✅ تم إنشاء العميل بنجاح');
        await crmLoadLeadsData();
        crmRenderLeadsPage(document.getElementById('crmModeBody'));
    } catch (err) { alert('❌ خطأ: ' + err.message); }
};

// ---- إضافة/تعديل Lead ----
window.crmOpenAddLead = function () {
    crmOpenLeadModal(null);
};
window.crmOpenEditLead = function (id) {
    crmOpenLeadModal(_crmLeads.find(l => l.id === id));
};

function crmOpenLeadModal(lead) {
    const isEdit = !!lead;
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'crmLeadModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:520px">
            <div class="mod-modal-header"><h3>${isEdit ? '✏️ تعديل عميل محتمل' : '🎯 عميل محتمل جديد'}</h3>
                <button class="mod-modal-close" onclick="document.getElementById('crmLeadModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <input type="hidden" id="lm-id" value="${lead?.id || ''}">
                ${isEdit ? `
                <div class="mod-form-group"><label>الحالة</label>
                    <div id="lm-stages" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
                        ${CRM_LEAD_STAGE_KEYS.map(s => {
                            const cfg = CRM_LEAD_STAGES[s];
                            const sel = lead.status === s;
                            return `<button type="button" data-stage="${s}" onclick="crmSelectLeadStage(this,'${s}')"
                                style="padding:8px 4px;border-radius:8px;border:2px solid ${cfg.color};text-align:center;cursor:pointer;font-size:11px;font-weight:700;
                                background:${sel ? cfg.color : '#fff'};color:${sel ? '#fff' : cfg.color}">${cfg.icon} ${s}</button>`;
                        }).join('')}
                    </div>
                </div>` : ''}
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>اسم العميل *</label>
                        <input class="mod-form-input" id="lm-name" value="${lead?.name || ''}"></div>
                    <div class="mod-form-group"><label>اسم المحل</label>
                        <input class="mod-form-input" id="lm-shop" value="${lead?.shop || ''}"></div>
                    <div class="mod-form-group"><label>رقم الهاتف *</label>
                        <input class="mod-form-input" id="lm-phone" value="${lead?.phone || ''}" placeholder="01XXXXXXXXX"></div>
                    <div class="mod-form-group"><label>المنطقة</label>
                        <input class="mod-form-input" id="lm-area" value="${lead?.area || ''}"></div>
                    <div class="mod-form-group"><label>نوع النشاط</label>
                        <select class="mod-form-input" id="lm-type">
                            <option value="">اختر...</option>
                            ${['بقالة','سوبر ماركت','ميني ماركت','كافيه','مطعم','جملة','كيوسك'].map(t => `<option ${lead?.activity_type===t?'selected':''}>${t}</option>`).join('')}
                        </select></div>
                    <div class="mod-form-group"><label>مصدر العميل</label>
                        <select class="mod-form-input" id="lm-source">
                            <option value="">اختر...</option>
                            ${['مندوب','واتساب','زيارة مباشرة','توصية','سوشيال ميديا'].map(t => `<option ${lead?.source===t?'selected':''}>${t}</option>`).join('')}
                        </select></div>
                    <div class="mod-form-group"><label>المسؤول</label>
                        <select class="mod-form-input" id="lm-assigned">
                            <option value="">بدون تحديد</option>
                            ${_crmProfiles.map(p => `<option value="${p.id}" ${(lead?.assigned_to===p.id || (!lead && p.id===currentUser?.id))?'selected':''}>${p.name}</option>`).join('')}
                        </select></div>
                    <div class="mod-form-group"><label>موعد المتابعة القادمة</label>
                        <input class="mod-form-input" type="date" id="lm-follow" value="${lead?.next_follow_up_date || ''}"></div>
                    ${isEdit ? `<div class="mod-form-group"><label>قيمة آخر طلب (جنيه)</label>
                        <input class="mod-form-input" type="number" id="lm-order" value="${lead?.last_order_amount || ''}"></div>` : ''}
                </div>
                <div class="mod-form-group"><label>ملاحظات</label>
                    <textarea class="mod-form-input" id="lm-notes" rows="3">${lead?.notes || ''}</textarea></div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="document.getElementById('crmLeadModal').remove()">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="crmSaveLead(${isEdit})">💾 حفظ</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    setTimeout(() => document.getElementById('lm-name')?.focus(), 50);
}

window.crmSelectLeadStage = function (btn, stage) {
    document.querySelectorAll('#lm-stages [data-stage]').forEach(b => {
        const cfg = CRM_LEAD_STAGES[b.dataset.stage];
        b.style.background = '#fff'; b.style.color = cfg.color;
    });
    const cfg = CRM_LEAD_STAGES[stage];
    btn.style.background = cfg.color; btn.style.color = '#fff';
    btn.dataset.selected = '1';
};

window.crmSaveLead = async function (isEdit) {
    const id = document.getElementById('lm-id').value;
    const name = document.getElementById('lm-name').value.trim();
    const phone = document.getElementById('lm-phone').value.trim();
    if (!name || !phone) return alert('⚠️ اسم العميل والهاتف مطلوبان');

    const payload = {
        name,
        phone,
        shop: document.getElementById('lm-shop').value.trim() || null,
        area: document.getElementById('lm-area').value.trim() || null,
        activity_type: document.getElementById('lm-type').value || null,
        source: document.getElementById('lm-source').value || null,
        assigned_to: document.getElementById('lm-assigned').value || null,
        next_follow_up_date: document.getElementById('lm-follow').value || null,
        notes: document.getElementById('lm-notes').value.trim() || null,
    };

    const btn = document.querySelector('#crmLeadModal .mod-btn-primary');
    btn.innerText = '⏳ جاري الحفظ...'; btn.disabled = true;
    try {
        if (isEdit) {
            const selStage = document.querySelector('#lm-stages [data-selected="1"]');
            if (selStage) payload.status = selStage.dataset.stage;
            payload.last_order_amount = Number(document.getElementById('lm-order').value) || 0;
            payload.last_contact_date = crmToday();
            payload.updated_at = new Date().toISOString();
            const { error } = await sb.from('crm_leads').update(payload).eq('id', id);
            if (error) throw error;
        } else {
            // فحص تكرار بالتليفون قبل الإضافة
            const phoneDigits = phone.replace(/\D/g, '');
            const dup = _crmLeads.find(l => (l.phone||'').replace(/\D/g,'').slice(-8) === phoneDigits.slice(-8));
            if (dup && !confirm(`⚠️ في عميل محتمل بنفس الرقم تقريبًا: "${dup.name}" (${dup.status}).\nتضيف بردو؟`)) {
                btn.innerText = '💾 حفظ'; btn.disabled = false;
                return;
            }
            payload.created_by = currentUser?.id || null;
            const { error } = await sb.from('crm_leads').insert(payload);
            if (error) throw error;
        }
        document.getElementById('crmLeadModal').remove();
        await crmLoadLeadsData();
        crmRenderLeadsPage(document.getElementById('crmModeBody'));
    } catch (err) {
        const hint = _crmLeadsTableMissing ? '\n\nتأكد من تشغيل crm_leads_migration.sql في Supabase.' : '';
        alert('❌ خطأ: ' + err.message + hint);
        btn.innerText = '💾 حفظ'; btn.disabled = false;
    }
};

// ════════════════════════════════════════════════════════════
// 3) قوالب رسائل الواتساب (مركزية — app_settings)
// ════════════════════════════════════════════════════════════
window.crmOpenTemplatesModal = function () {
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'crmTplModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:560px">
            <div class="mod-modal-header"><h3>✏️ تعديل رسائل الواتساب</h3>
                <button class="mod-modal-close" onclick="document.getElementById('crmTplModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:11px;color:#1E40AF;line-height:1.8">
                    <strong>المتغيرات المتاحة:</strong>
                    <code>{name}</code> = اسم العميل &nbsp;|&nbsp;
                    <code>{shop}</code> = اسم المحل &nbsp;|&nbsp;
                    <code>{agent}</code> = اسم المسؤول
                </div>
                ${CRM_LEAD_STAGE_KEYS.filter(s => s !== 'خسرناه').map(s => `
                    <div class="mod-form-group">
                        <label style="color:${CRM_LEAD_STAGES[s].color}">${CRM_LEAD_STAGES[s].icon} رسالة "${s}"</label>
                        <textarea class="mod-form-input" id="tpl-${s}" rows="5" style="font-size:12px">${_crmTemplates[s] || CRM_DEFAULT_TEMPLATES[s] || ''}</textarea>
                    </div>`).join('')}
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#FEE2E2;color:#DC2626" onclick="crmResetTemplates()">↩️ استعادة الافتراضي</button>
                <button class="mod-btn mod-btn-primary" onclick="crmSaveTemplates()">💾 حفظ القوالب</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
};

window.crmResetTemplates = function () {
    CRM_LEAD_STAGE_KEYS.filter(s => s !== 'خسرناه').forEach(s => {
        const el = document.getElementById('tpl-' + s);
        if (el) el.value = CRM_DEFAULT_TEMPLATES[s] || '';
    });
};

window.crmSaveTemplates = async function () {
    const templates = {};
    CRM_LEAD_STAGE_KEYS.filter(s => s !== 'خسرناه').forEach(s => {
        const el = document.getElementById('tpl-' + s);
        if (el && el.value.trim()) templates[s] = el.value.trim();
    });
    try {
        const { error } = await sb.from('app_settings').upsert({
            key: 'crm_whatsapp_templates', value: templates, updated_at: new Date().toISOString(),
        });
        if (error) throw error;
        _crmTemplates = templates;
        document.getElementById('crmTplModal').remove();
        alert('✅ تم حفظ القوالب — هتظهر لكل مستخدمي الكول سنتر (ديسك توب وموبايل)');
    } catch (err) { alert('❌ خطأ: ' + err.message); }
};

Object.assign(window, {
    renderCRM, crmSwitchMode,
    crmSwitchFilter, crmMarkDone, crmDelete, crmOpenAdd,
    crmCustSearchInput, crmPickCust, crmSave,
    crmLeadsSetView, crmLeadsSetFilter, crmLeadsSearchInput,
    crmDeleteLead, crmConvertLead, crmOpenAddLead, crmOpenEditLead,
    crmSelectLeadStage, crmSaveLead,
    crmOpenTemplatesModal, crmResetTemplates, crmSaveTemplates,
});
