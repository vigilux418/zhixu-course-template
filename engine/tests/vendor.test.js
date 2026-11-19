'use strict';
/* 第三方库：样式里引用的每个字体文件都随包分发。
 *   node --test engine/tests/vendor.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const KATEX = path.join(__dirname, '..', '..', 'template', 'vendor', 'katex');

test('KaTeX 的样式只引用随包分发的字体文件', () => {
  const css = fs.readFileSync(path.join(KATEX, 'katex.min.css'), 'utf8');
  const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((match) => match[1]);
  assert.ok(urls.length > 0, '样式里应当有字体');
  assert.deepStrictEqual(
    urls.filter((url) => !fs.existsSync(path.join(KATEX, url))),
    []
  );
});
