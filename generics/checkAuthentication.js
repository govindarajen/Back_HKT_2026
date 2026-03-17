const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
dotenv.config();

/**
 * Checks if a user is authenticated
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {void}
 */
function checkAuthentication(req, res, next) {
    const token = req.headers.authorization;
    if (token) {
        try {
            const bearerToken = token.split(' ')[1]; // Assuming the token is in the
            // format "Bearer <token
            const decoded = jwt.verify(bearerToken, process.env.JWT_SECRET);

            const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds
            if (decoded.exp && decoded.exp < currentTime) {
                // Token has expired
                return res.status(401).json({ error: 'Unauthorized: Token has expired', expired: true });
            } else {
                const newToken = jwt.sign(
                    { 
                        id: decoded.id, username: decoded.username, 
                        fullName: decoded.fullName,
                        groupId: decoded.groupId,
                        enterpriseId: decoded.enterpriseId
                    }, 
                    process.env.JWT_SECRET,
                    { expiresIn: process.env.JWT_EXPIRES_IN } 
                    );
                res.locals.token = newToken; // Store the token in res.locals for later use
                res.locals.user = {
                    id: decoded.id,
                    username: decoded.username,
                    fullName: decoded.fullName,
                    groupId: decoded.groupId,
                    enterpriseId: decoded.enterpriseId
                }; // Store user info in res.locals
                return next();
            }
        } catch (error) {
            // Token verification failed
            return res.status(401).json({ error: 'Unauthorized: Invalid token' });
        }

    }
    
    // If not authenticated, return 401 Unauthorized
    return res.status(401).json({ error: 'Unauthorized: Authentication required' });
}

module.exports = checkAuthentication;