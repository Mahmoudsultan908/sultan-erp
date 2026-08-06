/* ════════════════════════════════════════════════════════════
   ربط برنامج طلبات العملاء — customer-orders-review.js
   طلبات واردة من "سلطانو" (تطبيق طلب العملاء الخارجي) — كل طلب بيفضل
   "معلّق" لحد ما موظف في سلطان ERP يراجعه ويعتمده. الاعتماد بيفتح شاشة
   المبيعات العادية معبّاة بأصناف الطلب (نفس آلية تحويل عرض السعر في
   quotations.js) عشان يقدر يعدّل أي حاجة قبل الحفظ — الحفظ نفسه هو
   الاعتماد. الرفض بيقفل الطلب من غير ما يفتح فاتورة.

   تسجيل عملاء سلطانو الجدد بيستخدم نفس تبويب مراجعة طلبات المندوبين
   (rep-customer-requests.js) زي ما هو — الجدول (customer_change_requests)
   بيستحمل مصدرين (rep / sultano) من غير أي تعديل في الكود بتاعه.

   يصدّر: renderCustomerOrdersLink(container) — بيحل محل صفحة "قريباً"
   القديمة في coming-soon.js (نفس اسم الدالة المربوطة في app.js/index.html
   من الأول، فمفيش أي تعديل تاني مطلوب في الراوتر أو القائمة الجانبية)
   ════════════════════════════════════════════════════════════ */

let _corTab = 'orders'; // 'orders' | 'registrations' | 'banners' | 'notifications' | 'carts'
let COR_NOTIFY_CUSTOMERS = []; // عملاء مفعّلين الإشعارات فعلياً (لهم push_subscriptions)
let COR_CARTS = [];
let COR_ORDERS = [];
let COR_BANNERS = [];
let COR_CATS = [];
const COR_IMAGE_BUCKET = 'product-images'; // نفس الباكت العام المستخدم لصور الأصناف

function corFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
const COR_STATUS_LABELS = { preparing: '📦 جاري التحضير', delivering: '🚚 خرج للتسليم', delivered: '✅ تم التسليم' };

window.corUpdateDeliveryStatus = async function(id, status) {
    try {
        const { error } = await sb.from('customer_orders').update({ status }).eq('id', id);
        if (error) throw error;
        const o = COR_ORDERS.find(x => x.id === id);
        if (o) o.status = status;
    } catch (err) {
        alert('خطأ: ' + err.message);
    }
};

