import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useCreateVps } from "@/lib/queries/vps";
import { useToast } from "@/hooks/use-toast";

export function AddVpsDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [clientCert, setClientCert] = useState("");
  const [clientKey, setClientKey] = useState("");
  const [serverCa, setServerCa] = useState("");
  const createVps = useCreateVps();
  const { toast } = useToast();

  const resetForm = () => {
    setName("");
    setApiUrl("");
    setClientCert("");
    setClientKey("");
    setServerCa("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast({ title: "Validation error", description: "Name is required.", variant: "destructive" });
      return;
    }
    if (!apiUrl.trim()) {
      toast({ title: "Validation error", description: "API URL is required.", variant: "destructive" });
      return;
    }
    try {
      new URL(apiUrl);
    } catch {
      toast({ title: "Validation error", description: "API URL must be a valid URL.", variant: "destructive" });
      return;
    }
    if (!clientCert.trim()) {
      toast({ title: "Validation error", description: "Client certificate is required.", variant: "destructive" });
      return;
    }
    if (!clientKey.trim()) {
      toast({ title: "Validation error", description: "Client key is required.", variant: "destructive" });
      return;
    }
    if (!serverCa.trim()) {
      toast({ title: "Validation error", description: "Server CA is required.", variant: "destructive" });
      return;
    }

    createVps.mutate(
      { name: name.trim(), apiUrl: apiUrl.trim(), clientCert, clientKey, serverCa },
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
          Add VPS
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add VPS Instance</DialogTitle>
          <DialogDescription>
            Register a new VPS instance. You will need the mTLS certificates
            from the VPS control plane.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="vps-name">Name</Label>
            <Input
              id="vps-name"
              placeholder="EU-1 Frankfurt"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vps-api-url">API URL</Label>
            <Input
              id="vps-api-url"
              placeholder="https://203.0.113.1:7443"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vps-client-cert">Client Certificate (PEM)</Label>
            <textarea
              id="vps-client-cert"
              className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
              placeholder="-----BEGIN CERTIFICATE-----&#10;..."
              value={clientCert}
              onChange={(e) => setClientCert(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vps-client-key">Client Private Key (PEM)</Label>
            <textarea
              id="vps-client-key"
              className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
              placeholder="-----BEGIN PRIVATE KEY-----&#10;..."
              value={clientKey}
              onChange={(e) => setClientKey(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vps-server-ca">Server CA Certificate (PEM)</Label>
            <textarea
              id="vps-server-ca"
              className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
              placeholder="-----BEGIN CERTIFICATE-----&#10;..."
              value={serverCa}
              onChange={(e) => setServerCa(e.target.value)}
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
            <Button type="submit" disabled={createVps.isPending}>
              {createVps.isPending ? (
                <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : null}
              Add VPS
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
