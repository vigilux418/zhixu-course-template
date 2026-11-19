'use strict';
/* 样式纪律：这几条规则让样式表不会再长成一层压一层的补丁。
 *   node --test engine/tests/css.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CSS_DIR = path.join(ROOT, 'engine', 'src', 'css');
const JS_DIR = path.join(ROOT, 'engine', 'src', 'js');

const cssFiles = fs.readdirSync(CSS_DIR).filter((name) => name.endsWith('.css'));
const js = [
  path.join(ROOT, 'engine', 'src', 'loader.js'),
  ...fs.readdirSync(JS_DIR).map((name) => path.join(JS_DIR, name))
]
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');
const contract = fs.readFileSync(path.join(ROOT, 'template', 'AGENTS.md'), 'utf8');

/* 里面还套着规则的 @ 规则：它们是里面那些规则的“上下文” */
const GROUPING = ['@media', '@keyframes', '@supports'];

/** 把样式表拆成规则：{ file, context, selectors, declarations }。context 是外层 @ 规则。 */
function parse(file) {
  const text = fs.readFileSync(path.join(CSS_DIR, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const stack = [];
  let buffer = '';
  let quote = null;
  let depth = 0;
  let current = null;

  for (const char of text) {
    if (quote) {
      buffer += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      buffer += char;
    } else if (char === '(') {
      depth += 1;
      buffer += char;
    } else if (char === ')') {
      depth -= 1;
      buffer += char;
    } else if (char === '{' && depth === 0) {
      const prelude = buffer.trim().replace(/\s+/g, ' ');
      buffer = '';
      if (GROUPING.some((name) => prelude.startsWith(name))) {
        stack.push(prelude);
        current = null;
      } else {
        current = { file, context: stack.join(' / '), prelude, declarations: [] };
        rules.push(current);
        stack.push(null);
      }
    } else if (char === '}' && depth === 0) {
      if (current && buffer.trim()) current.declarations.push(buffer.trim());
      buffer = '';
      stack.pop();
      current = null;
    } else if (char === ';' && depth === 0) {
      if (current && buffer.trim()) current.declarations.push(buffer.trim());
      buffer = '';
    } else {
      buffer += char;
    }
  }
  return rules;
}

/** 按顶层逗号拆开选择器列表（不拆 :where(a, b) 里面的逗号）。 */
function splitSelectors(prelude) {
  const parts = [];
  let depth = 0;
  let part = '';
  for (const char of prelude) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(part.trim());
      part = '';
    } else part += char;
  }
  parts.push(part.trim());
  return parts;
}

const rules = cssFiles.flatMap(parse);
const styleRules = rules.filter((rule) => !rule.prelude.startsWith('@') && !rule.context.includes('@keyframes'));
const declarations = rules.flatMap((rule) =>
  rule.declarations.map((text) => {
    const at = text.indexOf(':');
    return { rule, property: text.slice(0, at).trim(), value: text.slice(at + 1).trim() };
  })
);

/** 两个属性是否互相覆盖：同名，或一个是另一个的简写（margin 与 margin-top）。 */
const overlaps = (a, b) => a === b || a.startsWith(`${b}-`) || b.startsWith(`${a}-`);

test('同一个选择器的同一个属性只写一次，而且只在一个文件里', () => {
  const seen = new Map();
  const problems = [];
  for (const rule of styleRules) {
    const properties = rule.declarations.map((text) => text.slice(0, text.indexOf(':')).trim());
    for (const selector of splitSelectors(rule.prelude)) {
      const key = `${rule.context} | ${selector}`;
      const earlier = seen.get(key) ?? { file: rule.file, properties: [] };
      if (earlier.file !== rule.file) problems.push(`${selector} 同时出现在 ${earlier.file} 和 ${rule.file}`);
      for (const property of properties) {
        const clash = earlier.properties.find((other) => overlaps(property, other));
        if (clash) problems.push(`${rule.file} ${selector}：${property} 覆盖了前面的 ${clash}`);
      }
      seen.set(key, { file: rule.file, properties: [...earlier.properties, ...properties] });
    }
  }
  assert.deepStrictEqual(problems, []);
});

