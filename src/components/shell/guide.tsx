"use client";

import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { installable, usePlatform, type Platform } from "@/components/pwa/platform";
import { InstallSteps } from "@/components/pwa/install-steps";
import { useProgressRouter } from "@/components/shell/route-progress";
import { Button } from "@/components/ui/button";
import { GUIDES, guideStepId, type Guide, type GuideId, type GuideStep } from "@/lib/domain/guides";
import { useEscape } from "@/lib/ui/escape";
import { usePhone } from "@/lib/ui/media";
import { cn } from "@/lib/ui/utils";
import { useRole } from "./role-context";

export type GuideHold = "nav" | "account" | "phone-menu" | null;

const Ctx = createContext<{
  pageGuide: Guide | null;
  start: (id: GuideId) => void;
  hold: GuideHold;
}>({ pageGuide: null, start: () => {}, hold: null });

export const useGuides = () => useContext(Ctx);

const WAIT_MS = 5000;

function findTarget(name: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    if (el.checkVisibility({ visibilityProperty: true })) return el;
  }
  return null;
}

const settled = () => document.querySelector("[data-tour-page]") !== null;

function present(step: GuideStep): boolean {
  if (!step.target || step.opens === "account" || step.orCentre) return true;
  if (step.opens) return document.querySelector(`[data-tour="${step.target}"]`) !== null;
  return findTarget(step.target) !== null;
}

const PAD = 6;
const GAP = 12;
const EDGE = 16;
const SHEET_EDGE = 12;
const BAR_ROOM = 16;

function coveredEdges(): { top: number; bottom: number } {
  let top = 0;
  let bottom = 0;
  for (const el of document.querySelectorAll<HTMLElement>("[data-guide-edge]")) {
    if (!el.checkVisibility()) continue;
    const r = el.getBoundingClientRect();
    if (el.dataset.guideEdge === "top") top = Math.max(top, r.bottom);
    else bottom = Math.max(bottom, window.innerHeight - r.top);
  }
  return { top, bottom };
}

function bringUp(el: HTMLElement) {
  if (el.closest("[data-guide-edge]")) return;
  const { top, bottom } = coveredEdges();
  const r = el.getBoundingClientRect();
  const clear = r.top >= top + BAR_ROOM && r.bottom <= window.innerHeight - bottom - BAR_ROOM;
  if (clear && r.bottom <= window.innerHeight * 0.55) return;
  el.style.scrollMarginTop = `${top + BAR_ROOM}px`;
  el.style.scrollMarginBottom = `${bottom + BAR_ROOM}px`;
  el.scrollIntoView({ block: "start", inline: "nearest", behavior: "auto" });
  el.style.scrollMarginTop = "";
  el.style.scrollMarginBottom = "";
}

type Box = { top: number; left: number; width: number; height: number };

function placeCard(
  spot: Box | null,
  card: { width: number; height: number },
  view: { width: number; height: number },
): { top: number; left: number } {
  const clamp = (v: number, max: number) => Math.max(EDGE, Math.min(v, max));
  const maxLeft = view.width - EDGE - card.width;
  const maxTop = view.height - EDGE - card.height;
  if (!spot)
    return {
      top: clamp((view.height - card.height) / 2, maxTop),
      left: clamp((view.width - card.width) / 2, maxLeft),
    };

  const below = spot.top + spot.height + GAP;
  const above = spot.top - GAP - card.height;
  const top = below <= maxTop ? below : above >= EDGE ? above : maxTop;
  return { top: clamp(top, maxTop), left: clamp(spot.left, maxLeft) };
}

function dockCard(
  spot: Box | null,
  card: { height: number },
  view: { height: number },
  safe: { top: number; bottom: number },
): { top: number } {
  const foot = view.height - safe.bottom - SHEET_EDGE - card.height;
  const head = safe.top + SHEET_EDGE;
  if (!spot) return { top: foot };
  const coversFoot = spot.top + spot.height > foot - GAP;
  const coversHead = spot.top < head + card.height + GAP;
  return { top: coversFoot && !coversHead ? head : foot };
}

