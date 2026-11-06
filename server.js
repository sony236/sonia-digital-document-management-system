require("dotenv").config();
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const uploadDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

// The database and all four required tables are created automatically at startup.
let pool;
const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "root1122",
  database: process.env.DB_NAME || "digital_document_management",
  waitForConnections: true,
  connectionLimit: 10
};

async function initializeDatabase() {
  const connection = await mysql.createConnection({
    host: dbConfig.host,
    user: dbConfig.user,
    password: dbConfig.password
  });
  const dbName = dbConfig.database.replace(/`/g, "");
  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await connection.changeUser({ database: dbName });

  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      user_id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(100) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'user'
    )`,
    `CREATE TABLE IF NOT EXISTS categories (
      category_id INT AUTO_INCREMENT PRIMARY KEY,
      category_name VARCHAR(100) NOT NULL UNIQUE,
      description VARCHAR(255)
    )`,
    `CREATE TABLE IF NOT EXISTS document (
      document_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      category_id INT NOT NULL,
      title VARCHAR(150) NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      file_path VARCHAR(255) NOT NULL,
      upload_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status VARCHAR(200) NOT NULL DEFAULT 'Active',
      CONSTRAINT fk_document_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      CONSTRAINT fk_document_category FOREIGN KEY (category_id) REFERENCES categories(category_id) ON DELETE RESTRICT,
      INDEX idx_document_title (title),
      INDEX idx_document_upload_date (upload_date)
    )`,
    `CREATE TABLE IF NOT EXISTS document_access (
      access_id INT AUTO_INCREMENT PRIMARY KEY,
      document_id INT NOT NULL,
      user_id INT NOT NULL,
      permission VARCHAR(20) NOT NULL DEFAULT 'view',
      granted_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_access_document FOREIGN KEY (document_id) REFERENCES document(document_id) ON DELETE CASCADE,
      CONSTRAINT fk_access_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      CONSTRAINT uq_document_user UNIQUE (document_id, user_id)
    )`
  ];
  for (const sql of statements) await connection.query(sql);
  await connection.query(
    `INSERT IGNORE INTO categories (category_name, description) VALUES
    ('Personal','Personal and identity-related documents'),
    ('Education','Certificates, notes and academic documents'),
    ('Work','Office and professional documents'),
    ('Finance','Bills, invoices and financial records'),
    ('Other','Documents that do not fit another category')`
  );
  await connection.end();
  pool = mysql.createPool(dbConfig);
  console.log('MySQL connected. Database and required tables are ready.');
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-development-secret",
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: false, maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, "public")));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}-${safe}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /pdf|png|jpe?g|txt|docx?|xlsx?|pptx?|csv/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = /pdf|image\/(png|jpeg)|text\/plain|msword|officedocument|spreadsheet|presentation|csv/.test(file.mimetype);
    cb(extOk && mimeOk ? null : new Error("Unsupported file type. Upload PDF, image, text, Office or CSV files."), extOk && mimeOk);
  }
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Please sign in first." });
  next();
}
function canManage(doc, user) {
  return user.role === "admin" || doc.user_id === user.user_id;
}
async function getDocumentAccess(documentId, userId) {
  const [rows] = await pool.execute(
    "SELECT permission FROM document_access WHERE document_id=? AND user_id=?",
    [documentId, userId]
  );
  return rows[0]?.permission || null;
}
async function canReadDocument(doc, user) {
  if (canManage(doc, user)) return true;
  return Boolean(await getDocumentAccess(doc.document_id, user.user_id));
}

app.get("/api/me", (req, res) => res.json({ user: req.session.user || null }));

