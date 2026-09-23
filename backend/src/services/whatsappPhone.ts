export function phoneDigits(phone: string): string {
  return String(phone || "")
    .replace(/^whatsapp:/i, "")
    .replace(/\D/g, "");
}

export function canonicalPhone(phone: string): string {
  const raw = String(phone || "")
    .replace(/^whatsapp:/i, "")
    .trim();
  const digits = phoneDigits(raw.startsWith("00") ? raw.slice(2) : raw);
  if (!/^\+?[\d\s().-]+$/.test(raw) || !/^[1-9]\d{7,14}$/.test(digits))
    throw new Error(
      "Enter a valid WhatsApp number including its country code.",
    );
  // A bare local mobile number is ambiguous; never silently prepend a country code.
  if (!raw.startsWith("+") && !raw.startsWith("00") && digits.length <= 10)
    throw new Error(
      "Include the country code, for example +91. Open the incoming conversation to reply to its verified WhatsApp number.",
    );
  return `+${digits}`;
}

export function withinSession(
  lastInboundAt: string | null,
  now = Date.now(),
): boolean {
  if (!lastInboundAt) return false;
  const elapsed = now - new Date(lastInboundAt).getTime();
  return (
    Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 24 * 60 * 60 * 1000
  );
}
