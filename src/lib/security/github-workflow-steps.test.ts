// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('GitHub workflow step declarations', () => {
  it('requires every named step to define an executable action or run command', () => {
    const directory = join(process.cwd(), '.github', 'workflows');
    const files = readdirSync(directory).filter(file => /\.ya?ml$/.test(file));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const lines = readFileSync(join(directory, file), 'utf8').split(/\r?\n/);
      const names: Array<{ name: string; line: number; body: string }> = [];
      for (let index = 0; index < lines.length; index++) {
        const match = lines[index].match(/^(\s*)-\s+name:\s*(.*)$/);
        if (!match) continue;
        const indent = match[1].length;
        let end = index + 1;
        while (end < lines.length) {
          const current = lines[end];
          if (current.trim() && !current.trimStart().startsWith('#')) {
            const currentIndent = current.length - current.trimStart().length;
            if (currentIndent <= indent) break;
          }
          end++;
        }
        names.push({ name: match[2], line: index + 1, body: lines.slice(index + 1, end).join('\n') });
      }

      for (const step of names) {
        // YAML comments, display names and environment variables do not make
        // an otherwise empty step valid. Prevent the no-job workflow failure.
        expect(
          /^\s+(run|uses):/m.test(step.body),
          `${file}:${step.line} has an empty action step: ${step.name}`,
        ).toBe(true);
      }
    }
  });
});
