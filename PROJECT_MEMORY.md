# ذاكرة مشروع سلطان — Sultan Ecosystem Memory

> **آخر مراجعة شاملة:** 2026-09-29 (قراءة كاملة للأكواد الأربعة + فحص قاعدة البيانات الحية للقراءة فقط، بدون أي تعديل).
> الغرض: مرجع نبدأ منه أي جلسة جديدة بدون إعادة اكتشاف/إعادة كتابة أي شيء.
> ⚠️ المستودعات الأربعة **عامة (public)** — لا تُكتب هنا أسرار أو ثغرات. الملاحظات الأمنية في ملف خاص غير مرفوع.

---

## 1) الصورة الكبيرة

نظام متكامل لشركة **Sultan Food Products** (جملة مواد غذائية، مصر). أربع مستودعات + قاعدة بيانات واحدة:

| المستودع | الدور | التقنية | الحجم |
|---|---|---|---|
| `sultan-erp` | **الـERP الرئيسي** (لوحة الإدارة): مبيعات، مشتريات، مخزون، محاسبة، خزن، مصروفات، مرتجعات، رواتب، مستثمرين، CRM، مراجعة طلبات سلطانو، إدارة المندوبين | HTML/CSS/JS ثابت (بدون build ولا package.json ولا اختبارات) — 82 ملف JS، ~36K سطر | كبير |
| `mandob-sultan` | **تطبيق المندوب** (PWA أوفلاين-أولاً) على تليفون المندوب: بيع من العربية، تحصيل، مصروفات، مرتجعات، زيارات، إغلاق يومية | ملف `index.html` واحد ~4.8K سطر + `sw.js` | متوسط |
| `sultanoo` | **تطبيق العملاء (سلطانو)** — كتالوج وطلبات للعملاء (PWA) | JS modular (`js/api`, `js/pages`, `js/layers`, `js/core`) + CSS | ~6.5K سطر |
| `sultan-sales` | **متابعة المبيعات/CRM** للموظفين: عملاء محتملين (leads) + متابعة واتساب يومية للعملاء الحاليين | ملف `index.html` واحد ~1.4K سطر | صغير |

**الكل يتكلم مع نفس مشروع Supabase** (`workflow-hub`, ref `fanaozxqlodzfdgstwaz`, منطقة ap-southeast-2, Postgres 17). لا يوجد سيرفر تطبيق ولا API خاص: المتصفح يكلم Supabase مباشرة بالمفتاح العام (publishable/anon) والحماية عبر **RLS + دوال Postgres**.

الواجهة كلها عربي RTL (خط Cairo). التعليقات في الكود بالعامية المصرية.

---

## 2) قاعدة البيانات (Supabase)

### 2.1 المبدأ الأهم
**الصحة المالية تعيش في Postgres لا في JS.** الواجهة تُدخل الصف "الجذر" فقط (فاتورة/دفعة/مصروف/تحويل) والـ **Triggers (SECURITY DEFINER)** تتولى: المخزون، أرصدة العملاء/الموردين، الخزنة (`cash_transactions`)، والقيود (`journal_entries/lines`). الواجهة **لا تكتب القيود مباشرة أبداً** (الدفاتر للقراءة فقط).
النسخة الحية هي المرجع؛ في الريبو فقط جزء من الـ migrations (مجلد `archive/sql-migrations-applied/` + بضعة ملفات في الجذر). **آخر migration مسجّل: 2026-08-25.** لكن الحساب `3005` وقيود التقفيل (31/8 و2/9) اتعملت بدون migration مسجّل (على الأغلب SQL مباشر).

