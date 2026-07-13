/* ════════════════════════════════════════════════════════════
   محرك طباعة كاشير (حراري 80mm) — thermal-print.js
   يخدم: فاتورة المبيعات، وصل استلام نقدي، وصل دفع نقدي، مرتجعات
   يصدّر: printThermalReceipt(type, data)
   type: 'sale' | 'collection' | 'payment' | 'return'
   بيانات الشركة (الاسم/الهاتف/العنوان) تُقرأ من app_settings
   (قابلة للتعديل من صفحة الإعدادات الموجودة أصلاً)
   ════════════════════════════════════════════════════════════ */

// ★ en-US مش ar-EG عمداً: ar-EG بيرجّع أرقام هندية شرقية (٢٬٥٠٤٫٠٠) في أغلب
//   المتصفحات، مش الأرقام الغربية (2,504.00) المطلوبة فعلياً في التصميم —
//   نفس الاتفاقية المستخدمة في كل الموديولات التانية (invFmt/custFmt/...).
function tpFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
// تاريخ/وقت بأرقام غربية يدوياً بدل toLocaleString — عشان نضمن نفس الصيغة
// (HH:MM DD/MM/YYYY) بالظبط زي التصميم المرجعي، من غير ما نعتمد على سلوك
// اللغة الافتراضي في متصفح المستخدم.
function tpDateStr(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()}`;
}

async function tpGetCompanyInfo() {
    const { data } = await sb.from('app_settings').select('key,value').in('key', ['company_name','company_phone','company_address']);
    const map = {};
    (data||[]).forEach(r => { try { map[r.key] = JSON.parse(r.value); } catch { map[r.key] = r.value; } });
    return {
        name: map.company_name || 'Sultan Food Products',
        phone: map.company_phone || '',
        address: map.company_address || '',
    };
}

// ════════════════════════════════════════════════════════════
// نقطة الدخول الرئيسية
// ════════════════════════════════════════════════════════════
async function printThermalReceipt(type, data) {
    const company = await tpGetCompanyInfo();
    let html;
    if (type === 'sale') html = tpBuildSaleHTML(company, data);
    else if (type === 'collection') html = tpBuildVoucherHTML(company, data, 'collection');
    else if (type === 'payment') html = tpBuildVoucherHTML(company, data, 'payment');
    else if (type === 'return') html = tpBuildReturnHTML(company, data);
    else return;

    const win = window.open('', '_blank', 'width=380,height=600');
    if (!win) { alert('⚠️ المتصفح منع فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة لهذا الموقع'); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 300);
}

// ════════════════════════════════════════════════════════════
// القالب المشترك (رأس + تذييل + CSS) — 80mm
// customHeaderHTML اختياري: لو اتبعت، بيستبدل رأس الشركة الافتراضي
// بالكامل (تستخدمه فاتورة المبيعات لشعارها المميز) — من غير ما يأثر
// على شكل وصل القبض/الصرف والمرتجعات اللي بتفضل مستخدمة الرأس الافتراضي.
// ════════════════════════════════════════════════════════════
function tpWrapper(company, title, bodyHTML, customHeaderHTML) {
    const now = tpDateStr(new Date());
    const defaultHeader = `
    <div class="tp-center">
        <div class="tp-company-name">${company.name}</div>
        ${company.phone ? `<div class="tp-company-info">📞 ${company.phone}</div>` : ''}
        ${company.address ? `<div class="tp-company-info">${company.address}</div>` : ''}
    </div>`;
    return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Cairo', 'Tahoma', sans-serif; width: 80mm; padding: 8px 10px; color: #000; font-size: 12px; }
  .tp-center { text-align: center; }
  .tp-company-name { font-size: 16px; font-weight: 800; margin-bottom: 2px; }
  .tp-company-info { font-size: 10.5px; color: #333; }
  .tp-divider { border-top: 1px dashed #000; margin: 8px 0; }
  .tp-title { font-size: 13px; font-weight: 800; text-align: center; margin: 4px 0; }
  .tp-row { display: flex; justify-content: space-between; font-size: 11.5px; padding: 2px 0; }
  .tp-row .lbl { color: #333; }
  .tp-row .val { font-weight: 700; }
  table.tp-items { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 11px; }
  table.tp-items th { border-bottom: 1px solid #000; padding: 3px 2px; text-align: right; font-size: 10.5px; }
  table.tp-items td { padding: 3px 2px; border-bottom: 1px dotted #ccc; }
  .tp-totals { margin-top: 6px; }
  .tp-totals .tp-row { font-size: 12px; }
  .tp-grand { font-size: 15px; font-weight: 800; border-top: 1px solid #000; border-bottom: 3px double #000; padding: 6px 0; margin: 6px 0; }
  .tp-footer { text-align: center; font-size: 10px; color: #555; margin-top: 12px; }
  @media print { body { width: 80mm; } }

  /* ── رأس + جدول إجماليات فاتورة المبيعات (تصميم الشعار المخصص) ── */
  .tps-header { text-align: center; padding-bottom: 4px; }
  .tps-crown { font-size: 22px; margin-bottom: 2px; }
  .tps-brand { font-size: 19px; font-weight: 800; color: #8B5E34; letter-spacing: 0.5px; }
  .tps-tagline { font-size: 10px; color: #555; margin-top: 1px; }
  .tps-contact { text-align: center; font-size: 10.5px; color: #333; margin-top: 4px; direction: ltr; }
  .tps-contact .lbl { font-weight: 700; direction: rtl; display: inline-block; margin-left: 6px; }
  .tps-meta-row { display: flex; justify-content: space-between; font-size: 11px; padding: 3px 0; font-weight: 700; }
  .tps-cust { font-size: 11.5px; padding: 2px 0; }
  .tps-cust .lbl { color: #555; display: inline-block; min-width: 44px; font-weight: 700; }
  table.tps-items { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 10.5px; }
  table.tps-items th { border-bottom: 1.5px solid #000; padding: 4px 2px; text-align: center; font-size: 9.5px; font-weight: 700; }
  table.tps-items th small { display: block; font-size: 8px; color: #666; font-weight: 400; }
  table.tps-items td { padding: 4px 2px; border-bottom: 1px dotted #ccc; text-align: center; }
  table.tps-items td.name { text-align: right; }
  table.tps-totals { width: 100%; border-collapse: collapse; margin-top: 8px; border: 1.5px solid #000; }
  table.tps-totals td { border: 1px solid #000; text-align: center; padding: 6px 4px; width: 50%; }
  table.tps-totals .lbl { font-size: 10px; color: #555; display: block; margin-bottom: 2px; }
  table.tps-totals .val { font-size: 12.5px; font-weight: 800; }
</style>
</head>
<body>
  ${customHeaderHTML || defaultHeader}
  <div class="tp-divider"></div>
  ${bodyHTML}
  <div class="tp-footer">${now}<br>شكراً لتعاملكم معنا 🌟</div>
  <script>window.onload=function(){}<\/script>
</body>
</html>`;
}

