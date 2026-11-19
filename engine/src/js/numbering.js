/* 自动编号与引用：小节 2.1、图 2-1、表 2-1、例 2-1、式 2-1；
 * 文字留空的链接会被填上目标的编号。编号规则与 tools/zx.js 生成目录数据时一致。 */

import { $, $$ } from './dom.js';
import { lessonByFile, lessonName } from './course.js';

/** 给当前页编号。返回 { sections, labels }：小节列表与“id → 编号文字”的对照表。 */
export function numberLesson(main, lesson) {
  const prefix = lesson ? `${lesson.number}-` : '';
  const labels = new Map();
  if (lesson) $(':scope > h1', main).dataset.num = lesson.number;

  const sections = $$(':scope > section[id]:not(.recap)', main).map((section, index) => {
    const number = lesson ? `${lesson.number}.${index + 1}` : `${index + 1}`;
    const heading = $(':scope > h2', section);
    heading.dataset.num = number;
    labels.set(section.id, `${number} 节`);
    return { id: section.id, number, title: heading.textContent.trim() };
  });

  const series = [
    ['图', $$('figure', main).filter((figure) => $(':scope > figcaption', figure) && !figure.closest('.stepper'))],
    ['表', $$('table', main).filter((table) => $(':scope > caption', table))],
    ['例', $$('div.example', main)],
    ['式', $$('div.math[id]', main)]
  ];
  for (const [word, elements] of series) {
    elements.forEach((el, index) => {
      const label = `${word} ${prefix}${index + 1}`;
      const target = $(':scope > figcaption, :scope > caption', el) ?? el;
      target.dataset.label = word === '式' ? `(${prefix}${index + 1})` : label;
      if (el.id) labels.set(el.id, label);
    });
  }

  fillReferences(main, labels);
  return { sections, labels };
}

/** 文字留空的链接：填上“图 2-1”“2.1 节”“第 3 讲《标题》”。 */
function fillReferences(main, labels) {
  for (const link of $$('a[href]', main).filter((a) => !a.textContent.trim() && !a.children.length)) {
    const [file, id] = link.getAttribute('href').split('#');
    link.textContent = file ? remoteLabel(lessonByFile(file), id) : labels.get(id);
  }
}

function remoteLabel(lesson, id) {
  if (!id) return `${lessonName(lesson)}《${lesson.title}》`;
  const index = lesson.sections.findIndex((section) => section.id === id);
  return index < 0 ? lesson.labels[id] : `${lesson.number}.${index + 1} 节`;
}
