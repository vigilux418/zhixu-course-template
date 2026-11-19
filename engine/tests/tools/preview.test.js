'use strict';
/* preview：静态文件服务、改动后自动重新生成、路径越界、端口占用。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { lib, fragmentPage, makeCourse } = require('./helpers');

const { startPreview } = lib('preview');

/** 不经过 URL 规范化，按原样发出请求路径。 */
function get(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: requestPath, agent: false }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () =>
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8')
        })
      );
    });
    request.on('error', reject);
  });
}

async function startOn(t, root, firstPort, options) {
  const logs = [];
  const { server, port } = await startPreview(root, firstPort, (text) => logs.push(text), options);
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { port, logs };
}

/** 改写文件，并把修改时间往后拨，避免文件系统的时间精度影响测试。 */
function rewrite(file, content, secondsAhead) {
  fs.writeFileSync(file, content);
  const later = new Date(Date.now() + secondsAhead * 1000);
  fs.utimesSync(file, later, later);
}

test('启动时先生成一次，然后按类型提供文件', async (t) => {
  const root = makeCourse({
    'lesson.html': fragmentPage('<p>第一版。</p>'),
    'images/a.png': 'png',
    'notes/readme.md': '# 说明',
    'files/data.bin': 'bin'
  });
  const { port, logs } = await startOn(t, root, 0);
  assert.deepEqual(logs, ['✓ 检查通过（1 讲，0 个 warning）']);

  const home = await get(port, '/');
  assert.equal(home.status, 200);
  assert.equal(home.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(home.headers['cache-control'], 'no-store');
  assert.match(home.body, /<h1>测试课程<\/h1>/);

  const types = [
    ['/lesson.html', 'text/html; charset=utf-8'],
    ['/course/data.js?v=1', 'text/javascript; charset=utf-8'],
    ['/images/a.png', 'image/png'],
    ['/notes/readme.md', 'text/markdown; charset=utf-8'],
    ['/files/data.bin', 'application/octet-stream']
  ];
  for (const [requestPath, type] of types) {
    const response = await get(port, requestPath);
    assert.equal(response.status, 200, requestPath);
    assert.equal(response.headers['content-type'], type);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  assert.equal(logs.length, 1);
});

test('讲义或清单改动后，下一次请求页面或数据前自动重新生成', async (t) => {
  const root = makeCourse({ 'lesson.html': fragmentPage('<p>第一版。</p>') });
  const { port, logs } = await startOn(t, root, 0);
  assert.match((await get(port, '/course/data.js')).body, /第一版/);

  rewrite(path.join(root, 'lesson.html'), fragmentPage('<p>第二版 a < b。</p>'), 5);
  assert.equal((await get(port, '/template/zhixu.css')).status, 404);
  assert.equal(logs.length, 1);
  const data = await get(port, '/course/data.js');
  assert.match(data.body, /第二版/);
  assert.equal(logs.length, 2);
  assert.match(logs[1], /html\/lt/);
  assert.match(logs[1], /✗ 1 个 error/);

  await get(port, '/lesson.html');
  assert.equal(logs.length, 2);

  fs.writeFileSync(path.join(root, 'extra.html'), fragmentPage('<p>新的一讲。</p>'));
  await get(port, '/');
  assert.equal(logs.length, 3);
  assert.match(logs[2], /course\/unlisted/);
});

test('不存在的文件、目录和越出课程目录的路径都是 404', async (t) => {
  const root = makeCourse({ 'lesson.html': fragmentPage('<p>正文。</p>'), 'images/a.png': 'png' });
  const secret = path.join(root, '..', `${path.basename(root)}-secret.txt`);
  fs.writeFileSync(secret, 'secret');
  t.after(() => fs.rmSync(secret));
  const { port } = await startOn(t, root, 0);
  const name = path.basename(secret);
  const outside = [
    '/missing.html',
    '/images',
    '/images/',
    `/../${name}`,
    `/..%2f${name}`,
    `/%2e%2e/${name}`,
    `/..\\${name}`,
    `/images/../../${name}`,
    `//${name}`,
    '/%zz',
    '/lesson.html%00.png'
  ];
  for (const requestPath of outside) {
    const response = await get(port, requestPath);
    assert.equal(response.status, 404, requestPath);
    assert.doesNotMatch(response.body, /secret/);
  }
});

test('端口被占用时换下一个', async (t) => {
  const root = makeCourse({ 'lesson.html': fragmentPage('<p>正文。</p>') });
  const first = await startOn(t, root, 0);
  const second = await startOn(t, root, first.port);
  assert.ok(second.port > first.port && second.port <= first.port + 20);
  assert.equal((await get(second.port, '/lesson.html')).status, 200);
});

test('刷新时清单短暂缺失（ENOENT）：返回 503 诊断而不崩进程，恢复后下一次请求正常重新生成', async (t) => {
  const root = makeCourse({ 'lesson.html': fragmentPage('<p>第一版。</p>') });
  const { port, logs } = await startOn(t, root, 0);
  const courseFile = path.join(root, 'course', 'course.js');
  const backup = fs.readFileSync(courseFile, 'utf8');

  fs.unlinkSync(courseFile);
  const failed = await get(port, '/lesson.html');
  assert.equal(failed.status, 503);
  assert.match(failed.body, /ENOENT/);
  assert.match(logs.at(-1), /ENOENT/);

  fs.writeFileSync(courseFile, backup);
  rewrite(path.join(root, 'lesson.html'), fragmentPage('<p>恢复后的第二版。</p>'), 5);
  const recovered = await get(port, '/course/data.js');
  assert.equal(recovered.status, 200);
  assert.match(recovered.body, /恢复后的第二版/);
});

test('刷新生成失败（EBUSY）时不提前提交指纹，同一份修改在下一次请求中重试并恢复', async (t) => {
  const { regenerate } = lib('build');
  const root = makeCourse({ 'lesson.html': fragmentPage('<p>第一版。</p>') });
  let calls = 0;
  let failOnce = false;
  const { port, logs } = await startOn(t, root, 0, {
    regenerate: (dir) => {
      calls += 1;
      if (failOnce) {
        failOnce = false;
        const err = new Error('file busy');
        err.code = 'EBUSY';
        throw err;
      }
      return regenerate(dir);
    }
  });
  assert.equal(calls, 1);

  rewrite(path.join(root, 'lesson.html'), fragmentPage('<p>瞬态失败后的新内容。</p>'), 5);
  failOnce = true;
  const first = await get(port, '/course/data.js');
  assert.equal(first.status, 503);
  assert.match(first.body, /EBUSY/);
  assert.match(logs.at(-1), /EBUSY/);
  assert.equal(calls, 2);

  // 文件未再变动（指纹完全相同），下一次请求必须重新尝试生成并成功返回新数据
  const retry = await get(port, '/course/data.js');
  assert.equal(retry.status, 200);
  assert.match(retry.body, /瞬态失败后的新内容/);
  assert.equal(calls, 3);
});
