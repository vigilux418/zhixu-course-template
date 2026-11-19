'use strict';
/* 基础验收：字号、悬浮元素、三种主题的对比度、各个组件能用、触屏、打印版式、内置字体。
 * 这些是交付时已经成立的事，之后的改动不能把它们弄坏。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ENGINE, course, scratch, newContext, open, lessonFiles } = require('./harness');

const WIDTHS = [320, 390, 768, 1024, 1280, 1440];
const COURSES = ['sample', 'calculus'];

/** 在页面里测量：小于 12px 的中文、压住正文的悬浮元素。 */
function measureLayout() {
  const problems = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const small = new Set();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!/[一-鿿]/.test(node.data) || el.closest('dialog, [popover], svg, .katex, .zx-answers')) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || el.getClientRects().length === 0) continue;
    if (parseFloat(style.fontSize) < 12) small.add(`${el.tagName.toLowerCase()}.${el.className} ${style.fontSize}`);
  }
  for (const item of [...small].slice(0, 5)) problems.push(`中文小于 12px：${item}`);

  const main = document.querySelector('main')?.getBoundingClientRect();
  for (const el of main ? document.querySelectorAll('body *') : []) {
    const style = getComputedStyle(el);
    if (
      style.position !== 'fixed' ||
      el.closest('.zx-header, dialog, [popover]') ||
      el.matches('.zx-progress, .zx-skip')
    )
      continue;
    const box = el.getBoundingClientRect();
    if (box.width && box.height && box.right > main.left && box.left < main.right)
      problems.push(`悬浮元素压住正文：${el.className}`);
  }
  return problems;
}

