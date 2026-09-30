export function getHealth(req, res) {
  const now = new Date();
  res.json({
    ok: true,
    serverTime: now.toISOString(),
    localTime: now.toString(),
    timezoneOffsetMinutes: now.getTimezoneOffset()
  });
}
