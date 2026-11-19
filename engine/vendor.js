'use strict';
/* 把第三方库的发行文件拷进 template/vendor/。
 * 用法：node engine/vendor.js <katex 包目录> <@highlightjs/cdn-assets 包目录>
 * 两个目录来自 `npm pack katex` 与 `npm pack @highlightjs/cdn-assets` 解包后的 package/。 */
const fs = require('fs');
const path = require('path');

const [katexDir, hljsDir] = process.argv.slice(2).map((dir) => path.resolve(dir));
if (!katexDir || !hljsDir) {
  console.error('用法：node engine/vendor.js <katex 包目录> <highlight.js 包目录>');
  process.exit(1);
}

const vendor = path.join(__dirname, '..', 'template', 'vendor');

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function version(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
}

fs.rmSync(vendor, { recursive: true, force: true });

// KaTeX：脚本、样式、woff2 字体。样式里声明的 woff、ttf 回退不随包分发，所以把它们从样式里去掉：
// 留着的话，WebKit 用 file:// 打开时会为每个找不到的回退文件报一条错。
const LEGACY_FONTS = /,url\([^)]*\.(?:woff|ttf)\) format\("(?:woff|truetype)"\)/g;
const katexOut = path.join(vendor, 'katex');
copy(path.join(katexDir, 'dist', 'katex.min.js'), path.join(katexOut, 'katex.min.js'));
fs.writeFileSync(
  path.join(katexOut, 'katex.min.css'),
  fs.readFileSync(path.join(katexDir, 'dist', 'katex.min.css'), 'utf8').replace(LEGACY_FONTS, '')
);
copy(path.join(katexDir, 'LICENSE'), path.join(katexOut, 'LICENSE'));
for (const file of fs.readdirSync(path.join(katexDir, 'dist', 'fonts'))) {
  if (file.endsWith('.woff2')) {
    copy(path.join(katexDir, 'dist', 'fonts', file), path.join(katexOut, 'fonts', file));
  }
}

// highlight.js：常用语言合集 + 其余语言按需加载的单文件。
const hljsOut = path.join(vendor, 'highlight');
copy(path.join(hljsDir, 'highlight.min.js'), path.join(hljsOut, 'highlight.min.js'));
copy(path.join(hljsDir, 'LICENSE'), path.join(hljsOut, 'LICENSE'));
const bundled = new Set(require(path.join(hljsOut, 'highlight.min.js')).listLanguages());
let extra = 0;
for (const file of fs.readdirSync(path.join(hljsDir, 'languages'))) {
  const name = file.replace(/\.min\.js$/, '');
  if (file.endsWith('.min.js') && !bundled.has(name)) {
    copy(path.join(hljsDir, 'languages', file), path.join(hljsOut, 'languages', file));
    extra += 1;
  }
}

fs.writeFileSync(path.join(vendor, 'VERSIONS.txt'), `katex ${version(katexDir)}\nhighlight.js ${version(hljsDir)}\n`);
console.log(`vendor 已更新：katex ${version(katexDir)}，highlight.js ${version(hljsDir)}`);
console.log(`highlight.js 内置 ${bundled.size} 种语言，另有 ${extra} 种按需加载`);
