'use strict';
/* 单文件导出（zx pack）：把首页、全部讲义、引擎、字体、用到的第三方库和图片打成一个 HTML，写到 export/ 下。
 * 把它发到手机上，用浏览器打开就是整门课。
 * 全程只读：检查与生成都在内存里做，不改讲义，也不写课程里别的文件；有 error 就不导出，上一次导出的文件保持原样。 */
const fs = require('fs');
const path = require('path');
const { TEMPLATE_DIR, COURSE_FILE, DATA_FILE, INDEX_FILE, readText, isFile, isInside, mimeOf } = require('./files');
const { parse, applyEdits, escapeHtml } = require('./html');
const { attr, getAttr, hasClass, descendants } = require('./dom');
const { schemeOf, localPath } = require('./refs');
const { generate } = require('./build');

const EXPORT_DIR = 'export';
/* 这些属性里写的本地文件要一起带走 */
const FILE_ATTRIBUTES = ['src', 'href', 'poster'];

const dataUri = (file) => `data:${mimeOf(file)};base64,${fs.readFileSync(file).toString('base64')}`;
const engineFile = (templateDir, name) => readText(path.join(templateDir, name));

/** 样式表里引用的字体换成 data: 地址（内置字体是 woff，KaTeX 的是 woff2）。dir 是样式表所在的目录。 */
function inlineFonts(css, dir) {
  return css.replace(/url\((['"]?)(fonts\/[\w.-]+\.woff2?)\1\)/g, (match, quote, file) => {
    return `url(${dataUri(path.join(dir, file))})`;
  });
}

/**
 * 元素的某个属性如果指着课程目录里的一个文件（不是讲义之间的链接），返回把它换成 data: 地址的改动；否则返回 null。
 * 讲义之间的链接不动：它们由加载器改写成单文件里的地址。
 */
function embedEdit(root, element, name, pages) {
  const found = getAttr(element, name);
  if (!found || found.value.startsWith('#') || schemeOf(found.value) || found.value.startsWith('//')) return null;
  const [reference] = found.value.split('#');
  if (pages.includes(reference)) return null;
  const file = path.resolve(root, localPath(reference));
  if (!isInside(root, file) || !isFile(file)) return null;
  // 链接点开就是下载：带上原来的文件名
  const download = element.name === 'a' ? ` download="${escapeHtml(path.basename(file))}"` : '';
  return {
    start: found.offset,
    end: found.end,
    text: `${name}="${dataUri(file)}"${download}`
  };
}

/** 一页的正文：整个 <main>，里面引用的本地文件都换成了 data: 地址。 */
function pageBody(root, source, pages) {
  const doc = parse(source);
  const main = [...descendants(doc.root)].find((element) => element.name === 'main');
  const edits = [...descendants(main)]
    .flatMap((element) => FILE_ATTRIBUTES.map((name) => embedEdit(root, element, name, pages)))
    .filter(Boolean)
    .map((edit) => ({
      ...edit,
      start: edit.start - main.offset,
      end: edit.end - main.offset
    }));
  return `${applyEdits(source.slice(main.offset, main.contentEnd), edits)}</main>`;
}

const PLACEHOLDERS = {
  audio: '（这里是一段音频）',
  video: '（这里是一段视频）'
};

/**
 * 关掉脚本时读的那一份：一页 <main> 里面的内容，原样。
 * 图片、音频和视频不再嵌一遍（那样文件要大一倍），换成一句说明；内联的 SVG 是正文的一部分，照常显示。
 */
function plainBody(source) {
  const doc = parse(source);
  const main = [...descendants(doc.root)].find((element) => element.name === 'main');
  const edits = [...descendants(main)]
    .filter((element) => element.name === 'img' || element.name in PLACEHOLDERS)
    .map((element) => ({
      start: element.offset,
      // 图片没有结束标签；音频和视频连同结束标签一起换掉
      end: element.name === 'img' ? element.contentStart : source.indexOf('>', element.contentEnd) + 1,
      text: element.name === 'img' ? `（图：${escapeHtml(attr(element, 'alt'))}）` : PLACEHOLDERS[element.name]
    }))
    .map((edit) => ({
      ...edit,
      start: edit.start - main.contentStart,
      end: edit.end - main.contentStart
    }));
  return applyEdits(source.slice(main.contentStart, main.contentEnd), edits);
}

/** 全课用到的第三方文件：有代码就带上着色库和用到的语言，有公式就带上 KaTeX。 */
function vendorFiles(lessons, templateDir) {
  const files = {};
  const elements = lessons.flatMap((lesson) => lesson.elements);
  const pres = elements.filter((element) => element.name === 'pre');
  if (pres.length > 0) {
    files['vendor/highlight/highlight.min.js'] = engineFile(templateDir, 'vendor/highlight/highlight.min.js');
    for (const language of new Set(pres.map((pre) => attr(pre, 'data-lang')))) {
      const name = `vendor/highlight/languages/${language}.min.js`;
      if (isFile(path.join(templateDir, name))) files[name] = engineFile(templateDir, name);
    }
  }
  if (elements.some((element) => hasClass(element, 'math'))) {
    const dir = path.join(templateDir, 'vendor', 'katex');
    files['vendor/katex/katex.min.css'] = inlineFonts(engineFile(templateDir, 'vendor/katex/katex.min.css'), dir);
    files['vendor/katex/katex.min.js'] = engineFile(templateDir, 'vendor/katex/katex.min.js');
  }
  return files;
}

/** 把随单文件重新分发的软件和字体许可留在 HTML 源码中。 */
function licenseBlock(templateDir, files) {
  const names = [
    'LICENSE',
    'LICENSE-MDI.txt',
    'fonts/OFL-NotoSerifSC.txt',
    'fonts/OFL-LXGWWenKai.txt',
    'fonts/OFL-JetBrainsMono.txt'
  ];
  if ('vendor/katex/katex.min.js' in files) names.push('vendor/katex/LICENSE', 'fonts/OFL-KaTeX.txt');
  if ('vendor/highlight/highlight.min.js' in files) names.push('vendor/highlight/LICENSE');
  const notices = names.map((name) => `[template/${name}]\n${engineFile(templateDir, name).trimEnd()}`).join('\n\n');
  if (/<!--|--!?>/.test(notices)) throw new Error('许可文本含有 HTML 注释分隔符，无法嵌入单文件');
  return `<!-- zx-licenses\n${notices}\n-->`;
}

/** 嵌进 <script> 或 <style> 的文字里不能出现会提前结束它的标记。引擎自己的文件都满足这一点。 */
function assertInert(text, what) {
  if (/<\/(script|style)|<!--/i.test(text)) throw new Error(`${what} 里有 </script、</style 或 <!--，不能直接嵌进页面`);
  return text;
}

const megabytes = (text) => `${(Buffer.byteLength(text) / 1048576).toFixed(1)} MB`;
/* 单文件整份读进内存：超过这个大小，手机上打开会明显变慢，翻页也一直占着这些内存 */
const LARGE = 20 * 1048576;

/**
 * 导出整门课，返回 { result, file, summary, large }。有 error 时不导出：file 为 null。
 * file 是相对课程根目录的路径；summary 是一句给人看的大小说明；large 是这个文件是不是大到会拖慢翻页。
 * templateDir 默认取当前工具所在的 template/；调用方也可以指定夹具自己的 template/ 目录。
 */
function pack(root, { templateDir = TEMPLATE_DIR } = {}) {
  const { course, lessons, files, result, outputs } = generate(root, { templateDir });
  if (!result.ok) return { result, file: null, summary: '', large: false };

  const pages = [INDEX_FILE, ...files];
  const sources = new Map(lessons.map((lesson) => [lesson.file, { title: lesson.title, source: lesson.source }]));
  sources.set(INDEX_FILE, {
    title: course.title,
    source: outputs.get(INDEX_FILE)
  });
  const packed = {
    pages: Object.fromEntries(
      pages.map((file) => [
        file,
        {
          title: sources.get(file).title,
          body: pageBody(root, sources.get(file).source, pages)
        }
      ])
    ),
    files: {
      [`../${COURSE_FILE}`]: readText(path.join(root, COURSE_FILE)),
      [`../${DATA_FILE}`]: outputs.get(DATA_FILE),
      'app.js': engineFile(templateDir, 'app.js'),
      ...vendorFiles(lessons, templateDir)
    }
  };

  const css = assertInert(inlineFonts(engineFile(templateDir, 'zhixu.css'), templateDir), 'zhixu.css');
  // JSON 里的 < 全部写成转义：整段数据里没有任何标签的开头，放进 <script> 是安全的
  const data = JSON.stringify(packed).replace(/</g, '\\u003c');
  const html = [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(course.title)}</title>`,
    `<style>${css}</style>`,
    `<script type="application/json" id="zx-pack">${data}</script>`,
    `<script data-packed>${assertInert(engineFile(templateDir, 'zhixu.js'), 'zhixu.js')}</script>`,
    '</head>',
    '<body>',
    // 关掉脚本也能从头读到尾：全部讲义的正文按顺序排开。开着脚本时这一段只是一串不显示的文字
    '<noscript>',
    '<main>',
    `<h1>${escapeHtml(course.title)}</h1>`,
    '<p>这个浏览器没有开启 JavaScript。下面是全部讲义的正文，按顺序排开；目录、搜索、小测、图片和学习记录，要开启 JavaScript 才有。</p>',
    ...files.flatMap((file) => ['<article>', plainBody(sources.get(file).source), '</article>']),
    '</main>',
    '</noscript>',
    '</body>',
    '</html>',
    licenseBlock(templateDir, packed.files),
    ''
  ].join('\n');

  // 文件名取课程标题，换掉不能用在文件名里的字符；先写到临时文件再改名，中途出错不会弄坏上一次的导出
  const name = `${course.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim()}.html`;
  const target = path.join(root, EXPORT_DIR, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(`${target}.tmp`, html);
  fs.renameSync(`${target}.tmp`, target);

  const summary = `${megabytes(html)}：样式与字体 ${megabytes(css)}，${pages.length} 页正文、引擎与第三方库 ${megabytes(data)}`;
  return {
    result,
    file: `${EXPORT_DIR}/${name}`,
    summary,
    large: Buffer.byteLength(html) > LARGE
  };
}

module.exports = { pack };
