/**
 * GET /api/v1/events/{evt_id}/stream —— 现场实时通道(ch05 §5.2.3)
 *
 * 事件类型:
 *   announcement      组织者广播的公告(公共页横幅 + 会场屏顶部)
 *   schedule_changed  日程发布了新版本,订阅端软刷新
 *   ping              心跳注释之外的显式保活,便于前端判活
 *
 * 断线重连:每条 announcement 都带 `id:`(发布时刻的 RFC 3339 时间戳),
 * 浏览器重连时自动带上 `Last-Event-ID`,服务端据此补发保留期(24h)内的漏发消息。
 *
 * Next.js Route Handler 里做 SSE 的三个必要条件:
 *   1. 返回 ReadableStream 而不是字符串,否则响应会被整体缓冲;
 *   2. `Cache-Control: no-store` —— 任何一层缓存都会让流变成一次性响应;
 *   3. `X-Accel-Buffering: no` —— 反代(Caddy/Nginx)默认会缓冲,不关就没有实时性。
 * 另外必须监听 `req.signal` 的 abort:客户端关闭标签页时若不清理定时器,
 * 每开一次会场屏就泄漏一个轮询循环。
 */
import { listAnnouncements, scheduleRevision, decodeId, type Announcement } from '@yumeet/core';
import { CORS_HEADERS, eventUuidFromParam, loadPublicEvent, notFound, preflight } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** 长连接:不要让平台在默认超时处切断(单位:秒) */
export const maxDuration = 3600;

/** 轮询数据库的间隔。公告是低频事件,2 秒足够「实时」,也不会压垮库 */
const POLL_MS = 2_000;
/** 心跳间隔:穿透中间代理的空闲超时(通常 30–60s) */
const HEARTBEAT_MS = 15_000;

export function OPTIONS(): Response {
  return preflight();
}

function frame(parts: { event?: string; id?: string; data: unknown }): string {
  const lines: string[] = [];
  if (parts.id) lines.push(`id: ${parts.id}`);
  if (parts.event) lines.push(`event: ${parts.event}`);
  lines.push(`data: ${JSON.stringify(parts.data)}`);
  return `${lines.join('\n')}\n\n`;
}

function announcementFrame(a: Announcement): string {
  return frame({
    event: 'announcement',
    id: a.cursor,
    data: {
      level: a.level,
      text: a.text,
      text_en: a.textEn,
      room_id: a.roomId,
      published_at: a.publishedAt,
      expires_at: a.expiresAt,
    },
  });
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  const { eventId } = await ctx.params;

  const uuid = eventUuidFromParam(eventId);
  if (!uuid) return notFound(`Event ${eventId} does not exist or is not public.`);
  // 与其它公共端点同一条可见性规则:未发布 / 非 public / 软删一律 404(ch12 §12.1)
  const event = await loadPublicEvent(uuid);
  if (!event) return notFound(`Event ${eventId} does not exist or is not public.`);

  const url = new URL(req.url);
  let roomId: string | null = null;
  const roomParam = url.searchParams.get('room');
  if (roomParam) {
    try {
      roomId = decodeId('room', roomParam);
    } catch {
      roomId = null;
    }
  }

  // Last-Event-ID 优先取请求头(浏览器自动重连),其次取查询参数(手工订阅/curl)
  const lastEventId = req.headers.get('last-event-id') ?? url.searchParams.get('lastEventId');

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let cursor: string | null = lastEventId;
      let version: number | null = null;

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* 已经关了 */
        }
      };

      req.signal.addEventListener('abort', cleanup);

      // 重连建议 5 秒;客户端不必自己写退避
      send('retry: 5000\n\n');

      try {
        const revision = await scheduleRevision(uuid);
        version = revision?.version ?? null;
        send(frame({
          event: 'ready',
          data: {
            event_id: eventId,
            schedule_version: version,
            server_time: new Date().toISOString(),
            /** 补发窗口:重连时可以放心用 Last-Event-ID 回溯到 24 小时前 */
            replay_window_hours: 24,
          },
        }));

        // 补发:带了 Last-Event-ID 就从那之后补,没带就给当前仍在展示期内的公告
        const backlog = await listAnnouncements(uuid, {
          since: cursor,
          activeOnly: !cursor,
          roomId,
        });
        for (const a of backlog) {
          send(announcementFrame(a));
          cursor = a.cursor;
        }
      } catch (e) {
        console.error('SSE 初始化失败', e);
        send(frame({ event: 'error', data: { message: 'stream_init_failed' } }));
        cleanup();
        return;
      }

      timer = setInterval(() => {
        void (async () => {
          if (closed) return;
          try {
            const fresh = await listAnnouncements(uuid, {
              since: cursor,
              activeOnly: false,
              roomId,
            });
            for (const a of fresh) {
              send(announcementFrame(a));
              cursor = a.cursor;
            }

            const revision = await scheduleRevision(uuid);
            const next = revision?.version ?? null;
            if (next !== version) {
              version = next;
              send(frame({
                event: 'schedule_changed',
                data: { version: next, published_at: revision?.publishedAt ?? null },
              }));
            }
          } catch (e) {
            console.error('SSE 轮询失败', e);
          }
        })();
      }, POLL_MS);

      heartbeat = setInterval(() => {
        // 注释帧:客户端 EventSource 会忽略,但足以让中间代理不判定空闲
        send(`: keep-alive ${new Date().toISOString()}\n\n`);
        send(frame({ event: 'ping', data: { t: new Date().toISOString() } }));
      }, HEARTBEAT_MS);
    },

    cancel() {
      if (timer) clearInterval(timer);
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      // 反代不要缓冲(Caddy / Nginx)
      'X-Accel-Buffering': 'no',
    },
  });
}
