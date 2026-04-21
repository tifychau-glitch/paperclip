// Unified status badge. Handles both agent statuses (idle/running/paused/
// pending_approval/error) and run statuses (queued/running/succeeded/failed/
// cancelled), mapped to a single six-tone palette (gray / blue / amber /
// purple / red / green) so the visual language stays consistent everywhere.
//
// Pass `compact` for tight layouts (e.g. the OrgChart card) — renders just a
// small tinted dot instead of the full text pill.

export type StatusBadgeSize = "sm" | "md";

export type StatusBadgeProps = {
  status: string;
  /** Render a dot-only indicator instead of the full text pill. */
  compact?: boolean;
  size?: StatusBadgeSize;
  className?: string;
};

type Tone = "gray" | "blue" | "amber" | "purple" | "red" | "green";

type Mapping = { label: string; tone: Tone; pulse?: boolean };

// Agent statuses — spec-mandated mapping.
const AGENT_MAP: Record<string, Mapping> = {
  idle: { label: "Idle", tone: "gray" },
  active: { label: "Idle", tone: "gray" },
  running: { label: "Working", tone: "blue", pulse: true },
  paused: { label: "Paused", tone: "amber" },
  pending_approval: { label: "Pending approval", tone: "purple" },
  error: { label: "Error", tone: "red" },
};

// Run statuses — kept in the same component so badges in run rows share the
// exact same visual treatment (colors, geometry, animation) as agent badges.
const RUN_MAP: Record<string, Mapping> = {
  queued: { label: "Queued", tone: "gray" },
  running: { label: "Running", tone: "blue", pulse: true },
  succeeded: { label: "Succeeded", tone: "green" },
  failed: { label: "Failed", tone: "red" },
  cancelled: { label: "Cancelled", tone: "gray" },
};

function resolve(status: string): Mapping {
  const s = status.toLowerCase();
  return (
    AGENT_MAP[s] ??
    RUN_MAP[s] ?? { label: prettify(status), tone: "gray" }
  );
}

function prettify(raw: string): string {
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const PILL_TONES: Record<Tone, string> = {
  gray: "bg-muted/50 text-muted-foreground border-border",
  blue: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  amber: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  purple: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  red: "bg-red-500/10 text-red-400 border-red-500/30",
  green: "bg-green-500/10 text-green-400 border-green-500/30",
};

const DOT_TONES: Record<Tone, string> = {
  gray: "bg-muted-foreground",
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  purple: "bg-purple-500",
  red: "bg-red-500",
  green: "bg-green-500",
};

export function StatusBadge({
  status,
  compact = false,
  size = "sm",
  className = "",
}: StatusBadgeProps) {
  const m = resolve(status);

  if (compact) {
    return (
      <span
        className={`inline-block size-2 shrink-0 rounded-full ${DOT_TONES[m.tone]} ${
          m.pulse ? "clipboard-status-pulse" : ""
        } ${className}`}
        title={m.label}
        aria-label={m.label}
      />
    );
  }

  const padding = size === "md" ? "px-2.5 py-0.5 text-xs" : "px-2 py-0.5 text-xs";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border ${padding} ${PILL_TONES[m.tone]} ${
        m.pulse ? "clipboard-status-pulse" : ""
      } ${className}`}
    >
      {m.pulse && (
        <span className={`size-1.5 rounded-full ${DOT_TONES[m.tone]}`} aria-hidden />
      )}
      {m.label}
    </span>
  );
}
