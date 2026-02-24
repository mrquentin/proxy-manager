import { describe, test, expect, beforeEach, mock } from "bun:test";
import { useUIStore } from "../lib/store/ui";

describe("useTheme / UIStore", () => {
  beforeEach(() => {
    useUIStore.setState({ theme: "system", sidebarOpen: true, selectedVpsId: null });
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
  });

  test("default theme is system", () => {
    const state = useUIStore.getState();
    expect(state.theme).toBe("system");
  });

  test("setTheme changes theme to light", () => {
    useUIStore.getState().setTheme("light");
    expect(useUIStore.getState().theme).toBe("light");
  });

  test("setTheme changes theme to dark", () => {
    useUIStore.getState().setTheme("dark");
    expect(useUIStore.getState().theme).toBe("dark");
  });

  test("setTheme changes theme back to system", () => {
    useUIStore.getState().setTheme("dark");
    useUIStore.getState().setTheme("system");
    expect(useUIStore.getState().theme).toBe("system");
  });

  test("cycling through all themes", () => {
    const themes = ["light", "dark", "system"] as const;
    for (const t of themes) {
      useUIStore.getState().setTheme(t);
      expect(useUIStore.getState().theme).toBe(t);
    }
  });

  test("sidebar state defaults to open", () => {
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  test("toggleSidebar toggles state", () => {
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(false);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  test("setSidebarOpen sets specific value", () => {
    useUIStore.getState().setSidebarOpen(false);
    expect(useUIStore.getState().sidebarOpen).toBe(false);
    useUIStore.getState().setSidebarOpen(true);
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  test("selectedVpsId defaults to null", () => {
    expect(useUIStore.getState().selectedVpsId).toBeNull();
  });

  test("setSelectedVpsId sets and clears", () => {
    useUIStore.getState().setSelectedVpsId("vps-123");
    expect(useUIStore.getState().selectedVpsId).toBe("vps-123");
    useUIStore.getState().setSelectedVpsId(null);
    expect(useUIStore.getState().selectedVpsId).toBeNull();
  });
});
