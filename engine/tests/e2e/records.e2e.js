'use strict';
/* 学习记录：备份与恢复、不同课程互不干扰、同一讲开在几个标签页里、浏览器不许存储、题目的键。
 * 这几条出了错，读者丢的是自己的进度和笔记，所以每一条都对着存储里的原始内容来验。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { PACKED, REPO, makeCourse, scratch, pack, newContext, open } = require('./harness');

const LESSON = 'lesson.html';
const section = (content) => ['<section id="part">', '<h2>小节</h2>', content, '</section>'].join('\n');
const PLAIN = { [LESSON]: section('<p>正文。</p>') };

/** 存储里这门课的学习记录，原始文本。 */
const stored = (page, id) => page.evaluate((key) => localStorage.getItem(key), `zhixu:course:${id}`);
const storedRecord = async (page, id) => JSON.parse(await stored(page, id));

const press = (page, label) => page.getByRole('button', { name: label, exact: true }).click();

/** 打开笔记面板，返回文本框。 */
async function openNotes(page) {
  await press(page, '本讲笔记');
  const area = page.locator('textarea.zx-notes');
  await area.waitFor();
  return area;
}

const notesStatus = (page) => page.locator('.zx-dialog--sheet [role="status"]').textContent();
const closePanel = (page) => page.keyboard.press('Escape');
const waitForValue = (page, value) =>
  page.waitForFunction((text) => document.querySelector('textarea.zx-notes').value === text, value);

/**
 * 做一件会让这一页按存储里最新的记录重搭的事，等它搭好。文件夹里是整页重新载入；
 * 单文件里是在页面里重搭（不重读文件，见 packed.e2e.js）。两种情形下旧的那份正文都不在了，就认这一点。
 */
async function rebuilt(page, action) {
  await page.evaluate(() => (document.querySelector('main, .zx-home').dataset.old = ''));
  await action();
  await page.waitForFunction(
    () => !document.querySelector('[data-old]') && document.documentElement.classList.contains('zx-ready')
  );
}

/** 选一个文件“从备份恢复”，返回状态栏里给读者看的那句话。 */
async function restore(page, text) {
  await page.evaluate(() => (document.querySelector('.zx-status').textContent = ''));
  await page.setInputFiles('input[type="file"]', {
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(text)
  });
  await page.waitForFunction(() => document.querySelector('.zx-status').textContent !== '');
  return page.locator('.zx-status').textContent();
}

const envelope = (course, record, format = 1) =>
  JSON.stringify({ app: 'zhixu', format, course, exported: '2026-11-12', record });

/** 点“导出备份”，返回下载到的文件内容。 */
async function exportBackup(page) {
  const [download] = await Promise.all([page.waitForEvent('download'), press(page, '导出备份')]);
  const file = path.join(scratch('backup'), 'record.json');
  await download.saveAs(file);
  return fs.readFileSync(file, 'utf8');
}

