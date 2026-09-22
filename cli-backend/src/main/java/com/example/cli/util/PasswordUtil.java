package com.example.cli.util;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.security.spec.InvalidKeySpecException;
import java.util.HexFormat;

public final class PasswordUtil {

    private static final int ITERATIONS = 65536;
    private static final int KEY_LENGTH = 256;
    private static final int SALT_BYTES = 16;
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private PasswordUtil() {
    }

    public static String generateSalt() {
        byte[] salt = new byte[SALT_BYTES];
        SECURE_RANDOM.nextBytes(salt);
        return HexFormat.of().formatHex(salt);
    }

    public static String hashPassword(String password, String hexSalt) {
        try {
            byte[] salt = HexFormat.of().parseHex(hexSalt);
            PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, ITERATIONS, KEY_LENGTH);
            SecretKeyFactory skf = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
            byte[] hash = skf.generateSecret(spec).getEncoded();
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException | InvalidKeySpecException e) {
            throw new IllegalStateException("Error hashing password with PBKDF2", e);
        }
    }

    public static boolean verifyPassword(String password, String hexSalt, String expectedHexHash) {
        if (password == null || hexSalt == null || expectedHexHash == null) {
            return false;
        }
        String computedHex = hashPassword(password, hexSalt);
        byte[] a = HexFormat.of().parseHex(computedHex);
        byte[] b = HexFormat.of().parseHex(expectedHexHash);
        return MessageDigest.isEqual(a, b);
    }
}
