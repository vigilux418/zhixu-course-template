# 知序 · 写作契约

给写课的 Agent。读完这一份就能动笔，不需要再读别的文档。

知序是一套离线课程模板：**你只写语义化的 HTML 正文**，导航、编号、目录、搜索、代码高亮、公式排版、小测记录、打印样式都由引擎自动完成。双击 `index.html` 就能阅读，不需要服务器。

## 1. 文件夹

```text
课程根目录/
├─ index.html       首页。由工具生成，不要手改
├─ 01-xxx.html      每讲一个文件；文件名就是这一讲的身份
├─ images/          图片（可选）
├─ course/
│  ├─ course.js     课程清单：手写
│  └─ data.js       目录与搜索数据：由工具生成，不要手改
└─ template/        引擎：只读。升级时整个文件夹替换
```

你只会碰三样东西：`course/course.js`、各讲的 `.html`、`images/`（音视频另建 `media/`）。根目录下的 HTML 只能是首页和登记在清单里的各讲；别的文件放进子目录。

## 2. 工作流

写课工具使用 Node 26 LTS，无需安装第三方依赖。所有命令都在课程根目录运行，前面都是 `node template/tools/zx.js`。

模板引擎采用 [MIT 许可](LICENSE)。`pack` 的单文件包含引擎及实际内置组件的许可。课程内容的授权由课程作者决定。

```bash
node template/tools/zx.js outline               # 看大纲：各讲的字数与时长、小节 id、图表编号、已有术语
node template/tools/zx.js new 05-sorting "排序"   # 新建一讲并登记到清单；--unit 2 指定单元
node template/tools/zx.js build 05-sorting      # 检查并生成目录数据；不写讲义名就是全课
node template/tools/zx.js look 05-sorting       # 用本机的 Chrome 或 Edge 排出来，报告看得见的版面问题
```

1. 写正文，运行 `build`。它逐条报告 `行:列  级别  规则  说明`，照着改到 0 个 error。
2. 运行 `look`。它在宽屏、手机和打印三种版面下检查：溢出、图里的文字出框或重叠、坏掉的图片等，每条都附改法。改到“没有发现问题”。
3. 想亲眼看：`look --shots` 给出截图文件的路径；或者 `preview` 起一个本地预览。

要知道的三件事：

- **只有 `build` 会改讲义，而且只改一种地方**：代码和公式里没转义的 `<`、`&`，它直接替你改成 `&lt;`、`&amp;` 并告诉你改了几处。
- `build` 有 error 时，生成文件照样更新（方便预览）；交付前必须 0 error。
- **讲义的文件名就是它的身份**：读者的学习记录按文件名存放。发布后不改名；调整顺序只改清单。

其余命令：`check`（只检查，`--json` 输出机器可读的结果）、`pack`（把整门课导出成一个 HTML，写到 `export/`，发到手机上就能看）、`preview`、`init ../新目录 "课程名"`（新建一门空课程）。

预览与截图的约定：页面启动完成后 `<html>` 上会出现 `zx-ready` 类，此时就是最终状态，没有滚动触发的动画；地址后加 `?theme=light`、`sepia` 或 `dark` 可以临时指定主题；引擎出错时页面顶部直接显示原因，不会白屏。

## 3. 课程清单 `course/course.js`

```js
window.ZHIXU_COURSE = {
  id: "thinking-in-algorithms",
  title: "算法与问题求解",
  subtitle: "从零开始，学会把问题讲清楚",
  description: "四讲建立算法直觉：什么是算法、如何查找、如何衡量快慢、如何用递归拆解问题。",
  author: "知序示例课程",
  units: [
    {
      title: "建立直觉",
      description: "先弄清算法是什么，再看一个漂亮的例子。",
      lessons: ["01-what-is-an-algorithm.html", "02-binary-search.html"]
    },
    {
      title: "度量与递归",
      lessons: ["03-time-complexity.html", "04-recursion.html"]
    }
  ]
};
```

- `id`：小写字母、数字、连字符。读者的学习记录按它存放，每门课必须不同，定下来不要再改。
- `title` 必填；`subtitle`、`description`、`author` 可省略。
- `units`：按顺序列出单元；`lessons` 里的顺序就是阅读顺序。讲义文件名只用小写字母、数字和连字符。单元的 `description` 可省略；全课只有一个单元时，`title` 也可以省略。
- 讲的标题、摘要、时长、小节都从各讲 HTML 里读取，这里不重复写。
- 不要写注释：`new` 登记新的一讲时会重写这个文件。

