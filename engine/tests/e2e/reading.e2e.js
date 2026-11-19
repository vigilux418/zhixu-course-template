'use strict';
/* 阅读一讲时的细节：目录高亮、讲头的统计、作者写的 id、目录抽屉、快捷键、输入法。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ENGINE, PACKED, course, makeCourse, newContext, open, arrived, lessonFiles } = require('./harness');

const LESSON = 'lesson.html';
const filler = (label) =>
  Array.from(
    { length: 14 },
    (_, index) => `<p>${label}的第 ${index + 1} 段。${'这是凑篇幅的文字。'.repeat(12)}</p>`
  ).join('\n');
const section = (id, content) => [`<section id="${id}">`, `<h2>小节 ${id}</h2>`, content, '</section>'].join('\n');

const activeSection = (page) =>
  page.evaluate(() => document.querySelector('.zx-side .zx-toc a.is-active')?.dataset.section ?? null);

test('B11 读到页末时，目录里亮着的是最后一节，阅读位置也记到它', async () => {
  const root = makeCourse('ending', {
    [LESSON]: [
      section('first', filler('第一节')),
      section('second', filler('第二节')),
      section('last', '<p>最后一节只有一句话。</p>')
    ].join('\n')
  });
  const context = await newContext();
  const page = await open(context, root, LESSON);

  await page.evaluate(() => document.getElementById('second').scrollIntoView());
  await page.waitForFunction(
    () => document.querySelector('.zx-side .zx-toc a.is-active')?.dataset.section === 'second'
  );

  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForFunction(() => document.querySelector('.zx-side .zx-toc a.is-active')?.dataset.section === 'last');
  const place = await page.evaluate(() => JSON.parse(localStorage.getItem('zhixu:course:ending')).place);
  assert.equal(place[LESSON], 'last');

  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForFunction(() => !document.querySelector('.zx-side .zx-toc a.is-active'));
  assert.equal(await activeSection(page), null, '回到页首，标题之前不属于任何一节');
  await context.close();
});

test('阅读进度线：滚到哪儿，线就长到哪儿；滚动时不改写根元素的样式（改写一次，整页的样式都要重算一遍）', async () => {
  const context = await newContext();
  const page = await open(context, course('sample'), '02-binary-search.html');
  const state = () =>
    page.evaluate(() => ({
      read: parseFloat(getComputedStyle(document.querySelector('.zx-progress')).scale),
      root: document.documentElement.getAttribute('style')
    }));
  const scrolledTo = async (share) => {
    await page.evaluate((part) => scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * part), share);
    await page.waitForFunction(
      (part) => Math.abs(parseFloat(getComputedStyle(document.querySelector('.zx-progress')).scale) - part) < 0.02,
      share
    );
    return state();
  };

  const top = await state();
  assert.equal(top.read, 0, '在页面顶上，线的长度是零');
  const middle = await scrolledTo(0.5);
  const bottom = await scrolledTo(1);
  assert.deepEqual([middle.root, bottom.root], [top.root, top.root], '根元素的样式一个字都没变');
  await context.close();
});

// 单文件里的目录数据是导出那一刻现算的，没有“改了讲义还没重新 build”这回事
const folderOnly = { skip: PACKED && '只有文件夹形态才会有过期的目录数据' };

test('B19 改了讲义还没重新 build：讲头的小节数和小测数按这一页现数', folderOnly, async () => {
  const root = makeCourse('stale', { [LESSON]: section('first', '<p>正文。</p>') });
  const file = path.join(root, LESSON);
  const added = [
    section('added', '<p>后来加的一节。</p>'),
    '<div class="quiz" data-answer="a">',
    '  <p>后来加的一道题。</p>',
    '  <ol><li>对</li><li>错</li></ol>',
    '</div>'
  ].join('\n');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('</main>', `${added}\n</main>`));

  const context = await newContext();
  const page = await open(context, root, LESSON);
  const meta = await page.locator('.zx-meta').textContent();
  assert.match(meta, /2 个小节/);
  assert.match(meta, /1 道小测/);
  await context.close();
});

for (const name of ['matrix', 'edge', 'sample']) {
  test(`B40 作者写的 id 归作者：${name} 课源文件里的每个 id，启动后都还在页面里`, async () => {
    const root = course(name);
    const context = await newContext();
    for (const file of lessonFiles(root)) {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      const ids = [...source.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
      const page = await open(context, root, file);
      const lost = await page.evaluate((wanted) => wanted.filter((id) => !document.getElementById(id)), ids);
      assert.deepEqual(lost, [], `${file} 里这些 id 不见了`);
      assert.ok(ids.length > 0, `${file} 里应当有 id`);
      await page.close();
    }
    await context.close();
  });
}

test('小节标题后面的链接：鼠标移到标题上才出现；点它，地址指到这一节，页面不重新载入；键盘走到它也看得见；打印稿里没有', async () => {
  const context = await newContext();
  const page = await open(context, course('sample'), '02-binary-search.html');
  const heading = page.locator('#binary-code > h2');
  const link = heading.locator('.zx-anchor');
  const opacity = () => link.evaluate((el) => getComputedStyle(el).opacity);
  const settled = () => link.evaluate((el) => Promise.allSettled(el.getAnimations().map((item) => item.finished)));

  assert.equal(await page.locator('main > section > h2 > .zx-anchor').count(), 7, '六个小节和小结，各有一个');
  assert.equal(await link.getAttribute('aria-label'), '2.3 节的链接');
  assert.equal(await page.locator('.recap .zx-anchor').getAttribute('aria-label'), '本讲小结的链接');
  assert.equal(await heading.evaluate((el) => el.textContent), '把区间写进代码', '标题的文字没有多出东西');
  assert.equal(await opacity(), '0', '平时不显示');

  await heading.hover();
  await settled();
  assert.equal(await opacity(), '1', '鼠标移到标题上就出现');

  await page.evaluate(() => (window.__same = true));
  await link.click();
  await page.waitForFunction(() => window.ZHIXU.anchor() === 'binary-code');
  assert.equal(await page.evaluate(() => window.__same), true, '页面没有重新载入');

  await page.mouse.move(5, 300);
  await settled();
  // 先按一下 Tab，浏览器才知道读者在用键盘；再把焦点放到链接上（WebKit 默认不让 Tab 停在链接上）
  await page.keyboard.press('Tab');
  await page.locator('#binary-demo > h2 > .zx-anchor').focus();
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    return [el.matches('.zx-anchor:focus-visible'), getComputedStyle(el).opacity];
  });
  assert.deepEqual(focused, [true, '1'], '键盘走到它：立刻看得见');

  await page.emulateMedia({ media: 'print' });
  assert.equal(await link.evaluate((el) => getComputedStyle(el).display), 'none');
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('小节标题后面的链接不占地方：标题正好排满一行时，它不把标题挤出一个空行，也不伸出标题的框', async () => {
  // 正文栏宽 39 个正文字，正好是 26 个小节标题的字：从 20 个字到 28 个字都试一遍，再加两个要折成两行的
  const title = (length) => '二分查找每次都把候选的范围缩小一半'.repeat(4).slice(0, length);
  const lengths = [20, 21, 22, 23, 24, 25, 26, 27, 28, 50, 52];
  const root = makeCourse('anchor-fit', {
    'lesson.html': lengths
      .map((length) => `<section id="s${length}">\n<h2>${title(length)}</h2>\n<p>正文。</p>\n</section>`)
      .join('\n')
  });
  for (const width of [1440, 1000, 760]) {
    const context = await newContext({ viewport: { width, height: 900 } });
    const page = await open(context, root, 'lesson.html');
    const heights = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('main > section > h2')].map((heading) =>
          Math.round(heading.getBoundingClientRect().height)
        )
      );
    const withLinks = await heights();
    const placed = await page.evaluate(() => ({
      outside: [...document.querySelectorAll('main > section > h2')].filter((heading) => {
        const link = heading.querySelector('.zx-anchor').getBoundingClientRect();
        const box = heading.getBoundingClientRect();
        return !(link.width > 0 && link.right <= box.right + 0.5 && link.bottom <= box.bottom + 0.5);
      }).length,
      overflowing: document.documentElement.scrollWidth > document.documentElement.clientWidth
    }));
    await page.addStyleTag({ content: '.zx-anchor { display: none !important; }' });
    assert.deepEqual(withLinks, await heights(), `${width} 宽：有没有链接，每个标题都一样高`);
    assert.deepEqual(placed, { outside: 0, overflowing: false }, `${width} 宽：图标都在标题的框里，页面不横向溢出`);
    await context.close();
  }
});

test('触屏上小节标题后面没有链接（没有“移上去”），标题的断行不受影响', async (t) => {
  const context = await newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: ENGINE !== 'firefox'
  });
  const page = await open(context, course('sample'), '02-binary-search.html');
  if (!(await page.evaluate(() => matchMedia('(hover: none)').matches))) {
    await context.close();
    t.skip('这个内核的模拟环境不报告触屏指针');
    return;
  }
  const shown = await page.evaluate(
    () => [...document.querySelectorAll('.zx-anchor')].filter((link) => link.getClientRects().length > 0).length
  );
  assert.equal(shown, 0);
  await context.close();
});

test('B40 “跳到正文”落在 <main> 实际的 id 上；带 id 的旁注，序号按钮指向它', async () => {
  const context = await newContext();
  const page = await open(context, course('edge'), '02-more.html');
  const found = await page.evaluate(() => ({
    skip: document.querySelector('.zx-skip').getAttribute('href'),
    main: document.querySelector('main').id,
    controls: document
      .getElementById('note-kept')
      .previousElementSibling.querySelector('button')
      .getAttribute('aria-controls')
  }));
  assert.deepEqual(found, { skip: '#page-top', main: 'page-top', controls: 'note-kept' });
  await context.close();
});

test('B41 长课里从最后一讲打开目录抽屉，当前这一讲就在看得见的地方', async () => {
  const root = course('long');
  const context = await newContext({ viewport: { width: 390, height: 844 } });
  const page = await open(context, root, lessonFiles(root).at(-1));
  await page.getByRole('button', { name: '目录' }).click();
  await page.locator('.zx-dialog--drawer[open]').waitFor();
  const seen = () =>
    page.evaluate(() => {
      const drawer = document.querySelector('.zx-dialog--drawer');
      const row = drawer.querySelector('[aria-current="page"]').getBoundingClientRect();
      const body = drawer.querySelector('.zx-dialog-body').getBoundingClientRect();
      return row.top >= body.top && row.bottom <= Math.min(body.bottom, innerHeight);
    });
  assert.ok(await seen(), '第一次打开');

  // 滚到别处，关掉再打开，又回到当前这一讲
  await page.evaluate(() => (document.querySelector('.zx-dialog--drawer .zx-dialog-body').scrollTop = 0));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '目录' }).click();
  assert.ok(await seen(), '再次打开');
  await context.close();
});

test('B36 首页按 ] 进入“开始阅读”的那一讲', async () => {
  const root = course('sample');
  const context = await newContext();
  const page = await open(context, root, 'index.html');
  await page.keyboard.press(']');
  await arrived(page, lessonFiles(root)[0]);
  await context.close();
});

for (const [platform, key] of [
  ['MacIntel', '⌘ K'],
  ['Win32', 'Ctrl K']
]) {
  test(`B36 快捷键说明按平台写：${platform} 上是 ${key}`, async () => {
    const context = await newContext();
    await context.addInitScript((value) => {
      Object.defineProperty(Navigator.prototype, 'platform', { get: () => value });
    }, platform);
    const page = await open(context, course('sample'), 'index.html');
    await page.getByRole('button', { name: '外观与设置' }).click();
    assert.ok((await page.locator('.zx-keys').textContent()).includes(`也可以按 ${key}`));
    await context.close();
  });
}

/** 在一个元素上派发一次按键；extra 里可以带 isComposing 或 keyCode。 */
const keydown = (locator, key, extra = {}) =>
  locator.evaluate(
    (el, init) => el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })),
    { key, ...extra }
  );

