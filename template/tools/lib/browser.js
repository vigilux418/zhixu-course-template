'use strict';
/* 驱动本机的 Chrome 或 Edge：无头启动，经调试协议的管道收发消息。不依赖任何第三方包。 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { UsageError } = require('./files');

const PROGRAM_DIRS = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(
  Boolean
);
const CANDIDATES = {
  win32: PROGRAM_DIRS.flatMap((dir) => [
    path.join(dir, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(dir, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ]),
  darwin: ['Google Chrome', 'Microsoft Edge', 'Chromium'].flatMap((name) =>
    ['/Applications', path.join(os.homedir(), 'Applications')].map((dir) =>
      path.join(dir, `${name}.app`, 'Contents', 'MacOS', name)
    )
  ),
  // 其他系统：到 PATH 里按名字找
  default: (process.env.PATH || '')
    .split(path.delimiter)
    .flatMap((dir) =>
      ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'].map((name) =>
        path.join(dir, name)
      )
    )
};

/** 本机的 Chrome 或 Edge；环境变量 ZX_BROWSER 可以直接指定。找不到时说明怎么办。 */
function findBrowser() {
  const candidates = [process.env.ZX_BROWSER, ...(CANDIDATES[process.platform] || CANDIDATES.default)];
  const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!found) {
    throw new UsageError(
      '找不到 Chrome 或 Edge，没法做渲染检查。装一个，或者用环境变量 ZX_BROWSER 指定浏览器可执行文件的路径'
    );
  }
  return found;
}

const NAV_TIMEOUT = 15000;
const COMMAND_TIMEOUT = 30000;
const CLOSE_TIMEOUT = 3000;

/* 调试协议走管道：每条消息是一段 JSON，以 \0 结尾。往 fd 3 写，从 fd 4 读。 */
function connect(child) {
  const [, , , input, output] = child.stdio;
  const waiting = new Map(); // 消息编号 → { resolve, reject, method, timer }
  const listeners = new Set();
  const closeListeners = new Set();
  let lastId = 0;
  let pending = '';
  let closedError = null;

  const failAll = (error) => {
    if (closedError) return;
    closedError = error;
    for (const call of waiting.values()) {
      clearTimeout(call.timer);
      call.reject(new Error(`${call.method}：${error.message}`));
    }
    waiting.clear();
    for (const onClose of [...closeListeners]) onClose(error);
    closeListeners.clear();
  };

  child.once('error', (error) => failAll(new Error(`浏览器启动失败：${error.message}`)));
  child.once('exit', (code, signal) => failAll(new Error(`浏览器已退出（code=${code}, signal=${signal}）`)));
  input.on('error', (error) => failAll(new Error(`浏览器调试管道写入失败：${error.message}`)));
  output.once('close', () => failAll(new Error('浏览器调试管道已关闭')));

  output.setEncoding('utf8');
  output.on('data', (chunk) => {
    pending += chunk;
    for (let end = pending.indexOf('\0'); end !== -1; end = pending.indexOf('\0')) {
      const message = JSON.parse(pending.slice(0, end));
      pending = pending.slice(end + 1);
      if (message.id === undefined) {
        for (const listen of listeners) listen(message);
        continue;
      }
      const call = waiting.get(message.id);
      if (!call) continue;
      waiting.delete(message.id);
      clearTimeout(call.timer);
      if (message.error) call.reject(new Error(`${call.method}：${message.error.message}`));
      else call.resolve(message.result);
    }
  });
  return {
    listeners,
    onClose(listener) {
      if (closedError) {
        listener(closedError);
        return () => {};
      }
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    send(method, params, sessionId, timeoutMs = COMMAND_TIMEOUT) {
      if (closedError) return Promise.reject(new Error(`${method}：${closedError.message}`));
      const id = ++lastId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          reject(new Error(`${method}：调试命令超时（${timeoutMs} ms）`));
        }, timeoutMs);
        waiting.set(id, { resolve, reject, method, timer });
        try {
          input.write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
        } catch (error) {
          waiting.delete(id);
          clearTimeout(timer);
          reject(new Error(`${method}：${error.message}`));
        }
      });
    }
  };
}

/** 把一个函数连同参数写成能在页面里求值的表达式。 */
const callOf = (fn, args) => `(${fn})(${args.map((arg) => JSON.stringify(arg)).join(', ')})`;

