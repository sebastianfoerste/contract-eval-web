'use client';

export default function PageError({ reset }: { error: Error; reset: () => void }) {
  return <main className="page-error">
    <h1>The lab could not be displayed</h1>
    <p>Something failed while rendering this view. Your choices are in the address bar, so loading the page again restores them.</p>
    <div className="button-row">
      <button className="button" onClick={reset}>Try again</button>
      <button className="button button-quiet" onClick={() => window.location.assign("/")}>Start from the first contract</button>
    </div>
  </main>;
}
