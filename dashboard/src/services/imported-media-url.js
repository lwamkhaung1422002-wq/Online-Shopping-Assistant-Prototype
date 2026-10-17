// Imported catalogue photos are bundled with this frontend. Rendering them
// must not require the separate Dashboard development server to be running.
export function importedMediaUrl(value) {
  if (typeof value !== "string") return value;
  try {
    const url = new URL(value);
    if (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
        url.port === "5186" && !url.username && !url.password &&
        /^\/original-media\/[a-f0-9]{64}\.(?:webp|png|jpe?g)$/.test(url.pathname)) {
      return url.pathname + url.search;
    }
  } catch { /* Existing relative URLs already use the current frontend. */ }
  return value;
}
