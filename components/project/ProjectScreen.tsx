"use client";

import { useEffect } from "react";
import { ProjectPage } from "./ProjectPage";
import { THEME_SWITCHING, useThemePref } from "../useTheme";
import type { Filters } from "@/lib/projectFilters";

// The /{project} route: the same project page, opened directly (shareable link, reload-safe).
export function ProjectScreen({ id, name, filters }: { id: string; name: string; filters: Filters }) {
  const [pref] = useThemePref();
  // same rule as the main app: Auto is dark
  const theme = !THEME_SWITCHING ? "dark" : pref === "auto" ? "dark" : pref;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return <ProjectPage id={id} name={name} mode="page" initialFilters={filters} />;
}
