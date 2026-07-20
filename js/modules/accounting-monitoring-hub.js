/* ════════════════════════════════════════════════════════════
   المحاسبة — المراقبة والأرشفة — accounting-monitoring-hub.js
   صفحة واحدة بتبويبات بدل 3 عناصر منفصلة في القائمة الجانبية —
   💰 حركة الخزينة (renderCashMovement من cash-movement.js)
   🔐 سجل التدقيق (renderAuditLog من audit-log.js)
   🗄️ الأرشيف (renderArchive من archive.js)
   يصدّر: renderAccountingMonitoringHub(container)

   ★ زرار "📄 كشف حساب" جنب كل خزنة (treasury.js's tsyShowStatement)
   بيحط window._pendingAccMonTab='cash-movement' قبل الانتقال — نفس
   فكرة _pendingTreasuryFilter اللي renderCashMovement نفسها بتقرأها.
   ════════════════════════════════════════════════════════════ */

let _accMonTab = 'cash-movement'; // 'cash-movement' | 'audit-log' | 'archive'

async function renderAccountingMonitoringHub(c) {
    if (window._pendingAccMonTab) { _accMonTab = window._pendingAccMonTab; window._pendingAccMonTab = null; }
    c.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap">
        <button class="mod-btn ${_accMonTab==='cash-movement'?'mod-btn-primary':''}" onclick="accMonSwitchTab('cash-movement')">💰 حركة الخزينة</button>
        <button class="mod-btn ${_accMonTab==='audit-log'?'mod-btn-primary':''}" onclick="accMonSwitchTab('audit-log')">🔐 سجل التدقيق</button>
        <button class="mod-btn ${_accMonTab==='archive'?'mod-btn-primary':''}" onclick="accMonSwitchTab('archive')">🗄️ الأرشيف</button>
    </div>
    <div id="accMonBody"></div>`;
    await accMonRenderTab();
}

async function accMonRenderTab() {
    const body = document.getElementById('accMonBody');
    if (!body) return;
    if (_accMonTab === 'audit-log') await renderAuditLog(body);
    else if (_accMonTab === 'archive') await renderArchive(body);
    else await renderCashMovement(body);
}

window.accMonSwitchTab = async function (tab) {
    _accMonTab = tab;
    await renderAccountingMonitoringHub(document.getElementById('app-content'));
};

Object.assign(window, { renderAccountingMonitoringHub, accMonSwitchTab });
