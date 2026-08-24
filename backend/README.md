# Backend README

This project uses:

- `backend/` for the Express + MongoDB API
- `frontend/` for the Vite + React client

The backend runs on `http://localhost:4000` by default.

## Prerequisites

- Node.js 18+ recommended
- npm
- A MongoDB database connection string

## Backend Setup

From the project root:

```powershell
cd backend
npm install
```

Create a `backend/.env` file with at least:

```env
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>/<database>?retryWrites=true&w=majority
PORT=4000
JWT_SECRET=your_jwt_secret
```

Optional environment variables used by the backend:

```env
WEEKLY_ALLOW_ANY_DAY=false
WEBHOOK_URL=
DAILYHOOK=
CASH_REPORT_WEBHOOK_URL=
CASH_REPORT_PAGE_URL=http://localhost:5173
FRONTEND_URL=http://localhost:5173
APP_URL=http://localhost:5173
```

## Seed Initial Data

To create the default branches, users, categories, and items:

```powershell
cd backend
npm run seed
```

Seeded demo users from `backend/data.js`:

- `admin@foffee.in` / `admin123`
- `ops@foffee.in` / `ops123`
- `brahmpuri@foffee.in` / `branch123`
- `ridhi@foffee.in` / `branch123`
- `rajapark@foffee.in` / `branch123`

## Run The Backend

Development mode with auto-reload:

```powershell
cd backend
npm run dev
```

Production-style run:

```powershell
cd backend
npm start
```

If startup succeeds, the API will be available at `http://localhost:4000`.

## Run The Full Project Locally

Open two terminals from the project root.

Terminal 1, start the backend:

```powershell
cd backend
npm install
npm run dev
```

Terminal 2, start the frontend:

```powershell
cd frontend
npm install
npm run dev
```

The frontend defaults to `http://localhost:5173` and already points to `http://localhost:4000` unless `VITE_API_BASE` is overridden.

## Useful Scripts

Backend scripts in `backend/package.json`:

- `npm start` - run the backend with Node
- `npm run dev` - run the backend with nodemon
- `npm run seed` - seed base data into MongoDB

Frontend scripts in `frontend/package.json`:

- `npm run dev` - start the Vite dev server
- `npm run build` - build the frontend
- `npm run preview` - preview the production build

## Quick Troubleshooting

- `MONGODB_URI is not set with credentials`
  Add a valid `MONGODB_URI` in `backend/.env`.

- Frontend loads but API calls fail
  Make sure the backend is running on port `4000`.

- Login does not work
  Run `npm run seed` in `backend/` so the default users exist in MongoDB.
