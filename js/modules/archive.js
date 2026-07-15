/* ════════════════════════════════════════════════════════════
   الأرشيف — أرشفة مستندات (فواتير ورقية، عقود، صور هوية...)
   archive.js
   يصدّر: renderArchive(container)
   الملفات بتتخزن في Supabase Storage (باكت "archive-documents"،
   Public) — الجدول archive_documents بيحفظ بس البيانات الوصفية
   + رابط الملف. راجع archive_documents_migration.sql.
   ════════════════════════════════════════════════════════════ */

const ARC_BUCKET = 'archive-documents';

let _arcList = [];
let _arcCustomers = [];
let _arcSuppliers = [];
let _arcSearch = '';
let _arcFilterType = '';
let _arcTableMissing = false;

function arcFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// ════════════════════════════════════════════════════════════
// 1) القائمة الرئيسية
// ════════════════════════════════════════════════════════════
async function renderArchive(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل الأرشيف...</div>';
    _arcTableMissing = false;
    try {
        try {
            const { data, error } = await sb.from('archive_documents').select('*').order('created_at', { ascending: false });
            if (error) throw error;
            _arcList = data || [];
        } catch (e) {
            _arcTableMissing = true;
            _arcList = [];
        }

        const [{ data: customers }, { data: suppliers }] = await Promise.all([
            sb.from('customers').select('id,name').order('name'),
            sb.from('suppliers').select('id,name').order('name'),
        ]);
        _arcCustomers = customers || [];
        _arcSuppliers = suppliers || [];

        arcRenderPage(c);
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function arcLinkedLabel(doc) {
    if (doc.linked_type === 'customer') return '👤 ' + (_arcCustomers.find(x => x.id === doc.linked_id)?.name || 'عميل محذوف');
    if (doc.linked_type === 'supplier') return '🏭 ' + (_arcSuppliers.find(x => x.id === doc.linked_id)?.name || 'مورد محذوف');
    return '📁 عام';
}

function arcFilteredList() {
    const q = _arcSearch.trim().toLowerCase();
    return _arcList.filter(d => {
        if (_arcFilterType && d.linked_type !== _arcFilterType) return false;
        if (!q) return true;
        return (d.title || '').toLowerCase().includes(q) || (d.category || '').toLowerCase().includes(q);
    });
}

function arcRenderPage(c) {
    const list = arcFilteredList();
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px">
            <div><h2 style="font-size:22px;font-weight:800">🗄️ الأرشيف</h2>
            <p style="font-size:13px;color:#64748B;margin-top:4px">أرشفة المستندات (فواتير ورقية، عقود، صور هوية...)</p></div>
            <button class="mod-btn mod-btn-primary" onclick="arcOpenUpload()">+ رفع مستند</button>
        </div>

        ${_arcTableMissing ? `<div style="background:#FEF3C7;color:#92400E;padding:14px 18px;border-radius:10px;margin-bottom:16px;font-size:13px">⚠️ جدول الأرشيف لسه مش موجود — شغّل <code>archive_documents_migration.sql</code> في Supabase (وتأكد إنك عملت باكت Storage اسمه <code>archive-documents</code>).</div>` : ''}

        <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
            <input type="text" id="arcSearchInput" class="mod-form-input" style="max-width:280px" placeholder="🔍 بحث بالعنوان/التصنيف..." value="${_arcSearch}" oninput="arcOnSearch(this.value)">
            <select id="arcFilterType" class="mod-form-input" style="max-width:180px" onchange="arcOnFilterType(this.value)">
                <option value="" ${!_arcFilterType?'selected':''}>كل الأنواع</option>
                <option value="general" ${_arcFilterType==='general'?'selected':''}>📁 عام</option>
                <option value="customer" ${_arcFilterType==='customer'?'selected':''}>👤 عملاء</option>
                <option value="supplier" ${_arcFilterType==='supplier'?'selected':''}>🏭 موردين</option>
            </select>
        </div>

        <div class="mod-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px">
            ${list.length === 0 ? `<div class="empty-state" style="grid-column:1/-1"><span>🗄️</span>لا توجد مستندات مطابقة.</div>` :
            list.map(d => `<div class="mod-card" style="padding:14px">
                <div style="font-size:28px;margin-bottom:8px">${arcFileIcon(d.file_type)}</div>
                <div style="font-weight:700;font-size:13.5px;margin-bottom:4px;word-break:break-word">${d.title}</div>
                <div style="font-size:11.5px;color:#64748B;margin-bottom:6px">${arcLinkedLabel(d)}${d.category?' · '+d.category:''}</div>
                <div style="font-size:11px;color:#94A3B8;margin-bottom:10px">${new Date(d.created_at).toLocaleDateString('ar-EG')}</div>
                <div style="display:flex;gap:6px">
                    <a href="${d.file_url}" target="_blank" rel="noopener" class="cc-edit" style="background:#FFFBEB;color:#D97706;text-decoration:none;flex:1;text-align:center">👁️ فتح</a>
                    <button class="cc-edit" style="background:#FEE2E2;color:#DC2626" onclick="arcDelete('${d.id}')">🗑️</button>
                </div>
            </div>`).join('')}
        </div>`;
}

function arcFileIcon(type) {
    const t = (type || '').toLowerCase();
    if (t.includes('pdf')) return '📕';
    if (t.includes('image') || ['jpg','jpeg','png','gif','webp'].some(x => t.includes(x))) return '🖼️';
    if (t.includes('word') || t.includes('doc')) return '📘';
    if (t.includes('sheet') || t.includes('excel') || t.includes('xls')) return '📗';
    return '📄';
}

window.arcOnSearch = function (val) { _arcSearch = val; arcRenderPage(document.getElementById('app-content')); document.getElementById('arcSearchInput')?.focus(); };
window.arcOnFilterType = function (val) { _arcFilterType = val; arcRenderPage(document.getElementById('app-content')); };

window.arcDelete = async function (id) {
    const doc = _arcList.find(x => x.id === id);
    if (!doc) return;
    if (!confirm(`حذف "${doc.title}" نهائياً؟ الملف نفسه هيتشال من التخزين برضو.`)) return;
    try {
        await sb.storage.from(ARC_BUCKET).remove([doc.file_path]);
        const { error } = await sb.from('archive_documents').delete().eq('id', id);
        if (error) throw error;
        renderArchive(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ أثناء الحذف: ' + err.message);
    }
};

// ════════════════════════════════════════════════════════════
// 2) رفع مستند جديد
// ════════════════════════════════════════════════════════════
let _arcUploadLinkType = 'general';
let _arcUploadLinkId = null;

window.arcOpenUpload = function () {
    _arcUploadLinkType = 'general';
    _arcUploadLinkId = null;
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'arcModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:480px">
            <div class="mod-modal-header"><h3>📤 رفع مستند جديد</h3>
                <button class="mod-modal-close" onclick="document.getElementById('arcModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>العنوان *</label>
                    <input type="text" id="arcTitle" class="mod-form-input" placeholder="مثال: عقد إيجار المخزن الرئيسي"></div>
                <div class="mod-form-group"><label>الملف *</label>
                    <input type="file" id="arcFile" class="mod-form-input"></div>
                <div class="mod-form-group"><label>التصنيف</label>
                    <input type="text" id="arcCategory" class="mod-form-input" placeholder="مثال: عقد / فاتورة / هوية (اختياري)" list="arcCategoryList">
                    <datalist id="arcCategoryList">
                        <option value="فاتورة"><option value="عقد"><option value="هوية"><option value="إيصال"><option value="أخرى">
                    </datalist></div>
                <div class="mod-form-group"><label>مرتبط بـ</label>
                    <select id="arcLinkType" class="mod-form-input" onchange="arcOnLinkTypeChange(this.value)">
                        <option value="general">📁 عام (مش مرتبط بحد)</option>
                        <option value="customer">👤 عميل</option>
                        <option value="supplier">🏭 مورد</option>
                    </select></div>
                <div id="arcLinkEntityWrap" style="display:none">
                    <div class="mod-form-group">
                        <div style="position:relative">
                            <input type="text" id="arcLinkSearch" class="mod-form-input" placeholder="🔍 اكتب اسم..." autocomplete="off"
                                oninput="arcLinkSearchInput()" onfocus="arcLinkSearchInput()"
                                onblur="setTimeout(()=>{const ac=document.getElementById('arcLinkAC'); if(ac) ac.classList.remove('show');},150)">
                            <div class="inv-ac" id="arcLinkAC"></div>
                        </div>
                    </div>
                </div>
                <div class="mod-form-group"><label>ملاحظات</label>
                    <input type="text" id="arcNotes" class="mod-form-input" placeholder="اختياري"></div>
                <div id="arcUploadProgress" style="font-size:12px;color:#64748B"></div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="document.getElementById('arcModal').remove()">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="arcSaveUpload()">📤 رفع وحفظ</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    setTimeout(() => document.getElementById('arcTitle')?.focus(), 50);
};

window.arcOnLinkTypeChange = function (val) {
    _arcUploadLinkType = val;
    _arcUploadLinkId = null;
    const wrap = document.getElementById('arcLinkEntityWrap');
    const search = document.getElementById('arcLinkSearch');
    if (search) search.value = '';
    if (wrap) wrap.style.display = val === 'general' ? 'none' : 'block';
};

window.arcLinkSearchInput = function () {
    const ac = document.getElementById('arcLinkAC');
    if (!ac) return;
    const term = (document.getElementById('arcLinkSearch')?.value || '').trim().toLowerCase();
    const source = _arcUploadLinkType === 'customer' ? _arcCustomers : _arcUploadLinkType === 'supplier' ? _arcSuppliers : [];
    const list = (term ? source.filter(x => (x.name || '').toLowerCase().includes(term)) : source).slice(0, 20);
    if (!list.length) {
        ac.innerHTML = `<div class="inv-ac-item" style="cursor:default;color:#94A3B8">لا يوجد نتائج مطابقة</div>`;
        ac.classList.add('show');
        return;
    }
    ac.innerHTML = list.map(x => `<div class="inv-ac-item" onmousedown="event.preventDefault();arcPickLinkEntity('${x.id}','${(x.name||'').replace(/'/g,"\\'")}')">
        <div><div class="an">${x.name}</div></div>
    </div>`).join('');
    ac.classList.add('show');
};
window.arcPickLinkEntity = function (id, name) {
    _arcUploadLinkId = id;
    const search = document.getElementById('arcLinkSearch');
    if (search) search.value = name;
    const ac = document.getElementById('arcLinkAC');
    if (ac) { ac.innerHTML = ''; ac.classList.remove('show'); }
};

window.arcSaveUpload = async function () {
    const title = document.getElementById('arcTitle').value.trim();
    const fileInput = document.getElementById('arcFile');
    const file = fileInput.files[0];
    const category = document.getElementById('arcCategory').value.trim() || null;
    const notes = document.getElementById('arcNotes').value.trim() || null;

    if (!title) return alert('العنوان مطلوب');
    if (!file) return alert('اختر ملفاً');
    if (_arcUploadLinkType !== 'general' && !_arcUploadLinkId) return alert('اختر العميل/المورد المرتبط بالمستند');

    const btn = document.querySelector('#arcModal .mod-btn-primary');
    const progress = document.getElementById('arcUploadProgress');
    btn.innerText = '⏳ جاري الرفع...'; btn.disabled = true;
    if (progress) progress.textContent = 'بيترفع الملف...';

    try {
        const safeName = file.name.replace(/[^\w.\-]+/g, '_');
        const path = `${Date.now()}_${safeName}`;
        const { error: upErr } = await sb.storage.from(ARC_BUCKET).upload(path, file);
        if (upErr) throw upErr;

        const { data: pub } = sb.storage.from(ARC_BUCKET).getPublicUrl(path);
        const fileExt = (file.name.split('.').pop() || '').toLowerCase();

        const { error } = await sb.from('archive_documents').insert({
            title, file_path: path, file_url: pub.publicUrl, file_type: file.type || fileExt,
            category, linked_type: _arcUploadLinkType, linked_id: _arcUploadLinkId, notes,
            uploaded_by: currentUser?.id || null,
        });
        if (error) throw error;

        document.getElementById('arcModal').remove();
        renderArchive(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ: ' + err.message + (_arcTableMissing ? '\n\nتأكد من تشغيل archive_documents_migration.sql وعمل باكت Storage اسمه archive-documents.' : ''));
        btn.innerText = '📤 رفع وحفظ'; btn.disabled = false;
        if (progress) progress.textContent = '';
    }
};

Object.assign(window, {
    renderArchive, arcOnSearch, arcOnFilterType, arcDelete, arcOpenUpload,
    arcOnLinkTypeChange, arcLinkSearchInput, arcPickLinkEntity, arcSaveUpload,
});
