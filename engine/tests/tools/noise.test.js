'use strict';
/* 报告的降噪：一个根因只报一处；说不清的报错换成说得清的话。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fragmentPage, lessonPage, problemsOf } = require('./helpers');
const { lines, F } = require('./rule-cases');

const brief = (problems) => problems.map((problem) => [problem.rule, problem.line]);

test('B35 漏写一个结束标签：只报这一处，后面连带的结构报错收起来并注明条数', () => {
  const page = lessonPage(
    lines(
      '<section id="a">',
      '<h2>第一节</h2>',
      '<p>正文。</p>',
      '<section id="b">',
      '<h2>第二节</h2>',
      '<p class="unknown-class">结构之外的问题照样报告。</p>',
      '</section>',
      '<section class="recap">',
      '<h2>本讲小结</h2>',
      '<ul><li>结论。</li></ul>',
      '</section>'
    )
  );
  const problems = problemsOf({ 'lesson.html': page });
  assert.deepEqual(brief(problems), [
    ['html/unclosed', 14],
    ['class/unknown', 19]
  ]);
  assert.match(
    problems[0].message,
    /<section> 没有闭合.*先修这一处：后面还有 5 条页面结构的报错多半是它引起的，已经收起/
  );
});

test('B35 没有标签漏闭合时，结构问题照常逐条报告', () => {
  const page = lessonPage(
    lines('<section id="a">', '<h2>第一节</h2>', '<section id="b">', '<h2>嵌套</h2>', '</section>', '</section>')
  );
  assert.deepEqual(brief(problemsOf({ 'lesson.html': page })), [
    ['section/nested', 16],
    ['section/h2', 17]
  ]);
});

test('B35 提示卡的类型写成了别处的叫法：指出契约里对应的那一个，不再按字形去猜', () => {
  const problems = problemsOf(
    F(
      lines(
        '<div class="callout tip"><p>提示。</p></div>',
        '<div class="callout warning"><p>提示。</p></div>',
        '<div class="callout fancy"><p>不认识的类型。</p></div>'
      )
    )
  );
  assert.deepEqual(brief(problems), [
    ['callout/type', 16],
    ['callout/type', 17],
    ['callout/type', 18]
  ]);
  assert.match(problems[0].message, /^这里写的 tip 对应契约里的 insight。/);
  assert.match(problems[1].message, /^这里写的 warning 对应契约里的 pitfall。/);
  assert.match(problems[2].message, /^提示卡要写成/);
  assert.ok(problems.every((problem) => !/是不是想写/.test(problem.message)));
});

test('B35 填空题、自评题的题干里有编号列表：说清它被当成了选项，以及怎么改', () => {
  const steps = '<ol><li>x = 1</li><li>x = x + 1</li></ol>';
  const fill = (list) =>
    lines('<div class="quiz" data-answer="2|二">', '<p>下面两步之后，x 等于几？</p>', list, '</div>');
  const self = (list) =>
    lines(
      '<div class="quiz">',
      '<p>按顺序说出两步：</p>',
      list,
      '<div class="explain"><p>参考答案。</p></div>',
      '</div>'
    );

  for (const quiz of [fill(steps), self(steps)]) {
    const [problem, ...rest] = problemsOf(F(quiz));
    assert.equal(problem.rule, 'quiz/answer');
    assert.match(problem.message, /直属的 <ol> 会被当成选项/);
    assert.match(problem.message, /把它包进一个 <div>/);
    assert.deepEqual(rest, []);
  }
  assert.deepEqual(problemsOf(F(lines(fill(`<div>${steps}</div>`), self(`<div>${steps}</div>`)))), []);
});

test('B35 公式里有 KaTeX 不认识的字符：报出是哪个字符，看不见的报码位', () => {
  const hidden = problemsOf({
    'lesson.html': fragmentPage(`<p><span class="math">a ${String.fromCharCode(12)} b</span></p>`)
  });
  assert.equal(hidden.length, 1);
  assert.match(hidden[0].message, /KaTeX 不认识的字符（U\+000C，看不见）/);
});
