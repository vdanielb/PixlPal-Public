/** Contact for privacy and terms questions. */
export const LEGAL_CONTACT_EMAIL = "contact@pixlpal.com";

/** ISO date shown at the top of the Privacy Policy. */
export const PRIVACY_UPDATED_ISO = "2026-08-30";

/** ISO date shown at the top of the Terms of Service. */
export const TERMS_UPDATED_ISO = "2026-08-30";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Render an ISO calendar date as "August 26, 2026". */
export function formatLegalDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}
