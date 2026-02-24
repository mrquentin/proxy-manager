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
import {
  useFirewallRules,
  useDeleteFirewallRule,
} from "@/lib/queries/firewall";

interface FirewallRuleListProps {
  vpsId: string;
}

export function FirewallRuleList({ vpsId }: FirewallRuleListProps) {
  const { data: rules, isLoading } = useFirewallRules(vpsId);
  const deleteRule = useDeleteFirewallRule(vpsId);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (!rules || rules.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-muted-foreground">
          No dynamic firewall rules configured.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>ID</TableHead>
          <TableHead>Port</TableHead>
          <TableHead>Protocol</TableHead>
          <TableHead>Direction</TableHead>
          <TableHead>Source CIDR</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="w-[60px]">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rules.map((rule) => (
          <TableRow key={rule.id}>
            <TableCell className="font-mono text-xs">{rule.id}</TableCell>
            <TableCell className="font-mono">{rule.port}</TableCell>
            <TableCell>
              <Badge variant="outline">{rule.proto.toUpperCase()}</Badge>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{rule.direction.toUpperCase()}</Badge>
            </TableCell>
            <TableCell className="font-mono text-xs">
              {rule.sourceCidr}
            </TableCell>
            <TableCell>
              {rule.action === "allow" ? (
                <Badge variant="success">Allow</Badge>
              ) : (
                <Badge variant="destructive">Deny</Badge>
              )}
            </TableCell>
            <TableCell>
              {rule.enabled ? (
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
                  if (confirm(`Delete firewall rule ${rule.id}?`)) {
                    deleteRule.mutate(rule.id);
                  }
                }}
                disabled={deleteRule.isPending}
                title="Delete rule"
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
