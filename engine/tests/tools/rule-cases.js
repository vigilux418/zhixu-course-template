'use strict';
/* 每条规则的正反例。bad 里的每门课都必须报告这条规则；good 里的每门课必须一个问题都没有。 */
const { pad, HEAD, htmlPage, lessonPage, section, fragmentPage, courseSource } = require('./helpers');

const LESSON = 'lesson.html';
const BODY = ['<main>', '<h1>测试讲</h1>', section('<p>正文。</p>'), '</main>'].join('\n');
const GOOD_PAGE = htmlPage(HEAD, BODY);
const OTHER = fragmentPage('<p>另一讲的正文。</p>');
const IMAGE = { 'images/a.png': 'png' };
const MEDIA = { 'media/a.mp3': 'mp3', 'media/a.mp4': 'mp4' };
const RARE = String.fromCodePoint(0x20bb7);
const EMOJI = String.fromCodePoint(0x1f600);

/** 只有一讲的课程：fragment 放在小节里；extra 是另外要放进课程的文件。 */
const F = (fragment, extra) => ({ [LESSON]: fragmentPage(fragment), ...extra });
/** 只有一讲的课程：content 是 <main> 里 <h1> 之后的全部内容。 */
const M = (content) => ({ [LESSON]: lessonPage(content) });
/** 只有一讲的课程：整份文档由调用者给出。 */
const D = (html) => ({ [LESSON]: html });
const headed = (head) => D(htmlPage(head, BODY));
const bodied = (body) => D(htmlPage(HEAD, body));
const lines = (...parts) => parts.join('\n');
/** 自己写课程清单的课程。 */
const C = (course, files) => ({
  'course/course.js': typeof course === 'string' ? course : courseSource(course),
  ...files
});

const code = (lang, codeLines, attrs = '') =>
  `<pre data-lang="${lang}"${attrs}><code>${codeLines.join('\n')}</code></pre>`;
const notes = (...items) => lines('<ol class="code-notes">', ...items, '</ol>');
const TWO_LINES = code('text', ['第一行', '第二行']);

const quiz = (attrs, ...parts) => lines(`<div class="quiz"${attrs}>`, ...parts, '</div>');
const options = (...items) => lines('<ol>', ...items.map((item) => `<li>${item}</li>`), '</ol>');
const STEM = '<p>二分查找每比较一次，排除多少候选？</p>';
const THREE = options('一个', '一半', '全部');
const HINT = '<p class="hint">想想哪一部分不必再看。</p>';
const EXPLAIN = '<div class="explain"><p>另一侧整体排除。</p></div>';
const GOOD_QUIZZES = lines(
  quiz(' data-answer="b"', STEM, THREE, HINT, EXPLAIN),
  quiz(' data-answer="a,c"', '<p>哪些数据可以直接二分？</p>', options('有序名单', '乱序号码', '词典')),
  quiz(' data-answer="20|二十"', '<p>一百万个元素最多比较几次？</p>', EXPLAIN),
  quiz('', '<p>为什么二分查找要求有序？</p>', EXPLAIN)
);

