/* 全文搜索的浮层。怎么匹配、摘哪一段，在 matching.js 里。 */

import { $, $$, composing, h, icon } from './dom.js';
import { lessonByFile, lessonName, searchIndex } from './course.js';
import { dialog, show } from './dialogs.js';
import { arrive, carryFind } from './find.js';
import { excerptOf, searchHits, splitHits, wordsOf } from './matching.js';

/** 建好搜索浮层，返回“打开搜索”的函数。 */
export function setupSearch() {
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
