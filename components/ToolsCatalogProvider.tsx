"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { Tool } from "@/lib/supabase";
import { clearHomeSplashSession } from "@/lib/home-splash";
import { clearClientToolsCache, getClientToolsCache } from "@/lib/tools-client-cache";

type ToolsCatalogContextValue = {
  tools: Tool[];
  setTools: Dispatch<SetStateAction<Tool[]>>;
  loading: boolean;
  setLoading: Dispatch<SetStateAction<boolean>>;
  refreshing: boolean;
  setRefreshing: Dispatch<SetStateAction<boolean>>;
  toolsRef: MutableRefObject<Tool[]>;
};

const ToolsCatalogContext = createContext<ToolsCatalogContextValue | null>(
  null,
);

export function ToolsCatalogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const toolsRef = useRef<Tool[]>([]);
  toolsRef.current = tools;

  useLayoutEffect(() => {
    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (nav?.type === "reload") {
      clearHomeSplashSession();
      clearClientToolsCache();
      return;
    }
    const cached = getClientToolsCache();
    if (cached?.length) {
      setTools(cached);
      setLoading(false);
    }
  }, []);

  const value = useMemo(
    () => ({
      tools,
      setTools,
      loading,
      setLoading,
      refreshing,
      setRefreshing,
      toolsRef,
    }),
    [tools, loading, refreshing],
  );

  return (
    <ToolsCatalogContext.Provider value={value}>
      {children}
    </ToolsCatalogContext.Provider>
  );
}

export function useToolsCatalog() {
  const ctx = useContext(ToolsCatalogContext);
  if (!ctx) {
    throw new Error("useToolsCatalog must be used within ToolsCatalogProvider");
  }
  return ctx;
}
