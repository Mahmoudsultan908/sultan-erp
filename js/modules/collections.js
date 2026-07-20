/* ════════════════════════════════════════════════════════════
   تحصيل العملاء (سندات قبض) — customer_payments
   INSERT فقط — الـ Trigger (سيُنشأ لاحقاً) بيتولّى: الخزنة + رصيد العميل + القيد

   ⚠️ تنبيه مهم: جدول customer_payments جديد كلياً وليس له Trigger بعد.
   عند الـ INSERT بنجاح من الواجهة، لازم يتعمل Trigger في قاعدة البيانات
   يخصم من رصيد العميل ويضيف في الخزنة. (شغل منفصل على Supabase)
   ════════════════════════════════════════════════════════════ */

let _colCustomers = [];
let _colSelectedId = null;
let _colList = [];
let _colTreasuries = [];
let _colEditingId = null; // معرّف سند التحصيل الجاري تعديله (مودال التعديل)
let _colRepById = {}; // created_by => اسم المندوب، لو التحصيل مسجّل من تطبيق سلطانو

// ════════════════════════════════════════════════════════════
// 1) التقديم الرئيسي
// ════════════════════════════════════════════════════════════
async function renderCollections(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات تحصيل العملاء...</div>';
    let customers = [], payments = [], isOfflineData = false, offlineDataAge = null;
    try {
        const { data: custData, error: custErr } = await sb.from('customers').select('*').eq('is_active', true).order('name');
        if (custErr || !custData) throw custErr || new Error('no customers');
        customers = custData;
        try {
            const r = await sb.from('customer_payments')
                .select('*, customers(name, phone, balance)').order('created_at', { ascending: false }).limit(50);
            payments = r.data || [];
        } catch (e) {
            // الجدول ممكن ما يكنش اتخلق لسه → نعرض تحذير للمستخدم
        }
        const { data: treasuriesData } = await sb.from('treasuries').select('*').eq('is_active', true).order('is_default', { ascending: false });
        _colTreasuries = treasuriesData || [];
        const { data: repsData } = await sb.from('sales_reps').select('id,name').eq('is_active', true);
        _colRepById = {};
        (repsData || []).forEach(r => { _colRepById[r.id] = r.name; });
        // كاش للمراجعة الأوفلاين (offline.js) — قراءة فقط، بيتحدّث تلقائياً كل ما الصفحة تفتح أونلاين
        if (typeof dbSetCache === 'function') dbSetCache('customers', customers);
    } catch (err) {
        // فشل التحميل الحي (أوفلاين أو خطأ شبكة) → ارجع لآخر نسخة محفوظة في الكاش
        if (typeof dbGetCache === 'function') {
            const cached = await dbGetCache('customers');
            if (cached?.data?.length) {
                customers = cached.data;
                isOfflineData = true;
                offlineDataAge = cached.updatedAt;
            }
        }
    }

    _colCustomers = typeof colApplyPendingEstimates === 'function' ? await colApplyPendingEstimates(customers) : customers;
    _colList = payments;

    // عمليات تحصيل اتسجّلت محلياً ولسه ماتزامنتش
    const pendingEntries = typeof getQueue === 'function'
        ? await getQueue(e => e.module === 'collections' && (e.status === 'pending' || e.status === 'failed' || e.status === 'syncing'))
        : [];
    const pendingRows = pendingEntries.map(e => ({
        _queue: true, id: 'q' + e.id, _queueId: e.id,
        ref: e.payload.ref, amount: e.payload.amount, created_at: new Date(e.createdAt).toISOString(), status: e.status,
        customers: { name: _colCustomers.find(x => x.id === e.payload.customer_id)?.name || '—' },
    }));
    const displayRows = [...pendingRows, ...payments];

    const totalCollected = payments.reduce((s,p)=>s+(Number(p.amount)||0),0);
    const debtCustomers = _colCustomers.filter(c => (Number(c.balance)||0) > 0);
    const totalDebt = debtCustomers.reduce((s,c)=>s+(Number(c.balance)||0),0);

    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
            <div><h2 style="font-size:22px;font-weight:800">💵 تحصيل العملاء (سندات قبض)</h2>
            <p style="font-size:13px;color:#64748B;margin-top:4px">تسجيل المبالغ المحصّلة من العملاء — مرتبطة بالخزنة ورصيد العميل</p></div>
            <button class="mod-btn mod-btn-primary" onclick="colOpenAdd()">+ تحصيل دفعة جديدة</button>
        </div>

        ${isOfflineData ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:9px 16px;border-radius:9px;margin-bottom:16px;font-size:12.5px">
            📴 <strong>غير متصل بالإنترنت</strong> — بيانات العملاء المعروضة من آخر نسخة محفوظة (${offlineDataAge ? new Date(offlineDataAge).toLocaleString('ar-EG') : '—'}). التحصيل هيتسجّل محلياً ويتزامن تلقائياً لما الاتصال يرجع.
        </div>` : ''}

        ${(!isOfflineData && payments.length === 0) ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:12px 16px;border-radius:10px;margin-bottom:16px;font-size:12px">
            ⚠️ <strong>تنبيه:</strong> جدول التحصيل (<code>customer_payments</code>) لم يتم إنشاؤه بعد في قاعدة البيانات، أو لا يحتوي على Trigger.
            شغّل الـ Migration أولاً، وأنشئ الـ Trigger لكي تتحرّك الخزنة وأرصدة العملاء تلقائياً عند كل تحصيل.
        </div>` : ''}

        <div class="mod-grid">
            <div class="mod-card"><div class="mod-card-icon" style="background:#D1FAE5;color:#059669">💵</div><div class="mod-card-val">${colFmt(totalCollected)}</div><div class="mod-card-lbl">إجمالي المحصّل</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#E0E7FF;color:#4F46E5">📊</div><div class="mod-card-val">${payments.length}</div><div class="mod-card-lbl">سند قبض</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#FEF3C7;color:#D97706">📋</div><div class="mod-card-val">${colFmt(totalDebt)}</div><div class="mod-card-lbl">مستحق من العملاء (${debtCustomers.length})</div></div>
        </div>

        ${colDebtListHTML(debtCustomers)}

        <div class="mod-card" style="padding:12px 16px;margin-top:16px;display:flex;align-items:center;gap:10px">
            <input type="text" id="colHistSearch" class="mod-form-input" style="margin:0;max-width:280px" placeholder="🔍 بحث في السجل بالعميل..." oninput="colFilterHistory()">
        </div>

        <div class="mod-table-wrap" style="margin-top:10px">
            <table class="mod-table" id="colHistTable"><thead><tr>
                <th>الرقم</th><th>العميل</th><th>التاريخ</th><th style="text-align:left">المبلغ</th><th>الحالة</th><th></th>
            </tr></thead>
            <tbody>
                ${displayRows.length === 0 ? `<tr><td colspan="6" class="empty-state"><span>💵</span>لا توجد تحصيلات.</td></tr>` :
                displayRows.map(p => `<tr data-name="${(p.customers?.name||'').toLowerCase()}">
                    <td><span style="background:#F1F5F9;padding:3px 8px;border-radius:5px;font-size:11px;font-family:monospace">${p.ref||'—'}</span></td>
                    <td><strong>${p.customers?.name || '—'}</strong>${_colRepById[p.created_by] ? ` <span style="font-size:11px;color:#2563EB">🚗 ${_colRepById[p.created_by]}</span>` : ''}</td>
                    <td>${new Date(p.created_at).toLocaleDateString('ar-EG')}</td>
                    <td style="text-align:left;font-weight:700;color:#059669">${colFmt(p.amount)}</td>
                    <td>${p._queue
                        ? (p.status === 'failed' ? '<span style="color:#DC2626;font-weight:600">❌ فشلت المزامنة</span>' : '<span style="color:#D97706;font-weight:600">⏳ غير مُزامن</span>')
                        : (p.status==='confirmed'?'<span style="color:#059669;font-weight:600">✅ مؤكد</span>':p.status==='cancelled'?'<span style="color:#94A3B8;font-weight:600">🚫 ملغى (معدَّل)</span>':`<span style="color:#D97706">${p.status}</span>`)}</td>
                    <td style="white-space:nowrap">${p._queue ? '' : `<button class="cc-edit" onclick="colPrintVoucher('${p.id}')">🖨️</button>${p.status==='confirmed' ? `<button class="cc-edit" style="background:#FFFBEB;color:#D97706" onclick="colOpenEditModal('${p.id}')">✏️ تعديل</button>` : ''}`}</td>
                </tr>`).join('')}
            </tbody></table>
        </div>
    `;

    // ★ جاي من أيقونة "🔗" فى كشف حساب العميل (customers.js) — يفتح مودال
    //   تعديل نفس سند التحصيل على طول بدل ما يدوّر عليه فى السجل يدوي
    if (window._pendingCollectionEdit) {
        const pid = window._pendingCollectionEdit;
        window._pendingCollectionEdit = null;
        colOpenEditModal(pid);
    }
}

// فلترة سجل التحصيلات المعروض حسب اسم العميل (بحث فوري داخل الصفوف المعروضة فعلاً)
window.colFilterHistory = function() {
    const term = (document.getElementById('colHistSearch')?.value || '').trim().toLowerCase();
    document.querySelectorAll('#colHistTable tbody tr[data-name]').forEach(tr => {
        tr.style.display = (!term || tr.dataset.name.includes(term)) ? '' : 'none';
    });
};

// تقدير محلي تراكمي لرصيد العملاء: يطرح كل عمليات التحصيل المعلّقة في
// الطابور (لسه ماتزامنتش) من الرصيد المعروض، عشان لو فتحت "تحصيل" تاني
// لنفس العميل وإنت أوفلاين تشوف أثر العملية السابقة في التقدير.
async function colApplyPendingEstimates(customers) {
    if (typeof getQueue !== 'function') return customers;
    try {
        const pending = await getQueue(e => e.module === 'collections' && (e.status === 'pending' || e.status === 'failed' || e.status === 'syncing'));
        if (!pending.length) return customers;
        const byCust = {};
        for (const e of pending) {
            byCust[e.payload.customer_id] = (byCust[e.payload.customer_id] || 0) + (Number(e.payload.amount) || 0);
        }
        return customers.map(c => byCust[c.id] ? { ...c, balance: (Number(c.balance) || 0) - byCust[c.id] } : c);
    } catch { return customers; }
}

function colDebtListHTML(debtCustomers) {
    if (!debtCustomers.length) return '';
    return `
    <div class="mod-card" style="margin-top:16px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
            <div class="mod-card-icon" style="background:#FEF3C7;color:#D97706;width:40px;height:40px;font-size:18px">📋</div>
            <div><div style="font-size:14px;font-weight:800">عملاء لهم مستحقات (مديونيات)</div><div style="font-size:11px;color:#64748B">اضغط "تحصيل" بجوار أي عميل لتحصيل المبلغ فوراً</div></div>
        </div>
        ${debtCustomers.slice(0,8).map(c => `<div class="cat-card">
            <div class="cc-ic">👤</div>
            <div class="cc-info">
                <div class="cc-name">${c.name}</div>
                <div class="cc-sub">${c.phone||''} ${c.code?'· '+c.code:''}</div>
            </div>
            <div class="cc-amt">
                <div class="used" style="color:#DC2626">${colFmt(c.balance)}</div>
                <div class="lim">مستحق</div>
            </div>
            <button class="cc-edit" style="background:#D1FAE5;color:#059669" onclick="colQuickCollect('${c.id}')">💵 تحصيل</button>
        </div>`).join('')}
    </div>`;
}

// ════════════════════════════════════════════════════════════
// 2) نافذة تحصيل دفعة
// ════════════════════════════════════════════════════════════
window.colOpenAdd = function(presetCustomerId = null) {
    _colSelectedId = presetCustomerId;
    const preset = presetCustomerId ? _colCustomers.find(x=>x.id===presetCustomerId) : null;

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'colModal';
    modal.innerHTML = `
        <div class="mod-modal">
            <div class="mod-modal-header"><h3>💵 تحصيل دفعة من عميل</h3>
                <button class="mod-modal-close" onclick="colCloseModal('colModal')">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>العميل *</label>
                    <div style="position:relative">
                        <input type="text" id="colCustSearch" class="mod-form-input" placeholder="🔍 اكتب اسم العميل / الهاتف / الكود..." autocomplete="off"
                            value="${preset?preset.name:''}"
                            oninput="colCustSearchInput('add')" onfocus="colCustSearchInput('add')" onkeydown="colCustACKey(event,'add')"
                            onblur="setTimeout(()=>{const ac=document.getElementById('colCustAC'); if(ac) ac.classList.remove('show');},150)">
                        <input type="hidden" id="colCustId" value="${presetCustomerId||''}">
                        <div class="inv-ac" id="colCustAC"></div>
                    </div>
                </div>
                <div class="mod-form-group"><label>المبلغ المحصّل (ج.م) *</label>
                    <input type="number" id="colAmount" class="mod-form-input" placeholder="0.00" step="0.01" dir="ltr" value="${preset?colFmt(preset.balance):''}" oninput="colPreview()">
                </div>
                <div class="mod-form-group"><label>المرجع / البيان</label>
                    <input type="text" id="colRef" class="mod-form-input" placeholder="مثال: تحصيل على حساب فاتورة INV-0005">
                </div>
                <div class="mod-form-group"><label>الخزنة</label>
                    <select id="colTreasuryId" class="mod-form-input">
                        ${_colTreasuries.map(t => `<option value="${t.id}" ${t.is_default?'selected':''}>${t.name}</option>`).join('')}
                    </select>
                </div>
                <div id="colBalancePreview"></div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="colCloseModal('colModal')">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="colSave()">💾 تحصيل الدفعة</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    if (presetCustomerId) colPreview();
};

