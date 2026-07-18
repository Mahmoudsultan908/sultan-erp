let currentUser = null;

(async function initApp() {
    // التأكد من أن supabase متاح قبل الاستخدام
    if (typeof sb === 'undefined') {
        document.getElementById('root').innerHTML = '<p style="text-align:center;margin-top:50px">خطأ في تحميل قاعدة البيانات. تأكد من ملف supabase.js</p>';
        return;
    }
    
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
        document.getElementById('root').innerHTML = `
            <div class="login-wrapper">
                <div class="login-card">
                    <div class="login-logo">🏪</div>
                    <h2 style="margin-bottom:6px;color:#0F172A">مرحباً بك في Sultan ERP</h2>
                    <p style="color:#64748B;margin-bottom:20px">سجّل دخولك للمتابعة</p>
                    <input type="email" id="loginEmail" class="login-input" placeholder="البريد الإلكتروني" dir="ltr">
                    <input type="password" id="loginPass" class="login-input" placeholder="كلمة المرور" dir="ltr" onkeydown="if(event.key==='Enter')handleLogin()">
                    <button id="loginBtn" class="login-btn" onclick="handleLogin()">تسجيل الدخول</button>
                    <p id="loginErr" style="color:#DC2626;margin-top:16px;font-size:13px;display:none"></p>
                </div>
            </div>
        `;
    } else {
        currentUser = session.user;
        buildLayout();
        setupApp();
    }
})();

async function handleLogin() {
    const btn = document.getElementById('loginBtn');
    btn.innerText = 'جاري التحقق...'; 
    btn.disabled = true;
    try {
        const { data, error } = await sb.auth.signInWithPassword({ 
            email: document.getElementById('loginEmail').value, 
            password: document.getElementById('loginPass').value 
        });
        if (error) throw error;
        currentUser = data.user;
        buildLayout();
        setupApp();
    } catch (err) {
        const errEl = document.getElementById('loginErr');
        errEl.style.display = 'block';
        errEl.innerText = err.message;
    } finally {
        btn.innerText = 'تسجيل الدخول'; 
        btn.disabled = false;
    }
}