/** 几种文字颜色与纸面的对比度（WCAG）。 */
function measureContrast() {
  const channel = (value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = (color) => {
    const [r, g, b] = color.match(/[\d.]+/g).map((part) => channel(Number(part) / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const body = getComputedStyle(document.body).backgroundColor;
  const paper = luminance(
    body === 'rgba(0, 0, 0, 0)' ? getComputedStyle(document.documentElement).backgroundColor : body
  );
  const probe = document.createElement('span');
  document.body.append(probe);
  const ratios = ['--text', '--muted', '--accent', '--ink'].map((token) => {
    probe.style.color = `var(${token})`;
    const ink = luminance(getComputedStyle(probe).color);
    return [token, (Math.max(ink, paper) + 0.05) / (Math.min(ink, paper) + 0.05)];
  });
  probe.remove();
  return ratios;
}

for (const name of COURSES) {
  test(`${name} 课：六种宽度下中文不小于 12px，没有悬浮元素压住正文，控制台没有报错`, async () => {
    const root = course(name);
    const found = [];
    for (const width of WIDTHS) {
      const context = await newContext({ viewport: { width, height: 900 } });
      for (const file of ['index.html', ...lessonFiles(root)]) {
        const page = await open(context, root, file);
        for (const problem of await page.evaluate(measureLayout)) found.push(`${file} @${width}  ${problem}`);
        for (const error of page.errors) found.push(`${file} @${width}  控制台报错：${error.slice(0, 160)}`);
        await page.close();
      }
      await context.close();
    }
    assert.deepEqual([...new Set(found)], []);
  });
}

test('三种主题下，正文、次要文字、强调色与纸面的对比度都不低于 4.5', async () => {
  const root = course('sample');
  const context = await newContext({ viewport: { width: 1280, height: 900 } });
  const low = [];
  for (const theme of ['light', 'sepia', 'dark']) {
    const page = await open(context, root, lessonFiles(root)[0], `?theme=${theme}`);
    for (const [token, ratio] of await page.evaluate(measureContrast)) {
      if (ratio < 4.5) low.push(`${theme} 主题的 ${token}：${ratio.toFixed(2)}`);
    }
    await page.close();
  }
  await context.close();
  assert.deepEqual(low, []);
});

for (const name of COURSES) {
  test(`${name} 课：小测、演示、选项卡、任务、盖章、搜索和快捷键都能用`, async () => {
    const root = course(name);
    for (const file of lessonFiles(root)) {
      const context = await newContext();
      const page = await open(context, root, file);
      const where = (what) => `${file}：${what}`;

      const choice = page.locator('.quiz[data-kind="choice"]').first();
      if (await choice.count()) {
        const answer = await choice.getAttribute('data-answer');
        await choice
          .locator('.zx-opt')
          .nth(answer === 'a' ? 1 : 0)
          .click();
        await choice.getByRole('button', { name: '检查答案' }).click();
        const hinted = (await choice.locator('.hint').count()) > 0;
        assert.equal(await choice.getAttribute('data-state'), hinted ? 'retry' : 'wrong', where('单选题答错后的状态'));
        if (hinted) {
          await choice.locator('.zx-opt').nth('abcdefgh'.indexOf(answer)).click();
          await choice.getByRole('button', { name: '检查答案' }).click();
          assert.equal(await choice.getAttribute('data-state'), 'right', where('看过提示后答对'));
        }
        await choice.getByRole('button', { name: '重做' }).click();
        assert.equal(await choice.getAttribute('data-state'), 'idle', where('重做后回到初始状态'));
      }

      const fill = page.locator('.quiz[data-kind="fill"]').first();
      if (await fill.count()) {
        await fill.locator('.zx-fill').fill((await fill.getAttribute('data-answer')).split('|')[0]);
        await fill.locator('.zx-fill').press('Enter');
        assert.equal(await fill.getAttribute('data-state'), 'right', where('填空题填入正确答案'));
      }

      const stepper = page.locator('.stepper').first();
      if (await stepper.count()) {
        await stepper.getByRole('button', { name: '下一步' }).click();
        assert.equal(await stepper.getAttribute('data-step'), '2', where('演示前进到第 2 步'));
        assert.equal(await stepper.locator('figure.is-current').count(), 1, where('演示只显示一帧'));
      }

      const tabs = page.locator('.zx-tabs').first();
      if (await tabs.count()) {
        await tabs.getByRole('tab').nth(1).click();
        assert.equal(await tabs.locator('[data-tab]:visible').count(), 1, where('选项卡只显示一页'));
      }

      const task = page.locator('.zx-task').first();
      if (await task.count()) {
        await task.click();
        assert.ok(await task.locator('input').isChecked(), where('任务被勾选'));
      }

      await page.locator('.zx-seal-slot').click();
      assert.equal(await page.locator('.zx-seal').count(), 1, where('盖章后出现印章'));
      assert.ok((await page.locator('.zx-side .zx-nav-link.is-done').count()) >= 1, where('目录里有读完的记号'));

      await page.keyboard.press('/');
      await page.locator('dialog[open]').waitFor();
      await page.keyboard.press('n');
      assert.equal(await page.locator('dialog[open]').count(), 1, where('浮层打开时单键快捷键不生效，浮层不叠加'));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('dialog[open]'));

      await page.reload();
      await page.waitForSelector('html.zx-ready');
      assert.equal(await page.locator('.zx-seal').count(), 1, where('刷新后印章保留'));
      await context.close();
    }
  });
}

test('触屏：点术语出定义，点旁注序号弹出注文，目录抽屉能打开', async () => {
  const root = course('sample');
  const context = await newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: ENGINE !== 'firefox'
  });
  const page = await open(context, root, lessonFiles(root)[0]);
  const term = page.locator('dfn[role="button"]').first();
  if (await term.count()) {
    await term.tap();
    await page.waitForFunction(() => document.querySelector('.zx-pop').matches(':popover-open'));
    await page.locator('h1').tap();
  }
  const ref = page.locator('.zx-ref button').first();
  if (await ref.count()) {
    await ref.tap();
    await page.locator('.zx-note:popover-open').waitFor();
  }
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await page.getByRole('button', { name: '目录' }).tap();
  await page.waitForFunction(() => document.querySelector('.zx-dialog--drawer')?.open);
  await context.close();
});

test(
  '打印：页眉、目录栏、讲末和按钮栏不进打印稿；能导出 PDF',
  { skip: ENGINE !== 'chromium' && '只有 Chromium 能导出 PDF' },
  async () => {
    const root = course('sample');
    const out = scratch('pdf');
    const context = await newContext({ viewport: { width: 1280, height: 900 } });
    for (const file of lessonFiles(root)) {
      const page = await open(context, root, file);
      await page.emulateMedia({ media: 'print' });
      const shown = await page.evaluate(() =>
        ['.zx-header', '.zx-side', '.zx-foot', '.zx-quiz-bar', '.zx-stepper-bar'].filter((selector) => {
          const el = document.querySelector(selector);
          return el && getComputedStyle(el).display !== 'none';
        })
      );
      assert.deepEqual(shown, [], `${file}：这些部分不该出现在打印稿里`);
      await page.emulateMedia({ media: null });
      const pdf = path.join(out, file.replace('.html', '.pdf'));
      await page.pdf({ path: pdf, format: 'A4', printBackground: true });
      assert.ok(fs.statSync(pdf).size > 10000, `${file}：PDF 不应当异常地小`);
      await page.close();
    }
    await context.close();
  }
);

test('内置的正文字体确实加载了', async () => {
  const root = course('sample');
  const context = await newContext();
  const page = await open(context, root, lessonFiles(root)[0]);
  assert.ok(await page.evaluate(() => document.fonts.ready.then(() => document.fonts.check('17px "Zhixu Serif"'))));
  await context.close();
});
