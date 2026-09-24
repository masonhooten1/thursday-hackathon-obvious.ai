import StatusBanner from "./StatusBanner";

interface ErrorPanelProps {
  photoUrl: string | null;
  heading: string;
  detail: string;
  onTryAgain: () => void;
}

/** Errors reuse the low-confidence layout: banner, photo preserved, retry. */
export default function ErrorPanel({ photoUrl, heading, detail, onTryAgain }: ErrorPanelProps) {
  return (
    <section className="error-state">
      <StatusBanner variant="error" title={heading}>
        {detail}
      </StatusBanner>
      {photoUrl && (
        <img src={photoUrl} alt="The plant photo that failed to identify" className="error-photo" />
      )}
      <button type="button" className="button-primary" onClick={onTryAgain}>
        {photoUrl ? "Try again" : "Choose another photo"}
      </button>
    </section>
  );
}
