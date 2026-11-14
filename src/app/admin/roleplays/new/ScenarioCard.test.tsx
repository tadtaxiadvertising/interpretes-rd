import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScenarioCard } from './ScenarioCard';

const shared = {
  index: 0,
  scenarioCount: 1,
  onUpdate: vi.fn(),
  onRemove: vi.fn(),
  onMoveUp: vi.fn(),
  onMoveDown: vi.fn(),
  isDragging: false,
};

const baseScenario = {
  id: 'legacy-scenario',
  title: 'Scenario without Studio metadata',
  baseAudioFile: null,
  baseAudioPreview: '',
  durationLimitSec: 0,
  scriptPrompt: '',
};

describe('ScenarioCard with nullable Studio metadata', () => {
  it('renders legacy library scenarios with null timeline fields', () => {
    const markup = renderToStaticMarkup(
      <ScenarioCard {...shared} scenario={{ ...baseScenario, sourceStartSec: null, sourceEndSec: null }} />,
    );
    expect(markup).toContain('Scenario without Studio metadata');
    expect(markup).not.toContain('NaNs');
    expect(markup).not.toContain('nulls–nulls');
  });

  it('renders a complete source time range when both values exist', () => {
    const markup = renderToStaticMarkup(
      <ScenarioCard {...shared} scenario={{ ...baseScenario, sourceStartSec: 0, sourceEndSec: 2.5 }} />,
    );
    expect(markup).toContain('0.00s');
    expect(markup).toContain('2.50s');
  });

  it('does not crash or show an incomplete range when one endpoint is null', () => {
    const markup = renderToStaticMarkup(
      <ScenarioCard {...shared} scenario={{ ...baseScenario, sourceStartSec: 1.5, sourceEndSec: null }} />,
    );
    expect(markup).toContain('Scenario without Studio metadata');
    expect(markup).not.toContain('1.50s');
  });
});
