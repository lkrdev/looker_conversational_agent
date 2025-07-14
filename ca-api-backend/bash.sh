gcloud run deploy looker-ca-api \
    --source . \
    --region us-central1 \
    --set-env-vars "PROJECT=" \
    --set-env-vars "LOOKER_INSTANCE=" \
    --set-env-vars "LOOKML_MODEL=" \
    --set-env-vars "LOOKML_EXPLORE=" \
    --update-secrets LOOKER_CLIENT_ID=LOOKER_CLIENT_ID_TWO:latest,LOOKER_CLIENT_SECRET=LOOKER_CLIENT_SECRET_TWO:latest \
    --no-allow-unauthenticated