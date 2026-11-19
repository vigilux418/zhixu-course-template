'use strict';
/* 各个组件看起来对不对：字体、颜色、对齐、题型的区分。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { ENGINE, course, makeCourse, newContext, open } = require('./harness');

test('B01 代码块用的是内置的等宽字体，代码里的汉字不落到宋体', async () => {
  const context = await newContext();
  const page = await open(context, course('matrix'), '02-code-math.html');
  await page.evaluate(() => document.fonts.ready);
  const families = await page.evaluate(() =>
    [...document.querySelectorAll('main pre code')].map((code) =>
      getComputedStyle(code).fontFamily.split(',')[0].replace(/["']/g, '').trim()
    )
  );
  assert.ok(families.length > 5, '组件矩阵里应当有好几段代码');
  assert.deepEqual([...new Set(families)], ['Zhixu Mono']);

  if (ENGINE === 'chromium') {
    // 只有 Chromium 的调试协议能问到“实际画字用的是哪个字体”
    const client = await context.newCDPSession(page);
    await client.send('DOM.enable');
    await client.send('CSS.enable');
    const { root } = await client.send('DOM.getDocument');
    const { nodeIds } = await client.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: 'main pre code, main pre code *'
    });
    const used = new Map();
    for (const nodeId of nodeIds) {
      const { fonts } = await client.send('CSS.getPlatformFontsForNode', { nodeId });
      for (const font of fonts) used.set(font.familyName, (used.get(font.familyName) ?? 0) + font.glyphCount);
    }
    const names = [...used.keys()];
    assert.ok(names.includes('JetBrains Mono'), `西文应当由内置字体来画，实际用到的字体：${names.join('、')}`);
    assert.deepEqual(
      names.filter((name) => /SimSun|宋体/.test(name)),
      [],
      '代码里的汉字不应当落到宋体'
    );
  }
  await context.close();
});

test('B01 代码里的 <=、==、!=、-> 逐字显示，不连成一个符号', async () => {
  const context = await newContext();
  const page = await open(context, course('matrix'), '02-code-math.html');
  await page.evaluate(() => document.fonts.ready);
  // 把一组字符整个画一遍，再一个字一个字地画一遍：字体里有连字的话，两次画出来的不一样
  const joined = await page.evaluate(() => {
    const drawn = (parts) => {
      const canvas = document.createElement('canvas');
      canvas.width = 80;
      canvas.height = 40;
      const pen = canvas.getContext('2d');
      pen.font = '20px "Zhixu Mono"'; // 字宽是字号的 0.6 倍：20 像素时正好 12 像素，每个字都落在整像素上
      pen.textBaseline = 'top';
      let x = 4;
      for (const part of parts) {
        pen.fillText(part, x, 4);
        x += pen.measureText(part).width;
      }
      return canvas.toDataURL();
    };
    const groups = ['<=', '>=', '==', '!=', '->', '=>', '&&', '||', '//', '...'];
    return groups.filter((group) => drawn([group]) !== drawn([...group]));
  });
  await context.close();
  assert.deepEqual(joined, []);
});

test('B02 note 类型的提示卡和别的类型一样：没有多出来的括号，正文颜色相同', async () => {
  const context = await newContext();
  const page = await open(context, course('matrix'), '01-callouts.html');
  const found = await page.evaluate(() => {
    const bracketed = (el) =>
      ['::before', '::after'].some((pseudo) => /[（）]/.test(getComputedStyle(el, pseudo).content));
    return {
      colors: [...new Set([...document.querySelectorAll('.callout > p')].map((p) => getComputedStyle(p).color))],
      brackets: [...document.querySelectorAll('.callout')]
        .filter(bracketed)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`)
    };
  });
  await context.close();
  assert.deepEqual(found.brackets, []);
  assert.equal(found.colors.length, 1, `七种提示卡的正文应当是同一种颜色，实际有：${found.colors.join('、')}`);
});

test('B03 宽表格：表头不折行，滚到最右边表题仍然完整可见，表格的名称还是表题', async () => {
  const context = await newContext({ viewport: { width: 390, height: 844 } });
  const page = await open(context, course('edge'), '01-edge.html');
  const found = await page.evaluate(() => {
    const table = document.getElementById('tbl-wide');
    const box = table.parentElement;
    box.scrollLeft = box.scrollWidth;
    const frame = box.getBoundingClientRect();
    const caption = table.querySelector('caption').getBoundingClientRect();
    const lines = (cell) => {
      const range = document.createRange();
      range.selectNodeContents(cell);
      return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
    };
    const wrapped = [...table.querySelectorAll('th')].filter((th) => lines(th) > 1);
    return {
      scrolls: box.scrollWidth > box.clientWidth,
      captionInside: caption.left >= frame.left - 1 && caption.right <= frame.right + 1,
      wrappedHeaders: wrapped.map((th) => th.textContent)
    };
  });
  assert.deepEqual(found, { scrolls: true, captionInside: true, wrappedHeaders: [] });
  assert.equal(await page.getByRole('table', { name: /九列的宽表格/ }).count(), 1);
  await context.close();
});

test('数字列里的数不拆行：320 宽度下，“1 000 000”还在一行里', async () => {
  const context = await newContext({ viewport: { width: 320, height: 720 } });
  const page = await open(context, course('matrix'), '05-inline-refs.html');
  const split = await page.evaluate(() =>
    [...document.querySelectorAll('main td.num')]
      .filter((cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size > 1;
      })
      .map((cell) => cell.textContent)
  );
  assert.ok((await page.locator('main td.num').count()) > 0, '这一页有数字列');
  assert.deepEqual(split, []);
  await context.close();
});

test('树：子节点左边有竖线和横线，兄弟之间的竖线连得上；一组里最后一项的竖线只画到横线那里；手机上不横向溢出', async () => {
  for (const width of [1280, 320]) {
    const context = await newContext({ viewport: { width, height: 900 } });
    const page = await open(context, course('matrix'), '04-widgets.html');
    const found = await page.evaluate(() => {
      const tree = document.querySelector('ul.tree');
      const lines = (item) => {
        const [trunk, twig] = ['::before', '::after'].map((part) => getComputedStyle(item, part));
        return {
          text: item.firstChild.textContent.trim().slice(0, 6),
          trunk: trunk.content === 'none' ? null : Math.round(parseFloat(trunk.height)),
          twig: twig.content === 'none' ? null : parseFloat(twig.borderTopWidth),
          height: Math.round(item.getBoundingClientRect().height),
          last: !item.nextElementSibling
        };
      };
      const gaps = [...tree.querySelectorAll(':scope ul > li + li')].map((item) =>
        Math.abs(item.getBoundingClientRect().top - item.previousElementSibling.getBoundingClientRect().bottom)
      );
      return {
        roots: [...tree.children].map(lines),
        children: [...tree.querySelectorAll(':scope ul > li')].map(lines),
        widestGap: Math.max(...gaps),
        overflowing: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    });
    assert.deepEqual(
      found.roots.map((root) => [root.trunk, root.twig]),
      [
        [null, null],
        [null, null]
      ],
      '根没有连线'
    );
    assert.equal(found.children.length, 9);
    assert.ok(
      found.children.every((item) => item.twig === 1),
      '每个子节点都有一条横线'
    );
    for (const item of found.children) {
      if (item.last) assert.ok(item.trunk < 20, `${item.text} 是一组里的最后一项，竖线只到横线为止（${item.trunk}）`);
      else assert.equal(item.trunk, item.height, `${item.text} 的竖线和它一样高`);
    }
    assert.ok(found.widestGap < 0.5, `兄弟之间没有缝，竖线连得上（最大的缝 ${found.widestGap}）`);
    assert.equal(found.overflowing, false, `${width} 宽度下不横向溢出`);
    await context.close();
  }
});

test('音频放在图里：播放条占满这一栏，图题照常编号；打印稿里只留图题', async () => {
  const context = await newContext({ viewport: { width: 1024, height: 768 } });
  const page = await open(context, course('matrix'), '05-inline-refs.html');
  const found = await page.evaluate(() => {
    const figure = document.getElementById('fig-audio');
    const audio = figure.querySelector('audio');
    return {
      controls: audio.controls,
      fills: Math.abs(audio.getBoundingClientRect().width - figure.getBoundingClientRect().width) < 1,
      caption: figure.querySelector('figcaption').dataset.label,
      zoom: Boolean(figure.querySelector('.zx-zoom-btn'))
    };
  });
  assert.deepEqual(found, { controls: true, fills: true, caption: '图 5-4', zoom: false });

  await page.emulateMedia({ media: 'print' });
  const printed = await page.evaluate(() => {
    const figure = document.getElementById('fig-audio');
    return [
      getComputedStyle(figure.querySelector('audio')).display,
      figure.querySelector('figcaption').getClientRects().length > 0
    ];
  });
  assert.deepEqual(printed, ['none', true]);
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('B06 多选题看得出是多选：题头写明题型，选项标记是方的', async () => {
  const context = await newContext();
  const page = await open(context, course('matrix'), '03-quizzes.html');
  const found = await page.evaluate(() => {
    const marker = (id) => {
      const style = getComputedStyle(document.querySelector(`#${id} .zx-opt`), '::before');
      return parseFloat(style.borderRadius) >= parseFloat(style.width) / 2 ? '圆' : '方';
    };
    const quiz = (id) => document.getElementById(id);
    return {
      labels: ['quiz-single', 'quiz-multi', 'quiz-fill', 'quiz-self'].map((id) => quiz(id).dataset.label),
      singleMarker: marker('quiz-single'),
      multiMarker: marker('quiz-multi'),
      role: quiz('quiz-multi').getAttribute('role'),
      name: quiz('quiz-multi').getAttribute('aria-label'),
      listRole: quiz('quiz-multi').querySelector('ol').getAttribute('role')
    };
  });
  await context.close();
  assert.deepEqual(found.labels, ['小测 1 · 单选', '小测 3 · 多选', '小测 4 · 填空', '小测 5 · 自评']);
  assert.deepEqual([found.singleMarker, found.multiMarker], ['圆', '方'], '单选题的选项标记是圆的，多选题是方的');
  assert.deepEqual([found.role, found.name, found.listRole], ['group', '小测 3 · 多选', null]);
});

test('B09 带编号的长公式：编号完整显示，不压在公式上', async () => {
  for (const width of [390, 1440]) {
    const context = await newContext({ viewport: { width, height: 900 } });
    const page = await open(context, course('edge'), '01-edge.html');
    const found = await page.evaluate(() => {
      const box = document.getElementById('eq-long');
      const label = getComputedStyle(box, '::after');
      const formula = box.querySelector('.katex-display').getBoundingClientRect();
      const frame = box.getBoundingClientRect();
      return {
        labelWidth: parseFloat(label.width),
        labelLines: Math.round(parseFloat(label.height) / parseFloat(label.lineHeight)),
        gap: Math.round(frame.right - formula.right),
        scrolls: box.scrollWidth > box.clientWidth + 1
      };
    });
    await context.close();
    assert.equal(found.labelLines, 1, `${width} 宽度下编号应当排成一行`);
    assert.ok(found.gap >= found.labelWidth - 1, `${width} 宽度下公式不应当伸进编号的位置`);
    assert.equal(found.scrolls, false, `${width} 宽度下滚动的应当是公式，不是整个带编号的框`);
  }
});

/** 把一组元素按“顶边在同一条线上”分行，返回每行有几个。 */
const rowsOf = (page, selector) =>
  page.evaluate((query) => {
    const tops = [...document.querySelectorAll(query)].map((el) => Math.round(el.getBoundingClientRect().top));
    return [...new Set(tops)].map((top) => tops.filter((other) => other === top).length);
  }, selector);

