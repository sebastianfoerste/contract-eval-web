'use client';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Check, CircleAlert, CircleCheck, Info, Link2, LoaderCircle, Monitor, Moon, Plus, Split, Sun, TriangleAlert, X } from 'lucide-react';
import { findingTier, type ReadoutPoint, type RiskFinding } from '@/lib/inspection';

const levels: Record<string, number> = { low: 1, medium: 2, high: 3 };

/** Severity as a three-step meter. It stays neutral so colour is free to mark the finding itself. */
export function Severity({ value }: { value?: string }) {
  const level = levels[value ?? ''] ?? 0;
  return <span className={`severity ${level ? '' : 'is-none'}`}>
    <span className="severity-bars" aria-hidden="true">{[1, 2, 3].map(step => <i key={step} className={step <= level ? 'is-on' : ''} />)}</span>
    {value ? value.charAt(0).toUpperCase() + value.slice(1) : 'None'}
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
  const icon = finding.status === 'Match' ? <Check />
    : finding.status === 'Severity mismatch' ? finding.gap < 0 ? <ArrowDown /> : <ArrowUp />
    : finding.status === 'Missed' ? <X />
    : finding.status === 'Extra flag' ? <Plus />
    : <Split />;
  const steps = Math.abs(finding.gap);
  return <span className={`tag tag-${findingTier(finding)}`}>
    {icon}{findingLabel(finding)}{finding.status === 'Severity mismatch' && steps > 1 && <span className="tag-note">by {steps} levels</span>}
  </span>;
}

export function ToneIcon({ tone }: { tone: ReadoutPoint['tone'] }) {
  return tone === 'good' ? <CircleCheck className="tone-icon tone-good" aria-label="No issue" />
    : tone === 'issue' ? <CircleAlert className="tone-icon tone-issue" aria-label="Issue" />
    : <Info className="tone-icon tone-info" aria-label="Note" />;
}

export function LocatedTag({ located }: { located: boolean }) {
  return <span className={`tag ${located ? 'tag-match' : 'tag-alarm'}`}>{located ? <Check /> : <TriangleAlert />}{located ? 'Found in contract' : 'Not in contract'}</span>;
}

export type Option<T extends string> = { value: T; label: string };

/**
 * A radio group styled as a segmented control. Native radios give arrow-key
 * movement and form semantics without extra ARIA wiring.
 */
export function Segmented<T extends string>({ legend, name, options, value, pending, onChange, children }: {
  legend: ReactNode; name: string; options: Option<T>[]; value: T; pending?: T | null; onChange: (value: T) => void; children?: ReactNode;
}) {
  const shown = pending ?? value;
  return <fieldset className="segmented-field">
    <legend>{legend}</legend>
    <div className="segmented">
      {options.map(option => <label key={option.value} className={`segment ${shown === option.value ? 'is-checked' : ''}`}>
        <input type="radio" name={name} value={option.value} checked={shown === option.value} onChange={() => onChange(option.value)} />
        <span className="segment-label">{option.label}{pending === option.value && pending !== value && <LoaderCircle className="spin" aria-label="Scoring" />}</span>
      </label>)}
    </div>
    {children}
  </fieldset>;
}

type Theme = 'system' | 'light' | 'dark';
const themeOrder: Theme[] = ['system', 'light', 'dark'];
const themeEvent = 'lab-theme';

function storedTheme(): Theme {
  try {
    const value = window.localStorage.getItem('theme');
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); the system setting still applies.
    return 'system';
  }
}

function subscribeTheme(notify: () => void) {
  window.addEventListener(themeEvent, notify);
  window.addEventListener('storage', notify);
  return () => {
    window.removeEventListener(themeEvent, notify);
    window.removeEventListener('storage', notify);
  };
}

/** Cycles system, light and dark. The choice is applied by the inline script in the layout on the next load. */
export function ThemeSwitch() {
  const theme = useSyncExternalStore(subscribeTheme, storedTheme, () => 'system' as Theme);
  const following = (current: Theme) => themeOrder[(themeOrder.indexOf(current) + 1) % themeOrder.length];
  function apply() {
    // Read the stored value at click time: two fast clicks must advance twice, not repeat one step.
    const next = following(storedTheme());
    try {
      if (next === 'system') window.localStorage.removeItem('theme');
      else window.localStorage.setItem('theme', next);
    } catch { /* The attribute below still switches the theme for this visit. */ }
    if (next === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    window.dispatchEvent(new Event(themeEvent));
  }
  return <button className="icon-button" onClick={apply} aria-label={`Theme: ${theme}. Switch to ${following(theme)}.`} title={`Theme: ${theme}`}>
    {theme === 'light' ? <Sun aria-hidden="true" /> : theme === 'dark' ? <Moon aria-hidden="true" /> : <Monitor aria-hidden="true" />}
  </button>;
}

/** Copies the current address, which carries the contract, scenario, view and selected clause. */
export function CopyLink() {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link', window.location.href);
    }
  }
  return <button className="button button-quiet" onClick={() => void copy()}>{copied ? <Check aria-hidden="true" /> : <Link2 aria-hidden="true" />}<span aria-live="polite">{copied ? 'Link copied' : 'Copy link'}</span></button>;
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
