'use strict';
/* 运行时里与页面无关的逻辑，直接在 Node 里测。源码是 ES 模块，用 import() 载入。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const load = (name) => import(pathToFileURL(path.join(__dirname, '..', 'src', 'js', `${name}.js`)));

test('判分：题型由“有没有选项、答案里有没有逗号、有没有答案”决定', async () => {
  const { kindOf } = await load('grading');
  assert.equal(kindOf(true, 'b'), 'choice');
  assert.equal(kindOf(true, 'a,c'), 'multi');
  assert.equal(kindOf(false, '3.14|π'), 'fill');
  assert.equal(kindOf(false, ''), 'self');
});

/** 不带提示的题，答一次：对就是 right，错就是 wrong。 */
async function judge(kind, answer, given) {
  const { phaseAfter } = await load('grading');
  return phaseAfter({ kind, answer, hasHint: false }, 1, given);
}

test('判分：选择题要和答案完全一致', async () => {
  assert.equal(await judge('choice', 'b', 'b'), 'right');
  assert.equal(await judge('choice', 'b', 'a'), 'wrong');
  assert.equal(await judge('multi', 'a,c', 'a,c'), 'right');
  assert.equal(await judge('multi', 'a,c', 'a'), 'wrong', '少选不算对');
  assert.equal(await judge('multi', 'a,c', 'a,b,c'), 'wrong', '多选不算对');
});

test('判分：填空题不计大小写、全角半角和首尾空格，任何一种写法都算对', async () => {
  const answer = '3.14|π|Pi';
  for (const given of ['3.14', ' 3.14 ', '３．１４', 'π', 'pi', 'PI', '　Pi　']) {
    assert.equal(await judge('fill', answer, given), 'right', given);
  }
  for (const given of ['3.15', '3.1 4', 'p', '']) assert.equal(await judge('fill', answer, given), 'wrong', given);
});

test('判分：第一次答错而题目带提示，先给提示再试一次；否则直接揭晓', async () => {
  const { phaseAfter } = await load('grading');
  const withHint = { kind: 'choice', answer: 'b', hasHint: true };
  const plain = { kind: 'choice', answer: 'b', hasHint: false };
  assert.equal(phaseAfter(withHint, 1, 'a'), 'retry');
  assert.equal(phaseAfter(withHint, 2, 'a'), 'wrong');
  assert.equal(phaseAfter(withHint, 2, 'b'), 'right');
  assert.equal(phaseAfter(plain, 1, 'a'), 'wrong');
  assert.equal(phaseAfter(plain, 1, 'b'), 'right');
});

test('判分：给读者看的正确答案', async () => {
  const { answerText } = await load('grading');
  assert.equal(answerText('choice', 'b'), 'B');
  assert.equal(answerText('multi', 'a,c'), 'A、C');
  assert.equal(answerText('fill', '3.14|π'), '3.14');
});

test('键：没有 id 的小测和任务，键是文字的哈希；算法不能变，变了读者的记录就对不上', async () => {
  const { hash } = await load('plain');
  // 这几个值是现在的算法给出的。改了算法这条会红：那意味着每一位读者答过的题、勾过的任务都要重来
  assert.deepEqual(['', 'a', '二分查找每比较一次，排除多少候选？', '先读题，再动手', '😀 表情也算'].map(hash), [
    'ztntfp',
    '1r9wi7g',
    '2ywajt',
    'x7m0re',
    'mzkot1'
  ]);
  assert.notEqual(hash('先读题，再动手'), hash('先读题，再动手。'), '差一个标点就是另一把键');
});

const INDEX = [
  { file: '01.html', id: '', title: '算法是什么', text: '算法是一组明确的步骤。Binary Search 是其中一种。' },
  { file: '02.html', id: 'idea', title: '二分查找', text: '每次比较排除一半的候选，前提是数据有序。' },
  {
    file: '02.html',
    id: 'code',
    title: '把区间写进代码',
    text: '用闭区间表示候选范围，二分查找的循环条件是 left <= right。'
  },
  { file: '03.html', id: '', title: '时间复杂度', text: '顺序查找要看 n 次，二分查找只要 log n 次。' }
];

test('搜索：每个词都要出现在标题或正文里；标题里命中的排在前面，其余按索引里的先后', async () => {
  const { searchHits, wordsOf } = await load('matching');
  const found = (query) => searchHits(INDEX, wordsOf(query)).map((entry) => entry.id || entry.file);
  assert.deepEqual(found('二分查找'), ['idea', 'code', '03.html'], '标题命中的在前，正文命中的按原来的先后');
  assert.deepEqual(found('二分查找 区间'), ['code'], '两个词都要有');
  assert.deepEqual(found('区间 二分查找'), ['code'], '词的先后不要紧');
  assert.deepEqual(found('binary SEARCH'), ['01.html'], '不分大小写');
  assert.deepEqual(found('没有这个词'), []);
  assert.deepEqual(found('   '), [], '只有空白：什么都不找');
  assert.deepEqual(wordsOf('  二分   Left\t查找 '), ['二分', 'left', '查找']);
});

