'use strict';
/* 浮层：拖选不误关、打开就能打字；宽屏上笔记停靠在页边，不遮正文；
 * 模态浮层开着时页面不跟着滚，遮罩盖满整个窗口，版面不横移。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { course, makeCourse, newContext, open, REPO } = require('./harness');
const { checkup } = require(path.join(REPO, 'template', 'tools', 'lib', 'checkup.js'));

const LESSON = '01-what-is-an-algorithm.html'; // 示例课第一讲：正文里有浮到页边的旁注

const notes = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.zx-dialog--sheet');
    return {
      open: Boolean(el?.open),
      modal: Boolean(el?.matches(':modal')),
      typing: document.activeElement?.matches('textarea.zx-notes') ?? false
    };
  });

/** 正文栏的左右边界。 */
const column = (page) =>
  page.evaluate(() => {
    const box = document.querySelector('main > section p').getBoundingClientRect();
    return [Math.round(box.left), Math.round(box.right)];
  });

/** 该进页边的旁注，现在各自的 float。 */
const floats = (page) =>
  page.evaluate(() => [...document.querySelectorAll('.zx-note--margin')].map((note) => getComputedStyle(note).float));

test('B10 笔记打开就能打字；在文本框里拖选、拖到面板外才松手，面板不关；点背景才关', async () => {
  const context = await newContext({ viewport: { width: 1024, height: 768 } });
  const page = await open(context, course('sample'), LESSON);
  await page.keyboard.press('n');
  await page.keyboard.type('直接打字，不用先点一下。');
  const area = page.locator('textarea.zx-notes');
  assert.equal(await area.inputValue(), '直接打字，不用先点一下。');
  assert.deepEqual(await notes(page), { open: true, modal: true, typing: true });

  const box = await area.boundingBox();
  await page.mouse.move(box.x + 80, box.y + 36);
  await page.mouse.down();
  await page.mouse.move(120, 400, { steps: 6 }); // 面板左边的背景上
  await page.mouse.up();
  assert.equal((await notes(page)).open, true, '拖选到面板外松手，面板应当还开着');

  await page.mouse.click(120, 400);
  assert.equal((await notes(page)).open, false, '在背景上按下并抬起，面板关闭');
  await context.close();
});

for (const width of [1280, 1440]) {
  test(`B10 ${width} 宽：笔记停靠在页边，不遮正文，正文照常滚动，快捷键照常`, async () => {
    const context = await newContext({ viewport: { width, height: 900 } });
    const page = await open(context, course('sample'), LESSON);
    const before = await column(page);
    const inMargin = await floats(page);
    assert.ok(inMargin.length > 0 && inMargin.every((value) => value === 'right'), '平时旁注浮在页边');

    await page.keyboard.press('n');
    await page.keyboard.type('边读边写。');
    assert.deepEqual(await notes(page), { open: true, modal: false, typing: true });
    assert.equal(await page.locator('textarea.zx-notes').inputValue(), '边读边写。');
    assert.deepEqual(await column(page), before, '正文栏不动');
    const panel = await page.locator('.zx-dialog--sheet').boundingBox();
    assert.ok(panel.x >= before[1], `面板的左边（${panel.x}）不越过正文的右边（${before[1]}）`);
    assert.ok(panel.width >= 240, `面板宽 ${panel.width}`);
    const edge = await page.evaluate(() => document.querySelector('main').getBoundingClientRect().right);
    assert.ok(Math.abs(panel.x + panel.width - edge) <= 1, '面板贴着版面的右边');
    assert.ok(
      (await floats(page)).every((value) => value === 'none'),
      '停靠时页边归笔记，旁注收进浮层'
    );
    const issues = await page.evaluate(`(${checkup})()`);
    assert.deepEqual(issues, [], '停靠时版面没有问题');

    await page.mouse.move(before[0] + 40, 500);
    await page.mouse.wheel(0, 900);
    await page.waitForFunction(() => scrollY > 500);
    const scrolled = await page.locator('.zx-dialog--sheet').boundingBox();
    assert.ok(scrolled.y >= 0 && scrolled.y + scrolled.height <= 901, '正文滚动之后，面板仍在视口里');

    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('/');
    await page.locator('.zx-dialog--search[open]').waitFor();
    assert.equal((await notes(page)).open, true, '打开搜索不会关掉停靠的笔记');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog:modal'));
    assert.equal((await notes(page)).open, true);

    await page.locator('textarea.zx-notes').focus();
    await page.keyboard.press('Escape');
    assert.equal((await notes(page)).open, false, '在面板里按 Esc 收起');
    assert.ok(
      (await floats(page)).every((value) => value === 'right'),
      '收起之后旁注回到页边'
    );

    // 面板收起后，浏览器要到下一帧才把焦点从里面的文本框挪开
    await page.waitForFunction(() => document.activeElement === document.body);
    await page.keyboard.press('n');
    assert.equal((await notes(page)).open, true);
    assert.equal(await page.locator('textarea.zx-notes').inputValue(), '边读边写。');
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('n');
    assert.equal((await notes(page)).open, false, '再按一次 n 收起');
    assert.deepEqual(page.errors, []);
    await context.close();
  });
}

test('B10 停靠着的时候窗口变窄：面板收起，再打开是滑出的面板', async () => {
  const context = await newContext({ viewport: { width: 1440, height: 900 } });
  const page = await open(context, course('sample'), LESSON);
  await page.keyboard.press('n');
  assert.deepEqual(await notes(page), { open: true, modal: false, typing: true });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForFunction(() => !document.querySelector('.zx-dialog--sheet').open);
  assert.ok((await floats(page)).every((value) => value === 'right'));
  await page.keyboard.press('n');
  assert.deepEqual(await notes(page), { open: true, modal: true, typing: true });
  await context.close();
});

