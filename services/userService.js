var jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');

const User = require('../models/user.js');
const { get } = require('mongoose');
const { checkRights } = require('../generics/tools.js');

dotenv.config();
const createAt = new Date();

module.exports = {

    login: function(req, res, next) {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ result: false, message: 'Username and password are required' });
        }

        User.findOne({ username: username })
            .populate('groupId')
            .then(user => {
            if (!user) {
                return res.status(404).json({ result: false, message: 'User not found' });
            }
            const token = jwt.sign(
                { 
                    id: user._id, username: user.username, 
                    fullName: user.fullName,
                    groupId: user.groupId
                }, 
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRES_IN } 
                );

            // Check password
            bcrypt.compare(password, user.password).then(isMatch => {
                if (!isMatch) {
                    return res.status(401).json({ result: false, message: 'Invalid password' });
                }
                // Generate a token (this is just an example, use a secure secret in production)

                const userWithoutPassword = user.toObject();
                delete userWithoutPassword.password; // Remove password from response
    
                return res.status(200).json({ result: true, token: token, user: userWithoutPassword });
            
            }).catch(err => {
                return res.status(500).json({ result: false, message: err });
            });
        }).catch(err => {
            return res.status(500).json({ result: false, message: 'Internal server error' });
        });
    },

    register: async function(req, res, next) {
        const { fullName, username, password } = req.body;
        if (!fullName || !username || !password) {
            return res.status(400).json({ result: false, error: "Full name, username, and password are required" });
        };

        const hash = await bcrypt.hash(password, 10);

        User.findOne({ username: username })
            .populate('groupId')
            .then((user) => {
                if (user) {
                    return res.status(400).json({result: false, error: "User already exists"});
                }

            const newUser = new User({
                username: username.toLowerCase(),
                fullName,
                password: hash,
                createAt
            });

            newUser.save().then((savedUser) => {
                const token = jwt.sign(
                    { 
                        id: savedUser._id, username: savedUser.username, 
                        fullName: savedUser.fullName,
                        groupId: savedUser.groupId
                    }, 
                    process.env.JWT_SECRET,
                    { expiresIn: process.env.JWT_EXPIRES_IN } 
                    );

                token && res.status(200).json({ result: true, token: token, user: {username: savedUser.username, fullName: savedUser.fullName} });
            })
        });
    },

    changePassword: function(req, res, next) {

        const oldPassword = req.body.oldPassword;
        const newPassword = req.body.newPassword;
        const userId = res.locals.user.id;

        const fromAdmin = req.body.userId || false;


        if (!oldPassword || !newPassword) {
            return res.status(400).json({ result: false, message: 'Old and new passwords are required' });
        }

        if (fromAdmin && res.locals.user.groupId == 0) {
            User.findByIdAndUpdate(fromAdmin).then( (user) => {

                user.password = bcrypt.hashSync(newPassword, 10);
                user.save().then(() => {
                    return res.status(200).json({ result: true, message: 'Password changed successfully' });
                }).catch(err => {
                    console.error('Error saving user:', err);
                    return res.status(500).json({ result: false, message: 'Internal server error' });
                });
            })
        } else {
            User.findById(userId).then(user => {
                if (!user) {
                    return res.status(404).json({ result: false, message: 'User not found' });
                }

                // Check old password
                bcrypt.compare(oldPassword, user.password).then(isMatch => {
                    if (!isMatch) {
                        return res.status(401).json({ result: false, message: 'Invalid old password' });
                    }

                    // Update password
                    user.password = bcrypt.hashSync(newPassword, 10);
                    user.save().then(() => {
                        return res.status(200).json({ result: true, message: 'Password changed successfully' });
                    }).catch(err => {
                        console.error('Error saving user:', err);
                        return res.status(500).json({ result: false, message: 'Internal server error' });
                    });
                }).catch(err => {
                    console.error('Error comparing passwords:', err);
                    return res.status(500).json({ result: false, message: 'Internal server error' });
                });
            }).catch(err => {
                console.error('Error finding user:', err);
                return res.status(500).json({ result: false, message: 'Internal server error' });
            });
        }
    },

    getUsers: function(req, res, next) {

        User.find({}, { password: 0 })
        .populate('groupId')
        .then(users => {
            if (!users || users.length === 0) {
                return res.status(404).json({ result: false, message: 'No users found' });
            }
            return res.status(200).json({ result: true, token: res.locals.token, users });
        }).catch(err => {
            console.error('Error fetching users:', err);
            return res.status(500).json({ result: false, message: 'Internal server error' });
        });
    },

    getUserById: function(req, res, next) {
        const userId = res.locals.user.id;
        User.findById(userId, { password: 0 })
            .populate('groupId')
            .then(user => {
            if (!user) {
                return res.status(404).json({ result: false, message: 'User not found' });
            }
            return res.status(200).json({ result: true, token: res.locals.token, user });
        }).catch(err => {
            console.error('Error fetching user:', err);
            return res.status(500).json({ result: false, message: 'Internal server error' });
        });
    },

    updateUserPreferences: function(req, res, next) {
        const userId = res.locals.user.id;
        const { pref } = req.body;


        if (!pref) {
            return res.status(400).json({ result: false, message: 'Preferences are required' });
        } else {
            User.findById(userId)
            .populate('groupId')
            .then(user => {
                if (!user) {
                    return res.status(404).json({ result: false, message: 'User not found' });
                } else if (user._id.toString() !== userId) {
                    return res.status(403).json({ result: false, message: 'Forbidden' });
                }
                
                // Update user preferences
                user.pref = {
                        ...user.pref,
                        ...pref
                        };
                return user.save();
            })
            .then(updatedUser => {
                // Remove password from response
                const userWithoutPassword = updatedUser.toObject();
                delete userWithoutPassword.password;
                return res.status(200).json({ result: true, user: userWithoutPassword });
            })
            .catch(err => {
                console.error('Error updating user preferences:', err);
                return res.status(500).json({ result: false, message: 'Internal server error' });
            });
        }
    },

    updateUser: function(req, res, next) {
        const userBy = res.locals.user.id;

        const { userId, fields } = req.body;

        if (!userId) {
            return res.status(400).json({ result: false, message: 'User ID are required' });
        } else if (!checkRights(res.locals.user, userId)) {
            return res.status(403).json({ result: false, message: 'Forbidden' });
        }

        User.findByIdAndUpdate({ _id: userId }, {
            ...fields,
            updatedBy: userBy,
            updatedAt: new Date()
        }).populate('groupId').then(user => {
            if (!user) {
                return res.status(404).json({ result: false, message: 'User not found' });
            }
            // Remove password from response
            const userWithoutPassword = user.toObject();
            delete userWithoutPassword.password;

            return res.status(200).json({ result: true, user: userWithoutPassword });
        })

    },



    getUsersPages: function(req, res, next) {

        User.find({hasPage: true}, { password: 0 }).populate('groupId').then(users => {
            if (!users || users.length === 0) {
                return res.status(404).json({ result: false, message: 'No users found' });
            }

            const usersPages = users.map(user => {
                return {
                    pageUrl: user?.pref?.publicPageSettings?.pageUrl || user.username,
                    pageSettings: user?.pref?.publicPageSettings || {},
                };
            });

            return res.status(200).json({ result: true, usersPages });
        }).catch(err => {
            console.error('Error fetching users:', err);
            return res.status(500).json({ result: false, message: 'Internal server error' });
        })
    }
}