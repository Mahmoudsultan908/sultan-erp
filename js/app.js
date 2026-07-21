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
        <div class="nav-group" onclick="navToggleGroup(this)"><span class="nav-group-heading"><span class="ng-icon">🏠</span><span class="ng-label">لوحة التحكم</span></span><span class="nav-group-arrow">▾</span></div>
        <div class="nav-group-items">
        <div class="nav-item active" data-mod="dashboard" onclick="loadMod(this, 'dashboard')">🏠 الرئيسية</div>
        </div>

        <div class="nav-group" onclick="navToggleGroup(this)"><span class="nav-group-heading"><span class="ng-icon">🏷️</span><span class="ng-label">الأصناف</span></span><span class="nav-group-arrow">▾</span></div>
        <div class="nav-group-items">
        <div class="nav-item" data-mod="products" onclick="loadMod(this, 'products')">🏷️ الأصناف</div>
        </div>

        <div class="nav-group" onclick="navToggleGroup(this)"><span class="nav-group-heading"><span class="ng-icon">👤</span><span class="ng-label">العملاء</span></span><span class="nav-group-arrow">▾</span></div>
        <div class="nav-group-items">
        <div class="nav-item" data-mod="customers-hub" onclick="loadMod(this, 'customers-hub')">👤 العملاء</div>
        </div>

        <div class="nav-group" onclick="navToggleGroup(this)"><span class="nav-group-heading"><span class="ng-icon">🏭</span><span class="ng-label">الموردين</span></span><span class="nav-group-arrow">▾</span></div>
        <div class="nav-group-items">
        <div class="nav-item" data-mod="suppliers-hub" onclick="loadMod(this, 'suppliers-hub')">🏭 الموردين</div>
        </div>

        <div class="nav-group" onclick="navToggleGroup(this)"><span class="nav-group-heading"><span class="ng-icon">🧾</span><span class="ng-label">المبيعات والعملاء</span></span><span class="nav-group-arrow">▾</span></div>
        <div class="nav-group-items">
        <div class="nav-item" data-mod="sales" onclick="loadMod(this, 'sales')">🧾 فاتورة المبيعات</div>
        <div class="nav-item" data-mod="quotations" onclick="loadMod(this, 'quotations')">📋 عروض الأسعار</div>
        <div class="nav-item" data-mod="collections" onclick="loadMod(this, 'collections')">💵 تحصيل العملاء</div>
        <div class="nav-item" data-mod="crm" onclick="loadMod(this, 'crm')">🤝 إدارة علاقات العملاء <span id="crmOverdueBadge" style="display:none;background:#DC2626;color:#fff;border-radius:10px;padding:1px 7px;font-size:10.5px;font-weight:700;margin-right:6px"></span></div>
        <div class="nav-item" data-mod="rep-app-link" onclick="loadMod(this, 'rep-app-link')">🚗 مندوب سلطان <span id="repLinkBadge" style="display:none;background:#DC2626;color:#fff;border-radius:10px;padding:1px 7px;font-size:10.5px;font-weight:700;margin-right:6px"></span></div>
        <div class="nav-item" data-mod="customer-orders-link" onclick="loadMod(this, 'customer-orders-link')">🔗 طلبات العملاء</div>
        </div>

        <div class="nav-group" onclick="navToggleGroup(this)"><span class="nav-group-heading"><span class="ng-icon">📥</span><span class="ng-label">المشتريات والموردين</span></span><span class="nav-group-arrow">▾</span></div>
        <div class="nav-group-items">
        <div class="nav-item" data-mod="purchases" onclick="loadMod(this, 'purchases')">📥 فاتورة المشتريات</div>
        <div class="nav-item" data-mod="purchase-orders" onclick="loadMod(this, 'purchase-orders')">📋 أوامر الشراء</div>
        <div class="nav-item" data-mod="payments" onclick="loadMod(this, 'payments')">💸 دفع الموردين</div>
        </div>

        <div class="nav-group" onclick="navToggleGroup(this)"><span class="nav-group-heading"><span class="ng-icon">🔍</span><span class="ng-label">المراجعة والمرتجعات</span></span><span class="nav-group-arrow">▾</span></div>
        <div class="nav-group-items">
        <div class="nav-item" data-mod="invoice-review" onclick="loadMod(this, 'invoice-review')">🔍 مراجعة الفواتير</div>
        <div class="nav-item" data-mod="returns" onclick="loadMod(this, 'returns')">↩️ المرتجعات</div>
        </div>

        <div class="nav-group" onclick="navToggleGroup(this)"><span class="nav-group-heading"><span class="ng-icon">💰</span><span class="ng-label">المالية</span></span><span class="nav-group-arrow">▾</span></div>
        <div class="nav-group-items">
        <div class="nav-item" data-mod="expenses" onclick="loadMod(this, 'expenses')">💸 المصروفات</div>
        <div class="nav-item" data-mod="treasury" onclick="loadMod(this, 'treasury')">🏦 الخزن</div>
        <div class="nav-item" data-mod="balance-transfer" onclick="loadMod(this, 'balance-transfer')">🔀 تحويل أرصدة</div>
        </div>

        <div class="nav-group" onclick="navToggleGroup(this)"><span class="nav-group-heading"><span class="ng-icon">📦</span><span class="ng-label">المخزون</span></span><span class="nav-group-arrow">▾</span></div>
        <div class="nav-group-items">
        <div class="nav-item" data-mod="inventory-hub" onclick="loadMod(this, 'inventory-hub')">📦 المخزون</div>
        </div>

        <div class="nav-group" onclick="navToggleGroup(this)"><span class="nav-group-heading"><span class="ng-icon">👥</span><span class="ng-label">الموظفين</span></span><span class="nav-group-arrow">▾</span></div>
        <div class="nav-group-items">
        <div class="nav-item" data-mod="payroll" onclick="loadMod(this, 'payroll')">👥 الموظفون والرواتب</div>
        <div class="nav-item" data-mod="employee-evaluation" onclick="loadMod(this, 'employee-evaluation')">⭐ تقييم الموظفين</div>
        </div>

        <div class="nav-group" onclick="navToggleGroup(this)"><span class="nav-group-heading"><span class="ng-icon">📒</span><span class="ng-label">المحاسبة</span></span><span class="nav-group-arrow">▾</span></div>
        <div class="nav-group-items">
        <div class="nav-item" data-mod="coa" onclick="loadMod(this, 'coa')">📒 شجرة الحسابات</div>
        <div class="nav-item" data-mod="accounting-books" onclick="loadMod(this, 'accounting-books')">📖 الدفاتر</div>
        <div class="nav-item" data-mod="accounting-monitoring" onclick="loadMod(this, 'accounting-monitoring')">🔍 المراقبة والأرشفة</div>
        <div class="nav-item" data-mod="investors" onclick="loadMod(this, 'investors')">🤝 المستثمرين</div>
        </div>

        <div class="nav-group" onclick="navToggleGroup(this)"><span class="nav-group-heading"><span class="ng-icon">🔜</span><span class="ng-label">قريباً</span></span><span class="nav-group-arrow">▾</span></div>
        <div class="nav-group-items">
        <div class="nav-item" data-mod="whatsapp" onclick="loadMod(this, 'whatsapp')">💬 تكامل واتساب</div>
        <div class="nav-item" data-mod="ai-dashboard" onclick="loadMod(this, 'ai-dashboard')">🤖 لوحة الذكاء الاصطناعي</div>
        </div>

        <div class="nav-group" onclick="navToggleGroup(this)"><span class="nav-group-heading"><span class="ng-icon">📈</span><span class="ng-label">التقارير</span></span><span class="nav-group-arrow">▾</span></div>
        <div class="nav-group-items">
        <div class="nav-item" data-mod="reports-hub" onclick="loadMod(this, 'reports-hub')">📈 التقارير</div>
        </div>

        <div class="nav-group" onclick="navToggleGroup(this)"><span class="nav-group-heading"><span class="ng-icon">⚙️</span><span class="ng-label">الإعدادات</span></span><span class="nav-group-arrow">▾</span></div>
        <div class="nav-group-items">
        <div class="nav-item" data-mod="general-import-export" onclick="loadMod(this, 'general-import-export')">🔄 استيراد/تصدير عام</div>
        <div class="nav-item" data-mod="print-center" onclick="loadMod(this, 'print-center')">🖨️ مركز الطباعة</div>
        <div class="nav-item" data-mod="opening-balances" onclick="loadMod(this, 'opening-balances')">📋 الأرصدة الافتتاحية</div>
        <div class="nav-item" data-mod="settings-hub" onclick="loadMod(this, 'settings-hub')">⚙️ الإعدادات</div>
        </div>

        <div class="sidebar-footer"><span>© 2026 Sultan Food</span><span style="color:var(--inv-gold-light)">v2.0</span></div>
      </aside>
      <div id="railFlyout"><div class="rf-title" id="railFlyoutTitle"></div></div>
      <div class="main">
        <div class="topbar">
          <div style="display:flex;align-items:center;gap:10px">
            <button class="sidebar-toggle" id="sidebarToggle" onclick="toggleSidebar()" title="إظهار/إخفاء القائمة (Alt+H)">☰</button>
            <div class="topbar-title" id="topbarTitle">لوحة التحكم</div>
            <button class="sidebar-toggle" id="pinTabBtn" onclick="pinCurrentTab()" title="افتح في تبويب منفصل (تفضل شغال في الخلفية وانت بتتنقل لشاشة تانية)">📌</button>
          </div>
          <div class="topbar-actions">
            <button class="sidebar-toggle" onclick="searchOpenPalette()" title="بحث سريع (Ctrl+K)">🔍</button>
            <div class="badge-offline" id="topbarOffline" onclick="offlineOpenPanel()" title="حالة الاتصال والمزامنة">🟢 متصل</div>
            <div class="badge-cash" id="topbarCash">جاري التحميل...</div>
            <div class="user-profile">
                <div class="user-avatar" id="userAvatar">م</div>
                <div class="user-info" id="userBadge">جاري التحميل...</div>
            </div>
            <button class="btn-logout" onclick="handleLogout()">خروج</button>
          </div>
        </div>
        <div class="tab-strip" id="tabStrip" style="display:none"></div>
        <div class="content-host" id="appContentHost"></div>
      </div>
    </div>`;
    navRestoreCollapsedGroups();
    railInitFlyouts();

    // ★ نظام التبويبات الداخلية (keep-alive) — الـpane الأساسية اللي كل
    //   تنقّل عادي (مش مثبّت كتبويب) بيتعاد استخدامها فيها، ودايمًا هي
    //   اللي حاملة id="app-content" لحد ما يتثبّت تبويب. راجع loadMod/
    //   pinCurrentTab تحت لتفاصيل الآلية.
    window.appTabs = new Map(); // modName -> {modName, title, paneEl, tabBtnEl}
    window._activeBaseMod = null; // اسم الموديول المعروض دلوقتي في الـpane الأساسية (مش تبويب مثبّت)
    window._basePaneEl = document.createElement('div');
    window._basePaneEl.className = 'content tab-pane';
    window._basePaneEl.id = 'app-content';
    document.getElementById('appContentHost').appendChild(window._basePaneEl);
}

// أي شاشة عندها تايمر/اشتراك خلفية لازم يتوقف لما تبويبها يتقفل، وإلا
// هيفضل شغال في الخلفية من غير داعي. راجع invStopAutoSave/purStopAutoSave
// (sales.js/purchases.js) — الدالتين دول implicit globals بالفعل زي أي
// function مصرّح بيها top-level في الملف (راجع CLAUDE.md).
const appTabCleanupHooks = {
    sales: () => { if (typeof window.invStopAutoSave === 'function') window.invStopAutoSave(); },
    purchases: () => { if (typeof window.purStopAutoSave === 'function') window.purStopAutoSave(); },
};

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

// ★ نافذة القائمة العائمة لوضع طي القائمة الجانبية لأيقونات (rail mode) —
//   بدل استنساخ nav-group-items (بيكسر ربطها بحالة .active/.collapsed
//   الحقيقية)، بننقل العنصر الحقيقي نفسه مؤقتًا جوه #railFlyout ونرجعه
//   لمكانه الأصلي (قبل عنصر placeholder بنسيبه) لما الماوس يسيب المجموعة.
let _railHome = null; // { itemsEl, placeholder, wasCollapsed }
let _railHideTimer = null;

function railInitFlyouts() {
    document.querySelectorAll('.sidebar .nav-group').forEach(headerEl => {
        headerEl.addEventListener('mouseenter', () => {
            if (!document.querySelector('.sidebar')?.classList.contains('collapsed')) return;
            clearTimeout(_railHideTimer);
            railShowFlyout(headerEl);
        });
        headerEl.addEventListener('mouseleave', railScheduleHide);
    });
    const flyout = document.getElementById('railFlyout');
    if (flyout) {
        flyout.addEventListener('mouseenter', () => clearTimeout(_railHideTimer));
        flyout.addEventListener('mouseleave', railScheduleHide);
    }
}

function railShowFlyout(headerEl) {
    const itemsEl = headerEl.nextElementSibling;
    if (!itemsEl || !itemsEl.classList.contains('nav-group-items')) return;
    railRestoreHome();
    const placeholder = document.createComment('rail-home');
    itemsEl.parentNode.insertBefore(placeholder, itemsEl);
    _railHome = { itemsEl, placeholder, wasCollapsed: itemsEl.classList.contains('collapsed') };
    itemsEl.classList.remove('collapsed');
    document.getElementById('railFlyoutTitle').textContent = headerEl.querySelector('.ng-label')?.textContent || '';
    document.getElementById('railFlyout').appendChild(itemsEl);

    const rect = headerEl.getBoundingClientRect();
    const flyout = document.getElementById('railFlyout');
    flyout.style.top = Math.max(8, rect.top) + 'px';
    flyout.style.right = (window.innerWidth - rect.left) + 'px';
    flyout.classList.add('show');
}

function railRestoreHome() {
    if (!_railHome) return;
    const { itemsEl, placeholder, wasCollapsed } = _railHome;
    placeholder.parentNode.insertBefore(itemsEl, placeholder);
    placeholder.remove();
    itemsEl.classList.toggle('collapsed', wasCollapsed);
    _railHome = null;
}

function railHideFlyout() {
    document.getElementById('railFlyout')?.classList.remove('show');
    railRestoreHome();
}

function railScheduleHide() {
    clearTimeout(_railHideTimer);
    _railHideTimer = setTimeout(railHideFlyout, 200);
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

    // ★ إشعار "حدث خارجي جديد" جنب تبويب "🚗 مندوب سلطان" — نفس فكرة عداد
    //   CRM فوق، بيجري فى الخلفية من غير ما يأخر تحميل الصفحة
    if (typeof repLinkRefreshBadge === 'function') repLinkRefreshBadge();

    loadMod(document.querySelector('[data-mod="dashboard"]'), 'dashboard');
}

const titles = {
        'dashboard': 'لوحة التحكم',
        'products': 'إدارة الأصناف',
        'customers-hub': 'العملاء',
        'suppliers-hub': 'الموردين',
        'expenses': 'لوحة تحكم المصروفات',
        'payroll': 'الموظفون والرواتب',
        'sales': 'فاتورة مبيعات جديدة',
        'quotations': 'عروض الأسعار',
        'purchases': 'فاتورة مشتريات جديدة',
        'purchase-orders': 'أوامر الشراء',
        'payments': 'دفع الموردين (سندات صرف)',
        'collections': 'تحصيل العملاء (سندات قبض)',
        'invoice-review': 'مراجعة الفواتير وتعديلها',
        'returns': 'المرتجعات',
        'inventory-hub': 'المخزون',
        'coa': 'شجرة الحسابات',
        'accounting-books': 'الدفاتر',
        'accounting-monitoring': 'المراقبة والأرشفة',
        'investors': 'المستثمرين',
        'treasury': 'الخزن',
        'balance-transfer': 'تحويل الأرصدة',
        'general-import-export': 'استيراد وتصدير عام',
        'print-center': 'مركز الطباعة',
        'crm': 'إدارة علاقات العملاء',
        'whatsapp': 'تكامل واتساب',
        'ai-dashboard': 'لوحة الذكاء الاصطناعي',
        'employee-evaluation': 'تقييم الموظفين',
        'customer-orders-link': 'طلبات العملاء',
        'rep-app-link': 'مندوب سلطان',
        'reports-hub': 'التقارير',
        'opening-balances': 'الأرصدة الافتتاحية',
        'settings-hub': 'الإعدادات'
};

// نفس منطق التوجيه القديم بالظبط (if-chain واحد لكل موديول) — اتقص هنا
// كما هو من غير أي تغيير منطقي، عشان يشتغل سواء الاستدعاء جاي من مسار
// التنقّل العادي أو من تبويب مثبّت.
async function _dispatchRender(modName, c) {
    if (modName === 'dashboard' && typeof renderDashboard === 'function') await renderDashboard(c);
    if (modName === 'products' && typeof renderProductsHub === 'function') await renderProductsHub(c);
    if (modName === 'customers-hub' && typeof renderCustomersHub === 'function') await renderCustomersHub(c);
    if (modName === 'suppliers-hub' && typeof renderSuppliersHub === 'function') await renderSuppliersHub(c);
    if (modName === 'expenses' && typeof renderExpenses === 'function') await renderExpenses(c);
    if (modName === 'payroll' && typeof renderPayroll === 'function') await renderPayroll(c);
    if (modName === 'sales' && typeof renderSales === 'function') await renderSales(c);
    if (modName === 'quotations' && typeof renderQuotations === 'function') await renderQuotations(c);
    if (modName === 'purchases' && typeof renderPurchases === 'function') await renderPurchases(c);
    if (modName === 'purchase-orders' && typeof renderPurchaseOrders === 'function') await renderPurchaseOrders(c);
    if (modName === 'payments' && typeof renderPayments === 'function') await renderPayments(c);
    if (modName === 'collections' && typeof renderCollections === 'function') await renderCollections(c);
    if (modName === 'invoice-review' && typeof renderInvoiceReview === 'function') await renderInvoiceReview(c);
    if (modName === 'returns' && typeof renderReturns === 'function') await renderReturns(c);
    if (modName === 'inventory-hub' && typeof renderInventoryHub === 'function') await renderInventoryHub(c);
    if (modName === 'coa' && typeof renderChartOfAccounts === 'function') await renderChartOfAccounts(c);
    if (modName === 'accounting-books' && typeof renderAccountingBooksHub === 'function') await renderAccountingBooksHub(c);
    if (modName === 'accounting-monitoring' && typeof renderAccountingMonitoringHub === 'function') await renderAccountingMonitoringHub(c);
    if (modName === 'investors' && typeof renderInvestors === 'function') await renderInvestors(c);
    if (modName === 'treasury' && typeof renderTreasury === 'function') await renderTreasury(c);
    if (modName === 'balance-transfer' && typeof renderBalanceTransfer === 'function') await renderBalanceTransfer(c);
    if (modName === 'general-import-export' && typeof renderGeneralImportExport === 'function') await renderGeneralImportExport(c);
    if (modName === 'print-center' && typeof renderPrintCenter === 'function') await renderPrintCenter(c);
    if (modName === 'crm' && typeof renderCRM === 'function') await renderCRM(c);
    if (modName === 'whatsapp' && typeof renderWhatsAppIntegration === 'function') await renderWhatsAppIntegration(c);
    if (modName === 'ai-dashboard' && typeof renderAIDashboard === 'function') await renderAIDashboard(c);
    if (modName === 'employee-evaluation' && typeof renderEmployeeEvaluation === 'function') await renderEmployeeEvaluation(c);
    if (modName === 'customer-orders-link' && typeof renderCustomerOrdersLink === 'function') await renderCustomerOrdersLink(c);
    if (modName === 'rep-app-link' && typeof renderRepAppLink === 'function') await renderRepAppLink(c);
    if (modName === 'reports-hub' && typeof renderReportsHub === 'function') await renderReportsHub(c);
    if (modName === 'opening-balances' && typeof renderOpeningBalances === 'function') await renderOpeningBalances(c);
    if (modName === 'settings-hub' && typeof renderSettingsHub === 'function') await renderSettingsHub(c);
}

// إظهار pane واحدة بس (id="app-content") وإخفاء كل الباقي — أي دالة في
// أي موديول بتعمل document.getElementById('app-content') من جوّاها
// للـrefresh هتلاقي دايمًا الـpane الصح اللي المستخدم شايفها فعليًا،
// من غير أي تعديل في الموديولات نفسها.
function _activatePane(paneEl) {
    document.querySelectorAll('#appContentHost .tab-pane').forEach(p => {
        if (p === paneEl) { p.id = 'app-content'; p.style.display = ''; }
        else { if (p.id === 'app-content') p.removeAttribute('id'); p.style.display = 'none'; }
    });
}

function _updateTabStripActive(activeModName) {
    document.querySelectorAll('#tabStrip .tab-item').forEach(b => {
        b.classList.toggle('active', b.dataset.mod === activeModName);
    });
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

    if (titles[modName]) document.getElementById('topbarTitle').innerText = titles[modName];

    // ★ الموديول ده مثبّت كتبويب بالفعل — بس فوكس على الـpane الحية بتاعته
    //   من غير أي re-render، عشان أي بيانات في نص الكتابة تفضل زي ما هي.
    //   ده كمان اللي بيمنع فتح نسختين من نفس الشاشة في نفس الوقت (لو
    //   حاولت، بترجعلك لنفس التبويب المفتوح بدل ما تعمل واحد جديد).
    if (window.appTabs.has(modName)) {
        _activatePane(window.appTabs.get(modName).paneEl);
        _updateTabStripActive(modName);
        document.getElementById('pinTabBtn').style.display = 'none';
        return;
    }

    _activatePane(window._basePaneEl);
    _updateTabStripActive(null);
    document.getElementById('pinTabBtn').style.display = '';
    window._activeBaseMod = modName;
    const c = window._basePaneEl;
    c.innerHTML = '<p style="text-align:center;padding:40px;">جاري تحميل الواجهة...</p>';
    await _dispatchRender(modName, c);
};

// ── تثبيت الشاشة الحالية كتبويب منفصل تفضل شغالة في الخلفية ──
window.pinCurrentTab = function () {
    const modName = window._activeBaseMod;
    if (!modName || window.appTabs.has(modName)) return;
    const pane = window._basePaneEl;
    const title = titles[modName] || modName;

    const tabBtn = document.createElement('button');
    tabBtn.className = 'tab-item';
    tabBtn.dataset.mod = modName;
    tabBtn.onclick = () => window.focusAppTab(modName);
    tabBtn.innerHTML = `<span>${title}</span><span class="tab-close" onclick="event.stopPropagation();closeAppTab('${modName}')" title="إغلاق التبويب">✕</span>`;
    document.getElementById('tabStrip').appendChild(tabBtn);
    document.getElementById('tabStrip').style.display = 'flex';
    window.appTabs.set(modName, { modName, title, paneEl: pane, tabBtnEl: tabBtn });
    window._activeBaseMod = null;

    // الـpane الأساسية بقت تبويب مثبّت — نستبدلها بواحدة جديدة فاضية
    // للتنقّل العادي، ونرجع للوحة التحكم فيها.
    window._basePaneEl = document.createElement('div');
    window._basePaneEl.className = 'content tab-pane';
    document.getElementById('appContentHost').appendChild(window._basePaneEl);
    loadMod(document.querySelector('[data-mod="dashboard"]'), 'dashboard');
};

window.focusAppTab = function (modName) {
    const entry = window.appTabs.get(modName);
    if (!entry) return;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector(`.nav-item[data-mod="${modName}"]`)?.classList.add('active');
    if (window.innerWidth <= 1100) document.body.classList.remove('sidebar-open');
    document.body.classList.remove('inv-fullscreen');
    document.getElementById('topbarTitle').innerText = entry.title;
    document.getElementById('pinTabBtn').style.display = 'none';
    _activatePane(entry.paneEl);
    _updateTabStripActive(modName);
};

window.closeAppTab = function (modName) {
    const entry = window.appTabs.get(modName);
    if (!entry) return;
    const wasActive = entry.paneEl.id === 'app-content';
    appTabCleanupHooks[modName]?.();
    entry.paneEl.remove();
    entry.tabBtnEl.remove();
    window.appTabs.delete(modName);
    if (window.appTabs.size === 0) document.getElementById('tabStrip').style.display = 'none';
    if (wasActive) loadMod(document.querySelector('[data-mod="dashboard"]'), 'dashboard');
};

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
        // ★ لو كانت قائمة فرعية عائمة مفتوحة (rail flyout) وقت التبديل، نقفلها
        //   ونرجّع عناصرها لمكانها — وإلا هتفضل "مسروقة" جوه القائمة الموسّعة
        if (typeof railHideFlyout === 'function') railHideFlyout();
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
    // Ctrl+K / Cmd+K → بحث سريع عام (عملاء/موردين/أصناف/فواتير) — e.code
    // بنفس منطق Alt+H فوق، شغال مهما كانت لغة الكيبورد النشطة.
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
        e.preventDefault();
        if (document.getElementById('searchPaletteBg')) window.searchClosePalette();
        else if (document.getElementById('app-content')) window.searchOpenPalette();
    }
});

// ════════════════════════════════════════════════════════════
// بحث سريع عام (Ctrl+K) — عملاء/موردين/أصناف/أرقام فواتير، نتيجة
// واحدة بتفتحلك الشاشة الصح على طول (نفس فكرة الـpending flags
// المستخدمة في custGoEditProfile وأخواتها عبر الموديولات).
// ════════════════════════════════════════════════════════════
function searchEsc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

window.searchOpenPalette = function () {
    if (document.getElementById('searchPaletteBg')) return;
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'searchPaletteBg';
    modal.addEventListener('click', (e) => { if (e.target === modal) window.searchClosePalette(); });
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:560px;align-self:flex-start;margin-top:90px">
            <div class="mod-modal-header" style="gap:10px">
                <input type="text" id="searchPaletteInput" class="mod-form-input" style="flex:1;margin:0;border:none;box-shadow:none;font-size:15px;padding:0" placeholder="🔍 ابحث عن عميل، مورد، صنف، أو رقم فاتورة..." oninput="searchHandleInput(this.value)">
                <button class="mod-modal-close" onclick="searchClosePalette()">×</button>
            </div>
            <div class="mod-modal-body" id="searchPaletteResults" style="min-height:60px;max-height:60vh">
                <div class="empty-state" style="padding:30px 10px"><span>⌨️</span>اكتب حرفين على الأقل للبحث</div>
            </div>
        </div>`;
    document.body.appendChild(modal);
    document.getElementById('searchPaletteInput').focus();
    document.addEventListener('keydown', _searchEscHandler);
};

