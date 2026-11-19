'use strict';
/* 版面体检：每门测试课的每一页，在五种宽度、三种主题下都不该有看得见的版面问题；
 * 另外按一串宽度扫描断行：没有以收尾标点或旁注序号开头的行，没有被两端对齐拉开的行。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { ENGINE, course, makeCourse, newContext, open, lessonFiles, REPO } = require('./harness');
const { checkup } = require(path.join(REPO, 'template', 'tools', 'lib', 'checkup.js'));

const WIDTHS = [320, 390, 768, 1024, 1440];
// 主题不只是换颜色：普通屏幕上，浅色和纸张主题的正文比深色主题重一点，每行能放的字数因此不一样
const THEMES = ['light', 'sepia', 'dark'];
const SWEEP = [];
for (let width = 320; width <= 700; width += 10) SWEEP.push(width);
SWEEP.push(768, 1024, 1280, 1440, 1680);
const SHARED_SWEEP_COURSES = new Set(['sample', 'edge']);
const SHARED_SWEEP_RULES = ['line/orphan-punct', 'line/orphan-ref', 'line/stretched'];
const sharedSweepCache = new Map();

/** 把体检函数安装到刚打开的文档上，返回本页复用的调用句柄（同一份文档只注入一次）。 */
async function attachCheckup(page) {
  await page.evaluate(`window.__zxCheckup = (${checkup})`);
  return (only) => page.evaluate((rules) => window.__zxCheckup(rules), only);
}

/** 在已安装体检函数的页面上做体检，返回去掉重复之后的问题（"规则 说明"）。only 是只做的检查项。 */
async function examine(run, only) {
  const issues = await run(only);
  return [...new Set(issues.map((issue) => `${issue.rule}  ${issue.message}`))];
}

/**
 * 把几门课的每一讲按一串宽度扫一遍，只返回 only 里的检查结果（"课/讲 问题 @出现的宽度"）。
 * B17 与 B18 都会扫 sample 和 edge：这两门课首次扫宽时在同一宽度下顺带采集三条断行规则并缓存，
 * 避免重复建页与切换视口；两条用例各自只取自己负责的规则，单独筛选也能独立跑通。
 */
async function sweep(names, only) {
  const missing = names.filter((name) => !sharedSweepCache.has(name));
  const local = new Map();
  if (missing.length > 0) {
    const context = await newContext();
    try {
      for (const name of missing) {
        const rules = SHARED_SWEEP_COURSES.has(name) ? SHARED_SWEEP_RULES : only;
        const found = new Map();
        const root = course(name);
        for (const file of lessonFiles(root)) {
          const page = await open(context, root, file);
          await page.evaluate(() => document.fonts.ready);
          const run = await attachCheckup(page);
          for (const width of SWEEP) {
            await page.setViewportSize({ width, height: 900 });
            const issues = await run(rules);
            const seen = new Set();
            for (const issue of issues) {
              const text = `${issue.rule}  ${issue.message}`;
              if (seen.has(text)) continue;
              seen.add(text);
              const key = `${name}/${file}  ${text}`;
              const entry = found.get(key) ?? { rule: issue.rule, widths: [] };
              entry.widths.push(width);
              found.set(key, entry);
            }
          }
          await page.close();
        }
        const entries = [...found].map(([key, { rule, widths }]) => ({
          rule,
          line: `${key}  @${widths.join(',')}`
        }));
        if (SHARED_SWEEP_COURSES.has(name)) {
          sharedSweepCache.set(name, entries);
        } else {
          local.set(name, entries);
        }
      }
    } finally {
      await context.close();
    }
  }
  const want = new Set(only);
  const collected = [];
  for (const name of names) {
    const entries = sharedSweepCache.get(name) ?? local.get(name) ?? [];
    for (const entry of entries) {
      if (want.has(entry.rule)) collected.push(entry.line);
    }
  }
  return collected;
}

for (const name of ['sample', 'calculus', 'matrix', 'edge']) {
  test(`体检：${name} 课的每一页在五种宽度、三种主题下没有版面问题`, async () => {
    const root = course(name);
    const context = await newContext();
    const found = [];
    for (const file of ['index.html', ...lessonFiles(root)]) {
      for (const theme of THEMES) {
        const page = await open(context, root, file, `?theme=${theme}`);
        await page.evaluate(() => document.fonts.ready);
        const run = await attachCheckup(page);
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          for (const issue of await examine(run)) found.push(`${file} @${width} ${theme}  ${issue}`);
        }
        assert.deepEqual(page.errors, [], `${file} 的控制台应当没有报错`);
        await page.close();
      }
    }
    await context.close();
    assert.deepEqual(found, []);
  });
}

