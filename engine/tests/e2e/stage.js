'use strict';
/* 备课与开页面：启动浏览器、把测试课备到临时目录、打开页面。验收（harness.js）和截图工具（shots.js）共用。
 * 内核由环境变量 ZX_ENGINE 指定（chromium、firefox、webkit），默认 chromium。
 * 页面一律用 file:// 打开：那是课程真正被使用的方式。
 * 课程有两种形态，由 ZX_FORM 指定：folder（默认）是文件夹，一讲一个文件；packed 是 zx pack 导出的单文件。
 * 同一套验收两种形态都跑：备课时多导出一步，开页面时换一种地址，测试本身不用知道。 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { performance } = require('perf_hooks');
const { pathToFileURL } = require('url');
const playwright = require('playwright');

const REPO = path.resolve(__dirname, '..', '..', '..');
const COURSES = path.join(__dirname, '..', 'courses');
const COURSES_ALL = ['sample', 'calculus', 'edge', 'matrix', 'long'];
const VALID_ENGINES = ['chromium', 'firefox', 'webkit'];
const VALID_FORMS = ['folder', 'packed'];
const VALID_STAGE_MODES = ['inprocess', 'cli'];
const ENGINE = process.env.ZX_ENGINE || 'chromium';
const RAW_FORM = process.env.ZX_FORM || 'folder';
if (!VALID_ENGINES.includes(ENGINE)) {
  throw new Error(`非法环境变量 ZX_ENGINE=${JSON.stringify(process.env.ZX_ENGINE)}，可选：${VALID_ENGINES.join(', ')}`);
}
if (!VALID_FORMS.includes(RAW_FORM)) {
  throw new Error(`非法环境变量 ZX_FORM=${JSON.stringify(process.env.ZX_FORM)}，可选：${VALID_FORMS.join(', ')}`);
}
const PACKED = RAW_FORM === 'packed';
const RAW_IDLE_TAB = process.env.ZX_WEBKIT_IDLE_TAB ?? (process.platform === 'win32' ? '1' : '0');
if (!['0', '1'].includes(RAW_IDLE_TAB)) {
  throw new Error(`非法环境变量 ZX_WEBKIT_IDLE_TAB=${JSON.stringify(process.env.ZX_WEBKIT_IDLE_TAB)}，可选：0, 1`);
}
const IDLE_TAB = ENGINE === 'webkit' && RAW_IDLE_TAB === '1';
const STAGE_MODE = process.env.ZX_STAGE_MODE || 'inprocess';
if (!VALID_STAGE_MODES.includes(STAGE_MODE)) {
  throw new Error(
    `非法环境变量 ZX_STAGE_MODE=${JSON.stringify(process.env.ZX_STAGE_MODE)}，可选：${VALID_STAGE_MODES.join(', ')}`
  );
}
const RAW_TEMPLATE_SHARE = process.env.ZX_TEMPLATE_SHARE ?? '1';
if (!['0', '1'].includes(RAW_TEMPLATE_SHARE)) {
  throw new Error(`非法环境变量 ZX_TEMPLATE_SHARE=${JSON.stringify(process.env.ZX_TEMPLATE_SHARE)}，可选：0, 1`);
}
const TEMPLATE_SHARE = RAW_TEMPLATE_SHARE === '1';
const GENERATED = ['matrix', 'long'];
const METRICS_FILE = process.env.ZX_METRICS_FILE;

let launched;
let activeBrowser = null;
let anchorReady;
let anchorContext;
let toolLibs;
let sharedTemplateDir = null;
let ownedSharedTemplate = null;
let stagingDepth = 0;
const temporary = [];
const staged = new Map();
const exported = new Map(); // 课程目录 → 导出的单文件的地址（只在 packed 形态下有）
const metrics = {
  engine: ENGINE,
  form: PACKED ? 'packed' : 'folder',
  idleTab: IDLE_TAB,
  stageMode: STAGE_MODE,
  templateShare: TEMPLATE_SHARE,
  preStaged: [],
  stageMs: 0,
  copyMs: 0,
  templateCopyMs: 0,
  templateLinkCalls: 0,
  templateLinkFallbacks: 0,
  buildMs: 0,
  packMs: 0,
  launchMs: 0,
  anchorSetupMs: 0,
  newPageCount: 0,
  newPageMsSum: 0,
  minNewPageMs: null,
  maxNewPageMs: 0,
  slowNewPageCount: 0,
  newPageMsSamples: [],
  openCount: 0,
  gotoMsSum: 0,
  readyMsSum: 0,
  pageCloseCount: 0,
  pageCloseMsSum: 0,
  closeMs: 0,
  closeTimedOut: false,
  courseCalls: 0,
  courseCacheHits: 0,
  freshCalls: 0,
  makeCalls: 0,
  buildCalls: 0,
  packCalls: 0,
  maxRssKb: 0
};

function timedStage(fn) {
  const outer = stagingDepth === 0;
  const start = outer ? performance.now() : 0;
  stagingDepth += 1;
  try {
    return fn();
  } finally {
    stagingDepth -= 1;
    if (outer) metrics.stageMs += performance.now() - start;
  }
}

function flushMetrics() {
  if (!METRICS_FILE) return;
  metrics.maxRssKb = process.resourceUsage().maxRSS;
  fs.mkdirSync(path.dirname(METRICS_FILE), { recursive: true });
  fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics));
}

function loadPreStaged() {
  if (!process.env.ZX_PRE_STAGED) return;
  const entries = JSON.parse(process.env.ZX_PRE_STAGED);
  for (const [name, entry] of Object.entries(entries)) {
    const dir = typeof entry === 'string' ? entry : entry.dir;
    const packedFile = typeof entry === 'object' && entry ? entry.packedFile : null;
    staged.set(name, dir);
    metrics.preStaged.push(name);
    if (PACKED) {
      if (!packedFile) throw new Error(`预备课程 ${name} 在单文件模式下缺少导出文件地址`);
      exported.set(dir, pathToFileURL(packedFile).href);
    }
  }
}
loadPreStaged();

/* Windows 上的 WebKit 偶尔在退出时卡住：浏览器的网络进程停在“正在退出”的状态，杀不掉，
 * 手里还攥着浏览器的输出管道，Playwright 于是一直等不到“浏览器进程结束”，测试文件收不了场。
 * 这时测试本身都已经跑完了。所以关浏览器只等十秒：没关完就不等了，留一秒让测试框架把结果报完，
 * 然后直接结束进程（结果和退出码都不受影响）。卡住的那个网络进程会留到下次重启电脑。 */
