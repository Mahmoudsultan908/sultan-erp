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

let _corTab = 'orders'; // 'orders' | 'registrations' | 'banners'
let COR_ORDERS = [];
let COR_BANNERS = [];
let COR_CATS = [];
const COR_IMAGE_BUCKET = 'product-images'; // نفس الباكت العام المستخدم لصور الأصناف

function corFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function renderCustomerOrdersLink(c) {
    c.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div><h2 style="font-size:22px;font-weight:800">🔗 ربط برنامج طلبات العملاء</h2>
        <p style="font-size:13px;color:#64748B;margin-top:4px">طلبات وتسجيلات واردة من "سلطانو" — كل حاجة بتفضل معلّقة لحد ما تراجعها وتعتمدها من هنا</p></div>
    </div>
    <div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap">
        <button class="mod-btn ${_corTab==='orders'?'mod-btn-primary':''}" onclick="corSwitchTab('orders')">📦 طلبات سلطانو</button>
        <button class="mod-btn ${_corTab==='registrations'?'mod-btn-primary':''}" onclick="corSwitchTab('registrations')">👤 تسجيل عملاء سلطانو</button>
        <button class="mod-btn ${_corTab==='banners'?'mod-btn-primary':''}" onclick="corSwitchTab('banners')">🖼️ بانرات سلطانو</button>
    </div>
    <div id="corBody"></div>`;
    await corRenderTab();
}

async function corRenderTab() {
    const body = document.getElementById('corBody');
    if (!body) return;
    if (_corTab === 'orders') await corRenderOrders(body);
    else if (_corTab === 'banners') await corRenderBanners(body);
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
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function corRenderOrdersPage(c) {
    const pending = COR_ORDERS.filter(o => !o.converted_sale_id && o.status !== 'cancelled');
    const reviewed = COR_ORDERS.filter(o => o.converted_sale_id || o.status === 'cancelled').slice(0, 30);

    c.innerHTML = `
    ${pending.length ? `
    <div class="mod-table-wrap" style="margin-bottom:20px">
        <div style="padding:14px 18px 0;font-weight:800;font-size:14px;color:#1E293B">⏳ طلبات في انتظار المراجعة (${pending.length})</div>
        <table class="mod-table"><thead><tr>
            <th>رقم الطلب</th><th>العميل</th><th>الأصناف</th><th>الإجمالي</th><th>ملاحظات</th><th>التاريخ</th><th style="width:190px"></th>
        </tr></thead>
        <tbody>${pending.map(corRowHTML).join('')}</tbody></table>
    </div>` : `<div class="empty-state" style="margin-bottom:20px"><span>✅</span>مفيش طلبات سلطانو معلّقة دلوقتي</div>`}

    ${reviewed.length ? `
    <div class="mod-table-wrap">
        <div style="padding:14px 18px 0;font-weight:800;font-size:14px;color:#1E293B">📋 آخر الطلبات المراجَعة</div>
        <table class="mod-table"><thead><tr>
            <th>رقم الطلب</th><th>العميل</th><th>الإجمالي</th><th>الحالة</th><th>التاريخ</th>
        </tr></thead><tbody>
            ${reviewed.map(o => `<tr>
                <td>${o.order_no || '—'}</td>
                <td>${o.customers?.name || '—'}</td>
                <td>${corFmt(o.total)}</td>
                <td>${o.converted_sale_id ? '<span style="color:#059669;font-weight:700">✅ اتحوّلت لفاتورة</span>' : '<span style="color:#DC2626;font-weight:700">❌ مرفوض</span>'}</td>
                <td style="color:#64748B">${o.created_at ? new Date(o.created_at).toLocaleDateString('ar-EG') : '—'}</td>
            </tr>`).join('')}
        </tbody></table>
    </div>` : ''}`;
}

function corRowHTML(o) {
    const items = o.customer_order_items || [];
    const itemsSummary = items.map(it => `${it.products?.name || '—'} × ${corFmt(it.qty)}`).join('، ');
    return `<tr data-cor-id="${o.id}">
        <td>${o.order_no || '—'}</td>
        <td>${o.customers?.name || '—'}<div style="font-size:11px;color:#64748B" dir="ltr">${o.customers?.phone || ''}</div></td>
        <td style="font-size:12px;max-width:260px">${itemsSummary || '—'}</td>
        <td>${corFmt(o.total)}</td>
        <td style="font-size:12px;color:#64748B">${o.notes || '—'}</td>
        <td style="color:#64748B">${o.created_at ? new Date(o.created_at).toLocaleString('ar-EG') : '—'}</td>
        <td style="white-space:nowrap">
            <button class="cc-edit" style="background:#DCFCE7;color:#166534" onclick="corApproveOrder('${o.id}')">✅ اعتماد/مراجعة</button>
            <button class="cc-edit" style="background:#FEE2E2;color:#991B1B;margin-right:4px" onclick="corRejectOrder('${o.id}')">❌ رفض</button>
        </td>
    </tr>`;
}

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
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
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
            <th style="width:70px">الصورة</th><th>العنوان</th><th>مرتبط بـ</th><th>الترتيب</th><th>الحالة</th><th style="width:150px"></th>
        </tr></thead><tbody>
            ${COR_BANNERS.map(b => `<tr>
                <td>${b.image_url ? `<img src="${b.image_url}" style="width:50px;height:36px;object-fit:cover;border-radius:6px">` : '—'}</td>
                <td>${b.title}</td>
                <td style="font-size:12px;color:#64748B">${b.link_type==='category' ? (COR_CATS.find(x=>x.id===b.link_value)?.name || 'قسم محذوف') : '—'}</td>
                <td>${b.display_order}</td>
                <td>${b.is_active ? '<span style="color:#059669;font-weight:700">✅ فعّال</span>' : '<span style="color:#94A3B8">⏸️ متوقف</span>'}</td>
                <td style="white-space:nowrap">
                    <button class="cc-edit" onclick="corOpenBannerModal('${b.id}')">✏️</button>
                    <button class="cc-edit" style="background:#FEE2E2;color:#991B1B;margin-right:4px" onclick="corDeleteBanner('${b.id}')">🗑️</button>
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
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="document.getElementById('corBannerModal').remove()">إلغاء</button>
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
            const { error } = await sb.from('banners').insert({ ...payload, created_by: currentUser?.id || null });
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

Object.assign(window, {
    renderCustomerOrdersLink, corSwitchTab, corApproveOrder, corRejectOrder,
    corOpenBannerModal, corPreviewBannerImage, corSaveBanner, corDeleteBanner,
});
