'use strict';
/* 渲染体检（zx look）：用本机的 Chrome 或 Edge 把页面真的排出来，在两种宽度和打印样式下找看得见的问题。
 * 全程只读：不改课程里的任何文件，截图写到系统临时目录。 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { INDEX_FILE, readText, isFile } = require('./files');
const { generate } = require('./build');
const { launchBrowser } = require('./browser');
const { checkup } = require('./checkup');
const { padTo } = require('./report');

/* 打印那一项按 A4 纸去掉页边距之后的版心宽度来排；断行的检查在这里没有意义，只看放不放得下 */
const VIEWS = [
  { label: '1440 宽', width: 1440, height: 900 },
  { label: '390 宽', width: 390, height: 844 },
  { label: '打印', width: 673, height: 960, media: 'print', only: ['page/overflow', 'table/crushed', 'media/broken'] }
];
const BOOT_TIMEOUT = 10000;
const FONT_NAMES = { 'Zhixu Serif': '正文字体', 'Zhixu Kai': '楷体', 'Zhixu Mono': '等宽字体' };

const ADVICE = {
  'data/stale': '运行 node template/tools/zx.js build 重新生成',
  'boot/failed': '按提示里的原因处理；多半是 build 之后又改了清单，或者 template/ 不完整',
  'boot/timeout': '页面一直没有启动完：先用浏览器打开它，看页面顶部有没有提示',
  'console/error': '讲义里不要自己写脚本；如果报错来自引擎，这是引擎的缺陷',
  'page/overflow': '把撑开页面的内容换成能折行的写法，或者放进会自己横向滚动的容器（表格、<pre>）',
  'cells/wrap': '一排格子太多放不下：减少格子，或者拆成两组 .cells',
  'control/wrap': '按钮上的文字太长，改短一些',
  'table/crushed': '列太多：删掉次要的列，或者把一张表拆成两张',
  'line/orphan-punct': '把这句话改写得长一点或短一点；如果标点前面是公式或旁注，这是引擎的缺陷',
  'line/orphan-ref': '把旁注挪到这句话的别处',
  'line/orphan-open': '把这句话改写一下；如果开引号后面是公式或旁注，这是引擎的缺陷',
  'line/stretched': '这一行里有一长串不能断开的字符（网址、标识符）：放进 <code>，或者改短',
  'media/broken': '核对图片的路径和文件名（大小写也要一致），图片要放在课程目录里',
  'svg/text-out': '把这段文字挪回画面里，或者把 viewBox 改大',
  'svg/text-overlap': '把这两段文字的位置拉开，或者把文字改短',
  'font/system': '内置字体没有用上：确认 template/fonts/ 完整；如果文件都在，这是引擎的缺陷'
};

/* —— 下面三个函数会被送进页面里运行，函数体不能引用外面的任何东西 —— */

/** 等引擎启动完、字体到位。返回 'ok' 或 'timeout'。 */
function settled(timeout) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (/zx-(ready|failed)/.test(document.documentElement.className)) document.fonts.ready.then(() => resolve('ok'));
      else if (Date.now() - started > timeout) resolve('timeout');
      else setTimeout(tick, 20);
    };
    tick();
  });
}

/**
 * 找出“声明的第一顺位是内置字体、里面又有这个字体该画的字符”的文字，每种字体抽 40 处做上记号。
 * 返回 { 字体名: 找到几处 }。
 */
function markBundledText() {
  const OWN = { 'Zhixu Mono': /[A-Za-z0-9]/, 'Zhixu Serif': /[一-鿿]/, 'Zhixu Kai': /[一-鿿]/ };
  const counts = {};
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    // 收起的折叠块里的文字没有排出来，问不到它用的字体：不算
    if (el.dataset.zxFont || !el.checkVisibility()) continue;
    const family = getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim();
    if (!OWN[family]?.test(node.data)) continue;
    counts[family] = (counts[family] ?? 0) + 1;
    if (counts[family] <= 40) el.dataset.zxFont = family;
  }
  return counts;
}

/* —— 以上 —— */

/** 把同一句话合并成一条，记下出现了几次（演示的每一帧叠在同一个位置，会各报一次）。 */
function merge(issues) {
  const merged = new Map();
  for (const { rule, message } of issues) {
    const key = `${rule}\n${message}`;
    merged.set(key, { rule, message, times: (merged.get(key)?.times ?? 0) + 1 });
  }
  return [...merged.values()];
}

/** 内置字体有没有真的用上：声明了它的文字，如果一个字形都不是它画的，就报出来。只有调试协议问得到。 */
async function fontIssues(page) {
  const counts = await page.evaluate(markBundledText);
  const issues = [];
  for (const [family, count] of Object.entries(counts)) {
    const used = await page.fontsUsed(`[data-zx-font="${family}"]`);
    if (used.some((font) => font.custom)) continue;
    const actual = used.map((font) => font.family).join('、');
    issues.push({
      rule: 'font/system',
      message: `${count} 处文字该用内置的${FONT_NAMES[family]}，实际是用 ${actual} 画的`
    });
  }
  return issues;
}