## 4. 一讲的骨架

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>二分查找</title>
<meta name="description" content="在有序数据里，每次比较都排除一半候选。">
<link rel="stylesheet" href="template/zhixu.css">
<script src="template/zhixu.js"></script>
</head>
<body>
<main>
<h1>每次扔掉一半：二分查找</h1>
<p class="lead">翻字典时没有人从第一页开始找。把这个习惯写成步骤，就是二分查找。</p>
<ul class="goals">
  <li>说清二分查找成立的前提</li>
  <li>手工模拟一次查找过程</li>
</ul>

<section id="idea">
<h2>核心想法</h2>
<p>正文……</p>
</section>

<section class="recap">
<h2>本讲小结</h2>
<ul>
  <li>二分查找要求数据有序。</li>
  <li>每次比较排除一半候选，所以很快。</li>
</ul>
</section>
</main>
</body>
</html>
```

- `<head>` 里只有这六行，除了 `<title>` 和摘要的内容，其余原样照抄。
- `<title>`：这一讲的短名，用在目录、侧栏和上一讲/下一讲。摘要用在首页目录和搜索结果。
- `<h1>`：页面顶部的大标题，全页唯一，是 `<main>` 的第一个元素，可以比 `<title>` 写得更有吸引力。
- `<p class="lead">` 导语、`<ul class="goals">` 学习目标（2–4 条）、`<section class="recap">` 小结（放在最后），都可省略。
- 正文分成若干 `<section id="…">`，每个以 `<h2>` 开头；小节内部的小标题用 `<h3>`。
- 讲次、小节编号（如 2.1）、阅读时长、目录、上一讲/下一讲都是自动生成的，不要手写。

## 5. 组件

先在这里找合适的组件，再动笔。不要自创类名，也不要写行内样式。

### 5.1 行内

```html
<p>普通强调用 <strong>加粗</strong> 与 <em>着重</em>，关键句可以 <mark>标亮</mark>。
行内代码写成 <code>mid = (lo + hi) // 2</code>，按键写成 <kbd>Ctrl</kbd> + <kbd>K</kbd>，
行内公式写成 <span class="math">O(\log n)</span>。</p>

<p>第一次出现的术语用 <dfn data-def="解决一类问题的、有限且明确的步骤。">算法</dfn> 标出并给出定义；
它会进入全课术语表。之后再提到时只写 <dfn>算法</dfn>，读者点一下就能看到定义。</p>

<p>正文之外的补充放进旁注<span class="note">宽屏上排在正文右侧的页边；窄屏上点序号弹出来。</span>，不打断主线。</p>
```

- 旁注 `<span class="note">`：一两句话的补充、出处、提醒，只放行内内容。它替代脚注。紧跟在它标注的词后面，中间不留空格和换行。不能放在 `<h1>`、`<h2>` 里。写在提示卡、表格等容器里的旁注不进页边，点序号弹出来。
- 术语 `<dfn>`：定义写在 `data-def` 里，纯文本。同一个术语全课只定义一次。

### 5.2 链接与自动编号

图、表、例题、带 `id` 的公式会自动编号（图 2-1、表 2-1、例 2-1、式 2-1），小节编号为 2.1、2.2。引用时把链接文字留空，引擎会填上正确的编号：

```html
<figure id="fig-halving">
  <svg viewBox="0 0 320 60" role="img" aria-label="区间每次缩小一半">
    <rect class="f-accent-soft s-accent" x="10" y="15" width="300" height="30" rx="6"/>
    <rect class="f-accent" x="10" y="15" width="150" height="30" rx="6"/>
  </svg>
  <figcaption>每比较一次，候选区间缩小一半。</figcaption>
</figure>
<p>如<a href="#fig-halving"></a>所示，区间不断减半。时间复杂度的定义见<a href="03-time-complexity.html"></a>。</p>
```

| 写法 | 显示为 |
|---|---|
| `<a href="#fig-halving"></a>` | 图 2-1 |
| `<a href="#idea"></a>`（指向小节） | 2.1 节 |
| `<a href="03-time-complexity.html"></a>` | 第 3 讲《时间复杂度》 |
| `<a href="03-time-complexity.html#big-o"></a>` | 3.2 节 |

有文字的链接照常写：`<a href="02-binary-search.html#idea">二分查找的核心想法</a>`。外部链接写完整的 `https://` 地址。别的讲里有哪些 id，看 `outline`。

