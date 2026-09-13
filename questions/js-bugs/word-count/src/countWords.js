// 统计英文单词词频，返回 { 单词(小写): 次数 }；空白与标点都算分隔。
export function countWords(text) {
  const counts = {};
  for (const word of text.split(" ")) {
    counts[word] = (counts[word] ?? 0) + 1;
  }
  return counts;
}
