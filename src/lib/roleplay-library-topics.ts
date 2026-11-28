/** Editorial navigation hints, inferred from existing scenario titles only.
 * Not persisted classifications, and never derived from private transcripts.
 */
export const ROLEPLAY_TOPICS = [
  { id: 'medical', label: 'Medicina', subtopics: [
    { id: 'consultation', label: 'Consultas', words: ['consulta médica', 'consulta medica', 'medical consultation', 'medical appointment', 'doctor appointment', 'cita médica', 'cita medica'] },
    { id: 'emergency', label: 'Emergencias médicas', words: ['emergencia médica', 'emergencia medica', 'emergency room', 'medical emergency', 'urgencias'] },
    { id: 'pharmacy', label: 'Farmacia', words: ['farmacia', 'pharmacy', 'prescripción', 'prescription', 'medicamentos'] },
    { id: 'pediatrics', label: 'Pediatría', words: ['pediatría', 'pediatrics', 'pediatric'] },
  ] },
  { id: 'insurance', label: 'Seguros', subtopics: [
    { id: 'coverage', label: 'Cobertura', words: ['cobertura de seguro', 'insurance coverage', 'health insurance', 'seguro médico', 'seguro medico'] },
    { id: 'claims', label: 'Reclamaciones', words: ['insurance claim', 'reclamación de seguro', 'reclamo de seguro'] },
  ] },
  { id: 'finance', label: 'Finanzas', subtopics: [
    { id: 'banking', label: 'Banca', words: ['banca', 'bank account', 'cuenta bancaria', 'banking'] },
    { id: 'credit', label: 'Crédito y préstamos', words: ['préstamo', 'loan', 'credit card', 'tarjeta de crédito'] },
  ] },
  { id: 'legal', label: 'Servicios legales', subtopics: [
    { id: 'immigration', label: 'Inmigración', words: ['inmigración', 'immigration', 'asilo', 'asylum'] },
    { id: 'legal-consultation', label: 'Consultas legales', words: ['consulta legal', 'legal consultation', 'abogado', 'attorney'] },
  ] },
  { id: 'customer-service', label: 'Atención al cliente', subtopics: [
    { id: 'billing', label: 'Facturación', words: ['facturación', 'billing', 'factura', 'invoice'] },
    { id: 'support', label: 'Soporte', words: ['soporte técnico', 'technical support', 'customer support'] },
  ] },
  { id: 'utilities', label: 'Servicios públicos', subtopics: [
    { id: 'electricity', label: 'Electricidad', words: ['electricidad', 'electricity', 'power outage', 'corte eléctrico'] },
    { id: 'water', label: 'Agua', words: ['servicio de agua', 'water service', 'water bill'] },
  ] },
  { id: 'education', label: 'Educación', subtopics: [
    { id: 'enrollment', label: 'Matrícula', words: ['matrícula escolar', 'school enrollment', 'student enrollment'] },
    { id: 'meetings', label: 'Reuniones escolares', words: ['reunión escolar', 'parent teacher', 'parent-teacher'] },
  ] },
  { id: 'social', label: 'Servicios sociales', subtopics: [
    { id: 'benefits', label: 'Beneficios', words: ['asistencia social', 'social services', 'food assistance', 'beneficios sociales'] },
    { id: 'housing', label: 'Vivienda', words: ['housing assistance', 'asistencia de vivienda', 'subsidio de vivienda'] },
  ] },
] as const;

export function normalizeRoleplayTopicText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

export function inferRoleplayTopics(titles: readonly string[]): { topic: string; subtopic: string }[] {
  const normalized = titles.map(title => ' ' + normalizeRoleplayTopicText(title) + ' ');
  return ROLEPLAY_TOPICS.flatMap(topic => topic.subtopics
    .filter(subtopic => subtopic.words.some(word => normalized.some(title =>
      title.includes(' ' + normalizeRoleplayTopicText(word) + ' '))))
    .map(subtopic => ({ topic: topic.id, subtopic: subtopic.id })));
}

export function parseRoleplayTopicFilters(topic: unknown, subtopic: unknown) {
  if (topic === 'unclassified') return { topic, subtopic: '' };
  const found = ROLEPLAY_TOPICS.find(item => item.id === topic);
  if (!found) return { topic: '', subtopic: '' };
  return { topic: found.id, subtopic: found.subtopics.some(item => item.id === subtopic) ? String(subtopic) : '' };
}

