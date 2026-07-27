/* ════════════════════════════════════════════════════════════
   كشف حساب المورد — suppliers
   قائمة الموردين نفسها اندمجت في master-data.js (بند 4، 2026-07-25) —
   الملف ده بقى مسؤول بس عن مودال كشف الحساب وكل تبويباته، اللي
   بيتفتح من زرار "📄 كشف حساب" فى شاشة "الموردين" الموحّدة.
   مصادر الحركة: purchases (آجل/نقدي) + supplier_payments (دفعات)
   ════════════════════════════════════════════════════════════ */

let _supStmtMoves = []; // الحركات الظاهرة حاليًا (بعد فلتر الفترة لو مطبّق) — عشان خانة البحث تفلتر منها من غير ما تعيد الحساب من القاعدة
let _supStmtItems = []; // تبويب الأصناف — إجمالي مشتريات من كل صنف (بعد فلتر الفترة)
let _supStmtTab = 'moves'; // 'moves' | 'items'
let _supStmtLegacyDiff = 0;
// ── فلتر الفترة (من/إلى تاريخ) — نفس منطق customers.js بالظبط، راجعه
//   للتفاصيل. الرصيد المتحرك بيتحسب مرة واحدة على كامل التاريخ، وبنفلتر
//   بعد كده client-side من غير أي استعلام إضافي.
let _supStmtId = null;
let _supStmtFrom = '';
let _supStmtTo = '';
let _supStmtAllMoves = [];
let _supStmtPurchaseItemRows = [];
let _supStmtPurchaseDateOf = {};
let _supStmtDocsHtml = '';

