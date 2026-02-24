import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useRotationPolicy,
  useUpdateRotationPolicy,
} from "@/lib/queries/tunnels";
import { useToast } from "@/hooks/use-toast";

interface RotationPolicyFormProps {
  vpsId: string;
  tunnelId: string;
}

export function RotationPolicyForm({
  vpsId,
  tunnelId,
}: RotationPolicyFormProps) {
  const { data: policy, isLoading } = useRotationPolicy(vpsId, tunnelId);
  const updatePolicy = useUpdateRotationPolicy(vpsId, tunnelId);
  const { toast } = useToast();

  const [autoRotatePsk, setAutoRotatePsk] = useState(false);
  const [pskInterval, setPskInterval] = useState("90");
  const [autoRevoke, setAutoRevoke] = useState(false);
  const [inactiveExpiry, setInactiveExpiry] = useState("90");
  const [gracePeriod, setGracePeriod] = useState("30");

  useEffect(() => {
    if (policy) {
      setAutoRotatePsk(policy.autoRotatePsk);
      setPskInterval(policy.pskRotationIntervalDays.toString());
      setAutoRevoke(policy.autoRevokeInactive);
      setInactiveExpiry(policy.inactiveExpiryDays.toString());
      setGracePeriod(policy.gracePeriodMinutes.toString());
    }
  }, [policy]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const pskDays = parseInt(pskInterval, 10);
    const expiryDays = parseInt(inactiveExpiry, 10);
    const grace = parseInt(gracePeriod, 10);

    if (autoRotatePsk && (isNaN(pskDays) || pskDays < 1)) {
      toast({
        title: "Validation error",
        description: "PSK rotation interval must be at least 1 day.",
        variant: "destructive",
      });
      return;
    }
    if (autoRevoke && (isNaN(expiryDays) || expiryDays < 1)) {
      toast({
        title: "Validation error",
        description: "Inactive expiry must be at least 1 day.",
        variant: "destructive",
      });
      return;
    }
    if (isNaN(grace) || grace < 1) {
      toast({
        title: "Validation error",
        description: "Grace period must be at least 1 minute.",
        variant: "destructive",
      });
      return;
    }

    updatePolicy.mutate({
      autoRotatePsk,
      pskRotationIntervalDays: pskDays,
      autoRevokeInactive: autoRevoke,
      inactiveExpiryDays: expiryDays,
      gracePeriodMinutes: grace,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center justify-between rounded-md border p-3">
        <div>
          <Label className="text-sm font-medium">Auto-rotate PSK</Label>
          <p className="text-xs text-muted-foreground">
            Automatically rotate pre-shared keys on a schedule. Causes tunnel
            downtime until the user re-imports config.
          </p>
        </div>
        <Switch checked={autoRotatePsk} onCheckedChange={setAutoRotatePsk} />
      </div>

      {autoRotatePsk && (
        <div className="space-y-2 pl-4">
          <Label htmlFor="psk-interval">Rotation interval (days)</Label>
          <Input
            id="psk-interval"
            type="number"
            min={1}
            value={pskInterval}
            onChange={(e) => setPskInterval(e.target.value)}
          />
        </div>
      )}

      <div className="flex items-center justify-between rounded-md border p-3">
        <div>
          <Label className="text-sm font-medium">Auto-revoke inactive</Label>
          <p className="text-xs text-muted-foreground">
            Automatically delete peers that have not had a successful handshake
            within the expiry period.
          </p>
        </div>
        <Switch checked={autoRevoke} onCheckedChange={setAutoRevoke} />
      </div>

      {autoRevoke && (
        <div className="space-y-2 pl-4">
          <Label htmlFor="inactive-expiry">Inactive expiry (days)</Label>
          <Input
            id="inactive-expiry"
            type="number"
            min={1}
            value={inactiveExpiry}
            onChange={(e) => setInactiveExpiry(e.target.value)}
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="grace-period">Grace period (minutes)</Label>
        <p className="text-xs text-muted-foreground">
          After rotation, the old config remains valid for this duration.
        </p>
        <Input
          id="grace-period"
          type="number"
          min={1}
          value={gracePeriod}
          onChange={(e) => setGracePeriod(e.target.value)}
        />
      </div>

      {policy?.lastRotationAt && (
        <p className="text-xs text-muted-foreground">
          Last rotation: {new Date(policy.lastRotationAt).toLocaleString()}
        </p>
      )}
      {policy?.nextRotationAt && (
        <p className="text-xs text-muted-foreground">
          Next rotation: {new Date(policy.nextRotationAt).toLocaleString()}
        </p>
      )}

      <Button type="submit" disabled={updatePolicy.isPending}>
        {updatePolicy.isPending ? (
          <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : null}
        Save Policy
      </Button>
    </form>
  );
}
