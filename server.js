const express = require("express");
const cors = require("cors");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { Resend } = require("resend");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = 5000;
const JWT_SECRET = "ncs_super_secret_change_this";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "re_gWjd2dze_PUZmKW9DeW5m5TZj1rrgFMMk";
const DB_PATH = path.join(__dirname, "ncs.sqlite");
const resend = new Resend(RESEND_API_KEY);

const db = new sqlite3.Database(DB_PATH);

app.use(cors());
app.use(express.json());

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function seedDatabase() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    preferred_domain TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME
  )`);

  await run(`CREATE TABLE IF NOT EXISTS login_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    domain TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS api_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    ip TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT DEFAULT 'India',
    type TEXT DEFAULT 'Full Time',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const adminUser = await get("SELECT * FROM users WHERE username = ?", ["admin"]);
  if (!adminUser) {
    const hash = bcrypt.hashSync("admin@123", 10);
    await run(
      "INSERT INTO users (username, password_hash, role, preferred_domain) VALUES (?, ?, ?, ?)",
      ["admin", hash, "admin", "Administration"]
    );
  }

  const demoUser = await get("SELECT * FROM users WHERE username = ?", ["manoj"]);
  if (!demoUser) {
    const hash = bcrypt.hashSync("manoj123", 10);
    await run(
      "INSERT INTO users (username, password_hash, role, preferred_domain) VALUES (?, ?, ?, ?)",
      ["manoj", hash, "user", "Computer Science & Engineering (CSE)"]
    );
  }

  const jobsCount = await get("SELECT COUNT(*) AS count FROM jobs");
  if (!jobsCount || jobsCount.count === 0) {
    await run(
      "INSERT INTO jobs (title, company, location, type) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)",
      [
        "Frontend Developer",
        "TCS",
        "Chennai",
        "Full Time",
        "Backend Engineer",
        "Zoho",
        "Chennai",
        "Full Time",
        "Data Analyst Intern",
        "Infosys",
        "Bangalore",
        "Internship"
      ]
    );
  }

  await run(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?), (?, ?)",
    ["maintenance_mode", "off", "theme_override", "auto"]
  );
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ message: "Missing token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid token" });
  }
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  return next();
}

app.use((req, res, next) => {
  res.on("finish", async () => {
    if (!req.path.startsWith("/api")) return;
    try {
      await run("INSERT INTO api_logs (method, path, status_code, ip) VALUES (?, ?, ?, ?)", [
        req.method,
        req.path,
        res.statusCode,
        req.ip || req.socket.remoteAddress || "unknown"
      ]);
    } catch (error) {
      // logging failure should not break request lifecycle
    }
  });
  next();
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password, domain } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ message: "Username and password are required." });
  }

  const user = await get("SELECT * FROM users WHERE username = ?", [username.trim()]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    await run(
      "INSERT INTO login_history (user_id, username, role, status, ip, user_agent, domain) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        null,
        username.trim(),
        "unknown",
        "failed",
        req.ip || req.socket.remoteAddress || "unknown",
        req.headers["user-agent"] || "unknown",
        domain || null
      ]
    );
    return res.status(401).json({ message: "Invalid credentials." });
  }

  await run("UPDATE users SET preferred_domain = ?, last_login = CURRENT_TIMESTAMP WHERE id = ?", [
    domain || user.preferred_domain || null,
    user.id
  ]);

  await run(
    "INSERT INTO login_history (user_id, username, role, status, ip, user_agent, domain) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      user.id,
      user.username,
      user.role,
      "success",
      req.ip || req.socket.remoteAddress || "unknown",
      req.headers["user-agent"] || "unknown",
      domain || user.preferred_domain || null
    ]
  );

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: "12h" });
  return res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role
    }
  });
});

