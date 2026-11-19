# 知序 · 课程教程模板

一套给 Agent 写课用的离线课程模板。Agent 只写语义化的 HTML 正文；导航、编号、目录、搜索、代码高亮、公式排版、小测、打印都由引擎自动完成。读者双击 `index.html` 就能阅读，不需要服务器，也不需要联网。

这个文件夹本身就是一门示例课程《算法与问题求解》，同时也是模板的母版。

## 给写课的 Agent

**只读一份文档：[`template/AGENTS.md`](template/AGENTS.md)。** 它是完整的写作契约：文件夹约定、一讲的骨架、全部组件的最小写法、规则与完成标准。

日常用这几条命令，都在课程根目录运行：

```bash
node template/tools/zx.js outline   # 看大纲：各讲的字数与时长、小节、可以引用的编号、已有术语
node template/tools/zx.js new 05-sorting "排序"   # 新建一讲并登记到清单
node template/tools/zx.js build     # 检查全部页面，生成首页与目录数据
node template/tools/zx.js look      # 用本机的 Chrome 或 Edge 排出来，报告看得见的版面问题
node template/tools/zx.js preview   # 本地预览
node template/tools/zx.js pack      # 把整门课导出成一个 HTML，发到手机上用浏览器就能看
```

新开一门课：

```bash
node template/tools/zx.js init ../my-course "课程名"
```

得到的新文件夹里只有引擎、一份课程清单和第一讲的骨架，不带示例内容，也不带引擎源码。

## 文件夹

| 路径                | 内容                                                   | 谁来改               |
| ------------------- | ------------------------------------------------------ | -------------------- |
| `index.html`        | 首页                                                   | 工具生成             |
| `01-….html` 等      | 每讲一个文件                                           | 写课的 Agent         |
| `course/course.js`  | 课程清单：课程名、单元、讲次顺序                       | 写课的 Agent         |
| `course/data.js`    | 目录与搜索数据                                         | 工具生成             |
| `images/`、`media/` | 图片、音频和视频（可选）                               | 写课的 Agent         |
| `export/`           | `pack` 导出的单文件（不进版本库）                      | 工具生成             |
| `template/`         | 引擎：样式、运行时、字体、公式与高亮库、工具、写作契约 | 只读；升级时整个替换 |
| `engine/`           | 引擎源码、构建脚本与测试（只在母版里有）               | 维护模板的人         |

## 读者能做什么

- 目录、书眉、上一讲 / 下一讲、本讲小节导航。宽屏时旁注排在右侧页边，鼠标移到小节标题上可右键复制标题旁的链接地址
- 全文搜索（`/` 或 `Ctrl K`）、术语表、点击术语看定义
- 小测（单选、多选、填空、自评），先提示后揭晓；首页有错题回顾，封面上有入口
- 步进演示、选项卡、任务清单、可放大的图、带连线的树、本地的音频和视频
- 读完一讲盖一枚章；首页的阶梯是课程地图，每讲一级，点一级进那一讲，读完的台阶变成朱砂色
- 浅色、纸张、深色三种主题，宋体 / 黑体，字号 15–21
- 每讲的学习笔记，可导出 Markdown
- 打印本讲：自动展开折叠内容，附参考答案页；用 Chrome 或 Edge 打印时，页眉有课程名和讲次，页脚有页码
- 学习记录只存在读者自己的浏览器里，可以导出备份、从备份恢复

单文件在原文件地址内换讲，浏览器前进或后退会恢复离开时的阅读位置。分享某一节时，复制标题旁链接本身的地址，接收方需能访问链接指向的文件。

## 维护模板

引擎源码在 `engine/src/`，改完后重新构建并跑测试，细节见 [`engine/README.md`](engine/README.md)。

```bash
node engine/build.js            # 重新生成 template/ 里的运行文件
cd engine && npm test           # 单元测试
cd engine && npm run test:fast  # 日常快测：单元测试 + 精选 Chromium 双形态核心用例
node engine/tests/e2e/run.js    # 端到端验收：Chromium、Firefox、WebKit 各跑一遍
```

## 范围、版本承诺、浏览器与体积

**范围与 LTS 维护承诺（`v6.0.2-lts`）。** 本版延续第六代新课程的 LTS 基线，版本号写在 `template/VERSION` 与 `engine/package.json`（`6.0.2`），对应 Git 标签 `v6.0.2-lts`。

