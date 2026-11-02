-- Prevent direct access to legal contract and signature records through the public API.
-- The application accesses these tables through its privileged Prisma server connection.
ALTER TABLE public.legal_agreement_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_agreement_acceptances ENABLE ROW LEVEL SECURITY;
