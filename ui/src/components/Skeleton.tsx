// Shimmer skeletons. The base `Skeleton` is a plain rounded block; the page
// composites them into shapes that match the real content's geometry so the
// layout doesn't jump on swap. Shimmer animation lives in index.css.

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`clipboard-shimmer rounded-md ${className}`} aria-hidden />;
}

/** Placeholder card matching AgentCard dimensions (name + title + body + footer). */
export function AgentCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <div className="flex gap-2 border-t border-border p-3">
        <Skeleton className="h-7 flex-1" />
        <Skeleton className="h-7 w-10" />
      </div>
    </div>
  );
}

/** Placeholder row matching the RunRow layout in Tasks feed. */
export function RunRowSkeleton() {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-40" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
    </div>
  );
}
