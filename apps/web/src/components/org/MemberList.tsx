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
import { Trash2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveOrganization, organization } from "@/lib/auth-client";
import { useToast } from "@/hooks/use-toast";
import type { Role } from "@proxy-manager/shared";

const roleVariant: Record<Role, "default" | "secondary" | "outline"> = {
  admin: "default",
  operator: "secondary",
  viewer: "outline",
};

export function MemberList() {
  const { data: activeOrg, isPending } = useActiveOrganization();
  const { toast } = useToast();

  const handleRemoveMember = async (memberId: string) => {
    if (!confirm("Remove this member from the organization?")) return;
    try {
      await organization.removeMember({ memberIdOrEmail: memberId });
      toast({
        title: "Member removed",
        description: "Member has been removed from the organization.",
        variant: "success",
      });
      window.location.reload();
    } catch (err) {
      toast({
        title: "Failed to remove member",
        description: err instanceof Error ? err.message : "An error occurred.",
        variant: "destructive",
      });
    }
  };

  if (isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const members = activeOrg?.members ?? [];

  if (members.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-muted-foreground">
          No members in this organization.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User ID</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Joined</TableHead>
          <TableHead className="w-[60px]">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          <TableRow key={member.id}>
            <TableCell className="font-mono text-xs">
              {member.userId}
            </TableCell>
            <TableCell>
              <Badge variant={roleVariant[member.role as Role] ?? "outline"}>
                {member.role}
              </Badge>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {new Date(member.createdAt).toLocaleDateString()}
            </TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleRemoveMember(member.id)}
                title="Remove member"
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