test('搜索：最多给 30 条', async () => {
  const { searchHits } = await load('matching');
  const many = Array.from({ length: 50 }, (unused, n) => ({
    file: `${n}.html`,
    id: '',
    title: `第 ${n} 条`,
    text: '排序'
  }));
  const hits = searchHits(many, ['排序']);
  assert.equal(hits.length, 30);
  assert.equal(hits[0].file, '0.html');
});

test('搜索：摘录取第一个命中词前后的一段，前面截掉了就加省略号；词只在标题里时取正文的开头', async () => {
  const { excerptOf } = await load('matching');
  const text = `${'前'.repeat(40)}命中的词${'后'.repeat(80)}`;
  assert.equal(excerptOf(text, ['命中']), `…${'前'.repeat(16)}命中的词${'后'.repeat(52)}`);
  assert.equal(excerptOf('开头就命中，后面还有字。', ['开头']), '开头就命中，后面还有字。', '命中处靠前：不加省略号');
  assert.equal(excerptOf('正文里没有那个词。', ['标题里的词']), '正文里没有那个词。');
  assert.equal(excerptOf('先出现乙，后出现甲。', ['甲', '乙']), '先出现乙，后出现甲。', '按最先出现的那个词取');
  assert.equal(
    excerptOf('计算才开始“倒着”发生：￼，￼。这种结构', ['倒着']),
    '计算才开始“倒着”发生：[公式]，[公式]。这种结构'
  );
});

test('搜索：把一段文字按命中的词切开，各段连起来就是原文', async () => {
  const { splitHits } = await load('matching');
  assert.deepEqual(splitHits('发生：￼。', ['发生']), [
    ['发生', true],
    ['：[公式]。', false]
  ]);
  assert.deepEqual(splitHits('用 Binary Search 做二分查找', ['binary', '二分']), [
    ['用 ', false],
    ['Binary', true],
    [' Search 做', false],
    ['二分', true],
    ['查找', false]
  ]);
  assert.deepEqual(splitHits('二分二分', ['二分']), [
    ['二分', true],
    ['二分', true]
  ]);
  assert.deepEqual(splitHits('没有命中', ['别的']), [['没有命中', false]]);
  assert.deepEqual(splitHits('', ['词']), []);
  const text = '顺序查找与二分查找';
  const joined = splitHits(text, ['查找', '二分'])
    .map(([piece]) => piece)
    .join('');
  assert.equal(joined, text);
});

test('阶梯：十六讲以内一段；再多就平分成几段；每级的高度由一段的总高平分，夹在 4 到 24 之间', async () => {
  const { stairPlan } = await load('stairs');
  const plan = (count) => {
    const { flights, size, rise, steps } = stairPlan(Array(count).fill('同一个单元'));
    return { flights, size, rise, levels: steps.map((step) => step.level).join(' ') };
  };
  assert.deepEqual(plan(1), { flights: 1, size: 1, rise: 24, levels: '0' });
  assert.deepEqual(plan(4), { flights: 1, size: 4, rise: 22, levels: '0 1 2 3' });
  assert.deepEqual([plan(16).flights, plan(16).size, plan(16).rise], [1, 16, 5]);
  assert.deepEqual(plan(17), { flights: 2, size: 9, rise: 9, levels: '0 1 2 3 4 5 6 7 8 0 1 2 3 4 5 6 7' });
  assert.deepEqual([plan(26).flights, plan(26).size, plan(26).rise], [2, 13, 6]);
  assert.deepEqual([plan(40).flights, plan(40).size, plan(40).rise], [3, 14, 6]);
});

test('阶梯：一个单元的最后一级是平台；一段的最后一级、全课的最后一级不是', async () => {
  const { stairPlan } = await load('stairs');
  const landings = (units) =>
    stairPlan([...units])
      .steps.map((step, index) => (step.landing ? index + 1 : null))
      .filter(Boolean);
  assert.deepEqual(landings('甲甲乙乙'), [2], '四讲两个单元：第 2 讲是平台，第 4 讲不是');
  assert.deepEqual(landings('甲乙丙'), [1, 2]);
  assert.deepEqual(landings('甲甲甲'), []);
  // 26 讲、每个单元两讲，分成两段各 13 级：平台在每个单元的末尾
  const pairs = Array.from({ length: 26 }, (unused, n) => Math.floor(n / 2));
  assert.deepEqual(landings(pairs), [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24]);
  // 单元正好在一段的末尾换：那一级后面没有台阶，不算平台
  assert.deepEqual(landings([...Array(13).fill('上'), ...Array(13).fill('下')]), []);
});

