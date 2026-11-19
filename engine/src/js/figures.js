/* 图与表：宽表格横向滚动；显示得比原图小的图，可以点开看原始大小；
 * 正文栏里放不下的表格、代码和图，宽屏上伸进右侧的页边。 */

import { $, $$, h, keyboardScrollable, tool } from './dom.js';
import { dialog, show } from './dialogs.js';
import { onClear } from './boot.js';

/** 图的原始宽度：位图是它的像素宽，内联 SVG 是 viewBox 的宽。 */
const naturalWidth = (media) => media.naturalWidth ?? media.viewBox.baseVal.width;

/** 只有显示得比原图小的图才值得放大：给它所在的 figure 加上 .zx-zoom。 */
function judge(media) {
  const shrunk = naturalWidth(media) > media.getBoundingClientRect().width + 1;
  media.parentElement.classList.toggle('zx-zoom', shrunk);
}

export function enhanceFigures(main) {
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
export function fitWide() {
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
export function refitOnResize(column) {
  let width = column.clientWidth;
  const observer = new ResizeObserver(() => {
    if (column.clientWidth === width) return;
    width = column.clientWidth;
    requestAnimationFrame(fitWide);
  });
  observer.observe(column);
  onClear(() => observer.disconnect());
}
