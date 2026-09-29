/* ════════════════════════════════════════════════════════════
   كشف حساب العميل — customers
   قائمة العملاء نفسها اندمجت في master-data.js (بند 4، 2026-07-25) —
   الملف ده بقى مسؤول بس عن مودال كشف الحساب وكل تبويباته، اللي
   بيتفتح من زرار "📄 كشف حساب" فى شاشة "العملاء" الموحّدة.
   مصادر الحركة: sales (آجل/نقدي) + customer_payments (تحصيلات)
   ════════════════════════════════════════════════════════════ */

// ════════════════════════════════════════════════════════════
// أدوات كشف حساب عميل (بند 2026-09-21) — حالة الاستحقاق، الحد
// الائتماني، أعمار المديونية، الدفعة المستهدفة، وواتساب. دوال
// صافية بادئتها custDet عشان ما تتعارضش مع أي حاجة موجودة.
// ════════════════════════════════════════════════════════════
function custDetToday() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function custDetDate(s) { return s ? new Date(String(s).slice(0, 10) + 'T00:00:00') : null; }
function custDetAgo(days) { return days <= 0 ? 'النهارده' : days === 1 ? 'أمس' : 'منذ ' + days + ' يوم'; }

function custDetDueStatus(balance, dueStr, today) {
    if (!(Number(balance) > 0.005)) return { key: 'none', label: '—' };
    const due = custDetDate(dueStr);
    if (!due) return { key: 'nodue', label: 'بدون ميعاد' };
    const diff = Math.round((today - due) / 86400000);
    if (diff > 0) return { key: 'late', label: 'متأخر ' + diff + ' يوم' };
    if (diff >= -7) return { key: 'soon', label: diff === 0 ? 'يستحق النهارده' : 'خلال ' + (-diff) + ' أيام' };
    return { key: 'ok', label: 'قادم — ' + dueStr };
}
function custDetLimitState(balance, limit) {
    const bal = Number(balance) || 0, lim = Number(limit) || 0;
    if (bal <= 0.005) return { key: 'none', over: 0 };
    if (lim <= 0) return { key: 'nolimit', over: 0 };
    return bal > lim ? { key: 'over', over: bal - lim } : { key: 'within', over: 0 };
}
// أعمار المديونية بافتراض إن السداد بيغطي الأقدم أول (FIFO) — نفس منطق
// شاشة "أرصدة العملاء"، وأي جزء بدون فاتورة يتحسب في "+90/افتتاحي".
function custDetAging(balance, sales, nowMs) {
    const out = { b30: 0, b60: 0, b90: 0, b90p: 0 };
    let remaining = Number(balance) || 0;
    if (remaining <= 0.005) return out;
    const inv = (sales || []).filter(s => s.status === 'confirmed' && s.payment_type === 'credit').slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    for (const i of inv) {
        if (remaining <= 0.005) break;
        const take = Math.min(Number(i.total) || 0, remaining);
        if (take <= 0) continue;
        remaining -= take;
        const age = Math.floor((nowMs - new Date(i.created_at).getTime()) / 86400000);
        if (age <= 30) out.b30 += take; else if (age <= 60) out.b60 += take; else if (age <= 90) out.b90 += take; else out.b90p += take;
    }
    if (remaining > 0.005) out.b90p += remaining;
    return out;
}
function custDetPeriodStart(sched, nowMs) {
    const d = new Date(nowMs);
    if (sched === 'weekly') return nowMs - 7 * 86400000;
    if (sched === 'monthly') return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function custDetSchedLabel(s) { return s === 'weekly' ? 'أسبوعي' : s === 'monthly' ? 'شهري' : 'يومي'; }
function custDetWaLink(phone) {
    let d = String(phone || '').replace(/\D/g, ''); if (!d) return '';
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('0')) d = '20' + d.slice(1); else if (!d.startsWith('20')) d = '20' + d;
    return 'https://wa.me/' + d;
}
function custDetBadge(key, text) {
    const map = {
        late: ['#FEE4E2', '#B42318'], soon: ['#FFEDD5', '#B54708'], nodue: ['#FEF3C7', '#8A6100'], ok: ['#D1FADF', '#067647'],
        none: ['#F1F5F9', '#64748B'], over: ['#FEE4E2', '#B42318'], nolimit: ['#FEF3C7', '#8A6100'], within: ['#D1FADF', '#067647'],
        done: ['#D1FADF', '#067647'], part: ['#FFEDD5', '#B54708'], miss: ['#FEE4E2', '#B42318']
    };
    const c = map[key] || map.none;
    return '<span style="display:inline-block;padding:1px 9px;border-radius:999px;font-size:11.5px;font-weight:700;background:' + c[0] + ';color:' + c[1] + ';white-space:nowrap">' + custDetEsc(text) + '</span>';
}
function custDetEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
function custDetBar(pct, color) { return '<div style="height:6px;border-radius:99px;background:var(--inv-border);margin-top:6px;overflow:hidden"><div style="height:100%;width:' + Math.max(0, Math.min(100, pct)) + '%;background:' + color + '"></div></div>'; }

let _custStmtMoves = []; // الحركات الظاهرة حاليًا (بعد فلتر الفترة لو مطبّق) — عشان خانة البحث تفلتر منها من غير ما تعيد الحساب من القاعدة
let _custStmtItems = []; // تبويب الأصناف — إجمالي مشتريات العميل من كل صنف (بعد فلتر الفترة)
let _custStmtProfit = []; // تبويب المكسب الشهري — آخر 12 شهر (مش متأثر بفلتر الفترة، تقرير trailing-12-month بطبيعته)
let _custStmtTab = 'moves'; // 'moves' | 'items' | 'profit'
let _custStmtLegacyDiff = 0;
// ── فلتر الفترة (من/إلى تاريخ) — بند 2026-07-28. بنحسب كل الحركات
//   والرصيد المتحرك مرة واحدة على كامل التاريخ (زي ما كان)، وبنفلتر
//   بعد كده على الجهاز نفسه من غير أي استعلام إضافي لقاعدة البيانات —
//   الرصيد المتحرك المحسوب أصلًا بيدّينا "الرصيد الافتتاحي للفترة" مجانًا
//   (رصيد آخر حركة قبل "من تاريخ" مباشرة).
let _custStmtId = null;
let _custStmtFrom = '';
let _custStmtTo = '';
let _custStmtAllMoves = []; // كل الحركات (بدون فلتر) بترتيب زمني ورصيد متحرك كامل
let _custStmtSaleItemRows = [];
let _custStmtReturnItemRows = [];
let _custStmtSaleDateOf = {};
let _custStmtReturnDateOf = {};
let _custStmtDocsHtml = '';
let _custStmtInteractionsCount = 0;

