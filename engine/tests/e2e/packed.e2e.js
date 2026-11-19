'use strict';
/* 单文件（zx pack 导出的那一份）在手机上的用法：换页、搜索、后退、恢复备份都在页面里做完。
 * 原安卓设备从文件管理器打开时，携带讲次片段重新载入会报 ERR_FILE_NOT_FOUND。三个内核分别验换页不重读文件。
 * 在页面里换页，最容易错的是上一页的东西没收干净、这一页的东西没挂上，所以还要验：换页换到的一页，
 * 和直接打开的同一页一模一样；这一页的监听都在；来回换很多次，页面上的东西不越积越多。
 * 文件夹形态没有这件事，除了 A01 都跳过。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { PACKED, course, lessonFiles, makeCourse, newContext, open, arrived, fileUrl } = require('./harness');

const packedOnly = { skip: !PACKED && '这一条只对单文件有意义' };
const WIDE = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 } };

/** 等原生历史导航和页面排版都处理完，再量视口。 */
const viewportY = (page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(scrollY))))
  );

/** 暂停公式渲染，使浏览器可以在目的讲义就绪前连续导航。 */
const pauseMath = (page) =>
  page.evaluate(() => {
    const need = ZHIXU.need;
    const gate = new Promise((resolve) => {
      window.releaseMath = resolve;
    });
    ZHIXU.need = (feature) => {
      const loaded = need(feature);
      if (feature !== 'math') return loaded;
      window.waitingOnMath = true;
      return Promise.all([loaded, gate]);
    };
  });

/**
 * 打开一页，同时数“文档读了几次”：每一次整个文档载入完，这里就多一条（换页如果重读文件，就会多一条）。
 * 监听要在导航之前挂上，否则首页那一次就漏了。
 * 不用请求的类型来判断：三个内核给顶层文档的 resourceType 不一样，有的干脆不报。
 */
async function openWatched(context, root, file, suffix = '') {
  const page = await context.newPage();
  const loads = [];
  page.errors = [];
  // Firefox 在导航之前会对空白页触发一次 load：那次不算读了课程文件
  page.on('load', () => {
    if (!page.url().startsWith('about:')) loads.push(page.url());
  });
  page.on('console', (message) => message.type() === 'error' && page.errors.push(message.text()));
  page.on('pageerror', (error) => page.errors.push(error.message));
  await page.goto(fileUrl(root, file, suffix));
  await page.waitForSelector('html.zx-ready, html.zx-failed', { timeout: 15000 });
  return { page, loads };
}

/** 在页面里换到 file 这一页，等它启动完。 */
async function goTo(page, file) {
  await page.evaluate((name) => ZHIXU.go(name), file);
  await arrived(page, file);
}

test('A00 单文件：首页进第一讲、下一讲、回目录、从目录再进，全程只读一次文件', packedOnly, async () => {
  const root = course('sample');
  const files = lessonFiles(root);
  const context = await newContext();
  const { page, loads: documents } = await openWatched(context, root, 'index.html');
  assert.equal(documents.length, 1, '首页只读了一次');

  await page.locator(`.zx-row[href*="${files[0]}"]`).click();
  await arrived(page, files[0]);
  assert.equal(await page.locator('main h1').textContent(), '算法，是把问题想清楚', '进了第一讲，正文换过来了');

  await page.keyboard.press(']');
  await arrived(page, files[1]);
  await page.keyboard.press(']');
  await arrived(page, files[2]);
  await page.keyboard.press('[');
  await arrived(page, files[1]);

  await page.locator('.zx-brand').click();
  await arrived(page, 'index.html');
  await page.locator(`.zx-row[href*="${files[3]}"]`).click();
  await arrived(page, files[3]);

  assert.equal(documents.length, 1, `换页一次也没有再读文件：${documents.join(' ')}`);
  assert.deepEqual(page.errors, []);
  await context.close();
});

