"use server";
import { requireRole } from "@/lib/auth-rbac";
import prisma from "@/lib/prisma";
import { z } from "zod";
const AccountSchema = z.object({ platformName: z.string(), credentials: z.string() });
const MessageSchema = z.object({ content: z.string() });

export async function uploadAccount(data: z.infer<typeof AccountSchema>) {
  const user = await requireRole("HOLDER");
  
  const parsed = AccountSchema.parse(data);
  return prisma.vaultAccount.create({ 
    data: { ...parsed, holderId: user.id } 
  });
}

export async function sendMessage(data: z.infer<typeof MessageSchema>) {
  const user = await requireRole("HOLDER");
  
  const parsed = MessageSchema.parse(data);
  return prisma.vaultMessage.create({ 
    data: { ...parsed, authorId: user.id } 
  });
}
