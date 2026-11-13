/**
 * Optional editorial prompts for consecutive interpreting practice.
 * They are original generic instructions, not transcripts or model answers.
 *
 * Publication is explicit: only when an administrator inserts a template
 * into scriptPrompt will it reach a candidate/interpreter in the existing
 * RoleplayScenario "Ver guión" display.
 */
export type StudioProtocolKind = 'opening' | 'repetition' | 'closing';
export type StudioProtocolLanguage = 'en' | 'es';

export const STUDIO_PROTOCOLS: Readonly<Record<
  StudioProtocolKind, Readonly<Record<StudioProtocolLanguage, string>>
>> = {
  opening: {
    en: 'Opening protocol (practice): Introduce your role as the interpreter, explain that each person should speak in short turns, and confirm that you will interpret faithfully. Do not add clinical information.',
    es: 'Protocolo de apertura (práctica): Presenta tu función como intérprete, solicita intervenciones breves y explica que interpretarás fielmente lo expresado. No añadas información clínica.',
  },
  repetition: {
    en: 'Repetition protocol (practice): If you did not clearly hear a message, politely request that the speaker repeat the full relevant phrase before interpreting. Never guess, omit or invent information.',
    es: 'Protocolo de repetición (práctica): Si no escuchaste claramente un mensaje, solicita de manera respetuosa que repitan la frase completa antes de interpretar. No adivines, omitas ni inventes información.',
  },
  closing: {
    en: 'Closing protocol (practice): Check whether there is anything else to interpret, conclude the interaction clearly and professionally, and avoid offering independent medical advice.',
    es: 'Protocolo de cierre (práctica): Comprueba si queda algo por interpretar, finaliza la comunicación de manera clara y profesional, y evita dar consejos médicos por cuenta propia.',
  },
};

export const STUDIO_PROTOCOL_PROMPT_LIMIT = 5000;

export function addStudioProtocol(
  existingPrompt: string, kind: StudioProtocolKind, language: StudioProtocolLanguage,
): { text: string; added: boolean } {
  if (!(kind in STUDIO_PROTOCOLS) || !(language in STUDIO_PROTOCOLS[kind])) {
    throw new Error('El protocolo o idioma seleccionado no está disponible.');
  }
  if (typeof existingPrompt !== 'string') throw new Error('Las instrucciones no son válidas.');
  const template = STUDIO_PROTOCOLS[kind][language];
  if (existingPrompt.includes(template)) return { text: existingPrompt, added: false };
  const text = existingPrompt.trim()
    ? `${existingPrompt.trimEnd()}\n\n${template}`
    : template;
  if (text.length > STUDIO_PROTOCOL_PROMPT_LIMIT) {
    throw new Error('El protocolo supera el límite de instrucciones de 5000 caracteres.');
  }
  return { text, added: true };
}
