/* 在页面里换页：单文件里换到另一讲时，从已经载入的数据里替换属于“这一页”的部分。
 * 跟着整个会话走的（搜索和设置的浮层、快捷键、打印）只建一次；属于一页的（正文、目录栏、这一页的全局监听、
 * 观察器、根元素上这一页的状态）换页时收拾干净：全局监听带上 pageSignal()，别的由各自的模块用 onClear 登记。
 * 检验的办法是：换页换到的一页，和直接打开的同一页一模一样（packed.e2e.js）。 */

import { $, discardScrollers, h, root } from './dom.js';
import { showPage } from './course.js';

let scope = new AbortController(); // 这一页的全局监听；换页时整批撤掉，下一页换一个新的
const cleanups = []; // 换页之前要做的事，这一页的模块自己登记

/** 属于这一页的全局监听要带上的 signal。 */
export const pageSignal = () => scope.signal;

/** 登记换页之前要做的一件事。只对这一页有效：做完就忘掉，下一页要的话自己再登记。 */
export const onClear = (cleanup) => cleanups.push(cleanup);

/* 一页的正文：讲页是 <main>，首页是 renderHome 换上去的 .zx-home */
const bodyOf = () => $('main') ?? $('.zx-home');

/** 换到 to 这一页（单文件里：它的正文就在已经读进来的数据里），render 负责把它搭起来。 */
export async function turn(to, render) {
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
export function failed(error) {
  console.error(error);
  root.classList.remove('zx-loading');
  bodyOf().prepend(h('p.zx-alert', { role: 'alert' }, `这一页没有正常显示：${error.message}。正文仍可阅读。`));
}

/** 记录整份换掉了，页面上的进度、小测、笔记都要按存储里最新的重来：文件夹里刷新这一页；
 * 单文件里使用已载入的数据重搭这一页。 */
export function rebuild() {
  if (ZHIXU.packed) ZHIXU.onTurn(ZHIXU.file);
  else location.reload();
}
