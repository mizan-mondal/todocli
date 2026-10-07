# todocli &mdash; Web-Based Command-Line To-Do List

A web-based command-line interface (CLI) for a to-do list application powered by a **Supabase PostgreSQL Cloud Database** to access your tasks from anywhere, featuring an authentic terminal interface and browser-only session persistence.

---

## 🔑 Key Design Principle & Cloud Storage Architecture

> **All application data (users, tasks) lives in Supabase Cloud PostgreSQL. The browser ONLY stores the active login session locally offline.**

- **Accessible from Anywhere**: Your tasks and accounts are stored in Supabase in the cloud, allowing you to access and manage your tasks from any device or browser.
- **Zero Local Data Hoarding**: Tasks and user accounts are **never** stored in browser storage. Every `list`, `add task`, and `delete task` command operates directly against Supabase.
- **Browser-Only Offline Session Persistence**:
  - Typing `<username> <password> login` validates your credentials with Supabase and stores **only** the login session (`todocli_session`) in the browser (`localStorage`).
  - When returning to the terminal or refreshing the page, your session is remembered without needing to re-login.
  - If already logged in, attempting to log in again with the same username displays `"<username>" already logged in !`.
  - The terminal prompt dynamically displays `<username>:~$`.
  - While logged in, shortcut commands (`list`, `add task <name>`, `delete task <number>`, `whoami`, `logout`) are available without re-typing credentials.
- **Logout**:
  - Typing `<username> <password> logout` or `logout` clears the session from browser storage and restores the prompt to `todocli:~$`.
- **Security & Salted Password Hashing**: Plaintext passwords are never stored. The Supabase `users` table stores salted SHA-256 password hashes generated with cryptographically secure 16-byte random salts.
- **Display Numbers vs. Database IDs**: Tasks are ordered deterministically and assigned 1-based serial numbers (`1., 2., 3. ...`). Deleting a task uses this serial number, which safely maps to internal database IDs.

---

## 📂 Project Architecture

```text
todocli/
├── supabase/
│   └── schema.sql                                # Supabase SQL schema (users, tasks, indexes, RLS policies)
├── src/                                          # Frontend source files (Vite)
│   ├── main.js                                   # Terminal controller & command dispatcher
│   ├── supabase.js                               # Supabase client, queries, & salted crypto operations
│   └── style.css                                 # Modern authentic terminal stylesheet
├── cli-frontend/                                 # Standalone CDN distribution
│   ├── index.html
│   ├── script.js
│   └── style.css
├── cli-backend/                                  # Optional Java Spring Boot REST API & Command Engine
├── index.html                                    # Terminal web interface
├── .env.example                                  # Environment variables template
└── README.md
```

---

## ⚡ Setting Up Supabase

### 1. Create a Supabase Project
1. Go to [supabase.com](https://supabase.com) and create a free project.
2. In the Supabase Dashboard, go to **SQL Editor** &rarr; **New Query**.
3. Copy and run the SQL script located in [`supabase/schema.sql`](file:///c:/Users/mizan/Desktop/todocli/supabase/schema.sql). This creates the `users` and `tasks` tables, deterministic indexes, and RLS policies.

### 2. Configure Credentials (Admin Access via Vercel / Environment)
Database connection credentials are treated as administrative configuration and are managed securely via environment settings (never exposed to public terminal users):

- **Local Development**: Add your project credentials to `.env`:
  ```env
  VITE_SUPABASE_URL=https://your-project-id.supabase.co
  VITE_SUPABASE_ANON_KEY=your-anon-key-here
  ```
- **Production (Vercel)**: In your Vercel Project Dashboard, navigate to **Settings** &rarr; **Environment Variables** and add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

---

## 💻 CLI Commands Reference

| Command Syntax | Description | Example |
|---|---|---|
| `<username> <password> create` | Register a new user account | `mizan mypassword create` |
| `<username> <password> login` | Log in and persist session offline in browser | `mizan mypassword login` |
| `<username> <password> logout` | Log out and clear browser session | `mizan mypassword logout` |
| `<username> <password> list` / `ls` | List all tasks with serial numbers | `mizan mypassword list` |
| `<username> <password> add task <task_name>` | Add a new task | `mizan mypassword add task Buy groceries` |
| `<username> <password> delete task <task_numbers>` | Delete one or more tasks using serial numbers | `mizan mypassword delete task 1,2,5` |
| `<username> <password> priority <from> to <to>` | Reorder a task by moving it to a new priority position | `mizan mypassword priority 3 to 1` |
| **When Logged In (Shortcut Commands)** | | |
| `list` / `ls` | List tasks for the currently logged-in user | `ls` |
| `add task <task_name>` | Add a task for the currently logged-in user | `add task Buy coffee` |
| `delete task <task_numbers>` | Delete one or more tasks using 1-based serial numbers | `delete task 1,2,5` |
| `priority <from> to <to>` | Move task to a new priority position | `priority 3 to 1` |
| `whoami` | Display active logged-in user | `whoami` |
| `logout` | Log out the active session | `logout` |
| **Utilities** | | |
| `clear` / `cls` | Clear the terminal display | `clear` |
| `help` | Display the command usage manual | `help` |

---

## 🚀 Getting Started (Development)

Start the local dev server using Vite:
```bash
npm run dev
```
Then open `http://localhost:5173/` in any browser.

---

## 🌐 Production Deployment

Since **todocli** connects directly to your Supabase PostgreSQL cloud database, the frontend compiles into a completely static, high-performance web application bundle.

### 1. Test the Production Build Locally
Verify the production build works before deploying:
```bash
npm run build
npm run preview
```
This builds into `dist/` and runs a local preview server on `http://localhost:4173/`.

### 2. Deploy to Vercel
1. Push your repository to GitHub.
2. Go to [vercel.com](https://vercel.com) &rarr; **Add New Project** &rarr; Select this repository.
3. In **Environment Variables**, add:
   - `VITE_SUPABASE_URL`: `https://your-project-id.supabase.co`
   - `VITE_SUPABASE_ANON_KEY`: `your-anon-key`
4. Click **Deploy**. Vercel will build and host your app with global edge CDN caching, instant deploys, and free automatic SSL.

*(Alternatively, deploy directly from CLI: `npx vercel`)*

### 🔒 Production Security Checklist
- [x] **Never commit your `.env` file**: `.env` is already added to `.gitignore`. Always configure production secrets in your hosting platform's environment settings.
- [x] **Row Level Security (RLS) & Stored Procedures**: Ensure you have executed `supabase/schema.sql` in your Supabase dashboard so tables are protected by RLS policies and mutations go through `SECURITY DEFINER` functions.
- [x] **Client-Side Secret Safety**: Only the Supabase `anon` public key is bundled in the frontend. Never expose your Supabase `service_role` secret key.
- [x] **Multi-Tier Rate Limiting**:
  - **Authentication Lockout**: 5 failed login attempts in 60s locks out the account for 30s across client, backend, and PostgreSQL database.
  - **Registration Flood Protection**: Rejects more than 10 new user accounts per 60-second window.
  - **Request Throttling**: Limits clients to a maximum of 20 database requests per 10-second sliding window.