function _searchEscHandler(e) {
    if (e.key === 'Escape') window.searchClosePalette();
}

window.searchClosePalette = function () {
    clearTimeout(window._searchDebounceTimer);
    document.getElementById('searchPaletteBg')?.remove();
    document.removeEventListener('keydown', _searchEscHandler);
};

window.searchHandleInput = function (v) {
    clearTimeout(window._searchDebounceTimer);
    const term = v.trim();
    const results = document.getElementById('searchPaletteResults');
    if (!results) return;
    if (term.length < 2) {
        results.innerHTML = '<div class="empty-state" style="padding:30px 10px"><span>⌨️</span>اكتب حرفين على الأقل للبحث</div>';
        return;
    }
    results.innerHTML = '<div class="empty-state" style="padding:30px 10px"><span>⏳</span>جاري البحث...</div>';
    window._searchDebounceTimer = setTimeout(() => _searchRun(term), 300);
};

let _searchReqId = 0;
async function _searchRun(term) {
    const reqId = ++_searchReqId;
    const like = `%${term}%`;
    const safe = (p) => p.then((r) => r, () => ({ data: [] }));
    const [custR, suppR, prodR, salesR, purR] = await Promise.all([
        safe(sb.from('customers').select('id,name,phone').or(`name.ilike.${like},phone.ilike.${like}`).limit(6)),
        safe(sb.from('suppliers').select('id,name,phone').or(`name.ilike.${like},phone.ilike.${like}`).limit(6)),
        safe(sb.from('products').select('id,name,code,barcode').or(`name.ilike.${like},code.ilike.${like},barcode.ilike.${like}`).limit(6)),
        safe(sb.from('sales').select('id,invoice_no').ilike('invoice_no', like).limit(6)),
        safe(sb.from('purchases').select('id,invoice_no').ilike('invoice_no', like).limit(6)),
    ]);
    if (reqId !== _searchReqId) return; // نتيجة بحث قديمة اتجاوزها بحث أحدث، اتجاهلها
    const results = document.getElementById('searchPaletteResults');
    if (!results) return;

    const row = (icon, title, sub, onclick) => `
        <div class="cat-card" style="cursor:pointer" onclick="${onclick}">
            <div class="cc-ic">${icon}</div>
            <div class="cc-info"><div class="cc-name">${searchEsc(title)}</div>${sub ? `<div class="cc-sub">${searchEsc(sub)}</div>` : ''}</div>
        </div>`;
    const section = (label, itemsHtml) => itemsHtml
        ? `<div style="font-size:11px;font-weight:800;color:var(--inv-muted-light);text-transform:uppercase;letter-spacing:.5px;margin:10px 0 6px">${label}</div>${itemsHtml}`
        : '';

    const custHtml = (custR.data || []).map(x => row('👤', x.name, x.phone, `searchGoCustomer('${x.id}')`)).join('');
    const suppHtml = (suppR.data || []).map(x => row('🏭', x.name, x.phone, `searchGoSupplier('${x.id}')`)).join('');
    const prodHtml = (prodR.data || []).map(x => row('🏷️', x.name, [x.code, x.barcode].filter(Boolean).join(' — '), `searchGoProduct('${x.id}')`)).join('');
    const salesHtml = (salesR.data || []).map(x => row('🧾', x.invoice_no, '', `searchGoInvoice('sales', '${x.invoice_no}')`)).join('');
    const purHtml = (purR.data || []).map(x => row('📥', x.invoice_no, '', `searchGoInvoice('purchase', '${x.invoice_no}')`)).join('');

    const html = [
        section('👤 عملاء', custHtml),
        section('🏭 موردين', suppHtml),
        section('🏷️ أصناف', prodHtml),
        section('🧾 فواتير مبيعات', salesHtml),
        section('📥 فواتير مشتريات', purHtml),
    ].join('');

    results.innerHTML = html || `<div class="empty-state" style="padding:30px 10px"><span>🔍</span>لا نتائج لـ"${searchEsc(term)}"</div>`;
}

window.searchGoCustomer = function (id) {
    window._pendingCustomerStatement = id;
    window._pendingCustHubTab = 'statement';
    window.searchClosePalette();
    document.querySelector('[data-mod="customers-hub"]')?.click();
};
window.searchGoSupplier = function (id) {
    window._pendingSupplierStatement = id;
    window._pendingSuppHubTab = 'statement';
    window.searchClosePalette();
    document.querySelector('[data-mod="suppliers-hub"]')?.click();
};
window.searchGoProduct = function (id) {
    window._pendingProductEdit = id;
    window.searchClosePalette();
    document.querySelector('[data-mod="products"]')?.click();
};
window.searchGoInvoice = function (type, no) {
    window._pendingInvoiceReviewSearch = { type, no };
    window.searchClosePalette();
    document.querySelector('[data-mod="invoice-review"]')?.click();
};
// إقفال تلقائي للقائمة بعد اختيار صفحة في الشاشات الصغيرة (تجربة استخدام أفضل)
const _origLoadModForSidebar = window.loadMod;

// ── تسجيل Service Worker (يفعّل خيار "تثبيت على سطح المكتب") ──
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    });
}