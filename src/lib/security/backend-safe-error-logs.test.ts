// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('@prisma/client', () => ({
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {},
    PrismaClientValidationError: class PrismaClientValidationError extends Error {},
    PrismaClientInitializationError: class PrismaClientInitializationError extends Error {},
  },
}));

import { Prisma } from '@prisma/client';
import { AppError } from '../../../interpreters-api/src/lib/AppError';
import { globalErrorHandler } from '../../../interpreters-api/src/middlewares/errorHandler';
import {
  formatSafeApiErrorLog,
  safeConflictFieldNames,
} from '../../../interpreters-api/src/lib/safe-error-log';

const secret = 'SYNTHETIC_PRIVATE_TOKEN';
const request = {
  method: 'GET',
  originalUrl: '/api/v1/users?token=SYNTHETIC_PRIVATE_TOKEN',
  url: '/api/v1/users?password=SYNTHETIC_PRIVATE_TOKEN',
};

function responseMock() {
  const response = {
    headersSent: false,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return response;
}

describe('Express backend never logs secret-bearing exception data', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('emits allowlisted HTTP method/category/status only, without URL or token', () => {
    const event = formatSafeApiErrorLog(
      'Bearer SYNTHETIC_PRIVATE_TOKEN',
      'APP_ERROR SYNTHETIC_PRIVATE_TOKEN',
      400,
    );
    const parsed = JSON.parse(event);
    expect(parsed).toMatchObject({
      category: 'UNCLASSIFIED_ERROR', method: 'OTHER', statusCode: 400,
    });
    expect(JSON.stringify(parsed)).not.toContain(secret);
    expect(Object.keys(parsed).sort()).toEqual(
      ['category', 'method', 'statusCode', 'timestamp'].sort(),
    );
  });

  it('masks messages from non-operational 5xx AppError responses and logs', () => {
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = responseMock();
    const error = AppError.internal('postgresql://admin:SYNTHETIC_PRIVATE_TOKEN@db.internal/app');
    error.name = 'Bearer SYNTHETIC_PRIVATE_TOKEN';
    globalErrorHandler(error, request as never, res as never, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { type: 'SERVER_ERROR', message: 'Internal Server Error' },
    });
    expect(logs).toHaveBeenCalledOnce();
    expect(JSON.stringify(logs.mock.calls)).not.toMatch(/SYNTHETIC_PRIVATE_TOKEN|db\.internal/);
    expect(JSON.parse(String(logs.mock.calls[0][0]))).toMatchObject({
      category: 'APPLICATION_ERROR', method: 'GET', statusCode: 500,
    });
  });

  it('also hides messages on 503 AppError incorrectly marked operational', () => {
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = responseMock();
    globalErrorHandler(
      new AppError('Bearer SYNTHETIC_PRIVATE_TOKEN', 503, true),
      request as never, res as never, vi.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { type: 'SERVER_ERROR', message: 'Internal Server Error' },
    });
    expect(JSON.stringify(logs.mock.calls)).not.toContain(secret);
  });

  it('retains reviewed operational 4xx text, but not request query parameters', () => {
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = responseMock();
    globalErrorHandler(AppError.conflict('Already exists'), request as never, res as never, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { type: 'APPLICATION_ERROR', message: 'Already exists' },
    });
    expect(JSON.stringify(logs.mock.calls)).not.toContain(secret);
  });

  it('handles arbitrary and null failures generically without stringifying them', () => {
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = responseMock();
    const failure = new Error('postgresql://admin:SYNTHETIC_PRIVATE_TOKEN@private-db');
    failure.name = 'SYNTHETIC_PRIVATE_TOKEN';
    globalErrorHandler(failure, request as never, res as never, vi.fn());
    globalErrorHandler(null, request as never, res as never, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(logs.mock.calls)).not.toContain(secret);
    expect(logs).toHaveBeenCalledTimes(2);
  });

  it('filters hostile Prisma conflict targets before returning them', () => {
    expect(safeConflictFieldNames([
      'email', 'postgresql://user:SYNTHETIC_PRIVATE_TOKEN@db.invalid',
      { field: secret }, 'account_id',
    ])).toEqual(['email', 'account_id']);
    expect(safeConflictFieldNames(secret)).toEqual([]);

    const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = responseMock();
    const ErrorClass = Prisma.PrismaClientKnownRequestError as unknown as new (message: string) => Error;
    const error = Object.assign(
      new ErrorClass('postgresql://admin:SYNTHETIC_PRIVATE_TOKEN@db.invalid'),
      { code: 'P2002', meta: { target: ['email', 'Bearer SYNTHETIC_PRIVATE_TOKEN'] } },
    );
    globalErrorHandler(error, request as never, res as never, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(logs.mock.calls)).not.toContain(secret);
  });

  it('does not log process stacks, exception names, query strings or raw messages', () => {
    const source = readFileSync('interpreters-api/src/server.ts', 'utf8');
    const prisma = readFileSync('interpreters-api/src/lib/prisma.ts', 'utf8');
    expect(source).not.toContain('err.stack');
    expect(source).not.toContain('reason.stack');
    expect(source).not.toContain('reason instanceof Error ? reason.stack');
    expect(source).not.toContain("Server failed to start:', err");
    expect(prisma).not.toContain('err instanceof Error ? err.name');
    expect(prisma).toContain('log: [],');
    expect(prisma).not.toContain("['query', 'info', 'warn', 'error']");
  });
});
