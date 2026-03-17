const mongoose = require('mongoose');

const groupsSchema = new mongoose.Schema({
  lib: {
    type: String,
    required: true,
    trim: true,
  },
  rights: {
    type: Array,
    default: [
      "home_r",
      "dashboard_r",
      "dashboard_r",
      "document_upload",
      "document_r",
      "document_c",
      "document_w",
      "document_d",
      "enterprise_r",
      "enterprise_c",
      "enterprise_w",
      "enterprise_d"
    ]
  },
  enterpriseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'enterprises',
    required: true,
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