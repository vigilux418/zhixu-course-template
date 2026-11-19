'use strict';
/* 规则：每条规则至少一个反例、一个正例；另有几条针对位置与误报的专门测试。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { TEMPLATE, lib, pad, fragmentPage, courseSource, makeCourse, problemsOf, rulesOf } = require('./helpers');
const { CASES, LESSON, F, lines, code } = require('./rule-cases');

for (const { rule, level = 'error', bad, good } of CASES) {
  test(`${rule}（${level}）：反例都能报告`, () => {
    bad.forEach((files, index) => {
      const found = problemsOf(files).filter((problem) => problem.rule === rule && problem.level === level);
      assert.ok(found.length > 0, `第 ${index + 1} 个反例没有报告 ${rule}`);
    });
  });

  test(`${rule}（${level}）：正例没有任何问题`, () => {
    good.forEach((files, index) => {
      assert.deepEqual(problemsOf(files), [], `第 ${index + 1} 个正例`);
    });
  });
}

test('工具能报告的每条规则都有正反例', () => {
  const libDir = path.join(TEMPLATE, 'tools', 'lib');
  // files.js 里形如 'image/png' 的是 MIME 类型；checkup.js、look.js 里的是渲染体检的项目，由端到端验收覆盖。它们都不是检查器的规则。
  const sources = fs.readdirSync(libDir).filter((name) => !['files.js', 'checkup.js', 'look.js'].includes(name));
  const emitted = new Set();
  for (const name of sources) {
    const source = fs.readFileSync(path.join(libDir, name), 'utf8');
    for (const match of source.matchAll(/'([a-z0-9]+\/[a-z0-9-]+)'/g)) emitted.add(match[1]);
  }
  const covered = new Set(CASES.map((entry) => entry.rule));
  assert.ok(emitted.size > 50, '没有从源码里找到规则');
  assert.deepEqual(
    [...emitted].filter((rule) => !covered.has(rule)),
    []
  );
  assert.deepEqual(
    [...covered].filter((rule) => !emitted.has(rule)),
    []
  );
});

test('问题带有文件、行列、级别、规则和说明', () => {
  const [problem] = problemsOf(F('<p>当 a < b 时</p>'));
  assert.deepEqual(Object.keys(problem), ['file', 'line', 'col', 'level', 'rule', 'message']);
  assert.deepEqual(
    [problem.file, problem.line, problem.col, problem.level, problem.rule],
    [LESSON, 16, 8, 'error', 'html/lt']
  );
});

test('没闭合的 div 报告在它所在的行', () => {
  const problems = problemsOf(F(lines('<div class="callout note">', '<p>提示。</p>')));
  assert.deepEqual(
    problems.map((problem) => [problem.rule, problem.line, problem.col]),
    [['html/unclosed', 16, 1]]
  );
});

test('代码文字不会被误判成属性、标签或外部资源', () => {
  const fragment = lines(
    code('python', [
      'one = 1',
      'style = "bold"',
      'onclick = handler',
      `${pad(4)}if a &lt; b &amp;&amp; c:`,
      `${pad(8)}pass`
    ]),
    code('css', ['.logo { background: url(logo@2x.png); }', '@import url("https://example.com/font.css");']),
    code('html', [
      '&lt;img src="https://example.com/a.png" onload="go()" style="x"&gt;',
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    ]),
    '<p>行内：<code>one = 1</code>、<code>style = "bold"</code>、<code>a &lt; b &amp;&amp; c</code>、<code>url(logo@2x.png)</code>。</p>'
  );
  assert.deepEqual(problemsOf(F(fragment)), []);
});

test('代码和公式里没转义的 < 和 &：只报一条，指着第一处，后面的结构不受连累', () => {
  const page = F(
    lines(
      code('cpp', ['std::vector<int> v;', 'if (a < b && c) x = &y;']),
      '<p>行内 <code>vector<int></code> 与公式 <span class="math">x<y</span>。</p>',
      '<p class="unknown-class">后面的问题照样能查出来，位置也是对的。</p>'
    )
  );
  const problems = problemsOf(page);
  assert.deepEqual(
    problems.map((problem) => [problem.rule, problem.line, problem.col]),
    [
      ['code/unescaped', 16, 39],
      ['class/unknown', 19, 4]
    ]
  );
  assert.match(problems[0].message, /有 7 处/);
});

test('同一行里前面转义过几处，后面的问题仍然报在磁盘上那份源码的列号上', () => {
  const line = '<p>行内 <code>a<b</code> 与 <code>c&d</code>，然后 <span class="unknown-class">这里</span>。</p>';
  const problems = problemsOf(F(line));
  assert.deepEqual(
    problems.map((problem) => [problem.rule, problem.line, problem.col]),
    [
      ['code/unescaped', 16, line.indexOf('a<b') + 2],
      ['class/unknown', 16, line.indexOf('class=') + 1]
    ]
  );
});

test('公式的语法错误定位到公式内部的行列', () => {
  const problems = problemsOf(F(lines('<div class="math">', 'a &lt; b \\\\', 'c = \\frac{1}{', '</div>')));
  assert.deepEqual(
    problems.map((problem) => [problem.rule, problem.line, problem.col]),
    [['math/syntax', 19, 1]]
  );
  const inline = problemsOf(F('<p>公式 <span class="math">a &lt; b \\oops</span></p>'));
  assert.deepEqual(
    inline.map((problem) => [problem.rule, problem.line, problem.col]),
    [['math/syntax', 16, 35]]
  );
  assert.match(inline[0].message, /\\oops/);
});

test('缩进被破坏的代码行逐行报告', () => {
  const block = code('python', [
    'def f():',
    `${pad(4)}a = 1`,
    `${pad(4)}b = 2`,
    `${pad(4)}c = 3`,
    `${pad(4)}d = 4`,
    `${pad(3)}return a`,
    `${pad(1)}# 结束`
  ]);
  const problems = problemsOf(F(block));
  assert.deepEqual(
    problems.map((problem) => [problem.rule, problem.level, problem.line, problem.col]),
    [
      ['code/indent', 'warning', 21, 1],
      ['code/indent', 'warning', 22, 1]
    ]
  );
});

test('不认识的类名给出最接近的建议', () => {
  const [problem] = problemsOf(F('<div class="callot note"><p>文字</p></div>'));
  assert.match(problem.message, /callout/);
  const [unrelated] = problemsOf(F('<p class="completely-unknown">文字</p>'));
  assert.doesNotMatch(unrelated.message, /是不是/);
});

test('字体缺字每个文件只报告一次，最多列出 20 个字符', () => {
  const rare = Array.from({ length: 25 }, (_, index) => String.fromCodePoint(0x20000 + index));
  const problems = problemsOf(F(lines(`<p>${rare.join('')}</p>`, `<p>${rare[0]}</p>`)));
  assert.deepEqual(rulesOf(problems), ['font/coverage']);
  assert.deepEqual([problems[0].line, problems[0].col], [16, 4]);
  assert.ok(problems[0].message.includes(rare[19]) && !problems[0].message.includes(rare[20]));
  assert.match(problems[0].message, /25/);
});

test('问题按课程顺序、行、列排序，课程清单排在最前', () => {
  const courseJs =
    'window.ZHIXU_COURSE = { id: "test", title: "测试", units: [{ lessons: ["b.html", "a.html", "ghost.html"] }] };\n';
  const problems = problemsOf({
    'course/course.js': courseJs,
    'a.html': F('<p>x < y</p>\n<p>R&D</p>')[LESSON],
    'b.html': F('<p>R&D 与 a < b</p>')[LESSON],
    'c.html': F('<p>没登记</p>')[LESSON]
  });
  assert.deepEqual(
    problems.map((problem) => [problem.file, problem.rule]),
    [
      ['course/course.js', 'course/missing-file'],
      ['b.html', 'html/amp'],
      ['b.html', 'html/lt'],
      ['a.html', 'html/lt'],
      ['a.html', 'html/amp'],
      ['c.html', 'course/unlisted']
    ]
  );
  assert.deepEqual([problems[0].line, problems[0].col], [1, courseJs.indexOf('ghost.html') + 1]);
});

test('首页不是讲义：内容再乱也不检查，也可以被链接', () => {
  const problems = problemsOf({
    [LESSON]: F('<p><a href="index.html">回到首页</a></p>')[LESSON],
    'index.html': '<p>不合规 <b>'
  });
  assert.deepEqual(problems, []);
});

test('课程目录之外的文件不算数：图片和链接都要留在课程里', () => {
  const outer = makeCourse({
    'outside.png': 'png',
    'inner/course/course.js': courseSource({ id: 'inner', title: '里面的课', units: [{ lessons: [LESSON] }] }),
    [`inner/${LESSON}`]: fragmentPage(
      '<p><a href="../outside.png">外面的文件</a></p><figure><img src="../outside.png" alt="外面的图"></figure>'
    )
  });
  const { problems } = lib('check').checkCourse(path.join(outer, 'inner')).result;
  assert.deepEqual(rulesOf(problems), ['link/target', 'img/src']);
});

const ONE_LISTED = courseSource({ id: 'test', title: '测试课程', units: [{ lessons: [LESSON] }] });
const summarized = (problems) => problems.map((problem) => [problem.file, problem.level, problem.rule]);

test('没有登记的页面也按一讲的规则检查，但不算进讲数', () => {
  const { result } = lib('check').checkCourse(
    makeCourse({
      'course/course.js': ONE_LISTED,
      [LESSON]: fragmentPage('<p>正文。</p>'),
      'draft.html': fragmentPage('<pre data-lang="cpp"><code>std::vector<int> v;</code></pre>')
    })
  );
  assert.deepEqual(summarized(result.problems), [
    ['draft.html', 'error', 'course/unlisted'],
    ['draft.html', 'error', 'code/unescaped']
  ]);
  assert.deepEqual([result.ok, result.errors, result.warnings, result.lessons], [false, 2, 0, 1]);
});

test('没有别的问题的未登记页面只报“没有登记”这一条', () => {
  const draft = fragmentPage(
    lines(
      '<figure id="fig-draft">',
      '<svg viewBox="0 0 1 1" role="img" aria-label="图"></svg>',
      '<figcaption>草稿里的图</figcaption>',
      '</figure>',
      `<p>见<a href="#fig-draft"></a>、<a href="#part"></a>与<a href="${LESSON}"></a>。</p>`
    )
  );
  const problems = problemsOf({
    'course/course.js': ONE_LISTED,
    [LESSON]: fragmentPage('<p>正文。</p>'),
    'draft.html': draft
  });
  assert.deepEqual(summarized(problems), [['draft.html', 'error', 'course/unlisted']]);
});

test('课程清单用不了时，根目录下的页面照样检查', () => {
  const problems = problemsOf({
    'course/course.js': 'window.ZHIXU_COURSE = ;\n',
    'draft.html': fragmentPage('<p>a < b</p>')
  });
  assert.deepEqual(summarized(problems), [
    ['course/course.js', 'error', 'course/shape'],
    ['draft.html', 'error', 'course/unlisted'],
    ['draft.html', 'error', 'html/lt']
  ]);
});

test('登记的讲不能链接到没登记的页面：留空的链接引擎填不上，有文字的也不行', () => {
  const problems = problemsOf({
    'course/course.js': ONE_LISTED,
    [LESSON]: fragmentPage('<p><a href="draft.html"></a> 与 <a href="draft.html#part">草稿的小节</a></p>'),
    'draft.html': fragmentPage('<p>草稿。</p>')
  });
  assert.deepEqual(summarized(problems), [
    [LESSON, 'error', 'link/empty'],
    [LESSON, 'error', 'link/target'],
    ['draft.html', 'error', 'course/unlisted']
  ]);
});
