'use strict';
/* 检查整门课：课程清单、每一讲的规则、跨讲的规则。不写任何文件。 */
const path = require('path');
const { TEMPLATE_DIR, COURSE_FILE, isFile, isInside, rootHtmlFiles } = require('./files');
const { loadCourse } = require('./course');
const { loadLesson } = require('./lesson');
const { localPath } = require('./refs');
const { reporterFor, summarize } = require('./report');
const { checkDocument } = require('./rules-document');
const { checkStructure } = require('./rules-structure');
const { checkMarkup } = require('./rules-markup');
const { checkCode } = require('./rules-code');
const { checkMedia } = require('./rules-media');
const { checkWidgets } = require('./rules-widgets');
const { checkText } = require('./rules-text');
const { checkLinks } = require('./rules-links');
const { checkTerms, checkQuizDuplicates, checkUnlisted } = require('./rules-course');
const { checkExamples } = require('./rules-examples');

// 每条规则的签名都是 (lesson, report, site)。
const LESSON_RULES = [
  checkDocument,
  checkStructure,
  checkMarkup,
  checkCode,
  checkMedia,
  checkWidgets,
  checkText,
  checkLinks
];

function compare(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// 页面结构的规则。标签没闭合时，后面这些规则报出来的多半只是连带的症状。
const STRUCTURE_RULES = new Set([
  'main/one',
  'main/h1',
  'lead/position',
  'goals/position',
  'section/id',
  'section/h2',
  'section/nested',
  'recap/position'
]);

/**
 * 一个文件里有标签没闭合时，把它后面的结构问题收起来，只在那条“没有闭合”上注明收了几条：
 * 根因修好之前，后面的结构报错没有参考价值，逐条去改只会越改越乱。problems 已经按位置排好。
 */
function foldCascades(problems) {
  const kept = [];
  const roots = new Map(); // 文件 → 它的第一条“没有闭合”
  for (const problem of problems) {
    const root = roots.get(problem.file);
    if (root && STRUCTURE_RULES.has(problem.rule)) {
      root.folded += 1;
      continue;
    }
    if (!root && problem.rule === 'html/unclosed') roots.set(problem.file, { problem, folded: 0 });
    kept.push(problem);
  }
  for (const { problem, folded } of roots.values()) {
    if (folded > 0) problem.message += `。先修这一处：后面还有 ${folded} 条页面结构的报错多半是它引起的，已经收起`;
  }
  return kept;
}

/** 排序：先课程清单，再按阅读顺序排各讲，最后是其他文件；同一文件内按位置。 */
function sortProblems(problems, files) {
  const order = [COURSE_FILE, ...files];
  const rank = (file) => (order.includes(file) ? order.indexOf(file) : order.length);
  return problems.sort(
    (a, b) =>
      rank(a.file) - rank(b.file) ||
      compare(a.file, b.file) ||
      a.line - b.line ||
      a.col - b.col ||
      compare(a.rule, b.rule)
  );
}

/** 规则核对链接、图片和模板资源时要用的全课信息：登记的各讲、模板目录，以及课程目录里有没有某个文件。 */
function createSite(root, lessons, templateDir = TEMPLATE_DIR) {
  return {
    lessons: new Map(lessons.map((lesson) => [lesson.file, lesson])),
    templateDir,
    hasFile(reference) {
      const relative = localPath(reference);
      if (!relative) return false;
      const file = path.resolve(root, relative);
      return isInside(root, file) && isFile(file);
    }
  };
}

/**
 * 检查课程，返回 { course, lessons, result }；result 是 { ok, errors, warnings, lessons, problems }。
 * 根目录下没有登记的页面也按一讲的规则检查，但不算进 lessons：它们不参与生成，别的讲也不能链接过去。
 */
function checkCourse(root, { templateDir = TEMPLATE_DIR } = {}) {
  const { course, files, missing, problems } = loadCourse(root);
  const lessons = files
    .map((file, index) => (missing.includes(file) ? null : loadLesson(root, file, index + 1)))
    .filter(Boolean);
  const unlisted = rootHtmlFiles(root)
    .filter((file) => !files.includes(file))
    .map((file) => loadLesson(root, file));
  const site = createSite(root, lessons, templateDir);
  const pages = [...lessons, ...unlisted];
  const places = new Map(pages.map((page) => [page.file, page.toOriginal]));
  const reportFor = (file) => reporterFor(file, problems, places.get(file));
  for (const page of pages) {
    const report = reportFor(page.file);
    if (page.unescaped > 0) {
      report.error(
        page.firstUnescaped,
        'code/unescaped',
        `代码或公式里有 ${page.unescaped} 处 < 或 & 没有转义（这是第一处）。运行 build 会自动改好`
      );
    }
    for (const problem of page.doc.problems) report.error(problem, problem.rule, problem.message);
    for (const rule of LESSON_RULES) rule(page, report, site);
  }
  checkTerms(lessons, reportFor);
  checkQuizDuplicates(lessons, reportFor);
  checkUnlisted(unlisted, reportFor);
  const notes = checkExamples(pages, reportFor);
  return { course, lessons, result: summarize(foldCascades(sortProblems(problems, files)), files.length, notes) };
}

module.exports = { checkCourse };
