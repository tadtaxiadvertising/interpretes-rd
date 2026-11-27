// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusStudioIntervention, isStudioShortcutTarget } from './studio-editor-focus';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('editor shortcut targets', () => {
  it('protects native inputs and editable widgets including nested descendants', () => {
    document.body.innerHTML = '<input id="input"><textarea id="textarea"></textarea><select id="select"></select><div role="textbox"><span id="widget"></span></div><div contenteditable=""><span id="empty"></span></div><div contenteditable="plaintext-only"><span id="plain"></span></div><div contenteditable="true"><span id="nested"></span><span id="noneditable" contenteditable="false"></span></div><div role="slider" id="slider"></div>';
    for (const id of ['input', 'textarea', 'select', 'widget', 'empty', 'plain', 'nested', 'slider']) {
      expect(isStudioShortcutTarget(document.getElementById(id))).toBe(false);
    }
    expect(isStudioShortcutTarget(document.getElementById('noneditable'))).toBe(true);
    expect(isStudioShortcutTarget(null)).toBe(false);
  });

  it('allows shortcuts from non-editable controls and their SVG descendants', () => {
    document.body.innerHTML = '<button id="button"><svg><path id="icon"></path></svg></button>';
    expect(isStudioShortcutTarget(document.getElementById('button'))).toBe(true);
    expect(isStudioShortcutTarget(document.getElementById('icon'))).toBe(true);
  });
});

describe('intervention focus', () => {
  function setup(reducedMotion: boolean) {
    document.body.innerHTML = '<div id="wrapper"><article id="studio-intervention-a" tabindex="-1"></article></div>';
    const article = document.getElementById('studio-intervention-a')!;
    const scroll = vi.fn();
    Object.defineProperty(article, 'scrollIntoView', { value: scroll, configurable: true });
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reducedMotion })));
    return { article, scroll, wrapper: document.getElementById('wrapper')! };
  }

  it.each([true, false])('honors reduced motion = %s', reducedMotion => {
    const { article, scroll } = setup(reducedMotion);
    focusStudioIntervention('a', true);
    expect(document.activeElement).toBe(article);
    expect(scroll).toHaveBeenCalledWith({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'center' });
  });

  it('skips scrolling when requested and avoids hidden or inert interventions', () => {
    const { article, scroll, wrapper } = setup(false);
    const focus = vi.spyOn(article, 'focus');
    focusStudioIntervention('a', false);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scroll).not.toHaveBeenCalled();
    focus.mockClear();
    wrapper.hidden = true;
    focusStudioIntervention('a', true);
    wrapper.hidden = false;
    wrapper.setAttribute('inert', '');
    focusStudioIntervention('a', true);
    focusStudioIntervention('missing', true);
    expect(focus).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
  });
});
