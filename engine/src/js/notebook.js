/* 学习笔记：每讲一页纯文本，输入即保存；可以把全课笔记导出成 Markdown。
 * 宽屏上笔记停靠在正文右边的页边里，不遮正文，可以边读边写；窄一些的屏幕上是从右侧滑出的面板。 */

import { $, download, h, wideScreen } from './dom.js';
import { course, lessonName, lessons, page } from './course.js';
import { panel, show } from './dialogs.js';
import { onClear, pageSignal } from './boot.js';
import { onRemoteChange, record, update } from './store.js';

let toggle; // 笔记面板第一次用到时才建

/** 打开笔记；停靠着的时候再调用一次就收起。 */
export function toggleNotes() {
  toggle ??= buildNotebook();
  toggle();
}

function buildNotebook() {
  const area = h('textarea.zx-notes', {
    'aria-label': '本讲笔记',
    autofocus: true,
    placeholder: '写下这一讲的要点、疑问和想法。内容只保存在这台设备上。'
  });
  const status = h('span', { role: 'status' });
  const adopt = h('button.zx-btn', { type: 'button', hidden: true }, '载入最新内容');
  const exportButton = h('button.zx-btn', { type: 'button' }, '导出全部笔记');
  const el = panel(
    'zx-dialog.zx-dialog--sheet',
    '本讲笔记',
    area,
    h('div.zx-dialog-foot', null, status, h('div', null, adopt, exportButton))
  );
  // 面板放进正文的版面里：停靠时它才能正好占住页边那两栏（见 overlays.css 的 .zx-dock）
  $('main').append(h('div.zx-dock', null, el));
  // 面板在正文栏里，换页时连同正文一起换下来：下一页要用的时候再建一个，配的是下一页的笔记
  onClear(() => {
    toggle = undefined;
  });

  const stored = () => record().notes[page.file] ?? '';
  let baseline = stored(); // 这一页上次读到或存下的内容；文本框和它不一样，就是有还没存进去的草稿

  const load = () => {
    baseline = stored();
    area.value = baseline;
    status.textContent = '';
    adopt.hidden = true;
  };

  area.addEventListener('input', () => {
    // 存之前先看一眼：别的标签页的通知可能还没到，存储里的笔记如果已经变了，就不能拿这里的旧底稿去覆盖
    let changedElsewhere = false;
    const saved = update((data) => {
      changedElsewhere = (data.notes[page.file] ?? '') !== baseline;
      if (changedElsewhere) return;
      if (area.value.trim()) data.notes[page.file] = area.value;
      else delete data.notes[page.file];
    });
    if (changedElsewhere) {
      status.textContent = '这一讲的笔记在别处改过，这里的内容还没保存';
      adopt.hidden = false;
    } else if (saved) {
      baseline = stored();
      status.textContent = '已保存';
    } else {
      status.textContent = '没有保存：浏览器不允许存储';
    }
  });
  adopt.addEventListener('click', () => {
    load();
    area.focus(); // 按钮随即隐藏：把焦点交还给文本框，光标放在末尾，可以接着写
    area.setSelectionRange(area.value.length, area.value.length);
  });
  exportButton.addEventListener('click', exportNotes);
  // 别的标签页改了笔记：这里没有草稿的话，就换成最新内容
  onRemoteChange(() => {
    if (area.value === baseline) load();
  }, pageSignal());

  // 停靠着的面板不是模态浮层：Esc 要自己接；窗口变窄、页边没有了，就收起来
  const docked = () => el.open && !el.matches(':modal');
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.isComposing && docked()) el.close();
  });
  wideScreen.addEventListener(
    'change',
    () => {
      if (docked()) el.close();
    },
    { signal: pageSignal() }
  );

  load(); // 面板刚建好：先把存着的笔记读进来
  return () => {
    if (el.open) {
      el.close(); // 只有停靠着的时候才走得到这里：模态的面板开着时，按钮和快捷键都碰不到
      return;
    }
    if (area.value === baseline) load();
    if (wideScreen.matches) el.show();
    else show(el);
  };
}

function exportNotes() {
  const notes = record().notes;
  const chapters = lessons
    .filter((lesson) => notes[lesson.file])
    .map((lesson) => `## ${lessonName(lesson)} ${lesson.title}\n\n${notes[lesson.file].trim()}\n`);
  download(`${course.id}-笔记.md`, `# ${course.title} 笔记\n\n${chapters.join('\n')}`, 'text/markdown');
}
