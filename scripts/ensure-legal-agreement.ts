import 'dotenv/config';
import { createHash } from 'node:crypto';
import { getPrisma } from '../src/lib/prisma';

/**
 * SCRIPT: Asegurar que existe un acuerdo legal publicado vigente.
 *
 * El onboarding requiere un `LegalAgreementVersion` con status 'PUBLISHED'
 * para poder cargar el acuerdo y permitir que el usuario acepte los términos.
 * Si no existe ninguno, este script crea uno publicado con el mismo contenido
 * y hash que la migración 20261025_versioned_legal_agreements.
 *
 * Idempotente: si ya existe un acuerdo publicado, no hace nada.
 *
 * Ejecutar contra producción (Easypanel):
 *   DATABASE_URL=... DIRECT_URL=... npx tsx scripts/ensure-legal-agreement.ts
 *
 * Opcionalmente establecer LEGAL_AGREEMENT_CONTENT para usar contenido
 * personalizado; de lo contrario se usa el contenido embebido de la migración.
 */

const AGREEMENT_KEY = 'freelance-services';
const DEFAULT_VERSION = '2026-10-01';
const DEFAULT_TITLE = 'Contrato de Prestación de Servicios Profesionales (Freelance)';

// Contenido embebido idéntico al de la migración 20261025_versioned_legal_agreements.
const DEFAULT_CONTENT = `# Contrato de Prestación de Servicios Profesionales (Freelance)

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

Al continuar, usted acepta todos los términos y condiciones establecidos en este documento.`;

// Hash esperado según la migración (SHA-256 del contenido embebido).
const EXPECTED_HASH =
  '07e91899698bcba9de71fa1a8f7ddb43c0f95ccd0f9c98fe243354c1a27d79c4';

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

async function main(): Promise<void> {
  const prisma = getPrisma();

  const content = process.env.LEGAL_AGREEMENT_CONTENT ?? DEFAULT_CONTENT;
  const contentHash = hashContent(content);

  // Verificar que el contenido embebido coincide con el hash de la migración.
  if (!process.env.LEGAL_AGREEMENT_CONTENT && contentHash !== EXPECTED_HASH) {
    throw new Error(
      `Content hash mismatch: calculated ${contentHash}, expected ${EXPECTED_HASH}. ` +
        'The embedded content may have been altered. Do not publish without review.'
    );
  }

  // 1. Buscar si ya existe un acuerdo publicado para esta clave.
  const published = await prisma.legalAgreementVersion.findFirst({
    where: {
      agreementKey: AGREEMENT_KEY,
      status: 'PUBLISHED',
      publishedAt: { not: null },
    },
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, version: true, title: true, contentHash: true, publishedAt: true },
  });

  if (published) {
    console.log(
      `✅ Acuerdo legal ya publicado: id=${published.id} version=${published.version} publishedAt=${published.publishedAt}`
    );
    if (published.contentHash !== contentHash) {
      console.warn(
        `⚠️  Advertencia: el acuerdo publicado tiene contentHash ${published.contentHash} pero el contenido actual tiene hash ${contentHash}. ` +
          'Si el contenido cambió, publique una nueva versión en lugar de modificar este.'
      );
    }
    await prisma.\$disconnect();
    return;
  }

  // 2. No hay acuerdo publicado. Verificar si existe un borrador con la misma versión.
  const existingDraft = await prisma.legalAgreementVersion.findFirst({
    where: {
      agreementKey: AGREEMENT_KEY,
      version: DEFAULT_VERSION,
    },
    select: { id: true, status: true },
  });

  if (existingDraft) {
    // Publicar el borrador existente (compare-and-set por status).
    const result = await prisma.legalAgreementVersion.updateMany({
      where: {
        id: existingDraft.id,
        agreementKey: AGREEMENT_KEY,
        status: 'DRAFT',
        contentHash,
      },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        publishedBy: 'system:ensure-legal-agreement',
      },
    });
    if (result.count === 0) {
      throw new Error(
        `No se pudo publicar el borrador ${existingDraft.id}: ya no está en estado DRAFT o el contentHash cambió. Revise manualmente.`
      );
    }
    console.log(
      `✅ Borrador publicado como acuerdo vigente: id=${existingDraft.id} version=${DEFAULT_VERSION}`
    );
  } else {
    // 3. Crear un nuevo acuerdo publicado directamente.
    const created = await prisma.legalAgreementVersion.create({
      data: {
        agreementKey: AGREEMENT_KEY,
        version: DEFAULT_VERSION,
        title: DEFAULT_TITLE,
        content,
        contentHash,
        status: 'PUBLISHED',
        createdBy: 'system:ensure-legal-agreement',
        publishedBy: 'system:ensure-legal-agreement',
        publishedAt: new Date(),
      },
      select: { id: true, version: true, status: true, publishedAt: true },
    });
    console.log(
      `✅ Acuerdo legal creado y publicado: id=${created.id} version=${created.version} status=${created.status}`
    );
  }

  await prisma.\$disconnect();
}

main()
  .catch((error: unknown) => {
    console.error('❌ Error asegurando acuerdo legal:', error);
    process.exit(1);
  });
