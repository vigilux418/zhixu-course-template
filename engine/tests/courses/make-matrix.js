'use strict';
/* 生成“组件矩阵”课：写作契约里每个组件的每种变体各出现一次，用来在浏览器里逐个体检。
 *   require('./make-matrix')(目录)   只写讲义和课程清单，不放引擎。 */
const fs = require('fs');
const path = require('path');

const CALLOUTS = ['note', 'insight', 'memory', 'question', 'pitfall', 'danger', 'exam'];
const LANGUAGES = [
  ['python', 'def area(r):\n    return 3.14159 * r * r  # 圆的面积'],
  ['javascript', 'const area = (r) =&gt; Math.PI * r * r; // 圆的面积'],
  ['c', 'double area(double r) {\n    return 3.14159 * r * r; /* 圆的面积 */\n}'],
  ['bash', 'node template/tools/zx.js build  # 检查并生成'],
  ['json', '{ "id": "matrix", "lessons": 5 }'],
  ['text', '不需要着色的一段文字：α β γ ├─ █']
];

const page = (title, description, body) =>
  [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    `<meta name="description" content="${description}">`,
    '<link rel="stylesheet" href="template/zhixu.css">',
    '<script src="template/zhixu.js"></script>',
    '</head>',
    '<body>',
    '<main>',
    `<h1>${title}</h1>`,
    `<p class="lead">${description}</p>`,
    '<ul class="goals">',
    '<li>每个变体都能正常显示</li>',
    '<li>三种主题、各种宽度下都不走样</li>',
    '</ul>',
    body,
    '<section class="recap">',
    '<h2>本讲小结</h2>',
    '<ul>',
    `<li>${title}的每种写法都出现了一次。</li>`,
    '<li>这一讲由脚本生成。</li>',
    '</ul>',
    '</section>',
    '</main>',
    '</body>',
    '</html>',
    ''
  ].join('\n');

const section = (id, title, ...content) =>
  [`<section id="${id}">`, `<h2>${title}</h2>`, ...content, '</section>'].join('\n');

function callouts() {
  const plain = CALLOUTS.map(
    (type) => `<div class="callout ${type}">\n<p>${type} 类型的提示卡：正文的颜色应当与其他类型一样。</p>\n</div>`
  );
  const titled = CALLOUTS.map(
    (type) =>
      `<div class="callout ${type}" data-title="自定的标题">\n<p>${type} 类型，标题由 data-title 指定。</p>\n</div>`
  );
  const closed = CALLOUTS.map(
    (type) =>
      `<details class="callout ${type}">\n<summary>可折叠的 ${type}，默认收起</summary>\n<p>${type} 展开之后的正文。</p>\n</details>`
  );
  const opened = CALLOUTS.map(
    (type) =>
      `<details class="callout ${type}" open>\n<summary>可折叠的 ${type}，默认展开</summary>\n<p>${type} 默认展开的正文。</p>\n</details>`
  );
  const rich = [
    '<div class="callout insight" data-title="提示卡里放各种内容">',
    '<p>先是一段话，带一条旁注<span class="note">提示卡里的旁注。</span>，然后是列表、代码、表格和公式。</p>',
    '<ul>',
    '<li>第一条要点</li>',
    '<li>第二条要点，带 <code>inline_code()</code></li>',
    '</ul>',
    '<pre data-lang="python"><code>print("提示卡里的代码")</code></pre>',
    '<table>',
    '<thead>',
    '<tr><th>名称</th><th class="num">数值</th></tr>',
    '</thead>',
    '<tbody>',
    '<tr><td>甲</td><td class="num">1</td></tr>',
    '</tbody>',
    '</table>',
    '<div class="math">E = mc^2</div>',
    '</div>'
  ].join('\n');
  const folds = [
    '<details>',
    '<summary>普通的折叠块</summary>',
    '<p>折叠块里的正文。</p>',
    '</details>',
    '<details name="group" open>',
    '<summary>手风琴第一项（默认展开）</summary>',
    '<p>手风琴第一项的正文。</p>',
    '</details>',
    '<details name="group">',
    '<summary>手风琴第二项</summary>',
    '<p>手风琴第二项的正文。</p>',
    '</details>',
    '<details name="group">',
    '<summary>手风琴第三项</summary>',
    '<p>手风琴第三项的正文。</p>',
    '</details>'
  ].join('\n');
  const examples = [
    '<div class="example" id="ex-plain">',
    '<p>没有标题的例题：二加三等于几？</p>',
    '<details class="answer">',
    '<summary>解答</summary>',
    '<p>等于五。</p>',
    '</details>',
    '</div>',
    '<div class="example" data-title="带标题的例题">',
    '<p>三乘四等于几？</p>',
    '<details class="answer">',
    '<summary>解答</summary>',
    '<p>等于十二。</p>',
    '</details>',
    '</div>',
    '<blockquote>',
    '<p>有出处的引文。</p>',
    '<cite>《一本书》</cite>',
    '</blockquote>',
    '<blockquote>',
    '<p>没有出处的引文。</p>',
    '</blockquote>'
  ].join('\n');
  return page(
    '提示卡与折叠',
    '七种提示卡的四种写法，加上折叠块、手风琴、例题和引文。',
    [
      section('plain', '普通提示卡', ...plain),
      section('titled', '自定标题', ...titled),
      section('closed', '可折叠，默认收起', ...closed),
      section('opened', '可折叠，默认展开', ...opened),
      section('rich', '提示卡里的内容', rich),
      section('folds', '折叠与手风琴', folds),
      section('examples', '例题与引文', examples)
    ].join('\n')
  );
}

