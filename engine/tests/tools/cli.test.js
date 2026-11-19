'use strict';
/* 命令行：用法与退出码，以及 check、build、new、outline、pack、init 各自的行为。
 * look 要启动浏览器，放在端到端验收里（engine/tests/e2e/tools.e2e.js）。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const { lib, pad, fragmentPage, lessonPage, section, courseSource, tempDir, makeCourse, runCli } = require('./helpers');
const { lines, code } = require('./rule-cases');

const { TEMPLATE_DIR, readText } = lib('files');
const GOOD = fragmentPage('<p>正文。</p>');
const BAD = fragmentPage(lines('<p>当 a < b 时，研发 R&D。</p>', '<p class="unknown-class">文字</p>'));
const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');

/** 执行一份清单的源码，返回 window.ZHIXU_COURSE 的纯数据副本。 */
function runCourse(source) {
  const window = Object.create(null);
  vm.runInNewContext(source, { window });
  return JSON.parse(JSON.stringify(window.ZHIXU_COURSE));
}

/** 目录里每个文件的指纹（相对路径 → 内容的哈希），skip 是不看的顶层目录。 */
function fingerprint(root, skip = []) {
  const found = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      const relative = path.relative(root, file).split(path.sep).join('/');
      if (skip.includes(relative)) continue;
      if (entry.isDirectory()) walk(file);
      else found[relative] = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
    }
  };
  walk(root);
  return found;
}

test('没有命令或 help：打印用法，状态码 0', () => {
  for (const args of [[], ['help']]) {
    const { status, stdout } = runCli(tempDir(), ...args);
    assert.equal(status, 0);
    for (const command of [
      'build [讲...]',
      'check [--json]',
      'look [讲...] [--shots]',
      'outline',
      'new <名> "<标题>" [--unit N]',
      'pack',
      'preview [--port N]',
      'init <目录> "<标题>" [--id ID]'
    ]) {
      assert.ok(stdout.includes(`${pad(2)}${command}`), command);
    }
    assert.doesNotMatch(stdout, /\bfix\b/);
  }
});

test('不认识的命令或参数：状态码 2，用法写到标准错误', () => {
  const root = makeCourse({ 'lesson.html': GOOD });
  const wrong = [
    ['frobnicate'],
    ['fix'],
    ['check', '--bogus'],
    ['outline', 'extra'],
    ['pack', 'extra'],
    ['new', 'only-stem'],
    ['new', 'a-lesson', '标题', '--unit'],
    ['new', 'a-lesson', '标题', '--unit', '0'],
    ['new', 'a-lesson', '标题', '--unit', '二'],
    ['preview', '--port', 'abc'],
    ['preview', '--port'],
    ['init', 'only-dir'],
    ['init', 'dir', '标题', '--id'],
    ['init', 'dir', '标题', '--name', 'x']
  ];
  for (const args of wrong) {
    const { status, stdout, stderr } = runCli(root, ...args);
    assert.equal(status, 2, args.join(' '));
    assert.equal(stdout, '');
    assert.match(stderr, /用法/);
  }
  assert.deepEqual(fs.readdirSync(root).sort(), ['course', 'lesson.html'], '用法不对时什么也不创建');
});

test('build 和 look 后面写了不存在的讲义：状态码 2，说明找不到哪个文件', () => {
  const root = makeCourse({ 'lesson.html': GOOD });
  for (const args of [
    ['build', 'nothing'],
    ['build', 'lesson', 'nothing.html'],
    ['look', 'nothing'],
    ['look', '--bogus']
  ]) {
    const { status, stderr } = runCli(root, ...args);
    assert.equal(status, 2, args.join(' '));
    assert.match(stderr, /找不到讲义/);
  }
});

test('不在课程根目录：状态码 2', () => {
  for (const args of [
    ['build'],
    ['check'],
    ['look'],
    ['outline'],
    ['pack'],
    ['new', 'a-lesson', '标题'],
    ['preview']
  ]) {
    const { status, stderr } = runCli(tempDir(), ...args);
    assert.equal(status, 2, args.join(' '));
    assert.match(stderr, /course\/course\.js/);
  }
});