test('B37 坏的备份文件和写入失败，都不改动原有记录的一个字节', async () => {
  const root = makeCourse('keep', PLAIN);
  const context = await newContext();
  const page = await open(context, root, LESSON);
  page.on('dialog', (dialog) => dialog.accept());
  const area = await openNotes(page);
  await area.pressSequentially('原有的笔记。');
  await closePanel(page);
  const before = await stored(page, 'keep');
  assert.equal(JSON.parse(before).notes[LESSON], '原有的笔记。');

  await press(page, '外观与设置');
  const bad = [
    ['record 是 null', envelope('keep', null), /不完整或已损坏/],
    ['notes 是 null', envelope('keep', { notes: null }), /不完整或已损坏/],
    ['笔记不是文字', envelope('keep', { notes: { [LESSON]: 42 } }), /不完整或已损坏/],
    ['有不认识的字段', envelope('keep', { notes: {}, extra: 1 }), /不完整或已损坏/],
    ['不是 JSON', '{oops', /不是知序的备份文件/],
    ['别的程序的文件', JSON.stringify({ record: {} }), /不是知序的备份文件/],
    ['格式版本不对', envelope('keep', {}, 2), /格式版本/],
    ['另一门课的备份', envelope('other', {}), /另一门课/]
  ];
  for (const [label, text, expected] of bad) {
    assert.match(await restore(page, text), expected, label);
    assert.equal(await stored(page, 'keep'), before, label);
  }

  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('存储已满', 'QuotaExceededError');
    };
  });
  assert.match(await restore(page, envelope('keep', { notes: { [LESSON]: '备份里的笔记。' } })), /写入失败/);
  assert.equal(await stored(page, 'keep'), before, '写入失败');
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('B37 真实导出的备份能在空环境里恢复；恢复前说明会替换什么，可以取消；空备份经确认后清空', async () => {
  const root = makeCourse('travel', PLAIN);
  const source = await newContext();
  const origin = await open(source, root, LESSON);
  await (await openNotes(origin)).pressSequentially('带走的笔记。');
  await closePanel(origin);
  await origin.locator('.zx-seal-slot').click();
  await press(origin, '外观与设置');
  const backup = await exportBackup(origin);
  assert.deepEqual(
    [JSON.parse(backup).app, JSON.parse(backup).format, JSON.parse(backup).course],
    ['zhixu', 1, 'travel']
  );
  await source.close();

  const context = await newContext();
  const page = await open(context, root, LESSON);
  const questions = [];
  let answer = false;
  page.on('dialog', (dialog) => {
    questions.push(dialog.message());
    return answer ? dialog.accept() : dialog.dismiss();
  });
  await press(page, '外观与设置');
  const empty = await stored(page, 'travel');
  assert.match(await restore(page, backup), /没有恢复/);
  assert.equal(await stored(page, 'travel'), empty, '取消之后什么也不改');
  assert.match(questions[0], /已读 1 讲、笔记 1 条、小测记录 0 条/);
  assert.match(questions[0], /替换这门课现在的学习记录（已读 0 讲、笔记 0 条、小测记录 0 条）/);

  answer = true;
  await rebuilt(page, () =>
    page.setInputFiles('input[type="file"]', {
      name: 'b.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backup)
    })
  );
  const restored = await storedRecord(page, 'travel');
  assert.equal(restored.notes[LESSON], '带走的笔记。');
  assert.deepEqual(Object.keys(restored.done), [LESSON]);
  assert.equal(await page.locator('.zx-seal-slot').getAttribute('aria-pressed'), 'true');

  await press(page, '外观与设置');
  await rebuilt(page, () =>
    page.setInputFiles('input[type="file"]', {
      name: 'e.json',
      mimeType: 'application/json',
      buffer: Buffer.from(envelope('travel', {}))
    })
  );
  const cleared = await storedRecord(page, 'travel');
  assert.deepEqual([cleared.notes, cleared.done], [{}, {}]);
  assert.deepEqual(page.errors, []);
  await context.close();
});

/** 用母版的工具新建一门课，返回 { root, id }。 */
function init(parent, ...flags) {
  const root = path.join(parent, '数据结构');
  const made = spawnSync('node', [path.join(REPO, 'template', 'tools', 'zx.js'), 'init', root, '数据结构', ...flags], {
    encoding: 'utf8'
  });
  assert.equal(made.status, 0, made.stdout + made.stderr);
  if (PACKED) pack(root);
  return { root, id: /^课程标识：(\S+?)（/m.exec(made.stdout)[1] };
}

const FIRST = '01-first-lesson.html';

test('B38 两个同名的中文目录里各建一门课：笔记、备份、清除记录互不影响', async () => {
  const first = init(scratch('init'));
  const second = init(scratch('init'));
  assert.notEqual(first.id, second.id);

  const context = await newContext();
  const one = await open(context, first.root, FIRST);
  await (await openNotes(one)).pressSequentially('甲课的笔记。');
  await closePanel(one);

  const two = await open(context, second.root, FIRST);
  two.on('dialog', (dialog) => dialog.accept());
  const area = await openNotes(two);
  assert.equal(await area.inputValue(), '', '乙课的笔记本应当是空的');
  await area.pressSequentially('乙课的笔记。');
  await closePanel(two);
  assert.equal((await storedRecord(one, first.id)).notes[FIRST], '甲课的笔记。');
  assert.equal((await storedRecord(two, second.id)).notes[FIRST], '乙课的笔记。');

  await press(one, '外观与设置');
  const backup = await exportBackup(one);
  await press(two, '外观与设置');
  const before = await stored(two, second.id);
  assert.match(await restore(two, backup), /另一门课/);
  assert.equal(await stored(two, second.id), before);

  await rebuilt(two, () => press(two, '清除记录'));
  assert.equal((await storedRecord(two, second.id)).notes[FIRST], undefined, '乙课的记录清掉了');
  assert.equal((await storedRecord(one, first.id)).notes[FIRST], '甲课的笔记。', '甲课的记录还在');
  await context.close();
});

