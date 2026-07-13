/* ════════════════════════════════════════════════════════════
   المصروفات — رقابة الحد الأقصى الشهري (بند + إجمالي)
   مأخوذ من وحدة الرواتب V16 + ربط Supabase
   ════════════════════════════════════════════════════════════ */

let _expGlobalLimit = 0;   // الحد الإجمالي الشهري لكل المصروفات
let _expUserRole = 'admin'; // افتراضياً admin (هيحدد من session)

// ════════════════════════════════════════════════════════════
// 1) التقديم الرئيسي
// ════════════════════════════════════════════════════════════
async function renderExpenses(container) {
    container.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات المصروفات...</div>';
    // تحديد دور المستخدم
    _expUserRole = currentUser?.role || 'admin';

    let expenses = [], categories = [], monthExpenses = [], globalLimitRow = null;
    let isOfflineData = false, offlineDataAge = null;
    try {
        const [r1, r2, r3, r4] = await Promise.all([
            sb.from('expenses').select('*, expense_categories(name, monthly_limit)').order('expense_date', { ascending: false }).limit(50),
            sb.from('expense_categories').select('*').order('name'),
            // كل مصروفات الشهر الحالي
            sb.from('expenses').select('category_id, amount')
                .gte('expense_date', _expMonthStart())
                .lt('expense_date', _expMonthEnd())
                .eq('status', 'confirmed'),
            sb.from('app_settings').select('value').eq('key', 'expense_global_monthly_limit').single(),
        ]);
        if (r1.error || !r1.data || r2.error || !r2.data) throw (r1.error || r2.error || new Error('no data'));
        expenses = r1.data;
        categories = r2.data;
        monthExpenses = r3.data || [];
        globalLimitRow = r4.data;
        if (typeof dbSetCache === 'function') {
            dbSetCache('expenses', expenses);
            dbSetCache('expense_categories', categories);
        }
    } catch (err) {
        // فشل التحميل الحي (أوفلاين أو خطأ شبكة) → ارجع لآخر نسخة محفوظة في الكاش
        if (typeof dbGetCache === 'function') {
            const [ce, cc] = await Promise.all([dbGetCache('expenses'), dbGetCache('expense_categories')]);
            if (cc?.data?.length) {
                categories = cc.data;
                expenses = ce?.data || [];
                isOfflineData = true;
                offlineDataAge = Math.min(cc.updatedAt || Date.now(), ce?.updatedAt || cc.updatedAt || Date.now());
            } else {
                container.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message || 'تعذر تحميل البيانات'}</div>`;
                return;
            }
        } else {
            container.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message || 'تعذر تحميل البيانات'}</div>`;
            return;
        }
    }

    // الحد الإجمالي
    _expGlobalLimit = parseFloat(globalLimitRow?.value) || 0;

    // خريطة استهلاك كل بند في الشهر
    const catUsage = {};
    monthExpenses.forEach(e => {
        catUsage[e.category_id] = (catUsage[e.category_id] || 0) + (e.amount || 0);
    });
    const monthTotal = monthExpenses.reduce((s, e) => s + (e.amount || 0), 0);

    const total = expenses.reduce((s, e) => s + (e.amount || 0), 0);

    // مصروفات اتسجّلت محلياً ولسه ماتزامنتش
    const pendingEntries = typeof getQueue === 'function'
        ? await getQueue(e => e.module === 'expenses' && (e.status === 'pending' || e.status === 'failed' || e.status === 'syncing'))
        : [];
    const pendingRows = pendingEntries.map(e => ({
        _queue: true, status: e.status,
        expense_date: e.payload.expense_date,
        expense_categories: { name: categories.find(c => c.id === e.payload.category_id)?.name || '—' },
        description: e.payload.description, amount: e.payload.amount,
    }));
    const displayExpenses = [...pendingRows, ...expenses];

    container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
            <div><h2 style="font-size:22px;font-weight:800">المصروفات المالية</h2>
            <p style="font-size:13px;color:#64748B;margin-top:4px">متابعة وتسجيل المصروفات برقابة الحد الأقصى الشهري</p></div>
            <button class="mod-btn mod-btn-primary" onclick="expOpenAdd()">+ تسجيل مصروف جديد</button>
        </div>

        ${isOfflineData ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:9px 16px;border-radius:9px;margin-bottom:16px;font-size:12.5px">
            📴 <strong>غير متصل بالإنترنت</strong> — بيانات البنود المعروضة من آخر نسخة محفوظة (${offlineDataAge ? new Date(offlineDataAge).toLocaleString('ar-EG') : '—'}). المصروف هيتسجّل محلياً ويتزامن تلقائياً لما الاتصال يرجع (بدون فحص الحد لحد ما يتزامن).
        </div>` : ''}

        <!-- تبويبات -->
        <div class="exp-tabs">
            <button class="exp-tab active" id="expTabTransactions" onclick="expSwitchTab('transactions')">📋 المصروفات</button>
            <button class="exp-tab" id="expTabCats" onclick="expSwitchTab('cats')">🗂️ إدارة البنود والحدود</button>
        </div>

        <!-- ===== تبويب المصروفات ===== -->
        <div id="expPanelTransactions">
            <div class="mod-grid">
                <div class="mod-card"><div class="mod-card-icon" style="background:#FEF3C7;color:#D97706">💸</div><div class="mod-card-val">${_expFmt(total)}</div><div class="mod-card-lbl">إجمالي المصروفات</div></div>
                <div class="mod-card"><div class="mod-card-icon" style="background:#D1FAE5;color:#059669">📅</div><div class="mod-card-val">${_expFmt(monthTotal)}</div><div class="mod-card-lbl">مصروفات هذا الشهر</div></div>
                <div class="mod-card"><div class="mod-card-icon" style="background:#E0E7FF;color:#4F46E5">📊</div><div class="mod-card-val">${expenses.length}</div><div class="mod-card-lbl">عملية منفذة</div></div>
            </div>

            ${_expGlobalLimitCardHTML(monthTotal)}
            ${_expMonthExpTableHTML(displayExpenses)}
        </div>

        <!-- ===== تبويب إدارة البنود ===== -->
        <div id="expPanelCats" style="display:none">
            ${_expCatsPanelHTML(categories, catUsage)}
        </div>
    `;
}

// ════════════════════════════════════════════════════════════
// 2) قوالب HTML
// ════════════════════════════════════════════════════════════
function _expMonthExpTableHTML(expenses) {
    return `
    <div class="mod-table-wrap" style="margin-top:16px">
        <table class="mod-table"><thead><tr>
            <th>التاريخ</th><th>البند</th><th>البيان</th><th style="text-align:left">المبلغ</th><th>الحالة</th>
        </tr></thead>
        <tbody>
            ${expenses.length === 0 ? `<tr><td colspan="5" class="empty-state"><span>📭</span>لا توجد مصروفات.</td></tr>` :
            expenses.map(e => `<tr>
                <td>${new Date(e.expense_date).toLocaleDateString('ar-EG')}</td>
                <td><span style="background:#F1F5F9;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600">${e.expense_categories?.name || '—'}</span></td>
                <td style="color:#475569">${e.description || '—'}</td>
                <td style="text-align:left;font-weight:700;color:#DC2626">${_expFmt(e.amount)}</td>
                <td>${e._queue
                    ? (e.status === 'failed' ? '<span style="color:#DC2626;font-weight:600">❌ فشلت المزامنة</span>' : '<span style="color:#D97706;font-weight:600">⏳ غير مُزامن</span>')
                    : '<span style="color:#059669;font-weight:600">✅ مؤكد</span>'}</td>
            </tr>`).join('')}
        </tbody></table>
    </div>`;
}

function _expGlobalLimitCardHTML(monthTotal) {
    if (_expGlobalLimit <= 0) return '';
    const pct = (monthTotal / _expGlobalLimit) * 100;
    const cls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'safe';
    const stt = pct >= 100 ? `<span class="limit-status red">🔴 تجاوز الحد الإجمالي</span>` :
                pct >= 80  ? `<span class="limit-status orange">🟠 تحذير — اقترب من الحد</span>` :
                             `<span class="limit-status green">🟢 في الحد المسموح</span>`;
    return `
    <div class="mod-card" style="margin-top:16px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <div class="mod-card-icon" style="background:#FEF2F2;color:#DC2626;width:40px;height:40px;font-size:18px">🎯</div>
            <div><div style="font-size:14px;font-weight:800">الحد الإجمالي الشهري للمصروفات</div><div style="font-size:11px;color:#64748B">مراقبة إجمالي مصروفات الشهر كله</div></div>
        </div>
        <div class="limit-row"><span class="lr-label">المصروف حتى الآن:</span><span class="lr-val">${_expFmt(monthTotal)} ج.م</span><span class="lr-val" style="margin:0;color:#94A3B8;font-weight:600">/ ${_expFmt(_expGlobalLimit)} ج.م</span></div>
        <div class="limit-bar"><div class="limit-fill ${cls}" style="width:${Math.min(pct, 100).toFixed(1)}%"></div></div>
        <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:11px;color:#64748B">${pct.toFixed(1)}% من الحد — متبقّي ${_expFmt(Math.max(_expGlobalLimit - monthTotal, 0))} ج.م</span>
            ${stt}
        </div>
    </div>`;
}

function _expCatsPanelHTML(categories, catUsage) {
    if (!categories.length) return `<div class="empty-state"><span>🗂️</span>لا توجد بنود مسجّلة.</div>`;
    return `
    <div class="mod-table-wrap">
        <div style="padding:16px 20px;border-bottom:1px solid #E2E8F0">
            <div style="font-size:14px;font-weight:800;color:#0F172A">دليل بنود المصروفات والحدود الشهرية</div>
            <div style="font-size:12px;color:#64748B;margin-top:4px">عدّل الحد الشهري لكل بند — الاستهلاك يُحتسب من مصروفات الشهر الحالي</div>
        </div>
        <div style="padding:16px 20px">
            ${categories.map(c => {
                const used = catUsage[c.id] || 0;
                const lim = parseFloat(c.monthly_limit) || 0;
                const pct = lim > 0 ? (used / lim) * 100 : 0;
                const cls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'safe';
                return `<div class="cat-card">
                    <div class="cc-ic">📋</div>
                    <div class="cc-info">
                        <div class="cc-name">${c.name}</div>
                        <div class="cc-sub">${c.code || 'بدون كود'} · ${c.subtype || 'operating'} · حساب: ${c.account_code || '—'}</div>
                    </div>
                    <div class="cc-bar-wrap">
                        <div class="limit-bar" style="margin:0"><div class="limit-fill ${cls}" style="width:${Math.min(pct,100)}%"></div></div>
                        <div style="font-size:11px;color:#94A3B8;text-align:center;margin-top:2px">${pct.toFixed(0)}%</div>
                    </div>
                    <div class="cc-amt">
                        <div class="used">${_expFmt(used)}</div>
                        <div class="lim">/ ${lim > 0 ? _expFmt(lim) : '∞'}</div>
                    </div>
                    <button class="cc-edit" onclick="expOpenLimit('${c.id}', ${JSON.stringify(c.name).replace(/"/g,'&quot;')})">✏️ الحد</button>
                </div>`;
            }).join('')}
        </div>
    </div>`;
}

