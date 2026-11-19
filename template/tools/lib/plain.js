'use strict';
/* 不碰页面也不碰文件的小工具：运行时 engine/src/js/plain.js 里有同样的算法，工具这边要独立算一遍。 */

/**
 * 稳定的短哈希（FNV-1a）。运行时用它给没有 id 的小测和任务生成键，工具生成 data.js 里的题目清单时算的是同一个；
 * 算法一改，读者答过的题、勾过的任务就都对不上了。agree.e2e.js 核对两边的结果。
 */
function hash(text) {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value = Math.imul(value ^ text.charCodeAt(index), 0x01000193);
  }
  return (value >>> 0).toString(36);
}

module.exports = { hash };
