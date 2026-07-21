/* ════════════════════════════════════════════════════════════
   الأصناف — products-hub.js
   صفحة واحدة بتبويبات بدل عناصر منفصلة في القائمة الجانبية —
   نفس فكرة rep-management.js بالظبط: تبويبات بتستخدم الموديولات
   الموجودة من غير تكرار كود:
   📋 القائمة (renderProducts من products.js)
   📥 استيراد Excel (renderProductImport من product-import.js)
   🔄 تحويل مخزون (renderStockTransfer من stock-transfer.js)
   📦 أرصدة المخزون (renderInventory من inventory.js)
   🏭 إدارة المخازن (renderWarehouses من warehouses.js)
   📊 تقارير المخازن (renderWarehouseReports من warehouse-reports.js)
   يصدّر: renderProductsHub(container)

   ★ تبويبات المخزون الأربعة كانت صفحة مستقلة (inventory-hub.js،
   page_key='inventory-hub') وليها صلاحية منفصلة في role_permissions.
   بعد الدمج، أي دور ممنوع من 'inventory-hub' (زي "محاسب" حاليًا)
   بيشوف صفحة الأصناف عادي لكن من غير تبويبات المخزون الأربعة —
   apGetDeniedSet() من advanced-permissions.js هي نفسها اللي بتتحقق،
   محدش لمسها. inventory-hub.js نفسه سايبه زي ما هو (مش محذوف، بس
   مش متوصل من القائمة الجانبية دلوقتي).
   ════════════════════════════════════════════════════════════ */

let _prodHubTab = 'list'; // 'list' | 'import' | 'transfer' | 'stock' | 'warehouses' | 'reports'

async function renderProductsHub(c) {
    if (window._pendingProdHubTab) { _prodHubTab = window._pendingProdHubTab; window._pendingProdHubTab = null; }
    const invDenied = typeof apGetDeniedSet === 'function' ? (await apGetDeniedSet()).has('inventory-hub') : false;
    if (invDenied && ['transfer', 'stock', 'warehouses', 'reports'].includes(_prodHubTab)) _prodHubTab = 'list';
    c.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap">
        <button class="mod-btn ${_prodHubTab==='list'?'mod-btn-primary':''}" onclick="prodHubSwitchTab('list')">📋 القائمة</button>
        <button class="mod-btn ${_prodHubTab==='import'?'mod-btn-primary':''}" onclick="prodHubSwitchTab('import')">📥 استيراد Excel</button>
        ${invDenied ? '' : `
        <button class="mod-btn ${_prodHubTab==='transfer'?'mod-btn-primary':''}" onclick="prodHubSwitchTab('transfer')">🔄 تحويل مخزون</button>
        <button class="mod-btn ${_prodHubTab==='stock'?'mod-btn-primary':''}" onclick="prodHubSwitchTab('stock')">📦 أرصدة المخزون</button>
        <button class="mod-btn ${_prodHubTab==='warehouses'?'mod-btn-primary':''}" onclick="prodHubSwitchTab('warehouses')">🏭 إدارة المخازن</button>
        <button class="mod-btn ${_prodHubTab==='reports'?'mod-btn-primary':''}" onclick="prodHubSwitchTab('reports')">📊 تقارير المخازن</button>`}
    </div>
    <div id="prodHubBody"></div>`;
    await prodHubRenderTab();
}

async function prodHubRenderTab() {
    const body = document.getElementById('prodHubBody');
    if (!body) return;
    if (_prodHubTab === 'import') await renderProductImport(body);
    else if (_prodHubTab === 'transfer') await renderStockTransfer(body);
    else if (_prodHubTab === 'stock') await renderInventory(body);
    else if (_prodHubTab === 'warehouses') await renderWarehouses(body);
    else if (_prodHubTab === 'reports') await renderWarehouseReports(body);
    else await renderProducts(body);
}

window.prodHubSwitchTab = async function (tab) {
    _prodHubTab = tab;
    await renderProductsHub(document.getElementById('app-content'));
};

Object.assign(window, { renderProductsHub, prodHubSwitchTab });
