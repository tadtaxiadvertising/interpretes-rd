import { getLegalAgreementAdminData } from '@/app/actions/legal-agreements';
import LegalAgreementManager from '@/components/admin/LegalAgreementManager';

export const dynamic = 'force-dynamic';

export default async function LegalAgreementsPage() {
  const result = await getLegalAgreementAdminData();
  return (
    <LegalAgreementManager
      initialData={result.success ? result.data : null}
      initialError={result.success ? undefined : result.error}
    />
  );
}
