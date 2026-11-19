/* 搜索的匹配：在工具生成的索引里做子串匹配（中文没有词边界，子串最可靠）。
 * 都是纯函数，不碰页面，可以直接在 Node 里测试。词一律是小写的；索引里的文字保持原样，比较时再转小写。 */

const LIMIT = 30;
const lower = (text) => text.toLowerCase();

/** 读者输入的一串字 → 要找的词（小写，按空白分开）。 */
export const wordsOf = (query) => lower(query).split(/\s+/).filter(Boolean);

/** 命中的条目：每个词都必须出现在标题或正文里；标题里命中的词多的排在前面，其余按索引里的先后。最多 30 条。 */
export function searchHits(index, words) {
  if (words.length === 0) return [];
  return index
    .map((entry) => {
      const title = lower(entry.title);
      const text = lower(entry.text);
      if (!words.every((word) => title.includes(word) || text.includes(word))) return null;
      return { entry, score: words.filter((word) => title.includes(word)).length };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, LIMIT)
    .map((hit) => hit.entry);
}

/* 索引里的公式只是一个占位符（U+FFFC）：LaTeX 源码没有人按它来搜，直接去掉又会让前后的标点拼在一起。 */
const FORMULA = '￼';

/** 取第一个命中词前后的一小段正文；正文里没有命中（词只在标题里）就取开头。摘录里公式写成“[公式]”。 */
export function excerptOf(text, words) {
  const hits = words.map((word) => lower(text).indexOf(word)).filter((at) => at >= 0);
  const at = hits.length ? Math.min(...hits) : 0;
  const from = Math.max(0, at - 16);
  return ((from > 0 ? '…' : '') + text.slice(from, from + 72)).replaceAll(FORMULA, '[公式]');
}

/** 把一段文字按命中的词切开：[[文字, 是不是命中], …]，各段连起来就是原文。 */
export function splitHits(text, words) {
  text = text.replaceAll(FORMULA, '[公式]');
  const pieces = [];
  const haystack = lower(text);
  let cursor = 0;
  while (cursor < text.length) {
    const next = words
      .map((word) => ({ word, at: haystack.indexOf(word, cursor) }))
      .filter((match) => match.at >= 0)
      .sort((a, b) => a.at - b.at)[0];
    if (!next) break;
    if (next.at > cursor) pieces.push([text.slice(cursor, next.at), false]);
    pieces.push([text.slice(next.at, next.at + next.word.length), true]);
    cursor = next.at + next.word.length;
  }
  if (cursor < text.length) pieces.push([text.slice(cursor), false]);
  return pieces;
}