function buildLayout() {
    document.getElementById('root').innerHTML = `
    <div class="app">
      <aside class="sidebar">
        <div class="sidebar-logo">
            <div class="logo-icon">🏪</div>
            <div class="logo-text"><h1>Sultan ERP</h1><span>SMART EDITION V2.0</span></div>
        </div>
        <div class="nav-group" onclick="navToggleGroup(this)"><span>لوحة التحكم</span><span class="nav-group-arrow">▾</span></div>
        <div class="nav-group-items">
        <div class="nav-item active" data-mod="dashboard" onclick="loadMod(this, 'dashboard')">🏠 الرئيسية</div>
        </div>

        <div class="nav-group" onclick="navToggleGroup(this)"><span>البيانات الأساسية</span><span class="nav-group-arrow">▾</span></div>
        <div class="nav-group-items">
        <div class="nav-item" data-mod="products" onclick="loadMod(this, 'products')">🏷️ الأصناف</div>
        <div class="nav-item" data-mod="product-import" onclick="loadMod(this, 'product-import')">📥 استيراد أصناف Excel</div>
        <div class="nav-item" data-mod="customers-manage" onclick="loadMod(this, 'customers-manage')">👤 إدارة العملاء</div>
        <div class="nav-item" data-mod="customer-import" onclick="loadMod(this, 'customer-import')">📥 استيراد عملاء Excel</div>
        <div class="nav-item" data-mod="suppliers-manage" onclick="loadMod(this, 'suppliers-manage')">🏭 إدارة الموردين</div>
        <div class="nav-item" data-mod="supplier-import" onclick="loadMod(this, 'supplier-import')">📥 استيراد موردين Excel</div>
        </div>

        <div class="nav-group" onclick="navToggleGroup(this)"><span>المبيعات والعملاء</span><span class="nav-group-arrow">▾</span></div>
        <div class="nav-group-items">
        <div class="nav-item" data-mod="sales" onclick="loadMod(this, 'sales')">🧾 فاتورة المبيعات</div>
        <div class="nav-item" data-mod="quotations" onclick="loadMod(this, 'quotations')">📋 عروض الأسعار</div>
        <div class="nav-item" data-mod="collections" onclick="loadMod(this, 'collections')">💵 تحصيل العملاء</div>
        <div class="nav-item" data-mod="customers" onclick="loadMod(this, 'customers')">📇 كشف حساب عميل</div>
        <div class="nav-item" data-mod="crm" onclick="loadMod(this, 'crm')">🤝 إدارة علاقات العملاء <span id="crmOverdueBadge" style="display:none;background:#DC2626;color:#fff;border-radius:10px;padding:1px 7px;font-size:10.5px;font-weight:700;margin-right:6px"></span></div>
        <div class="nav-item" data-mod="rep-app-link" onclick="loadMod(this, 'rep-app-link')">🚗 مندوب سلطان</div>
        </div>

        <div class="nav-group" onclick="navToggleGroup(this)"><span>المشتريات والموردين</span><span class="nav-group-arrow">▾</span></div>
        <div class="nav-group-items">
        <div class="nav-item" data-mod="purchases" onclick="loadMod(this, 'purchases')">📥 فاتورة المشتريات</div>
        <div class="nav-item" data-mod="purchase-orders" onclick="loadMod(this, 'purchase-orders')">📋 أوامر الشراء</div>
        <div class="nav-item" data-mod="payments" onclick="loadMod(this, 'payments')">💸 دفع الموردين</div>
        <div class="nav-item" data-mod="suppliers" onclick="loadMod(this, 'suppliers')">📇 كشف حساب مورد</div>
        </div>

        <div class="nav-group" onclick="navToggleGroup(this)"><span>المراجعة والمرتجعات</span><span class="nav-group-arrow">▾</span></div>
        <div class="nav-group-items">
        <div class="nav-item" data-mod="invoice-review" onclick="loadMod(this, 'invoice-review')">🔍 مراجعة الفواتير</div>
        <div class="nav-item" data-mod="returns" onclick="loadMod(this, 'returns')">↩️ المرتجعات</div>
        </div>

        <div class="nav-group" onclick="navToggleGroup(this)"><span>المالية والمخزن</span><span class="nav-group-arrow">▾</span></div>
        <div class="nav-group-items">
        <div class="nav-item" data-mod="expenses" onclick="loadMod(this, 'expenses')">💸 المصروفات</div>
        <div class="nav-item" data-mod="payroll" onclick="loadMod(this, 'payroll')">👥 الموظفون والرواتب</div>
        <div class="nav-item" data-mod="employee-evaluation" onclick="loadMod(this, 'employee-evaluation')">⭐ تقييم الموظفين</div>
        <div class="nav-item" data-mod="treasury" onclick="loadMod(this, 'treasury')">🏦 الخزن</div>
        <div class="nav-item" data-mod="balance-transfer" onclick="loadMod(this, 'balance-transfer')">🔀 تحويل أرصدة</div>
        <div class="nav-item" data-mod="stock-transfer" onclick="loadMod(this, 'stock-transfer')">🔄 تحويل مخزون</div>
        <div class="nav-item" data-mod="inventory" onclick="loadMod(this, 'inventory')">📦 المخزون</div>
        <div class="nav-item" data-mod="warehouses" onclick="loadMod(this, 'warehouses')">🏭 إدارة المخازن</div>
        <div class="nav-item" data-mod="warehouse-reports" onclick="loadMod(this, 'warehouse-reports')">📊 تقارير المخازن</div>
        </div>

        <div class="nav-group" onclick="navToggleGroup(this)"><span>المحاسبة</span><span class="nav-group-arrow">▾</span></div>
        <div class="nav-group-items">
        <div class="nav-item" data-mod="coa" onclick="loadMod(this, 'coa')">📒 شجرة الحسابات</div>
        <div class="nav-item" data-mod="journal" onclick="loadMod(this, 'journal')">📝 القيود اليومية</div>
        <div class="nav-item" data-mod="ledger" onclick="loadMod(this, 'ledger')">📖 الأستاذ العام</div>
        <div class="nav-item" data-mod="cash-movement" onclick="loadMod(this, 'cash-movement')">💰 حركة الخزينة</div>
        <div class="nav-item" data-mod="audit-log" onclick="loadMod(this, 'audit-log')">🔐 سجل التدقيق</div>
        <div class="nav-item" data-mod="trialbalance" onclick="loadMod(this, 'trialbalance')">⚖️ ميزان المراجعة</div>
        <div class="nav-item" data-mod="balancesheet" onclick="loadMod(this, 'balancesheet')">🏦 الميزانية العمومية</div>
        <div class="nav-item" data-mod="archive" onclick="loadMod(this, 'archive')">🗄️ الأرشيف</div>
        </div>

        <div class="nav-group" onclick="navToggleGroup(this)"><span>🔜 قريباً</span><span class="nav-group-arrow">▾</span></div>
        <div class="nav-group-items">
        <div class="nav-item" data-mod="whatsapp" onclick="loadMod(this, 'whatsapp')">💬 تكامل واتساب</div>
        <div class="nav-item" data-mod="ai-dashboard" onclick="loadMod(this, 'ai-dashboard')">🤖 لوحة الذكاء الاصطناعي</div>
        <div class="nav-item" data-mod="customer-orders-link" onclick="loadMod(this, 'customer-orders-link')">🔗 ربط برنامج طلبات العملاء</div>
        </div>

        <div class="nav-group" onclick="navToggleGroup(this)"><span>التقارير والإعدادات</span><span class="nav-group-arrow">▾</span></div>
        <div class="nav-group-items">
        <div class="nav-item" data-mod="reports" onclick="loadMod(this, 'reports')">📈 التقارير</div>
        <div class="nav-item" data-mod="performance-reports" onclick="loadMod(this, 'performance-reports')">📈 تقارير الأداء المتقدمة</div>
        <div class="nav-item" data-mod="general-import-export" onclick="loadMod(this, 'general-import-export')">🔄 استيراد/تصدير عام</div>
        <div class="nav-item" data-mod="print-center" onclick="loadMod(this, 'print-center')">🖨️ مركز الطباعة</div>
        <div class="nav-item" data-mod="opening-balances" onclick="loadMod(this, 'opening-balances')">📋 الأرصدة الافتتاحية</div>
        <div class="nav-item" data-mod="settings" onclick="loadMod(this, 'settings')">⚙️ الإعدادات</div>
        <div class="nav-item" data-mod="users" onclick="loadMod(this, 'users')">👥 المستخدمون</div>
        <div class="nav-item" data-mod="advanced-permissions" onclick="loadMod(this, 'advanced-permissions')">🔐 الصلاحيات المتقدمة</div>
        </div>

        <div class="sidebar-footer"><span>© 2026 Sultan Food</span><span style="color:var(--inv-gold-light)">v2.0</span></div>
      </aside>
      <div class="main">
        <div class="topbar">
          <div style="display:flex;align-items:center;gap:10px">
            <button class="sidebar-toggle" id="sidebarToggle" onclick="toggleSidebar()" title="إظهار/إخفاء القائمة (Alt+H)">☰</button>
            <div class="topbar-title" id="topbarTitle">لوحة التحكم</div>
          </div>
          <div class="topbar-actions">
            <div class="badge-offline" id="topbarOffline" onclick="offlineOpenPanel()" title="حالة الاتصال والمزامنة">🟢 متصل</div>
            <div class="badge-cash" id="topbarCash">جاري التحميل...</div>
            <div class="user-profile">
                <div class="user-avatar" id="userAvatar">م</div>
                <div class="user-info" id="userBadge">جاري التحميل...</div>
            </div>
            <button class="btn-logout" onclick="handleLogout()">خروج</button>
          </div>
        </div>
        <div class="content" id="app-content"></div>
      </div>
    </div>`;
    navRestoreCollapsedGroups();
}

