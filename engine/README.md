# 知序引擎 · 维护说明

给维护模板的人（或 Agent）。写课不需要读这份文档，写课只读 `template/AGENTS.md`。

## 一分钟了解结构

```text
engine/
├─ build.js                   把 src/ 合成 template/ 里的三个运行文件
├─ vendor.js                  更新 template/vendor/ 里的 KaTeX 与 highlight.js
├─ src/
│  ├─ loader.js               → template/zhixu.js   每页 <head> 里唯一的脚本
│  ├─ css/*.css               → template/zhixu.css  按固定顺序拼接
│  └─ js/*.js                 → template/app.js     ES 模块，按依赖顺序拼成一个普通脚本
└─ tests/                     样式纪律、构建同步、示例代码、工具链、端到端验收

template/
├─ AGENTS.md                  写作契约（唯一的作者文档）
├─ VERSION                    当前模板版本号（与 engine/package.json 同步）
├─ LICENSE                    随模板分发的引擎 MIT 许可
├─ LICENSE-MDI.txt            提示卡图标（Material Design Icons）Apache-2.0 许可
├─ zhixu.css zhixu.js app.js  构建产物，不要手改
├─ lesson.html                新建一讲用的骨架
├─ fonts/ vendor/             字体与第三方库
└─ tools/                     zx.js 命令行：新建、检查与生成、大纲、渲染体检、预览、单文件导出
```

页面的加载顺序：`zhixu.js`（同步，先定主题）→ `course/course.js` → `course/data.js` → `app.js` → 按需加载 `vendor/`。运行文件都是普通脚本而不是 `type="module"`，因为双击打开的 `file://` 页面不能加载模块。

## 改完之后

```bash
node engine/build.js         # 重新生成 template/ 里的运行文件
cd engine && npm run format:check   # 格式化检查（使用 .prettierrc.json 与 .prettierignore，跳过 .out 与手写测试课）
node --test engine/tests/           # 单元测试：样式纪律、构建同步、示例代码、工具链、运行时的纯逻辑
cd engine && npm run test:fast      # 日常快测：全部单元测试 + 精选 Chromium 双形态（路由/启动/搜索/记录）
node engine/tests/fast.js --scope=routing --form=packed  # 按分区（routing,boot,search,records）和形态缩小快测
node engine/tests/e2e/run.js chromium      # 单内核完整回归（folder 形态）
node engine/tests/e2e/run.js chromium B17  # 只跑名字里带 B17 的用例
ZX_FORM=packed node engine/tests/e2e/run.js chromium   # 单内核完整回归，改跑 zx pack 导出的单文件
node engine/tests/e2e/run.js --forms=folder,packed     # 六组完整矩阵：folder + packed × 三个内核（支持 --jobs=N 与 --prestage）
node engine/tests/e2e/run.js --forms=folder,packed --jobs=5 --prestage --order=lpt --webkit-idle-tab --report=run-output.json  # Windows 本机已验证的 5 并发全量命令（无历史权重时可直接执行）
node engine/tests/e2e/run.js --forms=folder,packed --jobs=5 --prestage --order=lpt --webkit-idle-tab --weights=prev-report.json --report=run-output.json  # 复用上一次 --report 生成的 JSON 作为固定权重（输入权重与本次报告路径分开保存）
```

在 Windows 上，端到端回归默认开启 WebKit 空白锚页（`ZX_WEBKIT_IDLE_TAB=1` / `--webkit-idle-tab`），用于规避 Windows WebKit 页面清零后的建页停顿；全量回归推荐搭配 `--jobs=5 --prestage --order=lpt`（内存紧张时改用 `--jobs=4`）。`--weights` 用历史报告里的各作业耗时作为新一轮权重，未传时按内置默认顺序排班；需要复现同一排班时，应始终使用相同的权重文件和测试集合，且输入权重与本次 `--report` 分开保存。若要在全新浏览器进程的首个页面验证课程启动，请显式传入 `--no-webkit-idle-tab`（或 `ZX_WEBKIT_IDLE_TAB=0`）关闭锚页。备课默认在进程内复用 `template/tools/lib/`（按各夹具自己的 `template/` 校验并解析资源，`tools.e2e.js` 与 `zx init` 仍走命令行），需要对照原命令行备课路径时可设 `ZX_STAGE_MODE=cli`；`makeCourse()` 默认共享本次运行的临时模板副本（遇受限环境自动回退实体复制），可设 `ZX_TEMPLATE_SHARE=0` 关闭。

端到端验收用 `node:test` 写，文件在 `engine/tests/e2e/*.e2e.js`，页面一律用 `file://` 打开。测试课在 `engine/tests/courses/`：手写的 `calculus`、`edge`（压测），以及由脚本生成的组件矩阵（`make-matrix.js`）和 26 讲长课（`make-long.js`）。版面问题由 `template/tools/lib/checkup.js` 里的体检函数找出来，`zx look` 用的是同一个函数。

