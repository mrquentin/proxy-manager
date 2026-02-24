import { Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRoutes, useDeleteRoute } from "@/lib/queries/routes";

interface RouteListProps {
  vpsId: string;
}

export function RouteList({ vpsId }: RouteListProps) {
  const { data: routes, isLoading } = useRoutes(vpsId);
  const deleteRoute = useDeleteRoute(vpsId);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (!routes || routes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-muted-foreground">
          No L4 routes configured. Create one to start forwarding traffic.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>ID</TableHead>
          <TableHead>Tunnel ID</TableHead>
          <TableHead>Match Type</TableHead>
          <TableHead>Domains</TableHead>
          <TableHead>Upstream</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="w-[60px]">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {routes.map((route) => (
          <TableRow key={route.id}>
            <TableCell className="font-mono text-xs">{route.id}</TableCell>
            <TableCell className="font-mono text-xs">
              {route.tunnelId}
            </TableCell>
            <TableCell>
              <Badge variant="outline">{route.matchType.toUpperCase()}</Badge>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {route.matchValue.map((v) => (
                  <Badge key={v} variant="secondary" className="text-xs">
                    {v}
                  </Badge>
                ))}
              </div>
            </TableCell>
            <TableCell className="font-mono text-xs">
              {route.upstream}
            </TableCell>
            <TableCell>
              {route.enabled ? (
                <Badge variant="success">Active</Badge>
              ) : (
                <Badge variant="secondary">Disabled</Badge>
              )}
            </TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (confirm(`Delete route ${route.id}?`)) {
                    deleteRoute.mutate(route.id);
                  }
                }}
                disabled={deleteRoute.isPending}
                title="Delete route"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