### 2.2 الجداول (97 جدول في public، RLS مفعّل على الكل) — مجمّعة حسب المجال
- **الهوية والمستخدمون:** `profiles` (role: admin/employee/accountant/cashier/rep — مربوط بـ auth.users), `role_permissions` (قائمة *منع* لكل دور), `sales_reps` (id = نفس uuid المستخدم), `employees`.
- **الأصناف:** `products` (~674), `product_categories`, `product_companies`, `price_levels` (5 مستويات), `product_prices` (~3170), `customer_groups` (مستوى سعر افتراضي + خصم + حد ائتمان).
- **العملاء/الموردون:** `customers` (~376; balance مخزّن كـ cache; `debt_locked`, `source`, `payment_due_date`, `loyalty_points_balance`), `suppliers` (~37), `customer_regions` (فيها `min_order_amount`), `customer_classifications`, `customer_change_requests` (طلبات تعديل/إضافة من المندوب وسلطانو تنتظر مراجعة), `customer_interactions`, `crm_leads` (~3.3K).
- **المبيعات:** `sales` + `sale_items` (`cost_price_snapshot`), `sales_returns` + `sale_return_items`, `quotations*`. `source_app`: `erp` / `rep_van` / `dexef_migration` (تاريخي) / `test`. `ref` فريد للـ idempotency (`REP-SALE-…`).
- **المشتريات:** `purchases` + `purchase_items` (نظام **المؤجل/الخصومات المؤجلة** `deferred_*`), `purchase_returns*`, `purchase_orders*`, `deferred_rebates*`, `deferred_rebates_manual`.
- **المخزون:** `warehouses` (المخزن الرئيسي + "المكنة"), `inventory_stock`, `van_stock` (مخزون عربية كل مندوب — منفصل), `van_stock_loads/returns/counts*`, `stock_transfers*`, `inventory_transfers*` (الأخير غير مستخدم), `stock_counts*`.
- **المالية:** `accounts` (شجرة حسابات), `journal_entries/lines`, `cash_transactions`, `treasuries` (8 خزن، منها خزنة لكل مندوب), `treasury_transfers`, `balance_transfers`, `customer_payments` (سندات القبض الفعلية), `customer_collections` (**جدول قديم فارغ**), `supplier_payments`, `expenses`, `expense_categories`, `opening_balances`, `accrued_liabilities_manual`, `financial_events` (سجل تدقيق مالي).
- **المستثمرون:** `capital_partners`, `capital_partner_transactions`, `investor_profit_snapshots_v2` + `_lines` (النسخة v1 `investor_profit_snapshots` قديمة/فارغة).
- **المندوبون:** `rep_routes`, `rep_route_customers`, `rep_visits`, `rep_day_closings` (unique rep_id+close_date), `rep_invoice_offers`.
- **سلطانو:** `customer_orders/_items`, `customer_carts`, `banners`, `push_subscriptions`, `loyalty_points_ledger`.
- **أخرى:** `app_settings` (jsonb، ~27 مفتاح)، `system_settings`, `attendance_records`, `employee_evaluations`, `employee_incentives`, `archive_documents`, `private_chat_*`, `tasks/messages/conversations/notifications` (بقايا مشروع "workflow-hub" الأصلي), `activity_logs`.

### 2.3 دوال RPC المهمة (كلها SECURITY DEFINER)
- **إنشاء ذري:** `fn_create_sale`, `fn_create_purchase`, `fn_create_sales_return`, `fn_create_purchase_return`, `fn_create_rep_customer_return` (المرتجع يرجع لعربية المندوب؛ فيها فحص `auth.uid()`).
- **عكس للتعديل:** `fn_reverse_sale_for_edit`, `fn_reverse_purchase_for_edit`, `fn_reverse_sales_return_for_edit`, `fn_reverse_purchase_return_for_edit` ("تعديل فاتورة" = إلغاء القديمة + إنشاء جديدة).
- **مخزون:** `adjust_stock`, `adjust_van_stock`, `fn_apply_stock_count`, `fn_apply_van_stock_count`.
- **نقدية/قيود:** `post_cash` (3 overloads), `post_journal` (overloadان), `build_lines`, `get_cash_balance`, `get_treasury_balances`, `log_financial_event`.
- **مستثمرون/التزامات:** `fn_close_investor_month`, `fn_post_capital_partner_transaction`, `fn_settle_accrued_liability`, `fn_sync_owner_deficit_to_ledger` (trigger).
- **مؤجل:** `fn_register_historical_deferred_rebate`, `fn_receive_deferred_rebate_manual`, `fn_mark_deferred_rebate_received`, `fn_list_pending_deferred_rebates`.
- **سلطانو (`fn_sultano_*`):** get_priced_products / categories / subcategories / areas / banners / settings / customer_by_phone / customer_account / orders / order_status / loyalty…, `submit_order` (السعر يُحسب على السيرفر، فيه idempotency بـ `client_order_id`), `register_customer`, `request_customer_update`, `save/remove_push_subscription`, `sync_cart`, `clear_cart`, `check_cart_fulfilled`. `fn_loyalty_redeem_points` للأدمن.
- **Triggers أساسية:** `trg_sale_status` / `trg_purchase_status` / `trg_*_return_status` / `trg_customer_payment_status` / `trg_payment_status` / `trg_expense_status` (تنشئ الخزنة والقيد والرصيد عند التأكيد/الإلغاء)، `trg_sale_item_insert` (المخزون + COGS)، `trg_sale_item_van_stock`, `trg_van_stock_load/return_item_apply`, `trg_treasury_transfer`, `trg_balance_transfer`, `trg_capital_partner_tx_apply`, `trg_block_edit_*` (منع تعديل المبالغ بعد التأكيد), `trg_customer_orders_award_loyalty_points`.
- **Edge Function:** `send-push-notification` (Web Push لعملاء سلطانو، VAPID، verify_jwt=true) — الكود في `supabase/functions/`.

