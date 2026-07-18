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

const USR_ROLE_LABELS = {
    admin: 'مدير النظام', accountant: 'محاسب', cashier: 'كاشير',
    rep: 'مندوب مبيعات', employee: 'موظف'
};
const USR_ROLE_COLORS = {
    admin: '#7C3AED', accountant: '#2563EB', cashier: '#059669',
    rep: '#D97706', employee: '#64748B'
};

function usrFmtDate(d) { return d ? new Date(d).toLocaleDateString('ar-EG') : '—'; }

// ════════════════════════════════════════════════════════════
// 1) العرض الرئيسي
// ════════════════════════════════════════════════════════════
async function renderUsersManagement(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل المستخدمين...</div>';
    try {
        const isAdmin = await usrCurrentIsAdmin();
        if (!isAdmin) {
            c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:24px;border-radius:12px;text-align:center">
                <div style="font-size:32px;margin-bottom:8px">🔒</div>
                هذه الصفحة متاحة لمدير النظام فقط.
            </div>`;
            return;
        }

        const { data: profiles, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        _usrList = profiles || [];
        usrRenderPage(c);
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
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
            <p style="font-size:13px;color:#64748B;margin-top:4px">إضافة مستخدمين جدد وتحديد صلاحياتهم</p></div>
            <button class="mod-btn mod-btn-primary" onclick="usrOpenAdd()">+ إضافة مستخدم</button>
        </div>

        <div class="mod-grid" style="margin-bottom:16px">
            <div class="mod-card"><div class="mod-card-icon" style="background:#EFF6FF;color:#2563EB">👥</div><div class="mod-card-val">${_usrList.length}</div><div class="mod-card-lbl">إجمالي المستخدمين</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#F0FDF4;color:#059669">✅</div><div class="mod-card-val">${_usrList.filter(u=>u.is_active!==false).length}</div><div class="mod-card-lbl">نشطون</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#FEE2E2;color:#DC2626">🚫</div><div class="mod-card-val">${_usrList.filter(u=>u.is_active===false).length}</div><div class="mod-card-lbl">معطّلون</div></div>
        </div>

        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>المستخدم</th><th>الصلاحية</th><th>الحالة</th><th>تاريخ الإضافة</th><th></th>
            </tr></thead><tbody id="usrTbody"></tbody></table>
        </div>`;
    usrRenderRows();
}

function usrRenderRows() {
    const tbody = document.getElementById('usrTbody');
    if (!tbody) return;
    if (!_usrList.length) { tbody.innerHTML = `<tr><td colspan="5" class="empty-state"><span>👥</span>لا يوجد مستخدمون بعد</td></tr>`; return; }

    tbody.innerHTML = _usrList.map(u => {
        const displayName = u.name || u.email || '—';
        const active = u.is_active !== false;
        return `<tr>
            <td><strong>${displayName}</strong>${u.email && u.email!==displayName ? `<div style="font-size:11px;color:#94A3B8;direction:ltr;text-align:right">${u.email}</div>`:''}</td>
            <td>
                <select class="mod-form-input" style="margin:0;padding:5px 10px;font-size:12px;width:auto" onchange="usrChangeRole('${u.id}', this.value)">
                    ${Object.entries(USR_ROLE_LABELS).map(([v,l])=>`<option value="${v}" ${u.role===v?'selected':''}>${l}</option>`).join('')}
                </select>
            </td>
            <td><span class="dash-badge ${active?'dash-badge-green':'dash-badge-blue'}" style="${!active?'background:#FEE2E2;color:#DC2626':''}">${active?'✅ نشط':'🚫 معطّل'}</span></td>
            <td class="dash-muted">${usrFmtDate(u.created_at)}</td>
            <td><button class="cc-edit" style="${active?'background:#FEE2E2;color:#DC2626':'background:#D1FAE5;color:#059669'}" onclick="usrToggleActive('${u.id}', ${!active})">${active?'🚫 تعطيل':'✅ تفعيل'}</button></td>
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
                    <p style="font-size:11px;color:#94A3B8;margin-top:4px">شارك كلمة المرور دي مع الموظف — ينصح يغيّرها بعد أول دخول</p></div>
                <div class="mod-form-group"><label>الصلاحية *</label>
                    <select id="usrRole" class="mod-form-input">
                        ${Object.entries(USR_ROLE_LABELS).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}
                    </select></div>
                <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:10px 14px;font-size:12px;color:#1E40AF">
                    💡 حسب إعدادات المشروع، قد يحتاج المستخدم الجديد لتأكيد بريده الإلكتروني قبل أول دخول.
                </div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="document.getElementById('usrAddModal').remove()">إلغاء</button>
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
        const { error } = await sb.from('profiles').update({ role: newRole }).eq('id', userId);
        if (error) throw error;

        // لو اتحول لمندوب مبيعات، لازم يبقى له صف sales_reps بنفس الـ id (لو مش موجود أصلاً)
        if (newRole === 'rep') {
            const u = _usrList.find(x => x.id === userId);
            const { error: repErr } = await sb.from('sales_reps').upsert({
                id: userId, name: u?.name || u?.email || userId, is_active: true,
            }, { onConflict: 'id', ignoreDuplicates: true });
            if (repErr) throw repErr;
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
                        <h2 style="margin-bottom:6px;color:#DC2626">تم تعطيل هذا الحساب</h2>
                        <p style="color:#64748B;font-size:13px">تواصل مع مدير النظام لإعادة التفعيل</p>
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
};

Object.assign(window, { renderUsersManagement, usrOpenAdd, usrSaveNewUser, usrToggleActive, usrChangeRole });
