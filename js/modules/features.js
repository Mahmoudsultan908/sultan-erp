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
    { key: 'feature_notes', icon: '📝', title: 'إشعارات الدائن والمدين',
      desc: 'شاشة "إشعارات دائن/مدين" في القائمة المالية: تسوية سعر أو مبلغ على عميل أو مورد من غير حركة بضاعة (خصم بعد البيع، مصاريف شحن، فرق سعر). بتتسجل بقيد محاسبي وبتظهر في كشف حساب العميل/المورد، وبتتلغي بقيد عكسي. بتتطبع كمستند.' },
    { key: 'feature_invoice_qr', icon: '🔳', title: 'كود QR على إيصال البيع',
      desc: 'بيظهر كود QR أسفل إيصال البيع المطبوع فيه اسم الشركة ورقم الفاتورة والتاريخ والإجمالي، تمسحه بأي كاميرا. (ده مش كود الفاتورة الإلكترونية الضريبية — ده بيتفعّل لاحقاً مع التسجيل الضريبي.) محتاج إنترنت أول مرة بس عشان تتحمّل المكتبة.' },
    { key: 'feature_po_match', icon: '🔍', title: 'مطابقة أوامر الشراء',
      desc: 'في شاشة أوامر الشراء زرار "مطابقة" بيقارن اللي اتطلب باللي وصل فعلاً (من فواتير الشراء المربوطة بالأمر) وبسعر الفاتورة، ويعلّم الناقص والزيادة والسعر الأعلى من الأمر. (الاستلام الجزئي وربط الفاتورة بالأمر شغالين دايماً من غير الميزة دي.)' },
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
    </div>
    <div id="set-vat-card"></div>`;
    ftRenderVat(document.getElementById('set-vat-card'));
}

// تجهيز الضريبة (VAT / الفاتورة الإلكترونية): بيانات الشركة بس — مفيش أي حساب ضريبة على الفواتير لسه.
// لما تتسجّل ضريبياً، تفعيل الحساب على الفواتير والـQR والرفع لمصلحة الضرائب هيتبني فوق البيانات دي.
async function ftRenderVat(el) {
    if (!el) return;
    const keys = ['vat_company_tax_id', 'vat_default_rate', 'vat_registered_since'];
    const st = {};
    let withTax = null;
    try {
        const { data } = await sb.from('app_settings').select('key,value').in('key', keys);
        (data || []).forEach(r => { st[r.key] = String(r.value ?? '').replace(/^"|"$/g, ''); });
        const { count } = await sb.from('customers').select('id', { count: 'exact', head: true }).not('tax_id', 'is', null);
        withTax = count;
    } catch { /* مش مهم */ }
    el.innerHTML = `
    <div class="dash-card" style="padding:24px;margin-top:16px">
        <h3 style="margin:0 0 6px;font-size:15px">🧮 تجهيز الضريبة (غير مفعّلة)</h3>
        <p style="font-size:12px;color:var(--inv-muted-light);margin:0 0 12px;line-height:1.7">الشركة لسه مش مسجّلة ضريبياً، فمفيش أي ضريبة بتتحسب على الفواتير. سجّل هنا البيانات مسبقاً عشان لما تتسجّل يبقى كل حاجة جاهزة. الرقم الضريبي للعميل بيتسجّل من شاشة العميل${withTax != null ? ` (حالياً ${withTax} عميل ليهم رقم ضريبي)` : ''}.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
            <div><label class="ob-label">الرقم الضريبي للشركة</label><input id="ftVatTaxId" class="ob-input" style="margin:0;width:200px" dir="ltr" value="${ftEsc(st.vat_company_tax_id || '')}"></div>
            <div><label class="ob-label">نسبة الضريبة الافتراضية %</label><input id="ftVatRate" type="number" min="0" max="100" step="0.01" class="ob-input" style="margin:0;width:120px" value="${ftEsc(st.vat_default_rate || '14')}"></div>
            <div><label class="ob-label">تاريخ التسجيل (لما يحصل)</label><input id="ftVatSince" type="date" class="ob-input" style="margin:0" value="${ftEsc(st.vat_registered_since || '')}"></div>
            <button class="ob-save-btn" onclick="ftSaveVat()">💾 حفظ</button>
        </div>
    </div>`;
}

window.ftSaveVat = async function () {
    const rate = parseFloat(document.getElementById('ftVatRate').value);
    if (!(rate >= 0 && rate <= 100)) return alert('النسبة لازم بين 0 و100');
    const rows = [
        ['vat_company_tax_id', document.getElementById('ftVatTaxId').value.trim()],
        ['vat_default_rate', String(rate)],
        ['vat_registered_since', document.getElementById('ftVatSince').value],
    ].map(([key, v]) => ({ key, value: v, updated_at: new Date().toISOString() }));
    try {
        const { error } = await sb.from('app_settings').upsert(rows, { onConflict: 'key' });
        if (error) throw error;
        alert('✅ اتحفظت بيانات الضريبة');
    } catch (err) { alert('❌ ' + err.message); }
};

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
