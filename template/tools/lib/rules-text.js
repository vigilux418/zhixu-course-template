'use strict';
/* 正文文字：误写的 Markdown，以及内置字体没有覆盖的字符。 */
const fs = require('fs');
const path = require('path');
const { TEMPLATE_DIR } = require('./files');
const { sourceOffset } = require('./html');
const { hasClass, isText } = require('./dom');

const MARKDOWN = [
  [/\*\*[^\s*][^*]*\*\*/, '**…** 是 Markdown 写法，在 HTML 里不会加粗；请用 <strong>'],
  [/`[^`\n]+`/, '反引号是 Markdown 写法，在 HTML 里不会生效；行内代码请用 <code>'],
  [/\$[^$\n]*[\\^_][^$\n]*\$/, '$…$ 不会被排版成公式；请用 <span class="math">']
];
const NOT_PROSE = new Set(['pre', 'code', 'script', 'style']);
const MAX_LISTED = 20;

const REPO_COVERAGE_PATH = path.join(TEMPLATE_DIR, 'fonts', 'serif.ranges.txt');
const REPO_COVERAGE_BYTES = fs.readFileSync(REPO_COVERAGE_PATH);

function parseCoverage(text) {
  const covered = new Set();
  for (const range of text
    .replace(/^\uFEFF/, '')
    .trim()
    .split(',')) {
    const [first, last = first] = range.split('-').map((hex) => parseInt(hex, 16));
    for (let codePoint = first; codePoint <= last; codePoint += 1) covered.add(codePoint);
  }
  return covered;
}

const COVERED = parseCoverage(REPO_COVERAGE_BYTES.toString('utf8'));

/** 内置正文字体覆盖的码位，来自 fonts/serif.ranges.txt（形如 "20-7E,A0-17F"）。 */
function loadCoverage(templateDir = TEMPLATE_DIR) {
  const bytes = fs.readFileSync(path.join(templateDir, 'fonts', 'serif.ranges.txt'));
  if (bytes.equals(REPO_COVERAGE_BYTES)) return COVERED;
  return parseCoverage(bytes.toString('utf8'));
}

/** 不必由正文字体显示的字符：空白与控制符、变体选择符、零宽连接符、表情符号。 */
function isExempt(char) {
  const codePoint = char.codePointAt(0);
  return (
    /[\s\p{Cc}]/u.test(char) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    codePoint === 0x200d ||
    (codePoint >= 0x1f000 && codePoint <= 0x1faff)
  );
}

/** 正文里的文字节点：跳过代码、公式和脚本。 */
function* proseTexts(node) {
  for (const child of node.children) {
    if (isText(child)) {
      yield child;
    } else if (child.children && !NOT_PROSE.has(child.name) && !hasClass(child, 'math')) {
      yield* proseTexts(child);
    }
  }
}

/** 文字节点里字体没有覆盖的字符，以及各自在节点文字中的下标。 */
function* uncovered(text, covered = COVERED) {
  let index = 0;
  for (const char of text.value) {
    if (!covered.has(char.codePointAt(0)) && !isExempt(char)) yield { char, index };
    index += char.length;
  }
}

function checkText(lesson, report, site) {
  const templateDir = site?.templateDir;
  const covered =
    !templateDir || path.resolve(templateDir) === TEMPLATE_DIR ? COVERED : (site.covered ??= loadCoverage(templateDir));
  const locate = (text, index) => lesson.doc.locate(sourceOffset(text, index));
  const missing = new Set();
  let firstMissing;
  for (const text of proseTexts(lesson.doc.root)) {
    for (const [pattern, message] of MARKDOWN) {
      const found = pattern.exec(text.value);
      if (found) report.warn(locate(text, found.index), 'text/markdown', message);
    }
    for (const { char, index } of uncovered(text, covered)) {
      firstMissing = firstMissing || locate(text, index);
      missing.add(char);
    }
  }
  if (missing.size > 0) {
    const listed = [...missing].slice(0, MAX_LISTED).join(' ');
    const total = missing.size > MAX_LISTED ? `（共 ${missing.size} 个，只列出前 ${MAX_LISTED} 个）` : '';
    report.warn(firstMissing, 'font/coverage', `内置正文字体没有这些字符，显示时会回退到系统字体：${listed}${total}`);
  }
}

module.exports = { checkText };
