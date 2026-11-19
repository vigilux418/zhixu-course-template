'use strict';
/* E2E 调度与校验器的单元测试：验证超时、非零退出、0 命中空跑、预期 SKIP 与预备夹具地址传递。
 *   node --test engine/tests/runner.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseTap, evaluateJobResult, runCommandJob, planJobs, parseArgs } = require('./e2e/run');
const { FAST_E2E_GROUPS, FAST_E2E_SPECS, buildFastPattern, expectedTestsForForm, parseFastArgs } = require('./fast');

const ENGINE_DIR = path.resolve(__dirname, '..');

test('par8 超时缺失汇总且 code=null 的记录必须判失败（不能报 fail=0）', () => {
  // 还原 par8.json 中 packed/firefox/layout.e2e.js 在 900.3s 超时截断、无 TAP 汇总的场景
  const truncatedTap = [
    'TAP version 13',
    '# Subtest: sample 宽屏无横向溢出',
    'ok 1 - sample 宽屏无横向溢出',
    '  ---',
    '  duration_ms: 8120.4',
    "  type: 'test'",
    '  ...'
  ].join('\n');

  const res = evaluateJobResult({
    status: null,
    signal: 'SIGTERM',
    error: Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    timedOut: true,
    stdout: truncatedTap,
    stderr: '',
    file: 'engine/tests/e2e/layout.e2e.js',
    durationMs: 900315
  });

  assert.equal(res.ok, false);
  assert.equal(res.timedOut, true);
  assert.ok(res.counts.fail >= 1);
  assert.ok(res.failures.some((msg) => msg.includes('超时')));
  assert.ok(res.failures.some((msg) => msg.includes('status=null')));
  assert.ok(res.failures.some((msg) => msg.includes('缺少 TAP 汇总')));
});

test('进程非零退出或被信号中止时，即使 TAP 印了 fail=0 也必须判失败', () => {
  const greenTap = [
    'TAP version 13',
    '# Subtest: 假定通过的一条',
    'ok 1 - 假定通过的一条',
    '1..1',
    '# tests 1',
    '# suites 0',
    '# pass 1',
    '# fail 0',
    '# cancelled 0',
    '# skipped 0',
    '# todo 0'
  ].join('\n');

  const nonZero = evaluateJobResult({ status: 1, stdout: greenTap });
  assert.equal(nonZero.ok, false);
  assert.ok(nonZero.counts.fail >= 1);
  assert.ok(nonZero.failures.some((msg) => msg.includes('退出码非零')));

  const signaled = evaluateJobResult({ status: null, signal: 'SIGKILL', stdout: greenTap });
  assert.equal(signaled.ok, false);
  assert.ok(signaled.counts.fail >= 1);
  assert.ok(signaled.failures.some((msg) => msg.includes('SIGKILL')));
});

test('Node 26 --test-name-pattern 0 命中时的 1..0 文件包装假绿必须判失败', () => {
  const zeroMatchTap = [
    'TAP version 13',
    '1..0',
    '# Subtest: tests\\e2e\\turn.e2e.js',
    'ok 1 - tests\\e2e\\turn.e2e.js',
    '  ---',
    '  duration_ms: 367.4803',
    "  type: 'test'",
    '  ...',
    '1..1',
    '# tests 1',
    '# suites 0',
    '# pass 1',
    '# fail 0',
    '# cancelled 0',
    '# skipped 0',
    '# todo 0',
    '# duration_ms 376.4121'
  ].join('\n');

  const tap = parseTap(zeroMatchTap, 'tests/e2e/turn.e2e.js');
  assert.equal(tap.zeroMatchPlan, true);
  assert.equal(tap.realTests.length, 0);

  const res = evaluateJobResult({ status: 0, stdout: zeroMatchTap, file: 'tests/e2e/turn.e2e.js' });
  assert.equal(res.ok, false);
  assert.equal(res.counts.tests, 0);
  assert.equal(res.counts.pass, 0);
  assert.equal(res.counts.fail, 1);
  assert.ok(res.failures.some((msg) => msg.includes('1..0 空跑')));
});

test('真实子进程以不存在的 pattern 运行测试文件时，runCommandJob 必须判失败', async () => {
  const contractFile = path.join(__dirname, 'contract.test.js');
  const res = await runCommandJob({
    args: ['--test', '--test-reporter=tap', '--test-name-pattern=__NO_MATCH_999__', contractFile],
    cwd: ENGINE_DIR,
    file: contractFile
  });
  assert.equal(res.ok, false);
  assert.equal(res.counts.pass, 0);
  assert.equal(res.counts.fail, 1);
});

test('快入口形态校验区分预期 SKIP、无原因 SKIP、漏跑与形态错配', () => {
  const folderTapLines = ['TAP version 13'];
  FAST_E2E_SPECS.forEach((spec, index) => {
    const escapedName = spec.name.replace(/#/g, '\\#');
    const suffix = spec.folder === 'skip' ? ` # SKIP ${spec.skipReason}` : '';
    folderTapLines.push(`ok ${index + 1} - ${escapedName}${suffix}`);
  });
  folderTapLines.push(
    `1..${FAST_E2E_SPECS.length}`,
    `# tests ${FAST_E2E_SPECS.length}`,
    '# suites 0',
    '# pass 1',
    '# fail 0',
    '# cancelled 0',
    `# skipped ${FAST_E2E_SPECS.length - 1}`,
    '# todo 0'
  );
  const folderTap = folderTapLines.join('\n');

  const folderEval = evaluateJobResult({
    status: 0,
    stdout: folderTap,
    expectedTests: expectedTestsForForm('folder')
  });
  assert.equal(folderEval.ok, true, folderEval.failures.join('; '));
  assert.deepEqual(folderEval.counts, { tests: 6, pass: 1, fail: 0, skipped: 5 });

  // 同一份有 5 条 SKIP 的输出按 packed 预期校验，必须判失败
  const mismatchEval = evaluateJobResult({
    status: 0,
    stdout: folderTap,
    expectedTests: expectedTestsForForm('packed')
  });
  assert.equal(mismatchEval.ok, false);
  assert.ok(mismatchEval.failures.some((msg) => msg.includes('预期 PASS，实际为 SKIP')));

  // 无原因 SKIP 必须判失败
  const reasonlessTap = folderTap.replace(`# SKIP ${FAST_E2E_SPECS[0].skipReason}`, '# SKIP');
  const reasonlessEval = evaluateJobResult({ status: 0, stdout: reasonlessTap });
  assert.equal(reasonlessEval.ok, false);
  assert.ok(reasonlessEval.failures.some((msg) => msg.includes('缺少跳过原因')));

  // 缺少预期用例必须判失败
  const missingTap = [
    'TAP version 13',
    `ok 1 - ${FAST_E2E_SPECS[0].name}`,
    '1..1',
    '# tests 1',
    '# suites 0',
    '# pass 1',
    '# fail 0',
    '# cancelled 0',
    '# skipped 0',
    '# todo 0'
  ].join('\n');
  const missingEval = evaluateJobResult({
    status: 0,
    stdout: missingTap,
    expectedTests: expectedTestsForForm('packed')
  });
  assert.equal(missingEval.ok, false);
  assert.ok(missingEval.failures.some((msg) => msg.includes('缺少预期用例')));
});

test('快入口清单与各 E2E 测试文件用例逐一对应且支持分区/形态过滤', () => {
  for (const group of FAST_E2E_GROUPS) {
    const source = fs.readFileSync(group.file, 'utf8');
    const regex = new RegExp(buildFastPattern(group.tests));
    for (const spec of group.tests) {
      assert.equal(regex.test(spec.name), true, `正则未命中：${spec.name}`);
      if (spec.name.startsWith('B07 ')) {
        assert.ok(source.includes("'运行时的文件缺失'"), `${group.file} 缺少：${spec.name}`);
      } else {
        assert.ok(source.includes(spec.name), `${group.file} 中找不到用例：${spec.name}`);
      }
    }
    const literalTitles = [...source.matchAll(/\btest\(\s*\n?\s*'([^']+)'/g)].map((m) => m[1]);
    const matchedLiterals = literalTitles.filter((title) => regex.test(title));
    const expectedLiterals = group.tests.map((spec) => spec.name).filter((name) => !name.startsWith('B07 '));
    assert.deepEqual(matchedLiterals, expectedLiterals);
  }

  assert.deepEqual(parseFastArgs(['--scope=routing,search', '--form=packed']).scopes, ['routing', 'search']);
  assert.deepEqual(parseFastArgs(['--scope=boot', '--form=folder']).forms, ['folder']);
  assert.throws(() => parseFastArgs(['--scope=']), /不能为空/);
  assert.throws(() => parseFastArgs(['--scope=unknown']), /非法快测分区/);
  assert.throws(() => parseFastArgs(['--form=pakced']), /非法交付形态/);
});

test('缺失最终 1..N 计划行或明细与 pass/skipped 汇总冲突必须判失败', () => {
  const noPlanTap = [
    'TAP version 13',
    'ok 1 - 第一条',
    'ok 2 - 第二条',
    '# tests 2',
    '# suites 0',
    '# pass 2',
    '# fail 0',
    '# skipped 0',
    '# todo 0'
  ].join('\n');
  const noPlanEval = evaluateJobResult({ status: 0, stdout: noPlanTap });
  assert.equal(noPlanEval.ok, false);
  assert.ok(noPlanEval.failures.some((msg) => msg.includes('缺少 TAP 计划行')));

  const mismatchSummaryTap = [
    'TAP version 13',
    'ok 1 - 第一条',
    'ok 2 - 第二条',
    '1..2',
    '# tests 2',
    '# suites 0',
    '# pass 1',
    '# fail 0',
    '# skipped 1',
    '# todo 0'
  ].join('\n');
  const mismatchEval = evaluateJobResult({ status: 0, stdout: mismatchSummaryTap });
  assert.equal(mismatchEval.ok, false);
  assert.ok(mismatchEval.failures.some((msg) => msg.includes('pass 明细(2)与汇总(1)不一致')));
  assert.ok(mismatchEval.failures.some((msg) => msg.includes('skipped 明细(0)与汇总(1)不一致')));
});

test('多字节 UTF-8 中文测试名跨 stdout chunk 拆分时不产生乱码误报', async () => {
  const name = '读取历史记录后恢复位置';
  const tapText = [
    'TAP version 13',
    `ok 1 - ${name}`,
    '1..1',
    '# tests 1',
    '# suites 0',
    '# pass 1',
    '# fail 0',
    '# skipped 0',
    '# todo 0',
    ''
  ].join('\n');
  const buf = Buffer.from(tapText, 'utf8');
  // 故意把“读”（3 字节 UTF-8）从中间劈开成两次 write()
  const idx = buf.indexOf(Buffer.from('读', 'utf8')) + 1;
  const script = [
    `const b = Buffer.from(${JSON.stringify(buf.toString('base64'))}, 'base64');`,
    `process.stdout.write(b.subarray(0, ${idx}));`,
    `setTimeout(() => process.stdout.write(b.subarray(${idx})), 15);`
  ].join('\n');

  const res = await runCommandJob({
    args: ['-e', script],
    cwd: ENGINE_DIR,
    expectedTests: [{ name, expected: 'pass' }]
  });
  assert.equal(res.ok, true, res.failures.join('; '));
  assert.deepEqual(
    res.tap.realTests.map((t) => t.name),
    [name]
  );
});

test('空计划以及非法形态、内核、文件和并发参数在排班前拒绝', () => {
  const runPath = path.join(__dirname, 'e2e', 'run.js');

  for (const args of [
    ['--forms='],
    ['--forms=pakced'],
    ['--engines='],
    ['--engines=chrmium'],
    ['--files='],
    ['--files=no-such-file.e2e.js'],
    ['--jobs=0'],
    ['--order=bad']
  ]) {
    assert.throws(() => parseArgs(args, {}), Error, `未拦截参数：${args.join(' ')}`);
  }

  assert.throws(() => planJobs({ forms: [], engines: ['chromium'], files: ['packed.e2e.js'] }), /不能为空/);
  assert.throws(() => planJobs({ forms: ['pakced'], engines: ['chromium'], files: ['packed.e2e.js'] }), /非法交付形态/);

  // 验证真实 CLI 遇到空计划和拼写错误直接以非零退出并拒绝执行
  for (const badArg of ['--forms=', '--forms=pakced']) {
    const cli = spawnSync(process.execPath, [runPath, badArg, '--files=packed.e2e.js'], {
      cwd: ENGINE_DIR,
      encoding: 'utf8'
    });
    assert.notEqual(cli.status, 0, `${badArg} 必须非零退出`);
  }
});

test('LPT 混合权重与实测毫秒报告同单位比较（packed.e2e.js 112s 排在实测 54.84s print.e2e.js 之前）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zx-plan-mixed-'));
  const weightsFile = path.join(dir, 'pilot-partial.json');
  try {
    fs.writeFileSync(
      weightsFile,
      JSON.stringify({
        jobs: [{ form: 'packed', engine: 'chromium', file: 'print.e2e.js', wallMs: 54840 }]
      })
    );
    const ordered = planJobs({
      forms: ['packed'],
      engines: ['chromium'],
      files: ['print.e2e.js', 'packed.e2e.js'],
      order: 'lpt',
      weightsPath: weightsFile
    });
    assert.deepEqual(
      ordered.map((job) => job.file),
      ['packed.e2e.js', 'print.e2e.js']
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('planJobs 在 order=lpt 时按实测权重降序排班，fifo 保持原顺序', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zx-plan-'));
  const weightsFile = path.join(dir, 'weights.json');
  try {
    fs.writeFileSync(
      weightsFile,
      JSON.stringify({
        jobs: [
          { form: 'folder', engine: 'chromium', file: 'a.e2e.js', wallMs: 5000 },
          { form: 'folder', engine: 'chromium', file: 'b.e2e.js', wallMs: 90000 },
          { form: 'packed', engine: 'webkit', file: 'c.e2e.js', wallMs: 120000 }
        ]
      })
    );
    const fifo = planJobs({
      forms: ['folder', 'packed'],
      engines: ['chromium', 'webkit'],
      files: ['a.e2e.js', 'b.e2e.js', 'c.e2e.js'],
      order: 'fifo'
    });
    assert.equal(fifo[0].file, 'a.e2e.js');

    const lpt = planJobs({
      forms: ['folder', 'packed'],
      engines: ['chromium', 'webkit'],
      files: ['a.e2e.js', 'b.e2e.js', 'c.e2e.js'],
      order: 'lpt',
      weightsPath: weightsFile
    });
    assert.equal(`${lpt[0].form}/${lpt[0].engine}/${lpt[0].file}`, 'packed/webkit/c.e2e.js');
    assert.equal(`${lpt[1].form}/${lpt[1].engine}/${lpt[1].file}`, 'folder/chromium/b.e2e.js');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stage.js 预备夹具在 packed 模式下同时接收课程目录和单文件导出路径', () => {
  const stagePath = path.join(__dirname, 'e2e', 'stage.js');
  const fakeDir = path.join(os.tmpdir(), 'zx-fake-course');
  const fakePacked = path.join(fakeDir, 'export', 'course.html');

  const missingPacked = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(stagePath)})`], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ZX_FORM: 'packed',
      ZX_PRE_STAGED: JSON.stringify({ sample: { dir: fakeDir } })
    }
  });
  assert.notEqual(missingPacked.status, 0);
  assert.match(missingPacked.stderr, /缺少导出文件地址/);

  const valid = spawnSync(
    process.execPath,
    [
      '-e',
      `const s = require(${JSON.stringify(stagePath)}); console.log(s.course('sample')); console.log(s.fileUrl(s.course('sample'), '01-intro.html', '#sec'));`
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        ZX_FORM: 'packed',
        ZX_PRE_STAGED: JSON.stringify({ sample: { dir: fakeDir, packedFile: fakePacked } })
      }
    }
  );
  assert.equal(valid.status, 0, valid.stderr);
  const [outDir, outUrl] = valid.stdout.trim().split(/\r?\n/);
  assert.equal(outDir, fakeDir);
  assert.match(outUrl, /export\/course\.html#01-intro\.html\/sec$/);
});

test('WebKit 空白锚页开关校验：Windows 默认开启、支持回退禁用、非法值报错', () => {
  const stagePath = path.join(__dirname, 'e2e', 'stage.js');
  assert.equal(parseArgs([], {}, 'win32').idleTab, true);
  assert.equal(parseArgs([], {}, 'linux').idleTab, false);
  assert.equal(parseArgs(['--webkit-idle-tab'], {}, 'linux').idleTab, true);
  assert.equal(parseArgs(['--no-webkit-idle-tab'], { ZX_WEBKIT_IDLE_TAB: '1' }, 'win32').idleTab, false);
  assert.equal(parseArgs([], { ZX_WEBKIT_IDLE_TAB: '0' }, 'win32').idleTab, false);

  const badEnv = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(stagePath)})`], {
    encoding: 'utf8',
    env: { ...process.env, ZX_ENGINE: 'webkit', ZX_WEBKIT_IDLE_TAB: 'yes' }
  });
  assert.notEqual(badEnv.status, 0);
  assert.match(badEnv.stderr, /ZX_WEBKIT_IDLE_TAB/);
});

test('锚页初始化在 newPage 或 goto 抛错后，dispose 仍关闭浏览器、删临时目录并写出指标', () => {
  const stagePath = path.join(__dirname, 'e2e', 'stage.js');
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'zx-anchor-fail-'));
  try {
    for (const failAt of ['newPage', 'goto']) {
      const metricsFile = path.join(tmpBase, `metrics-${failAt}.json`);
      const script = [
        "const fs = require('fs');",
        "const playwright = require('playwright');",
        'let closeCalls = 0;',
        'playwright.webkit.launch = async () => ({',
        '  async close() { closeCalls += 1; },',
        '  async newContext() {',
        '    return {',
        '      async newPage() {',
        `        if (${JSON.stringify(failAt)} === 'newPage') throw new Error('controlled anchor newPage failure');`,
        '        return {',
        "          async goto() { throw new Error('controlled anchor goto failure'); }",
        '        };',
        '      }',
        '    };',
        '  }',
        '});',
        `const stage = require(${JSON.stringify(stagePath)});`,
        "const tempDir = stage.scratch('fail-anchor');",
        "let startError = '';",
        "let disposeError = '';",
        '(async () => {',
        '  try {',
        '    await stage.newContext();',
        '  } catch (err) {',
        '    startError = err.message;',
        '  }',
        '  try {',
        '    await stage.dispose();',
        '  } catch (err) {',
        '    disposeError = err.message;',
        '  }',
        '  console.log(JSON.stringify({',
        '    startError,',
        '    disposeError,',
        '    closeCalls,',
        '    tempExists: fs.existsSync(tempDir),',
        `    metricsExists: fs.existsSync(${JSON.stringify(metricsFile)})`,
        '  }));',
        '})();'
      ].join('\n');

      const res = spawnSync(process.execPath, ['-e', script], {
        cwd: ENGINE_DIR,
        encoding: 'utf8',
        env: {
          ...process.env,
          ZX_ENGINE: 'webkit',
          ZX_WEBKIT_IDLE_TAB: '1',
          ZX_METRICS_FILE: metricsFile
        }
      });
      assert.equal(res.status, 0, res.stderr);
      const parsed = JSON.parse(res.stdout.trim());
      assert.equal(parsed.startError, `controlled anchor ${failAt} failure`);
      assert.equal(parsed.disposeError, '');
      assert.equal(parsed.closeCalls, 1);
      assert.equal(parsed.tempExists, false);
      assert.equal(parsed.metricsExists, true);
      const metrics = JSON.parse(fs.readFileSync(metricsFile, 'utf8'));
      assert.equal(metrics.idleTab, true);
    }
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
});

test('进程内 build/pack 与命令行输出字节一致、按夹具解析模板资源、报错诊断一致且保留旧导出', () => {
  const stage = require('./e2e/stage');
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'zx-inproc-test-'));
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8b8AAAAASUVORK5CYII=',
    'base64'
  );
  const manifest =
    'window.ZHIXU_COURSE = {\n  id: "parity",\n  title: "一致测试",\n  units: [{ lessons: ["01-first.html"] }]\n};\n';
  const validLesson = [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>第一讲</title>',
    '<meta name="description" content="包含代码、公式和图片的一讲。">',
    '<link rel="stylesheet" href="template/zhixu.css">',
    '<script src="template/zhixu.js"></script>',
    '</head>',
    '<body>',
    '<main>',
    '<h1>第一讲</h1>',
    '<section id="sec">',
    '<h2>正文小节</h2>',
    '<p>行内公式 <span class="math">x^2 + 1</span> 与说明。</p>',
    '<pre data-lang="python"><code>print(1 &lt; 2)</code></pre>',
    '<figure><img src="images/dot.png" alt="示意图"></figure>',
    '</section>',
    '</main>',
    '</body>',
    '</html>',
    ''
  ].join('\n');

  const createFixture = (name) => {
    const dir = path.join(tmpBase, name);
    fs.mkdirSync(path.join(dir, 'course'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'course', 'course.js'), manifest);
    fs.writeFileSync(path.join(dir, '01-first.html'), validLesson);
    fs.writeFileSync(path.join(dir, 'images', 'dot.png'), png);
    stage.installTemplate(dir);
    return dir;
  };

  try {
    // 1. 同一夹具：CLI 与进程内生成的 index.html、course/data.js 和导出 HTML 逐字节一致
    const cliDir = createFixture('cli');
    const inprocDir = createFixture('inproc');

    const cliBuild = stage.zx(cliDir, 'build');
    const inprocBuild = stage.runBuildInProcess(inprocDir);
    assert.equal(cliBuild.status, 0, cliBuild.output);
    assert.equal(inprocBuild.status, 0, inprocBuild.output);
    assert.equal(inprocBuild.output.trim(), cliBuild.output.trim());
    assert.equal(
      Buffer.compare(
        fs.readFileSync(path.join(cliDir, 'index.html')),
        fs.readFileSync(path.join(inprocDir, 'index.html'))
      ),
      0
    );
    assert.equal(
      Buffer.compare(
        fs.readFileSync(path.join(cliDir, 'course', 'data.js')),
        fs.readFileSync(path.join(inprocDir, 'course', 'data.js'))
      ),
      0
    );

    const cliPack = stage.zx(cliDir, 'pack');
    const inprocPack = stage.runPackInProcess(inprocDir);
    assert.equal(cliPack.status, 0, cliPack.output);
    assert.equal(inprocPack.status, 0, inprocPack.output);
    assert.equal(inprocPack.output.trim(), cliPack.output.trim());
    const exportedRel = inprocPack.file;
    assert.equal(exportedRel, 'export/一致测试.html');
    const cliExportBytes = fs.readFileSync(path.join(cliDir, exportedRel));
    const inprocExportBytes = fs.readFileSync(path.join(inprocDir, exportedRel));
    assert.equal(Buffer.compare(cliExportBytes, inprocExportBytes), 0);

    // 2. 按当前夹具的 template/ 解析运行时、CSS 与字体，而不是母版目录
    const localDir = createFixture('fixture-local');
    fs.appendFileSync(path.join(localDir, 'template', 'zhixu.css'), '\n/* fixture-local-css-marker */\n');
    fs.appendFileSync(path.join(localDir, 'template', 'app.js'), '\n/* fixture-local-app-marker */\n');
    fs.appendFileSync(path.join(localDir, 'template', 'zhixu.js'), '\n/* fixture-local-runtime-marker */\n');
    const fakeFont = Buffer.from('FIXTURE-LOCAL-SERIF-FONT');
    fs.writeFileSync(path.join(localDir, 'template', 'fonts', 'serif.woff'), fakeFont);
    const localPack = stage.runPackInProcess(localDir);
    assert.equal(localPack.status, 0, localPack.output);
    const localHtml = fs.readFileSync(path.join(localDir, localPack.file), 'utf8');
    assert.ok(localHtml.includes('fixture-local-css-marker'));
    assert.ok(localHtml.includes('fixture-local-app-marker'));
    assert.ok(localHtml.includes('fixture-local-runtime-marker'));
    assert.ok(localHtml.includes(fakeFont.toString('base64')));

    // 3. 失败诊断一致且保留上一次导出的单文件
    const brokenLesson = validLesson.replace('data-lang="python"', 'data-lang="unknown-lang-xyz"');
    fs.writeFileSync(path.join(cliDir, '01-first.html'), brokenLesson);
    fs.writeFileSync(path.join(inprocDir, '01-first.html'), brokenLesson);

    const cliBuildFail = stage.zx(cliDir, 'build');
    const inprocBuildFail = stage.runBuildInProcess(inprocDir);
    assert.equal(cliBuildFail.status, 1);
    assert.equal(inprocBuildFail.status, 1);
    assert.equal(inprocBuildFail.output.trim(), cliBuildFail.output.trim());

    const cliPackFail = stage.zx(cliDir, 'pack');
    const inprocPackFail = stage.runPackInProcess(inprocDir);
    assert.equal(cliPackFail.status, 1);
    assert.equal(inprocPackFail.status, 1);
    assert.equal(inprocPackFail.file, null);
    assert.equal(inprocPackFail.output.trim(), cliPackFail.output.trim());
    assert.throws(() => stage.pack(inprocDir), /code\/lang[\s\S]*上一次导出的文件没有动/);
    assert.equal(Buffer.compare(fs.readFileSync(path.join(inprocDir, exportedRel)), inprocExportBytes), 0);

    // 4. 缺少 course/course.js 时返回状态码 2 与相同提示
    const emptyDir = path.join(tmpBase, 'empty');
    fs.mkdirSync(emptyDir, { recursive: true });
    stage.installTemplate(emptyDir);
    assert.equal(stage.runBuildInProcess(emptyDir).status, 2);
    assert.equal(stage.runPackInProcess(emptyDir).status, 2);
    assert.match(stage.runBuildInProcess(emptyDir).output, /找不到 course\/course\.js/);
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('ZX_STAGE_MODE 默认 inprocess，支持 cli 回退并拒绝非法值', () => {
  const stagePath = path.join(__dirname, 'e2e', 'stage.js');
  const probe = (envPatch) => {
    const env = { ...process.env };
    delete env.ZX_STAGE_MODE;
    Object.assign(env, envPatch);
    return spawnSync(
      process.execPath,
      ['-e', `const s = require(${JSON.stringify(stagePath)}); console.log(s.STAGE_MODE);`],
      { cwd: ENGINE_DIR, encoding: 'utf8', env }
    );
  };

  const def = probe({});
  assert.equal(def.status, 0, def.stderr);
  assert.equal(def.stdout.trim(), 'inprocess');

  const cli = probe({ ZX_STAGE_MODE: 'cli' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(cli.stdout.trim(), 'cli');

  const bad = probe({ ZX_STAGE_MODE: 'invalid' });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /非法环境变量 ZX_STAGE_MODE/);
});

test('P2 回归：自定义夹具移走高亮语言或缩窄字体覆盖表后，进程内校验与打包同真实 CLI 一致', () => {
  const crypto = require('crypto');
  const stage = require('./e2e/stage');
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'zx-p2-fixture-'));
  const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const makeLesson = (body) =>
    [
      '<!doctype html>',
      '<html lang="zh-CN">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>自定义模板测试</title>',
      '<meta name="description" content="自定义模板校验一致性。">',
      '<link rel="stylesheet" href="template/zhixu.css">',
      '<script src="template/zhixu.js"></script>',
      '</head>',
      '<body>',
      '<main>',
      '<h1>自定义模板测试</h1>',
      `<section id="s1"><h2>小节</h2>${body}</section>`,
      '</main>',
      '</body>',
      '</html>',
      ''
    ].join('\n');
  const createFixture = (name, body) => {
    const dir = path.join(tmpBase, name);
    fs.mkdirSync(path.join(dir, 'course'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'course', 'course.js'),
      'window.ZHIXU_COURSE = { id: "p2", title: "自定义模板", units: [{ lessons: ["lesson.html"] }] };\n'
    );
    fs.writeFileSync(path.join(dir, 'lesson.html'), makeLesson(body));
    stage.installTemplate(dir);
    return dir;
  };

  try {
    // 1. 先成功导出含 abnf 代码的课程，再移走该夹具自己的 abnf.min.js
    const langRoot = createFixture('lang', '<p>正文。</p><pre data-lang="abnf"><code>rule = DIGIT</code></pre>');
    const firstPack = stage.runPackInProcess(langRoot);
    assert.equal(firstPack.status, 0, firstPack.output);
    const exportFile = path.join(langRoot, firstPack.file);
    const beforeHash = sha(exportFile);

    const langFile = path.join(langRoot, 'template', 'vendor', 'highlight', 'languages', 'abnf.min.js');
    fs.renameSync(langFile, `${langFile}.absent`);

    const cliBuild = stage.zx(langRoot, 'build');
    const inprocBuild = stage.runBuildInProcess(langRoot);
    assert.equal(cliBuild.status, 1);
    assert.equal(inprocBuild.status, 1);
    assert.equal(inprocBuild.output.trim(), cliBuild.output.trim());
    assert.match(inprocBuild.output, /code\/lang/);

    const cliPack = stage.zx(langRoot, 'pack');
    const inprocPack = stage.runPackInProcess(langRoot);
    assert.equal(cliPack.status, 1);
    assert.equal(inprocPack.status, 1);
    assert.equal(inprocPack.file, null);
    assert.equal(inprocPack.output.trim(), cliPack.output.trim());
    assert.equal(sha(exportFile), beforeHash, '失败时上一次导出的单文件必须原样保留');

    // 2. 同一夹具先成功导出含内置 python 的课程，再修改夹具自己的 highlight.min.js 注销 python 后，CLI 与进程内一致拒绝且保留旧导出
    const coreRoot = createFixture('core-py', '<p>正文。</p><pre data-lang="python"><code>x = 1</code></pre>');
    const firstCorePack = stage.runPackInProcess(coreRoot);
    assert.equal(firstCorePack.status, 0, firstCorePack.output);
    const coreExportFile = path.join(coreRoot, firstCorePack.file);
    const coreBeforeHash = sha(coreExportFile);

    const coreFile = path.join(coreRoot, 'template', 'vendor', 'highlight', 'highlight.min.js');
    fs.appendFileSync(coreFile, '\n;hljs.unregisterLanguage("python");\n');

    const cliCoreBuild = stage.zx(coreRoot, 'build');
    const inprocCoreBuild = stage.runBuildInProcess(coreRoot);
    assert.equal(cliCoreBuild.status, 1);
    assert.equal(inprocCoreBuild.status, 1);
    assert.equal(inprocCoreBuild.output.trim(), cliCoreBuild.output.trim());
    assert.match(inprocCoreBuild.output, /code\/lang/);

    const cliCorePack = stage.zx(coreRoot, 'pack');
    const inprocCorePack = stage.runPackInProcess(coreRoot);
    assert.equal(cliCorePack.status, 1);
    assert.equal(inprocCorePack.status, 1);
    assert.equal(inprocCorePack.file, null);
    assert.equal(inprocCorePack.output.trim(), cliCorePack.output.trim());
    assert.equal(sha(coreExportFile), coreBeforeHash, '高亮主包校验失败时上一次导出的单文件必须原样保留');

    // 3. 同一夹具把字体覆盖表缩窄为 ASCII 后，进程内 build 与真实 CLI 都报 font/coverage
    const fontRoot = createFixture('font', '<p>这是一讲中文正文。</p>');
    assert.equal(stage.runBuildInProcess(fontRoot).status, 0);
    fs.writeFileSync(path.join(fontRoot, 'template', 'fonts', 'serif.ranges.txt'), '20-7E\n');
    const cliFont = stage.zx(fontRoot, 'build');
    const inprocFont = stage.runBuildInProcess(fontRoot);
    assert.equal(cliFont.status, 0);
    assert.equal(inprocFont.status, 0);
    assert.match(cliFont.output, /font\/coverage/);
    assert.equal(inprocFont.output.trim(), cliFont.output.trim());

    // 4. 缺少夹具本地 template/ 时进程内入口应报错
    const noTpl = path.join(tmpBase, 'no-tpl');
    fs.mkdirSync(path.join(noTpl, 'course'), { recursive: true });
    fs.writeFileSync(
      path.join(noTpl, 'course', 'course.js'),
      'window.ZHIXU_COURSE = { id: "notpl", title: "无模板", units: [{ lessons: ["lesson.html"] }] };\n'
    );
    fs.writeFileSync(path.join(noTpl, 'lesson.html'), makeLesson('<p>正文。</p>'));
    assert.equal(stage.runBuildInProcess(noTpl).status, 1);
    assert.equal(stage.runPackInProcess(noTpl).status, 1);
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('2C-3A：makeCourse 共享临时模板（含下载链接、CLI 回退、产物一致、销毁不损目标及 EPERM 回退）', () => {
  const crypto = require('crypto');
  const stage = require('./e2e/stage');
  const stagePath = path.join(__dirname, 'e2e', 'stage.js');
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'zx-share-test-'));
  const hashTree = (root) => {
    const out = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(root, full).replace(/\\/g, '/');
        if (entry.isDirectory()) {
          walk(full);
        } else {
          out.push(`${rel}:${crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')}`);
        }
      }
    };
    walk(root);
    return crypto.createHash('sha256').update(out.join('\n')).digest('hex');
  };

  const shared = stage.createSharedTemplate();
  try {
    const beforeTreeHash = hashTree(shared.dir);
    const runProbe = (envPatch, script) => {
      const env = { ...process.env };
      delete env.ZX_TEMPLATE_SHARE;
      delete env.ZX_SHARED_TEMPLATE;
      delete env.ZX_STAGE_MODE;
      delete env.ZX_FORM;
      delete env.ZX_METRICS_FILE;
      Object.assign(env, envPatch);
      return spawnSync(process.execPath, ['-e', script], { cwd: ENGINE_DIR, encoding: 'utf8', env });
    };

    // 1. 非法 ZX_TEMPLATE_SHARE 被拒绝
    const bad = runProbe({ ZX_TEMPLATE_SHARE: 'yes' }, `require(${JSON.stringify(stagePath)});`);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /非法环境变量 ZX_TEMPLATE_SHARE/);

    // 2. 对比 ZX_TEMPLATE_SHARE=1 与 0：均支持正文下载 template/AGENTS.md，导出单文件逐字节一致，且支持 CLI 模式
    const makeAndDump = [
      "const fs = require('fs');",
      "const path = require('path');",
      "const crypto = require('crypto');",
      `const stage = require(${JSON.stringify(stagePath)});`,
      'const root = stage.makeCourse("share-check", {',
      '  "lesson.html": \'<section id="s1"><h2>下载</h2><p><a href="template/AGENTS.md">写作约定</a></p></section>\'',
      '});',
      'const tplPath = path.join(root, "template");',
      'const rootReal = fs.realpathSync(root);',
      'const tplReal = fs.realpathSync(tplPath);',
      'const tplIsLink = fs.lstatSync(tplPath).isSymbolicLink();',
      'const exportPath = stage.PACKED ? path.join(root, "export", "测试课 share-check.html") : null;',
      'const exportSha = exportPath ? crypto.createHash("sha256").update(fs.readFileSync(exportPath)).digest("hex") : null;',
      '(async () => {',
      '  await stage.dispose();',
      '  console.log(JSON.stringify({ root, rootReal, tplReal, tplIsLink, exportSha, rootGone: !fs.existsSync(root) }));',
      '})();'
    ].join('\n');

    const metricsShared = path.join(tmpBase, 'm-shared.json');
    const resSharedPacked = runProbe(
      {
        ZX_FORM: 'packed',
        ZX_TEMPLATE_SHARE: '1',
        ZX_SHARED_TEMPLATE: shared.dir,
        ZX_METRICS_FILE: metricsShared
      },
      makeAndDump
    );
    assert.equal(resSharedPacked.status, 0, resSharedPacked.stderr);
    const sharedInfo = JSON.parse(resSharedPacked.stdout.trim());
    const mShared = JSON.parse(fs.readFileSync(metricsShared, 'utf8'));
    assert.equal(mShared.templateLinkCalls + mShared.templateLinkFallbacks, 1);
    if (mShared.templateLinkCalls === 1) {
      assert.equal(mShared.templateLinkFallbacks, 0);
      assert.equal(sharedInfo.tplIsLink, true);
      assert.equal(sharedInfo.tplReal, fs.realpathSync(shared.dir));
    } else {
      assert.equal(mShared.templateLinkCalls, 0);
      assert.equal(mShared.templateLinkFallbacks, 1);
      assert.equal(sharedInfo.tplIsLink, false);
      assert.equal(sharedInfo.tplReal, path.join(sharedInfo.rootReal, 'template'));
    }
    assert.notEqual(sharedInfo.tplReal, fs.realpathSync(path.join(stage.REPO, 'template')));
    assert.equal(sharedInfo.rootGone, true);

    const resCopyPacked = runProbe({ ZX_FORM: 'packed', ZX_TEMPLATE_SHARE: '0' }, makeAndDump);
    assert.equal(resCopyPacked.status, 0, resCopyPacked.stderr);
    const copyInfo = JSON.parse(resCopyPacked.stdout.trim());
    assert.equal(sharedInfo.exportSha, copyInfo.exportSha, '共享模板与实体复制导出的单文件必须逐字节一致');

    // CLI 路径在共享模板下两形态均可正常 build/pack
    for (const form of ['folder', 'packed']) {
      const resCli = runProbe(
        {
          ZX_FORM: form,
          ZX_STAGE_MODE: 'cli',
          ZX_TEMPLATE_SHARE: '1',
          ZX_SHARED_TEMPLATE: shared.dir
        },
        makeAndDump
      );
      assert.equal(resCli.status, 0, `${form} CLI 失败：${resCli.stderr}`);
      if (form === 'packed') {
        assert.equal(JSON.parse(resCli.stdout.trim()).exportSha, copyInfo.exportSha);
      }
    }

    // 销毁所有夹具后，共享临时模板整棵树哈希保持完全一致
    assert.equal(hashTree(shared.dir), beforeTreeHash, '销毁带联接的夹具后，共享临时模板不能有文件变化');

    // 3. symlinkSync 返回 EPERM 时自动回退实体复制并记录回退次数
    const metricsEperm = path.join(tmpBase, 'm-eperm.json');
    const epermScript = [
      "const fs = require('fs');",
      "const path = require('path');",
      'fs.symlinkSync = () => { const e = new Error("blocked"); e.code = "EPERM"; throw e; };',
      `const stage = require(${JSON.stringify(stagePath)});`,
      'const root = stage.makeCourse("eperm-fallback", {',
      '  "lesson.html": \'<section id="s1"><h2>回退</h2><p>正文。</p></section>\'',
      '});',
      'const isLink = fs.lstatSync(path.join(root, "template")).isSymbolicLink();',
      '(async () => { await stage.dispose(); console.log(JSON.stringify({ ok: true, isLink, gone: !fs.existsSync(root) })); })();'
    ].join('\n');
    const resEperm = runProbe(
      {
        ZX_FORM: 'folder',
        ZX_TEMPLATE_SHARE: '1',
        ZX_SHARED_TEMPLATE: shared.dir,
        ZX_METRICS_FILE: metricsEperm
      },
      epermScript
    );
    assert.equal(resEperm.status, 0, resEperm.stderr);
    const epermInfo = JSON.parse(resEperm.stdout.trim());
    assert.equal(epermInfo.isLink, false);
    assert.equal(epermInfo.gone, true);
    const mEperm = JSON.parse(fs.readFileSync(metricsEperm, 'utf8'));
    assert.equal(mEperm.templateLinkFallbacks, 1);
    assert.equal(mEperm.templateLinkCalls, 0);
    assert.equal(hashTree(shared.dir), beforeTreeHash, 'EPERM 回退销毁后共享临时模板仍保持完整');
  } finally {
    shared.cleanup();
    fs.rmSync(tmpBase, { recursive: true, force: true, maxRetries: 5 });
  }
});
