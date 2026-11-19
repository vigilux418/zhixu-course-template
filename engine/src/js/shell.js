/* 外壳：页眉、课程目录（宽屏为侧栏，窄屏为抽屉）、阅读进度。 */

import { $, $$, h, icon, root, tool, wideScreen } from './dom.js';
import { course, lessons, page } from './course.js';
import { panel, show } from './dialogs.js';
import { onClear, pageSignal } from './boot.js';
import { record, setPref } from './store.js';

/** 页眉。actions: { search, settings, notes? }；首页没有目录按钮、书眉和打印。每一页都重做一遍。 */
export function buildHeader(actions) {
  const find = h(
    'button.zx-tool.zx-find',
    { type: 'button', 'aria-label': '搜索' },
    icon('search'),
    h('span', null, '搜索'),
    h('kbd', null, '/')
  );
  find.addEventListener('click', actions.search);

  const running = h('button.zx-running', { type: 'button', title: '回到顶部' });
  running.addEventListener('click', () => scrollTo({ top: 0 }));

  const header = h(
    'header.zx-header',
    null,
    !page.home && tool('menu', '目录', toggleNav),
    h('a.zx-brand', { href: ZHIXU.url('index.html') }, icon('stairs'), h('span', null, course.title)),
    !page.home && running,
    h(
      'div.zx-tools',
      null,
      find,
      actions.notes && tool('note', '本讲笔记', actions.notes),
      !page.home && tool('print', '打印本讲', () => print(), '.zx-tool--wide'),
      tool('type', '外观与设置', actions.settings)
    )
  );
  const main = $('main') ?? $('.zx-home'); // 首页的正文不是 <main> 而是 .zx-home
  main.id ||= 'zx-main'; // “跳到正文”要有个落点；作者给 <main> 写了 id 就用作者的
  // 它不走地址（单文件里 # 后面写的是“哪一页”，不是页内的 id）：点它，焦点直接交给正文，
  // 接着按 Tab 就从正文里的第一个控件开始。落点到点的时候再找：首页的正文是后来才建的
  const skip = h('a.zx-skip', { href: `#${main.id}` }, '跳到正文');
  skip.addEventListener('click', (event) => {
    event.preventDefault();
    const target = document.getElementById(skip.hash.slice(1));
    target.tabIndex = -1;
    target.focus();
  });
  // 单文件里换页时整组换掉：上一页的目录按钮、书眉、打印都是上一页的
  $('.zx-skip')?.remove();
  $('.zx-header')?.remove();
  $('.zx-progress')?.remove();
  document.body.prepend(skip, header, h('div.zx-progress', { 'aria-hidden': 'true' }));
}

/** 课程目录树。当前这一讲展开，列出本讲小节。 */
function navTree(sections) {
  const done = record().done;
  const groups = course.units.map((unit) => {
    const items = lessons
      .filter((lesson) => lesson.unit === unit)
      .map((lesson) => {
        const current = lesson === page.lesson;
        const link = h(
          `a.zx-nav-link${done[lesson.file] ? '.is-done' : ''}`,
          { href: ZHIXU.url(lesson.file), 'data-file': lesson.file, 'aria-current': current && 'page' },
          h('span.zx-nav-n', null, String(lesson.number)),
          h('span', null, lesson.title)
        );
        const toc = sections.map((section) =>
          h(
            'li',
            null,
            h(
              'a',
              { href: ZHIXU.url(page.file, section.id), 'data-section': section.id },
              `${section.number} ${section.title}`.trim()
            )
          )
        );
        return h('li', null, link, current && h('ol.zx-toc', null, toc));
      });
    return [unit.title && h('p.zx-nav-unit', null, unit.title), h('ol', null, items)];
  });
  return h('div.zx-nav', null, groups);
}

let drawer;
let outline = []; // 当前这一讲的小节；抽屉第一次打开时用它建目录
let activeId; // 正在阅读的小节

