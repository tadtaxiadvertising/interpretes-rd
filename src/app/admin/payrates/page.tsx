import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { DollarSign, Layers } from 'lucide-react';
import { PayrateEditor } from '@/components/PayrateEditor';
import { AccountManager } from '@/components/AccountManager';
import { getCurrentUser } from '@/lib/auth/actions';
import { cn } from '@/lib/utils';
import React from 'react';

export const dynamic = 'force-dynamic';

export default async function PayratesPage(props: { searchParams: Promise<{ manageAccounts?: string }> }) {
  const userData = await getCurrentUser();
  if (!userData) redirect('/login');

  const profile = userData.profile;

  if (profile?.role?.toLowerCase() !== 'admin') redirect('/login');

  const accounts = await (prisma as any).account.findMany({
    orderBy: { name: 'asc' }
  });

  const interpreters = await (prisma as any).interpreter.findMany({
    select: {
      id: true,
      name: true,
      externalId: true,
      tariffPerMinute: true,
      campaign: true,
      status: true,
      accountRates: {
        select: {
          accountId: true,
          tariffPerHour: true,
        }
      }
    },
    orderBy: { name: 'asc' }
  });

  const searchParams = await props.searchParams;
  const showManageAccounts = searchParams.manageAccounts === 'true';

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <DollarSign size={28} className="text-purple-400" />
            <h2 className="text-3xl font-bold text-white">Payrate Management</h2>
          </div>
          <p className="text-gray-400">Update interpreter tariffs. All changes are audited and take effect on the next call.</p>
        </div>
        
        <a 
          href={showManageAccounts ? '/admin/payrates' : '/admin/payrates?manageAccounts=true'}
          className={cn(
            "flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all border",
            showManageAccounts 
              ? "bg-white/10 border-white/20 text-white" 
              : "bg-purple-600/20 border-purple-500/30 text-purple-400 hover:bg-purple-600/30"
          )}
        >
          <Layers size={18} />
          {showManageAccounts ? 'Ver Tarifas' : 'Gestionar Cuentas'}
        </a>
      </header>

      {showManageAccounts ? (
        <AccountManager initialAccounts={accounts as any} />
      ) : (
        <div className="glass rounded-3xl p-8">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-white/5">
                  <th className="pb-3 px-2">Interpreter</th>
                  <th className="pb-3 px-2">ID</th>
                  <th className="pb-3 px-2">Campaign</th>
                  <th className="pb-3 px-2">Status</th>
                  <th className="pb-3 px-2">Current Rate</th>
                  <th className="pb-3 px-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {interpreters.map((interp: any) => (
                  <PayrateEditor
                    key={interp.id}
                    interpreter={{
                      id: interp.id,
                      name: interp.name,
                      externalId: interp.externalId,
                      campaign: interp.campaign,
                      status: interp.status,
                      tariffPerMinute: Number(interp.tariffPerMinute),
                      accountRates: ((interp as any).accountRates || []).map((r: any) => ({
                        accountId: r.accountId,
                        tariffPerHour: Number(r.tariffPerHour)
                      }))
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
