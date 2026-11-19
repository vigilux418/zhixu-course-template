/* DOM 小工具：查询、创建元素、图标、下载。 */

import { dict } from './plain.js';

export const root = document.documentElement;

/** 宽屏：放得下目录栏，页边可以停靠笔记。和样式表里 1280 的断点是同一个数。 */
export const wideScreen = matchMedia('(min-width: 1280px)');

export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

/** 输入法正在选字，这一下按键不是给页面的。Safari 上确认选字的那一下回车 isComposing 已经是 false，keyCode 还是 229。 */
export const composing = (event) => event.isComposing || event.keyCode === 229;

/** 创建元素：h('a.zx-row', { href }, '文字', 子元素)。值为 null、undefined、false 的属性和子节点会被跳过。 */
export function h(spec, attrs, ...children) {
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
export function parse(html) {
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

export function icon(name) {
  return parse(`<svg class="zx-icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`);
}

/** 图标按钮。 */
export function tool(name, label, onClick, extraClass = '') {
  const button = h(`button.zx-tool${extraClass}`, { type: 'button', 'aria-label': label, title: label }, icon(name));
  button.addEventListener('click', onClick);
  return button;
}

/* 能横向滚动的区域（宽表格、长代码行、长公式、一排格子）要能用键盘滚动。
 * 内容放不下的时候才让它接受焦点，免得平白多出一批 Tab 停靠点。
 * 放不放得下会变：窗口变宽变窄时由 ResizeObserver 重看；字体到位之后内容的宽度也会变，启动的最后再看一遍。 */
const scrollers = new Set();

export function refreshScrollers() {
  for (const el of scrollers) {
    if (el.scrollWidth > el.clientWidth) el.tabIndex = 0;
    else el.removeAttribute('tabindex');
  }
}

/** 换页时把上一页登记的收回来：换下来的正文不再占版面，也不必再观察它们。 */
export function discardScrollers() {
  scrollerWatcher.disconnect();
  scrollers.clear();
}

const scrollerWatcher = new ResizeObserver(refreshScrollers);

export function keyboardScrollable(el) {
  scrollers.add(el);
  scrollerWatcher.observe(el);
}

/* 有些内容平时藏着：收起的折叠块、没选中的选项卡、演示里别的帧、窄屏上没展开的旁注。
 * 组件用 revealable 登记“怎么把我亮出来”，reveal 沿着祖先一路亮上去。 */
const revealers = new WeakMap();

export const revealable = (el, show) => revealers.set(el, show);

/** 把 el 亮出来：展开它所在的折叠块，切到它所在的选项卡或演示的那一帧。 */
export function reveal(el) {
  for (let node = el; node; node = node.parentElement) {
    if (node.tagName === 'DETAILS') node.open = true;
    revealers.get(node)?.();
  }
}

/** 把文字存成文件交给浏览器下载。 */
export function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  h('a', { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

export const today = () => new Date().toLocaleDateString('sv-SE');
