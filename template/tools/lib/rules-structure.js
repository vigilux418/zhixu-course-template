'use strict';
/* 页面结构：唯一的 <main> 与 <h1>、导语、学习目标、小节、小结，以及 id。 */
const { getAttr, hasClass, childElements, significantChildren } = require('./dom');
const { isEngineId, isRecap, sectionHeading } = require('./anatomy');
const { FILE_START } = require('./report');

const ID_FORMAT = /^[a-z][a-z0-9-]*$/;
// 只能出现在第一个小节之前的两个部分：类名、标签、规则、称呼。
const INTRO_PARTS = [
  ['lead', 'p', 'lead/position', '导语'],
  ['goals', 'ul', 'goals/position', '学习目标']
];

function checkMain(lesson, report) {
  const { body, main } = lesson;
  if (!main) {
    report.error(body || FILE_START, 'main/one', '缺少 <main>：正文要放在 <body> 直属的 <main> 里');
    return;
  }
  for (const element of lesson.elements) {
    if (element.name === 'main' && (element !== main || element.parent !== body)) {
      report.error(element, 'main/one', '全页只能有一个 <main>，并且直接放在 <body> 里');
    }
  }
  for (const node of body ? significantChildren(body) : []) {
    if (node.name !== 'main') report.error(node, 'main/one', '<body> 里只能有 <main>，其他内容请移到 <main> 里面');
  }
}

function checkHeading(lesson, report) {
  const headings = lesson.elements.filter((element) => element.name === 'h1');
  const [first] = childElements(lesson.main);
  if (headings.length === 0) report.error(lesson.main, 'main/h1', '<main> 的第一个元素必须是 <h1>');
  for (const heading of headings) {
    if (heading !== first) report.error(heading, 'main/h1', '全页只能有一个 <h1>，并且是 <main> 的第一个元素');
  }
}

function checkIntroParts(lesson, report) {
  const { main } = lesson;
  const firstSection = main.children.indexOf(lesson.sections[0]);
  const beforeSections = (element) => firstSection === -1 || main.children.indexOf(element) < firstSection;
  for (const [className, tag, rule, label] of INTRO_PARTS) {
    const found = lesson.elements.filter((element) => hasClass(element, className));
    found.forEach((element, index) => {
      const ok = index === 0 && element.name === tag && element.parent === main && beforeSections(element);
      if (!ok) {
        report.error(
          element,
          rule,
          `${label}最多一个，写成 <${tag} class="${className}">，直接放在 <main> 里、第一个小节之前`
        );
      }
    });
  }
}

function checkRecap(lesson, report) {
  const last = childElements(lesson.main).pop();
  const recaps = lesson.elements.filter((element) => hasClass(element, 'recap'));
  recaps.forEach((element, index) => {
    if (index > 0 || element.name !== 'section' || element !== last) {
      report.error(
        element,
        'recap/position',
        '小结最多一个，写成 <section class="recap">，并且是 <main> 的最后一个元素'
      );
    }
  });
}

function checkSections(lesson, report) {
  const { main, sections } = lesson;
  for (const section of sections) {
    if (!isRecap(section) && getAttr(section, 'id') === undefined) {
      report.error(section, 'section/id', '小节必须有 id，如 <section id="idea">');
    }
    if (!sectionHeading(section)) report.error(section, 'section/h2', '小节必须以 <h2> 开头');
  }
  for (const element of lesson.elements) {
    const isHeading = sections.includes(element.parent) && sectionHeading(element.parent) === element;
    if (element.name === 'h2' && !isHeading) {
      report.error(element, 'section/h2', '<h2> 只用作小节的标题，每个小节开头一个；小节内部的小标题用 <h3>');
    }
    if (element.name === 'section' && element.parent !== main) {
      report.error(element, 'section/nested', '<section> 只能直接放在 <main> 里，不能嵌套或放在别处');
    }
  }
}

function checkIds(lesson, report) {
  for (const element of lesson.elements) {
    const id = getAttr(element, 'id');
    if (!id) continue;
    const first = lesson.ids.get(id.value);
    if (!ID_FORMAT.test(id.value)) {
      report.error(id, 'id/format', `id="${id.value}" 不合规：要以小写字母开头，只用小写字母、数字和连字符`);
    } else if (isEngineId(id.value)) {
      report.error(id, 'id/reserved', `id="${id.value}" 不可用：zx- 开头的 id 留给引擎`);
    }
    if (first !== element) {
      report.error(id, 'id/duplicate', `id="${id.value}" 重复：第 ${first.line} 行已经用过`);
    }
  }
}

function checkStructure(lesson, report) {
  checkMain(lesson, report);
  checkIds(lesson, report);
  if (!lesson.main) return;
  checkHeading(lesson, report);
  checkIntroParts(lesson, report);
  checkRecap(lesson, report);
  checkSections(lesson, report);
}

module.exports = { checkStructure };