// ════════════════════════════════════════════════════════════
// كشف حساب مورد (مودال)
// ════════════════════════════════════════════════════════════
window.supShowStatement = async function(supplierId) {
    const { data: sup } = await sb.from('suppliers').select('*').eq('id', supplierId).single();
    if (!sup) return;

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'supStmtModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:820px">
            <div class="mod-modal-header"><h3>📄 كشف حساب — ${sup.name}</h3>
                <div style="display:flex;align-items:center;gap:10px">
                    <button class="cc-edit" style="background:${supThemeBg('#FFFBEB','#2E2410')};color:var(--inv-gold)" onclick="supGoEditProfile('${sup.id}')">✏️ تعديل بيانات المورد</button>
                    <button class="mod-modal-close" onclick="supCloseModal('supStmtModal')">&times;</button>
                </div></div>
            <div class="mod-modal-body" id="supStmtBody">
                <div class="empty-state"><span>⏳</span>جاري تجميع الحركات...</div>
            </div>
        </div>`;
    document.body.appendChild(modal);

    try {
        // جلب حركات المورد بالتوازي — ★ دلوقتي بتشمل فواتير الشراء النقدية
        // والمرتجعات كمان (كانوا ناقصين). purchase_returns معندهاش عمود
        // payment_type بتاعها، فبنجيبه من الفاتورة الأصلية المرتبطة
        // (purchase_id) لو موجودة — لو المرتجع مش مرتبط بفاتورة، بيتعامل
        // معه كمعلومة بس من غير أثر على الرصيد (أأمن اختيار من غير تخمين).
        const [
            { data: purchases },
            { data: payments },
            { data: returns },
            { data: transfersOut },
            { data: transfersIn },
            { data: cashRefunds },
            { data: openingBalances },
            docsResult,
        ] = await Promise.all([
            sb.from('purchases').select('id, invoice_no, total, payment_type, status, created_at')
                .eq('supplier_id', supplierId).order('created_at', { ascending: true }),
            sb.from('supplier_payments').select('ref, amount, status, created_at')
                .eq('supplier_id', supplierId).order('created_at', { ascending: true }),
            sb.from('purchase_returns').select('id, return_no, total, status, created_at, purchases(payment_type)')
                .eq('supplier_id', supplierId).order('created_at', { ascending: true }).limit(100),
            // تحويلات رصيد بين موردين + استرداد نقدي من رصيد مورد لخزنة — كانوا
            // ناقصين تمامًا من الكشف (راجع fn_balance_transfer_apply للاتجاهات)
            sb.from('balance_transfers').select('id, to_s:to_supplier_id(name), amount, notes, created_at')
                .eq('from_supplier_id', supplierId).eq('transfer_type', 'supplier_to_supplier')
                .order('created_at', { ascending: true }),
            sb.from('balance_transfers').select('id, from_s:from_supplier_id(name), amount, notes, created_at')
                .eq('to_supplier_id', supplierId).eq('transfer_type', 'supplier_to_supplier')
                .order('created_at', { ascending: true }),
            sb.from('balance_transfers').select('id, amount, notes, created_at')
                .eq('from_supplier_id', supplierId).eq('transfer_type', 'supplier_to_treasury')
                .order('created_at', { ascending: true }),
            sb.from('opening_balances').select('id, amount, as_of_date, notes')
                .eq('supplier_id', supplierId).eq('balance_type', 'supplier').eq('status', 'confirmed'),
            // اختياري — لو جدول archive_documents لسه ما اتعملش، نتجاهل الخطأ بهدوء
            sb.from('archive_documents').select('id,title,file_url,category,created_at')
                .eq('linked_type', 'supplier').eq('linked_id', supplierId)
                .order('created_at', { ascending: false }).then(r => r, () => ({ data: [] })),
        ]);
        const docs = docsResult?.data || [];

        // دمج الحركات + رصيد متحرك
        // منطق المورد: الشراء الآجل = دائن (لنا عليه)، الدفع = مدين (نسدده)،
        // مرتجع شراء آجل = مدين (بيقلل اللي علينا)
        const moves = [];
        (purchases||[]).forEach(p => {
            if (p.status !== 'confirmed') return;
            if (p.payment_type === 'credit') {
                moves.push({ date: p.created_at, desc: `فاتورة شراء ${p.invoice_no}`, debit: 0, credit: Number(p.total)||0, type: 'purchase-credit' });
            } else {
                moves.push({ date: p.created_at, desc: `فاتورة شراء نقدي ${p.invoice_no}`, debit: 0, credit: 0, type: 'purchase-cash' });
            }
        });
        (returns||[]).forEach(r => {
            if (r.status !== 'confirmed') return;
            if (r.purchases?.payment_type === 'credit') {
                moves.push({ date: r.created_at, desc: `مرتجع شراء ${r.return_no}`, debit: Number(r.total)||0, credit: 0, type: 'return-credit' });
            } else {
                moves.push({ date: r.created_at, desc: `مرتجع شراء ${r.return_no}`, debit: 0, credit: 0, type: 'return-cash' });
            }
        });
        (payments||[]).forEach(p => {
            if (p.status === 'confirmed') {
                moves.push({ date: p.created_at, desc: `سداد ${p.ref||''}`, debit: Number(p.amount)||0, credit: 0, type: 'payment' });
            }
        });
        // تحويل رصيد "من" المورد ده لمورد تاني: بيقلل رصيده — راجع
        // fn_balance_transfer_apply (balance = balance - amount للمصدر)
        (transfersOut||[]).forEach(t => {
            moves.push({ date: t.created_at, desc: `تحويل رصيد إلى ${t.to_s?.name || '—'}${t.notes ? ' — '+t.notes : ''}`, debit: Number(t.amount)||0, credit: 0, type: 'transfer-out' });
        });
        // تحويل رصيد "إلى" المورد ده من مورد تاني: بيزود رصيده
        (transfersIn||[]).forEach(t => {
            moves.push({ date: t.created_at, desc: `تحويل رصيد من ${t.from_s?.name || '—'}${t.notes ? ' — '+t.notes : ''}`, debit: 0, credit: Number(t.amount)||0, type: 'transfer-in' });
        });
        // استرداد نقدي من رصيد مورد للخزنة — راجع fn_balance_transfer_apply
        // (balance = balance + amount للمورد، supplier_to_treasury)
        (cashRefunds||[]).forEach(t => {
            moves.push({ date: t.created_at, desc: `استرداد نقدي لخزنة${t.notes ? ' — '+t.notes : ''}`, debit: 0, credit: Number(t.amount)||0, type: 'cash-refund' });
        });
        // رصيد افتتاحي — راجع fn_opening_balance_status_change (balance += amount)
        (openingBalances||[]).forEach(o => {
            const amt = Number(o.amount) || 0;
            moves.push({ date: o.as_of_date, desc: `رصيد افتتاحي${o.notes ? ' — '+o.notes : ''}`, debit: Math.max(-amt,0), credit: Math.max(amt,0), type: 'opening' });
        });
        moves.sort((a,b) => new Date(a.date) - new Date(b.date));

        // تبويب "الأصناف" — بند 5، 2026-07-25. إجمالي المشتريات من كل صنف
        // من نفس المورد (إجمالي، بدون خصم مرتجعات — تفاصيلها فى تبويب الحركات).
        const confirmedPurchaseIds = (purchases||[]).filter(p=>p.status==='confirmed').map(p=>p.id);
        const purchaseDateOf = {}; (purchases||[]).forEach(p=>{ purchaseDateOf[p.id] = p.created_at; });
        const { data: purchaseItemRows } = confirmedPurchaseIds.length
            ? await sb.from('purchase_items').select('purchase_id, product_id, qty, line_total, products(name,unit)').in('purchase_id', confirmedPurchaseIds)
            : { data: [] };

        const balNow = Number(sup.balance)||0;
        const totalDebit = moves.reduce((s,m)=>s+m.debit,0);   // المدفوع للمورد
        const totalCredit = moves.reduce((s,m)=>s+m.credit,0); // المشتريات الآجلة

        // ★ نفس الحل الجذري المستخدم فى كشف حساب العميل (customers.js) —
        //   موردين منقولين من نظام قديم برصيد مباشر من غير تاريخ عمليات
        //   وراه. سطر صناعي واحد يصالح الرصيد المتحرك مع suppliers.balance
        //   الحقيقي، من غير أي لمس لقاعدة البيانات.
        const displayMoves = [...moves];
        const rawTotal = moves.reduce((s,m)=>s+(m.credit-m.debit),0);
        const legacyDiff = balNow - rawTotal;
        if (Math.abs(legacyDiff) > 0.01) {
            // لازم يتحط قبل أول حركة حقيقية زمنيًا — مش وقت إنشاء سجل المورد
            // نفسه فى سلطان (وقت الهجرة)، راجع نفس الملاحظة فى customers.js
            const earliestDate = moves.length ? new Date(new Date(moves[0].date).getTime() - 1000).toISOString() : (sup.created_at || new Date(0).toISOString());
            displayMoves.push({
                date: earliestDate,
                desc: 'رصيد مرحّل من النظام القديم (قبل سلطان)',
                debit: Math.max(-legacyDiff, 0), credit: Math.max(legacyDiff, 0),
                type: 'legacy-carry',
            });
        }
        displayMoves.sort((a,b) => new Date(a.date) - new Date(b.date));

        let running = 0;
        displayMoves.forEach(m => { running += (m.credit - m.debit); m.balance = running; });
        const tableDebit = displayMoves.reduce((s,m)=>s+m.debit,0);
        const tableCredit = displayMoves.reduce((s,m)=>s+m.credit,0);

        _supStmtId = supplierId;
        _supStmtAllMoves = displayMoves;
        _supStmtLegacyDiff = legacyDiff;
        _supStmtFrom = ''; _supStmtTo = '';
        _supStmtPurchaseItemRows = purchaseItemRows || [];
        _supStmtPurchaseDateOf = purchaseDateOf;
        window._supStmtSupName = sup.name;
        window._supStmtBalNow = balNow;

        _supStmtDocsHtml = `<div style="margin-top:16px">
                <div style="font-size:13px;font-weight:800;color:var(--inv-navy);margin-bottom:8px">📁 المستندات المرتبطة (${docs.length})</div>
                ${docs.length === 0 ? `<div style="font-size:12.5px;color:var(--inv-muted-light)">لا توجد مستندات مرتبطة بهذا المورد في الأرشيف.</div>` :
                `<div style="display:flex;flex-wrap:wrap;gap:8px">
                    ${docs.map(d => `<a href="${d.file_url}" target="_blank" rel="noopener" class="cc-edit" style="background:${supThemeBg('#FFFBEB','#2E2410')};color:var(--inv-gold);text-decoration:none">📄 ${d.title}${d.category?' ('+d.category+')':''}</a>`).join('')}
                </div>`}
            </div>`;

        supStmtRecomputeAndRender();
    } catch (err) {
        document.getElementById('supStmtBody').innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:16px;border-radius:10px">خطأ: ${err.message}</div>`;
    }
};

