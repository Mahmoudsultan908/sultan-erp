// ════════════════════════════════════════════════════════════
// cheques.js — الشيكات (واردة من العملاء / صادرة للموردين)
// يصدّر: renderCheques
//
// الشيك تحت التحصيل مالوش أي أثر على الحسابات. "تحصيل" بينشئ تحصيل/دفعة عادية في الخزنة أو البنك المختار
// (نفس المسار المحاسبي الموجود)، و"ارتد" بيلغي الحركة دي لو كانت اتعملت. كل ده في دوال القاعدة fn_cheque_*.
// الميزة مقفولة لحد ما الأدمن يفعّلها من الإعدادات (feature_cheques).
// ════════════════════════════════════════════════════════════

let _chqRows = [], _chqFilter = { dir: 'all', status: 'pending' }, _chqParties = { customers: [], suppliers: [] }, _chqTreasuries = [];

function chqEsc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function chqFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function chqToday() { return new Date().toISOString().slice(0, 10); }

async function renderCheques(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل الشيكات...</div>';
    try {
        if (typeof ftOn === 'function' && !(await ftOn('feature_cheques'))) {
            c.innerHTML = `<div class="dash-card" style="padding:28px;text-align:center"><div style="font-size:34px">🧾</div>
                <h3 style="margin:10px 0 6px">ميزة الشيكات مقفولة</h3>
                <p style="font-size:13px;color:var(--inv-muted)">الأدمن يقدر يفعّلها من الإعدادات ← المميزات الإضافية.</p></div>`;
            return;
        }
        const [ch, cu, su, tr] = await Promise.all([
            sb.from('cheques').select('*, customers(name), suppliers(name), treasuries(name)').order('due_date'),
            sb.from('customers').select('id,name').eq('is_active', true).order('name'),
            sb.from('suppliers').select('id,name').eq('is_active', true).order('name'),
            sb.from('treasuries').select('id,name,kind,is_active').eq('is_active', true).order('name'),
        ]);
        if (ch.error) throw ch.error;
        _chqRows = ch.data || [];
        _chqParties = { customers: cu.data || [], suppliers: su.data || [] };
        _chqTreasuries = tr.data || [];
        chqRender(c);
    } catch (err) {
        c.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:20px;border-radius:12px">خطأ: ${chqEsc(err.message)}</div>`;
    }
}

