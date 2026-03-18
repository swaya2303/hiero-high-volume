# Contributing to `hiero-high-volume`

Thank you for taking the time to contribute! Please read the following guidelines before opening a pull request.

---

## Prerequisites

- Node.js ≥ 18
- Git ≥ 2.34
- GPG (see below)

---

## Signed Commits

This project requires **all commits to be GPG-signed**. Pull requests containing unsigned commits will not be merged.

### Enable GPG signing on your fork

**Step 1 — Find your key ID:**

```sh
gpg --list-secret-keys --keyid-format=long
# sec  rsa4096/ABCD1234EFGH5678 ...
```

**Step 2 — Configure your local clone** (run inside the repo directory):

```gitconfig
[user]
    signingkey = <YOUR_16_CHAR_KEY_ID>

[commit]
    gpgsign = true

[gpg]
    program = gpg
```

Or use the one-liner equivalent:

```sh
git config user.signingkey <YOUR_16_CHAR_KEY_ID>
git config commit.gpgsign true
```

> **Windows users:** Also set the full path to `gpg.exe`:
> ```powershell
> git config gpg.program "C:\Program Files (x86)\GnuPG\bin\gpg.exe"
> ```

> **macOS users:** Install `pinentry-mac` and add the following to `~/.gnupg/gpg-agent.conf`:
> ```
> pinentry-program /opt/homebrew/bin/pinentry-mac
> ```
> Then restart the agent: `gpgconf --kill gpg-agent`

**Step 3 — Add your public key to GitHub:**

```sh
gpg --armor --export <YOUR_16_CHAR_KEY_ID> | gh gpg-key add -
```

**Step 4 — Verify a signed commit:**

```sh
git log --show-signature -1
# Expected: gpg: Good signature from "Your Name <you@example.com>"
```

---

## Pull Request Process

1. Fork the repo and create a feature branch from `main`.
2. Make your changes with signed, atomic commits.
3. Open a PR against `main` — at least **1 approving review** is required.
4. All status checks (CI) must pass before merging.
5. Do not force-push to `main`.

---

## Code Style

- TypeScript strict mode is enabled — do not disable it.
- Run `npm test` and `npm run build` locally before pushing.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages (e.g. `feat:`, `fix:`, `chore:`).

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