### 5.3 提示卡

```html
<div class="callout pitfall">
  <p>循环条件写成 <code>lo &lt; hi</code> 会漏掉最后一个元素。</p>
</div>

<div class="callout insight" data-title="为什么这么快">
  <p>每一步都把问题规模减半，一百万个元素也只需要二十步左右。</p>
</div>

<details class="callout question">
  <summary>想一想：如果数组没有排序呢？</summary>
  <p>那么“比中间大就去右半边”这个推理不再成立，只能逐个检查。</p>
</details>
```

类型决定颜色、图标和默认标题；`data-title` 可以改标题。`<details class="callout 类型">` 是可折叠的提示卡，标题写在 `<summary>` 里。

| 类型 | 默认标题 | 用途 |
|---|---|---|
| `note` | 补充 | 背景、延伸、出处 |
| `insight` | 直觉 | 帮助理解的类比与思路 |
| `memory` | 记忆法 | 口诀、助记 |
| `question` | 想一想 | 引导思考的问题 |
| `pitfall` | 易错 | 常见错误与误解 |
| `danger` | 警告 | 会造成严重后果的事 |
| `exam` | 考点 | 考试与面试重点 |

### 5.4 折叠

```html
<details>
  <summary>为什么不用 (lo + hi) / 2？</summary>
  <p>在整数有上限的语言里，<code>lo + hi</code> 可能溢出。</p>
</details>
```

每个 `<details>` 的第一个子元素必须是 `<summary>`。几个 `<details>` 写上相同的 `name` 属性，就成为一次只展开一个的手风琴。

### 5.5 代码

```html
<pre data-lang="python" data-file="binary_search.py" data-mark="4"><code>def binary_search(items, target):
    lo, hi = 0, len(items) - 1
    while lo &lt;= hi:
        mid = (lo + hi) // 2
        if items[mid] == target:
            return mid
        if items[mid] &lt; target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1</code></pre>
<ol class="code-notes">
  <li data-line="3">用 <code>&lt;=</code>：区间只剩一个元素时仍要检查它。</li>
  <li data-line="8">目标更大，去右半边；<code>mid</code> 已经排除，所以加一。</li>
</ol>
```

- `data-lang`：语言名，如 `python`、`javascript`、`typescript`、`c`、`cpp`、`java`、`go`、`rust`、`sql`、`bash`、`json`、`yaml`、`html`、`css`、`latex`；不需要高亮时写 `text`。
- `data-file`：显示在代码框顶部的文件名。**带 `data-file` 的代码是一份完整、能运行的文件**：`build` 会检查 JSON、JavaScript、Python 的语法。片段和有意写错的示范不要加它。
- `data-lines`：显示行号；`data-lines="10"` 表示从第 10 行开始编号。`data-mark="4,6-8"`：标亮指定的行，行号以显示出来的为准。
- `<ol class="code-notes">`：紧跟在 `<pre>` 后面的逐行讲解，每条用 `data-line` 指向一行。
- `<code>` 后面紧跟代码的第一行，不要另起一行，否则顶部会多出一个空行。
- `<pre><code>` 与行内 `<code>` 里只能有文字。`<` 写成 `&lt;`，`&` 写成 `&amp;`；漏了的，`build` 会替你改好。

### 5.6 公式

公式用 LaTeX 书写，由内置的 KaTeX 离线排版。

```html
<p>行内公式：归并排序的时间复杂度是 <span class="math">O(n \log n)</span>。</p>
<div class="math" id="eq-master">T(n) = 2\,T\!\left(\frac{n}{2}\right) + O(n)</div>
<p>把<a href="#eq-master"></a>逐层展开，就得到上面的结论。</p>
```

- 行内用 `<span class="math">`，独立成行用 `<div class="math">`。带 `id` 的独立公式会编号。
- 小于号、大于号写成 `\lt`、`\gt`。`build` 用同一个 KaTeX 校验每条公式，语法错误直接报出位置。

### 5.7 表格

