/* 学习记录的形状：只在这里定义一次（FIELDS），空白记录、备份的校验都从它出发。
 * 这里都是纯函数，不碰页面和存储，可以直接在 Node 里测试。 */

import { dict, own } from './plain.js';

const isText = (value) => typeof value === 'string';
const isList = (isItem) => (value) => Array.isArray(value) && value.every(isItem);
const isMap = (isItem) => (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(isItem);
const isAnswer = (value) =>
  isMap(() => true)(value) && typeof value.ok === 'boolean' && [value.at, value.stem, value.id].every(isText);

/* 字段名 → [空值怎么造, 值合不合格]。
 * 这一讲现在有哪些小测不记在这里：它是课程内容的属性，由 data.js 提供，见 answersOf。 */
const FIELDS = {
  done: [dict, isMap(isText)], // 文件名 → 读完的日期
  place: [dict, isMap(isText)], // 文件名 → 上次读到的小节 id
  quiz: [dict, isMap(isMap(isAnswer))], // 文件名 → { 小测键: { ok, at, stem, id } }
  tasks: [dict, isMap(isList(isText))], // 文件名 → 已勾选的任务键
  notes: [dict, isMap(isText)], // 文件名 → 笔记正文
  tabs: [() => [], isList(isText)], // 最近选过的选项卡名，新的在前
  last: [() => null, (value) => value === null || isText(value)] // 最近打开的一讲
};

/* 早先的版本把每讲的题目清单也存在记录里（data.js 现在自己带着，见 answersOf）。
 * 那时的备份文件里还有这个字段：认得、也照样校验，但恢复时丢掉。格式和 FIELDS 一样，好一起查。 */
const LEGACY = { quizKeys: [dict, isMap(isList(isText))] };

/** 把一份可能缺字段的记录补全（没有记录时给 null）；不认识的旧字段不带走。 */
export const filled = (data) => {
  const source = data ?? dict();
  return Object.fromEntries(
    Object.entries(FIELDS).map(([field, [empty, fits]]) => {
      const value = own(source, field);
      return [field, fits(value) ? value : empty()];
    })
  );
};

/** 一份来自外面的数据（备份文件）是不是合格的记录：每个字段都认识，值都合格。 */
export const isRecord = (data) => {
  if (!isMap(() => true)(data)) return false;
  return Object.entries(data).every(([field, value]) => {
    const known = own(FIELDS, field) ?? own(LEGACY, field);
    return Boolean(known) && known[1](value);
  });
};

/** 某一讲里仍然有效的小测记录：题目改过或删掉之后，旧记录留在存储里，但不再计入。
 * 这一讲现在有哪些题，看的是当前这一版的 data.js：另一版课打开过，也不会借来它的题目清单。 */
export function answersOf(data, file, keys) {
  return Object.entries(data.quiz[file] ?? dict())
    .filter(([key]) => !keys || keys.includes(key))
    .map(([, answer]) => answer);
}
