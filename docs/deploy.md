# Deploy: Firebase Hosting + Cloud Run

- **Web:** `apps/web/dist` on Firebase Hosting. `/api/**` is rewritten to the Cloud Run service `look-studio-api` (us-central1), so everything is same-origin.
- **API:** `apps/server/Dockerfile`, built from the repo root, runs on Cloud Run with `max-instances=1`. That way the in-memory rate limiter and spend cap see every request.
- **CI/CD** (`.github/workflows/deploy.yml`):
  - every PR builds and boot-checks the API image, then deploys a Hosting preview channel `pr-<n>` that expires after 7 days
  - every push to `main` deploys Cloud Run and Hosting, then smoke-checks `/` and `/api/health`
- No keys are stored in GitHub. Actions authenticates with Workload Identity Federation, and `MODEL_API_KEY` lives in Secret Manager.

## One-time setup

Run these yourself. Replace `PROJECT_ID`, `PROJECT_NUMBER` and `GITHUB_REPO` (`Xlient/look-studio`).

1. In the Firebase console, create the project (or use an existing one) and switch it to the **Blaze** plan. Cloud Run and outbound calls to the Meta API need Blaze. Add a budget alert of about $5 under Billing → Budgets.
2. Enable the APIs:
   ```bash
   gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com iamcredentials.googleapis.com firebasehosting.googleapis.com --project PROJECT_ID
   ```
3. Create the image repository:
   ```bash
   gcloud artifacts repositories create look-studio --repository-format docker --location us-central1 --project PROJECT_ID
   ```
4. Store the Meta key. In zsh, this prompts for the value so it never lands in your shell history:
   ```bash
   read -rs "k?MODEL_API_KEY: "; printf '%s' "$k" | gcloud secrets create model-api-key --data-file=- --project PROJECT_ID; unset k
   gcloud secrets add-iam-policy-binding model-api-key --member "serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" --role roles/secretmanager.secretAccessor --project PROJECT_ID
   ```
5. Create the deploy service account and grant its roles:
   ```bash
   gcloud iam service-accounts create github-deploy --project PROJECT_ID
   for role in roles/run.admin roles/artifactregistry.writer roles/firebasehosting.admin roles/iam.serviceAccountUser roles/run.viewer; do
     gcloud projects add-iam-policy-binding PROJECT_ID --member "serviceAccount:github-deploy@PROJECT_ID.iam.gserviceaccount.com" --role "$role"
   done
   ```
6. Set up Workload Identity Federation for GitHub:
   ```bash
   gcloud iam workload-identity-pools create github --location global --project PROJECT_ID
   gcloud iam workload-identity-pools providers create-oidc github --location global --workload-identity-pool github \
     --issuer-uri https://token.actions.githubusercontent.com \
     --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository" \
     --attribute-condition "assertion.repository == 'GITHUB_REPO'" --project PROJECT_ID
   gcloud iam service-accounts add-iam-policy-binding github-deploy@PROJECT_ID.iam.gserviceaccount.com \
     --role roles/iam.workloadIdentityUser \
     --member "principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/GITHUB_REPO" --project PROJECT_ID
   ```
7. Add GitHub **repository variables** under Settings → Secrets and variables → Actions → Variables. These are not secrets:
   - `GCP_PROJECT_ID`: `PROJECT_ID`
   - `GCP_WIF_PROVIDER`: `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github`
   - `GCP_DEPLOY_SA`: `github-deploy@PROJECT_ID.iam.gserviceaccount.com`
   - optional: `DAILY_SPEND_CAP_USD` (default 5), `RATE_LIMIT_MAX` (default 60 per minute per IP), and `LOOK_REASONING_EFFORT` (`minimal`, `low`, `medium` or `high`; default `low`; lower means faster looks)
8. Merge into `main`. The first push deploys Cloud Run and then Hosting, and the live URL is `https://PROJECT_ID.web.app`. PR previews only work once that first deploy exists, because Hosting checks that the Cloud Run service exists.

Until `GCP_PROJECT_ID` is set, the preview and deploy jobs are skipped. Only the image build and boot check run.

## Known limits

- Requests that Hosting forwards to Cloud Run time out after 60 s. Long server-sent-event streams, such as wearable jobs, rely on EventSource reconnecting.
- When the API scales to zero, the in-memory spend cap resets. Treat the Meta-side limit and the GCP budget alert as the hard stop.
- Per-IP limits use the first `X-Forwarded-For` entry. A determined client can spoof that header.
