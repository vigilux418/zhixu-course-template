'use strict';
/* 首页的课程地图（阶梯）和讲义的章首页：每讲一级、读过的痕迹、长课分段、讲次的大数字、页边放不放得下编号。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { ENGINE, course, newContext, open, arrived, lessonFiles } = require('./harness');

const THEMES = ['light', 'sepia', 'dark'];

/** 打开首页，记录里已经读完前 read 讲、最近打开的是下一讲。 */
async function openHome(context, name, read, suffix = '') {
  const root = course(name);
  const files = lessonFiles(root);
  const page = await open(context, root, 'index.html', suffix);
  await page.evaluate(
    ([done, last]) => {
      const record = { done: Object.fromEntries(done.map((file) => [file, '2026-11-16'])), last };
      localStorage.setItem(`zhixu:course:${window.ZHIXU_COURSE.id}`, JSON.stringify(record));
    },
    [files.slice(0, read), files[read] ?? null]
  );
  await page.reload();
  await page.waitForSelector('html.zx-ready');
  return page;
}

/** 页面上每一级台阶：编号、去向、踏面是什么颜色、编号有没有立在圆点里、宽度、编号的上沿。 */
const readSteps = (page) =>
  page.evaluate(() => {
    const token = (name) => {
      const probe = document.createElement('i');
      probe.style.color = `var(${name})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const names = { [token('--seal')]: '朱砂', [token('--rule-strong')]: '灰', [token('--accent')]: '蓝' };
    return [...document.querySelectorAll('.zx-flight')].map((flight) =>
      [...flight.children].map((step) => {
        const number = step.querySelector('b');
        return {
          number: number.textContent,
          file: step.getAttribute('href'),
          tread: names[getComputedStyle(step, '::after').borderTopColor],
          marked: names[getComputedStyle(number).backgroundColor] === '蓝',
          width: Math.round(step.getBoundingClientRect().width),
          top: number.getBoundingClientRect().top
        };
      })
    );
  });

const rising = (steps) => steps.every((step, index) => index === 0 || step.top < steps[index - 1].top);

test('课程地图：每讲一级，点一级进那一讲；读完的台阶是朱砂色，接下来要读的一级立着编号，单元的最后一级是平台', async () => {
  const context = await newContext();
  const page = await openHome(context, 'sample', 2);
  const [steps, ...more] = await readSteps(page);
  assert.equal(more.length, 0, '四讲只有一段');
  assert.deepEqual(
    steps.map((step) => step.number),
    ['1', '2', '3', '4']
  );
  assert.deepEqual(
    steps.map((step) => step.file.replace(/^#/, '')), // 单文件里的链接写成“#讲义文件名”
    lessonFiles(course('sample'))
  );
  assert.deepEqual(
    steps.map((step) => step.tread),
    ['朱砂', '朱砂', '灰', '灰']
  );
  assert.deepEqual(
    steps.map((step) => step.marked),
    [false, false, true, false]
  );
  assert.ok(rising(steps), '一级比一级高');
  assert.ok(steps[1].width > steps[0].width * 1.4, `第一单元的最后一级是平台：${steps[1].width} 对 ${steps[0].width}`);
  assert.equal(steps[2].width, steps[0].width, '别的台阶一样宽');
  assert.equal(steps[3].width, steps[0].width, '全课的最后一级不是平台');

  await page.locator('.zx-flight > a').nth(3).click();
  await arrived(page, '04-recursion.html');
  await context.close();
});

test('课程地图：全部读完时每一级都是朱砂色，没有哪一级立着编号；一讲没读时第一级立着编号', async () => {
  const context = await newContext();
  const done = (await readSteps(await openHome(context, 'sample', 4)))[0];
  assert.deepEqual(
    done.map((step) => [step.tread, step.marked]),
    Array(4).fill(['朱砂', false])
  );
  const fresh = (await readSteps(await openHome(context, 'calculus', 0)))[0];
  assert.deepEqual(
    fresh.map((step) => [step.tread, step.marked]),
    [
      ['灰', true],
      ['灰', false],
      ['灰', false]
    ]
  );
  await context.close();
});

test('课程地图：鼠标移到一级上，这一讲的名字出现在“共几讲”那一行的位置，移开就换回来', async () => {
  const context = await newContext();
  const page = await openHome(context, 'sample', 2);
  const look = () =>
    page.evaluate(() => {
      const shown = (el) => getComputedStyle(el).visibility === 'visible';
      const stat = document.querySelector('.zx-cover-stat');
      const labels = [...document.querySelectorAll('.zx-flight span')].filter(shown);
      const box = (el) => {
        const rect = el.getBoundingClientRect();
        return [Math.round(rect.left), Math.round(rect.top)];
      };
      return { stat: shown(stat), statAt: box(stat), labels: labels.map((label) => [label.textContent, box(label)]) };
    });

  const before = await look();
  assert.deepEqual([before.stat, before.labels], [true, []]);

  await page.locator('.zx-flight > a').nth(3).hover();
  const during = await look();
  assert.equal(during.stat, false, '统计那一行让出位置');
  assert.deepEqual(during.labels, [['第 4 讲　递归的思维', before.statAt]]);

  await page.mouse.move(5, 5);
  assert.deepEqual(await look(), before);
  await context.close();
});

test('课程地图：二十六讲分成两段，每段十三级，逐级升高；手机上不横向溢出，相邻的编号不相碰', async () => {
  for (const [width, height, phone] of [
    [1440, 900, false],
    [320, 720, true]
  ]) {
    // Firefox 不支持按手机来模拟，它的滚动条本来就不占地方
    const emulated = phone ? { hasTouch: true, isMobile: ENGINE !== 'firefox' } : null;
    const context = await newContext({ viewport: { width, height }, ...emulated });
    const page = await openHome(context, 'long', 9);
    const flights = await readSteps(page);
    assert.deepEqual(
      flights.map((steps) => steps.length),
      [13, 13],
      `${width}：两段各十三级`
    );
    assert.deepEqual(
      flights.flat().map((step) => step.number),
      Array.from({ length: 26 }, (unused, index) => String(index + 1))
    );
    assert.ok(flights.every(rising), `${width}：每一段都逐级升高`);
    assert.deepEqual(
      flights.flat().map((step) => step.tread),
      [...Array(9).fill('朱砂'), ...Array(17).fill('灰')]
    );
    assert.equal(
      flights.flat().findIndex((step) => step.marked),
      9,
      '第 10 讲立着编号'
    );

    const layout = await page.evaluate(() => {
      const inked = (number) => {
        if (getComputedStyle(number).backgroundColor !== 'rgba(0, 0, 0, 0)') return number.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(number);
        return range.getBoundingClientRect();
      };
      const touching = [...document.querySelectorAll('.zx-flight')].flatMap((flight) => {
        const boxes = [...flight.querySelectorAll('b')].map(inked);
        return boxes.slice(1).filter((box, index) => box.left < boxes[index].right);
      });
      return {
        touching: touching.length,
        overflowing: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    });
    assert.deepEqual(layout, { touching: 0, overflowing: false }, `${width}：编号不相碰，页面不横向溢出`);
    await context.close();
  }
});

test('课程地图对键盘和读屏软件隐藏（旁边的目录是同一组链接）：Tab 不停在台阶上，进度在统计那一行读得到', async () => {
  const context = await newContext();
  const page = await openHome(context, 'sample', 2);
  const map = await page.evaluate(() => ({
    hidden: document.querySelector('.zx-stairs').getAttribute('aria-hidden'),
    tabStops: [...document.querySelectorAll('.zx-stairs a')].filter((link) => link.tabIndex >= 0).length,
    stat: document.querySelector('.zx-cover-stat').textContent
  }));
  assert.deepEqual([map.hidden, map.tabStops], ['true', 0]);
  assert.match(map.stat, /^共 4 讲，约 \d+ 分钟。已读 2 讲。$/);

  const visited = [];
  for (let presses = 0; presses < 12; presses += 1) {
    await page.keyboard.press('Tab');
    visited.push(await page.evaluate(() => Boolean(document.activeElement.closest('.zx-stairs'))));
  }
  assert.ok(!visited.includes(true), 'Tab 一路走下去，没有停在台阶上');
  await context.close();
});

for (const theme of THEMES) {
  test(`读过的痕迹都是朱砂色（${theme} 主题）：读完的台阶、首页目录里的已读记号、目录栏里的小印`, async () => {
    const context = await newContext();
    const home = await openHome(context, 'sample', 2, `?theme=${theme}`);
    const onHome = await home.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const probe = document.createElement('i');
      probe.style.color = 'var(--seal)';
      document.body.append(probe);
      return {
        theme: document.documentElement.dataset.theme,
        seal: getComputedStyle(probe).color,
        token: style.getPropertyValue('--seal').trim(),
        step: getComputedStyle(document.querySelector('.zx-flight > .is-done'), '::after').borderTopColor,
        number: getComputedStyle(document.querySelector('.zx-flight > .is-done > b')).color,
        row: getComputedStyle(document.querySelector('.zx-row.is-done > .zx-row-m'), '::before').backgroundColor
      };
    });
    assert.equal(onHome.theme, theme);
    assert.deepEqual([onHome.step, onHome.number, onHome.row], Array(3).fill(onHome.seal), `--seal 是 ${onHome.token}`);

    const lesson = await open(context, course('sample'), '03-time-complexity.html', `?theme=${theme}`);
    const mark = await lesson.evaluate(
      () => getComputedStyle(document.querySelector('.zx-nav-link.is-done'), '::after').backgroundColor
    );
    assert.equal(mark, onHome.seal);
    await context.close();
  });
}

test('封面上的错题入口：有错题才出现，写明有几道；点它滚到“错题回顾”那一栏；带着锚点直接打开首页也落在那儿', async () => {
  const context = await newContext({ viewport: { width: 1024, height: 768 } });
  const page = await openHome(context, 'long', 3);
  assert.deepEqual(
    [await page.locator('.zx-cover-review').count(), await page.locator('#zx-review').count()],
    [0, 0],
    '没有错题：没有入口，也没有那一栏'
  );

  // 两道没答对（第 1 讲、第 26 讲），一道答对了（第 2 讲）。键用课程数据里这几讲真有的题：首页只认这一版里还在的题
  await page.evaluate(() => {
    const key = `zhixu:course:${window.ZHIXU_COURSE.id}`;
    const quizOf = (file) => window.ZHIXU_DATA.lessons[file].quizKeys[0];
    const answer = (ok, stem) => ({ ok, at: '2026-11-16', stem, id: 'check' });
    const data = JSON.parse(localStorage.getItem(key));
    data.quiz = {
      '01-lesson.html': { [quizOf('01-lesson.html')]: answer(false, '第 1 讲的主题是什么？') },
      '02-lesson.html': { [quizOf('02-lesson.html')]: answer(true, '答对的一道') },
      '26-lesson.html': { [quizOf('26-lesson.html')]: answer(false, '第 26 讲的主题是什么？') }
    };
    localStorage.setItem(key, JSON.stringify(data));
  });
  await page.reload();
  await page.waitForSelector('html.zx-ready');
  const top = (target) =>
    target.evaluate(() => Math.round(document.getElementById('zx-review').getBoundingClientRect().top));
  const arrived = (target) =>
    target.waitForFunction(() => {
      const box = document.getElementById('zx-review').getBoundingClientRect();
      return box.top >= 52 && box.bottom <= innerHeight; // 整栏都在屏幕里，在页眉下面，不被它盖住
    });

  assert.equal(await page.locator('.zx-cover-review').textContent(), '2 道错题待回顾');
  assert.equal(await page.locator('#zx-review li').count(), 2);
  assert.ok((await top(page)) > 3000, `二十六讲的目录后面才是错题回顾：它在 ${await top(page)} 像素处`);
  await page.locator('.zx-cover-review').click();
  await arrived(page);

  const direct = await open(context, course('long'), 'index.html', '#zx-review');
  await arrived(direct);
  assert.deepEqual([page.errors, direct.errors], [[], []]);
  await context.close();
});

test('封面的各样东西各占一行：错题入口在“继续阅读”的下面，自己不折行；手机、平板、宽屏都一样', async () => {
  for (const [width, height] of [
    [320, 720],
    [390, 844],
    [768, 900],
    [1440, 900]
  ]) {
    const context = await newContext({ viewport: { width, height } });
    const page = await openHome(context, 'sample', 2);
    await page.evaluate(() => {
      const key = `zhixu:course:${window.ZHIXU_COURSE.id}`;
      const data = JSON.parse(localStorage.getItem(key));
      const answer = { ok: false, at: '2026-11-16', stem: '一道答错的题', id: 'none' };
      const file = '01-what-is-an-algorithm.html';
      data.quiz = {
        [file]: Object.fromEntries(window.ZHIXU_DATA.lessons[file].quizKeys.map((quiz) => [quiz, answer]))
      };
      localStorage.setItem(key, JSON.stringify(data));
    });
    await page.reload();
    await page.waitForSelector('html.zx-ready');
    const found = await page.evaluate(() => {
      const box = (selector) => document.querySelector(selector).getBoundingClientRect();
      const [stat, go, review, author] = ['.zx-cover-stat', '.zx-cover-go', '.zx-cover-review', '.zx-cover-author'].map(
        box
      );
      const lines = (selector) => {
        const range = document.createRange();
        range.selectNodeContents(document.querySelector(selector));
        return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
      };
      return {
        stacked: stat.bottom <= go.top && go.bottom <= review.top && review.bottom <= author.top,
        reviewLines: lines('.zx-cover-review'),
        // “继续阅读”和讲次的名字是两截：放不下时从中间断开，每一截自己不折行
        goParts: [lines('.zx-cover-go > :first-child'), lines('.zx-cover-go > :last-child')],
        // 入口只有它的文字那么宽：旁边的空白点了没有反应
        reviewNarrow: review.width < box('.zx-cover').width * 0.6
      };
    });
    assert.deepEqual(
      found,
      { stacked: true, reviewLines: 1, goParts: [1, 1], reviewNarrow: true },
      `${width} 宽：统计、继续阅读、错题入口、署名从上到下各占一行`
    );
    await context.close();
  }
});

test('章首页：宽屏上讲次是挂在标题左边的大数字，“第 4 讲”几个字让给它；窄屏和打印时还是那几个字', async () => {
  const head = (page) =>
    page.evaluate(() => {
      const title = document.querySelector('main h1');
      const numeral = getComputedStyle(title, '::before');
      const [lesson, unit] = [
        document.querySelector('.zx-kicker-n'),
        document.querySelector('.zx-kicker > :last-child')
      ];
      const words = document.createRange();
      words.selectNodeContents(title);
      const hung = numeral.display !== 'none' && numeral.content !== 'none';
      const found = {
        numeral: hung ? title.dataset.num : null, // 数字取自 data-num（Firefox 读出来的 content 是没算过的 attr()）
        bigger: hung && parseFloat(numeral.fontSize) > parseFloat(getComputedStyle(title).fontSize),
        kicker: [lesson, unit].filter((span) => span.checkVisibility()).map((span) => span.textContent)
      };
      // 去掉讲次再量一次：标题的高度和文字的位置都不该变（数字不占地方，也不撑高那一行）
      const place = () => [title.getBoundingClientRect().height, words.getBoundingClientRect().left];
      const withNumeral = place();
      title.removeAttribute('data-num');
      const bare = place();
      return { ...found, still: withNumeral.every((value, index) => Math.abs(value - bare[index]) < 0.1) };
    });

  const wide = await newContext({ viewport: { width: 1440, height: 900 } });
  const page = await open(wide, course('sample'), '04-recursion.html');
  assert.deepEqual(await head(page), { numeral: '4', bigger: true, kicker: ['进阶思考'], still: true });
  await page.reload();
  await page.waitForSelector('html.zx-ready');
  await page.emulateMedia({ media: 'print' });
  assert.deepEqual(await head(page), { numeral: null, bigger: false, kicker: ['第 4 讲', '进阶思考'], still: true });
  await wide.close();

  const narrow = await newContext({ viewport: { width: 390, height: 844 } });
  const phone = await open(narrow, course('sample'), '04-recursion.html');
  assert.deepEqual(await head(phone), { numeral: null, bigger: false, kicker: ['第 4 讲', '进阶思考'], still: true });
  await narrow.close();
});

test('页边放得下编号：长课第 26 讲在 1000 宽度下，讲次和 26.10 这样的小节编号都不超出屏幕左边，最大字号也一样', async () => {
  for (const size of [17, 21]) {
    const context = await newContext({ viewport: { width: 1000, height: 800 } });
    await context.addInitScript((value) => localStorage.setItem('zhixu:prefs', JSON.stringify({ size: value })), size);
    const page = await open(context, course('long'), '26-lesson.html');
    const hanging = await page.evaluate(() =>
      [...document.querySelectorAll('main h1[data-num], main h2[data-num]')].map((heading) => {
        const style = getComputedStyle(heading, '::before');
        const probe = document.createElement('span');
        probe.textContent = heading.dataset.num;
        for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontVariantNumeric'])
          probe.style[property] = style[property];
        probe.style.position = 'absolute';
        document.body.append(probe);
        const width = probe.getBoundingClientRect().width;
        probe.remove();
        const left = heading.getBoundingClientRect().left - parseFloat(style.marginRight) - width;
        return [heading.dataset.num, Math.floor(left)];
      })
    );
    assert.equal(hanging.length, 13, '讲次和十二个小节');
    assert.deepEqual(
      hanging.filter(([, left]) => left < 0),
      [],
      `字号 ${size}：编号的左边缘都在屏幕里`
    );
    await context.close();
  }
});
