"use client";

// The guides' engine: walks a page's guide from lib/domain/guides.ts step by
// step, dimming the page around the control a step is about and putting its
// card beside it. See docs/guides.md.
//
// It points and explains, and nothing else. The page under it is covered for
// as long as a guide runs, so a stray click cannot submit or delete anything.
// A guide stays on its page: nothing in one navigates, and the reader leaving
// (Back, say) ends it. The only thing it opens is a menu, to show what is in it.
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

/** What the running step wants held open. On a phone the nav and the account
 *  menu are the one menu screen. */
export type GuideHold = "nav" | "account" | "phone-menu" | null;

const Ctx = createContext<{
  /** The open page's own guide, when it has one. */
  pageGuide: Guide | null;
  start: (id: GuideId) => void;
  hold: GuideHold;
}>({ pageGuide: null, start: () => {}, hold: null });

/** The way to start a guide (the account menu), and what a step holds open (the shell). */
export const useGuides = () => useContext(Ctx);

// The longest a guide waits for its page before deciding anyway. Normally the
// page says it is there long before, see `settled` below: this is for one that
// never renders a PageShell.
const WAIT_MS = 5000;

/**
 * The first element with this `data-tour` that is on screen. A control drawn
 * once per width (the year in the header and in the phone's top bar) has one
 * copy under `display: none`, and the desktop nav shut is `visibility:
 * hidden`, which still has boxes, hence the visibility check over a box count.
 */
function findTarget(name: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    if (el.checkVisibility({ visibilityProperty: true })) return el;
  }
  return null;
}

/** The page has rendered, rather than its loading skeleton: its PageShell is there. */
const settled = () => document.querySelector("[data-tour-page]") !== null;

/**
 * Whether a step is this reader's, judged before the guide starts. A control
 * the app does not draw for them is not theirs. One inside a menu is drawn
 * while the menu is shut, only out of sight, so being in the document is
 * enough. The account menu draws nothing until it opens, and its theme and
 * language are everybody's. A step that falls back to the middle of the
 * screen is everybody's too: that is what the fallback is for (Frågor & svar,
 * which a phone has no header link to).
 */
function present(step: GuideStep): boolean {
  if (!step.target || step.opens === "account" || step.orCentre) return true;
  if (step.opens) return document.querySelector(`[data-tour="${step.target}"]`) !== null;
  return findTarget(step.target) !== null;
}

// Room around the lit control, between it and the card, and from the window's edge.
const PAD = 6;
const GAP = 12;
const EDGE = 16;
/** A phone's card from the screen's edge, and its lit control from the bars. */
const SHEET_EDGE = 12;
const BAR_ROOM = 16;

/**
 * How much of a phone's screen the app's own bars cover: the top bar and the
 * section's band, and the tab bar at the foot. Each marks itself with
 * `data-guide-edge`. A control scrolled under one of them would be lit through
 * a hole with the bar drawn over it.
 */
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

/**
 * On a phone, the lit control is brought up under the bars, at once, so the
 * card docked at the foot (see `dockCard`) has the lower part of the screen to
 * itself. Left where it is when it is already well up the screen and clear of
 * the bars. At once rather than smoothly, so where the card docks is decided
 * on where the control ends up rather than somewhere on its way. The lit box
 * still slides there, which is its own transition.
 */
