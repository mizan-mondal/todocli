package com.example.cli.controller;

import com.example.cli.model.Task;
import com.example.cli.model.User;
import com.example.cli.repository.TaskRepository;
import com.example.cli.repository.UserRepository;
import com.example.cli.util.PasswordUtil;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class CommandController {

    private final TaskRepository taskRepository;
    private final UserRepository userRepository;

    private static class AuthFailureRecord {
        int count;
        long firstAttemptTime;
        long lockedUntil;

        AuthFailureRecord(long firstAttemptTime) {
            this.count = 1;
            this.firstAttemptTime = firstAttemptTime;
            this.lockedUntil = 0;
        }
    }

    private final Map<String, AuthFailureRecord> authFailureMap = new java.util.concurrent.ConcurrentHashMap<>();
    private final java.util.concurrent.ConcurrentLinkedQueue<Long> registrationTimestamps = new java.util.concurrent.ConcurrentLinkedQueue<>();

    public void resetRateLimits() {
        authFailureMap.clear();
        registrationTimestamps.clear();
    }

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
                    "  <username> <password> list / ls                - List all tasks",
                    "  <username> <password> add task <task_name>     - Add a new task",
                    "  <username> <password> delete task <task_numbers>- Delete tasks by number (e.g. 1 or 1,2,5)",
                    "  <username> <password> priority <from> to <to>  - Reorder a task by moving it to a new position",
                    "",
                    "When Logged In (Shortcut Commands):",
                    "  list / ls                                      - List your tasks",
                    "  add task <task_name>                           - Add a new task",
                    "  delete task <task_numbers>                     - Delete tasks by number (e.g. 1 or 1,2,5)",
                    "  priority <from> to <to>                        - Move task to new priority position",
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
            long nowReg = System.currentTimeMillis();
            registrationTimestamps.removeIf(ts -> ts < nowReg - 60_000);
            if (registrationTimestamps.size() >= 10) {
                return ResponseEntity.ok(new CommandResponse(false,
                        "Error: Rate limit exceeded. Too many new accounts registered recently. Please wait a minute.", null));
            }

            if (userRepository.findByUsername(username).isPresent()) {
                return ResponseEntity.ok(new CommandResponse(false,
                        "Error: User '" + username + "' already exists.", null));
            }

            String salt = PasswordUtil.generateSalt();
            String hash = PasswordUtil.hashPassword(password, salt);
            User newUser = new User(username, hash, salt);
            userRepository.save(newUser);
            registrationTimestamps.add(nowReg);

            return ResponseEntity.ok(new CommandResponse(true,
                    "User '" + username + "' created successfully.", null));
        }

        // Check authentication rate limit (brute-force prevention)
        long now = System.currentTimeMillis();
        String lowerUser = username.toLowerCase();
        AuthFailureRecord record = authFailureMap.get(lowerUser);
        if (record != null && record.lockedUntil > now) {
            long waitSec = (record.lockedUntil - now + 999) / 1000;
            return ResponseEntity.ok(new CommandResponse(false,
                    "Error: Rate limit exceeded for user '" + username + "'. Too many failed attempts. Try again in " + waitSec + " seconds.", null));
        }

        // For all other operations, authenticate user credentials
        Optional<User> userOpt = userRepository.findByUsername(username);
        if (userOpt.isEmpty() || !PasswordUtil.verifyPassword(password, userOpt.get().getPasswordSalt(), userOpt.get().getPasswordHash())) {
            authFailureMap.compute(lowerUser, (k, v) -> {
                if (v == null || (now - v.firstAttemptTime) > 60_000) {
                    return new AuthFailureRecord(now);
                } else {
                    v.count++;
                    if (v.count >= 5) {
                        v.lockedUntil = now + 30_000;
                    }
                    return v;
                }
            });

            AuthFailureRecord updated = authFailureMap.get(lowerUser);
            if (updated != null && updated.lockedUntil > now) {
                return ResponseEntity.ok(new CommandResponse(false,
                        "Error: Rate limit exceeded. 5 failed login attempts. User '" + username + "' locked for 30 seconds.", null));
            }

            return ResponseEntity.ok(new CommandResponse(false,
                    "Authentication failed: Invalid username or password.", null));
        }

        // Reset rate limit tracking on successful authentication
        authFailureMap.remove(lowerUser);

        // User is authenticated for this request. Execute operation:
        switch (operation) {
            case "login":
                return ResponseEntity.ok(new CommandResponse(true,
                        "User '" + username + "' logged in successfully.", null));

            case "logout":
                return ResponseEntity.ok(new CommandResponse(true,
                        "User '" + username + "' logged out successfully.", null));

            case "list":
            case "ls":
                List<Task> tasks = taskRepository.findByUsernameOrderByPositionAscIdAsc(username);
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

                List<Task> currentTasksBeforeAdd = taskRepository.findByUsernameOrderByPositionAscIdAsc(username);
                int nextPos = currentTasksBeforeAdd.size() + 1;
                Task newTask = new Task(username, taskName, nextPos);
                taskRepository.save(newTask);
                List<Task> currentTasksAfterAdd = taskRepository.findByUsernameOrderByPositionAscIdAsc(username);
                return ResponseEntity.ok(new CommandResponse(true,
                        String.format("Task added: \"%s\"", taskName), currentTasksAfterAdd));

            case "delete":
                // Expect: delete task <task_number> or delete task <task_number,task_number,...>
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

                String[] rawTokens = taskNumStr.split("[,\\s]+");
                List<Integer> taskNumbers = new ArrayList<>();
                for (String token : rawTokens) {
                    if (token.isEmpty()) continue;
                    try {
                        int num = Integer.parseInt(token);
                        if (num < 1) {
                            return ResponseEntity.ok(new CommandResponse(false,
                                    "Error: Invalid task number '" + token + "'. Must be a positive integer.", null));
                        }
                        if (!taskNumbers.contains(num)) {
                            taskNumbers.add(num);
                        }
                    } catch (NumberFormatException e) {
                        return ResponseEntity.ok(new CommandResponse(false,
                                "Error: Invalid task number '" + token + "'. Must be a positive integer.", null));
                    }
                }

                if (taskNumbers.isEmpty()) {
                    return ResponseEntity.ok(new CommandResponse(false,
                            "Error: Missing task number. Usage: <username> <password> delete task <task_number>", null));
                }

                List<Task> userTasks = taskRepository.findByUsernameOrderByPositionAscIdAsc(username);
                for (int num : taskNumbers) {
                    if (num < 1 || num > userTasks.size()) {
                        return ResponseEntity.ok(new CommandResponse(false,
                                String.format("Error: Task #%d not found. Use '%s ******** list' to view current tasks.",
                                         num, username), null));
                    }
                }

                Collections.sort(taskNumbers);

                List<Task> tasksToDelete = new ArrayList<>();
                List<String> deletedMessages = new ArrayList<>();
                for (int num : taskNumbers) {
                    Task target = userTasks.get(num - 1);
                    tasksToDelete.add(target);
                    deletedMessages.add(String.format("Task #%d deleted: \"%s\"", num, target.getTaskName()));
                }

                taskRepository.deleteAll(tasksToDelete);

                Set<Long> deletedIds = tasksToDelete.stream().map(Task::getId).collect(Collectors.toSet());
                List<Task> remainingTasks = userTasks.stream()
                        .filter(t -> !deletedIds.contains(t.getId()))
                        .collect(Collectors.toList());

                for (int i = 0; i < remainingTasks.size(); i++) {
                    remainingTasks.get(i).setPosition(i + 1);
                }
                taskRepository.saveAll(remainingTasks);

                List<Task> finalRemainingTasks = taskRepository.findByUsernameOrderByPositionAscIdAsc(username);
                return ResponseEntity.ok(new CommandResponse(true,
                        String.join("\n", deletedMessages),
                        finalRemainingTasks));

            case "priority":
                // Expect: priority <from_number> to <to_number>
                if (opArgs.isEmpty()) {
                    return ResponseEntity.ok(new CommandResponse(false,
                            "Error: Missing arguments for priority. Usage: <username> <password> priority <from_number> to <to_number>", null));
                }

                java.util.regex.Pattern priorityPattern = java.util.regex.Pattern.compile("^(\\d+)\\s+to\\s+(\\d+)$", java.util.regex.Pattern.CASE_INSENSITIVE);
                java.util.regex.Matcher matcher = priorityPattern.matcher(opArgs);
                if (!matcher.matches()) {
                    return ResponseEntity.ok(new CommandResponse(false,
                            "Error: Invalid priority format. Usage: <username> <password> priority <from_number> to <to_number>", null));
                }

                int fromIndex;
                int toIndex;
                try {
                    fromIndex = Integer.parseInt(matcher.group(1));
                    toIndex = Integer.parseInt(matcher.group(2));
                } catch (NumberFormatException e) {
                    return ResponseEntity.ok(new CommandResponse(false,
                            "Error: Task numbers must be valid integers.", null));
                }

                if (fromIndex < 1 || toIndex < 1) {
                    return ResponseEntity.ok(new CommandResponse(false,
                            "Error: Task numbers must be positive integers.", null));
                }

                List<Task> currentTasks = taskRepository.findByUsernameOrderByPositionAscIdAsc(username);
                if (currentTasks.isEmpty()) {
                    return ResponseEntity.ok(new CommandResponse(false,
                            "No tasks found for user '" + username + "'.", null));
                }

                if (fromIndex > currentTasks.size()) {
                    return ResponseEntity.ok(new CommandResponse(false,
                            String.format("Error: Source task #%d not found. Valid range is 1 to %d.", fromIndex, currentTasks.size()),
                            null));
                }

                if (toIndex > currentTasks.size()) {
                    return ResponseEntity.ok(new CommandResponse(false,
                            String.format("Error: Target position #%d is out of bounds. Valid range is 1 to %d.", toIndex, currentTasks.size()),
                            null));
                }

                // Move task from fromIndex to toIndex (1-based to 0-based)
                Task moved = currentTasks.remove(fromIndex - 1);
                currentTasks.add(toIndex - 1, moved);

                // Re-sequence 1-based positions for entire stack
                for (int i = 0; i < currentTasks.size(); i++) {
                    currentTasks.get(i).setPosition(i + 1);
                }
                taskRepository.saveAll(currentTasks);

                List<Task> updatedTasks = taskRepository.findByUsernameOrderByPositionAscIdAsc(username);
                return ResponseEntity.ok(new CommandResponse(true,
                        String.format("Task #%d moved to position #%d: \"%s\"", fromIndex, toIndex, moved.getTaskName()),
                        updatedTasks));

            default:
                return ResponseEntity.ok(new CommandResponse(false,
                        "Error: Unknown operation '" + operation + "'. Allowed operations: create, login, logout, list, ls, add task, delete task, priority. Type 'help' for usage.",
                        null));
        }
    }
}