test(
  'A00 单文件：地址里不留 #——换页、页内锚点之后地址都是文件本身；刷新（手机上下拉刷新、切回来时浏览器自己重新载入）之后还在同一页同一处',
  packedOnly,
  async () => {
    // 原安卓设备从文件管理器打开时，无片段文件地址可正常刷新。
    const root = course('sample');
    const files = lessonFiles(root);
    const context = await newContext(WIDE);
    const { page, loads } = await openWatched(context, root, 'index.html');
    const href = () => page.evaluate(() => location.href);
    const bare = await href();
    assert.ok(!bare.includes('#'), bare);
    // 点下去的那一刻地址里有 #，hashchange 一到就挪走：等它回到文件本身（一直不回来就是超时失败）
    const settled = () => page.waitForFunction((url) => location.href === url, bare);

    await page.locator(`.zx-row[href*="${files[1]}"]`).click();
    await arrived(page, files[1]);
    await settled();
    await page.evaluate(() => scrollTo(0, 640));
    const previousY = await viewportY(page);
    await page.locator('.zx-side [data-section="binary-example"]').click();
    await arrived(page, files[1], 'binary-example');
    await settled();

    await page.reload();
    await arrived(page, files[1], 'binary-example');
    const after = await page.evaluate(() => ({
      h1: document.querySelector('main h1').textContent,
      top: Math.round(document.getElementById('binary-example').getBoundingClientRect().top)
    }));
    assert.equal(after.h1, '每次排除一半的可能', '刷新之后还是这一讲');
    assert.ok(after.top >= 0 && after.top < 200, `刷新之后落在原来那一节：${after.top}`);
    assert.deepEqual([loads.length, await href()], [2, bare], '刷新读了一次文件，读的地址不带 #');

    // 前进后退照常：同一页里退回上一处，再退回首页，再前进
    await page.goBack();
    await arrived(page, files[1], '');
    const backY = await viewportY(page);
    assert.ok(Math.abs(backY - previousY) <= 2, `刷新后再后退：应为 ${previousY}，实测 ${backY}`);
    await page.goBack();
    await arrived(page, 'index.html');
    await page.goForward();
    await arrived(page, files[1]);
    assert.equal(await page.locator('main h1').textContent(), '每次排除一半的可能');
    assert.deepEqual(page.errors, []);
    await context.close();
  }
);

test('单文件历史落点：同讲和跨讲前进后退都带回离开时的位置', packedOnly, async () => {
  const root = course('sample');
  const [, second, third] = lessonFiles(root);
  const context = await newContext(WIDE);
  try {
    const { page, loads } = await openWatched(context, root, 'index.html');
    const bare = page.url();
    const at = async (expected, label) => {
      const actual = await viewportY(page);
      assert.ok(Math.abs(actual - expected) <= 2, `${label}：应为 ${expected}，实测 ${actual}`);
      assert.equal(page.url(), bare);
    };
    await page.locator(`.zx-row[href*="${second}"]`).click();
    await arrived(page, second, '');

    for (const start of [0, 640]) {
      await page.evaluate((top) => scrollTo(0, top), start);
      await at(start, '跳转前');
      await page.locator('.zx-side [data-section="binary-example"]').click();
      await arrived(page, second, 'binary-example');
      const target = await viewportY(page);
      assert.ok(target > 2000, `2.5 节应远离讲首：${target}`);

      await page.goBack();
      await arrived(page, second, '');
      await at(start, '同讲后退');
      await page.goForward();
      await arrived(page, second, 'binary-example');
      await at(target, '同讲前进');
      await page.goBack();
      await arrived(page, second, '');
      await at(start, '同讲再次后退');
    }

    await page.keyboard.press(']');
    await arrived(page, third, '');
    await page.evaluate(() => scrollTo(0, 800));
    await at(800, '下一讲阅读位置');
    await page.goBack();
    await arrived(page, second, '');
    await at(640, '跨讲后退');
    await page.goForward();
    await arrived(page, third, '');
    await at(800, '跨讲前进');
    assert.equal(loads.length, 1);
    assert.deepEqual(page.errors, []);
  } finally {
    await context.close();
  }
});

test('单文件历史落点：换讲未就绪时后退再前进，正文跟随最后一次选择', packedOnly, async () => {
  const root = course('sample');
  const [first, second] = lessonFiles(root);
  const context = await newContext(WIDE);
  try {
    const { page, loads } = await openWatched(context, root, first);
    const bare = page.url();
    await pauseMath(page);
    await page.keyboard.press(']');
    await page.waitForFunction((file) => ZHIXU.file === file && window.waitingOnMath, second);
    await page.evaluate(() => history.back());
    await page.waitForFunction((file) => history.state?.zx?.[0] === file, first);
    await page.evaluate(() => history.forward());
    await page.waitForFunction((file) => history.state?.zx?.[0] === file, second);
    await page.evaluate(() => window.releaseMath());
    await arrived(page, second);
    await viewportY(page);
    assert.equal(await page.locator('main h1').textContent(), '每次排除一半的可能');
    assert.equal(page.url(), bare);
    assert.equal(loads.length, 1);
    assert.deepEqual(page.errors, []);
  } finally {
    await context.close();
  }
});

