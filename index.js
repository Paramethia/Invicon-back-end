require('dotenv').config();
const cors = require('cors');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const Invites = require('./models/Invitates');
const Users = require('./models/Users');
const paypal = require('@paypal/checkout-server-sdk');
const { MailerSend, EmailParams, Sender, Recipient } = require('mailersend');

const ex = express();
ex.use(express.json());
ex.use(cors({
    origin: ["https://invicon.lol", "https://invicon.netlify.app"],
    methods: ['GET', 'POST'],
    credentials: true
}));

let clusterURL = "mongodb+srv://paramethia:PCx48Hh.u7e-_zM@mycluster.ahfaufe.mongodb.net/invicon?retryWrites=true&w=majority&appName=MyCluster";

mongoose.connect(clusterURL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    tlsInsecure: true,
});

const Environment = process.env.NODE_ENV === "production"
  ? paypal.core.LiveEnvironment
  : paypal.core.SandboxEnvironment;

const paypalClient = new paypal.core.PayPalHttpClient(
  new Environment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
);

// Function to clear the database
const clearDatabase = async () => {
    try {
        // Remove all documents from the collection
        await Users.deleteMany({});
        await Invites.deleteMany({});
        console.log('Database cleared successfully');
    } catch (error) {
        console.error('Error clearing the database:', error);
    } finally {
        // Disconnect from the database
        //mongoose.disconnect();
    }
};

//clearDatabase();

const mailerSend = new MailerSend({
    apiKey: process.env.MailerSEND_API_KEY,
});

const sendFrom = new Sender("invicon@test-xkjn41mn8kp4z781.mlsender.net", "Invicon");

// Testing route

ex.get('/ping', async (req, res) => {
    res.status(200).json({ status: "ok" })
})

// Register page function

ex.post('/register', async (req, res) => {
    const { username, email, password, usedInvite } = req.body;

    try {
        // Check if the username is already taken
        const userName = await Users.findOne({ username });
        if (userName) {
            return res.json("Username already taken.");
        }

        // If email is provided, check if it's already registered
        if (email) {
            const userEmail = await Users.findOne({ email });
            if (userEmail) {
                return res.json("Account already registered.");
            }
        }

        // Create the new user object, include email only if provided
        const newUserData = {
            username,
            password,
            usedInvite
        };
        
        // Add the email field only if it's provided
        if (email) {
            newUserData.email = email;
        }
        
        // Save the user
        const newUser = new Users(newUserData);
        await newUser.save();

        res.json("Registered.");
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Internal server error." });
    }
});


// Log in page function

ex.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await Users.findOne({ username });
        if (user) {
            if (user.password === password) {
                return res.json("Correct username and password.");
            } else {
                return res.json("");
            }
        } else {
            return res.json("Unregistered user.");
        }
    } catch (err) {
        res.status(500).json(err);
    }
});

// Password reset request page function

ex.post('/request-password-reset', async (req, res) => {
    const { email } = req.body;

    try {
        const user = await Users.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const token = crypto.randomBytes(32).toString('hex');
        user.resetPasswordToken = token;
        user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
        await user.save();

        const resetLink = `https://invicon.netlify.app/reset?token=${token}`;

        const recipients = [new Recipient(email, "User")];
        const emailParams = new EmailParams()
            .setFrom(sendFrom)
            .setTo(recipients)
            .setReplyTo(sendFrom)
            .setSubject("Password Reset")
            .setHtml(`
                <h1> Invicon password reset request </h1>
                <p> You are receiving this because you (or someone else) have requested the reset of the password for your account. </p>
                <p> Please click on the following link to reset your password: </p>
                <p><a href="${resetLink}">${resetLink}</a></p>
                <p>If you did not request this, please ignore this email and your password will remain unchanged.</p>
            `);

        await mailerSend.email.send(emailParams);
        res.json({ message: "Password reset email sent" });
    } catch (err) {
        console.error("Error sending email:", err);
        res.status(500).json({ message: "Error sending email" });
    }
});

// Passwrod reset page function

ex.post('/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;

    try {
        const user = await Users.findOne({
            resetPasswordToken: token,
            resetPasswordExpires: { $gt: Date.now() },
        });
        
        if (!user) {
            return res.status(400).json("Password reset token is invalid or has expired");
        }

        user.password = newPassword;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();
        res.json("Password has been reset");
    } catch (err) {
        res.status(500).json(err);
    }
});

// Home page functions

