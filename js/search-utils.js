/* ════════════════════════════════════════════════════════════
   بحث مرن موحّد — search-utils.js
   بند 2+3، تقرير 2026-07-25. دالة واحدة مشتركة بدل ~15 نسخة متفرقة
   وغير متسقة كانت منتشرة في كل شاشات البحث (عملاء/موردين/أصناف/إلخ).

   بيحل مشكلتين حقيقيتين كانوا بيمنعوا نتايج صحيحة تظهر:
   1) البحث بكلمة واحدة بس، لازم بالترتيب — بحث "احمد على" ما كانش
      بيلاقي "أحمد على الزعيرى" لأنه بيدور على الجملة كلها كسطر واحد.
      هنا بنقسّم اللي اتكتب لكلمات، وأي سجل فيه كل الكلمات دي (مش لازم
      بالترتيب) بيتوافق.
   2) اختلافات الكتابة العربية الشائعة (همزات الألف أ/إ/آ، الياء/الألف
      المقصورة ي/ى، التاء المربوطة/الهاء ة/ه، تشكيل، مسافات زيادة) —
      بيانات مستوردة من نظام قديم + إدخال يدوي على مدار وقت طويل، فمفيش
      اتساق فى الكتابة. بنطبّعهم كلهم لشكل واحد قبل المقارنة.
   ════════════════════════════════════════════════════════════ */

function arNormalize(s) {
    return (s == null ? '' : String(s))
        .replace(/[ً-ْٰـ]/g, '') // تشكيل + تطويل (كشيدة)
        .replace(/[أإآا]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

// كل الكلمات المكتوبة (بأي ترتيب) لازم تكون موجودة جوه الحقول المحددة
// مجمّعة مع بعض، بعد التطبيع. fields = مصفوفة قيم (name, phone, code..)
function flexMatch(fields, query) {
    const q = arNormalize(query);
    if (!q) return true;
    const terms = q.split(' ').filter(Boolean);
    const hay = fields.map(arNormalize).join(' ');
    return terms.every(t => hay.includes(t));
}

// list.filter بالبحث المرن + limit اختياري (زي .slice(0,n) القديمة)
function flexSearch(list, query, fields, limit) {
    const q = (query || '').trim();
    const result = q ? list.filter(item => flexMatch(fields.map(f => item[f]), q)) : list;
    return typeof limit === 'number' ? result.slice(0, limit) : result;
}

Object.assign(window, { arNormalize, flexMatch, flexSearch });
