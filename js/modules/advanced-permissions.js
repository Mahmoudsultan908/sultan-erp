/* ════════════════════════════════════════════════════════════
   الصلاحيات المتقدمة — advanced-permissions.js
   يصدّر: renderAdvancedPermissions(container)

   صلاحيات على مستوى الصفحة لكل دور (يستخدم profiles.role الموجود
   فعلاً — نفس الأدوار المعرّفة في users-management.js)، مخزّنة في
   جدول role_permissions (راجع advanced_permissions_migration.sql).

   ★ فلسفة "قائمة منع" لا "قائمة سماح": وجود صف (role, page_key)
   يعني الدور ده ممنوع من الصفحة دي. عدم وجود صف = مسموح افتراضياً.
   ده مهم عشان أي دور موجود بالفعل النهارده (وكل الصفحات مفتوحة له)
   ميتقفلش فجأة من كل حاجة بمجرد ما الجدول اتعمل وقبل ما حد يظبطه.

   👑 role = 'admin' مُستثنى دائماً من أي تقييد (فحص صريح في كل مكان).

   ★ ملاحظة تحميل مهمة (نفس فلسفة users-management.js بالضبط): لازم
   يتحمّل بعد app.js لأنه بيلف window.loadMod الموجودة فعلاً لمنع
   فتح الصفحات الممنوعة + إخفاءها من القائمة الجانبية. راجع index.html.
   ════════════════════════════════════════════════════════════ */

const AP_ROLES = [
    ['accountant', 'محاسب'], ['cashier', 'كاشير'], ['rep', 'مندوب مبيعات'], ['employee', 'موظف'],
];

// نفس صفحات القائمة الجانبية في app.js (buildLayout) — ما عدا dashboard
// (متاحة دايماً للجميع) وadvanced-permissions نفسها (تفادي قفلها من نفسها).
const AP_PAGE_GROUPS = [
    { title: 'الأصناف / العملاء / الموردين', pages: [
        ['products', '🏷️ الأصناف (+ استيراد Excel)'],
        ['customers-hub', '👤 العملاء (+ استيراد + كشف حساب)'],
        ['suppliers-hub', '🏭 الموردين (+ استيراد + كشف حساب)'],
    ]},
    { title: 'المبيعات والعملاء', pages: [
        ['sales', '🧾 فاتورة المبيعات'], ['quotations', '📋 عروض الأسعار'],
        ['collections', '💵 تحصيل العملاء'], ['crm', '🤝 إدارة علاقات العملاء'],
        ['rep-app-link', '🚗 مندوب سلطان'], ['customer-orders-link', '🔗 طلبات العملاء'],
    ]},
    { title: 'المشتريات والموردين', pages: [
        ['purchases', '📥 فاتورة المشتريات'], ['purchase-orders', '📋 أوامر الشراء'],
        ['payments', '💸 دفع الموردين'],
    ]},
    { title: 'المراجعة والمرتجعات', pages: [
        ['invoice-review', '🔍 مراجعة الفواتير'], ['returns', '↩️ المرتجعات'],
    ]},
    { title: 'المالية والمخزن', pages: [
        ['expenses', '💸 المصروفات'], ['treasury', '🏦 الخزن'], ['balance-transfer', '🔀 تحويل أرصدة'],
        ['inventory-hub', '📦 المخزون (+ تحويل + مخازن + تقارير)'],
    ]},
    { title: 'الموظفين', pages: [
        ['payroll', '👥 الموظفون والرواتب'], ['employee-evaluation', '⭐ تقييم الموظفين'],
    ]},
    { title: 'المحاسبة', pages: [
        ['coa', '📒 شجرة الحسابات'],
        ['accounting-books', '📖 الدفاتر (قيود + أستاذ + ميزان + ميزانية)'],
        ['accounting-monitoring', '🔍 المراقبة والأرشفة (خزينة + تدقيق + أرشيف)'],
    ]},
    { title: '🔜 قريباً', pages: [
        ['whatsapp', '💬 واتساب'], ['ai-dashboard', '🤖 لوحة الذكاء الاصطناعي'],
    ]},
    { title: 'التقارير والإعدادات', pages: [
        ['reports-hub', '📈 التقارير (عام + أداء متقدم)'],
        ['general-import-export', '🔄 استيراد/تصدير عام'], ['print-center', '🖨️ مركز الطباعة'],
        ['opening-balances', '📋 الأرصدة الافتتاحية'],
        ['settings-hub', '⚙️ الإعدادات (+ المستخدمون + الصلاحيات)'],
    ]},
];

