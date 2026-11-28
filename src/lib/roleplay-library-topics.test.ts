import { describe, expect, it } from 'vitest';
import { inferRoleplayTopics, matchesRoleplayTopic, parseRoleplayTopicFilters, parseEditorialRoleplayTopic, resolveRoleplayTopics, parseRoleplayLibrarySearch, matchesRoleplayLibrarySearch, scoreRoleplayLibrarySearch, parseRoleplayLibrarySize, matchesRoleplayLibrarySize, selectRoleplayLibraryPreview } from './roleplay-library-topics';

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

describe('catalog search', () => {
  it('ignores repeated or malformed query parameters and bounds input', () => {
    expect(parseRoleplayLibrarySearch(['a','b'])).toBe('');
    expect(parseRoleplayLibrarySearch(undefined)).toBe('');
    expect(parseRoleplayLibrarySearch('  Pediatría  ')).toBe('Pediatría');
    expect(parseRoleplayLibrarySearch('a'.repeat(101))).toHaveLength(100);
  });
  it('matches case, accents, punctuation and fingerprint prefixes', () => {
    const titles = ['Consulta MÉDICA', 'Parent-teacher meeting'];
    const fingerprint = 'abc123' + '0'.repeat(58);
    const topics = inferRoleplayTopics(titles);
    expect(matchesRoleplayLibrarySearch(titles,fingerprint,topics,'consulta medica')).toBe(true);
    expect(matchesRoleplayLibrarySearch(titles,fingerprint,topics,'PARENT TEACHER')).toBe(true);
    expect(matchesRoleplayLibrarySearch(titles,fingerprint,topics,'ABC123')).toBe(true);
    expect(matchesRoleplayLibrarySearch(titles,fingerprint,topics,'!!!')).toBe(false);
    expect(matchesRoleplayLibrarySearch(titles,fingerprint,topics,'farmacia')).toBe(false);
  });
  it('matches reordered words and bilingual aliases while ranking direct titles first', () => {
    const fingerprint = '0'.repeat(64);
    const topics = [{ topic: 'medical', subtopic: 'pharmacy' }];
    expect(scoreRoleplayLibrarySearch(['Pharmacy consultation'], fingerprint, topics, 'pharmacy')).toBe(4);
    expect(scoreRoleplayLibrarySearch(['Intervención 1'], fingerprint, topics, 'farmacia')).toBe(3);
    expect(scoreRoleplayLibrarySearch(['Consulta médica inicial'], fingerprint, topics, 'inicial consulta')).toBe(2);
    expect(scoreRoleplayLibrarySearch(['Intervención 1'], fingerprint, topics, 'pharmacy')).toBe(1);
    expect(scoreRoleplayLibrarySearch(['Intervención 1'], fingerprint, topics, 'prescription farmacia')).toBe(1);
    expect(scoreRoleplayLibrarySearch(['Intervención 1'], fingerprint, topics, 'pharmacy legal')).toBe(0);
    expect(scoreRoleplayLibrarySearch(['Intervención 1'], fingerprint, [], 'pharmacy')).toBe(0);
    expect(scoreRoleplayLibrarySearch(['Intervención 1'], fingerprint, topics, '0000')).toBe(5);
    expect(scoreRoleplayLibrarySearch(['Intervención 1'], fingerprint, topics, '')).toBe(1);
  });
  it('uses only the selected categories for bilingual expansion and requires every query term', () => {
    const titles = ['Consulta médica', 'Intervención inicial'];
    const topics = resolveRoleplayTopics(titles, { topic: 'finance', subtopic: 'banking' });
    expect(matchesRoleplayLibrarySearch(titles, '0'.repeat(64), topics, 'bank account')).toBe(true);
    expect(matchesRoleplayLibrarySearch(titles, '0'.repeat(64), topics, 'doctor appointment')).toBe(false);
    expect(matchesRoleplayLibrarySearch(titles, '0'.repeat(64), topics, 'consulta inicial')).toBe(true);
    expect(matchesRoleplayLibrarySearch(titles, '0'.repeat(64), topics, 'consulta inexistente')).toBe(false);
  });
  it('searches resolved topic and child labels without substituting inferred classifications for saved ones', () => {
    const titles = ['Intervención 1'];
    const fingerprint = '0'.repeat(64);
    const topics = resolveRoleplayTopics(titles, {topic:'medical',subtopic:'pediatrics'});
    expect(matchesRoleplayLibrarySearch(titles,fingerprint,topics,'pediatria')).toBe(true);
    expect(matchesRoleplayLibrarySearch(titles,fingerprint,topics,'medicina')).toBe(true);
    expect(matchesRoleplayLibrarySearch(titles,fingerprint,topics,'seguros')).toBe(false);
    expect(matchesRoleplayLibrarySearch(titles,fingerprint,[], 'pediatria')).toBe(false);
  });
});

