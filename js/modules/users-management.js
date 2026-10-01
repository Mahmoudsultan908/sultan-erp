/* ════════════════════════════════════════════════════════════
   إدارة المستخدمين — users-management.js
   قائمة + إضافة مستخدم جديد (Auth + Profile) + تفعيل/تعطيل + تغيير دور
   يصدّر: renderUsersManagement(container)

   ★ ملاحظة تحميل مهمة: هذا الملف الوحيد في المشروع الذي يجب أن
   يُحمَّل بعد app.js (لا قبله كباقي الموديولات)، لأنه يحتاج يلف
   دالة setupApp() الموجودة فعلياً في app.js لإضافة فحص is_active
   عند الدخول. راجع index.html — الترتيب مُعدّل عمداً لهذا السبب.
   ════════════════════════════════════════════════════════════ */

let _usrList = [];
// نطاق الفروع لكل مستخدم (branches.js + جدول user_branches): بيظهر بس لما يبقى فيه أكتر من فرع نشط
let _usrBr = { multi: false, list: [], map: {} };
const USR_SCOPABLE_ROLES = ['employee', 'cashier', 'rep'];   // الأدمن والمحاسب مش بيتقيّدوا (قيد في القاعدة)
function usrEsc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

const USR_ROLE_LABELS = {
    admin: 'مدير النظام', accountant: 'محاسب', cashier: 'كاشير',
    rep: 'مندوب مبيعات', employee: 'موظف'
};
const USR_ROLE_COLORS = {
    admin: '#7C3AED', accountant: '#2563EB', cashier: 'var(--inv-green)',
    rep: 'var(--inv-gold)', employee: 'var(--inv-muted)'
};

function usrFmtDate(d) { return d ? new Date(d).toLocaleDateString('ar-EG') : '—'; }

