import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  getEventBySlug, getCfpConfig, getSubmissionByToken, localize,
  type Author,
} from '@yumeet/core';
import { SubmissionForm, type AuthorDraft } from '@/components/submission-form';
import { resolveLocale } from '@/lib/locale-server';
import { eventBase } from '@/lib/event-base';
import { translator, eventContent } from '@/lib/i18n';
import styles from '../cfp.module.css';

export const dynamic = 'force-dynamic'; // 草稿续写页不缓存

interface Props {
  params: Promise<{ org: string; event: string }>;
  searchParams: Promise<{ lang?: string; draft?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, event } = await params;
  const found = await getEventBySlug(org, event);
  return {
    title: found ? `提交摘要 · ${found.event.title}` : '提交摘要',
    robots: { index: false, follow: false },
  };
}

const toDraft = (a: Author): AuthorDraft => ({
  name: a.name ?? '',
  email: a.email ?? '',
  affiliation: a.affiliation ?? '',
  isPresenter: Boolean(a.isPresenter),
});

/** 投稿表单页(ch04 §4.3);带 ?draft={token} 时续写既有草稿 */
export default async function CfpSubmitPage({ params, searchParams }: Props) {
  const { org: orgSlug, event: eventSlug } = await params;
  const base = await eventBase(orgSlug, eventSlug);
  const sp = await searchParams;
  const locale = await resolveLocale(sp);
  const tt = translator(locale);

  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found || found.event.status === 'draft') notFound();
  const { event } = found;
  if (!event.modules?.cfp) notFound();

  const content = eventContent(event, locale);
  const config = getCfpConfig(event);
  const closed = new Date() > config.deadlines.submission;

  const draftToken = sp.draft ?? null;
  const draft = draftToken ? await getSubmissionByToken(draftToken) : null;
  const editable = draft?.submission.status === 'draft'
    || draft?.submission.status === 'changes_requested';
  const row = editable ? draft?.submission : undefined;

  return (
    <main className={styles.page}>

      <h1 className={styles.title}>{tt('subFormTitle')}</h1>
      <p className={styles.lede}>{tt('subFormLede')}</p>

      {closed ? (
        <div className={styles.notice} role="status">
          <p className={styles.noticeTitle}>{tt('cfpClosedTitle')}</p>
          <p className={styles.noticeBody}>{tt('cfpClosedBody')}</p>
        </div>
      ) : (
        <>
          {row && (
            <p className={styles.editingDraft} role="status">{tt('subEditingDraft')}</p>
          )}
          <SubmissionForm
            orgSlug={orgSlug}
            eventSlug={eventSlug}
            locale={locale}
            tracks={config.tracks.map((t) => ({ id: t.id, label: localize(t.label, locale) }))}
            types={config.types.map((t) => ({ id: t.id, label: localize(t.label, locale) }))}
            questions={config.questions}
            abstractMaxLength={config.abstractMaxLength}
            token={row ? draftToken : null}
            initial={{
              title: row?.title ?? '',
              abstract: row?.abstract ?? '',
              type: row?.type ?? '',
              track: row?.track ?? '',
              authors: ((row?.authors ?? []) as Author[]).map(toDraft),
              answers: (row?.answers ?? {}) as Record<string, unknown>,
            }}
          />
        </>
      )}
    </main>
  );
}