window.colQuickCollect = function(customerId) { colOpenAdd(customerId); };
window.colCloseModal = function(id) { const m = document.getElementById(id); if (m) m.remove(); };

window.colOnCustChange = function() {
    _colSelectedId = document.getElementById('colCustId').value;
    colPreview();
};

// اختيار العميل — Autocomplete حقيقي (زي inv-cust-pick في sales.js) بدل
// خانة بحث + <select> منفصلين. مودال الإضافة (colCustSearch/colCustId/
// colCustAC) ومودال التعديل (colEditCustSearch/colEditCustId/colEditCustAC)
// بيستخدموا نفس الدالتين بتمرير mode ('add'|'edit').
let _colCustACIdx = -1;
window.colCustSearchInput = function(mode) {
    mode = mode || 'add';
    const searchId = mode === 'edit' ? 'colEditCustSearch' : 'colCustSearch';
    const acId = mode === 'edit' ? 'colEditCustAC' : 'colCustAC';
    const ac = document.getElementById(acId);
    if (!ac) return;
    _colCustACIdx = -1;
    const term = (document.getElementById(searchId)?.value || '').trim().toLowerCase();
    // من غير كتابة: تعرض أول 20 عميل زي ما هم، عشان القائمة تظهر على طول
    // أول ما تدوس على الخانة (مش لازم تكتب حاجة الأول)
    const list = (term ? _colCustomers.filter(c =>
        (c.name||'').toLowerCase().includes(term) || (c.phone||'').includes(term) || (c.code||'').toLowerCase().includes(term)
    ) : _colCustomers).slice(0, 20);
    if (!list.length) {
        ac.innerHTML = `<div class="inv-ac-item" style="cursor:default;color:#94A3B8">لا يوجد نتائج مطابقة</div>`;
        ac.classList.add('show');
        return;
    }
    ac.innerHTML = list.map((c,i) => `<div class="inv-ac-item" data-i="${i}" data-id="${c.id}" onmousedown="event.preventDefault();colPickCust('${c.id}','${mode}')" onmouseenter="colCustACHover(${i},'${mode}')">
        <div><div class="an">${c.name}</div><div class="as">${c.phone||''}${c.code?' · '+c.code:''}</div></div>
        <div class="ap"><div class="pr" style="${c.balance>0?'color:#DC2626':''}">${c.balance>0?colFmt(c.balance):''}</div><div class="as">${c.balance>0?'مستحق':''}</div></div>
    </div>`).join('');
    ac.classList.add('show');
};
window.colCustACKey = function(e, mode) {
    mode = mode || 'add';
    const acId = mode === 'edit' ? 'colEditCustAC' : 'colCustAC';
    const ac = document.getElementById(acId);
    if (!ac || !ac.classList.contains('show')) return;
    const items = ac.querySelectorAll('.inv-ac-item[data-i]');
    if (e.key === 'ArrowDown') { e.preventDefault(); _colCustACIdx = Math.min(_colCustACIdx+1, items.length-1); colCustACHover(_colCustACIdx, mode); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _colCustACIdx = Math.max(_colCustACIdx-1, 0); colCustACHover(_colCustACIdx, mode); }
    else if (e.key === 'Enter') { e.preventDefault(); const id = items[_colCustACIdx]?.dataset.id; if (id) colPickCust(id, mode); }
    else if (e.key === 'Escape') { ac.classList.remove('show'); _colCustACIdx = -1; }
};
window.colCustACHover = function(i, mode) {
    mode = mode || 'add';
    _colCustACIdx = i;
    const acId = mode === 'edit' ? 'colEditCustAC' : 'colCustAC';
    const items = document.querySelectorAll('#'+acId+' .inv-ac-item[data-i]');
    items.forEach((el,idx)=>el.classList.toggle('active', idx===i));
    items[i]?.scrollIntoView({ block: 'nearest' });
};

