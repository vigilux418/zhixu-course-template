'use strict';
/* 契约里是数据的部分（template/tools/lib/contract.js）在样式表和写作契约里各有一份：三处要一致。
 *   node --test engine/tests/contract.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { CALLOUTS, SVG_COLORS } = require(path.join(ROOT, 'template', 'tools', 'lib', 'contract.js'));
const css = (name) => fs.readFileSync(path.join(ROOT, 'engine', 'src', 'css', `${name}.css`), 'utf8');
const contract = fs.readFileSync(path.join(ROOT, 'template', 'AGENTS.md'), 'utf8');

/** 样式表里某个选择器的那一块声明：{ 属性: 值 }。 */
function block(text, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = new RegExp(`(?:^|\\n)${escaped} \\{\\n([^}]*)\\}`).exec(text);
  assert.ok(found, `样式表里没有 ${selector}`);
  const pairs = found[1]
    .split(';')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => [line.slice(0, line.indexOf(':')).trim(), line.slice(line.indexOf(':') + 1).trim()]);
  return Object.fromEntries(pairs);
}

test('提示卡的类型：样式表里每种类型各有颜色、图标和默认标题，标题和契约数据里的一样', () => {
  const components = css('components');
  const tokens = css('tokens');
  const styled = [...components.matchAll(/^\.callout\.([\w-]+) \{$/gm)].map((match) => match[1]);
  // note 是默认类型：它的颜色、图标和标题写在 .callout 上，别的类型各自改写
  assert.deepEqual(['note', ...styled], Object.keys(CALLOUTS));
  for (const [type, title] of Object.entries(CALLOUTS)) {
    const rule = block(components, type === 'note' ? '.callout' : `.callout.${type}`);
    assert.deepEqual(
      [rule['--c'], rule['--icon'], rule['--title']],
      [`var(--c-${type})`, `var(--icon-${type})`, `'${title}'`],
      `${type} 的颜色、图标、标题`
    );
    for (const token of [`--c-${type}:`, `--icon-${type}:`]) {
      assert.ok(tokens.includes(`  ${token} `), `tokens.css 里要有 ${token}`);
    }
  }
});

test('提示卡的类型：写作契约里的那张表，类型和默认标题逐行对得上', () => {
  const rows = [...contract.matchAll(/^\| `([\w-]+)` \| ([^|]+) \| [^|]+ \|$/gm)]
    .map((match) => [match[1], match[2].trim()])
    .filter(([type]) => type in CALLOUTS);
  assert.deepEqual(rows, Object.entries(CALLOUTS));
});

test('SVG 的颜色名：样式表里每个颜色各有填充和描边两个类，没有多出来的；写作契约里逐个列了出来', () => {
  const base = css('base');
  for (const kind of ['f', 's']) {
    const styled = [...base.matchAll(new RegExp(`^\\.${kind}-([\\w-]+) \\{$`, 'gm'))].map((match) => match[1]);
    assert.deepEqual(styled, SVG_COLORS, `${kind}- 开头的类`);
  }
  const listed = /颜色名：(.+?)；`f-颜色名`/.exec(contract)[1].match(/`([\w-]+)`/g);
  assert.deepEqual(
    listed.map((name) => name.slice(1, -1)),
    SVG_COLORS
  );
});
