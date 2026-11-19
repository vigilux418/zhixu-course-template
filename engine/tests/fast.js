'use strict';
/* 日常改动的快入口：先顺序跑全部单元测试，再跑精选 Chromium E2E（覆盖路由、启动、搜索、记录与双形态）。
 *
 *   npm run test:fast                               跑全部分区 × 双形态快测
 *   node tests/fast.js --scope=routing              只跑路由与单文件历史落点
 *   node tests/fast.js --scope=boot,search --form=packed   按改动分区和交付形态过滤
 *   node tests/fast.js --report=out.json            导出耗时与结果报告
 *
 * 与 build.test.js 同源顺序执行（build.test.js 会校验并生成 template/ 构建产物），
 * 并复用 run.js 的 TAP 校验器按交付形态逐条核对 PASS 与预期 SKIP。 */
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { FORMS, runCommandJob } = require('./e2e/run');
const { stageCourses } = require('./e2e/stage');

const ENGINE_DIR = path.resolve(__dirname, '..');
const UNIT_DIR = path.join(__dirname);

/** 按改动范围分组的快入口清单，按交付形态标明预期 PASS 或预期 SKIP。 */
const FAST_E2E_GROUPS = [
  {
    scope: 'routing',
    file: path.join(__dirname, 'e2e', 'packed.e2e.js'),
    courses: ['sample'],
    tests: [
      {
        name: 'A00 单文件：首页进第一讲、下一讲、回目录、从目录再进，全程只读一次文件',
        packed: 'pass',
        folder: 'skip',
        skipReason: '这一条只对单文件有意义'
      },
      {
        name: 'A00 单文件：地址里不留 #——换页、页内锚点之后地址都是文件本身；刷新（手机上下拉刷新、切回来时浏览器自己重新载入）之后还在同一页同一处',
        packed: 'pass',
        folder: 'skip',
        skipReason: '这一条只对单文件有意义'
      },
      {
        name: '单文件历史落点：同讲和跨讲前进后退都带回离开时的位置',
        packed: 'pass',
        folder: 'skip',
        skipReason: '这一条只对单文件有意义'
      },
      {
        name: '单文件历史落点：换讲未就绪时后退再前进，正文跟随最后一次选择',
        packed: 'pass',
        folder: 'skip',
        skipReason: '这一条只对单文件有意义'
      },
      {
        name: '单文件历史落点：中途后退取消搜索后，下次进入同一讲从讲首开始',
        packed: 'pass',
        folder: 'skip',
        skipReason: '这一条只对单文件有意义'
      },
      {
        name: 'A01 正文里手写的“回到课程首页”：两种形态都进本课程首页，单文件里不重读文件',
        packed: 'pass',
        folder: 'pass'
      }
    ]
  },
  {
    scope: 'boot',
    file: path.join(__dirname, 'e2e', 'boot.e2e.js'),
    courses: ['sample'],
    tests: [
      {
        name: 'B07 启动失败时正文可见，并说明原因：运行时的文件缺失',
        packed: 'skip',
        folder: 'pass',
        skipReason: '单文件里没有可以单独缺失的文件'
      },
      {
        name: 'B13 zx-ready 出现时代码都着了色、公式都排好了，没有正在加载的字体；随后半秒内这三样都不再变',
        packed: 'pass',
        folder: 'pass'
      }
    ]
  },
  {
    scope: 'search',
    file: path.join(__dirname, 'e2e', 'search.e2e.js'),
    courses: ['edge'],
    tests: [
      {
        name: 'B22 搜索的词就在本页：浮层关掉，同样落到命中处；点一下页面，标记撤掉',
        packed: 'pass',
        folder: 'pass'
      }
    ]
  },
  {
    scope: 'records',
    file: path.join(__dirname, 'e2e', 'records.e2e.js'),
    courses: [],
    tests: [
      {
        name: 'B37 坏的备份文件和写入失败，都不改动原有记录的一个字节',
        packed: 'pass',
        folder: 'pass'
      }
    ]
  }
];

