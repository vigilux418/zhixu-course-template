'use strict';
/* 旁注、术语的浮层，以及伸进页边的宽内容。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { ENGINE, course, makeCourse, newContext, open, fileUrl } = require('./harness');

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: ENGINE !== 'firefox' };
const SAMPLE = '02-binary-search.html';

/** 现在弹着的浮层：{ id, left, right, top, bottom }（在窗口里的位置）；没有就是 null。 */
const popped = (page) =>
  page.evaluate(() => {
    const pop = document.querySelector(':popover-open');
    if (!pop) return null;
    const { left, right, top, bottom } = pop.getBoundingClientRect();
    return { id: pop.id, left, right, top, bottom };
  });

const closed = (page) => page.waitForFunction(() => !document.querySelector(':popover-open'));

/** 点了之后稍等一下再看：浏览器在松手时关一次，脚本在 click 里再动一次，要看的是最后的结果。 */
const settle = (page) => page.waitForTimeout(250);

/** locator 所在的正文栏的左右边界，和它自己的上下边界。 */
const around = (locator) =>
  locator.evaluate((el) => {
    const column = el.closest('main > *').getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return { left: column.left, right: column.right, top: box.top, bottom: box.bottom };
  });

test('手机上点旁注的序号：注文在浮层里弹出来，句子不被切断，浮层不伸出正文栏', async () => {
  const context = await newContext(PHONE);
  const page = await open(context, course('sample'), SAMPLE);
  const ref = page.locator('.zx-ref button').first();
  // 放到屏幕中间：下方有地方，浮层就该在下方（各内核“滚到看得见”停的位置不一样，贴着屏幕下沿时浮层会改放到上方）
  await ref.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const paragraphHeight = () => ref.evaluate((el) => el.closest('p').getBoundingClientRect().height);
  const before = await paragraphHeight();
  assert.equal(await ref.getAttribute('aria-expanded'), 'false');

  await ref.tap();
  await page.locator('.zx-note:popover-open').waitFor();
  const pop = await popped(page);
  const at = await around(ref);
  assert.equal(pop.id, await ref.getAttribute('aria-controls'), '弹出来的就是这个序号的注文');
  assert.equal(await paragraphHeight(), before, '注文不占段落里的地方，句子没有被切断');
  assert.ok(pop.left >= at.left - 0.5 && pop.right <= at.right + 0.5, '浮层不伸出正文栏');
  assert.ok(pop.top >= at.bottom, '浮层在序号下方');
  assert.equal(await ref.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('旁注的浮层：再点一下序号、点别处、按 Esc 都能关上；键盘也能开关', async () => {
  const context = await newContext(PHONE);
  const page = await open(context, course('sample'), SAMPLE);
  const ref = page.locator('.zx-ref button').first();
  const note = page.locator('.zx-note:popover-open');
  await ref.scrollIntoViewIfNeeded();

  await ref.tap();
  await note.waitFor();
  await ref.tap();
  await settle(page);
  assert.equal(await popped(page), null, '再点一下序号就关上，不会又弹出来');
  assert.equal(await ref.getAttribute('aria-expanded'), 'false');

  await ref.tap();
  await note.waitFor();
  await page.locator('main h2').first().tap();
  await closed(page);

  await ref.tap();
  await note.waitFor();
  await page.keyboard.press('Escape');
  await closed(page);

  await ref.focus();
  await page.keyboard.press('Enter');
  await note.waitFor();
  await page.keyboard.press('Enter');
  await settle(page);
  assert.equal(await popped(page), null, '键盘上再按一下回车也是关上');
  await context.close();
});

const EVERYWHERE = [
  '<section id="places">',
  '<h2>各处的旁注</h2>',
  '<p>段落里的<span class="note" id="n-p">甲。</span>旁注。</p>',
  '<ul><li>列表里的<span class="note" id="n-li">乙。</span>旁注',
  '<ul><li>嵌套的列表里的<span class="note" id="n-nested">丙。</span>旁注</li></ul></li></ul>',
  '<div class="callout note"><p>提示卡里的<span class="note" id="n-callout">丁。</span>旁注。</p></div>',
  '<table><caption>一张表</caption><thead><tr><th>一列</th></tr></thead>',
  '<tbody><tr><td>表格里的<span class="note" id="n-table">戊。</span>旁注</td></tr></tbody></table>',
  '<ol class="steps"><li><h4>一步</h4><p>步骤里的<span class="note" id="n-step">己。</span>旁注。</p></li></ol>',
  '<blockquote><p>引文里的<span class="note" id="n-quote">庚。</span>旁注。</p></blockquote>',
  '<div class="cards"><div><h4>卡片</h4><p>卡片里的<span class="note" id="n-card">辛。</span>旁注。</p></div>',
  '<div><h4>另一张</h4><p>凑成一组。</p></div></div>',
  '</section>',
  '<section class="recap">',
  '<h2>本讲小结</h2>',
  '<ul><li>小结里的<span class="note" id="n-recap">壬。</span>旁注</li></ul>',
  '</section>'
].join('\n');

test('宽屏上只有小节里普通段落和普通列表里的旁注排在页边；别的容器里的收着，点序号弹出来', async () => {
  const root = makeCourse('notes-everywhere', { 'lesson.html': EVERYWHERE });
  const context = await newContext();
  const page = await open(context, root, 'lesson.html');
  const shown = await page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('.zx-note')].map((note) => [
        note.id,
        note.checkVisibility() ? getComputedStyle(note).float : '收着'
      ])
    )
  );
  assert.deepEqual(shown, {
    'n-p': 'right',
    'n-li': 'right',
    'n-nested': 'right',
    'n-callout': '收着',
    'n-table': '收着',
    'n-step': '收着',
    'n-quote': '收着',
    'n-card': '收着',
    'n-recap': '收着'
  });

  // 页边里的旁注一直看得见：点它的序号不弹浮层
  await page.locator('#n-p').evaluate((note) => note.previousElementSibling.querySelector('button').click());
  await settle(page);
  assert.equal(await popped(page), null);

  for (const id of ['n-callout', 'n-table', 'n-step', 'n-quote', 'n-card', 'n-recap']) {
    const ref = page.locator(`[aria-controls="${id}"]`);
    await ref.click();
    await page.locator(`#${id}:popover-open`).waitFor();
    const pop = await popped(page);
    const at = await around(ref);
    assert.ok(pop.left >= at.left - 0.5 && pop.right <= at.right + 0.5, `${id} 的浮层不伸出正文栏`);
    assert.ok(pop.top >= at.bottom || pop.bottom <= at.top, `${id} 的浮层在序号的下方或上方，不压住它`);
    await page.keyboard.press('Escape');
    await closed(page);
  }
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('旁注写在任务、选项、折叠块的标题里：在弹出来的注文上点一下，不算点了它们；注文里的链接照常能点', async () => {
  const root = makeCourse('notes-inside', {
    'lesson.html': [
      '<section id="first">',
      '<h2>第一节</h2>',
      '<ul class="tasks"><li>任务里的<span class="note" id="n-task">任务的旁注。</span>旁注</li></ul>',
      '<div class="quiz" data-answer="a"><p>选哪个？</p>',
      '<ol><li>选项里的<span class="note" id="n-option">选项的旁注。</span>旁注</li><li>另一个</li></ol></div>',
      '<details><summary>标题里的<span class="note" id="n-summary">标题的旁注。</span>旁注</summary><p>折叠的内容。</p></details>',
      '<div class="callout note"><p>带链接的<span class="note" id="n-link">见<a href="#second">第二节</a>。</span>旁注。</p></div>',
      '</section>',
      '<section id="second">',
      '<h2>第二节</h2>',
      '<p>正文。</p>',
      '</section>'
    ].join('\n')
  });
  const context = await newContext();
  const page = await open(context, root, 'lesson.html');
  const state = () =>
    page.evaluate(() => ({
      task: document.querySelector('.zx-task > input').checked,
      option: document.querySelector('.zx-opt > input').checked,
      details: document.querySelector('details:not(.callout)').open
    }));
  const untouched = { task: false, option: false, details: false };

  for (const id of ['n-task', 'n-option', 'n-summary']) {
    await page.locator(`[aria-controls="${id}"]`).click();
    await page.locator(`#${id}:popover-open`).click();
    assert.deepEqual(await state(), untouched, `点 ${id} 的序号和注文，都不会动到它所在的地方`);
    assert.equal((await popped(page)).id, id, '在注文上点，浮层不关');
    await page.keyboard.press('Escape');
    await closed(page);
  }

  await page.locator('[aria-controls="n-link"]').click();
  await page.locator('#n-link:popover-open a').click();
  await page.waitForFunction(() => window.ZHIXU.anchor() === 'second');
  await context.close();
});

test('浮层在下方放不下时放到上方；它跟着页面一起滚动；窗口变宽变窄时关上，只变高矮不关', async () => {
  const root = makeCourse('notes-place', { 'lesson.html': EVERYWHERE });
  const context = await newContext();
  const page = await open(context, root, 'lesson.html');
  const ref = page.locator('[aria-controls="n-callout"]');
  // 把窗口调矮，让序号正好在窗口的最下面一行
  const bottom = await ref.evaluate((el) => Math.ceil(el.getBoundingClientRect().bottom));
  await page.setViewportSize({ width: 1440, height: bottom + 4 });
  await ref.click();
  await page.locator('#n-callout:popover-open').waitFor();
  const above = await popped(page);
  assert.ok(above.bottom <= (await around(ref)).top, '下方放不下：浮层在序号上方');

  await page.evaluate(() => scrollBy(0, 120));
  const moved = await popped(page);
  assert.ok(Math.abs(above.top - moved.top - 120) <= 1, '页面滚了 120 像素，浮层跟着走了 120 像素');

  await page.setViewportSize({ width: 1440, height: 700 });
  await settle(page);
  assert.notEqual(await popped(page), null, '窗口只变了高矮：浮层还在');
  await page.setViewportSize({ width: 1100, height: 700 });
  await closed(page);
  await context.close();
});

test('搜索的词在收着的旁注里：落地时注文自己弹出来，词被标出来、看得见', async () => {
  const root = makeCourse('notes-find', {
    'lesson.html': [
      '<section id="first">',
      '<h2>第一节</h2>',
      ...Array.from({ length: 12 }, (_, index) => `<p>第 ${index + 1} 段，把页面撑长一些。</p>`),
      '<p>这句话带一条旁注<span class="note">只有这里提到鹦鹉螺。</span>，别处没有。</p>',
      '</section>'
    ].join('\n')
  });
  const context = await newContext(PHONE);
  const page = await open(context, root, 'lesson.html');
  await page.keyboard.press('/');
  await page.locator('.zx-dialog--search input').fill('鹦鹉螺');
  await page.locator('.zx-result').first().waitFor();
  await page.keyboard.press('Enter');
  await page.locator('.zx-note:popover-open').waitFor();
  const found = await page.evaluate(() => {
    const [range] = CSS.highlights.get('zx-find');
    const box = range.getBoundingClientRect();
    return { word: range.toString(), inView: box.height > 0 && box.top >= 0 && box.bottom <= innerHeight };
  });
  assert.deepEqual(found, { word: '鹦鹉螺', inView: true });
  await context.close();
});

test('术语的浮层：点一下弹出定义，再点一下关上；不伸出正文栏', async () => {
  const context = await newContext(PHONE);
  const page = await open(context, course('sample'), SAMPLE);
  const term = page.locator('dfn[role="button"]').first();
  await term.scrollIntoViewIfNeeded();
  await term.tap();
  await page.locator('.zx-pop:popover-open').waitFor();
  const pop = await popped(page);
  const at = await around(term);
  assert.ok(pop.left >= at.left - 0.5 && pop.right <= at.right + 0.5, '浮层不伸出正文栏');
  assert.ok((await page.locator('.zx-pop').textContent()).startsWith(await term.textContent()));

  await term.tap();
  await settle(page);
  assert.equal(await popped(page), null, '再点一下术语就关上');

  await term.focus();
  await page.keyboard.press('Enter');
  await page.locator('.zx-pop:popover-open').waitFor();
  await page.keyboard.press(' ');
  await settle(page);
  assert.equal(await popped(page), null, '键盘上再按一下也是关上');
  await context.close();
});

/** 页面上伸进页边的块：它是什么，右边比正文栏多出多少。 */
const wideBlocks = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.zx-wide')].map((block) => {
      const over = block.getBoundingClientRect().right - block.parentElement.getBoundingClientRect().right;
      return [block.matches('figure') ? 'figure' : block.classList[0], Math.round(over)];
    })
  );

