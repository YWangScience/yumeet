/** 结构化日志:一行一条 JSON,容器里直接被 docker logs / loki 采走(ch13 §13.6) */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? LEVELS.info;

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < threshold) return;
  const line = JSON.stringify({
    t: new Date().toISOString(), level, svc: 'worker', msg, ...fields,
  });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => emit('debug', msg, f),
  info: (msg: string, f?: Record<string, unknown>) => emit('info', msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit('warn', msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit('error', msg, f),
};

export function errFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { err: err.message, errName: err.name, ...('reason' in err ? { reason: (err as { reason: unknown }).reason } : {}) };
  }
  return { err: String(err) };
}
