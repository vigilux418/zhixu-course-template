/* 三个小组件：步进演示、选项卡、任务清单。 */

import { $$, h, icon, revealable } from './dom.js';
import { hash } from './plain.js';
import { page } from './course.js';
import { onClear } from './boot.js';
import { record, update } from './store.js';

/** 步进演示：每个 figure 是一帧，按钮在帧之间切换。所有帧叠在同一格里，高度取最高的一帧。 */
export function enhanceSteppers(main) {
  for (const el of $$('div.stepper', main)) {
    const frames = $$(':scope > figure', el);
    const prev = h('button.zx-btn', { type: 'button' }, icon('prev'), '上一步');
    const next = h('button.zx-btn', { type: 'button' }, '下一步', icon('next'));
    const count = h('span.zx-stepper-count', { 'aria-live': 'polite' });
    const go = (index) => {
      frames.forEach((frame, position) => frame.classList.toggle('is-current', position === index));
      el.dataset.step = index + 1;
      count.textContent = `${index + 1} / ${frames.length}`;
      prev.disabled = index === 0;
      next.disabled = index === frames.length - 1;
    };
    prev.addEventListener('click', () => go(Number(el.dataset.step) - 2));
    next.addEventListener('click', () => go(Number(el.dataset.step)));
    el.dataset.label = '演示';
    el.append(h('div.zx-stepper-bar', null, prev, count, next));
    frames.forEach((frame, index) => revealable(frame, () => go(index)));
    go(0);
  }
}

/**
 * 选项卡：读者选过的名字会被记住，全课同名的选项卡一起切换。
 * 返回一个函数：把每一组的指示条放到选中的选项卡下面。它要量尺寸，所以留给调用的人在页面改完之后再做。
 */
export function enhanceTabs(main) {
  const groups = $$('div.tabs', main).map((el, order) => {
    const panels = $$(':scope > [data-tab]', el);
    const tabs = panels.map((panel, index) => {
      const id = `zx-tab-${order + 1}-${index + 1}`;
      panel.id ||= `zx-tabpanel-${order + 1}-${index + 1}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', id);
      return h('button.zx-tab', { type: 'button', role: 'tab', id, 'aria-controls': panel.id }, panel.dataset.tab);
    });
    const list = h('div.zx-tablist', { role: 'tablist' }, tabs);
    el.classList.add('zx-tabs');
    el.prepend(list);
    return { list, panels, tabs, labels: panels.map((panel) => panel.dataset.tab) };
  });

  /** 选中 label 这一个：亮出它的面板。指示条不在这里挪。 */
  const select = (group, label) => {
    group.panels.forEach((panel, index) => {
      const on = panel.dataset.tab === label;
      panel.hidden = !on;
      group.tabs[index].setAttribute('aria-selected', String(on));
      group.tabs[index].tabIndex = on ? 0 : -1;
    });
  };

  /** 指示条挪到选中的那个选项卡下面。 */
  const underline = ({ list, tabs }) => {
    const tab = tabs.find((item) => item.tabIndex === 0);
    list.style.setProperty('--tab-x', `${tab.offsetLeft}px`);
    list.style.setProperty('--tab-w', `${tab.offsetWidth}px`);
  };

  /** 读者换到 label：全课同名的一起换。 */
  const choose = (label) => {
    update((data) => {
      data.tabs = [label, ...data.tabs.filter((name) => name !== label)].slice(0, 12);
    });
    for (const group of groups.filter((item) => item.labels.includes(label))) {
      select(group, label);
      underline(group);
    }
  };

  // 还没显示出来的选项卡量不出宽度（比如写在小测的解析里，揭晓之前不占地方）：这一排的尺寸一变，指示条重新就位
  const resized = new ResizeObserver((entries) => {
    for (const { target } of entries) underline(groups.find((group) => group.list === target));
  });
  onClear(() => resized.disconnect());

  const preferred = record().tabs;
  for (const group of groups) {
    select(group, preferred.find((label) => group.labels.includes(label)) ?? group.labels[0]);
    resized.observe(group.list);
    for (const panel of group.panels) {
      revealable(panel, () => {
        select(group, panel.dataset.tab);
        underline(group);
      });
    }
    group.tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => choose(group.labels[index]));
      tab.addEventListener('keydown', (event) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
        if (!step) return;
        const target = group.tabs[(index + step + group.tabs.length) % group.tabs.length];
        target.focus();
        target.click();
      });
    });
  }
  return () => groups.forEach(underline);
}

/** 读出每项任务的键（任务 → 键）：按作者写下的任务文字算，所以要趁页面还没被改写时读。 */
export function readTasks(main) {
  return new Map($$('ul.tasks > li', main).map((item) => [item, hash(item.textContent.trim())]));
}

/** 任务清单：勾选状态按任务的键保存。 */
export function enhanceTasks(main, keys) {
  const done = new Set(record().tasks[page.file]);
  for (const list of $$('ul.tasks', main)) {
    list.classList.add('zx-tasks');
    for (const item of list.children) {
      const key = keys.get(item);
      const input = h('input', { type: 'checkbox', checked: done.has(key) });
      input.addEventListener('change', () => {
        update((data) => {
          const keys = new Set(data.tasks[page.file]);
          if (input.checked) keys.add(key);
          else keys.delete(key);
          data.tasks[page.file] = [...keys];
        });
      });
      item.append(h('label.zx-task', null, input, h('span.zx-box'), h('span.zx-task-text', null, ...item.childNodes)));
    }
  }
}
