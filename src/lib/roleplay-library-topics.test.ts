import { describe, expect, it } from 'vitest';
import { inferRoleplayTopics, matchesRoleplayTopic, parseRoleplayTopicFilters, parseEditorialRoleplayTopic, resolveRoleplayTopics } from './roleplay-library-topics';

describe('library topic suggestions', () => {
  it('recognizes bilingual titles and ignores case and accents', () => {
    expect(inferRoleplayTopics(['CONSULTA MÉDICA', 'PHARMACY', 'Consulta medica'])).toEqual([
      { topic: 'medical', subtopic: 'consultation' },
      { topic: 'medical', subtopic: 'pharmacy' },
    ]);
  });
  it('allows multiple topics without duplicating subtopics', () => {
    expect(inferRoleplayTopics(['Insurance claim', 'Medical appointment', 'Insurance claim'])).toEqual([
      { topic: 'medical', subtopic: 'consultation' },
      { topic: 'insurance', subtopic: 'claims' },
    ]);
  });
  it('does not infer a topic from generic roles or partial words', () => {
    expect(inferRoleplayTopics(['Cliente · 1 (EN)', 'Paciente · 2 (ES)', 'Balloon'])).toEqual([]);
  });
  it('rejects unknown categories and unrelated subcategories', () => {
    expect(parseRoleplayTopicFilters('medical', 'claims')).toEqual({ topic: 'medical', subtopic: '' });
    expect(parseRoleplayTopicFilters('medical', 'pharmacy')).toEqual({ topic: 'medical', subtopic: 'pharmacy' });
    expect(parseRoleplayTopicFilters(['medical'], 'pharmacy')).toEqual({ topic: '', subtopic: '' });
    expect(parseRoleplayTopicFilters('unclassified', 'pharmacy')).toEqual({ topic: 'unclassified', subtopic: '' });
  });
  it('filters all, unclassified, parent and child independently', () => {
    const hints = inferRoleplayTopics(['Farmacia']);
    expect(matchesRoleplayTopic(hints, '', '')).toBe(true);
    expect(matchesRoleplayTopic(hints, 'medical', '')).toBe(true);
    expect(matchesRoleplayTopic(hints, 'medical', 'pharmacy')).toBe(true);
    expect(matchesRoleplayTopic(hints, 'medical', 'consultation')).toBe(false);
    expect(matchesRoleplayTopic(hints, 'unclassified', '')).toBe(false);
    expect(matchesRoleplayTopic([], 'unclassified', '')).toBe(true);
  });
});

describe('explicit editorial categories', () => {
  it('requires an exact allowed parent and child', () => {
    expect(parseEditorialRoleplayTopic('medical', 'pharmacy')).toEqual({topic:'medical', subtopic:'pharmacy'});
    expect(parseEditorialRoleplayTopic('medical', 'claims')).toBeNull();
    expect(parseEditorialRoleplayTopic('unclassified', '')).toBeNull();
    expect(parseEditorialRoleplayTopic('medical', '')).toBeNull();
    expect(parseEditorialRoleplayTopic(['medical'], 'pharmacy')).toBeNull();
  });
  it('gives explicit selections precedence without mutating titles', () => {
    const titles = ['Pharmacy', 'Insurance claim'];
    expect(resolveRoleplayTopics(titles, {topic:'finance', subtopic:'banking'})).toEqual([{topic:'finance',subtopic:'banking'}]);
    expect(titles).toEqual(['Pharmacy', 'Insurance claim']);
    expect(resolveRoleplayTopics(titles, null)).toEqual(inferRoleplayTopics(titles));
    expect(resolveRoleplayTopics(titles, {topic:'medical',subtopic:'claims'})).toEqual(inferRoleplayTopics(titles));
  });
});
