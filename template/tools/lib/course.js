'use strict';
/* 读取并校验手写的课程清单 course/course.js。 */
const path = require('path');
const vm = require('vm');
const { COURSE_FILE, INDEX_FILE, UsageError, readText, writeText, isFile, isLessonFile } = require('./files');
const { FILE_START } = require('./report');

const COURSE_ID = /^[a-z0-9][a-z0-9-]*$/;

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value) => typeof value === 'string';
const trimmed = (value) => (isString(value) ? value.trim() : '');

/** 在沙箱里执行清单，返回 window.ZHIXU_COURSE 的纯数据副本。 */
function evaluate(source) {
  const window = Object.create(null);
  vm.runInNewContext(source, { window }, { filename: COURSE_FILE, timeout: 1000 });
  return window.ZHIXU_COURSE === undefined ? undefined : JSON.parse(JSON.stringify(window.ZHIXU_COURSE));
}

/** 清单的源码：JSON 去掉键名的引号，就是契约里的写法。工具新建课程、登记讲义时都按这个格式写。 */
function courseSource(course) {
  return `window.ZHIXU_COURSE = ${JSON.stringify(course, null, 2).replace(/^(\s*)"(\w+)":/gm, '$1$2:')};\n`;
}

/** 源码里第一处注释的下标；没有注释时是 -1。字符串里的 // 不算。 */
function firstComment(source) {
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === '`') {
      quote = char;
    } else if (char === '/' && '/*'.includes(source[index + 1])) {
      return index;
    }
  }
  return -1;
}

function positionAt(source, index) {
  if (index === -1) return FILE_START;
  const before = source.slice(0, index).split('\n');
  return { line: before.length, col: before[before.length - 1].length + 1 };
}

/** 出错位置：语法错误和运行错误的调用栈里都带有"文件名:行[:列]"。 */
function errorPosition(error) {
  const found = /course\.js:(\d+)(?::(\d+))?/.exec(error.stack);
  return found ? { line: Number(found[1]), col: Number(found[2] || 1) } : FILE_START;
}

function readUnit(unit, index, unitCount, expect) {
  const label = `第 ${index + 1} 个单元`;
  if (!isRecord(unit)) {
    expect(false, `${label}必须是对象`);
    return { title: '', lessons: [] };
  }
  const titled = unit.title === undefined ? unitCount === 1 : trimmed(unit.title) !== '';
  expect(titled, `${label}缺少 title（整门课只有一个单元时才可以省略）`);
  expect(unit.description === undefined || isString(unit.description), `${label}的 description 必须是字符串`);
  const listed = Array.isArray(unit.lessons) ? unit.lessons : [];
  const lessons = listed.filter((name) => isString(name) && isLessonFile(name));
  expect(listed.length > 0, `${label}的 lessons 必须是非空数组`);
  expect(
    lessons.length === listed.length,
    `${label}的 lessons 里有无效的文件名：要写成"小写字母、数字、连字符.html"，且不能是 ${INDEX_FILE}`
  );
  return { title: trimmed(unit.title), lessons };
}

/** 校验清单的形状，返回只含后续步骤所需字段的课程对象；清单无法使用时返回 null。 */
function readCourse(source, report) {
  // 清单会被工具按规范格式重写（登记新的一讲时），注释留不住，所以不让写
  const comment = firstComment(source);
  if (comment !== -1) {
    report(
      'course/comment',
      'course.js 里不要写注释：工具登记新的一讲时会重写这个文件，注释会丢',
      positionAt(source, comment)
    );
  }
  let raw;
  try {
    raw = evaluate(source);
  } catch (error) {
    report('course/shape', `course.js 无法执行：${error.message}`, errorPosition(error));
    return null;
  }
  if (!isRecord(raw)) {
    report('course/shape', 'course.js 必须把课程清单（一个对象）赋给 window.ZHIXU_COURSE', FILE_START);
    return null;
  }
  const expect = (ok, message) => {
    if (!ok) report('course/shape', message, FILE_START);
  };
  expect(isString(raw.id) && COURSE_ID.test(raw.id), 'id 必填，只能用小写字母、数字和连字符');
  expect(trimmed(raw.title) !== '', 'title 必填');
  for (const key of ['subtitle', 'description', 'author']) {
    expect(raw[key] === undefined || isString(raw[key]), `${key} 必须是字符串`);
  }
  const units = Array.isArray(raw.units) ? raw.units : [];
  expect(units.length > 0, 'units 必须是非空数组');
  return {
    id: raw.id,
    title: trimmed(raw.title),
    subtitle: trimmed(raw.subtitle),
    description: trimmed(raw.description),
    units: units.map((unit, index) => readUnit(unit, index, units.length, expect))
  };
}

/** 核对登记的讲次，报告重复登记和文件不存在的；返回 { files, missing }，含义见 loadCourse。 */
function listLessons(course, source, root, report) {
  const files = [];
  const missing = [];
  for (const name of course.units.flatMap((unit) => unit.lessons)) {
    if (files.includes(name)) {
      report('course/duplicate-lesson', `${name} 被登记了不止一次`, positionAt(source, source.lastIndexOf(name)));
      continue;
    }
    files.push(name);
    if (!isFile(path.join(root, name))) {
      missing.push(name);
      report(
        'course/missing-file',
        `找不到 ${name}：登记的讲次没有对应的文件`,
        positionAt(source, source.indexOf(name))
      );
    }
  }
  return { files, missing };
}

/**
 * 读取课程清单，返回 { course, files, missing, problems }。
 * files 是登记的讲次（去重，按阅读顺序），missing 是其中文件不存在的；清单无法使用时 course 为 null。
 */
function loadCourse(root) {
  const source = readText(path.join(root, COURSE_FILE));
  const problems = [];
  const report = (rule, message, position) => {
    problems.push({ file: COURSE_FILE, ...position, level: 'error', rule, message });
  };
  const course = readCourse(source, report);
  const { files, missing } = course ? listLessons(course, source, root, report) : { files: [], missing: [] };
  return { course, files, missing, problems };
}

/**
 * 读出可以由工具改写的清单：{ raw, index }，index 是第 unit 个单元的下标（unit 从 1 数起，不给就是最后一个）。
 * 清单本身有问题、或者没有这个单元时，说明原因。
 */
function editableCourse(root, unit) {
  const { course, problems } = loadCourse(root);
  const flaw = problems.find((problem) => ['course/shape', 'course/comment'].includes(problem.rule));
  if (!course || flaw) throw new UsageError(`${COURSE_FILE} 有问题，先改好它：${problems[0].message}`);
  const raw = evaluate(readText(path.join(root, COURSE_FILE)));
  const index = (unit ?? raw.units.length) - 1;
  if (!raw.units[index]) throw new UsageError(`没有第 ${unit} 个单元：这门课有 ${raw.units.length} 个单元`);
  return { raw, index };
}

/**
 * 把一讲登记到清单的第 unit 个单元，并按规范格式重写 course.js；清单里的其他内容原样保留。
 * 返回这个单元的标题（没有标题时是空串）。
 */
function registerLesson(root, file, unit) {
  const { raw, index } = editableCourse(root, unit);
  raw.units[index].lessons.push(file);
  writeText(path.join(root, COURSE_FILE), courseSource(raw));
  return raw.units[index].title || '';
}

module.exports = { COURSE_ID, courseSource, loadCourse, editableCourse, registerLesson };
