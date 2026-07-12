-- ════════════════════════════════════════════════════════════
-- returns_migration.sql
-- شغّل هذا الملف مرة واحدة في Supabase SQL Editor
-- آمن للتشغيل أكثر من مرة (كل أمر بيتحقق قبل ما يعمل حاجة)
-- ════════════════════════════════════════════════════════════

-- ── 1) جدول مرتجعات المبيعات (لو مش موجود) ──
CREATE TABLE IF NOT EXISTS sales_returns (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    return_no     text NOT NULL,
    customer_id   uuid REFERENCES customers(id),
    sale_id       uuid REFERENCES sales(id),          -- NULL لو مرتجع مستقل
    warehouse_id  uuid REFERENCES warehouses(id),
    payment_type  text DEFAULT 'cash',
    subtotal      numeric DEFAULT 0,
    total         numeric NOT NULL DEFAULT 0,
    status        text DEFAULT 'confirmed',
    reason        text,
    created_by    uuid,
    created_at    timestamptz DEFAULT now()
);
-- أعمدة قد تكون ناقصة لو الجدول كان موجوداً بالفعل بشكل جزئي
ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS sale_id uuid REFERENCES sales(id);
ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id);
ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS subtotal numeric DEFAULT 0;
ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS created_by uuid;

CREATE TABLE IF NOT EXISTS sale_return_items (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id     uuid NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
    product_id    uuid NOT NULL REFERENCES products(id),
    qty           numeric NOT NULL DEFAULT 0,
    unit_price    numeric NOT NULL DEFAULT 0,
    discount_pct  numeric DEFAULT 0,
    line_total    numeric DEFAULT 0,
    unit_name     text
);

-- ── 2) جدول مرتجعات المشتريات (لو مش موجود) ──
CREATE TABLE IF NOT EXISTS purchase_returns (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    return_no     text NOT NULL,
    supplier_id   uuid REFERENCES suppliers(id),
    purchase_id   uuid REFERENCES purchases(id),       -- NULL لو مرتجع مستقل
    warehouse_id  uuid REFERENCES warehouses(id),
    subtotal      numeric DEFAULT 0,
    total         numeric NOT NULL DEFAULT 0,
    status        text DEFAULT 'confirmed',
    reason        text,
    created_by    uuid,
    created_at    timestamptz DEFAULT now()
);
ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS purchase_id uuid REFERENCES purchases(id);
ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id);
ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS subtotal numeric DEFAULT 0;
ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS created_by uuid;

CREATE TABLE IF NOT EXISTS purchase_return_items (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id     uuid NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
    product_id    uuid NOT NULL REFERENCES products(id),
    qty           numeric NOT NULL DEFAULT 0,
    unit_price    numeric NOT NULL DEFAULT 0,
    line_total    numeric DEFAULT 0,
    unit_name     text
);

-- ── 3) تفعيل RLS + سياسة بسيطة (المستخدمون المسجّلون فقط) ──
ALTER TABLE sales_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_return_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_sales_returns" ON sales_returns;
CREATE POLICY "auth_all_sales_returns" ON sales_returns FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_all_sale_return_items" ON sale_return_items;
CREATE POLICY "auth_all_sale_return_items" ON sale_return_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_all_purchase_returns" ON purchase_returns;
CREATE POLICY "auth_all_purchase_returns" ON purchase_returns FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_all_purchase_return_items" ON purchase_return_items;
CREATE POLICY "auth_all_purchase_return_items" ON purchase_return_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ════════════════════════════════════════════════════════════
-- 4) Triggers: تحديث المخزون تلقائياً عند إضافة بند مرتجع
--    مرتجع بيع  → يرجّع الكمية للمخزن (زيادة)
--    مرتجع شراء → يخصم الكمية من المخزن (نقصان، لأنها راجعة للمورد)
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fn_sale_return_item_stock() RETURNS trigger
SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wh uuid;
BEGIN
    SELECT warehouse_id INTO v_wh FROM sales_returns WHERE id = NEW.return_id;
    IF v_wh IS NOT NULL THEN
        INSERT INTO inventory_stock (warehouse_id, product_id, qty)
        VALUES (v_wh, NEW.product_id, NEW.qty)
        ON CONFLICT (warehouse_id, product_id)
        DO UPDATE SET qty = inventory_stock.qty + NEW.qty;
    END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sale_return_item_stock ON sale_return_items;
CREATE TRIGGER trg_sale_return_item_stock
    AFTER INSERT ON sale_return_items
    FOR EACH ROW EXECUTE FUNCTION fn_sale_return_item_stock();

CREATE OR REPLACE FUNCTION fn_purchase_return_item_stock() RETURNS trigger
SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wh uuid;
BEGIN
    SELECT warehouse_id INTO v_wh FROM purchase_returns WHERE id = NEW.return_id;
    IF v_wh IS NOT NULL THEN
        UPDATE inventory_stock SET qty = qty - NEW.qty
        WHERE warehouse_id = v_wh AND product_id = NEW.product_id;
    END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_purchase_return_item_stock ON purchase_return_items;
CREATE TRIGGER trg_purchase_return_item_stock
    AFTER INSERT ON purchase_return_items
    FOR EACH ROW EXECUTE FUNCTION fn_purchase_return_item_stock();

-- ── 5) Triggers: تحديث رصيد العميل/المورد عند تأكيد المرتجع ──
--    مرتجع بيع آجل  → رصيد العميل ينقص (مديونيته أقل)
--    مرتجع شراء     → رصيد المورد ينقص (مديونيتنا له أقل)
CREATE OR REPLACE FUNCTION fn_sales_return_balance() RETURNS trigger
SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.status = 'confirmed' AND NEW.customer_id IS NOT NULL AND NEW.payment_type = 'credit' THEN
        UPDATE customers SET balance = balance - NEW.total WHERE id = NEW.customer_id;
    END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sales_return_balance ON sales_returns;
CREATE TRIGGER trg_sales_return_balance
    AFTER INSERT ON sales_returns
    FOR EACH ROW EXECUTE FUNCTION fn_sales_return_balance();

CREATE OR REPLACE FUNCTION fn_purchase_return_balance() RETURNS trigger
SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.status = 'confirmed' AND NEW.supplier_id IS NOT NULL THEN
        UPDATE suppliers SET balance = balance - NEW.total WHERE id = NEW.supplier_id;
    END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_purchase_return_balance ON purchase_returns;
CREATE TRIGGER trg_purchase_return_balance
    AFTER INSERT ON purchase_returns
    FOR EACH ROW EXECUTE FUNCTION fn_purchase_return_balance();

-- ملاحظة: SECURITY DEFINER بيخلي المشغلات تشتغل بصلاحية مالك الدالة
-- (عادة postgres في Supabase) بدل صلاحية المستخدم المسجّل دخوله،
-- وده اللي بيحل خطأ "new row violates row-level security policy"
-- اللي بيظهر لأن جدول inventory_stock عنده RLS مفعّل بدون سياسة INSERT/UPDATE للمستخدم العادي.
-- الملف بالكامل آمن لإعادة التشغيل (idempotent) — لو شغّلته قبل كده، شغّله تاني زي ما هو
-- وهيحدّث الدوال بالنسخة الجديدة دي تلقائياً (CREATE OR REPLACE).

-- ملاحظة: لو عندك جدول journal_entries وقيود تلقائية على sales/purchases،
-- يفضل تضيف نفس منطق القيد هنا (عكس قيد البيع/الشراء الأصلي).
-- الملف ده بيغطي المخزون والأرصدة فقط، وهو أهم جزء عشان الشاشة تشتغل صح.
