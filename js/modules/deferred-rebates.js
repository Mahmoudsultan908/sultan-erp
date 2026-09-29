/* ════════════════════════════════════════════════════════════
   إدارة المؤجلات على مستوى فاتورة الشراء — deferred-rebates.js
   يصدّر (global): repDefLoadInvoiceGroups(supplierId, bodyElId)

   ★ كل فاتورة شراء فيها بنود مؤجلة بتظهر سطر واحد. من هنا:
     - استلام كامل أو جزئي   → fn_receive_deferred_rebate_invoice
     - إلغاء (لو لسه ما اتسلمش حاجة) → fn_cancel_deferred_rebate_invoice
     - إعادة فتح (عكس مستلم كله/جزء) → fn_reopen_deferred_rebate_invoice
     - استعادة مؤجل ملغي     → fn_restore_deferred_rebate_invoice
   تسجيل المؤجل نفسه (عند تأكيد فاتورة الشراء) مايخفّضش رصيد المورد؛
   الاستلام بس هو اللي بيخفّض الرصيد ويسجّل القيد (كله جوه Postgres).

   الملف ده مستقل عن reports.js عمداً: كشف حساب المورد (suppliers.js)
   بيستخدمه كمان، ولازم يشتغل من غير ما المستخدم يفتح شاشة التقارير الأول.
   ════════════════════════════════════════════════════════════ */

function drFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

window._repDefShowAll = window._repDefShowAll === true;

function drInvoiceState(i) {
    const exp = Number(i.expected_total) || 0, rec = Number(i.received_total) || 0;
    const rem = Number(i.remaining_total) || 0, can = Number(i.cancelled_total) || 0;
    if (exp === 0 && can > 0) return 'cancelled';
    if (rem <= 0.005 && rec > 0) return 'settled';
    if (rec > 0.005) return 'partial';
    return 'pending';
}

const DR_STATE_BADGE = {
    pending:   '<span style="color:var(--inv-gold);font-weight:700">⏳ معلّق</span>',
    partial:   '<span style="color:#2563EB;font-weight:700">◐ مستلم جزئياً</span>',
    settled:   '<span style="color:var(--inv-green);font-weight:700">✅ مستلم بالكامل</span>',
    cancelled: '<span style="color:var(--inv-muted-light);font-weight:700">🚫 ملغي</span>',
};

window.repDefLoadInvoiceGroups = async function (supplierId, bodyElId) {
    const body = document.getElementById(bodyElId);
    if (!body) return;
    try {
        const { data: inv, error } = await sb.rpc('fn_list_deferred_rebate_invoices', { p_supplier_id: supplierId });
        if (error) throw error;
        if (!inv || !inv.length) {
            body.innerHTML = `<div style="color:var(--inv-muted-light);font-size:12px">لا توجد مؤجلات لهذا المورد.</div>`;
            return;
        }
        const rows = inv.map(i => ({ i, st: drInvoiceState(i) }));
        const open = rows.filter(r => r.st === 'pending' || r.st === 'partial');
        const visible = window._repDefShowAll ? rows : open;
        const hiddenCount = rows.length - open.length;
        const sid = escHtml(supplierId), bid = escHtml(bodyElId);

        body.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
            <div style="font-size:11px;color:var(--inv-muted)">مؤجل كل فاتورة = مجموع أصنافها. الاستلام (كامل أو جزئي) بيتحوّل لخصم فوري من رصيد المورد. الإلغاء متاح لو لسه ما اتسلمش حاجة، وإعادة الفتح بتعكس المستلم.</div>
            <label style="font-size:12px;color:var(--inv-muted);cursor:pointer;white-space:nowrap">
                <input type="checkbox" ${window._repDefShowAll ? 'checked' : ''} onchange="repDefToggleShowAll(this.checked,'${sid}','${bid}')"> عرض المستلم والملغي (${hiddenCount})
            </label>
        </div>
        ${!visible.length ? `<div style="color:var(--inv-muted-light);font-size:12px">لا توجد مؤجلات معلّقة. فعّل "عرض المستلم والملغي" لإدارة القديم.</div>` : `
        <table class="mod-table"><thead><tr>
            <th>الفاتورة</th><th>التاريخ</th><th style="text-align:left">إجمالي الفاتورة</th><th style="text-align:left">المؤجل</th>
            <th style="text-align:left">المستلم</th><th style="text-align:left">المتبقي</th><th>الحالة</th><th>إجراء</th>
        </tr></thead><tbody>
        ${visible.map(({ i, st }) => {
            const pid = escHtml(i.purchase_id);
            const rem = Number(i.remaining_total) || 0;
            const btn = 'padding:5px 10px;font-size:11px;margin:1px';
            let actions = '';
            if (st === 'pending' || st === 'partial') {
                actions += `<input type="number" id="repDefAmt-${pid}" value="${rem.toFixed(2)}" min="0.01" max="${rem.toFixed(2)}" step="0.01" dir="ltr" style="width:90px;padding:4px 6px;border:1px solid var(--inv-border);border-radius:6px;font-size:12px">
                    <button class="mod-btn" style="${btn};background:var(--inv-green-light);color:var(--inv-green)" onclick="repDefReceiveInvoice('${pid}','${bid}','${sid}')">✅ استلام</button>`;
            }
            if (st === 'pending') actions += `<button class="mod-btn" style="${btn};background:var(--inv-red-bg);color:var(--inv-red)" onclick="repDefCancelInvoice('${pid}','${bid}','${sid}')">🚫 إلغاء</button>`;
            if (st === 'partial' || st === 'settled') actions += `<button class="mod-btn" style="${btn};background:#F1F5F9;color:var(--inv-text-soft)" onclick="repDefReopenInvoice('${pid}','${bid}','${sid}',${(Number(i.received_total) || 0).toFixed(2)})">↩️ إعادة فتح</button>`;
            if (st === 'cancelled') actions += `<button class="mod-btn" style="${btn};background:var(--inv-gold-bg);color:var(--inv-gold)" onclick="repDefRestoreInvoice('${pid}','${bid}','${sid}')">♻️ استعادة</button>`;
            return `<tr style="${st === 'cancelled' ? 'opacity:.6' : ''}">
                <td><strong>${escHtml(i.invoice_no) || '—'}</strong></td>
                <td style="font-size:12px">${i.invoice_date ? new Date(i.invoice_date).toLocaleDateString('ar-EG') : '—'}</td>
                <td style="text-align:left">${drFmt(i.invoice_total)}</td>
                <td style="text-align:left;font-weight:700;color:var(--inv-gold)">${drFmt(st === 'cancelled' ? i.cancelled_total : i.expected_total)}</td>
                <td style="text-align:left;color:var(--inv-green)">${drFmt(i.received_total)}</td>
                <td style="text-align:left;font-weight:700">${drFmt(rem)}</td>
                <td>${DR_STATE_BADGE[st]}</td>
                <td style="white-space:nowrap">${actions}</td>
            </tr>`;
        }).join('')}
        </tbody></table>`}`;
    } catch (err) {
        body.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:12px;border-radius:8px;font-size:12px">خطأ: ${escHtml(err.message)}</div>`;
    }
};

