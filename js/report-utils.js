/* ════════════════════════════════════════════════════════════
   تصدير/طباعة التقارير — report-utils.js (بند 12)
   دوال مشتركة يستخدمها أي تقرير: تصدير Excel (بيستخدم مكتبة XLSX
   المحمّلة أصلاً لاستيراد/تصدير البيانات العامة) وطباعة A4 (بتعيد
   استخدام pcOpenPrint من print-center.js، بس بغلاف مختلف بيحمّل
   نفس كلاسات الـCSS المستخدمة فعليًا فى الصفحة — dash- و mod- —
   عشان أي HTML من أي تقرير يتطبع بنفس الشكل من غير ما يتكرر تعريفه).
   ════════════════════════════════════════════════════════════ */

async function repGetCompanyInfo() {
    try {
        const { data } = await sb.from('app_settings').select('key,value').in('key', ['company_name', 'company_phone', 'company_address']);
        const map = {};
        (data || []).forEach(r => { try { map[r.key] = JSON.parse(r.value); } catch { map[r.key] = r.value; } });
        return { name: map.company_name || 'Sultan Food Products', phone: map.company_phone || '', address: map.company_address || '' };
    } catch {
        return { name: 'Sultan Food Products', phone: '', address: '' };
    }
}

// rows: مصفوفة كائنات مسطّحة (كل عنصر = صف، المفاتيح = عناوين الأعمدة)
function repExportExcel(filename, rows) {
    if (!rows || !rows.length) { alert('⚠️ لا توجد بيانات للتصدير فى الفترة/الفلتر الحالي'); return; }
    try {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, filename.slice(0, 31));
        XLSX.writeFile(wb, `${filename}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
        alert('❌ خطأ أثناء التصدير: ' + err.message);
    }
}

// bodyHTML: أي مقطع HTML جاهز (عادةً innerHTML بتاع كارت/جدول التقرير
// نفسه — بيستخدم نفس كلاسات dash-*/mod-* الموجودة فى الصفحة)
async function repPrintReport(title, bodyHTML) {
    const company = await repGetCompanyInfo();
    const appStyles = document.querySelector('style')?.innerHTML || '';
    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<link rel="stylesheet" href="css/claude-modules.css">
<style>
${appStyles}
body { padding: 24px; font-family: 'Cairo', Tahoma, sans-serif; background: #fff; }
@media print { .no-print { display: none; } }
</style>
</head>
<body>
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;border-bottom:2px solid #0F172A;padding-bottom:12px">
    <div><h2 style="margin:0">${company.name}</h2>${company.phone ? `<div style="font-size:12px;color:#64748B">📞 ${company.phone}</div>` : ''}</div>
    <div style="text-align:left;font-size:12px;color:#64748B">${new Date().toLocaleString('ar-EG')}</div>
</div>
<h3 style="margin:0 0 16px">${title}</h3>
${bodyHTML}
</body>
</html>`;
    pcOpenPrint(html);
}

// رسم بياني بسيط بالأعمدة — بيدعم قيم سالبة (خسارة) وموجبة (ربح) حوالين
// خط صفر فى النص، عشان نتجنب مكتبة رسم خارجية لمخطط بسيط زي ده.
// data: [{ label, value }]
function repMiniBarSVG(data) {
    if (!data || !data.length) return '<p style="color:#94A3B8;font-size:12px;padding:10px 0">لا توجد بيانات كافية لعرض الرسم البياني</p>';
    const W = 700, H = 160, padL = 8, padR = 8, padT = 12, padB = 22;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const n = data.length;
    const values = data.map(d => Number(d.value) || 0);
    const maxAbs = Math.max(...values.map(v => Math.abs(v)), 1) * 1.15;
    const hasNeg = values.some(v => v < 0);
    const baseline = hasNeg ? padT + plotH / 2 : padT + plotH;
    const halfH = hasNeg ? plotH / 2 : plotH;
    const stepX = plotW / n;
    const barW = Math.max(6, stepX * 0.5);

    const bars = data.map((d, i) => {
        const v = Number(d.value) || 0;
        const x = padL + i * stepX + stepX / 2 - barW / 2;
        const h = Math.max((Math.abs(v) / maxAbs) * halfH, v !== 0 ? 1.5 : 0);
        const y = v >= 0 ? baseline - h : baseline;
        const color = v >= 0 ? '#059669' : '#DC2626';
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${color}"/>`;
    }).join('');

    const labels = data.map((d, i) => {
        const x = padL + i * stepX + stepX / 2;
        return `<text x="${x.toFixed(1)}" y="${H - 6}" font-size="9.5" fill="#94A3B8" text-anchor="middle">${d.label}</text>`;
    }).join('');

    const zeroLine = `<line x1="${padL}" y1="${baseline.toFixed(1)}" x2="${W - padR}" y2="${baseline.toFixed(1)}" stroke="#E2E8F0" stroke-width="1"/>`;

    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:150px;display:block">${zeroLine}${bars}${labels}</svg>`;
}
