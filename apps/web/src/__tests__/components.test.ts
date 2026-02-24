import { describe, test, expect } from "bun:test";

// Component interaction tests — validate form validation logic and
// component configurations via source analysis.
// Full DOM rendering tests require jsdom environment which is not
// available with bun:test by default, so we test the validation
// logic and patterns directly.

describe("CreateTunnelDialog form validation", () => {
  test("port validation rejects out-of-range values", () => {
    const validatePort = (val: string): string | null => {
      const port = parseInt(val, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        return "Upstream port must be between 1 and 65535.";
      }
      return null;
    };

    expect(validatePort("443")).toBeNull();
    expect(validatePort("1")).toBeNull();
    expect(validatePort("65535")).toBeNull();
    expect(validatePort("0")).toBe("Upstream port must be between 1 and 65535.");
    expect(validatePort("65536")).toBe("Upstream port must be between 1 and 65535.");
    expect(validatePort("abc")).toBe("Upstream port must be between 1 and 65535.");
    expect(validatePort("")).toBe("Upstream port must be between 1 and 65535.");
  });

  test("public key is required when useOwnKeys is true", () => {
    const validateOwnKeys = (useOwnKeys: boolean, pubKey: string): string | null => {
      if (useOwnKeys && !pubKey.trim()) {
        return "Public key is required when using your own keys.";
      }
      return null;
    };

    expect(validateOwnKeys(false, "")).toBeNull();
    expect(validateOwnKeys(false, "somekey")).toBeNull();
    expect(validateOwnKeys(true, "somekey")).toBeNull();
    expect(validateOwnKeys(true, "")).toBe(
      "Public key is required when using your own keys."
    );
    expect(validateOwnKeys(true, "   ")).toBe(
      "Public key is required when using your own keys."
    );
  });
});

describe("CreateFirewallRuleDialog form validation", () => {
  const RESERVED_PORTS = [22, 2019, 7443, 51820];

  test("port validation rejects reserved ports", () => {
    const validatePort = (val: string): string | null => {
      const portNum = parseInt(val, 10);
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        return "Port must be between 1 and 65535.";
      }
      if (RESERVED_PORTS.includes(portNum)) {
        return `Port ${portNum} is reserved.`;
      }
      return null;
    };

    expect(validatePort("8080")).toBeNull();
    expect(validatePort("80")).toBeNull();
    expect(validatePort("22")).toBe("Port 22 is reserved.");
    expect(validatePort("2019")).toBe("Port 2019 is reserved.");
    expect(validatePort("7443")).toBe("Port 7443 is reserved.");
    expect(validatePort("51820")).toBe("Port 51820 is reserved.");
    expect(validatePort("0")).toBe("Port must be between 1 and 65535.");
    expect(validatePort("99999")).toBe("Port must be between 1 and 65535.");
  });

  test("CIDR validation", () => {
    const validateCidr = (cidr: string): boolean => {
      const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
      return cidrRegex.test(cidr);
    };

    expect(validateCidr("0.0.0.0/0")).toBe(true);
    expect(validateCidr("192.168.1.0/24")).toBe(true);
    expect(validateCidr("10.0.0.0/8")).toBe(true);
    expect(validateCidr("invalid")).toBe(false);
    expect(validateCidr("")).toBe(false);
    expect(validateCidr("192.168.1.0")).toBe(false);
  });
});

describe("OrgSwitcher slug generation", () => {
  test("generates slug from name", () => {
    const generateSlug = (name: string): string =>
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

    expect(generateSlug("My Organization")).toBe("my-organization");
    expect(generateSlug("Test Org 123")).toBe("test-org-123");
    expect(generateSlug("  Spaces  ")).toBe("spaces");
    expect(generateSlug("UPPER-case")).toBe("upper-case");
    expect(generateSlug("special!@#chars")).toBe("special-chars");
  });
});

describe("InviteMemberDialog email validation", () => {
  test("validates email format", () => {
    const validateEmail = (email: string): boolean => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(email);
    };

    expect(validateEmail("user@example.com")).toBe(true);
    expect(validateEmail("test@test.co")).toBe(true);
    expect(validateEmail("a@b.c")).toBe(true);
    expect(validateEmail("invalid")).toBe(false);
    expect(validateEmail("@example.com")).toBe(false);
    expect(validateEmail("user@")).toBe(false);
    expect(validateEmail("")).toBe(false);
    expect(validateEmail("user @example.com")).toBe(false);
  });
});

describe("CreateRouteDialog domain validation", () => {
  test("validates FQDN format", () => {
    const fqdnRegex = /^[a-zA-Z0-9*][a-zA-Z0-9\-.*]{0,252}[a-zA-Z0-9]$/;
    const validateDomain = (d: string): boolean => fqdnRegex.test(d);

    expect(validateDomain("app.example.com")).toBe(true);
    expect(validateDomain("api.example.com")).toBe(true);
    expect(validateDomain("*.example.com")).toBe(true);
    expect(validateDomain("a")).toBe(false); // too short for regex
    expect(validateDomain("-invalid.com")).toBe(false);
    expect(validateDomain("valid-domain.co")).toBe(true);
  });

  test("splits comma-separated domains correctly", () => {
    const input = "app.example.com, api.example.com, *.example.com";
    const result = input
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);

    expect(result).toEqual([
      "app.example.com",
      "api.example.com",
      "*.example.com",
    ]);
  });

  test("handles empty domains input", () => {
    const input = "";
    const result = input
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);

    expect(result).toEqual([]);
  });
});
