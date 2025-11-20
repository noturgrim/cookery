/**
 * Authentication Module
 * Handles user registration, login, and session management
 */

import bcrypt from "bcrypt";
import crypto from "crypto";
import {
  createUser,
  findUserByUsername,
  updateLastLogin,
  createSession,
  findSession,
  deleteSession,
  deleteUserSessions,
} from "./database.js";

// Configuration
const SALT_ROUNDS = 10; // bcrypt salt rounds
const SESSION_EXPIRY_HOURS = 168; // 7 days
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 128;

/**
 * Validate username format
 */
export const validateUsername = (username) => {
  if (!username || typeof username !== "string") {
    return { valid: false, error: "Username is required" };
  }

  const trimmed = username.trim();

  if (trimmed.length < 3) {
    return { valid: false, error: "Username must be at least 3 characters" };
  }

  if (trimmed.length > 50) {
    return { valid: false, error: "Username must be less than 50 characters" };
  }

  // Only allow alphanumeric, underscores, and hyphens
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return {
      valid: false,
      error:
        "Username can only contain letters, numbers, underscores, and hyphens",
    };
  }

  return { valid: true, sanitized: trimmed.toLowerCase() };
};

/**
 * Validate password format
 */
export const validatePassword = (password) => {
  if (!password || typeof password !== "string") {
    return { valid: false, error: "Password is required" };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      valid: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    };
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    return {
      valid: false,
      error: `Password must be less than ${MAX_PASSWORD_LENGTH} characters`,
    };
  }

  return { valid: true };
};

/**
 * Validate display name format
 */
export const validateDisplayName = (displayName) => {
  if (!displayName || typeof displayName !== "string") {
    return { valid: false, error: "Display name is required" };
  }

  const trimmed = displayName.trim();

  if (trimmed.length < 1) {
    return { valid: false, error: "Display name cannot be empty" };
  }

  if (trimmed.length > 50) {
    return {
      valid: false,
      error: "Display name must be less than 50 characters",
    };
  }

  // Remove dangerous characters
  const sanitized = trimmed
    .replace(/<[^>]*>/g, "") // Remove HTML tags
    .replace(/[<>\"'`]/g, "") // Remove dangerous characters
    .replace(/\\/g, "") // Remove backslashes
    .trim();

  if (sanitized.length === 0) {
    return {
      valid: false,
      error: "Display name contains only invalid characters",
    };
  }

  return { valid: true, sanitized };
};

/**
 * Hash a password using bcrypt
 */
export const hashPassword = async (password) => {
  try {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    return hash;
  } catch (error) {
    console.error("❌ Error hashing password:", error);
    throw new Error("Failed to hash password");
  }
};

/**
 * Compare password with hash
 */
export const comparePassword = async (password, hash) => {
  try {
    const match = await bcrypt.compare(password, hash);
    return match;
  } catch (error) {
    console.error("❌ Error comparing password:", error);
    return false;
  }
};

/**
 * Generate secure session token
 */
export const generateSessionToken = () => {
  return crypto.randomBytes(64).toString("hex");
};

/**
 * Register a new user
 */
export const registerUser = async (
  username,
  password,
  displayName,
  skinIndex = 0
) => {
  try {
    // Validate username
    const usernameValidation = validateUsername(username);
    if (!usernameValidation.valid) {
      return { success: false, error: usernameValidation.error };
    }

    // Validate password
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return { success: false, error: passwordValidation.error };
    }

    // Validate display name
    const displayNameValidation = validateDisplayName(displayName);
    if (!displayNameValidation.valid) {
      return { success: false, error: displayNameValidation.error };
    }

    // Validate skin index
    if (typeof skinIndex !== "number" || skinIndex < 0 || skinIndex > 17) {
      return { success: false, error: "Invalid skin selection" };
    }

    // Check if username already exists
    const existingUser = await findUserByUsername(usernameValidation.sanitized);
    if (existingUser) {
      return { success: false, error: "Username already taken" };
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    const user = await createUser(
      usernameValidation.sanitized,
      passwordHash,
      displayNameValidation.sanitized,
      skinIndex
    );

    if (!user) {
      return { success: false, error: "Failed to create user" };
    }

    // Generate session token
    const sessionToken = generateSessionToken();

    // Create session
    const session = await createSession(
      sessionToken,
      user.id,
      SESSION_EXPIRY_HOURS
    );

    if (!session) {
      return { success: false, error: "Failed to create session" };
    }

    console.log(`✅ User registered: ${user.username}`);

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        skinIndex: user.skin_index,
      },
      sessionToken,
    };
  } catch (error) {
    console.error("❌ Registration error:", error);
    return { success: false, error: error.message || "Registration failed" };
  }
};

/**
 * Login user
 */
export const loginUser = async (username, password) => {
  try {
    // Validate username
    const usernameValidation = validateUsername(username);
    if (!usernameValidation.valid) {
      return { success: false, error: "Invalid username or password" };
    }

    // Find user
    const user = await findUserByUsername(usernameValidation.sanitized);
    if (!user) {
      return { success: false, error: "Invalid username or password" };
    }

    // Compare password
    const passwordMatch = await comparePassword(password, user.password_hash);
    if (!passwordMatch) {
      return { success: false, error: "Invalid username or password" };
    }

    // Update last login
    await updateLastLogin(user.id);

    // Generate session token
    const sessionToken = generateSessionToken();

    // Create session
    const session = await createSession(
      sessionToken,
      user.id,
      SESSION_EXPIRY_HOURS
    );

    if (!session) {
      return { success: false, error: "Failed to create session" };
    }

    console.log(`✅ User logged in: ${user.username}`);

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        skinIndex: user.skin_index,
      },
      sessionToken,
    };
  } catch (error) {
    console.error("❌ Login error:", error);
    return { success: false, error: "Login failed" };
  }
};

/**
 * Validate session token
 */
export const validateSession = async (token) => {
  try {
    if (!token || typeof token !== "string") {
      return { valid: false, error: "No session token provided" };
    }

    const session = await findSession(token);
    if (!session) {
      return { valid: false, error: "Invalid or expired session" };
    }

    return {
      valid: true,
      user: {
        id: session.user_id,
        username: session.username,
        displayName: session.display_name,
        skinIndex: session.skin_index,
      },
    };
  } catch (error) {
    console.error("❌ Session validation error:", error);
    return { valid: false, error: "Session validation failed" };
  }
};

/**
 * Logout user (delete session)
 */
export const logoutUser = async (token) => {
  try {
    if (!token || typeof token !== "string") {
      return { success: false, error: "No session token provided" };
    }

    await deleteSession(token);
    console.log(`✅ User logged out`);

    return { success: true };
  } catch (error) {
    console.error("❌ Logout error:", error);
    return { success: false, error: "Logout failed" };
  }
};

/**
 * Logout user from all devices (delete all sessions)
 */
export const logoutAllDevices = async (userId) => {
  try {
    await deleteUserSessions(userId);
    console.log(`✅ User logged out from all devices: ${userId}`);

    return { success: true };
  } catch (error) {
    console.error("❌ Logout all devices error:", error);
    return { success: false, error: "Logout failed" };
  }
};
