'use strict';
/* 可访问性：axe-core 扫描（三种主题、组件矩阵的每一页、打开着的浮层）、键盘走查，
 * 以及与之相关的几条：组合框、选项卡、键盘滚动、放大图、触屏上的点按目标。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { ENGINE, PACKED, course, lessonFiles, makeCourse, newContext, open } = require('./harness');

const AXE = require.resolve('axe-core/axe.min.js');
const THEMES = ['light', 'sepia', 'dark'];

/** 在当前页面上跑 axe，返回 "规则：说明（选择器 …）"。scope 是只扫描的那一块。 */
async function scan(page, scope = 'body') {
  if (!(await page.evaluate(() => Boolean(window.axe)))) await page.addScriptTag({ path: AXE });
  // 浮层是淡入的：等动画放完再量颜色
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState === 'finished'));
  const violations = await page.evaluate(async (selector) => {
    const result = await window.axe.run(selector, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
      // 契约规定卡片和步骤里的小标题用 h4，它们上面不一定有 h3
      rules: { 'heading-order': { enabled: false } }
    });
    return result.violations.map((violation) => ({
      id: violation.id,
      help: violation.help,
      nodes: violation.nodes.map(
        (node) => `${node.target.join(' ')} ${node.any.concat(node.all, node.none)[0]?.message ?? ''}`
      )
    }));
  }, scope);
  return violations.flatMap(({ id, help, nodes }) =>
    nodes.filter((node) => !mistakenSkipLink(id, node)).map((node) => `${id}：${help}（${node}）`)
  );
}

/* 单文件里所有链接都写成“#讲义/锚点”。axe 把页面开头那一串 # 链接都当成“跳到正文”一类的链接，去找同名的落点；
 * 滚出了视野的搜索结果、目录项于是被报成“落点不存在”。它们只是普通的链接。真正的“跳到正文”（.zx-skip）照查不误。 */
const mistakenSkipLink = (id, node) => PACKED && id === 'skip-link' && !node.startsWith('.zx-skip');

test('axe：示例课、微积分课、边界课的每一页没有可访问性问题', async () => {
  // 组件矩阵覆盖的是组件；这三门课是作者真写出来的讲义，公式、表头、选项都按正常写法排
  const context = await newContext();
  const found = [];
  for (const name of ['sample', 'calculus', 'edge']) {
    const root = course(name);
    for (const file of ['index.html', ...lessonFiles(root)]) {
      const page = await open(context, root, file);
      for (const issue of await scan(page)) found.push(`${name}/${file}  ${issue}`);
      await page.close();
    }
  }
  await context.close();
  assert.deepEqual([...new Set(found)], []);
});

/* 公式出现在“靠内容得名”的每一种地方：选项、任务、表头、表题、图题、折叠标题、链接、术语、小标题。 */
const FORMULA_NAMES = [
  '<section id="one">',
  '<h2>名字里的公式</h2>',
  '<h3><span class="math">a^2 + b^2</span></h3>',
  '<p>段落里的 <span class="math">x^2</span> 是正文。<a href="https://example.com"><span class="math">e^{i\\pi}</span></a>是链接，',
  '<dfn data-def="一个任意小的正数。"><span class="math">\\varepsilon</span></dfn>是术语。</p>',
  '<table>',
  '<caption><span class="math">f(x)</span> 的取值</caption>',
  '<thead><tr><th><span class="math">x</span></th><th>说明</th></tr></thead>',
  '<tbody><tr><td><span class="math">1</span></td><td>一</td></tr></tbody>',
  '</table>',
  '<figure>',
  '<svg viewBox="0 0 120 60" role="img" aria-label="一条斜线"><line class="s-accent" x1="10" y1="50" x2="110" y2="10"/></svg>',
  '<figcaption><span class="math">y = x</span> 的图像</figcaption>',
  '</figure>',
  '<details class="callout note"><summary><span class="math">n = 0</span></summary><p>展开之后的内容。</p></details>',
  '<ul class="tasks"><li><span class="math">\\sqrt{2}</span></li></ul>',
  '<div class="quiz" data-answer="a">',
  '<p>下面哪个是对的？</p>',
  '<ol>',
  '<li><span class="math">\\frac{1}{2}</span></li>',
  '<li><span class="math">\\lim_{x \\to 0} g(x)</span> 不存在<span class="note">注文里的 <span class="math">z</span> 照旧。</span></li>',
  '</ol>',
  '</div>',
  '</section>'
].join('\n');

