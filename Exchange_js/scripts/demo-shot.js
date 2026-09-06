#!/usr/bin/env node
// 走查截图器：给「改了前端必须截图验证」的闸⑤留物证（PNG 落盘）。
// 背景：Browser-pane 的截图只回显给 agent、不写文件（TOOLING-DEBT 2026-09-04 登记）；
// 本脚本用本机 Chrome 无头渲染：先打后端 /auth/login 拿 token 注入 localStorage，再开页、
// 按可见文本（或 title 属性，图标按钮无文本）逐个点击、落全页 PNG。2026-09-05 平账二期八张物证即出自它。
//
// 依赖（刻意不进 package.json——纯走查工具，不该被 Docker/CI 装）：一次性
//   npm i --no-save puppeteer-core@24
// 与本机 /Applications/Google Chrome.app（路径可用 --chrome 覆盖）。缺依赖当场 fail-fast。
//
// 用法（Node 20）：
//   node scripts/demo-shot.js --url http://localhost:3111/admin/reconciliation/cases --out /abs/path.png \
//     [--as treasury@fiatx.com] [--password 123456] [--api http://127.0.0.1:3110] \
//     [--click "认损"] [--select "css::选项文本"] [--type "css::文本"] [--wait 2500] \
//     [--width 1440] [--height 900] [--selector "css"] \
//     [--storage-key admin_token] [--login-path /auth/login] [--token-field access_token] [--full-page 1]
// 客户端（client-web）示例：--as demo_alice@example.com --storage-key <client key> --login-path <client login>。
// --click / --select / --type 按命令行出现顺序逐步执行（可交叉混用）：
//   --click "文本"       取文档序第一个可见、innerText 含该文本的元素（按钮/链接优先，无命中
//                        再按 title 属性回落——图标按钮无文本节点）。
//   --select "css::文本[::第几个，0 起]" 找 css 命中的 <select>（同 class 命中多个時用第三段
//                        选第几个），按 <option> 文本精确匹配取其 value 并派发 change 事件。
//   --type "css::文本"   点一下 css 选中的输入框再 page.type() 敲字符（真实按键事件，受控
//                        input 的 onChange 才会触发）。
// 每步之间等 --wait 毫秒；任一步找不到目标则退出码 4 并把现场存成 <out>.notfound.png。
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch (e) {
  console.error('missing puppeteer-core — run: npm i --no-save puppeteer-core@24 (kept out of package.json on purpose)');
  process.exit(2);
}
const fs = require('fs');
const path = require('path');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
function args(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) if (process.argv[i] === `--${name}` && i + 1 < process.argv.length) out.push(process.argv[i + 1]);
  return out;
}
// --click/--select/--type 三种交互步骤按命令行原始出现顺序合并（互相之间要能交叉，
// 比如「先选资产、再填金额、再点按钮」），故不能像上面 args() 那样按 flag 名分桶收集。
function orderedSteps() {
  const kinds = ['click', 'select', 'type'];
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--') && kinds.includes(a.slice(2)) && i + 1 < process.argv.length) {
      out.push({ kind: a.slice(2), value: process.argv[i + 1] });
    }
  }
  return out;
}
function splitOnce(s, sep) {
  const i = s.indexOf(sep);
  return i === -1 ? [s, ''] : [s.slice(0, i), s.slice(i + sep.length)];
}

