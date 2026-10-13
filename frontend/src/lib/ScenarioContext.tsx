import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client";
import type { Progress, SectionNode, User } from "../api/types";

interface ScenarioState {
  tree: SectionNode[];
  progress: Progress | null;
  team: User[];
  error: string | null;
  reloadTree: () => Promise<void>;
  reloadProgress: () => Promise<void>;
  /** Members can be added or get roles while the app is open — refresh before picking an assignee. */
  reloadTeam: () => Promise<void>;
}

const ScenarioContext = createContext<ScenarioState | null>(null);

/** Data shared by the sidebar and pages: navigation tree, task progress and team members. */
export function ScenarioProvider({ children }: { children: ReactNode }) {
  const [tree, setTree] = useState<SectionNode[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [team, setTeam] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reloadTree = useCallback(async () => {
    try {
      setTree(await api.sectionTree());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const reloadProgress = useCallback(async () => {
    try {
      setProgress(await api.progress());
    } catch {
      /* progress is decorative; ignore */
    }
  }, []);

  const reloadTeam = useCallback(async () => {
    try {
      setTeam(await api.users(true));
    } catch {
      /* keep the list we have */
    }
  }, []);

  useEffect(() => {
    void reloadTree();
    void reloadProgress();
    void reloadTeam();
  }, [reloadTree, reloadProgress, reloadTeam]);

  const value = useMemo(
    () => ({ tree, progress, team, error, reloadTree, reloadProgress, reloadTeam }),
    [tree, progress, team, error, reloadTree, reloadProgress, reloadTeam],
  );
  return <ScenarioContext.Provider value={value}>{children}</ScenarioContext.Provider>;
}

export function useScenario(): ScenarioState {
  const ctx = useContext(ScenarioContext);
  if (!ctx) throw new Error("useScenario must be used inside <ScenarioProvider>");
  return ctx;
}

/** Walk up the tree to the top-level page that renders `slug`. */
export function findTopSlug(tree: SectionNode[], slug: string): string | null {
  for (const root of tree) {
    if (root.slug === slug) return root.slug;
    const stack = [...root.children];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.slug === slug) return root.slug;
      stack.push(...node.children);
    }
  }
  return null;
}

export function flattenTree(tree: SectionNode[], depth = 0): Array<SectionNode & { depth: number }> {
  return tree.flatMap((n) => [{ ...n, depth }, ...flattenTree(n.children, depth + 1)]);
}