app.get("/api/admin/overview", authRequired, adminOnly, async (_req, res) => {
  const users = await get("SELECT COUNT(*) AS count FROM users");
  const successfulLogins = await get("SELECT COUNT(*) AS count FROM login_history WHERE status = 'success'");
  const jobs = await get("SELECT COUNT(*) AS count FROM jobs");
  const apiCalls = await get("SELECT COUNT(*) AS count FROM api_logs");
  return res.json({
    totalUsers: users?.count || 0,
    successfulLogins: successfulLogins?.count || 0,
    totalJobs: jobs?.count || 0,
    apiCalls: apiCalls?.count || 0
  });
});

app.get("/api/admin/login-history", authRequired, adminOnly, async (_req, res) => {
  const rows = await all(
    "SELECT id, username, role, status, ip, domain, created_at FROM login_history ORDER BY id DESC LIMIT 100"
  );
  return res.json(rows);
});

app.get("/api/admin/api-logs", authRequired, adminOnly, async (_req, res) => {
  const rows = await all("SELECT id, method, path, status_code, ip, created_at FROM api_logs ORDER BY id DESC LIMIT 150");
  return res.json(rows);
});

app.get("/api/admin/jobs", authRequired, adminOnly, async (_req, res) => {
  const rows = await all("SELECT * FROM jobs ORDER BY id DESC");
  return res.json(rows);
});

app.post("/api/admin/jobs", authRequired, adminOnly, async (req, res) => {
  const { title, company, location, type } = req.body || {};
  if (!title || !company) return res.status(400).json({ message: "title and company are required" });
  const result = await run("INSERT INTO jobs (title, company, location, type) VALUES (?, ?, ?, ?)", [
    title,
    company,
    location || "India",
    type || "Full Time"
  ]);
  const created = await get("SELECT * FROM jobs WHERE id = ?", [result.lastID]);
  return res.status(201).json(created);
});

app.delete("/api/admin/jobs/:id", authRequired, adminOnly, async (req, res) => {
  await run("DELETE FROM jobs WHERE id = ?", [req.params.id]);
  return res.json({ ok: true });
});

app.get("/api/admin/settings", authRequired, adminOnly, async (_req, res) => {
  const rows = await all("SELECT key, value, updated_at FROM settings");
  return res.json(rows);
});

app.put("/api/admin/settings/:key", authRequired, adminOnly, async (req, res) => {
  const { value } = req.body || {};
  if (typeof value === "undefined") return res.status(400).json({ message: "value is required" });
  await run(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
    [req.params.key, String(value)]
  );
  const updated = await get("SELECT key, value, updated_at FROM settings WHERE key = ?", [req.params.key]);
  return res.json(updated);
});

app.get("/api/admin/users", authRequired, adminOnly, async (_req, res) => {
  const rows = await all(
    "SELECT id, username, role, preferred_domain, created_at, last_login FROM users ORDER BY id DESC"
  );
  return res.json(rows);
});

app.patch("/api/admin/users/:id/role", authRequired, adminOnly, async (req, res) => {
  const { role } = req.body || {};
  if (!["admin", "user"].includes(role)) return res.status(400).json({ message: "role must be admin or user" });
  await run("UPDATE users SET role = ? WHERE id = ?", [role, req.params.id]);
  const updated = await get(
    "SELECT id, username, role, preferred_domain, created_at, last_login FROM users WHERE id = ?",
    [req.params.id]
  );
  return res.json(updated);
});

app.post("/api/emails/send", authRequired, async (req, res) => {
  const { to, subject, html, from } = req.body || {};
  if (!to || !subject || !html) {
    return res.status(400).json({ message: "to, subject, and html are required" });
  }

  try {
    const result = await resend.emails.send({
      from: from || "onboarding@resend.dev",
      to,
      subject,
      html
    });
    return res.json({ message: "Email sent successfully", result });
  } catch (error) {
    return res.status(500).json({ message: "Failed to send email", error: error.message });
  }
});

app.use(express.static(__dirname));

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

seedDatabase()
  .then(() => {
    app.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`NCS server running on http://localhost:${PORT}`);
      // eslint-disable-next-line no-console
      console.log("Default admin login => username: admin, password: admin@123");
    });
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("Failed to initialize database:", error);
    process.exit(1);
  });
