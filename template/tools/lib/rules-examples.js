'use strict';
/* 代码示例的语法：带 data-file 的代码块是一份完整的文件，读者会照着建文件、运行，所以语法必须是对的。
 * JSON 和 JavaScript 用 Node 自己来解析；Python 交给本机的 Python 3，没有装就明说跳过了几段。 */
const vm = require('vm');
const { spawnSync } = require('child_process');
const { sourceOffset } = require('./html');
const { attr, attrText, childElements, isText } = require('./dom');

const LANGUAGES = {
  json: 'json',
  javascript: 'javascript',
  js: 'javascript',
  mjs: 'javascript',
  python: 'python',
  py: 'python'
};

/** 一讲里要查语法的示例：[{ pre, text, language }]。text 是 <code> 里唯一的那个文字节点。 */
function examplesIn(lesson) {
  const examples = [];
  for (const pre of lesson.elements) {
    const language = LANGUAGES[attr(pre, 'data-lang')];
    if (pre.name !== 'pre' || !language || attrText(pre, 'data-file') === '') continue;
    const [code] = childElements(pre);
    // <code> 里混进了标签的，由 code/markup 去报告
    if (code && code.name === 'code' && code.children.length === 1 && isText(code.children[0])) {
      examples.push({ pre, text: code.children[0], language });
    }
  }
  return examples;
}

/** 第 line 行第 col 列（都从 1 数起）在整段文字里的下标。 */
function indexAt(source, line, col) {
  const before = source.split('\n').slice(0, line - 1);
  return before.reduce((sum, text) => sum + text.length + 1, 0) + col - 1;
}

/* 每种语言的检查都返回 null（没有问题）或 { message, index }；index 是出错处在源码里的下标。 */

function jsonFlaw(source) {
  try {
    JSON.parse(source);
    return null;
  } catch (error) {
    const at = /position (\d+)/.exec(error.message);
    return { message: error.message, index: at ? Number(at[1]) : source.length };
  }
}

function javascriptFlaw(source) {
  try {
    new vm.Script(source); // 只解析，不执行
    return null;
  } catch (error) {
    // 按普通脚本解析不过，也许只是因为用了 import、export 或顶层的 await：再按模块查一遍，顺便拿到出错的位置
  }
  const checked = spawnSync(process.execPath, ['--input-type=module', '--check', '-'], {
    input: source,
    encoding: 'utf8'
  });
  if (checked.status === 0) return null;
  const lines = checked.stderr.split('\n');
  const head = lines.findIndex((line) => /^\[stdin\]:\d+$/.test(line.trim()));
  const line = Number(lines[head].trim().slice('[stdin]:'.length));
  const col = lines[head + 2].indexOf('^') + 1;
  return { message: /^SyntaxError: (.*)$/m.exec(checked.stderr)[1], index: indexAt(source, line, col) };
}

/* 送进 Python 的脚本：从标准输入读一组源码（JSON），逐个解析，输出每个的语法错误（没有就是 null）。 */
const PYTHON_CHECK = [
  'import ast, json, sys',
  'if sys.version_info[0] < 3:',
  '    sys.exit(3)',
  'flaws = []',
  'for source in json.load(sys.stdin):',
  '    try:',
  '        ast.parse(source)',
  '        flaws.append(None)',
  '    except SyntaxError as error:',
  '        flaws.append({"message": error.msg, "line": error.lineno or 1, "col": error.offset or 1})',
  'print(json.dumps(flaws))'
].join('\n');

/** 只含 ASCII 的 JSON：不管对方的标准输入按什么编码读，内容都不会走样。 */
const asciiJson = (value) =>
  JSON.stringify(value).replace(/[\u0080-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** 一组 Python 源码各自的问题；本机没有 Python 3 时返回 null。 */
function pythonFlaws(sources) {
  for (const command of ['python3', 'python', 'py']) {
    const run = spawnSync(command, ['-c', PYTHON_CHECK], { input: asciiJson(sources), encoding: 'utf8' });
    if (run.status !== 0) continue;
    return JSON.parse(run.stdout).map(
      (flaw, order) => flaw && { message: flaw.message, index: indexAt(sources[order], flaw.line, flaw.col) }
    );
  }
  return null;
}

/**
 * 检查各讲里带 data-file 的示例。问题交给 reportFor(file)；返回要写进报告的说明（比如跳过了什么）。
 */
function checkExamples(lessons, reportFor) {
  const all = lessons.flatMap((lesson) => examplesIn(lesson).map((example) => ({ lesson, ...example })));
  const source = (example) => example.text.value;
  const flag = ({ lesson, pre, text }, flaw) => {
    if (!flaw) return;
    const at = lesson.doc.locate(sourceOffset(text, Math.min(flaw.index, text.value.length)));
    reportFor(lesson.file).error(
      at,
      'example/syntax',
      `${attrText(pre, 'data-file')} 有语法错误：${flaw.message}。带 data-file 的代码是读者要照着运行的完整文件；有意写错的示范不要加 data-file`
    );
  };

  for (const example of all) {
    if (example.language === 'json') flag(example, jsonFlaw(source(example)));
    if (example.language === 'javascript') flag(example, javascriptFlaw(source(example)));
  }
  const python = all.filter((example) => example.language === 'python');
  if (python.length === 0) return [];
  const flaws = pythonFlaws(python.map(source));
  if (!flaws) return [`跳过了 ${python.length} 段 Python 示例的语法检查：这台机器上没有找到 Python 3`];
  python.forEach((example, order) => flag(example, flaws[order]));
  return [];
}

module.exports = { checkExamples };
