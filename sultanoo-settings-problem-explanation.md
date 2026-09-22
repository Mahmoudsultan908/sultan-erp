# مشكلة صفحة إعدادات سلطانو في ERP

## 📋 الخلفية

تم إضافة ميزتين جديدتين لتطبيق **سلطانو** (تطبيق الكتالوج للعملاء):

### 1️⃣ وضع الإجازة (Vacation Mode)
- عند التفعيل: التطبيق يتوقف تماماً بعد شاشة السبلاش
- يظهر شاشة إجازة فيها:
  - لوجو التطبيق
  - رسالة قابلة للتخصيص (من إعدادات ERP)
  - زرار واتساب (اختياري)
- **بدون أي وصول** للكتالوج أو الطلبات لحد ما يتم إلغاء وضع الإجازة

### 2️⃣ شكل القائمة الرئيسية
- **`'main'`** (الافتراضي): الرئيسية تعرض الأقسام الرئيسية فقط
- **`'sub'`**: الرئيسية تعرض كل الأقسام الفرعية مباشرة (مفلطحة)

---

## 🏗️ البنية التحتية

### قاعدة البيانات (Supabase)

#### جدول `app_settings`
```sql
CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

الصفوف المطلوبة:
```sql
INSERT INTO app_settings (key, value) VALUES
    ('vacation_mode', 'false'),
    ('vacation_message', '""'),
    ('category_display_mode', '"main"');
```

#### دالة `fn_sultano_get_settings()`
```sql
CREATE OR REPLACE FUNCTION fn_sultano_get_settings()
RETURNS TABLE (
    min_order_amount NUMERIC,
    whatsapp_number TEXT,
    store_name TEXT,
    vacation_mode BOOLEAN,
    vacation_message TEXT,
    category_display_mode TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE((SELECT (value::jsonb)::text::numeric FROM app_settings WHERE key = 'min_order_amount'), 0),
        COALESCE((SELECT (value::jsonb)::text FROM app_settings WHERE key = 'whatsapp_number'), ''),
        COALESCE((SELECT (value::jsonb)::text FROM app_settings WHERE key = 'store_name'), 'سلطانو'),
        COALESCE((SELECT (value::jsonb)::text::boolean FROM app_settings WHERE key = 'vacation_mode'), false),
        COALESCE((SELECT (value::jsonb)::text FROM app_settings WHERE key = 'vacation_message'), ''),
        COALESCE((SELECT (value::jsonb)::text FROM app_settings WHERE key = 'category_display_mode'), 'main');
END;
$$;

GRANT EXECUTE ON FUNCTION fn_sultano_get_settings() TO anon, authenticated;
```

**✅ هذا الجزء تم تنفيذه بنجاح** — الدالة شغالة والبيانات موجودة.

---

## 📱 التعديلات على تطبيق سلطانو

### الملفات المتأثرة

#### 1. `index.html`
أضيفت شاشة الإجازة بعد `#register-screen`:
```html
<!-- شاشة الإجازة -->
<div id="vacation-screen" class="splash-screen">
    <div class="splash-content">
        <img src="img/logo.png" alt="سلطانو" class="splash-logo">
        <p id="vacation-message" class="vacation-msg">التطبيق في إجازة مؤقتة</p>
        <a id="vacation-whatsapp" href="#" target="_blank" class="vacation-whatsapp-btn" style="display:none">
            📱 تواصل معنا عبر واتساب
        </a>
    </div>
</div>
```

#### 2. `css/components.css`
استايل شاشة الإجازة:
```css
#vacation-screen {
    position: fixed;
    inset: 0;
    background: linear-gradient(135deg, #1a1f3a 0%, #0f1419 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9998;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.4s ease;
}

#vacation-screen.active {
    opacity: 1;
    pointer-events: auto;
}
```

#### 3. `js/app.js`
تعديلات في `App.init()`:
```javascript
async init() {
    // السبلاش
    setTimeout(() => { splash.classList.remove('active'); }, 2000);

    // تحميل الإعدادات بالتوازي مع السبلاش
    const settingsPromise = API.initSettings();

    // انتظار الإعدادات
    await settingsPromise;
    const settings = API.getSettings();

    // فحص وضع الإجازة
    if (settings.vacation_mode) {
        App.showVacationScreen(settings);
        return; // ⚠️ توقف كامل هنا — بدون تسجيل عميل ولا فتح رئيسية
    }

    // باقي الكود العادي...
}

showVacationScreen(settings) {
    const screen = document.getElementById('vacation-screen');
    const msgEl = document.getElementById('vacation-message');
    const waBtn = document.getElementById('vacation-whatsapp');

    if (settings.vacation_message) {
        msgEl.textContent = settings.vacation_message;
    }

    if (settings.whatsapp_number) {
        waBtn.href = `https://wa.me/${settings.whatsapp_number}`;
        waBtn.style.display = 'block';
    }

    screen.classList.add('active');
}
```

#### 4. `js/api/api.js`
دالة جديدة `getHomeCategories()`:
```javascript
async getHomeCategories() {
    const mode = (this.settings?.category_display_mode || 'main');
    
    if (mode === 'main') {
        return this.getMainCategories();
    }
    
    // mode === 'sub': إرجاع الأقسام الفرعية مفلطحة
    const cached = Storage.getCache(Storage.CACHE_HOME_CATS);
    if (cached) return cached;

    const main = await this.getMainCategories();
    const result = [];

    for (const cat of main) {
        const subs = await this.getSubcategories(cat.id);
        if (subs.length > 0) {
            result.push(...subs);
        } else {
            result.push(cat); // قسم رئيسي بدون فرعية
        }
    }

    Storage.setCache(Storage.CACHE_HOME_CATS, result, CONFIG.CACHE.TTL_CATEGORIES);
    return result;
}
```

#### 5. `js/pages/home.js`
سطر واحد تغيّر:
```javascript
// قبل:
const categories = await API.getMainCategories();