test('B29 模态浮层开着的时候，后面的页面不跟着滚动；关掉之后照常滚动', async () => {
  const context = await newContext({ viewport: { width: 1024, height: 768 } });
  const page = await open(context, course('sample'), LESSON);
  await page.getByRole('button', { name: '外观与设置' }).click();
  await page.mouse.move(100, 600);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => scrollY), 0);

  await page.keyboard.press('Escape');
  await page.mouse.wheel(0, 600);
  await page.waitForFunction(() => scrollY > 300);
  await context.close();
});

test('B29 模态浮层开着的时候，遮罩盖满整个窗口，滚动条让出的那一条也盖住；页眉、进度线、正文和停靠着的笔记都不横移，关掉之后原样', async () => {
  const SHORT = makeCourse('short-page', {
    'lesson.html': ['<section id="one">', '<h2>一小节</h2>', '<p>只有一句话。</p>', '</section>'].join('\n')
  });
  const CASES = [
    ['长的一讲，滚动条在', course('sample'), LESSON, [1024, 768], true],
    ['很短的一页，没有滚动条，只留着它的位置', SHORT, 'lesson.html', [1024, 1600], false],
    ['宽屏，笔记停靠在页边', course('sample'), LESSON, [1440, 900], true]
  ];
  for (const [label, root, file, [width, height], scrolls] of CASES) {
    const context = await newContext({ viewport: { width, height } });
    const page = await open(context, root, file);
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), scrolls, label);
    if (scrolls) {
      await page.evaluate(() => scrollTo(0, 600));
      await page.waitForFunction(() => document.querySelector('.zx-progress').getBoundingClientRect().width > 0);
    }
    if (width >= 1280) {
      await page.keyboard.press('n');
      await page.locator('.zx-dialog--sheet[open]').waitFor();
      await page.evaluate(() => document.activeElement.blur()); // 焦点在笔记里的话，按 / 是打字
    }
    const places = () =>
      page.evaluate(() => {
        const edges = (selector) => {
          const box = document.querySelector(selector).getBoundingClientRect();
          return [box.left, box.right].map((value) => Math.round(value * 100) / 100);
        };
        return {
          text: edges('main > section p'),
          header: edges('.zx-header'),
          lastTool: edges('.zx-header > :last-child'),
          progress: edges('.zx-progress'),
          docked: document.querySelector('.zx-dialog--sheet[open]') ? edges('.zx-dialog--sheet') : null
        };
      });
    const before = await places();
    assert.equal(before.docked !== null, width >= 1280, label);

    await page.keyboard.press('/');
    await page.locator('dialog:modal').waitFor();
    const veil = await page.evaluate(() => [
      parseFloat(getComputedStyle(document.querySelector('dialog:modal'), '::backdrop').width),
      innerWidth
    ]);
    assert.equal(veil[0], veil[1], `${label}：遮罩和窗口一样宽`);
    assert.deepEqual(await places(), before, `${label}：浮层开着时版面不横移`);

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog:modal'));
    assert.deepEqual(await places(), before, `${label}：关掉之后版面原样`);
    await context.close();
  }
});

test('设置浮层在 320 到 414 宽的窗口里：每个选项的文字都是一行，整排不伸出浮层', async () => {
  // 选项整排是等宽的；“跟随系统”四个字在原来的做法下会折成两行
  const context = await newContext({ viewport: { width: 390, height: 844 } });
  const page = await open(context, course('sample'), LESSON);
  const found = [];
  for (const width of [320, 340, 360, 375, 390, 414]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: '外观与设置' }).click();
    const state = await page.evaluate(() => {
      const dialog = document.querySelector('dialog[open]');
      const range = document.createRange();
      return {
        lines: [...dialog.querySelectorAll('.zx-seg > label')].flatMap((label) => {
          const text = [...label.childNodes].find((node) => node.nodeType === 3);
          range.selectNodeContents(text);
          const count = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
          return count > 1 ? [`“${text.data.trim()}”折成 ${count} 行`] : [];
        }),
        overflow: Math.round(
          dialog.querySelector('.zx-seg').getBoundingClientRect().right - dialog.getBoundingClientRect().right
        )
      };
    });
    for (const line of state.lines) found.push(`${width} 宽：${line}`);
    if (state.overflow >= 0) found.push(`${width} 宽：选项伸出浮层 ${state.overflow} 像素`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  }
  await context.close();
  assert.deepEqual(found, []);
});

test('搜索结果的链接：按住 Ctrl 或 Command 点，不在这一页打开，也就不把词带过去', async () => {
  const context = await newContext({ viewport: { width: 1024, height: 768 } });
  const page = await open(context, course('sample'), '02-binary-search.html');
  const before = await page.evaluate(() => [location.href, ZHIXU.file, ZHIXU.anchor()]);
  await page.evaluate(() => sessionStorage.removeItem('zhixu:find'));
  await page.keyboard.press('/');
  await page.locator('.zx-dialog--search input').fill('递归');
  const result = page.locator('.zx-result').last();
  await result.waitFor();
  const href = await result.getAttribute('href');
  await result.click({ modifiers: ['Control'] });
  await page.waitForTimeout(300);
  const carried = await page.evaluate(() => sessionStorage.getItem('zhixu:find'));
  const after = await page.evaluate(() => [location.href, ZHIXU.file, ZHIXU.anchor()]);
  await context.close();
  assert.notEqual(href, null);
  assert.deepEqual(after, before, '按住 Ctrl 点，这一页不换');
  assert.equal(carried, null, '不在这一页打开，就不把词留在这一页');
});
