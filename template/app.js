/* 知序运行时（由 engine/build.js 生成，请勿直接修改；源码在 engine/src/js） */
(function () {
'use strict';
try {

// —— plain.js ——
/* 不碰页面的小工具：没有依赖，可以直接在 Node 里测试。 */

/** 没有原型的空对象：用作字典。 */
const dict = () => Object.create(null);

/** 键是数据里来的（小测 id、备份里的字段名）时，只认对象自己的键：JSON 读回来的对象没有原型上那些键可用。 */
const own = (object, key) => (Object.hasOwn(object, key) ? object[key] : undefined);

/**
 * 稳定的短哈希（FNV-1a），用来给没有 id 的小测和任务生成键。
 * 键存在读者的学习记录里：算法一改，读者答过的题、勾过的任务就都对不上了。
 */
function hash(text) {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value = Math.imul(value ^ text.charCodeAt(index), 0x01000193);
  }
  return (value >>> 0).toString(36);
}

// —— dom.js ——
/* DOM 小工具：查询、创建元素、图标、下载。 */


const root = document.documentElement;

/** 宽屏：放得下目录栏，页边可以停靠笔记。和样式表里 1280 的断点是同一个数。 */
const wideScreen = matchMedia('(min-width: 1280px)');

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

/** 输入法正在选字，这一下按键不是给页面的。Safari 上确认选字的那一下回车 isComposing 已经是 false，keyCode 还是 229。 */
const composing = (event) => event.isComposing || event.keyCode === 229;

/** 创建元素：h('a.zx-row', { href }, '文字', 子元素)。值为 null、undefined、false 的属性和子节点会被跳过。 */
function h(spec, attrs, ...children) {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag);
  if (classes.length) el.className = classes.join(' ');
  for (const [name, value] of Object.entries(attrs ?? dict())) {
    if (value === null || value === undefined || value === false) continue;
    el.setAttribute(name, value === true ? '' : value);
  }
  el.append(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false));
  return el;
}

/** 把一段 HTML 字符串解析成节点（只用于引擎自己拼出的标记）。 */
function parse(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.firstElementChild;
}

const ICONS = {
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  note: '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14.5 7.5l3 3"/>',
  print: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M7 14h10v6H7z"/>',
  type: '<path d="M3 18l5-12 5 12M5 14h6"/><circle cx="17.5" cy="14.5" r="3"/><path d="M20.5 11.5V18"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  prev: '<path d="M14.5 6l-6 6 6 6"/>',
  next: '<path d="M9.5 6l6 6-6 6"/>',
  expand: '<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/>',
  stairs: '<path d="M3 20h5v-5h5v-5h5V5h3" stroke-width="2.2"/>',
  link: '<path d="M10.5 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>'
};

function icon(name) {
  return parse(`<svg class="zx-icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`);
}

/** 图标按钮。 */
function tool(name, label, onClick, extraClass = '') {
  const button = h(`button.zx-tool${extraClass}`, { type: 'button', 'aria-label': label, title: label }, icon(name));
  button.addEventListener('click', onClick);
  return button;
}

/* 能横向滚动的区域（宽表格、长代码行、长公式、一排格子）要能用键盘滚动。
 * 内容放不下的时候才让它接受焦点，免得平白多出一批 Tab 停靠点。
 * 放不放得下会变：窗口变宽变窄时由 ResizeObserver 重看；字体到位之后内容的宽度也会变，启动的最后再看一遍。 */
const scrollers = new Set();

function refreshScrollers() {
  for (const el of scrollers) {
    if (el.scrollWidth > el.clientWidth) el.tabIndex = 0;
    else el.removeAttribute('tabindex');
  }
}

/** 换页时把上一页登记的收回来：换下来的正文不再占版面，也不必再观察它们。 */
function discardScrollers() {
  scrollerWatcher.disconnect();
  scrollers.clear();
}

const scrollerWatcher = new ResizeObserver(refreshScrollers);

function keyboardScrollable(el) {
  scrollers.add(el);
  scrollerWatcher.observe(el);
}

/* 有些内容平时藏着：收起的折叠块、没选中的选项卡、演示里别的帧、窄屏上没展开的旁注。
 * 组件用 revealable 登记“怎么把我亮出来”，reveal 沿着祖先一路亮上去。 */
const revealers = new WeakMap();

const revealable = (el, show) => revealers.set(el, show);

/** 把 el 亮出来：展开它所在的折叠块，切到它所在的选项卡或演示的那一帧。 */
function reveal(el) {
  for (let node = el; node; node = node.parentElement) {
    if (node.tagName === 'DETAILS') node.open = true;
    revealers.get(node)?.();
  }
}

