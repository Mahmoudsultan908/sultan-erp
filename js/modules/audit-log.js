/* ════════════════════════════════════════════════════════════
   سجل التدقيق — audit-log.js
   عرض كل الأحداث المالية المسجّلة تلقائياً (financial_events)
   يصدّر: renderAuditLog(container)
   قراءة فقط بالكامل — لا يكتب أي شيء في قاعدة البيانات
   ════════════════════════════════════════════════════════════ */

let _alFrom = '';
let _alTo = '';
let _alRefType = '';
let _alEventType = '';

const AL_REF_LABELS = {
    sale: 'فاتورة بيع', purchase: 'فاتورة شراء', sales_return: 'مرتجع بيع',
    purchase_return: 'مرتجع شراء', expense: 'مصروف', collection: 'تحصيل عميل',
    payment: 'دفع مورد', opening_balance: 'رصيد افتتاحي', deferred_rebate: 'مؤجل',
    customer_payment: 'تحصيل عميل',
};
const AL_EVENT_LABELS = { create: 'إنشاء', update: 'تعديل', cancel: 'إلغاء', approve: 'اعتماد' };
const AL_EVENT_COLORS = { create: '#059669', update: '#D97706', cancel: '#DC2626', approve: '#2563EB' };
const AL_EVENT_ICONS  = { create: '➕', update: '✏️', cancel: '🚫', approve: '✅' };

function alFmtDate(d) { return new Date(d).toLocaleString('ar-EG', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }); }

// ════════════════════════════════════════════════════════════
// ترجمة وصف الحدث (ev.description) للعربي — best effort فقط
// ────────────────────────────────────────────────────────────
// ev.description بييجي جاهز من trigger في Postgres (خارج الريبو، مفيش
// وصول لقاعدة بيانات حية لمعرفة الصيغة الفعلية بالظبط). الدالة دي
// بتحاول تتعرف على أنماط إنجليزية شائعة (created/updated/cancelled/
// approved/deleted + اسم جدول/حقل + "from X to Y") وتترجمها لعربي
// مفهوم. أي نص من الأنماط دي غير معروف بيترجع زي ما هو من غير تغيير
// (عشان ما نخفيش معلومة لو الترجمة غلط أو ناقصة).
// التغطية جزئية وقائمة على تخمين — لو الأنماط الفعلية مختلفة محتاجين
// أمثلة حقيقية من سجل التدقيق عشان نظبطها.
// ════════════════════════════════════════════════════════════

// عبارات/كلمات أسماء الكيانات والحقول — الأطول أولاً عشان "sales invoice"
// تترجم قبل "invoice" لوحدها
const AL_ENTITY_PHRASES = [
    ['sales invoice', 'فاتورة بيع'], ['sale invoice', 'فاتورة بيع'],
    ['purchase invoice', 'فاتورة شراء'], ['purchase order', 'أمر شراء'],
    ['sales return', 'مرتجع بيع'], ['sale return', 'مرتجع بيع'],
    ['purchase return', 'مرتجع شراء'],
    ['opening balance', 'رصيد افتتاحي'],
    ['customer payment', 'تحصيل عميل'], ['supplier payment', 'دفعة مورد'],
    ['credit limit', 'حد الائتمان'],
    ['stock transfer', 'تحويل مخزون'],
    ['payment method', 'طريقة الدفع'],
    ['unit price', 'سعر الوحدة'],
    ['invoice', 'فاتورة'], ['order', 'طلب'],
    ['customer', 'عميل'], ['supplier', 'مورد'], ['vendor', 'مورد'],
    ['payment', 'دفعة'], ['collection', 'تحصيل'], ['expense', 'مصروف'],
    ['product', 'صنف'], ['item', 'صنف'], ['warehouse', 'مخزن'],
    ['treasury', 'خزنة'], ['cash', 'نقدية'],
    ['balance', 'رصيد'], ['quantity', 'كمية'], ['qty', 'كمية'],
    ['stock', 'مخزون'], ['total', 'إجمالي'], ['amount', 'مبلغ'],
    ['price', 'سعر'], ['discount', 'خصم'], ['tax', 'ضريبة'],
    ['status', 'الحالة'], ['note', 'ملاحظة'], ['notes', 'ملاحظات'],
    ['date', 'تاريخ'], ['user', 'مستخدم'], ['employee', 'موظف'],
];

