'use strict';
/* 启动：出错时把原因说清楚、正文照常可读；就绪的含义；地址的边角情况。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ENGINE, PACKED, course, freshCourse, newContext, open, fileUrl } = require('./harness');

const LESSON = '02-binary-search.html'; // 有代码也有公式

/** 打开一门被改坏的示例课，返回 { failed, ready, alert, bodyVisible }。 */
async function bootBroken(breakIt) {
  const root = freshCourse('sample');
  breakIt(root);
  const context = await newContext();
  const page = await open(context, root, LESSON);
  const state = await page.evaluate(() => ({
    failed: document.documentElement.classList.contains('zx-failed'),
    ready: document.documentElement.classList.contains('zx-ready'),
    alert: document.querySelector('.zx-alert')?.textContent ?? '',
    bodyVisible:
      getComputedStyle(document.body).visibility === 'visible' &&
      document.querySelector('main h1').getClientRects().length > 0
  }));
  await context.close();
  return state;
}

const FAILURES = [
  [
    '清单形状错误（units 不是数组）',
    (root) =>
      fs.writeFileSync(
        path.join(root, 'course', 'course.js'),
        'window.ZHIXU_COURSE = { id: "x", title: "坏清单", units: "oops" };\n'
      ),
    /flatMap|units/
  ],
  [
    'course.js 有语法错误',
    (root) => fs.writeFileSync(path.join(root, 'course', 'course.js'), 'window.ZHIXU_COURSE = ;\n'),
    /course\/course\.js.*语法错误.*build/
  ],
  ['data.js 缺失', (root) => fs.rmSync(path.join(root, 'course', 'data.js')), /course\/data\.js.*build/],
  ['运行时的文件缺失', (root) => fs.rmSync(path.join(root, 'template', 'app.js')), /无法加载 app\.js/],
  [
    '第三方库的文件缺失',
    (root) => fs.rmSync(path.join(root, 'template', 'vendor', 'katex', 'katex.min.js')),
    /无法加载 vendor\/katex\/katex\.min\.js/
  ]
];

// 单文件里什么都嵌在一起，没有哪个文件可以单独缺失或者写坏
const folderOnly = { skip: PACKED && '单文件里没有可以单独缺失的文件' };

for (const [label, breakIt, expected] of FAILURES) {
  test(`B07 启动失败时正文可见，并说明原因：${label}`, folderOnly, async () => {
    const state = await bootBroken(breakIt);
    assert.ok(state.failed, '应当标记为启动失败');
    assert.ok(state.bodyVisible, '正文应当可见');
    assert.match(state.alert, expected);
  });
}

test('B07 字体文件缺失时照常启动', folderOnly, async () => {
  const state = await bootBroken((root) => fs.rmSync(path.join(root, 'template', 'fonts', 'serif.woff')));
  assert.deepEqual([state.failed, state.ready, state.bodyVisible], [false, true, true]);
});

test('B13 zx-ready 出现时代码都着了色、公式都排好了，没有正在加载的字体；随后半秒内这三样都不再变', async () => {
  const context = await newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    const timer = setInterval(() => {
      if (!document.documentElement?.classList.contains('zx-ready')) return;
      clearInterval(timer);
      const count = (selector) => document.querySelectorAll(selector).length;
      const snapshot = () => ({
        fonts: [...document.fonts]
          .filter((face) => face.status !== 'unloaded')
          .map((face) => `${face.family} ${face.weight} ${face.status}`),
        formulas: count('main .math'),
        typeset: count('main .math:has(.katex)'),
        blocks: count('main pre[data-lang]:not([data-lang="text"])'),
        colored: count('main pre[data-lang]:not([data-lang="text"]):has([class^="hljs-"])'),
        tokens: count('main pre [class^="hljs-"]')
      });
      window.__fonts = { atReady: snapshot(), status: document.fonts.status };
      setTimeout(() => (window.__fonts.later = snapshot()), 500);
    }, 5);
  });
  const root = course('sample');
  await page.goto(fileUrl(root, LESSON));
  await page.waitForFunction(() => window.__fonts?.later);
  const fonts = await page.evaluate(() => window.__fonts);
  await context.close();
  const ready = fonts.atReady;
  assert.equal(fonts.status, 'loaded');
  assert.deepEqual(
    ready.fonts.filter((item) => item.endsWith('loading')),
    []
  );
  assert.ok(
    ready.formulas > 3 && ready.blocks > 3,
    `这一讲有公式也有代码：${ready.formulas} 处公式，${ready.blocks} 段代码`
  );
  assert.equal(ready.typeset, ready.formulas, '每一处公式都排好了');
  assert.equal(ready.colored, ready.blocks, '每一段代码都着了色');
  assert.deepEqual(fonts.later, ready, '就绪之后字体、公式、着色都不再变');
});