// ════════════════════════════════════════════════════════════
// إعادة حساب الحركات/الأصناف بعد فلتر الفترة، وإعادة رسم المودال —
// نفس منطق customers.js's custStmtRecomputeAndRender بالظبط.
// ════════════════════════════════════════════════════════════
function supStmtRecomputeAndRender() {
    const from = _supStmtFrom, to = _supStmtTo;
    let opening = 0;
    let filtered = _supStmtAllMoves;
    if (from) {
        const fromTime = new Date(from).getTime();
        const before = _supStmtAllMoves.filter(m => new Date(m.date).getTime() < fromTime);
        opening = before.length ? before[before.length - 1].balance : 0;
        filtered = _supStmtAllMoves.filter(m => new Date(m.date).getTime() >= fromTime);
    }
    if (to) {
        const toTime = new Date(to + 'T23:59:59').getTime();
        filtered = filtered.filter(m => new Date(m.date).getTime() <= toTime);
    }
    // ملحوظة: منطق المورد للمدين/الدائن معكوس بالنسبة للعميل (راجع فوق) —
    // رصيد افتتاحي دائن هنا معناه opening موجب (مستحق عليه لنا)
    const periodMoves = from
        ? [{ date: from, desc: 'الرصيد الافتتاحي لبداية الفترة', debit: Math.max(-opening,0), credit: Math.max(opening,0), type: 'opening', balance: opening }, ...filtered]
        : filtered;

    const tableDebit = filtered.reduce((s,m)=>s+m.debit,0);
    const tableCredit = filtered.reduce((s,m)=>s+m.credit,0);
    const closingBalance = periodMoves.length ? periodMoves[periodMoves.length-1].balance : opening;

    const inRange = (iso) => {
        if (!iso) return false;
        const t = new Date(iso).getTime();
        if (from && t < new Date(from).getTime()) return false;
        if (to && t > new Date(to + 'T23:59:59').getTime()) return false;
        return true;
    };
    const itemsMap = {};
    _supStmtPurchaseItemRows.forEach(it => {
        if (!inRange(_supStmtPurchaseDateOf[it.purchase_id])) return;
        const key = it.product_id;
        if (!itemsMap[key]) itemsMap[key] = { name: it.products?.name || '—', unit: it.products?.unit || '', qty: 0, total: 0 };
        itemsMap[key].qty += Number(it.qty)||0;
        itemsMap[key].total += Number(it.line_total)||0;
    });
    _supStmtItems = Object.values(itemsMap).sort((a,b)=>b.total-a.total);

    _supStmtMoves = periodMoves;
    _supStmtTab = _supStmtTab || 'moves';
    window._supStmtTotals = { balNow: window._supStmtBalNow, totalDebit: tableDebit, totalCredit: tableCredit, tableDebit, tableCredit, closingBalance, isFiltered: !!(from || to) };

    const balNow = window._supStmtBalNow;
    document.getElementById('supStmtBody').innerHTML = `
        <div class="dash-card" style="padding:12px 14px;margin-bottom:14px">
            <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
                <div><label class="ob-label">من تاريخ</label><input type="date" id="supStmtFrom" class="ob-input" style="margin:0" value="${_supStmtFrom}"></div>
                <div><label class="ob-label">إلى تاريخ</label><input type="date" id="supStmtTo" class="ob-input" style="margin:0" value="${_supStmtTo}"></div>
                <button class="ob-add-btn" onclick="supStmtApplyDateFilter()">🔍 تطبيق</button>
                ${(_supStmtFrom || _supStmtTo) ? `<button class="mod-btn" style="background:#F1F5F9;color:var(--inv-text-soft)" onclick="supStmtClearDateFilter()">✕ كل الفترة</button>` : ''}
            </div>
        </div>

        <div class="mod-grid" style="margin-bottom:16px">
            <div class="mod-card" style="padding:14px">
                <div style="font-size:11px;color:var(--inv-muted);margin-bottom:4px">المستحق حالياً</div>
                <div style="font-size:22px;font-weight:800;color:${balNow>0?'var(--inv-red)':'var(--inv-green)'}">${supFmt(Math.abs(balNow))} ج.م</div>
                <div style="font-size:11.5px;color:var(--inv-muted-light)">${balNow>0?'مستحق عليه لنا':balNow<0?'لنا عنده (مقدم)':'مسدد'}</div>
            </div>
            <div class="mod-card" style="padding:14px">
                <div style="font-size:11px;color:var(--inv-muted);margin-bottom:4px">${window._supStmtTotals.isFiltered ? 'مشتريات الفترة (آجل)' : 'إجمالي المشتريات (آجل)'}</div>
                <div style="font-size:22px;font-weight:800;color:var(--inv-text)">${supFmt(tableCredit)}</div>
            </div>
            <div class="mod-card" style="padding:14px">
                <div style="font-size:11px;color:var(--inv-muted);margin-bottom:4px">${window._supStmtTotals.isFiltered ? 'مدفوعات الفترة' : 'إجمالي المدفوع'}</div>
                <div style="font-size:22px;font-weight:800;color:var(--inv-green)">${supFmt(tableDebit)}</div>
            </div>
        </div>

        <div class="ob-tabs" style="margin-bottom:12px">
            <button class="ob-tab ${_supStmtTab==='moves'?'active':''}" onclick="supStmtSwitchTab('moves')">📋 الحركات</button>
            <button class="ob-tab ${_supStmtTab==='items'?'active':''}" onclick="supStmtSwitchTab('items')">📦 الأصناف</button>
        </div>
        <div id="supStmtTabBody">${supStmtMovesTabHtml()}</div>
        ${_supStmtDocsHtml}`;
}

