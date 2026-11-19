'use strict';
/* 写作工具里要用到浏览器的两样：look（渲染体检）和 pack（单文件导出）。
 * look 用的是本机的 Chrome 或 Edge，和 ZX_ENGINE 无关，只在 Chromium 这一轮里跑一次；
 * pack 导出的文件要在三个内核里都能用。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  ENGINE,
  PACKED,
  REPO,
  course,
  freshCourse,
  makeCourse,
  scratch,
  installTemplate,
  zx,
  newContext
} = require('./harness');
const { courseSource, fragmentPage, lessonPage, section } = require('../tools/helpers');
const { checkup } = require(path.join(REPO, 'template', 'tools', 'lib', 'checkup.js'));

// 这个文件验收的是工具本身，和验收用哪种形态的课程无关：只在文件夹形态的那一轮里跑
const tools = { skip: PACKED && '工具本身的验收只在文件夹形态的那一轮里跑' };
const once = {
  skip: tools.skip || (ENGINE !== 'chromium' && 'look 用的是本机的浏览器，只在 Chromium 这一轮里跑一次')
};

test('look：示例课没有问题，状态码 0', once, () => {
  const { status, output } = zx(course('sample'), 'look', '02-binary-search');
  assert.equal(status, 0, output);
  assert.match(output, /02-binary-search\.html\n {2}1440 宽\s+没有问题\n {2}390 宽\s+没有问题\n {2}打印\s+没有问题/);
  assert.match(output, /✓ 渲染检查没有发现问题（1 页，用时 [\d.]+ 秒，浏览器 .+）/);
});

test('look：写作契约里的每段示例都排得出来，三种版面下没有看得见的问题', once, () => {
  const contract = fs.readFileSync(path.join(REPO, 'template', 'AGENTS.md'), 'utf8').replace(/\r\n/g, '\n');
  const examples = [...contract.matchAll(/^```html\n([\s\S]*?)\n```$/gm)].map((match) => match[1]);
  assert.ok(examples.length >= 15, `只找到 ${examples.length} 个示例`);
  // 每段示例一讲：整页的示例原样用，片段放进一个小节里。示例里链接到的别的讲，放两讲占位的
  const stub = (...ids) => lessonPage(ids.map((id) => section('<p>占位。</p>', id)).join('\n'));
  const files = Object.fromEntries(
    examples.map((html, index) => [
      `example-${String(index + 1).padStart(2, '0')}.html`,
      html.startsWith('<!doctype') ? `${html}\n` : fragmentPage(html)
    ])
  );
  files['02-binary-search.html'] = stub('idea');
  files['03-time-complexity.html'] = stub('intro', 'big-o');

  const root = scratch('contract');
  for (const [name, html] of Object.entries(files)) fs.writeFileSync(path.join(root, name), html);
  fs.mkdirSync(path.join(root, 'course'));
  const course = { id: 'contract', title: '契约里的示例', units: [{ lessons: Object.keys(files) }] };
  fs.writeFileSync(path.join(root, 'course', 'course.js'), courseSource(course));
  installTemplate(root);
  const built = zx(root, 'build');
  assert.match(built.output, /✓ 检查通过（\d+ 讲，0 个 warning）/, built.output);
  const looked = zx(root, 'look');
  assert.equal(looked.status, 0, looked.output);
  assert.match(looked.output, /✓ 渲染检查没有发现问题/);
});

const row = (cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
const FLAWED = [
  '<section id="part">',
  '<h2>小节</h2>',
  '<p>这一讲故意留了几处只有排出来才看得见的问题。</p>',
  '<figure>',
  '<svg viewBox="0 0 200 60" role="img" aria-label="文字出框和重叠的图">',
  '<text x="150" y="30">这段文字会伸出画面的右边</text>',
  '<text x="10" y="50">重叠的甲</text>',
  '<text x="14" y="52">重叠的乙</text>',
  '</svg>',
  '</figure>',
  '<figure><img src="images/broken.png" alt="一张坏掉的图"></figure>',
  '<table>',
  '<caption>打印时放不下的宽表</caption>',
  `<thead>${row(Array.from({ length: 14 }, (_, index) => `第 ${index + 1} 列的表头`)).replaceAll('td>', 'th>')}</thead>`,
  `<tbody>${row(Array.from({ length: 14 }, (_, index) => `内容 ${index + 1}`))}</tbody>`,
  '</table>',
  '</section>'
].join('\n');

test('look：排出来才看得见的问题逐条报出来，带改法；状态码 1；不改任何文件', once, () => {
  const PLACEHOLDER = '<section id="part">\n<h2>小节</h2>\n<p>占位。</p>\n</section>';
  const root = makeCourse('flawed', { 'lesson.html': PLACEHOLDER });
  const file = path.join(root, 'lesson.html');
  fs.mkdirSync(path.join(root, 'images'));
  fs.writeFileSync(path.join(root, 'images', 'broken.png'), 'not a png');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(PLACEHOLDER, FLAWED));
  assert.equal(zx(root, 'build').status, 0, '这些问题静态检查查不出来');
  // build 之后又改了讲义：目录数据就不是最新的了
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('<h2>小节</h2>', '<h2>改过名字的小节</h2>'));
  const before = fs.readFileSync(file, 'utf8') + fs.readFileSync(path.join(root, 'course', 'data.js'), 'utf8');

  const { status, output } = zx(root, 'look', 'lesson');
  assert.equal(status, 1, output);
  assert.match(output, /^data\/stale\s+.*course\/data\.js.*不是最新的/m);
  for (const rule of ['svg/text-out', 'svg/text-overlap', 'media/broken']) {
    assert.match(output, new RegExp(`1440 宽[\\s\\S]*${rule}[\\s\\S]*390 宽`), `${rule} 在 1440 宽下报出来`);
  }
  assert.match(
    output,
    /svg\/text-out\s+“改过名字的小节”一节：图里的文字“这段文字会伸出画面的右边”有 \d+ 像素伸出了画面/
  );
  assert.match(output, /svg\/text-overlap\s+.*“重叠的甲”和“重叠的乙”叠在了一起/);
  assert.match(output, /media\/broken\s+.*图片没有加载出来（images\/broken\.png）/);
  assert.match(output, /打印\s+\d+ 个问题\n(?: {4}.*\n)* {4}page\/overflow/, '打印的版心放不下那张宽表');
  assert.match(output, /\n改法：\n(?: {2}\S+\s+.+\n)+/);
  assert.match(output, / {2}svg\/text-out\s+把这段文字挪回画面里，或者把 viewBox 改大/);
  assert.match(output, /✗ 渲染检查发现 \d+ 个问题/);
  assert.equal(fs.readFileSync(file, 'utf8') + fs.readFileSync(path.join(root, 'course', 'data.js'), 'utf8'), before);
});

test('look --shots：截图写到系统临时目录，报告里列出路径', once, () => {
  const { status, output } = zx(course('sample'), 'look', '04-recursion', '--shots');
  assert.equal(status, 0, output);
  const files = [...output.matchAll(/^ {2}(\S.*\.jpg)$/gm)].map((match) => match[1]);
  assert.ok(files.length >= 2, `应当有两种宽度的截图：${files}`);
  for (const file of files) {
    assert.ok(file.startsWith(os.tmpdir()), '截图不进课程目录');
    assert.deepEqual([...fs.readFileSync(file).subarray(0, 2)], [0xff, 0xd8], 'JPEG');
  }
  fs.rmSync(path.dirname(files[0]), { recursive: true });
  assert.deepEqual(
    fs.readdirSync(course('sample')).filter((name) => /\.(jpg|png)$/.test(name)),
    []
  );
});

/** 导出一门课的单文件，返回它的地址。 */
function packed(root) {
  const { status, output } = zx(root, 'pack');
  assert.equal(status, 0, output);
  const [, file] = /^已导出 (export\/.+\.html)（/m.exec(output);
  return pathToFileURL(path.join(root, file)).href;
}

