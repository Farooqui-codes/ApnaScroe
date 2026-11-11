const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    phone: { type: String, trim: true, default: '' },
    village: { type: String, trim: true, default: '' },
    passwordHash: { type: String, required: true, select: false },
    emailVerified: { type: Boolean, default: false },
    accountType: { type: String, enum: ['registered'], default: 'registered' },
    role: {
      type: String,
      enum: ['super_admin', 'organizer', 'team_manager', 'scorer', 'viewer'],
      default: 'scorer',
      index: true
    },
    avatarUrl: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    preferences: {
      language: { type: String, enum: ['en', 'hi'], default: 'en' },
      theme: { type: String, enum: ['light', 'dark'], default: 'light' },
      outdoorMode: { type: Boolean, default: false },
      notifications: {
        matchUpdates: { type: Boolean, default: true },
        tournamentAlerts: { type: Boolean, default: true }
      },
      privacy: {
        showProfilePublicly: { type: Boolean, default: true },
        showPhoneToOrganizers: { type: Boolean, default: false }
      },
      defaultScoring: {
        overs: { type: Number, default: 6 },
        playersPerTeam: { type: Number, default: 11 },
        ballType: { type: String, default: 'tennis' },
        presetId: { type: String, default: 'village_6_over' },
        rules: { type: mongoose.Schema.Types.Mixed, default: null }
      }
    }
  },
  { timestamps: true }
);

userSchema.methods.toSafeJSON = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  return obj;
};

module.exports = mongoose.model('User', userSchema, 'users');
