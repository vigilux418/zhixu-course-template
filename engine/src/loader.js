/* 知序加载器：每个页面 <head> 里唯一的脚本，同步执行。它负责四件事：
 *   1. 按读者的设置定好主题和字号，页面不会闪一下；
 *   2. 回答“当前是哪一页、课程里的链接怎么写、引擎的文件从哪来”——运行时只从这里知道这些；
 *   3. 提前加载内置字体，把课程数据、这一页用到的第三方库和运行时送进页面，让它们在第一帧之前执行完；
 *   4. 启动失败时在页面顶部说明原因，正文照常可读。
 * 课程有两种形态，差别全部收在这个文件里：
 *   文件夹：每一讲是一个 HTML 文件，引擎的文件在 template/ 下；
 *   单文件（zx pack 导出的）：整门课在一个 HTML 里，各页的正文和引擎的文件都嵌在 #zx-pack 那段数据里，
 *   课程里的链接写成 #文件名/锚点；点下去以后，现在是哪一页随即挪进 history.state，地址里不留 #。
 *   换页在页面里换。实测有安卓设备从文件管理器打开后，携带片段重新载入会报 ERR_FILE_NOT_FOUND。
 *   这里只告诉运行时“换到哪一页”（ZHIXU.onTurn），怎么换是运行时的事。
 * 语法特意写得保守：它要在很旧的浏览器里也能跑起来，把话说清楚。 */
