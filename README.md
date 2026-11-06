# SONIA YAPARALA — Digital Document Management System

Mini project using **HTML, CSS, JavaScript, Express.js and MySQL**.

## What is included
- Registration and login (passwords hashed using bcrypt)
- Document upload, category selection, search and download
- Share access with registered users and revoke access
- Owner/admin document deletion
- Responsive frontend
- MySQL schema for all four required tables

## Database tables
1. `users`: `user_id` (PK), `name`, `email`, `password`, `role`
2. `categories`: `category_id` (PK), `category_name`, `description`
3. `document`: `document_id` (PK), `user_id` (FK), `category_id` (FK), `title`, `file_name`, `file_path`, `upload_date`, `status`
4. `document_access`: `access_id` (PK), `document_id` (FK), `user_id` (FK), `permission`, `granted_date`

**Important:** The app now creates the database, all four tables, foreign keys and starter categories automatically when the server starts. You do not need to execute `database.sql` manually (it is included as a reference/manual setup script).

## Run on Windows
1. Extract this ZIP.
2. Open the extracted project folder in VS Code. Make sure the terminal path is the folder containing `package.json` and `server.js`.
3. Ensure MySQL Server is running.
4. Open `.env.example`, copy its contents into a new file named `.env` in the same folder as `server.js`.
5. In `.env`, set `DB_PASSWORD` to your actual MySQL root password. If your MySQL root account has no password, leave it blank after `DB_PASSWORD=`.
6. In VS Code terminal run:
   ```powershell
   npm install
   npm start
   ```
7. Wait for these messages:
   ```
   MySQL connected. Database and required tables are ready.
   Digital Document Management System running at http://localhost:3000
   ```
8. Open `http://localhost:3000` and choose **Create account**.

## If startup reports a database error
- `Access denied for user 'root'`: the `DB_PASSWORD` value in `.env` is wrong.
- `ECONNREFUSED`: MySQL Server is not running or `DB_HOST`/port is wrong.
- `Unknown database`: normally resolved automatically; confirm the MySQL user can create databases.
- After changing `.env`, stop the server with `Ctrl+C` and run `npm start` again.

## Sharing a document
The recipient must register first. Open **Access** beside a document you own, enter the recipient's registered email, choose View or Download, and grant access. The recipient can then see the shared document after signing in.

## Admin
New accounts are regular users. To promote an account, run this in MySQL Workbench:
```sql
UPDATE users SET role='admin' WHERE email='admin@example.com';
```
Sign out and sign in again for the new role to appear.

## File storage and safety
- Files are stored locally in `uploads/`.
- Maximum upload size: 10 MB.
- Never share your `.env` file or commit it to a public repository.
- This is a local mini-project/demo setup. A public production deployment needs HTTPS, persistent sessions, CSRF protection, stronger upload scanning and backups.
