'use strict';
/* 端到端验收的入口：支持多内核、文件夹 / 单文件双形态、受控并发与严格结果校验。
 *
 *   node engine/tests/e2e/run.js                       默认顺序跑三个内核（folder 形态）
 *   node engine/tests/e2e/run.js chromium              只跑一个内核
 *   node engine/tests/e2e/run.js chromium B17          只跑名字里带 B17 的用例
 *   ZX_FORM=packed node engine/tests/e2e/run.js        改跑 zx pack 导出的单文件
 *   node engine/tests/e2e/run.js --jobs=4 --prestage   4 并发 + 预备只读课程
 *
 * 每个测试文件单独起一个进程，超时默认 15 分钟；通过解析 TAP 明细与退出状态杜绝
 * 0 命中空跑、超时缺失汇总或非零退出误报成通过。 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { performance } = require('perf_hooks');
const { StringDecoder } = require('string_decoder');
const { COURSES_ALL, STAGE_MODE, TEMPLATE_SHARE, createSharedTemplate, stageCourses } = require('./stage');

const ENGINES = ['chromium', 'firefox', 'webkit'];
const FORMS = ['folder', 'packed'];
const ORDERS = ['fifo', 'lpt'];
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const SUMMARY_KEYS = ['tests', 'pass', 'fail', 'skipped'];

/** 默认调度权重（毫秒，按典型重作业估算），与报告中的 wallMs 同单位，供 --order=lpt 混合排班使用。 */
const DEFAULT_FILE_WEIGHTS_MS = {
  'layout.e2e.js': 210000,
  'basics.e2e.js': 170000,
  'a11y.e2e.js': 140000,
  'packed.e2e.js': 80000,
  'tools.e2e.js': 75000,
  'records.e2e.js': 65000,
  'print.e2e.js': 55000,
  'reading.e2e.js': 50000,
  'components.e2e.js': 45000,
  'home.e2e.js': 40000,
  'margin.e2e.js': 35000,
  'motion.e2e.js': 35000,
  'overlays.e2e.js': 30000,
  'search.e2e.js': 25000,
  'notes.e2e.js': 20000,
  'agree.e2e.js': 15000,
  'boot.e2e.js': 15000,
  'turn.e2e.js': 15000
};
const ENGINE_WEIGHTS = { chromium: 1, firefox: 1.5, webkit: 2.2 };
const FORM_WEIGHTS = { folder: 1, packed: 1.4 };

