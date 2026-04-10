# Barrett Financial — Lead Gen Pipeline

## What this is
A hosted web app for managing the lead generation workflow:
Request → SQL generation → Raw output processing → Skip trace → Contact Excel export.
Sessions are saved to SharePoint at:
`/sites/BusinessIntelligence/Files/10. Leads/10. Claude/Lead Gen Pipeline.xlsx`

---

## Prerequisites (must be installed)
- AWS CLI (configured with your credentials)
- AWS SAM CLI (`brew install aws-sam-cli` or https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)

---

## Deploy (one command)

```bash
chmod +x deploy.sh
./deploy.sh
```

The script will prompt you for:
1. Claude API key
2. Azure Tenant ID (default pre-filled: 12df9652-07d9-48a6-a194-0018887f4c47)
3. Azure Client ID (default pre-filled: 63a1d3e2-c39c-4860-981c-43f6d6b0153d)
4. Azure Client Secret (the one you just created in Azure portal)

All credentials go directly into Lambda environment variables — never stored in code or S3.

---

## What gets deployed
- **S3 bucket**: `barrett-leadgen` — hosts the frontend (HTML/CSS/JS)
- **3 Lambda functions**:
  - `generate-sql` — calls Claude API to generate Snowflake SQL
  - `refine-sql` — calls Claude API to refine SQL based on LO changes
  - `sharepoint` — reads/writes session data to SharePoint via Microsoft Graph
- **API Gateway**: connects the frontend to the Lambda functions

---

## After deploy
The script prints the site URL:
`http://barrett-leadgen.s3-website-us-east-1.amazonaws.com`

Share that with your team. Anyone at Barrett Financial with the link can use it.

---

## Re-deploy after changes
Just run `./deploy.sh` again. Frontend and Lambda both update.

---

## File structure
```
leadgen/
├── frontend/
│   ├── index.html      # App UI
│   ├── styles.css      # Styles
│   └── app.js          # All frontend logic
├── lambda/
│   ├── generate-sql/   # Claude SQL generation
│   ├── refine-sql/     # Claude SQL refinement
│   └── sharepoint/     # SharePoint read/write
├── template.yaml       # SAM/CloudFormation config
├── deploy.sh           # One-command deploy script
└── README.md           # This file
```
