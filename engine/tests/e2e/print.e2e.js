'use strict';
/* 打印：不印底色时信息不丢；折叠的内容全部展开，打印后原样恢复；页眉和页码；浮层开着时打印稿不变。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const { ENGINE, course, scratch, newContext, open, lessonFiles } = require('./harness');

/** 用 PyMuPDF 读出 PDF 里的文字（维护测试需要的环境见 engine/README.md）。 */
function pdfText(file) {
  const script = 'import sys, pymupdf\nprint("".join(page.get_text() for page in pymupdf.open(sys.argv[1])))';
  const result = spawnSync('python', ['-X', 'utf8', '-c', script, file], { encoding: 'utf8' });
  assert.equal(result.status, 0, `读不出 PDF 的文字（需要 Python 和 PyMuPDF）：${result.stderr}`);
  return result.stdout.replace(/\s+/g, '');
}

test('B08 不印底色时信息不丢：焦点格是粗框深字，标亮变成下划线，图标照印', async () => {
  const context = await newContext();
  const page = await open(context, course('matrix'), '04-widgets.html');
  await page.emulateMedia({ media: 'print' });
  const found = await page.evaluate(() => {
    const channel = (value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    const luminance = (color) => {
      const [r, g, b] = color.match(/[\d.]+/g).map((part) => channel(Number(part) / 255));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const hit = getComputedStyle(document.querySelector('.cells > .hit'));
    return {
      hitBackground: hit.backgroundImage === 'none' && /rgba\(0, 0, 0, 0\)|transparent/.test(hit.backgroundColor),
      hitContrast: 1.05 / (luminance(hit.color) + 0.05), // 字与白纸的对比度
      hitBorder: parseFloat(hit.borderTopWidth),
      arrow: getComputedStyle(document.querySelector('.flow > li'), '::after').printColorAdjust,
      goal: getComputedStyle(document.querySelector('.goals > li'), '::before').printColorAdjust
    };
  });
  assert.ok(found.hitBackground, '焦点格不靠底色');
  assert.ok(found.hitContrast >= 4.5, `焦点格里的字与白纸的对比度是 ${found.hitContrast.toFixed(2)}`);
  assert.ok(found.hitBorder >= 2, '焦点格用粗框表示');
  assert.deepEqual([found.arrow, found.goal], ['exact', 'exact'], '用底色画的图标要求照印');

  const refs = await open(context, course('matrix'), '05-inline-refs.html');
  await refs.emulateMedia({ media: 'print' });
  const mark = await refs.evaluate(() => {
    const style = getComputedStyle(document.querySelector('main mark'));
    return [style.backgroundImage, style.textDecorationLine];
  });
  assert.deepEqual(mark, ['none', 'underline']);
  await context.close();
});

test('B08 打印稿里没有只靠底色画出来的东西：没有字、没有边框、只有底色的，都要求照印（不勾“背景图形”也印得出来）', async () => {
  const context = await newContext();
  const found = [];
  for (const name of ['matrix', 'edge', 'sample']) {
    const root = course(name);
    for (const file of ['index.html', ...lessonFiles(root)]) {
      const page = await open(context, root, file);
      if (file === 'index.html') {
        // 首页上“读过”的小印要有读过的讲次才会出现：先记上读完了第一讲
        await page.evaluate(() => {
          const record = { done: { [window.ZHIXU_COURSE.units[0].lessons[0]]: '2026-11-16' } };
          localStorage.setItem(`zhixu:course:${window.ZHIXU_COURSE.id}`, JSON.stringify(record));
        });
        await page.reload();
        await page.waitForSelector('html.zx-ready');
      }
      await page.emulateMedia({ media: 'print' });
      const lost = await page.evaluate(() => {
        const out = new Set();
        const clear = (color) => /rgba\(0, 0, 0, 0\)|transparent/.test(color);
        for (const el of document.querySelectorAll('main *, .zx-home *')) {
          if (!el.checkVisibility({ visibilityProperty: true })) continue;
          for (const pseudo of [null, '::before', '::after']) {
            const style = getComputedStyle(el, pseudo);
            if (pseudo && /^(none|normal)$/.test(style.content)) continue;
            if (style.backgroundImage === 'none' && clear(style.backgroundColor)) continue;
            if (style.printColorAdjust === 'exact') continue;
            const bordered = ['Top', 'Right', 'Bottom', 'Left'].some(
              (side) => parseFloat(style[`border${side}Width`]) > 0
            );
            const text = pseudo ? style.content.replace(/["']/g, '').trim() : el.textContent.trim();
            if (!bordered && !text)
              out.add(`<${el.tagName.toLowerCase()} class="${el.getAttribute('class') ?? ''}">${pseudo ?? ''}`);
          }
        }
        return [...out];
      });
      for (const item of lost) found.push(`${name}/${file}  ${item}`);
      await page.close();
    }
  }
  await context.close();
  assert.deepEqual(found, []);
});

const GROUPS = [
  ['01-edge.html', 'pair', '第一项开着'],
  ['02-more.html', 'other', '第二项开着']
];

for (const [file, name, label] of GROUPS) {
  test(`B16 打印时同名手风琴全部展开，打印后原样恢复（${label}）`, async () => {
    const context = await newContext();
    const page = await open(context, course('edge'), file);
    const snapshot = () =>
      page.evaluate(
        (group) =>
          [...document.querySelectorAll('details')].map(
            (details) =>
              `${details.getAttribute('name') ?? '-'}:${details.open}:${details.matches(`[name="${group}"]`)}`
          ),
        name
      );
    const before = await snapshot();
    await page.evaluate(() => dispatchEvent(new Event('beforeprint')));
    const during = await page.evaluate(() =>
      [...document.querySelectorAll('details')].every((details) => details.open)
    );
    await page.evaluate(() => dispatchEvent(new Event('afterprint')));
    assert.ok(during, '打印时每个折叠块都应当展开');
    assert.deepEqual(await snapshot(), before, '打印后开合和分组都应当和打印前一样');
    assert.ok(
      before.some((item) => item.endsWith(':true:true')) && before.some((item) => item.endsWith(':false:true')),
      '这一组里应当有开有合'
    );
    await context.close();
  });
}

test(
  'B16 打印稿里同名手风琴的每一项正文都在',
  { skip: ENGINE !== 'chromium' && '只有 Chromium 能导出 PDF' },
  async () => {
    const context = await newContext();
    const out = scratch('print');
    const expected = {
      '01-edge.html': ['手风琴甲的正文', '手风琴乙的正文'],
      '02-more.html': ['手风琴丙的正文', '手风琴丁的正文']
    };
    for (const [file, texts] of Object.entries(expected)) {
      const page = await open(context, course('edge'), file);
      const pdf = path.join(out, file.replace('.html', '.pdf'));
      await page.pdf({ path: pdf, format: 'A4' });
      const text = pdfText(pdf);
      for (const item of texts) assert.ok(text.includes(item), `${file} 的打印稿里应当有“${item}”`);
      await page.close();
    }
    await context.close();
  }
);

/** PDF 每一页的文字（去掉空白）。 */
function pdfPages(file) {
  const script =
    'import sys, json, pymupdf\nprint(json.dumps([page.get_text() for page in pymupdf.open(sys.argv[1])]))';
  const result = spawnSync('python', ['-X', 'utf8', '-c', script, file], { encoding: 'utf8' });
  assert.equal(result.status, 0, `读不出 PDF 的文字（需要 Python 和 PyMuPDF）：${result.stderr}`);
  return JSON.parse(result.stdout).map((text) => text.replace(/\s+/g, ''));
}

test(
  '打印稿的页眉和页码：每页页脚印“第几页 / 共几页”；第二页起页眉印课程名和这一讲的名字，第一页有讲头，不印',
  { skip: ENGINE !== 'chromium' && '只有 Chromium 能导出 PDF，页边框也只有它认得' },
  async () => {
    const context = await newContext();
    const out = scratch('page-box');
    const print = async (root, file) => {
      const page = await open(context, root, file);
      const pdf = path.join(out, file.replace('.html', '.pdf'));
      await page.pdf({ path: pdf, format: 'A4' });
      await page.close();
      return pdfPages(pdf);
    };

    const lesson = await print(course('sample'), '02-binary-search.html');
    assert.ok(lesson.length >= 3, `这一讲印出来有好几页（${lesson.length} 页）`);
    lesson.forEach((text, index) => {
      const number = `${index + 1}/${lesson.length}`;
      assert.ok(text.includes(number), `第 ${index + 1} 页的页脚有 ${number}`);
      const headed = text.includes('算法与问题求解') && text.includes('第2讲二分查找');
      assert.equal(headed, index > 0, `第 ${index + 1} 页${index > 0 ? '有' : '没有'}页眉`);
    });

    // 首页没有“这一讲”：页眉只有课程名
    const home = await print(course('long'), 'index.html');
    assert.ok(home.length >= 2);
    assert.ok(home[1].includes('一门有二十六讲的长课程') && home[1].includes(`2/${home.length}`));
    assert.ok(!home[1].includes('undefined') && !home[1].includes('null'));
    await context.close();
  }
);

/** PDF 里每一页每个词的位置（四舍五入到点）和文字。 */
function pdfWords(file) {
  const script =
    'import sys, json, pymupdf\nprint(json.dumps([[[round(w[0]), round(w[1]), w[4]] for w in page.get_text("words")] for page in pymupdf.open(sys.argv[1])]))';
  const result = spawnSync('python', ['-X', 'utf8', '-c', script, file], { encoding: 'utf8' });
  assert.equal(result.status, 0, `读不出 PDF 的文字（需要 Python 和 PyMuPDF）：${result.stderr}`);
  return JSON.parse(result.stdout);
}

test(
  '搜索或笔记开着的时候打印：打印稿和平时一样，每一页每个词都在原来的位置',
  { skip: ENGINE !== 'chromium' && '只有 Chromium 能导出 PDF' },
  async () => {
    const context = await newContext({ viewport: { width: 1024, height: 800 } });
    const page = await open(context, course('sample'), '02-binary-search.html');
    const out = scratch('print-modal');
    const words = async (name) => {
      const pdf = path.join(out, `${name}.pdf`);
      await page.pdf({ path: pdf, format: 'A4' });
      return pdfWords(pdf);
    };
    const plain = await words('plain');
    assert.ok(plain.length > 3 && plain[0].length > 20, '这一讲的打印稿有好几页');
    for (const [name, key] of [
      ['search', '/'],
      ['notes', 'n']
    ]) {
      await page.keyboard.press(key);
      await page.locator('dialog:modal').waitFor();
      assert.deepEqual(await words(name), plain, `${name} 开着的时候`);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('dialog:modal'));
    }
    await context.close();
  }
);

test('打印稿上旁注回到行内的括注，伸进页边的宽内容收回正文栏', async () => {
  const context = await newContext();
  const page = await open(context, course('edge'), '01-edge.html');
  const wide = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.zx-wide')].map((block) =>
        Math.round(block.getBoundingClientRect().right - block.parentElement.getBoundingClientRect().right)
      )
    );
  assert.ok((await wide()).length > 0 && (await wide()).every((over) => over > 0), '屏幕上有伸进页边的宽内容');

  await page.emulateMedia({ media: 'print' });
  assert.ok(
    (await wide()).every((over) => over <= 0),
    '打印时都收回来了'
  );
  const notes = await page.evaluate(() =>
    [...document.querySelectorAll('.zx-note')].map((note) => {
      const style = getComputedStyle(note);
      const body = getComputedStyle(note.closest('p, li, td, summary'));
      return {
        inline: style.display === 'inline' && style.position === 'static' && style.float === 'none',
        plain:
          style.borderTopWidth === '0px' && style.boxShadow === 'none' && style.backgroundColor === 'rgba(0, 0, 0, 0)',
        smaller: parseFloat(style.fontSize) < parseFloat(body.fontSize),
        brackets: [getComputedStyle(note, '::before').content, getComputedStyle(note, '::after').content].join('')
      };
    })
  );
  assert.ok(notes.length > 3, '压测课里有好几条旁注，页边里的、容器里的都有');
  // 伪元素的 content 读出来带着引号
  const expected = { inline: true, plain: true, smaller: true, brackets: '"（注：""）"' };
  for (const note of notes) assert.deepEqual(note, expected);
  await context.close();
});
