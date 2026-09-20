export function downloadDetails(request: Request) {
  const cf = request.cf;
  const country = typeof cf?.country === 'string' && /^[A-Z]{2}$/.test(cf.country)
    ? cf.country : null;
  const asn = typeof cf?.asn === 'number' && Number.isSafeInteger(cf.asn) && cf.asn > 0 && cf.asn <= 4294967295
    ? cf.asn : null;
  return {
    country,
    region: boundedText(cf?.region, 100),
    network: boundedText(cf?.asOrganization, 160),
    asn,
  };
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return text ? text.slice(0, maxLength) : null;
}
