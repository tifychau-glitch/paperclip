// Reusable empty state block. One icon, one heading, one subtext, optional
// CTA button. Used on every primary tab when the list is empty so the first
// impression is consistent across Agents / Tasks / Skills / Activity.
//
// Icons are passed in as React nodes. The page composes them from lucide-react
// (already installed) — lucide icons are stroke-based 24x24 SVGs using
// currentColor, matching the spec's "simple inline SVG" requirement.

import type { ReactNode } from "react";

export type EmptyStateAction = {
  label: string;
  onClick: () => void;
};

export type EmptyStateProps = {
  icon: ReactNode;
  title: string;
  description: string;
  action?: EmptyStateAction;
};

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="mt-12 flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/30 p-12 text-center">
      <div className="mb-4 inline-flex size-12 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
        {icon}
      </div>
      <h2 className="text-base font-medium text-foreground">{title}</h2>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
