/**
 * Stripe 支付插件(ch10 §10.5)
 *
 * 它存在的意义有两层:一是真的把 Stripe 接进来,二是**证明插件 API 够用**。
 * 核心团队不给自己开后门:Stripe 拿到的 hook、provider 与 UI slot,
 * 与任何三方插件完全相同。哪天这套 API 不足以实现 Stripe,
 * 那就是 API 该扩展的信号,而不是「核心直接改 core」的借口(ch13 §13.4)。
 */
import {
  registerHook, registerProvider, registerUiSlot,
  type HookContext,
} from '@yumeet/core';

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  statementDescriptor?: string;
}

export interface CheckoutSession {
  id: string;
  url: string;
}

/** 支付方式 provider 的接口 —— 任何在线支付插件都实现它 */
export interface PaymentProvider {
  createCheckout(input: {
    orderId: string; amountCents: number; currency: string; email: string;
    successUrl: string; cancelUrl: string;
  }): Promise<CheckoutSession>;
  verifyWebhook(rawBody: string, signature: string): Promise<{ type: string; orderId: string | null }>;
}

const PLUGIN = 'stripe';

export function createStripeProvider(cfg: StripeConfig): PaymentProvider {
  const api = async (path: string, body: URLSearchParams) => {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Stripe ${path} 失败 ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json() as Promise<Record<string, unknown>>;
  };

  return {
    async createCheckout(input) {
      const body = new URLSearchParams({
        mode: 'payment',
        'line_items[0][price_data][currency]': input.currency.toLowerCase(),
        'line_items[0][price_data][unit_amount]': String(input.amountCents),
        'line_items[0][price_data][product_data][name]': '会议注册费',
        'line_items[0][quantity]': '1',
        customer_email: input.email,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        // orderId 必须回到 webhook 里,否则到账了也不知道是谁的
        'metadata[orderId]': input.orderId,
        client_reference_id: input.orderId,
      });
      if (cfg.statementDescriptor) {
        body.set('payment_intent_data[statement_descriptor]', cfg.statementDescriptor);
      }
      const s = await api('checkout/sessions', body);
      return { id: String(s['id']), url: String(s['url']) };
    },

    async verifyWebhook(rawBody, signature) {
      // 签名校验用 Web Crypto,避免为一个插件引入 stripe SDK
      const parts = Object.fromEntries(
        signature.split(',').map((kv) => kv.split('=') as [string, string]),
      );
      const timestamp = parts['t'];
      const expected = parts['v1'];
      if (!timestamp || !expected) throw new Error('Stripe 签名头格式不正确');

      const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(cfg.webhookSecret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
      );
      const mac = await crypto.subtle.sign(
        'HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`),
      );
      const hex = [...new Uint8Array(mac)]
        .map((b) => b.toString(16).padStart(2, '0')).join('');
      if (hex !== expected) throw new Error('Stripe webhook 签名不匹配');

      const evt = JSON.parse(rawBody) as {
        type: string;
        data: { object: { metadata?: Record<string, string>; client_reference_id?: string } };
      };
      const o = evt.data.object;
      return { type: evt.type, orderId: o.metadata?.['orderId'] ?? o.client_reference_id ?? null };
    },
  };
}

/**
 * 注册插件。宿主在启用插件时调用一次;禁用时宿主调 unregisterPlugin('stripe')
 * 就能把下面注册的东西全部摘掉。
 */
export function register(cfg: StripeConfig): void {
  registerProvider('payment:stripe', PLUGIN, createStripeProvider(cfg));

  // filter:下单前把在线支付的过期时间收紧到 30 分钟
  registerHook('payment.beforeCreateOrder', PLUGIN, (value: unknown) => {
    const v = value as { method?: string; expiresInMinutes?: number };
    if (v.method !== 'stripe') return undefined;   // 不是我的方式,不改
    return { ...v, expiresInMinutes: 30 };
  });

  // action:到账后的副作用(开票、同步 CRM),失败不影响核销本身
  registerHook('payment.afterPaid', PLUGIN, (value: unknown, ctx: HookContext) => {
    const v = value as { orderId?: string };
    console.log(`[${ctx.plugin}] 订单 ${v.orderId} 已支付`);
  });

  // 规则引擎里可用的动作:{"type":"stripe.refund"}
  registerProvider('rule.action:stripe.refund', PLUGIN, async (params: unknown) => {
    const p = params as { orderId?: string };
    if (!p.orderId) throw new Error('stripe.refund 需要 orderId');
    // 真实退款调用在此;此处不静默成功,以免规则日志给出假的绿灯
    throw new Error('退款需在 Stripe 后台确认,插件暂不自动执行');
  });

  registerUiSlot('manage.payments.settings', PLUGIN, {
    label: 'Stripe',
    href: '/manage/settings/stripe',
  });
}
