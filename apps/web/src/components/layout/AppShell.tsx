import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { Toaster } from "../ui/toaster";
import { useVpsEvents } from "@/hooks/use-vps-events";
import { useTheme } from "@/hooks/use-theme";

export function AppShell() {
  useTheme();
  useVpsEvents();

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  );
}
