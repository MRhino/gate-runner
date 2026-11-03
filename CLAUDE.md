# Gate Runner

- Every push to `main` must bump the `version` in `package.json` (minor: 0.19.0 → 0.20.0). The start screen shows `v<major>.<minor> · <commit>` so the user can confirm they're on the latest build.
- Deploys: Vercel project `gate-runner` (mlh-group), auto-deploys from `main`. Public URL: https://gate-runner-five.vercel.app
