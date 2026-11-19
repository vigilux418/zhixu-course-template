'use strict';
/* 生成一门 12 单元、26 讲的长课，检验首页目录、目录栏和抽屉在大课程下的表现。
 *   require('./make-long')(目录)   只写讲义和课程清单，不放引擎。 */
const fs = require('fs');
const path = require('path');

const TOPICS = [
  '数据与变量',
  '条件与分支',
  '循环',
  '函数与抽象',
  '数组与切片',
  '字符串处理的若干常见技巧与边界情况（一个故意写得很长的标题）',
  '栈与队列',
  '链表',
  '哈希表',
  '树的遍历',
  '二叉搜索树',
  '堆与优先队列',
  '图的表示',
  '广度优先搜索',
  '深度优先搜索',
  '最短路径',
  '贪心策略',
  '分治',
  '动态规划入门',
  '背包问题',
  '回溯',
  '排序算法比较',
  '位运算',
  '复杂度分析进阶',
  '随机化算法',
  '综合练习'
];
const UNIT_SIZES = [2, 2, 3, 2, 2, 3, 2, 2, 2, 2, 2, 2];

const section = (title, n) =>
  [
    `<section id="part-${n}">`,
    `<h2>${title}的第 ${n} 部分</h2>`,
    `<p>占位正文。读者在这里会看到关于“${title}”的讲解，段落足够长时会自动折行，并保持两端对齐的版面。</p>`,
    '</section>'
  ].join('\n');

const lesson = (index, title) =>
  [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    `<meta name="description" content="第 ${index} 讲的摘要：围绕“${title}”展开，用于检验长课程下目录与导航的表现。">`,
    '<link rel="stylesheet" href="template/zhixu.css">',
    '<script src="template/zhixu.js"></script>',
    '</head>',
    '<body>',
    '<main>',
    `<h1>${title}</h1>`,
    `<p class="lead">这是自动生成的第 ${index} 讲，正文只是占位，重点是检查二十多讲的课程在首页和目录里是否依然清楚。</p>`,
    ...Array.from({ length: 3 + (index % 9) }, (unused, n) => section(title, n + 1)),
    '<section id="check">',
    '<h2>小测</h2>',
    '<div class="quiz" data-answer="a">',
    `<p>第 ${index} 讲的主题是什么？</p>`,
    '<ol>',
    `<li>${title}</li>`,
    '<li>别的内容</li>',
    '</ol>',
    '</div>',
    '</section>',
    '</main>',
    '</body>',
    '</html>',
    ''
  ].join('\n');

module.exports = function makeLong(dir) {
  fs.mkdirSync(path.join(dir, 'course'), { recursive: true });
  const files = TOPICS.map((title, index) => {
    const file = `${String(index + 1).padStart(2, '0')}-lesson.html`;
    fs.writeFileSync(path.join(dir, file), lesson(index + 1, title));
    return file;
  });
  let cursor = 0;
  const units = UNIT_SIZES.map((size, index) => {
    const unit = { title: `第 ${index + 1} 单元：阶段 ${index + 1}`, lessons: files.slice(cursor, cursor + size) };
    if (index % 3 === 0) unit.description = '这个单元带有一段说明文字，用来检查单元说明的排版。';
    cursor += size;
    return unit;
  });
  const course = { id: 'long-course', title: '一门有二十六讲的长课程', subtitle: '用来检验目录、目录栏与编号', units };
  fs.writeFileSync(
    path.join(dir, 'course', 'course.js'),
    `window.ZHIXU_COURSE = ${JSON.stringify(course, null, 2)};\n`
  );
};