// ════════════════════════════════════════════════════════════
// 3) تبديل التبويبات
// ════════════════════════════════════════════════════════════
window.expSwitchTab = function(tab) {
    const t = document.getElementById('expTabTransactions'), c = document.getElementById('expTabCats');
    const tp = document.getElementById('expPanelTransactions'), cp = document.getElementById('expPanelCats');
    if (tab === 'cats') {
        c.classList.add('active'); t.classList.remove('active');
        cp.style.display = ''; tp.style.display = 'none';
    } else {
        t.classList.add('active'); c.classList.remove('active');
        tp.style.display = ''; cp.style.display = 'none';
    }
};

// ════════════════════════════════════════════════════════════
// 4) نافذة إضافة مصروف + شريط الحد اللحظي
// ════════════════════════════════════════════════════════════
window.expOpenAdd = async function() {
    // جلب البنود (مع رجوع للكاش لو أوفلاين)
    let categories = [];
    try {
        const { data, error } = await sb.from('expense_categories').select('*').order('name');
        if (error || !data) throw error || new Error('no categories');
        categories = data;
    } catch {
        if (typeof dbGetCache === 'function') {
            const cached = await dbGetCache('expense_categories');
            categories = cached?.data || [];
        }
    }

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'expModal';
    modal.innerHTML = `
        <div class="mod-modal">
            <div class="mod-modal-header"><h3>💸 تسجيل مصروف جديد</h3>
                <button class="mod-modal-close" onclick="expCloseModal('expModal')">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>بند المصروف *</label>
                    <select id="expCatId" class="mod-form-input" onchange="expCheckLimit()">
                        <option value="">-- اختر البند --</option>
                        ${categories.map(c => `<option value="${c.id}" data-limit="${c.monthly_limit||0}">${c.name}</option>`).join('')}
                    </select>
                </div>
                <div class="mod-form-group"><label>المبلغ (ج.م) *</label>
                    <input type="number" id="expAmount" class="mod-form-input" placeholder="0.00" step="0.01" dir="ltr" oninput="expCheckLimit()">
                </div>
                <div class="mod-form-group"><label>البيان *</label>
                    <input type="text" id="expDesc" class="mod-form-input" placeholder="مثال: فاتورة كهرباء يناير">
                </div>
                <div class="mod-form-group"><label>التاريخ</label>
                    <input type="date" id="expDate" class="mod-form-input" value="${_expToday()}" onchange="expCheckLimit()">
                </div>

                <!-- منطقة فحص الحد -->
                <div id="expLimitArea"></div>

                <!-- سبب التجاوز -->
                <div class="limit-over-box" id="expOverrideBox">
                    <h4>⚠️ تم تجاوز الحد المسموح</h4>
                    <p style="font-size:12px;color:#92400E;margin-bottom:8px">${_expUserRole==='admin' ? 'بصفتك مدير يمكنك المتابعة — يُفضّل كتابة سبب:' : 'للمتابعة، يجب إدخال سبب التجاوز:'}</p>
                    <textarea id="expOverrideReason" placeholder="سبب تجاوز الحد المسموح..."></textarea>
                </div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="expCloseModal('expModal')">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="saveExpense()">حفظ المصروف</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
};

window.expCloseModal = function(id) {
    const m = document.getElementById(id);
    if (m) m.remove();
};

// ════════════════════════════════════════════════════════════
// 5) فحص الحد الأقصى اللحظي (مأخوذ من checkExpenseLimit في وحدة الرواتب)
// ════════════════════════════════════════════════════════════
let _expLimitExceeded = false; // حالة تجاوز الحد
let _expMonthCatUsage = {};    // cache لاستهلاك الشهر

window.expCheckLimit = async function() {
    const area = document.getElementById('expLimitArea');
    if (!area) return;
    const catId = document.getElementById('expCatId').value;
    const amount = parseFloat(document.getElementById('expAmount').value) || 0;

    if (!catId || amount <= 0) {
        area.innerHTML = '';
        document.getElementById('expOverrideBox').classList.remove('show');
        _expLimitExceeded = false;
        return;
    }

    if (typeof isOnline === 'function' && !isOnline()) {
        area.innerHTML = `<div class="limit-box" style="border-color:#FCD34D;background:#FFFBEB">
            <div style="font-size:12px;color:#92400E">📴 غير متصل — تعذر فحص الحد الشهري الآن. المصروف هيتسجّل محلياً وهيتفحص تلقائياً بعد المزامنة (وهيظهر تنبيه لو طلع متجاوز الحد).</div>
        </div>`;
        document.getElementById('expOverrideBox').classList.remove('show');
        _expLimitExceeded = false;
        return;
    }

    // جلب استهلاك الشهر لهذا البند
    const { data: monthExp } = await sb.from('expenses').select('amount')
        .eq('category_id', catId)
        .eq('status', 'confirmed')
        .gte('expense_date', _expMonthStart())
        .lt('expense_date', _expMonthEnd());

    const catName = document.getElementById('expCatId').selectedOptions[0].text;
    const catLimit = parseFloat(document.getElementById('expCatId').selectedOptions[0].dataset.limit) || 0;
    const used = (monthExp || []).reduce((s, e) => s + (e.amount || 0), 0);

    // استهلاك الشهر كله (للحد الإجمالي)
    const { data: allMonth } = await sb.from('expenses').select('amount')
        .eq('status', 'confirmed').gte('expense_date', _expMonthStart()).lt('expense_date', _expMonthEnd());
    const monthTotal = (allMonth || []).reduce((s, e) => s + (e.amount || 0), 0);

    // === فحص حد البند ===
    let catHTML = '';
    let catExceeded = false;
    if (catLimit > 0) {
        const total = used + amount;
        const pct = (total / catLimit) * 100;
        const cls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'safe';
        catExceeded = pct >= 100;
        catHTML = `
            <div class="limit-box">
                <div style="font-size:12px;color:#64748B;margin-bottom:6px">📦 بند: <strong style="color:#0F172A">${catName}</strong> — شهر ${_expMonthLabel()}</div>
                <div class="limit-row"><span class="lr-label">المصروف السابق:</span><span class="lr-val">${_expFmt(used)} ج.م</span></div>
                <div class="limit-row"><span class="lr-label">هذا المصروف:</span><span class="lr-val" style="color:#DC2626">${_expFmt(amount)} ج.م</span></div>
                <div class="limit-row"><span class="lr-label">الإجمالي بعد الإضافة:</span><span class="lr-val">${_expFmt(total)} ج.م</span><span style="color:#94A3B8;font-size:11px">/ ${_expFmt(catLimit)} ج.م</span></div>
                <div class="limit-bar"><div class="limit-fill ${cls}" style="width:${Math.min(pct,100).toFixed(1)}%"></div></div>
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <span style="font-size:11px;color:#64748B">${pct.toFixed(1)}% — متبقّي ${_expFmt(Math.max(catLimit-total,0))} ج.م</span>
                    ${pct>=100?'<span class="limit-status red">🔴 تجاوز</span>':pct>=80?'<span class="limit-status orange">🟠 تحذير</span>':'<span class="limit-status green">🟢 سليم</span>'}
                </div>
            </div>`;
    }

    // === فحص الحد الإجمالي ===
    let globalHTML = '';
    let globalExceeded = false;
    if (_expGlobalLimit > 0) {
        const gTotal = monthTotal + amount;
        const gPct = (gTotal / _expGlobalLimit) * 100;
        const gCls = gPct >= 100 ? 'over' : gPct >= 80 ? 'warn' : 'safe';
        globalExceeded = gPct >= 100;
        globalHTML = `
            <div class="limit-box" style="border-color:#DBEAFE;background:#EFF6FF">
                <div style="font-size:12px;color:#64748B;margin-bottom:6px">🎯 الحد الإجمالي الشهري لكل المصروفات</div>
                <div class="limit-row"><span class="lr-label">مصروفات الشهر:</span><span class="lr-val">${_expFmt(monthTotal)} ج.م</span></div>
                <div class="limit-row"><span class="lr-label">بعد هذا المصروف:</span><span class="lr-val">${_expFmt(gTotal)} ج.م</span><span style="color:#94A3B8;font-size:11px">/ ${_expFmt(_expGlobalLimit)} ج.م</span></div>
                <div class="limit-bar"><div class="limit-fill ${gCls}" style="width:${Math.min(gPct,100).toFixed(1)}%"></div></div>
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <span style="font-size:11px;color:#64748B">${gPct.toFixed(1)}% — متبقّي ${_expFmt(Math.max(_expGlobalLimit-gTotal,0))} ج.م</span>
                    ${gPct>=100?'<span class="limit-status red">🔴 تجاوز</span>':gPct>=80?'<span class="limit-status orange">🟠 تحذير</span>':'<span class="limit-status green">🟢 سليم</span>'}
                </div>
            </div>`;
    }

    area.innerHTML = catHTML + globalHTML;
    _expLimitExceeded = catExceeded || globalExceeded;
    document.getElementById('expOverrideBox').classList.toggle('show', _expLimitExceeded);
};

// ════════════════════════════════════════════════════════════
// 6) حفظ المصروف + سجل التجاوزات
// ════════════════════════════════════════════════════════════
async function saveExpense() {
    const catId = document.getElementById('expCatId').value;
    const amount = parseFloat(document.getElementById('expAmount').value);
    const desc = document.getElementById('expDesc').value.trim();
    const date = document.getElementById('expDate').value;

    if (!catId || !amount || !desc) return alert('يرجى ملء جميع الحقول المطلوبة');

    const offline = typeof isOnline === 'function' && !isOnline();

    // فحص التجاوز (بيانات لحظية غير متاحة أوفلاين — بيتفحص تاني وقت المزامنة)
    if (!offline && _expLimitExceeded) {
        const reason = document.getElementById('expOverrideReason').value.trim();
        const isAdmin = _expUserRole === 'admin';
        if (!isAdmin && !reason) {
            return alert('⚠️ يجب إدخال سبب التجاوز أو تسجيل الدخول كمدير');
        }
        // سجل التجاوز قبل الحفظ
        try {
            await sb.from('expense_violations').insert({
                category_id: catId,
                amount,
                reason: reason || '(مدير — بدون سبب)',
                created_by: currentUser?.id || null,
            });
        } catch {}
    }

    const btn = document.querySelector('#expModal .mod-btn-primary');
    btn.innerText = 'جاري الحفظ...'; btn.disabled = true;

    if (offline) {
        try {
            await queueWrite({
                module: 'expenses', kind: 'expense',
                payload: {
                    ref: 'EXP-' + Date.now(),
                    category_id: catId, amount, description: desc,
                    expense_date: date, status: 'confirmed', created_by: currentUser?.id || null,
                },
            });
            expCloseModal('expModal');
            if (typeof offlineToast === 'function') offlineToast('⏳ اتسجّل محلياً — هيتزامن تلقائياً لما الاتصال يرجع', 'info');
            renderExpenses(document.getElementById('app-content'));
        } catch (err) {
            alert('خطأ أثناء الحفظ المحلي: ' + err.message);
        } finally {
            btn.innerText = 'حفظ المصروف'; btn.disabled = false;
        }
        return;
    }

    try {
        const { error } = await sb.from('expenses').insert({
            ref: 'EXP-' + Date.now(),
            category_id: catId,
            amount,
            description: desc,
            expense_date: date,
            status: 'confirmed',
            created_by: currentUser?.id || null,
        }).select();
        if (error) throw error;

        expCloseModal('expModal');
        // تحديث الخزنة في الشريط العلوي
        try {
            const { data: cash } = await sb.rpc('get_cash_balance');
            const tb = document.getElementById('topbarCash');
            if (tb) tb.textContent = '💰 ' + (cash || 0).toFixed(2) + ' ج.م';
        } catch {}
        renderExpenses(document.getElementById('app-content'));
    } catch (err) { alert('خطأ أثناء الحفظ: ' + err.message); }
    finally { btn.innerText = 'حفظ المصروف'; btn.disabled = false; }
}

// ════════════════════════════════════════════════════════════
// 6ب) مزامنة المصروفات المعلّقة (Phase 2 — دعم الأوفلاين)
// ════════════════════════════════════════════════════════════
if (typeof registerSyncHandler === 'function') {
    registerSyncHandler('expense', async (entry) => {
        const payload = entry.payload;
        try {
            const { error } = await sb.from('expenses').insert(payload);
            if (error) return { ok: false, error: error.message, summary: `مصروف ${payload.ref}` };

            // الحد ما كانش اتفحص وقت التسجيل (أوفلاين) — نفحصه دلوقتي ونبلّغ لو اتجاوز
            const flags = [];
            try {
                const { data: catRow } = await sb.from('expense_categories').select('name, monthly_limit').eq('id', payload.category_id).maybeSingle();
                if (catRow && Number(catRow.monthly_limit) > 0) {
                    const { data: monthExp } = await sb.from('expenses').select('amount')
                        .eq('category_id', payload.category_id).eq('status', 'confirmed')
                        .gte('expense_date', _expMonthStart()).lt('expense_date', _expMonthEnd());
                    const used = (monthExp || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
                    if (used > Number(catRow.monthly_limit)) {
                        flags.push(`تجاوز حد بند "${catRow.name}" الشهري (${_expFmt(used)} / ${_expFmt(catRow.monthly_limit)} ج.م) — اتسجّل أوفلاين بدون فحص الحد وقتها`);
                    }
                }
            } catch {}

            return { ok: true, summary: `مصروف ${payload.ref} — ${_expFmt(payload.amount)} ج.م`, flags };
        } catch (err) {
            return { ok: false, error: err.message || String(err), summary: `مصروف ${payload.ref}` };
        }
    });
}

// ════════════════════════════════════════════════════════════
// 7) تعديل الحد الشهري لبند
// ════════════════════════════════════════════════════════════
window.expOpenLimit = function(catId, catName) {
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'expLimitModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:420px">
            <div class="mod-modal-header"><h3>✏️ تعديل حد: ${catName}</h3>
                <button class="mod-modal-close" onclick="expCloseModal('expLimitModal')">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>الحد الشهري الجديد (ج.م)</label>
                    <input type="number" id="expNewLimit" class="mod-form-input" placeholder="0 = بدون حد" step="0.01" dir="ltr">
                    <small style="font-size:11px;color:#64748B;display:block;margin-top:6px">اكتب 0 لإلغاء الحد لهذا البند (بدون رقابة)</small>
                </div>
                <div class="mod-form-group"><label>سبب التعديل (اختياري)</label>
                    <textarea id="expLimitReason" class="mod-form-input" style="resize:vertical;min-height:60px" placeholder="لماذا تم تعديل الحد؟"></textarea>
                </div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="expCloseModal('expLimitModal')">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="expSaveLimit('${catId}')">💾 حفظ الحد</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
};

window.expSaveLimit = async function(catId) {
    const newLimit = parseFloat(document.getElementById('expNewLimit').value);
    if (isNaN(newLimit) || newLimit < 0) return alert('أدخل قيمة صحيحة (0 أو أكثر)');
    const btn = document.querySelector('#expLimitModal .mod-btn-primary');
    btn.innerText = 'جاري...'; btn.disabled = true;
    try {
        const { error } = await sb.from('expense_categories')
            .update({ monthly_limit: newLimit }).eq('id', catId);
        if (error) throw error;
        expCloseModal('expLimitModal');
        renderExpenses(document.getElementById('app-content'));
    } catch (err) { alert('خطأ: ' + err.message); }
    finally { btn.innerText = '💾 حفظ الحد'; btn.disabled = false; }
};

// ════════════════════════════════════════════════════════════
// 8) أدوات مساعدة (تواريخ الشهر)
// ════════════════════════════════════════════════════════════
function _expFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function _expToday() { return new Date().toISOString().split('T')[0]; }
function _expMonthStart() {
    const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
}
function _expMonthEnd() {
    const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().split('T')[0];
}
function _expMonthLabel() {
    const m = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
    return m[new Date().getMonth()];
}
