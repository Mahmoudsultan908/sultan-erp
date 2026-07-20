/* ════════════════════════════════════════════════════════════
   المحاسبة — الدفاتر — accounting-books-hub.js
   صفحة واحدة بتبويبات بدل 4 عناصر منفصلة في القائمة الجانبية —
   📝 القيود اليومية (renderJournalView من journal.js)
   📖 الأستاذ العام (renderGeneralLedger من general-ledger.js)
   ⚖️ ميزان المراجعة (renderTrialBalance من trial-balance.js)
   🏦 الميزانية العمومية (renderBalanceSheet من balance-sheet.js)
   يصدّر: renderAccountingBooksHub(container)
   ════════════════════════════════════════════════════════════ */

let _accBooksTab = 'journal'; // 'journal' | 'ledger' | 'trialbalance' | 'balancesheet'

async function renderAccountingBooksHub(c) {
    c.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap">
        <button class="mod-btn ${_accBooksTab==='journal'?'mod-btn-primary':''}" onclick="accBooksSwitchTab('journal')">📝 القيود اليومية</button>
        <button class="mod-btn ${_accBooksTab==='ledger'?'mod-btn-primary':''}" onclick="accBooksSwitchTab('ledger')">📖 الأستاذ العام</button>
        <button class="mod-btn ${_accBooksTab==='trialbalance'?'mod-btn-primary':''}" onclick="accBooksSwitchTab('trialbalance')">⚖️ ميزان المراجعة</button>
        <button class="mod-btn ${_accBooksTab==='balancesheet'?'mod-btn-primary':''}" onclick="accBooksSwitchTab('balancesheet')">🏦 الميزانية العمومية</button>
    </div>
    <div id="accBooksBody"></div>`;
    await accBooksRenderTab();
}

async function accBooksRenderTab() {
    const body = document.getElementById('accBooksBody');
    if (!body) return;
    if (_accBooksTab === 'ledger') await renderGeneralLedger(body);
    else if (_accBooksTab === 'trialbalance') await renderTrialBalance(body);
    else if (_accBooksTab === 'balancesheet') await renderBalanceSheet(body);
    else await renderJournalView(body);
}

window.accBooksSwitchTab = async function (tab) {
    _accBooksTab = tab;
    await renderAccountingBooksHub(document.getElementById('app-content'));
};

Object.assign(window, { renderAccountingBooksHub, accBooksSwitchTab });
