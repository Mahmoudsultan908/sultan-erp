// ════════════════════════════════════════════════════════════
// landed-cost.js — تكلفة الشحن والمصاريف على فواتير الشراء
// يصدّر: renderLandedCost
//
// تكلفة إضافية (شحن / جمارك / تحميل / تأمين / أخرى) على فاتورة شراء مؤكدة، بتتوزّع على أصنافها بالقيمة أو بالكمية.
// القيد: مدين المخزون ← دائن الخزنة (لو اتدفعت نقدي) أو دائن المورد (لو المورد هو اللي حاسبك عليها). الإلغاء بيعمل قيد عكسي.
// سعر الشراء الأساسي للصنف مبيتغيّرش لوحده أبداً — زرار "تحديث سعر الشراء بالتكلفة الفعلية" قرار منك.
// الميزة مقفولة لحد ما الأدمن يفعّلها (feature_landed_cost).
// ════════════════════════════════════════════════════════════

let _lcPurchases = [], _lcTreasuries = [], _lcCurrent = null;
const LC_KINDS = { freight: 'شحن', customs: 'جمارك', handling: 'تحميل / تفريغ', insurance: 'تأمين', other: 'أخرى' };

function lcEsc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function lcFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function renderLandedCost(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري التحميل...</div>';
    try {
        if (typeof ftOn === 'function' && !(await ftOn('feature_landed_cost'))) {
            c.innerHTML = `<div class="dash-card" style="padding:28px;text-align:center"><div style="font-size:34px">🚚</div>
                <h3 style="margin:10px 0 6px">ميزة تكلفة الشحن مقفولة</h3>
                <p style="font-size:13px;color:var(--inv-muted)">الأدمن يقدر يفعّلها من الإعدادات ← المميزات الإضافية.</p></div>`;
            return;
        }
        const [pu, tr, lc] = await Promise.all([
            sb.from('purchases').select('id, invoice_no, total, created_at, suppliers(name)').eq('status', 'confirmed').order('created_at', { ascending: false }).limit(150),
            sb.from('treasuries').select('id,name,kind').eq('is_active', true).order('name'),
            sb.from('purchase_landed_costs').select('purchase_id, amount').eq('status', 'confirmed'),
        ]);
        if (pu.error) throw pu.error;
        const sums = {}; (lc.data || []).forEach(r => { sums[r.purchase_id] = (sums[r.purchase_id] || 0) + Number(r.amount); });
        _lcPurchases = (pu.data || []).map(p => ({ ...p, lcTotal: sums[p.id] || 0 }));
        _lcTreasuries = tr.data || [];
        c.innerHTML = `
        <div style="margin-bottom:16px"><h2 style="font-size:22px;font-weight:800">🚚 تكلفة الشحن والمصاريف على المشتريات</h2>
        <p style="font-size:13px;color:var(--inv-muted);margin-top:4px">اختار فاتورة شراء وضيف عليها شحن أو جمارك أو أي تكلفة، وهتتوزّع على الأصناف وتشوف التكلفة الفعلية للوحدة.</p></div>
        <div class="mod-table-wrap"><table class="mod-table"><thead><tr><th>الفاتورة</th><th>التاريخ</th><th>المورد</th><th style="text-align:left">إجمالي الفاتورة</th><th style="text-align:left">تكاليف إضافية</th><th></th></tr></thead><tbody>
        ${_lcPurchases.length ? _lcPurchases.map(p => `<tr>
            <td dir="ltr" style="text-align:right"><b>${lcEsc(p.invoice_no)}</b></td><td>${lcEsc(String(p.created_at).slice(0, 10))}</td>
            <td>${lcEsc(p.suppliers?.name || '—')}</td><td style="text-align:left">${lcFmt(p.total)}</td>
            <td style="text-align:left;font-weight:700">${p.lcTotal ? lcFmt(p.lcTotal) : '—'}</td>
            <td><button class="cc-edit" onclick="lcOpen('${p.id}')">🚚 تفاصيل / إضافة</button></td></tr>`).join('')
            : '<tr><td colspan="6" class="empty-state"><span>📥</span>مفيش فواتير شراء</td></tr>'}
        </tbody></table></div>`;
    } catch (err) {
        c.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:20px;border-radius:12px">خطأ: ${lcEsc(err.message)}</div>`;
    }
}

window.lcCloseModal = function () { document.getElementById('lcModal')?.remove(); };

