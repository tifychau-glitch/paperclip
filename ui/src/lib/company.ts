// Active-company store. Persists the selected company ID in localStorage
// and exposes hooks to read, switch, and list companies.

import { useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { Company } from "./types";

const STORAGE_KEY = "clipboard.activeCompanyId";
const DEFAULT_COMPANY_NAME = "Main";

const listeners = new Set<() => void>();

function readStored(): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  } catch {
    return null;
  }
}

function writeStored(id: string | null) {
  try {
    if (id === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function notify() {
  for (const cb of listeners) cb();
}

export function setActiveCompanyId(id: string) {
  writeStored(id);
  notify();
}

export function useActiveCompanyId(): string | null {
  return useSyncExternalStore(subscribe, readStored, () => null);
}

export function useCompanies() {
  return useQuery({
    queryKey: ["companies"],
    queryFn: () => api.listCompanies(),
    staleTime: 30_000,
  });
}

export function useDefaultCompany() {
  const activeId = useActiveCompanyId();
  const qc = useQueryClient();
  return useQuery<Company>({
    queryKey: ["activeCompany", activeId ?? "__bootstrap__"],
    queryFn: async () => {
      const companies = await api.listCompanies();
      qc.setQueryData(["companies"], companies);
      if (activeId) {
        const found = companies.find((c) => c.id === activeId);
        if (found) return found;
        // Stored ID no longer exists — fall through to first / create.
      }
      if (companies.length > 0) {
        if (!activeId) writeStored(companies[0].id);
        return companies[0];
      }
      const created = await api.createCompany({ name: DEFAULT_COMPANY_NAME });
      qc.invalidateQueries({ queryKey: ["companies"] });
      writeStored(created.id);
      return created;
    },
    staleTime: Infinity,
  });
}
