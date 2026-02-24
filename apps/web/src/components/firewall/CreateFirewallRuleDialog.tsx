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
import { useCreateFirewallRule } from "@/lib/queries/firewall";
import { useToast } from "@/hooks/use-toast";
import type { FirewallProtocol, FirewallAction } from "@proxy-manager/shared";

interface CreateFirewallRuleDialogProps {
  vpsId: string;
}

const RESERVED_PORTS = [22, 2019, 7443, 51820];

export function CreateFirewallRuleDialog({
  vpsId,
}: CreateFirewallRuleDialogProps) {
  const [open, setOpen] = useState(false);
  const [port, setPort] = useState("");
  const [proto, setProto] = useState<FirewallProtocol>("tcp");
  const [sourceCidr, setSourceCidr] = useState("0.0.0.0/0");
  const [action, setAction] = useState<FirewallAction>("allow");
  const createRule = useCreateFirewallRule(vpsId);
  const { toast } = useToast();

  const resetForm = () => {
    setPort("");
    setProto("tcp");
    setSourceCidr("0.0.0.0/0");
    setAction("allow");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      toast({
        title: "Validation error",
        description: "Port must be between 1 and 65535.",
        variant: "destructive",
      });
      return;
    }

    if (RESERVED_PORTS.includes(portNum)) {
      toast({
        title: "Validation error",
        description: `Port ${portNum} is reserved and cannot be managed via the API.`,
        variant: "destructive",
      });
      return;
    }

    const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
    if (!cidrRegex.test(sourceCidr)) {
      toast({
        title: "Validation error",
        description: "Source CIDR must be a valid IPv4 CIDR (e.g., 0.0.0.0/0).",
        variant: "destructive",
      });
      return;
    }

    createRule.mutate(
      {
        port: portNum,
        proto,
        sourceCidr,
        action,
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
          Add Rule
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Firewall Rule</DialogTitle>
          <DialogDescription>
            Add a dynamic firewall rule to the nftables chain on this VPS.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fw-port">Port</Label>
            <Input
              id="fw-port"
              type="number"
              min={1}
              max={65535}
              placeholder="8080"
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Reserved ports (22, 2019, 7443, 51820) are not allowed.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Protocol</Label>
            <Select
              value={proto}
              onValueChange={(v) => setProto(v as FirewallProtocol)}
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
            <Label htmlFor="fw-cidr">Source CIDR</Label>
            <Input
              id="fw-cidr"
              placeholder="0.0.0.0/0"
              value={sourceCidr}
              onChange={(e) => setSourceCidr(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Action</Label>
            <Select
              value={action}
              onValueChange={(v) => setAction(v as FirewallAction)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="allow">Allow</SelectItem>
                <SelectItem value="deny">Deny</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createRule.isPending}>
              {createRule.isPending ? (
                <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : null}
              Add Rule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
