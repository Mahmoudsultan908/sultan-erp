// ════════════════════════════════════════════════════════════
// whatsapp.js — مركز رسائل واتساب (مجاني: روابط wa.me بتفتح واتساب برسالة جاهزة، من غير API ولا اشتراك)
// يصدّر: renderWhatsAppIntegration (بيحل محل صفحة "قريباً" في coming-soon.js)
//
// 1) تذكير مديونيات: عملاء عليهم رصيد (الكل / المتأخرين بس) → زرار لكل عميل بيفتح واتساب بالرسالة جاهزة
// 2) إرسال فاتورة: رقم الفاتورة → رسالة بإجماليها وتفاصيلها لواتساب العميل
// قوالب الرسائل بتتعدّل وبتتحفظ مركزياً في app_settings (key='wa_templates')، والمتغيرات: {name} {balance} {due} {invoice} {total}
// لو عايز إرسال تلقائي من غير ضغط (WhatsApp Business API) ده بيحتاج اشتراك مدفوع من Meta — مؤجل لحد ما تقرر.
// ════════════════════════════════════════════════════════════

const WA_DEFAULTS = {
    debt: 'السلام عليكم {name}،\nنفكّر حضرتك بمستحقات الحساب: {balance} ج.م{due}.\nبرجاء التكرم بالسداد. شكراً لتعاملك معنا 🌷',
    invoice: 'السلام عليكم {name}،\nفاتورة رقم {invoice} بإجمالي {total} ج.م.\nشكراً لتعاملك معنا 🌷',
};
let _waTpl = { ...WA_DEFAULTS }, _waRows = [], _waMode = 'overdue';

function waEsc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function waFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function waPhone(phone) {
    let d = String(phone || '').replace(/\D/g, ''); if (!d) return '';
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('0')) d = '20' + d.slice(1); else if (!d.startsWith('20')) d = '20' + d;
    return d;
}
function waFill(tpl, v) { return String(tpl).replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? '')); }
function waSentKey() { return 'wa_sent_' + new Date().toISOString().slice(0, 10); }
function waSentSet() { try { return new Set(JSON.parse(localStorage.getItem(waSentKey()) || '[]')); } catch { return new Set(); } }

async function renderWhatsAppIntegration(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري التحميل...</div>';
    try {
        try {
            const { data } = await sb.from('app_settings').select('value').eq('key', 'wa_templates').maybeSingle();
            const v = typeof data?.value === 'string' ? JSON.parse(data.value) : data?.value;
            _waTpl = { ...WA_DEFAULTS, ...(v && typeof v === 'object' ? v : {}) };
        } catch { _waTpl = { ...WA_DEFAULTS }; }
        const { data: cust, error } = await sb.from('customers').select('id,name,phone,balance,payment_due_date').eq('is_active', true).gt('balance', 0).order('balance', { ascending: false });
        if (error) throw error;
        _waRows = cust || [];
        waRender(c);
    } catch (err) {
        c.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:20px;border-radius:12px">خطأ: ${waEsc(err.message)}</div>`;
    }
}

function waDebtMsg(r) {
    const due = r.payment_due_date ? ` (الاستحقاق ${r.payment_due_date})` : '';
    return waFill(_waTpl.debt, { name: r.name, balance: waFmt(r.balance), due });
}

