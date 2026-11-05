/** Notification types and how each one reads, shared by the bell, email and Teams. */
export const NOTIFICATION_TYPES = [
  'review.submitted',
  'review.sent_back',
  'review.approved',
  'review.withdrawn',
  'review.comment',
  'page.published',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationPayload {
  pageId: string;
  pageTitle: string;
  actorName: string;
  reviewId?: string;
  version?: number;
  note?: string;
  folderName?: string;
}

/** Events a watch can follow. */
export const WATCH_EVENTS = ['published', 'review'] as const;
export type WatchEvent = (typeof WATCH_EVENTS)[number];

const q = (s: string) => `“${s}”`;

export function describeNotification(type: string, p: NotificationPayload): { title: string; body: string } {
  const title = q(p.pageTitle || 'Untitled');
  const note = p.note?.trim() ? p.note.trim() : '';
  switch (type) {
    case 'review.submitted':
      return { title: `Review requested: ${title}`, body: `${p.actorName} asked for a review of ${title}.${note ? `\n\n${note}` : ''}` };
    case 'review.sent_back':
      return { title: `Sent back: ${title}`, body: `${p.actorName} sent ${title} back for changes.${note ? `\n\n${note}` : ''}` };
    case 'review.approved':
      return {
        title: `Approved: ${title}`,
        body: `${p.actorName} approved ${title}${p.version ? ` and published version ${p.version}` : ''}.${note ? `\n\n${note}` : ''}`,
      };
    case 'review.withdrawn':
      return { title: `Review withdrawn: ${title}`, body: `${p.actorName} withdrew the review request for ${title}.` };
    case 'review.comment':
      return { title: `New comment: ${title}`, body: `${p.actorName} commented on the review of ${title}.${note ? `\n\n${note}` : ''}` };
    case 'page.published':
      return {
        title: `Published: ${title}`,
        body: `${p.actorName} published ${title}${p.version ? ` (version ${p.version})` : ''}${p.folderName ? ` in ${p.folderName}` : ''}.`,
      };
    default:
      return { title, body: `${p.actorName} updated ${title}.` };
  }
}
