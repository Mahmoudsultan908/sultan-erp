/* ════════════════════════════════════════════════════════════
   توقع السيولة — liquidity-forecast.js
   يصدّر: renderLiquidityForecast(container)

   لوحة توقع تدفق نقدي بدل تصنيف رباعي — الخزن قليلة عدداً فمش
   منطقي نصنّفها زي الأصناف/العملاء. بيحسب:
   - السيولة الحالية (get_treasury_balances RPC، نفس اللي شاشة
     "🏦 الخزن" بتستخدمه).
   - جدول تحصيل متوقع من العملاء وسداد متوقع للموردين، مبني على
     نفس أسلوب الـ FIFO التقريبي المستخدم في مركز قرار العملاء/الموردين
     (فواتير آجلة مرتبة بتاريخ الاستحقاق، المدفوعات بتتخصم الأقدم فالأقدم)
     — هنا بنحسب *كل* الفواتير المفتوحة مش بس أقدمها، عشان نوزّعها على
     نوافذ 7/14/30 يوم.
   - مصروفات تشغيلية متوقعة = متوسط آخر 30 يوم × عدد أيام النافذة
     (تقدير اتجاهي، مش التزام فعلي زي الفواتير الآجلة).
   - رواتب مستحقة = إجمالي رواتب الموظفين النشطين، منسوبة لعدد أيام
     النافذة (افتراض دفع شهري).
   ★ نفس ملاحظات مراكز قرار العملاء/الموردين: مرتجعات مش داخلة في
   حساب الـ FIFO، والفواتير من غير due_date بتتقدّر بـ +15 يوم.
   ════════════════════════════════════════════════════════════ */

let lqfRules = { min_safe_cash: 0 };
let lqfData = null;
let lqfSaveTimer = null;

const LQF_DEFAULT_TERM_DAYS = 15;

function lqfFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function lqfEstimateDueDate(createdAt) {
    const d = new Date(createdAt);
    d.setDate(d.getDate() + LQF_DEFAULT_TERM_DAYS);
    return d.toISOString().slice(0, 10);
}

// يرجّع كل الفواتير المفتوحة (مش بس أقدمها) — FIFO: المدفوعات بتقفل الأقدم
// فالأقدم، وأي حاجة بعدها في الترتيب تفضل مفتوحة بالكامل
function lqfOpenSchedule(docsByEntity, paidByEntity) {
    const schedule = [];
    Object.keys(docsByEntity).forEach(eid => {
        const sorted = docsByEntity[eid].slice().sort((a, b) => a.due < b.due ? -1 : (a.due > b.due ? 1 : 0));
        let remaining = paidByEntity[eid] || 0;
        for (const doc of sorted) {
            if (remaining >= doc.total - 0.01) { remaining -= doc.total; continue; }
            schedule.push({ due: doc.due, amount: doc.total - remaining });
            remaining = 0;
        }
    });
    return schedule;
}

function lqfBucket(schedule, days, todayStr) {
    const cutoff = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    return schedule.filter(s => s.due <= cutoff).reduce((s, x) => s + x.amount, 0);
}

