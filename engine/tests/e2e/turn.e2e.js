'use strict';
/* 翻页：从一讲到下一讲，屏幕上不该出现空白。逐帧录屏靠 Chromium 的调试协议，所以只在 Chromium 里跑。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { ENGINE, course, newContext, open, arrived, lessonFiles } = require('./harness');

const ROUNDS = 5;

/** 录下从按 ] 到下一讲就绪这段时间里屏幕上的每一帧，返回各帧 JPEG 的大小（空白帧只有几 KB）。 */
async function film(root, from, to) {
  const context = await newContext({ viewport: { width: 1280, height: 800 } });
  const page = await open(context, root, from);
  await page.evaluate(() => document.fonts.ready);
  const client = await context.newCDPSession(page);
  const frames = [];
  client.on('Page.screencastFrame', (event) => {
    frames.push({ at: event.metadata.timestamp, size: event.data.length });
    client.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => null);
  });
  await client.send('Page.startScreencast', { format: 'jpeg', quality: 50, everyNthFrame: 1 });
  await page.waitForTimeout(300);
  const pressed = Date.now() / 1000;
  await page.keyboard.press(']');
  await arrived(page, to);
  await page.waitForTimeout(600);
  await client.send('Page.stopScreencast');
  await context.close();
  return frames.filter((frame) => frame.at >= pressed).map((frame) => frame.size);
}

test(
  `翻页：连续 ${ROUNDS} 次录屏都没有空白帧`,
  {
    skip: ENGINE !== 'chromium' && '逐帧录屏只有 Chromium 能做'
  },
  async () => {
    const root = course('sample');
    const [first, second] = lessonFiles(root);
    for (let round = 1; round <= ROUNDS; round += 1) {
      const sizes = await film(root, first, second);
      assert.ok(sizes.length > 0, '应当录到翻页过程中的画面');
      const settled = sizes.at(-1);
      const blank = sizes.filter((size) => size < settled * 0.3);
      assert.deepEqual(blank, [], `第 ${round} 次翻页出现了空白帧（各帧大小：${sizes.join(', ')}）`);
    }
  }
);
