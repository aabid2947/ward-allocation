import { User } from "../models/User.js";

// Simple Login (no JWT, no bcrypt)
export const login = async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await User.findOne({ username, active: true });
    
    if (!user) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    // Simple password check (plain text - not secure, as requested)
    if (user.password !== password) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    // Return user data (excluding password)
    const userData = {
      _id: user._id,
      username: user.username,
      name: user.name,
      role: user.role
    };

    res.status(200).json({ user: userData, message: "Login successful" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get all users (for admin)
export const getUsers = async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create user
export const createUser = async (req, res) => {
  try {
    console.log("Creating user with data:", req.body);
    const newUser = new User(req.body);
    await newUser.save();
    
    const userData = {
      _id: newUser._id,
      username: newUser.username,
      name: newUser.name,
      role: newUser.role
    };
    
    res.status(201).json(userData);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};
