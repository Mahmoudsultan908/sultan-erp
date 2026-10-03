// ════════════════════════════════════════════════════════════
// backup.js — نسخة احتياطية كاملة من جوه الـERP (للأدمن فقط)
// يصدّر: backupRunFull()
//
// بيسحب كل جداول النظام صفحة صفحة (حد Supabase 1000 صف في الطلب الواحد — النسخة
// القديمة كانت بتاخد أول 1000 صف بس من كل جدول وبتفوّت الباقي من غير تحذير)،
// وبيقارن عدد الصفوف اللي اتسحبت بالعدد الحقيقي على السيرفر (الدالة fn_backup_counts
// بترجّع العدد الحقيقي حتى للجداول اللي صلاحيات القراءة بتخبّيها عن حساب الأدمن)،
// وبينزّل ملفين: HTML للعرض بدون إنترنت (backup-viewer.html قالب العرض) + JSON بالبيانات الخام.
// ════════════════════════════════════════════════════════════

// جداول مش بتتنسخ: أرقام سرية/تذاكر دخول العملاء، اشتراكات الإشعارات، الشات الخاص،
// وبقايا مشروع workflow-hub القديم (مش جزء من شغل الشركة)
const BKP_EXCLUDE = new Set([
    'customer_portal_pins', 'customer_portal_sessions', 'push_subscriptions',
    'private_chat_messages', 'private_chat_threads',
    'conversations', 'messages', 'notifications', 'tasks', 'task_comments', 'files', 'customer_notes', 'product_imports',
]);

async function bkpFetchAll(table, warnings) {
    const size = 1000;
    let all = [], from = 0, ordered = true;
    for (;;) {
        let q = sb.from(table).select('*');
        if (ordered) q = q.order('id', { ascending: true });
        const { data, error } = await q.range(from, from + size - 1);
        if (error) {
            // جدول من غير عمود id (زي inventory_stock): نجرّب من غير ترتيب
            if (ordered && (error.code === '42703' || /does not exist/i.test(error.message || ''))) { ordered = false; from = 0; all = []; continue; }
            throw error;
        }
        all = all.concat(data);
        if (data.length < size) break;
        if (!ordered) { warnings.push(table + ': أكتر من 1000 صف بدون ترتيب ثابت — راجع العدد'); break; }
        from += size;
    }
    return all;
}

