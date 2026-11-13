export function noticePlainText(value) {
 return String(value ?? '')
  .replace(/\r\n?/g, '\n')
  .split('\n')
  .map(line => line
   .replace(/^\s{0,3}#{1,6}[ \t]+/, '')
   .replace(/^\s*[-*+][ \t]+/, '・')
   .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s()]+(?:\([^\s()]*\)[^\s()]*)*)\)/g, '$1：$2')
   .split(/(https?:\/\/[^\s<>"「」]+)/g)
   .map((part, index) => index % 2 ? part : part
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/(?<!\w)__([^_\n]+)__(?!\w)/g, '$1')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1'))
   .join('')
   .trimEnd())
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();
}

export function noticeHtml(text) {
 const escaped = text.replace(/[&<>"']/g, character => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
 })[character]);
 return '<!doctype html><html lang="zh-Hant"><body>' +
  escaped.split(/\r?\n\r?\n/).map(paragraph =>
   '<p>' + paragraph.replace(/\r?\n/g, '<br>') + '</p>'
  ).join('') + '</body></html>';
}
