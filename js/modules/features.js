// ════════════════════════════════════════════════════════════
// features.js — كارت "المميزات الإضافية" في الإعدادات: مفاتيح تشغيل/إيقاف للمميزات الجديدة
// يصدّر: ftRenderCard
//
// كل ميزة وراها مفتاح في app_settings (القيمة 'on' / 'off') وافتراضيها مقفول، فنشر الكود
// ما بيغيّر حاجة في شغلك لحد ما الأدمن يفعّل الميزة بنفسه. لإضافة ميزة جديدة: سطر في FT_LIST.
// المفتاح بيتحفظ فوراً بمجرد الضغط (من غير زرار "حفظ").
// ════════════════════════════════════════════════════════════

const FT_LIST = [
    { key: 'feature_expiry', icon: '⏳', title: 'الصلاحية والدفعات',
      desc: 'في فاتورة الشراء بتظهر خانتين: رقم الدفعة وتاريخ الصلاحية. عند البيع بتتخصم الدفعات من الأقدم صلاحية الأول، وفي تقارير المخازن تبويب "الصلاحية" بيعرض المنتهي والقريب من الانتهاء.' },
    { key: 'feature_cheques', icon: '🧾', title: 'الشيكات والبنوك',
      desc: 'شاشة "الشيكات" في القائمة المالية: شيكات واردة من العملاء وصادرة للموردين بتاريخ استحقاق. الشيك مالوش أثر على الحسابات وهو تحت التحصيل، ولما تضغط "تحصيل" بيتسجل كتحصيل/دفعة عادية في الخزنة أو البنك اللي تختاره. وفي إضافة خزنة بتقدر تحدد إنها حساب بنكي.' },
    { key: 'feature_below_cost_warn', icon: '⚠️', title: 'تحذير البيع بأقل من التكلفة',
      desc: 'في شاشة المبيعات، قبل الحفظ بيطلع تحذير بأسماء الأصناف اللي صافي سعرها (بعد الخصم) أقل من سعر الشراء، وتقدر تكمل أو ترجع تعدّل.' },
    { key: 'feature_split_payment', icon: '💵', title: 'دفع مقدّم على الفاتورة الآجلة',
      desc: 'في فاتورة البيع الآجل بيظهر حقل "دفع مقدّم" وخزنة الاستلام: الفاتورة بتتسجّل آجل كالعادة، والمبلغ المدفوع بيتسجّل تلقائياً كتحصيل من العميل فيتخصم من رصيده.' },
    { key: 'feature_budgets', icon: '🎯', title: 'الميزانيات',
      desc: 'شاشة "الميزانيات" في القائمة المالية: هدف مبيعات وميزانية لكل بند مصروفات لكل شهر، ومقارنتها بالفعلي (بتحترم فلتر الفرع)، مع طباعة / حفظ PDF.' },
];

// هل الميزة مفعّلة؟ (كاش 30 ثانية عشان الشاشات ما تسألش القاعدة كل مرة)
const _ftCache = {};
async function ftOn(key) {
    const c = _ftCache[key];
    if (c && Date.now() - c.t < 30000) return c.v;
    let v = false;
    try {
        const { data } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle();
        v = ftIsOn(data?.value);
    } catch { v = false; }
    _ftCache[key] = { t: Date.now(), v };
    return v;
}

function ftEsc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function ftIsOn(v) { return ['on', 'true', '1'].includes(String(v ?? '').replace(/["\s]/g, '').toLowerCase()); }

async function ftRenderCard(el) {
    if (!el) return;
    const isAdmin = window._currentUserRole === 'admin';
    if (!isAdmin) { el.innerHTML = ''; return; }
    let rows = [];
    try {
        const { data } = await sb.from('app_settings').select('key,value').in('key', FT_LIST.map(f => f.key));
        rows = data || [];
    } catch { /* مش مهم */ }
    const state = k => ftIsOn(rows.find(r => r.key === k)?.value);
    el.innerHTML = `
    <div class="dash-card" style="padding:24px;margin-top:16px">
        <h3 style="margin:0 0 6px;font-size:15px">🧩 المميزات الإضافية</h3>
        <p style="font-size:12px;color:var(--inv-muted-light);margin:0 0 12px;line-height:1.7">مميزات جديدة مقفولة لحد ما تفعّلها. التفعيل والإيقاف فوري، ومش بيمسح أي بيانات.</p>
        ${FT_LIST.map(f => `
        <label style="display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--inv-divider);cursor:pointer">
            <input type="checkbox" ${state(f.key) ? 'checked' : ''} style="width:auto;margin-top:4px" onchange="ftToggle('${f.key}', this)">
            <span><b>${f.icon} ${ftEsc(f.title)}</b><br><span style="font-size:12px;color:var(--inv-muted-light);line-height:1.7">${ftEsc(f.desc)}</span></span>
        </label>`).join('')}
    </div>`;
}

window.ftToggle = async function (key, box) {
    const on = box.checked;
    box.disabled = true;
    try {
        const { error } = await sb.from('app_settings').upsert({ key, value: on ? 'on' : 'off', updated_at: new Date().toISOString() }, { onConflict: 'key' });
        if (error) throw error;
        delete _ftCache[key];
    } catch (err) {
        box.checked = !on;
        alert('❌ تعذّر الحفظ: ' + err.message);
    }
    box.disabled = false;
};

Object.assign(window, { ftRenderCard, ftOn });
