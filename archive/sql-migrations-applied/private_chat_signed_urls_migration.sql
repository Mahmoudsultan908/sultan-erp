-- تحويل مرفقات المحادثة الخاصة (صور/صوتيات) من bucket عام لـ bucket
-- خاص بروابط موقّعة (signed URLs) — نفس مستوى حماية نص الرسالة بالظبط
-- (بس طرفي المحادثة، مش حتى مدير تاني).

-- 1) عمود المسار الخام بدل الرابط العام الكامل
alter table private_chat_messages add column if not exists attachment_path text;
update private_chat_messages
set attachment_path = regexp_replace(attachment_url, '^.*/chat-media/', '')
where attachment_url is not null and attachment_path is null;
alter table private_chat_messages drop column if exists attachment_url;

-- 2) الـ bucket نفسه بقى خاص (مش public) — الرابط العام مش هيشتغل خالص
update storage.buckets set public = false where id = 'chat-media';

-- 3) شيل الـ policies القديمة الواسعة (bucket كامل، قراءة عامة)
drop policy if exists authenticated_upload_chat on storage.objects;
drop policy if exists public_read_chat on storage.objects;

-- 4) policies جديدة مقيّدة بالمحادثة: بس طرفي المحادثة اللي رقمها هو
--    أول جزء من المسار (thread_id/filename) يقدروا يقرأوا/يرفعوا —
--    ده اللي بيتأكد منه createSignedUrl() نفسها قبل ما تنشئ أي رابط
create policy pch_chat_media_select on storage.objects for select
    using (
        bucket_id = 'chat-media'
        and exists (
            select 1 from private_chat_threads t
            where t.id::text = (storage.foldername(name))[1]
            and (auth.uid() = t.manager_id or auth.uid() = t.participant_id)
        )
    );

create policy pch_chat_media_insert on storage.objects for insert
    with check (
        bucket_id = 'chat-media'
        and exists (
            select 1 from private_chat_threads t
            where t.id::text = (storage.foldername(name))[1]
            and (auth.uid() = t.manager_id or auth.uid() = t.participant_id)
        )
    );
