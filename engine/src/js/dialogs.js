/* 浮层：全部用原生 dialog。模态的浮层同一时刻只开一个；停靠在页边的笔记不是模态的，不在此列。 */

import { $, h, root, tool } from './dom.js';

/** 创建一个浮层并挂到页面上；classes 形如 'zx-dialog.zx-dialog--search'。点击背景关闭。 */
export function dialog(classes, ...children) {
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
export function panel(classes, title, ...children) {
  const el = dialog(classes);
  const close = tool('close', '关闭', () => el.close());
  el.append(h('div.zx-dialog-head', null, h('h2', null, title), close), ...children);
  return el;
}

/** 以模态方式打开一个浮层，先关掉正开着的那个。 */
export function show(el) {
  $('dialog:modal')?.close();
  // 模态浮层一开，页面停止滚动，滚动条连同给它留的位置就收起来了。页面因此宽了多少，
  // 样式就垫回去多少，版面不横移（overlays.css）
  const width = () => root.getBoundingClientRect().width;
  const before = width();
  el.showModal();
  root.style.setProperty('--scrollbar', `${width() - before}px`);
}

export const modalOpen = () => Boolean($('dialog:modal'));
