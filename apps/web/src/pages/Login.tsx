import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { KeyRound, Github, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { signIn } from "@/lib/auth-client";

export function Login() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);

  const handlePasskeyLogin = async () => {
    setLoadingProvider("passkey");
    try {
      const result = await signIn.passkey();
      if (result?.error) {
        toast({
          title: "Passkey login failed",
          description: result.error.message ?? "Unable to authenticate with passkey.",
          variant: "destructive",
        });
      } else {
        navigate("/");
      }
    } catch (err) {
      toast({
        title: "Passkey login failed",
        description: err instanceof Error ? err.message : "Unable to authenticate with passkey.",
        variant: "destructive",
      });
    } finally {
      setLoadingProvider(null);
    }
  };

  const handleOAuthLogin = async (provider: "github" | "google") => {
    setLoadingProvider(provider);
    try {
      await signIn.social({ provider, callbackURL: "/" });
    } catch (err) {
      toast({
        title: "Login failed",
        description: err instanceof Error ? err.message : `Unable to sign in with ${provider}.`,
        variant: "destructive",
      });
      setLoadingProvider(null);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      toast({
        title: "Validation error",
        description: "Email is required.",
        variant: "destructive",
      });
      return;
    }
    if (!password) {
      toast({
        title: "Validation error",
        description: "Password is required.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const result = await signIn.email({ email, password });
      if (result?.error) {
        toast({
          title: "Login failed",
          description: result.error.message ?? "Invalid email or password.",
          variant: "destructive",
        });
      } else {
        navigate("/");
      }
    } catch (err) {
      toast({
        title: "Login failed",
        description: err instanceof Error ? err.message : "Invalid email or password.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold">Sign in</h2>
        <p className="text-sm text-muted-foreground">
          Choose your preferred sign-in method
        </p>
      </div>

      <Button
        variant="outline"
        className="w-full"
        onClick={handlePasskeyLogin}
        disabled={loadingProvider !== null}
      >
        {loadingProvider === "passkey" ? (
          <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <KeyRound className="mr-2 h-4 w-4" />
        )}
        Sign in with Passkey
      </Button>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <Separator />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">or</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="outline"
          onClick={() => handleOAuthLogin("github")}
          disabled={loadingProvider !== null}
        >
          {loadingProvider === "github" ? (
            <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <Github className="mr-2 h-4 w-4" />
          )}
          GitHub
        </Button>
        <Button
          variant="outline"
          onClick={() => handleOAuthLogin("google")}
          disabled={loadingProvider !== null}
        >
          {loadingProvider === "google" ? (
            <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <Mail className="mr-2 h-4 w-4" />
          )}
          Google
        </Button>
      </div>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <Separator />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">or</span>
        </div>
      </div>

      <form onSubmit={handleEmailLogin} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            disabled={isLoading}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={isLoading}
          />
        </div>
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? (
            <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : null}
          Sign in
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link
          to="/signup"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Sign up
        </Link>
      </p>
    </div>
  );
}
