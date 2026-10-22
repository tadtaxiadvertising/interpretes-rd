import React from 'react';
import { Mic2, Loader2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import prisma from '@/lib/prisma';
import NewRoleplayForm from './NewRoleplayForm';

// Data is read straight from Prisma instead of self-fetching the REST API:
// server components must not rely on internal HTTP calls (no cookie
// forwarding, and `/api/interpreters` / `/api/recruitment/candidates` do
// not exist — only the `/api/v1/*` routes do).
async function getInterpreters() {
  try {
    return await prisma.interpreter.findMany({
      where: { status: { in: ['Activo', 'Training', 'Probation'] } },
      select: { id: true, name: true, externalId: true, emailCorporativo: true, status: true },
      orderBy: { name: 'asc' },
      take: 500,
    });
  } catch {
    return [];
  }
}

async function getCandidates() {
  try {
    return await prisma.recruitmentCandidate.findMany({
      where: { applications: { some: { status: 'APPLIED' } } },
      select: { id: true, name: true, email: true },
      orderBy: { fechaPostulacion: 'desc' },
      take: 500,
    });
  } catch {
    return [];
  }
}

export default async function NewRoleplayPage() {
  const [interpreters, candidates] = await Promise.all([getInterpreters(), getCandidates()]);
  
  return (
    <div className="min-h-screen bg-slate-950 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link 
            href="/admin/roleplays"
            className="p-2 hover:bg-white/10 rounded-xl transition-colors text-gray-400 hover:text-white"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-white">Create Roleplay Session</h1>
            <p className="text-gray-400">Assign a base audio and select a participant</p>
          </div>
        </div>

        <NewRoleplayForm interpreters={interpreters} candidates={candidates} />
      </div>
    </div>
  );
}