async function renderLiquidityForecast(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات السيولة...</div>';
    try {
        await lqfLoadRules();
        await lqfLoadAndCompute(c);
    } catch (err) {
        c.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

async function lqfLoadRules() {
    const { data } = await sb.from('app_settings').select('value').eq('key', 'liquidity_rules').maybeSingle();
    if (data?.value) lqfRules = Object.assign({}, lqfRules, data.value);
}

function lqfSaveRules() {
    clearTimeout(lqfSaveTimer);
    lqfSaveTimer = setTimeout(() => {
        sb.from('app_settings').upsert({ key: 'liquidity_rules', value: lqfRules, updated_at: new Date().toISOString() }).then(() => {});
    }, 400);
}

async function lqfLoadAndCompute(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات السيولة...</div>';
    const since30 = new Date(Date.now() - 30 * 86400000).toISOString();

    const [
        { data: treasuries },
        { data: creditSales }, { data: custPayments },
        { data: creditPurchases }, { data: suppPayments },
        { data: recentExpenses },
        { data: employees },
    ] = await Promise.all([
        sb.rpc('get_treasury_balances'),
        sb.from('sales').select('customer_id,total,due_date,created_at').eq('status', 'confirmed').eq('payment_type', 'credit'),
        sb.from('customer_payments').select('customer_id,amount,discount').eq('status', 'confirmed'),
        sb.from('purchases').select('supplier_id,total,due_date,created_at').eq('status', 'confirmed').eq('payment_type', 'credit'),
        sb.from('supplier_payments').select('supplier_id,amount').eq('status', 'confirmed'),
        sb.from('expenses').select('amount,expense_date').eq('status', 'confirmed').gte('expense_date', since30.slice(0, 10)),
        sb.from('employees').select('base_salary').eq('is_active', true),
    ]);

    const currentCash = (treasuries || []).reduce((s, t) => s + (Number(t.balance) || 0), 0);

    const custDocs = {}, custPaid = {};
    (creditSales || []).forEach(s => {
        if (!s.customer_id) return;
        (custDocs[s.customer_id] || (custDocs[s.customer_id] = [])).push({ total: Number(s.total) || 0, due: s.due_date || lqfEstimateDueDate(s.created_at) });
    });
    (custPayments || []).forEach(p => {
        if (!p.customer_id) return;
        custPaid[p.customer_id] = (custPaid[p.customer_id] || 0) + (Number(p.amount) || 0) + (Number(p.discount) || 0);
    });
    const arSchedule = lqfOpenSchedule(custDocs, custPaid);

    const suppDocs = {}, suppPaid = {};
    (creditPurchases || []).forEach(p => {
        if (!p.supplier_id) return;
        (suppDocs[p.supplier_id] || (suppDocs[p.supplier_id] = [])).push({ total: Number(p.total) || 0, due: p.due_date || lqfEstimateDueDate(p.created_at) });
    });
    (suppPayments || []).forEach(p => {
        if (!p.supplier_id) return;
        suppPaid[p.supplier_id] = (suppPaid[p.supplier_id] || 0) + (Number(p.amount) || 0);
    });
    const apSchedule = lqfOpenSchedule(suppDocs, suppPaid);

    const avgDailyExpense = (recentExpenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0) / 30;
    const monthlyPayroll = (employees || []).reduce((s, e) => s + (Number(e.base_salary) || 0), 0);

    lqfData = { currentCash, arSchedule, apSchedule, avgDailyExpense, monthlyPayroll };
    lqfRenderScreen(c);
}

function lqfRenderScreen(c) {
    const { currentCash, arSchedule, apSchedule, avgDailyExpense, monthlyPayroll } = lqfData;
    const windows = [7, 14, 30];
    const rows = windows.map(days => {
        const ar = lqfBucket(arSchedule, days);
        const ap = lqfBucket(apSchedule, days);
        const expenseProj = avgDailyExpense * days;
        const payrollProj = monthlyPayroll * (days / 30);
        const net = ar - ap - expenseProj - payrollProj;
        const projected = currentCash + net;
        return { days, ar, ap, expenseProj, payrollProj, net, projected };
    });

    const projected30 = rows[2].projected;
    let health;
    if (currentCash < lqfRules.min_safe_cash) health = { key: 'danger', label: '🔴 خطر فوري', color: 'var(--inv-red)', bg: 'var(--inv-red-bg)', msg: 'السيولة الحالية أقل من الحد الأدنى الآمن دلوقتي' };
    else if (projected30 < lqfRules.min_safe_cash) health = { key: 'warning', label: '🟡 تحذير', color: 'var(--inv-gold)', bg: 'var(--inv-gold-bg)', msg: 'السيولة المتوقعة هتقل عن الحد الآمن خلال 30 يوم لو الحركة كملت بنفس الاتجاه' };
    else health = { key: 'safe', label: '🟢 آمن', color: 'var(--inv-green)', bg: 'var(--inv-green-light)', msg: 'السيولة المتوقعة فوق الحد الآمن خلال الـ 30 يوم القادمة' };

    c.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;flex-wrap:wrap;gap:10px">
        <div><h2 style="font-size:22px;font-weight:800">💧 توقع السيولة</h2>
        <p style="font-size:13px;color:var(--inv-muted);margin-top:4px">توقع تدفق نقدي بناءً على تواريخ استحقاق الفواتير الآجلة الفعلية + اتجاه المصروفات والرواتب</p></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div class="mod-card" style="text-align:center;padding:20px">
            <div style="font-size:13px;color:var(--inv-muted);font-weight:700">💰 السيولة الحالية (كل الخزن)</div>
            <div style="font-size:30px;font-weight:900;margin-top:6px">${lqfFmt(currentCash)} <small style="font-size:14px;font-weight:600;color:var(--inv-muted)">ج.م</small></div>
        </div>
        <div class="mod-card" style="text-align:center;padding:20px;background:${health.bg}">
            <div style="font-size:13px;font-weight:700;color:${health.color}">${health.label}</div>
            <div style="font-size:13px;color:var(--inv-text-soft);margin-top:8px">${health.msg}</div>
        </div>
    </div>

    <div class="mod-card" style="padding:0;overflow-x:auto;margin-bottom:16px">
        <table class="mod-table"><thead><tr>
            <th>النافذة</th>
            <th title="مجموع الفواتير الآجلة المفتوحة (لسه من غير سداد كامل) اللي تاريخ استحقاقها خلال النافذة دي أو قبلها">+ تحصيل متوقع من العملاء</th>
            <th title="مجموع فواتير الشراء الآجلة المفتوحة اللي تاريخ استحقاقها خلال النافذة دي أو قبلها">- سداد متوقع للموردين</th>
            <th title="متوسط آخر 30 يوم × عدد أيام النافذة — تقدير اتجاهي مش التزام فعلي">- مصروفات متوقعة</th>
            <th title="إجمالي رواتب الموظفين النشطين، منسوبة لعدد أيام النافذة">- رواتب مستحقة</th>
            <th>= صافي الحركة</th>
            <th>السيولة المتوقعة</th>
        </tr></thead><tbody>
            ${rows.map(r => `<tr>
                <td><strong>خلال ${r.days} يوم</strong></td>
                <td style="color:var(--inv-green)">+${lqfFmt(r.ar)}</td>
                <td style="color:var(--inv-red)">-${lqfFmt(r.ap)}</td>
                <td style="color:var(--inv-red)">-${lqfFmt(r.expenseProj)}</td>
                <td style="color:var(--inv-red)">-${lqfFmt(r.payrollProj)}</td>
                <td style="font-weight:700;color:${r.net >= 0 ? 'var(--inv-green)' : 'var(--inv-red)'}">${r.net >= 0 ? '+' : ''}${lqfFmt(r.net)}</td>
                <td style="font-weight:800;color:${r.projected < lqfRules.min_safe_cash ? 'var(--inv-red)' : 'var(--inv-text)'}">${lqfFmt(r.projected)}</td>
            </tr>`).join('')}
        </tbody></table>
    </div>

    <div class="mod-card" style="max-width:420px">
        <h3 style="font-size:15px;font-weight:800;margin-bottom:14px">⚙️ الحد الأدنى الآمن للسيولة</h3>
        <div style="margin-bottom:10px">
            <input type="number" id="lqfMinSafe" class="mod-form-input" value="${lqfRules.min_safe_cash}" min="0" step="500" oninput="lqfOnMinSafeInput(this.value)">
        </div>
        <button class="mod-btn mod-btn-primary" style="width:100%" onclick="lqfSmartSuggest()">✨ اقتراح ذكي (نص شهر مصروفات)</button>
    </div>
    `;
}

function lqfOnMinSafeInput(val) {
    lqfRules.min_safe_cash = parseFloat(val) || 0;
    lqfSaveRules();
    lqfRenderScreen(document.getElementById('app-content'));
}

function lqfSmartSuggest() {
    lqfRules.min_safe_cash = Math.round(lqfData.avgDailyExpense * 15);
    lqfSaveRules();
    lqfRenderScreen(document.getElementById('app-content'));
}

Object.assign(window, { renderLiquidityForecast, lqfOnMinSafeInput, lqfSmartSuggest });
