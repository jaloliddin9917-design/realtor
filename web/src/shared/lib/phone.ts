/** +998908112437 → +998 90 811 24 37; anything that is not an Uzbek E.164 number is returned unchanged. */
export function formatPhone(identifier: string): string {
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(identifier);
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : identifier;
}
