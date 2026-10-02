#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════
   globals-check.js — كاشف تضارب الأسماء العامة
   المشروع كله سكربتات عادية بتتشارك نفس النطاق العام (من غير bundler)، فلو ملفين عرّفوا نفس اسم دالة/متغير على
   مستوى الملف، الأخير بيمسح الأول بصمت. الفحص ده بيطلّع أي اسم معرّف في أكتر من ملف.
   الأسماء المعروفة والمقصودة بتتحط في ALLOWED تحت (مع سبب). أي تضارب جديد = فشل.
   ════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

// أسماء معرّفة في أكتر من ملف عن قصد/معروفة قبل الفحص ده — كل واحدة محتاجة مراجعة قبل ما تتشال من هنا
const ALLOWED = new Set(JSON.parse(fs.existsSync(path.join(__dirname, 'globals-allowed.json')) ? fs.readFileSync(path.join(__dirname, 'globals-allowed.json'), 'utf8') : '[]'));

const root = path.resolve(__dirname, '..');
const files = [];
(function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (!['archive', 'node_modules', '.git', 'tests', 'scripts'].includes(e.name)) walk(p); }
        else if (e.name.endsWith('.js') && p.includes(path.sep + 'js' + path.sep)) files.push(p);
    }
})(root);

const defs = {};
for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    for (const m of t.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:let|const|var)\s+([A-Za-z_$][\w$]*)/gm)) {
        const n = m[1] || m[2];
        (defs[n] = defs[n] || new Set()).add(path.relative(root, f).split(path.sep).join('/'));
    }
}
// فحص تاني: أي اسم بيتصدّر في Object.assign(window, { ... }) لازم يكون معرّف فعلاً (في نفس الملف أو في أي ملف عام) —
// لو لأ الملف كله بيقع بـ ReferenceError وقت التحميل (مثال: اسم اتشال من الملف وفضل في قايمة التصدير)
const undefinedExports = [];
for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    for (const blk of t.matchAll(/Object\.assign\(window,\s*\{([\s\S]*?)\}\s*\)/g)) {
        for (const raw of blk[1].replace(/\/\/[^\n]*/g, '').split(',')) {
            const name = raw.trim();
            if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;            // بنفحص الشكل المختصر { name } بس
            const esc = name.replace(/\$/g, '\\$');
            const local = new RegExp(`(?:function\\s+${esc}\\b|(?:let|const|var|class)\\s+${esc}\\b|window\\.${esc}\\s*=(?!=)|\\b${esc}\\s*=\\s*(?:async\\s+)?(?:function|\\())`).test(t);
            if (!local && !defs[name]) undefinedExports.push(`${name} في ${path.relative(root, f).split(path.sep).join('/')}`);
        }
    }
}
if (undefinedExports.length) {
    console.error('❌ أسماء بتتصدّر على window وهي مش معرّفة (هتوقع الملف بـ ReferenceError):\n' + undefinedExports.map(e => ' - ' + e).join('\n'));
    process.exit(1);
}

const dups = Object.entries(defs).filter(([, s]) => s.size > 1).sort((a, b) => a[0].localeCompare(b[0]));
const fresh = dups.filter(([n]) => !ALLOWED.has(n));

if (process.argv.includes('--list')) {
    console.log(JSON.stringify(dups.map(([n]) => n), null, 1));
    for (const [n, s] of dups) console.error(`${n}  ←  ${[...s].join(', ')}`);
    process.exit(0);
}
if (fresh.length) {
    console.error('❌ أسماء عامة معرّفة في أكتر من ملف (الأخير بيمسح الأول):\n' + fresh.map(([n, s]) => ` - ${n}: ${[...s].join(', ')}`).join('\n'));
    process.exit(1);
}
console.log(`✅ مفيش تضارب أسماء جديد (${Object.keys(defs).length} اسم عام، ${dups.length} تضارب معروف في globals-allowed.json)`);
