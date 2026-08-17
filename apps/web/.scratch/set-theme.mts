import { updateEventTheme, getEventBySlug } from '@yumeet/core';

const themeId = process.argv[2] ?? 'cupertino';
const accent = process.argv[3];

async function main() {
  const found = await getEventBySlug('icranet', 'mg18');
  if (!found) throw new Error('mg18 not found');
  const overrides = accent && accent !== 'none' ? { '--yu-color-accent': accent } : {};
  const r = await updateEventTheme({
    eventId: found.event.id,
    themeId,
    overrides,
    actor: { type: 'user', id: null, ip: '127.0.0.1' },
  });
  console.log('写入结果:', JSON.stringify(r));
  const after = await getEventBySlug('icranet', 'mg18');
  console.log('库中现值:', after!.event.themeId, JSON.stringify(after!.event.themeOverrides));
  process.exit(0);
}
main();
