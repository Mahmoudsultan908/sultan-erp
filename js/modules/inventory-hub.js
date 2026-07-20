/* ════════════════════════════════════════════════════════════
   المخزون — inventory-hub.js
   صفحة واحدة بتبويبات بدل 4 عناصر منفصلة في القائمة الجانبية —
   🔄 تحويل مخزون (renderStockTransfer من stock-transfer.js)
   📦 الأرصدة (renderInventory من inventory.js)
   🏭 إدارة المخازن (renderWarehouses من warehouses.js)
   📊 تقارير المخازن (renderWarehouseReports من warehouse-reports.js)
   يصدّر: renderInventoryHub(container)
   ════════════════════════════════════════════════════════════ */

let _invHubTab = 'stock'; // 'transfer' | 'stock' | 'warehouses' | 'reports'

async function renderInventoryHub(c) {
    if (window._pendingInvHubTab) { _invHubTab = window._pendingInvHubTab; window._pendingInvHubTab = null; }
    c.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap">
        <button class="mod-btn ${_invHubTab==='transfer'?'mod-btn-primary':''}" onclick="invHubSwitchTab('transfer')">🔄 تحويل مخزون</button>
        <button class="mod-btn ${_invHubTab==='stock'?'mod-btn-primary':''}" onclick="invHubSwitchTab('stock')">📦 الأرصدة</button>
        <button class="mod-btn ${_invHubTab==='warehouses'?'mod-btn-primary':''}" onclick="invHubSwitchTab('warehouses')">🏭 إدارة المخازن</button>
        <button class="mod-btn ${_invHubTab==='reports'?'mod-btn-primary':''}" onclick="invHubSwitchTab('reports')">📊 تقارير المخازن</button>
    </div>
    <div id="invHubBody"></div>`;
    await invHubRenderTab();
}

async function invHubRenderTab() {
    const body = document.getElementById('invHubBody');
    if (!body) return;
    if (_invHubTab === 'transfer') await renderStockTransfer(body);
    else if (_invHubTab === 'warehouses') await renderWarehouses(body);
    else if (_invHubTab === 'reports') await renderWarehouseReports(body);
    else await renderInventory(body);
}

window.invHubSwitchTab = async function (tab) {
    _invHubTab = tab;
    await renderInventoryHub(document.getElementById('app-content'));
};

Object.assign(window, { renderInventoryHub, invHubSwitchTab });
