#!/bin/bash
set -e

# ─── CONFIGURATION ────────────────────────────────────────────────────────────
S3_BUCKET="barrett-leadgen"          # Change if bucket name is taken
AWS_REGION="us-east-1"              # Match your existing S3 site region
STACK_NAME="barrett-leadgen-pipeline"

# ─── PROMPT FOR SECRETS ───────────────────────────────────────────────────────
echo ""
echo "Barrett Financial — Lead Gen Pipeline Deploy"
echo "============================================"
echo ""
echo "Enter your credentials (input is hidden):"
echo ""
read -s -p "Claude API key: " CLAUDE_KEY; echo ""
read -s -p "Azure Tenant ID (12df9652-07d9-48a6-a194-0018887f4c47): " AZURE_TENANT; echo ""
read -s -p "Azure Client ID (63a1d3e2-c39c-4860-981c-43f6d6b0153d): " AZURE_CLIENT_ID_VAL; echo ""
read -s -p "Azure Client Secret: " AZURE_SECRET; echo ""
echo ""

# Use defaults if blank
AZURE_TENANT=${AZURE_TENANT:-"12df9652-07d9-48a6-a194-0018887f4c47"}
AZURE_CLIENT_ID_VAL=${AZURE_CLIENT_ID_VAL:-"63a1d3e2-c39c-4860-981c-43f6d6b0153d"}

# ─── CREATE S3 BUCKET IF NEEDED ───────────────────────────────────────────────
echo "Creating S3 bucket if needed..."
aws s3 mb s3://$S3_BUCKET --region $AWS_REGION 2>/dev/null || echo "Bucket already exists, continuing."

aws s3 website s3://$S3_BUCKET \
  --index-document index.html \
  --error-document index.html

aws s3api put-bucket-policy --bucket $S3_BUCKET --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Sid\": \"PublicRead\",
    \"Effect\": \"Allow\",
    \"Principal\": \"*\",
    \"Action\": \"s3:GetObject\",
    \"Resource\": \"arn:aws:s3:::$S3_BUCKET/*\"
  }]
}"

# ─── DEPLOY LAMBDA + API GATEWAY ─────────────────────────────────────────────
echo "Building and deploying Lambda functions..."
sam build
sam deploy \
  --stack-name $STACK_NAME \
  --s3-bucket $S3_BUCKET \
  --s3-prefix sam-artifacts \
  --region $AWS_REGION \
  --capabilities CAPABILITY_IAM \
  --no-confirm-changeset \
  --parameter-overrides \
    ClaudeApiKey="$CLAUDE_KEY" \
    AzureTenantId="$AZURE_TENANT" \
    AzureClientId="$AZURE_CLIENT_ID_VAL" \
    AzureClientSecret="$AZURE_SECRET"

# ─── GET API URL ─────────────────────────────────────────────────────────────
echo "Getting API Gateway URL..."
API_URL=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --region $AWS_REGION \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" \
  --output text)
echo "API URL: $API_URL"

# ─── INJECT API URL INTO FRONTEND ────────────────────────────────────────────
echo "Injecting API URL into frontend..."
sed -i.bak "s|https://REPLACE_WITH_API_GATEWAY_URL|$API_URL|g" frontend/app.js
rm -f frontend/app.js.bak

# ─── UPLOAD FRONTEND TO S3 ────────────────────────────────────────────────────
echo "Uploading frontend to S3..."
aws s3 sync frontend/ s3://$S3_BUCKET/ \
  --region $AWS_REGION \
  --cache-control "no-cache" \
  --exclude ".DS_Store"

# ─── RESTORE app.js PLACEHOLDER ──────────────────────────────────────────────
sed -i.bak "s|$API_URL|https://REPLACE_WITH_API_GATEWAY_URL|g" frontend/app.js
rm -f frontend/app.js.bak

# ─── DONE ─────────────────────────────────────────────────────────────────────
SITE_URL="http://$S3_BUCKET.s3-website-$AWS_REGION.amazonaws.com"
echo ""
echo "============================================"
echo "Deploy complete!"
echo "Site URL: $SITE_URL"
echo "============================================"
echo ""
echo "Share this URL with your team."
echo "Bookmark it — it won't change unless you rename the bucket."
echo ""