test('启动时先把页面改完、放行，再量尺寸：第一次读版面尺寸的时候，代码已经着了色，公式已经排好，页面已经放行', async () => {
  const context = await newContext();
  // 读这些属性会逼浏览器当场排版。页面还在改的时候读，后面改一点就得重排一遍
  await context.addInitScript(() => {
    const note = (name) => {
      window.__firstMeasure ??= {
        name,
        colored: Boolean(document.querySelector('pre [class^="hljs-"]')),
        typeset: Boolean(document.querySelector('.katex')),
        loading: document.documentElement.classList.contains('zx-loading'), // 放行之前页面不占版面，量到的都是零
        ready: document.documentElement.classList.contains('zx-ready')
      };
    };
    const getters = [
      [Element.prototype, ['clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight']],
      [HTMLElement.prototype, ['offsetWidth', 'offsetHeight', 'offsetLeft', 'offsetTop']]
    ];
    for (const [owner, names] of getters) {
      for (const name of names) {
        const { get } = Object.getOwnPropertyDescriptor(owner, name);
        Object.defineProperty(owner, name, {
          get() {
            note(name);
            return get.call(this);
          }
        });
      }
    }
    for (const name of ['getBoundingClientRect', 'getClientRects']) {
      const original = Element.prototype[name];
      Element.prototype[name] = function measured() {
        note(name);
        return original.call(this);
      };
    }
  });
  const page = await open(context, course('sample'), LESSON);
  const first = await page.evaluate(() => window.__firstMeasure);
  await context.close();
  assert.ok(first, '启动过程中量过尺寸（目录栏要滚到当前这一讲）');
  assert.deepEqual(
    { colored: first.colored, typeset: first.typeset, loading: first.loading, ready: first.ready },
    { colored: true, typeset: true, loading: false, ready: false },
    `第一次量的是 ${first.name}`
  );
});

test('加载的时候页面不占版面（浏览器不必先给作者写的原样排一遍版）；宽屏上目录栏的版式也压不过它', async () => {
  const context = await newContext({ viewport: { width: 1440, height: 900 } });
  const page = await open(context, course('sample'), LESSON);
  const found = await page.evaluate(() => {
    const root = document.documentElement;
    const display = () => getComputedStyle(document.body).display;
    const shown = display();
    root.classList.add('zx-loading');
    const loading = display();
    root.classList.remove('zx-loading');
    return { side: root.dataset.side, shown, loading, after: display() };
  });
  await context.close();
  assert.deepEqual(found, { side: 'on', shown: 'grid', loading: 'none', after: 'grid' });
});

test(
  '刷新页面之后还在原来读到的地方',
  {
    skip:
      (PACKED &&
        '单文件的滚动位置由运行时摆，不交给浏览器：刷新之后回到最近点过的那一节（packed.e2e.js），不回到像素位置') ||
      // 最初的引擎也一样：各量 12 次刷新，没回到原处的，最初的引擎 5 次，现在 4 次
      (ENGINE === 'webkit' && 'Playwright 的 WebKit 里，刷新后恢复滚动位置这件事本身时灵时不灵，当不了验收')
  },
  async () => {
    const context = await newContext({ viewport: { width: 1280, height: 800 } });
    const page = await open(context, course('sample'), LESSON);
    for (const top of [1500, 4200]) {
      await page.evaluate((y) => scrollTo(0, y), top);
      await page.waitForFunction((y) => Math.abs(scrollY - y) < 2, top);
      await page.reload();
      await page.waitForSelector('html.zx-ready');
      // 讲头里会多出一行“上次读到”，有的内核会跟着把位置往下挪这一行的高度
      await page.waitForFunction((y) => Math.abs(scrollY - y) <= 100, top);
    }
    await context.close();
  }
);

test('B23 地址里 # 后面的百分号编码不合法时照常启动', async () => {
  const context = await newContext();
  const page = await open(context, course('sample'), LESSON, '#100%');
  assert.equal(await page.evaluate(() => document.documentElement.className.includes('zx-failed')), false);
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('B15 文件名以 http 开头的讲义是课程里的链接，不是外部链接', async () => {
  const context = await newContext();
  const page = await open(context, course('edge'), '01-edge.html');
  const local = page.locator('main a', { hasText: 'HTTP 基础' }).first();
  assert.equal(await local.getAttribute('target'), null);
  const external = page.locator('main a[href^="https://example.com"]').first();
  assert.equal(await external.getAttribute('target'), '_blank');
  await page.emulateMedia({ media: 'print' });
  const suffix = (locator) => locator.evaluate((el) => getComputedStyle(el, '::after').content);
  assert.equal(await suffix(local), 'none', '打印时本地链接后面不附网址');
  assert.notEqual(await suffix(external), 'none', '打印时外部链接后面附上网址');
  await context.close();
});
