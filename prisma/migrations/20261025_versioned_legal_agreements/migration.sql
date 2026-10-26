-- Versioned legal agreements and append-only acceptance evidence.
CREATE TABLE public.legal_agreement_versions (
  id text PRIMARY KEY,
  agreement_key text NOT NULL,
  version text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  content_hash text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  created_by text,
  published_by text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_agreement_versions_key_version_key UNIQUE (agreement_key, version),
  CONSTRAINT legal_agreement_versions_status_check CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED'))
);
CREATE INDEX idx_legal_agreement_versions_published
  ON public.legal_agreement_versions (agreement_key, status, published_at DESC);

CREATE TABLE public.legal_agreement_acceptances (
  id text PRIMARY KEY,
  agreement_version_id text NOT NULL REFERENCES public.legal_agreement_versions(id) ON DELETE RESTRICT,
  user_id uuid,
  interpreter_id integer,
  signer_email text NOT NULL,
  content_hash text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'onboarding',
  user_agent text
);
CREATE INDEX idx_legal_acceptances_version_date
  ON public.legal_agreement_acceptances (agreement_version_id, accepted_at DESC);
CREATE INDEX idx_legal_acceptances_user_date
  ON public.legal_agreement_acceptances (user_id, accepted_at DESC);
CREATE INDEX idx_legal_acceptances_interpreter_date
  ON public.legal_agreement_acceptances (interpreter_id, accepted_at DESC);
CREATE UNIQUE INDEX legal_acceptance_user_version_unique
  ON public.legal_agreement_acceptances (agreement_version_id, user_id)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX legal_acceptance_interpreter_version_unique
  ON public.legal_agreement_acceptances (agreement_version_id, interpreter_id)
  WHERE interpreter_id IS NOT NULL;

-- Seed the existing embedded contract as a published snapshot; do not fabricate past signatures.
INSERT INTO public.legal_agreement_versions
  (id, agreement_key, version, title, content, content_hash, status, created_by, published_by, published_at)
VALUES
  ('legal-freelance-services-2026-10-01', 'freelance-services', '2026-10-01',
   'Contrato de Prestación de Servicios Profesionales (Freelance)',
   '# Contrato de Prestación de Servicios Profesionales (Freelance)

**ENTRE:**

De una parte, **FREE INTERPRETERS**, en adelante denominada "LA AGENCIA".

Y de la otra parte, **[SU NOMBRE]**, en adelante denominado "EL INTÉRPRETE".

**ACUERDAN LO SIGUIENTE:**

### 1. Objeto del Contrato
LA AGENCIA contrata a EL INTÉRPRETE para prestar servicios de interpretación remota (VRI/OPI) de manera independiente y autónoma.

### 2. Naturaleza de la Relación
Las partes reconocen que este es un contrato de servicios profesionales (freelance) y **NO** crea una relación laboral de dependencia, sociedad o asociación. EL INTÉRPRETE actúa como contratista independiente.

### 3. Obligaciones del Intérprete
- Prestar servicios de interpretación con los más altos estándares de calidad, precisión y ética profesional.
- Cumplir con los horarios y turnos acordados previamente.
- Contar con el equipo técnico necesario (computadora, headset, conexión a internet estable y entorno silencioso).
- Mantener la confidencialidad absoluta de toda la información tratada durante las sesiones de interpretación.
- Seguir los Procedimientos Operativos Estándar (SOPs) y políticas de LA AGENCIA.

### 4. Confidencialidad y Protección de Datos
EL INTÉRPRETE se compromete a no divulgar, copiar ni utilizar para fines propios o de terceros ninguna información confidencial de LA AGENCIA o de sus clientes finales (incluyendo información médica, legal o financiera), cumpliendo con las normativas HIPAA y otras leyes aplicables.

### 5. Honorarios y Forma de Pago
- **Tarifa:** Se pagará una tarifa según el esquema de producción acordado.
- **Plataformas:** Los pagos se procesarán según el SOP de Pagos vigente.
- **Frecuencia:** Los pagos se realizarán según la validación de los reportes de producción.

### 6. Vigencia y Terminación
Este contrato tiene una vigencia indefinida a partir de la fecha de firma. Cualquiera de las partes puede terminar este contrato con aviso previo por escrito. LA AGENCIA puede terminar el contrato inmediatamente en caso de incumplimiento grave.

### 7. Penalidades
El incumplimiento de los turnos asignados, problemas recurrentes de calidad o faltas al reglamento interno estarán sujetos a penalidades conforme al "Formato de Penalidades" y "SOP de Penalidades" de LA AGENCIA.

### 8. Ley Aplicable
Este contrato se rige por las leyes vigentes en la República Dominicana.

---

Al continuar, usted acepta todos los términos y condiciones establecidos en este documento.', '07e91899698bcba9de71fa1a8f7ddb43c0f95ccd0f9c98fe243354c1a27d79c4', 'PUBLISHED', 'system:migration', 'system:migration', now());
