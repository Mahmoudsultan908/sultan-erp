/* ════════════════════════════════════════════════════════════
   مندوب سلطان — rep-management.js
   صفحة واحدة موحّدة لكل حاجة تخص المندوبين، بدل ما تكون متفرقة —
   تبويبات بتستخدم نفس الموديولات الموجودة من غير تكرار كود:
   👥 المندوبين (renderSalesReps من sales-reps.js)
   🚗 تحميل عربية (renderVanStockLoad من van-stock-load.js)
   📦 مخزون العربيات (renderVanStockView من van-stock-view.js)
   ↩️ إرجاع للمخزن (renderVanStockReturn من van-stock-return.js)
   📋 مراجعة طلبات المندوبين (renderRepCustomerRequests من rep-customer-requests.js)
   🗺️ زيارات المندوبين (renderRepVisits من rep-visits.js)
   📊 تقرير الإغلاق اليومي (renderRepDailyClosing من rep-daily-closing.js)
   🎯 الأهداف والتحقيق (rvLoadGoals/rvRenderGoalsPage من rep-visits.js —
      كانت تبويب فرعي جوه "زيارات المندوبين"، طلعناها هنا كتبويب مستقل)
   🧮 جرد عربية (renderVanStockCount من van-stock-count.js)
   يصدّر: renderRepAppLink(container) — بيحل محل الاسم/المكان القديم
   "ربط برنامج المندوب" تحت "🔜 قريباً"
   ════════════════════════════════════════════════════════════ */

let _repMgmtTab = 'list'; // 'list' | 'load' | 'stock' | 'return' | 'requests' | 'visits' | 'closing' | 'goals' | 'count'
const REP_LINK_LAST_SEEN_KEY = 'sultan_replink_last_seen';

async function renderRepAppLink(c) {
    repLinkMarkSeen();
    c.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div><h2 style="font-size:22px;font-weight:800">🚗 مندوب سلطان</h2>
        <p style="font-size:13px;color:#64748B;margin-top:4px">إدارة المندوبين، عمولاتهم، مستوى البيع، وتحميل عرباتهم بالمخزون</p></div>
    </div>
    <div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap">
        <button class="mod-btn ${_repMgmtTab==='list'?'mod-btn-primary':''}" onclick="repMgmtSwitchTab('list')">👥 المندوبين</button>
        <button class="mod-btn ${_repMgmtTab==='load'?'mod-btn-primary':''}" onclick="repMgmtSwitchTab('load')">🚗 تحميل عربية</button>
        <button class="mod-btn ${_repMgmtTab==='stock'?'mod-btn-primary':''}" onclick="repMgmtSwitchTab('stock')">📦 مخزون العربيات</button>
        <button class="mod-btn ${_repMgmtTab==='return'?'mod-btn-primary':''}" onclick="repMgmtSwitchTab('return')">↩️ إرجاع للمخزن</button>
        <button class="mod-btn ${_repMgmtTab==='requests'?'mod-btn-primary':''}" onclick="repMgmtSwitchTab('requests')">📋 مراجعة طلبات المندوبين</button>
        <button class="mod-btn ${_repMgmtTab==='visits'?'mod-btn-primary':''}" onclick="repMgmtSwitchTab('visits')">🗺️ زيارات المندوبين</button>
        <button class="mod-btn ${_repMgmtTab==='closing'?'mod-btn-primary':''}" onclick="repMgmtSwitchTab('closing')">📊 تقرير الإغلاق اليومي</button>
        <button class="mod-btn ${_repMgmtTab==='goals'?'mod-btn-primary':''}" onclick="repMgmtSwitchTab('goals')">🎯 الأهداف والتحقيق</button>
        <button class="mod-btn ${_repMgmtTab==='count'?'mod-btn-primary':''}" onclick="repMgmtSwitchTab('count')">🧮 جرد عربية</button>
    </div>
    <div id="repMgmtBody"></div>`;
    await repMgmtRenderTab();
}

async function repMgmtRenderTab() {
    const body = document.getElementById('repMgmtBody');
    if (!body) return;
    if (_repMgmtTab === 'list') await renderSalesReps(body);
    else if (_repMgmtTab === 'load') await renderVanStockLoad(body);
    else if (_repMgmtTab === 'stock') await renderVanStockView(body);
    else if (_repMgmtTab === 'return') await renderVanStockReturn(body);
    else if (_repMgmtTab === 'requests') await renderRepCustomerRequests(body);
    else if (_repMgmtTab === 'closing') await renderRepDailyClosing(body);
    else if (_repMgmtTab === 'goals') { await rvLoadGoals(); rvRenderGoalsPage(body); }
    else if (_repMgmtTab === 'count') await renderVanStockCount(body);
    else await renderRepVisits(body);
}

window.repMgmtSwitchTab = async function (tab) {
    _repMgmtTab = tab;
    await renderRepAppLink(document.getElementById('app-content'));
};

// ════════════════════════════════════════════════════════════
// إشعار "حدث خارجي جديد" جنب تبويب "🚗 مندوب سلطان" فى القائمة الجانبية —
// عدّاد أي حاجة جت من تطبيق سلطانو/مندوب سلطان (طلبات تعديل عملاء معلّقة،
// فواتير بيع، تحصيلات، مصروفات) من بعد آخر مرة الأدمن فتح التبويب ده.
// آخر مرة اتشاف بتتخزن فى localStorage (مفيش جدول "مستخدم/تفضيلات" فى
// السكيمة يصلح لده)، وبيتصفّر بمجرد فتح التبويب — مش لما الطلب يتحسم.
// ════════════════════════════════════════════════════════════
async function repLinkRefreshBadge() {
    try {
        const lastSeen = localStorage.getItem(REP_LINK_LAST_SEEN_KEY) || new Date(Date.now() - 86400000).toISOString();
        const { data: reps } = await sb.from('sales_reps').select('id').eq('is_active', true);
        const repIds = (reps || []).map(r => r.id);

        const queries = [
            sb.from('customer_change_requests').select('id', { count: 'exact', head: true })
                .eq('status', 'pending').gt('created_at', lastSeen),
            sb.from('sales').select('id', { count: 'exact', head: true })
                .eq('source_app', 'rep_van').gt('created_at', lastSeen),
        ];
        if (repIds.length) {
            queries.push(
                sb.from('customer_payments').select('id', { count: 'exact', head: true })
                    .in('created_by', repIds).gt('created_at', lastSeen),
                sb.from('expenses').select('id', { count: 'exact', head: true })
                    .in('created_by', repIds).gt('created_at', lastSeen),
            );
        }
        const results = await Promise.all(queries);
        const total = results.reduce((s, r) => s + (r.count || 0), 0);

        const el = document.getElementById('repLinkBadge');
        if (!el) return;
        if (total > 0) { el.textContent = total; el.style.display = 'inline-block'; }
        else el.style.display = 'none';
    } catch (err) { /* بهدوء — إشعار جانبي، مش لازم يوقف التطبيق */ }
}

function repLinkMarkSeen() {
    localStorage.setItem(REP_LINK_LAST_SEEN_KEY, new Date().toISOString());
    const el = document.getElementById('repLinkBadge');
    if (el) el.style.display = 'none';
}

Object.assign(window, { renderRepAppLink, repMgmtSwitchTab, repLinkRefreshBadge, repLinkMarkSeen });