window.lcOpen = async function (purchaseId) {
    try {
        const [eff, costs] = await Promise.all([
            sb.rpc('fn_purchase_effective_cost', { p_purchase_id: purchaseId }),
            sb.from('purchase_landed_costs').select('*, treasuries(name)').eq('purchase_id', purchaseId).order('created_at'),
        ]);
        if (eff.error) throw eff.error;
        _lcCurrent = { id: purchaseId, rows: eff.data || [], costs: costs.data || [] };
        const p = _lcPurchases.find(x => x.id === purchaseId);
        lcCloseModal();
        const m = document.createElement('div');
        m.className = 'mod-modal-bg active'; m.id = 'lcModal';
        const active = _lcCurrent.costs.filter(x => x.status === 'confirmed');
        m.innerHTML = `<div class="mod-modal" style="max-width:920px"><div class="mod-modal-header"><h3>🚚 فاتورة ${lcEsc(p?.invoice_no || '')} — ${lcEsc(p?.suppliers?.name || '')}</h3><button class="mod-modal-close" onclick="lcCloseModal()">&times;</button></div>
        <div class="mod-modal-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b>التكاليف المسجّلة</b><button class="mod-btn mod-btn-primary" onclick="lcOpenAdd()">+ إضافة تكلفة</button></div>
        <div class="mod-table-wrap"><table class="mod-table"><thead><tr><th>النوع</th><th>التاريخ</th><th>التوزيع</th><th>اتدفعت</th><th style="text-align:left">المبلغ</th><th></th></tr></thead><tbody>
        ${_lcCurrent.costs.length ? _lcCurrent.costs.map(x => `<tr style="${x.status === 'cancelled' ? 'opacity:.5' : ''}">
            <td>${LC_KINDS[x.kind] || x.kind}${x.notes ? `<br><small style="color:var(--inv-muted)">${lcEsc(x.notes)}</small>` : ''}${x.status === 'cancelled' ? ' <span style="color:var(--inv-red);font-size:11px">ملغي</span>' : ''}</td>
            <td>${lcEsc(String(x.created_at).slice(0, 10))}</td><td>${x.method === 'value' ? 'بالقيمة' : 'بالكمية'}</td>
            <td>${x.paid_via === 'supplier' ? 'على حساب المورد' : '💵 ' + lcEsc(x.treasuries?.name || 'خزنة')}</td>
            <td style="text-align:left;font-weight:700">${lcFmt(x.amount)}</td>
            <td>${x.status === 'confirmed' ? `<button class="cc-edit" title="إلغاء" onclick="lcCancel('${x.id}')">🗑️</button>` : ''}</td></tr>`).join('')
            : '<tr><td colspan="6" class="empty-state">لسه مفيش تكاليف على الفاتورة دي</td></tr>'}
        </tbody></table></div>
        <div style="margin:16px 0 8px"><b>التكلفة الفعلية للأصناف</b> <span style="font-size:12px;color:var(--inv-muted)">(سعر الفاتورة + نصيب الصنف من التكاليف ÷ الكمية)</span></div>
        <div class="mod-table-wrap"><table class="mod-table"><thead><tr><th>الصنف</th><th>الكمية</th><th>سعر الفاتورة</th><th>نصيبه من التكاليف</th><th>التكلفة الفعلية للوحدة</th><th>سعر الشراء الحالي</th></tr></thead><tbody>
        ${_lcCurrent.rows.map(r => `<tr><td>${lcEsc(r.product_name)}</td><td>${lcFmt(r.qty)}</td><td>${lcFmt(r.unit_price)}</td><td>${Number(r.allocated) ? lcFmt(r.allocated) : '—'}</td>
            <td style="font-weight:700;${Number(r.allocated) ? 'color:#B45309' : ''}">${lcFmt(r.effective_unit_cost)}</td><td>${lcFmt(r.master_price)}</td></tr>`).join('')}
        </tbody></table></div>
        ${active.length ? `<div style="margin-top:12px"><button class="mod-btn" style="background:var(--inv-gold-bg);color:var(--inv-gold)" onclick="lcApplyPrices()">⬆️ تحديث سعر الشراء بالتكلفة الفعلية</button>
        <div style="font-size:11px;color:var(--inv-muted);margin-top:4px">بيغيّر سعر الشراء الأساسي للأصناف اللي الفاتورة دي هي آخر فاتورة شراء ليها بس. مفيش رجوع تلقائي — لو عايز ترجّعه عدّله من كارت الصنف.</div></div>` : ''}
        <p style="font-size:11px;color:var(--inv-muted);margin-top:10px">ملحوظة: بضاعة اتباعت قبل تسجيل التكلفة مبتتعدّلش تكلفتها، والفرق بيفضل في قيمة المخزون.</p>
        </div></div>`;
        document.body.appendChild(m);
    } catch (err) { alert('❌ ' + err.message); }
};

