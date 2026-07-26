/* ════════════════════════════════════════════════════════════
   المحادثات الخاصة — private-chat.js
   يصدّر: renderPrivateChat(container)

   ★ محادثة 1:1 بين المدير وأي مستخدم تاني، محمية بكلمة سر منفصلة
   تماماً عن كلمة سر الدخول — كل طرف بيحط كلمة سر خاصة بيه (مش
   مشتركة)، وبيدخلها فى كل مرة يفتح فيها المحادثة (مفيش "تذكرني").
   راجع private_chat_migration.sql (جدولين private_chat_threads /
   private_chat_messages) — الحماية الحقيقية هنا هي RLS على مستوى
   الصفوف (بس طرفين المحادثة، ولا حتى مدير تاني)، كلمة السر مجرد
   حاجز إضافي على الشاشة نفسها. الـ hashing بيتم فى المتصفح
   (Web Crypto SHA-256 + salt عشوائي) — النص الحقيقي مايتخزنش أبداً.
   ════════════════════════════════════════════════════════════ */

let PCH_DB = { profiles: [], threads: [] };
let _pchUnlockedThreadId = null;
let _pchMessages = [];
let _pchPendingThreadId = null;
let _pchRecorder = null;
let _pchRecordedChunks = [];
let _pchIsRecording = false;
const PCH_MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const PCH_ROLE_LABELS = { admin: 'مدير النظام', accountant: 'محاسب', cashier: 'كاشير', rep: 'مندوب مبيعات', employee: 'موظف' };

