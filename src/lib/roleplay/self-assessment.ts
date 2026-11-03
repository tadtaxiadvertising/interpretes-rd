export const ROLEPLAY_SELF_ASSESSMENT_DIMENSIONS = [
  'protocol',
  'interpretation',
  'language',
  'service',
  'technical',
] as const;

/**
 * Legacy attempts may contain partial/obsolete score objects. A score is
 * complete only when every current rubric dimension has a numeric value.
 */
export function hasCompleteRoleplaySelfAssessment(score: unknown): boolean {
  if (!score || typeof score !== 'object' || Array.isArray(score)) return false;
  const values = score as Record<string, unknown>;
  return ROLEPLAY_SELF_ASSESSMENT_DIMENSIONS.every((key) => typeof values[key] === 'number');
}
