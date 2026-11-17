"use server";

import { requireRole } from "@/lib/auth-rbac";
import prisma from "@/lib/prisma";
import { encryptPassword } from "@/lib/vault-crypto";
import { z } from "zod";

const optionalText = z.string().trim().max(5000).optional().transform(value => value || undefined);

const AccountSchema = z.object({
  platformName: z.string().trim().min(1).max(120),
  credentials: z.string().min(1).max(10000),
  // Zod's generic .url() accepts javascript:/ftp:/data: schemes. These
  // values may be rendered as login links in holder/interpreter interfaces;
  // store HTTPS destinations only, without credentials embedded in the URL.
  url: z.string().max(2048).refine((rawValue) => {
    // Validate the ORIGINAL input before normalizing. URL parsers may silently
    // discard tabs and newlines, changing the destination that users see.
    const value = rawValue.replace(/^ +| +$/g, "");
    if (!value) return true; // Optional portal: stored as null.
    if (!/^https:\/\//i.test(value) || /[\u0000-\u0020\u007f]/u.test(value)) {
      return false;
    }
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" && Boolean(parsed.hostname) &&
        !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  }, { message: "Portal URL must be HTTPS without control characters or embedded credentials" })
    .transform((value) => value.replace(/^ +| +$/g, "")).optional(),
  // VPN providers and profiles are intentionally free-form: no vendor or slot
  // is hard-coded. Existing records remain compatible with this text field.
  vpnConfig: z.string().max(10000).optional(),
  notes: optionalText,
});

const MessageSchema = z.object({
  content: z.string().trim().min(1).max(5000),
});

export async function uploadAccount(data: z.infer<typeof AccountSchema>) {
  const user = await requireRole("HOLDER");
  const parsed = AccountSchema.parse(data);

  // Encrypt credentials at the trust boundary and never return the secret
  // payload to the client after creating the record.
  return prisma.vaultAccount.create({
    data: {
      platformName: parsed.platformName,
      credentials: encryptPassword(parsed.credentials),
      url: parsed.url || null,
      vpnConfig: parsed.vpnConfig?.trim() || null,
      notes: parsed.notes ?? null,
      holderId: user.id,
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
}

export async function sendMessage(data: z.infer<typeof MessageSchema>) {
  const user = await requireRole("HOLDER");
  const parsed = MessageSchema.parse(data);

  return prisma.vaultMessage.create({
    data: { ...parsed, authorId: user.id },
  });
}
