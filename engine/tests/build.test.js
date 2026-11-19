'use strict';
/* 构建产物与源码保持同步：改了 engine/src 却忘了重新构建，这里会报出来。
 *   node --test engine/tests/build.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const TEMPLATE = path.join(ROOT, 'template');
const OUTPUTS = ['zhixu.css', 'zhixu.js', 'app.js'];

test('template/ 里的运行文件就是当前源码的构建结果', () => {
  const before = OUTPUTS.map((name) => fs.readFileSync(path.join(TEMPLATE, name), 'utf8'));
  execFileSync('node', [path.join(ROOT, 'engine', 'build.js')]);
  const after = OUTPUTS.map((name) => fs.readFileSync(path.join(TEMPLATE, name), 'utf8'));
  OUTPUTS.forEach((name, index) =>
    assert.strictEqual(before[index], after[index], `${name} 不是最新的，请运行 node engine/build.js`)
  );
});

test('运行时是普通脚本：没有 import / export，也不依赖模块加载', () => {
  const app = fs.readFileSync(path.join(TEMPLATE, 'app.js'), 'utf8');
  assert.doesNotMatch(app, /^(import|export)\b/m);
});

test('运行时里没有空的 catch，也没有调试输出', () => {
  const app = fs.readFileSync(path.join(TEMPLATE, 'app.js'), 'utf8');
  assert.doesNotMatch(app, /catch\s*(\([^)]*\))?\s*\{\s*\}/);
  assert.doesNotMatch(app, /console\.(log|debug)|debugger/);
});

test('字体文件都在，且样式里引用的字体都存在', () => {
  const css = fs.readFileSync(path.join(TEMPLATE, 'zhixu.css'), 'utf8');
  const fonts = [...css.matchAll(/url\(["']?(fonts\/[\w.-]+)["']?\)/g)].map((match) => match[1]);
  assert.ok(fonts.length >= 3);
  for (const font of fonts) assert.ok(fs.existsSync(path.join(TEMPLATE, font)), `缺少 ${font}`);
});

test('第三方库已就位', () => {
  for (const file of ['vendor/katex/katex.min.js', 'vendor/katex/katex.min.css', 'vendor/highlight/highlight.min.js']) {
    assert.ok(fs.existsSync(path.join(TEMPLATE, file)), `缺少 ${file}`);
  }
});

test('模板版本文件与引擎包版本保持一致', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'engine', 'package.json'), 'utf8'));
  const version = fs.readFileSync(path.join(TEMPLATE, 'VERSION'), 'utf8').trim();
  assert.ok(/^\d+\.\d+\.\d+/.test(version), `非法版本号：${version}`);
  assert.strictEqual(version, pkg.version);
});

test('分发模板的 MIT 许可与仓库根目录一致', () => {
  const license = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  assert.strictEqual(fs.readFileSync(path.join(TEMPLATE, 'LICENSE'), 'utf8'), license);
});
