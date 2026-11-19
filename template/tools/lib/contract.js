'use strict';
/* 契约里是数据的部分：提示卡的类型和默认标题，SVG 工具类的颜色名。
 * 检查器从这里读。样式表和写作契约里各有一份同样的内容，由测试逐项核对
 * （母版的 engine/tests/contract.test.js）：改了这里，那两处哪里没跟上，测试会指出来。 */

// 提示卡：类型 → 默认标题
const CALLOUTS = {
  note: '补充',
  insight: '直觉',
  memory: '记忆法',
  question: '想一想',
  pitfall: '易错',
  danger: '警告',
  exam: '考点'
};

// SVG 的颜色名：f-颜色名 是填充，s-颜色名 是描边
const SVG_COLORS = ['ink', 'text', 'muted', 'line', 'accent', 'accent-soft', 'mark', 'mark-soft', 'card', 'soft'];

module.exports = { CALLOUTS, SVG_COLORS };