// ════════════════════════════════════════════════════════════
// كشف حساب عميل (مودال)
// ════════════════════════════════════════════════════════════
window.custShowStatement = async function(customerId) {
    const { data: cust } = await sb.from('customers').select('*').eq('id', customerId).single();
    if (!cust) return;

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'custStmtModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:900px">
            <div class="mod-modal-header" style="align-items:flex-start">
                <div>
                    <h3>📄 كشف حساب — ${custDetEsc(cust.name)}${cust.debt_locked ? ' 🔒' : ''}</h3>
                    <div style="font-size:12.5px;color:var(--inv-muted);margin-top:4px;display:flex;flex-wrap:wrap;gap:6px;align-items:center" id="custStmtBadges"></div>
                </div>
                <div style="display:flex;align-items:center;gap:10px">
                    <button class="cc-edit" style="background:${custThemeBg('var(--inv-gold-bg)','#2E2410')};color:var(--inv-gold)" onclick="custGoEditProfile('${cust.id}')">✏️ تعديل بيانات العميل</button>
                    <button class="cc-edit" onclick="custRedeemLoyalty('${cust.id}', ${Number(cust.loyalty_points_balance) || 0})">🎁 نقاط: ${Number(cust.loyalty_points_balance) || 0}</button>
                    <button class="mod-modal-close" onclick="custCloseModal('custStmtModal')">&times;</button>
                </div></div>
            <div class="mod-modal-body" id="custStmtBody">
                <div class="empty-state"><span>⏳</span>جاري تجميع الحركات...</div>
            </div>
        </div>`;
    document.body.appendChild(modal);

    try {
        // جلب كل حركات العميل بالتوازي — ★ دلوقتي بتشمل الفواتير النقدية
        // والمرتجعات كمان (كانوا ناقصين، فالمستخدم كان لازم يدوّر عليهم
        // في شاشة تانية) — النقدي بيظهر للمراجعة بس من غير أثر على
        // الرصيد المتحرك (لأنه اتقبض وقتها فعلاً).
        // ★★ وكمان تحويلات الأرصدة (balance_transfers) والأرصدة الافتتاحية
        // (opening_balances) — كانوا ناقصين خالص من الكشف، فلو عميل كان
        // طرف في تحويل رصيد أو له رصيد افتتاحي، الرصيد المتحرك جوه الكشف
        // كان بيختلف عن رصيده الحقيقي (customers.balance) من غير أي تفسير،
        // وده بالظبط سبب "الكشف مش مظبوط" اللي اتلاحظ.
        const [
            { data: sales },
            { data: payments },
            { data: returns },
            { data: transfersOut },
            { data: transfersIn },
            { data: openingBalances },
            docsResult,
            interactionsResult,
            groupRes, clsRes, regRes, repRes,
        ] = await Promise.all([
            sb.from('sales').select('id, invoice_no, total, payment_type, status, created_at')
                .eq('customer_id', customerId).order('created_at', { ascending: true }),
            sb.from('customer_payments').select('id, ref, amount, status, created_at')
                .eq('customer_id', customerId).order('created_at', { ascending: true }).limit(100),
            sb.from('sales_returns').select('id, return_no, total, payment_type, status, created_at')
                .eq('customer_id', customerId).order('created_at', { ascending: true }).limit(100),
            sb.from('balance_transfers').select('id, to_c:to_customer_id(name), amount, notes, created_at')
                .eq('from_customer_id', customerId).eq('transfer_type', 'customer_to_customer')
                .order('created_at', { ascending: true }),
            sb.from('balance_transfers').select('id, from_c:from_customer_id(name), amount, notes, created_at')
                .eq('to_customer_id', customerId).eq('transfer_type', 'customer_to_customer')
                .order('created_at', { ascending: true }),
            sb.from('opening_balances').select('id, amount, as_of_date, notes')
                .eq('customer_id', customerId).eq('balance_type', 'customer').eq('status', 'confirmed'),
            // اختياري — لو جدول archive_documents لسه ما اتعملش، نتجاهل الخطأ بهدوء
            sb.from('archive_documents').select('id,title,file_url,category,created_at')
                .eq('linked_type', 'customer').eq('linked_id', customerId)
                .order('created_at', { ascending: false }).then(r => r, () => ({ data: [] })),
            // اختياري — لو جدول customer_interactions لسه ما اتعملش، نتجاهل الخطأ بهدوء
            sb.from('customer_interactions').select('id,type,notes,interaction_date,next_follow_up_date,is_done,sales_reps(name),archive_documents(title,file_url)')
                .eq('customer_id', customerId)
                .order('interaction_date', { ascending: false }).then(r => r, () => ({ data: [] })),
            cust.group_id ? sb.from('customer_groups').select('name').eq('id', cust.group_id).single().then(r => r, () => ({ data: null })) : Promise.resolve({ data: null }),
            cust.classification_id ? sb.from('customer_classifications').select('name').eq('id', cust.classification_id).single().then(r => r, () => ({ data: null })) : Promise.resolve({ data: null }),
            cust.region_id ? sb.from('customer_regions').select('name').eq('id', cust.region_id).single().then(r => r, () => ({ data: null })) : Promise.resolve({ data: null }),
            (cust.default_rep_id || cust.primary_rep_id) ? sb.from('sales_reps').select('name').eq('id', cust.default_rep_id || cust.primary_rep_id).single().then(r => r, () => ({ data: null })) : Promise.resolve({ data: null }),
        ]);
        // ── بطاقة تفاصيل العميل: حد ائتماني/استحقاق/أعمار/دفعة مستهدفة (بند 2026-09-21) ──
        const custDetNow = Date.now(), custDetTodayD = custDetToday();
        window._custStmtDetails = {
            phone: cust.phone || '', group: groupRes?.data?.name || '', cls: clsRes?.data?.name || '', region: regRes?.data?.name || '',
            rep: repRes?.data?.name || '', locked: !!cust.debt_locked, limit: Number(cust.credit_limit) || 0,
            due: custDetDueStatus(Number(cust.balance) || 0, cust.payment_due_date, custDetTodayD), dueDate: cust.payment_due_date || '',
            lim: custDetLimitState(Number(cust.balance) || 0, cust.credit_limit),
            aging: custDetAging(Number(cust.balance) || 0, sales || [], custDetNow),
            target: Number(cust.daily_payment_target) || 0, sched: cust.payment_schedule || 'daily',
        };
        {
            const from = custDetPeriodStart(window._custStmtDetails.sched, custDetNow);
            window._custStmtDetails.collected = (payments || []).reduce((s, p) => (p.status === 'confirmed' && new Date(p.created_at).getTime() >= from) ? s + (Number(p.amount) || 0) : s, 0);
            const confirmedPays = (payments || []).filter(p => p.status === 'confirmed').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            window._custStmtDetails.lastPay = confirmedPays[0] || null;
        }
        const docs = docsResult?.data || [];
        const interactions = interactionsResult?.data || [];

        // دمج الحركات في timeline واحد + حساب الرصيد المتحرك — كل حركة معاها
        // nav (نوع + مرجع) عشان أيقونة الانتقال المباشر للمعاملة تحت
        const moves = [];
        (sales||[]).forEach(s => {
            if (s.status !== 'confirmed') return;
            if (s.payment_type === 'credit') {
                moves.push({ date: s.created_at, desc: `فاتورة بيع ${s.invoice_no}`, debit: Number(s.total)||0, credit: 0, type: 'sale-credit', nav: { kind: 'sale', no: s.invoice_no } });
            } else {
                // نقدي: بيتقيّد للمراجعة بس مالوش أثر على الرصيد (اتقبض وقتها)
                moves.push({ date: s.created_at, desc: `فاتورة بيع نقدي ${s.invoice_no}`, debit: 0, credit: 0, type: 'sale-cash', nav: { kind: 'sale', no: s.invoice_no } });
            }
        });
        (returns||[]).forEach(r => {
            if (r.status !== 'confirmed') return;
            if (r.payment_type === 'credit') {
                moves.push({ date: r.created_at, desc: `مرتجع بيع ${r.return_no}`, debit: 0, credit: Number(r.total)||0, type: 'return-credit', nav: { kind: 'return', no: r.return_no } });
            } else {
                moves.push({ date: r.created_at, desc: `مرتجع بيع نقدي ${r.return_no}`, debit: 0, credit: 0, type: 'return-cash', nav: { kind: 'return', no: r.return_no } });
            }
        });
        (payments||[]).forEach(p => {
            if (p.status === 'confirmed') {
                moves.push({ date: p.created_at, desc: `تحصيل ${p.ref||''}`, debit: 0, credit: Number(p.amount)||0, type: 'payment', nav: { kind: 'payment', id: p.id } });
            }
        });
        // تحويل رصيد "من" العميل ده لعميل تاني: بيقلل رصيده (دائن) — راجع
        // fn_balance_transfer_apply (balance = balance - amount للمصدر)
        (transfersOut||[]).forEach(t => {
            moves.push({ date: t.created_at, desc: `تحويل رصيد إلى ${t.to_c?.name || '—'}${t.notes ? ' — '+t.notes : ''}`, debit: 0, credit: Number(t.amount)||0, type: 'transfer-out', nav: { kind: 'transfer' } });
        });
        // تحويل رصيد "إلى" العميل ده من عميل تاني: بيزود رصيده (مدين)
        (transfersIn||[]).forEach(t => {
            moves.push({ date: t.created_at, desc: `تحويل رصيد من ${t.from_c?.name || '—'}${t.notes ? ' — '+t.notes : ''}`, debit: Number(t.amount)||0, credit: 0, type: 'transfer-in', nav: { kind: 'transfer' } });
        });
        // رصيد افتتاحي — راجع fn_opening_balance_status_change (balance += amount)،
        // فمبلغ سالب (نادر) معناه رصيد افتتاحي دائن، بنقسمه مدين/دائن حسب إشارته
        (openingBalances||[]).forEach(o => {
            const amt = Number(o.amount) || 0;
            moves.push({ date: o.as_of_date, desc: `رصيد افتتاحي${o.notes ? ' — '+o.notes : ''}`, debit: Math.max(amt,0), credit: Math.max(-amt,0), type: 'opening', nav: { kind: 'opening' } });
        });
        moves.sort((a,b) => new Date(a.date) - new Date(b.date));

        // ═══ تبويبات "الأصناف" و"المكسب الشهري" — بند 5 (كشف حساب احترافي)،
        // 2026-07-25. بنستخدم أرقام الفواتير/المرتجعات المؤكدة اللي جبناها
        // فوق عشان نجيب بنود كل واحدة فيها (سطر بسطر)، بدل استعلام تاني
        // على sales/sales_returns.
        const confirmedSaleIds = (sales||[]).filter(s=>s.status==='confirmed').map(s=>s.id);
        const confirmedReturnIds = (returns||[]).filter(r=>r.status==='confirmed').map(r=>r.id);
        const saleDateOf = {}; (sales||[]).forEach(s=>{ saleDateOf[s.id] = s.created_at; });
        const returnDateOf = {}; (returns||[]).forEach(r=>{ returnDateOf[r.id] = r.created_at; });

        const [{ data: saleItemRows }, { data: returnItemRows }] = await Promise.all([
            confirmedSaleIds.length
                ? sb.from('sale_items').select('sale_id, product_id, qty, line_total, cost_price_snapshot, products(name,unit)').in('sale_id', confirmedSaleIds)
                : Promise.resolve({ data: [] }),
            confirmedReturnIds.length
                ? sb.from('sale_return_items').select('return_id, product_id, qty, line_total, cost_price_snapshot, products(name,unit)').in('return_id', confirmedReturnIds)
                : Promise.resolve({ data: [] }),
        ]);

        // تبويب الأصناف — إجمالي مشتريات العميل من كل صنف (إجمالي، بدون خصم مرتجعات — المرتجعات ظاهرة بالتفصيل فى تبويب الحركات)
        const itemsMap = {};
        (saleItemRows||[]).forEach(it => {
            const key = it.product_id;
            if (!itemsMap[key]) itemsMap[key] = { name: it.products?.name || '—', unit: it.products?.unit || '', qty: 0, total: 0 };
            itemsMap[key].qty += Number(it.qty)||0;
            itemsMap[key].total += Number(it.line_total)||0;
        });
        const itemsList = Object.values(itemsMap).sort((a,b)=>b.total-a.total);

        // تبويب المكسب الشهري — آخر 12 شهر (شامل الشهر الحالي)، صافي بعد خصم المرتجعات
        const monthBuckets = [];
        const now0 = new Date();
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now0.getFullYear(), now0.getMonth() - i, 1);
            monthBuckets.push({ key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label: d.toLocaleDateString('ar-EG', { year:'numeric', month:'long' }), revenue: 0, cogs: 0 });
        }
        const bucketByKey = {}; monthBuckets.forEach(b=>{ bucketByKey[b.key]=b; });
        const monthKeyOf = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; };
        (saleItemRows||[]).forEach(it => {
            const b = bucketByKey[monthKeyOf(saleDateOf[it.sale_id])];
            if (!b) return;
            b.revenue += Number(it.line_total)||0;
            b.cogs += (Number(it.qty)||0) * (Number(it.cost_price_snapshot)||0);
        });
        (returnItemRows||[]).forEach(it => {
            const b = bucketByKey[monthKeyOf(returnDateOf[it.return_id])];
            if (!b) return;
            b.revenue -= Number(it.line_total)||0;
            b.cogs -= (Number(it.qty)||0) * (Number(it.cost_price_snapshot)||0);
        });
        monthBuckets.forEach(b => { b.profit = b.revenue - b.cogs; });

        // ★ إجماليات "المبيعات/التحصيلات" فى الكروت لازم تفضل حقيقية 100%
        //   (مبنية بس على حركات فعلية)، فبنحسبها هنا قبل أي إضافة صناعية تحت.
        const balNow = Number(cust.balance)||0;
        const totalDebit = moves.reduce((s,m)=>s+m.debit,0);
        const totalCredit = moves.reduce((s,m)=>s+m.credit,0);

        // ★ حل جذري لعدم تطابق الكشف مع الرصيد الحقيقي عند عملاء منقولين من
        //   نظام قديم (رصيدهم اتحط رقم مباشر وقت النقل من غير ما يتسجل أي
        //   مستند يفسّره فى سلطان — مفيش صف حركة يمثّله). بدل ما نسيب عمود
        //   "الرصيد" جنب كل صف يوصل لرقم مختلف عن رصيد العميل الحقيقي فى
        //   آخر الكشف (مربك ومش دقيق)، بنضيف سطر واحد صناعي "رصيد مرحّل من
        //   النظام القديم" بالفرق بالظبط، فيتصالح الرصيد المتحرك تمامًا مع
        //   customers.balance الحقيقي — من غير ما نلمس قاعدة البيانات خالص
        //   (عرض بس، مفيش أي تعديل على رصيد العميل الفعلي).
        const displayMoves = [...moves];
        const rawTotal = moves.reduce((s,m)=>s+(m.debit-m.credit),0);
        const legacyDiff = balNow - rawTotal;
        if (Math.abs(legacyDiff) > 0.01) {
            // لازم يتحط قبل أول حركة حقيقية زمنيًا (زي رصيد افتتاحي حقيقي) —
            // مش وقت إنشاء سجل العميل نفسه فى سلطان (وقت الهجرة)، لأن ده
            // ممكن يكون متأخر عن تواريخ المستندات القديمة المُعاد تشغيلها فعليًا
            const earliestDate = moves.length ? new Date(new Date(moves[0].date).getTime() - 1000).toISOString() : (cust.created_at || new Date(0).toISOString());
            displayMoves.push({
                date: earliestDate,
                desc: 'رصيد مرحّل من النظام القديم (قبل سلطان)',
                debit: Math.max(legacyDiff, 0), credit: Math.max(-legacyDiff, 0),
                type: 'legacy-carry', nav: null,
            });
        }
        displayMoves.sort((a,b) => new Date(a.date) - new Date(b.date));

        // حساب الرصيد المتحرك — على displayMoves (تشمل السطر الصناعي لو موجود)
        // عشان عمود "الرصيد" جنب كل صف يتصالح صح مع الرصيد الحقيقي فى الآخر
        let running = 0;
        displayMoves.forEach(m => { running += (m.debit - m.credit); m.balance = running; });
        const tableDebit = displayMoves.reduce((s,m)=>s+m.debit,0);
        const tableCredit = displayMoves.reduce((s,m)=>s+m.credit,0);

        _custStmtId = customerId;
        _custStmtAllMoves = displayMoves;
        _custStmtProfit = monthBuckets;
        _custStmtLegacyDiff = legacyDiff;
        _custStmtFrom = ''; _custStmtTo = '';
        _custStmtSaleItemRows = saleItemRows || [];
        _custStmtReturnItemRows = returnItemRows || [];
        _custStmtSaleDateOf = saleDateOf;
        _custStmtReturnDateOf = returnDateOf;
        window._custStmtCustName = cust.name;
        window._custStmtBalNow = balNow;

        const docsHtml = `<div style="margin-top:16px">
                <div style="font-size:13px;font-weight:800;color:var(--inv-navy);margin-bottom:8px">📁 المستندات المرتبطة (${docs.length})</div>
                ${docs.length === 0 ? `<div style="font-size:12.5px;color:var(--inv-muted-light)">لا توجد مستندات مرتبطة بهذا العميل في الأرشيف.</div>` :
                `<div style="display:flex;flex-wrap:wrap;gap:8px">
                    ${docs.map(d => `<a href="${d.file_url}" target="_blank" rel="noopener" class="cc-edit" style="background:${custThemeBg('var(--inv-gold-bg)','#2E2410')};color:var(--inv-gold);text-decoration:none">📄 ${d.title}${d.category?' ('+d.category+')':''}</a>`).join('')}
                </div>`}
            </div>

            <div style="margin-top:16px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                    <div style="font-size:13px;font-weight:800;color:var(--inv-navy)">🤝 سجل التفاعلات (${interactions.length})</div>
                    ${typeof crmOpenAdd === 'function' ? `<button class="cc-edit" style="background:${custThemeBg('var(--inv-gold-bg)','#2E2410')};color:var(--inv-gold)" onclick="crmOpenAdd('${customerId}','${(cust.name||'').replace(/'/g,"\\'")}')">+ تسجيل تفاعل</button>` : ''}
                </div>
                <div id="custInteractionsWrap">${custInteractionsHTML(interactions)}</div>
            </div>`;
        _custStmtDocsHtml = docsHtml;

        {
            const d = window._custStmtDetails;
            const chips = [];
            if (d.group) chips.push(`<span style="padding:1px 9px;border-radius:99px;border:1px solid var(--inv-border);font-weight:700">${custDetEsc(d.group)}</span>`);
            if (d.cls) chips.push(custDetEsc(d.cls));
            if (d.region) chips.push('📍 ' + custDetEsc(d.region));
            if (d.rep) chips.push('🚗 ' + custDetEsc(d.rep));
            if (d.phone) {
                const wa = custDetWaLink(d.phone);
                chips.push(`<a href="tel:${custDetEsc(d.phone)}" style="color:inherit;direction:ltr;unicode-bidi:embed">📞 ${custDetEsc(d.phone)}</a>${wa ? ` <a href="${wa}" target="_blank" rel="noopener" title="واتساب">💬</a>` : ''}`);
            } else chips.push('بدون هاتف');
            const badgesEl = document.getElementById('custStmtBadges');
            if (badgesEl) badgesEl.innerHTML = chips.map(c => `<span>${c}</span>`).join('<span style="opacity:.4">·</span>');
        }

        custStmtRecomputeAndRender();
    } catch (err) {
        document.getElementById('custStmtBody').innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:16px;border-radius:10px">خطأ: ${err.message}</div>`;
    }
};