test('B30 输入法选字时按回车：填空题不提前提交', async () => {
  const context = await newContext();
  const page = await open(context, course('matrix'), '03-quizzes.html');
  const quiz = page.locator('#quiz-fill');
  const field = quiz.locator('input.zx-fill');
  await field.fill('半截答案');
  await keydown(field, 'Enter', { isComposing: true });
  await keydown(field, 'Enter', { keyCode: 229 });
  assert.equal(await quiz.getAttribute('data-state'), 'idle', '选字的回车不算提交');
  await keydown(field, 'Enter');
  assert.notEqual(await quiz.getAttribute('data-state'), 'idle', '平常的回车提交答案');
  await context.close();
});

test('B30 输入法选字时按回车和方向键：搜索不跳走、不换结果', async () => {
  const context = await newContext();
  const page = await open(context, course('sample'), 'index.html');
  const home = await page.evaluate(() => [location.href, ZHIXU.file, ZHIXU.anchor()]);
  await page.keyboard.press('/');
  const input = page.locator('.zx-dialog--search input');
  await input.fill('算法');
  const selected = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.zx-result')].findIndex((item) => item.getAttribute('aria-selected') === 'true')
    );
  assert.equal(await selected(), 0);
  await keydown(input, 'ArrowDown', { isComposing: true });
  await keydown(input, 'Enter', { isComposing: true });
  await keydown(input, 'Enter', { keyCode: 229 });
  assert.equal(await selected(), 0, '选字时的方向键不换结果');
  assert.deepEqual(await page.evaluate(() => [location.href, ZHIXU.file, ZHIXU.anchor()]), home, '选字时的回车不跳走');
  await keydown(input, 'ArrowDown');
  assert.equal(await selected(), 1);
  await context.close();
});
