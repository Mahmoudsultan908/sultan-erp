-- ════════════════════════════════════════════════════════════
-- إضافة تاريخ استحقاق لفواتير الشراء الآجلة — purchases_due_date_migration.sql
-- نفس فكرة sales_due_date_migration.sql بالظبط، مرآة على المشتريات.
-- ════════════════════════════════════════════════════════════

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS due_date date;
