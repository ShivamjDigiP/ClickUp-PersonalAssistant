"use client";

import { useEffect, useState } from "react";
import { ProjectPage } from "./ProjectPage";
import { THEME_SWITCHING, useThemePref } from "../useTheme";
import type { Filters } from "@/lib/projectFilters";

// The /{project} route: the same project page, opened directly (shareable link, reload-safe).
export function ProjectScreen({ id, name, filters }: { id: string; name: string; filters: Filters }) {
  const [pref] = useThemePref();
  const [readOnly, setReadOnly] = useState(true);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => typeof s.readOnly === "boolean" && setReadOnly(s.readOnly))
      .catch(() => {});
  }, []);

  // same rule as the main app: Auto = light in Read-only, dark otherwise
  const theme = !THEME_SWITCHING ? "dark" : pref === "auto" ? (readOnly ? "light" : "dark") : pref;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return <ProjectPage id={id} name={name} mode="page" initialFilters={filters} />;
}
