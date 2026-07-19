/* ════════════════════════════════════════════════════════════
   زيارات المندوبين — rep_visits + خطوط السير — rep_routes/rep_route_customers
   يصدّر: renderRepVisits(container)

   بيعرض حالة زيارات المندوبين للعملاء ليوم معيّن (افتراضيًا النهاردة) —
   بتتزامن تلقائي من تطبيق سلطانو كل مرة المندوب يغيّر حالة زيارة محل
   (باع / حصّل / رفض / مغلق) من صفحة "🏪 محلات" عنده. وتبويب فرعي لخطوط
   السير الأسبوعية الثابتة (أي عميل معيّن لأي يوم) من صفحة "🗺️ الخط".
   ════════════════════════════════════════════════════════════ */

let RV_DATE = new Date().toISOString().split('T')[0];
let RV_LIST = [];
let RV_SUBTAB = 'visits'; // 'visits' | 'routes'
let RV_ROUTES = [];
const RV_WEEKDAY_NAMES = { sunday: 'الأحد', monday: 'الإثنين', tuesday: 'الثلاثاء', wednesday: 'الأربعاء', thursday: 'الخميس', friday: 'الجمعة', saturday: 'السبت' };

function rvStatusLabel(status, notes) {
    if (status === 'visited') return notes ? notes.split(' + ').map(s => ({ sold: '💰 باع', collect: '🔵 حصّل', reject: '❌ رفض', closed: '🔒 مغلق' }[s] || s).join(' + ')).join(' + ') : '✅ اتزار';
    if (status === 'skipped') return '❌ رفض';
    return '⏳ مخطط';
}

async function renderRepVisits(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل...</div>';
    try {
        if (RV_SUBTAB === 'visits') { await rvLoad(); rvRenderPage(c); }
        else { await rvLoadRoutes(); rvRenderRoutesPage(c); }
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function rvSubtabsHTML() {
    return `<div style="display:flex;gap:8px;margin-bottom:16px">
        <button class="mod-btn ${RV_SUBTAB==='visits'?'mod-btn-primary':''}" onclick="rvSwitchSubtab('visits')">📋 زيارات اليوم</button>
        <button class="mod-btn ${RV_SUBTAB==='routes'?'mod-btn-primary':''}" onclick="rvSwitchSubtab('routes')">🗺️ خطوط السير الأسبوعية</button>
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
    const { data, error } = await sb.from('rep_routes')
        .select('*, rep:rep_id(name), rep_route_customers(customer_id, sequence, customer:customer_id(name))')
        .order('day_of_week');
    if (error) throw error;
    RV_ROUTES = data || [];
}

function rvRenderRoutesPage(c) {
    const byRep = {};
    RV_ROUTES.forEach(r => {
        const repName = r.rep?.name || '—';
        (byRep[repName] = byRep[repName] || []).push(r);
    });
    c.innerHTML = `
    ${rvSubtabsHTML()}
    <div style="font-size:13px;color:#64748B;margin-bottom:14px">بتتزامن تلقائي من صفحة "🗺️ الخط" فى تطبيق سلطانو — للعرض فقط.</div>
    ${Object.keys(byRep).length ? Object.entries(byRep).map(([repName, routes]) => `
        <div class="mod-card" style="margin-bottom:16px">
            <div style="font-weight:800;font-size:14px;color:#1E293B;margin-bottom:10px">🚗 ${repName}</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">
                ${routes.map(r => {
                    const custs = (r.rep_route_customers || []).sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
                    return `<div style="border:1px solid #E2E8F0;border-radius:10px;padding:10px 12px">
                        <div style="font-weight:700;font-size:13px;color:#334155;margin-bottom:6px">${RV_WEEKDAY_NAMES[r.day_of_week] || r.day_of_week} (${custs.length})</div>
                        ${custs.length ? custs.map(rc => `<div style="font-size:12.5px;color:#475569;padding:2px 0">• ${rc.customer?.name || '—'}</div>`).join('') : '<div style="font-size:12px;color:#94A3B8">فاضي</div>'}
                    </div>`;
                }).join('')}
            </div>
        </div>`).join('') : `<div class="empty-state"><span>🗺️</span>مفيش خطوط سير متسجّلة لأي مندوب لسه</div>`}`;
}

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

Object.assign(window, { renderRepVisits, rvOnDateChange, rvSwitchSubtab });
