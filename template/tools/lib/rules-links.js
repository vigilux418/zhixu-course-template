'use strict';
/* 链接：本地链接必须指向真实存在的文件和锚点；留空的链接必须是引擎能填上编号的那几种。 */
const { INDEX_FILE } = require('./files');
const { attr, getAttr, childElements, textOf } = require('./dom');
const { schemeOf } = require('./refs');
const { isEngineId } = require('./anatomy');
const { numberedSections } = require('./lesson');

const EXTERNAL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
const ROOT_HTML = /^[^\\/]+\.html$/;
const EMPTY_LINK = '留空的链接只能指向某一讲、有编号的小节，或带 id 的图、表、例题、公式；其他链接要写上链接文字';

/** 引擎能否给指向 page 里 id 的空链接填上编号。 */
function hasLabel(page, id) {
  return page.labels.has(id) || numberedSections(page).some((section) => attr(section, 'id') === id);
}

/** 指向某一讲（page）的链接的问题；id 是 # 后面的部分，没有 # 时为 undefined。 */
function lessonLinkFlaw(page, sameFile, id, empty) {
  if (id === undefined) return sameFile ? ['link/target', '链接地址是空的'] : null;
  if (isEngineId(id)) return ['link/target', `不能链接到 #${id}：zx- 开头的 id 由引擎生成，随时可能变化`];
  if (!page.ids.has(id)) return ['link/target', `${page.file} 里没有 id="${id}" 的元素`];
  return empty && !hasLabel(page, id) ? ['link/empty', EMPTY_LINK] : null;
}

/** 链接的问题，形如 [规则, 说明]；没有问题时返回 null。 */
function linkFlaw(href, empty, lesson, site) {
  const scheme = schemeOf(href);
  if (scheme || href.startsWith('//')) {
    if (!EXTERNAL_SCHEMES.has(scheme))
      return ['link/target', `不支持的链接地址 ${href}：外部链接要写完整的 https:// 地址`];
    return empty ? ['link/empty', EMPTY_LINK] : null;
  }
  // 与运行时一样按 # 切开：前半是文件，后半是 id。
  const [file, id] = href.split('#');
  const page = file === '' ? lesson : site.lessons.get(file);
  if (page) return lessonLinkFlaw(page, file === '', id, empty);
  if (empty) return ['link/empty', EMPTY_LINK];
  if (file === INDEX_FILE) return id === undefined ? null : ['link/target', '首页没有可以链接的锚点'];
  if (ROOT_HTML.test(file)) return ['link/target', `${file} 不是课程里的一讲：文件名要与 course.js 里登记的完全一致`];
  return site.hasFile(file) ? null : ['link/target', `找不到 ${file}：本地链接要指向课程目录里存在的文件`];
}

function checkLinks(lesson, report, site) {
  for (const element of lesson.elements) {
    const href = element.name === 'a' ? getAttr(element, 'href') : undefined;
    if (href) {
      const empty = textOf(element).trim() === '' && childElements(element).length === 0;
      const flaw = linkFlaw(href.value, empty, lesson, site);
      if (flaw) report.error(href, ...flaw);
    }
  }
}

module.exports = { checkLinks };