/** 把文字存成文件交给浏览器下载。 */
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  h('a', { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

const today = () => new Date().toLocaleDateString('sv-SE');

// —— course.js ——
/* 课程模型：把手写的课程清单与工具生成的目录数据合成一份只读视图。 */


const source = window.ZHIXU_COURSE;
const data = window.ZHIXU_DATA;

const course = source;
const terms = data.terms;
const searchIndex = data.search;

/** 全部讲次，按阅读顺序排列；number 从 1 开始。目录数据缺失的讲次只有文件名。 */
const lessons = source.units
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
const page = viewOf(ZHIXU.file);

/** 换到 file 这一页。 */
function showPage(file) {
  Object.assign(page, viewOf(file));
  ZHIXU.file = file;
}

const lessonByFile = (name) => lessons.find((lesson) => lesson.file === name);

const lessonName = (lesson) => `第 ${lesson.number} 讲`;

function minutesText(minutes) {
  if (minutes < 60) return `约 ${minutes} 分钟`;
  const rest = minutes % 60;
  return `约 ${Math.floor(minutes / 60)} 小时${rest ? ` ${rest} 分钟` : ''}`;
}

// —— dialogs.js ——
/* 浮层：全部用原生 dialog。模态的浮层同一时刻只开一个；停靠在页边的笔记不是模态的，不在此列。 */


/** 创建一个浮层并挂到页面上；classes 形如 'zx-dialog.zx-dialog--search'。点击背景关闭。 */
function dialog(classes, ...children) {
  const el = h(`dialog.${classes}`, null, ...children);
  // 按下和抬起都落在背景上才算点了背景：在面板里拖选文字、拖到外面才松手，不该把面板关掉
  let pressedOnBackdrop = false;
  el.addEventListener('pointerdown', (event) => {
    pressedOnBackdrop = event.target === el;
  });
  el.addEventListener('click', (event) => {
    if (pressedOnBackdrop && event.target === el) el.close();
  });
  document.body.append(el);
  return el;
}

/** 带标题栏和关闭按钮的浮层。 */
function panel(classes, title, ...children) {
  const el = dialog(classes);
  const close = tool('close', '关闭', () => el.close());
  el.append(h('div.zx-dialog-head', null, h('h2', null, title), close), ...children);
  return el;
}

/** 以模态方式打开一个浮层，先关掉正开着的那个。 */
function show(el) {
  $('dialog:modal')?.close();
  // 模态浮层一开，页面停止滚动，滚动条连同给它留的位置就收起来了。页面因此宽了多少，
  // 样式就垫回去多少，版面不横移（overlays.css）
  const width = () => root.getBoundingClientRect().width;
  const before = width();
  el.showModal();
  root.style.setProperty('--scrollbar', `${width() - before}px`);
}

const modalOpen = () => Boolean($('dialog:modal'));

// —— boot.js ——
/* 在页面里换页：单文件里换到另一讲时，从已经载入的数据里替换属于“这一页”的部分。
 * 跟着整个会话走的（搜索和设置的浮层、快捷键、打印）只建一次；属于一页的（正文、目录栏、这一页的全局监听、
 * 观察器、根元素上这一页的状态）换页时收拾干净：全局监听带上 pageSignal()，别的由各自的模块用 onClear 登记。
 * 检验的办法是：换页换到的一页，和直接打开的同一页一模一样（packed.e2e.js）。 */


let scope = new AbortController(); // 这一页的全局监听；换页时整批撤掉，下一页换一个新的
const cleanups = []; // 换页之前要做的事，这一页的模块自己登记

/** 属于这一页的全局监听要带上的 signal。 */
const pageSignal = () => scope.signal;

/** 登记换页之前要做的一件事。只对这一页有效：做完就忘掉，下一页要的话自己再登记。 */
const onClear = (cleanup) => cleanups.push(cleanup);

/* 一页的正文：讲页是 <main>，首页是 renderHome 换上去的 .zx-home */
const bodyOf = () => $('main') ?? $('.zx-home');

/** 换到 to 这一页（单文件里：它的正文就在已经读进来的数据里），render 负责把它搭起来。 */
async function turn(to, render) {
  scope.abort();
  scope = new AbortController();
  for (const cleanup of cleanups.splice(0)) cleanup();
  $('dialog:modal')?.close();
  discardScrollers();
  showPage(to);
  const next = document.createElement('template');
  next.innerHTML = ZHIXU.body(to); // 这一段数据就是一整块 <main>
  $('.zx-side')?.remove();
  bodyOf().replaceWith(next.content);
  document.title = ZHIXU.title(to);
  root.classList.add('zx-loading');
  scrollTo(0, 0);
  await render();
}

/** 这一页没能搭起来：和启动失败一样，正文照常显示，顶上说明原因。说明写在正文里，换到下一页就没了。 */
function failed(error) {
  console.error(error);
  root.classList.remove('zx-loading');
  bodyOf().prepend(h('p.zx-alert', { role: 'alert' }, `这一页没有正常显示：${error.message}。正文仍可阅读。`));
}

/** 记录整份换掉了，页面上的进度、小测、笔记都要按存储里最新的重来：文件夹里刷新这一页；
 * 单文件里使用已载入的数据重搭这一页。 */
function rebuild() {
  if (ZHIXU.packed) ZHIXU.onTurn(ZHIXU.file);
  else location.reload();
}

// —— record-shape.js ——
/* 学习记录的形状：只在这里定义一次（FIELDS），空白记录、备份的校验都从它出发。
 * 这里都是纯函数，不碰页面和存储，可以直接在 Node 里测试。 */


const isText = (value) => typeof value === 'string';
const isList = (isItem) => (value) => Array.isArray(value) && value.every(isItem);
const isMap = (isItem) => (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(isItem);
const isAnswer = (value) =>
  isMap(() => true)(value) && typeof value.ok === 'boolean' && [value.at, value.stem, value.id].every(isText);

/* 字段名 → [空值怎么造, 值合不合格]。
 * 这一讲现在有哪些小测不记在这里：它是课程内容的属性，由 data.js 提供，见 answersOf。 */
const FIELDS = {
  done: [dict, isMap(isText)], // 文件名 → 读完的日期
  place: [dict, isMap(isText)], // 文件名 → 上次读到的小节 id
  quiz: [dict, isMap(isMap(isAnswer))], // 文件名 → { 小测键: { ok, at, stem, id } }
  tasks: [dict, isMap(isList(isText))], // 文件名 → 已勾选的任务键
  notes: [dict, isMap(isText)], // 文件名 → 笔记正文
  tabs: [() => [], isList(isText)], // 最近选过的选项卡名，新的在前
  last: [() => null, (value) => value === null || isText(value)] // 最近打开的一讲
};

/* 早先的版本把每讲的题目清单也存在记录里（data.js 现在自己带着，见 answersOf）。
 * 那时的备份文件里还有这个字段：认得、也照样校验，但恢复时丢掉。格式和 FIELDS 一样，好一起查。 */
const LEGACY = { quizKeys: [dict, isMap(isList(isText))] };

/** 把一份可能缺字段的记录补全（没有记录时给 null）；不认识的旧字段不带走。 */
const filled = (data) => {
  const source = data ?? dict();
  return Object.fromEntries(
    Object.entries(FIELDS).map(([field, [empty, fits]]) => {
      const value = own(source, field);
      return [field, fits(value) ? value : empty()];
    })
  );
};

/** 一份来自外面的数据（备份文件）是不是合格的记录：每个字段都认识，值都合格。 */
const isRecord = (data) => {
  if (!isMap(() => true)(data)) return false;
  return Object.entries(data).every(([field, value]) => {
    const known = own(FIELDS, field) ?? own(LEGACY, field);
    return Boolean(known) && known[1](value);
  });
};

/** 某一讲里仍然有效的小测记录：题目改过或删掉之后，旧记录留在存储里，但不再计入。
 * 这一讲现在有哪些题，看的是当前这一版的 data.js：另一版课打开过，也不会借来它的题目清单。 */
function answersOf(data, file, keys) {
  return Object.entries(data.quiz[file] ?? dict())
    .filter(([key]) => !keys || keys.includes(key))
    .map(([, answer]) => answer);
}

// —— store.js ——
/* 学习记录的读写：每门课一份，存在浏览器本地。记录长什么样，在 record-shape.js 里。
 * 每次修改都先读后写，所以同时开着几个标签页，别的字段也不会丢。 */


const KEY = `zhixu:course:${course.id}`;

function record() {
  return filled(ZHIXU.read(KEY));
}

let warned = false;

/** 写入；浏览器不允许存储时返回 false，并在页面顶部说明一次。 */
function persist(data) {
  const saved = ZHIXU.write(KEY, data);
  if (!saved && !warned) {
    warned = true;
    const text = '学习记录无法保存：浏览器不允许这个页面存储数据。阅读不受影响，但进度、小测和笔记不会留下来。';
    document.body.prepend(h('p.zx-alert', { role: 'alert' }, text));
  }
  return saved;
}

/** 修改记录：先读最新的，改完再写。返回是否写入成功。 */
function update(change) {
  const data = record();
  change(data);
  return persist(data);
}

/** 整份替换（恢复备份）；传入 null 即清空。返回是否写入成功。 */
const saveRecord = persist;

/** 别的标签页改了这门课的记录时，调用 listener。signal 跟着调用它的那一页一起失效。 */
function onRemoteChange(listener, signal) {
  addEventListener(
    'storage',
    (event) => {
      if (event.key === KEY) listener();
    },
    { signal }
  );
}

function setPref(name, value) {
  ZHIXU.write('zhixu:prefs', { ...ZHIXU.prefs(), [name]: value });
  ZHIXU.applyPrefs();
}

// —— shell.js ——
/* 外壳：页眉、课程目录（宽屏为侧栏，窄屏为抽屉）、阅读进度。 */


/** 页眉。actions: { search, settings, notes? }；首页没有目录按钮、书眉和打印。每一页都重做一遍。 */
function buildHeader(actions) {
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
function buildSidebar(main, sections) {
  outline = sections;
  const side = h('nav.zx-side', { 'aria-label': '课程目录' }, navTree(sections));
  main.before(side);
  root.dataset.side = ZHIXU.prefs().side ? 'on' : 'off';
  onClear(() => delete root.dataset.side); // 首页没有目录栏：留着它，首页的版面会按有目录栏来排
  revealCurrent(side);
}

/** 读完或取消读完后，同步目录里的小印。 */
function markDone(file, done) {
  for (const link of $$(`.zx-nav-link[data-file="${file}"]`)) link.classList.toggle('is-done', done);
}

/** 滚动时更新进度线、收放页眉，并报告当前所在的小节（标题之前为 undefined）。 */
function trackReading(sections, onSection) {
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

function setRunningHead(text) {
  $('.zx-running').textContent = text;
}

// —— seal.js ——
/* 印章：读完一讲盖一枚。四个字按传统顺序排成两列，先右后左。
 * 滤镜让边缘略微不齐、印面带一点飞白，像真的按在纸上。 */


function seal(text, fresh = false) {
  const [a, b, c, d] = text;
  return parse(`<svg class="zx-seal${fresh ? ' is-fresh' : ''}" viewBox="0 0 100 100" role="img" aria-label="${text}">
<filter id="zx-ink" x="-10%" y="-10%" width="120%" height="120%">
<feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="2" seed="4" result="warp"/>
<feDisplacementMap in="SourceGraphic" in2="warp" scale="3" result="edge"/>
<feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves="1" seed="9"/>
<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -8 5.5"/>
<feComposite in="edge" operator="in"/>
</filter>
<g filter="url(#zx-ink)">
<rect x="7" y="7" width="86" height="86" rx="10"/>
<text x="69" y="45">${a}</text><text x="69" y="81">${b}</text><text x="31" y="45">${c}</text><text x="31" y="81">${d}</text>
</g>
</svg>`);
}

// —— stairs.js ——
/* 阶梯的几何：分几段、每段几级、每级多高、哪一级是平台。纯计算，不碰页面，可以直接在 Node 里测试。 */

const FLIGHT_MAX = 16; // 一段阶梯最多这么多级；讲数再多，就平分成几段，一段排一行
const FLIGHT_RISE = 88; // 一段阶梯一共升这么高（像素）：每一级的高度由它平分，取整
const RISE_RANGE = [4, 24]; // 每一级最矮、最高是多少

/**
 * units 是每一讲所属的单元（按讲次的先后）。返回：
 *   flights 分几段；size 每段几级（最后一段可能少几级）；rise 每一级升多高（像素）；
 *   steps 每一讲的 { level: 它是这一段里的第几级（从 0 数）, landing: 是不是平台 }。
 * 平台是一个单元的最后一级；一段的最后一级后面没有台阶了，不算平台。
 */
function stairPlan(units) {
  const flights = Math.ceil(units.length / FLIGHT_MAX);
  const size = Math.ceil(units.length / flights);
  const [lowest, highest] = RISE_RANGE;
  return {
    flights,
    size,
    rise: Math.max(lowest, Math.min(highest, Math.floor(FLIGHT_RISE / size))),
    steps: units.map((unit, index) => {
      const level = index % size;
      const last = level === size - 1 || index === units.length - 1;
      return { level, landing: !last && units[index + 1] !== unit };
    })
  };
}

// —— find.js ——
/* 落到命中处：搜索结果和术语表把要找的词带到目标页，目标页把它们标出来、滚到第一处。
 * 词记在 sessionStorage 里，同一个标签页里从这一页带到下一页；标记用 CSS 自定义高亮，不改动页面结构。 */


const FIND_KEY = 'zhixu:find';
/* 这些地方的文字不在搜索索引里：答案、排好版的公式，以及引擎自己加的按钮和标签 */
const UNSEARCHED =
  '.katex, svg, .hint, .explain, details.answer, .zx-answers, .zx-ref, .zx-quiz-bar, .zx-stepper-bar, .zx-tablist, .zx-code-bar, button';

/** 记下要找的词（小写），等 file 这一页来取；id 是命中的那一小节，空串表示整讲。 */
function carryFind(words, file, id) {
  ZHIXU.write(FIND_KEY, { words, file, id }, 'sessionStorage');
}

/**
 * 落到该去的地方：前进后退时用历史位置，其余时候用搜索命中或链接里的锚点；目标藏着的话先亮出来。
 * 页面启动完、以及本页的地址变了（点了本页的链接）之后各调用一次。
 */
function arrive() {
  const top = ZHIXU.takeHistoryScroll();
  const anchor = ZHIXU.anchor();
  const carried = ZHIXU.read(FIND_KEY, 'sessionStorage');
  // 搜索词只跟着这次跳转。中途后退时也要取走，避免下次正常进讲时意外跳到旧结果。
  if (carried) ZHIXU.write(FIND_KEY, null, 'sessionStorage');
  if (top === undefined && carried?.file === page.file && (carried.id || '') === anchor && landOnFind(carried)) return;
  const target = document.getElementById(anchor);
  if (target) reveal(target);
  if (top !== undefined) scrollTo(0, top);
  else target?.scrollIntoView();
}

/** 如果有带给这一页的词：标出每一处，滚到第一处，返回 true。藏在折叠块、选项卡、演示里的会先亮出来。 */
function landOnFind({ id, words }) {
  const ranges = rangesOf((id && document.getElementById(id)) || $('main'), words);
  if (!ranges.length) return false;

  const first = ranges[0].startContainer.parentElement;
  CSS.highlights.set('zx-find', new Highlight(...ranges));
  const unmark = () => CSS.highlights.delete('zx-find');
  addEventListener('pointerdown', unmark, { once: true, signal: pageSignal() }); // 点一下页面，标记就撤掉
  onClear(unmark); // 单文件里换页也撤掉：标的是这一页的字
  reveal(first);
  first.scrollIntoView({ block: 'center' });
  return true;
}

/** scope 里每个词每一处出现的位置，按先后排列。一个词可以跨好几个文字节点（比如一半在加粗里）。 */
function rangesOf(scope, words) {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement.closest(UNSEARCHED) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  });
  const pieces = [];
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    pieces.push({ node, start: text.length });
    text += node.data.toLowerCase();
  }
  /* 第 index 个字符在哪个文字节点的第几位 */
  const locate = (index) => {
    const piece = pieces.findLast((item) => item.start <= index);
    return [piece.node, index - piece.start];
  };

  const ranges = [];
  for (const word of words) {
    for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + word.length)) {
      const [endNode, endOffset] = locate(at + word.length - 1);
      const range = new Range();
      range.setStart(...locate(at));
      range.setEnd(endNode, endOffset + 1);
      ranges.push(range);
    }
  }
  return ranges.sort((a, b) => a.compareBoundaryPoints(Range.START_TO_START, b));
}

