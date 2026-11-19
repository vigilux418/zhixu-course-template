'use strict';
/* 零依赖的 HTML 解析器：tokenizer.js 分词，这里严格建树，每个节点都带源码位置。
 * 与浏览器的容错规则不同：除空元素外每个元素都必须显式闭合，这样问题能定位到确切的行列。 */
const { Tokenizer } = require('./tokenizer');
const { matchCharRef } = require('./charref');

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
]);
const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);
const TEXT_ONLY_ELEMENTS = new Set(['title', 'textarea']);
const FOREIGN_ROOTS = new Set(['svg', 'math']);

/** 返回一个把源码偏移换算成 { line, col }（都从 1 开始）的函数。 */
function createLocator(source) {
  const lineStarts = [0];
  for (let index = source.indexOf('\n'); index !== -1; index = source.indexOf('\n', index + 1)) {
    lineStarts.push(index + 1);
  }
  return (offset) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (lineStarts[middle] <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return { line: low + 1, col: offset - lineStarts[low] + 1 };
  };
}

class TreeBuilder {
  constructor(source, isVerbatim) {
    this.source = source;
    this.isVerbatim = isVerbatim;
    this.locate = createLocator(source);
    this.problems = [];
    this.tokenizer = new Tokenizer(source, (offset, rule, message) => this.report(offset, rule, message));
    this.root = { type: 'document', children: [] };
    this.open = [this.root];
  }

  build() {
    // 记号的类型就是处理它的方法名：doctype、comment、text、start、end。
    for (let token = this.tokenizer.next(); token; token = this.tokenizer.next()) {
      this[token.type](token);
    }
    this.reportUnclosed(1, '到文件末尾');
    return { root: this.root, problems: this.problems, locate: this.locate };
  }

  report(offset, rule, message) {
    this.problems.push({ ...this.locate(offset), rule, message });
  }

  append(node, token) {
    const parent = this.open[this.open.length - 1];
    Object.assign(node, this.locate(token.offset), { offset: token.offset, parent });
    parent.children.push(node);
  }

  doctype(token) {
    this.append({ type: 'doctype', value: token.value }, token);
  }

  comment(token) {
    this.append({ type: 'comment' }, token);
  }

  text(token, verbatim = false) {
    const raw = this.source.slice(token.offset, token.end);
    const value = verbatim ? raw : this.tokenizer.decode(token.offset, raw);
    this.append({ type: 'text', value, raw, end: token.end }, token);
  }

  start(token) {
    const parent = this.open[this.open.length - 1];
    const lower = token.name.toLowerCase();
    const foreign = FOREIGN_ROOTS.has(lower) || Boolean(parent.foreign && parent.name !== 'foreignObject');
    const name = foreign ? token.name : lower;
    const attrs = token.attrs.map((attr) => ({
      ...attr,
      ...this.locate(attr.offset),
      name: foreign ? attr.name : attr.name.toLowerCase()
    }));
    const element = { type: 'element', name, attrs, children: [], foreign, contentStart: token.end, contentEnd: null };
    element.content = this.contentMode(element);
    this.append(element, token);
    const isVoid = !foreign && VOID_ELEMENTS.has(name);
    if (token.selfClosing && !foreign && !isVoid) {
      this.report(token.offset, 'html/self-closing', `<${name}/> 不是合法写法：要写成 <${name}></${name}>`);
    }
    if (token.selfClosing || isVoid) return;
    this.open.push(element);
    if (element.content !== 'markup') this.readOpaqueContent(element);
  }

  /** 元素内容的读法：'verbatim' 原样文字，'text' 只解码字符引用，'markup' 正常解析。 */
  contentMode(element) {
    if (this.isVerbatim(element)) return 'verbatim';
    if (element.foreign) return 'markup';
    if (RAW_TEXT_ELEMENTS.has(element.name)) return 'verbatim';
    return TEXT_ONLY_ELEMENTS.has(element.name) ? 'text' : 'markup';
  }

  readOpaqueContent(element) {
    const token = this.tokenizer.readRawText(element.name);
    if (token.end > token.offset) this.text(token, element.content === 'verbatim');
  }

  end(token) {
    const lower = token.name.toLowerCase();
    const index = this.open.findLastIndex((node) => node.type === 'element' && node.name.toLowerCase() === lower);
    if (index === -1) {
      this.report(
        token.offset,
        'html/stray-end',
        `多余的结束标签 </${token.name}>：前面没有尚未闭合的 <${token.name}>`
      );
      return;
    }
    const { line, col } = this.locate(token.offset);
    this.reportUnclosed(index + 1, `在 ${line}:${col} 的 </${token.name}> 之前`);
    this.open[index].contentEnd = token.offset;
    this.open.length = index;
  }

  reportUnclosed(from, where) {
    for (const element of this.open.slice(from)) {
      this.report(element.offset, 'html/unclosed', `<${element.name}> 没有闭合：${where}都没有遇到 </${element.name}>`);
    }
  }
}

/**
 * 解析 HTML 源码，返回 { root, problems, locate }。
 *
 * 节点有五种：document { children }、doctype { value }、comment、text { value, raw, end }、
 * element { name, attrs, children, foreign, content, contentStart, contentEnd }。
 * 除 document 外都带 line、col、offset、parent；属性是 { name, value, line, col, offset, end }，
 * 在源码里占 [offset, end)。
 * 元素的内容在源码里是 [contentStart, contentEnd)；没有显式闭合时 contentEnd 为 null。
 *
 * isVerbatim(element) 为真的元素，内容不再解析，原样读到它的结束标签为止。
 */
function parse(source, isVerbatim = () => false) {
  return new TreeBuilder(source, isVerbatim).build();
}

/** 文字节点里第 index 个字符（解码后的下标）在源码中的偏移。 */
function sourceOffset(text, index) {
  let decoded = 0;
  let raw = 0;
  while (decoded < index) {
    const ref = text.raw[raw] === '&' ? matchCharRef(text.raw, raw) : null;
    decoded += ref ? ref.value.length : 1;
    raw += ref ? ref.length : 1;
  }
  return text.offset + raw;
}

/** 把 edits（{ start, end, text }，互不重叠）应用到源码上。 */
function applyEdits(source, edits) {
  let result = '';
  let done = 0;
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    result += source.slice(done, edit.start) + edit.text;
    done = edit.end;
  }
  return result + source.slice(done);
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

module.exports = { parse, sourceOffset, applyEdits, escapeHtml };
