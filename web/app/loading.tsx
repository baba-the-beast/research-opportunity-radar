import { LoadingRows, Page } from '@/components/ui';

/** Shown instantly on navigation while the next page's server response is on its way. */
export default function Loading() {
  return (
    <Page>
      <div className="h-10 w-64 max-w-full rounded-lg bg-surface-container-high animate-pulse" aria-hidden="true" />
      <div className="rounded-2xl surface-card bg-surface">
        <LoadingRows rows={4} label="Loading page" />
      </div>
    </Page>
  );
}
