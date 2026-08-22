# Production configuration contains public values and Secret Manager
# references. Secret values remain in Google Cloud Secret Manager.

project_id  = "gen-lang-client-0372385774"
region      = "us-central1"
environment = "production"

service_name = "retire-plan"

# Cloud Build owns deployed revisions. These images bootstrap new services;
# the Cloud Run module preserves the immutable image selected by CI.
cloud_run_image    = "us-central1-docker.pkg.dev/gen-lang-client-0372385774/retire-plan/retire-plan:latest"
rust_service_image = "us-central1-docker.pkg.dev/gen-lang-client-0372385774/retire-plan/rust-simulation-service:latest"

artifact_registry_repository_id = "retire-plan"

public_env_vars = {
  FIREBASE_PROJECT_ID = "gen-lang-client-0372385774"
}

# Environment-variable secrets use immutable versions so every instance in a
# Cloud Run revision receives the same configuration.
secret_env_vars = {
  DATABASE_URL = {
    secret_name = "DATABASE_URL"
    version     = "1"
  }
  ORIGIN_SECRET = {
    secret_name = "ORIGIN_SECRET"
    version     = "1"
  }
  SIGNUP_INVITE_CODES = {
    secret_name = "SIGNUP_INVITE_CODES"
    version     = "1"
  }
}

memory_limit    = "512Mi"
cpu_limit       = "1"
min_instances   = 0
max_instances   = 10
timeout_seconds = 300

allow_unauthenticated = true

enable_cloud_build_trigger  = true
cloud_build_trigger_name    = "deploy-production"
cloud_build_service_account = "projects/gen-lang-client-0372385774/serviceAccounts/789638662967-compute@developer.gserviceaccount.com"
github_owner                = "Ficke"
github_repo                 = "retirement-planner"

# Vite embeds Firebase client configuration during the production build.
build_substitutions = {
  _FIREBASE_API_KEY             = "AIzaSyDhz2HOuS6HN_QE3SD0L9w7hGDDHMMyDrQ"
  _FIREBASE_AUTH_DOMAIN         = "gen-lang-client-0372385774.firebaseapp.com"
  _FIREBASE_PROJECT_ID          = "gen-lang-client-0372385774"
  _FIREBASE_STORAGE_BUCKET      = "gen-lang-client-0372385774.firebasestorage.app"
  _FIREBASE_MESSAGING_SENDER_ID = "789638662967"
  _FIREBASE_APP_ID              = "1:789638662967:web:07de8d66e7d782c488a8b2"
  _ORIGIN_SECRET_VERSION        = "1"
}
