import { Building2, ChevronDown, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useActiveOrganization, useListOrganizations, organization } from "@/lib/auth-client";
import { useToast } from "@/hooks/use-toast";

export function OrgSwitcher() {
  const { data: activeOrg } = useActiveOrganization();
  const { data: orgList } = useListOrganizations();
  const { toast } = useToast();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgSlug, setNewOrgSlug] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleSwitchOrg = async (orgId: string) => {
    try {
      await organization.setActive({ organizationId: orgId });
      window.location.reload();
    } catch (err) {
      toast({
        title: "Failed to switch organization",
        description: err instanceof Error ? err.message : "An error occurred.",
        variant: "destructive",
      });
    }
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName.trim()) {
      toast({
        title: "Validation error",
        description: "Organization name is required.",
        variant: "destructive",
      });
      return;
    }

    const slug =
      newOrgSlug.trim() ||
      newOrgName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

    setIsCreating(true);
    try {
      await organization.create({ name: newOrgName.trim(), slug });
      toast({
        title: "Organization created",
        description: `"${newOrgName.trim()}" has been created.`,
        variant: "success",
      });
      setCreateDialogOpen(false);
      setNewOrgName("");
      setNewOrgSlug("");
      window.location.reload();
    } catch (err) {
      toast({
        title: "Failed to create organization",
        description: err instanceof Error ? err.message : "An error occurred.",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const organizations = orgList ?? [];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="gap-2">
            <Building2 className="h-4 w-4" />
            <span className="max-w-[150px] truncate">
              {activeOrg?.name ?? "Select Organization"}
            </span>
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Organizations</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {organizations.map((org) => (
            <DropdownMenuItem
              key={org.id}
              onClick={() => handleSwitchOrg(org.id)}
              className={activeOrg?.id === org.id ? "bg-accent" : ""}
            >
              <Building2 className="mr-2 h-4 w-4" />
              <span className="truncate">{org.name}</span>
            </DropdownMenuItem>
          ))}
          {organizations.length === 0 && (
            <DropdownMenuItem disabled>
              No organizations found
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreateDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Organization
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Organization</DialogTitle>
            <DialogDescription>
              Create a new organization to manage VPS instances.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateOrg} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="org-name">Name</Label>
              <Input
                id="org-name"
                placeholder="My Organization"
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-slug">Slug (optional)</Label>
              <Input
                id="org-slug"
                placeholder="my-organization"
                value={newOrgSlug}
                onChange={(e) => setNewOrgSlug(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                URL-friendly identifier. Auto-generated from name if left empty.
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isCreating}>
                {isCreating ? (
                  <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : null}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
