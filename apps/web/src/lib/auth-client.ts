import { createAuthClient } from "better-auth/react";
import { passkeyClient } from "@better-auth/passkey/client";
import { organizationClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: import.meta.env.PROD ? (import.meta.env.VITE_API_URL ?? "") : "",
  plugins: [
    passkeyClient(),
    organizationClient(),
  ],
});

export const {
  useSession,
  signIn,
  signUp,
  signOut,
  useActiveOrganization,
  useListOrganizations,
  organization,
  passkey,
} = authClient;