// ترجمة الكيانات/الحقول جوه النص (استبدال كلمة بكلمة، الأطول أولاً)
function alTranslateEntity(str) {
    if (!str) return str;
    let out = String(str).trim();
    AL_ENTITY_PHRASES.forEach(([en, ar]) => {
        const re = new RegExp('\\b' + en.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b', 'gi');
        out = out.replace(re, ar);
    });
    return out;
}

// قوالب الأفعال — تجرَّب بالترتيب، أول قالب يتطابق يكسب
const AL_DESC_PATTERNS = [
    // تغيّر حقل من قيمة لقيمة: "balance changed from 100 to 200" / "status updated from X to Y"
    { re: /^(.+?)\s+(?:changed|updated)\s+from\s+["']?(.+?)["']?\s+to\s+["']?(.+?)["']?\.?$/i,
      build: (m) => `تغيّر ${alTranslateEntity(m[1])} من ${m[2]} إلى ${m[3]}` },

    // الفعل في الأول: "Created sale invoice #1001" / "Cancelled purchase order PO-5"
    { re: /^(created|added|inserted|new)\s+(.+?)\s*$/i, build: (m) => `تم إنشاء ${alTranslateEntity(m[2])}` },
    { re: /^(updated|modified|edited)\s+(.+?)\s*$/i, build: (m) => `تم تعديل ${alTranslateEntity(m[2])}` },
    { re: /^(cancelled|canceled|voided|reversed)\s+(.+?)\s*$/i, build: (m) => `تم إلغاء ${alTranslateEntity(m[2])}` },
    { re: /^(approved|confirmed)\s+(.+?)\s*$/i, build: (m) => `تم اعتماد ${alTranslateEntity(m[2])}` },
    { re: /^(deleted|removed)\s+(.+?)\s*$/i, build: (m) => `تم حذف ${alTranslateEntity(m[2])}` },

    // الفعل في الآخر: "Sale invoice #1001 created" / "Purchase #5 cancelled"
    { re: /^(.+?)\s+(created|added|inserted)\.?$/i, build: (m) => `تم إنشاء ${alTranslateEntity(m[1])}` },
    { re: /^(.+?)\s+(updated|modified|edited)\.?$/i, build: (m) => `تم تعديل ${alTranslateEntity(m[1])}` },
    { re: /^(.+?)\s+(cancelled|canceled|voided|reversed)\.?$/i, build: (m) => `تم إلغاء ${alTranslateEntity(m[1])}` },
    { re: /^(.+?)\s+(approved|confirmed)\.?$/i, build: (m) => `تم اعتماد ${alTranslateEntity(m[1])}` },
    { re: /^(.+?)\s+(deleted|removed)\.?$/i, build: (m) => `تم حذف ${alTranslateEntity(m[1])}` },
];

function alTranslateDescription(text) {
    if (!text) return '—';
    const raw = String(text).trim();
    // لو فيه حروف عربية أصلاً، سيبه زي ما هو (متولّد عربي جاهز)
    if (/[؀-ۿ]/.test(raw)) return raw;

    for (const p of AL_DESC_PATTERNS) {
        const m = raw.match(p.re);
        if (m) {
            try { return p.build(m); } catch (e) { /* تجاهل وارجع للنص الأصلي */ }
        }
    }
    // fallback: النمط مش معروف — رجّع النص الإنجليزي الأصلي عشان ما نخفيش معلومة
    return raw;
}

async function renderAuditLog(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل سجل التدقيق...</div>';
    try {
        await alLoadData(c);
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

async function alLoadData(c) {
    try {
        // ★ profiles(*) مش profiles(email, full_name) — تسمية عمود محدد
        //   صراحة في join مضمّن بيتحقق منه PostgREST مباشرة، ولو مش موجود
        //   بنفس الاسم في العلاقة المضمّنة بيرمي "column ... does not
        //   exist" ويوقف الصفحة كلها. profiles(*) بيرجّع أي أعمدة موجودة
        //   فعلاً من غير افتراض اسم بعينه (نفس نمط users-management.js).
        let query = sb.from('financial_events')
            .select('*, profiles(*)')
            .order('created_at', { ascending: false })
            .limit(300);

        if (_alFrom) query = query.gte('created_at', _alFrom);
        if (_alTo) query = query.lte('created_at', _alTo + 'T23:59:59');
        if (_alRefType) query = query.eq('ref_type', _alRefType);
        if (_alEventType) query = query.eq('event_type', _alEventType);

        const { data: events, error } = await query;
        if (error) throw error;

        const totalCreate = (events||[]).filter(e=>e.event_type==='create').length;
        const totalUpdate = (events||[]).filter(e=>e.event_type==='update').length;
        const totalCancel = (events||[]).filter(e=>e.event_type==='cancel').length;

        const rows = (events||[]).map(ev => {
            const userName = ev.profiles?.full_name || ev.profiles?.name || ev.profiles?.email || 'النظام';
            const eventColor = AL_EVENT_COLORS[ev.event_type] || '#64748B';
            const eventIcon = AL_EVENT_ICONS[ev.event_type] || '📋';
            const refLabel = AL_REF_LABELS[ev.ref_type] || ev.ref_type;
            return `<tr>
                <td class="dash-muted">${alFmtDate(ev.created_at)}</td>
                <td><span style="color:${eventColor};font-weight:700">${eventIcon} ${AL_EVENT_LABELS[ev.event_type]||ev.event_type}</span></td>
                <td><span class="dash-badge dash-badge-blue">${refLabel}</span></td>
                <td>${alTranslateDescription(ev.description)}</td>
                <td>${userName}</td>
                <td>${(ev.old_data || ev.new_data) ? `<button class="cc-edit" onclick="alViewDetails('${ev.id}')">👁️ تفاصيل</button>` : '—'}</td>
            </tr>`;
        }).join('');

        c.innerHTML = `
        <div style="margin-bottom:20px"><h2 style="font-size:22px;font-weight:800">🔐 سجل التدقيق</h2>
        <p style="font-size:13px;color:#64748B;margin-top:4px">كل عملية مالية تُسجَّل هنا تلقائياً — من قام بها ومتى وماذا تغيّر</p></div>

        <div class="mod-grid" style="margin-bottom:16px">
            <div class="mod-card"><div class="mod-card-icon" style="background:#F0FDF4;color:#059669">➕</div><div class="mod-card-val">${totalCreate}</div><div class="mod-card-lbl">عمليات إنشاء</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#FFFBEB;color:#D97706">✏️</div><div class="mod-card-val">${totalUpdate}</div><div class="mod-card-lbl">عمليات تعديل</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#FEE2E2;color:#DC2626">🚫</div><div class="mod-card-val">${totalCancel}</div><div class="mod-card-lbl">عمليات إلغاء</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#EFF6FF;color:#2563EB">📋</div><div class="mod-card-val">${(events||[]).length}</div><div class="mod-card-lbl">إجمالي (آخر 300)</div></div>
        </div>

        <div class="dash-card" style="padding:16px;margin-bottom:16px">
            <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
                <div><label class="ob-label">من تاريخ</label><input type="date" id="alFrom" class="ob-input" style="margin:0" value="${_alFrom}"></div>
                <div><label class="ob-label">إلى تاريخ</label><input type="date" id="alTo" class="ob-input" style="margin:0" value="${_alTo}"></div>
                <div style="min-width:160px">
                    <label class="ob-label">نوع العملية</label>
                    <select id="alRefType" class="ob-input" style="margin:0">
                        <option value="">الكل</option>
                        ${Object.entries(AL_REF_LABELS).map(([v,l])=>`<option value="${v}" ${_alRefType===v?'selected':''}>${l}</option>`).join('')}
                    </select>
                </div>
                <div style="min-width:140px">
                    <label class="ob-label">نوع الحدث</label>
                    <select id="alEventType" class="ob-input" style="margin:0">
                        <option value="">الكل</option>
                        ${Object.entries(AL_EVENT_LABELS).map(([v,l])=>`<option value="${v}" ${_alEventType===v?'selected':''}>${l}</option>`).join('')}
                    </select>
                </div>
                <button class="ob-add-btn" onclick="alApplyFilter()">🔍 تطبيق</button>
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="alResetFilter()">إعادة تعيين</button>
            </div>
        </div>

        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>التاريخ والوقت</th><th>الحدث</th><th>نوع العملية</th><th>الوصف</th><th>بواسطة</th><th></th>
            </tr></thead>
            <tbody>${rows || '<tr><td colspan="6" class="empty-state"><span>🔐</span>لا توجد أحداث مطابقة</td></tr>'}</tbody>
            </table>
        </div>`;

        window.alApplyFilter = () => {
            _alFrom = document.getElementById('alFrom').value;
            _alTo = document.getElementById('alTo').value;
            _alRefType = document.getElementById('alRefType').value;
            _alEventType = document.getElementById('alEventType').value;
            alLoadData(c);
        };
        window.alResetFilter = () => {
            _alFrom = ''; _alTo = ''; _alRefType = ''; _alEventType = '';
            alLoadData(c);
        };
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

window.alViewDetails = async function(eventId) {
    const { data: ev } = await sb.from('financial_events').select('*').eq('id', eventId).single();
    if (!ev) return;

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'alDetailsModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:520px">
            <div class="mod-modal-header"><h3>👁️ تفاصيل الحدث</h3>
                <button class="mod-modal-close" onclick="document.getElementById('alDetailsModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <p style="font-size:13px;color:#64748B;margin-bottom:14px">${alTranslateDescription(ev.description)}</p>
                ${ev.old_data ? `<div style="margin-bottom:14px">
                    <div style="font-weight:800;font-size:12.5px;color:#DC2626;margin-bottom:6px">قبل التعديل</div>
                    <pre style="background:#FEF2F2;padding:12px;border-radius:8px;font-size:11px;direction:ltr;text-align:left;overflow-x:auto;max-height:200px">${JSON.stringify(ev.old_data, null, 2)}</pre>
                </div>` : ''}
                ${ev.new_data ? `<div>
                    <div style="font-weight:800;font-size:12.5px;color:#059669;margin-bottom:6px">${ev.old_data ? 'بعد التعديل' : 'البيانات'}</div>
                    <pre style="background:#F0FDF4;padding:12px;border-radius:8px;font-size:11px;direction:ltr;text-align:left;overflow-x:auto;max-height:200px">${JSON.stringify(ev.new_data, null, 2)}</pre>
                </div>` : ''}
            </div>
        </div>`;
    document.body.appendChild(modal);
};

// ملاحظة: alApplyFilter وalResetFilter مش موجودين هنا عمداً — بيتحدّدوا
// ديناميكياً جوه alLoadData() وقت ما الشاشة تُفتح فعلاً (نفس سبب
// accApplyTbFilter في accounting.js).
Object.assign(window, { renderAuditLog, alLoadData, alViewDetails, alTranslateDescription });