课程有文件夹和单文件两种形态。同一套端到端验收分别运行。设 `ZX_FORM=packed` 时，`stage.js` 会备好单文件并通过 `#讲义文件名/锚点` 打开目标。测试用 `ZHIXU.file`、`ZHIXU.anchor()` 或 `arrived()` 判断落到哪一讲、哪一节。缺文件、过期目录数据、文件夹刷新滚动位置和工具验收各有适用条件，跳过原因会写进测试日志。

单文件用内嵌数据换页，把讲次和锚点存进 `history.state`，地址栏保留原文件地址。实测原安卓设备经文件管理器打开时，带讲次片段重新载入会报 `ERR_FILE_NOT_FOUND`，无片段的原文件地址可正常刷新。前进后退按历史条目恢复离开时的滚动位置。位置存在当前标签页的会话存储中，存储受限时保留在当前文档内。刷新当前条目按讲次与锚点定位。

`packed.e2e.js` 核对正常换页时文档只读取一次，前进和后退的实际视口回到对应位置，刷新使用无片段地址，以及换页后的版面、监听器和浮层与直接打开一致。

### 维护测试需要的环境

写课工具只需要 Node 26 LTS。以下是完整的维护环境。

- Node 26 LTS（`26.x`，本版已在 Windows 11 + Node 26.13.0 上完成完整验证）。
- 在 `engine/` 下运行 `npm ci`，装上锁定版本的 Playwright、Prettier 和 axe-core；再运行 `npx playwright install chromium firefox webkit` 装三个浏览器内核。
- Python 3 和 fontTools（`pip install fonttools`）：重新取字体子集时用；`samples.test.js` 检查示例课里的 Python 代码也要用到 Python。
- PyMuPDF（`pip install pymupdf`）：打印验收用它读 PDF 里的文字。

## 运行时（`src/js`）

| 模块                                                 | 职责                                                                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `dom`                                                | 查询、创建元素、图标、下载                                                                                                          |
| `course`                                             | 把课程清单和目录数据合成只读模型；判断当前页面                                                                                      |
| `store`                                              | 学习记录与阅读设置的读写                                                                                                            |
| `plain` `grading` `matching` `stairs` `record-shape` | 不碰页面的纯逻辑：字典与哈希、判分、搜索的匹配与摘录、阶梯的几何、学习记录的形状。可以直接在 Node 里测试（`tests/runtime.test.js`） |
| `dialogs`                                            | 原生 `<dialog>` 浮层，同一时刻只开一个                                                                                              |
| `shell`                                              | 页眉、目录栏与抽屉、进度线、当前小节                                                                                                |
| `lesson`                                             | 一讲的页面：讲头、讲末盖章、上下讲、阅读位置                                                                                        |
| `numbering`                                          | 小节与图表编号，填充留空的引用链接                                                                                                  |
| `code` `math` `margin` `quiz` `widgets` `figures`    | 正文组件                                                                                                                            |
| `home`                                               | 首页：封面、阶梯、目录、错题回顾、术语表                                                                                            |
| `search` `find` `settings` `notebook` `seal` `keep`  | 搜索的浮层、落到命中处、设置与备份、笔记、印章、断行的修正                                                                          |
| `main`                                               | 入口：启动、快捷键、打印前后的处理                                                                                                  |

约定：

- 作者写的类名不带前缀；脚本补上的元素、类名、`id` 一律以 `zx-` 开头。
- 脚本建的元素各有类名，样式按类名选它们，不按“第几个子元素”去数（`zx-kicker-n`、`zx-finish-title` 这样）；语义本来就在标签上的（`h2`、`dt`、`kbd`、`input`）直接按标签选。
- 运行时信任写作契约。契约由 `tools/zx.js` 在生成阶段把关，运行时不为“作者写错了”再做一遍判断；启动失败时由加载器在页面顶部显示原因，正文照常可读。
- 需要读写存储的地方只有 `loader.js` 里的 `read` / `write`，那里处理浏览器禁用存储的情况。
- 模块只用 `import { a, b } from './x.js'` 和具名 `export`；构建脚本会检查顶层名字不重复。
- 一讲的页面分五段改完（`lesson.js`）：读取 → 编号 → 组件 → 第三方库 → 标题与记录，然后交回一个“就位”的函数；`main.js` 先放行页面，再调用它。放行之前页面是 `display: none`，不排版也量不出尺寸，所以前五段只改页面、不量尺寸；要量的事（目录栏滚到当前这一讲、读到哪一节、选项卡的指示条、落到锚点）全在“就位”里，浏览器排一次版就够（`boot.e2e.js` 里有一条守着）。
- 工具和运行时各实现了一遍的规则（小节、自动编号、小测的键、代码的行号），由 `agree.e2e.js` 逐页比对两边的结果。契约里是数据的部分（提示卡的类型和标题、SVG 的颜色名）在 `template/tools/lib/contract.js`，样式表和写作契约里的那两份由 `contract.test.js` 核对。

