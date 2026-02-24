import { Outlet } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { useTheme } from "@/hooks/use-theme";
import { Toaster } from "@/components/ui/toaster";

export function AuthLayout() {
  useTheme();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Proxy Manager</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            L4 traffic forwarding through VPS instances over WireGuard tunnels
          </p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <Outlet />
          </CardContent>
        </Card>
      </div>
      <Toaster />
    </div>
  );
}
