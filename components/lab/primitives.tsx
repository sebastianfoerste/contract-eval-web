import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Check, CircleAlert, CircleCheck, Info, LoaderCircle, Plus, Split, TriangleAlert, X } from 'lucide-react';
import type { ReadoutPoint, RiskFinding } from '@/lib/inspection';

export function Severity({ value }: { value?: string }) {
  return <span className={`severity severity-${value || 'none'}`}>{value || 'None'}</span>;
}

/** The finding status in words a reviewer would use, with the direction of a severity mismatch. */
export function findingLabel(finding: RiskFinding) {
  if (finding.status === 'Severity mismatch') return finding.gap < 0 ? 'Under-rated' : 'Over-rated';
  if (finding.status === 'Missed') return 'Missed risk';
  return finding.status;
}

export function FindingTag({ finding }: { finding: RiskFinding }) {
  const icon = finding.status === 'Match' ? <Check />
    : finding.status === 'Severity mismatch' ? finding.gap < 0 ? <ArrowDown /> : <ArrowUp />
    : finding.status === 'Missed' ? <X />
    : finding.status === 'Extra flag' ? <Plus />
    : <Split />;
  const levels = Math.abs(finding.gap);
  return <span className={`tag ${finding.status === 'Match' ? 'tag-good' : 'tag-issue'}`}>
    {icon}{findingLabel(finding)}{levels > 1 && <span className="tag-note">{levels} levels</span>}
  </span>;
}

export function ToneIcon({ tone }: { tone: ReadoutPoint['tone'] }) {
  return tone === 'good' ? <CircleCheck className="tone-icon tone-good" aria-label="No issue" />
    : tone === 'issue' ? <CircleAlert className="tone-icon tone-issue" aria-label="Issue" />
    : <Info className="tone-icon tone-info" aria-label="Note" />;
}

export function GroundedTag({ grounded }: { grounded: boolean }) {
  return <span className={`tag ${grounded ? 'tag-good' : 'tag-issue'}`}>{grounded ? <Check /> : <TriangleAlert />}{grounded ? 'Located' : 'Not found'}</span>;
}

export type Option<T extends string> = { value: T; label: string; detail?: string };

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
    <div className="segmented" role="presentation">
      {options.map(option => <label key={option.value} className={`segment ${shown === option.value ? 'is-checked' : ''}`}>
        <input type="radio" name={name} value={option.value} checked={shown === option.value} onChange={() => onChange(option.value)} />
        <span className="segment-label">{option.label}{pending === option.value && pending !== value && <LoaderCircle className="spin" aria-label="Evaluating" />}</span>
        {option.detail && <span className="segment-detail">{option.detail}</span>}
      </label>)}
    </div>
    {children}
  </fieldset>;
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
