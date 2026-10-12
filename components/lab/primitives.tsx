'use client';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Check, CircleAlert, CircleCheck, Info, Link2, LoaderCircle, Monitor, Moon, Plus, Split, Sun, TriangleAlert, X } from 'lucide-react';
import { useLocale } from './locale';
import { findingTier, type ReadoutPoint, type RiskFinding } from '@/lib/inspection';
import { appliedTheme, applyTheme, nextTheme, type Theme } from '@/lib/theme';

const levels: Record<string, number> = { low: 1, medium: 2, high: 3 };

/** Severity as a three-step meter. It stays neutral so colour is free to mark the finding itself. */
export function Severity({ value }: { value?: string }) {
  const { severityText } = useLocale();
  const level = levels[value ?? ''] ?? 0;
  return <span className={`severity ${level ? '' : 'is-none'}`}>
    <span className="severity-bars" aria-hidden="true">{[1, 2, 3].map(step => <i key={step} className={step <= level ? 'is-on' : ''} />)}</span>
    {severityText(value)}
  </span>;
}

/** The finding status in words a reviewer would use, with the direction of a severity mismatch. */
export function findingLabel(finding: RiskFinding) {
  if (finding.status === 'Severity mismatch') return finding.gap < 0 ? 'Under-rated' : 'Over-rated';
  if (finding.status === 'Missed') return 'Missed risk';
  if (finding.status === 'Conflict') return 'Contradictory';
  return finding.status;
}

export function FindingTag({ finding }: { finding: RiskFinding }) {
  const { t, statusText } = useLocale();
  const icon = finding.status === 'Match' ? <Check />
    : finding.status === 'Severity mismatch' ? finding.gap < 0 ? <ArrowDown /> : <ArrowUp />
    : finding.status === 'Missed' ? <X />
    : finding.status === 'Extra flag' ? <Plus />
    : <Split />;
  const steps = Math.abs(finding.gap);
  return <span className={`tag tag-${findingTier(finding)}`}>
    {icon}{statusText(findingLabel(finding))}{finding.status === 'Severity mismatch' && steps > 1 && <span className="tag-note">{t('by', 'um')} {steps} {t('levels', 'Stufen')}</span>}
  </span>;
}

export function ToneIcon({ tone }: { tone: ReadoutPoint['tone'] }) {
  const { t } = useLocale();
  return tone === 'good' ? <CircleCheck className="tone-icon tone-good" aria-label={t("No issue", "Kein Problem")} />
    : tone === 'issue' ? <CircleAlert className="tone-icon tone-issue" aria-label={t("Issue", "Problem")} />
    : <Info className="tone-icon tone-info" aria-label={t("Note", "Hinweis")} />;
}

export function LocatedTag({ located }: { located: boolean }) {
  const { t } = useLocale();
  return <span className={`tag ${located ? 'tag-match' : 'tag-alarm'}`}>{located ? <Check /> : <TriangleAlert />}{located ? t('Found in contract', 'Im Vertrag gefunden') : t('Not in contract', 'Nicht im Vertrag')}</span>;
}

export type Option<T extends string> = { value: T; label: string };

/**
 * A radio group styled as a segmented control. Native radios give arrow-key
 * movement and form semantics without extra ARIA wiring.
 */
export function Segmented<T extends string>({ legend, name, options, value, pending, onChange, children }: {
  legend: ReactNode; name: string; options: Option<T>[]; value: T; pending?: T | null; onChange: (value: T) => void; children?: ReactNode;
}) {
  const { t } = useLocale();
  const shown = pending ?? value;
  return <fieldset className="segmented-field">
    <legend>{legend}</legend>
    <div className="segmented">
      {options.map(option => <label key={option.value} className={`segment ${shown === option.value ? 'is-checked' : ''}`}>
        <input type="radio" name={name} value={option.value} checked={shown === option.value} onChange={() => onChange(option.value)} />
        <span className="segment-label">{option.label}{pending === option.value && pending !== value && <LoaderCircle className="spin" aria-label={t("Updating", "Wird aktualisiert")} />}</span>
      </label>)}
    </div>
    {children}
  </fieldset>;
}

const themeEvent = 'lab-theme';

function storedTheme(): Theme {
  // The applied DOM state is authoritative even when storage reads or writes fail.
  return appliedTheme(document.documentElement);
}
function subscribeTheme(notify: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key !== 'theme' && event.key !== null) return;
    if (event.newValue === 'light' || event.newValue === 'dark') document.documentElement.dataset.theme = event.newValue;
    else delete document.documentElement.dataset.theme;
    notify();
  }
  window.addEventListener(themeEvent, notify);
  window.addEventListener('storage', onStorage);
  return () => { window.removeEventListener(themeEvent, notify); window.removeEventListener('storage', onStorage); };
}

/** Cycles system, light and dark. The choice is applied by the inline script in the layout on the next load. */
export function ThemeSwitch() {
  const { t } = useLocale();
  const theme = useSyncExternalStore(subscribeTheme, storedTheme, () => 'system' as Theme);
  const following = nextTheme;
  function apply() {
    // Read the applied value at click time: two fast clicks advance twice.
    const next = following(storedTheme());
    applyTheme(document.documentElement, () => window.localStorage, next);
    window.dispatchEvent(new Event(themeEvent));
  }
  return <button className="icon-button" onClick={apply} aria-label={t(`Theme: ${theme}. Switch to ${following(theme)}.`, `Darstellung: ${{system:"System",light:"Hell",dark:"Dunkel"}[theme]}. Wechsel zu ${{system:"System",light:"Hell",dark:"Dunkel"}[following(theme)]}.`)} title={t(`Theme: ${theme}`, `Darstellung: ${{system:"System",light:"Hell",dark:"Dunkel"}[theme]}`)}>
    {theme === 'light' ? <Sun aria-hidden="true" /> : theme === 'dark' ? <Moon aria-hidden="true" /> : <Monitor aria-hidden="true" />}
  </button>;
}

/** Copies the current address, which carries the contract, scenario, view and selected clause. */
export function CopyLink() {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t('Copy this link', 'Diesen Link kopieren'), window.location.href);
    }
  }
  return <button className="button button-quiet" onClick={() => void copy()}>{copied ? <Check aria-hidden="true" /> : <Link2 aria-hidden="true" />}<span aria-live="polite">{copied ? t('Link copied', 'Link kopiert') : t('Copy link', 'Link kopieren')}</span></button>;
}

export function download(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