test('学习记录：缺的字段补成空的；不认识的旧字段（包括原来存在记录里的 quizKeys）不带走', async () => {
  const { filled } = await load('record-shape');
  const blank = filled(null);
  assert.deepEqual(Object.keys(blank).sort(), ['done', 'last', 'notes', 'place', 'quiz', 'tabs', 'tasks']);
  assert.deepEqual([blank.tabs, blank.last, Object.keys(blank.done)], [[], null, []]);
  const partial = filled({ done: { 'a.html': '2026-11-16' }, old: 1, quizKeys: { 'a.html': ['q1'] } });
  assert.deepEqual(
    [partial.done['a.html'], partial.old, partial.quizKeys, partial.tabs],
    ['2026-11-16', undefined, undefined, []]
  );
  assert.notEqual(filled(null).done, filled(null).done, '每次都是新的空记录，不共用');
});

test('键是数据里来的时候只认对象自己的：constructor、toString 这些名字不会撞上原型', async () => {
  const { own } = await load('plain');
  const parsed = JSON.parse('{"q1": {"ok": true}}');
  assert.deepEqual(
    [own(parsed, 'q1'), own(parsed, 'constructor'), own(parsed, 'toString')],
    [{ ok: true }, undefined, undefined]
  );
  assert.equal(own(JSON.parse('{"constructor": 1}'), 'constructor'), 1, '作者真写了这个名字，就是它');
});

test('学习记录：备份文件合不合格——字段都认识，值的形状都对', async () => {
  const { isRecord, filled } = await load('record-shape');
  const answer = { ok: false, at: '2026-11-16', stem: '题干', id: 'q1' };
  const good = {
    done: { 'a.html': '2026-11-16' },
    place: { 'a.html': 'idea' },
    quiz: { 'a.html': { q1: answer, constructor: answer } },
    tasks: { 'a.html': ['t1'] },
    notes: { 'a.html': '笔记' },
    tabs: ['Python'],
    last: 'a.html'
  };
  assert.equal(isRecord(good), true, '小测的键可以叫 constructor：作者写的 id 就是它');
  assert.equal(isRecord({}), true, '空的备份合格（恢复它等于清空）');
  assert.equal(isRecord(filled(null)), true);
  assert.equal(isRecord({ notes: { 'a.html': '只有笔记' } }), true, '只带一部分字段也合格');
  assert.equal(isRecord({ quizKeys: { 'a.html': ['q1'] } }), true, '旧版本的备份里有 quizKeys：认得，恢复时丢掉');
  const bad = [
    null,
    [],
    '字符串',
    { done: ['a.html'] },
    { done: { 'a.html': 20261116 } },
    { tabs: 'Python' },
    { tabs: [1] },
    { last: 3 },
    { quiz: { 'a.html': { q1: { ...answer, ok: 'yes' } } } },
    { quiz: { 'a.html': { q1: { ok: true } } } },
    { quiz: { 'a.html': [answer] } },
    { notes: { 'a.html': null } }
  ];
  assert.deepEqual(
    bad.filter((data) => isRecord(data)),
    []
  );
});

test('学习记录：备份里不认识的字段不报错、不改原记录——字段名撞上原型（constructor、__proto__）也一样', async () => {
  const { isRecord } = await load('record-shape');
  for (const text of ['{"constructor":{}}', '{"__proto__":{}}', '{"toString":1}', '{"unknown":1}']) {
    assert.doesNotThrow(() => isRecord(JSON.parse(text)), text);
  }
});

test('学习记录：只算这一讲现在还有的题；不知道这一版有哪些题（目录数据还没更新）时全算', async () => {
  const { answersOf, filled } = await load('record-shape');
  const answer = (stem) => ({ ok: false, at: '2026-11-16', stem, id: 'q' });
  const data = filled({
    quiz: { 'a.html': { kept: answer('还在的题'), gone: answer('删掉的题') }, 'b.html': { any: answer('没开过的讲') } }
  });
  assert.deepEqual(
    answersOf(data, 'a.html', ['kept', 'added']).map((item) => item.stem),
    ['还在的题']
  );
  assert.deepEqual(
    answersOf(data, 'b.html').map((item) => item.stem),
    ['没开过的讲']
  );
  assert.deepEqual(answersOf(data, 'c.html', []), []);
});
