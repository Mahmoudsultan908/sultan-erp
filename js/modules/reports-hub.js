/* ════════════════════════════════════════════════════════════
   التقارير — reports-hub.js
   صفحة واحدة بتبويبات بدل عنصرين منفصلين في القائمة الجانبية —
   📈 عام (renderReports من reports.js)
   📈 أداء متقدم (renderPerformanceReports من performance-reports.js)
   يصدّر: renderReportsHub(container)
   ════════════════════════════════════════════════════════════ */

let _rptHubTab = 'general'; // 'general' | 'performance'

async function renderReportsHub(c) {
    c.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap">
        <button class="mod-btn ${_rptHubTab==='general'?'mod-btn-primary':''}" onclick="rptHubSwitchTab('general')">📈 عام</button>
        <button class="mod-btn ${_rptHubTab==='performance'?'mod-btn-primary':''}" onclick="rptHubSwitchTab('performance')">📈 أداء متقدم</button>
    </div>
    <div id="rptHubBody"></div>`;
    await rptHubRenderTab();
}

async function rptHubRenderTab() {
    const body = document.getElementById('rptHubBody');
    if (!body) return;
    if (_rptHubTab === 'performance') await renderPerformanceReports(body);
    else await renderReports(body);
}

window.rptHubSwitchTab = async function (tab) {
    _rptHubTab = tab;
    await renderReportsHub(document.getElementById('app-content'));
};

Object.assign(window, { renderReportsHub, rptHubSwitchTab });
