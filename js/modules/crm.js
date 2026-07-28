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

let _crmMode = 'tasks'; // 'tasks' | 'leads' | 'interactions'
let _crmTasksView = 'mine'; // 'mine' | 'all'
let _crmTopProductName = null; // أكتر صنف مبيعاً آخر 30 يوم — لمتغير {top_product} فى الرسائل
let _crmEditingVariants = {}; // نسخ رسائل إضافية بيتم تعديلها فى مودال القوالب قبل الحفظ

// ---- حالة التفاعلات (الموجودة من قبل) ----
let _crmList = [];
let _crmCustomers = [];
let _crmReps = [];
let _crmFilter = 'due'; // 'due' | 'all'
let _crmInteractionsView = 'mine'; // 'mine' | 'all'
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
    'تم التواصل':  { color: 'var(--inv-gold)', days: 3, icon: '📞' },
    'مهتم':        { color: '#7c3aed', days: 2, icon: '💡' },
    'طلب أسعار':   { color: '#9333ea', days: 2, icon: '💰' },
    'اشترى':       { color: 'var(--inv-green)', days: 7, icon: '✅' },
    'خسرناه':      { color: 'var(--inv-red)', days: null, icon: '❌' },
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
function crmWaMsg(l, variant) {
    let tmpl;
    if (variant && _crmTemplates._variants?.[l.status]?.[variant]) tmpl = _crmTemplates._variants[l.status][variant];
    else tmpl = _crmTemplates[l.status] || CRM_DEFAULT_TEMPLATES[l.status] || CRM_DEFAULT_TEMPLATES['جديد'];
    const days = l.last_contact_date ? crmDaysDiff(l.last_contact_date) : 0;
    return tmpl
        .replace(/{name}/g, l.name || 'العميل')
        .replace(/{shop}/g, l.shop || 'المحل')
        .replace(/{agent}/g, crmAgentName(l))
        .replace(/{days}/g, String(days))
        .replace(/{top_product}/g, _crmTopProductName || 'أصنافنا الجديدة');
}
function crmWaLink(l, variant) {
    const phone = (l.phone || '').replace(/\D/g, '');
    const intl = phone.startsWith('0') ? '2' + phone : phone;
    return `https://wa.me/${intl}?text=${encodeURIComponent(crmWaMsg(l, variant))}`;
}

// زرار واتساب لعميل محتمل — بيظهر قايمة اختيار نسخة الرسالة لو فيه
// نسخ إضافية معرّفة لمرحلته (راجع crmOpenTemplatesModal)، وإلا زرار عادي
function crmWaButtonHTML(l) {
    const variants = Object.keys(_crmTemplates._variants?.[l.status] || {});
    if (!variants.length) {
        return `<a class="cc-edit" style="background:#DCFCE7;color:#16A34A;text-decoration:none" href="${crmWaLink(l)}" target="_blank">📲</a>`;
    }
    return `<span style="display:inline-flex;gap:3px;align-items:center;vertical-align:middle">
        <select id="crmVar-${l.id}" style="font-size:10px;padding:3px;border-radius:6px;border:1px solid #E2E8F0;max-width:90px" onclick="event.stopPropagation()">
            <option value="">افتراضي</option>
            ${variants.map(v => `<option value="${v.replace(/"/g, '&quot;')}">${v}</option>`).join('')}
        </select>
        <button class="cc-edit" style="background:#DCFCE7;color:#16A34A" onclick="crmSendLeadWa('${l.id}')">📲</button>
    </span>`;
}
window.crmSendLeadWa = function (id) {
    const lead = _crmLeads.find(l => l.id === id);
    if (!lead) return;
    const variant = document.getElementById('crmVar-' + id)?.value || '';
    window.open(crmWaLink(lead, variant), '_blank');
};

// ---- رسالة واتساب عامة لمتابعة عميل حالي (مش Lead، ملوش مرحلة) ----
const CRM_CUSTOMER_TPL_KEY = 'متابعة_عميل_حالي';
const CRM_DEFAULT_CUSTOMER_TPL =
`السلام عليكم أستاذ {name} 👋
معاك {agent} من شركة سلطان للمواد الغذائية 🌟

حابين نطمن عليك ونعرف احتياجاتك الحالية، وهل محتاج أي أصناف تانية.

في خدمتك 🙏`;

function crmCustomerWaMsg(x) {
    const tmpl = _crmTemplates[CRM_CUSTOMER_TPL_KEY] || CRM_DEFAULT_CUSTOMER_TPL;
    const agent = _crmProfiles.find(p => p.id === x.assigned_to)?.name || currentUser?.name || 'سلطان';
    return tmpl.replace(/{name}/g, x.customers?.name || 'العميل').replace(/{agent}/g, agent);
}
function crmCustomerWaLink(x) {
    const phone = (x.customers?.phone || '').replace(/\D/g, '');
    if (!phone) return null;
    const intl = phone.startsWith('0') ? '2' + phone : phone;
    return `https://wa.me/${intl}?text=${encodeURIComponent(crmCustomerWaMsg(x))}`;
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
        c.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

