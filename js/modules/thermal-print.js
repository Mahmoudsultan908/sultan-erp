/* ════════════════════════════════════════════════════════════
   محرك طباعة كاشير (حراري 80mm) — thermal-print.js
   يخدم: فاتورة المبيعات، وصل استلام نقدي، وصل دفع نقدي
   يصدّر: printThermalReceipt(type, data)
   type: 'sale' | 'collection' | 'payment'
   بيانات الشركة (الاسم/الهاتف/العنوان) تُقرأ من app_settings
   (قابلة للتعديل من صفحة الإعدادات الموجودة أصلاً)
   ════════════════════════════════════════════════════════════ */

function tpFmt(n) { return (Number(n)||0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

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
// ════════════════════════════════════════════════════════════
function tpWrapper(company, title, bodyHTML) {
    const now = new Date().toLocaleString('ar-EG', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
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
</style>
</head>
<body>
  <div class="tp-center">
    <div class="tp-company-name">${company.name}</div>
    ${company.phone ? `<div class="tp-company-info">📞 ${company.phone}</div>` : ''}
    ${company.address ? `<div class="tp-company-info">${company.address}</div>` : ''}
  </div>
  <div class="tp-divider"></div>
  ${bodyHTML}
  <div class="tp-footer">${now}<br>شكراً لتعاملكم معنا 🌟</div>
  <script>window.onload=function(){}<\/script>
</body>
</html>`;
}

// ════════════════════════════════════════════════════════════
// فاتورة مبيعات
// data = { invoiceNo, customerName, paymentType, items:[{name,qty,unit_price,line_total}],
//          subtotal, discount, total, previousBalance, paidAmount }
// ════════════════════════════════════════════════════════════
function tpBuildSaleHTML(company, data) {
    const newBalance = (data.previousBalance||0) + (data.paymentType==='credit' ? data.total : 0);
    const remaining = (data.paidAmount!=null) ? Math.max(0, data.total - data.paidAmount) : 0;

    const body = `
    <div class="tp-title">فاتورة مبيعات</div>
    <div class="tp-row"><span class="lbl">رقم الفاتورة</span><span class="val">${data.invoiceNo}</span></div>
    <div class="tp-row"><span class="lbl">العميل</span><span class="val">${data.customerName || 'نقدي'}</span></div>
    <div class="tp-row"><span class="lbl">نوع الدفع</span><span class="val">${data.paymentType==='cash'?'نقدي':'آجل'}</span></div>
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
    <div class="tp-totals">
        <div class="tp-row"><span class="lbl">إجمالي الأصناف</span><span class="val">${tpFmt(data.subtotal)}</span></div>
        ${data.discount>0?`<div class="tp-row"><span class="lbl">الخصم</span><span class="val">-${tpFmt(data.discount)}</span></div>`:''}
        ${data.previousBalance ? `<div class="tp-row"><span class="lbl">الرصيد السابق</span><span class="val">${tpFmt(data.previousBalance)}</span></div>` : ''}
        <div class="tp-grand tp-row"><span>الإجمالي</span><span>${tpFmt(data.total)}</span></div>
        ${data.paidAmount!=null ? `
        <div class="tp-row"><span class="lbl">المدفوع</span><span class="val">${tpFmt(data.paidAmount)}</span></div>
        <div class="tp-row"><span class="lbl">الباقي</span><span class="val">${tpFmt(remaining)}</span></div>` : ''}
        ${data.paymentType==='credit' ? `<div class="tp-row"><span class="lbl">إجمالي رصيد العميل الآن</span><span class="val">${tpFmt(newBalance)}</span></div>` : ''}
    </div>`;
    return tpWrapper(company, 'فاتورة مبيعات ' + data.invoiceNo, body);
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

Object.assign(window, { printThermalReceipt });
