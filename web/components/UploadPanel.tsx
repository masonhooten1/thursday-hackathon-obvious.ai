"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";

interface UploadPanelProps {
  onPhotoSelected: (file: File) => void;
}

/**
 * The single entry affordance: one dropzone that opens the file picker on
 * click, accepts dropped photos, and prefers the camera on touch devices
 * (capture="environment"). Zero instructions needed.
 */
export default function UploadPanel({ onPhotoSelected }: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [cameraFirst, setCameraFirst] = useState(false);

  useEffect(() => {
    // Camera-first on touch devices only; the SSR/default render is picker-first.
    setCameraFirst(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  const openPicker = () => inputRef.current?.click();

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) onPhotoSelected(file);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onPhotoSelected(file);
    event.target.value = ""; // allow re-picking the same file later
  };

  return (
    <section className="upload-state" aria-label="Upload a plant photo">
      <button
        type="button"
        className={`dropzone${dragActive ? " dropzone-active" : ""}`}
        data-testid="upload-affordance"
        onClick={openPicker}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        <span className="dropzone-icon" aria-hidden="true">
          🌿
        </span>
        <span className="upload-headline">Drop a plant photo here</span>
        <span className="upload-hint">
          {cameraFirst ? "or tap to take one with your camera" : "or click to choose a photo"}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture={cameraFirst ? "environment" : undefined}
        className="visually-hidden-input"
        data-testid="file-input"
        aria-label="Choose a plant photo"
        onChange={handleInputChange}
      />
    </section>
  );
}
