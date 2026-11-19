/* 一讲的页面：讲头、编号、正文组件、讲末盖章与上下讲、阅读位置。
 * renderLesson 分五段把页面改完，先后有讲究，各段开头写明了它依赖什么；最后交回一个“就位”的函数。 */

import { $, $$, h, icon, keyboardScrollable, today } from './dom.js';
import { course, lessonByFile, lessonName, lessons, minutesText, page } from './course.js';
import { record, update } from './store.js';
import { numberLesson } from './numbering.js';
import { enhanceCode } from './code.js';
import { enhanceMath } from './math.js';
import { tuneBreaks } from './keep.js';
import { enhanceNotes, enhanceTerms } from './margin.js';
import { enhanceQuizzes, quizScore, readQuizzes } from './quiz.js';
import { enhanceSteppers, enhanceTabs, enhanceTasks, readTasks } from './widgets.js';
import { enhanceFigures, refitOnResize } from './figures.js';
import { buildSidebar, markDone, setRunningHead, trackReading } from './shell.js';
import { seal } from './seal.js';
import { arrive } from './find.js';
import { pageSignal } from './boot.js';

/** 把这一讲的页面改完，返回“就位”的函数：页面放行之后调用它。 */
export async function renderLesson() {
  const main = $('main');
  const lesson = page.lesson;
  const file = page.file;
  const title = document.title;

  // 一、读取。小测和任务的键按作者写下的文字来算，要趁页面还没被改写时读出来。这一段不改动页面
  const quizzes = readQuizzes(main);
  const tasks = readTasks(main);

  // 二、编号。小节、图、表、例、式各自编号，留空的链接填上目标的编号；后面的组件会把这些文字搬来搬去
  const { sections } = numberLesson(main, lesson);
  const recap = $(':scope > section.recap', main);
  if (recap) recap.id ||= 'zx-recap';
  const outline = recap
    ? [...sections, { id: recap.id, number: '', title: $('h2', recap).textContent.trim() }]
    : sections;

  // 三、组件。把作者写的标记变成能用的组件；讲头和讲末也在正文栏里，一并在这里建
  enhanceNotes(main);
  enhanceTerms(main);
  enhanceSteppers(main);
  const placeTabs = enhanceTabs(main);
  enhanceTasks(main, tasks);
  enhanceFigures(main);
  $$('.cells', main).forEach(keyboardScrollable);
  routeLinks(main);
  linkHeadings(outline); // 引擎自己加的链接排在 routeLinks 之后：它只管作者写的
  const repaintFoot = buildFoot(main, lesson, quizzes);
  enhanceQuizzes(main, quizzes, repaintFoot);
  repaintFoot();
  buildHead(main, lesson, outline, { sections: sections.length, quizzes: quizzes.length });

  // 四、第三方库。代码着色和公式排版；它们排完，每一行有多宽才定下来，断行的调整紧跟其后
  await Promise.all([enhanceCode(main), enhanceMath(main)]);
  tuneBreaks(main);

  // 五、标题与记录。到这里页面改完了
  document.title = `${title} - ${course.title}`;
  update((data) => (data.last = file));

  // 就位。前面五段都不量尺寸：页面放行之前不占版面，量不出来；要量的事全在这里——目录栏滚到当前这一讲、
  // 现在读到哪一节、选项卡的指示条、落到锚点。它们连着做，浏览器排一次版就够，不用改一点排一遍
  const name = lesson ? `${lessonName(lesson)}　${title}` : title;
  return () => {
    buildSidebar(main, outline);
    trackReading(outline, (section) => {
      setRunningHead(section ? `${name}　${`${section.number} ${section.title}`.trim()}` : name);
      if (section) update((data) => (data.place[file] = section.id));
    });
    placeTabs();
    refitOnResize($('.zx-head', main));
    arrive();
    addEventListener('hashchange', arrive, { signal: pageSignal() });
  };
}