const CLOSE_WAIT = 10000;
const REPORT_WAIT = 1000;

async function closeBrowser(browser) {
  const start = performance.now();
  let timer;
  const stuck = new Promise((resolve) => {
    timer = setTimeout(resolve, CLOSE_WAIT, true);
  });
  const timedOut = await Promise.race([browser.close(), stuck]);
  clearTimeout(timer);
  metrics.closeMs += performance.now() - start;
  metrics.closeTimedOut = Boolean(timedOut);
  if (timedOut) {
    flushMetrics();
    setTimeout(() => process.exit(), REPORT_WAIT);
  }
}

/** 关掉浏览器，删掉临时目录。 */
async function dispose() {
  try {
    let browser = activeBrowser;
    if (!browser && launched) {
      try {
        browser = await launched;
      } catch {
        browser = null;
      }
    }
    if (browser) {
      await closeBrowser(browser);
      anchorContext = null;
    }
  } finally {
    for (const dir of temporary) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    temporary.length = 0;
    if (ownedSharedTemplate) {
      ownedSharedTemplate.cleanup();
      ownedSharedTemplate = null;
      sharedTemplateDir = null;
    }
    flushMetrics();
  }
}

/** 在课程目录里运行 zx.js，返回 { status, output }。 */
function zx(dir, ...args) {
  const result = spawnSync('node', [path.join(dir, 'template', 'tools', 'zx.js'), ...args], {
    cwd: dir,
    encoding: 'utf8'
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

function loadToolLibs() {
  if (!toolLibs) {
    const libDir = path.join(REPO, 'template', 'tools', 'lib');
    toolLibs = {
      ...require(path.join(libDir, 'files.js')),
      ...require(path.join(libDir, 'build.js')),
      ...require(path.join(libDir, 'pack.js')),
      ...require(path.join(libDir, 'report.js'))
    };
  }
  return toolLibs;
}

/** 进程内运行 build，按当前夹具的 template/ 校验并生成，诊断和退出码与 zx build 对齐。 */
function runBuildInProcess(dir) {
  const { COURSE_FILE, isFile, build, formatReport } = loadToolLibs();
  const templateDir = path.join(dir, 'template');
  if (!isFile(path.join(templateDir, 'tools', 'zx.js'))) {
    return { status: 1, output: `找不到夹具模板入口：${path.join(templateDir, 'tools', 'zx.js')}` };
  }
  if (!isFile(path.join(dir, COURSE_FILE))) {
    return { status: 2, output: `当前目录不是课程根目录：找不到 ${COURSE_FILE}` };
  }
  const { result, generated, escaped } = build(dir, { templateDir });
  const done = [];
  if (escaped.length > 0) {
    done.push(
      `已自动转义代码和公式里的 < 和 &：${escaped.map(({ file, escaped: count }) => `${file} ${count} 处`).join('、')}`
    );
  }
  if (generated.length > 0) done.push(`已生成 ${generated.join('、')}`);
  const output = [...done, '', formatReport(result)].join('\n').trimStart();
  return { status: result.ok ? 0 : 1, output };
}

/** 进程内运行 pack，按当前夹具的 template/ 校验并解析运行时、CSS、第三方库和字体。 */
function runPackInProcess(dir) {
  const { COURSE_FILE, isFile, pack: packLib, formatReport } = loadToolLibs();
  const templateDir = path.join(dir, 'template');
  if (!isFile(path.join(templateDir, 'tools', 'zx.js'))) {
    return { status: 1, output: `找不到夹具模板入口：${path.join(templateDir, 'tools', 'zx.js')}`, file: null };
  }
  if (!isFile(path.join(dir, COURSE_FILE))) {
    return { status: 2, output: `当前目录不是课程根目录：找不到 ${COURSE_FILE}`, file: null };
  }
  const { result, file, summary, large } = packLib(dir, { templateDir });
  if (!file) {
    const output = `${formatReport(result)}\n有 error，没有导出；上一次导出的文件没有动。`;
    return { status: 1, output, file: null };
  }
  const lines = [`已导出 ${file}（${summary}）`];
  if (large) {
    lines.push(
      'warning  文件超过 20 MB。单文件整份读进内存，手机上打开会慢，翻页也占内存：把图片、音频和视频压小一些。'
    );
  }
  lines.push('把这个文件发到手机上，用浏览器打开就是整门课。');
  return { status: 0, output: lines.join('\n'), file };
}

/** 一个新的临时目录，测试结束时删除。 */
function scratch(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `zx-${label}-`));
  temporary.push(dir);
  return dir;
}

/** 创建一份本次测试运行独享的临时 template/ 副本，供 makeCourse 只读共享；不直接指向仓库母版。 */
function createSharedTemplate() {
  const start = performance.now();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zx-shared-template-'));
  try {
    fs.cpSync(path.join(REPO, 'template'), dir, { recursive: true });
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    throw error;
  }
  return {
    dir,
    copyMs: performance.now() - start,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    }
  };
}

