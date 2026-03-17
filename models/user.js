const dotenv = require('dotenv');
const mongoose = require('mongoose');

// Load environment variables
dotenv.config();

const userSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true,
    trim: true,
  },
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'groups',
    default: new mongoose.Types.ObjectId(process.env.ID_GROUP_DEFAULT),
    required: true,
  },
  username: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
  },
  enterpriseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'enterprises',
  },
  IsBan: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  updatedBy: {
    type: String,
    default: "system",
  },

});

const User = mongoose.model("users", userSchema);
module.exports = User;