// ════════════════════════════════════════════════════════════
// إعادة حساب الحركات/الأصناف بعد فلتر الفترة، وإعادة رسم المودال كله —
// بتتنادى أول مرة (من غير فلتر) وكل مرة يتغيّر فيها "من/إلى تاريخ".
// الرصيد الافتتاحي للفترة = رصيد آخر حركة قبل "من تاريخ" مباشرة (مأخوذ
// من الرصيد المتحرك المحسوب أصلًا على كامل التاريخ) — من غير أي استعلام
// إضافي لقاعدة البيانات.
// ════════════════════════════════════════════════════════════
function custStmtRecomputeAndRender() {
    const from = _custStmtFrom, to = _custStmtTo;
    let opening = 0;
    let filtered = _custStmtAllMoves;
    if (from) {
        const fromTime = new Date(from).getTime();
        const before = _custStmtAllMoves.filter(m => new Date(m.date).getTime() < fromTime);
        opening = before.length ? before[before.length - 1].balance : 0;
        filtered = _custStmtAllMoves.filter(m => new Date(m.date).getTime() >= fromTime);
    }
    if (to) {
        const toTime = new Date(to + 'T23:59:59').getTime();
        filtered = filtered.filter(m => new Date(m.date).getTime() <= toTime);
    }
    const periodMoves = from
        ? [{ date: from, desc: 'الرصيد الافتتاحي لبداية الفترة', debit: Math.max(opening,0), credit: Math.max(-opening,0), type: 'opening', nav: null, balance: opening }, ...filtered]
        : filtered;

    const tableDebit = filtered.reduce((s,m)=>s+m.debit,0);
    const tableCredit = filtered.reduce((s,m)=>s+m.credit,0);
    const closingBalance = periodMoves.length ? periodMoves[periodMoves.length-1].balance : opening;

    // تبويب الأصناف — بنفس فلتر الفترة، مبني على تواريخ الفواتير/المرتجعات الأصلية
    const inRange = (iso) => {
        if (!iso) return false;
        const t = new Date(iso).getTime();
        if (from && t < new Date(from).getTime()) return false;
        if (to && t > new Date(to + 'T23:59:59').getTime()) return false;
        return true;
    };
    const itemsMap = {};
    _custStmtSaleItemRows.forEach(it => {
        if (!inRange(_custStmtSaleDateOf[it.sale_id])) return;
        const key = it.product_id;
        if (!itemsMap[key]) itemsMap[key] = { name: it.products?.name || '—', unit: it.products?.unit || '', qty: 0, total: 0 };
        itemsMap[key].qty += Number(it.qty)||0;
        itemsMap[key].total += Number(it.line_total)||0;
    });
    _custStmtItems = Object.values(itemsMap).sort((a,b)=>b.total-a.total);

    _custStmtMoves = periodMoves;
    _custStmtTab = _custStmtTab || 'moves';
    window._custStmtTotals = { balNow: window._custStmtBalNow, totalDebit: tableDebit, totalCredit: tableCredit, tableDebit, tableCredit, closingBalance, isFiltered: !!(from || to) };

    const balNow = window._custStmtBalNow;
    document.getElementById('custStmtBody').innerHTML = `
        <div class="dash-card" style="padding:12px 14px;margin-bottom:14px">
            <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
                <div><label class="ob-label">من تاريخ</label><input type="date" id="custStmtFrom" class="ob-input" style="margin:0" value="${_custStmtFrom}"></div>
                <div><label class="ob-label">إلى تاريخ</label><input type="date" id="custStmtTo" class="ob-input" style="margin:0" value="${_custStmtTo}"></div>
                <button class="ob-add-btn" onclick="custStmtApplyDateFilter()">🔍 تطبيق</button>
                ${(_custStmtFrom || _custStmtTo) ? `<button class="mod-btn" style="background:#F1F5F9;color:var(--inv-text-soft)" onclick="custStmtClearDateFilter()">✕ كل الفترة</button>` : ''}
            </div>
        </div>

        <div class="mod-grid" style="margin-bottom:16px;grid-template-columns:repeat(auto-fill,minmax(190px,1fr))">
            <div class="mod-card" style="padding:14px">
                <div style="font-size:11px;color:var(--inv-muted);margin-bottom:4px">الرصيد الحالي</div>
                <div style="font-size:22px;font-weight:800;color:${balNow>0?'var(--inv-red)':balNow<0?'var(--inv-green)':'var(--inv-muted)'}">${custFmt(balNow)} ج.م</div>
                <div style="font-size:11.5px;color:var(--inv-muted-light)">${balNow>0?'مدين (لنا عليه)':balNow<0?'دائن (لنا عنده)':'مسدد'}</div>
            </div>
            ${custStmtLimitCardHtml()}
            ${custStmtDueCardHtml()}
            ${custStmtTargetCardHtml()}
            <div class="mod-card" style="padding:14px">
                <div style="font-size:11px;color:var(--inv-muted);margin-bottom:4px">آخر تحصيل</div>
                ${window._custStmtDetails.lastPay
                    ? `<div style="font-size:22px;font-weight:800;color:var(--inv-green)">${custFmt(window._custStmtDetails.lastPay.amount)}</div>
                       <div style="font-size:11.5px;color:var(--inv-muted-light)">${custDetEsc(String(window._custStmtDetails.lastPay.created_at).slice(0,10))} · ${custDetAgo(Math.max(0, Math.floor((Date.now() - new Date(window._custStmtDetails.lastPay.created_at).getTime())/86400000)))}</div>`
                    : `<div style="font-size:16px;font-weight:800;color:var(--inv-muted)">لا يوجد</div>`}
            </div>
            <div class="mod-card" style="padding:14px">
                <div style="font-size:11px;color:var(--inv-muted);margin-bottom:4px">${window._custStmtTotals.isFiltered ? 'مبيعات الفترة (آجل)' : 'إجمالي المبيعات (آجل)'}</div>
                <div style="font-size:22px;font-weight:800;color:var(--inv-text)">${custFmt(tableDebit)}</div>
            </div>
            <div class="mod-card" style="padding:14px">
                <div style="font-size:11px;color:var(--inv-muted);margin-bottom:4px">${window._custStmtTotals.isFiltered ? 'تحصيلات الفترة' : 'إجمالي التحصيلات'}</div>
                <div style="font-size:22px;font-weight:800;color:var(--inv-green)">${custFmt(tableCredit)}</div>
            </div>
        </div>
        ${custStmtAgingBarHtml()}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
            ${custStmtWaButtonHtml()}
            ${window._custStmtDetails.phone ? `<a class="cc-edit" style="text-decoration:none;padding:8px 12px;font-size:12px" href="tel:${custDetEsc(window._custStmtDetails.phone)}">📞 اتصال</a>` : ''}
        </div>

        <div class="ob-tabs" style="margin-bottom:12px">
            <button class="ob-tab ${_custStmtTab==='moves'?'active':''}" onclick="custStmtSwitchTab('moves')">📋 الحركات</button>
            <button class="ob-tab ${_custStmtTab==='items'?'active':''}" onclick="custStmtSwitchTab('items')">📦 الأصناف</button>
            <button class="ob-tab ${_custStmtTab==='profit'?'active':''}" onclick="custStmtSwitchTab('profit')">📈 المكسب الشهري</button>
        </div>
        <div id="custStmtTabBody">${custStmtMovesTabHtml()}</div>
        ${_custStmtDocsHtml}`;
}

