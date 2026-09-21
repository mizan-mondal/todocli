// Task.java
import java.time.LocalDateTime;

public class Task {
    private Long id;
    private String username;
    private String taskName;
    private boolean completed;
    private LocalDateTime createdAt = LocalDateTime.now();

    public Task() {
    }

    public Task(String username, String taskName) {
        this.username = username;
        this.taskName = taskName;
        this.completed = false;
        this.createdAt = LocalDateTime.now();
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getTaskName() {
        return taskName;
    }

    public void setTaskName(String taskName) {
        this.taskName = taskName;
    }

    public boolean isCompleted() {
        return completed;
    }

    public void setCompleted(boolean completed) {
        this.completed = completed;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }
}
