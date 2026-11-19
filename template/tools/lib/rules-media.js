'use strict';
/* 公式、图片、SVG，以及音频和视频。 */
const fs = require('fs');
const path = require('path');
const { TEMPLATE_DIR, loadCjsModule } = require('./files');
const { sourceOffset } = require('./html');
const { attr, attrText, closest, getAttr, hasClass, firstNonText, textOf } = require('./dom');
const { isExternal, schemeOf } = require('./refs');

const REPO_KATEX_PATH = path.join(TEMPLATE_DIR, 'vendor', 'katex', 'katex.min.js');
const REPO_KATEX_BYTES = fs.readFileSync(REPO_KATEX_PATH);
const katex = require(REPO_KATEX_PATH);

/** 读取夹具自己的 katex.min.js；内容与母版一致时复用已载入实例，改动过则即时求值，避免模块缓存滞留。 */
function loadKatex(templateDir) {
  const file = path.join(templateDir, 'vendor', 'katex', 'katex.min.js');
  const bytes = fs.readFileSync(file);
  if (bytes.equals(REPO_KATEX_BYTES)) return katex;
  return loadCjsModule(file, bytes.toString('utf8'));
}

/** KaTeX 的报错。它遇到不认识的字符时只印出那个字符本身，看不见的字符就什么也看不出来：换成说得清的话。 */
function mathFlaw(error, source) {
  if (!error.rawMessage.startsWith('Unexpected character') || error.position === undefined) return error.rawMessage;
  const char = String.fromCodePoint(source.codePointAt(error.position));
  const code = `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
  return `这里有一个 KaTeX 不认识的字符（${code}${/\p{L}|\p{N}|\p{P}|\p{S}/u.test(char) ? ` ${char}` : '，看不见'}）。全角的符号换成半角的，看不见的字符删掉`;
}

function checkMath(math, lesson, report, katexLib = katex) {
  if (math.name !== 'span' && math.name !== 'div') {
    report.error(math, 'math/markup', '公式要写成 <span class="math">（行内）或 <div class="math">（独立成行）');
    return;
  }
  const intruder = firstNonText(math);
  if (intruder) {
    report.error(intruder, 'math/markup', '公式里只能有文字。这里多半是前面的公式漏了结束标签');
    return;
  }
  try {
    katexLib.renderToString(textOf(math), { displayMode: math.name === 'div', throwOnError: true, strict: 'ignore' });
  } catch (error) {
    if (!(error instanceof katexLib.ParseError)) throw error;
    // position 是出错处在公式源码（解码后）里的下标；个别错误不带位置。
    const [text] = math.children;
    const position = error.position === undefined ? math : lesson.doc.locate(sourceOffset(text, error.position));
    report.error(position, 'math/syntax', `公式语法错误：${mathFlaw(error, textOf(math))}`);
  }
}

/** 指向本地文件的地址有什么问题；外部地址由 forbidden/external 报告，这里不重复。what 是“图片”“音频和视频”这样的说法。 */
function localFileFlaw(reference, site, what) {
  if (isExternal(reference)) return null;
  if (schemeOf(reference)) return `${what}必须是课程目录里的文件，不能用 data: 这类地址`;
  return site.hasFile(reference) ? null : `找不到 ${reference}：${what}要放在课程目录里`;
}

function checkImage(image, report, site) {
  if (!attrText(image, 'alt')) {
    report.error(image, 'img/alt', '<img> 必须有非空的 alt，说明图里是什么');
  }
  const src = attrText(image, 'src');
  const flaw = src === '' ? '<img> 缺少 src' : localFileFlaw(src, site, '图片');
  if (flaw) report.error(image, 'img/src', flaw);
}

/** 音频和视频只做最小的支持：课程目录里的一个文件，带着播放控件。 */
function checkPlayer(player, report, site) {
  if (getAttr(player, 'controls') === undefined) {
    report.error(player, 'player/controls', `<${player.name}> 要写上 controls：没有播放控件，读者没法播放`);
  }
  const src = attrText(player, 'src');
  const poster = attrText(player, 'poster');
  const flaw =
    src === ''
      ? `<${player.name}> 要用 src 指明文件，不支持在里面写 <source>`
      : (localFileFlaw(src, site, '音频和视频') ?? (poster && localFileFlaw(poster, site, '视频的封面图')));
  if (flaw) report.error(player, 'player/src', flaw);
}

function checkSvg(svg, report) {
  if (!getAttr(svg, 'viewBox')) {
    report.error(svg, 'svg/viewbox', '<svg> 必须有 viewBox（注意大小写），这样图才能随页面缩放');
  }
  const labelled = attr(svg, 'role') === 'img' && attrText(svg, 'aria-label') !== '';
  if (!labelled && attr(svg, 'aria-hidden') !== 'true') {
    report.warn(svg, 'svg/label', '<svg> 要用 role="img" 和 aria-label 说明内容；纯装饰的图写 aria-hidden="true"');
  }
}

const PLAYERS = ['audio', 'video'];

/** 图片、SVG、音频和视频要放在 <figure> 里：样式按“图”来排它（限宽、居中、可加图题），放在别处会把版面撑破。 */
function checkPlacement(media, report) {
  if (!closest(media, (element) => element.name === 'figure')) {
    report.error(media, 'media/figure', `<${media.name}> 要放在 <figure> 里（见契约 5.8），不能直接写在段落或小节里`);
  }
}

function checkMedia(lesson, report, site) {
  const templateDir = site?.templateDir;
  const isCustom = Boolean(templateDir && path.resolve(templateDir) !== TEMPLATE_DIR);
  const katexLib = isCustom ? (site.katex ??= loadKatex(templateDir)) : katex;
  for (const element of lesson.elements) {
    if (hasClass(element, 'math')) checkMath(element, lesson, report, katexLib);
    if (element.name === 'img') checkImage(element, report, site);
    if (element.name === 'svg') checkSvg(element, report);
    if (PLAYERS.includes(element.name)) checkPlayer(element, report, site);
    if (['img', 'svg', ...PLAYERS].includes(element.name)) checkPlacement(element, report);
  }
}

module.exports = { checkMedia };
