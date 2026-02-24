import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Server,
  Settings,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import { Skeleton } from "../ui/skeleton";
import { useUIStore } from "@/lib/store/ui";
import { useVpsList } from "@/lib/queries/vps";
import { VpsStatusBadge } from "../vps/VpsStatusBadge";

export function Sidebar() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const { data: vpsList, isLoading } = useVpsList();

  return (
    <aside
      className={cn(
        "flex flex-col border-r bg-sidebar-background text-sidebar-foreground transition-all duration-200",
        sidebarOpen ? "w-64" : "w-14"
      )}
    >
      <div className="flex h-14 items-center justify-between px-3">
        {sidebarOpen && (
          <span className="text-lg font-semibold tracking-tight">
            Proxy Manager
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className="shrink-0"
          aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
          {sidebarOpen ? (
            <PanelLeftClose className="h-4 w-4" />
          ) : (
            <PanelLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      <Separator />

      <nav className="flex-1 space-y-1 p-2">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground"
            )
          }
        >
          <LayoutDashboard className="h-4 w-4 shrink-0" />
          {sidebarOpen && <span>Dashboard</span>}
        </NavLink>

        {sidebarOpen && (
          <div className="px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              VPS Instances
            </span>
          </div>
        )}

        {isLoading ? (
          sidebarOpen ? (
            <div className="space-y-2 px-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : null
        ) : (
          vpsList?.map((vps) => (
            <NavLink
              key={vps.id}
              to={`/vps/${vps.id}`}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground"
                )
              }
            >
              <Server className="h-4 w-4 shrink-0" />
              {sidebarOpen && (
                <span className="flex-1 truncate">{vps.name}</span>
              )}
              {sidebarOpen && <VpsStatusBadge status={vps.status} compact />}
            </NavLink>
          ))
        )}

        <Separator className="my-2" />

        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground"
            )
          }
        >
          <Settings className="h-4 w-4 shrink-0" />
          {sidebarOpen && <span>Settings</span>}
        </NavLink>
      </nav>
    </aside>
  );
}
