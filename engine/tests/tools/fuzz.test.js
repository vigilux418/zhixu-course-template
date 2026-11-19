'use strict';
/* 健壮性：把标签碎片随机拼起来，解析和修复都不能出错，修复必须幂等。随机数固定种子，结果可重复。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { lib, pad } = require('./helpers');

const { parse } = lib('html');
const { escapeSource } = lib('escape');
const { descendants, textOf, collapse } = lib('dom');

const PIECES = [
  '<p>',
  '</p>',
  '<div class="callout note">',
  '</div>',
  '<span class="math">',
  '</span>',
  '<code>',
  '</code>',
  '<pre data-lang="python">',
  '</pre>',
  '<ul>',
  '<li>',
  '</li>',
  '</ul>',
  '<table>',
  '<tr>',
  '<td>',
  '</td>',
  '</tr>',
  '</table>',
  '<svg viewBox="0 0 1 1">',
  '<rect/>',
  '</svg>',
  '<foreignObject>',
  '</foreignObject>',
  '<br>',
  '<img src="a.png" alt="x">',
  '<!-- c -->',
  '<!--',
  '-->',
  '<main>',
  '</main>',
  '<section id="s">',
  '</section>',
  '<h2>',
  '</h2>',
  '<script>',
  '</script>',
  '<title>',
  '</title>',
  '<textarea>',
  '</textarea>',
  '<a href="#s">',
  '</a>',
  '文字',
  'text',
  ' ',
  '\n',
  `\n${pad(3)}`,
  '\n\n',
  'a < b',
  'x<y>z',
  '&amp;',
  '&',
  '&lt;',
  '&nope;',
  '"',
  "'",
  '=',
  '<',
  '>',
  '</',
  '<!',
  '<a b=',
  '<a b="',
  '<div',
  'class="x"',
  '/>'
];

/** 线性同余发生器：固定的种子给出固定的序列。 */
function createRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function soup(random) {
  const length = 1 + Math.floor(random() * 60);
  return Array.from({ length }, () => PIECES[Math.floor(random() * PIECES.length)]).join('');
}

test('任意拼凑的标记都能解析和转义：不出错，内容范围合法，转义是幂等的，没有要转义的就一个字都不改', () => {
  const random = createRandom(20241111);
  for (let round = 0; round < 1500; round += 1) {
    const source = soup(random);
    const doc = parse(source);
    for (const element of descendants(doc.root)) {
      assert.ok(element.contentEnd === null || element.contentEnd >= element.contentStart, source);
    }
    const once = escapeSource(source);
    assert.deepEqual(escapeSource(once.text), { text: once.text, marks: [] }, source);
    if (once.marks.length === 0) assert.equal(once.text, source, source);
  }
});
