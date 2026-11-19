/* 外观与设置：主题、字体、字号；学习记录的备份、恢复与清除；快捷键一览。 */

import { download, h, root, today } from './dom.js';
import { course } from './course.js';
import { panel, show } from './dialogs.js';
import { rebuild } from './boot.js';
import { filled, isRecord } from './record-shape.js';
import { record, saveRecord, setPref } from './store.js';

const CHOICES = [
  {
    name: 'theme',
    legend: '主题',
    options: [
      ['auto', '跟随系统'],
      ['light', '浅色'],
      ['sepia', '纸张'],
      ['dark', '深色']
    ]
  },
  {
    name: 'font',
    legend: '正文字体',
    options: [
      ['serif', '宋体'],
      ['sans', '黑体']
    ]
  }
];

const COMMAND_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

const SHORTCUTS = [
  ['/', `搜索（也可以按 ${COMMAND_KEY} K）`],
  ['[', '上一讲'],
  [']', '下一讲'],
  ['n', '本讲笔记'],
  ['Esc', '关闭浮层']
];

/* 换主题时渐变的颜色令牌。自定义属性要先登记成“颜色”，浏览器才知道怎么在两个值之间过渡。
 * 这份名单和 tokens.css 里每套主题定义的颜色一致（css.test.js 核对）。 */
const THEME_COLORS = [
  '--paper',
  '--wash',
  '--raise',
  '--rule',
  '--rule-strong',
  '--ink',
  '--text',
  '--muted',
  '--accent',
  '--accent-strong',
  '--accent-wash',
  '--on-accent',
  '--mark',
  '--mark-wash',
  '--mark-ink',
  '--lit',
  '--good',
  '--good-wash',
  '--bad',
  '--bad-wash',
  '--seal',
  '--shade',
  '--veil',
  '--code-comment',
  '--code-keyword',
  '--code-string',
  '--code-number',
  '--code-title',
  '--code-type',
  '--code-attr'
];
for (const name of THEME_COLORS) {
  CSS.registerProperty({ name, syntax: '<color>', inherits: true, initialValue: 'transparent' });
}

/**
 * 读者换主题、换字体：颜色渐变过去。过渡只挂在根元素的这些令牌上，用到令牌的地方自然跟着变。
 * 打印前临时换成浅色、别的标签页改了设置，都不经过这里，直接换。
 * （不用视图过渡：WebKit 里过渡还没放完就开关浮层，页面会崩。）
 */
function restyle(change) {
  root.style.transition = THEME_COLORS.map((name) => `${name} var(--dur-2) var(--ease)`).join(', ');
  change();
  void getComputedStyle(root).color; // 读一下样式，过渡现在就开始，下面才等得到它们
  // 都放完了再把 transition 收回去；中途又换了一次的，留给后面那一次来收
  Promise.allSettled(root.getAnimations().map((animation) => animation.finished)).then(() => {
    if (root.getAnimations().length === 0) root.style.transition = '';
  });
}

/** 建好设置浮层，返回“打开设置”的函数。 */
export function setupSettings() {
  const prefs = ZHIXU.prefs();

  const choices = CHOICES.map(({ name, legend, options }) => {
    const buttons = options.map(([value, label]) => {
      const input = h('input', { type: 'radio', name: `zx-${name}`, value, checked: prefs[name] === value });
      input.addEventListener('change', () => restyle(() => setPref(name, value)));
      return h('label', null, input, label);
    });
    return h('fieldset.zx-field', null, h('legend', null, legend), h('div.zx-seg', null, buttons));
  });

  const size = h('input', {
    type: 'range',
    min: '15',
    max: '21',
    step: '1',
    value: String(prefs.size),
    'aria-label': '正文字号'
  });
  const sizeLabel = h('output', null, `${prefs.size} px`);
  size.addEventListener('input', () => {
    sizeLabel.textContent = `${size.value} px`;
    setPref('size', Number(size.value));
  });

  const status = h('p.zx-status', { role: 'status' });
  const picker = h('input', { type: 'file', accept: 'application/json', hidden: true });
  picker.addEventListener('change', async () => {
    status.textContent = restore(await picker.files[0].text());
    picker.value = '';
  });
  const action = (label, onClick) => {
    const button = h('button.zx-btn', { type: 'button' }, label);
    button.addEventListener('click', onClick);
    return button;
  };

  const el = panel(
    'zx-dialog',
    '外观与设置',
    h(
      'div.zx-dialog-body',
      null,
      choices,
      h('fieldset.zx-field', null, h('legend', null, '正文字号'), h('div.zx-size', null, size, sizeLabel)),
      h(
        'fieldset.zx-field',
        null,
        h('legend', null, '学习记录（进度、小测、笔记）'),
        h(
          'div.zx-actions',
          null,
          action('导出备份', backup),
          action('从备份恢复', () => picker.click()),
          action('清除记录', clear),
          picker,
          status
        )
      ),
      h(
        'fieldset.zx-field',
        null,
        h('legend', null, '快捷键'),
        h(
          'dl.zx-keys',
          null,
          SHORTCUTS.map(([key, text]) => [h('dt', null, h('kbd', null, key)), h('dd', null, text)])
        )
      )
    )
  );
  return () => show(el);
}

const FORMAT = 1; // 备份文件的格式版本

function backup() {
  const payload = { app: 'zhixu', format: FORMAT, course: course.id, exported: today(), record: record() };
  download(`${course.id}-学习记录-${today()}.json`, JSON.stringify(payload, null, 2), 'application/json');
}

/** 一句话说清一份记录里有什么。 */
function summarize(data) {
  const answers = Object.values(data.quiz).reduce((sum, lesson) => sum + Object.keys(lesson).length, 0);
  return `已读 ${Object.keys(data.done).length} 讲、笔记 ${Object.keys(data.notes).length} 条、小测记录 ${answers} 条`;
}

/** 读入备份文件。文件来自读者，内容不可信：先校验，再请读者确认，最后一次写入。返回给读者看的结果。 */
function restore(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    return '这不是知序的备份文件。';
  }
  if (payload?.app !== 'zhixu' || typeof payload.exported !== 'string') return '这不是知序的备份文件。';
  if (payload.format !== FORMAT) return '这份备份的格式版本不对，没有恢复。';
  if (payload.course !== course.id) return `这份备份属于另一门课（${payload.course}）。`;
  if (!isRecord(payload.record)) return '备份文件的内容不完整或已损坏，没有恢复。';
  const question = [
    `这份备份导出于 ${payload.exported}，里面有：${summarize(filled(payload.record))}。`,
    `恢复会替换这门课现在的学习记录（${summarize(record())}）。继续吗？`
  ].join('\n');
  if (!confirm(question)) return '没有恢复。';
  if (!saveRecord(payload.record)) return '写入失败：浏览器不允许保存数据。';
  rebuild();
  return '已恢复，正在刷新页面。';
}

function clear() {
  if (!confirm('清除这门课的全部学习记录？这一步无法撤销。')) return;
  saveRecord(null);
  rebuild();
}
