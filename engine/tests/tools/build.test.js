'use strict';
/* build：编号与标签、course/data.js、index.html，以及生成结果的确定性。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { lib, pad, lessonPage, section, fragmentPage, courseSource, makeCourse, rulesOf } = require('./helpers');
const { lines, code } = require('./rule-cases');

const { build } = lib('build');

const SVG =
  '<svg viewBox="0 0 10 10" role="img" aria-label="示意"><rect width="10" height="10"/><text x="5" y="8">坐标标签</text></svg>';
const figure = (attrs, caption) =>
  lines(`<figure${attrs}>`, SVG, caption ? `<figcaption>${caption}</figcaption>` : '', '</figure>');
const table = (attrs, caption) =>
  `<table${attrs}>${caption ? `<caption>${caption}</caption>` : ''}<tr><td>格</td></tr></table>`;
const RECAP = lines(
  '<section class="recap">',
  '<h2>本讲小结</h2>',
  '<ul>',
  '<li>算法是明确的步骤。</li>',
  '</ul>',
  '</section>'
);

const FIRST = lessonPage(
  lines(
    '<p class="lead">从菜谱说起。</p>',
    '<ul class="goals">',
    '<li>说出算法的定义</li>',
    '</ul>',
    section(
      lines(
        '<p><dfn data-def="解决一类问题的明确步骤。">算法</dfn>无处不在。</p>',
        figure('', ''),
        figure(' id="fig-flow"', '流程'),
        table('', ''),
        table(' id="tab-compare"', '比较')
      ),
      'what'
    ),
    section(
      lines(
        '<div class="example" id="ex-first">',
        '<p>例题一。</p>',
        '<details class="answer"><summary>解答</summary><p>解答的内容不进搜索。</p></details>',
        '</div>',
        '<div class="example"><p>例题二，没有 id。</p></div>',
        '<div class="stepper">',
        figure(' id="frame-one"', '第一帧'),
        figure('', '第二帧'),
        '</div>',
        figure(' id="fig-after"', '演示之后的图')
      ),
      'steps'
    ),
    RECAP
  )
);

const SECOND = lessonPage(
  lines(
    section(
      lines(
        '<p>回顾<dfn>算法</dfn>，再看<dfn data-def="每次排除一半的查找方法。">二分查找</dfn>与<a href="01-first.html#fig-flow"></a>。</p>',
        '<div class="math" id="eq-mid">m = \\lfloor (l + r) / 2 \\rfloor</div>',
        '<div class="math">a \\lt b</div>',
        '<p>行内公式 <span class="math" id="inline-math">O(\\log n)</span> 不编号。</p>',
        '<div class="math" id="eq-cost">T(n) = T(n / 2) + 1</div>',
        figure(' id="fig-halving"', '区间减半'),
        code('python', ['def search(items, target):', `${pad(4)}return -1`, '']),
        '<div class="quiz" data-answer="b">',
        '<p>每次排除多少？</p>',
        '<ol><li>一个</li><li>一半</li></ol>',
        '<p class="hint">提示不进搜索。</p>',
        '<div class="explain"><p>解析不进搜索。</p></div>',
        '</div>',
        '<div class="quiz"><p>为什么要求有序？</p><div class="explain"><p>参考答案。</p></div></div>'
      ),
      'idea'
    )
  )
);

const han = (count) => '字'.repeat(count);
const THIRD = fragmentPage(
  lines(
    `<p>${han(600)}</p>`,
    `<p>${'word '.repeat(220)}</p>`,
    code(
      'text',
      Array.from({ length: 20 }, (_, index) => `line ${index + 1}`)
    ),
    '<div class="quiz"><p>自评题。</p><div class="explain"><p>参考答案。</p></div></div>'
  )
);

const COURSE = {
  id: 'algorithms',
  title: '算法 & 问题求解',
  subtitle: '从零开始 <学>',
  description: '三讲建立"直觉"。',
  author: '示例',
  units: [
    { title: '建立直觉', description: '先看例子。', lessons: ['01-first.html', '02-second.html'] },
    { title: '度量', lessons: ['03-third.html'] }
  ]
};

function makeSample() {
  return makeCourse({
    'course/course.js': courseSource(COURSE),
    '01-first.html': FIRST,
    '02-second.html': SECOND,
    '03-third.html': THIRD
  });
}

function makeSampleBuilt() {
  const root = makeSample();
  build(root);
  return root;
}

function readData(root) {
  const source = fs.readFileSync(path.join(root, 'course', 'data.js'), 'utf8');
  const prefix = 'window.ZHIXU_DATA = ';
  assert.ok(source.startsWith(prefix) && source.endsWith(';\n'));
  const json = source.slice(prefix.length, -2);
  const data = JSON.parse(json);
  assert.equal(json, JSON.stringify(data, null, 2));
  return data;
}

test('示例课程没有任何问题，并生成两个文件', () => {
  const root = makeSample();
  const { result, generated, escaped } = build(root);
  assert.deepEqual(result, { ok: true, errors: 0, warnings: 0, lessons: 3, problems: [], notes: [] });
  assert.deepEqual(generated, ['index.html', 'course/data.js']);
  assert.deepEqual(escaped, []);
});

test('data.js：各讲的标题、小节、标签和小测数', () => {
  const { lessons } = readData(makeSampleBuilt());
  assert.deepEqual(Object.keys(lessons), ['01-first.html', '02-second.html', '03-third.html']);
  assert.deepEqual(lessons['01-first.html'], {
    title: '测试讲',
    description: '用于测试的一讲。',
    minutes: 1,
    sections: [
      { id: 'what', title: '小节' },
      { id: 'steps', title: '小节' }
    ],
    labels: { 'fig-flow': '图 1-1', 'tab-compare': '表 1-1', 'ex-first': '例 1-1', 'fig-after': '图 1-2' },
    quizzes: 0,
    quizKeys: [],
    code: false,
    math: false
  });
  assert.deepEqual(lessons['02-second.html'].labels, {
    'eq-mid': '式 2-1',
    'eq-cost': '式 2-2',
    'fig-halving': '图 2-1'
  });
  assert.deepEqual(lessons['02-second.html'].sections, [{ id: 'idea', title: '小节' }]);
  assert.equal(lessons['02-second.html'].quizzes, 2);
  // 没有 id 的小测，键是题干文字的哈希：运行时在页面上算出来的是同一个
  assert.deepEqual(lessons['02-second.html'].quizKeys, ['q1e8cmln', 'qz9bzf3']);
});

test('data.js：阅读时长按汉字、单词、代码行和小测估算', () => {
  const { lessons } = readData(makeSampleBuilt());
  // 600 多个汉字、220 多个单词、20 行代码、1 道小测：1.5 + 1 + 1 + 0.5，略多于 4 分钟，向上取整。
  assert.equal(lessons['03-third.html'].minutes, 5);
  assert.equal(lessons['01-first.html'].minutes, 1);
});

test('data.js：术语表按课程顺序，第一次定义为准', () => {
  const { terms } = readData(makeSampleBuilt());
  assert.deepEqual(terms, [
    { term: '算法', def: '解决一类问题的明确步骤。', file: '01-first.html', id: 'what' },
    { term: '二分查找', def: '每次排除一半的查找方法。', file: '02-second.html', id: 'idea' }
  ]);
});

test('data.js：搜索索引每讲一条导语、每个小节一条；不含答案和公式源码，相邻的块之间有空格', () => {
  const { search } = readData(makeSampleBuilt());
  assert.deepEqual(
    search.map((entry) => [entry.file, entry.id, entry.title]),
    [
      ['01-first.html', '', '测试讲'],
      ['01-first.html', 'what', '小节'],
      ['01-first.html', 'steps', '小节'],
      ['01-first.html', 'zx-recap', '本讲小结'],
      ['02-second.html', '', '测试讲'],
      ['02-second.html', 'idea', '小节'],
      ['03-third.html', '', '测试讲'],
      ['03-third.html', 'part', '小节']
    ]
  );
  assert.equal(search[0].text, '从菜谱说起。 说出算法的定义');
  assert.equal(search[1].text, '算法无处不在。 流程 格 比较 格');
  assert.equal(search[2].text, '例题一。 例题二，没有 id。 第一帧 第二帧 演示之后的图');
  assert.equal(search[3].text, '算法是明确的步骤。');
  assert.equal(search[4].text, '');
  // 公式在索引里只是一个占位符：源码不进索引，前后的字也不会因为公式被拿掉而拼在一起
  assert.match(search[5].text, /^回顾算法，再看二分查找与。 ￼ ￼ 行内公式 ￼ 不编号。 ￼ 区间减半 def search/);
  assert.match(search[5].text, /每次排除多少？ 一个 一半 为什么要求有序？$/);
  assert.doesNotMatch(search[5].text, /提示|解析|参考答案|lfloor|log|坐标标签/); // 图里的字不是正文
});

test('index.html：没有脚本也能用的目录', () => {
  const root = makeSampleBuilt();
  const expected = [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>算法 &amp; 问题求解</title>',
    '<meta name="description" content="三讲建立&quot;直觉&quot;。">',
    '<link rel="stylesheet" href="template/zhixu.css">',
    '<script src="template/zhixu.js"></script>',
    '</head>',
    '<body>',
    '<main>',
    '<h1>算法 &amp; 问题求解</h1>',
    '<p class="lead">从零开始 &lt;学></p>',
    '<p>三讲建立&quot;直觉&quot;。</p>',
    '<h2>建立直觉</h2>',
    '<ol>',
    `${pad(2)}<li><a href="01-first.html">测试讲</a>：用于测试的一讲。</li>`,
    `${pad(2)}<li><a href="02-second.html">测试讲</a>：用于测试的一讲。</li>`,
    '</ol>',
    '<h2>度量</h2>',
    '<ol start="3">',
    `${pad(2)}<li><a href="03-third.html">测试讲</a>：用于测试的一讲。</li>`,
    '</ol>',
    '</main>',
    '</body>',
    '</html>',
    ''
  ].join('\n');
  assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), expected);
  assert.deepEqual(lib('html').parse(expected).problems, []);
});

test('index.html：只有一个没有标题的单元、没有副标题和简介时从简', () => {
  const root = makeCourse({ 'only.html': fragmentPage('<p>正文。</p>') });
  build(root);
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(index.includes('<meta name="description" content="测试课程">'));
  assert.ok(
    index.includes(
      lines('<h1>测试课程</h1>', '<ol>', `${pad(2)}<li><a href="only.html">测试讲</a>：用于测试的一讲。</li>`, '</ol>')
    )
  );
  assert.doesNotMatch(index, /<h2>|class="lead"/);
});

test('生成结果是确定的：重复生成逐字节相同，换行都是 LF', () => {
  const root = makeSample();
  const read = () => ['index.html', 'course/data.js'].map((file) => fs.readFileSync(path.join(root, file), 'utf8'));
  build(root);
  const first = read();
  build(root);
  assert.deepEqual(read(), first);
  assert.ok(first.every((text) => !text.includes('\r') && text.endsWith('\n')));
  const again = makeSample();
  build(again);
  assert.deepEqual(
    ['index.html', 'course/data.js'].map((file) => fs.readFileSync(path.join(again, file), 'utf8')),
    first
  );
});

test('有问题也尽量生成：缺的讲次只列文件名，讲次编号不受影响', () => {
  const root = makeCourse({
    'course/course.js': courseSource({
      id: 'broken',
      title: '有问题的课',
      units: [{ lessons: ['ghost.html', 'real.html'] }]
    }),
    'real.html': fragmentPage(lines('<p>当 a < b 时见<a href="#fig-x"></a>。</p>', figure(' id="fig-x"', '图')))
  });
  const { result, generated } = build(root);
  assert.deepEqual(rulesOf(result.problems), ['course/missing-file', 'html/lt']);
  assert.equal(result.ok, false);
  assert.equal(generated.length, 2);
  const data = readData(root);
  assert.deepEqual(Object.keys(data.lessons), ['real.html']);
  assert.deepEqual(data.lessons['real.html'].labels, { 'fig-x': '图 2-1' });
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(index.includes('<li><a href="ghost.html">ghost.html</a></li>'));
});

test('课程清单无法执行时不生成任何文件', () => {
  const root = makeCourse({
    'course/course.js': 'window.ZHIXU_COURSE = ;\n',
    'real.html': fragmentPage('<p>正文。</p>')
  });
  const { result, generated } = build(root);
  assert.deepEqual(rulesOf(result.problems), ['course/shape', 'course/unlisted']);
  assert.deepEqual(generated, []);
  assert.equal(fs.existsSync(path.join(root, 'index.html')), false);
  assert.equal(fs.existsSync(path.join(root, 'course', 'data.js')), false);
});

test('没有登记的页面不进 data.js，也不进 index.html', () => {
  const root = makeCourse({
    'course/course.js': courseSource({ id: 'test', title: '测试课程', units: [{ lessons: ['listed.html'] }] }),
    'listed.html': fragmentPage('<p>正文。</p>'),
    'draft.html': fragmentPage('<p><dfn data-def="草稿里的定义。">草稿术语</dfn></p>')
  });
  const { result } = build(root);
  assert.deepEqual(rulesOf(result.problems), ['course/unlisted']);
  assert.equal(result.lessons, 1);
  const data = readData(root);
  assert.deepEqual(Object.keys(data.lessons), ['listed.html']);
  assert.deepEqual(data.terms, []);
  assert.ok(data.search.every((entry) => entry.file === 'listed.html'));
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /draft/);
});

test('字数：汉字加西文单词；代码、公式的源码和属性里的文字不算', () => {
  const { loadLesson, wordCount } = lib('lesson');
  const count = (fragment) =>
    wordCount(loadLesson(makeCourse({ 'lesson.html': fragmentPage(fragment) }), 'lesson.html', 1));
  const base = count('<p>正文。</p>'); // 标题、小节标题和这两个字
  assert.equal(base, 7);
  assert.equal(count('<p>正文，用 binary search 找 13。</p>') - base, 5, '“用”“找”两个字，binary、search、13 三个词');
  assert.equal(count('<p>正文。</p>\n<pre data-lang="python"><code>print("代码不算")</code></pre>'), base);
  assert.equal(count('<p>正文。<span class="math">x^2 + y^2</span></p>\n<div class="math">E = mc^2</div>'), base);
  assert.equal(count('<p>正文。<dfn data-def="定义写在属性里，不算">词</dfn></p>') - base, 1);
});