describe('catalog scenario count filters', () => {
  it('accepts only defined scalar filters and rejects malformed or repeated parameters', () => {
    expect(parseRoleplayLibrarySize('short')).toBe('short');
    expect(parseRoleplayLibrarySize(['short', 'long'])).toBe('');
    expect(parseRoleplayLibrarySize('unknown')).toBe('');
    expect(parseRoleplayLibrarySize(undefined)).toBe('');
  });
  it('assigns every valid scenario count to exactly one bounded range', () => {
    for (let count = 1; count <= 25; count++) {
      const ranges = (['single', 'short', 'medium', 'long'] as const).filter(size => matchesRoleplayLibrarySize(count, size));
      expect(ranges).toHaveLength(1);
      expect(matchesRoleplayLibrarySize(count, '')).toBe(true);
    }
    expect(matchesRoleplayLibrarySize(5, 'short')).toBe(true);
    expect(matchesRoleplayLibrarySize(6, 'short')).toBe(false);
    expect(matchesRoleplayLibrarySize(15, 'medium')).toBe(true);
    expect(matchesRoleplayLibrarySize(16, 'medium')).toBe(false);
    expect(matchesRoleplayLibrarySize(25, 'long')).toBe(true);
    expect(matchesRoleplayLibrarySize(26, 'long')).toBe(false);
    expect(matchesRoleplayLibrarySize(2.5, 'short')).toBe(false);
  });
});

describe('compact library scenario previews', () => {
  const titles = ['Inicio', 'Datos personales', 'Confirmación', 'Información', 'Seguimiento', 'Consulta pediátrica', 'Farmacia'];
  it('keeps the first five titles when there is no query or no title match', () => {
    for (const query of ['', '!!!', 'no-existe']) {
      expect(selectRoleplayLibraryPreview(titles, query)).toEqual(titles.slice(0, 5).map((title,index) => ({ title,index,matches:false })));
    }
  });
  it('reveals later matching titles with their original numbering and a five-item cap', () => {
    const result = selectRoleplayLibraryPreview(titles, 'consulta pediatrica');
    expect(result.map(item => item.index)).toEqual([0,1,2,3,5]);
    expect(result[4]).toEqual({title:'Consulta pediátrica', index:5, matches:true});
    expect(titles[5]).toBe('Consulta pediátrica');
  });
  it('prioritizes direct phrase matches over partial matches and handles short templates', () => {
    const input = ['Consulta', 'Datos', 'Seguimiento', 'Inicio', 'Final', 'Consulta médica', 'Medica consulta'];
    expect(selectRoleplayLibraryPreview(input, 'consulta medica').map(item=>item.index)).toEqual([0,1,2,5,6]);
    expect(selectRoleplayLibraryPreview(['Farmacia'], 'farm')).toEqual([{title:'Farmacia',index:0,matches:true}]);
    expect(selectRoleplayLibraryPreview([], 'farm')).toEqual([]);
  });
});