(function () {
  'use strict';

  var root = document.documentElement;
  var self = document.currentScript;
  /* 单文件里嵌着的全部内容：{ pages: { 文件名: { title, body } }, files: { 路径: 文字 } }；文件夹形态没有它 */
  var pack = self.hasAttribute('data-packed') ? JSON.parse(document.getElementById('zx-pack').textContent) : null;
  var base = self.src.replace(/[^/]*$/, '');
  var forcedTheme = new URLSearchParams(location.search).get('theme');
  var systemDark = matchMedia('(prefers-color-scheme: dark)');
  var requested = Object.create(null); // 已经引入的文件 → 它的 Promise
  var settlers = Object.create(null); // 启动阶段写进页面的脚本 → [成功, 失败]，由标签上的 onload、onerror 调用
  var entrySerial = 0;
  var activeEntry;
  var scrollByEntry = Object.create(null);
  var pendingScroll;
  var FEATURES = {
    code: ['vendor/highlight/highlight.min.js'],
    math: ['vendor/katex/katex.min.css', 'vendor/katex/katex.min.js']
  };
  /* 解析完再执行，执行完之前不画第一帧：读者看到的第一帧就是做完全部增强的页面。 */
  var DEFERRED = ' defer blocking="render"';

  /* 浏览器可能禁用存储（隐私模式等），读写失败时退回默认值即可。
   * area 是 'localStorage'（默认，长期保存）或 'sessionStorage'（只在这个标签页里从一页带到下一页）。 */
  function read(key, area) {
    try {
      return JSON.parse(window[area || 'localStorage'].getItem(key));
    } catch (error) {
      return null;
    }
  }

  function write(key, value, area) {
    try {
      window[area || 'localStorage'].setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function prefs() {
    return Object.assign({ theme: 'auto', font: 'serif', size: 17, side: true }, read('zhixu:prefs'));
  }

  function applyPrefs() {
    var current = prefs();
    var theme = forcedTheme || current.theme;
    root.dataset.theme = theme === 'auto' ? (systemDark.matches ? 'dark' : 'light') : theme;
    root.dataset.font = current.font;
    root.style.setProperty('--read', current.size + 'px');
  }

  /* 启动失败时不留白屏：正文照常显示，并在页面顶部说明原因。只显示最先发生的那个原因。 */
  function fail(message) {
    function show() {
      var alert = document.createElement('p');
      alert.className = 'zx-alert';
      alert.setAttribute('role', 'alert');
      alert.textContent = '知序没有正常启动：' + message + '。正文仍可阅读。';
      document.body.prepend(alert);
    }
    console.error('[知序] ' + message);
    if (root.classList.contains('zx-failed')) return;
    root.classList.add('zx-failed');
    root.classList.remove('zx-loading');
    if (document.body) show();
    else document.addEventListener('DOMContentLoaded', show);
  }

  /* —— 地址：当前是哪一页，课程里的一页怎么写成链接，现在在哪个锚点，怎么过去 ——
   * 文件名和 id 按契约只有小写字母、数字和连字符，所以地址不需要解码。 */

  /**
   * 单文件形态下，现在是哪一页、哪个锚点：[文件名, 锚点]。链接写成 #文件名/锚点，点下去的那一刻在地址的 # 后面；
   * 随即挪进 history.state，刷新用原文件地址。前进后退也从 history.state 取讲次和锚点。
   */
  function route() {
    if (location.hash) return location.hash.slice(1).split('/');
    return (history.state && history.state.zx) || [];
  }

  function settleRoute() {
    var state = history.state;
    if (location.hash || !state || !state.zxEntry) {
      state = { zx: route(), zxEntry: performance.timeOrigin + ':' + ++entrySerial };
      var address = location.hash ? location.href.split('#')[0] : undefined;
      history.replaceState(state, '', address);
    }
    activeEntry = state.zxEntry;
    history.scrollRestoration = 'manual';
  }

  /** 同一路由可以打开多次。只在离开时按历史条目记录位置，避免滚动期间反复写入。 */
  function rememberScroll() {
    if (!root.classList.contains('zx-ready')) return;
    var top = scrollY;
    scrollByEntry[activeEntry] = top;
    write('zhixu:scroll:' + activeEntry, top, 'sessionStorage');
  }

  /** 禁用会话存储时，本次文档内仍可依靠内存记录前进后退。 */
  function savedScroll() {
    var top = scrollByEntry[activeEntry];
    if (top === undefined) top = read('zhixu:scroll:' + activeEntry, 'sessionStorage');
    if (typeof top === 'number') return top;
    if (!anchor()) return 0;
  }

  /** 正文布局就绪后取一次历史位置。换讲期间，上一讲不能取走下一讲的位置。 */
  function takeHistoryScroll() {
    if (pendingScroll === undefined || pageFile() !== ZHIXU.file) return;
    var top = pendingScroll;
    pendingScroll = undefined;
    return top;
  }

  /** 单文件里某一页的正文和标题：换页时运行时从这里取，不再读一遍文件。 */
  function pagePart(name, part) {
    return pack.pages[name][part];
  }

  /** 现在是哪一页：单文件里看 route()，不在课程里的回首页。每次问都要重新算，换页时它会变。 */
  function pageFile() {
    if (!pack) return location.pathname.split('/').pop() || 'index.html';
    var name = route()[0] || 'index.html';
    return pack.pages[name] ? name : 'index.html';
  }

  var file = pageFile();

  function url(page, id) {
    if (pack) return '#' + page + (id ? '/' + id : '');
    /* 指向本页某处的链接只写锚点：点它不会重新载入页面，也不会丢掉地址里的参数 */
    if (page === file && id) return '#' + id;
    return page + (id ? '#' + id : '');
  }

  function anchor() {
    return pack ? route()[1] || '' : location.hash.slice(1);
  }

  function go(page, id) {
    location.href = url(page, id);
  }

  /** 单文件里换到 name 这一页：运行时在页面里换。它没能运行起来的话（这时页面上只有正文），
   * 退回原来的办法：重新载入（地址里没有 #，载入得了），按 history.state 把那一页写出来。 */
  function turnTo(name) {
    if (ZHIXU.onTurn) ZHIXU.onTurn(name);
    else location.reload();
  }

  /** 当前正文还在装配时，同一讲也要通知队列，避免旧请求盖过这次选择。 */
  function mountRoute() {
    var name = pageFile();
    if (name === ZHIXU.file && (!ZHIXU.onTurn || root.classList.contains('zx-ready'))) return false;
    turnTo(name);
    return true;
  }

  /* —— 文件：引擎的脚本和样式表 —— */

  function isStyle(path) {
    return /\.css$/.test(path);
  }

  /** 单文件形态：文件就嵌在页面里，取出来放进一个 <script> 或 <style>，立刻执行或生效。 */
  function embed(path) {
    var el = document.createElement(isStyle(path) ? 'style' : 'script');
    el.textContent = pack.files[path];
    document.head.appendChild(el);
  }

  /** 文件夹形态：从 template/ 下取。 */
  function fetched(path) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement(isStyle(path) ? 'link' : 'script');
      if (isStyle(path)) el.rel = 'stylesheet';
      el[isStyle(path) ? 'href' : 'src'] = base + path;
      el.onload = resolve;
      el.onerror = function () {
        reject(new Error('无法加载 ' + path));
      };
      document.head.appendChild(el);
    });
  }

  /** 按需引入一个文件；同一个文件只引入一次。 */
  function load(path) {
    if (!requested[path]) requested[path] = pack ? Promise.resolve(embed(path)) : fetched(path);
    return requested[path];
  }

  /** 一项功能（code 是代码着色，math 是公式）需要的全部文件。 */
  function need(feature) {
    return Promise.all(FEATURES[feature].map(load));
  }

  /** 启动阶段直接写进页面的一个文件；写进去的算作已经引入，之后 load 不会再引入一遍。 */
  function written(path, attributes) {
    if (isStyle(path)) {
      requested[path] = Promise.resolve();
      return '<link rel="stylesheet" href="' + base + path + '">';
    }
    requested[path] = new Promise(function (resolve, reject) {
      settlers[path] = [resolve, reject];
    });
    /* 没有人等它的时候，失败也已经由 missing 报过了 */
    requested[path].catch(function () {
      return null;
    });
    var handlers = ' data-path="' + path + '" onload="ZHIXU.arrived(this)" onerror="ZHIXU.missing(this)"';
    return '<script src="' + base + path + '"' + attributes + handlers + '></' + 'script>';
  }

  /** 运行时执行过了。它如果没有留下启动标记，说明这个浏览器读不懂它。 */
  function checkStarted() {
    if (!window.ZHIXU.started) fail('template/app.js 没有运行起来：浏览器太旧，或者文件已经损坏');
  }

  /** 写进页面的脚本执行完了。 */
  function arrived(script) {
    settlers[script.dataset.path][0]();
    if (script.dataset.path === 'app.js') checkStarted();
  }

  function missing(script) {
    var path = script.dataset.path.replace('../', '');
    var hint = path === 'course/data.js' ? '（它由 node template/tools/zx.js build 生成）' : '';
    settlers[script.dataset.path][1](new Error('无法加载 ' + path));
    fail('无法加载 ' + path + hint);
  }

  /** 第二段：课程数据执行完之后，把运行时送进页面。 */
  function next() {
    if (!window.ZHIXU_COURSE) {
      fail('course/course.js 里有语法错误。在课程根目录运行 node template/tools/zx.js build 可以看到具体位置');
      return;
    }
    if (!window.ZHIXU_DATA) {
      fail('course/data.js 没有内容。在课程根目录运行 node template/tools/zx.js build 重新生成');
      return;
    }
    if (pack) {
      /* 单文件：把这一页的正文写进页面，接着直接执行运行时；第三方库等运行时用到的时候再取 */
      document.title = pack.pages[file].title;
      document.write('<body>' + pack.pages[file].body);
      load('app.js');
      checkStarted();
      return;
    }
    /* 文件夹：写出这一页用到的第三方库和运行时，浏览器并行去取，按顺序执行 */
    var lesson = window.ZHIXU_DATA.lessons[file];
    var tags = Object.keys(FEATURES)
      .filter(function (feature) {
        return lesson && lesson[feature];
      })
      .map(function (feature) {
        return FEATURES[feature]
          .map(function (path) {
            return written(path, DEFERRED);
          })
          .join('');
      });
    document.write(tags.join('') + written('app.js', DEFERRED));
  }

  window.ZHIXU = {
    file: file, // 现在是哪一页；在页面里换页之后，运行时负责把它改成新的一页
    packed: Boolean(pack),
    body: function (name) {
      return pagePart(name, 'body');
    },
    title: function (name) {
      return pagePart(name, 'title');
    },
    read: read,
    write: write,
    prefs: prefs,
    applyPrefs: applyPrefs,
    fail: fail,
    url: url,
    anchor: anchor,
    takeHistoryScroll: takeHistoryScroll,
    go: go,
    load: load,
    need: need,
    next: next,
    onTurn: null, // 单文件里换到某一页：运行时接上（main.js）
    arrived: arrived,
    missing: missing
  };
  root.classList.add('zx-js', 'zx-loading');
  applyPrefs();
  systemDark.addEventListener('change', applyPrefs);
  /* 别的标签页改了外观设置，这一页跟着变 */
  addEventListener('storage', function (event) {
    if (event.key === 'zhixu:prefs') applyPrefs();
  });
  /* 字体现在就开始加载，不等到排版时才发现要用。 */
  document.fonts.forEach(function (face) {
    face.load();
  });

  if (pack) {
    settleRoute();
    var navigation = performance.getEntriesByType('navigation')[0];
    if (navigation && navigation.type === 'back_forward') pendingScroll = savedScroll();
    /* 点了链接，地址的 # 变了。先记录上一处，再把新讲次和锚点挪进 history.state。 */
    addEventListener('hashchange', function (event) {
      if (!location.hash) return; // 前进后退派发的事件交给运行时
      rememberScroll();
      settleRoute();
      pendingScroll = undefined;
      if (mountRoute()) event.stopImmediatePropagation(); // 新的正文负责落点
    });
    /* 前进、后退的地址都没有 #。同讲由运行时就位，跨讲等正文换好再就位。 */
    addEventListener('popstate', function () {
      if (location.hash) return; // 刚点下去的链接，交给 hashchange
      rememberScroll();
      settleRoute();
      pendingScroll = savedScroll();
      if (!mountRoute()) dispatchEvent(new HashChangeEvent('hashchange'));
    });
    load('../course/course.js');
    load('../course/data.js');
    next();
  } else {
    document.write(
      written('../course/course.js', '') + written('../course/data.js', '') + '<script>ZHIXU.next()</' + 'script>'
    );
  }
})();
