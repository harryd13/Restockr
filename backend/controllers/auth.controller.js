import jwt from "jsonwebtoken";
import { COLLECTIONS } from "../config.js";

export function registerAuthRoutesController(app, { repository, jwtSecret, authMiddleware }) {
  app.post("/api/login", async (req, res) => {
    const { email, password } = req.body;
    const user = await repository.users().findOne({ email, password });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });
    const token = jwt.sign(
      { id: user.id, role: user.role, branchId: user.branchId, name: user.name },
      jwtSecret,
      { expiresIn: "1h" }
    );
    res.json({
      token,
      user: { id: user.id, name: user.name, role: user.role, branchId: user.branchId }
    });
  });

  app.get("/api/me", authMiddleware, async (req, res) => {
    const user = await repository.users().findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ id: user.id, name: user.name, role: user.role, branchId: user.branchId });
  });
}