window.custStmtApplyDateFilter = function () {
    _custStmtFrom = document.getElementById('custStmtFrom')?.value || '';
    _custStmtTo = document.getElementById('custStmtTo')?.value || '';
    custStmtRecomputeAndRender();
};
window.custStmtClearDateFilter = function () {
    _custStmtFrom = ''; _custStmtTo = '';
    custStmtRecomputeAndRender();
};

window.custCloseModal = function(id) { const m = document.getElementById(id); if (m) m.remove(); };


// ── بناة كروت "الحد الائتماني / الاستحقاق / الدفعة المستهدفة" وشريط
// الأعمار وزرار رسالة التحصيل — بند 2026-09-21، بيقرأوا من
// window._custStmtDetails (محسوبة مرة واحدة فى custShowStatement).
function custStmtLimitCardHtml() {
    const d = window._custStmtDetails, lim = d.lim;
    const usePct = d.limit > 0 ? Math.min(100, (window._custStmtBalNow / d.limit) * 100) : 0;
    return `<div class="mod-card" style="padding:14px">
        <div style="font-size:11px;color:var(--inv-muted);margin-bottom:4px">الحد الائتماني</div>
        <div style="font-size:22px;font-weight:800;color:var(--inv-text)">${d.limit > 0 ? custFmt(d.limit) : 'بدون حد'}</div>
        <div style="margin-top:4px">${lim.key === 'over' ? custDetBadge('over', 'فوق الحد +' + custFmt(lim.over)) : lim.key === 'nolimit' ? custDetBadge('nolimit', 'بدون حد') : lim.key === 'within' ? custDetBadge('within', 'ضمن الحد') : ''}</div>
        ${d.limit > 0 ? custDetBar(usePct, lim.key === 'over' ? 'var(--inv-red)' : usePct > 80 ? '#D97706' : 'var(--inv-green)') : ''}
    </div>`;
}
function custStmtDueCardHtml() {
    const d = window._custStmtDetails;
    return `<div class="mod-card" style="padding:14px">
        <div style="font-size:11px;color:var(--inv-muted);margin-bottom:4px">ميعاد الاستحقاق</div>
        <div style="font-size:16px;font-weight:800;color:var(--inv-text)">${d.dueDate || '—'}</div>
        <div style="margin-top:4px">${custDetBadge(d.due.key, d.due.label)}</div>
    </div>`;
}
function custStmtTargetCardHtml() {
    const d = window._custStmtDetails;
    if (!(d.target > 0)) return `<div class="mod-card" style="padding:14px">
        <div style="font-size:11px;color:var(--inv-muted);margin-bottom:4px">الدفعة المستهدفة</div>
        <div style="font-size:16px;font-weight:800;color:var(--inv-muted)">غير محددة</div>
    </div>`;
    const pct = Math.min(100, (d.collected / d.target) * 100);
    const state = window._custStmtBalNow <= 0.005 ? 'done' : d.collected >= d.target - 0.005 ? 'done' : d.collected > 0 ? 'part' : 'miss';
    const label = state === 'done' ? 'تحققت ✓' : state === 'part' ? 'جزئي' : 'لم تُحصَّل';
    return `<div class="mod-card" style="padding:14px">
        <div style="font-size:11px;color:var(--inv-muted);margin-bottom:4px">الدفعة المستهدفة (${custDetSchedLabel(d.sched)})</div>
        <div style="font-size:22px;font-weight:800;color:var(--inv-text)">${custFmt(d.target)}</div>
        <div style="margin-top:4px">${custDetBadge(state, label)} <span style="font-size:11px;color:var(--inv-muted)">المحصّل: ${custFmt(d.collected)}</span></div>
        ${custDetBar(pct, state === 'done' ? 'var(--inv-green)' : '#D97706')}
    </div>`;
}
function custStmtAgingBarHtml() {
    const balNow = window._custStmtBalNow;
    if (!(balNow > 0.005)) return '';
    const ag = window._custStmtDetails.aging, tot = ag.b30 + ag.b60 + ag.b90 + ag.b90p;
    if (tot <= 0.005) return '';
    const seg = (v, col) => v > 0.005 ? `<div title="${custFmt(v)}" style="width:${v/tot*100}%;background:${col}"></div>` : '';
    return `<div class="dash-card" style="padding:10px 14px;margin-bottom:14px;font-size:12.5px">
        أعمار المديونية (FIFO): 0-30 يوم <b>${custFmt(ag.b30)}</b> · 31-60 <b>${custFmt(ag.b60)}</b> · 61-90 <b>${custFmt(ag.b90)}</b> · +90/افتتاحي <b>${custFmt(ag.b90p)}</b>
        <div style="display:flex;height:8px;border-radius:99px;overflow:hidden;background:var(--inv-border);margin-top:6px">${seg(ag.b30,'#059669')}${seg(ag.b60,'#D97706')}${seg(ag.b90,'#EA580C')}${seg(ag.b90p,'#DC2626')}</div>
    </div>`;
}
function custStmtWaButtonHtml() {
    const d = window._custStmtDetails, wa = custDetWaLink(d.phone);
    if (!wa) return '';
    const balNow = window._custStmtBalNow;
    let msg = 'السلام عليكم ' + window._custStmtCustName + '\nرصيد حسابك عندنا ' + custFmt(balNow) + ' جنيه';
    if (d.dueDate) msg += '، وميعاد السداد ' + d.dueDate;
    msg += '.';
    if (d.lim.key === 'over') msg += '\nالرصيد فوق الحد المسموح بـ ' + custFmt(d.lim.over) + ' جنيه.';
    msg += '\nنرجو تحديد ميعاد للتحصيل. شكرًا — جملة سلطان';
    return `<a class="cc-edit" style="text-decoration:none;padding:8px 12px;font-size:12px" href="${wa}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">💬 رسالة تحصيل واتساب</a>`;
}

