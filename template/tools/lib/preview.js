'use strict';
/* 本地预览：只监听 127.0.0.1 的静态文件服务器；讲义改动后，下一次打开页面前自动重新生成数据。 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { COURSE_FILE, DATA_FILE, INDEX_FILE, UsageError, isInside, mimeOf, rootHtmlFiles } = require('./files');
const { localPath } = require('./refs');
const { regenerate } = require('./build');
const { formatReport } = require('./report');

const HOST = '127.0.0.1';
const PORT_ATTEMPTS = 21;
// Windows 上被系统保留的端口报 EACCES，和被占用一样换下一个。
const PORT_TAKEN = new Set(['EADDRINUSE', 'EACCES']);
const PLAIN = 'text/plain; charset=utf-8';

/** 手写文件的修改时间合成的指纹：讲义增删改、清单改动都会让它变化。 */
function sourceStamp(root) {
  return [COURSE_FILE, ...rootHtmlFiles(root)]
    .map((file) => `${file}:${fs.statSync(path.join(root, file)).mtimeMs}`)
    .join('|');
}

/** 返回一个函数：手写文件自上次成功生成以来有变化时，重新生成（不改讲义），并把检查报告交给 log。
 * 生成失败时不更新指纹，下一次请求继续重试。 */
function createRefresher(root, log, build = regenerate) {
  let builtStamp = null;
  return () => {
    const stamp = sourceStamp(root);
    if (stamp === builtStamp) return;
    const { result } = build(root);
    builtStamp = stamp;
    log(formatReport(result));
  };
}

/** 请求地址对应的文件路径；地址不合法或落在课程目录之外时返回 null。 */
function resolveRequest(root, url) {
  const pathname = localPath(url.split('?')[0]);
  if (pathname === null || pathname.includes('\0')) return null;
  const file = path.join(root, pathname === '/' ? INDEX_FILE : pathname);
  return isInside(root, file) ? file : null;
}

function respond(response, status, type, body) {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  response.end(body);
}

function createServer(root, refresh, log) {
  const dataFile = path.join(root, DATA_FILE);
  const notFound = (response) => respond(response, 404, PLAIN, '404 找不到这个文件');
  return http.createServer((request, response) => {
    const file = resolveRequest(root, request.url);
    if (!file) {
      notFound(response);
      return;
    }
    if (file.endsWith('.html') || file === dataFile) {
      try {
        refresh();
      } catch (error) {
        const message = `预览刷新失败：${error.code ?? error.message}`;
        log(message);
        respond(response, 503, PLAIN, `${message}；请保存完成后刷新重试`);
        return;
      }
    }
    fs.readFile(file, (error, body) => {
      if (error) {
        notFound(response);
        return;
      }
      respond(response, 200, mimeOf(file), body);
    });
  });
}

function listenOn(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

/** 从 firstPort 起找一个能用的端口并开始监听，返回实际的端口号。 */
async function listen(server, firstPort) {
  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt += 1) {
    try {
      await listenOn(server, firstPort + attempt);
      return server.address().port;
    } catch (error) {
      if (!PORT_TAKEN.has(error.code)) throw error;
    }
  }
  throw new UsageError(`端口 ${firstPort}–${firstPort + PORT_ATTEMPTS - 1} 都不可用，请用 --port 换一个`);
}

/** 启动预览服务器，返回 { server, port }。每次重新生成后的检查报告交给 log(text)。 */
async function startPreview(root, firstPort, log, options = {}) {
  const refresh = createRefresher(root, log, options.regenerate);
  refresh();
  const server = createServer(root, refresh, log);
  const port = await listen(server, firstPort);
  return { server, port };
}

module.exports = { startPreview };
