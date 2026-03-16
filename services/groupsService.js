var jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');

const User = require('../models/user.js');
const Group = require('../models/groups.js');

dotenv.config();
const createAt = new Date();

module.exports = {

    createGroup: function (req, res, next) {
        const { lib, hasPage, rights } = req.body;

        if (!lib) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const newGroup = new Group({
            lib,
            hasPage,
            rights,
            createdAt: createAt,
            updatedAt: createAt,
            updatedBy: res.locals?.user?.id
        });

        newGroup.save()
            .then(group => res.status(201).json({ result: true, group}))
            .catch(err => res.status(500).json({ result: false, error: err.message }));
    },

    deleteGroup: function (req, res, next) {
        const groupId = req.params.id;

        Group.findByIdAndDelete(groupId)
            .then(result => {
                if (!result) {
                    return res.status(404).json({ result: false, error: 'Group not found' });
                }
                res.status(200).json({ result: true, message: 'Group deleted successfully' });
            })
            .catch(err => res.status(500).json({ result: false, error: err.message }));
    },

    updateGroup: function (req, res, next) {
        const groupId = req.params.id;
        const { lib, hasPage, rights } = req.body;

        Group.findByIdAndUpdate(groupId, { lib, hasPage, rights, updatedAt: createAt, updatedBy: res.locals?.user?.id }, { new: true })
            .then(group => {
                if (!group) {
                    return res.status(404).json({ result: false, error: 'Group not found' });
                }
                res.status(200).json({ result: true, group });
            })
            .catch(err => res.status(500).json({ result: false, error: err.message }));
    },

    getAllGroups: function (req, res, next) {
        Group.find()
            .then(groups => res.status(200).json({ result: true, groups }))
            .catch(err => res.status(500).json({ result: false, error: err.message }));
    },

    getById: function (req, res, next) {
        const groupId = req.params.id;

        Group.findById(groupId)
            .then(group => {
                if (!group) {
                    return res.status(404).json({ result: false, error: 'Group not found' });
                }
                res.status(200).json({ result: true, group });
            })
            .catch(err => res.status(500).json({ result: false, error: err.message }));
    },

}