function chqRender(c) {
    c = c || document.getElementById('app-content');
    const today = chqToday();
    const pend = _chqRows.filter(r => r.status === 'pending');
    const sum = f => pend.filter(f).reduce((s, r) => s + Number(r.amount), 0);
    const overdue = pend.filter(r => r.due_date < today);
    const week = pend.filter(r => r.due_date >= today && r.due_date <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10));
    const rows = _chqRows.filter(r => (_chqFilter.dir === 'all' || r.direction === _chqFilter.dir) && (_chqFilter.status === 'all' || r.status === _chqFilter.status));
    const stLbl = { pending: 'تحت التحصيل', cleared: 'اتحصّل', bounced: 'مرتد', cancelled: 'ملغي' };
    const stClr = { pending: '#B45309', cleared: 'var(--inv-green)', bounced: 'var(--inv-red)', cancelled: 'var(--inv-muted)' };
    const opt = (v, l, cur) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`;
    c.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px">
        <h2 style="font-size:22px;font-weight:800">🧾 الشيكات</h2>
        <button class="mod-btn mod-btn-primary" onclick="chqOpenAdd()">+ شيك جديد</button>
    </div>
    <div class="mod-grid" style="margin-bottom:16px">
        <div class="mod-card"><div class="mod-card-val" style="color:var(--inv-green)">${chqFmt(sum(r => r.direction === 'received'))}</div><div class="mod-card-lbl">واردة تحت التحصيل</div></div>
        <div class="mod-card"><div class="mod-card-val" style="color:var(--inv-red)">${chqFmt(sum(r => r.direction === 'issued'))}</div><div class="mod-card-lbl">صادرة تحت التحصيل</div></div>
        <div class="mod-card"><div class="mod-card-val">${week.length}</div><div class="mod-card-lbl">مستحقة خلال 7 أيام</div></div>
        <div class="mod-card"><div class="mod-card-val" style="color:${overdue.length ? 'var(--inv-red)' : 'inherit'}">${overdue.length}</div><div class="mod-card-lbl">متأخرة عن ميعادها</div></div>
    </div>
    <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">
        <select class="ob-input" style="margin:0;width:auto" onchange="_chqFilter.dir=this.value;chqRender()">
            ${opt('all', 'الكل', _chqFilter.dir)}${opt('received', 'واردة (من عملاء)', _chqFilter.dir)}${opt('issued', 'صادرة (لموردين)', _chqFilter.dir)}</select>
        <select class="ob-input" style="margin:0;width:auto" onchange="_chqFilter.status=this.value;chqRender()">
            ${opt('pending', 'تحت التحصيل', _chqFilter.status)}${opt('cleared', 'اتحصّلت', _chqFilter.status)}${opt('bounced', 'مرتدة', _chqFilter.status)}${opt('cancelled', 'ملغية', _chqFilter.status)}${opt('all', 'كل الحالات', _chqFilter.status)}</select>
    </div>
    <div class="mod-table-wrap"><table class="mod-table"><thead><tr>
        <th>النوع</th><th>رقم الشيك</th><th>الطرف</th><th>البنك</th><th style="text-align:center">الاستحقاق</th><th style="text-align:left">المبلغ</th><th>الحالة</th><th></th>
    </tr></thead><tbody>
    ${rows.length ? rows.map(r => {
        const late = r.status === 'pending' && r.due_date < today;
        return `<tr style="${late ? 'background:#FEF2F2' : ''}">
            <td>${r.direction === 'received' ? '📥 وارد' : '📤 صادر'}</td>
            <td dir="ltr" style="text-align:right"><b>${chqEsc(r.cheque_no)}</b></td>
            <td>${chqEsc(r.customers?.name || r.suppliers?.name || '—')}</td>
            <td>${chqEsc(r.bank_name || '—')}</td>
            <td style="text-align:center">${chqEsc(r.due_date)}${late ? ' <span style="color:var(--inv-red);font-size:11px">متأخر</span>' : ''}</td>
            <td style="text-align:left;font-weight:700">${chqFmt(r.amount)}</td>
            <td style="color:${stClr[r.status]};font-weight:700">${stLbl[r.status]}${r.status === 'cleared' && r.treasuries?.name ? `<br><span style="font-size:11px;font-weight:400">${chqEsc(r.treasuries.name)}</span>` : ''}${r.bounce_reason ? `<br><span style="font-size:11px;font-weight:400">${chqEsc(r.bounce_reason)}</span>` : ''}</td>
            <td style="white-space:nowrap">
                ${r.status === 'pending' ? `<button class="cc-edit" title="تحصيل" onclick="chqOpenClear('${r.id}')">✅</button>
                    <button class="cc-edit" title="ارتد" onclick="chqBounce('${r.id}')">↩️</button>
                    <button class="cc-edit" title="إلغاء" onclick="chqCancel('${r.id}')">🗑️</button>` : ''}
                ${r.status === 'cleared' ? `<button class="cc-edit" title="ارتد بعد التحصيل" onclick="chqBounce('${r.id}')">↩️</button>` : ''}
            </td></tr>`;
    }).join('') : '<tr><td colspan="8" class="empty-state"><span>🧾</span>مفيش شيكات بالفلتر ده</td></tr>'}
    </tbody></table></div>`;
}
window._chqFilter = _chqFilter;
window.chqRender = chqRender;

function chqModal(id, title, body, saveFn) {
    chqCloseModal();
    const m = document.createElement('div');
    m.className = 'mod-modal-bg active'; m.id = 'chqModal';
    m.innerHTML = `<div class="mod-modal"><div class="mod-modal-header"><h3>${title}</h3><button class="mod-modal-close" onclick="chqCloseModal()">&times;</button></div>
        <div class="mod-modal-body">${body}</div>
        <div class="mod-modal-footer"><button class="mod-btn" style="background:#F1F5F9;color:var(--inv-text-soft)" onclick="chqCloseModal()">إلغاء</button>
        <button class="mod-btn mod-btn-primary" onclick="${saveFn}">💾 حفظ</button></div></div>`;
    document.body.appendChild(m);
}
window.chqCloseModal = function () { const m = document.getElementById('chqModal'); if (m) m.remove(); };

function chqPartyOptions(dir) {
    const list = dir === 'received' ? _chqParties.customers : _chqParties.suppliers;
    return list.map(p => `<option value="${p.id}">${chqEsc(p.name)}</option>`).join('');
}
window.chqDirChanged = function () {
    const d = document.getElementById('chqDir').value;
    document.getElementById('chqParty').innerHTML = chqPartyOptions(d);
    document.getElementById('chqPartyLbl').textContent = d === 'received' ? 'العميل *' : 'المورد *';
};

