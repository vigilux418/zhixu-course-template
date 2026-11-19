'use strict';
/* 生成文件：course/data.js（目录、术语表、搜索索引）与 index.html（无脚本时的目录）。
 * generate 只在内存里生成；regenerate 把结果写出来；build 先替作者转义代码和公式，再写出来。 */
const path = require('path');
const { DATA_FILE, INDEX_FILE, ENGINE_STYLE, ENGINE_SCRIPT, writeText } = require('./files');
const { escapeCourse } = require('./escape');
const { escapeHtml } = require('./html');
const { glossary, anchorOf } = require('./anatomy');
const { lessonEntry, searchEntries } = require('./lesson');
const { checkCourse } = require('./check');

function renderData(lessons) {
  const data = {
    lessons: Object.fromEntries(lessons.map((lesson) => [lesson.file, lessonEntry(lesson)])),
    // id 是定义所在的小节：术语表直接链到那里
    terms: [...glossary(lessons)].map(([term, { def, file, element }]) => ({ term, def, file, id: anchorOf(element) })),
    search: lessons.flatMap(searchEntries)
  };
  return `window.ZHIXU_DATA = ${JSON.stringify(data, null, 2)};\n`;
}

/** 目录里的一行。文件不存在的讲次（lesson 为 undefined）只列出文件名。 */
function lessonItem(file, lesson) {
  if (!lesson) return `<li><a href="${file}">${file}</a></li>`;
  const summary = lesson.description ? `：${escapeHtml(lesson.description)}` : '';
  return `<li><a href="${file}">${escapeHtml(lesson.title || file)}</a>${summary}</li>`;
}

/** 运行时会把这一页换成真正的首页；这里只保证没有脚本时也有一份可用的目录。 */
function renderIndex(course, lessons) {
  const byFile = new Map(lessons.map((lesson) => [lesson.file, lesson]));
  const title = escapeHtml(course.title);
  const lines = [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    `<meta name="description" content="${escapeHtml(course.description || course.subtitle || course.title)}">`,
    `<link rel="stylesheet" href="${ENGINE_STYLE}">`,
    `<script src="${ENGINE_SCRIPT}"></script>`,
    '</head>',
    '<body>',
    '<main>',
    `<h1>${title}</h1>`
  ];
  if (course.subtitle) lines.push(`<p class="lead">${escapeHtml(course.subtitle)}</p>`);
  if (course.description) lines.push(`<p>${escapeHtml(course.description)}</p>`);
  let number = 1;
  for (const unit of course.units) {
    if (unit.title) lines.push(`<h2>${escapeHtml(unit.title)}</h2>`);
    // 讲次在全课里连续编号，所以后面单元的列表接着前面数。
    lines.push(number === 1 ? '<ol>' : `<ol start="${number}">`);
    lines.push(...unit.lessons.map((file) => ' '.repeat(2) + lessonItem(file, byFile.get(file))));
    lines.push('</ol>');
    number += unit.lessons.length;
  }
  lines.push('</main>', '</body>', '</html>', '');
  return lines.join('\n');
}

/**
 * 检查课程，并在内存里生成两个文件。返回 { course, lessons, files, result, outputs }：
 * files 是登记了并且存在的讲义（按阅读顺序），outputs 是 文件名 → 内容；清单读不出来时 outputs 是空的。
 * 有问题也尽量生成：这样边改边预览。
 */
function generate(root, options) {
  const { course, lessons, result } = checkCourse(root, options);
  const outputs = new Map();
  if (course) {
    outputs.set(INDEX_FILE, renderIndex(course, lessons));
    outputs.set(DATA_FILE, renderData(lessons));
  }
  return { course, lessons, files: lessons.map((lesson) => lesson.file), result, outputs };
}

/** 检查课程并写出生成文件，不改讲义。返回 { result, generated }，generated 是写出的文件。 */
function regenerate(root, options) {
  const { result, outputs } = generate(root, options);
  for (const [file, text] of outputs) writeText(path.join(root, file), text);
  return { result, generated: [...outputs.keys()] };
}

/**
 * build：先把代码和公式里没转义的 < 和 & 转义掉（只有这一步会改讲义），再检查并写出生成文件。
 * 返回 { result, generated, escaped }，escaped 是 [{ file, escaped }]。
 */
function build(root, options) {
  const escaped = escapeCourse(root);
  return { ...regenerate(root, options), escaped };
}

module.exports = { generate, regenerate, build };
