package com.example.cli;

import com.example.cli.controller.CommandController;
import com.example.cli.controller.CommandController.CommandRequest;
import com.example.cli.controller.CommandController.CommandResponse;
import com.example.cli.repository.TaskRepository;
import com.example.cli.repository.UserRepository;
import com.example.cli.util.PasswordUtil;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.ResponseEntity;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class CommandControllerTest {

    @Autowired
    private CommandController commandController;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private TaskRepository taskRepository;

    @BeforeEach
    void setUp() {
        taskRepository.deleteAll();
        userRepository.deleteAll();
    }

    private CommandResponse sendCommand(String cmd) {
        CommandRequest req = new CommandRequest();
        req.setCommand(cmd);
        ResponseEntity<CommandResponse> resp = commandController.executeCommand(req);
        assertNotNull(resp.getBody());
        return resp.getBody();
    }

    @Test
    void testPasswordUtil() {
        String salt = PasswordUtil.generateSalt();
        assertNotNull(salt);
        assertEquals(32, salt.length()); // 16 bytes in hex

        String hash = PasswordUtil.hashPassword("mypassword", salt);
        assertNotNull(hash);

        assertTrue(PasswordUtil.verifyPassword("mypassword", salt, hash));
        assertFalse(PasswordUtil.verifyPassword("wrongpassword", salt, hash));
        assertFalse(PasswordUtil.verifyPassword(null, salt, hash));
    }

    @Test
    void testHelpAndClear() {
        CommandResponse helpResp = sendCommand("help");
        assertTrue(helpResp.isSuccess());
        assertTrue(helpResp.getOutput().contains("<username> <password> create"));

        CommandResponse clearResp = sendCommand("clear");
        assertTrue(clearResp.isSuccess());
        assertEquals("", clearResp.getOutput());
    }

    @Test
    void testUserCreation() {
        // Create user
        CommandResponse resp = sendCommand("mizan mypassword create");
        assertTrue(resp.isSuccess());
        assertTrue(resp.getOutput().contains("created successfully"));

        // Verify password hash in DB is not plaintext
        var user = userRepository.findByUsername("mizan").orElseThrow();
        assertNotEquals("mypassword", user.getPasswordHash());
        assertTrue(PasswordUtil.verifyPassword("mypassword", user.getPasswordSalt(), user.getPasswordHash()));

        // Try duplicate user creation
        CommandResponse dupResp = sendCommand("mizan otherpass create");
        assertFalse(dupResp.isSuccess());
        assertTrue(dupResp.getOutput().contains("already exists"));
    }

    @Test
    void testAuthenticationFailures() {
        // Unknown user
        CommandResponse resp1 = sendCommand("unknown userpass list");
        assertFalse(resp1.isSuccess());
        assertTrue(resp1.getOutput().contains("Authentication failed"));

        // Create user
        sendCommand("mizan mypassword create");

        // Wrong password
        CommandResponse resp2 = sendCommand("mizan wrongpassword list");
        assertFalse(resp2.isSuccess());
        assertTrue(resp2.getOutput().contains("Authentication failed"));
    }

    @Test
    void testDeprecatedLoginCommand() {
        CommandResponse resp = sendCommand("mizan mypassword login");
        assertFalse(resp.isSuccess());
        assertTrue(resp.getOutput().contains("login"));
    }

    @Test
    void testFullWorkflowAccordingToSpec() {
        // 1. Create account
        CommandResponse createResp = sendCommand("mizan mypassword create");
        assertTrue(createResp.isSuccess());

        // 2. List empty tasks
        CommandResponse listEmpty = sendCommand("mizan mypassword list");
        assertTrue(listEmpty.isSuccess());
        assertTrue(listEmpty.getOutput().contains("No tasks found"));

        // 3. Add tasks
        CommandResponse add1 = sendCommand("mizan mypassword add task Finish the project documentation");
        assertTrue(add1.isSuccess());
        assertTrue(add1.getOutput().contains("Finish the project documentation"));

        CommandResponse add2 = sendCommand("mizan mypassword add task Study COLMAP");
        assertTrue(add2.isSuccess());

        CommandResponse add3 = sendCommand("mizan mypassword add task Buy groceries");
        assertTrue(add3.isSuccess());

        CommandResponse add4 = sendCommand("mizan mypassword add task Submit assignment");
        assertTrue(add4.isSuccess());

        // 4. List tasks - verify 1-based serial numbers exactly as specified
        CommandResponse listResp = sendCommand("mizan mypassword list");
        assertTrue(listResp.isSuccess());
        String expected = "1. Finish the project documentation\n2. Study COLMAP\n3. Buy groceries\n4. Submit assignment";
        assertEquals(expected, listResp.getOutput());

        // 5. Delete task 4 (Submit assignment)
        CommandResponse delResp = sendCommand("mizan mypassword delete task 4");
        assertTrue(delResp.isSuccess());
        assertTrue(delResp.getOutput().contains("Task #4 deleted: \"Submit assignment\""));

        // 6. List tasks again - should now have 3 tasks re-indexed 1..3
        CommandResponse listAfterDel = sendCommand("mizan mypassword list");
        assertTrue(listAfterDel.isSuccess());
        String expectedAfterDel = "1. Finish the project documentation\n2. Study COLMAP\n3. Buy groceries";
        assertEquals(expectedAfterDel, listAfterDel.getOutput());

        // 7. Try deleting invalid task number 4 (now out of bounds)
        CommandResponse invalidDel = sendCommand("mizan mypassword delete task 4");
        assertFalse(invalidDel.isSuccess());
        assertTrue(invalidDel.getOutput().contains("Task #4 not found"));
    }
}