/** 打开单文件里的一页，等它启动完；页面的报错和发出的请求记在 page.errors、page.requests 里。 */
async function openPacked(context, url) {
  const page = await context.newPage();
  page.errors = [];
  page.requests = [];
  page.on('console', (message) => message.type() === 'error' && page.errors.push(message.text()));
  page.on('pageerror', (error) => page.errors.push(error.message));
  page.on('request', (request) => {
    if (!/^(data|blob):/.test(request.url())) page.requests.push(decodeURI(request.url().split('#')[0]));
  });
  await page.goto(url);
  await page.waitForSelector('html.zx-ready, html.zx-failed');
  return page;
}

/** 等单文件换到另一页并启动完。换页在页面里换（不重读文件，地址里也不留 #，见 packed.e2e.js）：问加载器现在是哪一页。 */
async function turned(page, action, file) {
  await action();
  await page.waitForFunction(
    (name) => ZHIXU.file === name && document.documentElement.classList.contains('zx-ready'),
    file
  );
}

test('pack：单文件在手机宽度下打开就是整门课：翻页、搜索、笔记都能用，不向外要任何文件', tools, async () => {
  const url = packed(freshCourse('sample'));
  const context = await newContext({ viewport: { width: 390, height: 844 } });
  const page = await openPacked(context, url);
  assert.equal(await page.locator('.zx-row').count(), 4, '首页列出四讲');
  assert.equal(await page.title(), '算法与问题求解');

  await turned(page, () => page.locator('.zx-row').first().click(), '01-what-is-an-algorithm.html');
  assert.equal(await page.title(), '算法是什么 - 算法与问题求解');
  await turned(page, () => page.keyboard.press(']'), '02-binary-search.html');
  const lesson = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      title: document.title,
      highlighted: document.querySelectorAll('.zx-code [class^="hljs-"]').length > 10,
      formulas: document.querySelectorAll('.katex').length > 3,
      fonts: [...document.fonts]
        .filter((face) => face.status === 'loaded')
        .map((face) => face.family.replace(/["']/g, '')),
      numbered: document.querySelector('figcaption[data-label]').dataset.label
    };
  });
  assert.equal(lesson.title, '二分查找 - 算法与问题求解');
  assert.ok(lesson.highlighted && lesson.formulas, '代码着了色，公式排了版');
  assert.ok(
    ['Zhixu Serif', 'Zhixu Mono', 'KaTeX_Main'].every((family) => lesson.fonts.includes(family)),
    `字体：${lesson.fonts}`
  );
  assert.equal(lesson.numbered, '图 2-1');
  assert.deepEqual(await page.evaluate(`(${checkup})()`), [], '手机宽度下版面没有问题');

  // 本页的目录链接：不重新载入，滚到那一节
  await page.getByRole('button', { name: '目录' }).click();
  await page.locator('.zx-dialog--drawer [data-section="binary-code"]').click();
  await page.waitForFunction(() => ZHIXU.file === '02-binary-search.html' && ZHIXU.anchor() === 'binary-code');
  await page.waitForFunction(() => {
    const top = document.getElementById('binary-code').getBoundingClientRect().top;
    return top >= 0 && top < 200;
  });

  // 搜索别的讲里的词：换页，落到命中处
  await page.keyboard.press('/');
  await page.locator('.zx-dialog--search input').fill('递归');
  await page.locator('.zx-result').first().waitFor();
  const target = await page.locator('.zx-result').first().getAttribute('href');
  await turned(page, () => page.keyboard.press('Enter'), target.slice(1).split('/')[0]);
  assert.ok(await page.evaluate(() => CSS.highlights.has('zx-find')), '搜索的词在新的一页被标了出来');

  // 笔记写在这一页，翻走再回来还在
  await page.getByRole('button', { name: '本讲笔记' }).click();
  await page.locator('textarea.zx-notes').pressSequentially('单文件里记的笔记');
  await page.keyboard.press('Escape');
  const here = await page.evaluate(() => ZHIXU.file);
  await turned(page, () => page.locator('.zx-brand').click(), 'index.html');
  await turned(page, () => page.goBack(), here);
  await page.getByRole('button', { name: '本讲笔记' }).click();
  assert.equal(await page.locator('textarea.zx-notes').inputValue(), '单文件里记的笔记');

  // 封面上的错题入口：点它不重新载入，滚到“错题回顾”那一栏
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const key = `zhixu:course:${window.ZHIXU_COURSE.id}`;
    const data = JSON.parse(localStorage.getItem(key));
    const [
      file,
      {
        quizKeys: [quiz]
      }
    ] = Object.entries(window.ZHIXU_DATA.lessons).find(([, entry]) => entry.quizzes);
    data.quiz = { [file]: { [quiz]: { ok: false, at: '2026-11-16', stem: '一道答错的题', id: 'none' } } };
    localStorage.setItem(key, JSON.stringify(data));
  });
  await turned(page, () => page.locator('.zx-brand').click(), 'index.html');
  await page.evaluate(() => (window.__same = true));
  await page.locator('.zx-cover-review').click();
  await page.waitForFunction(() => {
    const top = document.getElementById('zx-review').getBoundingClientRect().top;
    return top >= 0 && top < 300;
  });
  assert.equal(await page.evaluate(() => window.__same), true, '点错题入口没有重新载入');

  // 有的内核不把打开本地文件算作一次请求，所以只看“除了它自己还要过什么”
  const others = [...new Set(page.requests)].filter((request) => request !== decodeURI(url));
  assert.deepEqual(others, [], '除了它自己，没有向外要任何文件');
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('pack：图片、讲义之间的链接、带锚点的链接在单文件里照样能用', tools, async () => {
  const url = packed(freshCourse('edge'));
  const context = await newContext();
  const page = await openPacked(context, `${url}#01-edge.html`);
  const images = await page.evaluate(() =>
    [...document.querySelectorAll('main img')].map((image) => [
      image.src.slice(0, 22),
      image.complete && image.naturalWidth > 0
    ])
  );
  assert.deepEqual(images, [
    ['data:image/png;base64,', true],
    ['data:image/png;base64,', true]
  ]);

  const link = page.locator('main a[href="#02-more.html/anchors"]').first();
  assert.equal(await link.textContent(), '2.1 节', '留空的跨讲链接照样填上了编号');
  await turned(page, () => link.click(), '02-more.html');
  await page.waitForFunction(() => {
    const top = document.getElementById('anchors').getBoundingClientRect().top;
    return top >= 0 && top < 200;
  });
  assert.equal(await page.locator('main').getAttribute('id'), 'page-top', '作者写在 <main> 上的 id 还在');

  // 地址里写的不是这门课的页面：回首页，而不是白屏
  const lost = await openPacked(context, `${url}#no-such-page.html`);
  assert.ok((await lost.locator('.zx-row').count()) > 0);
  assert.deepEqual([...page.errors, ...lost.errors], []);
  await context.close();
});

