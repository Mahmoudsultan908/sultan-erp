-- ════════════════════════════════════════════════════════════
-- المحادثات الخاصة (Private Chat) — private_chat_migration.sql
--
-- محادثة 1:1 بين المدير (admin) وأي مستخدم تاني، محمية بكلمة سر
-- منفصلة تماماً عن كلمة سر الدخول لكل طرف (كل واحد بيحط كلمة السر
-- بتاعته بنفسه، وممكن يغيّرها لاحقاً من غير أي تدخل من الطرف التاني).
--
-- ★ كلمة السر بتتخزن كـ SHA-256(salt + ':' + password) — الـ hashing
--   بيتم فى المتصفح (Web Crypto SubtleCrypto)، النص الحقيقي مايتخزنش
--   ولا يتبعت للسيرفر أبداً.
--
-- ★ الحماية الحقيقية للخصوصية هنا هي RLS مش كلمة السر: كلمة السر
--   بترد بس على "هل الشخص اللي قاعد قدام الشاشة دلوقتي (حتى لو
--   مسجّل دخول بحساب حد تاني) يعرف السر ولا لأ" — لكن اللي بيمنع أي
--   مستخدم تاني (حتى مدير تاني) من قراءة صفوف الجدول من الأساس عن
--   طريق طلب مباشر لـ Supabase هي الـ policies تحت، لأن الـ anon key
--   فى التطبيق ده عام (راجع تعليق js/supabase.js) والحماية كلها على
--   الـ RLS. لازم الجدولين يفضلوا RLS enabled دايماً.
-- ════════════════════════════════════════════════════════════

create table if not exists private_chat_threads (
    id uuid primary key default gen_random_uuid(),
    manager_id uuid not null references profiles(id) on delete cascade,
    participant_id uuid not null references profiles(id) on delete cascade,
    title text,
    manager_password_hash text not null,
    manager_password_salt text not null,
    participant_password_hash text not null,
    participant_password_salt text not null,
    created_by uuid references profiles(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint private_chat_threads_distinct_participants check (manager_id <> participant_id)
);

create table if not exists private_chat_messages (
    id uuid primary key default gen_random_uuid(),
    thread_id uuid not null references private_chat_threads(id) on delete cascade,
    sender_id uuid not null references profiles(id),
    body text not null,
    is_pinned boolean not null default false,
    created_at timestamptz not null default now()
);

create index if not exists idx_private_chat_messages_thread on private_chat_messages(thread_id, created_at);
create index if not exists idx_private_chat_threads_manager on private_chat_threads(manager_id);
create index if not exists idx_private_chat_threads_participant on private_chat_threads(participant_id);

alter table private_chat_threads enable row level security;
alter table private_chat_messages enable row level security;

-- ---- private_chat_threads: بس الطرفين يقدروا يشوفوا/يلمسوا صف المحادثة ----
drop policy if exists pct_select on private_chat_threads;
create policy pct_select on private_chat_threads for select
    using (auth.uid() = manager_id or auth.uid() = participant_id);

-- إنشاء محادثة جديدة: لازم يكون أنت الأدمن (manager_id) ولازم دورك
-- فعلاً admin فى profiles — مش أي مستخدم يقدر ينشئ نفسه "مدير" محادثة
drop policy if exists pct_insert on private_chat_threads;
create policy pct_insert on private_chat_threads for insert
    with check (
        auth.uid() = manager_id
        and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
    );

-- تحديث (تغيير كلمة السر بتاعتك، أو manager بيغيّر العنوان): أي طرف
-- من الاتنين يقدر يعدّل الصف، والتطبيق نفسه (js) هو اللي بيتأكد إنه
-- بيبعت عمود كلمة سره هو بس مش عمود الطرف التاني
drop policy if exists pct_update on private_chat_threads;
create policy pct_update on private_chat_threads for update
    using (auth.uid() = manager_id or auth.uid() = participant_id)
    with check (auth.uid() = manager_id or auth.uid() = participant_id);

-- حذف المحادثة بالكامل: للمدير اللي أنشأها بس
drop policy if exists pct_delete on private_chat_threads;
create policy pct_delete on private_chat_threads for delete
    using (auth.uid() = manager_id);

-- ---- private_chat_messages: بس طرفين المحادثة الأصلية (parent thread) ----
drop policy if exists pcm_select on private_chat_messages;
create policy pcm_select on private_chat_messages for select
    using (exists (
        select 1 from private_chat_threads t
        where t.id = private_chat_messages.thread_id
        and (auth.uid() = t.manager_id or auth.uid() = t.participant_id)
    ));

drop policy if exists pcm_insert on private_chat_messages;
create policy pcm_insert on private_chat_messages for insert
    with check (
        sender_id = auth.uid()
        and exists (
            select 1 from private_chat_threads t
            where t.id = private_chat_messages.thread_id
            and (auth.uid() = t.manager_id or auth.uid() = t.participant_id)
        )
    );

-- تحديث (تثبيت/إلغاء تثبيت رسالة): أي طرف من الاتنين
drop policy if exists pcm_update on private_chat_messages;
create policy pcm_update on private_chat_messages for update
    using (exists (
        select 1 from private_chat_threads t
        where t.id = private_chat_messages.thread_id
        and (auth.uid() = t.manager_id or auth.uid() = t.participant_id)
    ))
    with check (exists (
        select 1 from private_chat_threads t
        where t.id = private_chat_messages.thread_id
        and (auth.uid() = t.manager_id or auth.uid() = t.participant_id)
    ));

drop policy if exists pcm_delete on private_chat_messages;
create policy pcm_delete on private_chat_messages for delete
    using (exists (
        select 1 from private_chat_threads t
        where t.id = private_chat_messages.thread_id
        and (auth.uid() = t.manager_id or auth.uid() = t.participant_id)
    ));
