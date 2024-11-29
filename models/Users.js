const mongoose = require('mongoose');

const Users = new mongoose.Schema({
    username: { type: String, required: true },
    email: { type: String, required: false },
    password: { type: String, required: true },
    usedInvite: { type: String },
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date }
});

const Invitates = mongoose.model('Users', Users);

module.exports = Invitates;
