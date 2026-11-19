'use strict';
/* 页面体检：在浏览器里运行的一个函数，找出这一页上看得见的版面问题。
 * zx look 和引擎的端到端验收都用它，各自负责把它送进页面。
 * 它会被转成字符串注入页面，所以函数体不能引用外面的任何东西。 */

/**
 * 返回 [{ rule, message }]。同一句话可能出现多次，由调用方合并。
 * only：只做这几项检查（规则名的数组）；不传就全做。
 */
function checkup(only) {
  const issues = [];
  const report = (rule, message) => issues.push({ rule, message });
  const html = document.documentElement;
  const main = document.querySelector('main') ?? document.body; // 首页启动后没有 <main>
  const range = document.createRange();
  const CLOSERS = '，。、；：？！）》」』”’';
  // 行内代码里的西文标点：前面不是空白时，它也不该落到行首（空白后面的标点是作者写的）
  const ASCII_CLOSERS = ',.;:?!)]%';

  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible';
  const place = (el) => {
    const heading = el.closest('main > section')?.querySelector('h2');
    return heading ? `“${heading.textContent.trim().slice(0, 14)}”一节` : '页面';
  };
  const name = (el) => {
    const classes = [...el.classList]
      .slice(0, 2)
      .map((item) => `.${item}`)
      .join('');
    return `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${classes}>`;
  };
  /** 所在的块：行是在它里面排的。返回 { el, left, top, size }，left 和 top 是内容区的左上角。 */
  const blockOf = (el) => {
    let block = el;
    while (getComputedStyle(block).display === 'inline') block = block.parentElement;
    const style = getComputedStyle(block);
    const box = block.getBoundingClientRect();
    return {
      el: block,
      left: box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
      top: box.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
      size: parseFloat(style.fontSize)
    };
  };
  /** 第 index 个字符在屏幕上的位置；它没有显示出来时返回 undefined。 */
  const charRect = (node, index) => {
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    return range.getClientRects()[0];
  };
  /** 一个元素里的文字排成了几行。 */
  const lineCount = (el) => {
    const texts = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const tops = [];
    for (let node = texts.nextNode(); node; node = texts.nextNode()) {
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) if (rect.width > 1 && rect.height > 1) tops.push(rect.top);
    }
    tops.sort((a, b) => a - b);
    const size = parseFloat(getComputedStyle(el).fontSize);
    return tops.reduce(
      (count, top, index) => (index === 0 || top - tops[index - 1] > size * 0.6 ? count + 1 : count),
      0
    );
  };
  /** 正文里的文字节点（代码、公式、图里的不算）。 */
  const proseTexts = function* (root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.parentElement.closest('pre, .katex, svg, textarea, button')) yield node;
    }
  };

  const checks = {
    'boot/failed'() {
      if (!html.classList.contains('zx-failed')) return;
      report('boot/failed', document.querySelector('.zx-alert')?.textContent.trim() ?? '引擎启动失败');
    },

    'page/overflow'() {
      if (html.scrollWidth <= innerWidth + 1) return;
      const clipped = (el) => {
        for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
          if (getComputedStyle(node).overflowX !== 'visible') return true;
        }
        return false;
      };
      const wide = [...document.querySelectorAll('body *')].filter(
        (el) => visible(el) && el.getBoundingClientRect().right > innerWidth + 1 && !clipped(el)
      );
      const outer = wide.filter((el) => !wide.includes(el.parentElement)).slice(0, 3);
      const culprits = outer.map((el) => `${place(el)}的 ${name(el)}`).join('、');
      report(
        'page/overflow',
        `整页可以横向滚动（内容宽 ${html.scrollWidth}，视口宽 ${innerWidth}）；撑开它的是${culprits}`
      );
    },

    'cells/wrap'() {
      for (const cells of main.querySelectorAll('.cells')) {
        if (!visible(cells)) continue;
        const rows = new Set(
          [...cells.children].filter(visible).map((cell) => Math.round(cell.getBoundingClientRect().top))
        );
        if (rows.size > 1) {
          report('cells/wrap', `${place(cells)}：${cells.children.length} 个格子折成了 ${rows.size} 排`);
        }
      }
    },

    'control/wrap'() {
      for (const control of main.querySelectorAll('button, .zx-stepper-count')) {
        if (!visible(control) || !control.textContent.trim()) continue;
        const lines = lineCount(control);
        if (lines > 1) {
          report('control/wrap', `${place(control)}：“${control.textContent.trim()}”折成了 ${lines} 行`);
        }
      }
    },

    'table/crushed'() {
      for (const table of main.querySelectorAll('table')) {
        if (!visible(table)) continue;
        const crushed = [...table.querySelectorAll('th, td')].filter((cell) => {
          const style = getComputedStyle(cell);
          const inner = cell.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
          return cell.textContent.trim().length > 1 && inner < parseFloat(style.fontSize) * 2;
        });
        if (crushed.length) {
          const sample = crushed[0].textContent.trim().slice(0, 8);
          report(
            'table/crushed',
            `${place(table)}：表格有 ${crushed.length} 个单元格每行放不下两个字（如“${sample}”）`
          );
        }
      }
    },

    /* 以收尾标点开头的行 */
    'line/orphan-punct'() {
      for (const node of proseTexts(main)) {
        for (let index = 0; index < node.data.length; index += 1) {
          const char = node.data[index];
          const ascii = ASCII_CLOSERS.includes(char);
          if (!CLOSERS.includes(char) && !ascii) continue;
          const rect = charRect(node, index);
          if (!rect || getComputedStyle(node.parentElement).visibility !== 'visible') continue;
          const block = blockOf(node.parentElement);
          if (Math.abs(rect.left - block.left) >= 2 || rect.top - block.top < block.size * 0.6) continue;
          const lead = document.createRange();
          lead.setStart(block.el, 0);
          lead.setEnd(node, index);
          const text = lead.toString();
          if (ascii && (!text || /\s$/.test(text))) continue;
          // 文件名在扩展名前断开（find_max_position.py）是正常的断法
          if (
            char === '.' &&
            /[A-Za-z]/.test(node.data[index - 1] ?? '') &&
            /[A-Za-z]/.test(node.data[index + 1] ?? '')
          ) {
            continue;
          }
          const before = text.replace(/\s+/g, ' ').slice(-10);
          const after = node.data.slice(index + 1, index + 5);
          report('line/orphan-punct', `${place(block.el)}：有一行以“${char}”开头（…${before}【${char}】${after}…）`);
        }
      }
    },

    /* 以开引号、开括号结尾的行：后面的字掉到了下一行 */
    'line/orphan-open'() {
      const OPENERS = '（《〈【〔［｛“‘「『([{';
      for (const node of proseTexts(main)) {
        for (let index = 0; index < node.data.length; index += 1) {
          if (!OPENERS.includes(node.data[index])) continue;
          const rect = charRect(node, index);
          if (!rect || getComputedStyle(node.parentElement).visibility !== 'visible') continue;
          const next = upcoming(node, index);
          if (!next || next.top <= rect.top + rect.height / 2) continue;
          report(
            'line/orphan-open',
            `${place(node.parentElement)}：有一行以“${node.data[index]}”结尾（…${node.data.slice(Math.max(0, index - 8), index + 1)}【下一行】…）`
          );
        }
      }
      /** 这个字符后面下一个看得见的字在哪：先看同一个文字节点里，再看后面的兄弟。空格、换行、注释跳过。 */
      function upcoming(node, index) {
        const rect = (text, at) => {
          range.setStart(text, at);
          range.setEnd(text, at + 1);
          return range.getClientRects()[0];
        };
        if (!/\s/.test(node.data[index + 1] ?? '')) return node.data[index + 1] ? rect(node, index + 1) : null;
        for (let sibling = node.parentElement.nextSibling; sibling; sibling = sibling.nextSibling) {
          if (sibling.nodeType === Node.TEXT_NODE) {
            const at = sibling.data.search(/\S/);
            if (at >= 0) return rect(sibling, at);
            continue;
          }
          if (sibling.nodeType !== Node.ELEMENT_NODE || sibling.tagName === 'WBR') continue;
          const box = sibling.getClientRects()[0];
          if (box) return box;
        }
        return null;
      }
    },

    /* 以旁注序号开头的行。量的是读者看见的那个数字（按钮），不是 <sup> 的第一块：
     * <sup> 开头有一个不占地方的词连接符，它留在上一行、数字掉到下一行的时候，第一块在上一行的行尾 */
    'line/orphan-ref'() {
      for (const ref of main.querySelectorAll('sup.zx-ref')) {
        if (!visible(ref)) continue;
        const block = blockOf(ref.parentElement);
        if (Math.abs(ref.querySelector('button').getBoundingClientRect().left - block.left) < 2) {
          report('line/orphan-ref', `${place(ref)}：旁注 ${ref.textContent.trim()} 的序号落在了行首`);
        }
      }
    },

    /* 两端对齐的行被拉开：汉字占的宽度比字号多出一半以上 */
    'line/stretched'() {
      for (const block of main.querySelectorAll('p')) {
        const style = getComputedStyle(block);
        if (style.textAlign !== 'justify' || !visible(block)) continue;
        const limit = parseFloat(style.fontSize) * 1.5;
        search: for (const node of proseTexts(block)) {
          for (let index = 0; index < node.data.length; index += 1) {
            if (!/\p{Script=Han}/u.test(node.data[index]) || !(charRect(node, index)?.width > limit)) continue;
            const near = node.data.slice(Math.max(0, index - 4), index + 5);
            report('line/stretched', `${place(block)}：有一行的字距被两端对齐拉开了（“${near}”附近）`);
            break search;
          }
        }
      }
    },

    /* 图里的文字伸出了画面：伸出去的部分会被裁掉 */
    'svg/text-out'() {
      for (const svg of main.querySelectorAll('svg')) {
        if (!visible(svg)) continue;
        const frame = svg.getBoundingClientRect();
        for (const text of svg.querySelectorAll('text')) {
          const box = text.getBoundingClientRect();
          const out = Math.max(
            frame.left - box.left,
            box.right - frame.right,
            frame.top - box.top,
            box.bottom - frame.bottom
          );
          if (box.width > 0 && out > 1.5) {
            const words = text.textContent.trim().slice(0, 12);
            report('svg/text-out', `${place(svg)}：图里的文字“${words}”有 ${Math.round(out)} 像素伸出了画面`);
          }
        }
      }
    },

    /* 图里的两段文字叠在一起 */
    'svg/text-overlap'() {
      for (const svg of main.querySelectorAll('svg')) {
        if (!visible(svg)) continue;
        const texts = [...svg.querySelectorAll('text')]
          .map((text) => ({ words: text.textContent.trim().slice(0, 12), box: text.getBoundingClientRect() }))
          .filter(({ box }) => box.width > 0);
        texts.forEach((first, index) => {
          for (const second of texts.slice(index + 1)) {
            const width = Math.min(first.box.right, second.box.right) - Math.max(first.box.left, second.box.left);
            const height = Math.min(first.box.bottom, second.box.bottom) - Math.max(first.box.top, second.box.top);
            if (width > 2 && height > Math.min(first.box.height, second.box.height) / 2) {
              report('svg/text-overlap', `${place(svg)}：图里的“${first.words}”和“${second.words}”叠在了一起`);
            }
          }
        });
      }
    },

    'media/broken'() {
      for (const image of main.querySelectorAll('img')) {
        if (image.complete && image.naturalWidth === 0) {
          report('media/broken', `${place(image)}：图片没有加载出来（${image.getAttribute('src')}）`);
        }
      }
    }
  };

  for (const [rule, run] of Object.entries(checks)) if (!only || only.includes(rule)) run();
  return issues;
}

module.exports = { checkup };