## 样式（`src/css`）

拼接顺序：`tokens` → `base` → `layout` → `components` → `home` → `overlays` → `print`。

`engine/tests/css.test.js` 强制执行这些纪律，违反即测试失败：

1. 同一个选择器的同一个属性只写一次，并且只在一个文件里（响应式断点内的改写除外）。
2. 颜色只出现在 `tokens.css`；字号和圆角只用令牌；内边距、外边距、间隔里的像素数只用间距令牌（抵消边框的 1px 除外），跟着字号走的间距用 em。
3. 换字体族的规则同时写字重：正文字体用 `--w-body`（普通屏幕上的浅底主题是 460），界面的黑体写自己的字重，不跟着继承。
4. 断点只有 700、1000、1280 三个；特性查询只有 `@supports (overlay: auto)` 一种（浮层退场的淡出）。
5. `!important` 只出现在 `print.css`。
6. 用到的变量都有定义，定义的令牌都被用到。
7. 没有死类名：`zx-` 类必须在脚本里出现，其余类必须在写作契约里出现。

表面只有两种容器：淡底色的块（代码、小结、提示、卡片、流程里的格子），和上下各一条细线界定的面板（小测、例题、演示）。内容容器里只有提示卡带整圈的边线；此外带边线的是控件（按钮、输入框、勾选框）、浮层和数组格子。圆角三档：小件 2，控件 4，容器 8。打印稿不印底色，淡底色的块在 `print.css` 里改用细线框。

版面：正文栏宽约 39 个汉字；1000 以上右侧留出页边放旁注，讲次和小节编号悬挂在左侧（左边的页边跟着字号走，挂得下 26.10 这样的编号）；1280 以上显示目录栏。主题有浅色、纸张、深色三套，全部通过 `tokens.css` 里的变量切换。

颜色的含义各只有一种：强调色是“可以点、接下来去这儿”，朱砂色是“读过的痕迹”（印章、目录里的已读记号、阶梯上读完的台阶）。

动效只由读者的操作触发：浮层进场和退场、术语和旁注的浮层淡入、选项卡的指示条滑动、换主题时颜色渐变、小测判定的反馈、盖章。没有滚动触发的入场动画，所以整页截图总是完整的。时长只有 `--dur-1`、`--dur-2`、`--dur-3` 三档；系统设了“减弱动态效果”时全部缩到 1 毫秒（`print.css` 末尾）。

- 浮层退场的淡出要靠 `overlay` 过渡，眼下只有 Chromium 有；别的内核里浮层直接消失。
- 浮层背后的遮罩只在原位淡入。它是浮层的伪元素，会把浮层的 `--away`（进场从哪儿来）继承过去，所以样式里给它写明了 `--away: 0 0`。
- 模态浮层开着时页面不滚动，滚动条连同平时给它留的位置一起收起来，遮罩才盖得满整个窗口；页面因此宽出来的那一截由 `dialogs.js` 在打开时量好，样式垫回去（`overlays.css` 末尾）。以后新加固定在窗口上的元素（`position: fixed`，贴着右边或者横跨窗口的），要加进那条规则，不然浮层一开它会横移。
- 换主题的渐变：`settings.js` 把每套主题的颜色令牌登记成“颜色”类型（`CSS.registerProperty`），读者换主题时在根元素上给这些令牌挂一段过渡，用到令牌的地方跟着变，放完就收回去。打印前临时换成浅色不经过这条路，直接换。不用同文档的视图过渡：WebKit 里过渡没放完就开关浮层，页面会崩（`motion.e2e.js` 里有一条守着）。
- 翻页用的是跨文档的视图过渡（`layout.css` 开头），那是浏览器在两页之间做的，不受上面这个问题影响。

## 更新字体与第三方库

- 第三方库：`npm pack katex`、`npm pack @highlightjs/cdn-assets`，解包后运行 `node engine/vendor.js <katex 包目录> <highlight.js 包目录>`。
- 字体：三款内置字体的出处、版本、校验和、取了哪些字、怎样重做，都在 `engine/fonts/README.md`。重做用 `python engine/fonts/subset.py <源字体目录>`，它同时更新 `serif.ranges.txt`（检查器用它提示“超出内置字体的字符”）。

## 发布到课程

课程文件夹里只需要 `template/`。升级一门已有的课：用母版的 `template/` 整个替换课程里的 `template/`，再运行一次 `node template/tools/zx.js build`。
