// ════════════════════════════════════════════════════════════
// brand.js — هوية الشركة في الواجهة (الاسم اللي بيظهر للمستخدمين والعملاء)
// يصدّر: BRAND، brandLoad، brandApply، brandRenderCard
//
// الاسم بيجي من إعدادات القاعدة (brand_*)، وبيتحفظ نسخة منه في المتصفح (localStorage) عشان يظهر من أول لحظة حتى في شاشة الدخول.
// القيم الافتراضية تحت هي بتاعة سلطان؛ نسخ العملاء الجداد بتتغيّر قيمها الافتراضية بسكربت 2-make-client-apps.sh.
// لازم يتحمّل قبل باقي الموديولات (بيتقرا وقت التحميل في بعض القوالب).
// ════════════════════════════════════════════════════════════

const BRAND_DEFAULTS = {
    erp: 'Sultan ERP',                     // اسم البرنامج (شاشة الدخول، الشريط الجانبي، رأس الفواتير)
    ar: 'سلطان للمواد الغذائية',            // الاسم الكامل بالعربي (رسائل العملاء وقوالب واتساب)
    short: 'سلطان',                        // الاسم المختصر (مندوب سلطان، رسائل التحصيل)
    customerApp: 'سلطانو',                 // اسم تطبيق طلبات العملاء
    footer: 'Sultan Food',                 // سطر الحقوق أسفل القائمة الجانبية
};
const BRAND_SETTING_KEYS = { erp: 'brand_erp_name', ar: 'brand_name_ar', short: 'brand_short_ar', customerApp: 'brand_customer_app', footer: 'brand_footer' };
const BRAND_CACHE_KEY = 'brand_cache_v1';

const BRAND = (() => {
    let cached = {};
    try { cached = JSON.parse(localStorage.getItem(BRAND_CACHE_KEY) || '{}') || {}; } catch { cached = {}; }
    const b = { ...BRAND_DEFAULTS };
    for (const k of Object.keys(BRAND_DEFAULTS)) if (typeof cached[k] === 'string' && cached[k].trim()) b[k] = cached[k];
    return b;
})();

function brandClean(v) {   // القيم بتتخزّن كنص JSON ساعات (بعلامات تنصيص) — نشيلها
    return String(v ?? '').replace(/^"+|"+$/g, '').trim();
}

// تحديث أي عنصر عليه data-brand="<مفتاح>" بالقيمة الحالية
function brandApply() {
    try {
        document.querySelectorAll('[data-brand]').forEach(el => { const v = BRAND[el.dataset.brand]; if (v) el.textContent = v; });
        document.querySelectorAll('[data-brand-prefix]').forEach(el => {   // مثال: "مندوب " + الاسم المختصر
            const v = BRAND[el.dataset.brand2 || 'short']; if (v) el.textContent = el.dataset.brandPrefix + v;
        });
    } catch { /* مش مهم */ }
}

async function brandLoad() {
    try {
        const { data } = await sb.from('app_settings').select('key,value').in('key', Object.values(BRAND_SETTING_KEYS));
        const byKey = {}; (data || []).forEach(r => { byKey[r.key] = brandClean(r.value); });
        let changed = false;
        for (const [k, sk] of Object.entries(BRAND_SETTING_KEYS)) {
            if (byKey[sk] && byKey[sk] !== BRAND[k]) { BRAND[k] = byKey[sk]; changed = true; }
        }
        try { localStorage.setItem(BRAND_CACHE_KEY, JSON.stringify(BRAND)); } catch { /* مش مهم */ }
        brandApply();
        return changed;
    } catch { return false; }
}

// كارت "هوية الشركة" في الإعدادات (للأدمن)
function brandRenderCard(el) {
    if (!el) return;
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const row = (k, label, hint) => `<div style="min-width:220px;flex:1"><label class="ob-label">${label}</label>
        <input id="brand-${k}" class="ob-input" style="margin:0" value="${esc(BRAND[k])}"><div style="font-size:11px;color:var(--inv-muted-light);margin-top:3px">${hint}</div></div>`;
    el.innerHTML = `
    <div class="dash-card" style="padding:24px;margin-top:16px">
        <h3 style="margin:0 0 6px;font-size:15px">🎨 هوية الشركة</h3>
        <p style="font-size:12px;color:var(--inv-muted-light);margin:0 0 12px;line-height:1.7">الأسماء اللي بتظهر في البرنامج ورسائل العملاء وقوالب واتساب. التغيير بيظهر بعد تحديث الصفحة.</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
            ${row('erp', 'اسم البرنامج', 'يظهر في شاشة الدخول والقائمة وطباعة الفواتير')}
            ${row('ar', 'اسم الشركة بالعربي (كامل)', 'يظهر في رسائل العملاء وقوالب واتساب')}
            ${row('short', 'الاسم المختصر', 'مثال: مندوب (الاسم) — رسائل التحصيل')}
            ${row('customerApp', 'اسم تطبيق العملاء', 'يظهر في رسالة الرقم السري للعميل')}
            ${row('footer', 'سطر الحقوق', 'أسفل القائمة الجانبية')}
        </div>
        <button class="ob-save-btn" style="margin-top:12px" onclick="brandSave()">💾 حفظ الهوية</button>
    </div>`;
}

window.brandSave = async function () {
    const rows = Object.entries(BRAND_SETTING_KEYS).map(([k, sk]) => ({ key: sk, value: (document.getElementById('brand-' + k)?.value || '').trim() || BRAND_DEFAULTS[k], updated_at: new Date().toISOString() }));
    try {
        const { error } = await sb.from('app_settings').upsert(rows, { onConflict: 'key' });
        if (error) throw error;
        await brandLoad();
        alert('✅ اتحفظت هوية الشركة. حدّث الصفحة (Ctrl+Shift+R) عشان تظهر في كل مكان.');
    } catch (err) { alert('❌ ' + err.message); }
};

Object.assign(window, { BRAND, brandLoad, brandApply, brandRenderCard });
