import type { Metadata } from 'next';
import Link from 'next/link';
import { listPublishedEvents, displayStatus } from '@yumeet/core';
import { formatDateRange } from '@/lib/format';
import styles from './home.module.css';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'yuMeet — Your Universe MEETs',
  description: '新一代开源会议系统:从「管理系统」转向「参与体验」。',
};

const PRINCIPLES = [
  { n: '01', t: '网站与系统分离', d: '公共页面是极快的静态内容,注册与评审是 API 后面的工作流。两者解耦,前台可以是任何人的网站。' },
  { n: '02', t: '角色分屏', d: '参会者、讲者、审稿人、组织者各自看到只属于自己的界面,而不是一套界面靠权限过滤。' },
  { n: '03', t: '无摩擦身份', d: '报名不以「创建终身账户」开头。magic link、passkey、机构 SSO,身份后置。' },
  { n: '04', t: '状态透明', d: '申请进度像查快递:任何时刻打开都知道自己卡在哪一步,邮件只是通知渠道,不是唯一真相源。' },
  { n: '05', t: '默认即合规', d: '参会名单默认不公开、数据最小化、保留期自动清理、WCAG 从第一个组件做起——是初始约束,不是后补功能。' },
  { n: '06', t: '时区与日历原生', d: '所有时间按观看者时区渲染,任何日程条目一键进日历,日程本身是结构化数据而非 PDF。' },
  { n: '07', t: '归档是一等公民', d: '会议活两周,归档活二十年。slides、录像、论文沉淀为永久可引用的链接。' },
  { n: '08', t: '运维趋零', d: '一条命令部署,自动 HTTPS。每一个必须的依赖都是对采用者的隐性收费。' },
];

export default async function HomePage() {
  const events = await listPublishedEvents('icranet');

  return (
    <main>
      <header className={styles.hero}>
        <div className={styles.heroInner}>
          <p className={styles.wordmark}>yuMeet</p>
          <h1 className={styles.heroTitle}>Your Universe MEETs</h1>
          <p className={styles.heroLede}>
            新一代开源会议系统。讲者、参会者、组织者各自的世界,
            因一场活动交汇成同一个现场。
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.buttonPrimary} href="/icranet/mg18">
              查看演示会议
            </Link>
            <a
              className={styles.buttonGhost}
              href="https://github.com/YWangScience/yumeet"
              rel="noreferrer"
            >
              GitHub 仓库
            </a>
          </div>
        </div>
      </header>

      {events.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionInner}>
            <h2 className={styles.sectionTitle}>正在进行的会议</h2>
            <ul className={styles.eventList}>
              {events.map(({ event, org }) => {
                const status = displayStatus(event);
                return (
                  <li key={event.id}>
                    <Link className={styles.eventCard} href={`/${org.slug}/${event.slug}`}>
                      <span className={styles.eventOrg}>{org.name.split('—')[0]?.trim()}</span>
                      <span className={styles.eventTitle}>{event.title}</span>
                      <span className={styles.eventMeta}>
                        {formatDateRange(event.startsAt, event.endsAt, event.timezone)}
                        {event.venue?.name ? ` · ${event.venue.name}` : ''}
                      </span>
                      <span className={`${styles.eventBadge} ${styles[`badge_${status}`] ?? ''}`}>
                        {status === 'published' ? '报名开放' : status === 'live' ? '进行中' : '已结束'}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      <section className={`${styles.section} ${styles.sectionAlt}`}>
        <div className={styles.sectionInner}>
          <h2 className={styles.sectionTitle}>八条设计原则</h2>
          <p className={styles.sectionLede}>
            yuMeet 用于替代 CERN Indico。每一条原则都对应一个被反复抱怨的真实问题。
          </p>
          <ol className={styles.principles}>
            {PRINCIPLES.map((p) => (
              <li key={p.n} className={styles.principle}>
                <span className={styles.principleNum}>{p.n}</span>
                <h3 className={styles.principleTitle}>{p.t}</h3>
                <p className={styles.principleDesc}>{p.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionInner}>
          <h2 className={styles.sectionTitle}>装进任何网站</h2>
          <p className={styles.sectionLede}>
            已有官网的组织不必再建一个活动站。两行 HTML,活动信息就出现在自己的页面上。
          </p>
          <pre className={styles.code}>
            <code>{`<script type="module" src="https://yumeet.ywang.science/embed.js" async></script>
<yumeet-event-list org="icranet" limit="5"></yumeet-event-list>`}</code>
          </pre>
          <p className={styles.sectionFoot}>
            组件用 Shadow DOM 隔离,默认继承宿主字体与配色;注册与支付始终发生在 yuMeet 侧,
            宿主网站接触不到任何个人信息。
          </p>
        </div>
      </section>

      <footer className={styles.footer}>
        <p>yuMeet · Your Universe MEETs</p>
        <p className={styles.footerMuted}>
          开源会议系统 · 默认主题 Cupertino · 一条命令部署
        </p>
      </footer>
    </main>
  );
}