const normalizeRel = (text) =>
  String(text || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');

/** 判断 TAP 条目名是否为零命中时 Node 生成的文件级包装条目。 */
function isFileWrapper(name, file) {
  const normName = normalizeRel(name);
  if (!normName) return false;
  if (!file) return /(?:^|\/)[^/]+\.[mc]?js$/i.test(normName);
  const normFile = normalizeRel(file);
  return (
    normName === normFile ||
    normFile.endsWith(`/${normName}`) ||
    normName.endsWith(`/${normFile}`) ||
    path.posix.basename(normName) === path.posix.basename(normFile)
  );
}

/**
 * 解析 node --test --test-reporter=tap 的输出。
 * 区分真实测试明细、预期带原因 SKIP、以及 --test-name-pattern 0 命中时的 `1..0` 文件包装。
 */
function parseTap(text, file = '') {
  const lines = String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const plans = [];
  const summary = {};
  const results = [];
  const diagnostics = [];
  let yamlIndent = null;

  for (const line of lines) {
    if (yamlIndent !== null) {
      const yamlEnd = /^(\s*)\.\.\.\s*$/.exec(line);
      if (yamlEnd && yamlEnd[1].length === yamlIndent) {
        yamlIndent = null;
        continue;
      }
      // 进程被强杀导致 YAML 块截断时，遇到顶层 TAP 记录则退出 YAML 状态
      if (!/^(TAP version |1\.\.\d+|# |(?:not )?ok \d+ - )/.test(line)) continue;
      yamlIndent = null;
    }

    const yamlStart = /^(\s*)---\s*$/.exec(line);
    if (yamlStart) {
      yamlIndent = yamlStart[1].length;
      continue;
    }

    if (/^\s+/.test(line)) continue; // 忽略嵌套子测试缩进行，汇总只看顶层结果

    const plan = /^1\.\.(\d+)$/.exec(line);
    if (plan) {
      plans.push(Number(plan[1]));
      continue;
    }

    const sum = /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) (\d+(?:\.\d+)?)$/.exec(line);
    if (sum) {
      summary[sum[1]] = Number(sum[2]);
      continue;
    }

    const res = /^(ok|not ok) (\d+) - (.*)$/.exec(line);
    if (res) {
      const [, statusWord, num, body] = res;
      const dirMatch = /^((?:\\.|[^\\#])*?)\s+#\s*(SKIP|TODO)(?:\s+(.*))?$/.exec(body);
      const rawName = dirMatch ? dirMatch[1].trimEnd() : body;
      const name = rawName.replace(/\\([\\#])/g, '$1');
      const directive = dirMatch ? dirMatch[2] : null;
      const reason = dirMatch && dirMatch[3] ? dirMatch[3].trim() : '';
      results.push({
        ok: statusWord === 'ok',
        number: Number(num),
        name,
        directive,
        reason,
        wrapper: false
      });
      continue;
    }

    if (line && line !== 'TAP version 13' && !line.startsWith('# Subtest:')) diagnostics.push(line);
  }

  const zeroMatchPlan = plans.includes(0);
  if (zeroMatchPlan && results.length === 1 && isFileWrapper(results[0].name, file)) {
    results[0].wrapper = true;
  }

  const realTests = results.filter((entry) => !entry.wrapper);
  return { plans, zeroMatchPlan, summary, results, realTests, diagnostics };
}

/** 校验单次测试进程输出：任何退出异常、信号、超时、汇总缺失、空跑或未说明 SKIP 都判失败。 */
function evaluateJobResult({
  status,
  signal = null,
  error = null,
  timedOut = false,
  stdout = '',
  stderr = '',
  file = '',
  allowEmpty = false,
  expectedTests = null,
  durationMs = 0
}) {
  const tap = parseTap(`${stdout}\n${stderr}`, file);
  const failures = [];
  const isTimedOut = Boolean(timedOut || error?.code === 'ETIMEDOUT');

  const pass = tap.realTests.filter((entry) => entry.ok && !entry.directive).length;
  const skipped = tap.realTests.filter((entry) => entry.directive === 'SKIP').length;
  const todo = tap.realTests.filter((entry) => entry.directive === 'TODO').length;
  const explicitFail = tap.realTests.filter((entry) => !entry.ok).length;
  const finalPlan = tap.plans.at(-1);

  if (isTimedOut) failures.push('执行超时中止');
  else if (error) failures.push(`进程启动或执行失败：${error.message}`);

  if (signal) failures.push(`被信号中止：${signal}`);
  if (status === null || status === undefined) failures.push('进程未返回退出码（status=null）');
  else if (status !== 0) failures.push(`退出码非零（exit ${status}）`);

  const missingSummary = SUMMARY_KEYS.filter((key) => tap.summary[key] === undefined);
  if (missingSummary.length > 0) failures.push(`缺少 TAP 汇总字段：${missingSummary.join(', ')}`);
  if (finalPlan === undefined) failures.push('缺少 TAP 计划行 1..N');

  if ((tap.summary.fail ?? 0) > 0) failures.push(`TAP 汇总 fail=${tap.summary.fail}`);
  if ((tap.summary.cancelled ?? 0) > 0) failures.push(`TAP 汇总 cancelled=${tap.summary.cancelled}`);
  if ((tap.summary.todo ?? 0) > 0 || todo > 0)
    failures.push(`存在未完成 todo=${Math.max(tap.summary.todo ?? 0, todo)}`);
  if (tap.results.some((entry) => !entry.ok)) failures.push('存在 not ok 用例');

  const emptyRun = tap.zeroMatchPlan || tap.realTests.length === 0;
  if (emptyRun && !allowEmpty) failures.push('未运行任何真实用例（TAP 1..0 空跑）');

  if (!tap.zeroMatchPlan && missingSummary.length === 0) {
    if (finalPlan !== undefined && finalPlan !== tap.results.length) {
      failures.push(`TAP 计划数(1..${finalPlan})与明细数(${tap.results.length})不一致`);
    }
    if (finalPlan !== undefined && finalPlan !== tap.summary.tests) {
      failures.push(`TAP 计划数(1..${finalPlan})与汇总 tests(${tap.summary.tests})不一致`);
    }
    if (tap.results.length !== tap.summary.tests) {
      failures.push(`TAP 明细数(${tap.results.length})与汇总 tests(${tap.summary.tests})不一致`);
    }
    if (pass !== tap.summary.pass) {
      failures.push(`TAP pass 明细(${pass})与汇总(${tap.summary.pass})不一致`);
    }
    if (skipped !== tap.summary.skipped) {
      failures.push(`TAP skipped 明细(${skipped})与汇总(${tap.summary.skipped})不一致`);
    }
    if (explicitFail !== tap.summary.fail) {
      failures.push(`TAP fail 明细(${explicitFail})与汇总(${tap.summary.fail})不一致`);
    }
  }

  for (const entry of tap.realTests) {
    if (entry.directive === 'SKIP' && !entry.reason) failures.push(`用例“${entry.name}”缺少跳过原因`);
  }

  if (expectedTests && expectedTests.length > 0) {
    const byName = new Map(tap.realTests.map((entry) => [entry.name, entry]));
    const expectedSet = new Set(expectedTests.map((spec) => spec.name));
    for (const spec of expectedTests) {
      const actual = byName.get(spec.name);
      if (!actual) {
        failures.push(`缺少预期用例：${spec.name}`);
        continue;
      }
      if (spec.expected === 'pass' && (!actual.ok || actual.directive)) {
        failures.push(`用例“${spec.name}”预期 PASS，实际为 ${actual.directive || 'FAIL'}`);
      } else if (spec.expected === 'skip') {
        if (actual.directive !== 'SKIP') {
          failures.push(`用例“${spec.name}”预期 SKIP，实际为 ${actual.directive || (actual.ok ? 'PASS' : 'FAIL')}`);
        } else if (actual.reason && spec.reason && actual.reason !== spec.reason) {
          failures.push(`用例“${spec.name}”跳过原因不符（实际“${actual.reason}”）`);
        }
      }
    }
    const extras = tap.realTests.filter((entry) => !expectedSet.has(entry.name)).map((entry) => entry.name);
    if (extras.length > 0) failures.push(`出现未在清单中的用例：${extras.join(', ')}`);
  }

  const counts = emptyRun
    ? { tests: 0, pass: 0, fail: failures.length > 0 ? 1 : 0, skipped: 0 }
    : {
        tests: tap.realTests.length,
        pass,
        fail: explicitFail > 0 ? explicitFail : failures.length > 0 ? 1 : 0,
        skipped
      };

  return {
    ok: failures.length === 0,
    failures,
    counts,
    tap,
    durationMs,
    status,
    signal,
    timedOut: isTimedOut
  };
}

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // 进程已退出则忽略
    }
  }
}

/** 异步启动一个 node --test 子进程，强制超时收尾并返回结构化校验结果。 */
function runCommandJob({
  args,
  cwd = process.cwd(),
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  file = '',
  allowEmpty = false,
  expectedTests = null
}) {
  return new Promise((resolve) => {
    const start = performance.now();
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    const outDecoder = new StringDecoder('utf8');
    const errDecoder = new StringDecoder('utf8');
    let timedOut = false;
    let settled = false;
    let forceResolveTimer = null;

    child.stdout.on('data', (chunk) => {
      stdout += outDecoder.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += errDecoder.write(chunk);
    });

    const finalize = ({ status = null, signal = null, error = null }) => {
      if (settled) return;
      settled = true;
      stdout += outDecoder.end();
      stderr += errDecoder.end();
      clearTimeout(timeoutTimer);
      clearTimeout(forceResolveTimer);
      const evaluation = evaluateJobResult({
        status,
        signal,
        error,
        timedOut,
        stdout,
        stderr,
        file,
        allowEmpty,
        expectedTests,
        durationMs: performance.now() - start
      });
      resolve({ ...evaluation, stdout, stderr });
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid);
      forceResolveTimer = setTimeout(
        () =>
          finalize({
            status: null,
            signal: 'SIGTERM',
            error: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })
          }),
        2000
      );
    }, timeoutMs);

    child.on('error', (error) => finalize({ status: null, signal: null, error }));
    child.on('close', (code, signal) => finalize({ status: code, signal }));
  });
}

function loadWeightLookup(weightsPath) {
  if (!weightsPath) return new Map();
  const data = JSON.parse(fs.readFileSync(weightsPath, 'utf8'));
  const map = new Map();
  if (Array.isArray(data.jobs)) {
    for (const item of data.jobs) {
      const ms = Number(item.wallMs ?? item.durationMs ?? 0);
      if (!Number.isFinite(ms) || ms < 0) throw new Error(`权重文件存在非法耗时：${item.file}`);
      map.set(`${item.form}/${item.engine}/${item.file}`, ms);
    }
  } else {
    for (const [key, value] of Object.entries(data)) {
      const ms = Number(value);
      if (!Number.isFinite(ms) || ms < 0) throw new Error(`权重文件存在非法耗时：${key}`);
      map.set(key, ms);
    }
  }
  return map;
}

function weightOfJob(job, lookup) {
  const key = `${job.form}/${job.engine}/${job.file}`;
  if (lookup.has(key)) return lookup.get(key);
  const fileMs = DEFAULT_FILE_WEIGHTS_MS[job.file] ?? 25000;
  return fileMs * (ENGINE_WEIGHTS[job.engine] ?? 1) * (FORM_WEIGHTS[job.form] ?? 1);
}

function listE2eFiles() {
  return fs
    .readdirSync(__dirname)
    .filter((name) => name.endsWith('.e2e.js'))
    .sort();
}

function validateList(list, allowed, label) {
  if (!Array.isArray(list) || list.length === 0) throw new Error(`${label}不能为空`);
  const invalid = list.filter((item) => !allowed.includes(item));
  if (invalid.length > 0) throw new Error(`非法${label}：${invalid.join(', ')}（可选：${allowed.join(', ')}）`);
}

function validateOptions(options, knownFiles = listE2eFiles()) {
  validateList(options.forms, FORMS, '交付形态');
  validateList(options.engines, ENGINES, '浏览器内核');
  if (options.files !== null && options.files !== undefined) validateList(options.files, knownFiles, '测试文件');
  validateList(options.courses, COURSES_ALL, '预备课程');
  if (!ORDERS.includes(options.order)) throw new Error(`非法排班方式：${options.order}（可选：${ORDERS.join(', ')}）`);
  if (!Number.isInteger(options.jobs) || options.jobs < 1) throw new Error(`非法并发数：${options.jobs}`);
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error(`非法超时时间：${options.timeoutMs}`);
  }
  return options;
}