```html
<table>
  <caption>两种查找方式的比较</caption>
  <thead>
    <tr><th>方法</th><th>前提</th><th class="num">一百万个元素最多比较</th></tr>
  </thead>
  <tbody>
    <tr><td>顺序查找</td><td>无</td><td class="num">1 000 000 次</td></tr>
    <tr><td>二分查找</td><td>有序</td><td class="num">20 次</td></tr>
  </tbody>
</table>
```

直接写 `<table>`，不需要外层容器；正文栏放不下时，宽屏上自动伸进右侧的页边（代码块和图也一样），再放不下才横向滚动。`<caption>` 是表题，会自动编号。数字列的单元格加 `class="num"` 右对齐。

### 5.8 图

```html
<figure>
  <svg viewBox="0 0 360 120" role="img" aria-label="三个步骤依次相连">
    <rect class="f-card s-line" x="10" y="35" width="90" height="50" rx="8"/>
    <rect class="f-accent-soft s-accent" x="135" y="35" width="90" height="50" rx="8"/>
    <rect class="f-mark-soft s-mark" x="260" y="35" width="90" height="50" rx="8"/>
    <path class="s-muted w2" d="M100 60H135M225 60H260"/>
    <text class="t-title" x="55" y="65" text-anchor="middle">输入</text>
    <text class="t-title" x="180" y="65" text-anchor="middle">处理</text>
    <text class="t-title" x="305" y="65" text-anchor="middle">输出</text>
    <text class="t-small" x="180" y="108" text-anchor="middle">每一步都必须明确</text>
  </svg>
  <figcaption>算法把输入一步步变成输出。</figcaption>
</figure>
```

- 图片和 SVG 都要放在 `<figure>` 里。`<figcaption>` 是图题，会自动编号。并排的两三张图放进 `<div class="figures">`。
- 内联 SVG 必须有 `viewBox`，并用 `role="img"` 与 `aria-label` 说明内容。`viewBox` 的一个单位就是屏幕上的一个像素，屏幕窄时等比缩小；宽度不要超过 660，文字默认 14 像素。文字不要伸出 `viewBox`，也不要互相重叠（`look` 会查）。
- 不要写死颜色，用工具类，图就会跟随明暗主题。颜色名：`ink`（最深）、`text`、`muted`、`line`（细线）、`accent`、`accent-soft`、`mark`、`mark-soft`、`card`、`soft`；`f-颜色名` 是填充，`s-颜色名` 是描边。线宽 `w1`、`w2`，虚线 `dash`。文字 `t-title` 为标题字，`t-small` 为小字，`t-mono` 为等宽字。
- 位图写 `<img src="images/x.png" alt="说明文字">`，文件放在 `images/`，`alt` 必填。显示得比原图小的图，读者可以点开看原始大小。
- 音频和视频同样放在 `<figure>` 里：`<audio src="media/x.mp3" controls></audio>`、`<video src="media/x.mp4" controls></video>`。文件放在课程目录里，`controls` 必写。文件尽量压小：`pack` 会把它们嵌进单文件，超过 20 MB 会提醒。

### 5.9 步骤、流程、时间线、一排格子、树

```html
<ol class="steps">
  <li><h4>取中点</h4><p>看区间正中间的元素。</p></li>
  <li><h4>比较</h4><p>与目标比较，决定去左半边还是右半边。</p></li>
</ol>

<ol class="flow">
  <li>读题</li>
  <li>拆解<small>分成小问题</small></li>
  <li>验证</li>
</ol>

<ol class="timeline">
  <li><time>1946</time> 莫奇利在讲座中第一次公开描述二分查找。</li>
  <li><time>1962</time> 第一个没有错误的实现发表。</li>
</ol>

<div class="cells">
  <span class="on" data-label="lo">2</span><span class="on">5</span><span class="hit" data-label="mid">8</span><span class="on">12</span><span class="off">16</span>
</div>

<ul class="tree">
  <li>fib(4)
    <ul>
      <li>fib(3)<ul><li>fib(2)</li><li>fib(1)</li></ul></li>
      <li>fib(2)</li>
    </ul>
  </li>
</ul>
```

- `steps`：需要逐步说明的操作过程。`flow`：一行之内的流程示意，每格只写短语，可用 `<small>` 加一行说明。`timeline`：按时间排列的事件，时间写在 `<time>` 里。
- `cells`：一排格子，画数组、字符串、栈、队列，**不要为它们手绘 SVG**。可以单独用，也可以放在图或演示里。格子的状态：`on` 正在考虑，`hit` 当前焦点，`off` 已排除；`data-label` 在格子下方加标注。
- `tree`：嵌套的 `<ul>` 画成带连线的树，用于目录结构、递归调用、分类体系。子节点写成这一项里面的 `<ul>`。