function ensureSharedTemplate() {
  if (sharedTemplateDir) return sharedTemplateDir;
  if (process.env.ZX_SHARED_TEMPLATE) {
    const candidate = process.env.ZX_SHARED_TEMPLATE;
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
      throw new Error(`共享模板目录不存在或不是目录：${candidate}`);
    }
    sharedTemplateDir = candidate;
    return sharedTemplateDir;
  }
  ownedSharedTemplate = createSharedTemplate();
  metrics.templateCopyMs += ownedSharedTemplate.copyMs;
  metrics.copyMs += ownedSharedTemplate.copyMs;
  sharedTemplateDir = ownedSharedTemplate.dir;
  return sharedTemplateDir;
}

/** 把母版的引擎放进一个课程目录（实体副本，供会改动或删除 template/ 的夹具使用）。 */
function installTemplate(dir) {
  const start = performance.now();
  try {
    fs.cpSync(path.join(REPO, 'template'), path.join(dir, 'template'), { recursive: true });
  } finally {
    const elapsed = performance.now() - start;
    metrics.templateCopyMs += elapsed;
    metrics.copyMs += elapsed;
  }
}

/** 为不修改模板的 makeCourse() 挂接本次运行的共享临时模板；遇权限受限时自动回退实体复制。 */
function installSharedTemplate(dir) {
  const start = performance.now();
  const target = ensureSharedTemplate();
  try {
    fs.symlinkSync(target, path.join(dir, 'template'), process.platform === 'win32' ? 'junction' : 'dir');
    metrics.templateLinkCalls += 1;
    const elapsed = performance.now() - start;
    metrics.templateCopyMs += elapsed;
    metrics.copyMs += elapsed;
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS'].includes(error?.code)) {
      metrics.templateLinkFallbacks += 1;
      installTemplate(dir);
      return;
    }
    throw error;
  }
}