test('正文栏里放不下的表格、代码和图伸进页边，右边和旁注对齐；放得下的不动', async () => {
  const context = await newContext();
  const page = await open(context, course('edge'), '01-edge.html');
  // 页边的宽度：旁注的宽度加上它和正文之间的空隙
  const margin = await page.evaluate(() => {
    const note = document.querySelector('.zx-note--margin').getBoundingClientRect();
    return Math.round(note.right - document.querySelector('main > section').getBoundingClientRect().right);
  });
  assert.deepEqual(await wideBlocks(page), [
    ['zx-table', margin],
    ['zx-code', margin],
    ['figure', margin]
  ]);
  const fitted = await page.evaluate(() => {
    const blocks = document.querySelectorAll('main > section > :is(.zx-table, .zx-code, figure):not(.zx-wide)');
    return [...blocks].filter(
      (block) => block.getBoundingClientRect().right > block.parentElement.getBoundingClientRect().right + 0.5
    ).length;
  });
  assert.equal(fitted, 0, '放得下的都还在正文栏里');
  // 伸出去之后，九列的表格不用再横向滚动
  const table = await page.evaluate(() => {
    const box = document.querySelector('.zx-table.zx-wide');
    return box.scrollWidth <= box.clientWidth && !box.hasAttribute('tabindex');
  });
  assert.ok(table);

  // 笔记停靠着：页边归笔记，宽内容收回来
  await page.keyboard.press('n');
  assert.deepEqual(
    (await wideBlocks(page)).map(([, over]) => over),
    [0, 0, 0]
  );
  await page.keyboard.press('Escape');
  assert.deepEqual(
    (await wideBlocks(page)).map(([, over]) => over),
    [margin, margin, margin]
  );

  // 窗口窄到没有页边：不伸
  await page.setViewportSize({ width: 900, height: 900 });
  assert.ok((await wideBlocks(page)).every(([, over]) => over <= 0));
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('窗口从手机的宽度拉到宽屏：哪些块伸进页边，和直接用宽屏打开时一样', async () => {
  const context = await newContext();
  const direct = await open(context, course('edge'), '01-edge.html');
  const expected = await wideBlocks(direct);
  await direct.close();

  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fileUrl(course('edge'), '01-edge.html'));
  await page.waitForSelector('html.zx-ready');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForFunction((count) => document.querySelectorAll('.zx-wide').length === count, expected.length);
  assert.deepEqual(await wideBlocks(page), expected);
  await context.close();
});

test('伸进页边的宽内容排在旁注下面，不压住它', async () => {
  const cells = (tag) => Array.from({ length: 12 }, (_, index) => `<${tag}>第${index + 1}列的内容</${tag}>`).join('');
  const root = makeCourse('wide-clear', {
    'lesson.html': [
      '<section id="first">',
      '<h2>第一节</h2>',
      `<p>一句话<span class="note" id="tall">${'这条旁注很长，比它所在的段落高出一大截。'.repeat(6)}</span>。</p>`,
      `<table id="wide"><caption>十二列的表格</caption><thead><tr>${cells('th')}</tr></thead>`,
      `<tbody><tr>${cells('td')}</tr></tbody></table>`,
      '</section>'
    ].join('\n')
  });
  const context = await newContext();
  const page = await open(context, root, 'lesson.html');
  const found = await page.evaluate(() => {
    const box = document.getElementById('wide').parentElement;
    return {
      wide: box.classList.contains('zx-wide'),
      below: box.getBoundingClientRect().top >= document.getElementById('tall').getBoundingClientRect().bottom
    };
  });
  assert.deepEqual(found, { wide: true, below: true });
  await context.close();
});
