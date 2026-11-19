/* 落到命中处：搜索结果和术语表把要找的词带到目标页，目标页把它们标出来、滚到第一处。
 * 词记在 sessionStorage 里，同一个标签页里从这一页带到下一页；标记用 CSS 自定义高亮，不改动页面结构。 */

import { $, reveal } from './dom.js';
import { page } from './course.js';
import { onClear, pageSignal } from './boot.js';

const FIND_KEY = 'zhixu:find';
/* 这些地方的文字不在搜索索引里：答案、排好版的公式，以及引擎自己加的按钮和标签 */
const UNSEARCHED =
  '.katex, svg, .hint, .explain, details.answer, .zx-answers, .zx-ref, .zx-quiz-bar, .zx-stepper-bar, .zx-tablist, .zx-code-bar, button';

/** 记下要找的词（小写），等 file 这一页来取；id 是命中的那一小节，空串表示整讲。 */
export function carryFind(words, file, id) {
  ZHIXU.write(FIND_KEY, { words, file, id }, 'sessionStorage');
}

/**
 * 落到该去的地方：前进后退时用历史位置，其余时候用搜索命中或链接里的锚点；目标藏着的话先亮出来。
 * 页面启动完、以及本页的地址变了（点了本页的链接）之后各调用一次。
 */
export function arrive() {
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