test('颜色只在 tokens.css 里出现', () => {
  const literal = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;
  const offenders = declarations
    .filter(({ rule, value }) => rule.file !== 'tokens.css' && literal.test(value.replace(/url\("[^"]*"\)/g, '')))
    .map(({ rule, property, value }) => `${rule.file} ${rule.prelude} { ${property}: ${value} }`);
  assert.deepStrictEqual(offenders, []);
});

test('字号与圆角只用令牌', () => {
  const allowed = {
    'font-size': /^(var\(--[\w-]+\)|inherit)( !important)?$/,
    'border-radius': /^((var\(--r-[\w-]+\)|0)( |$))+$/,
    font: /^inherit$/
  };
  const offenders = declarations
    .filter(
      ({ rule, property, value }) => rule.file !== 'tokens.css' && allowed[property] && !allowed[property].test(value)
    )
    .map(({ rule, property, value }) => `${rule.file} ${rule.prelude} { ${property}: ${value} }`);
  assert.deepStrictEqual(offenders, []);
});

test('间距只用令牌，或者跟着字号走的 em：padding、margin、gap 里的像素数只有抵消边框用的 1px', () => {
  const spacing = /^(padding|margin)(-|$)|^(row-|column-)?gap$/;
  const offenders = declarations
    .filter(({ rule, property }) => rule.file !== 'tokens.css' && spacing.test(property))
    .filter(({ value }) => [...value.matchAll(/([\d.]+)px/g)].some((match) => match[1] !== '1'))
    .map(({ rule, property, value }) => `${rule.file} ${rule.prelude} { ${property}: ${value} }`);
  assert.deepStrictEqual(offenders, []);
});

test('用蒙版画的图标同时写了带前缀的 -webkit-mask，并且打印时照印', () => {
  const masked = rules.filter((rule) => rule.declarations.some((declaration) => declaration.startsWith('mask:')));
  assert.ok(masked.length > 5, '应当有好几处用蒙版画的图标');
  const incomplete = masked
    .filter(
      (rule) =>
        !['-webkit-mask:', 'print-color-adjust: exact'].every((start) =>
          rule.declarations.some((declaration) => declaration.startsWith(start))
        )
    )
    .map((rule) => `${rule.file} ${rule.prelude}`);
  assert.deepStrictEqual(incomplete, []);
});

test('不用内嵌阴影冒充边线：它在 Firefox 里会向四周渗出发丝线', () => {
  const offenders = declarations
    .filter(({ property, value }) => property === 'box-shadow' && value.includes('inset'))
    .map(({ rule }) => `${rule.file} ${rule.prelude}`);
  assert.deepStrictEqual(offenders, []);
});

test('换字体族的地方同时写字重：正文字体用正文的字重（或者自己的粗体），界面的黑体用自己的字重', () => {
  // 正文的字重在普通屏幕上是 460。系统黑体没有这一档：让它跟着继承的话，在有 500 这一档的系统上会被凑成 500
  const expected = { 'var(--font-read)': /^(var\(--w-body\)|\d+)$/, 'var(--font-sans)': /^\d+$/ };
  const valueOf = (rule, property) =>
    rule.declarations
      .find((text) => text.startsWith(`${property}:`))
      ?.slice(property.length + 1)
      .trim();
  const offenders = rules
    .filter((rule) => {
      const weight = expected[valueOf(rule, 'font-family')];
      return weight && !weight.test(valueOf(rule, 'font-weight') ?? '');
    })
    .map((rule) => `${rule.file} ${rule.prelude}`);
  assert.deepStrictEqual(offenders, []);
});

test('断点只有三个，媒体查询和特性查询只有这几种', () => {
  const allowed = new Set([
    '@media (min-width: 700px)',
    '@media (min-width: 1000px)',
    '@media (min-width: 1280px)',
    '@media print',
    '@media (prefers-reduced-motion: reduce)',
    '@media (hover: none)', // 触屏：没有“移上去”
    '@media (pointer: coarse)', // 手指点按
    '@media (max-resolution: 1.49dppx)', // 普通屏幕（非高分屏）：正文字重
    '@supports (overlay: auto)' // 浮层关掉以后还能在最上层留一小会儿：退场的淡出
  ]);
  const used = new Set(
    rules.flatMap((rule) => rule.context.split(' / ')).filter((context) => /^@(media|supports)/.test(context))
  );
  assert.deepStrictEqual(
    [...used].filter((query) => !allowed.has(query)),
    []
  );
});

test('!important 只出现在 print.css', () => {
  const offenders = declarations
    .filter(({ rule, value }) => rule.file !== 'print.css' && value.includes('!important'))
    .map(({ rule, property }) => `${rule.file} ${rule.prelude} { ${property} }`);
  assert.deepStrictEqual(offenders, []);
});

test('用到的变量都有定义，定义的令牌都被用到', () => {
  const defined = new Set(
    declarations.filter(({ property }) => property.startsWith('--')).map(({ property }) => property)
  );
  for (const [, name] of js.matchAll(/setProperty\('(--[\w-]+)'/g)) defined.add(name);
  const usedInCss = new Set(
    declarations.flatMap(({ value }) => [...value.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]))
  );
  const usedInJs = new Set([...js.matchAll(/(--[\w-]+)/g)].map((match) => match[1]));

  assert.deepStrictEqual(
    [...usedInCss].filter((name) => !defined.has(name)),
    [],
    '未定义的变量'
  );
  const tokens = declarations.filter(({ rule, property }) => rule.file === 'tokens.css' && property.startsWith('--'));
  const unused = [...new Set(tokens.map(({ property }) => property))].filter(
    (name) => !usedInCss.has(name) && !usedInJs.has(name)
  );
  assert.deepStrictEqual(unused, [], '没有被用到的令牌');
});

/** WCAG 对比度；颜色写成 #rrggbb。 */
function contrast(a, b) {
  const channels = (color) => [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16));
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((value) => {
      const unit = value / 255;
      return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [a, b]
    .map((color) => luminance(Array.isArray(color) ? color : channels(color)))
    .sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** 一个主题的全部令牌：{ '--paper': '#fcfcfa', … }。 */
const themeTokens = (theme) =>
  Object.fromEntries(
    declarations
      .filter(
        ({ rule }) => rule.file === 'tokens.css' && splitSelectors(rule.prelude).includes(`html[data-theme='${theme}']`)
      )
      .map(({ property, value }) => [property, value])
  );

test('三种主题下，每种文字颜色在它会落到的每种底色上，对比度都不低于 4.5', () => {
  // 底色 → 会写在它上面的文字颜色。axe 看不到的几样也在这里：搜索的高亮、小测判定之后的颜色、阶梯上的编号
  const pairs = {
    '--paper': ['--ink', '--text', '--muted', '--accent', '--seal', '--good', '--bad'], // 纸面
    '--wash': ['--ink', '--text', '--muted', '--accent'], // 淡底色的块：代码、小结、卡片
    '--raise': ['--ink', '--text', '--muted', '--accent'], // 浮层
    '--accent-wash': ['--ink', '--text', '--muted', '--accent'], // 选中的搜索结果、“上次读到”
    '--mark-wash': ['--text', '--mark'], // 提示
    '--mark-ink': ['--ink', '--text'], // 搜索带过来的词、<mark>
    '--good-wash': ['--ink', '--text'], // 判对的选项
    '--bad-wash': ['--ink', '--text'], // 判错的选项
    '--accent': ['--on-accent'] // 主按钮、选中的选项标记、阶梯上“接下来读这一讲”的圆点
  };
  const problems = [];
  for (const theme of ['light', 'sepia', 'dark']) {
    const tokens = themeTokens(theme);
    for (const [background, colors] of Object.entries(pairs)) {
      for (const color of colors) {
        const ratio = contrast(tokens[color], tokens[background]);
        if (ratio < 4.5) problems.push(`${theme} ${color} 在 ${background} 上只有 ${ratio.toFixed(2)}`);
      }
    }
  }
  assert.deepStrictEqual(problems, []);
});

test('换主题时渐变的颜色（settings.js 里的名单）就是 tokens.css 里每套主题定义的那些颜色', () => {
  const settings = fs.readFileSync(path.join(JS_DIR, 'settings.js'), 'utf8');
  const listed = /const THEME_COLORS = \[([^\]]+)\]/.exec(settings)[1].match(/--[\w-]+/g);
  const isColor = (value) => /^(#[0-9a-f]{3,8}|rgb\()/i.test(value);
  for (const theme of ['light', 'sepia', 'dark']) {
    const colors = Object.entries(themeTokens(theme))
      .filter(([, value]) => isColor(value))
      .map(([name]) => name);
    assert.deepStrictEqual([...listed].sort(), colors.sort(), `${theme} 主题`);
  }
});

test('代码着色的每种颜色，在代码的底色、标亮的行和点亮的行上，对比度都不低于 4.5', () => {
  const channels = (color) => [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16));
  const marked = declarations.find(
    ({ rule, property }) => rule.prelude === '.zx-line.is-marked' && property === 'background'
  );
  const share = Number(/(\d+)%/.exec(marked.value)[1]) / 100; // 标亮的行：底色上叠这么多强调色
  const problems = [];
  for (const theme of ['light', 'sepia', 'dark']) {
    const tokens = Object.fromEntries(
      declarations
        .filter(
          ({ rule }) =>
            rule.file === 'tokens.css' && splitSelectors(rule.prelude).includes(`html[data-theme='${theme}']`)
        )
        .map(({ property, value }) => [property, value])
    );
    const wash = channels(tokens['--wash']);
    const accent = channels(tokens['--accent']);
    const backgrounds = {
      代码底色: wash,
      标亮的行: wash.map((value, index) => value * (1 - share) + accent[index] * share),
      点亮的行: channels(tokens['--lit'])
    };
    const colors = Object.keys(tokens).filter((name) => name.startsWith('--code-'));
    assert.strictEqual(colors.length, 7, `${theme} 主题应当有七种着色`);
    for (const name of [...colors, '--ink']) {
      for (const [label, background] of Object.entries(backgrounds)) {
        const ratio = contrast(tokens[name], background);
        if (ratio < 4.5) problems.push(`${theme} ${name} 在${label}上只有 ${ratio.toFixed(2)}`);
      }
    }
  }
  assert.deepStrictEqual(problems, []);
});

test('没有死类名：zx- 类都由脚本产生，其余类都在写作契约里', () => {
  const classes = new Set(
    styleRules.flatMap((rule) => [...rule.prelude.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]))
  );
  const external = /^(hljs|katex|is-|class_$)/; // 第三方库与状态类
  const words = new Set(contract.match(/[\w-]+/g));
  const dead = [...classes].filter((name) => {
    if (external.test(name)) return false;
    if (name.startsWith('zx-')) return !js.includes(name);
    return !words.has(name) && !words.has(name.replace(/^[fs]-/, '')); // f-颜色名 / s-颜色名
  });
  assert.deepStrictEqual(dead, []);
});
