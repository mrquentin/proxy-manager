import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Trash2,
  RefreshCw,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { VpsStatusBadge } from "@/components/vps/VpsStatusBadge";
import { TunnelList } from "@/components/tunnels/TunnelList";
import { CreateTunnelDialog } from "@/components/tunnels/CreateTunnelDialog";
import { RotationPolicyForm } from "@/components/tunnels/RotationPolicyForm";
import { RouteList } from "@/components/forwarding/RouteList";
import { CreateRouteDialog } from "@/components/forwarding/CreateRouteDialog";
import { FirewallRuleList } from "@/components/firewall/FirewallRuleList";
import { CreateFirewallRuleDialog } from "@/components/firewall/CreateFirewallRuleDialog";
import {
  useVpsDetail,
  useVpsStatus,
  useDeleteVps,
  useReconcileVps,
} from "@/lib/queries/vps";
import { formatRelativeTime } from "@/lib/utils";
import type { Tunnel } from "@proxy-manager/shared";

export function VpsDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    data: vps,
    isLoading: vpsLoading,
    error: vpsError,
  } = useVpsDetail(id!);
  const { data: statusReport, isLoading: statusLoading } = useVpsStatus(id!);
  const deleteVps = useDeleteVps();
  const reconcile = useReconcileVps();
  const [selectedTunnel, setSelectedTunnel] = useState<Tunnel | null>(null);

  if (vpsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (vpsError || !vps) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate("/")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Dashboard
        </Button>
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {vpsError ? `Failed to load VPS: ${vpsError.message}` : "VPS not found."}
        </div>
      </div>
    );
  }

  const handleDelete = () => {
    if (confirm(`Delete VPS "${vps.name}"? This cannot be undone.`)) {
      deleteVps.mutate(vps.id, {
        onSuccess: () => navigate("/"),
      });
    }
  };

  const recon = statusReport?.reconciliation;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">{vps.name}</h1>
              <VpsStatusBadge status={vps.status} />
            </div>
            <p className="text-sm text-muted-foreground font-mono">
              {vps.apiUrl}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => reconcile.mutate(vps.id)}
            disabled={reconcile.isPending}
          >
            {reconcile.isPending ? (
              <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Sync Now
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={deleteVps.isPending}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      <Tabs defaultValue="tunnels" className="space-y-4">
        <TabsList>
          <TabsTrigger value="tunnels">
            Tunnels
            {statusReport && (
              <Badge variant="secondary" className="ml-2">
                {statusReport.tunnels.total}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="routes">
            Routes
            {statusReport && (
              <Badge variant="secondary" className="ml-2">
                {statusReport.routes.total}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="firewall">
            Firewall
            {statusReport && (
              <Badge variant="secondary" className="ml-2">
                {statusReport.firewall.dynamicRules}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="status">Status</TabsTrigger>
        </TabsList>

        <TabsContent value="tunnels" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">WireGuard Tunnels</h2>
              <p className="text-sm text-muted-foreground">
                Manage WireGuard peers on this VPS
              </p>
            </div>
            <CreateTunnelDialog vpsId={vps.id} />
          </div>
          <TunnelList
            vpsId={vps.id}
            onSelectTunnel={setSelectedTunnel}
          />
          {selectedTunnel && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Rotation Policy: {selectedTunnel.id}
                </CardTitle>
                <CardDescription>
                  Configure automatic key rotation for this tunnel
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RotationPolicyForm
                  vpsId={vps.id}
                  tunnelId={selectedTunnel.id}
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="routes" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">L4 Routes</h2>
              <p className="text-sm text-muted-foreground">
                SNI-based forwarding rules
              </p>
            </div>
            <CreateRouteDialog vpsId={vps.id} />
          </div>
          <RouteList vpsId={vps.id} />
        </TabsContent>

        <TabsContent value="firewall" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Firewall Rules</h2>
              <p className="text-sm text-muted-foreground">
                Dynamic nftables rules
              </p>
            </div>
            <CreateFirewallRuleDialog vpsId={vps.id} />
          </div>
          <FirewallRuleList vpsId={vps.id} />
        </TabsContent>

        <TabsContent value="status" className="space-y-4">
          <h2 className="text-lg font-semibold">VPS Status</h2>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="h-4 w-4" />
                  Connection Info
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <VpsStatusBadge status={vps.status} />
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last Seen</span>
                  <span>{formatRelativeTime(vps.lastSeenAt)}</span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Registered</span>
                  <span>{new Date(vps.createdAt).toLocaleDateString()}</span>
                </div>
                {statusReport && (
                  <>
                    <Separator />
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Connected Peers
                      </span>
                      <span>
                        {statusReport.tunnels.connected} /{" "}
                        {statusReport.tunnels.total}
                      </span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <RefreshCw className="h-4 w-4" />
                  Reconciliation
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {statusLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                ) : recon ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Interval</span>
                      <span>{recon.intervalSeconds}s</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Last Run</span>
                      <span>{formatRelativeTime(recon.lastRunAt)}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Last Status</span>
                      <Badge
                        variant={
                          recon.lastStatus === "ok"
                            ? "success"
                            : recon.lastStatus === "error"
                              ? "destructive"
                              : recon.lastStatus === "drift_corrected"
                                ? "warning"
                                : "secondary"
                        }
                      >
                        {recon.lastStatus}
                      </Badge>
                    </div>
                    {recon.lastError && (
                      <>
                        <Separator />
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            Last Error
                          </span>
                          <span className="text-destructive text-xs max-w-[200px] truncate">
                            {recon.lastError}
                          </span>
                        </div>
                      </>
                    )}
                    <Separator />
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Drift Corrections
                      </span>
                      <span>{recon.driftCorrectionsTotal}</span>
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    Reconciliation data unavailable. VPS may be offline.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
