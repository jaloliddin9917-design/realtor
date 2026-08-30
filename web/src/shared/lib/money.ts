const DASH = "—";

/** UZS with thin-space thousands; USD as whole dollars. Amounts are minor units (cents / tiyin). */
export function formatMoney(amountMinor: number | null, currency: string | null, locale: string): string {
  if (amountMinor === null || currency === null) return DASH;
  const major = Math.round(amountMinor / 100);
  const grouped = major.toLocaleString("en-US").replace(/,/g, " ");
  if (currency === "USD") return `$${grouped}`;
  if (currency === "UZS") return `${grouped} ${locale === "ru" ? "сум" : "so'm"}`;
  return `${grouped} ${currency}`;
}

export function formatUsdFromMinor(minor: number | null): string {
  return minor === null ? DASH : formatMoney(minor, "USD", "uz");
}
