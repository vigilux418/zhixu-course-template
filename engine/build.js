'use strict';
/* 知序构建：把 engine/src 合成 template/ 里的三个运行文件。
 * 没有依赖，结果可重复：同样的源码总是生成同样的文件。
 *
 *   node engine/build.js
 *
 * 样式按固定顺序拼接；脚本源码是 ES 模块，这里按依赖顺序拼成一个普通脚本，
 * 因为双击打开（file://）的页面不能加载 type="module"。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, 'src');
const OUT = path.join(__dirname, '..', 'template');
const CSS_ORDER = ['tokens', 'base', 'layout', 'components', 'home', 'overlays', 'print'];
const NOTICE = '由 engine/build.js 生成，请勿直接修改；源码在 engine/src';

const read = (...parts) => fs.readFileSync(path.join(SRC, ...parts), 'utf8');

function buildCss() {
  const parts = CSS_ORDER.map((name) => read('css', `${name}.css`).trim());
  return `/* 知序样式（${NOTICE}/css） */\n\n${parts.join('\n\n')}\n`;
}

const IMPORT = /^import \{([^}]+)\} from '\.\/([\w-]+)\.js';\n/gm;
const DECLARATION = /^(?:export )?(?:async )?(?:function\*?|const|let|class) ([\w$]+)/gm;

/** 从入口出发，按“先依赖、后使用”的顺序收集模块。 */
function collect(name, seen, ordered) {
  if (seen.has(name)) return;
  seen.add(name);
  const text = read('js', `${name}.js`);
  for (const [, , dependency] of text.matchAll(IMPORT)) collect(dependency, seen, ordered);
  ordered.push({ name, text });
}

function buildJs() {
  const modules = [];
  collect('main', new Set(), modules);

  const owners = new Map();
  const bodies = modules.map(({ name, text }) => {
    const body = text
      .replace(IMPORT, '')
      .replace(/^export /gm, '')
      .trim();
    if (/^(?:import|export)\b/m.test(body)) throw new Error(`${name}.js 里有构建脚本不认识的 import/export 写法`);
    for (const [, identifier] of body.matchAll(DECLARATION)) {
      if (owners.has(identifier))
        throw new Error(`顶层名字 ${identifier} 在 ${owners.get(identifier)}.js 和 ${name}.js 里重复了`);
      owners.set(identifier, name);
    }
    return `// —— ${name}.js ——\n${body}`;
  });

  // 模块顶层抛出的异常在这里接住，把原因交给加载器显示（浏览器的全局 error 事件在 file:// 下拿不到原因）
  const code = `/* 知序运行时（${NOTICE}/js） */\n(function () {\n'use strict';\ntry {\n\n${bodies.join('\n\n')}\n\n} catch (error) {\n  ZHIXU.fail(error.message);\n  throw error;\n}\n})();\n`;
  new vm.Script(code, { filename: 'app.js' }); // 语法检查：有错就在构建时报出来
  return code;
}

function write(name, text) {
  fs.writeFileSync(path.join(OUT, name), text);
  console.log(`${name.padEnd(10)} ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB`);
}

write('zhixu.css', buildCss());
write('zhixu.js', read('loader.js'));
write('app.js', buildJs());
