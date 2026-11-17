import { describe, expect, it } from 'vitest';
import { adminMenu, interpreterMenu } from './Sidebar';

describe('Live workspace navigation', () => {
  it('exposes one exact Live link in the administrator operations menu', () => {
    const links = adminMenu.filter(item => item.href === '/live');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      label: 'Interpretación en vivo (IA local)',
      exact: true,
      section: 'Operaciones',
    });
  });

  it('makes Live discoverable from the interpreter sidebar and mobile shortcuts', () => {
    const links = interpreterMenu.filter(item => item.href === '/live');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ label: 'Interpretación en vivo (IA local)', exact: true });
    expect(interpreterMenu.slice(0, 5).some(item => item.href === '/live')).toBe(true);
  });
});
