const mongoose = require('mongoose');

const Invites = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    inviteId: { type: String, required: true, unique: true },
    invites: { type: Number, default: 0 },
    tier: { type: Number, default: 0 },
    usedBy: [{ username: String }]
});

module.exports = mongoose.model('Invitations', Invites);