// بناء صفوف جدول كشف الحساب — دالة منفصلة عشان تتنادى من العرض الأول
// ومن custStmtFilterRows (البحث) من غير تكرار كود
function custStmtRowsHtml(moves) {
    if (!moves.length) return `<tr><td colspan="6" class="empty-state"><span>📭</span>لا توجد حركات.</td></tr>`;
    return moves.map(m => {
        const isCash = m.type.endsWith('-cash');
        const bg = m.type==='sale-credit' ? custThemeBg('var(--inv-red-bg)','#331917') : m.type==='payment' ? custThemeBg('var(--inv-green-light)','#123024')
            : m.type==='return-credit' || m.type==='return-cash' ? custThemeBg('var(--inv-gold-bg)','#2E2410')
            : m.type==='transfer-out' || m.type==='transfer-in' ? custThemeBg('#EFF6FF','#16233A')
            : m.type==='opening' ? custThemeBg('#F5F3FF','#241A3D')
            : m.type==='legacy-carry' ? custThemeBg('#F1F5F9','#131A26') : custThemeBg('#F8FAFC','#131A26');
        const icon = m.type==='sale-credit' ? '<span style="color:var(--inv-red)">🛒</span>'
            : m.type==='sale-cash' ? '<span style="color:var(--inv-muted-light)">💰</span>'
            : m.type.startsWith('return') ? '<span style="color:var(--inv-gold)">↩️</span>'
            : m.type.startsWith('transfer') ? '<span style="color:#2563EB">🔀</span>'
            : m.type==='opening' ? '<span style="color:#7C3AED">📋</span>'
            : m.type==='legacy-carry' ? '<span style="color:var(--inv-muted)">🗄️</span>'
            : '<span style="color:var(--inv-green)">💵</span>';
        const navBtn = m.nav?.kind === 'sale' ? `<button class="cc-edit" title="افتح الفاتورة" onclick="custGoToDoc('sales','${m.nav.no}')">🔗</button>`
            : m.nav?.kind === 'return' ? `<button class="cc-edit" title="افتح المرتجع" onclick="custGoToDoc('sales_return','${m.nav.no}')">🔗</button>`
            : m.nav?.kind === 'payment' ? `<button class="cc-edit" title="افتح سند التحصيل" onclick="custGoToPayment('${m.nav.id}')">🔗</button>`
            : m.nav?.kind === 'transfer' ? `<button class="cc-edit" title="افتح تحويل الأرصدة" onclick="custGoToModule('balance-transfer')">🔗</button>`
            : m.nav?.kind === 'opening' ? `<button class="cc-edit" title="افتح الأرصدة الافتتاحية" onclick="custGoToModule('opening-balances')">🔗</button>`
            : '';
        return `<tr style="background:${bg}">
        <td style="font-size:12px">${new Date(m.date).toLocaleDateString('ar-EG')}</td>
        <td>
            ${icon} ${m.desc}
            ${isCash ? '<span style="font-size:11.5px;color:var(--inv-muted-light)"> (نقدي — بدون أثر على الرصيد)</span>' : ''}
        </td>
        <td style="text-align:left;font-weight:600;color:var(--inv-red)">${m.debit?custFmt(m.debit):'—'}</td>
        <td style="text-align:left;font-weight:600;color:var(--inv-green)">${m.credit?custFmt(m.credit):'—'}</td>
        <td style="text-align:left;font-weight:700">${custFmt(m.balance)}</td>
        <td style="text-align:center">${navBtn}</td>
    </tr>`;
    }).join('');
}

