module.exports = {

    checkRights(user, userId = null) {
        
        const rights = user.groupId.rights;
        if (userId && user.id === userId ) {
            return true;
        }

        for (const element of rights) {
            if (element.includes('admin') || element.includes('*')) {
                return true;
            }
        }
        
        return false;
        
    }

} 
