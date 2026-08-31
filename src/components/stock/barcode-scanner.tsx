"use client";

// Reading the barcode off a tin, on whatever machine is to hand.
//
// The browser's own `BarcodeDetector` where there is one. Chrome on Android and
// on macOS both have it, and it costs nothing to ship. Everywhere else the same
// interface is fetched as WASM the first time somebody opens the scanner.
//
// That second half was left out at first, on the reasoning that the phone in
// the cellar is an Android and the native API covers it. It does not cover
// Firefox, Zen or Safari, where the camera panel simply never appeared and the
// only way in was typing thirteen digits off the bottom of a tin. A guild does
// not get to choose what its committee installed, so the polyfill is in, but
// lazily, behind a dynamic import that only a browser lacking the real thing
// ever reaches. An Android phone downloads none of it.
//
// A third way in, for neither of those: the field takes a code typed by hand,
// which is also exactly what a handheld reader does. It is a keyboard that
// types digits and presses Enter.
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

/**
 * Which camera to open.
 *
 * Two ways of naming one, because machines disagree about what a camera is. A
 * phone has a side (the world, or your face) and picks its own lens for it. A
 * laptop with a second webcam has no sides at all, only devices. Asking for the
 * wrong one of these is what made flipping take three presses; see `flip`.
 */
type Choice =
  | { kind: "side"; side: "user" | "environment"; exact: boolean }
  | { kind: "device"; id: string };

/** The symbologies a drink actually carries: EAN-13 on a bottle, EAN-8 on
 *  something small, UPC on an import. */
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

/**
 * Something that can read a barcode, whether or not the browser brought one.
 *
 * The native detector is preferred and costs nothing. The fallback is imported
 * only when it is needed, so the WASM never reaches a machine that already has
 * the real thing, and never reaches the initial page load at all.
 */
async function detectorFor(formats: string[]): Promise<Detector> {
  const native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (native) return new native({ formats });
  const { BarcodeDetector } = await import("barcode-detector/ponyfill");
  return new BarcodeDetector({ formats: formats as never }) as Detector;
}

