/** Monday 00:00 UTC of the week containing `d` (coverage blocks are stored in UTC). */
export function mondayOf(d: Date) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}
