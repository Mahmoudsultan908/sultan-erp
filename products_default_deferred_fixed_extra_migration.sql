-- ════════════════════════════════════════════════════════════
-- products_default_deferred_fixed_extra_migration.sql
-- إضافة بحتة: عمود جديد بس على products.
--
-- ليه: default_deferred_rate/default_deferred_type الموجودين بيدعموا نوع
-- واحد بس (نسبة% أو مبلغ ثابت)، مش الاتنين مع بعض. اتفاقات موردين زي
-- تايجر فيها الاتنين مع بعض دايمًا (مثلاً: 1 جنيه ثابت لكل كرتونة + 2%
-- من سعر الكرتونة). العمود ده بيمثل الجزء الثابت الدائم، بيتجمع فوق
-- default_deferred_rate/type الموجودين (اللي بقوا بيمثلوا الجزء
-- المتغيّر — نسبة% غالبًا، بتفضل صح مهما اتغيّر سعر الشراء لاحقًا).
-- ════════════════════════════════════════════════════════════

alter table public.products
    add column if not exists default_deferred_fixed_extra numeric(10,2) not null default 0;
