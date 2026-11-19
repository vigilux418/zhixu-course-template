'use strict';
/* 示例课本身：讲义里的代码真的能跑，仓库里提交的生成文件是最新的。
 *   node --test engine/tests/samples.test.js
 * 缩进被破坏的 Python 会在这里被解释器拒绝。 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const COURSES = [ROOT, path.join(__dirname, 'courses', 'calculus')];

const decode = (text) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

function codeBlocks(language) {
  const blocks = [];
  for (const dir of COURSES) {
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.html') && name !== 'index.html')) {
      const html = fs.readFileSync(path.join(dir, file), 'utf8');
      const pattern = new RegExp(`<pre[^>]*data-lang="${language}"[^>]*><code>([\\s\\S]*?)</code></pre>`, 'g');
      for (const [, source] of html.matchAll(pattern)) blocks.push({ file, source: decode(source) });
    }
  }
  return blocks;
}

test('Python 示例都能通过语法检查', () => {
  const blocks = codeBlocks('python');
  assert.ok(blocks.length > 0);
  for (const { file, source } of blocks) {
    try {
      execFileSync('python', ['-I', '-c', 'import ast, sys; ast.parse(sys.stdin.read())'], {
        input: source,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error) {
      assert.fail(`${file} 里的 Python 代码有语法错误：\n${source}\n${error.stderr}`);
    }
  }
});

test('示例课里提交的生成文件（首页、目录数据）是最新的：引擎的生成规则或讲义改了，要重新 build 再提交', () => {
  const tools = (name) => require(path.join(ROOT, 'template', 'tools', 'lib', name));
  const { outputs } = tools('build').generate(ROOT);
  for (const [file, text] of outputs) {
    assert.equal(
      tools('files').readText(path.join(ROOT, file)),
      text,
      `${file} 不是最新的：在仓库根目录运行 node template/tools/zx.js build`
    );
  }
});

test('JavaScript 示例都能通过语法检查', () => {
  for (const { file, source } of codeBlocks('javascript')) {
    assert.doesNotThrow(() => new Function(source), `${file} 里的 JavaScript 代码有语法错误：\n${source}`);
  }
});
