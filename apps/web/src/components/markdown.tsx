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
  // 图片支持可选的 title:seed 用它标出这是照片还是标志(见 isPhoto)
  s = s.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_m, alt: string, src: string, kind?: string) => {
      const href = safeUrl(src);
      if (!href) return alt;
      const cls = kind === 'photo' ? ` class="${styles.photo}"` : '';
      return `<img src="${href}"${cls} alt="${alt}" loading="lazy" />`;
    },
  );

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
  let logos: {
    src: string; alt: string; href: string | null; caption: string | null; photo: boolean;
  }[] = [];
  let ul: string[] = [];
  let ol: string[] = [];
  let para: string[] = [];
  let quote: string[] = [];

  /*
   * 「logo 段落」:整段只有一张图,可带一行说明或外链。
   *
   * 赞助方与合作机构页在 Indico 上就是这么写的,原样渲染的结果是
   * 每张 logo 按自己的原始尺寸铺开 —— 623×402 挨着 744×686,
   * 一页拖到两千八百像素,看上去像是排版坏了,而不是一份赞助名录。
   *
   * 这里把连续的 logo 段落收进一个等高网格:图统一 contain 进固定高度的格子,
   * 于是宽高比各异的 logo 看起来是有意为之的一面墙,而不是一堆随机大小的图。
   */
  const LOGO_LINE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/;
  const LOGO_LINK_LINE = /^\[!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\]\(([^)\s]+)\)$/;

  const flushLogos = () => {
    if (!logos.length) return;
    /*
     * 只有连续三张以上才当成 logo 墙。
     *
     * 一两张图更可能是正文的配图(会场照片、路线图),
     * 把它们塞进 180px 的等高格子里,等于把一张会场照片缩成缩略图 ——
     * 这不是「排整齐」,是把内容弄丢了。正文配图按原样走 <p><img>,
     * 由 .prose 给它一个圆角和自适应宽度即可。
     */
    if (logos.length < 3) {
      for (const l of logos) {
        const img = `<img src="${l.src}" class="${l.photo ? styles.photo : ''}" alt="${l.alt}" loading="lazy" />`;
        const inner = l.href
          ? `<a href="${l.href}" target="_blank" rel="noopener noreferrer">${img}</a>`
          : img;
        blocks.push(`<p>${inner}</p>`);
        if (l.caption) blocks.push(`<p>${inline(l.caption)}</p>`);
      }
      logos = [];
      return;
    }
    const cells = logos.map((l) => {
      const img = `<img src="${l.src}" class="${l.photo ? styles.photo : ''}" alt="${l.alt}" loading="lazy" />`;
      const inner = l.href
        ? `<a href="${l.href}" target="_blank" rel="noopener noreferrer">${img}</a>`
        : img;
      const cap = l.caption ? `<figcaption>${inline(l.caption)}</figcaption>` : '';
      return `<figure class="${styles.logoCell}">${inner}${cap}</figure>`;
    }).join('');
    blocks.push(`<div class="${styles.logoWall}">${cells}</div>`);
    logos = [];
  };

  const flushPara = () => {
    if (para.length) {
      // 只有一张图、且没有别的文字 —— 交给 logo 墙
      const joined = para.join(' ').trim();
      const link = LOGO_LINK_LINE.exec(joined);
      const bare = LOGO_LINE.exec(joined);
      if (link || bare) {
        const alt = (link ? link[1] : bare![1]) ?? '';
        const raw = (link ? link[2] : bare![2]) ?? '';
        const src = safeUrl(raw);
        const href = link ? safeUrl(link[3] ?? '') : null;
        const kind = /"([^"]*)"/.exec(joined)?.[1] ?? '';
        if (src) {
          logos.push({ src, alt: escapeHtml(alt), href, caption: null, photo: kind === 'photo' });
          para = [];
          return;
        }
      }
      // 图片段之后紧跟的一行链接/文字,视为这张 logo 的说明
      if (logos.length && joined.length <= 120 && !/^#/.test(joined)) {
        const last = logos[logos.length - 1]!;
        if (!last.caption) {
          last.caption = joined;
          para = [];
          return;
        }
      }
      flushLogos();

      /*
       * 「事项:日期」这样的一行,是会议重要日期页的通用写法。
       * 原样渲染就是一串各自为政的段落 —— 读者想知道的是
       * 「哪些节点、分别在什么时候、哪些已经过去了」,而这三件事
       * 在散段里都要靠自己拼。拆成左右两栏后,日期自动对齐成一列,
       * 眼睛沿着一条边就能扫完。
       */
      /*
       * 切分点必须避开链接里的冒号。
       *
       * 事项本身常带 Markdown 链接(「Opening of [registration](https://…):10 March」),
       * 从第一个冒号切会切在 `https:` 上,把 URL 的后半截当成日期。
       * 所以先把 [文字](链接) 整体遮成占位符再找冒号,拿到位置后回原串切 ——
       * 遮罩与原串等长,下标可以直接对应。
       */
      const masked = joined.replace(
        /\[[^\]]*\]\([^)\s]*\)/g,
        (m) => '\u0000'.repeat(m.length),
      );
      const at = masked.search(/[::]/);
      const term = at > 1 ? joined.slice(0, at).trim() : '';
      const value = at > 1 ? joined.slice(at + 1).trim() : '';
      // 长度按「渲染后看到的字数」算,不按源码字数 ——
      // 一条 48 字符的 URL 会把「Opening of registration」这样的短事项顶出上限。
      const shown = (t: string) => t.replace(/\[([^\]]*)\]\([^)\s]*\)/g, '$1').length;
      if (term.length >= 2 && shown(term) <= 70
          && value.length >= 2 && shown(value) <= 80) {
        blocks.push(
          `<p class="${styles.dateRow}">`
          + `<span class="${styles.dateTerm}">${inline(term)}</span>`
          + `<span class="${styles.dateValue}">${inline(value)}</span>`
          + '</p>',
        );
        para = [];
        return;
      }

      blocks.push(`<p>${inline(joined)}</p>`);
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
  const flushAll = () => { flushPara(); flushLogos(); flushUl(); flushOl(); flushQuote(); };

  for (const raw of source.split('\n')) {
    const line = raw.trim();

    // 空行只结束当前段落,不结束 logo 墙 —— Markdown 里图与图之间本就隔着空行
    if (line === '') { flushPara(); flushUl(); flushOl(); flushQuote(); continue; }

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
