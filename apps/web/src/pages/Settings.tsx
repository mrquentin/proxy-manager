import { useState } from "react";
import { KeyRound, Link2, Shield, Users, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MemberList } from "@/components/org/MemberList";
import { InviteMemberDialog } from "@/components/org/InviteMemberDialog";
import { useSession, passkey, signIn, useActiveOrganization } from "@/lib/auth-client";
import { useToast } from "@/hooks/use-toast";

export function Settings() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const { toast } = useToast();
  const [passkeyName, setPasskeyName] = useState("");
  const [isRegisteringPasskey, setIsRegisteringPasskey] = useState(false);
  const [isLinkingGithub, setIsLinkingGithub] = useState(false);
  const [isLinkingGoogle, setIsLinkingGoogle] = useState(false);

  const handleRegisterPasskey = async () => {
    if (!passkeyName.trim()) {
      toast({
        title: "Validation error",
        description: "Please give your passkey a name.",
        variant: "destructive",
      });
      return;
    }

    setIsRegisteringPasskey(true);
    try {
      const result = await passkey.addPasskey({ name: passkeyName.trim() });
      if (result?.error) {
        toast({
          title: "Passkey registration failed",
          description: result.error.message ?? "Unable to register passkey.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Passkey registered",
          description: `Passkey "${passkeyName.trim()}" has been registered.`,
          variant: "success",
        });
        setPasskeyName("");
      }
    } catch (err) {
      toast({
        title: "Passkey registration failed",
        description:
          err instanceof Error ? err.message : "Unable to register passkey.",
        variant: "destructive",
      });
    } finally {
      setIsRegisteringPasskey(false);
    }
  };

  const handleLinkOAuth = async (provider: "github" | "google") => {
    const setLoading = provider === "github" ? setIsLinkingGithub : setIsLinkingGoogle;
    setLoading(true);
    try {
      await signIn.social({ provider, callbackURL: "/settings" });
    } catch (err) {
      toast({
        title: `Failed to link ${provider}`,
        description: err instanceof Error ? err.message : "An error occurred.",
        variant: "destructive",
      });
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account, security, and organization
        </p>
      </div>

      <Tabs defaultValue="account" className="space-y-4">
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="organization">Organization</TabsTrigger>
        </TabsList>

        <TabsContent value="account" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Profile
              </CardTitle>
              <CardDescription>Your account information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <p className="text-sm">{session?.user?.name ?? "N/A"}</p>
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <p className="text-sm">{session?.user?.email ?? "N/A"}</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Email Verified</Label>
                <div>
                  {session?.user?.emailVerified ? (
                    <Badge variant="success">Verified</Badge>
                  ) : (
                    <Badge variant="warning">Not verified</Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link2 className="h-5 w-5" />
                Linked Accounts
              </CardTitle>
              <CardDescription>
                Connect your social accounts for easier sign-in
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">GitHub</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleLinkOAuth("github")}
                  disabled={isLinkingGithub}
                >
                  {isLinkingGithub ? (
                    <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Link
                </Button>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">Google</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleLinkOAuth("google")}
                  disabled={isLinkingGoogle}
                >
                  {isLinkingGoogle ? (
                    <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Link
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" />
                Passkeys
              </CardTitle>
              <CardDescription>
                Register WebAuthn passkeys for passwordless sign-in
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3">
                <div className="flex-1">
                  <Input
                    placeholder="Passkey name (e.g., MacBook Pro Touch ID)"
                    value={passkeyName}
                    onChange={(e) => setPasskeyName(e.target.value)}
                  />
                </div>
                <Button
                  onClick={handleRegisterPasskey}
                  disabled={isRegisteringPasskey}
                >
                  {isRegisteringPasskey ? (
                    <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <KeyRound className="mr-2 h-4 w-4" />
                  )}
                  Register Passkey
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Passkeys provide the most secure sign-in experience. Your
                browser will prompt you to use your device biometrics or
                security key.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="organization" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    {activeOrg?.name ?? "Organization"} Members
                  </CardTitle>
                  <CardDescription>
                    Manage members and their roles
                  </CardDescription>
                </div>
                <InviteMemberDialog />
              </div>
            </CardHeader>
            <CardContent>
              <MemberList />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Role Reference</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-3">
                  <Badge>Admin</Badge>
                  <span className="text-muted-foreground">
                    Full access: add/remove VPS, manage tunnels/routes/firewall,
                    invite members, org settings.
                  </span>
                </div>
                <Separator />
                <div className="flex items-start gap-3">
                  <Badge variant="secondary">Operator</Badge>
                  <span className="text-muted-foreground">
                    Manage tunnels, routes, and firewall rules. Cannot
                    add/remove VPS or manage members.
                  </span>
                </div>
                <Separator />
                <div className="flex items-start gap-3">
                  <Badge variant="outline">Viewer</Badge>
                  <span className="text-muted-foreground">
                    Read-only access to all resources.
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
