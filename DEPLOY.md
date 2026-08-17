# yuMeet 本机部署说明

当前实例运行在这台服务器上,两个域名均已配置 HTTPS 与自动续期。

## 域名与路由

| 域名 | 用途 | 路由方式 |
| --- | --- | --- |
| `https://yumeet.ywang.science` | 平台主站(产品介绍 + 会议索引) | 根路径显示落地页,`/{org}/{event}` 访问具体会议 |
| `https://mg18.ywang.science` | MG18 演示站(白标域名) | 根路径直达会议,URL 中不出现 `/icranet/mg18` 前缀 |

白标域名映射在 `apps/web/src/middleware.ts` 的 `DOMAIN_MAP` 中声明。
新增绑定域名时:① 加 DNS A 记录 → ② 在 `DOMAIN_MAP` 加一行 → ③ 跑一次 certbot(见下)。

## HTTPS 证书

由既有的 **nginx + certbot** 体系托管(与本机其他站点一致,未引入 Caddy):

- 证书:`/etc/letsencrypt/live/yumeet.ywang.science/`(SAN 同时覆盖两个域名)
- 签发机构:Let's Encrypt,有效期 90 天
- **自动续期**:`certbot.timer`(systemd,每日两次),续期后自动 reload nginx
- 验证续期:`certbot renew --dry-run`
- HTTP 自动 301 跳转 HTTPS(由 certbot `--redirect` 写入)

## nginx 配置

- 站点:`/etc/nginx/sites-enabled/yumeet.ywang.science`、`/etc/nginx/sites-enabled/mg18.ywang.science`
- 共用反代片段:`/etc/nginx/snippets/yumeet-proxy.conf` → `127.0.0.1:3210`
- 改完执行 `nginx -t && systemctl reload nginx`

## 端口分配(本机已有其他服务,勿冲突)

| 端口 | 占用者 |
| --- | --- |
| 3000 | 其他 Next.js 应用 |
| 3100 | Transient-Agent |
| 3200 | www.galileoxu.org |
| **3210** | **yuMeet(本项目)** |
| 5433 | yuMeet PostgreSQL 17(容器) |
| 6380 | yuMeet Redis 7(容器) |

## 本地开发

```bash
# 1. 起数据库与 Redis
docker compose -f deploy/docker-compose.dev.yml up -d

# 2. 装依赖
pnpm install

# 3. 建表(Drizzle push)
cd packages/db && DATABASE_URL='postgresql://yumeet:yumeet_dev@localhost:5433/yumeet' pnpm exec drizzle-kit push

# 4. 灌入 MG18 演示数据
DATABASE_URL='postgresql://yumeet:yumeet_dev@localhost:5433/yumeet' pnpm exec tsx src/seed.ts

# 5. 启动 web(端口 3210)
cd ../../apps/web && DATABASE_URL='postgresql://yumeet:yumeet_dev@localhost:5433/yumeet' pnpm dev
```

## 检查清单

```bash
pnpm --filter @yumeet/web typecheck   # 类型
pnpm --filter @yumeet/core test       # 核心逻辑单测
curl -sI https://mg18.ywang.science   # 证书与跳转
certbot certificates                  # 证书到期日
docker compose -f deploy/docker-compose.dev.yml ps   # 容器状态
```

## 生产化待办

当前是开发模式(`next dev`)运行。生产部署需要:

1. `pnpm build && pnpm start`,或用 `deploy/docker-compose.yml` 的完整七容器方案(ch11 §11.2)
2. 用 systemd unit 或 PM2 守护进程,确保重启后自动拉起
3. `DATABASE_URL` 等敏感配置移入环境变量文件,不写进仓库
4. 接入 `apps/worker`(邮件、webhook 投递、保留期清理)
