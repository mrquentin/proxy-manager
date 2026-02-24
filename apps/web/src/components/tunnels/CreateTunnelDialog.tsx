import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useCreateTunnel } from "@/lib/queries/tunnels";
import { useToast } from "@/hooks/use-toast";
import { TunnelConfigDisplay } from "./TunnelConfigDisplay";
import type { CreateTunnelResponseFlowA } from "@proxy-manager/shared";

interface CreateTunnelDialogProps {
  vpsId: string;
}

export function CreateTunnelDialog({ vpsId }: CreateTunnelDialogProps) {
  const [open, setOpen] = useState(false);
  const [useOwnKeys, setUseOwnKeys] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [domains, setDomains] = useState("");
  const [upstreamPort, setUpstreamPort] = useState("443");
  const [createdConfig, setCreatedConfig] = useState<CreateTunnelResponseFlowA | null>(null);
  const createTunnel = useCreateTunnel(vpsId);
  const { toast } = useToast();

  const resetForm = () => {
    setUseOwnKeys(false);
    setPublicKey("");
    setDomains("");
    setUpstreamPort("443");
    setCreatedConfig(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (useOwnKeys && !publicKey.trim()) {
      toast({
        title: "Validation error",
        description: "Public key is required when using your own keys.",
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

    const domainList = domains
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);

    createTunnel.mutate(
      {
        publicKey: useOwnKeys ? publicKey.trim() : undefined,
        domains: domainList.length > 0 ? domainList : undefined,
        upstreamPort: port,
      },
      {
        onSuccess: (result) => {
          const data = result.data;
          if ("config" in data) {
            setCreatedConfig(data as CreateTunnelResponseFlowA);
          } else {
            setOpen(false);
            resetForm();
          }
        },
      }
    );
  };

  const handleClose = () => {
    resetForm();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else setOpen(true); }}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Create Tunnel
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {createdConfig ? "Tunnel Created" : "Create WireGuard Tunnel"}
          </DialogTitle>
          <DialogDescription>
            {createdConfig
              ? "Save the configuration below. The private key will not be shown again."
              : "Create a new WireGuard tunnel on this VPS."}
          </DialogDescription>
        </DialogHeader>

        {createdConfig ? (
          <div className="space-y-4">
            <TunnelConfigDisplay
              config={createdConfig.config}
              qrCodeUrl={createdConfig.qrCodeUrl}
            />
            <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
              {createdConfig.warning}
            </p>
            <DialogFooter>
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label className="text-sm font-medium">
                  I have my own keys
                </Label>
                <p className="text-xs text-muted-foreground">
                  Provide your own WireGuard public key
                </p>
              </div>
              <Switch
                checked={useOwnKeys}
                onCheckedChange={setUseOwnKeys}
              />
            </div>

            {useOwnKeys && (
              <div className="space-y-2">
                <Label htmlFor="tunnel-pubkey">Public Key</Label>
                <Input
                  id="tunnel-pubkey"
                  placeholder="WireGuard public key (base64)"
                  value={publicKey}
                  onChange={(e) => setPublicKey(e.target.value)}
                  className="font-mono"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="tunnel-domains">Domains (comma-separated)</Label>
              <Input
                id="tunnel-domains"
                placeholder="app.example.com, api.example.com"
                value={domains}
                onChange={(e) => setDomains(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tunnel-port">Upstream Port</Label>
              <Input
                id="tunnel-port"
                type="number"
                min={1}
                max={65535}
                placeholder="443"
                value={upstreamPort}
                onChange={(e) => setUpstreamPort(e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createTunnel.isPending}>
                {createTunnel.isPending ? (
                  <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : null}
                Create Tunnel
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
