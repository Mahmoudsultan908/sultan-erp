-- attendance_records.employee_id كان مربوط غلط بجدول profiles (حسابات
-- تسجيل الدخول) بدل جدول employees (الموظفين) اللي الشاشة فعليًا بتجيب
-- منه الأسماء وتبعت الـID بتاعها — فكان أي تسجيل حضور بيفشل دايمًا
-- بغض النظر عن أي حاجة. الجدول فاضي (0 صف) لأن الإدخال كان بيرفض من
-- الأساس، فالتصحيح مباشر بدون أي بيانات تتأثر.

ALTER TABLE public.attendance_records
    DROP CONSTRAINT attendance_records_employee_id_fkey;

ALTER TABLE public.attendance_records
    ADD CONSTRAINT attendance_records_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES public.employees(id);
