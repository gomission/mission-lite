# Mission Lite

Mission Lite is the free, open-source Focus edition of Mission. It keeps one useful move visible, stores progress receipts locally, and gives you a calm place to think without gaining authority over your accounts.

## What the beta includes

- the `/focus` desktop experience: Today, Progress, and Chat
- one current focus and a small local progress history
- deterministic local text and file intake
- local JSON state and append-only JSONL receipts
- a read-only release check against `gomission.app`

Mission Lite does not send email, publish, purchase, modify cloud services, connect third-party accounts, or run autonomous agents. Those capabilities belong to paid Mission plans and remain approval-gated.

## Run it

Node.js 20 or newer is required.

```sh
npx @gomission/mission-lite@beta
```

Or from source:

```sh
npm install
npm start -- --workspace /path/to/your/workspace
```

The server binds only to `127.0.0.1`. Data is written to `mission-lite-data/` inside the workspace you select.

## Product boundary

| Mission Lite | Mission Pro / Team |
| --- | --- |
| Local Focus UI | Hosted sync and multiple devices |
| Local state and receipts | Managed agents and integrations |
| No external actions | Approval-gated external actions |
| Community support | Commercial support and team controls |

The source is licensed under Apache 2.0. Mission names and logos are trademarks; the license covers code, not permission to imply endorsement.

## Releases and updates

GitHub Releases are the canonical source for artifacts and checksums. The app's **Check updates** control reads the signed HTTPS release feed at `https://gomission.app/releases/latest.json`; it never installs software automatically. See [releases/README.md](releases/README.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues should be reported using [SECURITY.md](SECURITY.md), not a public issue.

Mission Lite is beta software. Back up important workspace data.
