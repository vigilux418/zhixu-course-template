'use strict';
/* look 与 CDP 生命周期故障回归：开页/检查抛错必关浏览器、子进程提前退出不悬挂、导航 errorText 与超时立即失败。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const EventEmitter = require('events');
const { PassThrough } = require('stream');
const { lib, fragmentPage, makeCourse } = require('./helpers');

const { connect, openPage, launchBrowser } = lib('browser');
const { look } = lib('look');

/** 造一个最小 CDP 子进程替身：fd 3 为写入管道，fd 4 为读取管道。 */
function fakeChild(onRequest) {
  const child = new EventEmitter();
  const input = new PassThrough();
  const output = new PassThrough();
  let buf = '';
  input.setEncoding('utf8');
  input.on('data', (chunk) => {
    buf += chunk;
    for (let end = buf.indexOf('\0'); end !== -1; end = buf.indexOf('\0')) {
      const req = JSON.parse(buf.slice(0, end));
      buf = buf.slice(end + 1);
      if (onRequest) onRequest(req, (msg) => output.write(`${JSON.stringify(msg)}\0`));
    }
  });
  child.stdio = [null, null, null, input, output];
  return { child, input, output };
}

test('look：newPage 抛错时仍调用 browser.close() 并保留原始错误', async () => {
  const root = makeCourse({ 'lesson.html': fragmentPage('<p>正文。</p>') });
  let closeCalls = 0;
  await assert.rejects(
    () =>
      look(root, ['lesson.html'], {
        launch: async () => ({
          name: 'fake-chrome',
          newPage: async () => {
            throw new Error('模拟体检开页失败');
          },
          close: async () => {
            closeCalls += 1;
          }
        })
      }),
    /模拟体检开页失败/
  );
  assert.equal(closeCalls, 1);
});

test('look：检查失败且 close() 也抛错时，仍保留原始检查错误不被覆盖', async () => {
  const root = makeCourse({ 'lesson.html': fragmentPage('<p>正文。</p>') });
  let closeCalls = 0;
  await assert.rejects(
    () =>
      look(root, ['lesson.html'], {
        launch: async () => ({
          name: 'fake-chrome',
          newPage: async () => ({
            errors: [],
            setView: async () => {
              throw new Error('模拟页面崩溃');
            }
          }),
          close: async () => {
            closeCalls += 1;
            throw new Error('二次关闭错误');
          }
        })
      }),
    /模拟页面崩溃/
  );
  assert.equal(closeCalls, 1);
});

test('browser：子进程提前退出时，挂起的 CDP 请求立即 reject 而非永久悬挂', async () => {
  const { child } = fakeChild();
  const cdp = connect(child);
  const pending = cdp.send('Target.createTarget', { url: 'about:blank' });
  child.emit('exit', 1, null);
  await assert.rejects(() => pending, /Target\.createTarget：浏览器已退出/);
  await assert.rejects(() => cdp.send('Browser.close'), /Browser\.close：浏览器已退出/);
});

test('browser：Page.navigate 返回 errorText 且无 load 事件时，goto 立即失败不悬挂', async () => {
  const { child } = fakeChild((req, reply) => {
    if (req.method === 'Target.createTarget') return reply({ id: req.id, result: { targetId: 't1' } });
    if (req.method === 'Target.attachToTarget') return reply({ id: req.id, result: { sessionId: 's1' } });
    if (req.method === 'Page.navigate') return reply({ id: req.id, result: { errorText: 'net::ERR_FILE_NOT_FOUND' } });
    return reply({ id: req.id, result: {} });
  });
  const cdp = connect(child);
  const page = await openPage(cdp);
  await assert.rejects(() => page.goto('file:///missing.html', 2000), /net::ERR_FILE_NOT_FOUND/);
});

test('browser：等待 load 事件期间浏览器退出或超时时，goto 均能及时 reject', async () => {
  const { child } = fakeChild((req, reply) => {
    if (req.method === 'Target.createTarget') return reply({ id: req.id, result: { targetId: 't1' } });
    if (req.method === 'Target.attachToTarget') return reply({ id: req.id, result: { sessionId: 's1' } });
    return reply({ id: req.id, result: {} });
  });
  const cdp = connect(child);
  const page = await openPage(cdp);
  // 超时分支
  await assert.rejects(() => page.goto('file:///hang.html', 50), /页面导航超时/);
  // 等待期间进程退出分支
  const nav = page.goto('file:///crash.html', 5000);
  setTimeout(() => child.emit('exit', 139, null), 10);
  await assert.rejects(() => nav, /浏览器已退出/);
});

test('browser：导航命令没有应答时，goto 仍按导航时限退出', { timeout: 1000 }, async () => {
  const { child } = fakeChild((req, reply) => {
    if (req.method === 'Target.createTarget') return reply({ id: req.id, result: { targetId: 't1' } });
    if (req.method === 'Target.attachToTarget') return reply({ id: req.id, result: { sessionId: 's1' } });
    if (req.method !== 'Page.navigate') reply({ id: req.id, result: {} });
  });
  const page = await openPage(connect(child));
  await assert.rejects(() => page.goto('file:///hang.html', 30), /超时/);
});

test('browser：关闭命令没有应答时，仍终止进程并清理临时配置', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { child } = fakeChild();
  let signal;
  child.kill = (value) => {
    signal = value;
    child.emit('exit', null, signal);
    return true;
  };
  let profile;
  const browser = await launchBrowser(process.execPath, (_exe, flags) => {
    const prefix = '--user-data-dir=';
    profile = flags.find((flag) => flag.startsWith(prefix)).slice(prefix.length);
    return child;
  });
  assert.ok(fs.existsSync(profile));
  const closed = browser.close();
  t.mock.timers.tick(3000);
  await closed;
  assert.equal(signal, 'SIGKILL');
  assert.equal(fs.existsSync(profile), false);
});
