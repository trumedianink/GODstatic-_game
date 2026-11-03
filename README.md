# GODstatic Immersive Game — Preview Package

This repository packages the fixed, standalone GODstatic game prototype for an **isolated Cloudflare Pages preview project**. It includes the static game, automated clean/returning-player browser tests, a local Wrangler Pages check, Lighthouse CI, a Git pre-push hook, and a GitHub Actions workflow with a post-deployment Cloudflare Access service-token smoke test.

The GitHub workflow runs browser tests and Lighthouse on pull requests targeting `main` or `preview`, and on **every push** to either branch. Every push to `preview` deploys to Cloudflare Pages **only after validation passes**. Pushes to `main` validate but do not deploy. It never deploys this game to the existing GODstatic production site. Keep the Pages project name `godstatic-game-preview` separate from any live-site project.

## Included project layout

```text
GODstatic-game/
├── public/
│   └── index.html                       # Fixed standalone game prototype
├── tests/
│   └── test_godstatic_game_browser.cjs  # Clean and returning player browser flows
├── scripts/
│   ├── preview_local.sh                 # Start a local visual Pages preview
│   └── prepush_pages_dev_check.sh       # Wrangler + browser + Lighthouse runner
├── .githooks/
│   └── pre-push                         # Runs validation before git push
├── .github/workflows/
│   └── validate-and-preview.yml        # CI; preview deploy only after passing checks
├── lighthouserc.js                      # Mobile Lighthouse budgets and local report output
├── package.json
├── package-lock.json
├── .gitignore
└── README.md
```

## 1. Create the isolated Pages project

Install [Node.js](https://nodejs.org/) 22 or later and Git. From this repository directory, install the project's tools:

```bash
npm ci
npx playwright-core install chromium
```

Authenticate Wrangler locally, then create the separate Pages project once:

```bash
npx wrangler login
npx wrangler pages project create godstatic-game-preview
```

Use your own Cloudflare account. This creates the preview project only; it does not change the existing website or its connectors. Cloudflare's Direct Upload documentation describes the Pages project and CI setup: <https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/>.

## 2. Run checks before pushing

To inspect the actual packaged HTML locally, start a Pages preview:

```bash
npm run preview
```

Open the printed `http://127.0.0.1:8788/` address in your browser. The server stays running so you can play through the build; press **Ctrl+C** in the terminal to stop it. If that port is busy, choose another one with `PAGES_DEV_PORT=8790 npm run preview`.

To run the complete automated browser and Lighthouse checks instead of leaving the preview server open, use:

```bash
npm run preview:check
```

This is equivalent to `npm run validate`; both test the site served by local Wrangler Pages Dev and stop the server afterward.

Run the complete local validation manually:

```bash
npm run validate
```

The script binds Wrangler Pages Dev to `127.0.0.1`, confirms that `public/index.html` is served, runs the browser suite against that served site, then runs three Lighthouse audits against the same URL. Wrangler is stopped when the command exits.

To make Git run these checks automatically before every push, install the included hook once per clone:

```bash
npm run hooks:install
```

The hook calls `npm run validate`. If validation fails, Git refuses the push. You can still run `npm run validate` yourself at any time.

Lighthouse audits the mobile profile three times and enforces median budgets: Performance score at least `0.85`, Largest Contentful Paint (LCP) no more than `3000` ms, and Cumulative Layout Shift (CLS) no more than `0.1`. These assertions use the `error` level, so exceeding a budget fails validation and prevents a preview deployment. Local reports are written to `.lighthouseci/`, which is ignored by Git. On GitHub, reports are uploaded as a workflow artifact for 14 days. Tune the thresholds in `lighthouserc.js` if your measured baseline requires different budgets.

## 3. Put the project on GitHub

Create a **private** or public GitHub repository for the game. Do not add unrelated site files or the live site's credentials. In a terminal at the project root, initialize and push the `main` branch:

```bash
git init -b main
git add .
git commit -m "Add GODstatic game preview with validation"
git remote add origin https://github.com/YOUR-USERNAME/godstatic-game.git
git push -u origin main
```

Replace the remote URL with your actual repository URL. The workflow will run the checks on GitHub. The local Git hook is not transferred as an active hook by Git, so each person who clones the repository should run `npm run hooks:install` once.

Create the preview branch and push it:

```bash
git switch -c preview
git push -u origin preview
```

After GitHub secrets are set up (next section), every push to `preview` triggers the isolated Pages deployment after validation passes. A final job verifies anonymous requests are blocked and that a Cloudflare Access service token can retrieve the deployed game HTML. Pull requests targeting `main` or `preview` run validation but do not deploy. Pushes to `main` validate only.

## 4. Add Cloudflare secrets to GitHub

Create a Cloudflare API token limited to **Account → Cloudflare Pages → Edit**. In GitHub, open the repository's **Settings → Secrets and variables → Actions → New repository secret** and add:

- `CLOUDFLARE_API_TOKEN` — the scoped API token.
- `CLOUDFLARE_ACCOUNT_ID` — the Cloudflare account ID.
- `CF_ACCESS_CLIENT_ID` — the Client ID for a Cloudflare Access service token.
- `CF_ACCESS_CLIENT_SECRET` — the matching service-token secret.

To create the Access credentials, go to **Zero Trust → Access controls → Service credentials → Service Tokens → Create Service Token**. Then, in the Access application for `game-preview.godstatic.com`, add a **Service Auth** policy that includes this service token. Store its Client ID and Secret as the two GitHub secrets above. The workflow uses them only in the post-deployment smoke-test job, which runs on pushes to `preview`, not on pull requests.

Do not put credentials in this repository, README, workflow, or `.env` file. GitHub Actions reads the Pages API token and account ID only during the preview-deploy job, and the Access service-token credentials only during the protected-preview test. A pull request does not receive either deployment or service-token testing jobs.

Cloudflare's current Direct Upload guide documents these secrets and `wrangler pages deploy`; the official action is [`cloudflare/wrangler-action@v4`](https://github.com/cloudflare/wrangler-action).

## 5. Manual preview deployment (optional)

The normal path is to push the `preview` branch after the secrets are configured. To deploy manually from an authenticated local terminal instead:

```bash
npm run validate
npm run pages:preview
```

Or use Wrangler directly:

```bash
npx wrangler pages deploy ./public \
  --project-name godstatic-game-preview \
  --branch preview
```

Do not replace the project name with the existing live site's Pages project name. This package is deliberately configured to deploy only to `godstatic-game-preview` on the `preview` branch.

## Useful commands

```bash
npm run preview         # Serve the built HTML locally for hands-on playtesting
npm run preview:check   # Run browser regression and Lighthouse checks, then exit
npm run dev             # Run Wrangler Pages Dev on localhost
npm run validate        # Run pre-push browser and Lighthouse checks
npm run hooks:install   # Enable the local Git pre-push hook
npm run pages:preview   # Manually deploy the isolated preview branch
```

Use a different local Wrangler port if 8788 is occupied:

```bash
PAGES_DEV_PORT=8790 npm run validate
```

## What the checks do not do

The prototype and validation are self-contained and do not contact or modify the existing GODstatic website or its connectors. The local check makes no Cloudflare deployment. Only the GitHub workflow's preview job and the explicit manual deployment command upload files, and both target the separately named `godstatic-game-preview` Pages project.

<!-- ci: preview deploy test trigger, 2026-11-02 -->