test('B33 三张卡片排成一行，四张排成二乘二', async () => {
  const context = await newContext();
  const page = await open(context, course('matrix'), '04-widgets.html');
  const groups = await page.evaluate(() =>
    [...document.querySelectorAll('.cards')].map((cards, index) => {
      cards.dataset.probe = index;
      return cards.children.length;
    })
  );
  assert.deepEqual(groups, [2, 3, 4]);
  assert.deepEqual(await rowsOf(page, '.cards[data-probe="0"] > div'), [2]);
  assert.deepEqual(await rowsOf(page, '.cards[data-probe="1"] > div'), [3]);
  assert.deepEqual(await rowsOf(page, '.cards[data-probe="2"] > div'), [2, 2]);
  await context.close();
});

test('B33 流程折行之后，箭头留在上一行的末尾，不落到下一行的行首', async () => {
  const context = await newContext({ viewport: { width: 390, height: 844 } });
  const page = await open(context, course('matrix'), '04-widgets.html');
  const flows = await page.evaluate(() =>
    [...document.querySelectorAll('.flow')].map((flow) => {
      const edge = flow.getBoundingClientRect();
      const items = [...flow.children];
      const rows = new Set(items.map((item) => Math.round(item.getBoundingClientRect().top))).size;
      const arrows = items.slice(0, -1).map((item) => {
        const box = item.getBoundingClientRect();
        const arrow = getComputedStyle(item, '::after');
        const left = box.left + parseFloat(arrow.left);
        return { afterItem: left >= box.right, inside: left + parseFloat(arrow.width) <= edge.right + 1 };
      });
      const leading = items.filter((item) => getComputedStyle(item, '::before').content !== 'none').length;
      return { rows, arrows, leading };
    })
  );
  assert.ok(
    flows.some((flow) => flow.rows > 1),
    '这个宽度下应当有折成几行的流程'
  );
  for (const flow of flows) {
    assert.equal(flow.leading, 0, '没有画在格子前面的箭头');
    assert.ok(
      flow.arrows.every((arrow) => arrow.afterItem && arrow.inside),
      '每个箭头都紧跟在它那一格后面，并且不伸出容器'
    );
  }
  await context.close();
});

