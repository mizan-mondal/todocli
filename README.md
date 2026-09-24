# todocli &mdash; Web-Based Command-Line To-Do List

A web-based command-line interface (CLI) for a to-do list application featuring an authentic terminal interface and a Java Spring Boot backend with H2 database persistence.

---

## 🔑 Key Design Principle & Authentication Model

> **Supports both per-command credentials and optional browser-persisted login sessions.**

- **Per-command credentials**: You can run any command directly with:
  ```text
  username password <operation> [sub-command] [data]
  ```
- **Optional Login & Browser Persistence**:
  - Typing `<username> <password> login` authenticates and saves the login session in the browser (`localStorage`).
  - On future browser visits or refreshes, the session remains active automatically so you don't have to log in again.
  - The terminal prompt dynamically updates from `todocli:~$` to `<username>:~$`.
  - While logged in, convenient shortcut commands are enabled (`list`, `add task <name>`, `delete task <number>`, `whoami`, `logout`).
- **Logout**:
  - Typing `<username> <password> logout` or `logout` clears the session from browser storage and restores the prompt to `todocli:~$`.
- **Security & Password Hashing**: Plaintext passwords are never stored. The database stores salted password hashes (PBKDF2 with 65,536 iterations and a 16-byte cryptographically secure random salt in backend, and Web Crypto salted SHA-256 in local fallback).
- **Display Numbers vs. Database IDs**: When listing tasks, tasks are ordered deterministically and assigned 1-based serial numbers (`1., 2., 3. ...`). Deleting a task uses this serial number, which the application safely maps to internal database IDs.

---

## 📂 Project Architecture

```text
todocli/
├── cli-backend/                                  # Spring Boot REST API & Command Engine
│   ├── pom.xml                                   # Maven configuration (Spring Boot 3.3.4, JPA, H2)
│   └── src/
│       ├── main/java/com/example/cli/
│       │   ├── CliApplication.java               # Spring Boot entry point
│       │   ├── controller/CommandController.java # CLI Command Controller with login/logout
│       │   ├── model/Task.java                   # JPA Task entity
│       │   ├── model/User.java                   # JPA User entity (username, passwordHash, passwordSalt)
│       │   ├── repository/TaskRepository.java    # Spring Data JPA Task repository
│       │   ├── repository/UserRepository.java    # Spring Data JPA User repository
│       │   └── util/PasswordUtil.java            # PBKDF2 salted password hashing & verification
│       └── test/java/com/example/cli/
│           └── CommandControllerTest.java        # Comprehensive unit & integration tests
├── cli-frontend/                                 # Standalone frontend distribution
│   ├── index.html
│   ├── script.js
│   └── style.css
├── src/                                          # Frontend source files (Vite)
│   ├── main.js                                   # Terminal controller, session & fallback engine
│   └── style.css                                 # Modern authentic terminal stylesheet
├── index.html                                    # Terminal web interface
└── README.md
```

---

## 💻 CLI Commands Reference

| Command Syntax | Description | Example |
|---|---|---|
| `<username> <password> create` | Register a new user account (stores salted hash) | `mizan mypassword create` |
| `<username> <password> login` | Log in and persist session credentials in the browser | `mizan mypassword login` |
| `<username> <password> logout` | Log out and remove saved session credentials from browser | `mizan mypassword logout` |
| `<username> <password> list` | List all tasks assigned to the user with serial numbers | `mizan mypassword list` |
| `<username> <password> add task <task_name>` | Add a new task (spaces permitted in task description) | `mizan mypassword add task Buy groceries` |
| `<username> <password> delete task <task_number>` | Delete a task using the 1-based serial number from `list` | `mizan mypassword delete task 4` |
| **When Logged In (Shortcut Commands)** | | |
| `list` | List tasks for the currently logged-in user | `list` |
| `add task <task_name>` | Add a task for the currently logged-in user | `add task Buy coffee` |
| `delete task <task_number>` | Delete a task using 1-based serial number | `delete task 2` |
| `whoami` | Display the current logged-in user | `whoami` |
| `logout` | Log out the active session | `logout` |
| **Terminal Utilities** | | |
| `clear` / `cls` | Clear the terminal display | `clear` |
| `help` | Display the command usage manual | `help` |

---

## 🚀 Getting Started

### 1. Running the Backend (Spring Boot)
Ensure Java 17+ is installed. In `cli-backend`:
```bash
mvn spring-boot:run
```
When running:
- **API Base**: `http://localhost:8080/api`
- **Command Endpoint**: `POST http://localhost:8080/api/command`
- **H2 Web Console**: `http://localhost:8080/h2-console` (JDBC URL: `jdbc:h2:mem:tododb`)

### 2. Running the Frontend
Start the local dev server using Vite:
```bash
npm run dev
```
Or open `index.html` directly in any browser.

> **Dual-Mode Sync**: If the backend is running, commands are sent directly to the Spring Boot service. If the backend is offline, the frontend provides a seamless local fallback utilizing browser Web Crypto API salted hashing and `localStorage`.