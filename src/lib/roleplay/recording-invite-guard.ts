/**
 * A candidate's session ownership cookie is not enough to authorize a NEW
 * recording if the invitation was never validated or has been consumed.
 *
 * This is an upload-specific guard: submitted candidates may still review
 * their existing recordings and complete historical self-assessments.
 */
export function candidateCanUploadRoleplayAudio(session: {
  recruitmentCandidateId: number | null;
  access?: { validatedAt: Date | null; usedAt: Date | null } | null;
}): boolean {
  return session.recruitmentCandidateId === null ||
    Boolean(session.access?.validatedAt && !session.access.usedAt);
}
