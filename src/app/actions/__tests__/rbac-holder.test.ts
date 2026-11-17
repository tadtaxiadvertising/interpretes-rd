// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-rbac", () => ({
  requireRole: vi.fn().mockResolvedValue({ id: "holder-1" }),
}));

vi.mock("@/lib/vault-crypto", () => ({
  encryptPassword: vi.fn((value: string) => `encrypted:${value}`),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    vaultAccount: { create: vi.fn() },
    vaultMessage: { create: vi.fn() },
  },
}));

import { requireRole } from "@/lib/auth-rbac";
import { encryptPassword } from "@/lib/vault-crypto";
import prisma from "@/lib/prisma";
import { uploadAccount, sendMessage } from "../rbac-holder";

describe("RBAC holder vault actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue({ id: "holder-1" } as never);
    vi.mocked(prisma.vaultAccount.create).mockResolvedValue({
      id: "account-1",
      platformName: "WordSynk",
      url: "https://example.test/login",
      vpnConfig: "Provider: custom\nProfile: 2",
      notes: null,
      holderId: "holder-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(prisma.vaultMessage.create).mockResolvedValue({ id: "message-1" } as never);
  });

  it("requires HOLDER role and encrypts account credentials before persistence", async () => {
    const result = await uploadAccount({
      platformName: " WordSynk ",
      credentials: "portal-secret",
      url: "https://example.test/login",
      vpnConfig: "Provider: custom\nProfile: 2",
    });

    expect(requireRole).toHaveBeenCalledWith("HOLDER");
    expect(encryptPassword).toHaveBeenCalledWith("portal-secret");
    expect(prisma.vaultAccount.create).toHaveBeenCalledWith({
      data: {
        platformName: "WordSynk",
        credentials: "encrypted:portal-secret",
        url: "https://example.test/login",
        vpnConfig: "Provider: custom\nProfile: 2",
        notes: null,
        holderId: "holder-1",
      },
      select: {
        id: true,
        platformName: true,
        url: true,
        vpnConfig: true,
        notes: true,
        holderId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(result).not.toHaveProperty("credentials");
  });

  it("accepts an account without a VPN provider or slot", async () => {
    await uploadAccount({ platformName: "Portal", credentials: "secret" });

    expect(prisma.vaultAccount.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ vpnConfig: null, url: null }),
    }));
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "file:///etc/passwd",
    "ftp://example.test/login",
    "https://user:password@example.test/login",
    "https://example.test/line\nnext",
    "https://",
  ])("rejects unsafe portal link %s before persisting credentials", async (url) => {
    await expect(uploadAccount({
      platformName: "Portal",
      credentials: "secret",
      url,
    })).rejects.toThrow();

    expect(prisma.vaultAccount.create).not.toHaveBeenCalled();
    expect(encryptPassword).not.toHaveBeenCalled();
  });

  it("still accepts an HTTP portal used within a VPN without a fixed provider or slot", async () => {
    await uploadAccount({
      platformName: "Portal interno",
      credentials: "secret",
      url: "http://vpn.internal.test/login",
      vpnConfig: "VPN provider: variable\nProfile: custom",
    });
    expect(prisma.vaultAccount.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        url: "http://vpn.internal.test/login",
        vpnConfig: "VPN provider: variable\nProfile: custom",
      }),
    }));
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,hello",
    "ftp://example.test/account",
    "http://example.test/login",
    "https://name:secret@example.test/login",
    "https://example.test:badport/login",
  ])("rejects unsafe portal URL %s before any persistence", async (url) => {
    await expect(uploadAccount({
      platformName: "Portal",
      credentials: "test-secret",
      url,
    })).rejects.toThrow();
    expect(prisma.vaultAccount.create).not.toHaveBeenCalled();
    expect(encryptPassword).not.toHaveBeenCalled();
  });

  it("normalizes a valid HTTPS portal URL without restricting VPN settings", async () => {
    await uploadAccount({
      platformName: "Portal",
      credentials: "test-secret",
      url: "  https://network.wordsynk.us/login  ",
      vpnConfig: "Provider: custom\\nProfile: preferred",
    });
    expect(prisma.vaultAccount.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        url: "https://network.wordsynk.us/login",
        vpnConfig: "Provider: custom\\nProfile: preferred",
      }),
    }));
  });

  it("validates messages and persists them for the authenticated holder", async () => {
    await sendMessage({ content: "  Please review this account  " });

    expect(prisma.vaultMessage.create).toHaveBeenCalledWith({
      data: { content: "Please review this account", authorId: "holder-1" },
    });
  });
});
