'use strict';
/* 问题的收集、汇总与输出。 */

/** 没有更具体的位置时，问题报告在文件开头。 */
const FILE_START = { line: 1, col: 1 };

/**
 * 返回往 problems 里追加问题的 { error, warn }；at 是任何带 line、col 的对象（节点、属性或位置）。
 * place 把规则看到的位置换算成要报告的位置（讲义是按转义之后的样子检查的，见 lesson.js）。
 */
function reporterFor(file, problems, place = (at) => at) {
  const add = (level) => (at, rule, message) => {
    const { line, col } = place(at);
    problems.push({ file, line, col, level, rule, message });
  };
  return { error: add('error'), warn: add('warning') };
}

/** notes 是不算问题、但要让人知道的说明（比如跳过了哪些检查）。 */
function summarize(problems, lessonCount, notes) {
  const errors = problems.filter((problem) => problem.level === 'error').length;
  return { ok: errors === 0, errors, warnings: problems.length - errors, lessons: lessonCount, problems, notes };
}

/** 只看其中几个文件的问题；别处还有问题时，在说明里提一句。 */
function focusOn(result, files) {
  const mine = result.problems.filter((problem) => files.includes(problem.file));
  const others = result.problems.length - mine.length;
  const more = others > 0 ? [`其他文件里还有 ${others} 个问题；不带讲义名运行 build 可以看到全部`] : [];
  return summarize(mine, files.length, [...result.notes, ...more]);
}

/** 文字在终端里占几格：汉字和全角符号占两格。 */
const widthOf = (text) => [...text].reduce((sum, char) => sum + (char.codePointAt(0) > 0xff ? 2 : 1), 0);

/** 在右边补空格，补到 width 格。 */
const padTo = (text, width) => text + ' '.repeat(Math.max(0, width - widthOf(text)));

function widest(texts) {
  return Math.max(...texts.map((text) => text.length));
}

/** 一个文件的问题：先是文件名，然后每个问题一行，各列对齐，最后空一行。 */
function fileBlock(file, problems) {
  const gap = ' '.repeat(2);
  const places = problems.map((problem) => `${problem.line}:${problem.col}`);
  const placeWidth = widest(places);
  const ruleWidth = widest(problems.map((problem) => problem.rule));
  const rows = problems.map((problem, index) => {
    const cells = [
      places[index].padEnd(placeWidth),
      problem.level.padEnd('warning'.length),
      problem.rule.padEnd(ruleWidth),
      problem.message
    ];
    return gap + cells.join(gap);
  });
  return [file, ...rows, ''];
}

/** 人读的报告：问题按文件分组，最后一行是汇总。 */
function formatReport(result) {
  const byFile = new Map();
  for (const problem of result.problems) {
    if (!byFile.has(problem.file)) byFile.set(problem.file, []);
    byFile.get(problem.file).push(problem);
  }
  const blocks = [...byFile].flatMap(([file, problems]) => fileBlock(file, problems));
  const summary = result.ok
    ? `✓ 检查通过（${result.lessons} 讲，${result.warnings} 个 warning）`
    : `✗ ${result.errors} 个 error，${result.warnings} 个 warning（${result.lessons} 讲）`;
  return [...blocks, ...result.notes, summary].join('\n');
}

module.exports = { FILE_START, reporterFor, summarize, focusOn, formatReport, widthOf, padTo };
