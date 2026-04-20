import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2, Plus, X } from "lucide-react";
import { api } from "../lib/api";
import {
  setActiveCompanyId,
  useCompanies,
  useDefaultCompany,
} from "../lib/company";

export function CompanySwitcher() {
  const companies = useCompanies();
  const active = useDefaultCompany();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const onPick = (id: string) => {
    setActiveCompanyId(id);
    setOpen(false);
  };

  return (
    <>
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex min-w-[160px] items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent"
        >
          <span className="truncate font-medium">
            {active.data?.name ?? "Loading…"}
          </span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </button>

        {open && (
          <div className="absolute left-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-md border border-border bg-card shadow-lg">
            <div className="border-b border-border px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
              Businesses
            </div>
            <ul className="max-h-72 overflow-auto py-1">
              {companies.data?.map((c) => {
                const isActive = c.id === active.data?.id;
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => onPick(c.id)}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${
                        isActive ? "bg-accent/60" : ""
                      }`}
                    >
                      <span className="truncate">{c.name}</span>
                      {isActive && <Check className="size-3.5 text-primary" />}
                    </button>
                  </li>
                );
              })}
              {companies.isLoading && (
                <li className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Loading…
                </li>
              )}
            </ul>
            <button
              onClick={() => {
                setOpen(false);
                setAdding(true);
              }}
              className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-primary hover:bg-accent"
            >
              <Plus className="size-3.5" /> New business
            </button>
          </div>
        )}
      </div>

      {adding && <NewCompanyDialog onClose={() => setAdding(false)} />}
    </>
  );
}

function NewCompanyDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.createCompany({
        name: name.trim(),
        description: description.trim() || undefined,
      }),
    onSuccess: (company) => {
      qc.invalidateQueries({ queryKey: ["companies"] });
      setActiveCompanyId(company.id);
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return;
    create.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">New business</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 px-5 py-4">
          <label className="block">
            <div className="mb-1.5 text-sm font-medium">Name</div>
            <input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Studio"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block">
            <div className="mb-1.5 text-sm font-medium">Description (optional)</div>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="One line about this business"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <div className="text-xs text-muted-foreground">
            Each business has its own agents, org chart, tasks, skills, and
            activity. You can switch between them from the header.
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
              disabled={!name.trim() || create.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {create.isPending && <Loader2 className="size-4 animate-spin" />}
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
