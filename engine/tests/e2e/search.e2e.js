'use strict';
/* 搜索和术语表：落到命中处并标出来；藏在折叠块、选项卡、演示里的先亮出来。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { course, newContext, open, arrived } = require('./harness');

/** 标出来的词，以及第一处是不是在视口里、看不看得见。 */
const landing = (page) =>
  page.evaluate(() => {
    const ranges = [...(CSS.highlights.get('zx-find') ?? [])];
    if (!ranges.length) return null;
    const box = ranges[0].getBoundingClientRect();
    const el = ranges[0].startContainer.parentElement;
    return {
      words: [...new Set(ranges.map((range) => range.toString()))],
      inView: box.height > 0 && box.top >= 0 && box.bottom <= innerHeight,
      visible: el.checkVisibility({ visibilityProperty: true })
    };
  });

/** 在搜索框里输入一个词并回车。 */
async function search(page, word) {
  await page.keyboard.press('/');
  await page.locator('.zx-dialog--search input').fill(word);
  await page.locator('.zx-result').first().waitFor();
  await page.keyboard.press('Enter');
}

const HIDDEN = [
  ['普通段落里', '独角兽'],
  ['收起的折叠块里', '独角鲸'],
  ['没选中的选项卡里', '独角仙'],
  ['演示的第二帧里', '独角犀']
];

for (const [where, word] of HIDDEN) {
  test(`B22 从别的页面搜索${where}的词：回车后落到命中处，词被标出来`, async () => {
    const context = await newContext();
    const page = await open(context, course('edge'), '01-edge.html');
    await search(page, word);
    await arrived(page, '02-more.html');
    assert.deepEqual(await landing(page), { words: [word], inView: true, visible: true });
    await context.close();
  });
}

test('B22 搜索的词就在本页：浮层关掉，同样落到命中处；点一下页面，标记撤掉', async () => {
  const context = await newContext();
  const page = await open(context, course('edge'), '02-more.html');
  await search(page, '独角鲸');
  await page.waitForFunction(() => CSS.highlights.has('zx-find'));
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.deepEqual(await landing(page), { words: ['独角鲸'], inView: true, visible: true });

  await page.mouse.click(700, 300);
  assert.equal(await landing(page), null);
  await context.close();
});

test('B22 一个词被标签隔开（一半加粗）也标得出来；搜索不分大小写', async () => {
  const context = await newContext();
  const page = await open(context, course('edge'), '02-more.html');
  await search(page, '麒麟臂');
  await page.waitForFunction(() => CSS.highlights.has('zx-find'));
  assert.deepEqual((await landing(page)).words, ['麒麟臂']);

  await page.mouse.click(700, 300);
  await search(page, 'camelcase');
  await page.waitForFunction(() => CSS.highlights.has('zx-find'));
  assert.deepEqual((await landing(page)).words, ['CamelCase']);
  await context.close();
});

test('B22 术语表的链接直接落到定义处，术语被标出来', async () => {
  const context = await newContext();
  const page = await open(context, course('sample'), 'index.html');
  const link = page.locator('.zx-glossary a').first();
  const term = await link.textContent();
  // 文件夹里是 讲义.html#锚点，单文件里是 #讲义.html/锚点
  const target = /^#?([a-z0-9-]+\.html)[#/]([a-z][a-z0-9-]*)$/.exec(await link.getAttribute('href'));
  assert.ok(target, '术语表的链接带着小节的锚点');
  await link.click();
  await arrived(page, target[1], target[2]);
  const found = await landing(page);
  assert.deepEqual([found.words, found.inView, found.visible], [[term], true, true]);
  await context.close();
});

test('B22 地址里的锚点指着折叠块里面的东西：打开页面时先把折叠块展开', async () => {
  const context = await newContext();
  const page = await open(context, course('edge'), '02-more.html', '#in-fold');
  const found = await page.evaluate(() => {
    const target = document.getElementById('in-fold');
    const box = target.getBoundingClientRect();
    return [target.closest('details').open, box.height > 0 && box.top >= 0 && box.top < innerHeight];
  });
  assert.deepEqual(found, [true, true]);
  await context.close();
});

test('搜索：图里的字不进索引（微积分课的“1 + h”只写在 SVG 的标签里）', async () => {
  const context = await newContext({ viewport: { width: 1024, height: 768 } });
  const page = await open(context, course('calculus'), '02-derivatives.html');
  await page.keyboard.press('/');
  const input = page.locator('.zx-dialog--search input');
  await input.fill('1 + h');
  await page.waitForTimeout(500);
  const hits = await page.locator('.zx-result').count();
  const empty = await page.locator('.zx-dialog--search').innerText();
  await context.close();
  assert.equal(hits, 0, `图里的字不该搜出来；实际搜到 ${hits} 条：${empty.slice(0, 120)}`);
});