/** 作者写的链接：外部链接在新标签页打开；指向课程里某一页的，写法交给加载器。 */
function routeLinks(main) {
  for (const link of $$('a[href]', main)) {
    const href = link.getAttribute('href');
    const [file, id] = href.split('#');
    if (/^https?:\/\//.test(href)) {
      link.target = '_blank';
      link.rel = 'noopener';
    } else if (!file || file === 'index.html' || lessonByFile(file)) {
      // 首页和老式的「不带文件名、只有锚点」写法，都和讲义之间的链接一样交给加载器：单文件里才指得对
      link.href = ZHIXU.url(file || page.file, id);
    }
  }
}

/** 小节标题后面的链接：点击跳到这一节，也可以从链接的菜单复制目标地址。平时不显示。 */
function linkHeadings(outline) {
  for (const section of outline) {
    const label = `${section.number ? `${section.number} 节` : section.title}的链接`;
    const link = h('a.zx-anchor', { href: ZHIXU.url(page.file, section.id), 'aria-label': label }, icon('link'));
    $(':scope > h2', document.getElementById(section.id)).append(link);
  }
}

/** 讲头：讲次与单元、标题、导语、时长、上次读到的位置、学习目标。小节数和小测数是这一页现数的。 */
function buildHead(main, lesson, outline, counts) {
  const kicker =
    lesson &&
    h(
      'p.zx-kicker',
      null,
      h('span.zx-kicker-n', null, lessonName(lesson)),
      lesson.unit.title && h('span', null, lesson.unit.title)
    );
  const meta = h(
    'p.zx-meta',
    null,
    lesson && !lesson.stale && h('span', null, minutesText(lesson.minutes)),
    h('span', null, `${counts.sections} 个小节`),
    counts.quizzes > 0 && h('span', null, `${counts.quizzes} 道小测`)
  );

  const place = outline.findIndex((section) => section.id === record().place[page.file]);
  const resume =
    place > 0 &&
    !ZHIXU.anchor() &&
    h(
      'p.zx-resume',
      null,
      '上次读到 ',
      h(
        'a',
        { href: ZHIXU.url(page.file, outline[place].id) },
        `${outline[place].number} ${outline[place].title}`.trim()
      )
    );

  const head = h(
    'header.zx-head',
    null,
    kicker,
    $(':scope > h1', main),
    $(':scope > .lead', main),
    meta,
    resume,
    $(':scope > .goals', main)
  );
  main.prepend(head);
}

/** 讲末：盖章标记读完，下面是上一讲与下一讲。返回一个重绘函数，小测成绩变化时调用。 */
function buildFoot(main, lesson, quizzes) {
  const slot = h('button.zx-seal-slot', { type: 'button' });
  const heading = h('p.zx-finish-title');
  const detail = h('p.zx-finish-note');

  const paint = (fresh = false) => {
    const date = record().done[page.file];
    const score = quizScore(quizzes);
    slot.setAttribute('aria-pressed', String(Boolean(date)));
    slot.title = date ? '取消盖章' : '盖章，标记这一讲已读完';
    slot.replaceChildren(date ? seal('知序读毕', fresh) : '盖章');
    heading.textContent = date ? '这一讲读完了' : '读完了？盖个章';
    detail.textContent = [
      date ? `${date} 读毕` : '目录里会留下一枚小印',
      score.total && `小测答对 ${score.right} / ${score.total}`
    ]
      .filter(Boolean)
      .join('　');
    markDone(page.file, Boolean(date));
  };

  slot.addEventListener('click', () => {
    const saved = update((data) => {
      if (data.done[page.file]) delete data.done[page.file];
      else data.done[page.file] = today();
    });
    paint(true);
    if (!saved) detail.textContent = '没有记下来：浏览器不允许这个页面存储数据';
  });

  const link = (target, rel, label) =>
    target && h('a', { href: ZHIXU.url(target.file), rel }, h('span', null, label), target.title);
  const pager =
    lesson &&
    h(
      'nav.zx-pager',
      { 'aria-label': '上一讲与下一讲' },
      link(lessons[lesson.number - 2], 'prev', '上一讲'),
      link(lessons[lesson.number], 'next', '下一讲') ??
        link({ file: 'index.html', title: '回到目录' }, 'next', '全部读完')
    );

  main.append(h('footer.zx-foot', null, h('div.zx-finish', null, slot, h('div', null, heading, detail)), pager));
  return paint;
}
