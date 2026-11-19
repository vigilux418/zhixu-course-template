'use strict';
/* 备课工具各模块导出的名字都要有人用：别的工具模块，或者测试。
 *   node --test engine/tests/tools/exports.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ENGINE = path.join(__dirname, '..', '..');
const TEMPLATE = path.join(ENGINE, '..', 'template');
const LIB = path.join(TEMPLATE, 'tools', 'lib');

const sources = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(file);
    return entry.name.endsWith('.js') ? [file] : [];
  });

const body = (file) => fs.readFileSync(file, 'utf8');

/** 匹配对某个名字的引用：不是别的名字的一部分，也不是属性访问（a.name），但展开运算（...name）算引用。 */
const uses = (text, identifier) => {
  const name = identifier.replace(/\$/g, '\\$');
  return new RegExp(`(?<![\\w$])(?<!(?:^|[^.])\\.)${name}(?![\\w$])`).test(text);
};

test('工具模块导出的每个名字都有别处用到', () => {
  const others = [...sources(path.join(TEMPLATE, 'tools')), ...sources(ENGINE)];
  const idle = [];
  for (const file of fs.readdirSync(LIB).filter((name) => name.endsWith('.js'))) {
    const self = path.join(LIB, file);
    const match = /module\.exports\s*=\s*\{([\s\S]*?)\};/.exec(body(self));
    if (!match) continue;
    const exported = match[1]
      .split(',')
      .map((item) => item.trim().split(/\s*:\s*/)[0])
      .filter(Boolean);
    for (const identifier of exported) {
      const used = others.filter((other) => other !== self).some((other) => uses(body(other), identifier));
      if (!used) idle.push(`${file} 导出的 ${identifier} 没有被别处用到`);
    }
  }
  assert.deepStrictEqual(idle, []);
});
