'use server';

import prismaClient from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { validateAction } from '@/lib/auth/actions';

const prisma = prismaClient;

// 1. Añadir Incentivos y Penalidades (useActionState compatible)
export async function updatePayrollAdjustments(prevState: any, formData: FormData) {
  const authorization = await validateAction('admin');
  if ('error' in authorization) {
    return { success: false, error: authorization.error };
  }

  try {
    const id = formData.get('id') as string;
    const incentives = parseFloat(formData.get('incentives') as string) || 0;
    const penalties = parseFloat(formData.get('penalties') as string) || 0;

    if (!id) return { success: false, error: 'ID de nómina requerido' };

    await prisma.$transaction(async (tx) => {
      const record = await tx.payrollRecord.findUnique({ where: { id } });
      if (!record) throw new Error('Registro no encontrado');
      if (record.status === 'Paid' || record.status === 'PAID') throw new Error('Nómina ya pagada, no se puede alterar');

      const netTotal = Number(record.grossTotal) + Number(record.qualityBonus) + incentives - penalties - Number(record.transferDeduction);

      await tx.payrollRecord.update({
        where: { id },
        data: {
          incentivesTotal: incentives,
          penalidades: penalties,
          netTotal: netTotal > 0 ? netTotal : 0
        }
      });
    });

    revalidatePath('/payroll');
    return { success: true, message: 'Ajustes aplicados correctamente' };
  } catch (error: any) {
    console.error('❌ ERROR updatePayrollAdjustments:', error);
    return { success: false, error: error.message || 'Error transaccional al actualizar ajustes' };
  }
}

// 2. Verificar Minutos y recalcular grossTotal
export async function verifyPayrollMinutes(prevState: any, formData: FormData) {
  const authorization = await validateAction('admin');
  if ('error' in authorization) {
    return { success: false, error: authorization.error };
  }

  try {
    const id = formData.get('id') as string;
    const verifiedMinutes = parseInt(formData.get('verifiedMinutes') as string) || 0;

    if (!id || verifiedMinutes <= 0) return { success: false, error: 'Minutos inválidos o nulos' };

    await prisma.$transaction(async (tx) => {
      const record = await tx.payrollRecord.findUnique({ 
        where: { id },
        include: { interpreter: true }
      });
      
      if (!record || !record.interpreter) throw new Error('Nómina o Intérprete no encontrado');
      if (record.status === 'Paid' || record.status === 'PAID') throw new Error('Nómina ya pagada');

      const tariff = Number(record.interpreter.tariffPerMinute);
      const grossTotal = verifiedMinutes * tariff;
      const netTotal = grossTotal + Number(record.qualityBonus) + Number(record.incentivesTotal) - Number(record.penalidades) - Number(record.transferDeduction);

      await tx.payrollRecord.update({
        where: { id },
        data: {
          verifiedMinutes,
          grossTotal,
          netTotal: netTotal > 0 ? netTotal : 0,
          status: 'Approved' // Cambio de estado Automático
        }
      });
    });

    revalidatePath('/payroll');
    return { success: true, message: 'Minutos verificados y nómina Aprobada' };
  } catch (error: any) {
    console.error('❌ ERROR verifyPayrollMinutes:', error);
    return { success: false, error: error.message || 'Error transaccional al verificar minutos' };
  }
}

// 3. Flujo Transaccional PATCH -> PAID
export async function markPayrollAsPaid(prevState: any, formData: FormData) {
  const authorization = await validateAction('admin');
  if ('error' in authorization) {
    return { success: false, error: authorization.error };
  }

  try {
    const id = formData.get('id') as string;
    const transactionRef = formData.get('transactionReference') as string;

    if (!id || !transactionRef) return { success: false, error: 'La referencia de transacción es obligatoria' };

    await prisma.$transaction(async (tx) => {
      const record = await tx.payrollRecord.findUnique({
        where: { id },
        include: { interpreter: true }
      });
      
      if (!record) throw new Error('Registro no encontrado');
      if (record.status === 'Paid' || record.status === 'PAID') throw new Error('Ya se encuentra pagada');
      if (record.status !== 'Approved') throw new Error('La nómina debe estar Aprobada antes de pagar');

      // Extraer y registrar método de pago para propósitos de auditoría en la transacción
      const paymentMethod = record.interpreter?.metodoPago || 'Unknown';
      const cleanRef = transactionRef.trim().replace(/[^a-zA-Z0-9]/g, '').substring(0, 10);
      const hash = `PAY-${id.substring(0,5)}-${paymentMethod.substring(0,3).toUpperCase()}-${cleanRef}`;

      await tx.payrollRecord.update({
        where: { id },
        data: {
          status: 'Paid',
          paidAt: new Date(),
          paymentDate: new Date(),
          transactionReference: transactionRef,
          reconciliationHash: hash
        }
      });
    });

    revalidatePath('/payroll');
    return { success: true, message: 'Nómina marcada como PAGADA con éxito' };
  } catch (error: any) {
    console.error('❌ ERROR markPayrollAsPaid:', error);
    return { success: false, error: error.message || 'Error transaccional crítico al procesar pago' };
  }
}
