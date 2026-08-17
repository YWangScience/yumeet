/**
 * /embed/{evt_id} —— iframe 嵌入用的无导航壳页面(ch10 §10.6 L2)
 *
 * 完全禁脚本的宿主(WordPress、Notion、Ghost…)靠 oEmbed 拿到指向这里的 iframe。
 * 页面自身只渲染一张活动卡片(可选完整日程),没有站点导航、没有 cookie、没有跟踪;
 * 加载完成后通过 postMessage 向父窗口汇报内容高度,宿主两行代码即可实现自动高度:
 *
 *   window.addEventListener('message', (e) => {
 *     if (e.data?.type === 'yumeet:embed:height') iframe.style.height = e.data.height + 'px';
 *   });
 *
 * 查询参数:view=card|schedule、theme=light|dark(默认跟随宿主 prefers-color-scheme)、locale。
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { displayStatus, encodeId, getEventSchedule, groupByDay } from '@yumeet/core';
import {
  eventUrls, eventUuidFromParam, loadPublicEvent, loadPublicForm,
  type ScheduleRoom, type ScheduleSession,
} from '@/lib/api-helpers';
import { formatDateRange, formatDayLabel, formatTime } from '@/lib/format';
import styles from './embed.module.css';

export const revalidate = 60;

interface Props {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const STRINGS = {
  zh: {
    register: '报名参会',
    details: '活动详情',
    calendar: '加入日历',
    schedule: '日程',
    poweredBy: '由 yuMeet 提供',
    more: (n: number) => `另有 ${n} 场`,
    tz: (tz: string) => `时间按会议时区 ${tz} 显示`,
    status: {
      published: '即将举行', live: '进行中', ended: '已结束',
      draft: '草稿', archived: '已归档',
    } as Record<string, string>,
  },
  en: {
    register: 'Register',
    details: 'Event details',
    calendar: 'Add to calendar',
    schedule: 'Programme',
    poweredBy: 'Powered by yuMeet',
    more: (n: number) => `${n} more sessions`,
    tz: (tz: string) => `Times shown in the event timezone (${tz})`,
    status: {
      published: 'Upcoming', live: 'Happening now', ended: 'Ended',
      draft: 'Draft', archived: 'Archived',
    } as Record<string, string>,
  },
};

function first(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { eventId } = await params;
  const uuid = eventUuidFromParam(eventId);
  const event = uuid ? await loadPublicEvent(uuid) : null;
  return {
    title: event ? `${event.title} · yuMeet` : 'yuMeet',
    // 嵌入壳页面不参与索引,SEO 归主活动页
    robots: { index: false, follow: true },
  };
}

export default async function EmbedPage({ params, searchParams }: Props) {
  const { eventId } = await params;
  const query = await searchParams;

  const uuid = eventUuidFromParam(eventId);
  if (!uuid) notFound();
  const event = await loadPublicEvent(uuid);
  if (!event) notFound();

  const encodedId = encodeId('event', event.id);
  const view = first(query['view']) === 'schedule' ? 'schedule' : 'card';
  const themeParam = first(query['theme']);
  const theme = themeParam === 'dark' || themeParam === 'light' ? themeParam : undefined;
  const localeParam = first(query['locale']) ?? 'zh-Hans';
  const t = localeParam.toLowerCase().startsWith('en') ? STRINGS.en : STRINGS.zh;

  const now = new Date();
  const status = displayStatus(event, now);
  const urls = eventUrls(event, '');
  const form = event.modules?.registration ? await loadPublicForm(uuid) : null;
  const registrationOpen = Boolean(
    form && (!form.opensAt || form.opensAt <= now) && (!form.closesAt || form.closesAt > now),
  );

  const schedule: { rooms: ScheduleRoom[]; sessions: ScheduleSession[] } =
    view === 'schedule' && event.modules?.schedule
      ? await getEventSchedule(uuid)
      : { rooms: [], sessions: [] };
  const roomsById = new Map<string, ScheduleRoom>(schedule.rooms.map((r) => [r.id, r]));
  const allDays = groupByDay(schedule.sessions, event.timezone);
  const PER_DAY = 6;

  const heightScript = `(function(){var id=${JSON.stringify(encodedId)},last=0;`
    + 'function post(){var h=Math.ceil(document.documentElement.scrollHeight);'
    + 'if(h&&h!==last){last=h;try{parent.postMessage({type:"yumeet:embed:height",id:id,height:h},"*")}catch(e){}}}'
    + 'post();window.addEventListener("load",post);window.addEventListener("resize",post);'
    + 'if(window.ResizeObserver){new ResizeObserver(post).observe(document.documentElement)}'
    + 'setTimeout(post,120);setTimeout(post,600);})();';

  return (
    <div className={styles.shell} data-theme={theme}>
      <article className={styles.card}>
        <p className={styles.org}>{event.orgName}</p>
        <h1 className={styles.title}>
          <a className={styles.titleLink} href={urls.public} target="_blank" rel="noopener noreferrer">
            {event.title}
          </a>
        </h1>
        {event.subtitle && <p className={styles.subtitle}>{event.subtitle}</p>}

        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt className={styles.factLabel}>{formatDateRange(event.startsAt, event.endsAt, event.timezone, localeParam)}</dt>
            <dd className={styles.factValue}>
              <span className={`${styles.badge} ${styles[`badge_${status}`] ?? ''}`}>
                {t.status[status] ?? status}
              </span>
            </dd>
          </div>
          {event.venue?.name && (
            <div className={styles.fact}>
              <dt className={styles.factLabel}>{event.venue.name}</dt>
              <dd className={styles.factValue}>
                {[event.venue.city, event.venue.country].filter(Boolean).join(' · ')}
              </dd>
            </div>
          )}
        </dl>

        {view === 'schedule' && allDays.length > 0 && (
          <section className={styles.schedule}>
            <h2 className={styles.scheduleTitle}>{t.schedule}</h2>
            {allDays.map(({ day, items }) => (
              <div key={day} className={styles.day}>
                <h3 className={styles.dayTitle}>{formatDayLabel(day, localeParam)}</h3>
                <ol className={styles.sessionList}>
                  {items.slice(0, PER_DAY).map((s) => (
                    <li key={s.id} className={styles.session}>
                      <time className={styles.sessionTime} dateTime={s.startsAt.toISOString()}>
                        {formatTime(s.startsAt, event.timezone, localeParam)}
                      </time>
                      <div>
                        <p className={styles.sessionTitle}>{s.title}</p>
                        <p className={styles.sessionMeta}>
                          {[
                            s.speakers.map((sp) => sp.name).join('、'),
                            s.roomId ? roomsById.get(s.roomId)?.name ?? '' : '',
                          ].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
                {items.length > PER_DAY && (
                  <p className={styles.more}>{t.more(items.length - PER_DAY)}</p>
                )}
              </div>
            ))}
            <p className={styles.tzNote}>{t.tz(event.timezone)}</p>
          </section>
        )}

        <div className={styles.actions}>
          {registrationOpen && urls.register && (
            <a className={styles.primary} href={urls.register} target="_blank" rel="noopener noreferrer">
              {t.register}
            </a>
          )}
          <a className={styles.secondary} href={urls.public} target="_blank" rel="noopener noreferrer">
            {t.details}
          </a>
          <a className={styles.secondary} href={urls.ics}>{t.calendar}</a>
        </div>

        <p className={styles.footer}>
          <a className={styles.footerLink} href={urls.public} target="_blank" rel="noopener noreferrer">
            {t.poweredBy}
          </a>
        </p>
      </article>

      {/* 自动高度:向父窗口汇报内容高度(ch10 §10.6 L2) */}
      {/* eslint-disable-next-line react/no-danger */}
      <script dangerouslySetInnerHTML={{ __html: heightScript }} />
    </div>
  );
}
