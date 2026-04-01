export default function Home() {
  return (
    <div className="min-h-screen bg-grid px-6 py-10 sm:px-10">
      <main className="mx-auto grid w-full max-w-5xl gap-8">
        <section className="rounded-2xl border border-slate-200 bg-white/85 p-7 shadow-[0_15px_40px_-25px_rgba(13,74,122,0.8)] backdrop-blur">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-cyan-700">
            Chrome Extension MVP
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Zoom Recorder
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-700 sm:text-lg">
            This repo now contains a Cursorful-style starter: record the active tab, track
            cursor/click timeline, and export a follow-cursor zoomed video.
          </p>
        </section>

        <section className="grid gap-6 sm:grid-cols-2">
          <article className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-xl font-semibold text-slate-900">Load Extension</h2>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-slate-700">
              <li>Open `chrome://extensions`.</li>
              <li>Enable Developer mode.</li>
              <li>Click Load unpacked.</li>
              <li>Select `extension/` in this project.</li>
            </ol>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-xl font-semibold text-slate-900">Use Flow</h2>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-slate-700">
              <li>Pin the extension and open a tab to record.</li>
              <li>Click extension icon to open recorder page.</li>
              <li>Select screen, then press Start Recording.</li>
              <li>Press Stop Recording when done.</li>
              <li>Download Raw or Render Zoomed Export.</li>
            </ol>
          </article>
        </section>

        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-xl font-semibold text-amber-900">Current MVP Constraints</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-amber-900/90">
            <li>Recorder runs in an extension tab, not inside your app domain.</li>
            <li>Rendering/export runs in-browser, so long videos can be slow.</li>
            <li>Output format is WebM for both raw and zoomed export.</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