(async () => {
  const url = arg('url');
  const out = arg('out');
  if (!url || !out) { console.error('need --url and --out'); process.exit(2); }
  const api = arg('api', 'http://127.0.0.1:3110');
  const email = arg('as', 'treasury@fiatx.com');
  const password = arg('password', '123456');
  const storageKey = arg('storage-key', 'admin_token');
  const loginPath = arg('login-path', '/auth/login');
  const tokenField = arg('token-field', 'access_token');
  const wait = Number(arg('wait', '1500'));
  const width = Number(arg('width', '1440'));
  const height = Number(arg('height', '900'));
  const selector = arg('selector');
  const fullPage = arg('full-page', '1') === '1';
  const chromePath = arg('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  const steps = orderedSteps();

  const res = await fetch(`${api}${loginPath}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!res.ok) { console.error(`login failed ${res.status}: ${await res.text()}`); process.exit(3); }
  const body = await res.json();
  const token = body[tokenField] ?? body.token ?? body.accessToken;
  if (!token) { console.error(`no token in login response: ${JSON.stringify(body).slice(0, 200)}`); process.exit(3); }

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', `--window-size=${width},${height}`],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    const origin = new URL(url).origin;
    // SPA 启动前就得有 token（AuthGuard 开机即读），所以两步：注入器 + 先开一次首页再落 key。
    await page.evaluateOnNewDocument((k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }, storageKey, token);
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    await page.evaluate((k, v) => localStorage.setItem(k, v), storageKey, token);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, wait));
    if (selector) await page.waitForSelector(selector, { timeout: 30000 });
    for (const step of steps) {
      if (step.kind === 'click') {
        const ok = await page.evaluate((t) => {
          const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          const all = Array.from(document.querySelectorAll('button, a, [role="button"], td, span, div, label'));
          const pref = all.filter((el) => (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button') && isVisible(el) && (el.innerText || '').trim().includes(t));
          const any = pref.length ? pref : all.filter((el) => isVisible(el) && (el.innerText || '').trim() === t);
          let el = pref[0] ?? any[0];
          if (!el) {
            // 图标按钮（无文本节点）把名字放 title 属性——按 title 回落匹配。
            const byTitle = Array.from(document.querySelectorAll('[title]'))
              .filter((e) => isVisible(e) && (e.getAttribute('title') || '').includes(t));
            el = byTitle[0];
          }
          if (!el) return false;
          el.scrollIntoView({ block: 'center' });
          el.click();
          return true;
        }, step.value);
        if (!ok) { console.error(`click target not found: ${step.value}`); await page.screenshot({ path: out.replace(/\.png$/, '.notfound.png'), fullPage: true }); process.exit(4); }
      } else if (step.kind === 'select') {
        // "css::选项文本[::第几个匹配，0 起，同 css 命中多个 <select> 时用]"。
        // 直接在页面里设 el.value + 派发 change 事件（不用 puppeteer 内置 page.select()——
        // 它内部按 querySelector 只认第一个命中，选不到第 2 个同 class 的 select）。
        // React 只对 input/textarea 的 value setter 做劫持追踪，select 不劫持，
        // 所以这里的原生 change 事件足够触发受控 select 的 onChange。
        const parts = step.value.split('::');
        const sel = parts[0];
        const optText = parts[1] ?? '';
        const idx = parts[2] ? parseInt(parts[2], 10) : 0;
        const ok = await page.evaluate((s, t, i) => {
          const el = Array.from(document.querySelectorAll(s))[i];
          if (!el || !el.options) return false;
          const opt = Array.from(el.options).find((o) => (o.textContent || '').trim() === t);
          if (!opt) return false;
          el.value = opt.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }, sel, optText, idx);
        if (!ok) { console.error(`select option not found: ${step.value}`); await page.screenshot({ path: out.replace(/\.png$/, '.notfound.png'), fullPage: true }); process.exit(4); }
      } else if (step.kind === 'type') {
        const [sel, text] = splitOnce(step.value, '::');
        const found = await page.$(sel);
        if (!found) { console.error(`type target not found: ${step.value}`); await page.screenshot({ path: out.replace(/\.png$/, '.notfound.png'), fullPage: true }); process.exit(4); }
        await found.click();
        await page.type(sel, text, { delay: 15 });
      }
      await new Promise((r) => setTimeout(r, wait));
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out, fullPage });
    const size = fs.statSync(out).size;
    console.log(`wrote ${out} (${size} bytes) title="${await page.title()}" url=${page.url()}`);
    if (size === 0) process.exit(5);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
