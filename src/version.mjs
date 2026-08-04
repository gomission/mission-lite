export function compareVersions(left, right) {
  const parse = (value) => {
    const [core, prerelease = ""] = String(value || "0.0.0").replace(/^v/, "").split("-", 2);
    return { numbers: core.split(".").map((part) => Number(part) || 0), prerelease: prerelease.split(".").filter(Boolean) };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if ((a.numbers[index] || 0) !== (b.numbers[index] || 0)) return (a.numbers[index] || 0) > (b.numbers[index] || 0) ? 1 : -1;
  }
  if (!a.prerelease.length && b.prerelease.length) return 1;
  if (a.prerelease.length && !b.prerelease.length) return -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const av = a.prerelease[index];
    const bv = b.prerelease[index];
    if (av === bv) continue;
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    const an = /^\d+$/.test(av) ? Number(av) : NaN;
    const bn = /^\d+$/.test(bv) ? Number(bv) : NaN;
    if (Number.isFinite(an) && Number.isFinite(bn)) return an > bn ? 1 : -1;
    if (Number.isFinite(an)) return -1;
    if (Number.isFinite(bn)) return 1;
    return av > bv ? 1 : -1;
  }
  return 0;
}

export function validateReleaseFeed(feed) {
  if (!feed || feed.schema !== "mission-lite-release/v1") throw new Error("Unsupported release feed");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(feed.version || ""))) throw new Error("Invalid release version");
  if (!/^https:\/\//.test(String(feed.release_url || ""))) throw new Error("Invalid release URL");
  return feed;
}