/** 根据参数规划作业列表，并在 order=lpt 时按毫秒权重降序排班。 */
function planJobs({ forms, engines, files, order = 'fifo', weightsPath = null }) {
  validateList(forms, FORMS, '交付形态');
  validateList(engines, ENGINES, '浏览器内核');
  if (
    !Array.isArray(files) ||
    files.length === 0 ||
    files.some((f) => typeof f !== 'string' || !f.endsWith('.e2e.js'))
  ) {
    throw new Error('测试文件列表不能为空且必须为 *.e2e.js');
  }
  if (!ORDERS.includes(order)) throw new Error(`非法排班方式：${order}（可选：${ORDERS.join(', ')}）`);

  const jobs = [];
  for (const form of forms) {
    for (const engine of engines) {
      for (const file of files) jobs.push({ form, engine, file });
    }
  }
  if (order === 'lpt') {
    const lookup = loadWeightLookup(weightsPath);
    return jobs
      .map((job, index) => ({ job, index, weight: weightOfJob(job, lookup) }))
      .sort((a, b) => b.weight - a.weight || a.index - b.index)
      .map((entry) => entry.job);
  }
  return jobs;
}

function parseList(raw) {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv = process.argv.slice(2), env = process.env, platform = process.platform) {
  if (env.ZX_WEBKIT_IDLE_TAB !== undefined && !['0', '1'].includes(env.ZX_WEBKIT_IDLE_TAB)) {
    throw new Error(`非法环境变量 ZX_WEBKIT_IDLE_TAB=${JSON.stringify(env.ZX_WEBKIT_IDLE_TAB)}，可选：0, 1`);
  }
  const options = {
    engines: null,
    forms: env.ZX_FORM !== undefined ? parseList(env.ZX_FORM) : ['folder'],
    files: null,
    pattern: null,
    jobs: env.ZX_JOBS !== undefined ? Number(env.ZX_JOBS) : 1,
    order: 'fifo',
    weightsPath: null,
    prestage: env.ZX_PRESTAGE === '1',
    idleTab: env.ZX_WEBKIT_IDLE_TAB !== undefined ? env.ZX_WEBKIT_IDLE_TAB === '1' : platform === 'win32',
    courses: COURSES_ALL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    reportPath: env.ZX_REPORT || null,
    verbose: false
  };
  const positional = [];

  for (const arg of argv) {
    if (arg === '--prestage') options.prestage = true;
    else if (arg === '--no-prestage') options.prestage = false;
    else if (arg === '--webkit-idle-tab') options.idleTab = true;
    else if (arg === '--no-webkit-idle-tab') options.idleTab = false;
    else if (arg === '--verbose' || arg === '-v') options.verbose = true;
    else if (arg.startsWith('--engines=')) options.engines = parseList(arg.slice(10));
    else if (arg.startsWith('--forms=')) options.forms = parseList(arg.slice(8));
    else if (arg.startsWith('--files=')) options.files = parseList(arg.slice(8));
    else if (arg.startsWith('--pattern=')) options.pattern = arg.slice(10);
    else if (arg.startsWith('--jobs=')) options.jobs = Number(arg.slice(7));
    else if (arg.startsWith('--order=')) options.order = arg.slice(8);
    else if (arg.startsWith('--weights=')) options.weightsPath = arg.slice(10);
    else if (arg.startsWith('--courses=')) options.courses = parseList(arg.slice(10));
    else if (arg.startsWith('--timeout-ms=')) options.timeoutMs = Number(arg.slice(13));
    else if (arg.startsWith('--report=')) options.reportPath = arg.slice(9);
    else if (arg.startsWith('-')) throw new Error(`未知参数：${arg}`);
    else positional.push(arg);
  }

  if (positional.length > 2) throw new Error(`多余的位置参数：${positional.slice(2).join(' ')}`);
  if (!options.engines) options.engines = positional[0] ? [positional[0]] : ENGINES;
  if (!options.pattern && positional[1]) options.pattern = positional[1];
  return validateOptions(options);
}