### 2.4 شجرة الحسابات (32 حساب)
أصول: 1001 الخزينة، 1002 ذمم من المالك (**اتصفّرت**), 1003 العملاء, 1004 المخزون, 1005 مؤجلات مستحقة من الموردين. خصوم: 2001 الموردون, 2002 التزامات مستحقة, 2003 ضريبة. حقوق ملكية: 3001 افتتاحية, 3002 أرباح مرحّلة, 3003 رأس مال المالك, 3004 رأس مال المستثمرين, **3005 جاري المالك (تحميل نتيجة النشاط حتى 31/8/2026)**. إيرادات: 4001 مبيعات, 4020 زيادة مخزون. مصروفات: 5001–5014 (عمومية/صيانة/إدارية/إيجار/ضيافة/متنوعة/أجور/…/ميدانية), **5015 COGS**, 5016 خصومات مسموح بها, 5020 عجز مخزون.
الضريبة معطّلة (`vat_enabled=false`, نسبة 14%). عدّادات الترقيم في `app_settings` (`invoice_counter`, `purchase_counter`, …) وتُقرأ/تُزاد داخل RPC.

### 2.5 Views للتحقق
`customers_balance_check/drift`, `suppliers_balance_check/drift`, `inventory_ledger_check/drift`, `deferred_rebates_supplier_summary`.
⚠️ **الـdrift views غير موثوقة**: `customers_balance_drift` تقرأ `customer_collections` (فارغ) بدل `customer_payments`، و`suppliers_balance_drift` لا تشمل `balance_transfers`، و`inventory_ledger_check` تستثني مخزون العربيات. **لا تعتبر أرقامها أخطاء فعلية.** المرجع الصحيح: مقارنة حساب 1003 بمجموع `customers.balance`، و2001 بمجموع `suppliers.balance`، و1001 بـ `get_cash_balance()`.

### 2.6 نموذج الصلاحيات (RLS) باختصار
- معظم الجداول: قراءة لأي مستخدم مسجّل (`auth.uid() is not null`)، والكتابة مقيّدة بالدور عبر `profiles.role` (admin/accountant/cashier؛ المندوب له استثناءات محددة: تحصيل، مصروف، عميل جديد، تحويل من خزنته، عملياته على عربيته).
- `journal_entries` و`cash_transactions`: قراءة admin/accountant فقط.
- جداول مفتوحة لأي `authenticated`: `app_settings`, `capital_partners`, `accrued_liabilities_manual`, `crm_leads`, `rep_day_closings`, `customer_interactions`, `archive_documents`, `attendance_records`, `investor_profit_snapshots*`, `employee_incentives`, `sales_update_due_date`.
- الصلاحيات على مستوى الصفحة (`role_permissions`) **قائمة منع + fail-open** في الواجهة (خطأ في الفحص = مسموح) — هي إخفاء واجهة فقط، الحماية الحقيقية RLS.
- المستخدمون الحاليون: 5 (2 admin منهم 1 معطّل، 3 مندوبين منهم 1 معطّل).

---

## 3) الـERP (`sultan-erp`)

