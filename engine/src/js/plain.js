/* 不碰页面的小工具：没有依赖，可以直接在 Node 里测试。 */

/** 没有原型的空对象：用作字典。 */
export const dict = () => Object.create(null);

/** 键是数据里来的（小测 id、备份里的字段名）时，只认对象自己的键：JSON 读回来的对象没有原型上那些键可用。 */
export const own = (object, key) => (Object.hasOwn(object, key) ? object[key] : undefined);

/**
 * 稳定的短哈希（FNV-1a），用来给没有 id 的小测和任务生成键。
 * 键存在读者的学习记录里：算法一改，读者答过的题、勾过的任务就都对不上了。
 */
export function hash(text) {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value = Math.imul(value ^ text.charCodeAt(index), 0x01000193);
  }
  return (value >>> 0).toString(36);
}
