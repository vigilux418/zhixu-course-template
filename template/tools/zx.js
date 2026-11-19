#!/usr/bin/env node
'use strict';
/* 知序写作工具的命令行入口。在课程根目录运行：node template/tools/zx.js <命令>
 * 只有 build 会改讲义（转义代码和公式里的 < 和 &）；check、look、outline、pack、preview 都只读。 */
const path = require('path');
const { COURSE_FILE, UsageError, isFile } = require('./lib/files');
const { checkCourse } = require('./lib/check');
const { build } = require('./lib/build');
const { createLesson, initCourse } = require('./lib/scaffold');
const { startPreview } = require('./lib/preview');
const { formatReport, focusOn, widthOf, padTo } = require('./lib/report');
const { formatOutline } = require('./lib/outline');
const { look, formatLook } = require('./lib/look');
const { pack } = require('./lib/pack');

const DEFAULT_PORT = 4173;
const INDENT = ' '.repeat(2);
const COMMAND_HELP = [
  ['build [讲...]', '检查并生成 index.html 和 course/data.js；代码和公式里没转义的 < 和 & 会自动改好'],
  ['check [--json]', '只检查，不写任何文件；--json 输出机器可读的结果'],
  ['look [讲...] [--shots]', '用本机的 Chrome 或 Edge 把页面排出来，报告看得见的版面问题；--shots 另存截图'],
  ['outline', '打印课程大纲：各讲的字数与时长、小节、可以引用的编号、已定义的术语'],
  ['new <名> "<标题>" [--unit N]', '新建一讲并登记到清单，例如 new 05-sorting "排序"；默认登记到最后一个单元'],
  ['pack', '把整门课导出成一个 HTML（写到 export/ 下），发到手机上用浏览器就能看'],
  ['preview [--port N]', '本地预览；讲义改动后自动重新生成数据'],
  ['init <目录> "<标题>" [--id ID]', '用当前这份引擎新建一门空课程；课程标识默认自动生成']
];
const COMMAND_WIDTH = Math.max(...COMMAND_HELP.map(([command]) => widthOf(command))) + 2;
const USAGE = [
  '用法：在课程根目录运行 node template/tools/zx.js <命令>',
  '',
  ...COMMAND_HELP.map(([command, help]) => INDENT + padTo(command, COMMAND_WIDTH) + help)
].join('\n');

function expectArgCount(args, count) {
  if (args.length !== count) throw new UsageError(USAGE);
}

/** 从参数里取走一个开关（如 --shots），返回它在不在。 */
function takeFlag(args, flag) {
  const at = args.indexOf(flag);
  if (at !== -1) args.splice(at, 1);
  return at !== -1;
}

/** 从参数里取走一个带值的选项（如 --unit 2），返回它的值；没有这个选项时返回 undefined。 */
function takeOption(args, option) {
  const at = args.indexOf(option);
  if (at === -1) return undefined;
  if (at === args.length - 1) throw new UsageError(USAGE);
  return args.splice(at, 2)[1];
}

function courseRoot() {
  const root = process.cwd();
  if (!isFile(path.join(root, COURSE_FILE))) {
    throw new UsageError(`当前目录不是课程根目录：找不到 ${COURSE_FILE}`);
  }
  return root;
}

/** 命令行里写的讲义名（带不带 .html 都行）对应的文件名。 */
function lessonFiles(root, names) {
  return names.map((name) => {
    const file = name.endsWith('.html') ? name : `${name}.html`;
    if (name.startsWith('-') || !isFile(path.join(root, file))) throw new UsageError(`找不到讲义 ${file}`);
    return file;
  });
}

function exitCode(result) {
  return result.ok ? 0 : 1;
}

function runBuild(args) {
  const root = courseRoot();
  const only = lessonFiles(root, args);
  const { result, generated, escaped } = build(root);
  const done = [];
  if (escaped.length > 0) {
    done.push(
      `已自动转义代码和公式里的 < 和 &：${escaped.map(({ file, escaped: count }) => `${file} ${count} 处`).join('、')}`
    );
  }
  if (generated.length > 0) done.push(`已生成 ${generated.join('、')}`);
  console.log([...done, '', formatReport(only.length > 0 ? focusOn(result, only) : result)].join('\n').trimStart());
  return exitCode(result);
}