### 3.1 البنية
- **لا نظام modules**: كل ملف `<script defer>` في `index.html` ثم `js/app.js` (والاستثناء: `users-management.js` و`advanced-permissions.js` بعد `app.js` لأنهما يلفّان `setupApp`/`loadMod`). الدوال top-level = globals؛ أي callback يُبنى داخل دالة ويُستدعى من `onclick` لازم `window.x = …`.
- **الراوتر:** `window.loadMod(el, modName)` في `js/app.js` ← جدول `titles` + سلسلة `if (modName === … ) await renderX(c)` في `_dispatchRender`. إضافة صفحة = 3 أماكن (script tag، nav-item في `buildLayout()`، title + dispatch).
- **تبويبات مثبّتة (keep-alive)** عبر `pinCurrentTab`, بحث عام Ctrl+K, وضع ليلي, قائمة قابلة للطي.
- **كل موديول** له بادئة (`inv*` sales, `pur*` purchases, `acc*`, `md*`, `ob*`, `csi*`, `cor*` طلبات سلطانو, `invs*` مستثمرين, …) وفورمات خاص (`<prefix>Fmt`).
- **Hubs بتبويبات:** products-hub, customers-hub, suppliers-hub, inventory-hub, reports-hub, settings-hub, accounting-books-hub, accounting-monitoring-hub, rep-management (تجمّع موديولات موجودة بدون تكرار).
- **Service Worker (`sw.js`, shell v6):** ⚠️ يخزّن قشرة التطبيق (cache-first) ويترك Supabase من الشبكة دائماً. (ملف `CLAUDE.md` لسه يقول إنه لا يخزّن شيئاً — **قديم**.) لذلك عند تعديل ملف لازم رفع `?v=` في `index.html` و/أو رقم `SHELL_CACHE` وإلا لن يصل التحديث للأجهزة المثبّتة.
- **أوفلاين:** `js/offline.js` (IndexedDB: cache / queue / reconciliation، BroadcastChannel + Web Locks، أرقام مؤقتة بمعرّف جهاز) + `offline-panel.js`. الأرقام المحسوبة أوفلاين تقدير فقط.
- **CSS:** `<style>` داخل `index.html` (`.mod-*`, `.inv-*`, tokens `--inv-*`) + `css/claude-modules.css` (`.dash-*`). ألوان hex مكررة في ~48 ملف (ديون تنظيمية، لا تُعالج بحذف جماعي).

### 3.2 خريطة الموديولات (الملف ← الوظيفة)
- **مبيعات:** `sales.js` (2020 سطر — فاتورة ثنائية الأعمدة، مسودات/حفظ تلقائي، تنبيه تجاوز حد الائتمان + إشعار الأدمن، تعديل عبر reverse+create، اختصارات كيبورد), `pos.js` (كاشير سريع + باركود + مخزون حي), `quotations.js`, `returns.js` (مرتجع بيع/شراء), `invoice-review.js`, `thermal-print.js` (80mm), `print-center.js` (A4).
- **مشتريات:** `purchases.js` (المؤجل: deferred_rate/type/due_date + سؤال تحديث سعر الشراء الرئيسي), `purchase-price-bulk.js`, `purchase-orders.js`, `purchase-suggestions.js`.
- **عملاء/موردون:** `master-data.js` (القائمة الموحدة), `customers.js`/`suppliers.js` (كشف الحساب), `collections.js` (سندات قبض), `payments.js` (سندات صرف), `balance-transfer.js`, `customer-decision-center.js`/`supplier-decision-center.js`/`item-decision-center.js`/`expense-decision-center.js`/`employee-decision-center.js` (تصنيف رباعي بقواعد قابلة للتعديل في `app_settings`), `customer-supplier-import.js`, `product-import.js`, `general-import-export.js`.
- **مخزون:** `inventory.js` (أرصدة + جرد فعلي), `stock-transfer.js`, `warehouses.js`, `warehouse-reports.js`, `van-stock-load/return/view/count.js`.
- **مندوبون:** `sales-reps.js`, `rep-visits.js` (زيارات + خطوط سير + أهداف), `rep-daily-closing.js`, `rep-customer-requests.js` (مراجعة طلبات العملاء), `rep-management.js`.
- **سلطانو داخل الـERP:** `customer-orders-review.js` (طلبات، تسجيلات جديدة، بانرات، إشعارات push، سلال حيّة، إعدادات، ولاء), `sultanoo-settings.js` (وضع الإجازة + شكل القائمة — أُضيف في سبتمبر).
- **مالية/محاسبة:** `treasury.js`, `expenses.js` (حد شهري لكل بند وإجمالي), `accounting.js` (شجرة/قيود/ميزان/ميزانية), `general-ledger.js`, `cash-movement.js`, `audit-log.js`, `archive.js`, `opening-balances.js`, `liquidity-forecast.js`, `investors.js`.
- **موظفون:** `payroll.js` (جداول بيانات فقط، بلا trigger مالي)، `employee-evaluation.js`, `attendance.js` (بصمة بضغطة واحدة).
- **تقارير/لوحة:** `dashboard.js`, `reports.js`, `performance-reports.js`.
- **أخرى:** `crm.js` (1104 سطر), `private-chat.js` (محادثة 1:1 بكلمة سر منفصلة), `settings.js` (نسخ احتياطي JSON لكل الجداول + تنبيه بعد 7 أيام), `users-management.js`, `advanced-permissions.js`, `coming-soon.js` (واتساب/ذكاء اصطناعي — مؤجلة).