test('check：通过时状态码 0，并且不写任何文件', () => {
  const root = makeCourse({ 'lesson.html': GOOD });
  const { status, stdout } = runCli(root, 'check');
  assert.equal(status, 0);
  assert.equal(stdout, '✓ 检查通过（1 讲，0 个 warning）\n');
  assert.deepEqual(fs.readdirSync(root).sort(), ['course', 'lesson.html']);
  assert.deepEqual(fs.readdirSync(path.join(root, 'course')), ['course.js']);
});

test('check：只有 warning 时状态码仍是 0', () => {
  const root = makeCourse({ 'lesson.html': fragmentPage('<p class="unknown-class">文字</p>') });
  const { status, stdout } = runCli(root, 'check');
  assert.equal(status, 0);
  assert.ok(stdout.endsWith('✓ 检查通过（1 讲，1 个 warning）\n'));
});

test('check：有 error 时状态码 1，报告按文件分组、每行一个问题', () => {
  const root = makeCourse({ 'lesson.html': BAD });
  const { status, stdout } = runCli(root, 'check');
  assert.equal(status, 1);
  assert.deepEqual(stdout.split('\n'), [
    'lesson.html',
    `${pad(2)}16:8${pad(3)}error${pad(4)}html/lt${pad(8)}< 没有构成标签；作为文字时要写成 &lt;`,
    `${pad(2)}16:18${pad(2)}error${pad(4)}html/amp${pad(7)}& 没有构成可用的字符引用：& 本身要写成 &amp;；不常见的命名引用请直接写出字符，或改用 &#x…; 的形式`,
    `${pad(2)}17:4${pad(3)}warning${pad(2)}class/unknown${pad(2)}契约里没有 unknown-class 这个类名；不要自创类名`,
    '',
    '✗ 2 个 error，1 个 warning（1 讲）',
    ''
  ]);
});

test('check --json：输出一个 JSON 对象', () => {
  const root = makeCourse({ 'lesson.html': BAD });
  const { status, stdout } = runCli(root, 'check', '--json');
  const result = JSON.parse(stdout);
  assert.equal(status, 1);
  assert.deepEqual(Object.keys(result), ['ok', 'errors', 'warnings', 'lessons', 'problems', 'notes']);
  assert.deepEqual([result.ok, result.errors, result.warnings, result.lessons], [false, 2, 1, 1]);
  assert.deepEqual(result.problems[0], {
    file: 'lesson.html',
    line: 16,
    col: 8,
    level: 'error',
    rule: 'html/lt',
    message: '< 没有构成标签；作为文字时要写成 &lt;'
  });
  const passing = runCli(makeCourse({ 'lesson.html': GOOD }), 'check', '--json');
  assert.equal(passing.status, 0);
  assert.deepEqual(JSON.parse(passing.stdout), {
    ok: true,
    errors: 0,
    warnings: 0,
    lessons: 1,
    problems: [],
    notes: []
  });
});

test('check：代码里没转义的 < 只报一条，并且不改文件', () => {
  const page = fragmentPage(code('cpp', ['std::vector<int> v;', 'if (a < b && c) return;']));
  const root = makeCourse({ 'lesson.html': page });
  const { status, stdout } = runCli(root, 'check');
  assert.equal(status, 1);
  assert.match(stdout, /16:39\s+error\s+code\/unescaped\s+代码或公式里有 4 处/);
  assert.ok(stdout.endsWith('✗ 1 个 error，0 个 warning（1 讲）\n'));
  assert.equal(read(root, 'lesson.html'), page);
});