function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

/** 按指定并发运行一组 E2E 作业，可选预备只读夹具、采集内存/阶段耗时并写 JSON 报告。 */
async function runRunner(options) {
  const startWall = performance.now();
  const allFiles = listE2eFiles();
  validateOptions(options, allFiles);
  const selectedFiles = options.files ? options.files : allFiles;
  const allowEmptyPerFile = Boolean(options.pattern) && !options.files;
  const jobs = planJobs({
    forms: options.forms,
    engines: options.engines,
    files: selectedFiles,
    order: options.order,
    weightsPath: options.weightsPath
  });

  const stagedByForm = new Map();
  const metricsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zx-e2e-metrics-'));
  let prestageMs = 0;
  const prestageBreakdown = { copyMs: 0, templateCopyMs: 0, buildMs: 0, packMs: 0 };
  let sharedTemplate = null;

  const totalMemMB = Math.round(os.totalmem() / 1048576);
  const baselineFreeMB = Math.round(os.freemem() / 1048576);
  let minFreeMB = baselineFreeMB;
  const memTimer = setInterval(() => {
    const freeMB = Math.round(os.freemem() / 1048576);
    if (freeMB < minFreeMB) minFreeMB = freeMB;
  }, 500);
  memTimer.unref();

  try {
    if (TEMPLATE_SHARE) {
      sharedTemplate = createSharedTemplate();
    }
    if (options.prestage) {
      for (const form of options.forms) {
        const staged = stageCourses(options.courses, { packed: form === 'packed' });
        stagedByForm.set(form, staged);
        prestageMs += staged.stageMs;
        prestageBreakdown.copyMs += staged.copyMs;
        prestageBreakdown.templateCopyMs += staged.templateCopyMs;
        prestageBreakdown.buildMs += staged.buildMs;
        prestageBreakdown.packMs += staged.packMs;
      }
    }

    const results = new Array(jobs.length);
    let cursor = 0;
    const workerCount = Math.min(options.jobs, jobs.length || 1);

    async function workerLoop() {
      while (cursor < jobs.length) {
        const idx = cursor;
        cursor += 1;
        const job = jobs[idx];
        const filePath = path.join(__dirname, job.file);
        const metricsFile = path.join(metricsDir, `job-${idx}.json`);
        const env = {
          ...process.env,
          ZX_ENGINE: job.engine,
          ZX_FORM: job.form,
          ZX_WEBKIT_IDLE_TAB: options.idleTab ? '1' : '0',
          ZX_METRICS_FILE: metricsFile
        };
        if (sharedTemplate) {
          env.ZX_SHARED_TEMPLATE = sharedTemplate.dir;
        } else {
          delete env.ZX_SHARED_TEMPLATE;
        }
        const staged = stagedByForm.get(job.form);
        if (staged) env.ZX_PRE_STAGED = JSON.stringify(staged.entries);

        const args = [
          '--test',
          '--test-reporter=tap',
          '--test-concurrency=1',
          ...(options.pattern ? [`--test-name-pattern=${options.pattern}`] : []),
          filePath
        ];

        const outcome = await runCommandJob({
          args,
          cwd: path.resolve(__dirname, '..', '..'),
          env,
          timeoutMs: options.timeoutMs,
          file: filePath,
          allowEmpty: allowEmptyPerFile
        });

        let metrics = null;
        if (fs.existsSync(metricsFile)) metrics = JSON.parse(fs.readFileSync(metricsFile, 'utf8'));

        const label = `${job.form}/${job.engine}/${job.file}`;
        const icon = outcome.ok ? '✔' : '✖';
        console.log(
          `${icon} [${label}] (${formatSeconds(outcome.durationMs)}) tests=${outcome.counts.tests} pass=${outcome.counts.pass} fail=${outcome.counts.fail} skipped=${outcome.counts.skipped}`
        );
        if (options.verbose || !outcome.ok) {
          if (!outcome.ok) console.log(`  原因：${outcome.failures.join('；')}`);
          if (outcome.stdout.trim()) console.log(outcome.stdout.trim());
          if (outcome.stderr.trim()) console.log(outcome.stderr.trim());
        }

        results[idx] = {
          form: job.form,
          engine: job.engine,
          file: job.file,
          ok: outcome.ok,
          failures: outcome.failures,
          wallMs: Math.round(outcome.durationMs),
          exitCode: outcome.status,
          signal: outcome.signal,
          timedOut: outcome.timedOut,
          counts: outcome.counts,
          metrics
        };
      }
    }

    await Promise.all(Array.from({ length: workerCount }, () => workerLoop()));
    clearInterval(memTimer);

    const totals = { tests: 0, pass: 0, fail: 0, skipped: 0 };
    const groupTotals = new Map();
    for (const r of results) {
      for (const k of SUMMARY_KEYS) totals[k] += r.counts[k];
      const gKey = `${r.form}/${r.engine}`;
      if (!groupTotals.has(gKey)) groupTotals.set(gKey, { tests: 0, pass: 0, fail: 0, skipped: 0 });
      const g = groupTotals.get(gKey);
      for (const k of SUMMARY_KEYS) g[k] += r.counts[k];
    }

    const totalWallMs = Math.round(performance.now() - startWall);
    const failedJobs = results.filter((r) => !r.ok);
    const emptyPatternFailure = Boolean(options.pattern) && totals.pass + totals.skipped === 0;
    const passed = failedJobs.length === 0 && totals.fail === 0 && !emptyPatternFailure;

    if (emptyPatternFailure) {
      console.log(`✖ 模式 "${options.pattern}" 未命中任何真实用例`);
    }

    console.log('\n── 分组汇总 ──');
    for (const [gKey, g] of groupTotals.entries()) {
      console.log(`  ${gKey}: tests=${g.tests} pass=${g.pass} fail=${g.fail} skipped=${g.skipped}`);
    }
    console.log(
      `总计：wall=${formatSeconds(totalWallMs)}（预备夹具 ${formatSeconds(prestageMs)}） jobs=${jobs.length} workers=${options.jobs} order=${options.order} tests=${totals.tests} pass=${totals.pass} fail=${totals.fail} skipped=${totals.skipped}`
    );

    const report = {
      ok: passed,
      wallMs: totalWallMs,
      prestageMs: Math.round(prestageMs),
      prestageBreakdown: {
        copyMs: Math.round(prestageBreakdown.copyMs),
        templateCopyMs: Math.round(prestageBreakdown.templateCopyMs),
        buildMs: Math.round(prestageBreakdown.buildMs),
        packMs: Math.round(prestageBreakdown.packMs)
      },
      sumJobWallMs: results.reduce((sum, r) => sum + r.wallMs, 0),
      sumChildStageMs: Math.round(results.reduce((sum, r) => sum + (r.metrics?.stageMs ?? 0), 0)),
      sumChildCopyMs: Math.round(results.reduce((sum, r) => sum + (r.metrics?.copyMs ?? 0), 0)),
      sumChildTemplateCopyMs: Math.round(results.reduce((sum, r) => sum + (r.metrics?.templateCopyMs ?? 0), 0)),
      sumTemplateLinkCalls: results.reduce((sum, r) => sum + (r.metrics?.templateLinkCalls ?? 0), 0),
      sumTemplateLinkFallbacks: results.reduce((sum, r) => sum + (r.metrics?.templateLinkFallbacks ?? 0), 0),
      sharedTemplateSetupMs: sharedTemplate ? Math.round(sharedTemplate.copyMs) : 0,
      sumChildBuildMs: Math.round(results.reduce((sum, r) => sum + (r.metrics?.buildMs ?? 0), 0)),
      sumChildPackMs: Math.round(results.reduce((sum, r) => sum + (r.metrics?.packMs ?? 0), 0)),
      sumLaunchMs: Math.round(results.reduce((sum, r) => sum + (r.metrics?.launchMs ?? 0), 0)),
      sumCloseMs: Math.round(results.reduce((sum, r) => sum + (r.metrics?.closeMs ?? 0), 0)),
      closeTimeouts: results.filter((r) => r.metrics?.closeTimedOut).length,
      sumNewPageCount: results.reduce((sum, r) => sum + (r.metrics?.newPageCount ?? 0), 0),
      sumNewPageMs: Math.round(results.reduce((sum, r) => sum + (r.metrics?.newPageMsSum ?? 0), 0)),
      slowNewPageCount: results.reduce((sum, r) => sum + (r.metrics?.slowNewPageCount ?? 0), 0),
      maxNewPageMs: Math.round(Math.max(0, ...results.map((r) => r.metrics?.maxNewPageMs ?? 0))),
      sumAnchorSetupMs: Math.round(results.reduce((sum, r) => sum + (r.metrics?.anchorSetupMs ?? 0), 0)),
      sumBuildCalls: results.reduce((sum, r) => sum + (r.metrics?.buildCalls ?? 0), 0),
      sumPackCalls: results.reduce((sum, r) => sum + (r.metrics?.packCalls ?? 0), 0),
      sumCourseCacheHits: results.reduce((sum, r) => sum + (r.metrics?.courseCacheHits ?? 0), 0),
      jobsRequested: options.jobs,
      order: options.order,
      prestage: options.prestage,
      idleTab: Boolean(options.idleTab),
      stageMode: STAGE_MODE,
      templateShare: TEMPLATE_SHARE,
      forms: options.forms,
      engines: options.engines,
      files: selectedFiles,
      memory: {
        totalMemMB,
        baselineFreeMB,
        minFreeMB,
        peakUsedDeltaMB: baselineFreeMB - minFreeMB,
        maxChildRssMB: Math.round(Math.max(0, ...results.map((r) => (r.metrics?.maxRssKb ?? 0) / 1024)))
      },
      totals,
      failedJobs: failedJobs.map((r) => `${r.form}/${r.engine}/${r.file}`),
      jobs: results
    };

    if (options.reportPath) {
      fs.mkdirSync(path.dirname(path.resolve(options.reportPath)), { recursive: true });
      fs.writeFileSync(path.resolve(options.reportPath), JSON.stringify(report, null, 2));
    }

    return report;
  } finally {
    clearInterval(memTimer);
    for (const staged of stagedByForm.values()) staged.cleanup();
    if (sharedTemplate) sharedTemplate.cleanup();
    fs.rmSync(metricsDir, { recursive: true, force: true, maxRetries: 5 });
  }
}

if (require.main === module) {
  Promise.resolve()
    .then(() => runRunner(parseArgs()))
    .then((report) => process.exit(report.ok ? 0 : 1))
    .catch((error) => {
      console.error(error?.message || error);
      process.exit(1);
    });
}

module.exports = {
  ENGINES,
  FORMS,
  ORDERS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_FILE_WEIGHTS_MS,
  parseTap,
  evaluateJobResult,
  runCommandJob,
  validateOptions,
  planJobs,
  parseArgs,
  runRunner
};
