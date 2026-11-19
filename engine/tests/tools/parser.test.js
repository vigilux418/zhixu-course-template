'use strict';
/* 解析器：位置、字符引用、原始文字元素、外来内容（SVG）、严格闭合。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { lib, pad } = require('./helpers');

const { parse, sourceOffset } = lib('html');
const { childElements, descendants, textOf } = lib('dom');

const rules = (doc) => doc.problems.map((problem) => problem.rule);
const find = (doc, name) => [...descendants(doc.root)].find((element) => element.name === name);
const place = (node) => [node.line, node.col];

test('元素、属性和文字都带行列与偏移', () => {
  const source = ['<div id="a"', `${pad(2)}class="b">`, '<p>你好 <b>世界</b></p>', '</div>'].join('\n');
  const doc = parse(source);
  const div = find(doc, 'div');
  const paragraph = find(doc, 'p');
  const bold = find(doc, 'b');
  assert.deepEqual(doc.problems, []);
  assert.deepEqual(place(div), [1, 1]);
  assert.deepEqual(
    div.attrs.map((attr) => [attr.name, attr.value, attr.line, attr.col]),
    [
      ['id', 'a', 1, 6],
      ['class', 'b', 2, 3]
    ]
  );
  assert.deepEqual(place(paragraph), [3, 1]);
  assert.deepEqual(place(paragraph.children[0]), [3, 4]);
  assert.deepEqual(place(bold), [3, 7]);
  assert.equal(source.slice(bold.offset, bold.offset + 3), '<b>');
  assert.equal(source.slice(bold.contentStart, bold.contentEnd), '世界');
  assert.deepEqual(doc.locate(source.length - 1), { line: 4, col: 6 });
});

test('doctype、注释和文字各成节点', () => {
  const doc = parse('<!DOCTYPE html><!-- 注释 <p> --><p>文字</p>');
  assert.deepEqual(
    doc.root.children.map((node) => node.type),
    ['doctype', 'comment', 'element']
  );
  assert.equal(doc.root.children[0].value, 'html');
  assert.deepEqual(doc.problems, []);
});

test('属性：双引号、单引号、无引号、无值', () => {
  const doc = parse('<input type="text" name=\'n\' size=4 disabled data-x = "1">');
  const values = find(doc, 'input').attrs.map((attr) => [attr.name, attr.value]);
  assert.deepEqual(values, [
    ['type', 'text'],
    ['name', 'n'],
    ['size', '4'],
    ['disabled', ''],
    ['data-x', '1']
  ]);
  assert.deepEqual(doc.problems, []);
});

test('标签名与属性名在 HTML 里转成小写', () => {
  const doc = parse('<DIV CLASS="a"><P>x</P></DIV>');
  assert.equal(find(doc, 'div').attrs[0].name, 'class');
  assert.equal(find(doc, 'p').parent.name, 'div');
  assert.deepEqual(doc.problems, []);
});

test('重复的属性报告 html/dup-attr，保留第一个', () => {
  const doc = parse('<p id="a" ID="b">x</p>');
  assert.deepEqual(rules(doc), ['html/dup-attr']);
  assert.deepEqual(
    find(doc, 'p').attrs.map((attr) => attr.value),
    ['a']
  );
});

test('空元素不需要闭合，写成 <br/> 也可以', () => {
  const doc = parse('<p>a<br>b<br/>c<img src="x.png" alt="图"><hr></p>');
  assert.deepEqual(doc.problems, []);
  assert.deepEqual(
    childElements(find(doc, 'p')).map((element) => element.name),
    ['br', 'br', 'img', 'hr']
  );
});

test('字符引用：命名、十进制、十六进制都被解码', () => {
  const doc = parse('<p title="a &amp; b">&lt;x&gt; &copy; &#169; &#xA9; &nbsp;&hellip;&lbrace;</p>');
  assert.deepEqual(doc.problems, []);
  assert.equal(find(doc, 'p').attrs[0].value, 'a & b');
  const copyright = String.fromCodePoint(0xa9);
  const expected = `<x> ${copyright} ${copyright} ${copyright} ${String.fromCodePoint(0xa0, 0x2026)}${String.fromCodePoint(0x7b)}`;
  assert.equal(textOf(find(doc, 'p')), expected);
});

test('无效的 & 报告 html/amp，并按字面保留', () => {
  for (const text of ['R&D', 'a && b', '&unknown;', '&amp', '&#0;', '&#xD800;', '&#x110000;', '&#128;']) {
    const doc = parse(`<p>${text}</p>`);
    assert.ok(rules(doc).every((rule) => rule === 'html/amp') && doc.problems.length > 0, text);
    assert.equal(textOf(find(doc, 'p')), text);
  }
  const inAttribute = parse('<a href="?a=1&b=2">x</a>');
  assert.deepEqual(rules(inAttribute), ['html/amp']);
  assert.deepEqual(place(inAttribute.problems[0]), [1, 14]);
});

test('文字里不成标签的 < 报告 html/lt', () => {
  for (const text of ['a < b', '1<2', 'x <= y', '#include <stdio.h>', 'i<n; i++', '</>', '<?xml?>', '<!x>']) {
    const doc = parse(`<p>${text}</p>`);
    assert.deepEqual(rules(doc), ['html/lt'], text);
    assert.equal(textOf(find(doc, 'p')), text);
  }
  assert.deepEqual(parse('<p>a &lt; b > c</p>').problems, []);
});

test('script 与 style 的内容是原始文字', () => {
  const doc = parse('<script>if (a < b && c) x = "<p>&amp;";</script><style>a > b { color: red }</style>');
  assert.deepEqual(doc.problems, []);
  assert.equal(textOf(find(doc, 'script')), 'if (a < b && c) x = "<p>&amp;";');
  assert.equal(childElements(find(doc, 'script')).length, 0);
});

test('title 与 textarea 只有文字，但字符引用照常解码', () => {
  const doc = parse('<title>a &amp; b <i>不是标签</i></title><textarea><p>x</textarea>');
  assert.deepEqual(doc.problems, []);
  assert.equal(textOf(find(doc, 'title')), 'a & b <i>不是标签</i>');
  assert.equal(textOf(find(doc, 'textarea')), '<p>x');
});

test('SVG 里保留大小写，允许自闭合', () => {
  const doc = parse('<svg viewBox="0 0 10 10"><linearGradient id="g"/><rect width="1"/><text>字</text></svg>');
  const svg = find(doc, 'svg');
  assert.deepEqual(doc.problems, []);
  assert.equal(svg.attrs[0].name, 'viewBox');
  assert.deepEqual(
    childElements(svg).map((element) => element.name),
    ['linearGradient', 'rect', 'text']
  );
  assert.ok(childElements(svg).every((element) => element.foreign));
});

test('foreignObject 里回到 HTML 的规则', () => {
  const doc = parse('<svg viewBox="0 0 1 1"><foreignObject><p>a<br>b</p><span/></foreignObject></svg>');
  assert.deepEqual(rules(doc), ['html/self-closing']);
  assert.equal(find(doc, 'p').foreign, false);
});

test('HTML 里非空元素不能自闭合', () => {
  const doc = parse('<div/><p>x</p>');
  assert.deepEqual(rules(doc), ['html/self-closing']);
  assert.equal(find(doc, 'p').parent, doc.root);
});

test('每个非空元素都必须显式闭合', () => {
  for (const name of ['p', 'li', 'td', 'tr', 'dt', 'dd', 'thead', 'tbody', 'div', 'span', 'html', 'body']) {
    const doc = parse(`<${name}>内容`);
    assert.deepEqual(rules(doc), ['html/unclosed'], name);
  }
});

test('没闭合的 div 报告在它开始的那一行', () => {
  const source = ['<main>', '<section>', '<div class="a">', '<p>内容</p>', '</section>', '</main>'].join('\n');
  const doc = parse(source);
  assert.deepEqual(
    doc.problems.map((problem) => [problem.rule, problem.line, problem.col]),
    [['html/unclosed', 3, 1]]
  );
  assert.match(doc.problems[0].message, /5:1/);
  assert.equal(find(doc, 'p').parent.name, 'div');
});

test('多余的结束标签报告 html/stray-end', () => {
  const doc = parse('<p>x</p></div></br>');
  assert.deepEqual(rules(doc), ['html/stray-end', 'html/stray-end']);
});

test('代码里没转义的 vector<int> 会被当成没闭合的标签', () => {
  const doc = parse('<pre><code>vector<int> v;</code></pre>');
  assert.deepEqual(rules(doc), ['html/unclosed']);
  assert.deepEqual(place(doc.problems[0]), [1, 18]);
});

test('没写完的注释、标签和属性值报告 html/unclosed', () => {
  assert.deepEqual(rules(parse('<p>x</p><!-- 没有结束')), ['html/unclosed']);
  assert.deepEqual(rules(parse('<p>x</p><div class="a"')), ['html/unclosed']);
  assert.ok(rules(parse('<p class="a>x</p>')).includes('html/unclosed'));
});

test('标签里的 < 报告 html/lt', () => {
  assert.ok(rules(parse('<div class="a" <p>x</p></div>')).includes('html/lt'));
});

test('sourceOffset 把解码后的下标换算回源码位置', () => {
  const source = '<p>a &lt; b &amp;&amp; c</p>';
  const doc = parse(source);
  const [text] = find(doc, 'p').children;
  assert.equal(text.value, 'a < b && c');
  assert.equal(source[sourceOffset(text, text.value.indexOf('c'))], 'c');
  assert.equal(source.slice(sourceOffset(text, 2), sourceOffset(text, 3)), '&lt;');
});

test('MathML 也是外来内容：保留大小写，允许自闭合', () => {
  const doc = parse(
    '<p><math display="block"><mi>x</mi><mspace width="1em"/><annotation-xml encoding="x"/></math></p>'
  );
  assert.deepEqual(doc.problems, []);
  assert.deepEqual(
    childElements(find(doc, 'math')).map((element) => [element.name, element.foreign]),
    [
      ['mi', true],
      ['mspace', true],
      ['annotation-xml', true]
    ]
  );
});
