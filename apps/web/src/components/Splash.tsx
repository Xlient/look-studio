export default function Splash({ onEnter }: { onEnter: () => void }) {
  return (
    <main className="splash">
      <div className="splash__card">
        <p className="splash__badge">
          <span className="splash__new">NEW!</span> powered by Meta Muse Spark
        </p>
        <h1 className="splash__title">
          Look<span>Studio</span>
        </h1>
        <p className="splash__tagline">Say it. Wear it. Own every meeting.</p>
        <p className="splash__copy">
          IM your stylist, get a look designed by Meta&apos;s models, then tweak it in plain words like
          &quot;make the crown taller&quot;. Your camera stays in your browser.
        </p>
        <button type="button" className="btn btn--big" onClick={onEnter} autoFocus>
          ▶ Enter the Studio
        </button>
        <p className="splash__fine">best viewed with your webcam on · 800×600 or higher</p>
      </div>
    </main>
  );
}