### 5.10 并列卡片与定义列表

```html
<div class="cards">
  <div><h4>顺序查找</h4><p>从头到尾逐个比较，不要求数据有序。</p></div>
  <div><h4>二分查找</h4><p>每次排除一半，要求数据有序。</p></div>
</div>

<dl>
  <dt>输入</dt><dd>问题给出的已知信息。</dd>
  <dt>输出</dt><dd>希望得到的答案。</dd>
</dl>
```

`cards` 用于两到四个并列的要点或左右对比；`<dl>` 用于“名称—解释”式的清单。

### 5.11 例题

```html
<div class="example">
  <p>在 <code>[2, 5, 8, 12, 16, 23, 38]</code> 中查找 23，需要比较几次？</p>
  <details class="answer">
    <summary>解答</summary>
    <p>依次比较 12、23，共两次。</p>
  </details>
</div>
```

例题自动编号；`data-title` 可以加一个标题。解答放在 `<details class="answer">` 里，读者先想再看。

### 5.12 小测

```html
<div class="quiz" data-answer="b">
  <p>二分查找每比较一次，大约排除多少候选？</p>
  <ol>
    <li>一个</li>
    <li>一半</li>
    <li>全部</li>
  </ol>
  <p class="hint">想想比较之后，区间的哪一部分不必再看。</p>
  <div class="explain"><p>目标只可能在中点的一侧，另一侧整体排除。</p></div>
</div>

<div class="quiz" data-answer="a,c">
  <p>下面哪些数据可以直接使用二分查找？</p>
  <ol>
    <li>按学号排好序的名单</li>
    <li>随手记下的电话号码</li>
    <li>按拼音排序的词典</li>
  </ol>
</div>

<div class="quiz" data-answer="20|二十">
  <p>在一百万个有序元素中查找，二分查找最多比较大约多少次？</p>
  <div class="explain"><p>因为 <span class="math">2^{20} \approx 10^6</span>。</p></div>
</div>

<div class="quiz">
  <p>用自己的话解释：为什么二分查找要求数据有序？</p>
  <div class="explain"><p>只有在有序时，“比中间小”才能推出“目标一定在左半边”。</p></div>
</div>
```

| 题型 | 写法 |
|---|---|
| 单选 | `data-answer="b"`，字母对应第几个选项 |
| 多选 | `data-answer="a,c"` |
| 填空 | 不写 `<ol>`；`data-answer` 是答案，多个可接受的答案用 `\|` 分隔 |
| 自评 | 不写 `data-answer` 和 `<ol>`；必须有 `.explain`，读者对照后自己判断对错 |

- 题干写在最前面，放在 `<p>` 等元素里，可以包含代码、公式和图。
- 小测里直属的 `<ol>` 就是选项。填空题和自评题的题干要用编号列表时，把它包进一个 `<div>`。
- `.hint`（可省略）：第一次答错时给出的提示。`.explain`（可省略）：答案揭晓后的解析。
- 作答记录、每讲得分和首页的“错题回顾”自动生成。
- 同一讲里两道小测的题干不能一模一样；给其中一道写上 `id`（如 `<div class="quiz" id="q-queue" data-answer="b">`）就可以，学习记录按这个 `id` 分开存。不同讲之间题干相同没有关系。

### 5.13 步进演示

```html
<div class="stepper" data-title="在有序数组里找 23">
  <figure>
    <div class="cells">
      <span class="on" data-label="lo">2</span><span class="on">5</span><span class="on">8</span><span class="hit" data-label="mid">12</span><span class="on">16</span><span class="on">23</span><span class="on" data-label="hi">38</span>
    </div>
    <figcaption>中点是 12，比 23 小：目标只可能在右半边。</figcaption>
  </figure>
  <figure>
    <div class="cells">
      <span class="off">2</span><span class="off">5</span><span class="off">8</span><span class="off">12</span><span class="on" data-label="lo">16</span><span class="hit" data-label="mid">23</span><span class="on" data-label="hi">38</span>
    </div>
    <figcaption>新的中点正好是 23，找到了。</figcaption>
  </figure>
</div>
```

