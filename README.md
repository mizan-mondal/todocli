# todocli &mdash; Web-Based Command-Line To-Do List

A web-based command-line interface (CLI) for a to-do list application featuring an authentic terminal interface and a Java Spring Boot backend with H2 database persistence.

---

## 🔑 Key Design Principle & Authentication Model

> **Every request contains the user's username and password, so there is no separate login/session system.**

- **No `login` command**: There is no persistent session, cookie, or token storage.
- **Per-command credentials**: Every command begins with:
  ```text
  username password <operation> [sub-command] [data]
  ```
- **Security & Password Hashing**: Plaintext passwords are never stored. The database stores salted password hashes (PBKDF2 with 65,536 iterations and a 16-byte cryptographically secure random salt) for secure per-command authentication.
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
│       │   ├── controller/CommandController.java # Stateless CLI Command Controller
│       │   ├── model/Task.java                   # JPA Task entity
│       │   ├── model/User.java                   # JPA User entity (username, passwordHash, passwordSalt)
│       │   ├── repository/TaskRepository.java    # Spring Data JPA Task repository
│       │   ├── repository/UserRepository.java    # Spring Data JPA User repository
│       │   └── util/PasswordUtil.java            # PBKDF2 salted password hashing & verification
│       └── test/java/com/example/cli/
│           └── CommandControllerTest.java        # Comprehensive unit & integration tests
├── src/                                          # Frontend source files
│   ├── main.js                                   # Terminal controller & fallback engine
│   └── style.css                                 # Modern authentic terminal stylesheet
├── index.html                                    # Terminal web interface
└── README.md
```

---

## 💻 CLI Commands Reference

| Command Syntax | Description | Example |
|---|---|---|
| `<username> <password> create` | Register a new user account (stores salted hash) | `mizan mypassword create` |
| `<username> <password> list` | List all tasks assigned to the user with serial numbers | `mizan mypassword list` |
| `<username> <password> add task <task_name>` | Add a new task (spaces permitted in task description) | `mizan mypassword add task Buy groceries` |
| `<username> <password> delete task <task_number>` | Delete a task using the 1-based serial number from `list` | `mizan mypassword delete task 4` |
| `clear` / `cls` | Clear the terminal display | `clear` |
| `help` | Display the command usage manual | `help` |

> **Note on `login`**: The previously proposed command `username password login` has been removed. Each command is independently authenticated.

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