// بعد:
const categories = await API.getHomeCategories();
```

#### 6. `js/api/providers/erp.js`
**أهم تعديل:**
```javascript
async getSettings() {
    const { data } = await this.client.rpc('fn_sultano_get_settings');
    if (!data || data.length === 0) return DEFAULT_SETTINGS;
    
    const row = data[0];
    return {
        min_order_amount: row.min_order_amount || 0,
        whatsapp_number: row.whatsapp_number || '',
        store_name: row.store_name || 'سلطانو',
        vacation_mode: row.vacation_mode || false,           // ✅ جديد
        vacation_message: row.vacation_message || '',        // ✅ جديد
        category_display_mode: row.category_display_mode || 'main' // ✅ جديد
    };
}
```

**✅ كل التعديلات دي تمت على الكود** — الملفات محدّثة ومرفوعة على GitHub.

---

## 🖥️ صفحة التحكم في ERP

### الملف: `js/modules/sultanoo-settings.js`

صفحة إعدادات في **برنامج ERP** (Sultan ERP) تسمح بتغيير الإعدادات دي من واجهة مرئية بدلاً من التعديل اليدوي في قاعدة البيانات.

#### التكامل مع ERP

**1. `index.html` — إضافة الـ `<script>`:**
```html
<script src="js/modules/sultanoo-settings.js"></script>
```

**2. `js/modules/customer-orders.js` — إضافة تبويب جديد:**
```javascript
const tabsHTML = `
    <div class="mod-tabs">
        <button class="mod-tab active" data-tab="orders">📦 الطلبات</button>
        <button class="mod-tab" data-tab="settings">⚙️ إعدادات سلطانو</button>
    </div>
`;

// معالجة التبويبات
if (tab === 'settings') {
    if (typeof renderSultanooSettings === 'function') {
        await renderSultanooSettings(setHubBody);
    }
}
```

#### الوظيفة الرئيسية

```javascript
async function renderSultanooSettings(c) {
    // ⚠️ المشكلة كانت هنا:
    const sbClient = window.sb;  // ❌ مش موجود في ERP
    if (!sbClient) { 
        c.innerHTML = '<p>⚠️ غير متصل بقاعدة البيانات</p>'; 
        return; 
    }

    // الصح:
    if (typeof sb === 'undefined') {  // ✅ sb موجود كـ global مباشرة
        c.innerHTML = '<p>⚠️ غير متصل بقاعدة البيانات</p>'; 
        return; 
    }

    // قراءة الإعدادات
    const { data: settings } = await sb
        .from('app_settings')
        .select('key, value')
        .in('key', ['vacation_mode', 'vacation_message', 'category_display_mode']);

    // رسم الواجهة...
}
```

---

## ❌ المشكلة الحالية

### الأعراض
عند فتح صفحة **🔗 طلبات العملاء** ← تبويب **⚙️ إعدادات سلطانو**:
- تظهر رسالة: **"⚠️ غير متصل بقاعدة البيانات"**
- الصفحة مش بتحمّل الإعدادات

### السبب الجذري
في `js/modules/sultanoo-settings.js`، الكود كان بيدور على `window.sb`:
```javascript
const sbClient = window.sb;
if (!sbClient) { /* خطأ */ }
```

**بس في ERP:**
- ملف `js/supabase.js` بيعرّف `sb` كـ **global variable عادي**:
  ```javascript
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  ```
- يعني `sb` موجود مباشرة، **مش** كـ `window.sb`

### الحل
تم تعديل الكود ليستخدم `sb` مباشرة:
```javascript
if (typeof sb === 'undefined') { /* خطأ */ }