### 3.3 كتابات مباشرة من الواجهة (خارج RPC)
`customers`, `suppliers`, `products`, `product_prices`, `sales_reps`, `warehouses`, `treasuries`, `app_settings` (upsert), `opening_balances`, `expenses`, `customer_payments`, `supplier_payments`, `treasury_transfers`, `van_stock_loads/returns`, `stock_transfers`, `attendance_records`, `crm_leads`, `customer_orders` (تحديث حالة)… أما **المبيعات/المشتريات/المرتجعات/الجرد/المستثمرون/التزامات مستحقة** فكلها عبر RPC.

---

## 4) تطبيق المندوب (`mandob-sultan`)

- ملف واحد؛ تخزين محلي في `localStorage` بمفتاح `sx_*` (ليس IndexedDB): `rep`, `cfg`, `days`, `customers`, `van_stock`, `sync_queue`, `invoiceIdMap`, …
- **الدخول:** جلسة Supabase حقيقية (`profiles.role='rep'` و`is_active`)، ثم **PIN محلي (4 أرقام)** لفتح التطبيق، و**PIN مدير (6 أرقام)** لعمليات الأدمن المحلية (تعديل/حذف قديم، إعدادات). `verifyRepStillActive` في الخلفية.
- **أوفلاين-أولاً:** كل عملية تُسجَّل محلياً وتدخل `SYNC_QUEUE`، وتُزامَن كل 30 ثانية / عند رجوع النت عبر `SYNC_HANDLERS`: `sale` (→ `fn_create_sale`, `p_source_app='rep_van'`, `p_ref='REP-SALE-<id>'`), `cancel_sale` (UPDATE status='cancelled'), `collection` (→ `customer_payments` بـ `REP-COL-<ts>`), `expense` (`REP-EXP-<ts>`), `warehouse_return` (→ `van_stock_returns`), `customer_return` (→ `fn_create_rep_customer_return`), `visit` (→ `rep_visits`), `deposit` (→ `treasury_transfers` من خزنة المندوب للرئيسية), `route_add_customer`, `day_close` (→ `rep_day_closings`).
- **Idempotency:** `isDuplicateRefError` (23505 على ref) = نجاح سابق. البيع يمنع الأصناف غير الحقيقية (غير UUID). خزنة المندوب تُقرأ **حيّة وقت المزامنة**.
- **سحب من ERP:** عملاء المندوب (primary/default rep) + أرصدتهم وحدود ائتمانهم و`debt_locked`، مخزون العربية (`van_stock`), خطوط السير، مستوى السعر/الأهداف/الخزنة. عميل جديد أو تعديل من المندوب يمر على `customer_change_requests` للمراجعة.
- إشعارات **تيليجرام** (بوت) لكل عملية + طباعة/واتساب للفاتورة. تحميل العربية بنفسه (`van_stock_loads` بـ PIN).
- SW `mandob-sultan-v18` cache-first لنفس الأصل فقط.

## 5) تطبيق العملاء (`sultanoo`)

