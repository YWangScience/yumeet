/** 极简 Markdown 渲染(标题/粗体/列表/段落);不引入外部依赖 */
import styles from './markdown.module.css';

function inline(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

export function Markdown({ source }: { source: string }) {
  const blocks: string[] = [];
  let list: string[] = [];
  let para: string[] = [];

  // 连续非空行合并为同一段落(Markdown 语义:空行才分段)
  const flushPara = () => {
    if (para.length) {
      blocks.push(`<p>${inline(para.join(''))}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      blocks.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`);
      list = [];
    }
  };
  const flush = () => { flushPara(); flushList(); };

  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (/^##\s+/.test(line)) { flush(); blocks.push(`<h3>${inline(line.replace(/^##\s+/, ''))}</h3>`); }
    else if (/^#\s+/.test(line)) { flush(); blocks.push(`<h2>${inline(line.replace(/^#\s+/, ''))}</h2>`); }
    else if (/^[-*]\s+/.test(line)) { flushPara(); list.push(line.replace(/^[-*]\s+/, '')); }
    else if (line === '') { flush(); }
    else { flushList(); para.push(line); }
  }
  flush();
  return (
    <div
      className={styles.prose}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: blocks.join('') }}
    />
  );
}
