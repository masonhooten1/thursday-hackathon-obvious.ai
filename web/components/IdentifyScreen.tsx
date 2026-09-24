"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createIdentifyClient, isAbortError } from "@/lib/api/client";
import type { IdentifyClient } from "@/lib/api/client";
import { IdentifyError } from "@/lib/api/types";
import type { IdentifyResponse } from "@/lib/api/types";
import { describeImageProblem } from "@/lib/image-limits";
import ErrorPanel from "./ErrorPanel";
import IdentifyingPanel from "./IdentifyingPanel";
import ResultsPanel from "./ResultsPanel";
import UploadPanel from "./UploadPanel";

interface Photo {
  file: File;
  url: string;
}

type Phase =
  | { kind: "upload" }
  | { kind: "identifying"; photo: Photo }
  | { kind: "results"; photo: Photo; response: IdentifyResponse }
  | { kind: "low-confidence"; photo: Photo; response: IdentifyResponse }
  | { kind: "error"; photo: Photo | null; heading: string; detail: string };

interface IdentifyScreenProps {
  /** Injectable identify client; defaults to the env-selected real one. */
  client?: IdentifyClient;
}

function describeIdentifyFailure(error: unknown): { heading: string; detail: string } {
  if (error instanceof IdentifyError) {
    if (error.status === 413) {
      return {
        heading: "Photo too large",
        detail: "Photos must be under 10 MB. Choose a smaller image and try again.",
      };
    }
    if (error.status === 415) {
      return {
        heading: "That file isn't an image",
        detail: "Choose a photo of the plant — JPEG, PNG, or WebP all work.",
      };
    }
    return {
      heading: "Identification failed",
      detail: "The identification service returned an error. Try again in a moment.",
    };
  }
  return {
    heading: "Connection problem",
    detail: "We couldn't reach the identification service. Check your connection and try again.",
  };
}

export default function IdentifyScreen({ client }: IdentifyScreenProps) {
  const identifyClient = client ?? createIdentifyClient();
  const [phase, setPhase] = useState<Phase>({ kind: "upload" });
  const abortRef = useRef<AbortController | null>(null);
  const activePhotoUrlRef = useRef<string | null>(null);

  const releaseActivePhoto = useCallback(() => {
    if (activePhotoUrlRef.current !== null) {
      URL.revokeObjectURL(activePhotoUrlRef.current);
      activePhotoUrlRef.current = null;
    }
  }, []);

  // Revoke the object URL when the screen unmounts with a photo still active.
  useEffect(() => releaseActivePhoto, [releaseActivePhoto]);

  const startIdentification = useCallback(
    (photo: Photo) => {
      const controller = new AbortController();
      abortRef.current = controller;
      activePhotoUrlRef.current = photo.url;
      setPhase({ kind: "identifying", photo });
      identifyClient.identify(photo.file, controller.signal).then(
        (response) => {
          abortRef.current = null;
          if (controller.signal.aborted) return; // cancel already returned to upload
          setPhase(
            response.low_confidence
              ? { kind: "low-confidence", photo, response }
              : { kind: "results", photo, response },
          );
        },
        (error: unknown) => {
          abortRef.current = null;
          if (controller.signal.aborted || isAbortError(error)) return;
          setPhase({ kind: "error", photo, ...describeIdentifyFailure(error) });
        },
      );
    },
    [identifyClient],
  );

  const selectPhoto = useCallback(
    (file: File) => {
      const problem = describeImageProblem(file);
      if (problem) {
        setPhase({ kind: "error", photo: null, heading: problem.heading, detail: problem.detail });
        return;
      }
      releaseActivePhoto();
      const photo: Photo = { file, url: URL.createObjectURL(file) };
      startIdentification(photo);
    },
    [releaseActivePhoto, startIdentification],
  );

  const cancelIdentification = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    releaseActivePhoto();
    setPhase({ kind: "upload" });
  }, [releaseActivePhoto]);

  const backToUpload = useCallback(() => {
    releaseActivePhoto();
    setPhase({ kind: "upload" });
  }, [releaseActivePhoto]);

  return (
    <section className="identify-panel" aria-label="Identify a plant">
      {phase.kind === "upload" && <UploadPanel onPhotoSelected={selectPhoto} />}
      {phase.kind === "identifying" && (
        <IdentifyingPanel photoUrl={phase.photo.url} onCancel={cancelIdentification} />
      )}
      {(phase.kind === "results" || phase.kind === "low-confidence") && (
        <ResultsPanel
          response={phase.response}
          lowConfidence={phase.kind === "low-confidence"}
          onTryAgain={() => startIdentification(phase.photo)}
          onIdentifyAnother={backToUpload}
        />
      )}
      {phase.kind === "error" && (
        <ErrorPanel
          photoUrl={phase.photo?.url ?? null}
          heading={phase.heading}
          detail={phase.detail}
          onTryAgain={() => (phase.photo ? startIdentification(phase.photo) : backToUpload())}
        />
      )}
    </section>
  );
}
