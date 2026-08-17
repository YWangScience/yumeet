/**
 * webhook 出站传输:core 的 WebhookTransport 接口 → packages/net 的 safeFetch。
 *
 * ch12 §12.1 要求所有出站 HTTP 经唯一 broker,且 webhook 目标 URL 在
 * **保存时与每次投递时**都重新校验(防 TOCTOU:先填合法域名、通过后再改 DNS
 * 指向内网)。safeFetch 内部每次调用都会重新解析 + 判网段 + 钉 IP,
 * 所以「每次投递都校验」是自动成立的,不需要额外的调用点。
 */
import { assertSafeUrl, safePostJson, SsrfError, type SafeFetchOptions } from '@yumeet/net';
import { WEBHOOK_TIMEOUT_MS, type WebhookTransport } from '@yumeet/core';
import { config } from './config';

function netOptions(): SafeFetchOptions {
  return config.allowPrivateWebhookTargets
    ? {
      // 本地联调:放开 http 与私有地址,端口白名单也放宽
      allowedProtocols: ['http:', 'https:'],
      allowedPorts: [80, 443, 3000, 4000, 8080, 8787, 9000],
      allowPrivateAddresses: true,
      timeoutMs: WEBHOOK_TIMEOUT_MS,
      headersTimeoutMs: WEBHOOK_TIMEOUT_MS,
      maxRedirects: 0,
      maxResponseBytes: 64 * 1024,
    }
    : {
      // 生产:仅 https、仅 443/80,不跟随重定向,10 秒内必须给出响应(ch10 §10.3)
      allowedProtocols: ['https:'],
      allowedPorts: [443],
      timeoutMs: WEBHOOK_TIMEOUT_MS,
      headersTimeoutMs: WEBHOOK_TIMEOUT_MS,
      maxRedirects: 0,
      maxResponseBytes: 64 * 1024,
    };
}

export const safeFetchTransport: WebhookTransport = {
  async post(url, rawBody, headers) {
    const res = await safePostJson(url, rawBody, headers, netOptions());
    return { status: res.status, body: res.body };
  },
};

/**
 * 保存 endpoint 时的预校验(供后台设置页与 apps/api 调用)。
 * 返回人类可读的拒绝原因,而不是让用户等到第一次投递失败才发现。
 */
export async function validateWebhookTarget(url: string): Promise<{ ok: true } | { ok: false; reason: string; detail?: string }> {
  try {
    await assertSafeUrl(url, netOptions());
    return { ok: true };
  } catch (err) {
    if (err instanceof SsrfError) {
      return { ok: false, reason: err.reason, ...(err.detail ? { detail: err.detail } : {}) };
    }
    throw err;
  }
}
