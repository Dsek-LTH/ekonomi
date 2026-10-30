"use client";

// Cropping a new profile picture before it is uploaded: the photo inside a
// round frame, dragged to place and zoomed with the slider (or the wheel, or
// the arrow keys and +/-). What is inside the frame is drawn to a 512px square
// here and sent; the server makes the stored 256px WebP of it
// (api/profile/avatar).
//
// The crop is done in the browser because that is where the photo already is.
// Sending the original and a rectangle would upload a phone photo of several
// megabytes to keep a few hundred kilobytes of it.
//
// A photo the browser cannot draw (HEIC outside Safari) cannot be cropped
// here. It can still be sent as it is, and the server takes the middle square.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useMutation } from "@/components/shell/use-mutation";

// The frame, in CSS px. The picture under it is placed in the same units.
const VIEW = 280;
// What is sent: twice the stored size, so the server's downscale is clean.
const OUT = 512;
const MAX_ZOOM = 4;

type Placement = { zoom: number; x: number; y: number };

export function AvatarDialog({ file, onClose }: { file: File; onClose: () => void }) {
  const t = useTranslations("profile.avatar");
  const { pending, mutate } = useMutation();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [broken, setBroken] = useState(false);
  const [at, setAt] = useState<Placement>({ zoom: 1, x: 0, y: 0 });
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      setImg(el);
      // Centred, at the smallest size that still fills the frame.
      const s = VIEW / Math.min(el.naturalWidth, el.naturalHeight);
      setAt({ zoom: 1, x: (VIEW - el.naturalWidth * s) / 2, y: (VIEW - el.naturalHeight * s) / 2 });
    };
    el.onerror = () => setBroken(true);
    el.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // px of frame per px of photo at zoom 1: the photo's short side fills it.
  const base = img ? VIEW / Math.min(img.naturalWidth, img.naturalHeight) : 1;

  // Kept covering the frame: never so far over that an edge of the photo shows
  // inside the circle's square.
  const clamp = useCallback(
    (p: Placement): Placement => {
      if (!img) return p;
      const zoom = Math.min(MAX_ZOOM, Math.max(1, p.zoom));
      const w = img.naturalWidth * base * zoom;
      const h = img.naturalHeight * base * zoom;
      return {
        zoom,
        x: Math.min(0, Math.max(VIEW - w, p.x)),
        y: Math.min(0, Math.max(VIEW - h, p.y)),
      };
    },
    [img, base],
  );

  // Zoomed about the frame's centre, so what you are looking at stays put.
  // Handed the zoom it is going from, so the wheel listener below needs no
  // copy of it of its own.
  const zoomTo = useCallback(
    (zoom: number | ((from: number) => number)) =>
      setAt((p) => {
        const next = Math.min(MAX_ZOOM, Math.max(1, typeof zoom === "function" ? zoom(p.zoom) : zoom));
        const k = next / p.zoom;
        const c = VIEW / 2;
        return clamp({ zoom: next, x: c - (c - p.x) * k, y: c - (c - p.y) * k });
      }),
    [clamp],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    drag.current = { id: d.id, x: e.clientX, y: e.clientY };
    setAt((p) => clamp({ ...p, x: p.x + dx, y: p.y + dy }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 10;
    const move: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    if (move[e.key]) {
      e.preventDefault();
      const [dx, dy] = move[e.key];
      setAt((p) => clamp({ ...p, x: p.x + dx, y: p.y + dy }));
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomTo((z) => z + 0.2);
    } else if (e.key === "-") {
      e.preventDefault();
      zoomTo((z) => z - 0.2);
    }
  };

  // The wheel zooms rather than scrolls the dialog. A native listener, since
  // React's is passive and cannot cancel the scroll.
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = frame.current;
    if (!el || !img) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomTo((z) => z * Math.exp(-e.deltaY / 500));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [img, zoomTo]);

  const upload = async (body: Blob) => {
    const form = new FormData();
    form.append("file", body, "avatar");
    const ok = await mutate("/api/profile/avatar", {
      key: "avatar",
      method: "PUT",
      body: form,
      success: t("saved"),
      error: t("saveFailed"),
    });
    if (ok) onClose();
  };

  const save = async () => {
    if (!img) return upload(file);
    const scale = base * at.zoom;
    const canvas = document.createElement("canvas");
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return upload(file);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, -at.x / scale, -at.y / scale, VIEW / scale, VIEW / scale, 0, 0, OUT, OUT);
    // PNG, so a transparent picture keeps its transparency on the way.
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    await upload(blob ?? file);
  };

  const scale = base * at.zoom;

  return (
    <Modal label={t("title")} onClose={onClose} className="sm:max-w-md">
      <ModalHeader title={t("title")} subtitle={broken ? undefined : t("hint")} />
      <ModalBody>
        {broken ? (
          <p className="text-sm text-muted">{t("cannotPreview")}</p>
        ) : (
          <div className="flex flex-col items-center gap-5">
            {/* Focusable and keyed: the arrows move the picture and +/- zoom
                it, so the crop does not need a pointer. No ARIA role is a
                draggable 2D frame, which is what the rule is asking for. */}
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
            <div
              ref={frame}
              role="application"
              aria-label={t("frameLabel")}
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
              tabIndex={0}
              onKeyDown={onKeyDown}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className="relative cursor-grab touch-none select-none overflow-hidden rounded-control bg-surface outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
              style={{ width: VIEW, height: VIEW }}
            >
              {img && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={img.src}
                  alt=""
                  draggable={false}
                  className="pointer-events-none absolute left-0 top-0 max-w-none origin-top-left"
                  style={{
                    width: img.naturalWidth,
                    height: img.naturalHeight,
                    transform: `translate(${at.x}px, ${at.y}px) scale(${scale})`,
                  }}
                />
              )}
              {/* The round frame: everything outside the circle dimmed, so
                  the square corners that are cut off read as cut off. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_rgb(0_0_0/0.45)] ring-2 ring-white/80"
              />
            </div>
            <label className="flex w-full items-center gap-3 text-sm text-muted">
              <span className="shrink-0">{t("zoom")}</span>
              <input
                type="range"
                min={1}
                max={MAX_ZOOM}
                step={0.01}
                value={at.zoom}
                disabled={!img}
                onChange={(e) => zoomTo(Number(e.target.value))}
                className="w-full accent-[var(--color-action-to)]"
              />
            </label>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <span />
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={save} loading={pending === "avatar"} disabled={!img && !broken}>
            {broken ? t("useAnyway") : t("save")}
          </Button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