window.repDefToggleShowAll = function (checked, supplierId, bodyElId) {
    window._repDefShowAll = !!checked;
    repDefLoadInvoiceGroups(supplierId, bodyElId);
};

// تنفيذ إجراء + إعادة تحميل الجدول + تحديث الشاشات المفتوحة (تقرير المؤجلات / كشف المورد)
async function drRun(fnName, args, supplierId, bodyElId, errPrefix) {
    try {
        const { error } = await sb.rpc(fnName, args);
        if (error) throw error;
        await repDefLoadInvoiceGroups(supplierId, bodyElId);
        if (typeof window.repDefRefreshReport === 'function') window.repDefRefreshReport();
        if (typeof window.supStmtReloadAfterDeferred === 'function') window.supStmtReloadAfterDeferred();
    } catch (err) {
        alert(errPrefix + ': ' + err.message);
    }
}

window.repDefReceiveInvoice = async function (pid, bodyElId, supplierId) {
    const amt = Number(document.getElementById('repDefAmt-' + pid)?.value);
    if (!(amt > 0)) return alert('اكتب مبلغ الاستلام (أكبر من صفر)');
    if (!confirm(`تأكيد استلام ${drFmt(amt)} من مؤجل الفاتورة دي؟ هيتحول لخصم فوري من رصيد المورد.`)) return;
    await drRun('fn_receive_deferred_rebate_invoice', { p_purchase_id: pid, p_amount: amt }, supplierId, bodyElId, 'خطأ أثناء تسجيل الاستلام');
};

window.repDefReopenInvoice = async function (pid, bodyElId, supplierId, received) {
    const v = prompt(`مبلغ إعادة الفتح (المستلم حالياً ${drFmt(received)}).\nاتركه فاضي لإعادة فتح كل المستلم:`, '');
    if (v === null) return;
    const trimmed = v.trim();
    const amt = trimmed === '' ? null : Number(trimmed);
    if (amt !== null && !(amt > 0)) return alert('مبلغ غير صالح');
    if (!confirm(`تأكيد إعادة فتح ${amt === null ? 'كل المستلم' : drFmt(amt)}؟ هيرجّع المبلغ على رصيد المورد ويسجّل قيد عكسي.`)) return;
    await drRun('fn_reopen_deferred_rebate_invoice', { p_purchase_id: pid, p_amount: amt }, supplierId, bodyElId, 'خطأ أثناء إعادة الفتح');
};

window.repDefCancelInvoice = async function (pid, bodyElId, supplierId) {
    if (!confirm('تأكيد إلغاء مؤجل الفاتورة دي؟ (مفيش أثر على رصيد المورد لأنه ما اتسلمش. تقدر تستعيده بعدين.)')) return;
    await drRun('fn_cancel_deferred_rebate_invoice', { p_purchase_id: pid }, supplierId, bodyElId, 'خطأ أثناء الإلغاء');
};

window.repDefRestoreInvoice = async function (pid, bodyElId, supplierId) {
    if (!confirm('استعادة المؤجل الملغي ليرجع معلّقاً؟')) return;
    await drRun('fn_restore_deferred_rebate_invoice', { p_purchase_id: pid }, supplierId, bodyElId, 'خطأ أثناء الاستعادة');
};
