const mongoose = require('mongoose');

const pointsTableSchema = new mongoose.Schema(
  {
    tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true, index: true },
    groupName: { type: String, default: 'Group A' },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
    teamName: { type: String, required: true },
    played: { type: Number, default: 0 },
    won: { type: Number, default: 0 },
    lost: { type: Number, default: 0 },
    tied: { type: Number, default: 0 },
    noResult: { type: Number, default: 0 },
    points: { type: Number, default: 0 },
    netRunRate: { type: Number, default: 0 },
    runsScored: { type: Number, default: 0 },
    oversFacedDecimal: { type: Number, default: 0 },
    runsConceded: { type: Number, default: 0 },
    oversBowledDecimal: { type: Number, default: 0 },
    qualified: { type: Boolean, default: false }
  },
  { timestamps: true }
);

pointsTableSchema.index({ tournamentId: 1, teamId: 1 }, { unique: true });

module.exports = mongoose.model('PointsTable', pointsTableSchema, 'pointsTables');
