# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private reporting instead: open the **Security** tab of this repository and choose **Report a vulnerability**. You will get an answer as soon as possible; this is a spare-time project, so please allow some days.

## What to expect

The app shows untrusted web content next to local tools that act on your sandboxes and files, so the design rules in [AGENTS.md](AGENTS.md) matter: a page must never reach the app's IPC, paths on your computer come only from native dialogs, and launch tokens are never stored or logged. Reports about breaking one of these rules are especially welcome.

Only the latest release is supported.
