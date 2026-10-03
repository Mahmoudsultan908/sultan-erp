// ════════════════════════════════════════════════════════════
// adjustment-notes.js — إشعارات الدائن والمدين (تسوية سعر/مبلغ من غير حركة بضاعة)
// يصدّر: renderAdjustmentNotes
//
// 4 أنواع:  للعميل: دائن (بيخفض رصيده) / مدين (بيزوده)   —   للمورد: دائن منه (بيخفض اللي علينا) / مدين له (بيزوده)
// الأثر على الرصيد والقيد المحاسبي كله في القاعدة (fn_adjustment_note_apply) — هنا بس بنستدعي fn_create/fn_cancel_adjustment_note.
// الإشعار مبيتعدّلش؛ لو غلط بيتلغي (بيتعمل قيد عكسي) وبيتعمل جديد. الميزة مقفولة لحد ما الأدمن يفعّلها (feature_notes).
// ════════════════════════════════════════════════════════════

let _adnRows = [], _adnFilter = 'confirmed', _adnParties = { customers: [], suppliers: [] };
const ADN_KINDS = {
    customer_credit: { lbl: 'إشعار دائن للعميل', side: 'customers', hint: 'بيخفض رصيد العميل (مثال: تصحيح سعر لصالحه، خصم بعد البيع).' },
    customer_debit: { lbl: 'إشعار مدين للعميل', side: 'customers', hint: 'بيزوّد رصيد العميل (مثال: مصاريف شحن، فرق سعر عليه).' },
    supplier_credit: { lbl: 'إشعار دائن من المورد', side: 'suppliers', hint: 'بيخفض اللي علينا للمورد (مثال: خصم كمية، تعويض عن تالف).' },
    supplier_debit: { lbl: 'إشعار مدين للمورد', side: 'suppliers', hint: 'بيزوّد اللي علينا للمورد (مثال: فرق سعر اتفق عليه بعد الفاتورة).' },
};

function adnEsc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function adnFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function renderAdjustmentNotes(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل الإشعارات...</div>';
    try {
        if (typeof ftOn === 'function' && !(await ftOn('feature_notes'))) {
            c.innerHTML = `<div class="dash-card" style="padding:28px;text-align:center"><div style="font-size:34px">📝</div>
                <h3 style="margin:10px 0 6px">ميزة إشعارات الدائن والمدين مقفولة</h3>
                <p style="font-size:13px;color:var(--inv-muted)">الأدمن يقدر يفعّلها من الإعدادات ← المميزات الإضافية.</p></div>`;
            return;
        }
        const [nr, cu, su] = await Promise.all([
            sb.from('adjustment_notes').select('*, customers(name), suppliers(name)').order('created_at', { ascending: false }).limit(500),
            sb.from('customers').select('id,name').eq('is_active', true).order('name'),
            sb.from('suppliers').select('id,name').eq('is_active', true).order('name'),
        ]);
        if (nr.error) throw nr.error;
        _adnRows = nr.data || [];
        _adnParties = { customers: cu.data || [], suppliers: su.data || [] };
        adnRender(c);
    } catch (err) {
        c.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:20px;border-radius:12px">خطأ: ${adnEsc(err.message)}</div>`;
    }
}

