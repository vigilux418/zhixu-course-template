'use strict';
/* 跨讲的规则：术语的定义与引用、题干重复的小测、没有登记的页面。 */
const { attr, attrText, getAttr } = require('./dom');
const { glossary, quizParts, termOf } = require('./anatomy');
const { FILE_START } = require('./report');

/** 同一个术语全课只定义一次；不带定义的 <dfn> 必须能在术语表里找到。 */
function checkTerm(dfn, terms, report) {
  const term = termOf(dfn);
  const entry = terms.get(term);
  const def = attrText(dfn, 'data-def');
  if (entry && def !== '' && entry.element !== dfn) {
    const where = `${entry.file} 第 ${entry.element.line} 行`;
    report.warn(
      dfn,
      'term/duplicate',
      `术语“${term}”已经在 ${where}定义过；这里去掉 data-def，只写 <dfn>${term}</dfn>`
    );
  }
  // 术语本身为空、或 data-def 写了却是空的，由 term/empty 报告。
  if (!entry && term !== '' && getAttr(dfn, 'data-def') === undefined) {
    report.error(
      dfn,
      'term/undefined',
      `术语“${term}”全课都没有定义：在它第一次出现的地方写 <dfn data-def="…">${term}</dfn>`
    );
  }
}

function checkTerms(lessons, reportFor) {
  const terms = glossary(lessons);
  for (const lesson of lessons) {
    const report = reportFor(lesson.file);
    for (const element of lesson.elements) {
      if (element.name === 'dfn') checkTerm(element, terms, report);
    }
  }
}

/** 没有 id 的小测靠题干文字区分；同一讲里题干相同，学习记录就会混在一起。
 * 学习记录按讲义文件分开存，两个文件里的小测互不相干，不算重复。 */
function checkQuizDuplicates(lessons, reportFor) {
  for (const lesson of lessons) {
    const seen = new Map();
    for (const quiz of lesson.quizzes.filter((element) => !attr(element, 'id'))) {
      const { stemText } = quizParts(quiz);
      const first = seen.get(stemText);
      if (first) {
        reportFor(lesson.file).error(
          quiz,
          'quiz/duplicate',
          `这道小测的题干与第 ${first} 行的相同：学习记录按题干区分这两道题，会串在一起。改写题干，或给其中一道加上 id`
        );
      } else {
        seen.set(stemText, quiz.line);
      }
    }
  }
}

/** unlisted 是根目录下没有登记到清单里的页面。 */
function checkUnlisted(unlisted, reportFor) {
  for (const { file } of unlisted) {
    reportFor(file).error(
      FILE_START,
      'course/unlisted',
      `${file} 没有登记到 course/course.js。根目录下的 HTML 只能是首页和登记了的各讲：把它登记进清单，或者移出根目录`
    );
  }
}

module.exports = { checkTerms, checkQuizDuplicates, checkUnlisted };