test('单文件历史落点：中途后退取消搜索后，下次进入同一讲从讲首开始', packedOnly, async () => {
  const root = course('sample');
  const [first, second] = lessonFiles(root);
  const context = await newContext(WIDE);
  try {
    const { page, loads } = await openWatched(context, root, first);
    await pauseMath(page);
    await page.keyboard.press('/');
    await page.getByRole('combobox', { name: '搜索' }).fill('算一算');
    await page.locator('.zx-result').filter({ hasText: '算一算：最多几次' }).first().click();
    await page.waitForFunction((file) => ZHIXU.file === file && window.waitingOnMath, second);
    await page.evaluate(() => history.back());
    await page.waitForFunction((file) => history.state?.zx?.[0] === file, first);
    await page.evaluate(() => window.releaseMath());
    await arrived(page, first);
    await page.keyboard.press(']');
    await arrived(page, second, '');
    assert.ok((await viewportY(page)) <= 2, '再次进入这一讲时应在讲首');
    assert.equal(await page.evaluate(() => CSS.highlights.has('zx-find')), false);
    assert.equal(loads.length, 1);
    assert.deepEqual(page.errors, []);
  } finally {
    await context.close();
  }
});

/** 这一页现在的样子：根元素上的状态、页面的结构、正文和外壳的标记、正文各块在版面上的位置。 */
const snapshot = () => {
  const root = document.documentElement;
  const body = document.querySelector('main') ?? document.querySelector('.zx-home');
  const box = (el) => {
    const rect = el.getBoundingClientRect();
    return [rect.left, rect.top, rect.width, rect.height].map(Math.round);
  };
  // 类名的先后不算：有几个类是在不同的时刻加上的（量版面、观察器回报尺寸），先后看哪一样先到
  const markup = (el) => {
    const copy = el.cloneNode(true);
    for (const node of [copy, ...copy.querySelectorAll('[class]')]) {
      node.setAttribute('class', [...node.classList].sort().join(' '));
    }
    return copy.outerHTML;
  };
  return {
    root: { className: root.className, data: { ...root.dataset }, style: root.getAttribute('style') },
    title: document.title,
    // <noscript> 不显示也不占版面；直接打开时它在运行时启动之后才解析出来，排在最后，换页之后的位置不同
    children: [...document.body.children]
      .filter((el) => el.tagName !== 'NOSCRIPT')
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
    header: markup(document.querySelector('.zx-header')),
    side: document.querySelector('.zx-side') && markup(document.querySelector('.zx-side')),
    body: markup(body),
    boxes: [body, ...document.querySelectorAll('.zx-side, h1, :is(main, .zx-home) > *')].slice(0, 16).map(box),
    highlights: CSS.highlights.size,
    scroll: [scrollX, scrollY]
  };
};

/** 两段标记第一处不一样的地方，前后各带一点上下文；一样时是 null。 */
function firstDifference(fresh, turned) {
  let at = 0;
  while (at < fresh.length && fresh[at] === turned[at]) at += 1;
  if (at === fresh.length && at === turned.length) return null;
  return `第 ${at} 个字符起不一样\n直接打开：${fresh.slice(at - 80, at + 160)}\n换页换到：${turned.slice(at - 80, at + 160)}`;
}

function assertSame(fresh, turned, label) {
  for (const part of ['header', 'side', 'body']) {
    assert.equal(firstDifference(String(fresh[part]), String(turned[part])), null, `${label}：${part} 的标记`);
  }
  const rest = (shot) => ({ ...shot, header: null, side: null, body: null });
  assert.deepEqual(rest(turned), rest(fresh), label);
}