function adnRender(c) {
    c = c || document.getElementById('app-content');
    const rows = _adnRows.filter(r => _adnFilter === 'all' || r.status === _adnFilter);
    const opt = (v, l) => `<option value="${v}" ${_adnFilter === v ? 'selected' : ''}>${l}</option>`;
    c.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px">
        <h2 style="font-size:22px;font-weight:800">📝 إشعارات الدائن والمدين</h2>
        <button class="mod-btn mod-btn-primary" onclick="adnOpenAdd()">+ إشعار جديد</button>
    </div>
    <div style="display:flex;gap:10px;margin-bottom:12px">
        <select class="ob-input" style="margin:0;width:auto" onchange="adnSetFilter(this.value)">${opt('confirmed', 'السارية')}${opt('cancelled', 'الملغية')}${opt('all', 'الكل')}</select>
    </div>
    <div class="mod-table-wrap"><table class="mod-table"><thead><tr>
        <th>الرقم</th><th>التاريخ</th><th>النوع</th><th>الطرف</th><th>السبب</th><th>المرجع</th><th style="text-align:left">المبلغ</th><th></th>
    </tr></thead><tbody>
    ${rows.length ? rows.map(r => `<tr style="${r.status === 'cancelled' ? 'opacity:.55' : ''}">
        <td dir="ltr" style="text-align:right"><b>${adnEsc(r.note_no)}</b></td>
        <td>${adnEsc(String(r.created_at).slice(0, 10))}</td>
        <td>${adnEsc(ADN_KINDS[r.kind]?.lbl || r.kind)}${r.status === 'cancelled' ? ' <span style="color:var(--inv-red);font-size:11px">ملغي</span>' : ''}</td>
        <td>${adnEsc(r.customers?.name || r.suppliers?.name || '—')}</td>
        <td>${adnEsc(r.reason)}</td>
        <td>${adnEsc(r.ref_doc || '—')}</td>
        <td style="text-align:left;font-weight:700">${adnFmt(r.amount)}</td>
        <td style="white-space:nowrap"><button class="cc-edit" title="طباعة" onclick="adnPrint('${r.id}')">🖨️</button>${r.status === 'confirmed' ? `<button class="cc-edit" title="إلغاء" onclick="adnCancel('${r.id}')">🗑️</button>` : ''}</td>
    </tr>`).join('') : '<tr><td colspan="8" class="empty-state"><span>📝</span>مفيش إشعارات</td></tr>'}
    </tbody></table></div>`;
}
window.adnSetFilter = function (v) { _adnFilter = v; adnRender(); };

window.adnCloseModal = function () { const m = document.getElementById('adnModal'); if (m) m.remove(); };
function adnPartyOptions(kind) {
    const list = _adnParties[ADN_KINDS[kind].side];
    return list.map(p => `<option value="${p.id}">${adnEsc(p.name)}</option>`).join('');
}
window.adnKindChanged = function () {
    const k = document.getElementById('adnKind').value;
    document.getElementById('adnParty').innerHTML = adnPartyOptions(k);
    document.getElementById('adnPartyLbl').textContent = ADN_KINDS[k].side === 'customers' ? 'العميل *' : 'المورد *';
    document.getElementById('adnHint').textContent = ADN_KINDS[k].hint;
};
window.adnOpenAdd = function () {
    adnCloseModal();
    const m = document.createElement('div');
    m.className = 'mod-modal-bg active'; m.id = 'adnModal';
    m.innerHTML = `<div class="mod-modal"><div class="mod-modal-header"><h3>+ إشعار جديد</h3><button class="mod-modal-close" onclick="adnCloseModal()">&times;</button></div>
        <div class="mod-modal-body">
        <div class="mod-form-group"><label>النوع</label><select id="adnKind" class="mod-form-input" onchange="adnKindChanged()">
            ${Object.entries(ADN_KINDS).map(([k, v]) => `<option value="${k}">${v.lbl}</option>`).join('')}</select>
            <div id="adnHint" style="font-size:12px;color:var(--inv-muted);margin-top:4px">${ADN_KINDS.customer_credit.hint}</div></div>
        <div class="mod-form-group"><label id="adnPartyLbl">العميل *</label><select id="adnParty" class="mod-form-input">${adnPartyOptions('customer_credit')}</select></div>
        <div class="mod-form-group"><label>المبلغ *</label><input id="adnAmt" type="number" min="0" step="0.01" class="mod-form-input"></div>
        <div class="mod-form-group"><label>السبب *</label><input id="adnReason" class="mod-form-input"></div>
        <div class="mod-form-group"><label>رقم الفاتورة المرتبطة (اختياري)</label><input id="adnRef" class="mod-form-input" dir="ltr"></div>
        </div>
        <div class="mod-modal-footer"><button class="mod-btn" style="background:#F1F5F9;color:var(--inv-text-soft)" onclick="adnCloseModal()">إلغاء</button>
        <button class="mod-btn mod-btn-primary" onclick="adnSave()">💾 حفظ</button></div></div>`;
    document.body.appendChild(m);
};
window.adnSave = async function () {
    const g = id => document.getElementById(id)?.value;
    const kind = g('adnKind'), amt = parseFloat(g('adnAmt')) || 0;
    if (!g('adnParty')) { alert('اختار الطرف'); return; }
    if (amt <= 0) { alert('اكتب مبلغ أكبر من صفر'); return; }
    if (!(g('adnReason') || '').trim()) { alert('اكتب سبب الإشعار'); return; }
    const p = _adnParties[ADN_KINDS[kind].side].find(x => x.id === g('adnParty'));
    if (!confirm(`تسجيل ${ADN_KINDS[kind].lbl} بمبلغ ${adnFmt(amt)} على ${p?.name || ''}؟\n(مبيتعدّلش بعد الحفظ — لو غلط بتلغيه وتعمل جديد)`)) return;
    const btn = document.querySelector('#adnModal .mod-btn-primary'); btn.disabled = true;
    try {
        const { error } = await sb.rpc('fn_create_adjustment_note', {
            p_kind: kind, p_party_id: g('adnParty'), p_amount: amt, p_reason: g('adnReason').trim(), p_ref_doc: (g('adnRef') || '').trim() || null,
        });
        if (error) throw error;
        adnCloseModal(); renderAdjustmentNotes(document.getElementById('app-content'));
    } catch (err) { alert('❌ ' + err.message); btn.disabled = false; }
};
window.adnCancel = async function (id) {
    if (!confirm('إلغاء الإشعار؟ هيتعمل قيد عكسي ويرجع رصيد الطرف زي ما كان.')) return;
    try {
        const { error } = await sb.rpc('fn_cancel_adjustment_note', { p_id: id });
        if (error) throw error;
        renderAdjustmentNotes(document.getElementById('app-content'));
    } catch (err) { alert('❌ ' + err.message); }
};

window.adnPrint = function (id) {
    const r = _adnRows.find(x => x.id === id); if (!r) return;
    const brand = (typeof BRAND !== 'undefined' && BRAND.ar) || '';
    const w = window.open('', '_blank'); if (!w) { alert('اسمح بالنوافذ المنبثقة للطباعة'); return; }
    w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${adnEsc(r.note_no)}</title>
    <style>body{font-family:Cairo,Tahoma,sans-serif;padding:32px;max-width:640px;margin:auto}h1{font-size:20px;margin:0}table{width:100%;border-collapse:collapse;margin-top:18px}
    td{padding:9px 6px;border-bottom:1px solid #ddd;font-size:14px}td:first-child{color:#666;width:32%}.big{font-size:22px;font-weight:800}</style></head><body>
    <h1>${adnEsc(brand)}</h1><div style="margin-top:6px">${adnEsc(ADN_KINDS[r.kind]?.lbl || r.kind)}${r.status === 'cancelled' ? ' — <b>ملغي</b>' : ''}</div>
    <table><tr><td>رقم الإشعار</td><td dir="ltr" style="text-align:right"><b>${adnEsc(r.note_no)}</b></td></tr>
    <tr><td>التاريخ</td><td>${adnEsc(String(r.created_at).slice(0, 10))}</td></tr>
    <tr><td>الطرف</td><td>${adnEsc(r.customers?.name || r.suppliers?.name || '—')}</td></tr>
    <tr><td>السبب</td><td>${adnEsc(r.reason)}</td></tr>
    ${r.ref_doc ? `<tr><td>الفاتورة المرتبطة</td><td>${adnEsc(r.ref_doc)}</td></tr>` : ''}
    <tr><td>المبلغ</td><td class="big">${adnFmt(r.amount)}</td></tr></table>
    <script>window.onload=function(){window.print()}<\/script></body></html>`);
    w.document.close();
};

Object.assign(window, { renderAdjustmentNotes });
