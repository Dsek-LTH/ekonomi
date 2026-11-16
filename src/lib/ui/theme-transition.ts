// The theme switch as a wipe. Client-only.
//
// After the wipe in react-native-theme-transition (MIT): the page in the old
// theme is held as one picture over the page already in the new theme, and the
// picture is cut away from the left edge, so the new theme comes in from the
// left and moves right. A hard edge, fast at first and settling at the end.
//
// The styles that go with this are in globals.css, under `.theme-switching`.

const DURATION_MS = 350;
const EASE_OUT_CUBIC = "cubic-bezier(0.33, 1, 0.68, 1)";

// The switch that is playing, if any. A click mid-switch starts a new one, and
// the old one's cleanup must not undo what the new one has set up.
let current: ViewTransition | null = null;

/** Switches the theme by calling `apply`, wiping when the browser can, at once otherwise. */
export function switchTheme(apply: () => void) {
  const root = document.documentElement;
  if (
    typeof document.startViewTransition !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    apply();
    return;
  }

  root.classList.add("theme-switching");
  const transition = document.startViewTransition(apply);
  current = transition;

  transition.ready
    .then(() =>
      root.animate(
        { clipPath: ["inset(0 0 0 0)", "inset(0 0 0 100%)"] },
        {
          duration: DURATION_MS,
          easing: EASE_OUT_CUBIC,
          // Held on the last frame, or the old page comes back whole in the gap
          // before the browser takes the transition down.
          fill: "forwards",
          pseudoElement: "::view-transition-old(root)",
        },
      ),
    )
    .catch(() => {});

  transition.finished.finally(() => {
    if (current !== transition) return;
    current = null;
    root.classList.remove("theme-switching");
  });
}