// —— home.js ——
/* 首页：左页封面（课程名、进度、继续阅读），右页目录、错题回顾与术语表。 */


const REVIEW_ID = 'zx-review'; // “错题回顾”这一栏的锚点，封面上的入口指向它

/** 把首页建好，返回“就位”的函数：页面放行之后调用它。 */
function renderHome() {
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

// —— numbering.js ——
/* 自动编号与引用：小节 2.1、图 2-1、表 2-1、例 2-1、式 2-1；
 * 文字留空的链接会被填上目标的编号。编号规则与 tools/zx.js 生成目录数据时一致。 */


/** 给当前页编号。返回 { sections, labels }：小节列表与“id → 编号文字”的对照表。 */
function numberLesson(main, lesson) {
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

// —— code.js ——
/* 代码块：语法着色、文件名、行号、标亮行、逐行讲解、复制。 */


async function enhanceCode(main) {
  const blocks = $$('pre', main).filter((pre) => pre.firstElementChild?.matches('code'));
  if (!blocks.length) return;

  await ZHIXU.need('code');
  const extra = new Set(blocks.map(languageOf).filter((name) => name && !hljs.getLanguage(name)));
  await Promise.all([...extra].map((name) => ZHIXU.load(`vendor/highlight/languages/${name}.min.js`)));
  blocks.forEach(decorate);
}

const languageOf = (pre) => (pre.dataset.lang === 'text' ? null : pre.dataset.lang);

function decorate(pre) {
  const code = pre.firstElementChild;
  const source = code.textContent.replace(/\n$/, '');
  const language = languageOf(pre);
  const notes = pre.nextElementSibling?.matches('.code-notes') ? pre.nextElementSibling : null;
  const marked = parseMarks(pre.dataset.mark);
  const numbered = 'lines' in pre.dataset || Boolean(notes);

  code.textContent = source;
  if (language) code.innerHTML = hljs.highlight(source, { language }).value;
  if (numbered || marked.size) layLines(code, Number(pre.dataset.lines) || 1, marked, numbered);

  const box = h('div.zx-code');
  pre.replaceWith(box);
  if (pre.dataset.file) {
    box.append(
      h(
        'div.zx-code-bar',
        null,
        h('span.zx-code-file', null, pre.dataset.file),
        language && h('span', null, hljs.getLanguage(language).name)
      )
    );
  }
  box.append(pre);
  keyboardScrollable(pre);
  if (navigator.clipboard) box.append(copyButton(source));
  if (notes) linkNotes(code, notes);
}

/** "3,5-7" → Set {3, 5, 6, 7} */
function parseMarks(spec = '') {
  const lines = new Set();
  for (const part of spec.split(',').filter(Boolean)) {
    const [from, to = from] = part.split('-').map(Number);
    for (let line = from; line <= to; line += 1) lines.add(line);
  }
  return lines;
}

/** 把着色后的 HTML 按行拆开，每行一个 span；跨行的着色标签在新行里重新打开。 */
function layLines(code, start, marked, numbered) {
  const open = [];
  const lines = [''];
  for (const [token] of code.innerHTML.matchAll(/<span[^>]*>|<\/span>|\n|[^<\n]+/g)) {
    if (token === '\n') {
      lines[lines.length - 1] += '</span>'.repeat(open.length);
      lines.push(open.join(''));
      continue;
    }
    if (token === '</span>') open.pop();
    else if (token.startsWith('<span')) open.push(token);
    lines[lines.length - 1] += token;
  }
  code.classList.add('zx-lines');
  code.innerHTML = lines
    .map((html, index) => {
      const number = start + index;
      const state = marked.has(number) ? ' is-marked' : '';
      const label = numbered ? ` data-n="${number}"` : '';
      return `<span class="zx-line${state}" data-line="${number}"${label}>${html}</span>`;
    })
    .join('');
}

function copyButton(source) {
  const button = h(
    'button.zx-tool.zx-copy',
    { type: 'button', 'aria-label': '复制代码', title: '复制代码' },
    icon('copy')
  );
  button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(source);
    button.replaceChildren(icon('check'));
    button.classList.add('is-done');
    setTimeout(() => {
      button.replaceChildren(icon('copy'));
      button.classList.remove('is-done');
    }, 1600);
  });
  return button;
}

/** 讲解与代码行互相点亮。 */
function linkNotes(code, notes) {
  for (const note of notes.children) {
    const line = code.querySelector(`[data-line="${note.dataset.line}"]`);
    const light = (on) => {
      note.classList.toggle('is-lit', on);
      line.classList.toggle('is-lit', on);
    };
    for (const el of [note, line]) {
      el.addEventListener('pointerenter', () => light(true));
      el.addEventListener('pointerleave', () => light(false));
    }
  }
}

// —— math.js ——
/* 公式：用内置的 KaTeX 排版 .math 里的 LaTeX。 */


/* 读屏软件读公式，靠的是 KaTeX 输出里的 MathML。可是元素的“名字”只能是一串文字，MathML 进不去：
 * 选项、表头、链接、折叠标题这些靠自己的内容得名的地方，公式对名字没有贡献，只写了一个公式的选项就成了没有名字的单选框。
 * 这些地方的公式改当“一幅带替代文字的图”，替代文字是作者写的 LaTeX。
 * 旁注的注文不算它所在元素的名字，里面的公式照旧。 */
const NAMED_BY_CONTENT = 'a, button, dfn, label, summary, th, caption, figcaption, h1, h2, h3, h4';

const partOfName = (formula) => Boolean(formula.closest(`${NAMED_BY_CONTENT}, .zx-note`)?.matches(NAMED_BY_CONTENT));

async function enhanceMath(main) {
  const formulas = $$('.math', main);
  if (!formulas.length) return;

  await ZHIXU.need('math');
  for (const formula of formulas) {
    const display = formula.tagName === 'DIV';
    const source = formula.textContent;
    katex.render(source, formula, { displayMode: display, throwOnError: false });
    formula.classList.add('zx-math');
    if (partOfName(formula)) {
      formula.setAttribute('role', 'img');
      formula.setAttribute('aria-label', source.replace(/\s+/g, ' ').trim());
    }
    if (display) keyboardScrollable($('.katex-display', formula)); // 太长的独立公式在这一层里横向滚动
  }
}

