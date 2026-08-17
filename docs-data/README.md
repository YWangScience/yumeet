# MG17 数据导入工具

把第 17 届 Marcel Grossmann 会议(2024 年 7 月,佩斯卡拉)的公开资料转换为 yuMeet 可导入的结构化数据。
这是 ch14 §14.1「Indico 迁移器」的一次真实落地。

## 脚本

| 脚本 | 作用 | 输出 |
| --- | --- | --- |
| `parse_boa.py` | 解析 Book of Abstracts PDF(289 页) | `mg17-abstracts.json`:601 篇摘要、标题、作者、单位 |
| `scrape_pages.py` | 抓取 Indico 的 20 个自定义页面并转 Markdown | `mg17-pages.json`:正文 + 62 张图片 |

两个脚本读写 `MG17_DATA` 目录(默认 `/home/yumeet.ywang.science/mg17`),该目录需包含:

- `book-of-abstracts.pdf`
- `mg17-sessions-rev01.xlsx`(Sessions / Chairperons / Participants 三个工作表)

## 用法

```bash
cd /home/yumeet.ywang.science/mg17
python3 parse_boa.py        # 需要 pdftotext(poppler-utils)
python3 scrape_pages.py     # 需要 curl,联网
# 再灌库
cd /home/yumeet.ywang.science/yumeet/packages/db
DATABASE_URL='postgresql://yumeet:yumeet_dev@localhost:5433/yumeet' pnpm exec tsx src/seed-mg17.ts
```

## 解析中处理的几个真实坑

1. **裸数字行的二义性**:PDF 里独立的数字既可能是页码,也可能是作者单位的脚注号。
   一律删除会丢掉全部单位归属,因此只删除紧邻页眉行的裸数字。
2. **会话名折行**:超长的分会名会被 PDF 折成两行,导致条目头只剩尾部片段
   (如 `constraints / 4`)。检测到首字母小写或过短时向上并入前一行。
3. **`<img>` 被误剥**:HTML→Markdown 时,处理 `<h*>`/`<li>`/`<a>` 的函数都会调用
   `strip()` 去标签,若图片转换排在其后就会被一并吃掉。图片必须最先转换。
4. **按栏宽断词**:PDF 会把 `Comparative` 断成 `Com- parative`。
   只合并「小写 + 连字符 + 空格 + 小写」,避免误伤 `Reissner-Nordström`、`X-ray`。

## 隐私处理

`mg17-sessions-rev01.xlsx` 的 Chairperons 与 Participants 两个工作表含
**116 位主席与 1136 位参会者的真实邮箱**。

这些邮箱从未出现在 MG17 的公开网站上,导入脚本因此**只提取姓名与单位,不提取任何邮箱**
(见 `scrape_pages.py` 同目录的导出逻辑与 `seed-mg17.ts` 文件头)。
这与 ch12 §12.3「数据最小化」一致:公开站点复现不需要 PII。

若确需把参会者作为报名记录导入(仅组织者后台可见),应另走
`registrations` 表并按 ch12 §12.3 设定保留期,不要放进公开页面。