test('B38 课程标识恰好是 prefs：学习记录和外观设置各存各的', async () => {
  const { root, id } = init(scratch('init'), '--id', 'prefs');
  assert.equal(id, 'prefs');
  const context = await newContext();
  const page = await open(context, root, FIRST);
  await press(page, '外观与设置');
  await page.getByLabel('深色').check();
  await closePanel(page);
  await (await openNotes(page)).pressSequentially('这门课叫 prefs。');
  await page.reload();
  await page.waitForSelector('html.zx-ready');
  const found = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    prefs: JSON.parse(localStorage.getItem('zhixu:prefs')),
    record: JSON.parse(localStorage.getItem('zhixu:course:prefs'))
  }));
  assert.equal(found.theme, 'dark');
  assert.equal(found.prefs.theme, 'dark');
  assert.equal(found.prefs.notes, undefined);
  assert.equal(found.record.notes[FIRST], '这门课叫 prefs。');
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('B39 同一讲开在两个标签页里交替写笔记：两边写的内容都留下', async () => {
  const root = makeCourse('tabs', PLAIN);
  const context = await newContext();
  const one = await open(context, root, LESSON);
  const two = await open(context, root, LESSON);
  const first = await openNotes(one);
  const second = await openNotes(two);

  await first.pressSequentially('甲页先写。');
  await waitForValue(two, '甲页先写。');
  await second.pressSequentially('乙页接着写。');
  await waitForValue(one, '甲页先写。乙页接着写。');
  await first.pressSequentially('甲页再补一句。');
  await waitForValue(two, '甲页先写。乙页接着写。甲页再补一句。');

  assert.equal((await storedRecord(one, 'tabs')).notes[LESSON], '甲页先写。乙页接着写。甲页再补一句。');
  assert.deepEqual([await notesStatus(one), await notesStatus(two)], ['已保存', '']);
  await context.close();
});

test('B39 通知晚到：别处已经改了笔记，这一页接着输入不会盖掉它，草稿留着，可以载入最新内容', async () => {
  const root = makeCourse('late', PLAIN);
  const context = await newContext();
  const page = await open(context, root, LESSON);
  const area = await openNotes(page);
  await area.pressSequentially('本页先写的。');

  // 另一个标签页写了新内容，而通知还没到：直接改存储，本页收不到通知
  await page.evaluate((file) => {
    const data = JSON.parse(localStorage.getItem('zhixu:course:late'));
    data.notes[file] = '别处写的新内容。';
    localStorage.setItem('zhixu:course:late', JSON.stringify(data));
  }, LESSON);
  await area.pressSequentially('接着写。');

  const adopt = page.getByRole('button', { name: '载入最新内容' });
  assert.equal((await storedRecord(page, 'late')).notes[LESSON], '别处写的新内容。', '存储里的内容没有被盖掉');
  assert.equal(await area.inputValue(), '本页先写的。接着写。', '本页的草稿还在');
  assert.match(await notesStatus(page), /在别处改过，这里的内容还没保存/);
  assert.ok(await adopt.isVisible());

  await closePanel(page);
  await openNotes(page);
  assert.equal(await area.inputValue(), '本页先写的。接着写。', '关掉面板再打开，草稿仍在');

  await adopt.click();
  assert.equal(await area.inputValue(), '别处写的新内容。');
  assert.equal(await adopt.isVisible(), false);
  await area.pressSequentially('然后照常保存。');
  assert.equal((await storedRecord(page, 'late')).notes[LESSON], '别处写的新内容。然后照常保存。');
  assert.equal(await notesStatus(page), '已保存');
  await context.close();
});

test('B39 别的标签页改了外观设置，这一页跟着变；从往返缓存里恢复的页面按最新的记录重搭', async () => {
  const root = makeCourse('sync', PLAIN);
  const context = await newContext();
  const one = await open(context, root, LESSON);
  const two = await open(context, root, LESSON);
  await press(one, '外观与设置');
  await one.getByLabel('深色').check();
  await two.waitForFunction(() => document.documentElement.dataset.theme === 'dark');

  await rebuilt(two, () => two.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))));
  assert.equal(await two.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await context.close();
});

