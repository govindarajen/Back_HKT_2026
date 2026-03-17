const mongoose = require('mongoose');

const enterpriseSchema = new mongoose.Schema({
  lib: {
    type: String,
    required: true,
    trim: true,
  },
  siret: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'users',
    required: true,
  },
  employees: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'users',
  }],
  createAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  isBanned: {
    type: Boolean,
    default: false,
  },
});

const Enterprise = mongoose.model('enterprises', enterpriseSchema);
module.exports = Enterprise;
