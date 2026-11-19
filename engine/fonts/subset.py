"""取内置字体的子集，写到 template/fonts/。

    python engine/fonts/subset.py <放着三款源字体的目录>

三款源字体的出处、版本和校验和见同目录的 README.md；校验和对不上就不做，免得悄悄换了版本。
要取哪些字：
  正文（serif）、楷体（wenkai）：《通用规范汉字表》的 8105 字（hanzi-8105.txt），
    加上以前就有、字表之外的 125 个字（hanzi-kept.txt，多是部首），再加各自的符号（symbols-*.txt）；
  等宽（jbm）：symbols-jbm.txt 里的字符，加上希腊字母和方块元素；不带编程连字。
正文字体只保留 400 到 700 的字重范围。
"""
import hashlib
import io
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = Path(__file__).parent
OUT = HERE.parent.parent / "template" / "fonts"

SOURCES = {
    "serif": ("NotoSerifSC-wght.ttf", "050080d9255a86808f2945bffac582b31ef32bc36411ce29563b4961670c66f9"),
    "wenkai": ("LXGWWenKaiScreen.ttf", "abd13364163e3cd84372b333f2fdcee9efb848634668f1c0ce5788dcd059ee61"),
    "jbm": ("JetBrainsMono-wght.ttf", "3cfafa86e28b87184d592fef82846e8c10cb48653c62efcda34f082da225ec34"),
}
# 等宽字体只留这两项字形特性（组合附加符号、本地化字形）。源字体里别的特性都不要，
# 尤其是把 <= 画成 ≤、把 == 连成一条长线的编程连字：教学代码要一个字符一个字符地认得出来。
KEPT_FEATURES = {"jbm": ["ccmp", "locl"]}
# 容器用 WOFF（zlib），不用压得更小的 WOFF2：课程是从本地磁盘打开的，字体不走网络，省下的字节换不来时间；
# 解码却是每翻一页都要做一遍，WOFF2 解一遍要多花一倍的时间。实测见 README.md。
FLAVOR = "woff"
GREEK = range(0x0370, 0x0400)
BLOCK_ELEMENTS = range(0x2580, 0x25A0)


def read(name):
    return (HERE / name).read_text(encoding="utf-8")


def from_ranges(text):
    """'20-22,30' -> {0x20, 0x21, 0x22, 0x30}"""
    found = set()
    for part in text.strip().split(","):
        first, _, last = part.partition("-")
        found.update(range(int(first, 16), int(last or first, 16) + 1))
    return found


def to_ranges(codepoints):
    """{0x20, 0x21, 0x22, 0x30} -> '20-22,30'"""
    runs = []
    for cp in sorted(codepoints):
        if runs and cp == runs[-1][1] + 1:
            runs[-1][1] = cp
        else:
            runs.append([cp, cp])
    return ",".join("%X" % a if a == b else "%X-%X" % (a, b) for a, b in runs)


def hanzi():
    return {ord(char) for char in read("hanzi-8105.txt") + read("hanzi-kept.txt") if not char.isspace()}


WANTED = {
    "serif": lambda: hanzi() | from_ranges(read("symbols-serif.txt")),
    "wenkai": lambda: hanzi() | from_ranges(read("symbols-wenkai.txt")),
    "jbm": lambda: from_ranges(read("symbols-jbm.txt")) | set(GREEK) | set(BLOCK_ELEMENTS),
}


def load(source_dir, name):
    file, expected = SOURCES[name]
    path = source_dir / file
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected:
        sys.exit("%s 的校验和对不上：要的是 README.md 里写的那个版本" % file)
    font = TTFont(str(path), recalcTimestamp=False)
    if name == "serif":
        # 正文只用 400（常规）到 700（加粗）之间的字重，别的不带
        instancer.instantiateVariableFont(font, {"wght": (400, 700)}, inplace=True)
        # 存一遍再读回来：改过字重范围的字体要重新编码之后，取子集的工具才认
        buffer = io.BytesIO()
        font.save(buffer)
        buffer.seek(0)
        font = TTFont(buffer, recalcTimestamp=False)
    return font


def make(source_dir, name):
    font = load(source_dir, name)
    covered = set(font.getBestCmap())
    wanted = WANTED[name]() & covered
    options = subset.Options()
    options.flavor = FLAVOR
    options.hinting = False
    options.desubroutinize = True
    options.notdef_outline = True
    options.name_IDs = ["*"]
    options.drop_tables += ["DSIG"]
    if name in KEPT_FEATURES:
        options.layout_features = KEPT_FEATURES[name]
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=wanted)
    subsetter.subset(font)
    target = OUT / (name + "." + FLAVOR)
    font.flavor = FLAVOR
    font.save(str(target))
    final = set(TTFont(str(target)).getBestCmap())
    print("%-7s %5d 个字符  %.2f MB" % (name, len(final), target.stat().st_size / 1048576))
    return final


def main():
    source_dir = Path(sys.argv[1])
    covered = {name: make(source_dir, name) for name in SOURCES}
    missing = hanzi() - covered["serif"]
    if missing:
        sys.exit("正文字体缺这些字：" + "".join(chr(cp) for cp in sorted(missing)))
    # 检查器用它提示“这个字内置字体里没有”
    (OUT / "serif.ranges.txt").write_text(to_ranges(covered["serif"]) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