test('B33 时间线最后一项下面没有多出来的线', async () => {
  const context = await newContext();
  const page = await open(context, course('matrix'), '04-widgets.html');
  const found = await page.evaluate(() => {
    const timeline = document.querySelector('.timeline');
    const items = [...timeline.children];
    const line = (item) => getComputedStyle(item, '::after');
    return {
      border: parseFloat(getComputedStyle(timeline).borderLeftWidth),
      lines: items.map((item) => line(item).content !== 'none'),
      // 第一项的线正好接到第二项的圆点
      reach: items[0].getBoundingClientRect().bottom - parseFloat(line(items[0]).bottom),
      nextDot: items[1].getBoundingClientRect().top + parseFloat(getComputedStyle(items[1], '::before').top)
    };
  });
  assert.equal(found.border, 0, '线不再画在整个列表的左边');
  assert.deepEqual(found.lines, [true, true, false]);
  assert.ok(Math.abs(found.reach - found.nextDot) <= 1, `线的末端 ${found.reach} 应当接到下一个圆点 ${found.nextDot}`);
  await context.close();
});

test('B33 填空题的打印稿上有留给读者写答案的横线', async () => {
  const context = await newContext();
  const page = await open(context, course('matrix'), '03-quizzes.html');
  const blank = () =>
    page.evaluate(() => {
      const style = getComputedStyle(document.querySelector('#quiz-fill'), '::after');
      return style.content === 'none'
        ? null
        : [parseFloat(style.width) > 150, parseFloat(style.borderBottomWidth) >= 1];
    });
  assert.equal(await blank(), null, '屏幕上没有这条线');
  await page.emulateMedia({ media: 'print' });
  assert.deepEqual(await blank(), [true, true]);
  await context.close();
});