window.custStmtFilterRows = function(query) {
    const q = (query || '').trim().toLowerCase();
    const filtered = q ? _custStmtMoves.filter(m => (m.desc || '').toLowerCase().includes(q)) : _custStmtMoves;
    const tbody = document.getElementById('custStmtTbody');
    if (tbody) tbody.innerHTML = custStmtRowsHtml(filtered);
};

// ════════════════════════════════════════════════════════════
// 2ب) تبويبات كشف الحساب الفرعية — بند 5، 2026-07-25
// ════════════════════════════════════════════════════════════
window.custStmtSwitchTab = function (tab) {
    _custStmtTab = tab;
    document.querySelectorAll('#custStmtBody .ob-tabs .ob-tab').forEach((b,i) => {
        b.classList.toggle('active', ['moves','items','profit'][i] === tab);
    });
    const body = document.getElementById('custStmtTabBody');
    if (!body) return;
    if (tab === 'moves') body.innerHTML = custStmtMovesTabHtml();
    else if (tab === 'items') body.innerHTML = custStmtItemsTabHtml();
    else body.innerHTML = custStmtProfitTabHtml();
};

function custStmtMovesTabHtml() {
    const t = window._custStmtTotals || {};
    return `
        <input type="text" id="custStmtSearch" class="mod-form-input" style="margin-bottom:10px" placeholder="🔍 بحث في الحركات (اسم الفاتورة/المرتجع/البيان)..." oninput="custStmtFilterRows(this.value)">
        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>التاريخ</th><th>البيان</th>
                <th style="text-align:left">مدين</th>
                <th style="text-align:left">دائن</th>
                <th style="text-align:left">الرصيد</th>
                <th></th>
            </tr></thead>
            <tbody id="custStmtTbody">${custStmtRowsHtml(_custStmtMoves)}</tbody>
            ${_custStmtMoves.length ? `<tfoot><tr style="background:${custThemeBg('#F8FAFC','#131A26')};font-weight:800">
                <td colspan="2">${t.isFiltered ? 'إجمالي الفترة' : 'الإجمالي'}</td>
                <td style="text-align:left;color:var(--inv-red)">${custFmt(t.tableDebit)}</td>
                <td style="text-align:left;color:var(--inv-green)">${custFmt(t.tableCredit)}</td>
                <td style="text-align:left">${custFmt(t.closingBalance)}</td>
                <td></td>
            </tr></tfoot>` : ''}
            </table>
        </div>
        ${!t.isFiltered && Math.abs(_custStmtLegacyDiff) > 0.01 ? `
        <div style="background:var(--inv-divider);border:1px solid var(--inv-border);color:var(--inv-text-soft);padding:10px 14px;border-radius:10px;margin-top:10px;font-size:12px">
            🗄️ سطر "رصيد مرحّل من النظام القديم" (${custFmt(_custStmtLegacyDiff)}) هو الفرق بين رصيد العميل الحقيقي وحركاته المسجّلة فعليًا فى سلطان —
            غالبًا عميل منقول من نظام قديم برصيد بداية من غير تفاصيل مستندات. رصيد العميل نفسه صحيح، السطر ده للعرض بس ومفيهوش أي تعديل على البيانات.
        </div>` : ''}`;
}

