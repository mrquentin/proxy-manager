import { Trash2, RotateCw } from "lucide-react";
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
import { useTunnels, useDeleteTunnel, useRotateTunnel } from "@/lib/queries/tunnels";
import { formatBytes, formatRelativeTime } from "@/lib/utils";
import type { Tunnel } from "@proxy-manager/shared";

interface TunnelListProps {
  vpsId: string;
  onSelectTunnel?: (tunnel: Tunnel) => void;
}

export function TunnelList({ vpsId, onSelectTunnel }: TunnelListProps) {
  const { data: tunnels, isLoading } = useTunnels(vpsId);
  const deleteTunnel = useDeleteTunnel(vpsId);
  const rotateTunnel = useRotateTunnel(vpsId);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (!tunnels || tunnels.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-muted-foreground">
          No tunnels configured. Create one to get started.
        </p>
      </div>
    );
  }

  const isConnected = (tunnel: Tunnel) => {
    if (!tunnel.lastHandshake) return false;
    const diff = Date.now() - new Date(tunnel.lastHandshake).getTime();
    return diff < 5 * 60 * 1000;
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>ID</TableHead>
          <TableHead>VPN IP</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Last Handshake</TableHead>
          <TableHead>TX / RX</TableHead>
          <TableHead>Domains</TableHead>
          <TableHead className="w-[100px]">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tunnels.map((tunnel) => (
          <TableRow
            key={tunnel.id}
            className="cursor-pointer"
            onClick={() => onSelectTunnel?.(tunnel)}
          >
            <TableCell className="font-mono text-xs">{tunnel.id}</TableCell>
            <TableCell className="font-mono">{tunnel.vpnIp}</TableCell>
            <TableCell>
              {isConnected(tunnel) ? (
                <Badge variant="success">Connected</Badge>
              ) : (
                <Badge variant="secondary">Disconnected</Badge>
              )}
              {tunnel.pendingRotationId && (
                <Badge variant="warning" className="ml-1">
                  Rotating
                </Badge>
              )}
            </TableCell>
            <TableCell>{formatRelativeTime(tunnel.lastHandshake)}</TableCell>
            <TableCell>
              {formatBytes(tunnel.txBytes)} / {formatBytes(tunnel.rxBytes)}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {tunnel.domains.length > 0 ? (
                  tunnel.domains.map((d) => (
                    <Badge key={d} variant="outline" className="text-xs">
                      {d}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">None</span>
                )}
              </div>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => rotateTunnel.mutate(tunnel.id)}
                  disabled={rotateTunnel.isPending}
                  title="Rotate keys"
                >
                  <RotateCw className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    if (confirm(`Delete tunnel ${tunnel.id}? This will remove all associated routes.`)) {
                      deleteTunnel.mutate(tunnel.id);
                    }
                  }}
                  disabled={deleteTunnel.isPending}
                  title="Delete tunnel"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
