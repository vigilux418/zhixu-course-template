'use strict';
/* 端到端验收的公共部分：stage.js 的全部工具，外加“测试文件跑完时收拾现场”。
 * 内核由环境变量 ZX_ENGINE 指定（chromium、firefox、webkit），默认 chromium。 */
const { after } = require('node:test');
const stage = require('./stage');

after(stage.dispose);

module.exports = stage;