window.colPickCust = function(id, mode) {
    mode = mode || 'add';
    const searchId = mode === 'edit' ? 'colEditCustSearch' : 'colCustSearch';
    const hiddenId = mode === 'edit' ? 'colEditCustId' : 'colCustId';
    const acId = mode === 'edit' ? 'colEditCustAC' : 'colCustAC';
    const c = _colCustomers.find(x => x.id === id);
    if (!c) return;
    document.getElementById(hiddenId).value = id;
    document.getElementById(searchId).value = c.name;
    const ac = document.getElementById(acId);
    if (ac) { ac.innerHTML = ''; ac.classList.remove('show'); }
    if (mode === 'add') colOnCustChange();
};

window.colPreview = function() {
    const cid = document.getElementById('colCustId').value;
    const amount = parseFloat(document.getElementById('colAmount').value) || 0;
    const area = document.getElementById('colBalancePreview');
    // ★ رصيد العميل يظهر فور اختياره، من غير ما ينتظر إدخال مبلغ — سطر
    //   "بعد التحصيل" بس هو اللي محتاج مبلغ فعلي عشان يتحسب.
    if (!cid) { area.innerHTML = ''; return; }
    const c = _colCustomers.find(x=>x.id===cid);
    if (!c) return;
    const bal = Number(c.balance) || 0;
    const after = bal - amount;
    area.innerHTML = `
        <div class="limit-box" style="border-color:#D1FAE5;background:#ECFDF5">
            <div class="limit-row"><span class="lr-label">المستحق على العميل:</span><span class="lr-val" style="color:#DC2626">${colFmt(bal)} ج.م</span></div>
            ${amount > 0 ? `
            <div class="limit-row"><span class="lr-label">هذا التحصيل:</span><span class="lr-val" style="color:#059669">${colFmt(amount)} ج.م</span></div>
            <div class="limit-row"><span class="lr-label">المستحق بعد التحصيل:</span><span class="lr-val" style="color:${after>0?'#D97706':'#059669'}">${colFmt(after)} ج.م</span></div>` : ''}
        </div>`;
};