function populateCourse(dir, name) {
  const start = performance.now();
  try {
    if (name === 'sample') {
      for (const entry of fs.readdirSync(REPO)) {
        if (entry.endsWith('.html') || entry === 'course')
          fs.cpSync(path.join(REPO, entry), path.join(dir, entry), { recursive: true });
      }
    } else if (GENERATED.includes(name)) {
      require(path.join(COURSES, `make-${name}.js`))(dir);
    } else {
      fs.cpSync(path.join(COURSES, name), dir, { recursive: true });
    }
  } finally {
    metrics.copyMs += performance.now() - start;
  }
}

/**
 * 备好一门测试课的全新副本：复制到临时目录，放进母版的 template/，运行 build。
 * name：sample（仓库根目录的示例课）、calculus、edge（手写的压测课）、matrix、long（由脚本生成）。
 */
function freshCourse(name) {
  metrics.freshCalls += 1;
  return timedStage(() => {
    const dir = scratch(name);
    populateCourse(dir, name);
    return ready(dir, name);
  });
}

/** 放进母版的引擎并 build；没通过就直接报错。 */
function ready(dir, name, packed = PACKED, { sharedTemplate = false } = {}) {
  return timedStage(() => {
    if (sharedTemplate) {
      installSharedTemplate(dir);
    } else {
      installTemplate(dir);
    }
    metrics.buildCalls += 1;
    const start = performance.now();
    let built;
    try {
      built = STAGE_MODE === 'inprocess' ? runBuildInProcess(dir) : zx(dir, 'build');
    } finally {
      metrics.buildMs += performance.now() - start;
    }
    if (built.status !== 0) throw new Error(`测试课 ${name} 没有通过 build：\n${built.output}`);
    if (packed) pack(dir);
    return dir;
  });
}

/** 导出单文件，记下它的地址。课程的文件改过之后要重新导出，单文件里才是新的内容。 */
function pack(dir) {
  return timedStage(() => {
    metrics.packCalls += 1;
    const start = performance.now();
    try {
      let file;
      if (STAGE_MODE === 'inprocess') {
        const packed = runPackInProcess(dir);
        if (packed.status !== 0) throw new Error(`${dir} 没有导出成功：\n${packed.output}`);
        file = packed.file;
      } else {
        const { status, output } = zx(dir, 'pack');
        if (status !== 0) throw new Error(`${dir} 没有导出成功：\n${output}`);
        [, file] = /^已导出 (export\/.+\.html)（/m.exec(output);
      }
      const full = path.join(dir, file);
      exported.set(dir, pathToFileURL(full).href);
      return full;
    } finally {
      metrics.packMs += performance.now() - start;
    }
  });
}

