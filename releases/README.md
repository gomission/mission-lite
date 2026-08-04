# Release contract

Mission Lite uses one SemVer version across npm, source tags, desktop artifacts, and the public release feed.

- Version: `MAJOR.MINOR.PATCH[-prerelease]`
- Canonical tag: `v<version>`
- Canonical artifacts: the matching GitHub Release
- Discovery feed: `https://gomission.app/releases/latest.json`
- Installation: manual during beta; the app opens the canonical release page

Every release feed entry must use the `mission-lite-release/v1` schema and include an HTTPS release URL. Platform artifacts may be omitted until they are signed. Unsigned artifacts must never be labeled as automatically updatable.
