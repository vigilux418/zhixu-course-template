/* 代码块：语法着色、文件名、行号、标亮行、逐行讲解、复制。 */

import { $$, h, icon, keyboardScrollable } from './dom.js';

export async function enhanceCode(main) {
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