const frame = (text, caption) =>
  `<figure><p>${text}</p>${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
const stepper = (...frames) => lines('<div class="stepper">', ...frames, '</div>');
const tabs = (...labels) =>
  lines('<div class="tabs">', ...labels.map((label) => `<div data-tab="${label}"><p>内容</p></div>`), '</div>');
const tasks = (...items) => lines('<ul class="tasks">', ...items.map((item) => `<li>${item}</li>`), '</ul>');
const SVG =
  '<svg viewBox="0 0 10 10" role="img" aria-label="一个方块"><rect class="f-accent-soft s-accent w2 dash" width="10" height="10"/></svg>';
const FIGURE = lines('<figure id="fig-a">', SVG, '<figcaption>图题</figcaption>', '</figure>');
/** 没有图题的图：图片和 SVG 必须放在 <figure> 里。 */
const FIG = (media) => `<figure>${media}</figure>`;
const RECAP = lines('<section class="recap">', '<h2>本讲小结</h2>', '<p>结论。</p>', '</section>');
const TABLE = lines(
  '<table>',
  '<caption>表题</caption>',
  '<thead>',
  '<tr><th>名称</th><th class="num">数量</th></tr>',
  '</thead>',
  '<tbody>',
  '<tr><td>甲</td><td class="num">1</td></tr>',
  '</tbody>',
  '</table>'
);
const TWO_UNITS = {
  id: 'full-course',
  title: '完整课程',
  subtitle: '副标题',
  description: '课程简介。',
  author: '作者',
  units: [
    { title: '第一单元', description: '单元简介。', lessons: [LESSON] },
    { title: '第二单元', lessons: ['other.html'] }
  ]
};
const course = (changes) => ({ id: 'test', title: '测试课程', units: [{ lessons: [LESSON] }], ...changes });

const CASES = [
  // 解析
  { rule: 'html/unclosed', bad: [F('<p>没有闭合'), F('<ul><li>一<li>二</ul>')], good: [F('<p>闭合了</p>')] },
  { rule: 'html/stray-end', bad: [F('<p>文字</p></div>')], good: [F('<div><p>文字</p></div>')] },
  { rule: 'html/self-closing', bad: [F('<div/>')], good: [F('<p>换行<br/>之后</p>')] },
  { rule: 'html/lt', bad: [F('<p>当 a < b 时</p>')], good: [F('<p>当 a &lt; b 时，b > a</p>')] },
  { rule: 'html/amp', bad: [F('<p>研发 R&D</p>')], good: [F('<p>研发 R&amp;D &copy; &#169; &#xA9;</p>')] },
  { rule: 'html/dup-attr', bad: [F('<p id="one" id="two">文字</p>')], good: [F('<p id="one">文字</p>')] },
  {
    rule: 'html/document',
    bad: [
      D(GOOD_PAGE.replace('<!doctype html>\n', '')),
      D(GOOD_PAGE.replace('<!doctype html>', '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN">')),
      D(`${GOOD_PAGE}<p>文档之外</p>\n`),
      D(GOOD_PAGE.replace('</head>', '</head>\n<p>head 与 body 之间</p>'))
    ],
    good: [D(GOOD_PAGE), D(GOOD_PAGE.replace('<!doctype html>', '<!-- 注释 -->\n<!DOCTYPE HTML>'))]
  },
  {
    rule: 'html/p-block',
    bad: [F('<p>段落里<div>有块</div></p>'), F('<p>列表：<ul><li>项</li></ul></p>'), F('<p>外层<p>内层</p></p>')],
    good: [F('<p>段落里 <span>行内</span> 与 <em>强调</em></p>')]
  },

  // 文档头
  {
    rule: 'head/lang',
    bad: [D(GOOD_PAGE.replace(' lang="zh-CN"', '')), D(GOOD_PAGE.replace('zh-CN', ''))],
    good: [D(GOOD_PAGE)]
  },
  {
    rule: 'head/required',
    bad: [
      headed(HEAD.replace('<meta name="description" content="用于测试的一讲。">\n', '')),
      headed(HEAD.replace('用于测试的一讲。', '')),
      headed(HEAD.replace('utf-8', 'gbk')),
      headed(HEAD.replace('<title>测试讲</title>', '<title> </title>')),
      headed(HEAD.replace('<script src', '<script defer src')),
      headed(HEAD.replace('template/zhixu.css', 'zhixu.css'))
    ],
    good: [D(GOOD_PAGE), headed(HEAD.replace('utf-8', 'UTF-8'))]
  },
  {
    rule: 'head/extra',
    bad: [
      headed(`${HEAD}\n<meta name="author" content="某人">`),
      headed(`${HEAD}\n<meta charset="utf-8">`),
      headed(`${HEAD}\n<script src="template/zhixu.js"></script>`),
      headed(`${HEAD}\n多余的文字`)
    ],
    good: [headed(`<!-- 注释不算 -->\n${HEAD}`)]
  },

  // 禁用内容
  {
    rule: 'forbidden/element',
    bad: [
      F('<iframe src="other.html"></iframe>'),
      F('<script>alert(1)</script>'),
      F('<script src="template/zhixu.js"></script>'),
      F('<style>p { color: red }</style>'),
      F('<form><input name="q"></form>'),
      F('<object data="a.pdf"></object>'),
      F('<embed src="a.pdf">'),
      headed(`${HEAD}\n<style>p { color: red }</style>`)
    ],
    good: [D(GOOD_PAGE)]
  },
  {
    rule: 'forbidden/attr',
    bad: [
      F('<p style="color: red">红字</p>'),
      F('<p onclick="go()">点我</p>'),
      F(SVG.replace('<rect', '<rect onLoad="go()" STYLE="fill: red"'))
    ],
    good: [
      F(
        lines(
          code('python', ['one = 1', 'style = "bold"', 'onclick = None']),
          '<p>设置 <code>style = "bold"</code> 与 <code>one = 1</code>。</p>'
        )
      )
    ]
  },
  {
    rule: 'forbidden/external',
    bad: [
      F('<img src="https://example.com/a.png" alt="外链图">'),
      F('<img src="//example.com/a.png" alt="外链图">'),
      F('<link rel="stylesheet" href="https://example.com/font.css">'),
      F(FIG('<video src="https://example.com/a.mp4" controls></video>')),
      F(FIG('<audio src="//example.com/a.mp3" controls></audio>')),
      F(FIG('<video src="media/a.mp4" poster="https://example.com/a.png" controls></video>'), MEDIA),
      F(
        '<picture><source srcset="images/a.png 1x, https://example.com/a.png 2x"><img src="images/a.png" alt="图"></picture>',
        IMAGE
      )
    ],
    good: [
      F(
        FIG(
          '<picture><source srcset="images/a.png 1x, images/a.png 2x"><img src="images/a.png" alt="本地图"></picture>'
        ),
        IMAGE
      )
    ]
  },

  // 页面结构
  {
    rule: 'main/one',
    bad: [
      bodied(lines('<main>', '<h1>测试讲</h1>', '</main>', '<main>', '<p>第二个</p>', '</main>')),
      bodied(lines(BODY, '<p>main 外面的内容</p>')),
      bodied(lines(BODY, 'main 外面的文字')),
      bodied('<h1>测试讲</h1>'),
      bodied(lines('<div>', BODY, '</div>'))
    ],
    good: [D(GOOD_PAGE), bodied(lines('<!-- 注释 -->', BODY))]
  },
  {
    rule: 'main/h1',
    bad: [
      F('<h1>又一个标题</h1>'),
      bodied(lines('<main>', '<p>先有文字</p>', '<h1>测试讲</h1>', '</main>')),
      bodied(lines('<main>', '<p>没有标题</p>', '</main>'))
    ],
    good: [D(GOOD_PAGE)]
  },
  {
    rule: 'lead/position',
    bad: [
      F('<p class="lead">小节里的导语</p>'),
      M(lines('<p class="lead">一</p>', '<p class="lead">二</p>')),
      M('<div class="lead">不是段落</div>')
    ],
    good: [M(lines('<p class="lead">导语。</p>', section('<p>正文。</p>')))]
  },
  {
    rule: 'goals/position',
    bad: [
      M(lines(section('<p>正文。</p>'), '<ul class="goals">', '<li>目标</li>', '</ul>')),
      M('<ol class="goals"><li>目标</li></ol>')
    ],
    good: [M(lines('<ul class="goals">', '<li>目标一</li>', '<li>目标二</li>', '</ul>', section('<p>正文。</p>')))]
  },
  {
    rule: 'recap/position',
    bad: [
      M(lines(RECAP, section('<p>正文。</p>'))),
      M(lines(section('<p>正文。</p>'), '<div class="recap">不是小节</div>')),
      M(lines(RECAP, RECAP))
    ],
    good: [M(lines(section('<p>正文。</p>'), RECAP))]
  },
  {
    rule: 'section/id',
    bad: [M(lines('<section>', '<h2>小节</h2>', '<p>正文。</p>', '</section>'))],
    good: [D(GOOD_PAGE)]
  },
  {
    rule: 'section/h2',
    bad: [
      M(lines('<section id="a">', '<p>没有标题</p>', '</section>')),
      M(lines('<section class="recap">', '<p>没有标题</p>', '</section>')),
      F('<h2>第二个标题</h2>'),
      F('<div><h2>容器里的标题</h2></div>'),
      M('<h2>小节外的标题</h2>')
    ],
    good: [F('<h3>小标题</h3>')]
  },
  {
    rule: 'section/nested',
    bad: [
      F(lines('<section id="inner">', '<h3>嵌套</h3>', '</section>')),
      F('<div><section id="deep"></section></div>')
    ],
    good: [D(GOOD_PAGE)]
  },
  {
    rule: 'id/format',
    bad: [F('<p id="Fig_1">文字</p>'), F('<p id="1st">文字</p>'), F('<p id="">文字</p>')],
    good: [F('<p id="fig-1">文字</p>')]
  },
  { rule: 'id/reserved', bad: [F('<p id="zx-top">文字</p>')], good: [F('<p id="zxy">文字</p>')] },
  {
    rule: 'id/duplicate',
    bad: [F('<p id="same">一</p>\n<p id="same">二</p>')],
    good: [F('<p id="one">一</p>\n<p id="two">二</p>')]
  },

  // 标记
  {
    rule: 'table/structure',
    bad: [
      F(lines('<table>', '<div>不该在这里</div>', '<tr><td>格</td></tr>', '</table>')),
      F(lines('<table>', '<tr><p>段落</p></tr>', '</table>')),
      F(lines('<table>', '<tbody><td>缺一层</td></tbody>', '</table>')),
      F(lines('<table>', '表格里的文字', '<tr><td>格</td></tr>', '</table>'))
    ],
    good: [F(TABLE), F('<table><tr><td>最简单的表</td></tr></table>')]
  },
  {
    rule: 'details/summary',
    bad: [F('<details><p>没有摘要</p></details>'), F('<details></details>')],
    good: [F('<details><summary>摘要</summary><p>内容</p></details>')]
  },
  {
    rule: 'class/unknown',
    level: 'warning',
    bad: [F('<div class="callot note"><p>文字</p></div>'), F('<p class="highlight">文字</p>')],
    good: [F(FIG(SVG))]
  },
  {
    rule: 'callout/type',
    bad: [
      F('<div class="callout"><p>没有类型</p></div>'),
      F('<div class="callout note pitfall"><p>两个类型</p></div>'),
      F('<p class="callout note">不是 div</p>')
    ],
    good: [
      F(
        lines(
          '<div class="callout note" data-title="标题"><p>补充。</p></div>',
          '<details class="callout question"><summary>想一想</summary><p>答案。</p></details>'
        )
      )
    ]
  },

  // 代码
  {
    rule: 'code/markup',
    bad: [
      F('<pre data-lang="text">没有 code</pre>'),
      F(lines('<pre data-lang="text">', '<code>有换行</code>', '</pre>')),
      F('<pre data-lang="text"><code>一</code><code>二</code></pre>'),
      F('<p>行内 <code>外层 <code>内层</code></code></p>')
    ],
    good: [
      F(
        lines(
          code('c', ['if (a &lt; b &amp;&amp; c) x = &amp;y;']),
          code('css', ['.logo { background: url(logo@2x.png); }']),
          '<p>行内 <code>a &lt; b</code></p>'
        )
      )
    ]
  },
  {
    rule: 'code/lang',
    level: 'warning',
    bad: [F('<pre><code>没有写语言</code></pre>')],
    good: [F(code('text', ['纯文本']))]
  },
  {
    rule: 'code/lang',
    bad: [F(code('klingon', ['x'])), F(code('', ['x']))],
    good: [
      F(
        lines(
          code('python', ['print(1)']),
          code('latex', ['\\frac{1}{2}']),
          code('html', ['&lt;p&gt;段落&lt;/p&gt;']),
          code('c++', ['int x;'])
        )
      )
    ]
  },
  {
    rule: 'code/mark',
    bad: [
      F(code('text', ['一', '二'], ' data-mark="3"')),
      F(code('text', ['一', '二'], ' data-mark="2-1"')),
      F(code('text', ['一', '二'], ' data-mark="a"')),
      F(code('text', ['一', '二'], ' data-mark="1, 2"')),
      F(code('text', ['一', '二'], ' data-mark="0"')),
      F(code('text', ['一', '二'], ' data-lines="10" data-mark="1"')),
      F(code('text', ['一', '二'], ' data-lines="0"')),
      F(code('text', ['一', '二'], ' data-lines="x"'))
    ],
    good: [
      F(code('text', ['一', '二', '三'], ' data-mark="1,2-3"')),
      F(code('text', ['一', '二\n'], ' data-lines data-mark="2"')),
      F(code('text', ['一', '二'], ' data-lines="10" data-mark="10-11"'))
    ]
  },
  {
    rule: 'code/notes',
    bad: [
      F(notes('<li data-line="1">前面没有代码</li>')),
      F(lines(TWO_LINES, '<p>隔了一段</p>', notes('<li data-line="1">不相邻</li>'))),
      F(lines(TWO_LINES, notes('<li data-line="3">超出范围</li>'))),
      F(lines(TWO_LINES, notes('<li>没有行号</li>'))),
      F(lines(TWO_LINES, notes('<li data-line="1-2">不是整数</li>'))),
      F(lines(TWO_LINES, '<ul class="code-notes">', '<li data-line="1">不是 ol</li>', '</ul>')),
      F(lines(code('text', ['一', '二'], ' data-lines="10"'), notes('<li data-line="1">按显示的行号算</li>')))
    ],
    good: [
      F(lines(TWO_LINES, notes('<li data-line="1">第一行</li>', '<li data-line="2">第二行</li>'))),
      F(
        lines(
          code('text', ['一', '二'], ' data-lines="10"'),
          '<!-- 注释不算隔开 -->',
          notes('<li data-line="11">第二行</li>')
        )
      )
    ]
  },
  {
    rule: 'code/indent',
    level: 'warning',
    bad: [
      F(
        code('python', [
          'def f():',
          `${pad(4)}a = 1`,
          `${pad(4)}b = 2`,
          `${pad(4)}c = 3`,
          `${pad(4)}d = 4`,
          `${pad(3)}return a`
        ])
      ),
      F(code('javascript', ['if (a) {', `${pad(2)}b();`, `${pad(1)}c();`, '}']))
    ],
    good: [
      F(code('python', ['def f():', `${pad(4)}if a:`, `${pad(8)}return 1`, '', `${pad(4)}return 2`])),
      F(code('javascript', ['if (a) {', `${pad(2)}if (b) {`, `${pad(4)}c();`, `${pad(2)}}`, '}']))
    ]
  },

  // 公式
  {
    rule: 'code/unescaped',
    bad: [
      F(code('cpp', ['std::vector<int> v;'])),
      F('<p>行内 <code>a && b</code></p>'),
      F('<p>行内 <code>a<b>粗</b></code></p>'),
      F('<pre data-lang="html"><code><!-- 注释 --></code></pre>'),
      F('<p>公式 <span class="math">x<y</span></p>'),
      F('<div class="math">a & b</div>')
    ],
    good: [
      F(
        lines(
          code('cpp', ['std::vector&lt;int> v;', 'x = a &amp;&amp; b;']),
          '<p><span class="math">x \\lt y</span></p>'
        )
      )
    ]
  },
  {
    rule: 'example/syntax',
    bad: [
      F(code('json', ['{ "name": "知序", }'], ' data-file="package.json"')),
      F(code('javascript', ['const total = ;'], ' data-file="sum.js"')),
      F(code('javascript', ['import { a } from "./a.js";', 'export const b = a +;'], ' data-file="b.mjs"')),
      F(code('python', ['def f(:', `${pad(4)}return 1`], ' data-file="f.py"'))
    ],
    good: [
      F(
        lines(
          code('json', ['{ "name": "知序", "lessons": [1, 2] }'], ' data-file="course.json"'),
          code('javascript', ['import { a } from "./a.js";', 'export const b = await a();'], ' data-file="b.mjs"'),
          code('javascript', ['function add(a, b) {', `${pad(2)}return a + b;`, '}'], ' data-file="add.js"'),
          code('python', ['def add(a, b):', `${pad(4)}return a + b`, '', 'print(add(1, 2))'], ' data-file="add.py"'),
          code('javascript', ['const 没写完 ='])
        )
      )
    ]
  },
  {
    rule: 'math/markup',
    bad: [F('<p class="math">x</p>'), F('<p>行内 <span class="math">a <span>b</span></span></p>')],
    good: [
      F(
        lines('<p>行内 <span class="math">O(n \\log n)</span></p>', '<div class="math" id="eq-a">a \\lt b &lt; c</div>')
      )
    ]
  },
  {
    rule: 'math/syntax',
    bad: [
      F('<div class="math">\\frac{a}{</div>'),
      F('<p><span class="math">\\unknowncommand</span></p>'),
      F('<div class="math">a &amp; b</div>')
    ],
    good: [F('<div class="math">\\begin{aligned} a &amp;= b \\\\ c &amp;= d \\end{aligned}</div>')]
  },

  // 图
  {
    rule: 'img/alt',
    bad: [F('<img src="images/a.png">', IMAGE), F('<img src="images/a.png" alt=" ">', IMAGE)],
    good: [F(FIG('<img src="images/a.png" alt="示意图">'), IMAGE)]
  },
  {
    rule: 'img/src',
    bad: [
      F('<img src="images/missing.png" alt="图">'),
      F('<img alt="图">'),
      F('<img src="data:image/png;base64,AAAA" alt="图">'),
      F('<img src="images" alt="图">', IMAGE),
      F('<img src="images/%zz.png" alt="图">')
    ],
    good: [F(FIG('<img src="images/my%20pic.png" alt="图">'), { 'images/my pic.png': 'png' })]
  },
  {
    rule: 'svg/viewbox',
    bad: [
      F('<svg role="img" aria-label="图"><rect width="1" height="1"/></svg>'),
      F('<svg viewbox="0 0 1 1" role="img" aria-label="图"></svg>')
    ],
    good: [F(FIG(SVG))]
  },
  {
    rule: 'svg/label',
    level: 'warning',
    bad: [
      F('<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'),
      F('<svg viewBox="0 0 1 1" role="img"></svg>'),
      F('<svg viewBox="0 0 1 1" aria-label="图"></svg>')
    ],
    good: [F(FIG('<svg viewBox="0 0 1 1" aria-hidden="true"><rect width="1" height="1"/></svg>'))]
  },
  {
    rule: 'media/figure',
    bad: [
      F('<p>段落里的图 <img src="images/a.png" alt="图"></p>', IMAGE),
      F(SVG),
      F('<audio src="media/a.mp3" controls></audio>', MEDIA),
      F('<p><video src="media/a.mp4" controls></video></p>', MEDIA)
    ],
    good: [F(FIG(SVG)), F(FIG('<a href="https://example.com"><img src="images/a.png" alt="带链接的图"></a>'), IMAGE)]
  },

  {
    rule: 'player/controls',
    bad: [
      F(FIG('<audio src="media/a.mp3"></audio>'), MEDIA),
      F(FIG('<video src="media/a.mp4" autoplay></video>'), MEDIA)
    ],
    good: [
      F(FIG('<audio src="media/a.mp3" controls></audio>'), MEDIA),
      F(FIG('<video src="media/a.mp4" poster="images/a.png" controls></video>'), { ...MEDIA, ...IMAGE })
    ]
  },
  {
    rule: 'player/src',
    bad: [
      F(FIG('<audio src="media/missing.mp3" controls></audio>')),
      F(FIG('<video controls><source src="media/a.mp4"></video>'), MEDIA),
      F(FIG('<audio src="data:audio/wav;base64,AAAA" controls></audio>')),
      F(FIG('<video src="media/a.mp4" poster="images/missing.png" controls></video>'), MEDIA)
    ],
    good: [F(FIG('<video src="media/a%20b.mp4" controls></video>'), { 'media/a b.mp4': 'mp4' })]
  },

  // 小测
  { rule: 'quiz/markup', bad: [F(lines('<ul class="quiz">', '<li>不是 div</li>', '</ul>'))], good: [F(GOOD_QUIZZES)] },
  {
    rule: 'quiz/stem',
    bad: [
      F(quiz(' data-answer="a"', THREE)),
      F(quiz(' data-answer="a"', '没有包在元素里的题干', THREE)),
      F(quiz('', EXPLAIN)),
      F(quiz(' data-answer="a"', THREE, STEM))
    ],
    good: [F(quiz(' data-answer="a"', '<p>看图回答：</p>', FIGURE, THREE))]
  },
  {
    rule: 'quiz/options',
    bad: [
      F(quiz(' data-answer="a"', STEM, options('只有一个'))),
      F(quiz(' data-answer="a"', STEM, lines('<ol>', '<li>一</li>', '<p>不是选项</p>', '</ol>')))
    ],
    good: [F(quiz(' data-answer="b"', STEM, options('题干里的列表', '不是选项'), options('对', '错')))]
  },
  {
    rule: 'quiz/answer',
    bad: [
      F(quiz(' data-answer="d"', STEM, THREE)),
      F(quiz(' data-answer="c,a"', STEM, THREE)),
      F(quiz(' data-answer="a,a"', STEM, THREE)),
      F(quiz(' data-answer="A"', STEM, THREE)),
      F(quiz(' data-answer="a, b"', STEM, THREE)),
      F(quiz(' data-answer=""', STEM, THREE)),
      F(quiz('', STEM, THREE)),
      F(quiz(' data-answer="20|"', STEM))
    ],
    good: [F(quiz(' data-answer="a,b,c"', STEM, THREE))]
  },
  {
    rule: 'quiz/explain',
    bad: [F(quiz('', STEM)), F(quiz(' data-answer=""', STEM)), F(quiz('', STEM, HINT))],
    good: [F(quiz('', STEM, EXPLAIN))]
  },
  {
    rule: 'quiz/parts',
    bad: [
      F(quiz(' data-answer="a"', STEM, THREE, HINT, HINT)),
      F(quiz('', STEM, EXPLAIN, EXPLAIN)),
      F(quiz(' data-answer="a"', STEM, HINT, THREE))
    ],
    good: [F(quiz(' data-answer="a"', STEM, THREE, EXPLAIN, HINT))]
  },
  {
    rule: 'quiz/duplicate',
    bad: [F(lines(quiz('', STEM, EXPLAIN), quiz('', STEM, EXPLAIN)))],
    good: [
      F(lines(quiz('', STEM, EXPLAIN), quiz(' id="again"', STEM, EXPLAIN))),
      // 两讲各有一道题干相同的小测：记录按文件分开存，不算重复
      { [LESSON]: fragmentPage(quiz('', STEM, EXPLAIN)), 'other.html': fragmentPage(quiz(' data-answer="x"', STEM)) }
    ]
  },

  // 其他组件
  {
    rule: 'stepper/frames',
    bad: [
      F(stepper(frame('只有一帧', '说明'))),
      F(stepper(frame('一', '说明'), '<p>不是帧</p>', frame('二', '说明'))),
      F(lines('<ol class="stepper">', '<li>不是 div</li>', '</ol>'))
    ],
    good: [F(stepper(frame('第一帧', '说明一'), frame('第二帧', '说明二')))]
  },
  {
    rule: 'stepper/frames',
    level: 'warning',
    bad: [F(stepper(frame('第一帧', '说明'), frame('第二帧', '')))],
    good: [F(stepper(frame('一', '甲'), frame('二', '乙'), frame('三', '丙')))]
  },
  {
    rule: 'tabs/panels',
    bad: [
      F(tabs('只有一个')),
      F(tabs('同名', '同名')),
      F(tabs('有名字', '')),
      F(
        lines(
          '<div class="tabs">',
          '<div data-tab="甲"></div>',
          '<p>不是面板</p>',
          '<div data-tab="乙"></div>',
          '</div>'
        )
      ),
      F(tabs('甲', '乙').replace(/div/g, 'section'))
    ],
    good: [F(tabs('Python', 'JavaScript'))]
  },
  {
    rule: 'tree/markup',
    bad: [
      F(lines('<ol class="tree">', '<li>根</li>', '</ol>')),
      F(lines('<div class="tree">', '<p>不是列表</p>', '</div>')),
      F(lines('<ul class="tree">', '<li>根<ol><li>子节点写成了有序列表</li></ol></li>', '</ul>'))
    ],
    good: [
      F(
        lines(
          '<ul class="tree">',
          '<li>根<ul><li>甲<ul><li>甲一</li></ul></li><li>乙</li></ul></li>',
          '<li>另一棵</li>',
          '</ul>'
        )
      )
    ]
  },
  {
    rule: 'tasks/duplicate',
    bad: [F(tasks('同一件事', '同一件事')), F(lines(tasks('同一件事', '别的事'), tasks('同一件事')))],
    good: [F(lines(tasks('第一件事', '第二件事'), '<ol><li>第一件事</li><li>第一件事</li></ol>'))]
  },
  {
    rule: 'note/inline',
    bad: [F('<p>正文<span class="note"><div>块</div></span></p>')],
    good: [F('<p>正文<span class="note">旁注里有 <em>强调</em> 与 <code>代码</code>。</span></p>')]
  },
  {
    rule: 'note/attach',
    bad: [
      F('<p>正文 <span class="note">前面留了空格。</span>接着写。</p>'),
      F(lines('<p>', '  正文', '  <span class="note">前面换了行。</span>。', '</p>')),
      F('<p><strong>加粗的词</strong> <span class="note">和加粗的词之间留了空格。</span>。</p>'),
      F('<p><span class="note">前面什么都没有。</span>正文。</p>')
    ],
    good: [
      F(
        '<p>正文<span class="note">紧跟在字后面。</span>，<strong>加粗的词</strong><span class="note">紧跟在加粗的词后面。</span>。</p>'
      )
    ]
  },
  {
    rule: 'note/heading',
    bad: [
      M(
        lines(
          '<section id="part">',
          '<h2>小节<span class="note">标题里的旁注。</span></h2>',
          '<p>正文。</p>',
          '</section>'
        )
      ),
      D(
        htmlPage(
          HEAD,
          lines(
            '<main>',
            '<h1>测试讲<span class="note">标题里的旁注。</span></h1>',
            section('<p>正文。</p>'),
            '</main>'
          )
        )
      )
    ],
    good: [
      M(
        lines(
          '<section id="part">',
          '<h2>小节</h2>',
          '<h3>小标题<span class="note">小标题不进目录，可以带旁注。</span></h3>',
          '<p>正文。</p>',
          '</section>'
        )
      )
    ]
  },
  {
    rule: 'term/empty',
    bad: [F('<p><dfn data-def="">术语</dfn></p>'), F('<p><dfn data-def="定义"> </dfn></p>'), F('<p><dfn></dfn></p>')],
    good: [F('<p><dfn data-def="一个定义。">术语</dfn>，后面再提 <dfn>术语</dfn>。</p>')]
  },
  {
    rule: 'term/duplicate',
    level: 'warning',
    bad: [
      F('<p><dfn data-def="定义一">术语</dfn> 与 <dfn data-def="定义二">术语</dfn></p>'),
      {
        [LESSON]: fragmentPage('<p><dfn data-def="甲">术语</dfn></p>'),
        'other.html': fragmentPage('<p><dfn data-def="乙">术语</dfn></p>')
      }
    ],
    good: [F('<p><dfn data-def="甲">术语一</dfn> 与 <dfn data-def="乙">术语二</dfn></p>')]
  },
  {
    rule: 'term/undefined',
    bad: [F('<p><dfn>没定义过</dfn></p>')],
    good: [
      {
        [LESSON]: fragmentPage('<p>先用 <dfn>术语</dfn>。</p>'),
        'other.html': fragmentPage('<p>后面才定义 <dfn data-def="定义。">术语</dfn>。</p>')
      }
    ]
  },

  // 链接
  {
    rule: 'link/target',
    bad: [
      F('<p><a href="#nope">文字</a></p>'),
      F('<p><a href="missing.html">文字</a></p>'),
      F('<p><a href="other.html#nope">文字</a></p>', { 'other.html': OTHER }),
      F('<p><a href="OTHER.html">大小写不同</a></p>', { 'other.html': OTHER }),
      F('<p><a href="#zx-recap">小结</a></p>'),
      F('<p><a href="files/none.pdf">讲义</a></p>'),
      F('<p><a href="javascript:alert(1)">点</a></p>'),
      F('<p><a href="//example.com">省略了协议</a></p>'),
      F('<p><a href="index.html#top">首页</a></p>'),
      F('<p><a href="">空地址</a></p>'),
      C(course(), {
        [LESSON]: fragmentPage('<p><a href="extra.html">没登记的页面</a></p>'),
        'extra.html': OTHER,
        'index.html': 'x'
      })
    ],
    good: [
      F(
        '<p id="here"><a href="#here">本页</a>、<a href="other.html">另一讲</a>、<a href="other.html#part">小节</a>、<a href="lesson.html#here">自己</a>、<a href="index.html">首页</a>、<a href="files/a%20b.pdf">讲义</a>、<a href="https://example.com/?a=1&amp;b=2">外部</a>、<a href="mailto:a@example.com">邮件</a>、<a href="tel:10086">电话</a>、<a>没有地址</a></p>',
        { 'other.html': OTHER, 'files/a b.pdf': 'pdf' }
      )
    ]
  },
  {
    rule: 'link/empty',
    bad: [
      F('<p id="plain">见<a href="#plain"></a></p>'),
      F('<p>见<a href="https://example.com"> </a></p>'),
      F('<p>见<a href="index.html"></a></p>'),
      F('<p>见<a href="files/a.pdf"></a></p>', { 'files/a.pdf': 'pdf' }),
      M(
        lines(section('<p>见<a href="#summary"></a></p>'), RECAP.replace('class="recap"', 'class="recap" id="summary"'))
      ),
      F('<p>见<a href="other.html#plain"></a></p>', { 'other.html': fragmentPage('<p id="plain">普通段落</p>') })
    ],
    good: [
      F(
        lines(
          FIGURE,
          TABLE.replace('<table>', '<table id="tab-a">'),
          '<p>见<a href="#fig-a"></a>、<a href="#tab-a"></a>、<a href="#part"></a>、<a href="other.html"></a>、<a href="other.html#part"></a>。</p>'
        ),
        { 'other.html': OTHER }
      ),
      F(FIG('<a href="https://example.com"><img src="images/a.png" alt="只有图片的链接"></a>'), IMAGE)
    ]
  },

  // 文字
  {
    rule: 'text/markdown',
    level: 'warning',
    bad: [
      F('<p>这是 **加粗** 的写法</p>'),
      F('<p>行内 `code` 的写法</p>'),
      F('<p>公式 $a_1 + b^2$ 的写法</p>'),
      F('<p>公式 $\\frac{1}{2}$</p>')
    ],
    good: [
      F(
        lines(
          '<p>价格 $5 和 $10；乘方写成 <code>2 ** 10 ** 2</code>；Markdown 里用 <code>`code`</code> 与 <code>$a_1$</code>。</p>',
          code('markdown', ['**加粗** 与 `代码` 与 $a_1$'])
        )
      )
    ]
  },
  {
    rule: 'font/coverage',
    level: 'warning',
    bad: [F(`<p>生僻字：${RARE}</p>`)],
    good: [F(lines(`<p>常用汉字 ABC 123 ${EMOJI}</p>`, `<p><code>${RARE}</code></p>`, code('text', [RARE])))]
  },

  // 课程清单
  {
    rule: 'course/shape',
    bad: [
      C(course({ id: 'Bad ID' }), D(GOOD_PAGE)),
      C(course({ title: ' ' }), D(GOOD_PAGE)),
      C(course({ subtitle: 5 }), D(GOOD_PAGE)),
      C(course({ units: [] }), D(GOOD_PAGE)),
      C(course({ units: 'lesson.html' }), D(GOOD_PAGE)),
      C(course({ units: [{ lessons: [] }] }), D(GOOD_PAGE)),
      C(course({ units: [{ lessons: [LESSON] }, { lessons: ['other.html'] }] }), {
        [LESSON]: GOOD_PAGE,
        'other.html': OTHER
      }),
      C(course({ units: [{ lessons: [LESSON, 'My Lesson.html'] }] }), D(GOOD_PAGE)),
      C(course({ units: [{ lessons: [LESSON, 'index.html'] }] }), D(GOOD_PAGE)),
      C(course({ units: [{ lessons: [LESSON, 7] }] }), D(GOOD_PAGE)),
      C(course({ units: [null] }), D(GOOD_PAGE)),
      C('window.ZHIXU_COURSE = 5;\n', D(GOOD_PAGE)),
      C('var course = 1;\n', D(GOOD_PAGE)),
      C('window.ZHIXU_COURSE = {\n', D(GOOD_PAGE)),
      C('window.ZHIXU_COURSE = missing;\n', D(GOOD_PAGE))
    ],
    good: [C(course(), D(GOOD_PAGE)), C(TWO_UNITS, { [LESSON]: GOOD_PAGE, 'other.html': OTHER })]
  },
  {
    rule: 'course/missing-file',
    bad: [C(course({ units: [{ lessons: [LESSON, 'ghost.html'] }] }), D(GOOD_PAGE))],
    good: [C(course(), D(GOOD_PAGE))]
  },
  {
    rule: 'course/duplicate-lesson',
    bad: [C(course({ units: [{ lessons: [LESSON, LESSON] }] }), D(GOOD_PAGE))],
    good: [C(course(), D(GOOD_PAGE))]
  },
  {
    rule: 'course/comment',
    bad: [
      C(
        'window.ZHIXU_COURSE = {\n  // 课程标识\n  id: "test",\n  title: "测试课程",\n  units: [{ lessons: ["lesson.html"] }]\n};\n',
        { [LESSON]: GOOD_PAGE }
      ),
      C(
        '/* 清单 */\nwindow.ZHIXU_COURSE = { id: "test", title: "测试课程", units: [{ lessons: ["lesson.html"] }] };\n',
        { [LESSON]: GOOD_PAGE }
      )
    ],
    good: [
      C(
        {
          id: 'test',
          title: '测试课程',
          description: '资料见 https://example.com/a//b，不是注释',
          units: [{ lessons: [LESSON] }]
        },
        { [LESSON]: GOOD_PAGE }
      )
    ]
  },
  {
    rule: 'course/unlisted',
    bad: [C(course(), { [LESSON]: GOOD_PAGE, 'draft.html': OTHER })],
    good: [
      C(course(), {
        [LESSON]: GOOD_PAGE,
        'index.html': '首页不是一讲，不检查',
        'notes/draft.html': '子目录里的页面不算'
      })
    ]
  }
];

module.exports = { CASES, LESSON, F, lines, code };
