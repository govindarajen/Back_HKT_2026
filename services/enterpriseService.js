const Enterprise = require('../models/enterprise.js');

module.exports = {

    createEnterprise: function (req, res, next) {
        const { lib, siret, ownerId, employees } = req.body;

        if (!lib || !siret || !ownerId) {
            return res.status(400).json({ result: false, error: 'Missing required fields' });
        }

        const now = new Date();

        const newEnterprise = new Enterprise({
            lib,
            siret,
            ownerId,
            employees,
            createAt: now,
            updatedAt: now,
        });

        newEnterprise.save()
            .then(enterprise => {
                const User = require('../models/user.js');
                return User.findByIdAndUpdate(
                    ownerId,
                    { enterpriseId: enterprise._id },
                    { new: true }
                ).then(() => enterprise);
            })
            .then(enterprise => res.status(201).json({ result: true, enterprise }))
            .catch(err => res.status(500).json({ result: false, error: err.message }));
    },

    updateEnterprise: function (req, res, next) {
        const enterpriseId = req.params.id;
        const { lib, siret, ownerId, employees, isBanned } = req.body;

        Enterprise.findById(enterpriseId)
            .then(enterprise => {
                if (!enterprise) {
                    res.status(404).json({ result: false, error: 'Enterprise not found' });
                    return null;
                }

                if (enterprise.ownerId.toString() !== res.locals?.user?.id) {
                    res.status(403).json({ result: false, error: 'Only owner can update enterprise' });
                    return null;
                }

                enterprise.lib = lib ?? enterprise.lib;
                enterprise.siret = siret ?? enterprise.siret;
                enterprise.ownerId = ownerId ?? enterprise.ownerId;
                enterprise.employees = employees ?? enterprise.employees;
                enterprise.isBanned = isBanned ?? enterprise.isBanned;
                enterprise.updatedAt = new Date();

                return enterprise.save();
            })
            .then(enterprise => {
                if (!enterprise) {
                    return null;
                }

                return Enterprise.findById(enterprise._id)
                    .populate('ownerId')
                    .populate('employees')
                    .then(updatedEnterprise => res.status(200).json({ result: true, enterprise: updatedEnterprise }));
            })
            .catch(err => res.status(500).json({ result: false, error: err.message }));
    },

    getAllEnterprises: function (req, res, next) {
        Enterprise.find()
            .populate('ownerId')
            .populate('employees')
            .then(enterprises => res.status(200).json({ result: true, enterprises }))
            .catch(err => res.status(500).json({ result: false, error: err.message }));
    },

    getById: function (req, res, next) {
        const enterpriseId = req.params.id;

        Enterprise.findById(enterpriseId)
            .populate('ownerId')
            .populate('employees')
            .then(enterprise => {
                if (!enterprise) {
                    return res.status(404).json({ result: false, error: 'Enterprise not found' });
                }
                return res.status(200).json({ result: true, enterprise });
            })
            .catch(err => res.status(500).json({ result: false, error: err.message }));
    },

    deleteEnterprise: function (req, res, next) {
        const enterpriseId = req.params.id;

        Enterprise.findByIdAndDelete(enterpriseId)
            .then(result => {
                if (!result) {
                    return res.status(404).json({ result: false, error: 'Enterprise not found' });
                }
                return res.status(200).json({ result: true, message: 'Enterprise deleted successfully' });
            })
            .catch(err => res.status(500).json({ result: false, error: err.message }));
    },

};