app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name?.trim() || !email?.trim() || !password || password.length < 8)
      return res.status(400).json({ error: "Enter your name, a valid email and a password of at least 8 characters." });
    const hash = await bcrypt.hash(password, 12);
    const [result] = await pool.execute(
      "INSERT INTO users (name,email,password,role) VALUES (?,?,?,'user')",
      [name.trim(), email.trim().toLowerCase(), hash]
    );
    req.session.user = { user_id: result.insertId, name: name.trim(), email: email.trim().toLowerCase(), role: "user" };
    res.json({ message: "Account created successfully.", user: req.session.user });
  } catch (e) {
    console.error("Registration error:", e);
    res.status(e.code === "ER_DUP_ENTRY" ? 409 : 500).json({
      error: e.code === "ER_DUP_ENTRY" ? "This email is already registered. Please sign in instead." : "Registration failed. Check the MySQL connection and .env settings, then see the VS Code terminal."
    });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const [rows] = await pool.execute("SELECT * FROM users WHERE email=?", [email]);
    if (!rows.length || !(await bcrypt.compare(req.body.password || "", rows[0].password)))
      return res.status(401).json({ error: "Invalid email or password." });
    const u = rows[0];
    req.session.user = { user_id: u.user_id, name: u.name, email: u.email, role: u.role };
    res.json({ message: "Signed in successfully.", user: req.session.user });
  } catch (e) {
    console.error("Login error:", e);
    res.status(500).json({ error: "Login failed. Check the MySQL connection and .env settings, then see the VS Code terminal." });
  }
});
app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ message: "Signed out." })));

app.get("/api/categories", requireAuth, async (_req, res) => {
  const [rows] = await pool.execute("SELECT * FROM categories ORDER BY category_name");
  res.json(rows);
});
app.post("/api/categories", requireAuth, async (req, res) => {
  try {
    const name = String(req.body.category_name || "").trim();
    const description = String(req.body.description || "").trim();
    if (!name) return res.status(400).json({ error: "Category name is required." });
    const [r] = await pool.execute("INSERT INTO categories (category_name,description) VALUES (?,?)", [name, description]);
    res.status(201).json({ category_id: r.insertId, category_name: name, description });
  } catch (e) { res.status(500).json({ error: e.code === "ER_DUP_ENTRY" ? "Category already exists." : "Could not add category." }); }
});

app.get("/api/documents", requireAuth, async (req, res) => {
  try {
    const q = `%${String(req.query.q || "").trim()}%`;
    const category = req.query.category ? Number(req.query.category) : null;
    const [rows] = await pool.execute(
      `SELECT DISTINCT d.document_id,d.user_id,d.category_id,d.title,d.file_name,d.upload_date,d.status,
       c.category_name,u.name AS owner_name
       FROM document d JOIN categories c ON c.category_id=d.category_id
       JOIN users u ON u.user_id=d.user_id
       LEFT JOIN document_access a ON a.document_id=d.document_id AND a.user_id=?
       WHERE (d.user_id=? OR a.access_id IS NOT NULL OR ?='admin')
       AND (d.title LIKE ? OR d.file_name LIKE ? OR c.category_name LIKE ?)
       AND (? IS NULL OR d.category_id=?)
       ORDER BY d.upload_date DESC`,
      [req.session.user.user_id, req.session.user.user_id, req.session.user.role, q, q, q, category, category]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: "Could not load documents." }); }
});

app.post("/api/documents", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a file to upload." });
  try {
    const title = String(req.body.title || "").trim();
    const categoryId = Number(req.body.category_id);
    if (!title || !categoryId) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Title and category are required." });
    }
    const [cats] = await pool.execute("SELECT category_id FROM categories WHERE category_id=?", [categoryId]);
    if (!cats.length) { fs.unlinkSync(req.file.path); return res.status(400).json({ error: "Choose a valid category." }); }
    const relativePath = path.relative(__dirname, req.file.path);
    const [r] = await pool.execute(
      "INSERT INTO document (user_id,category_id,title,file_name,file_path,status) VALUES (?,?,?,?,?,'Active')",
      [req.session.user.user_id, categoryId, title, req.file.originalname, relativePath]
    );
    res.status(201).json({ message: "Document uploaded.", document_id: r.insertId });
  } catch { if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); res.status(500).json({ error: "Upload failed." }); }
});

