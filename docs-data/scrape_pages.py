#!/usr/bin/env python3
"""抓取 MG17 Indico 站点的全部自定义页面,转为 Markdown 供 yuMeet 导入。"""
import html
import json
import re
import subprocess
import time
from pathlib import Path

BASE = 'https://indico.icranet.org'
HERE = Path(__file__).parent
OUT = HERE / 'mg17-pages.json'

PAGES = [
    ('scientific-objectives', 'Scientific objectives', '/event/8/page/37-scientific-objectives'),
    ('important-dates', 'Important dates', '/event/8/page/42-important-dates'),
    ('mg-awards', 'MG awards', '/event/8/page/50-mg-awards'),
    ('plenary-speakers', 'Confirmed plenary speakers', '/event/8/page/43-confirmed-plenary-speakers'),
    ('public-lectures', 'Public lectures', '/event/8/page/51-public-lectures'),
    ('chairperson-instructions', 'Instructions for chairpersons', '/event/8/page/46-instructions-for-chairpersons-of-parallel-sessions'),
    ('general-information', 'General information', '/event/8/page/38-general-information'),
    ('location', 'Location', '/event/8/page/39-location'),
    ('accommodation', 'Accommodation', '/event/8/page/40-accommodation'),
    ('transportation', 'Transportation', '/event/8/page/41-transportation'),
    ('wireless', 'Wireless internet connection', '/event/8/page/48-wireless-internet-connection'),
    ('organizing-committees', 'Organizing committees', '/event/8/page/47-organizing-committees'),
    ('ioc', 'International Organizing Committee', '/event/8/page/32-international-organizing-committee-ioc'),
    ('icc', 'International Coordinating Committee', '/event/8/page/33-international-coordinating-committee-icc'),
    ('loc', 'Local Organizing Committee', '/event/8/page/34-local-organizing-committee-loc'),
    ('exhibitions', 'Exhibitions', '/event/8/page/44-exhibitions'),
    ('sponsors', 'Sponsors', '/event/8/page/45-sponsors'),
    ('social-events', 'Social events', '/event/8/page/49-social-events'),
    ('group-photo', 'Group Photo', '/event/8/page/52-group-photo'),
    ('proceedings', 'Proceedings', '/event/8/page/53-proceedings'),
]

BLOCK_END = re.compile(r'</(p|div|h[1-6]|li|tr|table|ul|ol|blockquote)>', re.I)


def to_markdown(fragment: str) -> str:
    s = fragment
    s = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', s, flags=re.S | re.I)

    # <img> 必须最先转换:下面的 h/li/strong/a 处理器都调用 strip(),会连同图片一起剥掉
    s = re.sub(r'<img[^>]*?src="([^"]+)"[^>]*?>',
               lambda m: f'\n\n![]({absolutize(m.group(1))})\n\n', s, flags=re.I)

    # 结构化元素 → Markdown
    s = re.sub(r'<h([1-6])[^>]*>(.*?)</h\1>',
               lambda m: '\n\n' + '#' * min(int(m.group(1)) + 1, 6) + ' ' + strip(m.group(2)) + '\n\n',
               s, flags=re.S | re.I)
    s = re.sub(r'<li[^>]*>(.*?)</li>',
               lambda m: '\n- ' + strip(m.group(1)), s, flags=re.S | re.I)
    s = re.sub(r'<(strong|b)[^>]*>(.*?)</\1>',
               lambda m: (f'**{t}** ' if (t := strip(m.group(2))) else ''), s, flags=re.S | re.I)
    s = re.sub(r'<(em|i)[^>]*>(.*?)</\1>',
               lambda m: (f'*{t}* ' if (t := strip(m.group(2))) else ''), s, flags=re.S | re.I)
    s = re.sub(r'<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
               lambda m: f'[{strip(m.group(2))}]({absolutize(m.group(1))})', s, flags=re.S | re.I)
    s = re.sub(r'<br\s*/?>', '\n', s, flags=re.I)
    s = BLOCK_END.sub('\n\n', s)

    s = re.sub(r'<[^>]+>', '', s)
    s = html.unescape(s)
    s = re.sub(r'[ \t]+', ' ', s)
    s = re.sub(r' *\n *', '\n', s)
    s = re.sub(r'\n{3,}', '\n\n', s)
    return s.strip()


def strip(x: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', x))).strip()


def absolutize(href: str) -> str:
    if href.startswith(('http://', 'https://', 'mailto:')):
        return href
    return BASE + href


def extract(page_html: str) -> tuple[str, list[str]]:
    m = re.search(r'<div[^>]*class="[^"]*page-content[^"]*"[^>]*>(.*)', page_html, re.S)
    frag = m.group(1) if m else page_html
    # 截到页脚之前
    frag = re.split(r'<footer|class="[^"]*footer', frag)[0]
    imgs = [absolutize(u) for u in re.findall(r'<img[^>]+src="([^"]+)"', frag)
            if 'indico_small' not in u]
    return to_markdown(frag), imgs


def main() -> None:
    out = []
    for slug, title, path in PAGES:
        raw = subprocess.run(
            ['curl', '-sL', '--max-time', '30', BASE + path],
            capture_output=True, text=True).stdout
        if not raw:
            print(f'  ✗ {slug}: 空响应')
            continue
        body, imgs = extract(raw)
        out.append({'slug': slug, 'title': title, 'source': BASE + path,
                    'body': body, 'images': imgs})
        print(f'  ✓ {slug:26} {len(body):6d} 字  图 {len(imgs)}')
        time.sleep(0.4)

    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'\n共 {len(out)} 页 → {OUT.name}')


if __name__ == '__main__':
    main()
