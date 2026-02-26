import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useCreateRoute } from "@/lib/queries/routes";
import { useTunnels } from "@/lib/queries/tunnels";
import { useToast } from "@/hooks/use-toast";
import type { L4MatchType, L4Protocol } from "@proxy-manager/shared";

interface CreateRouteDialogProps {
  vpsId: string;
}

export function CreateRouteDialog({ vpsId }: CreateRouteDialogProps) {
  const [open, setOpen] = useState(false);
  const [matchType, setMatchType] = useState<L4MatchType>("sni");
  const [tunnelId, setTunnelId] = useState("");
  const [domains, setDomains] = useState("");
  const [upstreamPort, setUpstreamPort] = useState("443");
  const [protocol, setProtocol] = useState<L4Protocol>("tcp");
  const [listenPort, setListenPort] = useState("");
  const createRoute = useCreateRoute(vpsId);
  const { data: tunnels, isLoading: tunnelsLoading } = useTunnels(vpsId);
  const { toast } = useToast();

  const resetForm = () => {
    setMatchType("sni");
    setTunnelId("");
    setDomains("");
    setUpstreamPort("443");
    setProtocol("tcp");
    setListenPort("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!tunnelId) {
      toast({
        title: "Validation error",
        description: "Please select a tunnel.",
        variant: "destructive",
      });
      return;
    }

    const port = parseInt(upstreamPort, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      toast({
        title: "Validation error",
        description: "Upstream port must be between 1 and 65535.",
        variant: "destructive",
      });
      return;
    }

    if (matchType === "sni") {
      const domainList = domains
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean);

      if (domainList.length === 0) {
        toast({
          title: "Validation error",
          description: "At least one domain is required.",
          variant: "destructive",
        });
        return;
      }

      const fqdnRegex = /^[a-zA-Z0-9*][a-zA-Z0-9\-.*]{0,252}[a-zA-Z0-9]$/;
      for (const d of domainList) {
        if (!fqdnRegex.test(d)) {
          toast({
            title: "Validation error",
            description: `Invalid domain: "${d}". Must be a valid FQDN.`,
            variant: "destructive",
          });
          return;
        }
      }

      createRoute.mutate(
        {
          tunnelId,
          matchType: "sni",
          matchValue: domainList,
          upstreamPort: port,
        },
        {
          onSuccess: () => {
            resetForm();
            setOpen(false);
          },
        }
      );
    } else {
      // port_forward
      const lPort = parseInt(listenPort, 10);
      if (isNaN(lPort) || lPort < 1 || lPort > 65535) {
        toast({
          title: "Validation error",
          description: "Listen port must be between 1 and 65535.",
          variant: "destructive",
        });
        return;
      }

      createRoute.mutate(
        {
          tunnelId,
          matchType: "port_forward",
          matchValue: [],
          upstreamPort: port,
          protocol,
          listenPort: lPort,
        },
        {
          onSuccess: () => {
            resetForm();
            setOpen(false);
          },
        }
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Route
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add L4 Route</DialogTitle>
          <DialogDescription>
            Create a forwarding route to a WireGuard tunnel.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Route Type</Label>
            <Select
              value={matchType}
              onValueChange={(v) => setMatchType(v as L4MatchType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sni">SNI (Domain-based)</SelectItem>
                <SelectItem value="port_forward">
                  Port Forward (Game servers)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Tunnel</Label>
            {tunnelsLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Select value={tunnelId} onValueChange={setTunnelId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a tunnel" />
                </SelectTrigger>
                <SelectContent>
                  {tunnels?.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.id} ({t.vpnIp})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {matchType === "sni" ? (
            <div className="space-y-2">
              <Label htmlFor="route-domains">Domains (comma-separated)</Label>
              <Input
                id="route-domains"
                placeholder="app.example.com, api.example.com"
                value={domains}
                onChange={(e) => setDomains(e.target.value)}
              />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Protocol</Label>
                <Select
                  value={protocol}
                  onValueChange={(v) => setProtocol(v as L4Protocol)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tcp">TCP</SelectItem>
                    <SelectItem value="udp">UDP</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="route-listen-port">Listen Port</Label>
                <Input
                  id="route-listen-port"
                  type="number"
                  min={1}
                  max={65535}
                  placeholder="e.g. 25565"
                  value={listenPort}
                  onChange={(e) => setListenPort(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  The port the VPS listens on for incoming traffic.
                </p>
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="route-port">Upstream Port</Label>
            <Input
              id="route-port"
              type="number"
              min={1}
              max={65535}
              value={upstreamPort}
              onChange={(e) => setUpstreamPort(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The port on your machine that receives the forwarded traffic.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createRoute.isPending}>
              {createRoute.isPending ? (
                <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : null}
              Add Route
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