test('B17 宽度扫描：没有任何一行以收尾标点或旁注序号开头', async () => {
  assert.deepEqual(await sweep(['sample', 'calculus', 'edge', 'matrix'], ['line/orphan-punct', 'line/orphan-ref']), []);
});

test('B17 旁注跟在加粗的词、行内代码、术语、链接、公式后的句号后面：按宽度扫描，序号不落到行首；很长的加粗短语照常在中间折行', async () => {
  const filler = '这是凑篇幅的文字，用来把后面的词推到一行的末尾附近。';
  const phrases = [
    '<strong>后进先出</strong>',
    '<code>deque</code>',
    '<dfn data-def="栈里放入和取出元素的那一端。">栈顶</dfn>',
    '<a href="https://example.com">一个链接</a>',
    '<em>着重的词</em>',
    '<span class="math">O(n)</span>。',
    '<strong>一个很长很长的加粗短语，长到一行里放不下它，需要在中间折行才行</strong>'
  ];
  const paragraphs = phrases.map(
    (phrase, index) =>
      `<p>${filler.repeat(1 + (index % 2))}这里是${phrase}<span class="note">第 ${index + 1} 条旁注。</span>，后面还有一句话，把这一段写得长一些。</p>`
  );
  const root = makeCourse('ref-after-inline', {
    'lesson.html': ['<section id="one">', '<h2>旁注跟在行内元素后面</h2>', ...paragraphs, '</section>'].join('\n')
  });
  const context = await newContext();
  const page = await open(context, root, 'lesson.html');
  await page.evaluate(() => document.fonts.ready);
  const run = await attachCheckup(page);
  const found = new Map();
  for (let width = 320; width <= 700; width += 3) {
    await page.setViewportSize({ width, height: 900 });
    for (const issue of await examine(run, ['line/orphan-ref', 'line/orphan-punct', 'page/overflow'])) {
      found.set(issue, [...(found.get(issue) ?? []), width]);
    }
  }
  // 很长的那个短语在窄屏上占了不止一行：它没有被整个捆成一行
  await page.setViewportSize({ width: 390, height: 900 });
  const lines = await page.evaluate(() => {
    const phrase = [...document.querySelectorAll('main p strong')].at(-1);
    return new Set([...phrase.getClientRects()].map((rect) => Math.round(rect.top))).size;
  });
  await context.close();
  assert.deepEqual(
    [...found].map(([issue, widths]) => `${issue}  @${widths.join(',')}`),
    []
  );
  assert.ok(lines >= 2, `很长的加粗短语在 390 宽度下折成了 ${lines} 行`);
});

test('B18 宽度扫描：长网址和长标识符不把上一行的字距拉开', async () => {
  assert.deepEqual(await sweep(['sample', 'edge'], ['line/stretched']), []);
});

/** 第一节的标题和它下面第一行正文，底边各在窗口里的什么位置。 */
const firstSection = (page) =>
  page.evaluate(() => {
    const heading = document.querySelector('main > section > h2');
    const range = document.createRange();
    range.selectNodeContents(heading.nextElementSibling);
    return {
      heading: Math.round(heading.getBoundingClientRect().bottom),
      firstLine: Math.round(range.getClientRects()[0].bottom)
    };
  });

test('手机首屏：示例课四讲，第一节的标题都在第一屏里；390×844 时正文的第一行也在', async () => {
  const root = course('sample');
  const found = [];
  for (const [width, height, wantLine] of [
    [390, 844, true],
    [320, 720, false]
  ]) {
    // 按手机来模拟：手机上的滚动条不占地方（Firefox 不支持这项模拟，它的滚动条本来就不占地方）
    const context = await newContext({ viewport: { width, height }, hasTouch: true, isMobile: ENGINE !== 'firefox' });
    for (const file of lessonFiles(root)) {
      const page = await open(context, root, file);
      const { heading, firstLine } = await firstSection(page);
      if (heading > height) found.push(`${file} @${width}×${height}：第一节的标题到了 ${heading}`);
      if (wantLine && firstLine > height) found.push(`${file} @${width}×${height}：正文第一行到了 ${firstLine}`);
      await page.close();
    }
    await context.close();
  }
  assert.deepEqual(found, []);
});

