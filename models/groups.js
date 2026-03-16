const mongoose = require('mongoose');

const groupsSchema = new mongoose.Schema({
  lib: {
    type: String,
    required: true,
    trim: true,
  },
  hasPage: {
    type: Boolean,
    default: false,
  },
  rights: {
    type: Array,
    default: [
      "home_r",
      "dashboard_r",
    ]
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

const Group = mongoose.model("groups", groupsSchema);
module.exports = Group;