"use server";

import { requireRole } from "@/lib/auth-rbac";
import prisma from "@/lib/prisma";
import { encryptPassword } from "@/lib/vault-crypto";
import { z } from "zod";

const optionalText = z.string().trim().max(5000).optional().transform(value => value || undefined);

const AccountUrlSchema = z.string().trim().max(2048).refine((value) => {
  if (value === "") return true;
  // z.string().url() accepts non-web schemes, including javascript:.
  // Only ordinary web portal links are safe to store and render as links.
  if (/[\\s\\u0000-\\u001f\\u007f]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}, "La dirección del portal debe ser HTTP(S) y no incluir credenciales.");

const AccountSchema = z.object({
  platformName: z.string().trim().min(1).max(120),
  credentials: z.string().min(1).max(10000),
  url: AccountUrlSchema.optional(),
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
