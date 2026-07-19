/* ════════════════════════════════════════════════════════════
   زيارات المندوبين — rep_visits + خطوط السير — rep_routes/rep_route_customers
   يصدّر: renderRepVisits(container)

   بيعرض حالة زيارات المندوبين للعملاء ليوم معيّن (افتراضيًا النهاردة) —
   بتتزامن تلقائي من تطبيق سلطانو كل مرة المندوب يغيّر حالة زيارة محل
   (باع / حصّل / رفض / مغلق) من صفحة "🏪 محلات" عنده.

   خطوط السير (تبويب فرعي): بتتحكم فيها من هنا — إضافة/حذف عميل لأي
   يوم لأي مندوب. المندوب من تطبيقه يقدر يضيف بس مايقدرش يشيل (تصميم
   متعمد، راجع van-stock-load.js وأخواتها لنفس الفلسفة "التحكم من سلطان").
   ════════════════════════════════════════════════════════════ */

let RV_DATE = new Date().toISOString().split('T')[0];
let RV_LIST = [];
let RV_SUBTAB = 'visits'; // 'visits' | 'routes' | 'goals'
let RV_ROUTES = [];
let RV_REPS = [];
let RV_REP_CUSTOMERS = {}; // repId => [{id,name}]
let RV_GOAL_REPS = [];
let RV_GOAL_DAILY = {}; // repId => {date: {salesAmt, visitsCount}}
let RV_GOAL_SELECTED_REP = null;
const RV_WEEKDAYS = [
    ['sunday', 'الأحد'], ['monday', 'الإثنين'], ['tuesday', 'الثلاثاء'], ['wednesday', 'الأربعاء'],
    ['thursday', 'الخميس'], ['friday', 'الجمعة'], ['saturday', 'السبت'],
];
const RV_WEEKDAY_NAMES = Object.fromEntries(RV_WEEKDAYS);

function rvStatusLabel(status, notes) {
    if (status === 'visited') return notes ? notes.split(' + ').map(s => ({ sold: '💰 باع', collect: '🔵 حصّل', reject: '❌ رفض', closed: '🔒 مغلق' }[s] || s).join(' + ')).join(' + ') : '✅ اتزار';
    if (status === 'skipped') return '❌ رفض';
    return '⏳ مخطط';
}