// ★ أقسام القائمة الجانبية قابلة للطي — الحالة (مطوي/مفتوح) بتتخزن في
//   localStorage بمفتاح نص عنوان القسم نفسه، عشان تفضل زي ما المستخدم
//   سابها بين الجلسات. الافتراضي: كل الأقسام مفتوحة (نفس الشكل القديم
//   بالظبط) — ده إضافة بس، مفيش أي تغيير في السلوك الحالي لحد ما
//   المستخدم يطوي قسم بنفسه.
function navToggleGroup(headerEl) {
    const itemsEl = headerEl.nextElementSibling;
    if (!itemsEl || !itemsEl.classList.contains('nav-group-items')) return;
    const collapsed = itemsEl.classList.toggle('collapsed');
    headerEl.classList.toggle('collapsed', collapsed);
    const label = headerEl.textContent.trim();
    let collapsedGroups = [];
    try { collapsedGroups = JSON.parse(localStorage.getItem('navCollapsedGroups') || '[]'); } catch (e) {}
    collapsedGroups = collapsedGroups.filter(g => g !== label);
    if (collapsed) collapsedGroups.push(label);
    localStorage.setItem('navCollapsedGroups', JSON.stringify(collapsedGroups));
}

function navRestoreCollapsedGroups() {
    let collapsedGroups = [];
    try { collapsedGroups = JSON.parse(localStorage.getItem('navCollapsedGroups') || '[]'); } catch (e) {}
    if (!collapsedGroups.length) return;
    document.querySelectorAll('.nav-group').forEach(headerEl => {
        if (!collapsedGroups.includes(headerEl.textContent.trim())) return;
        const itemsEl = headerEl.nextElementSibling;
        if (!itemsEl || !itemsEl.classList.contains('nav-group-items')) return;
        itemsEl.classList.add('collapsed');
        headerEl.classList.add('collapsed');
    });
}

