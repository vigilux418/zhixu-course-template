'use strict';
/* 交互组件：小测、步进演示、选项卡、任务清单，以及旁注和术语的写法。 */
const {
  attrText,
  getAttr,
  hasClass,
  is,
  isText,
  childElements,
  descendants,
  textOf,
  firstBlockInside,
  closest
} = require('./dom');
const { quizParts, termOf } = require('./anatomy');

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

function checkChoices(quiz, options, report) {
  const items = childElements(options);
  if (items.length < 2 || items.some((item) => item.name !== 'li')) {
    report.error(options, 'quiz/options', '选项要写成 <ol>，里面至少两个 <li>');
    return;
  }
  // 直属的 <ol> 就是选项。填空题和自评题的题干里想放编号列表时，要把它包进一个 <div>
  const wrap = '如果这个 <ol> 是题干的一部分而不是选项，把它包进一个 <div>';
  const answer = getAttr(quiz, 'data-answer');
  if (!answer) {
    report.error(
      quiz,
      'quiz/answer',
      `这道题直属的 <ol> 会被当成选项，所以要用 data-answer 标出正确选项，如 data-answer="b"。${wrap}`
    );
    return;
  }
  const letters = answer.value.split(',');
  const valid = letters.every((letter, index) => {
    const position = letter.length === 1 ? LETTERS.indexOf(letter) : -1;
    return position !== -1 && position < items.length && (index === 0 || letters[index - 1] < letter);
  });
  if (!valid) {
    const last = LETTERS[items.length - 1];
    report.error(
      answer,
      'quiz/answer',
      `这道题直属的 <ol> 会被当成选项，所以 data-answer 要写成选项字母，多选用逗号隔开并按顺序排列（如 "a,c"）；选项是 a–${last}。${wrap}`
    );
  }
}

function checkAnswerKind(quiz, parts, report) {
  const answer = getAttr(quiz, 'data-answer');
  if (parts.options) {
    checkChoices(quiz, parts.options, report);
  } else if (answer && answer.value !== '') {
    if (answer.value.split('|').some((alternative) => alternative.trim() === '')) {
      report.error(answer, 'quiz/answer', '填空题的 data-answer 里，用 | 分开的每个答案都不能为空');
    }
  } else if (parts.explains.length === 0) {
    report.error(quiz, 'quiz/explain', '没有选项也没有 data-answer 的是自评题，必须有 .explain 供读者对照');
  }
}

function checkQuiz(quiz, report) {
  if (quiz.name !== 'div') {
    report.error(quiz, 'quiz/markup', '小测要写成 <div class="quiz">');
    return;
  }
  const parts = quizParts(quiz);
  const children = childElements(quiz);
  if (parts.stem.length === 0 || children[0] !== parts.stem[0]) {
    report.error(quiz, 'quiz/stem', '小测要以题干开头：题干写在 <p> 等元素里，放在选项、提示和解析之前');
  }
  for (const extra of [...parts.hints.slice(1), ...parts.explains.slice(1)]) {
    report.error(extra, 'quiz/parts', '一道小测最多一个 .hint 和一个 .explain');
  }
  for (const part of [...parts.hints, ...parts.explains]) {
    if (parts.options && children.indexOf(part) < children.indexOf(parts.options)) {
      report.error(part, 'quiz/parts', '提示和解析要写在选项后面');
    }
  }
  checkAnswerKind(quiz, parts, report);
}

function checkStepper(stepper, report) {
  const frames = childElements(stepper);
  if (stepper.name !== 'div' || frames.length < 2 || frames.some((frame) => frame.name !== 'figure')) {
    report.error(
      stepper,
      'stepper/frames',
      '步进演示要写成 <div class="stepper">，里面直接放至少两个 <figure>，每个是一帧'
    );
    return;
  }
  for (const frame of frames) {
    if (!childElements(frame).some((child) => child.name === 'figcaption')) {
      report.warn(frame, 'stepper/frames', '这一帧没有 <figcaption> 讲解');
    }
  }
}

function checkTabs(tabs, report) {
  const panels = childElements(tabs);
  const labels = panels.map((panel) => attrText(panel, 'data-tab'));
  const valid =
    tabs.name === 'div' &&
    panels.length >= 2 &&
    panels.every((panel) => panel.name === 'div') &&
    labels.every((label) => label !== '') &&
    new Set(labels).size === labels.length;
  if (!valid) {
    report.error(
      tabs,
      'tabs/panels',
      '选项卡要写成 <div class="tabs">，里面直接放至少两个 <div data-tab="名称">，名称不能为空或重复'
    );
  }
}

/** 树的连线是照着“<ul> 里的 <li>”画的：换成 <ol>，或者把类名写在别的元素上，就画不出来。 */
function checkTree(tree, report) {
  const ordered = [...descendants(tree)].find((element) => element.name === 'ol');
  if (tree.name !== 'ul' || ordered) {
    report.error(
      ordered ?? tree,
      'tree/markup',
      '树要写成 <ul class="tree">，子节点写成这一项里面的 <ul>（不用 <ol>）'
    );
  }
}

/** 任务的勾选状态按文字保存，所以同一讲里两条任务的文字不能相同。 */
function checkTasks(lesson, report) {
  const seen = new Set();
  for (const element of lesson.elements) {
    if (!is(element.parent, 'ul', 'tasks')) continue;
    const text = textOf(element).trim();
    if (seen.has(text)) report.error(element, 'tasks/duplicate', '同一讲里有两条文字完全相同的任务');
    seen.add(text);
  }
}

function checkInline(element, report) {
  if (is(element, 'span', 'note')) {
    const block = firstBlockInside(element);
    if (block) report.error(block, 'note/inline', `旁注里只能放行内内容，不能有 <${block.name}>`);
    // 序号贴在旁注前面那个字上。前面是空白（空格、换行），或者什么都没有，序号就和正文分开了，还会自己落到行首
    const siblings = element.parent.children;
    const before = siblings[siblings.indexOf(element) - 1];
    if (!before || (isText(before) && /\s$/.test(before.value))) {
      report.error(element, 'note/attach', '旁注要紧跟在它标注的词后面，中间不留空格和换行：序号是贴在前面那个字上的');
    }
    // 讲的标题和小节标题会进目录、书眉和搜索结果，注文不能混在里面
    const heading = closest(element, (node) => node.name === 'h1' || node.name === 'h2');
    if (heading) {
      report.error(
        element,
        'note/heading',
        `<${heading.name}> 里不能放旁注：标题的文字会原样进目录和书眉。把旁注挪到标题后面的正文里`
      );
    }
  }
  if (element.name === 'dfn') {
    const def = getAttr(element, 'data-def');
    if (termOf(element) === '' || (def && def.value.trim() === '')) {
      report.error(element, 'term/empty', '术语和它的定义（data-def）都不能为空');
    }
  }
}

function checkWidgets(lesson, report) {
  checkTasks(lesson, report);
  for (const element of lesson.elements) {
    if (hasClass(element, 'quiz')) checkQuiz(element, report);
    if (hasClass(element, 'stepper')) checkStepper(element, report);
    if (hasClass(element, 'tabs')) checkTabs(element, report);
    if (hasClass(element, 'tree')) checkTree(element, report);
    checkInline(element, report);
  }
}

module.exports = { checkWidgets };
