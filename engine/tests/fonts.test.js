'use strict';
/* 内置字体：字表本身对不对，正文字体盖不盖得住它，检查器的提示是否跟着更新了。
 * 字体文件是不是真的把这些字画出来了，由端到端验收去看（components.e2e.js 里的 B27）。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { fragmentPage, problemsOf } = require('./tools/helpers');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const charsOf = (text) => [...text].filter((char) => !/\s/.test(char));

/** "20-22,30" → 这些码位的集合。 */
function fromRanges(text) {
  const found = new Set();
  for (const part of text.trim().split(',')) {
    const [first, last = first] = part.split('-').map((hex) => parseInt(hex, 16));
    for (let codePoint = first; codePoint <= last; codePoint += 1) found.add(codePoint);
  }
  return found;
}

const table = charsOf(read('engine', 'fonts', 'hanzi-8105.txt'));
const kept = charsOf(read('engine', 'fonts', 'hanzi-kept.txt'));
const covered = fromRanges(read('template', 'fonts', 'serif.ranges.txt'));

test('《通用规范汉字表》：8105 个互不相同的汉字，从“一”开始，其中 196 个在基本平面之外', () => {
  assert.equal(table.length, 8105);
  assert.equal(new Set(table).size, 8105);
  assert.equal(table[0], '一');
  assert.ok(table.every((char) => /\p{Script=Han}/u.test(char)));
  assert.equal(table.filter((char) => char.codePointAt(0) > 0xffff).length, 196);
});

test('字表之外保留的 125 个字：都是汉字，和字表不重复', () => {
  assert.equal(kept.length, 125);
  assert.ok(kept.every((char) => /\p{Script=Han}/u.test(char) && !table.includes(char)));
});

test('正文字体盖住了字表里的每一个字和保留的那些字', () => {
  const missing = [...table, ...kept].filter((char) => !covered.has(char.codePointAt(0)));
  assert.deepEqual(missing, []);
});

test('B27 以前缺的常用字和人名用字，检查器不再提示“内置字体里没有”', () => {
  const problems = problemsOf({
    'lesson.html': fragmentPage('<p>啰嗦、瞭望、蹚水、欸乃；人名里的喆、堃、祎、玥、珺、璟。</p>')
  });
  assert.deepEqual(problems, []);
});

test('内置字体里确实没有的字，检查器照样提示', () => {
  const [problem] = problemsOf({ 'lesson.html': fragmentPage('<p>一个生僻字：𰻝。</p>') });
  assert.equal(problem.rule, 'font/coverage');
});
