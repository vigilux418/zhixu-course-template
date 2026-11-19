/* 公式：用内置的 KaTeX 排版 .math 里的 LaTeX。 */

import { $, $$, keyboardScrollable } from './dom.js';

/* 读屏软件读公式，靠的是 KaTeX 输出里的 MathML。可是元素的“名字”只能是一串文字，MathML 进不去：
 * 选项、表头、链接、折叠标题这些靠自己的内容得名的地方，公式对名字没有贡献，只写了一个公式的选项就成了没有名字的单选框。
 * 这些地方的公式改当“一幅带替代文字的图”，替代文字是作者写的 LaTeX。
 * 旁注的注文不算它所在元素的名字，里面的公式照旧。 */
const NAMED_BY_CONTENT = 'a, button, dfn, label, summary, th, caption, figcaption, h1, h2, h3, h4';

const partOfName = (formula) => Boolean(formula.closest(`${NAMED_BY_CONTENT}, .zx-note`)?.matches(NAMED_BY_CONTENT));

export async function enhanceMath(main) {
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