// ════════════════════════════════════════════════════════════
// 1) التقديم الرئيسي (إدارة المصفوفة) — لمدير النظام فقط
// ════════════════════════════════════════════════════════════
async function apCurrentIsAdmin() {
    if (window._currentUserRole) return window._currentUserRole === 'admin';
    try {
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return false;
        const { data: p } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
        // فشِل آمن: نفس فلسفة usrCurrentIsAdmin في users-management.js
        if (!p) return true;
        return p.role === 'admin';
    } catch { return true; }
}

async function renderAdvancedPermissions(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل الصلاحيات...</div>';
    try {
        const isAdmin = await apCurrentIsAdmin();
        if (!isAdmin) {
            c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:24px;border-radius:12px;text-align:center">
                <div style="font-size:32px;margin-bottom:8px">🔒</div>
                هذه الصفحة متاحة لمدير النظام فقط.
            </div>`;
            return;
        }

        let denyMap = {};
        let tableMissing = false;
        try {
            const { data, error } = await sb.from('role_permissions').select('role, page_key');
            if (error) throw error;
            (data || []).forEach(r => { (denyMap[r.role] = denyMap[r.role] || new Set()).add(r.page_key); });
        } catch (e) { tableMissing = true; }

        apRenderMatrix(c, denyMap, tableMissing);
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function apRenderMatrix(c, denyMap, tableMissing) {
    c.innerHTML = `
    ${tableMissing ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:12px 16px;border-radius:10px;margin-bottom:16px;font-size:12px">
        ⚠️ جدول <code>role_permissions</code> غير موجود بعد. شغّل ملف <code>advanced_permissions_migration.sql</code> في Supabase أولاً.
    </div>` : ''}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div><h2 style="font-size:22px;font-weight:800">🔐 الصلاحيات المتقدمة</h2>
        <p style="font-size:13px;color:#64748B;margin-top:4px">حدّد الصفحات المسموح بها لكل دور — كل تغيير بيتحفظ فوراً</p></div>
    </div>
    <div style="background:#EFF6FF;border:1px solid #BFDBFE;color:#1E40AF;padding:10px 14px;border-radius:8px;font-size:12px;margin-bottom:16px">
        👑 <strong>مدير النظام</strong> له صلاحية الوصول لكل الصفحات دائماً ولا يظهر في الجدول ده.
        التقييد بيتطبّق على باقي الأدوار، وبيظهر أثره للمستخدم عند أول فتح للتطبيق بعد التغيير (مش لحظياً لو الجلسة فاتحة عنده بالفعل).
    </div>
    <div class="mod-table-wrap">
        <table class="mod-table"><thead><tr>
            <th style="text-align:right">الصفحة</th>
            ${AP_ROLES.map(([, l]) => `<th style="text-align:center">${l}</th>`).join('')}
        </tr></thead><tbody>
            ${AP_PAGE_GROUPS.map(g => `
                <tr style="background:#F8FAFC"><td colspan="${AP_ROLES.length + 1}" style="font-weight:800;font-size:12px;color:#475569;padding:8px 16px">${g.title}</td></tr>
                ${g.pages.map(([pk, label]) => `<tr>
                    <td>${label}</td>
                    ${AP_ROLES.map(([rv]) => {
                        const denied = denyMap[rv]?.has(pk);
                        return `<td style="text-align:center"><input type="checkbox" ${denied ? '' : 'checked'} onchange="apTogglePermission('${rv}','${pk}',this)" style="width:16px;height:16px;cursor:pointer"></td>`;
                    }).join('')}
                </tr>`).join('')}
            `).join('')}
        </tbody></table>
    </div>`;
}

window.apTogglePermission = async function (role, pageKey, checkbox) {
    checkbox.disabled = true;
    try {
        if (checkbox.checked) {
            // امنح الصلاحية: امسح أي صف منع موجود
            const { error } = await sb.from('role_permissions').delete().eq('role', role).eq('page_key', pageKey);
            if (error) throw error;
        } else {
            // امنع الصلاحية: أضف صف منع (upsert يتفادى تكرار لو حصل ضغط مزدوج بسرعة)
            const { error } = await sb.from('role_permissions').upsert({ role, page_key: pageKey }, { onConflict: 'role,page_key' });
            if (error) throw error;
        }
    } catch (err) {
        alert('❌ خطأ: ' + err.message + '\n\nتأكد من تشغيل ملف advanced_permissions_migration.sql في Supabase.');
        checkbox.checked = !checkbox.checked; // ارجاع الحالة لو فشل الحفظ
    } finally {
        checkbox.disabled = false;
    }
};

// ════════════════════════════════════════════════════════════
// 2) الإنفاذ الفعلي: منع فتح صفحة ممنوعة + إخفاؤها من القائمة الجانبية
//    (يتحمّل مرة واحدة فقط لكل جلسة، ويتخزّن مؤقتاً — تغييرات المصفوفة
//    بتظهر أثرها للمستخدم عند إعادة تحميل الصفحة، مش لحظياً)
// ════════════════════════════════════════════════════════════
let _apDeniedForCurrentRole = null;

async function apGetDeniedSet() {
    if (_apDeniedForCurrentRole) return _apDeniedForCurrentRole;
    const role = window._currentUserRole;
    if (!role || role === 'admin') { _apDeniedForCurrentRole = new Set(); return _apDeniedForCurrentRole; }
    try {
        const { data, error } = await sb.from('role_permissions').select('page_key').eq('role', role);
        if (error) throw error;
        _apDeniedForCurrentRole = new Set((data || []).map(r => r.page_key));
    } catch { _apDeniedForCurrentRole = new Set(); } // فشل آمن: لو الجدول لسه مش موجود، ما نمنعش حد من حاجة
    return _apDeniedForCurrentRole;
}

function apApplyNavVisibility(denied) {
    document.querySelectorAll('.nav-item[data-mod]').forEach(el => {
        const mod = el.getAttribute('data-mod');
        el.style.display = denied.has(mod) ? 'none' : '';
    });
}

// نفس فلسفة _origSetupAppForUsers في users-management.js — لف الدالة
// الأصلية الموجودة فعلاً في app.js (يجب تحميل هذا الملف بعد app.js).
const _origLoadModForPerms = window.loadMod;
window.loadMod = async function (el, modName) {
    const denied = await apGetDeniedSet();
    apApplyNavVisibility(denied);

    if (modName !== 'dashboard' && denied.has(modName)) {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        const c = document.getElementById('app-content');
        const titleEl = document.getElementById('topbarTitle');
        if (titleEl) titleEl.innerText = '🔒 غير مصرّح';
        if (c) {
            c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:40px 24px;border-radius:12px;text-align:center">
                <div style="font-size:40px;margin-bottom:10px">🔒</div>
                <div style="font-weight:800;margin-bottom:6px">لا تملك صلاحية الوصول لهذه الصفحة</div>
                <div style="font-size:13px;color:#64748B">تواصل مع مدير النظام لو محتاج صلاحية إضافية.</div>
            </div>`;
        }
        return;
    }
    return _origLoadModForPerms(el, modName);
};

Object.assign(window, { renderAdvancedPermissions, apTogglePermission });
