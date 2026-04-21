import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Download,
  FolderSearch,
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { useDefaultCompany } from "../lib/company";
import type { CompanySkillListItem } from "../lib/types";
import { EmptyState } from "../components/EmptyState";

export function SkillsPage() {
  const company = useDefaultCompany();
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [openSkillId, setOpenSkillId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const skills = useQuery({
    queryKey: ["skills", company.data?.id],
    queryFn: () => api.listCompanySkills(company.data!.id),
    enabled: !!company.data?.id,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["skills"] });

  const scan = useMutation({
    mutationFn: () => api.scanCompanySkills(company.data!.id),
    onSuccess: (r) => {
      invalidate();
      setBanner(
        `Scanned ${r.scannedWorkspaces} workspace(s). Imported ${r.imported.length}, updated ${r.updated.length}.`,
      );
    },
    onError: (e) => setBanner(e instanceof Error ? e.message : String(e)),
  });

  if (company.isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Skills</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Reusable instruction packs your agents can pull from. Attach them per agent from the
            agent's detail page.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => scan.mutate()}
            disabled={scan.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            {scan.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FolderSearch className="size-3.5" />
            )}
            Scan my projects
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent"
          >
            <Download className="size-3.5" /> Import
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="size-3.5" /> New skill
          </button>
        </div>
      </header>

      {banner && (
        <div className="flex items-start justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
          <span>{banner}</span>
          <button
            onClick={() => setBanner(null)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {skills.isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : skills.data && skills.data.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {skills.data.map((s) => (
            <SkillCard
              key={s.id}
              skill={s}
              onOpen={() => setOpenSkillId(s.id)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<BookOpen className="size-6" strokeWidth={1.5} />}
          title="No skills yet"
          description="Add a skill to give your agents specialized knowledge and behavior."
          action={{ label: "New skill", onClick: () => setShowNew(true) }}
        />
      )}

      {showNew && company.data && (
        <NewSkillDialog
          companyId={company.data.id}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            invalidate();
            setShowNew(false);
          }}
        />
      )}
      {showImport && company.data && (
        <ImportSkillDialog
          companyId={company.data.id}
          onClose={() => setShowImport(false)}
          onImported={(msg) => {
            invalidate();
            setBanner(msg);
            setShowImport(false);
          }}
        />
      )}
      {openSkillId && company.data && (
        <SkillDetailDialog
          companyId={company.data.id}
          skillId={openSkillId}
          onClose={() => setOpenSkillId(null)}
          onChanged={invalidate}
        />
      )}
    </div>
  );
}

function SkillCard({
  skill,
  onOpen,
}: {
  skill: CompanySkillListItem;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="flex flex-col rounded-md border border-border bg-card p-4 text-left transition-colors hover:bg-accent/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookOpen className="size-4 text-muted-foreground" />
          <div className="font-medium">{skill.name}</div>
        </div>
        <SourceBadge badge={skill.sourceBadge} label={skill.sourceLabel} />
      </div>
      {skill.description && (
        <div className="mt-2 line-clamp-2 text-sm text-muted-foreground">
          {skill.description}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-mono">{skill.slug}</span>
        <span>
          {skill.attachedAgentCount} agent{skill.attachedAgentCount === 1 ? "" : "s"}
        </span>
      </div>
    </button>
  );
}

function SourceBadge({
  badge,
  label,
}: {
  badge: string;
  label: string | null;
}) {
  const tone =
    badge === "github"
      ? "bg-purple-500/10 text-purple-400 border-purple-500/30"
      : badge === "local"
      ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
      : badge === "skills_sh"
      ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
      : "bg-muted/50 text-muted-foreground border-border";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${tone}`}>
      {label ?? badge}
    </span>
  );
}

function NewSkillDialog({
  companyId,
  onClose,
  onCreated,
}: {
  companyId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [markdown, setMarkdown] = useState(DEFAULT_SKILL_MARKDOWN);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.createCompanySkill(companyId, {
        name: name.trim(),
        slug: slug.trim() || undefined,
        description: description.trim() || undefined,
        markdown,
      }),
    onSuccess: onCreated,
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return;
    create.mutate();
  };

  return (
    <Modal title="New skill" onClose={onClose} maxWidth="max-w-3xl">
      <form onSubmit={onSubmit} className="space-y-4 px-5 py-4">
        <Field label="Name" hint="What the skill does, in plain language.">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Write LinkedIn posts"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>
        <Field label="Slug" hint="URL-safe identifier. Leave blank to auto-generate.">
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="linkedin-posts"
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>
        <Field label="Short description (optional)">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="One line summary"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>
        <Field
          label="SKILL.md"
          hint="The full skill instructions. Uses Markdown with YAML frontmatter."
        >
          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            rows={16}
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>
        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || create.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {create.isPending && <Loader2 className="size-4 animate-spin" />}
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ImportSkillDialog({
  companyId,
  onClose,
  onImported,
}: {
  companyId: string;
  onClose: () => void;
  onImported: (msg: string) => void;
}) {
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);

  const importIt = useMutation({
    mutationFn: () => api.importCompanySkills(companyId, source.trim()),
    onSuccess: (r) => {
      const warnMsg = r.warnings.length ? ` (${r.warnings.length} warning(s))` : "";
      onImported(`Imported ${r.imported.length} skill(s).${warnMsg}`);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!source.trim()) return;
    importIt.mutate();
  };

  return (
    <Modal title="Import skill" onClose={onClose} maxWidth="max-w-lg">
      <form onSubmit={onSubmit} className="space-y-4 px-5 py-4">
        <Field
          label="Source"
          hint="GitHub repo URL, skills.sh link, or a local path on this machine."
        >
          <input
            autoFocus
            required
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="https://github.com/user/repo or /Users/you/my-skill"
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>
        <div className="text-xs text-muted-foreground">
          Examples:
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>https://github.com/anthropics/skills</li>
            <li>https://github.com/anthropics/skills/tree/main/document-skills/pdf</li>
            <li>/Users/you/Downloads/AIOS/.claude/skills/research</li>
          </ul>
        </div>
        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!source.trim() || importIt.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {importIt.isPending && <Loader2 className="size-4 animate-spin" />}
            Import
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SkillDetailDialog({
  companyId,
  skillId,
  onClose,
  onChanged,
}: {
  companyId: string;
  skillId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ["skill", companyId, skillId],
    queryFn: () => api.getCompanySkill(companyId, skillId),
  });
  const file = useQuery({
    queryKey: ["skill-file", companyId, skillId, "SKILL.md"],
    queryFn: () => api.getCompanySkillFile(companyId, skillId, "SKILL.md"),
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.updateCompanySkillFile(companyId, skillId, "SKILL.md", draft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skill-file", companyId, skillId] });
      qc.invalidateQueries({ queryKey: ["skill", companyId, skillId] });
      onChanged();
      setEditing(false);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const remove = useMutation({
    mutationFn: () => api.deleteCompanySkill(companyId, skillId),
    onSuccess: () => {
      onChanged();
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const startEdit = () => {
    setDraft(file.data?.content ?? "");
    setEditing(true);
  };

  const content = file.data?.content ?? "";
  const editable = file.data?.editable ?? false;

  return (
    <Modal
      title={detail.data?.name ?? "Skill"}
      onClose={onClose}
      maxWidth="max-w-4xl"
    >
      <div className="space-y-4 px-5 py-4">
        {detail.isLoading || file.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-xs text-muted-foreground">
                  {detail.data?.slug}
                </div>
                {detail.data?.description && (
                  <div className="mt-1 text-sm">{detail.data.description}</div>
                )}
              </div>
              {detail.data && (
                <SourceBadge
                  badge={detail.data.sourceBadge}
                  label={detail.data.sourceLabel}
                />
              )}
            </div>

            {detail.data && detail.data.usedByAgents.length > 0 && (
              <div className="rounded-md border border-border bg-background p-3 text-xs">
                <div className="mb-1 text-muted-foreground">Attached to</div>
                <div className="flex flex-wrap gap-1">
                  {detail.data.usedByAgents.map((a) => (
                    <span
                      key={a.id}
                      className="rounded-full border border-border bg-card px-2 py-0.5"
                    >
                      {a.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {editing ? (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={22}
                className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              />
            ) : (
              <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 font-mono text-xs">
                {content || <span className="text-muted-foreground italic">Empty.</span>}
              </pre>
            )}

            {error && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
              <button
                onClick={() => {
                  if (
                    confirm(
                      `Delete skill "${detail.data?.name}"? Agents using it will lose access.`,
                    )
                  ) {
                    remove.mutate();
                  }
                }}
                disabled={remove.isPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                <Trash2 className="size-3.5" /> Delete
              </button>
              <div className="flex gap-2">
                {editing ? (
                  <>
                    <button
                      onClick={() => setEditing(false)}
                      className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => save.mutate()}
                      disabled={save.isPending}
                      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {save.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Save className="size-4" />
                      )}
                      Save
                    </button>
                  </>
                ) : (
                  <button
                    onClick={startEdit}
                    disabled={!editable}
                    title={!editable ? (detail.data?.editableReason ?? "") : undefined}
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
                  >
                    Edit SKILL.md
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  maxWidth,
  children,
}: {
  title: string;
  onClose: () => void;
  maxWidth: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className={`w-full ${maxWidth} max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 text-sm font-medium">{label}</div>
      {children}
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </label>
  );
}

const DEFAULT_SKILL_MARKDOWN = `---
name: my-skill
description: One-line description of when this skill should be used.
---

# My Skill

Describe the procedure this skill performs.

## Steps

1. First step
2. Second step
3. Third step
`;
