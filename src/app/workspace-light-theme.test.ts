import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';

const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
const patch = css.split('/* Light workspace: exact legacy utilities')[1]?.split('/* Light portal controls:')[0];
const root = postcss.parse(css);
const lightTokens = new Map<string, string>();
root.walkRules('html[data-theme="light"]', rule => {
  rule.walkDecls(/^--/, declaration => {
    lightTokens.set(declaration.prop, declaration.value);
  });
});

function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const value = hex === '#fff' ? '#ffffff' : hex;
    const channels = [1, 3, 5].map(index => {
      const n = parseInt(value.slice(index, index + 2), 16) / 255;
      return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe('light workspace compatibility', () => {
  it('covers exact legacy surfaces and status colors from the three admin modules', () => {
    expect(patch).toBeDefined();
    for (const name of [
      'bg-slate-950/70', 'bg-slate-950/80', 'bg-gray-900/95', 'bg-gray-800/60',
      'bg-gray-950/60', 'text-blue-100/70', 'text-amber-200/80', 'text-cyan-200/80',
      'text-red-200', 'text-teal-100', 'text-violet-100', 'text-orange-400',
      'hover:bg-white/10', 'hover:text-white',
    ]) {
      expect(patch).toContain(`[class~="${name}"]`);
    }
    expect(patch).not.toContain('[class~="bg-black"]');
  });

  it('keeps every added compatibility rule scoped to the light workspace', () => {
    const added = postcss.parse('/* Light workspace: exact legacy utilities' + patch);
    added.walkRules(rule => {
      for (const selector of rule.selectors) {
        expect(selector.trim().startsWith('html[data-theme="light"] .theme-workspace')).toBe(true);
      }
    });
  });

  it('keeps shared text and semantic status tokens above 4.5:1 on neutral surfaces', () => {
    for (const token of ['--foreground', '--text-secondary', '--theme-link',
      '--theme-success', '--theme-warning', '--theme-danger', '--theme-purple',
      '--theme-away', '--theme-info', '--text-tertiary']) {
      for (const surface of ['--theme-panel', '--theme-surface-muted']) {
        expect(contrast(lightTokens.get(token)!, lightTokens.get(surface)!)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps solid action button colors above 4.5:1 against white text', () => {
    const colors: string[] = [];
    root.walkRules(rule => {
      if (rule.selector.includes('.text-white') && rule.selector.includes('[class~="bg-cyan-500"]')
        || rule.selector.includes('.text-white') && /\[class~="bg-(blue|red|emerald|green|indigo|violet|purple|teal)-500"\]/.test(rule.selector)) {
        rule.walkDecls('background-color', declaration => {
          if (/^#[0-9a-f]{6}$/i.test(declaration.value)) colors.push(declaration.value);
        });
      }
    });
    expect(new Set(colors).size).toBeGreaterThanOrEqual(7);
    for (const color of colors) expect(contrast(color, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('light dashboard action contrast', () => {
  it('keeps call gradient endpoints readable, including hover', () => {
    for (const color of ['#065f46', '#047857', '#064e3b', '#991b1b', '#b91c1c', '#7f1d1d', '#1554a8', '#002d72']) {
      expect(contrast(color, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    }
    expect(css).toContain('linear-gradient(90deg, #065f46, #047857)');
    expect(css).toContain('linear-gradient(90deg, #991b1b, #b91c1c)');
    expect(css).toContain('input[type="file"][class~="file:bg-blue-600"]::file-selector-button');
    expect(css).toContain('[class~="bg-slate-950/55"].fixed.inset-0 { background-color: rgba(15, 23, 42, .55); }');
  });
});

describe('light portal interactive states', () => {
  it('keeps login and recruitment action colors readable', () => {
    for (const color of ['#002d72', '#1554a8', '#002452', '#12488f']) {
      expect(contrast(color, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast('#43546d', '#e2e8f0')).toBeGreaterThanOrEqual(4.5);
    expect(css).toContain('.theme-login button[type="submit"].from-blue-600.to-blue-500:hover');
    expect(css).toContain('.theme-postular .recruitment-funnel button[class~="disabled:bg-slate-400"]:disabled');
    expect(css).toContain('.theme-workspace [class~="hover:bg-slate-800/80"]:hover');
  });
});

describe('semantic monitoring palette', () => {
  it('keeps the away and informational states distinct and legible in both themes', () => {
    const darkTokens = new Map<string, string>();
    root.walkRules(':root', rule => {
      rule.walkDecls(/^--/, declaration => {
        darkTokens.set(declaration.prop, declaration.value);
      });
    });
    for (const tokens of [darkTokens, lightTokens]) {
      expect(tokens.get('--theme-away')).not.toBe(tokens.get('--theme-warning'));
      for (const token of ['--theme-away', '--theme-info']) {
        for (const surface of ['--theme-panel', '--theme-surface-muted']) {
          expect(contrast(tokens.get(token)!, tokens.get(surface)!)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('keeps portal-specific compatibility rules within the light theme', () => {
    const portal = css.split('/* Light portal controls:')[1]?.split('/* Notifications: shared presentation')[0];
    expect(portal).toBeDefined();
    postcss.parse('/* Light portal controls:' + portal).walkRules(rule => {
      for (const selector of rule.selectors) {
        expect(selector.trim()).toMatch(/^html\[data-theme="light"\] \.theme-(workspace|login|candidate|postular)\b/);
      }
    });
  });
});

describe('shared notification styles', () => {
  it('keeps new notification rules scoped to the panel across both appearances', () => {
    const rules = css.split('/* Notifications: shared presentation')[1];
    expect(rules).toBeDefined();
    postcss.parse('/* Notifications: shared presentation' + rules).walkRules(rule => {
      for (const selector of rule.selectors) {
        expect(selector.trim()).toMatch(/^\.notification-panel(?:\s|$)/);
      }
    });
  });
});

describe('Audio Studio semantic theme', () => {
  it('uses theme-aware controls and preserves the video surface and solid actions', () => {
    const studio = readFileSync(resolve(process.cwd(), 'src/app/admin/roleplays/studio/page.tsx'), 'utf8');
    expect(studio).toContain('bg-[var(--theme-control-bg)]');
    expect(studio).toContain('text-[var(--theme-control-text)]');
    expect(studio).toContain('border-[var(--theme-control-border)]');
    expect(studio).toContain('rounded-lg bg-black');
    expect(studio).toContain('theme-action-primary px-4 py-3 font-semibold');
    const finalization = readFileSync(resolve(process.cwd(), 'src/app/admin/roleplays/studio/StudioFinalizationPanel.tsx'), 'utf8');
    expect(finalization).toContain('theme-action-success px-5 py-3 font-bold');
    expect(finalization).toContain('bg-[var(--theme-control-bg)]');
  });

  it('uses theme colors for the waveform, selection and playhead', () => {
    const waveform = readFileSync(resolve(process.cwd(), 'src/app/admin/roleplays/studio/StudioWaveform.tsx'), 'utf8');
    expect(waveform).toContain('fill-[var(--theme-link)]');
    expect(waveform).toContain('fill-[var(--theme-success)] opacity-25');
    expect(waveform).toContain('stroke-[var(--theme-warning)]');
    expect(waveform).toContain('bg-[var(--theme-surface-muted)]');
  });
});

describe('semantic administration forms', () => {
  it.each([
    'src/app/admin/roleplays/new/NewRoleplayForm.tsx',
    'src/components/admin/CreateAccountForm.tsx',
    'src/components/admin/EditOperationalAccountForm.tsx',
    'src/components/admin/AccountAssignmentManager.tsx',
  ])('uses shared field colors in %s', path => {
    const source = readFileSync(resolve(process.cwd(), path), 'utf8');
    expect(source).toContain('bg-[var(--theme-control-bg)]');
    expect(source).toContain('border-[var(--theme-control-border)]');
    expect(source).toContain('text-[var(--theme-control-text)]');
    expect(source).not.toContain('bg-slate-900 ');
    expect(source).not.toContain('bg-slate-950 ');
  });

  it('keeps the roleplay assignment form actions and file control readable', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/admin/roleplays/new/NewRoleplayForm.tsx'), 'utf8');
    expect(source).toContain('theme-action-danger shadow-lg shadow-red-600/20');
    expect(source).toContain('theme-action-primary rounded-xl');
    expect(source).toContain('file:bg-blue-600');
    expect(source).toContain('file:text-white');
    expect(source).toContain('bg-[var(--theme-surface-muted)] text-[var(--text-tertiary)] cursor-not-allowed');
  });
});

describe('semantic messaging and quality controls', () => {
  it.each(['src/components/ChatSystem.tsx', 'src/components/QAEngine.tsx'])('uses shared control tokens in %s', path => {
    const source = readFileSync(resolve(process.cwd(), path), 'utf8');
    expect(source).toContain('bg-[var(--theme-control-bg)]');
    expect(source).toContain('border-[var(--theme-control-border)]');
    expect(source).toContain('text-[var(--theme-control-text)]');
    expect(source).not.toContain('bg-slate-950 ');
  });

  it('preserves sent and received message distinction', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ChatSystem.tsx'), 'utf8');
    expect(source).toContain('bg-blue-600 text-white rounded-br-none');
    expect(source).toContain('bg-[var(--theme-surface-muted)] text-[var(--foreground)] rounded-bl-none');
    expect(source).toContain('disabled:opacity-50 text-white');
  });

  it('keeps payroll summary surfaces independent of dark gradients', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/payroll/page.tsx'), 'utf8');
    expect(source).not.toMatch(/from-(indigo|orange|blue)-900\/40/);
    expect(source).toContain('bg-[var(--theme-panel)]');
    for (const token of ['--theme-purple', '--theme-away', '--theme-link']) {
      expect(source).toContain('text-[var(' + token + ')]');
    }
  });
});

describe('semantic recruitment and production controls', () => {
  it.each(['src/components/CandidateForm.tsx', 'src/app/admin/production/manual/page.tsx'])('uses shared field tokens in %s', path => {
    const source = readFileSync(resolve(process.cwd(), path), 'utf8');
    expect(source).toContain('bg-[var(--theme-control-bg)]');
    expect(source).toContain('border-[var(--theme-control-border)]');
    expect(source).toContain('text-[var(--theme-control-text)]');
    expect(source).toContain('focus:ring-[var(--theme-focus)]');
  });

  it('lets native select and calendar controls adapt to the chosen theme', () => {
    const candidate = readFileSync(resolve(process.cwd(), 'src/components/CandidateForm.tsx'), 'utf8');
    const manual = readFileSync(resolve(process.cwd(), 'src/app/admin/production/manual/page.tsx'), 'utf8');
    expect(candidate).not.toContain('[&>option]:bg-[#1a1a1a]');
    expect(manual).not.toContain('::-webkit-calendar-picker-indicator');
  });

  it('keeps calendar status and sticky surfaces theme-aware', () => {
    const calendar = readFileSync(resolve(process.cwd(), 'src/app/admin/calendar/page.tsx'), 'utf8');
    expect(calendar).toContain('bg-[var(--theme-panel)]');
    expect(calendar).toContain('group-hover:bg-[var(--theme-hover)]');
    expect(calendar).toContain('bg-rose-500/10 text-[var(--theme-danger)]');
    expect(calendar).not.toContain('bg-rose-950/50');
  });
});

describe('semantic operations and notification colors', () => {
  it.each([
    'src/components/admin/AccountPlatformForm.tsx',
    'src/components/admin/ReconciliationReviewForm.tsx',
    'src/components/admin/LegalAgreementManager.tsx',
  ])('uses shared readable controls in %s', path => {
    const source = readFileSync(resolve(process.cwd(), path), 'utf8');
    expect(source).toContain('bg-[var(--theme-control-bg)]');
    expect(source).toContain('border-[var(--theme-control-border)]');
    expect(source).toContain('text-[var(--theme-control-text)]');
    expect(source).not.toContain('bg-slate-900 ');
    expect(source).not.toContain('bg-slate-950 ');
  });

  it('keeps the notification status and unread count distinct', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/NotificationBell.tsx'), 'utf8');
    for (const token of ['--theme-success', '--theme-warning', '--theme-danger', '--theme-link']) {
      expect(source).toContain('text-[var(' + token + ')]');
    }
    expect(source).toContain('bg-[#b91c1c] text-xs font-bold text-white');
    expect(contrast('#b91c1c', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(source).toContain('data-unread={!n.isRead}');
    expect(source).toContain('aria-description={unreadLabel}');
  });
});

describe('shared solid actions', () => {
  it('defines one accessible action palette for both appearances', () => {
    const tokens = new Map<string, string>();
    root.walkRules(':root', rule => {
      rule.walkDecls(/^--theme-action-/, declaration => {
        tokens.set(declaration.prop, declaration.value);
      });
    });
    for (const variant of ['primary', 'success', 'danger']) {
      for (const suffix of ['', '-hover']) {
        expect(contrast(tokens.get('--theme-action-' + variant + suffix)!, tokens.get('--theme-action-text')!))
          .toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('uses semantic actions in the timer and administrative forms', () => {
    const timer = readFileSync(resolve(process.cwd(), 'src/components/CallTimer.tsx'), 'utf8');
    expect(timer).toContain('theme-action-success');
    expect(timer).toContain('theme-action-danger');
    for (const name of ['AccountPlatformForm', 'ReconciliationReviewForm']) {
      const source = readFileSync(resolve(process.cwd(), 'src/components/admin/' + name + '.tsx'), 'utf8');
      expect(source).toContain('theme-action-primary');
    }
  });
});

describe('shared Audio Studio actions', () => {
  it.each([
    'src/app/admin/roleplays/studio/LocalVadAssistant.tsx',
    'src/app/admin/roleplays/studio/StudioConsecutivePreview.tsx',
  ])('uses accessible primary actions in %s', path => {
    const source = readFileSync(resolve(process.cwd(), path), 'utf8');
    expect(source).toContain('theme-action-primary');
  });

  it('preserves native disabled conditions on studio actions', () => {
    const studio = readFileSync(resolve(process.cwd(), 'src/app/admin/roleplays/studio/page.tsx'), 'utf8');
    expect(studio).toContain('disabled={segments.length >= editorLimit}');
    expect(studio).toContain('expandedEditor ? STUDIO_MAX_EDITOR_SEGMENTS : ROLEPLAY_MAX_SCENARIOS');
    const finalization = readFileSync(resolve(process.cwd(), 'src/app/admin/roleplays/studio/StudioFinalizationPanel.tsx'), 'utf8');
    expect(finalization).toContain('disabled={busy || draftBusy || analyzingSilences || !segmentCount || segmentCount > ROLEPLAY_MAX_SCENARIOS}');
    expect(finalization).toContain('disabled={!selectedPublicationPart || busy || draftBusy || analyzingSilences}');
    const library = readFileSync(resolve(process.cwd(), 'src/app/admin/roleplays/studio/HappyScribeLibraryPanel.tsx'), 'utf8');
    expect(library).toContain('disabled={!happyScribeSelectedId || happyScribeImporting || happyScribeMediaImporting || happyScribeLoading}');
    expect(library).toContain('bg-[var(--theme-control-bg)]');
    expect(library).toContain('text-[var(--theme-control-text)]');
  });
});

describe('responsive workspace navigation and library', () => {
  it('keeps the workspace within the dynamic viewport and respects mobile safe areas', () => {
    const shell = readFileSync(resolve(process.cwd(), 'src/components/DashboardShell.tsx'), 'utf8');
    const mobile = readFileSync(resolve(process.cwd(), 'src/components/MobileBottomNav.tsx'), 'utf8');
    expect(shell).toContain('h-dvh overflow-hidden');
    expect(shell).toContain('min-h-0 flex-1');
    expect(shell).toContain('pb-[calc(6rem+env(safe-area-inset-bottom))]');
    expect(mobile).toContain('70dvh');
    expect(mobile).toContain('overscroll-contain');
  });

  it('uses semantic navigation status and progress colors', () => {
    const sidebar = readFileSync(resolve(process.cwd(), 'src/components/Sidebar.tsx'), 'utf8');
    const navbar = readFileSync(resolve(process.cwd(), 'src/components/Navbar.tsx'), 'utf8');
    expect(sidebar).toContain('bg-[var(--theme-track)]');
    expect(sidebar).toContain('bg-[var(--theme-warning)]');
    expect(navbar).toContain('text-[var(--theme-danger)]');
    expect(navbar).toContain('w-[min(16rem,calc(100vw-1.5rem))]');
    for (const source of [sidebar, navbar]) {
      expect(source).toContain('focus-visible:outline-[var(--theme-focus)]');
    }
  });

  it('keeps library search and exercise titles responsive', () => {
    const library = readFileSync(resolve(process.cwd(), 'src/app/admin/roleplays/library/page.tsx'), 'utf8');
    expect(library).toContain('min-w-0 w-full sm:w-auto sm:min-w-0 flex-1');
    expect(library).toContain('theme-action-primary px-5 py-3');
    expect(library).toContain('break-words text-lg');
    expect(library).toContain('break-all font-mono');
  });
});

describe('accessible operational tables', () => {
  it.each([
    'src/app/admin/accounts/page.tsx',
    'src/app/admin/assignments/page.tsx',
    'src/app/recruitment/page.tsx',
    'src/app/production/page.tsx',
    'src/app/dashboard/earnings/page.tsx',
  ])('provides a named keyboard-scrollable region in %s', path => {
    const source = readFileSync(resolve(process.cwd(), path), 'utf8');
    expect(source).toMatch(/role="region" aria-label="[^"]+" tabIndex=\{0\} className="max-w-full overflow-x-auto/);
    expect(source).not.toContain('divide-white/5');
  });

  it('keeps missing production records readable and progress colors semantic', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/production/page.tsx'), 'utf8');
    expect(source).not.toContain('isPlaceholder ? "opacity-40"');
    for (const token of ['--theme-success', '--theme-warning', '--theme-danger']) {
      expect(source).toContain('bg-[var(' + token + ')]');
    }
  });
});

describe('semantic feedback and production filters', () => {
  it.each(['src/app/error.tsx', 'src/app/admin/error.tsx'])('keeps error recovery readable in %s', path => {
    const source = readFileSync(resolve(process.cwd(), path), 'utf8');
    expect(source).toContain('theme-action-primary');
    expect(source).toContain('text-[var(--foreground)]');
    expect(source).toContain('onClick={reset}');
    expect(source).toContain('error.digest');
  });

  it('uses a self-contained system appearance for fatal layout errors', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/global-error.tsx'), 'utf8');
    expect(source).toContain('@media (prefers-color-scheme: dark)');
    expect(source).toContain('className="fatal-retry"');
    for (const color of ['#1554a8', '#002d72']) {
      expect(contrast(color, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('uses shared control tokens and accessible filter names', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/admin/ProductionLogControls.tsx'), 'utf8');
    for (const token of ['--theme-control-bg', '--theme-control-border', '--theme-control-text', '--theme-focus']) {
      expect(source).toContain('var(' + token + ')');
    }
    for (const label of ['Buscar registros de producción', 'Estado de producción', 'Desde la fecha', 'Hasta la fecha']) {
      expect(source).toContain('aria-label="' + label + '"');
    }
    expect(source).toContain('aria-expanded={showInterpreterDropdown}');
    expect(source).not.toContain('bg-slate-950');
  });

  it('announces monitoring loading and marks the selected production page', () => {
    const monitor = readFileSync(resolve(process.cwd(), 'src/components/admin/RealTimeMonitor.tsx'), 'utf8');
    const production = readFileSync(resolve(process.cwd(), 'src/app/production/page.tsx'), 'utf8');
    expect(monitor).toContain('Cargando estados de los intérpretes…');
    expect(monitor).toContain('motion-reduce:animate-none');
    expect(production).toContain('aria-label="Paginación de producción"');
    expect(production).toContain("aria-current={p === currentPage ? 'page' : undefined}");
  });
});

describe('semantic dashboard and payroll surfaces', () => {
  it('keeps the interpreter dashboard legible without fixed dark cards', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/dashboard/page.tsx'), 'utf8');
    expect(source).not.toContain('from-indigo-900/50 to-slate-900');
    expect(source).toContain('bg-[var(--theme-panel)]');
    expect(source).toContain('bg-[var(--theme-track)]');
    expect(source).toContain('bg-[var(--theme-purple)]');
    expect(source).toContain('bg-[var(--theme-success)]');
  });

  it('uses shared controls for payroll filters and transaction forms', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/PayrollEngine.tsx'), 'utf8');
    for (const token of ['--theme-control-bg', '--theme-control-border', '--theme-control-text', '--theme-focus']) {
      expect(source).toContain('var(' + token + ')');
    }
    expect(source).toContain('aria-pressed={filterStatus === status}');
    expect(source.match(/<Modal isOpen onClose=\{closeModal\}/g)).toHaveLength(3);
    const modal = readFileSync(resolve(process.cwd(), 'src/components/Modal.tsx'), 'utf8');
    expect(modal).toContain('max-h-[calc(100dvh-1.5rem)]');
    expect(modal).toContain('overflow-y-auto overscroll-contain');
    expect(source).toContain('theme-action-primary');
    expect(source).toContain('theme-action-secondary');
    expect(source).not.toContain('bg-slate-950');
  });

  it('keeps live roster counters readable on the shared panel', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/admin/LiveRosterPanel.tsx'), 'utf8');
    expect(source).toContain('bg-[var(--theme-panel)]');
    for (const token of ['--theme-success', '--theme-warning', '--theme-away']) {
      expect(source).toContain('text-[var(' + token + ')]');
    }
  });
});

describe('shared production edit and delete dialogs', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/components/admin/ProductionLogActions.tsx'), 'utf8');

  it('uses the shared modal rather than forcing a light appearance or managing global scroll independently', () => {
    expect(source).toContain('import { Modal }');
    expect(source).toContain('<Modal isOpen={editOpen}');
    expect(source).toContain('<Modal isOpen={deleteOpen}');
    expect(source).not.toContain('modal-light');
    expect(source).not.toContain('createPortal');
    expect(source).not.toContain('document.body.style.overflow');
    for (const token of ['--theme-control-bg', '--theme-control-text', '--theme-control-border', '--theme-danger']) {
      expect(source).toContain('var(' + token + ')');
    }
    expect(source).toContain('theme-action-primary');
    expect(source).toContain('theme-action-danger');
  });

  it('associates labels and validation errors with each editable field', () => {
    for (const field of ['date', 'status', 'interpretedMinutes', 'callsAttended', 'adherence', 'observaciones']) {
      expect(source).toContain('htmlFor={`production-${log.id}-' + field + '`}');
      expect(source).toContain('id={`production-${log.id}-' + field + '`}');
      expect(source).toContain('aria-invalid={Boolean(errors.' + field + ')}');
      expect(source).toContain('aria-describedby={errors.' + field);
    }
    expect(source).toContain('disabled={isPending}');
    expect(source).toContain('handleSubmit(onEditSubmit)');
    expect(source).toContain('onClick={onDelete}');
    expect(source).toContain('triggerRef.current?.focus()');
  });
});

describe('calendar layout and semantic report controls', () => {
  it('keeps only the interpreter column sticky on wide screens', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/admin/calendar/page.tsx'), 'utf8');
    expect(source.match(/xl:sticky xl:left-0/g)).toHaveLength(2);
    expect(source).not.toMatch(/sticky left-\[/);
    expect(source).toContain('aria-label="Calendario mensual de cumplimiento" tabIndex={0}');
    expect(source).toContain('aria-label="Mes anterior"');
    expect(source).toContain('aria-label="Mes siguiente"');
  });

  it.each([
    'src/components/admin/CompanyReportForm.tsx',
    'src/components/admin/CompanyCsvImport.tsx',
    'src/components/GeneratePayrollButton.tsx',
  ])('uses shared fields and actions in %s', path => {
    const source = readFileSync(resolve(process.cwd(), path), 'utf8');
    for (const token of ['--theme-control-bg', '--theme-control-border', '--theme-control-text']) {
      expect(source).toContain('var(' + token + ')');
    }
    expect(source).toContain('theme-action-primary');
  });

  it('keeps payroll date labels associated with their controls', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/GeneratePayrollButton.tsx'), 'utf8');
    for (const id of ['payroll-period-start', 'payroll-period-end']) {
      expect(source).toContain('htmlFor="' + id + '"');
      expect(source).toContain('id="' + id + '"');
    }
  });
});

describe('shared payroll dialogs preserve transaction controls', () => {
  it('retains each form action, identifier and required payment reference', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/PayrollEngine.tsx'), 'utf8');
    for (const action of ['adjustAction', 'verifyAction', 'payAction']) {
      expect(source).toContain('<form action={' + action + '}');
    }
    expect(source.match(/name="id" value=\{selectedRecord.id\}/g)).toHaveLength(3);
    expect(source).toContain('name="transactionReference" required');
    expect(source).toContain('disabled={pending}');
    for (const field of ['incentives', 'penalties', 'verifiedMinutes', 'transactionReference']) {
      expect(source).toContain('htmlFor="payroll-' + field + '"');
      expect(source).toContain('id="payroll-' + field + '"');
    }
    expect(source).not.toContain('fixed inset-0 z-50 flex items-center justify-center bg-black/80');
  });
});

describe('disabled semantic action cascade guard', () => {
  it('declares the important guard before Tailwind and limits it to disabled workspace actions', () => {
    expect(css.indexOf('@layer disabled-action-guard;')).toBeGreaterThanOrEqual(0);
    expect(css.indexOf('@layer disabled-action-guard;')).toBeLessThan(css.indexOf('@import "tailwindcss";'));
    const values = new Map<string, string>();
    root.walkAtRules('layer', layer => {
      if (layer.params !== 'disabled-action-guard' || !layer.nodes) return;
      layer.walkRules(rule => {
        expect(rule.selector).toBe('.theme-workspace :is(.theme-action-primary, .theme-action-success, .theme-action-danger, .theme-action-secondary):disabled');
        rule.walkDecls(declaration => {
          expect(declaration.important).toBe(true);
          values.set(declaration.prop, declaration.value);
        });
      });
    });
    for (const [property, value] of Object.entries({
      'transition-property': 'none', transform: 'none', translate: '0px 0px',
      scale: '1', rotate: '0deg', 'box-shadow': 'none',
      '--tw-translate-x': '0px', '--tw-translate-y': '0px', '--tw-translate-z': '0px',
      '--tw-scale-x': '1', '--tw-scale-y': '1', '--tw-scale-z': '1',
    })) expect(values.get(property)).toBe(value);
  });
});
