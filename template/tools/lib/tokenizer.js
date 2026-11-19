'use strict';
/* HTML 分词器：把源码切成 doctype、注释、开始标签、结束标签和文字。
 * 这里只负责"切"；嵌套关系由 html.js 的建树器处理。 */
const { decodeCharRefs } = require('./charref');

const TAG_OPEN = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(?=[\s/>]|$)/y;
const DOCTYPE_OPEN = /<!doctype(?=[\s>]|$)/iy;
const WHITESPACE = /\s*/y;
const ATTR_NAME = /=?[^\s/>=]*/y;
const UNQUOTED_VALUE = /[^\s>]*/y;

class Tokenizer {
  /** report(offset, rule, message) 接收分词时发现的问题。 */
  constructor(source, report) {
    this.source = source;
    this.report = report;
    this.pos = 0;
  }

  /** 下一个记号；读完返回 null。 */
  next() {
    if (this.pos >= this.source.length) return null;
    if (this.source.startsWith('<!--', this.pos)) return this.readComment();
    if (this.at(DOCTYPE_OPEN, this.pos)) return this.readDoctype();
    if (this.at(TAG_OPEN, this.pos)) return this.readTag();
    return this.readText();
  }

  /** 读到 </name 为止的原始文字，用于 script、style、title 这类不解析内部标签的元素。 */
  readRawText(name) {
    const closing = new RegExp(`</${name}(?=[\\s/>]|$)`, 'ig');
    closing.lastIndex = this.pos;
    const found = closing.exec(this.source);
    const token = { type: 'text', offset: this.pos, end: found ? found.index : this.source.length };
    this.pos = token.end;
    return token;
  }

  /** 解码一段源码里的字符引用；offset 是这段源码的起点，用来报告无效的 &。 */
  decode(offset, raw) {
    return decodeCharRefs(raw, (index) => {
      this.report(
        offset + index,
        'html/amp',
        '& 没有构成可用的字符引用：& 本身要写成 &amp;；不常见的命名引用请直接写出字符，或改用 &#x…; 的形式'
      );
    });
  }

  at(pattern, index) {
    pattern.lastIndex = index;
    return pattern.test(this.source);
  }

  take(pattern) {
    pattern.lastIndex = this.pos;
    const match = pattern.exec(this.source);
    this.pos = pattern.lastIndex;
    return match;
  }

  startsMarkup(index) {
    return this.source.startsWith('<!--', index) || this.at(DOCTYPE_OPEN, index) || this.at(TAG_OPEN, index);
  }

  /** 跳到 marker 之后并返回 marker 的起点；找不到就报告，并把剩下的内容全部算进来。 */
  skipPast(marker, from, offset, what) {
    const found = this.source.indexOf(marker, from);
    if (found === -1) this.report(offset, 'html/unclosed', `${what}没有结束，缺少 ${marker}`);
    this.pos = found === -1 ? this.source.length : found + marker.length;
    return found === -1 ? this.source.length : found;
  }

  readText() {
    const offset = this.pos;
    let end = this.source.indexOf('<', offset);
    while (end !== -1 && !this.startsMarkup(end)) {
      this.report(end, 'html/lt', '< 没有构成标签；作为文字时要写成 &lt;');
      end = this.source.indexOf('<', end + 1);
    }
    this.pos = end === -1 ? this.source.length : end;
    return { type: 'text', offset, end: this.pos };
  }

  readComment() {
    const offset = this.pos;
    this.skipPast('-->', offset + 2, offset, '注释');
    return { type: 'comment', offset, end: this.pos };
  }

  readDoctype() {
    const offset = this.pos;
    const close = this.skipPast('>', offset, offset, '<!doctype ');
    const value = this.source.slice(offset + '<!doctype'.length, close).trim();
    return { type: 'doctype', value, offset, end: this.pos };
  }

  /** 读一个标签。直到文件末尾都没写完的标签，报告后丢掉（返回 null，后面已经没有内容）。 */
  readTag() {
    const offset = this.pos;
    const [, slash, name] = this.take(TAG_OPEN);
    const attrs = [];
    const closer = this.readAttributes(attrs);
    if (closer === undefined) {
      this.report(offset, 'html/unclosed', '标签没有写完：缺少 >，或者属性值的引号没有闭合');
      return null;
    }
    if (slash) return { type: 'end', name, offset, end: this.pos };
    return { type: 'start', name, attrs, selfClosing: closer === '/>', offset, end: this.pos };
  }

  /** 把属性读进 attrs，返回结束这个标签的 ">" 或 "/>"；到文件末尾都没有结束时返回 undefined。 */
  readAttributes(attrs) {
    for (;;) {
      this.take(WHITESPACE);
      if (this.pos >= this.source.length) return undefined;
      const closer = ['/>', '>'].find((mark) => this.source.startsWith(mark, this.pos));
      if (closer) {
        this.pos += closer.length;
        return closer;
      }
      if (this.source[this.pos] === '/') {
        this.pos += 1;
      } else {
        this.readAttribute(attrs);
      }
    }
  }

  readAttribute(attrs) {
    const offset = this.pos;
    const [name] = this.take(ATTR_NAME);
    if (name.includes('<')) {
      this.report(offset + name.indexOf('<'), 'html/lt', '标签里出现了 <：前一个标签可能没有写完');
    }
    const value = this.readAttributeValue();
    if (attrs.some((attr) => attr.name.toLowerCase() === name.toLowerCase())) {
      this.report(offset, 'html/dup-attr', `属性 ${name} 重复出现`);
    } else {
      attrs.push({ name, value, offset, end: this.pos });
    }
  }

  readAttributeValue() {
    this.take(WHITESPACE);
    if (this.source[this.pos] !== '=') return '';
    this.pos += 1;
    this.take(WHITESPACE);
    const start = this.pos;
    const quote = this.source[start];
    if (quote !== '"' && quote !== "'") return this.decode(start, this.take(UNQUOTED_VALUE)[0]);
    const close = this.source.indexOf(quote, start + 1);
    if (close === -1) {
      // 引号没有闭合：这个标签到文件末尾都不会结束，由 readTag 统一报告。
      this.pos = this.source.length;
      return '';
    }
    this.pos = close + 1;
    return this.decode(start + 1, this.source.slice(start + 1, close));
  }
}

module.exports = { Tokenizer };