test('B14 浏览器不许存储时如实说明：页面顶部提示一次，笔记不谎称已保存，草稿留在文本框里', async () => {
  const root = makeCourse('blocked', PLAIN);
  const context = await newContext();
  await context.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('不允许存储', 'QuotaExceededError');
    };
  });
  const page = await open(context, root, LESSON);
  const alerts = page.locator('p.zx-alert');
  assert.equal(await alerts.count(), 1);
  assert.match(await alerts.textContent(), /学习记录无法保存/);

  const area = await openNotes(page);
  await area.pressSequentially('存不进去的草稿');
  assert.match(await notesStatus(page), /没有保存/);
  await closePanel(page);
  await openNotes(page);
  assert.equal(await area.inputValue(), '存不进去的草稿', '关掉面板再打开，草稿仍在');
  await closePanel(page);

  const slot = page.locator('.zx-seal-slot');
  await slot.click();
  assert.equal(await slot.getAttribute('aria-pressed'), 'false');
  assert.match(await page.locator('.zx-finish').textContent(), /没有记下来/);
  assert.equal(await alerts.count(), 1, '页面顶部的说明只出现一次');
  assert.deepEqual(page.errors, []);
  await context.close();
});

const FIGURE = (id) =>
  `<figure id="${id}"><svg viewBox="0 0 40 20" role="img" aria-label="示意图"><rect width="40" height="20"/></svg><figcaption>示意图</figcaption></figure>`;

/** 一讲：两道没有 id 的小测和一份任务清单。before 放在它们前面，second 是第二道题的题干。 */
const quizLesson = (before, second) => ({
  [LESSON]: section(
    [
      `<p>第一段。${before}</p>`,
      FIGURE('fig-stack'),
      '<div class="quiz" data-answer="b">',
      '  <p>栈按什么顺序出栈<span class="note">题干里的旁注。</span>？参见<a href="#fig-stack"></a>。</p>',
      '  <ol><li>先进先出</li><li>后进先出</li></ol>',
      '</div>',
      '<div class="quiz" data-answer="a">',
      `  <p>${second}</p>`,
      '  <ol><li>先进先出</li><li>后进先出</li></ol>',
      '</div>',
      '<ul class="tasks">',
      '  <li>动手写一个栈<span class="note">任务里的旁注。</span>，参见<a href="#fig-stack"></a></li>',
      '</ul>'
    ].join('\n')
  )
});

const keysOf = (page) => page.evaluate(() => [...document.querySelectorAll('div.quiz')].map((el) => el.dataset.key));

test('B12 在前面加旁注和图，后面小测和任务的键不变', async () => {
  const context = await newContext();
  const plain = await open(context, makeCourse('keys', quizLesson('', '队列按什么顺序出队？')), LESSON);
  const extra = `<span class="note">前面多出来的旁注。</span></p>\n${FIGURE('fig-extra')}\n<p>又一段。`;
  const edited = await open(context, makeCourse('keys', quizLesson(extra, '队列按什么顺序出队？')), LESSON);
  const labels = (page) => page.evaluate(() => document.querySelector('div.quiz').textContent.replace(/\s+/g, ' '));
  assert.notEqual(await labels(plain), await labels(edited), '两版里题干显示出来的文字应当不同（旁注序号、图号变了）');
  assert.deepEqual(await keysOf(edited), await keysOf(plain));
  assert.equal((await keysOf(plain)).length, 2);

  // 任务的键看不见，就看效果：在一版里勾上，另一版里它也是勾上的
  await plain.locator('.zx-task').click();
  await edited.reload();
  await edited.waitForSelector('html.zx-ready');
  assert.ok(await edited.locator('.zx-task input').isChecked(), '任务的勾选跟着键走');
  await context.close();
});

/** 把这一讲的两道题都答错：第一题选第一项，第二题选第二项。 */
async function answerWrong(page) {
  for (const index of [0, 1]) {
    const quiz = page.locator('div.quiz').nth(index);
    if ((await quiz.getAttribute('data-state')) !== 'idle') continue;
    await quiz.locator('label.zx-opt').nth(index).click();
    await quiz.getByRole('button', { name: '检查答案' }).click();
  }
}

const reviewList = (page) =>
  page.evaluate(() => [...document.querySelectorAll('.zx-review a')].map((link) => link.firstChild.data));