// ---- كلمة السر: SHA-256(salt + ':' + password) عبر Web Crypto — بدون أي مكتبة خارجية ----
async function pchHash(password, salt) {
    const enc = new TextEncoder().encode(salt + ':' + password);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function pchRandomSalt() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// نفس فلسفة apCurrentIsAdmin فى advanced-permissions.js بالظبط —
// فشل آمن (true) لو حصل خطأ فى التأكد، عشان محدش يتقفل بالغلط
async function pchCurrentIsAdmin() {
    if (window._currentUserRole) return window._currentUserRole === 'admin';
    try {
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return false;
        const { data: p } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
        if (!p) return true;
        return p.role === 'admin';
    } catch { return true; }
}

function pchOtherPerson(t) {
    const amManager = t.manager_id === currentUser?.id;
    return amManager ? (t.participant?.name || '—') : (t.manager?.name || '—');
}

// رفع صورة/رسالة صوتية لـ bucket "chat-media" الموجود بالفعل — نفس
// نمط رفع المرفقات فى crm.js (sb.storage.from(...).upload) بس بمسار
// منظّم تحت رقم المحادثة نفسها
async function pchUploadFile(file, ext) {
    const rand = pchRandomSalt().slice(0, 10);
    const path = `${_pchUnlockedThreadId}/${Date.now()}_${rand}.${ext}`;
    const { error: upErr } = await sb.storage.from('chat-media').upload(path, file);
    if (upErr) throw upErr;
    const { data: pub } = sb.storage.from('chat-media').getPublicUrl(path);
    return pub.publicUrl;
}

async function renderPrivateChat(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري التحميل...</div>';
    try {
        const [{ data: profiles }, { data: threads, error: threadsErr }] = await Promise.all([
            sb.from('profiles').select('id,name,role').eq('is_active', true).order('name'),
            sb.from('private_chat_threads').select('*, manager:manager_id(name), participant:participant_id(name)').order('updated_at', { ascending: false }),
        ]);
        if (threadsErr) throw threadsErr;
        PCH_DB.profiles = (profiles || []).filter(p => p.id !== currentUser?.id);
        PCH_DB.threads = threads || [];
        PCH_DB.isAdmin = await pchCurrentIsAdmin();
        _pchUnlockedThreadId = null;
        _pchMessages = [];
        pchRenderScreen(c);
    } catch (err) {
        if (/relation .* does not exist/i.test(err.message || '')) {
            c.innerHTML = `<div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:16px;border-radius:12px">⚠️ جداول المحادثات الخاصة لسه مش موجودة — شغّل <code>private_chat_migration.sql</code> فى Supabase أولاً.</div>`;
        } else {
            c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
        }
    }
}

function pchRenderScreen(c) {
    c.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div><h2 style="font-size:22px;font-weight:800">🔒 المحادثات الخاصة</h2>
        <p style="font-size:13px;color:#64748B;margin-top:4px">محادثة محمية بكلمة سر منفصلة عن كلمة سر الدخول — كل شخص بيحط كلمة السر بتاعته وبيدخلها فى كل مرة يفتحها</p></div>
        ${PCH_DB.isAdmin && !_pchUnlockedThreadId ? `<button class="mod-btn mod-btn-primary" onclick="pchOpenNewThread()">+ محادثة جديدة</button>` : ''}
    </div>
    <div id="pchBody">${_pchUnlockedThreadId ? pchChatViewHTML() : pchThreadListHTML()}</div>`;
}

function pchThreadListHTML() {
    if (!PCH_DB.threads.length) {
        return `<div class="empty-state"><span>🔒</span>لا توجد محادثات خاصة بعد.${PCH_DB.isAdmin ? ' اضغط "+ محادثة جديدة" لبدء واحدة.' : ''}</div>`;
    }
    return `<div style="display:flex;flex-direction:column;gap:8px">
        ${PCH_DB.threads.map(t => `
        <div class="mod-card" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;padding:16px" onclick="pchPromptUnlock('${t.id}')">
            <div>
                <div style="font-weight:700">🔒 ${t.title || ('محادثة مع ' + pchOtherPerson(t))}</div>
                <div style="font-size:11px;color:#94A3B8;margin-top:2px">مع: ${pchOtherPerson(t)}</div>
            </div>
            <button class="mod-btn" style="background:#EFF6FF;color:#2563EB">🔓 فتح</button>
        </div>`).join('')}
    </div>`;
}

// ════════════════════════════════════════════════════════════
// إنشاء محادثة جديدة (أدمن فقط)
// ════════════════════════════════════════════════════════════
window.pchOpenNewThread = function () {
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'pchNewModal';
    modal.innerHTML = `
    <div class="mod-modal" style="max-width:440px">
        <div class="mod-modal-header"><h3>🔒 محادثة خاصة جديدة</h3>
            <button class="mod-modal-close" onclick="document.getElementById('pchNewModal').remove()">&times;</button></div>
        <div class="mod-modal-body">
            <div class="mod-form-group"><label>المستخدم التاني</label>
                <select id="pchNewParticipant" class="mod-form-input">
                    <option value="">-- اختر --</option>
                    ${PCH_DB.profiles.map(p => `<option value="${p.id}">${p.name} (${PCH_ROLE_LABELS[p.role] || p.role})</option>`).join('')}
                </select></div>
            <div class="mod-form-group"><label>كلمة السر بتاعتك انت</label>
                <input type="password" id="pchNewMyPass" class="mod-form-input" placeholder="4 حروف/أرقام على الأقل"></div>
            <div class="mod-form-group"><label>كلمة السر بتاعة الطرف التاني</label>
                <input type="password" id="pchNewTheirPass" class="mod-form-input" placeholder="4 حروف/أرقام على الأقل"></div>
            <div style="font-size:11px;color:#94A3B8;line-height:1.7">كل واحد هيستخدم كلمة السر بتاعته بس عشان يفتح المحادثة دي (مش نفس السر). قوله كلمة سره على انفراد — وكل واحد فيهم يقدر يغيّرها بنفسه بعد كده من داخل المحادثة من غير ما يحتاج الطرف التاني.</div>
        </div>
        <div class="mod-modal-footer">
            <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="document.getElementById('pchNewModal').remove()">إلغاء</button>
            <button class="mod-btn mod-btn-primary" onclick="pchSaveNewThread()">💾 إنشاء</button>
        </div>
    </div>`;
    document.body.appendChild(modal);
};

window.pchSaveNewThread = async function () {
    const participantId = document.getElementById('pchNewParticipant').value;
    const myPass = document.getElementById('pchNewMyPass').value;
    const theirPass = document.getElementById('pchNewTheirPass').value;
    if (!participantId) return alert('اختر المستخدم التاني');
    if (!myPass || myPass.length < 4 || !theirPass || theirPass.length < 4) return alert('كل كلمة سر لازم تكون 4 حروف/أرقام على الأقل');

    const btn = document.querySelector('#pchNewModal .mod-btn-primary');
    btn.innerText = '⏳ جاري الإنشاء...'; btn.disabled = true;
    try {
        const mySalt = pchRandomSalt(), theirSalt = pchRandomSalt();
        const myHash = await pchHash(myPass, mySalt);
        const theirHash = await pchHash(theirPass, theirSalt);
        const { error } = await sb.from('private_chat_threads').insert({
            manager_id: currentUser.id, participant_id: participantId,
            manager_password_hash: myHash, manager_password_salt: mySalt,
            participant_password_hash: theirHash, participant_password_salt: theirSalt,
            created_by: currentUser.id,
        });
        if (error) throw error;
        document.getElementById('pchNewModal').remove();
        await renderPrivateChat(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ: ' + err.message);
        btn.innerText = '💾 إنشاء'; btn.disabled = false;
    }
};

// ════════════════════════════════════════════════════════════
// فتح محادثة — كلمة سر خاصة بكل طرف، بتتطلب فى كل مرة
// ════════════════════════════════════════════════════════════
window.pchPromptUnlock = function (id) {
    _pchPendingThreadId = id;
    document.getElementById('pchUnlockModal')?.remove();
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'pchUnlockModal';
    modal.innerHTML = `
    <div class="mod-modal" style="max-width:340px">
        <div class="mod-modal-header"><h3>🔒 كلمة السر</h3>
            <button class="mod-modal-close" onclick="document.getElementById('pchUnlockModal').remove()">&times;</button></div>
        <div class="mod-modal-body">
            <div class="mod-form-group"><label>أدخل كلمة السر الخاصة بيك لهذه المحادثة</label>
                <input type="password" id="pchUnlockPass" class="mod-form-input" onkeydown="if(event.key==='Enter')pchTryUnlock()"></div>
            <div id="pchUnlockErr" style="color:#DC2626;font-size:12px;display:none">❌ كلمة السر غلط</div>
        </div>
        <div class="mod-modal-footer">
            <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="document.getElementById('pchUnlockModal').remove()">إلغاء</button>
            <button class="mod-btn mod-btn-primary" onclick="pchTryUnlock()">فتح 🔓</button>
        </div>
    </div>`;
    document.body.appendChild(modal);
    setTimeout(() => document.getElementById('pchUnlockPass')?.focus(), 50);
};

window.pchTryUnlock = async function () {
    const t = PCH_DB.threads.find(x => x.id === _pchPendingThreadId);
    if (!t) return;
    const pass = document.getElementById('pchUnlockPass').value;
    if (!pass) return;
    const amManager = t.manager_id === currentUser?.id;
    const salt = amManager ? t.manager_password_salt : t.participant_password_salt;
    const hash = amManager ? t.manager_password_hash : t.participant_password_hash;
    const computed = await pchHash(pass, salt);
    if (computed !== hash) {
        const err = document.getElementById('pchUnlockErr');
        if (err) err.style.display = 'block';
        return;
    }
    document.getElementById('pchUnlockModal')?.remove();
    _pchUnlockedThreadId = t.id;
    try {
        await pchLoadMessages(t.id);
        pchRenderScreen(document.getElementById('app-content'));
    } catch (err) { alert('❌ خطأ: ' + err.message); }
};

async function pchLoadMessages(threadId) {
    const { data, error } = await sb.from('private_chat_messages')
        .select('*, sender:sender_id(name)').eq('thread_id', threadId).order('created_at', { ascending: true });
    if (error) throw error;
    _pchMessages = data || [];
}

// ════════════════════════════════════════════════════════════
// شاشة المحادثة بعد الفتح
// ════════════════════════════════════════════════════════════
function pchChatViewHTML() {
    const t = PCH_DB.threads.find(x => x.id === _pchUnlockedThreadId);
    if (!t) return '';
    const pinned = _pchMessages.filter(m => m.is_pinned);
    return `
    <div class="mod-card" style="margin-bottom:10px;padding:14px 16px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <div style="font-weight:800">🔒 محادثة مع ${pchOtherPerson(t)}</div>
            <div style="display:flex;gap:6px">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569;font-size:12px;padding:6px 10px" onclick="pchLockAndBack()">🔙 رجوع</button>
                <button class="mod-btn" style="background:#FFFBEB;color:#D97706;font-size:12px;padding:6px 10px" onclick="pchOpenChangePass()">🔑 غيّر كلمة السر بتاعتي</button>
            </div>
        </div>
    </div>
    ${pinned.length ? `<div class="mod-card" style="background:#FFFBEB;border-color:#FCD34D;margin-bottom:10px;padding:12px 16px">
        <div style="font-weight:700;font-size:12px;color:#92400E;margin-bottom:8px">📌 رسائل مثبتة</div>
        <div style="display:flex;flex-direction:column;gap:8px">${pinned.map(m => pchMessageHTML(m)).join('')}</div>
    </div>` : ''}
    <div class="mod-card" style="padding:14px;max-height:420px;overflow-y:auto;display:flex;flex-direction:column;gap:8px" id="pchMsgList">
        ${_pchMessages.length ? _pchMessages.map(m => pchMessageHTML(m)).join('') : `<div class="empty-state"><span>💬</span>ابدأ المحادثة...</div>`}
    </div>
    <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
        <input type="file" id="pchImageInput" accept="image/*" style="display:none" onchange="pchPickImage(this)">
        <button class="mod-btn" style="background:#F1F5F9;color:#475569;padding:8px 10px" title="إرسال صورة" onclick="document.getElementById('pchImageInput').click()">📷</button>
        <button class="mod-btn" id="pchMicBtn" style="background:#F1F5F9;color:#475569;padding:8px 10px" title="تسجيل رسالة صوتية" onclick="pchToggleRecording()">🎤</button>
        <input type="text" id="pchNewMsg" class="mod-form-input" placeholder="اكتب رسالة..." onkeydown="if(event.key==='Enter')pchSendMessage()">
        <button class="mod-btn mod-btn-primary" onclick="pchSendMessage()">إرسال</button>
    </div>`;
}

function pchMessageHTML(m) {
    const mine = m.sender_id === currentUser?.id;
    let attachmentHTML = '';
    if (m.attachment_type === 'image') {
        attachmentHTML = `<img src="${m.attachment_url}" style="max-width:220px;max-height:220px;border-radius:10px;display:block;cursor:pointer" onclick="window.open('${m.attachment_url}','_blank')">`;
    } else if (m.attachment_type === 'audio') {
        attachmentHTML = `<audio controls src="${m.attachment_url}" style="max-width:220px;display:block"></audio>`;
    }
    const textHTML = m.body ? `<div style="${attachmentHTML ? 'margin-top:6px' : ''}">${m.body.replace(/</g, '&lt;')}</div>` : '';
    return `<div style="align-self:${mine ? 'flex-end' : 'flex-start'};max-width:75%">
        <div style="background:${mine ? '#DBEAFE' : '#F1F5F9'};border-radius:12px;padding:8px 12px;font-size:13px;white-space:pre-wrap">${attachmentHTML}${textHTML}</div>
        <div style="font-size:10px;color:#94A3B8;margin-top:2px;display:flex;gap:6px;align-items:center">
            <span>${m.sender?.name || ''} · ${new Date(m.created_at).toLocaleString('ar-EG')}</span>
            <span style="cursor:pointer" title="${m.is_pinned ? 'إلغاء التثبيت' : 'تثبيت'}" onclick="pchTogglePin('${m.id}',${!m.is_pinned})">${m.is_pinned ? '📌' : '📍'}</span>
        </div>
    </div>`;
}

function pchRefreshChatBody() {
    const body = document.getElementById('pchBody');
    if (body) body.innerHTML = pchChatViewHTML();
}

window.pchSendMessage = async function () {
    const input = document.getElementById('pchNewMsg');
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    try {
        const { error } = await sb.from('private_chat_messages').insert({
            thread_id: _pchUnlockedThreadId, sender_id: currentUser.id, body,
        });
        if (error) throw error;
        await pchLoadMessages(_pchUnlockedThreadId);
        pchRefreshChatBody();
    } catch (err) { alert('❌ خطأ: ' + err.message); }
};

window.pchPickImage = async function (input) {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    if (file.size > PCH_MAX_IMAGE_BYTES) { alert('⚠️ حجم الصورة كبير جداً (الحد الأقصى 8 ميجا)'); return; }
    try {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const url = await pchUploadFile(file, ext);
        const { error } = await sb.from('private_chat_messages').insert({
            thread_id: _pchUnlockedThreadId, sender_id: currentUser.id,
            attachment_url: url, attachment_type: 'image',
        });
        if (error) throw error;
        await pchLoadMessages(_pchUnlockedThreadId);
        pchRefreshChatBody();
    } catch (err) { alert('❌ خطأ فى رفع الصورة: ' + err.message); }
};

function pchUpdateMicButton() {
    const btn = document.getElementById('pchMicBtn');
    if (!btn) return;
    btn.textContent = _pchIsRecording ? '⏹️' : '🎤';
    btn.style.background = _pchIsRecording ? '#FEE2E2' : '#F1F5F9';
    btn.style.color = _pchIsRecording ? '#DC2626' : '#475569';
}

// تسجيل صوتي عبر MediaRecorder — زرار واحد يبدأ ويوقف (بدل ضغط مطوّل)،
// وبمجرد التوقف بيترفع تلقائي كرسالة صوتية جديدة
window.pchToggleRecording = async function () {
    if (_pchIsRecording) {
        _pchRecorder?.stop();
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        _pchRecordedChunks = [];
        _pchRecorder = new MediaRecorder(stream);
        _pchRecorder.ondataavailable = e => { if (e.data.size > 0) _pchRecordedChunks.push(e.data); };
        _pchRecorder.onstop = async () => {
            stream.getTracks().forEach(tr => tr.stop());
            _pchIsRecording = false;
            pchUpdateMicButton();
            const blob = new Blob(_pchRecordedChunks, { type: 'audio/webm' });
            if (!blob.size) return;
            try {
                const url = await pchUploadFile(blob, 'webm');
                const { error } = await sb.from('private_chat_messages').insert({
                    thread_id: _pchUnlockedThreadId, sender_id: currentUser.id,
                    attachment_url: url, attachment_type: 'audio',
                });
                if (error) throw error;
                await pchLoadMessages(_pchUnlockedThreadId);
                pchRefreshChatBody();
            } catch (err) { alert('❌ خطأ فى رفع الرسالة الصوتية: ' + err.message); }
        };
        _pchRecorder.start();
        _pchIsRecording = true;
        pchUpdateMicButton();
    } catch (err) {
        alert('❌ محتاج صلاحية استخدام الميكروفون: ' + err.message);
    }
};

window.pchTogglePin = async function (id, pin) {
    try {
        const { error } = await sb.from('private_chat_messages').update({ is_pinned: pin }).eq('id', id);
        if (error) throw error;
        await pchLoadMessages(_pchUnlockedThreadId);
        pchRefreshChatBody();
    } catch (err) { alert('❌ خطأ: ' + err.message); }
};

window.pchLockAndBack = function () {
    _pchUnlockedThreadId = null;
    _pchMessages = [];
    renderPrivateChat(document.getElementById('app-content'));
};

// ════════════════════════════════════════════════════════════
// تغيير كلمة السر الخاصة بيا فى المحادثة دي — من غير الطرف التاني
// ════════════════════════════════════════════════════════════
window.pchOpenChangePass = function () {
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'pchPassModal';
    modal.innerHTML = `
    <div class="mod-modal" style="max-width:340px">
        <div class="mod-modal-header"><h3>🔑 تغيير كلمة السر</h3>
            <button class="mod-modal-close" onclick="document.getElementById('pchPassModal').remove()">&times;</button></div>
        <div class="mod-modal-body">
            <div class="mod-form-group"><label>كلمة السر الجديدة</label>
                <input type="password" id="pchNewPass1" class="mod-form-input" placeholder="4 حروف/أرقام على الأقل"></div>
            <div class="mod-form-group"><label>تأكيد كلمة السر</label>
                <input type="password" id="pchNewPass2" class="mod-form-input"></div>
        </div>
        <div class="mod-modal-footer">
            <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="document.getElementById('pchPassModal').remove()">إلغاء</button>
            <button class="mod-btn mod-btn-primary" onclick="pchSaveChangePass()">💾 حفظ</button>
        </div>
    </div>`;
    document.body.appendChild(modal);
};

window.pchSaveChangePass = async function () {
    const p1 = document.getElementById('pchNewPass1').value;
    const p2 = document.getElementById('pchNewPass2').value;
    if (!p1 || p1.length < 4) return alert('كلمة السر لازم تكون 4 حروف/أرقام على الأقل');
    if (p1 !== p2) return alert('كلمتا السر مش متطابقتين');
    const t = PCH_DB.threads.find(x => x.id === _pchUnlockedThreadId);
    if (!t) return;
    const amManager = t.manager_id === currentUser?.id;

    const btn = document.querySelector('#pchPassModal .mod-btn-primary');
    btn.innerText = '⏳ جاري الحفظ...'; btn.disabled = true;
    try {
        const salt = pchRandomSalt();
        const hash = await pchHash(p1, salt);
        const payload = amManager
            ? { manager_password_hash: hash, manager_password_salt: salt, updated_at: new Date().toISOString() }
            : { participant_password_hash: hash, participant_password_salt: salt, updated_at: new Date().toISOString() };
        const { error } = await sb.from('private_chat_threads').update(payload).eq('id', t.id);
        if (error) throw error;
        Object.assign(t, payload);
        document.getElementById('pchPassModal').remove();
        alert('✅ تم تغيير كلمة السر بتاعتك');
    } catch (err) {
        alert('❌ خطأ: ' + err.message);
        btn.innerText = '💾 حفظ'; btn.disabled = false;
    }
};

Object.assign(window, {
    renderPrivateChat,
    pchOpenNewThread, pchSaveNewThread, pchPromptUnlock, pchTryUnlock,
    pchSendMessage, pchPickImage, pchToggleRecording, pchTogglePin, pchLockAndBack, pchOpenChangePass, pchSaveChangePass,
});
