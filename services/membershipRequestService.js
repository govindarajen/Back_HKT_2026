const User = require('../models/user.js');
const MembershipRequest = require('../models/MembershipRequest.js');

module.exports = {
  createRequest: function(req, res, next) {
    const requesterId = res.locals.user.id;
    const requesterRights = res.locals.user?.groupId?.rights || [];
    const { targetUserId } = req.body;

    const hasEnterpriseRights = requesterRights.includes('enterprise_c') || requesterRights.includes('enterprise_w') || requesterRights.includes('enterprise_d') || requesterRights.includes('*');

    if (!targetUserId) {
      return res.status(400).json({ result: false, message: 'targetUserId is required' });
    }

    if (!hasEnterpriseRights) {
      return res.status(403).json({ result: false, message: 'Forbidden' });
    }

    User.findById(requesterId).then(requester => {
      if (!requester) {
        return res.status(404).json({ result: false, message: 'Requester not found' });
      }

      if (!requester.enterpriseId) {
        return res.status(400).json({ result: false, message: 'Requester has no enterprise' });
      }

      return User.findById(targetUserId).then(targetUser => {
        if (!targetUser) {
          return res.status(404).json({ result: false, message: 'Target user not found' });
        }

        if (targetUser.enterpriseId) {
          return res.status(400).json({ result: false, message: 'User is already in an enterprise' });
        }

        return MembershipRequest.findOne({ targetUserId, status: 'pending' }).then(existingPending => {
          if (existingPending) {
            return res.status(409).json({ result: false, message: 'A pending request already exists for this user' });
          }

          const now = new Date();
          const membershipRequest = new MembershipRequest({
            enterpriseId: requester.enterpriseId,
            targetUserId,
            requestedBy: requesterId,
            status: 'pending',
            createdAt: now,
            updatedAt: now,
          });

          return membershipRequest.save().then(saved => {
            return MembershipRequest.findById(saved._id)
              .populate('enterpriseId', 'lib siret')
              .populate('requestedBy', 'fullName username')
              .populate('targetUserId', 'fullName username')
              .then(fullRequest => {
                return res.status(201).json({ result: true, request: fullRequest });
              });
          });
        });
      });
    }).catch(err => {
      console.error('Error creating membership request:', err);
      return res.status(500).json({ result: false, message: 'Internal server error' });
    });
  },

  getMyPendingRequests: function(req, res, next) {
    const userId = res.locals.user.id;

    MembershipRequest.find({ targetUserId: userId, status: 'pending' })
      .populate('enterpriseId', 'lib siret')
      .populate('requestedBy', 'fullName username')
      .sort({ createdAt: -1 })
      .then(requests => {
        return res.status(200).json({ result: true, requests });
      })
      .catch(err => {
        console.error('Error fetching pending membership requests:', err);
        return res.status(500).json({ result: false, message: 'Internal server error' });
      });
  },

  respondToRequest: function(req, res, next) {
    const userId = res.locals.user.id;
    const requestId = req.params.id;
    const { decision } = req.body;

    if (!decision || !['accepted', 'rejected'].includes(decision)) {
      return res.status(400).json({ result: false, message: 'decision must be accepted or rejected' });
    }

    MembershipRequest.findById(requestId).then(request => {
      if (!request) {
        return res.status(404).json({ result: false, message: 'Request not found' });
      }

      if (String(request.targetUserId) !== String(userId)) {
        return res.status(403).json({ result: false, message: 'Forbidden' });
      }

      if (request.status !== 'pending') {
        return res.status(409).json({ result: false, message: 'Request already processed' });
      }

      const now = new Date();
      request.status = decision;
      request.respondedAt = now;
      request.updatedAt = now;

      return request.save().then(savedRequest => {
        if (decision === 'accepted') {
          return User.findByIdAndUpdate(userId, {
            enterpriseId: savedRequest.enterpriseId,
            updatedAt: now,
            updatedBy: userId,
          }, { new: true }).then(updatedUser => {
            return res.status(200).json({ result: true, request: savedRequest, user: updatedUser });
          });
        }

        return res.status(200).json({ result: true, request: savedRequest });
      });
    }).catch(err => {
      console.error('Error responding to membership request:', err);
      return res.status(500).json({ result: false, message: 'Internal server error' });
    });
  },
};
