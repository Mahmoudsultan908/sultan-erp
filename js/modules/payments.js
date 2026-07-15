/* ════════════════════════════════════════════════════════════
   دفع الموردين (سندات صرف) — supplier_payments
   INSERT فقط — الـ Triggers تتولى: الخزنة + رصيد المورد + القيد
   ════════════════════════════════════════════════════════════ */

let _paySuppliers = [];
let _paySelectedId = null;
let _payList = [];
let _payTreasuries = [];
let _payEditingId = null; // معرّف سند الصرف الجاري تعديله (مودال التعديل)

// ════════════════════════════════════════════════════════════
// 1) التقديم الرئيسي
// ════════════════════════════════════════════════════════════
async function renderPayments(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات دفع الموردين...</div>';
    let suppliers = [], payments = [], isOfflineData = false, offlineDataAge = null;
    try {
        const { data: suppData, error: suppErr } = await sb.from('suppliers').select('*').eq('is_active', true).order('name');
        if (suppErr || !suppData) throw suppErr || new Error('no suppliers');
        suppliers = suppData;
        const { data: payData } = await sb.from('supplier_payments')
            .select('*, suppliers(name, phone, balance)').order('created_at', { ascending: false }).limit(50);
        payments = payData || [];
        const { data: treasuriesData } = await sb.from('treasuries').select('*').eq('is_active', true).order('is_default', { ascending: false });
        _payTreasuries = treasuriesData || [];
        // كاش للمراجعة الأوفلاين (offline.js) — قراءة فقط، بيتحدّث تلقائياً كل ما الصفحة تفتح أونلاين
        if (typeof dbSetCache === 'function') dbSetCache('suppliers', suppliers);
    } catch (err) {
        // فشل التحميل الحي (أوفلاين أو خطأ شبكة) → ارجع لآخر نسخة محفوظة في الكاش
        if (typeof dbGetCache === 'function') {
            const cached = await dbGetCache('suppliers');
            if (cached?.data?.length) {
                suppliers = cached.data;
                isOfflineData = true;
                offlineDataAge = cached.updatedAt;
            }
        }
    }

    _paySuppliers = typeof payApplyPendingEstimates === 'function' ? await payApplyPendingEstimates(suppliers) : suppliers;
    _payList = payments;

    // عمليات دفع اتسجّلت محلياً ولسه ماتزامنتش
    const pendingEntries = typeof getQueue === 'function'
        ? await getQueue(e => e.module === 'payments' && (e.status === 'pending' || e.status === 'failed' || e.status === 'syncing'))
        : [];
    const pendingRows = pendingEntries.map(e => ({
        _queue: true, id: 'q' + e.id, _queueId: e.id,
        ref: e.payload.ref, amount: e.payload.amount, created_at: new Date(e.createdAt).toISOString(), status: e.status,
        suppliers: { name: _paySuppliers.find(x => x.id === e.payload.supplier_id)?.name || '—' },
    }));
    const displayRows = [...pendingRows, ...payments];

    const totalPaid = payments.reduce((s,p)=>s+(Number(p.amount)||0),0);
    const debtSuppliers = _paySuppliers.filter(s => (Number(s.balance)||0) > 0);
    const totalDebt = debtSuppliers.reduce((s,s2)=>s+(Number(s2.balance)||0),0);

    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
            <div><h2 style="font-size:22px;font-weight:800">💸 دفع الموردين (سندات صرف)</h2>
            <p style="font-size:13px;color:#64748B;margin-top:4px">تسجيل المدفوعات للموردين — مرتبطة بالخزنة ورصيد المورد</p></div>
            <button class="mod-btn mod-btn-primary" onclick="payOpenAdd()">+ صرف دفعة جديدة</button>
        </div>

        ${isOfflineData ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:9px 16px;border-radius:9px;margin-bottom:16px;font-size:12.5px">
            📴 <strong>غير متصل بالإنترنت</strong> — بيانات الموردين المعروضة من آخر نسخة محفوظة (${offlineDataAge ? new Date(offlineDataAge).toLocaleString('ar-EG') : '—'}). الدفع هيتسجّل محلياً ويتزامن تلقائياً لما الاتصال يرجع.
        </div>` : ''}

        <div class="mod-grid">
            <div class="mod-card"><div class="mod-card-icon" style="background:#D1FAE5;color:#059669">💵</div><div class="mod-card-val">${payFmt(totalPaid)}</div><div class="mod-card-lbl">إجمالي المدفوع</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#FEF3C7;color:#D97706">📋</div><div class="mod-card-val">${payments.length}</div><div class="mod-card-lbl">سند صرف</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#FEE2E2;color:#DC2626">⚠️</div><div class="mod-card-val">${payFmt(totalDebt)}</div><div class="mod-card-lbl">مستحق للموردين (${debtSuppliers.length})</div></div>
        </div>

        ${paySuppliersDebtListHTML(debtSuppliers)}

        <div class="mod-card" style="padding:12px 16px;margin-top:16px;display:flex;align-items:center;gap:10px">
            <input type="text" id="payHistSearch" class="mod-form-input" style="margin:0;max-width:280px" placeholder="🔍 بحث في السجل بالمورد..." oninput="payFilterHistory()">
        </div>

        <div class="mod-table-wrap" style="margin-top:10px">
            <table class="mod-table" id="payHistTable"><thead><tr>
                <th>الرقم</th><th>المورد</th><th>التاريخ</th><th style="text-align:left">المبلغ</th><th>الحالة</th><th></th>
            </tr></thead>
            <tbody>
                ${displayRows.length === 0 ? `<tr><td colspan="6" class="empty-state"><span>💸</span>لا توجد مدفوعات.</td></tr>` :
                displayRows.map(p => `<tr data-name="${(p.suppliers?.name||'').toLowerCase()}">
                    <td><span style="background:#F1F5F9;padding:3px 8px;border-radius:5px;font-size:11px;font-family:monospace">${p.ref||'—'}</span></td>
                    <td><strong>${p.suppliers?.name || '—'}</strong></td>
                    <td>${new Date(p.created_at).toLocaleDateString('ar-EG')}</td>
                    <td style="text-align:left;font-weight:700;color:#059669">${payFmt(p.amount)}</td>
                    <td>${p._queue
                        ? (p.status === 'failed' ? '<span style="color:#DC2626;font-weight:600">❌ فشلت المزامنة</span>' : '<span style="color:#D97706;font-weight:600">⏳ غير مُزامن</span>')
                        : (p.status==='confirmed'?'<span style="color:#059669;font-weight:600">✅ مؤكد</span>':p.status==='cancelled'?'<span style="color:#94A3B8;font-weight:600">🚫 ملغى (معدَّل)</span>':`<span style="color:#D97706">${p.status}</span>`)}</td>
                    <td style="white-space:nowrap">${p._queue ? '' : `<button class="cc-edit" onclick="payPrintVoucher('${p.id}')">🖨️</button>${p.status==='confirmed' ? `<button class="cc-edit" style="background:#DBEAFE;color:#2563EB" onclick="payOpenEditModal('${p.id}')">✏️ تعديل</button>` : ''}`}</td>
                </tr>`).join('')}
            </tbody></table>
        </div>
    `;
}

// فلترة سجل المدفوعات المعروض حسب اسم المورد (بحث فوري داخل الصفوف المعروضة فعلاً)
window.payFilterHistory = function() {
    const term = (document.getElementById('payHistSearch')?.value || '').trim().toLowerCase();
    document.querySelectorAll('#payHistTable tbody tr[data-name]').forEach(tr => {
        tr.style.display = (!term || tr.dataset.name.includes(term)) ? '' : 'none';
    });
};

// تقدير محلي تراكمي لرصيد الموردين (نفس منطق colApplyPendingEstimates)
async function payApplyPendingEstimates(suppliers) {
    if (typeof getQueue !== 'function') return suppliers;
    try {
        const pending = await getQueue(e => e.module === 'payments' && (e.status === 'pending' || e.status === 'failed' || e.status === 'syncing'));
        if (!pending.length) return suppliers;
        const bySupp = {};
        for (const e of pending) {
            bySupp[e.payload.supplier_id] = (bySupp[e.payload.supplier_id] || 0) + (Number(e.payload.amount) || 0);
        }
        return suppliers.map(s => bySupp[s.id] ? { ...s, balance: (Number(s.balance) || 0) - bySupp[s.id] } : s);
    } catch { return suppliers; }
}

function paySuppliersDebtListHTML(debtSuppliers) {
    if (!debtSuppliers.length) return '';
    return `
    <div class="mod-card" style="margin-top:16px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
            <div class="mod-card-icon" style="background:#FEF3C7;color:#D97706;width:40px;height:40px;font-size:18px">⚠️</div>
            <div><div style="font-size:14px;font-weight:800">موردون لهم مستحقات (مديونيات)</div><div style="font-size:11px;color:#64748B">اضغط "صرف دفعة" بجوار أي مورد لدفعه فوراً</div></div>
        </div>
        ${debtSuppliers.slice(0,8).map(s => `<div class="cat-card">
            <div class="cc-ic">🏭</div>
            <div class="cc-info">
                <div class="cc-name">${s.name}</div>
                <div class="cc-sub">${s.phone||''} ${s.code?'· '+s.code:''}</div>
            </div>
            <div class="cc-amt">
                <div class="used" style="color:#DC2626">${payFmt(s.balance)}</div>
                <div class="lim">مستحق</div>
            </div>
            <button class="cc-edit" style="background:#D1FAE5;color:#059669" onclick="payQuickPay('${s.id}')">💸 دفع</button>
        </div>`).join('')}
    </div>`;
}

// ════════════════════════════════════════════════════════════
// 2) نافذة إضافة دفعة
// ════════════════════════════════════════════════════════════
window.payOpenAdd = function(presetSupplierId = null) {
    _paySelectedId = presetSupplierId;
    const preset = presetSupplierId ? _paySuppliers.find(s=>s.id===presetSupplierId) : null;

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'payModal';
    modal.innerHTML = `
        <div class="mod-modal">
            <div class="mod-modal-header"><h3>💸 صرف دفعة لمورد</h3>
                <button class="mod-modal-close" onclick="payCloseModal('payModal')">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>المورد *</label>
                    <div style="position:relative">
                        <input type="text" id="paySuppSearch" class="mod-form-input" placeholder="🔍 اكتب اسم المورد / الهاتف / الكود..." autocomplete="off"
                            value="${preset?preset.name:''}"
                            oninput="paySuppSearchInput('add')" onfocus="paySuppSearchInput('add')" onkeydown="paySuppACKey(event,'add')"
                            onblur="setTimeout(()=>{const ac=document.getElementById('paySuppAC'); if(ac) ac.classList.remove('show');},150)">
                        <input type="hidden" id="paySuppId" value="${presetSupplierId||''}">
                        <div class="inv-ac" id="paySuppAC"></div>
                    </div>
                </div>
                <div class="mod-form-group"><label>المبلغ (ج.م) *</label>
                    <input type="number" id="payAmount" class="mod-form-input" placeholder="0.00" step="0.01" dir="ltr" value="${preset?payFmt(preset.balance):''}" oninput="payPreview()">
                </div>
                <div class="mod-form-group"><label>المرجع / البيان</label>
                    <input type="text" id="payRef" class="mod-form-input" placeholder="مثال: دفعة على حساب فاتورة PUR-0005">
                </div>
                <div class="mod-form-group"><label>الخزنة</label>
                    <select id="payTreasuryId" class="mod-form-input">
                        ${_payTreasuries.map(t => `<option value="${t.id}" ${t.is_default?'selected':''}>${t.name}</option>`).join('')}
                    </select>
                </div>
                <div id="payBalancePreview"></div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="payCloseModal('payModal')">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="paySave()">💾 صرف الدفعة</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    if (presetSupplierId) payPreview();
};

window.payQuickPay = function(supplierId) { payOpenAdd(supplierId); };

window.payCloseModal = function(id) { const m = document.getElementById(id); if (m) m.remove(); };

window.payOnSuppChange = function() {
    _paySelectedId = document.getElementById('paySuppId').value;
    payPreview();
};

// اختيار المورد — Autocomplete حقيقي (زي inv-cust-pick في sales.js) بدل
// خانة بحث + <select> منفصلين. مودال الإضافة (paySuppSearch/paySuppId/
// paySuppAC) ومودال التعديل (payEditSuppSearch/payEditSuppId/payEditSuppAC)
// بيستخدموا نفس الدالتين بتمرير mode ('add'|'edit').
let _paySuppACIdx = -1;
window.paySuppSearchInput = function(mode) {
    mode = mode || 'add';
    const searchId = mode === 'edit' ? 'payEditSuppSearch' : 'paySuppSearch';
    const acId = mode === 'edit' ? 'payEditSuppAC' : 'paySuppAC';
    const ac = document.getElementById(acId);
    if (!ac) return;
    _paySuppACIdx = -1;
    const term = (document.getElementById(searchId)?.value || '').trim().toLowerCase();
    // من غير كتابة: تعرض أول 20 مورد زي ما هم، عشان القائمة تظهر على طول
    // أول ما تدوس على الخانة (مش لازم تكتب حاجة الأول)
    const list = (term ? _paySuppliers.filter(s =>
        (s.name||'').toLowerCase().includes(term) || (s.phone||'').includes(term) || (s.code||'').toLowerCase().includes(term)
    ) : _paySuppliers).slice(0, 20);
    if (!list.length) {
        ac.innerHTML = `<div class="inv-ac-item" style="cursor:default;color:#94A3B8">لا يوجد نتائج مطابقة</div>`;
        ac.classList.add('show');
        return;
    }
    ac.innerHTML = list.map((s,i) => `<div class="inv-ac-item" data-i="${i}" data-id="${s.id}" onmousedown="event.preventDefault();payPickSupp('${s.id}','${mode}')" onmouseenter="paySuppACHover(${i},'${mode}')">
        <div><div class="an">${s.name}</div><div class="as">${s.phone||''}${s.code?' · '+s.code:''}</div></div>
        <div class="ap"><div class="pr" style="${s.balance>0?'color:#DC2626':''}">${s.balance>0?payFmt(s.balance):''}</div><div class="as">${s.balance>0?'مستحق':''}</div></div>
    </div>`).join('');
    ac.classList.add('show');
};
window.paySuppACKey = function(e, mode) {
    mode = mode || 'add';
    const acId = mode === 'edit' ? 'payEditSuppAC' : 'paySuppAC';
    const ac = document.getElementById(acId);
    if (!ac || !ac.classList.contains('show')) return;
    const items = ac.querySelectorAll('.inv-ac-item[data-i]');
    if (e.key === 'ArrowDown') { e.preventDefault(); _paySuppACIdx = Math.min(_paySuppACIdx+1, items.length-1); paySuppACHover(_paySuppACIdx, mode); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _paySuppACIdx = Math.max(_paySuppACIdx-1, 0); paySuppACHover(_paySuppACIdx, mode); }
    else if (e.key === 'Enter') { e.preventDefault(); const id = items[_paySuppACIdx]?.dataset.id; if (id) payPickSupp(id, mode); }
    else if (e.key === 'Escape') { ac.classList.remove('show'); _paySuppACIdx = -1; }
};
window.paySuppACHover = function(i, mode) {
    mode = mode || 'add';
    _paySuppACIdx = i;
    const acId = mode === 'edit' ? 'payEditSuppAC' : 'paySuppAC';
    const items = document.querySelectorAll('#'+acId+' .inv-ac-item[data-i]');
    items.forEach((el,idx)=>el.classList.toggle('active', idx===i));
    items[i]?.scrollIntoView({ block: 'nearest' });
};

window.payPickSupp = function(id, mode) {
    mode = mode || 'add';
    const searchId = mode === 'edit' ? 'payEditSuppSearch' : 'paySuppSearch';
    const hiddenId = mode === 'edit' ? 'payEditSuppId' : 'paySuppId';
    const acId = mode === 'edit' ? 'payEditSuppAC' : 'paySuppAC';
    const s = _paySuppliers.find(x => x.id === id);
    if (!s) return;
    document.getElementById(hiddenId).value = id;
    document.getElementById(searchId).value = s.name;
    const ac = document.getElementById(acId);
    if (ac) { ac.innerHTML = ''; ac.classList.remove('show'); }
    if (mode === 'add') payOnSuppChange();
};

window.payPreview = function() {
    const sid = document.getElementById('paySuppId').value;
    const amount = parseFloat(document.getElementById('payAmount').value) || 0;
    const area = document.getElementById('payBalancePreview');
    if (!sid || amount <= 0) { area.innerHTML = ''; return; }
    const s = _paySuppliers.find(x=>x.id===sid);
    if (!s) return;
    const bal = Number(s.balance) || 0;
    const after = bal - amount;
    area.innerHTML = `
        <div class="limit-box" style="border-color:#D1FAE5;background:#ECFDF5">
            <div class="limit-row"><span class="lr-label">المستحق للمورد:</span><span class="lr-val" style="color:#DC2626">${payFmt(bal)} ج.م</span></div>
            <div class="limit-row"><span class="lr-label">هذه الدفعة:</span><span class="lr-val" style="color:#059669">${payFmt(amount)} ج.م</span></div>
            <div class="limit-row"><span class="lr-label">المستحق بعد الدفع:</span><span class="lr-val" style="color:${after>0?'#D97706':'#059669'}">${payFmt(after)} ج.م</span></div>
        </div>`;
};

// ════════════════════════════════════════════════════════════
// 3) الحفظ — INSERT في supplier_payments فقط
// ════════════════════════════════════════════════════════════
window.paySave = async function() {
    const suppId = document.getElementById('paySuppId').value;
    const amount = parseFloat(document.getElementById('payAmount').value);
    const ref = document.getElementById('payRef').value.trim();
    const treasuryId = document.getElementById('payTreasuryId').value || null;
    if (!suppId) return alert('اختر المورد');
    if (!amount || amount <= 0) return alert('أدخل مبلغاً صحيحاً');

    const btn = document.querySelector('#payModal .mod-btn-primary');
    btn.innerText = 'جاري الحفظ...'; btn.disabled = true;

    if (typeof isOnline === 'function' && !isOnline()) {
        try {
            const supp = _paySuppliers.find(x => x.id === suppId);
            const estBalanceAfter = (Number(supp?.balance) || 0) - amount;
            await queueWrite({
                module: 'payments', kind: 'payment',
                payload: {
                    ref: ref || 'PAY-' + Date.now(),
                    supplier_id: suppId, amount, status: 'confirmed', treasury_id: treasuryId,
                    created_by: currentUser?.id || null,
                    _estBalanceAfter: estBalanceAfter,
                },
            });
            payCloseModal('payModal');
            if (typeof offlineToast === 'function') offlineToast('⏳ اتسجّل محلياً — هيتزامن تلقائياً لما الاتصال يرجع', 'info');
            renderPayments(document.getElementById('app-content'));
        } catch (err) {
            alert('خطأ أثناء الحفظ المحلي: ' + err.message);
        } finally {
            btn.innerText = '💾 صرف الدفعة'; btn.disabled = false;
        }
        return;
    }

    try {
        // INSERT فقط — الـ trigger بيتكفّل بـ: خصم الخزنة + تقليل رصيد المورد + القيد المحاسبي
        const { error } = await sb.from('supplier_payments').insert({
            ref: ref || 'PAY-' + Date.now(),
            supplier_id: suppId,
            amount,
            status: 'confirmed',
            treasury_id: treasuryId,
            created_by: currentUser?.id || null,
        });
        if (error) throw error;

        payCloseModal('payModal');
        try {
            const { data: cash } = await sb.rpc('get_cash_balance');
            const tb = document.getElementById('topbarCash');
            if (tb) tb.textContent = '💰 ' + (cash || 0).toFixed(2) + ' ج.م';
        } catch {}
        renderPayments(document.getElementById('app-content'));
    } catch (err) { alert('خطأ أثناء الصرف: ' + err.message); }
    finally { btn.innerText = '💾 صرف الدفعة'; btn.disabled = false; }
};

// ════════════════════════════════════════════════════════════
// 3ب) تعديل سند صرف مؤكّد بعد الحفظ
// نفس فلسفة js/modules/invoice-review.js تماماً: ممنوع UPDATE مباشر على
// صف مؤكّد (trigger fn_block_amount_edit_after_confirm بيمنع أي تعديل
// غير تغيير status لـ cancelled) — فبدل ما نعدّل السطر القديم، بنلغيه
// (UPDATE status='cancelled'، والـ trigger fn_payment_status_change
// بيرجّع الخزنة ورصيد المورد ويعكس القيد تلقائياً — كله في نفس الـ
// UPDATE الواحد، يعني ذرّي من غير حاجة لـ RPC إضافية) وبعدين نسجّل سند
// جديد بالبيانات المعدّلة (نفس مسار الحفظ العادي).
// ════════════════════════════════════════════════════════════
// supplier_payments.ref عمود unique — السند الملغي بيفضل شاغل قيمته،
// فلو المستخدم سايب المرجع زي ما هو وقت التعديل الـ insert بيتصادم معاه
// (supplier_payments_ref_key). بنضيف -2, -3.. لحد ما نلاقي قيمة فاضية.
async function payUniqueRef(base) {
    let candidate = base;
    let n = 2;
    while (true) {
        const { data } = await sb.from('supplier_payments').select('id').eq('ref', candidate).limit(1);
        if (!data || !data.length) return candidate;
        candidate = `${base}-${n}`;
        n++;
    }
}
window.payOpenEditModal = function(id) {
    const p = _payList.find(x => x.id === id);
    if (!p) return alert('تعذّر العثور على سند الصرف');
    if (p.status !== 'confirmed') return alert('هذا السند غير مؤكد بالفعل ولا يمكن تعديله');
    _payEditingId = id;

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'payEditModal';
    modal.innerHTML = `
        <div class="mod-modal">
            <div class="mod-modal-header"><h3>✏️ تعديل سند صرف ${p.ref||''}</h3>
                <button class="mod-modal-close" onclick="payCloseModal('payEditModal')">&times;</button></div>
            <div class="mod-modal-body">
                <div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:9px 12px;border-radius:8px;margin-bottom:14px;font-size:12px">
                    ⚠️ الحفظ هيلغي سند الصرف القديم تلقائياً (المبلغ يرجع للخزنة ويترحّل على رصيد المورد) ويسجّل سنداً جديداً بالبيانات المعدّلة — حفاظاً على سجل تاريخي كامل، بدل التعديل المباشر.
                </div>
                <div class="mod-form-group"><label>المورد *</label>
                    <div style="position:relative">
                        <input type="text" id="payEditSuppSearch" class="mod-form-input" placeholder="🔍 اكتب اسم المورد / الهاتف / الكود..." autocomplete="off"
                            value="${p.suppliers?.name || _paySuppliers.find(s=>s.id===p.supplier_id)?.name || ''}"
                            oninput="paySuppSearchInput('edit')" onfocus="paySuppSearchInput('edit')" onkeydown="paySuppACKey(event,'edit')"
                            onblur="setTimeout(()=>{const ac=document.getElementById('payEditSuppAC'); if(ac) ac.classList.remove('show');},150)">
                        <input type="hidden" id="payEditSuppId" value="${p.supplier_id||''}">
                        <div class="inv-ac" id="payEditSuppAC"></div>
                    </div>
                </div>
                <div class="mod-form-group"><label>المبلغ (ج.م) *</label>
                    <input type="number" id="payEditAmount" class="mod-form-input" placeholder="0.00" step="0.01" dir="ltr" value="${Number(p.amount)||0}">
                </div>
                <div class="mod-form-group"><label>المرجع / البيان</label>
                    <input type="text" id="payEditRef" class="mod-form-input" value="${p.ref||''}">
                </div>
                <div class="mod-form-group"><label>الخزنة</label>
                    <select id="payEditTreasuryId" class="mod-form-input">
                        ${_payTreasuries.map(t => `<option value="${t.id}" ${t.id===p.treasury_id?'selected':(!p.treasury_id&&t.is_default?'selected':'')}>${t.name}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="payCloseModal('payEditModal')">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="paySaveEdit()">💾 حفظ التعديل</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
};

window.paySaveEdit = async function() {
    const oldId = _payEditingId;
    if (!oldId) return;
    const suppId = document.getElementById('payEditSuppId').value;
    const amount = parseFloat(document.getElementById('payEditAmount').value);
    const ref = document.getElementById('payEditRef').value.trim();
    const treasuryId = document.getElementById('payEditTreasuryId').value || null;
    if (!suppId) return alert('اختر المورد');
    if (!amount || amount <= 0) return alert('أدخل مبلغاً صحيحاً');

    if (typeof isOnline === 'function' && !isOnline()) {
        alert('📴 تعديل سند صرف موجود محتاج اتصال بالإنترنت — حاول تاني لما الاتصال يرجع');
        return;
    }

    const btn = document.querySelector('#payEditModal .mod-btn-primary');
    btn.innerText = 'جاري الحفظ...'; btn.disabled = true;

    try {
        // 1) إلغاء السند القديم — UPDATE واحد ذرّي، الـ trigger بيرجّع
        //    الخزنة ورصيد المورد ويعكس القيد المحاسبي تلقائياً.
        const { error: cancelErr } = await sb.from('supplier_payments').update({ status: 'cancelled' }).eq('id', oldId);
        if (cancelErr) throw cancelErr;

        // 2) تسجيل سند جديد بالبيانات المعدّلة (نفس مسار paySave العادي)
        //    ref عمود unique على مستوى الجدول كله (حتى لو السند القديم
        //    اتلغى) — والمودال بيعرض ref القديم كقيمة افتراضية، فلو
        //    المستخدم سابه زي ما هو هيتصادم مع السند القديم نفسه.
        //    payUniqueRef بتضيف لاحقة -2, -3.. لحد ما تلاقي قيمة فاضية.
        const finalRef = await payUniqueRef(ref || 'PAY-' + Date.now());
        const { error: insErr } = await sb.from('supplier_payments').insert({
            ref: finalRef,
            supplier_id: suppId,
            amount,
            status: 'confirmed',
            treasury_id: treasuryId,
            created_by: currentUser?.id || null,
        });
        if (insErr) {
            // السند القديم اتلغى فعلاً (ورجع الرصيد/الخزنة) لكن السند
            // الجديد فشل — نوضّح للمستخدم إن الإلغاء تم بنجاح ومحتاج
            // يسجّل السند الصحيح يدوياً من "صرف دفعة جديدة".
            alert('⚠️ تم إلغاء السند القديم بنجاح (رجع المبلغ للخزنة ورصيد المورد)، لكن فشل تسجيل السند الجديد المعدّل: ' + insErr.message + '\n\nسجّل السند بالبيانات الصحيحة يدوياً من زرار "صرف دفعة جديدة".');
            payCloseModal('payEditModal');
            _payEditingId = null;
            renderPayments(document.getElementById('app-content'));
            return;
        }

        payCloseModal('payEditModal');
        _payEditingId = null;
        try {
            const { data: cash } = await sb.rpc('get_cash_balance');
            const tb = document.getElementById('topbarCash');
            if (tb) tb.textContent = '💰 ' + (cash || 0).toFixed(2) + ' ج.م';
        } catch {}
        renderPayments(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ أثناء تعديل الدفعة: ' + err.message);
    } finally {
        btn.innerText = '💾 حفظ التعديل'; btn.disabled = false;
    }
};

// ════════════════════════════════════════════════════════════
// 5) مزامنة عمليات الدفع المعلّقة (Phase 1 — دعم الأوفلاين)
// ════════════════════════════════════════════════════════════
if (typeof registerSyncHandler === 'function') {
    registerSyncHandler('payment', async (entry) => {
        const { _estBalanceAfter, ...payload } = entry.payload;
        try {
            const { error } = await sb.from('supplier_payments').insert(payload);
            if (error) return { ok: false, error: error.message, summary: `دفعة ${payload.ref}` };

            const flags = [];
            try {
                const { data: freshSupp } = await sb.from('suppliers').select('balance').eq('id', payload.supplier_id).maybeSingle();
                if (freshSupp && _estBalanceAfter != null) {
                    const diff = Math.abs((Number(freshSupp.balance) || 0) - Number(_estBalanceAfter));
                    if (diff > 0.01) flags.push(`الرصيد الفعلي بعد المزامنة (${payFmt(freshSupp.balance)}) يختلف عن التقدير وقت الأوفلاين (${payFmt(_estBalanceAfter)})`);
                }
            } catch {}

            return { ok: true, summary: `دفعة ${payload.ref} — ${payFmt(payload.amount)} ج.م`, flags };
        } catch (err) {
            return { ok: false, error: err.message || String(err), summary: `دفعة ${payload.ref}` };
        }
    });
}

// ════════════════════════════════════════════════════════════
// 4) أدوات مساعدة
// ════════════════════════════════════════════════════════════
window.payPrintVoucher = async function(id) {
    const p = _payList.find(x=>x.id===id);
    if (!p) return;
    const balanceAfter = (Number(p.suppliers?.balance)||0);
    const balanceBefore = balanceAfter + Number(p.amount);
    await printThermalReceipt('payment', {
        ref: p.ref, entityName: p.suppliers?.name || '—', amount: p.amount,
        entityBalanceBefore: balanceBefore, entityBalanceAfter: balanceAfter,
    });
};

function payFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
