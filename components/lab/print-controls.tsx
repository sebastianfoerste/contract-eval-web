'use client';
import { useEffect } from 'react';
import { copy, type Locale } from '@/lib/i18n';
export function PrintControls({ locale, back }: { locale: Locale; back: string }) {
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  return <nav className="print-controls" aria-label={copy(locale, 'Report actions', 'Berichtsaktionen')}><a className="button button-quiet" href={back}>{copy(locale, 'Back to the lab', 'Zurück zum Lab')}</a><button className="button" onClick={() => window.print()}>{copy(locale, 'Print / Save as PDF', 'Drucken / Als PDF speichern')}</button><p>{copy(locale, 'This is a print-ready report. Choose “Save as PDF” in your browser’s print dialog. No PDF is created until you save it.', 'Dies ist eine druckfertige Berichtsansicht. Im Druckdialog des Browsers „Als PDF speichern“ wählen. Eine PDF entsteht erst beim Speichern.')}</p></nav>;
}
