/* 小测的判分：纯函数，不碰页面，可以直接在 Node 里测试。
 * 题目有四种：choice 单选、multi 多选、fill 填空、self 自评。 */

const tidy = (text) => text.normalize('NFKC').trim().toLowerCase();

/** 题型：有选项的是选择题（答案里有逗号就是多选）；没有选项而有答案的是填空；都没有的是自评。 */
export function kindOf(hasOptions, answer) {
  if (hasOptions) return answer.includes(',') ? 'multi' : 'choice';
  return answer ? 'fill' : 'self';
}

/** 读者给的答案对不对。given：选择题是选中的字母（多个用逗号连起来），填空题是填进去的文字。 */
function isRight(kind, answer, given) {
  return kind === 'fill' ? answer.split('|').map(tidy).includes(tidy(given)) : given === answer;
}

/** 给读者看的正确答案："B"、"A、C"，填空题取第一个写法。 */
export function answerText(kind, answer) {
  return kind === 'fill' ? answer.split('|')[0] : answer.toUpperCase().replaceAll(',', '、');
}

/**
 * 作答一次之后题目到了哪一步：right、wrong，或者 retry。
 * retry 是“第一次答错而题目带提示”：先给提示，让读者再试一次。tries 是连这一次在内答了几次。
 */
export function phaseAfter({ kind, answer, hasHint }, tries, given) {
  if (isRight(kind, answer, given)) return 'right';
  return tries === 1 && hasHint ? 'retry' : 'wrong';
}