/**
 * Reading a barcode, however this machine can.
 *
 * Two ways in, because the fleet is not one machine. A phone in a cellar reads
 * the code off its camera; a laptop cannot. `BarcodeDetector` is not in Safari
 * or Firefox, and the control used to vanish entirely rather than say so. And a
 * handheld reader on the bar is a keyboard: it types the digits and presses
 * Enter, which is what the field below is for.
 *
 * So the field is always there and the camera joins it when there is one. The
 * caller gets a code and does not have to care which of them found it.
 */
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
  /**
   * Whether to show the picture back to front.
   *
   * A camera pointing at you has to be mirrored or aiming is guesswork: you
   * move the bottle left and the label goes right, because what you are shown
   * is what somebody opposite would see. A camera pointing away from you must
   * not be. You are looking through it at the world, and a mirrored world is
   * the same problem the other way round.
   *
   * Decided from what the browser actually gave us rather than what we asked
   * for. Phones report "environment" for the back camera; a laptop webcam
   * usually reports nothing at all, and a laptop webcam always faces the
   * person, so anything that is not explicitly the far side gets mirrored.
   *
   * The picture only. `detect` is handed the video element and reads its real
   * pixels, so the flip never reaches the decoder, which is just as well,
   * because a mirrored barcode does not scan.
   */
  const [mirrored, setMirrored] = useState(false);
  /**
   * What we asked for, what we got, and what else there is.
   *
   * `choice` starts as the far side, not exactly: the browser is asked to point
   * away and left to choose the lens, which is what puts a phone on its back
   * camera without anyone naming a device, and, unlike an exact constraint,
   * cannot fail on a laptop that has no sides to speak of.
   *
   * `active` is what the browser actually handed over, which is not the same
   * question: we asked for a direction and it opened some camera. A ref because
   * only the flip handler reads it, and making it state would restart the
   * camera in order to record the camera that had just started.
   *
   * `cameras` is read after the stream is up. Before a camera has been granted,
   * `enumerateDevices` returns entries stripped of their ids and labels, so
   * asking earlier would count devices it could not tell apart.
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
      // A camera is only offered on a secure origin: https, or localhost. Over
      // plain http `navigator.mediaDevices` is not merely empty, it is
      // undefined, so the call below fails as a TypeError with nothing in it to
      // report and every cause came out as the same sentence: "check the
      // permission in the browser". Which is a dead end, because on an insecure
      // origin there is no permission to grant and no prompt will ever appear.
      // Asked first so the message can name the one thing that would fix it:
      // the dev server reached over a LAN address is exactly this case.
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError(t("scan.needsHttps"));
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // `exact` on anything a flip chose, or the browser is free to read
          // the request as a preference and hand back the camera already
          // running, which from the outside is a button that does nothing. The
          // opening request is the deliberate exception: it is a preference, so
          // that a machine with no far side still gets a picture.
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
        // The side this camera turned out to face, if it admits to one. That is
        // the difference between the two ways of flipping below, so it is read
        // from the track rather than assumed from what was asked for.
        const side =
          settings?.facingMode === "user" || settings?.facingMode === "environment"
            ? settings.facingMode
            : undefined;
        setMirrored(side !== "environment");
        active.current = { deviceId: settings?.deviceId, label: track?.label, side };
        setReady(true);
        // Only now do the entries carry ids and labels. enumerateDevices
        // withholds both until a camera has been granted, so asking any earlier
        // would count devices it could not tell apart.
        void navigator.mediaDevices
          .enumerateDevices()
          .then((devices) => {
            if (!done) setCameras(devices.filter((d) => d.kind === "videoinput"));
          })
          .catch(() => {
            // No list means no flip button. The scanner itself is unaffected.
          });
      } catch (e) {
        // Anything a flip chose can turn out not to exist: an id goes stale
        // when a webcam is unplugged or a phone renumbers its cameras, and a
        // side that looked available may have no camera on it. Drop back to the
        // opening request rather than reporting a dead scanner. That request is
        // the one case this does not catch, so it cannot loop.
        if (choice.kind === "device" || choice.exact) {
          setChoice({ kind: "side", side: "environment", exact: false });
          return;
        }
        // Each of these sends somebody somewhere different, so they are worth
        // telling apart: a permission to grant, a camera that is not there, or
        // one another app is holding.
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

      // Fetched here rather than at the top of the file: on a browser with its
      // own detector this line resolves immediately and downloads nothing.
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
    // Only the chosen camera re-runs this. Dropping the stream and taking it up
    // again is the whole of what flipping is; anything else in here changing
    // would drop the camera mid-scan, which is why the callbacks stay out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice]);

  /**
   * The other camera, by side where there is one, by device where there is not.
   *
   * Stepping through the device list was the obvious way to write this and the
   * wrong one. A phone does not enumerate two cameras: it enumerates the front
   * one and every rear lens it has (wide, ultra-wide, telephoto, sometimes a
   * depth sensor) so stepping walked between rear lenses that show the same
   * picture, and the front camera arrived on the third press. Asking for the
   * other *side* hands the choice of lens back to the phone, which is the one
   * party here that knows which of its rear cameras is the ordinary one.
   *
   * The device list is still the answer for a laptop with a second webcam,
   * where there is no near and far side of a desk and nothing reports a side at
   * all. So: side if the running camera admits to one, device otherwise.
   */
  const nextCamera = (): Choice | null => {
    const { side, deviceId, label } = active.current;
    if (side) {
      return { kind: "side", side: side === "environment" ? "user" : "environment", exact: true };
    }
    if (cameras.length < 2) return null;
    const at = cameras.findIndex(
      (c) => (!!c.deviceId && c.deviceId === deviceId) || (!!c.label && c.label === label),
    );
    return { kind: "device", id: cameras[(at + 1) % cameras.length].deviceId };
  };

  const flip = () => {
    // Worked out before anything is reset: an early return past a `setReady`
    // would leave the frame spinning over a camera that never restarted.
    const next = nextCamera();
    if (!next) return;
    // Reset here rather than at the top of the effect, which is where it would
    // read more naturally: a synchronous setState in an effect body is a
    // cascading render, and this is the only thing that restarts one anyway.
    // The picture is gone until the other camera answers, so the frame goes
    // back to the spinner, and a message about the last camera stops applying.
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
            "relative overflow-hidden rounded-xl border border-border bg-black",
            // No picture is coming, so the frame that would have held it is a
            // black rectangle sitting over the message explaining why.
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
            {/* Over the picture rather than under it: the frame is already as
                tall as a phone can spare, and a row of controls beneath it
                pushes the typed-code field off the screen, which is the way in
                that always works and the last one to sacrifice. Disabled rather
                than hidden while the next camera comes up, so the frame does
                not jump and a second tap cannot race the first. */}
            {cameras.length > 1 && (
              <button
                type="button"
                onClick={flip}
                disabled={!ready}
                aria-label={t("scan.flip")}
                title={t("scan.flip")}
                className="absolute right-2 top-2 rounded-full bg-black/50 p-2 text-white backdrop-blur transition hover:bg-black/70 disabled:opacity-40"
              >
                <IconCameraFlip className="size-5" />
              </button>
            )}
            {/* A window to aim through. The detector reads the whole frame; this
                is for the person holding the phone, not for the algorithm. */}
            {ready && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 border-white/70"
              />
            )}
        </div>

        {error ? (
          <p className="text-xs text-warning">{error}</p>
        ) : (
          <p className="text-xs text-muted">{t("scan.hint")}</p>
        )}

        {/* Autofocused, so a handheld reader (which is a keyboard that types
            digits and presses Enter) needs nobody to click anything first. */}
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