test('pack：音频嵌在单文件里，不向外要任何文件', tools, async () => {
  const url = packed(freshCourse('matrix'));
  const context = await newContext();
  const page = await openPacked(context, `${url}#05-inline-refs.html`);
  assert.equal(
    await page.locator('#fig-audio audio').evaluate((audio) => audio.src.slice(0, 22)),
    'data:audio/wav;base64,'
  );
  const others = [...new Set(page.requests)].filter((request) => request !== decodeURI(url));
  assert.deepEqual(others, []);
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('pack：关掉脚本也能从头读到尾：全部讲义的正文按顺序排开，图片和音视频换成一句说明', tools, async () => {
  const url = packed(freshCourse('edge'));
  const context = await newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(url);
  const found = await page.evaluate(() => {
    const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible';
    return {
      titles: [...document.querySelectorAll('main h1')].filter(shown).map((heading) => heading.textContent),
      sections: [...document.querySelectorAll('main article > section')].filter(shown).length,
      images: document.querySelectorAll('main img, main audio, main video').length,
      placeholders: (document.querySelector('main').textContent.match(/（图：[^）]+）/g) ?? []).length,
      drawings: [...document.querySelectorAll('main svg')].filter(shown).length,
      overflowing: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      scripted: document.documentElement.classList.contains('zx-js')
    };
  });
  await context.close();
  assert.equal(found.scripted, false, '脚本确实没有运行');
  assert.deepEqual(
    found.titles,
    ['边界压测', '边界情况：把每个组件都推到极限，看看版面会在哪里先出问题', '更多边界情况', 'HTTP 基础'],
    '课程名，然后每一讲'
  );
  assert.ok(found.sections >= 6, `各讲的小节都排开了（${found.sections} 个）`);
  assert.deepEqual([found.images, found.placeholders], [0, 2], '两张位图换成了“（图：说明）”');
  assert.ok(found.drawings > 0, '内联的 SVG 照常显示');
  assert.equal(found.overflowing, false, '手机宽度下不横向溢出');
});
