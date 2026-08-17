#!/usr/bin/env python3
"""
解析 MG17 Book of Abstracts(Indico 导出格式)为结构化 JSON。

每条摘要的版式:
    <会话名> / <contribution id>
    <标题(可跨行)>
    Author[s]: 姓名<脚注号> ; 姓名<脚注号> ; …
    [Co-author[s]: …]
    <脚注号>
    <单位名>
    …
    <摘要正文>

会话名会被 PDF 换行截断,故最终以 sessions xlsx 的 (Title, Code, ID) 为准做校正。
"""
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
PDF = HERE / 'book-of-abstracts.pdf'
OUT = HERE / 'mg17-abstracts.json'

# 页眉页脚噪声
# 页眉页脚。注意:独立数字行既可能是页码,也可能是作者单位的脚注号,
# 因此不能一律删除 —— 只有紧邻页眉行的裸数字才算页码。
PAGE_MARK = re.compile(r'^(Seventeenth Marcel Grossmann Meeting|/ Book of Abstracts|Page \d+)\s*$')
BARE_NUM = re.compile(r'^\d{1,4}$')

HEAD = re.compile(r'^(.{2,160}?) / (\d+)\s*$')
AUTHORS = re.compile(r'^(Authors?|Co-authors?|Presenters?|Speakers?):\s*(.*)$')
FOOTNUM = re.compile(r'^(\d{1,2})$')


def extract_text() -> str:
    txt = HERE / 'boa.txt'
    if not txt.exists():
        subprocess.run(['pdftotext', '-raw', str(PDF), str(txt)], check=True)
    return txt.read_text(encoding='utf-8', errors='replace')


def dehyphenate(text: str) -> str:
    """PDF 按栏宽断词会留下「Com- parative」这类连字符,合并回原词。

    只合并「小写字母 + 连字符 + 空格 + 小写字母」的情形;
    真正的复合词(如 Reissner-Nordström)本就没有空格,不受影响,
    而「X-ray」这类连字符后接大写的也保持原样。
    """
    return re.sub(r'([a-z])-\s+([a-z])', r'\1\2', text)


def split_authors(raw: str) -> list[dict]:
    """'B. Mishra None ; Daniele Gregoris 1' → [{name, affNote}]"""
    out = []
    for chunk in raw.split(';'):
        chunk = chunk.strip()
        if not chunk:
            continue
        # 尾部的脚注号或 'None'
        m = re.match(r'^(.*?)\s*(None|\d{1,2})?$', chunk)
        name = (m.group(1) if m else chunk).strip(' ,')
        note = m.group(2) if m and m.group(2) not in (None, 'None') else None
        # 名字里残留的连写数字(如 "Daniele Gregoris1")
        m2 = re.match(r'^(.*?)(\d{1,2})$', name)
        if m2 and not note:
            name, note = m2.group(1).strip(), m2.group(2)
        if name:
            out.append({'name': name, 'affNote': note})
    return out


def main() -> None:
    raw_lines = [l.rstrip() for l in extract_text().splitlines()]

    # 先标记页眉行,再把紧邻页眉的裸数字视为页码删除,保留作为脚注号的裸数字
    is_mark = [bool(PAGE_MARK.match(l.strip())) for l in raw_lines]
    drop = set()
    for i, l in enumerate(raw_lines):
        if is_mark[i]:
            drop.add(i)
        elif BARE_NUM.match(l.strip()):
            near = any(is_mark[j] for j in (i - 2, i - 1, i + 1, i + 2)
                       if 0 <= j < len(raw_lines))
            if near:
                drop.add(i)
    lines = [l for i, l in enumerate(raw_lines) if i not in drop]

    heads = []
    for i, l in enumerate(lines):
        m = HEAD.match(l.strip())
        if not m:
            continue
        name = m.group(1).strip()
        # 会话名过长会被 PDF 折行,首字母小写或以连接词开头即为续行,向上并入
        if i > 0 and (name[:1].islower() or len(name) < 18):
            prev = lines[i - 1].strip()
            if prev and not HEAD.match(prev) and not AUTHORS.match(prev):
                name = f'{prev} {name}'.strip()
        heads.append((i, name, int(m.group(2))))
    if not heads:
        sys.exit('未找到任何条目头')

    entries = []
    for idx, (line_no, session, cid) in enumerate(heads):
        end = heads[idx + 1][0] if idx + 1 < len(heads) else len(lines)
        body = lines[line_no + 1:end]

        title_parts: list[str] = []
        authors: list[dict] = []
        affiliations: dict[str, str] = {}
        abstract_parts: list[str] = []

        state = 'title'
        pending_note: str | None = None

        for raw in body:
            line = raw.strip()
            if not line:
                if state == 'title' and title_parts:
                    continue
                if state == 'abstract':
                    abstract_parts.append('')
                continue

            if (m := AUTHORS.match(line)):
                state = 'authors'
                authors.extend(split_authors(m.group(2)))
                continue

            if state == 'title':
                title_parts.append(line)
                continue

            if state == 'authors':
                if FOOTNUM.match(line):
                    pending_note = line
                    state = 'affil'
                    continue
                # 作者续行
                if ';' in line or re.search(r'\d$', line):
                    authors.extend(split_authors(line))
                    continue
                state = 'abstract'
                abstract_parts.append(line)
                continue

            if state == 'affil':
                if FOOTNUM.match(line):
                    pending_note = line
                    continue
                if pending_note and pending_note not in affiliations:
                    affiliations[pending_note] = line
                    pending_note = None
                    continue
                state = 'abstract'
                abstract_parts.append(line)
                continue

            abstract_parts.append(line)

        title = dehyphenate(' '.join(title_parts).strip())
        abstract = dehyphenate('\n'.join(abstract_parts).strip())
        abstract = re.sub(r'\n{3,}', '\n\n', abstract)

        for a in authors:
            a['affiliation'] = affiliations.get(a.pop('affNote') or '', None)

        if not title:
            continue

        entries.append({
            'contributionId': cid,
            'sessionHint': session,
            'title': title,
            'authors': authors,
            'abstract': abstract,
        })

    OUT.write_text(json.dumps(entries, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'解析出 {len(entries)} 条摘要 → {OUT.name}')
    with_authors = sum(1 for e in entries if e['authors'])
    with_abs = sum(1 for e in entries if len(e['abstract']) > 80)
    print(f'  含作者: {with_authors}  含正文(>80字): {with_abs}')
    print(f'  contributionId 范围: {min(e["contributionId"] for e in entries)}–'
          f'{max(e["contributionId"] for e in entries)}')


if __name__ == '__main__':
    main()
