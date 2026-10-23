import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyStripeSignature(rawBody, signatureHeader, secret, nowSeconds = Date.now() / 1000) {
  if (typeof signatureHeader !== "string" || !secret?.startsWith("whsec_")) return false;
  const pieces = signatureHeader.split(",").map((part) => part.split("=", 2));
  const timestamps = pieces.filter(([key]) => key === "t").map(([, value]) => Number(value));
  const signatures = pieces.filter(([key]) => key === "v1").map(([, value]) => value);
  const timestamp = timestamps[0];
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest();
  return signatures.some((signature) => {
    if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
    const supplied = Buffer.from(signature, "hex");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
}
