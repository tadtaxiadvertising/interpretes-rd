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
