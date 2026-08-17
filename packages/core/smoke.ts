import { db, events, outbox } from '@yumeet/db';
import { eq, desc } from 'drizzle-orm';
import { publishAnnouncement, listAnnouncements } from './src/index';
const [ev] = await db.select({ id: events.id }).from(events).where(eq(events.slug, 'mg18'));
try {
  const a = await publishAnnouncement({ eventId: ev!.id, text: '主会场 Aula Magna 报告推迟 15 分钟开始。', textEn: 'The Aula Magna session starts 15 minutes late.', level: 'urgent', ttlMinutes: 120, actor: { type: 'system' } });
  console.log('published:', a);
} catch (e) { console.error('ERR', e); }
console.log('rows:', await db.select().from(outbox).where(eq(outbox.topic, 'onsite.announcement')).orderBy(desc(outbox.createdAt)).limit(3));
console.log('list:', await listAnnouncements(ev!.id));
process.exit(0);