test('B12 同一门课的两个版本交替打开：各自答过的记录都留在存储里，首页只列当前这一版里有的错题', async () => {
  const oldRoot = makeCourse('versions', quizLesson('', '队列按什么顺序出队？'));
  const newRoot = makeCourse('versions', quizLesson('', '队列的出队顺序是哪一种？'));
  const context = await newContext();

  const oldLesson = await open(context, oldRoot, LESSON);
  await answerWrong(oldLesson);
  const newLesson = await open(context, newRoot, LESSON);
  assert.deepEqual(
    await newLesson.evaluate(() => [...document.querySelectorAll('div.quiz')].map((el) => el.dataset.state)),
    ['wrong', 'idle'],
    '没改的题带着上次的结果，改过的题是一道新题'
  );
  await answerWrong(newLesson);

  const answered = () => storedRecord(newLesson, 'versions').then((data) => Object.keys(data.quiz[LESSON]).length);
  assert.equal(await answered(), 3);
  const newHome = await open(context, newRoot, 'index.html');
  const newList = await reviewList(newHome);
  assert.equal(newList.length, 2);
  assert.ok(
    newList.some((stem) => stem.includes('队列的出队顺序是哪一种？')) &&
      newList.every((stem) => !stem.includes('队列按什么顺序出队？'))
  );

  await oldLesson.reload();
  await oldLesson.waitForSelector('html.zx-ready');
  const oldHome = await open(context, oldRoot, 'index.html');
  const oldList = await reviewList(oldHome);
  assert.equal(oldList.length, 2);
  assert.ok(
    oldList.some((stem) => stem.includes('队列按什么顺序出队？')) &&
      oldList.every((stem) => !stem.includes('队列的出队顺序是哪一种？'))
  );
  assert.equal(await answered(), 3, '两版的记录都还在');
  await context.close();
});

test('A02 另一版讲义刚打开过，随后直接打开本版首页：首页只列本版写着的题，不去借另一版的题目清单', async () => {
  const oldRoot = makeCourse('versions-x', quizLesson('', '队列按什么顺序出队？'));
  const newRoot = makeCourse('versions-x', quizLesson('', '队列的出队顺序是哪一种？'));
  const context = await newContext();

  // 两版各答错一次（首页的错题回顾就都有话说），最后打开的是新版讲义
  const oldLesson = await open(context, oldRoot, LESSON);
  await answerWrong(oldLesson);
  const newLesson = await open(context, newRoot, LESSON);
  await answerWrong(newLesson);

  // 不先打开旧版讲义，直接开旧版首页：它填的题目清单必须是旧版的
  const oldHome = await open(context, oldRoot, 'index.html');
  const oldList = await reviewList(oldHome);
  assert.equal(oldList.length, 2);
  assert.ok(
    oldList.some((stem) => stem.includes('队列按什么顺序出队？')) &&
      oldList.every((stem) => !stem.includes('队列的出队顺序是哪一种？')),
    `旧版首页列的是旧版的题：${oldList.join(' / ')}`
  );
  // 错题都指到具体的那道题（不是整讲）：地址里带着那道题的 id
  const oldHrefs = await oldHome.evaluate(() =>
    [...document.querySelectorAll('.zx-review a')].map((link) => decodeURIComponent(link.getAttribute('href')))
  );
  assert.ok(
    oldHrefs.every((href) => href.includes('zx-quiz-')),
    `错题都指到具体的那道题：${oldHrefs.join(' ')}`
  );

  // 反过来也一样：新版讲义在最近打开过的是旧版的情况下，新版首页仍只列新版的题
  await newLesson.reload();
  await newLesson.waitForSelector('html.zx-ready');
  const newHome = await open(context, newRoot, 'index.html');
  const newList = await reviewList(newHome);
  assert.ok(
    newList.some((stem) => stem.includes('队列的出队顺序是哪一种？')) &&
      newList.every((stem) => !stem.includes('队列按什么顺序出队？'))
  );
  assert.equal((await storedRecord(newHome, 'versions-x')).quiz[LESSON] !== undefined, true, '两版的记录都还在存储里');
  await context.close();
});

test('A02 升级之后直接打开首页、还没打开改过的那一讲：首页只列这一版里还在的题，旧题的记录留在存储里', async () => {
  const before = makeCourse('upgrade', quizLesson('', '队列按什么顺序出队？'));
  const after = makeCourse('upgrade', quizLesson('', '队列的出队顺序是哪一种？')); // 第二道题改了题干：成了一道新题
  const context = await newContext();
  await answerWrong(await open(context, before, LESSON)); // 旧版里两道题都答错

  const home = await open(context, after, 'index.html'); // 升级了，没进讲义，直接开首页
  const list = await reviewList(home);
  assert.equal(list.length, 1, `没改的那道还在，改了题干的那道这一版里没答过：${list.join(' / ')}`);
  assert.ok(list[0].includes('栈按什么顺序出栈'));
  assert.equal(Object.keys((await storedRecord(home, 'upgrade')).quiz[LESSON]).length, 2, '旧题的记录还在存储里');
  await context.close();
});