test('B21 并排的图顶端对齐，图题长短不一也不会错开', async () => {
  const context = await newContext();
  const page = await open(context, course('edge'), '01-edge.html');
  const tops = await page.evaluate(() =>
    [...document.querySelectorAll('.figures')].map((group) => {
      const media = [...group.querySelectorAll(':scope > figure > :is(svg, img)')];
      const captions = new Set([...group.querySelectorAll('figcaption')].map((caption) => caption.offsetHeight));
      return { tops: media.map((el) => Math.round(el.getBoundingClientRect().top)), captionHeights: captions.size };
    })
  );
  assert.ok(tops.length > 0);
  for (const group of tops) assert.equal(new Set(group.tops).size, 1, `同一排的图顶边应当对齐：${group.tops}`);
  assert.ok(
    tops.some((group) => group.captionHeights > 1),
    '压测课里应当有图题长短不一的一组'
  );
  await context.close();
});

test(
  'B27 以前缺的字现在由内置字体来画：正文、楷体里的常用字和人名用字，等宽字体里的希腊字母和方块元素',
  { skip: ENGINE !== 'chromium' && '只有 Chromium 的调试协议能问到“实际画字用的是哪个字体”' },
  async () => {
    const root = makeCourse('glyphs', {
      'lesson.html': [
        '<section id="part">',
        '<h2>小节</h2>',
        '<p id="serif">啰嗦瞭望蹚水欸乃喆堃祎玥珺璟</p>',
        '<blockquote><p id="kai">啰嗦瞭望蹚水欸乃喆堃祎玥珺璟</p></blockquote>',
        '<pre data-lang="text"><code id="mono">αβγδ ΔΣΩ ▁▂▃▄▅▆▇█ ░▒▓</code></pre>',
        '</section>'
      ].join('\n')
    });
    const context = await newContext();
    const page = await open(context, root, 'lesson.html');
    await page.evaluate(() => document.fonts.ready);
    const client = await context.newCDPSession(page);
    await client.send('DOM.enable');
    await client.send('CSS.enable');
    const { root: documentNode } = await client.send('DOM.getDocument');
    const used = {};
    for (const id of ['serif', 'kai', 'mono']) {
      const { nodeId } = await client.send('DOM.querySelector', { nodeId: documentNode.nodeId, selector: '#' + id });
      const { fonts } = await client.send('CSS.getPlatformFontsForNode', { nodeId });
      used[id] = fonts.map((font) => font.familyName + (font.isCustomFont ? '' : '（系统字体）')).sort();
    }
    // 每一段文字都只用了一款字体，而且是内置的那一款（正文字体内部的名字带着它默认的字重名）
    assert.deepEqual(used, {
      serif: ['Noto Serif SC ExtraLight'],
      kai: ['LXGW WenKai Screen'],
      mono: ['JetBrains Mono']
    });
    await context.close();
  }
);

