// The probe's active window, as absolute epoch milliseconds. Both 0 = closed (the committed default).
// The go-live commit sets FROM to a future instant (after the deploy has been confirmed) and UNTIL = FROM + 15 min,
// so deploy lag cannot eat into the window and the window closes by itself without another deploy.
export const ACTIVE_FROM_MS = 0;
export const ACTIVE_UNTIL_MS = 0;
export const WINDOW_MS = 15 * 60_000;
