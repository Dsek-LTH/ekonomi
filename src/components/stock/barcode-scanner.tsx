"use client";

// Reads a barcode with the browser's `BarcodeDetector` where there is one, else the same interface as WASM,
// imported lazily so only browsers without it (Firefox, Safari) download it.
// The field also takes a typed code, which is what a handheld reader does (a keyboard that types digits and Enter).
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { IconCameraFlip } from "@/components/ui/icons";
import { Modal, ModalHeader } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/ui/utils";

/** The slice of the API this uses. Not in lib.dom yet. */
type Detector = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};
type DetectorCtor = new (opts?: { formats?: string[] }) => Detector;

/** Which camera to open: by side (a phone picks its own lens) or by device (a laptop with several webcams has no sides). */
type Choice =
  { kind: "side"; side: "user" | "environment"; exact: boolean } | { kind: "device"; id: string };

/** EAN-13 on a bottle, EAN-8 on something small, UPC on an import. */
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

/** Something that can read a barcode. The fallback is imported only when the native detector is missing. */
async function detectorFor(formats: string[]): Promise<Detector> {
  const native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (native) return new native({ formats });
  const { BarcodeDetector } = await import("barcode-detector/ponyfill");
  return new BarcodeDetector({ formats: formats as never }) as Detector;
}

