'use strict';
/* 契约文档里的每个 HTML 示例都必须通过检查：0 个 error，0 个 warning。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { TEMPLATE, lessonPage, section, fragmentPage, problemsOf } = require('./helpers');

const agents = fs.readFileSync(path.join(TEMPLATE, 'AGENTS.md'), 'utf8').replace(/\r\n/g, '\n');
const examples = [...agents.matchAll(/^```html\n([\s\S]*?)\n```$/gm)].map((match) => ({
  line: agents.slice(0, match.index).split('\n').length,
  html: match[1]
}));

const stub = (...ids) => lessonPage(ids.map((id) => section('<p>占位。</p>', id)).join('\n'));

function exampleFile(index) {
  return `example-${String(index + 1).padStart(2, '0')}.html`;
}

const files = Object.fromEntries(
  examples.map(({ html }, index) => [
    exampleFile(index),
    html.startsWith('<!doctype') ? `${html}\n` : fragmentPage(html)
  ])
);
files['02-binary-search.html'] = stub('idea');
files['03-time-complexity.html'] = stub('intro', 'big-o');
const problems = problemsOf(files);

test('AGENTS.md 里有 HTML 示例', () => {
  assert.ok(examples.length >= 15, `只找到 ${examples.length} 个示例`);
});

examples.forEach(({ line }, index) => {
  test(`AGENTS.md 第 ${line} 行的示例通过检查`, () => {
    assert.deepEqual(
      problems.filter((problem) => problem.file === exampleFile(index)),
      []
    );
  });
});

test('示例课程整体没有任何问题', () => {
  assert.deepEqual(problems, []);
});
