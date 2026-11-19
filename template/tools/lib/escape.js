'use strict';
/* 自动转义：代码和公式里的 < 与 & 应当写成 &lt;、&amp;。这件事没有歧义，build 直接替作者改掉；
 * 检查和导出则在内存里按转义之后的样子来看，另报一条“还有几处没转义”。
 * 只动这两种字符，别的一个字节都不改：换行符、缩进、BOM 都保持原样。 */
const fs = require('fs');
const path = require('path');
const { parse, applyEdits } = require('./html');
const { matchCharRef } = require('./charref');
const { hasClass, descendants } = require('./dom');
const { rootHtmlFiles } = require('./files');

/** 内容应当是纯文字的元素：<code>，以及写成 span 或 div 的 .math。 */
function holdsLiteralText(element) {
  return element.name === 'code' || (['span', 'div'].includes(element.name) && hasClass(element, 'math'));
}

/** 转义一段文字，返回 { text, marks }；marks 是被转义的字符在这段文字里的下标和各自多出来的长度。 */
function escapeLiteral(raw) {
  const marks = [];
  const text = raw.replace(/[<&]/g, (char, index) => {
    if (char === '&' && matchCharRef(raw, index)) return char;
    const replacement = char === '<' ? '&lt;' : '&amp;';
    marks.push({ index, extra: replacement.length - 1 });
    return replacement;
  });
  return { text, marks };
}

/**
 * 把一个代码或公式元素的内容整体当作文字来转义，返回 { edit, marks }；marks 里的下标是整份源码里的偏移。
 * 两种情况不动它、留给检查去报告：没有结束标签；内容里又出现了同名的开始标签（多半是前面漏了结束标签）。
 */
function escapeContent(element, source) {
  const untouched = { edit: null, marks: [] };
  if (element.contentEnd === null) return untouched;
  const raw = source.slice(element.contentStart, element.contentEnd);
  if (new RegExp(`<${element.name}[\\s/>]`, 'i').test(raw)) return untouched;
  const { text, marks } = escapeLiteral(raw);
  return {
    edit: { start: element.contentStart, end: element.contentEnd, text },
    marks: marks.map(({ index, extra }) => ({ offset: element.contentStart + index, extra }))
  };
}

/**
 * 转义一份 HTML 源码，返回 { text, marks }：新的源码，以及每一处转义在原来的源码里的偏移和多出来的长度。
 * marks 为空就是什么都不用改。
 */
function escapeSource(source) {
  const doc = parse(source, holdsLiteralText);
  const edits = [];
  const marks = [];
  for (const element of descendants(doc.root)) {
    if (!holdsLiteralText(element)) continue;
    const content = escapeContent(element, source);
    if (content.marks.length === 0) continue;
    edits.push(content.edit);
    marks.push(...content.marks);
  }
  return { text: applyEdits(source, edits), marks };
}

/** 转义根目录下的每一讲（登记与否都处理，与检查的范围一致），返回改动过的文件：[{ file, escaped }]。 */
function escapeCourse(root) {
  const changes = [];
  for (const file of rootHtmlFiles(root)) {
    const target = path.join(root, file);
    const { text, marks } = escapeSource(fs.readFileSync(target, 'utf8'));
    if (marks.length === 0) continue;
    fs.writeFileSync(target, text);
    changes.push({ file, escaped: marks.length });
  }
  return changes;
}

module.exports = { escapeSource, escapeCourse };