/** Reads a barcode by camera where there is one, plus an always-present field for typed or handheld-reader input. */
export function BarcodeScanner({
  onCode,
  onCancel,
}: {
  onCode: (ean: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("stock");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [typedCode, setTypedCode] = useState("");
  /** Mirrors the picture unless the camera explicitly faces away. Display only: `detect` reads the real pixels, and a mirrored barcode does not scan. */
  const [mirrored, setMirrored] = useState(false);
  /**
   * `choice` asks for the far side without `exact`, so a laptop with no sides still opens. `active` is what the browser
   * actually gave (a ref, since only the flip handler reads it). `cameras` is read after the stream is up, because
   * `enumerateDevices` strips ids and labels before a camera is granted.
   */
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [choice, setChoice] = useState<Choice>({
    kind: "side",
    side: "environment",
    exact: false,
  });
  const active = useRef<{ deviceId?: string; label?: string; side?: "user" | "environment" }>({});

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let done = false;

    const stop = () => {
      done = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };

    void (async () => {
      // Cameras need a secure origin (https or localhost): over plain http `navigator.mediaDevices` is undefined, so check first to name the fix.
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError(t("scan.needsHttps"));
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // `exact` on a flip, or the browser may treat it as a preference and return the camera already running.
          // The opening request is the exception, so a machine with no far side still gets a picture.
          video:
            choice.kind === "device"
              ? { deviceId: { exact: choice.id } }
              : { facingMode: choice.exact ? { exact: choice.side } : choice.side },
        });
        if (done) return void stream.getTracks().forEach((track) => track.stop());
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const track = stream.getVideoTracks()[0];
        const settings = track?.getSettings();
        // The side this camera faces, read from the track rather than assumed from the request.
        const side =
          settings?.facingMode === "user" || settings?.facingMode === "environment"
            ? settings.facingMode
            : undefined;
        setMirrored(side !== "environment");
        active.current = { deviceId: settings?.deviceId, label: track?.label, side };
        setReady(true);
        // Ids and labels are only filled in once a camera has been granted.
        void navigator.mediaDevices
          .enumerateDevices()
          .then((devices) => {
            if (!done) setCameras(devices.filter((d) => d.kind === "videoinput"));
          })
          .catch(() => {});
      } catch (e) {
        // A flipped choice may not exist (stale id, no camera on that side): fall back to the opening request, which cannot loop.
        if (choice.kind === "device" || choice.exact) {
          setChoice({ kind: "side", side: "environment", exact: false });
          return;
        }
        const name = e instanceof DOMException ? e.name : "";
        setError(
          name === "NotAllowedError" || name === "SecurityError"
            ? t("scan.noPermission")
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? t("scan.noCameraFound")
              : t("scan.noCamera"),
        );
        return;
      }

      // Fetched here so a browser with its own detector downloads nothing.
      let detector: Detector;
      try {
        detector = await detectorFor(FORMATS);
      } catch {
        setError(t("scan.noReader"));
        return;
      }
      if (done) return;

      const tick = async () => {
        if (done) return;
        const video = videoRef.current;
        if (video && video.readyState >= 2) {
          try {
            const [hit] = await detector.detect(video);
            if (hit?.rawValue) {
              stop();
              onCode(hit.rawValue);
              return;
            }
          } catch {
            // A frame that will not decode is the normal case, not an error.
          }
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    })();

    return stop;
    // Only the chosen camera re-runs this: the callbacks stay out so they cannot drop the camera mid-scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice]);

  /** The other camera: by side where the running camera reports one, else by device (stepping devices walks between rear lenses on a phone). */
  const nextCamera = (): Choice | null => {
    const { side, deviceId, label } = active.current;
    if (side) {
      return {
        kind: "side",
        side: side === "environment" ? "user" : "environment",
        exact: true,
      };
    }
    if (cameras.length < 2) return null;
    const at = cameras.findIndex(
      (c) => (!!c.deviceId && c.deviceId === deviceId) || (!!c.label && c.label === label),
    );
    return { kind: "device", id: cameras[(at + 1) % cameras.length].deviceId };
  };

  const flip = () => {
    // Worked out before any reset: an early return past `setReady` would leave the frame spinning.
    const next = nextCamera();
    if (!next) return;
    // Reset here, not in the effect body (a synchronous setState there cascades renders). The frame shows the spinner until the other camera answers.
    setReady(false);
    setError(null);
    setChoice(next);
  };

  const submit = () => {
    const code = typedCode.trim();
    if (code) onCode(code);
  };

  return (
    <Modal label={t("scan.title")} onClose={onCancel} className="max-w-md">
      <ModalHeader title={t("scan.title")} subtitle={t("scan.subtitle")} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-inset py-4">
        <div
          className={cn(
            "relative overflow-hidden rounded-panel border border-border bg-black",
            error && "hidden",
          )}
        >
          {/* muted + playsInline, or iOS refuses to play it inline at all. */}
          <video
            ref={videoRef}
            muted
            playsInline
            className="aspect-[4/3] w-full object-cover"
            style={mirrored ? { transform: "scaleX(-1)" } : undefined}
          />
          {!ready && !error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Spinner size="lg" className="text-white/80" />
            </div>
          )}
          {cameras.length > 1 && (
            <button
              type="button"
              onClick={flip}
              disabled={!ready}
              aria-label={t("scan.flip")}
              title={t("scan.flip")}
              className="absolute right-2 top-2 rounded-control bg-black/50 p-2 text-white backdrop-blur transition hover:bg-black/70 disabled:opacity-40"
            >
              <IconCameraFlip className="size-5" />
            </button>
          )}
          {ready && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-control border-2 border-white/70"
            />
          )}
        </div>

        {error ? (
          <p className="text-xs text-warning">{error}</p>
        ) : (
          <p className="text-xs text-muted">{t("scan.hint")}</p>
        )}

        {/* Autofocused so a handheld reader needs no click first. */}
        <Field label={t("scan.code")} hint={t("scan.codeHint")}>
          <Input
            value={typedCode}
            onChange={(e) => setTypedCode(e.target.value.replace(/[^0-9]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            inputMode="numeric"
            autoFocus
            className="tabular-nums"
            placeholder="7312040017072"
          />
        </Field>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border px-inset py-3">
        <Button variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button onClick={submit} disabled={typedCode.trim() === ""}>
          {t("scan.look")}
        </Button>
      </div>
    </Modal>
  );
}
