'use strict';
/* 文档骨架与禁用内容：doctype、<head> 里的六行，以及不允许出现的元素、属性和外部资源。 */
const { ENGINE_STYLE, ENGINE_SCRIPT } = require('./files');
const { attr, attrText, getAttr, isElement, isText, significantChildren, textOf } = require('./dom');
const { isExternal } = require('./refs');
const { FILE_START } = require('./report');

const FORBIDDEN_ELEMENTS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form']);
const URL_ATTRIBUTES = new Map([
  ['img', ['src', 'srcset']],
  ['source', ['src', 'srcset']],
  ['audio', ['src']],
  ['video', ['src', 'poster']],
  ['track', ['src']],
  ['link', ['href']]
]);

function isEngineScript(element) {
  return element.name === 'script' && attr(element, 'src') === ENGINE_SCRIPT && element.parent.name === 'head';
}

const isMeta = (element, name) => element.name === 'meta' && attr(element, 'name') === name;
const flawless = () => null;

// <head> 里必须有且只有这六行。flaw(element) 返回这一行写错的地方，没有问题时返回 null。
const HEAD_LINES = [
  {
    label: '<meta charset="utf-8">',
    matches: (element) => element.name === 'meta' && getAttr(element, 'charset') !== undefined,
    flaw: (element) => (attr(element, 'charset').toLowerCase() === 'utf-8' ? null : 'charset 必须是 utf-8')
  },
  {
    label: '<meta name="viewport" content="width=device-width, initial-scale=1">',
    matches: (element) => isMeta(element, 'viewport'),
    flaw: flawless
  },
  {
    label: '<title>',
    matches: (element) => element.name === 'title',
    flaw: (element) => (textOf(element).trim() ? null : '<title> 不能为空：它是这一讲在目录里的名字')
  },
  {
    label: '<meta name="description" content="…">',
    matches: (element) => isMeta(element, 'description'),
    flaw: (element) => (attrText(element, 'content') ? null : '摘要的 content 不能为空')
  },
  {
    label: `<link rel="stylesheet" href="${ENGINE_STYLE}">`,
    matches: (element) =>
      element.name === 'link' && attr(element, 'rel') === 'stylesheet' && attr(element, 'href') === ENGINE_STYLE,
    flaw: flawless
  },
  {
    label: `<script src="${ENGINE_SCRIPT}"></script>`,
    matches: isEngineScript,
    flaw: (element) => (element.attrs.length === 1 ? null : '引擎脚本只能有 src 属性，不能带 async、defer 或 type')
  }
];

function checkHead(head, report) {
  const found = new Map();
  for (const node of significantChildren(head)) {
    const line = HEAD_LINES.find(({ matches }) => isElement(node) && matches(node));
    if (line && !found.has(line)) {
      found.set(line, node);
    } else if (line) {
      report.error(node, 'head/extra', `重复的 ${line.label}`);
    } else if (isText(node) || !FORBIDDEN_ELEMENTS.has(node.name)) {
      report.error(node, 'head/extra', '<head> 里只能有骨架里的六行，其他内容请删掉');
    }
  }
  for (const line of HEAD_LINES) {
    const element = found.get(line);
    const flaw = element ? line.flaw(element) : `<head> 里缺少 ${line.label}`;
    if (flaw) report.error(element || head, 'head/required', flaw);
  }
}

function kindOf(node) {
  return isElement(node) ? node.name : node.type;
}

/** parent 的有效子节点是否恰好依次是 kinds 这几种。 */
function hasShape(parent, kinds) {
  const nodes = significantChildren(parent);
  return nodes.length === kinds.length && nodes.every((node, index) => kindOf(node) === kinds[index]);
}

function checkSkeleton(lesson, report) {
  const { root } = lesson.doc;
  const [doctype] = significantChildren(root);
  if (!hasShape(root, ['doctype', 'html']) || doctype.value.toLowerCase() !== 'html') {
    report.error(FILE_START, 'html/document', '文件必须以 <!doctype html> 开头，后面只有一个 <html> 元素');
  }
  if (!lesson.html) return;
  if (!hasShape(lesson.html, ['head', 'body'])) {
    report.error(lesson.html, 'html/document', '<html> 里必须依次是 <head> 和 <body>，不能有别的内容');
  }
  if (!attrText(lesson.html, 'lang')) {
    report.error(lesson.html, 'head/lang', '<html> 必须有 lang 属性，如 lang="zh-CN"');
  }
  if (lesson.head) checkHead(lesson.head, report);
}

function srcsetUrls(value) {
  return value.split(',').map((candidate) => candidate.trim().split(/\s+/)[0]);
}

/** 元素引用的外部资源地址（图片、音视频、样式表）。 */
function externalUrls(element) {
  const urls = [];
  for (const name of URL_ATTRIBUTES.get(element.name) || []) {
    const value = attr(element, name) || '';
    urls.push(...(name === 'srcset' ? srcsetUrls(value) : [value.trim()]));
  }
  return urls.filter(isExternal);
}

function checkForbidden(element, report) {
  if (FORBIDDEN_ELEMENTS.has(element.name) && !isEngineScript(element)) {
    report.error(element, 'forbidden/element', `不允许使用 <${element.name}>`);
  }
  for (const attribute of element.attrs) {
    const name = attribute.name.toLowerCase();
    if (name === 'style' || name.startsWith('on')) {
      report.error(
        attribute,
        'forbidden/attr',
        `不允许使用 ${attribute.name} 属性：样式用契约里的类名，交互由引擎提供`
      );
    }
  }
  for (const url of externalUrls(element)) {
    report.error(element, 'forbidden/external', `不允许引用外部资源 ${url}：图片、音视频和字体要放在本地`);
  }
}

function checkDocument(lesson, report) {
  checkSkeleton(lesson, report);
  for (const element of lesson.elements) checkForbidden(element, report);
}

module.exports = { checkDocument };