app.get("/api/documents/:id/download", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT * FROM document WHERE document_id=?", [Number(req.params.id)]);
    if (!rows.length) return res.status(404).json({ error: "Document not found." });
    const doc = rows[0];
    if (!canManage(doc, req.session.user)) {
      const permission = await getDocumentAccess(doc.document_id, req.session.user.user_id);
      if (permission !== "download") return res.status(403).json({ error: "Download permission has not been granted for this document." });
    }
    const absolute = path.resolve(__dirname, doc.file_path);
    if (!absolute.startsWith(uploadDir + path.sep) || !fs.existsSync(absolute)) return res.status(404).json({ error: "Stored file is missing." });
    res.download(absolute, rows[0].file_name);
  } catch { res.status(500).json({ error: "Download failed." }); }
});

app.delete("/api/documents/:id", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT * FROM document WHERE document_id=?", [Number(req.params.id)]);
    if (!rows.length || !canManage(rows[0], req.session.user)) return res.status(403).json({ error: "Only the owner or admin can delete this document." });
    const absolute = path.resolve(__dirname, rows[0].file_path);
    await pool.execute("DELETE FROM document WHERE document_id=?", [rows[0].document_id]);
    if (absolute.startsWith(uploadDir + path.sep) && fs.existsSync(absolute)) fs.unlinkSync(absolute);
    res.json({ message: "Document deleted." });
  } catch { res.status(500).json({ error: "Delete failed." }); }
});

app.get("/api/documents/:id/access", requireAuth, async (req, res) => {
  try {
    const [docs] = await pool.execute("SELECT * FROM document WHERE document_id=?", [Number(req.params.id)]);
    if (!docs.length || !canManage(docs[0], req.session.user)) return res.status(403).json({ error: "Only the owner or admin can manage access." });
    const [rows] = await pool.execute(
      "SELECT a.access_id,a.user_id,u.name,u.email,a.permission,a.granted_date FROM document_access a JOIN users u ON u.user_id=a.user_id WHERE a.document_id=? ORDER BY a.granted_date DESC",
      [req.params.id]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: "Could not load access list." }); }
});

app.post("/api/documents/:id/access", requireAuth, async (req, res) => {
  try {
    const docId = Number(req.params.id), email = String(req.body.email || "").trim().toLowerCase();
    const permission = req.body.permission === "download" ? "download" : "view";
    const [docs] = await pool.execute("SELECT * FROM document WHERE document_id=?", [docId]);
    if (!docs.length || !canManage(docs[0], req.session.user)) return res.status(403).json({ error: "Only the owner or admin can grant access." });
    const [users] = await pool.execute("SELECT user_id FROM users WHERE email=?", [email]);
    if (!users.length) return res.status(404).json({ error: "No registered user found with that email." });
    if (users[0].user_id === docs[0].user_id) return res.status(400).json({ error: "The owner already has access." });
    await pool.execute(
      `INSERT INTO document_access (document_id,user_id,permission) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE permission=VALUES(permission),granted_date=CURRENT_TIMESTAMP`,
      [docId, users[0].user_id, permission]
    );
    res.json({ message: "Access granted." });
  } catch { res.status(500).json({ error: "Could not grant access." }); }
});

app.delete("/api/access/:accessId", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT a.*,d.user_id AS owner_id FROM document_access a JOIN document d ON d.document_id=a.document_id WHERE a.access_id=?",
      [Number(req.params.accessId)]
    );
    if (!rows.length || (req.session.user.role !== "admin" && rows[0].owner_id !== req.session.user.user_id))
      return res.status(403).json({ error: "Only the owner or admin can revoke access." });
    await pool.execute("DELETE FROM document_access WHERE access_id=?", [req.params.accessId]);
    res.json({ message: "Access revoked." });
  } catch { res.status(500).json({ error: "Could not revoke access." }); }
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "File must be 10 MB or smaller." : err.message });
  res.status(400).json({ error: err.message || "Request error." });
});

initializeDatabase()
  .then(() => {
    app.listen(PORT, () => console.log(`Digital Document Management System running at http://localhost:${PORT}`));
  })
  .catch((error) => {
    console.error("\\nDATABASE STARTUP FAILED:", error.message);
    console.error("Check that MySQL Server is running and your .env DB_HOST, DB_USER and DB_PASSWORD are correct.");
    process.exit(1);
  });
