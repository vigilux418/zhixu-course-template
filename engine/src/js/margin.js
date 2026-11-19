/* 旁注与术语。
 * 旁注：正文里的 <span class="note"> 变成“序号 + 注文”。注文是一个浮层，点序号弹出来；
 * 宽屏上，小节里普通段落的旁注不用弹，它一直排在右侧的页边里（样式在 layout.css）。
 * 术语：<dfn> 可以点开看定义；定义来自本页的 data-def，或全课术语表。
 * 两种浮层都是原生的 popover（点外面、按 Esc 会关上），开关和定位是同一套。 */

import { $$, h, revealable } from './dom.js';
import { lessonByFile, lessonName, page, terms } from './course.js';
import { carryFind } from './find.js';
import { onClear } from './boot.js';

/* 旁注进不进页边，看它写在哪：小节里的普通段落，或者普通列表（没有类名的 ul、ol，可以嵌套）。
 * 别的地方（提示卡、表格、小测、卡片、折叠块……）会裁剪或限宽，里面的旁注只用浮层。 */
const PLAIN = 'p, li, ul:not([class]), ol:not([class])';

function inPlainText(note) {
  let el = note.closest('p, li');
  while (el?.matches(PLAIN)) el = el.parentElement;
  return Boolean(el?.matches('main > section:not(.recap)'));
}

export function enhanceNotes(main) {
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

export function enhanceTerms(main) {
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