window.supStmtApplyDateFilter = function () {
    _supStmtFrom = document.getElementById('supStmtFrom')?.value || '';
    _supStmtTo = document.getElementById('supStmtTo')?.value || '';
    supStmtRecomputeAndRender();
};
window.supStmtClearDateFilter = function () {
    _supStmtFrom = ''; _supStmtTo = '';
    supStmtRecomputeAndRender();
};

window.supCloseModal = function(id) { const m = document.getElementById(id); if (m) m.remove(); };

// بناء صفوف جدول كشف الحساب — دالة منفصلة عشان تتنادى من العرض الأول
// ومن supStmtFilterRows (البحث) من غير تكرار كود
function supStmtRowsHtml(moves) {
    if (!moves.length) return `<tr><td colspan="5" class="empty-state"><span>📭</span>لا توجد حركات.</td></tr>`;
    return moves.map(m => {
        const isCash = m.type.endsWith('-cash');
        const bg = m.type==='purchase-credit' ? supThemeBg('#FEF3C7','#2E2410') : m.type==='payment' ? supThemeBg('#ECFDF5','#123024')
            : m.type.startsWith('return') ? supThemeBg('#FFFBEB','#2E2410')
            : m.type==='transfer-out' || m.type==='transfer-in' || m.type==='cash-refund' ? supThemeBg('#EFF6FF','#16233A')
            : m.type==='opening' ? supThemeBg('#F5F3FF','#241A3D')
            : m.type==='legacy-carry' ? supThemeBg('#F1F5F9','#131A26') : supThemeBg('#F8FAFC','#131A26');
        const icon = m.type==='purchase-credit' ? '<span style="color:var(--inv-gold)">📥</span>'
            : m.type==='purchase-cash' ? '<span style="color:var(--inv-muted-light)">💰</span>'
            : m.type.startsWith('return') ? '<span style="color:var(--inv-red)">↩️</span>'
            : m.type==='transfer-out' || m.type==='transfer-in' ? '<span style="color:#2563EB">🔀</span>'
            : m.type==='cash-refund' ? '<span style="color:#2563EB">💰</span>'
            : m.type==='opening' ? '<span style="color:#7C3AED">📋</span>'
            : m.type==='legacy-carry' ? '<span style="color:var(--inv-muted)">🗄️</span>'
            : '<span style="color:var(--inv-green)">💸</span>';
        return `<tr style="background:${bg}">
        <td style="font-size:12px">${new Date(m.date).toLocaleDateString('ar-EG')}</td>
        <td>
            ${icon} ${m.desc}
            ${isCash ? '<span style="font-size:11.5px;color:var(--inv-muted-light)"> (نقدي — بدون أثر على الرصيد)</span>' : ''}
        </td>
        <td style="text-align:left;font-weight:600;color:var(--inv-green)">${m.debit?supFmt(m.debit):'—'}</td>
        <td style="text-align:left;font-weight:600;color:var(--inv-gold)">${m.credit?supFmt(m.credit):'—'}</td>
        <td style="text-align:left;font-weight:700">${supFmt(m.balance)}</td>
    </tr>`;
    }).join('');
}

