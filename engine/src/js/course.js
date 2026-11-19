/* 课程模型：把手写的课程清单与工具生成的目录数据合成一份只读视图。 */

import { dict } from './plain.js';

const source = window.ZHIXU_COURSE;
const data = window.ZHIXU_DATA;

export const course = source;
export const terms = data.terms;
export const searchIndex = data.search;

/** 全部讲次，按阅读顺序排列；number 从 1 开始。目录数据缺失的讲次只有文件名。 */
export const lessons = source.units
  .flatMap((unit) => unit.lessons.map((file) => ({ file, unit })))
  .map((entry, index) => ({
    title: entry.file,
    description: '',
    minutes: 0,
    sections: [],
    labels: dict(),
    quizzes: 0,
    ...data.lessons[entry.file],
    ...entry,
    number: index + 1,
    stale: !data.lessons[entry.file]
  }));

/** 文件名为 file 的那一页：首页，或某一讲（未登记到清单的讲次没有 lesson）。 */
function viewOf(file) {
  return {
    file,
    home: file === 'index.html',
    lesson: lessons.find((lesson) => lesson.file === file)
  };
}

/** 当前页面。单文件里换页时由 showPage 换掉它的内容：对象本身不变，别处拿着的还是同一个。 */
export const page = viewOf(ZHIXU.file);

/** 换到 file 这一页。 */
export function showPage(file) {
  Object.assign(page, viewOf(file));
  ZHIXU.file = file;
}

export const lessonByFile = (name) => lessons.find((lesson) => lesson.file === name);

export const lessonName = (lesson) => `第 ${lesson.number} 讲`;

export function minutesText(minutes) {
  if (minutes < 60) return `约 ${minutes} 分钟`;
  const rest = minutes % 60;
  return `约 ${Math.floor(minutes / 60)} 小时${rest ? ` ${rest} 分钟` : ''}`;
}
