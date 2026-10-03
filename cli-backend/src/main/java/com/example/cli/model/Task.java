package com.example.cli.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "tasks")
public class Task {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String username;
    private String taskName;
    private boolean completed = false;
    private LocalDateTime createdAt = LocalDateTime.now();
    private Integer position = 0;

    public Task() {
    }

    public Task(String username, String taskName) {
        this.username = username;
        this.taskName = taskName;
        this.completed = false;
        this.createdAt = LocalDateTime.now();
        this.position = 0;
    }

    public Task(String username, String taskName, Integer position) {
        this.username = username;
        this.taskName = taskName;
        this.completed = false;
        this.createdAt = LocalDateTime.now();
        this.position = position;
    }

    // Getters and Setters
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

    public Integer getPosition() {
        return position;
    }

    public void setPosition(Integer position) {
        this.position = position;
    }
}
