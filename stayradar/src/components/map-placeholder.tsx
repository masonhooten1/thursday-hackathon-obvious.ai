/**
 * Map region placeholder — MapLibre GL + OpenStreetMap tiles arrive with the
 * traveler-UX task; this keeps the two-column layout honest in the meantime.
 */
export function MapPlaceholder({ className = "" }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="Map placeholder"
      className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-stone-300 bg-stone-100 text-center ${className}`}
    >
      <p className="text-sm font-medium text-stone-500">Map view coming soon</p>
      <p className="max-w-56 text-xs text-stone-400">
        MapLibre GL over OpenStreetMap tiles lands with the traveler-UX task
      </p>
    </div>
  );
}
