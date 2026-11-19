'use strict';
/* 笔记面板的基本功：写下的内容，刷新、换页、换宽度之后再打开都还在。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeCourse, newContext, open } = require('./harness');

const section = (text) => ['<section id="part">', '<h2>小节</h2>', `<p>${text}</p>`, '</section>'].join('\n');

/** 打开笔记面板，返回文本框。 */
async function openNotes(page) {
  await page.getByRole('button', { name: '本讲笔记', exact: true }).click();
  const area = page.locator('textarea.zx-notes');
  await area.waitFor();
  return area;
}

for (const [label, viewport] of [
  ['宽屏（停靠的面板）', { width: 1440, height: 900 }],
  ['手机（滑出的面板）', { width: 390, height: 844 }]
]) {
  test(`笔记：写下之后刷新页面，再打开面板内容还在；每一讲各记各的（${label}）`, async () => {
    const root = makeCourse('notes', { 'a.html': section('第一讲。'), 'b.html': section('第二讲。') });
    const context = await newContext({ viewport });
    const page = await open(context, root, 'a.html');
    await (await openNotes(page)).pressSequentially('第一讲的笔记。');

    await page.reload();
    await page.waitForSelector('html.zx-ready');
    assert.equal(await (await openNotes(page)).inputValue(), '第一讲的笔记。', '刷新之后再打开');

    const other = await open(context, root, 'b.html');
    const area = await openNotes(other);
    assert.equal(await area.inputValue(), '', '另一讲的笔记本是空的');
    await area.pressSequentially('第二讲的笔记。');

    const again = await open(context, root, 'a.html');
    assert.equal(await (await openNotes(again)).inputValue(), '第一讲的笔记。');
    await context.close();
  });
}