const { data } = await sb.from('app_settings')...
```

**✅ التعديل ده تم بالفعل في الملف**

---

## ✅ الحالة الحالية للكود

### في GitHub:
- ❓ **غير متأكد** — الملف `sultanoo-settings.js` **قد يكون** مرفوع بالنسخة القديمة (اللي فيها `window.sb`)
- آخر commit كان `b129205` قبل التصليح

### محلياً (على جهاز المستخدم):
- ✅ الملف **تم تصليحه** بالكامل
- كل استدعاءات `window.sb` → `sb` (4 أماكن)

---

## 🔍 خطوات الفحص للمبرمج

### 1️⃣ تأكد من حالة قاعدة البيانات
```sql
-- فحص وجود الصفوف
SELECT * FROM app_settings 
WHERE key IN ('vacation_mode', 'vacation_message', 'category_display_mode');

-- فحص الدالة
SELECT * FROM fn_sultano_get_settings();
```

**النتيجة المتوقعة:**
```
min_order_amount | whatsapp_number | store_name | vacation_mode | vacation_message | category_display_mode
-----------------+-----------------+------------+---------------+------------------+----------------------
0                |                 | سلطانو     | false         |                  | main
```

### 2️⃣ تأكد من ملف `sultanoo-settings.js`
افتح الملف وابحث عن السطر 11:
```javascript
// ❌ لو لقيت ده:
const sbClient = window.sb;

// ✅ المفروض يكون:
if (typeof sb === 'undefined') {
```

وابحث عن كل استدعاءات `sbClient` أو `window.sb` — المفروض **مفيش ولا واحد**، كلهم `sb` مباشرة.

### 3️⃣ اختبر الصفحة
1. افتح **برنامج ERP** في المتصفح
2. سجّل دخول
3. اضغط **🔗 طلبات العملاء**
4. اضغط تبويب **⚙️ إعدادات سلطانو**

**المفروض تشوف:**
- ✅ الإعدادات الثلاثة
- ✅ زر "💾 حفظ التعديلات"
- ✅ بدون أي رسالة خطأ

**لو لسه بيقول "غير متصل":**
- افتح **Console** في DevTools
- شوف لو فيه أي أخطاء JavaScript
- جرّب تكتب `typeof sb` في الكونسول — المفروض يرجع `"object"`، مش `"undefined"`

### 4️⃣ اختبر التكامل مع سلطانو
بعد ما تتأكد إن صفحة الإعدادات شغالة:

**اختبار وضع الإجازة:**
1. من ERP ← إعدادات سلطانو
2. فعّل "وضع الإجازة"
3. اكتب رسالة: "نحن في إجازة حتى 30 سبتمبر"
4. احفظ
5. افتح تطبيق **سلطانو** في تاب جديد
6. **المفروض:** شاشة إجازة تظهر فوراً (مش الرئيسية)

**اختبار شكل القائمة:**
1. ارجع ERP ← إعدادات سلطانو
2. ألغي وضع الإجازة
3. غيّر شكل القائمة من "main" إلى "sub"
4. احفظ
5. افتح سلطانو وحدّث الصفحة
6. **المفروض:** تشوف كل الأقسام الفرعية في الرئيسية مباشرة

---

## 📝 ملاحظات إضافية

### قيم `value` في `app_settings`
القيم محفوظة كـ **JSONB**، يعني:
- Boolean: `true` أو `false` (بدون علامات تنصيص)
- String: `"النص"` (بعلامات تنصيص)

**مثال:**
```sql
-- ✅ صح:
UPDATE app_settings SET value = 'true' WHERE key = 'vacation_mode';
UPDATE app_settings SET value = '"مرحباً"' WHERE key = 'vacation_message';

-- ❌ غلط:
UPDATE app_settings SET value = '"true"' WHERE key = 'vacation_mode';  -- هيبقى string مش boolean
UPDATE app_settings SET value = 'مرحباً' WHERE key = 'vacation_message';  -- JSON غير صالح
```

### الـ Service Worker
**مهم جداً:** تطبيق سلطانو فيه Service Worker (`sw.js`) — أي تعديل على الملفات الثابتة (HTML/CSS/JS) محتاج:
1. زيادة رقم الـ version في `sw.js`:
   ```javascript
   const VERSION = 'v1.2.3'; // غيّر الرقم
   ```
2. Push التعديلين مع بعض

لو مغيرتش الـ version، المستخدمين اللي نزّلوا التطبيق كـ PWA **مش هيشوفوا** أي تحديث.

---

## 🎯 الخلاصة للمبرمج

**المطلوب:**
1. ✅ تأكد إن قاعدة البيانات فيها الصفوف والدالة (تم)
2. ✅ تأكد إن `sultanoo-settings.js` بيستخدم `sb` مش `window.sb` (تم محلياً، محتاج push)
3. 🔄 ارفع الملف المعدّل على GitHub
4. 🧪 اختبر الصفحة في ERP
5. 🧪 اختبر التكامل الكامل مع سلطانو

**الملفات اللي محتاجة push:**
- `js/modules/sultanoo-settings.js` (التصليح الرئيسي)

**الملفات اللي already live:**
- كل ملفات سلطانو (index.html, css/components.css, js/app.js, js/api/api.js, إلخ)
- الملفات الباقية في ERP (customer-orders.js, index.html)

---

تاريخ التوثيق: 2026-09-22
