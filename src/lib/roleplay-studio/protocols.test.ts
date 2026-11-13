import { describe, expect, it } from 'vitest';
import {
  STUDIO_PROTOCOLS, STUDIO_PROTOCOL_PROMPT_LIMIT, addStudioProtocol,
} from './protocols';

describe('Optional interpreting protocols for roleplay scripts', () => {
  it('provides distinct EN/ES practice instructions for all three protocols', () => {
    for (const kind of ['opening', 'repetition', 'closing'] as const) {
      const en = STUDIO_PROTOCOLS[kind].en;
      const es = STUDIO_PROTOCOLS[kind].es;
      expect(en.length).toBeGreaterThan(40);
      expect(es.length).toBeGreaterThan(40);
      expect(en).not.toBe(es);
      expect(en).not.toContain('John Doe');
      expect(es).not.toContain('Ana Pérez');
    }
  });

  it('adds selected instructions without changing existing editorial text or duplicating templates', () => {
    const original = 'Describe el contexto general del ejercicio.';
    const first = addStudioProtocol(original, 'repetition', 'es');
    expect(first.added).toBe(true);
    expect(first.text).toContain(original);
    expect(first.text).toContain('Protocolo de repetición (práctica)');
    const again = addStudioProtocol(first.text, 'repetition', 'es');
    expect(again).toEqual({ text: first.text, added: false });
    const closing = addStudioProtocol(first.text, 'closing', 'en');
    expect(closing.added).toBe(true);
    expect(closing.text).toContain('Closing protocol (practice)');
  });

  it('rejects invalid template keys, prototype lookups and overly long instructions', () => {
    expect(() => addStudioProtocol('test', '__proto__' as never, 'en')).toThrow();
    expect(() => addStudioProtocol('test', 'opening', 'toString' as never)).toThrow();
    expect(() => addStudioProtocol('x'.repeat(STUDIO_PROTOCOL_PROMPT_LIMIT - 5),
      'opening', 'en')).toThrow(/5000/);
    expect(() => addStudioProtocol('test', 'opening', 'es')).not.toThrow();
  });
});
