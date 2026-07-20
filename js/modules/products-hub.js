/* ════════════════════════════════════════════════════════════
   الأصناف — products-hub.js
   صفحة واحدة بتبويبات بدل تبويبين منفصلين في القائمة الجانبية —
   نفس فكرة rep-management.js بالظبط: تبويبات بتستخدم الموديولات
   الموجودة من غير تكرار كود:
   📋 القائمة (renderProducts من products.js)
   📥 استيراد Excel (renderProductImport من product-import.js)
   يصدّر: renderProductsHub(container)
   ════════════════════════════════════════════════════════════ */

let _prodHubTab = 'list'; // 'list' | 'import'

async function renderProductsHub(c) {
    if (window._pendingProdHubTab) { _prodHubTab = window._pendingProdHubTab; window._pendingProdHubTab = null; }
    c.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap">
        <button class="mod-btn ${_prodHubTab==='list'?'mod-btn-primary':''}" onclick="prodHubSwitchTab('list')">📋 القائمة</button>
        <button class="mod-btn ${_prodHubTab==='import'?'mod-btn-primary':''}" onclick="prodHubSwitchTab('import')">📥 استيراد Excel</button>
    </div>
    <div id="prodHubBody"></div>`;
    await prodHubRenderTab();
}

async function prodHubRenderTab() {
    const body = document.getElementById('prodHubBody');
    if (!body) return;
    if (_prodHubTab === 'list') await renderProducts(body);
    else await renderProductImport(body);
}

window.prodHubSwitchTab = async function (tab) {
    _prodHubTab = tab;
    await renderProductsHub(document.getElementById('app-content'));
};

Object.assign(window, { renderProductsHub, prodHubSwitchTab });