/** 在一种视口下检查一页，返回合并之后的问题。 */
async function examine(page, url, view) {
  await page.setView(view);
  await page.goto(url);
  if ((await page.evaluate(settled, BOOT_TIMEOUT)) === 'timeout') {
    return [{ rule: 'boot/timeout', message: `${BOOT_TIMEOUT / 1000} 秒内没有启动完成`, times: 1 }];
  }
  const issues = await page.evaluate(checkup, view.only);
  if (!view.media) issues.push(...(await fontIssues(page)));
  for (const text of new Set(page.errors)) issues.unshift({ rule: 'console/error', message: text.slice(0, 200) });
  return merge(issues);
}

/** 把整页切成几张适合阅读的图，写进 dir，返回文件路径。 */
async function shoot(page, view, dir, stem) {
  const height = await page.contentHeight();
  const slice = view.width > 600 ? 1800 : 2400;
  const scale = view.width > 600 ? 0.6 : 1;
  const files = [];
  for (let top = 0; top < height; top += slice) {
    const clip = { x: 0, y: top, width: view.width, height: Math.min(slice, height - top), scale };
    const file = path.join(dir, `${stem}-${view.width}-${String(files.length + 1).padStart(2, '0')}.jpg`);
    fs.writeFileSync(file, await page.screenshot(clip));
    files.push(file);
  }
  return files;
}

/**
 * 检查几页，返回 { browser, stale, pages, shots, seconds }。only 是要看的页面，空着就看首页和全部登记的讲。
 * stale 是不是最新的生成文件；pages 是 [{ file, views: [{ label, issues: [{ rule, message, times }] }] }]；
 * shots 是截图文件的路径。
 */
async function look(root, only, options) {
  const shots = Boolean(options && options.shots);
  const launch = (options && options.launch) || launchBrowser;
  const started = Date.now();
  const generated = generate(root);
  const files = only.length > 0 ? only : [INDEX_FILE, ...generated.files];
  // 生成文件是不是最新的：和现在重新生成的结果逐字比对
  const stale = [...generated.outputs]
    .filter(([file, text]) => !isFile(path.join(root, file)) || readText(path.join(root, file)) !== text)
    .map(([file]) => file);
  const browser = await launch();
  let primaryError = null;
  try {
    const page = await browser.newPage();
    const shotDir = shots ? fs.mkdtempSync(path.join(os.tmpdir(), 'zx-shots-')) : null;
    const shotFiles = [];
    const pages = [];
    for (const file of files) {
      const url = pathToFileURL(path.join(root, file)).href;
      const views = [];
      for (const view of VIEWS) {
        views.push({ label: view.label, issues: await examine(page, url, view) });
        if (shotDir && !view.media) shotFiles.push(...(await shoot(page, view, shotDir, path.basename(file, '.html'))));
      }
      pages.push({ file, views });
    }
    return { browser: browser.name, stale, pages, shots: shotFiles, seconds: (Date.now() - started) / 1000 };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await browser.close();
    } catch (closeError) {
      if (!primaryError) throw closeError;
    }
  }
}

/** 人读的体检报告；最后一行是汇总。 */
function formatLook({ browser, stale, pages, shots, seconds }) {
  const lines = [];
  const seen = new Set();
  let total = 0;
  if (stale.length > 0) {
    seen.add('data/stale');
    total += 1;
    lines.push(`data/stale  ${stale.join('、')} 不是最新的：讲义或清单改过之后还没有重新生成`, '');
  }
  for (const { file, views } of pages) {
    lines.push(file);
    for (const { label, issues } of views) {
      lines.push(`  ${padTo(label, 10)}${issues.length ? `${issues.length} 个问题` : '没有问题'}`);
      for (const { rule, message, times } of issues) {
        seen.add(rule);
        total += 1;
        lines.push(`    ${rule.padEnd(18)} ${message}${times > 1 ? `（共 ${times} 处）` : ''}`);
      }
    }
  }
  if (seen.size > 0) {
    lines.push('', '改法：');
    for (const rule of seen) lines.push(`  ${rule.padEnd(18)} ${ADVICE[rule]}`);
  }
  if (shots.length > 0) lines.push('', `截图 ${shots.length} 张：`, ...shots.map((file) => `  ${file}`));
  lines.push(
    '',
    `${total === 0 ? '✓ 渲染检查没有发现问题' : `✗ 渲染检查发现 ${total} 个问题`}（${pages.length} 页，用时 ${seconds.toFixed(1)} 秒，浏览器 ${browser}）`
  );
  return { text: lines.join('\n'), ok: total === 0 };
}

module.exports = { look, formatLook };