function waRender(c) {
    c = c || document.getElementById('app-content');
    const today = new Date().toISOString().slice(0, 10);
    const sent = waSentSet();
    const rows = _waRows.filter(r => _waMode === 'all' || (r.payment_due_date && r.payment_due_date < today));
    c.innerHTML = `
    <div style="margin-bottom:16px"><h2 style="font-size:22px;font-weight:800">💬 مركز رسائل واتساب</h2>
        <p style="font-size:13px;color:var(--inv-muted);margin-top:4px">بتفتح واتساب برسالة جاهزة لكل عميل، وإنت تضغط إرسال. مجاني ومن غير اشتراكات.</p></div>

    <div class="dash-card" style="padding:20px;margin-bottom:16px">
        <h3 style="margin:0 0 10px;font-size:15px">📝 قوالب الرسائل</h3>
        <label class="ob-label">تذكير مديونية — المتغيرات: {name} {balance} {due}</label>
        <textarea id="waTplDebt" class="ob-input" rows="4" style="width:100%">${waEsc(_waTpl.debt)}</textarea>
        <label class="ob-label" style="margin-top:8px">إرسال فاتورة — المتغيرات: {name} {invoice} {total}</label>
        <textarea id="waTplInv" class="ob-input" rows="3" style="width:100%">${waEsc(_waTpl.invoice)}</textarea>
        <button class="ob-save-btn" style="margin-top:10px" onclick="waSaveTemplates()">💾 حفظ القوالب</button>
    </div>

    <div class="dash-card" style="padding:20px;margin-bottom:16px">
        <h3 style="margin:0 0 10px;font-size:15px">🧾 إرسال فاتورة</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <input id="waInvNo" class="ob-input" style="margin:0;max-width:200px" placeholder="رقم الفاتورة مثال INV-0012" dir="ltr">
            <button class="mod-btn mod-btn-primary" onclick="waSendInvoice()">💬 جهّز الرسالة</button>
            <span id="waInvMsg" style="font-size:12px;color:var(--inv-muted)"></span>
        </div>
    </div>

    <div class="dash-card" style="padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px">
            <h3 style="margin:0;font-size:15px">⏰ تذكير مديونيات</h3>
            <select class="ob-input" style="margin:0;width:auto" onchange="_waMode=this.value;waRender()">
                <option value="overdue" ${_waMode === 'overdue' ? 'selected' : ''}>المتأخرين عن ميعاد السداد</option>
                <option value="all" ${_waMode === 'all' ? 'selected' : ''}>كل العملاء اللي عليهم رصيد</option></select>
        </div>
        <div class="mod-table-wrap"><table class="mod-table"><thead><tr><th>العميل</th><th>التليفون</th><th>الاستحقاق</th><th style="text-align:left">الرصيد</th><th></th></tr></thead><tbody>
        ${rows.length ? rows.map(r => {
            const p = waPhone(r.phone), done = sent.has(r.id);
            return `<tr><td><b>${waEsc(r.name)}</b></td><td dir="ltr" style="text-align:right">${waEsc(r.phone || '—')}</td>
                <td>${waEsc(r.payment_due_date || '—')}</td><td style="text-align:left;font-weight:700">${waFmt(r.balance)}</td>
                <td>${p ? `<a class="cc-edit" style="text-decoration:none;padding:6px 12px" target="_blank" rel="noopener" onclick="waMarkSent('${r.id}')"
                    href="https://wa.me/${p}?text=${encodeURIComponent(waDebtMsg(r))}">${done ? '✅ اتبعت' : '💬 إرسال'}</a>` : '<span style="color:var(--inv-muted);font-size:12px">مفيش رقم</span>'}</td></tr>`;
        }).join('') : '<tr><td colspan="5" class="empty-state"><span>✅</span>مفيش عملاء مطابقين</td></tr>'}
        </tbody></table></div>
        <p style="font-size:11.5px;color:var(--inv-muted-light);margin-top:8px">علامة "اتبعت" بتتحفظ على جهازك لليوم ده بس، عشان تتابع مين بعتّله.</p>
    </div>`;
}
window._waMode = _waMode;
window.waRender = waRender;

window.waMarkSent = function (id) {
    const s = waSentSet(); s.add(id);
    try { localStorage.setItem(waSentKey(), JSON.stringify([...s])); } catch { /* مش مهم */ }
    setTimeout(() => waRender(), 400);
};

window.waSaveTemplates = async function () {
    const debt = document.getElementById('waTplDebt').value.trim() || WA_DEFAULTS.debt;
    const invoice = document.getElementById('waTplInv').value.trim() || WA_DEFAULTS.invoice;
    try {
        const { error } = await sb.from('app_settings').upsert({ key: 'wa_templates', value: JSON.stringify({ debt, invoice }), updated_at: new Date().toISOString() }, { onConflict: 'key' });
        if (error) throw error;
        _waTpl = { debt, invoice };
        alert('✅ اتحفظت القوالب');
        waRender();
    } catch (err) { alert('❌ ' + err.message); }
};

window.waSendInvoice = async function () {
    const no = (document.getElementById('waInvNo').value || '').trim();
    const msgEl = document.getElementById('waInvMsg');
    if (!no) { msgEl.textContent = 'اكتب رقم الفاتورة'; return; }
    msgEl.textContent = '⏳...';
    try {
        const { data, error } = await sb.from('sales').select('invoice_no,total,customers(name,phone)').eq('invoice_no', no.toUpperCase()).maybeSingle();
        if (error) throw error;
        if (!data) { msgEl.textContent = 'الفاتورة مش موجودة'; return; }
        const p = waPhone(data.customers?.phone);
        if (!p) { msgEl.textContent = 'العميل ده ملوش رقم تليفون'; return; }
        msgEl.textContent = '';
        const text = waFill(_waTpl.invoice, { name: data.customers?.name || '', invoice: data.invoice_no, total: waFmt(data.total) });
        window.open('https://wa.me/' + p + '?text=' + encodeURIComponent(text), '_blank', 'noopener');
    } catch (err) { msgEl.textContent = '❌ ' + err.message; }
};

Object.assign(window, { renderWhatsAppIntegration });