// ════════════════════════════════════════════════════════════
// فاتورة مبيعات — تصميم مخصص (شعار + رقم/تاريخ + بيانات عميل +
// جدول أصناف مرقّم ثنائي اللغة + صندوق إجماليات 3×2)
// data = { invoiceNo, customerName, customerPhone, paymentType,
//          items:[{name,qty,unit_price,line_total}],
//          subtotal, discount, total, previousBalance, paidAmount }
// ════════════════════════════════════════════════════════════
function tpBuildSaleHeaderHTML(company) {
    return `
    <div class="tp-title">مبيعات</div>
    <div class="tps-header">
        <div class="tps-crown">👑</div>
        <div class="tps-brand">${company.name}</div>
        ${company.address ? `<div class="tps-tagline">${company.address}</div>` : ''}
    </div>
    ${company.phone ? `<div class="tps-contact"><span class="lbl">للتواصل</span>${company.phone}</div>` : ''}`;
}

function tpBuildSaleHTML(company, data) {
    // ★ مطابق للتصميم المرجعي (شكل فاتورة المبيعات.png) بالحساب العكسي من
    //   أرقام حقيقية فيه: الفاتورة 2,504.00 + الرصيد الساري 1,038.50 =
    //   الاجمالى 3,542.50 بالظبط — يعني "الرصيد الساري" هو رصيد العميل
    //   *قبل* الفاتورة دي (مش بعدها)، و"الاجمالى" هو إجمالي المستحق كله
    //   (الفاتورة + الرصيد السابق)، و"الباقي" = الاجمالى - المدفوع.
    const previousBalance = data.previousBalance || 0;
    const grandTotal = previousBalance + (data.total || 0);
    const paid = data.paidAmount != null ? data.paidAmount : (data.paymentType === 'cash' ? data.total : 0);
    const remaining = Math.max(0, grandTotal - paid);
    const now = tpDateStr(new Date());

    const body = `
    <div class="tps-meta-row"><span>الرقم : ${data.invoiceNo}</span><span>التاريخ : ${now}</span></div>
    <div class="tps-cust"><span class="lbl">الاسم</span>${data.customerName || 'نقدي'}</div>
    ${data.customerPhone ? `<div class="tps-cust"><span class="lbl">التلفون</span><span dir="ltr">${data.customerPhone}</span></div>` : ''}
    <div class="tp-divider"></div>
    <table class="tps-items">
        <thead><tr>
            <th>م<small>IN</small></th>
            <th style="text-align:right">الصنف<small>Item Name</small></th>
            <th>الكمية<small>QTY</small></th>
            <th>السعر<small>Price</small></th>
            <th>الاجمالى<small>Total</small></th>
        </tr></thead>
        <tbody>
            ${(data.items||[]).map((it,i)=>`<tr>
                <td>${i+1}</td><td class="name">${it.name}</td><td>${it.qty}</td><td>${tpFmt(it.unit_price)}</td><td>${tpFmt(it.line_total)}</td>
            </tr>`).join('')}
        </tbody>
    </table>
    <table class="tps-totals">
        <tr>
            <td><span class="lbl">الفاتورة</span><span class="val">${tpFmt(data.total)} ج.م</span></td>
            <td><span class="lbl">الرصيد الساري</span><span class="val">${tpFmt(previousBalance)} ج.م</span></td>
        </tr>
        <tr>
            <td><span class="lbl">الاجمالى</span><span class="val">${tpFmt(grandTotal)} ج.م</span></td>
            <td><span class="lbl">المدفوع</span><span class="val">${tpFmt(paid)} ج.م</span></td>
        </tr>
        <tr>
            <td><span class="lbl">الباقي</span><span class="val">${tpFmt(remaining)} ج.م</span></td>
            <td><span class="lbl">الخصم</span><span class="val">${tpFmt(data.discount)} ج.م</span></td>
        </tr>
    </table>
    <div class="tp-center" style="font-size:10px;color:#777;margin-top:8px">‹‹‹‹‹‹ لطباعة الفاتورة ››››››</div>`;
    return tpWrapper(company, 'فاتورة مبيعات ' + data.invoiceNo, body, tpBuildSaleHeaderHTML(company));
}