const FAST_SCOPES = FAST_E2E_GROUPS.map((group) => group.scope);
const FAST_E2E_SPECS = FAST_E2E_GROUPS[0].tests;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function buildFastPattern(specs = FAST_E2E_SPECS) {
  return `^(${specs.map((spec) => escapeRegExp(spec.name)).join('|')})$`;
}

function expectedTestsForForm(form, specs = FAST_E2E_SPECS) {
  return specs.map((spec) => ({
    name: spec.name,
    expected: spec[form],
    reason: spec[form] === 'skip' ? spec.skipReason : undefined
  }));
}

function parseList(raw) {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseFastArgs(argv = process.argv.slice(2), env = process.env) {
  let scopes = env.ZX_FAST_SCOPE !== undefined ? parseList(env.ZX_FAST_SCOPE) : ['all'];
  const rawFormEnv = env.ZX_FAST_FORM ?? env.ZX_FORM;
  let forms =
    rawFormEnv !== undefined
      ? rawFormEnv === 'both'
        ? ['packed', 'folder']
        : parseList(rawFormEnv)
      : ['packed', 'folder'];
  let jobs = env.ZX_JOBS !== undefined ? Number(env.ZX_JOBS) : 4;
  let reportPath = env.ZX_REPORT || null;

  for (const arg of argv) {
    if (arg.startsWith('--scope=')) scopes = parseList(arg.slice(8));
    else if (arg.startsWith('--form=')) {
      const value = arg.slice(7).trim();
      forms = value === 'both' ? ['packed', 'folder'] : parseList(value);
    } else if (arg.startsWith('--forms=')) forms = parseList(arg.slice(8));
    else if (arg.startsWith('--jobs=')) jobs = Number(arg.slice(7));
    else if (arg.startsWith('--report=')) reportPath = arg.slice(9);
    else throw new Error(`未知参数：${arg}`);
  }

  if (scopes.length === 0) throw new Error('快测分区不能为空（--scope）');
  const resolvedScopes = scopes.includes('all') ? FAST_SCOPES : scopes;
  const badScopes = resolvedScopes.filter((scope) => !FAST_SCOPES.includes(scope));
  if (badScopes.length > 0)
    throw new Error(`非法快测分区：${badScopes.join(', ')}（可选：all, ${FAST_SCOPES.join(', ')}）`);

  if (forms.length === 0) throw new Error('交付形态不能为空（--form）');
  const badForms = forms.filter((form) => !FORMS.includes(form));
  if (badForms.length > 0) throw new Error(`非法交付形态：${badForms.join(', ')}（可选：both, ${FORMS.join(', ')}）`);

  if (!Number.isInteger(jobs) || jobs < 1) throw new Error(`非法并发数：${jobs}`);

  return { scopes: [...new Set(resolvedScopes)], forms: [...new Set(forms)], jobs, reportPath };
}

async function runFast(input = {}) {
  const options =
    input.scopes && input.forms
      ? input
      : parseFastArgs([], {
          ...(input.scope ? { ZX_FAST_SCOPE: input.scope } : {}),
          ...(input.form ? { ZX_FAST_FORM: input.form } : {})
        });
  const reportPath = input.reportPath ?? options.reportPath ?? null;
  const totalStart = performance.now();

  console.log('── 1/2 单元测试 ──');
  const unit = await runCommandJob({
    args: ['--test', '--test-reporter=tap', UNIT_DIR],
    cwd: ENGINE_DIR,
    env: process.env
  });
  console.log(
    `${unit.ok ? '✔' : '✖'} 单元测试 (${(unit.durationMs / 1000).toFixed(2)}s): tests=${unit.counts.tests} pass=${unit.counts.pass} fail=${unit.counts.fail} skipped=${unit.counts.skipped}`
  );
  if (!unit.ok) {
    console.log(`  原因：${unit.failures.join('；')}`);
    if (unit.stdout.trim()) console.log(unit.stdout.trim());
    if (unit.stderr.trim()) console.log(unit.stderr.trim());
    const report = { ok: false, wallMs: Math.round(performance.now() - totalStart), unit, e2e: [] };
    if (reportPath) writeReport(reportPath, report);
    return report;
  }

  const groups = FAST_E2E_GROUPS.filter((group) => options.scopes.includes(group.scope));
  const tasks = [];
  for (const form of options.forms) {
    for (const group of groups) tasks.push({ form, group });
  }

  const neededCourses = [...new Set(groups.flatMap((group) => group.courses))];
  console.log(`\n── 2/2 精选 Chromium E2E（分区：${options.scopes.join(',')}；形态：${options.forms.join(',')}） ──`);
  const e2eStart = performance.now();
  const stagedByForm = new Map();
  let prestageMs = 0;
  const results = new Array(tasks.length);

  try {
    if (neededCourses.length > 0) {
      for (const form of options.forms) {
        const staged = stageCourses(neededCourses, { packed: form === 'packed' });
        stagedByForm.set(form, staged);
        prestageMs += staged.stageMs;
      }
    }

    let cursor = 0;
    const workerCount = Math.min(options.jobs || 4, tasks.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (cursor < tasks.length) {
          const idx = cursor;
          cursor += 1;
          const { form, group } = tasks[idx];
          const staged = stagedByForm.get(form);
          const env = {
            ...process.env,
            ZX_ENGINE: 'chromium',
            ZX_FORM: form,
            ...(staged ? { ZX_PRE_STAGED: JSON.stringify(staged.entries) } : {})
          };
          const res = await runCommandJob({
            args: [
              '--test',
              '--test-reporter=tap',
              '--test-concurrency=1',
              `--test-name-pattern=${buildFastPattern(group.tests)}`,
              group.file
            ],
            cwd: ENGINE_DIR,
            env,
            file: group.file,
            expectedTests: expectedTestsForForm(form, group.tests)
          });
          console.log(
            `${res.ok ? '✔' : '✖'} [${form}/chromium/${group.scope}] (${(res.durationMs / 1000).toFixed(2)}s): tests=${res.counts.tests} pass=${res.counts.pass} fail=${res.counts.fail} skipped=${res.counts.skipped}`
          );
          if (!res.ok) {
            console.log(`  原因：${res.failures.join('；')}`);
            if (res.stdout.trim()) console.log(res.stdout.trim());
            if (res.stderr.trim()) console.log(res.stderr.trim());
          }
          results[idx] = { scope: group.scope, form, ...res };
        }
      })
    );
  } finally {
    for (const staged of stagedByForm.values()) staged.cleanup();
  }

  const totalWallMs = Math.round(performance.now() - totalStart);
  const e2eMs = Math.round(performance.now() - e2eStart);
  const ok = unit.ok && results.every((r) => r.ok);
  console.log(
    `\n总耗时：${(totalWallMs / 1000).toFixed(2)}s（单测 ${(unit.durationMs / 1000).toFixed(2)}s + E2E ${(e2eMs / 1000).toFixed(2)}s，含预备 ${(prestageMs / 1000).toFixed(2)}s）`
  );

  const report = {
    ok,
    wallMs: totalWallMs,
    unitMs: Math.round(unit.durationMs),
    e2eMs,
    prestageMs: Math.round(prestageMs),
    scopes: options.scopes,
    forms: options.forms,
    unit: { ok: unit.ok, counts: unit.counts, failures: unit.failures },
    e2e: results.map((r) => ({
      scope: r.scope,
      form: r.form,
      ok: r.ok,
      wallMs: Math.round(r.durationMs),
      counts: r.counts,
      failures: r.failures
    }))
  };
  if (reportPath) writeReport(reportPath, report);
  return report;
}

function writeReport(reportPath, report) {
  const full = path.resolve(reportPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(report, null, 2));
}

if (require.main === module) {
  Promise.resolve()
    .then(() => runFast(parseFastArgs()))
    .then((report) => process.exit(report.ok ? 0 : 1))
    .catch((error) => {
      console.error(error?.message || error);
      process.exit(1);
    });
}

module.exports = {
  FAST_E2E_GROUPS,
  FAST_E2E_SPECS,
  FAST_SCOPES,
  buildFastPattern,
  expectedTestsForForm,
  parseFastArgs,
  runFast
};