/** 为跨进程只读复用预先备好测试课；返回各课程目录及对应单文件导出路径，由调用方负责清理。 */
function stageCourses(names = COURSES_ALL, { packed = PACKED } = {}) {
  const start = performance.now();
  const snap = {
    copyMs: metrics.copyMs,
    templateCopyMs: metrics.templateCopyMs,
    buildMs: metrics.buildMs,
    packMs: metrics.packMs
  };
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zx-prestage-'));
  const entries = {};
  try {
    for (const name of names) {
      const dir = path.join(baseDir, name);
      fs.mkdirSync(dir, { recursive: true });
      populateCourse(dir, name);
      ready(dir, name, false);
      const packedFile = packed ? pack(dir) : null;
      entries[name] = { dir, packedFile };
    }
  } catch (error) {
    fs.rmSync(baseDir, { recursive: true, force: true, maxRetries: 5 });
    throw error;
  }
  return {
    entries,
    baseDir,
    stageMs: performance.now() - start,
    copyMs: metrics.copyMs - snap.copyMs,
    templateCopyMs: metrics.templateCopyMs - snap.templateCopyMs,
    buildMs: metrics.buildMs - snap.buildMs,
    packMs: metrics.packMs - snap.packMs,
    cleanup() {
      fs.rmSync(baseDir, { recursive: true, force: true, maxRetries: 5 });
    }
  };
}

const lessonPage = (title, content) =>
  [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    '<meta name="description" content="用于测试的一讲。">',
    '<link rel="stylesheet" href="template/zhixu.css">',
    '<script src="template/zhixu.js"></script>',
    '</head>',
    '<body>',
    '<main>',
    `<h1>${title}</h1>`,
    content,
    '</main>',
    '</body>',
    '</html>',
    ''
  ].join('\n');

/**
 * 现做一门小课程：lessons 是 { 文件名: <main> 里 <h1> 之后的内容 }。
 * 同一个 id 可以做出好几份，它们就是“同一门课的不同副本”。
 */
function makeCourse(id, lessons) {
  metrics.makeCalls += 1;
  return timedStage(() => {
    const start = performance.now();
    const dir = scratch(id);
    const manifest = { id, title: `测试课 ${id}`, units: [{ lessons: Object.keys(lessons) }] };
    fs.mkdirSync(path.join(dir, 'course'));
    fs.writeFileSync(
      path.join(dir, 'course', 'course.js'),
      `window.ZHIXU_COURSE = ${JSON.stringify(manifest, null, 2)};\n`
    );
    for (const [file, content] of Object.entries(lessons)) {
      fs.writeFileSync(path.join(dir, file), lessonPage(file.replace('.html', ''), content));
    }
    metrics.copyMs += performance.now() - start;
    return ready(dir, id, PACKED, { sharedTemplate: TEMPLATE_SHARE });
  });
}

/** 同一个测试文件里共用的副本（只读的测试用它）；要改文件的测试用 freshCourse。 */
function course(name) {
  metrics.courseCalls += 1;
  if (staged.has(name)) {
    metrics.courseCacheHits += 1;
    return staged.get(name);
  }
  const dir = freshCourse(name);
  staged.set(name, dir);
  return dir;
}

