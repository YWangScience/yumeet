/**
 * 模板与主题系统(ch07)—— 客户端安全入口。
 * 只导出纯逻辑:manifest 校验、色彩数学与对比度、注册表、token 合并与 CSS 序列化。
 * 写路径(数据库 + 审计)在 ./service,只由 '@yumeet/core' 导出。
 */
export * from './manifest';
export * from './color';
export * from './registry';
export * from './css';