const QUIZ_IDS = ['picked', 'constructor'];

test('A03 小测的 id 叫 constructor：没答过的题不会因为撞上原型就被当成答错过，答案和解析不提前露出来', async () => {
  const root = makeCourse('proto-id', {
    [LESSON]: section(
      [
        `<div class="quiz" id="${QUIZ_IDS[0]}" data-answer="a">`,
        '  <p>第一题。</p>',
        '  <ol><li>对</li><li>错</li></ol>',
        '  <div class="explain"><p>第一题的解析。</p></div>',
        '</div>',
        `<div class="quiz" id="${QUIZ_IDS[1]}" data-answer="a">`,
        '  <p>第二题，id 叫 constructor。</p>',
        '  <ol><li>对</li><li>错</li></ol>',
        '  <div class="explain"><p>第二题的解析。</p></div>',
        '</div>'
      ].join('\n')
    )
  });
  const context = await newContext();
  const page = await open(context, root, LESSON);

  // 只答普通 id 的那一道，另一道碰都不碰
  const ordinary = page.locator(`.quiz#${QUIZ_IDS[0]}`);
  await ordinary.locator('.zx-opt').first().click();
  await ordinary.getByRole('button', { name: '检查答案' }).click();
  await page.waitForFunction(() => document.querySelector('.quiz[data-state="right"]') !== null);
  assert.equal(
    await page.locator(`.quiz#${QUIZ_IDS[1]}`).getAttribute('data-state'),
    'idle',
    '答另一道之前它还得是待答的'
  );

  await page.reload();
  await page.waitForSelector('html.zx-ready');

  const constructor = page.locator(`.quiz#${QUIZ_IDS[1]}`);
  assert.equal(await constructor.getAttribute('data-state'), 'idle', '没答过的题还是待答的');
  const state = await constructor.evaluate((el) => ({
    status: el.querySelector('.zx-quiz-status').textContent,
    inputsDisabled: [...el.querySelectorAll('input')].map((input) => input.disabled),
    explainHidden: el.querySelector('.explain').hidden,
    action: el.querySelector('.zx-btn').textContent
  }));
  assert.deepEqual(
    state,
    { status: '', inputsDisabled: [false, false], explainHidden: true, action: '检查答案' },
    '选项还能点，解析没露出来，按钮还是“检查答案”'
  );
  const stored = await storedRecord(page, 'proto-id');
  assert.deepEqual(
    Object.keys(stored.quiz[LESSON]),
    [QUIZ_IDS[0]],
    `存储里只有答过的那一道：${Object.keys(stored.quiz[LESSON]).join(',')}`
  );

  // 真的答它，记录也照常写进去：键是作者写的 id，只是读取时只认对象自己的属性
  await constructor.locator('.zx-opt').first().click();
  await constructor.getByRole('button', { name: '检查答案' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.quiz[data-state="right"]').length === 2);
  const after = await storedRecord(page, 'proto-id');
  assert.equal(after.quiz[LESSON][QUIZ_IDS[1]].ok, true);
  await context.close();
});

test('A05 备份记录里有 constructor、__proto__ 这样的字段名：按普通坏备份拒绝，不改动原记录，控制台也没有异常', async () => {
  const root = makeCourse('proto-backup', PLAIN);
  const context = await newContext();
  const page = await open(context, root, LESSON);
  // 坏备份在校验这一步就被拒绝，不会走到“继续吗”：屏幕上没有需要确认的对话框
  page.on('dialog', (dialog) => {
    throw new Error(`坏备份不该问读者任何问题：${dialog.message()}`);
  });
  const before = await stored(page, 'proto-backup');
  for (const field of ['constructor', '__proto__', 'toString', 'unknown']) {
    await press(page, '外观与设置');
    assert.equal(
      await restore(page, envelope('proto-backup', JSON.parse(`{"${field}":{}}`))),
      '备份文件的内容不完整或已损坏，没有恢复。',
      field
    );
    assert.equal(await stored(page, 'proto-backup'), before, `${field}：原记录一个字节都没动`);
    await closePanel(page);
  }
  assert.deepEqual(page.errors, []);
  await context.close();
});