function codeAndMath() {
  const blocks = LANGUAGES.map(([language, source]) => `<pre data-lang="${language}"><code>${source}</code></pre>`);
  const variants = [
    '<pre data-lang="python" data-file="area.py"><code>import math\n\ndef area(r):\n    return math.pi * r * r</code></pre>',
    '<pre data-lang="python" data-lines><code>total = 0\nfor n in range(10):\n    total += n\nprint(total)</code></pre>',
    '<pre data-lang="python" data-lines="10" data-mark="11"><code>total = 0\nfor n in range(10):\n    total += n</code></pre>',
    '<pre data-lang="python" data-file="marked.py" data-mark="2,4-5"><code>a = 1\nb = 2\nc = 3\nd = 4\ne = 5\nf = 6</code></pre>',
    '<pre data-lang="javascript" data-file="notes.js"><code>const first = 1;\nconst text = `多行\n模板字符串`;\nconsole.log(first, text);</code></pre>',
    '<ol class="code-notes">',
    '<li data-line="1">第一行的讲解。</li>',
    '<li data-line="2">模板字符串跨了两行。</li>',
    '</ol>'
  ];
  const math = [
    '<p>行内公式 <span class="math">O(n \\log n)</span> 在句子中间，句末的公式后面紧跟句号：<span class="math">a^2 + b^2 = c^2</span>。</p>',
    '<p>公式后面是旁注再是标点：<span class="math">\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1</span><span class="note">公式后面的旁注。</span>；再接一句。</p>',
    '<div class="math" id="eq-first">\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}</div>',
    '<div class="math" id="eq-second">\\int_0^1 x^2\\,dx = \\frac{1}{3}</div>',
    '<div class="math">e^{i\\pi} + 1 = 0</div>',
    '<p>引用编号：<a href="#eq-first"></a>与<a href="#eq-second"></a>。</p>'
  ];
  return page(
    '代码与公式',
    '各种语言的代码块、文件名、行号、标亮、逐行讲解，以及行内和独立的公式。',
    [
      section('languages', '各种语言', ...blocks),
      section('variants', '代码块的各种写法', ...variants),
      section('math', '公式', ...math)
    ].join('\n')
  );
}

