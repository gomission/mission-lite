# Security policy

Mission Lite is in public beta. Only the latest beta receives security fixes.

Please report vulnerabilities privately to `security@gomission.io`. Include the affected version, reproduction steps, and impact. Do not include sensitive workspace data. We will acknowledge a report within three business days and coordinate disclosure after a fix is available.

Mission Lite binds to loopback, requires an unpredictable per-process token for state-changing HTTP requests, and performs no external actions. Do not expose its local server through a proxy or public tunnel.
