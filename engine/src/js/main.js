/* 入口：搭外壳、渲染首页或一讲、绑定快捷键和打印，最后放行显示。
 * 它是“解析完再执行、执行完才画第一帧”的脚本：这里同步做完的事，读者在第一帧就能看到。
 * 单文件里换页也从这里走（boot.js）：搜索、设置、快捷键、打印跟着整个会话，只建一次；别的每一页重搭。 */

import { $, $$, h, refreshScrollers, root } from './dom.js';
import { course, lessonName, lessons, page } from './course.js';
import { modalOpen } from './dialogs.js';
import { failed, rebuild, turn } from './boot.js';
import { buildHeader } from './shell.js';
import { renderHome } from './home.js';
import { renderLesson } from './lesson.js';
import { fitWide } from './figures.js';
import { setupSearch } from './search.js';
import { setupSettings } from './settings.js';
import { toggleNotes } from './notebook.js';

ZHIXU.started = true;
ZHIXU.onTurn = switchTo;

const FAVICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#2757c6" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h5v-5h5v-5h5V5h3"/></svg>';

const search = setupSearch();
const settings = setupSettings();
bindKeys();
bindPrint();

function boot() {
  document.head.append(h('link', { rel: 'icon', href: `data:image/svg+xml,${encodeURIComponent(FAVICON)}` }));
  return mount(() => turnSerial === 0);
}

/* 装配一次只做一趟。装配期间又换了地址，跳过排队的旧请求，只有最新一趟能就位。 */
let switching;
let turnSerial = 0;

/** 单文件里换到 file 这一页（地址变了，或者记录整份换掉了要重搭）。 */
function switchTo(file) {
  const serial = ++turnSerial;
  const current = () => serial === turnSerial;
  root.classList.remove('zx-ready');
  switching = switching
    .then(() => {
      if (current()) return turn(file, () => mount(current));
    })
    .catch((error) => {
      if (!current()) return;
      failed(error);
      root.classList.add('zx-ready');
    });
}

/**
 * 把这一页改完，再放行，放行之后才“就位”（滚到该在的地方、量目录栏）：放行之前页面不占版面，量不出东西。
 * 放行和就位是一口气做完的，中间浏览器没有机会把半成品画出来。
 */
async function mount(current) {
  buildHeader({ search, settings, notes: page.home ? null : toggleNotes });
  const settle = page.home ? renderHome() : await renderLesson();
  if (!current()) return;
  root.classList.remove('zx-loading');
  settle();
  await measure();
  if (current()) root.classList.add('zx-ready');
}

/** 先排一次版，浏览器才知道这一页要用哪些字体；等它们都到了，页面才算最终状态，再量要伸进页边的块。 */
async function measure() {
  void document.body.offsetHeight;
  await document.fonts.ready;
  fitWide();
  refreshScrollers();
}

/** 单键快捷键。输入文字时、浮层打开时都不响应；Ctrl/⌘ K 任何时候都能唤出搜索。 */
function bindKeys() {
  // 首页的 ] 就是“开始阅读 / 继续阅读”。现在是哪一页，要看按下的那一刻：单文件里换页不重新运行这里
  const forward = () => (page.home ? $('.zx-cover-go').click() : go(1));
  const keys = { '/': search, n: toggleNotes, '[': () => go(-1), ']': forward };

  addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      search();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || modalOpen()) return;
    if (event.target.closest('input, textarea, select, [contenteditable]')) return;
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  });
}

function go(offset) {
  const target = page.lesson && lessons[page.lesson.number - 1 + offset];
  if (target) ZHIXU.go(target.file);
}

/** 打印：备好页眉的文字；打印前换成浅色并展开所有折叠内容，打印后恢复原样。 */
function bindPrint() {
  let restore;
  addEventListener('beforeprint', () => {
    // 打印稿的页眉（print.css 里的页边框）：课程名，和这一讲的名字。首页和没有登记的页面没有后一样
    const lesson = page.lesson ? `${lessonName(page.lesson)}　${page.lesson.title}` : '';
    root.style.setProperty('--print-course', JSON.stringify(course.title));
    root.style.setProperty('--print-lesson', JSON.stringify(lesson));

    const theme = root.dataset.theme;
    const folds = $$('details').map((details) => ({ details, open: details.open, name: details.getAttribute('name') }));
    root.dataset.theme = 'light';
    for (const { details } of folds) {
      details.removeAttribute('name'); // 同名的一组一次只能开一个：先解除分组，才能全部展开
      details.open = true;
    }
    restore = () => {
      root.dataset.theme = theme;
      for (const { details, open, name } of folds) {
        details.open = open;
        if (name !== null) details.setAttribute('name', name);
      }
    };
  });
  addEventListener('afterprint', () => restore());
}

// 从“后退”的缓存里恢复出来的页面是旧的：别的页面可能已经改过学习记录
addEventListener('pageshow', (event) => {
  if (event.persisted) rebuild();
});

switching = boot().catch((error) => {
  if (turnSerial === 0) ZHIXU.fail(error.message);
});