let generateInviteId = () => {
    // Logic to generate a unique invite Id
    return `${Math.random().toString(35).substring(2, 10)}`;
}

ex.post('/generate-invite', async (req, res) => {
    const {username} = req.body;
    const inviteId = generateInviteId();

    try {
        let inviter = await Invites.findOne({ username });

        if (inviter) {
            // If an inviteId already exists for the username, return the existing Id with link
            return res.json({ inviteLink: `https://invicon.netlify.app/register?inviteId=${inviter.inviteId}` });
        } else {
             const newInvite = new Invites({
                username,
                inviteId: inviteId
            });
        
            await newInvite.save();
            res.json({ inviteLink: `https://invicon.netlify.app/register?inviteId=${newInvite.inviteId}` });
        }
    } catch (err) {
        console.error('Error generating invite link:', err);
        res.status(500).json({ message: "Internal server error" });
    }
});

const tierUpdate = (inviter) => {
    if (inviter.invites >= 100) {
        inviter.tier = 8;
    } else if (inviter.invites >= 85) {
        inviter.tier = 7;
    } else if (inviter.invites >= 70) {
        inviter.tier = 6;
    } else if (inviter.invites >= 50) {
        inviter.tier = 5
    } else if (inviter.invites >= 35) {
        inviter.tier = 4;
    } else if (inviter.invites >= 20) {
        inviter.tier = 3;
    } else if (inviter.invites >= 10) {
        inviter.tier = 2;
    } else if (inviter.invites >= 5) {
        inviter.tier = 1;
    } else {
        inviter.tier = 0;
    }
};

// Home, Dashboard and Leaks page functions

ex.post('/invite-check', async (req, res) => {
    const { username, inviteId } = req.body;

    try {   
        let inviter = await Invites.findOne({ inviteId });
            
        if (inviter) {
            // Increment the invites count and assign the user who used it

            inviter.invites++; 
            inviter.usedBy.push({ username });

            tierUpdate(inviter);

            await inviter.save();
            res.json({ message: "Code found and updated data." });
        } else { 
            res.status(402).json({ message: "Invalid invite code." });
        }
    } catch (err) {
        res.status(500).json(err);
    }
});

ex.post('/invite-data', async (req, res) => {
    const {username} = req.body;

    try {
        let inviter = await Invites.findOne({ username });

        if (!inviter) {
            return res.status(404).json({ message: 'Invite data not found' });
        }

        res.json({ invites: inviter.invites, tier: inviter.tier });
    } catch (error) {
        console.error('Error fetching invite data:', error);
    }
});

ex.post('/create-order', async (req, res) => {
  const { price } = req.body;

  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer("return=representation");
  request.requestBody({
    intent: "CAPTURE",
    purchase_units: [{
      amount: {
        currency_code: "USD",
        value: price.toString()
      }
    }]
  });

  try {
    const order = await paypalClient.execute(request);
    res.status(200).json({ orderId: order.result.id });
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});


ex.post('/capture-order', async (req, res) => {
  const { orderId, username, tier } = req.body;

  const request = new paypal.orders.OrdersCaptureRequest(orderId);
  request.requestBody({});

  try {
    const capture = await paypalClient.execute(request);

    if (capture.result.status === "COMPLETED") {
      const inviter = await Invites.findOne({ username });
      if (!inviter) return res.status(404).json({ message: "User not found" });

      inviter.tier = tier;
      await inviter.save();

      return res.json({ message: "Payment successful, tier updated." });
    } else {
      return res.status(400).json({ message: "Payment not completed." });
    }
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

ex.post('/invites', async (req, res) => {
    const { username } = req.body;

    try {
        let inviter = await Invites.findOne({ username });

        if (inviter) {
            if (inviter.invites >= 1) {
                res.json({ invitees: inviter.usedBy });
            } else {
                res.json({ message: "No invites yet." });
            }
        } else {
            res.status(402).json({ message: "Inviter not found." });
        } 
    } catch (error) {
        console.error("Error checking invites:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

ex.post('/getTier', async (req, res) => {
    const { username } = req.body;

    try {
        let inviter = await Invites.findOne({ username });

        if (inviter) {
            res.json({ message: "User found.", tier: inviter.tier });
        } else {
            res.status(402).json({ message: "User not found." });
        }
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});


const clientPage = path.join(__dirname + '/client/build/index.html');
ex.get('*', (req, res) => {
    res.sendFile(clientPage);
});

ex.listen(process.env.PORT, () => {
    console.log("Server listening on port:", process.env.PORT);
});
