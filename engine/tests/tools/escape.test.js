'use strict';
/* 自动转义：代码与公式里的 < 和 &。只动这两种字符，别的一个字节都不改。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { TEMPLATE, lib, fragmentPage, makeCourse, rulesOf } = require('./helpers');
const { lines, code } = require('./rule-cases');

const { escapeSource, escapeCourse } = lib('escape');
const { checkCourse } = lib('check');
const { build } = lib('build');

const agents = fs.readFileSync(path.join(TEMPLATE, 'AGENTS.md'), 'utf8').replace(/\r\n/g, '\n');
const examples = [...agents.matchAll(/^```html\n([\s\S]*?)\n```$/gm)].map((match) =>
  match[1].startsWith('<!doctype') ? `${match[1]}\n` : fragmentPage(match[1])
);

test('转义代码块、行内代码和公式里的 < 与 &；已经写对的字符引用不动', () => {
  const before = fragmentPage(
    lines(
      code('cpp', ['std::vector<int> v;', 'if (a < b && c) x = &y;', 'a &lt; b &amp;&amp; c &copy; &#60;']),
      '<p>行内 <code>vector<int></code> 与 <code>a && b</code>。</p>',
      '<div class="math">a < b & c &lt; d</div>',
      '<p>公式 <span class="math">x<y</span>。</p>'
    )
  );
  const after = fragmentPage(
    lines(
      code('cpp', [
        'std::vector&lt;int> v;',
        'if (a &lt; b &amp;&amp; c) x = &amp;y;',
        'a &lt; b &amp;&amp; c &copy; &#60;'
      ]),
      '<p>行内 <code>vector&lt;int></code> 与 <code>a &amp;&amp; b</code>。</p>',
      '<div class="math">a &lt; b &amp; c &lt; d</div>',
      '<p>公式 <span class="math">x&lt;y</span>。</p>'
    )
  );
  const escaped = escapeSource(before);
  assert.equal(escaped.text, after);
  assert.equal(escaped.marks.length, 11);
  // 每个记号都指着原文里一个 < 或 &
  assert.ok(escaped.marks.every(({ offset }) => '<&'.includes(before[offset])));
});

test('build 之后 vector<int> 不再报错；第二次 build 什么都不改', () => {
  const root = makeCourse({
    'lesson.html': fragmentPage(lines(code('cpp', ['std::vector<int> v;']), '<p>行内 <code>a < b</code>。</p>'))
  });
  assert.deepEqual(rulesOf(checkCourse(root).result.problems), ['code/unescaped']);
  assert.deepEqual(build(root).escaped, [{ file: 'lesson.html', escaped: 2 }]);
  assert.deepEqual(checkCourse(root).result.problems, []);
  assert.deepEqual(build(root).escaped, []);
});

test('漏写结束标签的代码不动，留给检查去报告', () => {
  const reopened = fragmentPage(
    lines('<p>用 <code>x 表示。</p>', '<p>再看 <code>y</code> 与 <span class="math">a<span>b</span></span></p>')
  );
  const unterminated = fragmentPage('<p>没有结束的 <code>a < b</p>');
  assert.deepEqual(escapeSource(reopened), { text: reopened, marks: [] });
  assert.deepEqual(escapeSource(unterminated), { text: unterminated, marks: [] });
});

test('不是代码也不是公式的地方不转义', () => {
  const page = fragmentPage(
    lines('<p>正文 a < b 与 R&D</p>', '<pre data-lang="text">没有 code 的 a < b</pre>', '<p class="math">a < b</p>')
  );
  assert.deepEqual(escapeSource(page), { text: page, marks: [] });
});

test('契约里的示例都已经转义好了；转义是幂等的', () => {
  assert.ok(examples.length >= 15);
  for (const example of examples) assert.deepEqual(escapeSource(example), { text: example, marks: [] });
  const messy = fragmentPage(lines('<p>a <code>x<y && z</code></p>', code('c', ['a<b;', 'c&d;'])));
  const once = escapeSource(messy);
  assert.deepEqual(escapeSource(once.text), { text: once.text, marks: [] });
});

test('只改需要改的文件；CRLF、BOM 和缩进原样保留', () => {
  const clean = fragmentPage('<p>干净的一讲。</p>');
  const windows = String.fromCharCode(0xfeff) + fragmentPage(`   ${code('cpp', ['a<b;'])}`).replace(/\n/g, '\r\n');
  const root = makeCourse({ 'a.html': clean, 'b.html': windows });
  const stamp = fs.statSync(path.join(root, 'a.html')).mtimeMs;
  assert.deepEqual(escapeCourse(root), [{ file: 'b.html', escaped: 1 }]);
  assert.equal(fs.readFileSync(path.join(root, 'b.html'), 'utf8'), windows.replace('a<b;', 'a&lt;b;'));
  assert.equal(fs.statSync(path.join(root, 'a.html')).mtimeMs, stamp);
  assert.equal(fs.readFileSync(path.join(root, 'a.html'), 'utf8'), clean);
});

test('没有登记的页面也会转义；首页不动', () => {
  const index = '<div>\n<code>a<b</code>：首页由工具生成，不归转义管\n</div>\n';
  const root = makeCourse({
    'course/course.js':
      'window.ZHIXU_COURSE = { id: "test", title: "测试课程", units: [{ lessons: ["listed.html"] }] };\n',
    'listed.html': fragmentPage('<p>正文。</p>'),
    'draft.html': fragmentPage(code('cpp', ['std::vector<int> v;'])),
    'index.html': index
  });
  assert.deepEqual(escapeCourse(root), [{ file: 'draft.html', escaped: 1 }]);
  assert.deepEqual(rulesOf(checkCourse(root).result.problems), ['course/unlisted']);
  assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), index);
});