async function bkpGzipB64(str) {
    const buf = await new Response(new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    const u = new Uint8Array(buf); let s = ''; const c = 0x8000;
    for (let i = 0; i < u.length; i += c) s += String.fromCharCode.apply(null, u.subarray(i, i + c));
    return btoa(s);
}

function bkpDownload(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

function bkpOpenModal() {
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'bkpModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:520px">
            <div class="mod-modal-header"><h3>💾 نسخة احتياطية كاملة</h3></div>
            <div class="mod-modal-body">
                <div style="background:#E3E7F0;border-radius:6px;height:10px;overflow:hidden;margin-bottom:12px"><div id="bkpBar" style="height:100%;width:0;background:#0a7a4b;transition:width .2s"></div></div>
                <div id="bkpMsg" style="font-size:13px;line-height:1.8;max-height:260px;overflow:auto">⏳ جاري البدء...</div>
            </div>
            <div class="mod-modal-footer"><button class="mod-btn mod-btn-primary" id="bkpClose" disabled onclick="document.getElementById('bkpModal').remove()">إغلاق</button></div>
        </div>`;
    document.body.appendChild(modal);
    const msg = modal.querySelector('#bkpMsg'), bar = modal.querySelector('#bkpBar'), btn = modal.querySelector('#bkpClose');
    return {
        say: (t) => { msg.innerHTML = t; },
        progress: (pct) => { bar.style.width = Math.max(0, Math.min(100, pct)) + '%'; },
        finish: () => { btn.disabled = false; },
    };
}

window.backupRunFull = async function () {
    if (window._bkpRunning) return;
    if (!confirm('هيتم سحب كل بيانات النظام وتحميل ملفين: HTML للعرض بدون إنترنت + JSON بالبيانات الخام. ممكن ياخد دقيقة أو اتنين. متابعة؟')) return;
    window._bkpRunning = true;
    const ui = bkpOpenModal();
    try {
        const { data: counts, error: ce } = await sb.rpc('fn_backup_counts');
        if (ce) throw new Error(/غير مسموح/.test(ce.message || '') ? 'النسخة الاحتياطية للأدمن فقط' : ce.message);

        const names = Object.keys(counts).filter(t => !BKP_EXCLUDE.has(t)).sort();
        const meta = { exported_at: new Date().toISOString(), label: 'نسخة من ' + BRAND.erp, user: (typeof currentUser !== 'undefined' && currentUser?.email) || '', counts: {}, failed: [], warnings: [] };
        const tables = {};
        for (let i = 0; i < names.length; i++) {
            const t = names[i];
            ui.say(`⏳ جاري سحب الجداول: <b>${t}</b> (${i + 1} من ${names.length})`);
            try {
                const rows = await bkpFetchAll(t, meta.warnings);
                tables[t] = rows;
                meta.counts[t] = { server: Number(counts[t]), fetched: rows.length };
            } catch (e) {
                meta.failed.push(t);
                meta.counts[t] = { server: Number(counts[t]), fetched: 0 };
            }
            ui.progress(Math.round(((i + 1) / names.length) * 90));
        }

        const data = { meta, tables };
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
        ui.say('⏳ جاري تجهيز الملفات...');
        bkpDownload(`sultan-data-${stamp}.json`, new Blob([JSON.stringify(data)], { type: 'application/json' }));

        let htmlOk = true;
        try {
            const tplRes = await fetch('backup-viewer.html', { cache: 'no-store' });
            if (!tplRes.ok) throw new Error('قالب العرض مش موجود');
            const tpl = await tplRes.text();
            const html = tpl.split('__DATA_B64__').join(await bkpGzipB64(JSON.stringify(data)));
            bkpDownload(`sultan-backup-${stamp}.html`, new Blob([html], { type: 'text/html' }));
        } catch (e) { htmlOk = false; }

        const nowIso = new Date().toISOString();
        try { await sb.from('app_settings').upsert({ key: 'last_backup_at', value: JSON.stringify(nowIso), updated_at: nowIso }); } catch { /* مش مهم */ }
        const lastEl = document.getElementById('sett-backup-last');
        if (lastEl && typeof settFmtLastBackup === 'function') lastEl.textContent = settFmtLastBackup(nowIso);

        // ملخص صادق: أي جدول عدده على السيرفر مختلف عن اللي اتسحب
        const bad = names.filter(t => meta.counts[t].server !== meta.counts[t].fetched);
        const okTables = names.length - bad.length;
        ui.progress(100);
        ui.say(`
            <div style="font-weight:800;margin-bottom:6px">${bad.length || meta.failed.length ? '⚠️ النسخة اتحمّلت لكن فيها ملاحظات' : '✅ النسخة اتحمّلت كاملة'}</div>
            <div>الجداول المطابقة للعدد الحقيقي: <b>${okTables}</b> من <b>${names.length}</b></div>
            ${meta.failed.length ? `<div style="color:#b3261e">جداول فشل سحبها: ${meta.failed.join('، ')}</div>` : ''}
            ${bad.length ? `<div style="color:#b3261e">جداول عددها مختلف: ${bad.map(t => `${t} (${meta.counts[t].fetched} من ${meta.counts[t].server})`).join('، ')}</div>
              <div style="font-size:12px;color:#667">غالباً دي جداول محمية بالصلاحيات (حساب الأدمن مش بيشوف كل صفوفها).</div>` : ''}
            ${htmlOk ? '' : '<div style="color:#b3261e">ملف الـHTML ما اتجهزش (قالب العرض مش متاح) — اتحمّل ملف JSON بس.</div>'}
            <div style="margin-top:8px;font-size:12px;color:#667">احفظ الملفات في مكانين (الجهاز + فلاشة). الملفات فيها بيانات حساسة — ما ترفعهاش على GitHub أو أي مكان عام.</div>`);
    } catch (e) {
        ui.say(`<div style="color:#b3261e;font-weight:800">❌ ${e.message || e}</div>`);
    } finally {
        window._bkpRunning = false;
        ui.finish();
    }
};