// ════════════════════════════════════════════════════════════
// 3) الحفظ — INSERT في customer_payments فقط
// ════════════════════════════════════════════════════════════
window.colSave = async function() {
    const custId = document.getElementById('colCustId').value;
    const amount = parseFloat(document.getElementById('colAmount').value);
    const ref = document.getElementById('colRef').value.trim();
    const treasuryId = document.getElementById('colTreasuryId').value || null;
    if (!custId) return alert('اختر العميل');
    if (!amount || amount <= 0) return alert('أدخل مبلغاً صحيحاً');

    const btn = document.querySelector('#colModal .mod-btn-primary');
    btn.innerText = 'جاري الحفظ...'; btn.disabled = true;

    if (typeof isOnline === 'function' && !isOnline()) {
        try {
            const cust = _colCustomers.find(x => x.id === custId);
            const estBalanceAfter = (Number(cust?.balance) || 0) - amount;
            await queueWrite({
                module: 'collections', kind: 'collection',
                payload: {
                    ref: ref || 'COL-' + Date.now(),
                    customer_id: custId, amount, status: 'confirmed', treasury_id: treasuryId,
                    created_by: currentUser?.id || null,
                    _estBalanceAfter: estBalanceAfter,
                },
            });
            colCloseModal('colModal');
            if (typeof offlineToast === 'function') offlineToast('⏳ اتسجّل محلياً — هيتزامن تلقائياً لما الاتصال يرجع', 'info');
            renderCollections(document.getElementById('app-content'));
        } catch (err) {
            alert('خطأ أثناء الحفظ المحلي: ' + err.message);
        } finally {
            btn.innerText = '💾 تحصيل الدفعة'; btn.disabled = false;
        }
        return;
    }

    try {
        // INSERT فقط — الـ Trigger (سيُنشأ لاحقاً) بيتكفّل بـ: زيادة الخزنة + تقليل رصيد العميل + القيد المحاسبي
        const { error } = await sb.from('customer_payments').insert({
            ref: ref || 'COL-' + Date.now(),
            customer_id: custId,
            amount,
            status: 'confirmed',
            treasury_id: treasuryId,
            created_by: currentUser?.id || null,
        });
        if (error) throw error;

        colCloseModal('colModal');
        try {
            const { data: cash } = await sb.rpc('get_cash_balance');
            const tb = document.getElementById('topbarCash');
            if (tb) tb.textContent = '💰 ' + (cash || 0).toFixed(2) + ' ج.م';
        } catch {}
        renderCollections(document.getElementById('app-content'));
    } catch (err) { alert('خطأ أثناء التحصيل: ' + err.message); }
    finally { btn.innerText = '💾 تحصيل الدفعة'; btn.disabled = false; }
};

