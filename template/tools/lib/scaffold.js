'use strict';
/* 新建：从骨架新建一讲（new），用当前这份引擎新建一门空课程（init）。 */
const fs = require('fs');
const path = require('path');
const { randomInt } = require('crypto');
const { COURSE_ID, courseSource, editableCourse, registerLesson } = require('./course');
const { TEMPLATE_DIR, COURSE_FILE, UsageError, isLessonFile, readText, writeText } = require('./files');
const { parse, applyEdits, escapeHtml } = require('./html');
const { descendants } = require('./dom');

const FIRST_LESSON = '01-first-lesson';

/** 从 template/lesson.html 写出一讲，把标题填进 <title> 和 <h1>。 */
function writeLesson(root, file, title) {
  const skeleton = readText(path.join(TEMPLATE_DIR, 'lesson.html'));
  const titled = [...descendants(parse(skeleton).root)].filter((element) => ['title', 'h1'].includes(element.name));
  const edits = titled.map((element) => ({
    start: element.contentStart,
    end: element.contentEnd,
    text: escapeHtml(title)
  }));
  writeText(path.join(root, file), applyEdits(skeleton, edits));
}

/**
 * 新建一讲 <stem>.html，并登记到清单的第 unit 个单元（不给就是最后一个）。
 * 返回 { file, unitTitle }。名字不合规、文件已经存在、清单改不了的时候，什么也不创建；
 * 写到一半出错（比如清单是只读的）时，把这一趟留下的东西收回去：新页面删掉，清单回到原来的字节，
 * 修好权限直接重跑同一条命令即可。
 */
function createLesson(root, stem, title, unit) {
  const file = `${stem}.html`;
  const target = path.join(root, file);
  if (!isLessonFile(file)) {
    throw new UsageError(`文件名 "${stem}" 不可用：只能用小写字母、数字和连字符，且不能是 index`);
  }
  if (fs.existsSync(target)) throw new UsageError(`${file} 已经存在，不会覆盖`);
  editableCourse(root, unit);
  const listFile = path.join(root, COURSE_FILE);
  const before = readText(listFile);
  try {
    writeLesson(root, file, title);
    return { file, unitTitle: registerLesson(root, file, unit) };
  } catch (error) {
    fs.rmSync(target, { force: true });
    // 清单多半根本没写进去；真写坏了才写回原来的字节。读不出来也算“没改”——写不进去的权限，通常也读得出原来的内容
    let changed = true;
    try {
      changed = readText(listFile) !== before;
      if (changed) writeText(listFile, before);
      changed = readText(listFile) !== before;
    } catch (rollbackError) {
      changed = true;
    }
    throw new UsageError(
      `没能登记 ${file}：写 ${COURSE_FILE} 时出错（${error.code ?? error.message}）。` +
        (changed
          ? `${COURSE_FILE} 可能被改动过，请核对。`
          : `新页面已经删掉，${COURSE_FILE} 没有改动；修好之后重跑同一条命令即可。`)
    );
  }
}

/** 新课程的标识：目录名里能用的字符，加 6 位随机字符。学习记录按标识存放，所以两门课的标识不能相同。 */
function freshId(directory) {
  const name = path
    .basename(directory)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const suffix = randomInt(36 ** 6)
    .toString(36)
    .padStart(6, '0');
  return `${name || 'course'}-${suffix}`;
}

function isFreeDirectory(directory) {
  if (!fs.existsSync(directory)) return true;
  return fs.statSync(directory).isDirectory() && fs.readdirSync(directory).length === 0;
}

/** 在 directory 新建一门空课程：整份引擎、课程清单和第一讲。返回课程标识。 */
function initCourse(directory, title, id = freshId(directory)) {
  if (!COURSE_ID.test(id)) throw new UsageError(`课程标识 "${id}" 不可用：只能用小写字母、数字和连字符`);
  if (!isFreeDirectory(directory)) throw new UsageError(`${directory} 已经存在并且不是空目录`);
  fs.cpSync(TEMPLATE_DIR, path.join(directory, 'template'), { recursive: true });
  const first = `${FIRST_LESSON}.html`;
  writeText(path.join(directory, COURSE_FILE), courseSource({ id, title, units: [{ lessons: [first] }] }));
  writeLesson(directory, first, '第一讲');
  return id;
}

module.exports = { createLesson, initCourse };
