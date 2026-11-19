'use strict';
/* 动效：只由读者的操作触发。浮层的进场和退场、术语和旁注浮层的淡入、选项卡的指示条、换主题、小测判定的反馈；
 * 系统设了“减弱动态效果”时，它们都只有一瞬。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { course, makeCourse, newContext, open, lessonFiles } = require('./harness');

const SAMPLE = '02-binary-search.html';
const PHONE = { viewport: { width: 390, height: 844 } };

const closed = (page) => page.waitForFunction(() => !document.querySelector('dialog[open]'));

/** 等一个元素（连同它的伪元素）身上的动画都放完；中途被换掉的也算完了。 */
const settled = (locator) =>
  locator.evaluate((el) =>
    Promise.allSettled(el.getAnimations({ subtree: true }).map((animation) => animation.finished))
  );

/** 把时长拉长：跨进程观测动画中段时默认拉到两秒，避免高并发调度偶发错过中段；页内采样或只测终态时可传更短时长。（选择器要压过 tokens.css 里的 :root） */
const slowDown = (page, ms = 2000) =>
  page.addStyleTag({ content: `html:root { --dur-1: ${ms}ms; --dur-2: ${ms}ms; }` });

test('浮层进场：打开时淡入；居中的从下面一点升上来，目录和笔记从屏幕两边滑进来；放完就在原位', async () => {
  const context = await newContext(PHONE);
  const page = await open(context, course('sample'), SAMPLE);
  await slowDown(page);
  const entrance = async () => {
    const dialog = page.locator('dialog[open]');
    await dialog.waitFor();
    const found = await dialog.evaluate((el) => ({
      playing: el.getAnimations().map((animation) => animation.animationName),
      veil: getComputedStyle(el, '::backdrop').animationName,
      from: getComputedStyle(el).getPropertyValue('--away').trim()
    }));
    await settled(dialog);
    const rest = await dialog.evaluate((el) => [getComputedStyle(el).opacity, getComputedStyle(el).translate]);
    await page.keyboard.press('Escape');
    await closed(page);
    return { ...found, rest };
  };
  const expected = (from) => ({ playing: ['zx-appear'], veil: 'zx-appear', from, rest: ['1', 'none'] });

  await page.getByRole('button', { name: '外观与设置' }).click();
  assert.deepEqual(await entrance(), expected('0 8px'), '设置：从下面 8 像素处升上来');
  await page.getByRole('button', { name: '目录' }).click();
  assert.deepEqual(await entrance(), expected('-100% 0'), '目录：从左边滑进来');
  await page.getByRole('button', { name: '本讲笔记' }).click();
  assert.deepEqual(await entrance(), expected('100% 0'), '笔记：从右边滑进来');
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('浮层背后的遮罩只淡入，不跟着浮层挪：进场的头一刻整个屏幕就盖住了，这时点面板外面，面板照样关上', async () => {
  const context = await newContext({ viewport: { width: 1024, height: 768 } });
  const page = await open(context, course('sample'), SAMPLE);
  await slowDown(page);
  // 面板从哪一侧出来，就看另一侧（和四个角落）：那里只有遮罩
  const CASES = [
    ['目录', [964, 400]],
    ['本讲笔记', [60, 400]],
    ['外观与设置', [60, 60]]
  ];
  for (const [name, outside] of CASES) {
    await page.getByRole('button', { name }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.waitFor();
    const found = await dialog.evaluate((el, [x, y]) => {
      // 右边可能有一条滚动条，它不算页面：角落按页面实际的宽度取
      const right = document.documentElement.clientWidth - 5;
      const bottom = innerHeight - 5;
      return {
        fading: Number(getComputedStyle(el, '::backdrop').opacity) < 1, // 进场还在放
        moved: getComputedStyle(el, '::backdrop').translate,
        covered: [
          [x, y],
          [4, 4],
          [right, 4],
          [4, bottom],
          [right, bottom]
        ].every(([left, top]) => el.contains(document.elementFromPoint(left, top)))
      };
    }, outside);
    assert.deepEqual(
      { ...found, moved: found.moved.replace(/^0px( 0px)?$/, 'none') },
      { fading: true, moved: 'none', covered: true },
      `${name}：遮罩在原位淡入`
    );
    await page.mouse.click(...outside);
    await closed(page);
  }
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('浮层退场：内核支持的话，关掉以后浮层还在原处留一小会儿、淡出去，这时不挡后面的页面；不支持的直接消失', async () => {
  const context = await newContext({ viewport: { width: 1024, height: 768 } });
  const page = await open(context, course('sample'), SAMPLE);
  await slowDown(page);
  await page.getByRole('button', { name: '外观与设置' }).click();
  const dialog = page.locator('.zx-dialog:has(.zx-seg)');
  await settled(dialog);
  const box = await dialog.boundingBox();
  const center = [box.x + box.width / 2, box.y + box.height / 2];

  await page.keyboard.press('Escape');
  await closed(page); // WebKit 里按 Esc 关浮层是异步的：等它关上再看
  const leaving = await dialog.evaluate(
    (el, [x, y]) => ({
      lingers: CSS.supports('overlay', 'auto'),
      open: el.open,
      shown: getComputedStyle(el).display !== 'none',
      fading: el.getAnimations().map((animation) => animation.transitionProperty),
      under: document.elementFromPoint(x, y).closest('dialog') ? '浮层' : '页面',
      scrollLocked: getComputedStyle(document.documentElement).overflowY === 'hidden'
    }),
    center
  );
  assert.equal(leaving.open, false, '按了 Esc，浮层已经关了');
  assert.equal(leaving.scrollLocked, false, '页面马上就能滚');
  assert.equal(leaving.under, '页面', '浮层原来的位置上，现在点到的是后面的页面');
  if (leaving.lingers) {
    assert.equal(leaving.shown, true, '还显示着');
    assert.deepEqual(leaving.fading.sort(), ['display', 'opacity', 'overlay', 'translate']);
    await settled(dialog);
  } else {
    assert.deepEqual(leaving.fading, []);
  }
  assert.equal(await dialog.evaluate((el) => getComputedStyle(el).display), 'none', '最后不显示了');
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('停靠在页边的笔记：打开时只淡入、不滑动；关掉时立刻让出页边，不留着淡出', async () => {
  const context = await newContext({ viewport: { width: 1440, height: 900 } });
  const page = await open(context, course('sample'), SAMPLE);
  await slowDown(page, 500);
  await page.keyboard.press('n');
  const panel = page.locator('.zx-dock > dialog');
  await panel.waitFor();
  assert.equal(await panel.evaluate((el) => getComputedStyle(el).getPropertyValue('--away').trim()), '0 0');
  await settled(panel);
  const docked = await page.evaluate(() => document.querySelector('main').scrollWidth);

  await page.keyboard.press('Escape');
  await closed(page);
  const after = await panel.evaluate((el) => ({
    shown: getComputedStyle(el).display !== 'none',
    fading: el.getAnimations().length,
    main: document.querySelector('main').scrollWidth
  }));
  assert.deepEqual(after, { shown: false, fading: 0, main: docked });
  await context.close();
});

test('术语和旁注的浮层：弹出来时淡入，位置从头到尾不动', async () => {
  const context = await newContext(PHONE);
  const page = await open(context, course('sample'), SAMPLE);
  await slowDown(page);

  for (const [label, trigger] of [
    ['术语', 'dfn[role="button"]'],
    ['旁注', '.zx-ref button']
  ]) {
    const anchor = page.locator(trigger).first();
    await anchor.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await anchor.click();
    const pop = page.locator(':popover-open');
    await pop.waitFor();
    const start = await pop.evaluate((el) => ({
      playing: el.getAnimations().map((animation) => animation.animationName),
      at: [el.getBoundingClientRect().left, el.getBoundingClientRect().top]
    }));
    await settled(pop);
    const end = await pop.evaluate((el) => ({
      opacity: getComputedStyle(el).opacity,
      at: [el.getBoundingClientRect().left, el.getBoundingClientRect().top]
    }));
    assert.deepEqual(start.playing, ['zx-appear'], `${label}：淡入`);
    assert.deepEqual(end, { opacity: '1', at: start.at }, `${label}：位置没动`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector(':popover-open'));
  }
  await context.close();
});

const TABS = (first) =>
  [
    '<div class="tabs">',
    `<div data-tab="Python"><p>${first}：Python 的写法。</p></div>`,
    `<div data-tab="JavaScript"><p>${first}：JavaScript 的写法。</p></div>`,
    `<div data-tab="一个名字很长的选项卡"><p>${first}：第三种写法。</p></div>`,
    '</div>'
  ].join('\n');

/** 每一组选项卡：指示条画在哪儿（左边、宽度），选中的那个选项卡在哪儿，指示条现在会不会滑。
 * 打印用的参考答案页里有一份解析的副本，屏幕上不显示，不算在内。 */
const underlines = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.zx-tablist:not(.zx-answers *)')].map((list) => {
      const bar = getComputedStyle(list, '::after');
      const tab = list.querySelector('[aria-selected="true"]');
      return {
        selected: tab.textContent,
        bar: [parseFloat(bar.translate), parseFloat(bar.width)],
        tab: [tab.offsetLeft, tab.offsetWidth],
        slides: bar.transitionDuration !== '0s'
      };
    })
  );

test('选项卡的指示条：画在选中的那个下面；点另一个，它滑过去，全页同名的一起换；收在小测解析里的一组，揭晓时也在位', async () => {
  const root = makeCourse('tabs-bar', {
    'lesson.html': [
      '<section id="one">',
      '<h2>选项卡</h2>',
      TABS('第一组'),
      TABS('第二组'),
      '<div class="quiz" data-answer="a">',
      '<p>哪一种写法最短？</p>',
      '<ol><li>第一种</li><li>第二种</li></ol>',
      `<div class="explain">${TABS('第三组')}</div>`,
      '</div>',
      '</section>'
    ].join('\n')
  });
  const context = await newContext({ viewport: { width: 1024, height: 768 } });
  const page = await open(context, root, 'lesson.html');
  const inPlace = (groups, label) =>
    assert.deepEqual(
      groups.map((group) => group.bar),
      groups.map((group) => group.tab),
      label
    );

  const first = await underlines(page);
  assert.deepEqual(
    first.map((group) => group.selected),
    Array(3).fill('Python'),
    '刚打开：都选着第一个'
  );
  assert.deepEqual(
    first.slice(0, 2).map((group) => group.slides),
    [false, false],
    '没人碰的时候指示条不带过渡'
  );
  inPlace(first.slice(0, 2), '看得见的两组，指示条在选中的选项卡下面');

  const target = page.locator('.zx-tab', { hasText: '一个名字很长的选项卡' }).first();
  await target.hover();
  assert.equal((await underlines(page))[0].slides, true, '鼠标移到这一组上，指示条才带过渡');
  await target.click();
  await settled(page.locator('.zx-tablist').first());
  const moved = await underlines(page);
  assert.deepEqual(
    moved.map((group) => group.selected),
    Array(3).fill('一个名字很长的选项卡')
  );
  inPlace(moved.slice(0, 2), '点过之后，两组的指示条都到了新的位置');
  assert.ok(moved[0].bar[0] > first[0].bar[0] && moved[0].bar[1] > first[0].bar[1], '位置和宽度都变了');

  // 解析揭晓之前不占地方，里面那一组选项卡量不出宽度；揭晓了才量得出来
  const quiz = page.locator('.quiz');
  await quiz.locator('.zx-opt').first().click();
  await quiz.getByRole('button', { name: '检查答案' }).click();
  await page.waitForFunction(
    () => parseFloat(getComputedStyle(document.querySelectorAll('.zx-tablist')[2], '::after').width) > 0
  );
  inPlace(await underlines(page), '解析揭晓，里面那一组的指示条也在位');

  await page.locator('.zx-tab', { hasText: 'JavaScript' }).first().focus();
  await page.keyboard.press('ArrowLeft');
  await settled(page.locator('.zx-tablist').first());
  const keyed = await underlines(page);
  assert.deepEqual(
    keyed.map((group) => group.selected),
    Array(3).fill('Python')
  );
  inPlace(keyed, '用方向键换，指示条照样跟着');
  assert.deepEqual(page.errors, []);
  await context.close();
});

/**
 * 点设置里的一个选项，返回根元素上随之开始的过渡：[属性名, 时长（毫秒）]。点和看在同一步里做，一毫秒的过渡也看得到。
 * 给出 sampleRed（起始红色分量）时，在同一回调里立即以 rAF 采样首个落在两头之间的插值，避免受外部调度影响。
 */
const choose = (page, label, sampleRed = null) =>
  page.evaluate(
    async ([text, fromRed]) => {
      [...document.querySelectorAll('.zx-seg label')].find((item) => item.textContent === text).click();
      const fades = document.documentElement
        .getAnimations()
        .map((animation) => [animation.transitionProperty, animation.effect.getTiming().duration])
        .sort();
      if (fromRed === null) return fades;
      const red = await new Promise((resolve) => {
        const poll = () => {
          const current = Number(getComputedStyle(document.documentElement).backgroundColor.match(/\d+/)[0]);
          if ((current < fromRed && current > 21) || document.documentElement.getAnimations().length === 0) {
            resolve(current);
            return;
          }
          requestAnimationFrame(poll);
        };
        requestAnimationFrame(poll);
      });
      return { fades, red };
    },
    [label, sampleRed]
  );

/** 纸面现在的颜色：[红, 绿, 蓝]。底色铺在根元素上。 */
const paperOf = (page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor.match(/\d+/g).slice(0, 3).map(Number));

const THEME_SLOW_MS = 500;

test('换主题：颜色渐变过去，不是一下子跳；放完之后根元素上不留过渡；“减弱动态效果”时只有一瞬', async () => {
  for (const [label, options, duration] of [
    ['平常', {}, THEME_SLOW_MS],
    ['减弱动态效果', { reducedMotion: 'reduce' }, 1]
  ]) {
    const context = await newContext({ viewport: { width: 1024, height: 768 }, ...options });
    const page = await open(context, course('sample'), SAMPLE);
    await slowDown(page, THEME_SLOW_MS);
    await page.getByRole('button', { name: '外观与设置' }).click();
    await settled(page.locator('dialog[open]'));
    const light = await paperOf(page);

    const picked = await choose(page, '深色', duration > 1 ? light[0] : null);
    const fades = duration > 1 ? picked.fades : picked;
    const names = fades.map(([name]) => name);
    assert.ok(
      ['--paper', '--ink', '--text', '--accent', '--rule', '--code-keyword', '--veil'].every((name) =>
        names.includes(name)
      ),
      `${label}：这些颜色在渐变：${names.join(' ')}`
    );
    assert.deepEqual([...new Set(fades.map(([, time]) => time))], [duration], `${label}：每一段都是 ${duration} 毫秒`);

    if (duration > 1) {
      assert.ok(picked.red < light[0] && picked.red > 21, `放到一半，纸面的颜色在两头之间：红色分量 ${picked.red}`);
    }
    await page.waitForFunction(() => document.documentElement.getAnimations().length === 0);
    assert.deepEqual(await paperOf(page), [21, 24, 29], `${label}：放完是深色的纸面`);
    await page.waitForFunction(() => document.documentElement.style.transition === '');
    assert.deepEqual(page.errors, []);
    await context.close();
  }
});

test('换主题：连着换不出错；换完马上关面板、开笔记，页面照常；换字体没有颜色可变，根元素上同样不留过渡', async () => {
  const context = await newContext({ viewport: { width: 1024, height: 768 } });
  const page = await open(context, course('sample'), SAMPLE);
  await page.getByRole('button', { name: '外观与设置' }).click();

  // 一口气连换三次：前两次的渐变被后一次接过去
  await page.evaluate(() => {
    for (const label of ['深色', '纸张', '深色']) {
      [...document.querySelectorAll('.zx-seg label')].find((item) => item.textContent === label).click();
    }
  });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.waitForFunction(() => document.documentElement.getAnimations().length === 0);
  assert.deepEqual(await paperOf(page), [21, 24, 29]);
  assert.equal(await page.evaluate(() => document.documentElement.style.transition), '');

  assert.deepEqual(await choose(page, '黑体'), [], '换字体：没有颜色在变');
  await page.waitForFunction(() => document.documentElement.dataset.font === 'sans');
  await page.waitForFunction(() => document.documentElement.style.transition === '');

  // 渐变还没放完就关面板、开笔记（WebKit 里用视图过渡做这件事，页面会崩）
  assert.equal((await choose(page, '浅色')).length, 30, '三十个颜色令牌都在渐变');
  await page.keyboard.press('Escape');
  await closed(page);
  await page.keyboard.press('n');
  await page.locator('textarea.zx-notes').pressSequentially('还活着');
  assert.equal(await page.locator('textarea.zx-notes').inputValue(), '还活着');
  await page.waitForFunction(() => document.documentElement.getAnimations().length === 0);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  assert.deepEqual(page.errors, []);
  await context.close();
});

/** 这道题现在带着什么动画：那句话的，和每个打了记号的选项的；各是 [名字, 时长]。 */
const feedback = (quiz) =>
  quiz.evaluate((el) => {
    const told = (style) => (style.animationName === 'none' ? null : [style.animationName, style.animationDuration]);
    return {
      status: told(getComputedStyle(el.querySelector('.zx-quiz-status'))),
      marks: [...el.querySelectorAll('li[data-mark] > .zx-opt')].map((option) =>
        told(getComputedStyle(option, '::after'))
      )
    };
  });

test('小测判定的反馈：答错了那句话左右晃两下，揭晓时对勾和叉弹出来，答对了那句话也弹一下；“减弱动态效果”时都只有一瞬', async () => {
  for (const [label, options, long, short] of [
    ['平常', {}, '0.42s', '0.22s'],
    ['减弱动态效果', { reducedMotion: 'reduce' }, '0.001s', '0.001s']
  ]) {
    const context = await newContext({ viewport: { width: 1024, height: 768 }, ...options });
    const page = await open(context, course('sample'), SAMPLE);
    const [single, multi] = [page.locator('.quiz').nth(0), page.locator('.quiz').nth(1)];
    const check = (quiz) => quiz.getByRole('button', { name: '检查答案' }).click();
    assert.deepEqual(await feedback(single), { status: null, marks: [] }, `${label}：没作答的时候什么都不动`);

    // 单选题没有提示：选错一次就揭晓
    await single.locator('.zx-opt').nth(1).click();
    await check(single);
    assert.deepEqual(
      await feedback(single),
      {
        status: ['zx-shake', long],
        marks: [
          ['zx-pop', short],
          ['zx-pop', short]
        ]
      },
      `${label}：答错，话晃两下，对勾和叉弹出来`
    );
    await single.getByRole('button', { name: '重做' }).click();
    assert.deepEqual(await feedback(single), { status: null, marks: [] }, `${label}：重做，回到原样`);

    // 多选题有提示：第一次选错只给提示，不揭晓
    await multi.locator('.zx-opt').nth(1).click();
    await check(multi);
    assert.deepEqual(await feedback(multi), { status: ['zx-shake', long], marks: [] }, `${label}：再想想`);
    await multi.locator('.zx-opt').nth(1).click();
    await multi.locator('.zx-opt').nth(0).click();
    await multi.locator('.zx-opt').nth(2).click();
    await check(multi);
    assert.deepEqual(
      await feedback(multi),
      {
        status: ['zx-pop', short],
        marks: [
          ['zx-pop', short],
          ['zx-pop', short]
        ]
      },
      `${label}：这次对了`
    );
    assert.deepEqual(page.errors, []);
    await context.close();
  }
});

test('“减弱动态效果”时，浮层、它背后的遮罩、术语的浮层、选项卡的指示条都只有一瞬', async () => {
  for (const [label, options, dialog, pop, slide] of [
    ['平常', {}, '0.22s', '0.12s', '0.22s'],
    ['减弱动态效果', { reducedMotion: 'reduce' }, '0.001s', '0.001s', '0.001s']
  ]) {
    const context = await newContext({ viewport: { width: 1024, height: 768 }, ...options });
    const page = await open(context, course('sample'), SAMPLE);
    // 指示条只在鼠标移上去或者键盘在里面的时候才滑：别的时候（比如窗口变宽）它直接就位
    const tablist = page.locator('.zx-tablist').first();
    await tablist.hover();
    const indicator = await tablist.evaluate((el) => getComputedStyle(el, '::after').transitionDuration.split(', ')[0]);
    await page.locator('dfn[role="button"]').first().click();
    const term = await page.locator('.zx-pop:popover-open').evaluate((el) => getComputedStyle(el).animationDuration);
    await page.keyboard.press('Escape');
    await page.keyboard.press('/');
    const found = await page.locator('dialog[open]').evaluate((el) => ({
      panel: getComputedStyle(el).animationDuration,
      veil: getComputedStyle(el, '::backdrop').animationDuration
    }));
    await context.close();
    assert.deepEqual(
      { ...found, term, indicator },
      { panel: dialog, veil: dialog, term: pop, indicator: slide },
      label
    );
  }
});

test('动效只由操作触发：页面打开之后不点不按，没有动画在放；往下滚，正文里也没有东西动起来', async () => {
  const context = await newContext();
  const moving = [];
  const pages = [
    [course('sample'), 'index.html'],
    ...lessonFiles(course('sample')).map((file) => [course('sample'), file]),
    ...lessonFiles(course('matrix')).map((file) => [course('matrix'), file])
  ];
  const running = (scope) =>
    document
      .getAnimations()
      .filter((animation) => animation.playState === 'running' && animation.effect.target.closest(scope))
      .map(
        (animation) =>
          `${animation.animationName ?? animation.transitionProperty} @ ${animation.effect.target.className}`
      );
  for (const [root, file] of pages) {
    const page = await open(context, root, file);
    for (const name of await page.evaluate(running, 'html')) moving.push(`${file} 打开时：${name}`);
    await page.mouse.wheel(0, 1600);
    await page.waitForFunction(() => scrollY > 0 || document.documentElement.scrollHeight <= innerHeight);
    for (const name of await page.evaluate(running, 'main, .zx-home')) moving.push(`${file} 滚动后：${name}`);
    await page.close();
  }
  await context.close();
  assert.deepEqual(moving, []);
});