function quizzes() {
  const body = [
    '<div class="quiz" data-answer="b" id="quiz-single">',
    '<p>单选题，带提示和解析：一加一等于几？</p>',
    '<ol>',
    '<li>一</li>',
    '<li>二</li>',
    '<li>三</li>',
    '</ol>',
    '<p class="hint">提示：比一大，比三小。</p>',
    '<div class="explain"><p>解析：一加一等于二。</p></div>',
    '</div>',
    '<div class="quiz" data-answer="a">',
    '<p>单选题，没有提示：题干里有代码 <code>a &lt; b</code> 和公式 <span class="math">x^2</span>，选第一个。</p>',
    '<ol>',
    '<li>第一个选项</li>',
    '<li>第二个选项，文字特别长特别长特别长特别长特别长特别长特别长特别长特别长特别长，需要折行</li>',
    '</ol>',
    '</div>',
    '<div class="quiz" data-answer="a,c" id="quiz-multi">',
    '<p>多选题：下面哪些是偶数？</p>',
    '<ol>',
    '<li>二</li>',
    '<li>三</li>',
    '<li>四</li>',
    '</ol>',
    '<div class="explain"><p>解析：二和四。</p></div>',
    '</div>',
    '<div class="quiz" data-answer="3.14|π" id="quiz-fill">',
    '<p>填空题：圆周率约等于多少（保留两位小数）？</p>',
    '<p class="hint">提示：三点一四。</p>',
    '</div>',
    '<div class="quiz" id="quiz-self">',
    '<p>自评题：用自己的话解释什么是偶数。</p>',
    '<div class="explain"><p>参考答案：能被二整除的整数。</p></div>',
    '</div>'
  ].join('\n');
  const tasks = [
    '<ul class="tasks">',
    '<li>第一项任务</li>',
    '<li>第二项任务，文字比较长，长到需要折行才能放下，这时候勾选框应当与第一行文字对齐</li>',
    '<li>第三项任务，带 <code>code</code></li>',
    '</ul>'
  ].join('\n');
  return page(
    '小测与任务',
    '四种题型和任务清单。',
    [section('quizzes', '四种题型', body), section('tasks', '任务清单', tasks)].join('\n')
  );
}

