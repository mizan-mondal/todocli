package com.example.cli;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class CliApplication {

    public static void main(String[] args) {
        SpringApplication.run(CliApplication.class, args);
        System.out.println("=================================================");
        System.out.println("🚀 Todo CLI Backend running at: http://localhost:8080");
        System.out.println("📚 H2 Console available at:     http://localhost:8080/h2-console");
        System.out.println("⚡ Command API endpoint:        http://localhost:8080/api/command");
        System.out.println("=================================================");
    }
}