window.supStmtFilterRows = function(query) {
    const q = (query || '').trim().toLowerCase();
    const filtered = q ? _supStmtMoves.filter(m => (m.desc || '').toLowerCase().includes(q)) : _supStmtMoves;
    const tbody = document.getElementById('supStmtTbody');
    if (tbody) tbody.innerHTML = supStmtRowsHtml(filtered);
};

// ════════════════════════════════════════════════════════════
// 2ب) تبويبات كشف الحساب الفرعية — بند 5، 2026-07-25
// ════════════════════════════════════════════════════════════
window.supStmtSwitchTab = function (tab) {
    _supStmtTab = tab;
    document.querySelectorAll('#supStmtBody .ob-tabs .ob-tab').forEach((b,i) => {
        b.classList.toggle('active', ['moves','items'][i] === tab);
    });
    const body = document.getElementById('supStmtTabBody');
    if (!body) return;
    body.innerHTML = tab === 'moves' ? supStmtMovesTabHtml() : supStmtItemsTabHtml();
};

function supStmtMovesTabHtml() {
    const t = window._supStmtTotals || {};
    return `
        <input type="text" id="supStmtSearch" class="mod-form-input" style="margin-bottom:10px" placeholder="🔍 بحث في الحركات (اسم الفاتورة/المرتجع/البيان)..." oninput="supStmtFilterRows(this.value)">
        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>التاريخ</th><th>البيان</th>
                <th style="text-align:left">مدين (مدفوع)</th>
                <th style="text-align:left">دائن (شراء)</th>
                <th style="text-align:left">الرصيد</th>
            </tr></thead>
            <tbody id="supStmtTbody">${supStmtRowsHtml(_supStmtMoves)}</tbody>
            ${_supStmtMoves.length ? `<tfoot><tr style="background:${supThemeBg('#F8FAFC','#131A26')};font-weight:800">
                <td colspan="2">${t.isFiltered ? 'إجمالي الفترة' : 'الإجمالي'}</td>
                <td style="text-align:left;color:var(--inv-green)">${supFmt(t.tableDebit)}</td>
                <td style="text-align:left;color:var(--inv-gold)">${supFmt(t.tableCredit)}</td>
                <td style="text-align:left">${supFmt(Math.abs(t.closingBalance||0))}</td>
            </tr></tfoot>` : ''}
            </table>
        </div>
        ${!t.isFiltered && Math.abs(_supStmtLegacyDiff) > 0.01 ? `
        <div style="background:var(--inv-divider);border:1px solid var(--inv-border);color:var(--inv-text-soft);padding:10px 14px;border-radius:10px;margin-top:10px;font-size:12px">
            🗄️ سطر "رصيد مرحّل من النظام القديم" (${supFmt(Math.abs(_supStmtLegacyDiff))}) هو الفرق بين رصيد المورد الحقيقي وحركاته المسجّلة فعليًا فى سلطان —
            غالبًا مورد منقول من نظام قديم برصيد بداية من غير تفاصيل مستندات. رصيد المورد نفسه صحيح، السطر ده للعرض بس ومفيهوش أي تعديل على البيانات.
        </div>` : ''}`;
}

