-- إضافة لـ private_chat_migration.sql: دعم إرسال صور ورسائل صوتية
-- فى المحادثات الخاصة. الملفات بتتخزّن فى bucket "chat-media"
-- الموجود بالفعل (public bucket، upload يتطلب auth.uid()، القراءة
-- عامة — نفس النمط المستخدم بالضبط فى باقي الـ buckets فى التطبيق
-- ده زي product-images/avatars). ملحوظة: بعكس نص الرسالة (محمي بـ
-- RLS على جدول private_chat_messages)، ملف الصورة/الصوت نفسه بيبقى
-- قابل للقراءة لأي حد معاه الرابط المباشر — زي كل الملفات التانية
-- المرفوعة فى التطبيق ده، مفيش تخزين خاص (signed URLs) حالياً.

alter table private_chat_messages alter column body drop not null;
alter table private_chat_messages add column if not exists attachment_url text;
alter table private_chat_messages add column if not exists attachment_type text; -- 'image' | 'audio'
alter table private_chat_messages add constraint private_chat_messages_has_content
    check (coalesce(body, '') <> '' or attachment_url is not null);