function paintActive() {
  for (const link of $$('[data-section]')) link.classList.toggle('is-active', link.dataset.section === activeId);
}

/** 目录按钮：宽屏收起或展开侧栏，窄屏打开抽屉。 */
function toggleNav() {
  if (wideScreen.matches) {
    const on = root.dataset.side !== 'on';
    root.dataset.side = on ? 'on' : 'off';
    setPref('side', on);
    return;
  }
  if (!drawer) {
    drawer = panel('zx-dialog.zx-dialog--drawer', '目录', h('div.zx-dialog-body', null, navTree(outline)));
    drawer.addEventListener('click', (event) => {
      if (event.target.closest('a')) drawer.close();
    });
    paintActive();
    // 抽屉里的目录是这一页的（展开的是这一讲的小节）：单文件里换页时收掉，下一页要用再建
    onClear(() => {
      drawer.remove();
      drawer = undefined;
    });
  }
  show(drawer);
  revealCurrent($('.zx-dialog-body', drawer));
}

/** 把当前这一讲滚到目录里看得见的地方（离顶部三分之一处）。没有登记到课程里的页面，目录里没有它。 */
function revealCurrent(scroller) {
  const current = $('[aria-current="page"]', scroller);
  if (!current) return;
  const offset = current.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  scroller.scrollTop += offset - scroller.clientHeight / 3;
}

/** 在正文左侧放上目录栏，并把当前这一讲滚到栏内可见处。 */
export function buildSidebar(main, sections) {
  outline = sections;
  const side = h('nav.zx-side', { 'aria-label': '课程目录' }, navTree(sections));
  main.before(side);
  root.dataset.side = ZHIXU.prefs().side ? 'on' : 'off';
  onClear(() => delete root.dataset.side); // 首页没有目录栏：留着它，首页的版面会按有目录栏来排
  revealCurrent(side);
}

/** 读完或取消读完后，同步目录里的小印。 */
export function markDone(file, done) {
  for (const link of $$(`.zx-nav-link[data-file="${file}"]`)) link.classList.toggle('is-done', done);
}

/** 滚动时更新进度线、收放页眉，并报告当前所在的小节（标题之前为 undefined）。 */
export function trackReading(sections, onSection) {
  const headerHeight = parseFloat(getComputedStyle(root).getPropertyValue('--header-h'));
  const head = $('.zx-head');
  const progress = $('.zx-progress');
  const marks = sections.map((section) => document.getElementById(section.id));
  let lastY = scrollY;
  let active = -2;
  let queued = false;

  const measure = () => {
    queued = false;
    const y = scrollY;
    const span = root.scrollHeight - innerHeight;
    // 直接写在进度线上。写成根元素上的变量的话，每滚一帧整页的样式都要重算一遍（实测 7 到 29 毫秒）
    progress.style.scale = `${span > 0 ? Math.min(1, y / span) : 0} 1`;
    root.classList.toggle('zx-past', head.getBoundingClientRect().bottom < headerHeight);
    if (Math.abs(y - lastY) > 6) {
      root.classList.toggle('zx-away', y > lastY && y > 240);
      lastY = y;
    }
    // 滚到页面底部时，最后一节就是当前这一节：它可能很短，标题永远到不了视口上沿
    const atEnd = span > 0 && y >= span - 1;
    const index = atEnd
      ? marks.length - 1
      : marks.findLastIndex((mark) => mark.getBoundingClientRect().top < headerHeight + 96);
    if (index === active) return;
    active = index;
    activeId = sections[index]?.id;
    paintActive();
    onSection(sections[index]);
  };

  addEventListener(
    'scroll',
    () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(measure);
    },
    { passive: true, signal: pageSignal() }
  );
  onClear(() => root.classList.remove('zx-past', 'zx-away')); // 下一页从顶上开始：页眉露出来，书眉藏起来
  measure();
}

export function setRunningHead(text) {
  $('.zx-running').textContent = text;
}