function custStmtItemsTabHtml() {
    if (!_custStmtItems.length) return `<div class="empty-state"><span>📦</span>مفيش أي أصناف مسجّلة لهذا العميل.</div>`;
    const totalQty = _custStmtItems.reduce((s,i)=>s+i.qty,0);
    const totalVal = _custStmtItems.reduce((s,i)=>s+i.total,0);
    return `<div class="mod-table-wrap"><table class="mod-table"><thead><tr>
        <th>الصنف</th><th>الوحدة</th><th style="text-align:left">الكمية</th><th style="text-align:left">متوسط السعر</th><th style="text-align:left">إجمالي القيمة</th>
    </tr></thead><tbody>
        ${_custStmtItems.map(i => `<tr>
            <td style="font-weight:600">${i.name}</td>
            <td style="color:var(--inv-muted)">${i.unit||'—'}</td>
            <td style="text-align:left">${custFmt(i.qty)}</td>
            <td style="text-align:left;color:var(--inv-muted)">${custFmt(i.qty ? i.total/i.qty : 0)}</td>
            <td style="text-align:left;font-weight:700">${custFmt(i.total)}</td>
        </tr>`).join('')}
    </tbody><tfoot><tr style="background:${custThemeBg('#F8FAFC','#131A26')};font-weight:800">
        <td colspan="2">الإجمالي</td><td style="text-align:left">${custFmt(totalQty)}</td><td></td><td style="text-align:left">${custFmt(totalVal)}</td>
    </tr></tfoot></table></div>
    <div style="font-size:11.5px;color:var(--inv-muted-light);margin-top:8px">إجمالي المشتريات (إجمالي، قبل خصم المرتجعات — تفاصيل المرتجعات فى تبويب "الحركات").</div>`;
}

function custStmtProfitTabHtml() {
    const totalRevenue = _custStmtProfit.reduce((s,m)=>s+m.revenue,0);
    const totalCogs = _custStmtProfit.reduce((s,m)=>s+m.cogs,0);
    const totalProfit = _custStmtProfit.reduce((s,m)=>s+m.profit,0);
    return `<div class="mod-table-wrap"><table class="mod-table"><thead><tr>
        <th>الشهر</th><th style="text-align:left">صافي المبيعات</th><th style="text-align:left">تكلفة البضاعة المباعة</th><th style="text-align:left">صافي المكسب</th>
    </tr></thead><tbody>
        ${_custStmtProfit.map(m => `<tr>
            <td>${m.label}</td>
            <td style="text-align:left">${custFmt(m.revenue)}</td>
            <td style="text-align:left;color:var(--inv-muted)">${custFmt(m.cogs)}</td>
            <td style="text-align:left;font-weight:700;color:${m.profit>=0?'var(--inv-green)':'var(--inv-red)'}">${custFmt(m.profit)}</td>
        </tr>`).join('')}
    </tbody><tfoot><tr style="background:${custThemeBg('#F8FAFC','#131A26')};font-weight:800">
        <td>الإجمالي (12 شهر)</td><td style="text-align:left">${custFmt(totalRevenue)}</td><td style="text-align:left">${custFmt(totalCogs)}</td>
        <td style="text-align:left;color:${totalProfit>=0?'var(--inv-green)':'var(--inv-red)'}">${custFmt(totalProfit)}</td>
    </tr></tfoot></table></div>
    <div style="font-size:11.5px;color:var(--inv-muted-light);margin-top:8px">المكسب = صافي المبيعات (بعد خصم مرتجعات نفس الشهر) − تكلفة البضاعة المباعة، حسب سعر التكلفة المسجّل وقت كل عملية.</div>`;
}

