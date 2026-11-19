/* 印章：读完一讲盖一枚。四个字按传统顺序排成两列，先右后左。
 * 滤镜让边缘略微不齐、印面带一点飞白，像真的按在纸上。 */

import { parse } from './dom.js';

export function seal(text, fresh = false) {
  const [a, b, c, d] = text;
  return parse(`<svg class="zx-seal${fresh ? ' is-fresh' : ''}" viewBox="0 0 100 100" role="img" aria-label="${text}">
<filter id="zx-ink" x="-10%" y="-10%" width="120%" height="120%">
<feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="2" seed="4" result="warp"/>
<feDisplacementMap in="SourceGraphic" in2="warp" scale="3" result="edge"/>
<feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves="1" seed="9"/>
<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -8 5.5"/>
<feComposite in="edge" operator="in"/>
</filter>
<g filter="url(#zx-ink)">
<rect x="7" y="7" width="86" height="86" rx="10"/>
<text x="69" y="45">${a}</text><text x="69" y="81">${b}</text><text x="31" y="45">${c}</text><text x="31" y="81">${d}</text>
</g>
</svg>`);
}
