'use client';
import { useSyncExternalStore } from 'react';
const subscribe = () => () => {};
export default function PageError({ reset }: { error: Error; reset: () => void }) {
  const de = useSyncExternalStore(subscribe, () => new URLSearchParams(window.location.search).get('lang') === 'de', () => false);
  return <main className="page-error" lang={de?'de':'en'}><h1>{de?'Das Lab konnte nicht angezeigt werden':'The lab could not be displayed'}</h1><p>{de?'Die Ansicht konnte nicht geladen werden. Die zuletzt in der Adresse gespeicherte Auswahl bleibt für einen erneuten Versuch erhalten.':'The view could not be loaded. The selection last recorded in the address remains available when you retry.'}</p><div className="button-row"><button className="button" onClick={reset}>{de?'Erneut versuchen':'Try again'}</button><button className="button button-quiet" onClick={()=>window.location.assign(de?'/?lang=de':'/')}>{de?'Mit dem ersten Vertrag beginnen':'Start from the first contract'}</button></div></main>;
}
