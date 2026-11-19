'use strict';
/* 契约里各个组件在树上的样子：小节、自动编号、小测、代码行、术语。
 * 检查规则和 data.js 的生成都从这里取；运行时（engine/src/js）用的是同一套规则，改动时两边要一起改。 */
const {
  attr,
  attrText,
  getAttr,
  hasClass,
  is,
  childElements,
  descendants,
  textOf,
  collapse,
  closest
} = require('./dom');

// 运行时给没有 id 的小结补上的 id。
const RECAP_ID = 'zx-recap';

/** 引擎生成的 id 都以 zx- 开头：作者不能用，也不能链接过去。 */
function isEngineId(id) {
  return id.startsWith('zx-');
}

/** <main> 直属的小节，含小结。 */
function topSections(main) {
  return childElements(main).filter((element) => element.name === 'section');
}

function isRecap(section) {
  return hasClass(section, 'recap');
}

/** 一个小节在地址里的锚点：作者写的 id；没写 id 的小结用运行时补的那个；都没有就是空串。 */
function sectionAnchor(section) {
  return attr(section, 'id') || (isRecap(section) ? RECAP_ID : '');
}

/** 元素所在的那一小节的锚点；不在任何小节里（比如在导语里）就是空串。 */
function anchorOf(element) {
  const section = closest(element, (node) => node.name === 'section' && node.parent.name === 'main');
  return section ? sectionAnchor(section) : '';
}

/** 小节开头的 <h2>；没有按契约写时返回 undefined。 */
function sectionHeading(section) {
  const [first] = childElements(section);
  return first && first.name === 'h2' ? first : undefined;
}

function hasChild(element, name) {
  return childElements(element).some((child) => child.name === name);
}

function insideStepper(element) {
  return closest(element.parent, (node) => hasClass(node, 'stepper')) !== null;
}

// 参与自动编号的四类元素；每一类按文档顺序各自从 1 数起。
const NUMBERED_KINDS = [
  ['图', (element) => element.name === 'figure' && hasChild(element, 'figcaption') && !insideStepper(element)],
  ['表', (element) => element.name === 'table' && hasChild(element, 'caption')],
  ['例', (element) => is(element, 'div', 'example')],
  ['式', (element) => is(element, 'div', 'math') && getAttr(element, 'id') !== undefined]
];

/**
 * 给 main 里的图、表、例、式编号，返回 [{ element, label }]，label 形如"图 2-1"。
 * 没有登记到课程里的页面没有讲次（lessonNumber 为 undefined），编号不带讲次前缀，如"图 1"。
 */
function numberElements(main, lessonNumber) {
  const prefix = lessonNumber === undefined ? '' : `${lessonNumber}-`;
  const counts = new Map();
  const numbered = [];
  for (const element of descendants(main)) {
    const kind = NUMBERED_KINDS.find(([, matches]) => matches(element));
    if (kind) {
      const [word] = kind;
      counts.set(word, (counts.get(word) || 0) + 1);
      numbered.push({ element, label: `${word} ${prefix}${counts.get(word)}` });
    }
  }
  return numbered;
}

/**
 * 小测的组成。选项是最后一个直属 <ol>；提示和解析是直属的 .hint 与 .explain；
 * 其余的直属元素合起来是题干，题干的文字决定这道题的学习记录存在哪个键下。
 */
function quizParts(quiz) {
  const children = childElements(quiz);
  const options = children.filter((element) => element.name === 'ol').pop();
  const hints = children.filter((element) => hasClass(element, 'hint'));
  const explains = children.filter((element) => hasClass(element, 'explain'));
  const extras = new Set([options, ...hints, ...explains]);
  const stem = children.filter((element) => !extras.has(element));
  return { options, hints, explains, stem, stemText: collapse(stem.map(textOf).join(' ')) };
}

/** 代码块的行数；末尾的一个换行不算新的一行。 */
function codeLineCount(pre) {
  return textOf(pre).replace(/\n$/, '').split('\n').length;
}

/** 代码块显示的行号范围：data-lines 给出起始行号，默认从 1 开始。 */
function codeLineRange(pre) {
  const first = Number(attr(pre, 'data-lines')) || 1;
  return { first, last: first + codeLineCount(pre) - 1 };
}

function termOf(dfn) {
  return textOf(dfn).trim();
}

/** 全课的术语表：术语 → { def, file, element }；同一个术语以课程顺序里的第一次定义为准。 */
function glossary(lessons) {
  const terms = new Map();
  for (const lesson of lessons) {
    for (const element of lesson.elements) {
      const def = element.name === 'dfn' ? attrText(element, 'data-def') : '';
      const term = def === '' ? '' : termOf(element);
      if (term !== '' && !terms.has(term)) terms.set(term, { def, file: lesson.file, element });
    }
  }
  return terms;
}

module.exports = {
  isEngineId,
  topSections,
  isRecap,
  sectionAnchor,
  anchorOf,
  sectionHeading,
  numberElements,
  quizParts,
  codeLineCount,
  codeLineRange,
  termOf,
  glossary
};