function clip(b: Box, view: { width: number; height: number }): Box {
  const top = Math.max(b.top, 0);
  const left = Math.max(b.left, 0);
  const bottom = Math.min(b.top + b.height, view.height);
  const right = Math.min(b.left + b.width, view.width);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function readSafeArea(): { top: number; bottom: number } {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const safe = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  probe.remove();
  return safe;
}

type Run = { guide: Guide; steps: GuideStep[]; index: number; dir: 1 | -1; fresh: boolean };

export function GuideProvider({
  seen: initial,
  children,
}: {
  seen: string[];
  children: React.ReactNode;
}) {
  const { user } = useRole();
  const pathname = usePathname();
  const router = useProgressRouter();
  const phone = usePhone();
  const platform = usePlatform();
  const pageGuide = GUIDES.find((g) => g.page === pathname) ?? null;

  const [seen, setSeen] = useState(() => new Set(initial));
  const [run, setRun] = useState<Run | null>(null);
  const [want, setWant] = useState<{ id: GuideId; from: string } | null>(null);
  const wanted = want?.id ?? null;
  const [ready, setReady] = useState<{ index: number; target: HTMLElement | null } | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const start = (id: GuideId) => {
    const guide = GUIDES.find((g) => g.id === id);
    if (!guide) return;
    setWant({ id, from: pathname });
    if (guide.page !== pathname) router.push(guide.page);
  };

  const end = () => {
    if (!run) return;
    const ids = run.steps.map((s) => guideStepId(run.guide, s)).filter((id) => !seen.has(id));
    setRun(null);
    setReady(null);
    returnFocus.current?.focus({ preventScroll: true });
    if (ids.length === 0) return;
    setSeen((s) => new Set([...s, ...ids]));
    fetch("/api/profile/guides", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steps: ids }),
    }).catch(() => {});
  };

  const move = (dir: 1 | -1) => {
    if (!run) return;
    const index = run.index + dir;
    if (index >= run.steps.length) return end();
    setReady(null);
    setRun(index < 0 ? { ...run, index: 0, dir: 1 } : { ...run, index, dir });
  };

  if (want && pathname !== want.from && pathname !== GUIDES.find((g) => g.id === want.id)?.page) {
    setWant(null);
  }

  if (run && run.guide.page !== pathname) {
    setRun(null);
    setReady(null);
  }

  const begin = useEffectEvent((guide: Guide) => {
    if (wanted && wanted !== guide.id) return;
    const asked = wanted === guide.id;
    setWant(null);
    const theirs = guide.steps.filter(
      (s) =>
        (s.visible?.(user) ?? true) &&
        (s.device !== "installable" || installable(platform)) &&
        present(s),
    );
    const steps = asked ? theirs : theirs.filter((s) => !seen.has(guideStepId(guide, s)));
    if (steps.length === 0) return;
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReady(null);
    setRun({
      guide,
      steps,
      index: 0,
      dir: 1,
      fresh: !asked && guide.steps.some((s) => seen.has(guideStepId(guide, s))),
    });
  });
  useEffect(() => {
    if (run || !pageGuide) return;
    const since = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const wait = () => {
      if (settled() || Date.now() - since > WAIT_MS) begin(pageGuide);
      else timer = setTimeout(wait, 100);
    };
    timer = setTimeout(wait, 100);
    return () => clearTimeout(timer);
  }, [run, pageGuide, wanted]);

  const skip = useEffectEvent((dir: 1 | -1) => move(dir));

  const reveal = useEffectEvent((el: HTMLElement) => {
    if (phone) return bringUp(el);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
  });

  useEffect(() => {
    if (!run) return;
    const step = run.steps[run.index];
    if (!step.target) return;
    const target = step.target;
    let misses = 0;
    let timer: ReturnType<typeof setTimeout>;
    const look = () => {
      const el = findTarget(target);
      if (el) {
        reveal(el);
        setReady({ index: run.index, target: el });
        return;
      }
      if (++misses >= 3) {
        if (step.orCentre) setReady({ index: run.index, target: null });
        else skip(run.dir);
        return;
      }
      timer = setTimeout(look, 100);
    };
    look();
    return () => clearTimeout(timer);
  }, [run]);

  useEscape(run !== null, end);

  const step = run?.steps[run.index];
  const shown =
    !run || !step
      ? null
      : !step.target
        ? { target: null }
        : ready?.index === run.index
          ? ready
          : null;
  const hold: GuideHold = step?.opens ? (phone ? "phone-menu" : step.opens) : null;

  return (
    <Ctx.Provider value={{ pageGuide, start, hold }}>
      {children}
      {run &&
        createPortal(
          <GuideLayer
            run={run}
            phone={phone}
            platform={platform}
            target={shown ? shown.target : undefined}
            onNext={() => move(1)}
            onBack={() => move(-1)}
            onSkip={end}
          />,
          document.body,
        )}
    </Ctx.Provider>
  );
}

