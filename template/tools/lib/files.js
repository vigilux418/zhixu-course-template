'use strict';
/* 路径与文件读写。所有文本都按 UTF-8、LF 换行处理。 */
const fs = require('fs');
const { createRequire } = require('module');
const path = require('path');
const vm = require('vm');

const TEMPLATE_DIR = path.resolve(__dirname, '..', '..');
const COURSE_FILE = 'course/course.js';
const DATA_FILE = 'course/data.js';
const INDEX_FILE = 'index.html';
// 每个页面 <head> 里引用的引擎文件，相对课程根目录。
const ENGINE_STYLE = 'template/zhixu.css';
const ENGINE_SCRIPT = 'template/zhixu.js';

/** 用法或环境问题（不是课程内容的问题）；命令行据此以状态码 2 退出。 */
class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

const TEXT = '; charset=utf-8';
const MIME_TYPES = new Map([
  ['.html', `text/html${TEXT}`],
  ['.css', `text/css${TEXT}`],
  ['.js', `text/javascript${TEXT}`],
  ['.json', `application/json${TEXT}`],
  ['.txt', `text/plain${TEXT}`],
  ['.md', `text/markdown${TEXT}`],
  ['.csv', `text/csv${TEXT}`],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.mp3', 'audio/mpeg'],
  ['.m4a', 'audio/mp4'],
  ['.ogg', 'audio/ogg'],
  ['.wav', 'audio/wav'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.vtt', 'text/vtt'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.pdf', 'application/pdf'],
  ['.zip', 'application/zip']
]);

/** 按扩展名给出文件的 MIME 类型。 */
function mimeOf(file) {
  return MIME_TYPES.get(path.extname(file).toLowerCase()) || 'application/octet-stream';
}

const BOM = String.fromCharCode(0xfeff);

/** 去掉 BOM，把 CRLF / CR 统一成 LF。 */
function normalizeText(text) {
  return (text.startsWith(BOM) ? text.slice(1) : text).replace(/\r\n?/g, '\n');
}

function readText(file) {
  return normalizeText(fs.readFileSync(file, 'utf8'));
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function isFile(file) {
  return fs.existsSync(file) && fs.statSync(file).isFile();
}

/** 讲义的文件名：小写字母、数字和连字符，加上 .html；首页不是讲义。 */
function isLessonFile(name) {
  return /^[a-z0-9][a-z0-9-]*\.html$/.test(name) && name !== INDEX_FILE;
}

/** file 是否在目录 root 里面；两者都要是规范化的绝对路径。 */
function isInside(root, file) {
  return file.startsWith(root + path.sep);
}

/** 课程根目录下除首页外的 HTML 文件名，按字典序。 */
function rootHtmlFiles(root) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html') && entry.name !== INDEX_FILE)
    .map((entry) => entry.name)
    .sort();
}

/** 在不污染 require.cache 的情况下，按给定路径与源码重新求值一个 CommonJS 第三方库。 */
function loadCjsModule(file, source) {
  const mod = { exports: {} };
  const code = source.startsWith(BOM) ? source.slice(1) : source;
  const fn = vm.runInThisContext(`(function (exports, require, module, __filename, __dirname) {\n${code}\n})`, {
    filename: file
  });
  fn(mod.exports, createRequire(file), mod, file, path.dirname(file));
  return mod.exports;
}

module.exports = {
  TEMPLATE_DIR,
  COURSE_FILE,
  DATA_FILE,
  INDEX_FILE,
  ENGINE_STYLE,
  ENGINE_SCRIPT,
  UsageError,
  readText,
  writeText,
  isFile,
  isLessonFile,
  isInside,
  mimeOf,
  rootHtmlFiles,
  loadCjsModule
};
