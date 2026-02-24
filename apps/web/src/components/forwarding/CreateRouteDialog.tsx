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

interface CreateRouteDialogProps {
  vpsId: string;
}

export function CreateRouteDialog({ vpsId }: CreateRouteDialogProps) {
  const [open, setOpen] = useState(false);
  const [tunnelId, setTunnelId] = useState("");
  const [domains, setDomains] = useState("");
  const [upstreamPort, setUpstreamPort] = useState("443");
  const createRoute = useCreateRoute(vpsId);
  const { data: tunnels, isLoading: tunnelsLoading } = useTunnels(vpsId);
  const { toast } = useToast();

  const resetForm = () => {
    setTunnelId("");
    setDomains("");
    setUpstreamPort("443");
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

    const port = parseInt(upstreamPort, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      toast({
        title: "Validation error",
        description: "Upstream port must be between 1 and 65535.",
        variant: "destructive",
      });
      return;
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
            Create a new SNI-based forwarding route to a WireGuard tunnel.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
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

          <div className="space-y-2">
            <Label htmlFor="route-domains">Domains (comma-separated)</Label>
            <Input
              id="route-domains"
              placeholder="app.example.com, api.example.com"
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
            />
          </div>

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