async function renderCustomerOrdersLink(c) {
    corLinkMarkSeen();
    c.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div><h2 style="font-size:22px;font-weight:800">🔗 ربط برنامج طلبات العملاء</h2>
        <p style="font-size:13px;color:var(--inv-muted);margin-top:4px">طلبات وتسجيلات واردة من "سلطانو" — كل حاجة بتفضل معلّقة لحد ما تراجعها وتعتمدها من هنا</p></div>
    </div>
    <div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap">
        <button class="mod-btn ${_corTab==='orders'?'mod-btn-primary':''}" onclick="corSwitchTab('orders')">📦 طلبات سلطانو</button>
        <button class="mod-btn ${_corTab==='registrations'?'mod-btn-primary':''}" onclick="corSwitchTab('registrations')">👤 تسجيل عملاء سلطانو</button>
        <button class="mod-btn ${_corTab==='banners'?'mod-btn-primary':''}" onclick="corSwitchTab('banners')">🖼️ بانرات سلطانو</button>
        <button class="mod-btn ${_corTab==='notifications'?'mod-btn-primary':''}" onclick="corSwitchTab('notifications')">🔔 إرسال إشعار</button>
        <button class="mod-btn ${_corTab==='carts'?'mod-btn-primary':''}" onclick="corSwitchTab('carts')">🛒 سلال حالية</button>
    </div>
    <div id="corBody"></div>`;
    await corRenderTab();
}

async function corRenderTab() {
    const body = document.getElementById('corBody');
    if (!body) return;
    if (_corTab === 'orders') await corRenderOrders(body);
    else if (_corTab === 'banners') await corRenderBanners(body);
    else if (_corTab === 'notifications') await corRenderNotifications(body);
    else if (_corTab === 'carts') await corRenderCarts(body);
    else await renderRepCustomerRequests(body);
}

window.corSwitchTab = async function (tab) {
    _corTab = tab;
    await renderCustomerOrdersLink(document.getElementById('app-content'));
};

async function corRenderOrders(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل الطلبات...</div>';
    try {
        const { data, error } = await sb.from('customer_orders')
            .select('*, customers(name,phone,address), customer_order_items(*, products(name,code,unit))')
            .order('created_at', { ascending: false })
            .limit(150);
        if (error) throw error;
        COR_ORDERS = data || [];
        corRenderOrdersPage(c);
    } catch (err) {
        c.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function corRenderOrdersPage(c) {
    const pending = COR_ORDERS.filter(o => !o.converted_sale_id && o.status !== 'cancelled');
    const reviewed = COR_ORDERS.filter(o => o.converted_sale_id || o.status === 'cancelled').slice(0, 30);

    c.innerHTML = `
    ${pending.length ? `
    <div class="mod-table-wrap" style="margin-bottom:20px">
        <div style="padding:14px 18px 0;font-weight:800;font-size:14px;color:var(--inv-navy)">⏳ طلبات في انتظار المراجعة (${pending.length})</div>
        <table class="mod-table"><thead><tr>
            <th>رقم الطلب</th><th>العميل</th><th>التليفون</th><th style="width:80px">عدد الأصناف</th><th>الإجمالي</th><th>ملاحظات</th><th>التاريخ</th><th style="width:230px"></th>
        </tr></thead>
        <tbody>${pending.map(corRowHTML).join('')}</tbody></table>
    </div>` : `<div class="empty-state" style="margin-bottom:20px"><span>✅</span>مفيش طلبات سلطانو معلّقة دلوقتي</div>`}

    ${reviewed.length ? `
    <div class="mod-table-wrap">
        <div style="padding:14px 18px 0;font-weight:800;font-size:14px;color:var(--inv-navy)">📋 آخر الطلبات المراجَعة</div>
        <table class="mod-table"><thead><tr>
            <th>رقم الطلب</th><th>العميل</th><th>التليفون</th><th style="width:80px">عدد الأصناف</th><th>الإجمالي</th><th>ملاحظات</th><th>الحالة</th><th>التاريخ</th><th style="width:60px"></th>
        </tr></thead><tbody>
            ${reviewed.map(o => `<tr>
                <td>${o.order_no || '—'}</td>
                <td>${o.customers?.name || '—'}</td>
                <td style="text-align:center;color:var(--inv-muted)"><span dir="ltr">${o.customers?.phone || '—'}</span></td>
                <td style="text-align:center">${(o.customer_order_items || []).length}</td>
                <td>${corFmt(o.total)}</td>
                <td style="font-size:12px;color:var(--inv-muted)">${o.notes || '—'}</td>
                <td>${o.converted_sale_id ? `
                    <select class="mod-form-input" style="margin:0;padding:4px 8px;font-size:12px;width:auto" onchange="corUpdateDeliveryStatus('${o.id}',this.value)">
                        ${['preparing','delivering','delivered'].map(s => `<option value="${s}" ${o.status===s?'selected':''}>${COR_STATUS_LABELS[s]}</option>`).join('')}
                    </select>
                ` : '<span style="color:var(--inv-red);font-weight:700">❌ مرفوض</span>'}</td>
                <td style="color:var(--inv-muted)">${o.created_at ? new Date(o.created_at).toLocaleDateString('ar-EG') : '—'}</td>
                <td style="text-align:center"><button class="cc-edit" onclick="corShowOrderDetail('${o.id}')">👁️ عرض</button></td>
            </tr>`).join('')}
        </tbody></table>
    </div>` : ''}`;
}

function corRowHTML(o) {
    const items = o.customer_order_items || [];
    return `<tr data-cor-id="${o.id}">
        <td>${o.order_no || '—'}</td>
        <td>${o.customers?.name || '—'}</td>
        <td style="text-align:center;color:var(--inv-muted)"><span dir="ltr">${o.customers?.phone || '—'}</span></td>
        <td style="text-align:center">${items.length}</td>
        <td>${corFmt(o.total)}</td>
        <td style="font-size:12px;color:var(--inv-muted)">${o.notes || '—'}</td>
        <td style="color:var(--inv-muted)">${o.created_at ? new Date(o.created_at).toLocaleString('ar-EG') : '—'}</td>
        <td style="white-space:nowrap">
            <button class="cc-edit" onclick="corShowOrderDetail('${o.id}')">👁️ عرض</button>
            <button class="cc-edit" style="background:#DCFCE7;color:#166534" onclick="corApproveOrder('${o.id}')">✅ اعتماد/مراجعة</button>
            <button class="cc-edit" style="background:var(--inv-red-bg);color:var(--inv-red);margin-right:4px" onclick="corRejectOrder('${o.id}')">❌ رفض</button>
            <button class="cc-edit" style="background:var(--inv-gold-bg);color:var(--inv-gold);margin-right:4px" title="إرسال إشعار لهذا العميل" onclick="corQuickNotify('${o.customer_id}', '${(o.customers?.name || '').replace(/'/g, "\\'")}')">🔔</button>
        </td>
    </tr>`;
}

window.corShowOrderDetail = function (id) {
    const o = COR_ORDERS.find(x => x.id === id);
    if (!o) return;
    const items = o.customer_order_items || [];
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'corDetailModal';
    modal.innerHTML = `
    <div class="mod-modal" style="max-width:560px">
        <div class="mod-modal-header"><h3>📦 تفاصيل الطلب ${o.order_no || ''}</h3>
            <button class="mod-modal-close" onclick="document.getElementById('corDetailModal').remove()">&times;</button></div>
        <div class="mod-modal-body">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;margin-bottom:14px">
                <div>العميل: <strong>${o.customers?.name || '—'}</strong></div>
                <div>التليفون: <strong dir="ltr">${o.customers?.phone || '—'}</strong></div>
                <div style="grid-column:1/-1">العنوان: <strong>${o.customers?.address || '—'}</strong></div>
                <div style="grid-column:1/-1">التاريخ: <strong>${o.created_at ? new Date(o.created_at).toLocaleString('ar-EG') : '—'}</strong></div>
                ${o.notes ? `<div style="grid-column:1/-1">ملاحظات: <strong>${o.notes}</strong></div>` : ''}
            </div>
            <table class="mod-table"><thead><tr>
                <th>الصنف</th><th style="width:70px">الوحدة</th><th style="width:70px">الكمية</th><th style="width:90px">السعر</th><th style="width:100px">الإجمالي</th>
            </tr></thead><tbody>
                ${items.map(it => `<tr>
                    <td>${it.products?.name || '—'} <small style="color:var(--inv-muted-light)">${it.products?.code || ''}</small></td>
                    <td style="text-align:center;color:var(--inv-muted)">${it.products?.unit || '—'}</td>
                    <td style="text-align:center">${corFmt(it.qty)}</td>
                    <td>${corFmt(it.unit_price)}</td>
                    <td style="font-weight:700">${corFmt((Number(it.qty)||0) * (Number(it.unit_price)||0))}</td>
                </tr>`).join('') || `<tr><td colspan="5" class="empty-state" style="padding:16px"><span>📭</span>الطلب ده مالوش أصناف</td></tr>`}
            </tbody></table>
            <div style="text-align:left;font-weight:800;font-size:15px;margin-top:12px">الإجمالي: ${corFmt(o.total)} ج.م</div>
        </div>
    </div>`;
    document.body.appendChild(modal);
};

window.corApproveOrder = function (id) {
    const o = COR_ORDERS.find(x => x.id === id);
    if (!o) return;
    const items = o.customer_order_items || [];
    if (!items.length) { alert('⚠️ الطلب ده مالوش أصناف'); return; }
    if (!confirm('سيتم فتح شاشة المبيعات مع تحميل أصناف الطلب تلقائياً. راجع الفاتورة (وعدّل أي حاجة لو محتاج) واحفظها من هناك — الحفظ هو الاعتماد. متابعة؟')) return;

    window._pendingQuoteConversion = {
        kind: 'order',
        quoteId: o.id,
        customerId: o.customer_id,
        orderNo: o.order_no,
        orderTotal: o.total,
        items: items.map(it => ({
            pid: it.product_id, name: it.products?.name || '', code: it.products?.code || '',
            qty: Number(it.qty) || 0, price: Number(it.unit_price) || 0, disc: 0, free: 0,
            unit: it.products?.unit || '', stock: 0,
        })),
    };
    loadMod(document.querySelector('[data-mod="sales"]'), 'sales');
};

window.corRejectOrder = async function (id) {
    const reason = prompt('سبب الرفض (اختياري):', '') || null;
    if (!confirm('رفض الطلب ده؟')) return;
    try {
        const { error } = await sb.from('customer_orders').update({
            status: 'cancelled', reject_reason: reason,
            reviewed_by: currentUser?.id || null, reviewed_at: new Date().toISOString(),
        }).eq('id', id);
        if (error) throw error;
        corRenderOrders(document.getElementById('corBody') || document.getElementById('app-content'));
    } catch (err) {
        alert('خطأ أثناء الرفض: ' + err.message);
    }
};

// ════════════════════════════════════════════════════════════
// بانرات سلطانو — banners (جدول موجود من الأول، غير مستخدم قبل كده)
// ════════════════════════════════════════════════════════════
async function corRenderBanners(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل البانرات...</div>';
    try {
        const [{ data: banners, error }, { data: cats }] = await Promise.all([
            sb.from('banners').select('*').order('display_order'),
            sb.from('product_categories').select('*').order('name'),
        ]);
        if (error) throw error;
        COR_BANNERS = banners || [];
        COR_CATS = cats || [];
        corRenderBannersPage(c);
    } catch (err) {
        c.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function corRenderBannersPage(c) {
    c.innerHTML = `
    <div style="margin-bottom:14px">
        <button class="mod-btn mod-btn-primary" onclick="corOpenBannerModal()">+ بانر جديد</button>
    </div>
    ${COR_BANNERS.length ? `
    <div class="mod-table-wrap">
        <table class="mod-table"><thead><tr>
            <th style="width:70px">الصورة</th><th>العنوان</th><th>مرتبط بـ</th><th>النوع</th><th>الترتيب</th><th>الحالة</th><th style="width:150px"></th>
        </tr></thead><tbody>
            ${COR_BANNERS.map(b => `<tr>
                <td>${b.image_url ? `<img src="${b.image_url}" style="width:50px;height:36px;object-fit:cover;border-radius:6px">` : '—'}</td>
                <td>${b.title}</td>
                <td style="font-size:12px;color:var(--inv-muted)">${b.link_type==='category' ? (COR_CATS.find(x=>x.id===b.link_value)?.name || 'قسم محذوف') : '—'}</td>
                <td style="font-size:12px">${b.display_type==='popup' ? '📱 بوب أب عند الفتح' : '🔄 شريط دوّار'}</td>
                <td>${b.display_order}</td>
                <td>${b.is_active ? '<span style="color:var(--inv-green);font-weight:700">✅ فعّال</span>' : '<span style="color:var(--inv-muted-light)">⏸️ متوقف</span>'}</td>
                <td style="white-space:nowrap">
                    <button class="cc-edit" onclick="corOpenBannerModal('${b.id}')">✏️</button>
                    <button class="cc-edit" style="background:var(--inv-red-bg);color:var(--inv-red);margin-right:4px" onclick="corDeleteBanner('${b.id}')">🗑️</button>
                </td>
            </tr>`).join('')}
        </tbody></table>
    </div>` : '<div class="empty-state"><span>🖼️</span>مفيش بانرات لسه — دوس "+ بانر جديد"</div>'}`;
}

window.corOpenBannerModal = function(id) {
    const b = id ? COR_BANNERS.find(x => x.id === id) : null;
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'corBannerModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:460px">
            <div class="mod-modal-header"><h3>${b ? '✏️ تعديل بانر' : '🖼️ بانر جديد'}</h3>
                <button class="mod-modal-close" onclick="document.getElementById('corBannerModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>العنوان *</label>
                    <input type="text" id="corBanTitle" class="mod-form-input" value="${b?.title||''}"></div>
                <div class="mod-form-group"><label>الصورة</label>
                    <div style="display:flex;align-items:center;gap:10px">
                        <img id="corBanImgPreview" src="${b?.image_url||''}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;background:#F1F5F9;${b?.image_url?'':'display:none'}">
                        <input type="file" id="corBanImgFile" class="mod-form-input" accept="image/*" style="margin:0" onchange="corPreviewBannerImage(this)">
                    </div>
                </div>
                <div class="mod-form-group"><label>نوع العرض</label>
                    <select id="corBanDisplayType" class="mod-form-input">
                        <option value="carousel" ${b?.display_type!=='popup'?'selected':''}>🔄 شريط دوّار (فوق الصفحة الرئيسية)</option>
                        <option value="popup" ${b?.display_type==='popup'?'selected':''}>📱 بوب أب بحجم الشاشة (مرة عند فتح التطبيق)</option>
                    </select>
                </div>
                <div class="mod-form-group"><label>يفتح عند الضغط</label>
                    <select id="corBanLinkType" class="mod-form-input" onchange="document.getElementById('corBanCatWrap').style.display=this.value==='category'?'block':'none'">
                        <option value="none" ${b?.link_type!=='category'?'selected':''}>بدون رابط</option>
                        <option value="category" ${b?.link_type==='category'?'selected':''}>قسم منتجات</option>
                    </select>
                </div>
                <div class="mod-form-group" id="corBanCatWrap" style="display:${b?.link_type==='category'?'block':'none'}">
                    <label>القسم</label>
                    <select id="corBanCatId" class="mod-form-input">
                        ${COR_CATS.map(c=>`<option value="${c.id}" ${b?.link_value===c.id?'selected':''}>${c.name}</option>`).join('')}
                    </select>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>الترتيب</label>
                        <input type="number" id="corBanOrder" class="mod-form-input" value="${b?.display_order||0}" min="0"></div>
                    <div class="mod-form-group"><label style="display:flex;align-items:center;gap:6px;margin-top:22px">
                        <input type="checkbox" id="corBanActive" ${b?(b.is_active?'checked':''):'checked'} style="width:auto">فعّال</label></div>
                </div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:var(--inv-text-soft)" onclick="document.getElementById('corBannerModal').remove()">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="corSaveBanner('${id||''}')">💾 حفظ</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
};

window.corPreviewBannerImage = function(input) {
    const file = input.files[0];
    const img = document.getElementById('corBanImgPreview');
    if (!file || !img) return;
    img.src = URL.createObjectURL(file);
    img.style.display = '';
};

window.corSaveBanner = async function(id) {
    const title = document.getElementById('corBanTitle').value.trim();
    if (!title) return alert('العنوان مطلوب');
    const linkType = document.getElementById('corBanLinkType').value;
    const btn = document.querySelector('#corBannerModal .mod-btn-primary');
    btn.disabled = true; btn.innerText = '⏳ جاري الحفظ...';
    try {
        const payload = {
            title,
            link_type: linkType,
            link_value: linkType === 'category' ? document.getElementById('corBanCatId').value : null,
            display_order: parseInt(document.getElementById('corBanOrder').value) || 0,
            is_active: document.getElementById('corBanActive').checked,
            display_type: document.getElementById('corBanDisplayType').value,
        };
        const file = document.getElementById('corBanImgFile')?.files?.[0];
        if (file) {
            const safeName = file.name.replace(/[^\w.\-]+/g, '_');
            const path = `banners/${Date.now()}_${safeName}`;
            const { error: upErr } = await sb.storage.from(COR_IMAGE_BUCKET).upload(path, file);
            if (upErr) throw upErr;
            const { data: pub } = sb.storage.from(COR_IMAGE_BUCKET).getPublicUrl(path);
            payload.image_url = pub.publicUrl;
        }
        if (id) {
            const { error } = await sb.from('banners').update(payload).eq('id', id);
            if (error) throw error;
        } else {
            const { error } = await sb.from('banners').insert(payload);
            if (error) throw error;
        }
        document.getElementById('corBannerModal').remove();
        corRenderBanners(document.getElementById('corBody') || document.getElementById('app-content'));
    } catch (err) {
        alert('خطأ: ' + err.message);
        btn.disabled = false; btn.innerText = '💾 حفظ';
    }
};

window.corDeleteBanner = async function(id) {
    if (!confirm('حذف البانر ده؟')) return;
    try {
        const { error } = await sb.from('banners').delete().eq('id', id);
        if (error) throw error;
        corRenderBanners(document.getElementById('corBody') || document.getElementById('app-content'));
    } catch (err) {
        alert('خطأ: ' + err.message);
    }
};

// ════════════════════════════════════════════════════════════
// إرسال إشعار Push حقيقي (زي إشعارات فيسبوك، مش واتساب) لعملاء سلطانو
// اللي فعّلوا الإشعارات فعلياً من التطبيق (جدول push_subscriptions).
// الإرسال الفعلي بيحصل من Edge Function send-push-notification
// (بروتوكول Web Push بمفتاحي VAPID) — الشاشة هنا بس بتجهّز المحتوى
// وتستدعيها.
// ════════════════════════════════════════════════════════════
async function corRenderNotifications(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل العملاء المفعّلين للإشعارات...</div>';
    try {
        const { data, error } = await sb.from('push_subscriptions').select('customer_id, customers(name,phone)');
        if (error) throw error;
        const seen = new Set();
        COR_NOTIFY_CUSTOMERS = [];
        (data || []).forEach(r => {
            if (!r.customer_id || seen.has(r.customer_id)) return;
            seen.add(r.customer_id);
            COR_NOTIFY_CUSTOMERS.push({ id: r.customer_id, name: r.customers?.name || '—', phone: r.customers?.phone || '' });
        });
        COR_NOTIFY_CUSTOMERS.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
        corRenderNotificationsPage(c);
    } catch (err) {
        c.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function corRenderNotificationsPage(c) {
    c.innerHTML = `
    <div class="mod-card" style="max-width:560px">
        <div class="mod-form-group"><label>المستهدَف</label>
            <select id="corNotifyTarget" class="mod-form-input">
                <option value="all">🔔 كل العملاء المفعّلين (${COR_NOTIFY_CUSTOMERS.length})</option>
                ${COR_NOTIFY_CUSTOMERS.map(cu => `<option value="${cu.id}">${cu.name}${cu.phone ? ' — ' + cu.phone : ''}</option>`).join('')}
            </select>
        </div>
        ${!COR_NOTIFY_CUSTOMERS.length ? `<div style="background:var(--inv-gold-bg);color:var(--inv-gold);padding:10px 14px;border-radius:9px;font-size:12.5px;margin-bottom:14px">⚠️ لسه مفيش عملاء فعّلوا الإشعارات من تطبيق سلطانو (شاشة الحساب فيها زرار "🔔 تفعيل الإشعارات").</div>` : ''}
        <div class="mod-form-group"><label>العنوان *</label>
            <input type="text" id="corNotifyTitle" class="mod-form-input" placeholder="مثال: عرض جديد 🔥" maxlength="60"></div>
        <div class="mod-form-group"><label>النص *</label>
            <textarea id="corNotifyBody" class="mod-form-input" rows="3" placeholder="نص الإشعار..." maxlength="180"></textarea></div>
        <div class="mod-form-group"><label>صورة (اختياري)</label>
            <div style="display:flex;align-items:center;gap:10px">
                <img id="corNotifyImgPreview" style="width:56px;height:56px;object-fit:cover;border-radius:8px;background:#F1F5F9;display:none">
                <input type="file" id="corNotifyImgFile" class="mod-form-input" accept="image/*" style="margin:0" onchange="corPreviewNotifyImage(this)">
            </div>
        </div>
        <button class="mod-btn mod-btn-primary" style="width:100%" onclick="corSendNotification()" id="corNotifySendBtn">🔔 إرسال الإشعار</button>
        <div id="corNotifyResult" style="margin-top:12px;font-size:13px"></div>
    </div>`;
}

window.corPreviewNotifyImage = function(input) {
    const file = input.files[0];
    const img = document.getElementById('corNotifyImgPreview');
    if (!file || !img) return;
    img.src = URL.createObjectURL(file);
    img.style.display = '';
};

window.corQuickNotify = function(customerId, customerName) {
    _corTab = 'notifications';
    renderCustomerOrdersLink(document.getElementById('app-content')).then(() => {
        const sel = document.getElementById('corNotifyTarget');
        if (sel && [...sel.options].some(o => o.value === customerId)) sel.value = customerId;
        else alert(`⚠️ "${customerName}" لسه مفعّلش الإشعارات من تطبيق سلطانو، فمش هيوصله الإشعار ده.`);
    });
};

window.corSendNotification = async function() {
    const title = document.getElementById('corNotifyTitle').value.trim();
    const body = document.getElementById('corNotifyBody').value.trim();
    const target = document.getElementById('corNotifyTarget').value;
    const resultEl = document.getElementById('corNotifyResult');
    if (!title || !body) { alert('العنوان والنص مطلوبين'); return; }
    if (!confirm(target === 'all' ? `إرسال الإشعار ده لكل العملاء المفعّلين (${COR_NOTIFY_CUSTOMERS.length})؟` : 'إرسال الإشعار ده للعميل المختار؟')) return;

    const btn = document.getElementById('corNotifySendBtn');
    btn.disabled = true; btn.innerText = '⏳ جاري الإرسال...';
    if (resultEl) resultEl.innerHTML = '';
    try {
        let image_url = null;
        const file = document.getElementById('corNotifyImgFile')?.files?.[0];
        if (file) {
            const safeName = file.name.replace(/[^\w.\-]+/g, '_');
            const path = `notifications/${Date.now()}_${safeName}`;
            const { error: upErr } = await sb.storage.from(COR_IMAGE_BUCKET).upload(path, file);
            if (upErr) throw upErr;
            const { data: pub } = sb.storage.from(COR_IMAGE_BUCKET).getPublicUrl(path);
            image_url = pub.publicUrl;
        }

        const { data, error } = await sb.functions.invoke('send-push-notification', {
            body: { customer_ids: target === 'all' ? 'all' : [target], title, body, image: image_url },
        });
        if (error) throw error;
        if (resultEl) resultEl.innerHTML = `<span style="color:var(--inv-green)">✅ اتبعت لـ ${data.sent} جهاز${data.failed ? ` — فشل ${data.failed}` : ''}</span>`;
    } catch (err) {
        if (resultEl) resultEl.innerHTML = `<span style="color:var(--inv-red)">❌ خطأ: ${err.message}</span>`;
    } finally {
        btn.disabled = false; btn.innerText = '🔔 إرسال الإشعار';
    }
};

// ════════════════════════════════════════════════════════════
// سلال العملاء الحيّة في سلطانو (customer_carts) — نسخة مباشرة بتتحدّث
// من تطبيق سلطانو كل ما العميل يغيّر سلته. الهدف: لو عميل تعطّل معاه
// إرسال الطلب (مشكلة نت غالباً)، الأدمن يشوف بالظبط اللي في سلته
// ويكمّلها من عنده — نفس آلية تحويل عرض السعر (_pendingQuoteConversion)
// اللي corApproveOrder بتستخدمها بالظبط.
// ════════════════════════════════════════════════════════════
async function corRenderCarts(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل السلال الحالية...</div>';
    try {
        const { data, error } = await sb.from('customer_carts')
            .select('*, customers(name,phone)')
            .order('updated_at', { ascending: false });
        if (error) throw error;
        COR_CARTS = data || [];
        corRenderCartsPage(c);
    } catch (err) {
        c.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function corRenderCartsPage(c) {
    if (!COR_CARTS.length) {
        c.innerHTML = '<div class="empty-state"><span>🛒</span>مفيش عملاء حاطّين حاجة في سلتهم دلوقتي</div>';
        return;
    }
    c.innerHTML = `
    <div style="font-size:13px;color:var(--inv-muted);margin-bottom:14px">سلة كل عميل بتتحدّث تلقائي من سلطانو أول ما يضيف/يشيل صنف — لو حد اتعطّل معاه إرسال الطلب، اضغط "✅ إكمال الطلب" وكمّلها من هنا.</div>
    <div class="mod-table-wrap">
        <table class="mod-table"><thead><tr>
            <th>العميل</th><th>التليفون</th><th style="width:80px">عدد الأصناف</th><th>الإجمالي</th><th>آخر تحديث</th><th style="width:220px"></th>
        </tr></thead><tbody>
            ${COR_CARTS.map(cart => {
                const items = cart.items || [];
                const total = items.reduce((s, it) => s + (Number(it.qty)||0) * (Number(it.price)||0), 0);
                const minsAgo = Math.max(0, Math.round((Date.now() - new Date(cart.updated_at).getTime()) / 60000));
                return `<tr>
                    <td>${cart.customers?.name || '—'}</td>
                    <td style="text-align:center;color:var(--inv-muted)"><span dir="ltr">${cart.customers?.phone || '—'}</span></td>
                    <td style="text-align:center">${items.length}</td>
                    <td>${corFmt(total)}</td>
                    <td style="color:var(--inv-muted)">${minsAgo < 60 ? `من ${minsAgo} دقيقة` : new Date(cart.updated_at).toLocaleString('ar-EG')}</td>
                    <td style="white-space:nowrap">
                        <button class="cc-edit" onclick="corShowCartDetail('${cart.customer_id}')">👁️ عرض</button>
                        <button class="cc-edit" style="background:#DCFCE7;color:#166534;margin-right:4px" onclick="corCompleteCart('${cart.customer_id}')">✅ إكمال الطلب</button>
                    </td>
                </tr>`;
            }).join('')}
        </tbody></table>
    </div>`;
}

function corShowCartDetail(customerId) {
    const cart = COR_CARTS.find(x => x.customer_id === customerId);
    if (!cart) return;
    const items = cart.items || [];
    const total = items.reduce((s, it) => s + (Number(it.qty)||0) * (Number(it.price)||0), 0);
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'corCartModal';
    modal.innerHTML = `
    <div class="mod-modal" style="max-width:520px">
        <div class="mod-modal-header"><h3>🛒 سلة ${cart.customers?.name || ''}</h3>
            <button class="mod-modal-close" onclick="document.getElementById('corCartModal').remove()">&times;</button></div>
        <div class="mod-modal-body">
            <table class="mod-table"><thead><tr>
                <th>الصنف</th><th style="width:70px">الوحدة</th><th style="width:70px">الكمية</th><th style="width:90px">السعر</th><th style="width:100px">الإجمالي</th>
            </tr></thead><tbody>
                ${items.map(it => `<tr>
                    <td>${it.name || '—'}</td>
                    <td style="text-align:center;color:var(--inv-muted)">${it.unit || '—'}</td>
                    <td style="text-align:center">${corFmt(it.qty)}</td>
                    <td>${corFmt(it.price)}</td>
                    <td style="font-weight:700">${corFmt((Number(it.qty)||0)*(Number(it.price)||0))}</td>
                </tr>`).join('') || `<tr><td colspan="5" class="empty-state" style="padding:16px"><span>📭</span>السلة فاضية</td></tr>`}
            </tbody></table>
            <div style="text-align:left;font-weight:800;font-size:15px;margin-top:12px">الإجمالي: ${corFmt(total)} ج.م</div>
        </div>
        <div class="mod-modal-footer">
            <button class="mod-btn" style="background:#F1F5F9;color:var(--inv-text-soft)" onclick="document.getElementById('corCartModal').remove()">إغلاق</button>
            <button class="mod-btn mod-btn-primary" onclick="document.getElementById('corCartModal').remove();corCompleteCart('${customerId}')">✅ إكمال الطلب</button>
        </div>
    </div>`;
    document.body.appendChild(modal);
}
window.corShowCartDetail = corShowCartDetail;

window.corCompleteCart = async function (customerId) {
    const cart = COR_CARTS.find(x => x.customer_id === customerId);
    if (!cart) return;
    const items = cart.items || [];
    if (!items.length) { alert('⚠️ السلة دي فاضية'); return; }
    // ★ نمسح السلة من سلطان دلوقتي عشان الشاشة هنا متفضلش وارية "معلّقة" —
    //   ملحوظة: سلة العميل نفسها على موبايله مش هتتمسح تلقائياً فوراً (البرنامج
    //   عندنا معندوش وسيلة يبعتله تحديث لحظي)، فلو فتح سلطانو تاني هيلاقيها
    //   لسه فيها نفس الأصناف — عادي، مش خطر تكرار حقيقي: سجّلنا هنا توقيت
    //   الإكمال (cart_fulfilled_at)، فلو جهازه حاول يبعت طلب فشل قبل كده
    //   (يدوي أو أوتوماتيك) هيتأكد الأول إن حد مكملهوش من عندنا، ويلغي
    //   المحاولة بدل ما يعمل طلب مكرر — راجع fn_sultano_check_cart_fulfilled.
    try { await sb.rpc('fn_sultano_clear_cart', { p_customer_id: customerId }); } catch {}
    try { await sb.from('customers').update({ cart_fulfilled_at: new Date().toISOString() }).eq('id', customerId); } catch {}
    window._pendingQuoteConversion = {
        kind: 'cart',
        customerId,
        items: items.map(it => ({
            pid: it.product_id, name: it.name || '', code: '',
            qty: Number(it.qty) || 0, price: Number(it.price) || 0, disc: 0, free: 0,
            unit: it.unit || '', stock: 0,
        })),
    };
    loadMod(document.querySelector('[data-mod="sales"]'), 'sales');
};
// القائمة الجانبية — بند 8، تقرير 2026-07-21. نفس فكرة repLinkBadge
// (rep-management.js) بالظبط: عداد واحد بيجمع الطلبات الجديدة +
// طلبات تسجيل عملاء سلطانو المعلّقة من بعد آخر مرة فتحت الصفحة دي،
// ويتصفّر بمجرد الفتح (مش لما الطلب يتحسم). كمان بيعمل poll دوري
// (كل دقيقة ونص) وبيطلق صوت + إشعار متصفح لو العدد زاد عن آخر مرة
// اتفحص، عشان محدش يفوّته وهو شغال في صفحة تانية.
// ════════════════════════════════════════════════════════════
const COR_LINK_LAST_SEEN_KEY = 'sultan_corlink_last_seen';
let _corLastNotifiedCount = 0;

async function corLinkRefreshBadge() {
    try {
        const lastSeen = localStorage.getItem(COR_LINK_LAST_SEEN_KEY) || new Date(Date.now() - 86400000).toISOString();
        const [{ count: newOrders }, { count: newCustReqs }] = await Promise.all([
            sb.from('customer_orders').select('id', { count: 'exact', head: true }).gt('created_at', lastSeen),
            sb.from('customer_change_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending').gt('created_at', lastSeen),
        ]);
        const total = (newOrders || 0) + (newCustReqs || 0);

        const el = document.getElementById('corLinkBadge');
        if (el) {
            if (total > 0) { el.textContent = total; el.style.display = 'inline-block'; }
            else el.style.display = 'none';
        }

        // إشعار وصوت بس لو العدد زاد عن آخر فحص (مش كل poll، وإلا هيتكرر كل دقيقة ونص لنفس الطلبات)
        if (total > _corLastNotifiedCount) {
            corPlayNotifySound();
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                try { new Notification('🔗 حدث جديد في طلبات العملاء', { body: `عندك ${total} حدث جديد (طلبات/تسجيلات سلطانو) محتاج مراجعة`, icon: './icon-192.png' }); } catch (e) {}
            }
        }
        _corLastNotifiedCount = total;
    } catch (err) { /* بهدوء — إشعار جانبي، مش لازم يوقف التطبيق */ }
}

function corPlayNotifySound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 880; gain.gain.value = 0.15;
        osc.start(); osc.stop(ctx.currentTime + 0.18);
    } catch (e) { /* المتصفحات القديمة أو لو الصوت متمنوع */ }
}

function corLinkMarkSeen() {
    localStorage.setItem(COR_LINK_LAST_SEEN_KEY, new Date().toISOString());
    _corLastNotifiedCount = 0;
    const el = document.getElementById('corLinkBadge');
    if (el) el.style.display = 'none';
}

// ★ poll دوري كل 90 ثانية — بيبدأ لما setupApp() يستدعي corLinkStartPolling()
// أول مرة بعد الدخول، مش من غير قصد لو الموديول ده لسه ما اتحمّلش
function corLinkStartPolling() {
    corLinkRefreshBadge();
    setInterval(corLinkRefreshBadge, 90000);
}

Object.assign(window, {
    renderCustomerOrdersLink, corSwitchTab, corApproveOrder, corRejectOrder,
    corOpenBannerModal, corPreviewBannerImage, corSaveBanner, corDeleteBanner,
    corUpdateDeliveryStatus, corLinkRefreshBadge, corLinkMarkSeen, corLinkStartPolling,
});
