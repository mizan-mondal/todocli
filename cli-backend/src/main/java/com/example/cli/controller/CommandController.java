package com.example.cli.controller;

import com.example.cli.model.Task;
import com.example.cli.model.User;
import com.example.cli.repository.TaskRepository;
import com.example.cli.repository.UserRepository;
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

    @PostMapping("/command")
    public ResponseEntity<CommandResponse> executeCommand(@RequestBody CommandRequest request) {
        String raw = request.getCommand() != null ? request.getCommand().trim() : "";
        String username = (request.getUsername() != null && !request.getUsername().isBlank())
                ? request.getUsername().trim()
                : "guest";

        if (raw.isEmpty()) {
            return ResponseEntity.ok(new CommandResponse(true, "", taskRepository.findByUsername(username)));
        }

        String[] parts = raw.split("\\s+", 2);
        String action = parts[0].toLowerCase();
        String argument = parts.length > 1 ? parts[1].trim() : "";

        switch (action) {
            case "help":
                String helpText = String.join("\n",
                        "Available CLI Commands:",
                        "  add <task_name>     - Add a new task",
                        "  list                - List all your tasks",
                        "  done <task_id>      - Mark a task as completed",
                        "  delete <task_id>    - Remove a task",
                        "  clear               - Clear terminal screen",
                        "  user <username>     - Switch or set active username",
                        "  status              - View server & database statistics",
                        "  help                - Display this manual"
                );
                return ResponseEntity.ok(new CommandResponse(true, helpText, taskRepository.findByUsername(username)));

            case "add":
                if (argument.isEmpty()) {
                    return ResponseEntity.ok(new CommandResponse(false, "Error: Task description cannot be empty. Usage: add <task_name>", null));
                }
                Task newTask = new Task(username, argument);
                taskRepository.save(newTask);
                return ResponseEntity.ok(new CommandResponse(true,
                        String.format("✔ Task #%d created: \"%s\" (assigned to @%s)", newTask.getId(), newTask.getTaskName(), username),
                        taskRepository.findByUsername(username)));

            case "list":
            case "ls":
                List<Task> tasks = taskRepository.findByUsernameOrderByCreatedAtDesc(username);
                if (tasks.isEmpty()) {
                    return ResponseEntity.ok(new CommandResponse(true, "No tasks found for user @" + username + ". Type 'add <task>' to create one.", tasks));
                }
                StringBuilder sb = new StringBuilder();
                sb.append(String.format("Tasks for @%s (%d total):\n", username, tasks.size()));
                for (Task t : tasks) {
                    String status = t.isCompleted() ? "[DONE]" : "[TODO]";
                    sb.append(String.format("  #%-3d %-6s %s\n", t.getId(), status, t.getTaskName()));
                }
                return ResponseEntity.ok(new CommandResponse(true, sb.toString().trim(), tasks));

            case "done":
            case "check":
                if (argument.isEmpty()) {
                    return ResponseEntity.ok(new CommandResponse(false, "Usage: done <task_id>", null));
                }
                try {
                    Long id = Long.parseLong(argument);
                    Optional<Task> opt = taskRepository.findById(id);
                    if (opt.isPresent()) {
                        Task task = opt.get();
                        task.setCompleted(true);
                        taskRepository.save(task);
                        return ResponseEntity.ok(new CommandResponse(true,
                                String.format("✔ Task #%d marked as completed: \"%s\"", task.getId(), task.getTaskName()),
                                taskRepository.findByUsername(username)));
                    } else {
                        return ResponseEntity.ok(new CommandResponse(false, "Error: Task #" + id + " not found.", null));
                    }
                } catch (NumberFormatException e) {
                    return ResponseEntity.ok(new CommandResponse(false, "Error: Invalid task ID: " + argument, null));
                }

            case "delete":
            case "rm":
                if (argument.isEmpty()) {
                    return ResponseEntity.ok(new CommandResponse(false, "Usage: delete <task_id>", null));
                }
                try {
                    Long id = Long.parseLong(argument);
                    if (taskRepository.existsById(id)) {
                        taskRepository.deleteById(id);
                        return ResponseEntity.ok(new CommandResponse(true, "✔ Task #" + id + " deleted successfully.", taskRepository.findByUsername(username)));
                    } else {
                        return ResponseEntity.ok(new CommandResponse(false, "Error: Task #" + id + " not found.", null));
                    }
                } catch (NumberFormatException e) {
                    return ResponseEntity.ok(new CommandResponse(false, "Error: Invalid task ID: " + argument, null));
                }

            case "status":
                long totalTasks = taskRepository.count();
                long userTasks = taskRepository.findByUsername(username).size();
                String statusMsg = String.format("System Status: ONLINE\nActive User: @%s\nUser Tasks: %d\nGlobal Tasks in DB: %d",
                        username, userTasks, totalTasks);
                return ResponseEntity.ok(new CommandResponse(true, statusMsg, taskRepository.findByUsername(username)));

            default:
                return ResponseEntity.ok(new CommandResponse(false,
                        "Unknown command: '" + action + "'. Type 'help' to see available commands.", null));
        }
    }

    // Direct REST endpoints
    @GetMapping("/tasks")
    public List<Task> getTasks(@RequestParam(required = false, defaultValue = "guest") String username) {
        return taskRepository.findByUsernameOrderByCreatedAtDesc(username);
    }

    @PostMapping("/tasks")
    public Task createTask(@RequestBody Task task) {
        if (task.getUsername() == null || task.getUsername().isBlank()) {
            task.setUsername("guest");
        }
        return taskRepository.save(task);
    }

    @PutMapping("/tasks/{id}/toggle")
    public ResponseEntity<Task> toggleTask(@PathVariable Long id) {
        return taskRepository.findById(id)
                .map(t -> {
                    t.setCompleted(!t.isCompleted());
                    return ResponseEntity.ok(taskRepository.save(t));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/tasks/{id}")
    public ResponseEntity<Void> deleteTask(@PathVariable Long id) {
        if (taskRepository.existsById(id)) {
            taskRepository.deleteById(id);
            return ResponseEntity.noContent().build();
        }
        return ResponseEntity.notFound().build();
    }
}