function GuideLayer({
  run,
  phone,
  platform,
  target,
  onNext,
  onBack,
  onSkip,
}: {
  run: Run;
  phone: boolean;
  platform: Platform;
  target: HTMLElement | null | undefined;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const t = useTranslations("guides");
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState({ width: 320, height: 180 });
  const [view, setView] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const [safe] = useState(readSafeArea);
  const [spot, setSpot] = useState<{ box: Box; for: HTMLElement | null }>(() => ({
    box: centre(window.innerWidth, window.innerHeight),
    for: null,
  }));

  useEffect(() => {
    let frame = 0;
    const same = (a: Box, b: Box) =>
      a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
    const follow = () => {
      if (target !== undefined) {
        const r = target?.getBoundingClientRect();
        const box = r
          ? clip(
              {
                top: r.top - PAD,
                left: r.left - PAD,
                width: r.width + PAD * 2,
                height: r.height + PAD * 2,
              },
              { width: window.innerWidth, height: window.innerHeight },
            )
          : centre(window.innerWidth, window.innerHeight);
        setSpot((s) => (s.for === target && same(s.box, box) ? s : { box, for: target }));
      }
      setView((v) =>
        v.width === window.innerWidth && v.height === window.innerHeight
          ? v
          : { width: window.innerWidth, height: window.innerHeight },
      );
      const el = card.current;
      if (el) {
        setSize((z) =>
          z.width === el.offsetWidth && z.height === el.offsetHeight
            ? z
            : { width: el.offsetWidth, height: el.offsetHeight },
        );
      }
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  const ready = target !== undefined && spot.for === target;
  useLayoutEffect(() => {
    if (ready) next.current?.focus({ preventScroll: true });
  }, [ready, run.index]);

  useEffect(() => {
    if (target === undefined) return;
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select")) return;
      if (e.key === "ArrowRight") onNext();
      else if (e.key === "ArrowLeft" && run.index > 0) onBack();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [target, run.index, onNext, onBack]);

  const step = run.steps[run.index];
  const total = run.steps.length;
  const last = run.index === total - 1;
  const lit = spot.for ? spot.box : null;
  const place = phone ? dockCard(lit, size, view, safe) : placeCard(lit, size, view);

  return (
    <div className="fixed inset-0 z-[220] max-md:touch-none print:hidden">
      <div
        aria-hidden
        style={{
          ...spot.box,
          boxShadow: `0 0 0 2px ${lit ? "var(--color-action-from)" : "transparent"}, 0 0 0 9999px rgb(0 0 0 / 0.45)`,
        }}
        className="pointer-events-none absolute rounded-control transition-[top,left,width,height,box-shadow] duration-300 ease-[var(--ease-out-quint)]"
      />

      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-title"
        aria-describedby="guide-body"
        aria-hidden={!ready}
        inert={!ready}
        style={place}
        className={cn(
          "absolute w-80 max-w-[calc(100vw-2rem)] rounded-panel border border-border bg-background p-4 shadow-[var(--shadow-pop)]",
          "max-md:inset-x-3 max-md:w-auto max-md:max-w-none",
          ready
            ? "pointer-events-auto transition-[top,left,opacity] duration-300 ease-[var(--ease-out-quint)]"
            : "opacity-0",
        )}
      >
        <p className="text-xs text-muted">
          {t(run.fresh ? "progressNew" : "progress", { n: run.index + 1, total })}
        </p>
        <h2 id="guide-title" className="mt-1 text-base font-semibold">
          {t(`${run.guide.id}.${step.key}.title`)}
        </h2>
        <p id="guide-body" className="mt-1.5 text-sm">
          {t(`${run.guide.id}.${step.key}.body`)}
        </p>
        {step.content === "install" && <InstallSteps platform={platform} />}
        <div className="mt-4 flex items-center gap-2">
          {!last && (
            <Button variant="quiet" onClick={onSkip}>
              {t("skip")}
            </Button>
          )}
          <span className="flex-1 max-md:hidden" />
          {run.index > 0 && (
            <Button variant="secondary" onClick={onBack} className="max-md:flex-1">
              {t("back")}
            </Button>
          )}
          <Button ref={next} onClick={last ? onSkip : onNext} className="max-md:flex-1">
            {last ? t("done") : t("next")}
          </Button>
        </div>
      </div>
    </div>
  );
}

const centre = (width: number, height: number): Box => ({
  top: height / 2,
  left: width / 2,
  width: 0,
  height: 0,
});
