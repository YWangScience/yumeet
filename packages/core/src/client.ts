/**
 * 客户端安全入口:只导出纯逻辑(无 node: 内置模块依赖)。
 * 浏览器组件必须从 '@yumeet/core/client' 导入,不要从 '@yumeet/core'——
 * 后者含审计哈希链(node:crypto)与数据库访问,只能在服务端使用。
 */
export * from './ids/index';
export * from './state/index';
export * from './forms/types';
/* 主题系统的纯逻辑部分(ch07):token 合并、色彩数学、对比度守卫 */
export * from './themes/index';
// 日程编排器要在浏览器里实时跑冲突检测,服务端发布前用同一份代码复核
// (ch05 §5.1.2「不允许出现两套判定逻辑」)。services/schedule.ts 是纯模块,
// 不 import @yumeet/db 也不 import node: 内置模块,可安全进客户端包。
export * from './services/schedule';
