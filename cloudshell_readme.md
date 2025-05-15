# Conversational Agent Cloud Run Backend 
This guide provides step-by-step instructions for deploying the Conversational Agent backend service on GCP Cloud Run. This is intended for deployment in a new or existing Google Cloud project.
Caution
If resources will be deleted or destroyed by Terraform or any other automated process, please abort the process to avoid destroying existing resources. This guide focuses on manual, step-by-step configuration.

Step by Step Configuration
## 1: Set up Environment Variables
Make sure to replace `PROJECT_ID`, `REGION`, `LOOKER_INSTANCE`, `LOOKML_MODEL`, and `LOOKML_EXPLORE` values with your actual values. The `CLOUD_RUN_SERVICE_NAME` should be left as default.
```bash
export PROJECT_ID="your-project-id"
export REGION="us-central1" # e.g., us-central1
export CLOUD_RUN_SERVICE_NAME="looker-ca-api" # Name for your Cloud Run service
export LOOKER_INSTANCE="https://your-looker-instance.looker.com" # Your Looker instance base URL
export LOOKML_MODEL="your_lookml_model_name" # Your LookML model name
export LOOKML_EXPLORE="your_lookml_explore_name" # Your LookML explore name

gcloud config set project $PROJECT_ID
```
## 2: Enable Required APIs
Enable all necessary Google Cloud APIs for Cloud Run, Secret Manager, AI Platform (Vertex AI), Dialogflow, and BigQuery.
```bash
gcloud services enable serviceusage.googleapis.com \
    cloudresourcemanager.googleapis.com \
    iam.googleapis.com \
    aiplatform.googleapis.com \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    secretmanager.googleapis.com \
    dialogflow.googleapis.com \
```
THEN, you must wait a bit. These APIs need time to activate and propagate changes across regions. Take a short break, then proceed with the next step.
## 3: Grant Permissions
Grant the necessary IAM permissions to the Dialogflow Service Account and the Cloud Run Service Account.
### Get your project number
```bash
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
```
### Grant Cloud Run Invoker permission to Dialogflow Service Account
```bash
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member "serviceAccount:service-$PROJECT_NUMBER@gcp-sa-dialogflow.iam.gserviceaccount.com" \
    --role "roles/run.invoker"
```
### Grant Vertex AI User permission to Cloud Run Service Account (default compute service account)
```bash
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member "serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
    --role "roles/aiplatform.user"
```
## 4: Create Secrets in Secret Manager
Create secrets for your Looker API credentials (`LOOKER_CLIENT_ID` and `LOOKER_CLIENT_SECRET`) in Secret Manager. These will be securely accessed by your Cloud Run service. Replace the `your-looker-client-xxx` with the valid client id and secret for your Looker API Credentials.
```bash
echo -n "your-looker-client-id" | gcloud secrets create LOOKER_CLIENT_ID \
    --replication-policy=user-managed \
    --locations=$REGION \
    --data-file=-

echo -n "your-looker-client-secret" | gcloud secrets create LOOKER_CLIENT_SECRET \
    --replication-policy=user-managed \
    --locations=$REGION \
    --data-file=-
```
### Grant the Cloud Run service account access to these secrets
```bash
gcloud secrets add-iam-policy-binding LOOKER_CLIENT_ID \
    --member "serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
    --role "roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding LOOKER_CLIENT_SECRET \
    --member "serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
    --role "roles/secretmanager.secretAccessor"
```
## 6: Edit Configuration in Code
Before deploying, ensure your application code is configured to read the environment variables and secrets. You might need to edit a configuration file or environment variables within your service's source code to use the `PROJECT_ID`, `LOOKER_INSTANCE`, `LOOKML_MODEL`, and `LOOKML_EXPLORE` values.
## 7: Deploy Cloud Run Service
Deploy your Cloud Run service from the current directory. This command builds a container image from your source code and deploys it.
```bash
gcloud run deploy $CLOUD_RUN_SERVICE_NAME \
    --source . \
    --region $REGION \
    --set-env-vars "PROJECT=$PROJECT_ID" \
    --set-env-vars "LOOKER_INSTANCE=$LOOKER_INSTANCE" \
    --set-env-vars "LOOKML_MODEL=$LOOKML_MODEL" \
    --set-env-vars "LOOKML_EXPLORE=$LOOKML_EXPLORE" \
    --update-secrets LOOKER_CLIENT_ID=LOOKER_CLIENT_ID:latest,LOOKER_CLIENT_SECRET=LOOKER_CLIENT_SECRET:latest \
    --no-allow-unauthenticated
```
## 8: Copy Deployed Cloud Run URL
After successful deployment, the URL of your Cloud Run service will be printed. Copy this URL, as it will be needed for your frontend setup.
```bash
gcloud run services describe $CLOUD_RUN_SERVICE_NAME \
    --region $REGION \
    --format='value(status.url)'
```