async function setupApp() {
    restoreSidebarState();
    document.getElementById('userAvatar').textContent = currentUser.email.charAt(0).toUpperCase();
    document.getElementById('userBadge').innerHTML = `${currentUser.email} <span>مدير النظام</span>`;
    if (typeof refreshOnlineState === 'function') {
        await refreshOnlineState();
        offlineUpdateBadge();
        if (isOnline() && typeof offlineWarmCache === 'function') offlineWarmCache(); // تسخين الكاش في الخلفية، مش بلوكينج
    }
    // ★ رصيد الخزينة في الشريط العلوي مش لازم يوقف فتح الداشبورد — بيجري
    //   بالتوازي في الخلفية ويحدّث نفسه أول ما يوصل، بدل ما يأخر أول عرض للصفحة.
    sb.rpc('get_cash_balance').then(({ data: cash }) => {
        const el = document.getElementById('topbarCash');
        if (el) el.textContent = '💰 ' + (cash || 0).toFixed(2) + ' ج.م';
    }).catch(() => {
        const el = document.getElementById('topbarCash');
        if (el) el.textContent = '💰 0.00 ج.م';
    });

    // ★ عداد متابعات CRM المتأخرة في القائمة الجانبية — نفس فكرة رصيد
    //   الخزينة فوق، بيجري في الخلفية من غير ما يأخر تحميل الصفحة. لو
    //   جدول customer_interactions لسه ما اتعملش، بيتجاهل الخطأ بهدوء.
    sb.from('customer_interactions').select('id', { count: 'exact', head: true })
        .eq('is_done', false).lt('next_follow_up_date', new Date().toISOString().slice(0,10))
        .then(({ count }) => {
            const el = document.getElementById('crmOverdueBadge');
            if (el && count) { el.textContent = count; el.style.display = 'inline-block'; }
        }).catch(() => {});

    loadMod(document.querySelector('[data-mod="dashboard"]'), 'dashboard');
}

