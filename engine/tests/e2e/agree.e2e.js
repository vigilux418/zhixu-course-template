'use strict';
/* 工具和运行时各自实现了一遍的规则：小节、自动编号、小测的题干、代码的行号。
 * 工具在生成目录数据、做检查时算一遍，运行时在页面上再算一遍；两边的结果要一样。
 * 不一样的话，目录、搜索结果、留空的链接指向的就是别的东西，逐行讲解会指到别的行。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { REPO, course, newContext, open, lessonFiles } = require('./harness');

const tools = (name) => require(path.join(REPO, 'template', 'tools', 'lib', `${name}.js`));
const { loadLesson } = tools('lesson');
const { codeLineRange, quizParts } = tools('anatomy');
const { attr } = tools('dom');

/** 页面上这一讲的样子：小节、带 id 的图表例式的编号、每道小测的键、每段代码的行数和行号。 */
const onPage = () => {
  const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
  const shown = (el) => {
    const label = (el.querySelector(':scope > figcaption, :scope > caption') ?? el).dataset.label;
    return label.startsWith('(') ? `式 ${label.slice(1, -1)}` : label; // 式的编号显示成 (2-1)
  };
  const numbered = [...document.querySelectorAll('main :is(figure, table, div.example, div.math)[id]')].filter(
    (el) => (el.querySelector(':scope > figcaption, :scope > caption') ?? el).dataset.label
  );
  return {
    sections: [...document.querySelectorAll('main > section[id]:not(.recap)')].map((section) => ({
      id: section.id,
      title: text(section.querySelector(':scope > h2'))
    })),
    labels: Object.fromEntries(numbered.map((el) => [el.id, shown(el)])),
    quizKeys: [...document.querySelectorAll('main div.quiz')].map((quiz) => quiz.dataset.key),
    // 每段代码：[行数, 首行的行号, 末行的行号]。只有带行号或标亮行的代码才按行拆开，别的只有行数
    codeLines: [...document.querySelectorAll('main pre')].map((pre) => {
      const lines = [...pre.querySelectorAll('.zx-line')].map((line) => Number(line.dataset.line));
      return lines.length ? [lines.length, lines[0], lines.at(-1)] : [pre.textContent.split('\n').length, null, null];
    })
  };
};

for (const name of ['sample', 'matrix', 'edge', 'calculus']) {
  test(`${name} 课：工具算出来的小节、编号、小测的键、代码的行号，和页面上的一样`, async () => {
    const { hash } = await import(pathToFileURL(path.join(REPO, 'engine', 'src', 'js', 'plain.js')));
    const root = course(name);
    const context = await newContext();
    for (const [index, file] of lessonFiles(root).entries()) {
      const lesson = loadLesson(root, file, index + 1);
      const page = await open(context, root, file);
      const data = await page.evaluate((lessonFile) => window.ZHIXU_DATA.lessons[lessonFile], file);
      const expected = {
        sections: data.sections,
        labels: data.labels,
        quizKeys: lesson.quizzes.map((quiz) => attr(quiz, 'id') || `q${hash(quizParts(quiz).stemText)}`),
        codeLines: lesson.elements
          .filter((element) => element.name === 'pre')
          .map((pre) => codeLineRange(pre))
          .map(({ first, last }) => [last - first + 1, first, last])
      };
      const found = await page.evaluate(onPage);
      // 页面上没有按行拆开的代码，只比行数
      expected.codeLines = expected.codeLines.map((lines, at) =>
        found.codeLines[at]?.[1] === null ? [lines[0], null, null] : lines
      );
      assert.deepEqual(found, expected, `${name}/${file}`);
      assert.equal(data.quizzes, expected.quizKeys.length, `${name}/${file}：目录数据里的小测数`);
      await page.close();
    }
    await context.close();
  });
}