test('build：生成两个文件；有 error 时照样生成，状态码 1', () => {
  const good = makeCourse({ 'lesson.html': GOOD });
  const passed = runCli(good, 'build');
  assert.equal(passed.status, 0);
  assert.equal(passed.stdout, '已生成 index.html、course/data.js\n\n✓ 检查通过（1 讲，0 个 warning）\n');
  assert.match(read(good, 'index.html'), /<a href="lesson\.html">测试讲<\/a>/);
  assert.match(read(good, 'course/data.js'), /^window\.ZHIXU_DATA = \{/);

  const bad = makeCourse({ 'lesson.html': BAD });
  const failed = runCli(bad, 'build');
  assert.equal(failed.status, 1);
  assert.ok(failed.stdout.endsWith('✗ 2 个 error，1 个 warning（1 讲）\n'));
  assert.ok(fs.existsSync(path.join(bad, 'index.html')) && fs.existsSync(path.join(bad, 'course', 'data.js')));
});

test('build：自动转义代码和公式里的 < 和 &，说明改了几处；别的不动', () => {
  const page = fragmentPage(lines('<div>', `${pad(5)}${code('cpp', ['std::vector<int> v;'])}`, '</div>'));
  const root = makeCourse({ 'lesson.html': page });
  const built = runCli(root, 'build');
  assert.equal(built.status, 0);
  assert.equal(
    built.stdout,
    '已自动转义代码和公式里的 < 和 &：lesson.html 1 处\n已生成 index.html、course/data.js\n\n✓ 检查通过（1 讲，0 个 warning）\n'
  );
  assert.equal(read(root, 'lesson.html'), page.replace('vector<int>', 'vector&lt;int>'), '只改了那一个字符，缩进原样');
  const again = runCli(root, 'build');
  assert.equal(again.stdout, '已生成 index.html、course/data.js\n\n✓ 检查通过（1 讲，0 个 warning）\n');

  const unfixable = runCli(makeCourse({ 'lesson.html': fragmentPage('<p>没有闭合') }), 'build');
  assert.equal(unfixable.status, 1);
  assert.match(unfixable.stdout, /html\/unclosed/);
});

test('build 后面写上讲义名：只报告这几讲的问题，别处有问题时提一句；状态码看整门课', () => {
  const root = makeCourse({
    'a.html': GOOD,
    'b.html': fragmentPage('<p class="unknown-class">文字</p>'),
    'c.html': BAD
  });
  const focused = runCli(root, 'build', 'a', 'b.html');
  assert.equal(focused.status, 1, '别的讲还有 error');
  assert.match(focused.stdout, /b\.html\n.*class\/unknown/);
  assert.doesNotMatch(focused.stdout, /c\.html|html\/lt/);
  assert.match(focused.stdout, /其他文件里还有 3 个问题；不带讲义名运行 build 可以看到全部/);
  assert.ok(focused.stdout.endsWith('✓ 检查通过（2 讲，1 个 warning）\n'));

  const whole = runCli(root, 'build');
  assert.match(whole.stdout, /c\.html/);
  assert.ok(whole.stdout.endsWith('✗ 2 个 error，2 个 warning（3 讲）\n'));
});

const RICH_COURSE = {
  id: 'test',
  title: '测试课程',
  subtitle: '副标题',
  description: '课程简介：见 https://example.com/a',
  author: '作者',
  units: [
    { title: '第一单元', description: '单元简介', lessons: ['lesson.html'] },
    { title: '第二单元', lessons: ['other.html'] }
  ]
};

test('new：新建一讲并登记到清单，默认登记到最后一个单元；清单里的其他内容原样保留', () => {
  const root = makeCourse({ 'course/course.js': courseSource(RICH_COURSE), 'lesson.html': GOOD, 'other.html': GOOD });
  const { status, stdout } = runCli(root, 'new', '05-sorting', '排序 & <比较>');
  assert.equal(status, 0);
  assert.match(stdout, /已创建 05-sorting\.html，并登记到 course\/course\.js（单元“第二单元”）/);
  const created = read(root, '05-sorting.html');
  assert.ok(created.includes('<title>排序 &amp; &lt;比较></title>'));
  assert.ok(created.includes('<h1>排序 &amp; &lt;比较></h1>'));
  assert.ok(!created.includes('\r'));

  const expected = structuredClone(RICH_COURSE);
  expected.units[1].lessons.push('05-sorting.html');
  const rewritten = read(root, 'course/course.js');
  assert.deepEqual(runCourse(rewritten), expected);
  assert.match(
    rewritten,
    /^window\.ZHIXU_COURSE = \{\n {2}id: "test",\n {2}title: "测试课程",/,
    '按规范格式重写：键名不带引号'
  );
  assert.equal(runCli(root, 'check').stdout, '✓ 检查通过（3 讲，0 个 warning）\n');

  assert.equal(runCli(root, 'new', '00-intro', '引子', '--unit', '1').status, 0);
  const second = runCourse(read(root, 'course/course.js'));
  assert.deepEqual(second.units[0].lessons, ['lesson.html', '00-intro.html']);
});

test('new：不覆盖已有文件，拒绝不合规的文件名、不存在的单元和改不了的清单；这时什么也不创建', () => {
  const root = makeCourse({ 'lesson.html': GOOD });
  const before = fingerprint(root);
  const existing = runCli(root, 'new', 'lesson', '标题');
  assert.equal(existing.status, 2);
  assert.match(existing.stderr, /已经存在/);
  for (const stem of ['Bad_Name', 'index', '../escape', '带中文', 'a.html']) {
    const { status, stderr } = runCli(root, 'new', stem, '标题');
    assert.equal(status, 2, stem);
    assert.match(stderr, /不可用/);
  }
  const noUnit = runCli(root, 'new', 'b-lesson', '标题', '--unit', '3');
  assert.equal(noUnit.status, 2);
  assert.match(noUnit.stderr, /没有第 3 个单元：这门课有 1 个单元/);
  assert.deepEqual(fingerprint(root), before);

  const commented = makeCourse({
    'course/course.js': `// 我的课\n${courseSource({ id: 'test', title: '测试课程', units: [{ lessons: ['lesson.html'] }] })}`,
    'lesson.html': GOOD
  });
  const refused = runCli(commented, 'new', 'b-lesson', '标题');
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /course\/course\.js 有问题.*注释/);
  assert.equal(fs.existsSync(path.join(commented, 'b-lesson.html')), false);
});

test('A04 new：登记时清单写不进去，就把这一趟留下的收回去；修好权限重跑同一条命令就能成功', () => {
  const root = makeCourse({ 'lesson.html': GOOD });
  const listFile = path.join(root, 'course', 'course.js');
  const before = fingerprint(root);

  // 让清单写不进去：Windows 上用只读属性，其它系统上去掉写权限
  const real = fs.statSync(listFile).mode;
  try {
    fs.chmodSync(listFile, 0o444);
    const failed = runCli(root, 'new', '02-new', '新的一讲');
    assert.equal(failed.status, 2, '写不进去时是用法/环境问题：状态码 2');
    assert.match(failed.stderr, /没能登记 02-new\.html/);
    assert.match(failed.stderr, /course\/course\.js/);
    assert.match(failed.stderr, /重跑同一条命令/, '告诉作者不用手工收拾');
    assert.equal(fs.existsSync(path.join(root, '02-new.html')), false, '新生成的页面收回了');
    assert.deepEqual(fingerprint(root), before, '清单和别的文件一个字节都没动');
  } finally {
    fs.chmodSync(listFile, real);
  }

  const again = runCli(root, 'new', '02-new', '新的一讲');
  assert.equal(again.status, 0, '能写之后不必手工清理，直接重跑就行');
  const rewritten = runCourse(read(root, 'course/course.js'));
  assert.deepEqual(rewritten.units[0].lessons, ['lesson.html', '02-new.html']);
  assert.equal(runCli(root, 'check').status, 0);
});

test('outline：一眼看到各讲的字数与时长、小节、可以引用的编号和术语', () => {
  const first = lessonPage(
    lines(
      section(
        lines(
          '<p><dfn data-def="解决一类问题的明确步骤。">算法</dfn>无处不在。</p>',
          '<figure id="fig-flow"><svg viewBox="0 0 10 10" role="img" aria-label="流程"></svg><figcaption>流程</figcaption></figure>'
        ),
        'what'
      ),
      section('<p>第二节。</p>', 'steps')
    )
  );
  const root = makeCourse({
    'course/course.js': courseSource({
      id: 'algo',
      title: '算法入门',
      units: [
        { title: '基础', lessons: ['01-first.html'] },
        { title: '进阶', lessons: ['02-second.html', 'missing.html'] }
      ]
    }),
    '01-first.html': first,
    '02-second.html': GOOD
  });
  const { status, stdout } = runCli(root, 'outline');
  assert.equal(status, 0);
  assert.deepEqual(stdout.trimEnd().split('\n'), [
    '算法入门（标识 algo）：2 讲，约 2 分钟',
    '引用别的讲：<a href="文件名#id"></a>，文字留空会自动填上“第 N 讲”“2.1 节”“图 2-1”；已定义的术语直接写 <dfn>术语</dfn>。',
    '字数是正文里的汉字加西文单词，代码和公式不算。',
    '',
    '基础',
    // 标题 3 字、两个小节标题各 2 字、“算法无处不在”6 字、图题 2 字、“第二节”3 字；属性里的文字不算
    `${pad(2)}第 1 讲  01-first.html  测试讲（约 1 分钟，正文 18 字）`,
    `${pad(4)}1.1  #what  小节`,
    `${pad(4)}1.2  #steps  小节`,
    `${pad(4)}可引用：图 1-1 #fig-flow`,
    `${pad(4)}术语：算法`,
    '',
    '进阶',
    `${pad(2)}第 2 讲  02-second.html  测试讲（约 1 分钟，正文 7 字）`,
    `${pad(4)}2.1  #part  小节`,
    `${pad(2)}missing.html（文件不存在）`
  ]);
  assert.deepEqual(fs.readdirSync(root).sort(), ['01-first.html', '02-second.html', 'course'], 'outline 不写任何文件');
});

test('pack：导出一个 HTML 到 export/，课程里别的文件一个字节都不动', () => {
  const page = fragmentPage(
    lines(
      '<p>正文，带一张图和一个可以下载的文件：<a href="files/data.csv">数据</a>。</p>',
      '<figure><img src="images/dot.png" alt="一个点"></figure>'
    )
  );
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  );
  const root = makeCourse({
    'course/course.js': courseSource({ id: 'test', title: '测试: 课程/一', units: [{ lessons: ['lesson.html'] }] }),
    'lesson.html': page
  });
  fs.mkdirSync(path.join(root, 'images'));
  fs.mkdirSync(path.join(root, 'files'));
  fs.writeFileSync(path.join(root, 'images', 'dot.png'), png);
  fs.writeFileSync(path.join(root, 'files', 'data.csv'), 'a,b\n1,2\n');
  const before = fingerprint(root);

  const { status, stdout } = runCli(root, 'pack');
  assert.equal(status, 0, stdout);
  assert.match(stdout, /^已导出 export\/测试- 课程-一\.html（/, '标题里不能做文件名的字符换成了连字符');
  assert.deepEqual(fingerprint(root, ['export']), before, '没有 index.html、data.js，别的文件也没有变');
  assert.deepEqual(fs.readdirSync(path.join(root, 'export')), ['测试- 课程-一.html']);

  const html = read(root, 'export/测试- 课程-一.html');
  const packed = JSON.parse(/<script type="application\/json" id="zx-pack">(.*)<\/script>/.exec(html)[1]);
  assert.deepEqual(Object.keys(packed.pages), ['index.html', 'lesson.html']);
  assert.equal(packed.pages['lesson.html'].title, '测试讲');
  assert.ok(
    packed.pages['lesson.html'].body.startsWith('<main>') && packed.pages['lesson.html'].body.endsWith('</main>')
  );
  assert.ok(packed.pages['lesson.html'].body.includes(`src="data:image/png;base64,${png.toString('base64')}"`));
  assert.match(
    packed.pages['lesson.html'].body,
    /href="data:text\/csv; charset=utf-8;base64,[A-Za-z0-9+/=]+" download="data\.csv"/
  );
  assert.deepEqual(Object.keys(packed.files).sort(), ['../course/course.js', '../course/data.js', 'app.js']);
  assert.match(html, /<script data-packed>/);
  assert.doesNotMatch(html, /url\(['"]?fonts\//, '字体都嵌进来了');
  const notices = /<!-- zx-licenses\n([\s\S]+?)\n-->/.exec(html)[1];
  for (const name of [
    'LICENSE',
    'LICENSE-MDI.txt',
    'fonts/OFL-NotoSerifSC.txt',
    'fonts/OFL-LXGWWenKai.txt',
    'fonts/OFL-JetBrainsMono.txt'
  ]) {
    assert.ok(notices.includes(readText(path.join(TEMPLATE_DIR, name)).trimEnd()), name);
  }
  assert.doesNotMatch(notices, /\[template\/vendor\//);
});

test('pack：内嵌公式和代码着色时，单文件也带上它们的完整许可', () => {
  const lesson = fragmentPage(lines('<p>公式 <span class="math">a+b</span>。</p>', code('python', ['print(1)'])));
  const root = makeCourse({ 'lesson.html': lesson });
  const { status, stdout } = runCli(root, 'pack');
  assert.equal(status, 0, stdout);
  const html = read(root, 'export/测试课程.html');
  const notices = /<!-- zx-licenses\n([\s\S]+?)\n-->/.exec(html)[1];
  for (const name of ['vendor/katex/LICENSE', 'fonts/OFL-KaTeX.txt', 'vendor/highlight/LICENSE']) {
    assert.ok(notices.includes(readText(path.join(TEMPLATE_DIR, name)).trimEnd()), name);
  }
});

test('pack：文件超过 20 MB 时提醒一句（单文件每翻一页都要整个重读），照样导出', () => {
  const root = makeCourse({
    'lesson.html': fragmentPage('<figure><video src="media/big.mp4" controls></video></figure>')
  });
  fs.mkdirSync(path.join(root, 'media'));
  fs.writeFileSync(path.join(root, 'media', 'big.mp4'), Buffer.alloc(16 * 1048576)); // 嵌进去有 21 MB
  const big = runCli(root, 'pack');
  assert.equal(big.status, 0, big.stdout);
  assert.match(big.stdout, /^已导出 export\/测试课程\.html（/m);
  assert.match(big.stdout, /^warning {2}文件超过 20 MB/m);

  const small = runCli(makeCourse({ 'lesson.html': GOOD }), 'pack');
  assert.equal(small.status, 0, small.stdout);
  assert.doesNotMatch(small.stdout, /warning/);
});

test('pack：有 error 时不导出，上一次导出的文件保持原样', () => {
  const root = makeCourse({ 'lesson.html': GOOD });
  assert.equal(runCli(root, 'pack').status, 0);
  const exported = fingerprint(root);

  fs.writeFileSync(path.join(root, 'lesson.html'), BAD);
  const before = fingerprint(root);
  const failed = runCli(root, 'pack');
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /html\/lt/);
  assert.match(failed.stdout, /有 error，没有导出；上一次导出的文件没有动/);
  assert.deepEqual(fingerprint(root), before);
  assert.equal(before['export/测试课程.html'], exported['export/测试课程.html']);
});

test('pack：代码里没转义的 < 不由它来改；先 build，再导出', () => {
  const page = fragmentPage(code('cpp', ['std::vector<int> v;']));
  const root = makeCourse({ 'lesson.html': page });
  const failed = runCli(root, 'pack');
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /code\/unescaped/);
  assert.equal(read(root, 'lesson.html'), page);
  assert.equal(fs.existsSync(path.join(root, 'export')), false);
});

test('init：新建的课程自带引擎，用它自己的工具就能通过检查', () => {
  const target = path.join(tempDir(), 'My New Course');
  const { status, stdout } = runCli(tempDir(), 'init', target, '新的"课程"');
  assert.equal(status, 0);
  assert.match(stdout, /✓ 检查通过（1 讲，0 个 warning）/);
  assert.match(stdout, /已创建课程/);
  assert.match(stdout, /node template\/tools\/zx\.js preview/);
  const [, id] = /^课程标识：(my-new-course-[a-z0-9]{6})（/m.exec(stdout);
  assert.equal(
    read(target, 'course/course.js'),
    [
      'window.ZHIXU_COURSE = {',
      `${pad(2)}id: "${id}",`,
      `${pad(2)}title: "新的\\"课程\\"",`,
      `${pad(2)}units: [`,
      `${pad(4)}{`,
      `${pad(6)}lessons: [`,
      `${pad(8)}"01-first-lesson.html"`,
      `${pad(6)}]`,
      `${pad(4)}}`,
      `${pad(2)}]`,
      '};',
      ''
    ].join('\n')
  );
  for (const file of [
    '01-first-lesson.html',
    'index.html',
    'course/data.js',
    'template/AGENTS.md',
    'template/LICENSE',
    'template/LICENSE-MDI.txt',
    'template/lesson.html',
    'template/tools/lib/html.js',
    'template/vendor/katex/katex.min.js',
    'template/fonts/OFL-KaTeX.txt',
    'template/fonts/serif.ranges.txt'
  ]) {
    assert.ok(fs.existsSync(path.join(target, file)), file);
  }
  assert.match(read(target, '01-first-lesson.html'), /<h1>第一讲<\/h1>/);

  const own = spawnSync(process.execPath, [path.join(target, 'template', 'tools', 'zx.js'), 'check', '--json'], {
    cwd: target,
    encoding: 'utf8'
  });
  assert.equal(own.status, 0);
  assert.deepEqual(JSON.parse(own.stdout), { ok: true, errors: 0, warnings: 0, lessons: 1, problems: [], notes: [] });
});

test('init：目标目录非空时拒绝；空目录可以用', () => {
  const occupied = makeCourse({ 'lesson.html': GOOD });
  const refused = runCli(tempDir(), 'init', occupied, '课程');
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /不是空目录/);
  assert.equal(fs.existsSync(path.join(occupied, 'template')), false);

  const empty = path.join(tempDir(), '课程');
  fs.mkdirSync(empty);
  assert.equal(runCli(tempDir(), 'init', empty, '课程').status, 0);
});

const courseId = (root) => /id: "([^"]*)"/.exec(read(root, 'course/course.js'))[1];