function supStmtItemsTabHtml() {
    if (!_supStmtItems.length) return `<div class="empty-state"><span>📦</span>مفيش أي أصناف مسجّلة لهذا المورد.</div>`;
    const totalQty = _supStmtItems.reduce((s,i)=>s+i.qty,0);
    const totalVal = _supStmtItems.reduce((s,i)=>s+i.total,0);
    return `<div class="mod-table-wrap"><table class="mod-table"><thead><tr>
        <th>الصنف</th><th>الوحدة</th><th style="text-align:left">الكمية</th><th style="text-align:left">متوسط السعر</th><th style="text-align:left">إجمالي القيمة</th>
    </tr></thead><tbody>
        ${_supStmtItems.map(i => `<tr>
            <td style="font-weight:600">${i.name}</td>
            <td style="color:var(--inv-muted)">${i.unit||'—'}</td>
            <td style="text-align:left">${supFmt(i.qty)}</td>
            <td style="text-align:left;color:var(--inv-muted)">${supFmt(i.qty ? i.total/i.qty : 0)}</td>
            <td style="text-align:left;font-weight:700">${supFmt(i.total)}</td>
        </tr>`).join('')}
    </tbody><tfoot><tr style="background:${supThemeBg('#F8FAFC','#131A26')};font-weight:800">
        <td colspan="2">الإجمالي</td><td style="text-align:left">${supFmt(totalQty)}</td><td></td><td style="text-align:left">${supFmt(totalVal)}</td>
    </tr></tfoot></table></div>
    <div style="font-size:11.5px;color:var(--inv-muted-light);margin-top:8px">إجمالي المشتريات منه (إجمالي، قبل خصم المرتجعات — تفاصيل المرتجعات فى تبويب "الحركات").</div>`;
}

// ينقل لصفحة "إدارة الموردين" (master-data.js) ويفتح نافذة تعديل بيانات
// نفس المورد تلقائياً — نفس فكرة custGoEditProfile في customers.js.
window.supGoEditProfile = function(supplierId) {
    window._pendingSupplierEdit = supplierId;
    window._pendingSuppHubTab = 'manage';
    supCloseModal('supStmtModal');
    document.querySelector('[data-mod="suppliers-hub"]')?.click();
};

// ════════════════════════════════════════════════════════════
// 3) أدوات مساعدة
// ════════════════════════════════════════════════════════════
function supFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// راجع custThemeBg فى customers.js — نفس الفكرة بالظبط.
function supThemeBg(light, dark) { return (typeof window.themeIsDark === 'function' && window.themeIsDark()) ? dark : light; }