每个 `<figure>` 是一帧，读者用“上一步 / 下一步”翻看；`<figcaption>` 是这一帧的讲解。帧里可以放任何内容：格子、SVG、表格、代码、公式。打印时所有帧按顺序排开。

### 5.14 选项卡

```html
<div class="tabs">
  <div data-tab="Python">
    <pre data-lang="python"><code>print(max([3, 7, 2]))</code></pre>
  </div>
  <div data-tab="JavaScript">
    <pre data-lang="javascript"><code>console.log(Math.max(3, 7, 2));</code></pre>
  </div>
</div>
```

同一内容的几种等价呈现（多种语言、多种解法）。读者选过一次，全课同名的选项卡都会跟着切换。

### 5.15 任务清单与引文

```html
<ul class="tasks">
  <li>不看讲义，自己写出二分查找</li>
  <li>用长度为 0、1、2 的数组测试它</li>
</ul>

<blockquote>
  <p>程序必须首先让人读懂，其次才是让机器执行。</p>
  <cite>《计算机程序的构造和解释》</cite>
</blockquote>
```

任务可以勾选，状态自动保存；同一讲里不要出现两条文字完全相同的任务。

## 6. 规则

1. **编号与 id**：`<main>` 直属的 `<section>` 必须有 `id`（`recap` 除外）。`id` 用小写字母、数字、连字符，以字母开头，在同一页内唯一，不能以 `zx-` 开头。需要被引用的图、表、例题、公式也加上 `id`。
2. **转义**：正文里的 `<` 写成 `&lt;`，`&` 写成 `&amp;`，链接地址里的 `&` 也一样。字符实体只用常见的几个（`&lt;` `&gt;` `&amp;` `&quot;` `&nbsp;` 等）。
3. **标签闭合**：除 `<br>`、`<img>`、`<hr>`、`<meta>`、`<link>` 这类空元素外，每个标签都要显式闭合。`<p>` 里不能放块级元素。
4. **不允许**：`<script>`、`<style>`、`style="…"`、`onclick` 等事件属性、`<iframe>`、外链的图片、音视频与字体、正文里的第二个 `<h1>`、本契约之外的类名。
5. **不要写 Markdown**：`**加粗**`、反引号、`$公式$` 在 HTML 里不会生效，`build` 会给出警告。
6. **资源**：图片放在 `images/` 并写 `alt`。本地链接必须指向真实存在的文件与锚点，`build` 会逐个核对。
7. **字体**：正文字体内置了《通用规范汉字表》的 8105 个汉字与常见符号。超出范围的字符会回退到系统字体，`build` 会列出它们。

## 7. 怎样写好一讲

- **先直觉，后定义。** 每个概念先给一个例子、类比或问题，再给出定义和术语。
- **一节只回答一个问题。** 小节标题写成读者会问的问题，或者这一节的结论。
- **每三到五段配一样别的东西**：图、例题、演示或小测。不要连着五段都是纯文字。
- **能用组件就不手绘。** 一排格子用 `cells`，流程用 `flow`，步骤用 `steps`，树用 `tree`；手绘 SVG 留给真正需要的示意图。
- **学习目标和小结一一对应。** `goals` 说“学完能做到什么”，`recap` 逐条回应。
- **小测考理解，不考记忆。** 每讲两到四道，至少一道自评题；每道选择题都写 `.explain`。
- **代码要能运行。** 长代码拆成几段，每段后面跟讲解，或者用逐行讲解。
- **旁注里放可以不读的内容**；必须读的写进正文。
- 一讲的阅读时长在 10 到 15 分钟为宜；更长就拆成两讲。时长和正文字数看 `outline`，不必自己数。

## 8. 引擎自动完成的事

不要手写这些内容：页眉与侧栏、讲次与小节编号、图表编号、本讲目录、上一讲/下一讲、阅读时长、阅读进度与“读完盖章”、全文搜索、术语表、错题回顾、学习笔记、明暗与纸张主题、字号设置、打印样式（含参考答案页）、学习记录的备份与恢复。

## 9. 完成标准

- `build`（全课）报告 0 个 error，warning 尽量清零。
- `look`（全课）没有发现问题。机器上找不到 Chrome 或 Edge 时，退回为 `build` 0 个 error，并在交付说明里写明没有做渲染检查。
- 每一讲都有：`<title>`、摘要、一个 `<h1>`、带 `id` 的小节。