function widgets() {
  const cells = (states) =>
    states
      .map(([state, value, label]) => `<span class="${state}"${label ? ` data-label="${label}"` : ''}>${value}</span>`)
      .join('');
  const stepper = [
    '<div class="stepper" data-title="在八个数里找 13">',
    '<figure>',
    `<div class="cells">${cells([
      ['on', 1, '左'],
      ['on', 3],
      ['on', 5],
      ['hit', 7, '中'],
      ['on', 9],
      ['on', 11],
      ['on', 13],
      ['on', 15, '右']
    ])}</div>`,
    '<figcaption>第一帧：八个格子应当排成一排。</figcaption>',
    '</figure>',
    '<figure>',
    `<div class="cells">${cells([
      ['off', 1],
      ['off', 3],
      ['off', 5],
      ['off', 7],
      ['on', 9, '左'],
      ['hit', 11, '中'],
      ['on', 13],
      ['on', 15, '右']
    ])}</div>`,
    '<figcaption>第二帧：讲解文字比较长，需要好几行才能写完，按钮的位置不应该上下跳动。</figcaption>',
    '</figure>',
    '<figure>',
    '<svg viewBox="0 0 300 60" role="img" aria-label="第三帧是一张图">',
    '<rect class="f-accent-soft s-accent" x="10" y="10" width="280" height="40" rx="6"/>',
    '</svg>',
    '<figcaption>第三帧是一张图。</figcaption>',
    '</figure>',
    '</div>'
  ].join('\n');
  const tabs = [
    '<div class="tabs">',
    '<div data-tab="Python"><p>第一组 Python 的内容。</p></div>',
    '<div data-tab="JavaScript"><p>第一组 JavaScript 的内容。</p></div>',
    '</div>',
    '<div class="tabs">',
    '<div data-tab="Python"><p>第二组 Python 的内容。</p></div>',
    '<div data-tab="JavaScript"><p>第二组 JavaScript 的内容。</p></div>',
    '<div data-tab="一个名字很长的选项卡"><p>名字很长的选项卡。</p></div>',
    '</div>'
  ].join('\n');
  const lists = [
    '<ol class="steps">',
    '<li><h4>第一步</h4><p>步骤的说明。</p></li>',
    '<li><h4>第二步</h4><p>步骤的说明。</p></li>',
    '<li><h4>第三步</h4><p>步骤的说明。</p></li>',
    '</ol>',
    '<ol class="flow">',
    '<li>读题</li>',
    '<li>拆解<small>分成小问题</small></li>',
    '<li>写出步骤</li>',
    '<li>验证</li>',
    '</ol>',
    '<ol class="flow">',
    ...['读题', '拆解', '写出步骤', '验证', '优化', '重构', '发布'].map((step) => `<li>${step}</li>`),
    '</ol>',
    '<ol class="timeline">',
    '<li><time>1946</time> 第一件事。</li>',
    '<li><time>1962 年 3 月</time> 第二件事，说明文字比较长，长到需要折行才能放下。</li>',
    '<li><time>2006</time> 第三件事。</li>',
    '</ol>',
    '<ul class="tree">',
    '<li>fib(4)',
    '<ul>',
    '<li>fib(3)<ul><li>fib(2)<ul><li>fib(1)</li><li>fib(0)</li></ul></li><li>fib(1)</li></ul></li>',
    '<li>fib(2)<ul><li>fib(1)</li><li>fib(0)：这一项的说明文字比较长，长到在窄屏上需要折成两行，折行之后连线仍然要接得上。</li></ul></li>',
    '</ul>',
    '</li>',
    '<li>另一棵树的根<ul><li><code>course.js</code></li></ul></li>',
    '</ul>'
  ].join('\n');
  const card = (n, text) => `<div><h4>第 ${n} 张卡片</h4><p>${text}</p></div>`;
  const cards = [2, 3, 4]
    .map((count) =>
      [
        '<div class="cards">',
        ...Array.from({ length: count }, (unused, n) =>
          card(n + 1, n === 1 ? '内容比较长，需要比旁边的卡片多占几行。' : '内容比较短。')
        ),
        '</div>'
      ].join('\n')
    )
    .concat(
      [
        '<dl>',
        '<dt>一个比较长的名称</dt><dd>它的解释，可以很长很长，长到需要折行。</dd>',
        '<dt>短名</dt><dd>解释。</dd>',
        '</dl>'
      ].join('\n')
    );
  return page(
    '演示、选项卡与列表',
    '步进演示、选项卡、步骤、流程、时间线、树、卡片和定义列表。',
    [
      section('stepper', '步进演示', stepper),
      section('tabs', '选项卡', tabs),
      section('lists', '步骤、流程、时间线与树', lists),
      section('cards', '卡片与定义列表', ...cards)
    ].join('\n')
  );
}

