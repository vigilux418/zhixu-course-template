'use strict';
/* 链接与资源地址的分类。 */

/** 指向网络的地址：http(s)://，或省略了协议的 //。 */
function isExternal(url) {
  return /^(https?:)?\/\//i.test(url);
}

/** 地址开头的协议名（小写）；没有协议时返回 null。 */
function schemeOf(url) {
  const found = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  return found ? found[1].toLowerCase() : null;
}

/** 把本地地址里的百分号编码还原成文件路径；编码不合法时返回 null。 */
function localPath(reference) {
  try {
    return decodeURIComponent(reference);
  } catch {
    return null;
  }
}

module.exports = { isExternal, schemeOf, localPath };
