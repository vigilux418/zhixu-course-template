'use strict';
/* 读入一讲：解析 HTML，取出后面的检查和生成都要用的信息。 */
const path = require('path');
const { parse } = require('./html');
const { readText } = require('./files');
const { escapeSource } = require('./escape');
const {
  attr,
  hasClass,
  is,
  isBlock,
  isText,
  childElements,
  descendants,
  textExcept,
  textOf,
  collapse
} = require('./dom');
const {
  topSections,
  isRecap,
  sectionAnchor,
  sectionHeading,
  numberElements,
  codeLineCount,
  quizParts
} = require('./anatomy');
const { hash } = require('./plain');

function textOfFirst(elements, matches) {
  const found = elements.find(matches);
  return found ? collapse(textOf(found)) : '';
}

/** offset 在 text 里是第几行第几列（都从 1 数起）。 */
function positionOf(text, offset) {
  const before = text.slice(0, offset).split('\n');
  return { line: before.length, col: before[before.length - 1].length + 1 };
}

/**
 * 返回一个函数，把“转义之后”的位置换算回磁盘上那份源码里的位置：
 * 行号不变；同一行里，前面每转义一处，列号就多出几个字符。
 */
function originalPositions(original, marks) {
  const byLine = new Map(); // 行号 → [{ col, extra }]，col 是原来的列号
  for (const { offset, extra } of marks) {
    const { line, col } = positionOf(original, offset);
    byLine.set(line, [...(byLine.get(line) ?? []), { col, extra }]);
  }
  return ({ line, col }) => {
    let shift = 0;
    for (const mark of byLine.get(line) ?? []) if (mark.col + shift < col) shift += mark.extra;
    return { line, col: col - shift };
  };
}

/**
 * 读入并解析一讲。number 是它在全课里的讲次（从 1 开始）；没有登记到课程里的页面没有讲次，不传。
 * 返回各条规则和生成步骤共用的视图：doc 是解析结果，elements 是按文档顺序排列的全部元素，
 * html、head、body、main 是骨架元素（骨架写错时为 undefined），ids 是 id → 元素，
 * sections 是 <main> 直属的小节，labels 是 id → 编号文字（如"图 2-1"），quizzes 是全部小测。
 *
 * 代码和公式里没转义的 < 和 & 先在内存里转义，再解析：这样它们不会把后面的结构带歪，一处疏漏不会引出一串报错。
 * source 是转义之后的源码，后面的规则看到的位置都是它里面的；unescaped 是没转义的有几处，
 * toOriginal 把位置换算回磁盘上的文件。build 会把这些地方真的改掉。
 */
function loadLesson(root, file, number) {
  const original = readText(path.join(root, file));
  const { text: source, marks } = escapeSource(original);
  const doc = parse(source);
  const elements = [...descendants(doc.root)];
  const html = childElements(doc.root).find((element) => element.name === 'html');
  const head = html && childElements(html).find((element) => element.name === 'head');
  const body = html && childElements(html).find((element) => element.name === 'body');
  const main = elements.find((element) => element.name === 'main');
  const headElements = head ? childElements(head) : [];
  const description = headElements.find(
    (element) => element.name === 'meta' && attr(element, 'name') === 'description'
  );
  const numbered = main ? numberElements(main, number) : [];
  const ids = new Map();
  for (const element of elements) {
    const id = attr(element, 'id');
    if (id !== undefined && !ids.has(id)) ids.set(id, element);
  }
  return {
    file,
    number,
    source,
    unescaped: marks.length,
    firstUnescaped: marks.length > 0 ? positionOf(original, marks[0].offset) : null,
    toOriginal: originalPositions(original, marks),
    doc,
    elements,
    html,
    head,
    body,
    main,
    ids,
    title: textOfFirst(headElements, (element) => element.name === 'title'),
    description: collapse((description && attr(description, 'content')) || ''),
    sections: main ? topSections(main) : [],
    labels: new Map(numbered.map(({ element, label }) => [attr(element, 'id'), label]).filter(([id]) => id)),
    quizzes: elements.filter((element) => is(element, 'div', 'quiz'))
  };
}

