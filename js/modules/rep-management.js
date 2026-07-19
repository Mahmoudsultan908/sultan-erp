/* ════════════════════════════════════════════════════════════
   مندوب سلطان — rep-management.js
   صفحة واحدة موحّدة لكل حاجة تخص المندوبين، بدل ما تكون متفرقة —
   تبويبات بتستخدم نفس الموديولات الموجودة من غير تكرار كود:
   👥 المندوبين (renderSalesReps من sales-reps.js)
   🚗 تحميل عربية (renderVanStockLoad من van-stock-load.js)
   📦 مخزون العربيات (renderVanStockView من van-stock-view.js)
   ↩️ إرجاع للمخزن (renderVanStockReturn من van-stock-return.js)
   يصدّر: renderRepAppLink(container) — بيحل محل الاسم/المكان القديم
   "ربط برنامج المندوب" تحت "🔜 قريباً"
   ════════════════════════════════════════════════════════════ */

let _repMgmtTab = 'list'; // 'list' | 'load' | 'stock' | 'return'

async function renderRepAppLink(c) {
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
    else await renderVanStockReturn(body);
}

window.repMgmtSwitchTab = async function (tab) {
    _repMgmtTab = tab;
    await renderRepAppLink(document.getElementById('app-content'));
};

Object.assign(window, { renderRepAppLink, repMgmtSwitchTab });