// ════════════════════════════════════════════════════════════
// وصل استلام/دفع نقدي
// data = { ref, entityName, amount, entityBalanceBefore, entityBalanceAfter }
// ════════════════════════════════════════════════════════════
function tpBuildVoucherHTML(company, data, kind) {
    const isCollection = kind === 'collection';
    const title = isCollection ? 'سند قبض (استلام نقدية)' : 'سند صرف (دفع نقدية)';
    const entityLabel = isCollection ? 'العميل' : 'المورد';

    const body = `
    <div class="tp-title">${title}</div>
    <div class="tp-row"><span class="lbl">رقم السند</span><span class="val">${data.ref}</span></div>
    <div class="tp-row"><span class="lbl">${entityLabel}</span><span class="val">${data.entityName}</span></div>
    <div class="tp-divider"></div>
    <div class="tp-grand tp-row"><span>المبلغ</span><span>${tpFmt(data.amount)}</span></div>
    <div class="tp-divider"></div>
    ${data.entityBalanceBefore!=null ? `<div class="tp-row"><span class="lbl">الرصيد قبل السند</span><span class="val">${tpFmt(data.entityBalanceBefore)}</span></div>` : ''}
    ${data.entityBalanceAfter!=null ? `<div class="tp-row"><span class="lbl">الرصيد بعد السند</span><span class="val">${tpFmt(data.entityBalanceAfter)}</span></div>` : ''}`;
    return tpWrapper(company, title + ' ' + data.ref, body);
}

// ════════════════════════════════════════════════════════════
// مرتجع مبيعات / مشتريات
// data = { returnNo, returnType:'sales'|'purchase', entityName, linkedInvoiceNo,
//          items:[{name,qty,unit_price,line_total}], total }
// ════════════════════════════════════════════════════════════
function tpBuildReturnHTML(company, data) {
    const title = data.returnType === 'sales' ? 'مرتجع مبيعات' : 'مرتجع مشتريات';
    const entityLabel = data.returnType === 'sales' ? 'العميل' : 'المورد';

    const body = `
    <div class="tp-title">${title}</div>
    <div class="tp-row"><span class="lbl">رقم المرتجع</span><span class="val">${data.returnNo}</span></div>
    <div class="tp-row"><span class="lbl">${entityLabel}</span><span class="val">${data.entityName || 'نقدي'}</span></div>
    ${data.linkedInvoiceNo ? `<div class="tp-row"><span class="lbl">مرتبط بفاتورة</span><span class="val">${data.linkedInvoiceNo}</span></div>` : ''}
    <div class="tp-divider"></div>
    <table class="tp-items">
        <thead><tr><th>الصنف</th><th>كمية</th><th>سعر</th><th>إجمالي</th></tr></thead>
        <tbody>
            ${(data.items||[]).map(it=>`<tr>
                <td>${it.name}</td><td>${it.qty}</td><td>${tpFmt(it.unit_price)}</td><td>${tpFmt(it.line_total)}</td>
            </tr>`).join('')}
        </tbody>
    </table>
    <div class="tp-divider"></div>
    <div class="tp-grand tp-row"><span>إجمالي المرتجع</span><span>${tpFmt(data.total)}</span></div>`;
    return tpWrapper(company, title + ' ' + data.returnNo, body);
}

Object.assign(window, { printThermalReceipt });