// بند 7 (تحديد المستخدمين النشطين)، 2026-07-25. "متصل الآن" = last_seen
// خلال آخر 3 دقايق (نفس فكرة heartbeat بسيطة، بدون realtime/presence
// عشان ميضيفش تعقيد لسيرفر مالوش الأساس ده أصلاً)
const USR_ONLINE_WINDOW_MS = 3 * 60 * 1000;
function usrIsOnline(lastSeen) { return lastSeen && (Date.now() - new Date(lastSeen).getTime()) < USR_ONLINE_WINDOW_MS; }
function usrFmtLastSeen(d) {
    if (!d) return '—';
    if (usrIsOnline(d)) return '<span style="color:var(--inv-green);font-weight:700">🟢 متصل الآن</span>';
    return new Date(d).toLocaleString('ar-EG', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}

// ════════════════════════════════════════════════════════════
// 1) العرض الرئيسي
// ════════════════════════════════════════════════════════════
async function renderUsersManagement(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل المستخدمين...</div>';
    try {
        const isAdmin = await usrCurrentIsAdmin();
        if (!isAdmin) {
            c.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:24px;border-radius:12px;text-align:center">
                <div style="font-size:32px;margin-bottom:8px">🔒</div>
                هذه الصفحة متاحة لمدير النظام فقط.
            </div>`;
            return;
        }

        const { data: profiles, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        _usrList = profiles || [];
        // نطاق الفروع (لو الفروع متاحة وفيه أكتر من فرع نشط) — أي فشل هنا مايأثرش على باقي الشاشة
        _usrBr = { multi: false, list: [], map: {} };
        try {
            if (typeof brLoad === 'function') {
                const b = await brLoad(true);
                if (b.ok) {
                    _usrBr.list = b.list;
                    _usrBr.multi = b.list.filter(x => x.is_active).length > 1;
                    if (_usrBr.multi) {
                        const { data: ub } = await sb.from('user_branches').select('user_id, branch_id');
                        (ub || []).forEach(r => { (_usrBr.map[r.user_id] = _usrBr.map[r.user_id] || []).push(r.branch_id); });
                    }
                }
            }
        } catch { /* مفيش نطاق فروع */ }
        usrRenderPage(c);
    } catch (err) {
        c.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

async function usrCurrentIsAdmin() {
    try {
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return false;
        const { data: p } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
        // فشِل آمن: لو مفيش صف profile للمستخدم الحالي أصلاً (حساب قديم من قبل هذه الميزة)،
        // نسمح بالوصول كمدير افتراضياً — أفضل من قفل صاحب النظام برا حسابه بالخطأ
        if (!p) return true;
        return p.role === 'admin';
    } catch { return true; }
}

function usrRenderPage(c) {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px">
            <div><h2 style="font-size:22px;font-weight:800">👥 إدارة المستخدمين</h2>
            <p style="font-size:13px;color:var(--inv-muted);margin-top:4px">إضافة مستخدمين جدد وتحديد صلاحياتهم</p></div>
            <button class="mod-btn mod-btn-primary" onclick="usrOpenAdd()">+ إضافة مستخدم</button>
        </div>

        <div class="mod-grid" style="margin-bottom:16px">
            <div class="mod-card"><div class="mod-card-icon" style="background:#EFF6FF;color:#2563EB">👥</div><div class="mod-card-val">${_usrList.length}</div><div class="mod-card-lbl">إجمالي المستخدمين</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:var(--inv-green-light);color:var(--inv-green)">🟢</div><div class="mod-card-val">${_usrList.filter(u=>usrIsOnline(u.last_seen)).length}</div><div class="mod-card-lbl">متصلون الآن</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:var(--inv-red-bg);color:var(--inv-red)">🚫</div><div class="mod-card-val">${_usrList.filter(u=>u.is_active===false).length}</div><div class="mod-card-lbl">معطّلون</div></div>
        </div>

        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>المستخدم</th><th>الصلاحية</th>${_usrBr.multi ? '<th>الفروع</th>' : ''}<th>الحالة</th><th>آخر ظهور</th><th></th>
            </tr></thead><tbody id="usrTbody"></tbody></table>
        </div>`;
    usrRenderRows();
    // تحديث "آخر ظهور" لحظيًا كل نص دقيقة، من غير ما نعيد تحميل الصفحة كلها
    clearInterval(window._usrRefreshTimer);
    window._usrRefreshTimer = setInterval(() => {
        if (document.getElementById('usrTbody')) usrRenderRows(); else clearInterval(window._usrRefreshTimer);
    }, 30000);
}

function usrRenderRows() {
    const tbody = document.getElementById('usrTbody');
    if (!tbody) return;
    if (!_usrList.length) { tbody.innerHTML = `<tr><td colspan="5" class="empty-state"><span>👥</span>لا يوجد مستخدمون بعد</td></tr>`; return; }

    tbody.innerHTML = _usrList.map(u => {
        const displayName = u.name || u.email || '—';
        const active = u.is_active !== false;
        return `<tr>
            <td><strong>${displayName}</strong>${u.email && u.email!==displayName ? `<div style="font-size:11px;color:var(--inv-muted-light);direction:ltr;text-align:right">${u.email}</div>`:''}</td>
            <td>
                <select class="mod-form-input" style="margin:0;padding:5px 10px;font-size:12px;width:auto" onchange="usrChangeRole('${u.id}', this.value)">
                    ${Object.entries(USR_ROLE_LABELS).map(([v,l])=>`<option value="${v}" ${u.role===v?'selected':''}>${l}</option>`).join('')}
                </select>
            </td>
            ${_usrBr.multi ? `<td style="font-size:12.5px">${usrBranchCellHtml(u)}</td>` : ''}
            <td><span class="dash-badge ${active?'dash-badge-green':'dash-badge-blue'}" style="${!active?'background:var(--inv-red-bg);color:var(--inv-red)':''}">${active?'✅ نشط':'🚫 معطّل'}</span></td>
            <td class="dash-muted" style="font-size:12.5px">${usrFmtLastSeen(u.last_seen)}</td>
            <td><button class="cc-edit" style="${active?'background:var(--inv-red-bg);color:var(--inv-red)':'background:var(--inv-green-light);color:var(--inv-green)'}" onclick="usrToggleActive('${u.id}', ${!active})">${active?'🚫 تعطيل':'✅ تفعيل'}</button></td>
        </tr>`;
    }).join('');
}

// ════════════════════════════════════════════════════════════
// 2) إضافة مستخدم جديد (Auth + Profile)
// ════════════════════════════════════════════════════════════
window.usrOpenAdd = function() {
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'usrAddModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:440px">
            <div class="mod-modal-header"><h3>👥 إضافة مستخدم جديد</h3>
                <button class="mod-modal-close" onclick="document.getElementById('usrAddModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>الاسم الكامل</label>
                    <input type="text" id="usrName" class="mod-form-input" placeholder="مثال: أحمد محمد"></div>
                <div class="mod-form-group"><label>البريد الإلكتروني *</label>
                    <input type="email" id="usrEmail" class="mod-form-input" dir="ltr" placeholder="example@sultan.com"></div>
                <div class="mod-form-group"><label>كلمة المرور المبدئية *</label>
                    <input type="text" id="usrPassword" class="mod-form-input" dir="ltr" placeholder="6 أحرف على الأقل">
                    <p style="font-size:11px;color:var(--inv-muted-light);margin-top:4px">شارك كلمة المرور دي مع الموظف — ينصح يغيّرها بعد أول دخول</p></div>
                <div class="mod-form-group"><label>الصلاحية *</label>
                    <select id="usrRole" class="mod-form-input">
                        ${Object.entries(USR_ROLE_LABELS).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}
                    </select></div>
                <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:10px 14px;font-size:12px;color:#1E40AF">
                    💡 حسب إعدادات المشروع، قد يحتاج المستخدم الجديد لتأكيد بريده الإلكتروني قبل أول دخول.
                </div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:var(--inv-text-soft)" onclick="document.getElementById('usrAddModal').remove()">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="usrSaveNewUser()">💾 إضافة المستخدم</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    setTimeout(()=>document.getElementById('usrName')?.focus(), 50);
};

window.usrSaveNewUser = async function() {
    const full_name = document.getElementById('usrName').value.trim();
    const email = document.getElementById('usrEmail').value.trim();
    const password = document.getElementById('usrPassword').value;
    const role = document.getElementById('usrRole').value;

    if (!email) return alert('البريد الإلكتروني مطلوب');
    if (!password || password.length < 6) return alert('كلمة المرور يجب ألا تقل عن 6 أحرف');

    const btn = document.querySelector('#usrAddModal .mod-btn-primary');
    btn.innerText = '⏳ جاري الإضافة...'; btn.disabled = true;

    try {
        // ★ عميل Supabase منفصل ومؤقت للتسجيل فقط — عشان جلسة الأدمن الحالي
        // ما تتبدلش بجلسة المستخدم الجديد (signUp بيسجل دخول تلقائي على نفس الـ client)
        const tempClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        const { data, error } = await tempClient.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.user) throw new Error('تعذّر إنشاء المستخدم — حاول مرة أخرى');

        // إنشاء صف profile مرتبط بنفس الـ id (عبر جلسة الأدمن الأصلية sb، مش المؤقتة)
        // ★ العمود الحقيقي في جدول profiles اسمه name مش full_name — كان فيه
        // خطأ هنا بيخلي كل محاولة إضافة مستخدم تفشل (جدول profiles.name فقط)
        const { error: profileErr } = await sb.from('profiles').upsert({
            id: data.user.id, email, name: full_name || email, role, is_active: true,
        });
        if (profileErr) throw profileErr;

        // مندوب مبيعات: لازم صف sales_reps بنفس الـ id، عشان فواتيره/مخزون عربيته
        // يتربطوا بيه (sales.rep_id و van_stock.rep_id بيعتمدوا على نفس الـ id ده)
        if (role === 'rep') {
            const { error: repErr } = await sb.from('sales_reps').upsert({
                id: data.user.id, name: full_name || email, is_active: true,
            });
            if (repErr) throw repErr;
            await usrEnsureRepTreasury(data.user.id, full_name || email);
        }

        document.getElementById('usrAddModal').remove();
        alert('✅ تم إضافة المستخدم بنجاح');
        renderUsersManagement(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ: ' + err.message);
        btn.innerText = '💾 إضافة المستخدم'; btn.disabled = false;
    }
};

// ════════════════════════════════════════════════════════════
// 3) تفعيل / تعطيل / تغيير الدور
// ════════════════════════════════════════════════════════════
// كل مندوب لازم يكون له خزنة خاصة بيه (مقبوضاته/مصروفاته الميدانية
// منفصلة عن الخزنة الرئيسية لحد التوريد) ومستوى سعر افتراضي — بيتعمل
// مرة واحدة بس أول ما المستخدم يبقى مندوب، مش هيكرر لو موجود بالفعل
async function usrEnsureRepTreasury(repId, repName) {
    try {
        const { data: rep } = await sb.from('sales_reps').select('treasury_id,price_level_id').eq('id', repId).maybeSingle();
        if (rep?.treasury_id) return; // موجودة بالفعل

        const { data: treas, error: treasErr } = await sb.from('treasuries')
            .insert({ name: `خزنة ${repName} (مندوب)`, is_default: false, is_active: true })
            .select('id').single();
        if (treasErr) throw treasErr;

        const { data: retailLevel } = await sb.from('price_levels').select('id').eq('code', 'RETAIL').maybeSingle();

        await sb.from('sales_reps').update({
            treasury_id: treas.id,
            price_level_id: rep?.price_level_id || retailLevel?.id || null,
        }).eq('id', repId);
    } catch (err) {
        console.warn('تعذّر إنشاء خزنة المندوب تلقائياً:', err.message);
    }
}

// ════════════════════════════════════════════════════════════
// نطاق الفروع للمستخدم (branch_scope + user_branches) — التنفيذ الفعلي في القاعدة (سياسات RLS + Triggers)
//   all      = بيشوف وينشئ بيانات كل الفروع (الوضع الافتراضي لكل المستخدمين)
//   assigned = بيشوف وينشئ بيانات الفروع المحددة له بس (للكاشير/الموظف/المندوب فقط)
// ════════════════════════════════════════════════════════════
function usrBranchCellHtml(u) {
    const scoped = u.branch_scope === 'assigned';
    const names = (_usrBr.map[u.id] || []).map(id => { const b = _usrBr.list.find(x => x.id === id); return b ? usrEsc(b.name) : ''; }).filter(Boolean);
    const label = scoped
        ? (names.length ? names.join('، ') : '<span style="color:var(--inv-red)">⚠️ مقيَّد بدون فروع (مابيشوفش حاجة)</span>')
        : '<span style="color:var(--inv-muted)">كل الفروع</span>';
    const canScope = USR_SCOPABLE_ROLES.includes(u.role);
    return `${label} <button class="cc-edit" style="margin-right:6px" onclick="usrOpenBranches('${u.id}')" title="${canScope ? 'تحديد الفروع' : 'الأدمن والمحاسب بيشوفوا كل الفروع'}" ${canScope ? '' : 'disabled'}>🏬</button>`;
}

window.usrOpenBranches = function(userId) {
    const u = _usrList.find(x => x.id === userId); if (!u) return;
    if (!USR_SCOPABLE_ROLES.includes(u.role)) return alert('الأدمن والمحاسب بيشوفوا كل الفروع (عشان تقاريرهم شاملة). التقييد للكاشير والموظف والمندوب بس.');
    const scoped = u.branch_scope === 'assigned';
    const mine = _usrBr.map[u.id] || [];
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active'; modal.id = 'usrBrModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:440px">
            <div class="mod-modal-header"><h3>🏬 فروع ${usrEsc(u.name || u.email)}</h3>
                <button class="mod-modal-close" onclick="document.getElementById('usrBrModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;margin-bottom:8px">
                    <input type="radio" name="usrScope" value="all" ${scoped ? '' : 'checked'} onchange="usrBrScopeChanged()" style="width:auto"> كل الفروع (بدون تقييد)
                </label>
                <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;margin-bottom:8px">
                    <input type="radio" name="usrScope" value="assigned" ${scoped ? 'checked' : ''} onchange="usrBrScopeChanged()" style="width:auto"> فروع محددة فقط
                </label>
                <div id="usrBrList" style="margin:8px 22px 0;display:${scoped ? 'block' : 'none'}">
                    ${_usrBr.list.filter(b => b.is_active || mine.includes(b.id)).map(b => `
                        <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin:4px 0">
                            <input type="checkbox" class="usrBrChk" value="${usrEsc(b.id)}" ${mine.includes(b.id) ? 'checked' : ''} style="width:auto"> ${usrEsc(b.name)}${b.is_active ? '' : ' (معطّل)'}
                        </label>`).join('')}
                </div>
                <p style="font-size:11.5px;color:var(--inv-muted-light);margin-top:12px;line-height:1.7">
                    المستخدم المقيَّد بيشوف وينشئ فواتير ومصروفات وتحصيلات ومخزون وخزن فروعه بس، والقاعدة بتمنعه من غير كده حتى لو حاول من برا الشاشة.
                    تحويلات الخزن والمخازن، وعربيات المناديب، والجرد، ودفتر الأستاذ، وبعض التقارير الشاملة لسه مش مقيّدة بالكامل، فالأنسب تقييد الكاشير والموظف والمندوب بس.</p>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:var(--inv-text-soft)" onclick="document.getElementById('usrBrModal').remove()">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="usrSaveBranches('${u.id}')">💾 حفظ</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
};

window.usrBrScopeChanged = function() {
    const assigned = document.querySelector('input[name="usrScope"]:checked')?.value === 'assigned';
    const el = document.getElementById('usrBrList'); if (el) el.style.display = assigned ? 'block' : 'none';
};

window.usrSaveBranches = async function(userId) {
    const u = _usrList.find(x => x.id === userId); if (!u) return;
    const assigned = document.querySelector('input[name="usrScope"]:checked')?.value === 'assigned';
    const picked = Array.from(document.querySelectorAll('.usrBrChk:checked')).map(x => x.value);
    if (assigned && !picked.length) return alert('اختار فرع واحد على الأقل، أو اختار "كل الفروع".');
    if (assigned && !USR_SCOPABLE_ROLES.includes(u.role)) return alert('الأدمن والمحاسب مينفعش يتقيّدوا بفروع.');
    const btn = document.querySelector('#usrBrModal .mod-btn-primary'); btn.disabled = true; btn.innerText = '⏳ جاري الحفظ...';
    try {
        if (assigned) {
            // الترتيب مهم: الفروع الأول، وبعدين نفعّل التقييد — عشان مفيش لحظة المستخدم يكون فيها مقيَّد بدون فروع
            const { error: dErr } = await sb.from('user_branches').delete().eq('user_id', userId);
            if (dErr) throw dErr;
            const { error: iErr } = await sb.from('user_branches').insert(picked.map(b => ({ user_id: userId, branch_id: b })));
            if (iErr) throw iErr;
            const { error: pErr } = await sb.from('profiles').update({ branch_scope: 'assigned' }).eq('id', userId);
            if (pErr) throw pErr;
        } else {
            const { error: pErr } = await sb.from('profiles').update({ branch_scope: 'all' }).eq('id', userId);
            if (pErr) throw pErr;
            await sb.from('user_branches').delete().eq('user_id', userId);   // تنظيف؛ فشلها مش مؤثر (التقييد اتشال)
        }
        document.getElementById('usrBrModal')?.remove();
        renderUsersManagement(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ تعذّر الحفظ: ' + err.message);
        btn.disabled = false; btn.innerText = '💾 حفظ';
    }
};

window.usrToggleActive = async function(userId, activate) {
    const msg = activate ? 'إعادة تفعيل هذا المستخدم؟' : 'تعطيل هذا المستخدم؟ لن يستطيع الدخول للنظام بعدها.';
    if (!confirm(msg)) return;
    try {
        const { error } = await sb.from('profiles').update({ is_active: activate }).eq('id', userId);
        if (error) throw error;
        renderUsersManagement(document.getElementById('app-content'));
    } catch (err) { alert('❌ خطأ: ' + err.message); }
};

window.usrChangeRole = async function(userId, newRole) {
    try {
        const cur = _usrList.find(x => x.id === userId);
        const patch = { role: newRole };
        // مستخدم مقيَّد بفروع واتحول لدور شامل (أدمن/محاسب): القاعدة بترفض الدور ده مع التقييد، فبنشيل التقييد معاه
        if (cur && cur.branch_scope === 'assigned' && !USR_SCOPABLE_ROLES.includes(newRole)) {
            if (!confirm('المستخدم ده مقيَّد بفروع معيّنة. الدور الجديد (' + (USR_ROLE_LABELS[newRole] || newRole) + ') بيشوف كل الفروع، فهيتشال التقييد. تكمل؟')) {
                renderUsersManagement(document.getElementById('app-content')); return;
            }
            patch.branch_scope = 'all';
        }
        const { error } = await sb.from('profiles').update(patch).eq('id', userId);
        if (error) throw error;
        if (patch.branch_scope === 'all') renderUsersManagement(document.getElementById('app-content'));

        // لو اتحول لمندوب مبيعات، لازم يبقى له صف sales_reps بنفس الـ id (لو مش موجود أصلاً)
        if (newRole === 'rep') {
            const u = _usrList.find(x => x.id === userId);
            const { error: repErr } = await sb.from('sales_reps').upsert({
                id: userId, name: u?.name || u?.email || userId, is_active: true,
            }, { onConflict: 'id', ignoreDuplicates: true });
            if (repErr) throw repErr;
            await usrEnsureRepTreasury(userId, u?.name || u?.email || userId);
        }
    } catch (err) {
        alert('❌ خطأ: ' + err.message);
        renderUsersManagement(document.getElementById('app-content'));
    }
};

// ════════════════════════════════════════════════════════════
// 4) إنفاذ فعلي عند الدخول: حظر المستخدم المعطَّل + عرض الدور الحقيقي
// ════════════════════════════════════════════════════════════
// ملاحظة: هذا الملف يُحمَّل بعد app.js عمداً، فـ window.setupApp
// يكون معرَّفاً بالفعل هنا ويمكن لفّه بأمان.
const _origSetupAppForUsers = window.setupApp;
window.setupApp = async function() {
    try {
        const { data: { user } } = await sb.auth.getUser();
        if (user) {
            const { data: profile } = await sb.from('profiles').select('role, is_active, name').eq('id', user.id).maybeSingle();
            if (profile && profile.is_active === false) {
                await sb.auth.signOut();
                document.getElementById('root').innerHTML = `
                    <div class="login-wrapper"><div class="login-card">
                        <div class="login-logo">🚫</div>
                        <h2 style="margin-bottom:6px;color:var(--inv-red)">تم تعطيل هذا الحساب</h2>
                        <p style="color:var(--inv-muted);font-size:13px">تواصل مع مدير النظام لإعادة التفعيل</p>
                        <button class="login-btn" style="margin-top:16px" onclick="location.reload()">رجوع لتسجيل الدخول</button>
                    </div></div>`;
                return; // ★ لا نكمّل تحميل التطبيق للمستخدم المعطَّل
            }
            window._currentUserRole = profile?.role || 'admin';
            window._currentUserRoleLabel = USR_ROLE_LABELS[profile?.role] || 'مدير النظام';
        }
    } catch (e) { /* فشل آمن: لو الفحص فشل لأي سبب، نكمّل تحميل التطبيق عادي */ }

    await _origSetupAppForUsers();

    // تحديث بادج الدور في الشريط العلوي بالدور الحقيقي بدل النص الثابت
    const badge = document.getElementById('userBadge');
    if (badge && window._currentUserRoleLabel) {
        badge.innerHTML = `${currentUser.email} <span>${window._currentUserRoleLabel}</span>`;
    }

    usrStartHeartbeat();
};

// نبضة حضور بسيطة — تحدّث profiles.last_seen عند الدخول وكل دقيقتين
// بعد كده طول ما التبويب مفتوح، عشان صفحة "إدارة المستخدمين" تقدر
// تعرض "متصل الآن" لأي حد فاتح البرنامج فعليًا دلوقتي (بند 7، 2026-07-25)
function usrStartHeartbeat() {
    if (window._usrHeartbeatTimer) return; // مرة واحدة بس لكل جلسة صفحة
    const beat = async () => {
        try {
            if (currentUser?.id) await sb.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', currentUser.id);
        } catch { /* فشل النبضة مالوش أثر على استخدام البرنامج، نتجاهله بهدوء */ }
    };
    beat();
    window._usrHeartbeatTimer = setInterval(beat, 120000);
}

// ★ بدء مستقل عن setupApp() — فى جلسة متصفح فيها تسجيل دخول محفوظ
// مسبقاً (Reload لصفحة مفتوحة أصلاً)، sb.auth.getSession() بيرجع بسرعة
// كفاية إن initApp() فى app.js ينادي setupApp() الأصلي قبل ما السكريبت
// ده يخلص تحميله ويستبدلها — فالـ wrap فوق ميتنفذش أول مرة. الحل هنا:
// بولينج بسيط لحد ما currentUser يبقى جاهز، من غير أي اعتماد على wrap.
(function usrHeartbeatBootstrap() {
    const tryStart = () => {
        if (typeof currentUser !== 'undefined' && currentUser?.id) { usrStartHeartbeat(); return; }
        setTimeout(tryStart, 400);
    };
    tryStart();
})();

Object.assign(window, { renderUsersManagement, usrOpenAdd, usrSaveNewUser, usrToggleActive, usrChangeRole });