function runCheck(args) {
  const json = args[0] === '--json';
  expectArgCount(args, json ? 1 : 0);
  const { result } = checkCourse(courseRoot());
  console.log(json ? JSON.stringify(result, null, 2) : formatReport(result));
  return exitCode(result);
}

async function runLook(args) {
  const shots = takeFlag(args, '--shots');
  const root = courseRoot();
  const report = formatLook(await look(root, lessonFiles(root, args), { shots }));
  console.log(report.text);
  return report.ok ? 0 : 1;
}

function runOutline(args) {
  expectArgCount(args, 0);
  const { course, lessons, result } = checkCourse(courseRoot());
  if (!course) {
    console.log(formatReport(result));
    return 1;
  }
  console.log(formatOutline(course, lessons));
  return 0;
}

function runNew(args) {
  const unit = takeOption(args, '--unit');
  expectArgCount(args, 2);
  if (unit !== undefined && !/^[1-9]\d*$/.test(unit)) throw new UsageError(USAGE);
  const { file, unitTitle } = createLesson(courseRoot(), args[0], args[1], unit && Number(unit));
  console.log(`已创建 ${file}，并登记到 ${COURSE_FILE}${unitTitle ? `（单元“${unitTitle}”）` : ''}。`);
  console.log('写完之后运行 build；写别的讲要引用它时，先看 outline。');
  return 0;
}

function runPack(args) {
  expectArgCount(args, 0);
  const { result, file, summary, large } = pack(courseRoot());
  if (!file) {
    console.log(formatReport(result));
    console.log('有 error，没有导出；上一次导出的文件没有动。');
    return 1;
  }
  console.log(`已导出 ${file}（${summary}）`);
  if (large) {
    console.log(
      'warning  文件超过 20 MB。单文件整份读进内存，手机上打开会慢，翻页也占内存：把图片、音频和视频压小一些。'
    );
  }
  console.log('把这个文件发到手机上，用浏览器打开就是整门课。');
  return 0;
}

function readPort(args) {
  if (args.length === 0) return DEFAULT_PORT;
  const port = Number(args[1]);
  if (args.length !== 2 || args[0] !== '--port' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new UsageError(USAGE);
  }
  return port;
}

async function runPreview(args) {
  const firstPort = readPort(args);
  const { port } = await startPreview(courseRoot(), firstPort, console.log);
  console.log(`预览地址：http://127.0.0.1:${port}/`);
  console.log('改完讲义后刷新页面即可；按 Ctrl+C 停止预览。');
  return 0;
}

function runInit(args) {
  const id = takeOption(args, '--id');
  expectArgCount(args, 2);
  const directory = path.resolve(args[0]);
  const courseId = initCourse(directory, args[1], id);
  const { result } = build(directory);
  const output = [
    formatReport(result),
    '',
    `已创建课程：${directory}`,
    `课程标识：${courseId}（读者的学习记录按它存放，定下来以后不要再改）`,
    '接下来：',
    `${INDENT}cd "${args[0]}"`,
    `${INDENT}node template/tools/zx.js preview`,
    '写作约定见 template/AGENTS.md；新的一讲用 new 创建。'
  ];
  console.log(output.join('\n'));
  return exitCode(result);
}

const COMMANDS = new Map([
  ['build', runBuild],
  ['check', runCheck],
  ['look', runLook],
  ['outline', runOutline],
  ['new', runNew],
  ['pack', runPack],
  ['preview', runPreview],
  ['init', runInit]
]);

/** 执行命令，返回退出码：0 通过，1 课程里有问题。用法或环境问题抛出 UsageError。 */
async function main([command = 'help', ...args]) {
  if (command === 'help') {
    console.log(USAGE);
    return 0;
  }
  const run = COMMANDS.get(command);
  if (!run) throw new UsageError(`不认识的命令：${command}\n\n${USAGE}`);
  return run(args);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    if (!(error instanceof UsageError)) throw error;
    console.error(error.message);
    process.exitCode = 2;
  }
);
