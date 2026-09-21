# todocli &mdash; Terminal Task Manager

A full-stack CLI Todo & Task Management application featuring an interactive web-based terminal interface and a Java Spring Boot backend with H2 database persistence.

---

## 📂 Project Architecture

```text
todocli/
├── cli-backend/                                  # Spring Boot REST API & Command Engine
│   ├── pom.xml                                   # Maven dependencies (Web, JPA, H2)
│   ├── src/
│   │   ├── CliApplication.java                   # Quick reference entry point
│   │   ├── CommandController.java                # Command controller stub
│   │   ├── TaskRepository.java                   # Task repository stub
│   │   ├── model/
│   │   │   ├── Task.java                         # Task entity
│   │   │   └── User.java                         # User entity
│   │   └── main/
│   │       ├── java/com/example/cli/             # Standard Maven Spring Boot source
│   │       │   ├── CliApplication.java           # @SpringBootApplication entry point
│   │       │   ├── controller/CommandController.java # Unified CLI & REST Controller
│   │       │   ├── model/Task.java               # JPA Task entity with getters/setters
│   │       │   ├── model/User.java               # JPA User entity with getters/setters
│   │       │   └── repository/TaskRepository.java# Spring Data JPA repository
│   │       └── resources/
│   │           └── application.properties        # Port 8080 & H2 database configuration
│   └── ...
└── cli-frontend/                                 # Interactive Web Terminal Emulator
    ├── index.html                                # Semantic layout with terminal & live task deck
    ├── style.css                                 # Cyberpunk/dark glassmorphic UI design
    └── script.js                                 # Command execution engine & dual-mode sync
```

---

## 🚀 Getting Started

### 1. Running the Frontend
The frontend can be opened directly in any browser:
- Open `cli-frontend/index.html` in your browser (via double click or Live Server).
- Or run using Vite:
  ```bash
  npx vite
  ```
  and navigate to `http://localhost:5173/cli-frontend/index.html`.

> **Note**: The frontend has automatic dual-mode fallback: if the backend is offline, it operates seamlessly in **Local Interactive Mode** with `localStorage` persistence.

### 2. Running the Backend (Spring Boot)
To run the backend with Java (port `8080`):
```bash
cd cli-backend
mvn spring-boot:run
```
When running:
- **API Base**: `http://localhost:8080/api`
- **Command Endpoint**: `POST http://localhost:8080/api/command`
- **H2 Web Console**: `http://localhost:8080/h2-console` (JDBC URL: `jdbc:h2:mem:tododb`)

---

## 💻 CLI Commands Reference

| Command | Arguments | Description |
|---|---|---|
| `help` | none | Displays the CLI help manual |
| `add` | `<task_name>` | Creates a new task |
| `list` / `ls` | none | Lists all tasks for the active user |
| `done` / `check` | `<task_id>` | Marks a task as completed |
| `delete` / `rm` | `<task_id>` | Removes a task |
| `user` | `<username>` | Switches the active user profile |
| `status` | none | Displays system health & task counts |
| `clear` / `cls` | none | Clears the terminal output screen |