window.loadMod = async function(el, modName) {
    if (el) {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        el.classList.add('active');
    }
    if (window.innerWidth <= 1100) document.body.classList.remove('sidebar-open');
    // ★ وضع ملء الشاشة (فاتورة المبيعات) بيتصفّر مع أي تنقّل لصفحة تانية —
    //   عشان المستخدم ميتقفلش على شاشة من غير سايد بار/توب بار لو خرج
    //   من صفحة المبيعات وهو لسه في وضع ملء الشاشة.
    document.body.classList.remove('inv-fullscreen');

    const c = document.getElementById('app-content');
    if (!c) return;
    c.innerHTML = '<p style="text-align:center;padding:40px;">جاري تحميل الواجهة...</p>';
    
    const titles = {
        'dashboard': 'لوحة التحكم',
        'products': 'إدارة الأصناف',
        'product-import': 'استيراد الأصناف من Excel',
        'customers-manage': 'إدارة العملاء',
        'customer-import': 'استيراد العملاء من Excel',
        'suppliers-manage': 'إدارة الموردين',
        'supplier-import': 'استيراد الموردين من Excel',
        'expenses': 'لوحة تحكم المصروفات',
        'payroll': 'الموظفون والرواتب',
        'stock-transfer': 'تحويل مخزون',
        'sales': 'فاتورة مبيعات جديدة',
        'quotations': 'عروض الأسعار',
        'purchases': 'فاتورة مشتريات جديدة',
        'purchase-orders': 'أوامر الشراء',
        'payments': 'دفع الموردين (سندات صرف)',
        'collections': 'تحصيل العملاء (سندات قبض)',
        'customers': 'كشف حساب عميل',
        'suppliers': 'كشف حساب مورد',
        'invoice-review': 'مراجعة الفواتير وتعديلها',
        'returns': 'المرتجعات',
        'inventory': 'المخزون',
        'warehouses': 'إدارة المخازن',
        'coa': 'شجرة الحسابات',
        'journal': 'القيود اليومية',
        'ledger': 'الأستاذ العام',
        'cash-movement': 'حركة الخزينة التفصيلية',
        'treasury': 'الخزن',
        'balance-transfer': 'تحويل الأرصدة',
        'audit-log': 'سجل التدقيق',
        'trialbalance': 'ميزان المراجعة',
        'balancesheet': 'الميزانية العمومية',
        'warehouse-reports': 'تقارير المخازن',
        'general-import-export': 'استيراد وتصدير عام',
        'performance-reports': 'تقارير الأداء المتقدمة',
        'advanced-permissions': 'الصلاحيات المتقدمة',
        'print-center': 'مركز الطباعة',
        'crm': 'إدارة علاقات العملاء',
        'archive': 'الأرشيف',
        'whatsapp': 'تكامل واتساب',
        'ai-dashboard': 'لوحة الذكاء الاصطناعي',
        'employee-evaluation': 'تقييم الموظفين',
        'customer-orders-link': 'ربط برنامج طلبات العملاء',
        'rep-app-link': 'مندوب سلطان',
        'reports': 'التقارير المالية',
        'opening-balances': 'الأرصدة الافتتاحية',
        'settings': 'الإعدادات العامة',
        'users': 'إدارة المستخدمين'
    };
    if (titles[modName]) document.getElementById('topbarTitle').innerText = titles[modName];
    
    if (modName === 'dashboard' && typeof renderDashboard === 'function') await renderDashboard(c);
    if (modName === 'products' && typeof renderProducts === 'function') await renderProducts(c);
    if (modName === 'product-import' && typeof renderProductImport === 'function') await renderProductImport(c);
    if (modName === 'customers-manage' && typeof renderCustomersManage === 'function') await renderCustomersManage(c);
    if (modName === 'customer-import' && typeof renderCustomerImport === 'function') await renderCustomerImport(c);
    if (modName === 'suppliers-manage' && typeof renderSuppliersManage === 'function') await renderSuppliersManage(c);
    if (modName === 'supplier-import' && typeof renderSupplierImport === 'function') await renderSupplierImport(c);
    if (modName === 'expenses' && typeof renderExpenses === 'function') await renderExpenses(c);
    if (modName === 'payroll' && typeof renderPayroll === 'function') await renderPayroll(c);
    if (modName === 'stock-transfer' && typeof renderStockTransfer === 'function') await renderStockTransfer(c);
    if (modName === 'sales' && typeof renderSales === 'function') await renderSales(c);
    if (modName === 'quotations' && typeof renderQuotations === 'function') await renderQuotations(c);
    if (modName === 'purchases' && typeof renderPurchases === 'function') await renderPurchases(c);
    if (modName === 'purchase-orders' && typeof renderPurchaseOrders === 'function') await renderPurchaseOrders(c);
    if (modName === 'payments' && typeof renderPayments === 'function') await renderPayments(c);
    if (modName === 'collections' && typeof renderCollections === 'function') await renderCollections(c);
    if (modName === 'customers' && typeof renderCustomers === 'function') await renderCustomers(c);
    if (modName === 'suppliers' && typeof renderSuppliers === 'function') await renderSuppliers(c);
    if (modName === 'invoice-review' && typeof renderInvoiceReview === 'function') await renderInvoiceReview(c);
    if (modName === 'returns' && typeof renderReturns === 'function') await renderReturns(c);
    if (modName === 'inventory' && typeof renderInventory === 'function') await renderInventory(c);
    if (modName === 'warehouses' && typeof renderWarehouses === 'function') await renderWarehouses(c);
    if (modName === 'coa' && typeof renderChartOfAccounts === 'function') await renderChartOfAccounts(c);
    if (modName === 'journal' && typeof renderJournalView === 'function') await renderJournalView(c);
    if (modName === 'ledger' && typeof renderGeneralLedger === 'function') await renderGeneralLedger(c);
    if (modName === 'cash-movement' && typeof renderCashMovement === 'function') await renderCashMovement(c);
    if (modName === 'treasury' && typeof renderTreasury === 'function') await renderTreasury(c);
    if (modName === 'balance-transfer' && typeof renderBalanceTransfer === 'function') await renderBalanceTransfer(c);
    if (modName === 'audit-log' && typeof renderAuditLog === 'function') await renderAuditLog(c);
    if (modName === 'trialbalance' && typeof renderTrialBalance === 'function') await renderTrialBalance(c);
    if (modName === 'balancesheet' && typeof renderBalanceSheet === 'function') await renderBalanceSheet(c);
    if (modName === 'warehouse-reports' && typeof renderWarehouseReports === 'function') await renderWarehouseReports(c);
    if (modName === 'general-import-export' && typeof renderGeneralImportExport === 'function') await renderGeneralImportExport(c);
    if (modName === 'performance-reports' && typeof renderPerformanceReports === 'function') await renderPerformanceReports(c);
    if (modName === 'advanced-permissions' && typeof renderAdvancedPermissions === 'function') await renderAdvancedPermissions(c);
    if (modName === 'print-center' && typeof renderPrintCenter === 'function') await renderPrintCenter(c);
    if (modName === 'crm' && typeof renderCRM === 'function') await renderCRM(c);
    if (modName === 'archive' && typeof renderArchive === 'function') await renderArchive(c);
    if (modName === 'whatsapp' && typeof renderWhatsAppIntegration === 'function') await renderWhatsAppIntegration(c);
    if (modName === 'ai-dashboard' && typeof renderAIDashboard === 'function') await renderAIDashboard(c);
    if (modName === 'employee-evaluation' && typeof renderEmployeeEvaluation === 'function') await renderEmployeeEvaluation(c);
    if (modName === 'customer-orders-link' && typeof renderCustomerOrdersLink === 'function') await renderCustomerOrdersLink(c);
    if (modName === 'rep-app-link' && typeof renderRepAppLink === 'function') await renderRepAppLink(c);
    if (modName === 'reports' && typeof renderReports === 'function') await renderReports(c);
    if (modName === 'opening-balances' && typeof renderOpeningBalances === 'function') await renderOpeningBalances(c);
    if (modName === 'settings' && typeof renderSettings === 'function') await renderSettings(c);
    if (modName === 'users' && typeof renderUsersManagement === 'function') await renderUsersManagement(c);
}

