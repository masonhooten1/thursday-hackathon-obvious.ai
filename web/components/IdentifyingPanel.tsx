interface IdentifyingPanelProps {
  photoUrl: string;
  onCancel: () => void;
}

/** Photo stays visible; indeterminate-but-moving progress; cancel always works. */
export default function IdentifyingPanel({ photoUrl, onCancel }: IdentifyingPanelProps) {
  return (
    <section className="identifying-state" aria-live="polite" aria-busy="true">
      <img src={photoUrl} alt="The plant photo being identified" className="identifying-photo" />
      <div className="progress" role="progressbar" aria-label="Identifying plant">
        <div className="progress-fill" />
      </div>
      <p className="identifying-copy">Matching against the reference set…</p>
      <button type="button" className="button-secondary" onClick={onCancel}>
        Cancel
      </button>
    </section>
  );
}