window.chqOpenAdd = function () {
    chqModal('add', '+ شيك جديد', `
        <div class="mod-form-group"><label>النوع</label><select id="chqDir" class="mod-form-input" onchange="chqDirChanged()">
            <option value="received">📥 وارد من عميل</option><option value="issued">📤 صادر لمورد</option></select></div>
        <div class="mod-form-group"><label id="chqPartyLbl">العميل *</label><select id="chqParty" class="mod-form-input">${chqPartyOptions('received')}</select></div>
        <div class="mod-form-group"><label>رقم الشيك *</label><input id="chqNo" class="mod-form-input" dir="ltr"></div>
        <div class="mod-form-group"><label>البنك</label><input id="chqBank" class="mod-form-input"></div>
        <div class="mod-form-group"><label>المبلغ *</label><input id="chqAmt" type="number" min="0" step="0.01" class="mod-form-input"></div>
        <div class="mod-form-group"><label>تاريخ الاستحقاق *</label><input id="chqDue" type="date" class="mod-form-input" value="${chqToday()}"></div>
        <div class="mod-form-group"><label>ملاحظات</label><input id="chqNotes" class="mod-form-input"></div>`, 'chqSaveNew()');
};

window.chqSaveNew = async function () {
    const g = id => document.getElementById(id)?.value;
    const btn = document.querySelector('#chqModal .mod-btn-primary'); btn.disabled = true;
    try {
        const { error } = await sb.rpc('fn_cheque_create', {
            p_direction: g('chqDir'), p_cheque_no: g('chqNo'), p_bank_name: g('chqBank') || null, p_amount: parseFloat(g('chqAmt')) || 0,
            p_due_date: g('chqDue') || null, p_party_id: g('chqParty') || null, p_notes: g('chqNotes') || null,
        });
        if (error) throw error;
        chqCloseModal(); renderCheques(document.getElementById('app-content'));
    } catch (err) { alert('❌ ' + err.message); btn.disabled = false; }
};

window.chqOpenClear = function (id) {
    const r = _chqRows.find(x => x.id === id); if (!r) return;
    const trs = [..._chqTreasuries].sort((a, b) => (b.kind === 'bank') - (a.kind === 'bank'));
    chqModal('clear', '✅ تحصيل الشيك', `
        <p style="font-size:13px;line-height:1.8">شيك ${r.direction === 'received' ? 'وارد من' : 'صادر إلى'} <b>${chqEsc(r.customers?.name || r.suppliers?.name)}</b> بمبلغ <b>${chqFmt(r.amount)}</b>.<br>
        هيتسجل ${r.direction === 'received' ? 'تحصيل' : 'دفعة'} عادي ويتأثر رصيد الطرف والخزنة.</p>
        <div class="mod-form-group"><label>${r.direction === 'received' ? 'اتحصّل في' : 'اتصرف من'} *</label><select id="chqTr" class="mod-form-input">
            ${trs.map(t => `<option value="${t.id}">${t.kind === 'bank' ? '🏦 ' : '💵 '}${chqEsc(t.name)}</option>`).join('')}</select></div>`, `chqDoClear('${id}')`);
};
window.chqDoClear = async function (id) {
    const btn = document.querySelector('#chqModal .mod-btn-primary'); btn.disabled = true;
    try {
        const { error } = await sb.rpc('fn_cheque_clear', { p_id: id, p_treasury_id: document.getElementById('chqTr').value });
        if (error) throw error;
        chqCloseModal(); renderCheques(document.getElementById('app-content'));
    } catch (err) { alert('❌ ' + err.message); btn.disabled = false; }
};

window.chqBounce = async function (id) {
    const r = _chqRows.find(x => x.id === id); if (!r) return;
    const reason = prompt(r.status === 'cleared' ? 'الشيك اتحصّل قبل كده — الارتداد هيلغي التحصيل ويرجّع الرصيد. سبب الارتداد:' : 'سبب ارتداد الشيك:', '');
    if (reason === null) return;
    try {
        const { error } = await sb.rpc('fn_cheque_bounce', { p_id: id, p_reason: reason });
        if (error) throw error;
        renderCheques(document.getElementById('app-content'));
    } catch (err) { alert('❌ ' + err.message); }
};
window.chqCancel = async function (id) {
    if (!confirm('إلغاء الشيك؟ (مفيش أثر على الحسابات)')) return;
    try {
        const { error } = await sb.rpc('fn_cheque_cancel', { p_id: id });
        if (error) throw error;
        renderCheques(document.getElementById('app-content'));
    } catch (err) { alert('❌ ' + err.message); }
};

Object.assign(window, { renderCheques });
