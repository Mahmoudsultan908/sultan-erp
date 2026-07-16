-- ════════════════════════════════════════════════════════════
-- موديول الأرشيف — جدول المستندات + صلاحيات Storage لباكت
-- "archive-documents" (اتعمل يدوياً في لوحة Supabase، Public).
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.archive_documents (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title        text NOT NULL,
    file_path    text NOT NULL,   -- المسار داخل الباكت (لحذف الملف لاحقاً)
    file_url     text NOT NULL,   -- الرابط العام للعرض/التحميل
    file_type    text,            -- امتداد أو نوع الملف (pdf, jpg, ...)
    category     text,            -- تصنيف حر (فاتورة، عقد، هوية، ...)
    linked_type  text NOT NULL DEFAULT 'general' CHECK (linked_type IN ('general','customer','supplier')),
    linked_id    uuid,            -- بدون FK لأنه ممكن يشاور على customers أو suppliers حسب linked_type
    notes        text,
    uploaded_by  uuid,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_archive_documents_linked ON public.archive_documents(linked_type, linked_id);

ALTER TABLE public.archive_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_archive_documents" ON public.archive_documents;
CREATE POLICY "auth_all_archive_documents" ON public.archive_documents FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── صلاحيات رفع/قراءة/حذف الملفات لباكت archive-documents ──
-- ملحوظة: الباكت "Public" بيسمح بعرض الملف مباشرة عن طريق الرابط العام
-- من غير الحاجة لسياسات دي، لكن الرفع (upload) والحذف والـ list لسه
-- محتاجين RLS على storage.objects حتى لو الباكت نفسه Public.
DROP POLICY IF EXISTS "auth_upload_archive_documents" ON storage.objects;
CREATE POLICY "auth_upload_archive_documents" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'archive-documents');

DROP POLICY IF EXISTS "auth_select_archive_documents" ON storage.objects;
CREATE POLICY "auth_select_archive_documents" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'archive-documents');

DROP POLICY IF EXISTS "auth_delete_archive_documents" ON storage.objects;
CREATE POLICY "auth_delete_archive_documents" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'archive-documents');
