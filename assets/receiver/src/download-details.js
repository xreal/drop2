export function parseDownloadDetails(value) {
  if (!value || typeof value !== 'object') return null;
  const country = typeof value.country === 'string' && /^[A-Z]{2}$/.test(value.country) ? value.country : null;
  const text = (value, limit) => typeof value === 'string' && value.length <= limit ? value : null;
  const asn = Number.isSafeInteger(value.asn) && value.asn > 0 && value.asn <= 4294967295 ? value.asn : null;
  return { country, region: text(value.region, 100), network: text(value.network, 160), asn };
}

export function downloadDetailLines(value) {
  const details = parseDownloadDetails(value);
  if (!details) return ['Location and network not recorded for this download.'];
  let country = details.country;
  if (country) {
    try { country = new Intl.DisplayNames(['en'], { type: 'region' }).of(country); } catch { /* Use the country code. */ }
  }
  const location = [country, details.region].filter(Boolean).join(' · ');
  const network = [details.network, details.asn ? `AS${details.asn}` : null].filter(Boolean).join(' · ');
  return [location ? `Approx. location: ${location}` : 'Location unavailable',
    network ? `Network: ${network}` : 'Network unavailable'];
}
