'use strict';
/* 标记的合法性：浏览器会悄悄改写的嵌套、契约之外的类名、提示卡的类型。 */
const { getAttr, classesOf, hasClass, childElements, significantChildren, firstBlockInside } = require('./dom');
const { CALLOUTS, SVG_COLORS } = require('./contract');

const CALLOUT_TYPES = Object.keys(CALLOUTS);
// 别处常见、这里没有的提示卡类型名，以及契约里对应的那一个
const CALLOUT_SYNONYMS = {
  tip: 'insight',
  hint: 'insight',
  info: 'note',
  warning: 'pitfall',
  caution: 'pitfall',
  error: 'danger',
  important: 'memory'
};
const CLASSES = new Set([
  ...CALLOUT_TYPES,
  'lead',
  'goals',
  'recap',
  'callout',
  'answer',
  'math',
  'code-notes',
  'num',
  'figures',
  'steps',
  'flow',
  'timeline',
  'tree',
  'cards',
  'example',
  'quiz',
  'hint',
  'explain',
  'stepper',
  'cells',
  'on',
  'hit',
  'off',
  'tabs',
  'tasks',
  't-title',
  't-small',
  't-mono',
  'w1',
  'w2',
  'dash',
  ...SVG_COLORS.flatMap((color) => [`f-${color}`, `s-${color}`])
]);

// 表格里各层只能直接包含这些元素；别的内容会被浏览器挪到表格外面。
const TABLE_CHILDREN = new Map([
  ['table', ['caption', 'colgroup', 'thead', 'tbody', 'tfoot', 'tr']],
  ['thead', ['tr']],
  ['tbody', ['tr']],
  ['tfoot', ['tr']],
  ['tr', ['th', 'td']]
]);

function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      next.push(Math.min(row[j] + 1, next[j - 1] + 1, substitution));
    }
    row = next;
  }
  return row[b.length];
}

/** 与 name 最接近的合法类名（编辑距离不超过 2）；没有就返回 undefined。 */
function closestClass(name) {
  let best;
  let bestDistance = 3;
  for (const candidate of CLASSES) {
    const distance = editDistance(name, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function checkClasses(element, report) {
  const callout = hasClass(element, 'callout');
  for (const name of classesOf(element)) {
    // 提示卡上不认识的类名多半是写错的类型，由下面的 callout/type 统一说明
    if (!CLASSES.has(name) && !callout) {
      const hint = closestClass(name);
      const advice = hint ? `；是不是想写 ${hint}？` : '；不要自创类名';
      report.warn(getAttr(element, 'class'), 'class/unknown', `契约里没有 ${name} 这个类名${advice}`);
    }
  }
  if (!callout) return;
  const types = classesOf(element).filter((name) => CALLOUT_TYPES.includes(name));
  if (!['div', 'details'].includes(element.name) || types.length !== 1) {
    const written = classesOf(element).find((name) => CALLOUT_SYNONYMS[name]);
    const advice = written ? `这里写的 ${written} 对应契约里的 ${CALLOUT_SYNONYMS[written]}。` : '';
    report.error(
      element,
      'callout/type',
      `${advice}提示卡要写成 <div> 或 <details>，并且带且只带一个类型：${CALLOUT_TYPES.join('、')}`
    );
  }
}

function checkTableChildren(element, report) {
  const allowed = TABLE_CHILDREN.get(element.name);
  if (!allowed) return;
  for (const child of significantChildren(element)) {
    if (!allowed.includes(child.name)) {
      const list = allowed.map((name) => `<${name}>`).join('、');
      report.error(child, 'table/structure', `<${element.name}> 里只能直接放 ${list}`);
    }
  }
}

function checkNesting(element, report) {
  if (element.name === 'p') {
    const block = firstBlockInside(element);
    if (block) report.error(block, 'html/p-block', `<p> 里不能放块级元素 <${block.name}>：先用 </p> 结束段落`);
  }
  if (element.name === 'details') {
    const [first] = childElements(element);
    if (!first || first.name !== 'summary') {
      report.error(element, 'details/summary', '<details> 的第一个子元素必须是 <summary>');
    }
  }
  checkTableChildren(element, report);
}

function checkMarkup(lesson, report) {
  for (const element of lesson.elements) {
    checkNesting(element, report);
    checkClasses(element, report);
  }
}

module.exports = { checkMarkup };