/** 有编号的小节（带 id、不是小结），按顺序排列。 */
function numberedSections(lesson) {
  return lesson.sections.filter((section) => !isRecap(section) && attr(section, 'id'));
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

/** 估算阅读时长（分钟）：汉字、西文单词、代码行和小测各有各的速度。 */
function readingMinutes(lesson) {
  if (!lesson.main) return 1;
  const prose = textExcept(lesson.main, (element) => element.name === 'pre');
  const codeLines = [...descendants(lesson.main)]
    .filter((element) => element.name === 'pre')
    .reduce((sum, pre) => sum + codeLineCount(pre), 0);
  const minutes =
    countMatches(prose, /\p{Script=Han}/gu) / 400 +
    countMatches(prose, /[A-Za-z0-9]+/g) / 220 +
    codeLines / 20 +
    lesson.quizzes.length * 0.5;
  return Math.max(1, Math.ceil(minutes));
}

/** 正文的字数：汉字加西文单词，代码和公式的源码不算。写作要求常常按字数提，outline 把它报出来。 */
function wordCount(lesson) {
  if (!lesson.main) return 0;
  const prose = textExcept(lesson.main, (element) => element.name === 'pre' || hasClass(element, 'math'));
  return countMatches(prose, /\p{Script=Han}/gu) + countMatches(prose, /[A-Za-z0-9]+/g);
}

function sectionTitle(section) {
  const heading = sectionHeading(section);
  return heading ? collapse(textOf(heading)) : '';
}

/** 一讲里每道小测在页面上的键：作者写了 id 就是 id，否则是题干文字的哈希。运行时算出来的是同一个，agree.e2e.js 核对。 */
const quizKeys = (lesson) => lesson.quizzes.map((quiz) => attr(quiz, 'id') || `q${hash(quizParts(quiz).stemText)}`);

/** data.js 里这一讲的目录条目。code 和 math 告诉加载器这一页要不要提前引入代码着色和公式的库。 */
function lessonEntry(lesson) {
  return {
    title: lesson.title,
    description: lesson.description,
    minutes: readingMinutes(lesson),
    sections: numberedSections(lesson).map((section) => ({ id: attr(section, 'id'), title: sectionTitle(section) })),
    labels: Object.fromEntries(lesson.labels),
    quizzes: lesson.quizzes.length,
    quizKeys: quizKeys(lesson),
    code: lesson.elements.some((element) => element.name === 'pre'),
    math: lesson.elements.some((element) => hasClass(element, 'math'))
  };
}

// 这些不进搜索索引。提示、解析和例题解答：搜到它们等于提前看到答案。图：里面的文字是坐标和标签，不是正文。
function isUnindexed(element) {
  return (
    hasClass(element, 'hint') ||
    hasClass(element, 'explain') ||
    is(element, 'details', 'answer') ||
    element.name === 'svg'
  );
}

/* 公式在索引里只有一个占位符：直接去掉的话，它前后的两个标点会拼在一起，摘录里就成了“发生：，。” */
const FORMULA = '￼';

// 另起一块的地方：块级元素、单元格、表题和换行。
function startsNewBlock(element) {
  return isBlock(element) || ['td', 'th', 'caption', 'br'].includes(element.name);
}

/** 搜索用的文字：每一块的两头各补一个空格，免得相邻两块（两个单元格、两个列表项）的字粘在一起。 */
function indexText(node) {
  if (isText(node)) return node.value;
  if (hasClass(node, 'math')) return ` ${FORMULA} `;
  if (!node.children || isUnindexed(node)) return '';
  const text = node.children.map(indexText).join('');
  return startsNewBlock(node) ? ` ${text} ` : text;
}

function searchText(nodes) {
  // 公式前后紧挨着它本身写的那点空白收掉：占位符自己已经隔开了两个字，再多一个空格只是给摘录添乱
  const text = nodes.map(indexText).join('');
  return collapse(text.replaceAll(/ ?￼ ?/gu, FORMULA));
}

/** data.js 里这一讲的搜索条目：导语部分一条，每个小节一条。 */
function searchEntries(lesson) {
  const { file, main, sections } = lesson;
  if (!main) return [];
  const introEnd = sections.length ? main.children.indexOf(sections[0]) : main.children.length;
  const intro = main.children.slice(0, introEnd).filter((node) => node.name !== 'h1');
  const entries = [{ file, id: '', title: lesson.title, text: searchText(intro) }];
  for (const section of sections) {
    const heading = sectionHeading(section);
    entries.push({
      file,
      id: sectionAnchor(section),
      title: sectionTitle(section),
      text: searchText(section.children.filter((node) => node !== heading))
    });
  }
  return entries;
}

module.exports = { loadLesson, numberedSections, lessonEntry, wordCount, searchEntries };