for (const [label, options] of [
  ['宽屏', WIDE],
  ['手机', PHONE]
]) {
  test(`A00 单文件（${label}）：换页换到的一页，和直接打开的同一页一模一样`, packedOnly, async () => {
    const root = course('sample');
    const files = lessonFiles(root);
    const context = await newContext(options);
    // 每一对都让“最近打开的一讲”在两边相同：首页的“继续阅读”看的就是它
    for (const [target, from] of [
      ['index.html', files[2]],
      [files[0], 'index.html'],
      [files[1], files[3]],
      [files[2], files[1]],
      [files[3], files[0]]
    ]) {
      const turnedPage = await open(context, root, from);
      const fresh = await open(context, root, target);
      const freshShot = await fresh.evaluate(snapshot);
      await goTo(turnedPage, target);
      assertSame(freshShot, await turnedPage.evaluate(snapshot), `${from} → ${target}`);
      assert.deepEqual([fresh.errors, turnedPage.errors], [[], []]);
      await fresh.close();
      await turnedPage.close();
    }
    await context.close();
  });
}

test(
  'A00 单文件：换页之后这一页的监听都在——滚动时书眉和进度线跟着变，点目录里的小节落到那一节，别的标签页改了笔记这里跟着变',
  packedOnly,
  async () => {
    const root = course('sample');
    const files = lessonFiles(root);
    const context = await newContext(WIDE);
    const page = await open(context, root, 'index.html');
    await page.locator(`.zx-row[href*="${files[0]}"]`).click();
    await arrived(page, files[0]);
    await page.keyboard.press(']');
    await arrived(page, files[1]);

    // 滚动：书眉出现、写着现在读到哪一节，进度线长出来，往下滚页眉收起来
    await page.mouse.wheel(0, 2400);
    await page.waitForFunction(() => document.documentElement.classList.contains('zx-past'));
    await page.waitForFunction(() => document.documentElement.classList.contains('zx-away'));
    const reading = await page.evaluate(() => ({
      running: document.querySelector('.zx-running').textContent,
      progress: document.querySelector('.zx-progress').style.scale
    }));
    assert.match(reading.running, /^第 2 讲　二分查找　2\.\d /, `书眉：${reading.running}`);
    assert.notEqual(reading.progress, '0 1', '进度线长出来了');

    // 点目录栏里的一个小节：同一页里换锚点，落到那一节
    await page.mouse.wheel(0, -2400);
    await page.locator('.zx-side [data-section="binary-example"]').click();
    await page.waitForFunction(() => {
      const top = document.getElementById('binary-example').getBoundingClientRect().top;
      return top >= 0 && top < 200;
    });
    assert.equal(await page.evaluate(() => ZHIXU.anchor()), 'binary-example');

    // 换到下一讲：从顶上开始，页眉露出来，书眉藏起来
    await page.keyboard.press(']');
    await arrived(page, files[2]);
    assert.deepEqual(
      await page.evaluate(() => ({
        y: scrollY,
        past: document.documentElement.classList.contains('zx-past'),
        away: document.documentElement.classList.contains('zx-away')
      })),
      { y: 0, past: false, away: false }
    );

    // 别的标签页改了这一讲的笔记：这里没有草稿，面板换成最新的内容
    await page.keyboard.press('n');
    await page.locator('textarea.zx-notes').waitFor();
    const other = await open(context, root, files[2]);
    await other.keyboard.press('n');
    await other.locator('textarea.zx-notes').pressSequentially('别处写的笔记');
    await page.waitForFunction(() => document.querySelector('textarea.zx-notes').value === '别处写的笔记');
    assert.deepEqual([page.errors, other.errors], [[], []]);
    await context.close();
  }
);

test(
  'A00 单文件：来回换几十次页，页面上的东西不越积越多（目录抽屉、浮层、观察器、搜索的标记）',
  packedOnly,
  async () => {
    const root = course('sample');
    const files = lessonFiles(root);
    const context = await newContext(PHONE);
    const page = await open(context, root, files[0]);
    const count = () =>
      page.evaluate(() => ({
        children: document.body.children.length,
        dialogs: document.querySelectorAll('dialog').length,
        popovers: document.querySelectorAll('[popover]:not(main *)').length,
        highlights: CSS.highlights.size
      }));
    const baseline = await count();

    for (let round = 0; round < 3; round += 1) {
      for (const file of [...files.slice(1), files[0]]) {
        // 窄屏上从抽屉里的目录换页：抽屉是这一页的，换走就该收掉
        await page.getByRole('button', { name: '目录' }).click();
        await page.locator('.zx-dialog--drawer[open]').waitFor();
        await page.locator(`.zx-dialog--drawer .zx-nav-link[data-file="${file}"]`).click();
        await arrived(page, file);
      }
    }
    // 搜索落到别的一讲：词被标出来；再换一页，标记跟着撤掉
    await page.keyboard.press('/');
    await page.locator('input[role="combobox"]').fill('区间');
    await page.locator('.zx-result').first().click();
    await page.waitForFunction(() => CSS.highlights.has('zx-find'));
    await goTo(page, files[0]);

    assert.deepEqual(await count(), baseline, '回到同一讲，页面上的东西和第一次打开时一样多');
    assert.deepEqual(page.errors, []);
    await context.close();
  }
);