- `CONFIG.DATA_PROVIDER = 'erp'` (البديل القديم `sheets` = Google Sheets/Apps Script ما زال موجوداً في `providers/sheets.js` وفي `config.js`).
- **الهوية = رقم التليفون فقط** (بدون Auth): `fn_sultano_get_customer_by_phone` → يحفظ العميل محلياً. مستخدم Supabase مجهول (anon) وكل شيء عبر RPC.
- الصفحات: home, category, product, search, cart, favorites, orders, profile (حسابي + ولاء + مسح كاش), register. سلة محفوظة محلياً وتُزامَن للسيرفر (`sync_cart`) ليراها الأدمن؛ الطلب بـ `client_order_id` لمنع التكرار؛ push notifications (VAPID عام في config).
- الإعدادات من ERP: `min_order_amount`, `vacation_mode`/`vacation_message` (قفل كامل للتطبيق), `category_display_mode` (`main`/`sub`), الولاء (معطّل حالياً `sultanoo_loyalty_enabled=false`).
- الطلب يبقى "معلّق" حتى يعتمده موظف من ERP (يفتح شاشة المبيعات معبّأة) ← يُنشئ `sales` ويُربط `converted_sale_id`. **اختلاف المجموع/العميل بين الطلب والفاتورة سلوك تشغيلي مقبول** (قرار المالك).
- SW: `sultan-static-v3.4.2` / `sultan-data-v3.3.0` (لازم رفع الرقم مع كل نشر).

## 6) تطبيق المبيعات/CRM (`sultan-sales`)
- ملف واحد. دخول Supabase حقيقي (profiles). يقرأ/يكتب `crm_leads` (مراحل + متابعة + تحويل lead لعميل حقيقي `customers`) و`customer_interactions` (مهام متابعة العملاء الحاليين)، ويقرأ/يحفظ قوالب واتساب في `app_settings.crm_whatsapp_templates`. وضعان: عملاء محتملين / عملاء حاليين. تصدير CSV. SW `sultan-sales-shell-v2`.

---

## 7) الوضع المحاسبي والتشغيلي الحالي (2026-09-29)

- النظام بدأ فعلياً 13/7/2026 (`system_start_date`), أول مبيعات 30/4/2026 (تاريخي DEXEF مستورد). نقطة الفتح التشغيلية المعتمدة: **1/8/2026**. الشركة انتقلت من برنامج **DEXEF** (ما زالت بقايا `dexef_migration` و`fn_migrate_*`).
- مبيعات: 1538 (1476 مؤكدة، 62 ملغاة) — المصدر: rep_van 884، erp 405، dexef 248، test 1. آخر نشاط اليوم.
- **دفتر اليومية سليم:** 13,117 قيد كلها متوازنة، لا قيد بلا سطور.
- **تطابقات مؤكدة اليوم:** الخزينة 1001 = `get_cash_balance()` = 70,626.81؛ العملاء 1003 = مجموع `customers.balance` = 55,622.50.
- **موردون:** 2001 = 158,839.00 دائن مقابل مجموع `suppliers.balance` = 152,963.00 → **فرق 5,876 يحتاج تفسير** (لم يُفسَّر بعد).
- **مخزون:** 1004 = 36,281.29 مقابل قيمة رئيسي 32,252.26 (+ عربيات 7,345.87 = 39,598.13 بأسعار الشراء الحالية). لا أرصدة سالبة. (تغيّر كبير عن أغسطس — كان ~130K؛ السبب لم يُوثَّق هنا.)
- **تقفيل أغسطس:** `CLOSE-PL-2026-08-31` (إقفال الإيرادات والمصروفات على جاري المالك 3005) + `CLOSE-1002-2026-08-31` (نقل ذمة المالك 1002 إلى 3005) + `CLOSE-EQUITY-2026-08-31`. بعد ذلك حساب 1002 = 0 ومطلوب عدم عودته.
- ⚠️ **تعارض معروف:** الـtrigger `fn_sync_owner_deficit_to_ledger` على `capital_partners` يعيد ترحيل `cumulative_deficit` للمالك إلى 1002 عند أي تحديث، وقد اضطررنا مرتين لعكسه يدوياً (`REV-SYNC-1002-…` في 1/9 و2/9). ما دام `cumulative_deficit` للمالك ≠ 0 وحساب 1002 = 0، أي تعديل على شريك المالك سيعيد المشكلة. **قرار مطلوب** قبل لمس المستثمرين (تعطيل الـtrigger أو تعديل منطقه).
- **المستثمرون:** نموذج وعاء رأس مال واحد (المالك + مستثمرين)، توزيع بمتوسط الرصيد المرجّح بالأيام، `effort_ratio` للمالك يُخصم أولاً (لا مجهود في شهر الخسارة)، الخسارة تُرحَّل كعجز، تقفيل شهر ذري عبر `fn_close_investor_month` (شهر واحد فقط مُقفل: أغسطس = خسارة). الحركات النقدية للمستثمر تمر الآن بـ`fn_post_capital_partner_transaction` مع اختيار خزنة (أُصلح في 25/8).
- **التزامات مستحقة (`accrued_liabilities_manual`):** 8 بنود يوليو/أغسطس كلها مسدّدة.

