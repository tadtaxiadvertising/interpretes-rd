import 'dotenv/config';
import { createHash } from 'node:crypto';
import { getPrisma } from '../src/lib/prisma';

const AGREEMENT_KEY = 'freelance-services';
const VERSION_PATTERN = /^[a-zA-Z0-9._-]{1,40}$/;

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable obligatoria ${name}; no se publicará ningún acuerdo.`);
  return value;
}

async function main(): Promise<void> {
  const prisma = getPrisma();

  try {
    const published = await prisma.legalAgreementVersion.findFirst({
      where: {
        agreementKey: AGREEMENT_KEY,
        status: 'PUBLISHED',
        publishedAt: { not: null },
      },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, version: true, title: true, content: true, contentHash: true, publishedAt: true },
    });

    if (published) {
      const actualHash = hashContent(published.content);
      if (actualHash !== published.contentHash) {
        throw new Error(
          `El acuerdo publicado ${published.id} no supera la verificación SHA-256. No se modificó ningún registro.`,
        );
      }
      console.log(
        `Acuerdo publicado verificado: version=${published.version}, hash=${published.contentHash}, publishedAt=${published.publishedAt?.toISOString() ?? 'desconocido'}`,
      );
      return;
    }

    // Fail closed: never publish the historical placeholder contract implicitly.
    if (process.env.LEGAL_AGREEMENT_ALLOW_PUBLISH !== 'true') {
      throw new Error(
        'No existe un acuerdo publicado. Este script no publica por defecto. Para una publicación aprobada, use el panel administrativo o habilite explícitamente el procedimiento de emergencia.',
      );
    }

    const content = requiredEnv('LEGAL_AGREEMENT_CONTENT');
    const version = requiredEnv('LEGAL_AGREEMENT_VERSION');
    const title = requiredEnv('LEGAL_AGREEMENT_TITLE');
    const approvedBy = requiredEnv('LEGAL_AGREEMENT_APPROVED_BY');
    const approvalReference = requiredEnv('LEGAL_AGREEMENT_APPROVAL_REFERENCE');

    if (process.env.LEGAL_AGREEMENT_APPROVED !== 'true') {
      throw new Error('LEGAL_AGREEMENT_APPROVED=true es obligatorio; no se publicará ningún acuerdo.');
    }
    if (!VERSION_PATTERN.test(version)) {
      throw new Error('LEGAL_AGREEMENT_VERSION no cumple el formato permitido.');
    }
    if (title.length < 3 || title.length > 180) {
      throw new Error('LEGAL_AGREEMENT_TITLE debe tener entre 3 y 180 caracteres.');
    }
    if (content.length < 100 || content.length > 100000) {
      throw new Error('LEGAL_AGREEMENT_CONTENT debe tener entre 100 y 100000 caracteres.');
    }
    if (approvedBy.length > 180 || approvalReference.length > 300) {
      throw new Error('Los datos de trazabilidad de aprobación exceden el límite permitido.');
    }

    const contentHash = hashContent(content);
    const existingVersion = await prisma.legalAgreementVersion.findFirst({
      where: { agreementKey: AGREEMENT_KEY, version },
      select: { id: true, status: true, contentHash: true },
    });

    if (existingVersion) {
      if (existingVersion.status !== 'DRAFT') {
        throw new Error(
          `La versión ${version} ya existe con estado ${existingVersion.status}; no se alterará ni republicará.`,
        );
      }
      if (existingVersion.contentHash !== contentHash) {
        throw new Error(
          `El borrador ${version} no coincide con el contenido aprobado (SHA-256). Edítelo y verifíquelo en el panel administrativo antes de publicar.`,
        );
      }

      const result = await prisma.legalAgreementVersion.updateMany({
        where: {
          id: existingVersion.id,
          agreementKey: AGREEMENT_KEY,
          version,
          status: 'DRAFT',
          contentHash,
        },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          publishedBy: approvedBy,
        },
      });
      if (result.count !== 1) {
        throw new Error('El borrador cambió durante la operación; no se publicó. Vuelva a revisar el estado.');
      }
      console.log(
        `Borrador aprobado publicado: version=${version}, hash=${contentHash}, referencia=${approvalReference}`,
      );
      return;
    }

    await prisma.legalAgreementVersion.create({
      data: {
        agreementKey: AGREEMENT_KEY,
        version,
        title,
        content,
        contentHash,
        status: 'PUBLISHED',
        createdBy: approvedBy,
        publishedBy: approvedBy,
        publishedAt: new Date(),
      },
    });
    console.log(
      `Acuerdo aprobado creado y publicado: version=${version}, hash=${contentHash}, referencia=${approvalReference}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Error en la verificación/publicación del acuerdo legal:', error);
  process.exitCode = 1;
});
