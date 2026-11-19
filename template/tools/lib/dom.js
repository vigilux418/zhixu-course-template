'use strict';
/* 在解析出的树上取东西的小工具。 */

// 这些元素的开始标签会让浏览器自动结束还没闭合的 <p>，所以不能出现在 <p> 或行内容器里。
const BLOCK_ELEMENTS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'dd',
  'details',
  'dialog',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'hr',
  'li',
  'main',
  'menu',
  'nav',
  'ol',
  'p',
  'pre',
  'search',
  'section',
  'summary',
  'table',
  'ul'
]);

const isBlock = (node) => BLOCK_ELEMENTS.has(node.name);
const isElement = (node) => node.type === 'element';
const isText = (node) => node.type === 'text';

/** 属性对象（带位置）；没有这个属性时返回 undefined。 */
function getAttr(element, name) {
  return element.attrs.find((attr) => attr.name === name);
}

/** 属性值；没有这个属性时返回 undefined。 */
function attr(element, name) {
  const found = getAttr(element, name);
  return found && found.value;
}

/** 去掉首尾空白的属性值；没有这个属性时是空串。 */
function attrText(element, name) {
  return (attr(element, name) || '').trim();
}

function classesOf(element) {
  return attrText(element, 'class').split(/\s+/).filter(Boolean);
}

function hasClass(element, name) {
  return classesOf(element).includes(name);
}

/** 相当于选择器 name.className。 */
function is(node, name, className) {
  return node.name === name && hasClass(node, className);
}

function childElements(node) {
  return node.children.filter(isElement);
}

/** 按文档顺序遍历所有后代元素。 */
function* descendants(node) {
  for (const child of childElements(node)) {
    yield child;
    yield* descendants(child);
  }
}

/** 文字内容，但跳过 skip(element) 为真的子树。 */
function textExcept(node, skip) {
  if (isText(node)) return node.value;
  if (!node.children || skip(node)) return '';
  return node.children.map((child) => textExcept(child, skip)).join('');
}

function textOf(node) {
  return textExcept(node, () => false);
}

/** 把连续空白折叠成一个空格，并去掉首尾空白。 */
function collapse(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/** 去掉注释和纯空白文字之后的子节点。 */
function significantChildren(node) {
  return node.children.filter((child) => child.type !== 'comment' && !(isText(child) && child.value.trim() === ''));
}

/** 第一个不是文字的子节点（元素或注释）；全是文字时返回 undefined。 */
function firstNonText(element) {
  return element.children.find((child) => !isText(child));
}

/** 从 element 自己开始向上，找第一个满足 test 的元素。 */
function closest(element, test) {
  for (let node = element; isElement(node); node = node.parent) {
    if (test(node)) return node;
  }
  return null;
}

function previousElement(element) {
  const siblings = childElements(element.parent);
  return siblings[siblings.indexOf(element) - 1];
}

function firstBlockInside(element) {
  for (const inner of descendants(element)) {
    if (isBlock(inner)) return inner;
  }
  return null;
}

module.exports = {
  isBlock,
  isElement,
  isText,
  getAttr,
  attr,
  attrText,
  classesOf,
  hasClass,
  is,
  childElements,
  descendants,
  textExcept,
  textOf,
  collapse,
  significantChildren,
  firstNonText,
  closest,
  previousElement,
  firstBlockInside
};
