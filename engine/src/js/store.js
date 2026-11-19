/* 学习记录的读写：每门课一份，存在浏览器本地。记录长什么样，在 record-shape.js 里。
 * 每次修改都先读后写，所以同时开着几个标签页，别的字段也不会丢。 */

import { course } from './course.js';
import { h } from './dom.js';
import { filled } from './record-shape.js';

const KEY = `zhixu:course:${course.id}`;

export function record() {
  return filled(ZHIXU.read(KEY));
}

let warned = false;

/** 写入；浏览器不允许存储时返回 false，并在页面顶部说明一次。 */
function persist(data) {
  const saved = ZHIXU.write(KEY, data);
  if (!saved && !warned) {
    warned = true;
    const text = '学习记录无法保存：浏览器不允许这个页面存储数据。阅读不受影响，但进度、小测和笔记不会留下来。';
    document.body.prepend(h('p.zx-alert', { role: 'alert' }, text));
  }
  return saved;
}

/** 修改记录：先读最新的，改完再写。返回是否写入成功。 */
export function update(change) {
  const data = record();
  change(data);
  return persist(data);
}

/** 整份替换（恢复备份）；传入 null 即清空。返回是否写入成功。 */
export const saveRecord = persist;

/** 别的标签页改了这门课的记录时，调用 listener。signal 跟着调用它的那一页一起失效。 */
export function onRemoteChange(listener, signal) {
  addEventListener(
    'storage',
    (event) => {
      if (event.key === KEY) listener();
    },
    { signal }
  );
}

export function setPref(name, value) {
  ZHIXU.write('zhixu:prefs', { ...ZHIXU.prefs(), [name]: value });
  ZHIXU.applyPrefs();
}