// —— keep.js ——
/* 断行的两处修正。
 * 禁则：行内公式和旁注序号在浏览器眼里是“原子”，原子前后一律允许断行，
 * 后面的标点、前面的开引号因此会掉到下一行的行首或留在上一行的行尾。
 * 这里把“开引号 + 公式或旁注序号 + 紧跟的旁注 + 收尾标点”包进一个不折行的容器（.zx-keep）。
 * 旁注序号不和它前面的那个字分开，是样式管的（components.css 的“旁注的序号”），这里不用动页面结构。
 * 长串：很长的网址和标识符中间没有断行点，会整个掉到下一行，把上一行的字距拉开。
 * 允许“随便断”的话，三个内核又各有各的断法，收尾标点常被留在行首。这里只在字符之间放 <wbr>：
 * 一簇是一个字符连着它后面的收尾标点，开引号连着它后面的那个字符，断点因此永远不在禁则的位置。 */


const CLOSERS = /^[，。、；：？！）》」』”’〉】〕］｝,.;:?!)\]%]+/;

const QUOTES = '“”‘’「」『』"\'`';

const OPENERS = `（《〈【〔［｛([{${QUOTES}`;

const OPENERS_ONLY = /^[（《〈【〔［｛“‘「『([{]$/;

const LONG_RUN = /[!-~]{20,}/; // 连续 20 个以上不带空格的西文字符

function tuneBreaks(main) {
  for (const el of $$(':not(pre) > code, a', main)) {
    const only = el.childNodes.length === 1 && el.firstChild;
    if (only?.nodeType !== Node.TEXT_NODE || !LONG_RUN.test(only.data)) continue;
    const parts = clusters(only.data);
    el.replaceChildren(...parts.flatMap((part, index) => (index ? [h('wbr'), part] : [part])));
  }

  for (const atom of $$('span.zx-math, sup.zx-ref', main)) {
    if (atom.parentElement.classList.contains('zx-keep')) continue; // 已经被前一个原子收进去了
    const run = [atom];
    const before = atom.previousSibling;
    if (atom.matches('span.zx-math') && before?.nodeType === Node.TEXT_NODE && OPENERS_ONLY.test(before.data.at(-1))) {
      run.unshift(before.splitText(before.length - 1)); // 开引号跟公式走，不留在上一行的行尾
    }
    for (let next = atom.nextSibling; next; next = run.at(-1).nextSibling) {
      if (next.nodeType === Node.ELEMENT_NODE && next.matches('sup.zx-ref, span.zx-note')) {
        run.push(next);
        continue;
      }
      const tail = next.nodeType === Node.TEXT_NODE && next.data.match(CLOSERS)?.[0];
      if (tail) {
        next.splitText(tail.length);
        run.push(next);
      }
      break;
    }
    if (run.length === 1) continue;
    const keep = h('span.zx-keep');
    run[0].before(keep);
    keep.append(...run);
    if (atom.matches('span.zx-math')) letFormulaBreak(atom);
  }
}

/* 把一串字符分成不许断开的簇：开引号连着后面的那个字符，一个字符连着它后面那串收尾标点，
 * 结尾的空白跟着最后一簇走（下一簇自己带着开头的空白）。簇与簇之间才是可以断的地方。 */
function clusters(text) {
  const parts = [];
  let open = false; // 上一簇以开引号或开括号结尾，这一簇要接上去
  for (const char of text) {
    const sticks = open || (parts.length > 0 && CLOSERS.test(char));
    if (sticks) parts[parts.length - 1] += char;
    else parts.push(char);
    open = OPENERS.includes(char);
  }
  return parts.map((part) => h('span.zx-long', null, part));
}

/** 长公式仍然要能在内部断行：把最后一段单独留在不折行的环境里，前面各段恢复可断。 */
function letFormulaBreak(formula) {
  const pieces = $$('.katex-html > .katex-base', formula);
  if (pieces.length < 2) return;
  const head = pieces[0].parentElement;
  const tail = head.cloneNode(false);
  head.classList.add('zx-wrap');
  head.after(tail);
  tail.append(pieces.at(-1));
}

// —— margin.js ——
/* 旁注与术语。
 * 旁注：正文里的 <span class="note"> 变成“序号 + 注文”。注文是一个浮层，点序号弹出来；
 * 宽屏上，小节里普通段落的旁注不用弹，它一直排在右侧的页边里（样式在 layout.css）。
 * 术语：<dfn> 可以点开看定义；定义来自本页的 data-def，或全课术语表。
 * 两种浮层都是原生的 popover（点外面、按 Esc 会关上），开关和定位是同一套。 */


/* 旁注进不进页边，看它写在哪：小节里的普通段落，或者普通列表（没有类名的 ul、ol，可以嵌套）。
 * 别的地方（提示卡、表格、小测、卡片、折叠块……）会裁剪或限宽，里面的旁注只用浮层。 */
const PLAIN = 'p, li, ul:not([class]), ol:not([class])';

function inPlainText(note) {
  let el = note.closest('p, li');
  while (el?.matches(PLAIN)) el = el.parentElement;
  return Boolean(el?.matches('main > section:not(.recap)'));
}

function enhanceNotes(main) {
  $$('span.note', main).forEach((note, index) => {
    const number = index + 1;
    note.id ||= `zx-note-${number}`; // 作者写了 id 就用作者的
    const button = h(
      'button',
      { type: 'button', 'aria-label': `旁注 ${number}`, 'aria-controls': note.id, 'aria-expanded': 'false' },
      String(number)
    );
    note.className = inPlainText(note) ? 'zx-note zx-note--margin' : 'zx-note';
    note.dataset.n = number;
    note.popover = 'auto';
    note.setAttribute('role', 'note');
    note.before(h('sup.zx-ref', null, button));

    note.addEventListener('beforetoggle', (event) => {
      button.setAttribute('aria-expanded', String(event.newState === 'open'));
    });
    button.addEventListener('click', (event) => {
      // 注文已经排在页边里的时候，它一直看得见，点序号不用再弹
      const inMargin = !note.matches(':popover-open') && note.checkVisibility();
      if (!inMargin) togglePop(button, note, event);
    });
    revealable(note, () => {
      if (!note.checkVisibility()) showPop(button, note);
    });
    // 注文可能写在选项、任务或者折叠块的标题里：在浮层里点一下（点链接除外），不算点了它们
    note.addEventListener('click', (event) => {
      if (!event.target.closest('a')) event.preventDefault();
    });
  });
}

function enhanceTerms(main) {
  const glossary = new Map(terms.map((entry) => [entry.term, entry]));
  const pop = h('div.zx-pop', { popover: 'auto' });
  document.body.append(pop);
  // 术语的浮层挂在正文栏外面，单文件里换页时自己收；记着的“最近打开的浮层”也是这一页的
  onClear(() => {
    pop.remove();
    shown = null;
  });

  for (const dfn of $$('dfn', main)) {
    const term = dfn.textContent.trim();
    const entry = dfn.dataset.def ? { def: dfn.dataset.def, file: page.file } : glossary.get(term);
    if (!entry) continue;

    const toggle = (event) => {
      const origin = entry.file === page.file ? null : lessonByFile(entry.file);
      const source =
        origin && h('a', { href: ZHIXU.url(origin.file, entry.id) }, `出自${lessonName(origin)}《${origin.title}》`);
      source?.addEventListener('click', () => carryFind([term.toLowerCase()], origin.file, entry.id));
      pop.replaceChildren(...[h('b', null, term), entry.def, source].filter(Boolean));
      togglePop(dfn, pop, event);
    };
    dfn.tabIndex = 0;
    dfn.setAttribute('role', 'button');
    dfn.addEventListener('click', toggle);
    dfn.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggle(event);
    });
  }
}

/* —— 浮层的开关 ——
 * 浮层开着的时候在它外面点一下，浏览器会在手指松开的那一刻把它关上。点的要是它自己的锚点，
 * 紧跟着的 click 又会把它打开，怎么点都关不掉。所以按下的那一刻先记下：按的是不是正开着的那个浮层的锚点。 */
let shown = null; // 最近打开的浮层：{ anchor, pop, width }，width 是打开时窗口的宽度
let pressed = null; // 最近一次按下时，正开着浮层、又正好被按到的那个锚点

addEventListener(
  'pointerdown',
  (event) => {
    pressed = shown?.pop.matches(':popover-open') && shown.anchor.contains(event.target) ? shown.anchor : null;
  },
  true
);

// 窗口变宽变窄，文字重新折行，锚点不在原处了。只变高矮不算：手机上滚动时地址栏收起来，窗口也会变高
addEventListener('resize', () => {
  if (shown && innerWidth !== shown.width) shown.pop.togglePopover(false);
});

/** 点了锚点（event 是那一下 click 或按键）：浮层没开就打开，开着就关上。 */
function togglePop(anchor, pop, event) {
  // 鼠标和手指的点击，要看按下那一刻它是不是开着；键盘按出来的（detail 是 0），看现在
  const wasOpen = event.detail ? pressed === anchor : shown?.anchor === anchor && pop.matches(':popover-open');
  pop.togglePopover(false);
  if (!wasOpen) showPop(anchor, pop);
}

function showPop(anchor, pop) {
  // 先量锚点和它所在的正文栏：锚点要是在另一个浮层里，下一步那个浮层就关了
  const at = anchor.getBoundingClientRect();
  const column = anchor.closest('main > *').getBoundingClientRect();
  pop.togglePopover(true);
  place(pop, at, column);
  shown = { anchor, pop, width: innerWidth };
}

/** 把浮层放在锚点下方，左边对齐；下方放不下、上方放得下，就放到上方。
 * 左右不伸出正文栏（锚点自己在页边里的话，右边以锚点为界）。
 * at、column 是锚点和正文栏在窗口里的位置；浮层的位置按整个页面来算，它跟着页面一起滚动。 */
function place(pop, at, column) {
  const gap = 8;
  const size = pop.getBoundingClientRect();
  const above = at.bottom + gap + size.height > innerHeight && at.top - gap - size.height >= 0;
  const right = Math.max(column.right, at.right);
  const left = Math.max(column.left, Math.min(at.left, right - size.width));
  pop.style.top = `${scrollY + (above ? at.top - gap - size.height : at.bottom + gap)}px`;
  pop.style.left = `${scrollX + left}px`;
}

// —— grading.js ——
/* 小测的判分：纯函数，不碰页面，可以直接在 Node 里测试。
 * 题目有四种：choice 单选、multi 多选、fill 填空、self 自评。 */

const tidy = (text) => text.normalize('NFKC').trim().toLowerCase();

/** 题型：有选项的是选择题（答案里有逗号就是多选）；没有选项而有答案的是填空；都没有的是自评。 */
function kindOf(hasOptions, answer) {
  if (hasOptions) return answer.includes(',') ? 'multi' : 'choice';
  return answer ? 'fill' : 'self';
}

/** 读者给的答案对不对。given：选择题是选中的字母（多个用逗号连起来），填空题是填进去的文字。 */
function isRight(kind, answer, given) {
  return kind === 'fill' ? answer.split('|').map(tidy).includes(tidy(given)) : given === answer;
}

/** 给读者看的正确答案："B"、"A、C"，填空题取第一个写法。 */
function answerText(kind, answer) {
  return kind === 'fill' ? answer.split('|')[0] : answer.toUpperCase().replaceAll(',', '、');
}

/**
 * 作答一次之后题目到了哪一步：right、wrong，或者 retry。
 * retry 是“第一次答错而题目带提示”：先给提示，让读者再试一次。tries 是连这一次在内答了几次。
 */
function phaseAfter({ kind, answer, hasHint }, tries, given) {
  if (isRight(kind, answer, given)) return 'right';
  return tries === 1 && hasHint ? 'retry' : 'wrong';
}

// —— quiz.js ——
/* 小测：单选、多选、填空、自评。
 * 第一次答错先给提示，再错才揭晓；成绩按“第一次是否答对”记录，答错的题进入首页的错题回顾。
 * 判分在 grading.js 里。这里只管页面：每道题有一个 phase，页面照着 phase 画，不从页面读回状态。 */


const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const KIND_NAMES = { choice: '单选', multi: '多选', fill: '填空', self: '自评' };
const optionList = (el) => $$(':scope > ol', el).pop();

/**
 * 读出这一讲的小测：{ el, key, stem }。key 是学习记录里这道题的身份，stem 是作者写下的题干。
 * 要趁页面还是作者写的样子来读：别的组件后来加进去的文字（旁注序号、自动填上的编号）不能混进题干。
 */
function readQuizzes(main) {
  return $$('div.quiz', main).map((el) => {
    const list = optionList(el);
    const stem = [...el.children]
      .filter((child) => child !== list && !child.matches('.hint, .explain'))
      .map((child) => child.textContent)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { el, stem, key: el.id || `q${hash(stem)}` };
  });
}

/** 把读出来的小测变成可以作答的题；成绩变化时调用 onChange。 */
function enhanceQuizzes(main, quizzes, onChange) {
  quizzes.forEach((quiz, index) => setup(quiz, index + 1, onChange));
  if (quizzes.length) main.append(answerSheet(quizzes));
}

/** 本讲小测的成绩：{ total, right }。 */
function quizScore(quizzes) {
  const saved = record().quiz[page.file] ?? dict();
  return { total: quizzes.length, right: quizzes.filter((quiz) => own(saved, quiz.key)?.ok).length };
}

function setup({ el, key, stem }, number, onChange) {
  const list = optionList(el);
  const answer = el.dataset.answer ?? '';
  const kind = kindOf(Boolean(list), answer);
  const hint = $(':scope > .hint', el);
  const explain = $(':scope > .explain', el);
  const question = { kind, answer, hasHint: Boolean(hint) };

  el.id ||= `zx-quiz-${key}`;
  el.dataset.key = key;
  el.dataset.kind = kind;
  el.dataset.label = `小测 ${number} · ${KIND_NAMES[kind]}`;
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', el.dataset.label);

  const options = [...(list?.children ?? [])].map((item, index) => {
    const input = h('input', { type: kind === 'multi' ? 'checkbox' : 'radio', name: el.id, value: LETTERS[index] });
    item.append(h('label.zx-opt', null, input, h('span', null, ...item.childNodes)));
    return { item, input };
  });
  const field =
    kind === 'fill' ? h('input.zx-fill', { type: 'text', autocomplete: 'off', 'aria-label': '你的答案' }) : null;
  const action = h('button.zx-btn', { type: 'button' });
  const verdicts =
    kind === 'self'
      ? [h('button.zx-btn', { type: 'button' }, '我答对了'), h('button.zx-btn', { type: 'button' }, '没答对')]
      : [];
  const status = h('span.zx-quiz-status', { role: 'status' });
  const bar = h('div.zx-quiz-bar', null, field, action, verdicts, status);
  if (explain) explain.before(bar);
  else el.append(bar);

  /* 这道题走到了哪一步：
   * idle 待答 → retry 给了提示、再答一次 → right / wrong 已揭晓；自评题是 idle → reference 对照答案 → right / wrong。 */
  let phase = 'idle';
  let tries = 0;

  /** 照着 phase 把题目画出来；message 是这一步对读者说的话。 */
  function paint(message) {
    const revealed = phase === 'right' || phase === 'wrong';
    el.dataset.state = phase;
    status.textContent = message;
    for (const { item, input } of options) {
      input.disabled = revealed;
      if (!revealed) delete item.dataset.mark;
      else if (answer.split(',').includes(input.value)) item.dataset.mark = 'right';
      else if (input.checked) item.dataset.mark = 'wrong';
    }
    if (field) field.disabled = revealed;
    if (hint) hint.hidden = phase !== 'retry';
    if (explain) explain.hidden = !revealed && phase !== 'reference';
    for (const button of verdicts) button.hidden = phase !== 'reference';
    action.hidden = phase === 'reference';
    action.textContent = revealed ? '重做' : kind === 'self' ? '看参考答案' : '检查答案';
  }

  function restart() {
    for (const { input } of options) input.checked = false;
    if (field) field.value = '';
    phase = 'idle';
    tries = 0;
    paint('');
  }

  /** 这道题答完了：记下成绩（只认第一次），揭晓答案。 */
  function settle(right, message) {
    phase = right ? 'right' : 'wrong';
    update((data) => {
      data.quiz[page.file] ??= dict();
      data.quiz[page.file][key] = { ok: right && tries === 1, at: today(), stem: stem.slice(0, 80), id: el.id };
    });
    paint(message);
    onChange();
  }

  function check() {
    const given = field
      ? field.value
      : options
          .filter(({ input }) => input.checked)
          .map(({ input }) => input.value)
          .join(',');
    if (!given.trim()) {
      paint(field ? '先填写答案' : '先选一个选项');
      return;
    }
    tries += 1;
    const next = phaseAfter(question, tries, given);
    if (next === 'retry') {
      phase = next;
      paint('不对，再想想');
    } else if (next === 'right') {
      settle(true, tries === 1 ? '回答正确' : '这次对了');
    } else {
      settle(false, `正确答案：${answerText(kind, answer)}`);
    }
  }

  action.addEventListener('click', () => {
    if (phase === 'right' || phase === 'wrong') {
      restart();
    } else if (kind === 'self') {
      phase = 'reference';
      paint('对照参考答案，自己判断');
    } else {
      check();
    }
  });
  verdicts.forEach((button, index) => {
    button.addEventListener('click', () => {
      tries = 1;
      settle(index === 0, index === 0 ? '记为答对' : '记为没答对');
    });
  });
  field?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !composing(event)) check();
  });

  // 作者可以给题写 id="constructor" 这样的名字：键只在对象自己的属性里找
  const saved = own(record().quiz[page.file] ?? dict(), key);
  if (saved) phase = saved.ok ? 'right' : 'wrong';
  paint(!saved ? '' : saved.ok ? '上次答对了' : '上次没答对，可以重做');
}