test('正文的字重：普通屏幕上的浅底主题加重到 460；深色主题、两倍屏、读者换成黑体时都是 400；界面的黑体不跟着加重', async () => {
  // 正文、讲头、演示的按钮栏在第 2 讲；图里的文字在第 3 讲
  const PROBES = [
    ['02-binary-search.html', ['main > section p', '.zx-meta', '.zx-stepper-bar']],
    ['03-time-complexity.html', ['main svg text']]
  ];
  const weights = async (options, suffix, prefs) => {
    const context = await newContext(options);
    if (prefs) {
      await context.addInitScript((value) => localStorage.setItem('zhixu:prefs', JSON.stringify(value)), prefs);
    }
    const found = [];
    for (const [file, selectors] of PROBES) {
      const page = await open(context, course('sample'), file, suffix);
      found.push(
        ...(await page.evaluate(
          (list) => list.map((selector) => getComputedStyle(document.querySelector(selector)).fontWeight),
          selectors
        ))
      );
    }
    await context.close();
    return found;
  };
  assert.deepEqual(await weights(null, '?theme=light'), ['460', '400', '400', '400']);
  assert.deepEqual(await weights(null, '?theme=sepia'), ['460', '400', '400', '400']);
  assert.deepEqual(await weights(null, '?theme=dark'), ['400', '400', '400', '400']);
  assert.deepEqual(await weights({ deviceScaleFactor: 2 }, '?theme=light'), ['400', '400', '400', '400']);
  assert.deepEqual(await weights(null, '?theme=light', { font: 'sans' }), ['400', '400', '400', '400']);
});
