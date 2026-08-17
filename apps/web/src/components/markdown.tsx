import styles from './markdown.module.css';

/**
 * 极简 Markdown 渲染(不引入外部依赖,ch11 §11 「不引入规格外的重量依赖」)
 * 支持:标题、粗体、斜体、行内代码、链接、图片、有序/无序列表、引用、水平线。
 * 输入被视为不可信:先整体转义 HTML,再按 Markdown 语法生成标签。
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 仅允许 http(s)/mailto 与站内相对路径,挡掉 javascript: 等协议 */
function safeUrl(url: string): string | null {
  const u = url.trim();
  if (/^(https?:\/\/|mailto:|\/|#)/i.test(u)) return u;
  return null;
}

function inline(text: string): string {
  let s = escapeHtml(text);

  // 图片先于链接处理(语法是链接的超集)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, src: string) => {
    const href = safeUrl(src);
    return href
      ? `<img src="${href}" alt="${alt}" loading="lazy" />`
      : alt;
  });

  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
    const url = safeUrl(href);
    if (!url) return label;
    const external = /^https?:\/\//i.test(url);
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${url}"${attrs}>${label}</a>`;
  });

  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/`([^`]+?)`/g, '<code>$1</code>');
  return s;
}

export function Markdown({ source }: { source: string }) {
  const blocks: string[] = [];
  let ul: string[] = [];
  let ol: string[] = [];
  let para: string[] = [];
  let quote: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push(`<p>${inline(para.join(' '))}</p>`);
      para = [];
    }
  };
  const flushUl = () => {
    if (ul.length) {
      blocks.push(`<ul>${ul.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`);
      ul = [];
    }
  };
  const flushOl = () => {
    if (ol.length) {
      blocks.push(`<ol>${ol.map((li) => `<li>${inline(li)}</li>`).join('')}</ol>`);
      ol = [];
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      blocks.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`);
      quote = [];
    }
  };
  const flushAll = () => { flushPara(); flushUl(); flushOl(); flushQuote(); };

  for (const raw of source.split('\n')) {
    const line = raw.trim();

    if (line === '') { flushAll(); continue; }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { flushAll(); blocks.push('<hr />'); continue; }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushAll();
      // Markdown 的 # 对应页面二级标题(页面 h1 由页面壳提供)
      const level = Math.min(h[1]!.length + 1, 6);
      blocks.push(`<h${level}>${inline(h[2]!)}</h${level}>`);
      continue;
    }

    if (/^>\s?/.test(line)) { flushPara(); flushUl(); flushOl(); quote.push(line.replace(/^>\s?/, '')); continue; }

    const oli = /^\d+[.)]\s+(.*)$/.exec(line);
    if (oli) { flushPara(); flushUl(); flushQuote(); ol.push(oli[1]!); continue; }

    if (/^[-*+]\s+/.test(line)) { flushPara(); flushOl(); flushQuote(); ul.push(line.replace(/^[-*+]\s+/, '')); continue; }

    flushUl(); flushOl(); flushQuote();
    para.push(line);
  }
  flushAll();

  return (
    <div
      className={styles.prose}
      // 内容已在上方逐段转义后重建,不存在未过滤的宿主 HTML
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: blocks.join('') }}
    />
  );
}