function inlineAndRefs() {
  const figure = (id, label, caption) =>
    [
      `<figure${id ? ` id="${id}"` : ''}>`,
      `<svg viewBox="0 0 240 80" role="img" aria-label="${label}">`,
      '<rect class="f-accent-soft s-accent" x="10" y="10" width="220" height="60" rx="8"/>',
      `<text class="t-title" x="120" y="46" text-anchor="middle">${label}</text>`,
      '</svg>',
      `<figcaption>${caption}</figcaption>`,
      '</figure>'
    ].join('\n');
  const inline = [
    '<p>行内元素：<strong>加粗</strong>、<em>着重</em>、<mark>标亮</mark>、<code>code</code>、<kbd>Ctrl</kbd> + <kbd>K</kbd>、H<sub>2</sub>O、x<sup>2</sup>、<a href="https://example.com">外部链接</a>。</p>',
    '<p>第一次出现的术语 <dfn data-def="把每种写法排成一张表，逐格检查。">矩阵测试</dfn>，之后再次出现的 <dfn>矩阵测试</dfn>。</p>',
    '<p>段落里的旁注<span class="note">第一条旁注，稍长一点，用来占据页边的空间。</span>紧挨着第二条<span class="note">第二条旁注。</span>，它们应当依次排开。</p>',
    '<ul>',
    '<li>列表里的旁注<span class="note">列表项里的旁注。</span>也进页边。</li>',
    '</ul>',
    '<h3>三级标题</h3>',
    '<p>三级标题下的正文。</p>',
    '<h4>四级标题</h4>',
    '<p>四级标题下的正文。</p>',
    '<hr>'
  ].join('\n');
  const table = [
    '<table id="tbl-compare">',
    '<caption>带表题的表格</caption>',
    '<thead>',
    '<tr><th>方法</th><th>前提</th><th class="num">次数</th></tr>',
    '</thead>',
    '<tbody>',
    '<tr><td>顺序查找</td><td>无</td><td class="num">1 000 000</td></tr>',
    '<tr><td>二分查找</td><td>有序</td><td class="num">20</td></tr>',
    '</tbody>',
    '</table>'
  ].join('\n');
  const refs = [
    figure('fig-single', '单独的一张图', '单独的一张图。'),
    '<div class="figures">',
    figure('', '并排第一张', '图题很短。'),
    figure('', '并排第二张', '图题比较长，需要折成两行甚至三行才能放下，图本身不应当因此错位。'),
    '</div>',
    table,
    '<p>留空的引用：<a href="#fig-single"></a>、<a href="#tbl-compare"></a>、<a href="#inline"></a>、<a href="01-callouts.html"></a>、<a href="01-callouts.html#plain"></a>、<a href="01-callouts.html#ex-plain"></a>、<a href="02-code-math.html#eq-first"></a>。</p>',
    '<p>有文字的引用：<a href="03-quizzes.html#quizzes">四种题型</a>。</p>',
    '<figure id="fig-audio">',
    '<audio src="media/tone.wav" controls></audio>',
    '<figcaption>一段音频。</figcaption>',
    '</figure>'
  ].join('\n');
  return page(
    '行内元素、图表与引用',
    '行内元素、旁注、术语、图、并排的图、表格、各种引用和一段音频。',
    [section('inline', '行内元素与旁注', inline), section('refs', '图表与引用', refs)].join('\n')
  );
}

/** 一小段声音：440 赫兹、十分之一秒的 WAV（8 位单声道）。 */
function tone() {
  const rate = 8000;
  const samples = rate / 10;
  const wav = Buffer.alloc(44 + samples);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + samples, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); // 格式块的长度
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // 单声道
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate, 28); // 每秒的字节数
  wav.writeUInt16LE(1, 32); // 每个采样的字节数
  wav.writeUInt16LE(8, 34); // 每个采样的位数
  wav.write('data', 36);
  wav.writeUInt32LE(samples, 40);
  for (let index = 0; index < samples; index += 1) {
    wav[44 + index] = 128 + Math.round(60 * Math.sin((2 * Math.PI * 440 * index) / rate));
  }
  return wav;
}

module.exports = function makeMatrix(dir) {
  const lessons = new Map([
    ['01-callouts.html', callouts()],
    ['02-code-math.html', codeAndMath()],
    ['03-quizzes.html', quizzes()],
    ['04-widgets.html', widgets()],
    ['05-inline-refs.html', inlineAndRefs()]
  ]);
  fs.mkdirSync(path.join(dir, 'course'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'media'));
  fs.writeFileSync(path.join(dir, 'media', 'tone.wav'), tone());
  for (const [file, html] of lessons) fs.writeFileSync(path.join(dir, file), html);
  const course = {
    id: 'matrix',
    title: '组件矩阵',
    subtitle: '契约里每个组件的每种变体',
    units: [
      { title: '容器与正文', lessons: ['01-callouts.html', '02-code-math.html'] },
      { title: '交互与引用', lessons: ['03-quizzes.html', '04-widgets.html', '05-inline-refs.html'] }
    ]
  };
  fs.writeFileSync(
    path.join(dir, 'course', 'course.js'),
    `window.ZHIXU_COURSE = ${JSON.stringify(course, null, 2)};\n`
  );
};