/** 参考答案页：只在打印时出现。 */
function answerSheet(quizzes) {
  const items = quizzes.map(({ el }) => {
    const answer = el.dataset.answer;
    const explain = $(':scope > .explain', el);
    const item = h('li', null, answer && h('strong', null, answerText(el.dataset.kind, answer)));
    if (explain) item.append(...[...explain.cloneNode(true).childNodes]);
    return item;
  });
  return h('section.zx-answers', null, h('h2', null, '参考答案'), h('ol', null, items));
}

// —— widgets.js ——
/* 三个小组件：步进演示、选项卡、任务清单。 */


/** 步进演示：每个 figure 是一帧，按钮在帧之间切换。所有帧叠在同一格里，高度取最高的一帧。 */
function enhanceSteppers(main) {
  for (const el of $$('div.stepper', main)) {
    const frames = $$(':scope > figure', el);
    const prev = h('button.zx-btn', { type: 'button' }, icon('prev'), '上一步');
    const next = h('button.zx-btn', { type: 'button' }, '下一步', icon('next'));
    const count = h('span.zx-stepper-count', { 'aria-live': 'polite' });
    const go = (index) => {
      frames.forEach((frame, position) => frame.classList.toggle('is-current', position === index));
      el.dataset.step = index + 1;
      count.textContent = `${index + 1} / ${frames.length}`;
      prev.disabled = index === 0;
      next.disabled = index === frames.length - 1;
    };
    prev.addEventListener('click', () => go(Number(el.dataset.step) - 2));
    next.addEventListener('click', () => go(Number(el.dataset.step)));
    el.dataset.label = '演示';
    el.append(h('div.zx-stepper-bar', null, prev, count, next));
    frames.forEach((frame, index) => revealable(frame, () => go(index)));
    go(0);
  }
}

