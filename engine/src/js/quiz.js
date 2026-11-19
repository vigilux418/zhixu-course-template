/* 小测：单选、多选、填空、自评。
 * 第一次答错先给提示，再错才揭晓；成绩按“第一次是否答对”记录，答错的题进入首页的错题回顾。
 * 判分在 grading.js 里。这里只管页面：每道题有一个 phase，页面照着 phase 画，不从页面读回状态。 */

import { $, $$, composing, h, today } from './dom.js';
import { dict, hash, own } from './plain.js';
import { page } from './course.js';
import { record, update } from './store.js';
import { answerText, kindOf, phaseAfter } from './grading.js';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const KIND_NAMES = { choice: '单选', multi: '多选', fill: '填空', self: '自评' };
const optionList = (el) => $$(':scope > ol', el).pop();

/**
 * 读出这一讲的小测：{ el, key, stem }。key 是学习记录里这道题的身份，stem 是作者写下的题干。
 * 要趁页面还是作者写的样子来读：别的组件后来加进去的文字（旁注序号、自动填上的编号）不能混进题干。
 */
export function readQuizzes(main) {
  return $$('div.quiz', main).map((el) => {
    const list = optionList(el);
    const stem = [...el.children]
      .filter((child) => child !== list && !child.matches('.hint, .explain'))
      .map((child) => child.textContent)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { el, stem, key: el.id || `q${hash(stem)}` };
  });
}

/** 把读出来的小测变成可以作答的题；成绩变化时调用 onChange。 */
export function enhanceQuizzes(main, quizzes, onChange) {
  quizzes.forEach((quiz, index) => setup(quiz, index + 1, onChange));
  if (quizzes.length) main.append(answerSheet(quizzes));
}

/** 本讲小测的成绩：{ total, right }。 */
export function quizScore(quizzes) {
  const saved = record().quiz[page.file] ?? dict();
  return { total: quizzes.length, right: quizzes.filter((quiz) => own(saved, quiz.key)?.ok).length };
}

function setup({ el, key, stem }, number, onChange) {
  const list = optionList(el);
  const answer = el.dataset.answer ?? '';
  const kind = kindOf(Boolean(list), answer);
  const hint = $(':scope > .hint', el);
  const explain = $(':scope > .explain', el);
  const question = { kind, answer, hasHint: Boolean(hint) };

  el.id ||= `zx-quiz-${key}`;
  el.dataset.key = key;
  el.dataset.kind = kind;
  el.dataset.label = `小测 ${number} · ${KIND_NAMES[kind]}`;
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', el.dataset.label);

  const options = [...(list?.children ?? [])].map((item, index) => {
    const input = h('input', { type: kind === 'multi' ? 'checkbox' : 'radio', name: el.id, value: LETTERS[index] });
    item.append(h('label.zx-opt', null, input, h('span', null, ...item.childNodes)));
    return { item, input };
  });
  const field =
    kind === 'fill' ? h('input.zx-fill', { type: 'text', autocomplete: 'off', 'aria-label': '你的答案' }) : null;
  const action = h('button.zx-btn', { type: 'button' });
  const verdicts =
    kind === 'self'
      ? [h('button.zx-btn', { type: 'button' }, '我答对了'), h('button.zx-btn', { type: 'button' }, '没答对')]
      : [];
  const status = h('span.zx-quiz-status', { role: 'status' });
  const bar = h('div.zx-quiz-bar', null, field, action, verdicts, status);
  if (explain) explain.before(bar);
  else el.append(bar);

  /* 这道题走到了哪一步：
   * idle 待答 → retry 给了提示、再答一次 → right / wrong 已揭晓；自评题是 idle → reference 对照答案 → right / wrong。 */
  let phase = 'idle';
  let tries = 0;

  /** 照着 phase 把题目画出来；message 是这一步对读者说的话。 */
  function paint(message) {
    const revealed = phase === 'right' || phase === 'wrong';
    el.dataset.state = phase;
    status.textContent = message;
    for (const { item, input } of options) {
      input.disabled = revealed;
      if (!revealed) delete item.dataset.mark;
      else if (answer.split(',').includes(input.value)) item.dataset.mark = 'right';
      else if (input.checked) item.dataset.mark = 'wrong';
    }
    if (field) field.disabled = revealed;
    if (hint) hint.hidden = phase !== 'retry';
    if (explain) explain.hidden = !revealed && phase !== 'reference';
    for (const button of verdicts) button.hidden = phase !== 'reference';
    action.hidden = phase === 'reference';
    action.textContent = revealed ? '重做' : kind === 'self' ? '看参考答案' : '检查答案';
  }

  function restart() {
    for (const { input } of options) input.checked = false;
    if (field) field.value = '';
    phase = 'idle';
    tries = 0;
    paint('');
  }

  /** 这道题答完了：记下成绩（只认第一次），揭晓答案。 */
  function settle(right, message) {
    phase = right ? 'right' : 'wrong';
    update((data) => {
      data.quiz[page.file] ??= dict();
      data.quiz[page.file][key] = { ok: right && tries === 1, at: today(), stem: stem.slice(0, 80), id: el.id };
    });
    paint(message);
    onChange();
  }

  function check() {
    const given = field
      ? field.value
      : options
          .filter(({ input }) => input.checked)
          .map(({ input }) => input.value)
          .join(',');
    if (!given.trim()) {
      paint(field ? '先填写答案' : '先选一个选项');
      return;
    }
    tries += 1;
    const next = phaseAfter(question, tries, given);
    if (next === 'retry') {
      phase = next;
      paint('不对，再想想');
    } else if (next === 'right') {
      settle(true, tries === 1 ? '回答正确' : '这次对了');
    } else {
      settle(false, `正确答案：${answerText(kind, answer)}`);
    }
  }

  action.addEventListener('click', () => {
    if (phase === 'right' || phase === 'wrong') {
      restart();
    } else if (kind === 'self') {
      phase = 'reference';
      paint('对照参考答案，自己判断');
    } else {
      check();
    }
  });
  verdicts.forEach((button, index) => {
    button.addEventListener('click', () => {
      tries = 1;
      settle(index === 0, index === 0 ? '记为答对' : '记为没答对');
    });
  });
  field?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !composing(event)) check();
  });

  // 作者可以给题写 id="constructor" 这样的名字：键只在对象自己的属性里找
  const saved = own(record().quiz[page.file] ?? dict(), key);
  if (saved) phase = saved.ok ? 'right' : 'wrong';
  paint(!saved ? '' : saved.ok ? '上次答对了' : '上次没答对，可以重做');
}

/** 参考答案页：只在打印时出现。 */
function answerSheet(quizzes) {
  const items = quizzes.map(({ el }) => {
    const answer = el.dataset.answer;
    const explain = $(':scope > .explain', el);
    const item = h('li', null, answer && h('strong', null, answerText(el.dataset.kind, answer)));
    if (explain) item.append(...[...explain.cloneNode(true).childNodes]);
    return item;
  });
  return h('section.zx-answers', null, h('h2', null, '参考答案'), h('ol', null, items));
}
