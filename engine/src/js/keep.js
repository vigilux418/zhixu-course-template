/* 断行的两处修正。
 * 禁则：行内公式和旁注序号在浏览器眼里是“原子”，原子前后一律允许断行，
 * 后面的标点、前面的开引号因此会掉到下一行的行首或留在上一行的行尾。
 * 这里把“开引号 + 公式或旁注序号 + 紧跟的旁注 + 收尾标点”包进一个不折行的容器（.zx-keep）。
 * 旁注序号不和它前面的那个字分开，是样式管的（components.css 的“旁注的序号”），这里不用动页面结构。
 * 长串：很长的网址和标识符中间没有断行点，会整个掉到下一行，把上一行的字距拉开。
 * 允许“随便断”的话，三个内核又各有各的断法，收尾标点常被留在行首。这里只在字符之间放 <wbr>：
 * 一簇是一个字符连着它后面的收尾标点，开引号连着它后面的那个字符，断点因此永远不在禁则的位置。 */

import { $$, h } from './dom.js';

const CLOSERS = /^[，。、；：？！）》」』”’〉】〕］｝,.;:?!)\]%]+/;

const QUOTES = '“”‘’「」『』"\'`';

const OPENERS = `（《〈【〔［｛([{${QUOTES}`;

const OPENERS_ONLY = /^[（《〈【〔［｛“‘「『([{]$/;

const LONG_RUN = /[!-~]{20,}/; // 连续 20 个以上不带空格的西文字符

export function tuneBreaks(main) {
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
