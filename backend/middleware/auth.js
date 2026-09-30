import jwt from "jsonwebtoken";

export function createAuthMiddleware(jwtSecret) {
  return (req, res, next) => {
    const authHeader = req.headers["authorization"];
    if (!authHeader) return res.status(401).json({ message: "Missing token" });
    const token = authHeader.split(" ")[1];
    if (!token) return res.status(401).json({ message: "Invalid token" });
    try {
      req.user = jwt.verify(token, jwtSecret);
      next();
    } catch {
      return res.status(401).json({ message: "Invalid token" });
    }
  };
}

export function ensureAdmin(req, res) {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ message: "Admin role required" });
    return false;
  }
  return true;
}