/**
 * 选项卡：读者选过的名字会被记住，全课同名的选项卡一起切换。
 * 返回一个函数：把每一组的指示条放到选中的选项卡下面。它要量尺寸，所以留给调用的人在页面改完之后再做。
 */
function enhanceTabs(main) {
  const groups = $$('div.tabs', main).map((el, order) => {
    const panels = $$(':scope > [data-tab]', el);
    const tabs = panels.map((panel, index) => {
      const id = `zx-tab-${order + 1}-${index + 1}`;
      panel.id ||= `zx-tabpanel-${order + 1}-${index + 1}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', id);
      return h('button.zx-tab', { type: 'button', role: 'tab', id, 'aria-controls': panel.id }, panel.dataset.tab);
    });
    const list = h('div.zx-tablist', { role: 'tablist' }, tabs);
    el.classList.add('zx-tabs');
    el.prepend(list);
    return { list, panels, tabs, labels: panels.map((panel) => panel.dataset.tab) };
  });

  /** 选中 label 这一个：亮出它的面板。指示条不在这里挪。 */
  const select = (group, label) => {
    group.panels.forEach((panel, index) => {
      const on = panel.dataset.tab === label;
      panel.hidden = !on;
      group.tabs[index].setAttribute('aria-selected', String(on));
      group.tabs[index].tabIndex = on ? 0 : -1;
    });
  };

  /** 指示条挪到选中的那个选项卡下面。 */
  const underline = ({ list, tabs }) => {
    const tab = tabs.find((item) => item.tabIndex === 0);
    list.style.setProperty('--tab-x', `${tab.offsetLeft}px`);
    list.style.setProperty('--tab-w', `${tab.offsetWidth}px`);
  };

  /** 读者换到 label：全课同名的一起换。 */
  const choose = (label) => {
    update((data) => {
      data.tabs = [label, ...data.tabs.filter((name) => name !== label)].slice(0, 12);
    });
    for (const group of groups.filter((item) => item.labels.includes(label))) {
      select(group, label);
      underline(group);
    }
  };

  // 还没显示出来的选项卡量不出宽度（比如写在小测的解析里，揭晓之前不占地方）：这一排的尺寸一变，指示条重新就位
  const resized = new ResizeObserver((entries) => {
    for (const { target } of entries) underline(groups.find((group) => group.list === target));
  });
  onClear(() => resized.disconnect());

  const preferred = record().tabs;
  for (const group of groups) {
    select(group, preferred.find((label) => group.labels.includes(label)) ?? group.labels[0]);
    resized.observe(group.list);
    for (const panel of group.panels) {
      revealable(panel, () => {
        select(group, panel.dataset.tab);
        underline(group);
      });
    }
    group.tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => choose(group.labels[index]));
      tab.addEventListener('keydown', (event) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
        if (!step) return;
        const target = group.tabs[(index + step + group.tabs.length) % group.tabs.length];
        target.focus();
        target.click();
      });
    });
  }
  return () => groups.forEach(underline);
}

/** 读出每项任务的键（任务 → 键）：按作者写下的任务文字算，所以要趁页面还没被改写时读。 */
function readTasks(main) {
  return new Map($$('ul.tasks > li', main).map((item) => [item, hash(item.textContent.trim())]));
}

/** 任务清单：勾选状态按任务的键保存。 */
function enhanceTasks(main, keys) {
  const done = new Set(record().tasks[page.file]);
  for (const list of $$('ul.tasks', main)) {
    list.classList.add('zx-tasks');
    for (const item of list.children) {
      const key = keys.get(item);
      const input = h('input', { type: 'checkbox', checked: done.has(key) });
      input.addEventListener('change', () => {
        update((data) => {
          const keys = new Set(data.tasks[page.file]);
          if (input.checked) keys.add(key);
          else keys.delete(key);
          data.tasks[page.file] = [...keys];
        });
      });
      item.append(h('label.zx-task', null, input, h('span.zx-box'), h('span.zx-task-text', null, ...item.childNodes)));
    }
  }
}

// —— figures.js ——
/* 图与表：宽表格横向滚动；显示得比原图小的图，可以点开看原始大小；
 * 正文栏里放不下的表格、代码和图，宽屏上伸进右侧的页边。 */


/** 图的原始宽度：位图是它的像素宽，内联 SVG 是 viewBox 的宽。 */
const naturalWidth = (media) => media.naturalWidth ?? media.viewBox.baseVal.width;

/** 只有显示得比原图小的图才值得放大：给它所在的 figure 加上 .zx-zoom。 */
function judge(media) {
  const shrunk = naturalWidth(media) > media.getBoundingClientRect().width + 1;
  media.parentElement.classList.toggle('zx-zoom', shrunk);
}

function enhanceFigures(main) {
  for (const table of $$('table', main)) {
    const box = h('div.zx-table');
    table.replaceWith(box);
    box.append(table);
    keyboardScrollable(box);
  }

  const lightbox = dialog('zx-dialog.zx-dialog--lightbox');
  lightbox.addEventListener('click', () => lightbox.close());
  const zoom = (figure) => {
    const copy = figure.cloneNode(true);
    copy.removeAttribute('id');
    copy.classList.remove('zx-zoom');
    $('.zx-zoom-btn', copy).remove();
    lightbox.replaceChildren(copy);
    show(lightbox);
  };

  // 值不值得放大，位图载入、窗口变宽变窄都会改变；页面就位时 fitWide 也看一遍，不等观察器的第一次回报
  const watcher = new ResizeObserver((entries) => entries.forEach(({ target }) => judge(target)));
  // 放大看的浮层和这些图都是这一页的：单文件里换页时一起收掉
  onClear(() => {
    lightbox.remove();
    watcher.disconnect();
  });

  for (const figure of $$('figure', main)) {
    const media = $(':scope > svg, :scope > img', figure);
    if (!media) continue;
    // 内联 SVG 默认会撑满栏宽；按 viewBox 的宽度显示，图里的字号才和正文协调
    if (media.viewBox) media.setAttribute('width', media.viewBox.baseVal.width);
    if (figure.closest('.stepper')) continue;
    media.after(tool('expand', '放大查看', () => zoom(figure), '.zx-zoom-btn'));
    media.addEventListener('click', () => {
      if (figure.classList.contains('zx-zoom')) zoom(figure);
    });
    watcher.observe(media);
    media.addEventListener('load', () => {
      judge(media);
      fitWide();
    });
  }
}

/**
 * 放不下的表格、代码和图伸进页边：给它们加上 .zx-wide，怎么伸由样式定（layout.css）。
 * 只看小节里直接放着的那些；别的容器（提示卡、选项卡、例题……）里面的不往外伸。
 * 放不放得下要按正文栏的宽度来量，所以每次都先把它们全收回来，量完再伸出去。
 * 伸出去以后，图显示得有多宽才定下来：值不值得放大，在这里接着看一遍。
 */
function fitWide() {
  const blocks = $$('main > section:not(.recap) > :is(.zx-table, .zx-code, figure)');
  for (const block of blocks) block.classList.remove('zx-wide');
  const cramped = blocks.filter(isCramped); // 到这里才排一次版，一次量完
  for (const block of cramped) block.classList.add('zx-wide');
  $$('main figure:has(> .zx-zoom-btn) > :is(svg, img)').forEach(judge);
}

/** 这一块在正文栏里放不下：图的原始宽度比栏宽，或者表格、代码要横向滚动才看得全。 */
function isCramped(block) {
  const media = $(':scope > svg, :scope > img', block);
  if (media) return naturalWidth(media) > block.clientWidth;
  const scroller = $(':scope > pre', block) ?? block;
  return scroller.scrollWidth > scroller.clientWidth;
}

/**
 * 正文栏的宽度变了（读者换了字号，或者窗口从很窄变宽），就重新量一遍。column 是任何一个和正文栏等宽的元素。
 * 量的时候会改动版面，不能在观察器的回调里直接做，放到下一帧。
 */
function refitOnResize(column) {
  let width = column.clientWidth;
  const observer = new ResizeObserver(() => {
    if (column.clientWidth === width) return;
    width = column.clientWidth;
    requestAnimationFrame(fitWide);
  });
  observer.observe(column);
  onClear(() => observer.disconnect());
}

// —— lesson.js ——
/* 一讲的页面：讲头、编号、正文组件、讲末盖章与上下讲、阅读位置。
 * renderLesson 分五段把页面改完，先后有讲究，各段开头写明了它依赖什么；最后交回一个“就位”的函数。 */


/** 把这一讲的页面改完，返回“就位”的函数：页面放行之后调用它。 */
async function renderLesson() {
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

// —— matching.js ——
/* 搜索的匹配：在工具生成的索引里做子串匹配（中文没有词边界，子串最可靠）。
 * 都是纯函数，不碰页面，可以直接在 Node 里测试。词一律是小写的；索引里的文字保持原样，比较时再转小写。 */

const LIMIT = 30;
const lower = (text) => text.toLowerCase();

/** 读者输入的一串字 → 要找的词（小写，按空白分开）。 */
const wordsOf = (query) => lower(query).split(/\s+/).filter(Boolean);

/** 命中的条目：每个词都必须出现在标题或正文里；标题里命中的词多的排在前面，其余按索引里的先后。最多 30 条。 */
function searchHits(index, words) {
  if (words.length === 0) return [];
  return index
    .map((entry) => {
      const title = lower(entry.title);
      const text = lower(entry.text);
      if (!words.every((word) => title.includes(word) || text.includes(word))) return null;
      return { entry, score: words.filter((word) => title.includes(word)).length };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, LIMIT)
    .map((hit) => hit.entry);
}

/* 索引里的公式只是一个占位符（U+FFFC）：LaTeX 源码没有人按它来搜，直接去掉又会让前后的标点拼在一起。 */
const FORMULA = '￼';

/** 取第一个命中词前后的一小段正文；正文里没有命中（词只在标题里）就取开头。摘录里公式写成“[公式]”。 */
function excerptOf(text, words) {
  const hits = words.map((word) => lower(text).indexOf(word)).filter((at) => at >= 0);
  const at = hits.length ? Math.min(...hits) : 0;
  const from = Math.max(0, at - 16);
  return ((from > 0 ? '…' : '') + text.slice(from, from + 72)).replaceAll(FORMULA, '[公式]');
}

/** 把一段文字按命中的词切开：[[文字, 是不是命中], …]，各段连起来就是原文。 */
function splitHits(text, words) {
  text = text.replaceAll(FORMULA, '[公式]');
  const pieces = [];
  const haystack = lower(text);
  let cursor = 0;
  while (cursor < text.length) {
    const next = words
      .map((word) => ({ word, at: haystack.indexOf(word, cursor) }))
      .filter((match) => match.at >= 0)
      .sort((a, b) => a.at - b.at)[0];
    if (!next) break;
    if (next.at > cursor) pieces.push([text.slice(cursor, next.at), false]);
    pieces.push([text.slice(next.at, next.at + next.word.length), true]);
    cursor = next.at + next.word.length;
  }
  if (cursor < text.length) pieces.push([text.slice(cursor), false]);
  return pieces;
}

// —— search.js ——
/* 全文搜索的浮层。怎么匹配、摘哪一段，在 matching.js 里。 */


/** 建好搜索浮层，返回“打开搜索”的函数。 */
function setupSearch() {
  // 输入框和结果列表是一个“组合框”：焦点留在输入框里，方向键换的是 aria-activedescendant 指着的那一条
  const input = h('input', {
    type: 'text', // 不用 type="search"：它会先用 Esc 清空文字，而读者按 Esc 是想关掉浮层
    role: 'combobox',
    'aria-controls': 'zx-results',
    'aria-expanded': 'false',
    'aria-autocomplete': 'list',
    enterkeyhint: 'search',
    placeholder: '搜索全部讲义',
    'aria-label': '搜索',
    autocomplete: 'off',
    spellcheck: 'false'
  });
  const note = h('p.zx-search-note', null, '输入关键词，在全部讲义里查找');
  const results = h('ul.zx-results', { id: 'zx-results', role: 'listbox', 'aria-label': '搜索结果' });
  const el = dialog('zx-dialog.zx-dialog--search', h('div.zx-search-box', null, icon('search'), input), note, results);

  const select = (item) => {
    for (const other of $$('.zx-result', results)) other.setAttribute('aria-selected', String(other === item));
    input.setAttribute('aria-activedescendant', item.id);
    item.scrollIntoView({ block: 'nearest' });
  };

  input.addEventListener('input', () => {
    const words = wordsOf(input.value);
    const hits = searchHits(searchIndex, words);
    results.replaceChildren(
      ...hits.map((hit, index) => h('li', { role: 'presentation' }, resultLink(hit, words, `zx-hit-${index + 1}`)))
    );
    input.setAttribute('aria-expanded', String(hits.length > 0));
    input.removeAttribute('aria-activedescendant');
    note.hidden = hits.length > 0;
    note.textContent = words.length ? '没有找到。换一个更短的词试试' : '输入关键词，在全部讲义里查找';
    if (hits.length) select($('.zx-result', results));
  });

  input.addEventListener('keydown', (event) => {
    const items = $$('.zx-result', results);
    const index = items.findIndex((item) => item.getAttribute('aria-selected') === 'true');
    if (!items.length || composing(event)) return;
    if (event.key === 'Enter') {
      items[index].click();
      return;
    }
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    select(items[(index + step + items.length) % items.length]);
  });

  // 结果在本页时页面不会重新加载，浮层要自己关。地址变了，会由 hashchange 落到命中处；
  // 地址正好没变（搜到的就是当前这一节），浏览器什么也不做，这里自己落过去
  results.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (!link) return;
    el.close();
    if (link.href === location.href) arrive();
  });

  return () => {
    show(el);
    input.select();
  };
}

function resultLink(entry, words, id) {
  const lesson = lessonByFile(entry.file);
  const where = entry.id ? `${lessonName(lesson)} ${lesson.title}` : lessonName(lesson);
  const link = h(
    'a.zx-result',
    { id, href: ZHIXU.url(entry.file, entry.id), role: 'option', 'aria-selected': 'false' },
    h('b', null, highlight(entry.title, words)),
    h('span', null, where, '　', highlight(excerptOf(entry.text, words), words))
  );
  // 按住 Ctrl 或 Command 点，是让它在新的标签页里打开：这一页不换页，就不必把词带过去
  link.addEventListener('click', (event) => {
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) carryFind(words, entry.file, entry.id);
  });
  return link;
}

/** 把命中的词包进 <mark>；全程只创建文本节点，不拼 HTML。 */
function highlight(text, words) {
  return splitHits(text, words).map(([piece, hit]) => (hit ? h('mark', null, piece) : piece));
}

// —— settings.js ——
/* 外观与设置：主题、字体、字号；学习记录的备份、恢复与清除；快捷键一览。 */


const CHOICES = [
  {
    name: 'theme',
    legend: '主题',
    options: [
      ['auto', '跟随系统'],
      ['light', '浅色'],
      ['sepia', '纸张'],
      ['dark', '深色']
    ]
  },
  {
    name: 'font',
    legend: '正文字体',
    options: [
      ['serif', '宋体'],
      ['sans', '黑体']
    ]
  }
];

const COMMAND_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

const SHORTCUTS = [
  ['/', `搜索（也可以按 ${COMMAND_KEY} K）`],
  ['[', '上一讲'],
  [']', '下一讲'],
  ['n', '本讲笔记'],
  ['Esc', '关闭浮层']
];

/* 换主题时渐变的颜色令牌。自定义属性要先登记成“颜色”，浏览器才知道怎么在两个值之间过渡。
 * 这份名单和 tokens.css 里每套主题定义的颜色一致（css.test.js 核对）。 */
const THEME_COLORS = [
  '--paper',
  '--wash',
  '--raise',
  '--rule',
  '--rule-strong',
  '--ink',
  '--text',
  '--muted',
  '--accent',
  '--accent-strong',
  '--accent-wash',
  '--on-accent',
  '--mark',
  '--mark-wash',
  '--mark-ink',
  '--lit',
  '--good',
  '--good-wash',
  '--bad',
  '--bad-wash',
  '--seal',
  '--shade',
  '--veil',
  '--code-comment',
  '--code-keyword',
  '--code-string',
  '--code-number',
  '--code-title',
  '--code-type',
  '--code-attr'
];
for (const name of THEME_COLORS) {
  CSS.registerProperty({ name, syntax: '<color>', inherits: true, initialValue: 'transparent' });
}

/**
 * 读者换主题、换字体：颜色渐变过去。过渡只挂在根元素的这些令牌上，用到令牌的地方自然跟着变。
 * 打印前临时换成浅色、别的标签页改了设置，都不经过这里，直接换。
 * （不用视图过渡：WebKit 里过渡还没放完就开关浮层，页面会崩。）
 */
function restyle(change) {
  root.style.transition = THEME_COLORS.map((name) => `${name} var(--dur-2) var(--ease)`).join(', ');
  change();
  void getComputedStyle(root).color; // 读一下样式，过渡现在就开始，下面才等得到它们
  // 都放完了再把 transition 收回去；中途又换了一次的，留给后面那一次来收
  Promise.allSettled(root.getAnimations().map((animation) => animation.finished)).then(() => {
    if (root.getAnimations().length === 0) root.style.transition = '';
  });
}

/** 建好设置浮层，返回“打开设置”的函数。 */
function setupSettings() {
  const prefs = ZHIXU.prefs();

  const choices = CHOICES.map(({ name, legend, options }) => {
    const buttons = options.map(([value, label]) => {
      const input = h('input', { type: 'radio', name: `zx-${name}`, value, checked: prefs[name] === value });
      input.addEventListener('change', () => restyle(() => setPref(name, value)));
      return h('label', null, input, label);
    });
    return h('fieldset.zx-field', null, h('legend', null, legend), h('div.zx-seg', null, buttons));
  });

  const size = h('input', {
    type: 'range',
    min: '15',
    max: '21',
    step: '1',
    value: String(prefs.size),
    'aria-label': '正文字号'
  });
  const sizeLabel = h('output', null, `${prefs.size} px`);
  size.addEventListener('input', () => {
    sizeLabel.textContent = `${size.value} px`;
    setPref('size', Number(size.value));
  });

  const status = h('p.zx-status', { role: 'status' });
  const picker = h('input', { type: 'file', accept: 'application/json', hidden: true });
  picker.addEventListener('change', async () => {
    status.textContent = restore(await picker.files[0].text());
    picker.value = '';
  });
  const action = (label, onClick) => {
    const button = h('button.zx-btn', { type: 'button' }, label);
    button.addEventListener('click', onClick);
    return button;
  };

  const el = panel(
    'zx-dialog',
    '外观与设置',
    h(
      'div.zx-dialog-body',
      null,
      choices,
      h('fieldset.zx-field', null, h('legend', null, '正文字号'), h('div.zx-size', null, size, sizeLabel)),
      h(
        'fieldset.zx-field',
        null,
        h('legend', null, '学习记录（进度、小测、笔记）'),
        h(
          'div.zx-actions',
          null,
          action('导出备份', backup),
          action('从备份恢复', () => picker.click()),
          action('清除记录', clear),
          picker,
          status
        )
      ),
      h(
        'fieldset.zx-field',
        null,
        h('legend', null, '快捷键'),
        h(
          'dl.zx-keys',
          null,
          SHORTCUTS.map(([key, text]) => [h('dt', null, h('kbd', null, key)), h('dd', null, text)])
        )
      )
    )
  );
  return () => show(el);
}

const FORMAT = 1; // 备份文件的格式版本

function backup() {
  const payload = { app: 'zhixu', format: FORMAT, course: course.id, exported: today(), record: record() };
  download(`${course.id}-学习记录-${today()}.json`, JSON.stringify(payload, null, 2), 'application/json');
}

/** 一句话说清一份记录里有什么。 */
function summarize(data) {
  const answers = Object.values(data.quiz).reduce((sum, lesson) => sum + Object.keys(lesson).length, 0);
  return `已读 ${Object.keys(data.done).length} 讲、笔记 ${Object.keys(data.notes).length} 条、小测记录 ${answers} 条`;
}

/** 读入备份文件。文件来自读者，内容不可信：先校验，再请读者确认，最后一次写入。返回给读者看的结果。 */
function restore(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    return '这不是知序的备份文件。';
  }
  if (payload?.app !== 'zhixu' || typeof payload.exported !== 'string') return '这不是知序的备份文件。';
  if (payload.format !== FORMAT) return '这份备份的格式版本不对，没有恢复。';
  if (payload.course !== course.id) return `这份备份属于另一门课（${payload.course}）。`;
  if (!isRecord(payload.record)) return '备份文件的内容不完整或已损坏，没有恢复。';
  const question = [
    `这份备份导出于 ${payload.exported}，里面有：${summarize(filled(payload.record))}。`,
    `恢复会替换这门课现在的学习记录（${summarize(record())}）。继续吗？`
  ].join('\n');
  if (!confirm(question)) return '没有恢复。';
  if (!saveRecord(payload.record)) return '写入失败：浏览器不允许保存数据。';
  rebuild();
  return '已恢复，正在刷新页面。';
}

function clear() {
  if (!confirm('清除这门课的全部学习记录？这一步无法撤销。')) return;
  saveRecord(null);
  rebuild();
}

// —— notebook.js ——
/* 学习笔记：每讲一页纯文本，输入即保存；可以把全课笔记导出成 Markdown。
 * 宽屏上笔记停靠在正文右边的页边里，不遮正文，可以边读边写；窄一些的屏幕上是从右侧滑出的面板。 */


let toggle; // 笔记面板第一次用到时才建

/** 打开笔记；停靠着的时候再调用一次就收起。 */
function toggleNotes() {
  toggle ??= buildNotebook();
  toggle();
}

function buildNotebook() {
  const area = h('textarea.zx-notes', {
    'aria-label': '本讲笔记',
    autofocus: true,
    placeholder: '写下这一讲的要点、疑问和想法。内容只保存在这台设备上。'
  });
  const status = h('span', { role: 'status' });
  const adopt = h('button.zx-btn', { type: 'button', hidden: true }, '载入最新内容');
  const exportButton = h('button.zx-btn', { type: 'button' }, '导出全部笔记');
  const el = panel(
    'zx-dialog.zx-dialog--sheet',
    '本讲笔记',
    area,
    h('div.zx-dialog-foot', null, status, h('div', null, adopt, exportButton))
  );
  // 面板放进正文的版面里：停靠时它才能正好占住页边那两栏（见 overlays.css 的 .zx-dock）
  $('main').append(h('div.zx-dock', null, el));
  // 面板在正文栏里，换页时连同正文一起换下来：下一页要用的时候再建一个，配的是下一页的笔记
  onClear(() => {
    toggle = undefined;
  });

  const stored = () => record().notes[page.file] ?? '';
  let baseline = stored(); // 这一页上次读到或存下的内容；文本框和它不一样，就是有还没存进去的草稿

  const load = () => {
    baseline = stored();
    area.value = baseline;
    status.textContent = '';
    adopt.hidden = true;
  };

  area.addEventListener('input', () => {
    // 存之前先看一眼：别的标签页的通知可能还没到，存储里的笔记如果已经变了，就不能拿这里的旧底稿去覆盖
    let changedElsewhere = false;
    const saved = update((data) => {
      changedElsewhere = (data.notes[page.file] ?? '') !== baseline;
      if (changedElsewhere) return;
      if (area.value.trim()) data.notes[page.file] = area.value;
      else delete data.notes[page.file];
    });
    if (changedElsewhere) {
      status.textContent = '这一讲的笔记在别处改过，这里的内容还没保存';
      adopt.hidden = false;
    } else if (saved) {
      baseline = stored();
      status.textContent = '已保存';
    } else {
      status.textContent = '没有保存：浏览器不允许存储';
    }
  });
  adopt.addEventListener('click', () => {
    load();
    area.focus(); // 按钮随即隐藏：把焦点交还给文本框，光标放在末尾，可以接着写
    area.setSelectionRange(area.value.length, area.value.length);
  });
  exportButton.addEventListener('click', exportNotes);
  // 别的标签页改了笔记：这里没有草稿的话，就换成最新内容
  onRemoteChange(() => {
    if (area.value === baseline) load();
  }, pageSignal());

  // 停靠着的面板不是模态浮层：Esc 要自己接；窗口变窄、页边没有了，就收起来
  const docked = () => el.open && !el.matches(':modal');
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.isComposing && docked()) el.close();
  });
  wideScreen.addEventListener(
    'change',
    () => {
      if (docked()) el.close();
    },
    { signal: pageSignal() }
  );

  load(); // 面板刚建好：先把存着的笔记读进来
  return () => {
    if (el.open) {
      el.close(); // 只有停靠着的时候才走得到这里：模态的面板开着时，按钮和快捷键都碰不到
      return;
    }
    if (area.value === baseline) load();
    if (wideScreen.matches) el.show();
    else show(el);
  };
}

function exportNotes() {
  const notes = record().notes;
  const chapters = lessons
    .filter((lesson) => notes[lesson.file])
    .map((lesson) => `## ${lessonName(lesson)} ${lesson.title}\n\n${notes[lesson.file].trim()}\n`);
  download(`${course.id}-笔记.md`, `# ${course.title} 笔记\n\n${chapters.join('\n')}`, 'text/markdown');
}

// —— main.js ——
/* 入口：搭外壳、渲染首页或一讲、绑定快捷键和打印，最后放行显示。
 * 它是“解析完再执行、执行完才画第一帧”的脚本：这里同步做完的事，读者在第一帧就能看到。
 * 单文件里换页也从这里走（boot.js）：搜索、设置、快捷键、打印跟着整个会话，只建一次；别的每一页重搭。 */


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

} catch (error) {
  ZHIXU.fail(error.message);
  throw error;
}
})();
