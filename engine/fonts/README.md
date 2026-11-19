# 内置字体：出处、版本与取子集的办法

`template/fonts/` 里的三个 woff 都是从下面的源字体里取出来的子集。源字体很大（每个二十多兆），不放进仓库；需要重做时按这里写的地址下载。

| 用途 | 文件 | 源字体 | 版本 | 许可 |
|---|---|---|---|---|
| 正文 | `serif.woff` | Noto Serif SC（可变字重） | 2.003-H1 | SIL OFL 1.1 |
| 楷体 | `wenkai.woff` | 霞鹜文楷 屏幕阅读版（LXGW WenKai Screen） | 1.530 | SIL OFL 1.1 |
| 等宽 | `jbm.woff` | JetBrains Mono（可变字重） | 2.305 | SIL OFL 1.1 |

许可全文在 `template/fonts/OFL-*.txt`。

## 源字体从哪里来

| 放在源字体目录里的文件名 | 下载地址 | SHA-256 |
|---|---|---|
| `NotoSerifSC-wght.ttf` | <https://github.com/google/fonts/raw/main/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf> | `050080d9255a86808f2945bffac582b31ef32bc36411ce29563b4961670c66f9` |
| `LXGWWenKaiScreen.ttf` | <https://github.com/lxgw/LxgwWenKai-Screen/releases/download/v1.530/LXGWWenKaiScreen.ttf> | `abd13364163e3cd84372b333f2fdcee9efb848634668f1c0ce5788dcd059ee61` |
| `JetBrainsMono-wght.ttf` | <https://github.com/JetBrains/JetBrainsMono/raw/02bb50b082dad9ef8a0f33ac393839202b760223/fonts/variable/JetBrainsMono%5Bwght%5D.ttf> | `3cfafa86e28b87184d592fef82846e8c10cb48653c62efcda34f082da225ec34` |

`subset.py` 会先核对校验和，对不上就停下：上游的文件换了版本，要先在这里更新版本号和校验和，再重做。Noto Serif SC 的那个地址指向上游仓库的主干，文件会随上游更新；校验和对不上时，到上游的提交历史里找 2.003-H1 那一版。

## 取哪些字

- **汉字**（正文和楷体）：《通用规范汉字表》（国务院 2013 年公布）的全部 8105 字，在 `hanzi-8105.txt` 里，按字表顺序排列：一级 3500 字、二级 3000 字、三级 1605 字，其中 196 个在基本多文种平面之外。另外保留 `hanzi-kept.txt` 里的 125 个字：它们在字表之外，但上一版（按 GB2312 取的 6763 字）里有，多是讲汉字结构时会用到的部首，去掉就是退步。合计 8230 个汉字。
- **符号**：`symbols-serif.txt`、`symbols-wenkai.txt`、`symbols-jbm.txt` 是各款字体里汉字以外的字符，写成十六进制码位的区间。
- **等宽字体**另外加上希腊字母（U+0370–03FF）和方块元素（U+2580–259F）里源字体有的那些。字形特性只留 `ccmp` 和 `locl` 两项：源字体会把 `<=` 画成 ≤、把 `==` 连成一条长线（编程连字，在 `calt` 特性里），教学代码要逐个字符认得出来，所以不带。
- 正文字体只保留 400 到 700 的字重范围。

`hanzi-8105.txt` 的 8105 个字按顺序与 [jaywcjlove 的 MIT 授权转录](https://github.com/jaywcjlove/table-of-general-standard-chinese-characters/blob/main/data/characters.txt) 一致。[字表许可](LICENSE-hanzi-8105.txt)

KaTeX 随包数学字体的版权、保留字族名和 SIL OFL 1.1 文本见 [`OFL-KaTeX.txt`](../../template/fonts/OFL-KaTeX.txt)。更新 KaTeX 时，以新字体内的许可元数据核对这份文件。

## 重做

需要 Python 3 和 fontTools（`pip install fonttools`）。

```bash
python engine/fonts/subset.py <放着三款源字体的目录>
```

它写出 `template/fonts/` 下的三个 woff，并更新 `serif.ranges.txt`（检查器用它提示“这个字内置字体里没有”）。做完之后跑一遍测试：`engine/tests/fonts.test.js` 核对字表和覆盖范围，端到端验收里有一条核对这些字确实是内置字体画出来的。

## 现在的大小

| 文件 | 字符数 | 大小 |
|---|---|---|
| `serif.woff` | 9904 | 4.04 MB |
| `wenkai.woff` | 9159 | 2.82 MB |
| `jbm.woff` | 623 | 0.04 MB |

## 为什么是 WOFF，不是更小的 WOFF2

课程是从本地磁盘打开的，字体不经过网络，文件小一些换不来时间；解码却是每翻一页都要做一遍。同一份子集做成四种容器，在这台机器上量过（2026-11，各 7 轮取中位数；翻页是“从第 1 讲按 `]` 到第 2 讲的正文出现”，各 9 轮）：

| 容器 | 三个文件合计 | 正文加楷体解码一遍：Chromium / Firefox / WebKit | 翻页：Chromium / Firefox / WebKit |
|---|---|---|---|
| WOFF2 | 5.29 MB | 207 / 224 / 195 毫秒 | 521 / 251 / 308 毫秒 |
| WOFF2（不做字形变换） | 5.79 MB | — | 470 / 280 / 332 毫秒 |
| **WOFF** | **6.91 MB** | **100 / 139 / 82 毫秒** | **415 / 228 / 302 毫秒** |
| 不压缩（TTF） | 11.03 MB | 81 / 77 / 44 毫秒 | 400 / 227 / 325 毫秒 |

Chromium 的跟踪记录里，两个字体的解码排在主线程上、运行时之前，解码多久，正文就晚出现多久；另两个内核换了容器，翻页的时间变化不大。WOFF 比 WOFF2 多 1.6 MB，Chromium 上每翻一页少等一百毫秒左右；再换成不压缩的，只多快十几毫秒，文件却要再大四兆，不值。量法在审查工作区的 `font-lab/`（`make-sets.py`、`decode-time.js`）和 `tools/reveal-time.js`。

KaTeX 的公式字体仍然是它自带的 woff2：二十个文件一共 0.25 MB，最大的 28 KB，不在这笔账里。
