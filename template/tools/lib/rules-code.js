'use strict';
/* 代码：<pre><code> 与行内 <code> 只能有文字；语言、标亮行、逐行讲解、缩进。 */
const fs = require('fs');
const path = require('path');
const { TEMPLATE_DIR, loadCjsModule } = require('./files');
const { sourceOffset } = require('./html');
const { attr, getAttr, hasClass, firstNonText, childElements, previousElement } = require('./dom');
const { codeLineRange } = require('./anatomy');

const REPO_HLJS_PATH = path.join(TEMPLATE_DIR, 'vendor', 'highlight', 'highlight.min.js');
const REPO_HLJS_BYTES = fs.readFileSync(REPO_HLJS_PATH);
const hljs = require(REPO_HLJS_PATH);

/** 读取夹具自己的 highlight.min.js；内容与母版一致时复用已载入实例，改动过则即时求值，避免模块缓存滞留。 */
function loadHighlighter(templateDir) {
  const file = path.join(templateDir, 'vendor', 'highlight', 'highlight.min.js');
  const bytes = fs.readFileSync(file);
  if (bytes.equals(REPO_HLJS_BYTES)) return hljs;
  return loadCjsModule(file, bytes.toString('utf8'));
}

// 没有打进 highlight.min.js 的语言，运行时按文件名加载。
function loadExtraLanguages(templateDir) {
  return new Set(
    fs
      .readdirSync(path.join(templateDir, 'vendor', 'highlight', 'languages'))
      .filter((file) => file.endsWith('.min.js'))
      .map((file) => file.replace(/\.min\.js$/, ''))
  );
}

const EXTRA_LANGUAGES = loadExtraLanguages(TEMPLATE_DIR);

/** <code> 里只能有文字。注释也不行：浏览器不会把它显示出来。 */
function checkTextOnly(code, report) {
  const intruder = firstNonText(code);
  if (intruder) {
    report.error(intruder, 'code/markup', '<code> 里只能有文字。这里多半是前面的 <code> 漏了结束标签');
  }
}

function checkLanguage(pre, report, highlighter = hljs, extraLanguages = EXTRA_LANGUAGES) {
  const lang = getAttr(pre, 'data-lang');
  if (!lang) {
    report.warn(pre, 'code/lang', '<pre> 缺少 data-lang；不需要高亮时写 data-lang="text"');
  } else if (lang.value !== 'text' && !highlighter.getLanguage(lang.value) && !extraLanguages.has(lang.value)) {
    report.error(lang, 'code/lang', `不认识的语言 data-lang="${lang.value}"`);
  }
}

/** data-mark 的写法是否合法（如 "3,5-7"），且每个行号都落在代码块的行号范围内。 */
function isValidMark(value, range) {
  return value.split(',').every((part) => {
    const found = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!found) return false;
    const from = Number(found[1]);
    const to = Number(found[2] || found[1]);
    return range.first <= from && from <= to && to <= range.last;
  });
}

function checkLineAttributes(pre, report) {
  const lines = getAttr(pre, 'data-lines');
  if (lines && !/^([1-9]\d*)?$/.test(lines.value)) {
    report.error(lines, 'code/mark', 'data-lines 要么留空，要么写起始行号（正整数）');
  }
  const mark = getAttr(pre, 'data-mark');
  const range = codeLineRange(pre);
  if (mark && !isValidMark(mark.value, range)) {
    report.error(mark, 'code/mark', `data-mark 要写成 "3,5-7" 这样的行号，并且在 ${range.first}–${range.last} 之间`);
  }
}

/** 缩进被破坏的迹象：大多数缩进行是 4（或 2）的倍数，个别行却不是。 */
function checkIndent(code, lesson, report) {
  const [text] = code.children;
  if (!text) return;
  const indented = [...text.value.matchAll(/^( +)\S/gm)];
  const onFour = indented.filter((line) => line[1].length % 4 === 0);
  const unit = onFour.length >= indented.length * 0.8 ? 4 : 2;
  for (const line of indented) {
    const width = line[1].length;
    if (width % unit !== 0) {
      const position = lesson.doc.locate(sourceOffset(text, line.index));
      report.warn(position, 'code/indent', `这一行缩进了 ${width} 个空格，不是 ${unit} 的倍数：缩进可能被破坏了`);
    }
  }
}

function checkBlock(pre, lesson, report, highlighter, extraLanguages) {
  const content = pre.children.filter((node) => node.type !== 'comment');
  const code = content.length === 1 && content[0].name === 'code' ? content[0] : null;
  if (code) {
    checkTextOnly(code, report);
  } else {
    report.error(pre, 'code/markup', '<pre> 里只能有一个 <code>，两者之间不能有空白或别的内容');
  }
  checkLanguage(pre, report, highlighter, extraLanguages);
  checkLineAttributes(pre, report);
  if (code && !firstNonText(code)) checkIndent(code, lesson, report);
}

function checkNotes(notes, report) {
  const pre = previousElement(notes);
  if (notes.name !== 'ol' || !pre || pre.name !== 'pre') {
    report.error(notes, 'code/notes', '逐行讲解要写成 <ol class="code-notes">，并且紧跟在 <pre> 后面');
    return;
  }
  const range = codeLineRange(pre);
  for (const item of childElements(notes)) {
    const line = attr(item, 'data-line') || '';
    const valid = item.name === 'li' && /^\d+$/.test(line) && range.first <= Number(line) && Number(line) <= range.last;
    if (!valid) {
      report.error(item, 'code/notes', `每条讲解都是带 data-line 的 <li>，行号在 ${range.first}–${range.last} 之间`);
    }
  }
}

function checkCode(lesson, report, site) {
  const templateDir = site?.templateDir;
  const isCustom = Boolean(templateDir && path.resolve(templateDir) !== TEMPLATE_DIR);
  const highlighter = isCustom ? (site.hljs ??= loadHighlighter(templateDir)) : hljs;
  const extraLanguages = isCustom ? (site.extraLanguages ??= loadExtraLanguages(templateDir)) : EXTRA_LANGUAGES;
  for (const element of lesson.elements) {
    if (element.name === 'pre') checkBlock(element, lesson, report, highlighter, extraLanguages);
    if (element.name === 'code' && element.parent.name !== 'pre') checkTextOnly(element, report);
    if (hasClass(element, 'code-notes')) checkNotes(element, report);
  }
}

module.exports = { checkCode };