- **同代冻结契约**：写作契约（`template/AGENTS.md`）、课程 `id`、讲义文件名规则、小测与任务题键哈希算法（FNV-1a）、本地学习记录结构与备份格式（`format: 1`）、以及 `zx` 命令行入口与退出码在 `6.x` 周期内保持向后兼容，已有第六代课程可直接通过整包替换 `template/` 完成平滑升级。v5 课程和学习记录请继续使用其对应的历史版本。
- **作者与维护环境**：本版以 **Node 26 LTS（`26.x`，实测 Windows 11 + Node 26.13.0）** 为首个 LTS 的官方写课工具与维护基线；写课无需安装任何第三方依赖。
- **支持与补丁范围**：由 [vigilux418](https://github.com/vigilux418) 在 `v6.x` 周期内（与 Node 26 LTS 支持周期对齐，或以项目后续发布说明为准）负责维护，问题通过仓库提交与记录跟踪；补丁优先处理安全漏洞、学习记录损坏或丢失、课程生成/打开失败及已支持环境中的功能回归。当前内嵌第三方库版本为 KaTeX `0.19.1` 与 highlight.js `11.12.0`（维护依赖 Playwright `1.60.0`），若上游出现安全公告，将在同代发布补丁并说明重新导出离线单文件的步骤。

**浏览器与验证边界。** 桌面基线为 Chromium 和 Edge 120 以上、Firefox 140 以上、Safari 17.4 以上。验收在 Windows 11 的 Playwright Chromium、Firefox、WebKit 三个内核里完成（含双交付形态与移动视口）；基线最旧内核（Chromium 120.0.6099、Firefox 140.0.2、WebKit 17.4）已实际走过一遍：文件夹和导出的单文件两种形态，手机和宽屏两种尺寸，启动、代码着色、公式、内置字体、版面体检、翻页、搜索落到命中处、笔记重开还在、旁注、小测、换主题、目录都正常，控制台没有报错。更旧的内核不检测、不降级。四处是渐进增强，不支持的内核里自动没有：翻页时新旧两页的交叉淡入（Firefox 没有；导出的单文件在页面里换页，也没有）、浮层关闭时的淡出（只有 Chromium 有）、打印稿的页眉和页码（只有 Chromium 有）、浮层背后那层变暗的遮罩（Chromium 和 Edge 120 上实测没有；按 Chromium 的发布说明，从 122 起才有）。**未纳入本版实测的范围**：真机 iOS / Safari、macOS / Linux 命令行环境；Android 手机经文件管理器通过 `content://` 打开单文件的行为沿用历史修复设计，待使用本版最终单文件在原设备上补验换讲、前后退与刷新后再列入正式真机支持清单。

**体积（按 1 KiB = 1,024 字节、1 MiB = 1,048,576 字节计量）。**

| 口径                     | 大小     | 说明                                                                                  |
| ------------------------ | -------- | ------------------------------------------------------------------------------------- |
| 引擎自己的样式和脚本     | 0.19 MiB | `zhixu.css` 85 KiB、`app.js` 99 KiB、`zhixu.js` 14 KiB，都没有压缩                    |
| 一门可以直接复制走的课程 | 9.0 MiB  | 示例课的四讲加 `template/`：字体 6.9 MiB、KaTeX 与 highlight.js 1.5 MiB、工具 0.2 MiB |
| 完整母版                 | 9.8 MiB  | 再加上 `engine/`（源码、测试、测试课），不含 `node_modules`、`export/`、`.out/`       |
| 导出的单文件             | 10.4 MiB | 示例课含许可声明；其中主样式与公式内嵌字体 Base64 合计 9.54 MiB（约 92%）             |

打开一讲实际载入的文件：有代码也有公式的第 2 讲是 14 个文件、7.6 MiB，其中正文和楷体两个字体 7.0 MiB；首页是 9 个文件、7.1 MiB。字体用的是 WOFF 而不是更小的 WOFF2：文件都在本地磁盘上，省下的字节换不来时间，解码却是每翻一页都要做一遍（实测见 `engine/fonts/README.md`）。

## 许可与署名

知序由 [vigilux418](https://github.com/vigilux418) 创建。仓库中的原创引擎、文档和示例课程采用 [MIT 许可证](LICENSE)。新建课程随模板获得一份引擎许可。用知序编写的课程内容由其作者确定授权方式。

- Noto Serif SC、LXGW WenKai Screen、JetBrains Mono 的浏览器字体子集与 KaTeX 数学字体采用 SIL OFL 1.1，许可在 [`template/fonts/`](template/fonts/)。
- KaTeX 代码采用 MIT，highlight.js 采用 BSD-3-Clause。[代码许可](template/vendor/)
- 提示卡图标来自 Material Design Icons，采用 Apache-2.0。[来源与许可](template/LICENSE-MDI.txt)
- 维护用《通用规范汉字表》转录来自 MIT 授权版本。[字表许可](engine/fonts/LICENSE-hanzi-8105.txt)

`zx pack` 生成的单文件通过 HTML 文件末尾的 `zx-licenses` 注释携带引擎及实际内置组件的许可。