### قرارات المالك المسجّلة (لا تُعاد مناقشتها)
1. قيد 1/8/2026 المصحّح هو نقطة الفتح المعتمدة.
2. فروق مجاميع/عملاء طلبات سلطانو مقابل الفواتير = تعديل يدوي مقبول.
3. تسوية خصم "ام كريم" معتمدة. تحصيل "ام وعد" بلا `treasury_id` سليم (دخل الرئيسية).
4. صفوف إغلاق المندوب 12 و16 أغسطس = أرقام مرجعية تاريخية.
5. تصحيح المخزون بتاريخ 25/8 (تصفير `OLD-DELETED-ITEM` والصنفين السالبين) تم بجرد موثّق.
6. شاشة المخزون تعرض إجمالي (رئيسي + عربيات). شاشة التحصيل ترفض الحفظ بلا خزنة وتستخدم الافتراضية.
7. حركات المستثمرين لازم ربط بخزنة + ترحيل ذري.

---

## 8) ديون تقنية وملاحظات غير أمنية

1. `CLAUDE.md` قديم في نقطة واحدة: يقول SW لا يخزّن شيئاً (الآن يخزّن القشرة). يُحدَّث لاحقاً.
2. لا اختبارات ولا linter ولا build. التحقق يدوي من المتصفح.
3. `customer_collections` (جدول قديم فارغ)، `inventory_transfers*`, `investor_profit_snapshots` (v1)، وجداول workflow-hub (tasks/conversations/messages/files/customer_notes/product_imports) غير مستخدمة فعلياً.
4. عدة سياسات RLS مكررة على `products`/`warehouses`/`inventory_stock`؛ و`app_settings` يحمل بعض القيم بترميز JSON مزدوج (`"\"false\""`) — سببت أخطاء سابقة (راجع migrations `fix_double_json_encoding`)؛ القراءة لازم تفك الترميز بحذر.
5. أغلب أكواد الواجهة تبني HTML بـ template literals **بدون escaping** للبيانات القادمة من قاعدة البيانات (الموجود فقط `searchEsc` في app.js و1 في van-stock-view). هذا نمط مقصود تاريخياً لكنه مصدر خطر (انظر الملف الأمني الخاص).
6. جزء من migrations الحية غير موجود في الريبو (تعرّف بـ `list_migrations` من Supabase؛ آخر واحد 2026-08-25).
7. مفاتيح Google Sheets/Apps Script القديمة ما زالت في `sultanoo/config/config.js` رغم أن المزوّد الحالي ERP.
8. الترقيم `invoice_counter` مشترك — لا تغيّر القيمة يدوياً.

## 9) قواعد العمل معنا (للجلسات القادمة)
- **لا تعدّل شيئاً قبل فهم الملف ذي الصلة**، واسأل قبل افتراض وجود/عدم وجود جدول/عمود/trigger — الحقيقة في Supabase الحي.
- أي ميزة تمس مخزون/رصيد/قيد: التغيير في Postgres (RPC/trigger) والواجهة تُدخل الصف الجذر فقط.
- موديول جديد: 3 أماكن (script + nav + router) وبادئة خاصة + `window.fn =` للـcallbacks.
- بعد أي تعديل: رفع `?v=` في `index.html` (ERP) أو رقم الـcache في `sw.js` (المندوب/سلطانو/المبيعات).
- الفرع المخصّص للعمل: `claude/code-review-comprehensive-6gueuq` في كل المستودعات الأربعة.