test('B38 init：同名的中文目录各建一门课，两门课的标识不同', () => {
  const [first, second] = [tempDir(), tempDir()].map((parent) => path.join(parent, '数据结构'));
  for (const target of [first, second]) assert.equal(runCli(tempDir(), 'init', target, '数据结构').status, 0);
  assert.match(courseId(first), /^course-[a-z0-9]{6}$/);
  assert.match(courseId(second), /^course-[a-z0-9]{6}$/);
  assert.notEqual(courseId(first), courseId(second));
});

test('B38 init --id：用指定的标识；标识不合规时拒绝，什么也不创建', () => {
  const target = path.join(tempDir(), '课程');
  const made = runCli(tempDir(), 'init', target, '课程', '--id', 'ds-2026');
  assert.equal(made.status, 0);
  assert.match(made.stdout, /^课程标识：ds-2026（/m);
  assert.equal(courseId(target), 'ds-2026');

  const other = path.join(tempDir(), 'other');
  for (const id of ['数据结构', 'Has Space', '-leading', '']) {
    const refused = runCli(tempDir(), 'init', other, '课程', '--id', id);
    assert.equal(refused.status, 2, id);
    assert.match(refused.stderr, /课程标识 .* 不可用/);
  }
  assert.equal(fs.existsSync(other), false);
});
