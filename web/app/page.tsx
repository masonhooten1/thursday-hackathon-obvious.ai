// Scaffold placeholder for the identify screen. The four real states
// (upload, identifying, results, low-confidence) arrive with the UI PR.
export default function IdentifyPage() {
  return (
    <main className="identify-screen">
      <h1>Plant ID</h1>
      <p className="tagline">Point a camera at a plant, get its name.</p>
      <section className="identify-panel" aria-label="Identify a plant">
        <button type="button" data-testid="upload-affordance" disabled>
          <span className="upload-headline">Drop a plant photo here</span>
          <span className="upload-hint">
            Photo upload and camera capture arrive with the identify API
          </span>
        </button>
      </section>
    </main>
  );
}
