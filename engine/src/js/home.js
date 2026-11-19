/* 首页：左页封面（课程名、进度、继续阅读），右页目录、错题回顾与术语表。 */

import { $, h } from './dom.js';
import { course, lessonByFile, lessonName, lessons, minutesText, page, terms } from './course.js';
import { answersOf } from './record-shape.js';
import { record } from './store.js';
import { seal } from './seal.js';
import { stairPlan } from './stairs.js';
import { arrive, carryFind } from './find.js';
import { pageSignal } from './boot.js';

const REVIEW_ID = 'zx-review'; // “错题回顾”这一栏的锚点，封面上的入口指向它

/** 把首页建好，返回“就位”的函数：页面放行之后调用它。 */
export function renderHome() {
  const state = record();
  const isDone = (lesson) => Boolean(state.done[lesson.file]);
  const doneCount = lessons.filter(isDone).length;
  const allDone = doneCount === lessons.length;
  const last = lessonByFile(state.last);
  const target = allDone ? lessons[0] : last && !isDone(last) ? last : lessons.find((lesson) => !isDone(lesson));
  const started = doneCount > 0 || Boolean(last);
  // 按钮上的字分成一两截：一行放不下时从两截中间断开
  const goLabel = allDone
    ? ['从头重温']
    : started
      ? ['继续阅读', `${lessonName(target)} ${target.title}`]
      : ['开始阅读'];
  const wrong = wrongAnswers(state);

  const cover = h(
    'section.zx-cover',
    null,
    h('h1', null, course.title),
    course.subtitle && h('p.zx-cover-sub', null, course.subtitle),
    course.description && h('p.zx-cover-desc', null, course.description),
    stairs(isDone, allDone ? null : target),
    h(
      'p.zx-cover-stat',
      null,
      `共 ${lessons.length} 讲，${minutesText(lessons.reduce((sum, lesson) => sum + lesson.minutes, 0))}。`,
      doneCount > 0 && `已读 ${doneCount} 讲。`
    ),
    h(
      'a.zx-btn.zx-btn--primary.zx-cover-go',
      { href: ZHIXU.url(target.file) },
      goLabel.map((part) => h('span', null, part))
    ),
    // 错题回顾排在目录后面，课长了要滚很久才看得到：封面上留一个入口
    wrong.length > 0 &&
      h('a.zx-cover-review', { href: ZHIXU.url(page.file, REVIEW_ID) }, `${wrong.length} 道错题待回顾`),
    allDone && h('div.zx-cover-seal', null, seal('全书读毕')),
    course.author && h('p.zx-cover-author', null, course.author)
  );

  const row = (lesson) =>
    h(
      `a.zx-row${isDone(lesson) ? '.is-done' : ''}${lesson === target && !allDone ? '.is-next' : ''}`,
      { href: ZHIXU.url(lesson.file) },
      h('span.zx-row-n', null, String(lesson.number).padStart(2, '0')),
      h('span.zx-row-t', null, lesson.title),
      h('span.zx-row-m', null, isDone(lesson) ? '已读' : lesson.minutes > 0 && `${lesson.minutes} 分钟`),
      lesson.description && h('span.zx-row-d', null, lesson.description)
    );
  const units = course.units.map((unit) =>
    h(
      'section.zx-unit',
      null,
      unit.title && h('h3', null, unit.title),
      unit.description && h('p', null, unit.description),
      h(
        'ol',
        null,
        lessons.filter((lesson) => lesson.unit === unit).map((lesson) => h('li', null, row(lesson)))
      )
    )
  );

  const stale = lessons.some((lesson) => lesson.stale);
  const home = h(
    'div.zx-home',
    { id: 'zx-main', role: 'main' },
    stale &&
      h('p.zx-alert', { role: 'alert' }, '目录数据不是最新的：请在课程根目录运行 node template/tools/zx.js build'),
    h('div.zx-spread', null, cover, h('div.zx-contents', null, part('目录', units), review(wrong), glossary())),
    h('p.zx-colophon', null, '学习记录只保存在这台设备的浏览器里，可以在“外观与设置”里导出备份。')
  );
  $('main').replaceWith(home);

  // 地址里带着锚点（封面上的错题入口，或者从别处直接点过来）：这一页是现建的，要自己滚过去
  return () => {
    arrive();
    addEventListener('hashchange', arrive, { signal: pageSignal() });
  };
}

const part = (title, ...children) => h('section.zx-part', null, h('h2', null, title), children);

/**
 * 阶梯：每讲一级，点一级就进那一讲。读完的台阶是朱砂色（和印章同色），接下来要读的那一级上立着它的编号；
 * 一个单元的最后一级是个长一点的平台。分几段、每级多高、哪一级是平台，在 stairs.js 里算。
 * 它和旁边的目录是同一组链接，所以对读屏软件和键盘隐藏：同样的入口不必听两遍、多按一轮 Tab。
 */
function stairs(isDone, target) {
  const plan = stairPlan(lessons.map((lesson) => lesson.unit));
  const steps = lessons.map((lesson, index) => {
    const { level, landing } = plan.steps[index];
    const states = [isDone(lesson) && '.is-done', lesson === target && '.is-next', landing && '.is-landing'];
    const step = h(
      `a${states.filter(Boolean).join('')}`,
      { href: ZHIXU.url(lesson.file), tabindex: '-1' },
      h('b', null, String(lesson.number)),
      h('span', null, `${lessonName(lesson)}　${lesson.title}`)
    );
    step.style.setProperty('--n', level);
    return step;
  });
  const map = h(
    'div.zx-stairs',
    { 'aria-hidden': 'true' },
    Array.from({ length: plan.flights }, (unused, order) =>
      h('div.zx-flight', null, steps.slice(order * plan.size, (order + 1) * plan.size))
    )
  );
  map.style.setProperty('--rise', `${plan.rise}px`);
  return map;
}

/** 第一次没答对的小测：[{ lesson, entry }]，按讲次排列。只算这一版的课里现在还写着的题。 */
function wrongAnswers(state) {
  return lessons.flatMap((lesson) =>
    answersOf(state, lesson.file, lesson.quizKeys)
      .filter((entry) => !entry.ok)
      .map((entry) => ({ lesson, entry }))
  );
}

/** 错题回顾：点开回到原题重做。没有错题就没有这一栏。 */
function review(wrong) {
  if (wrong.length === 0) return null;
  const items = wrong.map(({ lesson, entry }) =>
    h(
      'li',
      null,
      h(
        'a',
        { href: ZHIXU.url(lesson.file, entry.id) },
        entry.stem,
        h('span', null, `${lessonName(lesson)}　${lesson.title}`)
      )
    )
  );
  const section = part('错题回顾', h('ul.zx-review', null, items));
  section.id = REVIEW_ID;
  return section;
}

function glossary() {
  const entries = [...terms]
    .sort((a, b) => a.term.localeCompare(b.term, 'zh-Hans-CN'))
    .map((entry) => {
      // 链到定义所在的那一小节，并把术语带过去，落地时标出来
      const link = h('a', { href: ZHIXU.url(entry.file, entry.id) }, entry.term);
      link.addEventListener('click', () => carryFind([entry.term.toLowerCase()], entry.file, entry.id));
      return h('div', null, h('dt', null, link), h('dd', null, entry.def));
    });
  return entries.length > 0 && part('术语表', h('dl.zx-glossary', null, entries));
}
