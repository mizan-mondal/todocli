package com.example.cli.controller;

import com.example.cli.model.Task;
import com.example.cli.model.User;
import com.example.cli.repository.TaskRepository;
import com.example.cli.repository.UserRepository;
import com.example.cli.util.PasswordUtil;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class CommandController {

    private final TaskRepository taskRepository;
    private final UserRepository userRepository;

    public CommandController(TaskRepository taskRepository, UserRepository userRepository) {
        this.taskRepository = taskRepository;
        this.userRepository = userRepository;
    }

    public static class CommandRequest {
        private String command;
        private String username;

        public String getCommand() {
            return command;
        }

        public void setCommand(String command) {
            this.command = command;
        }

        public String getUsername() {
            return username;
        }

        public void setUsername(String username) {
            this.username = username;
        }
    }

    public static class CommandResponse {
        private boolean success;
        private String output;
        private List<Task> tasks;

        public CommandResponse(boolean success, String output, List<Task> tasks) {
            this.success = success;
            this.output = output;
            this.tasks = tasks;
        }

        public boolean isSuccess() {
            return success;
        }

        public String getOutput() {
            return output;
        }

        public List<Task> getTasks() {
            return tasks;
        }
    }

    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        Map<String, Object> status = new HashMap<>();
        status.put("status", "UP");
        status.put("users", userRepository.count());
        status.put("tasks", taskRepository.count());
        return ResponseEntity.ok(status);
    }

    @PostMapping("/command")
    public ResponseEntity<CommandResponse> executeCommand(@RequestBody CommandRequest request) {
        String raw = request.getCommand() != null ? request.getCommand().trim() : "";

        if (raw.isEmpty()) {
            return ResponseEntity.ok(new CommandResponse(true, "", null));
        }

        // Global Utility Commands (no credentials required)
        String lowerTrimmed = raw.toLowerCase();
        if (lowerTrimmed.equals("clear") || lowerTrimmed.equals("cls")) {
            return ResponseEntity.ok(new CommandResponse(true, "", null));
        }

        if (lowerTrimmed.equals("help")) {
            String helpText = String.join("\n",
                    "todocli Commands:",
                    "  <username> <password> create                   - Register a new account",
                    "  <username> <password> login                    - Log in and save session in browser",
                    "  <username> <password> logout                   - Log out and clear session",
                    "  <username> <password> list                     - List all tasks",
                    "  <username> <password> add task <task_name>     - Add a new task",
                    "  <username> <password> delete task <task_number>- Delete a task by number",
                    "",
                    "When Logged In (Shortcut Commands):",
                    "  list                                           - List your tasks",
                    "  add task <task_name>                           - Add a new task",
                    "  delete task <task_number>                      - Delete a task by number",
                    "  whoami                                         - Show current logged-in user",
                    "  logout                                         - Log out and clear session",
                    "",
                    "Utilities:",
                    "  clear / cls                                    - Clear terminal screen",
                    "  help                                           - Display this manual"
            );
            return ResponseEntity.ok(new CommandResponse(true, helpText, null));
        }

        // Parse command line: username password <operation> [arguments...]
        // Split on whitespace into at most 3 parts: username, password, remainder
        String[] parts = raw.split("\\s+", 3);
        if (parts.length < 3) {
            return ResponseEntity.ok(new CommandResponse(false,
                    "Error: Invalid command format.\nEvery command must start with: <username> <password> <operation> ...\nOr log in using: <username> <password> login\nType 'help' for available commands.",
                    null));
        }

        String username = parts[0];
        String password = parts[1];
        String remainder = parts[2].trim();

        // Split remainder into operation and arguments
        String[] remainderParts = remainder.split("\\s+", 2);
        String operation = remainderParts[0].toLowerCase();
        String opArgs = remainderParts.length > 1 ? remainderParts[1].trim() : "";

        // Account Creation: <username> <password> create
        if (operation.equals("create")) {
            if (userRepository.findByUsername(username).isPresent()) {
                return ResponseEntity.ok(new CommandResponse(false,
                        "Error: User '" + username + "' already exists.", null));
            }

            String salt = PasswordUtil.generateSalt();
            String hash = PasswordUtil.hashPassword(password, salt);
            User newUser = new User(username, hash, salt);
            userRepository.save(newUser);

            return ResponseEntity.ok(new CommandResponse(true,
                    "User '" + username + "' created successfully.", null));
        }

        // For all other operations, authenticate user credentials
        Optional<User> userOpt = userRepository.findByUsername(username);
        if (userOpt.isEmpty() || !PasswordUtil.verifyPassword(password, userOpt.get().getPasswordSalt(), userOpt.get().getPasswordHash())) {
            return ResponseEntity.ok(new CommandResponse(false,
                    "Authentication failed: Invalid username or password.", null));
        }

        // User is authenticated for this request. Execute operation:
        switch (operation) {
            case "login":
                return ResponseEntity.ok(new CommandResponse(true,
                        "User '" + username + "' logged in successfully.", null));

            case "logout":
                return ResponseEntity.ok(new CommandResponse(true,
                        "User '" + username + "' logged out successfully.", null));

            case "ls":
                List<Task> tasks = taskRepository.findByUsernameOrderByIdAsc(username);
                if (tasks.isEmpty()) {
                    return ResponseEntity.ok(new CommandResponse(true,
                            "No tasks found for user '" + username + "'.", tasks));
                }

                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < tasks.size(); i++) {
                    Task t = tasks.get(i);
                    sb.append(String.format("%d. %s", i + 1, t.getTaskName()));
                    if (i < tasks.size() - 1) {
                        sb.append("\n");
                    }
                }
                return ResponseEntity.ok(new CommandResponse(true, sb.toString(), tasks));

            case "add":
                // Expect: add task <task_name>
                if (opArgs.isEmpty()) {
                    return ResponseEntity.ok(new CommandResponse(false,
                            "Error: Missing sub-command. Usage: <username> <password> add task <task_name>", null));
                }

                String[] addParts = opArgs.split("\\s+", 2);
                String addKeyword = addParts[0].toLowerCase();
                String taskName = addParts.length > 1 ? addParts[1].trim() : "";

                if (!addKeyword.equals("task")) {
                    return ResponseEntity.ok(new CommandResponse(false,
                            "Error: Unknown sub-command '" + addKeyword + "'. Usage: <username> <password> add task <task_name>", null));
                }

                if (taskName.isEmpty()) {
                    return ResponseEntity.ok(new CommandResponse(false,
                            "Error: Task description cannot be empty. Usage: <username> <password> add task <task_name>", null));
                }

                Task newTask = new Task(username, taskName);
                taskRepository.save(newTask);
                List<Task> currentTasksAfterAdd = taskRepository.findByUsernameOrderByIdAsc(username);
                return ResponseEntity.ok(new CommandResponse(true,
                        String.format("Task added: \"%s\"", taskName), currentTasksAfterAdd));

            case "delete":
                // Expect: delete task <task_number>
                if (opArgs.isEmpty()) {
                    return ResponseEntity.ok(new CommandResponse(false,
                            "Error: Missing sub-command. Usage: <username> <password> delete task <task_number>", null));
                }

                String[] delParts = opArgs.split("\\s+", 2);
                String delKeyword = delParts[0].toLowerCase();
                String taskNumStr = delParts.length > 1 ? delParts[1].trim() : "";

                if (!delKeyword.equals("task")) {
                    return ResponseEntity.ok(new CommandResponse(false,
                            "Error: Unknown sub-command '" + delKeyword + "'. Usage: <username> <password> delete task <task_number>", null));
                }

                if (taskNumStr.isEmpty()) {
                    return ResponseEntity.ok(new CommandResponse(false,
                            "Error: Missing task number. Usage: <username> <password> delete task <task_number>", null));
                }

                int taskNumber;
                try {
                    taskNumber = Integer.parseInt(taskNumStr);
                } catch (NumberFormatException e) {
                    return ResponseEntity.ok(new CommandResponse(false,
                            "Error: Invalid task number '" + taskNumStr + "'. Must be a positive integer.", null));
                }

                List<Task> userTasks = taskRepository.findByUsernameOrderByIdAsc(username);
                if (taskNumber < 1 || taskNumber > userTasks.size()) {
                    return ResponseEntity.ok(new CommandResponse(false,
                            String.format("Error: Task #%d not found. Use '%s %s list' to view current tasks.",
                                     taskNumber, username, password), null));
                }

                // Map 1-based display serial number to internal database task
                Task targetTask = userTasks.get(taskNumber - 1);
                taskRepository.delete(targetTask);

                List<Task> remainingTasks = taskRepository.findByUsernameOrderByIdAsc(username);
                return ResponseEntity.ok(new CommandResponse(true,
                        String.format("Task #%d deleted: \"%s\"", taskNumber, targetTask.getTaskName()),
                        remainingTasks));

            default:
                return ResponseEntity.ok(new CommandResponse(false,
                        "Error: Unknown operation '" + operation + "'. Allowed operations: create, login, logout, list, add task, delete task. Type 'help' for usage.",
                        null));
        }
    }
}
