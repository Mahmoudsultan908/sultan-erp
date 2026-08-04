/* ════════════════════════════════════════════════════════════
   مراجعة طلبات عملاء المندوبين — customer_change_requests
   يصدّر: renderRepCustomerRequests(container)

   العميل الجديد اللي المندوب بيضيفه من سلطانو بيتسجّل فورًا فى
   customers عشان يقدر يبيعله فى نفس اللحظة (مفيش تعطيل)، وتعديلات
   عميل موجود بتتحفظ عنده محليًا فورًا برضه — لكن الاتنين بيتحطوا هنا
   كطلب "pending" بدل ما يتطبقوا على الجدول الحقيقي مباشرة، عشان الأدمن
   يراجع/يصحح الاسم والتليفون قبل ما يُعتمدوا نهائيًا.
   ════════════════════════════════════════════════════════════ */

let RCR_LIST = [];
let RCR_GROUPS = [];
let RCR_REGIONS = [];

function rcrFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function renderRepCustomerRequests(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل الطلبات...</div>';
    try {
        const [{ data, error }, { data: groups }, { data: regions }] = await Promise.all([
            sb.from('customer_change_requests')
                .select('*, rep:rep_id(name), customer:customer_id(name,phone,address,balance,group_id,region_id)')
                .order('created_at', { ascending: false })
                .limit(100),
            sb.from('customer_groups').select('*, price_levels(name)').order('name'),
            sb.from('customer_regions').select('*').order('name'),
        ]);
        if (error) throw error;
        RCR_LIST = data || [];
        RCR_GROUPS = groups || [];
        RCR_REGIONS = regions || [];
        rcrRenderPage(c);
    } catch (err) {
        c.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function rcrRenderPage(c) {
    const pending = RCR_LIST.filter(r => r.status === 'pending');
    const reviewed = RCR_LIST.filter(r => r.status !== 'pending').slice(0, 30);

    c.innerHTML = `
    <div style="margin-bottom:16px">
        <div style="font-size:13px;color:var(--inv-muted)">عملاء جدد أو تعديلات أضافها المندوبون من تطبيق سلطانو — راجع الاسم والتليفون وعدّلهم لو محتاجين تصحيح قبل الاعتماد.</div>
    </div>
    ${pending.length ? `
    <div class="mod-table-wrap" style="margin-bottom:20px">
        <div style="padding:14px 18px 0;font-weight:800;font-size:14px;color:var(--inv-navy)">⏳ طلبات في انتظار المراجعة (${pending.length})</div>
        <table class="mod-table"><thead><tr>
            <th style="width:70px">النوع</th><th>المندوب</th><th>الاسم</th><th>التليفون</th><th>العنوان</th><th>المنطقة</th><th>المجموعة (مستوى البيع)</th><th>معلومات إضافية</th><th style="width:170px"></th>
        </tr></thead>
        <tbody id="rcrPendingBody">
            ${pending.map(rcrRowHTML).join('')}
        </tbody></table>
    </div>` : `<div class="empty-state" style="margin-bottom:20px"><span>✅</span>مفيش طلبات معلّقة دلوقتي</div>`}

    ${reviewed.length ? `
    <div class="mod-table-wrap">
        <div style="padding:14px 18px 0;font-weight:800;font-size:14px;color:var(--inv-navy)">📋 آخر الطلبات المراجَعة</div>
        <table class="mod-table"><thead><tr>
            <th style="width:70px">النوع</th><th>المندوب</th><th>الاسم المقترح</th><th style="width:130px">التليفون</th><th>المنطقة</th><th>المجموعة</th><th>الحالة</th><th>التاريخ</th>
        </tr></thead><tbody>
            ${reviewed.map(r => {
                const grp = RCR_GROUPS.find(g => g.id === r.customer?.group_id);
                const rgn = RCR_REGIONS.find(rg => rg.id === r.customer?.region_id);
                return `<tr>
                <td>${r.request_type==='new'?'🆕 جديد':'✏️ تعديل'}</td>
                <td>${r.source==='sultano' ? '🌐 سلطانو' : '🚗 '+(r.rep?.name||'—')}</td>
                <td>${r.proposed_name||'—'}</td>
                <td style="text-align:center;color:var(--inv-muted)"><span dir="ltr">${r.proposed_phone||'—'}</span></td>
                <td style="color:var(--inv-muted);font-size:12px">${rgn?.name || '—'}</td>
                <td style="color:var(--inv-muted);font-size:12px">${grp ? grp.name + (grp.price_levels?.name ? ' — ' + grp.price_levels.name : '') : '—'}</td>
                <td>${r.status==='approved'?'<span style="color:var(--inv-green);font-weight:700">✅ معتمد</span>':'<span style="color:var(--inv-red);font-weight:700">❌ مرفوض</span>'}</td>
                <td style="color:var(--inv-muted)">${r.created_at?new Date(r.created_at).toLocaleDateString('ar-EG'):'—'}</td>
            </tr>`;
            }).join('')}
        </tbody></table>
    </div>` : ''}`;
}

function rcrRowHTML(r) {
    const cur = r.customer;
    const isNew = r.request_type === 'new';
    return `<tr data-rcr-id="${r.id}">
        <td>${isNew ? '🆕 جديد' : '✏️ تعديل'}</td>
        <td>${r.source==='sultano' ? '🌐 سلطانو' : '🚗 '+(r.rep?.name || '—')}</td>
        <td><input type="text" class="mod-form-input" id="rcrName-${r.id}" value="${(r.proposed_name||'').replace(/"/g,'&quot;')}" style="min-width:140px"></td>
        <td><input type="text" class="mod-form-input" id="rcrPhone-${r.id}" value="${(r.proposed_phone||'').replace(/"/g,'&quot;')}" dir="ltr" style="min-width:120px"></td>
        <td><input type="text" class="mod-form-input" id="rcrAddr-${r.id}" value="${(r.proposed_address||'').replace(/"/g,'&quot;')}" style="min-width:140px"></td>
        <td><select id="rcrRegion-${r.id}" class="mod-form-input" style="min-width:130px">
            <option value="">بدون منطقة</option>
            ${RCR_REGIONS.map(rg => `<option value="${rg.id}" ${cur?.region_id === rg.id ? 'selected' : ''}>${rg.name}</option>`).join('')}
        </select></td>
        <td><select id="rcrGroup-${r.id}" class="mod-form-input" style="min-width:150px">
            <option value="">بدون مجموعة</option>
            ${RCR_GROUPS.map(g => `<option value="${g.id}" ${cur?.group_id === g.id ? 'selected' : ''}>${g.name}${g.price_levels?.name ? ' — ' + g.price_levels.name : ''}</option>`).join('')}
        </select></td>
        <td style="font-size:12px;color:var(--inv-muted)">${isNew ? 'عميل جديد — مسجّل بالفعل وباع له المندوب' : `الحالي: ${cur?.name||'—'} / ${cur?.phone||'—'}${cur?cur.balance>0?` (رصيد ${rcrFmt(cur.balance)})`:'':''}`}</td>
        <td style="white-space:nowrap">
            <button class="cc-edit" style="background:#DCFCE7;color:#166534" onclick="rcrApprove('${r.id}')">✅ اعتماد</button>
            <button class="cc-edit" style="background:var(--inv-red-bg);color:var(--inv-red);margin-right:4px" onclick="rcrReject('${r.id}')">❌ رفض</button>
        </td>
    </tr>`;
}

window.rcrApprove = async function (id) {
    const r = RCR_LIST.find(x => x.id === id);
    if (!r) return;
    const name = document.getElementById('rcrName-' + id)?.value.trim();
    const phone = document.getElementById('rcrPhone-' + id)?.value.trim() || null;
    const address = document.getElementById('rcrAddr-' + id)?.value.trim() || null;
    const groupId = document.getElementById('rcrGroup-' + id)?.value || null;
    const regionId = document.getElementById('rcrRegion-' + id)?.value || null;
    if (!name) return alert('اسم العميل مطلوب');

    try {
        // العميل (جديد أو موجود) بيتحدّث بالقيم المعتمدة — لو الأدمن صحّح حاجة هنا بتترحّل على الجدول الحقيقي
        const { error: custErr } = await sb.from('customers').update({
            name, phone, address, group_id: groupId, region_id: regionId,
        }).eq('id', r.customer_id);
        if (custErr) throw custErr;

        const { error } = await sb.from('customer_change_requests').update({
            status: 'approved', reviewed_by: currentUser?.id || null, reviewed_at: new Date().toISOString(),
        }).eq('id', id);
        if (error) throw error;

        renderRepCustomerRequests(document.getElementById('repMgmtBody') || document.getElementById('corBody') || document.getElementById('app-content'));
    } catch (err) {
        alert('خطأ أثناء الاعتماد: ' + err.message);
    }
};

window.rcrReject = async function (id) {
    if (!confirm('رفض الطلب ده؟ بيانات العميل مش هتتغيّر.')) return;
    try {
        const { error } = await sb.from('customer_change_requests').update({
            status: 'rejected', reviewed_by: currentUser?.id || null, reviewed_at: new Date().toISOString(),
        }).eq('id', id);
        if (error) throw error;
        renderRepCustomerRequests(document.getElementById('repMgmtBody') || document.getElementById('corBody') || document.getElementById('app-content'));
    } catch (err) {
        alert('خطأ أثناء الرفض: ' + err.message);
    }
};

Object.assign(window, { renderRepCustomerRequests, rcrApprove, rcrReject });
