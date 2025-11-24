const mongoose = require('mongoose');

const Users = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String },
    password: { type: String, required: true },
    createdOn: { type: Date, required: true, default: Date.now },
    inviteId: { type: String, unique: true },
    tier: { type: Number, default: 0 },
    invitees: [{
        username: { type: String, unique: true },
        joinedOn: { type: Date, default: Date.now }
    }],
    usedInvite: { type: String },
    resetPasswordToken: String,
    resetPasswordExpires: Date
});

Users.methods.updateTier = function () {
    const i = this.invites;
    this.tier = i >= 100 ? 4 : i >= 20 ? 3 : i >= 10 ? 2 : i >= 5 ? 1 : 0;
};

module.exports = mongoose.model('Users', Users);