/** 一个标签页。errors 里是这一页自上次 goto 以来的报错。 */
async function openPage(cdp) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params, timeoutMs) => cdp.send(method, params, sessionId, timeoutMs);
  const errors = [];
  let onLoad = null;
  let onFail = null;
  cdp.onClose((error) => {
    const fail = onFail;
    onLoad = null;
    onFail = null;
    if (fail) fail(error);
  });
  cdp.listeners.add(({ method, params, sessionId: from }) => {
    if (from !== sessionId) return;
    if (method === 'Page.loadEventFired' && onLoad) onLoad();
    if (method === 'Runtime.exceptionThrown') {
      const { exception, text } = params.exceptionDetails;
      errors.push(exception?.description?.split('\n')[0] ?? text);
    }
    if (method === 'Log.entryAdded' && params.entry.level === 'error') errors.push(params.entry.text);
    if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
      errors.push(params.args.map((arg) => arg.value ?? arg.description).join(' '));
    }
  });
  await Promise.all(['Page.enable', 'Runtime.enable', 'Log.enable', 'DOM.enable', 'CSS.enable'].map((m) => send(m)));

  return {
    errors,
    /** 视口大小；media 为 'print' 时按打印样式排版。 */
    async setView({ width, height, media = '' }) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await send('Emulation.setEmulatedMedia', { media });
    },
    /** 打开一个地址，等它的 load 事件；导航报错、超时或浏览器退出时立即失败。 */
    async goto(url, timeoutMs = NAV_TIMEOUT) {
      errors.length = 0;
      let timer;
      const loaded = new Promise((resolve, reject) => {
        onLoad = resolve;
        onFail = reject;
        timer = setTimeout(() => reject(new Error(`页面导航超时（${timeoutMs} ms）：${url}`)), timeoutMs);
      });
      const navigate = send('Page.navigate', { url }, timeoutMs).then((reply) => {
        if (reply?.errorText) throw new Error(`页面导航失败（${reply.errorText}）：${url}`);
      });
      try {
        await Promise.all([navigate, loaded]);
      } finally {
        clearTimeout(timer);
        onLoad = null;
        onFail = null;
      }
    },
    /** 在页面里调用 fn(...args)，返回它的结果；fn 返回 Promise 时等它完成。 */
    async evaluate(fn, ...args) {
      const reply = await send('Runtime.evaluate', {
        expression: callOf(fn, args),
        returnByValue: true,
        awaitPromise: true
      });
      if (reply.exceptionDetails) {
        throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
      }
      return reply.result.value;
    },
    /** 匹配 selector 的元素里，直属的文字实际是用哪些字体画的：[{ family, custom, glyphs }]。 */
    async fontsUsed(selector) {
      const { root } = await send('DOM.getDocument');
      const { nodeIds } = await send('DOM.querySelectorAll', { nodeId: root.nodeId, selector });
      const used = new Map();
      for (const nodeId of nodeIds) {
        const { fonts } = await send('CSS.getPlatformFontsForNode', { nodeId });
        for (const { familyName, isCustomFont, glyphCount } of fonts) {
          const entry = used.get(familyName) ?? { family: familyName, custom: isCustomFont, glyphs: 0 };
          entry.glyphs += glyphCount;
          used.set(familyName, entry);
        }
      }
      return [...used.values()];
    },
    /** 整页的高度（CSS 像素）。 */
    async contentHeight() {
      const { cssContentSize } = await send('Page.getLayoutMetrics');
      return cssContentSize.height;
    },
    /** 截下页面上的一块，返回 JPEG 的字节。clip 是 { x, y, width, height, scale }。 */
    async screenshot(clip) {
      const { data } = await send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 72,
        clip,
        captureBeyondViewport: true
      });
      return Buffer.from(data, 'base64');
    }
  };
}

/** 启动浏览器，返回 { name, newPage(), close() }。 */
async function launchBrowser(exe = findBrowser(), start = spawn) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zx-look-'));
  const flags = [
    '--headless=new',
    '--remote-debugging-pipe',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars'
  ];
  const child = start(exe, flags, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  let exitedFlag = false;
  const exited = new Promise((resolve) => {
    const done = () => {
      exitedFlag = true;
      resolve();
    };
    child.once('exit', done);
    child.once('error', done);
  });
  const cdp = connect(child);
  async function waitForExit() {
    let timer;
    try {
      return await Promise.race([
        exited.then(() => true),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), CLOSE_TIMEOUT);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    name: path.basename(exe),
    newPage: () => openPage(cdp),
    async close() {
      try {
        if (exitedFlag) return;
        // 以进程实际退出为准，浏览器可以在回复命令之前关闭调试管道。
        cdp.send('Browser.close', undefined, undefined, CLOSE_TIMEOUT).catch(() => null);
        if ((await waitForExit()) || exitedFlag) return;
        const signalSent = child.kill('SIGKILL');
        if (!signalSent || !(await waitForExit())) {
          throw new Error(`浏览器未退出，临时配置保留在 ${profile}`);
        }
      } finally {
        // Windows 上浏览器退出后文件还会被占用一小会儿
        if (exitedFlag) fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }
  };
}

module.exports = { launchBrowser, connect, openPage };