function bringUp(el: HTMLElement) {
  // A control on one of the bars (the year, the section's tabs) is always on
  // screen, and scrolling would only move the page under it.
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

/**
 * Where the card goes: under the control if it fits there, over it if not, and
 * in the middle with no control at all. Held inside the window either way.
 */
export function placeCard(
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
  // Neither fits only for a control nearly the window's height, and then the
  // card sits over its foot rather than off screen.
  const top = below <= maxTop ? below : above >= EDGE ? above : maxTop;
  return { top: clamp(top, maxTop), left: clamp(spot.left, maxLeft) };
}

/**
 * Where the card goes on a phone: across the screen, at its foot, or at its
 * head when the foot would cover the lit control and the head would not. A
 * card beside a control, as on a wide screen, had no room on a phone: it sat
 * over the control it was about, or the control was left at the screen's
 * edge with half of it below. Held clear of the home indicator and the clock.
 */
export function dockCard(
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

/** The lit box, cut to the window, so its ring is never drawn off the screen. */
function clip(b: Box, view: { width: number; height: number }): Box {
  const top = Math.max(b.top, 0);
  const left = Math.max(b.left, 0);
  const bottom = Math.min(b.top + b.height, view.height);
  const right = Math.min(b.left + b.width, view.width);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** The status bar's strip and the home indicator's, read off the CSS that knows them. */
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

/**
 * A guide under way: the steps this reader is being shown, which are the
 * guide's own less what is not theirs and, unless they asked for it, less
 * what they have seen. `fresh` is that last case with some seen already, so
 * the card says the steps are new.
 */
type Run = { guide: Guide; steps: GuideStep[]; index: number; dir: 1 | -1; fresh: boolean };

export function GuideProvider({
  seen: initial,
  children,
}: {
  /** The step ids this reader has been shown (User.seenGuideSteps). */
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
  // A guide asked for from the menu, to start once its page is there, and the
  // page it was asked for on.
  const [want, setWant] = useState<{ id: GuideId; from: string } | null>(null);
  const wanted = want?.id ?? null;
  // The step whose target has been looked for, and what was found: the card
  // waits for it rather than standing at the last step's place meanwhile.
  const [ready, setReady] = useState<{ index: number; target: HTMLElement | null } | null>(null);
  // Where the keyboard was, to give it back afterwards.
  const returnFocus = useRef<HTMLElement | null>(null);

  const start = (id: GuideId) => {
    const guide = GUIDES.find((g) => g.id === id);
    if (!guide) return;
    setWant({ id, from: pathname });
    // Asked for, so going to its page is what the reader pressed for.
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
    // Fire and forget, and quietly: steps that come up once more on the next
    // visit are the whole cost of this failing, and a toast saying so would
    // be louder than the guide.
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
    // Back past a left-out first step turns round rather than leaving the guide.
    setRun(index < 0 ? { ...run, index: 0, dir: 1 } : { ...run, index, dir });
  };

  // The way to a guide asked for ended somewhere else (a redirect): the
  // request lapses, rather than holding back every other page's own guide.
  if (want && pathname !== want.from && pathname !== GUIDES.find((g) => g.id === want.id)?.page) {
    setWant(null);
  }

  // Leaving the page ends its guide. Nothing in a guide navigates, so this is
  // the reader going somewhere (Back, a link in a notification). What they
  // were shown comes up again next time, which is better than never.
  if (run && run.guide.page !== pathname) {
    setRun(null);
    setReady(null);
  }

  // Starting: the page's own guide by itself, with what this reader has not
  // seen, or the one asked for from the menu, whole. Decided once the page is
  // there, since which steps are theirs is read off what it draws.
  const begin = useEffectEvent((guide: Guide) => {
    // Another page's guide was asked for, and the way there is under way. The
    // page being left must not start its own meanwhile, or take the request.
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
    // A tick's grace, so a control drawn a commit after its page (the scope
    // switch, portalled into the band) is counted.
    timer = setTimeout(wait, 100);
    return () => clearTimeout(timer);
  }, [run, pageGuide, wanted]);

  // Moving on from inside the search is not a reason to search again, so it
  // reads the latest `move` without depending on it.
  const skip = useEffectEvent((dir: 1 | -1) => move(dir));

  // Into view. On a phone, up under the bars, clear of the card at the foot;
  // elsewhere only as far as it takes. Read when a step starts, so turning the
  // phone on its side mid-step does not send the search round again.
  const reveal = useEffectEvent((el: HTMLElement) => {
    if (phone) return bringUp(el);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
  });

  // Find the step's control.
  useEffect(() => {
    if (!run) return;
    const step = run.steps[run.index];
    // A card in the middle has nothing to look for. See `shown`, below.
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
      // Three ticks, for a menu the step has just had opened to draw itself.
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
  // A step with a target shows once it is found, one without at once.
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
  /** Below md: the card docks across the screen rather than beside the control. */
  phone: boolean;
  platform: Platform;
  /** The lit control, null for a card in the middle, undefined while looking. */
  target: HTMLElement | null | undefined;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const t = useTranslations("guides");
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  // Only ever drawn in the browser (a portal, opened by a guide starting), so
  // the window is there to start from.
  const [size, setSize] = useState({ width: 320, height: 180 });
  const [view, setView] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const [safe] = useState(readSafeArea);
  // The lit box, and which control it was measured for. One box for the whole
  // guide, never taken down between steps, so it can slide from one control
  // to the next. A card in the middle shrinks it to a point there. It starts
  // as that point, so the first control is grown into from the middle.
  const [spot, setSpot] = useState<{ box: Box; for: HTMLElement | null }>(() => ({
    box: centre(window.innerWidth, window.innerHeight),
    for: null,
  }));

  // Measured every frame rather than on scroll and resize alone: a list's rows
  // landing, or the smooth scroll that brought the control into view, move it
  // without either event reaching the window. A few measurements a frame, and
  // a render only when something moved.
  useEffect(() => {
    let frame = 0;
    const same = (a: Box, b: Box) =>
      a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
    const follow = () => {
      // While the next control is being looked for, the box waits where it is.
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

  // The card waits for the box to have been measured for this step's control,
  // or it would appear at the last one's for a frame. The keyboard moves to
  // it then, each step.
  const ready = target !== undefined && spot.for === target;
  useLayoutEffect(() => {
    if (ready) next.current?.focus({ preventScroll: true });
  }, [ready, run.index]);

  // The arrow keys as well as the buttons, outside a field.
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
    // Over everything, dialogs and the portalled menus included (those stop at
    // z-210), and catching every press, so the page under it cannot be used
    // while it is dimmed.
    // On a phone it also takes the touch, so a drag on the dimmed page cannot
    // scroll it out from under the lit control.
    <div className="fixed inset-0 z-[220] max-md:touch-none print:hidden">
      {/* The dim is the lit box's own shadow, spread over the whole window,
          so the control shows through a hole rather than being redrawn. The
          pink edge is a second shadow in the same declaration: a `ring-`
          class is a box-shadow too, and the inline one would replace it.
          Sliding from step to step is the transition on its box. The rows
          under it cannot be scrolled while the guide covers them, so what it
          follows besides is the guide's own scroll into view, and that glides
          as well. */}
      <div
        aria-hidden
        style={{
          ...spot.box,
          boxShadow: `0 0 0 2px ${lit ? "var(--color-action-from)" : "transparent"}, 0 0 0 9999px rgb(0 0 0 / 0.45)`,
        }}
        className="pointer-events-none absolute rounded-control transition-[top,left,width,height,box-shadow] duration-300 ease-[var(--ease-out-quint)]"
      />

      {/* Kept, not taken down between steps, so it can glide after the box.
          Hidden at once while the next control is looked for, so a step that
          turns out to be skipped never shows its words, and faded in with
          the slide when it is found. */}
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
          // Across the screen on a phone, docked by `dockCard`.
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
        {/* On a phone the two that move through the guide share the row's
            width, thumb-sized, and the way out stays a word at the start. */}
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

/** The lit box for a card in the middle: a point at the window's centre. */
const centre = (width: number, height: number): Box => ({
  top: height / 2,
  left: width / 2,
  width: 0,
  height: 0,
});