test('手机上导语和正文一样大，代码小一号，两级大标题缩小一些；宽屏上各是各的大小', async () => {
  const sizes = async (width) => {
    const context = await newContext({ viewport: { width, height: 900 } });
    const page = await open(context, course('sample'), '02-binary-search.html');
    const found = await page.evaluate(() => {
      const size = (selector) => parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
      const body = size('main > section > p');
      const ratio = (selector) => Math.round((size(selector) / body) * 100) / 100;
      return { lead: ratio('.lead'), code: ratio('main pre'), h1: ratio('main h1'), h2: ratio('main h2') };
    });
    await context.close();
    return found;
  };
  assert.deepEqual(await sizes(320), { lead: 1, code: 0.78, h1: 1.65, h2: 1.3 });
  assert.deepEqual(await sizes(1440), { lead: 1.2, code: 0.88, h1: 2.1, h2: 1.5 });
  const phone = await sizes(390);
  assert.ok(phone.h1 > 1.65 && phone.h1 < 2.1, `390 宽度下大标题在两头之间：${phone.h1}`);
});

test('B17 行内代码和链接里的长串：在字符之间断开，不把收尾标点带到行首；公式、序号前面的开引号不留在行尾', async () => {
  const filler = '这是凑篇幅的文字，把后面的东西推到一行的末尾附近。';
  const paragraphs = [
    `<p>${filler}调用 <code>find_max_position([4, 16, 9, 16])</code> 会返回几，和 <code>sys.getrecursionlimit()</code> 比呢？</p>`,
    `<p>${filler}<a href="https://example.com/a/very-long/path_name/index.html?query=1&amp;more=2#frag">https://example.com/a/very-long/path_name/index.html?query=1&amp;more=2#frag</a>之后还有话。</p>`,
    `<p>${filler}因为 <span class="math">1! = 1</span> 是已知的（<span class="math">0! = 1</span> 同样是约定好的），所以不必再拆。</p>`,
    `<p>${filler}追问的是“<span class="math">n</span> 变大以后谁说了算”，也就是增长的速度。</p>`
  ];
  const root = makeCourse('line-breaks', {
    'lesson.html': ['<section id="one">', '<h2>长串和开引号</h2>', ...paragraphs, '</section>'].join('\n')
  });
  const context = await newContext();
  const page = await open(context, root, 'lesson.html');
  await page.evaluate(() => document.fonts.ready);
  const run = await attachCheckup(page);
  const found = new Map();
  for (let width = 300; width <= 700; width += 3) {
    await page.setViewportSize({ width, height: 900 });
    for (const issue of await examine(run, ['line/orphan-punct', 'line/orphan-open', 'line/orphan-ref'])) {
      found.set(issue, [...(found.get(issue) ?? []), width]);
    }
  }
  // 长串确实在中间断开了（不是整个掉到下一行、也不是撑出去）
  await page.setViewportSize({ width: 320, height: 900 });
  const lines = await page.evaluate(() =>
    [...document.querySelectorAll('main p > code, main p > a')].map(
      (el) => new Set([...el.getClientRects()].map((rect) => Math.round(rect.top))).size
    )
  );
  await context.close();
  assert.deepEqual(
    [...found].map(([issue, widths]) => `${issue}  @${widths.join(',')}`),
    []
  );
  assert.ok(
    lines.every((count) => count >= 2),
    `320 宽度下三个长串都在中间断开：${lines.join(',')}`
  );
});

test('字号调到最大、窗口最窄时，整页不会横向滚动', async () => {
  // 字号是读者能调的；卡片和并排图的列原来用 em 作最小宽度，字一大，一列就比正文栏还宽
  const found = [];
  for (const size of [19, 21]) {
    const context = await newContext();
    await context.addInitScript((fontSize) => {
      localStorage.setItem(
        'zhixu:prefs',
        JSON.stringify({ theme: 'auto', font: 'serif', size: Number(fontSize), side: true })
      );
    }, size);
    for (const name of ['sample', 'matrix']) {
      const root = course(name);
      for (const file of ['index.html', ...lessonFiles(root)]) {
        const page = await open(context, root, file);
        const run = await attachCheckup(page);
        for (const width of [320, 340]) {
          await page.setViewportSize({ width, height: 900 });
          for (const issue of await examine(run, ['page/overflow']))
            found.push(`${size} 号字 ${width} 宽 ${name}/${file}  ${issue}`);
        }
        await page.close();
      }
    }
    await context.close();
  }
  assert.deepEqual([...new Set(found)], []);
});