test('A00 单文件：恢复备份、清除记录在页面里做完，不重读文件', packedOnly, async () => {
  const root = course('sample');
  const [first] = lessonFiles(root);
  const context = await newContext();
  const { page, loads: documents } = await openWatched(context, root, first);

  await page.getByRole('button', { name: '外观与设置' }).click();
  page.on('dialog', (dialog) => dialog.accept());
  await page.evaluate(() => (document.querySelector('main').dataset.old = ''));
  await page.getByRole('button', { name: '清除记录', exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector('[data-old]') && document.documentElement.classList.contains('zx-ready')
  );
  assert.equal(
    await page.locator('main h1').textContent(),
    '算法，是把问题想清楚',
    '清除之后还是这一讲，按新的记录重搭了'
  );
  assert.equal(documents.length, 1, '清除记录没有重读文件');
  assert.deepEqual(page.errors, []);
  await context.close();
});

const HOME_LINK = {
  'lesson.html': [
    '<section id="part">',
    '<h2>正文</h2>',
    '<p>回到<a href="index.html">课程首页</a>看目录。</p>',
    '</section>'
  ].join('\n')
};

test('A01 正文里手写的“回到课程首页”：两种形态都进本课程首页，单文件里不重读文件', async () => {
  const root = makeCourse('home-link', HOME_LINK);
  const context = await newContext();
  const { page, loads: documents } = await openWatched(context, root, 'lesson.html');
  const link = page.getByRole('link', { name: '课程首页' });
  if (PACKED) assert.equal(await link.getAttribute('href'), '#index.html', '单文件里首页也走加载器给的地址');
  await link.click();
  await arrived(page, 'index.html');
  assert.ok((await page.locator('.zx-row').count()) > 0, '到了本课程首页');
  assert.equal(documents.length, PACKED ? 1 : 2);
  assert.deepEqual(page.errors, []);
  await context.close();
});

test(
  'A00 单文件：换到的一页没能搭起来时，和启动失败一样，正文照常显示、顶上说明原因；再换到别的页一切照常',
  packedOnly,
  async () => {
    const root = course('sample');
    const [first, second, third] = lessonFiles(root);
    const context = await newContext();
    const page = await open(context, root, first);
    // 第三讲的正文换成一份缺了讲题（<h1>）的：引擎给讲题编号时就会出错
    await page.evaluate((broken) => {
      const body = ZHIXU.body;
      ZHIXU.body = (file) => (file === broken ? '<main><p>一段没有讲题的正文。</p></main>' : body(file));
    }, third);
    await goTo(page, third);
    const shown = await page.evaluate(() => ({
      alert: document.querySelector('main > .zx-alert')?.textContent,
      text: document.querySelector('main > p:not(.zx-alert)').textContent,
      visible: getComputedStyle(document.body).display !== 'none'
    }));
    assert.match(shown.alert, /^这一页没有正常显示：.+。正文仍可阅读。$/);
    assert.deepEqual([shown.text, shown.visible], ['一段没有讲题的正文。', true]);
    assert.equal(page.errors.length, 1, '原因写进了控制台');

    await goTo(page, second);
    const next = await page.evaluate(() => ({
      alert: document.querySelectorAll('.zx-alert').length,
      h1: document.querySelector('main h1').textContent,
      side: document.querySelectorAll('.zx-side').length
    }));
    assert.deepEqual(next, { alert: 0, h1: '每次排除一半的可能', side: 1 }, '说明没有跟到下一页，下一页照常');
    await context.close();
  }
);