async function renderRepVisits(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل...</div>';
    try {
        if (RV_SUBTAB === 'visits') { await rvLoad(); rvRenderPage(c); }
        else if (RV_SUBTAB === 'routes') { await rvLoadRoutes(); rvRenderRoutesPage(c); }
        else { await rvLoadGoals(); rvRenderGoalsPage(c); }
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function rvSubtabsHTML() {
    return `<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        <button class="mod-btn ${RV_SUBTAB==='visits'?'mod-btn-primary':''}" onclick="rvSwitchSubtab('visits')">📋 زيارات اليوم</button>
        <button class="mod-btn ${RV_SUBTAB==='routes'?'mod-btn-primary':''}" onclick="rvSwitchSubtab('routes')">🗺️ خطوط السير الأسبوعية</button>
        <button class="mod-btn ${RV_SUBTAB==='goals'?'mod-btn-primary':''}" onclick="rvSwitchSubtab('goals')">🎯 الأهداف والتحقيق</button>
    </div>`;
}

async function rvLoad() {
    const { data, error } = await sb.from('rep_visits')
        .select('*, rep:rep_id(name), customer:customer_id(name,phone)')
        .eq('visit_date', RV_DATE)
        .order('checked_in_at', { ascending: false });
    if (error) throw error;
    RV_LIST = data || [];
}

function rvRenderPage(c) {
    const byRep = {};
    RV_LIST.forEach(v => {
        const repName = v.rep?.name || '—';
        (byRep[repName] = byRep[repName] || []).push(v);
    });
    const visited = RV_LIST.filter(v => v.status === 'visited').length;
    const skipped = RV_LIST.filter(v => v.status === 'skipped').length;

    c.innerHTML = `
    ${rvSubtabsHTML()}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div style="display:flex;align-items:center;gap:10px">
            <input type="date" id="rvDate" class="mod-form-input" style="margin:0;width:auto" value="${RV_DATE}" onchange="rvOnDateChange(this.value)">
            <span style="font-size:13px;color:#64748B">${RV_LIST.length} زيارة مسجّلة — ${visited} باع/حصّل، ${skipped} رفض</span>
        </div>
    </div>
    ${Object.keys(byRep).length ? Object.entries(byRep).map(([repName, visits]) => `
        <div class="mod-table-wrap" style="margin-bottom:16px">
            <div style="padding:14px 18px 0;font-weight:800;font-size:14px;color:#1E293B">🚗 ${repName} (${visits.length})</div>
            <table class="mod-table"><thead><tr>
                <th>العميل</th><th>التليفون</th><th>الحالة</th><th style="text-align:left">الوقت</th>
            </tr></thead><tbody>
                ${visits.map(v => `<tr>
                    <td>${v.customer?.name || '—'}</td>
                    <td dir="ltr" style="text-align:right">${v.customer?.phone || '—'}</td>
                    <td>${rvStatusLabel(v.status, v.notes)}</td>
                    <td style="text-align:left;color:#64748B">${v.checked_in_at ? new Date(v.checked_in_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                </tr>`).join('')}
            </tbody></table>
        </div>`).join('') : `<div class="empty-state"><span>🗺️</span>مفيش زيارات مسجّلة فى اليوم ده</div>`}`;
}

async function rvLoadRoutes() {
    const [{ data: reps }, { data: customers }, { data: routes }] = await Promise.all([
        sb.from('sales_reps').select('id,name').eq('is_active', true).order('name'),
        sb.from('customers').select('id,name,default_rep_id,primary_rep_id').eq('is_active', true),
        sb.from('rep_routes').select('*, rep_route_customers(id, customer_id, customer:customer_id(name))'),
    ]);
    RV_REPS = reps || [];
    RV_ROUTES = routes || [];
    RV_REP_CUSTOMERS = {};
    (customers || []).forEach(cu => {
        const repId = cu.default_rep_id || cu.primary_rep_id;
        if (!repId) return;
        (RV_REP_CUSTOMERS[repId] = RV_REP_CUSTOMERS[repId] || []).push(cu);
    });
}

function rvRenderRoutesPage(c) {
    const repsWithCustomers = RV_REPS.filter(r => (RV_REP_CUSTOMERS[r.id] || []).length);
    c.innerHTML = `
    ${rvSubtabsHTML()}
    <div class="al al-teal" style="margin-bottom:14px;font-size:12px">أنت اللي بتتحكم فى خط السير من هنا — المندوب من تطبيقه يقدر يضيف عميل بس، مايقدرش يشيل حاجة أنت حاططها.</div>
    ${repsWithCustomers.length ? repsWithCustomers.map(rep => {
        const linkedCustomers = RV_REP_CUSTOMERS[rep.id] || [];
        return `<div class="mod-card" style="margin-bottom:16px">
            <div style="font-weight:800;font-size:14px;color:#1E293B;margin-bottom:10px">🚗 ${rep.name}</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">
                ${RV_WEEKDAYS.map(([dayKey, dayName]) => {
                    const route = RV_ROUTES.find(r => r.rep_id === rep.id && r.day_of_week === dayKey);
                    const assigned = route?.rep_route_customers || [];
                    const assignedIds = new Set(assigned.map(a => a.customer_id));
                    const available = linkedCustomers.filter(cu => !assignedIds.has(cu.id));
                    return `<div style="border:1px solid #E2E8F0;border-radius:10px;padding:10px 12px">
                        <div style="font-weight:700;font-size:13px;color:#334155;margin-bottom:6px">${dayName} (${assigned.length})</div>
                        ${assigned.map(a => `<div style="display:flex;justify-content:space-between;align-items:center;font-size:12.5px;color:#475569;padding:3px 0">
                            <span>${a.customer?.name || '—'}</span>
                            <button onclick="rvRemoveRouteCustomer('${a.id}')" style="background:none;border:none;color:#EF4444;cursor:pointer;font-size:13px;padding:0 4px">✕</button>
                        </div>`).join('')}
                        ${available.length ? `<div style="display:flex;gap:4px;margin-top:8px">
                            <select id="rv-add-${rep.id}-${dayKey}" style="flex:1;font-size:11.5px;padding:4px 6px;border:1px solid #E2E8F0;border-radius:6px">
                                ${available.map(cu => `<option value="${cu.id}">${cu.name}</option>`).join('')}
                            </select>
                            <button onclick="rvAddRouteCustomer('${rep.id}','${dayKey}','${dayName}')" style="background:#DCFCE7;color:#166534;border:none;border-radius:6px;padding:4px 8px;font-size:11.5px;cursor:pointer">+</button>
                        </div>` : ''}
                    </div>`;
                }).join('')}
            </div>
        </div>`;
    }).join('') : `<div class="empty-state"><span>🗺️</span>مفيش مندوب عنده عملاء متسجّلين لسه (بيانات أساسية → العملاء → المندوب الأساسي)</div>`}`;
}

window.rvAddRouteCustomer = async function (repId, dayKey, dayName) {
    const sel = document.getElementById(`rv-add-${repId}-${dayKey}`);
    const customerId = sel?.value;
    if (!customerId) return;
    try {
        let route = RV_ROUTES.find(r => r.rep_id === repId && r.day_of_week === dayKey);
        if (!route) {
            const { data, error } = await sb.from('rep_routes').insert({ rep_id: repId, name: 'خط ' + dayName, day_of_week: dayKey }).select('id').single();
            if (error) throw error;
            route = { id: data.id, rep_id: repId, day_of_week: dayKey, rep_route_customers: [] };
            RV_ROUTES.push(route);
        }
        const { error: insErr } = await sb.from('rep_route_customers').insert({ route_id: route.id, customer_id: customerId });
        if (insErr) throw insErr;
        const c = document.getElementById('repMgmtBody') || document.getElementById('app-content');
        await renderRepVisits(c);
    } catch (err) { alert('خطأ: ' + err.message); }
};

window.rvRemoveRouteCustomer = async function (routeCustomerId) {
    try {
        const { error } = await sb.from('rep_route_customers').delete().eq('id', routeCustomerId);
        if (error) throw error;
        const c = document.getElementById('repMgmtBody') || document.getElementById('app-content');
        await renderRepVisits(c);
    } catch (err) { alert('خطأ: ' + err.message); }
};

// ════════════════════════════════════════════════════════════
// الأهداف والتحقيق — محسوبة مباشرة من بيانات سلطان الحقيقية (sales +
// rep_visits)، مش من رقم بيوصل من تليفون المندوب — عشان تفضل دقيقة
// حتى لو المندوب أوفلاين أو بياناته المحلية اختلفت لأي سبب.
// ════════════════════════════════════════════════════════════
const RV_GOAL_DAYS = 14; // آخر كام يوم يظهروا فى السجل اليومي

async function rvLoadGoals() {
    const since = new Date(); since.setDate(since.getDate() - (RV_GOAL_DAYS - 1));
    const sinceStr = since.toISOString().slice(0, 10);
    const [{ data: reps }, { data: sales }, { data: visits }] = await Promise.all([
        sb.from('sales_reps').select('id,name,daily_sales_target,daily_visits_target').eq('is_active', true).order('name'),
        sb.from('sales').select('rep_id,total,created_at').eq('status', 'confirmed').not('rep_id', 'is', null).gte('created_at', sinceStr),
        sb.from('rep_visits').select('rep_id,visit_date,status').in('status', ['visited', 'skipped']).gte('visit_date', sinceStr),
    ]);
    RV_GOAL_REPS = reps || [];
    if (!RV_GOAL_SELECTED_REP && RV_GOAL_REPS.length) RV_GOAL_SELECTED_REP = RV_GOAL_REPS[0].id;

    RV_GOAL_DAILY = {};
    const ensure = (repId, date) => {
        RV_GOAL_DAILY[repId] = RV_GOAL_DAILY[repId] || {};
        return RV_GOAL_DAILY[repId][date] = RV_GOAL_DAILY[repId][date] || { salesAmt: 0, visitsCount: 0 };
    };
    (sales || []).forEach(s => {
        const date = (s.created_at || '').slice(0, 10);
        ensure(s.rep_id, date).salesAmt += Number(s.total) || 0;
    });
    (visits || []).forEach(v => {
        ensure(v.rep_id, v.visit_date).visitsCount += 1;
    });
}

function rvRenderGoalsPage(c) {
    if (!RV_GOAL_REPS.length) {
        c.innerHTML = rvSubtabsHTML() + `<div class="empty-state"><span>🎯</span>مفيش مندوبين نشطين لسه</div>`;
        return;
    }
    const rep = RV_GOAL_REPS.find(r => r.id === RV_GOAL_SELECTED_REP) || RV_GOAL_REPS[0];
    const salesTarget = Number(rep.daily_sales_target) || 0;
    const visitsTarget = Number(rep.daily_visits_target) || 0;
    const today = new Date().toISOString().slice(0, 10);
    const todayData = (RV_GOAL_DAILY[rep.id] || {})[today] || { salesAmt: 0, visitsCount: 0 };
    const salesPct = salesTarget > 0 ? Math.min(100, Math.round(todayData.salesAmt / salesTarget * 100)) : 0;
    const visitsPct = visitsTarget > 0 ? Math.min(100, Math.round(todayData.visitsCount / visitsTarget * 100)) : 0;

    const days = [];
    for (let i = 0; i < RV_GOAL_DAYS; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        days.push(d.toISOString().slice(0, 10));
    }
    const dayData = RV_GOAL_DAILY[rep.id] || {};

    c.innerHTML = `
    ${rvSubtabsHTML()}
    <div style="margin-bottom:16px">
        <select class="mod-form-input" style="width:auto" onchange="rvOnGoalRepChange(this.value)">
            ${RV_GOAL_REPS.map(r => `<option value="${r.id}" ${r.id === rep.id ? 'selected' : ''}>🚗 ${r.name}</option>`).join('')}
        </select>
        <span style="font-size:12px;color:#64748B;margin-right:8px">الأهداف بتتظبط من "👥 المندوبين"</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px">
        <div class="mod-card">
            <div style="font-size:13px;color:#64748B;margin-bottom:8px">🎯 هدف المبيعات اليوم</div>
            <div style="font-size:22px;font-weight:900;color:#1E293B">${todayData.salesAmt.toLocaleString('en-US')} <small style="font-size:13px;color:#94A3B8">/ ${salesTarget.toLocaleString('en-US')}</small></div>
            <div style="background:#F1F5F9;border-radius:8px;height:8px;margin-top:8px;overflow:hidden"><div style="width:${salesPct}%;height:100%;background:${salesPct>=100?'#059669':salesPct>=60?'#F59E0B':'#EF4444'}"></div></div>
            <div style="font-size:12px;color:#64748B;margin-top:4px">${salesPct}%</div>
        </div>
        <div class="mod-card">
            <div style="font-size:13px;color:#64748B;margin-bottom:8px">🏪 هدف الزيارات اليوم</div>
            <div style="font-size:22px;font-weight:900;color:#1E293B">${todayData.visitsCount} <small style="font-size:13px;color:#94A3B8">/ ${visitsTarget}</small></div>
            <div style="background:#F1F5F9;border-radius:8px;height:8px;margin-top:8px;overflow:hidden"><div style="width:${visitsPct}%;height:100%;background:${visitsPct>=100?'#059669':visitsPct>=60?'#F59E0B':'#EF4444'}"></div></div>
            <div style="font-size:12px;color:#64748B;margin-top:4px">${visitsPct}%</div>
        </div>
    </div>
    <div class="mod-table-wrap">
        <div style="padding:14px 18px 0;font-weight:800;font-size:14px;color:#1E293B">📅 سجل آخر ${RV_GOAL_DAYS} يوم — للمقارنة</div>
        <table class="mod-table"><thead><tr>
            <th>التاريخ</th><th>مبيعات</th><th>هدف المبيعات</th><th>نسبة</th><th>زيارات</th><th>هدف الزيارات</th><th>نسبة</th>
        </tr></thead><tbody>
            ${days.map(date => {
                const d = dayData[date] || { salesAmt: 0, visitsCount: 0 };
                const sp = salesTarget > 0 ? Math.round(d.salesAmt / salesTarget * 100) : 0;
                const vp = visitsTarget > 0 ? Math.round(d.visitsCount / visitsTarget * 100) : 0;
                return `<tr>
                    <td>${new Date(date).toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                    <td>${d.salesAmt.toLocaleString('en-US')}</td>
                    <td style="color:#94A3B8">${salesTarget.toLocaleString('en-US')}</td>
                    <td style="font-weight:700;color:${sp>=100?'#059669':sp>=60?'#B45309':'#DC2626'}">${sp}%</td>
                    <td>${d.visitsCount}</td>
                    <td style="color:#94A3B8">${visitsTarget}</td>
                    <td style="font-weight:700;color:${vp>=100?'#059669':vp>=60?'#B45309':'#DC2626'}">${vp}%</td>
                </tr>`;
            }).join('')}
        </tbody></table>
    </div>`;
}

window.rvOnGoalRepChange = async function (repId) {
    RV_GOAL_SELECTED_REP = repId;
    const c = document.getElementById('repMgmtBody') || document.getElementById('app-content');
    rvRenderGoalsPage(c);
};

window.rvOnDateChange = async function (val) {
    RV_DATE = val;
    const c = document.getElementById('repMgmtBody') || document.getElementById('app-content');
    await renderRepVisits(c);
};

window.rvSwitchSubtab = async function (tab) {
    RV_SUBTAB = tab;
    const c = document.getElementById('repMgmtBody') || document.getElementById('app-content');
    await renderRepVisits(c);
};

Object.assign(window, { renderRepVisits, rvOnDateChange, rvSwitchSubtab, rvAddRouteCustomer, rvRemoveRouteCustomer, rvOnGoalRepChange });