window.handleLogout = async function() {
    await sb.auth.signOut();
    location.reload();
};

// ── الشريط الجانبي قابل للطي (ديسكتوب) / منزلق (شاشات صغيرة) ──
window.toggleSidebar = function(force) {
    const sbEl = document.querySelector('.sidebar');
    if (!sbEl) return;
    const isMobile = window.innerWidth <= 1100;

    if (isMobile) {
        const open = (force !== undefined) ? force : !document.body.classList.contains('sidebar-open');
        document.body.classList.toggle('sidebar-open', open);
    } else {
        const collapse = (force !== undefined) ? force : !sbEl.classList.contains('collapsed');
        sbEl.classList.toggle('collapsed', collapse);
        localStorage.setItem('sidebar_collapsed', collapse ? '1' : '0');
        const btn = document.getElementById('sidebarToggle');
        if (btn) btn.textContent = collapse ? '◗' : '☰';
    }
};
function restoreSidebarState() {
    if (window.innerWidth <= 1100) return; // الموبايل دايماً يبدأ مقفول (افتراضي من CSS)
    if (localStorage.getItem('sidebar_collapsed') === '1') {
        const sb = document.querySelector('.sidebar');
        if (sb) sb.classList.add('collapsed');
        const btn = document.getElementById('sidebarToggle');
        if (btn) btn.textContent = '◗';
    }
}
document.addEventListener('click', (e) => {
    // الضغط على الخلفية المعتمة (overlay) يقفل القائمة في الموبايل
    if (document.body.classList.contains('sidebar-open') && !e.target.closest('.sidebar') && !e.target.closest('.sidebar-toggle')) {
        window.toggleSidebar(false);
    }
});
document.addEventListener('keydown', (e) => {
    // Alt+H → طي/إظهار الشريط الجانبي (Ctrl+H كانت بتتصادم مع سجل التصفح في كروم)
    // ★ e.code بدل e.key: e.key بيرجّع الحرف اللي اتكتب فعلياً حسب لغة
    //   لوحة المفاتيح النشطة (عربي/إنجليزي)، فلو المستخدم شغّال بلوحة
    //   مفاتيح عربية، Alt+H ممكن يرجّع حرف غير 'h' أو 'ة' خالص ويفشل
    //   الشرط. e.code بيرجّع موضع المفتاح الفعلي على الكيبورد
    //   (KeyH) بغض النظر عن اللغة النشطة، فبيشتغل مهما كانت اللغة.
    if (e.altKey && e.code === 'KeyH') {
        e.preventDefault();
        window.toggleSidebar();
    }
});
// إقفال تلقائي للقائمة بعد اختيار صفحة في الشاشات الصغيرة (تجربة استخدام أفضل)
const _origLoadModForSidebar = window.loadMod;

// ── تسجيل Service Worker (يفعّل خيار "تثبيت على سطح المكتب") ──
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    });
}