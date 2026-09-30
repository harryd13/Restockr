import { getHealth } from "../controllers/health.controller.js";

export function registerHealthRoutes(app) {
  app.get("/api/health", getHealth);
}
