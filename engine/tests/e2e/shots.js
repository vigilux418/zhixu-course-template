'use strict';
/* 截图工具：把一门测试课的每一页在几种宽度、三种主题下各截一张整页图，用来做改动前后的对照。
 *
 *   node engine/tests/e2e/shots.js <输出目录> [课程名…]     课程名默认是 sample matrix
 *   环境变量 ZX_ENGINE 选内核，ZX_WIDTHS（如 390,1440）和 ZX_THEMES（如 light,dark）缩小范围 */
const fs = require('fs');
const path = require('path');
const { course, newContext, open, lessonFiles, dispose } = require('./stage');

const [out, ...names] = process.argv.slice(2);
const widths = (process.env.ZX_WIDTHS || '390,1024,1440').split(',').map(Number);
const themes = (process.env.ZX_THEMES || 'light,sepia,dark').split(',');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  let count = 0;
  for (const name of names.length ? names : ['sample', 'matrix']) {
    const root = course(name);
    for (const width of widths) {
      const context = await newContext({ viewport: { width, height: 900 } });
      for (const file of ['index.html', ...lessonFiles(root)]) {
        for (const theme of themes) {
          const page = await open(context, root, file, `?theme=${theme}`);
          await page.evaluate(() => document.fonts.ready);
          const target = path.join(out, `${name}-${file.replace('.html', '')}-${width}-${theme}.jpg`);
          await page.screenshot({ path: target, fullPage: true, type: 'jpeg', quality: 82 });
          await page.close();
          count += 1;
        }
      }
      await context.close();
    }
  }
  await dispose();
  console.log(`截了 ${count} 张图，在 ${path.resolve(out)}`);
})();
