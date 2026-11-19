'use strict';
/* 运行时源码的卫生检查：没有用不到的 import，没有漏写的 import，没有没人用的 export，没有只在本模块内使用却被导出的名字。
 *   node --test engine/tests/js.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'src', 'js');

/** 去掉注释和引号里的字符串，剩下的才是代码。模板字符串留着：里面 ${} 的部分是代码。 */
const codeOf = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, "''");

const modules = fs.readdirSync(DIR).map((name) => {
  const text = fs.readFileSync(path.join(DIR, name), 'utf8');
  const imports = [...text.matchAll(/^import \{([^}]+)\} from '\.\/([\w-]+)\.js';$/gm)].flatMap(([, names, from]) =>
    names.split(',').map((item) => ({ name: item.trim(), from: `${from}.js` }))
  );
  const exports = [...text.matchAll(/^export (?:async )?(?:function\*?|const|let|class) ([\w$]+)/gm)].map(
    (match) => match[1]
  );
  const body = text.replace(/^import [^;]+;$/gm, '');
  return { name, imports, exports, body, code: codeOf(body) };
});

/**
 * 匹配对某个名字的引用：不是别的名字的一部分，也不是属性访问（a.name），但展开运算（...name）算引用。
 * 名字 $ 还要排除模板字符串里的 ${、正则里的 \$ 和行尾锚点 $/、$|。
 */
const uses = (body, identifier) =>
  new RegExp(`(?<![\\w$\\\\])(?<!(?:^|[^.])\\.)${identifier.replace(/\$/g, '\\$')}(?![\\w$\\{/|])`, 'g');

/** 一个模块自己声明的名字：变量、函数、类，函数和箭头函数的参数，catch 的参数。和别的模块导出的同名时，用的是自己的。 */
function declaredIn(code) {
  const lists = [
    ...code.matchAll(/\b(?:const|let|var)\s+([\w$]+|[{[][^=]*)/g),
    ...code.matchAll(/\b(?:function\*?|class)\s+([\w$]+)/g),
    ...code.matchAll(/\(([^()]*)\)\s*=>/g),
    ...code.matchAll(/(?<![\w$.])([\w$]+)\s*=>/g),
    ...code.matchAll(/\bfunction\b[^(]*\(([^()]*)\)/g),
    ...code.matchAll(/\bcatch\s*\(([\w$]+)\)/g)
  ].map((match) => match[1]);
  // 解构里“键: 别名”的键不是声明出来的名字
  return lists.flatMap((list) => [...list.matchAll(/(?<![\w$])[\w$]+(?![\w$]|\s*:)/g)].map((match) => match[0]));
}

test('没有用不到的 import', () => {
  const unused = modules.flatMap(({ name, imports, body }) =>
    imports.filter((item) => !uses(body, item.name).test(body)).map((item) => `${name} 导入了 ${item.name} 却没有使用`)
  );
  assert.deepStrictEqual(unused, []);
});

test('导入的名字都确实被对方导出', () => {
  const missing = modules.flatMap(({ name, imports }) =>
    imports
      .filter((item) => !modules.find((other) => other.name === item.from)?.exports.includes(item.name))
      .map((item) => `${name} 从 ${item.from} 导入了不存在的 ${item.name}`)
  );
  assert.deepStrictEqual(missing, []);
});

test('用到别的模块导出的名字，都写了 import（打包后所有模块在同一个作用域里，漏写了照样能跑，源码却是错的）', () => {
  const owners = modules.flatMap(({ name, exports }) => exports.map((identifier) => ({ identifier, owner: name })));
  const missing = modules.flatMap(({ name, imports, exports, code }) => {
    const known = new Set([...imports.map((item) => item.name), ...exports, ...declaredIn(code)]);
    return owners
      .filter(({ identifier, owner }) => owner !== name && !known.has(identifier) && uses(code, identifier).test(code))
      .map(({ identifier, owner }) => `${name} 用到了 ${owner} 的 ${identifier}，却没有 import`);
  });
  assert.deepStrictEqual(missing, []);
});

test('每个 export 都被别的模块用到', () => {
  const imported = new Set(modules.flatMap(({ imports }) => imports.map((item) => `${item.from}:${item.name}`)));
  const idle = modules.flatMap(({ name, exports }) =>
    exports
      .filter((identifier) => !imported.has(`${name}:${identifier}`))
      .map((identifier) => `${name} 导出的 ${identifier} 没有被任何模块导入`)
  );
  assert.deepStrictEqual(idle, []);
});

test('每个顶层函数和常量都被用到', () => {
  const idle = modules.flatMap(({ name, body, exports }) =>
    [...body.matchAll(/^(?:async )?(?:function\*?|const|let|class) ([\w$]+)/gm)]
      .map((match) => match[1])
      .filter((identifier) => !exports.includes(identifier) && body.match(uses(body, identifier)).length < 2)
      .map((identifier) => `${name} 里的 ${identifier} 定义了却没有使用`)
  );
  assert.deepStrictEqual(idle, []);
});
