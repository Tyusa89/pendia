/**
 * Feature switches for things that are designed but not built yet.
 *
 * `assistant` reserves the place of the optional AI caregiving assistant (a button in the top bar and the desktop
 * sidebar). It is OFF and nothing renders for it: the app is complete without AI, and this change adds no AI calls,
 * integrations or infrastructure. When the assistant is approved and built, turning this on and giving it a route is
 * the only shell change needed.
 */
export const features = {
  assistant: false,
} as const;
