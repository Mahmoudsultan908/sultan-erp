/* ════════════════════════════════════════════════════════════
   زيارات المندوبين — rep_visits
   يصدّر: renderRepVisits(container)

   بيعرض حالة زيارات المندوبين للعملاء ليوم معيّن (افتراضيًا النهاردة) —
   بتتزامن تلقائي من تطبيق سلطانو كل مرة المندوب يغيّر حالة زيارة محل
   (باع / حصّل / رفض / مغلق) من صفحة "🏪 محلات" عنده.
   ════════════════════════════════════════════════════════════ */

let RV_DATE = new Date().toISOString().split('T')[0];
let RV_LIST = [];

function rvStatusLabel(status, notes) {
    if (status === 'visited') return notes ? notes.split(' + ').map(s => ({ sold: '💰 باع', collect: '🔵 حصّل', reject: '❌ رفض', closed: '🔒 مغلق' }[s] || s).join(' + ')).join(' + ') : '✅ اتزار';
    if (status === 'skipped') return '❌ رفض';
    return '⏳ مخطط';
}

async function renderRepVisits(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل الزيارات...</div>';
    try {
        await rvLoad();
        rvRenderPage(c);
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
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

window.rvOnDateChange = async function (val) {
    RV_DATE = val;
    const c = document.getElementById('repMgmtBody') || document.getElementById('app-content');
    await renderRepVisits(c);
};

Object.assign(window, { renderRepVisits, rvOnDateChange });
