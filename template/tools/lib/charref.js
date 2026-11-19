'use strict';
/* 字符引用（&name;、&#123;、&#x1F;）的识别与解码。
 * 命名引用只收 HTML 4 的全部名字，外加 ASCII 标点的名字；其余名字一律当作无效引用。
 * 这样只要检查通过，这里解码出的文字就与浏览器里显示的完全一致。 */

// 码位连续的名字：从起始码位起依次排列。
const RUNS = [
  [0xa0, 'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr'],
  [0xb0, 'deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest'],
  [0xc0, 'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml'],
  [0xd0, 'ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig'],
  [0xe0, 'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml'],
  [0xf0, 'eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'],
  [0x391, 'Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho'],
  [0x3a3, 'Sigma Tau Upsilon Phi Chi Psi Omega'],
  [0x3b1, 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf'],
  [0x3c3, 'sigma tau upsilon phi chi psi omega'],
  [0x2190, 'larr uarr rarr darr harr'],
  [0x21d0, 'lArr uArr rArr dArr hArr'],
  [0x2308, 'lceil rceil lfloor rfloor']
];

// 零散的名字，写成"名字:十六进制码位"。
const SINGLES = [
  'quot:22 amp:26 apos:27 lt:3C gt:3E',
  'Tab:9 NewLine:A excl:21 num:23 dollar:24 percnt:25 lpar:28 rpar:29 ast:2A plus:2B comma:2C',
  'period:2E sol:2F colon:3A semi:3B equals:3D quest:3F commat:40 lsqb:5B lbrack:5B bsol:5C',
  'rsqb:5D rbrack:5D Hat:5E lowbar:5F grave:60 lcub:7B lbrace:7B verbar:7C vert:7C rcub:7D rbrace:7D',
  'OElig:152 oelig:153 Scaron:160 scaron:161 Yuml:178 fnof:192 circ:2C6 tilde:2DC',
  'thetasym:3D1 upsih:3D2 piv:3D6',
  'ensp:2002 emsp:2003 thinsp:2009 zwnj:200C zwj:200D lrm:200E rlm:200F',
  'ndash:2013 mdash:2014 lsquo:2018 rsquo:2019 sbquo:201A ldquo:201C rdquo:201D bdquo:201E',
  'dagger:2020 Dagger:2021 bull:2022 hellip:2026 permil:2030 prime:2032 Prime:2033',
  'lsaquo:2039 rsaquo:203A oline:203E frasl:2044 euro:20AC',
  'image:2111 weierp:2118 real:211C trade:2122 alefsym:2135 crarr:21B5',
  'forall:2200 part:2202 exist:2203 empty:2205 nabla:2207 isin:2208 notin:2209 ni:220B',
  'prod:220F sum:2211 minus:2212 lowast:2217 radic:221A prop:221D infin:221E ang:2220',
  'and:2227 or:2228 cap:2229 cup:222A int:222B there4:2234 sim:223C cong:2245 asymp:2248',
  'ne:2260 equiv:2261 le:2264 ge:2265 sub:2282 sup:2283 nsub:2284 sube:2286 supe:2287',
  'oplus:2295 otimes:2297 perp:22A5 sdot:22C5 lang:27E8 rang:27E9',
  'loz:25CA spades:2660 clubs:2663 hearts:2665 diams:2666'
];

const NAMED = new Map();
for (const [start, names] of RUNS) {
  names.split(' ').forEach((name, index) => NAMED.set(name, String.fromCodePoint(start + index)));
}
for (const pair of SINGLES.join(' ').split(' ')) {
  const [name, hex] = pair.split(':');
  NAMED.set(name, String.fromCodePoint(parseInt(hex, 16)));
}

const CHAR_REF = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));/y;

// 浏览器并不按字面解码所有编号：0、代理区和超出范围的值变成 U+FFFD，
// 0x80–0x9F 按 Windows-1252 改写。这些都当作无效引用。
function numericValue(codePoint) {
  const literal =
    codePoint > 0 &&
    codePoint <= 0x10ffff &&
    !(codePoint >= 0xd800 && codePoint <= 0xdfff) &&
    !(codePoint >= 0x80 && codePoint <= 0x9f);
  return literal ? String.fromCodePoint(codePoint) : undefined;
}

/** text 在 index 处若是一个有效的字符引用，返回它的长度和解码结果；否则返回 null。 */
function matchCharRef(text, index) {
  CHAR_REF.lastIndex = index;
  const match = CHAR_REF.exec(text);
  if (!match) return null;
  const [whole, decimal, hex, name] = match;
  const value = name ? NAMED.get(name) : numericValue(parseInt(decimal || hex, decimal ? 10 : 16));
  return value === undefined ? null : { length: whole.length, value };
}

/** 解码 raw 里的字符引用；每遇到一个无效的 & 就调用 onInvalid(它在 raw 里的下标)。 */
function decodeCharRefs(raw, onInvalid) {
  let decoded = '';
  let done = 0;
  for (let amp = raw.indexOf('&'); amp !== -1; amp = raw.indexOf('&', done)) {
    const ref = matchCharRef(raw, amp);
    decoded += raw.slice(done, amp) + (ref ? ref.value : '&');
    done = amp + (ref ? ref.length : 1);
    if (!ref) onInvalid(amp);
  }
  return decoded + raw.slice(done);
}

module.exports = { matchCharRef, decodeCharRefs };
