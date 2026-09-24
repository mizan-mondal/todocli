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

### 2. Configure Credentials
You can configure credentials in either of two ways:

- **Option A (Environment Variables)**: Add your project credentials to `.env`:
  ```env
  VITE_SUPABASE_URL=https://your-project-id.supabase.co
  VITE_SUPABASE_ANON_KEY=your-anon-key-here
  ```
- **Option B (Directly in the Terminal)**: Launch the app and run:
  ```text
  config supabase https://your-project-id.supabase.co your-anon-key-here
  ```

---

## 💻 CLI Commands Reference

| Command Syntax | Description | Example |
|---|---|---|
| `<username> <password> create` | Register a new user account in Supabase | `mizan mypassword create` |
| `<username> <password> login` | Log in and persist session offline in browser | `mizan mypassword login` |
| `<username> <password> logout` | Log out and clear browser session | `mizan mypassword logout` |
| `<username> <password> list` | List all tasks from Supabase with serial numbers | `mizan mypassword list` |
| `<username> <password> add task <task_name>` | Add a new task to Supabase | `mizan mypassword add task Buy groceries` |
| `<username> <password> delete task <task_number>` | Delete a task from Supabase using serial number | `mizan mypassword delete task 4` |
| **When Logged In (Shortcut Commands)** | | |
| `list` | List tasks for the currently logged-in user | `list` |
| `add task <task_name>` | Add a task for the currently logged-in user | `add task Buy coffee` |
| `delete task <task_number>` | Delete a task using 1-based serial number | `delete task 2` |
| `whoami` | Display active logged-in user | `whoami` |
| `logout` | Log out the active session | `logout` |
| **Configuration & Utilities** | | |
| `config supabase <url> <anon_key>` | Configure Supabase credentials in the terminal | `config supabase https://xyz.supabase.co eyJhb...` |
| `config supabase status` | Check current Supabase connection status | `config supabase status` |
| `config supabase clear` | Clear stored browser Supabase credentials | `config supabase clear` |
| `clear` / `cls` | Clear the terminal display | `clear` |
| `help` | Display the command usage manual | `help` |

---

## 🚀 Getting Started

Start the local dev server using Vite:
```bash
npm run dev
```
Then open `http://localhost:5173/` in any browser.