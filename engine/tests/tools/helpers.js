'use strict';
/* 测试用的小工具：拼讲义、建临时课程、运行检查和命令行。 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');
const TEMPLATE = path.join(REPO, 'template');
const ZX = path.join(TEMPLATE, 'tools', 'zx.js');

/** 加载 template/tools/lib 下的模块。 */
const lib = (name) => require(path.join(TEMPLATE, 'tools', 'lib', name));

/** n 个空格。测试数据里的缩进都用它生成，不依赖源码里的连续空格。 */
const pad = (n) => ' '.repeat(n);

const HEAD = [
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>测试讲</title>',
  '<meta name="description" content="用于测试的一讲。">',
  '<link rel="stylesheet" href="template/zhixu.css">',
  '<script src="template/zhixu.js"></script>'
].join('\n');

/** 完整的 HTML 文档：给定 <head> 和 <body> 的内容。 */
function htmlPage(head, body) {
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    head,
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>',
    ''
  ].join('\n');
}

/** 一讲：content 是 <main> 里 <h1> 之后的内容。 */
function lessonPage(content) {
  return htmlPage(HEAD, ['<main>', '<h1>测试讲</h1>', content, '</main>'].join('\n'));
}

function section(content, id = 'part') {
  return [`<section id="${id}">`, '<h2>小节</h2>', content, '</section>'].join('\n');
}

/** 一讲：fragment 放在唯一的小节里。 */
function fragmentPage(fragment) {
  return lessonPage(section(fragment));
}

function courseSource(course) {
  return `window.ZHIXU_COURSE = ${JSON.stringify(course, null, 2)};\n`;
}

const tempRoots = [];
process.on('exit', () => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

function tempDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zx-test-'));
  tempRoots.push(root);
  return root;
}

/**
 * 在临时目录里建一门课，返回它的根目录。files 是 { 相对路径: 内容 }。
 * 没有给 course/course.js 时自动生成：一个单元，按 files 里的顺序登记根目录下除首页外的所有 HTML。
 */
function makeCourse(files) {
  const root = tempDir();
  const lessons = Object.keys(files).filter((name) => /^[^/]+\.html$/.test(name) && name !== 'index.html');
  const all = { 'course/course.js': courseSource({ id: 'test', title: '测试课程', units: [{ lessons }] }), ...files };
  for (const [name, content] of Object.entries(all)) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

/** 检查一门临时课程，返回问题列表。 */
function problemsOf(files) {
  return lib('check').checkCourse(makeCourse(files)).result.problems;
}

/** 只有一讲、fragment 放在小节里的课程的问题列表。 */
function problemsIn(fragment) {
  return problemsOf({ 'lesson.html': fragmentPage(fragment) });
}

function rulesOf(problems) {
  return problems.map((problem) => problem.rule);
}

/** 在 cwd 下运行命令行，返回 { status, stdout, stderr }。 */
function runCli(cwd, ...args) {
  return spawnSync(process.execPath, [ZX, ...args], { cwd, encoding: 'utf8' });
}

module.exports = {
  TEMPLATE,
  lib,
  pad,
  HEAD,
  htmlPage,
  lessonPage,
  section,
  fragmentPage,
  courseSource,
  tempDir,
  makeCourse,
  problemsOf,
  problemsIn,
  rulesOf,
  runCli
};
