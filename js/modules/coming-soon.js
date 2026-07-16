/* ════════════════════════════════════════════════════════════
   صفحات "قريباً" — coming-soon.js
   صفحة بسيطة موحّدة لكل موديول لم يُبنَ بعد — بدون أي منطق فعلي
   يصدّر: renderComingSoon(container, config) + دالة مخصصة لكل موديول
   ════════════════════════════════════════════════════════════ */

function csRenderPage(c, icon, title, description) {
    c.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 20px;text-align:center">
        <div style="font-size:56px;margin-bottom:16px;opacity:0.7">${icon}</div>
        <h2 style="font-size:22px;font-weight:800;color:#1E293B;margin-bottom:10px">${title}</h2>
        <p style="font-size:14px;color:#64748B;max-width:420px;line-height:1.8;margin-bottom:20px">${description}</p>
        <span style="background:#FFFBEB;color:#D97706;padding:8px 20px;border-radius:20px;font-size:13px;font-weight:700">🔜 ستُضاف قريباً</span>
    </div>`;
}

// ── موديولات V16 الكبيرة (لم تُبنَ إطلاقاً) ──
async function renderWhatsAppIntegration(c) {
    csRenderPage(c, '💬', 'تكامل واتساب',
        'إرسال الفواتير وإشعارات التحصيل والتذكيرات للعملاء مباشرة عبر واتساب.');
}
async function renderAIDashboard(c) {
    csRenderPage(c, '🤖', 'لوحة الذكاء الاصطناعي',
        'تحليلات ذكية وتوصيات تلقائية لتحسين المبيعات وإدارة المخزون بناءً على بيانات النظام.');
}

// ── ربط الأنظمة الخارجية ──
async function renderCustomerOrdersLink(c) {
    csRenderPage(c, '🔗', 'ربط برنامج طلبات العملاء',
        'مزامنة تلقائية بين طلبات العملاء الواردة من التطبيق الخارجي وفواتير المبيعات في هذا النظام.');
}
async function renderRepAppLink(c) {
    csRenderPage(c, '📱', 'ربط برنامج المندوب',
        'مزامنة بيانات المندوبين من تطبيق الموبايل الخاص بهم (الزيارات، الطلبات، التحصيلات) مع هذا النظام.');
}

Object.assign(window, {
    renderWhatsAppIntegration,
    renderAIDashboard, renderCustomerOrdersLink, renderRepAppLink,
});