// ════════════════════════════════════════════════════════════
// 3ب) تعديل سند تحصيل مؤكّد بعد الحفظ
// نفس فلسفة js/modules/invoice-review.js تماماً: ممنوع UPDATE مباشر على
// صف مؤكّد (trigger fn_block_amount_edit_after_confirm بيمنع أي تعديل
// غير تغيير status لـ cancelled) — فبدل ما نعدّل السطر القديم، بنلغيه
// (UPDATE status='cancelled'، والـ trigger fn_customer_payment_status_
// change بيرجّع الخزنة ورصيد العميل ويعكس القيد تلقائياً — كله في نفس
// الـ UPDATE الواحد، يعني ذرّي من غير حاجة لـ RPC إضافية) وبعدين نسجّل
// سند جديد بالبيانات المعدّلة (نفس مسار الحفظ العادي).
// ════════════════════════════════════════════════════════════
// customer_payments.ref عمود unique — السند الملغي بيفضل شاغل قيمته،
// فلو المستخدم سايب المرجع زي ما هو وقت التعديل الـ insert بيتصادم معاه
// (customer_payments_ref_key). بنضيف -2, -3.. لحد ما نلاقي قيمة فاضية.
async function colUniqueRef(base) {
    let candidate = base;
    let n = 2;
    while (true) {
        const { data } = await sb.from('customer_payments').select('id').eq('ref', candidate).limit(1);
        if (!data || !data.length) return candidate;
        candidate = `${base}-${n}`;
        n++;
    }
}
window.colOpenEditModal = function(id) {
    const p = _colList.find(x => x.id === id);
    if (!p) return alert('تعذّر العثور على سند التحصيل');
    if (p.status !== 'confirmed') return alert('هذا السند غير مؤكد بالفعل ولا يمكن تعديله');
    _colEditingId = id;

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'colEditModal';
    modal.innerHTML = `
        <div class="mod-modal">
            <div class="mod-modal-header"><h3>✏️ تعديل سند تحصيل ${p.ref||''}</h3>
                <button class="mod-modal-close" onclick="colCloseModal('colEditModal')">&times;</button></div>
            <div class="mod-modal-body">
                <div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:9px 12px;border-radius:8px;margin-bottom:14px;font-size:12px">
                    ⚠️ الحفظ هيلغي سند التحصيل القديم تلقائياً (المبلغ يرجع لرصيد العميل والخزنة) ويسجّل سنداً جديداً بالبيانات المعدّلة — حفاظاً على سجل تاريخي كامل، بدل التعديل المباشر.
                </div>
                <div class="mod-form-group"><label>العميل *</label>
                    <div style="position:relative">
                        <input type="text" id="colEditCustSearch" class="mod-form-input" placeholder="🔍 اكتب اسم العميل / الهاتف / الكود..." autocomplete="off"
                            value="${p.customers?.name || _colCustomers.find(c=>c.id===p.customer_id)?.name || ''}"
                            oninput="colCustSearchInput('edit')" onfocus="colCustSearchInput('edit')" onkeydown="colCustACKey(event,'edit')"
                            onblur="setTimeout(()=>{const ac=document.getElementById('colEditCustAC'); if(ac) ac.classList.remove('show');},150)">
                        <input type="hidden" id="colEditCustId" value="${p.customer_id||''}">
                        <div class="inv-ac" id="colEditCustAC"></div>
                    </div>
                </div>
                <div class="mod-form-group"><label>المبلغ المحصّل (ج.م) *</label>
                    <input type="number" id="colEditAmount" class="mod-form-input" placeholder="0.00" step="0.01" dir="ltr" value="${Number(p.amount)||0}">
                </div>
                <div class="mod-form-group"><label>المرجع / البيان</label>
                    <input type="text" id="colEditRef" class="mod-form-input" value="${p.ref||''}">
                </div>
                <div class="mod-form-group"><label>الخزنة</label>
                    <select id="colEditTreasuryId" class="mod-form-input">
                        ${_colTreasuries.map(t => `<option value="${t.id}" ${t.id===p.treasury_id?'selected':(!p.treasury_id&&t.is_default?'selected':'')}>${t.name}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="colCloseModal('colEditModal')">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="colSaveEdit()">💾 حفظ التعديل</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
};

