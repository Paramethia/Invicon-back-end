require('dotenv').config();
const cors = require('cors');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const Invites = require('./models/Invitates');
const Users = require('./models/Users');
const paypal = require('@paypal/checkout-server-sdk');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { MailerSend, EmailParams, Sender, Recipient } = require('mailersend');

const ex = express();
ex.use(express.json());
ex.use(cors({
    origin: ["https://invicon.lol", "https://invicon.netlify.app"],
    methods: ['GET', 'POST'],
    credentials: true
}));

mongoose.connect(process.env.CLUSTER_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    tlsInsecure: true,
});

const Environment = process.env.NODE_ENV === "production"? paypal.core.LiveEnvironment : paypal.core.SandboxEnvironment;

const paypalClient = new paypal.core.PayPalHttpClient( new Environment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET ));

const mailerSend = new MailerSend({
    apiKey: process.env.MLSN_API_KEY,
});

const sendFrom = new Sender("invicon@test-xkjn41mn8kp4z781.mlsender.net", "Invicon");

// Testing route

ex.get('/ping', async (req, res) => {
    res.status(200).json({ status: "ok" })
})

// Registration route

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

// Log in route

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

// Password reset request route

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
                <p> If you did not request this, please ignore this email and your password will remain unchanged. </p>
            `);

        await mailerSend.email.send(emailParams);
        res.json({ message: "Password reset email sent" });
    } catch (err) {
        console.error("Error sending email:", err);
        res.status(500).json({ message: "Error sending email" });
    }
});

// Password reset route

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

// Home page routes

const generateInviteId = () => {
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

ex.post('/invite-check', async (req, res) => {
    const { username, inviteId } = req.body;

    try {   
        const inviter = await Invites.findOne({ inviteId });
            
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

ex.post('/fetch-stats', async (req, res) => {
    const {username} = req.body;

    try {
        const inviter = await Invites.findOne({ username });

        if (!inviter) return res.status(404).json({ message: 'Username not found' });

        res.json({ invites: inviter.invites, tier: inviter.tier });
    } catch (error) {
        console.error('Error fetching invite data:', error);
    }
});

    // Paypal payment

ex.post('/create-order', async (req, res) => {
  const { tier } = req.body;

  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer("return=representation");
  request.requestBody({
    intent: "CAPTURE",
    purchase_units: [{
      amount: {
        currency_code: "USD",
        value: tier.price.toString()
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

    // Stripe payment

ex.post('/create-payment-intent', async (req, res) => {
    const { amount, username, tier } = req.body;

    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount,
            currency: 'usd',
            metadata: { username, tier },
            automatic_payment_methods: { enabled: true },
        });

        res.json({ clientSecret: paymentIntent.client_secret });
    } catch (err) {
        console.error('Stripe error:', err);
        res.status(500).json({ error: err.message });
    }
});

ex.post('/update-tier', async (req, res) => {
    const { username, tier } = req.body;

    try {
        const inviter = await Invites.findOne({ username });

        if (!inviter) {
            return res.status(404).json({ message: "User not found" });
        }

        inviter.tier = tier;
        await inviter.save();

        res.json({ message: "Tier updated successfully", tier: inviter.tier });
    } catch (err) {
        console.error("Error updating tier:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Dashboard route

ex.post('/invites', async (req, res) => {
    const { username } = req.body;

    try {
        const inviter = await Invites.findOne({ username });

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

// Rewards route

ex.post('/getTier', async (req, res) => {
    const { username } = req.body;

    try {
        const inviter = await Invites.findOne({ username });

        if (inviter) {
            res.json({ message: "User found.", tier: inviter.tier });
        } else {
            res.status(402).json({ message: "User not found." });
        }
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

ex.listen(process.env.PORT, () => {
    console.log("Server listening on port:", process.env.PORT);
});