// ينقل لصفحة "إدارة العملاء" (master-data.js) ويفتح نافذة تعديل بيانات
// نفس العميل تلقائياً — قبل كده كانت الصفحتين منفصلتين تماماً من غير أي
// رابط بينهم، فالمستخدم كان لازم يقفل كشف الحساب ويدوّر على العميل تاني
// في شاشة تانية عشان يعدّل رقم تليفون أو حد ائتماني مثلاً.
window.custGoEditProfile = function(customerId) {
    window._pendingCustomerEdit = customerId;
    window._pendingCustHubTab = 'manage';
    custCloseModal('custStmtModal');
    document.querySelector('[data-mod="customers-hub"]')?.click();
};

// استبدال يدوي لنقاط الولاء (V1 — مفيش خصم أوتوماتيكي على الفاتورة لسه،
// العميل بيطلب الاستبدال واتساب والأونر/الموظف بيسجّله هنا). بيستخدم
// fn_loyalty_redeem_points من loyalty_points_migration.sql — الدالة
// بتسجّل سطر سالب فى loyalty_points_ledger وتنقص customers.loyalty_points_balance
window.custRedeemLoyalty = async function(customerId, currentBalance) {
    if (currentBalance <= 0) { alert('العميل ده مفيش عنده نقاط لسه'); return; }
    const input = prompt(`رصيد النقاط الحالي: ${currentBalance}\nعدد النقاط اللي هتتستبدل دلوقتي؟`, '');
    if (!input) return;
    const points = Number(input);
    if (!points || points <= 0) { alert('❌ عدد نقاط غير صالح'); return; }
    if (points > currentBalance) { alert('❌ العدد أكبر من رصيد العميل الحالي'); return; }
    const reason = prompt('سبب الاستبدال (اختياري):', '') || 'استبدال يدوي';
    try {
        const { error } = await sb.rpc('fn_loyalty_redeem_points', {
            p_customer_id: customerId, p_points: points, p_reason: reason,
        });
        if (error) throw error;
        alert('✅ تم الاستبدال بنجاح');
        custCloseModal('custStmtModal');
        custShowStatement(customerId);
    } catch (err) {
        alert('❌ خطأ فى الاستبدال: ' + err.message);
    }
};

// أيقونة الانتقال المباشر جنب كل حركة فى الكشف — بتاخد نفس فكرة
// custGoEditProfile بالظبط (pending flag + كليك على عنصر القائمة الجانبية)
window.custGoToDoc = function(revType, no) {
    // بند 2026-09-22: يفتح الفاتورة/المرتجع في صفحة مراجعة الفواتير من غير
    // ما يقفل كشف الحساب، عشان ترجع لنفس مكانك في الكشف لما تقفل النافذة.
    window._pendingInvoiceReviewSearch = { type: revType, no };
    document.querySelector('[data-mod="invoice-review"]')?.click();
};
window.custGoToPayment = function(paymentId) {
    window._pendingCollectionEdit = paymentId;
    custCloseModal('custStmtModal');
    document.querySelector('[data-mod="collections"]')?.click();
};
window.custGoToModule = function(mod) {
    custCloseModal('custStmtModal');
    document.querySelector(`[data-mod="${mod}"]`)?.click();
};

// ════════════════════════════════════════════════════════════
// 3) سجل التفاعلات (CRM) داخل كشف الحساب — تحديث جزئي بدون
//    إعادة تحميل الكشف كله بعد ما تسجّل تفاعل جديد من crm.js
// ════════════════════════════════════════════════════════════
function custInteractionsHTML(interactions) {
    if (!interactions.length) return `<div style="font-size:12.5px;color:var(--inv-muted-light)">لا توجد تفاعلات مسجّلة لهذا العميل.</div>`;
    const typeLabels = { call: '📞 مكالمة', visit: '🚶 زيارة', complaint: '⚠️ شكوى', note: '📝 ملاحظة' };
    return `<div class="mod-table-wrap"><table class="mod-table"><thead><tr>
        <th>النوع</th><th>المندوب</th><th>التاريخ</th><th>ملاحظات</th><th>المتابعة القادمة</th>
    </tr></thead><tbody>
        ${interactions.map(x => `<tr>
            <td>${typeLabels[x.type] || x.type}</td>
            <td style="color:var(--inv-muted)">${x.sales_reps?.name || '—'}</td>
            <td style="font-size:12px">${new Date(x.interaction_date).toLocaleDateString('ar-EG')}</td>
            <td style="color:var(--inv-muted)">${x.notes || '—'}${x.archive_documents ? `<br><a href="${x.archive_documents.file_url}" target="_blank" rel="noopener" style="font-size:11px;color:var(--inv-gold)">📎 ${x.archive_documents.title}</a>` : ''}</td>
            <td style="font-size:12px">${x.next_follow_up_date ? new Date(x.next_follow_up_date).toLocaleDateString('ar-EG') + (x.is_done ? ' ✅' : '') : '—'}</td>
        </tr>`).join('')}
    </tbody></table></div>`;
}

window.custRefreshInteractions = async function (customerId) {
    const wrap = document.getElementById('custInteractionsWrap');
    if (!wrap) return;
    try {
        const { data } = await sb.from('customer_interactions').select('id,type,notes,interaction_date,next_follow_up_date,is_done,sales_reps(name),archive_documents(title,file_url)')
            .eq('customer_id', customerId).order('interaction_date', { ascending: false });
        wrap.innerHTML = custInteractionsHTML(data || []);
    } catch {}
};

// ════════════════════════════════════════════════════════════
// 4) أدوات مساعدة
// ════════════════════════════════════════════════════════════
function custFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// خلفية pastel فاتحة (زي صفوف كشف الحساب) بتتحسب في JS مباشرة، مش عن
// طريق CSS class — فمحتاجة تتحول لنظيرها الغامق يدويًا وقت الرسم، لأن
// الوضع الليلي (index.html) مبني على توكنز CSS مش بيلمس القيم دي.
// نفس النص اللي جوه الخلية بياخد لونه من var(--inv-text) (متغيّر مع
// الوضع) — فلو الخلفية فضلت فاتحة دايمًا، الكتابة تختفي فى الوضع الليلي.
function custThemeBg(light, dark) { return (typeof window.themeIsDark === 'function' && window.themeIsDark()) ? dark : light; }

// علامة مصدر تسجيل العميل (بند 6، تقرير 2026-07-21) — customers.source
// null = تسجيل يدوي/قديم قبل إضافة العمود، مفيش بادچ ليه
function custSourceBadge(source) {
    if (source === 'sultanoo') return '<span style="font-size:9.5px;background:#EFF6FF;color:#2563EB;padding:1px 6px;border-radius:8px;font-weight:700;white-space:nowrap">📱 سلطانو</span>';
    if (source === 'rep_app') return '<span style="font-size:9.5px;background:var(--inv-green-light);color:var(--inv-green);padding:1px 6px;border-radius:8px;font-weight:700;white-space:nowrap">🚗 مندوب</span>';
    return '';
}
