


# HACKATHON 2026 | MIA GROUPE 33 
## Prerequisites
- Docker and Docker Compose installed
- (Optional) Python 3.9+ for local development
- If needed for local test import the groupes json into you MongoDB

## Project Architecture

```
hkt/
├── Front_HKT_2026/          # Frontend application
├── Back_HKT_2026/           # Backend application (this folder)
```


```
Back_HKT_2026/
│
├── server.js                    # Express server entry point
├── package.json                 # Node.js dependencies
├── package-lock.json            # Dependency lock file
│
├── models/                      # Mongoose schemas
│   ├── user.js                     # User model
│   ├── enterprise.js               # Enterprise model
│   ├── groups.js                   # Groups model
│   ├── MembershipRequest.js         # Membership requests
│   ├── RawDocument.js              # Unprocessed documents
│   ├── CleanDocument.js            # OCR-processed documents
│   └── CuratedDocument.js          # Final curated data
│
├── routes/                      # Express route handlers
│   ├── index.js                    # Main router
│   ├── users.js                    # User endpoints
│   ├── groups.js                   # Groups endpoints
│   ├── enterprise.js               # Enterprise endpoints
│   ├── documents.js                # Document endpoints
│   ├── membershipRequests.js       # Membership endpoints
│   └── dashboard.js                # Dashboard endpoints
│
├── services/                    # Business logic layer
│   ├── userService.js              # User operations
│   ├── enterpriseService.js        # Enterprise operations
│   ├── groupsService.js            # Groups operations
│   ├── documentsService.js         # Document operations
│   ├── membershipRequestService.js # Membership operations
│   └── dashboardService.js         # Dashboard data aggregation
│
├── generics/                    # Utility functions
│   ├── checkAuthentication.js      # JWT verification middleware
│   └── tools.js                    # Helper utilities
│
├── dags/                        # Airflow DAGs (Python)
│   └── dag_pipeline.py             # Document processing pipeline
│
├── scripts/                     # Python scripts
│   ├── test_fct.py                 # OCR function testing
│   ├── extract_text.py             # Text extraction
│   ├── extraction_data.py          # Data extraction
│   ├── check_anomalie.py           # Anomaly detection
│   ├── test_anomalie.py            # Anomaly testing
│   ├── generate_doc.py             # Document generation
│   └── __pycache__/                # Python cache
│
├── .venv/                       # Python virtual environment
│
├──  Docker Configuration
│   ├── Dockerfile.backend          # Node.js backend image
│   ├── Dockerfile.airflow          # Airflow image with OCR tools
│   └── docker-compose.yml          # Multi-service orchestration
│
├── Environment Files
│   ├── .env                        # Environment variables (production)
│   ├── .env.example                # Environment template
│   └── .gitignore                  # Git ignore rules
│
├── Documentation
│   ├── readme.md                   # Setup instructions
│
└── Dependencies
    ├── node_modules/               # Node.js packages
    └── package-lock.json           # Locked versions
```

## Running in Local
```bash
cd Back_HKT_2026
```
```bash
npm install
```
```bash
npm run dev
```
ou
```bash
nodemon
```



## Running with Docker

Navigate to the backend:

```bash
cd Back_HKT_2026
```
```bash
docker compose up --build
```

## Stopping Services

```bash
docker compose down
```