window.colSaveEdit = async function() {
    const oldId = _colEditingId;
    if (!oldId) return;
    const custId = document.getElementById('colEditCustId').value;
    const amount = parseFloat(document.getElementById('colEditAmount').value);
    const ref = document.getElementById('colEditRef').value.trim();
    const treasuryId = document.getElementById('colEditTreasuryId').value || null;
    if (!custId) return alert('اختر العميل');
    if (!amount || amount <= 0) return alert('أدخل مبلغاً صحيحاً');

    if (typeof isOnline === 'function' && !isOnline()) {
        alert('📴 تعديل سند تحصيل موجود محتاج اتصال بالإنترنت — حاول تاني لما الاتصال يرجع');
        return;
    }

    const btn = document.querySelector('#colEditModal .mod-btn-primary');
    btn.innerText = 'جاري الحفظ...'; btn.disabled = true;

    try {
        // 1) إلغاء السند القديم — UPDATE واحد ذرّي، الـ trigger بيرجّع
        //    الخزنة ورصيد العميل ويعكس القيد المحاسبي تلقائياً.
        const { error: cancelErr } = await sb.from('customer_payments').update({ status: 'cancelled' }).eq('id', oldId);
        if (cancelErr) throw cancelErr;

        // 2) تسجيل سند جديد بالبيانات المعدّلة (نفس مسار colSave العادي)
        const finalRef = await colUniqueRef(ref || 'COL-' + Date.now());
        const { error: insErr } = await sb.from('customer_payments').insert({
            ref: finalRef,
            customer_id: custId,
            amount,
            status: 'confirmed',
            treasury_id: treasuryId,
            created_by: currentUser?.id || null,
        });
        if (insErr) {
            // السند القديم اتلغى فعلاً (ورجع الرصيد/الخزنة) لكن السند
            // الجديد فشل — نوضّح للمستخدم إن الإلغاء تم بنجاح ومحتاج
            // يسجّل السند الصحيح يدوياً من "تحصيل دفعة جديدة".
            alert('⚠️ تم إلغاء السند القديم بنجاح (رجع المبلغ لرصيد العميل والخزنة)، لكن فشل تسجيل السند الجديد المعدّل: ' + insErr.message + '\n\nسجّل السند بالبيانات الصحيحة يدوياً من زرار "تحصيل دفعة جديدة".');
            colCloseModal('colEditModal');
            _colEditingId = null;
            renderCollections(document.getElementById('app-content'));
            return;
        }

        colCloseModal('colEditModal');
        _colEditingId = null;
        try {
            const { data: cash } = await sb.rpc('get_cash_balance');
            const tb = document.getElementById('topbarCash');
            if (tb) tb.textContent = '💰 ' + (cash || 0).toFixed(2) + ' ج.م';
        } catch {}
        renderCollections(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ أثناء تعديل التحصيل: ' + err.message);
    } finally {
        btn.innerText = '💾 حفظ التعديل'; btn.disabled = false;
    }
};

// ════════════════════════════════════════════════════════════
// 5) مزامنة عمليات التحصيل المعلّقة (Phase 1 — دعم الأوفلاين)
// ════════════════════════════════════════════════════════════
if (typeof registerSyncHandler === 'function') {
    registerSyncHandler('collection', async (entry) => {
        const { _estBalanceAfter, ...payload } = entry.payload;
        try {
            const { error } = await sb.from('customer_payments').insert(payload);
            if (error) return { ok: false, error: error.message, summary: `تحصيل ${payload.ref}` };

            const flags = [];
            try {
                const { data: freshCust } = await sb.from('customers').select('balance').eq('id', payload.customer_id).maybeSingle();
                if (freshCust && _estBalanceAfter != null) {
                    const diff = Math.abs((Number(freshCust.balance) || 0) - Number(_estBalanceAfter));
                    if (diff > 0.01) flags.push(`الرصيد الفعلي بعد المزامنة (${colFmt(freshCust.balance)}) يختلف عن التقدير وقت الأوفلاين (${colFmt(_estBalanceAfter)})`);
                }
            } catch {}

            return { ok: true, summary: `تحصيل ${payload.ref} — ${colFmt(payload.amount)} ج.م`, flags };
        } catch (err) {
            return { ok: false, error: err.message || String(err), summary: `تحصيل ${payload.ref}` };
        }
    });
}

// ════════════════════════════════════════════════════════════
// 4) أدوات مساعدة
// ════════════════════════════════════════════════════════════
window.colPrintVoucher = async function(id) {
    const p = _colList.find(x=>x.id===id);
    if (!p) return;
    const balanceAfter = (Number(p.customers?.balance)||0);
    const balanceBefore = balanceAfter + Number(p.amount);
    await printThermalReceipt('collection', {
        ref: p.ref, entityName: p.customers?.name || '—', amount: p.amount,
        entityBalanceBefore: balanceBefore, entityBalanceAfter: balanceAfter,
    });
};

function colFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