/** 一个新的浏览器上下文：存储是空的，互不影响。 */
async function newContext(options) {
  if (!launched) {
    const start = performance.now();
    launched = playwright[ENGINE].launch().then((browser) => {
      activeBrowser = browser;
      metrics.launchMs = performance.now() - start;
      return browser;
    });
  }
  const browser = await launched;
  if (IDLE_TAB) {
    anchorReady ??= (async () => {
      const anchorStart = performance.now();
      anchorContext = await browser.newContext();
      const anchorPage = await anchorContext.newPage();
      await anchorPage.goto('about:blank');
      metrics.anchorSetupMs = Math.round((performance.now() - anchorStart) * 10) / 10;
    })();
    await anchorReady;
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  if (METRICS_FILE) {
    const origNewPage = context.newPage.bind(context);
    context.newPage = async (...args) => {
      const t0 = performance.now();
      let page;
      try {
        page = await origNewPage(...args);
      } finally {
        const dt = Math.round((performance.now() - t0) * 10) / 10;
        metrics.newPageCount += 1;
        metrics.newPageMsSum = Math.round((metrics.newPageMsSum + dt) * 10) / 10;
        if (metrics.minNewPageMs === null || dt < metrics.minNewPageMs) metrics.minNewPageMs = dt;
        if (dt > metrics.maxNewPageMs) metrics.maxNewPageMs = dt;
        if (dt > 1000) metrics.slowNewPageCount += 1;
        metrics.newPageMsSamples.push(dt);
      }
      const origClose = page.close.bind(page);
      page.close = async (...closeArgs) => {
        const c0 = performance.now();
        try {
          return await origClose(...closeArgs);
        } finally {
          const cdt = Math.round((performance.now() - c0) * 10) / 10;
          metrics.pageCloseCount += 1;
          metrics.pageCloseMsSum = Math.round((metrics.pageCloseMsSum + cdt) * 10) / 10;
        }
      };
      return page;
    };
  }
  return context;
}

/**
 * 课程里一页的地址。suffix 是地址后面带的东西：'?theme=dark'、'#锚点'，或者两样都有。
 * 文件夹里一页是一个文件；单文件里页面和锚点都写在 # 后面（#讲义文件名/锚点）。
 */
function fileUrl(root, file, suffix = '') {
  if (!PACKED) return pathToFileURL(path.join(root, file)).href + suffix;
  const [query, anchor] = suffix.split('#');
  return `${exported.get(root)}${query}#${file}${anchor ? `/${anchor}` : ''}`;
}

/** 打开一页并等它启动完（成功或失败）。页面上的报错收集在 page.errors 里。 */
async function open(context, root, file, suffix = '') {
  metrics.openCount += 1;
  const page = await context.newPage();
  page.errors = [];
  page.on('console', (message) => message.type() === 'error' && page.errors.push(message.text()));
  page.on('pageerror', (error) => page.errors.push(error.message));
  const tGoto = performance.now();
  await page.goto(fileUrl(root, file, suffix));
  metrics.gotoMsSum = Math.round((metrics.gotoMsSum + (performance.now() - tGoto)) * 10) / 10;
  const tReady = performance.now();
  await page.waitForSelector('html.zx-ready, html.zx-failed', { timeout: 15000 });
  metrics.readyMsSum = Math.round((metrics.readyMsSum + (performance.now() - tReady)) * 10) / 10;
  return page;
}

/**
 * 等页面到了 file 这一讲（anchor 给出时，还要落在这个锚点上）并且启动完。
 * “现在是哪一页、在哪个锚点”问加载器：两种形态下地址的写法不同，它的回答是一样的。
 */
async function arrived(page, file, anchor) {
  await page.waitForFunction(
    ([name, id]) =>
      window.ZHIXU?.file === name &&
      (id === null || window.ZHIXU.anchor() === id) &&
      document.documentElement.classList.contains('zx-ready'),
    [file, anchor ?? null]
  );
}

/** 课程里的讲义文件名，按清单的顺序。 */
function lessonFiles(root) {
  const source = fs.readFileSync(path.join(root, 'course', 'course.js'), 'utf8');
  return [...source.matchAll(/"([a-z0-9][a-z0-9-]*\.html)"/g)].map((match) => match[1]);
}

module.exports = {
  ENGINE,
  PACKED,
  STAGE_MODE,
  TEMPLATE_SHARE,
  REPO,
  COURSES_ALL,
  course,
  freshCourse,
  makeCourse,
  ready,
  scratch,
  createSharedTemplate,
  installTemplate,
  zx,
  runBuildInProcess,
  runPackInProcess,
  newContext,
  open,
  arrived,
  pack,
  stageCourses,
  fileUrl,
  lessonFiles,
  dispose
};