async function crmLoadInteractionsData() {
    _crmTableMissing = false;
    try {
        const { data, error } = await sb.from('customer_interactions')
            .select('*, customers(name,phone), sales_reps(name), archive_documents(title,file_url)').order('interaction_date', { ascending: false });
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
        // ★ سلطان بيرجع أقصى 1000 صف لكل طلب بشكل افتراضي، فلازم نجيب على
        //   دفعات لحد ما نوصل لآخر صفحة، وإلا أي قائمة عملاء محتملين أكبر
        //   من 1000 (زي استيراد جهات اتصال بالجمله) هتتقطع بصمت من غير أي
        //   خطأ ظاهر — لا في الجدول ولا في كروت الإحصائيات فوقه.
        const PAGE = 1000;
        let all = [];
        let from = 0;
        while (true) {
            const { data, error } = await sb.from('crm_leads').select('*')
                .order('created_at', { ascending: false }).range(from, from + PAGE - 1);
            if (error) throw error;
            all = all.concat(data || []);
            if (!data || data.length < PAGE) break;
            from += PAGE;
        }
        _crmLeads = all;
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
    await crmLoadTopProduct();
}

// أكتر صنف بيتباع آخر 30 يوم (مبيعات مؤكدة) — لمتغير {top_product} فى رسائل الواتساب
async function crmLoadTopProduct() {
    try {
        const since = new Date(Date.now() - 30 * 86400000).toISOString();
        const { data: sales } = await sb.from('sales')
            .select('id, sale_items(product_id, qty)')
            .eq('status', 'confirmed').gte('created_at', since).limit(500);
        const map = {};
        (sales || []).forEach(s => (s.sale_items || []).forEach(it => {
            if (!it.product_id) return;
            map[it.product_id] = (map[it.product_id] || 0) + (Number(it.qty) || 0);
        }));
        let bestId = null, bestQty = 0;
        Object.keys(map).forEach(pid => { if (map[pid] > bestQty) { bestQty = map[pid]; bestId = pid; } });
        if (bestId) {
            const { data: p } = await sb.from('products').select('name').eq('id', bestId).maybeSingle();
            _crmTopProductName = p?.name || null;
        } else {
            _crmTopProductName = null;
        }
    } catch { _crmTopProductName = null; }
}

function crmRenderShell(c) {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
            <div><h2 style="font-size:22px;font-weight:800">🤝 إدارة علاقات العملاء</h2>
            <p style="font-size:13px;color:var(--inv-muted);margin-top:4px">عملاء محتملون وواتساب + متابعات العملاء الحاليين</p></div>
        </div>
        <div class="ob-tabs" style="margin-bottom:16px">
            <button class="ob-tab ${_crmMode === 'tasks' ? 'active' : ''}" onclick="crmSwitchMode('tasks')">📋 مهام اليوم</button>
            <button class="ob-tab ${_crmMode === 'leads' ? 'active' : ''}" onclick="crmSwitchMode('leads')">🎯 العملاء المحتملون</button>
            <button class="ob-tab ${_crmMode === 'interactions' ? 'active' : ''}" onclick="crmSwitchMode('interactions')">📞 متابعات العملاء الحاليين</button>
        </div>
        <div id="crmModeBody"></div>`;
    crmRefreshCurrentBody();
}

window.crmSwitchMode = function (m) {
    _crmMode = m;
    crmRenderShell(document.getElementById('app-content'));
};

// بيرندر التبويب الحالي فى مكانه — بتُستخدم بعد أي إجراء (حفظ/حذف/تعديل)
// عشان لو الإجراء اتعمل من تبويب "مهام اليوم" يفضل هو الظاهر مش يترندر
// تبويب تاني بالغلط (كانت المشكلة قبل كده إن كل دالة كانت بترندر تبويبها
// هي بس، فمن تبويب المهام كان ممكن يترندرلك تبويب تاني بعد الحفظ)
function crmRefreshCurrentBody() {
    const body = document.getElementById('crmModeBody');
    if (!body) return;
    if (_crmMode === 'tasks') crmRenderTasksPage(body);
    else if (_crmMode === 'leads') crmRenderLeadsPage(body);
    else crmRenderPage(body);
}

// ════════════════════════════════════════════════════════════
// 1) متابعات العملاء الحاليين (الموجودة من قبل، بدون تعديل جوهري)
// ════════════════════════════════════════════════════════════
function crmScopedInteractions() {
    return _crmInteractionsView === 'mine' && currentUser?.id
        ? _crmList.filter(x => x.assigned_to === currentUser.id)
        : _crmList;
}

function crmFilteredList() {
    const today = crmToday();
    let list = crmScopedInteractions();
    if (_crmFilter === 'due') {
        list = list.filter(x => !x.is_done && x.next_follow_up_date && x.next_follow_up_date <= today);
    }
    return list;
}

function crmRenderPage(c) {
    const today = crmToday();
    const scope = crmScopedInteractions();
    const overdue = scope.filter(x => !x.is_done && x.next_follow_up_date && x.next_follow_up_date < today).length;
    const dueToday = scope.filter(x => !x.is_done && x.next_follow_up_date === today).length;
    const upcoming = scope.filter(x => !x.is_done && x.next_follow_up_date && x.next_follow_up_date > today).length;
    const list = crmFilteredList();

    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
            <div class="ob-tabs">
                <button class="ob-tab ${_crmInteractionsView==='mine'?'active':''}" onclick="crmInteractionsSetView('mine')">👤 عملائي</button>
                <button class="ob-tab ${_crmInteractionsView==='all'?'active':''}" onclick="crmInteractionsSetView('all')">👥 الكل</button>
            </div>
            <button class="mod-btn mod-btn-primary" onclick="crmOpenAdd()">+ تسجيل تفاعل / تحديد مهمة</button>
        </div>

        ${_crmTableMissing ? `<div style="background:var(--inv-gold-bg);color:var(--inv-gold);padding:14px 18px;border-radius:10px;margin-bottom:16px;font-size:13px">⚠️ جدول التفاعلات لسه مش موجود — شغّل <code>crm_migration.sql</code> في Supabase.</div>` : ''}

        <div class="mod-grid" style="margin-bottom:16px">
            <div class="mod-card"><div class="mod-card-icon" style="background:var(--inv-red-bg);color:var(--inv-red)">⏰</div><div class="mod-card-val">${overdue}</div><div class="mod-card-lbl">متابعات متأخرة</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:var(--inv-gold-bg);color:var(--inv-gold)">📅</div><div class="mod-card-val">${dueToday}</div><div class="mod-card-lbl">متابعات اليوم</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#EFF6FF;color:#2563EB">🔜</div><div class="mod-card-val">${upcoming}</div><div class="mod-card-lbl">متابعات قادمة</div></div>
        </div>

        <div class="ob-tabs" style="margin-bottom:12px">
            <button class="ob-tab ${_crmFilter==='due'?'active':''}" onclick="crmSwitchFilter('due')">المتابعات المستحقة</button>
            <button class="ob-tab ${_crmFilter==='all'?'active':''}" onclick="crmSwitchFilter('all')">كل التفاعلات</button>
        </div>

        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>العميل</th><th>النوع</th><th>المسؤول عن المتابعة</th><th>تاريخ التفاعل</th><th>ملاحظات</th><th>المتابعة القادمة</th><th style="text-align:center">إجراءات</th>
            </tr></thead>
            <tbody>
                ${list.length === 0 ? `<tr><td colspan="7" class="empty-state"><span>🤝</span>لا توجد تفاعلات مطابقة.</td></tr>` :
                list.map(x => {
                    const overdueRow = !x.is_done && x.next_follow_up_date && x.next_follow_up_date < today;
                    const waLink = crmCustomerWaLink(x);
                    const assignedName = _crmProfiles.find(p => p.id === x.assigned_to)?.name || x.sales_reps?.name || '—';
                    return `<tr style="${overdueRow ? 'background:var(--inv-red-bg)' : ''}">
                        <td style="font-weight:600">${x.customers?.name || '—'}</td>
                        <td>${CRM_TYPE_LABELS[x.type] || x.type}</td>
                        <td style="color:var(--inv-muted)">${assignedName}</td>
                        <td style="font-size:12px">${new Date(x.interaction_date).toLocaleDateString('ar-EG')}</td>
                        <td style="color:var(--inv-muted);max-width:220px">${x.notes || '—'}${x.archive_documents ? `<br><a href="${x.archive_documents.file_url}" target="_blank" rel="noopener" style="font-size:11px;color:var(--inv-gold)">📎 ${x.archive_documents.title}</a>` : ''}</td>
                        <td style="font-size:12px;${overdueRow ? 'color:var(--inv-red);font-weight:700' : ''}">${x.next_follow_up_date ? new Date(x.next_follow_up_date).toLocaleDateString('ar-EG') : '—'}</td>
                        <td style="text-align:center;white-space:nowrap">
                            ${waLink ? `<a class="cc-edit" style="background:#DCFCE7;color:#16A34A;text-decoration:none" href="${waLink}" target="_blank">📲</a>` : ''}
                            ${x.is_done ? '<span style="color:var(--inv-green);font-weight:600;font-size:12px">✅ تمّت</span>' :
                              x.next_follow_up_date ? `<button class="cc-edit" style="background:var(--inv-green-light);color:var(--inv-green)" onclick="crmMarkDone('${x.id}')">✅ تمّت المتابعة</button>` : ''}
                            <button class="cc-edit" style="background:var(--inv-red-bg);color:var(--inv-red)" onclick="crmDelete('${x.id}')">🗑️</button>
                        </td>
                    </tr>`;
                }).join('')}
            </tbody></table>
        </div>`;
}

window.crmSwitchFilter = function (f) { _crmFilter = f; crmRenderPage(document.getElementById('crmModeBody') || document.getElementById('app-content')); };
window.crmInteractionsSetView = function (v) { _crmInteractionsView = v; crmRenderPage(document.getElementById('crmModeBody') || document.getElementById('app-content')); };

window.crmMarkDone = async function (id) {
    try {
        const { error } = await sb.from('customer_interactions').update({ is_done: true }).eq('id', id);
        if (error) throw error;
        await crmLoadInteractionsData();
        crmRefreshCurrentBody();
    } catch (err) { alert('❌ خطأ: ' + err.message); }
};

window.crmDelete = async function (id) {
    if (!confirm('حذف هذا التفاعل نهائياً؟')) return;
    try {
        const { error } = await sb.from('customer_interactions').delete().eq('id', id);
        if (error) throw error;
        await crmLoadInteractionsData();
        crmRefreshCurrentBody();
    } catch (err) { alert('❌ خطأ: ' + err.message); }
};

// ════════════════════════════════════════════════════════════
// 1ب) تسجيل تفاعل جديد — بيتفتح من صفحة CRM نفسها، أو من كشف حساب
//    العميل (customers.js) بتمرير customerId جاهز
// ════════════════════════════════════════════════════════════
let _crmAddCustId = null;
let _crmMultiCustIds = []; // [{id,name}] — عميل واحد أو أكتر لنفس المهمة/التفاعل

window.crmOpenAdd = async function (presetCustomerId = null, presetCustomerName = '') {
    _crmAddCustId = presetCustomerId;
    _crmMultiCustIds = presetCustomerId ? [{ id: presetCustomerId, name: presetCustomerName }] : [];
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
    if (!_crmProfiles.length) {
        try {
            const { data } = await sb.from('profiles').select('id,name,role').eq('is_active', true).order('name');
            _crmProfiles = data || [];
        } catch { _crmProfiles = []; }
    }

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'crmModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:480px">
            <div class="mod-modal-header"><h3>📞 تسجيل تفاعل جديد</h3>
                <button class="mod-modal-close" onclick="document.getElementById('crmModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>العميل / العملاء *</label>
                    ${presetCustomerId ? `
                        <div class="mod-form-input" style="background:#F8FAFC;color:var(--inv-text-soft)">${presetCustomerName}</div>
                    ` : `
                        <button type="button" class="mod-btn" style="width:100%;background:#EFF6FF;color:#2563EB;justify-content:center" onclick="crmOpenCustPicker()">☑️ اختيار عملاء (<span id="crmMultiCount">0</span> محدد)</button>
                        <div id="crmMultiChips" style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px"></div>
                    `}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>نوع التفاعل</label>
                        <select id="crmType" class="mod-form-input">
                            ${Object.entries(CRM_TYPE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
                        </select></div>
                    <div class="mod-form-group"><label>المسؤول عن المتابعة</label>
                        <select id="crmAssigned" class="mod-form-input">
                            <option value="">بدون تحديد</option>
                            ${_crmProfiles.map(p => `<option value="${p.id}" ${p.id===currentUser?.id?'selected':''}>${p.name}</option>`).join('')}
                        </select></div>
                </div>
                ${_crmReps.length ? `
                <div class="mod-form-group"><label>مندوب الزيارة (اختياري)</label>
                    <select id="crmRep" class="mod-form-input">
                        <option value="">بدون مندوب</option>
                        ${_crmReps.map(r => `<option value="${r.id}">🚗 ${r.name}</option>`).join('')}
                    </select></div>` : ''}
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>تاريخ التفاعل</label>
                        <input type="date" id="crmDate" class="mod-form-input" value="${crmToday()}"></div>
                    <div class="mod-form-group"><label>تاريخ المتابعة القادمة (هتظهر كمهمة له)</label>
                        <input type="date" id="crmFollowUp" class="mod-form-input" placeholder="اختياري"></div>
                </div>
                <div class="mod-form-group"><label>ملاحظات</label>
                    <textarea id="crmNotes" class="mod-form-input" rows="3" placeholder="اختياري"></textarea></div>
                <div class="mod-form-group"><label>مرفق (اختياري)</label>
                    <input type="file" id="crmFile" class="mod-form-input">
                    <div style="font-size:11px;color:var(--inv-muted-light);margin-top:2px">هيتحفظ في الأرشيف تلقائياً ومربوط بالعميل ده</div></div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:var(--inv-text-soft)" onclick="document.getElementById('crmModal').remove()">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="crmSave()">💾 حفظ</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    crmRenderMultiChips();
    setTimeout(() => document.getElementById('crmType')?.focus(), 50);
};

// ════════════════════════════════════════════════════════════
// اختيار عملاء متعددين — نفس نمط "اختيار أصناف متعددة" فى
// van-stock-load.js/sales.js (بحث + قائمة checkbox)
// ════════════════════════════════════════════════════════════
function crmRenderMultiChips() {
    const box = document.getElementById('crmMultiChips');
    const cnt = document.getElementById('crmMultiCount');
    if (cnt) cnt.textContent = _crmMultiCustIds.length;
    if (!box) return;
    box.innerHTML = _crmMultiCustIds.map(c => `<span style="background:#EFF6FF;color:#2563EB;border:1px solid #BFDBFE;border-radius:20px;padding:4px 10px;font-size:11.5px;display:inline-flex;align-items:center;gap:6px">
        ${c.name} <span style="cursor:pointer;font-weight:800" onclick="crmRemoveCustChip('${c.id}')">✕</span>
    </span>`).join('');
}
window.crmRemoveCustChip = function (id) {
    _crmMultiCustIds = _crmMultiCustIds.filter(c => c.id !== id);
    crmRenderMultiChips();
};

window.crmOpenCustPicker = function () {
    document.getElementById('crmPickModal')?.remove();
    const m = document.createElement('div');
    m.id = 'crmPickModal';
    m.className = 'mod-modal-bg active';
    m.innerHTML = `
    <div class="mod-modal" style="max-width:520px">
        <div class="mod-modal-header"><h3>☑️ اختيار عملاء متعددين</h3>
            <button class="mod-modal-close" onclick="document.getElementById('crmPickModal').remove()">✕</button></div>
        <div class="mod-modal-body">
            <input type="text" class="mod-form-input" id="crmPickSearch" placeholder="🔍 بحث بالاسم..." autocomplete="off" oninput="crmRenderPickList(this.value)">
            <div id="crmPickList" style="margin-top:12px;display:flex;flex-direction:column;gap:6px;max-height:360px;overflow-y:auto"></div>
        </div>
        <div class="mod-modal-footer">
            <button class="mod-btn" style="background:#F1F5F9;color:var(--inv-text-soft)" onclick="document.getElementById('crmPickModal').remove()">تم</button>
        </div>
    </div>`;
    document.body.appendChild(m);
    crmRenderPickList('');
    setTimeout(() => document.getElementById('crmPickSearch')?.focus(), 50);
};

function crmRenderPickList(val) {
    const box = document.getElementById('crmPickList');
    if (!box) return;
    const list = flexSearch(_crmCustomers, val, ['name'], 200);
    if (!list.length) { box.innerHTML = '<div style="padding:20px;text-align:center;color:var(--inv-muted-light)">لا توجد نتائج</div>'; return; }
    box.innerHTML = list.map(c => {
        const checked = _crmMultiCustIds.some(x => x.id === c.id);
        return `<label style="display:flex;align-items:center;gap:10px;padding:7px 10px;border:1.5px solid #E2E8F0;border-radius:10px;cursor:pointer">
            <input type="checkbox" ${checked ? 'checked' : ''} onchange="crmTogglePick('${c.id}','${(c.name||'').replace(/'/g,"\\'")}',this.checked)">
            <span style="flex:1">${c.name}</span>
        </label>`;
    }).join('');
}
window.crmTogglePick = function (id, name, checked) {
    if (checked) {
        if (!_crmMultiCustIds.some(c => c.id === id)) _crmMultiCustIds.push({ id, name });
    } else {
        _crmMultiCustIds = _crmMultiCustIds.filter(c => c.id !== id);
    }
    crmRenderMultiChips();
};

window.crmSave = async function () {
    const type = document.getElementById('crmType').value;
    const rep_id = document.getElementById('crmRep')?.value || null;
    const assigned_to = document.getElementById('crmAssigned')?.value || null;
    const interaction_date = document.getElementById('crmDate').value;
    const next_follow_up_date = document.getElementById('crmFollowUp').value || null;
    const notes = document.getElementById('crmNotes').value.trim() || null;
    const file = document.getElementById('crmFile')?.files[0] || null;
    if (!_crmMultiCustIds.length) return alert('اختر عميل واحد على الأقل');
    if (!interaction_date) return alert('أدخل تاريخ التفاعل');

    const btn = document.querySelector('#crmModal .mod-btn-primary');
    btn.innerText = '⏳ جاري الحفظ...'; btn.disabled = true;
    try {
        // مرفق واحد (لو موجود) بيتحفظ مرة واحدة في الأرشيف ويترتبط بكل
        // التفاعلات اللي هتتسجل دفعة واحدة للعملاء المحددين
        let document_id = null;
        if (file) {
            const safeName = file.name.replace(/[^\w.\-]+/g, '_');
            const path = `${Date.now()}_${safeName}`;
            const { error: upErr } = await sb.storage.from('archive-documents').upload(path, file);
            if (upErr) throw upErr;
            const { data: pub } = sb.storage.from('archive-documents').getPublicUrl(path);
            const label = _crmMultiCustIds.length === 1 ? _crmMultiCustIds[0].name : `${_crmMultiCustIds.length} عملاء`;
            const { data: docRow, error: docErr } = await sb.from('archive_documents').insert({
                title: `مرفق تفاعل — ${label} — ${new Date(interaction_date).toLocaleDateString('ar-EG')}`,
                file_path: path, file_url: pub.publicUrl, file_type: file.type || '',
                category: 'CRM', linked_type: 'customer', linked_id: _crmMultiCustIds[0].id,
                uploaded_by: currentUser?.id || null,
            }).select().single();
            if (docErr) throw docErr;
            document_id = docRow.id;
        }

        const rows = _crmMultiCustIds.map(c => ({
            customer_id: c.id, type, rep_id, assigned_to, interaction_date, next_follow_up_date, notes, document_id,
            created_by: currentUser?.id || null,
        }));
        const { error } = await sb.from('customer_interactions').insert(rows);
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
// 1ج) مهام اليوم — قايمة موحّدة بتجمع العملاء المحتملين المتأخرين
//    (crmLeadUrgent) + متابعات العملاء الحاليين المستحقة، مرتبة
//    الأكثر تأخيراً فوق، عشان تفتحها الأول كل يوم وتشتغل عليها
//    نزول من غير ما تنقل بين تبويبين وتدوّر على اللي محتاج متابعة
// ════════════════════════════════════════════════════════════
function crmBuildTaskQueue() {
    const today = crmToday();
    const mineOnly = _crmTasksView === 'mine' && currentUser?.id;

    const leadTasks = _crmLeads
        .filter(l => crmLeadUrgent(l))
        .filter(l => !mineOnly || l.assigned_to === currentUser.id)
        .map(l => {
            const cfg = CRM_LEAD_STAGES[l.status] || { color: 'var(--inv-muted)', icon: '?' };
            const isDateDue = l.next_follow_up_date && l.next_follow_up_date <= today;
            const reason = isDateDue
                ? (l.next_follow_up_date < today ? `متابعة متأخرة من ${new Date(l.next_follow_up_date).toLocaleDateString('ar-EG')}` : 'متابعة مستحقة اليوم')
                : `واقف على مرحلة "${l.status}" من غير رد من ${crmDaysDiff(l.last_contact_date)} يوم`;
            const sortKey = isDateDue ? crmDaysDiff(l.next_follow_up_date) : crmDaysDiff(l.last_contact_date);
            return {
                kind: 'lead', id: l.id, sortKey,
                name: l.name, sub: l.shop || l.area || '',
                badge: `${cfg.icon} ${l.status}`, badgeColor: cfg.color, reason,
                lastContact: l.last_contact_date ? new Date(l.last_contact_date).toLocaleDateString('ar-EG') : 'لم يتم التواصل',
                lead: l,
            };
        });

    const interactionTasks = _crmList
        .filter(x => !x.is_done && x.next_follow_up_date && x.next_follow_up_date <= today)
        .filter(x => !mineOnly || x.assigned_to === currentUser.id)
        .map(x => {
            const reason = x.next_follow_up_date < today ? `متابعة متأخرة من ${new Date(x.next_follow_up_date).toLocaleDateString('ar-EG')}` : 'متابعة مستحقة اليوم';
            return {
                kind: 'interaction', id: x.id, sortKey: crmDaysDiff(x.next_follow_up_date),
                name: x.customers?.name || '—', sub: CRM_TYPE_LABELS[x.type] || x.type,
                badge: null, badgeColor: null, reason,
                lastContact: new Date(x.interaction_date).toLocaleDateString('ar-EG'),
                waLink: crmCustomerWaLink(x),
            };
        });

    return [...leadTasks, ...interactionTasks].sort((a, b) => b.sortKey - a.sortKey);
}

function crmRenderTasksPage(c) {
    const queue = crmBuildTaskQueue();
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
            <div class="ob-tabs">
                <button class="ob-tab ${_crmTasksView === 'mine' ? 'active' : ''}" onclick="crmTasksSetView('mine')">👤 مهامي</button>
                <button class="ob-tab ${_crmTasksView === 'all' ? 'active' : ''}" onclick="crmTasksSetView('all')">👥 الكل</button>
            </div>
            <div style="font-size:13px;color:var(--inv-muted)">${queue.length} مهمة مستحقة</div>
        </div>
        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>العميل</th><th>الحالة</th><th>السبب</th><th>آخر تواصل</th><th style="text-align:center">إجراءات</th>
            </tr></thead><tbody>
                ${queue.length === 0 ? `<tr><td colspan="5" class="empty-state"><span>✅</span>مفيش أي مهمة مستحقة النهارده — كله متابَع!</td></tr>` :
                queue.map(t => `<tr style="background:var(--inv-red-bg)">
                    <td style="font-weight:600">${t.name}<div style="font-size:11px;color:var(--inv-muted-light)">${t.sub || ''}</div></td>
                    <td>${t.badge ? `<span style="padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;border:1px solid ${t.badgeColor};color:${t.badgeColor}">${t.badge}</span>` : `<span style="font-size:12px;color:var(--inv-muted)">${t.sub}</span>`}</td>
                    <td style="font-size:12px;color:var(--inv-red);font-weight:600">${t.reason}</td>
                    <td style="font-size:12px">${t.lastContact}</td>
                    <td style="text-align:center;white-space:nowrap">
                        ${t.kind === 'lead' ? `
                            ${crmWaButtonHTML(t.lead)}
                            <button class="cc-edit" style="background:var(--inv-green-light);color:var(--inv-green)" onclick="crmQuickTouchLead('${t.id}')">📞 اتصلت</button>
                            <button class="cc-edit" style="background:#EFF6FF;color:#2563EB" onclick="crmOpenEditLead('${t.id}')">✏️</button>
                        ` : `
                            ${t.waLink ? `<a class="cc-edit" style="background:#DCFCE7;color:#16A34A;text-decoration:none" href="${t.waLink}" target="_blank">📲</a>` : ''}
                            <button class="cc-edit" style="background:var(--inv-green-light);color:var(--inv-green)" onclick="crmMarkDone('${t.id}')">✅ تمّت</button>
                        `}
                    </td>
                </tr>`).join('')}
            </tbody></table>
        </div>`;
}

window.crmTasksSetView = function (v) { _crmTasksView = v; crmRenderTasksPage(document.getElementById('crmModeBody')); };

// تواصل سريع مع عميل محتمل من قايمة المهام — بيسجل إن التواصل حصل
// النهارده وبيأجّل المتابعة القادمة بمدة مرحلته الحالية تلقائياً
// (زي "تم التواصل" اللي مسموح لها 3 أيام)، من غير ما يفتح المودال
// الكامل. لو محتاج يغيّر المرحلة أو يكتب ملاحظة، برضه فيه زرار ✏️ جنبه.
window.crmQuickTouchLead = async function (id) {
    const lead = _crmLeads.find(l => l.id === id);
    if (!lead) return;
    const cfg = CRM_LEAD_STAGES[lead.status];
    const nextDate = cfg?.days ? new Date(Date.now() + cfg.days * 86400000).toISOString().slice(0, 10) : null;
    try {
        const { error } = await sb.from('crm_leads').update({
            last_contact_date: crmToday(), next_follow_up_date: nextDate, updated_at: new Date().toISOString(),
        }).eq('id', id);
        if (error) throw error;
        await crmLoadLeadsData();
        crmRefreshCurrentBody();
    } catch (err) { alert('❌ خطأ: ' + err.message); }
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
    list = flexSearch(list, _crmLeadsSearch, ['name','shop','area','phone']);
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
        ${_crmLeadsTableMissing ? `<div style="background:var(--inv-gold-bg);color:var(--inv-gold);padding:14px 18px;border-radius:10px;margin-bottom:16px;font-size:13px">⚠️ جدول العملاء المحتملين لسه مش موجود — شغّل <code>crm_leads_migration.sql</code> في Supabase.</div>` : ''}

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
            <div class="ob-tabs">
                <button class="ob-tab ${_crmLeadsView==='mine'?'active':''}" onclick="crmLeadsSetView('mine')">👤 عملائي</button>
                <button class="ob-tab ${_crmLeadsView==='all'?'active':''}" onclick="crmLeadsSetView('all')">👥 الكل</button>
            </div>
            <div style="display:flex;gap:8px">
                <button class="mod-btn" style="background:#F1F5F9;color:var(--inv-text-soft)" onclick="crmOpenTemplatesModal()">✏️ رسائل الواتساب</button>
                <button class="mod-btn mod-btn-primary" onclick="crmOpenAddLead()">+ عميل محتمل جديد</button>
            </div>
        </div>

        <div class="mod-grid" style="margin-bottom:14px">
            <div class="mod-card"><div class="mod-card-icon" style="background:#EFF6FF;color:#2563EB">👥</div><div class="mod-card-val">${total}</div><div class="mod-card-lbl">إجمالي العملاء المحتملين</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#DBEAFE;color:#3B82F6">🆕</div><div class="mod-card-val">${newC}</div><div class="mod-card-lbl">عملاء جدد</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:var(--inv-green-light);color:var(--inv-green)">✅</div><div class="mod-card-val">${ordered}</div><div class="mod-card-lbl">اشتروا</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:var(--inv-red-bg);color:var(--inv-red)">⚠️</div><div class="mod-card-val">${urgent}</div><div class="mod-card-lbl">تحتاج متابعة</div></div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:14px">
            ${CRM_LEAD_STAGE_KEYS.map(s => {
                const cfg = CRM_LEAD_STAGES[s];
                const cnt = scope.filter(l => l.status === s).length;
                const pct = total > 0 ? Math.round(cnt/total*100) : 0;
                return `<div style="background:#fff;border:1px solid #E2E8F0;border-radius:10px;padding:10px 4px;text-align:center">
                    <div style="font-size:20px;font-weight:900;color:${cfg.color}">${cnt}</div>
                    <div style="font-size:10px;color:var(--inv-muted);margin-top:2px">${cfg.icon} ${s}</div>
                    <div style="font-size:9px;color:var(--inv-muted-light)">${pct}%</div>
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
                return `<button onclick="crmLeadsSetFilter('${s}')" style="white-space:nowrap;border-radius:20px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid ${active && cfg ? cfg.color : 'var(--inv-border)'};background:${active && cfg ? cfg.color : 'var(--inv-card)'};color:${active ? (cfg ? '#fff' : 'var(--inv-navy-deep)') : 'var(--inv-muted)'}">${s} (${cnt})</button>`;
            }).join('')}
        </div>

        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>الاسم</th><th>المحل</th><th>الحالة</th><th>المسؤول</th><th>آخر تواصل</th><th>المتابعة القادمة</th><th style="text-align:center">إجراءات</th>
            </tr></thead>
            <tbody>
                ${list.length === 0 ? `<tr><td colspan="7" class="empty-state"><span>🎯</span>لا يوجد عملاء محتملون مطابقون.</td></tr>` :
                list.map(l => {
                    const cfg = CRM_LEAD_STAGES[l.status] || { color: 'var(--inv-muted)', icon: '?' };
                    const urg = crmLeadUrgent(l);
                    return `<tr style="${urg ? 'background:var(--inv-red-bg)' : ''}">
                        <td style="font-weight:600">${l.name}${l.converted_customer_id ? ' <span style="font-size:10px;color:var(--inv-green)">(تحوّل لعميل)</span>' : ''}</td>
                        <td style="color:var(--inv-muted)">${l.shop || '—'}<div style="font-size:11px;color:var(--inv-muted-light)">${l.area || ''}</div></td>
                        <td><span style="padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;border:1px solid ${cfg.color};color:${cfg.color}">${cfg.icon} ${l.status}</span></td>
                        <td style="font-size:12px;color:var(--inv-muted)">${crmAgentName(l)}</td>
                        <td style="font-size:12px">${l.last_contact_date ? new Date(l.last_contact_date).toLocaleDateString('ar-EG') : 'لم يتم التواصل'}</td>
                        <td style="font-size:12px;${urg ? 'color:var(--inv-red);font-weight:700' : ''}">${l.next_follow_up_date ? new Date(l.next_follow_up_date).toLocaleDateString('ar-EG') : '—'}</td>
                        <td style="text-align:center;white-space:nowrap">
                            ${crmWaButtonHTML(l)}
                            <button class="cc-edit" style="background:#EFF6FF;color:#2563EB" onclick="crmOpenEditLead('${l.id}')">✏️</button>
                            ${l.status === 'اشترى' && !l.converted_customer_id ? `<button class="cc-edit" style="background:var(--inv-green-light);color:var(--inv-green)" onclick="crmConvertLead('${l.id}')">👤 تحويل لعميل</button>` : ''}
                            <button class="cc-edit" style="background:var(--inv-red-bg);color:var(--inv-red)" onclick="crmDeleteLead('${l.id}')">🗑️</button>
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
        crmRefreshCurrentBody();
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
        crmRefreshCurrentBody();
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
                <button class="mod-btn" style="background:#F1F5F9;color:var(--inv-text-soft)" onclick="document.getElementById('crmLeadModal').remove()">إلغاء</button>
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
        crmRefreshCurrentBody();
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
    _crmEditingVariants = JSON.parse(JSON.stringify(_crmTemplates._variants || {}));
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
                    <code>{agent}</code> = اسم المسؤول &nbsp;|&nbsp;
                    <code>{days}</code> = عدد الأيام من آخر تواصل &nbsp;|&nbsp;
                    <code>{top_product}</code> = أكتر صنف بيتباع دلوقتي
                </div>
                <div style="font-size:11px;font-weight:700;color:var(--inv-muted-light);letter-spacing:.5px;text-transform:uppercase;margin:6px 0">رسائل العملاء المحتملين (Leads)</div>
                ${CRM_LEAD_STAGE_KEYS.filter(s => s !== 'خسرناه').map(s => `
                    <div class="mod-form-group">
                        <label style="color:${CRM_LEAD_STAGES[s].color}">${CRM_LEAD_STAGES[s].icon} رسالة "${s}" (الافتراضية)</label>
                        <textarea class="mod-form-input" id="tpl-${s}" rows="5" style="font-size:12px">${_crmTemplates[s] || CRM_DEFAULT_TEMPLATES[s] || ''}</textarea>
                    </div>
                    <div id="crmVariantsBox-${s}" style="margin:0 0 16px;padding:10px;background:#F8FAFC;border-radius:8px">
                        ${crmRenderVariantRows(s)}
                    </div>`).join('')}
                <div style="font-size:11px;font-weight:700;color:var(--inv-muted-light);letter-spacing:.5px;text-transform:uppercase;margin:14px 0 6px">رسالة متابعة عميل حالي (مش Lead)</div>
                <div class="mod-form-group">
                    <label style="color:#0891B2">🤝 رسالة متابعة عميل موجود بالفعل</label>
                    <textarea class="mod-form-input" id="tpl-${CRM_CUSTOMER_TPL_KEY}" rows="5" style="font-size:12px">${_crmTemplates[CRM_CUSTOMER_TPL_KEY] || CRM_DEFAULT_CUSTOMER_TPL}</textarea>
                </div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:var(--inv-red-bg);color:var(--inv-red)" onclick="crmResetTemplates()">↩️ استعادة الافتراضي</button>
                <button class="mod-btn mod-btn-primary" onclick="crmSaveTemplates()">💾 حفظ القوالب</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
};

// نسخ إضافية اختيارية لكل مرحلة (غير الرسالة الافتراضية) — بتظهر كقايمة
// اختيار جنب زرار 📲 فى جدول العملاء المحتملين وقايمة مهام اليوم، عشان
// يبقى فيه أكتر من صياغة لنفس المرحلة (تذكير أول/تاني/عرض خاص...) بدل
// ما يفضل نفس النص بيتكرر لكل عميل
function crmRenderVariantRows(stage) {
    const variants = _crmEditingVariants[stage] || {};
    const names = Object.keys(variants);
    return `
        <div style="font-size:11px;font-weight:700;color:var(--inv-muted-light);margin-bottom:6px">نسخ إضافية لمرحلة "${stage}" (اختياري)</div>
        ${names.map(name => `
            <div style="display:flex;gap:6px;margin-bottom:6px;align-items:flex-start">
                <input class="mod-form-input" style="width:110px;font-size:11px;padding:6px" value="${name}" onchange="crmRenameVariant('${stage}','${name.replace(/'/g, "\\'")}',this.value)">
                <textarea class="mod-form-input" style="flex:1;font-size:11px" rows="3" oninput="crmEditVariantText('${stage}','${name.replace(/'/g, "\\'")}',this.value)">${variants[name] || ''}</textarea>
                <button type="button" class="cc-edit" style="background:var(--inv-red-bg);color:var(--inv-red)" onclick="crmRemoveVariant('${stage}','${name.replace(/'/g, "\\'")}')">✕</button>
            </div>`).join('')}
        <button type="button" class="mod-btn" style="background:#EFF6FF;color:#2563EB;font-size:11px;padding:6px 10px" onclick="crmAddVariant('${stage}')">➕ نسخة جديدة</button>
    `;
}

window.crmAddVariant = function (stage) {
    if (!_crmEditingVariants[stage]) _crmEditingVariants[stage] = {};
    let n = 1, name = 'نسخة 1';
    while (_crmEditingVariants[stage][name] != null) { n++; name = 'نسخة ' + n; }
    _crmEditingVariants[stage][name] = '';
    const box = document.getElementById('crmVariantsBox-' + stage);
    if (box) box.innerHTML = crmRenderVariantRows(stage);
};
window.crmRemoveVariant = function (stage, name) {
    if (_crmEditingVariants[stage]) delete _crmEditingVariants[stage][name];
    const box = document.getElementById('crmVariantsBox-' + stage);
    if (box) box.innerHTML = crmRenderVariantRows(stage);
};
window.crmEditVariantText = function (stage, name, val) {
    if (!_crmEditingVariants[stage]) _crmEditingVariants[stage] = {};
    _crmEditingVariants[stage][name] = val;
};
window.crmRenameVariant = function (stage, oldName, newName) {
    newName = (newName || '').trim();
    if (!newName || newName === oldName) return;
    const obj = _crmEditingVariants[stage] || {};
    if (obj[newName] != null) { alert('⚠️ فيه نسخة بنفس الاسم بالفعل'); const box = document.getElementById('crmVariantsBox-' + stage); if (box) box.innerHTML = crmRenderVariantRows(stage); return; }
    obj[newName] = obj[oldName];
    delete obj[oldName];
    _crmEditingVariants[stage] = obj;
    const box = document.getElementById('crmVariantsBox-' + stage);
    if (box) box.innerHTML = crmRenderVariantRows(stage);
};

window.crmResetTemplates = function () {
    CRM_LEAD_STAGE_KEYS.filter(s => s !== 'خسرناه').forEach(s => {
        const el = document.getElementById('tpl-' + s);
        if (el) el.value = CRM_DEFAULT_TEMPLATES[s] || '';
    });
    const custEl = document.getElementById('tpl-' + CRM_CUSTOMER_TPL_KEY);
    if (custEl) custEl.value = CRM_DEFAULT_CUSTOMER_TPL;
};

window.crmSaveTemplates = async function () {
    const templates = {};
    CRM_LEAD_STAGE_KEYS.filter(s => s !== 'خسرناه').forEach(s => {
        const el = document.getElementById('tpl-' + s);
        if (el && el.value.trim()) templates[s] = el.value.trim();
    });
    const custEl = document.getElementById('tpl-' + CRM_CUSTOMER_TPL_KEY);
    if (custEl && custEl.value.trim()) templates[CRM_CUSTOMER_TPL_KEY] = custEl.value.trim();

    const variants = {};
    Object.keys(_crmEditingVariants).forEach(stage => {
        const clean = {};
        Object.keys(_crmEditingVariants[stage] || {}).forEach(name => {
            const text = (_crmEditingVariants[stage][name] || '').trim();
            if (text) clean[name] = text;
        });
        if (Object.keys(clean).length) variants[stage] = clean;
    });
    if (Object.keys(variants).length) templates._variants = variants;

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
    crmSwitchFilter, crmInteractionsSetView, crmMarkDone, crmDelete, crmOpenAdd,
    crmOpenCustPicker, crmTogglePick, crmRemoveCustChip, crmSave,
    crmLeadsSetView, crmLeadsSetFilter, crmLeadsSearchInput,
    crmDeleteLead, crmConvertLead, crmOpenAddLead, crmOpenEditLead,
    crmSelectLeadStage, crmSaveLead,
    crmOpenTemplatesModal, crmResetTemplates, crmSaveTemplates,
    crmTasksSetView, crmQuickTouchLead, crmSendLeadWa,
    crmAddVariant, crmRemoveVariant, crmEditVariantText, crmRenameVariant,
});