window.lcOpenAdd = function () {
    document.getElementById('lcAddModal')?.remove();
    const m = document.createElement('div');
    m.className = 'mod-modal-bg active'; m.id = 'lcAddModal'; m.style.zIndex = 10001;
    m.innerHTML = `<div class="mod-modal" style="max-width:460px"><div class="mod-modal-header"><h3>+ تكلفة إضافية</h3><button class="mod-modal-close" onclick="document.getElementById('lcAddModal').remove()">&times;</button></div>
        <div class="mod-modal-body">
        <div class="mod-form-group"><label>النوع</label><select id="lcKind" class="mod-form-input">${Object.entries(LC_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="mod-form-group"><label>المبلغ *</label><input id="lcAmt" type="number" min="0" step="0.01" class="mod-form-input"></div>
        <div class="mod-form-group"><label>التوزيع على الأصناف</label><select id="lcMethod" class="mod-form-input"><option value="value">بالقيمة (الصنف الأغلى ياخد نصيب أكبر)</option><option value="qty">بالكمية (كل وحدة نفس النصيب)</option></select></div>
        <div class="mod-form-group"><label>اتدفعت إزاي؟</label><select id="lcPaid" class="mod-form-input" onchange="document.getElementById('lcTrWrap').style.display=this.value==='treasury'?'block':'none'">
            <option value="treasury">💵 من خزنة / بنك (دفعتها لشركة الشحن)</option><option value="supplier">على حساب المورد (هو حاسبني عليها)</option></select></div>
        <div class="mod-form-group" id="lcTrWrap"><label>الخزنة *</label><select id="lcTr" class="mod-form-input">${_lcTreasuries.map(t => `<option value="${t.id}">${t.kind === 'bank' ? '🏦 ' : '💵 '}${lcEsc(t.name)}</option>`).join('')}</select></div>
        <div class="mod-form-group"><label>ملاحظات</label><input id="lcNotes" class="mod-form-input"></div>
        </div>
        <div class="mod-modal-footer"><button class="mod-btn" style="background:#F1F5F9;color:var(--inv-text-soft)" onclick="document.getElementById('lcAddModal').remove()">إلغاء</button>
        <button class="mod-btn mod-btn-primary" onclick="lcSave()">💾 حفظ</button></div></div>`;
    document.body.appendChild(m);
};

window.lcSave = async function () {
    const g = id => document.getElementById(id)?.value;
    const amt = parseFloat(g('lcAmt')) || 0;
    if (amt <= 0) { alert('اكتب مبلغ أكبر من صفر'); return; }
    if (!confirm(`تسجيل ${LC_KINDS[g('lcKind')]} بمبلغ ${lcFmt(amt)}؟ هيتعمل قيد محاسبي ${g('lcPaid') === 'treasury' ? 'وهيتخصم من الخزنة' : 'وهيزيد رصيد المورد'}.`)) return;
    const btn = document.querySelector('#lcAddModal .mod-btn-primary'); btn.disabled = true;
    try {
        const { error } = await sb.rpc('fn_add_landed_cost', {
            p_purchase_id: _lcCurrent.id, p_kind: g('lcKind'), p_amount: amt, p_method: g('lcMethod'), p_paid_via: g('lcPaid'),
            p_treasury_id: g('lcPaid') === 'treasury' ? g('lcTr') : null, p_notes: (g('lcNotes') || '').trim() || null,
        });
        if (error) throw error;
        document.getElementById('lcAddModal')?.remove();
        const id = _lcCurrent.id; await renderLandedCost(document.getElementById('app-content')); await lcOpen(id);
    } catch (err) { alert('❌ ' + err.message); btn.disabled = false; }
};

window.lcCancel = async function (id) {
    if (!confirm('إلغاء التكلفة دي؟ هيتعمل قيد عكسي ويرجع الرصيد/الخزنة.')) return;
    try {
        const { error } = await sb.rpc('fn_cancel_landed_cost', { p_id: id });
        if (error) throw error;
        const pid = _lcCurrent.id; await renderLandedCost(document.getElementById('app-content')); await lcOpen(pid);
    } catch (err) { alert('❌ ' + err.message); }
};

window.lcApplyPrices = async function () {
    if (!confirm('تحديث سعر الشراء الأساسي للأصناف بالتكلفة الفعلية؟ (للأصناف اللي الفاتورة دي هي آخر فاتورة شراء ليها)')) return;
    try {
        const { data, error } = await sb.rpc('fn_landed_cost_apply_prices', { p_purchase_id: _lcCurrent.id });
        if (error) throw error;
        alert(`✅ اتحدّث سعر الشراء لـ ${data} صنف.`);
        await lcOpen(_lcCurrent.id);
    } catch (err) { alert('❌ ' + err.message); }
};

Object.assign(window, { renderLandedCost });
