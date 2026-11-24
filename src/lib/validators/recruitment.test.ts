import { describe, expect, it } from 'vitest';
import { ApplicantSchema, DOMINICAN_PROVINCES } from './recruitment';

const applicant = {
  name: 'Ana Perez',
  email: 'ana@example.com',
  phone: '+18095551234',
  country: 'Santiago',
  englishLevel: 'C1',
  speedtestMbps: 100,
  efsetLink: 'https://www.efset.org/cert/example',
};

describe('application province and connection speed', () => {
  it('lists exactly 31 provinces and the Distrito Nacional without duplicates', () => {
    expect(DOMINICAN_PROVINCES).toHaveLength(32);
    expect(new Set(DOMINICAN_PROVINCES).size).toBe(32);
    expect(DOMINICAN_PROVINCES).toContain('Distrito Nacional');
    for (const country of DOMINICAN_PROVINCES) {
      expect(ApplicantSchema.safeParse({ ...applicant, country }).success).toBe(true);
    }
  });

  it.each(['', 'República Dominicana', 'Not a province'])('rejects invalid province %s', (country) => {
    expect(ApplicantSchema.safeParse({ ...applicant, country }).success).toBe(false);
  });

  it.each([undefined, 0, -1, 1.5, 10001, NaN, '100'])('rejects invalid speed %s', (speedtestMbps) => {
    expect(ApplicantSchema.safeParse({ ...applicant, speedtestMbps }).success).toBe(false);
  });

  it.each([1, 100, 10000])('accepts integer speed %s Mbps', (speedtestMbps) => {
    expect(ApplicantSchema.parse({ ...applicant, speedtestMbps }).speedtestMbps).toBe(speedtestMbps);
  });
});