export function matchesRoleplayTopic(matches: readonly { topic: string; subtopic: string }[], topic: string, subtopic: string) {
  if (!topic) return true;
  if (topic === 'unclassified') return matches.length === 0;
  return matches.some(match => match.topic === topic && (!subtopic || match.subtopic === subtopic));
}

/** Explicit editorial choice. Unlike search filters, invalid combinations
 * are rejected rather than silently reduced to a parent category. */
export function parseEditorialRoleplayTopic(topic: unknown, subtopic: unknown): { topic: string; subtopic: string } | null {
  const found = ROLEPLAY_TOPICS.find(item => item.id === topic);
  if (!found || typeof subtopic !== 'string' || !found.subtopics.some(item => item.id === subtopic)) return null;
  return { topic: found.id, subtopic };
}

export function resolveRoleplayTopics(titles: readonly string[], editorial: { topic: string; subtopic: string } | null | undefined) {
  const selected = editorial && parseEditorialRoleplayTopic(editorial.topic, editorial.subtopic);
  return selected ? [selected] : inferRoleplayTopics(titles);
}

/** Search only public-to-admin catalog titles, fingerprint and resolved topic labels.
 * Keep malformed or repeated query parameters from crashing the library. */
export function parseRoleplayLibrarySearch(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 100) : '';
}

/** Higher scores are stronger matches; zero excludes the template.
 * Only existing title and resolved category metadata participate. */
export function scoreRoleplayLibrarySearch(
  titles: readonly string[], fingerprint: string,
  topics: readonly { topic: string; subtopic: string }[], query: string,
): number {
  if (!query) return 1;
  if (/^[a-f0-9]+$/i.test(query) && fingerprint.startsWith(query.toLowerCase())) return 5;
  const normalized = normalizeRoleplayTopicText(query);
  if (!normalized) return 0;
  const normalizedTitles = titles.map(normalizeRoleplayTopicText);
  const categories = topics.flatMap(selection => {
    const topic = ROLEPLAY_TOPICS.find(item => item.id === selection.topic);
    const child = topic?.subtopics.find(item => item.id === selection.subtopic);
    return topic && child ? [{
      label: normalizeRoleplayTopicText(topic.label + ' ' + child.label),
      aliases: [topic.id, child.id, ...child.words].map(normalizeRoleplayTopicText),
    }] : [];
  });
  if (normalizedTitles.some(title => title.includes(normalized))) return 4;
  if (categories.some(category => category.label.includes(normalized))) return 3;
  const terms = [...new Set(normalized.split(' '))];
  const includesAllTerms = (fields: readonly string[]) => {
    const words = new Set(fields.flatMap(field => field.split(' ')));
    return terms.every(term => words.has(term) ||
      (term.length >= 3 && [...words].some(word => word.startsWith(term))));
  };
  if (includesAllTerms(normalizedTitles)) return 2;
  return includesAllTerms([
    ...normalizedTitles, ...categories.flatMap(category => [category.label, ...category.aliases]),
  ]) ? 1 : 0;
}

export function matchesRoleplayLibrarySearch(
  titles: readonly string[], fingerprint: string,
  topics: readonly { topic: string; subtopic: string }[], query: string,
): boolean {
  return scoreRoleplayLibrarySearch(titles, fingerprint, topics, query) > 0;
}

/** Counts describe the existing snapshot, not audio length or response time. */
export const ROLEPLAY_LIBRARY_SIZE_OPTIONS = [
  { id: '', label: 'Cualquier cantidad', min: 1, max: 25 },
  { id: 'single', label: '1 escenario', min: 1, max: 1 },
  { id: 'short', label: '2–5 escenarios', min: 2, max: 5 },
  { id: 'medium', label: '6–15 escenarios', min: 6, max: 15 },
  { id: 'long', label: '16–25 escenarios', min: 16, max: 25 },
] as const;

export function parseRoleplayLibrarySize(value: unknown) {
  return ROLEPLAY_LIBRARY_SIZE_OPTIONS.find(option => option.id === value)?.id ?? '';
}

export function matchesRoleplayLibrarySize(count: number, size: ReturnType<typeof parseRoleplayLibrarySize>) {
  if (!size) return true;
  const option = ROLEPLAY_LIBRARY_SIZE_OPTIONS.find(item => item.id === size);
  return Boolean(option && Number.isInteger(count) && count >= option.min && count <= option.max);
}