test('公式当了选项、任务、表头、题注、折叠标题、链接、术语、小标题的名字：读屏软件读得到，名字是作者写的 LaTeX；正文和注文里的公式照旧', async () => {
  const root = makeCourse('formula-names', { 'lesson.html': FORMULA_NAMES });
  const context = await newContext();
  const page = await open(context, root, 'lesson.html');
  assert.deepEqual(await scan(page), []);

  const named = [
    ['radio', '\\frac{1}{2}'],
    ['radio', '\\lim_{x \\to 0} g(x) 不存在 旁注 1'],
    ['checkbox', '\\sqrt{2}'],
    ['columnheader', 'x'],
    ['table', '表 1-1 f(x) 的取值'],
    ['figure', '图 1-1 y = x 的图像'],
    ['link', 'e^{i\\pi}'],
    ['button', '\\varepsilon'],
    ['heading', 'a^2 + b^2']
  ];
  // 名字里可能有词连接符（U+2060，贴在序号前面让它不离开上一个字）：它只是排版记号，空格前允许它出现
  const exactly = (name) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '⁠? ?')}$`);
  const missing = [];
  for (const [role, name] of named) {
    if ((await page.getByRole(role, { name: exactly(name), exact: true }).count()) !== 1) {
      missing.push(`${role} ${name}`);
    }
  }
  const summary = await page.locator('summary').getAttribute('aria-label');
  const plain = await page.evaluate(() =>
    [...document.querySelectorAll('main p > .zx-math, main td > .zx-math, .zx-note .zx-math')].map(
      (formula) => `${formula.getAttribute('role')} ${Boolean(formula.querySelector('math'))}`
    )
  );
  await context.close();
  assert.deepEqual(missing, []);
  assert.equal(summary, null, '折叠标题的名字来自它里面的公式，自己不用另起名字');
  assert.deepEqual(plain, ['null true', 'null true', 'null true'], '正文、单元格、注文里的公式仍然交给 MathML');
});

test(
  '公式当了名字的地方，浏览器自己算出来的名字不是空的',
  { skip: ENGINE !== 'chromium' && '读浏览器的无障碍树要用 Chromium 的调试协议' },
  async () => {
    const root = makeCourse('formula-names', { 'lesson.html': FORMULA_NAMES });
    const context = await newContext();
    const page = await open(context, root, 'lesson.html');
    const session = await context.newCDPSession(page);
    await session.send('Accessibility.enable');
    const { nodes } = await session.send('Accessibility.getFullAXTree');
    const names = (role) =>
      nodes.filter((node) => !node.ignored && node.role?.value === role).map((node) => node.name?.value ?? '');
    const found = {
      radio: names('radio').map((name) => name.replace(/⁠/g, '')),
      checkbox: names('checkbox'),
      columnheader: names('columnheader'),
      link: names('link').filter((name) => name.includes('pi')),
      disclosure: names('DisclosureTriangle')
    };
    await context.close();
    assert.deepEqual(found, {
      radio: ['\\frac{1}{2}', '\\lim_{x \\to 0} g(x) 不存在 旁注 1'],
      checkbox: ['\\sqrt{2}'],
      columnheader: ['x', '说明'],
      link: ['e^{i\\pi}'],
      disclosure: ['n = 0']
    });
  }
);

for (const theme of THEMES) {
  test(`axe：${theme} 主题下，组件矩阵的每一页和首页没有可访问性问题`, async () => {
    const root = course('matrix');
    const context = await newContext();
    const found = [];
    for (const file of ['index.html', ...lessonFiles(root)]) {
      const page = await open(context, root, file, `?theme=${theme}`);
      for (const issue of await scan(page)) found.push(`${file}  ${issue}`);
      await page.close();
    }
    await context.close();
    assert.deepEqual([...new Set(found)], []);
  });

  test(`axe：${theme} 主题下，搜索、设置和笔记面板没有可访问性问题`, async () => {
    const context = await newContext({ viewport: { width: 1024, height: 768 } });
    const page = await open(context, course('sample'), '01-what-is-an-algorithm.html', `?theme=${theme}`);
    const found = [];
    const collect = async (label) => {
      for (const issue of await scan(page, 'dialog[open]')) found.push(`${label}  ${issue}`);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    };

    await page.keyboard.press('/');
    await page.locator('.zx-dialog--search input').fill('算法');
    await page.locator('.zx-result').first().waitFor();
    await page.keyboard.press('ArrowDown');
    await collect('搜索');

    await page.getByRole('button', { name: '外观与设置' }).click();
    await collect('设置');

    await page.keyboard.press('n');
    await page.keyboard.type('一条笔记');
    await collect('笔记');
    await context.close();
    assert.deepEqual([...new Set(found)], []);
  });
}

test('“跳到正文”：回车之后焦点进了正文，页面没有换地址；再按 Tab，落在正文里的控件上', async () => {
  const context = await newContext();
  for (const file of ['index.html', '03-quizzes.html']) {
    const page = await open(context, course('matrix'), file);
    const before = await page.evaluate(() => [location.href, ZHIXU.file, ZHIXU.anchor()]);
    const skip = page.locator('.zx-skip');
    await skip.focus(); // WebKit 默认不让 Tab 停在链接上，所以直接把焦点给它
    assert.ok((await skip.boundingBox()).y >= 0, '聚焦时它露出来');
    await page.keyboard.press('Enter');
    const landed = await page.evaluate(() => {
      const el = document.activeElement;
      return { main: el.id === 'zx-main', outline: getComputedStyle(el).outlineStyle };
    });
    assert.deepEqual(landed, { main: true, outline: 'none' }, `${file}：焦点在正文上，不画焦点框`);
    assert.deepEqual(
      await page.evaluate(() => [location.href, ZHIXU.file, ZHIXU.anchor()]),
      before,
      `${file}：地址没有变，还在原来那一页、原来那一处`
    );
    // WebKit 里 Tab 只停在按钮和输入框上，不停在链接上；首页的正文里只有链接，这一步在它上面没法看
    if (ENGINE !== 'webkit' || file !== 'index.html') {
      await page.keyboard.press('Tab');
      const next = await page.evaluate(() => Boolean(document.activeElement.closest('#zx-main')));
      assert.ok(next, `${file}：下一个 Tab 停在正文里面`);
    }
    assert.deepEqual(page.errors, []);
    await page.close();
  }
  await context.close();
});

test('B26 搜索是一个组合框：焦点留在输入框，读得出当前指着哪一条', async () => {
  const context = await newContext();
  const page = await open(context, course('sample'), 'index.html');
  await page.keyboard.press('/');
  const input = page.locator('.zx-dialog--search input');
  const state = () =>
    input.evaluate((el) => {
      const list = document.getElementById(el.getAttribute('aria-controls'));
      const active = document.getElementById(el.getAttribute('aria-activedescendant'));
      return [
        el.getAttribute('role'),
        list.getAttribute('role'),
        el.getAttribute('aria-expanded'),
        active ? [...list.querySelectorAll('[role="option"]')].indexOf(active) : null,
        active ? active.getAttribute('aria-selected') : null,
        document.activeElement === el
      ];
    });
  assert.deepEqual(await state(), ['combobox', 'listbox', 'false', null, null, true]);
  await input.fill('算法');
  assert.deepEqual(await state(), ['combobox', 'listbox', 'true', 0, 'true', true]);
  await page.keyboard.press('ArrowDown');
  assert.deepEqual(await state(), ['combobox', 'listbox', 'true', 1, 'true', true]);
  await input.fill('查无此词查无此词');
  assert.deepEqual(await state(), ['combobox', 'listbox', 'false', null, null, true]);
  await context.close();
});

test('B26 选项卡和它的面板互相指着', async () => {
  const context = await newContext();
  const page = await open(context, course('matrix'), '04-widgets.html');
  const pairs = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((tab) => {
      const panel = document.getElementById(tab.getAttribute('aria-controls'));
      return panel?.getAttribute('role') === 'tabpanel' && panel.getAttribute('aria-labelledby') === tab.id;
    })
  );
  assert.ok(pairs.length >= 4 && pairs.every(Boolean), `每个选项卡都应当和面板配成对：${pairs}`);
  await context.close();
});

test('B26 放不下的表格、代码和公式能用键盘横向滚动；放得下的不占 Tab 停靠点', async () => {
  const context = await newContext({ viewport: { width: 390, height: 844 } });
  const page = await open(context, course('edge'), '01-edge.html');
  const scrollers = await page.evaluate(() =>
    [...document.querySelectorAll('.zx-table, main pre, .katex-display, .cells')].map((el) => ({
      overflows: el.scrollWidth > el.clientWidth,
      focusable: el.tabIndex === 0
    }))
  );
  assert.ok(scrollers.filter((item) => item.overflows).length >= 3, '手机宽度下应当有好几处放不下的内容');
  assert.ok(
    scrollers.some((item) => !item.overflows),
    '也应当有放得下的'
  );
  assert.deepEqual(
    scrollers.filter((item) => item.overflows !== item.focusable),
    [],
    '放不下的才接受焦点'
  );

  await page.locator('.zx-table:has(#tbl-wide)').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.zx-table:has(#tbl-wide)').scrollLeft > 0);
  await context.close();
});

test('B26 书眉看不见的时候不能被 Tab 选中', async () => {
  const context = await newContext();
  const page = await open(context, course('sample'), '01-what-is-an-algorithm.html');
  const visibility = () => page.evaluate(() => getComputedStyle(document.querySelector('.zx-running')).visibility);
  assert.equal(await visibility(), 'hidden');
  await page.evaluate(() => document.querySelector('main > section').scrollIntoView());
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.zx-running')).visibility === 'visible');
  await context.close();
});

test('键盘走查：从头按 Tab，一路走到讲末，每一步都落在看得见的东西上', async () => {
  const context = await newContext();
  const page = await open(context, course('matrix'), '03-quizzes.html');
  const stops = [];
  // 走过最后一个控件之后，各个内核不一样：焦点回到 body、绕回第一个控件，或者停在原地。三种都算走到头了
  while (stops.length < 300) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      const done = el === document.body || el === window.__first || el === window.__previous;
      window.__previous = el;
      window.__first ??= el;
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const shown = box.width > 0 && box.height > 0 && style.visibility === 'visible' && Number(style.opacity) > 0;
      return {
        label: [el.tagName.toLowerCase(), ...el.classList].slice(0, 2).join('.'),
        // 单选和多选的输入框本身是透明的，样子画在旁边的标签上
        shown: shown || el.matches('.zx-opt input, .zx-task input'),
        atFoot: Boolean(el.closest('.zx-foot')), // 讲末：盖章按钮和上下讲（WebKit 默认不让 Tab 停在链接上）
        done
      };
    });
    if (stop.done) break;
    stops.push(stop);
  }
  assert.deepEqual(
    stops.filter((stop) => !stop.shown).map((stop) => stop.label),
    [],
    '这些停靠点看不见'
  );
  const distinct = [...new Set(stops.map((stop) => stop.label))];
  assert.ok(stops.at(-1).atFoot, `焦点应当一路走到讲末，没有在半路被困住：停在了 ${stops.at(-1).label}`);
  assert.ok(stops.length >= 15 && distinct.length >= 4, `走过 ${stops.length} 步：${distinct.join('、')}`);
  await context.close();
});

test('B31 比正文栏窄的小图不提供放大；大图放大后不超过原始像素，键盘也能放大', async () => {
  const context = await newContext();
  const page = await open(context, course('edge'), '01-edge.html');
  await page.waitForFunction(() => [...document.images].every((image) => image.complete));
  const figure = (id) =>
    page.evaluate((target) => {
      const el = document.getElementById(target);
      return [el.classList.contains('zx-zoom'), getComputedStyle(el.querySelector('.zx-zoom-btn')).display !== 'none'];
    }, id);
  assert.deepEqual(await figure('fig-small'), [false, false]);
  await page.locator('#fig-small img').click();
  assert.equal(await page.locator('.zx-dialog--lightbox[open]').count(), 0, '点小图不会打开放大的浮层');

  assert.deepEqual(await figure('fig-photo'), [true, true]);
  const shown = await page.locator('#fig-photo img').evaluate((image) => image.getBoundingClientRect().width);
  await page.locator('#fig-photo .zx-zoom-btn').focus();
  await page.keyboard.press('Enter');
  const zoomed = page.locator('.zx-dialog--lightbox[open] img');
  await zoomed.waitFor();
  const width = await zoomed.evaluate((image) => image.getBoundingClientRect().width);
  assert.ok(width > shown && width <= 1600, `放大后宽 ${width}，页面里宽 ${shown}，原图宽 1600`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.matches('#fig-photo .zx-zoom-btn'));
  await context.close();
});

test('B31 手机上放大就是看原始大小：原图比浮层宽，在浮层里拖着看', async () => {
  const context = await newContext({ viewport: { width: 390, height: 844 } });
  const page = await open(context, course('edge'), '01-edge.html');
  await page.waitForFunction(() => [...document.images].every((image) => image.complete));
  await page.locator('#fig-photo img').click();
  const found = await page.locator('.zx-dialog--lightbox[open] figure').evaluate((figure) => ({
    image: figure.querySelector('img').getBoundingClientRect().width,
    pans: figure.scrollWidth > figure.clientWidth,
    fits: figure.getBoundingClientRect().right <= innerWidth
  }));
  assert.deepEqual(found, { image: 1600, pans: true, fits: true });
  await context.close();
});

test('B32 触屏上复制按钮一直显示；图标按钮能点到的范围不小于 44 像素，文字按钮不矮于 44 像素', async (t) => {
  const context = await newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: ENGINE !== 'firefox'
  });
  const page = await open(context, course('matrix'), '03-quizzes.html');
  const touch = await page.evaluate(
    () => matchMedia('(pointer: coarse)').matches && matchMedia('(hover: none)').matches
  );
  if (!touch) {
    await context.close();
    t.skip('这个内核的模拟环境不报告触屏指针');
    return;
  }
  const found = await page.evaluate(() => {
    const tool = document.querySelector('.zx-header .zx-tool');
    const box = tool.getBoundingClientRect();
    const middle = box.top + box.height / 2;
    const around = [document.elementFromPoint(box.left - 3, middle), document.elementFromPoint(box.right + 3, middle)];
    const buttons = [...document.querySelectorAll('main .zx-btn')].filter((button) => button.offsetHeight > 0);
    return { reach: around.every((el) => el === tool), heights: buttons.map((button) => button.offsetHeight) };
  });
  assert.ok(found.reach, '图标按钮外沿 3 像素处也点得到它');
  assert.ok(found.heights.length > 0 && Math.min(...found.heights) >= 44, `文字按钮的高度：${found.heights}`);

  const code = await open(context, course('matrix'), '02-code-math.html');
  const opacity = await code
    .locator('.zx-copy')
    .first()
    .evaluate((button) => getComputedStyle(button).opacity);
  assert.equal(opacity, '1');
  await context.close();
});
