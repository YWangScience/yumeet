import { eventThemeCss } from '@yumeet/core';

interface Props {
  /** events.theme_id;未知或为空时由 core 回落到 Cupertino */
  themeId: string | null | undefined;
  /** events.theme_overrides(JSONB),进入 CSS 前由 core 逐条净化 */
  overrides: unknown;
}

/**
 * 活动主题注入(ch07 §7.2 / §7.5)
 *
 * 服务端组件:把「主题包 token(含 extends 回落)+ 活动级覆盖」序列化成一段
 * CSS 自定义属性,随 HTML 一起直出。三点刻意为之:
 *  1. 不用客户端 JS 改样式——首屏就是最终配色,不存在先默认蓝再闪成品牌色;
 *  2. 只产出自定义属性声明,不含选择器以外的任何结构,CSP 无需 script 豁免;
 *  3. 值经 core 的白名单净化(禁止 ; { } < > @ : \ / *),因此可以安全地用
 *     dangerouslySetInnerHTML —— <style> 内是原始文本,React 的文本转义会把字体栈里的
 *     引号变成 &quot; 而浏览器不会还原,反而写坏 CSS。
 */
export function ThemeStyle({ themeId, overrides }: Props) {
  const { themeId: resolved, css } = eventThemeCss(themeId, overrides);
  if (!css) return null;
  return (
    <style
      data-yu-theme={resolved}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: css }}
    />
  );
}
