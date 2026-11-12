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
    displayName: { type: String, trim: true, maxlength: 50, default: '' },
    username: { type: String, trim: true, lowercase: true, maxlength: 30, unique: true, sparse: true, index: true },
    district: { type: String, trim: true, maxlength: 60, default: '' },
    state: { type: String, trim: true, maxlength: 60, default: '' },
    dob: { type: Date, default: null },
    age: { type: Number, min: 6, max: 100, default: null },
    bio: { type: String, trim: true, maxlength: 150, default: '' },
    cricketProfile: {
      playingRole: { type: String, enum: ['Batsman', 'Bowler', 'All-rounder', 'Wicketkeeper', ''], default: '' },
      battingStyle: { type: String, enum: ['Right-hand bat', 'Left-hand bat', ''], default: '' },
      bowlingStyle: { type: String, enum: ['Fast', 'Medium', 'Spin', 'None', ''], default: '' },
      jerseyNumber: { type: Number, min: 0, max: 999, default: null },
      favouritePlayer: { type: String, trim: true, maxlength: 60, default: '' },
      clubName: { type: String, trim: true, maxlength: 80, default: '' }
    },
    organizerProfile: {
      orgName: { type: String, trim: true, maxlength: 100, default: '' },
      orgLogoUrl: { type: String, default: '' }
    },
    linkedPlayerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', default: null },
    isActive: { type: Boolean, default: true },
    proExpiresAt: { type: Date, default: null },
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
        showPhoneToOrganizers: { type: Boolean, default: false },
        showPhone: { type: Boolean, default: false },
        showAge: { type: Boolean, default: true },
        showLocation: { type: Boolean, default: true }
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
