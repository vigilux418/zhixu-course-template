'use strict';
/* 课程大纲（zx outline）：每一讲的时长和字数、小节、可以引用的编号和已经定义的术语。
 * 写新的一讲、或者要引用别的讲之前先看它，不必把别的讲从头读一遍。 */
const { glossary } = require('./anatomy');
const { lessonEntry, wordCount } = require('./lesson');

const INDENT = ' '.repeat(2);

/** 一讲的几行：标题行、各小节、可以引用的图表公式、这一讲定义的术语。 */
function lessonLines(lesson, terms) {
  const { title, minutes, quizzes, sections, labels } = lessonEntry(lesson);
  const facts = [`约 ${minutes} 分钟`, `正文 ${wordCount(lesson)} 字`, quizzes > 0 && `${quizzes} 道小测`]
    .filter(Boolean)
    .join('，');
  const lines = [`第 ${lesson.number} 讲  ${lesson.file}  ${title}（${facts}）`];
  sections.forEach((section, index) => {
    lines.push(`${INDENT}${lesson.number}.${index + 1}  #${section.id}  ${section.title}`);
  });
  const numbered = Object.entries(labels).map(([id, label]) => `${label} #${id}`);
  if (numbered.length > 0) lines.push(`${INDENT}可引用：${numbered.join(' · ')}`);
  const defined = terms.filter(([, term]) => term.file === lesson.file).map(([term]) => term);
  if (defined.length > 0) lines.push(`${INDENT}术语：${defined.join('、')}`);
  return lines;
}

/** 大纲的文字。course 是课程清单，lessons 是读入的各讲（都来自 checkCourse）。 */
function formatOutline(course, lessons) {
  const terms = [...glossary(lessons)];
  const byFile = new Map(lessons.map((lesson) => [lesson.file, lesson]));
  const minutes = lessons.reduce((sum, lesson) => sum + lessonEntry(lesson).minutes, 0);
  const lines = [
    `${course.title}（标识 ${course.id}）：${lessons.length} 讲，约 ${minutes} 分钟`,
    '引用别的讲：<a href="文件名#id"></a>，文字留空会自动填上“第 N 讲”“2.1 节”“图 2-1”；已定义的术语直接写 <dfn>术语</dfn>。',
    '字数是正文里的汉字加西文单词，代码和公式不算。'
  ];
  for (const unit of course.units) {
    lines.push('', unit.title || '（未分单元）');
    for (const file of unit.lessons) {
      const lesson = byFile.get(file);
      const body = lesson ? lessonLines(lesson, terms) : [`${file}（文件不存在）`];
      lines.push(...body.map((line) => INDENT + line));
    }
  }
  return lines.join('\n');
}

module.exports = { formatOutline };
